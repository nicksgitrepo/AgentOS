#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquirePlatformLease,
  appendLivingCampaignEvent,
  admitNextCampaign,
  applyLifecycleTransition,
  compileCheckpoint,
  compileCheckpointLedger,
  compileLivingCampaignEvent,
  compileProductAcceptance,
  compilePlatformAgent,
  completeFinalizer,
  createLifecycleState,
  clearHold,
  compileAcceptedLiveClosureReceipt,
  decideHeartbeatAction,
  compileDeploymentReceipt,
  compileLiveAuditReceipt,
  enqueuePlatformRequest,
  handoffToFinalizer,
  lifecycleDigest,
  markPlatformHandoffReady,
  orientNextCampaignOrchestrator,
  releasePlatformLease,
  recordLiveDelta,
  sealLifecycleState,
  setHold,
  startPlatformWork,
  validateCampaignState,
  validateLivingCampaignLedger,
  validatePlatformAgent,
  writeStateCompareAndSwap,
} from "../control/campaign-controller.mjs";

const SHA = "a".repeat(64);
const ISO = "2026-01-01T00:00:00.000Z";
const nextIso = "2026-01-01T00:01:00.000Z";
const root = {
  root_id: "ROOT-1", branch: "campaign/main", commit: "commit-1", tree: "tree-1",
  remote_commit: "commit-1", remote_tree: "tree-1", clean: true, pushed: true,
};
const worktree = {
  worktree_id: "platform-backend", branch: "platform/backend", base_commit: "commit-1",
  current_commit: "commit-1", base_tree: "tree-1", current_tree: "tree-1", clean: true, pushed: true,
};

function identity(roleId, sessionId, orientationOnly = false) {
  return {role_id: roleId, session_id: sessionId, campaign_id: "CAMPAIGN-1", campaign_version: "v1", orientation_only: orientationOnly};
}

function makeCheckpoint({id = "C1", parent = null, terminal = false, status = terminal ? "SETTLED" : "BUILDING", commit = "commit-1", tree = "tree-1"} = {}) {
  return compileCheckpoint({
    candidate_id: id, campaign_id: "CAMPAIGN-1", campaign_version: "v1", logical_lineage_id: "LINE-1",
    parent_candidate_id: parent, commit, tree, worktree_id: "root-worktree", clean: true, pushed: true,
    terminal, status, audit_plan_sha256: terminal ? SHA : null, audit_reconciliation_sha256: terminal ? SHA : null,
    finding_ids: [],
  });
}

function acceptance({commit, tree, ready = false} = {}) {
  const questionStates = ready
    ? [
      {question_id: "FR-RESULT", answer: "YES", lifecycle: "VERIFIED"},
      {question_id: "DB-SHELL", answer: "YES", lifecycle: "VERIFIED"},
      {question_id: "SEC-AUTH", answer: "YES", lifecycle: "VERIFIED"},
    ]
    : [
      {question_id: "FR-RESULT", answer: "NO", lifecycle: "OPEN_REPAIR"},
      {question_id: "DB-SHELL", answer: "NO", lifecycle: "OPEN_REPAIR"},
      {question_id: "SEC-AUTH", answer: "NO", lifecycle: "OPEN_REPAIR"},
    ];
  return compileProductAcceptance({
    questionTreeSha256: SHA,
    observationsSha256: SHA,
    questionStates,
    roots: ready
      ? {FUNCTION_REQUIREMENTS: "PASS", DESIGN_BIBLE: "PASS", SECURITY: "PASS"}
      : {FUNCTION_REQUIREMENTS: "OPEN_REPAIR", DESIGN_BIBLE: "OPEN_REPAIR", SECURITY: "OPEN_REPAIR"},
    finalCandidateCommit: commit,
    finalCandidateTree: tree,
    auditorSessionId: "SESSION-AUDITOR",
  });
}

function makeState(overrides = {}) {
  const checkpoint = overrides.checkpoint ?? makeCheckpoint({terminal: overrides.stage && overrides.stage !== "BUILDING"});
  const ledger = overrides.checkpoint_ledger ?? compileCheckpointLedger(
    checkpoint.parent_candidate_id === null ? [checkpoint] : [makeCheckpoint(), checkpoint],
    checkpoint.candidate_id,
  );
  const platform = overrides.platform_pool ?? [compilePlatformAgent({
    logicalCapabilityId: "BACKEND_API", logicalAgentId: "PLATFORM-1", executionSessionId: "SESSION-PLATFORM-1", platformWorktree: worktree,
  })];
  return createLifecycleState({
    campaign_id: "CAMPAIGN-1", campaign_version: "v1", logical_lineage_id: "LINE-1",
    policy_epoch: 1, policy_state_sha256: SHA, acceptance_contract_sha256: SHA,
    stage: overrides.stage ?? "BUILDING", root: structuredClone(overrides.root ?? root), active_writer: overrides.active_writer === undefined ? {
      kind: "FEATURE_AGENT", role_id: "FEATURE_AGENT:ONE", session_id: "SESSION-FEATURE-1", lease_id: "LEASE-1", worktree_id: "root-worktree", writable_scope: "FEATURE_SCOPE",
      goal_sha256: SHA,
    } : overrides.active_writer,
    holds: overrides.holds ?? [], platform_pool: platform,
    checkpoint_ledger: ledger,
    finalizer: overrides.finalizer ?? null,
    acceptance: overrides.acceptance ?? acceptance({commit: checkpoint.commit, tree: checkpoint.tree}),
    runtime: overrides.runtime ?? {session_id: "SESSION-RUNTIME", state_identity: "runtime-state", deployed_identity: "deployment-none", rollback_identity: "rollback-none"},
    roster: overrides.roster ?? {
      campaign_orchestrator: identity("CAMPAIGN_ORCHESTRATOR", "SESSION-ORCHESTRATOR"),
      auditor: identity("INDEPENDENT_AUDITOR", "SESSION-AUDITOR"),
      feature_agents: [identity("FEATURE_AGENT:ONE", "SESSION-FEATURE-1")],
    },
    successor_orientation: overrides.successor_orientation,
    living_ledger: overrides.living_ledger ?? {
      events_root: "campaigns/CAMPAIGN-1/events", current_view_path: "campaigns/CAMPAIGN-1/current.json",
      event_count: 0, ledger_sha256: SHA, current_view_sha256: SHA, writer_heads: {},
    },
  });
}

const initial = makeState();
validateCampaignState(initial);
assert.equal(initial.stage, "BUILDING");

let platform = initial.platform_pool[0];
platform = enqueuePlatformRequest(platform, {feature_id: "FEATURE-A", dependency: "api", critical_path_rank: 1, goal_sha256: SHA});
platform = acquirePlatformLease(platform, {
  featureAgentId: "FEATURE-A", featureSessionId: "SESSION-FEATURE-A", assignmentId: "ASSIGN-A", leaseId: "LEASE-A",
  goalSha256: SHA, writableScope: "BACKEND_API", acquiredAtUtc: ISO,
});
platform = startPlatformWork(platform);
platform = markPlatformHandoffReady(platform, "commit-2", "tree-2");
platform = releasePlatformLease(platform, nextIso);
assert.equal(platform.state, "AVAILABLE");
assert.equal(platform.logical_agent_id, "PLATFORM-1");
assert.equal(platform.platform_worktree.worktree_id, "platform-backend");
platform = acquirePlatformLease(platform, {
  featureAgentId: "FEATURE-B", featureSessionId: "SESSION-FEATURE-B", assignmentId: "ASSIGN-B", leaseId: "LEASE-B",
  goalSha256: SHA, writableScope: "BACKEND_API", acquiredAtUtc: nextIso,
});
assert.equal(platform.supervision.feature_agent_id, "FEATURE-B");
assert.equal(platform.platform_worktree.current_commit, "commit-2");
validatePlatformAgent(platform);

const held = setHold(initial, {
  hold_id: "HOLD-1", kind: "EXTERNAL_DEPENDENCY", scope: "FEATURE-A", authority_boundary: "external access",
  resume_condition: "mechanical access check passes", owner_role_id: "CAMPAIGN_ORCHESTRATOR", created_at_utc: ISO,
});
assert.equal(held.stage, initial.stage);
assert.equal(held.holds.length, 1);
const cleared = clearHold(held, "HOLD-1", SHA);
assert.equal(cleared.holds.length, 0);
assert(cleared.transition_journal.length > held.transition_journal.length);

const rosteredPlatform = acquirePlatformLease(initial.platform_pool[0], {
  featureAgentId: "ONE", featureSessionId: "SESSION-FEATURE-1", assignmentId: "ASSIGN-ROSTER", leaseId: "LEASE-ROSTER",
  goalSha256: SHA, writableScope: "BACKEND_API", acquiredAtUtc: ISO,
});
const rosteredState = makeState({platform_pool: [rosteredPlatform]});
validateCampaignState(rosteredState);
const wrongRosterPlatform = {
  ...rosteredPlatform,
  supervision: {...rosteredPlatform.supervision, feature_session_id: "SESSION-NOT-IN-ROSTER"},
};

const terminalCheckpoint = makeCheckpoint({id: "C2", parent: "C1", terminal: true, commit: "commit-2", tree: "tree-2"});
const settledState = makeState({
  stage: "TERMINAL_SETTLED", active_writer: null, checkpoint: terminalCheckpoint,
  root: {...root, commit: "commit-2", tree: "tree-2", remote_commit: "commit-2", remote_tree: "tree-2"},
  acceptance: {
    ...acceptance({commit: "commit-2", tree: "tree-2"}),
  },
});
const finalizerBody = {
  session_id: "SESSION-FINALIZER", worktree_id: "finalizer-worktree", branch: "campaign/finalizer", source_candidate_id: "C2",
  source_commit: "commit-2", source_tree: "tree-2", lease_id: "LEASE-FINALIZER", goal_sha256: SHA, status: "ACTIVE", final_commit: null, final_tree: null,
  clean: null, pushed: null, scope_finding_ids: [], repair_passes: 0, reframes: 0,
};
const finalizer = {...finalizerBody, finalizer_sha256: lifecycleDigest(finalizerBody)};
const finalizerState = handoffToFinalizer(settledState, finalizer);
assert.equal(finalizerState.stage, "FINALIZER_ACTIVE");
assert.equal(finalizerState.active_writer.kind, "CAMPAIGN_FINALIZER");
const completeState = completeFinalizer(finalizerState, "commit-final", "tree-final");
assert.equal(completeState.active_writer, null);
const adoptedState = (await import("../control/campaign-controller.mjs")).adoptFinalizerRoot(completeState);
assert.equal(adoptedState.stage, "DELTA_AUDIT");
assert.equal(adoptedState.root.commit, "commit-final");

const accepted = applyLifecycleTransition(adoptedState, {
  ...adoptedState,
  stage: "READY_FOR_ACCEPTANCE",
  acceptance: {
    ...acceptance({commit: "commit-final", tree: "tree-final", ready: true}),
  },
}, {type: "READY_FOR_ACCEPTANCE", at_utc: "2026-01-01T00:02:00.000Z", payload: {roots: "THREE_ROOTS_PASS"}});
const deploymentCleared = applyLifecycleTransition(accepted, {...accepted, stage: "DEPLOYMENT_CLEARED"}, {
  type: "RUNTIME_RELEASE_CLEARANCE", at_utc: "2026-01-01T00:02:30.000Z", payload: {auditor: "SESSION-AUDITOR"},
});
const oriented = orientNextCampaignOrchestrator(deploymentCleared, identity("CAMPAIGN_ORCHESTRATOR", "SESSION-NEXT-ORCHESTRATOR", true), SHA);
assert.equal(oriented.successor_orientation.status, "ORCHESTRATOR_ORIENTED_HELD");
assert.equal(oriented.successor_orientation.auditor_binding, null);
assert.equal(oriented.successor_orientation.product_writer_lease, "NONE");

const deploymentReceipt = compileDeploymentReceipt({
  finalCandidateCommit: oriented.root.commit,
  finalCandidateTree: oriented.root.tree,
  deployedIdentity: "deployment-final",
  rollbackIdentity: "rollback-previous",
  runtimeSessionId: oriented.runtime.session_id,
  deployedAtUtc: "2026-01-01T00:03:00.000Z",
});
const pendingClosure = applyLifecycleTransition(oriented, {
  ...oriented,
  stage: "ACCEPTED_LIVE_PENDING_CLOSURE",
  runtime: {...oriented.runtime, deployed_identity: deploymentReceipt.deployed_identity, rollback_identity: deploymentReceipt.rollback_identity},
}, {
  type: "DEPLOYMENT_CLEARED", at_utc: "2026-01-01T00:03:00.000Z", payload: {deployment_receipt: deploymentReceipt},
});
const liveDelta = recordLiveDelta(pendingClosure, "SESSION-NEXT-ORCHESTRATOR", SHA);
const liveAuditReceipt = compileLiveAuditReceipt({
  finalCandidateCommit: deploymentReceipt.final_candidate_commit,
  finalCandidateTree: deploymentReceipt.final_candidate_tree,
  deployedIdentity: deploymentReceipt.deployed_identity,
  independentAuditIdentity: "SESSION-AUDITOR",
  auditedAtUtc: "2026-01-01T00:04:00.000Z",
});
const closureReceipt = compileAcceptedLiveClosureReceipt({
  deploymentReceipt,
  liveAuditReceipt,
  closedAtUtc: "2026-01-01T00:04:00.000Z",
});
const closed = applyLifecycleTransition(liveDelta, {...liveDelta, stage: "ACCEPTED_LIVE_CLOSED"}, {
  type: "ACCEPTED_LIVE_CLOSURE", at_utc: "2026-01-01T00:04:00.000Z", payload: {closure_receipt: closureReceipt},
});
const admitted = admitNextCampaign(closed, {
  finalCandidateSha256: SHA,
  auditorBinding: identity("INDEPENDENT_AUDITOR", "SESSION-NEXT-AUDITOR"),
  featureAgentBindings: [identity("FEATURE_AGENT:TWO", "SESSION-NEXT-FEATURE")],
  platformAgentBindings: [identity("PLATFORM_AGENT:BACKEND_API", "SESSION-NEXT-PLATFORM")],
});
assert.equal(admitted.successor_orientation.status, "CAMPAIGN_ADMITTED");

const event = compileLivingCampaignEvent({sequence: 0, eventId: "EVENT-1", writerSessionId: "SESSION-ORCHESTRATOR", eventType: "CHECKPOINT", payload: {checkpoint: "C2"}, createdAtUtc: ISO});
assert.equal(validateLivingCampaignLedger([event])["SESSION-ORCHESTRATOR"], event.event_sha256);
assert.throws(() => validateLivingCampaignLedger([{...event, sequence: 1}]));
assert.equal(decideHeartbeatAction(initial, ISO, "2026-01-01T00:15:00.000Z").action, "RECONCILE");
assert.equal(decideHeartbeatAction(initial, ISO, "2026-01-01T00:14:59.000Z").action, "NO_ACTION");

const casDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-lifecycle-cas-"));
try {
  const target = path.join(casDir, "state.json");
  writeStateCompareAndSwap(target, Buffer.alloc(0), initial);
  assert.throws(() => writeStateCompareAndSwap(target, Buffer.from("wrong"), initial));
  const eventPath = "events.jsonl";
  const firstEvent = compileLivingCampaignEvent({sequence: 0, eventId: "EVENT-APPEND-1", writerSessionId: "SESSION-ORCHESTRATOR", eventType: "CHECKPOINT", payload: {checkpoint: "C1"}, createdAtUtc: ISO});
  appendLivingCampaignEvent(casDir, eventPath, firstEvent, Buffer.alloc(0));
  const firstBytes = fs.readFileSync(path.join(casDir, eventPath));
  const secondEvent = compileLivingCampaignEvent({sequence: 1, eventId: "EVENT-APPEND-2", writerSessionId: "SESSION-ORCHESTRATOR", eventType: "HANDOFF", payload: {checkpoint: "C1"}, priorWriterHeadSha256: firstEvent.event_sha256, createdAtUtc: nextIso});
  appendLivingCampaignEvent(casDir, eventPath, secondEvent, firstBytes);
  assert.throws(() => appendLivingCampaignEvent(casDir, eventPath, compileLivingCampaignEvent({sequence: 2, eventId: "EVENT-APPEND-3", writerSessionId: "SESSION-ORCHESTRATOR", eventType: "BAD", payload: {}, createdAtUtc: nextIso}), fs.readFileSync(path.join(casDir, eventPath))), /writer head|append/u);
} finally {
  fs.rmSync(casDir, {recursive: true, force: true});
}

let hostile = 0;
function hostileCase(label, operation) {
  assert.throws(operation, label);
  hostile += 1;
}
hostileCase("second supervisor", () => acquirePlatformLease(platform, {
  featureAgentId: "FEATURE-C", featureSessionId: "SESSION-FEATURE-C", assignmentId: "ASSIGN-C", leaseId: "LEASE-C", writableScope: "API", acquiredAtUtc: ISO,
  goalSha256: SHA,
}));
hostileCase("Platform lease outside current Feature roster", () => makeState({platform_pool: [wrongRosterPlatform]}));
hostileCase("tampered Product acceptance receipt", () => validateCampaignState({
  ...initial,
  acceptance: {...initial.acceptance, product_receipt_sha256: "b".repeat(64)},
}));
hostileCase("tampered lifecycle transition event", () => {
  const tampered = structuredClone(initial);
  tampered.transition_journal[0].payload.campaign_id = "OTHER-CAMPAIGN";
  delete tampered.state_sha256;
  tampered.state_sha256 = lifecycleDigest(tampered);
  validateCampaignState(tampered);
});
hostileCase("deployment closure without typed deployment receipt", () => applyLifecycleTransition(oriented, {
  ...oriented,
  stage: "ACCEPTED_LIVE_PENDING_CLOSURE",
}, {
  type: "DEPLOYMENT_CLEARED",
  at_utc: "2026-01-01T00:03:00.000Z",
  payload: {runtime: "CLEARED"},
}));
hostileCase("accepted-live closure without independent live audit", () => applyLifecycleTransition(liveDelta, {
  ...liveDelta,
  stage: "ACCEPTED_LIVE_CLOSED",
}, {
  type: "ACCEPTED_LIVE_CLOSURE",
  at_utc: "2026-01-01T00:04:00.000Z",
  payload: {closure_receipt: deploymentReceipt},
}));
hostileCase("Runtime self-audit", () => applyLifecycleTransition(liveDelta, {
  ...liveDelta,
  stage: "ACCEPTED_LIVE_CLOSED",
}, {
  type: "ACCEPTED_LIVE_CLOSURE",
  at_utc: "2026-01-01T00:04:00.000Z",
  payload: {closure_receipt: compileAcceptedLiveClosureReceipt({
    deploymentReceipt,
    liveAuditReceipt: compileLiveAuditReceipt({
      finalCandidateCommit: deploymentReceipt.final_candidate_commit,
      finalCandidateTree: deploymentReceipt.final_candidate_tree,
      deployedIdentity: deploymentReceipt.deployed_identity,
      independentAuditIdentity: "SESSION-RUNTIME",
      auditedAtUtc: "2026-01-01T00:04:00.000Z",
    }),
    closedAtUtc: "2026-01-01T00:04:00.000Z",
  })},
}));
hostileCase("speculative successor auditor", () => orientNextCampaignOrchestrator(accepted, {
  ...identity("INDEPENDENT_AUDITOR", "SESSION-EARLY-AUDITOR", true),
}, SHA));
hostileCase("illegal blocked stage", () => sealLifecycleState({...initial, stage: "BLOCKED"}));
hostileCase("Finalizer without release", () => handoffToFinalizer({...settledState, active_writer: initial.active_writer}, finalizer));
hostileCase("CAS stale bytes", () => writeStateCompareAndSwap(path.join(os.tmpdir(), "agentos-missing-state.json"), Buffer.from("stale"), initial));

console.log(`PASS Governance 2.1rc campaign lifecycle (${hostile} hostile cases)`);
