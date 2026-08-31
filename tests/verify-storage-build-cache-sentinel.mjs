#!/usr/bin/env node
import assert from "node:assert/strict";
import {STORAGE_AUTOPILOT_POLICY, compileSentinelStorageAlert, validateBuildOutputPlan, compileStorageDeletionDecision, compileStorageAssetDisposition} from "../control/storage-autopilot.mjs";
const at = "2026-08-28T12:00:00.000Z";
assert.equal(compileSentinelStorageAlert({freeGib: 40, observedAtUtc: at}).triggered, false);
const low = compileSentinelStorageAlert({freeGib: 39.99, observedAtUtc: at});
assert.equal(low.route, "CONTROLLER");
assert.equal(low.sentinel_cleanup_authorized, false);
const duplicate = compileSentinelStorageAlert({freeGib: 20, observedAtUtc: at, previousAlertKey: low.alert_key});
assert.equal(duplicate.route, null);
assert.equal(duplicate.deduplicated, true);
const governed = STORAGE_AUTOPILOT_POLICY.build_output_policy;
const valid = {cacheScope: governed.cache_scope, duplicatePerProofTargets: false, nestedFixtureCopies: false, durableEvidence: [...governed.durable_evidence], cleanupAfterProof: governed.cleanup_after_proof};
assert.equal(validateBuildOutputPlan(valid), true);
assert.throws(() => validateBuildOutputPlan({...valid, duplicatePerProofTargets: true}), /duplicate per-proof/u);
assert.throws(() => validateBuildOutputPlan({...valid, nestedFixtureCopies: true}), /nested fixture/u);
assert.throws(() => validateBuildOutputPlan({...valid, durableEvidence: ["COMPILED_OUTPUT"]}), /compiled outputs/u);
const protectedAsset = {
  path: "toolchains/node/bin/node",
  kind: "CACHE",
  lifecycle_class: "CLEANUP_ELIGIBLE",
  owner_id: "CONTROLLER",
  campaign_id: "STORAGE-REGENERATION",
  deletion_condition: "separate authority",
  estimated_bytes: 1,
  process_count: 0,
  active: false,
  dirty: false,
  referenced: false,
  shared: false,
  owner_released: true,
  checkpoint_complete: true,
  memory_handoff_complete: true,
  remote_preserved: true,
  retention_reason: null,
  evidence_sha256: "e".repeat(64),
};
assert.equal(compileStorageAssetDisposition(protectedAsset).disposition, "RETAIN");
assert.equal(compileStorageDeletionDecision(protectedAsset).allowed, false);
const worktree = {...protectedAsset, path: "retained-worktree", kind: "WORKTREE"};
assert.equal(compileStorageDeletionDecision(worktree).allowed, false);
console.log("PASS storage build-cache and Sentinel threshold governance");
