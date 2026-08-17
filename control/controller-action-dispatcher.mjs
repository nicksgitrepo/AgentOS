#!/usr/bin/env node

/* Closed, same-turn successor dispatch for project-agnostic Controller actions. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const CONTROLLER_ACTION_RECEIPT_SCHEMA = "agentos.controller_action_receipt.v1";
export const CONTROLLER_ACTION_DEFECT_SCHEMA = "agentos.controller_action_defect.v1";
export const CONTROLLER_ACTION_VERSION = 1;

const local = (handler) => Object.freeze({handler, mode: "LOCAL"});
const protectedWait = Object.freeze({handler: "HANDLER.PROTECTED_EVENT_WAIT", mode: "PROTECTED_WAIT"});
const ownerReview = Object.freeze({handler: "HANDLER.OWNER_REVIEW", mode: "OWNER_REVIEW"});
const invalidTerminal = Object.freeze({handler: null, mode: "INVALID_TERMINAL", defect_class: "INVALID_SUCCESSOR"});

/* One coverage table is the source of truth for every action emitted by the bootstrap, Spawner, roster, planner, and Orchestrator sequence. */
export const CONTROLLER_ACTION_COVERAGE = Object.freeze({
  ADMIT_TYPED_AGENT_SPAWNER: local("HANDLER.SPAWNER_ADMISSION"),
  CONSTRUCT_PERMANENT_ROLES_ONE_AT_A_TIME: local("HANDLER.PERMANENT_ROLE_CONSTRUCTION"),
  ADMIT_NEXT_PERMANENT_ROLE: local("HANDLER.PERMANENT_ROLE_ADMISSION"),
  INJECT_ORCHESTRATOR_GOVERNANCE: local("HANDLER.ORCHESTRATOR_GOVERNANCE"),
  START_COMPILER: local("HANDLER.SPAWNER_COMPILER"),
  COMPILE_NEXT_BLOCK: local("HANDLER.SPAWNER_BLOCK_COMPILER"),
  PUBLISH_TYPED_ROSTER: local("HANDLER.SPAWNER_ROSTER_PUBLISHER"),
  WAIT_FOR_INDEPENDENT_CLEARANCE: protectedWait,
  ADMIT_GOVERNED_SPAWN: local("HANDLER.GOVERNED_SPAWN_ADAPTER"),
  START_GOVERNED_SPAWN: local("HANDLER.GOVERNED_SPAWN_ADAPTER"),
  WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT: protectedWait,
  REQUEST_SPAWNER_QA: local("HANDLER.ORCHESTRATOR_SPAWNER_QA"),
  REPAIR_BLOCKS: local("HANDLER.ORCHESTRATOR_BLOCK_REPAIR"),
  START_SPECIALIST_WAVE: local("HANDLER.ORCHESTRATOR_SPECIALIST_WAVE"),
  START_PLATFORM_REVIEW: local("HANDLER.ORCHESTRATOR_PLATFORM_REVIEW"),
  ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE: local("HANDLER.PLATFORM_AGENT.ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE"),
  START_CENTRAL_INTEGRATION: local("HANDLER.ORCHESTRATOR_CENTRAL_INTEGRATION"),
  START_INDEPENDENT_REAUDIT: local("HANDLER.ORCHESTRATOR_INDEPENDENT_REAUDIT"),
  PREPARE_CANDIDATE_REVIEW: ownerReview,
  START_NEXT_AVAILABLE_CONTROLLER_TRANSITION: local("HANDLER.CONTROLLER_AVAILABLE_TRANSITION"),
  START_NEXT_LOCAL_BLOCK_REPAIR: local("HANDLER.CONTROLLER_LOCAL_BLOCK_REPAIR"),
  WAIT_FOR_PROTECTED_WAVE_ACTIVATION: protectedWait,
  PREPARE_DEVELOPMENT_CANDIDATE_REVIEW: ownerReview,
  REQUEST_SPAWNER_QA_FOR_CURRENT_WAVE: local("HANDLER.CONTROLLER_SPAWNER_QA"),
  WAIT_FOR_EXACT_PROTECTED_BOUNDARY_RESOLUTION: protectedWait,
  BUILD_SOURCE_LOCK_AND_QA_MISSING_BLOCKS: local("HANDLER.CONTROLLER_BLOCK_REPAIR"),
  RUN_NEXT_BOUNDED_RECOVERY: local("HANDLER.CONTROLLER_RECOVERY"),
  RECORD_BLOCKED_EXACT_AND_CONTINUE_UNAFFECTED_WORK: local("HANDLER.CONTROLLER_CONTINUE_UNAFFECTED"),
  START_CURRENT_SPECIALIST_AUDIT_REPAIR_WAVE: local("HANDLER.CONTROLLER_SPECIALIST_WAVE"),
  START_PLATFORM_REVIEW_TEST_AND_INTEGRATION: local("HANDLER.CONTROLLER_PLATFORM_REVIEW"),
  START_CENTRAL_INTEGRATION_OF_ACCEPTED_PLATFORM_HANDOFFS: local("HANDLER.CONTROLLER_CENTRAL_INTEGRATION"),
  START_INDEPENDENT_REAUDIT_OF_CUMULATIVE_CANDIDATE: local("HANDLER.CONTROLLER_INDEPENDENT_REAUDIT"),
  WAIT_FOR_PROTECTED_EVENT: protectedWait,
  SELF_REPAIR_WORKFLOW_DEAD_END: local("HANDLER.SELF_REPAIR_WORKFLOW"),
  OWNER_REVIEW: ownerReview,
  NONE: invalidTerminal,
});
export const CONTROLLER_ACTION_REGISTRY = Object.freeze(Object.fromEntries(Object.entries(CONTROLLER_ACTION_COVERAGE).filter(([, descriptor]) => descriptor.mode !== "INVALID_TERMINAL")));
export const CONTROLLER_ACTION_IDS = Object.freeze(Object.keys(CONTROLLER_ACTION_REGISTRY).sort(compareUtf8));
export const CONTROLLER_EMITTED_ACTION_IDS = Object.freeze(Object.keys(CONTROLLER_ACTION_COVERAGE).sort(compareUtf8));
export const CONTROLLER_PROTECTED_BLOCKER_CLASSES = Object.freeze([
  "CREDENTIAL_OR_AUTHENTICATION",
  "IRREVERSIBLE_DESTRUCTIVE_USER_WORK",
  "MAJOR_PRODUCT_OR_PRODUCTION_DECISION",
  "MATERIAL_SPEND_OR_FINANCIAL_AUTHORITY",
  "PROTECTED_EXTERNAL_DEPENDENCY",
].sort(compareUtf8));
export const CONTROLLER_ACTION_DEFECT_CLASSES = Object.freeze([
  "DISPATCH_FAILED",
  "INVALID_SUCCESSOR",
  "MISSING_ATOMIC_PERSISTENCE",
  "STALE_OR_UNKNOWN_HANDLER",
  "UNCHANGED_SEMANTIC_STATE",
  "UNKNOWN_ACTION_ROUTE",
  "WORKFLOW_DEAD_END",
].sort(compareUtf8));

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const RECEIPT_KEYS = Object.freeze([
  "schema", "version", "receipt_id", "action_id", "previous_receipt_sha256", "semantic_before_sha256", "semantic_after_sha256",
  "progress_delta_sha256", "evidence_refs", "hostile_fixture_refs", "next_action", "next_handler", "continuation", "continuation_sha256", "authority",
  "protected_event", "defect", "receipt_sha256",
]);
const CONTINUATION_KEYS = Object.freeze(["mode", "timer_deferral", "heartbeat_deferral", "same_turn_dispatch", "protected_event_id", "resume_condition"]);
const AUTHORITY_KEYS = Object.freeze(["compiler_only", "admission", "activation", "product_mutation", "provider_access", "credential_access", "spend", "destructive_work"]);
const PROTECTED_EVENT_KEYS = Object.freeze(["blocker_id", "blocker_class", "evidence_ceiling", "restart_event", "resources"]);
const RESOURCE_KEYS = Object.freeze(["jobs", "workers", "heavyweight_processes", "timers"]);
const DEFECT_KEYS = Object.freeze(["schema", "version", "defect_id", "defect_class", "evidence_refs", "required_gate", "stop_condition", "roster_invalidation", "defect_sha256"]);
const HANDLER_RESULT_KEYS = Object.freeze(["semantic_after_sha256", "next_action", "next_handler", "continuation", "continuation_sha256", "evidence_refs", "hostile_fixture_refs", "protected_event", "defect"]);

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

function requireSha(value, label, {allowNull = false} = {}) {
  if (allowNull && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable uppercase identifier`);
}

function requireText(value, label, minimumLength = 1) {
  assert(typeof value === "string" && value.trim().length >= minimumLength && !/[\u0000-\u001f\u007f]/u.test(value), `${label} is incomplete`);
}

function validateEvidenceRefs(refs, label = "Controller action evidence refs") {
  assert(Array.isArray(refs) && refs.length > 0, `${label} are required`);
  const ids = [];
  for (const ref of refs) {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `${label} entry`);
    requireIdentifier(ref.evidence_id, `${label} id`);
    assert(typeof ref.reference === "string" && REFERENCE.test(ref.reference), `${label} reference is invalid`);
    requireSha(ref.sha256, `${label} digest`);
    ids.push(ref.evidence_id);
  }
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Controller action hostile fixture refs are required");
  assert(refs.every((value) => typeof value === "string" && IDENTIFIER.test(value)), "Controller action hostile fixture ref is invalid");
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "Controller action hostile fixture refs must be sorted and unique");
  return refs;
}

function validateAuthority(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "Controller action authority");
  for (const key of AUTHORITY_KEYS) assert(authority[key] === false || (key === "compiler_only" && authority[key] === true), `Controller action authority ${key} is weakened`);
  return authority;
}

export const CONTROLLER_ACTION_AUTHORITY = Object.freeze({
  compiler_only: true,
  admission: false,
  activation: false,
  product_mutation: false,
  provider_access: false,
  credential_access: false,
  spend: false,
  destructive_work: false,
});

function validateProtectedEvent(event) {
  exactKeys(event, PROTECTED_EVENT_KEYS, "Controller protected event");
  requireIdentifier(event.blocker_id, "Controller protected blocker");
  assert(CONTROLLER_PROTECTED_BLOCKER_CLASSES.includes(event.blocker_class), "Controller protected blocker class is invalid");
  requireText(event.evidence_ceiling, "Controller protected evidence ceiling", 24);
  requireText(event.restart_event, "Controller protected restart event", 8);
  exactKeys(event.resources, RESOURCE_KEYS, "Controller protected resources");
  for (const key of RESOURCE_KEYS) assert(event.resources[key] === 0, `Controller protected resource ${key} must be zero`);
  return event;
}

export function compileControllerActionDefect({defectId, defectClass, evidenceRefs, stopCondition = "Reject the successor and route the defect through the project-agnostic Spawner compiler.", requiredGate = "AGENTOS.CONTROLLER.ACTION_CONTINUATION", rosterInvalidation = "INVALIDATE_DEPENDENT_SUCCESSORS"} = {}) {
  requireIdentifier(defectId, "Controller action defect id");
  assert(CONTROLLER_ACTION_DEFECT_CLASSES.includes(defectClass), "Controller action defect class is invalid");
  validateEvidenceRefs(evidenceRefs);
  requireIdentifier(requiredGate, "Controller action defect gate");
  requireText(stopCondition, "Controller action defect stop condition", 24);
  requireIdentifier(rosterInvalidation, "Controller action defect roster invalidation");
  const defect = {
    schema: CONTROLLER_ACTION_DEFECT_SCHEMA,
    version: CONTROLLER_ACTION_VERSION,
    defect_id: defectId,
    defect_class: defectClass,
    evidence_refs: structuredClone(evidenceRefs),
    required_gate: requiredGate,
    stop_condition: stopCondition,
    roster_invalidation: rosterInvalidation,
    defect_sha256: null,
  };
  defect.defect_sha256 = canonicalDigest({...defect, defect_sha256: null});
  return validateControllerActionDefect(defect);
}

export function validateControllerActionDefect(defect) {
  exactKeys(defect, DEFECT_KEYS, "Controller action defect");
  assert(defect.schema === CONTROLLER_ACTION_DEFECT_SCHEMA && defect.version === CONTROLLER_ACTION_VERSION, "Controller action defect identity is invalid");
  requireIdentifier(defect.defect_id, "Controller action defect id");
  assert(CONTROLLER_ACTION_DEFECT_CLASSES.includes(defect.defect_class), "Controller action defect class is invalid");
  validateEvidenceRefs(defect.evidence_refs, "Controller action defect evidence refs");
  requireIdentifier(defect.required_gate, "Controller action defect gate");
  requireText(defect.stop_condition, "Controller action defect stop condition", 24);
  requireIdentifier(defect.roster_invalidation, "Controller action defect roster invalidation");
  requireSha(defect.defect_sha256, "Controller action defect digest");
  assert(defect.defect_sha256 === canonicalDigest({...defect, defect_sha256: null}), "Controller action defect digest mismatch");
  return defect;
}

function expectedContinuationMode(actionId) {
  const descriptor = CONTROLLER_ACTION_REGISTRY[actionId];
  assert(descriptor !== undefined, `Controller action ${actionId} is not registered`);
  if (descriptor.mode === "PROTECTED_WAIT") return "EVENT_DRIVEN_PROTECTED_WAIT";
  if (descriptor.mode === "OWNER_REVIEW") return "EXPLICIT_OWNER_REVIEW";
  return "IMMEDIATE_SAME_TURN";
}

export function controllerActionHandlerFor(actionId) {
  requireIdentifier(actionId, "Controller action");
  const descriptor = CONTROLLER_ACTION_COVERAGE[actionId];
  assert(descriptor !== undefined, `Controller action ${actionId} is not registered`);
  if (descriptor.mode === "INVALID_TERMINAL") {
    throw new ControllerActionDefect(compileControllerActionDefect({
      defectId: `DEFECT.CONTROLLER.ACTION.INVALID.${actionId}`,
      defectClass: "INVALID_SUCCESSOR",
      evidenceRefs: [{
        evidence_id: `EVIDENCE.CONTROLLER.ACTION.INVALID.${actionId}`,
        reference: `opaque:controller-action-invalid-terminal:${actionId.toLowerCase()}`,
        sha256: canonicalDigest({action_id: actionId, defect_class: "INVALID_SUCCESSOR"}),
      }],
    }), `Controller action ${actionId} is an invalid terminal and must become a typed defect`);
  }
  return descriptor.handler;
}

export function controllerActionCoverageFor(actionId) {
  requireIdentifier(actionId, "Controller action");
  return CONTROLLER_ACTION_COVERAGE[actionId] ?? null;
}

export function compileControllerContinuation(actionId, {protectedEventId = null, resumeCondition = null} = {}) {
  const mode = expectedContinuationMode(actionId);
  const continuation = {
    mode,
    timer_deferral: false,
    heartbeat_deferral: false,
    same_turn_dispatch: mode === "IMMEDIATE_SAME_TURN",
    protected_event_id: protectedEventId,
    resume_condition: resumeCondition ?? (mode === "EVENT_DRIVEN_PROTECTED_WAIT" ? "Resume only on the bound protected event; keep resources at zero." : mode === "EXPLICIT_OWNER_REVIEW" ? "Await the explicit owner decision route; do not use a timer as the workflow driver." : "Dispatch the registered successor handler in this same lifecycle turn."),
  };
  validateControllerContinuation(continuation, actionId);
  return continuation;
}

export function controllerContinuationDigest(continuation) {
  return canonicalDigest(continuation);
}

function validateControllerContinuation(continuation, actionId) {
  exactKeys(continuation, CONTINUATION_KEYS, "Controller action continuation");
  const mode = expectedContinuationMode(actionId);
  assert(continuation.mode === mode, "Controller action continuation mode is invalid");
  assert(continuation.timer_deferral === false && continuation.heartbeat_deferral === false, "Controller action cannot defer to a timer or heartbeat");
  assert(continuation.same_turn_dispatch === (mode === "IMMEDIATE_SAME_TURN"), "Controller action same-turn dispatch binding is invalid");
  if (mode === "EVENT_DRIVEN_PROTECTED_WAIT") {
    requireIdentifier(continuation.protected_event_id, "Controller protected continuation event");
  } else {
    assert(continuation.protected_event_id === null, "Non-protected Controller action cannot bind a protected event");
  }
  requireText(continuation.resume_condition, "Controller action continuation resume condition", 8);
  return continuation;
}

export function validateControllerActionReceipt(receipt) {
  exactKeys(receipt, RECEIPT_KEYS, "Controller action receipt");
  assert(receipt.schema === CONTROLLER_ACTION_RECEIPT_SCHEMA && receipt.version === CONTROLLER_ACTION_VERSION, "Controller action receipt identity is invalid");
  requireIdentifier(receipt.receipt_id, "Controller action receipt id");
  requireIdentifier(receipt.action_id, "Controller action id");
  requireSha(receipt.previous_receipt_sha256, "Controller previous receipt", {allowNull: true});
  requireSha(receipt.semantic_before_sha256, "Controller semantic state before");
  requireSha(receipt.semantic_after_sha256, "Controller semantic state after");
  requireSha(receipt.progress_delta_sha256, "Controller progress delta");
  assert(receipt.progress_delta_sha256 === canonicalDigest({semantic_before_sha256: receipt.semantic_before_sha256, semantic_after_sha256: receipt.semantic_after_sha256}), "Controller progress delta mismatch");
  validateEvidenceRefs(receipt.evidence_refs);
  validateHostileRefs(receipt.hostile_fixture_refs);
  requireIdentifier(receipt.next_action, "Controller next action");
  const descriptor = CONTROLLER_ACTION_REGISTRY[receipt.next_action];
  assert(descriptor !== undefined, "Controller next action is not registered");
  assert(receipt.next_handler === descriptor.handler, "Controller next handler does not match the action registry");
  validateControllerContinuation(receipt.continuation, receipt.next_action);
  requireSha(receipt.continuation_sha256, "Controller continuation digest");
  assert(receipt.continuation_sha256 === controllerContinuationDigest(receipt.continuation), "Controller continuation digest mismatch");
  validateAuthority(receipt.authority);
  if (descriptor.mode === "PROTECTED_WAIT") {
    validateProtectedEvent(receipt.protected_event);
    assert(receipt.continuation.protected_event_id === receipt.protected_event.blocker_id, "Protected continuation event differs");
  } else {
    assert(receipt.protected_event === null, "Non-protected Controller action cannot carry a protected event");
  }
  if (receipt.next_action === "SELF_REPAIR_WORKFLOW_DEAD_END") validateControllerActionDefect(receipt.defect);
  else assert(receipt.defect === null, "Only a workflow dead-end self-repair route may carry a defect");
  if (descriptor.mode === "LOCAL" && receipt.next_action !== "SELF_REPAIR_WORKFLOW_DEAD_END") assert(receipt.semantic_before_sha256 !== receipt.semantic_after_sha256, "Controller local successor must change semantic state");
  requireSha(receipt.receipt_sha256, "Controller action receipt digest");
  assert(receipt.receipt_sha256 === canonicalDigest({...receipt, receipt_sha256: null}), "Controller action receipt digest mismatch");
  return receipt;
}

export function compileControllerActionReceipt({receiptId, actionId, previousReceiptSha256 = null, semanticBeforeSha256, semanticAfterSha256, evidenceRefs, hostileFixtureRefs, nextAction, nextHandler = null, continuation = null, authority = CONTROLLER_ACTION_AUTHORITY, protectedEvent = null, defect = null} = {}) {
  requireIdentifier(receiptId, "Controller action receipt id");
  requireIdentifier(actionId, "Controller action id");
  const expectedHandler = controllerActionHandlerFor(nextAction);
  const receipt = {
    schema: CONTROLLER_ACTION_RECEIPT_SCHEMA,
    version: CONTROLLER_ACTION_VERSION,
    receipt_id: receiptId,
    action_id: actionId,
    previous_receipt_sha256: previousReceiptSha256,
    semantic_before_sha256: semanticBeforeSha256,
    semantic_after_sha256: semanticAfterSha256,
    progress_delta_sha256: canonicalDigest({semantic_before_sha256: semanticBeforeSha256, semantic_after_sha256: semanticAfterSha256}),
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    next_action: nextAction,
    next_handler: nextHandler ?? expectedHandler,
    continuation: structuredClone(continuation ?? compileControllerContinuation(nextAction, {protectedEventId: protectedEvent?.blocker_id ?? null})),
    continuation_sha256: null,
    authority: structuredClone(authority),
    protected_event: structuredClone(protectedEvent),
    defect: structuredClone(defect),
    receipt_sha256: null,
  };
  receipt.continuation_sha256 = controllerContinuationDigest(receipt.continuation);
  receipt.receipt_sha256 = canonicalDigest({...receipt, receipt_sha256: null});
  return validateControllerActionReceipt(receipt);
}

function successorRoute(nextAction, {protectedEvent = null, defect = null} = {}) {
  const continuation = compileControllerContinuation(nextAction, {protectedEventId: protectedEvent?.blocker_id ?? null});
  return {
    next_action: nextAction,
    next_handler: controllerActionHandlerFor(nextAction),
    continuation,
    continuation_sha256: controllerContinuationDigest(continuation),
    protected_event: structuredClone(protectedEvent),
    defect: structuredClone(defect),
  };
}

export function deriveControllerSuccessor({localActions = [], protectedEvent = null, protectedActionId = "WAIT_FOR_PROTECTED_EVENT", ownerReview = false, defectId = "DEFECT.CONTROLLER.WORKFLOW.DEAD_END", evidenceRefs = [{evidence_id: "EVIDENCE.CONTROLLER.WORKFLOW.DEAD_END", reference: "opaque:controller-workflow-dead-end", sha256: canonicalDigest({evidence: "controller-workflow-dead-end"})}]} = {}) {
  if (protectedEvent !== null) {
    validateProtectedEvent(protectedEvent);
    assert(CONTROLLER_ACTION_REGISTRY[protectedActionId]?.mode === "PROTECTED_WAIT", "Controller protected successor action is invalid");
    return successorRoute(protectedActionId, {protectedEvent});
  }
  if (ownerReview) return successorRoute("OWNER_REVIEW");
  assert(Array.isArray(localActions), "Controller local successor actions are required");
  if (localActions.length > 0) {
    const nextAction = localActions[0];
    if (nextAction === "SELF_REPAIR_WORKFLOW_DEAD_END") {
      const defect = compileControllerActionDefect({defectId, defectClass: "WORKFLOW_DEAD_END", evidenceRefs});
      return successorRoute(nextAction, {defect});
    }
    return successorRoute(nextAction);
  }
  const defect = compileControllerActionDefect({defectId, defectClass: "WORKFLOW_DEAD_END", evidenceRefs});
  return successorRoute("SELF_REPAIR_WORKFLOW_DEAD_END", {defect});
}

export class ControllerActionDefect extends Error {
  constructor(defect, message = defect.defect_class) {
    super(message);
    this.name = "ControllerActionDefect";
    this.defect = defect;
    this.code = defect.defect_class;
  }
}

function dispatchDefect({currentReceipt, defectClass, message, onDefect}) {
  const receiptSha = isRecord(currentReceipt) && typeof currentReceipt.receipt_sha256 === "string" ? currentReceipt.receipt_sha256 : "unknown";
  const defect = compileControllerActionDefect({
    defectId: `DEFECT.CONTROLLER.ACTION.${defectClass}`,
    defectClass,
    evidenceRefs: [{evidence_id: `EVIDENCE.CONTROLLER.ACTION.${defectClass}`, reference: `ref:controller-action:${receiptSha}`, sha256: canonicalDigest({receipt_sha256: receiptSha, defect_class: defectClass})}],
  });
  if (typeof onDefect === "function") onDefect(defect);
  throw new ControllerActionDefect(defect, message);
}

function validateHandlerResult(result) {
  exactKeys(result, HANDLER_RESULT_KEYS, "Controller action handler result");
  requireSha(result.semantic_after_sha256, "Controller handler semantic state after");
  requireIdentifier(result.next_action, "Controller handler next action");
  requireIdentifier(result.next_handler, "Controller handler next handler");
  validateControllerContinuation(result.continuation, result.next_action);
  requireSha(result.continuation_sha256, "Controller handler continuation digest");
  assert(result.continuation_sha256 === controllerContinuationDigest(result.continuation), "Controller handler continuation digest mismatch");
  validateEvidenceRefs(result.evidence_refs, "Controller handler evidence refs");
  validateHostileRefs(result.hostile_fixture_refs);
  const descriptor = CONTROLLER_ACTION_REGISTRY[result.next_action];
  assert(descriptor !== undefined, "Controller handler successor action is not registered");
  if (descriptor.mode === "PROTECTED_WAIT") validateProtectedEvent(result.protected_event);
  else assert(result.protected_event === null, "Controller handler protected event is bound to a non-protected route");
  if (result.next_action === "SELF_REPAIR_WORKFLOW_DEAD_END") validateControllerActionDefect(result.defect);
  else assert(result.defect === null, "Controller handler defect must be null outside self-repair");
  return result;
}

export function advanceControllerAction(currentReceipt, {handlers, persist, onDefect, maxTransitions = 16} = {}) {
  try { validateControllerActionReceipt(currentReceipt); }
  catch (error) { return dispatchDefect({currentReceipt, defectClass: /handler/u.test(error.message) ? "STALE_OR_UNKNOWN_HANDLER" : "UNKNOWN_ACTION_ROUTE", message: error.message, onDefect}); }
  assert(isRecord(handlers), "Controller action handlers are required");
  if (typeof persist !== "function") return dispatchDefect({currentReceipt, defectClass: "MISSING_ATOMIC_PERSISTENCE", message: "Controller successor persistence is required", onDefect});
  assert(Number.isInteger(maxTransitions) && maxTransitions > 0, "Controller dispatch transition bound is invalid");
  let cursor = structuredClone(currentReceipt);
  const persisted = [];
  for (let step = 0; step < maxTransitions; step += 1) {
    const descriptor = CONTROLLER_ACTION_REGISTRY[cursor.next_action];
    if (descriptor.mode === "PROTECTED_WAIT") return {status: "PROTECTED_EVENT_WAIT", dispatched_count: step, receipt: cursor, persisted_receipts: persisted};
    if (descriptor.mode === "OWNER_REVIEW") return {status: "OWNER_REVIEW_REQUIRED", dispatched_count: step, receipt: cursor, persisted_receipts: persisted};
    const handler = handlers[cursor.next_handler];
    if (typeof handler !== "function") return dispatchDefect({currentReceipt: cursor, defectClass: "STALE_OR_UNKNOWN_HANDLER", message: `Missing handler ${cursor.next_handler}`, onDefect});
    let result;
    try { result = handler(structuredClone(cursor)); }
    catch (error) { return dispatchDefect({currentReceipt: cursor, defectClass: "DISPATCH_FAILED", message: error instanceof Error ? error.message : "Controller handler failed", onDefect}); }
    try {
      validateHandlerResult(result);
      assert(result.next_handler === controllerActionHandlerFor(result.next_action), "Controller handler successor does not match the action registry");
    } catch (error) {
      return dispatchDefect({currentReceipt: cursor, defectClass: /semantic state after|semantic state/u.test(error.message) ? "UNCHANGED_SEMANTIC_STATE" : "INVALID_SUCCESSOR", message: error.message, onDefect});
    }
    let successor;
    try {
      successor = compileControllerActionReceipt({
        receiptId: `${cursor.receipt_id}.NEXT.${String(step + 1).padStart(2, "0")}`,
        actionId: cursor.next_action,
        previousReceiptSha256: cursor.receipt_sha256,
        semanticBeforeSha256: cursor.semantic_after_sha256,
        semanticAfterSha256: result.semantic_after_sha256,
        evidenceRefs: result.evidence_refs,
        hostileFixtureRefs: result.hostile_fixture_refs,
        nextAction: result.next_action,
        nextHandler: result.next_handler,
        continuation: result.continuation,
        authority: CONTROLLER_ACTION_AUTHORITY,
        protectedEvent: result.protected_event,
        defect: result.defect,
      });
    } catch (error) {
      return dispatchDefect({currentReceipt: cursor, defectClass: /semantic state/u.test(error.message) ? "UNCHANGED_SEMANTIC_STATE" : "INVALID_SUCCESSOR", message: error.message, onDefect});
    }
    try {
      const persistedResult = persist(successor);
      assert(persistedResult !== false, "Controller successor persistence returned false");
    } catch (error) {
      return dispatchDefect({currentReceipt: cursor, defectClass: "MISSING_ATOMIC_PERSISTENCE", message: error instanceof Error ? error.message : "Controller successor persistence failed", onDefect});
    }
    persisted.push(successor);
    cursor = successor;
  }
  return dispatchDefect({currentReceipt: cursor, defectClass: "DISPATCH_FAILED", message: "Controller successor dispatch bound exhausted before a protected or explicit owner route", onDefect});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Controller action dispatcher contract loaded\n");
