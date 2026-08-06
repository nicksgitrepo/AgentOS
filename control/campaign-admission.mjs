import {assert, digestWithout} from "./canonical-json.mjs";
import {validateGoal} from "./campaign-state.mjs";
import {validateBootstrapPlan} from "./bootstrap-plan.mjs";
import {createOwnerContinuationRunner, validateOwnerContinuation} from "./owner-continuation.mjs";
import {copyWorkspaceBoundary, validateWorkspaceBoundary} from "./workspace-boundary.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {validateCampaignVersion, workerDisplayName} from "./campaign-names.mjs";
import {assertOpaqueReference, isOpaqueReference, opaqueReference} from "./opaque-reference.mjs";

export const CAMPAIGN_ADMISSION_SCHEMA = "agentos.campaign_admission.v1";
const ID = /^[A-Z][A-Z0-9._-]*$/u;
const TASK = /^[a-z][a-z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function validateSource(source) {
  exactKeys(source, ["source_commit", "source_tree", "worktree_id", "environment_id"], "campaign source binding");
  assert(COMMIT.test(source.source_commit) && COMMIT.test(source.source_tree), "campaign source commit/tree is invalid");
  nonempty(source.worktree_id, "campaign worktree_id");
  nonempty(source.environment_id, "campaign environment_id");
}

function lanePhase(plan, laneId) {
  const phase = plan.phases.find((candidate) => candidate.lane_ids.includes(laneId));
  assert(phase, `lane ${laneId} is not in the bootstrap plan`);
  return phase;
}

export function compileCampaignAdmission({plan, goal, project_id, campaign_id, campaign_version, lane_id, source, task_name, prompt}) {
  validateBootstrapPlan(plan);
  validateGoal(goal);
  assert(goal.status === "ACTIVE", "campaign admission requires an active goal");
  assert(typeof project_id === "string" && ID.test(project_id), "campaign project_id is invalid");
  assert(typeof campaign_id === "string" && ID.test(campaign_id), "campaign_id is invalid");
  validateCampaignVersion(campaign_version);
  assert(typeof lane_id === "string" && /^[a-z][a-z0-9._-]*$/u.test(lane_id), "campaign lane_id is invalid");
  assert(typeof task_name === "string" && TASK.test(task_name), "campaign task_name is invalid");
  nonempty(prompt, "campaign prompt");
  validateSource(source);
  validateWorkspaceBoundary(plan.workspace_boundary);
  const phase = lanePhase(plan, lane_id);
  const task_ref = isOpaqueReference(task_name, "task") ? task_name : opaqueReference("task", task_name, `${campaign_id}:${campaign_version}:${lane_id}:${goal.digest}`);
  const admission = {
    schema: CAMPAIGN_ADMISSION_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    project_id,
    campaign_id,
    campaign_version,
    phase_id: phase.phase_id,
    lane_id,
    role_id: "NAMED_LANE_WORKER",
    role_display_name: workerDisplayName(lane_id, campaign_version),
    goal_id: goal.goal_id,
    goal_sha256: goal.digest,
    source: {...source},
    workspace_boundary: copyWorkspaceBoundary(plan.workspace_boundary),
    governance_digest: plan.role_library_digest,
    task_name: task_ref,
    prompt,
    progress_window_minutes: plan.defaults.progress_window_minutes,
    digest: null,
  };
  admission.digest = digestWithout(admission, "digest");
  return validateCampaignAdmission(admission);
}

export function validateCampaignAdmission(admission) {
  exactKeys(admission, ["schema", "version", "status", "project_id", "campaign_id", "campaign_version", "phase_id", "lane_id", "role_id", "role_display_name", "goal_id", "goal_sha256", "source", "workspace_boundary", "governance_digest", "task_name", "prompt", "progress_window_minutes", "digest"], "campaign admission");
  assert(admission.schema === CAMPAIGN_ADMISSION_SCHEMA && admission.version === 1, "campaign admission identity is invalid");
  assert(admission.status === "PREPARED_NOT_ACTIVATED", "campaign admission status is invalid");
  for (const field of ["project_id", "campaign_id", "goal_id", "phase_id", "role_id"]) assert(ID.test(admission[field]), `campaign admission ${field} is invalid`);
  validateCampaignVersion(admission.campaign_version, "campaign admission campaign_version");
  assert(/^[a-z][a-z0-9._-]*$/u.test(admission.lane_id), "campaign admission lane is invalid");
  assert(admission.role_id === "NAMED_LANE_WORKER" && admission.role_display_name === workerDisplayName(admission.lane_id, admission.campaign_version), "campaign lane role is not dynamic");
  assert(DIGEST.test(admission.goal_sha256) && DIGEST.test(admission.governance_digest), "campaign admission digest binding is invalid");
  validateSource(admission.source);
  validateWorkspaceBoundary(admission.workspace_boundary);
  assertPortableRecord(admission, "campaign admission");
  assert(TASK.test(admission.task_name), "campaign task reference is invalid");
  assertOpaqueReference(admission.task_name, "task", "campaign admission task_name");
  assert(typeof admission.prompt === "string" && admission.prompt.length > 0, "campaign prompt is invalid");
  assert(Number.isInteger(admission.progress_window_minutes) && admission.progress_window_minutes === 15, "campaign progress window is invalid");
  assert(DIGEST.test(admission.digest) && admission.digest === digestWithout(admission, "digest"), "campaign admission digest does not match content");
  return admission;
}

export function toNativeAdmission(admission) {
  validateCampaignAdmission(admission);
  return {
    project_id: admission.project_id,
    campaign_id: admission.campaign_id,
    campaign_version: admission.campaign_version,
    goal_id: admission.goal_id,
    goal_sha256: admission.goal_sha256,
    lane_id: admission.lane_id,
    role_id: admission.role_id,
    role_display_name: admission.role_display_name,
    source_commit: admission.source.source_commit,
    source_tree: admission.source.source_tree,
    worktree_id: admission.source.worktree_id,
    environment_id: admission.source.environment_id,
    workspace_boundary: copyWorkspaceBoundary(admission.workspace_boundary),
    governance_digest: admission.governance_digest,
    task_name: admission.task_name,
    prompt: admission.prompt,
  };
}

export function createCampaignAdmissionRoute({admit}) {
  assert(typeof admit === "function", "campaign admission callback is required");
  const continuation = createOwnerContinuationRunner({admit});
  return Object.freeze({
    async recordOwnerAnswer(record, answer) {
      validateOwnerContinuation(record);
      return continuation.resumeAfterOwnerAnswer(record, answer);
    },
  });
}
