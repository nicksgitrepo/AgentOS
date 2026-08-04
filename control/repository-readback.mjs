#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {compileRepositoryCheckpointProof} from "./campaign-lifecycle.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function canonicalRoot(worktreeRoot) {
  requireString(worktreeRoot, "repository worktree root");
  const resolved = fs.realpathSync.native(path.resolve(worktreeRoot));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "repository worktree root must be a real directory");
  return resolved;
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`repository readback failed for git ${args.join(" ")}: ${detail}`);
  }
}

function optionalGit(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

export function readLocalGitCheckpoint({worktreeRoot, worktreeId, observedByRole, observedBySession, observedAtUtc}) {
  const root = canonicalRoot(worktreeRoot);
  requireString(worktreeId, "repository worktree ID");
  requireString(observedByRole, "repository readback observer role");
  requireString(observedBySession, "repository readback observer session");
  requireUtc(observedAtUtc, "repository readback observation time");
  const commit = git(root, ["rev-parse", "HEAD"]);
  const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  const remoteCommit = optionalGit(root, ["rev-parse", "--verify", "@{upstream}"]);
  const remoteTree = remoteCommit === null ? null : optionalGit(root, ["rev-parse", "@{upstream}^{tree}"]);
  assert(remoteCommit !== null && remoteTree !== null, "repository readback has no readable upstream identity");
  const clean = status.length === 0;
  const pushed = clean && commit === remoteCommit && tree === remoteTree;
  const proof = compileRepositoryCheckpointProof({
    worktreeId,
    commit,
    tree,
    remoteCommit,
    remoteTree,
    clean,
    pushed,
    observedByRole,
    observedBySession,
    observedAtUtc,
    verificationMethod: "GIT_READBACK",
  });
  return {
    schema: "governance.local_git_checkpoint_readback.v1",
    worktree_root: root,
    worktree_id: worktreeId,
    status: pushed ? "CLEAN_PUSHED_REMOTE_EQUAL" : clean ? "CLEAN_NOT_REMOTE_EQUAL" : "DIRTY",
    local: {commit, tree, status_porcelain: status},
    upstream: {commit: remoteCommit, tree: remoteTree},
    proof,
  };
}

