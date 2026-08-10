#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  ACTIVATION_STATUS,
  DEFAULT_REVIEW_INTERVAL_MINUTES,
  PROTECTED_ACTIONS,
  compileIntentRegulatorDecision,
  createOpaqueRuntimeReference,
  inspectPersistentIntentRuntime,
  openPersistentIntentRuntime,
  validateIntentRegulatorCheckpoint,
  validatePersistentIntentRuntimeState,
} from "../control/persistent-intent-runtime.mjs";

const REPOSITORY_ROOT = fs.realpathSync(process.cwd());
const PROJECT = "PROJECT-001";
const ENVIRONMENT = "ENVIRONMENT-001";
const CAMPAIGN = "CAMPAIGN-001";
const CAMPAIGN_VERSION = "V1";
const GOAL = "a".repeat(64);
const COMMIT = "b".repeat(40);
const TREE = "c".repeat(40);
const T0 = "2026-01-01T00:00:00.000Z";

function timeAt(seconds) {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString();
}

function snapshot(overrides = {}) {
  return {
    schema: "agentos.campaign_snapshot.v1",
    version: 1,
    project_id: PROJECT,
    campaign_id: CAMPAIGN,
    campaign_version: CAMPAIGN_VERSION,
    goal_id: "GOAL-001",
    goal_sha256: GOAL,
    source_commit: COMMIT,
    source_tree: TREE,
    progress_status: "PROGRESS_RECORDED",
    scope_changed: false,
    intent_changed: false,
    conditions_changed: false,
    hard_boundary_detected: false,
    soft_boundary_detected: false,
    evidence_identity_ok: true,
    roster_exact: true,
    acceptance_status: "NONE",
    ...overrides,
  };
}

function checkpoint(overrides = {}) {
  return {
    schema: "agentos.intent_regulator_checkpoint.v1",
    version: 1,
    activation_status: ACTIVATION_STATUS,
    checkpoint_id: "CHECKPOINT-001",
    project_id: PROJECT,
    campaign_id: CAMPAIGN,
    campaign_version: CAMPAIGN_VERSION,
    goal_id: "GOAL-001",
    goal_sha256: GOAL,
    source_commit: COMMIT,
    source_tree: TREE,
    phase_index: 0,
    lane_index: 0,
    step: "STEP-001",
    next_action: "CAMPAIGN_ORCHESTRATOR",
    progress_status: "PROGRESS_RECORDED",
    meaningful_progress: {
      result_type: "VERIFIED_BEHAVIOR",
      artifact_sha256: "d".repeat(64),
      evidence_sha256: "e".repeat(64),
      handoff_sha256: "f".repeat(64),
      summary_sha256: "1".repeat(64),
    },
    last_meaningful_progress_at_utc: timeAt(20),
    evidence_identity_ok: true,
    created_at_utc: timeAt(20),
    checkpoint_sha256: null,
    ...overrides,
  };
}

function withCheckpointDigest(value) {
  return {...value, checkpoint_sha256: canonicalDigest({...value, checkpoint_sha256: null})};
}

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intent-runtime-"));
}

function open(root, runtimeName, options = {}) {
  return openPersistentIntentRuntime({
    authorityRoot: root,
    repositoryRoot: REPOSITORY_ROOT,
    runtimeRef: createOpaqueRuntimeReference("RUNTIME_REF", runtimeName),
    snapshot: snapshot(),
    environmentId: ENVIRONMENT,
    nowUtc: T0,
    ...options,
  });
}

function assertProtectedActions(value) {
  assert.deepEqual(value, PROTECTED_ACTIONS);
}

// Decision precedence and guide-only authority are pure and deterministic.
assert.equal(compileIntentRegulatorDecision(snapshot(), {observedAtUtc: T0}).decision, "CONTINUE_CAMPAIGN");
assert.equal(compileIntentRegulatorDecision(snapshot({soft_boundary_detected: true}), {observedAtUtc: T0}).decision, "ORCHESTRATOR_REVIEW");
assert.equal(compileIntentRegulatorDecision(snapshot({progress_status: "STALLED"}), {observedAtUtc: T0}).decision, "REPLACE_STALLED_WORKER");
assert.equal(compileIntentRegulatorDecision(snapshot({acceptance_status: "CANDIDATE"}), {observedAtUtc: T0}).decision, "AWAIT_ACCEPTANCE");
assert.equal(compileIntentRegulatorDecision(snapshot({scope_changed: true}), {observedAtUtc: T0}).decision, "REASSESS_AND_REPLACE_GOAL");
assert.equal(compileIntentRegulatorDecision(snapshot({hard_boundary_detected: true, scope_changed: true}), {observedAtUtc: T0}).decision, "STOP_HARD_BOUNDARY");
assert.equal(compileIntentRegulatorDecision(snapshot({evidence_identity_ok: false}), {observedAtUtc: T0}).decision, "STOP_HARD_BOUNDARY");
assert.equal(compileIntentRegulatorDecision(snapshot(), {observedAtUtc: T0}).interval_minutes, DEFAULT_REVIEW_INTERVAL_MINUTES);

const root = freshRoot();
let runtime;
try {
  runtime = open(root, "runtime-a");
  const initial = runtime.readState();
  validatePersistentIntentRuntimeState(initial);
  assert.equal(initial.activation_status, ACTIVATION_STATUS);
  assert.equal(initial.status, "READY");
  assert.equal(initial.review_interval_minutes, DEFAULT_REVIEW_INTERVAL_MINUTES);
  assert.equal(initial.event_cursor, 0);
  assert.deepEqual(initial.persistent_role_ids, ["INTENT_REGULATOR", "RUNTIME"]);
  assertProtectedActions(initial.protected_actions);
  assert.deepEqual(runtime.readPersistentRoles().map((role) => role.role_id), ["INTENT_REGULATOR", "RUNTIME"]);
  assert(runtime.readPersistentRoles().every((role) => role.status === "CONTROL_PLANE_READY" && role.host_session_ref === null));

  const continued = runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "TICK-001", observedAtUtc: timeAt(1)});
  assert.equal(continued.reused, false);
  assert.equal(continued.state.status, "ACTIVE");
  assert.equal(continued.state.event_cursor, 1);
  assert.equal(continued.state.dependent_work_allowed, true);
  assert.equal(continued.event.committed_by_role, "RUNTIME");
  assert.equal(continued.event.actor_role, "INTENT_REGULATOR");
  assertProtectedActions(continued.event.payload.protected_actions);
  const serializedDecision = JSON.parse(JSON.stringify(compileIntentRegulatorDecision(snapshot(), {observedAtUtc: timeAt(1)})));
  assert.throws(() => runtime.commitRegulatorDecision(serializedDecision, {idempotencyKey: "PLAIN-DECISION-001", nowUtc: timeAt(1)}), /in-process Intent Regulator decision capability/u);

  const repeated = runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "TICK-001", observedAtUtc: timeAt(1)});
  assert.equal(repeated.reused, true);
  assert.equal(repeated.state.event_cursor, 1);
  assert.throws(
    () => runtime.runIntentRegulatorTick(snapshot({soft_boundary_detected: true}), {idempotencyKey: "TICK-001", observedAtUtc: timeAt(2)}),
    /idempotency key was reused/u,
  );

  const firstCheckpoint = withCheckpointDigest(checkpoint());
  validateIntentRegulatorCheckpoint(firstCheckpoint);
  const checkpointResult = runtime.recordCheckpoint(firstCheckpoint, {idempotencyKey: "CHECKPOINT-001", nowUtc: timeAt(20)});
  assert.equal(checkpointResult.state.event_cursor, 2);
  assert.equal(checkpointResult.state.checkpoint_sha256, firstCheckpoint.checkpoint_sha256);

  const secondCheckpoint = withCheckpointDigest(checkpoint({checkpoint_id: "CHECKPOINT-002", lane_index: 1, step: "STEP-002", created_at_utc: timeAt(30), last_meaningful_progress_at_utc: timeAt(30)}));
  const secondCheckpointResult = runtime.recordCheckpoint(secondCheckpoint, {idempotencyKey: "CHECKPOINT-002", nowUtc: timeAt(30)});
  assert.equal(secondCheckpointResult.state.event_cursor, 3);
  assert.equal(secondCheckpointResult.checkpoint.checkpoint_sha256, secondCheckpoint.checkpoint_sha256);

  runtime.close({nowUtc: timeAt(40)});
  runtime = null;

  runtime = open(root, "runtime-b", {nowUtc: timeAt(40)});
  const resumed = runtime.resume({nowUtc: timeAt(41)});
  assert.equal(resumed.recovered, false);
  assert.equal(resumed.state.event_cursor, 3);
  assert.equal(resumed.checkpoint.checkpoint_id, "CHECKPOINT-002");
  assert.equal(runtime.readEvents().length, 3);

  const hard = runtime.runIntentRegulatorTick(snapshot({hard_boundary_detected: true}), {idempotencyKey: "HARD-001", observedAtUtc: timeAt(50)});
  assert.equal(hard.state.status, "HARD_STOPPED");
  assert.equal(hard.state.dependent_work_allowed, false);
  assert.equal(hard.state.pending_owner_decision, "HARD_BOUNDARY_REVIEW");
  assert.throws(() => runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "AFTER-HARD-001", observedAtUtc: timeAt(51)}), /hard-stopped Runtime/u);
  runtime.close({nowUtc: timeAt(60)});
  runtime = null;
} finally {
  if (runtime !== null) {
    try { runtime.close({nowUtc: timeAt(70)}); } catch { /* test cleanup */ }
  }
  fs.rmSync(root, {recursive: true, force: true});
}

// Reassessment closes dependent continuation until a replacement goal exists.
const reassessmentRoot = freshRoot();
let reassessmentRuntime;
try {
  reassessmentRuntime = open(reassessmentRoot, "runtime-reassessment");
  const result = reassessmentRuntime.runIntentRegulatorTick(snapshot({intent_changed: true}), {idempotencyKey: "REASSESS-001", observedAtUtc: timeAt(1)});
  assert.equal(result.state.status, "REASSESSMENT_REQUIRED");
  assert.equal(result.state.pending_owner_decision, "REPLACE_GOAL");
  assert.throws(() => reassessmentRuntime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "REASSESS-002", observedAtUtc: timeAt(2)}), /goal reassessment/u);
} finally {
  if (reassessmentRuntime !== undefined) {
    try { reassessmentRuntime.close({nowUtc: timeAt(10)}); } catch { /* test cleanup */ }
  }
  fs.rmSync(reassessmentRoot, {recursive: true, force: true});
}

// A meaningful-progress timer cannot be satisfied by a heartbeat-shaped result.
const heartbeatCheckpoint = checkpoint({progress_status: "PROGRESS_RECORDED", meaningful_progress: {
  result_type: "HEARTBEAT",
  artifact_sha256: "d".repeat(64),
  evidence_sha256: "e".repeat(64),
  handoff_sha256: "f".repeat(64),
  summary_sha256: "1".repeat(64),
}});
assert.throws(() => validateIntentRegulatorCheckpoint(withCheckpointDigest(heartbeatCheckpoint)), /not meaningful/u);

// A prepared transaction is recovered after the original Runtime disappears.
const crashRoot = freshRoot();
let crashedRuntime;
try {
  crashedRuntime = open(crashRoot, "runtime-crash", {
    leaseDurationSeconds: 5,
    faultInjector: (stage) => {
      if (stage === "EVENT_WRITTEN") throw Object.assign(new Error("simulated process loss"), {code: "TEST_PROCESS_LOSS"});
    },
  });
  assert.throws(() => crashedRuntime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "CRASH-001", observedAtUtc: timeAt(1)}), /simulated process loss/u);
  const resumedAfterCrash = open(crashRoot, "runtime-after-crash", {nowUtc: timeAt(7)});
  try {
    assert.equal(resumedAfterCrash.readState().event_cursor, 1);
    assert.equal(resumedAfterCrash.readEvents()[0].idempotency_key, "CRASH-001");
    assert.equal(resumedAfterCrash.resume({nowUtc: timeAt(7)}).recovered, false);
    resumedAfterCrash.close({nowUtc: timeAt(8)});
  } finally {
    try { resumedAfterCrash.close({nowUtc: timeAt(8)}); } catch { /* already closed */ }
  }
} finally {
  fs.rmSync(crashRoot, {recursive: true, force: true});
}

// A newer fencing epoch makes the old Runtime unable to write.
const fencingRoot = freshRoot();
let firstRuntime;
let secondRuntime;
try {
  firstRuntime = open(fencingRoot, "runtime-first", {leaseDurationSeconds: 1});
  secondRuntime = open(fencingRoot, "runtime-second", {nowUtc: timeAt(3), leaseDurationSeconds: 60});
  assert.throws(() => firstRuntime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "FENCED-001", observedAtUtc: timeAt(3)}), /fenced/u);
  secondRuntime.close({nowUtc: timeAt(4)});
} finally {
  try { secondRuntime?.close({nowUtc: timeAt(4)}); } catch { /* cleanup */ }
  try { firstRuntime?.close({nowUtc: timeAt(4)}); } catch { /* fenced Runtime cannot release */ }
  fs.rmSync(fencingRoot, {recursive: true, force: true});
}

// A tampered journal is rejected on restart; it is never silently repaired.
const tamperRoot = freshRoot();
let tamperRuntime;
try {
  tamperRuntime = open(tamperRoot, "runtime-tamper");
  tamperRuntime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "TAMPER-001", observedAtUtc: timeAt(1)});
  tamperRuntime.close({nowUtc: timeAt(2)});
  tamperRuntime = null;
  fs.writeFileSync(path.join(tamperRoot, "events", "000000000001.json"), "{}\n", "utf8");
  assert.throws(() => open(tamperRoot, "runtime-rejects-tamper", {nowUtc: timeAt(3)}), /Runtime authority event fields mismatch|Runtime authority event identity is invalid/u);
} finally {
  try { tamperRuntime?.close({nowUtc: timeAt(3)}); } catch { /* cleanup */ }
  fs.rmSync(tamperRoot, {recursive: true, force: true});
}

// The authority root is not embedded in semantic records, and the store
// rejects a repository-root target rather than persisting Product-local state.
const boundaryRoot = freshRoot();
try {
  const boundaryRuntime = open(boundaryRoot, "runtime-boundary");
  const serialized = JSON.stringify(boundaryRuntime.readState());
  assert.equal(serialized.includes(boundaryRoot), false);
  boundaryRuntime.close({nowUtc: timeAt(2)});
  assert.throws(() => open(REPOSITORY_ROOT, "runtime-inside-repository"), /outside the repository/u);
  const inspected = inspectPersistentIntentRuntime({authorityRoot: boundaryRoot, repositoryRoot: REPOSITORY_ROOT});
  assert.equal(inspected.state !== null, true);
  assert.equal(inspected.roles.length, 2);
} finally {
  fs.rmSync(boundaryRoot, {recursive: true, force: true});
}

console.log(JSON.stringify({status: "PASS", default_review_minutes: DEFAULT_REVIEW_INTERVAL_MINUTES, decisions: 6, durable_events: 3, crash_recovery: true, fencing: true}));
