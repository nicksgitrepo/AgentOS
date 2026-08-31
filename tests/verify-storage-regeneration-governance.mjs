#!/usr/bin/env node
import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  STORAGE_REGENERATION_HOSTILE_CASES,
  compileCacheIdentity,
  compileDisposableOutputManifest,
  compileGeneratedTempCloseout,
  compilePostDeliveryCleanup,
  compileSharedDependencyCustody,
  compileStorageDailyInspection,
  compileStorageRegenerationCycle,
  compileStorageRegenerationGovernance,
  validateCacheIdentity,
  validateDisposableOutputManifest,
  validateGeneratedTempCloseout,
  validatePostDeliveryCleanup,
  validateSharedDependencyCustody,
  validateStorageDailyInspection,
  validateStorageRegenerationCycle,
  validateStorageRegenerationGovernance,
} from "../control/storage-regeneration-governance.mjs";

const at = "2026-08-31T12:00:00.000Z";
const later = "2026-09-01T12:00:00.000Z";
const issue = "AGENTOS-ISSUE-2026-1175";
const owner = "AGENTOS.STORAGE.REGENERATION";
const root = "/Users/nicholaspacheco/Projects/AgentOS/Temp/storage-regen-1175";
const commit = "1".repeat(40);
const tree = "2".repeat(40);

const governance = compileStorageRegenerationGovernance({authorityId: owner, owner: "CONTROLLER", observedAtUtc: at});
assert.equal(validateStorageRegenerationGovernance(governance).governance_sha256, governance.governance_sha256);
assert.deepEqual(governance.hostile_cases, [...STORAGE_REGENERATION_HOSTILE_CASES].sort());

const closeout = compileGeneratedTempCloseout({
  issueId: issue,
  ownerTaskId: "TASK.STORAGE.REGEN.1175",
  generatorId: "GENERATOR.STORAGE.1175",
  generation: 1,
  operationRoot: root,
  rootPath: `${root}/GENERATOR.STORAGE.1175-1`,
  outcome: "PASS",
  durableReceiptPaths: ["receipts/generator.json"],
  observedAtUtc: at,
});
assert.equal(validateGeneratedTempCloseout(closeout).removed, true);
const failedCloseout = compileGeneratedTempCloseout({...{
  issueId: issue,
  ownerTaskId: "TASK.STORAGE.REGEN.1175",
  generatorId: "GENERATOR.STORAGE.1175",
  generation: 2,
  operationRoot: root,
  rootPath: `${root}/GENERATOR.STORAGE.1175-2`,
  outcome: "FAIL",
  durableReceiptPaths: [],
  observedAtUtc: at,
}});
assert.equal(failedCloseout.outcome, "FAIL");
assert.throws(() => compileGeneratedTempCloseout({
  issueId: issue, ownerTaskId: "TASK.STORAGE.REGEN.1175", generatorId: "GENERATOR.STORAGE.1175", generation: 3,
  operationRoot: root, rootPath: `${root}/shared`, outcome: "PASS", durableReceiptPaths: [], observedAtUtc: at,
}), /SHARED_TEMP_FORBIDDEN/u);
assert.throws(() => compileGeneratedTempCloseout({
  issueId: issue, ownerTaskId: "TASK.STORAGE.REGEN.1175", generatorId: "GENERATOR.STORAGE.1175", generation: 3,
  operationRoot: root, rootPath: "/Users/nicholaspacheco/Projects/AgentOS/Temp/other/GENERATOR.STORAGE.1175-3", outcome: "PASS", durableReceiptPaths: [], observedAtUtc: at,
}), /PATH_OUTSIDE_ROOT/u);

const manifest = compileDisposableOutputManifest({
  issueId: issue,
  ownerTaskId: "TASK.STORAGE.REGEN.1175",
  operationId: "OP.STORAGE.REGEN.1175",
  operationRoot: root,
  outputs: [
    {issue_id: issue, path: "build/obj.bin", kind: "BUILD_OUTPUT", lifecycle_class: "REGENERABLE", bytes: 12, fingerprint: "fp-build"},
    {issue_id: issue, path: "deps/lock-cache", kind: "DEPENDENCY_COPY", lifecycle_class: "REGENERABLE", bytes: 7, fingerprint: "fp-deps"},
  ],
  deliveryVerified: true,
  deliveryReceiptSha256: "a".repeat(64),
  candidateCommit: commit,
  candidateTree: tree,
  observedAtUtc: at,
});
assert.equal(validateDisposableOutputManifest(manifest).entries.length, 2);
assert.throws(() => compileDisposableOutputManifest({
  issueId: issue, ownerTaskId: "TASK.STORAGE.REGEN.1175", operationId: "OP.STORAGE.BAD", operationRoot: root,
  outputs: [{path: "build/obj.bin", kind: "BUILD_OUTPUT", lifecycle_class: "REGENERABLE", bytes: 1}], deliveryVerified: true,
  candidateCommit: commit, candidateTree: tree, observedAtUtc: at,
}), /MANIFEST_ISSUE_MISMATCH/u);
assert.throws(() => compileDisposableOutputManifest({
  issueId: issue, ownerTaskId: "TASK.STORAGE.REGEN.1175", operationId: "OP.STORAGE.BAD", operationRoot: root,
  outputs: [{issue_id: issue, path: "build/*.bin", kind: "BUILD_OUTPUT", lifecycle_class: "REGENERABLE", bytes: 1}], deliveryVerified: true,
  candidateCommit: commit, candidateTree: tree, observedAtUtc: at,
}), /BROAD_PATH_FORBIDDEN/u);
assert.throws(() => compileDisposableOutputManifest({
  issueId: issue, ownerTaskId: "TASK.STORAGE.REGEN.1175", operationId: "OP.STORAGE.BAD", operationRoot: root,
  outputs: [{issue_id: issue, path: "state.db", kind: "RUNTIME_STATE", lifecycle_class: "RUNTIME_STATE", bytes: 1}], deliveryVerified: true,
  candidateCommit: commit, candidateTree: tree, observedAtUtc: at,
}), /PROTECTED_DATA/u);

const delivery = {
  status: "DELIVERED_VERIFIED",
  independent_pass: true,
  identical_bytes: true,
  local_commit: commit,
  origin_commit: commit,
  github_commit: commit,
  local_tree: tree,
  origin_tree: tree,
  github_tree: tree,
};
const cleanup = compilePostDeliveryCleanup({manifest, delivery, issueId: issue, candidateCommit: commit, candidateTree: tree, observedAtUtc: later});
assert.equal(validatePostDeliveryCleanup(cleanup, {manifest, delivery}).cleanup_allowed, true);
const unverifiedManifest = {...manifest, delivery_verified: false, cleanup_action: "HOLD_UNTIL_DELIVERY_VERIFIED", manifest_sha256: null};
unverifiedManifest.manifest_sha256 = canonicalDigest({...unverifiedManifest, manifest_sha256: null});
assert.throws(() => compilePostDeliveryCleanup({manifest: unverifiedManifest, delivery, issueId: issue, observedAtUtc: later}), /DELIVERY_NOT_VERIFIED/u);
assert.throws(() => compilePostDeliveryCleanup({manifest, delivery: {...delivery, github_tree: "3".repeat(40)}, issueId: issue, observedAtUtc: later}), /IDENTITY_MISMATCH/u);

const cache = compileCacheIdentity({cacheId: "CACHE.CARGO.SHARED", owner, lastUseUtc: at, sizeCeilingBytes: 1000, expiryUtc: later, contentIdentity: "cargo-lock-fp", shared: true, consumers: [issue], observedAtUtc: at});
assert.equal(validateCacheIdentity(cache).size_ceiling_bytes, 1000);
assert.throws(() => compileCacheIdentity({cacheId: "CACHE.BAD", owner, lastUseUtc: at, expiryUtc: later, contentIdentity: "fp", shared: false, consumers: [], observedAtUtc: at}), /size ceiling/u);

const shared = compileSharedDependencyCustody({dependencyId: "DEP.OT.SPINE", rootPath: "shared/ot-spine", contentIdentity: "dep-sha", compatibleIdentity: "lock-v1", owner, consumers: [issue], liveConsumers: [issue], issueRefs: [issue], observedAtUtc: at});
assert.equal(validateSharedDependencyCustody(shared).live_consumers.length, 1);
assert.throws(() => compileSharedDependencyCustody({dependencyId: "DEP.BAD", rootPath: "shared/bad", contentIdentity: "dep-sha", compatibleIdentity: "lock-v1", owner, consumers: [issue], liveConsumers: [issue], issueRefs: [issue], releaseRequested: true, releaseReceiptSha256: "b".repeat(64), observedAtUtc: at}), /LIVE_CONSUMER/u);
assert.throws(() => {
  const duplicate = {...shared, dependency_id: "DEP.OT.SPINE-2", custody_sha256: shared.custody_sha256};
  validateSharedDependencyCustody(duplicate);
}, /custody digest mismatch/u);

const cycle1 = compileStorageRegenerationCycle({cycleId: "CYCLE.1", sourceClass: "SHARED_CARGO_TARGET", laneId: "LANE.1", generation: 1, rootIdentity: "ROOT.CARGO.1", observedAtUtc: at, outputBytes: 10, cleanupVerified: true, priorCleanup: true, priorCycles: [], sourceStateSha256: "c".repeat(64)});
const cycle2 = compileStorageRegenerationCycle({cycleId: "CYCLE.2", sourceClass: "SHARED_CARGO_TARGET", laneId: "LANE.1", generation: 1, rootIdentity: "ROOT.CARGO.1", observedAtUtc: later, outputBytes: 10, cleanupVerified: false, priorCleanup: true, priorCycles: [cycle1], sourceStateSha256: "d".repeat(64)});
assert.equal(cycle2.recurrence_detected, true);
assert.equal(validateStorageRegenerationCycle(cycle2).recurrence_detected, true);
const daily = compileStorageDailyInspection({inspectionId: "INSPECT.1", controllerId: "CONTROLLER.STORAGE", observedAtUtc: later, cycles: [cycle2], priorInspection: null, protectedBytes: 42, regeneratedBytes: 10, deletionAttempts: 0, previousCleanupCycle: cycle1});
assert.equal(validateStorageDailyInspection(daily).deletion_execution_authorized, false);
assert.equal(daily.recurrence_detected, true);

console.log("PASS storage regeneration recurrence governance: owned temp closeout, issue-bound manifests, verified delivery cleanup, cache/dependency custody, recurrence detection, protected-class denials, and hostile coverage");
