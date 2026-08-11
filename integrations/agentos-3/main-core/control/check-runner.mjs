#!/usr/bin/env node

/*
 * One bounded check runner for worker and repair recipes.
 *
 * Checks are admitted through the Hybrid Scheduler, may invoke only Node on a
 * repository-relative control/tests module, and retain only privacy-safe
 * failure digests in the worktree. The scheduler authority root is supplied
 * by the host and is never written into a persisted receipt.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {
  compileHybridSchedulerRequest,
  createHybridScheduler,
  opaqueSchedulerWorktreeRef,
} from "./hybrid-scheduler.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const CHECK_SCRIPT = /^(?:control|tests)\/[A-Za-z0-9._/-]+\.mjs$/u;
const MAX_OUTPUT_BYTES = 64 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} is required`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function sourceIdentity(worktreePath) {
  const absolute = path.resolve(worktreePath);
  assert(!fs.lstatSync(absolute).isSymbolicLink(), "check worktree may not be a symlink");
  const root = fs.realpathSync.native(absolute);
  const stat = fs.lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "check worktree must be a real directory");
  const sourceCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  const sourceTree = execFileSync("git", ["-C", root, "rev-parse", "HEAD^{tree}"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  requireGitObject(sourceCommit, "observed source commit");
  requireGitObject(sourceTree, "observed source tree");
  return {root, sourceCommit, sourceTree};
}

function candidateIdentity(root) {
  const status = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  if (status.length === 0) return {commit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(), tree: execFileSync("git", ["-C", root, "rev-parse", "HEAD^{tree}"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(), clean: true};
  const diff = execFileSync("git", ["-C", root, "diff", "--binary"], {encoding: "buffer", maxBuffer: 64 * 1024 * 1024});
  const untracked = execFileSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"], {encoding: "buffer", maxBuffer: 64 * 1024 * 1024});
  return {
    commit: "PRELIMINARY_DIAGNOSTIC",
    tree: crypto.createHash("sha256").update(JSON.stringify({
      status,
      diff_sha256: crypto.createHash("sha256").update(diff).digest("hex"),
      untracked_sha256: crypto.createHash("sha256").update(untracked).digest("hex"),
    }), "utf8").digest("hex"),
    clean: false,
  };
}

function evidenceDirectory(root) {
  let current = root;
  for (const segment of ["control", "check-failure-receipts"]) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, {mode: 0o700});
    const stat = fs.lstatSync(current);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "check evidence custody path must contain real directories");
    assert(fs.realpathSync.native(current).startsWith(`${root}${path.sep}`), "check evidence custody path escapes worktree");
  }
  return current;
}

export function parseCheckCommand(command) {
  requireString(command, "check command");
  assert(command.length <= 240, "check command is too long");
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;
  for (const character of command.trim()) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }
  assert(!escaped && quote === null, "check command has an unterminated escape or quote");
  if (token.length > 0) tokens.push(token);
  assert(tokens.length === 2 || (tokens.length === 3 && tokens[1] === "--check"), "check executable or arguments are not authorized");
  assert(tokens[0] === "node" && CHECK_SCRIPT.test(tokens.at(-1)) && !tokens.at(-1).includes(".."), "check script is outside the authorized source areas");
  return {program: process.execPath, args: tokens.slice(1)};
}

export function validateCheckFailureReceipt(receipt) {
  const keys = ["schema", "version", "status", "task_id", "role", "source_commit", "source_tree", "check_index", "command", "exit_code", "signal", "stdout_sha256", "stderr_sha256", "stdout_bytes", "stderr_bytes", "diagnostics_redacted", "observed_at_utc", "failure_sha256"];
  assert(JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify([...keys].sort()), "check failure receipt fields mismatch");
  assert(receipt.schema === "agentos.local_check_failure_receipt.v1" && receipt.version === 1 && receipt.status === "FAILED", "check failure receipt identity is invalid");
  requireString(receipt.task_id, "check failure task ID");
  requireString(receipt.role, "check failure role");
  requireGitObject(receipt.source_commit, "check failure source commit");
  requireGitObject(receipt.source_tree, "check failure source tree");
  assert(Number.isSafeInteger(receipt.check_index) && receipt.check_index >= 0, "check failure index is invalid");
  requireString(receipt.command, "check failure command");
  assert(receipt.exit_code === null || (Number.isSafeInteger(receipt.exit_code) && receipt.exit_code !== 0), "check failure exit code is invalid");
  assert(receipt.signal === null || typeof receipt.signal === "string", "check failure signal is invalid");
  requireSha(receipt.stdout_sha256, "check failure stdout digest");
  requireSha(receipt.stderr_sha256, "check failure stderr digest");
  assert(Number.isSafeInteger(receipt.stdout_bytes) && receipt.stdout_bytes >= 0 && receipt.stdout_bytes <= MAX_OUTPUT_BYTES, "check failure stdout size is invalid");
  assert(Number.isSafeInteger(receipt.stderr_bytes) && receipt.stderr_bytes >= 0 && receipt.stderr_bytes <= MAX_OUTPUT_BYTES, "check failure stderr size is invalid");
  assert(receipt.diagnostics_redacted === true, "check failure diagnostics must be redacted");
  requireUtc(receipt.observed_at_utc, "check failure time");
  requireSha(receipt.failure_sha256, "check failure digest");
  assert(receipt.failure_sha256 === digestWithout(receipt, "failure_sha256"), "check failure digest mismatch");
  return receipt;
}

export function compileCheckFailureReceipt({taskId, role, sourceCommit, sourceTree, checkIndex, command, error, observedAtUtc = new Date().toISOString()}) {
  const stdout = typeof error?.stdout === "string" ? error.stdout : String(error?.stdout ?? "");
  const stderr = typeof error?.stderr === "string" ? error.stderr : String(error?.stderr ?? "");
  assert(Buffer.byteLength(stdout, "utf8") <= MAX_OUTPUT_BYTES && Buffer.byteLength(stderr, "utf8") <= MAX_OUTPUT_BYTES, "check failure output exceeds the bounded evidence limit");
  const receipt = {
    schema: "agentos.local_check_failure_receipt.v1",
    version: 1,
    status: "FAILED",
    task_id: taskId,
    role,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    check_index: checkIndex,
    command,
    exit_code: Number.isSafeInteger(error?.status) ? error.status : null,
    signal: error?.signal ?? null,
    stdout_sha256: crypto.createHash("sha256").update(stdout, "utf8").digest("hex"),
    stderr_sha256: crypto.createHash("sha256").update(stderr, "utf8").digest("hex"),
    stdout_bytes: Buffer.byteLength(stdout, "utf8"),
    stderr_bytes: Buffer.byteLength(stderr, "utf8"),
    diagnostics_redacted: true,
    observed_at_utc: observedAtUtc,
    failure_sha256: null,
  };
  receipt.failure_sha256 = digestWithout(receipt, "failure_sha256");
  return validateCheckFailureReceipt(receipt);
}

function writeReceipt(root, receipt) {
  const evidenceRoot = evidenceDirectory(root);
  const safeTaskId = receipt.task_id.replace(/[^A-Za-z0-9._-]/gu, "_");
  const target = path.join(evidenceRoot, `${safeTaskId}-${String(receipt.check_index).padStart(3, "0")}-${receipt.failure_sha256}.json`);
  if (fs.existsSync(target)) {
    assert(!fs.lstatSync(target).isSymbolicLink(), "check failure receipt may not be a symlink");
    assert(fs.readFileSync(target, "utf8") === `${JSON.stringify(receipt)}\n`, "check failure receipt changed");
    return;
  }
  const temporary = `${target}.${process.pid}.stage`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(receipt)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function schedulerId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 24).toUpperCase()}`;
}

export function runChecksWithEvidence({worktreePath, checks, taskId, role, sourceCommit, sourceTree, schedulerRoot}) {
  const {root, sourceCommit: observedCommit, sourceTree: observedTree} = sourceIdentity(worktreePath);
  assert(Array.isArray(checks) && checks.length > 0 && checks.length <= 64 && checks.every((check) => typeof check === "string" && check.trim().length > 0), "check list is invalid");
  requireString(taskId, "check task ID");
  requireString(role, "check role");
  requireGitObject(sourceCommit, "check source commit");
  requireGitObject(sourceTree, "check source tree");
  requireString(schedulerRoot, "check scheduler authority root");
  assert(path.isAbsolute(schedulerRoot), "check scheduler authority root must be absolute");
  assert(sourceCommit === observedCommit && sourceTree === observedTree, "check source identity differs from worktree HEAD");
  const candidate = candidateIdentity(root);
  const execute = () => {
    for (let checkIndex = 0; checkIndex < checks.length; checkIndex += 1) {
      const command = checks[checkIndex];
      const {program, args} = parseCheckCommand(command);
      try {
        execFileSync(program, args, {cwd: root, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, stdio: ["ignore", "pipe", "pipe"]});
      } catch (error) {
        const receipt = compileCheckFailureReceipt({taskId, role, sourceCommit, sourceTree, checkIndex, command, error});
        writeReceipt(root, receipt);
        throw error;
      }
    }
    return checks;
  };
  const scheduler = createHybridScheduler({authorityRoot: schedulerRoot});
  const request = compileHybridSchedulerRequest({
    requestId: `CHECK-${crypto.createHash("sha256").update(JSON.stringify({taskId, role, candidate, checks}), "utf8").digest("hex").slice(0, 32).toUpperCase()}`,
    requesterId: schedulerId("WORKER", taskId),
    lane: schedulerId("CHECK", `${role}:${taskId}`),
    repositoryId: "AGENTOS_PROJECT",
    worktreeId: schedulerId("WORKTREE", root),
    candidateCommit: candidate.commit,
    candidateTreeOrDigest: candidate.tree,
    cleanState: candidate.clean,
    resourceClass: checks.some((check) => /(?:build|compile|test|verify|integration|database|artifact)/iu.test(check)) ? "COMPILE_HEAVY" : "LIGHTWEIGHT_SOURCE_CHECK",
    workingDirectoryRef: opaqueSchedulerWorktreeRef(root),
    commandArgv: ["AGENTOS_CHECK_PLAN", ...checks],
    toolchainProfile: "NODE_HOST",
    proofClass: "TEST_BATCH",
    whyNeeded: "RUN_ADMITTED_CHECK_PLAN",
    expectedProof: "ALL_COMMANDS_EXIT_ZERO",
    coverage: checks.map((check) => `CHECK-${crypto.createHash("sha256").update(check, "utf8").digest("hex").slice(0, 16).toUpperCase()}`).sort(),
    timeoutClass: "BOUNDED",
    cachePolicy: "NO_SHARED_OUTPUT",
    secretPolicy: "REDACTED",
  });
  return scheduler.runSync({
    request,
    admission: {
      effectiveArgv: request.command_argv,
      workingDirectory: root,
      workingDirectoryRef: request.working_directory_ref,
      allowedScope: ["."],
      dependencyPreflight: () => ({status: "READY", identity: `DEPENDENCY_${request.request_sha256.slice(0, 24).toUpperCase()}`}),
      runtimePreflight: () => ({status: "READY", identity: `RUNTIME_${request.request_sha256.slice(0, 24).toUpperCase()}`}),
    },
    resolveCandidate: () => candidateIdentity(root),
    execute,
  }).output ?? checks;
}

