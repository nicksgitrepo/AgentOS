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
  BOUNDED_LOCAL_INTEGRATION_BOUNDARY_ID,
} from "../control/controller-import-planner.mjs";
import {compileAgentSpawnerLifecycle} from "../control/agent-spawner-lifecycle.mjs";
import {compileAgentSpawnerDefectIntake} from "../control/agent-spawner-defect-intake.mjs";
import {compileAgentSpawnerDefectQueue} from "../control/agent-spawner-defect-queue.mjs";
import {
  advanceImportOrchestrator,
  advanceImportOrchestratorRecord,
  compileImportOrchestrator,
  resumeBoundedLocalClearanceHold,
  resumeBoundedLocalIntegration,
  readImportOrchestratorRecord,
  validateImportOrchestrator,
  writeImportOrchestratorRecordCompareAndSwap,
  IMPORT_ORCHESTRATOR_ACTIONS,
} from "../control/import-orchestrator.mjs";
import {
  IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS,
  compileImportOrchestratorCampaignAcceptance,
  compileImportOrchestratorGovernance,
  compileImportOrchestratorGovernanceReadiness,
} from "../control/import-orchestrator-governance-readiness.mjs";
import {compileIndependentClearanceApplicability} from "../control/independent-clearance-applicability.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const hash = (value) => canonicalDigest({value});
const NOW = "2026-08-16T00:00:00.000Z";
const orchestratorGovernance = compileImportOrchestratorGovernance({
  sourceCommit: "AGENTOS-COMMIT-ORCHESTRATOR", sourceTree: "AGENTOS-TREE-ORCHESTRATOR",
  gates: IMPORT_ORCHESTRATOR_GOVERNANCE_GATE_IDS.map((gate_id) => ({
    gate_id, status: "PASS", rule: `The ${gate_id} gate has a deterministic project-agnostic rule and exact stop behavior.`, evidence_sha256: hash(`orchestrator-evidence:${gate_id}`),
    hostile_fixture_ids: [`FIXTURE.ORCHESTRATOR.${gate_id.split(".").at(-1)}.BYPASS`, `FIXTURE.ORCHESTRATOR.${gate_id.split(".").at(-1)}.MISSING`].sort(), authority: "PROJECT_AGNOSTIC_ORCHESTRATOR",
    stop_condition: "Reject campaign planning and preserve the typed blocked readiness receipt until this gate passes.",
  })),
});
const governanceFor = (orchestratorId) => {
  const readiness = compileImportOrchestratorGovernanceReadiness({orchestratorId, governance: orchestratorGovernance, observedAtUtc: NOW});
  const acceptance = compileImportOrchestratorCampaignAcceptance({readiness, campaignRequestSha256: hash(`campaign-request:${orchestratorId}`), acceptedAtUtc: NOW});
  return {governanceReadiness: readiness, governanceAcceptance: acceptance};
};
const {governanceReadiness: orchestratorReadiness, governanceAcceptance: orchestratorAcceptance} = governanceFor("ORCHESTRATOR.IMPORT.SYNTHETIC");
const repairGovernance = governanceFor("ORCHESTRATOR.IMPORT.REPAIR");
const divergedGovernance = governanceFor("ORCHESTRATOR.IMPORT.DIVERGED");
const heldGovernance = governanceFor("ORCHESTRATOR.IMPORT.HELD");
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
const emptyDefectQueue = compileAgentSpawnerDefectQueue({queueId: "QUEUE.SPAWNER.DEFECTS.SYNTHETIC", entries: []});
const initialWithQueue = compileImportOrchestrator({orchestratorId: "ORCHESTRATOR.IMPORT.SYNTHETIC", governanceReadiness: orchestratorReadiness, governanceAcceptance: orchestratorAcceptance, plan, rosterProjection: roster, runState: run, spawnerLifecycle: lifecycle, defectQueue: emptyDefectQueue});
const orchestratorGovernanceForInitial = {governanceReadiness: orchestratorReadiness, governanceAcceptance: orchestratorAcceptance};
validateImportOrchestrator(initialWithQueue, {governanceReadiness: orchestratorReadiness, governanceAcceptance: orchestratorAcceptance, plan, rosterProjection: roster, runState: run, spawnerLifecycle: lifecycle, defectQueue: emptyDefectQueue});
assert.throws(() => validateImportOrchestrator(initialWithQueue, {defectIntakes: []}), /require typed Spawner queue custody/u);
assert.equal(initialWithQueue.defect_queue_sha256, emptyDefectQueue.queue_sha256);
assert.equal(initialWithQueue.state, "ACTIVE");
assert.equal(initialWithQueue.next_action, "REQUEST_SPAWNER_QA");
assert.equal(initialWithQueue.authority.product_mutation, false);
assert.equal(initialWithQueue.authority.protected_release, false);
assert.equal(initialWithQueue.handoff_contract.spawner_defect_intake, "TYPED_SPAWNER_DEFECT_INTAKE");
assert.equal(initialWithQueue.handoff_contract.lane_execution, "AUTONOMOUS_TYPED_HANDOFF");
assert.equal(initialWithQueue.handoff_contract.controller_approval, "NOT_REQUIRED_FOR_ORDINARY_LANE_COMPLETION");
assert(IMPORT_ORCHESTRATOR_ACTIONS.includes("ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE"), "isolated cumulative assembly must be an Orchestrator successor");

// A retired Spawner is a lifecycle boundary, not an idle compiler.  The
// Orchestrator must repair the role binding before it can request QA again;
// otherwise a stale retired identity could silently re-enter the campaign.
const retiredSpawner = compileAgentSpawnerLifecycle({
  lifecycleId: "LIFECYCLE.SPAWNER.RETIRED",
  candidateSha256: hash("candidate"),
  rosterProjectionSha256: roster.projection_sha256,
  contextSha256: context.context_sha256,
  qa: {status: "STATIC_PASS_REVIEW_REQUIRED", complete_block_count: plan.role_requests.length, incomplete_block_count: 0, pending_route_count: 0, independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY", independent_clearance_receipt_sha256: null},
  state: "RETIRED",
});
const retiredSpawnerOrchestrator = compileImportOrchestrator({
  orchestratorId: "ORCHESTRATOR.IMPORT.RETIRED_SPAWNER",
  ...governanceFor("ORCHESTRATOR.IMPORT.RETIRED_SPAWNER"),
  plan,
  rosterProjection: roster,
  runState: run,
  spawnerLifecycle: retiredSpawner,
  defectQueue: emptyDefectQueue,
});
assert.equal(retiredSpawnerOrchestrator.state, "REPAIRING", "retired Spawner must not re-enter ordinary orchestration");
assert.equal(retiredSpawnerOrchestrator.next_action, "REPAIR_BLOCKS", "retired Spawner must route to a replacement-binding repair");
const completeRun = {
  ...run,
  status: "COMPLETE",
  wave_index: plan.waves.length,
  current_wave_id: null,
  next_action: "PREPARE_DEVELOPMENT_CANDIDATE_REVIEW",
  state_sha256: null,
};
completeRun.state_sha256 = canonicalDigest({...completeRun, state_sha256: null});
const retiredAfterComplete = compileImportOrchestrator({
  orchestratorId: "ORCHESTRATOR.IMPORT.RETIRED_AFTER_COMPLETE",
  ...governanceFor("ORCHESTRATOR.IMPORT.RETIRED_AFTER_COMPLETE"),
  plan,
  rosterProjection: roster,
  runState: completeRun,
  spawnerLifecycle: retiredSpawner,
  defectQueue: emptyDefectQueue,
});
assert.equal(retiredAfterComplete.state, "CANDIDATE_REVIEW", "retirement after campaign completion must preserve candidate review");
assert.equal(retiredAfterComplete.next_action, "PREPARE_CANDIDATE_REVIEW", "completed campaign must not reopen repair after Spawner retirement");

const importSchema = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../schemas/import-orchestrator.v1.json"), "utf8"));
assert.deepEqual([...importSchema.properties.next_action.enum].sort(), [...IMPORT_ORCHESTRATOR_ACTIONS].sort(), "Import Orchestrator action schema is stale");
assert(Array.isArray(importSchema.allOf) && importSchema.allOf.length === 3, "Import Orchestrator schema must encode state/action liveness constraints");
const activeRule = importSchema.allOf.find((rule) => rule.if?.properties?.state?.enum?.includes("ACTIVE"));
const protectedRule = importSchema.allOf.find((rule) => rule.if?.properties?.state?.const === "PROTECTED_WAIT");
const retiredRule = importSchema.allOf.find((rule) => rule.if?.properties?.state?.const === "RETIRED");
assert(activeRule?.then?.properties?.next_action?.not?.const === "NONE", "active Orchestrator schema must reject NONE closeouts");
assert(protectedRule?.then?.properties?.next_action?.const === "WAIT_FOR_PROTECTED_EVENT", "protected Orchestrator schema must require the explicit event successor");
assert(protectedRule?.then?.properties?.blocked_dependency_id?.not?.type === "null", "protected Orchestrator schema must bind an exact dependency");
assert(protectedRule?.then?.properties?.repair_candidate_count?.const === 0, "protected Orchestrator schema must not hide queued repair work");
assert(protectedRule?.then?.properties?.controller_custody_count?.const === 0, "protected Orchestrator schema must not hide Controller-custody work");
assert(retiredRule?.then?.properties?.next_action?.const === "NONE", "retired Orchestrator schema must make terminal retirement explicit");
const assemblyRoute = structuredClone(initialWithQueue);
assemblyRoute.next_action = "ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE";
assemblyRoute.orchestrator_sha256 = canonicalDigest({...assemblyRoute, orchestrator_sha256: null});
validateImportOrchestrator(assemblyRoute);
for (const activeState of ["ACTIVE", "REPAIRING", "CANDIDATE_REVIEW"]) {
  const activeNone = structuredClone(initialWithQueue);
  activeNone.state = activeState;
  activeNone.next_action = "NONE";
  activeNone.orchestrator_sha256 = canonicalDigest({...activeNone, orchestrator_sha256: null});
  assert.throws(() => validateImportOrchestrator(activeNone), /Active Import Orchestrator cannot publish NONE/u);
}

// A protected wait is not a generic idle state. It must identify the exact
// dependency and prove that no local repair or Controller-custody work is
// waiting behind it.
for (const [field, value, pattern] of [
  ["blocked_dependency_id", null, /exact dependency/u],
  ["repair_candidate_count", 1, /queued repair candidate/u],
  ["controller_custody_count", 1, /Controller-custody work/u],
]) {
  const protectedIdle = structuredClone(initialWithQueue);
  protectedIdle.state = "PROTECTED_WAIT";
  protectedIdle.next_action = "WAIT_FOR_PROTECTED_EVENT";
  protectedIdle.blocked_dependency_id = "INDEPENDENT.UTILITY_HARM_CLEARANCE";
  protectedIdle[field] = value;
  protectedIdle.orchestrator_sha256 = canonicalDigest({...protectedIdle, orchestrator_sha256: null});
  assert.throws(() => validateImportOrchestrator(protectedIdle), pattern);
}

const defectRepair = compileAgentSpawnerDefectIntake({
  defectId: "DEFECT.ORCHESTRATOR.CONTINUATION.001",
  defectKind: "HANDOFF_FAILURE",
  sourceBinding: {candidate_sha256: hash("candidate"), context_sha256: context.context_sha256, roster_projection_sha256: roster.projection_sha256, source_identity_sha256: hash("source")},
  evidenceRefs: [{evidence_id: "EVIDENCE.ORCHESTRATOR.FAILURE", kind: "HANDOFF_READBACK", reference: "opaque:orchestrator-failure", sha256: hash("failure")}],
  observation: {summary: "The campaign closeout did not start the next action.", expected: "The next eligible action starts before closeout.", observed: "The handoff ended without a successor action.", observed_at_utc: "2026-08-16T20:01:00.000Z", details_sha256: hash("details")},
  classification: "ORCHESTRATOR_LIVENESS_FAILURE",
  rootCause: {category: "MISSING_CONTINUATION", statement: "The route lacked a same-turn successor transition.", evidence_class: "OBSERVED"},
  blockId: "BLOCK.CONTINUATION",
  gateId: "GATE.CONTINUATION.NEXT_ACTION",
  graphId: "GRAPH.IMPORT.ORCHESTRATOR",
});
const repairDefectQueue = compileAgentSpawnerDefectQueue({queueId: "QUEUE.SPAWNER.DEFECTS.SYNTHETIC", entries: [defectRepair]});
assert.throws(() => compileImportOrchestrator({orchestratorId: "ORCHESTRATOR.IMPORT.DIVERGED", ...divergedGovernance, plan, rosterProjection: roster, runState: run, spawnerLifecycle: lifecycle, defectQueue: emptyDefectQueue, defectIntakes: [defectRepair]}), /queue and intake entries diverge/u);
const repairOrchestrator = compileImportOrchestrator({orchestratorId: "ORCHESTRATOR.IMPORT.REPAIR", ...repairGovernance, plan, rosterProjection: roster, runState: run, spawnerLifecycle: lifecycle, defectQueue: repairDefectQueue});
assert.equal(repairOrchestrator.state, "REPAIRING");
assert.equal(repairOrchestrator.next_action, "REPAIR_BLOCKS");
assert.equal(repairOrchestrator.repair_candidate_count, 1);
assert.equal(repairOrchestrator.controller_custody_count, 0);
assert.equal(repairOrchestrator.protected_defect_count, 0);
assert.equal(repairOrchestrator.rejected_duplicate_count, 0);
const repairedTransition = advanceImportOrchestrator({orchestrator: initialWithQueue, ...orchestratorGovernanceForInitial, plan, rosterProjection: roster, runState: run, spawnerLifecycle: lifecycle, defectQueue: repairDefectQueue});
assert.equal(repairedTransition.transition_sequence, 1);
assert.equal(repairedTransition.next_action, "REPAIR_BLOCKS");

const protectedDefect = compileAgentSpawnerDefectIntake({
  defectId: "DEFECT.ORCHESTRATOR.PROTECTED.CLAIM.001",
  defectKind: "CONTRADICTION",
  sourceBinding: {candidate_sha256: hash("candidate"), context_sha256: context.context_sha256, roster_projection_sha256: roster.projection_sha256, source_identity_sha256: hash("source")},
  evidenceRefs: [{evidence_id: "EVIDENCE.ORCHESTRATOR.PROTECTED.CLAIM", kind: "BOUNDARY_CLAIM", reference: "opaque:orchestrator-protected-claim", sha256: hash("protected-claim")}],
  observation: {summary: "A route was described as protected without a run-state boundary.", expected: "Only an exact protected event may stop the campaign.", observed: "The intake had no bound protected event.", observed_at_utc: NOW, details_sha256: hash("protected-claim-details")},
  classification: "PROTECTED_BOUNDARY",
  rootCause: {category: "MISSING_PROTECTED_EVENT_BINDING", statement: "The protected claim was not bound to the planner run state.", evidence_class: "OBSERVED"},
  blockId: "BLOCK.PROTECTED.EVENT.BINDING",
  gateId: "GATE.PROTECTED.EVENT.EXACT",
  graphId: "GRAPH.IMPORT.ORCHESTRATOR",
});
const protectedDefectQueue = compileAgentSpawnerDefectQueue({queueId: "QUEUE.SPAWNER.DEFECTS.SYNTHETIC", entries: [protectedDefect]});
const unboundProtectedClaim = compileImportOrchestrator({orchestratorId: "ORCHESTRATOR.IMPORT.PROTECTED_CLAIM", ...governanceFor("ORCHESTRATOR.IMPORT.PROTECTED_CLAIM"), plan, rosterProjection: roster, runState: run, spawnerLifecycle: lifecycle, defectQueue: protectedDefectQueue});
assert.equal(unboundProtectedClaim.state, "REPAIRING", "an unbound protected claim must repair its missing event binding");
assert.equal(unboundProtectedClaim.next_action, "REPAIR_BLOCKS");

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
const progressed = advanceImportOrchestrator({orchestrator: initialWithQueue, ...orchestratorGovernanceForInitial, plan, rosterProjection: activeRoster, runState: run, spawnerLifecycle: lifecycle, defectQueue: emptyDefectQueue});
assert.equal(progressed.transition_sequence, 1);
assert.equal(progressed.next_action, "START_SPECIALIST_WAVE");
assert.throws(() => advanceImportOrchestrator({orchestrator: progressed, ...orchestratorGovernanceForInitial, plan, rosterProjection: activeRoster, runState: run, spawnerLifecycle: lifecycle, defectQueue: emptyDefectQueue}), /without a material bound transition/u);

const heldRoster = compileControllerImportRosterProjection({plan, qaRecords: qa, waveActivationAllowed: false});
const heldLifecycle = compileAgentSpawnerLifecycle({
  lifecycleId: "LIFECYCLE.SPAWNER.HELD",
  candidateSha256: hash("candidate"),
  rosterProjectionSha256: heldRoster.projection_sha256,
  contextSha256: context.context_sha256,
  qa: {status: "STATIC_PASS_REVIEW_REQUIRED", complete_block_count: plan.role_requests.length, incomplete_block_count: 0, pending_route_count: 0, independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY", independent_clearance_receipt_sha256: null},
  state: "COMPILER_ACTIVE",
});
const heldApplicability = compileIndependentClearanceApplicability({
  applicabilityId: "APPLICABILITY.INDEPENDENT_CLEARANCE.HELD_WAVE",
  phase: "WAVE_ACTIVATION",
  spawnerMode: "COMPILER_ONLY",
  temporaryWorkerAdmission: false,
  spawnAuthority: false,
  waveActivation: "OFF",
  productMutation: false,
  providerAccess: false,
  credentialAccess: false,
  externalSync: false,
  materialSpendAuthorized: false,
  destructiveWorkAuthorized: false,
  liveProviderWorkflow: false,
  activeWorkerCount: 0,
  schedulerJobCount: 0,
  heavyweightProcessCount: 0,
  timerCount: 0,
  polling: false,
});
const held = compileImportOrchestrator({orchestratorId: "ORCHESTRATOR.IMPORT.HELD", ...heldGovernance, clearanceApplicability: heldApplicability, plan, rosterProjection: heldRoster, runState: compileControllerImportRunState({plan}), spawnerLifecycle: heldLifecycle, defectQueue: emptyDefectQueue});
assert.equal(held.state, "REPAIRING");
assert.equal(held.next_action, "REPAIR_BLOCKS");
assert.equal(held.continuation.timer_is_not_progress, true);

const localQa = compileImportOrchestrator({orchestratorId: "ORCHESTRATOR.IMPORT.LOCAL_QA", ...governanceFor("ORCHESTRATOR.IMPORT.LOCAL_QA"), plan, rosterProjection: heldRoster, runState: compileControllerImportRunState({plan}), spawnerLifecycle: heldLifecycle, defectQueue: emptyDefectQueue});
assert.equal(localQa.state, "ACTIVE");
assert.equal(localQa.next_action, "REQUEST_SPAWNER_QA");
assert.notEqual(localQa.clearance_applicability_sha256, heldApplicability.applicability_sha256);

// A stale generic utility/harm hold must not strand ordinary compiler QA.
// Current compiler-only facts reclassify the applicability-only marker as
// local, and the typed resume helper clears it through the planner before QA
// continues. Other protected boundaries remain unaffected.
const staleClearanceRun = advanceControllerImportRunState({
  state: compileControllerImportRunState({plan}),
  plan,
  event: {event_type: "PROTECTED_BOUNDARY_REACHED", finding_ids: [], protected_boundary_id: "INDEPENDENT.UTILITY_HARM_CLEARANCE"},
});
const staleClearanceOrchestrator = compileImportOrchestrator({
  orchestratorId: "ORCHESTRATOR.IMPORT.STALE.CLEARANCE",
  ...governanceFor("ORCHESTRATOR.IMPORT.STALE.CLEARANCE"),
  clearanceApplicability: heldApplicability,
  plan,
  rosterProjection: heldRoster,
  runState: staleClearanceRun,
  spawnerLifecycle: heldLifecycle,
  defectQueue: emptyDefectQueue,
});
assert.equal(staleClearanceOrchestrator.state, "ACTIVE");
assert.equal(staleClearanceOrchestrator.next_action, "REQUEST_SPAWNER_QA");
assert.equal(staleClearanceOrchestrator.blocked_dependency_id, null);
const resumedStaleClearance = resumeBoundedLocalClearanceHold({
  runState: staleClearanceRun,
  plan,
  spawnerLifecycle: heldLifecycle,
});
assert.equal(resumedStaleClearance.status, "SPAWNER_QA_PENDING");
assert.equal(resumedStaleClearance.protected_boundary_id, null);
const hostileStaleClearance = advanceControllerImportRunState({
  state: compileControllerImportRunState({plan}),
  plan,
  event: {event_type: "PROTECTED_BOUNDARY_REACHED", finding_ids: [], protected_boundary_id: BOUNDED_LOCAL_INTEGRATION_BOUNDARY_ID},
});
assert.throws(() => resumeBoundedLocalClearanceHold({
  runState: hostileStaleClearance,
  plan,
  spawnerLifecycle: heldLifecycle,
}), /applicability-only clearance hold/u);

const isolatedApplicability = compileIndependentClearanceApplicability({
  applicabilityId: "APPLICABILITY.INDEPENDENT_CLEARANCE.ISOLATED_ORCHESTRATOR",
  phase: "ISOLATED_LOCAL_AUDIT_REPAIR",
  spawnerMode: "GOVERNED_SPAWN",
  temporaryWorkerAdmission: true,
  spawnAuthority: true,
  waveActivation: "OFF",
  isolatedWorktreeCustody: true,
  sourceRootsPreserved: true,
  sharedWorkspaceReadOnly: true,
  activeLaneCount: 0,
  laneLimit: 6,
  productMutation: false,
  providerAccess: false,
  credentialAccess: false,
  externalSync: false,
  materialSpendAuthorized: false,
  destructiveWorkAuthorized: false,
  liveProviderWorkflow: false,
  activeWorkerCount: 0,
  schedulerJobCount: 0,
  heavyweightProcessCount: 0,
  heavyweightProcessLimit: 1,
  timerCount: 0,
  polling: false,
});
const isolatedOrchestrator = compileImportOrchestrator({
  orchestratorId: "ORCHESTRATOR.IMPORT.ISOLATED",
  ...governanceFor("ORCHESTRATOR.IMPORT.ISOLATED"),
  clearanceApplicability: isolatedApplicability,
  plan,
  rosterProjection: heldRoster,
  runState: compileControllerImportRunState({plan}),
  spawnerLifecycle: heldLifecycle,
  defectQueue: emptyDefectQueue,
});
assert.equal(isolatedOrchestrator.state, "ACTIVE");
assert.equal(isolatedOrchestrator.next_action, "START_ISOLATED_AUDIT_LANES");

assert.throws(() => compileAgentSpawnerLifecycle({
  lifecycleId: "LIFECYCLE.SPAWNER.ISOLATED.ORCHESTRATOR",
  mode: "GOVERNED_SPAWN",
  candidateSha256: hash("candidate"),
  rosterProjectionSha256: heldRoster.projection_sha256,
  contextSha256: context.context_sha256,
  isolatedLocalCustody: false,
  qa: {status: "INDEPENDENT_PASS", complete_block_count: plan.role_requests.length, incomplete_block_count: 0, pending_route_count: 0, independent_clearance_status: "CLEARED", independent_clearance_receipt_sha256: hash("independent-clearance")},
}), /descriptive-only|cannot compile governed spawn authority/u, "import orchestration cannot manufacture Spawner authority from clearance-shaped QA flags");
const blockedCentralRun = advanceControllerImportRunState({
  state: compileControllerImportRunState({plan}),
  plan,
  event: {event_type: "PROTECTED_BOUNDARY_REACHED", finding_ids: [], protected_boundary_id: BOUNDED_LOCAL_INTEGRATION_BOUNDARY_ID},
});
assert.throws(() => resumeBoundedLocalIntegration({
  runState: blockedCentralRun,
  plan,
  spawnerLifecycle: lifecycle,
}), /independently cleared governed Spawner custody/u, "central integration must not resume without independent clearance");

const persistenceRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "agentos-import-orchestrator-"));
const persistencePath = "state/import-orchestrator.json";
const persistedInitial = writeImportOrchestratorRecordCompareAndSwap({
  authorityRoot: persistenceRoot,
  recordPath: persistencePath,
  expectedOrchestratorSha256: null,
  orchestrator: initialWithQueue,
});
assert.equal(persistedInitial.orchestrator_sha256, initialWithQueue.orchestrator_sha256);
assert.deepEqual(readImportOrchestratorRecord({authorityRoot: persistenceRoot, recordPath: persistencePath}), initialWithQueue);
assert.throws(() => writeImportOrchestratorRecordCompareAndSwap({
  authorityRoot: persistenceRoot,
  recordPath: persistencePath,
  expectedOrchestratorSha256: "0".repeat(64),
  orchestrator: initialWithQueue,
}), /compare-and-swap parent is stale/u);
const persistedAdvance = advanceImportOrchestratorRecord({
  authorityRoot: persistenceRoot,
  recordPath: persistencePath,
  expectedOrchestratorSha256: initialWithQueue.orchestrator_sha256,
  ...orchestratorGovernanceForInitial,
  plan,
  rosterProjection: activeRoster,
  runState: run,
  spawnerLifecycle: lifecycle,
  defectQueue: emptyDefectQueue,
});
const persistedReadback = readImportOrchestratorRecord({authorityRoot: persistenceRoot, recordPath: persistencePath});
assert.equal(persistedAdvance.orchestrator_sha256, persistedReadback.orchestrator_sha256);
assert.equal(persistedReadback.transition_sequence, 1);
assert.equal(persistedReadback.next_action, "START_SPECIALIST_WAVE");
assert.throws(() => readImportOrchestratorRecord({authorityRoot: persistenceRoot, recordPath: "../escape.json"}), /parent traversal/u);
const linkedRoot = path.join(persistenceRoot, "linked-target");
fs.mkdirSync(linkedRoot);
const linkedPath = path.join(persistenceRoot, "linked");
const authorityLink = `${persistenceRoot}-link`;
try {
  fs.symlinkSync(linkedRoot, linkedPath, "dir");
  assert.throws(() => readImportOrchestratorRecord({authorityRoot: persistenceRoot, recordPath: "linked/import-orchestrator.json"}), /may not contain symlinks/u);
  fs.symlinkSync(persistenceRoot, authorityLink, "dir");
  assert.throws(() => readImportOrchestratorRecord({authorityRoot: authorityLink, recordPath: persistencePath}), /authority root must be a real directory/u);
} finally {
  fs.rmSync(linkedPath, {force: true});
  fs.rmSync(authorityLink, {force: true});
}
fs.rmSync(persistenceRoot, {recursive: true, force: true});

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const relative of ["control/import-orchestrator.mjs", "schemas/import-orchestrator.v1.json"]) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  assert(!/Sociuna|JobSight|WellSight/iu.test(text), `${relative} contains consumer-specific policy`);
}

console.log("PASS Import Orchestrator: owns plan, waves, lifecycle-request preparation, worker direction, custody, handoffs, repair intake, review, candidate advance, same-turn continuation, and protected waits while Spawner alone executes create/archive operations");
