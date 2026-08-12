#!/usr/bin/env node

/* Focused canonical replay and lifecycle tests. */

import assert from "node:assert/strict";
import {
  GENESIS_EVENT_SHA256,
  compileDecisionRecord,
  compileGoalRecord,
  compileMemoryConflictRecord,
  compileMemoryEvent,
  compileProjectContextRecord,
  replayMemoryLedger,
  validateMemoryEvent,
  validateMemoryLedger,
} from "../control/project-memory.mjs";
import {canonicalDigest, scanPersistedRecord} from "../control/content-addressing.mjs";

const binding = {
  project_ref: "PROJECT-REPLAY",
  campaign_ref: "CAMPAIGN-REPLAY",
  goal_ref: "GOAL-REPLAY",
  role_ref: "ORCHESTRATOR",
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
  source_snapshot_sha256: "c".repeat(64),
  policy_sha256: "d".repeat(64),
  handoff_sha256: "e".repeat(64),
};

function digest(seed) {
  return canonicalDigest({seed});
}

function makeEvent(record, sequence, priorEventSha256, eventType = "RECORD_APPENDED", prefix = "EVENT") {
  return compileMemoryEvent({
    eventId: `${prefix}-${sequence}`,
    idempotencyKey: `${prefix}-KEY-${sequence}`,
    sequence,
    eventType,
    record,
    priorEventSha256,
  });
}

function chain(records, eventTypes = [], prefix = "EVENT") {
  const events = [];
  for (const [sequence, record] of records.entries()) {
    events.push(makeEvent(
      record,
      sequence,
      events.at(-1)?.event_sha256 ?? GENESIS_EVENT_SHA256,
      eventTypes[sequence] ?? "RECORD_APPENDED",
      prefix,
    ));
  }
  return events;
}

const context = compileProjectContextRecord({
  recordId: "CONTEXT-REPLAY",
  binding,
  contextInputSha256: digest("context-input"),
  intentSha256: digest("intent"),
  planSha256: digest("plan"),
  governanceSha256: digest("governance"),
  boundarySha256: digest("boundary"),
});
const goal = compileGoalRecord({
  recordId: "GOAL-REPLAY",
  binding,
  goalSha256: digest("goal"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: digest("scope"),
  acceptanceSha256: digest("acceptance"),
});
const decision = compileDecisionRecord({
  recordId: "DECISION-REPLAY",
  binding,
  decisionSha256: digest("decision"),
  decisionKind: "OWNER_CHOICE",
  selectionRef: "CONTROL_SPACE",
  effectScope: ["PROJECT_MEMORY"],
  rationaleSha256: digest("rationale"),
});
const baseEvents = chain([context, goal, decision]);
const baseBeforeReplay = JSON.stringify(baseEvents);
const baseReplay = replayMemoryLedger(baseEvents, {binding});

assert.equal(baseReplay.status, "READY");
assert.deepEqual(baseReplay.binding, binding);
assert.equal(baseReplay.event_count, baseEvents.length);
assert.equal(baseReplay.head_sha256, baseEvents.at(-1).event_sha256);
assert.equal(baseReplay.current_records.length, 3);
assert.equal(JSON.stringify(baseEvents), baseBeforeReplay, "replay must not mutate event input");
assert.deepEqual(baseReplay, replayMemoryLedger(structuredClone(baseEvents), {binding}), "replay must be deterministic after cloning");
assert.equal(validateMemoryLedger(baseEvents).head_sha256, baseReplay.head_sha256, "ledger binding must be inferred from its first event");

for (const event of baseEvents) {
  assert.equal(scanPersistedRecord(event).safe, true);
  assert.equal(scanPersistedRecord(event.record).safe, true);
}

const mismatchedBinding = {...binding, source_tree: "f".repeat(40)};
const mismatchedGoal = compileGoalRecord({
  recordId: "GOAL-MISMATCH",
  binding: mismatchedBinding,
  goalSha256: digest("mismatched-goal"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: digest("mismatched-scope"),
  acceptanceSha256: digest("mismatched-acceptance"),
});
const mismatchedEvent = makeEvent(mismatchedGoal, baseEvents.length, baseEvents.at(-1).event_sha256, "RECORD_APPENDED", "MISMATCH");
assert.throws(() => replayMemoryLedger([...baseEvents, mismatchedEvent]), /memory ledger scope mismatch/u);

const decisionV2 = compileDecisionRecord({
  recordId: decision.record_id,
  recordVersion: 2,
  binding,
  supersedesRecordSha256: decision.record_sha256,
  decisionSha256: digest("decision-v2"),
  decisionKind: "OWNER_CHOICE",
  selectionRef: "CONTROL_SPACE",
  effectScope: ["PROJECT_MEMORY"],
  rationaleSha256: digest("rationale-v2"),
  supersedesDecisionSha256: decision.body.decision_sha256,
});
const supersessionReplay = replayMemoryLedger(
  [...baseEvents, makeEvent(decisionV2, baseEvents.length, baseEvents.at(-1).event_sha256)],
  {binding},
);
assert.equal(supersessionReplay.status, "READY");
assert.equal(supersessionReplay.current_records.some((record) => record.record_sha256 === decision.record_sha256), false);
assert.equal(supersessionReplay.current_records.some((record) => record.record_sha256 === decisionV2.record_sha256), true);

const namedSupersessionEvent = makeEvent(
  decisionV2,
  baseEvents.length,
  baseEvents.at(-1).event_sha256,
  "RECORD_SUPERSEDED",
  "NAMED-SUPERSEDE",
);
const namedSupersessionReplay = replayMemoryLedger([...baseEvents, namedSupersessionEvent], {binding});
assert.equal(namedSupersessionReplay.current_records.some((record) => record.record_sha256 === decisionV2.record_sha256), true);

const forwardTarget = compileGoalRecord({
  recordId: "GOAL-FORWARD",
  binding,
  goalSha256: digest("goal-forward"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: digest("scope-forward"),
  acceptanceSha256: digest("acceptance-forward"),
});
const forwardSuccessor = compileGoalRecord({
  recordId: forwardTarget.record_id,
  recordVersion: 2,
  binding,
  supersedesRecordSha256: forwardTarget.record_sha256,
  goalSha256: digest("goal-forward-v2"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: digest("scope-forward-v2"),
  acceptanceSha256: digest("acceptance-forward-v2"),
});
const forwardSuccessorEvent = makeEvent(forwardSuccessor, 0, GENESIS_EVENT_SHA256, "RECORD_SUPERSEDED", "FORWARD");
const forwardTargetEvent = makeEvent(forwardTarget, 1, forwardSuccessorEvent.event_sha256, "RECORD_APPENDED", "FORWARD");
assert.throws(
  () => replayMemoryLedger([forwardSuccessorEvent, forwardTargetEvent], {binding}),
  (error) => error.code === "SUPERSESSION_TARGET_NOT_PRIOR",
);

const missingTargetDecision = compileDecisionRecord({
  recordId: decision.record_id,
  recordVersion: 2,
  binding,
  supersedesRecordSha256: digest("missing-superseded-record"),
  decisionSha256: digest("decision-missing-target"),
  decisionKind: "OWNER_CHOICE",
  selectionRef: "CONTROL_SPACE",
  effectScope: ["PROJECT_MEMORY"],
  rationaleSha256: digest("rationale-missing-target"),
});
assert.throws(
  () => replayMemoryLedger([
    ...baseEvents,
    makeEvent(missingTargetDecision, baseEvents.length, baseEvents.at(-1).event_sha256),
  ], {binding}),
  (error) => error.code === "MISSING_SUPERSEDED_RECORD",
);

const wrongLogicalTarget = compileGoalRecord({
  recordId: goal.record_id,
  recordVersion: 2,
  binding,
  supersedesRecordSha256: context.record_sha256,
  goalSha256: digest("goal-wrong-target"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: digest("scope-wrong-target"),
  acceptanceSha256: digest("acceptance-wrong-target"),
});
assert.throws(
  () => replayMemoryLedger([
    ...baseEvents,
    makeEvent(wrongLogicalTarget, baseEvents.length, baseEvents.at(-1).event_sha256),
  ], {binding}),
  (error) => error.code === "SUPERSESSION_LOGICAL_KEY_MISMATCH",
);

const sameVersionTarget = compileDecisionRecord({
  recordId: decision.record_id,
  recordVersion: 1,
  binding,
  supersedesRecordSha256: decision.record_sha256,
  decisionSha256: digest("decision-same-version"),
  decisionKind: "OWNER_CHOICE",
  selectionRef: "CONTROL_SPACE",
  effectScope: ["PROJECT_MEMORY"],
  rationaleSha256: digest("rationale-same-version"),
});
assert.throws(
  () => replayMemoryLedger([
    ...baseEvents,
    makeEvent(sameVersionTarget, baseEvents.length, baseEvents.at(-1).event_sha256),
  ], {binding}),
  (error) => error.code === "SUPERSESSION_VERSION_ORDER",
);

const invalidatedGoal = compileGoalRecord({
  recordId: "GOAL-INVALIDATED",
  binding,
  status: "INVALIDATED",
  goalSha256: digest("goal-invalidated"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: digest("scope-invalidated"),
  acceptanceSha256: digest("acceptance-invalidated"),
});
const invalidatedEvent = makeEvent(invalidatedGoal, 0, GENESIS_EVENT_SHA256, "RECORD_INVALIDATED", "INVALIDATED");
assert.doesNotThrow(() => validateMemoryEvent(invalidatedEvent));
const invalidatedReplay = replayMemoryLedger([invalidatedEvent], {binding});
assert.equal(invalidatedReplay.status, "READY");
assert.equal(invalidatedReplay.current_records.length, 0);

assert.throws(
  () => compileDecisionRecord({
    recordId: "DECISION-SUPERSEDED",
    binding,
    status: "SUPERSEDED",
    decisionSha256: digest("decision-invalid-status"),
    decisionKind: "OWNER_CHOICE",
    selectionRef: "CONTROL_SPACE",
    effectScope: ["PROJECT_MEMORY"],
    rationaleSha256: digest("rationale-invalid-status"),
  }),
  /superseded memory record lacks its superseded digest/u,
);

assert.throws(
  () => makeEvent(goal, 0, GENESIS_EVENT_SHA256, "RECORD_SUPERSEDED", "BAD-SUPERSEDE"),
  /supersede event requires a superseded digest/u,
);
assert.throws(
  () => makeEvent(goal, 0, GENESIS_EVENT_SHA256, "RECORD_INVALIDATED", "BAD-INVALIDATE"),
  /invalidate event requires an invalidated record/u,
);
assert.throws(
  () => makeEvent(goal, 0, GENESIS_EVENT_SHA256, "CONFLICT_RECORDED", "BAD-CONFLICT"),
  /conflict event requires a conflict record/u,
);

const explicitConflict = compileMemoryConflictRecord({
  recordId: "CONFLICT-REPLAY",
  binding,
  conflictKey: "GOAL:GOAL-REPLAY:1",
  leftRecordSha256: goal.record_sha256,
  rightRecordSha256: digest("missing-candidate"),
});
const explicitConflictReplay = replayMemoryLedger([
  makeEvent(explicitConflict, 0, GENESIS_EVENT_SHA256, "CONFLICT_RECORDED", "EXPLICIT-CONFLICT"),
], {binding});
assert.equal(explicitConflictReplay.status, "CONFLICT");
assert.deepEqual(explicitConflictReplay.conflicts, [{
  conflict_key: "GOAL:GOAL-REPLAY:1",
  left_record_sha256: goal.record_sha256,
  right_record_sha256: digest("missing-candidate"),
}]);

const mismatchedConflict = compileMemoryConflictRecord({
  recordId: "CONFLICT-MISMATCHED-KEY",
  binding,
  conflictKey: "DECISION:DECISION-REPLAY:1",
  leftRecordSha256: goal.record_sha256,
  rightRecordSha256: digest("external-candidate"),
});
assert.throws(
  () => replayMemoryLedger([
    ...baseEvents,
    makeEvent(mismatchedConflict, baseEvents.length, baseEvents.at(-1).event_sha256, "CONFLICT_RECORDED", "MISMATCHED-CONFLICT"),
  ], {binding}),
  (error) => error.code === "CONFLICT_LOGICAL_KEY_MISMATCH",
);

assert.throws(
  () => compileMemoryConflictRecord({
    recordId: "CONFLICT-SAME",
    binding,
    conflictKey: "GOAL:GOAL-REPLAY:1",
    leftRecordSha256: goal.record_sha256,
    rightRecordSha256: goal.record_sha256,
  }),
  /records must differ/u,
);

const alternateGoal = compileGoalRecord({
  recordId: goal.record_id,
  binding,
  goalSha256: digest("goal-alternate"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: digest("scope-alternate"),
  acceptanceSha256: digest("acceptance-alternate"),
});
const divergentReplay = replayMemoryLedger(chain([goal, alternateGoal], [], "DIVERGENT"), {binding});
assert.equal(divergentReplay.status, "CONFLICT");
assert.equal(divergentReplay.conflicts.length, 1);
assert.equal(divergentReplay.conflicts[0].conflict_key, "GOAL:GOAL-REPLAY:1");
assert.equal(divergentReplay.current_records.some((record) => record.record_id === goal.record_id), false);

const emptyReplay = replayMemoryLedger([], {binding});
assert.equal(emptyReplay.status, "UNAVAILABLE");
assert.equal(emptyReplay.event_count, 0);
assert.equal(emptyReplay.head_sha256, GENESIS_EVENT_SHA256);
assert.deepEqual(emptyReplay.binding, binding);

for (const replay of [baseReplay, supersessionReplay, invalidatedReplay, explicitConflictReplay, divergentReplay]) {
  for (const record of replay.records) assert.equal(scanPersistedRecord(record).safe, true);
  for (const notice of replay.uncertainties) assert.equal(scanPersistedRecord(notice).safe, true);
}

console.log("PASS project memory replay: deterministic reconstruction, inferred binding, lifecycle events, supersession validation, explicit conflicts, invalidation state, privacy, and hostile cases verified");
