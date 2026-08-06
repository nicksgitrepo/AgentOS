import crypto from "node:crypto";
import {assert, canonicalJson, digestWithout, sha256} from "./canonical-json.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {assertOpaqueReference, isOpaqueReference, sessionReference} from "./opaque-reference.mjs";

export const IDENTITY_FIELDS = Object.freeze([
  "source_commit",
  "source_tree",
  "worktree_id",
  "session_id",
  "goal_id",
  "environment_id",
]);

const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function attestation(secret, record) {
  assert(typeof secret === "string" && secret.length >= 32, "evidence attestation secret is required");
  return crypto.createHmac("sha256", secret).update(canonicalJson({...record, attestation_hmac: null, digest: null}), "utf8").digest("hex");
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function publicIdentity(identity) {
  const normalized = {...identity};
  if (!isOpaqueReference(normalized.session_id, "session")) normalized.session_id = sessionReference(normalized.session_id, normalized);
  return normalized;
}

export function validateIdentity(identity, label = "identity") {
  assert(identity && typeof identity === "object" && !Array.isArray(identity), `${label} must be an object`);
  const keys = Object.keys(identity).sort();
  const expected = [...IDENTITY_FIELDS].sort();
  assert(JSON.stringify(keys) === JSON.stringify(expected), `${label} fields mismatch`);
  assert(COMMIT.test(identity.source_commit), `${label}.source_commit is invalid`);
  assert(COMMIT.test(identity.source_tree), `${label}.source_tree is invalid`);
  for (const field of IDENTITY_FIELDS.slice(2)) nonempty(identity[field], `${label}.${field}`);
  assertOpaqueReference(identity.session_id, "session", `${label}.session_id`);
  return identity;
}

export function createEvidence({evidence_id, question_id, graph_digest, evidence_slot, answer, kind, value, identity, issuer_session_id, issuer_kind, supports_answer, observed_at_utc, attestation_secret}) {
  nonempty(evidence_id, "evidence_id");
  nonempty(question_id, "question_id");
  assert(DIGEST.test(graph_digest), "graph_digest is invalid");
  nonempty(evidence_slot, "evidence_slot");
  assert(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"].includes(answer), "answer is invalid");
  nonempty(kind, "kind");
  const normalizedIdentity = publicIdentity(identity);
  validateIdentity(normalizedIdentity);
  const normalizedIssuer = isOpaqueReference(issuer_session_id, "session") ? issuer_session_id : sessionReference(issuer_session_id, normalizedIdentity);
  assert(normalizedIssuer !== normalizedIdentity.session_id, "issuer_session_id must differ from worker session_id");
  assert(["HOST_READBACK", "INDEPENDENT_AUDITOR"].includes(issuer_kind), "issuer_kind is invalid");
  assert(supports_answer === true, "evidence must explicitly support its answer");
  if (evidence_slot === "review") assert(issuer_kind === "INDEPENDENT_AUDITOR", "review evidence requires an independent auditor");
  assert(UTC.test(observed_at_utc), "observed_at_utc is invalid");
  const record = {
    evidence_id,
    question_id,
    graph_digest,
    evidence_slot,
    answer,
    kind,
    value_sha256: sha256(value),
    ...normalizedIdentity,
    issuer_session_id: normalizedIssuer,
    issuer_kind,
    supports_answer,
    observed_at_utc,
    attestation_hmac: null,
    digest: null,
  };
  record.attestation_hmac = attestation(attestation_secret, record);
  return {...record, digest: digestWithout(record, "digest")};
}

export function validateEvidence(record, {question_id, graph_digest, evidence_slot, answer, binding, attestation_secret}, label = "evidence") {
  assertPortableRecord(record, label);
  assert(record && typeof record === "object" && !Array.isArray(record), `${label} must be an object`);
  const expected = ["evidence_id", "question_id", "graph_digest", "evidence_slot", "answer", "kind", "value_sha256", ...IDENTITY_FIELDS, "issuer_session_id", "issuer_kind", "supports_answer", "observed_at_utc", "attestation_hmac", "digest"].sort();
  assert(JSON.stringify(Object.keys(record).sort()) === JSON.stringify(expected), `${label} fields mismatch`);
  assert(record.question_id === question_id, `${label} question identity differs`);
  assert(record.graph_digest === graph_digest, `${label} graph identity differs`);
  assert(record.evidence_slot === evidence_slot, `${label} evidence slot differs`);
  assert(record.answer === answer, `${label} answer identity differs`);
  nonempty(record.evidence_id, `${label}.evidence_id`);
  nonempty(record.kind, `${label}.kind`);
  assert(DIGEST.test(record.value_sha256), `${label}.value_sha256 is invalid`);
  const identity = Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, record[field]]));
  validateIdentity(identity, label);
  assert(binding && typeof binding === "object", `${label} binding is required`);
  for (const field of IDENTITY_FIELDS) assert(record[field] === binding[field], `${label}.${field} differs from execution binding`);
  assertOpaqueReference(record.issuer_session_id, "session", `${label}.issuer_session_id`);
  assert(record.issuer_session_id !== binding.session_id, `${label} issuer cannot be the worker session`);
  assert(["HOST_READBACK", "INDEPENDENT_AUDITOR"].includes(record.issuer_kind), `${label}.issuer_kind is invalid`);
  assert(record.supports_answer === true, `${label} does not support its answer`);
  if (record.evidence_slot === "review") assert(record.issuer_kind === "INDEPENDENT_AUDITOR", `${label} review is not independent`);
  assert(UTC.test(record.observed_at_utc), `${label}.observed_at_utc is invalid`);
  assert(DIGEST.test(record.attestation_hmac), `${label}.attestation_hmac is invalid`);
  assert(record.attestation_hmac === attestation(attestation_secret, record), `${label} attestation is invalid`);
  assert(DIGEST.test(record.digest), `${label}.digest is invalid`);
  assert(record.digest === digestWithout(record, "digest"), `${label}.digest does not match content`);
  return record;
}
