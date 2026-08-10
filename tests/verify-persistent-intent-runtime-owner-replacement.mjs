#!/usr/bin/env node

/* Focused owner-controlled reassessment verifier; execution is deferred in this audit cycle. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compileOwnerGoalReplacement,
  createOpaqueRuntimeReference,
  openPersistentIntentRuntime,
} from "../control/persistent-intent-runtime.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-owner-replacement-"));
const snapshot = {
  schema: "agentos.campaign_snapshot.v1",
  version: 1,
  project_id: "PROJECT-001",
  campaign_id: "CAMPAIGN-001",
  campaign_version: "V1",
  goal_id: "GOAL-001",
  goal_sha256: "a".repeat(64),
  source_commit: "b".repeat(40),
  source_tree: "c".repeat(40),
  progress_status: "PROGRESS_RECORDED",
  scope_changed: false,
  intent_changed: false,
  conditions_changed: false,
  hard_boundary_detected: false,
  soft_boundary_detected: false,
  evidence_identity_ok: true,
  roster_exact: true,
  acceptance_status: "NONE",
};
let runtime;
try {
  runtime = openPersistentIntentRuntime({
    authorityRoot: root,
    repositoryRoot: fs.realpathSync(process.cwd()),
    runtimeRef: createOpaqueRuntimeReference("RUNTIME_REF", "owner-replacement"),
    snapshot,
    environmentId: "ENVIRONMENT-001",
    nowUtc: "2026-08-07T00:00:00.000Z",
  });
  runtime.runIntentRegulatorTick({...snapshot, intent_changed: true}, {idempotencyKey: "REASSESS-001", observedAtUtc: "2026-08-07T00:00:01.000Z"});
  const decision = compileOwnerGoalReplacement({
    state: runtime.readState(),
    goalId: "GOAL-002",
    goalSha256: "d".repeat(64),
    ownerDecisionRef: "OWNER-REVIEW-001",
    approvedAtUtc: "2026-08-07T00:00:02.000Z",
  });
  assert.throws(() => compileOwnerGoalReplacement({
    state: runtime.readState(),
    goalId: "GOAL-003",
    goalSha256: "e".repeat(64),
    sourceCommit: "f".repeat(40),
    ownerDecisionRef: "OWNER-REVIEW-002",
    approvedAtUtc: "2026-08-07T00:00:02.000Z",
  }), /fresh source-bound Runtime/u);
  const replacement = runtime.commitOwnerGoalReplacement(decision, {idempotencyKey: "OWNER-REPLACE-001", nowUtc: "2026-08-07T00:00:02.000Z"});
  assert.equal(replacement.state.status, "ACTIVE");
  assert.equal(replacement.state.goal_id, "GOAL-002");
  assert.equal(replacement.state.dependent_work_allowed, true);
} finally {
  try { runtime?.close({nowUtc: "2026-08-07T00:00:03.000Z"}); } catch { /* deferred verifier cleanup */ }
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS persistent Runtime owner-controlled goal replacement boundary");
