#!/usr/bin/env node

/*
 * The project-persistent operating loop.
 *
 * This is a control-plane state machine, not a worker.  The Intent Regulator
 * owns the campaign-level observation, the campaign Orchestrator owns worker
 * routing and in-scope repair, and the independent Auditor owns acceptance.
 * Runtime and Intent Regulator records are persistent; temporary worker
 * records are inspected and then replaced when their work is closed.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, compareUtf8, redactPersistedText as redactSharedPersistedText} from "./content-addressing.mjs";

export const CONTINUOUS_OPERATING_LOOP_SCHEMA = "agentos.continuous_operating_loop.v1";
export const LOOP_INSPECTION_SCHEMA = "agentos.continuous_operating_loop_inspection.v1";
export const PATCH_RECEIPT_SCHEMA = "agentos.continuous_operating_loop_patch_receipt.v1";
export const REPAIR_RECORD_SCHEMA = "agentos.continuous_operating_loop_repair_record.v1";
export const REPLACEMENT_GOAL_SCHEMA = "agentos.continuous_operating_loop_replacement_goal.v1";
export const REPLACEMENT_RECEIPT_SCHEMA = "agentos.continuous_operating_loop_replacement_receipt.v1";
export const DEFAULT_MEANINGFUL_PROGRESS_WINDOW_MINUTES = 15;
export const DEFAULT_MAX_SAME_TURN_REPLACEMENTS = 16;

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const PROJECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HOST_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const PROJECT_ENVIRONMENT_TYPES = Object.freeze(["local", "worktree"]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const BUILD_TAG = /^v\d+\.\d+(?:\.\d+)?(?:rc)?-tb-\d{2}$/u;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const MAX_PERSISTED_TEXT = 500;
const SIGNALS = Object.freeze(["NONE", "DRIFT", "GAP", "EDGE_CASE", "CONFLICT", "FAILURE", "SOURCE_CHANGED", "INTENT_CHANGED", "HARD_STOP"]);
const EVIDENCE_KINDS = Object.freeze(["MEANINGFUL_RESULT", "HEARTBEAT", "FAILURE_LIST", "PLAN", "MISSING"]);
const WORKER_STATUSES = Object.freeze(["ACTIVE", "COMPLETED", "STALLED", "HARD_STOPPED", "ARCHIVED"]);
const FINDING_CLASSIFICATIONS = Object.freeze(["NONE", "PUZZLE", "SOFT_BOUNDARY_REVIEW", "HARD_BOUNDARY_STOP", "TRUE_BLOCKER"]);
const LOOP_ACTIONS = Object.freeze([
  "CONTINUE",
  "ORCHESTRATOR_REPAIR",
  "SOFT_BOUNDARY_REVIEW",
  "STOP_HARD_BOUNDARY",
  "CLOSE_GOAL_SUCCEEDED_BY_REASSESSMENT",
]);
const PROTECTED_ACTION_KEYS = ["published", "pushed", "merged", "deployed", "spent", "revealed_secrets", "deleted", "product_writes"];
const OPAQUE_FAILURE = /^opaque:error-[0-9a-f]{64}$/u;
const LOOP_KEYS = [
  "schema", "version", "loop_id", "project_id", "campaign_id", "campaign_version", "admitted_scope",
  "source_commit", "source_tree", "intent_sha256", "meaningful_progress_window_minutes", "build_tag",
  "intent_regulator_id", "runtime_id", "orchestrator_id", "orchestrator_display_name", "auditor_id", "auditor_display_name",
  "hard_stop", "protected_actions",
];
const WORKER_KEYS = [
  "worker_id", "role", "display_name", "persistent", "status", "scope", "source_commit", "source_tree", "started_at_utc",
  "last_meaningful_progress_at_utc", "evidence", "handoff", "signal", "summary", "protected_actions",
];
const EVIDENCE_KEYS = ["kind", "meaningful", "source_commit", "source_tree", "result_sha256", "recorded_at_utc"];
const HANDOFF_KEYS = ["status", "typed", "session_id", "handoff_sha256"];
const PROTECTED_ACTION_RECORD_KEYS = ["published", "pushed", "merged", "deployed", "spent", "revealed_secrets", "deleted", "product_writes"];
const SOURCE_KEYS = ["commit", "tree"];
const ROOT_CAUSE_KEYS = ["category", "summary", "contributing_factors", "root_cause_sha256"];
const REPAIR_KEYS = [
  "schema", "version", "status", "classification", "preserved_evidence_sha256", "root_cause", "changed_paths",
  "smallest_live_patch", "source_before", "source_after", "test_build_identity", "normative_bindings",
  "patch_receipt_sha256", "protected_actions", "repair_sha256",
];
const PREDECESSOR_KEYS = ["worker_id", "role", "display_name", "session_id", "handoff_sha256"];
const TEST_BUILD_KEYS = ["id", "kind", "source_commit", "source_tree", "changed_paths_sha256", "normative_binding_sha256", "predecessor_handoff_sha256", "identity_sha256"];
const HOST_FAILURE_KEYS = ["phase", "error_digest", "raw_receipt_sha256"];
const HOST_RECEIPT_NAMES = ["create_thread", "pin", "send", "wait", "read", "unpin", "archive", "post_close_read", "active_list_absent"];
const HOST_RECEIPT_KEYS = ["operation", "status", "session_id", "observed_at_utc", "meaningful_progress", "source_commit", "source_tree", "typed_handoff_sha256", "receipt_sha256"];
const REPLACEMENT_HOST_KEYS = [
  "schema", "version", "status", "visible", "session_id", "role", "display_name", "model", "reasoning_effort", "predecessor_session_id",
  "predecessor_handoff_sha256", "build_tag", "source_commit", "source_tree", "meaningful_progress_required", "typed_handoff_sha256", "receipts", "protected_actions", "receipt_sha256",
];
const CLEARANCE_KEYS = ["status", "independent", "auditor_id", "source_commit", "source_tree", "handoff_sha256", "receipt_sha256"];
const REPLACEMENT_GOAL_KEYS = [
  "schema", "version", "status", "goal_id", "loop_id", "project_id", "campaign_id", "campaign_version", "owner_role",
  "orchestrator_id", "auditor_id", "predecessor_worker_id", "predecessor_session_id", "predecessor_handoff_sha256",
  "repair_record_sha256", "test_build_identity", "build_tag", "display_name", "source_commit", "source_tree", "scope", "reason_classification",
  "protected_actions", "goal_sha256",
];
const INSPECTION_KEYS = [
  "schema", "version", "inspection_id", "loop_id", "project_id", "campaign_id", "campaign_version", "source_commit", "source_tree",
  "observed_source_commit", "observed_source_tree", "intent_sha256", "observed_intent_sha256", "meaningful_progress_window_minutes",
  "active_worker_ids", "inspected_worker_ids", "worker_reports", "preserved_evidence_sha256", "goal_disposition", "action", "route_to",
  "continuation_allowed", "protected_actions", "observed_at_utc", "inspection_sha256",
];
const WORKER_REPORT_KEYS = [
  "worker_id", "role", "display_name", "persistent", "scope_matches", "source_matches", "evidence_present", "handoff_present", "progress_signal",
  "meaningful_progress", "elapsed_minutes", "timer_expired", "finding_classification", "finding_summary", "evidence_sha256", "handoff_sha256",
];
const REPAIR_RECORD_OUTCOME = Object.freeze(["REPAIR_FAILED_RETAINED", "REPLACEMENT_BLOCKED", "REPLACED_AND_CLEARED"]);
const RECORD_SCHEMA_TO_DIGEST = new Map([
  [LOOP_INSPECTION_SCHEMA, "inspection_sha256"],
  [PATCH_RECEIPT_SCHEMA, "repair_sha256"],
  [REPAIR_RECORD_SCHEMA, "record_sha256"],
  [REPLACEMENT_GOAL_SCHEMA, "goal_sha256"],
  [REPLACEMENT_RECEIPT_SCHEMA, "receipt_sha256"],
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
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`);
}

function requireString(value, label, {allowEmpty = false} = {}) {
  assert(typeof value === "string" && (allowEmpty || value.trim().length > 0), `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function redactPersistedText(value) {
  const result = redactSharedPersistedText(String(value ?? ""));
  const text = typeof result === "string" ? result : result.text;
  return String(text).replace(/\s+/gu, " ").trim().slice(0, MAX_PERSISTED_TEXT) || "UNSPECIFIED";
}

function requireSafePersistedText(value, label) {
  requireString(value, label);
  assert(value.length <= MAX_PERSISTED_TEXT, `${label} exceeds the persisted text bound`);
  assert(value === redactPersistedText(value), `${label} contains private or secret material`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireProjectIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value) || PROJECT_UUID.test(value), `${label} is not a supported project identifier`);
}

export function validateProjectBinding(binding, expectedProjectId, label = "project binding") {
  exactKeys(binding, ["project_id", "host_id", "project_root", "git_top_level", "target"], label);
  requireProjectIdentifier(binding.project_id, `${label} project ID`);
  requireProjectIdentifier(expectedProjectId, `${label} expected project ID`);
  assert(binding.project_id === expectedProjectId, `${label} project ID differs from the loop project ID`);
  requireString(binding.host_id, `${label} host ID`);
  assert(HOST_IDENTIFIER.test(binding.host_id), `${label} host ID is invalid`);
  requireString(binding.project_root, `${label} project root`);
  assert(path.isAbsolute(binding.project_root), `${label} project root must be absolute`);
  requireString(binding.git_top_level, `${label} Git top level`);
  assert(path.isAbsolute(binding.git_top_level), `${label} Git top level must be absolute`);
  exactKeys(binding.target, ["type", "projectId", "environment"], `${label} target`);
  assert(binding.target.type === "project", `${label} target type is invalid`);
  requireProjectIdentifier(binding.target.projectId, `${label} target project ID`);
  assert(binding.target.projectId === binding.project_id, `${label} target project ID differs from its project ID`);
  exactKeys(binding.target.environment, ["type"], `${label} target environment`);
  assert(PROJECT_ENVIRONMENT_TYPES.includes(binding.target.environment.type), `${label} target environment is invalid`);
  if (binding.target.environment.type === "local") {
    assert(binding.project_root === binding.git_top_level, `${label} local project root differs from Git top level`);
  }
  return binding;
}

function requireBuildTag(value, label) {
  requireString(value, label);
  assert(BUILD_TAG.test(value), `${label} must identify a version and two-digit test build`);
}

function requireTemporaryDisplayName(value, buildTag, label) {
  requireSafePersistedText(value, label);
  requireBuildTag(buildTag, `${label} build tag`);
  assert(value.endsWith(` ${buildTag}`), `${label} must end with the exact build tag ${buildTag}`);
  assert(value.slice(0, -buildTag.length - 1).trim().length > 0, `${label} must name the role or lane`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be an exact Git object identity`);
}

function requireUtc(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function sortedUnique(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  values.forEach((value, index) => requireSafePersistedText(value, `${label}[${index}]`));
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return values;
}

function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
}

export function loopDigest(value) {
  return canonicalDigest(value);
}

function opaqueFailure(error) {
  if (typeof error === "string" && OPAQUE_FAILURE.test(error)) return error;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return `opaque:error-${loopDigest({message})}`;
}

function digestWithout(value, field) {
  return loopDigest({...structuredClone(value), [field]: null});
}

function validateProtectedActions(actions, label = "protected actions") {
  exactKeys(actions, PROTECTED_ACTION_KEYS, label);
  for (const key of PROTECTED_ACTION_KEYS) {
    requireBoolean(actions[key], `${label}.${key}`);
    assert(actions[key] === false, `${label}.${key} must remain false`);
  }
  return actions;
}

function validateSource(source, label) {
  exactKeys(source, SOURCE_KEYS, label);
  requireGitObject(source.commit, `${label} commit`);
  requireGitObject(source.tree, `${label} tree`);
  return source;
}

function validateRootCause(rootCause) {
  exactKeys(rootCause, ROOT_CAUSE_KEYS, "root-cause analysis");
  requireSafePersistedText(rootCause.category, "root-cause category");
  requireSafePersistedText(rootCause.summary, "root-cause summary");
  sortedUnique(rootCause.contributing_factors, "root-cause contributing factors", {allowEmpty: true});
  rootCause.contributing_factors.forEach((factor, index) => requireSafePersistedText(factor, `root-cause contributing factor ${index}`));
  requireSha(rootCause.root_cause_sha256, "root-cause digest");
  assert(rootCause.root_cause_sha256 === digestWithout(rootCause, "root_cause_sha256"), "root-cause digest mismatch");
  return rootCause;
}

export function validateContinuousOperatingLoop(loop, {projectBinding = null} = {}) {
  exactKeys(loop, LOOP_KEYS, "continuous operating loop");
  assert(loop.schema === CONTINUOUS_OPERATING_LOOP_SCHEMA && loop.version === 1, "continuous operating loop identity is invalid");
  requireIdentifier(loop.loop_id, "loop loop_id");
  requireProjectIdentifier(loop.project_id, "loop project_id");
  for (const field of ["campaign_id", "campaign_version", "intent_regulator_id", "runtime_id", "orchestrator_id", "auditor_id"]) requireIdentifier(loop[field], `loop ${field}`);
  if (projectBinding !== null) validateProjectBinding(projectBinding, loop.project_id);
  assert(new Set([loop.intent_regulator_id, loop.runtime_id, loop.orchestrator_id, loop.auditor_id]).size === 4, "loop role identities must be distinct");
  sortedUnique(loop.admitted_scope, "loop admitted scope");
  requireGitObject(loop.source_commit, "loop source commit");
  requireGitObject(loop.source_tree, "loop source tree");
  requireSha(loop.intent_sha256, "loop intent digest");
  requireBuildTag(loop.build_tag, "loop build tag");
  assert(Number.isSafeInteger(loop.meaningful_progress_window_minutes) && loop.meaningful_progress_window_minutes >= 1 && loop.meaningful_progress_window_minutes <= 24 * 60, "meaningful-progress window is outside the safe range");
  requireTemporaryDisplayName(loop.orchestrator_display_name, loop.build_tag, "loop Orchestrator display name");
  requireTemporaryDisplayName(loop.auditor_display_name, loop.build_tag, "loop Auditor display name");
  requireBoolean(loop.hard_stop, "loop hard-stop state");
  validateProtectedActions(loop.protected_actions, "loop protected actions");
  return loop;
}

export function compileContinuousOperatingLoop({
  loopId,
  projectId,
  campaignId,
  campaignVersion,
  admittedScope,
  sourceCommit,
  sourceTree,
  intentSha256,
  meaningfulProgressWindowMinutes = DEFAULT_MEANINGFUL_PROGRESS_WINDOW_MINUTES,
  buildTag = "v2.1rc-tb-01",
  intentRegulatorId = "INTENT-REGULATOR",
  runtimeId = "RUNTIME",
  orchestratorId = "CAMPAIGN-ORCHESTRATOR",
  orchestratorDisplayName = `Campaign Orchestrator ${buildTag}`,
  auditorId = "INDEPENDENT-AUDITOR",
  auditorDisplayName = `Independent Auditor ${buildTag}`,
  hardStop = false,
  projectBinding = null,
}) {
  const loop = {
    schema: CONTINUOUS_OPERATING_LOOP_SCHEMA,
    version: 1,
    loop_id: loopId,
    project_id: projectId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    admitted_scope: [...admittedScope].sort(compareUtf8),
    source_commit: sourceCommit,
    source_tree: sourceTree,
    intent_sha256: intentSha256,
    meaningful_progress_window_minutes: meaningfulProgressWindowMinutes,
    build_tag: buildTag,
    intent_regulator_id: intentRegulatorId,
    runtime_id: runtimeId,
    orchestrator_id: orchestratorId,
    orchestrator_display_name: orchestratorDisplayName,
    auditor_id: auditorId,
    auditor_display_name: auditorDisplayName,
    hard_stop: hardStop,
    protected_actions: Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, false])),
  };
  return validateContinuousOperatingLoop(loop, {projectBinding});
}

function validateEvidence(evidence, label = "worker evidence") {
  exactKeys(evidence, EVIDENCE_KEYS, label);
  assert(EVIDENCE_KINDS.includes(evidence.kind), `${label} kind is invalid`);
  requireBoolean(evidence.meaningful, `${label} meaningful flag`);
  assert(evidence.meaningful === (evidence.kind === "MEANINGFUL_RESULT"), `${label} falsely claims meaningful progress`);
  requireGitObject(evidence.source_commit, `${label} source commit`);
  requireGitObject(evidence.source_tree, `${label} source tree`);
  requireSha(evidence.result_sha256, `${label} result`, {nullable: true});
  if (evidence.meaningful) requireSha(evidence.result_sha256, `${label} meaningful result`);
  requireUtc(evidence.recorded_at_utc, `${label} recorded time`);
  return evidence;
}

function validateHandoff(handoff, label = "worker handoff") {
  exactKeys(handoff, HANDOFF_KEYS, label);
  assert(["PRESENT", "MISSING"].includes(handoff.status), `${label} status is invalid`);
  requireBoolean(handoff.typed, `${label} typed flag`);
  assert(handoff.typed === (handoff.status === "PRESENT"), `${label} typed flag is inconsistent`);
  if (handoff.status === "PRESENT") {
    requireIdentifier(handoff.session_id, `${label} session`);
    requireSha(handoff.handoff_sha256, `${label} digest`);
  } else {
    assert(handoff.session_id === null && handoff.handoff_sha256 === null, `${label} missing status carries identity`);
  }
  return handoff;
}

function validateWorker(worker, label = "loop worker") {
  exactKeys(worker, WORKER_KEYS, label);
  requireIdentifier(worker.worker_id, `${label} ID`);
  requireIdentifier(worker.role, `${label} role`);
  requireSafePersistedText(worker.display_name, `${label} display name`);
  requireBoolean(worker.persistent, `${label} persistent flag`);
  if (worker.persistent) assert(["INTENT_REGULATOR", "RUNTIME"].includes(worker.role), `${label} persistent role is not exemptible`);
  else assert(!["INTENT_REGULATOR", "RUNTIME"].includes(worker.role), `${label} persistent role must not cycle`);
  assert(WORKER_STATUSES.includes(worker.status), `${label} status is invalid`);
  sortedUnique(worker.scope, `${label} scope`);
  requireGitObject(worker.source_commit, `${label} source commit`);
  requireGitObject(worker.source_tree, `${label} source tree`);
  requireUtc(worker.started_at_utc, `${label} start time`);
  requireUtc(worker.last_meaningful_progress_at_utc, `${label} last meaningful progress time`, {nullable: true});
  if (worker.last_meaningful_progress_at_utc !== null) assert(Date.parse(worker.last_meaningful_progress_at_utc) >= Date.parse(worker.started_at_utc), `${label} meaningful progress predates its start`);
  validateEvidence(worker.evidence, `${label} evidence`);
  assert(worker.evidence.source_commit === worker.source_commit && worker.evidence.source_tree === worker.source_tree, `${label} evidence source differs from worker source`);
  if (worker.evidence.meaningful) assert(worker.last_meaningful_progress_at_utc === worker.evidence.recorded_at_utc, `${label} meaningful progress clock is not bound to its result`);
  validateHandoff(worker.handoff, `${label} handoff`);
  assert(SIGNALS.includes(worker.signal), `${label} signal is invalid`);
  requireSafePersistedText(worker.summary, `${label} summary`);
  validateProtectedActions(worker.protected_actions, `${label} protected actions`);
  return worker;
}

function validateWorkerList(workers, buildTag = null) {
  assert(Array.isArray(workers), "loop workers are required");
  const ids = new Set();
  const ordered = [...workers].sort((left, right) => compareUtf8(left.worker_id, right.worker_id));
  assert(JSON.stringify(workers) === JSON.stringify(ordered), "loop workers must be sorted by ID");
  for (const worker of workers) {
    validateWorker(worker);
    if (worker.persistent) {
      assert(worker.display_name === (worker.role === "INTENT_REGULATOR" ? "Intent Regulator" : "Runtime"), `${worker.role} persistent display name is invalid`);
    } else {
      requireTemporaryDisplayName(worker.display_name, buildTag, `${worker.worker_id} display name`);
    }
    assert(!ids.has(worker.worker_id), "loop worker IDs must be unique");
    ids.add(worker.worker_id);
  }
  assert(workers.some((worker) => worker.persistent && worker.role === "INTENT_REGULATOR"), "Intent Regulator is missing from the loop roster");
  assert(workers.some((worker) => worker.persistent && worker.role === "RUNTIME"), "Runtime is missing from the loop roster");
  return workers;
}

function parseElapsedMinutes(start, end) {
  const elapsed = (Date.parse(end) - Date.parse(start)) / 60_000;
  assert(Number.isFinite(elapsed) && elapsed >= 0, "loop observation time moves backward");
  return Number(elapsed.toFixed(6));
}

export function classifyFinding({worker, scopeMatches, sourceMatches, evidencePresent, handoffPresent, timerExpired, continuationAfterHardStop = false}) {
  if (continuationAfterHardStop || worker.status === "HARD_STOPPED" || worker.signal === "HARD_STOP" || Object.values(worker.protected_actions).some(Boolean)) return "HARD_BOUNDARY_STOP";
  if (!scopeMatches || !sourceMatches || !evidencePresent || !handoffPresent) return "TRUE_BLOCKER";
  if (worker.signal === "CONFLICT") return "SOFT_BOUNDARY_REVIEW";
  if (timerExpired || ["DRIFT", "GAP", "EDGE_CASE", "FAILURE"].includes(worker.signal)) return "PUZZLE";
  return "NONE";
}

function reportSummary(worker, {sourceMatches, scopeMatches, evidencePresent, handoffPresent, timerExpired}) {
  if (!sourceMatches) return "The worker source identity is stale; do not continue it.";
  if (!scopeMatches) return "The worker scope differs from the admitted campaign scope.";
  if (!evidencePresent) return "The worker has no evidence record.";
  if (!handoffPresent) return "The worker has no typed handoff.";
  if (timerExpired) return "The meaningful-progress window expired without a meaningful result.";
  if (worker.signal !== "NONE") return worker.summary;
  return "No workflow finding was observed.";
}

export function validateLoopInspection(inspection) {
  exactKeys(inspection, INSPECTION_KEYS, "loop inspection");
  assert(inspection.schema === LOOP_INSPECTION_SCHEMA && inspection.version === 1, "loop inspection identity is invalid");
  for (const field of ["inspection_id", "loop_id", "campaign_id", "campaign_version"]) requireIdentifier(inspection[field], `inspection ${field}`);
  requireProjectIdentifier(inspection.project_id, "inspection project_id");
  for (const field of ["source_commit", "source_tree", "observed_source_commit", "observed_source_tree"]) requireGitObject(inspection[field], `inspection ${field}`);
  requireSha(inspection.intent_sha256, "inspection intent");
  requireSha(inspection.observed_intent_sha256, "inspection observed intent");
  assert(Number.isSafeInteger(inspection.meaningful_progress_window_minutes) && inspection.meaningful_progress_window_minutes >= 1, "inspection progress window is invalid");
  sortedUnique(inspection.active_worker_ids, "inspection active workers", {allowEmpty: true});
  sortedUnique(inspection.inspected_worker_ids, "inspection inspected workers", {allowEmpty: true});
  assert(JSON.stringify(inspection.active_worker_ids) === JSON.stringify(inspection.inspected_worker_ids), "not every active worker was inspected");
  assert(Array.isArray(inspection.worker_reports), "inspection worker reports are required");
  const reportIds = new Set();
  const ordered = [...inspection.worker_reports].sort((left, right) => compareUtf8(left.worker_id, right.worker_id));
  assert(JSON.stringify(inspection.worker_reports) === JSON.stringify(ordered), "inspection reports must be sorted by worker ID");
  for (const report of inspection.worker_reports) {
    exactKeys(report, WORKER_REPORT_KEYS, "inspection worker report");
    requireIdentifier(report.worker_id, "inspection worker ID");
    requireString(report.role, "inspection worker role");
    requireSafePersistedText(report.display_name, "inspection worker display name");
    requireBoolean(report.persistent, "inspection worker persistent flag");
    for (const field of ["scope_matches", "source_matches", "evidence_present", "handoff_present", "meaningful_progress", "timer_expired"]) requireBoolean(report[field], `inspection ${field}`);
    assert(["MEANINGFUL_RESULT", "HEARTBEAT", "FAILURE_LIST", "PLAN", "MISSING"].includes(report.progress_signal), "inspection progress signal is invalid");
    assert(Number.isFinite(report.elapsed_minutes) && report.elapsed_minutes >= 0, "inspection elapsed minutes are invalid");
    assert(FINDING_CLASSIFICATIONS.includes(report.finding_classification), "inspection finding classification is invalid");
    requireSafePersistedText(report.finding_summary, "inspection finding summary");
    requireSha(report.evidence_sha256, "inspection evidence digest", {nullable: true});
    requireSha(report.handoff_sha256, "inspection handoff digest", {nullable: true});
    assert(!reportIds.has(report.worker_id), "inspection worker IDs are duplicated");
    reportIds.add(report.worker_id);
  }
  assert(JSON.stringify([...reportIds].sort(compareUtf8)) === JSON.stringify(inspection.active_worker_ids), "inspection reports do not cover every active worker");
  requireSha(inspection.preserved_evidence_sha256, "inspection preserved evidence");
  assert(["UNCHANGED", "SUCCEEDED_BY_REASSESSMENT", "HARD_STOPPED", "SOFT_REVIEW_REQUIRED", "ORCHESTRATOR_REPAIR_REQUIRED"].includes(inspection.goal_disposition), "inspection goal disposition is invalid");
  assert(LOOP_ACTIONS.includes(inspection.action), "inspection action is invalid");
  assert(["CAMPAIGN_ORCHESTRATOR", "INTENT_REGULATOR", "NONE"].includes(inspection.route_to), "inspection route is invalid");
  requireBoolean(inspection.continuation_allowed, "inspection continuation flag");
  validateProtectedActions(inspection.protected_actions, "inspection protected actions");
  requireUtc(inspection.observed_at_utc, "inspection observation time");
  requireSha(inspection.inspection_sha256, "inspection digest");
  assert(inspection.inspection_sha256 === digestWithout(inspection, "inspection_sha256"), "inspection digest mismatch");
  return inspection;
}

export function compileLoopInspection({
  loop,
  workers,
  observedAtUtc,
  observedSourceCommit = loop.source_commit,
  observedSourceTree = loop.source_tree,
  observedIntentSha256 = loop.intent_sha256,
  continuationAfterHardStop = false,
  projectBinding = null,
}) {
  validateContinuousOperatingLoop(loop, {projectBinding});
  validateWorkerList(workers, loop.build_tag);
  assert(workers.some((worker) => worker.worker_id === loop.intent_regulator_id && worker.role === "INTENT_REGULATOR"), "loop roster is bound to the wrong Intent Regulator");
  assert(workers.some((worker) => worker.worker_id === loop.runtime_id && worker.role === "RUNTIME"), "loop roster is bound to the wrong Runtime");
  requireUtc(observedAtUtc, "loop inspection time");
  requireGitObject(observedSourceCommit, "observed source commit");
  requireGitObject(observedSourceTree, "observed source tree");
  requireSha(observedIntentSha256, "observed intent digest");
  requireBoolean(continuationAfterHardStop, "continuation-after-hard-stop flag");
  if (loop.hard_stop && continuationAfterHardStop) throw new Error("attempted continuation after hard stop");
  const activeWorkers = workers.filter((worker) => worker.status === "ACTIVE");
  const activeWorkerIds = activeWorkers.map((worker) => worker.worker_id).sort(compareUtf8);
  const reports = activeWorkers.map((worker) => {
    const sourceMatches = worker.source_commit === observedSourceCommit && worker.source_tree === observedSourceTree;
    const scopeMatches = JSON.stringify(worker.scope) === JSON.stringify(loop.admitted_scope);
    const evidencePresent = worker.evidence.kind !== "MISSING";
    const handoffPresent = worker.handoff.status === "PRESENT" && worker.handoff.typed === true;
    const meaningfulProgress = worker.evidence.meaningful === true
      && worker.evidence.kind === "MEANINGFUL_RESULT"
      && sourceMatches
      && scopeMatches
      && handoffPresent;
    const elapsedMinutes = parseElapsedMinutes(worker.last_meaningful_progress_at_utc ?? worker.started_at_utc, observedAtUtc);
    const timerExpired = !worker.persistent && !meaningfulProgress && elapsedMinutes >= loop.meaningful_progress_window_minutes;
    const findingClassification = classifyFinding({worker, scopeMatches, sourceMatches, evidencePresent, handoffPresent, timerExpired, continuationAfterHardStop});
    return {
      worker_id: worker.worker_id,
      role: worker.role,
      display_name: worker.display_name,
      persistent: worker.persistent,
      scope_matches: scopeMatches,
      source_matches: sourceMatches,
      evidence_present: evidencePresent,
      handoff_present: handoffPresent,
      progress_signal: worker.evidence.kind,
      meaningful_progress: meaningfulProgress,
      elapsed_minutes: elapsedMinutes,
      timer_expired: timerExpired,
      finding_classification: findingClassification,
      finding_summary: reportSummary(worker, {sourceMatches, scopeMatches, evidencePresent, handoffPresent, timerExpired}),
      evidence_sha256: evidencePresent ? worker.evidence.result_sha256 : null,
      handoff_sha256: handoffPresent ? worker.handoff.handoff_sha256 : null,
    };
  }).sort((left, right) => compareUtf8(left.worker_id, right.worker_id));
  const sourceChanged = observedSourceCommit !== loop.source_commit || observedSourceTree !== loop.source_tree;
  const intentChanged = observedIntentSha256 !== loop.intent_sha256;
  const hardFinding = reports.some((report) => report.finding_classification === "HARD_BOUNDARY_STOP");
  const blocker = reports.some((report) => report.finding_classification === "TRUE_BLOCKER");
  const softFinding = reports.some((report) => report.finding_classification === "SOFT_BOUNDARY_REVIEW");
  const puzzle = reports.some((report) => report.finding_classification === "PUZZLE");
  let goalDisposition = "UNCHANGED";
  let action = "CONTINUE";
  let routeTo = "NONE";
  let continuationAllowed = true;
  if (loop.hard_stop || continuationAfterHardStop || hardFinding) {
    goalDisposition = "HARD_STOPPED";
    action = "STOP_HARD_BOUNDARY";
    routeTo = "INTENT_REGULATOR";
    continuationAllowed = false;
  } else if (sourceChanged || intentChanged) {
    goalDisposition = "SUCCEEDED_BY_REASSESSMENT";
    action = "CLOSE_GOAL_SUCCEEDED_BY_REASSESSMENT";
    routeTo = "INTENT_REGULATOR";
    continuationAllowed = false;
  } else if (softFinding) {
    goalDisposition = "SOFT_REVIEW_REQUIRED";
    action = "SOFT_BOUNDARY_REVIEW";
    routeTo = "CAMPAIGN_ORCHESTRATOR";
    continuationAllowed = false;
  } else if (blocker || puzzle) {
    goalDisposition = "ORCHESTRATOR_REPAIR_REQUIRED";
    action = "ORCHESTRATOR_REPAIR";
    routeTo = blocker ? "INTENT_REGULATOR" : "CAMPAIGN_ORCHESTRATOR";
    continuationAllowed = false;
  }
  const inspection = {
    schema: LOOP_INSPECTION_SCHEMA,
    version: 1,
    inspection_id: `INSPECTION-${loopDigest({loopId: loop.loop_id, observedAtUtc, observedSourceCommit, observedSourceTree, observedIntentSha256}).slice(0, 20).toUpperCase()}`,
    loop_id: loop.loop_id,
    project_id: loop.project_id,
    campaign_id: loop.campaign_id,
    campaign_version: loop.campaign_version,
    source_commit: loop.source_commit,
    source_tree: loop.source_tree,
    observed_source_commit: observedSourceCommit,
    observed_source_tree: observedSourceTree,
    intent_sha256: loop.intent_sha256,
    observed_intent_sha256: observedIntentSha256,
    meaningful_progress_window_minutes: loop.meaningful_progress_window_minutes,
    active_worker_ids: activeWorkerIds,
    inspected_worker_ids: [...activeWorkerIds],
    worker_reports: reports,
    preserved_evidence_sha256: loopDigest(activeWorkers),
    goal_disposition: goalDisposition,
    action,
    route_to: routeTo,
    continuation_allowed: continuationAllowed,
    protected_actions: structuredClone(loop.protected_actions),
    observed_at_utc: observedAtUtc,
    inspection_sha256: null,
  };
  inspection.inspection_sha256 = digestWithout(inspection, "inspection_sha256");
  return validateLoopInspection(inspection);
}

function validateTestBuildIdentity(identity, label = "test-build identity") {
  if (identity === null) return identity;
  exactKeys(identity, TEST_BUILD_KEYS, label);
  requireIdentifier(identity.id, `${label} ID`);
  assert(identity.kind === "GOVERNANCE_TEST_BUILD", `${label} kind is invalid`);
  requireGitObject(identity.source_commit, `${label} source commit`);
  requireGitObject(identity.source_tree, `${label} source tree`);
  requireSha(identity.changed_paths_sha256, `${label} changed paths`);
  requireSha(identity.normative_binding_sha256, `${label} normative binding`);
  requireSha(identity.predecessor_handoff_sha256, `${label} predecessor handoff`);
  requireSha(identity.identity_sha256, `${label} digest`);
  const expectedId = `TEST-BUILD-${loopDigest({
    sourceCommit: identity.source_commit,
    sourceTree: identity.source_tree,
    changedPathsSha256: identity.changed_paths_sha256,
    normativeBindingSha256: identity.normative_binding_sha256,
    predecessorHandoffSha256: identity.predecessor_handoff_sha256,
  }).slice(0, 20).toUpperCase()}`;
  assert(identity.id === expectedId, `${label} ID is not bound to its source and predecessor`);
  assert(identity.identity_sha256 === digestWithout(identity, "identity_sha256"), `${label} digest mismatch`);
  return identity;
}

function validateRepairRecord(repair) {
  exactKeys(repair, REPAIR_KEYS, "repair receipt");
  assert(repair.schema === PATCH_RECEIPT_SCHEMA && repair.version === 1, "repair receipt identity is invalid");
  assert(["APPLIED", "FAILED"].includes(repair.status), "repair receipt status is invalid");
  assert(FINDING_CLASSIFICATIONS.includes(repair.classification) && repair.classification !== "NONE", "repair receipt classification is invalid");
  requireSha(repair.preserved_evidence_sha256, "repair preserved evidence");
  validateRootCause(repair.root_cause);
  sortedUnique(repair.changed_paths, "repair changed paths", {allowEmpty: true});
  requireBoolean(repair.smallest_live_patch, "repair smallest patch flag");
  validateSource(repair.source_before, "repair source before");
  validateSource(repair.source_after, "repair source after");
  validateTestBuildIdentity(repair.test_build_identity);
  exactKeys(repair.normative_bindings, ["refreshed", "binding_sha256"], "repair normative bindings");
  requireBoolean(repair.normative_bindings.refreshed, "repair normative refresh flag");
  requireSha(repair.normative_bindings.binding_sha256, "repair normative binding", {nullable: true});
  requireSha(repair.patch_receipt_sha256, "repair patch receipt");
  validateProtectedActions(repair.protected_actions, "repair protected actions");
  requireSha(repair.repair_sha256, "repair digest");
  assert(repair.repair_sha256 === digestWithout(repair, "repair_sha256"), "repair digest mismatch");
  if (repair.status === "FAILED") {
    assert(repair.test_build_identity === null, "failed repair minted a test-build identity");
    assert(repair.changed_paths.length === 0 && repair.normative_bindings.refreshed === false, "failed repair claims a live patch");
  } else {
    assert(repair.smallest_live_patch === true, "applied repair is not the smallest live patch");
    assert(repair.test_build_identity !== null, "applied repair lacks a test-build identity");
    assert(repair.normative_bindings.refreshed === true, "applied repair lacks refreshed normative bindings");
    assert(repair.test_build_identity.source_commit === repair.source_after.commit
      && repair.test_build_identity.source_tree === repair.source_after.tree, "applied repair test-build source differs from its result source");
    assert(repair.test_build_identity.changed_paths_sha256 === loopDigest(repair.changed_paths), "applied repair test-build paths differ from its repair scope");
    assert(repair.test_build_identity.normative_binding_sha256 === repair.normative_bindings.binding_sha256, "applied repair test-build binding differs from its normative binding");
    assert(repair.source_before.commit !== repair.source_after.commit || repair.source_before.tree !== repair.source_after.tree || repair.changed_paths.length > 0, "applied repair changed nothing");
  }
  return repair;
}

export function compileRepairRecord({
  classification,
  preservedEvidenceSha256,
  rootCause,
  status,
  changedPaths = [],
  sourceBefore,
  sourceAfter,
  testBuildIdentity = null,
  normativeBindingSha256 = null,
  patchReceiptSha256,
}) {
  const rootCauseRecord = {
    ...rootCause,
    category: redactPersistedText(rootCause?.category),
    summary: redactPersistedText(rootCause?.summary),
    contributing_factors: Array.isArray(rootCause?.contributing_factors)
      ? rootCause.contributing_factors.map((factor) => redactPersistedText(factor))
      : rootCause?.contributing_factors,
    root_cause_sha256: null,
  };
  rootCauseRecord.root_cause_sha256 = digestWithout(rootCauseRecord, "root_cause_sha256");
  const repair = {
    schema: PATCH_RECEIPT_SCHEMA,
    version: 1,
    status,
    classification,
    preserved_evidence_sha256: preservedEvidenceSha256,
    root_cause: rootCauseRecord,
    changed_paths: [...changedPaths].sort(compareUtf8),
    smallest_live_patch: status === "APPLIED",
    source_before: structuredClone(sourceBefore),
    source_after: structuredClone(sourceAfter),
    test_build_identity: testBuildIdentity === null ? null : {...structuredClone(testBuildIdentity), identity_sha256: null},
    normative_bindings: {refreshed: status === "APPLIED", binding_sha256: normativeBindingSha256},
    patch_receipt_sha256: patchReceiptSha256,
    protected_actions: Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, false])),
    repair_sha256: null,
  };
  if (repair.test_build_identity !== null) repair.test_build_identity.identity_sha256 = digestWithout(repair.test_build_identity, "identity_sha256");
  repair.repair_sha256 = digestWithout(repair, "repair_sha256");
  return validateRepairRecord(repair);
}

export function mintTestBuildIdentity({sourceCommit, sourceTree, changedPaths, normativeBindingSha256, predecessorHandoffSha256}) {
  requireGitObject(sourceCommit, "test-build source commit");
  requireGitObject(sourceTree, "test-build source tree");
  sortedUnique(changedPaths, "test-build changed paths", {allowEmpty: false});
  requireSha(normativeBindingSha256, "test-build normative binding");
  requireSha(predecessorHandoffSha256, "test-build predecessor handoff");
  const changedPathsSha256 = loopDigest(changedPaths);
  const identity = {
    id: `TEST-BUILD-${loopDigest({sourceCommit, sourceTree, changedPathsSha256, normativeBindingSha256, predecessorHandoffSha256}).slice(0, 20).toUpperCase()}`,
    kind: "GOVERNANCE_TEST_BUILD",
    source_commit: sourceCommit,
    source_tree: sourceTree,
    changed_paths_sha256: changedPathsSha256,
    normative_binding_sha256: normativeBindingSha256,
    predecessor_handoff_sha256: predecessorHandoffSha256,
    identity_sha256: null,
  };
  identity.identity_sha256 = digestWithout(identity, "identity_sha256");
  return validateTestBuildIdentity(identity);
}

function validatePredecessor(predecessor) {
  exactKeys(predecessor, PREDECESSOR_KEYS, "predecessor handoff");
  requireIdentifier(predecessor.worker_id, "predecessor worker");
  requireIdentifier(predecessor.role, "predecessor role");
  requireSafePersistedText(predecessor.display_name, "predecessor display name");
  assert(BUILD_TAG.test(predecessor.display_name.split(" ").at(-1)), "predecessor display name lacks an exact build tag");
  requireIdentifier(predecessor.session_id, "predecessor session");
  requireSha(predecessor.handoff_sha256, "predecessor handoff digest");
  return predecessor;
}

function validateHostFailure(failure) {
  if (failure === null) return failure;
  exactKeys(failure, HOST_FAILURE_KEYS, "host failure retention");
  requireSafePersistedText(failure.phase, "host failure phase");
  assert(OPAQUE_FAILURE.test(failure.error_digest), "host failure digest must be opaque");
  requireSha(failure.raw_receipt_sha256, "host failure raw receipt");
  return failure;
}

function compileHostFailure({phase, error, rawReceipt = null}) {
  const failure = {
    phase,
    error_digest: opaqueFailure(error),
    raw_receipt_sha256: loopDigest(rawReceipt),
  };
  return validateHostFailure(failure);
}

export function validateReplacementGoal(goal) {
  exactKeys(goal, REPLACEMENT_GOAL_KEYS, "replacement goal");
  assert(goal.schema === REPLACEMENT_GOAL_SCHEMA && goal.version === 1, "replacement goal identity is invalid");
  assert(goal.status === "MINTED", "replacement goal is not minted");
  requireIdentifier(goal.goal_id, "replacement goal ID");
  for (const field of ["loop_id", "campaign_id", "campaign_version", "orchestrator_id", "auditor_id", "predecessor_worker_id", "predecessor_session_id"]) requireIdentifier(goal[field], `replacement goal ${field}`);
  requireProjectIdentifier(goal.project_id, "replacement goal project_id");
  assert(goal.owner_role === "INTENT_REGULATOR", "replacement goal owner is not Intent Regulator");
  requireSha(goal.predecessor_handoff_sha256, "replacement goal predecessor handoff");
  requireSha(goal.repair_record_sha256, "replacement goal repair record");
  validateTestBuildIdentity(goal.test_build_identity);
  assert(goal.test_build_identity !== null, "replacement goal lacks a test-build identity");
  requireBuildTag(goal.build_tag, "replacement goal build tag");
  requireTemporaryDisplayName(goal.display_name, goal.build_tag, "replacement goal display name");
  requireGitObject(goal.source_commit, "replacement goal source commit");
  requireGitObject(goal.source_tree, "replacement goal source tree");
  sortedUnique(goal.scope, "replacement goal scope");
  assert(["PUZZLE", "TRUE_BLOCKER", "SOURCE_OR_INTENT_CHANGED"].includes(goal.reason_classification), "replacement goal reason is invalid");
  assert(goal.test_build_identity.source_commit === goal.source_commit && goal.test_build_identity.source_tree === goal.source_tree,
    "replacement goal test-build source differs from its goal source");
  validateProtectedActions(goal.protected_actions, "replacement goal protected actions");
  requireSha(goal.goal_sha256, "replacement goal digest");
  assert(goal.goal_sha256 === digestWithout(goal, "goal_sha256"), "replacement goal digest mismatch");
  return goal;
}

export function compileReplacementGoal({loop, inspection, repair, predecessor, sourceCommit = null, sourceTree = null, projectBinding = null}) {
  validateContinuousOperatingLoop(loop, {projectBinding});
  validateLoopInspection(inspection);
  assert(inspection.loop_id === loop.loop_id, "replacement inspection belongs to another loop");
  assert(inspection.project_id === loop.project_id && inspection.campaign_id === loop.campaign_id && inspection.campaign_version === loop.campaign_version,
    "replacement inspection belongs to another project or campaign");
  assert(inspection.source_commit === loop.source_commit && inspection.source_tree === loop.source_tree && inspection.intent_sha256 === loop.intent_sha256,
    "replacement inspection is not bound to the current source and intent");
  assert(inspection.action === "ORCHESTRATOR_REPAIR" && inspection.goal_disposition === "ORCHESTRATOR_REPAIR_REQUIRED" && inspection.route_to === "CAMPAIGN_ORCHESTRATOR" && inspection.continuation_allowed === false,
    "replacement inspection is not an ordinary Orchestrator repair");
  assert(!inspection.worker_reports.some((report) => report.finding_classification !== "PUZZLE" && report.finding_classification !== "NONE"),
    "true or soft boundary findings cannot mint a replacement");
  validateRepairRecord(repair);
  assert(repair.status === "APPLIED", "replacement goal cannot use a failed repair");
  assert(repair.preserved_evidence_sha256 === inspection.preserved_evidence_sha256,
    "replacement repair evidence differs from the current inspection");
  assert(repair.source_before.commit === loop.source_commit && repair.source_before.tree === loop.source_tree,
    "replacement repair source is not bound to the current loop");
  validatePredecessor(predecessor);
  assert(repair.test_build_identity.predecessor_handoff_sha256 === predecessor.handoff_sha256,
    "replacement test-build identity is not bound to the predecessor handoff");
  const nextCommit = sourceCommit ?? repair.source_after.commit;
  const nextTree = sourceTree ?? repair.source_after.tree;
  requireGitObject(nextCommit, "replacement goal next commit");
  requireGitObject(nextTree, "replacement goal next tree");
  assert(nextCommit === repair.source_after.commit && nextTree === repair.source_after.tree,
    "replacement goal source differs from the repair result");
  const reason = inspection.source_commit !== inspection.observed_source_commit || inspection.source_tree !== inspection.observed_source_tree || inspection.intent_sha256 !== inspection.observed_intent_sha256
    ? "SOURCE_OR_INTENT_CHANGED"
    : inspection.worker_reports.some((report) => report.finding_classification === "TRUE_BLOCKER") ? "TRUE_BLOCKER" : "PUZZLE";
  assert(predecessor.session_id !== loop.auditor_id, "replacement predecessor session collides with the independent Auditor");
  const replacementDisplayName = `${predecessor.role} replacement ${loop.build_tag}`;
  const goal = {
    schema: REPLACEMENT_GOAL_SCHEMA,
    version: 1,
    status: "MINTED",
    goal_id: `REPLACEMENT-GOAL-${loopDigest({loop: loop.loop_id, inspection: inspection.inspection_sha256, repair: repair.repair_sha256, predecessor: predecessor.handoff_sha256}).slice(0, 20).toUpperCase()}`,
    loop_id: loop.loop_id,
    project_id: loop.project_id,
    campaign_id: loop.campaign_id,
    campaign_version: loop.campaign_version,
    owner_role: "INTENT_REGULATOR",
    orchestrator_id: loop.orchestrator_id,
    auditor_id: loop.auditor_id,
    predecessor_worker_id: predecessor.worker_id,
    predecessor_session_id: predecessor.session_id,
    predecessor_handoff_sha256: predecessor.handoff_sha256,
    repair_record_sha256: repair.repair_sha256,
    test_build_identity: structuredClone(repair.test_build_identity),
    build_tag: loop.build_tag,
    display_name: replacementDisplayName,
    source_commit: nextCommit,
    source_tree: nextTree,
    scope: structuredClone(loop.admitted_scope),
    reason_classification: reason,
    protected_actions: structuredClone(loop.protected_actions),
    goal_sha256: null,
  };
  goal.goal_sha256 = digestWithout(goal, "goal_sha256");
  return validateReplacementGoal(goal);
}

function validateHostReceipts(receipts, {expectedSessionId = null, expectedSource = null, expectedTypedHandoffSha256 = null} = {}) {
  exactKeys(receipts, HOST_RECEIPT_NAMES, "replacement host receipts");
  for (const name of HOST_RECEIPT_NAMES) {
    const receipt = receipts[name];
    requireRecord(receipt, `replacement host receipt ${name}`);
    exactKeys(receipt, HOST_RECEIPT_KEYS, `replacement host receipt ${name}`);
    assert(receipt.operation === name, `replacement host receipt ${name} operation is not bound`);
    assert(receipt.status === "OBSERVED", `replacement host receipt ${name} is not observed`);
    requireIdentifier(receipt.session_id, `replacement host receipt ${name} session`);
    if (expectedSessionId !== null) assert(receipt.session_id === expectedSessionId, `replacement host receipt ${name} session differs from replacement`);
    requireUtc(receipt.observed_at_utc, `replacement host receipt ${name} time`);
    requireBoolean(receipt.meaningful_progress, `replacement host receipt ${name} meaningful progress`);
    assert(receipt.meaningful_progress === (name === "read"), `replacement host receipt ${name} meaningful-progress flag is invalid`);
    requireGitObject(receipt.source_commit, `replacement host receipt ${name} source commit`);
    requireGitObject(receipt.source_tree, `replacement host receipt ${name} source tree`);
    if (expectedSource !== null) assert(receipt.source_commit === expectedSource.commit && receipt.source_tree === expectedSource.tree,
      `replacement host receipt ${name} source differs from replacement`);
    requireSha(receipt.typed_handoff_sha256, `replacement host receipt ${name} typed handoff`, {nullable: true});
    if (name === "read") {
      requireSha(receipt.typed_handoff_sha256, `replacement host receipt ${name} typed handoff`);
      if (expectedTypedHandoffSha256 !== null) assert(receipt.typed_handoff_sha256 === expectedTypedHandoffSha256, "replacement read handoff differs from the replacement handoff");
    } else assert(receipt.typed_handoff_sha256 === null, `replacement host receipt ${name} carries a read-only handoff`);
    requireSha(receipt.receipt_sha256, `replacement host receipt ${name} digest`);
    assert(receipt.receipt_sha256 === digestWithout(receipt, "receipt_sha256"), `replacement host receipt ${name} digest mismatch`);
  }
  return receipts;
}

function validateClearance(clearance, goal, replacementSessionId = null) {
  exactKeys(clearance, CLEARANCE_KEYS, "replacement clearance");
  assert(["PASS", "FAILURE"].includes(clearance.status), "replacement clearance status is invalid");
  assert(clearance.independent === true, "replacement clearance is not independent");
  requireIdentifier(clearance.auditor_id, "replacement clearance Auditor");
  assert(clearance.auditor_id === goal.auditor_id, "replacement clearance used the wrong Auditor");
  if (replacementSessionId !== null) assert(clearance.auditor_id !== replacementSessionId, "replacement clearance is self-authored by the replacement worker");
  requireGitObject(clearance.source_commit, "replacement clearance commit");
  requireGitObject(clearance.source_tree, "replacement clearance tree");
  assert(clearance.source_commit === goal.source_commit && clearance.source_tree === goal.source_tree, "replacement clearance source differs");
  requireSha(clearance.handoff_sha256, "replacement clearance handoff");
  requireSha(clearance.receipt_sha256, "replacement clearance receipt");
  return clearance;
}

export function validateReplacementReceipt(receipt, {auditorId = null} = {}) {
  exactKeys(receipt, REPLACEMENT_HOST_KEYS, "replacement receipt");
  assert(receipt.schema === REPLACEMENT_RECEIPT_SCHEMA && receipt.version === 1, "replacement receipt identity is invalid");
  assert(receipt.status === "CLOSED_ARCHIVED_AND_CLEARED", "replacement receipt is not closed and cleared");
  requireBoolean(receipt.visible, "replacement visibility");
  assert(receipt.visible === true, "replacement session was not visible");
  requireIdentifier(receipt.session_id, "replacement session");
  assert(receipt.role === "TEMPORARY_CAMPAIGN_WORKER", "replacement role is invalid");
  requireBuildTag(receipt.build_tag, "replacement build tag");
  requireTemporaryDisplayName(receipt.display_name, receipt.build_tag, "replacement display name");
  requireString(receipt.model, "replacement model");
  assert(SAFE_LABEL.test(receipt.model), "replacement model is not a safe admitted label");
  requireString(receipt.reasoning_effort, "replacement reasoning effort");
  assert(SAFE_LABEL.test(receipt.reasoning_effort), "replacement reasoning effort is not a safe admitted label");
  requireIdentifier(receipt.predecessor_session_id, "replacement predecessor session");
  requireSha(receipt.predecessor_handoff_sha256, "replacement predecessor handoff");
  requireGitObject(receipt.source_commit, "replacement source commit");
  requireGitObject(receipt.source_tree, "replacement source tree");
  assert(receipt.meaningful_progress_required === true, "replacement meaningful-progress requirement is missing");
  requireSha(receipt.typed_handoff_sha256, "replacement typed handoff");
  if (auditorId !== null) {
    requireIdentifier(auditorId, "replacement Auditor");
    assert(receipt.session_id !== auditorId, "replacement worker session is also the independent Auditor");
  }
  validateHostReceipts(receipt.receipts, {
    expectedSessionId: receipt.session_id,
    expectedSource: {commit: receipt.source_commit, tree: receipt.source_tree},
    expectedTypedHandoffSha256: receipt.typed_handoff_sha256,
  });
  validateProtectedActions(receipt.protected_actions, "replacement protected actions");
  requireSha(receipt.receipt_sha256, "replacement receipt digest");
  assert(receipt.receipt_sha256 === digestWithout(receipt, "receipt_sha256"), "replacement receipt digest mismatch");
  return receipt;
}

export function compileReplacementReceipt({sessionId, predecessor, goal, hostReceipts, typedHandoffSha256, model = null, reasoningEffort = null}) {
  validatePredecessor(predecessor);
  validateReplacementGoal(goal);
  requireIdentifier(sessionId, "replacement session");
  assert(sessionId !== goal.auditor_id, "replacement worker session is also the independent Auditor");
  requireSafePersistedText(model, "replacement model");
  assert(SAFE_LABEL.test(model), "replacement model is not a safe admitted label");
  requireSafePersistedText(reasoningEffort, "replacement reasoning effort");
  assert(SAFE_LABEL.test(reasoningEffort), "replacement reasoning effort is not a safe admitted label");
  requireSha(typedHandoffSha256, "replacement typed handoff");
  const receipt = {
    schema: REPLACEMENT_RECEIPT_SCHEMA,
    version: 1,
    status: "CLOSED_ARCHIVED_AND_CLEARED",
    visible: true,
    session_id: sessionId,
    role: "TEMPORARY_CAMPAIGN_WORKER",
    display_name: goal.display_name,
    model,
    reasoning_effort: reasoningEffort,
    predecessor_session_id: predecessor.session_id,
    predecessor_handoff_sha256: predecessor.handoff_sha256,
    build_tag: goal.build_tag,
    source_commit: goal.source_commit,
    source_tree: goal.source_tree,
    meaningful_progress_required: true,
    typed_handoff_sha256: typedHandoffSha256,
    receipts: structuredClone(hostReceipts),
    protected_actions: Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, false])),
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = digestWithout(receipt, "receipt_sha256");
  return validateReplacementReceipt(receipt);
}

function validateRepairWorkflowRecord(record) {
  const keys = [
    "schema", "version", "status", "loop_id", "inspection_sha256", "preserved_evidence_sha256", "classification", "root_cause",
    "repair", "predecessor", "replacement_goal", "replacement_receipt", "independent_clearance", "host_failure", "outcome", "protected_actions", "recorded_at_utc", "record_sha256",
  ];
  exactKeys(record, keys, "repair workflow record");
  assert(record.schema === REPAIR_RECORD_SCHEMA && record.version === 1, "repair workflow record identity is invalid");
  assert(record.status === "PRESERVED", "repair workflow record is not preserved");
  requireIdentifier(record.loop_id, "repair workflow loop");
  requireSha(record.inspection_sha256, "repair workflow inspection");
  requireSha(record.preserved_evidence_sha256, "repair workflow evidence");
  assert(FINDING_CLASSIFICATIONS.includes(record.classification) && record.classification !== "NONE", "repair workflow classification is invalid");
  validateRootCause(record.root_cause);
  validateRepairRecord(record.repair);
  assert(record.repair.classification === record.classification, "repair workflow classification differs from its repair receipt");
  assert(record.repair.preserved_evidence_sha256 === record.preserved_evidence_sha256, "repair workflow evidence differs from its repair receipt");
  validatePredecessor(record.predecessor);
  if (record.replacement_goal !== null) {
    validateReplacementGoal(record.replacement_goal);
    assert(record.replacement_goal.loop_id === record.loop_id, "replacement goal belongs to another loop");
    assert(record.replacement_goal.repair_record_sha256 === record.repair.repair_sha256, "replacement goal is not bound to its repair receipt");
    assert(record.replacement_goal.predecessor_worker_id === record.predecessor.worker_id
      && record.replacement_goal.predecessor_session_id === record.predecessor.session_id
      && record.replacement_goal.predecessor_handoff_sha256 === record.predecessor.handoff_sha256,
    "replacement goal is not bound to its predecessor handoff");
    const expectedGoalId = `REPLACEMENT-GOAL-${loopDigest({loop: record.loop_id, inspection: record.inspection_sha256, repair: record.repair.repair_sha256, predecessor: record.predecessor.handoff_sha256}).slice(0, 20).toUpperCase()}`;
    assert(record.replacement_goal.goal_id === expectedGoalId, "replacement goal is not bound to its inspection");
  }
  if (record.replacement_receipt !== null) {
    assert(record.replacement_goal !== null, "replacement receipt exists without a replacement goal");
    validateReplacementReceipt(record.replacement_receipt, {auditorId: record.replacement_goal.auditor_id});
    assert(record.replacement_receipt.predecessor_session_id === record.predecessor.session_id
      && record.replacement_receipt.predecessor_handoff_sha256 === record.predecessor.handoff_sha256,
    "replacement receipt is not bound to its predecessor handoff");
    assert(record.replacement_receipt.source_commit === record.replacement_goal.source_commit
      && record.replacement_receipt.source_tree === record.replacement_goal.source_tree,
    "replacement receipt is not bound to its replacement goal source");
  }
  if (record.independent_clearance !== null) {
    assert(record.replacement_goal !== null && record.replacement_receipt !== null, "independent clearance exists without a replacement");
    validateClearance(record.independent_clearance, record.replacement_goal, record.replacement_receipt.session_id);
  }
  validateHostFailure(record.host_failure);
  assert(REPAIR_RECORD_OUTCOME.includes(record.outcome), "repair workflow outcome is invalid");
  if (record.outcome === "REPAIR_FAILED_RETAINED") assert(record.repair.status === "FAILED" && record.replacement_goal === null && record.replacement_receipt === null, "failed repair workflow advanced");
  if (record.outcome === "REPLACEMENT_BLOCKED") {
    assert(record.repair.status === "APPLIED" && record.host_failure !== null, "blocked replacement record is inconsistent");
    if (record.host_failure.phase === "CREATE_REPLACEMENT") assert(record.replacement_receipt === null && record.independent_clearance === null, "replacement creation failure advanced closure");
    if (record.host_failure.phase === "INDEPENDENT_CLEARANCE") assert(record.replacement_receipt !== null, "clearance failure lost the closed replacement receipt");
  }
  if (record.outcome === "REPLACED_AND_CLEARED") assert(record.repair.status === "APPLIED" && record.replacement_goal !== null && record.replacement_receipt !== null && record.independent_clearance?.status === "PASS" && record.host_failure === null, "cleared replacement record is incomplete");
  validateProtectedActions(record.protected_actions, "repair workflow protected actions");
  requireUtc(record.recorded_at_utc, "repair workflow time");
  requireSha(record.record_sha256, "repair workflow digest");
  assert(record.record_sha256 === digestWithout(record, "record_sha256"), "repair workflow digest mismatch");
  return record;
}

export function runContinuousOperatingLoopIteration({
  loop,
  workers,
  observedAtUtc,
  observedSourceCommit = null,
  observedSourceTree = null,
  observedIntentSha256 = null,
  continuationAfterHardStop = false,
  projectBinding = null,
  predecessor = null,
  repair = null,
  applyPatch = null,
  createReplacement = null,
  independentClearance = null,
}) {
  throw Object.assign(new Error("Legacy Intent Regulator operating loop is retired; use separate Controller workflow and Product Owner intent monitors"), {code: "RETIRED_ROLE_AUTHORITY_FORBIDDEN"});
  const inspection = compileLoopInspection({loop, workers, observedAtUtc, observedSourceCommit, observedSourceTree, observedIntentSha256, continuationAfterHardStop, projectBinding});
  if (inspection.action === "STOP_HARD_BOUNDARY") return {inspection, status: "HARD_STOPPED", continuation_allowed: false, repair_record: null};
  if (inspection.action === "CLOSE_GOAL_SUCCEEDED_BY_REASSESSMENT") {
    assert(repair === null && predecessor === null && applyPatch === null && createReplacement === null && independentClearance === null,
      "source or intent reassessment cannot apply a stale repair or replacement");
    return {inspection, status: "SUCCEEDED_BY_REASSESSMENT", continuation_allowed: false, repair_record: null};
  }
  if (inspection.worker_reports.some((report) => report.finding_classification === "TRUE_BLOCKER")) {
    return {inspection, status: "INTENT_REGULATOR_REVIEW_REQUIRED", continuation_allowed: false, repair_record: null};
  }
  if (inspection.action === "SOFT_BOUNDARY_REVIEW") return {inspection, status: "SOFT_REVIEW_REQUIRED", continuation_allowed: false, repair_record: null};
  if (inspection.action === "CONTINUE") return {inspection, status: "CONTINUED", continuation_allowed: true, repair_record: null};
  if (inspection.action === "ORCHESTRATOR_REPAIR" && repair === null && typeof applyPatch !== "function") return {inspection, status: "REPAIR_REQUIRED", continuation_allowed: false, repair_record: null};
  assert(predecessor !== null, "replacement requires the predecessor typed handoff and session identity");
  validatePredecessor(predecessor);
  let repairReceipt = repair;
  if (typeof applyPatch === "function") {
    try {
      repairReceipt = applyPatch({inspection: structuredClone(inspection), predecessor: structuredClone(predecessor)});
    } catch (error) {
      repairReceipt = compileRepairRecord({
        classification: inspection.worker_reports.find((report) => report.finding_classification !== "NONE")?.finding_classification ?? "TRUE_BLOCKER",
        preservedEvidenceSha256: inspection.preserved_evidence_sha256,
        rootCause: {category: "PATCH_ADAPTER_FAILURE", summary: opaqueFailure(error), contributing_factors: []},
        status: "FAILED",
        sourceBefore: {commit: loop.source_commit, tree: loop.source_tree},
        sourceAfter: {commit: loop.source_commit, tree: loop.source_tree},
        patchReceiptSha256: loopDigest({message: opaqueFailure(error)}),
      });
    }
  }
  validateRepairRecord(repairReceipt);
  const classification = inspection.worker_reports.find((report) => report.finding_classification !== "NONE")?.finding_classification ?? "PUZZLE";
  const rootCause = structuredClone(repairReceipt.root_cause);
  if (repairReceipt.status === "FAILED") {
    const failedRecord = {
      schema: REPAIR_RECORD_SCHEMA,
      version: 1,
      status: "PRESERVED",
      loop_id: loop.loop_id,
      inspection_sha256: inspection.inspection_sha256,
      preserved_evidence_sha256: inspection.preserved_evidence_sha256,
      classification,
      root_cause: rootCause,
      repair: repairReceipt,
      predecessor: structuredClone(predecessor),
      replacement_goal: null,
      replacement_receipt: null,
      independent_clearance: null,
      host_failure: null,
      outcome: "REPAIR_FAILED_RETAINED",
      protected_actions: structuredClone(loop.protected_actions),
      recorded_at_utc: observedAtUtc,
      record_sha256: null,
    };
    failedRecord.record_sha256 = digestWithout(failedRecord, "record_sha256");
    return {inspection, status: "REPAIR_FAILED_RETAINED", continuation_allowed: false, repair_record: validateRepairWorkflowRecord(failedRecord)};
  }
  const replacementGoal = compileReplacementGoal({loop, inspection, repair: repairReceipt, predecessor, sourceCommit: repairReceipt.source_after.commit, sourceTree: repairReceipt.source_after.tree, projectBinding});
  const buildBlockedRecord = (hostFailure, replacementReceiptValue = null, clearanceValue = null) => {
    const blocked = {
      schema: REPAIR_RECORD_SCHEMA,
      version: 1,
      status: "PRESERVED",
      loop_id: loop.loop_id,
      inspection_sha256: inspection.inspection_sha256,
      preserved_evidence_sha256: inspection.preserved_evidence_sha256,
      classification,
      root_cause: rootCause,
      repair: repairReceipt,
      predecessor: structuredClone(predecessor),
      replacement_goal: replacementGoal,
      replacement_receipt: replacementReceiptValue,
      independent_clearance: clearanceValue,
      host_failure: hostFailure,
      outcome: "REPLACEMENT_BLOCKED",
      protected_actions: structuredClone(loop.protected_actions),
      recorded_at_utc: observedAtUtc,
      record_sha256: null,
    };
    blocked.record_sha256 = digestWithout(blocked, "record_sha256");
    return validateRepairWorkflowRecord(blocked);
  };
  let replacementReceipt = null;
  let hostFailure = null;
  if (typeof createReplacement !== "function") hostFailure = compileHostFailure({phase: "CREATE_REPLACEMENT", error: new Error("createReplacement adapter did not return a host readback.")});
  else {
    try {
      replacementReceipt = createReplacement({goal: structuredClone(replacementGoal), predecessor: structuredClone(predecessor)});
      if (replacementReceipt === null) throw new Error("createReplacement adapter returned no host readback.");
      validateReplacementReceipt(replacementReceipt, {auditorId: replacementGoal.auditor_id});
      assert(replacementReceipt.predecessor_handoff_sha256 === predecessor.handoff_sha256, "replacement does not preserve predecessor handoff");
      assert(replacementReceipt.session_id !== predecessor.session_id, "replacement reused predecessor session");
    } catch (error) {
      hostFailure = compileHostFailure({phase: "CREATE_REPLACEMENT", error, rawReceipt: replacementReceipt});
    }
  }
  if (hostFailure !== null) return {inspection, status: "REPLACEMENT_BLOCKED", continuation_allowed: false, repair_record: buildBlockedRecord(hostFailure)};
  const clearance = independentClearance;
  let validatedClearance = null;
  try {
    if (clearance === null) throw new Error("replacement requires independent clearance.");
    validateClearance(clearance, replacementGoal, replacementReceipt.session_id);
    validatedClearance = clearance;
    assert(clearance.status === "PASS", "independent clearance did not pass");
  } catch (error) {
    hostFailure = compileHostFailure({phase: "INDEPENDENT_CLEARANCE", error, rawReceipt: clearance});
    return {inspection, status: "REPLACEMENT_BLOCKED", continuation_allowed: false, repair_record: buildBlockedRecord(hostFailure, replacementReceipt, validatedClearance)};
  }
  const complete = {
    schema: REPAIR_RECORD_SCHEMA,
    version: 1,
    status: "PRESERVED",
    loop_id: loop.loop_id,
    inspection_sha256: inspection.inspection_sha256,
    preserved_evidence_sha256: inspection.preserved_evidence_sha256,
    classification,
    root_cause: rootCause,
    repair: repairReceipt,
    predecessor: structuredClone(predecessor),
    replacement_goal: replacementGoal,
    replacement_receipt: replacementReceipt,
    independent_clearance: structuredClone(clearance),
    host_failure: null,
    outcome: "REPLACED_AND_CLEARED",
    protected_actions: structuredClone(loop.protected_actions),
    recorded_at_utc: observedAtUtc,
    record_sha256: null,
  };
  complete.record_sha256 = digestWithout(complete, "record_sha256");
  return {inspection, status: "REPLACED_AND_CLEARED", continuation_allowed: true, repair_record: validateRepairWorkflowRecord(complete)};
}

function sleep(milliseconds, signal = null) {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    if (signal) signal.addEventListener("abort", finish, {once: true});
  });
}

export async function runContinuousOperatingLoop({
  observe,
  onIteration = null,
  resolveIteration = null,
  onSameTurnBoundExhausted = null,
  intervalMinutes = DEFAULT_MEANINGFUL_PROGRESS_WINDOW_MINUTES,
  intervalMs = null,
  maxSameTurnReplacements = DEFAULT_MAX_SAME_TURN_REPLACEMENTS,
  once = false,
  signal = null,
}) {
  throw Object.assign(new Error("Legacy Intent Regulator operating loop is retired; use separate Controller workflow and Product Owner intent monitors"), {code: "RETIRED_ROLE_AUTHORITY_FORBIDDEN"});
  assert(typeof observe === "function", "continuous loop observe function is required");
  assert(onIteration === null || typeof onIteration === "function", "continuous loop iteration callback is invalid");
  assert(resolveIteration === null || typeof resolveIteration === "function", "continuous loop iteration resolver is invalid");
  assert(onSameTurnBoundExhausted === null || typeof onSameTurnBoundExhausted === "function", "continuous loop bound callback is invalid");
  assert(Number.isSafeInteger(intervalMinutes) && intervalMinutes >= 1 && intervalMinutes <= 24 * 60, "continuous loop interval minutes are invalid");
  const resolvedIntervalMs = intervalMs === null ? intervalMinutes * 60_000 : intervalMs;
  assert(Number.isSafeInteger(resolvedIntervalMs) && resolvedIntervalMs >= 250 && resolvedIntervalMs <= 24 * 60 * 60_000, "continuous loop interval is invalid");
  assert(Number.isSafeInteger(maxSameTurnReplacements) && maxSameTurnReplacements >= 1 && maxSameTurnReplacements <= 256, "continuous loop same-turn replacement bound is invalid");
  const results = [];
  let sameTurnReplacements = 0;
  do {
    if (signal?.aborted === true) break;
    const observation = await observe();
    requireRecord(observation, "continuous loop observation");
    const resolvedOptions = resolveIteration === null
      ? {}
      : await resolveIteration({observation: structuredClone(observation), previous_result: results.at(-1) ?? null});
    if (resolvedOptions !== null) requireRecord(resolvedOptions, "continuous loop resolved iteration options");
    const result = runContinuousOperatingLoopIteration({
      ...observation,
      ...(resolvedOptions ?? {}),
    });
    results.push(result);
    if (onIteration !== null) await onIteration(result);
    if (once || signal?.aborted === true) break;
    // A repair-required, blocked, or hard-stop result is a routed workflow
    // decision, not a reason to sleep until the next inspection window. Return
    // it to the owning handler immediately. A typed replacement is the one
    // local successor that may continue in this turn, bounded against a
    // malformed adapter that keeps returning the same replacement.
    if (result.status === "REPLACED_AND_CLEARED") {
      sameTurnReplacements += 1;
      if (sameTurnReplacements >= maxSameTurnReplacements) {
        const boundFailure = new Error("CONTINUOUS_LOOP_SAME_TURN_REPLACEMENT_BOUND_EXHAUSTED");
        boundFailure.code = "AGENTOS_CONTINUOUS_LOOP_REPLACEMENT_BOUND_EXHAUSTED";
        const event = {
          code: boundFailure.code,
          error: boundFailure.message,
          replacement_count: sameTurnReplacements,
          max_same_turn_replacements: maxSameTurnReplacements,
          last_result: structuredClone(result),
        };
        if (onSameTurnBoundExhausted !== null) {
          await onSameTurnBoundExhausted(event);
          break;
        }
        throw boundFailure;
      }
      continue;
    }
    if (result.continuation_allowed !== true) break;
    sameTurnReplacements = 0;
    await sleep(resolvedIntervalMs, signal);
  } while (signal?.aborted !== true);
  return results;
}

function safeRecordPath(authorityRoot, recordPath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "loop authority root must be absolute");
  requireString(recordPath, "loop record path");
  assert(!path.isAbsolute(recordPath) && !recordPath.includes("\\"), "loop record path must be relative");
  const root = fs.realpathSync.native(authorityRoot);
  const rootStat = fs.lstatSync(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "loop authority root must be a real directory");
  const target = path.resolve(root, recordPath);
  assert(target.startsWith(`${root}${path.sep}`), "loop record path escapes authority root");
  for (let cursor = target; cursor !== root; cursor = path.dirname(cursor)) if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "loop record path may not contain symlinks");
  return target;
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateRecord(record) {
  requireRecord(record, "loop record");
  if (record.schema === LOOP_INSPECTION_SCHEMA) return validateLoopInspection(record);
  if (record.schema === PATCH_RECEIPT_SCHEMA) return validateRepairRecord(record);
  if (record.schema === REPAIR_RECORD_SCHEMA) return validateRepairWorkflowRecord(record);
  if (record.schema === REPLACEMENT_GOAL_SCHEMA) return validateReplacementGoal(record);
  if (record.schema === REPLACEMENT_RECEIPT_SCHEMA) return validateReplacementReceipt(record);
  throw new Error("unsupported continuous loop record schema");
}

export function readContinuousOperatingLoopRecord({authorityRoot, recordPath}) {
  throw Object.assign(new Error("Legacy Intent Regulator operating-loop storage is retired"), {code: "RETIRED_ROLE_AUTHORITY_FORBIDDEN"});
  const target = safeRecordPath(authorityRoot, recordPath);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  assert(stat.isFile() && !stat.isSymbolicLink(), "loop record must be a regular file");
  let record;
  try { record = JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) { throw new Error(`loop record JSON is invalid: ${error.message}`); }
  return validateRecord(record);
}

export function writeContinuousOperatingLoopRecordCompareAndSwap({authorityRoot, recordPath, expectedRecordSha256 = null, record}) {
  throw Object.assign(new Error("Legacy Intent Regulator operating-loop storage is retired"), {code: "RETIRED_ROLE_AUTHORITY_FORBIDDEN"});
  const validated = validateRecord(record);
  const digestField = RECORD_SCHEMA_TO_DIGEST.get(record.schema);
  const target = safeRecordPath(authorityRoot, recordPath);
  if (expectedRecordSha256 !== null) requireSha(expectedRecordSha256, "loop compare-and-swap parent");
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let lockHeld = false;
  let temporary;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    lockHeld = true;
    const current = readContinuousOperatingLoopRecord({authorityRoot, recordPath});
    if (expectedRecordSha256 === null) assert(current === null, "loop record already exists");
    else assert(current !== null && current[digestField] === expectedRecordSha256, "loop compare-and-swap parent is stale");
    temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    fsyncDirectory(path.dirname(target));
    temporary = null;
  } finally {
    if (temporary !== undefined && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    if (lockHeld) { try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  }
  const readback = readContinuousOperatingLoopRecord({authorityRoot, recordPath});
  assert(readback[digestField] === validated[digestField], "loop record readback differs");
  return {path: recordPath, record_sha256: readback[digestField]};
}
