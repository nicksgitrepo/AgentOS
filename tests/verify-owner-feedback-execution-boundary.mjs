#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileControllerCampaignCandidate} from "../control/agentos-controller.mjs";
import {
  compileLocalCampaignAdmission,
  compileLocalCampaignExecutionBoundary,
  compileLocalCampaignIdentityBinding,
  compileLocalDevelopmentAuthorization,
  validateLocalCampaignExecutionBoundary,
} from "../control/local-campaign-admission.mjs";

const SHA = "a".repeat(64);
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const authorization = compileLocalDevelopmentAuthorization({campaignId: "CAMPAIGN-BOUNDARY-1", campaignVersion: "v1", sourceCommit: COMMIT, sourceTree: TREE, parentAuditPacketSha256: SHA, parentAuditAddendumSha256: SHA, ownerIntentSha256: SHA, decisionTreeRequirementSha256: SHA, policyEpoch: 1, policyStateSha256: SHA, acceptanceContractSha256: SHA, modelPlanSha256: SHA, scopeSha256: SHA});
const candidate = compileControllerCampaignCandidate({projectId: "PROJECT-BOUNDARY", campaignId: authorization.campaign_id, campaignVersion: authorization.campaign_version, policyEpoch: 1, policyStateSha256: SHA, ownerIntentSha256: SHA, acceptanceContractSha256: SHA, modelPlanSha256: SHA, scopeSha256: SHA, sourceCommit: COMMIT, sourceTree: TREE});
const binding = compileLocalCampaignIdentityBinding({authorization, candidate, auditCandidate: {candidate_id: "CANDIDATE-BOUNDARY", candidate_sha256: SHA, commit: COMMIT, tree: TREE}, auditPlanSha256: SHA, auditReconciliationSha256: SHA, parentAuditPacketSha256: SHA, parentAuditAddendumSha256: SHA});
const admission = compileLocalCampaignAdmission({authorization, candidate, identityBinding: binding, nowUtc: "2026-08-04T12:00:00.000Z"});
const boundary = compileLocalCampaignExecutionBoundary({authorization, admission});
assert.equal(boundary.status, "PREPARED_OWNER_AUTHORIZED");
assert.equal(boundary.campaign_start_allowed, true);
assert.equal(boundary.active_campaign, false);
assert.deepEqual(boundary.required_worker_roles, ["CAMPAIGN_ORCHESTRATOR", "FEATURE_AGENT", "INDEPENDENT_AUDITOR"]);
assert.equal(boundary.product_writes_allowed, false);
assert.equal(boundary.product_agent_spawns_allowed, false);
assert.equal(boundary.external_push_allowed, false);
assert.doesNotThrow(() => validateLocalCampaignExecutionBoundary(boundary));
assert.throws(() => validateLocalCampaignExecutionBoundary({...boundary, product_writes_allowed: true}), /product_writes_allowed must remain closed|digest mismatch/u);
console.log("PASS local campaign execution has a separate owner-authorized inactive boundary with closed Product and external permissions");
