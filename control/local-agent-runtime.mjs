#!/usr/bin/env node

/* Real local process/worktree adapter for the AgentOS self-development campaign. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync, spawn, spawnSync} from "node:child_process";
import {compileControllerAdapterReadback} from "./agentos-controller.mjs";
import {LOCAL_WORKER_ROLES} from "./local-campaign-admission.mjs";
import {validateLocalTaskKindForRole} from "./local-task-kinds.mjs";
import {redactPersistedText} from "./persisted-record-privacy.mjs";
import {
  compileHybridSchedulerCommandDescriptor,
  compileHybridSchedulerRequest,
  createHybridScheduler,
  opaqueSchedulerWorktreeRef,
} from "./hybrid-scheduler.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const COMMAND_RESULT_SCHEMA = "agentos.local_worker_session_command_result.v1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function safeRuntimeText(value, fallback = "UNAVAILABLE") {
  if (value === null || value === undefined) return fallback;
  try {
    return redactPersistedText(String(value)).text.replace(/\s+/gu, " ").trim().slice(0, 2000);
  } catch {
    return `opaque:error:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
  }
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

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(body)), "utf8").digest("hex");
}

function opaqueError(value) {
  const raw = value?.message ?? String(value);
  if (/^opaque:error:[0-9a-f]{64}$/u.test(raw)) return raw;
  return `opaque:error:${crypto.createHash("sha256").update(raw, "utf8").digest("hex")}`;
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

const PERSISTED_DIGEST_FIELDS = new Set(["handshake_sha256", "readback_sha256", "session_sha256", "heartbeat_sha256", "command_sha256", "result_sha256", "initial_readback_sha256"]);
const PRIVATE_PATH_TEXT = /(?:^|[\s"'`=:(\[{])(?:\/(?!\/)(?:[^\/\s"'`<>)}\]]+\/)+[^\/\s"'`<>)}\]]+|[A-Za-z]:[\\/]|\\\\)/u;

function persistedCustodyRecord(value) {
  if (Array.isArray(value)) return value.map(persistedCustodyRecord);
  if (value !== null && typeof value === "object") {
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

function canonicalRoot(root) {
  requireString(root, "local runtime repository root");
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "local runtime repository root must be a real directory");
  return resolved;
}

function assertNoSymlinkAncestors(root, target, label) {
  let current = target;
  while (true) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), `${label} contains a symbolic-link component`);
    if (current === root) return;
    const parent = path.dirname(current);
    if (parent === root) return;
    assert(parent !== current && parent.startsWith(`${root}${path.sep}`), `${label} escapes the bound root`);
    current = parent;
  }
}

function safeChild(root, child) {
  const resolvedRoot = canonicalRoot(root);
  assert(!path.isAbsolute(child), "local runtime path must be relative");
  const target = path.resolve(resolvedRoot, child);
  assert(target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`), "local runtime path escapes the development root");
  assertNoSymlinkAncestors(resolvedRoot, target, "local runtime path");
  return target;
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch (error) {
    const detail = safeRuntimeText(error.stderr?.toString().trim() || error.message);
    throw new Error(`local runtime git readback failed for git ${args.join(" ")}: ${detail}`);
  }
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  assert(!fs.lstatSync(path.dirname(target)).isSymbolicLink(), "local runtime record parent may not be a symlink");
  assert(!fs.existsSync(target) || !fs.lstatSync(target).isSymbolicLink(), "local runtime record may not be a symlink");
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    const handle = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(handle, `${JSON.stringify(persistedCustodyRecord(value))}\n`, "utf8");
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function readJson(target) {
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), "local runtime record must be a regular file");
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function restoreSessionPaths(sessionRecordPath, session) {
  const sessionDirectory = path.dirname(path.resolve(sessionRecordPath));
  const runtimeRoot = path.resolve(sessionDirectory, "../../..");
  const runtimeKey = path.basename(path.dirname(sessionDirectory));
  const workerKey = path.basename(sessionDirectory);
  const restored = {
    ...session,
    worktree_path: path.join(runtimeRoot, "worktrees", runtimeKey, workerKey),
    heartbeat_path: path.join(sessionDirectory, "heartbeat.json"),
    command_path: path.join(sessionDirectory, "command.json"),
    command_result_path: path.join(sessionDirectory, "command-result.json"),
  };
  restored.session_sha256 = digestWithout(restored, "session_sha256");
  return restored;
}

function ensureWorktree({repoRoot, worktreePath, sourceCommit, sourceTree}) {
  const target = safeChild(repoRoot, path.relative(repoRoot, worktreePath));
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    assert(!fs.lstatSync(path.dirname(target)).isSymbolicLink(), "local worker worktree parent may not be a symlink");
    execFileSync("git", ["-C", repoRoot, "worktree", "add", "--detach", target, sourceCommit], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  }
  const stat = fs.lstatSync(target);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "local worker worktree is not a real directory");
  assert(git(target, ["rev-parse", "HEAD"]) === sourceCommit, "local worker worktree commit differs");
  assert(git(target, ["rev-parse", "HEAD^{tree}"]) === sourceTree, "local worker worktree tree differs");
  return target;
}

function schedulerHash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function schedulerFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createLocalWorkerLaunchAdmission({
  scheduler = null,
  schedulerRoot,
  repositoryRoot = null,
  worktreePath,
  workerScriptPath,
  role,
  campaignId,
  campaignVersion,
  candidateSha256,
  sourceCommit,
  sourceTree,
  sessionId,
  launchId,
  task,
  taskId,
  taskKind,
  mode = "ASYNC",
  effectiveArgv,
} = {}) {
  requireString(schedulerRoot, "local worker scheduler root");
  assert(path.isAbsolute(schedulerRoot), "local worker scheduler root must be absolute");
  requireString(worktreePath, "local worker launch worktree");
  assert(path.isAbsolute(worktreePath), "local worker launch worktree must be absolute");
  requireString(workerScriptPath, "local worker launch script");
  assert(path.isAbsolute(workerScriptPath), "local worker launch script must be absolute");
  requireIdentifier(role, "local worker launch role");
  requireIdentifier(campaignId, "local worker launch campaign");
  requireString(campaignVersion, "local worker launch campaign version");
  requireSha(candidateSha256, "local worker launch candidate");
  requireGitObject(sourceCommit, "local worker launch source commit");
  requireGitObject(sourceTree, "local worker launch source tree");
  requireIdentifier(sessionId, "local worker launch session");
  requireIdentifier(launchId, "local worker launch ID");
  requireString(task, "local worker launch task");
  requireIdentifier(taskId, "local worker launch task ID");
  requireIdentifier(taskKind, "local worker launch task kind");
  requireIdentifier(mode, "local worker launch mode");
  assert(mode === "SYNC" || mode === "ASYNC", "local worker launch mode is invalid");
  const repository = repositoryRoot === null ? worktreePath : repositoryRoot;
  requireString(repository, "local worker launch repository root");
  assert(path.isAbsolute(repository), "local worker launch repository root must be absolute");
  const goal = `${campaignId}:${campaignVersion}:${role}:${sessionId}:${launchId}:${taskId}:${taskKind}:${schedulerHash(task)}`;
  const goalBinding = `GOAL-${schedulerHash(goal).slice(0, 24).toUpperCase()}`;
  const sourceBinding = `SOURCE-${sourceCommit.slice(0, 20).toUpperCase()}-${sourceTree.slice(0, 20).toUpperCase()}`;
  const requestId = `REQUEST-${schedulerHash(`${goal}:${sourceCommit}:${sourceTree}:${mode}`).slice(0, 32).toUpperCase()}`;
  const requesterId = `REQUESTER-${schedulerHash(`${repository}:${role}`).slice(0, 24).toUpperCase()}`;
  const lane = `LANE-${schedulerHash(goal).slice(0, 24).toUpperCase()}`;
  const repositoryId = `REPOSITORY-${schedulerHash(repository).slice(0, 24).toUpperCase()}`;
  const worktreeId = `WORKTREE-${schedulerHash(worktreePath).slice(0, 24).toUpperCase()}`;
  const workingDirectoryRef = opaqueSchedulerWorktreeRef(worktreePath);
  const coverage = [goalBinding, sourceBinding].sort();
  const dependsOn = [sourceBinding];
  assert(Array.isArray(effectiveArgv) && effectiveArgv.length > 1, "local worker effective argv is required");
  const commandArgv = compileHybridSchedulerCommandDescriptor(effectiveArgv);
  const runtimeAllowedScope = [...new Set([
    repository,
    schedulerRoot,
    worktreePath,
    path.dirname(workerScriptPath),
    path.dirname(process.execPath),
  ].map((value) => path.resolve(value)))].sort();
  const request = compileHybridSchedulerRequest({
    requestId,
    requesterId,
    lane,
    repositoryId,
    worktreeId,
    candidateCommit: sourceCommit,
    candidateTreeOrDigest: sourceTree,
    cleanState: true,
    resourceClass: "AGENT_BUILD",
    workingDirectoryRef,
    commandArgv,
    toolchainProfile: "NODE_HOST",
    proofClass: "AGENT_SESSION",
    whyNeeded: "ADMITTED_LOCAL_WORKER_LAUNCH",
    expectedProof: "SOURCE_BOUND_WORKER_HANDSHAKE",
    coverage,
    dependsOn,
    timeoutClass: "BOUNDED",
    cachePolicy: "NONE",
    secretPolicy: "REDACTED",
  });
  const boundScheduler = scheduler ?? createHybridScheduler({authorityRoot: schedulerRoot});
  const assertBound = (admitted) => {
    if (admitted.request_id !== requestId
      || admitted.requester_id !== requesterId
      || admitted.lane !== lane
      || admitted.repository_id !== repositoryId
      || admitted.worktree_id !== worktreeId
      || admitted.candidate_commit !== sourceCommit
      || admitted.candidate_tree_or_digest !== sourceTree
      || admitted.clean_state !== true
      || admitted.resource_class !== "AGENT_BUILD"
      || admitted.working_directory_ref !== workingDirectoryRef
      || JSON.stringify(admitted.coverage) !== JSON.stringify(coverage)
      || JSON.stringify(admitted.depends_on) !== JSON.stringify(dependsOn)
      || admitted.toolchain_profile !== "NODE_HOST"
      || admitted.proof_class !== "AGENT_SESSION"
      || admitted.why_needed !== "ADMITTED_LOCAL_WORKER_LAUNCH"
      || admitted.expected_proof !== "SOURCE_BOUND_WORKER_HANDSHAKE"
      || JSON.stringify(admitted.command_argv) !== JSON.stringify(commandArgv)
      || JSON.stringify(compileHybridSchedulerCommandDescriptor(effectiveArgv)) !== JSON.stringify(admitted.command_argv)) {
      throw schedulerFailure("SCHEDULER_SOURCE_BINDING_MISMATCH", "local worker launch scheduler binding changed before execution");
    }
  };
  const closureAssert = (condition, message, code) => {
    if (!condition) throw schedulerFailure(code, message);
  };
  const validateRuntimeClosure = (admitted) => {
    assertBound(admitted);
    closureAssert(effectiveArgv[0] === process.execPath, "local worker runtime identity differs from effective argv", "SCHEDULER_COMMAND_MISMATCH");
    closureAssert(effectiveArgv[1] === workerScriptPath, "local worker script identity differs from effective argv", "SCHEDULER_COMMAND_MISMATCH");
    closureAssert(fs.statSync(process.execPath).isFile(), "local worker runtime is not a regular file", "SCHEDULER_RUNTIME_UNAVAILABLE");
    const scriptStat = fs.lstatSync(workerScriptPath);
    closureAssert(!scriptStat.isSymbolicLink() && scriptStat.isFile(), "local worker launch script is not admitted custody", "SCHEDULER_CUSTODY_MISMATCH");
    const repositoryStat = fs.lstatSync(repository);
    closureAssert(!repositoryStat.isSymbolicLink() && repositoryStat.isDirectory(), "local worker repository is not admitted custody", "SCHEDULER_CUSTODY_MISMATCH");
    const worktreeStat = fs.lstatSync(worktreePath);
    closureAssert(!worktreeStat.isSymbolicLink() && worktreeStat.isDirectory(), "local worker launch worktree is not admitted custody", "SCHEDULER_CUSTODY_MISMATCH");
    const repositoryRealPath = fs.realpathSync.native(repository);
    const worktreeRealPath = fs.realpathSync.native(worktreePath);
    closureAssert(worktreeRealPath === repositoryRealPath || worktreeRealPath.startsWith(`${repositoryRealPath}${path.sep}`), "local worker launch worktree escapes repository custody", "SCHEDULER_CUSTODY_MISMATCH");
    const schedulerAuthorityStat = fs.lstatSync(schedulerRoot);
    closureAssert(!schedulerAuthorityStat.isSymbolicLink() && schedulerAuthorityStat.isDirectory(), "local worker scheduler root is not admitted custody", "SCHEDULER_CUSTODY_MISMATCH");
    closureAssert(typeof boundScheduler.root === "function" && typeof boundScheduler.inspect === "function", "local worker scheduler does not expose file-backed inspection", "SCHEDULER_PREFLIGHT_REQUIRED");
    const schedulerStateRoot = boundScheduler.root();
    requireString(schedulerStateRoot, "local worker scheduler state root");
    closureAssert(path.isAbsolute(schedulerStateRoot), "local worker scheduler state root must be absolute", "SCHEDULER_CUSTODY_MISMATCH");
    const resolvedSchedulerRoot = path.resolve(schedulerRoot);
    const resolvedStateRoot = path.resolve(schedulerStateRoot);
    closureAssert(resolvedStateRoot.startsWith(`${resolvedSchedulerRoot}${path.sep}`), "local worker scheduler state escapes its authority root", "SCHEDULER_CUSTODY_MISMATCH");
    const schedulerStateStat = fs.lstatSync(resolvedStateRoot);
    closureAssert(!schedulerStateStat.isSymbolicLink() && schedulerStateStat.isDirectory(), "local worker scheduler state root is not durable custody", "SCHEDULER_CUSTODY_MISMATCH");
    for (const name of ["requests", "jobs", "results", "semantic", "leases", "locks"]) {
      const directory = path.join(resolvedStateRoot, name);
      fs.mkdirSync(directory, {recursive: true, mode: 0o700});
      const stat = fs.lstatSync(directory);
      closureAssert(!stat.isSymbolicLink() && stat.isDirectory(), `local worker scheduler ${name} custody is unavailable`, "SCHEDULER_CUSTODY_MISMATCH");
    }
    const inspected = boundScheduler.inspect();
    closureAssert(inspected && inspected.mode === "FILE_BACKED", "local worker scheduler inspection is not file-backed", "SCHEDULER_PREFLIGHT_FAILED");
    requireSha(inspected.policy_sha256, "local worker scheduler policy digest");
    return {
      runtime: fs.realpathSync.native(process.execPath),
      script: fs.realpathSync.native(workerScriptPath),
      repository: repositoryRealPath,
      worktree: worktreeRealPath,
      scheduler: resolvedStateRoot,
      policy_sha256: inspected.policy_sha256,
    };
  };
  const admission = {
    effectiveArgv: [...effectiveArgv],
    workingDirectory: worktreePath,
    workingDirectoryRef: request.working_directory_ref,
    allowedScope: ["."],
    runtimeAllowedScope,
    dependencyPreflight: ({request: admitted}) => {
      const closure = validateRuntimeClosure(admitted);
      return {status: "READY", identity: `DEPENDENCY_${schedulerHash(JSON.stringify(closure)).slice(0, 24).toUpperCase()}`};
    },
    runtimePreflight: ({request: admitted}) => {
      const closure = validateRuntimeClosure(admitted);
      return {status: "READY", identity: `RUNTIME_${schedulerHash(JSON.stringify(closure)).slice(0, 24).toUpperCase()}`};
    },
  };
  const resolveCandidate = () => {
    let commit;
    let tree;
    let status;
    try {
      commit = git(worktreePath, ["rev-parse", "HEAD"]);
      tree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
      status = git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"]);
    } catch {
      throw schedulerFailure("CANCELLED_STALE_CANDIDATE", "local worker candidate could not be reread before execution");
    }
    const dirtySha256 = schedulerHash(status);
    if (commit !== sourceCommit || tree !== sourceTree) {
      throw schedulerFailure("CANCELLED_STALE_CANDIDATE", "local worker source candidate changed before execution");
    }
    if (status.length > 0) {
      throw schedulerFailure("CANCELLED_DIAGNOSTIC_CANDIDATE", `local worker candidate is dirty before execution: ${dirtySha256}`);
    }
    return {commit, tree, clean: true, dirty_sha256: dirtySha256};
  };
  return {
    scheduler: boundScheduler,
    request,
    admission,
    resolveCandidate,
  };
}

function validateHandshake(handshake, expected) {
  assert(handshake && typeof handshake === "object" && !Array.isArray(handshake), "local worker handshake is missing");
  assert(handshake.schema === "agentos.local_worker_handshake.v1" && handshake.version === 1, "local worker handshake schema mismatch");
  assert(handshake.status === "COMPLETED", "local worker did not complete");
  for (const field of ["role", "session_id", "campaign_id", "campaign_version", "candidate_sha256", "pid", "worktree_path", "source_commit", "source_tree", "build_status", "artifact_path", "artifact_sha256", "observed_at_utc", "handshake_sha256"]) requireString(String(handshake[field]), `local worker handshake ${field}`);
  assert(handshake.role === expected.role && handshake.session_id === expected.sessionId, "local worker role/session identity differs");
  if (expected.taskKind !== undefined) assert(handshake.task_kind === expected.taskKind, "local worker task kind differs");
  assert(handshake.campaign_id === expected.campaignId && handshake.campaign_version === expected.campaignVersion, "local worker campaign identity differs");
  assert(handshake.candidate_sha256 === expected.candidateSha256, "local worker candidate differs");
  assert(handshake.worktree_path === expected.worktreePath
    || handshake.worktree_path === opaqueSchedulerWorktreeRef(expected.worktreePath), "local worker worktree differs");
  assert(handshake.source_commit === expected.sourceCommit && handshake.source_tree === expected.sourceTree, "local worker source differs");
  assert(/^\d+$/u.test(handshake.pid) && Number(handshake.pid) > 0, "local worker PID is invalid");
  requireSha(handshake.artifact_sha256, "local worker artifact");
  requireSha(handshake.handshake_sha256, "local worker handshake digest");
  assert(handshake.handshake_sha256 === digestWithout(handshake, "handshake_sha256"), "local worker handshake digest mismatch");
  assert(["NOT_FEATURE_AGENT_BUILD", "COMPLETED", "AUDIT_VERIFIED"].includes(handshake.build_status), "local worker build status is invalid");
  if (expected.role === "FEATURE_AGENT") {
    assert(handshake.build_status === "COMPLETED" && handshake.build_commit !== null && handshake.build_tree !== null, "Feature Agent did not return a real build checkpoint");
    requireGitObject(handshake.build_commit, "Feature Agent build commit");
    requireGitObject(handshake.build_tree, "Feature Agent build tree");
    if (expected.taskKind === "CONTROLLER_SUPERVISOR_LIVENESS") {
      assert(handshake.build_commit === expected.sourceCommit && handshake.build_tree === expected.sourceTree, "liveness Feature Agent observed a different source");
      assert(Array.isArray(handshake.changed_paths) && handshake.changed_paths.length === 0, "liveness Feature Agent changed source code");
    } else {
      assert(handshake.build_commit !== expected.sourceCommit && handshake.build_tree !== expected.sourceTree, "Feature Agent build checkpoint did not change source");
      const requiredChangedPath = expected.taskKind === "CONTROLLER_SUPERVISOR_REPAIR"
        ? "control/controller-supervisor.mjs"
        : expected.taskKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR" || expected.taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR"
          ? "schemas/bootstrap-binding.v1.json"
          : expected.taskKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
            ? "control/local-self-development-supervisor-adapter.mjs"
          : expected.taskKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
            ? "control/local-self-development-supervisor-adapter.mjs"
          : expected.taskKind === "DURABLE_SESSION_LIVENESS_REPAIR"
            ? "control/local-agent-runtime.mjs"
          : expected.taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
            ? "tests/verify-local-agent-session.mjs"
          : expected.taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
            ? "control/bootstrap-compiler.mjs"
          : expected.taskKind === "OWNER_FEEDBACK_REPAIR"
            ? "control/task-run-loop.mjs"
          : "control/governance-decision-tree.mjs";
      const ownerFeedbackCodeChanged = expected.taskKind === "OWNER_FEEDBACK_REPAIR"
        && ["control/check-runner.mjs", "control/local-campaign-admission.mjs", "control/task-run-loop.mjs", "control/local-agent-runtime.mjs", "control/local-self-development-supervisor-adapter.mjs"].some((candidatePath) => handshake.changed_paths.includes(candidatePath));
      assert(Array.isArray(handshake.changed_paths) && (expected.taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
        ? ["control/bootstrap-compiler.mjs", "control/owner-review.mjs"].some((candidatePath) => handshake.changed_paths.includes(candidatePath))
        : ownerFeedbackCodeChanged
          ? true
        : handshake.changed_paths.includes(requiredChangedPath)), "Feature Agent build did not change the required code");
    }
    assert(Array.isArray(handshake.focused_checks) && handshake.focused_checks.length > 0 && typeof handshake.build_checkpoint_sha256 === "string", "Feature Agent build evidence is incomplete");
  }
  if (expected.role === "INDEPENDENT_AUDITOR" && expected.featureWorktree !== null) {
    if (expected.taskKind === "CONTROLLER_SUPERVISOR_LIVENESS") {
      assert(handshake.build_status === "AUDIT_VERIFIED" && handshake.build_commit === expected.sourceCommit && handshake.build_tree === expected.sourceTree && Array.isArray(handshake.changed_paths) && handshake.changed_paths.length === 0, "Auditor liveness readback is not source-bound");
    } else {
      const requiredChangedPath = expected.taskKind === "CONTROLLER_SUPERVISOR_REPAIR"
        ? "control/controller-supervisor.mjs"
        : expected.taskKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR" || expected.taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR"
          ? "schemas/bootstrap-binding.v1.json"
          : expected.taskKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
            ? "control/local-self-development-supervisor-adapter.mjs"
          : expected.taskKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
            ? "control/local-self-development-supervisor-adapter.mjs"
          : expected.taskKind === "DURABLE_SESSION_LIVENESS_REPAIR"
            ? "control/local-agent-runtime.mjs"
          : expected.taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
            ? "tests/verify-local-agent-session.mjs"
          : expected.taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
            ? "control/bootstrap-compiler.mjs"
          : expected.taskKind === "OWNER_FEEDBACK_REPAIR"
            ? "control/task-run-loop.mjs"
          : "control/governance-decision-tree.mjs";
      const ownerFeedbackCodeChanged = expected.taskKind === "OWNER_FEEDBACK_REPAIR"
        && ["control/check-runner.mjs", "control/local-campaign-admission.mjs", "control/task-run-loop.mjs", "control/local-agent-runtime.mjs", "control/local-self-development-supervisor-adapter.mjs"].some((candidatePath) => handshake.changed_paths.includes(candidatePath));
      assert(handshake.build_status === "AUDIT_VERIFIED" && Array.isArray(handshake.changed_paths) && (expected.taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
        ? ["control/bootstrap-compiler.mjs", "control/owner-review.mjs"].some((candidatePath) => handshake.changed_paths.includes(candidatePath))
        : ownerFeedbackCodeChanged
          ? true
        : handshake.changed_paths.includes(requiredChangedPath)), "Auditor did not verify the Feature-Agent code change");
    }
  }
  const artifactPath = safeChild(expected.worktreePath, handshake.artifact_path);
  assert(fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile(), "local worker artifact is missing");
  const actualArtifactSha256 = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  assert(actualArtifactSha256 === handshake.artifact_sha256, "local worker artifact readback differs");
  return handshake;
}

function spawnWorker({repoRoot, runtimeRoot, role, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, task, taskId = "INITIAL", taskKind = "INITIAL", featureWorktree = null, evidenceWorktree = null, decisionTreePath = null, workerScriptPath = null}) {
  assert(LOCAL_WORKER_ROLES.includes(role), `unsupported local worker role: ${role}`);
  requireIdentifier(campaignId, "local worker campaign ID");
  requireString(campaignVersion, "local worker campaign version");
  requireSha(candidateSha256, "local worker candidate");
  requireGitObject(sourceCommit, "local worker source commit");
  requireGitObject(sourceTree, "local worker source tree");
  requireString(task, "local worker task");
  requireIdentifier(taskId, "local worker task ID");
  requireIdentifier(taskKind, "local worker task kind");
  validateLocalTaskKindForRole({role, taskKind});
  const root = canonicalRoot(repoRoot);
  const runtime = safeChild(root, path.relative(root, runtimeRoot));
  const feature = featureWorktree === null ? null : safeChild(root, path.relative(root, featureWorktree));
  const evidence = evidenceWorktree === null ? null : safeChild(root, path.relative(root, evidenceWorktree));
  const decisionTree = decisionTreePath === null ? null : safeChild(root, path.relative(root, decisionTreePath));
  const workerScript = workerScriptPath === null ? null : safeChild(root, path.relative(root, workerScriptPath));
  if (role === "CAMPAIGN_ORCHESTRATOR") assert(decisionTree !== null && fs.existsSync(decisionTree), "local runtime decision tree adapter is unavailable");
  const runtimeKey = `${campaignId}-${campaignVersion}`.replace(/[^A-Za-z0-9._-]/gu, "_");
  const taskSuffix = taskId === "INITIAL" ? "" : `-${taskId}`;
  const sessionId = `LOCAL-${role}-${candidateSha256.slice(0, 12)}${taskSuffix}`;
  const roleKey = role.replaceAll(":", "_");
  const workerKey = `${roleKey}${taskSuffix}`;
  const worktreePath = safeChild(runtime, path.join("worktrees", runtimeKey, workerKey));
  const recordPath = safeChild(runtime, path.join("spawn-records", `${workerKey}.json`));
  const existing = readJson(recordPath);
  if (existing !== null) {
    assert(existing.status === "COMPLETED", "local worker spawn record is stale or crashed; repair is required before retry");
    assert(existing.role === role && existing.session_id === sessionId && existing.candidate_sha256 === candidateSha256, "duplicate local worker spawn identity differs");
    return {...existing.readback, reused: true};
  }
  const worktree = ensureWorktree({repoRoot: root, worktreePath, sourceCommit, sourceTree});
  writeJsonAtomic(recordPath, {
    schema: "agentos.local_worker_spawn_record.v1",
    version: 1,
    status: "RUNNING",
    role,
    session_id: sessionId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    candidate_sha256: candidateSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    worktree_path: worktree,
    started_at_utc: new Date().toISOString(),
    readback: null,
  });
  const workerScriptFile = workerScript ?? new URL("./local-agent-worker.mjs", import.meta.url).pathname;
  const schedulerRoot = safeChild(runtime, "scheduler-authority");
  const workerArgs = [workerScriptFile, "--role", role, "--session-id", sessionId, "--campaign-id", campaignId, "--campaign-version", campaignVersion, "--candidate-sha256", candidateSha256, "--source-commit", sourceCommit, "--source-tree", sourceTree, "--worktree", worktree, "--task", task, "--task-id", taskId, "--task-kind", taskKind, "--scheduler-root", schedulerRoot];
  if (feature !== null) workerArgs.push("--feature-worktree", feature);
  if (evidence !== null) workerArgs.push("--evidence-worktree", evidence);
  if (decisionTree !== null) workerArgs.push("--decision-tree", decisionTree);
  const effectiveArgv = [process.execPath, ...workerArgs];
  const binding = createLocalWorkerLaunchAdmission({schedulerRoot, repositoryRoot: root, worktreePath: worktree, workerScriptPath: workerScriptFile, role, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, sessionId, launchId: taskId, task, taskId, taskKind, mode: "SYNC", effectiveArgv});
  let result;
  try {
    result = binding.scheduler.runSync({
      request: binding.request,
      admission: binding.admission,
      resolveCandidate: binding.resolveCandidate,
      execute: () => {
        const spawned = spawnSync(effectiveArgv[0], effectiveArgv.slice(1), {cwd: worktree, encoding: "utf8", timeout: 30_000});
        if (spawned.error || spawned.status !== 0) {
          const failure = safeRuntimeText(spawned.error?.message ?? spawned.stderr ?? `worker exited with ${spawned.status}`);
          const error = new Error(`local worker ${role} failed: ${failure}`);
          error.code = "LOCAL_WORKER_PROCESS_FAILED";
          throw error;
        }
        return spawned;
      },
      waitMs: 30_000,
    }).output;
  } catch (error) {
    const runningRecord = readJson(recordPath);
    if (runningRecord?.status === "RUNNING") writeJsonAtomic(recordPath, {...runningRecord, status: "FAILED", failure: safeRuntimeText(error?.message ?? error)});
    throw error;
  }
  const line = result.stdout.trim().split("\n")[0];
  let handshake;
  try {
    handshake = JSON.parse(line);
  } catch (error) {
    const failure = safeRuntimeText(`invalid worker handshake: ${error.message}`);
    writeJsonAtomic(recordPath, {...readJson(recordPath), status: "FAILED", failure});
    throw new Error(`local worker ${role} returned invalid handshake: ${failure}`);
  }
  validateHandshake(handshake, {role, sessionId, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, worktreePath: worktree, featureWorktree: feature, taskKind});
  const readback = {
    schema: "agentos.local_worker_spawn_readback.v1",
    version: 1,
    status: "COMPLETED",
    role,
    session_id: sessionId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    candidate_sha256: candidateSha256,
    pid: handshake.pid,
    worktree_path: worktree,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    build_status: handshake.build_status,
    build_commit: handshake.build_commit,
    build_tree: handshake.build_tree,
    changed_paths: handshake.changed_paths,
    focused_checks: handshake.focused_checks,
    build_checkpoint_sha256: handshake.build_checkpoint_sha256,
    artifact_path: handshake.artifact_path,
    artifact_sha256: handshake.artifact_sha256,
    exit_code: result.status,
    observed_at_utc: handshake.observed_at_utc,
    readback_sha256: null,
  };
  readback.readback_sha256 = digestWithout(readback, "readback_sha256");
  writeJsonAtomic(recordPath, {
    schema: "agentos.local_worker_spawn_record.v1",
    version: 1,
    status: "COMPLETED",
    role,
    session_id: sessionId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    candidate_sha256: candidateSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    worktree_path: worktree,
    started_at_utc: new Date().toISOString(),
    readback,
  });
  return readback;
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function compileDurableSessionReadback(handshake, resultStatus = 0) {
  const readback = {
    schema: "agentos.local_worker_spawn_readback.v1",
    version: 1,
    status: "COMPLETED",
    role: handshake.role,
    session_id: handshake.session_id,
    campaign_id: handshake.campaign_id,
    campaign_version: handshake.campaign_version,
    candidate_sha256: handshake.candidate_sha256,
    pid: handshake.pid,
    worktree_path: handshake.worktree_path,
    source_commit: handshake.source_commit,
    source_tree: handshake.source_tree,
    build_status: handshake.build_status,
    build_commit: handshake.build_commit,
    build_tree: handshake.build_tree,
    changed_paths: handshake.changed_paths,
    focused_checks: handshake.focused_checks,
    build_checkpoint_sha256: handshake.build_checkpoint_sha256,
    artifact_path: handshake.artifact_path,
    artifact_sha256: handshake.artifact_sha256,
    exit_code: resultStatus,
    observed_at_utc: handshake.observed_at_utc,
    readback_sha256: null,
  };
  readback.readback_sha256 = digestWithout(readback, "readback_sha256");
  return readback;
}

export function validateLocalWorkerHeartbeat(heartbeat, expected = null) {
  assert(heartbeat && typeof heartbeat === "object" && !Array.isArray(heartbeat), "local worker heartbeat is required");
  const required = ["schema", "version", "status", "role", "session_id", "campaign_id", "campaign_version", "candidate_sha256", "source_commit", "source_tree", "session_pid", "child_pid", "last_command_id", "error", "observed_at_utc", "heartbeat_sha256"];
  assert(JSON.stringify(Object.keys(heartbeat).sort()) === JSON.stringify([...required].sort()), "local worker heartbeat fields mismatch");
  assert(heartbeat.schema === "agentos.local_worker_heartbeat.v1" && heartbeat.version === 1, "local worker heartbeat identity is invalid");
  assert(["STARTING", "RUNNING", "STOPPING", "STOPPED", "FAILED"].includes(heartbeat.status), "local worker heartbeat status is invalid");
  for (const field of ["role", "session_id", "campaign_id", "campaign_version", "session_pid", "observed_at_utc"]) requireString(heartbeat[field], `local worker heartbeat ${field}`);
  requireSha(heartbeat.candidate_sha256, "local worker heartbeat candidate");
  requireGitObject(heartbeat.source_commit, "local worker heartbeat commit");
  requireGitObject(heartbeat.source_tree, "local worker heartbeat tree");
  assert(/^\d+$/u.test(heartbeat.session_pid) && Number(heartbeat.session_pid) > 0, "local worker heartbeat session PID is invalid");
  assert(heartbeat.child_pid === null || (/^\d+$/u.test(heartbeat.child_pid) && Number(heartbeat.child_pid) > 0), "local worker heartbeat child PID is invalid");
  assert(heartbeat.last_command_id === null || typeof heartbeat.last_command_id === "string", "local worker heartbeat command ID is invalid");
  assert(heartbeat.error === null || typeof heartbeat.error === "string", "local worker heartbeat error is invalid");
  requireString(heartbeat.observed_at_utc, "local worker heartbeat observation time");
  requireSha(heartbeat.heartbeat_sha256, "local worker heartbeat digest");
  assert(heartbeat.heartbeat_sha256 === digestWithout(heartbeat, "heartbeat_sha256"), "local worker heartbeat digest mismatch");
  if (expected !== null) {
    assert(heartbeat.role === expected.role && heartbeat.session_id === expected.sessionId, "local worker heartbeat role/session differs");
    assert(heartbeat.campaign_id === expected.campaignId && heartbeat.campaign_version === expected.campaignVersion, "local worker heartbeat campaign differs");
    assert(heartbeat.candidate_sha256 === expected.candidateSha256, "local worker heartbeat candidate differs");
    assert(heartbeat.source_commit === expected.sourceCommit && heartbeat.source_tree === expected.sourceTree, "local worker heartbeat source differs");
  }
  return heartbeat;
}

function compileDurableSessionRecord({status, role, sessionId, taskId = "INITIAL", taskKind = "INITIAL", campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, worktreePath, pid, heartbeatPath, commandPath, commandResultPath, initialReadback = null, lastCommandId = null, startedAtUtc, updatedAtUtc, failure = null}) {
  const record = {
    schema: "agentos.local_worker_session_record.v1",
    version: 1,
    status,
    role,
    session_id: sessionId,
    task_id: taskId,
    task_kind: taskKind,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    candidate_sha256: candidateSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    worktree_path: worktreePath,
    pid: String(pid),
    heartbeat_path: heartbeatPath,
    command_path: commandPath,
    command_result_path: commandResultPath,
    initial_readback: initialReadback,
    last_command_id: lastCommandId,
    failure,
    started_at_utc: startedAtUtc,
    updated_at_utc: updatedAtUtc,
    session_sha256: null,
  };
  record.session_sha256 = digestWithout(record, "session_sha256");
  return record;
}

export function validateLocalDurableSessionRecord(record) {
  assert(record && typeof record === "object" && !Array.isArray(record), "local durable session record is required");
  const required = ["schema", "version", "status", "role", "session_id", "task_id", "task_kind", "campaign_id", "campaign_version", "candidate_sha256", "source_commit", "source_tree", "worktree_path", "pid", "heartbeat_path", "command_path", "command_result_path", "initial_readback", "last_command_id", "failure", "started_at_utc", "updated_at_utc", "session_sha256"];
  assert(JSON.stringify(Object.keys(record).sort()) === JSON.stringify([...required].sort()), "local durable session record fields mismatch");
  assert(record.schema === "agentos.local_worker_session_record.v1" && record.version === 1, "local durable session record identity is invalid");
  assert(["STARTING", "RUNNING", "STOPPING", "STOPPED", "FAILED"].includes(record.status), "local durable session record status is invalid");
  for (const field of ["role", "session_id", "campaign_id", "campaign_version", "worktree_path", "pid", "heartbeat_path", "command_path", "command_result_path", "started_at_utc", "updated_at_utc"]) requireString(record[field], `local durable session ${field}`);
  requireIdentifier(record.task_id, "local durable session task ID");
  requireIdentifier(record.task_kind, "local durable session task kind");
  validateLocalTaskKindForRole({role: record.role, taskKind: record.task_kind, label: "local durable session task kind"});
  requireSha(record.candidate_sha256, "local durable session candidate");
  requireGitObject(record.source_commit, "local durable session commit");
  requireGitObject(record.source_tree, "local durable session tree");
  assert(/^\d+$/u.test(record.pid) && Number(record.pid) > 0, "local durable session PID is invalid");
  assert(record.initial_readback === null || validateLocalWorkerReadback(record.initial_readback, record.task_kind), "local durable session initial readback is invalid");
  assert(record.last_command_id === null || typeof record.last_command_id === "string", "local durable session command ID is invalid");
  assert(record.failure === null || typeof record.failure === "string", "local durable session failure is invalid");
  requireUtc(record.started_at_utc, "local durable session start time");
  requireUtc(record.updated_at_utc, "local durable session update time");
  requireSha(record.session_sha256, "local durable session digest");
  assert(record.session_sha256 === digestWithout(record, "session_sha256"), "local durable session digest mismatch");
  return record;
}

export function durableWorkerTaskStatus(session) {
  validateLocalDurableSessionRecord(session);
  if (session.initial_readback?.status === "COMPLETED") return "COMPLETED";
  if (session.status === "FAILED") return "FAILED";
  if (session.status === "STOPPED") return "STOPPED";
  if (session.status === "STOPPING") return "STOPPING";
  if (session.status === "STARTING") return "STARTING";
  return "IN_PROGRESS";
}
export function compileDurableWorkerSessionCommand({session, commandId, task, taskId, taskKind, featureWorktree = null, evidenceWorktree = null, decisionTreePath = null, createdAtUtc = new Date().toISOString()}) {
  validateLocalDurableSessionRecord(session);
  requireIdentifier(commandId, "durable worker command ID");
  requireString(task, "durable worker command task");
  requireIdentifier(taskId, "durable worker command task ID");
  requireIdentifier(taskKind, "durable worker command task kind");
  validateLocalTaskKindForRole({role: session.role, taskKind});
  for (const [value, label] of [[featureWorktree, "feature worktree"], [evidenceWorktree, "evidence worktree"], [decisionTreePath, "decision tree path"]]) assert(value === null || typeof value === "string", `${label} is invalid`);
  requireUtc(createdAtUtc, "durable worker command time");
  const command = {
    schema: "agentos.local_worker_session_command.v1",
    version: 1,
    command_id: commandId,
    role: session.role,
    session_id: session.session_id,
    campaign_id: session.campaign_id,
    campaign_version: session.campaign_version,
    candidate_sha256: session.candidate_sha256,
    source_commit: session.source_commit,
    source_tree: session.source_tree,
    task,
    task_id: taskId,
    task_kind: taskKind,
    feature_worktree: featureWorktree,
    evidence_worktree: evidenceWorktree,
    decision_tree_path: decisionTreePath,
    created_at_utc: createdAtUtc,
    command_sha256: null,
  };
  command.command_sha256 = digestWithout(command, "command_sha256");
  return command;
}

export function validateDurableWorkerSessionCommand(command, session) {
  validateLocalDurableSessionRecord(session);
  const required = ["schema", "version", "command_id", "role", "session_id", "campaign_id", "campaign_version", "candidate_sha256", "source_commit", "source_tree", "task", "task_id", "task_kind", "feature_worktree", "evidence_worktree", "decision_tree_path", "created_at_utc", "command_sha256"];
  assert(JSON.stringify(Object.keys(command).sort()) === JSON.stringify([...required].sort()), "durable worker command fields mismatch");
  assert(command.schema === "agentos.local_worker_session_command.v1" && command.version === 1, "durable worker command identity is invalid");
  assert(command.role === session.role && command.session_id === session.session_id, "durable worker command role/session differs");
  assert(command.campaign_id === session.campaign_id && command.campaign_version === session.campaign_version, "durable worker command campaign differs");
  assert(command.candidate_sha256 === session.candidate_sha256, "durable worker command candidate differs");
  assert(command.source_commit === session.source_commit && command.source_tree === session.source_tree, "durable worker command source differs");
  requireIdentifier(command.command_id, "durable worker command ID");
  requireString(command.task, "durable worker command task");
  requireIdentifier(command.task_id, "durable worker command task ID");
  requireIdentifier(command.task_kind, "durable worker command task kind");
  validateLocalTaskKindForRole({role: session.role, taskKind: command.task_kind, label: "durable worker command task kind"});
  for (const field of ["feature_worktree", "evidence_worktree", "decision_tree_path"]) assert(command[field] === null || typeof command[field] === "string", `durable worker command ${field} is invalid`);
  requireUtc(command.created_at_utc, "durable worker command time");
  requireSha(command.command_sha256, "durable worker command digest");
  assert(command.command_sha256 === digestWithout(command, "command_sha256"), "durable worker command digest mismatch");
  return command;
}

export async function startDurableWorkerSession({repoRoot, runtimeRoot, role, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, task, taskId = "INITIAL", taskKind = "INITIAL", featureWorktree = null, evidenceWorktree = null, decisionTreePath = null, workerScriptPath = null, sessionId = null, timeoutMs = 30_000}) {
  assert(LOCAL_WORKER_ROLES.includes(role), `unsupported durable worker role: ${role}`);
  requireString(repoRoot, "durable adapter repository root");
  requireString(runtimeRoot, "durable adapter runtime root");
  requireIdentifier(campaignId, "durable worker campaign ID");
  requireString(campaignVersion, "durable worker campaign version");
  requireSha(candidateSha256, "durable worker candidate");
  requireGitObject(sourceCommit, "durable worker source commit");
  requireGitObject(sourceTree, "durable worker source tree");
  requireString(task, "durable worker task");
  requireIdentifier(taskId, "durable worker task ID");
  requireIdentifier(taskKind, "durable worker task kind");
  validateLocalTaskKindForRole({role, taskKind});
  const root = canonicalRoot(repoRoot);
  const runtime = safeChild(root, path.relative(root, runtimeRoot));
  const feature = featureWorktree === null ? null : safeChild(root, path.relative(root, featureWorktree));
  const evidence = evidenceWorktree === null ? null : safeChild(root, path.relative(root, evidenceWorktree));
  const decisionTree = decisionTreePath === null ? null : safeChild(root, path.relative(root, decisionTreePath));
  const runtimeKey = `${campaignId}-${campaignVersion}`.replace(/[^A-Za-z0-9._-]/gu, "_");
  const taskSuffix = taskId === "INITIAL" ? "" : `-${taskId}`;
  const durableSessionId = sessionId ?? `DURABLE-${role}-${candidateSha256.slice(0, 12)}${taskSuffix}`;
  requireIdentifier(durableSessionId, "durable worker session ID");
  const workerKey = `${role.replaceAll(":", "_")}${taskSuffix}`;
  const sessionDirectory = safeChild(runtime, path.join("sessions", runtimeKey, workerKey));
  const recordPath = path.join(sessionDirectory, "session.json");
  const heartbeatPath = path.join(sessionDirectory, "heartbeat.json");
  const commandPath = path.join(sessionDirectory, "command.json");
  const commandResultPath = path.join(sessionDirectory, "command-result.json");
  const initialReadbackPath = path.join(sessionDirectory, "initial-readback.json");
  const existing = readJson(recordPath);
  if (existing !== null) {
    const restored = restoreSessionPaths(recordPath, existing);
    validateLocalDurableSessionRecord(restored);
    assert(restored.role === role && restored.session_id === durableSessionId && restored.task_id === taskId && restored.task_kind === taskKind && restored.campaign_id === campaignId && restored.candidate_sha256 === candidateSha256, "duplicate durable worker identity differs");
    const heartbeat = readJson(restored.heartbeat_path);
    if (restored.status === "RUNNING" && pidAlive(restored.pid) && heartbeat !== null) {
      validateLocalWorkerHeartbeat(heartbeat, {role, sessionId: durableSessionId, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree});
      return {session_record: restored, heartbeat, readback: restored.initial_readback, reused: true};
    }
    throw new Error(`durable worker session ${durableSessionId} is ${restored.status} or stale; retain it and route a distinct repair task`);
  }
  const worktreePath = safeChild(runtime, path.join("worktrees", runtimeKey, workerKey));
  const worktree = ensureWorktree({repoRoot: root, worktreePath, sourceCommit, sourceTree});
  const startedAtUtc = new Date().toISOString();
  const workerScript = workerScriptPath === null ? new URL("./local-agent-worker.mjs", import.meta.url).pathname : safeChild(root, path.relative(root, workerScriptPath));
  const sessionScript = new URL("./local-agent-session.mjs", import.meta.url).pathname;
  const schedulerRoot = safeChild(runtime, "scheduler-authority");
  const args = [sessionScript, "--role", role, "--session-id", durableSessionId, "--campaign-id", campaignId, "--campaign-version", campaignVersion, "--candidate-sha256", candidateSha256, "--source-commit", sourceCommit, "--source-tree", sourceTree, "--worktree", worktree, "--task", task, "--task-id", taskId, "--task-kind", taskKind, "--scheduler-root", schedulerRoot, "--repository-root", root, "--worker-script", workerScript, "--heartbeat-path", heartbeatPath, "--command-path", commandPath, "--command-result-path", commandResultPath, "--initial-readback-path", initialReadbackPath];
  if (feature !== null) args.push("--feature-worktree", feature);
  if (evidence !== null) args.push("--evidence-worktree", evidence);
  if (decisionTree !== null) args.push("--decision-tree", decisionTree);
  const effectiveArgv = [process.execPath, ...args];
  const binding = createLocalWorkerLaunchAdmission({schedulerRoot, repositoryRoot: root, worktreePath: worktree, workerScriptPath: sessionScript, role, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, sessionId: durableSessionId, launchId: durableSessionId, task, taskId, taskKind, mode: "ASYNC", effectiveArgv});
  const scheduled = await binding.scheduler.run({
    request: binding.request,
    admission: binding.admission,
    resolveCandidate: binding.resolveCandidate,
    execute: async () => {
      const child = spawn(effectiveArgv[0], effectiveArgv.slice(1), {cwd: worktree, detached: true, stdio: "ignore"});
      child.unref();
      return child;
    },
  });
  const child = scheduled.output;
  let sessionRecord = compileDurableSessionRecord({status: "STARTING", role, sessionId: durableSessionId, taskId, taskKind, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, worktreePath: worktree, pid: child.pid, heartbeatPath, commandPath, commandResultPath, startedAtUtc, updatedAtUtc: startedAtUtc});
  writeJsonAtomic(recordPath, sessionRecord);
  const deadline = Date.now() + timeoutMs;
  let initial = null;
  while (Date.now() < deadline) {
    initial = readJson(initialReadbackPath);
    if (initial !== null) {
      try {
        requireSha(initial.initial_readback_sha256, "durable worker initial readback digest");
        assert(initial.initial_readback_sha256 === digestWithout(initial, "initial_readback_sha256"), "durable worker initial readback digest mismatch");
        break;
      } catch {
        initial = null;
      }
    }
    if (!pidAlive(child.pid)) break;
    await sleep(100);
  }
  if (initial === null) {
    sessionRecord = compileDurableSessionRecord({status: "FAILED", role: sessionRecord.role, sessionId: sessionRecord.session_id, taskId: sessionRecord.task_id, taskKind: sessionRecord.task_kind, campaignId: sessionRecord.campaign_id, campaignVersion: sessionRecord.campaign_version, candidateSha256: sessionRecord.candidate_sha256, sourceCommit: sessionRecord.source_commit, sourceTree: sessionRecord.source_tree, worktreePath: sessionRecord.worktree_path, pid: sessionRecord.pid, heartbeatPath: sessionRecord.heartbeat_path, commandPath: sessionRecord.command_path, commandResultPath: sessionRecord.command_result_path, initialReadback: sessionRecord.initial_readback, lastCommandId: sessionRecord.last_command_id, failure: `durable worker did not return initial readback within ${timeoutMs}ms`, startedAtUtc: sessionRecord.started_at_utc, updatedAtUtc: new Date().toISOString()});
    writeJsonAtomic(recordPath, sessionRecord);
    throw new Error(sessionRecord.failure);
  }
  if (initial.status !== "COMPLETED") {
    sessionRecord = compileDurableSessionRecord({status: "FAILED", role: sessionRecord.role, sessionId: sessionRecord.session_id, taskId: sessionRecord.task_id, taskKind: sessionRecord.task_kind, campaignId: sessionRecord.campaign_id, campaignVersion: sessionRecord.campaign_version, candidateSha256: sessionRecord.candidate_sha256, sourceCommit: sessionRecord.source_commit, sourceTree: sessionRecord.source_tree, worktreePath: sessionRecord.worktree_path, pid: sessionRecord.pid, heartbeatPath: sessionRecord.heartbeat_path, commandPath: sessionRecord.command_path, commandResultPath: sessionRecord.command_result_path, initialReadback: sessionRecord.initial_readback, lastCommandId: sessionRecord.last_command_id, failure: initial.error ?? "durable worker initial task failed", startedAtUtc: sessionRecord.started_at_utc, updatedAtUtc: new Date().toISOString()});
    writeJsonAtomic(recordPath, sessionRecord);
    throw new Error(sessionRecord.failure);
  }
  const expected = {role, sessionId: durableSessionId, campaignId, campaignVersion, candidateSha256, sourceCommit, sourceTree, worktreePath: worktree, featureWorktree: feature};
  const handshake = validateHandshake(initial.handshake, {...expected, taskKind});
  const readback = compileDurableSessionReadback(handshake, 0);
  validateLocalWorkerReadback(readback, taskKind);
  const heartbeat = readJson(heartbeatPath);
  validateLocalWorkerHeartbeat(heartbeat, expected);
  sessionRecord = compileDurableSessionRecord({status: "RUNNING", role: sessionRecord.role, sessionId: sessionRecord.session_id, taskId: sessionRecord.task_id, taskKind: sessionRecord.task_kind, campaignId: sessionRecord.campaign_id, campaignVersion: sessionRecord.campaign_version, candidateSha256: sessionRecord.candidate_sha256, sourceCommit: sessionRecord.source_commit, sourceTree: sessionRecord.source_tree, worktreePath: sessionRecord.worktree_path, pid: sessionRecord.pid, heartbeatPath: sessionRecord.heartbeat_path, commandPath: sessionRecord.command_path, commandResultPath: sessionRecord.command_result_path, initialReadback: readback, lastCommandId: sessionRecord.last_command_id, failure: null, startedAtUtc: sessionRecord.started_at_utc, updatedAtUtc: new Date().toISOString()});
  writeJsonAtomic(recordPath, sessionRecord);
  return {session_record: sessionRecord, heartbeat, readback, reused: false};
}

export function issueDurableWorkerSessionCommand({sessionRecordPath, commandId, task, taskId, taskKind, featureWorktree = null, evidenceWorktree = null, decisionTreePath = null, createdAtUtc = new Date().toISOString()}) {
  const session = readJson(sessionRecordPath);
  validateLocalDurableSessionRecord(session);
  assert(session.status === "RUNNING" && pidAlive(session.pid), "durable worker session is not running");
  const command = compileDurableWorkerSessionCommand({session, commandId, task, taskId, taskKind, featureWorktree, evidenceWorktree, decisionTreePath, createdAtUtc});
  const existing = readJson(session.command_path);
  if (existing !== null) {
    validateDurableWorkerSessionCommand(existing, session);
    assert(existing.command_id === command.command_id && existing.command_sha256 === command.command_sha256, "durable worker command slot is occupied by a different command");
    return existing;
  }
  writeJsonAtomic(session.command_path, command);
  const readback = readJson(session.command_path);
  validateDurableWorkerSessionCommand(readback, session);
  return readback;
}

export function markDurableWorkerSessionFailed({sessionRecordPath, failure = "durable worker process exited before stop"}) {
  const persisted = readJson(sessionRecordPath);
  const session = persisted === null ? null : restoreSessionPaths(sessionRecordPath, persisted);
  validateLocalDurableSessionRecord(session);
  requireString(failure, "durable worker failure");
  if (session.status !== "RUNNING") return session;
  const failed = compileDurableSessionRecord({
    status: "FAILED",
    role: session.role,
    sessionId: session.session_id,
    taskId: session.task_id,
    taskKind: session.task_kind,
    campaignId: session.campaign_id,
    campaignVersion: session.campaign_version,
    candidateSha256: session.candidate_sha256,
    sourceCommit: session.source_commit,
    sourceTree: session.source_tree,
    worktreePath: session.worktree_path,
    pid: session.pid,
    heartbeatPath: session.heartbeat_path,
    commandPath: session.command_path,
    commandResultPath: session.command_result_path,
    initialReadback: session.initial_readback,
    lastCommandId: session.last_command_id,
    failure,
    startedAtUtc: session.started_at_utc,
    updatedAtUtc: new Date().toISOString(),
  });
  writeJsonAtomic(sessionRecordPath, failed);
  return failed;
}

export async function stopDurableWorkerSession({sessionRecordPath, timeoutMs = 5_000}) {
  const persisted = readJson(sessionRecordPath);
  const session = persisted === null ? null : restoreSessionPaths(sessionRecordPath, persisted);
  validateLocalDurableSessionRecord(session);
  if (!pidAlive(session.pid)) {
    return markDurableWorkerSessionFailed({sessionRecordPath, failure: "durable worker process exited before stop"});
  }
  process.kill(Number(session.pid), "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  let heartbeat = null;
  while (Date.now() < deadline) {
    heartbeat = readJson(session.heartbeat_path);
    if (heartbeat?.status === "STOPPED") break;
    await sleep(100);
  }
  if (heartbeat !== null) validateLocalWorkerHeartbeat(heartbeat, {role: session.role, sessionId: session.session_id, campaignId: session.campaign_id, campaignVersion: session.campaign_version, candidateSha256: session.candidate_sha256, sourceCommit: session.source_commit, sourceTree: session.source_tree});
  assert(heartbeat?.status === "STOPPED" || !pidAlive(session.pid), "durable worker did not stop within the bounded timeout");
  const stopped = compileDurableSessionRecord({status: "STOPPED", role: session.role, sessionId: session.session_id, taskId: session.task_id, taskKind: session.task_kind, campaignId: session.campaign_id, campaignVersion: session.campaign_version, candidateSha256: session.candidate_sha256, sourceCommit: session.source_commit, sourceTree: session.source_tree, worktreePath: session.worktree_path, pid: session.pid, heartbeatPath: session.heartbeat_path, commandPath: session.command_path, commandResultPath: session.command_result_path, initialReadback: session.initial_readback, lastCommandId: session.last_command_id, failure: null, startedAtUtc: session.started_at_utc, updatedAtUtc: new Date().toISOString()});
  writeJsonAtomic(sessionRecordPath, stopped);
  return stopped;
}

export function validateLocalWorkerReadback(readback, taskKind = null) {
  assert(readback && typeof readback === "object" && !Array.isArray(readback), "local worker readback is required");
  const required = ["schema", "version", "status", "role", "session_id", "campaign_id", "campaign_version", "candidate_sha256", "pid", "worktree_path", "source_commit", "source_tree", "build_status", "build_commit", "build_tree", "changed_paths", "focused_checks", "build_checkpoint_sha256", "artifact_path", "artifact_sha256", "exit_code", "observed_at_utc", "readback_sha256"];
  assert(JSON.stringify(Object.keys(readback).sort()) === JSON.stringify([...required].sort()), "local worker readback fields mismatch");
  assert(readback.schema === "agentos.local_worker_spawn_readback.v1" && readback.version === 1 && readback.status === "COMPLETED", "local worker readback identity is invalid");
  assert(LOCAL_WORKER_ROLES.includes(readback.role), "local worker readback role is invalid");
  for (const field of ["session_id", "campaign_id", "campaign_version", "pid", "worktree_path", "source_commit", "source_tree", "artifact_path", "observed_at_utc"]) requireString(readback[field], `local worker readback ${field}`);
  requireSha(readback.candidate_sha256, "local worker readback candidate");
  requireGitObject(readback.source_commit, "local worker readback commit");
  requireGitObject(readback.source_tree, "local worker readback tree");
  assert(["NOT_FEATURE_AGENT_BUILD", "COMPLETED", "AUDIT_VERIFIED"].includes(readback.build_status), "local worker readback build status is invalid");
  assert(readback.build_commit === null || GIT_OBJECT.test(readback.build_commit), "local worker readback build commit is invalid");
  assert(readback.build_tree === null || GIT_OBJECT.test(readback.build_tree), "local worker readback build tree is invalid");
  assert(Array.isArray(readback.changed_paths) && Array.isArray(readback.focused_checks), "local worker readback build evidence is invalid");
  if (readback.role === "FEATURE_AGENT") {
    if (taskKind === "CONTROLLER_SUPERVISOR_LIVENESS") {
      assert(readback.build_status === "COMPLETED" && readback.build_commit === readback.source_commit && readback.build_tree === readback.source_tree && readback.changed_paths.length === 0 && readback.focused_checks.length > 0 && readback.build_checkpoint_sha256 !== null, "liveness Feature Agent readback is not source-bound");
    } else {
      const requiredChangedPath = taskKind === "CONTROLLER_SUPERVISOR_REPAIR"
        ? "control/controller-supervisor.mjs"
        : taskKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR" || taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR"
            ? "schemas/bootstrap-binding.v1.json"
            : taskKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
              ? "control/local-self-development-supervisor-adapter.mjs"
            : taskKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
              ? "control/local-self-development-supervisor-adapter.mjs"
            : taskKind === "DURABLE_SESSION_LIVENESS_REPAIR"
              ? "control/local-agent-runtime.mjs"
            : taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
              ? "tests/verify-local-agent-session.mjs"
            : taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
              ? "control/bootstrap-compiler.mjs"
            : taskKind === "OWNER_FEEDBACK_REPAIR"
              ? "control/task-run-loop.mjs"
            : "control/governance-decision-tree.mjs";
      const ownerFeedbackCodeChanged = taskKind === "OWNER_FEEDBACK_REPAIR"
        && ["control/check-runner.mjs", "control/local-campaign-admission.mjs", "control/task-run-loop.mjs", "control/local-agent-runtime.mjs", "control/local-self-development-supervisor-adapter.mjs"].some((candidatePath) => readback.changed_paths.includes(candidatePath));
      assert(readback.build_status === "COMPLETED" && readback.build_commit !== null && readback.build_tree !== null
        && (taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
          ? ["control/bootstrap-compiler.mjs", "control/owner-review.mjs"].some((candidatePath) => readback.changed_paths.includes(candidatePath))
          : ownerFeedbackCodeChanged
            ? true
          : readback.changed_paths.includes(requiredChangedPath))
        && readback.focused_checks.length > 0 && readback.build_checkpoint_sha256 !== null, "metadata-only Feature Agent readback is not a completed build");
    }
  }
  requireSha(readback.artifact_sha256, "local worker readback artifact");
  assert(readback.exit_code === 0, "local worker readback exit status is not successful");
  requireSha(readback.readback_sha256, "local worker readback digest");
  assert(readback.readback_sha256 === digestWithout(readback, "readback_sha256"), "local worker readback digest mismatch");
  return readback;
}

export function createLocalSelfDevelopmentAdapters({repoRoot, runtimeRoot, authorization, admission, candidate, identityBinding, decisionTreePath = null, allowLegacyProcessWorkers = false}) {
  if (allowLegacyProcessWorkers !== true) {
    const error = new Error("NATIVE_SESSION_TOOLING_REQUIRED: campaign roles must use create_thread, list_threads, wait_threads, send_message_to_thread, and set_thread_archived; local child processes are not campaign agents");
    error.code = "NATIVE_SESSION_TOOLING_REQUIRED";
    throw error;
  }
  requireString(repoRoot, "local adapter repository root");
  requireString(runtimeRoot, "local adapter runtime root");
  assert(authorization?.permissions?.local_worker_agent_spawns_allowed === true, "local adapter lacks worker-spawn authorization");
  assert(authorization?.permissions?.product_agent_spawns_allowed === false, "local adapter cannot spawn Product agents");
  let featureWorkerReadback = null;
  const spawn = (role, context, task, featureWorktree = null) => {
    const readback = spawnWorker({
      repoRoot,
      runtimeRoot,
      role,
      campaignId: candidate.campaign_id,
      campaignVersion: candidate.campaign_version,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit: candidate.source_commit,
      sourceTree: candidate.source_tree,
      task,
      featureWorktree,
      decisionTreePath,
    });
    validateLocalWorkerReadback(readback);
    return compileControllerAdapterReadback({
      operation: context.operation,
      actionId: context.action_id,
      eventId: context.event.event_id,
      controllerId: context.controller_state.logical_controller_id,
      projectId: context.controller_state.project_id,
      policyEpoch: context.controller_state.policy_epoch,
      policyStateSha256: context.controller_state.policy_state_sha256,
      campaignId: candidate.campaign_id,
      externalIdentity: `LOCAL_PROCESS:${readback.pid}:${readback.session_id}`,
      observedAtUtc: readback.observed_at_utc,
      details: {session_id: readback.session_id, worker_readback: readback},
    });
  };
  const adapter = {
    admitLocalSelfDevelopment: (context) => {
      assert(context.payload.authorization.authorization_sha256 === authorization.authorization_sha256, "local admission authorization differs");
      assert(context.payload.admission.admission_sha256 === admission.admission_sha256, "local admission record differs");
      assert(context.payload.candidate.candidate_sha256 === candidate.candidate_sha256, "local admission candidate differs");
      assert(context.payload.identity_binding.binding_sha256 === identityBinding.binding_sha256, "local admission identity differs");
      return compileControllerAdapterReadback({
        operation: context.operation,
        actionId: context.action_id,
        eventId: context.event.event_id,
        controllerId: context.controller_state.logical_controller_id,
        projectId: context.controller_state.project_id,
        policyEpoch: context.controller_state.policy_epoch,
        policyStateSha256: context.controller_state.policy_state_sha256,
        campaignId: candidate.campaign_id,
        externalIdentity: `LOCAL_ADMISSION:${admission.admission_sha256.slice(0, 16)}`,
        observedAtUtc: context.event.occurred_at_utc,
        details: {
          status: "CAMPAIGN_ADMITTED",
          admission_sha256: admission.admission_sha256,
          authorization_sha256: authorization.authorization_sha256,
          candidate_sha256: candidate.candidate_sha256,
          identity_binding_sha256: identityBinding.binding_sha256,
        },
      });
    },
    spawnCampaignOrchestrator: (context) => spawn("CAMPAIGN_ORCHESTRATOR", context, "Coordinate this local AgentOS self-development campaign through the executable four-root governance tree."),
    spawnIndependentAuditor: (context) => spawn("INDEPENDENT_AUDITOR", context, "Audit the actual local Feature-Agent changed tree and exact build evidence.", featureWorkerReadback?.worktree_path ?? null),
    spawnFeatureAgents: (context) => {
      const readback = spawn("FEATURE_AGENT", context, "Own the bounded code repair for the executable four-root governance tree and local admission bridge in the isolated worktree.");
      featureWorkerReadback = readback.details.worker_readback;
      return compileControllerAdapterReadback({
        operation: context.operation,
        actionId: context.action_id,
        eventId: context.event.event_id,
        controllerId: context.controller_state.logical_controller_id,
        projectId: context.controller_state.project_id,
        policyEpoch: context.controller_state.policy_epoch,
        policyStateSha256: context.controller_state.policy_state_sha256,
        campaignId: candidate.campaign_id,
        externalIdentity: `LOCAL_PROCESS:${readback.details.worker_readback.pid}:${readback.details.session_id}`,
        observedAtUtc: readback.observed_at_utc,
        details: {
          session_id: readback.details.session_id,
          worker_readback: readback.details.worker_readback,
          feature_agent_session_ids: [readback.details.session_id],
          worker_readbacks: [readback.details.worker_readback],
        },
      });
    },
  };
  return adapter;
}

export {spawnWorker};
export {compileCommandResult};
export {createNativeSelfDevelopmentAdapters} from "./native-self-development-adapter.mjs";
