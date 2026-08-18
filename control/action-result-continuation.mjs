#!/usr/bin/env node

/*
 * Project-agnostic liveness gate for completed Controller/Spawner actions.
 *
 * An action is not complete merely because a model chose a next_action.  It
 * must first persist a typed result, bind that result to the semantic state
 * transition, and expose the next registered route.  This contract is small
 * enough for every runtime/handler implementation to use and strict enough
 * to reject reasoning-only, placeholder, timer-only, or commentary-only
 * closeouts.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const ACTION_RESULT_CONTINUATION_SCHEMA = "agentos.action_result_continuation.v1";
export const ACTION_RESULT_CONTINUATION_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const CONTINUATION_KEYS = Object.freeze([
  "mode", "timer_deferral", "heartbeat_deferral", "same_turn_dispatch", "protected_event_id", "resume_condition",
]);
const PERSISTENCE_KEYS = Object.freeze(["status", "receipt_ref", "receipt_sha256", "atomic", "same_turn", "write_scope"]);
const RECORD_KEYS = Object.freeze([
  "schema", "version", "action_id", "result_id", "result", "result_sha256", "semantic_before_sha256",
  "semantic_after_sha256", "next_action", "next_handler", "continuation", "continuation_sha256", "persistence",
  "evidence_refs", "hostile_fixture_refs", "status", "record_sha256",
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
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable uppercase identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function requireText(value, label, minimumLength = 8) {
  assert(typeof value === "string" && value.trim().length >= minimumLength && !/[\u0000-\u001f\u007f]/u.test(value), `${label} is incomplete`);
}

function validateContinuation(continuation) {
  exactKeys(continuation, CONTINUATION_KEYS, "Action result continuation");
  assert(["IMMEDIATE_SAME_TURN", "EVENT_DRIVEN_PROTECTED_WAIT", "EXPLICIT_OWNER_REVIEW"].includes(continuation.mode), "Action result continuation mode is invalid");
  assert(continuation.timer_deferral === false && continuation.heartbeat_deferral === false, "Action result cannot defer to a timer or heartbeat");
  assert(continuation.same_turn_dispatch === (continuation.mode === "IMMEDIATE_SAME_TURN"), "Action result same-turn dispatch is inconsistent");
  if (continuation.mode === "EVENT_DRIVEN_PROTECTED_WAIT") requireIdentifier(continuation.protected_event_id, "Action result protected event");
  else assert(continuation.protected_event_id === null, "Non-protected action result cannot bind a protected event");
  requireText(continuation.resume_condition, "Action result resume condition");
  return continuation;
}

function validatePersistence(persistence, {mode} = {}) {
  exactKeys(persistence, PERSISTENCE_KEYS, "Action result persistence");
  const allowed = mode === "EVENT_DRIVEN_PROTECTED_WAIT" ? ["PERSISTED_PROTECTED_WAIT"] : ["PERSISTED"];
  assert(allowed.includes(persistence.status), "Action result persistence status is not terminal");
  requireReference(persistence.receipt_ref, "Action result persistence receipt");
  requireSha(persistence.receipt_sha256, "Action result persistence digest");
  assert(persistence.atomic === true && persistence.same_turn === true, "Action result persistence must be atomic and same-turn");
  assert(persistence.write_scope === "CONTROL_PLANE_ONLY", "Action result persistence crossed its write scope");
  return persistence;
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Action result evidence refs are required");
  const ids = refs.map((ref) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], "Action result evidence ref");
    requireIdentifier(ref.evidence_id, "Action result evidence id");
    requireReference(ref.reference, "Action result evidence reference");
    requireSha(ref.sha256, "Action result evidence digest");
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Action result evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Action result hostile fixtures are required");
  assert(refs.every((ref) => typeof ref === "string" && IDENTIFIER.test(ref)), "Action result hostile fixture id is invalid");
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "Action result hostile fixtures must be sorted and unique");
  return refs;
}

export function actionResultContinuationDigest(value) {
  return canonicalDigest(value);
}

export function validateActionResultContinuation(record) {
  exactKeys(record, RECORD_KEYS, "Action result continuation record");
  assert(record.schema === ACTION_RESULT_CONTINUATION_SCHEMA && record.version === ACTION_RESULT_CONTINUATION_VERSION, "Action result continuation identity is invalid");
  requireIdentifier(record.action_id, "Action result action id");
  requireIdentifier(record.result_id, "Action result id");
  assert(isRecord(record.result) && Object.keys(record.result).length > 0, "Action result must contain a typed, non-empty result");
  requireSha(record.result_sha256, "Action result digest");
  assert(record.result_sha256 === canonicalDigest(record.result), "Action result digest does not match its result");
  requireSha(record.semantic_before_sha256, "Action result semantic state before");
  requireSha(record.semantic_after_sha256, "Action result semantic state after");
  assert(record.semantic_before_sha256 !== record.semantic_after_sha256, "Action result did not advance semantic state");
  requireIdentifier(record.next_action, "Action result next action");
  assert(record.next_action !== "NONE" && record.next_action !== "DONE", "Action result cannot close without a successor");
  requireIdentifier(record.next_handler, "Action result next handler");
  const continuation = validateContinuation(record.continuation);
  requireSha(record.continuation_sha256, "Action result continuation digest");
  assert(record.continuation_sha256 === canonicalDigest(continuation), "Action result continuation digest mismatch");
  validatePersistence(record.persistence, continuation);
  validateEvidenceRefs(record.evidence_refs);
  validateHostileRefs(record.hostile_fixture_refs);
  assert(["RESULT_PERSISTED", "PROTECTED_WAIT_PERSISTED", "OWNER_REVIEW_PERSISTED"].includes(record.status), "Action result status is not persisted");
  requireSha(record.record_sha256, "Action result record digest");
  assert(record.record_sha256 === canonicalDigest({...record, record_sha256: null}), "Action result record digest mismatch");
  return record;
}

export function compileActionResultContinuation({
  actionId,
  resultId,
  result,
  semanticBeforeSha256,
  semanticAfterSha256,
  nextAction,
  nextHandler,
  continuation,
  persistence,
  evidenceRefs,
  hostileFixtureRefs,
  status = "RESULT_PERSISTED",
} = {}) {
  const normalizedEvidenceRefs = Array.isArray(evidenceRefs)
    ? [...evidenceRefs].sort((left, right) => compareUtf8(left?.evidence_id ?? "", right?.evidence_id ?? ""))
    : evidenceRefs;
  const normalizedHostileFixtureRefs = Array.isArray(hostileFixtureRefs)
    ? [...hostileFixtureRefs].sort(compareUtf8)
    : hostileFixtureRefs;
  const record = {
    schema: ACTION_RESULT_CONTINUATION_SCHEMA,
    version: ACTION_RESULT_CONTINUATION_VERSION,
    action_id: actionId,
    result_id: resultId,
    result,
    result_sha256: isRecord(result) ? canonicalDigest(result) : null,
    semantic_before_sha256: semanticBeforeSha256,
    semantic_after_sha256: semanticAfterSha256,
    next_action: nextAction,
    next_handler: nextHandler,
    continuation: structuredClone(continuation),
    continuation_sha256: isRecord(continuation) ? canonicalDigest(continuation) : null,
    persistence: structuredClone(persistence),
    evidence_refs: structuredClone(normalizedEvidenceRefs),
    hostile_fixture_refs: structuredClone(normalizedHostileFixtureRefs),
    status,
    record_sha256: null,
  };
  record.record_sha256 = canonicalDigest({...record, record_sha256: null});
  validateActionResultContinuation(record);
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Action result continuation contract loaded\n");
