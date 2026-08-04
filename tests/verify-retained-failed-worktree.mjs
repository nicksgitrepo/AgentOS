#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isRetainedFailedAttempt,
  RETAINED_FAILED_ATTEMPT_MARKER,
} from "../control/retained-failed-worktree.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-retained-worktree-"));
const rcaPath = path.join(root, "failure-rca.json");
const rca = {
  schema: "agentos.controller_full_check_failure_rca.v1",
  status: "OPEN_REPAIR_REQUIRED",
  failed_command: "node tests/verify-all.mjs",
  error_message_exact: "SyntaxError: Invalid or unexpected token",
};
const rcaBytes = Buffer.from(`${JSON.stringify(rca)}\n`, "utf8");
fs.writeFileSync(rcaPath, rcaBytes, {flag: "wx", mode: 0o600});
const rcaDigest = crypto.createHash("sha256").update(rcaBytes).digest("hex");
const failedWorktree = path.join(root, "failed-worktree");
fs.mkdirSync(failedWorktree);
fs.writeFileSync(path.join(failedWorktree, RETAINED_FAILED_ATTEMPT_MARKER), `${JSON.stringify({
  schema: "agentos.retained_failed_attempt.v1",
  version: 1,
  status: "RETAINED_FAILED_ATTEMPT",
  active_checkpoint: false,
  evidence_retained: true,
  task_id: "TASK-FAILED-1",
  failure_rca_path: "failure-rca.json",
  failure_rca_sha256: rcaDigest,
  reason: "Retain the failed attempt for evidence while the active checkpoint is checked separately.",
})}\n`, {flag: "wx", mode: 0o600});
fs.writeFileSync(path.join(failedWorktree, "invalid-worker.mjs"), "this is intentionally invalid (\n", {flag: "wx", mode: 0o600});
assert.equal(isRetainedFailedAttempt(failedWorktree, root), true);

const activeWorktree = path.join(root, "active-worktree");
fs.mkdirSync(activeWorktree);
fs.writeFileSync(path.join(activeWorktree, "active.mjs"), "export const active = true;\n", {flag: "wx", mode: 0o600});
assert.equal(isRetainedFailedAttempt(activeWorktree, root), false, "an active checkpoint without a marker remains visible");

const activeMarker = JSON.parse(fs.readFileSync(path.join(failedWorktree, RETAINED_FAILED_ATTEMPT_MARKER), "utf8"));
activeMarker.active_checkpoint = true;
fs.writeFileSync(path.join(failedWorktree, RETAINED_FAILED_ATTEMPT_MARKER), `${JSON.stringify(activeMarker)}\n`, {mode: 0o600});
assert.throws(() => isRetainedFailedAttempt(failedWorktree, root), /active checkpoint cannot be skipped/u);
activeMarker.active_checkpoint = false;
activeMarker.failure_rca_sha256 = "0".repeat(64);
fs.writeFileSync(path.join(failedWorktree, RETAINED_FAILED_ATTEMPT_MARKER), `${JSON.stringify(activeMarker)}\n`, {mode: 0o600});
assert.throws(() => isRetainedFailedAttempt(failedWorktree, root), /RCA digest mismatch/u);

fs.rmSync(root, {recursive: true, force: true});
console.log("PASS retained failed worktree handling: evidence-bound inactive exclusions, active-checkpoint visibility, and hostile marker cases verified");
