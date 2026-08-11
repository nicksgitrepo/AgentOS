#!/usr/bin/env node

/*
 * Portable governance-repair records.
 *
 * This module deliberately does not perform Git, host, Runtime, campaign, or
 * activation actions. It compiles and verifies the records that an external
 * repair adapter may consume. Raw provider/session/process identity belongs in
 * the host boundary; persisted records use opaque binding-derived references.
 */

import {assertPersistedRecordSafe, canonicalDigest} from "./content-addressing.mjs";

export const FAILURE_CLASSIFICATION_SCHEMA = "agentos.failure_classification.v1";
export const ROOT_CAUSE_ANALYSIS_SCHEMA = "agentos.root_cause_analysis.v1";
export const OWNER_REPAIR_APPROVAL_SCHEMA = "agentos.owner_repair_approval.v1";
export const REPAIR_PROPOSAL_SCHEMA = "agentos.repair_proposal.v1";
export const CHECKPOINT_SCHEMA = "agentos.digest_bound_checkpoint.v1";
export const GOVERNANCE_PATCH_VERSION_SCHEMA = "agentos.governance_patch_version.v1";
export const REPAIR_RECEIPT_SCHEMA = "agentos.repair_receipt.v1";

export const FAILURE_CLASSES = Object.freeze([
  "HARD_BOUNDARY",
  "SOURCE_DRIFT",
  "TRUE_BLOCKER",
  "SOFT_BOUNDARY",
  "REPAIRABLE_PUZZLE",
  "NONE",
]);

export const FAILURE_ACTIONS = Object.freeze([
  "STOP_HARD_BOUNDARY",
  "REASSESS_GOAL",
  "REVIEW_TRUE_BLOCKER",
  "REVIEW_SOFT_BOUNDARY",
  "PROPOSE_REPAIR",
  "CONTINUE",
]);

export const RCA_STATUSES = Object.freeze([
  "OPEN",
  "ROUTED",
  "REPAIRING",
  "REPAIRED",
  "BLOCKED",
  "CLOSED",
]);

export const REPAIR_PROPOSAL_STATUSES = Object.freeze([
  "PROPOSED",
  "ADMITTED",
  "REJECTED",
]);

export const PATCH_VERSION_STATUSES = Object.freeze([
  "PREPARED_NOT_ACTIVATED",
  "VERIFIED_NOT_ACTIVATED",
]);

export const REPAIR_RECEIPT_STATUSES = Object.freeze([
  "VERIFIED_NOT_ACTIVATED",
]);

export const DEFAULT_SAFETY_FLOOR = Object.freeze({
  hard_boundaries_immutable: true,
  soft_boundary_review_required: true,
  owner_approval_required: true,
  product_writes_allowed: false,
  external_actions_allowed: false,
  activation_allowed: false,
  deletion_allowed: false,
  authority_change_allowed: false,
});

export const PROTECTED_ACTIONS = Object.freeze({
  acceptance: false,
  activation: false,
  deletion: false,
  deployment: false,
  external_release: false,
  external_publish: false,
  external_push: false,
  merge: false,
  product_writes: false,
  secrets: false,
  spend: false,
  authority_change: false,
});

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._-]{0,95}$/u;
const OPAQUE_REFERENCE = /^[a-z][a-z0-9._-]{1,31}:[0-9a-f]{64}$/u;
const GOVERNANCE_VERSION = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-(?:rc|tb)-[0-9]+)?$/u;
const TEST_BUILD = /^tb-[0-9]{2}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function requireString(value, label, {max = 512} = {}) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(value.length <= max, `${label} is too long`);
  return value;
}

function requireIdentifier(value, label) {
  requireString(value, label, {max: 96});
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
  return value;
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`);
  return value;
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
  return value;
}

function requireOpaqueReference(value, label) {
  assert(typeof value === "string" && OPAQUE_REFERENCE.test(value), `${label} must be an opaque reference`);
  return value;
}

function requireUtc(value, label) {
  requireString(value, label, {max: 40});
  assert(Number.isFinite(Date.parse(value)), `${label} must be a timestamp`);
  return value;
}

function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
  return value;
}

function requireDigestField(value, field, label) {
  requireSha(value[field], `${label}.${field}`);
}

export function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return canonicalDigest(body);
}

function finish(value, digestField) {
  value[digestField] = null;
  value[digestField] = digestWithout(value, digestField);
  return value;
}

function assertPortable(value, label) {
  try {
    assertPersistedRecordSafe(value);
  } catch (error) {
    throw new Error(`${label} is not privacy-safe: ${error.message}`);
  }
  return value;
}

function validateSafetyFloor(value, label = "safety floor") {
  exactKeys(value, Object.keys(DEFAULT_SAFETY_FLOOR), label);
  for (const [field, expected] of Object.entries(DEFAULT_SAFETY_FLOOR)) assert(value[field] === expected, `${label}.${field} weakens the safety floor`);
  return value;
}

function validateProtectedActions(value, label = "protected actions") {
  exactKeys(value, Object.keys(PROTECTED_ACTIONS), label);
  for (const [field, expected] of Object.entries(PROTECTED_ACTIONS)) assert(value[field] === expected, `${label}.${field} must remain ${expected}`);
  return value;
}

export function compileSourceIdentity({commit, tree, checkpointSha256, clean = true, pushed = false}) {
  const source = {
    commit,
    tree,
    checkpoint_sha256: checkpointSha256,
    clean,
    pushed,
  };
  return validateSourceIdentity(source);
}

export function validateSourceIdentity(source, label = "source identity") {
  exactKeys(source, ["commit", "tree", "checkpoint_sha256", "clean", "pushed"], label);
  requireGitObject(source.commit, `${label}.commit`);
  requireGitObject(source.tree, `${label}.tree`);
  requireSha(source.checkpoint_sha256, `${label}.checkpoint_sha256`);
  requireBoolean(source.clean, `${label}.clean`);
  requireBoolean(source.pushed, `${label}.pushed`);
  assert(source.clean === true, `${label} must be clean before repair or resume`);
  assert(source.pushed === false, `${label} may not claim a push`);
  return source;
}

export function compileRepairScope({scopeRef, affectedPathsSha256, excludedScopeSha256, boundarySha256}) {
  const scope = {
    scope_ref: scopeRef,
    affected_paths_sha256: affectedPathsSha256,
    excluded_scope_sha256: excludedScopeSha256,
    boundary_sha256: boundarySha256,
    source_root: "CONTROL_GOVERNANCE",
    product_writes_allowed: false,
    external_actions_allowed: false,
  };
  return validateRepairScope(scope);
}

export function validateRepairScope(scope, label = "repair scope") {
  exactKeys(scope, ["scope_ref", "affected_paths_sha256", "excluded_scope_sha256", "boundary_sha256", "source_root", "product_writes_allowed", "external_actions_allowed"], label);
  requireIdentifier(scope.scope_ref, `${label}.scope_ref`);
  requireSha(scope.affected_paths_sha256, `${label}.affected_paths_sha256`);
  requireSha(scope.excluded_scope_sha256, `${label}.excluded_scope_sha256`);
  requireSha(scope.boundary_sha256, `${label}.boundary_sha256`);
  assert(scope.source_root === "CONTROL_GOVERNANCE", `${label}.source_root must remain CONTROL_GOVERNANCE`);
  assert(scope.product_writes_allowed === false && scope.external_actions_allowed === false, `${label} crosses a protected boundary`);
  return scope;
}

export function compileEvidenceRefs(entries) {
  assert(Array.isArray(entries) && entries.length > 0, "evidence references must not be empty");
  const refs = entries.map((entry, index) => {
    exactKeys(entry, ["evidence_ref", "evidence_sha256", "kind"], `evidence reference ${index}`);
    requireOpaqueReference(entry.evidence_ref, `evidence reference ${index}.evidence_ref`);
    requireSha(entry.evidence_sha256, `evidence reference ${index}.evidence_sha256`);
    requireIdentifier(entry.kind, `evidence reference ${index}.kind`);
    return {...entry};
  }).sort((left, right) => left.evidence_ref.localeCompare(right.evidence_ref));
  assert(new Set(refs.map((entry) => entry.evidence_ref)).size === refs.length, "evidence references are duplicated");
  return refs;
}

function validateEvidenceRefs(refs, label = "evidence references") {
  const validated = compileEvidenceRefs(refs);
  assert(JSON.stringify(refs) === JSON.stringify(validated), `${label} must be sorted by opaque reference`);
  return refs;
}

export function compileDigestBoundCheckpoint({checkpointId, commit, tree, evidenceSha256, candidateSha256}) {
  const checkpoint = {
    schema: CHECKPOINT_SCHEMA,
    version: 1,
    status: "VERIFIED",
    checkpoint_id: checkpointId,
    source_commit: commit,
    source_tree: tree,
    evidence_sha256: evidenceSha256,
    candidate_sha256: candidateSha256,
    clean: true,
    pushed: false,
    checkpoint_sha256: null,
  };
  checkpoint.checkpoint_sha256 = digestWithout(checkpoint, "checkpoint_sha256");
  return validateDigestBoundCheckpoint(checkpoint);
}

export function validateDigestBoundCheckpoint(checkpoint, label = "digest-bound checkpoint") {
  exactKeys(checkpoint, ["schema", "version", "status", "checkpoint_id", "source_commit", "source_tree", "evidence_sha256", "candidate_sha256", "clean", "pushed", "checkpoint_sha256"], label);
  assert(checkpoint.schema === CHECKPOINT_SCHEMA && checkpoint.version === 1 && checkpoint.status === "VERIFIED", `${label} identity is invalid`);
  requireIdentifier(checkpoint.checkpoint_id, `${label}.checkpoint_id`);
  requireGitObject(checkpoint.source_commit, `${label}.source_commit`);
  requireGitObject(checkpoint.source_tree, `${label}.source_tree`);
  requireSha(checkpoint.evidence_sha256, `${label}.evidence_sha256`);
  requireSha(checkpoint.candidate_sha256, `${label}.candidate_sha256`);
  assert(checkpoint.clean === true && checkpoint.pushed === false, `${label} is not a clean unpublished checkpoint`);
  requireDigestField(checkpoint, "checkpoint_sha256", label);
  assert(checkpoint.checkpoint_sha256 === digestWithout(checkpoint, "checkpoint_sha256"), `${label} digest mismatch`);
  return assertPortable(checkpoint, label);
}

export function assertResumeCheckpoint(expected, observed, label = "resume checkpoint") {
  validateDigestBoundCheckpoint(expected, `${label} expected`);
  validateDigestBoundCheckpoint(observed, `${label} observed`);
  assert(observed.checkpoint_sha256 === expected.checkpoint_sha256, `${label} digest differs`);
  assert(observed.source_commit === expected.source_commit && observed.source_tree === expected.source_tree, `${label} source differs`);
  assert(observed.candidate_sha256 === expected.candidate_sha256, `${label} candidate differs`);
  return observed;
}

function validateFailureClassification(value) {
  exactKeys(value, ["schema", "version", "finding_id", "classification", "action", "continuation_allowed", "owner_review_required", "preserve_predecessor_evidence", "shared_file_conflict", "reason", "observed_at_utc", "classification_sha256"], "failure classification");
  assert(value.schema === FAILURE_CLASSIFICATION_SCHEMA && value.version === 1, "failure classification identity is invalid");
  requireIdentifier(value.finding_id, "failure classification finding_id");
  assert(FAILURE_CLASSES.includes(value.classification), "failure classification class is invalid");
  assert(FAILURE_ACTIONS.includes(value.action), "failure classification action is invalid");
  requireBoolean(value.continuation_allowed, "failure classification continuation_allowed");
  requireBoolean(value.owner_review_required, "failure classification owner_review_required");
  requireBoolean(value.preserve_predecessor_evidence, "failure classification preserve_predecessor_evidence");
  requireBoolean(value.shared_file_conflict, "failure classification shared_file_conflict");
  requireString(value.reason, "failure classification reason");
  requireUtc(value.observed_at_utc, "failure classification observed_at_utc");
  requireDigestField(value, "classification_sha256", "failure classification");
  assert(value.classification_sha256 === digestWithout(value, "classification_sha256"), "failure classification digest mismatch");
  const expected = {
    HARD_BOUNDARY: {action: "STOP_HARD_BOUNDARY", continuation: false, ownerReview: true, preserve: true},
    SOURCE_DRIFT: {action: "REASSESS_GOAL", continuation: false, ownerReview: true, preserve: true},
    TRUE_BLOCKER: {action: "REVIEW_TRUE_BLOCKER", continuation: false, ownerReview: true, preserve: true},
    SOFT_BOUNDARY: {action: "REVIEW_SOFT_BOUNDARY", continuation: false, ownerReview: true, preserve: true},
    REPAIRABLE_PUZZLE: {action: "PROPOSE_REPAIR", continuation: true, ownerReview: false, preserve: true},
    NONE: {action: "CONTINUE", continuation: true, ownerReview: false, preserve: false},
  }[value.classification];
  assert(value.action === expected.action, "classification action is inconsistent with class");
  assert(value.continuation_allowed === expected.continuation, "classification continuation flag is inconsistent");
  assert(value.owner_review_required === expected.ownerReview, "classification owner-review flag is inconsistent");
  assert(value.preserve_predecessor_evidence === expected.preserve, "classification evidence-preservation flag is inconsistent");
  assert(!value.shared_file_conflict || value.classification === "HARD_BOUNDARY", "classification shared-file conflict flag is invalid");
  return assertPortable(value, "failure classification");
}

export function classifyFailure({findingId, hardBoundary = false, ownerDecisionRequired = false, protectedActionAttempted = false, sharedFileConflict = false, sourceChanged = false, scopeChanged = false, intentChanged = false, missingIdentity = false, missingEvidence = false, softBoundary = false, stalled = false, repairableFailure = false, observedAtUtc = new Date().toISOString()} = {}) {
  requireIdentifier(findingId, "failure finding_id");
  requireUtc(observedAtUtc, "failure observedAtUtc");
  let classification = "NONE";
  let action = "CONTINUE";
  let reason = "No repair, boundary, identity, evidence, or drift finding was observed.";
  if (hardBoundary || ownerDecisionRequired || protectedActionAttempted || sharedFileConflict) {
    classification = "HARD_BOUNDARY";
    action = "STOP_HARD_BOUNDARY";
    reason = sharedFileConflict
      ? "A shared-file conflict requires an immediate stop; the repair lane may not rewrite a contested file."
      : "A protected action, hard boundary, or owner-only decision prevents continuation.";
  } else if (sourceChanged || scopeChanged || intentChanged) {
    classification = "SOURCE_DRIFT";
    action = "REASSESS_GOAL";
    reason = "The admitted source, scope, or intent changed; the current goal must close before replacement.";
  } else if (missingIdentity || missingEvidence) {
    classification = "TRUE_BLOCKER";
    action = "REVIEW_TRUE_BLOCKER";
    reason = "Required identity or evidence is unavailable; it cannot be converted into success.";
  } else if (softBoundary) {
    classification = "SOFT_BOUNDARY";
    action = "REVIEW_SOFT_BOUNDARY";
    reason = "A changed operating choice requires review before dependent work continues.";
  } else if (stalled || repairableFailure) {
    classification = "REPAIRABLE_PUZZLE";
    action = "PROPOSE_REPAIR";
    reason = "A bounded in-scope repair may be proposed without changing authority or protected scope.";
  }
  const classificationRecord = {
    schema: FAILURE_CLASSIFICATION_SCHEMA,
    version: 1,
    finding_id: findingId,
    classification,
    action,
    continuation_allowed: classification === "REPAIRABLE_PUZZLE" || classification === "NONE",
    owner_review_required: classification !== "NONE" && classification !== "REPAIRABLE_PUZZLE",
    preserve_predecessor_evidence: classification !== "NONE",
    shared_file_conflict: sharedFileConflict,
    reason,
    observed_at_utc: observedAtUtc,
    classification_sha256: null,
  };
  return validateFailureClassification(finish(classificationRecord, "classification_sha256"));
}

function validateRootCause(value) {
  exactKeys(value, ["category", "summary", "factors_sha256"], "root cause");
  requireIdentifier(value.category, "root cause category");
  requireString(value.summary, "root cause summary");
  requireSha(value.factors_sha256, "root cause factors_sha256");
  return value;
}

function validateFailure(value) {
  exactKeys(value, ["operation", "summary", "output_sha256"], "failure");
  requireIdentifier(value.operation, "failure operation");
  requireString(value.summary, "failure summary");
  requireSha(value.output_sha256, "failure output_sha256");
  return value;
}

function validateRepairRoute(value) {
  exactKeys(value, ["route_kind", "owner_role", "max_attempts", "retry_policy", "owner_review_required"], "repair route");
  requireIdentifier(value.route_kind, "repair route kind");
  requireIdentifier(value.owner_role, "repair route owner_role");
  assert(Number.isSafeInteger(value.max_attempts) && value.max_attempts >= 0 && value.max_attempts <= 2, "repair route max_attempts is outside the bounded range");
  assert(["NEVER_RETRY", "ONE_BOUNDED_ATTEMPT", "OWNER_REVIEW_AFTER_ATTEMPT"].includes(value.retry_policy), "repair route retry policy is invalid");
  requireBoolean(value.owner_review_required, "repair route owner_review_required");
  if (value.max_attempts === 0) assert(value.retry_policy === "NEVER_RETRY", "zero-attempt repair route must never retry");
  return value;
}

function validatePredecessorEvidence(value) {
  exactKeys(value, ["record_sha256", "evidence_sha256", "preserved", "preserved_at_utc"], "predecessor evidence");
  requireSha(value.record_sha256, "predecessor evidence record_sha256");
  requireSha(value.evidence_sha256, "predecessor evidence evidence_sha256");
  assert(value.preserved === true, "predecessor evidence must be preserved");
  requireUtc(value.preserved_at_utc, "predecessor evidence preserved_at_utc");
  return value;
}

export function compileRootCauseAnalysis({findingId, classification, phase, failure, sourceBefore, scope, evidenceRefs, predecessorEvidence, rootCause, repairRoute, acceptanceConsequence, protectedActions = PROTECTED_ACTIONS, recordedAtUtc = new Date().toISOString(), parentRcaSha256 = null} = {}) {
  const classificationRecord = typeof classification === "string"
    ? classifyFailure({findingId, repairableFailure: classification === "REPAIRABLE_PUZZLE", hardBoundary: classification === "HARD_BOUNDARY", sourceChanged: classification === "SOURCE_DRIFT", missingEvidence: classification === "TRUE_BLOCKER", softBoundary: classification === "SOFT_BOUNDARY", observedAtUtc: recordedAtUtc})
    : validateFailureClassification(classification);
  assert(classificationRecord.finding_id === findingId, "RCA classification finding differs");
  assert(classificationRecord.classification !== "NONE", "an RCA cannot be compiled for NONE");
  requireIdentifier(phase, "RCA phase");
  validateFailure(failure);
  validateSourceIdentity(sourceBefore, "RCA source_before");
  validateRepairScope(scope, "RCA scope");
  validateEvidenceRefs(evidenceRefs);
  validatePredecessorEvidence(predecessorEvidence);
  validateRootCause(rootCause);
  validateRepairRoute(repairRoute);
  requireString(acceptanceConsequence, "RCA acceptance consequence");
  validateProtectedActions(protectedActions, "RCA protected actions");
  requireUtc(recordedAtUtc, "RCA recordedAtUtc");
  if (parentRcaSha256 !== null) requireSha(parentRcaSha256, "RCA parent_rca_sha256");
  if (classificationRecord.classification === "HARD_BOUNDARY") assert(repairRoute.max_attempts === 0 && repairRoute.owner_review_required === true, "hard-boundary RCA has an unsafe repair route");
  if (classificationRecord.classification === "SOFT_BOUNDARY") assert(repairRoute.owner_review_required === true, "soft-boundary RCA lacks review");
  const rca = {
    schema: ROOT_CAUSE_ANALYSIS_SCHEMA,
    version: 1,
    status: "OPEN",
    finding_id: findingId,
    classification: classificationRecord.classification,
    classification_sha256: classificationRecord.classification_sha256,
    phase,
    failure: structuredClone(failure),
    source_before: structuredClone(sourceBefore),
    scope: structuredClone(scope),
    evidence_refs: structuredClone(evidenceRefs),
    predecessor_evidence: structuredClone(predecessorEvidence),
    root_cause: structuredClone(rootCause),
    repair_route: structuredClone(repairRoute),
    acceptance_consequence: acceptanceConsequence,
    protected_actions: structuredClone(protectedActions),
    parent_rca_sha256: parentRcaSha256,
    status_reason: "Finding preserved before any repair route.",
    recorded_at_utc: recordedAtUtc,
    rca_sha256: null,
  };
  finish(rca, "rca_sha256");
  return validateRootCauseAnalysis(rca);
}

export function validateRootCauseAnalysis(value) {
  exactKeys(value, ["schema", "version", "status", "finding_id", "classification", "classification_sha256", "phase", "failure", "source_before", "scope", "evidence_refs", "predecessor_evidence", "root_cause", "repair_route", "acceptance_consequence", "protected_actions", "parent_rca_sha256", "status_reason", "recorded_at_utc", "rca_sha256"], "root cause analysis");
  assert(value.schema === ROOT_CAUSE_ANALYSIS_SCHEMA && value.version === 1, "RCA identity is invalid");
  assert(RCA_STATUSES.includes(value.status), "RCA status is invalid");
  requireIdentifier(value.finding_id, "RCA finding_id");
  assert(FAILURE_CLASSES.includes(value.classification) && value.classification !== "NONE", "RCA classification is invalid");
  requireSha(value.classification_sha256, "RCA classification_sha256");
  validateFailure(value.failure);
  validateSourceIdentity(value.source_before, "RCA source_before");
  validateRepairScope(value.scope, "RCA scope");
  validateEvidenceRefs(value.evidence_refs);
  validatePredecessorEvidence(value.predecessor_evidence);
  validateRootCause(value.root_cause);
  validateRepairRoute(value.repair_route);
  requireString(value.acceptance_consequence, "RCA acceptance consequence");
  validateProtectedActions(value.protected_actions, "RCA protected actions");
  if (value.parent_rca_sha256 !== null) requireSha(value.parent_rca_sha256, "RCA parent_rca_sha256");
  requireString(value.status_reason, "RCA status_reason");
  requireUtc(value.recorded_at_utc, "RCA recorded_at_utc");
  requireDigestField(value, "rca_sha256", "RCA");
  assert(value.rca_sha256 === digestWithout(value, "rca_sha256"), "RCA digest mismatch");
  return assertPortable(value, "root cause analysis");
}

const RCA_TRANSITIONS = Object.freeze({
  OPEN: ["ROUTED", "BLOCKED"],
  ROUTED: ["REPAIRING", "BLOCKED"],
  REPAIRING: ["REPAIRED", "BLOCKED"],
  REPAIRED: ["CLOSED"],
  BLOCKED: ["ROUTED", "CLOSED"],
  CLOSED: [],
});

export function transitionRootCauseAnalysis(rca, {status, reason, recordedAtUtc = new Date().toISOString()} = {}) {
  validateRootCauseAnalysis(rca);
  assert(RCA_STATUSES.includes(status), "RCA transition status is invalid");
  assert(RCA_TRANSITIONS[rca.status].includes(status), `RCA cannot transition from ${rca.status} to ${status}`);
  requireString(reason, "RCA transition reason");
  requireUtc(recordedAtUtc, "RCA transition recordedAtUtc");
  const next = {
    ...structuredClone(rca),
    status,
    parent_rca_sha256: rca.rca_sha256,
    status_reason: reason,
    recorded_at_utc: recordedAtUtc,
    rca_sha256: null,
  };
  return validateRootCauseAnalysis(finish(next, "rca_sha256"));
}

function validateOwnerApproval(value, expectedDecision = null) {
  exactKeys(value, ["schema", "version", "status", "decision_id", "decision", "actor_ref", "parent_digest", "decided_at_utc", "approval_sha256"], "owner repair approval");
  assert(value.schema === OWNER_REPAIR_APPROVAL_SCHEMA && value.version === 1 && value.status === "APPROVED", "owner approval identity is invalid");
  requireIdentifier(value.decision_id, "owner approval decision_id");
  assert(["APPROVE_REPAIR", "APPROVE_ROLLBACK"].includes(value.decision), "owner approval decision is invalid");
  if (expectedDecision !== null) assert(value.decision === expectedDecision, `owner approval must be ${expectedDecision}`);
  requireOpaqueReference(value.actor_ref, "owner approval actor_ref");
  requireSha(value.parent_digest, "owner approval parent_digest");
  requireUtc(value.decided_at_utc, "owner approval decided_at_utc");
  requireDigestField(value, "approval_sha256", "owner approval");
  assert(value.approval_sha256 === digestWithout(value, "approval_sha256"), "owner approval digest mismatch");
  return assertPortable(value, "owner repair approval");
}

export function compileOwnerRepairApproval({decisionId, decision, actorRef, parentDigest, decidedAtUtc = new Date().toISOString()} = {}) {
  const approval = {
    schema: OWNER_REPAIR_APPROVAL_SCHEMA,
    version: 1,
    status: "APPROVED",
    decision_id: decisionId,
    decision,
    actor_ref: actorRef,
    parent_digest: parentDigest,
    decided_at_utc: decidedAtUtc,
    approval_sha256: null,
  };
  return validateOwnerApproval(finish(approval, "approval_sha256"));
}

function validateLimits(value, label = "repair limits") {
  exactKeys(value, ["max_attempts", "max_duration_minutes", "max_respawns", "cost_limit_ref"], label);
  assert(Number.isSafeInteger(value.max_attempts) && value.max_attempts >= 1 && value.max_attempts <= 2, `${label}.max_attempts is outside the bounded range`);
  assert(Number.isSafeInteger(value.max_duration_minutes) && value.max_duration_minutes >= 1 && value.max_duration_minutes <= 240, `${label}.max_duration_minutes is outside the bounded range`);
  assert(Number.isSafeInteger(value.max_respawns) && value.max_respawns >= 0 && value.max_respawns <= 1, `${label}.max_respawns is outside the bounded range`);
  if (value.cost_limit_ref !== null) requireIdentifier(value.cost_limit_ref, `${label}.cost_limit_ref`);
  return value;
}

function validateSmallestSafeChange(value) {
  exactKeys(value, ["kind", "summary", "change_sha256", "authority_change", "safety_floor_change", "external_actions"], "smallest safe change");
  requireIdentifier(value.kind, "smallest safe change kind");
  requireString(value.summary, "smallest safe change summary");
  requireSha(value.change_sha256, "smallest safe change change_sha256");
  assert(value.authority_change === false && value.safety_floor_change === false && value.external_actions === false, "smallest safe change crosses a protected boundary");
  return value;
}

function validateVerificationPlan(value) {
  exactKeys(value, ["focused_checks_sha256", "independent_audit_required", "expected_checkpoint_sha256", "expected_safety_floor_sha256"], "verification plan");
  requireSha(value.focused_checks_sha256, "verification plan focused_checks_sha256");
  assert(value.independent_audit_required === true, "repair verification must require an independent Auditor");
  requireSha(value.expected_checkpoint_sha256, "verification plan expected_checkpoint_sha256");
  requireSha(value.expected_safety_floor_sha256, "verification plan expected_safety_floor_sha256");
  return value;
}

function predecessorEvidenceSha256FromRca(rca) {
  return rca.predecessor_evidence.evidence_sha256;
}

export function compileRepairProposal({proposalId, rca, resumeCheckpoint, scope, smallestSafeChange, verificationPlan, limits, createdAtUtc = new Date().toISOString()} = {}) {
  validateRootCauseAnalysis(rca);
  assert(rca.classification === "REPAIRABLE_PUZZLE", "only a repairable puzzle may receive a repair proposal");
  validateDigestBoundCheckpoint(resumeCheckpoint, "repair proposal resume checkpoint");
  validateRepairScope(scope, "repair proposal scope");
  validateSmallestSafeChange(smallestSafeChange);
  validateVerificationPlan(verificationPlan);
  validateLimits(limits);
  validateSafetyFloor(DEFAULT_SAFETY_FLOOR);
  validateProtectedActions(PROTECTED_ACTIONS);
  requireIdentifier(proposalId, "repair proposal proposal_id");
  requireUtc(createdAtUtc, "repair proposal createdAtUtc");
  assert(verificationPlan.expected_checkpoint_sha256 === resumeCheckpoint.checkpoint_sha256, "verification plan checkpoint differs from resume checkpoint");
  assert(verificationPlan.expected_safety_floor_sha256 === canonicalDigest(DEFAULT_SAFETY_FLOOR), "verification plan safety floor differs");
  const proposal = {
    schema: REPAIR_PROPOSAL_SCHEMA,
    version: 1,
    status: "PROPOSED",
    proposal_id: proposalId,
    parent_rca_sha256: rca.rca_sha256,
    source_before: structuredClone(rca.source_before),
    resume_checkpoint: structuredClone(resumeCheckpoint),
    scope: structuredClone(scope),
    smallest_safe_change: structuredClone(smallestSafeChange),
    verification_plan: structuredClone(verificationPlan),
    limits: structuredClone(limits),
    safety_floor: structuredClone(DEFAULT_SAFETY_FLOOR),
    protected_actions: structuredClone(PROTECTED_ACTIONS),
    predecessor_evidence_sha256: predecessorEvidenceSha256FromRca(rca),
    owner_approval: null,
    owner_approval_parent_sha256: null,
    created_at_utc: createdAtUtc,
    admitted_at_utc: null,
    status_reason: "Awaiting explicit owner repair approval.",
    proposal_sha256: null,
  };
  return validateRepairProposal(finish(proposal, "proposal_sha256"));
}

export function validateRepairProposal(value) {
  exactKeys(value, ["schema", "version", "status", "proposal_id", "parent_rca_sha256", "source_before", "resume_checkpoint", "scope", "smallest_safe_change", "verification_plan", "limits", "safety_floor", "protected_actions", "predecessor_evidence_sha256", "owner_approval", "owner_approval_parent_sha256", "created_at_utc", "admitted_at_utc", "status_reason", "proposal_sha256"], "repair proposal");
  assert(value.schema === REPAIR_PROPOSAL_SCHEMA && value.version === 1, "repair proposal identity is invalid");
  assert(REPAIR_PROPOSAL_STATUSES.includes(value.status), "repair proposal status is invalid");
  requireIdentifier(value.proposal_id, "repair proposal proposal_id");
  requireSha(value.parent_rca_sha256, "repair proposal parent_rca_sha256");
  validateSourceIdentity(value.source_before, "repair proposal source_before");
  validateDigestBoundCheckpoint(value.resume_checkpoint, "repair proposal resume_checkpoint");
  validateRepairScope(value.scope, "repair proposal scope");
  validateSmallestSafeChange(value.smallest_safe_change);
  validateVerificationPlan(value.verification_plan);
  validateLimits(value.limits);
  validateSafetyFloor(value.safety_floor);
  validateProtectedActions(value.protected_actions);
  requireSha(value.predecessor_evidence_sha256, "repair proposal predecessor_evidence_sha256");
  if (value.owner_approval !== null) validateOwnerApproval(value.owner_approval, "APPROVE_REPAIR");
  if (value.owner_approval_parent_sha256 !== null) requireSha(value.owner_approval_parent_sha256, "repair proposal owner_approval_parent_sha256");
  if (value.status === "PROPOSED") assert(value.owner_approval === null && value.admitted_at_utc === null, "proposed repair is already admitted");
  if (value.status === "ADMITTED") assert(value.owner_approval !== null && value.admitted_at_utc !== null, "admitted repair lacks owner approval");
  if (value.status === "REJECTED") assert(value.owner_approval === null && value.admitted_at_utc === null, "rejected repair carries owner admission");
  if (value.owner_approval !== null) assert(value.owner_approval.parent_digest === value.owner_approval_parent_sha256, "repair approval parent differs from proposal");
  else assert(value.owner_approval_parent_sha256 === null, "repair proposal carries an orphan approval parent");
  if (value.admitted_at_utc !== null) requireUtc(value.admitted_at_utc, "repair proposal admitted_at_utc");
  requireUtc(value.created_at_utc, "repair proposal created_at_utc");
  requireString(value.status_reason, "repair proposal status_reason");
  requireDigestField(value, "proposal_sha256", "repair proposal");
  assert(value.proposal_sha256 === digestWithout(value, "proposal_sha256"), "repair proposal digest mismatch");
  return assertPortable(value, "repair proposal");
}

export function admitRepairProposal(proposal, approval, admittedAtUtc = new Date().toISOString()) {
  validateRepairProposal(proposal);
  assert(proposal.status === "PROPOSED", "repair proposal is not awaiting admission");
  validateOwnerApproval(approval, "APPROVE_REPAIR");
  assert(approval.parent_digest === proposal.proposal_sha256, "repair approval is not bound to this proposal");
  requireUtc(admittedAtUtc, "repair proposal admittedAtUtc");
  const admitted = {...structuredClone(proposal), status: "ADMITTED", owner_approval: structuredClone(approval), owner_approval_parent_sha256: proposal.proposal_sha256, admitted_at_utc: admittedAtUtc, status_reason: "Owner-approved bounded repair is admitted.", proposal_sha256: null};
  return validateRepairProposal(finish(admitted, "proposal_sha256"));
}

export function rejectRepairProposal(proposal, reason, rejectedAtUtc = new Date().toISOString()) {
  validateRepairProposal(proposal);
  assert(proposal.status === "PROPOSED", "only a proposed repair may be rejected");
  requireString(reason, "repair proposal rejection reason");
  requireUtc(rejectedAtUtc, "repair proposal rejectedAtUtc");
  const rejected = {...structuredClone(proposal), status: "REJECTED", status_reason: reason, proposal_sha256: null};
  return validateRepairProposal(finish(rejected, "proposal_sha256"));
}

function validatePatchVerification(value, ownerActorRef = null) {
  if (value === null) return null;
  exactKeys(value, ["focused_checks_passed", "focused_checks_sha256", "independent_audit_passed", "auditor_ref", "evidence_sha256", "safety_floor_unchanged", "verified_at_utc"], "patch verification");
  assert(value.focused_checks_passed === true && value.independent_audit_passed === true && value.safety_floor_unchanged === true, "patch verification did not pass all safety checks");
  requireSha(value.focused_checks_sha256, "patch verification focused_checks_sha256");
  requireOpaqueReference(value.auditor_ref, "patch verification auditor_ref");
  if (ownerActorRef !== null) assert(value.auditor_ref !== ownerActorRef, "repair owner cannot be the independent Auditor");
  requireSha(value.evidence_sha256, "patch verification evidence_sha256");
  requireUtc(value.verified_at_utc, "patch verification verified_at_utc");
  return value;
}

export function compileGovernancePatchVersion({governanceVersion, testBuild, proposal, candidateCheckpoint, changedScopeSha256, normativeDigest, recordedAtUtc = new Date().toISOString()} = {}) {
  validateRepairProposal(proposal);
  assert(proposal.status === "ADMITTED", "governance patch version requires an admitted repair proposal");
  assert(GOVERNANCE_VERSION.test(governanceVersion), "governance version is invalid");
  assert(TEST_BUILD.test(testBuild), "governance test build is invalid");
  validateDigestBoundCheckpoint(candidateCheckpoint, "patch candidate checkpoint");
  requireSha(changedScopeSha256, "patch changedScopeSha256");
  requireSha(normativeDigest, "patch normativeDigest");
  requireUtc(recordedAtUtc, "patch recordedAtUtc");
  assert(candidateCheckpoint.checkpoint_sha256 === proposal.verification_plan.expected_checkpoint_sha256, "patch candidate is not the proposal checkpoint");
  assert(changedScopeSha256 === canonicalDigest(proposal.scope), "patch changed scope is not bound to the proposal scope");
  const patch = {
    schema: GOVERNANCE_PATCH_VERSION_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    governance_version: governanceVersion,
    test_build: testBuild,
    parent_proposal_sha256: proposal.proposal_sha256,
    parent_rca_sha256: proposal.parent_rca_sha256,
    source_before: structuredClone(proposal.source_before),
    candidate_checkpoint: structuredClone(candidateCheckpoint),
    changed_scope_sha256: changedScopeSha256,
    normative_digest: normativeDigest,
    safety_floor_sha256: canonicalDigest(DEFAULT_SAFETY_FLOOR),
    owner_approval_sha256: proposal.owner_approval.approval_sha256,
    owner_actor_ref: proposal.owner_approval.actor_ref,
    verification: null,
    activation: false,
    recorded_at_utc: recordedAtUtc,
    patch_version_sha256: null,
  };
  return validateGovernancePatchVersion(finish(patch, "patch_version_sha256"));
}

export function validateGovernancePatchVersion(value) {
  exactKeys(value, ["schema", "version", "status", "governance_version", "test_build", "parent_proposal_sha256", "parent_rca_sha256", "source_before", "candidate_checkpoint", "changed_scope_sha256", "normative_digest", "safety_floor_sha256", "owner_approval_sha256", "owner_actor_ref", "verification", "activation", "recorded_at_utc", "patch_version_sha256"], "governance patch version");
  assert(value.schema === GOVERNANCE_PATCH_VERSION_SCHEMA && value.version === 1, "governance patch version identity is invalid");
  assert(PATCH_VERSION_STATUSES.includes(value.status), "governance patch version status is invalid");
  assert(GOVERNANCE_VERSION.test(value.governance_version), "governance patch version is invalid");
  assert(TEST_BUILD.test(value.test_build), "governance patch test build is invalid");
  requireSha(value.parent_proposal_sha256, "governance patch parent_proposal_sha256");
  requireSha(value.parent_rca_sha256, "governance patch parent_rca_sha256");
  validateSourceIdentity(value.source_before, "governance patch source_before");
  validateDigestBoundCheckpoint(value.candidate_checkpoint, "governance patch candidate_checkpoint");
  requireSha(value.changed_scope_sha256, "governance patch changed_scope_sha256");
  requireSha(value.normative_digest, "governance patch normative_digest");
  requireSha(value.safety_floor_sha256, "governance patch safety_floor_sha256");
  assert(value.safety_floor_sha256 === canonicalDigest(DEFAULT_SAFETY_FLOOR), "governance patch weakens the safety floor");
  requireSha(value.owner_approval_sha256, "governance patch owner_approval_sha256");
  requireOpaqueReference(value.owner_actor_ref, "governance patch owner_actor_ref");
  validatePatchVerification(value.verification);
  if (value.status === "PREPARED_NOT_ACTIVATED") assert(value.verification === null, "unverified governance patch carries verification");
  if (value.status === "VERIFIED_NOT_ACTIVATED") assert(value.verification !== null, "verified governance patch lacks verification");
  if (value.verification !== null) assert(value.verification.auditor_ref !== value.owner_actor_ref, "governance patch Auditor is not independent");
  assert(value.activation === false, "governance patch version may not activate");
  requireUtc(value.recorded_at_utc, "governance patch recorded_at_utc");
  requireDigestField(value, "patch_version_sha256", "governance patch");
  assert(value.patch_version_sha256 === digestWithout(value, "patch_version_sha256"), "governance patch digest mismatch");
  return assertPortable(value, "governance patch version");
}

export function verifyGovernancePatchVersion(patch, {focusedChecksSha256, auditorRef, evidenceSha256, verifiedAtUtc = new Date().toISOString()} = {}) {
  validateGovernancePatchVersion(patch);
  assert(patch.status === "PREPARED_NOT_ACTIVATED", "governance patch version is already verified");
  requireSha(focusedChecksSha256, "focusedChecksSha256");
  requireOpaqueReference(auditorRef, "auditorRef");
  requireSha(evidenceSha256, "evidenceSha256");
  requireUtc(verifiedAtUtc, "verifiedAtUtc");
  assert(auditorRef !== patch.owner_actor_ref, "independent Auditor reference conflicts with owner approval actor");
  const verified = {
    ...structuredClone(patch),
    status: "VERIFIED_NOT_ACTIVATED",
    verification: {
      focused_checks_passed: true,
      focused_checks_sha256: focusedChecksSha256,
      independent_audit_passed: true,
      auditor_ref: auditorRef,
      evidence_sha256: evidenceSha256,
      safety_floor_unchanged: true,
      verified_at_utc: verifiedAtUtc,
    },
    patch_version_sha256: null,
  };
  return validateGovernancePatchVersion(finish(verified, "patch_version_sha256"));
}

export function compileRepairReceipt({proposal, patchVersion, observedAtUtc = new Date().toISOString()} = {}) {
  validateRepairProposal(proposal);
  assert(proposal.status === "ADMITTED", "repair receipt requires an admitted proposal");
  validateGovernancePatchVersion(patchVersion);
  assert(patchVersion.status === "VERIFIED_NOT_ACTIVATED", "repair receipt requires a verified, inactive patch version");
  requireUtc(observedAtUtc, "repair receipt observedAtUtc");
  assert(patchVersion.parent_proposal_sha256 === proposal.proposal_sha256, "repair receipt patch is not bound to the admitted proposal");
  assert(patchVersion.candidate_checkpoint.checkpoint_sha256 === proposal.verification_plan.expected_checkpoint_sha256, "repair receipt checkpoint differs from proposal verification");
  const verification = patchVersion.verification;
  validatePatchVerification(verification, proposal.owner_approval?.actor_ref ?? null);
  const receipt = {
    schema: REPAIR_RECEIPT_SCHEMA,
    version: 1,
    status: "VERIFIED_NOT_ACTIVATED",
    parent_rca_sha256: proposal.parent_rca_sha256,
    proposal_sha256: proposal.proposal_sha256,
    patch_version_sha256: patchVersion.patch_version_sha256,
    source_before: structuredClone(proposal.source_before),
    resume_checkpoint: structuredClone(patchVersion.candidate_checkpoint),
    scope: structuredClone(proposal.scope),
    predecessor_evidence_sha256: proposal.predecessor_evidence_sha256,
    owner_approval_sha256: proposal.owner_approval.approval_sha256,
    owner_actor_ref: proposal.owner_approval.actor_ref,
    verification: structuredClone(verification),
    limits: structuredClone(proposal.limits),
    safety_floor_sha256: canonicalDigest(DEFAULT_SAFETY_FLOOR),
    protected_actions: structuredClone(PROTECTED_ACTIONS),
    observed_at_utc: observedAtUtc,
    receipt_sha256: null,
  };
  return validateRepairReceipt(finish(receipt, "receipt_sha256"));
}

export function validateRepairReceipt(value) {
  exactKeys(value, ["schema", "version", "status", "parent_rca_sha256", "proposal_sha256", "patch_version_sha256", "source_before", "resume_checkpoint", "scope", "predecessor_evidence_sha256", "owner_approval_sha256", "owner_actor_ref", "verification", "limits", "safety_floor_sha256", "protected_actions", "observed_at_utc", "receipt_sha256"], "repair receipt");
  assert(value.schema === REPAIR_RECEIPT_SCHEMA && value.version === 1 && REPAIR_RECEIPT_STATUSES.includes(value.status), "repair receipt identity is invalid");
  requireSha(value.parent_rca_sha256, "repair receipt parent_rca_sha256");
  requireSha(value.proposal_sha256, "repair receipt proposal_sha256");
  requireSha(value.patch_version_sha256, "repair receipt patch_version_sha256");
  validateSourceIdentity(value.source_before, "repair receipt source_before");
  validateDigestBoundCheckpoint(value.resume_checkpoint, "repair receipt resume_checkpoint");
  validateRepairScope(value.scope, "repair receipt scope");
  requireSha(value.predecessor_evidence_sha256, "repair receipt predecessor_evidence_sha256");
  requireSha(value.owner_approval_sha256, "repair receipt owner_approval_sha256");
  requireOpaqueReference(value.owner_actor_ref, "repair receipt owner_actor_ref");
  assert(value.verification !== null, "repair receipt lacks verification");
  validatePatchVerification(value.verification, value.owner_actor_ref);
  validateLimits(value.limits);
  requireSha(value.safety_floor_sha256, "repair receipt safety_floor_sha256");
  assert(value.safety_floor_sha256 === canonicalDigest(DEFAULT_SAFETY_FLOOR), "repair receipt safety floor differs");
  validateProtectedActions(value.protected_actions);
  requireUtc(value.observed_at_utc, "repair receipt observed_at_utc");
  requireDigestField(value, "receipt_sha256", "repair receipt");
  assert(value.receipt_sha256 === digestWithout(value, "receipt_sha256"), "repair receipt digest mismatch");
  return assertPortable(value, "repair receipt");
}

export {validateFailureClassification, validateOwnerApproval, validateRepairProposal as validateProposal, validateLimits, validateProtectedActions, validateSafetyFloor};
