#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {
  compileDurableWorkerSessionCommand,
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
    taskKind: "INITIAL",
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

  const command = compileDurableWorkerSessionCommand({
    session: started.session_record,
    commandId: "COMMAND-SMOKE-1",
    task: "Observe the durable session without changing scope.",
    taskId: "COMMAND-SMOKE-1",
    taskKind: "OBSERVE",
  });
  validateDurableWorkerSessionCommand(command, started.session_record);
  const tampered = structuredClone(command);
  tampered.source_tree = "f".repeat(40);
  assert.throws(() => validateDurableWorkerSessionCommand(tampered, started.session_record), /source differs/u);

  const stopped = await stopDurableWorkerSession({sessionRecordPath: recordPath});
  validateLocalDurableSessionRecord(stopped);
  assert.equal(stopped.status, "STOPPED");
  const stoppedHeartbeat = JSON.parse(fs.readFileSync(stopped.heartbeat_path, "utf8"));
  assert.equal(stoppedHeartbeat.status, "STOPPED");
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
