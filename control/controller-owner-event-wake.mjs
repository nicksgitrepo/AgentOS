/* Generic direct-owner-event wake and same-turn Controller continuation contract. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const CONTROLLER_OWNER_EVENT_WAKE_SCHEMA = "agentos.controller_owner_event_wake.v1";
export const CONTROLLER_OWNER_EVENT_WAKE_VERSION = 1;
export const CONTROLLER_OWNER_EVENT_WAKE_MODE = "DIRECT_OWNER_EVENT_SAME_TURN";
export const CONTROLLER_OWNER_EVENT_TYPES = Object.freeze(["OWNER_RESUMPTION"]);
export const CONTROLLER_OWNER_EVENT_ACTIONS = Object.freeze([
  "START_ONE_BOUNDED_LOCAL_TRANSITION",
  "PERSIST_EVENT_DRIVEN_PROTECTED_CHECKPOINT",
]);
export const CONTROLLER_OWNER_EVENT_TRANSITION_KINDS = Object.freeze([
  "LOCAL_BLOCK_REPAIR",
  "AVAILABLE_WAVE",
  "PROTECTED_CHECKPOINT",
]);

const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DEPENDENCY_STATUSES = new Set(["PENDING_EXTERNAL_AUTHORITY", "OWNER_DECISION_REQUIRED", "PENDING_AUTHORITY"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtcTimestamp(value, label) {
  requireString(value, label);
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value), `${label} must be an UTC ISO timestamp`);
  assert(Number.isFinite(Date.parse(value)), `${label} is not a valid UTC timestamp`);
}

function sortedIdentifiers(values, label, {allowEmpty = true} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  values.forEach((value, index) => requireIdentifier(value, `${label} item ${index}`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted`);
  return values;
}

function normalizeIdentifiers(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const normalized = values.map((value, index) => {
    requireIdentifier(value, `${label} item ${index}`);
    return value;
  }).sort(compareUtf8);
  assert(new Set(normalized).size === normalized.length, `${label} contains duplicates`);
  return normalized;
}

function validateBoundReceipts(boundReceipts, currentBindings = null) {
  const fields = ["escalation_receipt_sha256", "projection_sha256", "owner_decision_sha256"];
  exactKeys(boundReceipts, fields, "Controller owner event bound receipts");
  for (const field of fields) requireSha(boundReceipts[field], `Controller owner event ${field}`);
  if (currentBindings !== null) {
    exactKeys(currentBindings, fields, "Controller owner event current bindings");
    for (const field of fields) {
      requireSha(currentBindings[field], `Controller owner event current ${field}`);
      assert(boundReceipts[field] === currentBindings[field], `Controller owner event ${field} does not match the current readback`);
    }
  }
}

function validateLocalWork(localWork) {
  exactKeys(localWork, ["pending_local_request_ids", "available_wave_ids", "activation_blocked_wave_ids", "wave_activation_allowed"], "Controller owner event local work");
  sortedIdentifiers(localWork.pending_local_request_ids, "Controller owner event pending local requests");
  sortedIdentifiers(localWork.available_wave_ids, "Controller owner event available waves");
  sortedIdentifiers(localWork.activation_blocked_wave_ids, "Controller owner event activation-blocked waves");
  assert(typeof localWork.wave_activation_allowed === "boolean", "Controller owner event wave activation flag is invalid");
  if (!localWork.wave_activation_allowed) assert(localWork.available_wave_ids.length === 0, "Controller owner event cannot expose an available wave while activation is held");
  if (localWork.wave_activation_allowed) assert(localWork.activation_blocked_wave_ids.length === 0, "Controller owner event cannot retain activation-blocked waves while activation is allowed");
}

function validateProtectedGate(protectedGate, localWork) {
  exactKeys(protectedGate, ["dependency_id", "status", "evidence_ceiling", "blocked_wave_ids", "clearance_receipt_sha256"], "Controller owner event protected gate");
  requireIdentifier(protectedGate.dependency_id, "Controller owner event dependency");
  assert(DEPENDENCY_STATUSES.has(protectedGate.status), "Controller owner event dependency status is invalid");
  requireString(protectedGate.evidence_ceiling, "Controller owner event evidence ceiling");
  sortedIdentifiers(protectedGate.blocked_wave_ids, "Controller owner event protected blocked waves");
  assert(JSON.stringify(protectedGate.blocked_wave_ids) === JSON.stringify(localWork.activation_blocked_wave_ids), "Controller owner event protected wave list is not bound to local work");
  assert(protectedGate.clearance_receipt_sha256 === null, "An owner resumption event cannot carry independent clearance");
}

function expectedTransitionKind(localWork) {
  if (localWork.pending_local_request_ids.length > 0) return "LOCAL_BLOCK_REPAIR";
  if (localWork.available_wave_ids.length > 0 && localWork.wave_activation_allowed) return "AVAILABLE_WAVE";
  return null;
}

function validateContinuation(continuation, event) {
  exactKeys(continuation, [
    "action", "transition_kind", "transition_id", "target_id", "same_turn", "event_driven_idle",
    "timer_wait_forbidden", "heartbeat_defer_forbidden", "transition_count", "admission", "activation",
  ], "Controller owner event continuation");
  assert(CONTROLLER_OWNER_EVENT_ACTIONS.includes(continuation.action), "Controller owner event action is invalid");
  assert(CONTROLLER_OWNER_EVENT_TRANSITION_KINDS.includes(continuation.transition_kind), "Controller owner event transition kind is invalid");
  assert(continuation.same_turn === true, "Controller owner event must continue in the same turn");
  assert(continuation.timer_wait_forbidden === true && continuation.heartbeat_defer_forbidden === true, "Controller owner event cannot defer to a timer or heartbeat");
  assert(Number.isSafeInteger(continuation.transition_count) && continuation.transition_count >= 0 && continuation.transition_count <= 1, "Controller owner event transition count is invalid");
  assert(continuation.admission === "OFF" && continuation.activation === "OFF", "Controller owner event cannot enable admission or activation");
  const expectedKind = expectedTransitionKind(event.local_work);
  if (expectedKind !== null) {
    assert(continuation.action === "START_ONE_BOUNDED_LOCAL_TRANSITION", "Controller owner event must start one bounded local transition");
    assert(continuation.transition_kind === expectedKind, "Controller owner event transition kind does not match the next local route");
    assert(continuation.transition_count === 1 && continuation.event_driven_idle === false, "Controller owner event local continuation must start exactly one transition");
    const expectedTarget = expectedKind === "LOCAL_BLOCK_REPAIR" ? event.local_work.pending_local_request_ids[0] : event.local_work.available_wave_ids[0];
    assert(continuation.target_id === expectedTarget, "Controller owner event target is not the next eligible local route");
    requireIdentifier(continuation.target_id, "Controller owner event target");
    requireIdentifier(continuation.transition_id, "Controller owner event transition");
  } else {
    assert(continuation.action === "PERSIST_EVENT_DRIVEN_PROTECTED_CHECKPOINT", "Controller owner event must persist the protected checkpoint when no local route is eligible");
    assert(continuation.transition_kind === "PROTECTED_CHECKPOINT", "Controller owner event protected continuation kind is invalid");
    assert(continuation.transition_id === null && continuation.target_id === null, "Protected owner event continuation cannot claim a transition");
    assert(continuation.transition_count === 0 && continuation.event_driven_idle === true, "Protected owner event must enter event-driven idle with zero transitions");
  }
}

function wakeBody(event) {
  const body = structuredClone(event);
  body.wake_sha256 = null;
  return body;
}

export function validateControllerOwnerEventWake(event, {currentBindings = null} = {}) {
  exactKeys(event, [
    "schema", "version", "event_id", "event_type", "wake_mode", "owner_task_id", "controller_task_id",
    "received_at_utc", "bound_receipts", "local_work", "protected_gate", "continuation", "resource_state",
    "owner_resumption_is_clearance", "wake_sha256",
  ], "Controller owner event wake");
  assert(event.schema === CONTROLLER_OWNER_EVENT_WAKE_SCHEMA && event.version === CONTROLLER_OWNER_EVENT_WAKE_VERSION, "Controller owner event wake identity is invalid");
  requireIdentifier(event.event_id, "Controller owner event ID");
  assert(CONTROLLER_OWNER_EVENT_TYPES.includes(event.event_type), "Controller owner event type is invalid");
  assert(event.wake_mode === CONTROLLER_OWNER_EVENT_WAKE_MODE, "Controller owner event wake mode is invalid");
  requireIdentifier(event.owner_task_id, "Controller owner event owner task");
  requireIdentifier(event.controller_task_id, "Controller owner event Controller task");
  requireUtcTimestamp(event.received_at_utc, "Controller owner event received time");
  validateBoundReceipts(event.bound_receipts, currentBindings);
  validateLocalWork(event.local_work);
  validateProtectedGate(event.protected_gate, event.local_work);
  validateContinuation(event.continuation, event);
  exactKeys(event.resource_state, ["temporary_workers", "scheduler_jobs", "heavyweight_processes", "timers", "polling"], "Controller owner event resource state");
  for (const field of ["temporary_workers", "scheduler_jobs", "heavyweight_processes", "timers"]) assert(event.resource_state[field] === 0, `Controller owner event ${field} must remain zero`);
  assert(event.resource_state.polling === false, "Controller owner event polling must remain disabled");
  assert(event.owner_resumption_is_clearance === false, "Owner resumption is not independent clearance");
  requireSha(event.wake_sha256, "Controller owner event wake digest");
  assert(event.wake_sha256 === canonicalDigest(wakeBody(event)), "Controller owner event wake digest mismatch");
  return event;
}

export function compileControllerOwnerEventWake({
  eventId,
  ownerTaskId,
  controllerTaskId,
  escalationReceiptSha256,
  projectionSha256,
  ownerDecisionSha256,
  pendingLocalRequestIds = [],
  availableWaveIds = [],
  activationBlockedWaveIds = [],
  waveActivationAllowed = false,
  protectedGate,
  receivedAtUtc = new Date().toISOString(),
} = {}) {
  const localWork = {
    pending_local_request_ids: normalizeIdentifiers(pendingLocalRequestIds, "Controller owner event pending local requests"),
    available_wave_ids: normalizeIdentifiers(availableWaveIds, "Controller owner event available waves"),
    activation_blocked_wave_ids: normalizeIdentifiers(activationBlockedWaveIds, "Controller owner event activation-blocked waves"),
    wave_activation_allowed: waveActivationAllowed,
  };
  const expectedKind = expectedTransitionKind(localWork);
  const targetId = expectedKind === "LOCAL_BLOCK_REPAIR" ? localWork.pending_local_request_ids[0] : expectedKind === "AVAILABLE_WAVE" ? localWork.available_wave_ids[0] : null;
  const continuation = expectedKind === null
    ? {
      action: "PERSIST_EVENT_DRIVEN_PROTECTED_CHECKPOINT",
      transition_kind: "PROTECTED_CHECKPOINT",
      transition_id: null,
      target_id: null,
      same_turn: true,
      event_driven_idle: true,
      timer_wait_forbidden: true,
      heartbeat_defer_forbidden: true,
      transition_count: 0,
      admission: "OFF",
      activation: "OFF",
    }
    : {
      action: "START_ONE_BOUNDED_LOCAL_TRANSITION",
      transition_kind: expectedKind,
      transition_id: `TRANSITION.${eventId}.${expectedKind}`,
      target_id: targetId,
      same_turn: true,
      event_driven_idle: false,
      timer_wait_forbidden: true,
      heartbeat_defer_forbidden: true,
      transition_count: 1,
      admission: "OFF",
      activation: "OFF",
    };
  const event = {
    schema: CONTROLLER_OWNER_EVENT_WAKE_SCHEMA,
    version: CONTROLLER_OWNER_EVENT_WAKE_VERSION,
    event_id: eventId,
    event_type: "OWNER_RESUMPTION",
    wake_mode: CONTROLLER_OWNER_EVENT_WAKE_MODE,
    owner_task_id: ownerTaskId,
    controller_task_id: controllerTaskId,
    received_at_utc: receivedAtUtc,
    bound_receipts: {
      escalation_receipt_sha256: escalationReceiptSha256,
      projection_sha256: projectionSha256,
      owner_decision_sha256: ownerDecisionSha256,
    },
    local_work: localWork,
    protected_gate: structuredClone(protectedGate),
    continuation,
    resource_state: {temporary_workers: 0, scheduler_jobs: 0, heavyweight_processes: 0, timers: 0, polling: false},
    owner_resumption_is_clearance: false,
    wake_sha256: null,
  };
  event.wake_sha256 = canonicalDigest(wakeBody(event));
  return validateControllerOwnerEventWake(event, {currentBindings: event.bound_receipts});
}

export function resumeControllerFromOwnerEvent({event, currentBindings} = {}) {
  assert(isRecord(currentBindings), "Controller owner event current readback is required before acting");
  validateControllerOwnerEventWake(event, {currentBindings});
  return {
    status: "OWNER_EVENT_WAKE_ACCEPTED",
    event_id: event.event_id,
    same_turn: true,
    timer_wait_forbidden: true,
    heartbeat_defer_forbidden: true,
    action: event.continuation.action,
    transition_kind: event.continuation.transition_kind,
    target_id: event.continuation.target_id,
    transition_count: event.continuation.transition_count,
    protected_dependency_status: event.protected_gate.status,
    owner_resumption_is_clearance: false,
  };
}

export function runControllerOwnerEventContinuation({event, currentBindings, onLocalTransition = null, onProtectedCheckpoint = null} = {}) {
  const wake = resumeControllerFromOwnerEvent({event, currentBindings});
  if (wake.action === "START_ONE_BOUNDED_LOCAL_TRANSITION") {
    assert(typeof onLocalTransition === "function", "Controller owner event local continuation handler is required");
    const result = onLocalTransition({
      event_id: event.event_id,
      transition_kind: wake.transition_kind,
      target_id: wake.target_id,
      transition_count: wake.transition_count,
    });
    return {...wake, execution: "LOCAL_TRANSITION_STARTED", handler_result: result};
  }
  assert(typeof onProtectedCheckpoint === "function", "Controller owner event protected-checkpoint handler is required");
  const result = onProtectedCheckpoint({
    event_id: event.event_id,
    dependency_id: event.protected_gate.dependency_id,
    evidence_ceiling: event.protected_gate.evidence_ceiling,
    blocked_wave_ids: event.protected_gate.blocked_wave_ids,
    admission: event.continuation.admission,
    activation: event.continuation.activation,
  });
  return {...wake, execution: "PROTECTED_CHECKPOINT_PERSISTED", handler_result: result};
}
