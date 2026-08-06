import {readFile} from "node:fs/promises";
import path from "node:path";
import {assert, compareUtf8, digestWithout, sortedUniqueStrings} from "./canonical-json.mjs";
import {validateBootstrapPlan} from "./bootstrap-plan.mjs";
import {validateGoal} from "./campaign-state.mjs";
import {compileRoleLibrary} from "./role-library.mjs";
import {copyWorkspaceBoundary, validateWorkspaceBoundary} from "./workspace-boundary.mjs";
import {assertPortableRecord} from "./portable-record.mjs";
import {auditorDisplayName, validateCampaignVersion, workerDisplayName} from "./campaign-names.mjs";
import {auditorPrompt, workerPrompt} from "./campaign-prompts.mjs";
import {assertOpaqueReference, opaqueReference} from "./opaque-reference.mjs";
import {normalizeAcceptance, normalizeCandidate, validateAuditorReadback, validateCandidate, validatePhaseAcceptance} from "./campaign-records.mjs";

export const CAMPAIGN_PLAN_SCHEMA = "agentos.campaign_plan.v1";
export const CAMPAIGN_RUN_SCHEMA = "agentos.campaign_run.v1";

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const LOWER_ID = /^[a-z][a-z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function validateSource(source, label = "campaign source") {
  exactKeys(source, ["source_commit", "source_tree", "worktree_id", "environment_id"], label);
  assert(COMMIT.test(source.source_commit) && COMMIT.test(source.source_tree), `${label} commit/tree is invalid`);
  for (const field of ["worktree_id", "environment_id"]) nonempty(source[field], `${label}.${field}`);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function taskName(campaignId, campaignVersion, laneId, suffix) {
  const raw = `${slug(campaignId)}_${slug(campaignVersion)}_${laneId.replaceAll("-", "_")}_${suffix}`;
  const value = opaqueReference("task", raw, `${campaignId}:${campaignVersion}:${laneId}:${suffix}`);
  assert(LOWER_ID.test(value), `campaign task name is invalid: ${value}`);
  return value;
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function validateLaneManifest(manifest) {
  assert(manifest?.schema === "agentos.lane_manifest.v1" && manifest.version === 1, "lane manifest identity is invalid");
  assert(manifest.status === "PREPARED_NOT_ACTIVATED", "lane manifest is active");
  assert(DIGEST.test(manifest.digest) && manifest.digest === digestWithout(manifest, "digest"), "lane manifest digest is invalid");
  assert(Array.isArray(manifest.lanes) && manifest.lanes.length === 12, "lane manifest must contain twelve lanes");
  return manifest;
}

function validateRoleLibraryBinding(library) {
  assert(library && typeof library === "object" && !Array.isArray(library), "campaign role library is required");
  assert(DIGEST.test(library.digest) && Array.isArray(library.packets) && library.packets.length > 0, "campaign role library binding is invalid");
  return library;
}

function validateAssignment(assignment, label, campaign_version) {
  exactKeys(assignment, ["lane_id", "graph_id", "role_id", "role_display_name", "task_name", "prompt", "status"], label);
  assert(LOWER_ID.test(assignment.lane_id), `${label}.lane_id is invalid`);
  assert(ID.test(assignment.graph_id), `${label}.graph_id is invalid`);
  assert(assignment.role_id === "NAMED_LANE_WORKER", `${label}.role_id is invalid`);
  assert(assignment.role_display_name === workerDisplayName(assignment.lane_id, campaign_version), `${label}.role_display_name is invalid`);
  assert(LOWER_ID.test(assignment.task_name), `${label}.task_name is invalid`);
  assertOpaqueReference(assignment.task_name, "task", `${label}.task_name`);
  nonempty(assignment.prompt, `${label}.prompt`);
  assert(assignment.status === "NOT_STARTED", `${label}.status is invalid`);
}

function validatePhase(phase, label, campaign_version) {
  exactKeys(phase, ["phase_id", "purpose", "worker_assignments", "auditor"], label);
  assert(ID.test(phase.phase_id), `${label}.phase_id is invalid`);
  nonempty(phase.purpose, `${label}.purpose`);
  assert(Array.isArray(phase.worker_assignments) && phase.worker_assignments.length > 0, `${label}.worker_assignments are empty`);
  const laneIds = phase.worker_assignments.map((assignment, index) => {
    validateAssignment(assignment, `${label}.worker_assignments[${index}]`, campaign_version);
    return assignment.lane_id;
  });
  assert(new Set(laneIds).size === laneIds.length, `${label} contains duplicate lanes`);
  exactKeys(phase.auditor, ["role_id", "display_name", "lifetime", "task_name", "prompt", "audit_lane_ids", "status"], `${label}.auditor`);
  assert(phase.auditor.role_id === "INDEPENDENT_AUDITOR" && phase.auditor.display_name === auditorDisplayName(phase.phase_id, campaign_version), `${label}.auditor identity is invalid`);
  assert(phase.auditor.lifetime === "CAMPAIGN_PHASE", `${label}.auditor lifetime is invalid`);
  assert(LOWER_ID.test(phase.auditor.task_name), `${label}.auditor.task_name is invalid`);
  assertOpaqueReference(phase.auditor.task_name, "task", `${label}.auditor.task_name`);
  nonempty(phase.auditor.prompt, `${label}.auditor.prompt`);
  sortedUniqueStrings(phase.auditor.audit_lane_ids, `${label}.auditor.audit_lane_ids`);
  assert(JSON.stringify([...phase.auditor.audit_lane_ids].sort(compareUtf8)) === JSON.stringify([...laneIds].sort(compareUtf8)), `${label}.auditor audit lanes do not cover the phase`);
  assert(phase.auditor.status === "NOT_STARTED", `${label}.auditor.status is invalid`);
  return laneIds;
}

export async function compileCampaignPlan(root, {plan, goal, campaign_id, campaign_version, source, role_library = null}) {
  validateBootstrapPlan(plan);
  validateGoal(goal);
  assert(goal.status === "ACTIVE", "campaign plan requires an active goal");
  assert(typeof campaign_id === "string" && ID.test(campaign_id), "campaign_id is invalid");
  validateCampaignVersion(campaign_version);
  assert(plan.project_id.length > 0, "bootstrap plan project identity is missing");
  validateSource(source);
  const manifest = validateLaneManifest(await readJson(root, "governance/lane-manifest.json"));
  const roleLibrary = validateRoleLibraryBinding(role_library ?? await compileRoleLibrary(root));
  const lanes = new Map(manifest.lanes.map((lane) => [lane.lane_id, lane]));
  const workerPackets = new Set(roleLibrary.packets.filter((packet) => packet.role_id === "NAMED_LANE_WORKER").map((packet) => packet.lane_id));
  const phases = plan.phases.map((phase) => ({
    phase_id: phase.phase_id,
    purpose: phase.purpose,
    worker_assignments: phase.lane_ids.map((laneId) => {
      const lane = lanes.get(laneId);
      assert(lane && workerPackets.has(laneId), `campaign lane ${laneId} has no compiled worker packet`);
      return {
        lane_id: laneId,
        graph_id: lane.graph_id,
        role_id: "NAMED_LANE_WORKER",
        role_display_name: workerDisplayName(laneId, campaign_version),
        task_name: taskName(campaign_id, campaign_version, laneId, "worker"),
        prompt: workerPrompt(goal, laneId),
        status: "NOT_STARTED",
      };
    }),
    auditor: {
      role_id: "INDEPENDENT_AUDITOR",
      display_name: auditorDisplayName(phase.phase_id, campaign_version),
      lifetime: "CAMPAIGN_PHASE",
      task_name: taskName(campaign_id, campaign_version, phase.phase_id.toLowerCase(), "auditor"),
      prompt: auditorPrompt(goal, phase.phase_id),
      audit_lane_ids: [...phase.lane_ids].sort(compareUtf8),
      status: "NOT_STARTED",
    },
  }));
  const campaignPlan = {
    schema: CAMPAIGN_PLAN_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    project_id: plan.project_id,
    campaign_id,
    campaign_version,
    goal_id: goal.goal_id,
    goal_sha256: goal.digest,
    source: {...source},
    workspace_boundary: copyWorkspaceBoundary(plan.workspace_boundary),
    defaults: {...plan.defaults},
    persistent_roles: ["INTENT_REGULATOR", "RUNTIME"],
    campaign_roles: ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR"],
    phases,
    role_library_digest: roleLibrary.digest,
    digest: null,
  };
  campaignPlan.digest = digestWithout(campaignPlan, "digest");
  return validateCampaignPlan(campaignPlan);
}

export function validateCampaignPlan(plan) {
  exactKeys(plan, ["schema", "version", "status", "project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256", "source", "workspace_boundary", "defaults", "persistent_roles", "campaign_roles", "phases", "role_library_digest", "digest"], "campaign plan");
  assert(plan.schema === CAMPAIGN_PLAN_SCHEMA && plan.version === 1, "campaign plan identity is invalid");
  assert(plan.status === "PREPARED_NOT_ACTIVATED", "campaign plan must remain prepared");
  for (const field of ["project_id", "campaign_id", "goal_id"]) assert(ID.test(plan[field]), `campaign plan ${field} is invalid`);
  validateCampaignVersion(plan.campaign_version, "campaign plan campaign_version");
  assert(DIGEST.test(plan.goal_sha256) && DIGEST.test(plan.role_library_digest), "campaign plan digest binding is invalid");
  validateSource(plan.source);
  validateWorkspaceBoundary(plan.workspace_boundary);
  assertPortableRecord(plan, "campaign plan");
  exactKeys(plan.defaults, ["model", "reasoning_effort", "progress_window_minutes"], "campaign plan defaults");
  assert(plan.defaults.model === "gpt-5.6-luna" && plan.defaults.reasoning_effort === "max" && plan.defaults.progress_window_minutes === 15, "campaign plan defaults are invalid");
  assert(JSON.stringify(plan.persistent_roles) === JSON.stringify(["INTENT_REGULATOR", "RUNTIME"]), "campaign persistent roles are invalid");
  assert(JSON.stringify(plan.campaign_roles) === JSON.stringify(["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR"]), "campaign roles are invalid");
  assert(Array.isArray(plan.phases) && plan.phases.length > 0, "campaign phases are empty");
  const lanes = plan.phases.flatMap((phase, index) => validatePhase(phase, `campaign phases[${index}]`, plan.campaign_version));
  assert(new Set(lanes).size === lanes.length, "campaign plan repeats a lane");
  assert(lanes.length === 12, "campaign plan must cover all twelve lanes");
  assert(DIGEST.test(plan.digest) && plan.digest === digestWithout(plan, "digest"), "campaign plan digest does not match content");
  return plan;
}

function validateRun(run, plan) {
  exactKeys(run, ["schema", "version", "status", "plan_digest", "project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256", "phase_index", "lane_index", "lane_results", "phase_results", "digest"], "campaign run");
  assert(run.schema === CAMPAIGN_RUN_SCHEMA && run.version === 1, "campaign run identity is invalid");
  assert(["ACTIVE", "COMPLETE"].includes(run.status), "campaign run status is invalid");
  assert(run.plan_digest === plan.digest && run.project_id === plan.project_id && run.campaign_id === plan.campaign_id && run.campaign_version === plan.campaign_version && run.goal_id === plan.goal_id && run.goal_sha256 === plan.goal_sha256, "campaign run binding differs from plan");
  assert(Number.isInteger(run.phase_index) && run.phase_index >= 0 && run.phase_index <= plan.phases.length, "campaign run phase index is invalid");
  assert(Number.isInteger(run.lane_index) && run.lane_index >= 0, "campaign run lane index is invalid");
  assert(Array.isArray(run.lane_results) && Array.isArray(run.phase_results), "campaign run results are invalid");
  assertPortableRecord(run, "campaign run");
  for (const [index, result] of run.phase_results.entries()) {
    exactKeys(result, ["phase_id", "lane_ids", "reviewed_lane_ids", "auditor_session_id", "acceptance_digest", "status"], `campaign phase result ${index}`);
    const phase = plan.phases.find((candidate) => candidate.phase_id === result.phase_id);
    assert(phase, `campaign phase result ${index} names an unknown phase`);
    sortedUniqueStrings(result.lane_ids, `campaign phase result ${index}.lane_ids`);
    sortedUniqueStrings(result.reviewed_lane_ids, `campaign phase result ${index}.reviewed_lane_ids`);
    assert(JSON.stringify(result.lane_ids) === JSON.stringify(result.reviewed_lane_ids), `campaign phase result ${index} was not fully reviewed`);
    assert(JSON.stringify(result.lane_ids) === JSON.stringify([...phase.auditor.audit_lane_ids].sort(compareUtf8)), `campaign phase result ${index} lane coverage differs from plan`);
    assertOpaqueReference(result.auditor_session_id, "session", `campaign phase result ${index}.auditor_session_id`);
    assert(DIGEST.test(result.acceptance_digest) && result.status === "ACCEPTED", `campaign phase result ${index} is invalid`);
  }
  assert(DIGEST.test(run.digest) && run.digest === digestWithout(run, "digest"), "campaign run digest does not match content");
  return run;
}

export function createCampaignRun(plan) {
  validateCampaignPlan(plan);
  const run = {
    schema: CAMPAIGN_RUN_SCHEMA,
    version: 1,
    status: "ACTIVE",
    plan_digest: plan.digest,
    project_id: plan.project_id,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    goal_id: plan.goal_id,
    goal_sha256: plan.goal_sha256,
    phase_index: 0,
    lane_index: 0,
    lane_results: [],
    phase_results: [],
    digest: null,
  };
  run.digest = digestWithout(run, "digest");
  return validateRun(run, plan);
}

export function recordPhaseAcceptance(run, plan, {phase_id, candidates, acceptance, secretValues = []}) {
  validateCampaignPlan(plan);
  validateRun(run, plan);
  assert(run.status === "ACTIVE", "campaign run is not active");
  const phase = plan.phases[run.phase_index];
  assert(phase && phase.phase_id === phase_id, "phase acceptance is out of order");
  assert(run.lane_index === 0, "phase acceptance requires all lane candidates together");
  assert(Array.isArray(candidates) && candidates.length === phase.worker_assignments.length, "phase candidates are incomplete");
  const normalizedCandidates = candidates.map((candidate) => normalizeCandidate(candidate, plan));
  const normalizedAcceptance = normalizeAcceptance(acceptance, plan);
  for (const assignment of phase.worker_assignments) {
    const candidate = normalizedCandidates.find((item) => item.lane_id === assignment.lane_id);
    assert(candidate, `missing candidate for ${assignment.lane_id}`);
    validateCandidate(candidate, assignment, phase);
  }
  const priorSessions = new Set(run.lane_results.map((item) => item.worker_session_id));
  assert(normalizedCandidates.every((candidate) => !priorSessions.has(candidate.worker_session_id)), "campaign reuses a worker session across phases");
  assert(!run.phase_results.some((item) => item.auditor_session_id === normalizedAcceptance.reviewer_session_id), "campaign reuses an Auditor session across phases");
  validatePhaseAcceptance(normalizedAcceptance, phase, normalizedCandidates, plan, {secretValues});
  const laneResults = normalizedCandidates.map((candidate) => ({phase_id, lane_id: candidate.lane_id, result_digest: candidate.result_digest, worker_session_id: candidate.worker_session_id})).sort((left, right) => compareUtf8(left.lane_id, right.lane_id));
  const phaseResult = {phase_id, lane_ids: laneResults.map((item) => item.lane_id), reviewed_lane_ids: [...normalizedAcceptance.reviewed_lane_ids], auditor_session_id: normalizedAcceptance.reviewer_session_id, acceptance_digest: normalizedAcceptance.acceptance_digest, status: "ACCEPTED"};
  const completed = run.phase_index + 1 >= plan.phases.length;
  const next = {
    ...run,
    status: completed ? "COMPLETE" : "ACTIVE",
    phase_index: completed ? plan.phases.length : run.phase_index + 1,
    lane_index: 0,
    lane_results: [...run.lane_results, ...laneResults],
    phase_results: [...run.phase_results, phaseResult],
    digest: null,
  };
  next.digest = digestWithout(next, "digest");
  return validateRun(next, plan);
}

export async function runCampaign({plan, runLane, acceptPhase, secretValues = []}) {
  validateCampaignPlan(plan);
  assert(typeof runLane === "function" && typeof acceptPhase === "function", "campaign runner callbacks are required");
  let run = createCampaignRun(plan);
  for (const phase of plan.phases) {
    const candidates = [];
    for (const assignment of phase.worker_assignments) {
      const candidate = await runLane(assignment, {phase, plan, run});
      const normalized = normalizeCandidate(candidate, plan);
      candidates.push(validateCandidate(normalized, assignment, phase));
    }
    const acceptance = await acceptPhase({phase, plan, run, candidates});
    run = recordPhaseAcceptance(run, plan, {phase_id: phase.phase_id, candidates, acceptance, secretValues});
  }
  assert(run.status === "COMPLETE", "campaign did not reach complete state");
  return run;
}
