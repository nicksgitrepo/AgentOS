#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  applyPolicyAmendment,
  compileGlobalPolicyState,
  compilePolicyAmendment,
  compilePolicyApproval,
} from "../control/global-policy-state.mjs";
import {
  compileCampaignPolicyProjection,
  reconcileCampaignPolicy,
  validateCampaignPolicyProjection,
  validateCampaignPolicyReconciliation,
} from "../control/campaign-policy-reconcile.mjs";
import {reconcilePolicyAtCampaignBoundary} from "../control/campaign-state-owner.mjs";

const SHA = "a".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T01:00:00.000Z";
const state = compileGlobalPolicyState({projectId: "synthetic-project", nowUtc: NOW});
const currentProjection = compileCampaignPolicyProjection({policyState: state, campaignId: "CAMPAIGN-1", campaignVersion: "v1"});
const roster = [
  "CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT", "PLATFORM_AGENT", "AUDIT_WORKER", "CAMPAIGN_FINALIZER", "RUNTIME",
].sort().map((role) => ({role, session_id: `SESSION-${role}`, model_class: currentProjection.role_models.find((item) => item.role === role).model_class}));
const amendment = compilePolicyAmendment({
  state,
  amendmentId: "AMENDMENT-PROJECTION-001",
  changes: [{variable_id: "MODEL.ROLE.FEATURE_AGENT", new_value: "ECONOMICAL"}],
  request: {
    requested_by: "OWNER", authority: "OWNER_BOUNDARY", reason: "Use the economical Feature Agent class.", requested_at_utc: NOW,
    effective_boundary: "NEXT_ASSIGNMENT", approval_state: "PENDING_EXACT_APPROVAL",
  },
  questionIdsByRoot: {FUNCTION_REQUIREMENTS: ["FR-FEATURE"], DESIGN_BIBLE: ["DB-FEATURE"], SECURITY: ["SEC-FEATURE"]},
});
const approval = compilePolicyApproval({amendment, approvedAtUtc: LATER, actorDigestSha256: SHA});
const nextState = applyPolicyAmendment({state, amendment, approval, currentBoundary: "NEXT_ASSIGNMENT"});
const {nextProjection, reconciliation} = reconcileCampaignPolicy({currentProjection, nextPolicyState: nextState, amendment, activeRoster: roster, currentBoundary: "NEXT_ASSIGNMENT"});
const canonicalBoundary = reconcilePolicyAtCampaignBoundary({
  currentPolicyState: state,
  nextPolicyState: nextState,
  amendment,
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  activeRoster: roster,
  currentBoundary: "NEXT_ASSIGNMENT",
});
assert.equal(canonicalBoundary.nextProjection.projection_sha256, nextProjection.projection_sha256);
assert.deepEqual(canonicalBoundary.reconciliation.stale_session_ids, ["SESSION-FEATURE_AGENT"]);
assert.throws(() => reconcilePolicyAtCampaignBoundary({
  currentPolicyState: state,
  nextPolicyState: nextState,
  amendment: {...amendment, parent_policy_state_sha256: SHA},
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  activeRoster: roster,
  currentBoundary: "NEXT_ASSIGNMENT",
}), /parent differs|amendment digest mismatch/u);
assert.equal(nextProjection.role_models.find((item) => item.role === "FEATURE_AGENT").model_class, "ECONOMICAL");
assert.deepEqual(reconciliation.rotations_required, ["FEATURE_AGENT"]);
assert.deepEqual(reconciliation.stale_session_ids, ["SESSION-FEATURE_AGENT"]);
assert.deepEqual(reconciliation.invalidated_question_ids, []);
assert.equal(reconciliation.next_assignments.find((item) => item.role === "FEATURE_AGENT").assignment_status, "ROTATE_AT_BOUNDARY");
assert.equal(reconciliation.next_assignments.find((item) => item.role === "FEATURE_AGENT").model_class, "ECONOMICAL");
validateCampaignPolicyReconciliation(reconciliation);

assert.throws(() => reconcileCampaignPolicy({currentProjection, nextPolicyState: nextState, amendment, activeRoster: roster, currentBoundary: "IMMEDIATE_SAFE"}), /not effective/u);
assert.throws(() => reconcileCampaignPolicy({currentProjection, nextPolicyState: nextState, amendment: {...amendment, parent_policy_state_sha256: SHA}, activeRoster: roster, currentBoundary: "NEXT_ASSIGNMENT"}), /parent differs|amendment digest mismatch/u);
const tamperedProjection = structuredClone(currentProjection);
tamperedProjection.role_models[0].model_class = "FRONTIER";
assert.throws(() => validateCampaignPolicyProjection(tamperedProjection, state), /digest mismatch|differs/u);

console.log("PASS AgentOS campaign policy reconciliation (model rotation, assignment projection, question/recompile bindings, and hostile boundaries)");
