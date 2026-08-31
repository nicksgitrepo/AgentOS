#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  STORAGE_REGENERATION_HOSTILE_CASES,
  compileCacheIdentity,
  compileDisposableOutputManifest,
  compileGeneratedTempCloseout,
  withOwnedTempRoot,
  compilePostDeliveryCleanup,
  compileRetainedDeliveredWorktreeCloseout,
  compileFleetReplayCustody,
  compileRuntimePostgresqlCustody,
  compileStorageSessionRollover,
  compileSharedTargetPruneDecision,
  compileSharedDependencyCustody,
  compileStorageDailyInspection,
  compileStorageRegenerationCycle,
  compileStorageRegenerationGovernance,
  validateCacheIdentity,
  validateDisposableOutputManifest,
  validateGeneratedTempCloseout,
  validatePostDeliveryCleanup,
  validateRetainedDeliveredWorktreeCloseout,
  validateFleetReplayCustody,
  validateRuntimePostgresqlCustody,
  validateStorageSessionRollover,
  validateSharedTargetPruneDecision,
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

const tempOperationRoot = path.join("/Users/nicholaspacheco/Projects/AgentOS/Temp", "storage-regen-governance-test");
fs.mkdirSync(tempOperationRoot, {recursive: true});
const owned = withOwnedTempRoot({
  issueId: issue,
  ownerTaskId: "TASK.STORAGE.REGEN.1175",
  generatorId: "GENERATOR.STORAGE.1175",
  generation: 1,
  operationRoot: tempOperationRoot,
  durableReceiptPaths: ["receipts/generator.json"],
  observedAtUtc: at,
  work: (rootPath) => {
    fs.writeFileSync(path.join(rootPath, "output.bin"), "regenerable\n");
    return "generated";
  },
});
assert.equal(owned.value, "generated");
assert.equal(validateGeneratedTempCloseout(owned.closeout).removed, true);
assert.equal(fs.existsSync(owned.closeout.root_path), false);
let failedOwned;
try {
  withOwnedTempRoot({
    issueId: issue,
    ownerTaskId: "TASK.STORAGE.REGEN.1175",
    generatorId: "GENERATOR.STORAGE.1175",
    generation: 2,
    operationRoot: tempOperationRoot,
    observedAtUtc: at,
    work: () => { throw new Error("expected fixture failure"); },
  });
} catch (error) {
  failedOwned = error;
}
assert.ok(failedOwned?.closeout);
assert.equal(failedOwned.closeout.outcome, "FAIL");
assert.equal(fs.existsSync(failedOwned.closeout.root_path), false);
assert.throws(() => compileGeneratedTempCloseout({issueId: issue, ownerTaskId: "TASK.STORAGE.REGEN.1175", generatorId: "GENERATOR.STORAGE.1175", generation: 1, operationRoot: "/tmp/not-agentos-temp", rootPath: "/tmp/not-agentos-temp/GENERATOR.STORAGE.1175-1", observedAtUtc: at}), /PATH_OUTSIDE_ROOT/u);

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
assert.throws(() => compileCacheIdentity({cacheId: "CACHE.RELEASE.MISSING", owner, lastUseUtc: at, sizeCeilingBytes: 1000, expiryUtc: later, contentIdentity: "fp", shared: true, consumers: [], releaseRequested: true, observedAtUtc: at}), /CACHE_RELEASE_METADATA_REQUIRED/u);
const releasedCache = compileCacheIdentity({cacheId: "CACHE.RELEASED", owner, lastUseUtc: at, sizeCeilingBytes: 1000, expiryUtc: later, contentIdentity: "fp", shared: true, consumers: [], releaseRequested: true, releaseReceiptSha256: "b".repeat(64), observedAtUtc: at});
assert.equal(validateCacheIdentity(releasedCache).release_requested, true);
assert.throws(() => compileCacheIdentity({cacheId: "CACHE.LANE.LOCAL", owner, lastUseUtc: at, sizeCeilingBytes: 1000, expiryUtc: later, contentIdentity: "fp", shared: false, consumers: [], laneLocal: true, compatibleSharedExists: true, observedAtUtc: at}), /LANE_LOCAL_CACHE/u);

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
const unchanged = compileStorageDailyInspection({inspectionId: "INSPECT.2", controllerId: "CONTROLLER.STORAGE", observedAtUtc: later, cycles: [], pollKey: "POLL.2", previousPollKey: "POLL.1", deltaReceiptSha256: "c".repeat(64), unchangedObservation: true, fullEvidence: false});
assert.equal(validateStorageDailyInspection(unchanged).deduplicated, true);
assert.throws(() => compileStorageDailyInspection({inspectionId: "INSPECT.BAD.POLL", controllerId: "CONTROLLER.STORAGE", observedAtUtc: later, cycles: [], pollKey: "POLL.1", previousPollKey: "POLL.1", unchangedObservation: true, deltaReceiptSha256: "c".repeat(64)}), /POLLING_LOOP/u);
assert.throws(() => compileStorageDailyInspection({inspectionId: "INSPECT.BAD.DELTA", controllerId: "CONTROLLER.STORAGE", observedAtUtc: later, cycles: [], pollKey: "POLL.3", previousPollKey: "POLL.2", unchangedObservation: true}), /POLLING_LOOP/u);

const retained = compileRetainedDeliveredWorktreeCloseout({worktreeId: "WORKTREE.STORAGE.1175", issueId: issue, delivery, custodyReleased: true, retainedPaths: ["README.md"], observedAtUtc: later});
assert.equal(validateRetainedDeliveredWorktreeCloseout(retained, {delivery}).disposable_output_clear, true);
assert.throws(() => compileRetainedDeliveredWorktreeCloseout({worktreeId: "WORKTREE.BAD", issueId: issue, delivery, custodyReleased: true, dependencyPaths: ["node_modules"], observedAtUtc: later}), /RETAINED_OUTPUT/u);

const fleet = compileFleetReplayCustody({laneId: "LANE.FLEET.1", generation: 1, rootIdentity: "ROOT.FLEET.1", rootPath: "fleet/root-1", owner, observedAtUtc: at});
assert.equal(validateFleetReplayCustody(fleet).status, "ACTIVE");
assert.throws(() => compileFleetReplayCustody({laneId: "LANE.FLEET.1", generation: 1, rootIdentity: "ROOT.FLEET.2", rootPath: "fleet/root-2", existingRoots: [fleet], owner, observedAtUtc: later}), /FLEET_DUPLICATE_ROOT/u);
assert.throws(() => compileFleetReplayCustody({laneId: "LANE.FLEET.STOP", generation: 1, rootIdentity: "ROOT.FLEET.STOP", rootPath: "fleet/stop", status: "STOPPED", terminal: true, owner, observedAtUtc: later}), /FLEET_STOPPED_FIXTURE/u);

const postgres = compileRuntimePostgresqlCustody({custodyId: "POSTGRES.RUNTIME.1", owner, retentionReason: "durable runtime state", releaseCondition: "explicit lifecycle release", currentStateReceiptSha256: "d".repeat(64), observedAtUtc: at});
assert.equal(validateRuntimePostgresqlCustody(postgres).protected_from_generic_cleanup, true);
assert.throws(() => compileRuntimePostgresqlCustody({custodyId: "POSTGRES.BAD", owner, retentionReason: "durable runtime state", releaseCondition: "explicit lifecycle release", currentStateReceiptSha256: "d".repeat(64), deletionRequested: true, observedAtUtc: at}), /POSTGRESQL_PROTECTED/u);
assert.throws(() => compileRuntimePostgresqlCustody({custodyId: "POSTGRES.MISSING", owner, retentionReason: "", releaseCondition: "explicit lifecycle release", currentStateReceiptSha256: "d".repeat(64), observedAtUtc: at}), /retention reason/u);

const rollover = compileStorageSessionRollover({predecessorSessionId: "SESSION.OLD", successorSessionId: "SESSION.NEW", predecessorHistorySha256: "e".repeat(64), successorHistorySha256: "f".repeat(64), continuitySha256: "0".repeat(64), predecessorRetained: true, stateOwned: true, observedAtUtc: later});
assert.equal(validateStorageSessionRollover(rollover).predecessor_retained, true);
assert.throws(() => compileStorageSessionRollover({predecessorSessionId: "SESSION.OLD.BAD", successorSessionId: "SESSION.NEW.BAD", predecessorHistorySha256: "e".repeat(64), successorHistorySha256: "f".repeat(64), continuitySha256: "0".repeat(64), predecessorRetained: false, observedAtUtc: later}), /ROLLOVER_CONTINUITY/u);

const prune = compileSharedTargetPruneDecision({targetId: "TARGET.CARGO.1", targetPath: "cargo/target-old", safeCheckpoint: true, orphaned: true, oldFingerprint: false, observedAtUtc: later});
assert.equal(validateSharedTargetPruneDecision(prune).allowed, true);
assert.equal(compileSharedTargetPruneDecision({targetId: "TARGET.CARGO.LIVE", targetPath: "cargo/target-live", safeCheckpoint: true, orphaned: true, activeConsumers: [issue], observedAtUtc: later}).allowed, false);

console.log("PASS storage regeneration recurrence governance: owned temp closeout, issue-bound manifests, verified delivery cleanup, cache/dependency custody, recurrence detection, protected-class denials, and hostile coverage");
