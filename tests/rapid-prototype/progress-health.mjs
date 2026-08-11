#!/usr/bin/env node

import assert from "node:assert/strict";
import {recordProgress} from "../../control/rapid-prototype/progress-health.mjs";

const START = "2026-08-04T12:00:00.000Z";
const OBSERVED = "2026-08-04T12:05:00.000Z";
const DEADLINE = "2026-08-10T12:00:00.000Z";
const TASK_ID = "task-Exact_01";
const SCOPE = ["PORTABLE_PROGRESS_CONTRACT"];
const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);
const PROGRESS_EVIDENCE = {digest: "c".repeat(64), identity: "evidence-Exact_01", kind: "LOCAL_DETERMINISTIC_CHECK"};

function observation(overrides = {}) {
  return recordProgress({
    workerIdentity: "worker-Exact_01",
    phase: "IMPLEMENTATION_PROGRESS_AND_HEALTH",
    meaningfulProgress: true,
    heartbeat: true,
    startedAt: START,
    observedAt: OBSERVED,
    deadline: DEADLINE,
    result: null,
    error: null,
    taskId: TASK_ID,
    scope: SCOPE,
    sourceCommit: SOURCE_COMMIT,
    sourceTree: SOURCE_TREE,
    evidence: PROGRESS_EVIDENCE,
    ...overrides,
  });
}

const meaningful = observation();
assert.equal(meaningful.worker_identity, "worker-Exact_01");
assert.equal(meaningful.phase, "IMPLEMENTATION_PROGRESS_AND_HEALTH");
assert.equal(meaningful.progress, "MEANINGFUL");
assert.equal(meaningful.liveness, "LIVE");
assert.equal(meaningful.status, "IN_PROGRESS");
assert.equal(meaningful.completed, false);

const heartbeatOnly = observation({meaningfulProgress: false, heartbeat: true});
assert.equal(heartbeatOnly.progress, "HEARTBEAT_ONLY");
assert.equal(heartbeatOnly.meaningful_progress, false);
assert.equal(heartbeatOnly.status, "IN_PROGRESS");
assert.equal(heartbeatOnly.completed, false);

const timeout = observation({
  meaningfulProgress: false,
  observedAt: "2026-08-10T12:00:00.001Z",
  result: null,
});
assert.equal(timeout.progress, "HEARTBEAT_ONLY");
assert.equal(timeout.liveness, "LIVE");
assert.equal(timeout.status, "TIMEOUT");
assert.equal(timeout.timed_out, true);
assert.equal(timeout.completed, false);

const lateSuccess = observation({
  observedAt: "2026-08-10T12:00:00.001Z",
  result: "SUCCESS",
});
assert.equal(lateSuccess.status, "TIMEOUT");
assert.equal(lateSuccess.completed, false);

const success = observation({result: "SUCCESS"});
assert.equal(success.status, "COMPLETED");
assert.equal(success.completed, true);
assert.equal(success.timed_out, false);

const failure = observation({error: "focused check failed"});
assert.equal(failure.status, "FAILED");
assert.equal(failure.error_status, "FAILED");
assert.equal(failure.completed, false);

const blocked = observation({result: "BLOCKED", error: {status: "BLOCKED", reason: "dependency"}});
assert.equal(blocked.status, "BLOCKED");
assert.equal(blocked.completed, false);

const unavailable = observation({result: "SUCCESS", error: {status: "UNAVAILABLE", reason: "capability"}});
assert.equal(unavailable.status, "UNAVAILABLE");
assert.equal(unavailable.health, "UNAVAILABLE");
assert.equal(unavailable.completed, false);

const missingHeartbeat = observation({heartbeat: false});
assert.equal(missingHeartbeat.progress, "MEANINGFUL");
assert.equal(missingHeartbeat.liveness, "UNKNOWN");
assert.equal(missingHeartbeat.health, "STALE");

assert.throws(() => observation({workerIdentity: "worker other"}), /stable identity/u);
assert.throws(() => observation({observedAt: "2026-08-04T11:59:59.999Z"}), /precedes its start/u);
assert.throws(() => observation({result: "SUCCESS", error: null, deadline: "2026-08-04T11:00:00.000Z"}), /precedes its start/u);
assert.throws(() => observation({result: "MAYBE"}), /unsupported/u);

console.log("PASS progress records preserve identity, separate progress from heartbeat, and fail closed on timeout or blockers");
