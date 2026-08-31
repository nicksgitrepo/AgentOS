#!/usr/bin/env node

import {canonicalDigest} from "./content-addressing.mjs";


export const SCHEDULER_PROJECTION_LIVENESS_SCHEMA = "agentos.scheduler_projection_liveness.v1";
export const ACTIVE_OR_PROJECTION_LAG = "ACTIVE_OR_PROJECTION_LAG";
export const MATERIAL_LIVENESS_ACTIVE = "MATERIAL_LIVENESS_ACTIVE";
export const SAME_TASK_RECOVERY_REQUIRED = "SAME_TASK_RECOVERY_REQUIRED";
export const MATERIAL_LIVENESS_STAGNANT = "MATERIAL_LIVENESS_STAGNANT";
export const TYPED_HOST_CAPABILITY_ESCALATION = "TYPED_HOST_CAPABILITY_ESCALATION";
export const PROJECTION_LIVENESS_EVIDENCE_REQUIRED = "PROJECTION_LIVENESS_EVIDENCE_REQUIRED";

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), label + " must be an object"); }
function requireString(value, label) { assert(typeof value === "string" && value.trim().length > 0, label + " must be a non-empty string"); }
function clone(value) { return structuredClone(value); }
function pick(value, ...keys) { for (const key of keys) if (value?.[key] !== undefined) return value[key]; return undefined; }
function digestBody(value, field) { return canonicalDigest({...clone(value), [field]: null}); }
function validUtcInstant(value, label) {
  requireString(value, label);
  const millis = Date.parse(value);
  const canonicalInput = value.includes(".") ? value : value.replace(/Z$/u, ".000Z");
  assert(Number.isFinite(millis) && new Date(millis).toISOString() === canonicalInput, `${label} must be a canonical UTC instant`);
  return value;
}

function normalizeObservationArray(value, label) {
  const result = value === undefined || value === null ? [] : value;
  assert(Array.isArray(result), `${label} must be an array`);
  result.forEach((entry, index) => assert(isRecord(entry), `${label}[${index}] must be an object`));
  return clone(result);
}

function normalizeDurableSessionObservation(value) {
  requireRecord(value, "durable session observation");
  const sessionId = pick(value, "session_id", "sessionId", "id");
  id(sessionId, "durable session ID");
  const ordinal = pick(value, "ordinal", "session_ordinal", "sessionOrdinal");
  count(ordinal, "durable session ordinal");
  const mtime = pick(value, "mtime", "mtime_ms", "mtimeMs", "mtime_utc", "mtimeUtc", "last_activity_utc", "lastActivityUtc");
  assert(mtime !== undefined && mtime !== null, "durable session mtime/activity timestamp is required");
  let mtimeKey;
  if (typeof mtime === "number") {
    assert(Number.isSafeInteger(mtime) && mtime >= 0, "durable session mtime must be a non-negative safe integer or UTC instant");
    mtimeKey = `N:${mtime}`;
  } else {
    requireString(mtime, "durable session mtime");
    const parsed = Date.parse(mtime);
    mtimeKey = Number.isFinite(parsed) ? `T:${new Date(parsed).toISOString()}` : `S:${mtime}`;
  }
  const activity = pick(value, "activity_sha256", "activitySha256", "activity_digest", "activityDigest", "activity");
  assert(activity !== undefined && activity !== null, "durable session activity is required");
  const activitySha = SHA.test(String(activity)) && typeof activity === "string" ? activity : canonicalDigest(activity);
  return {
    session_id: sessionId,
    ordinal,
    mtime: typeof mtime === "number" ? mtime : mtime,
    mtime_key: mtimeKey,
    activity_sha256: activitySha,
  };
}

function sourceHasMaterialEntries(entries) {
  return entries.some((entry) => entry?.material !== false && entry?.empty !== true && entry?.status !== "EMPTY");
}

function sourceHasLiveEntries(entries) {
  return entries.some((entry) => {
    const status = typeof entry?.status === "string" ? entry.status.toUpperCase() : "";
    return entry?.active !== false && entry?.revoked !== true && entry?.expired !== true && !["EXITED", "TERMINATED", "STOPPED", "COMPLETED", "CLOSED", "RELEASED"].includes(status);
  });
}

function normalizePriorSourceState(previous) {
  if (!isRecord(previous)) return null;
  const state = previous.source_state ?? previous.sourceState ?? previous.sources;
  if (!isRecord(state)) return null;
  const sourceState = state.source_state ?? state.sourceState ?? state;
  return isRecord(sourceState) ? sourceState : null;
}

function requirePriorObservationReference(previousObservation, {taskId, laneId} = {}) {
  if (!isRecord(previousObservation)
    || previousObservation.task_id !== taskId
    || previousObservation.lane_id !== laneId
    || normalizePriorSourceState(previousObservation) === null) {
    const error = new Error("same-task prior observation is required before retry or stall classification");
    error.code = "MATERIAL_LIVENESS_PRIOR_OBSERVATION_REQUIRED";
    throw error;
  }
  try {
    validateSchedulerProjectionLivenessObservation(previousObservation);
  } catch (cause) {
    const error = new Error(`same-task prior observation is not content-bound: ${cause.message}`);
    error.code = "MATERIAL_LIVENESS_PRIOR_OBSERVATION_INVALID";
    throw error;
  }
}

function requirePriorSameTaskObservation(previousObservation, {taskId, laneId, recoveryAttempt, maxRecoveryAttempts} = {}) {
  if (recoveryAttempt === 0) return;
  if (!isRecord(previousObservation)
    || previousObservation.task_id !== taskId
    || previousObservation.lane_id !== laneId
    || normalizePriorSourceState(previousObservation) === null) {
    requirePriorObservationReference(previousObservation, {taskId, laneId});
  }
  if (!Number.isSafeInteger(previousObservation.recovery?.attempt)
    || previousObservation.recovery.attempt !== recoveryAttempt - 1
    || previousObservation.recovery.maximum_attempts !== maxRecoveryAttempts) {
    const error = new Error("same-task prior observation must precede the requested recovery attempt");
    error.code = "MATERIAL_LIVENESS_PRIOR_OBSERVATION_ORDER_INVALID";
    throw error;
  }
  requirePriorObservationReference(previousObservation, {taskId, laneId});
}

function compareMtimeKey(left, right) {
  if (left === right) return 0;
  const leftNumber = typeof left === "string" && left.startsWith("N:") ? Number(left.slice(2)) : null;
  const rightNumber = typeof right === "string" && right.startsWith("N:") ? Number(right.slice(2)) : null;
  if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
  return String(left).localeCompare(String(right));
}

function materialLivenessEvidenceDigest({projection, durableSession, receipts, results, processes, leases} = {}) {
  return canonicalDigest({
    projection,
    durable_session: durableSession,
    receipts,
    results,
    processes,
    leases,
  });
}

/**
 * Triangulate an app projection with independent durable/session, receipt,
 * process, and lease observations.  This function is read-only: it returns a
 * typed decision and never starts, stops, replaces, or mutates a task.
 */
export function compileSchedulerProjectionLivenessObservation({
  taskId,
  laneId,
  projection,
  durableSession,
  receipts = [],
  results = [],
  processes = [],
  leases = [],
  previousObservation = null,
  recoveryAttempt = 0,
  maxRecoveryAttempts = 1,
  escalationLedger = null,
  observedAtUtc = new Date().toISOString(),
} = {}) {
  id(taskId, "scheduler liveness task ID");
  id(laneId, "scheduler liveness lane ID");
  requireRecord(projection, "scheduler app task projection");
  const projectionItems = projection.items === undefined ? [] : projection.items;
  assert(Array.isArray(projectionItems), "scheduler app task projection items must be an array");
  const projectionStatus = pick(projection, "status", "turn_status") ?? "UNKNOWN";
  requireString(projectionStatus, "scheduler app task projection status");
  const projectionCount = projection.items_count === undefined ? projectionItems.length : projection.items_count;
  count(projectionCount, "scheduler projected item count");
  assert(projectionCount === projectionItems.length, "scheduler projected item count diverges from items");
  const normalizedProjection = {status: projectionStatus, items: clone(projectionItems), items_count: projectionCount, source: pick(projection, "source", "api", "source_api") ?? "APP_TASK_PROJECTION"};
  const normalizedDurable = normalizeDurableSessionObservation(durableSession);
  const normalizedReceipts = normalizeObservationArray(receipts, "typed receipt observations");
  const normalizedResults = normalizeObservationArray(results, "Scheduler result observations");
  const normalizedProcesses = normalizeObservationArray(processes, "relevant process observations");
  const normalizedLeases = normalizeObservationArray(leases, "active lease observations");
  count(recoveryAttempt, "same-task recovery attempt");
  count(maxRecoveryAttempts, "maximum same-task recovery attempts");
  assert(maxRecoveryAttempts >= 1, "same-task recovery must have a positive bounded maximum");
  assert(recoveryAttempt <= maxRecoveryAttempts, "same-task recovery attempt exceeds its bounded maximum");
  validUtcInstant(observedAtUtc, "scheduler liveness observation time");
  requirePriorSameTaskObservation(previousObservation, {taskId, laneId, recoveryAttempt, maxRecoveryAttempts});
  if (recoveryAttempt === 0 && isRecord(previousObservation)) requirePriorObservationReference(previousObservation, {taskId, laneId});

  const sourceState = {
    app_projection_sha256: canonicalDigest(normalizedProjection),
    durable_session_sha256: canonicalDigest(normalizedDurable),
    durable_session_id: normalizedDurable.session_id,
    durable_ordinal: normalizedDurable.ordinal,
    durable_mtime_key: normalizedDurable.mtime_key,
    durable_activity_sha256: normalizedDurable.activity_sha256,
    receipts_sha256: canonicalDigest(normalizedReceipts),
    results_sha256: canonicalDigest(normalizedResults),
    processes_sha256: canonicalDigest(normalizedProcesses),
    leases_sha256: canonicalDigest(normalizedLeases),
  };
  sourceState.source_state_sha256 = canonicalDigest({...sourceState, source_state_sha256: null});
  const previousState = normalizePriorSourceState(previousObservation);
  const durableOrdinalAdvanced = previousState !== null && normalizedDurable.ordinal > previousState.durable_ordinal;
  const durableMtimeAdvanced = previousState !== null && compareMtimeKey(normalizedDurable.mtime_key, previousState.durable_mtime_key) > 0;
  const durableActivityAdvanced = previousState !== null && normalizedDurable.activity_sha256 !== previousState.durable_activity_sha256;
  const receiptsAdvanced = previousState !== null && sourceState.receipts_sha256 !== previousState.receipts_sha256 && sourceHasMaterialEntries(normalizedReceipts);
  const resultsAdvanced = previousState !== null && sourceState.results_sha256 !== previousState.results_sha256 && sourceHasMaterialEntries(normalizedResults);
  const processLive = sourceHasLiveEntries(normalizedProcesses);
  const leaseLive = sourceHasLiveEntries(normalizedLeases);
  const materialReceipt = sourceHasMaterialEntries(normalizedReceipts);
  const materialResult = sourceHasMaterialEntries(normalizedResults);
  const advancing = durableOrdinalAdvanced || durableMtimeAdvanced || durableActivityAdvanced || receiptsAdvanced || resultsAdvanced;
  const live = processLive || leaseLive;
  const projectedEmpty = normalizedProjection.items.length === 0;
  let classification;
  let action;
  let stalled = false;
  let sameTaskRecovery = false;
  let escalation = null;
  if (!projectedEmpty) {
    classification = MATERIAL_LIVENESS_ACTIVE;
    action = "CONTINUE_MONITORING";
  } else if ((previousState === null && recoveryAttempt === 0) || advancing || materialReceipt || materialResult || live) {
    classification = ACTIVE_OR_PROJECTION_LAG;
    action = previousState === null && recoveryAttempt === 0 ? "REQUIRE_SAME_TASK_READBACK_BEFORE_STALL" : "CONTINUE_SAME_TASK_AND_RECHECK_PROJECTION";
  } else if (recoveryAttempt < maxRecoveryAttempts) {
    classification = SAME_TASK_RECOVERY_REQUIRED;
    action = "RECOVER_SAME_TASK_ONCE";
    sameTaskRecovery = true;
  } else {
    classification = MATERIAL_LIVENESS_STAGNANT;
    action = "ESCALATE_ONCE_AFTER_BOUNDED_SAME_TASK_RECOVERY";
    stalled = true;
    const escalationKey = canonicalDigest({task_id: taskId, lane_id: laneId, source_state_sha256: sourceState.source_state_sha256, recovery_attempt: recoveryAttempt});
    assert(isRecord(escalationLedger), "material liveness escalation ledger is required");
    const keys = escalationLedger.keys ?? escalationLedger.escalation_keys;
    assert(Array.isArray(keys), "material liveness escalation ledger keys must be an array");
    const duplicate = keys.includes(escalationKey);
    if (!duplicate) { keys.push(escalationKey); keys.sort(); }
    escalation = {
      schema: "agentos.material_liveness_escalation.v1",
      classification: TYPED_HOST_CAPABILITY_ESCALATION,
      task_id: taskId,
      lane_id: laneId,
      key: escalationKey,
      duplicate,
      emitted: !duplicate,
      reason: "ALL_TRIANGULATED_SOURCES_STAGNANT_AFTER_BOUNDED_SAME_TASK_RECOVERY",
      evidence_sha256: sourceState.source_state_sha256,
    };
  }
  const receipt = {
    schema: SCHEDULER_PROJECTION_LIVENESS_SCHEMA,
    version: 1,
    task_id: taskId,
    lane_id: laneId,
    observed_at_utc: observedAtUtc,
    projection: normalizedProjection,
    sources: {
      durable_session: normalizedDurable,
      receipts: normalizedReceipts,
      results: normalizedResults,
      processes: normalizedProcesses,
      leases: normalizedLeases,
    },
    source_state: sourceState,
    signals: {
      projected_empty: projectedEmpty,
      durable_ordinal_advanced: durableOrdinalAdvanced,
      durable_mtime_advanced: durableMtimeAdvanced,
      durable_activity_advanced: durableActivityAdvanced,
      material_receipt: materialReceipt,
      material_result: materialResult,
      receipts_advanced: receiptsAdvanced,
      results_advanced: resultsAdvanced,
      live_process: processLive,
      active_lease: leaseLive,
    },
    recovery: {attempt: recoveryAttempt, maximum_attempts: maxRecoveryAttempts, bounded: true, same_task_only: true},
    prior_observation: isRecord(previousObservation) ? clone(previousObservation) : null,
    prior_observation_sha256: isRecord(previousObservation) ? previousObservation.receipt_sha256 : null,
    classification,
    status: classification,
    action,
    stalled,
    same_task_recovery_required: sameTaskRecovery,
    replacement_allowed: false,
    escalation,
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = digestBody(receipt, "receipt_sha256");
  return receipt;
}

export function validateSchedulerProjectionLivenessObservation(receipt) {
  requireRecord(receipt, "scheduler projection/liveness observation");
  assert(receipt.schema === SCHEDULER_PROJECTION_LIVENESS_SCHEMA && receipt.version === 1, "scheduler projection/liveness schema mismatch");
  id(receipt.task_id, "scheduler projection/liveness task ID");
  id(receipt.lane_id, "scheduler projection/liveness lane ID");
  validUtcInstant(receipt.observed_at_utc, "scheduler projection/liveness observation time");
  requireRecord(receipt.projection, "scheduler projection/liveness app projection");
  assert(Array.isArray(receipt.projection.items), "scheduler projection/liveness app items must be an array");
  count(receipt.projection.items_count, "scheduler projection/liveness app item count");
  assert(receipt.projection.items_count === receipt.projection.items.length, "scheduler projection/liveness app item count diverges");
  requireRecord(receipt.sources, "scheduler projection/liveness sources");
  const durable = normalizeDurableSessionObservation(receipt.sources.durable_session);
  const receipts = normalizeObservationArray(receipt.sources.receipts, "scheduler projection/liveness receipts");
  const results = normalizeObservationArray(receipt.sources.results, "scheduler projection/liveness results");
  const processes = normalizeObservationArray(receipt.sources.processes, "scheduler projection/liveness processes");
  const leases = normalizeObservationArray(receipt.sources.leases, "scheduler projection/liveness leases");
  requireRecord(receipt.source_state, "scheduler projection/liveness source state");
  const expectedState = {
    app_projection_sha256: canonicalDigest(receipt.projection),
    durable_session_sha256: canonicalDigest(durable),
    durable_session_id: durable.session_id,
    durable_ordinal: durable.ordinal,
    durable_mtime_key: durable.mtime_key,
    durable_activity_sha256: durable.activity_sha256,
    receipts_sha256: canonicalDigest(receipts),
    results_sha256: canonicalDigest(results),
    processes_sha256: canonicalDigest(processes),
    leases_sha256: canonicalDigest(leases),
  };
  expectedState.source_state_sha256 = canonicalDigest({...expectedState, source_state_sha256: null});
  assert(receipt.source_state.source_state_sha256 === expectedState.source_state_sha256, "scheduler projection/liveness source state digest mismatch");
  for (const key of Object.keys(expectedState)) assert(receipt.source_state[key] === expectedState[key], `scheduler projection/liveness source state ${key} mismatch`);
  requireRecord(receipt.recovery, "scheduler projection/liveness recovery bounds");
  count(receipt.recovery.attempt, "scheduler projection/liveness recovery attempt");
  count(receipt.recovery.maximum_attempts, "scheduler projection/liveness maximum recovery attempts");
  assert(receipt.recovery.bounded === true && receipt.recovery.same_task_only === true, "scheduler recovery must remain bounded and same-task");
  if (receipt.recovery.attempt > 0) {
    assert(isRecord(receipt.prior_observation), "same-task prior observation is required before retry or stall classification");
    sha(receipt.prior_observation_sha256, "scheduler prior observation receipt digest");
    assert(receipt.prior_observation_sha256 === receipt.prior_observation.receipt_sha256, "scheduler prior observation digest binding mismatch");
    requirePriorSameTaskObservation(receipt.prior_observation, {
      taskId: receipt.task_id,
      laneId: receipt.lane_id,
      recoveryAttempt: receipt.recovery.attempt,
      maxRecoveryAttempts: receipt.recovery.maximum_attempts,
    });
  } else {
    if (receipt.prior_observation !== null && receipt.prior_observation !== undefined) {
      sha(receipt.prior_observation_sha256, "scheduler prior observation receipt digest");
      assert(receipt.prior_observation_sha256 === receipt.prior_observation.receipt_sha256, "scheduler prior observation digest binding mismatch");
      requirePriorObservationReference(receipt.prior_observation, {taskId: receipt.task_id, laneId: receipt.lane_id});
    } else if (Object.prototype.hasOwnProperty.call(receipt, "prior_observation_sha256")) {
      assert(receipt.prior_observation_sha256 === null, "initial liveness observation cannot carry a prior observation digest");
    }
  }
  assert([ACTIVE_OR_PROJECTION_LAG, MATERIAL_LIVENESS_ACTIVE, SAME_TASK_RECOVERY_REQUIRED, MATERIAL_LIVENESS_STAGNANT].includes(receipt.classification), "scheduler projection/liveness classification is invalid");
  assert(receipt.status === receipt.classification, "scheduler projection/liveness status diverges from classification");
  assert(receipt.replacement_allowed === false, "projection/liveness observation cannot authorize replacement");
  assert(receipt.stalled === (receipt.classification === MATERIAL_LIVENESS_STAGNANT), "projection/liveness stall flag is inconsistent");
  requireRecord(receipt.signals, "scheduler projection/liveness source signals");
  const expectedSignals = {
    projected_empty: receipt.projection.items.length === 0,
    material_receipt: sourceHasMaterialEntries(receipts),
    material_result: sourceHasMaterialEntries(results),
    live_process: sourceHasLiveEntries(processes),
    active_lease: sourceHasLiveEntries(leases),
  };
  for (const [key, value] of Object.entries(expectedSignals)) assert(receipt.signals[key] === value, `scheduler projection/liveness signal ${key} mismatch`);
  const previousState = normalizePriorSourceState(receipt.prior_observation);
  const expectedAdvancementSignals = {
    durable_ordinal_advanced: previousState !== null && durable.ordinal > previousState.durable_ordinal,
    durable_mtime_advanced: previousState !== null && compareMtimeKey(durable.mtime_key, previousState.durable_mtime_key) > 0,
    durable_activity_advanced: previousState !== null && durable.activity_sha256 !== previousState.durable_activity_sha256,
    receipts_advanced: previousState !== null && expectedState.receipts_sha256 !== previousState.receipts_sha256 && expectedSignals.material_receipt,
    results_advanced: previousState !== null && expectedState.results_sha256 !== previousState.results_sha256 && expectedSignals.material_result,
  };
  for (const [key, value] of Object.entries(expectedAdvancementSignals)) assert(receipt.signals[key] === value, `scheduler projection/liveness derived signal ${key} mismatch`);
  const hasIndependentSignal = receipt.signals.durable_ordinal_advanced === true || receipt.signals.durable_mtime_advanced === true || receipt.signals.durable_activity_advanced === true || receipt.signals.receipts_advanced === true || receipt.signals.results_advanced === true || expectedSignals.material_receipt || expectedSignals.material_result || expectedSignals.live_process || expectedSignals.active_lease;
  if (receipt.projection.items.length === 0 && hasIndependentSignal) assert(receipt.classification === ACTIVE_OR_PROJECTION_LAG && receipt.stalled === false, "independent material/liveness evidence must remain active or lagging");
  if (receipt.classification === ACTIVE_OR_PROJECTION_LAG) assert(receipt.projection.items.length === 0 && receipt.stalled === false, "projection lag classification must remain non-stalled");
  if (receipt.classification === SAME_TASK_RECOVERY_REQUIRED) assert(receipt.recovery.attempt < receipt.recovery.maximum_attempts && !hasIndependentSignal, "same-task recovery is only for a stagnant bounded observation");
  if (receipt.classification === MATERIAL_LIVENESS_STAGNANT) {
    assert(receipt.recovery.attempt >= receipt.recovery.maximum_attempts && !hasIndependentSignal, "stagnant liveness requires exhausted recovery and no independent progress");
    assert(receipt.escalation?.classification === TYPED_HOST_CAPABILITY_ESCALATION, "stagnant liveness must retain typed escalation");
    const expectedKey = canonicalDigest({task_id: receipt.task_id, lane_id: receipt.lane_id, source_state_sha256: receipt.source_state.source_state_sha256, recovery_attempt: receipt.recovery.attempt});
    assert(receipt.escalation.key === expectedKey && receipt.escalation.evidence_sha256 === receipt.source_state.source_state_sha256, "stagnant liveness escalation is not source-bound");
  }
  sha(receipt.receipt_sha256, "scheduler projection/liveness receipt digest");
  assert(receipt.receipt_sha256 === digestBody(receipt, "receipt_sha256"), "scheduler projection/liveness receipt digest mismatch");
  return receipt;
}

export const compileProjectionLivenessObservation = compileSchedulerProjectionLivenessObservation;
export const validateProjectionLivenessObservation = validateSchedulerProjectionLivenessObservation;
export const compileSchedulerProjectionLiveness = compileSchedulerProjectionLivenessObservation;
export const validateSchedulerProjectionLiveness = validateSchedulerProjectionLivenessObservation;
export const createSchedulerProjectionLivenessObservation = compileSchedulerProjectionLivenessObservation;

export function createMaterialLivenessEscalationLedger() {
  return {schema: "agentos.material_liveness_escalation_ledger.v1", keys: []};
}

export function deduplicateMaterialLivenessEscalation({escalation, ledger} = {}) {
  requireRecord(escalation, "material liveness escalation");
  id(escalation.task_id, "material liveness escalation task ID");
  id(escalation.lane_id, "material liveness escalation lane ID");
  sha(escalation.evidence_sha256, "material liveness escalation evidence digest");
  requireString(escalation.key, "material liveness escalation key");
  assert(isRecord(ledger) && Array.isArray(ledger.keys), "material liveness escalation ledger is required");
  const duplicate = ledger.keys.includes(escalation.key);
  if (!duplicate) { ledger.keys.push(escalation.key); ledger.keys.sort(); }
  return {...clone(escalation), duplicate, emitted: !duplicate};
}

export const ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA = "agentos.zero_output_session_replacement.v1";
export const ZERO_OUTPUT_MINIMUM_ELAPSED_SECONDS = 30;
export const PERMANENT_SESSION_ROLLOVER_SCHEMA = "agentos.permanent_session_rollover.v1";
export const PERMANENT_SESSION_ROLLOVER_ADMITTED = "ROLLOVER_ADMITTED";
export const PERMANENT_SESSION_ROLLOVER_REJECTED = "ROLLOVER_REJECTED";

const SHA = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
function assert(condition, message) { if (!condition) throw new Error(message); }
function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function sha(value, label) { assert(typeof value === "string" && SHA.test(value), `${label} must be SHA-256`); }
function count(value, label) { assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`); }
function utcMillis(value, label) {
  assert(typeof value === "string" && UTC.test(value), `${label} must be UTC`);
  const millis = Date.parse(value);
  const canonicalInput = value.includes(".") ? value : value.replace(/Z$/u, ".000Z");
  assert(Number.isFinite(millis) && new Date(millis).toISOString() === canonicalInput, `${label} is not a valid UTC instant`);
  return millis;
}
function validateTurn(turn) {
  assert(turn && typeof turn === "object", "turn observation is required");
  assert(turn.status === "COMPLETED" && turn.error === null, "only a completed non-error turn may be classified as silent");
  count(turn.elapsed_seconds, "turn elapsed seconds");
  assert(turn.elapsed_seconds >= ZERO_OUTPUT_MINIMUM_ELAPSED_SECONDS, "turn is below the zero-output observation floor");
  for (const field of ["assistant_items", "tool_items", "command_items", "durable_result_items", "live_process_count"]) count(turn[field], `turn ${field}`);
  assert(turn.assistant_items + turn.tool_items + turn.command_items + turn.durable_result_items === 0, "turn contains material output and may not be replaced as silent");
  assert(turn.live_process_count === 0, "session still has a live process");
  sha(turn.turn_readback_sha256, "turn readback digest");
  assert(turn.turn_readback_sha256 === canonicalDigest({...turn, turn_readback_sha256: null}), "turn readback digest does not bind the observation");
  return turn;
}
function validateCustody(custody) {
  assert(custody && typeof custody === "object", "custody is required");
  for (const field of ["worktree_ref", "branch_ref"]) id(custody[field], `custody ${field}`);
  for (const field of ["head", "tree", "status_sha256", "handoff_sha256"]) sha(custody[field], `custody ${field}`);
  assert(custody.preserved === true && custody.reset_or_cleanup === false, "custody must be preserved without reset or cleanup");
  return custody;
}
function validateReplacement(replacement, {failedSessionId, pairedSessionId, custody, evaluatedAtUtc}) {
  assert(replacement && typeof replacement === "object", "replacement probe is required");
  for (const field of ["session_id", "project_ref", "cwd_ref", "worktree_ref"]) id(replacement[field], `replacement ${field}`);
  assert(replacement.session_id !== failedSessionId && replacement.session_id !== pairedSessionId, "replacement identity collides with the pair");
  assert(replacement.project_bound === true && replacement.cwd_verified === true, "replacement must be project-bound with verified cwd");
  const observedMillis = utcMillis(replacement.observed_at_utc, "replacement observation");
  const evaluatedMillis = utcMillis(evaluatedAtUtc, "replacement evaluation");
  assert(evaluatedMillis >= observedMillis, "replacement observation is in the future");
  count(replacement.freshness_seconds, "replacement freshness seconds");
  assert(replacement.freshness_seconds === Math.floor((evaluatedMillis - observedMillis) / 1000), "replacement freshness is not bound to observation and evaluation time");
  assert(replacement.freshness_seconds <= 300, "replacement execution proof is stale");
  count(replacement.visible_assistant_items, "replacement visible assistant items");
  count(replacement.visible_tool_items, "replacement visible tool items");
  assert(replacement.visible_assistant_items + replacement.visible_tool_items > 0, "replacement visible-execution probe failed");
  assert(replacement.worktree_ref === custody.worktree_ref, "replacement worktree does not match preserved custody");
  assert(replacement.same_worktree === true && replacement.custody_mutated === false, "replacement must adopt preserved custody without mutation");
  sha(replacement.probe_readback_sha256, "replacement probe digest");
  assert(replacement.probe_readback_sha256 === canonicalDigest({...replacement, probe_readback_sha256: null}), "replacement probe digest does not bind project/cwd/worktree evidence");
  return replacement;
}

export function compileZeroOutputSessionReplacement({
  replacementId,
  laneId,
  role,
  failedSessionId,
  pairedSessionId,
  turn,
  custody,
  replacement,
  evaluatedAtUtc,
  unrelatedLanesContinue = true,
} = {}) {
  for (const [value, label] of [[replacementId, "replacement ID"], [laneId, "lane ID"], [role, "role"], [failedSessionId, "failed session ID"], [pairedSessionId, "paired session ID"]]) id(value, label);
  assert(replacementId !== failedSessionId && replacementId !== pairedSessionId, "replacement operation identity collides with the pair");
  validateTurn(turn);
  validateCustody(custody);
  utcMillis(evaluatedAtUtc, "replacement evaluation");
  validateReplacement(replacement, {failedSessionId, pairedSessionId, custody, evaluatedAtUtc});
  assert(unrelatedLanesContinue === true, "one silent session may not stop unrelated lanes");

  const decision = {
    schema: ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA,
    version: 1,
    replacement_id: replacementId,
    lane_id: laneId,
    role,
    failed_session_id: failedSessionId,
    paired_session_id: pairedSessionId,
    classification: "HOST_SESSION_ZERO_OUTPUT",
    action: "ADMIT_VISIBLE_REPLACEMENT_AND_ARCHIVE_FAILED_SESSION",
    controller_approval_required: false,
    ordinary_pair_autonomy_preserved: true,
    unrelated_lanes_continue: true,
    retry_same_session: false,
    evaluated_at_utc: evaluatedAtUtc,
    turn: structuredClone(turn),
    custody: structuredClone(custody),
    replacement: structuredClone(replacement),
    decision_sha256: null,
  };
  decision.decision_sha256 = canonicalDigest({...decision, decision_sha256: null});
  return decision;
}

export function validateZeroOutputSessionReplacement(decision) {
  assert(decision?.schema === ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA && decision.version === 1, "replacement decision schema mismatch");
  assert(decision.classification === "HOST_SESSION_ZERO_OUTPUT", "replacement classification mismatch");
  assert(decision.action === "ADMIT_VISIBLE_REPLACEMENT_AND_ARCHIVE_FAILED_SESSION", "replacement action mismatch");
  assert(decision.controller_approval_required === false && decision.ordinary_pair_autonomy_preserved === true, "replacement added an approval gate or removed autonomy");
  assert(decision.unrelated_lanes_continue === true && decision.retry_same_session === false, "replacement may not stall other lanes or retry the failed session");
  id(decision.replacement_id, "replacement ID");
  id(decision.failed_session_id, "failed session ID");
  id(decision.paired_session_id, "paired session ID");
  assert(decision.replacement_id !== decision.failed_session_id && decision.replacement_id !== decision.paired_session_id, "replacement operation identity collides with the pair");
  validateTurn(decision.turn);
  validateCustody(decision.custody);
  utcMillis(decision.evaluated_at_utc, "replacement evaluation");
  validateReplacement(decision.replacement, {failedSessionId: decision.failed_session_id, pairedSessionId: decision.paired_session_id, custody: decision.custody, evaluatedAtUtc: decision.evaluated_at_utc});
  sha(decision.decision_sha256, "replacement decision digest");
  assert(decision.decision_sha256 === canonicalDigest({...decision, decision_sha256: null}), "replacement decision digest mismatch");
  return decision;
}

function rolloverRecord(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} is required`);
  return value;
}

function rolloverIdentifier(value, label) {
  id(value, label);
  return value;
}

function rolloverDigest(value, label) {
  sha(value, label);
  return value;
}

function stateOwned(value, label) {
  rolloverRecord(value, label);
  assert(value.state_owned === true || value.state_owned === "AGENTOS_STATE" || value.stateOwned === true || value.stateOwned === "AGENTOS_STATE" || value.owner === "AGENTOS_STATE" || value.owner_scope === "AGENTOS_STATE" || value.state_owner === "AGENTOS_STATE", `${label} must be owned by durable AgentOS State`);
  return value;
}

function entryIdentity(entry, keys) {
  if (!entry || typeof entry !== "object") return null;
  for (const key of keys) if (entry[key] !== undefined && entry[key] !== null) return String(entry[key]);
  return null;
}

/**
 * Admit exactly one permanent-task session successor at a clean stopping
 * point.  The old session and every continuity record remain retained; this
 * pure compiler never starts a task, timer, or Scheduler job.
 */
export function compilePermanentSessionRollover({
  taskId,
  task_id,
  roleId,
  role_id,
  oldSession,
  old_session,
  successorSession,
  successor_session,
  queue,
  state_queue,
  custody,
  state_custody,
  incident,
  state_incident,
  stoppingPoint,
  stopping_point,
  existingSessions = [],
  existing_sessions,
  existingRoles = [],
  existing_roles,
  existingTimers = [],
  existing_timers,
  existingJobs = [],
  existing_jobs,
  evaluatedAtUtc = new Date().toISOString(),
  evaluated_at_utc,
} = {}) {
  taskId = taskId ?? task_id;
  roleId = roleId ?? role_id;
  oldSession = oldSession ?? old_session;
  successorSession = successorSession ?? successor_session;
  queue = queue ?? state_queue;
  custody = custody ?? state_custody;
  incident = incident ?? state_incident;
  stoppingPoint = stoppingPoint ?? stopping_point;
  existingSessions = existing_sessions ?? existingSessions;
  existingRoles = existing_roles ?? existingRoles;
  existingTimers = existing_timers ?? existingTimers;
  existingJobs = existing_jobs ?? existingJobs;
  evaluatedAtUtc = evaluated_at_utc ?? evaluatedAtUtc;
  rolloverIdentifier(taskId, "rollover task ID");
  rolloverIdentifier(roleId, "rollover permanent role ID");
  rolloverRecord(oldSession, "old permanent session");
  rolloverRecord(successorSession, "successor permanent session");
  const oldId = rolloverIdentifier(oldSession.session_id ?? oldSession.id, "old permanent session ID");
  const successorId = rolloverIdentifier(successorSession.session_id ?? successorSession.id, "successor permanent session ID");
  assert(oldId !== successorId, "successor session must have a distinct identity");
  assert(oldSession.task_id === undefined || oldSession.task_id === taskId, "old session task identity mismatch");
  assert(successorSession.task_id === undefined || successorSession.task_id === taskId, "successor session task identity mismatch");
  assert(oldSession.retained !== false && oldSession.archived !== true, "old permanent session must remain retained");
  assert(["CLEAN", "CLEAN_STOPPING_POINT", "STOPPED", "CHECKPOINT_REACHED", "COMPLETED"].includes(String(oldSession.status ?? oldSession.lifecycle ?? "CLEAN_STOPPING_POINT").toUpperCase()), "old session is not at a clean stopping point");
  assert(successorSession.successor === true || successorSession.role_id === undefined || successorSession.role_id === roleId, "successor role binding is invalid");
  assert(Array.isArray(existingSessions), "existing permanent sessions must be an array");
  assert(Array.isArray(existingRoles), "existing permanent roles must be an array");
  assert(Array.isArray(existingTimers), "existing permanent timers must be an array");
  assert(Array.isArray(existingJobs), "existing Scheduler jobs must be an array");
  const sessions = existingSessions;
  const duplicateSession = sessions.some((entry) => entryIdentity(entry, ["session_id", "sessionId", "id"]) === successorId);
  assert(!duplicateSession, "duplicate permanent successor session is forbidden");
  const parallelSuccessor = sessions.some((entry) => entryIdentity(entry, ["task_id", "taskId"]) === taskId && entryIdentity(entry, ["session_id", "sessionId", "id"]) !== oldId && (entry.successor === true || entry.permanent === true || entry.role_id !== undefined || entry.roleId !== undefined));
  assert(!parallelSuccessor, "a task may not have more than one permanent successor");
  const roles = existingRoles;
  const timers = existingTimers;
  const jobs = existingJobs;
  const successorRole = entryIdentity(successorSession, ["role_id", "roleId", "role"]);
  if (successorRole) assert(!roles.some((entry) => entryIdentity(entry, ["role_id", "roleId", "role"]) === successorRole), "duplicate permanent role is forbidden");
  const successorTimer = entryIdentity(successorSession, ["timer_id", "timerId"]);
  if (successorTimer) assert(!timers.some((entry) => entryIdentity(entry, ["timer_id", "timerId"]) === successorTimer), "duplicate permanent timer is forbidden");
  const successorJob = entryIdentity(successorSession, ["job_id", "jobId", "scheduler_job_id", "schedulerJobId"]);
  if (successorJob) assert(!jobs.some((entry) => entryIdentity(entry, ["job_id", "jobId", "scheduler_job_id", "schedulerJobId"]) === successorJob), "duplicate Scheduler job is forbidden");
  assert(!Array.isArray(queue) && !Array.isArray(custody) && !Array.isArray(incident) && !Array.isArray(stoppingPoint), "rollover continuity records must be objects");
  stateOwned(queue, "rollover queue");
  stateOwned(custody, "rollover custody");
  stateOwned(incident, "rollover incident");
  stateOwned(stoppingPoint, "rollover stopping point");
  assert(stoppingPoint.clean === true || stoppingPoint.complete === true || stoppingPoint.clean_stopping_point === true || stoppingPoint.status === "CLEAN_STOPPING_POINT", "rollover requires a clean stopping point");
  for (const [value, label] of [[queue.queue_sha256 ?? queue.queue_digest_sha256 ?? queue.digest_sha256 ?? queue.sha256, "rollover queue digest"], [custody.custody_sha256 ?? custody.custody_digest_sha256 ?? custody.digest_sha256 ?? custody.sha256, "rollover custody digest"], [incident.incident_sha256 ?? incident.incident_digest_sha256 ?? incident.digest_sha256 ?? incident.sha256, "rollover incident digest"], [stoppingPoint.stopping_point_sha256 ?? stoppingPoint.stopping_point_digest_sha256 ?? stoppingPoint.digest_sha256 ?? stoppingPoint.sha256, "rollover stopping-point digest"]]) rolloverDigest(value, label);
  assert(queue.chat_history_owned !== true && custody.chat_history_owned !== true && incident.chat_history_owned !== true && stoppingPoint.chat_history_owned !== true, "chat-history-owned rollover continuity is forbidden");
  assert(typeof evaluatedAtUtc === "string" && Number.isFinite(Date.parse(evaluatedAtUtc)), "rollover evaluation time must be UTC");
  const decision = {
    schema: PERMANENT_SESSION_ROLLOVER_SCHEMA,
    version: 1,
    status: PERMANENT_SESSION_ROLLOVER_ADMITTED,
    task_id: taskId,
    role_id: roleId,
    supersedes_session_id: oldId,
    successor_session_id: successorId,
    old_session: {...oldSession, session_id: oldId},
    successor_session: {...successorSession, session_id: successorId},
    continuity: {queue: structuredClone(queue), custody: structuredClone(custody), incident: structuredClone(incident), stopping_point: structuredClone(stoppingPoint), owner: "AGENTOS_STATE"},
    retained_old_session: true,
    exactly_one_successor: true,
    duplicate_role_denied: true,
    duplicate_timer_denied: true,
    duplicate_scheduler_job_denied: true,
    chat_history_owned_state_denied: true,
    evaluated_at_utc: evaluatedAtUtc,
    rollover_sha256: null,
  };
  decision.rollover_sha256 = canonicalDigest({...decision, rollover_sha256: null});
  return decision;
}

export function validatePermanentSessionRollover(decision) {
  rolloverRecord(decision, "permanent session rollover decision");
  assert(decision.schema === PERMANENT_SESSION_ROLLOVER_SCHEMA && decision.version === 1, "permanent session rollover schema mismatch");
  assert(decision.status === PERMANENT_SESSION_ROLLOVER_ADMITTED, "permanent session rollover is not admitted");
  rolloverIdentifier(decision.task_id, "rollover task ID");
  rolloverIdentifier(decision.role_id, "rollover role ID");
  rolloverRecord(decision.old_session, "rollover old session");
  rolloverRecord(decision.successor_session, "rollover successor session");
  assert(decision.supersedes_session_id === (decision.old_session.session_id ?? decision.old_session.id), "rollover supersedes linkage is invalid");
  assert(decision.successor_session_id === (decision.successor_session.session_id ?? decision.successor_session.id), "rollover successor linkage is invalid");
  assert(decision.retained_old_session === true && decision.exactly_one_successor === true, "rollover cardinality/retention is invalid");
  assert(decision.duplicate_role_denied === true && decision.duplicate_timer_denied === true && decision.duplicate_scheduler_job_denied === true && decision.chat_history_owned_state_denied === true, "rollover denial invariants are missing");
  stateOwned(decision.continuity?.queue, "rollover queue");
  stateOwned(decision.continuity?.custody, "rollover custody");
  stateOwned(decision.continuity?.incident, "rollover incident");
  stateOwned(decision.continuity?.stopping_point, "rollover stopping point");
  rolloverDigest(decision.rollover_sha256, "rollover digest");
  assert(decision.rollover_sha256 === canonicalDigest({...decision, rollover_sha256: null}), "permanent session rollover digest mismatch");
  return decision;
}

export const compilePermanentTaskSessionRollover = compilePermanentSessionRollover;
export const validatePermanentTaskSessionRollover = validatePermanentSessionRollover;
export const compilePermanentTaskSessionSuccessor = compilePermanentSessionRollover;
export const validatePermanentTaskSessionSuccessor = validatePermanentSessionRollover;
