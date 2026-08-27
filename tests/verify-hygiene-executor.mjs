#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  HYGIENE_AFTER_STATE_SCHEMA,
  STORAGE_ACCOUNTING_BUCKETS,
  STORAGE_AUTOPILOT_HOSTILE_CASES,
  STORAGE_AUTOPILOT_SCHEMA,
  STORAGE_HYGIENE_PLAN_SCHEMA,
  assertProtectedDataDeleteDenied,
  classifyStorageThreshold,
  compileApfsCalibration,
  compileBlockedPathRoute,
  compileHygieneDryRun,
  compileStorageAccounting,
  compileStorageAssetDisposition,
  compileStorageAutopilotDecision,
  compileStorageDeletionDecision,
  compileStorageHygienePlan,
  compileZeroRecoveryScopeInventory,
  compileUniversalDiscovery,
  executeHygiene,
  validateApfsCalibration,
  validateBlockedPathRoute,
  validateDeletionManifest,
  validateHygieneAfterState,
  validateStorageAccounting,
  validateStorageAutopilotDecision,
  validateZeroRecoveryScopeInventory,
  validateGeneratedTempMetadata,
  compileRetentionDefaults,
  validateRetentionDefaults,
} from "../control/hygiene-executor.mjs";

function eligibleTarget(pathname, kind = "TEMP", overrides = {}) {
  return {
    path: pathname,
    kind,
    lifecycle_class: "CLEANUP_ELIGIBLE",
    owner_id: "OWNER-ROUTE-037",
    campaign_id: "CAMPAIGN-ROUTE-037",
    deletion_condition: "Delivered identity and durable handoff are complete.",
    estimated_bytes: 11,
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
    evidence_sha256: "a".repeat(64),
    ...overrides,
  };
}

const tempParent = process.env.TMPDIR;
assert.equal(typeof tempParent, "string", "TMPDIR must be supplied");
assert.ok(tempParent.length > 0, "TMPDIR must be nonempty");
assert.ok(path.isAbsolute(tempParent), "TMPDIR must be absolute");
fs.mkdirSync(tempParent, {recursive: true});
const root = fs.mkdtempSync(path.join(tempParent, "route037-hygiene-"));
let outside;
try {
  fs.writeFileSync(path.join(root, "disposable.txt"), "disposable\n");
  const manifest = {
    schema: "agentos.cleanup_deletion_manifest.v1",
    version: 1,
    targets: [eligibleTarget("disposable.txt")],
    manifest_sha256: null,
  };
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  validateDeletionManifest(manifest);
  const dry = compileHygieneDryRun({manifest, authorityRoot: root});
  const removed = [];
  const execution = executeHygiene({manifest, dryRun: dry, authorityRoot: root, executionAdmitted: true, removeTarget: ({absolutePath, path: relative}) => { fs.rmSync(absolutePath); removed.push(relative); }});
  assert.deepEqual(removed, ["disposable.txt"]);
  assert.equal(fs.existsSync(path.join(root, "disposable.txt")), false);
  const authorityRoot = fs.realpathSync.native(root);
  const afterState = {
    schema: HYGIENE_AFTER_STATE_SCHEMA,
    version: 1,
    manifest_sha256: execution.manifest_sha256,
    dry_run_sha256: execution.dry_run_sha256,
    execution_sha256: execution.execution_sha256,
    authority_root: authorityRoot,
    symlink_ancestors_checked: true,
    fresh_revalidation: true,
    retained_paths: execution.retained_paths,
    removed_paths: execution.removed_paths,
    failures: execution.failures,
    after_state_sha256: null,
  };
  afterState.after_state_sha256 = canonicalDigest({...afterState, after_state_sha256: null});
  validateHygieneAfterState({execution, afterState, manifest, dryRun: dry, authorityRoot, afterTargets: [{path: "disposable.txt", exists: false}]});
  assert.throws(() => validateHygieneAfterState({execution: {...execution, removed_paths: ["disposable.txt"], retained_paths: [], failures: []}, manifest, dryRun: dry, authorityRoot, afterTargets: [{path: "disposable.txt", exists: true}]}), /after-state receipt must be an object|after-state receipt identity/u);
  const incompleteAfterState = {...afterState, authority_root: undefined, symlink_ancestors_checked: undefined, fresh_revalidation: undefined, after_state_sha256: null};
  incompleteAfterState.after_state_sha256 = canonicalDigest({...incompleteAfterState, after_state_sha256: null});
  assert.throws(() => validateHygieneAfterState({execution, afterState: incompleteAfterState, manifest, dryRun: dry, authorityRoot, afterTargets: [{path: "disposable.txt", exists: false}]}), /after-state authority root|symlink checks|fresh revalidation/u);
  const inconsistentAfterState = {...afterState, after_state_sha256: null};
  inconsistentAfterState.after_state_sha256 = canonicalDigest({...inconsistentAfterState, after_state_sha256: null});
  assert.throws(() => validateHygieneAfterState({execution, afterState: inconsistentAfterState, manifest, dryRun: dry, authorityRoot, afterTargets: [{path: "disposable.txt", exists: true}]}), /after-target state|filesystem state/u);
  const ghostManifest = {...manifest, targets: [{...manifest.targets[0], path: "ghost-not-in-execution.txt"}], manifest_sha256: null};
  ghostManifest.manifest_sha256 = canonicalDigest({...ghostManifest, manifest_sha256: null});
  const ghostDryRun = compileHygieneDryRun({manifest: ghostManifest, authorityRoot: root});
  const ghostExecution = {
    schema: execution.schema,
    version: 1,
    manifest_sha256: ghostManifest.manifest_sha256,
    dry_run_sha256: ghostDryRun.dry_run_sha256,
    removed_paths: [],
    failures: [],
    retained_paths: ["control/hygiene-executor.mjs"],
    execution_admitted: true,
    execution_sha256: canonicalDigest({manifest_sha256: ghostManifest.manifest_sha256, dry_run_sha256: ghostDryRun.dry_run_sha256, removed_paths: []}),
  };
  const ghostAfterState = {
    schema: HYGIENE_AFTER_STATE_SCHEMA,
    version: 1,
    manifest_sha256: ghostExecution.manifest_sha256,
    dry_run_sha256: ghostExecution.dry_run_sha256,
    execution_sha256: ghostExecution.execution_sha256,
    authority_root: authorityRoot,
    symlink_ancestors_checked: true,
    fresh_revalidation: true,
    retained_paths: ghostExecution.retained_paths,
    removed_paths: [],
    failures: [],
    after_state_sha256: null,
  };
  ghostAfterState.after_state_sha256 = canonicalDigest({...ghostAfterState, after_state_sha256: null});
  assert.throws(() => validateHygieneAfterState({execution: ghostExecution, afterState: ghostAfterState, manifest: ghostManifest, dryRun: ghostDryRun, authorityRoot, afterTargets: [{path: "control/hygiene-executor.mjs", exists: true}]}), /target set|manifest/u);
  const vanishingRoot = fs.mkdtempSync(path.join(tempParent, "route037-hygiene-vanishing-"));
  try {
    fs.writeFileSync(path.join(vanishingRoot, "vanishing.txt"), "vanish before execution\n");
    const vanishingManifest = {...manifest, targets: [{...manifest.targets[0], path: "vanishing.txt"}], manifest_sha256: null};
    vanishingManifest.manifest_sha256 = canonicalDigest({...vanishingManifest, manifest_sha256: null});
    const vanishingDryRun = compileHygieneDryRun({manifest: vanishingManifest, authorityRoot: vanishingRoot});
    assert.equal(vanishingDryRun.targets[0].exists, true);
    fs.rmSync(path.join(vanishingRoot, "vanishing.txt"));
    const vanishingExecution = executeHygiene({manifest: vanishingManifest, dryRun: vanishingDryRun, authorityRoot: vanishingRoot, executionAdmitted: true, removeTarget: () => { throw new Error("vanished target must not be removed"); }});
    assert.deepEqual(vanishingExecution.removed_paths, []);
    assert.deepEqual(vanishingExecution.retained_paths, ["vanishing.txt"]);
    const vanishingAfterState = {
      schema: HYGIENE_AFTER_STATE_SCHEMA,
      version: 1,
      manifest_sha256: vanishingExecution.manifest_sha256,
      dry_run_sha256: vanishingExecution.dry_run_sha256,
      execution_sha256: vanishingExecution.execution_sha256,
      authority_root: fs.realpathSync.native(vanishingRoot),
      symlink_ancestors_checked: true,
      fresh_revalidation: true,
      retained_paths: vanishingExecution.retained_paths,
      removed_paths: vanishingExecution.removed_paths,
      failures: vanishingExecution.failures,
      after_state_sha256: null,
    };
    vanishingAfterState.after_state_sha256 = canonicalDigest({...vanishingAfterState, after_state_sha256: null});
    validateHygieneAfterState({execution: vanishingExecution, afterState: vanishingAfterState, manifest: vanishingManifest, dryRun: vanishingDryRun, authorityRoot: vanishingRoot, afterTargets: [{path: "vanishing.txt", exists: false}]});
  } finally {
    fs.rmSync(vanishingRoot, {recursive: true, force: true});
  }
  const reappearingRoot = fs.mkdtempSync(path.join(tempParent, "route037-hygiene-reappearing-"));
  try {
    const reappearingManifest = {...manifest, targets: [{...manifest.targets[0], path: "reappears.txt"}], manifest_sha256: null};
    reappearingManifest.manifest_sha256 = canonicalDigest({...reappearingManifest, manifest_sha256: null});
    const reappearingDryRun = compileHygieneDryRun({manifest: reappearingManifest, authorityRoot: reappearingRoot});
    assert.equal(reappearingDryRun.targets[0].exists, false);
    fs.writeFileSync(path.join(reappearingRoot, "reappears.txt"), "reappeared after dry run\n");
    let reappearingCalls = 0;
    const reappearingExecution = executeHygiene({manifest: reappearingManifest, dryRun: reappearingDryRun, authorityRoot: reappearingRoot, executionAdmitted: true, removeTarget: () => { reappearingCalls += 1; }});
    assert.equal(reappearingCalls, 0);
    assert.deepEqual(reappearingExecution.removed_paths, []);
    assert.deepEqual(reappearingExecution.retained_paths, ["reappears.txt"]);
    const reappearingAfterState = {
      schema: HYGIENE_AFTER_STATE_SCHEMA,
      version: 1,
      manifest_sha256: reappearingExecution.manifest_sha256,
      dry_run_sha256: reappearingExecution.dry_run_sha256,
      execution_sha256: reappearingExecution.execution_sha256,
      authority_root: fs.realpathSync.native(reappearingRoot),
      symlink_ancestors_checked: true,
      fresh_revalidation: true,
      retained_paths: reappearingExecution.retained_paths,
      removed_paths: reappearingExecution.removed_paths,
      failures: reappearingExecution.failures,
      after_state_sha256: null,
    };
    reappearingAfterState.after_state_sha256 = canonicalDigest({...reappearingAfterState, after_state_sha256: null});
    validateHygieneAfterState({execution: reappearingExecution, afterState: reappearingAfterState, manifest: reappearingManifest, dryRun: reappearingDryRun, authorityRoot: reappearingRoot, afterTargets: [{path: "reappears.txt", exists: true}]});
  } finally {
    fs.rmSync(reappearingRoot, {recursive: true, force: true});
  }
  assert.throws(() => executeHygiene({manifest, dryRun: dry, authorityRoot: root, executionAdmitted: false, removeTarget: () => {}}), /separate admission/u);
  const broad = {...manifest, targets: [{...manifest.targets[0], path: "**/*"}]};
  broad.manifest_sha256 = canonicalDigest({...broad, manifest_sha256: null});
  assert.throws(() => validateDeletionManifest(broad), /globbed/u);
  const active = {...manifest, targets: [{...manifest.targets[0], active: true}]};
  active.manifest_sha256 = canonicalDigest({...active, manifest_sha256: null});
  assert.throws(() => validateDeletionManifest(active), /safely removable/u);
  const activeDisposition = compileStorageAssetDisposition(eligibleTarget("active-worktree", "WORKTREE", {lifecycle_class: "ACTIVE_CUSTODY", active: true, owner_released: false, checkpoint_complete: false, memory_handoff_complete: false, remote_preserved: false}));
  assert.equal(activeDisposition.disposition, "RETAIN");
  assert.deepEqual(activeDisposition.hold_reasons, ["ACTIVE_CUSTODY", "OWNER_NOT_RELEASED", "CHECKPOINT_INCOMPLETE", "MEMORY_HANDOFF_INCOMPLETE", "REMOTE_IDENTITY_NOT_PRESERVED"]);
  const evidenceDisposition = compileStorageAssetDisposition(eligibleTarget("receipts/candidate.json", "TEMP", {lifecycle_class: "DELIVERY_EVIDENCE"}));
  assert.equal(evidenceDisposition.disposition, "RETAIN");
  assert.deepEqual(evidenceDisposition.hold_reasons, ["DURABLE_EVIDENCE_RETAINED"]);
  for (const [index, lifecycleClass] of ["ACTIVE_CUSTODY", "RETAINED_RUNTIME_STATE", "DELIVERY_EVIDENCE"].entries()) {
    const protectedAsset = eligibleTarget(`protected-class-${index}`, "TEMP", {
      lifecycle_class: lifecycleClass,
      eligible: true,
      disposition: "DELETE_AFTER_SEPARATE_ADMISSION",
      force: true,
      override: true,
      release: true,
      cleanup: true,
      hold_reasons: [],
    });
    const protectedDisposition = compileStorageAssetDisposition(protectedAsset);
    assert.equal(protectedDisposition.disposition, "RETAIN");
    assert.equal(protectedDisposition.lifecycle_class, lifecycleClass);
    assert.notEqual(protectedDisposition.hold_reasons.length, 0);
    assert.equal(compileStorageDeletionDecision(protectedAsset).allowed, false);
    assert.equal(compileStorageDeletionDecision({...protectedAsset, disposition: "DELETE", force: false, override: false}, {action: "DELETE"}).allowed, false);
  }
  assert.throws(() => compileStorageAssetDisposition(eligibleTarget("unknown-class", "TEMP", {lifecycle_class: "UNKNOWN"})), /lifecycle class is invalid/u);
  assert.throws(() => compileStorageDeletionDecision(eligibleTarget("malformed-class", "TEMP", {lifecycle_class: null})), /lifecycle class is invalid/u);
  const plan = compileStorageHygienePlan({assets: [eligibleTarget("target", "BUILD_OUTPUT", {lifecycle_class: "REGENERABLE", estimated_bytes: 2048}), activeDisposition, evidenceDisposition], observedAtUtc: "2026-08-26T18:00:00.000Z"});
  assert.equal(plan.schema, STORAGE_HYGIENE_PLAN_SCHEMA);
  assert.deepEqual(plan.cleanup_eligible_paths, ["target"]);
  assert.deepEqual(plan.retained_paths, ["active-worktree", "receipts/candidate.json"]);
  assert.equal(plan.estimated_cleanup_bytes, 2048);
  assert.match(plan.plan_sha256, /^[0-9a-f]{64}$/u);

  const aggregateIdentity = {device: 1, inode: 10, mode: 16877, links: 1, uid: 501, gid: 20, mtime_ns: 100, ctime_ns: 100, birthtime_ns: 99};
  const scopedInventory = compileZeroRecoveryScopeInventory({
    aggregateRoot: {path: "AgentOS/Temp", stable_identity: aggregateIdentity, logical_bytes_measured: 10000, allocated_bytes_measured: 12000, object_type: "DIRECTORY", is_symlink: false, realpath: "AgentOS/Temp"},
    selectedObjects: [{
      path: "AgentOS/Temp/candidate-receipt.json",
      stable_identity: {...aggregateIdentity, inode: 11, mode: 33188},
      object_type: "FILE",
      logical_bytes_measured: 456,
      allocated_or_physical_estimate_bytes: 8192,
      cleanup_gate_result: "DELIVERY_EVIDENCE",
      is_symlink: false,
      realpath: "AgentOS/Temp/candidate-receipt.json",
    }],
  });
  validateZeroRecoveryScopeInventory(scopedInventory);
  assert.equal(scopedInventory.selected_recoverable_logical_bytes, 0);
  assert.equal(scopedInventory.selected_recoverable_physical_bytes, 0);
  assert.equal(scopedInventory.aggregate_bytes_attributed_to_selected_children, false);
  assert.throws(() => compileZeroRecoveryScopeInventory({
    aggregateRoot: {path: "AgentOS/Temp", stable_identity: aggregateIdentity, logical_bytes_measured: 10000, allocated_bytes_measured: 12000},
    selectedObjects: [{path: "AgentOS/Temp/tiny.json", stable_identity: {...aggregateIdentity, inode: 12}, object_type: "FILE", logical_bytes_measured: 456, allocated_or_physical_estimate_bytes: 8192, cleanup_gate_result: "CLEANUP_ELIGIBLE"}],
    selectedRecoverableLogicalBytes: 10000,
    selectedRecoverablePhysicalBytes: 12000,
  }), /exact eligible child sum|exceeds/u);
  assert.throws(() => compileZeroRecoveryScopeInventory({
    aggregateRoot: {path: "AgentOS/Temp", stable_identity: {...aggregateIdentity, mtime_ns: undefined}, logical_bytes_measured: 1, allocated_bytes_measured: 1},
    selectedObjects: [],
  }), /undefined|concrete/u);
  const sharedCache = {...manifest, targets: [eligibleTarget("shared-cache", "CACHE", {shared: true})], manifest_sha256: null};
  sharedCache.manifest_sha256 = canonicalDigest({...sharedCache, manifest_sha256: null});
  assert.throws(() => validateDeletionManifest(sharedCache), /safely removable/u);
  const unpreservedWorktree = {...manifest, targets: [eligibleTarget("worktree", "WORKTREE", {remote_preserved: false})], manifest_sha256: null};
  unpreservedWorktree.manifest_sha256 = canonicalDigest({...unpreservedWorktree, manifest_sha256: null});
  assert.throws(() => validateDeletionManifest(unpreservedWorktree), /safely removable/u);
  outside = fs.mkdtempSync(path.join(tempParent, "route037-hygiene-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "must remain outside authority\n");
  fs.symlinkSync(outside, path.join(root, "linked"), "dir");
  const parentSymlink = {...manifest, targets: [{...manifest.targets[0], path: "linked/secret.txt"}]};
  parentSymlink.manifest_sha256 = canonicalDigest({...parentSymlink, manifest_sha256: null});
  assert.throws(() => compileHygieneDryRun({manifest: parentSymlink, authorityRoot: root}), /symlinked component/u);
  const parentSymlinkDryRun = {
    schema: "agentos.hygiene_executor_dry_run.v1",
    version: 1,
    manifest_sha256: parentSymlink.manifest_sha256,
    authority_root: fs.realpathSync.native(root),
    targets: [{path: "linked/secret.txt", kind: "TEMP", exists: true, observed: null}],
    refusal_count: 0,
    dry_run_sha256: null,
  };
  parentSymlinkDryRun.dry_run_sha256 = canonicalDigest({...parentSymlinkDryRun, dry_run_sha256: null});
  assert.throws(() => executeHygiene({manifest: parentSymlink, dryRun: parentSymlinkDryRun, authorityRoot: root, executionAdmitted: true, removeTarget: () => {}}), /symlinked component/u);
  assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "must remain outside authority\n");

  const accounting = compileStorageAccounting({buckets: [
    {id: STORAGE_ACCOUNTING_BUCKETS[0], kind: "PHYSICAL", free_bytes: 1000, used_bytes: 9000, provenance: "APFS_SYNTHETIC", overlaps: ["PROJECT_LOGICAL", "SYSTEM_LOGICAL"]},
    {id: STORAGE_ACCOUNTING_BUCKETS[1], kind: "LOGICAL", bytes: 5000, provenance: "PROJECT_SYNTHETIC", overlaps: ["APFS_PHYSICAL_FREE_AND_USED"]},
    {id: STORAGE_ACCOUNTING_BUCKETS[2], kind: "LOGICAL", bytes: 3000, provenance: "SYSTEM_SYNTHETIC", overlaps: ["APFS_PHYSICAL_FREE_AND_USED"]},
    {id: STORAGE_ACCOUNTING_BUCKETS[3], kind: "LOGICAL", bytes: 100, provenance: "PROTECTED_SYNTHETIC", overlaps: []},
  ]});
  assert.equal(accounting.double_count_denied, true);
  assert.equal(accounting.reclaimable_bytes, 8000);
  validateStorageAccounting(accounting);
  assert.throws(() => compileStorageAccounting({buckets: accounting.buckets, reclaimable_bytes: 18100}), /cannot be summed|double-count/u);
  assert.deepEqual([25, 50, 51, 80, 81, 100, 101].map(classifyStorageThreshold), ["HARD_FLOOR", "OWNER_WARNING", "BELOW_CLEANUP_TARGET", "CLEANUP_TARGET", "CLEANUP_TARGET", "CLEANUP_TARGET", "ABOVE_CLEANUP_TARGET"]);

  const unsettled = compileStorageAutopilotDecision({
    receiptId: "STORAGE.AUTOPILOT.UNSETTLED",
    observedAtUtc: "2026-08-26T18:00:00.000Z",
    freeGib: 40,
    accounting,
    updateState: {
      installer_present: true,
      staged_update_present: false,
      indexing_quiet: false,
      update_headroom_gib: 10,
      samples: ["2026-08-26T00:00:00.000Z", "2026-08-26T03:00:00.000Z"],
    },
    taskGrowth: {growth_gib: 2, ratio: 2},
  });
  assert.equal(unsettled.schema, STORAGE_AUTOPILOT_SCHEMA);
  assert.equal(unsettled.update.settled, false);
  assert.equal(unsettled.update.update_actions_allowed, false);
  assert.equal(unsettled.cleanup.independent_of_update_state, true);
  assert.equal(unsettled.task_growth.alert, true);
  assert.equal(unsettled.task_growth.automatic_stop, false);
  validateStorageAutopilotDecision(unsettled);
  assert.throws(() => compileStorageAutopilotDecision({receiptId: "STORAGE.AUTOPILOT.HEADROOM", observedAtUtc: "2026-08-26T18:00:00.000Z", freeGib: 80, updateRequired: true, updateHeadroomGib: 19, requireUpdateAction: true}), /headroom/u);
  assert.throws(() => compileStorageAutopilotDecision({receiptId: "STORAGE.AUTOPILOT.POLL", observedAtUtc: "2026-08-26T18:00:00.000Z", freeGib: 80, actorRole: "AGENT"}), /Controller/u);

  const metadata = {owner_task_id: "TASK-STORAGE-109", purpose: "synthetic fixture", created_at: "2026-08-26T18:00:00.000Z", regeneration_proof: "REGENERABLE_FROM_SOURCE", retention_condition: "delete after closeout"};
  validateGeneratedTempMetadata(metadata);
  assert.throws(() => validateGeneratedTempMetadata({...metadata, owner_task_id: undefined, explicit_orphan: false}), /owner task|explicit orphan/u);
  const retention = compileRetentionDefaults();
  validateRetentionDefaults(retention);
  validateApfsCalibration(compileApfsCalibration({estimatedBytes: 100, actualBytes: 125, batchId: "BATCH-STORAGE-109"}));
  assertProtectedDataDeleteDenied(eligibleTarget("protected-runtime", "RUNTIME_STATE", {lifecycle_class: "RETAINED_RUNTIME_STATE"}));

  const blockedFirst = compileBlockedPathRoute({path: "blocked/target", currentIdentity: "IDENTITY-A", owner: "CONTROLLER", cycle: 1});
  const blockedSecond = compileBlockedPathRoute({path: "blocked/target", currentIdentity: "IDENTITY-A", owner: "CONTROLLER", cycle: 2, previousRoutes: [blockedFirst]});
  assert.equal(blockedFirst.route, null);
  assert.equal(blockedSecond.route_emitted, true);
  validateBlockedPathRoute(blockedSecond);
  const blockedReset = compileBlockedPathRoute({path: "blocked/target", currentIdentity: "IDENTITY-B", owner: "CONTROLLER", cycle: 2, previousRoutes: [blockedFirst]});
  assert.equal(blockedReset.route, null);

  const discovery = compileUniversalDiscovery({
    sources: {
      live: {items: ["TASK-DISCOVERY-A"], complete: true},
      archived: {items: [{task_id: "TASK-DISCOVERY-B", archived: true}], exhaustive: true},
      host_registry: {items: [{task_id: "TASK-DISCOVERY-B", archived: true}], paginated_complete: true},
    },
    directReadbacks: {
      "TASK-DISCOVERY-A": {task_id: "TASK-DISCOVERY-A", classification: "TEMPORARY_CLOSED"},
      "TASK-DISCOVERY-B": {task_id: "TASK-DISCOVERY-B", classification: "PERMANENT_EXEMPT"},
    },
  });
  assert.equal(discovery.status, "DISCOVERY_COMPLETE");
  assert.equal(discovery.union_count, 2);
  assert.equal(discovery.unaccounted_count, 0);
  assert.throws(() => compileUniversalDiscovery({sources: {live: {items: ["TASK-BOUNDED"], complete: false}}, directReadbacks: {"TASK-BOUNDED": {task_id: "TASK-BOUNDED", classification: "TEMPORARY_CLOSED"}}}), /bounded or incomplete|explicit exhaustive completeness/u);
  assert.throws(() => compileUniversalDiscovery({sources: {live: ["TASK-BOUNDED-LIST"]}, directReadbacks: {"TASK-BOUNDED-LIST": {task_id: "TASK-BOUNDED-LIST", classification: "TEMPORARY_CLOSED"}}}), /explicit exhaustive completeness/u);
  assert.throws(() => compileUniversalDiscovery({sources: {live: {items: ["TASK-NO-COMPLETENESS"]}}, directReadbacks: {"TASK-NO-COMPLETENESS": {task_id: "TASK-NO-COMPLETENESS", classification: "TEMPORARY_CLOSED"}}}), /explicit exhaustive completeness/u);
  assert.throws(() => compileUniversalDiscovery({sources: {live: {items: ["TASK-MISSING-READBACK"], complete: true}}}), /direct readback missing/u);
  const divergence = compileUniversalDiscovery({sources: {archived: {items: [{task_id: "TASK-DIVERGENCE", archived: true}], complete: true}, host_registry: {items: [{task_id: "TASK-DIVERGENCE", archived: false}], exhaustive: true}}, directReadbacks: {"TASK-DIVERGENCE": {task_id: "TASK-DIVERGENCE", classification: "PERMANENT_EXEMPT"}}});
  assert.equal(divergence.status, "ARCHIVED_REGISTRY_PROJECTION_DIVERGENCE");
  assert.equal(STORAGE_AUTOPILOT_HOSTILE_CASES.length, 21);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
  if (outside) fs.rmSync(outside, {recursive: true, force: true});
}

console.log("PASS hygiene executor: digest-bound dry-run, separate execution admission, safe target validation, injected mutation boundary, and hostile refusal");
