import {assert, digestWithout} from "./canonical-json.mjs";
import {DEFAULT_MODEL, DEFAULT_REASONING_EFFORT} from "./native-session.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {assertOpaqueReference, isOpaqueReference, opaqueReference} from "./opaque-reference.mjs";

export const PERSISTENT_ROLE_SCHEMA = "agentos.persistent_role.v1";
const ID = /^[A-Z][A-Z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

export function createPersistentRole({role_id, project_id, environment_id, host_session_id, source_commit, source_tree, governance_digest, created_at_utc}) {
  assert(["INTENT_REGULATOR", "RUNTIME"].includes(role_id), "only Intent Regulator and Runtime are persistent roles");
  for (const [value, label] of [[project_id, "project_id"], [environment_id, "environment_id"], [host_session_id, "host_session_id"]]) { nonempty(value, label); assert(ID.test(value), `${label} is invalid`); }
  assert(COMMIT.test(source_commit) && COMMIT.test(source_tree), "persistent role source identity is invalid");
  assert(DIGEST.test(governance_digest), "persistent role governance digest is invalid");
  assert(typeof created_at_utc === "string" && UTC.test(created_at_utc), "persistent role created_at_utc is invalid");
  const publicHostSession = isOpaqueReference(host_session_id, "session")
    ? host_session_id
    : opaqueReference("session", host_session_id, `${project_id}:${environment_id}:${role_id}`);
  const record = {schema: PERSISTENT_ROLE_SCHEMA, version: 1, status: "ACTIVE", role_id, lifetime: "PERSISTENT", project_id, environment_id, host_session_id: publicHostSession, source_commit, source_tree, governance_digest, model: DEFAULT_MODEL, reasoning_effort: DEFAULT_REASONING_EFFORT, created_at_utc, digest: null};
  record.digest = digestWithout(record, "digest");
  return validatePersistentRole(record);
}

export function validatePersistentRole(record) {
  assertPortableRecord(record, "persistent role");
  exactKeys(record, ["schema", "version", "status", "role_id", "lifetime", "project_id", "environment_id", "host_session_id", "source_commit", "source_tree", "governance_digest", "model", "reasoning_effort", "created_at_utc", "digest"], "persistent role");
  assert(record.schema === PERSISTENT_ROLE_SCHEMA && record.version === 1 && record.status === "ACTIVE" && record.lifetime === "PERSISTENT", "persistent role identity is invalid");
  assert(["INTENT_REGULATOR", "RUNTIME"].includes(record.role_id), "persistent role ID is invalid");
  for (const [value, label] of [[record.project_id, "project_id"], [record.environment_id, "environment_id"]]) { nonempty(value, `persistent role ${label}`); assert(ID.test(value), `persistent role ${label} is invalid`); }
  assertOpaqueReference(record.host_session_id, "session", "persistent role host_session_id");
  assert(COMMIT.test(record.source_commit) && COMMIT.test(record.source_tree), "persistent role source identity is invalid");
  assert(DIGEST.test(record.governance_digest), "persistent role governance digest is invalid");
  assert(record.model === DEFAULT_MODEL && record.reasoning_effort === DEFAULT_REASONING_EFFORT, "persistent role defaults are invalid");
  assert(typeof record.created_at_utc === "string" && UTC.test(record.created_at_utc), "persistent role created_at_utc is invalid");
  assert(DIGEST.test(record.digest) && record.digest === digestWithout(record, "digest"), "persistent role digest does not match content");
  return record;
}
