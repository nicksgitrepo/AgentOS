#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileContinuousOperatingLoop,
  compileLoopInspection,
  compileRepairRecord,
  loopDigest,
  mintTestBuildIdentity,
  runContinuousOperatingLoopIteration,
} from "../control/continuous-operating-loop.mjs";
import {compileSupervisorGoal, compileSupervisorObservation} from "../control/controller-supervisor.mjs";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const STALE_COMMIT = "3".repeat(40);
const STALE_TREE = "4".repeat(40);
const INTENT = "5".repeat(64);
const PARENT_HANDOFF = "6".repeat(64);
const OBSERVED_AT = "2026-08-07T00:05:00.000Z";
const BUILD_TAG = "v2.1rc-tb-01";

function supervisorBoundary() {
  return {
    hard_stop: false,
    soft_review: false,
    owner_decision_required: false,
    scope_changed: false,
    local_development_writes_allowed: true,
    local_worker_agent_spawns_allowed: true,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    external_deployment_allowed: false,
    external_release_allowed: false,
    external_publication_allowed: false,
    external_push_allowed: false,
    external_merge_allowed: false,
    secrets_allowed: false,
    destructive_work_allowed: false,
  };
}

const observation = compileSupervisorObservation({
  projectId: "PROJECT-1",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "V1",
  activeCampaign: true,
  boundary: supervisorBoundary(),
  findings: [],
  nextAction: "Observe the current campaign handoff.",
  sourceCommit: COMMIT,
  sourceTree: TREE,
  parentHandoffSha256: PARENT_HANDOFF,
  observedAtUtc: OBSERVED_AT,
});
const deterministicGoal = compileSupervisorGoal({observation});
assert.throws(
  () => compileSupervisorGoal({observation, goalId: "CONTROLLER-GOAL-OVERRIDE"}),
  /derived from the observation/u,
  "a caller must not override the observation-derived goal identity",
);
assert.equal(deterministicGoal.goal_id, `CONTROLLER-GOAL-${observation.observation_sha256.slice(0, 16).toUpperCase()}`);

const loop = compileContinuousOperatingLoop({
  loopId: "LOOP-1",
  projectId: "PROJECT-1",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "V1",
  admittedScope: ["CONTROL_PLANE"],
  sourceCommit: COMMIT,
  sourceTree: TREE,
  intentSha256: INTENT,
  buildTag: BUILD_TAG,
});

function protectedActions() {
  return {
    published: false,
    pushed: false,
    merged: false,
    deployed: false,
    spent: false,
    revealed_secrets: false,
    deleted: false,
    product_writes: false,
  };
}

function worker({workerId, role, displayName, persistent, sourceCommit = COMMIT, sourceTree = TREE, signal = "NONE"}) {
  return {
    worker_id: workerId,
    role,
    display_name: displayName,
    persistent,
    status: "ACTIVE",
    scope: ["CONTROL_PLANE"],
    source_commit: sourceCommit,
    source_tree: sourceTree,
    started_at_utc: "2026-08-07T00:00:00.000Z",
    last_meaningful_progress_at_utc: null,
    evidence: {
      kind: "HEARTBEAT",
      meaningful: false,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      result_sha256: null,
      recorded_at_utc: OBSERVED_AT,
    },
    handoff: {
      status: "PRESENT",
      typed: true,
      session_id: `SESSION-${workerId}`,
      handoff_sha256: "7".repeat(64),
    },
    signal,
    summary: "The worker remains inside the admitted control-plane lane.",
    protected_actions: protectedActions(),
  };
}

function roster({temporarySourceCommit = COMMIT, temporarySourceTree = TREE, signal = "NONE"} = {}) {
  return [
    worker({workerId: "INTENT-REGULATOR", role: "INTENT_REGULATOR", displayName: "Intent Regulator", persistent: true}),
    worker({workerId: "RUNTIME", role: "RUNTIME", displayName: "Runtime", persistent: true}),
    worker({workerId: "WORKER", role: "ENGINEERING", displayName: `Worker ${BUILD_TAG}`, persistent: false, sourceCommit: temporarySourceCommit, sourceTree: temporarySourceTree, signal}),
  ];
}

const trueBlockerWorkers = roster({temporarySourceCommit: STALE_COMMIT, temporarySourceTree: STALE_TREE});
let replacementCreated = false;
const blockerResult = runContinuousOperatingLoopIteration({
  loop,
  workers: trueBlockerWorkers,
  observedAtUtc: OBSERVED_AT,
  predecessor: {invalid: true},
  repair: {invalid: true},
  createReplacement: () => {
    replacementCreated = true;
    return null;
  },
  independentClearance: {status: "PASS"},
});
assert.equal(blockerResult.inspection.worker_reports.find((report) => report.worker_id === "WORKER").finding_classification, "TRUE_BLOCKER");
assert.equal(blockerResult.status, "INTENT_REGULATOR_REVIEW_REQUIRED");
assert.equal(blockerResult.continuation_allowed, false);
assert.equal(replacementCreated, false, "a true blocker must not enter the Orchestrator replacement path");

const puzzleWorkers = roster({signal: "FAILURE"});
const puzzleInspection = compileLoopInspection({loop, workers: puzzleWorkers, observedAtUtc: OBSERVED_AT});
const predecessor = {
  worker_id: "WORKER",
  role: "ENGINEERING",
  display_name: `Worker ${BUILD_TAG}`,
  session_id: "SESSION-WORKER-PREVIOUS",
  handoff_sha256: "8".repeat(64),
};
const testBuildIdentity = mintTestBuildIdentity({
  sourceCommit: STALE_COMMIT,
  sourceTree: STALE_TREE,
  changedPaths: ["control/example.mjs"],
  normativeBindingSha256: "9".repeat(64),
  predecessorHandoffSha256: predecessor.handoff_sha256,
});
const appliedRepair = compileRepairRecord({
  classification: "PUZZLE",
  preservedEvidenceSha256: puzzleInspection.preserved_evidence_sha256,
  rootCause: {category: "TEST_PUZZLE", summary: "A bounded test repair.", contributing_factors: []},
  status: "APPLIED",
  changedPaths: ["control/example.mjs"],
  sourceBefore: {commit: COMMIT, tree: TREE},
  sourceAfter: {commit: STALE_COMMIT, tree: STALE_TREE},
  testBuildIdentity,
  normativeBindingSha256: "9".repeat(64),
  patchReceiptSha256: loopDigest({patch: "bounded"}),
});
const rawHostError = "sensitive-host-detail-must-not-persist";
const blockedResult = runContinuousOperatingLoopIteration({
  loop,
  workers: puzzleWorkers,
  observedAtUtc: OBSERVED_AT,
  predecessor,
  repair: appliedRepair,
  createReplacement: () => { throw new Error(rawHostError); },
});
assert.equal(blockedResult.status, "REPLACEMENT_BLOCKED");
assert.match(blockedResult.repair_record.host_failure.error_digest, /^opaque:error-[0-9a-f]{64}$/u);
assert.doesNotMatch(blockedResult.repair_record.host_failure.error_digest, /sensitive-host-detail-must-not-persist/u);

console.log("controller-intent hardening hostile checks are defined");
