#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {createLivenessSentinel, classifySilentTurn, validateLivenessObservation} from "../control/liveness-sentinel.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const sentinel = createLivenessSentinel();
const first = sentinel.observe({tasks: [{task_id: "TASK-037", role: "WRITER", status: "completed"}], processes: [], classification: "MATERIAL_HANDOFF_UNCONSUMED"});
assert.equal(first.state, "ACTIVE_MONITORING");
assert.equal(first.report_action, "ONE_DEDUPLICATED_REPORT");
const repeated = sentinel.observe({tasks: [{task_id: "TASK-037", role: "WRITER", status: "completed"}], processes: [], classification: "MATERIAL_HANDOFF_UNCONSUMED"});
assert.equal(repeated.duplicate, true);
assert.equal(repeated.report_action, "KEEP_OPEN_NO_RESEND");
const quiet = sentinel.observe({tasks: [], processes: []});
assert.equal(quiet.state, "QUIESCENT");
assert.equal(quiet.lifecycle_action_taken, false);
assert.equal(quiet.custody_mutated, false);

const process = {pid: 123, start_identity: "start-1", command: "node worker", cwd: path.resolve("fixture-worktree"), owner: "TASK-037"};
const observation = validateLivenessObservation({tasks: [], processes: [process]});
assert.equal(observation.processes.length, 1);
assert.throws(() => validateLivenessObservation({tasks: [], processes: [process, process]}), /duplicate identities/u);
for (const field of ["start_identity", "command", "cwd", "owner"]) {
  for (const value of [undefined, null, {}, [], false, 42]) {
    assert.throws(() => validateLivenessObservation({tasks: [], processes: [{...process, [field]: value}]}), new RegExp(`liveness process ${field} must be a non-empty string`, "u"));
  }
}
for (const value of [undefined, null, 0, -1, 1.5, "", "01", "-1", "1.5", "9007199254740992", {}, [], false, Symbol("pid")]) {
  assert.throws(() => validateLivenessObservation({tasks: [], processes: [{...process, pid: value}]}), /liveness process pid must be a positive safe integer/u);
}
for (const field of ["listener", "parent_pid"]) {
  for (const value of [{}, [], false, () => {}, Symbol(field)]) {
    assert.throws(() => validateLivenessObservation({tasks: [], processes: [{...process, [field]: value}]}), new RegExp(`liveness process ${field}`, "u"));
  }
}
assert.equal(validateLivenessObservation({tasks: [], processes: [{...process, pid: "123", parent_pid: 456, listener: "socket-1"}]}).processes[0].pid, "123");
assert.equal(validateLivenessObservation({tasks: [], processes: [{...process, pid: 123}]}).processes[0].pid, "123");
const invalidSentinel = createLivenessSentinel();
assert.throws(() => invalidSentinel.observe({tasks: [], processes: [{...process, owner: {}}]}), /liveness process owner must be a non-empty string/u);
assert.deepEqual(invalidSentinel.read(), {state: "QUIESCENT", sequence: 0, signatures: []});

const taskId = "TASK-037";
const turnId = "TURN-037";
const item = {item_id: "ITEM-037", task_id: taskId, turn_id: turnId, type: "agentMessage", semantic_result: "ASSET_PRODUCER_PASS"};
item.item_json_sha256 = canonicalDigest(item);
const result = classifySilentTurn({
  taskId,
  turnId,
  projection: {status: "completed", items: [], items_count: 0},
  durableHistory: {turn: {task_id: taskId, turn_id: turnId, final_agent_item_id: item.item_id, item_count: 1}, items: [item]},
  originalClassification: "HOST_SAME_TASK_EXHAUSTED",
});
assert.equal(result.classification, "THREAD_READBACK_PROJECTION_DIVERGENCE");
assert.equal(result.receipt.correction.corrected, false); // no ledger means no consumption is allowed

const projectionSentinel = createLivenessSentinel();
const projectionLag = projectionSentinel.observeProjection({
  taskId: "TASK-SENTINEL-PROJECTION-037",
  laneId: "LANE-SENTINEL-037",
  projection: {status: "COMPLETED", items: [], items_count: 0},
  durableSession: {session_id: "SESSION-SENTINEL-037", ordinal: 1, mtime: 1, activity: "one"},
  observedAtUtc: "2026-08-28T15:00:00.000Z",
});
const projectionLagNext = projectionSentinel.observe({
  taskId: "TASK-SENTINEL-PROJECTION-037",
  laneId: "LANE-SENTINEL-037",
  projection: {status: "COMPLETED", items: [], items_count: 0},
  durableSession: {session_id: "SESSION-SENTINEL-037", ordinal: 2, mtime: 2, activity: "two"},
  previousObservation: projectionLag,
  observedAtUtc: "2026-08-28T15:00:01.000Z",
});
assert.equal(projectionLag.classification, "ACTIVE_OR_PROJECTION_LAG");
assert.equal(projectionLagNext.classification, "ACTIVE_OR_PROJECTION_LAG");
assert.equal(projectionLagNext.stalled, false);
assert.equal(projectionLagNext.replacement_allowed, false);
const stagnantProjection = projectionSentinel.observeProjection({
  taskId: "TASK-SENTINEL-PROJECTION-037",
  laneId: "LANE-SENTINEL-037",
  projection: {status: "COMPLETED", items: [], items_count: 0},
  durableSession: {session_id: "SESSION-SENTINEL-037", ordinal: 1, mtime: 1, activity: "one"},
  previousObservation: projectionLag,
  recoveryAttempt: 1,
  maxRecoveryAttempts: 1,
  observedAtUtc: "2026-08-28T15:00:02.000Z",
});
assert.equal(stagnantProjection.classification, "MATERIAL_LIVENESS_STAGNANT");
assert.equal(stagnantProjection.escalation.emitted, true);
const stagnantProjectionRepeat = projectionSentinel.observeProjection({
  taskId: "TASK-SENTINEL-PROJECTION-037",
  laneId: "LANE-SENTINEL-037",
  projection: {status: "COMPLETED", items: [], items_count: 0},
  durableSession: {session_id: "SESSION-SENTINEL-037", ordinal: 1, mtime: 1, activity: "one"},
  previousObservation: projectionLag,
  recoveryAttempt: 1,
  maxRecoveryAttempts: 1,
  observedAtUtc: "2026-08-28T15:00:03.000Z",
});
assert.equal(stagnantProjectionRepeat.classification, "MATERIAL_LIVENESS_STAGNANT");
assert.equal(stagnantProjectionRepeat.escalation.duplicate, true);
assert.equal(stagnantProjectionRepeat.escalation.emitted, false);
const distinctStagnantProjection = projectionSentinel.observeProjection({
  taskId: "TASK-SENTINEL-PROJECTION-037",
  laneId: "LANE-SENTINEL-037",
  projection: {status: "COMPLETED", items: [], items_count: 0},
  durableSession: {session_id: "SESSION-SENTINEL-037", ordinal: 1, mtime: 1, activity: "one"},
  receipts: [{receipt_id: "SENTINEL-NON-MATERIAL-037", material: false, status: "EMPTY"}],
  previousObservation: projectionLag,
  recoveryAttempt: 1,
  maxRecoveryAttempts: 1,
  observedAtUtc: "2026-08-28T15:00:04.000Z",
});
assert.equal(distinctStagnantProjection.classification, "MATERIAL_LIVENESS_STAGNANT");
assert.equal(distinctStagnantProjection.escalation.duplicate, false);
assert.equal(distinctStagnantProjection.escalation.emitted, true);

console.log("PASS liveness sentinel: dynamic roster/process observation, deduplicated reports, quiescent boundary, and projection divergence routing");
