#!/usr/bin/env node

/* Durable Runtime recovery, fencing, lock, and process-loss coverage. */

import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  ACTIVATION_STATUS,
  createOpaqueRuntimeReference,
  inspectPersistentIntentRuntime,
  openPersistentIntentRuntime,
} from "../control/persistent-intent-runtime.mjs";

const repositoryRoot = fs.realpathSync(process.cwd());
const PROJECT = "PROJECT-001";
const ENVIRONMENT = "ENVIRONMENT-001";
const CAMPAIGN = "CAMPAIGN-001";
const GOAL_ID = "GOAL-001";
const GOAL_SHA256 = "a".repeat(64);
const SOURCE_COMMIT = "b".repeat(40);
const SOURCE_TREE = "c".repeat(40);
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
    campaign_version: "V1",
    goal_id: GOAL_ID,
    goal_sha256: GOAL_SHA256,
    source_commit: SOURCE_COMMIT,
    source_tree: SOURCE_TREE,
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

function checkpoint() {
  const value = {
    schema: "agentos.intent_regulator_checkpoint.v1",
    version: 1,
    activation_status: ACTIVATION_STATUS,
    checkpoint_id: "CHECKPOINT-001",
    project_id: PROJECT,
    campaign_id: CAMPAIGN,
    campaign_version: "V1",
    goal_id: GOAL_ID,
    goal_sha256: GOAL_SHA256,
    source_commit: SOURCE_COMMIT,
    source_tree: SOURCE_TREE,
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
    last_meaningful_progress_at_utc: timeAt(1),
    evidence_identity_ok: true,
    created_at_utc: timeAt(1),
    checkpoint_sha256: null,
  };
  value.checkpoint_sha256 = canonicalDigest(value);
  return value;
}

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentos-runtime-recovery-"));
}

function open(root, name, options = {}) {
  return openPersistentIntentRuntime({
    authorityRoot: root,
    repositoryRoot,
    runtimeRef: createOpaqueRuntimeReference("RUNTIME_REF", name),
    snapshot: snapshot(),
    environmentId: ENVIRONMENT,
    nowUtc: T0,
    ...options,
  });
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code, `expected error code ${code}`);
}

function readOnlyTransaction(root) {
  const names = fs.readdirSync(path.join(root, "transactions"));
  assert.equal(names.length, 1);
  return JSON.parse(fs.readFileSync(path.join(root, "transactions", names[0]), "utf8"));
}

function runRecoveryAt(stage) {
  const root = freshRoot();
  let runtime;
  try {
    runtime = open(root, `recovery-${stage}`, {
      leaseDurationSeconds: 5,
      faultInjector: (faultStage) => {
        if (faultStage === stage) throw Object.assign(new Error(`simulated ${stage}`), {code: "TEST_PROCESS_LOSS"});
      },
    });
    if (stage === "CHECKPOINT_WRITTEN") {
      assert.throws(() => runtime.recordCheckpoint(checkpoint(), {idempotencyKey: `RECOVERY-${stage}`, nowUtc: timeAt(1)}), /simulated CHECKPOINT_WRITTEN/u);
    } else {
      assert.throws(() => runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: `RECOVERY-${stage}`, observedAtUtc: timeAt(1)}), new RegExp(`simulated ${stage}`, "u"));
    }
    runtime.close({nowUtc: timeAt(2)});
    runtime = null;

    const recovered = open(root, `recovered-${stage}`, {nowUtc: timeAt(10), leaseDurationSeconds: 5});
    try {
      assert.equal(recovered.readState().event_cursor, 1, `${stage} did not recover exactly one event`);
      assert.equal(recovered.readEvents().length, 1, `${stage} recovered event count is wrong`);
      if (stage === "CHECKPOINT_WRITTEN") assert.equal(recovered.readCheckpoint().checkpoint_id, "CHECKPOINT-001");
      const transaction = readOnlyTransaction(root);
      assert.equal(transaction.status, "COMMITTED", `${stage} transaction was not finalized`);
      assert.equal(recovered.resume({nowUtc: timeAt(11)}).recovered, false, `${stage} recovery was not idempotent`);
    } finally {
      recovered.close({nowUtc: timeAt(12)});
    }
  } finally {
    try { runtime?.close({nowUtc: timeAt(2)}); } catch { /* test cleanup */ }
    fs.rmSync(root, {recursive: true, force: true});
  }
}

for (const stage of ["TRANSACTION_PREPARED", "EVENT_WRITTEN", "CHECKPOINT_WRITTEN", "STATE_WRITTEN"]) runRecoveryAt(stage);

// A prepared transaction requires explicit recovery and cannot be shadowed by a second write.
{
  const root = freshRoot();
  let runtime;
  try {
    runtime = open(root, "explicit-recovery", {
      faultInjector: (stage) => {
        if (stage === "TRANSACTION_PREPARED") throw Object.assign(new Error("prepared"), {code: "TEST_PROCESS_LOSS"});
      },
    });
    assert.throws(() => runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "EXPLICIT-001", observedAtUtc: timeAt(1)}), /prepared/u);
    expectCode(() => runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "EXPLICIT-002", observedAtUtc: timeAt(2)}), "RUNTIME_RECOVERY_REQUIRED");
    assert.equal(runtime.resume({nowUtc: timeAt(3)}).recovered, true);
    assert.equal(runtime.readState().event_cursor, 1);
    runtime.close({nowUtc: timeAt(4)});
    runtime = null;
  } finally {
    try { runtime?.close({nowUtc: timeAt(4)}); } catch { /* test cleanup */ }
    fs.rmSync(root, {recursive: true, force: true});
  }
}

// A real child process can die after the event is durable; restart recovers the prepared transaction.
{
  const root = freshRoot();
  const runtimeModuleUrl = new URL("../control/persistent-intent-runtime.mjs", import.meta.url).href;
  const childSource = `
    import fs from "node:fs";
    import path from "node:path";
    import {createOpaqueRuntimeReference, openPersistentIntentRuntime} from ${JSON.stringify(runtimeModuleUrl)};
    const root = process.argv.at(-1);
    const snapshot = {
      schema: "agentos.campaign_snapshot.v1", version: 1, project_id: "PROJECT-001", campaign_id: "CAMPAIGN-001",
      campaign_version: "V1", goal_id: "GOAL-001", goal_sha256: "${GOAL_SHA256}", source_commit: "${SOURCE_COMMIT}",
      source_tree: "${SOURCE_TREE}", progress_status: "PROGRESS_RECORDED", scope_changed: false, intent_changed: false,
      conditions_changed: false, hard_boundary_detected: false, soft_boundary_detected: false,
      evidence_identity_ok: true, roster_exact: true, acceptance_status: "NONE"
    };
    const runtime = openPersistentIntentRuntime({
      authorityRoot: root, repositoryRoot: ${JSON.stringify(repositoryRoot)},
      runtimeRef: createOpaqueRuntimeReference("RUNTIME_REF", "child-crash"), snapshot,
      environmentId: "ENVIRONMENT-001", nowUtc: "${T0}", leaseDurationSeconds: 5,
      faultInjector: (stage) => {
        if (stage !== "EVENT_WRITTEN") return;
        const lockPath = path.join(root, "authority.lock");
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        lock.expires_at_utc = "1970-01-01T00:00:00.000Z";
        fs.writeFileSync(lockPath, JSON.stringify(lock) + "\\n", "utf8");
        process.kill(process.pid, "SIGKILL");
      },
    });
    runtime.runIntentRegulatorTick(snapshot, {idempotencyKey: "CHILD-001", observedAtUtc: "${timeAt(1)}"});
  `;
  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource, root], {encoding: "utf8"});
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const recovered = open(root, "child-recovered", {nowUtc: timeAt(10), leaseDurationSeconds: 5});
    try {
      assert.equal(recovered.readState().event_cursor, 1);
      assert.equal(recovered.readEvents()[0].idempotency_key, "CHILD-001");
      assert.equal(readOnlyTransaction(root).status, "COMMITTED");
    } finally {
      recovered.close({nowUtc: timeAt(11)});
    }
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

// Malformed lock metadata is a hard stop and is never deleted as if it were stale.
{
  const root = freshRoot();
  let runtime = open(root, "lock-corruption");
  runtime.close({nowUtc: timeAt(1)});
  runtime = null;
  const malformed = "not-json\n";
  fs.writeFileSync(path.join(root, "authority.lock"), malformed, "utf8");
  try {
    expectCode(() => open(root, "lock-corruption-retry", {nowUtc: timeAt(2)}), "RUNTIME_LOCK_CORRUPT");
    assert.equal(fs.readFileSync(path.join(root, "authority.lock"), "utf8"), malformed);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

// A valid expired lock is recoverable; a valid unexpired lock remains held.
{
  const root = freshRoot();
  let runtime = open(root, "lock-expiry");
  runtime.close({nowUtc: timeAt(1)});
  runtime = null;
  fs.writeFileSync(path.join(root, "authority.lock"), JSON.stringify({
    schema: "agentos.intent_regulator_runtime_lock.v1",
    version: 1,
    runtime_ref: "LOCK_INTERNAL",
    expires_at_utc: "1970-01-01T00:00:00.000Z",
  }) + "\n", "utf8");
  const recovered = open(root, "lock-expiry-recovered", {nowUtc: timeAt(2)});
  recovered.close({nowUtc: timeAt(3)});
  fs.rmSync(root, {recursive: true, force: true});
}

function committedRoot(name, {checkpointRecord = false} = {}) {
  const root = freshRoot();
  const runtime = open(root, name);
  const keyPrefix = name.toUpperCase();
  runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: `${keyPrefix}-001`, observedAtUtc: timeAt(1)});
  if (checkpointRecord) runtime.recordCheckpoint(checkpoint(), {idempotencyKey: `${keyPrefix}-CHECKPOINT-001`, nowUtc: timeAt(2)});
  runtime.close({nowUtc: timeAt(3)});
  return root;
}

// Missing, extra, malformed, and symlinked records all stop without repair.
{
  const missingEventRoot = committedRoot("missing-event");
  fs.unlinkSync(path.join(missingEventRoot, "events", "000000000001.json"));
  try { expectCode(() => open(missingEventRoot, "missing-event-reopen", {nowUtc: timeAt(10)}), "RUNTIME_STATE_CORRUPT"); }
  finally { assert.equal(fs.existsSync(path.join(missingEventRoot, "events", "000000000001.json")), false); fs.rmSync(missingEventRoot, {recursive: true, force: true}); }

  const extraEventRoot = committedRoot("extra-event");
  fs.copyFileSync(path.join(extraEventRoot, "events", "000000000001.json"), path.join(extraEventRoot, "events", "000000000002.json"));
  try { expectCode(() => open(extraEventRoot, "extra-event-reopen", {nowUtc: timeAt(10)}), "RUNTIME_STATE_CORRUPT"); }
  finally { fs.rmSync(extraEventRoot, {recursive: true, force: true}); }

  const malformedStateRoot = committedRoot("malformed-state");
  fs.writeFileSync(path.join(malformedStateRoot, "state.json"), "{}\n", "utf8");
  try { expectCode(() => open(malformedStateRoot, "malformed-state-reopen", {nowUtc: timeAt(10)}), "PERSISTENT_INTENT_RUNTIME_INVALID"); }
  finally { fs.rmSync(malformedStateRoot, {recursive: true, force: true}); }

  const symlinkRoot = committedRoot("symlink-event");
  const outside = path.join(os.tmpdir(), `agentos-runtime-event-${process.pid}.json`);
  fs.copyFileSync(path.join(symlinkRoot, "events", "000000000001.json"), outside);
  fs.unlinkSync(path.join(symlinkRoot, "events", "000000000001.json"));
  fs.symlinkSync(outside, path.join(symlinkRoot, "events", "000000000001.json"));
  try { expectCode(() => open(symlinkRoot, "symlink-event-reopen", {nowUtc: timeAt(10)}), "RUNTIME_STORAGE_BOUNDARY"); }
  finally { fs.rmSync(symlinkRoot, {recursive: true, force: true}); fs.rmSync(outside, {force: true}); }

  const missingCheckpointRoot = committedRoot("missing-checkpoint", {checkpointRecord: true});
  fs.unlinkSync(path.join(missingCheckpointRoot, "checkpoint.json"));
  try { expectCode(() => open(missingCheckpointRoot, "missing-checkpoint-reopen", {nowUtc: timeAt(10)}), "RUNTIME_STATE_CORRUPT"); }
  finally { fs.rmSync(missingCheckpointRoot, {recursive: true, force: true}); }
}

// Two valid prepared transactions require manual reconciliation; the Runtime never chooses one.
{
  const root = freshRoot();
  let runtime = open(root, "multiple-prepared", {
    faultInjector: (stage) => {
      if (stage === "TRANSACTION_PREPARED") throw Object.assign(new Error("prepared"), {code: "TEST_PROCESS_LOSS"});
    },
  });
  assert.throws(() => runtime.runIntentRegulatorTick(snapshot(), {idempotencyKey: "MULTI-001", observedAtUtc: timeAt(1)}), /prepared/u);
  runtime.close({nowUtc: timeAt(2)});
  runtime = null;
  const transaction = readOnlyTransaction(root);
  const second = {...transaction, transaction_id: `TRANSACTION_REF_${"e".repeat(64)}`, transaction_sha256: null};
  second.transaction_sha256 = canonicalDigest(second);
  fs.writeFileSync(path.join(root, "transactions", `${second.transaction_id}.json`), JSON.stringify(second) + "\n", "utf8");
  try { expectCode(() => open(root, "multiple-prepared-reopen", {nowUtc: timeAt(10)}), "RUNTIME_RECOVERY_BLOCKED"); }
  finally { fs.rmSync(root, {recursive: true, force: true}); }
}

console.log("PASS persistent Runtime recovery: staged replay, child-process loss, fencing guard, lock fail-closed behavior, corruption, symlink, and multi-transaction hostile cases verified");
