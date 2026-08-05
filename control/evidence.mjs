import {assert, digestWithout, sha256} from "./canonical-json.mjs";

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

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

export function validateIdentity(identity, label = "identity") {
  assert(identity && typeof identity === "object" && !Array.isArray(identity), `${label} must be an object`);
  const keys = Object.keys(identity).sort();
  const expected = [...IDENTITY_FIELDS].sort();
  assert(JSON.stringify(keys) === JSON.stringify(expected), `${label} fields mismatch`);
  assert(COMMIT.test(identity.source_commit), `${label}.source_commit is invalid`);
  assert(COMMIT.test(identity.source_tree), `${label}.source_tree is invalid`);
  for (const field of IDENTITY_FIELDS.slice(2)) nonempty(identity[field], `${label}.${field}`);
  return identity;
}

export function createEvidence({evidence_id, question_id, kind, value, identity, observed_at_utc}) {
  nonempty(evidence_id, "evidence_id");
  nonempty(question_id, "question_id");
  nonempty(kind, "kind");
  validateIdentity(identity);
  assert(UTC.test(observed_at_utc), "observed_at_utc is invalid");
  const record = {
    evidence_id,
    question_id,
    kind,
    value_sha256: sha256(value),
    ...identity,
    observed_at_utc,
    digest: null,
  };
  return {...record, digest: digestWithout(record, "digest")};
}

export function validateEvidence(record, questionId, label = "evidence") {
  assert(record && typeof record === "object" && !Array.isArray(record), `${label} must be an object`);
  const expected = ["evidence_id", "question_id", "kind", "value_sha256", ...IDENTITY_FIELDS, "observed_at_utc", "digest"].sort();
  assert(JSON.stringify(Object.keys(record).sort()) === JSON.stringify(expected), `${label} fields mismatch`);
  assert(record.question_id === questionId, `${label} question identity differs`);
  nonempty(record.evidence_id, `${label}.evidence_id`);
  nonempty(record.kind, `${label}.kind`);
  assert(DIGEST.test(record.value_sha256), `${label}.value_sha256 is invalid`);
  validateIdentity(Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, record[field]])), label);
  assert(UTC.test(record.observed_at_utc), `${label}.observed_at_utc is invalid`);
  assert(DIGEST.test(record.digest), `${label}.digest is invalid`);
  assert(record.digest === digestWithout(record, "digest"), `${label}.digest does not match content`);
  return record;
}

