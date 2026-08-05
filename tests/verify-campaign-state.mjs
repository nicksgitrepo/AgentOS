#!/usr/bin/env node

import assert from "node:assert/strict";
import {createGoal, createProgressWindow, evaluateProgressWindow, reassessGoal, recordWorkerResult, validateGoal} from "../control/campaign-state.mjs";

const base = {
  goal_id: "GOAL-001",
  objective: "Maintain the admitted behavior",
  scope: {lane: "functionality", files: ["one"]},
  intent: {outcome: "works"},
  boundaries: {hard: ["no release"], soft: ["review"],},
  created_at_utc: "2026-01-01T00:00:00.000Z",
};
const goal = createGoal(base);
validateGoal(goal);
const observation = {
  objective: base.objective,
  scope: base.scope,
  intent: base.intent,
  boundaries: base.boundaries,
  observed_at_utc: "2026-01-01T00:05:00.000Z",
  reason: "A routine audit found no change",
  replacement_goal_id: "GOAL-002",
};
const unchanged = reassessGoal(goal, {
  ...observation,
});
assert.equal(unchanged.status, "UNCHANGED");
assert.equal(unchanged.goal.digest, goal.digest);

const changed = reassessGoal(goal, {
  ...observation,
  objective: "Maintain the admitted behavior and add a new boundary",
  boundaries: {hard: ["no release", "no credentials"], soft: ["review"]},
  observed_at_utc: "2026-01-01T00:06:00.000Z",
  reason: "The operating conditions changed",
});
assert.equal(changed.status, "REPLACEMENT_REQUIRED");
assert.equal(changed.goal.status, "SUCCEEDED_BY_REASSESSMENT");
assert.equal(changed.goal.replacement_goal_id, "GOAL-002");
assert.equal(changed.replacement_goal.status, "ACTIVE");
assert.notEqual(changed.goal.digest, changed.replacement_goal.digest);

const progressInput = {
  artifact_sha256: "c".repeat(64),
  evidence_sha256: "d".repeat(64),
};
let window = createProgressWindow({window_id: "WINDOW-001", worker_id: "WORKER-001", goal_id: goal.goal_id, started_at_utc: "2026-01-01T00:00:00.000Z"});
assert.equal(window.deadline_at_utc, "2026-01-01T00:15:00.000Z");
const open = evaluateProgressWindow(window, "2026-01-01T00:10:00.000Z");
assert.equal(open.status, "OPEN");
window = recordWorkerResult(window, {...progressInput, result_type: "ARTIFACT", summary: "Created a verified artifact", observed_at_utc: "2026-01-01T00:10:00.000Z"});
assert.equal(window.status, "PROGRESS_RECORDED");

let failureWindow = createProgressWindow({window_id: "WINDOW-002", worker_id: "WORKER-001", goal_id: goal.goal_id, started_at_utc: "2026-01-01T00:00:00.000Z"});
failureWindow = recordWorkerResult(failureWindow, {...progressInput, result_type: "FAILURE_LIST", summary: "Listed failures without a result", observed_at_utc: "2026-01-01T00:05:00.000Z"});
assert.equal(failureWindow.status, "STALLED");
assert.equal(failureWindow.stall_reason, "FAILURE_LIST_ONLY");

let expiredWindow = createProgressWindow({window_id: "WINDOW-003", worker_id: "WORKER-001", goal_id: goal.goal_id, started_at_utc: "2026-01-01T00:00:00.000Z"});
const expired = evaluateProgressWindow(expiredWindow, "2026-01-01T00:15:00.000Z");
assert.equal(expired.status, "STALLED");
assert.equal(expired.window.stall_reason, "WINDOW_EXPIRED");
expiredWindow = expired.window;
assert.throws(() => recordWorkerResult(expiredWindow, {...progressInput, result_type: "ARTIFACT", summary: "Too late", observed_at_utc: "2026-01-01T00:16:00.000Z"}), /no longer open/u);

console.log(JSON.stringify({status: "PASS", reassessment: changed.status, failure_list: failureWindow.status, expired: expired.status}));
