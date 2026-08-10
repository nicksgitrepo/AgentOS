#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {
  compileDurableWorkerSessionCommand,
  compileCommandResult,
  durableWorkerTaskStatus,
  startDurableWorkerSession,
  stopDurableWorkerSession,
  validateDurableWorkerSessionCommand,
  validateLocalDurableSessionRecord,
  validateLocalWorkerHeartbeat,
} from "../control/local-agent-runtime.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourceCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
const sourceTree = execFileSync("git", ["-C", root, "rev-parse", "HEAD^{tree}"], {encoding: "utf8"}).trim();
fs.mkdirSync(path.join(root, "tmp"), {recursive: true});
const runtimeRoot = fs.mkdtempSync(path.join(root, "tmp/agentos-durable-session-"));
const campaignId = `CAMPAIGN-DURABLE-TEST-${process.pid}`;
const workerKey = "FEATURE_AGENT-SMOKE-1";
const recordPath = path.join(runtimeRoot, "sessions", `${campaignId}-v1`, workerKey, "session.json");
let started = null;
let worktreePath = null;

try {
  await assert.rejects(() => startDurableWorkerSession({
    repoRoot: root,
    runtimeRoot,
    role: "FEATURE_AGENT",
    campaignId,
    campaignVersion: "v1",
    candidateSha256: crypto.createHash("sha256").update(campaignId + "-initial-rejected").digest("hex"),
    sourceCommit,
    sourceTree,
    task: "This must fail before a worktree or session is created.",
    taskId: "SMOKE-INITIAL-REJECTED",
    taskKind: "INITIAL",
  }), /not admitted for FEATURE_AGENT/u);
  started = await startDurableWorkerSession({
    repoRoot: root,
    runtimeRoot,
    role: "FEATURE_AGENT",
    campaignId,
    campaignVersion: "v1",
    candidateSha256: crypto.createHash("sha256").update(campaignId).digest("hex"),
    sourceCommit,
    sourceTree,
    task: "Run one bounded local durability test task.",
    taskId: "SMOKE-1",
    taskKind: "CONTROLLER_SUPERVISOR_LIVENESS",
  });
  validateLocalDurableSessionRecord(started.session_record);
  validateLocalWorkerHeartbeat(started.heartbeat, {
    role: "FEATURE_AGENT",
    sessionId: started.session_record.session_id,
    campaignId,
    campaignVersion: "v1",
    candidateSha256: started.session_record.candidate_sha256,
    sourceCommit,
    sourceTree,
  });
  worktreePath = started.session_record.worktree_path;
  assert.equal(started.session_record.status, "RUNNING");
  assert.equal(started.heartbeat.status, "RUNNING");
  assert.equal(started.readback.status, "COMPLETED");
  assert.equal(durableWorkerTaskStatus(started.session_record), "COMPLETED");

  const command = compileDurableWorkerSessionCommand({
    session: started.session_record,
    commandId: "COMMAND-SMOKE-1",
    task: "Observe the durable session without changing scope.",
    taskId: "COMMAND-SMOKE-1",
    taskKind: "CONTROLLER_SUPERVISOR_LIVENESS",
  });
  validateDurableWorkerSessionCommand(command, started.session_record);
  const safeCommandResult = compileCommandResult({
    base: {
      role: started.session_record.role,
      sessionId: started.session_record.session_id,
      campaignId,
      campaignVersion: "v1",
      candidateSha256: started.session_record.candidate_sha256,
      sourceCommit,
      sourceTree,
    },
    command,
    status: "FAILED",
    error: "host secret /private/project/token.txt",
  });
  assert.match(safeCommandResult.error, /^opaque:error:[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(safeCommandResult), /host secret|\/private\/project\/token\.txt/u);
  const tampered = structuredClone(command);
  tampered.source_tree = "f".repeat(40);
  assert.throws(() => validateDurableWorkerSessionCommand(tampered, started.session_record), /source differs/u);

  const stopped = await stopDurableWorkerSession({sessionRecordPath: recordPath});
  validateLocalDurableSessionRecord(stopped);
  assert.equal(stopped.status, "STOPPED");
  assert.equal(durableWorkerTaskStatus(stopped), "COMPLETED");
  const stoppedHeartbeat = JSON.parse(fs.readFileSync(stopped.heartbeat_path, "utf8"));
  assert.equal(stoppedHeartbeat.status, "STOPPED");
  const unexpected = await startDurableWorkerSession({
    repoRoot: root,
    runtimeRoot,
    role: "FEATURE_AGENT",
    campaignId,
    campaignVersion: "v1",
    candidateSha256: crypto.createHash("sha256").update(campaignId + "-unexpected").digest("hex"),
    sourceCommit,
    sourceTree,
    task: "Run an abrupt session-exit durability test.",
    taskId: "SMOKE-UNEXPECTED-DEATH-1",
    taskKind: "CONTROLLER_SUPERVISOR_LIVENESS",
  });
  const unexpectedWorktreePath = unexpected.session_record.worktree_path;
  const unexpectedRecordPath = path.join(runtimeRoot, "sessions", campaignId + "-v1", "FEATURE_AGENT-SMOKE-UNEXPECTED-DEATH-1", "session.json");
  try {
    process.kill(Number(unexpected.session_record.pid), "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const failed = await stopDurableWorkerSession({sessionRecordPath: unexpectedRecordPath});
    validateLocalDurableSessionRecord(failed);
    assert.equal(failed.status, "FAILED");
    assert.match(failed.failure, /process exited before stop/u);
  } finally {
    try {
      execFileSync("git", ["-C", root, "worktree", "remove", "--force", unexpectedWorktreePath], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    } catch {
      // The abrupt-exit test retains no user worktree; an already-removed test worktree is safe.
    }
  }
} finally {
  if (started && worktreePath) {
    try {
      execFileSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    } catch {
      // The test retains no user worktree; an already-removed test worktree is safe.
    }
  }
  fs.rmSync(runtimeRoot, {recursive: true, force: true});
}

console.log("PASS durable local agent session: isolated worktree, heartbeat, source-bound command, failure identity, and bounded stop verified");
