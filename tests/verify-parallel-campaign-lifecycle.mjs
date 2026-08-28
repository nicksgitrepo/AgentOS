#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileParallelCampaignPlan,
  createParallelCampaignLifecycle,
  opaqueSessionRef,
  validateParallelCampaignState,
} from "../control/parallel-campaign-lifecycle.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SOURCE = {commit: "commit-a", tree: "tree-a", worktree_id: "campaign-worktree"};
const START = "2026-08-06T12:00:00.000Z";

function planFixture({maxConcurrentWorkers = 2, progressWindowMinutes = 15} = {}) {
  return compileParallelCampaignPlan({
    campaignId: "CAMPAIGN-PARALLEL-1",
    campaignVersion: "v3.0.0-rc.1",
    logicalLineageId: "LINEAGE-PARALLEL-1",
    goalId: "GOAL-PARALLEL-1",
    goalSha256: SHA_A,
    source: SOURCE,
    progressWindowMinutes,
    maxConcurrentWorkers,
    lanes: [
      {lane_id: "foundation", dependencies: [], writable_scope: "SCOPE-FOUNDATION", task_sha256: SHA_A},
      {lane_id: "followup", dependencies: ["foundation"], writable_scope: "SCOPE-FOUNDATION", task_sha256: SHA_B},
      {lane_id: "independent", dependencies: [], writable_scope: "SCOPE-INDEPENDENT", task_sha256: SHA_C},
    ],
  });
}

function progress(resultType = "VERIFIED_BEHAVIOR", summary = "The bounded lane produced a verified result.") {
  return {
    result_type: resultType,
    summary,
    artifact_sha256: SHA_B,
    evidence_sha256: SHA_C,
  };
}

async function runParallelCampaign() {
  const plan = planFixture();
  const persisted = [];
  let head = null;
  const lifecycle = createParallelCampaignLifecycle({
    plan,
    persist({expected_state_sha256, state}) {
      assert.equal(expected_state_sha256, head ?? lifecycle.snapshot().state_sha256);
      head = state.state_sha256;
      persisted.push(state);
    },
    clock: () => START,
  });
  head = lifecycle.snapshot().state_sha256;
  const activeCounts = [];
  const starts = [];
  let active = 0;
  const result = await lifecycle.run({
    async executeWorker({assignment}) {
      starts.push(assignment.lane_id);
      active += 1;
      activeCounts.push(active);
      await new Promise((resolve) => setTimeout(resolve, assignment.lane_id === "independent" ? 2 : 8));
      active -= 1;
      return {
        session_ref: opaqueSessionRef(`worker:${assignment.lane_id}`),
        progress: progress("VERIFIED_BEHAVIOR", `${assignment.lane_id} produced a bounded verified result.`),
      };
    },
    async auditHandoff({worker}) {
      return {
        auditor_ref: `opaque-auditor-${worker.lane_id}`,
        auditor_session_ref: opaqueSessionRef(`auditor:${worker.lane_id}`),
        accepted: true,
        evidence_sha256: SHA_A,
      };
    },
  });

  assert.equal(result.status, "CLOSED");
  assert(result.workers.every((worker) => worker.state === "CLOSED"));
  assert(result.workers.every((worker) => worker.lease.status === "RELEASED"));
  assert(result.workers.every((worker) => worker.progress?.result_type === "VERIFIED_BEHAVIOR"));
  assert(result.workers.every((worker) => worker.handoff?.handoff_sha256));
  assert(result.workers.every((worker) => worker.audit?.accepted === true));
  assert.equal(Math.max(...activeCounts), 2);
  assert.deepEqual(new Set(starts.slice(0, 2)), new Set(["foundation", "independent"]));
  assert.equal(starts.at(-1), "followup");
  assert(persisted.length > 0);
  validateParallelCampaignState(result, plan);
  const restored = createParallelCampaignLifecycle({plan, initialState: result, clock: () => START});
  assert.equal(restored.snapshot().state_sha256, result.state_sha256);
  return {result, lifecycle};
}

async function runAutonomousLaneCampaign() {
  const plan = compileParallelCampaignPlan({
    campaignId: "CAMPAIGN-AUTONOMOUS-1",
    campaignVersion: "v3.0.0-rc.1",
    logicalLineageId: "LINEAGE-AUTONOMOUS-1",
    goalId: "GOAL-AUTONOMOUS-1",
    goalSha256: SHA_A,
    source: SOURCE,
    maxConcurrentWorkers: 2,
    lanes: [
      {lane_id: "lane-a", dependencies: [], writable_scope: "SCOPE-A", task_sha256: SHA_A},
      {lane_id: "lane-b", dependencies: [], writable_scope: "SCOPE-B", task_sha256: SHA_B},
    ],
  });
  const lifecycle = createParallelCampaignLifecycle({plan, clock: () => START});
  const result = await lifecycle.runAutonomous({
    async executeWorker({assignment}) {
      return {
        session_ref: opaqueSessionRef(`autonomous:${assignment.lane_id}`),
        progress: progress("BOUNDED_HANDOFF", `${assignment.lane_id} completed its lane autonomously.`),
      };
    },
  });
  assert.equal(result.status, "CLOSED");
  assert(result.workers.every((worker) => worker.state === "CLOSED"));
  assert(result.workers.every((worker) => worker.handoff?.handoff_sha256));
  assert(result.workers.every((worker) => worker.audit === null), "autonomous lane must not require a Controller audit approval");
  assert(result.workers.every((worker) => worker.autonomous_handoff?.controller_approval_required === false), "autonomous lane must release without Controller approval");
  assert(result.workers.every((worker) => worker.autonomous_handoff?.execution_owner === "LANE_AGENT"), "autonomous lane must retain lane execution custody");
  assert(result.workers.every((worker) => worker.autonomous_handoff?.next_consumer === "INDEPENDENT_PLATFORM_REVIEW"), "autonomous lane must route directly to independent platform review");
  assert(result.workers.every((worker) => worker.autonomous_handoff?.next_action === "START_PLATFORM_REVIEW"), "autonomous lane must publish a concrete successor action");
  assert(result.workers.every((worker) => worker.autonomous_handoff?.next_handler === "HANDLER.ORCHESTRATOR_PLATFORM_REVIEW"), "autonomous lane must publish its concrete successor handler");
  assert(result.events.some((event) => event.event_type === "WORKER_AUTONOMOUS_HANDOFF_RELEASED"));
  assert(result.events.some((event) => event.payload_sha256));
  return {result, lifecycle};
}

async function main() {
  const plan = planFixture();
  assert.deepEqual(plan.lanes.map((lane) => lane.lane_id), ["followup", "foundation", "independent"]);
  assert(plan.lanes.every((lane) => lane.display_name.includes(plan.campaign_version)));
  const opaque = opaqueSessionRef("provider-only-identity");
  assert.match(opaque, /^opaque:session:[0-9a-f]{64}$/u);
  assert(!opaque.includes("provider-only-identity"));
  assert.throws(() => compileParallelCampaignPlan({
    campaignId: plan.campaign_id,
    campaignVersion: plan.campaign_version,
    logicalLineageId: plan.logical_lineage_id,
    goalId: plan.goal_id,
    goalSha256: plan.goal_sha256,
    source: plan.source,
    lanes: [
      {lane_id: "foundation", dependencies: ["followup"], writable_scope: "SCOPE-FOUNDATION", task_sha256: SHA_A},
      {lane_id: "followup", dependencies: ["foundation"], writable_scope: "SCOPE-FOUNDATION", task_sha256: SHA_B},
    ],
  }), /dependency cycle/u);

  const {result, lifecycle} = await runParallelCampaign();
  await runAutonomousLaneCampaign();
  const foundation = result.workers.find((worker) => worker.lane_id === "foundation");
  assert(foundation);
  assert.throws(() => lifecycle.acquireWorker("followup", {atUtc: START}), /not accepting worker leases|dependencies are incomplete/u);

  const manualPlan = compileParallelCampaignPlan({
    campaignId: "CAMPAIGN-HOSTILE-1",
    campaignVersion: "v3.0.0-rc.1",
    logicalLineageId: "LINEAGE-HOSTILE-1",
    goalId: "GOAL-HOSTILE-1",
    goalSha256: SHA_A,
    source: SOURCE,
    lanes: [{lane_id: "only", dependencies: [], writable_scope: "SCOPE-ONLY", task_sha256: SHA_A}],
  });
  const manual = createParallelCampaignLifecycle({plan: manualPlan, clock: () => START});
  const acquired = manual.acquireWorker("only", {atUtc: START});
  const leaseId = acquired.workers[0].lease.lease_id;
  manual.startWorker("only", leaseId, opaqueSessionRef("worker:only"), {atUtc: START});
  assert.throws(() => manual.recordProgress("only", leaseId, {...progress(), result_type: "HEARTBEAT"}, {atUtc: START}), /not meaningful/u);
  manual.recordProgress("only", leaseId, progress(), {atUtc: START});
  manual.recordHandoff("only", leaseId, {atUtc: START});
  const worker = manual.worker("only");
  assert.throws(() => manual.acceptHandoff("only", leaseId, {
    auditor_ref: worker.worker_ref,
    auditor_session_ref: opaqueSessionRef("auditor:only"),
    accepted: true,
    evidence_sha256: SHA_A,
  }, {atUtc: START}), /Auditor reference belongs to a campaign worker/u);
  assert.throws(() => manual.acceptHandoff("only", leaseId, {
    auditor_ref: "opaque-auditor-only",
    auditor_session_ref: worker.session_ref,
    accepted: true,
    evidence_sha256: SHA_A,
  }, {atUtc: START}), /Auditor session belongs to a campaign worker/u);

  const expiredPlan = compileParallelCampaignPlan({
    campaignId: "CAMPAIGN-EXPIRY-1",
    campaignVersion: "v3.0.0-rc.1",
    logicalLineageId: "LINEAGE-EXPIRY-1",
    goalId: "GOAL-EXPIRY-1",
    goalSha256: SHA_A,
    source: SOURCE,
    progressWindowMinutes: 1,
    lanes: [{lane_id: "expiring", dependencies: [], writable_scope: "SCOPE-EXPIRING", task_sha256: SHA_A}],
  });
  const expired = createParallelCampaignLifecycle({plan: expiredPlan, clock: () => START});
  const expiredLease = expired.acquireWorker("expiring", {atUtc: START}).workers[0].lease.lease_id;
  expired.startWorker("expiring", expiredLease, opaqueSessionRef("worker:expiring"), {atUtc: START});
  const later = "2026-08-06T12:02:00.000Z";
  const expiredState = expired.expireLease("expiring", expiredLease, {atUtc: later});
  assert.equal(expiredState.status, "BLOCKED");
  assert.equal(expiredState.workers[0].failure.code, "LEASE_EXPIRED");
  assert.equal(expiredState.workers[0].lease.status, "EXPIRED");
  assert.throws(() => expired.recordProgress("expiring", expiredLease, progress(), {atUtc: later}), /not active/u);

  const rejectedPlan = compileParallelCampaignPlan({
    campaignId: "CAMPAIGN-REJECTED-1",
    campaignVersion: "v3.0.0-rc.1",
    logicalLineageId: "LINEAGE-REJECTED-1",
    goalId: "GOAL-REJECTED-1",
    goalSha256: SHA_A,
    source: SOURCE,
    lanes: [{lane_id: "reviewed", dependencies: [], writable_scope: "SCOPE-REVIEWED", task_sha256: SHA_A}],
  });
  assert.throws(() => createParallelCampaignLifecycle({plan: rejectedPlan, clock: () => START, maxPairLocalRepairGenerations: 33}), /fixed at 32/u);
  assert.throws(() => createParallelCampaignLifecycle({plan: rejectedPlan, clock: () => START, maxPairLocalRepairGenerations: 1000}), /fixed at 32/u);
  assert.throws(() => createParallelCampaignLifecycle({plan: rejectedPlan, clock: () => START, maxPairLocalRepairGenerations: 1}), /fixed at 32/u);
  const rejected = createParallelCampaignLifecycle({plan: rejectedPlan, clock: () => START});
  const rejectedLease = rejected.acquireWorker("reviewed", {atUtc: START}).workers[0].lease.lease_id;
  rejected.startWorker("reviewed", rejectedLease, opaqueSessionRef("worker:reviewed"), {atUtc: START});
  rejected.recordProgress("reviewed", rejectedLease, progress(), {atUtc: START});
  rejected.recordHandoff("reviewed", rejectedLease, {atUtc: START});
  const rejectedState = rejected.acceptHandoff("reviewed", rejectedLease, {
    auditor_ref: "opaque-auditor-reviewed",
    auditor_session_ref: opaqueSessionRef("auditor:reviewed"),
    accepted: false,
    evidence_sha256: SHA_A,
  }, {atUtc: START});
  assert.equal(rejectedState.status, "RUNNING");
  assert.equal(rejectedState.workers[0].state, "READY");
  assert.equal(rejectedState.workers[0].lease, null);
  assert.equal(rejectedState.events.at(-1).event_type, "WORKER_HANDOFF_REJECTED");
  assert.equal(rejectedState.events.at(-1).to_campaign_status, "RUNNING");
  const repairLease = rejected.acquireWorker("reviewed", {atUtc: START}).workers[0].lease.lease_id;
  rejected.startWorker("reviewed", repairLease, opaqueSessionRef("worker:reviewed-repair"), {atUtc: START});
  rejected.recordProgress("reviewed", repairLease, progress(), {atUtc: START});
  rejected.recordHandoff("reviewed", repairLease, {atUtc: START});
  const secondRepair = rejected.acceptHandoff("reviewed", repairLease, {
    auditor_ref: "opaque-auditor-reviewed-repair",
    auditor_session_ref: opaqueSessionRef("auditor:reviewed-repair"),
    accepted: false,
    evidence_sha256: SHA_B,
  }, {atUtc: START});
  assert.equal(secondRepair.status, "RUNNING");
  assert.equal(secondRepair.workers[0].state, "READY");
  const independentContinuationPlan = compileParallelCampaignPlan({
    campaignId: "CAMPAIGN-INDEPENDENT-CONTINUATION-1",
    campaignVersion: "v3.0.0-rc.1",
    logicalLineageId: "LINEAGE-INDEPENDENT-CONTINUATION-1",
    goalId: "GOAL-INDEPENDENT-CONTINUATION-1",
    goalSha256: SHA_A,
    source: SOURCE,
    maxConcurrentWorkers: 1,
    lanes: [
      {lane_id: "a-blocked", dependencies: [], writable_scope: "SCOPE-BLOCKED", task_sha256: SHA_A},
      {lane_id: "z-independent", dependencies: [], writable_scope: "SCOPE-INDEPENDENT", task_sha256: SHA_B},
    ],
  });
  const independentContinuation = createParallelCampaignLifecycle({plan: independentContinuationPlan, clock: () => START});
  const executions = new Map();
  const independentContinuationResult = await independentContinuation.run({
    async executeWorker({assignment}) {
      const count = (executions.get(assignment.lane_id) ?? 0) + 1;
      executions.set(assignment.lane_id, count);
      return {session_ref: opaqueSessionRef(`continuation:${assignment.lane_id}:${count}`), progress: progress()};
    },
    async auditHandoff({worker}) {
      const count = executions.get(worker.lane_id);
      return {
        auditor_ref: `opaque-auditor-${worker.lane_id}-${count}`,
        auditor_session_ref: opaqueSessionRef(`continuation-auditor:${worker.lane_id}:${count}`),
        accepted: worker.lane_id === "z-independent",
        evidence_sha256: worker.lane_id === "z-independent" ? SHA_B : SHA_A,
      };
    },
  });
  assert.equal(independentContinuationResult.status, "BLOCKED");
  assert.equal(executions.get("a-blocked"), 33);
  assert.equal(executions.get("z-independent"), 1, "unrelated lane must execute after another lane exhausts its pair-local repair budget");
  assert.equal(independentContinuationResult.workers.find((worker) => worker.lane_id === "a-blocked").state, "REPAIR_REQUIRED");
  assert.equal(independentContinuationResult.workers.find((worker) => worker.lane_id === "z-independent").state, "CLOSED");
  assert.equal(independentContinuationResult.events.filter((event) => event.event_type === "WORKER_HANDOFF_REJECTED" && event.worker_ref.includes("a-blocked")).length, 33);
  assert.equal(independentContinuationResult.events.at(-1).event_type, "CAMPAIGN_TERMINAL_LANE_BLOCKED");

  const exclusivePlan = compileParallelCampaignPlan({
    campaignId: "CAMPAIGN-EXCLUSIVE-1",
    campaignVersion: "v3.0.0-rc.1",
    logicalLineageId: "LINEAGE-EXCLUSIVE-1",
    goalId: "GOAL-EXCLUSIVE-1",
    goalSha256: SHA_A,
    source: SOURCE,
    maxConcurrentWorkers: 2,
    lanes: [
      {lane_id: "same-a", dependencies: [], writable_scope: "SCOPE-SAME", task_sha256: SHA_A},
      {lane_id: "same-b", dependencies: [], writable_scope: "SCOPE-SAME", task_sha256: SHA_B},
    ],
  });
  const exclusive = createParallelCampaignLifecycle({plan: exclusivePlan, clock: () => START});
  let exclusiveActive = 0;
  let exclusiveMaximum = 0;
  const exclusiveResult = await exclusive.run({
    async executeWorker({assignment}) {
      exclusiveActive += 1;
      exclusiveMaximum = Math.max(exclusiveMaximum, exclusiveActive);
      await new Promise((resolve) => setTimeout(resolve, 2));
      exclusiveActive -= 1;
      return {session_ref: opaqueSessionRef(`exclusive-worker:${assignment.lane_id}`), progress: progress()};
    },
    async auditHandoff({worker}) {
      return {auditor_ref: `exclusive-auditor-${worker.lane_id}`, auditor_session_ref: opaqueSessionRef(`exclusive-auditor:${worker.lane_id}`), accepted: true, evidence_sha256: SHA_A};
    },
  });
  assert.equal(exclusiveResult.status, "CLOSED");
  assert.equal(exclusiveMaximum, 1);

  console.log(JSON.stringify({
    status: "PASS",
    closed_campaign: result.campaign_id,
    events: result.events.length,
    hostile_cases: 8,
    max_parallel_workers: 2,
    dependency_order: ["foundation", "independent", "followup"],
  }));
}

await main();
