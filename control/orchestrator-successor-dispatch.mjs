#!/usr/bin/env node

/*
 * Project-agnostic adapter that turns an Orchestrator's typed successor
 * declaration into an observed same-turn dispatch.  A declaration that only
 * says `same_turn_dispatch=true` is not proof that the handler ran.  This
 * adapter binds the declaration to the closed Controller action dispatcher,
 * requires a real handler invocation and atomic persistence, and returns a
 * content-addressed readback of the observed successor.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  CONTROLLER_ACTION_REGISTRY,
  CONTROLLER_ACTION_AUTHORITY,
  compileControllerActionReceipt,
  compileControllerContinuation,
  controllerActionHandlerFor,
  advanceControllerAction,
  validateControllerActionReceipt,
} from "./controller-action-dispatcher.mjs";
import {validateActionResultContinuation} from "./action-result-continuation.mjs";

export const ORCHESTRATOR_SUCCESSOR_DISPATCH_SCHEMA = "agentos.orchestrator_successor_dispatch.v1";
export const ORCHESTRATOR_SUCCESSOR_DISPATCH_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const DISPATCHABLE_ACTIONS = Object.freeze([
  "START_ISOLATED_AUDIT_LANES",
  "START_SPECIALIST_WAVE",
  "START_PLATFORM_REVIEW",
  "START_CENTRAL_INTEGRATION",
  "START_INDEPENDENT_REAUDIT",
  "PREPARE_CANDIDATE_REVIEW",
  "PREPARE_PYRAMID_IMPORT_OUTPUT",
  "MATERIALIZE_NEW_PROJECT_REPOSITORIES",
].filter((action) => Object.hasOwn(CONTROLLER_ACTION_REGISTRY, action)).sort(compareUtf8));
const READBACK_KEYS = Object.freeze([
  "schema", "version", "dispatch_id", "status", "source_successor_sha256", "source_action", "source_handler",
  "dispatched_count", "persisted_receipt_sha256s", "final_receipt_sha256", "final_next_action", "final_next_handler",
  "dispatch_observed", "continuation", "scope", "evidence_refs", "hostile_fixture_refs", "readback_sha256",
]);
const CONTINUATION_KEYS = Object.freeze([
  "mode", "timer_deferral", "heartbeat_deferral", "same_turn_dispatch", "protected_event_id", "resume_condition",
]);
const SCOPE_KEYS = Object.freeze([
  "control_plane_only", "consumer_product_mutated", "provider_access", "credential_access", "spend", "destructive_work",
  "deployment_publication_merge", "protected_event_id",
]);

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

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Orchestrator dispatch evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Orchestrator dispatch evidence ref ${index}`);
    requireIdentifier(ref.evidence_id, `Orchestrator dispatch evidence ref ${index} id`);
    requireReference(ref.reference, `Orchestrator dispatch evidence ref ${index} reference`);
    requireSha(ref.sha256, `Orchestrator dispatch evidence ref ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Orchestrator dispatch evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Orchestrator dispatch hostile fixtures are required");
  assert(refs.every((value) => typeof value === "string" && IDENTIFIER.test(value)), "Orchestrator dispatch hostile fixture is invalid");
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "Orchestrator dispatch hostile fixtures must be sorted and unique");
  return refs;
}

function validateSuccessor(successor) {
  validateActionResultContinuation(successor);
  assert(DISPATCHABLE_ACTIONS.includes(successor.next_action), `Orchestrator successor action ${successor.next_action} is not dispatchable`);
  assert(successor.next_handler === controllerActionHandlerFor(successor.next_action), "Orchestrator successor handler is stale");
  assert(successor.continuation.mode === "IMMEDIATE_SAME_TURN" && successor.continuation.same_turn_dispatch === true, "Orchestrator successor must require same-turn dispatch");
  assert(successor.continuation.timer_deferral === false && successor.continuation.heartbeat_deferral === false, "Orchestrator successor cannot defer to a timer or heartbeat");
  assert(successor.continuation.protected_event_id === null, "Orchestrator local successor cannot carry a protected event");
  assert(successor.persistence.write_scope === "CONTROL_PLANE_ONLY", "Orchestrator dispatch may only persist control-plane state");
  return successor;
}

function validateContinuation(continuation) {
  exactKeys(continuation, CONTINUATION_KEYS, "Orchestrator dispatch continuation");
  assert(continuation.mode === "IMMEDIATE_SAME_TURN", "Orchestrator dispatch continuation must be immediate");
  assert(continuation.timer_deferral === false && continuation.heartbeat_deferral === false, "Orchestrator dispatch continuation cannot defer");
  assert(continuation.same_turn_dispatch === true && continuation.protected_event_id === null, "Orchestrator dispatch continuation boundary is invalid");
  assert(typeof continuation.resume_condition === "string" && continuation.resume_condition.length >= 8, "Orchestrator dispatch resume condition is incomplete");
}

function validateScope(scope) {
  exactKeys(scope, SCOPE_KEYS, "Orchestrator dispatch scope");
  assert(scope.control_plane_only === true, "Orchestrator dispatch must be control-plane-only");
  for (const field of ["consumer_product_mutated", "provider_access", "credential_access", "spend", "destructive_work", "deployment_publication_merge"]) {
    assert(scope[field] === false, `Orchestrator dispatch crossed protected boundary: ${field}`);
  }
  assert(scope.protected_event_id === null, "Orchestrator local dispatch cannot bind a protected event");
  return scope;
}

export function validateOrchestratorSuccessorDispatchReadback(readback) {
  exactKeys(readback, READBACK_KEYS, "Orchestrator successor dispatch readback");
  assert(readback.schema === ORCHESTRATOR_SUCCESSOR_DISPATCH_SCHEMA && readback.version === ORCHESTRATOR_SUCCESSOR_DISPATCH_VERSION, "Orchestrator successor dispatch identity is invalid");
  requireIdentifier(readback.dispatch_id, "Orchestrator successor dispatch id");
  assert(readback.status === "DISPATCHED_SAME_TURN", "Orchestrator successor dispatch is not a same-turn dispatch");
  requireSha(readback.source_successor_sha256, "Orchestrator source successor digest");
  requireIdentifier(readback.source_action, "Orchestrator source action");
  requireIdentifier(readback.source_handler, "Orchestrator source handler");
  assert(DISPATCHABLE_ACTIONS.includes(readback.source_action), "Orchestrator source action is not dispatchable");
  assert(readback.source_handler === controllerActionHandlerFor(readback.source_action), "Orchestrator source handler is stale");
  assert(Number.isSafeInteger(readback.dispatched_count) && readback.dispatched_count > 0, "Orchestrator dispatch must invoke at least one handler");
  assert(Array.isArray(readback.persisted_receipt_sha256s) && readback.persisted_receipt_sha256s.length === readback.dispatched_count, "Orchestrator dispatch persistence count does not prove every transition");
  readback.persisted_receipt_sha256s.forEach((value, index) => requireSha(value, `Orchestrator persisted receipt ${index}`));
  requireSha(readback.final_receipt_sha256, "Orchestrator final receipt digest");
  requireIdentifier(readback.final_next_action, "Orchestrator final next action");
  requireIdentifier(readback.final_next_handler, "Orchestrator final next handler");
  assert(readback.final_next_handler === controllerActionHandlerFor(readback.final_next_action), "Orchestrator final next handler is stale");
  assert(readback.dispatch_observed === true, "Orchestrator dispatch observation is missing");
  validateContinuation(readback.continuation);
  validateScope(readback.scope);
  validateEvidenceRefs(readback.evidence_refs);
  validateHostileRefs(readback.hostile_fixture_refs);
  requireSha(readback.readback_sha256, "Orchestrator dispatch readback digest");
  assert(readback.readback_sha256 === canonicalDigest({...readback, readback_sha256: null}), "Orchestrator dispatch readback digest mismatch");
  return readback;
}

export function dispatchOrchestratorSuccessor({successor, dispatchId, handlers, persist, onDefect, maxTransitions = 1} = {}) {
  validateSuccessor(successor);
  requireIdentifier(dispatchId, "Orchestrator dispatch id");
  assert(isRecord(handlers), "Orchestrator dispatch handlers are required");
  assert(typeof persist === "function", "Orchestrator dispatch persistence is required");
  assert(Number.isSafeInteger(maxTransitions) && maxTransitions > 0, "Orchestrator dispatch transition bound is invalid");

  const current = compileControllerActionReceipt({
    receiptId: `${dispatchId}.SOURCE`,
    actionId: successor.action_id,
    previousReceiptSha256: successor.record_sha256,
    semanticBeforeSha256: successor.semantic_before_sha256,
    semanticAfterSha256: successor.semantic_after_sha256,
    evidenceRefs: successor.evidence_refs,
    hostileFixtureRefs: successor.hostile_fixture_refs,
    nextAction: successor.next_action,
    nextHandler: successor.next_handler,
    continuation: compileControllerContinuation(successor.next_action),
    authority: CONTROLLER_ACTION_AUTHORITY,
  });
  validateControllerActionReceipt(current);

  const dispatched = advanceControllerAction(current, {
    handlers,
    persist,
    onDefect,
    maxTransitions,
  });
  assert(dispatched.status === "ROUTED_SAME_TURN", "Orchestrator successor did not complete a local same-turn dispatch");
  assert(dispatched.dispatched_count > 0 && dispatched.persisted_receipts.length === dispatched.dispatched_count, "Orchestrator successor dispatch was not observed and persisted");
  const finalReceipt = dispatched.receipt;
  const readback = {
    schema: ORCHESTRATOR_SUCCESSOR_DISPATCH_SCHEMA,
    version: ORCHESTRATOR_SUCCESSOR_DISPATCH_VERSION,
    dispatch_id: dispatchId,
    status: "DISPATCHED_SAME_TURN",
    source_successor_sha256: successor.record_sha256,
    source_action: successor.next_action,
    source_handler: successor.next_handler,
    dispatched_count: dispatched.dispatched_count,
    persisted_receipt_sha256s: dispatched.persisted_receipts.map((receipt) => receipt.receipt_sha256),
    final_receipt_sha256: finalReceipt.receipt_sha256,
    final_next_action: finalReceipt.next_action,
    final_next_handler: finalReceipt.next_handler,
    dispatch_observed: true,
    continuation: {
      mode: "IMMEDIATE_SAME_TURN",
      timer_deferral: false,
      heartbeat_deferral: false,
      same_turn_dispatch: true,
      protected_event_id: null,
      resume_condition: `Dispatch ${finalReceipt.next_action} through ${finalReceipt.next_handler} in this same lifecycle turn.`,
    },
    scope: {
      control_plane_only: true,
      consumer_product_mutated: false,
      provider_access: false,
      credential_access: false,
      spend: false,
      destructive_work: false,
      deployment_publication_merge: false,
      protected_event_id: null,
    },
    evidence_refs: [
      ...successor.evidence_refs,
      {
        evidence_id: `EVIDENCE.ORCHESTRATOR.DISPATCH.${dispatchId}`,
        reference: `opaque:orchestrator-successor-dispatch/${dispatchId.toLowerCase()}`,
        sha256: canonicalDigest({dispatch_id: dispatchId, source_successor_sha256: successor.record_sha256, final_receipt_sha256: finalReceipt.receipt_sha256}),
      },
    ].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)),
    hostile_fixture_refs: [...new Set([
      ...successor.hostile_fixture_refs,
      "FIXTURE.ORCHESTRATOR.DISPATCH.MISSING_HANDLER",
      "FIXTURE.ORCHESTRATOR.DISPATCH.PERSIST_FALSE",
      "FIXTURE.ORCHESTRATOR.DISPATCH.UNCHANGED_SEMANTIC_STATE",
      "FIXTURE.ORCHESTRATOR.DISPATCH.CLAIMED_BUT_NOT_INVOKED",
    ])].sort(compareUtf8),
    readback_sha256: null,
  };
  readback.readback_sha256 = canonicalDigest({...readback, readback_sha256: null});
  return validateOrchestratorSuccessorDispatchReadback(readback);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Orchestrator successor dispatch contract loaded\n");
