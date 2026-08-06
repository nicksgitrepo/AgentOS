import {assert, digestWithout} from "./canonical-json.mjs";
import {authorizeRuntimeRequest, validateOwnerApproval, validateRuntimeRequest} from "./runtime-authority.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {validateCampaignVersion} from "./campaign-names.mjs";

export const DELIVERY_CHOICE_SCHEMA = "agentos.delivery_choice.v1";
export const DELIVERY_MODES = Object.freeze(["ACCEPTED_RESULT", "LOCAL_ONLY", "PUSH", "MERGE", "DEPLOY", "RELEASE"]);

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ACTIONS = Object.freeze({PUSH: "PUSH", MERGE: "MERGE", DEPLOY: "DEPLOY", RELEASE: "PUBLISH"});

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function validateIdentity(choice) {
  for (const [value, label] of [[choice.project_id, "delivery project_id"], [choice.campaign_id, "delivery campaign_id"], [choice.goal_id, "delivery goal_id"], [choice.worktree_id, "delivery worktree_id"], [choice.environment_id, "delivery environment_id"]]) { nonempty(value, label); assert(ID.test(value), `${label} is invalid`); }
  validateCampaignVersion(choice.campaign_version, "delivery campaign_version");
  assert(COMMIT.test(choice.source_commit) && COMMIT.test(choice.source_tree), "delivery source identity is invalid");
}

export function compileDeliveryChoice({choice_id, mode, project_id, campaign_id, campaign_version, goal_id, accepted_result_digest, final_audit_digest, source_commit, source_tree, worktree_id, environment_id, owner_approval, selected_at_utc}) {
  exactKeys({choice_id, mode, project_id, campaign_id, campaign_version, goal_id, accepted_result_digest, final_audit_digest, source_commit, source_tree, worktree_id, environment_id, owner_approval, selected_at_utc}, ["choice_id", "mode", "project_id", "campaign_id", "campaign_version", "goal_id", "accepted_result_digest", "final_audit_digest", "source_commit", "source_tree", "worktree_id", "environment_id", "owner_approval", "selected_at_utc"], "delivery choice input");
  const choice = {schema: DELIVERY_CHOICE_SCHEMA, version: 1, status: "PREPARED_NOT_ACTIVATED", choice_id, mode, project_id, campaign_id, campaign_version, goal_id, accepted_result_digest, final_audit_digest, source_commit, source_tree, worktree_id, environment_id, owner_approval: {...owner_approval}, selected_at_utc, digest: null};
  choice.digest = digestWithout(choice, "digest");
  return validateDeliveryChoice(choice);
}

export function validateDeliveryChoice(choice) {
  assertPortableRecord(choice, "delivery choice");
  exactKeys(choice, ["schema", "version", "status", "choice_id", "mode", "project_id", "campaign_id", "campaign_version", "goal_id", "accepted_result_digest", "final_audit_digest", "source_commit", "source_tree", "worktree_id", "environment_id", "owner_approval", "selected_at_utc", "digest"], "delivery choice");
  assert(choice.schema === DELIVERY_CHOICE_SCHEMA && choice.version === 1 && choice.status === "PREPARED_NOT_ACTIVATED", "delivery choice identity is invalid");
  assert(ID.test(choice.choice_id), "delivery choice_id is invalid");
  assert(DELIVERY_MODES.includes(choice.mode), "delivery mode is invalid");
  validateIdentity(choice);
  assert(DIGEST.test(choice.accepted_result_digest) && DIGEST.test(choice.final_audit_digest), "delivery proof digests are invalid");
  validateOwnerApproval(choice.owner_approval);
  assert(choice.owner_approval.accepted_result_digest === choice.accepted_result_digest && choice.owner_approval.final_audit_digest === choice.final_audit_digest, "owner approval does not name the accepted result and final audit");
  assert(typeof choice.selected_at_utc === "string" && UTC.test(choice.selected_at_utc), "delivery selected_at_utc is invalid");
  assert(DIGEST.test(choice.digest) && choice.digest === digestWithout(choice, "digest"), "delivery choice digest does not match content");
  return choice;
}

export function authorizeSelectedDelivery(runtimeRole, choice, {request_id, reason, requested_at_utc}) {
  validateDeliveryChoice(choice);
  if (choice.mode === "ACCEPTED_RESULT" || choice.mode === "LOCAL_ONLY") {
    const result = {schema: "agentos.delivery_authorization.v1", version: 1, status: "NO_EXTERNAL_ACTION", choice_digest: choice.digest, digest: null};
    result.digest = digestWithout(result, "digest");
    return result;
  }
  const action = ACTIONS[choice.mode];
  assert(action, "delivery mode has no Runtime action");
  const request = authorizeRuntimeRequest(runtimeRole, {
    request_id,
    action,
    project_id: choice.project_id,
    environment_id: choice.environment_id,
    campaign_id: choice.campaign_id,
    goal_id: choice.goal_id,
    scope_digest: choice.digest,
    reason,
    requested_at_utc,
    owner_approval: choice.owner_approval,
  });
  return validateRuntimeRequest(request, {runtimeRole});
}
