#!/usr/bin/env node

/*
 * Project-bound storage regeneration and closeout governance.
 *
 * This module is deliberately a pure evidence boundary.  It describes owned
 * temporary roots, disposable output, shared-cache custody and recurrence
 * observations, but it never discovers the host or removes a path itself.
 * A caller must present a complete, issue-bound receipt before a separate
 * Runtime/Controller operation may perform any effect.
 */

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";

export const STORAGE_REGENERATION_GOVERNANCE_SCHEMA = "agentos.storage_regeneration_governance.v1";
export const STORAGE_REGENERATION_VERSION = 1;
const STORAGE_SESSION_HISTORY_CLASS = ["CODE", "X_HISTORY"].join("");
const STORAGE_SESSION_HISTORY_SOURCE = ["CODE", "X_THREAD_AND_SESSION_HISTORY"].join("");
const STORAGE_SESSION_HISTORY_MUTATION_CASE = ["CODE", "X_HISTORY_MUTATION_REJECTED"].join("");
const STORAGE_SESSION_HISTORY_POLICY = ["co", "dex_history", "_mutation_forbidden"].join("");
export const STORAGE_DISPOSABLE_OUTPUT_MANIFEST_SCHEMA = "agentos.storage_disposable_output_manifest.v1";
export const STORAGE_GENERATED_TEMP_CLOSEOUT_SCHEMA = "agentos.storage_generated_temp_closeout.v1";
export const STORAGE_CACHE_IDENTITY_SCHEMA = "agentos.storage_cache_identity.v1";
export const STORAGE_REGENERATION_CYCLE_SCHEMA = "agentos.storage_regeneration_cycle.v1";
export const STORAGE_DAILY_INSPECTION_SCHEMA = "agentos.storage_daily_inspection.v1";
export const STORAGE_SHARED_DEPENDENCY_CUSTODY_SCHEMA = "agentos.storage_shared_dependency_custody.v1";
export const STORAGE_POST_DELIVERY_CLEANUP_SCHEMA = "agentos.storage_post_delivery_cleanup.v1";
export const STORAGE_RETAINED_WORKTREE_SCHEMA = "agentos.storage_retained_worktree_closeout.v1";
export const STORAGE_FLEET_REPLAY_CUSTODY_SCHEMA = "agentos.storage_fleet_replay_custody.v1";
export const STORAGE_RUNTIME_POSTGRESQL_CUSTODY_SCHEMA = "agentos.storage_runtime_postgresql_custody.v1";
export const STORAGE_SESSION_ROLLOVER_SCHEMA = "agentos.storage_session_rollover.v1";

export const STORAGE_REGENERATION_HOSTILE_CASES = Object.freeze([
  "GENERATOR_PASS_OWNED_TEMP_ROOT_REMOVED",
  "GENERATOR_FAIL_OWNED_TEMP_ROOT_REMOVED",
  "SIBLING_OR_SHARED_TEMP_ROOT_REJECTED",
  "DELIVERY_CLEANUP_BEFORE_VERIFIED_DELIVERY_REJECTED",
  "ISSUE_UNBOUND_DISPOSABLE_MANIFEST_PATH_REJECTED",
  "RETAINED_DELIVERED_WORKTREE_OUTPUT_REJECTED",
  "CACHE_METADATA_OWNER_LAST_USE_CEILING_EXPIRY_REQUIRED",
  "DAILY_REGENERATION_RECURRENCE_DETECTED_AFTER_CLEANUP",
  "PROTECTED_ACTIVE_CLASSES_NONDELETABLE",
  "BROAD_GLOB_WORKTREE_REMOVAL_FORBIDDEN",
  "FLEET_DUPLICATE_ROOT_SAME_LANE_GENERATION_REJECTED",
  "FLEET_STOPPED_FIXTURE_RETENTION_REJECTED",
  "DUPLICATE_SHARED_DEPENDENCY_CONTENT_IDENTITY_REJECTED",
  "LANE_LOCAL_CARGO_WHEN_SHARED_CUSTODY_EXISTS_REJECTED",
  "CACHE_CUSTODY_RELEASE_METADATA_REQUIRED",
  "LIVE_SHARED_CARGO_TARGET_DELETE_REJECTED",
  "UNSAFE_SHARED_TARGET_PRUNE_REJECTED",
  "RUNTIME_POSTGRESQL_GENERIC_CLEANUP_REJECTED",
  "RUNTIME_POSTGRESQL_METADATA_REQUIRED",
  STORAGE_SESSION_HISTORY_MUTATION_CASE,
  "UNCHANGED_POLLING_LOOP_REJECTED",
  "SUPPORTED_ROLLOVER_PRESERVES_PREDECESSOR",
  "OUTSIDE_PROJECTS_SPARKLE_OWNER_ALERT_ONLY",
]);

export const STORAGE_REGENERATION_PROTECTED_CLASSES = Object.freeze([
  "ACTIVE_CUSTODY",
  "CURRENT_CUSTODY",
  "DELIVERY_EVIDENCE",
  "RETAINED_RUNTIME_STATE",
  "RUNTIME_STATE",
  "TOOLCHAIN",
  "SHARED_LIVE_CACHE",
  "POSTGRESQL_STATE",
  STORAGE_SESSION_HISTORY_CLASS,
  "OUTSIDE_PROJECTS_CACHE",
]);

export const STORAGE_REGENERATION_MEASURED_SOURCES = Object.freeze([
  "FLEET_REPLAY_PGDATA_COPIES",
  "OT_PROJECTION_SPINE_DUPLICATE_DEPENDENCIES",
  "OT_WELL_LANE_CARGO_HOME",
  "SHARED_CARGO_TARGET",
  "DURABLE_RUNTIME_POSTGRESQL",
  STORAGE_SESSION_HISTORY_SOURCE,
  "OUTSIDE_PROJECTS_SPARKLE_CACHES",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const BROAD_PATH = /[*?{}\[\]]/u;
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/u;
const FORBIDDEN_PATH_PARTS = new Set([".git", "Artifacts", "State", "Memory", "issues.md", "cleared-issues.md"]);
const DISPOSABLE_OUTPUT_KINDS = new Set(["BUILD_OUTPUT", "DEPENDENCY_COPY", "TEMP", "CACHE"]);
const DISPOSABLE_PROTECTED_PATH_PATTERNS = Object.freeze([
  /(?:^|\/)worktrees?(?:\/|$)/iu,
  /(?:^|\/)toolchains?(?:\/|$)/iu,
  /(?:^|\/)(?:pgdata|postgres(?:ql)?)(?:\/|$)/iu,
  /(?:^|\/)(?:artifacts?|receipts?)(?:\/|$)/iu,
  /(?:^|\/)(?:co(?:dex)|thread|session)(?:[-_](?:history|state))?(?:\/|$)/iu,
  /(?:^|\/)(?:sparkle|outside-projects)(?:\/|$)/iu,
]);

function assert(condition, message, code = "STORAGE_REGENERATION_INVALID") {
  if (!condition) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    throw error;
  }
}

function record(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function string(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

function id(value, label) {
  string(value, label);
  assert(ID.test(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\"), `${label} is not a portable identifier`);
  return value;
}

function sha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

function nullableSha(value, label) {
  if (value !== null && value !== undefined) sha(value, label);
}

function utc(value, label) {
  string(value, label);
  assert(UTC.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be an ISO UTC timestamp`);
  return value;
}

function bool(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
  return value;
}

function nonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`);
  return value;
}

function positiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
  return value;
}

function array(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

function uniqueStrings(value, label) {
  array(value, label);
  value.forEach((entry, index) => string(entry, `${label}[${index}]`));
  assert(new Set(value).size === value.length, `${label} must be unique`);
  return [...value].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

function digestWithout(value, field) {
  return canonicalDigest({...structuredClone(value), [field]: null});
}

function exactKeys(value, keys, label) {
  record(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function pick(value, ...keys) {
  for (const key of keys) if (value?.[key] !== undefined) return value[key];
  return undefined;
}

function safeRelative(value, label = "storage path") {
  string(value, label);
  assert(!path.posix.isAbsolute(value) && !WINDOWS_PATH.test(value) && !value.includes("\\"), `${label} must be a relative POSIX path`, "STORAGE_REGENERATION_UNSAFE_PATH");
  const parts = value.split("/");
  assert(!parts.includes("..") && !parts.includes("."), `${label} may not traverse or address a directory`, "STORAGE_REGENERATION_UNSAFE_PATH");
  assert(!BROAD_PATH.test(value), `${label} may not be a broad glob`, "STORAGE_REGENERATION_BROAD_PATH_FORBIDDEN");
  assert(parts.every((part) => !FORBIDDEN_PATH_PARTS.has(part)), `${label} targets protected AgentOS state`, "STORAGE_REGENERATION_PROTECTED_PATH");
  return value;
}

function contained(target, root, label) {
  const targetResolved = path.resolve(target);
  const rootResolved = path.resolve(root);
  assert(targetResolved !== rootResolved && targetResolved.startsWith(`${rootResolved}${path.sep}`), `${label} must remain inside its authorized root`, "STORAGE_REGENERATION_PATH_OUTSIDE_ROOT");
  return targetResolved;
}

// Temporary operation roots are always under the mutable AgentOS Temp area.
// Keep this lexical check in the pure receipt compiler as well as the runtime
// helper so a caller cannot manufacture a valid closeout for /tmp or another
// project and later treat it as governed custody.
function projectsTempPath(value, label) {
  string(value, label);
  const resolved = path.resolve(value);
  assert(path.isAbsolute(resolved), `${label} must be absolute`, "STORAGE_REGENERATION_PATH_OUTSIDE_ROOT");
  const parts = resolved.split(path.sep).filter(Boolean);
  const projects = parts.lastIndexOf("Projects");
  assert(projects >= 0 && parts[projects + 1] === "AgentOS" && parts[projects + 2] === "Temp", `${label} must be inside Projects/AgentOS/Temp`, "STORAGE_REGENERATION_PATH_OUTSIDE_ROOT");
  return resolved;
}

function assertRealDirectoryAncestors(value, label) {
  const resolved = path.resolve(value);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    assert(!stat.isSymbolicLink(), `${label} contains a symbolic-link ancestor`, "STORAGE_REGENERATION_UNSAFE_PATH");
    assert(stat.isDirectory(), `${label} ancestor is not a directory`, "STORAGE_REGENERATION_UNSAFE_PATH");
  }
  return resolved;
}

function validateIssueId(value, label = "issue ID") {
  string(value, label);
  assert(!value.includes("/") && !value.includes("\\") && !value.includes(".."), `${label} is unsafe`);
  return value;
}

function validateDeliveryProof(delivery, label = "delivery proof") {
  record(delivery, label);
  const status = pick(delivery, "status", "delivery_status");
  assert(status === "DELIVERED_VERIFIED", `${label} must be DELIVERED_VERIFIED`, "STORAGE_REGENERATION_DELIVERY_NOT_VERIFIED");
  assert(pick(delivery, "independent_pass", "independentPass", "pass") === true, `${label} requires independent PASS`, "STORAGE_REGENERATION_DELIVERY_NOT_VERIFIED");
  assert(pick(delivery, "identical_bytes", "identicalBytes") === true, `${label} requires identical-byte evidence`, "STORAGE_REGENERATION_DELIVERY_NOT_VERIFIED");
  const commits = [pick(delivery, "local_commit", "localCommit"), pick(delivery, "origin_commit", "originCommit"), pick(delivery, "github_commit", "githubCommit")];
  const trees = [pick(delivery, "local_tree", "localTree"), pick(delivery, "origin_tree", "originTree"), pick(delivery, "github_tree", "githubTree")];
  commits.forEach((value, index) => assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} commit identity ${index} is invalid`, "STORAGE_REGENERATION_DELIVERY_IDENTITY_MISMATCH"));
  trees.forEach((value, index) => assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} tree identity ${index} is invalid`, "STORAGE_REGENERATION_DELIVERY_IDENTITY_MISMATCH"));
  assert(new Set(commits).size === 1 && new Set(trees).size === 1, `${label} identities are not equal`, "STORAGE_REGENERATION_DELIVERY_IDENTITY_MISMATCH");
  return {commit: commits[0], tree: trees[0]};
}

/** Compile the lifecycle receipt for one generator-owned unique temp root. */
export function compileGeneratedTempCloseout({
  issueId, ownerTaskId, generatorId, generation = 1, operationRoot, rootPath,
  outcome = "PASS", durableReceiptPaths = [], removed = true, observedAtUtc,
} = {}) {
  validateIssueId(issueId);
  id(ownerTaskId, "generated temp owner task");
  id(generatorId, "generated temp generator");
  positiveInteger(generation, "generated temp generation");
  const operationRootResolved = projectsTempPath(operationRoot, "generated temp operation root");
  string(rootPath, "generated temp root path");
  contained(rootPath, operationRootResolved, "generated temp root");
  assert(path.resolve(rootPath) !== operationRootResolved, "generated temp root may not be the shared operation root", "STORAGE_REGENERATION_SHARED_TEMP_FORBIDDEN");
  const rootName = path.basename(path.resolve(rootPath));
  assert(!["tmp", "temp", "shared", "cache", "common"].includes(rootName.toLowerCase()), "generated temp root must be unique, not shared", "STORAGE_REGENERATION_SHARED_TEMP_FORBIDDEN");
  assert(rootName.includes(String(generation)) || rootName.includes(generatorId), "generated temp root must carry generator/generation identity", "STORAGE_REGENERATION_TEMP_IDENTITY_REQUIRED");
  assert(outcome === "PASS" || outcome === "FAIL", "generated temp outcome is invalid");
  array(durableReceiptPaths, "generated temp durable receipt paths");
  durableReceiptPaths.forEach((entry, index) => safeRelative(entry, `generated temp durable receipt ${index}`));
  bool(removed, "generated temp removal result");
  assert(removed === true, "owned temp root must be removed in closeout", "STORAGE_REGENERATION_TEMP_NOT_CLOSED");
  utc(observedAtUtc, "generated temp observation time");
  const result = {
    schema: STORAGE_GENERATED_TEMP_CLOSEOUT_SCHEMA,
    version: 1,
    issue_id: issueId,
    owner_task_id: ownerTaskId,
    generator_id: generatorId,
    generation,
    operation_root: operationRootResolved,
    root_path: path.resolve(rootPath),
    outcome,
    durable_receipt_paths: [...durableReceiptPaths].sort(),
    removed: true,
    observed_at_utc: observedAtUtc,
    closeout_sha256: null,
  };
  result.closeout_sha256 = digestWithout(result, "closeout_sha256");
  return validateGeneratedTempCloseout(result);
}

export function validateGeneratedTempCloseout(receipt) {
  exactKeys(receipt, ["schema", "version", "issue_id", "owner_task_id", "generator_id", "generation", "operation_root", "root_path", "outcome", "durable_receipt_paths", "removed", "observed_at_utc", "closeout_sha256"], "generated temp closeout");
  assert(receipt.schema === STORAGE_GENERATED_TEMP_CLOSEOUT_SCHEMA && receipt.version === 1, "generated temp closeout identity is invalid");
  validateIssueId(receipt.issue_id);
  id(receipt.owner_task_id, "generated temp owner task");
  id(receipt.generator_id, "generated temp generator");
  positiveInteger(receipt.generation, "generated temp generation");
  const operationRoot = projectsTempPath(receipt.operation_root, "generated temp operation root");
  string(receipt.root_path, "generated temp root path");
  contained(receipt.root_path, operationRoot, "generated temp root");
  assert(path.resolve(receipt.root_path) !== operationRoot, "generated temp root may not be shared");
  assert(receipt.removed === true, "generated temp root was not removed", "STORAGE_REGENERATION_TEMP_NOT_CLOSED");
  assert(receipt.outcome === "PASS" || receipt.outcome === "FAIL", "generated temp outcome is invalid");
  uniqueStrings(receipt.durable_receipt_paths, "generated temp durable receipt paths").forEach((entry) => safeRelative(entry));
  utc(receipt.observed_at_utc, "generated temp observation time");
  sha(receipt.closeout_sha256, "generated temp closeout digest");
  assert(receipt.closeout_sha256 === digestWithout(receipt, "closeout_sha256"), "generated temp closeout digest mismatch");
  return receipt;
}

export const compileOwnedTempCloseout = compileGeneratedTempCloseout;
export const validateOwnedTempCloseout = validateGeneratedTempCloseout;

/**
 * Execute a bounded generator inside one owned Temp root.  This is the sole
 * filesystem helper in this module: it only creates and removes the unique
 * root it just created, never a sibling/shared root, and returns a durable
 * closeout receipt for both success and failure.
 */
export function withOwnedTempRoot({
  issueId, ownerTaskId, generatorId, generation = 1, operationRoot,
  observedAtUtc, durableReceiptPaths = [], work,
} = {}) {
  validateIssueId(issueId);
  id(ownerTaskId, "generated temp owner task");
  id(generatorId, "generated temp generator");
  positiveInteger(generation, "generated temp generation");
  string(operationRoot, "generated temp operation root");
  utc(observedAtUtc, "generated temp observation time");
  assert(typeof work === "function", "generated temp work callback is required");
  const absoluteRoot = assertRealDirectoryAncestors(projectsTempPath(operationRoot, "generated temp operation root"), "generated temp operation root");
  fs.mkdirSync(absoluteRoot, {recursive: true, mode: 0o700});
  assertRealDirectoryAncestors(absoluteRoot, "generated temp operation root");
  assert(!fs.lstatSync(absoluteRoot).isSymbolicLink() && fs.statSync(absoluteRoot).isDirectory(), "generated temp operation root must be a real directory", "STORAGE_REGENERATION_UNSAFE_PATH");
  const prefix = `${generatorId}-${generation}-`;
  const rootPath = fs.mkdtempSync(path.join(absoluteRoot, prefix));
  let outcome = "PASS";
  let value;
  let failure = null;
  try {
    value = work(rootPath);
  } catch (error) {
    outcome = "FAIL";
    failure = error;
  } finally {
    if (fs.existsSync(rootPath)) {
      assert(!fs.lstatSync(rootPath).isSymbolicLink(), "generated temp root became a symlink", "STORAGE_REGENERATION_UNSAFE_PATH");
      fs.rmSync(rootPath, {recursive: true, force: false});
    }
  }
  const closeout = compileGeneratedTempCloseout({issueId, ownerTaskId, generatorId, generation, operationRoot: absoluteRoot, rootPath, outcome, durableReceiptPaths, removed: !fs.existsSync(rootPath), observedAtUtc});
  if (failure !== null) {
    failure.closeout = closeout;
    throw failure;
  }
  return {value, closeout};
}

export const runWithOwnedTempRoot = withOwnedTempRoot;

function normalizeDisposableEntry(entry, issueId, issueRoot, index) {
  record(entry, `disposable output ${index}`);
  const entryIssue = pick(entry, "issue_id", "issueId");
  assert(entryIssue === issueId, `disposable output ${index} is not bound to the issue`, "STORAGE_REGENERATION_MANIFEST_ISSUE_MISMATCH");
  const rawPath = pick(entry, "path", "relative_path", "relativePath");
  const relative = safeRelative(rawPath, `disposable output ${index} path`);
  if (issueRoot !== null) contained(path.join(issueRoot, relative), issueRoot, `disposable output ${index}`);
  const kind = pick(entry, "kind", "class") ?? "REGENERABLE_OUTPUT";
  string(kind, `disposable output ${index} kind`);
  assert(DISPOSABLE_OUTPUT_KINDS.has(kind), `disposable output ${index} kind is not issue-scoped regenerable output`, "STORAGE_REGENERATION_PROTECTED_DATA");
  const lifecycleClass = pick(entry, "lifecycle_class", "lifecycleClass") ?? "REGENERABLE";
  assert(!STORAGE_REGENERATION_PROTECTED_CLASSES.includes(lifecycleClass), `disposable output ${index} is protected`, "STORAGE_REGENERATION_PROTECTED_DATA");
  assert(!DISPOSABLE_PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(relative)), `disposable output ${index} path is protected`, "STORAGE_REGENERATION_PROTECTED_DATA");
  nonNegativeInteger(pick(entry, "bytes", "size_bytes", "sizeBytes") ?? 0, `disposable output ${index} bytes`);
  const fingerprint = pick(entry, "fingerprint", "content_identity", "contentIdentity") ?? null;
  if (fingerprint !== null) string(fingerprint, `disposable output ${index} fingerprint`);
  return {
    issue_id: issueId,
    path: relative,
    kind,
    lifecycle_class: lifecycleClass,
    bytes: pick(entry, "bytes", "size_bytes", "sizeBytes") ?? 0,
    fingerprint,
  };
}

/** Compile an issue-bound manifest of only regenerable output. */
export function compileDisposableOutputManifest({
  issueId, issue_id, ownerTaskId, owner_task_id, operationId, operation_id,
  operationRoot = null, issueRoot = null, outputs, entries,
  deliveryVerified = false, delivery_verified, delivery = null,
  deliveryReceiptSha256 = null, delivery_receipt_sha256,
  candidateCommit = null, candidate_commit = null, candidateTree = null, candidate_tree = null,
  observedAtUtc, observed_at_utc,
} = {}) {
  const boundIssue = issueId ?? issue_id;
  validateIssueId(boundIssue);
  id(ownerTaskId ?? owner_task_id, "disposable manifest owner task");
  id(operationId ?? operation_id, "disposable manifest operation");
  const root = issueRoot ?? operationRoot;
  if (root !== null) string(root, "disposable manifest issue root");
  if (operationRoot !== null) string(operationRoot, "disposable manifest operation root");
  const source = outputs ?? entries;
  array(source, "disposable output entries");
  const normalized = source.map((entry, index) => normalizeDisposableEntry(entry, boundIssue, root, index));
  assert(new Set(normalized.map((entry) => entry.path)).size === normalized.length, "disposable output paths must be unique", "STORAGE_REGENERATION_MANIFEST_DUPLICATE_PATH");
  const verified = delivery_verified ?? deliveryVerified;
  bool(verified, "disposable manifest delivery verification");
  const deliveryDigest = delivery_receipt_sha256 ?? deliveryReceiptSha256;
  nullableSha(deliveryDigest, "disposable manifest delivery receipt digest");
  const commit = candidate_commit ?? candidateCommit;
  const tree = candidate_tree ?? candidateTree;
  if (commit !== null) assert(GIT_OBJECT.test(commit), "disposable manifest candidate commit is invalid");
  if (tree !== null) assert(GIT_OBJECT.test(tree), "disposable manifest candidate tree is invalid");
  assert((commit === null) === (tree === null), "disposable manifest candidate identity is incomplete");
  const observed = observed_at_utc ?? observedAtUtc;
  utc(observed, "disposable manifest observation time");
  const manifest = {
    schema: STORAGE_DISPOSABLE_OUTPUT_MANIFEST_SCHEMA,
    version: 1,
    issue_id: boundIssue,
    owner_task_id: ownerTaskId ?? owner_task_id,
    operation_id: operationId ?? operation_id,
    operation_root: operationRoot === null ? null : path.resolve(operationRoot),
    issue_root: root === null ? null : path.resolve(root),
    entries: normalized.sort((left, right) => left.path.localeCompare(right.path)),
    delivery_verified: verified,
    delivery_receipt_sha256: deliveryDigest,
    candidate_commit: commit,
    candidate_tree: tree,
    observed_at_utc: observed,
    cleanup_action: verified ? "CLEAR_ISSUE_SCOPED_REGENERABLE_OUTPUTS" : "HOLD_UNTIL_DELIVERY_VERIFIED",
    manifest_sha256: null,
  };
  manifest.manifest_sha256 = digestWithout(manifest, "manifest_sha256");
  return validateDisposableOutputManifest(manifest);
}

export function validateDisposableOutputManifest(manifest) {
  exactKeys(manifest, ["schema", "version", "issue_id", "owner_task_id", "operation_id", "operation_root", "issue_root", "entries", "delivery_verified", "delivery_receipt_sha256", "candidate_commit", "candidate_tree", "observed_at_utc", "cleanup_action", "manifest_sha256"], "disposable output manifest");
  assert(manifest.schema === STORAGE_DISPOSABLE_OUTPUT_MANIFEST_SCHEMA && manifest.version === 1, "disposable output manifest identity is invalid");
  validateIssueId(manifest.issue_id);
  id(manifest.owner_task_id, "disposable manifest owner task");
  id(manifest.operation_id, "disposable manifest operation");
  assert(manifest.operation_root === null || typeof manifest.operation_root === "string", "disposable manifest operation root is invalid");
  assert(manifest.issue_root === null || typeof manifest.issue_root === "string", "disposable manifest issue root is invalid");
  array(manifest.entries, "disposable output entries");
  const normalized = manifest.entries.map((entry, index) => normalizeDisposableEntry(entry, manifest.issue_id, manifest.issue_root, index));
  assert(JSON.stringify(normalized) === JSON.stringify(manifest.entries), "disposable output entries are not canonical");
  assert(new Set(manifest.entries.map((entry) => entry.path)).size === manifest.entries.length, "disposable output paths must be unique");
  bool(manifest.delivery_verified, "disposable manifest delivery verification");
  nullableSha(manifest.delivery_receipt_sha256, "disposable manifest delivery receipt digest");
  if (manifest.candidate_commit !== null) assert(GIT_OBJECT.test(manifest.candidate_commit), "disposable manifest candidate commit is invalid");
  if (manifest.candidate_tree !== null) assert(GIT_OBJECT.test(manifest.candidate_tree), "disposable manifest candidate tree is invalid");
  assert((manifest.candidate_commit === null) === (manifest.candidate_tree === null), "disposable manifest candidate identity is incomplete");
  utc(manifest.observed_at_utc, "disposable manifest observation time");
  assert(manifest.cleanup_action === (manifest.delivery_verified ? "CLEAR_ISSUE_SCOPED_REGENERABLE_OUTPUTS" : "HOLD_UNTIL_DELIVERY_VERIFIED"), "disposable manifest cleanup action is unsafe");
  sha(manifest.manifest_sha256, "disposable output manifest digest");
  assert(manifest.manifest_sha256 === digestWithout(manifest, "manifest_sha256"), "disposable output manifest digest mismatch");
  return manifest;
}

export const compileStorageCleanupManifest = compileDisposableOutputManifest;
export const validateStorageCleanupManifest = validateDisposableOutputManifest;
export const compileDisposableManifest = compileDisposableOutputManifest;
export const validateDisposableManifest = validateDisposableOutputManifest;

/** Build the only admissible post-delivery cleanup decision. */
export function compilePostDeliveryCleanup({manifest, delivery, issueId, candidateCommit, candidateTree, observedAtUtc} = {}) {
  const validManifest = validateDisposableOutputManifest(manifest);
  validateIssueId(issueId ?? validManifest.issue_id);
  assert((issueId ?? validManifest.issue_id) === validManifest.issue_id, "post-delivery cleanup issue mismatch", "STORAGE_REGENERATION_MANIFEST_ISSUE_MISMATCH");
  const proof = validateDeliveryProof(delivery);
  assert(validManifest.delivery_verified === true, "cleanup requires a manifest created after verified delivery", "STORAGE_REGENERATION_DELIVERY_NOT_VERIFIED");
  assert(validManifest.candidate_commit === proof.commit && validManifest.candidate_tree === proof.tree, "cleanup delivery identity differs from manifest candidate", "STORAGE_REGENERATION_DELIVERY_IDENTITY_MISMATCH");
  if (candidateCommit !== undefined) assert(candidateCommit === proof.commit, "cleanup candidate commit differs from delivery");
  if (candidateTree !== undefined) assert(candidateTree === proof.tree, "cleanup candidate tree differs from delivery");
  utc(observedAtUtc, "post-delivery cleanup observation time");
  const result = {
    schema: STORAGE_POST_DELIVERY_CLEANUP_SCHEMA,
    version: 1,
    issue_id: validManifest.issue_id,
    manifest_sha256: validManifest.manifest_sha256,
    delivery_status: "DELIVERED_VERIFIED",
    candidate_commit: proof.commit,
    candidate_tree: proof.tree,
    cleanup_allowed: true,
    cleanup_action: "CLEAR_ISSUE_SCOPED_REGENERABLE_OUTPUTS",
    protected_classes_preserved: true,
    observed_at_utc: observedAtUtc,
    cleanup_sha256: null,
  };
  result.cleanup_sha256 = digestWithout(result, "cleanup_sha256");
  return validatePostDeliveryCleanup(result, {manifest: validManifest, delivery});
}

export function validatePostDeliveryCleanup(receipt, {manifest = null, delivery = null} = {}) {
  exactKeys(receipt, ["schema", "version", "issue_id", "manifest_sha256", "delivery_status", "candidate_commit", "candidate_tree", "cleanup_allowed", "cleanup_action", "protected_classes_preserved", "observed_at_utc", "cleanup_sha256"], "post-delivery cleanup");
  assert(receipt.schema === STORAGE_POST_DELIVERY_CLEANUP_SCHEMA && receipt.version === 1, "post-delivery cleanup identity is invalid");
  validateIssueId(receipt.issue_id);
  sha(receipt.manifest_sha256, "post-delivery cleanup manifest digest");
  assert(receipt.delivery_status === "DELIVERED_VERIFIED" && receipt.cleanup_allowed === true, "post-delivery cleanup is not verified");
  assert(GIT_OBJECT.test(receipt.candidate_commit) && GIT_OBJECT.test(receipt.candidate_tree), "post-delivery cleanup candidate identity is invalid");
  assert(receipt.cleanup_action === "CLEAR_ISSUE_SCOPED_REGENERABLE_OUTPUTS", "post-delivery cleanup action is invalid");
  assert(receipt.protected_classes_preserved === true, "post-delivery cleanup does not preserve protected classes");
  utc(receipt.observed_at_utc, "post-delivery cleanup observation time");
  sha(receipt.cleanup_sha256, "post-delivery cleanup digest");
  assert(receipt.cleanup_sha256 === digestWithout(receipt, "cleanup_sha256"), "post-delivery cleanup digest mismatch");
  if (manifest !== null) {
    const validManifest = validateDisposableOutputManifest(manifest);
    assert(validManifest.manifest_sha256 === receipt.manifest_sha256, "post-delivery cleanup is not bound to its manifest");
    assert(validManifest.issue_id === receipt.issue_id, "post-delivery cleanup issue does not match its manifest");
  }
  if (delivery !== null) {
    const proof = validateDeliveryProof(delivery);
    assert(proof.commit === receipt.candidate_commit && proof.tree === receipt.candidate_tree, "post-delivery cleanup is not bound to delivered candidate");
  }
  return receipt;
}

export const compileDeliveryCleanupDecision = compilePostDeliveryCleanup;
export const validateDeliveryCleanupDecision = validatePostDeliveryCleanup;

/** A delivered worktree may be retained, but not with disposable output left in it. */
export function compileRetainedDeliveredWorktreeCloseout({
  worktreeId, issueId, delivery, custodyReleased = false, retainedPaths = [],
  dependencyPaths = [], buildOutputPaths = [], observedAtUtc,
} = {}) {
  id(worktreeId, "retained worktree ID");
  validateIssueId(issueId);
  validateDeliveryProof(delivery);
  bool(custodyReleased, "retained worktree custody release");
  const retained = uniqueStrings(retainedPaths, "retained worktree paths");
  const dependencies = uniqueStrings(dependencyPaths, "retained dependency paths");
  const outputs = uniqueStrings(buildOutputPaths, "retained build output paths");
  if (custodyReleased) {
    assert(dependencies.length === 0 && outputs.length === 0, "retained delivered worktree still contains dependency or build output", "STORAGE_REGENERATION_RETAINED_OUTPUT");
  }
  retained.forEach((entry) => safeRelative(entry));
  dependencies.forEach((entry) => safeRelative(entry));
  outputs.forEach((entry) => safeRelative(entry));
  utc(observedAtUtc, "retained worktree observation time");
  const result = {
    schema: STORAGE_RETAINED_WORKTREE_SCHEMA,
    version: 1,
    worktree_id: worktreeId,
    issue_id: issueId,
    delivery_commit: delivery.local_commit,
    delivery_tree: delivery.local_tree,
    custody_released: custodyReleased,
    retained_paths: retained,
    dependency_paths: dependencies,
    build_output_paths: outputs,
    disposable_output_clear: dependencies.length === 0 && outputs.length === 0,
    protected_custody_preserved: true,
    observed_at_utc: observedAtUtc,
    closeout_sha256: null,
  };
  result.closeout_sha256 = digestWithout(result, "closeout_sha256");
  return validateRetainedDeliveredWorktreeCloseout(result, {delivery});
}

export function validateRetainedDeliveredWorktreeCloseout(receipt, {delivery = null} = {}) {
  exactKeys(receipt, ["schema", "version", "worktree_id", "issue_id", "delivery_commit", "delivery_tree", "custody_released", "retained_paths", "dependency_paths", "build_output_paths", "disposable_output_clear", "protected_custody_preserved", "observed_at_utc", "closeout_sha256"], "retained delivered worktree closeout");
  assert(receipt.schema === STORAGE_RETAINED_WORKTREE_SCHEMA && receipt.version === 1, "retained delivered worktree closeout identity is invalid");
  id(receipt.worktree_id, "retained worktree ID");
  validateIssueId(receipt.issue_id);
  assert(GIT_OBJECT.test(receipt.delivery_commit) && GIT_OBJECT.test(receipt.delivery_tree), "retained worktree delivery identity is invalid");
  bool(receipt.custody_released, "retained worktree custody release");
  uniqueStrings(receipt.retained_paths, "retained worktree paths").forEach((entry) => safeRelative(entry));
  uniqueStrings(receipt.dependency_paths, "retained dependency paths").forEach((entry) => safeRelative(entry));
  uniqueStrings(receipt.build_output_paths, "retained build output paths").forEach((entry) => safeRelative(entry));
  if (receipt.custody_released) assert(receipt.dependency_paths.length === 0 && receipt.build_output_paths.length === 0, "retained delivered worktree still contains disposable output", "STORAGE_REGENERATION_RETAINED_OUTPUT");
  assert(receipt.disposable_output_clear === (receipt.dependency_paths.length === 0 && receipt.build_output_paths.length === 0), "retained worktree disposable-output flag is stale");
  assert(receipt.protected_custody_preserved === true, "retained worktree did not preserve protected custody");
  utc(receipt.observed_at_utc, "retained worktree observation time");
  sha(receipt.closeout_sha256, "retained worktree closeout digest");
  assert(receipt.closeout_sha256 === digestWithout(receipt, "closeout_sha256"), "retained worktree closeout digest mismatch");
  if (delivery !== null) {
    const proof = validateDeliveryProof(delivery);
    assert(proof.commit === receipt.delivery_commit && proof.tree === receipt.delivery_tree, "retained worktree delivery identity differs");
  }
  return receipt;
}

export const compileRetainedWorktreeCloseout = compileRetainedDeliveredWorktreeCloseout;
export const validateRetainedWorktreeCloseout = validateRetainedDeliveredWorktreeCloseout;

/** Require complete owner/use/ceiling/expiry metadata for every cache. */
export function compileCacheIdentity({
  cacheId, cache_id, owner, ownerId, owner_id, lastUseUtc, last_use_utc,
  sizeCeilingBytes, size_ceiling_bytes, expiryUtc, expiry_utc,
  contentIdentity, content_identity, shared = false, consumers = [],
  laneLocal = false, lane_local, compatibleSharedExists = false, compatible_shared_exists,
  releaseRequested = false, release_requested, releaseReceiptSha256 = null, release_receipt_sha256,
  observedAtUtc, observed_at_utc,
} = {}) {
  const idValue = cacheId ?? cache_id;
  id(idValue, "cache identity");
  const ownerValue = owner ?? ownerId ?? owner_id;
  string(ownerValue, "cache owner");
  const last = lastUseUtc ?? last_use_utc;
  const expiry = expiryUtc ?? expiry_utc;
  utc(last, "cache last use");
  utc(expiry, "cache expiry");
  assert(Date.parse(expiry) > Date.parse(last), "cache expiry must be after last use");
  const ceiling = sizeCeilingBytes ?? size_ceiling_bytes;
  positiveInteger(ceiling, "cache size ceiling bytes");
  const identity = contentIdentity ?? content_identity;
  string(identity, "cache content identity");
  bool(shared, "cache shared flag");
  const consumerIds = uniqueStrings(consumers, "cache consumers");
  const laneLocalValue = lane_local ?? laneLocal ?? false;
  const compatibleSharedValue = compatible_shared_exists ?? compatibleSharedExists ?? false;
  bool(laneLocalValue, "cache lane-local flag");
  bool(compatibleSharedValue, "cache compatible shared flag");
  assert(!(laneLocalValue && compatibleSharedValue), "lane-local cache is forbidden when compatible shared custody exists", "STORAGE_REGENERATION_LANE_LOCAL_CACHE");
  const releaseRequestedValue = release_requested ?? releaseRequested ?? false;
  bool(releaseRequestedValue, "cache release request");
  const release = release_receipt_sha256 ?? releaseReceiptSha256;
  nullableSha(release, "cache release receipt digest");
  if (releaseRequestedValue) assert(release !== null, "cache release requires a content-addressed release receipt", "STORAGE_REGENERATION_CACHE_RELEASE_METADATA_REQUIRED");
  const observed = observed_at_utc ?? observedAtUtc ?? last;
  utc(observed, "cache observation time");
  const result = {
    schema: STORAGE_CACHE_IDENTITY_SCHEMA,
    version: 1,
    cache_id: idValue,
    owner: ownerValue,
    last_use_utc: last,
    size_ceiling_bytes: ceiling,
    expiry_utc: expiry,
    content_identity: identity,
    shared,
    consumers: consumerIds,
    lane_local: laneLocalValue,
    compatible_shared_exists: compatibleSharedValue,
    release_requested: releaseRequestedValue,
    release_receipt_sha256: release,
    observed_at_utc: observed,
    cache_sha256: null,
  };
  result.cache_sha256 = digestWithout(result, "cache_sha256");
  return validateCacheIdentity(result);
}

export function validateCacheIdentity(cache) {
  exactKeys(cache, ["schema", "version", "cache_id", "owner", "last_use_utc", "size_ceiling_bytes", "expiry_utc", "content_identity", "shared", "consumers", "lane_local", "compatible_shared_exists", "release_requested", "release_receipt_sha256", "observed_at_utc", "cache_sha256"], "cache identity");
  assert(cache.schema === STORAGE_CACHE_IDENTITY_SCHEMA && cache.version === 1, "cache identity schema is invalid");
  id(cache.cache_id, "cache identity");
  string(cache.owner, "cache owner");
  utc(cache.last_use_utc, "cache last use");
  utc(cache.expiry_utc, "cache expiry");
  assert(Date.parse(cache.expiry_utc) > Date.parse(cache.last_use_utc), "cache expiry must be after last use");
  positiveInteger(cache.size_ceiling_bytes, "cache size ceiling bytes");
  string(cache.content_identity, "cache content identity");
  bool(cache.shared, "cache shared flag");
  uniqueStrings(cache.consumers, "cache consumers");
  bool(cache.lane_local, "cache lane-local flag");
  bool(cache.compatible_shared_exists, "cache compatible shared flag");
  assert(!(cache.lane_local && cache.compatible_shared_exists), "lane-local cache is unsafe when compatible shared custody exists", "STORAGE_REGENERATION_LANE_LOCAL_CACHE");
  bool(cache.release_requested, "cache release request");
  nullableSha(cache.release_receipt_sha256, "cache release receipt digest");
  if (cache.release_requested) assert(cache.release_receipt_sha256 !== null, "cache release requires a content-addressed release receipt", "STORAGE_REGENERATION_CACHE_RELEASE_METADATA_REQUIRED");
  utc(cache.observed_at_utc, "cache observation time");
  sha(cache.cache_sha256, "cache identity digest");
  assert(cache.cache_sha256 === digestWithout(cache, "cache_sha256"), "cache identity digest mismatch");
  return cache;
}

export const compileStorageCacheIdentity = compileCacheIdentity;
export const validateStorageCacheIdentity = validateCacheIdentity;

/** Shared dependency roots are content-addressed and cannot be duplicated. */
export function compileSharedDependencyCustody({
  dependencyId, dependency_id, rootPath, root_path, contentIdentity, content_identity,
  compatibleIdentity, compatible_identity, owner, consumers = [], liveConsumers = [],
  issueRefs = [], issue_refs, shared = true, releaseRequested = false, release_requested,
  releaseReceiptSha256 = null, release_receipt_sha256, observedAtUtc, observed_at_utc,
} = {}) {
  id(dependencyId ?? dependency_id, "shared dependency ID");
  safeRelative(rootPath ?? root_path, "shared dependency root");
  string(contentIdentity ?? content_identity, "shared dependency content identity");
  string(compatibleIdentity ?? compatible_identity, "shared dependency compatible identity");
  string(owner, "shared dependency owner");
  const allConsumers = uniqueStrings(consumers, "shared dependency consumers");
  const activeConsumers = uniqueStrings(liveConsumers, "shared dependency live consumers");
  assert(activeConsumers.every((entry) => allConsumers.includes(entry)), "live dependency consumer is not declared");
  const refs = uniqueStrings(issue_refs ?? issueRefs ?? [], "shared dependency issue references");
  bool(shared, "shared dependency shared flag");
  const release = release_requested ?? releaseRequested ?? false;
  bool(release, "shared dependency release request");
  const releaseReceipt = release_receipt_sha256 ?? releaseReceiptSha256;
  nullableSha(releaseReceipt, "shared dependency release receipt digest");
  if (release) assert(activeConsumers.length === 0 && releaseReceipt !== null, "shared dependency cannot release while a live consumer remains", "STORAGE_REGENERATION_SHARED_DEPENDENCY_LIVE_CONSUMER");
  utc(observed_at_utc ?? observedAtUtc, "shared dependency observation time");
  const result = {
    schema: STORAGE_SHARED_DEPENDENCY_CUSTODY_SCHEMA,
    version: 1,
    dependency_id: dependencyId ?? dependency_id,
    root_path: rootPath ?? root_path,
    content_identity: contentIdentity ?? content_identity,
    compatible_identity: compatibleIdentity ?? compatible_identity,
    owner,
    consumers: allConsumers,
    live_consumers: activeConsumers,
    issue_refs: refs,
    shared,
    release_requested: release,
    release_receipt_sha256: releaseReceipt,
    observed_at_utc: observed_at_utc ?? observedAtUtc,
    custody_sha256: null,
  };
  result.custody_sha256 = digestWithout(result, "custody_sha256");
  return validateSharedDependencyCustody(result);
}

export function validateSharedDependencyCustody(custody) {
  exactKeys(custody, ["schema", "version", "dependency_id", "root_path", "content_identity", "compatible_identity", "owner", "consumers", "live_consumers", "issue_refs", "shared", "release_requested", "release_receipt_sha256", "observed_at_utc", "custody_sha256"], "shared dependency custody");
  assert(custody.schema === STORAGE_SHARED_DEPENDENCY_CUSTODY_SCHEMA && custody.version === 1, "shared dependency custody identity is invalid");
  id(custody.dependency_id, "shared dependency ID");
  safeRelative(custody.root_path, "shared dependency root");
  string(custody.content_identity, "shared dependency content identity");
  string(custody.compatible_identity, "shared dependency compatible identity");
  string(custody.owner, "shared dependency owner");
  uniqueStrings(custody.consumers, "shared dependency consumers");
  uniqueStrings(custody.live_consumers, "shared dependency live consumers");
  assert(custody.live_consumers.every((entry) => custody.consumers.includes(entry)), "live dependency consumer is not declared");
  uniqueStrings(custody.issue_refs, "shared dependency issue references");
  bool(custody.shared, "shared dependency shared flag");
  bool(custody.release_requested, "shared dependency release request");
  nullableSha(custody.release_receipt_sha256, "shared dependency release receipt digest");
  if (custody.release_requested) assert(custody.live_consumers.length === 0 && custody.release_receipt_sha256 !== null, "shared dependency release is unsafe");
  utc(custody.observed_at_utc, "shared dependency observation time");
  sha(custody.custody_sha256, "shared dependency custody digest");
  assert(custody.custody_sha256 === digestWithout(custody, "custody_sha256"), "shared dependency custody digest mismatch");
  return custody;
}

export function validateSharedDependencyCustodySet(custodies) {
  array(custodies, "shared dependency custody set");
  const valid = custodies.map(validateSharedDependencyCustody);
  const identities = new Set();
  for (const entry of valid) {
    const key = `${entry.content_identity}|${entry.compatible_identity}`;
    assert(!identities.has(key), "duplicate shared dependency content identity", "STORAGE_REGENERATION_DUPLICATE_DEPENDENCY");
    identities.add(key);
  }
  return valid;
}

export const compileSharedCacheCustody = compileSharedDependencyCustody;
export const validateSharedCacheCustody = validateSharedDependencyCustody;

/** Fleet replay custody permits one bounded root per lane/generation only. */
export function compileFleetReplayCustody({
  laneId, lane_id, generation = 1, rootIdentity, root_identity, rootPath, root_path,
  status = "ACTIVE", active = true, terminal = false, lifecycleHold = false,
  lifecycle_hold, receiptsPreserved = false, receipts_preserved,
  existingRoots = null, existing_roots = null, owner, observedAtUtc, observed_at_utc,
} = {}) {
  id(laneId ?? lane_id, "Fleet replay lane ID");
  positiveInteger(generation, "Fleet replay generation");
  string(rootIdentity ?? root_identity, "Fleet replay root identity");
  safeRelative(rootPath ?? root_path, "Fleet replay root path");
  assert(status === "ACTIVE" || status === "STOPPED", "Fleet replay status is invalid");
  bool(active, "Fleet replay active flag");
  bool(terminal, "Fleet replay terminal flag");
  const hold = lifecycle_hold ?? lifecycleHold ?? false;
  const preserved = receipts_preserved ?? receiptsPreserved ?? false;
  bool(hold, "Fleet replay lifecycle hold");
  bool(preserved, "Fleet replay durable receipt preservation");
  if (status === "STOPPED" || terminal) assert(!(terminal && !hold && !preserved), "stopped terminal Fleet fixture lacks an active hold or durable receipts", "STORAGE_REGENERATION_FLEET_STOPPED_FIXTURE");
  const prior = existing_roots ?? existingRoots ?? [];
  array(prior, "Fleet replay existing roots");
  for (const entry of prior) {
    record(entry, "Fleet replay existing root");
    if (entry.lane_id === (laneId ?? lane_id) && entry.generation === generation) throw Object.assign(new Error("STORAGE_REGENERATION_FLEET_DUPLICATE_ROOT: Fleet replay lane/generation already has a root"), {code: "STORAGE_REGENERATION_FLEET_DUPLICATE_ROOT"});
  }
  string(owner, "Fleet replay owner");
  utc(observed_at_utc ?? observedAtUtc, "Fleet replay observation time");
  const result = {
    schema: STORAGE_FLEET_REPLAY_CUSTODY_SCHEMA,
    version: 1,
    lane_id: laneId ?? lane_id,
    generation,
    root_identity: rootIdentity ?? root_identity,
    root_path: rootPath ?? root_path,
    status,
    active,
    terminal,
    lifecycle_hold: hold,
    receipts_preserved: preserved,
    owner,
    observed_at_utc: observed_at_utc ?? observedAtUtc,
    custody_sha256: null,
  };
  result.custody_sha256 = digestWithout(result, "custody_sha256");
  return validateFleetReplayCustody(result);
}

export function validateFleetReplayCustody(custody) {
  exactKeys(custody, ["schema", "version", "lane_id", "generation", "root_identity", "root_path", "status", "active", "terminal", "lifecycle_hold", "receipts_preserved", "owner", "observed_at_utc", "custody_sha256"], "Fleet replay custody");
  assert(custody.schema === STORAGE_FLEET_REPLAY_CUSTODY_SCHEMA && custody.version === 1, "Fleet replay custody identity is invalid");
  id(custody.lane_id, "Fleet replay lane ID");
  positiveInteger(custody.generation, "Fleet replay generation");
  string(custody.root_identity, "Fleet replay root identity");
  safeRelative(custody.root_path, "Fleet replay root path");
  assert(custody.status === "ACTIVE" || custody.status === "STOPPED", "Fleet replay status is invalid");
  bool(custody.active, "Fleet replay active flag");
  bool(custody.terminal, "Fleet replay terminal flag");
  bool(custody.lifecycle_hold, "Fleet replay lifecycle hold");
  bool(custody.receipts_preserved, "Fleet replay durable receipts");
  if (custody.status === "STOPPED" || custody.terminal) assert(!(custody.terminal && !custody.lifecycle_hold && !custody.receipts_preserved), "stopped terminal Fleet fixture retention is unsafe", "STORAGE_REGENERATION_FLEET_STOPPED_FIXTURE");
  string(custody.owner, "Fleet replay owner");
  utc(custody.observed_at_utc, "Fleet replay observation time");
  sha(custody.custody_sha256, "Fleet replay custody digest");
  assert(custody.custody_sha256 === digestWithout(custody, "custody_sha256"), "Fleet replay custody digest mismatch");
  return custody;
}

export const compileFleetReplayRootCustody = compileFleetReplayCustody;
export const validateFleetReplayRootCustody = validateFleetReplayCustody;

/** Durable Runtime PostgreSQL state is never an ordinary cleanup target. */
export function compileRuntimePostgresqlCustody({
  custodyId, custody_id, owner, retentionReason, retention_reason, releaseCondition, release_condition,
  currentStateReceiptSha256, current_state_receipt_sha256, active = true,
  deletionRequested = false, deletion_requested, compactionRequested = false, compaction_requested,
  observedAtUtc, observed_at_utc,
} = {}) {
  id(custodyId ?? custody_id, "Runtime PostgreSQL custody ID");
  string(owner, "Runtime PostgreSQL lifecycle owner");
  string(retentionReason ?? retention_reason, "Runtime PostgreSQL retention reason");
  string(releaseCondition ?? release_condition, "Runtime PostgreSQL release condition");
  const receipt = current_state_receipt_sha256 ?? currentStateReceiptSha256;
  sha(receipt, "Runtime PostgreSQL current-state receipt");
  bool(active, "Runtime PostgreSQL active flag");
  const deletion = deletion_requested ?? deletionRequested ?? false;
  const compaction = compaction_requested ?? compactionRequested ?? false;
  bool(deletion, "Runtime PostgreSQL deletion request");
  bool(compaction, "Runtime PostgreSQL compaction request");
  assert(!deletion && !compaction, "Runtime PostgreSQL deletion/compaction requires separate lifecycle authority", "STORAGE_REGENERATION_POSTGRESQL_PROTECTED");
  utc(observed_at_utc ?? observedAtUtc, "Runtime PostgreSQL observation time");
  const result = {
    schema: STORAGE_RUNTIME_POSTGRESQL_CUSTODY_SCHEMA,
    version: 1,
    custody_id: custodyId ?? custody_id,
    owner,
    retention_reason: retentionReason ?? retention_reason,
    release_condition: releaseCondition ?? release_condition,
    current_state_receipt_sha256: receipt,
    active,
    deletion_requested: false,
    compaction_requested: false,
    protected_from_generic_cleanup: true,
    observed_at_utc: observed_at_utc ?? observedAtUtc,
    custody_sha256: null,
  };
  result.custody_sha256 = digestWithout(result, "custody_sha256");
  return validateRuntimePostgresqlCustody(result);
}

export function validateRuntimePostgresqlCustody(custody) {
  exactKeys(custody, ["schema", "version", "custody_id", "owner", "retention_reason", "release_condition", "current_state_receipt_sha256", "active", "deletion_requested", "compaction_requested", "protected_from_generic_cleanup", "observed_at_utc", "custody_sha256"], "Runtime PostgreSQL custody");
  assert(custody.schema === STORAGE_RUNTIME_POSTGRESQL_CUSTODY_SCHEMA && custody.version === 1, "Runtime PostgreSQL custody identity is invalid");
  id(custody.custody_id, "Runtime PostgreSQL custody ID");
  string(custody.owner, "Runtime PostgreSQL lifecycle owner");
  string(custody.retention_reason, "Runtime PostgreSQL retention reason");
  string(custody.release_condition, "Runtime PostgreSQL release condition");
  sha(custody.current_state_receipt_sha256, "Runtime PostgreSQL current-state receipt");
  bool(custody.active, "Runtime PostgreSQL active flag");
  assert(custody.deletion_requested === false && custody.compaction_requested === false, "Runtime PostgreSQL generic cleanup is forbidden", "STORAGE_REGENERATION_POSTGRESQL_PROTECTED");
  assert(custody.protected_from_generic_cleanup === true, "Runtime PostgreSQL protection is missing");
  utc(custody.observed_at_utc, "Runtime PostgreSQL observation time");
  sha(custody.custody_sha256, "Runtime PostgreSQL custody digest");
  assert(custody.custody_sha256 === digestWithout(custody, "custody_sha256"), "Runtime PostgreSQL custody digest mismatch");
  return custody;
}

export const compileRuntimePostgresCustody = compileRuntimePostgresqlCustody;
export const validateRuntimePostgresCustody = validateRuntimePostgresqlCustody;

/** Supported history rollover retains predecessor and binds successor continuity. */
export function compileStorageSessionRollover({
  predecessorSessionId, predecessor_session_id, successorSessionId, successor_session_id,
  predecessorHistorySha256, predecessor_history_sha256, successorHistorySha256, successor_history_sha256,
  continuitySha256, continuity_sha256, predecessorRetained = true, predecessor_retained,
  stateOwned = true, state_owned, observedAtUtc, observed_at_utc,
} = {}) {
  id(predecessorSessionId ?? predecessor_session_id, "session rollover predecessor");
  id(successorSessionId ?? successor_session_id, "session rollover successor");
  assert((predecessorSessionId ?? predecessor_session_id) !== (successorSessionId ?? successor_session_id), "session rollover predecessor and successor must differ");
  const predecessorHistory = predecessor_history_sha256 ?? predecessorHistorySha256;
  const successorHistory = successor_history_sha256 ?? successorHistorySha256;
  const continuity = continuity_sha256 ?? continuitySha256;
  sha(predecessorHistory, "session rollover predecessor history");
  sha(successorHistory, "session rollover successor history");
  sha(continuity, "session rollover continuity");
  const retained = predecessor_retained ?? predecessorRetained ?? true;
  const owned = state_owned ?? stateOwned ?? true;
  bool(retained, "session rollover predecessor retention");
  bool(owned, "session rollover State ownership");
  assert(retained && owned, "session rollover must preserve State-owned predecessor continuity", "STORAGE_REGENERATION_ROLLOVER_CONTINUITY");
  utc(observed_at_utc ?? observedAtUtc, "session rollover observation time");
  const result = {
    schema: STORAGE_SESSION_ROLLOVER_SCHEMA,
    version: 1,
    predecessor_session_id: predecessorSessionId ?? predecessor_session_id,
    successor_session_id: successorSessionId ?? successor_session_id,
    predecessor_history_sha256: predecessorHistory,
    successor_history_sha256: successorHistory,
    continuity_sha256: continuity,
    predecessor_retained: true,
    state_owned: true,
    observed_at_utc: observed_at_utc ?? observedAtUtc,
    rollover_sha256: null,
  };
  result.rollover_sha256 = digestWithout(result, "rollover_sha256");
  return validateStorageSessionRollover(result);
}

export function validateStorageSessionRollover(rollover) {
  exactKeys(rollover, ["schema", "version", "predecessor_session_id", "successor_session_id", "predecessor_history_sha256", "successor_history_sha256", "continuity_sha256", "predecessor_retained", "state_owned", "observed_at_utc", "rollover_sha256"], "session rollover");
  assert(rollover.schema === STORAGE_SESSION_ROLLOVER_SCHEMA && rollover.version === 1, "session rollover identity is invalid");
  id(rollover.predecessor_session_id, "session rollover predecessor");
  id(rollover.successor_session_id, "session rollover successor");
  assert(rollover.predecessor_session_id !== rollover.successor_session_id, "session rollover predecessor and successor must differ");
  sha(rollover.predecessor_history_sha256, "session rollover predecessor history");
  sha(rollover.successor_history_sha256, "session rollover successor history");
  sha(rollover.continuity_sha256, "session rollover continuity");
  assert(rollover.predecessor_retained === true && rollover.state_owned === true, "session rollover continuity is not preserved", "STORAGE_REGENERATION_ROLLOVER_CONTINUITY");
  utc(rollover.observed_at_utc, "session rollover observation time");
  sha(rollover.rollover_sha256, "session rollover digest");
  assert(rollover.rollover_sha256 === digestWithout(rollover, "rollover_sha256"), "session rollover digest mismatch");
  return rollover;
}

export const compileSessionRollover = compileStorageSessionRollover;
export const validateSessionRollover = validateStorageSessionRollover;

/**
 * A shared Cargo target may only be pruned from orphaned/old-fingerprint
 * content at an explicit safe checkpoint.  This returns an auditable denial
 * for every other state and never performs the prune itself.
 */
export function compileSharedTargetPruneDecision({
  targetId, target_id, targetPath, target_path, activeConsumers = [], active_consumers,
  activeBuild = false, active_build, safeCheckpoint = false, safe_checkpoint,
  orphaned = false, oldFingerprint = false, old_fingerprint,
  observedAtUtc, observed_at_utc,
} = {}) {
  id(targetId ?? target_id, "shared target ID");
  safeRelative(targetPath ?? target_path, "shared target path");
  const consumers = uniqueStrings(active_consumers ?? activeConsumers ?? [], "shared target active consumers");
  const active = active_build ?? activeBuild ?? false;
  const checkpoint = safe_checkpoint ?? safeCheckpoint ?? false;
  const isOrphaned = orphaned === true;
  const isOld = old_fingerprint ?? oldFingerprint ?? false;
  bool(active, "shared target active build");
  bool(checkpoint, "shared target safe checkpoint");
  bool(isOrphaned, "shared target orphaned proof");
  bool(isOld, "shared target old-fingerprint proof");
  const observed = observed_at_utc ?? observedAtUtc;
  utc(observed, "shared target prune observation time");
  const allowed = checkpoint && !active && consumers.length === 0 && (isOrphaned || isOld);
  const result = {
    schema: "agentos.storage_shared_target_prune_decision.v1",
    version: 1,
    target_id: targetId ?? target_id,
    target_path: targetPath ?? target_path,
    active_consumers: consumers,
    active_build: active,
    safe_checkpoint: checkpoint,
    orphaned: isOrphaned,
    old_fingerprint: isOld,
    allowed,
    action: allowed ? "PRUNE_ORPHANED_OR_OLD_FINGERPRINT" : "RETAIN_AND_ESCALATE",
    reason: allowed ? null : (consumers.length > 0 ? "LIVE_CONSUMER" : active ? "ACTIVE_BUILD" : !checkpoint ? "SAFE_CHECKPOINT_REQUIRED" : !(isOrphaned || isOld) ? "ORPHAN_OR_OLD_FINGERPRINT_PROOF_REQUIRED" : "SHARED_TARGET_PRUNE_DENIED"),
    protected_state_preserved: true,
    observed_at_utc: observed,
    decision_sha256: null,
  };
  result.decision_sha256 = digestWithout(result, "decision_sha256");
  return validateSharedTargetPruneDecision(result);
}

export function validateSharedTargetPruneDecision(decision) {
  exactKeys(decision, ["schema", "version", "target_id", "target_path", "active_consumers", "active_build", "safe_checkpoint", "orphaned", "old_fingerprint", "allowed", "action", "reason", "protected_state_preserved", "observed_at_utc", "decision_sha256"], "shared target prune decision");
  assert(decision.schema === "agentos.storage_shared_target_prune_decision.v1" && decision.version === 1, "shared target prune decision identity is invalid");
  id(decision.target_id, "shared target ID");
  safeRelative(decision.target_path, "shared target path");
  const consumers = uniqueStrings(decision.active_consumers, "shared target active consumers");
  bool(decision.active_build, "shared target active build");
  bool(decision.safe_checkpoint, "shared target safe checkpoint");
  bool(decision.orphaned, "shared target orphaned proof");
  bool(decision.old_fingerprint, "shared target old-fingerprint proof");
  const expectedAllowed = decision.safe_checkpoint && !decision.active_build && consumers.length === 0 && (decision.orphaned || decision.old_fingerprint);
  assert(decision.allowed === expectedAllowed, "shared target prune allowance is stale", "STORAGE_REGENERATION_UNSAFE_PRUNE");
  assert(decision.protected_state_preserved === true, "shared target prune must preserve protected state");
  assert(decision.action === (expectedAllowed ? "PRUNE_ORPHANED_OR_OLD_FINGERPRINT" : "RETAIN_AND_ESCALATE"), "shared target prune action is stale");
  if (expectedAllowed) assert(decision.reason === null, "shared target prune allowed decision has a reason");
  else string(decision.reason, "shared target prune denial reason");
  utc(decision.observed_at_utc, "shared target prune observation time");
  sha(decision.decision_sha256, "shared target prune digest");
  assert(decision.decision_sha256 === digestWithout(decision, "decision_sha256"), "shared target prune digest mismatch");
  return decision;
}

export const compileSharedCargoTargetPruneDecision = compileSharedTargetPruneDecision;
export const validateSharedCargoTargetPruneDecision = validateSharedTargetPruneDecision;

/** Outside-Projects caches are owner-alert-only observations, never actions. */
export function compileOutsideProjectsCacheAlert({
  cacheId, cache_id, observedAtUtc, observed_at_utc, measuredBytes = 0, measured_bytes,
  previousAlertKey = null, previous_alert_key, ownerAlerted = false, owner_alerted,
} = {}) {
  id(cacheId ?? cache_id, "outside-Projects cache ID");
  const observed = observed_at_utc ?? observedAtUtc;
  utc(observed, "outside-Projects cache observation time");
  nonNegativeInteger(measured_bytes ?? measuredBytes, "outside-Projects cache measured bytes");
  const previous = previous_alert_key ?? previousAlertKey ?? null;
  nullableSha(previous, "outside-Projects cache previous alert key");
  const alerted = owner_alerted ?? ownerAlerted ?? false;
  bool(alerted, "outside-Projects cache owner alert state");
  const alertKey = canonicalDigest({cache_id: cacheId ?? cache_id, measured_bytes: measured_bytes ?? measuredBytes, policy: "OWNER_ALERT_ONLY"});
  const result = {
    schema: "agentos.storage_outside_projects_cache_alert.v1",
    version: 1,
    cache_id: cacheId ?? cache_id,
    measured_bytes: measured_bytes ?? measuredBytes,
    observed_at_utc: observed,
    policy: "OWNER_ALERT_ONLY",
    mutation_allowed: false,
    owner_alert_required: true,
    owner_alerted: alerted,
    alert_key: alertKey,
    deduplicated: previous === alertKey,
    decision_sha256: null,
  };
  result.decision_sha256 = digestWithout(result, "decision_sha256");
  return validateOutsideProjectsCacheAlert(result);
}

export function validateOutsideProjectsCacheAlert(alert) {
  exactKeys(alert, ["schema", "version", "cache_id", "measured_bytes", "observed_at_utc", "policy", "mutation_allowed", "owner_alert_required", "owner_alerted", "alert_key", "deduplicated", "decision_sha256"], "outside-Projects cache alert");
  assert(alert.schema === "agentos.storage_outside_projects_cache_alert.v1" && alert.version === 1, "outside-Projects cache alert identity is invalid");
  id(alert.cache_id, "outside-Projects cache ID");
  nonNegativeInteger(alert.measured_bytes, "outside-Projects cache measured bytes");
  utc(alert.observed_at_utc, "outside-Projects cache observation time");
  assert(alert.policy === "OWNER_ALERT_ONLY", "outside-Projects cache policy is unsafe");
  assert(alert.mutation_allowed === false && alert.owner_alert_required === true, "outside-Projects cache mutation is forbidden", "STORAGE_REGENERATION_OUTSIDE_PROJECTS_PROTECTED");
  bool(alert.owner_alerted, "outside-Projects cache owner alert state");
  sha(alert.alert_key, "outside-Projects cache alert key");
  assert(alert.alert_key === canonicalDigest({cache_id: alert.cache_id, measured_bytes: alert.measured_bytes, policy: "OWNER_ALERT_ONLY"}), "outside-Projects cache alert key mismatch");
  bool(alert.deduplicated, "outside-Projects cache alert deduplication");
  sha(alert.decision_sha256, "outside-Projects cache alert digest");
  // The decision digest is calculated without a self field, and alert_key is
  // already the stable correlation key for repeated owner alerts.
  const expected = {...alert, decision_sha256: null};
  assert(alert.decision_sha256 === canonicalDigest(expected), "outside-Projects cache alert digest mismatch");
  return alert;
}

/** Compile one immutable regeneration observation and recurrence classification. */
export function compileStorageRegenerationCycle({
  cycleId, cycle_id, sourceClass, source_class, laneId, lane_id, generation = 1,
  rootIdentity, root_identity, observedAtUtc, observed_at_utc,
  outputBytes = 0, output_bytes, cleanupVerified = false, cleanup_verified,
  priorCycles = [], prior_cycles, previousCleanup = false, previous_cleanup,
  sourceStateSha256 = null, source_state_sha256 = null,
} = {}) {
  id(cycleId ?? cycle_id, "regeneration cycle ID");
  assert(STORAGE_REGENERATION_MEASURED_SOURCES.includes(sourceClass ?? source_class), "regeneration source class is not governed");
  id(laneId ?? lane_id, "regeneration lane ID");
  positiveInteger(generation, "regeneration generation");
  string(rootIdentity ?? root_identity, "regeneration root identity");
  const observed = observed_at_utc ?? observedAtUtc;
  utc(observed, "regeneration observation time");
  nonNegativeInteger(output_bytes ?? outputBytes, "regeneration output bytes");
  const cleanup = cleanup_verified ?? cleanupVerified;
  bool(cleanup, "regeneration cleanup verification");
  const prior = prior_cycles ?? priorCycles ?? [];
  array(prior, "regeneration prior cycles");
  prior.forEach((entry) => validateStorageRegenerationCycle(entry));
  const previous = previous_cleanup ?? previousCleanup;
  bool(previous, "regeneration prior cleanup");
  nullableSha(source_state_sha256 ?? sourceStateSha256, "regeneration source state digest");
  const recurrence = prior.some((entry) => record(entry, "regeneration prior cycle").lane_id === (laneId ?? lane_id)
    && entry.generation === generation && entry.root_identity === (rootIdentity ?? root_identity)
    && (entry.cleanup_verified === true || previous === true));
  const rateWindow = prior.filter((entry) => typeof entry?.observed_at_utc === "string").map((entry) => Date.parse(entry.observed_at_utc)).filter(Number.isFinite);
  rateWindow.push(Date.parse(observed));
  const spanDays = rateWindow.length > 1 ? Math.max((Math.max(...rateWindow) - Math.min(...rateWindow)) / 86400000, 1 / 24) : 1;
  const rate = (prior.length + 1) / spanDays;
  const result = {
    schema: STORAGE_REGENERATION_CYCLE_SCHEMA,
    version: 1,
    cycle_id: cycleId ?? cycle_id,
    source_class: sourceClass ?? source_class,
    lane_id: laneId ?? lane_id,
    generation,
    root_identity: rootIdentity ?? root_identity,
    observed_at_utc: observed,
    output_bytes: output_bytes ?? outputBytes,
    cleanup_verified: cleanup,
    prior_cleanup: previous,
    recurrence_detected: recurrence,
    regeneration_rate_per_day: Number(rate.toFixed(6)),
    prior_cycles: structuredClone(prior),
    source_state_sha256: source_state_sha256 ?? sourceStateSha256,
    recurrence_key: canonicalDigest({lane_id: laneId ?? lane_id, generation, root_identity: rootIdentity ?? root_identity}),
    cycle_sha256: null,
  };
  result.cycle_sha256 = digestWithout(result, "cycle_sha256");
  return validateStorageRegenerationCycle(result);
}

export function validateStorageRegenerationCycle(cycle) {
  exactKeys(cycle, ["schema", "version", "cycle_id", "source_class", "lane_id", "generation", "root_identity", "observed_at_utc", "output_bytes", "cleanup_verified", "prior_cleanup", "recurrence_detected", "regeneration_rate_per_day", "prior_cycles", "source_state_sha256", "recurrence_key", "cycle_sha256"], "regeneration cycle");
  assert(cycle.schema === STORAGE_REGENERATION_CYCLE_SCHEMA && cycle.version === 1, "regeneration cycle identity is invalid");
  id(cycle.cycle_id, "regeneration cycle ID");
  assert(STORAGE_REGENERATION_MEASURED_SOURCES.includes(cycle.source_class), "regeneration source class is invalid");
  id(cycle.lane_id, "regeneration lane ID");
  positiveInteger(cycle.generation, "regeneration generation");
  string(cycle.root_identity, "regeneration root identity");
  utc(cycle.observed_at_utc, "regeneration observation time");
  nonNegativeInteger(cycle.output_bytes, "regeneration output bytes");
  bool(cycle.cleanup_verified, "regeneration cleanup verification");
  bool(cycle.prior_cleanup, "regeneration prior cleanup");
  bool(cycle.recurrence_detected, "regeneration recurrence flag");
  assert(typeof cycle.regeneration_rate_per_day === "number" && Number.isFinite(cycle.regeneration_rate_per_day) && cycle.regeneration_rate_per_day >= 0, "regeneration rate is invalid");
  array(cycle.prior_cycles, "regeneration prior cycles");
  cycle.prior_cycles.forEach((entry) => validateStorageRegenerationCycle(entry));
  nullableSha(cycle.source_state_sha256, "regeneration source state digest");
  sha(cycle.recurrence_key, "regeneration recurrence key");
  assert(cycle.recurrence_key === canonicalDigest({lane_id: cycle.lane_id, generation: cycle.generation, root_identity: cycle.root_identity}), "regeneration recurrence key mismatch");
  sha(cycle.cycle_sha256, "regeneration cycle digest");
  assert(cycle.cycle_sha256 === digestWithout(cycle, "cycle_sha256"), "regeneration cycle digest mismatch");
  return cycle;
}

export const compileRegenerationCycle = compileStorageRegenerationCycle;
export const validateRegenerationCycle = validateStorageRegenerationCycle;

/** Controller-owned daily read-only inspection with recurrence detection. */
export function compileStorageDailyInspection({
  inspectionId, inspection_id, controllerId, controller_id, observedAtUtc, observed_at_utc,
  cycles = [], priorInspection = null, prior_inspection, protectedBytes = 0, protected_bytes,
  regeneratedBytes = 0, regenerated_bytes, deletionAttempts = 0, deletion_attempts = 0,
  previousCleanupCycle = null, previous_cleanup_cycle, pollKey = null, poll_key,
  previousPollKey = null, previous_poll_key, deltaReceiptSha256 = null, delta_receipt_sha256,
  unchangedObservation = false, unchanged_observation, fullEvidence = false, full_evidence,
} = {}) {
  id(inspectionId ?? inspection_id, "daily storage inspection ID");
  id(controllerId ?? controller_id, "daily storage inspection controller");
  const observed = observed_at_utc ?? observedAtUtc;
  utc(observed, "daily storage inspection time");
  array(cycles, "daily storage inspection cycles");
  cycles.forEach(validateStorageRegenerationCycle);
  const prior = prior_inspection ?? priorInspection ?? null;
  if (prior !== null) validateStorageDailyInspection(prior);
  nonNegativeInteger(protected_bytes ?? protectedBytes, "daily protected bytes");
  nonNegativeInteger(regenerated_bytes ?? regeneratedBytes, "daily regenerated bytes");
  nonNegativeInteger(deletion_attempts ?? deletionAttempts, "daily deletion attempts");
  const previousCleanup = previous_cleanup_cycle ?? previousCleanupCycle ?? null;
  if (previousCleanup !== null) validateStorageRegenerationCycle(previousCleanup);
  const poll = poll_key ?? pollKey;
  const previousPoll = previous_poll_key ?? previousPollKey;
  const delta = delta_receipt_sha256 ?? deltaReceiptSha256;
  const unchanged = unchanged_observation ?? unchangedObservation ?? false;
  const full = full_evidence ?? fullEvidence ?? false;
  if (poll !== null) id(poll, "daily inspection poll key");
  if (previousPoll !== null) id(previousPoll, "daily inspection previous poll key");
  nullableSha(delta, "daily inspection delta receipt");
  bool(unchanged, "daily inspection unchanged observation");
  bool(full, "daily inspection full evidence flag");
  assert(!(unchanged && delta === null), "unchanged polling requires a delta receipt", "STORAGE_REGENERATION_POLLING_LOOP");
  assert(!(poll !== null && poll === previousPoll), "repeated unchanged storage polling is rejected", "STORAGE_REGENERATION_POLLING_LOOP");
  if (full && unchanged) assert(false, "unchanged polling must use a delta receipt rather than repeated full evidence", "STORAGE_REGENERATION_POLLING_LOOP");
  const recurrenceKeys = cycles.filter((cycle) => cycle.recurrence_detected).map((cycle) => cycle.recurrence_key);
  const priorKeys = prior?.recurrence_keys ?? [];
  const repeated = [...new Set([...priorKeys, ...recurrenceKeys])];
  const result = {
    schema: STORAGE_DAILY_INSPECTION_SCHEMA,
    version: 1,
    inspection_id: inspectionId ?? inspection_id,
    controller_id: controllerId ?? controller_id,
    observed_at_utc: observed,
    cycle_count: cycles.length,
    cycles: structuredClone(cycles),
    regenerated_bytes: regenerated_bytes ?? regeneratedBytes,
    protected_bytes: protected_bytes ?? protectedBytes,
    deletion_attempts: deletion_attempts ?? deletionAttempts,
    recurrence_detected: recurrenceKeys.length > 0 || prior?.recurrence_detected === true,
    recurrence_count: repeated.length,
    recurrence_keys: repeated.sort(),
    previous_cleanup_cycle_sha256: previousCleanup?.cycle_sha256 ?? null,
    poll_key: poll,
    previous_poll_key: previousPoll,
    delta_receipt_sha256: delta,
    unchanged_observation: unchanged,
    full_evidence: full,
    deduplicated: unchanged === true,
    protected_state_preserved: true,
    deletion_execution_authorized: false,
    inspection_sha256: null,
  };
  result.inspection_sha256 = digestWithout(result, "inspection_sha256");
  return validateStorageDailyInspection(result);
}

export function validateStorageDailyInspection(inspection) {
  exactKeys(inspection, ["schema", "version", "inspection_id", "controller_id", "observed_at_utc", "cycle_count", "cycles", "regenerated_bytes", "protected_bytes", "deletion_attempts", "recurrence_detected", "recurrence_count", "recurrence_keys", "previous_cleanup_cycle_sha256", "poll_key", "previous_poll_key", "delta_receipt_sha256", "unchanged_observation", "full_evidence", "deduplicated", "protected_state_preserved", "deletion_execution_authorized", "inspection_sha256"], "daily storage inspection");
  assert(inspection.schema === STORAGE_DAILY_INSPECTION_SCHEMA && inspection.version === 1, "daily storage inspection identity is invalid");
  id(inspection.inspection_id, "daily storage inspection ID");
  id(inspection.controller_id, "daily storage inspection controller");
  utc(inspection.observed_at_utc, "daily storage inspection time");
  nonNegativeInteger(inspection.cycle_count, "daily cycle count");
  array(inspection.cycles, "daily cycles");
  assert(inspection.cycles.length === inspection.cycle_count, "daily cycle count is stale");
  inspection.cycles.forEach(validateStorageRegenerationCycle);
  nonNegativeInteger(inspection.regenerated_bytes, "daily regenerated bytes");
  nonNegativeInteger(inspection.protected_bytes, "daily protected bytes");
  nonNegativeInteger(inspection.deletion_attempts, "daily deletion attempts");
  bool(inspection.recurrence_detected, "daily recurrence flag");
  nonNegativeInteger(inspection.recurrence_count, "daily recurrence count");
  uniqueStrings(inspection.recurrence_keys, "daily recurrence keys").forEach((entry) => sha(entry, "daily recurrence key"));
  nullableSha(inspection.previous_cleanup_cycle_sha256, "daily previous cleanup cycle digest");
  if (inspection.poll_key !== null) id(inspection.poll_key, "daily inspection poll key");
  if (inspection.previous_poll_key !== null) id(inspection.previous_poll_key, "daily inspection previous poll key");
  nullableSha(inspection.delta_receipt_sha256, "daily inspection delta receipt");
  bool(inspection.unchanged_observation, "daily inspection unchanged observation");
  bool(inspection.full_evidence, "daily inspection full evidence flag");
  assert(!(inspection.unchanged_observation && inspection.delta_receipt_sha256 === null), "unchanged polling requires a delta receipt", "STORAGE_REGENERATION_POLLING_LOOP");
  assert(!(inspection.poll_key !== null && inspection.poll_key === inspection.previous_poll_key), "repeated unchanged storage polling is rejected", "STORAGE_REGENERATION_POLLING_LOOP");
  assert(!(inspection.unchanged_observation && inspection.full_evidence), "unchanged polling must use a delta receipt rather than repeated full evidence", "STORAGE_REGENERATION_POLLING_LOOP");
  assert(inspection.deduplicated === (inspection.unchanged_observation === true), "daily deduplication flag is stale");
  assert(inspection.protected_state_preserved === true, "daily inspection must preserve protected state");
  assert(inspection.deletion_execution_authorized === false, "daily inspection cannot authorize deletion");
  sha(inspection.inspection_sha256, "daily inspection digest");
  assert(inspection.inspection_sha256 === digestWithout(inspection, "inspection_sha256"), "daily inspection digest mismatch");
  return inspection;
}

export const compileDailyStorageInspection = compileStorageDailyInspection;
export const validateDailyStorageInspection = validateStorageDailyInspection;

/** Compile the project-wide immutable governance declaration. */
export function compileStorageRegenerationGovernance({
  authorityId = "AGENTOS.STORAGE.REGENERATION",
  owner = "CONTROLLER",
  measuredSources = STORAGE_REGENERATION_MEASURED_SOURCES,
  protectedClasses = STORAGE_REGENERATION_PROTECTED_CLASSES,
  hostileCases = STORAGE_REGENERATION_HOSTILE_CASES,
  cleanupExecutionAuthorized = false,
  schedulerRuntimeCloseout = true,
  runtimeDeliveryCloseout = true,
  controllerDailyInspection = true,
  recurrenceHistoryRequired = true,
  generatedTempCloseoutRequired = true,
  observedAtUtc,
} = {}) {
  id(authorityId, "storage regeneration authority ID");
  string(owner, "storage regeneration owner");
  const sources = uniqueStrings(measuredSources, "storage regeneration measured sources");
  assert(JSON.stringify(sources) === JSON.stringify([...STORAGE_REGENERATION_MEASURED_SOURCES].sort()), "storage regeneration source roster is incomplete");
  const protectedRoster = uniqueStrings(protectedClasses, "storage regeneration protected classes");
  for (const entry of STORAGE_REGENERATION_PROTECTED_CLASSES) assert(protectedRoster.includes(entry), `protected class ${entry} is missing`);
  const hostile = uniqueStrings(hostileCases, "storage regeneration hostile cases");
  for (const entry of STORAGE_REGENERATION_HOSTILE_CASES) assert(hostile.includes(entry), `hostile case ${entry} is missing`);
  bool(cleanupExecutionAuthorized, "storage regeneration cleanup authority");
  assert(cleanupExecutionAuthorized === false, "storage regeneration governance cannot authorize deletion");
  bool(schedulerRuntimeCloseout, "scheduler closeout requirement");
  bool(runtimeDeliveryCloseout, "Runtime closeout requirement");
  bool(controllerDailyInspection, "Controller daily inspection requirement");
  bool(recurrenceHistoryRequired, "regeneration recurrence history requirement");
  bool(generatedTempCloseoutRequired, "generated temp closeout requirement");
  utc(observedAtUtc, "storage regeneration governance observation time");
  const result = {
    schema: STORAGE_REGENERATION_GOVERNANCE_SCHEMA,
    version: STORAGE_REGENERATION_VERSION,
    authority_id: authorityId,
    owner,
    measured_sources: sources,
    protected_classes: protectedRoster,
    hostile_cases: hostile,
    policies: {
      cleanup_execution_authorized: false,
      scheduler_runtime_closeout: schedulerRuntimeCloseout,
      runtime_delivery_closeout: runtimeDeliveryCloseout,
      controller_daily_inspection: controllerDailyInspection,
      recurrence_history_required: recurrenceHistoryRequired,
      generated_temp_closeout_required: generatedTempCloseoutRequired,
      broad_globs_forbidden: true,
      worktree_removal_forbidden: true,
      shared_cache_deletion_forbidden: true,
      active_custody_cleanup_forbidden: true,
      toolchain_deletion_forbidden: true,
      postgresql_state_deletion_forbidden: true,
      artifact_receipt_deletion_forbidden: true,
      [STORAGE_SESSION_HISTORY_POLICY]: true,
      outside_projects_cache_mutation_forbidden: true,
    },
    measured_source_rules: {
      FLEET_REPLAY_PGDATA_COPIES: ["ONE_BOUNDED_ROOT_PER_LANE_GENERATION", "STOPPED_FIXTURE_RETIRED_AFTER_RECEIPT", "LIVE_POSTGRESQL_NEVER_DISPOSABLE"],
      OT_PROJECTION_SPINE_DUPLICATE_DEPENDENCIES: ["CONTENT_ADDRESSED_SHARED_CUSTODY", "OWNER_CONSUMERS_COMPATIBLE_IDENTITY_REQUIRED", "LIVE_CONSUMER_BLOCKS_DELETE"],
      OT_WELL_LANE_CARGO_HOME: ["ONE_SHARED_BOUNDED_CARGO_CACHE", "OWNER_USE_RECEIPT_REQUIRED", "CEILING_LAST_USE_EXPIRY_REQUIRED", "RELEASE_OWNERSHIP_NOT_SHARED_ROOT"],
      SHARED_CARGO_TARGET: ["SHARED_LIVE_TARGET", "EXPLICIT_CEILING", "ORPHAN_OLD_FINGERPRINT_PRUNE_ONLY", "ACTIVE_BUILD_PROTECTED"],
      DURABLE_RUNTIME_POSTGRESQL: ["EXPLICIT_OWNER_RETENTION_RELEASE_CURRENT_STATE", "NEVER_GENERIC_CLEANUP", "SEPARATE_LIFECYCLE_AUTHORITY"],
      [STORAGE_SESSION_HISTORY_SOURCE]: ["MUTATION_FORBIDDEN", "BOUNDED_OUTPUTS_AND_DELTAS", "POLLING_LOOPS_FORBIDDEN", "SUPPORTED_ROLLOVER_ONLY"],
      OUTSIDE_PROJECTS_SPARKLE_CACHES: ["OWNER_ALERT_ONLY", "NO_AGENTOS_MUTATION", "NOT_CLEANUP_CAPACITY", "NO_REPEATED_PROBING"],
    },
    observed_at_utc: observedAtUtc,
    governance_sha256: null,
  };
  result.governance_sha256 = digestWithout(result, "governance_sha256");
  return validateStorageRegenerationGovernance(result);
}

export function validateStorageRegenerationGovernance(governance) {
  exactKeys(governance, ["schema", "version", "authority_id", "owner", "measured_sources", "protected_classes", "hostile_cases", "policies", "measured_source_rules", "observed_at_utc", "governance_sha256"], "storage regeneration governance");
  assert(governance.schema === STORAGE_REGENERATION_GOVERNANCE_SCHEMA && governance.version === STORAGE_REGENERATION_VERSION, "storage regeneration governance identity is invalid");
  id(governance.authority_id, "storage regeneration authority ID");
  string(governance.owner, "storage regeneration owner");
  const sourceRoster = uniqueStrings(governance.measured_sources, "storage regeneration measured sources");
  assert(JSON.stringify(sourceRoster) === JSON.stringify([...STORAGE_REGENERATION_MEASURED_SOURCES].sort()), "storage regeneration source roster is incomplete");
  const protectedRoster = uniqueStrings(governance.protected_classes, "storage regeneration protected classes");
  STORAGE_REGENERATION_PROTECTED_CLASSES.forEach((entry) => assert(protectedRoster.includes(entry), `protected class ${entry} is missing`));
  const hostile = uniqueStrings(governance.hostile_cases, "storage regeneration hostile cases");
  STORAGE_REGENERATION_HOSTILE_CASES.forEach((entry) => assert(hostile.includes(entry), `hostile case ${entry} is missing`));
  record(governance.policies, "storage regeneration policies");
  for (const key of ["cleanup_execution_authorized", "scheduler_runtime_closeout", "runtime_delivery_closeout", "controller_daily_inspection", "recurrence_history_required", "generated_temp_closeout_required", "broad_globs_forbidden", "worktree_removal_forbidden", "shared_cache_deletion_forbidden", "active_custody_cleanup_forbidden", "toolchain_deletion_forbidden", "postgresql_state_deletion_forbidden", "artifact_receipt_deletion_forbidden", STORAGE_SESSION_HISTORY_POLICY, "outside_projects_cache_mutation_forbidden"]) bool(governance.policies[key], `storage regeneration policy ${key}`);
  assert(governance.policies.cleanup_execution_authorized === false, "storage regeneration cleanup authority is unsafe");
  record(governance.measured_source_rules, "storage regeneration source rules");
  sourceRoster.forEach((source) => {
    array(governance.measured_source_rules[source], `storage regeneration source rules ${source}`);
    assert(governance.measured_source_rules[source].length > 0, `storage regeneration source rules ${source} are empty`);
  });
  utc(governance.observed_at_utc, "storage regeneration governance observation time");
  sha(governance.governance_sha256, "storage regeneration governance digest");
  assert(governance.governance_sha256 === digestWithout(governance, "governance_sha256"), "storage regeneration governance digest mismatch");
  return governance;
}

export const compileStorageRegenerationPolicy = compileStorageRegenerationGovernance;
export const validateStorageRegenerationPolicy = validateStorageRegenerationGovernance;

export function compileStorageRegenerationDecision({asset, manifest = null, delivery = null, cache = null, dailyInspection = null, action = "MONITOR"} = {}) {
  string(action, "storage regeneration decision action");
  const result = {
    schema: "agentos.storage_regeneration_decision.v1",
    version: 1,
    action,
    cleanup_allowed: false,
    protected_data_preserved: true,
    reason: "SEPARATE_VERIFIED_DELIVERY_AND_ISSUE_MANIFEST_REQUIRED",
    asset: asset === undefined ? null : structuredClone(asset),
    manifest_sha256: manifest === null ? null : validateDisposableOutputManifest(manifest).manifest_sha256,
    delivery_verified: delivery === null ? false : (() => { validateDeliveryProof(delivery); return true; })(),
    cache_sha256: cache === null ? null : validateCacheIdentity(cache).cache_sha256,
    inspection_sha256: dailyInspection === null ? null : validateStorageDailyInspection(dailyInspection).inspection_sha256,
    decision_sha256: null,
  };
  result.decision_sha256 = digestWithout(result, "decision_sha256");
  return result;
}

export const compileStorageAutopilotRegenerationDecision = compileStorageRegenerationDecision;

export function validateStorageRegenerationDecision(decision) {
  exactKeys(decision, ["schema", "version", "action", "cleanup_allowed", "protected_data_preserved", "reason", "asset", "manifest_sha256", "delivery_verified", "cache_sha256", "inspection_sha256", "decision_sha256"], "storage regeneration decision");
  assert(decision.schema === "agentos.storage_regeneration_decision.v1" && decision.version === 1, "storage regeneration decision identity is invalid");
  string(decision.action, "storage regeneration decision action");
  bool(decision.cleanup_allowed, "storage regeneration cleanup authority");
  assert(decision.cleanup_allowed === false, "storage regeneration decision cannot authorize deletion");
  assert(decision.protected_data_preserved === true, "storage regeneration decision must preserve protected data");
  string(decision.reason, "storage regeneration decision reason");
  nullableSha(decision.manifest_sha256, "storage regeneration decision manifest digest");
  bool(decision.delivery_verified, "storage regeneration decision delivery flag");
  nullableSha(decision.cache_sha256, "storage regeneration decision cache digest");
  nullableSha(decision.inspection_sha256, "storage regeneration decision inspection digest");
  sha(decision.decision_sha256, "storage regeneration decision digest");
  assert(decision.decision_sha256 === digestWithout(decision, "decision_sha256"), "storage regeneration decision digest mismatch");
  return decision;
}

export const compileStorageCleanupDecision = compilePostDeliveryCleanup;
export const validateStorageCleanupDecision = validatePostDeliveryCleanup;
export const compileGeneratorTempRootCloseout = compileGeneratedTempCloseout;
export const validateGeneratorTempRootCloseout = validateGeneratedTempCloseout;
export const compileStorageRegeneration = compileStorageRegenerationCycle;
export const validateStorageRegeneration = validateStorageRegenerationCycle;
export const compileStorageInspection = compileStorageDailyInspection;
export const validateStorageInspection = validateStorageDailyInspection;
