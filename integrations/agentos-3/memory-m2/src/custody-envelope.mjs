import { constants, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { base32, canonicalBytes, canonicalJson, sha256Ref } from "./canonical.mjs";
import { MemoryError, invariant } from "./errors.mjs";
import { fsyncDir } from "./io.mjs";
import { assertPortablePath } from "./export-manifest.mjs";
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman,
  generateKeyPairSync, hkdfSync, randomBytes, sign, verify } from "node:crypto";

export const CUSTODY_ENVELOPE_SCHEMA = "agentos.memory.recipient-custody-envelope.v1";
export const CUSTODY_HEADER_SCHEMA = "agentos.memory.recipient-custody-header.v1";
export const CUSTODY_PAYLOAD_SCHEMA = "agentos.memory.recipient-custody-payload.v1";
export const CUSTODY_ALGORITHMS = Object.freeze({
  key_agreement: "X25519-SPKI-PEM",
  kdf: "HKDF-SHA256-32BYTE",
  content_encryption: "AES-256-GCM-96BIT-NONCE-128BIT-TAG",
  signature: "Ed25519-SPKI-PEM"
});
export const CUSTODY_CHUNK_SIZE = 64 * 1024;
const DIGEST = /^sha256:[a-z2-7]{52}$/;
const OBJECT_REF = /^obj_[a-z2-7]{52}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const ENVELOPE_DOMAIN = Buffer.from("agentos.memory.recipient-custody-envelope.v1\0", "utf8");
const KDF_INFO = Buffer.from("agentos.memory.recipient-custody-key.v1", "utf8");

function canonicalUtc(value, code, label) {
  invariant(typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value, code, `${label} must be canonical UTC`);
}

function recipientPublic(value) {
  let pem;
  try { pem = Buffer.from(createPublicKey(value).export({ type: "spki", format: "pem" })); }
  catch (error) { throw new MemoryError("INVALID_ENVELOPE_RECIPIENT_KEY", "recipient public key is invalid", { cause: error.message }); }
  invariant(pem.equals(Buffer.from(value)), "NON_CANONICAL_ENVELOPE_RECIPIENT_KEY",
    "recipient public key must use canonical SPKI PEM encoding");
  invariant(createPublicKey(pem).asymmetricKeyType === "x25519", "INVALID_ENVELOPE_RECIPIENT_KEY",
    "recipient public key must be X25519");
  return pem;
}

export function custodyRecipientKeyId(publicKey) {
  return sha256Ref("agentos.memory.custody-recipient-key.v1", recipientPublic(publicKey));
}

function projectEntryDigest(projectId, path, hashBytes) {
  return `sha256:${base32(createHash("sha256").update(`agentos.memory.custody-entry.v1:${projectId}\0${path}\0`)
    .update(hashBytes).digest())}`;
}

async function scanEntry(sourceRoot, projectId, entry) {
  assertPortablePath(entry.path);
  invariant(["authority", "evidence", "private_control", "public_control"].includes(entry.classification),
    "INVALID_CUSTODY_ENTRY", "custody entry classification is invalid");
  const path = join(sourceRoot, ...entry.path.split("/"));
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    invariant(info.isFile() && (info.mode & 0o077) === 0, "INSECURE_CUSTODY_SOURCE",
      `custody source ${entry.path} must be a private regular file`);
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return { path: entry.path, classification: entry.classification, size: info.size,
      byte_digest: projectEntryDigest(projectId, entry.path, hash.digest()) };
  } finally { await handle.close(); }
}

async function *payloadStream({ sourceRoot, payloadManifest }) {
  yield Buffer.from(`${canonicalJson({ schema: CUSTODY_PAYLOAD_SCHEMA, project_id: payloadManifest.project_id,
    public_manifest_digest: payloadManifest.public_manifest_digest })}\n`);
  for (const entry of payloadManifest.entries) {
    yield Buffer.from(`${canonicalJson({ schema: "agentos.memory.recipient-custody-entry.v1", entry })}\n`);
    const handle = await open(join(sourceRoot, ...entry.path.split("/")), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      let index = 0;
      let offset = 0;
      for await (const chunk of handle.createReadStream({ highWaterMark: CUSTODY_CHUNK_SIZE, autoClose: false })) {
        yield Buffer.from(`${canonicalJson({ schema: "agentos.memory.recipient-custody-chunk.v1", path: entry.path,
          index, offset, bytes_base64: Buffer.from(chunk).toString("base64url") })}\n`);
        offset += chunk.length;
        index += 1;
      }
    } finally { await handle.close(); }
  }
  yield Buffer.from(`${canonicalJson({ schema: "agentos.memory.recipient-custody-end.v1",
    payload_manifest_digest: sha256Ref("agentos.memory.custody-payload-manifest.v1", canonicalBytes(payloadManifest)) })}\n`);
}

function deriveKey(shared, salt, headerContext) {
  return Buffer.from(hkdfSync("sha256", shared, salt, Buffer.concat([KDF_INFO, canonicalBytes(headerContext)]), 32));
}

function assertEnvelopeShape(envelope) {
  invariant(envelope && typeof envelope === "object" && !Array.isArray(envelope),
    "INVALID_CUSTODY_ENVELOPE", "custody envelope must be an object");
  invariant(Object.keys(envelope).sort().join(",") === "ciphertext,header,schema,signature,signature_profile,signing_key_id",
    "INVALID_CUSTODY_ENVELOPE", "custody envelope fields must be exact");
  invariant(envelope.schema === CUSTODY_ENVELOPE_SCHEMA && envelope.signature_profile === "pure-ed25519-v1"
    && DIGEST.test(envelope.signing_key_id) && SIGNATURE.test(envelope.signature),
  "INVALID_CUSTODY_ENVELOPE", "custody envelope signature profile is invalid");
  const header = envelope.header;
  const headerKeys = ["algorithms", "chunk_size", "envelope_id", "ephemeral_public_key_pem", "expires_at_utc",
    "nonce_base64", "project_id", "public_manifest_digest", "purpose", "recipient_generation",
    "recipient_authority_ref", "recipient_key_id", "salt_base64", "schema", "source_head", "source_key_generation",
    "storage_conformance_receipt_digest", "storage_conformance_receipt_ref", "storage_profile_digest",
    "storage_profile_ref"];
  invariant(header && canonicalJson(Object.keys(header).sort()) === canonicalJson(headerKeys.sort())
    && header.schema === CUSTODY_HEADER_SCHEMA && canonicalJson(header.algorithms) === canonicalJson(CUSTODY_ALGORITHMS),
  "UNKNOWN_CUSTODY_PROFILE", "custody header or algorithm profile is unsupported");
  invariant(DIGEST.test(header.envelope_id) && DIGEST.test(header.recipient_key_id)
    && DIGEST.test(header.public_manifest_digest) && DIGEST.test(header.storage_profile_digest)
    && DIGEST.test(header.storage_conformance_receipt_digest),
  "INVALID_CUSTODY_ENVELOPE", "custody header digest is invalid");
  invariant(OBJECT_REF.test(header.recipient_authority_ref) && OBJECT_REF.test(header.storage_profile_ref)
    && OBJECT_REF.test(header.storage_conformance_receipt_ref),
    "INVALID_CUSTODY_ENVELOPE", "custody storage authority reference is invalid");
  invariant(typeof header.project_id === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(header.project_id)
    && typeof header.purpose === "string" && /^[a-z][a-z0-9._-]{2,63}$/.test(header.purpose),
  "INVALID_CUSTODY_ENVELOPE", "custody project or purpose is invalid");
  canonicalUtc(header.expires_at_utc, "INVALID_CUSTODY_EXPIRY", "custody expiry");
  invariant(Number.isSafeInteger(header.recipient_generation) && header.recipient_generation >= 0
    && Number.isSafeInteger(header.source_key_generation) && header.source_key_generation >= 0
    && header.chunk_size === CUSTODY_CHUNK_SIZE, "INVALID_CUSTODY_ENVELOPE", "custody generation or chunk size is invalid");
  invariant(header.source_head && Number.isSafeInteger(header.source_head.sequence) && header.source_head.sequence >= 1
    && DIGEST.test(header.source_head.digest), "INVALID_CUSTODY_ENVELOPE", "custody source head is invalid");
  invariant(typeof header.ephemeral_public_key_pem === "string"
    && /^[A-Za-z0-9_-]{16}$/.test(header.nonce_base64) && /^[A-Za-z0-9_-]{22}$/.test(header.salt_base64),
  "INVALID_CUSTODY_ENVELOPE", "custody key material encoding is invalid");
  invariant(Buffer.from(header.nonce_base64, "base64url").toString("base64url") === header.nonce_base64
    && Buffer.from(header.salt_base64, "base64url").toString("base64url") === header.salt_base64,
  "INVALID_CUSTODY_ENVELOPE", "custody key material encoding is noncanonical");
  const ciphertext = envelope.ciphertext;
  invariant(ciphertext && Object.keys(ciphertext).sort().join(",") === "auth_tag_base64,byte_digest,path,size"
    && ciphertext.path === "ciphertext.bin" && Number.isSafeInteger(ciphertext.size) && ciphertext.size > 0
    && DIGEST.test(ciphertext.byte_digest) && /^[A-Za-z0-9_-]{22}$/.test(ciphertext.auth_tag_base64),
  "INVALID_CUSTODY_ENVELOPE", "custody ciphertext receipt is invalid");
  return envelope;
}

export async function readCustodyEnvelopeAdmissionClaim(targetRoot) {
  const root = resolve(targetRoot);
  await privateDirectory(root, "custody envelope root");
  const names = (await readdir(root)).sort();
  invariant(names.join(",") === "ciphertext.bin,envelope.json", "CUSTODY_ENVELOPE_CONTENT_MISMATCH",
    "custody envelope directory contains missing or extra files");
  const bytes = await readPrivate(join(root, "envelope.json"), "custody envelope document");
  let envelope;
  try { envelope = JSON.parse(bytes); } catch (error) {
    throw new MemoryError("INVALID_CUSTODY_ENVELOPE", "custody envelope JSON is invalid");
  }
  invariant(bytes.equals(canonicalBytes(envelope)), "NON_CANONICAL_CUSTODY_ENVELOPE",
    "custody envelope is noncanonical");
  assertEnvelopeShape(envelope);
  return { project_id: envelope.header.project_id, envelope_id: envelope.header.envelope_id,
    purpose: envelope.header.purpose, signing_key_id: envelope.signing_key_id,
    recipient_key_id: envelope.header.recipient_key_id,
    recipient_generation: envelope.header.recipient_generation,
    recipient_authority_ref: envelope.header.recipient_authority_ref,
    nonce_identity: `${envelope.header.recipient_key_id}:${envelope.header.nonce_base64}`,
    source_head: envelope.header.source_head, source_key_generation: envelope.header.source_key_generation,
    storage_profile_ref: envelope.header.storage_profile_ref,
    storage_profile_digest: envelope.header.storage_profile_digest,
    storage_conformance_receipt_ref: envelope.header.storage_conformance_receipt_ref,
    storage_conformance_receipt_digest: envelope.header.storage_conformance_receipt_digest,
    public_manifest_digest: envelope.header.public_manifest_digest };
}

async function privateDirectory(path, label) {
  const info = await lstat(path);
  invariant(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0,
    "INSECURE_CUSTODY_ENVELOPE", `${label} must be a private real directory`);
}

async function readPrivate(path, label) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    invariant(info.isFile() && (info.mode & 0o077) === 0, "INSECURE_CUSTODY_ENVELOPE",
      `${label} must be a private regular file`);
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function scanCiphertext(path, projectId) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    invariant(info.isFile() && (info.mode & 0o077) === 0, "INSECURE_CUSTODY_ENVELOPE",
      "custody ciphertext must be a private regular file");
    const hash = createHash("sha256").update(`agentos.memory.custody-ciphertext.v1:${projectId}\0`);
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return { size: info.size, byte_digest: `sha256:${base32(hash.digest())}` };
  } finally { await handle.close(); }
}

export async function createRecipientCustodyEnvelope({ source_root: sourceRoot, target_root: targetRoot,
  project_id: projectId, purpose, expires_at_utc: expiresAt, recipient_public_key: recipientPublicKey,
  recipient_key_id: declaredRecipientKeyId, recipient_generation: recipientGeneration,
  recipient_authority_ref: recipientAuthorityRef,
  revoked_recipient_key_ids: revokedIds = [], source_head: sourceHead,
  source_key_generation: sourceGeneration, signing_key_id: signingKeyId, signing_private_key: signingPrivateKey,
  storage_profile_ref: profileRef, storage_profile_digest: profileDigest,
  storage_conformance_receipt_ref: receiptRef, storage_conformance_receipt_digest: receiptDigest,
  public_manifest_digest: publicManifestDigest, entries, fault_after_boundary: faultAfter = null }) {
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  invariant(relative(source, target).startsWith("..") && relative(target, source).startsWith(".."),
    "CUSTODY_ENVELOPE_ROOT_OVERLAP", "custody envelope and project roots must be disjoint");
  canonicalUtc(expiresAt, "INVALID_CUSTODY_EXPIRY", "custody expiry");
  invariant(faultAfter === null || ["ciphertext", "envelope"].includes(faultAfter),
    "INVALID_CUSTODY_FAULT_POINT", "custody fault point is invalid");
  invariant(Date.parse(expiresAt) > Date.now(), "EXPIRED_CUSTODY_ENVELOPE", "custody envelope expiry must be future");
  const recipientPem = recipientPublic(recipientPublicKey);
  const recipientKeyId = custodyRecipientKeyId(recipientPem);
  invariant(Number.isSafeInteger(recipientGeneration) && recipientGeneration >= 0,
    "INVALID_CUSTODY_RECIPIENT_GENERATION", "recipient generation must be a non-negative safe integer");
  invariant(OBJECT_REF.test(recipientAuthorityRef), "INVALID_CUSTODY_RECIPIENT_AUTHORITY",
    "recipient authority reference must be a project object reference");
  invariant(Array.isArray(revokedIds) && revokedIds.every((id) => DIGEST.test(id)),
    "INVALID_CUSTODY_REVOCATION_SET", "revoked recipient identities must be digest references");
  invariant(declaredRecipientKeyId === recipientKeyId, "CUSTODY_RECIPIENT_KEY_MISMATCH",
    "declared recipient key identity does not match supplied public key");
  invariant(!revokedIds.includes(recipientKeyId), "REVOKED_CUSTODY_RECIPIENT", "recipient key is revoked");
  invariant(Array.isArray(entries) && entries.length > 0, "EMPTY_CUSTODY_PAYLOAD", "custody payload is empty");
  const payloadEntries = [];
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) payloadEntries.push(await scanEntry(source, projectId, entry));
  invariant(new Set(payloadEntries.map(({ path }) => path)).size === payloadEntries.length,
    "DUPLICATE_CUSTODY_ENTRY", "custody payload paths must be unique");
  const payloadManifest = { schema: "agentos.memory.recipient-custody-payload-manifest.v1",
    project_id: projectId, public_manifest_digest: publicManifestDigest, entries: payloadEntries };
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralPublic = Buffer.from(ephemeral.publicKey.export({ type: "spki", format: "pem" }));
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const headerContext = { project_id: projectId, purpose, recipient_key_id: recipientKeyId,
    recipient_generation: recipientGeneration, recipient_authority_ref: recipientAuthorityRef,
    source_head: sourceHead, source_key_generation: sourceGeneration,
    storage_profile_ref: profileRef, storage_profile_digest: profileDigest,
    storage_conformance_receipt_ref: receiptRef, storage_conformance_receipt_digest: receiptDigest,
    public_manifest_digest: publicManifestDigest, expires_at_utc: expiresAt };
  const envelopeId = sha256Ref("agentos.memory.custody-envelope-id.v1",
    Buffer.concat([canonicalBytes(headerContext), ephemeralPublic, salt, nonce]));
  const header = { schema: CUSTODY_HEADER_SCHEMA, envelope_id: envelopeId, algorithms: CUSTODY_ALGORITHMS,
    ...headerContext, ephemeral_public_key_pem: ephemeralPublic.toString("utf8"), salt_base64: salt.toString("base64url"),
    nonce_base64: nonce.toString("base64url"), chunk_size: CUSTODY_CHUNK_SIZE };
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: createPublicKey(recipientPem) });
  const key = deriveKey(shared, salt, headerContext);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(canonicalBytes(header));
  const parent = dirname(target);
  await privateDirectory(parent, "custody envelope parent");
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true; await fsyncDir(parent);
    const ciphertextPath = join(target, "ciphertext.bin");
    await pipeline(Readable.from(payloadStream({ sourceRoot: source, payloadManifest })), cipher,
      createWriteStream(ciphertextPath, { flags: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
        | constants.O_NOFOLLOW, mode: 0o600 }));
    const ciphertextHandle = await open(ciphertextPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    await ciphertextHandle.sync(); await ciphertextHandle.close(); await fsyncDir(target);
    if (faultAfter === "ciphertext") throw new MemoryError("INJECTED_CUSTODY_FAILURE", "injected custody failure");
    const scannedCiphertext = await scanCiphertext(ciphertextPath, projectId);
    const ciphertext = { path: "ciphertext.bin", size: scannedCiphertext.size,
      byte_digest: scannedCiphertext.byte_digest,
      auth_tag_base64: cipher.getAuthTag().toString("base64url") };
    const signingBytes = Buffer.concat([ENVELOPE_DOMAIN, canonicalBytes({ header, ciphertext })]);
    const envelope = { schema: CUSTODY_ENVELOPE_SCHEMA, header, ciphertext, signature_profile: "pure-ed25519-v1",
      signing_key_id: signingKeyId, signature: sign(null, signingBytes, signingPrivateKey).toString("base64url") };
    assertEnvelopeShape(envelope);
    const envelopePath = join(target, "envelope.json");
    const envelopeHandle = await open(envelopePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await envelopeHandle.writeFile(canonicalBytes(envelope)); await envelopeHandle.sync(); await envelopeHandle.close(); await fsyncDir(target);
    if (faultAfter === "envelope") throw new MemoryError("INJECTED_CUSTODY_FAILURE", "injected custody failure");
    created = false;
    return envelope;
  } catch (error) {
    if (created) { await rm(target, { recursive: true, force: true }); await fsyncDir(parent); }
    throw error;
  } finally { key.fill(0); shared.fill(0); }
}

async function parseDecryptedPayload(stream, expectedManifestDigest, expectedProjectId, sink = null) {
  let buffer = "";
  let manifest = null;
  const states = new Map();
  let ended = false;
  let activePath = null;
  for await (const chunk of stream) {
    buffer += Buffer.from(chunk).toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      invariant(Buffer.byteLength(line) <= CUSTODY_CHUNK_SIZE * 3, "CUSTODY_PAYLOAD_LINE_TOO_LARGE",
        "custody payload record exceeded bounded line memory");
      let record;
      try { record = JSON.parse(line); } catch (error) { throw new MemoryError("INVALID_CUSTODY_PAYLOAD", "custody payload JSON is invalid"); }
      invariant(line === canonicalJson(record), "NON_CANONICAL_CUSTODY_PAYLOAD", "custody payload record is noncanonical");
      if (manifest === null) {
        invariant(record.schema === CUSTODY_PAYLOAD_SCHEMA && record.project_id === expectedProjectId
          && record.public_manifest_digest === expectedManifestDigest
          && Object.keys(record).sort().join(",") === "project_id,public_manifest_digest,schema",
          "CUSTODY_MANIFEST_MISMATCH", "custody payload manifest linkage is invalid");
        manifest = { schema: "agentos.memory.recipient-custody-payload-manifest.v1",
          project_id: record.project_id, public_manifest_digest: record.public_manifest_digest, entries: [] };
      } else if (record.schema === "agentos.memory.recipient-custody-entry.v1") {
        invariant(!ended && Object.keys(record).sort().join(",") === "entry,schema",
          "INVALID_CUSTODY_ENTRY", "custody payload entry record is invalid");
        const entry = record.entry;
        invariant(entry && Object.keys(entry).sort().join(",") === "byte_digest,classification,path,size"
          && ["authority", "evidence", "private_control", "public_control"].includes(entry.classification)
          && Number.isSafeInteger(entry.size) && entry.size >= 0 && DIGEST.test(entry.byte_digest),
        "INVALID_CUSTODY_ENTRY", "custody payload entry is invalid");
        assertPortablePath(entry.path);
        const priorPath = manifest.entries.at(-1)?.path ?? null;
        invariant(priorPath === null || priorPath.localeCompare(entry.path) < 0,
          "INVALID_CUSTODY_ENTRY", "custody payload entries must be unique and canonically ordered");
        if (activePath !== null) invariant(states.get(activePath).offset === states.get(activePath).entry.size,
          "TRUNCATED_CUSTODY_ENTRY", `custody entry ${activePath} ended before its declared size`);
        manifest.entries.push(entry);
        states.set(entry.path, { entry, index: 0, offset: 0, hash: createHash("sha256") });
        activePath = entry.path;
        if (sink) await sink.begin(entry);
      } else if (record.schema === "agentos.memory.recipient-custody-chunk.v1") {
        invariant(!ended, "INVALID_CUSTODY_PAYLOAD", "custody chunk appears after payload termination");
        const state = states.get(record.path);
        invariant(state && record.path === activePath && record.index === state.index && record.offset === state.offset,
          "INVALID_CUSTODY_CHUNK_ORDER", "custody chunks are missing, duplicated, or reordered");
        const bytes = Buffer.from(record.bytes_base64, "base64url");
        invariant(bytes.toString("base64url") === record.bytes_base64 && bytes.length <= CUSTODY_CHUNK_SIZE,
          "INVALID_CUSTODY_CHUNK", "custody chunk encoding or size is invalid");
        state.hash.update(bytes); state.offset += bytes.length; state.index += 1;
        if (sink) await sink.write(record.path, bytes);
      } else {
        invariant(record.schema === "agentos.memory.recipient-custody-end.v1" && !ended,
          "INVALID_CUSTODY_PAYLOAD", "custody payload terminator is invalid");
        invariant(manifest.entries.length > 0 && activePath !== null
          && states.get(activePath).offset === states.get(activePath).entry.size,
        "TRUNCATED_CUSTODY_ENTRY", "custody payload ended before its final entry completed");
        invariant(record.payload_manifest_digest === sha256Ref("agentos.memory.custody-payload-manifest.v1", canonicalBytes(manifest)),
          "CUSTODY_MANIFEST_MISMATCH", "custody payload manifest digest is invalid");
        ended = true;
      }
    }
    invariant(Buffer.byteLength(buffer) <= CUSTODY_CHUNK_SIZE * 3, "CUSTODY_PAYLOAD_LINE_TOO_LARGE",
      "custody payload exceeded bounded line memory");
  }
  invariant(buffer.length === 0 && ended && manifest, "TRUNCATED_CUSTODY_PAYLOAD", "custody payload is truncated");
  for (const state of states.values()) {
    invariant(state.offset === state.entry.size
      && projectEntryDigest(manifest.project_id, state.entry.path, state.hash.digest()) === state.entry.byte_digest,
    "CUSTODY_ENTRY_DIGEST_MISMATCH", `custody entry ${state.entry.path} is incomplete or corrupt`);
  }
  if (sink) await sink.finish(manifest);
  return manifest;
}

async function prepareImportStage(targetRoot) {
  const target = resolve(targetRoot);
  const parent = dirname(target);
  await privateDirectory(parent, "custody import parent");
  try { await lstat(target); invariant(false, "CUSTODY_IMPORT_TARGET_EXISTS", "custody import target already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = join(parent, `.${target.split("/").at(-1)}.import-${randomBytes(12).toString("hex")}`);
  await mkdir(temporary, { mode: 0o700 });
  await mkdir(join(temporary, "payload"), { mode: 0o700 });
  await fsyncDir(parent);
  let handle = null;
  let activePath = null;
  let activeDirectory = null;
  let published = false;
  const close = async () => { if (handle) { await handle.sync(); await handle.close(); handle = null;
    await fsyncDir(activeDirectory); activeDirectory = null; } };
  return {
    payloadRoot: join(temporary, "payload"),
    async begin(entry) {
      await close();
      const parts = entry.path.split("/");
      const name = parts.pop();
      let directory = join(temporary, "payload");
      for (const part of parts) {
        directory = join(directory, part);
        try { await mkdir(directory, { mode: 0o700 }); await fsyncDir(dirname(directory)); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
      }
      handle = await open(join(directory, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
        | constants.O_NOFOLLOW, 0o600);
      activePath = entry.path;
      activeDirectory = directory;
    },
    async write(path, bytes) {
      invariant(handle && path === activePath, "CUSTODY_IMPORT_WRITE_ORDER", "custody import write is out of order");
      await handle.write(bytes);
    },
    async finish() { await close(); await fsyncDir(join(temporary, "payload")); },
    async publish(receipt) {
      await close();
      const receiptHandle = await open(join(temporary, "import-candidate.json"), constants.O_CREAT | constants.O_EXCL
        | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await receiptHandle.writeFile(canonicalBytes(receipt)); await receiptHandle.sync(); await receiptHandle.close();
      await fsyncDir(temporary); await rename(temporary, target); await fsyncDir(parent); published = true;
    },
    async cleanup() { await close(); if (!published) { await rm(temporary, { recursive: true, force: true }); await fsyncDir(parent); } }
  };
}

export async function inspectRecipientCustodyEnvelope({ target_root: targetRoot, recipient_private_key: recipientPrivateKey,
  recipient_public_key: recipientPublicKey, recipient_generation: recipientGeneration,
  revoked_recipient_key_ids: revokedIds = [], expected, signing_public_key: signingPublicKey,
  replay_guard: replayGuard, staging_root: stagingRoot = null,
  staging_fault_after_boundary: stagingFaultAfter = null, staging_validator: stagingValidator = null,
  staging_receipt_context: stagingReceiptContext = {}, staging_before_publish: stagingBeforePublish = null }) {
  invariant(stagingFaultAfter === null || ["payload", "authority"].includes(stagingFaultAfter),
    "INVALID_CUSTODY_IMPORT_FAULT_POINT", "custody import fault point is invalid");
  if (stagingRoot !== null) invariant(stagingReceiptContext
    && Object.keys(stagingReceiptContext).sort().join(",") === "admission_event_sequence,admission_ref"
    && OBJECT_REF.test(stagingReceiptContext.admission_ref)
    && Number.isSafeInteger(stagingReceiptContext.admission_event_sequence)
    && stagingReceiptContext.admission_event_sequence > 0,
  "INVALID_CUSTODY_IMPORT_LINEAGE", "custody import admission lineage is invalid");
  const root = resolve(targetRoot);
  await privateDirectory(root, "custody envelope root");
  const names = (await readdir(root)).sort();
  invariant(names.join(",") === "ciphertext.bin,envelope.json", "CUSTODY_ENVELOPE_CONTENT_MISMATCH",
    "custody envelope directory contains missing or extra files");
  const envelopeBytes = await readPrivate(join(root, "envelope.json"), "custody envelope document");
  let envelope;
  try { envelope = JSON.parse(envelopeBytes); } catch (error) { throw new MemoryError("INVALID_CUSTODY_ENVELOPE", "custody envelope JSON is invalid"); }
  invariant(envelopeBytes.equals(canonicalBytes(envelope)), "NON_CANONICAL_CUSTODY_ENVELOPE", "custody envelope is noncanonical");
  assertEnvelopeShape(envelope);
  const header = envelope.header;
  const { signing_key_id: expectedSigningKeyId, ...expectedContext } = expected;
  invariant(canonicalJson({ project_id: header.project_id, purpose: header.purpose, source_head: header.source_head,
    recipient_authority_ref: header.recipient_authority_ref,
    source_key_generation: header.source_key_generation, storage_profile_ref: header.storage_profile_ref,
    storage_profile_digest: header.storage_profile_digest,
    storage_conformance_receipt_ref: header.storage_conformance_receipt_ref,
    storage_conformance_receipt_digest: header.storage_conformance_receipt_digest,
    public_manifest_digest: header.public_manifest_digest }) === canonicalJson(expectedContext),
  "CUSTODY_ENVELOPE_CONTEXT_MISMATCH", "custody envelope project, purpose, head, or storage context is stale or mismatched");
  invariant(Date.now() <= Date.parse(header.expires_at_utc), "EXPIRED_CUSTODY_ENVELOPE", "custody envelope has expired");
  const recipientPem = recipientPublic(recipientPublicKey);
  const recipientKeyId = custodyRecipientKeyId(recipientPem);
  invariant(Array.isArray(revokedIds) && revokedIds.every((id) => DIGEST.test(id)),
    "INVALID_CUSTODY_REVOCATION_SET", "revoked recipient identities must be digest references");
  invariant(header.recipient_key_id === recipientKeyId && header.recipient_generation === recipientGeneration,
    "WRONG_CUSTODY_RECIPIENT", "custody envelope recipient is wrong or stale");
  invariant(!revokedIds.includes(recipientKeyId), "REVOKED_CUSTODY_RECIPIENT", "custody recipient key is revoked");
  invariant(replayGuard && typeof replayGuard.has === "function" && typeof replayGuard.add === "function",
    "MISSING_CUSTODY_REPLAY_GUARD", "custody inspection requires a replay guard");
  const nonceIdentity = `${recipientKeyId}:${header.nonce_base64}`;
  invariant(!replayGuard.has(header.envelope_id) && !replayGuard.has(nonceIdentity), "REPLAYED_CUSTODY_ENVELOPE",
    "custody envelope or recipient nonce was already consumed");
  invariant(envelope.signing_key_id === expectedSigningKeyId,
    "CUSTODY_SIGNING_KEY_MISMATCH", "custody envelope signing key is stale or revoked");
  const signed = Buffer.concat([ENVELOPE_DOMAIN, canonicalBytes({ header, ciphertext: envelope.ciphertext })]);
  invariant(verify(null, signed, signingPublicKey, Buffer.from(envelope.signature, "base64url")),
    "CUSTODY_ENVELOPE_SIGNATURE_INVALID", "custody envelope signature is invalid");
  let derived;
  try { derived = Buffer.from(createPublicKey(recipientPrivateKey).export({ type: "spki", format: "pem" })); }
  catch (error) { throw new MemoryError("INVALID_CUSTODY_RECIPIENT_PRIVATE_KEY", "recipient private key is invalid"); }
  invariant(derived.equals(recipientPem), "WRONG_CUSTODY_RECIPIENT", "recipient private and public keys do not match");
  const ciphertextPath = join(root, "ciphertext.bin");
  const scannedCiphertext = await scanCiphertext(ciphertextPath, header.project_id);
  invariant(scannedCiphertext.size === envelope.ciphertext.size
    && scannedCiphertext.byte_digest === envelope.ciphertext.byte_digest,
  "CUSTODY_CIPHERTEXT_MISMATCH", "custody ciphertext is truncated or changed");
  const salt = Buffer.from(header.salt_base64, "base64url");
  const nonce = Buffer.from(header.nonce_base64, "base64url");
  const ephemeral = recipientPublic(Buffer.from(header.ephemeral_public_key_pem));
  const headerContext = { project_id: header.project_id, purpose: header.purpose, recipient_key_id: header.recipient_key_id,
    recipient_generation: header.recipient_generation, recipient_authority_ref: header.recipient_authority_ref,
    source_head: header.source_head,
    source_key_generation: header.source_key_generation, storage_profile_ref: header.storage_profile_ref,
    storage_profile_digest: header.storage_profile_digest,
    storage_conformance_receipt_ref: header.storage_conformance_receipt_ref,
    storage_conformance_receipt_digest: header.storage_conformance_receipt_digest,
    public_manifest_digest: header.public_manifest_digest, expires_at_utc: header.expires_at_utc };
  invariant(header.envelope_id === sha256Ref("agentos.memory.custody-envelope-id.v1",
    Buffer.concat([canonicalBytes(headerContext), ephemeral, salt, nonce])),
  "CUSTODY_ENVELOPE_ID_MISMATCH", "custody envelope identity does not match its randomized context");
  const shared = diffieHellman({ privateKey: createPrivateKey(recipientPrivateKey), publicKey: createPublicKey(ephemeral) });
  const key = deriveKey(shared, salt, headerContext);
  const ciphertextHandle = await open(ciphertextPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  const staging = stagingRoot === null ? null : await prepareImportStage(stagingRoot);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(canonicalBytes(header));
    decipher.setAuthTag(Buffer.from(envelope.ciphertext.auth_tag_base64, "base64url"));
    const manifest = await parseDecryptedPayload(ciphertextHandle.createReadStream({ autoClose: false }).pipe(decipher),
      header.public_manifest_digest, header.project_id, staging);
    replayGuard.add(header.envelope_id); replayGuard.add(nonceIdentity);
    const result = { ok: true, envelope_id: header.envelope_id, entry_count: manifest.entries.length,
      nonce_identity: nonceIdentity, source_head: header.source_head,
      payload_manifest_digest: sha256Ref("agentos.memory.custody-payload-manifest.v1", canonicalBytes(manifest)) };
    if (staging && stagingValidator) await stagingValidator(staging.payloadRoot, result);
    if (stagingFaultAfter === "payload") throw new MemoryError("INJECTED_CUSTODY_IMPORT_FAILURE",
      "injected custody import failure after verified payload staging");
    if (staging && stagingBeforePublish) await stagingBeforePublish(result);
    if (stagingFaultAfter === "authority") throw new MemoryError("INJECTED_CUSTODY_IMPORT_FAILURE",
      "injected custody import failure after signed stage authority");
    if (staging) await staging.publish({ schema: "agentos.memory.custody-import-candidate.v1",
      project_id: header.project_id, envelope_id: header.envelope_id,
      recipient_authority_ref: header.recipient_authority_ref, recipient_generation: header.recipient_generation,
      nonce_identity: nonceIdentity, source_head: header.source_head,
      payload_manifest_digest: result.payload_manifest_digest, entry_count: result.entry_count,
      admission_ref: stagingReceiptContext.admission_ref,
      admission_event_sequence: stagingReceiptContext.admission_event_sequence,
      stage_ref: stagingReceiptContext.stage_ref,
      stage_event_sequence: stagingReceiptContext.stage_event_sequence,
      disposition: "NON_ACTIVATING_STAGED" });
    return result;
  } catch (error) {
    if (error instanceof MemoryError) throw error;
    throw new MemoryError("CUSTODY_DECRYPTION_FAILED", "custody envelope authentication or decryption failed");
  } finally { if (staging) await staging.cleanup(); await ciphertextHandle.close(); key.fill(0); shared.fill(0); }
}
