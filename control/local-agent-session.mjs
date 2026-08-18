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
import {createHybridScheduler, opaqueSchedulerWorktreeRef} from "./hybrid-scheduler.mjs";
import {compileOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";
import {issueGlobalGovernanceProcessAttachment, reattachGlobalGovernanceAuthorityStore} from "./global-governance-bootstrap.mjs";
import {getSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";
import {createLocalWorkerLaunchAdmission} from "./local-agent-runtime.mjs";
import {pathToFileURL} from "node:url";
import {validateLocalTaskKindForRole} from "./local-task-kinds.mjs";
import {redactPersistedText} from "./persisted-record-privacy.mjs";

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

function pidAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
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

function opaqueError(value) {
  const raw = value?.message ?? String(value);
  if (/^opaque:error:[0-9a-f]{64}$/u.test(raw)) return raw;
  return `opaque:error:${crypto.createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

const PERSISTED_DIGEST_FIELDS = new Set(["handshake_sha256", "readback_sha256", "session_sha256", "heartbeat_sha256", "command_sha256", "result_sha256", "initial_readback_sha256"]);
const PRIVATE_PATH_TEXT = /(?:^|[\s"'`=:(\[{])(?:\/(?!\/)(?:[^\/\s"'`<>)}\]]+\/)+[^\/\s"'`<>)}\]]+|[A-Za-z]:[\\/]|\\\\)/u;

function persistedCustodyRecord(value) {
  if (Array.isArray(value)) return value.map(persistedCustodyRecord);
  if (isRecord(value)) {
    const record = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, persistedCustodyRecord(child)]));
    for (const field of PERSISTED_DIGEST_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(record, field)) record[field] = digestWithout(record, field);
    }
    return record;
  }
  if (typeof value !== "string") return value;
  if (path.isAbsolute(value) || PRIVATE_PATH_TEXT.test(value)) {
    return path.isAbsolute(value) || /^[A-Za-z]:[\\/]|^\\\\/u.test(value)
      ? opaqueSchedulerWorktreeRef(value)
      : redactPersistedText(value).text;
  }
  return value;
}

function commandCustodyFailure(message) {
  const error = new Error(message);
  error.code = "COMMAND_CUSTODY_MISMATCH";
  return error;
}

function pathWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function validateRuntimeCustodyPath(rawPath, allowedScope, label) {
  try {
    requireString(rawPath, label);
    assert(path.isAbsolute(rawPath), `${label} must be absolute`);
    const target = path.resolve(rawPath);
    const scope = allowedScope.find((candidate) => pathWithin(candidate, target));
    assert(scope !== undefined, `${label} escapes admitted scope`);
    const scopeStat = fs.lstatSync(scope);
    assert(scopeStat.isDirectory() && !scopeStat.isSymbolicLink(), `${label} scope is not durable custody`);
    const targetStat = fs.lstatSync(target);
    assert(!targetStat.isSymbolicLink(), `${label} may not be a symlink`);
    const scopeRealPath = fs.realpathSync.native(scope);
    const targetRealPath = fs.realpathSync.native(target);
    assert(pathWithin(scopeRealPath, targetRealPath), `${label} escapes admitted real custody`);
    return target;
  } catch (error) {
    if (error?.code === "COMMAND_CUSTODY_MISMATCH") throw error;
    throw commandCustodyFailure(`${label} is not admitted runtime custody`);
  }
}

function createCommandCustody({repositoryRoot, worktreePath, initialCommand}) {
  const allowedScope = [...new Set([repositoryRoot, worktreePath].map((value) => path.resolve(value)))].sort();
  const paths = new Map();
  const bind = (rawPath, label) => {
    if (rawPath === null) return;
    const resolved = validateRuntimeCustodyPath(rawPath, allowedScope, label);
    paths.set(opaqueSchedulerWorktreeRef(resolved), resolved);
  };
  bind(worktreePath, "session worktree");
  bind(initialCommand.featureWorktree, "initial feature worktree");
  bind(initialCommand.evidenceWorktree, "initial evidence worktree");
  bind(initialCommand.decisionTreePath, "initial decision tree");
  return Object.freeze({allowedScope: Object.freeze(allowedScope), paths});
}

function resolveCommandCustody(value, custody, label) {
  if (value === null) return null;
  requireString(value, label);
  const rawPath = custody.paths.get(value);
  if (rawPath === undefined) throw commandCustodyFailure(`${label} has no admitted runtime custody mapping`);
  const resolved = validateRuntimeCustodyPath(rawPath, custody.allowedScope, label);
  if (opaqueSchedulerWorktreeRef(resolved) !== value) throw commandCustodyFailure(`${label} custody token does not match its admitted path`);
  return resolved;
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
  const persisted = persistedCustodyRecord(value);
  try {
    const handle = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(handle, `${canonicalJson(persisted)}\n`, "utf8");
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
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
    error: error === null ? null : opaqueError(error),
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
  validateLocalTaskKindForRole({role: base.role, taskKind: command.task_kind});
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
    scheduler_root: base.schedulerRoot,
    global_governance_attachment: base.workerGovernanceAttachmentBase64,
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

function runWorkerProcess({base, effectiveArgv, onSpawn = null}) {
  return new Promise((resolve, reject) => {
    const child = spawn(effectiveArgv[0], effectiveArgv.slice(1), {
      cwd: base.worktreePath,
      stdio: ["ignore", "pipe", "pipe"],
      env: {...process.env, AGENTOS_GLOBAL_GOVERNANCE_ATTACHMENT_SECRET: base.workerGovernanceAttachmentSecret},
    });
    if (typeof onSpawn === "function") onSpawn(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => {
      if (code !== 0) return reject(new Error(`durable worker exited with ${code ?? signal}: ${opaqueError(stderr.trim() || stdout.trim())}`));
      const line = stdout.trim().split("\n").find((value) => value.length > 0);
      if (!line) return reject(new Error("durable worker returned no handshake"));
      try {
        resolve({handshake: JSON.parse(line), childPid: child.pid});
      } catch (error) {
        reject(new Error(`durable worker returned invalid handshake: ${opaqueError(error)}`));
      }
    });
  });
}

async function runWorker({scheduler, base, workerScript, overrides, onSpawn = null}) {
  const effectiveArgv = [process.execPath, ...commandArgs(base, workerScript, overrides)];
  const binding = createLocalWorkerLaunchAdmission({
    scheduler,
    schedulerRoot: base.schedulerRoot,
    repositoryRoot: base.repositoryRoot,
    worktreePath: base.worktreePath,
    workerScriptPath: workerScript,
    role: base.role,
    campaignId: base.campaignId,
    campaignVersion: base.campaignVersion,
    candidateSha256: base.candidateSha256,
    sourceCommit: base.sourceCommit,
    sourceTree: base.sourceTree,
    sessionId: base.sessionId,
    launchId: overrides.launchId ?? overrides.taskId,
    task: overrides.task,
    taskId: overrides.taskId,
    taskKind: overrides.taskKind,
    mode: "ASYNC",
    effectiveArgv,
  });
  const scheduled = await binding.scheduler.run({
    request: binding.request,
    admission: binding.admission,
    resolveCandidate: binding.resolveCandidate,
    execute: () => runWorkerProcess({base, effectiveArgv, onSpawn}),
  });
  return scheduled.output;
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
    error: error === null ? null : opaqueError(error),
    observed_at_utc: new Date().toISOString(),
    result_sha256: null,
  };
  result.result_sha256 = digestWithout(result, "result_sha256");
  return result;
}

async function runSession() {
  const args = parseArgs(process.argv.slice(2));
  const schedulerRootInput = args.scheduler_root ?? process.env.AGENTOS_SCHEDULER_ROOT;
  requireString(schedulerRootInput, "durable worker scheduler authority root");
  assert(path.isAbsolute(schedulerRootInput), "durable worker scheduler authority root must be absolute");
  const repositoryRootInput = args.repository_root;
  requireString(repositoryRootInput, "durable worker repository root");
  assert(path.isAbsolute(repositoryRootInput), "durable worker repository root must be absolute");
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
    schedulerRoot: path.resolve(schedulerRootInput),
    repositoryRoot: path.resolve(repositoryRootInput),
    workerGovernanceAttachmentBase64: null,
    workerGovernanceAttachmentSecret: null,
  };
  requireIdentifier(base.role, "durable worker role");
  validateLocalTaskKindForRole({role: base.role, taskKind: base.taskKind});
  requireIdentifier(base.sessionId, "durable worker session");
  requireIdentifier(base.campaignId, "durable worker campaign");
  requireString(base.campaignVersion, "durable worker campaign version");
  requireSha(base.candidateSha256, "durable worker candidate");
  requireGitObject(base.sourceCommit, "durable worker source commit");
  requireGitObject(base.sourceTree, "durable worker source tree");
  assert(fs.existsSync(base.worktreePath) && fs.statSync(base.worktreePath).isDirectory(), "durable worker worktree is unavailable");
  const sealedAuthority = getSealedCanonicalAuthority();
  const incomingAttachment = JSON.parse(Buffer.from(args.global_governance_attachment, "base64").toString("utf8"));
  const globalGovernanceAuthorityStore = reattachGlobalGovernanceAuthorityStore({sealedAuthority, attachment: incomingAttachment, secretBase64: process.env.AGENTOS_GLOBAL_GOVERNANCE_ATTACHMENT_SECRET, expectedConsumerRole: "SESSION"});
  delete process.env.AGENTOS_GLOBAL_GOVERNANCE_ATTACHMENT_SECRET;
  const workerAttachment = issueGlobalGovernanceProcessAttachment({authorityStore: globalGovernanceAuthorityStore, consumerRole: "WORKER"});
  base.workerGovernanceAttachmentBase64 = Buffer.from(JSON.stringify(workerAttachment.attachment)).toString("base64");
  base.workerGovernanceAttachmentSecret = workerAttachment.secret_base64;
  const schedulerGovernanceContext = compileOperationalGlobalGovernanceContext({authorityStore: globalGovernanceAuthorityStore, roleClass: "SCHEDULER", operationalId: `CONTEXT.SCHEDULER.SESSION.${crypto.createHash("sha256").update(base.sessionId).digest("hex").slice(0, 24).toUpperCase()}`});
  const scheduler = createHybridScheduler({authorityRoot: base.schedulerRoot, globalGovernanceContext: schedulerGovernanceContext, globalGovernanceAuthorityStore});
  process.env.AGENTOS_SCHEDULER_ROOT = base.schedulerRoot;
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
  const commandCustody = createCommandCustody({repositoryRoot: base.repositoryRoot, worktreePath: base.worktreePath, initialCommand});
  let lastCommandId = null;
  let stopping = false;
  let running = null;
  let pollTimer = null;
  let heartbeatTimer = null;
  const writeHeartbeat = (status, error = null) => writeJsonAtomic(heartbeatPath, compileHeartbeat({base, status, lastCommandId, childPid: running?.childPid ?? null, error}));
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (pollTimer !== null) clearInterval(pollTimer);
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    const childPid = running?.childPid;
    if (childPid !== null && childPid !== undefined && /^\d+$/u.test(String(childPid)) && pidAlive(childPid)) {
      try { process.kill(Number(childPid), "SIGTERM"); } catch {}
    }
    const pending = running?.promise;
    if (pending) await pending.catch(() => {});
    writeHeartbeat("STOPPING");
    writeHeartbeat("STOPPED");
    process.exitCode = 0;
  };
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
  writeHeartbeat("STARTING");
  try {
    let initialPromise = null;
    let initialChildPid = null;
    initialPromise = runWorker({
      scheduler,
      base,
      workerScript,
      overrides: {...initialCommand, launchId: "INITIAL"},
      onSpawn: (child) => { initialChildPid = child.pid; if (running) running.childPid = child.pid; },
    });
    running = {childPid: initialChildPid, promise: initialPromise};
    const initial = await initialPromise;
    const handshake = validateHandshake(initial.handshake, base);
    // Publish RUNNING before the completed readback. Consumers treat the
    // readback as the startup barrier, so observing it must imply that the
    // heartbeat has already left STARTING.
    writeHeartbeat("RUNNING");
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
  } catch (error) {
    const failure = {
      schema: INITIAL_SCHEMA,
      version: 1,
      status: "FAILED",
      session_pid: String(process.pid),
      handshake: null,
      error: opaqueError(error),
      observed_at_utc: new Date().toISOString(),
      initial_readback_sha256: null,
    };
    failure.initial_readback_sha256 = digestWithout(failure, "initial_readback_sha256");
    writeJsonAtomic(initialReadbackPath, failure);
    if (stopping) writeHeartbeat("STOPPED", failure.error);
    else {
      writeHeartbeat("FAILED", failure.error);
      process.exitCode = 1;
    }
    return;
  }
  running = null;

  const poll = async () => {
    if (stopping || running !== null) return;
    const command = readJson(commandPath);
    if (command === null) return;
    if (command.command_id === lastCommandId) return;
    try {
      validateCommand(command, base);
      running = {childPid: null};
      writeHeartbeat("RUNNING");
      const commandPromise = runWorker({
        scheduler,
        base,
        workerScript,
        overrides: {
          task: command.task,
          taskId: command.task_id,
          taskKind: command.task_kind,
          featureWorktree: resolveCommandCustody(command.feature_worktree, commandCustody, "session command feature worktree"),
          evidenceWorktree: resolveCommandCustody(command.evidence_worktree, commandCustody, "session command evidence worktree"),
          decisionTreePath: resolveCommandCustody(command.decision_tree_path, commandCustody, "session command decision tree"),
          launchId: command.command_id,
        },
        onSpawn: (child) => { if (running) running.childPid = child.pid; },
      });
      running.promise = commandPromise;
      const result = await commandPromise;
      const handshake = validateHandshake(result.handshake, {...base, taskKind: command.task_kind});
      writeJsonAtomic(commandResultPath, compileCommandResult({base, command, status: "COMPLETED", handshake}));
      lastCommandId = command.command_id;
      writeHeartbeat("RUNNING");
    } catch (error) {
      const result = compileCommandResult({base, command, status: "FAILED", error: opaqueError(error)});
      writeJsonAtomic(commandResultPath, result);
      lastCommandId = command.command_id;
      writeHeartbeat("RUNNING", result.error);
    } finally {
      if (running?.promise === commandPromise) running = null;
    }
  };
  pollTimer = setInterval(() => { void poll(); }, 250);
  heartbeatTimer = setInterval(() => {
    if (!stopping) writeHeartbeat("RUNNING");
  }, 1_000);
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

if (process.argv[1] !== undefined && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync.native(path.resolve(process.argv[1]))).href) {
  runSession().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}

export {compileCommandResult, compileHeartbeat, validateCommand};
