#!/usr/bin/env node

import assert from "node:assert/strict";
import {dirname, resolve} from "node:path";
import {resolveSpawnerGitAncestry, resolveSpawnerRuntimeCustody, validateSpawnerGitAncestry, validateSpawnerRuntimeCustody} from "../control/spawner-git-ancestry.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const candidate = "b6d52608984cd330dee52f1068827ccd312ac7b5";
const predecessor = "7da8ea556073ff593bf96e95854efa08240b661b";
const receipt = resolveSpawnerGitAncestry({repositoryRoot: root, candidateCommit: candidate, authorizedPredecessor: predecessor});
assert.deepEqual(receipt.direct_parent_commits, ["b3163428a5dfdced9009d0f6f2920653463dc623"]);
assert.deepEqual(receipt.ancestry_path, ["b3163428a5dfdced9009d0f6f2920653463dc623", candidate]);
assert.deepEqual(receipt.interposed_commits, ["b3163428a5dfdced9009d0f6f2920653463dc623"]);
assert.doesNotThrow(() => validateSpawnerGitAncestry(receipt, {repositoryRoot: root}));
const omitted = structuredClone(receipt); omitted.direct_parent_commits = [predecessor];
assert.throws(() => validateSpawnerGitAncestry(omitted, {repositoryRoot: root}), /omits|substitutes|chain/iu);
const narrowed = structuredClone(receipt); narrowed.ancestry_path = [candidate];
assert.throws(() => validateSpawnerGitAncestry(narrowed, {repositoryRoot: root}), /omits|substitutes|chain/iu);
const workspaceRoot = dirname(root);
const discovered = resolveSpawnerRuntimeCustody({projectRoot: root});
assert.equal(discovered.workspace_root, workspaceRoot);
assert.equal(discovered.resolution_source, "ACTIVE_GIT_WORKTREE_PARENT");
const custody = resolveSpawnerRuntimeCustody({repositoryRoot: root, workspaceRoot});
assert.equal(custody.workspace_root, workspaceRoot);
assert.equal(custody.repository_root, root);
assert.equal(custody.task_worktree, root);
assert.equal(custody.repository_within_workspace, true);
assert.equal(custody.task_worktree_within_workspace, true);
assert.doesNotThrow(() => validateSpawnerRuntimeCustody(custody, {repositoryRoot: root, workspaceRoot}));
assert.throws(
  () => resolveSpawnerRuntimeCustody({repositoryRoot: root, taskWorktreePath: dirname(workspaceRoot), workspaceRoot}),
  (error) => error.code === "SPAWNER_WORKSPACE_CUSTODY_INVALID",
);
const substituted = structuredClone(custody); substituted.task_worktree = root;
substituted.custody_sha256 = "0".repeat(64);
assert.throws(() => validateSpawnerRuntimeCustody(substituted, {repositoryRoot: root, workspaceRoot}), /stale|substituted|custody/iu);
console.log("PASS Spawner Git ancestry: parents, merge-base, full ancestry path, and interposed commits are independently resolved and false direct-parent claims fail closed");
