import {readFile} from "node:fs/promises";
import path from "node:path";
import {assert, compareUtf8, digestWithout, sortedUniqueStrings} from "./canonical-json.mjs";
import {validateBootstrapPlan} from "./bootstrap-plan.mjs";
import {validateGoal} from "./campaign-state.mjs";
import {compileRoleLibrary} from "./role-library.mjs";

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
  const value = `${slug(campaignId)}_${slug(campaignVersion)}_${laneId.replaceAll("-", "_")}_${suffix}`;
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

function validateAssignment(assignment, label) {
  exactKeys(assignment, ["lane_id", "graph_id", "role_id", "role_display_name", "task_name", "prompt", "status"], label);
  assert(LOWER_ID.test(assignment.lane_id), `${label}.lane_id is invalid`);
  assert(ID.test(assignment.graph_id), `${label}.graph_id is invalid`);
  assert(assignment.role_id === "NAMED_LANE_WORKER", `${label}.role_id is invalid`);
  assert(assignment.role_display_name === `${assignment.lane_id} Worker`, `${label}.role_display_name is invalid`);
  assert(LOWER_ID.test(assignment.task_name), `${label}.task_name is invalid`);
  nonempty(assignment.prompt, `${label}.prompt`);
  assert(assignment.status === "NOT_STARTED", `${label}.status is invalid`);
}

function validatePhase(phase, label) {
  exactKeys(phase, ["phase_id", "purpose", "worker_assignments", "auditor"], label);
  assert(ID.test(phase.phase_id), `${label}.phase_id is invalid`);
  nonempty(phase.purpose, `${label}.purpose`);
  assert(Array.isArray(phase.worker_assignments) && phase.worker_assignments.length > 0, `${label}.worker_assignments are empty`);
  const laneIds = phase.worker_assignments.map((assignment, index) => {
    validateAssignment(assignment, `${label}.worker_assignments[${index}]`);
    return assignment.lane_id;
  });
  assert(new Set(laneIds).size === laneIds.length, `${label} contains duplicate lanes`);
  exactKeys(phase.auditor, ["role_id", "display_name", "lifetime", "task_name", "prompt", "audit_lane_ids", "status"], `${label}.auditor`);
  assert(phase.auditor.role_id === "INDEPENDENT_AUDITOR" && phase.auditor.display_name === "Independent Auditor", `${label}.auditor identity is invalid`);
  assert(phase.auditor.lifetime === "CAMPAIGN_PHASE", `${label}.auditor lifetime is invalid`);
  assert(LOWER_ID.test(phase.auditor.task_name), `${label}.auditor.task_name is invalid`);
  nonempty(phase.auditor.prompt, `${label}.auditor.prompt`);
  sortedUniqueStrings(phase.auditor.audit_lane_ids, `${label}.auditor.audit_lane_ids`);
  assert(JSON.stringify([...phase.auditor.audit_lane_ids].sort(compareUtf8)) === JSON.stringify([...laneIds].sort(compareUtf8)), `${label}.auditor audit lanes do not cover the phase`);
  assert(phase.auditor.status === "NOT_STARTED", `${label}.auditor.status is invalid`);
  return laneIds;
}

export async function compileCampaignPlan(root, {plan, goal, campaign_id, campaign_version, source}) {
  validateBootstrapPlan(plan);
  validateGoal(goal);
  assert(goal.status === "ACTIVE", "campaign plan requires an active goal");
  assert(typeof campaign_id === "string" && ID.test(campaign_id), "campaign_id is invalid");
  assert(typeof campaign_version === "string" && ID.test(campaign_version), "campaign_version is invalid");
  assert(plan.project_id.length > 0, "bootstrap plan project identity is missing");
  validateSource(source);
  const manifest = validateLaneManifest(await readJson(root, "governance/lane-manifest.json"));
  const roleLibrary = await compileRoleLibrary(root);
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
        role_display_name: `${laneId} Worker`,
        task_name: taskName(campaign_id, campaign_version, laneId, "worker"),
        prompt: `Work only on the admitted ${laneId} lane. Return meaningful progress and a typed handoff with evidence before the fifteen-minute window ends.`,
        status: "NOT_STARTED",
      };
    }),
    auditor: {
      role_id: "INDEPENDENT_AUDITOR",
      display_name: "Independent Auditor",
      lifetime: "CAMPAIGN_PHASE",
      task_name: taskName(campaign_id, campaign_version, phase.phase_id.toLowerCase(), "auditor"),
      prompt: `Independently review every accepted result in ${phase.phase_id}. Do not accept work authored by your own session.`,
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
  exactKeys(plan, ["schema", "version", "status", "project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256", "source", "defaults", "persistent_roles", "campaign_roles", "phases", "role_library_digest", "digest"], "campaign plan");
  assert(plan.schema === CAMPAIGN_PLAN_SCHEMA && plan.version === 1, "campaign plan identity is invalid");
  assert(plan.status === "PREPARED_NOT_ACTIVATED", "campaign plan must remain prepared");
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id"]) assert(ID.test(plan[field]), `campaign plan ${field} is invalid`);
  assert(DIGEST.test(plan.goal_sha256) && DIGEST.test(plan.role_library_digest), "campaign plan digest binding is invalid");
  validateSource(plan.source);
  exactKeys(plan.defaults, ["model", "reasoning_effort", "progress_window_minutes"], "campaign plan defaults");
  assert(plan.defaults.model === "gpt-5.6-luna" && plan.defaults.reasoning_effort === "max" && plan.defaults.progress_window_minutes === 15, "campaign plan defaults are invalid");
  assert(JSON.stringify(plan.persistent_roles) === JSON.stringify(["INTENT_REGULATOR", "RUNTIME"]), "campaign persistent roles are invalid");
  assert(JSON.stringify(plan.campaign_roles) === JSON.stringify(["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR"]), "campaign roles are invalid");
  assert(Array.isArray(plan.phases) && plan.phases.length > 0, "campaign phases are empty");
  const lanes = plan.phases.flatMap((phase, index) => validatePhase(phase, `campaign phases[${index}]`));
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
  for (const [index, result] of run.phase_results.entries()) {
    exactKeys(result, ["phase_id", "lane_ids", "reviewed_lane_ids", "auditor_session_id", "acceptance_digest", "status"], `campaign phase result ${index}`);
    const phase = plan.phases.find((candidate) => candidate.phase_id === result.phase_id);
    assert(phase, `campaign phase result ${index} names an unknown phase`);
    sortedUniqueStrings(result.lane_ids, `campaign phase result ${index}.lane_ids`);
    sortedUniqueStrings(result.reviewed_lane_ids, `campaign phase result ${index}.reviewed_lane_ids`);
    assert(JSON.stringify(result.lane_ids) === JSON.stringify(result.reviewed_lane_ids), `campaign phase result ${index} was not fully reviewed`);
    assert(JSON.stringify(result.lane_ids) === JSON.stringify([...phase.auditor.audit_lane_ids].sort(compareUtf8)), `campaign phase result ${index} lane coverage differs from plan`);
    nonempty(result.auditor_session_id, `campaign phase result ${index}.auditor_session_id`);
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

function validateCandidate(candidate, assignment, phase) {
  exactKeys(candidate, ["status", "phase_id", "lane_id", "result_digest", "worker_session_id"], "lane candidate");
  assert(candidate.status === "AUDIT_CANDIDATE" && candidate.phase_id === phase.phase_id && candidate.lane_id === assignment.lane_id, "lane candidate identity differs");
  assert(DIGEST.test(candidate.result_digest), "lane candidate result digest is invalid");
  nonempty(candidate.worker_session_id, "lane candidate worker session");
  return candidate;
}

function validateAuditorReadback(readback, plan, phase) {
  exactKeys(readback, ["thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "phase_id", "role_id", "source_commit", "source_tree", "worktree_id"], "Auditor readback");
  for (const [value, label] of [[readback.thread_id, "Auditor readback.thread_id"], [readback.host_id, "Auditor readback.host_id"], [readback.project_id, "Auditor readback.project_id"], [readback.campaign_id, "Auditor readback.campaign_id"], [readback.campaign_version, "Auditor readback.campaign_version"], [readback.goal_id, "Auditor readback.goal_id"], [readback.phase_id, "Auditor readback.phase_id"], [readback.worktree_id, "Auditor readback.worktree_id"]]) nonempty(value, label);
  assert(readback.role_id === "INDEPENDENT_AUDITOR", "Auditor readback role is invalid");
  assert(readback.project_id === plan.project_id && readback.campaign_id === plan.campaign_id && readback.campaign_version === plan.campaign_version && readback.goal_id === plan.goal_id && readback.phase_id === phase.phase_id, "Auditor readback campaign identity differs");
  assert(readback.source_commit === plan.source.source_commit && readback.source_tree === plan.source.source_tree && readback.worktree_id === plan.source.worktree_id, "Auditor readback source identity differs");
  return readback;
}

function validatePhaseAcceptance(acceptance, phase, candidates, plan) {
  exactKeys(acceptance, ["status", "reviewer_role_id", "reviewer_session_id", "auditor_readback", "evidence_sha256", "reason", "lane_results", "reviewed_lane_ids", "acceptance_digest"], "phase acceptance");
  assert(acceptance.status === "ACCEPTED" && acceptance.reviewer_role_id === "INDEPENDENT_AUDITOR", "phase acceptance is not independent");
  nonempty(acceptance.reviewer_session_id, "phase acceptance reviewer session");
  const auditorReadback = validateAuditorReadback(acceptance.auditor_readback, plan, phase);
  assert(acceptance.reviewer_session_id === auditorReadback.host_id, "phase acceptance reviewer does not match Auditor readback");
  assert(DIGEST.test(acceptance.evidence_sha256), "phase acceptance evidence is invalid");
  nonempty(acceptance.reason, "phase acceptance reason");
  assert(Array.isArray(acceptance.lane_results) && acceptance.lane_results.length === candidates.length, "phase acceptance lane count differs");
  sortedUniqueStrings(acceptance.reviewed_lane_ids, "phase acceptance reviewed_lane_ids");
  const expected = new Map(candidates.map((candidate) => [candidate.lane_id, candidate]));
  assert(expected.size === candidates.length, "phase candidates contain duplicate lanes");
  assert(new Set(candidates.map((candidate) => candidate.worker_session_id)).size === candidates.length, "phase candidates reuse a worker session");
  const seen = new Set();
  for (const [index, item] of acceptance.lane_results.entries()) {
    exactKeys(item, ["lane_id", "result_digest", "worker_session_id"], `phase acceptance lane ${index}`);
    const candidate = expected.get(item.lane_id);
    assert(candidate && !seen.has(item.lane_id), `phase acceptance lane ${item.lane_id} is missing or duplicated`);
    assert(item.result_digest === candidate.result_digest && item.worker_session_id === candidate.worker_session_id, `phase acceptance lane ${item.lane_id} differs from candidate`);
    assert(item.worker_session_id !== acceptance.reviewer_session_id, "Auditor cannot accept its own result");
    seen.add(item.lane_id);
  }
  assert(seen.size === expected.size, "phase acceptance did not cover every lane");
  assert(JSON.stringify(acceptance.reviewed_lane_ids) === JSON.stringify([...expected.keys()].sort(compareUtf8)), "phase acceptance reviewed lane coverage differs");
  assert(DIGEST.test(acceptance.acceptance_digest) && acceptance.acceptance_digest === digestWithout(acceptance, "acceptance_digest"), "phase acceptance digest does not match content");
  return acceptance;
}

export function recordPhaseAcceptance(run, plan, {phase_id, candidates, acceptance}) {
  validateCampaignPlan(plan);
  validateRun(run, plan);
  assert(run.status === "ACTIVE", "campaign run is not active");
  const phase = plan.phases[run.phase_index];
  assert(phase && phase.phase_id === phase_id, "phase acceptance is out of order");
  assert(run.lane_index === 0, "phase acceptance requires all lane candidates together");
  assert(Array.isArray(candidates) && candidates.length === phase.worker_assignments.length, "phase candidates are incomplete");
  for (const assignment of phase.worker_assignments) {
    const candidate = candidates.find((item) => item.lane_id === assignment.lane_id);
    assert(candidate, `missing candidate for ${assignment.lane_id}`);
    validateCandidate(candidate, assignment, phase);
  }
  const priorSessions = new Set(run.lane_results.map((item) => item.worker_session_id));
  assert(candidates.every((candidate) => !priorSessions.has(candidate.worker_session_id)), "campaign reuses a worker session across phases");
  assert(!run.phase_results.some((item) => item.auditor_session_id === acceptance.reviewer_session_id), "campaign reuses an Auditor session across phases");
  validatePhaseAcceptance(acceptance, phase, candidates, plan);
  const laneResults = candidates.map((candidate) => ({phase_id, lane_id: candidate.lane_id, result_digest: candidate.result_digest, worker_session_id: candidate.worker_session_id})).sort((left, right) => compareUtf8(left.lane_id, right.lane_id));
  const phaseResult = {phase_id, lane_ids: laneResults.map((item) => item.lane_id), reviewed_lane_ids: [...acceptance.reviewed_lane_ids], auditor_session_id: acceptance.reviewer_session_id, acceptance_digest: acceptance.acceptance_digest, status: "ACCEPTED"};
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

export async function runCampaign({plan, runLane, acceptPhase}) {
  validateCampaignPlan(plan);
  assert(typeof runLane === "function" && typeof acceptPhase === "function", "campaign runner callbacks are required");
  let run = createCampaignRun(plan);
  for (const phase of plan.phases) {
    const candidates = [];
    for (const assignment of phase.worker_assignments) {
      const candidate = await runLane(assignment, {phase, plan, run});
      candidates.push(validateCandidate(candidate, assignment, phase));
    }
    const acceptance = await acceptPhase({phase, plan, run, candidates});
    run = recordPhaseAcceptance(run, plan, {phase_id: phase.phase_id, candidates, acceptance});
  }
  assert(run.status === "COMPLETE", "campaign did not reach complete state");
  return run;
}
