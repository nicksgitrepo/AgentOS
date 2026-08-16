/* Generic Controller blocker escalation and same-turn continuation contract. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const CONTROLLER_ESCALATION_SCHEMA = "agentos.controller_escalation.v1";
export const CONTROLLER_ESCALATION_VERSION = 1;
export const CONTROLLER_ESCALATION_BLOCKER_CLASSES = Object.freeze([
  "ADMISSION_FAILURE",
  "AUTH_BOUNDARY",
  "CONTRADICTION",
  "COST_BOUNDARY",
  "DESTRUCTIVE_WORK_BOUNDARY",
  "PRODUCTION_RELEASE_BOUNDARY",
  "PROTECTED_DEPENDENCY",
  "RESOURCE_ISSUE",
  "WORKFLOW_STOP",
]);
export const CONTROLLER_ESCALATION_CONTINUATION_MODES = Object.freeze([
  "REPAIR_AND_CONTINUE",
  "ESCALATE_AND_STALL",
]);

const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EVIDENCE_STATUSES = new Set(["BOUND", "PENDING", "UNAVAILABLE"]);
const PROTECTED_DEPENDENCY_STATUSES = new Set(["PENDING_EXTERNAL_AUTHORITY", "OWNER_DECISION_REQUIRED", "PENDING_AUTHORITY"]);

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

function sortedText(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(allowEmpty || values.length > 0, `${label} must not be empty`);
  const normalized = values.map((value) => {
    requireString(value, `${label} item`);
    return value.trim();
  }).sort(compareUtf8);
  assert(new Set(normalized).size === normalized.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(normalized), `${label} must be sorted`);
  return normalized;
}

function escalationBody(escalation) {
  const body = structuredClone(escalation);
  body.escalation_sha256 = null;
  return body;
}

function ownerMessageBody(escalation) {
  return {
    channel: escalation.owner_route.channel,
    owner_task_id: escalation.owner_route.owner_task_id,
    blocker_class: escalation.blocker_class,
    blocker_code: escalation.blocker_code,
    evidence_refs: escalation.evidence_refs,
    attempted_actions: escalation.attempted_actions,
    safe_remaining: escalation.safe_remaining,
    owner_decision_needed: escalation.owner_decision_needed,
    restart_event: escalation.restart_event,
    protected_dependency: escalation.protected_dependency,
  };
}

function validateEvidenceRefs(evidenceRefs) {
  assert(Array.isArray(evidenceRefs) && evidenceRefs.length > 0, "Controller escalation evidence is required");
  const seen = new Set();
  for (const [index, evidence] of evidenceRefs.entries()) {
    exactKeys(evidence, ["evidence_id", "kind", "reference", "sha256", "status"], `Controller escalation evidence ${index}`);
    requireIdentifier(evidence.evidence_id, `Controller escalation evidence ${index} ID`);
    requireIdentifier(evidence.kind, `Controller escalation evidence ${index} kind`);
    assert(typeof evidence.reference === "string" && /^(?:opaque:|ref:).+/u.test(evidence.reference), `Controller escalation evidence ${index} reference must be opaque`);
    requireSha(evidence.sha256, `Controller escalation evidence ${index} digest`);
    assert(EVIDENCE_STATUSES.has(evidence.status), `Controller escalation evidence ${index} status is invalid`);
    assert(!seen.has(evidence.evidence_id), `Controller escalation evidence ${index} is duplicated`);
    seen.add(evidence.evidence_id);
  }
  const ordered = [...evidenceRefs].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
  assert(JSON.stringify(evidenceRefs) === JSON.stringify(ordered), "Controller escalation evidence must be sorted");
}

function validateResourceState(resourceState, {protectedBoundary}) {
  exactKeys(resourceState, ["temporary_workers", "scheduler_jobs", "heavyweight_processes", "timers", "polling"], "Controller escalation resource state");
  for (const field of ["temporary_workers", "scheduler_jobs", "heavyweight_processes", "timers"]) assert(Number.isSafeInteger(resourceState[field]) && resourceState[field] >= 0, `Controller escalation ${field} is invalid`);
  assert(typeof resourceState.polling === "boolean", "Controller escalation polling state is invalid");
  if (protectedBoundary) assert(resourceState.temporary_workers === 0 && resourceState.scheduler_jobs === 0 && resourceState.heavyweight_processes === 0 && resourceState.timers === 0 && resourceState.polling === false, "Protected escalation must release all resources and polling");
}

function validateOwnerRoute(ownerRoute, escalation) {
  exactKeys(ownerRoute, ["channel", "owner_task_id", "route_status", "message_sha256"], "Controller escalation owner route");
  assert(ownerRoute.channel === "OWNER_FRONT_DOOR", "Controller escalation must use the owner front door");
  requireIdentifier(ownerRoute.owner_task_id, "Controller escalation owner task");
  assert(ownerRoute.route_status === "ROUTED", "Controller escalation owner route is not direct and routed");
  requireSha(ownerRoute.message_sha256, "Controller escalation owner message digest");
  assert(ownerRoute.message_sha256 === canonicalDigest(ownerMessageBody(escalation)), "Controller escalation owner message digest mismatch");
}

function validateProtectedDependency(dependency) {
  exactKeys(dependency, ["dependency_id", "status", "evidence_ceiling", "sole_protected_dependency"], "Controller escalation protected dependency");
  requireIdentifier(dependency.dependency_id, "Controller escalation dependency ID");
  assert(PROTECTED_DEPENDENCY_STATUSES.has(dependency.status), "Controller escalation dependency status is invalid");
  requireString(dependency.evidence_ceiling, "Controller escalation dependency evidence ceiling");
  assert(dependency.sole_protected_dependency === true, "Controller escalation dependency must be sole");
}

function validateContinuation(continuation) {
  exactKeys(continuation, ["mode", "next_action", "same_turn_escalation", "event_driven_idle", "closeout_status"], "Controller escalation continuation");
  assert(CONTROLLER_ESCALATION_CONTINUATION_MODES.includes(continuation.mode), "Controller escalation continuation mode is invalid");
  requireIdentifier(continuation.next_action, "Controller escalation continuation action");
  assert(typeof continuation.same_turn_escalation === "boolean", "Controller escalation same-turn flag is invalid");
  assert(typeof continuation.event_driven_idle === "boolean", "Controller escalation event-driven flag is invalid");
  assert(["ROUTINE_HANDOFF_ACCEPTED", "STALLED_READY_FOR_RESUMPTION"].includes(continuation.closeout_status), "Controller escalation closeout status is invalid");
}

export function validateControllerEscalation(escalation) {
  exactKeys(escalation, [
    "schema", "version", "escalation_id", "blocker_class", "blocker_code", "protected_boundary", "evidence_refs",
    "attempted_actions", "safe_remaining", "owner_route", "owner_decision_needed", "restart_event", "resource_state",
    "continuation", "protected_dependency", "escalation_sha256",
  ], "Controller escalation");
  assert(escalation.schema === CONTROLLER_ESCALATION_SCHEMA && escalation.version === CONTROLLER_ESCALATION_VERSION, "Controller escalation identity is invalid");
  requireIdentifier(escalation.escalation_id, "Controller escalation ID");
  assert(CONTROLLER_ESCALATION_BLOCKER_CLASSES.includes(escalation.blocker_class), "Controller escalation blocker class is invalid");
  requireIdentifier(escalation.blocker_code, "Controller escalation blocker code");
  assert(typeof escalation.protected_boundary === "boolean", "Controller escalation protected-boundary flag is invalid");
  validateEvidenceRefs(escalation.evidence_refs);
  sortedText(escalation.attempted_actions, "Controller escalation attempted actions");
  sortedText(escalation.safe_remaining, "Controller escalation safe remaining work");
  requireString(escalation.owner_decision_needed, "Controller escalation owner decision");
  requireString(escalation.restart_event, "Controller escalation restart event");
  validateResourceState(escalation.resource_state, {protectedBoundary: escalation.protected_boundary});
  validateContinuation(escalation.continuation);
  validateOwnerRoute(escalation.owner_route, escalation);
  if (escalation.protected_boundary) {
    assert(escalation.protected_dependency !== null && isRecord(escalation.protected_dependency), "Protected escalation lacks its dependency");
    validateProtectedDependency(escalation.protected_dependency);
    assert(escalation.continuation.mode === "ESCALATE_AND_STALL", "Protected escalation must stall after escalation");
    assert(escalation.continuation.same_turn_escalation === true && escalation.continuation.event_driven_idle === true, "Protected escalation must route now and then idle event-driven");
    assert(escalation.continuation.closeout_status === "STALLED_READY_FOR_RESUMPTION", "Protected escalation closeout must be stalled");
    assert(escalation.continuation.next_action === "WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT", "Protected escalation next action is invalid");
  } else {
    assert(escalation.protected_dependency === null, "Unprotected escalation cannot name a protected dependency");
    assert(escalation.continuation.mode === "REPAIR_AND_CONTINUE", "Unprotected blocker must repair and continue");
    assert(escalation.continuation.same_turn_escalation === true && escalation.continuation.event_driven_idle === false, "Local blocker must continue in the same turn");
    assert(escalation.continuation.closeout_status === "ROUTINE_HANDOFF_ACCEPTED", "Local blocker closeout must continue");
    assert(escalation.continuation.next_action === "START_NEXT_LOCAL_REPAIR", "Local blocker next action is invalid");
  }
  requireSha(escalation.escalation_sha256, "Controller escalation digest");
  assert(escalation.escalation_sha256 === canonicalDigest(escalationBody(escalation)), "Controller escalation digest mismatch");
  return escalation;
}

export function compileControllerEscalation({
  escalationId,
  blockerClass,
  blockerCode,
  protectedBoundary = false,
  evidenceRefs,
  attemptedActions,
  safeRemaining,
  ownerTaskId,
  ownerDecisionNeeded,
  restartEvent,
  resourceState = {temporary_workers: 0, scheduler_jobs: 0, heavyweight_processes: 0, timers: 0, polling: false},
  protectedDependency = null,
} = {}) {
  const continuation = protectedBoundary
    ? {mode: "ESCALATE_AND_STALL", next_action: "WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT", same_turn_escalation: true, event_driven_idle: true, closeout_status: "STALLED_READY_FOR_RESUMPTION"}
    : {mode: "REPAIR_AND_CONTINUE", next_action: "START_NEXT_LOCAL_REPAIR", same_turn_escalation: true, event_driven_idle: false, closeout_status: "ROUTINE_HANDOFF_ACCEPTED"};
  const escalation = {
    schema: CONTROLLER_ESCALATION_SCHEMA,
    version: CONTROLLER_ESCALATION_VERSION,
    escalation_id: escalationId,
    blocker_class: blockerClass,
    blocker_code: blockerCode,
    protected_boundary: protectedBoundary,
    evidence_refs: [...evidenceRefs].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)),
    attempted_actions: [...attemptedActions].sort(compareUtf8),
    safe_remaining: [...safeRemaining].sort(compareUtf8),
    owner_route: {channel: "OWNER_FRONT_DOOR", owner_task_id: ownerTaskId, route_status: "ROUTED", message_sha256: null},
    owner_decision_needed: ownerDecisionNeeded,
    restart_event: restartEvent,
    resource_state: structuredClone(resourceState),
    continuation,
    protected_dependency: protectedBoundary ? protectedDependency : null,
    escalation_sha256: null,
  };
  escalation.owner_route.message_sha256 = canonicalDigest(ownerMessageBody(escalation));
  escalation.escalation_sha256 = canonicalDigest(escalationBody(escalation));
  return validateControllerEscalation(escalation);
}
