#!/usr/bin/env node

import assert from "node:assert/strict";
import {resolve} from "node:path";
import {resolveSpawnerGitAncestry, validateSpawnerGitAncestry} from "../control/spawner-git-ancestry.mjs";

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
console.log("PASS Spawner Git ancestry: parents, merge-base, full ancestry path, and interposed commits are independently resolved and false direct-parent claims fail closed");
