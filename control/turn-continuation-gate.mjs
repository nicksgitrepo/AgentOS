#!/usr/bin/env node

/*
 * Project-agnostic gate for Controller, Orchestrator, Spawner, and Runtime
 * turn closeouts.  A turn is not healthy because it is in progress or because
 * it emitted commentary.  It must either prove a same-turn successor, or
 * compile the observed liveness defect into a Spawner block-repair route.
 * Protected waiting is a separate, evidence-bound state and may not be used
 * to hide a missing local successor.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {validateExistingTaskLifecycle} from "./existing-task-stop-resume.mjs";

export const TURN_CONTINUATION_GATE_SCHEMA = "agentos.turn_continuation_gate.v1";
export const TURN_CONTINUATION_GATE_VERSION = 1;
export const TURN_CONTINUATION_REPAIR_ACTION = "COMPILE_BLOCK_PATCH";
export const TURN_CONTINUATION_REPAIR_HANDLER = "HANDLER.AGENTOS.SPAWNER.DEFECT.COMPILER";
export const TURN_CONTINUATION_PROTECTED_ACTION = "WAIT_FOR_EXACT_PROTECTED_BOUNDARY_RESOLUTION";
export const TURN_CONTINUATION_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.TURN_CONTINUATION.COMMENTARY_ONLY",
  "FIXTURE.TURN_CONTINUATION.NULL_REASON",
  "FIXTURE.TURN_CONTINUATION.RETRY_ROUTE_MISMATCH",
  "FIXTURE.TURN_CONTINUATION.MISSING_READBACK",
  "FIXTURE.TURN_CONTINUATION.FALSE_PROTECTED_WAIT",
  "FIXTURE.TURN_CONTINUATION.TIMER_ONLY",
  "FIXTURE.TURN_CONTINUATION.AUTHORITY_DRIFT",
  "FIXTURE.TURN_CONTINUATION.MISSING_SUCCESSOR_DISPATCH_READBACK",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40,64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const TEXT = /^[^\u0000-\u001f\u007f]+$/u;

const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "authority", "turn", "observed_route", "defect", "successor", "custody",
  "status", "hostile_fixture_refs", "gate_sha256",
]);
const AUTHORITY_KEYS = Object.freeze(["commit", "tree", "receipt_ref", "receipt_sha256"]);
const TURN_KEYS = Object.freeze(["turn_id", "role", "started_at_utc", "observed_at_utc", "elapsed_seconds", "max_seconds", "overlong"]);
const OBSERVED_ROUTE_KEYS = Object.freeze(["current_action", "current_handler", "handler_invoked", "readback_sha256"]);
const DEFECT_KEYS = Object.freeze(["defect_code", "reason_code", "evidence_ceiling", "protected_event_id", "restart_event"]);
const SUCCESSOR_KEYS = Object.freeze(["next_action", "next_handler", "same_turn_dispatch", "controller_approval_required", "started_same_turn", "dispatch_ref", "dispatch_readback_sha256", "continuation_sha256"]);
const CUSTODY_KEYS = Object.freeze(["control_plane_only", "product_mutation", "provider_access", "credential_access", "spend", "destructive_work", "deployment", "publication", "merge", "resources", "timers", "polling"]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}
function requireId(value, label) { assert(typeof value === "string" && ID.test(value), `${label} must be a stable identifier`); }
function requireIdentifier(value, label) { assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be an uppercase route identifier`); }
function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  assert(value !== "0".repeat(64) && value !== "f".repeat(64), `${label} may not be a placeholder digest`);
}
function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object id`);
  assert(!/^0+$/u.test(value) && !/^f+$/u.test(value), `${label} may not be a placeholder object id`);
}
function requireReference(value, label) { assert(typeof value === "string" && REFERENCE.test(value), `${label} must be a reference`); }
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function requireText(value, label) { assert(typeof value === "string" && value.length > 0 && TEXT.test(value), `${label} must be non-empty safe text`); }
function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} are required`);
  values.forEach((value, index) => requireIdentifier(value, `${label}[${index}]`));
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}
function digestWithout(value, field) { return canonicalDigest({...structuredClone(value), [field]: null}); }

function validateAuthority(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "turn continuation authority");
  requireGitObject(authority.commit, "turn continuation authority commit");
  requireGitObject(authority.tree, "turn continuation authority tree");
  requireReference(authority.receipt_ref, "turn continuation authority receipt reference");
  requireSha(authority.receipt_sha256, "turn continuation authority receipt digest");
}

function validateTurn(turn) {
  exactKeys(turn, TURN_KEYS, "turn continuation window");
  requireId(turn.turn_id, "turn continuation turn ID");
  requireIdentifier(turn.role, "turn continuation role");
  requireUtc(turn.started_at_utc, "turn continuation start");
  requireUtc(turn.observed_at_utc, "turn continuation observation");
  assert(Number.isSafeInteger(turn.elapsed_seconds) && turn.elapsed_seconds >= 0, "turn continuation elapsed seconds are invalid");
  assert(Number.isSafeInteger(turn.max_seconds) && turn.max_seconds >= 1 && turn.max_seconds <= 3600, "turn continuation maximum is invalid");
  assert(turn.overlong === (turn.elapsed_seconds > turn.max_seconds), "turn continuation overlong flag is inconsistent");
  const elapsed = Math.floor((Date.parse(turn.observed_at_utc) - Date.parse(turn.started_at_utc)) / 1000);
  assert(elapsed === turn.elapsed_seconds, "turn continuation elapsed time does not match timestamps");
}

function validateObservedRoute(route) {
  exactKeys(route, OBSERVED_ROUTE_KEYS, "turn continuation observed route");
  requireIdentifier(route.current_action, "turn continuation current action");
  requireIdentifier(route.current_handler, "turn continuation current handler");
  assert(typeof route.handler_invoked === "boolean", "turn continuation handler invocation flag is invalid");
  requireSha(route.readback_sha256, "turn continuation observed readback", {nullable: true});
  if (route.handler_invoked) requireSha(route.readback_sha256, "turn continuation invoked readback");
}

function validateDefect(defect) {
  exactKeys(defect, DEFECT_KEYS, "turn continuation defect");
  requireIdentifier(defect.defect_code, "turn continuation defect code");
  requireIdentifier(defect.reason_code, "turn continuation reason code");
  requireText(defect.evidence_ceiling, "turn continuation evidence ceiling");
  if (defect.protected_event_id !== null) requireIdentifier(defect.protected_event_id, "turn continuation protected event");
  if (defect.restart_event !== null) requireIdentifier(defect.restart_event, "turn continuation restart event");
}

function validateSuccessor(successor) {
  exactKeys(successor, SUCCESSOR_KEYS, "turn continuation successor");
  requireIdentifier(successor.next_action, "turn continuation next action");
  requireIdentifier(successor.next_handler, "turn continuation next handler");
  assert(successor.next_action !== "NONE" && successor.next_action !== "DONE", "turn continuation may not close with NONE or DONE");
  assert(successor.same_turn_dispatch === true, "turn continuation successor must dispatch in the same turn");
  assert(successor.controller_approval_required === false, "turn continuation successor may not require Controller approval");
  assert(successor.started_same_turn === true, "turn continuation successor was not started in the same turn");
  requireReference(successor.dispatch_ref, "turn continuation successor dispatch reference");
  requireSha(successor.dispatch_readback_sha256, "turn continuation successor dispatch readback");
  requireSha(successor.continuation_sha256, "turn continuation continuation digest");
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "turn continuation custody");
  for (const key of ["control_plane_only", "product_mutation", "provider_access", "credential_access", "spend", "destructive_work", "deployment", "publication", "merge", "polling"]) assert(typeof custody[key] === "boolean", `turn continuation custody ${key} is invalid`);
  assert(custody.control_plane_only === true, "turn continuation crossed the control-plane boundary");
  for (const key of ["product_mutation", "provider_access", "credential_access", "spend", "destructive_work", "deployment", "publication", "merge", "polling"]) assert(custody[key] === false, `turn continuation custody ${key} must remain false`);
  assert(Number.isSafeInteger(custody.resources) && custody.resources >= 0, "turn continuation resource count is invalid");
  assert(Number.isSafeInteger(custody.timers) && custody.timers === 0, "turn continuation may not use timer-only liveness");
}

export function validateTurnContinuationGate(gate) {
  exactKeys(gate, GATE_KEYS, "turn continuation gate");
  assert(gate.schema === TURN_CONTINUATION_GATE_SCHEMA && gate.version === TURN_CONTINUATION_GATE_VERSION, "turn continuation gate identity is invalid");
  requireId(gate.gate_id, "turn continuation gate ID");
  validateAuthority(gate.authority);
  validateTurn(gate.turn);
  validateObservedRoute(gate.observed_route);
  validateDefect(gate.defect);
  validateSuccessor(gate.successor);
  validateCustody(gate.custody);
  sortedUnique(gate.hostile_fixture_refs, "turn continuation hostile fixtures");
  for (const fixture of TURN_CONTINUATION_HOSTILE_FIXTURE_REFS) {
    assert(gate.hostile_fixture_refs.includes(fixture), `turn continuation hostile fixture coverage is incomplete: ${fixture}`);
  }
  assert(["PROGRESS_STARTED", "REPAIR_REQUIRED", "PROTECTED_WAIT"].includes(gate.status), "turn continuation status is invalid");
  if (gate.status === "PROGRESS_STARTED") {
    assert(gate.turn.overlong === false, "an overlong turn cannot claim progress started");
    assert(gate.observed_route.handler_invoked === true, "progress-started turn lacks handler invocation");
    assert(gate.successor.next_action !== TURN_CONTINUATION_REPAIR_ACTION, "progress-started turn cannot route block repair");
  }
  if (gate.status === "REPAIR_REQUIRED") {
    assert(gate.turn.overlong === true, "repair-required turn must be overlong");
    assert(gate.observed_route.handler_invoked === false || gate.observed_route.readback_sha256 === null, "repair-required turn cannot claim a valid invocation");
    assert(gate.successor.next_action === TURN_CONTINUATION_REPAIR_ACTION && gate.successor.next_handler === TURN_CONTINUATION_REPAIR_HANDLER, "repair-required turn must route the Spawner block compiler");
    assert(gate.defect.protected_event_id === null, "a local repair defect may not masquerade as a protected wait");
    assert(gate.defect.restart_event === "EVENT.TURN_CONTINUATION.REPAIR_BLOCKS", "repair-required turn lacks its restart event");
  }
  if (gate.status === "PROTECTED_WAIT") {
    assert(gate.defect.protected_event_id !== null, "protected wait lacks an exact protected event");
    assert(gate.successor.next_action === TURN_CONTINUATION_PROTECTED_ACTION, "protected wait has an invalid next action");
    assert(gate.custody.resources === 0, "protected wait must release resources");
  }
  requireSha(gate.gate_sha256, "turn continuation gate digest");
  assert(gate.gate_sha256 === digestWithout(gate, "gate_sha256"), "turn continuation gate digest mismatch");
  return gate;
}

export function compileTurnContinuationRepair({gateId, authority, turn, observedRoute, successorDispatchRef, successorDispatchReadbackSha256, defectCode = "DEFECT.WORKFLOW.OVERLONG_TURN", evidenceCeiling, hostileFixtureRefs = TURN_CONTINUATION_HOSTILE_FIXTURE_REFS} = {}) {
  validateAuthority(authority);
  validateTurn(turn);
  validateObservedRoute(observedRoute);
  assert(turn.overlong === true, "turn continuation repair requires an overlong turn");
  requireReference(successorDispatchRef, "turn continuation successor dispatch reference");
  requireSha(successorDispatchReadbackSha256, "turn continuation successor dispatch readback");
  const successor = {
    next_action: TURN_CONTINUATION_REPAIR_ACTION,
    next_handler: TURN_CONTINUATION_REPAIR_HANDLER,
    same_turn_dispatch: true,
    controller_approval_required: false,
    started_same_turn: true,
    dispatch_ref: successorDispatchRef,
    dispatch_readback_sha256: successorDispatchReadbackSha256,
    continuation_sha256: null,
  };
  successor.continuation_sha256 = digestWithout(successor, "continuation_sha256");
  const gate = {
    schema: TURN_CONTINUATION_GATE_SCHEMA,
    version: TURN_CONTINUATION_GATE_VERSION,
    gate_id: gateId,
    authority: structuredClone(authority),
    turn: structuredClone(turn),
    observed_route: structuredClone(observedRoute),
    defect: {
      defect_code: defectCode,
      reason_code: "NO_SAME_TURN_SUCCESSOR_OR_READBACK",
      evidence_ceiling: evidenceCeiling,
      protected_event_id: null,
      restart_event: "EVENT.TURN_CONTINUATION.REPAIR_BLOCKS",
    },
    successor,
    custody: {
      control_plane_only: true,
      product_mutation: false,
      provider_access: false,
      credential_access: false,
      spend: false,
      destructive_work: false,
      deployment: false,
      publication: false,
      merge: false,
      resources: 0,
      timers: 0,
      polling: false,
    },
    status: "REPAIR_REQUIRED",
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    gate_sha256: null,
  };
  gate.gate_sha256 = digestWithout(gate, "gate_sha256");
  return validateTurnContinuationGate(gate);
}

export function existingTaskContinuationDisposition(record) {
  validateExistingTaskLifecycle(record);
  if (["OBSERVING", "STUCK_CONFIRMED", "STOP_SENT", "TURN_ENDED_IDLE", "CUSTODY_REVALIDATED", "RESUME_SENT"].includes(record.state)) return "CONTINUE_SAME_TASK_LIFECYCLE";
  if (record.state === "SAME_TASK_RETRY_FAILED" && !record.replacement.consumed) return "AUTHORIZE_EXACT_SINGLE_REPLACEMENT";
  if (["RESUMED_SAME_TASK", "REPLACEMENT_ACTIVE"].includes(record.state)) return "CONTINUE_MATERIAL_WORK";
  return "STOP_DEPENDENT_ROUTE";
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Turn continuation gate contract loaded\n");
