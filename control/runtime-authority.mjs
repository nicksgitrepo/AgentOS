import {assert, digestWithout} from "./canonical-json.mjs";
import {validatePersistentRole} from "./persistent-role.mjs";
import {assertPortableRecord} from "./portable-record.mjs";

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

export function validateOwnerApproval(approval) {
  exactKeys(approval, ["decision_id", "decision", "actor_digest", "accepted_result_digest", "final_audit_digest", "decided_at_utc", "digest"], "owner approval");
  assert(ID.test(approval.decision_id), "owner approval decision_id is invalid");
  assert(approval.decision === "APPROVE", "owner approval decision is not APPROVE");
  for (const [value, label] of [[approval.actor_digest, "owner approval actor_digest"], [approval.accepted_result_digest, "owner approval accepted_result_digest"], [approval.final_audit_digest, "owner approval final_audit_digest"]]) assert(DIGEST.test(value), `${label} is invalid`);
  assert(typeof approval.decided_at_utc === "string" && UTC.test(approval.decided_at_utc), "owner approval decided_at_utc is invalid");
  assert(DIGEST.test(approval.digest) && approval.digest === digestWithout(approval, "digest"), "owner approval digest does not match content");
  return approval;
}

export function authorizeRuntimeRequest(runtimeRole, {request_id, action, project_id, environment_id, campaign_id, goal_id, scope_digest, reason, requested_at_utc, owner_approval}) {
  validatePersistentRole(runtimeRole);
  assert(runtimeRole.role_id === "RUNTIME", "only Runtime may authorize protected actions");
  exactKeys({request_id, action, project_id, environment_id, campaign_id, goal_id, scope_digest, reason, requested_at_utc, owner_approval}, ["request_id", "action", "project_id", "environment_id", "campaign_id", "goal_id", "scope_digest", "reason", "requested_at_utc", "owner_approval"], "runtime request");
  for (const [value, label] of [[request_id, "request_id"], [project_id, "project_id"], [environment_id, "environment_id"], [campaign_id, "campaign_id"], [goal_id, "goal_id"]]) { nonempty(value, label); assert(ID.test(value), `${label} is invalid`); }
  assert(runtimeRole.project_id === project_id, "runtime request project differs from Runtime");
  assert(runtimeRole.environment_id === environment_id, "runtime request environment differs from Runtime");
  assert(PROTECTED_ACTIONS.includes(action), "runtime action is not protected or recognized");
  assert(DIGEST.test(scope_digest), "runtime scope digest is invalid");
  nonempty(reason, "runtime request reason");
  assert(typeof requested_at_utc === "string" && UTC.test(requested_at_utc), "runtime requested_at_utc is invalid");
  validateOwnerApproval(owner_approval);
  const request = {schema: RUNTIME_REQUEST_SCHEMA, version: 1, status: "AUTHORIZED_REQUEST", authority_role: "RUNTIME", authority_digest: runtimeRole.digest, authority_host_session_id: runtimeRole.host_session_id, request_id, action, project_id, environment_id, campaign_id, goal_id, scope_digest, reason, requested_at_utc, owner_approval: {...owner_approval}, digest: null};
  request.digest = digestWithout(request, "digest");
  return request;
}

export function validateRuntimeRequest(request, {runtimeRole} = {}) {
  assertPortableRecord(request, "runtime request");
  validatePersistentRole(runtimeRole);
  assert(runtimeRole.role_id === "RUNTIME", "runtime request validator requires Runtime");
  exactKeys(request, ["schema", "version", "status", "authority_role", "authority_digest", "authority_host_session_id", "request_id", "action", "project_id", "environment_id", "campaign_id", "goal_id", "scope_digest", "reason", "requested_at_utc", "owner_approval", "digest"], "runtime request");
  assert(request.schema === RUNTIME_REQUEST_SCHEMA && request.version === 1 && request.status === "AUTHORIZED_REQUEST" && request.authority_role === "RUNTIME", "runtime request identity is invalid");
  assert(ID.test(request.request_id) && ID.test(request.project_id) && ID.test(request.environment_id) && ID.test(request.campaign_id) && ID.test(request.goal_id), "runtime request identity fields are invalid");
  assert(DIGEST.test(request.authority_digest) && DIGEST.test(request.scope_digest) && DIGEST.test(request.digest), "runtime request digest is invalid");
  assert(PROTECTED_ACTIONS.includes(request.action), "runtime request action is invalid");
  nonempty(request.reason, "runtime request reason");
  assert(typeof request.requested_at_utc === "string" && UTC.test(request.requested_at_utc), "runtime request requested_at_utc is invalid");
  assert(request.authority_digest === runtimeRole.digest && request.authority_host_session_id === runtimeRole.host_session_id, "runtime request authority differs from Runtime");
  assert(request.project_id === runtimeRole.project_id && request.environment_id === runtimeRole.environment_id, "runtime request project or environment differs from Runtime");
  validateOwnerApproval(request.owner_approval);
  assert(request.digest === digestWithout(request, "digest"), "runtime request digest does not match content");
  return request;
}
