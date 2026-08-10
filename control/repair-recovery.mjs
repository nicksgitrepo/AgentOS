#!/usr/bin/env node

/*
 * Bounded recovery orchestration for the governance-repair lane.
 *
 * The adapter is intentionally injected. This module never creates host
 * sessions, starts processes, invokes Git, deploys, releases, or activates a
 * candidate. It only admits a strictly typed sequence and records a success
 * or a retained blocked outcome.
 */

import {
  PROTECTED_ACTIONS,
  digestWithout,
  validateDigestBoundCheckpoint,
  validateOwnerApproval,
  validateRepairReceipt,
  validateProtectedActions,
} from "./repair-governance.mjs";
import {assertPersistedRecordSafe, canonicalDigest} from "./content-addressing.mjs";

export const RESPAWN_PLAN_SCHEMA = "agentos.bounded_respawn_plan.v1";
export const RESPAWN_RECEIPT_SCHEMA = "agentos.bounded_respawn_receipt.v1";
export const ROLLBACK_PLAN_SCHEMA = "agentos.governance_rollback_plan.v1";
export const ROLLBACK_RECEIPT_SCHEMA = "agentos.governance_rollback_receipt.v1";

export const RESPAWN_STATUSES = Object.freeze([
  "ADMITTED",
  "RESPAWNED_AND_BOUND",
  "RESPAWN_BLOCKED",
]);

export const ROLLBACK_PLAN_STATUSES = Object.freeze([
  "PENDING_OWNER_REVIEW",
  "ADMITTED",
]);

export const ROLLBACK_RECEIPT_STATUSES = Object.freeze([
  "ROLLED_BACK_AND_VERIFIED",
  "ROLLBACK_FAILED_RETAINED",
  "ROLLBACK_STATE_UNCERTAIN",
]);

export const RESPAWN_LIFECYCLE = Object.freeze([
  "PRESERVE_PREDECESSOR_EVIDENCE",
  "CREATE_DISTINCT_REPLACEMENT",
  "SEND_PREDECESSOR_HANDOFF",
  "READ_MEANINGFUL_RESULT",
  "CLOSE_PREDECESSOR",
  "VERIFY_ACTIVE_ROSTER",
]);

export const ROLLBACK_LIFECYCLE = Object.freeze([
  "PRESERVE_CANDIDATE_EVIDENCE",
  "PREPARE_RESTORE",
  "RESTORE_CHECKPOINT",
  "READBACK_CHECKPOINT",
  "INDEPENDENT_ROLLBACK_AUDIT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._-]{0,95}$/u;
const OPAQUE_REFERENCE = /^[a-z][a-z0-9._-]{1,31}:[0-9a-f]{64}$/u;

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

function validateFailure(value, label = "recovery failure") {
  exactKeys(value, ["phase", "error_sha256", "retry_allowed"], label);
  requireIdentifier(value.phase, `${label}.phase`);
  requireSha(value.error_sha256, `${label}.error_sha256`);
  assert(value.retry_allowed === false, `${label}.retry_allowed must be false after a bounded failure`);
  return value;
}

function validatePredecessor(value, label = "predecessor") {
  exactKeys(value, ["worker_ref", "session_ref", "status", "source_commit", "source_tree", "evidence_sha256", "handoff_sha256"], label);
  requireOpaqueReference(value.worker_ref, `${label}.worker_ref`);
  requireOpaqueReference(value.session_ref, `${label}.session_ref`);
  assert(["FAILED", "STALLED", "SUPERSEDED"].includes(value.status), `${label}.status is not replaceable`);
  requireGitObject(value.source_commit, `${label}.source_commit`);
  requireGitObject(value.source_tree, `${label}.source_tree`);
  requireSha(value.evidence_sha256, `${label}.evidence_sha256`);
  requireSha(value.handoff_sha256, `${label}.handoff_sha256`);
  return value;
}

function validateLifecycle(value, expected, label) {
  assert(Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected), `${label} lifecycle is incomplete or reordered`);
  return value;
}

function validateLifecycleProgress(value, expected, label) {
  assert(Array.isArray(value) && value.length >= 1 && value.length <= expected.length, `${label} lifecycle progress is outside the bounded range`);
  assert(value.every((step, index) => step === expected[index]), `${label} lifecycle progress is not a prefix`);
  return value;
}

function validateReplacementCreation(value, checkpoint, label = "replacement creation") {
  exactKeys(value, ["created", "worker_ref", "session_ref", "source_commit", "source_tree", "checkpoint_sha256"], label);
  assert(value.created === true, `${label} did not confirm creation`);
  requireOpaqueReference(value.worker_ref, `${label}.worker_ref`);
  requireOpaqueReference(value.session_ref, `${label}.session_ref`);
  requireGitObject(value.source_commit, `${label}.source_commit`);
  requireGitObject(value.source_tree, `${label}.source_tree`);
  requireSha(value.checkpoint_sha256, `${label}.checkpoint_sha256`);
  assert(value.source_commit === checkpoint.source_commit && value.source_tree === checkpoint.source_tree && value.checkpoint_sha256 === checkpoint.checkpoint_sha256, `${label} did not bind to the resume checkpoint`);
  return value;
}

function validateHandoffSend(value, predecessor, label = "handoff send") {
  exactKeys(value, ["accepted", "predecessor_handoff_sha256"], label);
  assert(value.accepted === true, `${label} was not accepted`);
  requireSha(value.predecessor_handoff_sha256, `${label}.predecessor_handoff_sha256`);
  assert(value.predecessor_handoff_sha256 === predecessor.handoff_sha256, `${label} differs from predecessor handoff`);
  return value;
}

function validateMeaningfulResult(value, replacement, checkpoint, label = "meaningful result") {
  exactKeys(value, ["meaningful", "result_sha256", "evidence_sha256", "typed_handoff_sha256", "source_commit", "source_tree", "checkpoint_sha256"], label);
  assert(value.meaningful === true, `${label} is not meaningful progress`);
  requireSha(value.result_sha256, `${label}.result_sha256`);
  requireSha(value.evidence_sha256, `${label}.evidence_sha256`);
  requireSha(value.typed_handoff_sha256, `${label}.typed_handoff_sha256`);
  requireGitObject(value.source_commit, `${label}.source_commit`);
  requireGitObject(value.source_tree, `${label}.source_tree`);
  requireSha(value.checkpoint_sha256, `${label}.checkpoint_sha256`);
  assert(value.source_commit === replacement.source_commit && value.source_tree === replacement.source_tree && value.checkpoint_sha256 === checkpoint.checkpoint_sha256, `${label} source differs from the replacement checkpoint`);
  return value;
}

function validatePredecessorClose(value, predecessor, label = "predecessor close") {
  exactKeys(value, ["closed", "predecessor_handoff_sha256"], label);
  assert(value.closed === true, `${label} did not close the predecessor`);
  requireSha(value.predecessor_handoff_sha256, `${label}.predecessor_handoff_sha256`);
  assert(value.predecessor_handoff_sha256 === predecessor.handoff_sha256, `${label} differs from predecessor handoff`);
  return value;
}

function validateRoster(value, predecessor, replacement, label = "active roster") {
  exactKeys(value, ["predecessor_absent", "replacement_present", "roster_sha256"], label);
  assert(value.predecessor_absent === true && value.replacement_present === true, `${label} does not prove exact roster state`);
  requireSha(value.roster_sha256, `${label}.roster_sha256`);
  assert(predecessor.session_ref !== replacement.session_ref && predecessor.worker_ref !== replacement.worker_ref, `${label} reuses predecessor identity`);
  return value;
}

export function compileRespawnPlan({planId, repairReceipt, predecessor, createdAtUtc = new Date().toISOString(), maxAttempts = 1} = {}) {
  validateRepairReceipt(repairReceipt);
  validatePredecessor(predecessor);
  requireIdentifier(planId, "respawn plan_id");
  requireUtc(createdAtUtc, "respawn plan createdAtUtc");
  assert(repairReceipt.limits.max_respawns >= 1, "repair proposal does not permit a respawn");
  assert(Number.isSafeInteger(maxAttempts) && maxAttempts === 1, "respawn is one bounded replacement attempt");
  const plan = {
    schema: RESPAWN_PLAN_SCHEMA,
    version: 1,
    status: "ADMITTED",
    plan_id: planId,
    repair_receipt_sha256: repairReceipt.receipt_sha256,
    predecessor: structuredClone(predecessor),
    resume_checkpoint: structuredClone(repairReceipt.resume_checkpoint),
    attempt: 1,
    max_attempts: maxAttempts,
    lifecycle: [...RESPAWN_LIFECYCLE],
    owner_approval_sha256: repairReceipt.owner_approval_sha256,
    owner_actor_ref: repairReceipt.owner_actor_ref,
    protected_actions: structuredClone(PROTECTED_ACTIONS),
    created_at_utc: createdAtUtc,
    plan_sha256: null,
  };
  return validateRespawnPlan(finish(plan, "plan_sha256"));
}

export function validateRespawnPlan(value) {
  exactKeys(value, ["schema", "version", "status", "plan_id", "repair_receipt_sha256", "predecessor", "resume_checkpoint", "attempt", "max_attempts", "lifecycle", "owner_approval_sha256", "owner_actor_ref", "protected_actions", "created_at_utc", "plan_sha256"], "respawn plan");
  assert(value.schema === RESPAWN_PLAN_SCHEMA && value.version === 1 && value.status === "ADMITTED", "respawn plan identity is invalid");
  requireIdentifier(value.plan_id, "respawn plan_id");
  requireSha(value.repair_receipt_sha256, "respawn plan repair_receipt_sha256");
  validatePredecessor(value.predecessor);
  validateDigestBoundCheckpoint(value.resume_checkpoint, "respawn plan resume_checkpoint");
  assert(Number.isSafeInteger(value.attempt) && value.attempt === 1, "respawn plan attempt must begin at one");
  assert(Number.isSafeInteger(value.max_attempts) && value.max_attempts === 1, "respawn plan max_attempts must remain one bounded attempt");
  validateLifecycle(value.lifecycle, RESPAWN_LIFECYCLE, "respawn plan");
  requireSha(value.owner_approval_sha256, "respawn plan owner_approval_sha256");
  requireOpaqueReference(value.owner_actor_ref, "respawn plan owner_actor_ref");
  validateProtectedActions(value.protected_actions, "respawn plan protected_actions");
  requireUtc(value.created_at_utc, "respawn plan created_at_utc");
  requireSha(value.plan_sha256, "respawn plan plan_sha256");
  assert(value.plan_sha256 === digestWithout(value, "plan_sha256"), "respawn plan digest mismatch");
  return assertPortable(value, "respawn plan");
}

function compileRespawnFailure({plan, phase, error, observedAtUtc, replacement = null, completedLifecycle = [RESPAWN_LIFECYCLE[0]]}) {
  const failure = {
    phase,
    error_sha256: canonicalDigest({phase, message: error?.message ?? String(error)}),
    retry_allowed: false,
  };
  const receipt = {
    schema: RESPAWN_RECEIPT_SCHEMA,
    version: 1,
    status: "RESPAWN_BLOCKED",
    plan_sha256: plan.plan_sha256,
    repair_receipt_sha256: plan.repair_receipt_sha256,
    predecessor: structuredClone(plan.predecessor),
    resume_checkpoint: structuredClone(plan.resume_checkpoint),
    replacement: replacement === null ? null : structuredClone(replacement),
    predecessor_evidence_preserved: true,
    predecessor_handoff_sha256: plan.predecessor.handoff_sha256,
    result_sha256: null,
    result_evidence_sha256: null,
    typed_handoff_sha256: null,
    roster_sha256: null,
    lifecycle: [...plan.lifecycle],
    completed_lifecycle: [...completedLifecycle],
    failure,
    owner_actor_ref: plan.owner_actor_ref,
    protected_actions: structuredClone(PROTECTED_ACTIONS),
    observed_at_utc: observedAtUtc,
    receipt_sha256: null,
  };
  return validateRespawnReceipt(finish(receipt, "receipt_sha256"));
}

export function validateRespawnReceipt(value) {
  exactKeys(value, ["schema", "version", "status", "plan_sha256", "repair_receipt_sha256", "predecessor", "resume_checkpoint", "replacement", "predecessor_evidence_preserved", "predecessor_handoff_sha256", "result_sha256", "result_evidence_sha256", "typed_handoff_sha256", "roster_sha256", "lifecycle", "completed_lifecycle", "failure", "owner_actor_ref", "protected_actions", "observed_at_utc", "receipt_sha256"], "respawn receipt");
  assert(value.schema === RESPAWN_RECEIPT_SCHEMA && value.version === 1 && RESPAWN_STATUSES.includes(value.status), "respawn receipt identity is invalid");
  requireSha(value.plan_sha256, "respawn receipt plan_sha256");
  requireSha(value.repair_receipt_sha256, "respawn receipt repair_receipt_sha256");
  requireOpaqueReference(value.owner_actor_ref, "respawn receipt owner_actor_ref");
  validatePredecessor(value.predecessor);
  validateDigestBoundCheckpoint(value.resume_checkpoint, "respawn receipt resume_checkpoint");
  if (value.replacement !== null) {
    exactKeys(value.replacement, ["worker_ref", "session_ref", "source_commit", "source_tree", "checkpoint_sha256"], "respawn receipt replacement");
    requireOpaqueReference(value.replacement.worker_ref, "respawn receipt replacement.worker_ref");
    requireOpaqueReference(value.replacement.session_ref, "respawn receipt replacement.session_ref");
    requireGitObject(value.replacement.source_commit, "respawn receipt replacement.source_commit");
    requireGitObject(value.replacement.source_tree, "respawn receipt replacement.source_tree");
    requireSha(value.replacement.checkpoint_sha256, "respawn receipt replacement.checkpoint_sha256");
    assert(value.replacement.source_commit === value.resume_checkpoint.source_commit && value.replacement.source_tree === value.resume_checkpoint.source_tree && value.replacement.checkpoint_sha256 === value.resume_checkpoint.checkpoint_sha256, "respawn receipt replacement is not checkpoint-bound");
    assert(value.replacement.worker_ref !== value.predecessor.worker_ref && value.replacement.session_ref !== value.predecessor.session_ref, "respawn receipt replacement reuses predecessor identity");
  }
  assert(value.predecessor_evidence_preserved === true, "respawn receipt lost predecessor evidence");
  requireSha(value.predecessor_handoff_sha256, "respawn receipt predecessor_handoff_sha256");
  assert(value.predecessor_handoff_sha256 === value.predecessor.handoff_sha256, "respawn receipt predecessor handoff differs");
  if (value.result_sha256 !== null) requireSha(value.result_sha256, "respawn receipt result_sha256");
  if (value.result_evidence_sha256 !== null) requireSha(value.result_evidence_sha256, "respawn receipt result_evidence_sha256");
  if (value.typed_handoff_sha256 !== null) requireSha(value.typed_handoff_sha256, "respawn receipt typed_handoff_sha256");
  if (value.roster_sha256 !== null) requireSha(value.roster_sha256, "respawn receipt roster_sha256");
  validateLifecycle(value.lifecycle, RESPAWN_LIFECYCLE, "respawn receipt");
  validateLifecycleProgress(value.completed_lifecycle, RESPAWN_LIFECYCLE, "respawn receipt");
  if (value.status === "RESPAWNED_AND_BOUND") assert(value.completed_lifecycle.length === RESPAWN_LIFECYCLE.length, "successful respawn has incomplete lifecycle");
  if (value.status === "RESPAWN_BLOCKED") {
    validateFailure(value.failure);
    assert(value.replacement === null || isRecord(value.replacement), "blocked respawn replacement is malformed");
    assert(value.completed_lifecycle.length < RESPAWN_LIFECYCLE.length, "blocked respawn claims a complete lifecycle");
    assert(value.result_sha256 === null && value.result_evidence_sha256 === null && value.typed_handoff_sha256 === null && value.roster_sha256 === null, "blocked respawn carries success evidence");
  } else {
    assert(value.failure === null, "successful respawn carries a failure");
    assert(value.replacement !== null, "successful respawn lacks replacement identity");
    requireSha(value.result_sha256, "successful respawn result_sha256");
    requireSha(value.result_evidence_sha256, "successful respawn result_evidence_sha256");
    requireSha(value.typed_handoff_sha256, "successful respawn typed_handoff_sha256");
    requireSha(value.roster_sha256, "successful respawn roster_sha256");
  }
  validateProtectedActions(value.protected_actions, "respawn receipt protected_actions");
  requireUtc(value.observed_at_utc, "respawn receipt observed_at_utc");
  requireSha(value.receipt_sha256, "respawn receipt receipt_sha256");
  assert(value.receipt_sha256 === digestWithout(value, "receipt_sha256"), "respawn receipt digest mismatch");
  return assertPortable(value, "respawn receipt");
}

export async function runBoundedRespawn({plan, adapter, observedAtUtc = new Date().toISOString()} = {}) {
  validateRespawnPlan(plan);
  requireUtc(observedAtUtc, "respawn observedAtUtc");
  assert(adapter && typeof adapter === "object", "respawn adapter is required");
  for (const method of ["createReplacement", "sendPredecessorHandoff", "readMeaningfulResult", "closePredecessor", "verifyActiveRoster"]) assert(typeof adapter[method] === "function", `respawn adapter is missing ${method}`);
  let replacement = null;
  let completedLifecycle = [RESPAWN_LIFECYCLE[0]];
  let currentPhase = RESPAWN_LIFECYCLE[1];
  try {
    currentPhase = RESPAWN_LIFECYCLE[1];
    const created = await adapter.createReplacement({
      plan_id: plan.plan_id,
      repair_receipt_sha256: plan.repair_receipt_sha256,
      predecessor_handoff_sha256: plan.predecessor.handoff_sha256,
      checkpoint: structuredClone(plan.resume_checkpoint),
      attempt: plan.attempt,
    });
    validateReplacementCreation(created, plan.resume_checkpoint);
    assert(created.worker_ref !== plan.predecessor.worker_ref && created.session_ref !== plan.predecessor.session_ref, "replacement reused predecessor identity");
    completedLifecycle.push(RESPAWN_LIFECYCLE[1]);
    replacement = {
      worker_ref: created.worker_ref,
      session_ref: created.session_ref,
      source_commit: created.source_commit,
      source_tree: created.source_tree,
      checkpoint_sha256: created.checkpoint_sha256,
    };
    currentPhase = RESPAWN_LIFECYCLE[2];
    const sent = await adapter.sendPredecessorHandoff({replacement: structuredClone(replacement), predecessor: structuredClone(plan.predecessor)});
    validateHandoffSend(sent, plan.predecessor);
    completedLifecycle.push(RESPAWN_LIFECYCLE[2]);
    currentPhase = RESPAWN_LIFECYCLE[3];
    const result = await adapter.readMeaningfulResult({replacement: structuredClone(replacement), checkpoint: structuredClone(plan.resume_checkpoint)});
    validateMeaningfulResult(result, replacement, plan.resume_checkpoint);
    completedLifecycle.push(RESPAWN_LIFECYCLE[3]);
    currentPhase = RESPAWN_LIFECYCLE[4];
    const closed = await adapter.closePredecessor({predecessor: structuredClone(plan.predecessor), replacement: structuredClone(replacement)});
    validatePredecessorClose(closed, plan.predecessor);
    completedLifecycle.push(RESPAWN_LIFECYCLE[4]);
    currentPhase = RESPAWN_LIFECYCLE[5];
    const roster = await adapter.verifyActiveRoster({predecessor: structuredClone(plan.predecessor), replacement: structuredClone(replacement)});
    validateRoster(roster, plan.predecessor, replacement);
    completedLifecycle.push(RESPAWN_LIFECYCLE[5]);
    const receipt = {
      schema: RESPAWN_RECEIPT_SCHEMA,
      version: 1,
      status: "RESPAWNED_AND_BOUND",
      plan_sha256: plan.plan_sha256,
      repair_receipt_sha256: plan.repair_receipt_sha256,
      predecessor: structuredClone(plan.predecessor),
      resume_checkpoint: structuredClone(plan.resume_checkpoint),
      replacement,
      predecessor_evidence_preserved: true,
      predecessor_handoff_sha256: plan.predecessor.handoff_sha256,
      result_sha256: result.result_sha256,
      result_evidence_sha256: result.evidence_sha256,
      typed_handoff_sha256: result.typed_handoff_sha256,
      roster_sha256: roster.roster_sha256,
      lifecycle: [...plan.lifecycle],
      completed_lifecycle: completedLifecycle,
      failure: null,
      owner_actor_ref: plan.owner_actor_ref,
      protected_actions: structuredClone(PROTECTED_ACTIONS),
      observed_at_utc: observedAtUtc,
      receipt_sha256: null,
    };
    return validateRespawnReceipt(finish(receipt, "receipt_sha256"));
  } catch (error) {
    if (replacement !== null && typeof adapter.abortReplacement === "function") {
      try {
        await adapter.abortReplacement({replacement: structuredClone(replacement), reason: "BOUNDED_RESPAWN_FAILURE"});
      } catch {
        // Cleanup evidence is represented by the blocked receipt; raw adapter
        // output is intentionally not persisted.
      }
    }
    return compileRespawnFailure({plan, phase: currentPhase, error, observedAtUtc, replacement, completedLifecycle});
  }
}

function validateRollbackApproval(value, expectedParent) {
  validateOwnerApproval(value, "APPROVE_ROLLBACK");
  assert(value.parent_digest === expectedParent, "rollback approval is not bound to this plan");
  return value;
}

export function compileRollbackPlan({rollbackId, repairReceipt, restoreCheckpoint, reason, createdAtUtc = new Date().toISOString()} = {}) {
  validateRepairReceipt(repairReceipt);
  validateDigestBoundCheckpoint(restoreCheckpoint, "rollback restore checkpoint");
  assert(restoreCheckpoint.checkpoint_sha256 !== repairReceipt.resume_checkpoint.checkpoint_sha256, "rollback restore checkpoint must differ from candidate");
  requireIdentifier(rollbackId, "rollback_id");
  requireString(reason, "rollback reason");
  requireUtc(createdAtUtc, "rollback createdAtUtc");
  const plan = {
    schema: ROLLBACK_PLAN_SCHEMA,
    version: 1,
    status: "PENDING_OWNER_REVIEW",
    rollback_id: rollbackId,
    repair_receipt_sha256: repairReceipt.receipt_sha256,
    candidate_checkpoint: structuredClone(repairReceipt.resume_checkpoint),
    restore_checkpoint: structuredClone(restoreCheckpoint),
    reason,
    max_attempts: 1,
    lifecycle: [...ROLLBACK_LIFECYCLE],
    owner_approval: null,
    owner_approval_parent_sha256: null,
    protected_actions: structuredClone(PROTECTED_ACTIONS),
    external_actions_allowed: false,
    created_at_utc: createdAtUtc,
    plan_sha256: null,
  };
  return validateRollbackPlan(finish(plan, "plan_sha256"));
}

export function validateRollbackPlan(value) {
  exactKeys(value, ["schema", "version", "status", "rollback_id", "repair_receipt_sha256", "candidate_checkpoint", "restore_checkpoint", "reason", "max_attempts", "lifecycle", "owner_approval", "owner_approval_parent_sha256", "protected_actions", "external_actions_allowed", "created_at_utc", "plan_sha256"], "rollback plan");
  assert(value.schema === ROLLBACK_PLAN_SCHEMA && value.version === 1 && ROLLBACK_PLAN_STATUSES.includes(value.status), "rollback plan identity is invalid");
  requireIdentifier(value.rollback_id, "rollback_id");
  requireSha(value.repair_receipt_sha256, "rollback plan repair_receipt_sha256");
  validateDigestBoundCheckpoint(value.candidate_checkpoint, "rollback candidate checkpoint");
  validateDigestBoundCheckpoint(value.restore_checkpoint, "rollback restore checkpoint");
  assert(value.candidate_checkpoint.checkpoint_sha256 !== value.restore_checkpoint.checkpoint_sha256, "rollback checkpoints must differ");
  requireString(value.reason, "rollback reason");
  assert(value.max_attempts === 1, "rollback must remain one bounded attempt");
  validateLifecycle(value.lifecycle, ROLLBACK_LIFECYCLE, "rollback plan");
  if (value.owner_approval !== null) {
    requireSha(value.owner_approval_parent_sha256, "rollback plan owner_approval_parent_sha256");
    validateRollbackApproval(value.owner_approval, value.owner_approval_parent_sha256);
  } else assert(value.owner_approval_parent_sha256 === null, "rollback plan carries an orphan approval parent");
  if (value.status === "PENDING_OWNER_REVIEW") assert(value.owner_approval === null && value.owner_approval_parent_sha256 === null, "pending rollback plan carries owner admission");
  if (value.status === "ADMITTED") assert(value.owner_approval !== null && value.owner_approval_parent_sha256 !== null, "admitted rollback plan lacks owner admission");
  validateProtectedActions(value.protected_actions, "rollback plan protected_actions");
  assert(value.external_actions_allowed === false, "rollback plan cannot perform external actions");
  requireUtc(value.created_at_utc, "rollback plan created_at_utc");
  requireSha(value.plan_sha256, "rollback plan plan_sha256");
  assert(value.plan_sha256 === digestWithout(value, "plan_sha256"), "rollback plan digest mismatch");
  return assertPortable(value, "rollback plan");
}

export function admitRollbackPlan(plan, approval) {
  validateRollbackPlan(plan);
  assert(plan.status === "PENDING_OWNER_REVIEW", "rollback plan is not awaiting owner review");
  validateRollbackApproval(approval, plan.plan_sha256);
  const admitted = {...structuredClone(plan), status: "ADMITTED", owner_approval: structuredClone(approval), owner_approval_parent_sha256: plan.plan_sha256, plan_sha256: null};
  return validateRollbackPlan(finish(admitted, "plan_sha256"));
}

function validateRollbackPrepare(value, plan, label = "rollback prepare") {
  exactKeys(value, ["ready", "from_checkpoint_sha256", "to_checkpoint_sha256"], label);
  assert(value.ready === true, `${label} did not confirm readiness`);
  requireSha(value.from_checkpoint_sha256, `${label}.from_checkpoint_sha256`);
  requireSha(value.to_checkpoint_sha256, `${label}.to_checkpoint_sha256`);
  assert(value.from_checkpoint_sha256 === plan.candidate_checkpoint.checkpoint_sha256 && value.to_checkpoint_sha256 === plan.restore_checkpoint.checkpoint_sha256, `${label} checkpoint identity differs`);
  return value;
}

function validateRollbackReadback(value, checkpoint, label = "rollback readback") {
  exactKeys(value, ["restored", "checkpoint_sha256", "source_commit", "source_tree"], label);
  assert(value.restored === true, `${label} did not confirm restoration`);
  requireSha(value.checkpoint_sha256, `${label}.checkpoint_sha256`);
  requireGitObject(value.source_commit, `${label}.source_commit`);
  requireGitObject(value.source_tree, `${label}.source_tree`);
  assert(value.checkpoint_sha256 === checkpoint.checkpoint_sha256 && value.source_commit === checkpoint.source_commit && value.source_tree === checkpoint.source_tree, `${label} differs from restore checkpoint`);
  return value;
}

function validateRollbackAudit(value, plan, label = "rollback audit") {
  exactKeys(value, ["passed", "auditor_ref", "evidence_sha256"], label);
  assert(value.passed === true, `${label} did not pass`);
  requireOpaqueReference(value.auditor_ref, `${label}.auditor_ref`);
  requireSha(value.evidence_sha256, `${label}.evidence_sha256`);
  assert(value.auditor_ref !== plan.owner_approval.actor_ref, `${label} is not independent of the owner approval`);
  return value;
}

function compileRollbackFailure({plan, phase, error, observedAtUtc, completedLifecycle, previousCandidateRetained}) {
  const receipt = {
    schema: ROLLBACK_RECEIPT_SCHEMA,
    version: 1,
    status: previousCandidateRetained ? "ROLLBACK_FAILED_RETAINED" : "ROLLBACK_STATE_UNCERTAIN",
    plan_sha256: plan.plan_sha256,
    repair_receipt_sha256: plan.repair_receipt_sha256,
    candidate_checkpoint: structuredClone(plan.candidate_checkpoint),
    restore_checkpoint: structuredClone(plan.restore_checkpoint),
    lifecycle: [...plan.lifecycle],
    completed_lifecycle: [...completedLifecycle],
    failure: {phase, error_sha256: canonicalDigest({phase, message: error?.message ?? String(error)}), retry_allowed: false},
    candidate_evidence_preserved: true,
    previous_candidate_retained: previousCandidateRetained,
    owner_actor_ref: plan.owner_approval.actor_ref,
    restored_readback_sha256: null,
    independent_audit_ref: null,
    independent_audit_evidence_sha256: null,
    protected_actions: structuredClone(PROTECTED_ACTIONS),
    observed_at_utc: observedAtUtc,
    receipt_sha256: null,
  };
  return validateRollbackReceipt(finish(receipt, "receipt_sha256"));
}

export function validateRollbackReceipt(value) {
  exactKeys(value, ["schema", "version", "status", "plan_sha256", "repair_receipt_sha256", "candidate_checkpoint", "restore_checkpoint", "lifecycle", "completed_lifecycle", "failure", "candidate_evidence_preserved", "previous_candidate_retained", "owner_actor_ref", "restored_readback_sha256", "independent_audit_ref", "independent_audit_evidence_sha256", "protected_actions", "observed_at_utc", "receipt_sha256"], "rollback receipt");
  assert(value.schema === ROLLBACK_RECEIPT_SCHEMA && value.version === 1 && ROLLBACK_RECEIPT_STATUSES.includes(value.status), "rollback receipt identity is invalid");
  requireSha(value.plan_sha256, "rollback receipt plan_sha256");
  requireSha(value.repair_receipt_sha256, "rollback receipt repair_receipt_sha256");
  requireOpaqueReference(value.owner_actor_ref, "rollback receipt owner_actor_ref");
  validateDigestBoundCheckpoint(value.candidate_checkpoint, "rollback receipt candidate checkpoint");
  validateDigestBoundCheckpoint(value.restore_checkpoint, "rollback receipt restore checkpoint");
  validateLifecycle(value.lifecycle, ROLLBACK_LIFECYCLE, "rollback receipt");
  validateLifecycleProgress(value.completed_lifecycle, ROLLBACK_LIFECYCLE, "rollback receipt");
  assert(value.candidate_evidence_preserved === true, "rollback receipt lost candidate evidence");
  assert(typeof value.previous_candidate_retained === "boolean", "rollback receipt candidate-retention flag is invalid");
  if (value.restored_readback_sha256 !== null) requireSha(value.restored_readback_sha256, "rollback receipt restored_readback_sha256");
  if (value.independent_audit_ref !== null) requireOpaqueReference(value.independent_audit_ref, "rollback receipt independent_audit_ref");
  if (value.independent_audit_evidence_sha256 !== null) requireSha(value.independent_audit_evidence_sha256, "rollback receipt independent_audit_evidence_sha256");
  if (value.status === "ROLLED_BACK_AND_VERIFIED") {
    assert(value.failure === null, "successful rollback carries a failure");
    assert(value.completed_lifecycle.length === ROLLBACK_LIFECYCLE.length, "successful rollback has incomplete lifecycle");
    assert(value.previous_candidate_retained === false, "successful rollback incorrectly claims candidate remains active");
    requireSha(value.restored_readback_sha256, "successful rollback restored_readback_sha256");
    requireOpaqueReference(value.independent_audit_ref, "successful rollback independent_audit_ref");
    requireSha(value.independent_audit_evidence_sha256, "successful rollback independent_audit_evidence_sha256");
    assert(value.independent_audit_ref !== value.owner_actor_ref, "successful rollback Auditor is not independent");
  } else {
    validateFailure(value.failure);
    assert(value.completed_lifecycle.length < ROLLBACK_LIFECYCLE.length, "failed rollback claims a complete lifecycle");
    if (value.status === "ROLLBACK_FAILED_RETAINED") assert(value.previous_candidate_retained === true, "retained rollback failure lost candidate state");
    if (value.status === "ROLLBACK_STATE_UNCERTAIN") assert(value.previous_candidate_retained === false, "uncertain rollback failure claims candidate state");
    assert(value.restored_readback_sha256 === null && value.independent_audit_ref === null && value.independent_audit_evidence_sha256 === null, "failed rollback carries success evidence");
  }
  validateProtectedActions(value.protected_actions, "rollback receipt protected_actions");
  requireUtc(value.observed_at_utc, "rollback receipt observed_at_utc");
  requireSha(value.receipt_sha256, "rollback receipt receipt_sha256");
  assert(value.receipt_sha256 === digestWithout(value, "receipt_sha256"), "rollback receipt digest mismatch");
  return assertPortable(value, "rollback receipt");
}

export async function runBoundedRollback({plan, executor, observedAtUtc = new Date().toISOString()} = {}) {
  validateRollbackPlan(plan);
  assert(plan.status === "ADMITTED", "rollback requires owner admission");
  requireUtc(observedAtUtc, "rollback observedAtUtc");
  assert(executor && typeof executor === "object", "rollback executor is required");
  for (const method of ["prepareRollback", "restoreCheckpoint", "readbackCheckpoint", "independentAudit"]) assert(typeof executor[method] === "function", `rollback executor is missing ${method}`);
  let completedLifecycle = [ROLLBACK_LIFECYCLE[0]];
  let currentPhase = ROLLBACK_LIFECYCLE[1];
  let previousCandidateRetained = true;
  try {
    currentPhase = ROLLBACK_LIFECYCLE[1];
    const prepared = await executor.prepareRollback({candidate: structuredClone(plan.candidate_checkpoint), restore: structuredClone(plan.restore_checkpoint)});
    validateRollbackPrepare(prepared, plan);
    completedLifecycle.push(ROLLBACK_LIFECYCLE[1]);
    currentPhase = ROLLBACK_LIFECYCLE[2];
    previousCandidateRetained = false;
    const restored = await executor.restoreCheckpoint({checkpoint: structuredClone(plan.restore_checkpoint)});
    validateRollbackReadback(restored, plan.restore_checkpoint, "rollback restore");
    completedLifecycle.push(ROLLBACK_LIFECYCLE[2]);
    currentPhase = ROLLBACK_LIFECYCLE[3];
    const readback = await executor.readbackCheckpoint({checkpoint: structuredClone(plan.restore_checkpoint)});
    validateRollbackReadback(readback, plan.restore_checkpoint, "rollback readback");
    completedLifecycle.push(ROLLBACK_LIFECYCLE[3]);
    currentPhase = ROLLBACK_LIFECYCLE[4];
    const audit = await executor.independentAudit({candidate: structuredClone(plan.candidate_checkpoint), restored: structuredClone(plan.restore_checkpoint)});
    validateRollbackAudit(audit, plan);
    completedLifecycle.push(ROLLBACK_LIFECYCLE[4]);
    const receipt = {
      schema: ROLLBACK_RECEIPT_SCHEMA,
      version: 1,
      status: "ROLLED_BACK_AND_VERIFIED",
      plan_sha256: plan.plan_sha256,
      repair_receipt_sha256: plan.repair_receipt_sha256,
      candidate_checkpoint: structuredClone(plan.candidate_checkpoint),
      restore_checkpoint: structuredClone(plan.restore_checkpoint),
      lifecycle: [...plan.lifecycle],
      completed_lifecycle: completedLifecycle,
      failure: null,
      candidate_evidence_preserved: true,
      previous_candidate_retained: false,
      owner_actor_ref: plan.owner_approval.actor_ref,
      restored_readback_sha256: canonicalDigest(readback),
      independent_audit_ref: audit.auditor_ref,
      independent_audit_evidence_sha256: audit.evidence_sha256,
      protected_actions: structuredClone(PROTECTED_ACTIONS),
      observed_at_utc: observedAtUtc,
      receipt_sha256: null,
    };
    return validateRollbackReceipt(finish(receipt, "receipt_sha256"));
  } catch (error) {
    return compileRollbackFailure({plan, phase: currentPhase, error, observedAtUtc, completedLifecycle, previousCandidateRetained});
  }
}
