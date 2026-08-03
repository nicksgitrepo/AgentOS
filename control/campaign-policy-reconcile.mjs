#!/usr/bin/env node

import {
  MODEL_CLASSES,
  POLICY_VARIABLES,
  getPolicyValue,
  policyDigest,
  validatePolicyAmendment,
  validatePolicyState,
} from "./global-policy-state.mjs";

const ROLES = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT", "PLATFORM_AGENT",
  "AUDIT_WORKER", "CAMPAIGN_FINALIZER", "RUNTIME",
].sort());
const PROJECTION_KEYS = [
  "schema", "campaign_id", "campaign_version", "policy_epoch", "policy_state_sha256",
  "mode", "model_profile", "role_models", "heartbeat_interval_minutes", "projection_sha256",
];
const ROLE_KEYS = ["role", "model_class"];
const RECONCILIATION_KEYS = [
  "schema", "campaign_id", "campaign_version", "previous_projection_sha256", "next_projection_sha256",
  "amendment_sha256", "policy_epoch", "policy_state_sha256", "rotations_required", "stale_session_ids",
  "invalidated_question_ids", "recompile_targets", "next_assignments", "status", "reconciliation_sha256",
];
const BOUNDARY_RANK = new Map(["IMMEDIATE_SAFE", "NEXT_CHECKPOINT", "NEXT_ASSIGNMENT", "NEXT_CAMPAIGN", "OWNER_AUTHENTICATED_APPROVAL", "GOVERNANCE_VERSION"].map((value, index) => [value, index]));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireRecord(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a lowercase SHA-256`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.every((value) => typeof value === "string" && value.length > 0), `${label} must be an array of nonempty strings`);
  const sorted = [...values].sort();
  assert(new Set(sorted).size === sorted.length && JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted and unique`);
}

function validateRoleModels(roleModels, label = "role models") {
  assert(Array.isArray(roleModels) && roleModels.length === ROLES.length, `${label} must cover every campaign role`);
  const seen = new Set();
  for (const record of roleModels) {
    exactKeys(record, ROLE_KEYS, `${label} record`);
    assert(ROLES.includes(record.role) && !seen.has(record.role), `${label} role is unknown or duplicated`);
    assert(MODEL_CLASSES.includes(record.model_class), `${label} model class is invalid`);
    seen.add(record.role);
  }
  assert(JSON.stringify([...seen].sort()) === JSON.stringify([...ROLES].sort()), `${label} is missing a role`);
  assert(JSON.stringify(roleModels.map((item) => item.role)) === JSON.stringify([...roleModels].map((item) => item.role).sort()), `${label} must be sorted by role`);
}

function validateCampaignIdentity(campaignId, campaignVersion) {
  requireString(campaignId, "campaign policy campaign ID");
  requireString(campaignVersion, "campaign policy campaign version");
}

export function compileCampaignPolicyProjection({policyState, campaignId, campaignVersion}) {
  validatePolicyState(policyState);
  validateCampaignIdentity(campaignId, campaignVersion);
  const projection = {
    schema: "agentos.campaign_policy_projection.v1",
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    policy_epoch: policyState.policy_epoch,
    policy_state_sha256: policyState.policy_state_sha256,
    mode: getPolicyValue(policyState, "CAMPAIGN.MODE"),
    model_profile: getPolicyValue(policyState, "MODEL.PROFILE"),
    role_models: ROLES.map((role) => ({role, model_class: getPolicyValue(policyState, `MODEL.ROLE.${role}`)})),
    heartbeat_interval_minutes: getPolicyValue(policyState, "OPERATIONS.HEARTBEAT_INTERVAL_MINUTES"),
    projection_sha256: null,
  };
  projection.projection_sha256 = policyDigest({...projection, projection_sha256: null});
  return validateCampaignPolicyProjection(projection, policyState);
}

export function validateCampaignPolicyProjection(projection, policyState = null) {
  exactKeys(projection, PROJECTION_KEYS, "campaign policy projection");
  assert(projection.schema === "agentos.campaign_policy_projection.v1", "campaign policy projection schema mismatch");
  validateCampaignIdentity(projection.campaign_id, projection.campaign_version);
  assert(Number.isSafeInteger(projection.policy_epoch) && projection.policy_epoch >= 1, "campaign policy projection epoch is invalid");
  requireSha(projection.policy_state_sha256, "campaign policy projection state");
  assert(typeof projection.mode === "string" && Object.hasOwn(POLICY_VARIABLES, "CAMPAIGN.MODE"), "campaign policy projection mode is invalid");
  assert(typeof projection.model_profile === "string" && MODEL_CLASSES.includes(projection.model_profile), "campaign policy projection profile is invalid");
  validateRoleModels(projection.role_models);
  assert(Number.isSafeInteger(projection.heartbeat_interval_minutes) && projection.heartbeat_interval_minutes >= 1 && projection.heartbeat_interval_minutes <= 1440, "campaign policy projection heartbeat is invalid");
  requireSha(projection.projection_sha256, "campaign policy projection digest");
  assert(projection.projection_sha256 === policyDigest({...projection, projection_sha256: null}), "campaign policy projection digest mismatch");
  if (policyState !== null) {
    validatePolicyState(policyState);
    assert(projection.policy_epoch === policyState.policy_epoch && projection.policy_state_sha256 === policyState.policy_state_sha256, "campaign policy projection is stale");
    assert(projection.mode === getPolicyValue(policyState, "CAMPAIGN.MODE"), "campaign policy projection mode differs from policy state");
    assert(projection.model_profile === getPolicyValue(policyState, "MODEL.PROFILE"), "campaign policy projection profile differs from policy state");
    assert(projection.heartbeat_interval_minutes === getPolicyValue(policyState, "OPERATIONS.HEARTBEAT_INTERVAL_MINUTES"), "campaign policy projection heartbeat differs from policy state");
    for (const record of projection.role_models) assert(record.model_class === getPolicyValue(policyState, `MODEL.ROLE.${record.role}`), `campaign policy projection role differs from policy state: ${record.role}`);
  }
  return projection;
}

function validateActiveRoster(activeRoster) {
  assert(Array.isArray(activeRoster), "campaign policy active roster is required");
  const roles = new Set();
  const sessions = new Set();
  for (const record of activeRoster) {
    exactKeys(record, ["role", "session_id", "model_class"], "campaign policy active roster record");
    assert(ROLES.includes(record.role) && !roles.has(record.role), "campaign policy active roster role is unknown or duplicated");
    requireString(record.session_id, "campaign policy active roster session");
    assert(!sessions.has(record.session_id), "campaign policy active roster session is duplicated");
    assert(MODEL_CLASSES.includes(record.model_class), "campaign policy active roster model class is invalid");
    roles.add(record.role);
    sessions.add(record.session_id);
  }
}

export function reconcileCampaignPolicy({currentProjection, nextPolicyState, amendment, activeRoster, currentBoundary = amendment?.effective_boundary}) {
  validateCampaignPolicyProjection(currentProjection);
  validatePolicyState(nextPolicyState);
  validatePolicyAmendment(amendment);
  validateActiveRoster(activeRoster);
  assert(amendment.parent_policy_state_sha256 === currentProjection.policy_state_sha256, "campaign policy amendment parent differs from current projection");
  assert(nextPolicyState.parent_policy_state_sha256 === currentProjection.policy_state_sha256 && nextPolicyState.policy_epoch === currentProjection.policy_epoch + 1, "campaign policy next state is not the immediate amended state");
  assert(BOUNDARY_RANK.has(currentBoundary) && BOUNDARY_RANK.get(currentBoundary) >= BOUNDARY_RANK.get(amendment.effective_boundary), "campaign policy amendment is not effective at this boundary");
  const nextProjection = compileCampaignPolicyProjection({policyState: nextPolicyState, campaignId: currentProjection.campaign_id, campaignVersion: currentProjection.campaign_version});
  const rotations = [...amendment.rotations_required].sort();
  const staleSessionIds = activeRoster.filter((record) => rotations.includes(record.role)).map((record) => record.session_id).sort();
  const nextAssignments = activeRoster.map((record) => ({
    role: record.role,
    session_id: record.session_id,
    model_class: nextProjection.role_models.find((item) => item.role === record.role).model_class,
    assignment_status: rotations.includes(record.role) ? "ROTATE_AT_BOUNDARY" : "RETAIN",
  }));
  const result = {
    schema: "agentos.campaign_policy_reconciliation.v1",
    campaign_id: currentProjection.campaign_id,
    campaign_version: currentProjection.campaign_version,
    previous_projection_sha256: currentProjection.projection_sha256,
    next_projection_sha256: nextProjection.projection_sha256,
    amendment_sha256: amendment.amendment_sha256,
    policy_epoch: nextPolicyState.policy_epoch,
    policy_state_sha256: nextPolicyState.policy_state_sha256,
    rotations_required: rotations,
    stale_session_ids: staleSessionIds,
    invalidated_question_ids: [...amendment.invalidated_question_ids],
    recompile_targets: [...amendment.recompile_targets],
    next_assignments: nextAssignments,
    status: "APPLIED_AT_DECLARED_BOUNDARY",
    reconciliation_sha256: null,
  };
  result.reconciliation_sha256 = policyDigest({...result, reconciliation_sha256: null});
  return {nextProjection, reconciliation: validateCampaignPolicyReconciliation(result)};
}

export function validateCampaignPolicyReconciliation(reconciliation) {
  exactKeys(reconciliation, RECONCILIATION_KEYS, "campaign policy reconciliation");
  assert(reconciliation.schema === "agentos.campaign_policy_reconciliation.v1", "campaign policy reconciliation schema mismatch");
  validateCampaignIdentity(reconciliation.campaign_id, reconciliation.campaign_version);
  for (const field of ["previous_projection_sha256", "next_projection_sha256", "amendment_sha256", "policy_state_sha256", "reconciliation_sha256"]) requireSha(reconciliation[field], `campaign policy reconciliation ${field}`);
  assert(Number.isSafeInteger(reconciliation.policy_epoch) && reconciliation.policy_epoch >= 1, "campaign policy reconciliation epoch is invalid");
  sortedUnique(reconciliation.rotations_required, "campaign policy rotations");
  sortedUnique(reconciliation.stale_session_ids, "campaign policy stale sessions");
  sortedUnique(reconciliation.invalidated_question_ids, "campaign policy invalidated questions");
  sortedUnique(reconciliation.recompile_targets, "campaign policy recompile targets");
  assert(Array.isArray(reconciliation.next_assignments), "campaign policy next assignments are required");
  for (const assignment of reconciliation.next_assignments) {
    exactKeys(assignment, ["role", "session_id", "model_class", "assignment_status"], "campaign policy assignment");
    assert(ROLES.includes(assignment.role) && MODEL_CLASSES.includes(assignment.model_class), "campaign policy assignment is invalid");
    requireString(assignment.session_id, "campaign policy assignment session");
    assert(["RETAIN", "ROTATE_AT_BOUNDARY"].includes(assignment.assignment_status), "campaign policy assignment status is invalid");
  }
  assert(reconciliation.status === "APPLIED_AT_DECLARED_BOUNDARY", "campaign policy reconciliation status is invalid");
  assert(reconciliation.reconciliation_sha256 === policyDigest({...reconciliation, reconciliation_sha256: null}), "campaign policy reconciliation digest mismatch");
  return reconciliation;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("campaign policy reconciliation controller loaded\n");
