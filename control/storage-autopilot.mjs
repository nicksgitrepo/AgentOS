#!/usr/bin/env node

/* Controller-owned storage autopilot and storage-hygiene pure contracts. */

import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";
import {
  ZERO_RECOVERY_SCOPE_HOSTILE_CASES,
  ZERO_RECOVERY_SCOPE_SCHEMA,
  ZERO_RECOVERY_SCOPE_SELECTION_DEFECT,
  compileZeroRecoveryScopeInventory,
  validateZeroRecoveryScopeInventory,
} from "./hygiene-dual-key-repair-loop.mjs";

export {
  ZERO_RECOVERY_SCOPE_HOSTILE_CASES,
  ZERO_RECOVERY_SCOPE_SCHEMA,
  ZERO_RECOVERY_SCOPE_SELECTION_DEFECT,
  compileZeroRecoveryScopeInventory,
  validateZeroRecoveryScopeInventory,
} from "./hygiene-dual-key-repair-loop.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) { if (!condition) throw new Error(message); }
function record(value, label) { assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); }
function string(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function nonNegativeInteger(value, label) { assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`); }

function storageAutoSafeRelative(target) {
  string(target, "hygiene target");
  assert(!path.isAbsolute(target) && !target.includes("\\"), "hygiene target must be a relative POSIX path");
  assert(!target.split("/").includes(".."), "hygiene target may not traverse parent directories");
  assert(!/[*?{}\[\]]/u.test(target), "hygiene target may not be globbed");
  assert(target !== "." && target !== "", "hygiene target may not be the root");
  return target;
}

export const STORAGE_HYGIENE_PLAN_SCHEMA = "agentos.storage_hygiene_plan.v1";
export const STORAGE_LIFECYCLE_CLASSES = Object.freeze([
  "ACTIVE_CUSTODY",
  "REGENERABLE",
  "DELIVERY_EVIDENCE",
  "RETAINED_RUNTIME_STATE",
  "CLEANUP_ELIGIBLE",
]);
export const CLEANUP_TARGET_KINDS = Object.freeze([
  "WORKTREE",
  "CACHE",
  "FIXTURE",
  "BROWSER_STATE",
  "TEMP",
  "BUILD_OUTPUT",
  "DEPENDENCY_COPY",
  "RUNTIME_STATE",
]);

export function validateStorageAsset(asset, label = "storage asset") {
  record(asset, label);
  const relative = storageAutoSafeRelative(asset.path);
  assert(CLEANUP_TARGET_KINDS.includes(asset.kind), `${label} kind is invalid`);
  assert(STORAGE_LIFECYCLE_CLASSES.includes(asset.lifecycle_class), `${label} lifecycle class is invalid`);
  string(asset.owner_id, `${label} owner`);
  string(asset.campaign_id, `${label} campaign`);
  string(asset.deletion_condition, `${label} deletion condition`);
  nonNegativeInteger(asset.estimated_bytes, `${label} estimated bytes`);
  nonNegativeInteger(asset.process_count, `${label} process count`);
  for (const field of ["active", "dirty", "referenced", "shared", "owner_released", "checkpoint_complete", "memory_handoff_complete", "remote_preserved"]) {
    assert(typeof asset[field] === "boolean", `${label} ${field} must be boolean`);
  }
  assert(asset.retention_reason === null || (typeof asset.retention_reason === "string" && asset.retention_reason.trim().length > 0), `${label} retention reason is invalid`);
  sha(asset.evidence_sha256, `${label} evidence digest`);
  return {...asset, path: relative};
}

/**
 * Classify one observed storage asset. Classification is conservative: a
 * caller cannot turn active, dirty, referenced, shared, unpreserved, or
 * process-owned material into deletion authority by merely naming it
 * CLEANUP_ELIGIBLE.
 */
export function compileStorageAssetDisposition(asset) {
  const valid = validateStorageAsset(asset);
  const holds = [];
  if (STORAGE_AUTO_LIFECYCLE_PROTECTED.has(valid.lifecycle_class)) {
    holds.push(valid.lifecycle_class === "DELIVERY_EVIDENCE" ? "DURABLE_EVIDENCE_RETAINED" : valid.lifecycle_class);
  }
  if (valid.active && !holds.includes("ACTIVE_CUSTODY")) holds.push("ACTIVE_CUSTODY");
  if (valid.dirty) holds.push("DIRTY_CUSTODY");
  if (valid.referenced) holds.push("LIVE_REFERENCE");
  if (valid.shared) holds.push("SHARED_RESOURCE");
  if (valid.process_count > 0) holds.push("LIVE_PROCESS");
  if (!valid.owner_released) holds.push("OWNER_NOT_RELEASED");
  if (!valid.checkpoint_complete) holds.push("CHECKPOINT_INCOMPLETE");
  if (!valid.memory_handoff_complete) holds.push("MEMORY_HANDOFF_INCOMPLETE");
  if (valid.kind === "WORKTREE" && !valid.remote_preserved) holds.push("REMOTE_IDENTITY_NOT_PRESERVED");
  if (valid.retention_reason !== null) holds.push("RETENTION_REASON_ACTIVE");
  const cleanupEligible = holds.length === 0;
  return {
    ...valid,
    lifecycle_class: cleanupEligible ? "CLEANUP_ELIGIBLE" : valid.lifecycle_class,
    disposition: cleanupEligible ? "DELETE_AFTER_SEPARATE_ADMISSION" : "RETAIN",
    hold_reasons: holds,
  };
}

export function compileStorageHygienePlan({assets, observedAtUtc} = {}) {
  assert(Array.isArray(assets) && assets.length > 0, "storage hygiene assets are required");
  string(observedAtUtc, "storage hygiene observation time");
  const classified = assets.map((asset) => compileStorageAssetDisposition(asset));
  assert(new Set(classified.map((asset) => asset.path)).size === classified.length, "storage hygiene plan contains duplicate paths");
  const plan = {
    schema: STORAGE_HYGIENE_PLAN_SCHEMA,
    version: 1,
    observed_at_utc: observedAtUtc,
    assets: classified,
    cleanup_eligible_paths: classified.filter((asset) => asset.disposition === "DELETE_AFTER_SEPARATE_ADMISSION").map((asset) => asset.path).sort(),
    retained_paths: classified.filter((asset) => asset.disposition === "RETAIN").map((asset) => asset.path).sort(),
    estimated_cleanup_bytes: classified.filter((asset) => asset.disposition === "DELETE_AFTER_SEPARATE_ADMISSION").reduce((sum, asset) => sum + asset.estimated_bytes, 0),
    plan_sha256: null,
  };
  plan.plan_sha256 = canonicalDigest({...plan, plan_sha256: null});
  return plan;
}


/*
 * Controller-owned storage autopilot governance.  These helpers are pure
 * record compilers: they observe typed facts and return a digest-bound
 * decision, but never poll the host or delete anything.  The explicit
 * accounting/discovery boundaries are intentionally kept beside the existing
 * hygiene planner so callers cannot mistake a bounded list or logical byte
 * count for complete custody evidence.
 */
export const STORAGE_AUTOPILOT_SCHEMA = "agentos.controller.storage_autopilot.v1";
export const STORAGE_AUTOPILOT_VERSION = 1;
export const STORAGE_ACCOUNTING_SCHEMA = "agentos.controller.storage_accounting.v1";
export const STORAGE_DISCOVERY_SCHEMA = "agentos.controller.storage_discovery_union.v1";
export const STORAGE_RETENTION_SCHEMA = "agentos.controller.storage_retention_defaults.v1";
export const STORAGE_CALIBRATION_SCHEMA = "agentos.controller.apfs_calibration.v1";
export const STORAGE_BLOCKED_PATH_SCHEMA = "agentos.controller.blocked_path_route.v1";
export const STORAGE_ACCOUNTING_BUCKETS = Object.freeze([
  "APFS_PHYSICAL_FREE_AND_USED",
  "PROJECT_LOGICAL",
  "SYSTEM_LOGICAL",
  "PROTECTED_LOGICAL",
]);
export const STORAGE_AUTOPILOT_POLICY = Object.freeze({
  monitor_owner: "CONTROLLER_ONLY",
  monitor_interval_hours: 24,
  cleanup_target_free_gib: Object.freeze({minimum: 80, maximum: 100, work_stopping_floor: false}),
  owner_warning_at_or_below_free_gib: 50,
  sentinel_controller_alert_below_free_gib: 40,
  hard_operating_floor_at_or_below_free_gib: 25,
  update_headroom_gib: 20,
  system_residue_escalation_gib: 15,
  task_growth_alert_gib: 2,
  task_growth_alert_ratio: 2,
  ordinary_agents_poll_storage: false,
  cleanup_or_deletion_authorized: false,
  build_output_policy: Object.freeze({
    cache_scope: "CONTENT_ADDRESSED_TOOLCHAIN_AND_LOCKFILE",
    duplicate_per_proof_targets_forbidden: true,
    nested_fixture_copies_forbidden: true,
    durable_evidence: Object.freeze(["COMMAND", "EXIT_STATUS", "STDOUT_STDERR_DIGESTS", "TEST_SUMMARY", "CANDIDATE_IDENTITY"]),
    compiled_outputs_are_durable_evidence: false,
    cleanup_after_proof: "REMOVE_UNREFERENCED_REGENERABLE_OUTPUTS_AFTER_CUSTODY_CHECK",
  }),
});
export const STORAGE_RETENTION_DEFAULTS = Object.freeze({
  temporary_expiry_days: 7,
  generated_artifact_retention_reason_after_days: 30,
  legacy_review: "QUARTERLY",
  logs: "BOUNDED_OR_ROTATED",
  build_caches: "CLEAN_AT_CLOSEOUT_ONLY_WHEN_PROVEN_SAFE",
});
export const STORAGE_AUTOPILOT_HOSTILE_CASES = Object.freeze([
  "SENTINEL_ALERTS_CONTROLLER_ONCE_BELOW_FORTY_GIB",
  "SENTINEL_DEDUPLICATES_UNCHANGED_STORAGE_ALERT",
  "DUPLICATE_PER_PROOF_BUILD_TARGET_DENIED",
  "NESTED_FIXTURE_COPY_DENIED",
  "EACH_THRESHOLD_BOUNDARY_AND_NON_OVERLAPPING_STATE",
  "PHYSICAL_LOGICAL_DOUBLE_COUNT_DENIAL",
  "INSUFFICIENT_UPDATE_HEADROOM",
  "INSTALLER_OR_STAGED_UPDATE_PRESENT",
  "INDEXING_NOT_QUIET",
  "SAMPLES_UNSTABLE_OR_LESS_THAN_SIX_HOURS_APART",
  "SETTLED_BUILD_ROLL_FORWARD",
  "SYSTEM_RESIDUE_OVER_FIFTEEN_GIB",
  "SYSTEM_RESIDUE_GROWTH_ACROSS_THREE_BUILDS",
  "DEDUPLICATED_SYSTEM_ESCALATION",
  "AGENTOS_CLEANUP_WITH_UPDATE_UNSETTLED",
  "TASK_GROWTH_PLUS_TWO_GIB",
  "TASK_GROWTH_TWO_X_WITHOUT_AUTO_STOP",
  "MISSING_GENERATED_OR_TEMP_OWNERSHIP_METADATA",
  "RETENTION_DEFAULTS",
  "PROTECTED_DATA_DELETE_DENIAL",
  "APFS_ESTIMATE_ACTUAL_CALIBRATION",
  "ONE_CYCLE_BLOCKED_PATH_NO_ROUTE",
  "TWO_CYCLE_IDENTICAL_BLOCKED_PATH_EXACT_ROUTE",
  "BLOCKED_PATH_IDENTITY_CHANGE_RESETS_CORRELATION",
  "EXISTING_LIFECYCLE_CLASS_AND_STRICT_GATE_PRESERVATION",
]);

export function compileSentinelStorageAlert({freeGib, observedAtUtc, previousAlertKey = null} = {}) {
  storageAutoNumber(freeGib, "Sentinel storage free_gib");
  string(observedAtUtc, "Sentinel storage observation time");
  assert(previousAlertKey === null || (typeof previousAlertKey === "string" && SHA256.test(previousAlertKey)), "previous Sentinel storage alert key is invalid");
  const threshold = STORAGE_AUTOPILOT_POLICY.sentinel_controller_alert_below_free_gib;
  const triggered = freeGib < threshold;
  const alertKey = triggered ? canonicalDigest({route: "SENTINEL_TO_CONTROLLER", threshold_gib: threshold, state: "BELOW_THRESHOLD"}) : null;
  return {schema: "agentos.sentinel.storage_alert.v1", version: 1, observed_at_utc: observedAtUtc, free_gib: freeGib, threshold_gib: threshold, triggered, route: triggered && alertKey !== previousAlertKey ? "CONTROLLER" : null, deduplicated: triggered && alertKey === previousAlertKey, alert_key: alertKey, required_action: triggered ? "CONTROLLER_BOUNDED_CUSTODY_SAFE_CLEANUP" : "NONE", sentinel_cleanup_authorized: false};
}

export function validateBuildOutputPlan({cacheScope, duplicatePerProofTargets, nestedFixtureCopies, durableEvidence, cleanupAfterProof} = {}) {
  const policy = STORAGE_AUTOPILOT_POLICY.build_output_policy;
  assert(cacheScope === policy.cache_scope, "build cache must be content-addressed by compatible toolchain and lockfile");
  assert(duplicatePerProofTargets === false, "duplicate per-proof build targets are forbidden");
  assert(nestedFixtureCopies === false, "nested fixture copies are forbidden");
  assert(Array.isArray(durableEvidence) && durableEvidence.length > 0, "durable build evidence is required");
  assert(durableEvidence.every((entry) => policy.durable_evidence.includes(entry)), "compiled outputs may not be retained as durable evidence");
  assert(cleanupAfterProof === policy.cleanup_after_proof, "build outputs must use the governed post-proof cleanup transition");
  return true;
}

const STORAGE_AUTO_BUCKET_KINDS = new Set(["PHYSICAL", "LOGICAL"]);
const STORAGE_AUTO_LIFECYCLE_PROTECTED = new Set(["ACTIVE_CUSTODY", "DELIVERY_EVIDENCE", "RETAINED_RUNTIME_STATE"]);
const STORAGE_AUTO_CLASSIFICATIONS = new Set(["PERMANENT_EXEMPT", "TEMPORARY_CLOSED"]);
const STORAGE_AUTO_DISCOVERY_SOURCES = Object.freeze([
  "live", "pinned", "non_pinned", "archived", "notLoaded", "interrupted", "failed", "idle", "active",
  "campaign_roster", "controller_ledger", "worktrees", "processes", "automation_targets", "state", "memory",
  "handoffs", "artifacts", "host_registry",
]);

function storageAutoPick(value, ...keys) {
  if (value === null || value === undefined) return undefined;
  for (const key of keys) if (value[key] !== undefined) return value[key];
  return undefined;
}

function storageAutoIsRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function storageAutoString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

function storageAutoNumber(value, label) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0, `${label} must be a non-negative finite number`);
  return value;
}

function storageAutoBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
  return value;
}

function storageAutoTimestamp(value, label) {
  storageAutoString(value, label);
  assert(!Number.isNaN(Date.parse(value)), `${label} must be an ISO timestamp`);
  return value;
}

function storageAutoDigestBody(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return body;
}

function storageAutoBucketEntry(entry, fallbackId) {
  if (typeof entry === "number") entry = {bytes: entry};
  record(entry, `storage accounting bucket ${fallbackId ?? ""}`);
  const id = storageAutoString(storageAutoPick(entry, "id", "bucket_id", "name") ?? fallbackId, "storage accounting bucket ID");
  assert(STORAGE_ACCOUNTING_BUCKETS.includes(id), `unknown storage accounting bucket ${id}`);
  const inferredKind = id === "APFS_PHYSICAL_FREE_AND_USED" ? "PHYSICAL" : "LOGICAL";
  const kind = storageAutoPick(entry, "kind", "bucket_kind") ?? inferredKind;
  assert(STORAGE_AUTO_BUCKET_KINDS.has(kind), `storage accounting bucket ${id} kind is invalid`);
  const freeBytes = storageAutoPick(entry, "free_bytes", "freeBytes");
  const usedBytes = storageAutoPick(entry, "used_bytes", "usedBytes");
  let bytes = storageAutoPick(entry, "bytes", "total_bytes", "logical_bytes");
  if (bytes === undefined && freeBytes !== undefined && usedBytes !== undefined) bytes = freeBytes + usedBytes;
  storageAutoNumber(bytes, `storage accounting bucket ${id} bytes`);
  if (freeBytes !== undefined) storageAutoNumber(freeBytes, `storage accounting bucket ${id} free bytes`);
  if (usedBytes !== undefined) storageAutoNumber(usedBytes, `storage accounting bucket ${id} used bytes`);
  if (id === "APFS_PHYSICAL_FREE_AND_USED") assert(freeBytes !== undefined && usedBytes !== undefined, "APFS physical bucket requires free and used bytes");
  const provenance = storageAutoPick(entry, "provenance", "source", "origin");
  assert(typeof provenance === "string" || (provenance !== null && typeof provenance === "object"), `storage accounting bucket ${id} provenance is required`);
  if (typeof provenance === "string") storageAutoString(provenance, `storage accounting bucket ${id} provenance`);
  const overlaps = storageAutoPick(entry, "overlaps", "overlap_with", "overlapWith") ?? [];
  assert(Array.isArray(overlaps), `storage accounting bucket ${id} overlaps must be an array`);
  const normalizedOverlaps = overlaps.map((item) => storageAutoString(item, `storage accounting bucket ${id} overlap`));
  assert(new Set(normalizedOverlaps).size === normalizedOverlaps.length, `storage accounting bucket ${id} overlaps contain duplicates`);
  return {
    id,
    kind,
    bytes,
    ...(freeBytes === undefined ? {} : {free_bytes: freeBytes}),
    ...(usedBytes === undefined ? {} : {used_bytes: usedBytes}),
    provenance: typeof provenance === "string" ? provenance : structuredClone(provenance),
    overlaps: normalizedOverlaps,
  };
}

function storageAutoNormalizeBuckets(raw) {
  const source = storageAutoPick(raw, "buckets", "bucket_inventory", "bucketInventory");
  assert(source !== undefined, "storage accounting buckets are required");
  const entries = Array.isArray(source) ? source.map((entry) => [undefined, entry]) : Object.entries(source);
  assert(entries.length > 0, "storage accounting buckets are required");
  const buckets = entries.map(([id, entry]) => storageAutoBucketEntry(entry, id));
  const ids = buckets.map((bucket) => bucket.id);
  assert(new Set(ids).size === ids.length, "storage accounting buckets contain duplicate IDs");
  assert(STORAGE_ACCOUNTING_BUCKETS.every((id) => ids.includes(id)), "storage accounting must include all four governed buckets");
  return buckets.sort((left, right) => left.id.localeCompare(right.id));
}

export function compileStorageAccounting(input = {}) {
  record(input, "storage accounting input");
  const raw = storageAutoIsRecord(input.accounting) ? input.accounting : input;
  let buckets;
  if (raw.buckets || raw.bucket_inventory || raw.bucketInventory) {
    buckets = storageAutoNormalizeBuckets(raw);
  } else {
    const aliases = [
      ["APFS_PHYSICAL_FREE_AND_USED", {free_bytes: storageAutoPick(raw, "physical_free_bytes", "physicalFreeBytes"), used_bytes: storageAutoPick(raw, "physical_used_bytes", "physicalUsedBytes"), provenance: storageAutoPick(raw, "physical_provenance", "physicalProvenance") ?? "APFS_READ_ONLY"}],
      ["PROJECT_LOGICAL", {bytes: storageAutoPick(raw, "project_logical_bytes", "projectLogicalBytes"), provenance: storageAutoPick(raw, "project_provenance", "projectProvenance") ?? "PROJECT_LOGICAL_READ_ONLY"}],
      ["SYSTEM_LOGICAL", {bytes: storageAutoPick(raw, "system_logical_bytes", "systemLogicalBytes"), provenance: storageAutoPick(raw, "system_provenance", "systemProvenance") ?? "SYSTEM_LOGICAL_READ_ONLY"}],
      ["PROTECTED_LOGICAL", {bytes: storageAutoPick(raw, "protected_logical_bytes", "protectedLogicalBytes") ?? 0, provenance: storageAutoPick(raw, "protected_provenance", "protectedProvenance") ?? "PROTECTED_LOGICAL_READ_ONLY"}],
    ];
    assert(aliases.every(([, entry]) => entry.bytes !== undefined || (entry.free_bytes !== undefined && entry.used_bytes !== undefined)), "storage accounting aliases are incomplete");
    buckets = storageAutoNormalizeBuckets({buckets: aliases.map(([id, entry]) => ({id, ...entry}))});
  }
  const physical = buckets.find((bucket) => bucket.id === "APFS_PHYSICAL_FREE_AND_USED");
  const project = buckets.find((bucket) => bucket.id === "PROJECT_LOGICAL");
  const system = buckets.find((bucket) => bucket.id === "SYSTEM_LOGICAL");
  const protectedLogical = buckets.find((bucket) => bucket.id === "PROTECTED_LOGICAL");
  const overlapPairs = [];
  for (const bucket of buckets) {
    for (const overlap of bucket.overlaps) {
      assert(STORAGE_ACCOUNTING_BUCKETS.includes(overlap), `storage accounting overlap references unknown bucket ${overlap}`);
      overlapPairs.push([bucket.id, overlap].sort());
    }
  }
  const overlapKeys = [...new Set(overlapPairs.map((pair) => pair.join("|")))].sort();
  const physicalLogicalOverlap = overlapKeys.some((pair) => pair.includes("APFS_PHYSICAL_FREE_AND_USED") && !pair.includes("PROTECTED_LOGICAL"));
  const naiveTotal = buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);
  const explicitReclaimable = storageAutoPick(raw, "reclaimable_bytes", "reclaimableBytes");
  if (explicitReclaimable !== undefined) {
    storageAutoNumber(explicitReclaimable, "storage accounting reclaimable bytes");
    assert(!(physicalLogicalOverlap && explicitReclaimable === naiveTotal), "physical and logical bytes cannot be summed as independent reclaimable bytes");
  }
  const logicalReclaimableBytes = project.bytes + system.bytes;
  const accounting = {
    schema: STORAGE_ACCOUNTING_SCHEMA,
    version: 1,
    buckets,
    physical_free_bytes: physical.free_bytes,
    physical_used_bytes: physical.used_bytes,
    logical_bytes: {project: project.bytes, system: system.bytes, protected: protectedLogical.bytes},
    overlap_pairs: overlapKeys,
    double_count_denied: physicalLogicalOverlap,
    reclaimable_bytes: physicalLogicalOverlap ? logicalReclaimableBytes : (explicitReclaimable ?? logicalReclaimableBytes),
    provenance_complete: true,
    accounting_sha256: null,
  };
  accounting.accounting_sha256 = canonicalDigest(storageAutoDigestBody(accounting, "accounting_sha256"));
  return accounting;
}

export function validateStorageAccounting(accounting) {
  record(accounting, "storage accounting");
  assert(accounting.schema === STORAGE_ACCOUNTING_SCHEMA && accounting.version === 1, "storage accounting identity is invalid");
  sha(accounting.accounting_sha256, "storage accounting digest");
  assert(accounting.accounting_sha256 === canonicalDigest(storageAutoDigestBody(accounting, "accounting_sha256")), "storage accounting digest mismatch");
  const recomputed = compileStorageAccounting({buckets: accounting.buckets, reclaimable_bytes: accounting.reclaimable_bytes});
  assert(recomputed.accounting_sha256 === accounting.accounting_sha256, "storage accounting bytes or provenance changed");
  assert(accounting.double_count_denied === recomputed.double_count_denied, "storage accounting overlap invariant changed");
  return accounting;
}

export function classifyStorageThreshold(freeGib) {
  storageAutoNumber(freeGib, "Controller storage free_gib");
  if (freeGib <= STORAGE_AUTOPILOT_POLICY.hard_operating_floor_at_or_below_free_gib) return "HARD_FLOOR";
  if (freeGib <= STORAGE_AUTOPILOT_POLICY.owner_warning_at_or_below_free_gib) return "OWNER_WARNING";
  if (freeGib < STORAGE_AUTOPILOT_POLICY.cleanup_target_free_gib.minimum) return "BELOW_CLEANUP_TARGET";
  if (freeGib <= STORAGE_AUTOPILOT_POLICY.cleanup_target_free_gib.maximum) return "CLEANUP_TARGET";
  return "ABOVE_CLEANUP_TARGET";
}

function storageAutoAssessUpdate(options) {
  const update = storageAutoPick(options, "updateState", "update_state");
  const source = update === undefined ? options : update;
  const requested = update !== undefined || storageAutoPick(options, "updateRequired", "update_required") === true;
  const explicitSignal = storageAutoPick(options, "installer_present", "staged_update_present", "indexing_quiet", "samples", "updateHeadroomGib", "update_headroom_gib", "headroomGib", "headroom_gib", "updateRequired", "update_required");
  if (update === undefined && explicitSignal === undefined) {
    return {requested: false, settled: true, basis: "NOT_REQUESTED", installer_or_staged_update_present: false, indexing_quiet: true, stable_samples: true, sample_count: 2, separation_hours: 6, headroom_gib: null, headroom_sufficient: true, update_actions_allowed: true};
  }
  record(source, "storage update state");
  const installer = Boolean(storageAutoPick(source, "installer_present", "installerOrStagedUpdatePresent") ?? false);
  const staged = Boolean(storageAutoPick(source, "staged_update_present", "stagedUpdatePresent") ?? false);
  const indexingQuiet = storageAutoPick(source, "indexing_quiet", "indexingQuiet") ?? false;
  storageAutoBoolean(indexingQuiet, "storage indexing quiet");
  const samples = storageAutoPick(source, "samples", "stable_samples", "stableSamples") ?? [];
  assert(Array.isArray(samples), "storage update samples must be an array");
  const sampleRecords = samples.map((sample, index) => {
    if (typeof sample === "string") return {observed_at_utc: storageAutoTimestamp(sample, `storage sample ${index}`), stable: true};
    record(sample, `storage sample ${index}`);
    const observed = storageAutoPick(sample, "observed_at_utc", "observedAtUtc", "timestamp");
    return {observed_at_utc: storageAutoTimestamp(observed, `storage sample ${index}`), stable: sample.stable === undefined ? true : storageAutoBoolean(sample.stable, `storage sample ${index} stable`)};
  });
  const separated = sampleRecords.length >= 2 ? (Date.parse(sampleRecords.at(-1).observed_at_utc) - Date.parse(sampleRecords[0].observed_at_utc)) / 3600000 : 0;
  const stableSamples = sampleRecords.length >= 2 && sampleRecords.every((sample) => sample.stable === true) && separated >= 6;
  const headroom = storageAutoPick(source, "update_headroom_gib", "updateHeadroomGib", "headroom_gib", "headroomGib");
  const headroomGib = headroom === undefined ? null : storageAutoNumber(headroom, "storage update headroom_gib");
  const headroomSufficient = headroomGib === null || headroomGib >= STORAGE_AUTOPILOT_POLICY.update_headroom_gib;
  if (requested && headroomGib !== null && !headroomSufficient && storageAutoPick(options, "requireUpdateAction", "require_update_action") === true) throw new Error("insufficient update headroom");
  return {
    requested,
    settled: !installer && !staged && indexingQuiet && stableSamples,
    basis: "EXPLICIT_READ_ONLY_UPDATE_STATE",
    installer_or_staged_update_present: installer || staged,
    indexing_quiet: indexingQuiet,
    stable_samples: stableSamples,
    sample_count: sampleRecords.length,
    separation_hours: separated,
    headroom_gib: headroomGib,
    headroom_sufficient: headroomSufficient,
    update_actions_allowed: !installer && !staged && indexingQuiet && stableSamples && headroomSufficient,
  };
}

function storageAutoResidue(options) {
  const input = storageAutoPick(options, "systemResidue", "system_residue") ?? {};
  if (!storageAutoIsRecord(input)) throw new Error("system residue observation must be an object");
  const current = storageAutoPick(input, "gib", "current_gib", "currentGib") ?? 0;
  const baseline = storageAutoPick(input, "settled_baseline_gib", "baseline_gib", "baselineGib") ?? 0;
  storageAutoNumber(current, "system residue GiB");
  storageAutoNumber(baseline, "settled system residue baseline GiB");
  const history = storageAutoPick(input, "build_history", "buildHistory", "consecutive_builds") ?? [];
  assert(Array.isArray(history), "system residue build history must be an array");
  const values = history.map((entry, index) => storageAutoNumber(typeof entry === "number" ? entry : storageAutoPick(entry, "gib", "residue_gib", "residueGib"), `system residue build ${index}`));
  const growthAcrossThreeBuilds = values.length >= 3 && values.slice(-3).every((value, index, list) => index === 0 || value > list[index - 1]);
  const thresholdExceeded = current - baseline > STORAGE_AUTOPILOT_POLICY.system_residue_escalation_gib;
  const trigger = thresholdExceeded || growthAcrossThreeBuilds;
  const escalationKey = canonicalDigest({type: "SYSTEM_RESIDUE_ESCALATION", baseline, current, values: values.slice(-3), threshold: STORAGE_AUTOPILOT_POLICY.system_residue_escalation_gib});
  const previous = storageAutoPick(options, "previousEscalationKeys", "previous_escalation_keys") ?? storageAutoPick(input, "previous_escalation_keys", "previousEscalationKeys") ?? [];
  assert(Array.isArray(previous), "system residue previous escalation keys must be an array");
  const deduplicated = previous.includes(escalationKey);
  return {current_gib: current, settled_baseline_gib: baseline, build_history_gib: values, threshold_exceeded: thresholdExceeded, growth_across_three_builds: growthAcrossThreeBuilds, escalation_required: trigger && !deduplicated, escalation_triggered: trigger, escalation_key: escalationKey, deduplicated};
}

function storageAutoTaskGrowth(options) {
  const input = storageAutoPick(options, "taskGrowth", "task_growth") ?? {};
  record(input, "task growth observation");
  const growth = storageAutoPick(input, "growth_gib", "absolute_growth_gib", "growthGib") ?? 0;
  const ratio = storageAutoPick(input, "ratio", "growth_ratio", "growthRatio") ?? 0;
  storageAutoNumber(growth, "task growth GiB");
  storageAutoNumber(ratio, "task growth ratio");
  return {growth_gib: growth, ratio, alert: growth >= STORAGE_AUTOPILOT_POLICY.task_growth_alert_gib || ratio >= STORAGE_AUTOPILOT_POLICY.task_growth_alert_ratio, automatic_stop: false, automatic_stop_forbidden: true};
}

export function validateGeneratedTempMetadata(metadata) {
  record(metadata, "generated/temp metadata");
  const ownerTask = storageAutoPick(metadata, "owner_task_id", "ownerTaskId", "task_id", "taskId");
  const explicitOrphan = storageAutoPick(metadata, "explicit_orphan", "explicitOrphan") === true;
  assert((ownerTask !== undefined && ownerTask !== null) || explicitOrphan, "generated/temp metadata requires owner task or explicit orphan");
  if (ownerTask !== undefined && ownerTask !== null) storageAutoString(ownerTask, "generated/temp owner task");
  storageAutoString(storageAutoPick(metadata, "purpose"), "generated/temp purpose");
  storageAutoTimestamp(storageAutoPick(metadata, "created_at", "createdAt"), "generated/temp created_at");
  storageAutoString(storageAutoPick(metadata, "regeneration_proof", "regenerationProof"), "generated/temp regeneration proof");
  storageAutoString(storageAutoPick(metadata, "retention_condition", "retentionCondition", "deletion_condition", "deletionCondition"), "generated/temp retention/deletion condition");
  return structuredClone(metadata);
}

export const validateGeneratedArtifactMetadata = validateGeneratedTempMetadata;
export const validateTempMetadata = validateGeneratedTempMetadata;

export function compileRetentionDefaults(overrides = {}) {
  record(overrides, "retention defaults");
  const defaults = {...STORAGE_RETENTION_DEFAULTS, ...overrides};
  assert(defaults.temporary_expiry_days === 7, "temporary retention default is invalid");
  assert(defaults.generated_artifact_retention_reason_after_days === 30, "generated retention default is invalid");
  assert(defaults.legacy_review === "QUARTERLY", "legacy retention default is invalid");
  assert(defaults.logs === "BOUNDED_OR_ROTATED", "log retention default is invalid");
  assert(defaults.build_caches === "CLEAN_AT_CLOSEOUT_ONLY_WHEN_PROVEN_SAFE", "build cache retention default is invalid");
  const result = {schema: STORAGE_RETENTION_SCHEMA, version: 1, ...defaults, retention_sha256: null};
  result.retention_sha256 = canonicalDigest(storageAutoDigestBody(result, "retention_sha256"));
  return result;
}

export function validateRetentionDefaults(retention) {
  record(retention, "retention defaults");
  assert(retention.schema === STORAGE_RETENTION_SCHEMA && retention.version === 1, "retention defaults identity is invalid");
  sha(retention.retention_sha256, "retention defaults digest");
  assert(retention.retention_sha256 === canonicalDigest(storageAutoDigestBody(retention, "retention_sha256")), "retention defaults digest mismatch");
  compileRetentionDefaults(retention);
  return retention;
}

export function compileApfsCalibration({estimatedBytes, actualBytes, estimated_bytes, actual_bytes, batchId = null, batch_id = null} = {}) {
  const estimate = estimatedBytes ?? estimated_bytes;
  const actual = actualBytes ?? actual_bytes;
  storageAutoNumber(estimate, "APFS estimated bytes");
  storageAutoNumber(actual, "APFS actual bytes");
  const ratio = estimate === 0 ? (actual === 0 ? 1 : null) : actual / estimate;
  const result = {schema: STORAGE_CALIBRATION_SCHEMA, version: 1, batch_id: batchId ?? batch_id, estimated_bytes: estimate, actual_bytes: actual, estimate_to_actual_ratio: ratio === null ? null : (ratio === 0 ? null : 1 / ratio), actual_to_estimate_ratio: ratio, calibration_sha256: null};
  result.calibration_sha256 = canonicalDigest(storageAutoDigestBody(result, "calibration_sha256"));
  return result;
}

export function validateApfsCalibration(calibration) {
  record(calibration, "APFS calibration");
  assert(calibration.schema === STORAGE_CALIBRATION_SCHEMA && calibration.version === 1, "APFS calibration identity is invalid");
  sha(calibration.calibration_sha256, "APFS calibration digest");
  assert(calibration.calibration_sha256 === canonicalDigest(storageAutoDigestBody(calibration, "calibration_sha256")), "APFS calibration digest mismatch");
  const recomputed = compileApfsCalibration({estimatedBytes: calibration.estimated_bytes, actualBytes: calibration.actual_bytes, batchId: calibration.batch_id});
  assert(recomputed.calibration_sha256 === calibration.calibration_sha256, "APFS calibration values changed");
  return calibration;
}

export function compileBlockedPathRoute({path: blockedPath, currentIdentity, owner, cycle = 1, previousRoutes = [], previous_routes = []} = {}) {
  const relative = storageAutoSafeRelative(blockedPath);
  storageAutoString(currentIdentity, "blocked path current identity");
  storageAutoString(owner, "blocked path owner");
  assert(Number.isSafeInteger(cycle) && cycle >= 1, "blocked path cycle must be a positive integer");
  const history = previousRoutes.length > 0 ? previousRoutes : previous_routes;
  assert(Array.isArray(history), "blocked path previous routes must be an array");
  const sameIdentity = history.some((entry) => storageAutoIsRecord(entry) && entry.path === relative && entry.current_identity === currentIdentity && entry.owner === owner);
  const route = cycle >= 2 && sameIdentity ? {route_type: "TYPED_GATE_ROUTE", route_id: canonicalDigest({relative, currentIdentity, owner}), deduplication_key: canonicalDigest({relative, currentIdentity, owner}), identity: currentIdentity, owner, path: relative} : null;
  const result = {schema: STORAGE_BLOCKED_PATH_SCHEMA, version: 1, path: relative, current_identity: currentIdentity, owner, cycle, route, route_emitted: route !== null, deduplicated: route !== null, receipt_sha256: null};
  result.receipt_sha256 = canonicalDigest(storageAutoDigestBody(result, "receipt_sha256"));
  return result;
}

export function validateBlockedPathRoute(receipt) {
  record(receipt, "blocked path route");
  assert(receipt.schema === STORAGE_BLOCKED_PATH_SCHEMA && receipt.version === 1, "blocked path route identity is invalid");
  storageAutoSafeRelative(receipt.path);
  storageAutoString(receipt.current_identity, "blocked path current identity");
  storageAutoString(receipt.owner, "blocked path owner");
  assert(Number.isSafeInteger(receipt.cycle) && receipt.cycle >= 1, "blocked path cycle is invalid");
  assert(receipt.route === null || storageAutoIsRecord(receipt.route), "blocked path route payload is invalid");
  sha(receipt.receipt_sha256, "blocked path route digest");
  assert(receipt.receipt_sha256 === canonicalDigest(storageAutoDigestBody(receipt, "receipt_sha256")), "blocked path route digest mismatch");
  return receipt;
}

export const compileBlockedPathGateRoute = compileBlockedPathRoute;
export const compileBlockedPathCorrelation = compileBlockedPathRoute;

function storageAutoDiscoverySource(value, sourceName) {
  assert(!Array.isArray(value), `storage discovery source ${sourceName} requires explicit exhaustive completeness`);
  record(value, `storage discovery source ${sourceName}`);
  const completenessSignals = [value.complete, value.paginated_complete, value.is_complete, value.exhaustive]
    .filter((signal) => signal !== undefined);
  assert(completenessSignals.length > 0 && completenessSignals.every((signal) => signal === true), `storage discovery source ${sourceName} requires explicit exhaustive completeness`);
  const items = value.items ?? value.identities ?? value.records ?? value.tasks ?? [];
  assert(Array.isArray(items), `storage discovery source ${sourceName} items must be an array`);
  return {items, complete: true};
}

function storageAutoIdentity(entry, sourceName) {
  if (typeof entry === "string") return {task_id: storageAutoString(entry, `storage discovery ${sourceName} task ID`), source: sourceName, record: {task_id: entry}};
  record(entry, `storage discovery ${sourceName} identity`);
  const id = storageAutoPick(entry, "task_id", "taskId", "id", "identity", "identity_id");
  storageAutoString(id, `storage discovery ${sourceName} task ID`);
  return {task_id: id, source: sourceName, record: structuredClone(entry)};
}

function storageAutoSourceEntries(input) {
  const sourceContainer = input.sources ?? input.source_union ?? null;
  const entries = [];
  if (sourceContainer !== null) {
    if (Array.isArray(sourceContainer)) {
      for (const entry of sourceContainer) {
        record(entry, "storage discovery source entry");
        const name = storageAutoString(storageAutoPick(entry, "source", "name"), "storage discovery source name");
        entries.push([name, storageAutoDiscoverySource(entry, name)]);
      }
    } else {
      record(sourceContainer, "storage discovery sources");
      for (const [name, value] of Object.entries(sourceContainer)) entries.push([name, storageAutoDiscoverySource(value, name)]);
    }
  }
  for (const name of STORAGE_AUTO_DISCOVERY_SOURCES) if (input[name] !== undefined) entries.push([name, storageAutoDiscoverySource(input[name], name)]);
  assert(entries.length > 0, "storage discovery requires at least one complete source");
  return entries;
}

function storageAutoReadbackMap(input) {
  const raw = input.directReadbacks ?? input.direct_readbacks ?? input.readbacks ?? {};
  if (Array.isArray(raw)) {
    return new Map(raw.map((entry) => {
      const identity = storageAutoIdentity(entry, "direct_readback");
      return [identity.task_id, entry];
    }));
  }
  record(raw, "storage discovery direct readbacks");
  return new Map(Object.entries(raw));
}

export function compileUniversalDiscovery(input = {}) {
  record(input, "universal storage discovery input");
  const sourceEntries = storageAutoSourceEntries(input);
  const identities = new Map();
  const sourceState = new Map();
  for (const [sourceName, source] of sourceEntries) {
    for (const rawIdentity of source.items) {
      const identity = storageAutoIdentity(rawIdentity, sourceName);
      if (!identities.has(identity.task_id)) identities.set(identity.task_id, {task_id: identity.task_id, sources: [], records: []});
      const item = identities.get(identity.task_id);
      if (!item.sources.includes(sourceName)) item.sources.push(sourceName);
      item.records.push(identity.record);
      if (!sourceState.has(sourceName)) sourceState.set(sourceName, new Map());
      sourceState.get(sourceName).set(identity.task_id, identity.record);
    }
  }
  const readbacks = storageAutoReadbackMap(input);
  const classificationMap = input.classifications ?? input.classification ?? {};
  assert(storageAutoIsRecord(classificationMap), "storage discovery classifications must be an object");
  const classifications = [];
  const missing = [];
  for (const [taskId, identity] of identities) {
    const readback = readbacks.get(taskId);
    assert(readback !== undefined, `storage discovery direct readback missing for ${taskId}`);
    const readbackRecord = typeof readback === "string" ? {task_id: readback} : readback;
    record(readbackRecord, `storage discovery direct readback ${taskId}`);
    const readbackId = storageAutoPick(readbackRecord, "task_id", "taskId", "id", "identity");
    assert(readbackId === taskId, `storage discovery direct readback identity mismatch for ${taskId}`);
    const candidateClasses = [classificationMap[taskId], readbackRecord.classification, readbackRecord.disposition, ...identity.records.map((recordValue) => recordValue.classification ?? recordValue.disposition)].filter((value) => value !== undefined);
    assert(candidateClasses.length > 0, `storage discovery classification missing for ${taskId}`);
    const classification = candidateClasses[0];
    assert(STORAGE_AUTO_CLASSIFICATIONS.has(classification), `storage discovery classification invalid for ${taskId}`);
    assert(candidateClasses.every((value) => value === classification), `storage discovery classification conflict for ${taskId}`);
    classifications.push({task_id: taskId, classification});
  }
  for (const id of readbacks.keys()) if (!identities.has(id)) missing.push(id);
  assert(missing.length === 0, "storage discovery readback contains an identity outside the source union");

  const archived = sourceState.get("archived") ?? new Map();
  const host = sourceState.get("host_registry") ?? new Map();
  const divergence = [];
  const archiveIds = new Set(archived.keys());
  const hostArchivedIds = new Set([...host.entries()].filter(([, value]) => value?.archived === true || value?.status === "ARCHIVED").map(([id]) => id));
  for (const id of new Set([...archiveIds, ...hostArchivedIds])) {
    const appRecord = archived.get(id);
    const hostRecord = host.get(id);
    const appArchived = appRecord !== undefined && (appRecord?.archived === undefined ? true : appRecord.archived === true || appRecord.status === "ARCHIVED");
    const hostArchived = hostArchivedIds.has(id);
    if (appArchived !== hostArchived) divergence.push({task_id: id, app_archived: appArchived, host_archived: hostArchived});
  }
  const orderedIdentities = [...identities.values()].map((identity) => ({task_id: identity.task_id, sources: [...identity.sources].sort(), records: identity.records})).sort((left, right) => left.task_id.localeCompare(right.task_id));
  const orderedClassifications = classifications.sort((left, right) => left.task_id.localeCompare(right.task_id));
  const discovery = {
    schema: STORAGE_DISCOVERY_SCHEMA,
    version: 1,
    status: divergence.length > 0 ? "ARCHIVED_REGISTRY_PROJECTION_DIVERGENCE" : "DISCOVERY_COMPLETE",
    projection_divergence: divergence,
    identities: orderedIdentities,
    classifications: orderedClassifications,
    direct_readback_count: readbacks.size,
    union_count: orderedIdentities.length,
    unaccounted_count: 0,
    bounded_list_rejected: false,
    direct_readbacks_complete: true,
    discovery_sha256: null,
  };
  discovery.discovery_sha256 = canonicalDigest(storageAutoDigestBody(discovery, "discovery_sha256"));
  return discovery;
}

export function validateUniversalDiscovery(discovery) {
  record(discovery, "universal storage discovery");
  assert(discovery.schema === STORAGE_DISCOVERY_SCHEMA && discovery.version === 1, "universal storage discovery identity is invalid");
  assert(discovery.unaccounted_count === 0 && discovery.direct_readbacks_complete === true, "universal storage discovery is incomplete");
  sha(discovery.discovery_sha256, "universal storage discovery digest");
  assert(discovery.discovery_sha256 === canonicalDigest(storageAutoDigestBody(discovery, "discovery_sha256")), "universal storage discovery digest mismatch");
  return discovery;
}

export const compileStorageDiscoveryUnion = compileUniversalDiscovery;
export const discoverStorageUnion = compileUniversalDiscovery;
export const validateStorageDiscovery = validateUniversalDiscovery;

export function compileStorageDeletionDecision(asset, {action = "DELETE"} = {}) {
  const source = validateStorageAsset(asset);
  const classified = compileStorageAssetDisposition(source);
  const protectedClass = STORAGE_AUTO_LIFECYCLE_PROTECTED.has(source.lifecycle_class) || source.protected === true || source.kind === "RUNTIME_STATE";
  const allowed = action !== "DELETE" || (!protectedClass && classified.disposition === "DELETE_AFTER_SEPARATE_ADMISSION");
  return {path: source.path, action, allowed, disposition: allowed ? "DELETE_AFTER_SEPARATE_ADMISSION" : "RETAIN", reason: allowed ? null : "PROTECTED_DATA_DELETE_DENIAL", lifecycle_class: classified.lifecycle_class};
}

export function assertProtectedDataDeleteDenied(asset) {
  const decision = compileStorageDeletionDecision(asset);
  assert(decision.allowed === false, "protected data deletion must be denied");
  return decision;
}

export const validateProtectedDataDelete = assertProtectedDataDeleteDenied;

function storageAutoIssueTransition(freeGib, {currentIssueStatus = "ACTIVE", currentIssueCustody = "ACTIVE", nextIssueRequested = false, cleanupAttempted = false, cleanupReachedTarget = null} = {}) {
  storageAutoString(currentIssueStatus, "Controller current issue status");
  storageAutoString(currentIssueCustody, "Controller current issue custody");
  storageAutoBoolean(nextIssueRequested, "Controller next issue requested");
  storageAutoBoolean(cleanupAttempted, "Controller cleanup attempted");
  assert(cleanupReachedTarget === null || typeof cleanupReachedTarget === "boolean", "Controller cleanup reached target must be boolean or null");
  const thresholdClass = classifyStorageThreshold(freeGib);
  const hardFloor = thresholdClass === "HARD_FLOOR";
  const belowTarget = freeGib <= STORAGE_AUTOPILOT_POLICY.cleanup_target_free_gib.minimum;
  const protectedCustody = ["ACTIVE", "UNMERGED", "AMBIGUOUS", "UNKNOWN"].includes(currentIssueCustody);
  if (cleanupAttempted && protectedCustody) throw new Error("ambiguous or active custody cleanup is rejected");
  const currentIssue = {status: currentIssueStatus, work_allowed: !hardFloor, storage_heavy_work_allowed: !hardFloor, finish_verify_freeze_handoff_required: belowTarget, runtime_delivery_allowed: !hardFloor};
  const nextBlocked = hardFloor || belowTarget || (cleanupAttempted && cleanupReachedTarget !== true);
  if (nextIssueRequested && nextBlocked) throw new Error("next issue admission is rejected while Controller cleanup transition is open");
  const nextIssue = {admission: nextBlocked ? (hardFloor ? "DENY_HARD_OPERATING_FLOOR" : "DENY_DURING_CLEANUP") : "ADMIT_AFTER_DAILY_TRANSITION", allowed: !nextBlocked, blocked_reason: nextBlocked ? (hardFloor ? "FREE_GIB_AT_OR_BELOW_25_HARD_OPERATING_FLOOR" : "BELOW_80_CLEANUP_TARGET_CONTROLLER_TRANSITION") : null};
  const cleanup = {required: belowTarget, action: hardFloor ? "ALERT_OWNER_AND_WAIT_FOR_RECOVERY_AUTHORITY" : belowTarget ? "CONTROLLER_CUSTODY_SAFE_CLEANUP_TOWARD_80_TO_100_GIB" : "NO_CLEANUP_REQUIRED", target_min_gib: 80, target_max_gib: 100, attempted: cleanupAttempted, reached_target: cleanupReachedTarget, owner_alert: hardFloor || thresholdClass === "OWNER_WARNING", resume_above_gib: 25};
  return {thresholdClass, currentIssue, nextIssue, cleanup, protectedCustody};
}

export function compileStorageAutopilotDecision({receiptId, receipt_id, observedAtUtc, observed_at_utc, freeGib, free_gib, actorRole = "CONTROLLER", actor_role, storagePoll = false, storage_poll, accounting, updateState, update_state, updateRequired, update_required, updateHeadroomGib, update_headroom_gib, requireUpdateAction, require_update_action, currentIssueStatus, current_issue_status, currentIssueCustody, current_issue_custody, nextIssueRequested, next_issue_requested, cleanupAttempted, cleanup_attempted, cleanupReachedTarget, cleanup_reached_target, previousEscalationKeys, previous_escalation_keys, metadata = [], generated_metadata = [], blockedPath, blocked_path, discovery, taskGrowth, task_growth, systemResidue, system_residue} = {}) {
  const id = receiptId ?? receipt_id;
  const observed = observedAtUtc ?? observed_at_utc;
  const free = freeGib ?? free_gib;
  assert(actorRole === "CONTROLLER" && (actor_role === undefined || actor_role === "CONTROLLER"), "only the Controller may produce a storage autopilot receipt");
  assert(storagePoll === false && (storage_poll === undefined || storage_poll === false), "ordinary-agent repeated storage polling is rejected");
  storageAutoString(id, "Controller storage receipt ID");
  storageAutoTimestamp(observed, "Controller storage observation time");
  storageAutoNumber(free, "Controller storage free_gib");
  const transition = storageAutoIssueTransition(free, {currentIssueStatus: currentIssueStatus ?? current_issue_status ?? "ACTIVE", currentIssueCustody: currentIssueCustody ?? current_issue_custody ?? "ACTIVE", nextIssueRequested: nextIssueRequested ?? next_issue_requested ?? false, cleanupAttempted: cleanupAttempted ?? cleanup_attempted ?? false, cleanupReachedTarget: cleanupReachedTarget ?? cleanup_reached_target ?? null});
  const update = storageAutoAssessUpdate({updateState: updateState ?? update_state, updateRequired: updateRequired ?? update_required, updateHeadroomGib: updateHeadroomGib ?? update_headroom_gib, requireUpdateAction: requireUpdateAction ?? require_update_action});
  const generated = [...(metadata ?? []), ...(generated_metadata ?? [])];
  assert(Array.isArray(generated), "generated/temp metadata must be an array");
  generated.forEach((entry) => validateGeneratedTempMetadata(entry));
  const retention = compileRetentionDefaults();
  const storageAccounting = accounting === undefined || accounting === null ? null : validateStorageAccounting(accounting);
  const blocked = blockedPath ?? blocked_path;
  const blockedRoute = blocked === undefined || blocked === null ? null : validateBlockedPathRoute(blocked);
  const discoveryResult = discovery === undefined || discovery === null ? null : validateUniversalDiscovery(discovery);
  const decision = {
    schema: STORAGE_AUTOPILOT_SCHEMA,
    version: STORAGE_AUTOPILOT_VERSION,
    receipt_id: id,
    monitor_role: "CONTROLLER",
    observed_at_utc: observed,
    controller_cycle_hours: 24,
    free_gib: free,
    threshold_class: transition.thresholdClass,
    threshold_label: free > 80 ? "HEALTHY" : "ORDERLY_CLEANUP_OR_WARNING",
    healthy: free > 80,
    policy: structuredClone(STORAGE_AUTOPILOT_POLICY),
    accounting: storageAccounting,
    update,
    current_issue: transition.currentIssue,
    next_issue: transition.nextIssue,
    cleanup: {...transition.cleanup, independent_of_update_state: true},
    ordinary_agents: {polling_allowed: false, decision: "REJECT_REPEATED_STORAGE_POLL"},
    custody: {active_or_unmerged_preserved: true, ambiguous_custody_cleanup_forbidden: true, cleanup_allowed: !transition.protectedCustody && !STORAGE_AUTOPILOT_POLICY.cleanup_or_deletion_authorized},
    system_residue: storageAutoResidue({systemResidue: systemResidue ?? system_residue, previousEscalationKeys: previousEscalationKeys ?? previous_escalation_keys}),
    task_growth: storageAutoTaskGrowth({taskGrowth: taskGrowth ?? task_growth}),
    generated_temp_metadata: generated,
    retention,
    blocked_path_route: blockedRoute,
    discovery: discoveryResult,
    apfs_calibration_required: true,
    hostile_fixture_refs: [...STORAGE_AUTOPILOT_HOSTILE_CASES],
    cleanup_or_deletion_authorized: false,
    receipt_sha256: null,
  };
  decision.receipt_sha256 = canonicalDigest(storageAutoDigestBody(decision, "receipt_sha256"));
  return decision;
}

export function validateStorageAutopilotDecision(decision) {
  record(decision, "storage autopilot decision");
  assert(decision.schema === STORAGE_AUTOPILOT_SCHEMA && decision.version === STORAGE_AUTOPILOT_VERSION, "storage autopilot decision identity is invalid");
  storageAutoString(decision.receipt_id, "storage autopilot receipt ID");
  assert(decision.monitor_role === "CONTROLLER", "storage autopilot decision is not Controller-owned");
  storageAutoTimestamp(decision.observed_at_utc, "storage autopilot observation time");
  classifyStorageThreshold(decision.free_gib);
  assert(decision.threshold_class === classifyStorageThreshold(decision.free_gib), "storage autopilot threshold class is stale");
  assert(JSON.stringify(decision.hostile_fixture_refs) === JSON.stringify(STORAGE_AUTOPILOT_HOSTILE_CASES), "storage autopilot hostile coverage is incomplete");
  assert(decision.cleanup_or_deletion_authorized === false, "storage autopilot cannot authorize deletion");
  if (decision.accounting !== null) validateStorageAccounting(decision.accounting);
  validateRetentionDefaults(decision.retention);
  if (decision.discovery !== null) validateUniversalDiscovery(decision.discovery);
  if (decision.blocked_path_route !== null) validateBlockedPathRoute(decision.blocked_path_route);
  sha(decision.receipt_sha256, "storage autopilot receipt digest");
  assert(decision.receipt_sha256 === canonicalDigest(storageAutoDigestBody(decision, "receipt_sha256")), "storage autopilot receipt digest mismatch");
  return decision;
}

export const compileControllerStorageAutopilot = compileStorageAutopilotDecision;
export const compileControllerStorageAutopilotDecision = compileStorageAutopilotDecision;
export const validateControllerStorageAutopilot = validateStorageAutopilotDecision;
export const evaluateStorageThreshold = classifyStorageThreshold;
export const storageThresholdClass = classifyStorageThreshold;
