#!/usr/bin/env node

/*
 * Project-agnostic bounded-phase liveness contract for the Agent Spawner.
 *
 * A compiler phase may continue only while its bounded window is still open
 * or while it has emitted meaningful progress/a typed result.  Once the
 * window is exhausted without that result, this contract produces a durable
 * stop-and-rehome checkpoint.  The checkpoint carries only opaque receipt
 * bindings; resolved custody paths remain runtime receipt data owned by the
 * caller.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const SPAWNER_LIVENESS_CHECKPOINT_SCHEMA = "agentos.spawner_liveness_checkpoint.v1";
export const SPAWNER_LIVENESS_CHECKPOINT_VERSION = 1;
export const SPAWNER_LIVENESS_STATUSES = Object.freeze([
  "PROGRESS",
  "TYPED_RESULT",
  "WAITING_WITHIN_BOUND",
  "BLOCKED_EXACT",
  "UNKNOWN",
]);
export const SPAWNER_LIVENESS_NEXT_ACTIONS = Object.freeze(["CONTINUE_PHASE", "REHOME_OR_RESTART"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const CHECKPOINT_KEYS = Object.freeze([
  "schema", "version", "checkpoint_id", "lifecycle_id", "phase", "phase_index", "phase_window_seconds",
  "started_at_utc", "observed_at_utc", "elapsed_seconds", "window_status", "meaningful_progress",
  "typed_result_status", "exact_receipt_status", "exact_receipt_ref", "exact_receipt_sha256", "persistence",
  "status", "safe_stop", "next_action", "checkpoint_sha256",
]);
const PERSISTENCE_KEYS = Object.freeze(["status", "receipt_ref", "receipt_sha256", "atomic", "same_turn", "write_scope"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  assert(value !== "0".repeat(64) && value !== "f".repeat(64), `${label} may not be a placeholder digest`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be an ISO UTC timestamp`);
}

function requireNonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function checkpointBody(checkpoint) {
  const body = structuredClone(checkpoint);
  body.checkpoint_sha256 = null;
  return body;
}

function deriveStatus({windowStatus, meaningfulProgress, typedResultStatus, exactReceiptStatus}) {
  if (exactReceiptStatus === "UNKNOWN" || typedResultStatus === "UNKNOWN") return "UNKNOWN";
  if (typedResultStatus === "PRESENT") return "TYPED_RESULT";
  if (meaningfulProgress === true) return "PROGRESS";
  if (windowStatus === "WITHIN_BOUND") return "WAITING_WITHIN_BOUND";
  return "BLOCKED_EXACT";
}

function validatePersistence(persistence, checkpoint) {
  exactKeys(persistence, PERSISTENCE_KEYS, "Spawner liveness checkpoint persistence");
  assert(persistence.status === "CHECKPOINT_PERSISTED", "Spawner liveness checkpoint is not marked persisted");
  requireReference(persistence.receipt_ref, "Spawner liveness checkpoint receipt reference");
  requireSha(persistence.receipt_sha256, "Spawner liveness checkpoint receipt digest");
  assert(persistence.receipt_ref === checkpoint.exact_receipt_ref, "Spawner liveness checkpoint receipt reference diverges");
  assert(persistence.receipt_sha256 === checkpoint.exact_receipt_sha256, "Spawner liveness checkpoint receipt digest diverges");
  assert(persistence.atomic === true && persistence.same_turn === true, "Spawner liveness checkpoint must be atomic and same-turn");
  assert(persistence.write_scope === "CONTROL_PLANE_ONLY", "Spawner liveness checkpoint crossed its write scope");
}

export function validateSpawnerLivenessCheckpoint(checkpoint) {
  exactKeys(checkpoint, CHECKPOINT_KEYS, "Spawner liveness checkpoint");
  assert(checkpoint.schema === SPAWNER_LIVENESS_CHECKPOINT_SCHEMA && checkpoint.version === SPAWNER_LIVENESS_CHECKPOINT_VERSION, "Spawner liveness checkpoint identity is invalid");
  requireIdentifier(checkpoint.checkpoint_id, "Spawner liveness checkpoint ID");
  requireIdentifier(checkpoint.lifecycle_id, "Spawner liveness lifecycle ID");
  requireIdentifier(checkpoint.phase, "Spawner liveness phase");
  requireNonNegativeInteger(checkpoint.phase_index, "Spawner liveness phase index");
  assert(Number.isSafeInteger(checkpoint.phase_window_seconds) && checkpoint.phase_window_seconds > 0, "Spawner liveness phase window is invalid");
  requireUtc(checkpoint.started_at_utc, "Spawner liveness phase start");
  requireUtc(checkpoint.observed_at_utc, "Spawner liveness observation");
  requireNonNegativeInteger(checkpoint.elapsed_seconds, "Spawner liveness elapsed seconds");
  const elapsed = Math.floor((Date.parse(checkpoint.observed_at_utc) - Date.parse(checkpoint.started_at_utc)) / 1000);
  assert(elapsed === checkpoint.elapsed_seconds, "Spawner liveness elapsed seconds do not match timestamps");
  assert(["WITHIN_BOUND", "EXHAUSTED"].includes(checkpoint.window_status), "Spawner liveness window status is invalid");
  assert(checkpoint.window_status === (checkpoint.elapsed_seconds > checkpoint.phase_window_seconds ? "EXHAUSTED" : "WITHIN_BOUND"), "Spawner liveness window status is inconsistent");
  assert(typeof checkpoint.meaningful_progress === "boolean", "Spawner liveness progress flag is invalid");
  assert(["PRESENT", "ABSENT", "UNKNOWN"].includes(checkpoint.typed_result_status), "Spawner liveness typed-result status is invalid");
  assert(["EXACT", "UNKNOWN"].includes(checkpoint.exact_receipt_status), "Spawner liveness receipt status is invalid");
  requireReference(checkpoint.exact_receipt_ref, "Spawner liveness exact receipt reference");
  requireSha(checkpoint.exact_receipt_sha256, "Spawner liveness exact receipt digest");
  validatePersistence(checkpoint.persistence, checkpoint);
  assert(SPAWNER_LIVENESS_STATUSES.includes(checkpoint.status), "Spawner liveness status is invalid");
  assert(checkpoint.status === deriveStatus({
    windowStatus: checkpoint.window_status,
    meaningfulProgress: checkpoint.meaningful_progress,
    typedResultStatus: checkpoint.typed_result_status,
    exactReceiptStatus: checkpoint.exact_receipt_status,
  }), "Spawner liveness status was not derived from observations");
  assert(typeof checkpoint.safe_stop === "boolean", "Spawner liveness safe-stop flag is invalid");
  assert(SPAWNER_LIVENESS_NEXT_ACTIONS.includes(checkpoint.next_action), "Spawner liveness next action is invalid");
  if (["BLOCKED_EXACT", "UNKNOWN"].includes(checkpoint.status)) {
    assert(checkpoint.safe_stop === true && checkpoint.next_action === "REHOME_OR_RESTART", "Stalled Spawner must stop safely and request rehome/restart");
    assert(checkpoint.window_status === "EXHAUSTED", "Stalled Spawner must have an exhausted bounded window");
    assert(checkpoint.meaningful_progress === false && checkpoint.typed_result_status !== "PRESENT", "Stalled Spawner cannot claim progress or a typed result");
  } else {
    assert(checkpoint.safe_stop === false && checkpoint.next_action === "CONTINUE_PHASE", "Live Spawner phase must continue only with a bound action");
  }
  requireSha(checkpoint.checkpoint_sha256, "Spawner liveness checkpoint digest");
  assert(checkpoint.checkpoint_sha256 === canonicalDigest(checkpointBody(checkpoint)), "Spawner liveness checkpoint digest mismatch");
  return checkpoint;
}

export function compileSpawnerLivenessCheckpoint({
  checkpointId,
  lifecycleId,
  phase,
  phaseIndex,
  phaseWindowSeconds,
  startedAtUtc,
  observedAtUtc,
  meaningfulProgress = false,
  typedResultStatus = "ABSENT",
  exactReceiptStatus = "EXACT",
  exactReceiptRef,
  exactReceiptSha256,
} = {}) {
  requireIdentifier(checkpointId, "Spawner liveness checkpoint ID");
  requireIdentifier(lifecycleId, "Spawner liveness lifecycle ID");
  requireIdentifier(phase, "Spawner liveness phase");
  requireNonNegativeInteger(phaseIndex, "Spawner liveness phase index");
  assert(Number.isSafeInteger(phaseWindowSeconds) && phaseWindowSeconds > 0, "Spawner liveness phase window is invalid");
  requireUtc(startedAtUtc, "Spawner liveness phase start");
  requireUtc(observedAtUtc, "Spawner liveness observation");
  const elapsedSeconds = Math.floor((Date.parse(observedAtUtc) - Date.parse(startedAtUtc)) / 1000);
  assert(elapsedSeconds >= 0, "Spawner liveness observation precedes phase start");
  assert(typeof meaningfulProgress === "boolean", "Spawner liveness progress flag is invalid");
  assert(["PRESENT", "ABSENT", "UNKNOWN"].includes(typedResultStatus), "Spawner liveness typed-result status is invalid");
  assert(["EXACT", "UNKNOWN"].includes(exactReceiptStatus), "Spawner liveness receipt status is invalid");
  requireReference(exactReceiptRef, "Spawner liveness exact receipt reference");
  requireSha(exactReceiptSha256, "Spawner liveness exact receipt digest");
  const windowStatus = elapsedSeconds > phaseWindowSeconds ? "EXHAUSTED" : "WITHIN_BOUND";
  const status = deriveStatus({windowStatus, meaningfulProgress, typedResultStatus, exactReceiptStatus});
  const checkpoint = {
    schema: SPAWNER_LIVENESS_CHECKPOINT_SCHEMA,
    version: SPAWNER_LIVENESS_CHECKPOINT_VERSION,
    checkpoint_id: checkpointId,
    lifecycle_id: lifecycleId,
    phase,
    phase_index: phaseIndex,
    phase_window_seconds: phaseWindowSeconds,
    started_at_utc: startedAtUtc,
    observed_at_utc: observedAtUtc,
    elapsed_seconds: elapsedSeconds,
    window_status: windowStatus,
    meaningful_progress: meaningfulProgress,
    typed_result_status: typedResultStatus,
    exact_receipt_status: exactReceiptStatus,
    exact_receipt_ref: exactReceiptRef,
    exact_receipt_sha256: exactReceiptSha256,
    persistence: {
      status: "CHECKPOINT_PERSISTED",
      receipt_ref: exactReceiptRef,
      receipt_sha256: exactReceiptSha256,
      atomic: true,
      same_turn: true,
      write_scope: "CONTROL_PLANE_ONLY",
    },
    status,
    safe_stop: ["BLOCKED_EXACT", "UNKNOWN"].includes(status),
    next_action: ["BLOCKED_EXACT", "UNKNOWN"].includes(status) ? "REHOME_OR_RESTART" : "CONTINUE_PHASE",
    checkpoint_sha256: null,
  };
  checkpoint.checkpoint_sha256 = canonicalDigest(checkpointBody(checkpoint));
  return validateSpawnerLivenessCheckpoint(checkpoint);
}

function normalizeThrownError(error) {
  return {
    error_name: typeof error?.name === "string" && error.name.length > 0 ? error.name : "Error",
    error_code: typeof error?.code === "string" && error.code.length > 0 ? error.code : "UNKNOWN_ERROR",
    error_message_sha256: canonicalDigest(typeof error?.message === "string" ? error.message : String(error)),
  };
}

/*
 * Execute one bounded phase and always return a typed checkpoint.  A phase
 * callback that throws or returns no result is converted into a safe stop;
 * it is never converted into an inferred PASS and never left silently active.
 */
export function runSpawnerBoundedPhase({
  checkpointId,
  lifecycleId,
  phase,
  phaseIndex,
  phaseWindowSeconds,
  startedAtUtc,
  observedAtUtc,
  execute,
  exactReceiptRef = null,
} = {}) {
  assert(typeof execute === "function", "Spawner bounded phase requires an execution callback");
  requireIdentifier(checkpointId, "Spawner liveness checkpoint ID");
  const receiptRef = exactReceiptRef ?? `opaque:spawner-liveness:${checkpointId}`;
  requireReference(receiptRef, "Spawner liveness exact receipt reference");
  let result = null;
  let error = null;
  let receipt;
  let typedResultStatus = "ABSENT";
  let meaningfulProgress = false;
  try {
    result = execute();
    if (result !== null && result !== undefined) {
      typedResultStatus = "PRESENT";
      meaningfulProgress = true;
      receipt = {status: "TYPED_RESULT", result_sha256: canonicalDigest(result)};
    } else {
      receipt = {status: "NO_TYPED_RESULT", result: null};
    }
  } catch (caught) {
    error = normalizeThrownError(caught);
    receipt = {status: "EXECUTION_ERROR", error};
  }
  const checkpoint = compileSpawnerLivenessCheckpoint({
    checkpointId,
    lifecycleId,
    phase,
    phaseIndex,
    phaseWindowSeconds,
    startedAtUtc,
    observedAtUtc,
    meaningfulProgress,
    typedResultStatus,
    exactReceiptStatus: "EXACT",
    exactReceiptRef: receiptRef,
    exactReceiptSha256: canonicalDigest(receipt),
  });
  return {result, error, exact_receipt: receipt, checkpoint};
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Spawner liveness checkpoint contract loaded\n");
