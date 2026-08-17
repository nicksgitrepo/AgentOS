#!/usr/bin/env node

/*
 * Project-agnostic executable bridge for the Controller startup sequence.
 *
 * The startup compiler describes the next action; this runner makes that
 * description live. It persists the initial cursor, dispatches only the
 * registered local handlers in the same turn, persists every successor, and
 * emits a non-null readback. A protected wait is returned only when the
 * cursor already carries a validated typed event.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  CONTROLLER_ACTION_REGISTRY,
  CONTROLLER_ACTION_AUTHORITY,
  advanceControllerAction,
  compileControllerActionReceipt,
  validateControllerActionReceipt,
  validateControllerNextLifecycleHandoff,
} from "./controller-action-dispatcher.mjs";
import {validateControllerStartupSuccessor} from "./controller-startup-sequence.mjs";

export const CONTROLLER_STARTUP_RUNNER_SCHEMA = "agentos.controller_startup_runner.v1";
export const CONTROLLER_STARTUP_RUNNER_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const RUNNER_KEYS = Object.freeze([
  "schema", "version", "startup_sequence_sha256", "initial_receipt_sha256", "status", "dispatched_count",
  "next_action", "next_handler", "continuation", "continuation_sha256", "protected_event", "next_lifecycle", "runner_sha256",
]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireIdentifier(value, label) { assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`); }
function body(value) { const copy = structuredClone(value); copy.runner_sha256 = null; return copy; }

function validateContinuation(continuation, actionId) {
  assert(isRecord(continuation), "Controller startup runner continuation is required");
  assert(typeof continuation.mode === "string", "Controller startup runner continuation mode is required");
  assert(continuation.timer_deferral === false, "Controller startup runner cannot defer to a timer");
  assert(continuation.heartbeat_deferral === false, "Controller startup runner cannot defer to a heartbeat");
  assert(continuation.same_turn_dispatch === (continuation.mode === "IMMEDIATE_SAME_TURN"), "Controller startup runner continuation dispatch is invalid");
  assert(typeof continuation.resume_condition === "string" && continuation.resume_condition.trim().length >= 8, "Controller startup runner resume condition is incomplete");
  const descriptor = CONTROLLER_ACTION_REGISTRY[actionId];
  assert(descriptor !== undefined, "Controller startup runner action is not registered");
  if (descriptor.mode === "PROTECTED_WAIT") requireIdentifier(continuation.protected_event_id, "Controller startup runner protected event");
  else assert(continuation.protected_event_id === null, "Local startup runner action cannot carry a protected event");
}

export function compileControllerStartupCursor(sequence, {receiptId = "RECEIPT.CONTROLLER.STARTUP.ROOT", previousReceiptSha256 = null} = {}) {
  validateControllerStartupSuccessor(sequence);
  requireIdentifier(receiptId, "Controller startup runner receipt id");
  if (previousReceiptSha256 !== null) requireSha(previousReceiptSha256, "Controller startup runner predecessor receipt");
  return compileControllerActionReceipt({
    receiptId,
    actionId: "STARTUP_SEQUENCE",
    previousReceiptSha256,
    semanticBeforeSha256: sequence.state_sha256,
    semanticAfterSha256: sequence.sequence_sha256,
    evidenceRefs: sequence.evidence_refs,
    hostileFixtureRefs: sequence.hostile_fixture_refs,
    nextAction: sequence.next_action,
    nextHandler: sequence.next_handler,
    continuation: sequence.continuation,
    authority: CONTROLLER_ACTION_AUTHORITY,
    protectedEvent: sequence.protected_event,
  });
}

export function compileControllerStartupRunReadback({sequence, initialReceipt, result} = {}) {
  validateControllerStartupSuccessor(sequence);
  validateControllerActionReceipt(initialReceipt);
  assert(isRecord(result) && isRecord(result.receipt), "Controller startup runner result is incomplete");
  validateControllerActionReceipt(result.receipt);
  assert(Number.isSafeInteger(result.dispatched_count) && result.dispatched_count >= 0, "Controller startup runner dispatched count is invalid");
  const readback = {
    schema: CONTROLLER_STARTUP_RUNNER_SCHEMA,
    version: CONTROLLER_STARTUP_RUNNER_VERSION,
    startup_sequence_sha256: sequence.sequence_sha256,
    initial_receipt_sha256: initialReceipt.receipt_sha256,
    status: result.status,
    dispatched_count: result.dispatched_count,
    next_action: result.receipt.next_action,
    next_handler: result.receipt.next_handler,
    continuation: structuredClone(result.receipt.continuation),
    continuation_sha256: result.receipt.continuation_sha256,
    protected_event: structuredClone(result.receipt.protected_event),
    next_lifecycle: structuredClone(result.next_lifecycle ?? null),
    runner_sha256: null,
  };
  readback.runner_sha256 = canonicalDigest(body(readback));
  return validateControllerStartupRunReadback(readback);
}

export function validateControllerStartupRunReadback(readback) {
  exactKeys(readback, RUNNER_KEYS, "Controller startup runner readback");
  assert(readback.schema === CONTROLLER_STARTUP_RUNNER_SCHEMA && readback.version === CONTROLLER_STARTUP_RUNNER_VERSION, "Controller startup runner identity is invalid");
  requireSha(readback.startup_sequence_sha256, "Controller startup runner sequence digest");
  requireSha(readback.initial_receipt_sha256, "Controller startup runner initial receipt digest");
  assert(["ROUTED_SAME_TURN", "PROTECTED_EVENT_WAIT", "OWNER_REVIEW_REQUIRED"].includes(readback.status), "Controller startup runner status is invalid");
  assert(Number.isSafeInteger(readback.dispatched_count) && readback.dispatched_count >= 0, "Controller startup runner dispatched count is invalid");
  requireIdentifier(readback.next_action, "Controller startup runner next action");
  assert(readback.next_handler === CONTROLLER_ACTION_REGISTRY[readback.next_action]?.handler, "Controller startup runner next handler is stale");
  validateContinuation(readback.continuation, readback.next_action);
  requireSha(readback.continuation_sha256, "Controller startup runner continuation digest");
  assert(readback.continuation_sha256 === canonicalDigest(readback.continuation), "Controller startup runner continuation digest is stale");
  if (readback.status === "PROTECTED_EVENT_WAIT") {
    assert(CONTROLLER_ACTION_REGISTRY[readback.next_action].mode === "PROTECTED_WAIT", "Protected startup runner status has a local action");
    assert(isRecord(readback.protected_event), "Protected startup runner status lacks its event");
  } else {
    assert(CONTROLLER_ACTION_REGISTRY[readback.next_action].mode !== "PROTECTED_WAIT", "Local startup runner status hides a protected wait");
    assert(readback.protected_event === null, "Local startup runner status carries a protected event");
  }
  if (readback.status === "ROUTED_SAME_TURN") {
    validateControllerNextLifecycleHandoff(readback.next_lifecycle, {
      sourceReceiptSha256: readback.next_lifecycle.source_receipt_sha256,
      nextAction: readback.next_action,
      nextHandler: readback.next_handler,
    });
  } else assert(readback.next_lifecycle === null, "Protected or owner startup runner status cannot claim a local next lifecycle start");
  assert(readback.runner_sha256 === canonicalDigest(body(readback)), "Controller startup runner readback digest mismatch");
  return readback;
}

export function runControllerStartupCycle({sequence, handlers, persist, persistReadback, onDefect, startNextLifecycle, maxTransitions = 16, receiptId = "RECEIPT.CONTROLLER.STARTUP.ROOT", previousReceiptSha256 = null} = {}) {
  assert(isRecord(handlers), "Controller startup runner handlers are required");
  assert(typeof persist === "function", "Controller startup runner receipt persistence is required");
  assert(typeof persistReadback === "function", "Controller startup runner readback persistence is required");
  const initialReceipt = compileControllerStartupCursor(sequence, {receiptId, previousReceiptSha256});
  assert(persist(initialReceipt) !== false, "Controller startup runner initial persistence returned false");
  const result = advanceControllerAction(initialReceipt, {handlers, persist, onDefect, startNextLifecycle, maxTransitions});
  const readback = compileControllerStartupRunReadback({sequence, initialReceipt, result});
  assert(persistReadback(readback) !== false, "Controller startup runner readback persistence returned false");
  return {...result, initial_receipt: initialReceipt, readback};
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Controller startup runner contract loaded\n");
