#!/usr/bin/env node

/*
 * Project-agnostic binding gate for same-turn successor claims.
 *
 * A successor may request same-turn dispatch before its handler runs, but it
 * may not claim same-turn progress until the canonical dispatch readback
 * proves that the registry-bound handler was invoked and persisted.  This
 * wrapper closes the rebind/receipt gap without adding Controller approval.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {CONTROLLER_ACTION_REGISTRY, compileControllerContinuation, controllerActionHandlerFor} from "./controller-action-dispatcher.mjs";
import {compileActionResultContinuation, validateActionResultContinuation} from "./action-result-continuation.mjs";
import {validateOrchestratorSuccessorDispatchReadback} from "./orchestrator-successor-dispatch.mjs";

export const OBSERVED_DISPATCH_BINDING_SCHEMA = "agentos.observed_dispatch_successor_binding.v1";
export const OBSERVED_DISPATCH_BINDING_VERSION = 1;
export const OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS = "DISPATCH_REQUIRED";
export const OBSERVED_DISPATCH_BINDING_PROVEN_STATUS = "DISPATCH_PROVEN";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const BINDING_KEYS = Object.freeze([
  "schema", "version", "binding_id", "status", "source_successor_sha256", "source_action", "source_handler",
  "execution_owner", "direct_consumer", "controller_approval_required", "same_turn_dispatch", "progress_claimed",
  "dispatch_readback", "dispatch_observation", "evidence_refs", "hostile_fixture_refs", "binding_sha256",
]);
const OBSERVATION_KEYS = Object.freeze(["status", "handler_invoked", "handler", "dispatch_id", "readback_sha256"]);

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
  assert(value !== "0".repeat(64) && value !== "f".repeat(64), `${label} may not be a placeholder digest`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Observed dispatch binding evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Observed dispatch binding evidence ${index}`);
    requireIdentifier(ref.evidence_id, `Observed dispatch binding evidence ${index} id`);
    requireReference(ref.reference, `Observed dispatch binding evidence ${index} reference`);
    requireSha(ref.sha256, `Observed dispatch binding evidence ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Observed dispatch binding evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Observed dispatch binding hostile fixtures are required");
  assert(refs.every((value) => typeof value === "string" && IDENTIFIER.test(value)), "Observed dispatch binding hostile fixture is invalid");
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "Observed dispatch binding hostile fixtures must be sorted and unique");
  return refs;
}

function validateObservedHandler(observation, binding, readback) {
  exactKeys(observation, OBSERVATION_KEYS, "Observed dispatch handler proof");
  assert(observation.status === "OBSERVED", "Observed dispatch handler proof status is invalid");
  assert(observation.handler_invoked === true, "Observed dispatch handler invocation is not proven");
  assert(observation.handler === binding.source_handler, "Observed dispatch handler does not match the source handler");
  requireIdentifier(observation.dispatch_id, "Observed dispatch id");
  requireSha(observation.readback_sha256, "Observed dispatch readback binding");
  assert(observation.readback_sha256 === readback.readback_sha256, "Observed dispatch handler proof is bound to a different readback");
  assert(observation.dispatch_id === readback.dispatch_id, "Observed dispatch handler proof is bound to a different dispatch");
  return observation;
}

export function validateObservedDispatchSuccessorBinding(binding) {
  exactKeys(binding, BINDING_KEYS, "Observed dispatch successor binding");
  assert(binding.schema === OBSERVED_DISPATCH_BINDING_SCHEMA && binding.version === OBSERVED_DISPATCH_BINDING_VERSION, "Observed dispatch successor binding identity is invalid");
  requireIdentifier(binding.binding_id, "Observed dispatch successor binding id");
  assert([OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS, OBSERVED_DISPATCH_BINDING_PROVEN_STATUS].includes(binding.status), "Observed dispatch successor binding status is invalid");
  requireSha(binding.source_successor_sha256, "Observed dispatch source successor digest");
  requireIdentifier(binding.source_action, "Observed dispatch source action");
  requireIdentifier(binding.source_handler, "Observed dispatch source handler");
  assert(binding.source_handler === controllerActionHandlerFor(binding.source_action), "Observed dispatch source handler is not registry-bound");
  assert(binding.execution_owner === "LANE_AGENT", "Observed dispatch successor must remain lane-owned");
  assert(binding.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Observed dispatch successor must route to independent platform review");
  assert(binding.controller_approval_required === false, "Observed dispatch successor cannot require Controller approval");
  assert(binding.same_turn_dispatch === true, "Observed dispatch successor must require same-turn dispatch");
  assert(binding.progress_claimed === (binding.status === OBSERVED_DISPATCH_BINDING_PROVEN_STATUS), "Observed dispatch progress status is inconsistent");
  validateEvidenceRefs(binding.evidence_refs);
  validateHostileRefs(binding.hostile_fixture_refs);

  if (binding.progress_claimed) {
    assert(isRecord(binding.dispatch_readback), "Same-turn progress claim requires a dispatch readback");
    validateOrchestratorSuccessorDispatchReadback(binding.dispatch_readback);
    assert(binding.dispatch_readback.source_successor_sha256 === binding.source_successor_sha256, "Observed dispatch readback source successor is stale");
    assert(binding.dispatch_readback.source_action === binding.source_action, "Observed dispatch readback action is stale");
    assert(binding.dispatch_readback.source_handler === binding.source_handler, "Observed dispatch readback handler is stale");
    assert(binding.dispatch_readback.dispatch_observed === true && binding.dispatch_readback.dispatched_count > 0, "Same-turn progress claim lacks observed handler invocation");
    validateObservedHandler(binding.dispatch_observation, binding, binding.dispatch_readback);
  } else {
    assert(binding.status === OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS, "Unproven dispatch must remain DISPATCH_REQUIRED");
    assert(binding.dispatch_readback === null, "Unproven dispatch cannot carry a readback as an unclaimed wrapper");
    assert(binding.dispatch_observation === null, "Unproven dispatch cannot carry handler proof");
  }
  requireSha(binding.binding_sha256, "Observed dispatch binding digest");
  assert(binding.binding_sha256 === canonicalDigest({...binding, binding_sha256: null}), "Observed dispatch binding digest mismatch");
  return binding;
}

export function compileObservedDispatchSuccessorBinding({
  bindingId,
  sourceSuccessorSha256,
  sourceAction,
  sourceHandler = controllerActionHandlerFor(sourceAction),
  dispatchReadback = null,
  evidenceRefs,
  hostileFixtureRefs,
  executionOwner = "LANE_AGENT",
  directConsumer = "INDEPENDENT_PLATFORM_REVIEW",
  controllerApprovalRequired = false,
} = {}) {
  const progressClaimed = dispatchReadback !== null;
  const binding = {
    schema: OBSERVED_DISPATCH_BINDING_SCHEMA,
    version: OBSERVED_DISPATCH_BINDING_VERSION,
    binding_id: bindingId,
    status: progressClaimed ? OBSERVED_DISPATCH_BINDING_PROVEN_STATUS : OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS,
    source_successor_sha256: sourceSuccessorSha256,
    source_action: sourceAction,
    source_handler: sourceHandler,
    execution_owner: executionOwner,
    direct_consumer: directConsumer,
    controller_approval_required: controllerApprovalRequired,
    same_turn_dispatch: true,
    progress_claimed: progressClaimed,
    dispatch_readback: structuredClone(dispatchReadback),
    dispatch_observation: progressClaimed ? {
      status: "OBSERVED",
      handler_invoked: true,
      handler: sourceHandler,
      dispatch_id: dispatchReadback.dispatch_id,
      readback_sha256: dispatchReadback.readback_sha256,
    } : null,
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    binding_sha256: null,
  };
  binding.binding_sha256 = canonicalDigest({...binding, binding_sha256: null});
  return validateObservedDispatchSuccessorBinding(binding);
}

/*
 * Turn a pending binding into the one canonical source record that the
 * dispatch adapter can invoke.  The source action/handler come from the
 * registry-bound pending binding; callers cannot hand-edit a second action,
 * handler, or continuation record and accidentally create a circular or
 * unobserved rebind.  The returned record is still only a dispatch request;
 * progress is unclaimed until compileObservedDispatchSuccessorBinding is
 * called with the adapter's real readback.
 */
export function compileObservedDispatchSourceSuccessor({
  binding,
  actionId,
  resultId,
  result,
  semanticBeforeSha256,
  semanticAfterSha256,
  receiptRef,
  receiptSha256,
  evidenceRefs,
  hostileFixtureRefs,
} = {}) {
  validateObservedDispatchSuccessorBinding(binding);
  assert(binding.status === OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS, "Observed dispatch source successor requires a pending binding");
  assert(CONTROLLER_ACTION_REGISTRY[binding.source_action]?.mode === "LOCAL", "Observed dispatch source action must be a local registered route");
  assert(actionId === binding.source_action, "Observed dispatch source action ID must match the pending binding");
  assert(isRecord(result), "Observed dispatch source result is required");
  assert(result.controller_approval_required === false, "Observed dispatch source result cannot require Controller approval");
  assert(result.execution_owner === "LANE_AGENT", "Observed dispatch source result must remain lane-owned");
  assert(result.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Observed dispatch source result must route to independent review");
  const continuation = compileControllerContinuation(binding.source_action);
  return compileActionResultContinuation({
    actionId,
    resultId,
    result: structuredClone(result),
    semanticBeforeSha256,
    semanticAfterSha256,
    nextAction: binding.source_action,
    nextHandler: binding.source_handler,
    continuation,
    persistence: {
      status: "PERSISTED",
      receipt_ref: receiptRef,
      receipt_sha256: receiptSha256,
      atomic: true,
      same_turn: true,
      write_scope: "CONTROL_PLANE_ONLY",
    },
    evidenceRefs,
    hostileFixtureRefs,
  });
}

/*
 * Rebase a pending binding onto the source successor that is actually going
 * to be dispatched. A pending binding may preserve an old source digest as
 * evidence, but that stale digest must never be carried into a new dispatch
 * by hand. This boundary validates the successor's action, handler, custody,
 * and digest, then mints a new content-addressed pending binding.
 */
export function rebaseObservedDispatchPendingBinding({
  binding,
  sourceSuccessor,
  bindingId,
  evidenceRefs,
  hostileFixtureRefs,
} = {}) {
  validateObservedDispatchSuccessorBinding(binding);
  assert(binding.status === OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS, "Observed dispatch rebase requires a pending binding");
  assert(isRecord(sourceSuccessor), "Observed dispatch rebase source successor is required");
  validateActionResultContinuation(sourceSuccessor);
  assert(sourceSuccessor.continuation.mode === "IMMEDIATE_SAME_TURN" && sourceSuccessor.continuation.protected_event_id === null, "Observed dispatch rebase source successor must be local same-turn");
  assert(sourceSuccessor.next_action === binding.source_action, "Observed dispatch rebase source successor action does not match the pending route");
  assert(sourceSuccessor.next_handler === binding.source_handler, "Observed dispatch rebase source successor handler does not match the pending route");
  assert(sourceSuccessor.result?.controller_approval_required === false, "Observed dispatch rebase source successor cannot require Controller approval");
  assert(sourceSuccessor.result?.execution_owner === "LANE_AGENT", "Observed dispatch rebase source successor must remain lane-owned");
  assert(sourceSuccessor.result?.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Observed dispatch rebase source successor must route to independent review");
  requireIdentifier(bindingId, "Observed dispatch rebased binding id");
  assert(bindingId !== binding.binding_id, "Observed dispatch rebase must mint a successor binding id");
  return compileObservedDispatchSuccessorBinding({
    bindingId,
    sourceSuccessorSha256: sourceSuccessor.record_sha256,
    sourceAction: sourceSuccessor.next_action,
    sourceHandler: sourceSuccessor.next_handler,
    evidenceRefs,
    hostileFixtureRefs,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Observed dispatch successor binding gate loaded\n");
