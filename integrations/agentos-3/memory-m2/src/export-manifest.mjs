import { sign, verify } from "node:crypto";
import { canonicalBytes, canonicalJson, sha256Ref } from "./canonical.mjs";
import { invariant } from "./errors.mjs";

export const EXPORT_MANIFEST_SCHEMA = "agentos.memory.public-export-manifest.v1";
export const EXPORT_BODY_SCHEMA = "agentos.memory.public-export-body.v1";
export const EXPORT_SIGNATURE_PROFILE = "pure-ed25519-v1";
export const EXPORT_EXCLUSIONS = Object.freeze([
  ".initializing",
  "keys/*private.pem",
  "keys/address.key",
  "projections/**",
  "state/transition-*",
  "state/writer.lock",
  "tmp/**"
]);
const DIGEST = /^sha256:[a-z2-7]{52}$/;
const OBJECT_REF = /^obj_[a-z2-7]{52}$/;
const DOMAIN = Buffer.from("agentos.memory.public-export-manifest.v1\0", "utf8");

export function assertPortablePath(path) {
  invariant(typeof path === "string" && path.length > 0 && path.length <= 1024,
    "INVALID_EXPORT_PATH", "export path must be a non-empty bounded string");
  invariant(!path.startsWith("/") && !path.includes("\\") && !path.includes("\0"),
    "EXPORT_PATH_ESCAPE", "export path must be portable and relative");
  const parts = path.split("/");
  invariant(parts.every((part) => part.length > 0 && part !== "." && part !== ".."),
    "EXPORT_PATH_ESCAPE", "export path cannot escape its portable root");
  return path;
}

function assertEntry(entry) {
  invariant(entry && typeof entry === "object" && !Array.isArray(entry),
    "INVALID_EXPORT_ENTRY", "export entry must be an object");
  invariant(Object.keys(entry).sort().join(",") === "byte_digest,disposition,path,size",
    "INVALID_EXPORT_ENTRY", "export entry fields must be exact");
  assertPortablePath(entry.path);
  invariant(DIGEST.test(entry.byte_digest), "INVALID_EXPORT_ENTRY", "export entry digest is invalid");
  invariant(Number.isSafeInteger(entry.size) && entry.size >= 0, "INVALID_EXPORT_ENTRY",
    "export entry size must be a non-negative safe integer");
  invariant(["digest_only", "portable_bytes"].includes(entry.disposition), "INVALID_EXPORT_ENTRY",
    "export entry disposition is invalid");
  invariant((entry.path.startsWith("objects/") || entry.path.startsWith("ledger/events/"))
    === (entry.disposition === "digest_only"), "EXPORT_PRIVACY_BOUNDARY",
  "immutable objects and authority events must remain digest-only in a public manifest");
  invariant(entry.path !== ".initializing" && entry.path !== "keys/address.key"
    && !/^keys\/[^/]*private\.pem$/.test(entry.path)
    && !entry.path.startsWith("projections/") && !entry.path.startsWith("state/transition-")
    && entry.path !== "state/writer.lock" && !entry.path.startsWith("tmp/"),
  "EXPORT_PRIVACY_BOUNDARY", `private-control path ${entry.path} cannot enter a public export`);
}

function assertBody(body) {
  invariant(body && body.schema === EXPORT_BODY_SCHEMA, "INVALID_EXPORT_MANIFEST", "unsupported export body schema");
  const expectedKeys = ["entries", "excluded", "project_id", "schema", "source_head",
    "storage_conformance_receipt_digest", "storage_conformance_receipt_ref",
    "storage_profile_digest", "storage_profile_ref"];
  invariant(canonicalJson(Object.keys(body).sort()) === canonicalJson(expectedKeys.sort()),
    "INVALID_EXPORT_MANIFEST", "export body fields must be exact");
  invariant(typeof body.project_id === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(body.project_id),
    "INVALID_EXPORT_PROJECT", "export project id is invalid");
  invariant(body.source_head && Number.isSafeInteger(body.source_head.sequence) && body.source_head.sequence >= 1
    && DIGEST.test(body.source_head.digest)
    && Object.keys(body.source_head).sort().join(",") === "digest,sequence",
  "INVALID_EXPORT_HEAD", "export source head is invalid");
  invariant(OBJECT_REF.test(body.storage_profile_ref) && DIGEST.test(body.storage_profile_digest)
    && OBJECT_REF.test(body.storage_conformance_receipt_ref)
    && DIGEST.test(body.storage_conformance_receipt_digest),
  "INVALID_EXPORT_STORAGE_BINDING", "export storage authority binding is invalid");
  invariant(canonicalJson(body.excluded) === canonicalJson(EXPORT_EXCLUSIONS),
    "EXPORT_PRIVACY_BOUNDARY", "export exclusion contract is missing or changed");
  invariant(Array.isArray(body.entries) && body.entries.length > 0, "PARTIAL_EXPORT_MANIFEST",
    "export manifest must contain authority entries");
  body.entries.forEach(assertEntry);
  const paths = body.entries.map(({ path }) => path);
  invariant(canonicalJson(paths) === canonicalJson([...new Set(paths)].sort()),
    "INVALID_EXPORT_ORDER", "export entries must have unique paths in canonical order");
  return body;
}

export function assertPublicExportManifestShape(manifest) {
  invariant(manifest && typeof manifest === "object" && !Array.isArray(manifest),
    "INVALID_EXPORT_MANIFEST", "export manifest must be an object");
  invariant(Object.keys(manifest).sort().join(",") === "body,schema,signature,signature_profile,signing_key_id",
    "INVALID_EXPORT_MANIFEST", "export manifest fields must be exact");
  invariant(manifest.schema === EXPORT_MANIFEST_SCHEMA && manifest.signature_profile === EXPORT_SIGNATURE_PROFILE,
    "INVALID_EXPORT_MANIFEST", "export manifest profile is unsupported");
  invariant(DIGEST.test(manifest.signing_key_id) && typeof manifest.signature === "string"
    && /^[A-Za-z0-9_-]{86}$/.test(manifest.signature),
  "INVALID_EXPORT_MANIFEST", "export manifest signature fields are invalid");
  assertBody(manifest.body);
  return manifest;
}

function signingBytes(body) {
  return Buffer.concat([DOMAIN, canonicalBytes(body)]);
}

export function exportEntry({ project_id: projectId, path, bytes, disposition }) {
  assertPortablePath(path);
  invariant(Buffer.isBuffer(bytes), "INVALID_EXPORT_ENTRY", "export entry bytes must be a Buffer");
  const entry = { path, byte_digest: sha256Ref(`agentos.memory.export-entry.v1:${projectId}`, bytes),
    size: bytes.length, disposition };
  assertEntry(entry);
  return entry;
}

export function createPublicExportManifest({ project_id: projectId, source_head: sourceHead,
  storage_profile_ref: profileRef, storage_profile_digest: profileDigest,
  storage_conformance_receipt_ref: receiptRef, storage_conformance_receipt_digest: receiptDigest,
  entries, signing_key_id: signingKeyId,
  signing_private_key: privateKey }) {
  const body = { schema: EXPORT_BODY_SCHEMA, project_id: projectId, source_head: sourceHead,
    storage_profile_ref: profileRef, storage_profile_digest: profileDigest,
    storage_conformance_receipt_ref: receiptRef, storage_conformance_receipt_digest: receiptDigest,
    excluded: EXPORT_EXCLUSIONS, entries };
  assertBody(body);
  invariant(DIGEST.test(signingKeyId), "INVALID_EXPORT_SIGNING_KEY", "export signing key id is invalid");
  return { schema: EXPORT_MANIFEST_SCHEMA, body, signature_profile: EXPORT_SIGNATURE_PROFILE,
    signing_key_id: signingKeyId, signature: sign(null, signingBytes(body), privateKey).toString("base64url") };
}

export function verifyPublicExportManifest(manifest, { project_id: projectId, source_head: sourceHead,
  storage_profile_ref: profileRef, storage_profile_digest: profileDigest,
  storage_conformance_receipt_ref: receiptRef, storage_conformance_receipt_digest: receiptDigest,
  signing_key_id: signingKeyId,
  signing_public_key: publicKey, expected_entries: expectedEntries }) {
  assertPublicExportManifestShape(manifest);
  invariant(manifest.body.project_id === projectId, "EXPORT_PROJECT_MISMATCH", "export belongs to another project");
  invariant(canonicalJson(manifest.body.source_head) === canonicalJson(sourceHead), "STALE_EXPORT_MANIFEST",
    "export source head is stale or mismatched");
  invariant(manifest.body.storage_profile_ref === profileRef && manifest.body.storage_profile_digest === profileDigest
    && manifest.body.storage_conformance_receipt_ref === receiptRef
    && manifest.body.storage_conformance_receipt_digest === receiptDigest,
  "EXPORT_STORAGE_MISMATCH", "export storage capabilities are incompatible");
  invariant(manifest.signing_key_id === signingKeyId, "EXPORT_SIGNING_KEY_MISMATCH",
    "export signing key is stale or mismatched");
  invariant(canonicalJson(manifest.body.entries) === canonicalJson(expectedEntries), "PARTIAL_EXPORT_MANIFEST",
    "export manifest is partial or contains unrecognized entries");
  invariant(verify(null, signingBytes(manifest.body), publicKey, Buffer.from(manifest.signature, "base64url")),
    "EXPORT_SIGNATURE_INVALID", "export manifest signature is invalid");
  return true;
}
