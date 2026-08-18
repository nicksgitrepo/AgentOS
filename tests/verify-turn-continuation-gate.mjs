#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  TURN_CONTINUATION_GATE_SCHEMA,
  TURN_CONTINUATION_REPAIR_ACTION,
  TURN_CONTINUATION_REPAIR_HANDLER,
  TURN_CONTINUATION_HOSTILE_FIXTURE_REFS,
  compileTurnContinuationRepair,
  validateTurnContinuationGate,
} from "../control/turn-continuation-gate.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const authority = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  receipt_ref: "ref:authority/test",
  receipt_sha256: "c".repeat(64),
};
const turn = {
  turn_id: "TURN-ORCHESTRATOR-CF45",
  role: "ORCHESTRATOR",
  started_at_utc: "2026-08-18T00:00:00.000Z",
  observed_at_utc: "2026-08-18T00:05:01.000Z",
  elapsed_seconds: 301,
  max_seconds: 300,
  overlong: true,
};
const observedRoute = {
  current_action: "ADMIT_GOVERNED_SPAWN",
  current_handler: "HANDLER.GOVERNED_SPAWN_ADAPTER",
  handler_invoked: false,
  readback_sha256: null,
};
const repaired = compileTurnContinuationRepair({
  gateId: "GATE.TURN.CONTINUATION.CF45",
  authority,
  turn,
  observedRoute,
  successorDispatchRef: "ref:controller/turn-continuation/dispatch/CURRENT",
  successorDispatchReadbackSha256: "d".repeat(64),
  evidenceCeiling: "No handler invocation or readback was observed; only control-plane liveness evidence is available.",
});
assert.equal(repaired.schema, TURN_CONTINUATION_GATE_SCHEMA);
assert.equal(repaired.status, "REPAIR_REQUIRED");
assert.equal(repaired.successor.next_action, TURN_CONTINUATION_REPAIR_ACTION);
assert.equal(repaired.successor.next_handler, TURN_CONTINUATION_REPAIR_HANDLER);
assert.equal(repaired.successor.controller_approval_required, false);
assert.equal(repaired.custody.timers, 0);
validateTurnContinuationGate(repaired);

const badRetryAction = structuredClone(repaired);
badRetryAction.successor.next_action = "ADMIT_GOVERNED_SPAWN";
badRetryAction.successor.continuation_sha256 = canonicalDigest({...badRetryAction.successor, continuation_sha256: null});
badRetryAction.gate_sha256 = canonicalDigest({...badRetryAction, gate_sha256: null});
assert.throws(() => validateTurnContinuationGate(badRetryAction), /must route the Spawner block compiler/u);

const nullReason = structuredClone(repaired);
nullReason.defect.reason_code = null;
nullReason.gate_sha256 = canonicalDigest({...nullReason, gate_sha256: null});
assert.throws(() => validateTurnContinuationGate(nullReason), /reason code/u);

const commentaryOnly = structuredClone(repaired);
commentaryOnly.successor.started_same_turn = false;
commentaryOnly.gate_sha256 = canonicalDigest({...commentaryOnly, gate_sha256: null});
assert.throws(() => validateTurnContinuationGate(commentaryOnly), /not started in the same turn/u);

const falseProtectedWait = structuredClone(repaired);
falseProtectedWait.status = "PROTECTED_WAIT";
falseProtectedWait.defect.protected_event_id = null;
falseProtectedWait.successor.next_action = "WAIT_FOR_EXACT_PROTECTED_BOUNDARY_RESOLUTION";
falseProtectedWait.successor.continuation_sha256 = canonicalDigest({...falseProtectedWait.successor, continuation_sha256: null});
falseProtectedWait.gate_sha256 = canonicalDigest({...falseProtectedWait, gate_sha256: null});
assert.throws(() => validateTurnContinuationGate(falseProtectedWait), /protected event/u);

const missingDispatchReadback = structuredClone(repaired);
missingDispatchReadback.successor.dispatch_readback_sha256 = null;
missingDispatchReadback.gate_sha256 = canonicalDigest({...missingDispatchReadback, gate_sha256: null});
assert.throws(() => validateTurnContinuationGate(missingDispatchReadback), /successor dispatch readback/u);

assert.throws(() => compileTurnContinuationRepair({
  gateId: "GATE.TURN.CONTINUATION.MISSING-DISPATCH",
  authority,
  turn,
  observedRoute,
  evidenceCeiling: "Dispatch evidence was not supplied.",
}), /successor dispatch reference/u);

assert.equal(TURN_CONTINUATION_HOSTILE_FIXTURE_REFS.length, 8);
console.log("PASS turn continuation gate: overlong turns require a real same-turn dispatch readback; malformed retries, commentary-only closeouts, null reasons, false protected waits, and timer-only liveness fail closed");
