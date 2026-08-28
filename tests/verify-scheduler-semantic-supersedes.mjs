#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileHybridSchedulerRequest,
  opaqueSchedulerWorktreeRef,
} from "../control/hybrid-scheduler.mjs";

const BASE_REQUEST = {
  requesterId: "REQUESTER.SCHEDULER.SEMANTIC",
  lane: "LANE.SCHEDULER.SEMANTIC",
  repositoryId: "AGENTOS_PROJECT",
  worktreeId: "WORKTREE.SCHEDULER.SEMANTIC",
  candidateCommit: "1".repeat(40),
  candidateTreeOrDigest: "2".repeat(40),
  cleanState: true,
  resourceClass: "LIGHTWEIGHT_SOURCE_CHECK",
  workingDirectoryRef: opaqueSchedulerWorktreeRef("/workspace/agentos-scheduler-semantic-test"),
  commandArgv: ["SCHEDULER_SEMANTIC_IDENTITY_CHECK"],
  toolchainProfile: "NODE_HOST",
  proofClass: "POST_COMMIT_AUDIT",
  whyNeeded: "VERIFY_SUCCESSOR_SEMANTIC_IDENTITY",
  expectedProof: "SUCCESSOR_EDGE_IS_SEMANTICALLY_DISTINCT",
  coverage: ["SCHEDULER_SEMANTIC_IDENTITY"],
  dependsOn: [],
  timeoutClass: "BOUNDED",
  cachePolicy: "NO_SHARED_OUTPUT",
  secretPolicy: "REDACTED",
};

function compile(requestId, supersedes = []) {
  return compileHybridSchedulerRequest({
    ...BASE_REQUEST,
    requestId,
    supersedes,
  });
}

const first = compile("SCHEDULER.SEMANTIC.FIRST");
const sameSemanticRetry = compile("SCHEDULER.SEMANTIC.RETRY");
assert.notEqual(first.request_sha256, sameSemanticRetry.request_sha256, "distinct request records must retain distinct request digests");
assert.equal(first.semantic_key, sameSemanticRetry.semantic_key, "same semantic work must remain deduplicated across request IDs");

const successor = compile("SCHEDULER.SEMANTIC.SUCCESSOR", ["SCHEDULER.SEMANTIC.FIRST"]);
assert.notEqual(successor.semantic_key, first.semantic_key, "a superseding successor must not collide with its predecessor");

const multiEdge = compile("SCHEDULER.SEMANTIC.MULTI", ["SCHEDULER.SEMANTIC.FIRST", "SCHEDULER.SEMANTIC.RETRY"]);
const sameMultiEdgeRetry = compile("SCHEDULER.SEMANTIC.MULTI.RETRY", ["SCHEDULER.SEMANTIC.FIRST", "SCHEDULER.SEMANTIC.RETRY"]);
assert.equal(multiEdge.semantic_key, sameMultiEdgeRetry.semantic_key, "the normalized supersedes edge must be stable for equivalent retries");
assert.throws(
  () => compile("SCHEDULER.SEMANTIC.UNSORTED", ["SCHEDULER.SEMANTIC.RETRY", "SCHEDULER.SEMANTIC.FIRST"]),
  /scheduler superseded requests must be sorted/u,
  "hostile unsorted supersedes input must be rejected",
);

console.log("PASS scheduler semantic supersedes: successor separation, same-request semantic deduplication, normalized edge stability, and hostile ordering rejection");
