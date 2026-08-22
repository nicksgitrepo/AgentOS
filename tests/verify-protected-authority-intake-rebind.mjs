#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertExactArtifactBinding,
  assertExactCandidateBinding,
  compileProtectedAuthorityInvalidation,
  compileProtectedAuthorityQueueReceipt,
  compileProtectedAuthorityRosterForCurrentCandidate,
  PROTECTED_AUTHORITY_PREREQUISITES,
  runProtectedAuthorityIntakeRebind,
  validateProtectedAuthorityQueueReceipt,
} from "../control/protected-authority-intake-rebind.mjs";

const root = fs.realpathSync(process.cwd());
const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const gitObject = "0123456789abcdef0123456789abcdef0123456789abcdef".slice(0, 40);

const blocked = runProtectedAuthorityIntakeRebind({writeQueueReceipt: false});
assert.equal(blocked.status, "BLOCKED_EXACT");
assert.equal(blocked.readiness_claimed, false);
assert.equal(blocked.intake.model_policy.status, "BLOCKED_EXACT");
assert.equal(blocked.intake.model_policy.code, "POLICY_SNAPSHOT_STALE");
assert.equal(blocked.intake.evaluator_handoff.status, "BLOCKED_EXACT");
assert.equal(blocked.intake.evaluator_handoff.code, "CANONICAL_EVALUATOR_HANDOFF_REQUIRED");
assert.equal(blocked.roster.status, "NOT_COMPILED_PROTECTED_BLOCK");
assert.equal(blocked.invalidation.status, "NOT_EXECUTED_PROTECTED_BLOCK");
assert.deepEqual(
  blocked.blocked_prerequisite_queue.map((entry) => entry.prerequisite_id),
  [...PROTECTED_AUTHORITY_PREREQUISITES],
  "blocked prerequisite queue omitted a required governance/roster prerequisite",
);
assert(blocked.blocked_prerequisite_queue.every((entry) => entry.status !== "PASS"));
assert(Object.values(blocked.external_side_effects).every((value) => value === 0));
assert.equal(blocked.result_sha256.length, 64);

const queue = compileProtectedAuthorityQueueReceipt({result: blocked});
validateProtectedAuthorityQueueReceipt(queue);
assert.equal(queue.status, "BLOCKED_EXACT");
assert.equal(queue.candidate.commit, blocked.candidate.commit);
assert.equal(queue.side_effects.audit_requests, 0);
assert.deepEqual(
  queue.blocked_prerequisite_queue.map((entry) => entry.prerequisite_id),
  [...PROTECTED_AUTHORITY_PREREQUISITES],
);
assert.equal(queue.queue_sha256, queue.queue_sha256.toLowerCase());
assert.equal(queue.queue_sha256.length, 64);

const firstQueueWrite = runProtectedAuthorityIntakeRebind({writeQueueReceipt: true});
assert(firstQueueWrite.queue_receipt.status === "WRITTEN" || firstQueueWrite.queue_receipt.status === "IDEMPOTENT_REPLAY");
const replayQueueWrite = runProtectedAuthorityIntakeRebind({writeQueueReceipt: true});
assert.equal(replayQueueWrite.queue_receipt.status, "IDEMPOTENT_REPLAY", "replaying the same exact blocked candidate must be idempotent");
assert.equal(replayQueueWrite.queue_receipt.queue_sha256, firstQueueWrite.queue_receipt.queue_sha256);

const deterministicRosterA = compileProtectedAuthorityRosterForCurrentCandidate();
const deterministicRosterB = compileProtectedAuthorityRosterForCurrentCandidate();
assert.equal(deterministicRosterA.status, "PASS");
assert.deepEqual(deterministicRosterA, deterministicRosterB, "roster projection changed across identical reads");

assert.throws(() => assertExactCandidateBinding({
  candidate: {commit: gitObject, tree: gitObject},
  expectedCandidate: {commit: "abcdefabcdefabcdefabcdefabcdefabcdefabcd", tree: gitObject},
}), /diverges from the current exact candidate/u);
const otherDigest = "abcdef".repeat(10) + "abcd";
assert.throws(() => assertExactArtifactBinding({actualSha256: digest, expectedSha256: otherDigest, label: "model-policy"}), /diverges from the sealed current binding/u);

const partialBindings = {
  MODEL_ROUTES: {snapshot_sha256: digest, binding_sha256: null},
  OPERATIONAL_CONTEXTS: {snapshot_sha256: digest, binding_sha256: null},
  GLOBAL_GOVERNANCE_MEMORY: {snapshot_sha256: digest, binding_sha256: null},
};
assert.throws(() => compileProtectedAuthorityInvalidation({successorSnapshotSha256: digest, successorRosterSha256: digest, previousBindings: partialBindings}), /fields differ/u);

const prior = Object.fromEntries(["MODEL_ROUTES", "OPERATIONAL_CONTEXTS", "GLOBAL_GOVERNANCE_MEMORY", "REUSABLE_AGENT_ROSTER"].map((kind) => [kind, {snapshot_sha256: otherDigest, binding_sha256: null}]));
const invalidation = compileProtectedAuthorityInvalidation({successorSnapshotSha256: digest, successorRosterSha256: digest, previousBindings: prior});
assert.equal(invalidation.status, "INVALIDATION_PLAN_COMPILED");
assert.equal(invalidation.rebind_required, true);
assert.deepEqual(invalidation.dependent_kinds, ["MODEL_ROUTES", "OPERATIONAL_CONTEXTS", "GLOBAL_GOVERNANCE_MEMORY", "REUSABLE_AGENT_ROSTER"]);
assert(invalidation.dependents.every((entry) => entry.disposition === "INVALIDATED_PENDING_REBUILD"));
assert(Object.values(invalidation.external_side_effects).every((value) => value === 0));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-protected-authority-custody-"));
const projectsRoot = path.join(tempRoot, "Projects");
const taskRoot = path.join(projectsRoot, "task");
const outsideRoot = path.join(tempRoot, "outside");
fs.mkdirSync(taskRoot, {recursive: true});
fs.mkdirSync(outsideRoot, {recursive: true});
try {
  const custodyModule = await import("../control/protected-authority-intake-rebind.mjs");
  assert.equal(custodyModule.__testOnlyResolveWorkspaceDescendant, undefined, "private custody helper leaked through a test hook");
  const canonicalProjectsRoot = fs.realpathSync(projectsRoot);
  const canonicalTaskRoot = fs.realpathSync(taskRoot);
  const canonicalOutsideRoot = fs.realpathSync(outsideRoot);
  assert.equal(canonicalTaskRoot.startsWith(`${canonicalProjectsRoot}${path.sep}`), true);
  assert.throws(() => custodyModule.assertWorkspaceDescendant({projectsRoot: canonicalProjectsRoot, taskRoot: canonicalOutsideRoot}), /outside the runtime Projects workspace/u);
  const symlinkRoot = path.join(projectsRoot, "symlink-task");
  fs.symlinkSync(outsideRoot, symlinkRoot, "dir");
  assert.throws(() => custodyModule.assertWorkspaceDescendant({projectsRoot: canonicalProjectsRoot, taskRoot: symlinkRoot}), /real non-symlink directory/u);
  assert.throws(() => custodyModule.assertWorkspaceDescendant({projectsRoot: canonicalProjectsRoot, taskRoot: "relative-task"}), /absolute path/u);
} finally {
  fs.rmSync(tempRoot, {recursive: true, force: true});
}

const contract = JSON.parse(fs.readFileSync(path.join(root, "schemas/protected-authority-intake-rebind.v1.json"), "utf8"));
assert.equal(contract.$id, "agentos.protected_authority_intake_rebind.v1");
assert(!JSON.stringify(contract).match(/(?:\/Users\/|\/home\/|~\/|[A-Za-z]:\\)/u), "portable contract contains a personal path literal");
assert(!JSON.stringify(blocked).match(/(?:\/Users\/|\/home\/|~\/|[A-Za-z]:\\)/u), "portable intake result contains a personal path literal");

console.log("PASS protected-authority intake/rebind: exact stale/missing blockers, diverged bindings, partial invalidation, deterministic roster projection, portable custody escape/symlink/relative-root hostiles, and zero side effects");
