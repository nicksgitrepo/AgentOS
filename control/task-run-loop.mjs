#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  continuationDigest,
  selectContinuationTask,
  validateContinuationHandoff,
  validateContinuationTask,
} from "./task-continuation.mjs";

export const TASK_EXECUTION_READBACK_SCHEMA = "agentos.control_plane_task_execution_readback.v1";
export const TASK_RUN_RECONCILIATION_SCHEMA = "agentos.control_plane_task_run_reconciliation.v1";
export const QUEUED_TASK_SCHEMA = "agentos.control_plane_queued_task.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const EXECUTION_KEYS = [
  "schema", "version", "task_sha256", "status", "action", "source_commit", "source_tree", "changed_paths",
  "active_campaign", "product_writes_allowed", "product_agent_spawns_allowed", "deployment_allowed", "publication_allowed",
  "push_allowed", "merge_allowed", "sterile_copy_changed", "secrets_accessed", "destructive_work_performed", "findings", "readback_sha256",
];
const RECONCILIATION_KEYS = [
  "schema", "version", "status", "iteration", "task_sha256", "parent_handoff_sha256", "parent_reconciliation_sha256",
  "project_id", "campaign_id", "campaign_version", "canonical_campaign_identity", "policy_epoch", "policy_state_sha256",
  "source_commit", "source_tree", "execution_sha256", "active_campaign", "product_writes_allowed", "product_agent_spawns_allowed",
  "deployment_allowed", "publication_allowed", "push_allowed", "merge_allowed", "sterile_copy_changed", "next_task_candidate_sha256",
  "findings", "reconciled_at_utc", "reconciliation_sha256",
];
const QUEUED_KEYS = [
  "schema", "version", "status", "task_id", "project_id", "campaign_id", "campaign_version", "canonical_campaign_identity",
  "parent_task_sha256", "parent_run_reconciliation_sha256", "task_candidate", "task_candidate_sha256", "policy_epoch",
  "policy_state_sha256", "boundary", "queued_at_utc", "queued_task_sha256",
];
const RECORD_SCHEMA_TO_DIGEST = new Map([
  [TASK_EXECUTION_READBACK_SCHEMA, "readback_sha256"],
  [TASK_RUN_RECONCILIATION_SCHEMA, "reconciliation_sha256"],
  [QUEUED_TASK_SCHEMA, "queued_task_sha256"],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields mismatch`);
}

function requireString(value, label, {allowEmpty = false} = {}) {
  assert(typeof value === "string" && (allowEmpty || value.trim().length > 0), `${label} must be text`);
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), `${label} contains invalid control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function requireStringArray(value, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (!allowEmpty) assert(value.length > 0, `${label} must not be empty`);
  value.forEach((item, index) => requireString(item, `${label}[${index}]`));
}

function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
}

function digestWithout(value, field) {
  return continuationDigest({...value, [field]: null});
}

function validateInactiveFlags(value, label, {includeExecutionOnly = true} = {}) {
  const fields = [
    "active_campaign", "product_writes_allowed", "product_agent_spawns_allowed", "deployment_allowed", "publication_allowed",
    "push_allowed", "merge_allowed", "sterile_copy_changed",
  ];
  if (includeExecutionOnly) fields.push("secrets_accessed", "destructive_work_performed");
  for (const field of fields) {
    requireBoolean(value[field], `${label}.${field}`);
    assert(value[field] === false, `${label}.${field} crossed the safe continuation boundary`);
  }
}

function validateChangedPaths(paths) {
  requireStringArray(paths, "task execution changed paths", {allowEmpty: true});
  for (const changedPath of paths) {
    assert(!changedPath.startsWith("/") && !changedPath.includes("\\") && !changedPath.split("/").includes(".."), "task execution path is not bounded");
    assert(changedPath === "README.md" || ["control/", "schemas/", "tests/", "docs/", "governance/"].some((prefix) => changedPath.startsWith(prefix)), "task execution path leaves the control-plane source set");
  }
}

export function validateTaskExecutionReadback(readback, task = null) {
  exactKeys(readback, EXECUTION_KEYS, "task execution readback");
  assert(readback.schema === TASK_EXECUTION_READBACK_SCHEMA && readback.version === 1, "task execution readback identity is invalid");
  if (task === null) requireSha(readback.task_sha256, "task execution readback task");
  else assert(readback.task_sha256 === task.task_sha256, "task execution readback task differs");
  assert(readback.status === "COMPLETED_INACTIVE" && readback.action === "CONTROL_PLANE_RECORD_ONLY", "task execution readback action is unsafe");
  if (task === null) {
    requireGitObject(readback.source_commit, "task execution readback source commit");
    requireGitObject(readback.source_tree, "task execution readback source tree");
  } else assert(readback.source_commit === task.source_commit && readback.source_tree === task.source_tree, "task execution readback source differs");
  validateChangedPaths(readback.changed_paths);
  validateInactiveFlags(readback, "task execution readback");
  assert(Array.isArray(readback.findings) && readback.findings.length === 0, "task execution readback contains findings");
  requireSha(readback.readback_sha256, "task execution readback digest");
  assert(readback.readback_sha256 === digestWithout(readback, "readback_sha256"), "task execution readback digest mismatch");
  return readback;
}

export function validateTaskRunReconciliation(reconciliation) {
  exactKeys(reconciliation, RECONCILIATION_KEYS, "task run reconciliation");
  assert(reconciliation.schema === TASK_RUN_RECONCILIATION_SCHEMA && reconciliation.version === 1, "task run reconciliation identity is invalid");
  assert(reconciliation.status === "RECONCILED_INACTIVE", "task run reconciliation is not inactive");
  assert(Number.isSafeInteger(reconciliation.iteration) && reconciliation.iteration >= 1, "task run iteration is invalid");
  for (const field of ["task_sha256", "parent_handoff_sha256", "parent_reconciliation_sha256", "policy_state_sha256", "execution_sha256", "next_task_candidate_sha256", "reconciliation_sha256"]) requireSha(reconciliation[field], `task run ${field}`);
  for (const field of ["project_id", "campaign_id", "campaign_version"]) requireIdentifier(reconciliation[field], `task run ${field}`);
  assert(reconciliation.canonical_campaign_identity === "CONTROLLER_CANDIDATE", "task run canonical identity is invalid");
  assert(Number.isSafeInteger(reconciliation.policy_epoch) && reconciliation.policy_epoch >= 1, "task run policy epoch is invalid");
  requireGitObject(reconciliation.source_commit, "task run source commit");
  requireGitObject(reconciliation.source_tree, "task run source tree");
  validateInactiveFlags(reconciliation, "task run reconciliation", {includeExecutionOnly: false});
  assert(Array.isArray(reconciliation.findings) && reconciliation.findings.length === 0, "task run reconciliation contains findings");
  requireUtc(reconciliation.reconciled_at_utc, "task run reconciliation time");
  assert(reconciliation.reconciliation_sha256 === digestWithout(reconciliation, "reconciliation_sha256"), "task run reconciliation digest mismatch");
  return reconciliation;
}

export function validateQueuedTask(queued) {
  exactKeys(queued, QUEUED_KEYS, "queued continuation task");
  assert(queued.schema === QUEUED_TASK_SCHEMA && queued.version === 1 && queued.status === "QUEUED_INACTIVE", "queued continuation task identity is invalid");
  for (const field of ["task_id", "project_id", "campaign_id", "campaign_version"]) requireIdentifier(queued[field], `queued task ${field}`);
  assert(queued.canonical_campaign_identity === "CONTROLLER_CANDIDATE", "queued task canonical identity is invalid");
  requireSha(queued.parent_task_sha256, "queued task parent");
  requireSha(queued.parent_run_reconciliation_sha256, "queued task run reconciliation");
  selectContinuationTask({availableTasks: [queued.task_candidate], selectedTaskId: queued.task_id});
  assert(queued.task_candidate.task_id === queued.task_id, "queued task candidate differs");
  requireSha(queued.task_candidate_sha256, "queued task candidate digest");
  assert(queued.task_candidate_sha256 === continuationDigest(queued.task_candidate), "queued task candidate digest mismatch");
  assert(Number.isSafeInteger(queued.policy_epoch) && queued.policy_epoch >= 1, "queued task policy epoch is invalid");
  requireSha(queued.policy_state_sha256, "queued task policy");
  assert(JSON.stringify(queued.boundary) === JSON.stringify(queued.task_candidate.boundary), "queued task boundary differs");
  requireUtc(queued.queued_at_utc, "queued task time");
  requireSha(queued.queued_task_sha256, "queued task digest");
  assert(queued.queued_task_sha256 === digestWithout(queued, "queued_task_sha256"), "queued task digest mismatch");
  return queued;
}

export function runSafeControlPlaneTaskLoop({readyTask, readyHandoff, currentStatus, nextTaskCandidates, selectedNextTaskId, execute, iteration = 1, runAtUtc}) {
  validateContinuationTask(readyTask);
  validateContinuationHandoff(readyHandoff);
  assert(readyHandoff.phase === "START" && readyHandoff.status === "STARTED_INACTIVE", "run loop requires a continuation-ready start handoff");
  assert(readyHandoff.task_sha256 === readyTask.task_sha256, "run loop task and start handoff differ");
  assert(currentStatus.active_campaign === false && currentStatus.controller_status === "PREPARED_NOT_ACTIVATED", "run loop current status crossed activation");
  assert(currentStatus.current_reconciliation_sha256 === readyTask.parent_reconciliation_sha256, "run loop parent reconciliation is stale");
  assert(currentStatus.continuation_completion_handoff_sha256 === readyTask.parent_handoff_sha256, "run loop parent handoff is stale");
  assert(Number.isSafeInteger(iteration) && iteration >= 1, "run loop iteration is invalid");
  requireUtc(runAtUtc, "run loop time");
  assert(typeof execute === "function", "run loop executor is required");
  const execution = execute({task: structuredClone(readyTask), iteration});
  validateTaskExecutionReadback(execution, readyTask);
  const candidate = selectContinuationTask({availableTasks: nextTaskCandidates, selectedTaskId: selectedNextTaskId});
  assert(candidate.task_id !== readyTask.task_id, "run loop cannot queue the current task again");
  assert(candidate.boundary.campaign_activation_allowed === false && candidate.boundary.product_writes_allowed === false && candidate.boundary.product_agent_spawns_allowed === false, "run loop next task crosses an inactive boundary");
  const candidateSha256 = continuationDigest(candidate);
  const reconciliation = {
    schema: TASK_RUN_RECONCILIATION_SCHEMA,
    version: 1,
    status: "RECONCILED_INACTIVE",
    iteration,
    task_sha256: readyTask.task_sha256,
    parent_handoff_sha256: readyTask.parent_handoff_sha256,
    parent_reconciliation_sha256: readyTask.parent_reconciliation_sha256,
    project_id: readyTask.project_id,
    campaign_id: readyTask.campaign_id,
    campaign_version: readyTask.campaign_version,
    canonical_campaign_identity: "CONTROLLER_CANDIDATE",
    policy_epoch: readyTask.policy_epoch,
    policy_state_sha256: readyTask.policy_state_sha256,
    source_commit: readyTask.source_commit,
    source_tree: readyTask.source_tree,
    execution_sha256: execution.readback_sha256,
    active_campaign: false,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    deployment_allowed: false,
    publication_allowed: false,
    push_allowed: false,
    merge_allowed: false,
    sterile_copy_changed: false,
    next_task_candidate_sha256: candidateSha256,
    findings: [],
    reconciled_at_utc: runAtUtc,
    reconciliation_sha256: null,
  };
  reconciliation.reconciliation_sha256 = digestWithout(reconciliation, "reconciliation_sha256");
  validateTaskRunReconciliation(reconciliation);
  const queued = {
    schema: QUEUED_TASK_SCHEMA,
    version: 1,
    status: "QUEUED_INACTIVE",
    task_id: candidate.task_id,
    project_id: readyTask.project_id,
    campaign_id: readyTask.campaign_id,
    campaign_version: readyTask.campaign_version,
    canonical_campaign_identity: "CONTROLLER_CANDIDATE",
    parent_task_sha256: readyTask.task_sha256,
    parent_run_reconciliation_sha256: reconciliation.reconciliation_sha256,
    task_candidate: candidate,
    task_candidate_sha256: candidateSha256,
    policy_epoch: readyTask.policy_epoch,
    policy_state_sha256: readyTask.policy_state_sha256,
    boundary: candidate.boundary,
    queued_at_utc: runAtUtc,
    queued_task_sha256: null,
  };
  queued.queued_task_sha256 = digestWithout(queued, "queued_task_sha256");
  validateQueuedTask(queued);
  return {execution, reconciliation, queued};
}

function safeRecordPath(authorityRoot, recordPath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "task loop authority root must be absolute");
  assert(typeof recordPath === "string" && recordPath.length > 0 && !path.isAbsolute(recordPath), "task loop record path must be relative");
  const resolvedRoot = fs.realpathSync.native(authorityRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "task loop authority root must be a real directory");
  const target = path.resolve(resolvedRoot, recordPath);
  assert(target.startsWith(`${resolvedRoot}${path.sep}`), "task loop record path escapes authority root");
  for (let cursor = target; cursor !== resolvedRoot; cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "task loop record path may not contain symlinks");
  }
  return {target};
}

function validateRecord(record) {
  requireRecord(record, "task loop record");
  if (record.schema === TASK_EXECUTION_READBACK_SCHEMA) return validateTaskExecutionReadback(record);
  if (record.schema === TASK_RUN_RECONCILIATION_SCHEMA) return validateTaskRunReconciliation(record);
  if (record.schema === QUEUED_TASK_SCHEMA) return validateQueuedTask(record);
  throw new Error("task loop record schema is unsupported");
}

function recordDigest(record) {
  const field = RECORD_SCHEMA_TO_DIGEST.get(record.schema);
  assert(field, "task loop record digest field is unsupported");
  return record[field];
}

export function readTaskRunLoopRecord({authorityRoot, recordPath}) {
  const {target} = safeRecordPath(authorityRoot, recordPath);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), "task loop record must be a regular file");
  let record;
  try { record = JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) { throw new Error(`task loop record JSON is invalid: ${error.message}`); }
  return validateRecord(record);
}

export function writeTaskRunLoopRecordCompareAndSwap({authorityRoot, recordPath, expectedRecordSha256 = null, record}) {
  const validated = validateRecord(record);
  if (expectedRecordSha256 !== null) requireSha(expectedRecordSha256, "expected task loop record");
  const {target} = safeRecordPath(authorityRoot, recordPath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let lockHeld = false;
  let temporary;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    lockHeld = true;
    const current = readTaskRunLoopRecord({authorityRoot, recordPath});
    if (expectedRecordSha256 === null) assert(current === null, "task loop record already exists");
    else assert(current !== null && recordDigest(current) === expectedRecordSha256, "task loop record compare-and-swap parent is stale");
    temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.stage`);
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    temporary = null;
  } finally {
    if (temporary !== undefined && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    if (lockHeld) { try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  }
  const readback = readTaskRunLoopRecord({authorityRoot, recordPath});
  assert(recordDigest(readback) === recordDigest(validated), "task loop record readback differs");
  return {path: recordPath, record_sha256: recordDigest(readback)};
}
