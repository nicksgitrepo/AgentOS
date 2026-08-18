import {createPublicKey, verify as verifySignature} from "node:crypto";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";

export const INDEPENDENT_CLEARANCE_SCHEMA = "agentos.independent_spawner_clearance.v1";
export const INDEPENDENT_CLEARANCE_REGISTRY_SCHEMA = "agentos.independent_evaluator_registry.v1";
export const INDEPENDENT_CLEARANCE_SCOPE = Object.freeze([
  "ADMISSION_BLOCKS", "AUTHORITY_SEPARATION", "BOOTSTRAP_PACKAGE", "ECO_MODEL_POLICY",
  "GLOBAL_GOVERNANCE_MEMORY", "HOSTILE_REGRESSIONS", "INERT_SEED_LIFECYCLE",
]);

const verifiedClearances = new WeakSet();
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const FORBIDDEN_ISSUER_ROLES = new Set(["AGENT.CONTROLLER", "AGENT.SPAWNER_COMPILER", "AGENT.BUILDER"]);

function assert(value, message) { if (!value) { const error = new Error(message); error.code = "INDEPENDENT_CLEARANCE_INVALID"; throw error; } }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value, keys, label) {
  assert(record(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`);
}
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`); }
function sha1(value, label) { assert(typeof value === "string" && SHA1.test(value), `${label} must be a Git object ID`); }
function id(value, label) { assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`); }
function time(value, label) { const parsed = Date.parse(value); assert(typeof value === "string" && Number.isFinite(parsed), `${label} must be an ISO timestamp`); return parsed; }
function body(value, digestField, signatureField = null) {
  const copy = structuredClone(value); copy[digestField] = null; if (signatureField) copy[signatureField] = null; return copy;
}
function same(left, right, label) { assert(canonicalJson(left) === canonicalJson(right), `${label} differs from the current candidate`); }

export function validateIndependentEvaluatorRegistry(registry, {trustedRegistrySha256, nowUtc} = {}) {
  exact(registry, ["schema", "version", "registry_id", "evaluators", "registry_sha256"], "Independent evaluator registry");
  assert(registry.schema === INDEPENDENT_CLEARANCE_REGISTRY_SCHEMA && registry.version === 1, "Independent evaluator registry identity is invalid");
  id(registry.registry_id, "Independent evaluator registry ID");
  assert(Array.isArray(registry.evaluators) && registry.evaluators.length > 0, "Independent evaluator registry is empty");
  const issuerIds = [];
  for (const evaluator of registry.evaluators) {
    exact(evaluator, ["issuer_id", "role_id", "status", "admission_receipt_sha256", "public_key_pem", "separated_from_roles", "valid_from_utc", "expires_at_utc"], "Independent evaluator entry");
    id(evaluator.issuer_id, "Evaluator issuer ID"); id(evaluator.role_id, "Evaluator role ID");
    assert(evaluator.role_id === "AGENT.INDEPENDENT_EVALUATOR" && evaluator.status === "ADMITTED", "Clearance issuer is not a separately admitted evaluator");
    sha(evaluator.admission_receipt_sha256, "Evaluator admission receipt");
    assert(typeof evaluator.public_key_pem === "string" && evaluator.public_key_pem.includes("BEGIN PUBLIC KEY"), "Evaluator public key is invalid");
    createPublicKey(evaluator.public_key_pem);
    assert(Array.isArray(evaluator.separated_from_roles) && evaluator.separated_from_roles.includes("AGENT.CONTROLLER") && evaluator.separated_from_roles.includes("AGENT.SPAWNER_COMPILER") && evaluator.separated_from_roles.includes("AGENT.BUILDER"), "Evaluator separation is incomplete");
    assert(time(evaluator.valid_from_utc, "Evaluator valid-from") <= time(nowUtc, "trusted current time") && time(nowUtc, "trusted current time") < time(evaluator.expires_at_utc, "Evaluator expiry"), "Evaluator authority is not current");
    issuerIds.push(evaluator.issuer_id);
  }
  assert(new Set(issuerIds).size === issuerIds.length, "Independent evaluator registry contains duplicate issuers");
  sha(registry.registry_sha256, "Independent evaluator registry digest");
  assert(registry.registry_sha256 === canonicalDigest(body(registry, "registry_sha256")), "Independent evaluator registry digest mismatch");
  sha(trustedRegistrySha256, "Trusted independent evaluator registry digest");
  assert(registry.registry_sha256 === trustedRegistrySha256, "Independent evaluator registry is not the trusted authority");
  return registry;
}

export function verifyIndependentSpawnerClearance({receipt, registry, trustedRegistrySha256, expectedCandidate, nowUtc, usedReceiptSha256s = []} = {}) {
  validateIndependentEvaluatorRegistry(registry, {trustedRegistrySha256, nowUtc});
  exact(receipt, ["schema", "version", "receipt_id", "issuer_id", "issuer_role", "subject_role", "result", "candidate", "scope", "custody", "issued_at_utc", "expires_at_utc", "nonce_sha256", "receipt_sha256", "signature_base64"], "Independent clearance receipt");
  assert(receipt.schema === INDEPENDENT_CLEARANCE_SCHEMA && receipt.version === 1, "Independent clearance receipt identity is invalid");
  id(receipt.receipt_id, "Independent clearance receipt ID"); id(receipt.issuer_id, "Independent clearance issuer ID"); id(receipt.issuer_role, "Independent clearance issuer role");
  assert(receipt.issuer_role === "AGENT.INDEPENDENT_EVALUATOR" && !FORBIDDEN_ISSUER_ROLES.has(receipt.issuer_role), "Spawner, Controller, or builder cannot issue independent clearance");
  assert(receipt.subject_role === "AGENT.SPAWNER_COMPILER" && receipt.result === "PASS", "Independent clearance result or subject is invalid");
  const evaluator = registry.evaluators.find((entry) => entry.issuer_id === receipt.issuer_id);
  assert(evaluator && evaluator.role_id === receipt.issuer_role, "Independent clearance issuer is unknown or role-mismatched");
  exact(receipt.candidate, ["commit_sha1", "tree_sha1", "package_sha256", "package_file_sha256", "evidence_set_sha256", "lifecycle_candidate_sha256", "roster_projection_sha256", "context_sha256"], "Independent clearance candidate");
  sha1(receipt.candidate.commit_sha1, "Candidate commit"); sha1(receipt.candidate.tree_sha1, "Candidate tree");
  for (const field of ["package_sha256", "package_file_sha256", "evidence_set_sha256", "lifecycle_candidate_sha256", "roster_projection_sha256", "context_sha256"]) sha(receipt.candidate[field], `Candidate ${field}`);
  same(receipt.candidate, expectedCandidate, "Independent clearance candidate binding");
  assert(Array.isArray(receipt.scope) && JSON.stringify(receipt.scope) === JSON.stringify(INDEPENDENT_CLEARANCE_SCOPE), "Independent clearance scope is partial, reordered, or unknown");
  exact(receipt.custody, ["worktree_id", "detached", "clean", "source_preserved", "builder_separated"], "Independent clearance custody");
  id(receipt.custody.worktree_id, "Evaluator worktree ID");
  assert(receipt.custody.detached === true && receipt.custody.clean === true && receipt.custody.source_preserved === true && receipt.custody.builder_separated === true, "Independent evaluator custody is not isolated and clean");
  const now = time(nowUtc, "trusted current time");
  assert(time(receipt.issued_at_utc, "Clearance issue time") <= now, "Independent clearance was issued in the future");
  assert(now < time(receipt.expires_at_utc, "Clearance expiry"), "Independent clearance is stale");
  sha(receipt.nonce_sha256, "Independent clearance nonce"); sha(receipt.receipt_sha256, "Independent clearance digest");
  assert(receipt.receipt_sha256 === canonicalDigest(body(receipt, "receipt_sha256", "signature_base64")), "Independent clearance receipt digest mismatch");
  assert(!usedReceiptSha256s.includes(receipt.receipt_sha256), "Independent clearance receipt was already consumed");
  assert(typeof receipt.signature_base64 === "string" && receipt.signature_base64.length > 40, "Independent clearance signature is absent");
  const signatureOk = verifySignature(null, Buffer.from(receipt.receipt_sha256, "hex"), evaluator.public_key_pem, Buffer.from(receipt.signature_base64, "base64"));
  assert(signatureOk, "Independent clearance signature is invalid or locally fabricated");
  const clearance = Object.freeze({receipt_sha256: receipt.receipt_sha256, candidate: Object.freeze(structuredClone(receipt.candidate)), issuer_id: receipt.issuer_id});
  verifiedClearances.add(clearance);
  return clearance;
}

export function assertVerifiedIndependentClearance(clearance, expectedCandidate, usedReceiptSha256s = []) {
  assert(record(clearance) && verifiedClearances.has(clearance), "Independent clearance was not verified by the authority registry");
  same(clearance.candidate, expectedCandidate, "Verified independent clearance candidate binding");
  assert(!usedReceiptSha256s.includes(clearance.receipt_sha256), "Independent clearance receipt was already consumed");
  return clearance;
}
