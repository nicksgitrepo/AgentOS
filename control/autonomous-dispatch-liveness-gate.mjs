#!/usr/bin/env node

/*
 * Project-agnostic gate for an autonomous handoff's same-turn dispatch.
 *
 * A handoff declaration is not an invocation.  This boundary accepts a
 * dispatch only when a registered direct-consumer handler produced a
 * persisted result/readback.  If that evidence is absent after the bound
 * turn budget, the only admissible closeout is a durable same-turn retry
 * checkpoint.  Commentary, timers, and approval waits never satisfy it.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const AUTONOMOUS_DISPATCH_LIVENESS_GATE_SCHEMA = "agentos.autonomous_dispatch_liveness_gate.v1";
export const AUTONOMOUS_DISPATCH_LIVENESS_GATE_VERSION = 1;
export const AUTONOMOUS_DISPATCH_RETRY_ACTION = "REPAIR_BLOCKS";
export const AUTONOMOUS_DISPATCH_RETRY_HANDLER = "HANDLER.ORCHESTRATOR_BLOCK_REPAIR";
export const AUTONOMOUS_DISPATCH_RETRY_ROUTE = Object.freeze({
  next_action: AUTONOMOUS_DISPATCH_RETRY_ACTION,
  next_handler: AUTONOMOUS_DISPATCH_RETRY_HANDLER,
  same_turn_dispatch: true,
});

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40,64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "defect_id", "turn_window", "source_handoff", "expected_dispatch",
  "observed_dispatch", "retry_checkpoint", "lane_execution", "direct_consumer", "controller_approval_required",
  "commentary_only", "authority_binding", "scope", "evidence_refs", "hostile_fixture_refs", "status", "gate_sha256",
]);
const TURN_WINDOW_KEYS = Object.freeze([
  "start_at_utc", "observed_at_utc", "elapsed_seconds", "threshold_seconds", "overlong", "measurement_ref",
]);
const HANDOFF_KEYS = Object.freeze([
  "handoff_ref", "handoff_sha256", "handoff_status", "expected_next_action", "expected_next_handler",
  "direct_consumer", "controller_approval_required", "same_turn_dispatch", "lane_execution",
]);
const EXPECTED_DISPATCH_KEYS = Object.freeze(["action", "handler", "direct_consumer", "same_turn_dispatch", "registered"]);
const OBSERVED_DISPATCH_KEYS = Object.freeze([
  "status", "invocation_ref", "invocation_sha256", "action", "handler", "direct_consumer", "invoked",
  "same_turn_dispatch", "result_ref", "result_sha256", "readback_ref", "readback_sha256", "readback_status",
]);
const RETRY_CHECKPOINT_KEYS = Object.freeze([
  "schema", "version", "checkpoint_id", "status", "reason_code", "next_action", "next_handler", "direct_consumer",
  "controller_approval_required", "lane_execution", "same_turn_dispatch", "persistence", "checkpoint_sha256",
]);
const PERSISTENCE_KEYS = Object.freeze(["receipt_ref", "receipt_sha256", "atomic", "same_turn", "write_scope"]);
const AUTHORITY_KEYS = Object.freeze([
  "authority_commit", "authority_tree", "authority_receipt_ref", "authority_receipt_sha256", "source_mapping_sha256",
]);
const SCOPE_KEYS = Object.freeze([
  "control_plane_only", "consumer_product_mutated", "provider_access", "credential_access", "external_sync", "spend",
  "destructive_work", "deployment", "publication", "merge", "protected_event_id", "timers", "polling",
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
  assert(value !== "0".repeat(64) && value !== "f".repeat(64), `${label} may not be a placeholder digest`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object id`);
  assert(!/^0+$/u.test(value) && !/^f+$/u.test(value), `${label} may not be a placeholder object id`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function requireUtc(value, label, {allowNull = false} = {}) {
  if (allowNull && value === null) return;
  assert(typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be an ISO UTC timestamp`);
}

function validateTurnWindow(window) {
  exactKeys(window, TURN_WINDOW_KEYS, "Autonomous dispatch turn window");
  requireUtc(window.start_at_utc, "Autonomous dispatch turn start", {allowNull: true});
  requireUtc(window.observed_at_utc, "Autonomous dispatch observation", {allowNull: true});
  assert(Number.isSafeInteger(window.elapsed_seconds) && window.elapsed_seconds >= 0, "Autonomous dispatch elapsed seconds are invalid");
  assert(Number.isSafeInteger(window.threshold_seconds) && window.threshold_seconds > 0, "Autonomous dispatch threshold is invalid");
  assert(window.overlong === (window.elapsed_seconds > window.threshold_seconds), "Autonomous dispatch overlong decision is inconsistent");
  requireReference(window.measurement_ref, "Autonomous dispatch duration evidence");
  if (window.start_at_utc !== null || window.observed_at_utc !== null) {
    assert(window.start_at_utc !== null && window.observed_at_utc !== null, "Autonomous dispatch timestamps must be paired");
    const elapsed = Math.floor((Date.parse(window.observed_at_utc) - Date.parse(window.start_at_utc)) / 1000);
    assert(elapsed === window.elapsed_seconds, "Autonomous dispatch elapsed seconds do not match timestamps");
  }
  assert(window.overlong === true, "Autonomous dispatch liveness gate applies only after the turn budget is exceeded");
  return window;
}

function validateSourceHandoff(handoff) {
  exactKeys(handoff, HANDOFF_KEYS, "Autonomous dispatch source handoff");
  requireReference(handoff.handoff_ref, "Autonomous dispatch source handoff reference");
  requireSha(handoff.handoff_sha256, "Autonomous dispatch source handoff digest");
  requireIdentifier(handoff.handoff_status, "Autonomous dispatch source handoff status");
  requireIdentifier(handoff.expected_next_action, "Autonomous dispatch source next action");
  requireIdentifier(handoff.expected_next_handler, "Autonomous dispatch source next handler");
  assert(handoff.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Autonomous dispatch source direct consumer is not independent review");
  assert(handoff.controller_approval_required === false, "Autonomous dispatch source unexpectedly requires Controller approval");
  assert(handoff.same_turn_dispatch === true, "Autonomous dispatch source must require same-turn dispatch");
  assert(handoff.lane_execution === "AUTONOMOUS_TYPED_HANDOFF", "Autonomous dispatch source lane execution is not autonomous");
  return handoff;
}

function validateExpectedDispatch(dispatch) {
  exactKeys(dispatch, EXPECTED_DISPATCH_KEYS, "Autonomous dispatch expectation");
  requireIdentifier(dispatch.action, "Autonomous dispatch expected action");
  requireIdentifier(dispatch.handler, "Autonomous dispatch expected handler");
  assert(dispatch.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Autonomous dispatch expected direct consumer is not independent review");
  assert(dispatch.same_turn_dispatch === true, "Autonomous dispatch expectation must be same-turn");
  assert(dispatch.registered === true, "Autonomous dispatch handler is not registered");
  return dispatch;
}

function validateObservedDispatch(dispatch, expected) {
  exactKeys(dispatch, OBSERVED_DISPATCH_KEYS, "Autonomous observed dispatch");
  assert(dispatch.status === "OBSERVED", "Autonomous observed dispatch status is invalid");
  requireReference(dispatch.invocation_ref, "Autonomous invocation reference");
  requireSha(dispatch.invocation_sha256, "Autonomous invocation digest");
  assert(dispatch.action === expected.action, "Autonomous observed action diverges from expected dispatch");
  assert(dispatch.handler === expected.handler, "Autonomous observed handler diverges from expected dispatch");
  assert(dispatch.direct_consumer === expected.direct_consumer, "Autonomous observed direct consumer diverges from expected dispatch");
  assert(dispatch.invoked === true, "Autonomous handler invocation is not observed");
  assert(dispatch.same_turn_dispatch === true, "Autonomous handler invocation was not same-turn");
  requireReference(dispatch.result_ref, "Autonomous dispatch result reference");
  requireSha(dispatch.result_sha256, "Autonomous dispatch result digest");
  requireReference(dispatch.readback_ref, "Autonomous dispatch readback reference");
  requireSha(dispatch.readback_sha256, "Autonomous dispatch readback digest");
  assert(["PASS", "DISPATCHED_SAME_TURN"].includes(dispatch.readback_status), "Autonomous dispatch readback is not successful");
  return dispatch;
}

function validatePersistence(persistence) {
  exactKeys(persistence, PERSISTENCE_KEYS, "Autonomous retry checkpoint persistence");
  requireReference(persistence.receipt_ref, "Autonomous retry checkpoint receipt reference");
  requireSha(persistence.receipt_sha256, "Autonomous retry checkpoint receipt digest");
  assert(persistence.atomic === true && persistence.same_turn === true, "Autonomous retry checkpoint must be atomic and same-turn");
  assert(persistence.write_scope === "CONTROL_PLANE_ONLY", "Autonomous retry checkpoint crossed its write scope");
  return persistence;
}

function validateRetryCheckpoint(checkpoint) {
  exactKeys(checkpoint, RETRY_CHECKPOINT_KEYS, "Autonomous retry checkpoint");
  assert(checkpoint.schema === "agentos.typed_retry_checkpoint.v1" && checkpoint.version === 1, "Autonomous retry checkpoint identity is invalid");
  requireIdentifier(checkpoint.checkpoint_id, "Autonomous retry checkpoint id");
  assert(checkpoint.status === "RETRY_REQUIRED", "Autonomous retry checkpoint status is invalid");
  requireIdentifier(checkpoint.reason_code, "Autonomous retry checkpoint reason");
  assert(checkpoint.next_action === AUTONOMOUS_DISPATCH_RETRY_ACTION, "Autonomous retry checkpoint action is not block repair");
  assert(checkpoint.next_handler === AUTONOMOUS_DISPATCH_RETRY_HANDLER, "Autonomous retry checkpoint handler is not block repair");
  assert(checkpoint.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Autonomous retry checkpoint direct consumer is not independent review");
  assert(checkpoint.controller_approval_required === false, "Autonomous retry checkpoint requires Controller approval");
  assert(checkpoint.lane_execution === "AUTONOMOUS_TYPED_HANDOFF", "Autonomous retry checkpoint lane execution is not autonomous");
  assert(checkpoint.same_turn_dispatch === true, "Autonomous retry checkpoint must be same-turn");
  validatePersistence(checkpoint.persistence);
  requireSha(checkpoint.checkpoint_sha256, "Autonomous retry checkpoint digest");
  assert(checkpoint.checkpoint_sha256 === canonicalDigest({...checkpoint, checkpoint_sha256: null}), "Autonomous retry checkpoint digest mismatch");
  return checkpoint;
}

function validateAuthorityBinding(binding) {
  exactKeys(binding, AUTHORITY_KEYS, "Autonomous dispatch authority binding");
  requireGitObject(binding.authority_commit, "Autonomous dispatch authority commit");
  requireGitObject(binding.authority_tree, "Autonomous dispatch authority tree");
  requireReference(binding.authority_receipt_ref, "Autonomous dispatch authority receipt reference");
  requireSha(binding.authority_receipt_sha256, "Autonomous dispatch authority receipt digest");
  requireSha(binding.source_mapping_sha256, "Autonomous dispatch source mapping digest");
  return binding;
}

function validateScope(scope) {
  exactKeys(scope, SCOPE_KEYS, "Autonomous dispatch scope");
  assert(scope.control_plane_only === true, "Autonomous dispatch must remain control-plane-only");
  for (const field of ["consumer_product_mutated", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "deployment", "publication", "merge"]) {
    assert(scope[field] === false, `Autonomous dispatch crossed protected boundary: ${field}`);
  }
  assert(scope.protected_event_id === null, "Autonomous dispatch cannot defer to a protected event");
  assert(scope.timers === 0 && scope.polling === false, "Autonomous dispatch cannot use timer or polling liveness");
  return scope;
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Autonomous dispatch evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Autonomous dispatch evidence ref ${index}`);
    requireIdentifier(ref.evidence_id, `Autonomous dispatch evidence ref ${index} id`);
    requireReference(ref.reference, `Autonomous dispatch evidence ref ${index} reference`);
    requireSha(ref.sha256, `Autonomous dispatch evidence ref ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Autonomous dispatch evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Autonomous dispatch hostile fixtures are required");
  assert(refs.every((value) => typeof value === "string" && IDENTIFIER.test(value)), "Autonomous dispatch hostile fixture is invalid");
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "Autonomous dispatch hostile fixtures must be sorted and unique");
  return refs;
}

export function validateAutonomousDispatchLivenessGate(gate) {
  exactKeys(gate, GATE_KEYS, "Autonomous dispatch liveness gate");
  assert(gate.schema === AUTONOMOUS_DISPATCH_LIVENESS_GATE_SCHEMA && gate.version === AUTONOMOUS_DISPATCH_LIVENESS_GATE_VERSION, "Autonomous dispatch liveness gate identity is invalid");
  requireIdentifier(gate.gate_id, "Autonomous dispatch liveness gate id");
  requireIdentifier(gate.defect_id, "Autonomous dispatch liveness defect id");
  validateTurnWindow(gate.turn_window);
  validateSourceHandoff(gate.source_handoff);
  const expected = validateExpectedDispatch(gate.expected_dispatch);
  assert(gate.source_handoff.expected_next_action === expected.action, "Autonomous source handoff action is stale");
  assert(gate.source_handoff.expected_next_handler === expected.handler, "Autonomous source handoff handler is stale");
  assert(gate.lane_execution === "AUTONOMOUS_TYPED_HANDOFF", "Autonomous dispatch lane execution is invalid");
  assert(gate.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Autonomous dispatch direct consumer is invalid");
  assert(gate.controller_approval_required === false, "Autonomous dispatch unexpectedly requires Controller approval");
  assert(gate.commentary_only === false, "Commentary-only closeout is not admissible");
  const authority = validateAuthorityBinding(gate.authority_binding);
  validateScope(gate.scope);
  validateEvidenceRefs(gate.evidence_refs);
  validateHostileRefs(gate.hostile_fixture_refs);

  const hasObserved = gate.observed_dispatch !== null;
  const hasRetry = gate.retry_checkpoint !== null;
  assert(hasObserved !== hasRetry, "Autonomous dispatch gate requires exactly one observed dispatch or retry checkpoint");
  if (hasObserved) {
    validateObservedDispatch(gate.observed_dispatch, expected);
    assert(gate.retry_checkpoint === null, "A successful dispatch cannot also carry a retry checkpoint");
    assert(gate.status === "PASS", "Observed dispatch must produce a PASS gate");
  } else {
    validateRetryCheckpoint(gate.retry_checkpoint);
    assert(gate.observed_dispatch === null, "A retry checkpoint cannot claim an observed dispatch");
    assert(gate.status === "RETRY_REQUIRED", "Missing dispatch must produce a retry gate");
  }
  requireIdentifier(gate.status, "Autonomous dispatch gate status");
  requireSha(gate.gate_sha256, "Autonomous dispatch gate digest");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "Autonomous dispatch gate digest mismatch");
  // Keep the binding read even though it is currently structural; this makes
  // stale-authority checks explicit at every future integration point.
  assert(authority.authority_commit.length >= 40 && authority.authority_tree.length >= 40, "Autonomous dispatch authority binding is incomplete");
  return gate;
}

export function compileAutonomousDispatchLivenessGate({
  gateId,
  defectId,
  turnWindow,
  sourceHandoff,
  expectedDispatch,
  observedDispatch = null,
  retryCheckpoint = null,
  authorityBinding,
  scope,
  evidenceRefs,
  hostileFixtureRefs,
} = {}) {
  const checkpoint = retryCheckpoint === null ? null : {...structuredClone(retryCheckpoint), checkpoint_sha256: null};
  if (checkpoint !== null) checkpoint.checkpoint_sha256 = canonicalDigest(checkpoint);
  const gate = {
    schema: AUTONOMOUS_DISPATCH_LIVENESS_GATE_SCHEMA,
    version: AUTONOMOUS_DISPATCH_LIVENESS_GATE_VERSION,
    gate_id: gateId,
    defect_id: defectId,
    turn_window: structuredClone(turnWindow),
    source_handoff: structuredClone(sourceHandoff),
    expected_dispatch: structuredClone(expectedDispatch),
    observed_dispatch: structuredClone(observedDispatch),
    retry_checkpoint: checkpoint,
    lane_execution: "AUTONOMOUS_TYPED_HANDOFF",
    direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
    controller_approval_required: false,
    commentary_only: false,
    authority_binding: structuredClone(authorityBinding),
    scope: structuredClone(scope),
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: structuredClone(hostileFixtureRefs),
    status: observedDispatch === null ? "RETRY_REQUIRED" : "PASS",
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest(gate);
  return validateAutonomousDispatchLivenessGate(gate);
}

export function evaluateAutonomousDispatchLiveness({observedDispatch = null, retryCheckpoint = null} = {}) {
  assert((observedDispatch !== null) !== (retryCheckpoint !== null), "Autonomous dispatch evaluation requires exactly one durable outcome");
  return observedDispatch !== null
    ? {status: "PASS", next_action: "CONTINUE_NEXT_ACTION", durable_readback: true, commentary_only: false}
    : {status: "RETRY_REQUIRED", next_action: AUTONOMOUS_DISPATCH_RETRY_ACTION, durable_readback: true, commentary_only: false};
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Autonomous dispatch liveness gate contract loaded\n");
