#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileSpawnerLivenessCheckpoint,
  runSpawnerBoundedPhase,
  validateSpawnerLivenessCheckpoint,
} from "../control/spawner-liveness-checkpoint.mjs";

const receiptSha = canonicalDigest({receipt: "progress"});
const base = {
  checkpointId: "CHECKPOINT.SPAWNER.OPENAPI.PHASE.001",
  lifecycleId: "LIFECYCLE.SPAWNER.OPENAPI",
  phase: "OPENAPI_CONTRACTS",
  phaseIndex: 0,
  phaseWindowSeconds: 30,
  startedAtUtc: "2026-08-22T15:00:00.000Z",
  observedAtUtc: "2026-08-22T15:00:05.000Z",
  exactReceiptRef: "opaque:spawner/openapi/phase-001",
  exactReceiptSha256: receiptSha,
};

const progress = compileSpawnerLivenessCheckpoint({...base, meaningfulProgress: true});
assert.equal(progress.status, "PROGRESS");
assert.equal(progress.safe_stop, false);
assert.equal(progress.next_action, "CONTINUE_PHASE");
validateSpawnerLivenessCheckpoint(progress);

const typed = compileSpawnerLivenessCheckpoint({...base, typedResultStatus: "PRESENT"});
assert.equal(typed.status, "TYPED_RESULT");

const waiting = compileSpawnerLivenessCheckpoint({...base, meaningfulProgress: false, typedResultStatus: "ABSENT"});
assert.equal(waiting.status, "WAITING_WITHIN_BOUND");
assert.equal(waiting.safe_stop, false);

const blocked = compileSpawnerLivenessCheckpoint({
  ...base,
  checkpointId: "CHECKPOINT.SPAWNER.OPENAPI.PHASE.002",
  observedAtUtc: "2026-08-22T15:00:31.000Z",
  meaningfulProgress: false,
  typedResultStatus: "ABSENT",
});
assert.equal(blocked.status, "BLOCKED_EXACT");
assert.equal(blocked.safe_stop, true);
assert.equal(blocked.next_action, "REHOME_OR_RESTART");

const unknown = compileSpawnerLivenessCheckpoint({
  ...base,
  checkpointId: "CHECKPOINT.SPAWNER.OPENAPI.PHASE.003",
  observedAtUtc: "2026-08-22T15:00:31.000Z",
  exactReceiptStatus: "UNKNOWN",
  meaningfulProgress: false,
  typedResultStatus: "UNKNOWN",
});
assert.equal(unknown.status, "UNKNOWN");
assert.equal(unknown.safe_stop, true);
assert.equal(unknown.next_action, "REHOME_OR_RESTART");

const thrown = runSpawnerBoundedPhase({
  ...base,
  checkpointId: "CHECKPOINT.SPAWNER.OPENAPI.PHASE.004",
  observedAtUtc: "2026-08-22T15:00:31.000Z",
  execute: () => { const error = new Error("phase did not produce a typed result"); error.code = "NO_TYPED_RESULT"; throw error; },
});
assert.equal(thrown.result, null);
assert.equal(thrown.error.error_code, "NO_TYPED_RESULT");
assert.equal(thrown.checkpoint.status, "BLOCKED_EXACT");
assert.equal(thrown.checkpoint.next_action, "REHOME_OR_RESTART");
assert.equal(thrown.checkpoint.persistence.receipt_sha256, thrown.checkpoint.exact_receipt_sha256);

const tampered = structuredClone(blocked);
tampered.safe_stop = false;
tampered.checkpoint_sha256 = canonicalDigest({...tampered, checkpoint_sha256: null});
assert.throws(() => validateSpawnerLivenessCheckpoint(tampered), /stop safely and request rehome\/restart/u);

console.log("PASS Spawner liveness checkpoint: bounded phases emit durable typed receipts; stale/no-result windows stop as BLOCKED_EXACT or UNKNOWN and request rehome/restart");
