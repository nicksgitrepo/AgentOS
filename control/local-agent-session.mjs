#!/usr/bin/env node

/*
 * Durable local campaign-role session.
 *
 * The session keeps one role alive after its initial task, reports a signed
 * heartbeat, and accepts one source-bound command at a time through a local
 * control-plane record.  Commands run in the same isolated worktree through
 * the existing one-shot worker, so the durable session is supervision custody,
 * not a second authority for Product work.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {pathToFileURL} from "node:url";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}(?:T|t)\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const HEARTBEAT_SCHEMA = "agentos.local_worker_heartbeat.v1";
const COMMAND_SCHEMA = "agentos.local_worker_session_command.v1";
const COMMAND_RESULT_SCHEMA = "agentos.local_worker_session_command_result.v1";
const INITIAL_SCHEMA = "agentos.local_worker_session_initial_readback.v1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return digest(body);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields mismatch`);
}

function safeExistingFile(target, label) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must not be a symlink`);
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  safeExistingFile(target, "session record");
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    fs.writeFileSync(temporary, `${canonicalJson(value)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readJson(target) {
  if (!fs.existsSync(target)) return null;
  safeExistingFile(target, "session record");
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function compileHeartbeat({base, status, lastCommandId = null, childPid = null, error = null}) {
  const heartbeat = {
    schema: HEARTBEAT_SCHEMA,
    version: 1,
    status,
    role: base.role,
    session_id: base.sessionId,
    campaign_id: base.campaignId,
    campaign_version: base.campaignVersion,
    candidate_sha256: base.candidateSha256,
    source_commit: base.sourceCommit,
    source_tree: base.sourceTree,
    session_pid: String(process.pid),
    child_pid: childPid === null ? null : String(childPid),
    last_command_id: lastCommandId,
    error,
    observed_at_utc: new Date().toISOString(),
    heartbeat_sha256: null,
  };
  heartbeat.heartbeat_sha256 = digestWithout(heartbeat, "heartbeat_sha256");
  return heartbeat;
}

function validateCommand(command, base) {
  const keys = ["schema", "version", "command_id", "role", "session_id", "campaign_id", "campaign_version", "candidate_sha256", "source_commit", "source_tree", "task", "task_id", "task_kind", "feature_worktree", "evidence_worktree", "decision_tree_path", "created_at_utc", "command_sha256"];
  exactKeys(command, keys, "session command");
  assert(command.schema === COMMAND_SCHEMA && command.version === 1, "session command identity is invalid");
  requireIdentifier(command.command_id, "session command ID");
  assert(command.role === base.role && command.session_id === base.sessionId, "session command role/session differs");
  assert(command.campaign_id === base.campaignId && command.campaign_version === base.campaignVersion, "session command campaign differs");
  assert(command.candidate_sha256 === base.candidateSha256, "session command candidate differs");
  assert(command.source_commit === base.sourceCommit && command.source_tree === base.sourceTree, "session command source differs");
  for (const field of ["task", "task_id", "task_kind"]) requireString(command[field], `session command ${field}`);
  requireIdentifier(command.task_id, "session command task ID");
  requireIdentifier(command.task_kind, "session command task kind");
  for (const field of ["feature_worktree", "evidence_worktree", "decision_tree_path"]) assert(command[field] === null || typeof command[field] === "string", `session command ${field} is invalid`);
  requireUtc(command.created_at_utc, "session command creation time");
  requireSha(command.command_sha256, "session command digest");
  assert(command.command_sha256 === digestWithout(command, "command_sha256"), "session command digest mismatch");
  return command;
}

function validateHandshake(handshake, base) {
  requireRecord(handshake, "durable worker handshake");
  assert(handshake.schema === "agentos.local_worker_handshake.v1" && handshake.version === 1 && handshake.status === "COMPLETED", "durable worker handshake is invalid");
  assert(handshake.role === base.role && handshake.session_id === base.sessionId, "durable worker handshake role/session differs");
  if (base.taskKind !== undefined) assert(handshake.task_kind === base.taskKind, "durable worker handshake task kind differs");
  assert(handshake.campaign_id === base.campaignId && handshake.campaign_version === base.campaignVersion, "durable worker handshake campaign differs");
  assert(handshake.candidate_sha256 === base.candidateSha256, "durable worker handshake candidate differs");
  assert(handshake.source_commit === base.sourceCommit && handshake.source_tree === base.sourceTree, "durable worker handshake source differs");
  requireSha(handshake.artifact_sha256, "durable worker artifact digest");
  requireSha(handshake.handshake_sha256, "durable worker handshake digest");
  assert(handshake.handshake_sha256 === digestWithout(handshake, "handshake_sha256"), "durable worker handshake digest mismatch");
  return handshake;
}

function commandArgs(base, workerScript, overrides) {
  const values = {
    role: base.role,
    session_id: base.sessionId,
    campaign_id: base.campaignId,
    campaign_version: base.campaignVersion,
    candidate_sha256: base.candidateSha256,
    source_commit: base.sourceCommit,
    source_tree: base.sourceTree,
    worktree: base.worktreePath,
    task: overrides.task,
    task_id: overrides.taskId,
    task_kind: overrides.taskKind,
  };
  const args = [workerScript];
  for (const [key, value] of Object.entries(values)) args.push(`--${key.replaceAll("_", "-")}`, value);
  for (const [key, value] of [["feature-worktree", overrides.featureWorktree], ["evidence-worktree", overrides.evidenceWorktree], ["decision-tree", overrides.decisionTreePath]]) {
    if (value !== null) args.push(`--${key}`, value);
  }
  return args;
}

function runWorker({base, workerScript, overrides}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, commandArgs(base, workerScript, overrides), {
      cwd: base.worktreePath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => {
      if (code !== 0) return reject(new Error(`durable worker exited with ${code ?? signal}: ${stderr.trim() || stdout.trim()}`));
      const line = stdout.trim().split("\n").find((value) => value.length > 0);
      if (!line) return reject(new Error("durable worker returned no handshake"));
      try {
        resolve({handshake: JSON.parse(line), childPid: child.pid});
      } catch (error) {
        reject(new Error(`durable worker returned invalid handshake: ${error.message}`));
      }
    });
  });
}

function compileCommandResult({base, command, status, handshake = null, error = null}) {
  const result = {
    schema: COMMAND_RESULT_SCHEMA,
    version: 1,
    status,
    command_id: command.command_id,
    role: base.role,
    session_id: base.sessionId,
    campaign_id: base.campaignId,
    campaign_version: base.campaignVersion,
    candidate_sha256: base.candidateSha256,
    source_commit: base.sourceCommit,
    source_tree: base.sourceTree,
    handshake,
    error,
    observed_at_utc: new Date().toISOString(),
    result_sha256: null,
  };
  result.result_sha256 = digestWithout(result, "result_sha256");
  return result;
}

async function runSession() {
  const args = parseArgs(process.argv.slice(2));
  const base = {
    role: args.role,
    sessionId: args.session_id,
    campaignId: args.campaign_id,
    campaignVersion: args.campaign_version,
    candidateSha256: args.candidate_sha256,
    sourceCommit: args.source_commit,
    sourceTree: args.source_tree,
    taskKind: args.task_kind ?? "INITIAL",
    worktreePath: path.resolve(args.worktree ?? ""),
  };
  requireIdentifier(base.role, "durable worker role");
  requireIdentifier(base.sessionId, "durable worker session");
  requireIdentifier(base.campaignId, "durable worker campaign");
  requireString(base.campaignVersion, "durable worker campaign version");
  requireSha(base.candidateSha256, "durable worker candidate");
  requireGitObject(base.sourceCommit, "durable worker source commit");
  requireGitObject(base.sourceTree, "durable worker source tree");
  assert(fs.existsSync(base.worktreePath) && fs.statSync(base.worktreePath).isDirectory(), "durable worker worktree is unavailable");
  const workerScript = path.resolve(args.worker_script ?? path.join(path.dirname(new URL(import.meta.url).pathname), "local-agent-worker.mjs"));
  assert(fs.existsSync(workerScript) && fs.statSync(workerScript).isFile(), "durable worker script is unavailable");
  const heartbeatPath = path.resolve(args.heartbeat_path ?? path.join(base.worktreePath, ".agentos-heartbeat.json"));
  const commandPath = path.resolve(args.command_path ?? path.join(base.worktreePath, ".agentos-command.json"));
  const commandResultPath = path.resolve(args.command_result_path ?? path.join(base.worktreePath, ".agentos-command-result.json"));
  const initialReadbackPath = path.resolve(args.initial_readback_path ?? path.join(base.worktreePath, ".agentos-initial-readback.json"));
  for (const target of [heartbeatPath, commandPath, commandResultPath, initialReadbackPath]) safeExistingFile(target, "durable worker session path");
  const initialCommand = {
    task: args.task,
    taskId: args.task_id ?? "INITIAL",
    taskKind: args.task_kind ?? "INITIAL",
    featureWorktree: args.feature_worktree ? path.resolve(args.feature_worktree) : null,
    evidenceWorktree: args.evidence_worktree ? path.resolve(args.evidence_worktree) : null,
    decisionTreePath: args.decision_tree ? path.resolve(args.decision_tree) : null,
  };
  requireString(initialCommand.task, "durable worker initial task");
  requireIdentifier(initialCommand.taskId, "durable worker initial task ID");
  requireIdentifier(initialCommand.taskKind, "durable worker initial task kind");
  let lastCommandId = null;
  let stopping = false;
  let running = null;
  const writeHeartbeat = (status, error = null) => writeJsonAtomic(heartbeatPath, compileHeartbeat({base, status, lastCommandId, childPid: running?.childPid ?? null, error}));
  writeHeartbeat("STARTING");
  try {
    const initial = await runWorker({base, workerScript, overrides: initialCommand});
    const handshake = validateHandshake(initial.handshake, base);
    writeJsonAtomic(initialReadbackPath, {
      schema: INITIAL_SCHEMA,
      version: 1,
      status: "COMPLETED",
      session_pid: String(process.pid),
      handshake,
      observed_at_utc: new Date().toISOString(),
      initial_readback_sha256: null,
    });
    const initialRecord = readJson(initialReadbackPath);
    initialRecord.initial_readback_sha256 = digestWithout(initialRecord, "initial_readback_sha256");
    writeJsonAtomic(initialReadbackPath, initialRecord);
    process.stdout.write(`${JSON.stringify(handshake)}\n`);
    writeHeartbeat("RUNNING");
  } catch (error) {
    const failure = {
      schema: INITIAL_SCHEMA,
      version: 1,
      status: "FAILED",
      session_pid: String(process.pid),
      handshake: null,
      error: error?.message ?? String(error),
      observed_at_utc: new Date().toISOString(),
      initial_readback_sha256: null,
    };
    failure.initial_readback_sha256 = digestWithout(failure, "initial_readback_sha256");
    writeJsonAtomic(initialReadbackPath, failure);
    writeHeartbeat("FAILED", failure.error);
    process.exitCode = 1;
    return;
  }

  const poll = async () => {
    if (stopping || running !== null) return;
    const command = readJson(commandPath);
    if (command === null) return;
    if (command.command_id === lastCommandId) return;
    try {
      validateCommand(command, base);
      running = {childPid: null};
      writeHeartbeat("RUNNING");
      const result = await runWorker({
        base,
        workerScript,
        overrides: {
          task: command.task,
          taskId: command.task_id,
          taskKind: command.task_kind,
          featureWorktree: command.feature_worktree,
          evidenceWorktree: command.evidence_worktree,
          decisionTreePath: command.decision_tree_path,
        },
      });
      running.childPid = result.childPid;
      const handshake = validateHandshake(result.handshake, {...base, taskKind: command.task_kind});
      writeJsonAtomic(commandResultPath, compileCommandResult({base, command, status: "COMPLETED", handshake}));
      lastCommandId = command.command_id;
      writeHeartbeat("RUNNING");
    } catch (error) {
      const result = compileCommandResult({base, command, status: "FAILED", error: error?.message ?? String(error)});
      writeJsonAtomic(commandResultPath, result);
      lastCommandId = command.command_id;
      writeHeartbeat("RUNNING", result.error);
    } finally {
      running = null;
    }
  };
  const pollTimer = setInterval(() => { void poll(); }, 250);
  const heartbeatTimer = setInterval(() => {
    if (!stopping && running === null) writeHeartbeat("RUNNING");
  }, 1_000);
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    writeHeartbeat("STOPPING");
    writeHeartbeat("STOPPED");
    process.exitCode = 0;
  };
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(key?.startsWith("--") && value !== undefined, "durable worker arguments are malformed");
    result[key.slice(2).replaceAll("-", "_")] = value;
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSession().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}

export {compileCommandResult, compileHeartbeat, validateCommand};
