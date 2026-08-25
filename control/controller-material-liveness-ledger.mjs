#!/usr/bin/env node

/*
 * Project-agnostic, content-addressed material-liveness ledger.
 *
 * The Controller must observe every admitted executor until its exact
 * material outcome has been consumed by the responsible parent and the
 * correlated closeout is recorded.  This module deliberately contains no
 * product, project, task, provider, or filesystem policy.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const CONTROLLER_MATERIAL_LIVENESS_LEDGER_SCHEMA = "agentos.controller_material_liveness_ledger.v1";
export const CONTROLLER_MATERIAL_LIVENESS_LEDGER_VERSION = 1;
export const MATERIAL_LIVENESS_OUTCOME_KINDS = Object.freeze(["BLOCKER", "FAIL", "PASS", "CANDIDATE", "HANDOFF"]);
export const MATERIAL_LIVENESS_DELIVERY_STATES = Object.freeze(["NOT_DELIVERED", "DELIVERED"]);
export const MATERIAL_LIVENESS_CONSUMPTION_STATES = Object.freeze(["UNCONSUMED", "CONSUMED"]);
export const MATERIAL_LIVENESS_PARENT_STATES = Object.freeze(["ADVANCING", "WAITING", "CLOSED"]);
export const MATERIAL_LIVENESS_CONSUMER_STATES = Object.freeze(["ACTIVE", "IDLE", "UNKNOWN"]);
export const MATERIAL_LIVENESS_STALL_REASONS = Object.freeze([
  "COMPLETED_OUTCOME_NOT_CONSUMED",
  "IDLE_AFTER_PASS",
  "CONSUMPTION_EVIDENCE_MISMATCH",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  values.forEach((value, index) => requireIdentifier(value, `${label}[${index}]`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length, `${label} must be unique`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted`);
}

function sortedById(values, label, idField) {
  assert(Array.isArray(values), `${label} must be an array`);
  const ids = values.map((value, index) => {
    assert(isRecord(value), `${label}[${index}] must be an object`);
    requireIdentifier(value[idField], `${label}[${index}].${idField}`);
    return value[idField];
  });
  const sorted = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length, `${label} contains a duplicate ${idField}`);
  assert(JSON.stringify(ids) === JSON.stringify(sorted), `${label} must be sorted by ${idField}`);
}

function body(record) {
  const copy = structuredClone(record);
  copy.ledger_sha256 = null;
  return copy;
}

function materialSignature({executor_id, candidate_sha256, outcome_sha256, outcome_kind, consumer_id, expected_transition, delivery_state}) {
  requireIdentifier(executor_id, "material signature executor_id");
  requireSha(candidate_sha256, "material signature candidate_sha256");
  requireSha(outcome_sha256, "material signature outcome_sha256");
  requireIdentifier(consumer_id, "material signature consumer_id");
  requireIdentifier(expected_transition, "material signature expected_transition");
  assert(MATERIAL_LIVENESS_OUTCOME_KINDS.includes(outcome_kind), "material signature outcome_kind is invalid");
  assert(MATERIAL_LIVENESS_DELIVERY_STATES.includes(delivery_state), "material signature delivery_state is invalid");
  return canonicalDigest({executor_id, candidate_sha256, outcome_sha256, outcome_kind, consumer_id, expected_transition, delivery_state});
}

export function materialLivenessSignature(input) {
  return materialSignature(input);
}

function validateParent(parent) {
  exactKeys(parent, ["parent_id", "state", "responsible_consumer_id", "expected_transition", "consumer_state"], "material liveness parent");
  requireIdentifier(parent.parent_id, "material liveness parent_id");
  assert(MATERIAL_LIVENESS_PARENT_STATES.includes(parent.state), "material liveness parent state is invalid");
  requireIdentifier(parent.responsible_consumer_id, "material liveness responsible consumer");
  requireIdentifier(parent.expected_transition, "material liveness parent expected transition");
  assert(MATERIAL_LIVENESS_CONSUMER_STATES.includes(parent.consumer_state), "material liveness consumer state is invalid");
}

function validateCloseout(closeout, executor) {
  if (closeout === null) return;
  exactKeys(closeout, ["executor_id", "candidate_sha256", "outcome_sha256", "consumer_id", "expected_transition", "post_delivery_readback_sha256", "closed_at_utc", "correlated"], "material liveness closeout");
  assert(closeout.correlated === true, "material liveness closeout must be correlated");
  assert(closeout.executor_id === executor.executor_id, "material liveness closeout executor mismatch");
  assert(closeout.candidate_sha256 === executor.candidate_sha256, "material liveness closeout candidate mismatch");
  assert(closeout.outcome_sha256 === executor.outcome_sha256, "material liveness closeout outcome mismatch");
  assert(closeout.consumer_id === executor.consumer_id, "material liveness closeout consumer mismatch");
  assert(closeout.expected_transition === executor.expected_transition, "material liveness closeout transition mismatch");
  requireSha(closeout.post_delivery_readback_sha256, "material liveness closeout readback");
  requireUtc(closeout.closed_at_utc, "material liveness closeout time");
  assert(executor.consumption_state === "CONSUMED", "material liveness closeout requires consumed executor");
}

function validateExecutor(executor, parentId, executorIds) {
  exactKeys(executor, [
    "executor_id", "parent_id", "consumer_id", "depends_on_executor_ids", "candidate_sha256", "outcome_sha256",
    "outcome_kind", "expected_transition", "admitted_at_utc", "latest_material_signature_sha256", "delivery_state",
    "consumption_state", "closeout",
  ], "material liveness admitted executor");
  requireIdentifier(executor.executor_id, "material liveness executor_id");
  assert(executor.parent_id === parentId, "material liveness executor parent mismatch");
  requireIdentifier(executor.consumer_id, "material liveness executor consumer_id");
  sortedUnique(executor.depends_on_executor_ids, `material liveness ${executor.executor_id} dependencies`);
  assert(!executor.depends_on_executor_ids.includes(executor.executor_id), "material liveness executor depends on itself");
  executor.depends_on_executor_ids.forEach((dependency) => assert(executorIds.has(dependency), `material liveness dependency is not admitted: ${dependency}`));
  requireSha(executor.candidate_sha256, "material liveness executor candidate");
  requireSha(executor.outcome_sha256, "material liveness executor outcome");
  assert(MATERIAL_LIVENESS_OUTCOME_KINDS.includes(executor.outcome_kind), "material liveness executor outcome kind is invalid");
  requireIdentifier(executor.expected_transition, "material liveness executor expected transition");
  requireUtc(executor.admitted_at_utc, "material liveness executor admission time");
  assert(MATERIAL_LIVENESS_DELIVERY_STATES.includes(executor.delivery_state), "material liveness executor delivery state is invalid");
  assert(MATERIAL_LIVENESS_CONSUMPTION_STATES.includes(executor.consumption_state), "material liveness executor consumption state is invalid");
  const expectedSignature = materialSignature(executor);
  assert(executor.latest_material_signature_sha256 === expectedSignature, `material liveness signature mismatch for ${executor.executor_id}`);
  validateCloseout(executor.closeout, executor);
  if (executor.consumption_state === "CONSUMED") assert(executor.closeout !== null, `consumed executor lacks correlated closeout: ${executor.executor_id}`);
}

function validateReadback(readback, executorById) {
  exactKeys(readback, [
    "executor_id", "candidate_sha256", "outcome_sha256", "consumer_id", "expected_transition", "material_signature_sha256",
    "post_delivery_readback_sha256", "readback_at_utc", "fresh_readback", "transition_started",
  ], "material liveness consumer readback");
  requireIdentifier(readback.executor_id, "material liveness readback executor_id");
  const executor = executorById.get(readback.executor_id);
  assert(executor, `material liveness readback references unknown executor: ${readback.executor_id}`);
  assert(readback.candidate_sha256 === executor.candidate_sha256, "material liveness readback candidate mismatch");
  assert(readback.outcome_sha256 === executor.outcome_sha256, "material liveness readback outcome mismatch");
  assert(readback.consumer_id === executor.consumer_id, "material liveness readback consumer mismatch");
  assert(readback.expected_transition === executor.expected_transition, "material liveness readback transition mismatch");
  assert(readback.material_signature_sha256 === executor.latest_material_signature_sha256, "material liveness readback signature mismatch");
  requireSha(readback.post_delivery_readback_sha256, "material liveness readback digest");
  requireUtc(readback.readback_at_utc, "material liveness readback time");
  assert(readback.fresh_readback === true, "material liveness readback must be fresh");
  assert(readback.transition_started === true, "material liveness readback lacks expected transition");
}

function validatePriorReports(reports) {
  assert(Array.isArray(reports), "material liveness prior reports must be an array");
  const signatures = reports.map((report, index) => {
    exactKeys(report, ["stall_signature_sha256", "reported_at_utc"], `material liveness prior report[${index}]`);
    requireSha(report.stall_signature_sha256, `material liveness prior report[${index}] signature`);
    requireUtc(report.reported_at_utc, `material liveness prior report[${index}] time`);
    return report.stall_signature_sha256;
  });
  const sorted = [...signatures].sort(compareUtf8);
  assert(new Set(signatures).size === signatures.length, "material liveness prior reports contain duplicates");
  assert(JSON.stringify(signatures) === JSON.stringify(sorted), "material liveness prior reports must be sorted");
}

function detectCycles(executors) {
  const byId = new Map(executors.map((executor) => [executor.executor_id, executor]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`material liveness dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on_executor_ids) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const executor of executors) visit(executor.executor_id);
}

export function validateMaterialLivenessLedger(ledger) {
  exactKeys(ledger, ["schema", "version", "parent", "admitted_executors", "consumer_readbacks", "prior_reports", "ledger_sha256"], "material liveness ledger");
  assert(ledger.schema === CONTROLLER_MATERIAL_LIVENESS_LEDGER_SCHEMA && ledger.version === CONTROLLER_MATERIAL_LIVENESS_LEDGER_VERSION, "material liveness ledger identity is invalid");
  validateParent(ledger.parent);
  sortedById(ledger.admitted_executors, "material liveness admitted executors", "executor_id");
  const executorIds = new Set(ledger.admitted_executors.map((executor) => executor.executor_id));
  for (const executor of ledger.admitted_executors) validateExecutor(executor, ledger.parent.parent_id, executorIds);
  detectCycles(ledger.admitted_executors);
  sortedById(ledger.consumer_readbacks, "material liveness consumer readbacks", "executor_id");
  const byId = new Map(ledger.admitted_executors.map((executor) => [executor.executor_id, executor]));
  for (const readback of ledger.consumer_readbacks) validateReadback(readback, byId);
  validatePriorReports(ledger.prior_reports);
  requireSha(ledger.ledger_sha256, "material liveness ledger digest");
  assert(ledger.ledger_sha256 === canonicalDigest(body(ledger)), "material liveness ledger digest mismatch");
  return ledger;
}

export function compileMaterialLivenessLedger({parent, admittedExecutors, consumerReadbacks = [], priorReports = []} = {}) {
  const ledger = {
    schema: CONTROLLER_MATERIAL_LIVENESS_LEDGER_SCHEMA,
    version: CONTROLLER_MATERIAL_LIVENESS_LEDGER_VERSION,
    parent: structuredClone(parent),
    admitted_executors: structuredClone(admittedExecutors),
    consumer_readbacks: structuredClone(consumerReadbacks),
    prior_reports: structuredClone(priorReports),
    ledger_sha256: null,
  };
  validateMaterialLivenessLedger({...ledger, ledger_sha256: canonicalDigest(body(ledger))});
  ledger.ledger_sha256 = canonicalDigest(body(ledger));
  return validateMaterialLivenessLedger(ledger);
}

function stallFor(executor, parent) {
  const reason = executor.outcome_kind === "PASS" && parent.consumer_state === "IDLE"
    ? "IDLE_AFTER_PASS"
    : "COMPLETED_OUTCOME_NOT_CONSUMED";
  const base = {
    executor_id: executor.executor_id,
    parent_id: executor.parent_id,
    candidate_sha256: executor.candidate_sha256,
    outcome_sha256: executor.outcome_sha256,
    outcome_kind: executor.outcome_kind,
    consumer_id: executor.consumer_id,
    expected_transition: executor.expected_transition,
    reason,
  };
  return {...base, stall_signature_sha256: canonicalDigest(base)};
}

export function evaluateMaterialLivenessLedger(ledger, {nowUtc = new Date().toISOString()} = {}) {
  validateMaterialLivenessLedger(ledger);
  requireUtc(nowUtc, "material liveness evaluation time");
  const executorById = new Map(ledger.admitted_executors.map((executor) => [executor.executor_id, executor]));
  const readbackById = new Map(ledger.consumer_readbacks.map((readback) => [readback.executor_id, readback]));
  const priorSignatures = new Set(ledger.prior_reports.map((report) => report.stall_signature_sha256));
  const openStalls = [];
  const closedExecutorIds = [];
  const monitoringExecutorIds = [];
  const invalidEvidence = [];
  for (const executor of ledger.admitted_executors) {
    if (executor.closeout !== null) {
      closedExecutorIds.push(executor.executor_id);
      continue;
    }
    monitoringExecutorIds.push(executor.executor_id);
    const readback = readbackById.get(executor.executor_id);
    if (readback && executor.delivery_state === "DELIVERED") {
      closedExecutorIds.push(executor.executor_id);
      monitoringExecutorIds.pop();
      continue;
    }
    if (readback && executor.delivery_state !== "DELIVERED") invalidEvidence.push(executor.executor_id);
    if (executor.delivery_state === "DELIVERED" && executor.consumption_state === "UNCONSUMED") openStalls.push(stallFor(executor, ledger.parent));
  }
  if (invalidEvidence.length > 0) {
    for (const executorId of invalidEvidence) {
      const executor = executorById.get(executorId);
      const base = stallFor(executor, ledger.parent);
      openStalls.push({...base, reason: "CONSUMPTION_EVIDENCE_MISMATCH", stall_signature_sha256: canonicalDigest({...base, reason: "CONSUMPTION_EVIDENCE_MISMATCH"})});
    }
  }
  openStalls.sort((left, right) => compareUtf8(left.stall_signature_sha256, right.stall_signature_sha256));
  const reports = openStalls.map((stall) => ({...stall, report_action: priorSignatures.has(stall.stall_signature_sha256) ? "DEDUPLICATED" : "EMIT_CONTROLLER_REPORT", reported_at_utc: nowUtc}));
  const newReports = reports.filter((report) => report.report_action === "EMIT_CONTROLLER_REPORT");
  const parentCanAdvance = ledger.parent.state !== "ADVANCING" || (openStalls.length === 0 && monitoringExecutorIds.length === 0);
  return {
    schema: CONTROLLER_MATERIAL_LIVENESS_LEDGER_SCHEMA,
    version: CONTROLLER_MATERIAL_LIVENESS_LEDGER_VERSION,
    ledger_sha256: ledger.ledger_sha256,
    evaluated_at_utc: nowUtc,
    parent_id: ledger.parent.parent_id,
    parent_state: parentCanAdvance ? ledger.parent.state : "STALLED",
    parent_transition_allowed: parentCanAdvance,
    admitted_executor_ids: ledger.admitted_executors.map((executor) => executor.executor_id),
    monitoring_executor_ids: monitoringExecutorIds,
    closed_executor_ids: closedExecutorIds,
    open_stalls: openStalls,
    reports,
    new_reports: newReports,
    unchanged_report_count: reports.length - newReports.length,
    next_route_count: newReports.length,
  };
}

export const compileControllerMaterialLivenessLedger = compileMaterialLivenessLedger;
export const validateControllerMaterialLivenessLedger = validateMaterialLivenessLedger;
export const evaluateControllerMaterialLivenessLedger = evaluateMaterialLivenessLedger;

/*
 * Silent completion is intentionally a separate observation class.  It has
 * no material outcome to consume, so it must not be folded into the ordinary
 * PASS/FAIL/CANDIDATE state machine.  The identity is still content-addressed
 * and can be closed only by a fresh exact custody/turn readback.
 */
export const SILENT_COMPLETION_STALL = "SILENT_COMPLETED_TURN_WITH_PRESERVED_UNFROZEN_CUSTODY";

const SILENT_COMPLETION_TURN_STATUSES = Object.freeze(["COMPLETED"]);
const SILENT_COMPLETION_PROCESS_STATES = Object.freeze(["ABSENT", "ACTIVE"]);
const SILENT_COMPLETION_CUSTODY_STATES = Object.freeze(["CHANGED", "CLEAN", "FROZEN", "ABSENT"]);
const SILENT_COMPLETION_CUSTODY_MUTABILITY = Object.freeze(["MUTABLE", "READ_ONLY"]);
const SILENT_COMPLETION_CANDIDATE_STATES = Object.freeze(["NONE", "IMMUTABLE"]);

function validateSilentInput(input) {
  exactKeys(input, [
    "task_id", "custody_sha256", "generation", "turn_status", "visible_item_count", "assistant_message_present",
    "tool_marker_present", "typed_outcome_sha256", "owning_process_state", "custody_state", "custody_mutability",
    "candidate_state", "expected_transition", "recovery_count", "prior_stall_signature_sha256", "fresh_closeout",
  ], "silent completion observation");
  requireIdentifier(input.task_id, "silent completion task_id");
  requireSha(input.custody_sha256, "silent completion custody");
  requireIdentifier(input.generation, "silent completion generation");
  assert(SILENT_COMPLETION_TURN_STATUSES.includes(input.turn_status), "silent completion turn status is invalid");
  assert(Number.isSafeInteger(input.visible_item_count) && input.visible_item_count >= 0, "silent completion visible item count is invalid");
  assert(typeof input.assistant_message_present === "boolean", "silent completion message presence is invalid");
  assert(typeof input.tool_marker_present === "boolean", "silent completion tool-marker presence is invalid");
  if (input.typed_outcome_sha256 !== null) requireSha(input.typed_outcome_sha256, "silent completion typed outcome");
  assert(SILENT_COMPLETION_PROCESS_STATES.includes(input.owning_process_state), "silent completion process state is invalid");
  assert(SILENT_COMPLETION_CUSTODY_STATES.includes(input.custody_state), "silent completion custody state is invalid");
  assert(SILENT_COMPLETION_CUSTODY_MUTABILITY.includes(input.custody_mutability), "silent completion custody mutability is invalid");
  assert(SILENT_COMPLETION_CANDIDATE_STATES.includes(input.candidate_state), "silent completion candidate state is invalid");
  if (input.expected_transition !== null) requireIdentifier(input.expected_transition, "silent completion expected transition");
  assert(Number.isSafeInteger(input.recovery_count) && input.recovery_count >= 0, "silent completion recovery count is invalid");
  if (input.prior_stall_signature_sha256 !== null) requireSha(input.prior_stall_signature_sha256, "silent completion prior signature");
  if (input.fresh_closeout !== null) {
    exactKeys(input.fresh_closeout, ["task_id", "custody_sha256", "generation", "expected_transition", "stall_signature_sha256", "readback_sha256"], "silent completion closeout");
    assert(input.fresh_closeout.task_id === input.task_id, "silent completion closeout task mismatch");
    assert(input.fresh_closeout.custody_sha256 === input.custody_sha256, "silent completion closeout custody mismatch");
    assert(input.fresh_closeout.generation === input.generation, "silent completion closeout generation mismatch");
    assert(input.fresh_closeout.expected_transition === input.expected_transition, "silent completion closeout transition mismatch");
    requireSha(input.fresh_closeout.stall_signature_sha256, "silent completion closeout signature");
    requireSha(input.fresh_closeout.readback_sha256, "silent completion closeout readback");
  }
}

function silentIdentity(input) {
  return {
    task_id: input.task_id,
    custody_sha256: input.custody_sha256,
    generation: input.generation,
    expected_transition: input.expected_transition,
  };
}

export function silentCompletionSignature(input) {
  validateSilentInput({...input, prior_stall_signature_sha256: input.prior_stall_signature_sha256 ?? null, fresh_closeout: input.fresh_closeout ?? null});
  return canonicalDigest(silentIdentity(input));
}

export function evaluateSilentCompletion(input, {nowUtc = new Date().toISOString()} = {}) {
  validateSilentInput(input);
  requireUtc(nowUtc, "silent completion evaluation time");
  const signature = silentCompletionSignature(input);
  const eligible = input.turn_status === "COMPLETED"
    && input.visible_item_count === 0
    && input.assistant_message_present === false
    && input.tool_marker_present === false
    && input.typed_outcome_sha256 === null
    && input.owning_process_state === "ABSENT"
    && input.custody_state === "CHANGED"
    && input.custody_mutability === "MUTABLE"
    && input.candidate_state === "NONE"
    && input.expected_transition !== null;
  const materialOutcome = input.typed_outcome_sha256 !== null || input.candidate_state === "IMMUTABLE";
  const closed = input.fresh_closeout !== null && input.fresh_closeout.stall_signature_sha256 === signature;
  const duplicate = input.prior_stall_signature_sha256 === signature;
  if (closed) {
    return {status: "CLOSED", stall_signature_sha256: signature, report_action: "NONE", recovery_exhausted: input.recovery_count > 0, identity: silentIdentity(input)};
  }
  if (materialOutcome) {
    return {status: "MATERIAL_OUTCOME_HANDLED", stall_signature_sha256: signature, report_action: "NONE", recovery_exhausted: false, identity: silentIdentity(input)};
  }
  if (!eligible) {
    return {status: "NO_SILENT_COMPLETION_STALL", stall_signature_sha256: signature, report_action: "NONE", recovery_exhausted: false, identity: silentIdentity(input)};
  }
  return {
    status: SILENT_COMPLETION_STALL,
    stall_signature_sha256: signature,
    report_action: duplicate ? "DEDUPLICATED" : "EMIT_CONTROLLER_REPORT",
    recovery_exhausted: input.recovery_count > 0,
    recovery_count: input.recovery_count,
    identity: silentIdentity(input),
    observed_at_utc: nowUtc,
  };
}

export const evaluateControllerSilentCompletion = evaluateSilentCompletion;

/*
 * Cross-thread stall-report delivery is deliberately modelled separately
 * from material-liveness detection.  Detection produces a canonical stall
 * signature; this contract governs only how that already-existing report is
 * transported, correlated, retried, deduplicated, and consumed.  The route
 * names are capabilities, not providers, so projects may supply either the
 * normal collaboration tree or a host-supported cross-thread adapter.
 */
export const CROSS_THREAD_DELIVERY_SCHEMA = "agentos.controller_cross_thread_delivery.v1";
export const CROSS_THREAD_DELIVERY_VERSION = 1;
export const CROSS_THREAD_DELIVERY_ROUTES = Object.freeze(["COLLABORATION_TREE", "HOST_CROSS_THREAD", "FALLBACK"]);
export const CROSS_THREAD_DELIVERY_STATES = Object.freeze(["PENDING", "DELIVERED", "BLOCKED"]);
export const CROSS_THREAD_DELIVERY_CONSUMPTION_STATES = Object.freeze(["UNCONSUMED", "CONSUMED"]);
export const CROSS_THREAD_DELIVERY_ACKNOWLEDGEMENT_STATES = Object.freeze(["ACKNOWLEDGED"]);
export const CROSS_THREAD_DELIVERY_FALLBACK_SCHEMA = "agentos.controller_stall_report_delivery_blocked.v1";
export const CROSS_THREAD_DELIVERY_FALLBACK_STATES = Object.freeze(["BLOCKED_UNCONSUMED", "BLOCKED_CONSUMED"]);

function requireDeliveryText(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

const DELIVERY_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

function requireDeliveryIdentifier(value, label) {
  assert(typeof value === "string" && DELIVERY_IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function deliveryIdentity(value) {
  return {
    report_id: value.report_id,
    stall_signature_sha256: value.stall_signature_sha256,
    source_task_id: value.source_task_id,
    affected_task_id: value.affected_task_id,
    custody_sha256: value.custody_sha256,
    generation: value.generation,
    recipient_role: value.recipient_role,
    recipient_task_id: value.recipient_task_id,
  };
}

function validateDeliveryIdentity(value, label = "cross-thread delivery") {
  for (const field of ["report_id", "source_task_id", "affected_task_id", "generation", "recipient_role", "recipient_task_id"]) {
    requireDeliveryIdentifier(value[field], `${label} ${field}`);
  }
  requireSha(value.stall_signature_sha256, `${label} stall signature`);
  requireSha(value.custody_sha256, `${label} custody`);
}

export function crossThreadDeliverySignature(value) {
  validateDeliveryIdentity(value, "cross-thread delivery identity");
  return canonicalDigest(deliveryIdentity(value));
}

function validateDeliveryAcknowledgement(acknowledgement, attemptId) {
  if (acknowledgement === null) return;
  exactKeys(acknowledgement, ["status", "attempt_id", "at_utc"], "cross-thread delivery acknowledgement");
  assert(CROSS_THREAD_DELIVERY_ACKNOWLEDGEMENT_STATES.includes(acknowledgement.status), "cross-thread acknowledgement status is invalid");
  requireDeliveryIdentifier(acknowledgement.attempt_id, "cross-thread acknowledgement attempt");
  assert(acknowledgement.attempt_id === attemptId, "cross-thread acknowledgement attempt mismatch");
  requireUtc(acknowledgement.at_utc, "cross-thread acknowledgement time");
}

function validateDeliveryReceipt(receipt, identity, attemptId) {
  if (receipt === null) return;
  exactKeys(receipt, ["report_id", "stall_signature_sha256", "recipient_task_id", "generation", "attempt_id", "delivered_at_utc"], "cross-thread delivery receipt");
  assert(receipt.report_id === identity.report_id, "cross-thread receipt report mismatch");
  assert(receipt.stall_signature_sha256 === identity.stall_signature_sha256, "cross-thread receipt signature mismatch");
  assert(receipt.recipient_task_id === identity.recipient_task_id, "cross-thread receipt recipient mismatch");
  assert(receipt.generation === identity.generation, "cross-thread receipt generation mismatch");
  assert(receipt.attempt_id === attemptId, "cross-thread receipt attempt mismatch");
  requireUtc(receipt.delivered_at_utc, "cross-thread receipt time");
}

function validateDeliveryReadback(readback, identity, attemptId) {
  if (readback === null) return;
  exactKeys(readback, [
    "report_id", "stall_signature_sha256", "recipient_task_id", "source_task_id", "custody_sha256",
    "generation", "attempt_id", "readback_sha256", "read_at_utc", "fresh",
  ], "cross-thread recipient readback");
  assert(readback.report_id === identity.report_id, "cross-thread readback report mismatch");
  assert(readback.stall_signature_sha256 === identity.stall_signature_sha256, "cross-thread readback signature mismatch");
  assert(readback.recipient_task_id === identity.recipient_task_id, "cross-thread readback recipient mismatch");
  assert(readback.source_task_id === identity.source_task_id, "cross-thread readback source mismatch");
  assert(readback.custody_sha256 === identity.custody_sha256, "cross-thread readback custody mismatch");
  assert(readback.generation === identity.generation, "cross-thread readback generation mismatch");
  assert(readback.attempt_id === attemptId, "cross-thread readback attempt mismatch");
  requireSha(readback.readback_sha256, "cross-thread readback digest");
  requireUtc(readback.read_at_utc, "cross-thread readback time");
  assert(readback.fresh === true, "cross-thread recipient readback must be fresh");
}

function validateFallback(fallback, identity) {
  if (fallback === null) return;
  exactKeys(fallback, [
    "schema", "version", "status", "consumption_state", "report_id", "original_signature_sha256",
    "intended_recipient_role", "intended_recipient_task_id", "attempted_routes", "errors", "preservation",
    "safe_remaining_work", "owner", "resume_condition", "created_at_utc", "fallback_sha256",
  ], "cross-thread delivery fallback");
  assert(fallback.schema === CROSS_THREAD_DELIVERY_FALLBACK_SCHEMA && fallback.version === 1, "cross-thread fallback identity is invalid");
  assert(CROSS_THREAD_DELIVERY_FALLBACK_STATES.includes(fallback.status), "cross-thread fallback status is invalid");
  assert(CROSS_THREAD_DELIVERY_CONSUMPTION_STATES.includes(fallback.consumption_state), "cross-thread fallback consumption state is invalid");
  assert((fallback.status === "BLOCKED_CONSUMED") === (fallback.consumption_state === "CONSUMED"), "cross-thread fallback status/consumption mismatch");
  assert(fallback.report_id === identity.report_id, "cross-thread fallback report mismatch");
  assert(fallback.original_signature_sha256 === identity.stall_signature_sha256, "cross-thread fallback signature mismatch");
  assert(fallback.intended_recipient_role === identity.recipient_role, "cross-thread fallback role mismatch");
  assert(fallback.intended_recipient_task_id === identity.recipient_task_id, "cross-thread fallback recipient mismatch");
  assert(Array.isArray(fallback.attempted_routes) && fallback.attempted_routes.length > 0, "cross-thread fallback routes are required");
  const routes = new Set();
  fallback.attempted_routes.forEach((route, index) => {
    assert(["COLLABORATION_TREE", "HOST_CROSS_THREAD"].includes(route), `cross-thread fallback route ${index} is invalid`);
    assert(!routes.has(route), "cross-thread fallback routes must be unique");
    routes.add(route);
  });
  assert(Array.isArray(fallback.errors) && fallback.errors.length > 0, "cross-thread fallback errors are required");
  fallback.errors.forEach((error, index) => requireDeliveryText(error, `cross-thread fallback error ${index}`));
  assert(new Set(fallback.errors).size === fallback.errors.length, "cross-thread fallback errors must be unique");
  requireDeliveryText(fallback.preservation, "cross-thread fallback preservation");
  requireDeliveryText(fallback.safe_remaining_work, "cross-thread fallback safe work");
  requireDeliveryIdentifier(fallback.owner, "cross-thread fallback owner");
  requireDeliveryText(fallback.resume_condition, "cross-thread fallback resume condition");
  requireUtc(fallback.created_at_utc, "cross-thread fallback creation time");
  requireSha(fallback.fallback_sha256, "cross-thread fallback digest");
  const body = structuredClone(fallback);
  body.fallback_sha256 = null;
  assert(fallback.fallback_sha256 === canonicalDigest(body), "cross-thread fallback digest mismatch");
}

function deliveryStateBody(value) {
  const body = structuredClone(value);
  body.state_sha256 = null;
  return body;
}

export function validateCrossThreadDeliveryState(state) {
  exactKeys(state, [
    "schema", "version", "report_id", "stall_signature_sha256", "source_task_id", "affected_task_id", "custody_sha256",
    "generation", "recipient_role", "recipient_task_id", "route", "attempt_id", "retry_count", "retry_limit",
    "acknowledgement", "receipt", "recipient_readback", "consumption_state", "fallback", "delivery_state", "state_sha256",
  ], "cross-thread delivery state");
  assert(state.schema === CROSS_THREAD_DELIVERY_SCHEMA && state.version === CROSS_THREAD_DELIVERY_VERSION, "cross-thread delivery identity is invalid");
  validateDeliveryIdentity(state);
  assert(CROSS_THREAD_DELIVERY_ROUTES.includes(state.route), "cross-thread delivery route is invalid");
  requireDeliveryIdentifier(state.attempt_id, "cross-thread delivery attempt");
  assert(Number.isSafeInteger(state.retry_count) && state.retry_count >= 0, "cross-thread delivery retry count is invalid");
  assert(Number.isSafeInteger(state.retry_limit) && state.retry_limit >= 0 && state.retry_limit <= 8, "cross-thread delivery retry limit is invalid");
  assert(state.retry_count <= state.retry_limit, "cross-thread delivery retry count exceeds limit");
  assert(CROSS_THREAD_DELIVERY_CONSUMPTION_STATES.includes(state.consumption_state), "cross-thread delivery consumption state is invalid");
  assert(CROSS_THREAD_DELIVERY_STATES.includes(state.delivery_state), "cross-thread delivery state is invalid");
  validateDeliveryAcknowledgement(state.acknowledgement, state.attempt_id);
  validateDeliveryReceipt(state.receipt, state, state.attempt_id);
  validateDeliveryReadback(state.recipient_readback, state, state.attempt_id);
  validateFallback(state.fallback, state);
  if (state.delivery_state === "BLOCKED") {
    assert(state.route === "FALLBACK" && state.fallback !== null, "blocked delivery must carry a fallback");
  } else {
    assert(state.fallback === null && state.route !== "FALLBACK", "non-blocked delivery cannot use fallback route");
  }
  if (state.receipt === null) assert(state.delivery_state !== "DELIVERED", "delivered state requires a receipt");
  if (state.recipient_readback !== null) assert(state.receipt !== null, "recipient readback requires a receipt");
  if (state.consumption_state === "CONSUMED") {
    const consumedFallback = state.delivery_state === "BLOCKED" && state.fallback?.consumption_state === "CONSUMED";
    assert(consumedFallback || (state.delivery_state === "DELIVERED" && state.receipt !== null && state.recipient_readback !== null), "consumed delivery lacks exact receipt/readback");
  }
  requireSha(state.state_sha256, "cross-thread delivery state digest");
  assert(state.state_sha256 === canonicalDigest(deliveryStateBody(state)), "cross-thread delivery state digest mismatch");
  return state;
}

export const validateControllerCrossThreadDelivery = validateCrossThreadDeliveryState;

export function compileStallReportDeliveryBlockedFallback({
  state,
  reportId = state?.report_id,
  originalSignatureSha256 = state?.stall_signature_sha256,
  intendedRecipientRole = state?.recipient_role,
  intendedRecipientTaskId = state?.recipient_task_id,
  attemptedRoutes = ["COLLABORATION_TREE", "HOST_CROSS_THREAD"],
  errors = ["DELIVERY_ROUTE_UNAVAILABLE"],
  preservation = "Preserve the original typed stall report, signature, custody, and unconsumed state.",
  safeRemainingWork = "Keep the owning Controller route open and retry only through an admitted route.",
  owner = null,
  resumeCondition = "A supported route and exact recipient readback become available.",
  createdAtUtc = new Date().toISOString(),
} = {}) {
  const identity = state ?? {report_id: reportId, stall_signature_sha256: originalSignatureSha256, recipient_role: intendedRecipientRole, recipient_task_id: intendedRecipientTaskId};
  validateDeliveryIdentity({
    ...identity,
    source_task_id: identity.source_task_id ?? "TASK.UNKNOWN.SOURCE",
    affected_task_id: identity.affected_task_id ?? "TASK.UNKNOWN.AFFECTED",
    custody_sha256: identity.custody_sha256 ?? "0".repeat(64),
    generation: identity.generation ?? "GENERATION.UNKNOWN",
  }, "cross-thread fallback identity");
  assert(reportId === identity.report_id, "cross-thread fallback report identity mismatch");
  assert(originalSignatureSha256 === identity.stall_signature_sha256, "cross-thread fallback signature identity mismatch");
  requireDeliveryIdentifier(intendedRecipientRole, "cross-thread fallback recipient role");
  requireDeliveryIdentifier(intendedRecipientTaskId, "cross-thread fallback recipient task");
  const resolvedOwner = owner ?? intendedRecipientRole;
  requireDeliveryIdentifier(resolvedOwner, "cross-thread fallback owner");
  requireUtc(createdAtUtc, "cross-thread fallback creation time");
  const routes = [...attemptedRoutes];
  assert(routes.length > 0, "cross-thread fallback attempted routes are required");
  const errorsCopy = [...errors];
  const fallback = {
    schema: CROSS_THREAD_DELIVERY_FALLBACK_SCHEMA,
    version: 1,
    status: "BLOCKED_UNCONSUMED",
    consumption_state: "UNCONSUMED",
    report_id: reportId,
    original_signature_sha256: originalSignatureSha256,
    intended_recipient_role: intendedRecipientRole,
    intended_recipient_task_id: intendedRecipientTaskId,
    attempted_routes: routes,
    errors: errorsCopy,
    preservation,
    safe_remaining_work: safeRemainingWork,
    owner: resolvedOwner,
    resume_condition: resumeCondition,
    created_at_utc: createdAtUtc,
    fallback_sha256: null,
  };
  fallback.fallback_sha256 = canonicalDigest({...fallback, fallback_sha256: null});
  validateFallback(fallback, identity);
  return fallback;
}

export const compileControllerStallReportDeliveryBlockedFallback = compileStallReportDeliveryBlockedFallback;

export function compileCrossThreadDeliveryState({
  reportId,
  stallSignatureSha256,
  sourceTaskId,
  affectedTaskId,
  custodySha256,
  generation,
  recipientRole,
  recipientTaskId,
  route = null,
  attemptId,
  retryCount,
  retryLimit,
  acknowledgement,
  receipt,
  recipientReadback,
  consumptionState,
  fallback,
  deliveryState,
  ...aliases
} = {}) {
  const normalizedFallback = fallback ?? aliases.fallback ?? null;
  const normalizedRoute = route ?? aliases.route ?? (normalizedFallback === null ? "COLLABORATION_TREE" : "FALLBACK");
  const normalizedAttemptId = attemptId ?? aliases.attempt_id ?? "ATTEMPT.001";
  const normalizedRetryCount = retryCount ?? aliases.retry_count ?? 0;
  const normalizedRetryLimit = retryLimit ?? aliases.retry_limit ?? 2;
  const normalizedAcknowledgement = acknowledgement ?? aliases.acknowledgement ?? null;
  const normalizedReceipt = receipt ?? aliases.receipt ?? null;
  const normalizedReadback = recipientReadback ?? aliases.recipient_readback ?? aliases.recipientReadback ?? null;
  const normalizedConsumption = consumptionState ?? aliases.consumption_state ?? "UNCONSUMED";
  const normalizedDelivery = deliveryState ?? aliases.delivery_state ?? (normalizedFallback === null ? (normalizedReceipt === null ? "PENDING" : "DELIVERED") : "BLOCKED");
  const value = {
    schema: CROSS_THREAD_DELIVERY_SCHEMA,
    version: CROSS_THREAD_DELIVERY_VERSION,
    report_id: reportId ?? aliases.report_id,
    stall_signature_sha256: stallSignatureSha256 ?? aliases.stall_signature_sha256,
    source_task_id: sourceTaskId ?? aliases.source_task_id,
    affected_task_id: affectedTaskId ?? aliases.affected_task_id,
    custody_sha256: custodySha256 ?? aliases.custody_sha256,
    generation: generation ?? aliases.generation,
    recipient_role: recipientRole ?? aliases.recipient_role,
    recipient_task_id: recipientTaskId ?? aliases.recipient_task_id,
    route: normalizedRoute,
    attempt_id: normalizedAttemptId,
    retry_count: normalizedRetryCount,
    retry_limit: normalizedRetryLimit,
    acknowledgement: structuredClone(normalizedAcknowledgement),
    receipt: structuredClone(normalizedReceipt),
    recipient_readback: structuredClone(normalizedReadback),
    consumption_state: normalizedConsumption,
    fallback: structuredClone(normalizedFallback),
    delivery_state: normalizedDelivery,
    state_sha256: null,
  };
  validateDeliveryIdentity(value);
  value.state_sha256 = canonicalDigest(deliveryStateBody(value));
  return validateCrossThreadDeliveryState(value);
}

export const compileControllerCrossThreadDeliveryState = compileCrossThreadDeliveryState;

function nextAttemptId(state) {
  return `ATTEMPT.${String(state.retry_count + 1).padStart(3, "0")}`;
}

function receiptFrom(result) {
  if (result?.receipt !== undefined) return result.receipt;
  if (result && ["report_id", "stall_signature_sha256", "recipient_task_id", "generation", "attempt_id", "delivered_at_utc"].every((key) => Object.prototype.hasOwnProperty.call(result, key))) return result;
  return null;
}

function readbackFrom(result) {
  if (result?.recipient_readback !== undefined) return result.recipient_readback;
  if (result?.recipientReadback !== undefined) return result.recipientReadback;
  return null;
}

function acknowledgementFrom(result) {
  if (result?.acknowledgement !== undefined) return result.acknowledgement;
  if (result?.ack !== undefined) return result.ack;
  return null;
}

function callDeliveryAdapter(adapter, payload) {
  if (typeof adapter === "function") return adapter(payload);
  if (adapter && typeof adapter.deliverCrossThread === "function") return adapter.deliverCrossThread(payload);
  if (adapter && typeof adapter.sendCrossThread === "function") return adapter.sendCrossThread(payload);
  return null;
}

function resultState(state, overrides = {}) {
  return compileCrossThreadDeliveryState({
    report_id: state.report_id,
    stall_signature_sha256: state.stall_signature_sha256,
    source_task_id: state.source_task_id,
    affected_task_id: state.affected_task_id,
    custody_sha256: state.custody_sha256,
    generation: state.generation,
    recipient_role: state.recipient_role,
    recipient_task_id: state.recipient_task_id,
    route: state.route,
    attempt_id: state.attempt_id,
    retryCount: state.retry_count,
    retryLimit: state.retry_limit,
    acknowledgement: state.acknowledgement,
    receipt: state.receipt,
    recipientReadback: state.recipient_readback,
    consumptionState: state.consumption_state,
    fallback: state.fallback,
    deliveryState: state.delivery_state,
    ...overrides,
  });
}

export function consumeCrossThreadDeliveryFallback(state, {owner, consumedAtUtc = new Date().toISOString()} = {}) {
  validateCrossThreadDeliveryState(state);
  assert(state.fallback !== null && state.delivery_state === "BLOCKED", "cross-thread fallback is not pending");
  requireDeliveryIdentifier(owner, "cross-thread fallback consumer");
  assert(owner === state.fallback.owner, "cross-thread fallback consumer is not designated owner");
  requireUtc(consumedAtUtc, "cross-thread fallback consumption time");
  const fallback = {...state.fallback, status: "BLOCKED_CONSUMED", consumption_state: "CONSUMED"};
  fallback.fallback_sha256 = canonicalDigest({...fallback, fallback_sha256: null});
  return resultState(state, {consumptionState: "CONSUMED", fallback});
}

export function applyCrossThreadDeliveryReadback(state, recipientReadback) {
  validateCrossThreadDeliveryState(state);
  assert(state.receipt !== null, "cross-thread readback requires a delivery receipt");
  return resultState(state, {
    recipientReadback: structuredClone(recipientReadback),
    consumptionState: "CONSUMED",
    deliveryState: "DELIVERED",
  });
}

export const consumeCrossThreadDeliveryReadback = applyCrossThreadDeliveryReadback;

export function evaluateCrossThreadDelivery(state, {
  collaborationTreeAvailable = true,
  recipientVisible = true,
  collaborationTreeAdapter = null,
  hostAdapter = null,
  retry = false,
  fallbackOwner = null,
  fallbackReadback = null,
  nowUtc = new Date().toISOString(),
} = {}) {
  validateCrossThreadDeliveryState(state);
  requireUtc(nowUtc, "cross-thread delivery evaluation time");
  const key = crossThreadDeliverySignature(state);
  if (state.fallback !== null) {
    if (fallbackReadback !== null || fallbackOwner !== null) {
      const owner = fallbackOwner ?? fallbackReadback?.owner;
      const consumed = consumeCrossThreadDeliveryFallback(state, {owner, consumedAtUtc: fallbackReadback?.consumed_at_utc ?? nowUtc});
      return {schema: CROSS_THREAD_DELIVERY_SCHEMA, version: CROSS_THREAD_DELIVERY_VERSION, delivery_key_sha256: key, report_action: "FALLBACK_CONSUMED", state: consumed};
    }
    return {schema: CROSS_THREAD_DELIVERY_SCHEMA, version: CROSS_THREAD_DELIVERY_VERSION, delivery_key_sha256: key, report_action: "DEDUPLICATED", state: structuredClone(state)};
  }
  if (state.consumption_state === "CONSUMED") {
    return {schema: CROSS_THREAD_DELIVERY_SCHEMA, version: CROSS_THREAD_DELIVERY_VERSION, delivery_key_sha256: key, report_action: "ALREADY_CONSUMED", state: structuredClone(state)};
  }
  let route = null;
  let adapter = null;
  if (collaborationTreeAvailable && recipientVisible) {
    route = "COLLABORATION_TREE";
    adapter = collaborationTreeAdapter;
  } else {
    route = "HOST_CROSS_THREAD";
    adapter = hostAdapter;
  }
  if (route === "COLLABORATION_TREE" && adapter === null && state.receipt === null) {
    return {schema: CROSS_THREAD_DELIVERY_SCHEMA, version: CROSS_THREAD_DELIVERY_VERSION, delivery_key_sha256: key, report_action: "ROUTE_SELECTED", state: resultState(state, {route})};
  }
  if (state.receipt !== null || state.recipient_readback !== null || state.acknowledgement !== null) {
    const existing = resultState(state, {route});
    const consumed = existing.receipt !== null && existing.recipient_readback !== null;
    return {schema: CROSS_THREAD_DELIVERY_SCHEMA, version: CROSS_THREAD_DELIVERY_VERSION, delivery_key_sha256: key, report_action: consumed ? "CONSUMED" : existing.acknowledgement !== null ? "ACKNOWLEDGED_UNCONSUMED" : "DELIVERED_UNCONSUMED", state: consumed ? resultState(existing, {consumptionState: "CONSUMED", deliveryState: "DELIVERED"}) : existing};
  }
  const attemptId = nextAttemptId(state);
  const payload = structuredClone(state);
  payload.attempt_id = attemptId;
  payload.delivery_key_sha256 = key;
  let result;
  try {
    result = callDeliveryAdapter(adapter, payload);
  } catch (error) {
    result = {available: false, error: String(error?.message ?? error)};
  }
  if (result && typeof result.then === "function") throw new Error("cross-thread delivery adapter must be synchronous");
  const unavailable = result === null || result === undefined || result.available === false || result.status === "UNAVAILABLE" || result.status === "REJECTED" || result.status === "AMBIGUOUS";
  if (unavailable) {
    if (retry === true && state.retry_count < state.retry_limit) {
      const retryState = resultState(state, {route, attemptId, retryCount: state.retry_count + 1});
      return {schema: CROSS_THREAD_DELIVERY_SCHEMA, version: CROSS_THREAD_DELIVERY_VERSION, delivery_key_sha256: key, report_action: "RETRY_RETAINED", state: retryState};
    }
    const errors = [result?.error ?? result?.message ?? "DELIVERY_ROUTE_UNAVAILABLE"];
    const fallback = compileStallReportDeliveryBlockedFallback({state, attemptedRoutes: route === "HOST_CROSS_THREAD" ? ["COLLABORATION_TREE", "HOST_CROSS_THREAD"] : ["COLLABORATION_TREE"], errors, createdAtUtc: nowUtc, owner: fallbackOwner ?? state.recipient_role});
    const blocked = resultState(state, {route: "FALLBACK", attemptId, fallback, deliveryState: "BLOCKED"});
    return {schema: CROSS_THREAD_DELIVERY_SCHEMA, version: CROSS_THREAD_DELIVERY_VERSION, delivery_key_sha256: key, report_action: "EMIT_STALL_REPORT_DELIVERY_BLOCKED", state: blocked};
  }
  const receipt = receiptFrom(result);
  const readback = readbackFrom(result);
  const acknowledgement = acknowledgementFrom(result);
  if (result && (Object.prototype.hasOwnProperty.call(result, "receipt") || Object.prototype.hasOwnProperty.call(result, "recipient_readback") || Object.prototype.hasOwnProperty.call(result, "recipientReadback"))) {
    if (receipt === null) throw new Error("cross-thread adapter returned a malformed receipt");
  }
  const next = resultState(state, {
    route,
    attemptId,
    retryCount: state.retry_count + (attemptId === state.attempt_id ? 0 : 1),
    acknowledgement,
    receipt,
    recipientReadback: readback,
    deliveryState: receipt === null ? "PENDING" : "DELIVERED",
    consumptionState: receipt !== null && readback !== null ? "CONSUMED" : "UNCONSUMED",
  });
  return {schema: CROSS_THREAD_DELIVERY_SCHEMA, version: CROSS_THREAD_DELIVERY_VERSION, delivery_key_sha256: key, report_action: next.consumption_state === "CONSUMED" ? "CONSUMED" : receipt !== null ? "DELIVERED_UNCONSUMED" : acknowledgement !== null ? "ACKNOWLEDGED_UNCONSUMED" : "ROUTE_ATTEMPTED", state: next};
}

export const evaluateControllerCrossThreadDelivery = evaluateCrossThreadDelivery;
