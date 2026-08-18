#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileControllerCampaignCandidate, compileControllerEvent} from "../control/agentos-controller.mjs";
import {
  compileLocalCampaignActivation,
  compileLocalCampaignAdmission,
  compileLocalCampaignIdentityBinding,
  compileLocalDevelopmentAuthorization,
  validateLocalCampaignAdmission,
  validateLocalDevelopmentAuthorization,
} from "../control/local-campaign-admission.mjs";
import {localStartEventId, parseLocalStartArgs, resolveLocalStartInputs} from "../control/start-local-self-development.mjs";

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
  {role: "CAMPAIGN_ORCHESTRATOR", session_id: "ORCH", campaign_id: authorization.campaign_id, campaign_version: authorization.campaign_version, candidate_sha256: candidate.candidate_sha256, pid: "1", worktree_path: "/tmp/orch", source_commit: COMMIT, source_tree: TREE, status: "COMPLETED", build_status: "NOT_FEATURE_AGENT_BUILD", artifact_path: "orchestrator-plan.json", observed_at_utc: NOW, readback_sha256: SHA},
  {role: "INDEPENDENT_AUDITOR", session_id: "AUDITOR", campaign_id: authorization.campaign_id, campaign_version: authorization.campaign_version, candidate_sha256: candidate.candidate_sha256, pid: "2", worktree_path: "/tmp/auditor", source_commit: COMMIT, source_tree: TREE, status: "COMPLETED", build_status: "AUDIT_VERIFIED", build_commit: "3".repeat(40), build_tree: "4".repeat(40), changed_paths: ["control/governance-decision-tree.mjs"], focused_checks: ["node tests/verify-governance-decision-tree.mjs"], build_checkpoint_sha256: SHA, artifact_path: "auditor-observation.json", observed_at_utc: NOW, readback_sha256: SHA},
  {role: "FEATURE_AGENT", session_id: "FEATURE", campaign_id: authorization.campaign_id, campaign_version: authorization.campaign_version, candidate_sha256: candidate.candidate_sha256, pid: "3", worktree_path: "/tmp/feature", source_commit: COMMIT, source_tree: TREE, status: "COMPLETED", build_status: "COMPLETED", build_commit: "5".repeat(40), build_tree: "6".repeat(40), changed_paths: ["control/governance-decision-tree.mjs"], focused_checks: ["node tests/verify-governance-decision-tree.mjs"], build_checkpoint_sha256: SHA, artifact_path: "control/feature-agent-work-product.mjs", observed_at_utc: NOW, readback_sha256: SHA},
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

const duplicateSession = structuredClone(readbacks);
duplicateSession[1].session_id = duplicateSession[0].session_id;
assert.throws(() => compileLocalCampaignActivation({admission, authorization, identityBinding: binding, candidate, spawnReadbacks: duplicateSession, controllerStateSha256: SHA, startedAtUtc: NOW}), /session identities must be unique/u);

const foreignCampaign = structuredClone(readbacks);
foreignCampaign[0].campaign_id = "OTHER-CAMPAIGN";
assert.throws(() => compileLocalCampaignActivation({admission, authorization, identityBinding: binding, candidate, spawnReadbacks: foreignCampaign, controllerStateSha256: SHA, startedAtUtc: NOW}), /campaign identity differs/u);

const oldSynthetic = structuredClone(authorization);
oldSynthetic.source = "OLD_SYNTHETIC_OWNER_REVIEW";
oldSynthetic.owner_decision.decision = "KEEP_REVIEW_ONLY";
oldSynthetic.authorization_sha256 = SHA;
assert.throws(() => validateLocalDevelopmentAuthorization(oldSynthetic), /owner's existing consent|current owner consent|local owner decision is not the authorized start|digest mismatch/u);

const lowercaseEventId = `LOCAL-SELF-DEVELOPMENT-AUTHORIZED-${"a".repeat(12)}`;
assert.throws(() => compileControllerEvent({
  eventId: lowercaseEventId,
  eventType: "LOCAL_SELF_DEVELOPMENT_AUTHORIZED",
  sourceRole: "AGENTOS_CONTROLLER",
  controllerId: "AGENTOS-CONTROLLER-1",
  projectId: "agentos-self-development",
  policyEpoch: 1,
  policyStateSha256: POLICY,
  campaignId: authorization.campaign_id,
  sequence: 1,
  priorControllerHeadSha256: null,
  payload: {},
  occurredAtUtc: NOW,
}), /event type is invalid|stable identifier/u);
const generatedEventId = localStartEventId("a".repeat(40));
assert.match(generatedEventId, /LOCAL-SELF-DEVELOPMENT-AUTHORIZED-A{12}/u);
assert.throws(() => compileControllerEvent({
  eventId: generatedEventId,
  eventType: "LOCAL_SELF_DEVELOPMENT_AUTHORIZED",
  sourceRole: "AGENTOS_CONTROLLER",
  controllerId: "AGENTOS-CONTROLLER-1",
  projectId: "agentos-self-development",
  policyEpoch: 1,
  policyStateSha256: POLICY,
  campaignId: authorization.campaign_id,
  sequence: 1,
  priorControllerHeadSha256: null,
  payload: {},
  occurredAtUtc: NOW,
}), /event type is invalid/u, "Controller must reject legacy local campaign admission; Spawner owns agent creation");

assert.throws(() => parseLocalStartArgs([process.cwd()]), /AGENTOS_BOOTSTRAP_HANDOFF_REQUIRED/u);
const handoffRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-handoff-"));
try {
  for (const fileName of ["audit-packet.json", "audit-handoff-addendum.json", "approval-packet.json", "campaign-status.json"]) {
    fs.writeFileSync(path.join(handoffRoot, fileName), "{}\n", {flag: "wx", mode: 0o600});
  }
  const parsed = parseLocalStartArgs([process.cwd(), "--bootstrap-handoff-root", handoffRoot]);
  assert.equal(parsed.bootstrapHandoffRoot, handoffRoot);
  const resolved = resolveLocalStartInputs({repoRoot: process.cwd(), bootstrapHandoffRoot: handoffRoot});
  assert.equal(resolved.handoffRoot, fs.realpathSync(handoffRoot));
  const inRepoHandoff = fs.mkdtempSync(path.join(process.cwd(), "tmp-local-start-"));
  try {
    assert.throws(() => resolveLocalStartInputs({repoRoot: process.cwd(), bootstrapHandoffRoot: inRepoHandoff}), /outside the AgentOS repository/u);
  } finally {
    fs.rmSync(inRepoHandoff, {recursive: true, force: true});
  }
} finally {
  fs.rmSync(handoffRoot, {recursive: true, force: true});
}

console.log("PASS local campaign admission (current-source binding, split local/external permissions, metadata-only build rejection, and anti-drift hostile coverage)");
