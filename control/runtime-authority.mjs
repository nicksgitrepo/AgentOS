import {assert, digestWithout} from "./canonical-json.mjs";
import {validatePersistentRole} from "./persistent-role.mjs";

export const RUNTIME_REQUEST_SCHEMA = "agentos.runtime_request.v1";
export const PROTECTED_ACTIONS = Object.freeze(["PUBLISH", "PUSH", "MERGE", "DEPLOY", "ROLLBACK", "SPEND", "AUTHENTICATE", "REVEAL_SECRET", "DELETE_ACCEPTED_WORK"]);
const ID = /^[A-Z][A-Z0-9._-]*$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

export function authorizeRuntimeRequest(runtimeRole, {request_id, action, project_id, campaign_id, goal_id, scope_digest, reason, requested_at_utc}) {
  validatePersistentRole(runtimeRole);
  assert(runtimeRole.role_id === "RUNTIME", "only Runtime may authorize protected actions");
  exactKeys({request_id, action, project_id, campaign_id, goal_id, scope_digest, reason, requested_at_utc}, ["request_id", "action", "project_id", "campaign_id", "goal_id", "scope_digest", "reason", "requested_at_utc"], "runtime request");
  for (const [value, label] of [[request_id, "request_id"], [project_id, "project_id"], [campaign_id, "campaign_id"], [goal_id, "goal_id"]]) { nonempty(value, label); assert(ID.test(value), `${label} is invalid`); }
  assert(PROTECTED_ACTIONS.includes(action), "runtime action is not protected or recognized");
  assert(DIGEST.test(scope_digest), "runtime scope digest is invalid");
  nonempty(reason, "runtime request reason");
  assert(typeof requested_at_utc === "string" && UTC.test(requested_at_utc), "runtime requested_at_utc is invalid");
  const request = {schema: RUNTIME_REQUEST_SCHEMA, version: 1, status: "AUTHORIZED_REQUEST", authority_role: "RUNTIME", authority_digest: runtimeRole.digest, request_id, action, project_id, campaign_id, goal_id, scope_digest, reason, requested_at_utc, digest: null};
  request.digest = digestWithout(request, "digest");
  return request;
}

export function validateRuntimeRequest(request) {
  exactKeys(request, ["schema", "version", "status", "authority_role", "authority_digest", "request_id", "action", "project_id", "campaign_id", "goal_id", "scope_digest", "reason", "requested_at_utc", "digest"], "runtime request");
  assert(request.schema === RUNTIME_REQUEST_SCHEMA && request.version === 1 && request.status === "AUTHORIZED_REQUEST" && request.authority_role === "RUNTIME", "runtime request identity is invalid");
  assert(DIGEST.test(request.authority_digest) && DIGEST.test(request.scope_digest) && DIGEST.test(request.digest), "runtime request digest is invalid");
  assert(PROTECTED_ACTIONS.includes(request.action), "runtime request action is invalid");
  assert(request.digest === digestWithout(request, "digest"), "runtime request digest does not match content");
  return request;
}

