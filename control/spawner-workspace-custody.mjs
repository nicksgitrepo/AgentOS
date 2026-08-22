#!/usr/bin/env node

/* Runtime-only workspace custody for the project-agnostic Spawner boundary. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest} from "./content-addressing.mjs";

export const SPAWNER_WORKSPACE_CUSTODY_SCHEMA = "agentos.spawner_workspace_custody_receipt.v1";
export const SPAWNER_WORKSPACE_ROOT_ENVIRONMENT_KEYS = Object.freeze([
  "AGENTOS_PROJECTS_ROOT",
  "AGENTOS_WORKSPACE_ROOT",
]);

const slash = String.fromCharCode(47);
const backslash = String.fromCharCode(92);
const homeMarker = "HOME";
const personalRootSegments = Object.freeze(["Users", "home"]);
const digestPattern = /^[0-9a-f]{64}$/u;

function fail(message, code = "SPAWNER_WORKSPACE_CUSTODY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a nonempty path string`, "SPAWNER_WORKSPACE_PATH_INVALID");
  }
  return value;
}

function assertAbsolute(value, label) {
  assertString(value, label);
  if (!path.isAbsolute(value)) fail(`${label} must be absolute`, "SPAWNER_WORKSPACE_ROOT_RELATIVE");
  return value;
}

function pathComponents(value) {
  const absolute = path.resolve(value);
  const parsed = path.parse(absolute);
  const components = [parsed.root];
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    components.push(current);
  }
  return components;
}

function canonicalDirectory(value, label) {
  assertAbsolute(value, label);
  const absolute = path.resolve(value);
  for (const component of pathComponents(absolute)) {
    if (!fs.existsSync(component)) fail(`${label} contains a missing component`, "SPAWNER_WORKSPACE_PATH_MISSING");
    const stat = fs.lstatSync(component);
    if (stat.isSymbolicLink()) fail(`${label} contains a symbolic-link component`, "SPAWNER_WORKSPACE_SYMLINK_REJECTED");
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory`, "SPAWNER_WORKSPACE_DIRECTORY_INVALID");
  const real = fs.realpathSync.native(absolute);
  if (real !== absolute) fail(`${label} is not canonical`, "SPAWNER_WORKSPACE_ALIAS_REJECTED");
  return real;
}

function isWithin(root, candidate) {
  const parent = path.resolve(root);
  const child = path.resolve(candidate);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function readConfiguredRoot() {
  const configured = SPAWNER_WORKSPACE_ROOT_ENVIRONMENT_KEYS
    .filter((key) => Object.hasOwn(process.env, key) && process.env[key] !== undefined)
    .map((key) => ({key, value: process.env[key]}));
  if (configured.length > 1 && new Set(configured.map((entry) => entry.value)).size !== 1) {
    fail("workspace root environment configuration is ambiguous", "SPAWNER_WORKSPACE_ROOT_AMBIGUOUS");
  }
  if (configured.length === 0) return null;
  const value = configured[0].value;
  return canonicalDirectory(value, `${configured[0].key} workspace root`);
}

function activeGitWorktreeRoot(activeRoot) {
  const active = canonicalDirectory(activeRoot, "active project context");
  let top;
  try {
    top = execFileSync("git", ["-C", active, "rev-parse", "--show-toplevel"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch {
    fail("active project context is not a Git worktree", "SPAWNER_WORKSPACE_CONTEXT_REQUIRED");
  }
  return canonicalDirectory(top, "active Git worktree root");
}

function rejectFilesystemRoot(value, label) {
  if (path.dirname(value) === value) fail(`${label} may not be the filesystem root`, "SPAWNER_WORKSPACE_ROOT_TOO_BROAD");
  return value;
}

export function resolveConfiguredSpawnerWorkspaceRoot({activeRoot = process.cwd()} = {}) {
  const configured = readConfiguredRoot();
  if (configured) return Object.freeze({root: rejectFilesystemRoot(configured, "configured workspace root"), source: "RUNTIME_ENVIRONMENT"});
  const worktreeRoot = activeGitWorktreeRoot(activeRoot);
  const inferred = canonicalDirectory(path.dirname(worktreeRoot), "inferred workspace root");
  return Object.freeze({root: rejectFilesystemRoot(inferred, "inferred workspace root"), source: "ACTIVE_GIT_WORKTREE_PARENT", active_worktree_root: worktreeRoot});
}

function digestPath(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function resolveSpawnerWorkspaceCustody({taskRoot, activeRoot = process.cwd(), taskLabel = "task checkout"} = {}) {
  const workspace = resolveConfiguredSpawnerWorkspaceRoot({activeRoot});
  const task = canonicalDirectory(taskRoot, taskLabel);
  if (!isWithin(workspace.root, task)) fail(`${taskLabel} escapes the configured workspace root`, "SPAWNER_WORKSPACE_CONTAINMENT_REJECTED");
  const receipt = {
    schema: SPAWNER_WORKSPACE_CUSTODY_SCHEMA,
    version: 1,
    status: "BOUND",
    runtime_only: true,
    resolution_source: workspace.source,
    workspace_root: workspace.root,
    active_worktree_root: workspace.active_worktree_root ?? null,
    task_root: task,
    task_root_within_workspace: true,
    workspace_root_sha256: digestPath(workspace.root),
    task_root_sha256: digestPath(task),
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = canonicalDigest({...receipt, receipt_sha256: null});
  return Object.freeze({workspaceRoot: workspace.root, taskRoot: task, receipt: Object.freeze(receipt)});
}

function personalPathPatterns() {
  const root = escapeRegExp(slash);
  const win = escapeRegExp(backslash);
  const separator = `(?:${root}|${win})`;
  const personal = personalRootSegments.map(escapeRegExp).join("|");
  const segment = `[^\\s\"'<>]+`;
  return [
    new RegExp(`${root}(?:${personal})${separator}${segment}`, "u"),
    new RegExp(`[A-Za-z]:${separator}(?:${personal})${separator}${segment}`, "u"),
    new RegExp(`(?:^|[^A-Za-z0-9_])~${separator}${segment}`, "u"),
    new RegExp(`${escapeRegExp("$")}(?:\\{)?${homeMarker}(?:\\})?`, "u"),
  ];
}

const PERSONAL_PATH_PATTERNS = personalPathPatterns();

export function assertSpawnerPortableInputText(value, label = "Spawner input") {
  if (typeof value !== "string" || /[\u0000\u007f]/u.test(value)) {
    fail(`${label} must be text without control characters`, "SPAWNER_PORTABLE_INPUT_INVALID");
  }
  if (PERSONAL_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
    fail(`${label} contains a username-specific or home-directory path literal`, "SPAWNER_PERSONAL_PATH_LITERAL");
  }
  return value;
}

function trackedInputPaths(repositoryRoot) {
  const roots = ["specialist-blocks", "schemas", "governance", "prompts", "templates"]
    .filter((relative) => fs.existsSync(path.join(repositoryRoot, relative)));
  if (roots.length === 0) return [];
  let output;
  try {
    output = execFileSync("git", ["-C", repositoryRoot, "ls-files", "-z", "--", ...roots], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  } catch {
    fail("portable Spawner inputs require a Git-backed repository", "SPAWNER_PORTABILITY_GIT_REQUIRED");
  }
  return output.split("\0").filter(Boolean).sort((left, right) => left.localeCompare(right));
}

export function assertSpawnerPortableInputs({repositoryRoot = process.cwd()} = {}) {
  const root = canonicalDirectory(repositoryRoot, "Spawner input repository root");
  const paths = trackedInputPaths(root);
  const fileDigests = [];
  for (const relative of paths) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/u).some((part) => part === ".." || part === "")) {
      fail("tracked Spawner input path is not relative", "SPAWNER_PORTABILITY_PATH_INVALID");
    }
    const absolute = path.resolve(root, relative);
    if (!isWithin(root, absolute)) fail("tracked Spawner input escapes repository root", "SPAWNER_PORTABILITY_PATH_INVALID");
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`tracked Spawner input is not a regular file: ${relative}`, "SPAWNER_PORTABILITY_SYMLINK_REJECTED");
    const bytes = fs.readFileSync(absolute);
    assertSpawnerPortableInputText(bytes.toString("utf8"), relative);
    fileDigests.push({path: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex")});
  }
  return Object.freeze({status: "PASS", tracked_input_count: fileDigests.length, inputs_sha256: canonicalDigest(fileDigests)});
}

export function validateSpawnerWorkspaceCustodyReceipt(receipt) {
  if (!isRecord(receipt) || receipt.schema !== SPAWNER_WORKSPACE_CUSTODY_SCHEMA || receipt.version !== 1 || receipt.status !== "BOUND" || receipt.runtime_only !== true || receipt.task_root_within_workspace !== true) {
    fail("workspace custody receipt identity is invalid", "SPAWNER_WORKSPACE_RECEIPT_INVALID");
  }
  for (const field of ["workspace_root_sha256", "task_root_sha256", "receipt_sha256"]) {
    if (!digestPattern.test(receipt[field] ?? "")) fail(`workspace custody receipt ${field} is invalid`, "SPAWNER_WORKSPACE_RECEIPT_INVALID");
  }
  if (receipt.receipt_sha256 !== canonicalDigest({...receipt, receipt_sha256: null})) fail("workspace custody receipt digest differs", "SPAWNER_WORKSPACE_RECEIPT_INVALID");
  return receipt;
}
