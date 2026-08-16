#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  compileControllerImportCampaignPlan,
  compileControllerImportPlanningContext,
  compileControllerImportRosterProjection,
  compileControllerImportRunState,
  advanceControllerImportRunState,
} from "../control/controller-import-planner.mjs";
import {compileAgentSpawnerLifecycle} from "../control/agent-spawner-lifecycle.mjs";
import {advanceImportOrchestrator, compileImportOrchestrator, validateImportOrchestrator} from "../control/import-orchestrator.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const hash = (value) => canonicalDigest({value});
const context = compileControllerImportPlanningContext({
  projectContractSha256: hash("contract"),
  goals: [{goal_id: "GOAL.PRIMARY", priority: 100, outcome: "Complete the first useful workflow", success_conditions: ["Independent evidence exists"]}],
  architecture: [{component_id: "SERVICE", kind: "SERVICE", platform_domain: "SERVICE", paths: ["service"], languages: ["LANG.RUST"], frameworks: [], capabilities: ["CAP.API"], depends_on: []}],
  features: [{feature_id: "FEATURE.PRIMARY", priority: 100, outcome: "Return a useful result", component_ids: ["SERVICE"], workflow_tags: ["WORKFLOW.PRIMARY"], risk_tags: [], acceptance_ids: ["ACCEPT.PRIMARY"]}],
  environments: [{environment_id: "ENV.LOCAL", kind: "LOCAL", provider_ids: [], capabilities: ["CAP.OFFLINE_TEST"], protected: false}],
  hardware: {logical_cpu_count: 4, memory_mib: 8192, disk_free_mib: 12000, gpu_class: "NONE", network_mode: "OFFLINE"},
  standards: [],
  unknowns: [],
});
const plan = compileControllerImportCampaignPlan({
  projectId: "SYNTHETIC_PROJECT",
  projectImportPlan: {mode: "NORMALIZE_AND_AUDIT", plan_sha256: hash("import"), source_identity: {source_commit: "1".repeat(40), source_tree: "2".repeat(40), source_content_sha256: hash("content"), source_observation_sha256: hash("observation")}},
  planningContext: context,
});
assert.equal(plan.orchestrator_contract.contract, "schemas/import-orchestrator.v1.json");
assert.equal(plan.orchestrator_contract.controller_supervision, "LIVENESS_ONLY");
const qa = plan.role_requests.map(({request_id}) => ({request_id, status: "READY", block_set_sha256: hash(`block:${request_id}`), independent_evaluation_sha256: hash(`evaluation:${request_id}`)}));
const roster = compileControllerImportRosterProjection({plan, qaRecords: qa, waveActivationAllowed: true});
let run = compileControllerImportRunState({plan});
let lifecycle = compileAgentSpawnerLifecycle({
  lifecycleId: "LIFECYCLE.SPAWNER.SYNTHETIC",
  candidateSha256: hash("candidate"),
  rosterProjectionSha256: roster.projection_sha256,
  contextSha256: context.context_sha256,
  qa: {status: "STATIC_PASS_REVIEW_REQUIRED", complete_block_count: plan.role_requests.length, incomplete_block_count: 0, pending_route_count: 0, independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY", independent_clearance_receipt_sha256: null},
  state: "COMPILER_ACTIVE",
});
const initial = compileImportOrchestrator({orchestratorId: "ORCHESTRATOR.IMPORT.SYNTHETIC", plan, rosterProjection: roster, runState: run, spawnerLifecycle: lifecycle});
validateImportOrchestrator(initial, {plan, rosterProjection: roster, runState: run, spawnerLifecycle: lifecycle});
assert.equal(initial.state, "ACTIVE");
assert.equal(initial.next_action, "REQUEST_SPAWNER_QA");
assert.equal(initial.authority.product_mutation, false);
assert.equal(initial.authority.protected_release, false);

run = advanceControllerImportRunState({state: run, plan, event: {event_type: "SPAWNER_QA_PASSED", finding_ids: [], protected_boundary_id: null}});
const activeRoster = compileControllerImportRosterProjection({plan, qaRecords: qa, activeWaveIds: [run.current_wave_id], waveActivationAllowed: true});
lifecycle = compileAgentSpawnerLifecycle({
  lifecycleId: "LIFECYCLE.SPAWNER.SYNTHETIC",
  candidateSha256: hash("candidate"),
  rosterProjectionSha256: activeRoster.projection_sha256,
  contextSha256: context.context_sha256,
  qa: {status: "STATIC_PASS_REVIEW_REQUIRED", complete_block_count: plan.role_requests.length, incomplete_block_count: 0, pending_route_count: 0, independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY", independent_clearance_receipt_sha256: null},
  state: "COMPILER_ACTIVE",
});
const progressed = advanceImportOrchestrator({orchestrator: initial, plan, rosterProjection: activeRoster, runState: run, spawnerLifecycle: lifecycle});
assert.equal(progressed.transition_sequence, 1);
assert.equal(progressed.next_action, "START_SPECIALIST_WAVE");
assert.throws(() => advanceImportOrchestrator({orchestrator: progressed, plan, rosterProjection: activeRoster, runState: run, spawnerLifecycle: lifecycle}), /without a material bound transition/u);

const heldRoster = compileControllerImportRosterProjection({plan, qaRecords: qa, waveActivationAllowed: false});
const heldLifecycle = compileAgentSpawnerLifecycle({
  lifecycleId: "LIFECYCLE.SPAWNER.HELD",
  candidateSha256: hash("candidate"),
  rosterProjectionSha256: heldRoster.projection_sha256,
  contextSha256: context.context_sha256,
  qa: {status: "STATIC_PASS_REVIEW_REQUIRED", complete_block_count: plan.role_requests.length, incomplete_block_count: 0, pending_route_count: 0, independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY", independent_clearance_receipt_sha256: null},
  state: "COMPILER_ACTIVE",
});
const held = compileImportOrchestrator({orchestratorId: "ORCHESTRATOR.IMPORT.HELD", plan, rosterProjection: heldRoster, runState: compileControllerImportRunState({plan}), spawnerLifecycle: heldLifecycle});
assert.equal(held.state, "PROTECTED_WAIT");
assert.equal(held.next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(held.continuation.timer_is_not_progress, true);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const relative of ["control/import-orchestrator.mjs", "schemas/import-orchestrator.v1.json"]) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  assert(!/Sociuna|JobSight|WellSight/iu.test(text), `${relative} contains consumer-specific policy`);
}

console.log("PASS Import Orchestrator: owns plan, waves, Spawner QA, spawning, custody, handoffs, repair intake, review, candidate advance, same-turn continuation, and protected waits");
