#!/usr/bin/env node

/* Digest-bound cleanup planner/executor.  Filesystem mutation is injected. */

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";

export const HYGIENE_EXECUTION_SCHEMA = "agentos.hygiene_executor_execution.v1";
export const HYGIENE_DRY_RUN_SCHEMA = "agentos.hygiene_executor_dry_run.v1";
const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) { if (!condition) throw new Error(message); }
function record(value, label) { assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); }
function string(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }

function safeRelative(target) {
  string(target, "hygiene target");
  assert(!path.isAbsolute(target) && !target.includes("\\"), "hygiene target must be a relative POSIX path");
  assert(!target.split("/").includes(".."), "hygiene target may not traverse parent directories");
  assert(!/[*?{}\[\]]/u.test(target), "hygiene target may not be globbed");
  assert(target !== "." && target !== "", "hygiene target may not be the root");
  return target;
}

export function validateDeletionManifest(manifest) {
  record(manifest, "cleanup deletion manifest");
  assert(manifest.schema === "agentos.cleanup_deletion_manifest.v1", "cleanup deletion manifest schema is invalid");
  assert(manifest.version === 1, "cleanup deletion manifest version is invalid");
  assert(Array.isArray(manifest.targets) && manifest.targets.length > 0, "cleanup deletion targets are required");
  const targets = manifest.targets.map((target) => {
    record(target, "cleanup deletion target");
    const relative = safeRelative(target.path);
    assert(["WORKTREE", "CACHE", "FIXTURE", "BROWSER_STATE", "TEMP"].includes(target.kind), "cleanup target kind is invalid");
    assert(target.active === false && target.dirty === false && target.referenced === false && target.shared === false, "cleanup target is not safely removable");
    return {...target, path: relative};
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

export function executeHygiene({manifest, dryRun, authorityRoot, executionAdmitted = false, removeTarget} = {}) {
  const valid = validateDeletionManifest(manifest);
  record(dryRun, "cleanup dry run");
  sha(dryRun.dry_run_sha256, "cleanup dry-run digest");
  assert(dryRun.manifest_sha256 === valid.manifest_sha256, "cleanup dry run does not bind the manifest");
  assert(dryRun.dry_run_sha256 === canonicalDigest({...dryRun, dry_run_sha256: null}), "cleanup dry-run digest mismatch");
  assert(executionAdmitted === true, "cleanup execution requires separate admission");
  assert(typeof removeTarget === "function", "cleanup execution requires an injected remover");
  const removed = [];
  for (const entry of valid.targets) {
    const resolved = resolveTarget(authorityRoot, entry.path);
    if (!fs.existsSync(resolved.target)) continue;
    const validated = resolveTarget(authorityRoot, entry.path);
    if (!fs.existsSync(validated.target)) continue;
    removeTarget({path: entry.path, absolutePath: validated.target, kind: entry.kind});
    removed.push(entry.path);
  }
  return {schema: HYGIENE_EXECUTION_SCHEMA, version: 1, manifest_sha256: valid.manifest_sha256, dry_run_sha256: dryRun.dry_run_sha256, removed_paths: removed.sort(), failures: [], retained_paths: valid.targets.map((entry) => entry.path).filter((target) => !removed.includes(target)).sort(), execution_admitted: true, execution_sha256: canonicalDigest({manifest_sha256: valid.manifest_sha256, dry_run_sha256: dryRun.dry_run_sha256, removed_paths: removed.sort()})};
}

export function validateHygieneAfterState({execution, afterTargets = []} = {}) {
  record(execution, "cleanup execution receipt");
  assert(execution.schema === HYGIENE_EXECUTION_SCHEMA && execution.version === 1, "cleanup execution receipt identity is invalid");
  sha(execution.manifest_sha256, "cleanup execution manifest digest");
  sha(execution.dry_run_sha256, "cleanup execution dry-run digest");
  sha(execution.execution_sha256, "cleanup execution digest");
  assert(Array.isArray(afterTargets), "cleanup after-target inventory must be an array");
  return {execution, afterTargets};
}

export const planHygiene = compileHygieneDryRun;
export const runHygiene = executeHygiene;
