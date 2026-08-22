#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  advanceControllerImportRunState,
  compileControllerImportCampaignPlan,
  compileControllerImportPlanningContext,
  compileControllerImportRosterProjection,
  compileControllerImportRunState,
  validateControllerImportCampaignPlan,
  validateControllerImportPlanningContext,
  BOUNDED_LOCAL_INTEGRATION_BOUNDARY_ID,
} from "../control/controller-import-planner.mjs";

const sha = (character) => character.repeat(64);
const contextInput = {
  projectContractSha256: sha("1"),
  goals: [{goal_id: "GOAL.PRIMARY", priority: 100, outcome: "Make every reachable workflow dependable", success_conditions: ["All mandatory workflows pass independent proof"]}],
  architecture: [
    {component_id: "CLIENT_APP", kind: "CLIENT", platform_domain: "CLIENT", paths: ["apps/client"], languages: ["LANG.TYPESCRIPT"], frameworks: ["FRAMEWORK.REACT"], capabilities: ["CAP.WEB"], depends_on: ["SERVICE_API"]},
    {component_id: "DATA_STORE", kind: "DATA", platform_domain: "DATA", paths: ["data/store"], languages: ["LANG.SQL"], frameworks: [], capabilities: ["CAP.TENANT_DATA"], depends_on: []},
    {component_id: "SEARCH_ENGINE", kind: "AI_SEARCH", platform_domain: "INTELLIGENCE", paths: ["services/search"], languages: ["LANG.RUST"], frameworks: [], capabilities: ["CAP.SEARCH"], depends_on: ["DATA_STORE"]},
    {component_id: "SERVICE_API", kind: "API", platform_domain: "SERVICE", paths: ["services/api"], languages: ["LANG.RUST"], frameworks: [], capabilities: ["CAP.API"], depends_on: ["DATA_STORE", "SEARCH_ENGINE"]},
    {component_id: "VISUAL_ENGINE", kind: "GRAPHICS_3D", platform_domain: "CLIENT", paths: ["packages/visual"], languages: ["LANG.TYPESCRIPT"], frameworks: [], capabilities: ["CAP.THREE_DIMENSIONAL"], depends_on: []}
  ],
  features: [
    {feature_id: "FEATURE.PRIMARY", priority: 100, outcome: "Complete the primary workflow", component_ids: ["CLIENT_APP", "SERVICE_API"], workflow_tags: ["WORKFLOW.PRIMARY"], risk_tags: ["RISK.AUTHORIZATION"], acceptance_ids: ["ACCEPT.PRIMARY"]},
    {feature_id: "FEATURE.SEARCH", priority: 90, outcome: "Return correct search results", component_ids: ["SEARCH_ENGINE", "SERVICE_API"], workflow_tags: ["WORKFLOW.SEARCH"], risk_tags: [], acceptance_ids: ["ACCEPT.SEARCH"]}
  ],
  environments: [
    {environment_id: "ENV.DEVELOPMENT", kind: "DEVELOPMENT", provider_ids: ["PROVIDER.EDGE"], capabilities: ["CAP.OBSERVABILITY"], protected: false},
    {environment_id: "ENV.LOCAL", kind: "LOCAL", provider_ids: [], capabilities: ["CAP.OFFLINE_TEST"], protected: false}
  ],
  hardware: {logical_cpu_count: 8, memory_mib: 16384, disk_free_mib: 18000, gpu_class: "INTEGRATED", network_mode: "CONNECTED"},
  standards: [{standard_id: "STANDARD.SECURE_DEVELOPMENT", status: "REQUIRED", source_lock_sha256: sha("2")}],
  unknowns: ["UNKNOWN.PRODUCTION_RUNTIME"]
};

const context = compileControllerImportPlanningContext(contextInput);
validateControllerImportPlanningContext(context);
assert.deepEqual(context, compileControllerImportPlanningContext(contextInput), "planning context is not deterministic");

const importPlan = {
  mode: "NORMALIZE_AND_AUDIT",
  plan_sha256: sha("3"),
  source_identity: {source_commit: "4".repeat(40), source_tree: "5".repeat(40), source_content_sha256: sha("6"), source_observation_sha256: sha("7")}
};
const plan = compileControllerImportCampaignPlan({projectId: "SYNTHETIC_PROJECT", projectImportPlan: importPlan, planningContext: context});
validateControllerImportCampaignPlan(plan);
assert.deepEqual(plan, compileControllerImportCampaignPlan({projectId: "SYNTHETIC_PROJECT", projectImportPlan: importPlan, planningContext: context}), "campaign plan is not deterministic");
assert(plan.waves.every((wave) => wave.role_request_ids.length <= 6), "a wave exceeded six lanes");
assert.equal(plan.resource_plan.max_parallel_heavyweight_jobs, 1, "constrained host admitted duplicate heavyweight jobs");
assert.equal(plan.resource_plan.cargo_build_jobs, 1, "constrained host did not serialize Rust compilation");
const roles = new Set(plan.role_requests.map((request) => request.role_address));
for (const role of [
  "FEATURE.FEATURE.PRIMARY.FUNCTIONALITY", "FEATURE.FEATURE.SEARCH.FUNCTIONALITY",
  "SEC.OWASP_WEB_TOP10", "SEC.OWASP_API_TOP10", "SEC.OWASP_ASVS",
  "SEC.TENANT_ACCESS_CONTROL", "AI.SEARCH_ROUTER", "GRAPHICS.INDUSTRIAL_3D_ROUTER",
  "DATA.DATA_STORE.INTEGRITY", "AGENT.CENTRAL_INTEGRATOR", "AGENT.INDEPENDENT_RELEASE_AUDITOR"
]) assert(roles.has(role), `missing project-derived role ${role}`);
assert(plan.platforms.some((platform) => platform.platform_id === "CLIENT" && platform.owner_role_address === "PLATFORM.CLIENT.OWNER"));
assert(plan.spawner_contract.incomplete_block_behavior.includes("NEVER_SPAWN_INCOMPLETE"));
assert(plan.spawner_contract.seed_rule.includes("NEVER_WORKS"));
assert.equal(plan.continuation.routine_owner_review_forbidden, true);
assert(plan.continuation.routine_gate_pass.includes("START_NEXT_ELIGIBLE_TRANSITION"));

const currentWaveRoleIds = new Set(plan.waves[0].role_request_ids);
const currentWaveQa = [...currentWaveRoleIds].map((request_id) => ({request_id, status: "READY", block_set_sha256: sha("8"), independent_evaluation_sha256: sha("9")}));
const pendingRoleId = plan.role_requests.find((request) => !currentWaveRoleIds.has(request.request_id)).request_id;
currentWaveQa.push({request_id: pendingRoleId, status: "NOT_READY", block_set_sha256: null, independent_evaluation_sha256: null});
const partialRoster = compileControllerImportRosterProjection({plan, qaRecords: currentWaveQa});
assert.equal(partialRoster.status, "PARTIAL_READY");
assert.deepEqual(partialRoster.available_wave_ids, [plan.waves[0].wave_id]);
assert(partialRoster.available_role_request_ids.length === 6 && partialRoster.pending_role_request_ids.includes(pendingRoleId));
assert(partialRoster.blocked_role_request_ids.includes(pendingRoleId));
assert.equal(partialRoster.incomplete_never_admitted, true);
const completeQa = plan.role_requests.map(({request_id}) => ({request_id, status: "READY", block_set_sha256: sha("a"), independent_evaluation_sha256: sha("b")}));
const completeRoster = compileControllerImportRosterProjection({plan, qaRecords: completeQa});
assert.equal(completeRoster.status, "READY_COMPLETE");
assert.equal(completeRoster.pending_role_request_ids.length, 0);
assert.equal(completeRoster.available_wave_ids.length, plan.waves.length);
assert.throws(() => compileControllerImportRosterProjection({plan, qaRecords: [{request_id: pendingRoleId, status: "READY", block_set_sha256: null, independent_evaluation_sha256: null}]}), /ready QA block_set_sha256/u);

let run = compileControllerImportRunState({plan});
assert.equal(run.next_action, "REQUEST_SPAWNER_QA_FOR_CURRENT_WAVE");
run = advanceControllerImportRunState({state: run, plan, event: {event_type: "SPAWNER_QA_NOT_READY", finding_ids: ["FINDING.MISSING_BLOCK"], protected_boundary_id: null}});
assert.equal(run.next_action, "BUILD_SOURCE_LOCK_AND_QA_MISSING_BLOCKS");
run = advanceControllerImportRunState({state: run, plan, event: {event_type: "BLOCK_QA_REPAIRED", finding_ids: [], protected_boundary_id: null}});
const hostileSpecialistState = advanceControllerImportRunState({state: run, plan, event: {event_type: "SPAWNER_QA_PASSED", finding_ids: [], protected_boundary_id: null}});
assert.throws(() => advanceControllerImportRunState({state: hostileSpecialistState, plan, event: {event_type: "SPECIALIST_WAVE_PASSED", finding_ids: ["FINDING.UNRESOLVED"], protected_boundary_id: null}}), /cannot pass with open findings/u);
const centralHold = advanceControllerImportRunState({
  state: run,
  plan,
  event: {event_type: "PROTECTED_BOUNDARY_REACHED", finding_ids: [], protected_boundary_id: BOUNDED_LOCAL_INTEGRATION_BOUNDARY_ID},
});
assert.equal(centralHold.status, "BLOCKED_PROTECTED");
const localCentralResume = advanceControllerImportRunState({
  state: centralHold,
  plan,
  event: {event_type: "BOUNDED_LOCAL_INTEGRATION_RESUMED", finding_ids: [], protected_boundary_id: BOUNDED_LOCAL_INTEGRATION_BOUNDARY_ID},
});
assert.equal(localCentralResume.status, "CENTRAL_INTEGRATION_PENDING");
assert.equal(localCentralResume.next_action, "START_CENTRAL_INTEGRATION_OF_ACCEPTED_PLATFORM_HANDOFFS");
assert.throws(
  () => advanceControllerImportRunState({state: centralHold, plan, event: {event_type: "BOUNDED_LOCAL_INTEGRATION_RESUMED", finding_ids: [], protected_boundary_id: "PROTECTED.OTHER"}}),
  /wrong boundary|not bound/u,
  "bounded local resume must not clear an unrelated protected boundary",
);
for (let index = 0; index < plan.waves.length; index += 1) {
  run = advanceControllerImportRunState({state: run, plan, event: {event_type: "SPAWNER_QA_PASSED", finding_ids: [], protected_boundary_id: null}});
  assert.equal(run.next_action, "START_CURRENT_SPECIALIST_AUDIT_REPAIR_WAVE");
  run = advanceControllerImportRunState({state: run, plan, event: {event_type: "SPECIALIST_WAVE_PASSED", finding_ids: [], protected_boundary_id: null}});
  run = advanceControllerImportRunState({state: run, plan, event: {event_type: "PLATFORM_REVIEW_PASSED", finding_ids: [], protected_boundary_id: null}});
  run = advanceControllerImportRunState({state: run, plan, event: {event_type: "CENTRAL_INTEGRATION_PASSED", finding_ids: [], protected_boundary_id: null}});
  run = advanceControllerImportRunState({state: run, plan, event: {event_type: "INDEPENDENT_REAUDIT_PASSED", finding_ids: [], protected_boundary_id: null}});
}
assert.equal(run.status, "COMPLETE");
assert.equal(run.next_action, "PREPARE_DEVELOPMENT_CANDIDATE_REVIEW");

const waveTamper = structuredClone(plan);
waveTamper.waves[0].role_request_ids = [...plan.role_requests.slice(0, 7).map((request) => request.request_id)].sort();
assert.throws(() => validateControllerImportCampaignPlan(waveTamper), /exceeds six lanes/u);

const missingStandardLock = structuredClone(contextInput);
missingStandardLock.standards[0].source_lock_sha256 = null;
assert.throws(() => compileControllerImportPlanningContext(missingStandardLock), /lacks a source lock/u);

const unknownDependency = structuredClone(contextInput);
unknownDependency.architecture[0].depends_on = ["UNKNOWN_COMPONENT"];
assert.throws(() => compileControllerImportPlanningContext(unknownDependency), /invalid dependency/u);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const relative of ["control/controller-import-planner.mjs", "schemas/controller-import-planning.v1.json", "schemas/controller-import-roster-projection.v1.json", "governance/2.1rc/project-import.md"]) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  assert(!/Sociuna|JobSight|WellSight/iu.test(text), `${relative} contains consumer-specific policy`);
}

console.log("PASS Controller-derived import campaign planning (dynamic roster, six-lane waves, externally evaluated lifecycle requests, automatic continuation, pyramid acceptance, hostile validation, and portability)");
