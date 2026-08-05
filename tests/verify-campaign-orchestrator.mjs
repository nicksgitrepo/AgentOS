#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {compileCampaignPlan, createCampaignRun, recordPhaseAcceptance, runCampaign, validateCampaignPlan} from "../control/campaign-orchestrator.mjs";
import {createGoal} from "../control/campaign-state.mjs";
import {digestWithout, sha256} from "../control/canonical-json.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001", environment_id: "ENV-001"};
const workspace_boundary = compileWorkspaceBoundary({release_root: "/workspace/AgentOS", projects_root: "/workspace/projects", project_root: "/workspace/projects/example-project", control_root: "/workspace/AgentOS-control"});
const bootstrapPlan = await compileBootstrapPlan(ROOT, {
  project_id: "PROJECT-001",
  owner_context: {objective: "Build a small working result"},
  source_binding: {...source, bootstrap_session_id: "BOOTSTRAP-001"},
  workspace_boundary,
});
const goal = createGoal({goal_id: "GOAL-001", objective: "Build the first working result", scope: {all_lanes: true}, intent: {outcome: "working"}, boundaries: {hard: ["no release"], soft: ["review"]}, created_at_utc: "2026-01-01T00:00:00.000Z"});
const plan = await compileCampaignPlan(ROOT, {plan: bootstrapPlan, goal, campaign_id: "CAMPAIGN-001", campaign_version: "V1", source});
assert.equal(validateCampaignPlan(plan).digest, plan.digest);
assert.equal(plan.phases.length, 4);
assert.equal(plan.phases.flatMap((phase) => phase.worker_assignments).length, 12);
assert(plan.phases.every((phase) => phase.auditor.role_id === "INDEPENDENT_AUDITOR"));
assert(plan.phases.flatMap((phase) => phase.worker_assignments).every((assignment) => assignment.role_display_name.endsWith(" Worker")));
assert.equal(plan.workspace_boundary.project_state_policy, "NEVER_WRITE_OR_STORE_AGENTOS_ARTIFACTS");
const auditorReadbackFor = (phase) => ({thread_id: `${phase.phase_id}-THREAD-001`, host_id: `${phase.phase_id}-AUDITOR-001`, project_id: plan.project_id, campaign_id: plan.campaign_id, campaign_version: plan.campaign_version, goal_id: plan.goal_id, phase_id: phase.phase_id, role_id: "INDEPENDENT_AUDITOR", source_commit: source.source_commit, source_tree: source.source_tree, worktree_id: source.worktree_id});
const duplicatePhase = plan.phases[0];
const duplicateCandidates = duplicatePhase.worker_assignments.map((assignment) => ({status: "AUDIT_CANDIDATE", phase_id: duplicatePhase.phase_id, lane_id: assignment.lane_id, result_digest: sha256(assignment.lane_id), worker_session_id: "SAME-WORKER-SESSION"}));
const duplicateAcceptance = {
  status: "ACCEPTED",
  reviewer_role_id: "INDEPENDENT_AUDITOR",
  reviewer_session_id: "PHASE-AUDITOR-001",
  auditor_readback: auditorReadbackFor(duplicatePhase),
  evidence_sha256: "e".repeat(64),
  reason: "duplicate hostile fixture",
  lane_results: duplicateCandidates.map(({lane_id, result_digest, worker_session_id}) => ({lane_id, result_digest, worker_session_id})),
  reviewed_lane_ids: duplicateCandidates.map(({lane_id}) => lane_id).sort(),
  acceptance_digest: null,
};
duplicateAcceptance.reviewer_session_id = duplicateAcceptance.auditor_readback.host_id;
duplicateAcceptance.acceptance_digest = digestWithout(duplicateAcceptance, "acceptance_digest");
assert.throws(() => recordPhaseAcceptance(createCampaignRun(plan), plan, {phase_id: duplicatePhase.phase_id, candidates: duplicateCandidates, acceptance: duplicateAcceptance}), /reuse a worker session/u);

const run = await runCampaign({
  plan,
  async runLane(assignment, {phase}) {
    return {
      status: "AUDIT_CANDIDATE",
      phase_id: phase.phase_id,
      lane_id: assignment.lane_id,
      result_digest: sha256({phase: phase.phase_id, lane: assignment.lane_id}),
      worker_session_id: `${assignment.lane_id.toUpperCase().replaceAll("-", "_")}-WORKER-001`,
    };
  },
  async acceptPhase({phase, candidates}) {
    const acceptance = {
      status: "ACCEPTED",
      reviewer_role_id: "INDEPENDENT_AUDITOR",
      reviewer_session_id: `${phase.phase_id}-AUDITOR-001`,
      auditor_readback: auditorReadbackFor(phase),
      evidence_sha256: sha256({phase: phase.phase_id, review: true}),
      reason: "The phase results were independently reviewed.",
      lane_results: candidates.map(({lane_id, result_digest, worker_session_id}) => ({lane_id, result_digest, worker_session_id})),
      reviewed_lane_ids: candidates.map(({lane_id}) => lane_id).sort(),
      acceptance_digest: null,
    };
    acceptance.reviewer_session_id = acceptance.auditor_readback.host_id;
    acceptance.acceptance_digest = digestWithout(acceptance, "acceptance_digest");
    return acceptance;
  },
});
assert.equal(run.status, "COMPLETE");
assert.equal(run.phase_index, 4);
assert.equal(run.phase_results.length, 4);
assert.equal(run.lane_results.length, 12);
assert.equal(new Set(run.lane_results.map((item) => item.lane_id)).size, 12);
assert.equal(run.digest, digestWithout(run, "digest"));

console.log(JSON.stringify({status: "PASS", phases: run.phase_results.length, lanes: run.lane_results.length}));
