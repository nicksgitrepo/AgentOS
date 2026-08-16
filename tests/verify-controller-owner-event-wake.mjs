#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileControllerOwnerEventWake,
  resumeControllerFromOwnerEvent,
  runControllerOwnerEventContinuation,
  validateControllerOwnerEventWake,
} from "../control/controller-owner-event-wake.mjs";

const HASH = (value) => canonicalDigest({value});
const bindings = {
  escalation_receipt_sha256: HASH("escalation"),
  projection_sha256: HASH("projection"),
  owner_decision_sha256: HASH("owner-decision"),
};
const protectedGate = {
  dependency_id: "INDEPENDENT.UTILITY_HARM_CLEARANCE",
  status: "PENDING_EXTERNAL_AUTHORITY",
  evidence_ceiling: "No independent clearance receipt is bound; owner resumption cannot authorize activation.",
  blocked_wave_ids: ["WAVE.001.FOUNDATION"],
  clearance_receipt_sha256: null,
};

const localEvent = compileControllerOwnerEventWake({
  eventId: "OWNER.EVENT.LOCAL.REPAIR",
  ownerTaskId: "OWNER.FRONT.DOOR",
  controllerTaskId: "CONTROLLER.PERSISTENT",
  escalationReceiptSha256: bindings.escalation_receipt_sha256,
  projectionSha256: bindings.projection_sha256,
  ownerDecisionSha256: bindings.owner_decision_sha256,
  pendingLocalRequestIds: ["REQUEST.BLOCK.REPAIR"],
  activationBlockedWaveIds: ["WAVE.001.FOUNDATION"],
  waveActivationAllowed: false,
  protectedGate,
  receivedAtUtc: "2026-08-16T18:00:00.000Z",
});
const localWake = resumeControllerFromOwnerEvent({event: localEvent, currentBindings: bindings});
assert.equal(localWake.status, "OWNER_EVENT_WAKE_ACCEPTED");
assert.equal(localWake.same_turn, true);
assert.equal(localWake.timer_wait_forbidden, true);
assert.equal(localWake.action, "START_ONE_BOUNDED_LOCAL_TRANSITION");
assert.equal(localWake.transition_kind, "LOCAL_BLOCK_REPAIR");
assert.equal(localWake.target_id, "REQUEST.BLOCK.REPAIR");
assert.equal(localWake.transition_count, 1);
assert.equal(localWake.owner_resumption_is_clearance, false);
let localTransitionCount = 0;
const localRun = runControllerOwnerEventContinuation({
  event: localEvent,
  currentBindings: bindings,
  onLocalTransition: (request) => {
    localTransitionCount += 1;
    assert.equal(request.target_id, "REQUEST.BLOCK.REPAIR");
    return "LOCAL_TRANSITION_HANDOFF";
  },
});
assert.equal(localTransitionCount, 1);
assert.equal(localRun.execution, "LOCAL_TRANSITION_STARTED");

const protectedEvent = compileControllerOwnerEventWake({
  eventId: "OWNER.EVENT.PROTECTED.CHECKPOINT",
  ownerTaskId: "OWNER.FRONT.DOOR",
  controllerTaskId: "CONTROLLER.PERSISTENT",
  escalationReceiptSha256: bindings.escalation_receipt_sha256,
  projectionSha256: bindings.projection_sha256,
  ownerDecisionSha256: bindings.owner_decision_sha256,
  activationBlockedWaveIds: protectedGate.blocked_wave_ids,
  waveActivationAllowed: false,
  protectedGate,
  receivedAtUtc: "2026-08-16T18:01:00.000Z",
});
const protectedWake = resumeControllerFromOwnerEvent({event: protectedEvent, currentBindings: bindings});
assert.equal(protectedWake.action, "PERSIST_EVENT_DRIVEN_PROTECTED_CHECKPOINT");
assert.equal(protectedWake.transition_count, 0);
assert.equal(protectedWake.protected_dependency_status, "PENDING_EXTERNAL_AUTHORITY");
assert.equal(protectedEvent.continuation.event_driven_idle, true);
assert.equal(protectedEvent.protected_gate.clearance_receipt_sha256, null);
assert.equal(protectedEvent.continuation.admission, "OFF");
assert.equal(protectedEvent.continuation.activation, "OFF");
let checkpointCount = 0;
const protectedRun = runControllerOwnerEventContinuation({
  event: protectedEvent,
  currentBindings: bindings,
  onProtectedCheckpoint: (request) => {
    checkpointCount += 1;
    assert.equal(request.dependency_id, "INDEPENDENT.UTILITY_HARM_CLEARANCE");
    return "CHECKPOINT_RECEIPT";
  },
});
assert.equal(checkpointCount, 1);
assert.equal(protectedRun.execution, "PROTECTED_CHECKPOINT_PERSISTED");

const staleBindings = {...bindings, projection_sha256: HASH("stale-projection")};
assert.throws(
  () => resumeControllerFromOwnerEvent({event: localEvent, currentBindings: staleBindings}),
  /projection_sha256 does not match the current readback/u,
  "a stale projection binding must not wake the Controller",
);

const unboundEvent = structuredClone(localEvent);
unboundEvent.bound_receipts.owner_decision_sha256 = HASH("unbound-owner-decision");
unboundEvent.wake_sha256 = canonicalDigest({...unboundEvent, wake_sha256: null});
assert.throws(
  () => resumeControllerFromOwnerEvent({event: unboundEvent, currentBindings: bindings}),
  /owner_decision_sha256 does not match the current readback/u,
  "an unbound owner event must not wake the Controller",
);

const fakeHeldWaveStart = structuredClone(protectedEvent);
fakeHeldWaveStart.continuation = {
  ...fakeHeldWaveStart.continuation,
  action: "START_ONE_BOUNDED_LOCAL_TRANSITION",
  transition_kind: "AVAILABLE_WAVE",
  transition_id: "TRANSITION.WAVE.001.FOUNDATION.START",
  target_id: "WAVE.001.FOUNDATION",
  event_driven_idle: false,
  transition_count: 1,
};
fakeHeldWaveStart.wake_sha256 = canonicalDigest({...fakeHeldWaveStart, wake_sha256: null});
assert.throws(
  () => validateControllerOwnerEventWake(fakeHeldWaveStart, {currentBindings: bindings}),
  /must persist the protected checkpoint|no eligible local route/u,
  "a held wave must not be claimed as an owner-event transition",
);

console.log("PASS Controller owner-event wake: valid direct resumption runs same-turn continuation, stale/unbound bindings reject, and protected activation remains fail-closed");
