#!/usr/bin/env node

/*
 * Runtime-only task checkout/worktree custody.
 *
 * Persistent AgentOS records carry opaque custody references.  This module
 * resolves the active host context only when a task is running and returns a
 * receipt whose resolved paths are never suitable for a portable artifact.
 */

import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";

export const TASK_WORKSPACE_CUSTODY_SCHEMA = "agentos.task_workspace_custody_receipt.v1";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RUNTIME_RECEIPT = Symbol("agentos.task_workspace_custody.runtime_receipt");

function fail(message, code = "TASK_WORKSPACE_CUSTODY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty runtime path`);
}

function canonicalDirectory(value, label) {
  requireString(value, label);
  let resolved;
  try {
    resolved = fs.realpathSync.native(path.resolve(value));
  } catch {
    fail(`${label} is not an existing runtime directory`, "TASK_WORKSPACE_CUSTODY_MISSING");
  }
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    fail(`${label} is not an existing runtime directory`, "TASK_WORKSPACE_CUSTODY_MISSING");
  }
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a canonical directory`, "TASK_WORKSPACE_CUSTODY_INVALID");
  return resolved;
}

function withinOrEqual(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function gitWorktreeRoot(projectRoot) {
  let result;
  try {
    result = execFileSync("git", ["-C", projectRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    fail(`active Git worktree root is unavailable: ${error.stderr?.toString().trim() || error.message}`, "TASK_WORKSPACE_CUSTODY_GIT_ROOT_UNAVAILABLE");
  }
  return canonicalDirectory(result, "active Git worktree root");
}

function resolveWorkspaceRoot(projectRoot, configuredRoot) {
  const environmentRoot = process.env.AGENTOS_PROJECTS_ROOT;
  const candidate = configuredRoot ?? environmentRoot ?? null;
  if (candidate !== null) return {root: canonicalDirectory(candidate, "configured workspace root"), source: configuredRoot !== null && configuredRoot !== undefined ? "EXPLICIT_RUNTIME_CONTEXT" : "HOST_PROJECTS_ROOT"};
  return {root: gitWorktreeRoot(projectRoot), source: "ACTIVE_GIT_WORKTREE_ROOT"};
}

function requireContained(workspaceRoot, value, label) {
  const resolved = canonicalDirectory(value, label);
  assert(withinOrEqual(workspaceRoot, resolved), `${label} escapes the configured workspace root`, "TASK_WORKSPACE_CUSTODY_ESCAPE");
  return resolved;
}

function requireUtc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be a valid UTC runtime timestamp`);
  assert(Date.parse(value) <= Date.now(), `${label} cannot be future-dated`, "TASK_WORKSPACE_CUSTODY_TIME_INVALID");
  return value;
}

function digestBody(receipt) {
  const body = structuredClone(receipt);
  body.custody_sha256 = null;
  return body;
}

export function resolveTaskWorkspaceRoot({projectRoot = process.cwd(), workspaceRoot = null} = {}) {
  const project = canonicalDirectory(projectRoot, "active project root");
  const resolved = resolveWorkspaceRoot(project, workspaceRoot);
  assert(withinOrEqual(resolved.root, project), "active project root escapes the configured workspace root", "TASK_WORKSPACE_CUSTODY_ESCAPE");
  return Object.freeze({workspace_root: resolved.root, workspace_root_source: resolved.source, project_root: project, git_worktree_root: gitWorktreeRoot(project)});
}

export function compileTaskWorkspaceCustodyReceipt({projectRoot = process.cwd(), workspaceRoot = null, taskCheckout = projectRoot, taskWorktree = taskCheckout, observedAtUtc = new Date().toISOString()} = {}) {
  const context = resolveTaskWorkspaceRoot({projectRoot, workspaceRoot});
  const checkout = requireContained(context.workspace_root, taskCheckout, "task checkout");
  const worktree = requireContained(context.workspace_root, taskWorktree, "task-owned worktree");
  requireUtc(observedAtUtc, "task workspace custody observation time");
  const receipt = {
    schema: TASK_WORKSPACE_CUSTODY_SCHEMA,
    version: 1,
    status: "MATCHED",
    workspace_root_source: context.workspace_root_source,
    workspace_root: context.workspace_root,
    project_root: context.project_root,
    git_worktree_root: context.git_worktree_root,
    task_checkout: checkout,
    task_worktree: worktree,
    containment: {
      project_root: true,
      task_checkout: true,
      task_worktree: true,
    },
    observed_at_utc: observedAtUtc,
    custody_sha256: null,
  };
  receipt.custody_sha256 = canonicalDigest(digestBody(receipt));
  return Object.freeze(Object.defineProperty(receipt, RUNTIME_RECEIPT, {value: true, enumerable: false}));
}

export function assertTaskWorkspaceCustody(receipt) {
  assert(receipt && typeof receipt === "object" && !Array.isArray(receipt), "task workspace custody receipt is missing");
  const expected = [
    "schema", "version", "status", "workspace_root_source", "workspace_root", "project_root", "git_worktree_root",
    "task_checkout", "task_worktree", "containment", "observed_at_utc", "custody_sha256",
  ];
  assert(JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify(expected.slice().sort()), "task workspace custody receipt fields differ");
  assert(receipt.schema === TASK_WORKSPACE_CUSTODY_SCHEMA && receipt.version === 1 && receipt.status === "MATCHED", "task workspace custody receipt identity is invalid");
  assert(["EXPLICIT_RUNTIME_CONTEXT", "HOST_PROJECTS_ROOT", "ACTIVE_GIT_WORKTREE_ROOT"].includes(receipt.workspace_root_source), "task workspace custody source is invalid");
  for (const [value, label] of [[receipt.workspace_root, "workspace root"], [receipt.project_root, "project root"], [receipt.git_worktree_root, "Git worktree root"], [receipt.task_checkout, "task checkout"], [receipt.task_worktree, "task worktree"]]) {
    const resolved = canonicalDirectory(value, label);
    assert(resolved === value, `${label} is not canonical in the runtime receipt`);
  }
  assert(withinOrEqual(receipt.workspace_root, receipt.project_root), "project root escapes workspace root", "TASK_WORKSPACE_CUSTODY_ESCAPE");
  assert(withinOrEqual(receipt.workspace_root, receipt.task_checkout), "task checkout escapes workspace root", "TASK_WORKSPACE_CUSTODY_ESCAPE");
  assert(withinOrEqual(receipt.workspace_root, receipt.task_worktree), "task worktree escapes workspace root", "TASK_WORKSPACE_CUSTODY_ESCAPE");
  assert(receipt.containment?.project_root === true && receipt.containment?.task_checkout === true && receipt.containment?.task_worktree === true, "task workspace containment proof is incomplete");
  requireUtc(receipt.observed_at_utc, "task workspace custody observation time");
  assert(/^[0-9a-f]{64}$/u.test(receipt.custody_sha256) && receipt.custody_sha256 === canonicalDigest(digestBody(receipt)), "task workspace custody digest is invalid");
  return receipt;
}

export function isRuntimeTaskWorkspaceCustodyReceipt(value) {
  return Boolean(value?.[RUNTIME_RECEIPT]);
}
