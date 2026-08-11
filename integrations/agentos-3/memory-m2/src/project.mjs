import { constants } from "node:fs";
import { chmod, link, lstat, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { canonicalBytes, canonicalJson, projectObjectRef, sha256Ref } from "./canonical.mjs";
import { MemoryError, invariant } from "./errors.mjs";
import { acquireWriterLock, atomicWrite, ensurePrivateDir, exists, fsyncDir, readJson } from "./io.mjs";
import { advanceSigningKey, createRotationCertificate } from "./key-lifecycle.mjs";
import { createEmergencyRecoveryCertificate, verifyEmergencyRecoveryCertificate } from "./key-recovery.mjs";
import { advanceTransitionJournal, createTransitionJournal, decideTransitionJournalOutcome,
  publishTransitionJournal, readTransitionJournal, replaceTransitionJournal } from "./transition-journal.mjs";
import { uuidv7 } from "./uuidv7.mjs";
import { LOCAL_FAULT_BOUNDARY_EVIDENCE_DIGEST, LOCAL_FILESYSTEM_STORAGE_PROFILE,
  assertStorageProfile, probeLocalFilesystemStorage,
  verifyStorageConformanceReceipt } from "./storage-profile.mjs";
import { createPublicExportManifest as createExportManifest, exportEntry,
  verifyPublicExportManifest as verifyExportManifest } from "./export-manifest.mjs";
import { materializePublicExportBundle as materializeExportBundle,
  verifyPublicExportBundle as verifyExportBundle } from "./export-bundle.mjs";
import { createRecipientCustodyEnvelope as createCustodyEnvelope,
  inspectRecipientCustodyEnvelope as inspectCustodyEnvelope,
  readCustodyEnvelopeAdmissionClaim } from "./custody-envelope.mjs";
import { RECIPIENT_ACTIONS, applyRecipientAuthorityEvent, createRecipientAuthority,
  recipientAuthorityMetadata } from "./recipient-authority.mjs";
import { CUSTODY_ADMISSION_ACTION, applyCustodyAdmissionEvent, createCustodyAdmission,
  custodyAdmissionMetadata } from "./custody-admission.mjs";
import { IMPORT_STAGE_ACTION, applyImportStageEvent, createImportStageRecord,
  importStageMetadata, IMPORT_DISPOSAL_ACTIONS, applyImportDisposalEvent,
  createImportDisposalRecord, importDisposalMetadata } from "./import-staging.mjs";

const CONFIG_SCHEMA = "agentos.memory.project.v1";
const EVENT_SCHEMA = "agentos.memory.event.v1";
const HEAD_SCHEMA = "agentos.memory.head.v1";
const KEY_STATE_SCHEMA = "agentos.memory.signing_key_state.v1";
const COMPROMISE_EVIDENCE_SCHEMA = "agentos.memory.signing_key_compromise_evidence.v1";
const EVENT_NAME = /^(\d{20})\.json$/;
const OBJECT_REF = /^obj_[a-z2-7]{52}$/;
const DIGEST_REF = /^sha256:[a-z2-7]{52}$/;

function assertProjectId(projectId) {
  invariant(typeof projectId === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(projectId),
    "INVALID_PROJECT_ID", "project id must contain only lowercase letters, digits, dot, underscore, or dash");
}

function assertConfig(config) {
  invariant(config && config.schema === CONFIG_SCHEMA, "INVALID_CONFIG", "unsupported project config schema");
  assertProjectId(config.project_id);
  invariant(typeof config.created_at_utc === "string" && Number.isFinite(Date.parse(config.created_at_utc))
    && new Date(Date.parse(config.created_at_utc)).toISOString() === config.created_at_utc,
    "INVALID_CONFIG", "project creation time must be an ISO timestamp");
  invariant(config.canonical_profile === "agentos-canonical-json-safe-integer-v1",
    "INVALID_CONFIG", "unsupported canonical profile");
  invariant(config.object_address_profile === "hmac-sha256-project-scoped-rfc4648-base32-v1",
    "INVALID_CONFIG", "unsupported object address profile");
  invariant(config.signature_profile === "pure-ed25519-spki-pkcs8-v1",
    "INVALID_CONFIG", "unsupported signature profile");
  invariant(typeof config.public_key_sha256 === "string" && /^sha256:[a-z2-7]{52}$/.test(config.public_key_sha256),
    "INVALID_CONFIG", "invalid public key digest");
  invariant(Array.isArray(config.recovery_authorities) && config.recovery_authorities.length === 2
    && config.recovery_authorities[0].principal !== config.recovery_authorities[1].principal
    && config.recovery_authorities.every(({ principal, key_id }) => typeof principal === "string"
      && /^sha256:[a-z2-7]{52}$/.test(key_id) && key_id !== config.public_key_sha256)
    && config.recovery_authorities[0].key_id !== config.recovery_authorities[1].key_id,
  "INVALID_CONFIG", "two distinct recovery authorities independent from the signing key are required");
  invariant(typeof config.journal_authority_key_id === "string" && DIGEST_REF.test(config.journal_authority_key_id)
    && config.journal_authority_key_id !== config.public_key_sha256
    && config.recovery_authorities.every(({ key_id }) => key_id !== config.journal_authority_key_id),
  "INVALID_CONFIG", "journal authority must be a distinct bound key");
  invariant(OBJECT_REF.test(config.storage_profile_ref) && DIGEST_REF.test(config.storage_profile_digest)
    && OBJECT_REF.test(config.storage_conformance_receipt_ref)
    && DIGEST_REF.test(config.storage_conformance_receipt_digest),
  "INVALID_CONFIG", "project config must bind a storage profile and conformance receipt");
}

async function writeCreateOnly(path, bytes) {
  const temp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await link(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  await fsyncDir(resolve(path, ".."));
}

async function assertPrivateFile(path, label) {
  const info = await lstat(path);
  invariant(info.isFile() && !info.isSymbolicLink(), "INVALID_CUSTODY_FILE", `${label} must be a real regular file`);
  invariant((info.mode & 0o077) === 0, "INSECURE_CUSTODY_FILE_PERMISSIONS",
    `${label} must not be accessible by group or other users`);
}

async function assertPrivateDirectory(path, label) {
  const info = await lstat(path);
  invariant(info.isDirectory() && !info.isSymbolicLink(), "INVALID_CUSTODY_DIRECTORY", `${label} must be a real directory`);
  invariant((info.mode & 0o077) === 0, "INSECURE_CUSTODY_PERMISSIONS",
    `${label} must not be accessible by group or other users`);
}

async function ensurePrivateDirectory(path, label) {
  try { await assertPrivateDirectory(path, label); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await ensurePrivateDir(path);
    await assertPrivateDirectory(path, label);
  }
}

async function assertProjectLayout(root) {
  for (const part of ["", "config", "keys", "objects", "ledger", "ledger/events", "state", "projections", "tmp"]) {
    await assertPrivateDirectory(join(root, part), part === "" ? "project root" : `${part} custody directory`);
  }
}

function eventPath(root, sequence) {
  return join(root, "ledger", "events", `${String(sequence).padStart(20, "0")}.json`);
}

async function eventNames(root) {
  const directory = join(root, "ledger", "events");
  const names = await readdir(directory);
  const unexpected = names.filter((name) => !EVENT_NAME.test(name)).sort();
  invariant(unexpected.length === 0, "UNEXPECTED_LEDGER_ENTRY",
    `ledger event directory contains unexpected entry ${unexpected[0]}`);
  return names.sort();
}

function objectPath(root, ref) {
  invariant(OBJECT_REF.test(ref), "INVALID_OBJECT_REF", `invalid object reference ${ref}`);
  return join(root, "objects", ref.slice(4, 6), ref);
}

async function publishBootstrapJsonObject(root, projectId, addressKey, value) {
  const bytes = canonicalBytes(value);
  const ref = projectObjectRef(projectId, addressKey, bytes);
  const path = objectPath(root, ref);
  await ensurePrivateDirectory(resolve(path, ".."), "bootstrap object shard");
  await writeCreateOnly(path, bytes);
  await chmod(path, 0o600);
  return { ref, digest: sha256Ref("agentos.memory.bootstrap-object.v1", bytes) };
}

async function verifyStorageAuthority(root, config, addressKey) {
  const readBoundObject = async (ref, digest, label) => {
    const path = objectPath(root, ref);
    await assertPrivateDirectory(resolve(path, ".."), `${label} shard`);
    await assertPrivateFile(path, label);
    const bytes = await readFile(path);
    invariant(projectObjectRef(config.project_id, addressKey, bytes) === ref,
      "STORAGE_AUTHORITY_ADDRESS_MISMATCH", `${label} is not bound to this project`);
    invariant(sha256Ref("agentos.memory.bootstrap-object.v1", bytes) === digest,
      "STORAGE_AUTHORITY_DIGEST_MISMATCH", `${label} digest does not match project config`);
    let value;
    try { value = JSON.parse(bytes); } catch (error) {
      throw new MemoryError("INVALID_STORAGE_AUTHORITY", `${label} is not valid JSON`, { cause: error.message });
    }
    invariant(bytes.equals(canonicalBytes(value)), "NON_CANONICAL_STORAGE_AUTHORITY",
      `${label} is not canonical`);
    return value;
  };
  const profile = await readBoundObject(config.storage_profile_ref, config.storage_profile_digest,
    "storage profile authority");
  assertStorageProfile(profile);
  const receipt = await readBoundObject(config.storage_conformance_receipt_ref,
    config.storage_conformance_receipt_digest, "storage conformance receipt authority");
  verifyStorageConformanceReceipt(receipt, profile);
  return { profile, receipt };
}

async function collectPublicExportEntries(root, config) {
  const entries = [];
  const add = async (path, disposition = "portable_bytes") => {
    const absolute = join(root, ...path.split("/"));
    await assertPrivateFile(absolute, `export source ${path}`);
    entries.push(exportEntry({ project_id: config.project_id, path, bytes: await readFile(absolute), disposition }));
  };
  await add("config/project.json");
  for (const name of ["signing-genesis.pem", "signing-public.pem", "transition-journal.public.pem",
    ...config.recovery_authorities.map(({ principal }) => `${principal}.public.pem`)].sort()) await add(`keys/${name}`);
  for (const name of await eventNames(root)) await add(`ledger/events/${name}`, "digest_only");
  await add("state/head.json");
  await add("state/signing-key.json");

  const shardNames = await readdir(join(root, "objects"));
  for (const shard of shardNames.sort()) {
    invariant(/^[a-z2-7]{2}$/.test(shard), "INVALID_EXPORT_OBJECT_SHARD", "object custody contains an invalid shard");
    await assertPrivateDirectory(join(root, "objects", shard), `export object shard ${shard}`);
    for (const name of (await readdir(join(root, "objects", shard))).sort()) {
      invariant(OBJECT_REF.test(name) && name.slice(4, 6) === shard, "INVALID_EXPORT_OBJECT_ENTRY",
        "object custody contains an invalid entry");
      await add(`objects/${shard}/${name}`, "digest_only");
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectCustodySourceEntries(root, config) {
  const entries = [{ path: "config/project.json", classification: "public_control" }];
  const publicKeys = ["signing-genesis.pem", "signing-public.pem", "transition-journal.public.pem",
    ...config.recovery_authorities.map(({ principal }) => `${principal}.public.pem`)];
  const privateKeys = ["address.key", "signing-private.pem", "transition-journal.private.pem",
    ...config.recovery_authorities.map(({ principal }) => `${principal}.private.pem`)];
  const expectedKeys = [...publicKeys, ...privateKeys].sort();
  invariant(canonicalJson((await readdir(join(root, "keys"))).sort()) === canonicalJson(expectedKeys),
    "UNEXPECTED_CUSTODY_KEY_ENTRY", "key custody contains an unrecognized or missing entry");
  for (const name of publicKeys) entries.push({ path: `keys/${name}`, classification: "public_control" });
  for (const name of privateKeys) entries.push({ path: `keys/${name}`, classification: "private_control" });
  const stateNames = (await readdir(join(root, "state"))).sort();
  invariant(canonicalJson(stateNames) === canonicalJson(["head.json", "signing-key.json"])
    || canonicalJson(stateNames) === canonicalJson(["head.json", "signing-key.json", "writer.lock"]),
    "ACTIVE_CUSTODY_TRANSITION", "custody envelope requires quiescent state without locks or transitions");
  entries.push({ path: "state/head.json", classification: "public_control" },
    { path: "state/signing-key.json", classification: "public_control" });
  for (const name of await eventNames(root)) entries.push({ path: `ledger/events/${name}`, classification: "authority" });
  for (const shard of (await readdir(join(root, "objects"))).sort()) {
    invariant(/^[a-z2-7]{2}$/.test(shard), "INVALID_CUSTODY_OBJECT_SHARD", "object custody contains an invalid shard");
    await assertPrivateDirectory(join(root, "objects", shard), `custody object shard ${shard}`);
    for (const name of (await readdir(join(root, "objects", shard))).sort()) {
      invariant(OBJECT_REF.test(name) && name.slice(4, 6) === shard, "INVALID_CUSTODY_OBJECT_ENTRY",
        "object custody contains an invalid entry");
      entries.push({ path: `objects/${shard}/${name}`, classification: "evidence" });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function makeEventBody({ projectId, sequence, previousDigest, actor, action, subjectRef, objectRef, metadata, timestamp }) {
  invariant(typeof actor === "string" && actor.length > 0, "INVALID_ACTOR", "actor is required");
  invariant(typeof action === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(action), "INVALID_ACTION", "action must be uppercase snake case");
  invariant(typeof subjectRef === "string" && subjectRef.length > 0, "INVALID_SUBJECT", "subject reference is required");
  invariant(objectRef === null || OBJECT_REF.test(objectRef), "INVALID_OBJECT_REF", "event object reference is invalid");
  return {
    schema: EVENT_SCHEMA,
    event_id: uuidv7(Date.parse(timestamp)),
    project_id: projectId,
    sequence,
    previous_digest: previousDigest,
    recorded_at_utc: timestamp,
    actor,
    action,
    subject_ref: subjectRef,
    object_ref: objectRef,
    metadata
  };
}

function canonicalUtc(value, code, label) {
  invariant(typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value, code, `${label} must be canonical UTC`);
}

function compromiseEvidence({ projectId, keyId, generation, sequence, detectedAt, actor, sourceRefs }) {
  invariant(actor === "owner", "UNAUTHORIZED_COMPROMISE_REPORTER",
    "only the project owner may attest signing-key compromise");
  canonicalUtc(detectedAt, "INVALID_COMPROMISE_TIME", "compromise detection time");
  invariant(Array.isArray(sourceRefs) && sourceRefs.length > 0
    && sourceRefs.every((ref) => OBJECT_REF.test(ref))
    && canonicalJson(sourceRefs) === canonicalJson([...new Set(sourceRefs)].sort()),
  "INVALID_COMPROMISE_PROVENANCE", "compromise evidence requires sorted unique source object references");
  return {
    schema: COMPROMISE_EVIDENCE_SCHEMA,
    project_id: projectId,
    compromised_key_id: keyId,
    generation,
    effective_after_sequence: sequence,
    detected_at_utc: detectedAt,
    provenance: { authority: "owner-attestation", actor, source_refs: sourceRefs }
  };
}

export class MemoryProject {
  constructor(root, config, addressKey, publicKey, keyState, recoveryPublicKeys, journalPublicKey, privateKey = null) {
    this.root = resolve(root);
    this.config = config;
    this.addressKey = addressKey;
    this.publicKey = Buffer.from(publicKey);
    this.keyState = keyState;
    this.recoveryPublicKeys = recoveryPublicKeys.map((entry) => ({ ...entry, public_key: Buffer.from(entry.public_key) }));
    this.journalPublicKey = Buffer.from(journalPublicKey);
    this.privateKey = privateKey;
  }

  async verifyKeyCustody({ requirePrivate = false } = {}) {
    const configPath = join(this.root, "config", "project.json");
    await assertPrivateFile(configPath, "project config");
    invariant((await readFile(configPath)).equals(Buffer.from(`${canonicalJson(this.config)}\n`)), "CONFIG_CHANGED",
      "stored project config changed after project opening");
    const publicPath = join(this.root, "keys", "signing-public.pem");
    await assertPrivateFile(publicPath, "signing public key");
    const storedPublic = await readFile(publicPath);
    const publicKeyId = sha256Ref("agentos.memory.public-key.v1", storedPublic);
    invariant(storedPublic.equals(this.publicKey) && publicKeyId === this.keyState.active_key_id, "PUBLIC_KEY_CHANGED",
      "stored signing public key changed after project opening");
    const keyStatePath = join(this.root, "state", "signing-key.json");
    await assertPrivateFile(keyStatePath, "signing key state");
    invariant((await readFile(keyStatePath)).equals(Buffer.from(`${canonicalJson(this.keyState)}\n`)), "SIGNING_KEY_STATE_CHANGED",
      "stored signing key state changed after project opening");
    for (const authority of this.recoveryPublicKeys) {
      const path = join(this.root, "keys", `${authority.principal}.public.pem`);
      await assertPrivateFile(path, `recovery public key ${authority.principal}`);
      invariant((await readFile(path)).equals(authority.public_key), "RECOVERY_PUBLIC_KEY_CHANGED",
        `recovery public key ${authority.principal} changed after project opening`);
    }
    const journalPublicPath = join(this.root, "keys", "transition-journal.public.pem");
    await assertPrivateFile(journalPublicPath, "transition journal public key");
    invariant((await readFile(journalPublicPath)).equals(this.journalPublicKey), "JOURNAL_PUBLIC_KEY_CHANGED",
      "transition journal public key changed after project opening");
    const addressPath = join(this.root, "keys", "address.key");
    await assertPrivateFile(addressPath, "address key");
    invariant((await readFile(addressPath)).equals(Buffer.from(this.addressKey)), "ADDRESS_KEY_CHANGED",
      "stored address key changed after project opening");
    await verifyStorageAuthority(this.root, this.config, this.addressKey);
    if (requirePrivate) {
      invariant(this.privateKey !== null, "READ_ONLY", "project was opened read-only");
      const privatePath = join(this.root, "keys", "signing-private.pem");
      await assertPrivateFile(privatePath, "signing private key");
      invariant((await readFile(privatePath)).equals(Buffer.from(this.privateKey)), "PRIVATE_KEY_CHANGED",
        "stored signing private key changed after project opening");
      const journalPrivatePath = join(this.root, "keys", "transition-journal.private.pem");
      await assertPrivateFile(journalPrivatePath, "transition journal private key");
      let derivedJournalPublic;
      try { derivedJournalPublic = createPublicKey(await readFile(journalPrivatePath)).export({ type: "spki", format: "pem" }); }
      catch (error) { throw new MemoryError("INVALID_JOURNAL_PRIVATE_KEY", "stored journal private key is invalid", { cause: error.message }); }
      invariant(Buffer.from(derivedJournalPublic).equals(this.journalPublicKey), "JOURNAL_PRIVATE_KEY_MISMATCH",
        "stored journal private key does not match project authority");
    }
  }

  static async init(root, projectId) {
    assertProjectId(projectId);
    const absolute = resolve(root);
    if (await exists(absolute)) {
      const info = await lstat(absolute);
      invariant(info.isDirectory() && !info.isSymbolicLink(), "INVALID_INITIALIZATION_ROOT",
        "initialization root must be a real directory");
    } else {
      await ensurePrivateDir(absolute);
    }
    invariant(!(await exists(join(absolute, "config", "project.json"))), "ALREADY_INITIALIZED", `${absolute} is already initialized`);
    const existing = await readdir(absolute);
    invariant(existing.length === 0, "INITIALIZATION_TARGET_NOT_EMPTY",
      "initialization root must be empty; partial or unrelated contents are preserved");
    await chmod(absolute, 0o700);
    const initializationMarker = join(absolute, ".initializing");
    let markerHandle;
    try {
      markerHandle = await open(initializationMarker, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    } catch (error) {
      if (error.code === "EEXIST") throw new MemoryError("INITIALIZATION_IN_PROGRESS", "another initialization owns this root");
      throw error;
    }
    await markerHandle.writeFile(`${process.pid}\n`);
    await markerHandle.sync();
    await markerHandle.close();
    await fsyncDir(absolute);
    for (const part of ["config", "keys", "objects", "ledger/events", "state", "projections", "tmp"]) {
      await ensurePrivateDir(join(absolute, part));
    }
    const addressKey = randomBytes(32);
    const storageReceipt = await probeLocalFilesystemStorage({ root: absolute,
      fault_boundary_evidence_digest: LOCAL_FAULT_BOUNDARY_EVIDENCE_DIGEST });
    const storageProfileObject = await publishBootstrapJsonObject(absolute, projectId, addressKey,
      LOCAL_FILESYSTEM_STORAGE_PROFILE);
    const storageReceiptObject = await publishBootstrapJsonObject(absolute, projectId, addressKey, storageReceipt);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const recoveryPairs = ["recovery.primary", "recovery.secondary"].map((principal) => ({
      principal, ...generateKeyPairSync("ed25519")
    }));
    const journalPair = generateKeyPairSync("ed25519");
    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
    await atomicWrite(join(absolute, "keys", "address.key"), addressKey, 0o600);
    await atomicWrite(join(absolute, "keys", "signing-private.pem"), privatePem, 0o600);
    await atomicWrite(join(absolute, "keys", "signing-public.pem"), publicPem, 0o600);
    await atomicWrite(join(absolute, "keys", "signing-genesis.pem"), publicPem, 0o600);
    const recoveryPublicKeys = [];
    for (const pair of recoveryPairs) {
      const recoveryPublic = pair.publicKey.export({ type: "spki", format: "pem" });
      const recoveryPrivate = pair.privateKey.export({ type: "pkcs8", format: "pem" });
      await atomicWrite(join(absolute, "keys", `${pair.principal}.public.pem`), recoveryPublic, 0o600);
      await atomicWrite(join(absolute, "keys", `${pair.principal}.private.pem`), recoveryPrivate, 0o600);
      recoveryPublicKeys.push({ principal: pair.principal, public_key: Buffer.from(recoveryPublic) });
    }
    const journalPublicKey = journalPair.publicKey.export({ type: "spki", format: "pem" });
    const journalPrivateKey = journalPair.privateKey.export({ type: "pkcs8", format: "pem" });
    await atomicWrite(join(absolute, "keys", "transition-journal.public.pem"), journalPublicKey, 0o600);
    await atomicWrite(join(absolute, "keys", "transition-journal.private.pem"), journalPrivateKey, 0o600);
    const now = new Date().toISOString();
    const config = {
      schema: CONFIG_SCHEMA,
      project_id: projectId,
      created_at_utc: now,
      canonical_profile: "agentos-canonical-json-safe-integer-v1",
      object_address_profile: "hmac-sha256-project-scoped-rfc4648-base32-v1",
      signature_profile: "pure-ed25519-spki-pkcs8-v1",
      public_key_sha256: sha256Ref("agentos.memory.public-key.v1", Buffer.from(publicPem)),
      recovery_authorities: recoveryPublicKeys.map(({ principal, public_key }) => ({ principal,
        key_id: sha256Ref("agentos.memory.public-key.v1", public_key) })),
      journal_authority_key_id: sha256Ref("agentos.memory.public-key.v1", Buffer.from(journalPublicKey)),
      storage_profile_ref: storageProfileObject.ref,
      storage_profile_digest: storageProfileObject.digest,
      storage_conformance_receipt_ref: storageReceiptObject.ref,
      storage_conformance_receipt_digest: storageReceiptObject.digest
    };
    assertConfig(config);
    await atomicWrite(join(absolute, "config", "project.json"), Buffer.from(`${canonicalJson(config)}\n`));
    const keyState = {
      schema: KEY_STATE_SCHEMA,
      project_id: projectId,
      generation: 0,
      active_key_id: config.public_key_sha256,
      last_rotation_sequence: null,
      last_rotation_certificate_ref: null,
      status: "active",
      revoked_key_ids: [],
      last_revocation_sequence: null,
      last_revocation_evidence_ref: null,
      last_revocation_at_utc: null,
      last_recovery_sequence: null,
      last_recovery_certificate_ref: null
    };
    await atomicWrite(join(absolute, "state", "signing-key.json"), Buffer.from(`${canonicalJson(keyState)}\n`));
    const project = new MemoryProject(absolute, config, addressKey, publicPem, keyState, recoveryPublicKeys,
      journalPublicKey, privatePem);
    await project.commit({
      actor: "system.bootstrap",
      action: "PROJECT_INITIALIZED",
      subjectRef: `project:${projectId}`,
      objectRef: null,
      metadata: { config_digest: sha256Ref("agentos.memory.config.v1", canonicalBytes(config)) }
    });
    await rm(initializationMarker);
    await fsyncDir(absolute);
    return project;
  }

  static async open(root, { writable = false } = {}) {
    const absolute = resolve(root);
    await assertProjectLayout(absolute);
    const configPath = join(absolute, "config", "project.json");
    await assertPrivateFile(configPath, "project config");
    const config = await readJson(configPath);
    const configBytes = await readFile(configPath);
    invariant(configBytes.equals(Buffer.from(`${canonicalJson(config)}\n`)), "NON_CANONICAL_CONFIG", "project config is not canonical");
    assertConfig(config);
    const addressKeyPath = join(absolute, "keys", "address.key");
    await assertPrivateFile(addressKeyPath, "address key");
    const addressKey = await readFile(addressKeyPath);
    invariant(addressKey.length === 32, "INVALID_ADDRESS_KEY", "stored address key must be 32 bytes");
    await verifyStorageAuthority(absolute, config, addressKey);
    const earlyJournalPublicPath = join(absolute, "keys", "transition-journal.public.pem");
    await assertPrivateFile(earlyJournalPublicPath, "transition journal public key");
    const earlyJournalPublic = await readFile(earlyJournalPublicPath);
    invariant(sha256Ref("agentos.memory.public-key.v1", earlyJournalPublic) === config.journal_authority_key_id,
      "JOURNAL_PUBLIC_KEY_MISMATCH", "transition journal public key does not match config");
    const recoveredTransition = await MemoryProject.recoverPendingTransition(absolute, config, addressKey, earlyJournalPublic);
    const privateKeyPath = join(absolute, "keys", "signing-private.pem");
    const publicKeyPath = join(absolute, "keys", "signing-public.pem");
    await assertPrivateFile(publicKeyPath, "signing public key");
    const publicKey = await readFile(publicKeyPath);
    const keyStatePath = join(absolute, "state", "signing-key.json");
    await assertPrivateFile(keyStatePath, "signing key state");
    const keyState = await readJson(keyStatePath);
    invariant((await readFile(keyStatePath)).equals(Buffer.from(`${canonicalJson(keyState)}\n`)), "NON_CANONICAL_KEY_STATE",
      "signing key state is not canonical");
    invariant(keyState.schema === KEY_STATE_SCHEMA && keyState.project_id === config.project_id
      && Number.isSafeInteger(keyState.generation) && keyState.generation >= 0
      && keyState.active_key_id === sha256Ref("agentos.memory.public-key.v1", publicKey)
      && ["active", "revoked"].includes(keyState.status)
      && Array.isArray(keyState.revoked_key_ids),
    "INVALID_KEY_STATE", "signing key state does not match current public custody");
    if (writable) await assertPrivateFile(privateKeyPath, "signing private key");
    const privateKey = writable ? await readFile(privateKeyPath, "utf8") : null;
    if (privateKey !== null) {
      let derivedPublic;
      try { derivedPublic = createPublicKey(privateKey).export({ type: "spki", format: "pem" }); } catch (error) {
        throw new MemoryError("INVALID_PRIVATE_KEY", "stored signing private key is invalid", { cause: error.message });
      }
      const derivedKeyId = sha256Ref("agentos.memory.public-key.v1", Buffer.from(derivedPublic));
      invariant(derivedKeyId === keyState.active_key_id, "PRIVATE_KEY_MISMATCH",
        "stored signing private key does not match project custody");
    }
    const recoveryPublicKeys = [];
    for (const authority of config.recovery_authorities) {
      const path = join(absolute, "keys", `${authority.principal}.public.pem`);
      await assertPrivateFile(path, `recovery public key ${authority.principal}`);
      const recoveryPublic = await readFile(path);
      invariant(sha256Ref("agentos.memory.public-key.v1", recoveryPublic) === authority.key_id,
        "RECOVERY_PUBLIC_KEY_MISMATCH", `recovery public key ${authority.principal} does not match config`);
      recoveryPublicKeys.push({ principal: authority.principal, public_key: recoveryPublic });
    }
    const journalPublicPath = join(absolute, "keys", "transition-journal.public.pem");
    await assertPrivateFile(journalPublicPath, "transition journal public key");
    const journalPublicKey = await readFile(journalPublicPath);
    invariant(sha256Ref("agentos.memory.public-key.v1", journalPublicKey) === config.journal_authority_key_id,
      "JOURNAL_PUBLIC_KEY_MISMATCH", "transition journal public key does not match config");
    if (writable) {
      const journalPrivatePath = join(absolute, "keys", "transition-journal.private.pem");
      await assertPrivateFile(journalPrivatePath, "transition journal private key");
      let derivedJournalPublic;
      try { derivedJournalPublic = createPublicKey(await readFile(journalPrivatePath)).export({ type: "spki", format: "pem" }); }
      catch (error) { throw new MemoryError("INVALID_JOURNAL_PRIVATE_KEY", "stored journal private key is invalid", { cause: error.message }); }
      invariant(Buffer.from(derivedJournalPublic).equals(journalPublicKey), "JOURNAL_PRIVATE_KEY_MISMATCH",
        "stored journal private key does not match project authority");
    }
    const project = new MemoryProject(absolute, config, addressKey, publicKey, keyState, recoveryPublicKeys, journalPublicKey, privateKey);
    if (recoveredTransition) await project.verify();
    return project;
  }

  static async recoverPendingTransition(root, config, addressKey, journalPublicKey) {
    const journalPath = join(root, "state", "transition-journal.json");
    const stages = (await readdir(join(root, "state"))).filter((name) => name.startsWith("transition-")
      && name !== "transition-journal.json").sort();
    if (!(await exists(journalPath))) {
      invariant(stages.length === 0, "ORPHAN_TRANSITION_STAGE", "transition stage exists without an authenticated journal");
      return false;
    }
    const release = await acquireWriterLock(root, "system.transition-recovery");
    try {
      const journal = await readTransitionJournal(journalPath, { project_id: config.project_id,
        writer_public_key: journalPublicKey });
      const expectedStageName = `transition-${journal.base.transition_id}`;
      if (stages.length === 0) {
        invariant(journal.phases.at(-1).phase === "cleanup_complete", "TRANSITION_STAGE_MISSING",
          "transition stage is missing before authenticated cleanup completion");
        const currentStateBytes = await readFile(join(root, "state", "signing-key.json"));
        const currentState = JSON.parse(currentStateBytes);
        const currentHead = await readJson(join(root, "state", "head.json"));
        const currentPublic = await readFile(join(root, "keys", "signing-public.pem"));
        const authorityPath = eventPath(root, journal.base.authority.event_sequence);
        await assertPrivateFile(authorityPath, "journal authority event");
        const authorityDocument = await readJson(authorityPath);
        const decision = decideTransitionJournalOutcome(journal, {
          durable_event: { sequence: authorityDocument.body.sequence, digest: authorityDocument.digest,
            object_ref: authorityDocument.body.object_ref },
          durable_state: { generation: currentState.generation,
            key_id: sha256Ref("agentos.memory.public-key.v1", currentPublic), head_sequence: currentHead.sequence,
            head_digest: currentHead.digest,
            state_digest: sha256Ref("agentos.memory.signing-key-state.v1", currentStateBytes) }
        });
        invariant(decision.outcome === "cleanup_committed", "CLEANUP_STATE_MISMATCH",
          "stage-free cleanup requires the exact intended durable state");
        await rm(journalPath);
        await fsyncDir(join(root, "state"));
        return true;
      }
      invariant(stages.length === 1 && stages[0] === expectedStageName, "CONFLICTING_TRANSITION_JOURNALS",
        "journal does not have exactly one matching transition stage");
      const stage = join(root, "state", expectedStageName);
      await assertPrivateDirectory(stage, "transition stage");
      const readStage = async (name) => {
        const path = join(stage, name);
        await assertPrivateFile(path, `transition stage ${name}`);
        return readFile(path);
      };
      const priorStateBytes = await readStage("prior-state.json");
      const intendedStateBytes = await readStage("intended-state.json");
      const priorState = JSON.parse(priorStateBytes);
      const intendedState = JSON.parse(intendedStateBytes);
      invariant(priorStateBytes.equals(Buffer.from(`${canonicalJson(priorState)}\n`))
        && intendedStateBytes.equals(Buffer.from(`${canonicalJson(intendedState)}\n`)),
      "NON_CANONICAL_TRANSITION_STAGE", "staged key state is not canonical");
      invariant(sha256Ref("agentos.memory.signing-key-state.v1", priorStateBytes) === journal.base.prior.state_digest
        && sha256Ref("agentos.memory.signing-key-state.v1", intendedStateBytes) === journal.base.intended.state_digest,
      "TRANSITION_STAGE_DIGEST_MISMATCH", "staged key state does not match journal");
      const priorPublic = await readStage("prior-public.pem");
      const priorPrivate = await readStage("prior-private.pem");
      const intendedPublic = await readStage("intended-public.pem");
      const intendedPrivate = await readStage("intended-private.pem");
      const priorId = sha256Ref("agentos.memory.public-key.v1", priorPublic);
      const intendedId = sha256Ref("agentos.memory.public-key.v1", intendedPublic);
      invariant(priorId === journal.base.prior.key_id && intendedId === journal.base.intended.key_id
        && sha256Ref("agentos.memory.public-key.v1", Buffer.from(createPublicKey(priorPrivate).export({ type: "spki", format: "pem" }))) === priorId
        && sha256Ref("agentos.memory.public-key.v1", Buffer.from(createPublicKey(intendedPrivate).export({ type: "spki", format: "pem" }))) === intendedId,
      "TRANSITION_STAGE_KEY_MISMATCH", "staged keys do not match authenticated journal identities");
      const currentStatePath = join(root, "state", "signing-key.json");
      const currentStateBytes = await readFile(currentStatePath);
      const currentState = JSON.parse(currentStateBytes);
      const currentHead = await readJson(join(root, "state", "head.json"));
      const currentPublic = await readFile(join(root, "keys", "signing-public.pem"));
      const durableState = { generation: currentState.generation,
        key_id: sha256Ref("agentos.memory.public-key.v1", currentPublic), head_sequence: currentHead.sequence,
        head_digest: currentHead.digest,
        state_digest: sha256Ref("agentos.memory.signing-key-state.v1", currentStateBytes) };
      const authorityPath = eventPath(root, journal.base.authority.event_sequence);
      let durableEvent = null;
      let authorityDocument = null;
      if (await exists(authorityPath)) {
        await assertPrivateFile(authorityPath, "journal authority event");
        const raw = await readFile(authorityPath);
        authorityDocument = JSON.parse(raw);
        invariant(raw.equals(Buffer.from(`${canonicalJson(authorityDocument)}\n`)), "NON_CANONICAL_EVENT",
          "journal authority event is not canonical");
        durableEvent = { sequence: authorityDocument.body.sequence, digest: authorityDocument.digest,
          object_ref: authorityDocument.body.object_ref };
        const eventBytes = canonicalBytes(authorityDocument.body);
        invariant(sha256Ref("agentos.memory.event.v1", eventBytes) === authorityDocument.digest
          && authorityDocument.body.previous_digest === journal.base.prior.head_digest,
        "JOURNAL_AUTHORITY_EVENT_MISMATCH", "authority event digest or predecessor is wrong");
        const verificationPublic = journal.base.transition_kind === "recovery" ? intendedPublic : priorPublic;
        invariant(verify(null, eventBytes, verificationPublic, Buffer.from(authorityDocument.signature, "base64url")),
          "JOURNAL_AUTHORITY_SIGNATURE_INVALID", "authority event signature is invalid");
        const objectFile = objectPath(root, authorityDocument.body.object_ref);
        await assertPrivateFile(objectFile, "journal authority object");
        const objectBytes = await readFile(objectFile);
        invariant(projectObjectRef(config.project_id, addressKey, objectBytes) === authorityDocument.body.object_ref,
          "OBJECT_DIGEST_MISMATCH", "journal authority object failed project address verification");
      }
      const decision = decideTransitionJournalOutcome(journal, { durable_event: durableEvent, durable_state: durableState });
      if (decision.outcome === "finalize_intended") {
        const intendedHead = { schema: HEAD_SCHEMA, project_id: config.project_id,
          sequence: journal.base.intended.head_sequence, digest: journal.base.intended.head_digest };
        await atomicWrite(join(root, "keys", "signing-public.pem"), intendedPublic, 0o600);
        await atomicWrite(join(root, "keys", "signing-private.pem"), intendedPrivate, 0o600);
        await atomicWrite(currentStatePath, intendedStateBytes);
        await atomicWrite(join(root, "state", "head.json"), Buffer.from(`${canonicalJson(intendedHead)}\n`));
      }
      await rm(journalPath);
      await rm(stage, { recursive: true });
      await fsyncDir(join(root, "state"));
      return true;
    } finally { await release(); }
  }

  async putBytes(bytes) {
    invariant(Buffer.isBuffer(bytes), "INVALID_OBJECT", "object body must be a Buffer");
    await assertProjectLayout(this.root);
    await this.verifyKeyCustody();
    const ref = projectObjectRef(this.config.project_id, this.addressKey, bytes);
    const path = objectPath(this.root, ref);
    await assertPrivateDirectory(join(this.root, "objects"), "object custody root");
    await ensurePrivateDirectory(resolve(path, ".."), "object shard directory");
    if (await exists(path)) {
      await assertPrivateFile(path, "object file");
      const current = await readFile(path);
      invariant(current.equals(bytes), "OBJECT_COLLISION", `object address collision for ${ref}`);
      return ref;
    }
    try { await writeCreateOnly(path, bytes); } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await assertPrivateFile(path, "object file");
      const current = await readFile(path);
      invariant(current.equals(bytes), "OBJECT_COLLISION", `object address collision for ${ref}`);
    }
    await chmod(path, 0o600);
    return ref;
  }

  async putJson(value) {
    return this.putBytes(canonicalBytes(value));
  }

  async getBytes(ref) {
    await assertProjectLayout(this.root);
    await this.verifyKeyCustody();
    const path = objectPath(this.root, ref);
    await assertPrivateDirectory(join(this.root, "objects"), "object custody root");
    await assertPrivateDirectory(resolve(path, ".."), "object shard directory");
    await assertPrivateFile(path, "object file");
    const bytes = await readFile(path);
    const computed = projectObjectRef(this.config.project_id, this.addressKey, bytes);
    invariant(computed === ref, "OBJECT_DIGEST_MISMATCH", `object ${ref} failed address verification`);
    return bytes;
  }

  async getJson(ref) {
    const bytes = await this.getBytes(ref);
    let value;
    try { value = JSON.parse(bytes.toString("utf8")); } catch (error) {
      throw new MemoryError("INVALID_OBJECT_JSON", `object ${ref} is not JSON`, { cause: error.message });
    }
    invariant(canonicalBytes(value).equals(bytes), "NON_CANONICAL_OBJECT", `object ${ref} is not canonical JSON`);
    return value;
  }

  async listEvents() {
    await assertProjectLayout(this.root);
    const directory = join(this.root, "ledger", "events");
    const names = await eventNames(this.root);
    const events = [];
    for (const name of names) events.push(await readJson(join(directory, name)));
    return events;
  }

  async verifyEvents() {
    await assertProjectLayout(this.root);
    await this.verifyKeyCustody();
    const directory = join(this.root, "ledger", "events");
    const names = await eventNames(this.root);
    const genesisKeyPath = join(this.root, "keys", "signing-genesis.pem");
    await assertPrivateFile(genesisKeyPath, "genesis signing public key");
    let activePublicPem = await readFile(genesisKeyPath, "utf8");
    let activeKeyId = sha256Ref("agentos.memory.public-key.v1", Buffer.from(activePublicPem));
    invariant(activeKeyId === this.config.public_key_sha256, "GENESIS_KEY_MISMATCH",
      "genesis signing key does not match project config");
    let generation = 0;
    let lastRotationSequence = null;
    let lastRotationCertificateRef = null;
    let status = "active";
    const revokedKeyIds = [];
    let lastRevocationSequence = null;
    let lastRevocationEvidenceRef = null;
    let lastRevocationAtUtc = null;
    let lastRecoverySequence = null;
    let lastRecoveryCertificateRef = null;
    let priorRecordedAt = null;
    const events = [];
    const custodyRecipients = new Map();
    const custodyEnvelopeAdmissions = new Map();
    const custodyNonceAdmissions = new Map();
    const custodyImportStages = new Map();
    const custodyImportDisposals = new Map();
    let previous = null;
    for (let index = 0; index < names.length; index += 1) {
      const path = join(directory, names[index]);
      await assertPrivateFile(path, `ledger event ${index + 1}`);
      const raw = await readFile(path);
      let document;
      try { document = JSON.parse(raw.toString("utf8")); } catch (error) {
        throw new MemoryError("INVALID_EVENT_JSON", `event ${index + 1} is not valid JSON`, { cause: error.message });
      }
      invariant(raw.equals(Buffer.from(`${canonicalJson(document)}\n`)), "NON_CANONICAL_EVENT", `event ${index + 1} is not canonical`);
      const expectedSequence = index + 1;
      invariant(Number(EVENT_NAME.exec(names[index])[1]) === expectedSequence, "SEQUENCE_GAP", `expected event file ${expectedSequence}`);
      invariant(document.body?.sequence === expectedSequence, "SEQUENCE_GAP", `expected event sequence ${expectedSequence}`);
      invariant(document.body.schema === EVENT_SCHEMA, "EVENT_SCHEMA", `event ${expectedSequence} has unsupported schema`);
      invariant(document.body.project_id === this.config.project_id, "WRONG_PROJECT", `event ${expectedSequence} belongs to another project`);
      invariant(document.body.previous_digest === previous, "CHAIN_MISMATCH", `event ${expectedSequence} has the wrong predecessor`);
      canonicalUtc(document.body.recorded_at_utc, "INVALID_EVENT_TIME", `event ${expectedSequence} time`);
      invariant(priorRecordedAt === null || document.body.recorded_at_utc >= priorRecordedAt,
        "EVENT_TIME_ROLLBACK", `event ${expectedSequence} time moved backwards`);
      const bytes = canonicalBytes(document.body);
      const digest = sha256Ref("agentos.memory.event.v1", bytes);
      invariant(document.digest === digest, "EVENT_DIGEST_MISMATCH", `event ${expectedSequence} digest mismatch`);
      invariant(document.signature_profile === "pure-ed25519-v1", "SIGNATURE_PROFILE", "unsupported signature profile");
      let verificationKey = activePublicPem;
      let verificationKeyId = activeKeyId;
      let recovery = null;
      let recoveryCertificate = null;
      if (document.body.action === "SIGNING_KEY_EMERGENCY_RECOVERED") {
        invariant(status === "revoked", "PREMATURE_RECOVERY", "emergency recovery requires an established revocation");
        invariant(document.body.object_ref !== null, "RECOVERY_CERTIFICATE_MISSING", "recovery event has no certificate");
        recoveryCertificate = await this.getJson(document.body.object_ref);
        recovery = verifyEmergencyRecoveryCertificate(recoveryCertificate, {
          project_id: this.config.project_id,
          compromised_key_id: activeKeyId,
          compromised_generation: generation,
          revocation_evidence_ref: lastRevocationEvidenceRef,
          recovery_event_sequence: expectedSequence,
          recovery_authorities: this.recoveryPublicKeys
        });
        invariant(recoveryCertificate.body.created_at_utc >= lastRevocationAtUtc
          && recoveryCertificate.body.created_at_utc <= document.body.recorded_at_utc,
        "RECOVERY_TIME_ORDER", "recovery must follow revocation and not postdate its event");
        verificationKey = recovery.next_public_key_pem;
        verificationKeyId = recovery.next_key_id;
      } else {
        invariant(status === "active", "REVOKED_KEY_USE",
          `event ${expectedSequence} appears after the signing key was revoked`);
      }
      invariant(document.signing_key_id === verificationKeyId,
        "SIGNING_KEY_ID", `event ${expectedSequence} signing key identity mismatch`);
      invariant(verify(null, bytes, verificationKey, Buffer.from(document.signature, "base64url")),
        "SIGNATURE_INVALID", `event ${expectedSequence} signature invalid`);
      if (document.body.object_ref !== null) await this.getBytes(document.body.object_ref);
      if (document.body.action === "SIGNING_KEY_ROTATED") {
        invariant(document.body.object_ref !== null, "ROTATION_CERTIFICATE_MISSING",
          `rotation event ${expectedSequence} has no certificate`);
        const certificate = await this.getJson(document.body.object_ref);
        const advanced = advanceSigningKey(certificate, {
          project_id: this.config.project_id,
          current_public_key: activePublicPem,
          rotation_event_sequence: expectedSequence
        });
        const expectedMetadata = {
          previous_key_id: activeKeyId,
          next_key_id: advanced.active_key_id,
          generation: generation + 1
        };
        invariant(canonicalJson(document.body.metadata) === canonicalJson(expectedMetadata),
          "ROTATION_METADATA_MISMATCH", `rotation event ${expectedSequence} metadata mismatch`);
        activePublicPem = advanced.active_public_key_pem;
        activeKeyId = advanced.active_key_id;
        generation += 1;
        lastRotationSequence = expectedSequence;
        lastRotationCertificateRef = document.body.object_ref;
      } else if (document.body.action === "SIGNING_KEY_COMPROMISED") {
        invariant(document.body.object_ref !== null, "COMPROMISE_EVIDENCE_MISSING",
          `compromise event ${expectedSequence} has no evidence`);
        const evidence = await this.getJson(document.body.object_ref);
        const expectedEvidence = compromiseEvidence({
          projectId: this.config.project_id,
          keyId: activeKeyId,
          generation,
          sequence: expectedSequence,
          detectedAt: evidence.detected_at_utc,
          actor: document.body.actor,
          sourceRefs: evidence.provenance?.source_refs
        });
        invariant(canonicalJson(evidence) === canonicalJson(expectedEvidence), "INVALID_COMPROMISE_EVIDENCE",
          `compromise event ${expectedSequence} evidence is mismatched or unsupported`);
        invariant(priorRecordedAt === null || evidence.detected_at_utc >= priorRecordedAt,
          "PREMATURE_COMPROMISE_EVIDENCE", "compromise evidence predates established ledger history");
        invariant(evidence.detected_at_utc <= document.body.recorded_at_utc,
          "FUTURE_COMPROMISE_EVIDENCE", "compromise evidence postdates its authority event");
        for (const ref of evidence.provenance.source_refs) await this.getBytes(ref);
        const expectedMetadata = {
          compromised_key_id: activeKeyId,
          generation,
          effective_after_sequence: expectedSequence
        };
        invariant(canonicalJson(document.body.metadata) === canonicalJson(expectedMetadata),
          "COMPROMISE_METADATA_MISMATCH", `compromise event ${expectedSequence} metadata mismatch`);
        status = "revoked";
        revokedKeyIds.push(activeKeyId);
        lastRevocationSequence = expectedSequence;
        lastRevocationEvidenceRef = document.body.object_ref;
        lastRevocationAtUtc = evidence.detected_at_utc;
      } else if (document.body.action === "SIGNING_KEY_EMERGENCY_RECOVERED") {
        const expectedMetadata = { compromised_key_id: activeKeyId, compromised_generation: generation,
          revocation_evidence_ref: lastRevocationEvidenceRef, next_key_id: recovery.next_key_id,
          generation: generation + 1 };
        invariant(canonicalJson(document.body.metadata) === canonicalJson(expectedMetadata),
          "RECOVERY_METADATA_MISMATCH", `recovery event ${expectedSequence} metadata mismatch`);
        activePublicPem = recovery.next_public_key_pem;
        activeKeyId = recovery.next_key_id;
        generation += 1;
        status = "active";
        lastRecoverySequence = expectedSequence;
        lastRecoveryCertificateRef = document.body.object_ref;
      }
      if (Object.values(RECIPIENT_ACTIONS).includes(document.body.action)) {
        invariant(document.body.object_ref !== null, "RECIPIENT_AUTHORITY_OBJECT_MISSING",
          `recipient authority event ${expectedSequence} has no object`);
        const record = await this.getJson(document.body.object_ref);
        const current = custodyRecipients.get(record.recipient_id) ?? null;
        custodyRecipients.set(record.recipient_id, applyRecipientAuthorityEvent(current, record, document.body));
      }
      if (document.body.action === CUSTODY_ADMISSION_ACTION) {
        invariant(document.body.object_ref !== null, "CUSTODY_ADMISSION_OBJECT_MISSING",
          `custody admission event ${expectedSequence} has no object`);
        const record = await this.getJson(document.body.object_ref);
        applyCustodyAdmissionEvent({ envelopeAdmissions: custodyEnvelopeAdmissions,
          nonceAdmissions: custodyNonceAdmissions }, record, document.body,
        custodyRecipients.get(record.recipient_id));
      }
      if (document.body.action === IMPORT_STAGE_ACTION) {
        invariant(document.body.object_ref !== null, "IMPORT_STAGE_OBJECT_MISSING",
          `custody import stage event ${expectedSequence} has no object`);
        const record = await this.getJson(document.body.object_ref);
        applyImportStageEvent(custodyImportStages, record, document.body,
          custodyEnvelopeAdmissions.get(record.envelope_id));
      }
      if (Object.values(IMPORT_DISPOSAL_ACTIONS).includes(document.body.action)) {
        invariant(document.body.object_ref !== null, "IMPORT_DISPOSAL_OBJECT_MISSING",
          `custody import disposal event ${expectedSequence} has no object`);
        const record = await this.getJson(document.body.object_ref);
        applyImportDisposalEvent(custodyImportDisposals, record, document.body,
          custodyImportStages.get(record.envelope_id));
      }
      previous = digest;
      priorRecordedAt = document.body.recorded_at_utc;
      events.push(document);
    }
    invariant(events.length > 0, "EMPTY_LEDGER", "ledger has no genesis event");
    const genesis = events[0].body;
    invariant(genesis.actor === "system.bootstrap" && genesis.action === "PROJECT_INITIALIZED",
      "INVALID_GENESIS", "ledger must begin with the bootstrap initialization event");
    invariant(genesis.subject_ref === `project:${this.config.project_id}` && genesis.object_ref === null,
      "INVALID_GENESIS", "genesis project binding is invalid");
    const configDigest = sha256Ref("agentos.memory.config.v1", canonicalBytes(this.config));
    invariant(genesis.metadata?.config_digest === configDigest,
      "GENESIS_CONFIG_MISMATCH", "project config does not match the signed genesis binding");
    const replayedKeyState = {
      schema: KEY_STATE_SCHEMA,
      project_id: this.config.project_id,
      generation,
      active_key_id: activeKeyId,
      last_rotation_sequence: lastRotationSequence,
      last_rotation_certificate_ref: lastRotationCertificateRef,
      status,
      revoked_key_ids: revokedKeyIds,
      last_revocation_sequence: lastRevocationSequence,
      last_revocation_evidence_ref: lastRevocationEvidenceRef,
      last_revocation_at_utc: lastRevocationAtUtc,
      last_recovery_sequence: lastRecoverySequence,
      last_recovery_certificate_ref: lastRecoveryCertificateRef
    };
    invariant(canonicalJson(replayedKeyState) === canonicalJson(this.keyState), "SIGNING_KEY_STATE_MISMATCH",
      "activated signing key state does not match deterministic ledger replay");
    return { events, digest: previous, key_state: replayedKeyState,
      custody_recipients: Object.fromEntries([...custodyRecipients.entries()].sort(([a], [b]) => a.localeCompare(b))),
      custody_envelope_admissions: Object.fromEntries([...custodyEnvelopeAdmissions.entries()]
        .sort(([a], [b]) => a.localeCompare(b))),
      custody_nonce_admissions: Object.fromEntries([...custodyNonceAdmissions.entries()]
        .sort(([a], [b]) => a.localeCompare(b))),
      custody_import_stages: Object.fromEntries([...custodyImportStages.entries()]
        .sort(([a], [b]) => a.localeCompare(b))),
      custody_import_disposals: Object.fromEntries([...custodyImportDisposals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))) };
  }

  async verify() {
    const { events, digest } = await this.verifyEvents();
    const expectedHead = { schema: HEAD_SCHEMA, project_id: this.config.project_id, sequence: events.length, digest };
    const headPath = join(this.root, "state", "head.json");
    await assertPrivateFile(headPath, "published ledger head");
    const head = await readJson(headPath);
    invariant(canonicalJson(head) === canonicalJson(expectedHead), "HEAD_MISMATCH", "published head does not match replayed ledger");
    return { ok: true, project_id: this.config.project_id, event_count: events.length, head_digest: digest };
  }

  async createPublicExportManifest() {
    invariant(this.privateKey !== null, "READ_ONLY", "public export signing requires writable project custody");
    invariant(this.keyState.status === "active", "SIGNING_KEY_REVOKED", "revoked project custody cannot sign an export");
    const verified = await this.verify();
    await this.verifyKeyCustody({ requirePrivate: true });
    const sourceHead = { sequence: verified.event_count, digest: verified.head_digest };
    const manifest = createExportManifest({ project_id: this.config.project_id, source_head: sourceHead,
      storage_profile_ref: this.config.storage_profile_ref,
      storage_profile_digest: this.config.storage_profile_digest,
      storage_conformance_receipt_ref: this.config.storage_conformance_receipt_ref,
      storage_conformance_receipt_digest: this.config.storage_conformance_receipt_digest,
      entries: await collectPublicExportEntries(this.root, this.config),
      signing_key_id: this.keyState.active_key_id, signing_private_key: this.privateKey });
    await this.verifyPublicExportManifest(manifest);
    return manifest;
  }

  async verifyPublicExportManifest(manifest) {
    const verified = await this.verify();
    const sourceHead = { sequence: verified.event_count, digest: verified.head_digest };
    return verifyExportManifest(manifest, { project_id: this.config.project_id, source_head: sourceHead,
      storage_profile_ref: this.config.storage_profile_ref,
      storage_profile_digest: this.config.storage_profile_digest,
      storage_conformance_receipt_ref: this.config.storage_conformance_receipt_ref,
      storage_conformance_receipt_digest: this.config.storage_conformance_receipt_digest,
      signing_key_id: this.keyState.active_key_id, signing_public_key: this.publicKey,
      expected_entries: await collectPublicExportEntries(this.root, this.config) });
  }

  async materializePublicExportBundle(targetRoot, { fault_after_entries: faultAfterEntries = null } = {}) {
    const manifest = await this.createPublicExportManifest();
    const receipt = await materializeExportBundle({ source_root: this.root, target_root: targetRoot, manifest,
      fault_after_entries: faultAfterEntries });
    await this.verifyPublicExportBundle(targetRoot);
    return { ...receipt, manifest };
  }

  async verifyPublicExportBundle(targetRoot) {
    const manifestPath = join(resolve(targetRoot), "manifest.json");
    await assertPrivateFile(manifestPath, "export bundle manifest");
    const manifestHandle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let manifestBytes;
    try { manifestBytes = await manifestHandle.readFile(); } finally { await manifestHandle.close(); }
    let manifest;
    try { manifest = JSON.parse(manifestBytes); } catch (error) {
      throw new MemoryError("INVALID_EXPORT_BUNDLE_MANIFEST", "bundle manifest is invalid JSON", { cause: error.message });
    }
    await this.verifyPublicExportManifest(manifest);
    return verifyExportBundle({ target_root: targetRoot, manifest });
  }

  async transitionCustodyRecipient({ recipientId, transition, publicKey = null, reason, actor = "owner" }) {
    invariant(this.privateKey !== null, "READ_ONLY", "recipient authority transition requires writable project custody");
    invariant(actor === "owner", "UNAUTHORIZED_RECIPIENT_AUTHORITY", "recipient authority requires owner custody");
    const release = await acquireWriterLock(this.root, actor);
    try {
      const replay = await this.verifyEvents();
      const current = replay.custody_recipients[recipientId] ?? null;
      const record = createRecipientAuthority({ project_id: this.config.project_id, recipient_id: recipientId,
        recipient_public_key: publicKey, transition, current, reason });
      const authorityRef = await this.putJson(record);
      const event = await this.commitLocked({ actor, action: RECIPIENT_ACTIONS[transition],
        subjectRef: `custody-recipient:${recipientId}`, objectRef: authorityRef,
        metadata: recipientAuthorityMetadata(record) });
      return { ...record, authority_ref: authorityRef, event_sequence: event.body.sequence, event };
    } finally { await release(); }
  }

  async registerCustodyRecipient({ recipient_id: recipientId, recipient_public_key: publicKey, reason, actor = "owner" }) {
    return this.transitionCustodyRecipient({ recipientId, transition: "register", publicKey, reason, actor });
  }

  async rotateCustodyRecipient({ recipient_id: recipientId, recipient_public_key: publicKey, reason, actor = "owner" }) {
    return this.transitionCustodyRecipient({ recipientId, transition: "rotate", publicKey, reason, actor });
  }

  async revokeCustodyRecipient({ recipient_id: recipientId, reason, actor = "owner" }) {
    return this.transitionCustodyRecipient({ recipientId, transition: "revoke", reason, actor });
  }

  async resolveCustodyRecipient(recipientId, { requireActive = true } = {}) {
    const replay = await this.verifyEvents();
    const recipient = replay.custody_recipients[recipientId];
    invariant(recipient, "RECIPIENT_AUTHORITY_MISSING", "recipient has no project authority");
    if (requireActive) invariant(recipient.status === "active", "RECIPIENT_AUTHORITY_REVOKED", "recipient authority is revoked");
    return recipient;
  }

  async createRecipientCustodyEnvelope(targetRoot, { recipient_id: recipientId,
    purpose = "project-custody-transfer",
    expires_at_utc: expiresAtUtc, fault_after_boundary: faultAfterBoundary = null }) {
    invariant(this.privateKey !== null, "READ_ONLY", "custody-envelope creation requires writable project custody");
    invariant(this.keyState.status === "active", "SIGNING_KEY_REVOKED", "revoked project custody cannot sign an envelope");
    const release = await acquireWriterLock(this.root, "system.custody-envelope");
    try {
      const replay = await this.verifyEvents();
      const recipient = replay.custody_recipients[recipientId];
      invariant(recipient, "RECIPIENT_AUTHORITY_MISSING", "recipient has no project authority");
      invariant(recipient.status === "active", "RECIPIENT_AUTHORITY_REVOKED", "recipient authority is revoked");
      const verified = await this.verify();
      const publicManifest = await this.createPublicExportManifest();
      const publicManifestDigest = sha256Ref("agentos.memory.public-export-manifest.v1", canonicalBytes(publicManifest));
      return await createCustodyEnvelope({ source_root: this.root, target_root: targetRoot,
        project_id: this.config.project_id, purpose, expires_at_utc: expiresAtUtc,
        recipient_public_key: Buffer.from(recipient.public_key_pem), recipient_key_id: recipient.key_id,
        recipient_generation: recipient.generation, recipient_authority_ref: recipient.authority_ref,
        source_head: { sequence: verified.event_count, digest: verified.head_digest },
        source_key_generation: this.keyState.generation, signing_key_id: this.keyState.active_key_id,
        signing_private_key: this.privateKey, storage_profile_ref: this.config.storage_profile_ref,
        storage_profile_digest: this.config.storage_profile_digest,
        storage_conformance_receipt_ref: this.config.storage_conformance_receipt_ref,
        storage_conformance_receipt_digest: this.config.storage_conformance_receipt_digest,
        public_manifest_digest: publicManifestDigest, entries: await collectCustodySourceEntries(this.root, this.config),
        fault_after_boundary: faultAfterBoundary });
    } finally { await release(); }
  }

  async inspectRecipientCustodyEnvelope(targetRoot, { recipient_id: recipientId,
    recipient_private_key: recipientPrivateKey,
    purpose = "project-custody-transfer" }) {
    invariant(this.privateKey !== null, "READ_ONLY", "custody-envelope admission requires writable project custody");
    const release = await acquireWriterLock(this.root, "system.custody-envelope");
    try {
      const replay = await this.verifyEvents();
      const recipient = replay.custody_recipients[recipientId];
      invariant(recipient, "RECIPIENT_AUTHORITY_MISSING", "recipient has no project authority");
      invariant(recipient.status === "active", "RECIPIENT_AUTHORITY_REVOKED", "recipient authority is revoked");
      const claim = await readCustodyEnvelopeAdmissionClaim(targetRoot);
      invariant(claim.project_id === this.config.project_id, "CUSTODY_ENVELOPE_CONTEXT_MISMATCH",
        "custody envelope belongs to another project");
      invariant(!replay.custody_envelope_admissions[claim.envelope_id], "DUPLICATE_CUSTODY_ENVELOPE",
        "custody envelope was already consumed");
      invariant(!replay.custody_nonce_admissions[claim.nonce_identity], "DUPLICATE_CUSTODY_NONCE",
        "custody recipient nonce was already consumed");
      const verified = await this.verify();
      const publicManifest = await this.createPublicExportManifest();
      const inspected = await inspectCustodyEnvelope({ target_root: targetRoot,
        recipient_private_key: recipientPrivateKey,
        recipient_public_key: Buffer.from(recipient.public_key_pem), recipient_generation: recipient.generation,
        signing_public_key: this.publicKey, replay_guard: new Set(),
        expected: { project_id: this.config.project_id, purpose,
          recipient_authority_ref: recipient.authority_ref,
          source_head: { sequence: verified.event_count, digest: verified.head_digest },
          source_key_generation: this.keyState.generation, signing_key_id: this.keyState.active_key_id,
          storage_profile_ref: this.config.storage_profile_ref,
          storage_profile_digest: this.config.storage_profile_digest,
          storage_conformance_receipt_ref: this.config.storage_conformance_receipt_ref,
          storage_conformance_receipt_digest: this.config.storage_conformance_receipt_digest,
          public_manifest_digest: sha256Ref("agentos.memory.public-export-manifest.v1", canonicalBytes(publicManifest)) } });
      const admission = createCustodyAdmission({ project_id: this.config.project_id, recipient_id: recipientId,
        recipient_key_id: recipient.key_id, recipient_generation: recipient.generation,
        recipient_authority_ref: recipient.authority_ref, envelope_id: inspected.envelope_id,
        nonce_identity: inspected.nonce_identity, source_head: inspected.source_head });
      const admissionRef = await this.putJson(admission);
      const event = await this.commitLocked({ actor: "system.custody-envelope", action: CUSTODY_ADMISSION_ACTION,
        subjectRef: `custody-envelope:${admission.envelope_id}`, objectRef: admissionRef,
        metadata: custodyAdmissionMetadata(admission) });
      return { ...inspected, admission_ref: admissionRef, admission_event_sequence: event.body.sequence };
    } finally { await release(); }
  }

  async stageRecipientCustodyImport(envelopeRoot, stagingRoot, { recipient_id: recipientId,
    recipient_private_key: recipientPrivateKey, purpose = "project-custody-transfer",
    fault_after_boundary: faultAfterBoundary = null, recover_interrupted: recoverInterrupted = false }) {
    invariant(this.privateKey !== null, "READ_ONLY", "custody import staging requires writable project custody");
    const projectRoot = resolve(this.root);
    const envelope = resolve(envelopeRoot);
    const staging = resolve(stagingRoot);
    invariant(relative(projectRoot, staging).startsWith("..") && relative(staging, projectRoot).startsWith("..")
      && relative(envelope, staging).startsWith("..") && relative(staging, envelope).startsWith(".."),
    "CUSTODY_IMPORT_ROOT_OVERLAP", "custody import staging must be disjoint from project and envelope custody");
    const release = await acquireWriterLock(this.root, "system.custody-import");
    try {
      const replay = await this.verifyEvents();
      const claim = await readCustodyEnvelopeAdmissionClaim(envelopeRoot);
      invariant(claim.project_id === this.config.project_id, "CUSTODY_ENVELOPE_CONTEXT_MISMATCH",
        "custody envelope belongs to another project");
      const admission = replay.custody_envelope_admissions[claim.envelope_id];
      invariant(admission && admission.nonce_identity === claim.nonce_identity
        && admission.recipient_authority_ref === claim.recipient_authority_ref
        && canonicalJson(admission.source_head) === canonicalJson(claim.source_head),
      "UNADMITTED_CUSTODY_IMPORT", "custody import requires exact durable envelope admission");
      const priorStage = replay.custody_import_stages[claim.envelope_id] ?? null;
      if (priorStage) invariant(recoverInterrupted && !(await exists(staging)), "REPLAYED_CUSTODY_IMPORT",
        "custody envelope was already staged or recovery was not explicitly requested");
      const recipient = replay.custody_recipients[recipientId];
      invariant(recipient && recipient.status === "active" && recipient.authority_ref === claim.recipient_authority_ref
        && recipient.key_id === claim.recipient_key_id && recipient.generation === claim.recipient_generation,
      "STALE_CUSTODY_RECIPIENT_AUTHORITY", "custody import recipient authority is stale, wrong, or revoked");
      invariant(claim.signing_key_id === this.keyState.active_key_id
        && claim.source_key_generation === this.keyState.generation,
      "STALE_CUSTODY_SOURCE_KEY", "custody import source signing generation is no longer active");
      invariant(claim.storage_profile_ref === this.config.storage_profile_ref
        && claim.storage_profile_digest === this.config.storage_profile_digest
        && claim.storage_conformance_receipt_ref === this.config.storage_conformance_receipt_ref
        && claim.storage_conformance_receipt_digest === this.config.storage_conformance_receipt_digest,
      "CUSTODY_IMPORT_STORAGE_MISMATCH", "custody import storage authority is mismatched");
      const receiptContext = { admission_ref: admission.admission_ref,
        admission_event_sequence: admission.event_sequence };
      let stageRecord = priorStage;
      let stageEventSequence = priorStage?.event_sequence ?? null;
      const inspected = await inspectCustodyEnvelope({ target_root: envelopeRoot,
        recipient_private_key: recipientPrivateKey, recipient_public_key: Buffer.from(recipient.public_key_pem),
        recipient_generation: recipient.generation, signing_public_key: this.publicKey, replay_guard: new Set(),
        staging_root: stagingRoot, staging_fault_after_boundary: faultAfterBoundary,
        staging_receipt_context: receiptContext,
        staging_validator: async (payloadRoot) => {
          await ensurePrivateDir(join(payloadRoot, "projections", "current"));
          await ensurePrivateDir(join(payloadRoot, "tmp", "runs"));
          const candidate = await MemoryProject.open(payloadRoot, { writable: false });
          const candidateProof = await candidate.verify();
          invariant(candidateProof.project_id === this.config.project_id
            && candidateProof.event_count === claim.source_head.sequence
            && candidateProof.head_digest === claim.source_head.digest,
          "CUSTODY_IMPORT_LINEAGE_MISMATCH", "staged custody snapshot does not match admitted source lineage");
        },
        staging_before_publish: async (result) => {
          if (priorStage) {
            invariant(priorStage.payload_manifest_digest === result.payload_manifest_digest
              && priorStage.entry_count === result.entry_count,
            "CUSTODY_IMPORT_RECOVERY_MISMATCH", "recovered import candidate differs from signed stage record");
          } else {
            stageRecord = createImportStageRecord({ project_id: this.config.project_id,
              envelope_id: claim.envelope_id, admission_ref: admission.admission_ref,
              recipient_authority_ref: recipient.authority_ref, recipient_generation: recipient.generation,
              nonce_identity: claim.nonce_identity, source_head: claim.source_head,
              payload_manifest_digest: result.payload_manifest_digest, entry_count: result.entry_count });
            const stageRef = await this.putJson(stageRecord);
            const event = await this.commitLocked({ actor: "system.custody-import", action: IMPORT_STAGE_ACTION,
              subjectRef: `custody-import:${stageRecord.envelope_id}`, objectRef: stageRef,
              metadata: importStageMetadata(stageRecord) });
            stageRecord = { ...stageRecord, stage_ref: stageRef, event_sequence: event.body.sequence };
            stageEventSequence = event.body.sequence;
          }
          receiptContext.stage_ref = stageRecord.stage_ref;
          receiptContext.stage_event_sequence = stageEventSequence;
        },
        expected: { project_id: this.config.project_id, purpose,
          recipient_authority_ref: recipient.authority_ref, source_head: claim.source_head,
          source_key_generation: claim.source_key_generation, signing_key_id: claim.signing_key_id,
          storage_profile_ref: claim.storage_profile_ref, storage_profile_digest: claim.storage_profile_digest,
          storage_conformance_receipt_ref: claim.storage_conformance_receipt_ref,
          storage_conformance_receipt_digest: claim.storage_conformance_receipt_digest,
          public_manifest_digest: claim.public_manifest_digest } });
      return { ...inspected, stage_ref: stageRecord.stage_ref, stage_event_sequence: stageEventSequence,
        disposition: "NON_ACTIVATING_STAGED" };
    } finally { await release(); }
  }

  async verifyStagedCustodyImport(stagingRoot, { envelope_id: envelopeId }) {
    const replay = await this.verifyEvents();
    const stage = replay.custody_import_stages[envelopeId];
    invariant(stage, "IMPORT_STAGE_MISSING", "custody import has no signed stage authority");
    invariant(replay.custody_import_disposals[envelopeId]?.status !== "completed",
      "IMPORT_CANDIDATE_DISPOSED", "custody import candidate is already disposed");
    const root = resolve(stagingRoot);
    invariant(dirname(root) !== root, "INVALID_IMPORT_CANDIDATE_ROOT", "filesystem root cannot be an import candidate");
    await assertPrivateDirectory(root, "custody import candidate");
    invariant((await readdir(root)).sort().join(",") === "import-candidate.json,payload",
      "INVALID_IMPORT_CANDIDATE", "custody import candidate has missing or extra entries");
    const receiptPath = join(root, "import-candidate.json");
    await assertPrivateFile(receiptPath, "custody import candidate receipt");
    const receiptBytes = await readFile(receiptPath);
    let receipt;
    try { receipt = JSON.parse(receiptBytes); } catch (error) {
      throw new MemoryError("INVALID_IMPORT_CANDIDATE", "custody import candidate receipt is invalid JSON");
    }
    invariant(receiptBytes.equals(canonicalBytes(receipt)), "NON_CANONICAL_IMPORT_CANDIDATE",
      "custody import candidate receipt is noncanonical");
    const admission = replay.custody_envelope_admissions[envelopeId];
    const expected = { schema: "agentos.memory.custody-import-candidate.v1",
      project_id: this.config.project_id, envelope_id: envelopeId,
      recipient_authority_ref: stage.recipient_authority_ref,
      recipient_generation: stage.recipient_generation, nonce_identity: stage.nonce_identity,
      source_head: stage.source_head, payload_manifest_digest: stage.payload_manifest_digest,
      entry_count: stage.entry_count, admission_ref: admission.admission_ref,
      admission_event_sequence: admission.event_sequence, stage_ref: stage.stage_ref,
      stage_event_sequence: stage.event_sequence, disposition: "NON_ACTIVATING_STAGED" };
    invariant(canonicalJson(receipt) === canonicalJson(expected), "IMPORT_CANDIDATE_LINEAGE_MISMATCH",
      "custody import candidate receipt does not match signed lineage");
    const payload = await MemoryProject.open(join(root, "payload"), { writable: false });
    const proof = await payload.verify();
    invariant(proof.project_id === this.config.project_id && proof.event_count === stage.source_head.sequence
      && proof.head_digest === stage.source_head.digest,
    "IMPORT_CANDIDATE_LINEAGE_MISMATCH", "custody import payload does not match signed source head");
    return { ok: true, envelope_id: envelopeId, stage_ref: stage.stage_ref,
      candidate_receipt_digest: sha256Ref("agentos.memory.custody-import-candidate.v1", receiptBytes),
      source_head: stage.source_head, disposition: "NON_ACTIVATING_STAGED" };
  }

  async disposeStagedCustodyImport(stagingRoot, { envelope_id: envelopeId,
    recover_interrupted: recoverInterrupted = false, fault_after_boundary: faultAfterBoundary = null } = {}) {
    invariant(this.privateKey !== null, "READ_ONLY", "custody import disposal requires writable project custody");
    invariant(faultAfterBoundary === null || ["authorized", "quarantined", "removed"].includes(faultAfterBoundary),
      "INVALID_IMPORT_DISPOSAL_FAULT_POINT", "custody import disposal fault point is invalid");
    const release = await acquireWriterLock(this.root, "system.custody-import-disposal");
    try {
      let replay = await this.verifyEvents();
      const stage = replay.custody_import_stages[envelopeId];
      invariant(stage, "IMPORT_STAGE_MISSING", "custody import has no signed stage authority");
      let disposal = replay.custody_import_disposals[envelopeId] ?? null;
      const target = resolve(stagingRoot);
      const quarantine = `${target}.disposing-${envelopeId.slice("sha256:".length, "sha256:".length + 16)}`;
      const targetExists = await exists(target);
      const quarantineExists = await exists(quarantine);
      invariant(!(targetExists && quarantineExists), "IMPORT_DISPOSAL_AMBIGUOUS",
        "custody import candidate and disposal quarantine both exist");
      if (disposal?.status === "completed") {
        invariant(!targetExists && !quarantineExists, "DISPOSED_IMPORT_CANDIDATE_REAPPEARED",
          "a disposed custody import candidate reappeared");
        return { ok: true, envelope_id: envelopeId, disposition: "DISPOSED", disposal_ref: disposal.disposal_ref,
          disposal_event_sequence: disposal.event_sequence, idempotent: true };
      }
      invariant(disposal === null || recoverInterrupted, "IMPORT_DISPOSAL_RECOVERY_REQUIRED",
        "interrupted custody import disposal requires explicit recovery");
      let receiptDigest = disposal?.candidate_receipt_digest ?? null;
      const candidatePath = targetExists ? target : quarantineExists ? quarantine : null;
      if (candidatePath !== null) {
        const verified = await this.verifyStagedCustodyImport(candidatePath, { envelope_id: envelopeId });
        invariant(receiptDigest === null || receiptDigest === verified.candidate_receipt_digest,
          "IMPORT_DISPOSAL_CANDIDATE_MISMATCH", "candidate differs from authorized disposal");
        receiptDigest = verified.candidate_receipt_digest;
      } else invariant(disposal?.status === "authorized", "IMPORT_CANDIDATE_MISSING",
        "custody import candidate is missing without signed disposal authority");
      if (disposal === null) {
        const record = createImportDisposalRecord({ project_id: this.config.project_id,
          envelope_id: envelopeId, stage_ref: stage.stage_ref, admission_ref: stage.admission_ref,
          source_head: stage.source_head, candidate_receipt_digest: receiptDigest, transition: "authorize" });
        const ref = await this.putJson(record);
        const event = await this.commitLocked({ actor: "system.custody-import-disposal",
          action: IMPORT_DISPOSAL_ACTIONS.authorize, subjectRef: `custody-import:${envelopeId}`,
          objectRef: ref, metadata: importDisposalMetadata(record) });
        disposal = { ...record, status: "authorized", disposal_ref: ref, event_sequence: event.body.sequence };
      }
      if (faultAfterBoundary === "authorized") throw new MemoryError("INJECTED_IMPORT_DISPOSAL_FAILURE",
        "injected custody import disposal failure after authorization");
      if (targetExists) {
        invariant(!quarantineExists, "IMPORT_DISPOSAL_AMBIGUOUS", "custody import disposal quarantine already exists");
        await rename(target, quarantine);
        await fsyncDir(dirname(target));
      }
      if (faultAfterBoundary === "quarantined") throw new MemoryError("INJECTED_IMPORT_DISPOSAL_FAILURE",
        "injected custody import disposal failure after quarantine rename");
      if (await exists(quarantine)) {
        const quarantined = await this.verifyStagedCustodyImport(quarantine, { envelope_id: envelopeId });
        invariant(quarantined.candidate_receipt_digest === receiptDigest, "IMPORT_DISPOSAL_CANDIDATE_MISMATCH",
          "quarantined candidate differs from authorized disposal");
        await rm(quarantine, { recursive: true, force: false });
        await fsyncDir(dirname(target));
      }
      if (faultAfterBoundary === "removed") throw new MemoryError("INJECTED_IMPORT_DISPOSAL_FAILURE",
        "injected custody import disposal failure after candidate removal");
      const completed = createImportDisposalRecord({ project_id: this.config.project_id,
        envelope_id: envelopeId, stage_ref: stage.stage_ref, admission_ref: stage.admission_ref,
        source_head: stage.source_head, candidate_receipt_digest: receiptDigest, transition: "complete",
        prior_disposal_ref: disposal.disposal_ref });
      const completedRef = await this.putJson(completed);
      const event = await this.commitLocked({ actor: "system.custody-import-disposal",
        action: IMPORT_DISPOSAL_ACTIONS.complete, subjectRef: `custody-import:${envelopeId}`,
        objectRef: completedRef, metadata: importDisposalMetadata(completed) });
      return { ok: true, envelope_id: envelopeId, disposition: "DISPOSED",
        disposal_ref: completedRef, disposal_event_sequence: event.body.sequence, idempotent: false };
    } finally { await release(); }
  }

  async recoverHead() {
    invariant(this.privateKey !== null, "READ_ONLY", "project was opened read-only");
    const { events, digest } = await this.verifyEvents();
    const head = { schema: HEAD_SCHEMA, project_id: this.config.project_id, sequence: events.length, digest };
    await atomicWrite(join(this.root, "state", "head.json"), Buffer.from(`${canonicalJson(head)}\n`));
    return head;
  }

  async commit({ actor, action, subjectRef, objectRef = null, metadata = {} }) {
    invariant(this.privateKey !== null, "READ_ONLY", "project was opened read-only");
    invariant(this.keyState.status === "active", "SIGNING_KEY_REVOKED", "active signing key is revoked");
    await assertProjectLayout(this.root);
    await this.verifyKeyCustody({ requirePrivate: true });
    const release = await acquireWriterLock(this.root, actor);
    try {
      return await this.commitLocked({ actor, action, subjectRef, objectRef, metadata });
    } finally {
      await release();
    }
  }

  async commitLocked({ actor, action, subjectRef, objectRef = null, metadata = {},
    signingPrivateKey = this.privateKey, signingKeyId = this.keyState.active_key_id }) {
      const prepared = await this.prepareEventLocked({ actor, action, subjectRef, objectRef, metadata,
        signingPrivateKey, signingKeyId });
      await this.publishPreparedEvent(prepared);
      return prepared.document;
  }

  async prepareEventLocked({ actor, action, subjectRef, objectRef = null, metadata = {},
    signingPrivateKey = this.privateKey, signingKeyId = this.keyState.active_key_id }) {
      const events = await this.listEvents();
      let previous = null;
      if (events.length > 0) {
        const replay = await this.verifyEvents();
        previous = replay.digest;
        const expectedHead = { schema: HEAD_SCHEMA, project_id: this.config.project_id, sequence: replay.events.length, digest: replay.digest };
        let headMatches = false;
        const headPath = join(this.root, "state", "head.json");
        try {
          await assertPrivateFile(headPath, "published ledger head");
          headMatches = canonicalJson(await readJson(headPath)) === canonicalJson(expectedHead);
        } catch (error) {
          if (error.code !== "NOT_FOUND" && error.code !== "ENOENT") throw error;
        }
        if (!headMatches) await atomicWrite(join(this.root, "state", "head.json"), Buffer.from(`${canonicalJson(expectedHead)}\n`));
      }
      if (objectRef !== null) await this.getBytes(objectRef);
      const timestamp = new Date().toISOString();
      const body = makeEventBody({
        projectId: this.config.project_id,
        sequence: events.length + 1,
        previousDigest: previous,
        actor,
        action,
        subjectRef,
        objectRef,
        metadata,
        timestamp
      });
      const bytes = canonicalBytes(body);
      const digest = sha256Ref("agentos.memory.event.v1", bytes);
      const signature = sign(null, bytes, signingPrivateKey).toString("base64url");
      const document = {
        body,
        digest,
        signature_profile: "pure-ed25519-v1",
        signing_key_id: signingKeyId,
        signature
      };
      const head = { schema: HEAD_SCHEMA, project_id: this.config.project_id, sequence: body.sequence, digest };
      return { document, head };
  }

  async publishPreparedEvent({ document, head }) {
      await writeCreateOnly(eventPath(this.root, document.body.sequence), Buffer.from(`${canonicalJson(document)}\n`));
      await atomicWrite(join(this.root, "state", "head.json"), Buffer.from(`${canonicalJson(head)}\n`));
  }

  async executeJournaledKeyTransition({ kind, eventArgs, nextState, nextPublicKey, nextPrivateKey,
    evidence, signingPrivateKey = this.privateKey, signingKeyId = this.keyState.active_key_id,
    faultAfter = null }) {
    const crash = (boundary) => {
      if (faultAfter === boundary) throw new MemoryError("INJECTED_TRANSITION_CRASH", `injected crash after ${boundary}`);
    };
    const prepared = await this.prepareEventLocked({ ...eventArgs, signingPrivateKey, signingKeyId });
    const priorHead = await readJson(join(this.root, "state", "head.json"));
    const transitionId = uuidv7();
    const stage = join(this.root, "state", `transition-${transitionId}`);
    invariant(!(await exists(stage)), "TRANSITION_STAGE_EXISTS", "transition stage already exists");
    await ensurePrivateDirectory(stage, "transition stage");
    const priorStateBytes = Buffer.from(`${canonicalJson(this.keyState)}\n`);
    const nextStateBytes = Buffer.from(`${canonicalJson(nextState)}\n`);
    const priorPublic = Buffer.from(this.publicKey);
    const priorPrivate = Buffer.from(this.privateKey);
    const nextPublic = Buffer.from(nextPublicKey);
    const nextPrivate = Buffer.from(nextPrivateKey);
    for (const [name, bytes] of [["prior-state.json", priorStateBytes], ["intended-state.json", nextStateBytes],
      ["prior-public.pem", priorPublic], ["prior-private.pem", priorPrivate],
      ["intended-public.pem", nextPublic], ["intended-private.pem", nextPrivate]])
      await atomicWrite(join(stage, name), bytes, 0o600);
    crash("stage_published");
    const base = {
      schema: "agentos.memory.transition_journal.v1",
      project_id: this.config.project_id,
      transition_kind: kind,
      transition_id: transitionId,
      prior: { generation: this.keyState.generation, key_id: this.keyState.active_key_id,
        head_sequence: priorHead.sequence, head_digest: priorHead.digest,
        state_digest: sha256Ref("agentos.memory.signing-key-state.v1", priorStateBytes) },
      intended: { generation: nextState.generation, key_id: nextState.active_key_id,
        head_sequence: prepared.head.sequence, head_digest: prepared.head.digest,
        state_digest: sha256Ref("agentos.memory.signing-key-state.v1", nextStateBytes) },
      authority: { event_sequence: prepared.document.body.sequence, event_digest: prepared.document.digest,
        object_ref: prepared.document.body.object_ref },
      evidence
    };
    const journalPrivatePath = join(this.root, "keys", "transition-journal.private.pem");
    await assertPrivateFile(journalPrivatePath, "transition journal private key");
    const journalPrivate = await readFile(journalPrivatePath);
    let journal = createTransitionJournal(base, { writer_private_key: journalPrivate });
    const journalPath = await publishTransitionJournal(this.root, journal);
    crash("journal_prepared");
    await writeCreateOnly(eventPath(this.root, prepared.document.body.sequence),
      Buffer.from(`${canonicalJson(prepared.document)}\n`));
    crash("authority_event_published");
    await atomicWrite(join(this.root, "state", "head.json"), Buffer.from(`${canonicalJson(prepared.head)}\n`));
    crash("head_published");
    crash("authority_published");
    journal = advanceTransitionJournal(journal, "authority_committed", { writer_private_key: journalPrivate });
    await replaceTransitionJournal(journalPath, journal);
    crash("authority_committed");
    await atomicWrite(join(this.root, "keys", "signing-public.pem"), nextPublic, 0o600);
    crash("intended_public_published");
    await atomicWrite(join(this.root, "keys", "signing-private.pem"), nextPrivate, 0o600);
    crash("intended_private_published");
    await atomicWrite(join(this.root, "state", "signing-key.json"), nextStateBytes);
    crash("state_published");
    journal = advanceTransitionJournal(journal, "state_published", { writer_private_key: journalPrivate });
    await replaceTransitionJournal(journalPath, journal);
    crash("state_phase_recorded");
    journal = advanceTransitionJournal(journal, "cleanup_complete", { writer_private_key: journalPrivate });
    await replaceTransitionJournal(journalPath, journal);
    crash("cleanup_recorded");
    await rm(stage, { recursive: true });
    crash("cleanup_stage_unlinked");
    await rm(journalPath);
    crash("cleanup_journal_unlinked");
    await fsyncDir(join(this.root, "state"));
    crash("cleanup_fsynced");
    this.publicKey = nextPublic;
    this.privateKey = nextPrivate;
    this.keyState = nextState;
    return prepared.document;
  }

  async rotateSigningKey({ next_private_key: nextPrivateKey, next_public_key: nextPublicKey, actor = "owner", reason,
    fault_after_durable_boundary: faultAfter = null }) {
    invariant(this.privateKey !== null, "READ_ONLY", "project was opened read-only");
    invariant(this.keyState.status === "active", "SIGNING_KEY_REVOKED", "revoked signing key cannot authorize rotation");
    await assertProjectLayout(this.root);
    await this.verifyKeyCustody({ requirePrivate: true });
    const release = await acquireWriterLock(this.root, actor);
    try {
      const replay = await this.verifyEvents();
      const sequence = replay.events.length + 1;
      const certificate = createRotationCertificate({
        project_id: this.config.project_id,
        previous_private_key: this.privateKey,
        previous_public_key: this.publicKey,
        next_private_key: nextPrivateKey,
        next_public_key: nextPublicKey,
        effective_after_sequence: sequence,
        reason
      });
      const certificateRef = await this.putJson(certificate);
      if (faultAfter === "authority_object_published")
        throw new MemoryError("INJECTED_TRANSITION_CRASH", "injected crash after authority_object_published");
      const nextKeyId = certificate.body.next_key_id;
      const generation = this.keyState.generation + 1;
      const nextPublicPem = Buffer.from(certificate.body.next_public_key_pem);
      const nextPrivatePem = Buffer.from(nextPrivateKey);
      const keyState = {
        schema: KEY_STATE_SCHEMA,
        project_id: this.config.project_id,
        generation,
        active_key_id: nextKeyId,
        last_rotation_sequence: sequence,
        last_rotation_certificate_ref: certificateRef,
        status: "active",
        revoked_key_ids: this.keyState.revoked_key_ids,
        last_revocation_sequence: this.keyState.last_revocation_sequence,
        last_revocation_evidence_ref: this.keyState.last_revocation_evidence_ref,
        last_revocation_at_utc: this.keyState.last_revocation_at_utc,
        last_recovery_sequence: this.keyState.last_recovery_sequence,
        last_recovery_certificate_ref: this.keyState.last_recovery_certificate_ref
      };
      const event = await this.executeJournaledKeyTransition({ kind: "rotation",
        eventArgs: { actor, action: "SIGNING_KEY_ROTATED", subjectRef: `signing-key:${nextKeyId}`,
          objectRef: certificateRef, metadata: { previous_key_id: this.keyState.active_key_id,
            next_key_id: nextKeyId, generation } }, nextState: keyState,
        nextPublicKey: nextPublicPem, nextPrivateKey: nextPrivatePem,
        evidence: { rotation_certificate_ref: certificateRef }, faultAfter });
      return { event, certificate_ref: certificateRef, previous_key_id: certificate.body.previous_key_id,
        active_key_id: nextKeyId, generation };
    } finally {
      await release();
    }
  }

  async revokeSigningKey({ compromised_key_id: compromisedKeyId = this.keyState.active_key_id,
    generation = this.keyState.generation, detected_at_utc: detectedAtUtc = null,
    source_refs: sourceRefs, actor = "owner", fault_after_durable_boundary: faultAfter = null }) {
    invariant(this.privateKey !== null, "READ_ONLY", "project was opened read-only");
    await assertProjectLayout(this.root);
    await this.verifyKeyCustody({ requirePrivate: true });
    if (this.keyState.status === "revoked") {
      const stored = await this.getJson(this.keyState.last_revocation_evidence_ref);
      const same = compromisedKeyId === stored.compromised_key_id && generation === stored.generation
        && actor === stored.provenance.actor
        && canonicalJson(sourceRefs) === canonicalJson(stored.provenance.source_refs)
        && (detectedAtUtc === null || detectedAtUtc === stored.detected_at_utc);
      invariant(same, "KEY_ALREADY_REVOKED", "a different revocation cannot replace established revocation state");
      return { idempotent: true, evidence_ref: this.keyState.last_revocation_evidence_ref,
        sequence: this.keyState.last_revocation_sequence };
    }
    invariant(compromisedKeyId === this.keyState.active_key_id, "REVOCATION_TARGET_MISMATCH",
      "revocation must target the currently active signing key");
    invariant(generation === this.keyState.generation, "REVOCATION_GENERATION_MISMATCH",
      "revocation must target the current signing-key generation");
    const release = await acquireWriterLock(this.root, actor);
    try {
      const replay = await this.verifyEvents();
      const sequence = replay.events.length + 1;
      const priorTime = replay.events.at(-1).body.recorded_at_utc;
      const detectedAt = detectedAtUtc ?? new Date().toISOString();
      canonicalUtc(detectedAt, "INVALID_COMPROMISE_TIME", "compromise detection time");
      invariant(detectedAt >= priorTime, "PREMATURE_COMPROMISE_EVIDENCE",
        "compromise evidence predates established ledger history");
      const evidence = compromiseEvidence({ projectId: this.config.project_id, keyId: compromisedKeyId,
        generation, sequence, detectedAt, actor, sourceRefs });
      for (const ref of sourceRefs) await this.getBytes(ref);
      const evidenceRef = await this.putJson(evidence);
      if (faultAfter === "authority_object_published")
        throw new MemoryError("INJECTED_TRANSITION_CRASH", "injected crash after authority_object_published");
      const keyState = { ...this.keyState, status: "revoked", revoked_key_ids: [...this.keyState.revoked_key_ids, compromisedKeyId],
        last_revocation_sequence: sequence, last_revocation_evidence_ref: evidenceRef,
        last_revocation_at_utc: detectedAt };
      const event = await this.executeJournaledKeyTransition({ kind: "revocation",
        eventArgs: { actor, action: "SIGNING_KEY_COMPROMISED", subjectRef: `signing-key:${compromisedKeyId}`,
          objectRef: evidenceRef, metadata: { compromised_key_id: compromisedKeyId, generation,
            effective_after_sequence: sequence } }, nextState: keyState, nextPublicKey: this.publicKey,
        nextPrivateKey: this.privateKey, evidence: { revocation_evidence_ref: evidenceRef }, faultAfter });
      return { idempotent: false, evidence_ref: evidenceRef, sequence, event };
    } finally {
      await release();
    }
  }

  async emergencyRecoverSigningKey({ next_private_key: nextPrivateKey, next_public_key: nextPublicKey,
    actor = "owner", created_at_utc: createdAtUtc = null, fault_after_durable_boundary: faultAfter = null }) {
    invariant(this.privateKey !== null, "READ_ONLY", "project was opened read-only");
    await assertProjectLayout(this.root);
    await this.verifyKeyCustody({ requirePrivate: true });
    const proposedNextId = sha256Ref("agentos.memory.public-key.v1",
      Buffer.from(createPublicKey(nextPrivateKey).export({ type: "spki", format: "pem" })));
    if (this.keyState.status === "active") {
      invariant(this.keyState.last_recovery_certificate_ref !== null, "PREMATURE_RECOVERY",
        "emergency recovery requires an established revocation");
      const stored = await this.getJson(this.keyState.last_recovery_certificate_ref);
      invariant(stored.body.next_key_id === proposedNextId, "RECOVERY_ALREADY_APPLIED",
        "a competing recovery cannot replace the established recovery");
      return { idempotent: true, certificate_ref: this.keyState.last_recovery_certificate_ref,
        sequence: this.keyState.last_recovery_sequence, active_key_id: this.keyState.active_key_id };
    }
    invariant(actor === "owner", "UNAUTHORIZED_RECOVERY_ACTOR", "only the owner may publish emergency recovery");
    const recoveryAuthorities = [];
    for (const authority of this.recoveryPublicKeys) {
      const privatePath = join(this.root, "keys", `${authority.principal}.private.pem`);
      await assertPrivateFile(privatePath, `recovery private key ${authority.principal}`);
      recoveryAuthorities.push({ principal: authority.principal, public_key: authority.public_key,
        private_key: await readFile(privatePath) });
    }
    const release = await acquireWriterLock(this.root, actor);
    try {
      const replay = await this.verifyEvents();
      invariant(replay.key_state.status === "revoked", "PREMATURE_RECOVERY", "recovery requires revoked replay state");
      const sequence = replay.events.length + 1;
      const createdAt = createdAtUtc ?? new Date().toISOString();
      invariant(createdAt >= this.keyState.last_revocation_at_utc, "RECOVERY_TIME_ORDER",
        "recovery cannot predate revocation");
      const certificate = createEmergencyRecoveryCertificate({ project_id: this.config.project_id,
        compromised_key_id: this.keyState.active_key_id, compromised_generation: this.keyState.generation,
        revocation_evidence_ref: this.keyState.last_revocation_evidence_ref,
        recovery_event_sequence: sequence, next_private_key: nextPrivateKey, next_public_key: nextPublicKey,
        recovery_authorities: recoveryAuthorities, created_at_utc: createdAt });
      const certificateRef = await this.putJson(certificate);
      if (faultAfter === "authority_object_published")
        throw new MemoryError("INJECTED_TRANSITION_CRASH", "injected crash after authority_object_published");
      const generation = this.keyState.generation + 1;
      const nextPublicPem = Buffer.from(certificate.body.next_public_key_pem);
      const nextPrivatePem = Buffer.from(nextPrivateKey);
      const keyState = { ...this.keyState, generation, active_key_id: certificate.body.next_key_id, status: "active",
        last_recovery_sequence: sequence, last_recovery_certificate_ref: certificateRef };
      const event = await this.executeJournaledKeyTransition({ kind: "recovery",
        eventArgs: { actor, action: "SIGNING_KEY_EMERGENCY_RECOVERED",
          subjectRef: `signing-key:${certificate.body.next_key_id}`, objectRef: certificateRef,
          metadata: { compromised_key_id: this.keyState.active_key_id, compromised_generation: this.keyState.generation,
            revocation_evidence_ref: this.keyState.last_revocation_evidence_ref,
            next_key_id: certificate.body.next_key_id, generation } }, nextState: keyState,
        nextPublicKey: nextPublicPem, nextPrivateKey: nextPrivatePem,
        evidence: { revocation_evidence_ref: this.keyState.last_revocation_evidence_ref,
          recovery_certificate_ref: certificateRef,
          recovery_principals: this.config.recovery_authorities.map(({ key_id }) => key_id),
          replacement_possession_key_id: certificate.body.next_key_id },
        signingPrivateKey: nextPrivateKey, signingKeyId: certificate.body.next_key_id, faultAfter });
      return { idempotent: false, certificate_ref: certificateRef, sequence,
        active_key_id: certificate.body.next_key_id, generation, event };
    } finally { await release(); }
  }

  async record(value, { actor = "owner", action = "RECORD_PROPOSED", subjectRef = `record:${uuidv7()}`, metadata = {} } = {}) {
    const objectRef = await this.putJson(value);
    const event = await this.commit({ actor, action, subjectRef, objectRef, metadata });
    return { subject_ref: subjectRef, object_ref: objectRef, event };
  }
}

export const internals = { objectPath, eventPath, writeCreateOnly, CONFIG_SCHEMA, EVENT_SCHEMA, HEAD_SCHEMA, KEY_STATE_SCHEMA };
