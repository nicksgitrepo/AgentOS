#!/usr/bin/env node

/* Controller-owned, read-only roster projection and recovery manifest. */

import {canonicalDigest} from "./content-addressing.mjs";

export const RECOVERY_ROSTER_SCHEMA = "agentos.authoritative_recovery_roster.v1";
export const RECOVERY_MANIFEST_SCHEMA = "agentos.authoritative_recovery_manifest.v1";
const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) { if (!condition) throw new Error(message); }
function record(value, label) { assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); }
function string(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`); }
function sha(value, label, nullable = false) { if (nullable && value === null) return; assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }

function rowKey(row) { return `${row.role_id}\u0000${row.task_id}`; }

export function validatePermanentRoster(roster) {
  record(roster, "authoritative permanent roster");
  assert(roster.schema === "agentos.permanent_agent_roster.v1" || roster.schema === RECOVERY_ROSTER_SCHEMA, "permanent roster schema is invalid");
  assert(Array.isArray(roster.agents ?? roster.rows), "permanent roster rows are required");
  const rows = roster.agents ?? roster.rows;
  const roleKeys = new Set();
  const taskKeys = new Set();
  const worktrees = new Set();
  for (const row of rows) {
    record(row, "permanent roster row");
    for (const field of ["role_id", "task_id"]) string(row[field], `permanent roster ${field}`);
    assert(!roleKeys.has(row.role_id), "duplicate permanent role ID");
    assert(!taskKeys.has(row.task_id), "duplicate permanent task ID");
    roleKeys.add(row.role_id); taskKeys.add(row.task_id);
    if (row.worktree !== null && row.worktree !== undefined) {
      string(row.worktree, "permanent roster worktree");
      assert(!worktrees.has(row.worktree), "duplicate non-null permanent worktree");
      worktrees.add(row.worktree);
    } else assert(row.worktree === null, "permanent roster worktree must be explicit null when absent");
  }
  if (roster.digest_sha256 !== undefined) {
    sha(roster.digest_sha256, "permanent roster digest");
    const body = {...roster, digest_sha256: null};
    assert(roster.digest_sha256 === canonicalDigest(body), "permanent roster digest mismatch");
  }
  return {schema: roster.schema, rows, role_ids: [...roleKeys].sort(), task_ids: [...taskKeys].sort(), worktrees: [...worktrees].sort()};
}
export function classifyTaskCustody({task, permanentRoster} = {}) {
  record(task, "task custody observation");
  const roster = validatePermanentRoster(permanentRoster);
  string(task.task_id, "observed task ID");
  const matches = roster.rows.filter((row) => row.task_id === task.task_id);
  if (matches.length !== 1) return {classification: "TEMPORARY_PENDING_RECONCILIATION", reason: matches.length === 0 ? "UNROSTERED_TASK" : "AMBIGUOUS_TASK_ID", task_id: task.task_id};
  const row = matches[0];
  if (task.role_id !== row.role_id || (row.worktree !== null && task.worktree !== row.worktree) || (row.worktree === null && task.worktree !== null)) {
    return {classification: "TEMPORARY_PENDING_RECONCILIATION", reason: "ROLE_TASK_WORKTREE_CROSS_BINDING", task_id: task.task_id};
  }
  return {classification: "PERMANENT_EXEMPT", task_id: task.task_id, role_id: row.role_id, worktree: row.worktree};
}

export function compileRecoveryRoster({observedTasks = [], permanentRoster, processes = [], artifacts = []} = {}) {
  assert(Array.isArray(observedTasks), "observed tasks must be an array");
  assert(Array.isArray(processes) && Array.isArray(artifacts), "process and artifact observations must be arrays");
  const rows = observedTasks.map((task) => ({task, custody: classifyTaskCustody({task, permanentRoster})}));
  const unaccounted = rows.filter((row) => row.custody.classification !== "PERMANENT_EXEMPT" && !row.task.disposition).length;
  const temporary = rows.filter((row) => row.custody.classification !== "PERMANENT_EXEMPT").length;
  const record = {
    schema: RECOVERY_ROSTER_SCHEMA,
    version: 1,
    permanent_roster_digest_sha256: permanentRoster.digest_sha256 ?? canonicalDigest(permanentRoster),
    rows: rows.map(({task, custody}) => ({task_id: task.task_id, role_id: task.role_id ?? null, worktree: task.worktree ?? null, status: task.status ?? "UNKNOWN", custody})).sort((a, b) => a.task_id.localeCompare(b.task_id)),
    process_count: processes.length,
    artifact_count: artifacts.length,
    counters: {discovered_task_count: rows.length, proven_permanent_exempt_count: rows.filter((row) => row.custody.classification === "PERMANENT_EXEMPT").length, temporary_in_scope_count: temporary, unaccounted_count: unaccounted, live_temporary_task_count: rows.filter((row) => row.custody.classification === "TEMPORARY_PENDING_RECONCILIATION" && row.task.status !== "CLOSED").length},
    digest_sha256: null,
  };
  record.digest_sha256 = canonicalDigest({...record, digest_sha256: null});
  return record;
}

export function validateRecoveryRoster(roster) {
  record(roster, "recovery roster");
  assert(roster.schema === RECOVERY_ROSTER_SCHEMA && roster.version === 1, "recovery roster identity is invalid");
  assert(Array.isArray(roster.rows), "recovery roster rows are required");
  sha(roster.permanent_roster_digest_sha256, "recovery permanent roster digest");
  for (const row of roster.rows) {
    record(row, "recovery roster row"); string(row.task_id, "recovery roster task ID"); record(row.custody, "recovery roster custody");
    assert(["PERMANENT_EXEMPT", "TEMPORARY_PENDING_RECONCILIATION"].includes(row.custody.classification), "recovery roster custody classification is invalid");
  }
  sha(roster.digest_sha256, "recovery roster digest");
  assert(roster.digest_sha256 === canonicalDigest({...roster, digest_sha256: null}), "recovery roster digest mismatch");
  return roster;
}

export function compileRecoveryManifest({roster, candidate = {}, changedPaths = [], owner = "CONTROLLER"} = {}) {
  validateRecoveryRoster(roster); assert(Array.isArray(changedPaths), "recovery changed paths must be an array");
  const paths = [...new Set(changedPaths)].sort();
  const manifest = {schema: RECOVERY_MANIFEST_SCHEMA, version: 1, owner, roster_sha256: roster.digest_sha256, candidate, paths, path_count: paths.length, manifest_sha256: null};
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  return manifest;
}

export function validateRecoveryManifest(manifest) {
  record(manifest, "recovery manifest");
  assert(manifest.schema === RECOVERY_MANIFEST_SCHEMA && manifest.version === 1, "recovery manifest identity is invalid");
  sha(manifest.roster_sha256, "recovery manifest roster digest");
  assert(Array.isArray(manifest.paths) && manifest.paths.length === manifest.path_count, "recovery manifest path count is invalid");
  assert(JSON.stringify(manifest.paths) === JSON.stringify([...manifest.paths].sort()), "recovery manifest paths must be sorted");
  assert(new Set(manifest.paths).size === manifest.paths.length, "recovery manifest paths must be unique");
  sha(manifest.manifest_sha256, "recovery manifest digest");
  assert(manifest.manifest_sha256 === canonicalDigest({...manifest, manifest_sha256: null}), "recovery manifest digest mismatch");
  return manifest;
}
