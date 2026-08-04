#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileControllerCampaignCandidate} from "../control/agentos-controller.mjs";
import {
  compileLocalCampaignActivation,
  compileLocalCampaignAdmission,
  compileLocalCampaignIdentityBinding,
  compileLocalDevelopmentAuthorization,
  validateLocalCampaignAdmission,
  validateLocalDevelopmentAuthorization,
} from "../control/local-campaign-admission.mjs";

const SHA = "a".repeat(64);
const POLICY = "b".repeat(64);
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const NOW = "2026-08-04T12:00:00.000Z";

const authorization = compileLocalDevelopmentAuthorization({
  campaignId: "CAMPAIGN-AGENTOS-SELF-DEVELOPMENT-1",
  campaignVersion: "v2",
  sourceCommit: COMMIT,
  sourceTree: TREE,
  parentAuditPacketSha256: SHA,
  parentAuditAddendumSha256: SHA,
  ownerIntentSha256: SHA,
  decisionTreeRequirementSha256: SHA,
  policyEpoch: 1,
  policyStateSha256: POLICY,
  acceptanceContractSha256: SHA,
  modelPlanSha256: SHA,
  scopeSha256: SHA,
});
validateLocalDevelopmentAuthorization(authorization);
assert.equal(authorization.permissions.local_development_writes_allowed, true);
assert.equal(authorization.permissions.local_worker_agent_spawns_allowed, true);
assert.equal(authorization.permissions.external_push_allowed, false);

const candidate = compileControllerCampaignCandidate({
  projectId: "agentos-self-development",
  campaignId: authorization.campaign_id,
  campaignVersion: authorization.campaign_version,
  policyEpoch: authorization.policy_epoch,
  policyStateSha256: authorization.policy_state_sha256,
  ownerIntentSha256: authorization.owner_intent_sha256,
  acceptanceContractSha256: authorization.acceptance_contract_sha256,
  modelPlanSha256: authorization.model_plan_sha256,
  scopeSha256: authorization.scope_sha256,
  sourceCommit: COMMIT,
  sourceTree: TREE,
});
const binding = compileLocalCampaignIdentityBinding({
  authorization,
  candidate,
  auditCandidate: {candidate_id: "CANDIDATE-PARENT", candidate_sha256: SHA, commit: COMMIT, tree: TREE},
  auditCampaignVersion: "v1",
  auditPlanSha256: SHA,
  auditReconciliationSha256: SHA,
  parentAuditPacketSha256: SHA,
  parentAuditAddendumSha256: SHA,
});
const admission = compileLocalCampaignAdmission({authorization, candidate, identityBinding: binding, nowUtc: NOW});
validateLocalCampaignAdmission(admission);
assert.equal(admission.active_campaign, false);

const readbacks = [
  {role: "CAMPAIGN_ORCHESTRATOR", session_id: "ORCH", pid: "1", worktree_path: "/tmp/orch", source_commit: COMMIT, source_tree: TREE, status: "COMPLETED", build_status: "NOT_FEATURE_AGENT_BUILD", artifact_path: "orchestrator-plan.json", observed_at_utc: NOW, readback_sha256: SHA},
  {role: "INDEPENDENT_AUDITOR", session_id: "AUDITOR", pid: "2", worktree_path: "/tmp/auditor", source_commit: COMMIT, source_tree: TREE, status: "COMPLETED", build_status: "AUDIT_VERIFIED", build_commit: "3".repeat(40), build_tree: "4".repeat(40), changed_paths: ["control/governance-decision-tree.mjs"], focused_checks: ["node tests/verify-governance-decision-tree.mjs"], build_checkpoint_sha256: SHA, artifact_path: "auditor-observation.json", observed_at_utc: NOW, readback_sha256: SHA},
  {role: "FEATURE_AGENT", session_id: "FEATURE", pid: "3", worktree_path: "/tmp/feature", source_commit: COMMIT, source_tree: TREE, status: "COMPLETED", build_status: "COMPLETED", build_commit: "5".repeat(40), build_tree: "6".repeat(40), changed_paths: ["control/governance-decision-tree.mjs"], focused_checks: ["node tests/verify-governance-decision-tree.mjs"], build_checkpoint_sha256: SHA, artifact_path: "control/feature-agent-work-product.mjs", observed_at_utc: NOW, readback_sha256: SHA},
];
const activation = compileLocalCampaignActivation({admission, authorization, identityBinding: binding, candidate, spawnReadbacks: readbacks, controllerStateSha256: SHA, startedAtUtc: NOW});
assert.equal(activation.status, "CAMPAIGN_ACTIVE");

const staleBoundary = structuredClone(authorization);
staleBoundary.permissions.local_worker_agent_spawns_allowed = false;
staleBoundary.authorization_sha256 = SHA;
assert.throws(() => validateLocalDevelopmentAuthorization(staleBoundary), /local worker-agent spawns must be allowed|digest mismatch/u);

const externalBoundary = structuredClone(authorization);
externalBoundary.permissions.external_push_allowed = true;
externalBoundary.authorization_sha256 = SHA;
assert.throws(() => validateLocalDevelopmentAuthorization(externalBoundary), /external_push_allowed must remain disabled|digest mismatch/u);

const metadataOnly = structuredClone(readbacks);
metadataOnly[2].build_status = "NOT_FEATURE_AGENT_BUILD";
assert.throws(() => compileLocalCampaignActivation({admission, authorization, identityBinding: binding, candidate, spawnReadbacks: metadataOnly, controllerStateSha256: SHA, startedAtUtc: NOW}), /metadata-only Feature Agent marker|build status/u);

const oldSynthetic = structuredClone(authorization);
oldSynthetic.source = "OLD_SYNTHETIC_OWNER_REVIEW";
oldSynthetic.owner_decision.decision = "KEEP_REVIEW_ONLY";
oldSynthetic.authorization_sha256 = SHA;
assert.throws(() => validateLocalDevelopmentAuthorization(oldSynthetic), /owner's existing consent|current owner consent|local owner decision is not the authorized start|digest mismatch/u);

console.log("PASS local campaign admission (current-source binding, split local/external permissions, metadata-only build rejection, and anti-drift hostile coverage)");

