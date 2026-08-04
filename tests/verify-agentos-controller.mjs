#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyAndWriteAgentOSControllerEvent,
  compileAgentOSControllerState,
  compileControllerAdapterReadback,
  compileControllerAgentBinding,
  compileControllerCampaignCandidate,
  compileControllerEvent,
  compileControllerRuntimeReadback,
  controllerDigest,
  processControllerEvent,
  readAgentOSControllerState,
  validateAgentOSControllerState,
  writeAgentOSControllerStateCompareAndSwap,
} from "../control/agentos-controller.mjs";
import {
  applyPolicyAmendment,
  compileGlobalPolicyState,
  compilePolicyAmendment,
  compilePolicyApproval,
} from "../control/global-policy-state.mjs";

const SHA = "a".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:01:00.000Z";
const EVEN_LATER = "2026-01-01T00:02:00.000Z";
const PROJECT = "synthetic-project";
const CONTROLLER = "AGENTOS-CONTROLLER-1";

function candidate(policyState, campaignId = "CAMPAIGN-1", campaignVersion = "v1") {
  return compileControllerCampaignCandidate({
    projectId: PROJECT,
    campaignId,
    campaignVersion,
    policyEpoch: policyState.policy_epoch,
    policyStateSha256: policyState.policy_state_sha256,
    ownerIntentSha256: SHA,
    acceptanceContractSha256: SHA,
    modelPlanSha256: SHA,
    scopeSha256: SHA,
    sourceCommit: "COMMIT-A",
    sourceTree: "TREE-A",
  });
}

const policy = compileGlobalPolicyState({projectId: PROJECT, nowUtc: NOW});
const runtime = compileControllerRuntimeReadback({
  projectId: PROJECT,
  controllerRuntimeId: "CONTROLLER-RUNTIME-1",
  runtimeId: "PROJECT-RUNTIME-1",
  environmentIdentity: "CONTROLLER-ENV-1",
  capabilitySetSha256: SHA,
  observedBySession: "HOST-READBACK-1",
  observedAtUtc: NOW,
});
let state = compileAgentOSControllerState({
  projectId: PROJECT,
  logicalControllerId: CONTROLLER,
  currentSessionId: "CONTROLLER-SESSION-1",
  policyState: policy,
  controllerRuntimeReadback: runtime,
  nowUtc: NOW,
});
validateAgentOSControllerState(state);
assert.equal(state.operational_status, "IDLE");
assert.equal(state.reconciliation_interval_minutes, 30);
assert.equal(state.controller_role, "AGENTOS_CONTROLLER");
assert.equal(state.controller_display_name, "AgentOS Controller");

function readback({operation, action_id, controller_state, event, details = {}, externalIdentity = `EXT-${operation.toUpperCase()}`}) {
  return compileControllerAdapterReadback({
    operation,
    actionId: action_id,
    eventId: event.event_id,
    controllerId: controller_state.logical_controller_id,
    projectId: controller_state.project_id,
    policyEpoch: controller_state.policy_epoch,
    policyStateSha256: controller_state.policy_state_sha256,
    campaignId: controller_state.active_campaign_id ?? event.campaign_id ?? null,
    externalIdentity,
    observedAtUtc: event.occurred_at_utc,
    details,
  });
}

const adapters = {};
for (const operation of [
  "runBootstrap", "bindPersistentRuntime", "reconcileUserReview", "spawnCampaignOrchestrator", "spawnIndependentAuditor",
  "spawnFeatureAgents", "recoverStalledSession", "wakeControllerAgent", "applyPolicyReconciliation", "verifyCheckpoint",
  "notifyAuditor", "spawnNextCampaignOrchestrator", "deployAcceptedArtifact", "runLiveAudit", "sendLiveDeltaToNextOrchestrator",
  "closeCampaign", "archiveCampaignAgents", "reconcileLiveness",
]) {
  adapters[operation] = (context) => {
    const {controller_state: current, event, action_id, payload} = context;
    let details = {};
    if (operation === "bindPersistentRuntime") details = {runtime_id: current.runtime_id, controller_runtime_id: current.controller_runtime_readback.controller_runtime_id};
    if (operation === "reconcileUserReview") details = {candidate: candidate(current.policy_state)};
    if (operation === "spawnCampaignOrchestrator") details = {session_id: "CAMPAIGN-ORCH-1"};
    if (operation === "spawnIndependentAuditor") details = {session_id: "AUDITOR-1"};
    if (operation === "spawnFeatureAgents") details = {feature_agent_session_ids: ["FEATURE-1"]};
    if (operation === "wakeControllerAgent") details = {judgment_id: "JUDGMENT-1", reason: "The stalled dependency changes the route.", affected_outcomes: ["CAMPAIGN-1"]};
    if (operation === "recoverStalledSession") details = {replacement_session_id: "FEATURE-RECOVERED-1", role: "FEATURE_AGENT"};
    if (operation === "verifyCheckpoint") details = {checkpoint_sha256: payload.checkpoint_sha256};
    if (operation === "notifyAuditor") details = {checkpoint_sha256: payload.checkpoint_sha256, auditor_session_id: current.active_campaign.auditor_session_id};
    if (operation === "spawnNextCampaignOrchestrator") details = {session_id: "NEXT-ORCH-1", orientation_only: true};
    if (operation === "deployAcceptedArtifact") details = {candidate_sha256: payload.candidate_sha256, deployed_identity: "DEPLOYED-1", rollback_identity: "ROLLBACK-1"};
    if (operation === "runLiveAudit") details = {candidate_sha256: current.active_campaign.candidate_sha256, deployed_identity: payload.deployed_identity, live_audit_identity: "LIVE-AUDIT-1"};
    if (operation === "reconcileLiveness") details = {observed_at_utc: payload.observed_at_utc};
    if (operation === "applyPolicyReconciliation") {
      const nextPolicyState = payload.next_policy_state;
      const reconciliation = payload.reconciliation;
      if (reconciliation === null) {
        details = {policy_state_sha256: nextPolicyState.policy_state_sha256, controller_session_id: "CONTROLLER-SESSION-2"};
      } else {
        const nextRoster = current.active_campaign.roster.map((record) => record.role === "FEATURE_AGENT"
          ? {...record, session_id: "FEATURE-2", model_class: "ECONOMICAL"}
          : record);
        details = {
          policy_state_sha256: nextPolicyState.policy_state_sha256,
          controller_session_id: "CONTROLLER-SESSION-2",
          reconciliation_sha256: reconciliation.reconciliation_sha256,
          next_roster: nextRoster,
          recompiled_candidate: candidate(nextPolicyState, current.active_campaign.campaign_id, current.active_campaign.campaign_version),
        };
      }
    }
    return readback({operation, action_id, controller_state: current, event, details});
  };
}

function makeEvent(type, payload = {}, campaignId = null, sourceRole = "AGENTOS_CONTROLLER", at = NOW) {
  return compileControllerEvent({
    eventId: `EVENT-${state.event_cursor + 1}`,
    eventType: type,
    sourceRole,
    controllerId: state.logical_controller_id,
    projectId: state.project_id,
    policyEpoch: state.policy_epoch,
    policyStateSha256: state.policy_state_sha256,
    campaignId,
    sequence: state.event_cursor + 1,
    priorControllerHeadSha256: state.event_ledger_head_sha256,
    payload,
    occurredAtUtc: at,
  });
}

function apply(type, payload = {}, campaignId = null, sourceRole = "AGENTOS_CONTROLLER", at = NOW) {
  const event = makeEvent(type, payload, campaignId, sourceRole, at);
  state = processControllerEvent({state, event, adapters, nowUtc: at});
  validateAgentOSControllerState(state);
  return event;
}

apply("BOOTSTRAP_REQUESTED");
apply("BOOTSTRAP_PROMOTED");
const proposed = candidate(policy);
apply("USER_REVIEW_RETURNED", {}, null, "OWNER", LATER);
assert.equal(state.campaign_queue.length, 1);
apply("CAMPAIGN_APPROVED", {candidate: proposed, owner_approval_sha256: SHA}, proposed.campaign_id, "OWNER", LATER);
assert.equal(state.active_campaign_id, "CAMPAIGN-1");
assert.deepEqual(state.active_campaign.platform_agent_session_ids, []);
assert(!Object.hasOwn(state.active_campaign, "worktree_id"));
apply("AGENT_STALLED", {judgment_required: true}, "CAMPAIGN-1", "AGENTOS_CONTROLLER", EVEN_LATER);
assert.equal(state.pending_judgments.length, 1);
apply("CHECKPOINT_READY", {checkpoint_sha256: "b".repeat(64)}, "CAMPAIGN-1", "AGENTOS_CONTROLLER", EVEN_LATER);

const amendment = compilePolicyAmendment({
  state: policy,
  amendmentId: "AMENDMENT-FEATURE-MODEL",
  changes: [{variable_id: "MODEL.ROLE.FEATURE_AGENT", new_value: "ECONOMICAL"}],
  request: {
    requested_by: "OWNER", authority: "OWNER_BOUNDARY", reason: "Use economical first-pass feature work.", requested_at_utc: NOW,
    effective_boundary: "NEXT_ASSIGNMENT", approval_state: "PENDING_EXACT_APPROVAL",
  },
});
const nextPolicy = applyPolicyAmendment({
  state: policy,
  amendment,
  approval: compilePolicyApproval({amendment, approvedAtUtc: LATER, actorDigestSha256: SHA}),
  currentBoundary: "NEXT_ASSIGNMENT",
});
const policyEvent = compileControllerEvent({
  eventId: `EVENT-${state.event_cursor + 1}`,
  eventType: "POLICY_AMENDMENT",
  sourceRole: "OWNER",
  controllerId: state.logical_controller_id,
  projectId: state.project_id,
  policyEpoch: state.policy_epoch,
  policyStateSha256: state.policy_state_sha256,
  campaignId: "CAMPAIGN-1",
  sequence: state.event_cursor + 1,
  priorControllerHeadSha256: state.event_ledger_head_sha256,
  payload: {amendment, next_policy_state: nextPolicy, current_boundary: "NEXT_ASSIGNMENT"},
  occurredAtUtc: LATER,
});
state = processControllerEvent({state, event: policyEvent, adapters, nowUtc: LATER});
assert.equal(state.policy_epoch, 2);
assert.equal(state.current_session_id, "CONTROLLER-SESSION-2");
assert.equal(state.active_campaign.roster.find((record) => record.role === "FEATURE_AGENT").session_id, "FEATURE-2");
assert.equal(state.active_campaign.candidate.policy_state_sha256, nextPolicy.policy_state_sha256);

apply("CHECKPOINT_READY", {checkpoint_sha256: "c".repeat(64)}, "CAMPAIGN-1", "AGENTOS_CONTROLLER", "2026-01-01T00:03:00.000Z");
apply("AUDITOR_RELEASE_CLEARED", {candidate_sha256: state.active_campaign.candidate_sha256}, "CAMPAIGN-1", "INDEPENDENT_AUDITOR", "2026-01-01T00:04:00.000Z");
apply("RUNTIME_DEPLOYED", {deployed_identity: "DEPLOYED-1"}, "CAMPAIGN-1", "RUNTIME", "2026-01-01T00:05:00.000Z");
apply("ACCEPTED_LIVE", {}, "CAMPAIGN-1", "AGENTOS_CONTROLLER", "2026-01-01T00:06:00.000Z");
assert.equal(state.active_campaign, null);
assert.equal(state.runtime_id, "PROJECT-RUNTIME-1");
assert.equal(state.last_closed_campaign_id, "CAMPAIGN-1");
apply("RECONCILIATION_TICK", {}, null, "AGENTOS_CONTROLLER", "2026-01-01T00:30:00.000Z");
apply("TRUE_OWNER_BOUNDARY", {boundary_id: "BOUNDARY-1", scope: "publication", reason: "Owner approval is required before public release.", recommended_action: "Keep the candidate prepared."}, null, "OWNER", "2026-01-01T00:31:00.000Z");
assert.equal(state.operational_status, "OWNER_ONLY");

const badSequenceEvent = {...makeEvent("RECONCILIATION_TICK"), sequence: state.event_cursor + 2, event_sha256: null};
badSequenceEvent.event_sha256 = controllerDigest({...badSequenceEvent, event_sha256: null});
assert.throws(() => processControllerEvent({state, event: badSequenceEvent, adapters}), /sequence/u);
assert.throws(() => processControllerEvent({state, event: makeEvent("RECONCILIATION_TICK"), adapters: {} }), /adapter is unavailable/u);
const tampered = structuredClone(state);
tampered.current_session_id = "ATTACKER";
assert.throws(() => validateAgentOSControllerState(tampered), /binding differs|digest mismatch/u);
const stale = structuredClone(state);
stale.state_sha256 = "d".repeat(64);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-test-"));
writeAgentOSControllerStateCompareAndSwap({authorityRoot: tempRoot, state: state});
assert.deepEqual(readAgentOSControllerState({authorityRoot: tempRoot}), state);
assert.throws(() => writeAgentOSControllerStateCompareAndSwap({authorityRoot: tempRoot, expectedStateSha256: stale.state_sha256, state}), /compare-and-swap parent is stale/u);
const symlinkPath = path.join(tempRoot, "symlink.json");
fs.symlinkSync(path.join(tempRoot, "missing.json"), symlinkPath);
assert.throws(() => readAgentOSControllerState({authorityRoot: tempRoot, statePath: "symlink.json"}), /regular non-symlink/u);

console.log("PASS AgentOS persistent project Controller (event loop, adapter readbacks, policy rotation, campaign closure, CAS, and hostile boundaries)");
