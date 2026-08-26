#!/usr/bin/env node

/* Digest-bound cleanup planner/executor.  Filesystem mutation is injected. */

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";

import {
  STORAGE_HYGIENE_PLAN_SCHEMA,
  STORAGE_LIFECYCLE_CLASSES,
  CLEANUP_TARGET_KINDS,
  validateStorageAsset,
  compileStorageAssetDisposition,
  compileStorageHygienePlan,
  STORAGE_AUTOPILOT_SCHEMA,
  STORAGE_AUTOPILOT_VERSION,
  STORAGE_ACCOUNTING_SCHEMA,
  STORAGE_DISCOVERY_SCHEMA,
  STORAGE_RETENTION_SCHEMA,
  STORAGE_CALIBRATION_SCHEMA,
  STORAGE_BLOCKED_PATH_SCHEMA,
  STORAGE_ACCOUNTING_BUCKETS,
  STORAGE_AUTOPILOT_POLICY,
  STORAGE_RETENTION_DEFAULTS,
  STORAGE_AUTOPILOT_HOSTILE_CASES,
  compileStorageAccounting,
  validateStorageAccounting,
  classifyStorageThreshold,
  validateGeneratedTempMetadata,
  validateGeneratedArtifactMetadata,
  validateTempMetadata,
  compileRetentionDefaults,
  validateRetentionDefaults,
  compileApfsCalibration,
  validateApfsCalibration,
  compileBlockedPathRoute,
  validateBlockedPathRoute,
  compileBlockedPathGateRoute,
  compileBlockedPathCorrelation,
  compileUniversalDiscovery,
  validateUniversalDiscovery,
  compileStorageDiscoveryUnion,
  discoverStorageUnion,
  validateStorageDiscovery,
  compileStorageDeletionDecision,
  assertProtectedDataDeleteDenied,
  validateProtectedDataDelete,
  compileStorageAutopilotDecision,
  validateStorageAutopilotDecision,
  compileControllerStorageAutopilot,
  compileControllerStorageAutopilotDecision,
  validateControllerStorageAutopilot,
  evaluateStorageThreshold,
  storageThresholdClass,
} from "./storage-autopilot.mjs";
export {
  STORAGE_HYGIENE_PLAN_SCHEMA,
  STORAGE_LIFECYCLE_CLASSES,
  CLEANUP_TARGET_KINDS,
  compileStorageAssetDisposition,
  compileStorageHygienePlan,
  STORAGE_AUTOPILOT_SCHEMA,
  STORAGE_AUTOPILOT_VERSION,
  STORAGE_ACCOUNTING_SCHEMA,
  STORAGE_DISCOVERY_SCHEMA,
  STORAGE_RETENTION_SCHEMA,
  STORAGE_CALIBRATION_SCHEMA,
  STORAGE_BLOCKED_PATH_SCHEMA,
  STORAGE_ACCOUNTING_BUCKETS,
  STORAGE_AUTOPILOT_POLICY,
  STORAGE_RETENTION_DEFAULTS,
  STORAGE_AUTOPILOT_HOSTILE_CASES,
  compileStorageAccounting,
  validateStorageAccounting,
  classifyStorageThreshold,
  validateGeneratedTempMetadata,
  validateGeneratedArtifactMetadata,
  validateTempMetadata,
  compileRetentionDefaults,
  validateRetentionDefaults,
  compileApfsCalibration,
  validateApfsCalibration,
  compileBlockedPathRoute,
  validateBlockedPathRoute,
  compileBlockedPathGateRoute,
  compileBlockedPathCorrelation,
  compileUniversalDiscovery,
  validateUniversalDiscovery,
  compileStorageDiscoveryUnion,
  discoverStorageUnion,
  validateStorageDiscovery,
  compileStorageDeletionDecision,
  assertProtectedDataDeleteDenied,
  validateProtectedDataDelete,
  compileStorageAutopilotDecision,
  validateStorageAutopilotDecision,
  compileControllerStorageAutopilot,
  compileControllerStorageAutopilotDecision,
  validateControllerStorageAutopilot,
  evaluateStorageThreshold,
  storageThresholdClass,
} from "./storage-autopilot.mjs";


const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) { if (!condition) throw new Error(message); }
function record(value, label) { assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); }
function string(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function nonNegativeInteger(value, label) { assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`); }

function pathList(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  const paths = value.map((entry) => safeRelative(entry));
  assert(new Set(paths).size === paths.length, `${label} contains duplicate paths`);
  return paths;
}

function failurePath(failure, label) {
  if (typeof failure === "string") return safeRelative(failure);
  record(failure, label);
  return safeRelative(failure.path);
}

function samePathSet(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  assert(actualSet.size === actual.length, `${label} contains duplicate paths`);
  assert(actualSet.size === expectedSet.size && [...expectedSet].every((target) => actualSet.has(target)), `${label} does not match the bound target set`);
}

function safeRelative(target) {
  string(target, "hygiene target");
  assert(!path.isAbsolute(target) && !target.includes("\\"), "hygiene target must be a relative POSIX path");
  assert(!target.split("/").includes(".."), "hygiene target may not traverse parent directories");
  assert(!/[*?{}\[\]]/u.test(target), "hygiene target may not be globbed");
  assert(target !== "." && target !== "", "hygiene target may not be the root");
  return target;
}


export const HYGIENE_EXECUTION_SCHEMA = "agentos.hygiene_executor_execution.v1";
export const HYGIENE_DRY_RUN_SCHEMA = "agentos.hygiene_executor_dry_run.v1";
export const HYGIENE_AFTER_STATE_SCHEMA = "agentos.hygiene_executor_after_state.v1";
export function validateDeletionManifest(manifest) {
  record(manifest, "cleanup deletion manifest");
  assert(manifest.schema === "agentos.cleanup_deletion_manifest.v1", "cleanup deletion manifest schema is invalid");
  assert(manifest.version === 1, "cleanup deletion manifest version is invalid");
  assert(Array.isArray(manifest.targets) && manifest.targets.length > 0, "cleanup deletion targets are required");
  const targets = manifest.targets.map((target) => {
    const valid = validateStorageAsset(target, "cleanup deletion target");
    const classified = compileStorageAssetDisposition(valid);
    assert(valid.lifecycle_class === "CLEANUP_ELIGIBLE" && classified.disposition === "DELETE_AFTER_SEPARATE_ADMISSION", "cleanup target is not safely removable");
    return classified;
  });
  const keys = targets.map((target) => target.path);
  assert(new Set(keys).size === keys.length, "cleanup manifest contains duplicate targets");
  assert(manifest.manifest_sha256 === canonicalDigest({...manifest, manifest_sha256: null}), "cleanup manifest digest mismatch");
  return {...manifest, targets};
}

function resolveTarget(root, relative) {
  string(root, "cleanup authority root");
  const resolvedRoot = fs.realpathSync.native(path.resolve(root));
  const target = path.resolve(resolvedRoot, relative);
  assert(target.startsWith(`${resolvedRoot}${path.sep}`), "cleanup target escapes authority root");
  const components = path.relative(resolvedRoot, target).split(path.sep).filter(Boolean);
  let current = resolvedRoot;
  for (const component of components) {
    current = path.join(current, component);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
    assert(!stat.isSymbolicLink(), "cleanup target path may not contain a symlinked component");
  }
  if (fs.existsSync(target)) {
    const realTarget = fs.realpathSync.native(target);
    assert(realTarget.startsWith(`${resolvedRoot}${path.sep}`), "cleanup target realpath escapes authority root");
  }
  return {root: resolvedRoot, target};
}

export function compileHygieneDryRun({manifest, authorityRoot, observedTargets = []} = {}) {
  const valid = validateDeletionManifest(manifest);
  assert(Array.isArray(observedTargets), "cleanup observed target inventory must be an array");
  const targets = valid.targets.map((entry) => {
    const resolved = resolveTarget(authorityRoot, entry.path);
    const observed = observedTargets.find((candidate) => candidate.path === entry.path) ?? null;
    return {path: entry.path, kind: entry.kind, exists: fs.existsSync(resolved.target), observed};
  });
  const dryRun = {schema: HYGIENE_DRY_RUN_SCHEMA, version: 1, manifest_sha256: valid.manifest_sha256, authority_root: fs.realpathSync.native(path.resolve(authorityRoot)), targets, refusal_count: 0, dry_run_sha256: null};
  dryRun.dry_run_sha256 = canonicalDigest({...dryRun, dry_run_sha256: null});
  return dryRun;
}

export function validateHygieneDryRun({manifest, dryRun, authorityRoot} = {}) {
  const valid = validateDeletionManifest(manifest);
  record(dryRun, "cleanup dry run");
  assert(dryRun.schema === HYGIENE_DRY_RUN_SCHEMA && dryRun.version === 1, "cleanup dry run identity is invalid");
  sha(dryRun.manifest_sha256, "cleanup dry-run manifest digest");
  sha(dryRun.dry_run_sha256, "cleanup dry-run digest");
  assert(dryRun.manifest_sha256 === valid.manifest_sha256, "cleanup dry run does not bind the manifest");
  string(authorityRoot, "cleanup authority root");
  const resolvedRoot = fs.realpathSync.native(path.resolve(authorityRoot));
  assert(dryRun.authority_root === resolvedRoot, "cleanup dry run authority root is not bound");
  assert(Array.isArray(dryRun.targets), "cleanup dry-run target inventory must be an array");
  const expectedPaths = valid.targets.map((entry) => entry.path);
  const dryTargets = dryRun.targets.map((target) => {
    record(target, "cleanup dry-run target");
    const relative = safeRelative(target.path);
    assert(typeof target.exists === "boolean", "cleanup dry-run target existence is invalid");
    const manifestTarget = valid.targets.find((entry) => entry.path === relative);
    assert(manifestTarget, "cleanup dry-run target is not in the manifest");
    assert(target.kind === manifestTarget.kind, `cleanup dry-run target kind is inconsistent for ${relative}`);
    return {...target, path: relative};
  });
  samePathSet(dryTargets.map((target) => target.path), expectedPaths, "cleanup dry-run target inventory");
  assert(dryRun.dry_run_sha256 === canonicalDigest({...dryRun, dry_run_sha256: null}), "cleanup dry-run digest mismatch");
  return {manifest: valid, dryRun, targets: dryTargets, root: resolvedRoot};
}

export function executeHygiene({manifest, dryRun, authorityRoot, executionAdmitted = false, removeTarget} = {}) {
  const validatedDryRun = validateHygieneDryRun({manifest, dryRun, authorityRoot});
  const valid = validatedDryRun.manifest;
  assert(executionAdmitted === true, "cleanup execution requires separate admission");
  assert(typeof removeTarget === "function", "cleanup execution requires an injected remover");
  const removed = [];
  const dryTargets = new Map(validatedDryRun.targets.map((target) => [target.path, target]));
  for (const entry of valid.targets) {
    if (dryTargets.get(entry.path)?.exists !== true) continue;
    const resolved = resolveTarget(authorityRoot, entry.path);
    if (!fs.existsSync(resolved.target)) continue;
    const validated = resolveTarget(authorityRoot, entry.path);
    if (!fs.existsSync(validated.target)) continue;
    removeTarget({path: entry.path, absolutePath: validated.target, kind: entry.kind});
    removed.push(entry.path);
  }
  return {schema: HYGIENE_EXECUTION_SCHEMA, version: 1, manifest_sha256: valid.manifest_sha256, dry_run_sha256: dryRun.dry_run_sha256, removed_paths: removed.sort(), failures: [], retained_paths: valid.targets.map((entry) => entry.path).filter((target) => !removed.includes(target)).sort(), execution_admitted: true, execution_sha256: canonicalDigest({manifest_sha256: valid.manifest_sha256, dry_run_sha256: dryRun.dry_run_sha256, removed_paths: removed.sort()})};
}

export function validateHygieneAfterState({execution, afterState, afterTargets = [], authorityRoot, manifest, dryRun, deletionManifest, dryRunReceipt} = {}) {
  record(execution, "cleanup execution receipt");
  assert(execution.schema === HYGIENE_EXECUTION_SCHEMA && execution.version === 1, "cleanup execution receipt identity is invalid");
  sha(execution.manifest_sha256, "cleanup execution manifest digest");
  sha(execution.dry_run_sha256, "cleanup execution dry-run digest");
  sha(execution.execution_sha256, "cleanup execution digest");
  assert(execution.execution_admitted === true, "cleanup execution admission is invalid");
  const boundManifest = manifest ?? deletionManifest ?? execution.manifest;
  const boundDryRun = dryRun ?? dryRunReceipt ?? execution.dry_run;
  const validatedDryRun = validateHygieneDryRun({manifest: boundManifest, dryRun: boundDryRun, authorityRoot});
  const manifestPaths = validatedDryRun.manifest.targets.map((entry) => entry.path);
  const dryTargets = new Map(validatedDryRun.targets.map((target) => [target.path, target]));
  assert(execution.manifest_sha256 === validatedDryRun.manifest.manifest_sha256, "cleanup execution does not bind the manifest record");
  assert(execution.dry_run_sha256 === validatedDryRun.dryRun.dry_run_sha256, "cleanup execution does not bind the dry-run record");
  const removedPaths = pathList(execution.removed_paths, "cleanup execution removed paths");
  const retainedPaths = pathList(execution.retained_paths, "cleanup execution retained paths");
  assert(Array.isArray(execution.failures), "cleanup execution failures must be an array");
  const failurePaths = execution.failures.map((failure) => failurePath(failure, "cleanup execution failure"));
  assert(new Set([...removedPaths, ...retainedPaths]).size === removedPaths.length + retainedPaths.length, "cleanup execution removed and retained paths overlap");
  assert(!removedPaths.some((target) => failurePaths.includes(target)), "cleanup execution removed and failed paths overlap");
  samePathSet([...new Set([...removedPaths, ...retainedPaths, ...failurePaths])], manifestPaths, "cleanup execution paths");
  assert(removedPaths.every((target) => dryTargets.get(target)?.exists === true), "cleanup execution removed a target absent from the dry run");
  assert(execution.execution_sha256 === canonicalDigest({manifest_sha256: execution.manifest_sha256, dry_run_sha256: execution.dry_run_sha256, removed_paths: [...removedPaths].sort()}), "cleanup execution digest mismatch");

  record(afterState, "cleanup after-state receipt");
  assert(afterState.schema === HYGIENE_AFTER_STATE_SCHEMA && afterState.version === 1, "cleanup after-state receipt identity is invalid");
  sha(afterState.manifest_sha256, "cleanup after-state manifest digest");
  sha(afterState.dry_run_sha256, "cleanup after-state dry-run digest");
  sha(afterState.execution_sha256, "cleanup after-state execution digest");
  assert(afterState.manifest_sha256 === execution.manifest_sha256, "cleanup after-state does not bind the manifest");
  assert(afterState.dry_run_sha256 === execution.dry_run_sha256, "cleanup after-state does not bind the dry run");
  assert(afterState.execution_sha256 === execution.execution_sha256, "cleanup after-state does not bind the execution");
  const afterRetained = pathList(afterState.retained_paths, "cleanup after-state retained paths");
  const afterRemoved = pathList(afterState.removed_paths, "cleanup after-state removed paths");
  assert(Array.isArray(afterState.failures), "cleanup after-state failures must be an array");
  const afterFailures = afterState.failures.map((failure) => failurePath(failure, "cleanup after-state failure"));
  assert(new Set([...afterRemoved, ...afterRetained]).size === afterRemoved.length + afterRetained.length, "cleanup after-state removed and retained paths overlap");
  assert(!afterRemoved.some((target) => afterFailures.includes(target)), "cleanup after-state removed and failed paths overlap");
  assert(afterRemoved.length === removedPaths.length && afterRemoved.every((target) => removedPaths.includes(target)), "cleanup after-state removed paths do not match execution");
  assert(afterRetained.length === retainedPaths.length && afterRetained.every((target) => retainedPaths.includes(target)), "cleanup after-state retained paths do not match execution");
  assert(afterFailures.length === failurePaths.length && afterFailures.every((target) => failurePaths.includes(target)), "cleanup after-state failures do not match execution");
  samePathSet([...new Set([...afterRemoved, ...afterRetained, ...afterFailures])], manifestPaths, "cleanup after-state paths");
  string(authorityRoot, "cleanup authority root");
  const resolvedRoot = fs.realpathSync.native(path.resolve(authorityRoot));
  string(afterState.authority_root, "cleanup after-state authority root");
  assert(afterState.authority_root === resolvedRoot, "cleanup after-state authority root is not bound");
  assert(afterState.symlink_ancestors_checked === true, "cleanup after-state symlink checks are missing");
  assert(afterState.fresh_revalidation === true, "cleanup after-state fresh revalidation is missing");
  sha(afterState.after_state_sha256, "cleanup after-state digest");
  assert(afterState.after_state_sha256 === canonicalDigest({...afterState, after_state_sha256: null}), "cleanup after-state digest mismatch");

  const expectedPaths = [...new Set([...afterRemoved, ...afterRetained, ...afterFailures])];
  assert(Array.isArray(afterTargets), "cleanup after-target inventory must be an array");
  const targets = afterTargets.map((target) => {
    record(target, "cleanup after-target");
    const relative = safeRelative(target.path);
    assert(typeof target.exists === "boolean", "cleanup after-target existence is invalid");
    return {...target, path: relative};
  });
  assert(new Set(targets.map((target) => target.path)).size === targets.length, "cleanup after-target inventory contains duplicates");
  assert(targets.length === expectedPaths.length && targets.every((target) => expectedPaths.includes(target.path)), "cleanup after-target inventory does not match execution paths");
  samePathSet(targets.map((target) => target.path), manifestPaths, "cleanup after-target inventory");
  for (const target of targets) {
    const shouldExist = afterRemoved.includes(target.path) ? false : target.exists;
    assert(target.exists === shouldExist, `cleanup after-target state is inconsistent for ${target.path}`);
    const resolved = resolveTarget(resolvedRoot, target.path);
    assert(fs.existsSync(resolved.target) === shouldExist, `cleanup after-target filesystem state is inconsistent for ${target.path}`);
  }
  return {execution, afterState, afterTargets: targets};
}

export const planHygiene = compileHygieneDryRun;
export const runHygiene = executeHygiene;
