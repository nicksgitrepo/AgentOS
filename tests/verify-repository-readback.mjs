#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {readLocalGitCheckpoint} from "../control/campaign-controller.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-repository-readback-"));
const worktree = path.join(root, "worktree");
const remote = path.join(root, "remote.git");
fs.mkdirSync(worktree);
const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
git(worktree, ["init", "-b", "main"]);
git(worktree, ["config", "user.email", "agentos@example.invalid"]);
git(worktree, ["config", "user.name", "AgentOS Synthetic"]);
fs.writeFileSync(path.join(worktree, "README.md"), "synthetic\n");
git(worktree, ["add", "README.md"]);
git(worktree, ["commit", "-m", "synthetic"]);
git(root, ["init", "--bare", remote]);
git(worktree, ["remote", "add", "origin", remote]);
git(worktree, ["push", "-u", "origin", "main"]);

try {
  const clean = readLocalGitCheckpoint({
    worktreeRoot: worktree,
    worktreeId: "SYNTHETIC-WORKTREE",
    observedByRole: "READBACK_ADAPTER",
    observedBySession: "READBACK-SESSION",
    observedAtUtc: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(clean.status, "CLEAN_PUSHED_REMOTE_EQUAL");
  assert.equal(clean.proof.clean, true);
  assert.equal(clean.proof.pushed, true);
  assert.equal(clean.proof.commit, clean.proof.remote_commit);
  fs.writeFileSync(path.join(worktree, "untracked.txt"), "dirty\n");
  const dirty = readLocalGitCheckpoint({
    worktreeRoot: worktree,
    worktreeId: "SYNTHETIC-WORKTREE",
    observedByRole: "READBACK_ADAPTER",
    observedBySession: "READBACK-SESSION-2",
    observedAtUtc: "2026-08-03T00:01:00.000Z",
  });
  assert.equal(dirty.status, "DIRTY");
  assert.equal(dirty.proof.clean, false);
  assert.equal(dirty.proof.pushed, false);
  assert.throws(() => readLocalGitCheckpoint({
    worktreeRoot: worktree,
    worktreeId: "SYNTHETIC-WORKTREE",
    observedByRole: "READBACK_ADAPTER",
    observedBySession: "READBACK-SESSION-3",
    observedAtUtc: "not-utc",
  }), /UTC/u);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS AgentOS local repository readback: real Git cleanliness, upstream equality, and hostile observation boundary verified");

