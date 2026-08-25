#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquirePlatformLease,
  archivePlatformAgent,
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
  compileNextCampaignCandidate,
  compileNextCampaignLiveDelta,
  compileRuntimeBinding,
  compileRepositoryCheckpointProof,
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
import {compileProductAcceptanceProof} from "../control/acceptance-bridge.mjs";
import {compileUniversalTaskCloseoutReceipts} from "../control/governance-library.mjs";
import {compileQuestionTree, sha256} from "../control/question-tree.mjs";
import {compileGlobalPolicyState} from "../control/global-policy-state.mjs";

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
  checkpoint_proof: compileRepositoryCheckpointProof({worktreeId: "platform-backend", commit: "commit-1", tree: "tree-1", remoteCommit: "commit-1", remoteTree: "tree-1", clean: true, pushed: true, observedByRole: "DETERMINISTIC_VERIFIER", observedBySession: "QUALITY-VERIFIER", observedAtUtc: ISO}),
};

function identity(roleId, sessionId, orientationOnly = false, campaignId = "CAMPAIGN-1", campaignVersion = "v1") {
  return {role_id: roleId, session_id: sessionId, campaign_id: campaignId, campaign_version: campaignVersion, orientation_only: orientationOnly};
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
  const clauses = [
    ["FR-RESULT", "FUNCTION_REQUIREMENTS", "ALWAYS"],
    ["DB-SHELL", "DESIGN_BIBLE", "UI"],
    ["SEC-AUTH", "SECURITY", "AUTHENTICATED_UI"],
  ].map(([question_id, root_id, surface]) => ({
    clause_id: `${question_id}:CLAUSE`, question_id, root: root_id, parent_question_id: null,
    source_authority: {authority_id: "SYNTHETIC-AUTHORITY", version: "1", sha256: SHA},
    applicability: {predicate_id: `${question_id}:APPLIES`, question: `Does ${question_id} apply?`},
    atomic_question: `Does ${question_id} satisfy its exact outcome?`,
    required_evidence: [`${question_id}:RESULT`], repair_owner_role: "FEATURE_AGENT",
    invalidation_conditions: [`${question_id}:CHANGE`], blocking_scope: `${question_id}:SCOPE`,
    exception_policy: {allowed: true, granting_authority_ids: ["OWNER"], scope: `${question_id}:SCOPE`},
    materiality: "MATERIAL_PRODUCT_ACCEPTANCE", applies_to_surfaces: [surface],
  }));
  const manifestBody = {
    schema: "governance.changed_surface_manifest.v1", checkpoint_id: "CHECKPOINT-ACCEPTANCE",
    originating_owner_role_id: "FEATURE_AGENT:ONE", root_id: "root-worktree", branch: "campaign/main",
    commit: commit, tree, changed_paths: ["src/feature.ts"], changed_surfaces: ["ALWAYS", "UI", "AUTHENTICATED_UI"],
  };
  const changeManifest = {...manifestBody, manifest_sha256: sha256(manifestBody)};
  const questionTree = compileQuestionTree({
    schema: "governance.question_tree_source_clauses.v1", campaign_id: "CAMPAIGN-1", question_tree_version: "2.1rc",
    change_manifest: changeManifest, clauses,
  });
  const evidence = (kind) => ({
    evidence_id: `EVIDENCE-${kind}`, kind, sha256: SHA, commit_sha: commit, worktree_id: "root-worktree",
    build_identity: "BUILD-1", environment_id: "ENV-1", observed_at_utc: ISO, question_tree_version: "2.1rc",
  });
  const binding = {commit_sha: commit, worktree_id: "root-worktree", relevant_hashes: [SHA], build_identity: "BUILD-1", environment_id: "ENV-1", question_tree_version: "2.1rc"};
  const observations = questionTree.questions.map((question) => {
    const answer = ready ? "YES" : "NO";
    return {
      question_id: question.question_id, answer, lifecycle: ready ? "VERIFIED" : "OPEN_REPAIR", applicable: true,
      applicability_evidence: [evidence(`${question.question_id}:APPLICABLE`)], evaluated_at_utc: ISO, evaluation_binding: binding,
      evidence: [evidence(question.required_evidence[0])],
    };
  });
  const proof = compileProductAcceptanceProof({
    tree: questionTree, observations, evidence_cache: [], auditor_session_id: "SESSION-AUDITOR", evaluated_at_utc: ISO, critical_freezes: [],
  });
  return compileProductAcceptance({
    proof,
    finalCandidateCommit: commit,
    finalCandidateTree: tree,
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
  const stage = overrides.stage ?? "BUILDING";
  const stagePath = ["BUILDING", "TERMINAL_PROPOSED", "TERMINAL_SETTLED"];
  const transition_journal = stage === "BUILDING" ? [] : stagePath.slice(0, stagePath.indexOf(stage) + 1).map((to_stage, sequence) => {
    const body = sequence === 0
      ? {sequence, from_state_sha256: null, from_stage: null, to_stage, event_type: "GENESIS", payload: {campaign_id: "CAMPAIGN-1", campaign_version: "v1", logical_lineage_id: "LINE-1"}, at_utc: "1970-01-01T00:00:00.000Z"}
      : {sequence, from_state_sha256: SHA, from_stage: stagePath[sequence - 1], to_stage, event_type: "SEEDED_TEST_TRANSITION", payload: {}, at_utc: ISO};
    return {...body, event_sha256: lifecycleDigest(body)};
  });
  return createLifecycleState({
    campaign_id: "CAMPAIGN-1", campaign_version: "v1", logical_lineage_id: "LINE-1",
    policy_epoch: 1, policy_state_sha256: SHA, acceptance_contract_sha256: SHA,
    stage, transition_journal, root: structuredClone(overrides.root ?? root), active_writer: overrides.active_writer === undefined ? {
      kind: "FEATURE_AGENT", role_id: "FEATURE_AGENT:ONE", session_id: "SESSION-FEATURE-1", lease_id: "LEASE-1", worktree_id: "root-worktree", writable_scope: "FEATURE_SCOPE",
      goal_sha256: SHA,
    } : overrides.active_writer,
    holds: overrides.holds ?? [], platform_pool: platform,
    checkpoint_ledger: ledger,
    finalizer: overrides.finalizer ?? null,
    acceptance: overrides.acceptance ?? acceptance({commit: checkpoint.commit, tree: checkpoint.tree}),
    runtime: overrides.runtime ?? compileRuntimeBinding({runtimeIdentity: "RUNTIME-1", sessionId: "SESSION-RUNTIME", stateIdentity: "runtime-state", deployedIdentity: "deployment-none", rollbackIdentity: "rollback-none", environmentId: "ENV-RUNTIME", capabilitySetSha256: SHA}),
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
assert.throws(
  () => compileProductAcceptance({proof: initial.acceptance.proof, finalCandidateCommit: "commit-drift", finalCandidateTree: "tree-drift"}),
  /final candidate (?:commit|tree) is not bound to the question-tree change manifest/u,
  "Product acceptance must bind the final candidate identity to the question-tree manifest",
);

let platform = initial.platform_pool[0];
platform = enqueuePlatformRequest(platform, {feature_id: "FEATURE-A", dependency: "api", critical_path_rank: 1, goal_sha256: SHA});
platform = acquirePlatformLease(platform, {
  featureAgentId: "FEATURE-A", featureSessionId: "SESSION-FEATURE-A", assignmentId: "ASSIGN-A", leaseId: "LEASE-A",
  goalSha256: SHA, writableScope: "BACKEND_API", acquiredAtUtc: ISO,
});
platform = startPlatformWork(platform);
platform = markPlatformHandoffReady(platform, "commit-2", "tree-2", compileRepositoryCheckpointProof({worktreeId: "platform-backend", commit: "commit-2", tree: "tree-2", remoteCommit: "commit-2", remoteTree: "tree-2", clean: true, pushed: true, observedByRole: "DETERMINISTIC_VERIFIER", observedBySession: "QUALITY-VERIFIER", observedAtUtc: nextIso}));
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
const leasedPlatform = platform;
platform = releasePlatformLease(platform, nextIso);
assert.equal(platform.state, "AVAILABLE");
assert.throws(() => archivePlatformAgent(platform), /closeout/u);
const platformCloseout = compileUniversalTaskCloseoutReceipts({
  mode: "CAMPAIGN",
  observedAt: nextIso,
  receiptRefs: Object.fromEntries([
    "PRESERVE_HANDOFF", "PERSIST_HANDOFF", "AUDIT_CANDIDATE", "INTEGRATE_ACCEPTED_WORK",
    "UNPIN_SESSION", "CLOSE_STALE_WORKTREE", "REMOVE_ACTIVE_TASK_SCOPE", "MARK_CHAT_OUT_OF_SCOPE",
    "ARCHIVE_VISIBLE_TASK",
  ].map((step, index) => [step, `digest:${crypto.createHash("sha256").update(`platform-closeout-${index + 1}`).digest("hex")}`])),
});
const archivedPlatform = archivePlatformAgent(platform, {universalCloseoutReceipts: platformCloseout});
assert.equal(archivedPlatform.state, "ARCHIVED_UNPINNED");
assert.equal(archivedPlatform.universal_closeout_receipts.length, 9);
assert.throws(() => compileUniversalTaskCloseoutReceipts({
  mode: "CAMPAIGN",
  observedAt: nextIso,
  receiptRefs: Object.fromEntries([
    "PRESERVE_HANDOFF", "PERSIST_HANDOFF", "AUDIT_CANDIDATE", "INTEGRATE_ACCEPTED_WORK",
    "UNPIN_SESSION", "CLOSE_STALE_WORKTREE", "REMOVE_ACTIVE_TASK_SCOPE", "MARK_CHAT_OUT_OF_SCOPE",
    "ARCHIVE_VISIBLE_TASK",
  ].map((step, index) => [step, `ref:FORGED-CLOSEOUT-${index + 1}`])),
}), /content-addressed/u, "forged closeout references must fail closed");

const held = setHold(initial, {
  hold_id: "HOLD-1", kind: "EXTERNAL_DEPENDENCY", scope: "FEATURE-A", authority_boundary: "external access",
  affected_outcome_ids: ["FEATURE-A"], blocked_stages: ["TERMINAL_PROPOSED"],
  resume_condition: "mechanical access check passes", resume_condition_sha256: lifecycleDigest({condition: "mechanical access check passes"}),
  safe_alternatives_evidence_sha256: SHA, owner_role_id: "CAMPAIGN_ORCHESTRATOR", created_at_utc: ISO,
});
assert.equal(held.stage, initial.stage);
assert.equal(held.holds.length, 1);
const holdResolution = {condition_sha256: held.holds[0].resume_condition_sha256, affected_outcome_ids: ["FEATURE-A"], evidence_sha256: null, resolved_at_utc: ISO};
holdResolution.evidence_sha256 = lifecycleDigest({...holdResolution, evidence_sha256: null});
const cleared = clearHold(held, "HOLD-1", holdResolution);
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
  clean: null, pushed: null, repository_proof: null, scope_finding_ids: [], repair_passes: 0, reframes: 0,
};
const finalizer = {...finalizerBody, finalizer_sha256: lifecycleDigest(finalizerBody)};
const finalizerState = handoffToFinalizer(settledState, finalizer);
assert.equal(finalizerState.stage, "FINALIZER_ACTIVE");
assert.equal(finalizerState.active_writer.kind, "CAMPAIGN_FINALIZER");
const completeState = completeFinalizer(finalizerState, "commit-final", "tree-final", compileRepositoryCheckpointProof({worktreeId: "finalizer-worktree", commit: "commit-final", tree: "tree-final", remoteCommit: "commit-final", remoteTree: "tree-final", clean: true, pushed: true, observedByRole: "DETERMINISTIC_VERIFIER", observedBySession: "QUALITY-VERIFIER", observedAtUtc: nextIso}));
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
const nextOrchestrator = identity("CAMPAIGN_ORCHESTRATOR", "SESSION-NEXT-ORCHESTRATOR", true, "CAMPAIGN-2", "v2");
const predeploymentCandidate = compileNextCampaignCandidate({
  candidateKind: "PREDEPLOYMENT", campaignId: "CAMPAIGN-2", campaignVersion: "v2", projectId: "LINE-1",
  sourceCommit: "commit-1", sourceTree: "tree-1", sourceWorktreeId: "root-worktree",
  ownerIntentSha256: SHA, ownerIntentSummarySha256: SHA,
  policyEpoch: deploymentCleared.policy_epoch, policyStateSha256: deploymentCleared.policy_state_sha256,
  acceptanceContractSha256: deploymentCleared.acceptance_contract_sha256, questionTreeSha256: SHA,
  modelPlanSha256: SHA, modelRolesSha256: SHA, scopeSha256: SHA, changedPaths: ["src/next.js"], state: deploymentCleared,
});
const oriented = orientNextCampaignOrchestrator(deploymentCleared, nextOrchestrator, predeploymentCandidate);
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
const liveDeltaPacket = compileNextCampaignLiveDelta({
  candidate: predeploymentCandidate, environmentId: "ENVIRONMENT-1", observedAtUtc: "2026-01-01T00:03:30.000Z",
  changedPaths: ["src/next.js"], changeSummarySha256: SHA, state: pendingClosure,
});
const liveDelta = recordLiveDelta(pendingClosure, "SESSION-NEXT-ORCHESTRATOR", liveDeltaPacket);
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
const closureAvailablePlatform = compilePlatformAgent({
  logicalCapabilityId: liveDelta.platform_pool[0].logical_capability_id,
  logicalAgentId: liveDelta.platform_pool[0].logical_agent_id,
  executionSessionId: liveDelta.platform_pool[0].execution_session_id,
  platformWorktree: liveDelta.platform_pool[0].platform_worktree,
  state: "AVAILABLE",
});
const closurePlatform = archivePlatformAgent(closureAvailablePlatform, {universalCloseoutReceipts: platformCloseout});
const closureReadyLiveDelta = sealLifecycleState({...liveDelta, platform_pool: [closurePlatform]});
validateCampaignState(closureReadyLiveDelta);
const closed = applyLifecycleTransition(closureReadyLiveDelta, {...closureReadyLiveDelta, stage: "ACCEPTED_LIVE_CLOSED"}, {
  type: "ACCEPTED_LIVE_CLOSURE", at_utc: "2026-01-01T00:04:00.000Z", payload: {closure_receipt: closureReceipt},
});
const finalCandidate = compileNextCampaignCandidate({
  candidateKind: "FINAL", campaignId: "CAMPAIGN-2", campaignVersion: "v2", projectId: "LINE-1",
  sourceCommit: "commit-next-final", sourceTree: "tree-next-final", sourceWorktreeId: "next-final-worktree",
  ownerIntentSha256: SHA, ownerIntentSummarySha256: SHA,
  policyEpoch: closed.policy_epoch, policyStateSha256: closed.policy_state_sha256,
  acceptanceContractSha256: closed.acceptance_contract_sha256, questionTreeSha256: SHA,
  modelPlanSha256: SHA, modelRolesSha256: SHA, scopeSha256: SHA, changedPaths: ["src/next.js"],
  parentCandidateSha256: predeploymentCandidate.candidate_sha256,
  liveDeltaSha256: liveDeltaPacket.live_delta_sha256, state: closed,
});
const admitted = admitNextCampaign(closed, {
  finalCandidate,
  auditorBinding: identity("INDEPENDENT_AUDITOR", "SESSION-NEXT-AUDITOR", false, "CAMPAIGN-2", "v2"),
  featureAgentBindings: [identity("FEATURE_AGENT:TWO", "SESSION-NEXT-FEATURE", false, "CAMPAIGN-2", "v2")],
  platformAgentBindings: [identity("PLATFORM_AGENT:BACKEND_API", "SESSION-NEXT-PLATFORM", false, "CAMPAIGN-2", "v2")],
});
assert.equal(admitted.successor_orientation.status, "CAMPAIGN_ADMITTED");
assert.equal(admitted.successor_orientation.orchestrator_binding.orientation_only, false);

const event = compileLivingCampaignEvent({sequence: 0, eventId: "EVENT-1", writerSessionId: "SESSION-ORCHESTRATOR", eventType: "CHECKPOINT", payload: {checkpoint: "C2"}, createdAtUtc: ISO});
assert.equal(validateLivingCampaignLedger([event])["SESSION-ORCHESTRATOR"], event.event_sha256);
assert.throws(() => validateLivingCampaignLedger([{...event, sequence: 1}]));
const heartbeatPolicy = compileGlobalPolicyState({
  projectId: "CAMPAIGN-1", nowUtc: ISO, values: {"OPERATIONS.HEARTBEAT_INTERVAL_MINUTES": 30},
});
const heartbeatState = sealLifecycleState({...initial, policy_state_sha256: heartbeatPolicy.policy_state_sha256});
assert.equal(decideHeartbeatAction(heartbeatState, ISO, "2026-01-01T00:30:00.000Z", heartbeatPolicy).action, "RECONCILE");
assert.equal(decideHeartbeatAction(heartbeatState, ISO, "2026-01-01T00:29:59.000Z", heartbeatPolicy).action, "NO_ACTION");

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
hostileCase("second supervisor", () => acquirePlatformLease(leasedPlatform, {
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
hostileCase("reused current campaign Orchestrator session", () => orientNextCampaignOrchestrator(deploymentCleared,
  identity("CAMPAIGN_ORCHESTRATOR", "SESSION-ORCHESTRATOR", true, "CAMPAIGN-2", "v2"), SHA));
hostileCase("reused current campaign identity", () => admitNextCampaign(closed, {
  finalCandidateSha256: SHA,
  auditorBinding: identity("INDEPENDENT_AUDITOR", "SESSION-NEW-AUDITOR"),
  featureAgentBindings: [identity("FEATURE_AGENT:NEW", "SESSION-NEW-FEATURE")],
}));
hostileCase("roster identity from a different campaign", () => validateCampaignState(makeState({
  roster: {...initial.roster, campaign_orchestrator: identity("CAMPAIGN_ORCHESTRATOR", "SESSION-FOREIGN-ORCHESTRATOR", false, "CAMPAIGN-2", "v2")},
})));
hostileCase("duplicate current roster role", () => validateCampaignState(makeState({
  roster: {...initial.roster, feature_agents: [initial.roster.feature_agents[0], identity("FEATURE_AGENT:ONE", "SESSION-FEATURE-2")]},
})));
hostileCase("active writer outside current roster", () => validateCampaignState(makeState({
  active_writer: {...initial.active_writer, session_id: "SESSION-NOT-ROSTER"},
})));
hostileCase("Platform session collides with current roster", () => validateCampaignState(makeState({
  platform_pool: [compilePlatformAgent({logicalCapabilityId: "BACKEND_API", logicalAgentId: "PLATFORM-COLLIDE", executionSessionId: "SESSION-FEATURE-1", platformWorktree: worktree})],
})));
hostileCase("Finalizer reuses the source worktree", () => handoffToFinalizer(settledState, {
  ...finalizer,
  worktree_id: "root-worktree",
  finalizer_sha256: lifecycleDigest({...finalizer, worktree_id: "root-worktree", finalizer_sha256: null}),
}));
hostileCase("Finalizer reuses a current roster session", () => handoffToFinalizer(settledState, {
  ...finalizer,
  session_id: "SESSION-FEATURE-1",
  finalizer_sha256: lifecycleDigest({...finalizer, session_id: "SESSION-FEATURE-1", finalizer_sha256: null}),
}));
hostileCase("mixed successor campaign identities", () => admitNextCampaign(closed, {
  finalCandidateSha256: SHA,
  auditorBinding: identity("INDEPENDENT_AUDITOR", "SESSION-MIXED-AUDITOR", false, "CAMPAIGN-2", "v2"),
  featureAgentBindings: [identity("FEATURE_AGENT:MIXED", "SESSION-MIXED-FEATURE", false, "CAMPAIGN-3", "v3")],
}));
hostileCase("illegal blocked stage", () => sealLifecycleState({...initial, stage: "BLOCKED"}));
hostileCase("Finalizer without release", () => handoffToFinalizer({...settledState, active_writer: initial.active_writer}, finalizer));
hostileCase("CAS stale bytes", () => writeStateCompareAndSwap(path.join(os.tmpdir(), "agentos-missing-state.json"), Buffer.from("stale"), initial));

console.log(`PASS Governance 2.1rc campaign lifecycle (${hostile} hostile cases)`);
