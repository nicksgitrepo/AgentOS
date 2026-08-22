#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {realpathSync, lstatSync} from "node:fs";
import {basename, dirname, isAbsolute, relative, resolve} from "node:path";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const SPAWNER_GIT_ANCESTRY_SCHEMA = "agentos.spawner_git_ancestry.v1";
export const SPAWNER_RUNTIME_CUSTODY_SCHEMA = "agentos.spawner_runtime_custody.v1";
const GIT = /^[0-9a-f]{40}$/u;
function fail(message, code = "SPAWNER_GIT_ANCESTRY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function run(root, args) { return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(); }
function gitObject(value, label) { if (typeof value !== "string" || !GIT.test(value)) fail(`${label} must be an exact Git object`); }
function body(value) { return {...structuredClone(value), ancestry_sha256: null}; }

function canonicalDirectory(value, label) {
  if (typeof value !== "string" || !isAbsolute(value)) fail(`${label} must be an absolute runtime path`, "SPAWNER_WORKSPACE_CUSTODY_INVALID");
  let absolute;
  try {
    absolute = resolve(value);
    const initial = lstatSync(absolute);
    if (initial.isSymbolicLink()) fail(`${label} must not be a symbolic link`, "SPAWNER_WORKSPACE_CUSTODY_INVALID");
    const real = realpathSync.native(absolute);
    const stat = lstatSync(real);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory`, "SPAWNER_WORKSPACE_CUSTODY_INVALID");
    return real;
  } catch (error) {
    if (error?.code?.startsWith?.("SPAWNER_")) throw error;
    fail(`${label} is unavailable`, "SPAWNER_WORKSPACE_CUSTODY_INVALID");
  }
}

function gitRoot(value, label) {
  const root = canonicalDirectory(value, label);
  try {
    const resolved = realpathSync.native(run(root, ["rev-parse", "--show-toplevel"]));
    if (resolved !== root) fail(`${label} is not the active Git worktree root`, "SPAWNER_WORKSPACE_CUSTODY_INVALID");
    return resolved;
  } catch (error) {
    if (error?.code?.startsWith?.("SPAWNER_")) throw error;
    fail(`${label} is not an active Git worktree`, "SPAWNER_WORKSPACE_CUSTODY_INVALID");
  }
}

function within(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function discoverWorkspaceRoot(activeWorktree) {
  const configured = process.env.AGENTOS_PROJECTS_WORKSPACE_ROOT;
  if (configured !== undefined && configured.trim().length > 0) return configured;
  let cursor = dirname(activeWorktree);
  while (cursor !== dirname(cursor)) {
    if (basename(cursor) === "Projects") return cursor;
    cursor = dirname(cursor);
  }
  return dirname(activeWorktree);
}

function custodyBody(receipt) { return {...structuredClone(receipt), custody_sha256: null}; }

/**
 * Resolve task custody from the active runtime context. Absolute paths are
 * accepted only at this boundary and are returned in this runtime receipt;
 * callers must persist only the receipt digest and opaque references.
 */
export function resolveSpawnerRuntimeCustody({projectRoot = null, repositoryRoot = null, taskWorktreePath = null, workspaceRoot = null} = {}) {
  const activeContext = projectRoot ?? repositoryRoot ?? process.cwd();
  const activeWorktree = gitRoot(activeContext, "active project context");
  const repository = gitRoot(repositoryRoot ?? activeWorktree, "repository root");
  const configuredWorkspaceRoot = workspaceRoot ?? (process.env.AGENTOS_PROJECTS_WORKSPACE_ROOT?.trim?.() ? process.env.AGENTOS_PROJECTS_WORKSPACE_ROOT : null);
  const workspace = canonicalDirectory(workspaceRoot ?? discoverWorkspaceRoot(activeWorktree), "workspace root");
  const taskWorktree = gitRoot(taskWorktreePath ?? repository, "task worktree");
  if (!within(workspace, repository)) fail("repository root escapes the configured workspace root", "SPAWNER_WORKSPACE_CUSTODY_INVALID");
  if (!within(workspace, taskWorktree)) fail("task worktree escapes the configured workspace root", "SPAWNER_WORKSPACE_CUSTODY_INVALID");
  const receipt = {
    schema: SPAWNER_RUNTIME_CUSTODY_SCHEMA,
    version: 1,
    status: "RUNTIME_CUSTODY_RESOLVED",
    resolution_source: configuredWorkspaceRoot === null && workspace === resolve(dirname(activeWorktree))
      ? "ACTIVE_GIT_WORKTREE_PARENT"
      : "ACTIVE_RUNTIME_CONTEXT",
    workspace_root: workspace,
    repository_root: repository,
    task_worktree: taskWorktree,
    repository_within_workspace: true,
    task_worktree_within_workspace: true,
    custody_sha256: null,
  };
  receipt.custody_sha256 = canonicalDigest(custodyBody(receipt));
  return Object.freeze(receipt);
}

export function validateSpawnerRuntimeCustody(receipt, options = {}) {
  if (!receipt || receipt.schema !== SPAWNER_RUNTIME_CUSTODY_SCHEMA || receipt.version !== 1) {
    fail("runtime custody receipt identity is invalid", "SPAWNER_WORKSPACE_CUSTODY_INVALID");
  }
  const current = resolveSpawnerRuntimeCustody({
    projectRoot: options.projectRoot ?? receipt.repository_root,
    repositoryRoot: options.repositoryRoot ?? receipt.repository_root,
    taskWorktreePath: options.taskWorktreePath ?? receipt.task_worktree,
    workspaceRoot: options.workspaceRoot ?? receipt.workspace_root,
  });
  if (canonicalDigest(receipt) !== canonicalDigest(current)) fail("runtime custody receipt is stale or substituted", "SPAWNER_WORKSPACE_CUSTODY_INVALID");
  return receipt;
}

export function resolveSpawnerGitAncestry({repositoryRoot, candidateCommit, authorizedPredecessor} = {}) {
  if (typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) fail("repository root must be absolute");
  const root = realpathSync.native(repositoryRoot);
  if (!lstatSync(root).isDirectory()) fail("repository root must be a real directory");
  gitObject(candidateCommit, "candidate commit"); gitObject(authorizedPredecessor, "authorized predecessor");
  const resolvedCandidate = run(root, ["rev-parse", `${candidateCommit}^{commit}`]);
  const resolvedPredecessor = run(root, ["rev-parse", `${authorizedPredecessor}^{commit}`]);
  if (resolvedCandidate !== candidateCommit || resolvedPredecessor !== authorizedPredecessor) fail("abbreviated or substituted Git identity is forbidden");
  const tree = run(root, ["rev-parse", `${candidateCommit}^{tree}`]);
  const parentLine = run(root, ["rev-list", "--parents", "-n", "1", candidateCommit]).split(/\s+/u);
  const parents = parentLine.slice(1);
  if (run(root, ["merge-base", candidateCommit, authorizedPredecessor]) !== authorizedPredecessor) fail("authorized predecessor is not an ancestor", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  const ancestryPath = run(root, ["rev-list", "--reverse", "--ancestry-path", `${authorizedPredecessor}..${candidateCommit}`]).split("\n").filter(Boolean);
  if (ancestryPath.at(-1) !== candidateCommit) fail("candidate ancestry path is incomplete", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  const receipt = {schema: SPAWNER_GIT_ANCESTRY_SCHEMA, version: 1, candidate_commit: candidateCommit, candidate_tree: tree, direct_parent_commits: [...parents].sort(compareUtf8), authorized_predecessor_commit: authorizedPredecessor, merge_base_commit: authorizedPredecessor, ancestry_path: ancestryPath, interposed_commits: ancestryPath.slice(0, -1), ancestry_sha256: null};
  receipt.ancestry_sha256 = canonicalDigest(body(receipt));
  return Object.freeze(receipt);
}

export function validateSpawnerGitAncestry(receipt, {repositoryRoot} = {}) {
  const current = resolveSpawnerGitAncestry({repositoryRoot, candidateCommit: receipt?.candidate_commit, authorizedPredecessor: receipt?.authorized_predecessor_commit});
  if (canonicalDigest(receipt) !== canonicalDigest(current)) fail("reported ancestry omits or substitutes actual Git history", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  return receipt;
}
