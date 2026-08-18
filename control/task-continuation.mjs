#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {campaignIdentityBindingDigest} from "./campaign-controller.mjs";
import {AUDIT_DISCIPLINES} from "./campaign-cascade.mjs";
import {AGENTOS_CONTROLLER_DISPLAY_NAME, AGENTOS_CONTROLLER_ROLE, controllerDisplayTitle, validateControllerRoleDisplay} from "./controller-role-display.mjs";

export const CONTINUATION_TASK_SCHEMA = "agentos.control_plane_continuation_task.v1";
export const CONTINUATION_HANDOFF_SCHEMA = "agentos.control_plane_continuation_handoff.v1";
export const CONTINUATION_TASK_STATUS = "IN_PROGRESS_INACTIVE";
export const CONTINUATION_START_HANDOFF_STATUS = "STARTED_INACTIVE";
export const CONTINUATION_COMPLETION_HANDOFF_STATUS = "COMPLETED_INACTIVE";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const INACTIVE_BOUNDARY_KEYS = [
  "secrets_allowed", "destructive_work_allowed", "campaign_activation_allowed", "active_campaign",
  "product_writes_allowed", "product_agent_spawns_allowed", "deployment_allowed", "publication_allowed",
  "push_allowed", "merge_allowed", "sterile_copy_allowed", "policy_changes_allowed", "owner_intent_changes_allowed",
  "campaign_identity_changes_allowed", "release_candidate_activation_allowed",
];
const TASK_CANDIDATE_KEYS = [
  "task_id", "controller_role", "controller_display_name", "display_title", "version", "goal", "scope", "change_set", "excluded_scope", "checks", "stop_conditions", "undo",
  "start_boundary", "boundary",
];
const LEGACY_TASK_CANDIDATE_KEYS = [
  "task_id", "version", "goal", "scope", "change_set", "excluded_scope", "checks", "stop_conditions", "undo",
  "start_boundary", "boundary",
];
const TASK_KEYS = [
  "schema", "version", "status", "task_id", "controller_role", "controller_display_name", "display_title", "project_id", "campaign_id", "campaign_version",
  "canonical_campaign_identity", "parent_handoff_sha256", "parent_reconciliation_sha256", "source_commit", "source_tree",
  "policy_epoch", "policy_state_sha256", "authorization_status", "authorization_route", "goal", "scope", "change_set",
  "excluded_scope", "checks", "stop_conditions", "undo", "start_boundary", "boundary", "started_at_utc", "task_sha256",
];
const LEGACY_TASK_KEYS = [
  "schema", "version", "status", "task_id", "project_id", "campaign_id", "campaign_version",
  "canonical_campaign_identity", "parent_handoff_sha256", "parent_reconciliation_sha256", "source_commit", "source_tree",
  "policy_epoch", "policy_state_sha256", "authorization_status", "authorization_route", "goal", "scope", "change_set",
  "excluded_scope", "checks", "stop_conditions", "undo", "start_boundary", "boundary", "started_at_utc", "task_sha256",
];
const HANDOFF_KEYS = [
  "schema", "version", "status", "phase", "task_sha256", "controller_role", "controller_display_name", "display_title", "parent_handoff_sha256", "parent_reconciliation_sha256",
  "task", "campaign_binding", "source_checkpoint", "boundary", "audit_reports", "audit_reconciliation", "findings",
  "next_action", "stop_conditions", "undo", "recorded_at_utc", "handoff_sha256",
];
const LEGACY_HANDOFF_KEYS = [
  "schema", "version", "status", "phase", "task_sha256", "parent_handoff_sha256", "parent_reconciliation_sha256",
  "task", "campaign_binding", "source_checkpoint", "boundary", "audit_reports", "audit_reconciliation", "findings",
  "next_action", "stop_conditions", "undo", "recorded_at_utc", "handoff_sha256",
];
const AUDIT_REPORT_KEYS = [
  "schema", "version", "report_id", "discipline", "task_sha256", "parent_reconciliation_sha256", "campaign_id",
  "campaign_version", "source_commit", "source_tree", "independent", "auditor_role", "checked_at_utc", "scope", "checks",
  "findings", "settled", "report_sha256",
];
const AUDIT_CHECK_KEYS = ["command", "exit_code", "stdout_class", "stdout_sha256", "stderr_class", "stderr_sha256", "passed", "check_sha256"];
const LEGACY_AUDIT_CHECK_KEYS = ["command", "exit_code", "stdout", "stderr", "passed", "check_sha256"];
const OUTPUT_CLASSES = new Set(["OUTPUT_EMPTY", "OUTPUT_PRESENT", "OUTPUT_REDACTED"]);
const AUDIT_RECONCILIATION_KEYS = [
  "schema", "version", "status", "task_sha256", "parent_reconciliation_sha256", "campaign_id", "campaign_version",
  "source_commit", "source_tree", "complete_reports", "settled_disciplines", "report_sha256", "findings",
  "immediate_first_pass_repairs", "finalization_queue", "owner_only_findings", "reconciliation_sha256",
];
const RECORD_SCHEMA_TO_DIGEST = new Map([
  [CONTINUATION_TASK_SCHEMA, "task_sha256"],
  [CONTINUATION_HANDOFF_SCHEMA, "handoff_sha256"],
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
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function exactKeysWithLegacy(value, keys, legacyKeys, label) {
  requireRecord(value, label);
  const actual = JSON.stringify(Object.keys(value).sort());
  if (actual === JSON.stringify([...legacyKeys].sort())) return false;
  assert(actual === JSON.stringify([...keys].sort()), `${label} fields mismatch`);
  return true;
}

function requireString(value, label, {allowEmpty = false} = {}) {
  assert(typeof value === "string" && (allowEmpty || value.trim().length > 0), `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
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

function requireOutput(value, label) {
  assert(typeof value === "string", `${label} must be text`);
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), `${label} contains invalid control characters`);
}

function digestWithout(value, field) {
  return campaignIdentityBindingDigest({...value, [field]: null});
}

export function continuationDigest(value) {
  return campaignIdentityBindingDigest(value);
}

function validateBoundary(boundary, label, {controllerStatus = false} = {}) {
  const keys = controllerStatus ? [...INACTIVE_BOUNDARY_KEYS, "controller_status"] : INACTIVE_BOUNDARY_KEYS;
  exactKeys(boundary, keys, label);
  for (const key of INACTIVE_BOUNDARY_KEYS) {
    requireBoolean(boundary[key], `${label}.${key}`);
    assert(boundary[key] === false, `${label}.${key} crossed the inactive boundary`);
  }
  if (controllerStatus) assert(boundary.controller_status === "PREPARED_NOT_ACTIVATED", `${label}.controller_status crossed activation`);
  return boundary;
}

function validatePriorHandoffBoundary(boundary) {
  exactKeys(boundary, [
    "active_campaign", "campaign_identity_changed", "controller_status", "deployment_allowed", "merge_allowed",
    "owner_intent_changed", "policy_changed", "product_agent_spawns_allowed", "product_writes_allowed", "publication_allowed", "push_allowed",
    "release_candidate_activation", "sterile_copy_changed",
  ], "completed handoff boundary");
  assert(boundary.active_campaign === false && boundary.controller_status === "PREPARED_NOT_ACTIVATED", "completed handoff boundary crossed activation");
  for (const field of [
    "campaign_identity_changed", "deployment_allowed", "merge_allowed", "owner_intent_changed", "policy_changed", "product_agent_spawns_allowed",
    "product_writes_allowed", "publication_allowed", "push_allowed", "release_candidate_activation", "sterile_copy_changed",
  ]) assert(boundary[field] === false, `completed handoff boundary ${field} crossed`);
  return boundary;
}

function validateTaskCandidate(candidate) {
  const hasRoleDisplay = exactKeysWithLegacy(candidate, TASK_CANDIDATE_KEYS, LEGACY_TASK_CANDIDATE_KEYS, "continuation task candidate");
  requireIdentifier(candidate.task_id, "continuation task ID");
  if (hasRoleDisplay) validateControllerRoleDisplay({controllerRole: candidate.controller_role, controllerDisplayName: candidate.controller_display_name, displayTitle: candidate.display_title}, {taskId: candidate.task_id, label: "continuation task display"});
  assert(Number.isSafeInteger(candidate.version) && candidate.version === 1, "continuation task version is invalid");
  requireString(candidate.goal, "continuation task goal");
  assert(candidate.scope === "CONTROL_PLANE_ONLY", "continuation task scope is not control-plane-only");
  requireStringArray(candidate.change_set, "continuation task changes");
  requireStringArray(candidate.excluded_scope, "continuation task exclusions");
  requireStringArray(candidate.checks, "continuation task checks");
  requireStringArray(candidate.stop_conditions, "continuation task stop conditions");
  requireStringArray(candidate.undo, "continuation task undo");
  assert(candidate.start_boundary === "OWNER_AUTHORIZED_EXACT_TASK", "continuation task start boundary is invalid");
  validateBoundary(candidate.boundary, "continuation task boundary");
  return candidate;
}

export function validateContinuationTask(task) {
  const hasRoleDisplay = exactKeysWithLegacy(task, TASK_KEYS, LEGACY_TASK_KEYS, "continuation task");
  assert(task.schema === CONTINUATION_TASK_SCHEMA && task.version === 1, "continuation task identity is invalid");
  assert(task.status === CONTINUATION_TASK_STATUS, "continuation task is not inactive in-progress");
  for (const field of ["task_id", "project_id", "campaign_id", "campaign_version"]) requireIdentifier(task[field], `continuation ${field}`);
  if (hasRoleDisplay) validateControllerRoleDisplay({controllerRole: task.controller_role, controllerDisplayName: task.controller_display_name, displayTitle: task.display_title}, {taskId: task.task_id, label: "continuation task display"});
  assert(task.canonical_campaign_identity === "CONTROLLER_CANDIDATE", "continuation task canonical identity is invalid");
  for (const field of ["parent_handoff_sha256", "parent_reconciliation_sha256", "policy_state_sha256", "task_sha256"]) requireSha(task[field], `continuation task ${field}`);
  requireGitObject(task.source_commit, "continuation task source commit");
  requireGitObject(task.source_tree, "continuation task source tree");
  assert(Number.isSafeInteger(task.policy_epoch) && task.policy_epoch >= 1, "continuation task policy epoch is invalid");
  assert(task.authorization_status === "OWNER_AUTHORIZED_EXACT_TASK", "continuation task authorization is invalid");
  assert(task.authorization_route === "DIRECT_AGENTOS_CONFIRMATION", "continuation task authorization route is invalid");
  requireString(task.goal, "continuation task goal");
  assert(task.scope === "CONTROL_PLANE_ONLY", "continuation task scope is invalid");
  for (const field of ["change_set", "excluded_scope", "checks", "stop_conditions", "undo"]) requireStringArray(task[field], `continuation task ${field}`);
  assert(task.start_boundary === "OWNER_AUTHORIZED_EXACT_TASK", "continuation task start boundary is invalid");
  validateBoundary(task.boundary, "continuation task boundary");
  requireUtc(task.started_at_utc, "continuation task start time");
  assert(task.task_sha256 === digestWithout(task, "task_sha256"), "continuation task digest mismatch");
  return task;
}

function validateAuditCheck(check, label) {
  const typedOutput = exactKeysWithLegacy(check, AUDIT_CHECK_KEYS, LEGACY_AUDIT_CHECK_KEYS, label);
  requireString(check.command, `${label} command`);
  assert(Number.isInteger(check.exit_code), `${label} exit code is invalid`);
  if (typedOutput) {
    for (const field of ["stdout_class", "stderr_class"]) {
      requireString(check[field], `${label} ${field}`);
      assert(OUTPUT_CLASSES.has(check[field]), `${label} ${field} is invalid`);
    }
    for (const field of ["stdout_sha256", "stderr_sha256"]) requireSha(check[field], `${label} ${field}`);
  } else {
    requireOutput(check.stdout, `${label} stdout`);
    requireOutput(check.stderr, `${label} stderr`);
  }
  requireBoolean(check.passed, `${label} passed`);
  requireSha(check.check_sha256, `${label} digest`);
  assert(check.check_sha256 === digestWithout(check, "check_sha256"), `${label} digest mismatch`);
  assert(check.passed === (check.exit_code === 0), `${label} result is inconsistent`);
  return check;
}

function validateAuditReport(report, task) {
  exactKeys(report, AUDIT_REPORT_KEYS, "continuation audit report");
  assert(report.schema === "agentos.development_task_audit_report.v1" && report.version === 1, "continuation audit report identity is invalid");
  requireIdentifier(report.report_id, "continuation audit report ID");
  assert(AUDIT_DISCIPLINES.includes(report.discipline), "continuation audit discipline is invalid");
  assert(report.task_sha256 === task.task_sha256 && report.parent_reconciliation_sha256 === task.parent_reconciliation_sha256, "continuation audit task binding differs");
  assert(report.campaign_id === task.campaign_id && report.campaign_version === task.campaign_version, "continuation audit campaign differs");
  assert(report.source_commit === task.source_commit && report.source_tree === task.source_tree, "continuation audit source differs");
  assert(report.independent === true, "continuation audit is not independent");
  requireIdentifier(report.auditor_role, "continuation audit auditor role");
  requireUtc(report.checked_at_utc, "continuation audit time");
  requireString(report.scope, "continuation audit scope");
  assert(Array.isArray(report.checks) && report.checks.length > 0, "continuation audit check bodies are required");
  report.checks.forEach((check, index) => validateAuditCheck(check, `continuation audit check ${index}`));
  assert(Array.isArray(report.findings) && report.findings.length === 0, "continuation audit has findings");
  assert(report.settled === true, "continuation audit is not settled");
  requireSha(report.report_sha256, "continuation audit report digest");
  assert(report.report_sha256 === digestWithout(report, "report_sha256"), "continuation audit report digest mismatch");
  return report;
}

function validateAuditReconciliation(reconciliation, task, reports) {
  exactKeys(reconciliation, AUDIT_RECONCILIATION_KEYS, "continuation audit reconciliation");
  assert(reconciliation.schema === "agentos.development_task_audit_reconciliation.v1" && reconciliation.version === 1, "continuation audit reconciliation identity is invalid");
  assert(reconciliation.status === "SETTLED_CLEAN", "continuation audit reconciliation is not clean");
  assert(reconciliation.task_sha256 === task.task_sha256 && reconciliation.parent_reconciliation_sha256 === task.parent_reconciliation_sha256, "continuation audit reconciliation task binding differs");
  assert(reconciliation.campaign_id === task.campaign_id && reconciliation.campaign_version === task.campaign_version, "continuation audit reconciliation campaign differs");
  assert(reconciliation.source_commit === task.source_commit && reconciliation.source_tree === task.source_tree, "continuation audit reconciliation source differs");
  assert(reconciliation.complete_reports === 4 && reports.length === 4, "continuation audit reconciliation is incomplete");
  assert(JSON.stringify(reconciliation.settled_disciplines) === JSON.stringify([...AUDIT_DISCIPLINES]), "continuation audit disciplines are incomplete or reordered");
  assert(JSON.stringify(reconciliation.report_sha256) === JSON.stringify(reports.map((report) => report.report_sha256)), "continuation audit report mapping differs");
  for (const field of ["findings", "immediate_first_pass_repairs", "finalization_queue", "owner_only_findings"]) assert(Array.isArray(reconciliation[field]) && reconciliation[field].length === 0, `continuation audit reconciliation ${field} is not empty`);
  requireSha(reconciliation.reconciliation_sha256, "continuation audit reconciliation digest");
  assert(reconciliation.reconciliation_sha256 === digestWithout(reconciliation, "reconciliation_sha256"), "continuation audit reconciliation digest mismatch");
  return reconciliation;
}

function validateCompletedInactiveHandoff(handoff) {
  exactKeys(handoff, [
    "schema", "version", "status", "task_sha256", "parent_reconciliation_sha256", "authorization", "task_definition", "parent_reconciliation",
    "campaign_binding", "task_checkpoint", "focused_checks", "four_audits", "audit_reconciliation", "boundary", "findings",
    "stop_conditions", "ready", "next_action", "undo", "recorded_at_utc", "handoff_sha256",
  ], "completed inactive handoff");
  assert(handoff.schema === "agentos.development_task_handoff.v1" && handoff.version === 1, "completed inactive handoff identity is invalid");
  assert(handoff.status === "COMPLETED_INACTIVE" && handoff.ready === true, "completed inactive handoff is not complete");
  requireSha(handoff.task_sha256, "completed handoff task");
  requireSha(handoff.parent_reconciliation_sha256, "completed handoff parent reconciliation");
  requireRecord(handoff.parent_reconciliation, "completed handoff parent reconciliation body");
  assert(handoff.parent_reconciliation.reconciliation_sha256 === handoff.parent_reconciliation_sha256
    && handoff.parent_reconciliation.status === "RECONCILED_INACTIVE"
    && handoff.parent_reconciliation.active_campaign === false,
  "completed handoff parent reconciliation differs");
  requireIdentifier(handoff.campaign_binding.project_id, "completed handoff project");
  requireIdentifier(handoff.campaign_binding.campaign_id, "completed handoff campaign");
  requireIdentifier(handoff.campaign_binding.campaign_version, "completed handoff campaign version");
  assert(handoff.campaign_binding.canonical_campaign_identity === "CONTROLLER_CANDIDATE", "completed handoff campaign identity is invalid");
  for (const field of ["source_commit", "source_tree"]) requireGitObject(handoff.campaign_binding[field], `completed handoff campaign ${field}`);
  for (const field of ["controller_candidate_sha256", "owner_review_candidate_sha256", "approval_packet_sha256", "identity_binding_sha256", "audit_checkpoint_sha256", "audit_plan_sha256", "audit_reconciliation_sha256", "control_plane_receipt_sha256"]) requireSha(handoff.campaign_binding[field], `completed handoff ${field}`);
  assert(handoff.campaign_binding.retained_status.active_campaign === false && handoff.campaign_binding.retained_status.controller_status === "PREPARED_NOT_ACTIVATED", "completed handoff retained status crossed activation");
  requireGitObject(handoff.task_checkpoint.source_commit, "completed handoff task checkpoint commit");
  requireGitObject(handoff.task_checkpoint.source_tree, "completed handoff task checkpoint tree");
  assert(handoff.task_checkpoint.clean === true && handoff.task_checkpoint.pushed === false, "completed handoff task checkpoint is not a clean local checkpoint");
  validatePriorHandoffBoundary(handoff.boundary);
  assert(Array.isArray(handoff.findings) && handoff.findings.length === 0, "completed handoff contains findings");
  assert(Array.isArray(handoff.four_audits) && handoff.four_audits.length === 4, "completed handoff lacks four audit bodies");
  const taskStub = {
    task_sha256: handoff.task_sha256,
    parent_reconciliation_sha256: handoff.parent_reconciliation_sha256,
    campaign_id: handoff.campaign_binding.campaign_id,
    campaign_version: handoff.campaign_binding.campaign_version,
    source_commit: handoff.task_checkpoint.source_commit,
    source_tree: handoff.task_checkpoint.source_tree,
  };
  handoff.four_audits.forEach((report) => validateAuditReport(report, taskStub));
  validateAuditReconciliation(handoff.audit_reconciliation, taskStub, handoff.four_audits);
  requireUtc(handoff.recorded_at_utc, "completed handoff time");
  requireSha(handoff.handoff_sha256, "completed handoff digest");
  assert(handoff.handoff_sha256 === digestWithout(handoff, "handoff_sha256"), "completed handoff digest mismatch");
  return handoff;
}

function validateContinuationReconciliation(reconciliation, handoff) {
  requireRecord(reconciliation, "continuation parent reconciliation");
  const expectedKeys = [
    "schema", "version", "status", "canonical_campaign_identity", "project_id", "campaign_id", "campaign_version",
    "source_commit", "source_tree", "parent_reconciliation_sha256", "task_sha256", "task_handoff_sha256",
    "task_status", "task_checkpoint_commit", "task_checkpoint_tree", "control_plane_receipt_sha256", "prior_status_sha256", "status_update",
    "active_campaign", "product_writes_allowed", "product_agent_spawns_allowed", "deployment_allowed", "scope_intent_unchanged",
    "campaign_identity_unchanged", "policy_unchanged", "sterile_copy_changed", "reconciled_at_utc", "next_action", "reconciliation_sha256",
  ];
  exactKeys(reconciliation, expectedKeys, "continuation parent reconciliation");
  assert(reconciliation.schema === "agentos.controller_orchestrator_task_reconciliation.v1" && reconciliation.version === 1, "continuation parent reconciliation identity is invalid");
  assert(reconciliation.status === "RECONCILED_INACTIVE" && reconciliation.canonical_campaign_identity === "CONTROLLER_CANDIDATE", "continuation parent reconciliation status is invalid");
  assert(reconciliation.project_id === handoff.campaign_binding.project_id && reconciliation.campaign_id === handoff.campaign_binding.campaign_id && reconciliation.campaign_version === handoff.campaign_binding.campaign_version, "continuation parent reconciliation campaign differs");
  assert(reconciliation.source_commit === handoff.campaign_binding.source_commit && reconciliation.source_tree === handoff.campaign_binding.source_tree, "continuation parent reconciliation campaign source differs");
  assert(reconciliation.parent_reconciliation_sha256 === handoff.parent_reconciliation_sha256 && reconciliation.task_sha256 === handoff.task_sha256 && reconciliation.task_handoff_sha256 === handoff.handoff_sha256, "continuation parent reconciliation handoff mapping differs");
  requireGitObject(reconciliation.task_checkpoint_commit, "continuation parent task checkpoint commit");
  requireGitObject(reconciliation.task_checkpoint_tree, "continuation parent task checkpoint tree");
  requireSha(reconciliation.control_plane_receipt_sha256, "continuation parent control-plane receipt");
  requireSha(reconciliation.prior_status_sha256, "continuation parent prior status");
  requireUtc(reconciliation.reconciled_at_utc, "continuation parent reconciliation time");
  assert(reconciliation.active_campaign === false && reconciliation.product_writes_allowed === false && reconciliation.product_agent_spawns_allowed === false && reconciliation.deployment_allowed === false && reconciliation.scope_intent_unchanged === true && reconciliation.campaign_identity_unchanged === true && reconciliation.policy_unchanged === true && reconciliation.sterile_copy_changed === false, "continuation parent reconciliation crossed a boundary");
  requireSha(reconciliation.reconciliation_sha256, "continuation parent reconciliation digest");
  assert(reconciliation.reconciliation_sha256 === digestWithout(reconciliation, "reconciliation_sha256"), "continuation parent reconciliation digest mismatch");
  return reconciliation;
}

function continuationPolicy({completedHandoff, parentReconciliation}) {
  const source = Number.isSafeInteger(parentReconciliation.policy_epoch)
    ? parentReconciliation
    : completedHandoff.parent_reconciliation;
  assert(Number.isSafeInteger(source?.policy_epoch) && source.policy_epoch >= 1, "continuation policy epoch is missing");
  requireSha(source.policy_state_sha256, "continuation policy state");
  return {policy_epoch: source.policy_epoch, policy_state_sha256: source.policy_state_sha256};
}

export function validateContinuationContext({completedHandoff, parentReconciliation, currentStatus}) {
  validateCompletedInactiveHandoff(completedHandoff);
  validateContinuationReconciliation(parentReconciliation, completedHandoff);
  const policy = continuationPolicy({completedHandoff, parentReconciliation});
  requireRecord(currentStatus, "continuation current status");
  if (currentStatus.controller_role !== undefined || currentStatus.controller_display_name !== undefined) {
    validateControllerRoleDisplay({controllerRole: currentStatus.controller_role, controllerDisplayName: currentStatus.controller_display_name}, {label: "continuation current status role"});
  }
  assert(currentStatus.active_campaign === false && currentStatus.controller_status === "PREPARED_NOT_ACTIVATED", "continuation current status crossed activation");
  assert(currentStatus.current_reconciliation_sha256 === parentReconciliation.reconciliation_sha256, "continuation current status points to a stale reconciliation");
  assert(currentStatus.current_commit === completedHandoff.campaign_binding.source_commit && currentStatus.current_tree === completedHandoff.campaign_binding.source_tree, "continuation current campaign source differs");
  assert(currentStatus.controller_candidate_sha256 === completedHandoff.campaign_binding.controller_candidate_sha256
    && currentStatus.owner_review_candidate_sha256 === completedHandoff.campaign_binding.owner_review_candidate_sha256
    && currentStatus.approval_packet_sha256 === completedHandoff.campaign_binding.approval_packet_sha256
    && currentStatus.identity_binding_sha256 === completedHandoff.campaign_binding.identity_binding_sha256,
  "continuation current campaign identity differs");
  if ("policy_epoch" in currentStatus || "policy_state_sha256" in currentStatus) {
    assert(currentStatus.policy_epoch === policy.policy_epoch && currentStatus.policy_state_sha256 === policy.policy_state_sha256, "continuation current policy differs");
  }
  return {completedHandoff, parentReconciliation, currentStatus};
}

export function selectContinuationTask({availableTasks, selectedTaskId}) {
  assert(Array.isArray(availableTasks) && availableTasks.length > 0, "continuation task catalog is empty");
  requireIdentifier(selectedTaskId, "selected continuation task ID");
  availableTasks.forEach(validateTaskCandidate);
  const matches = availableTasks.filter((task) => task.task_id === selectedTaskId);
  assert(matches.length === 1, matches.length === 0 ? "selected continuation task is missing" : "selected continuation task is ambiguous");
  return structuredClone(matches[0]);
}

export function compileContinuationTask({candidate, completedHandoff, parentReconciliation, currentStatus, sourceCommit, sourceTree, startedAtUtc, authorizationRoute = "DIRECT_AGENTOS_CONFIRMATION"}) {
  validateTaskCandidate(candidate);
  validateContinuationContext({completedHandoff, parentReconciliation, currentStatus});
  requireGitObject(sourceCommit, "continuation task source commit");
  requireGitObject(sourceTree, "continuation task source tree");
  requireUtc(startedAtUtc, "continuation task start time");
  assert(authorizationRoute === "DIRECT_AGENTOS_CONFIRMATION", "continuation task authorization route is invalid");
  const policy = continuationPolicy({completedHandoff, parentReconciliation});
  const task = {
    schema: CONTINUATION_TASK_SCHEMA,
    version: 1,
    status: CONTINUATION_TASK_STATUS,
    task_id: candidate.task_id,
    controller_role: AGENTOS_CONTROLLER_ROLE,
    controller_display_name: AGENTOS_CONTROLLER_DISPLAY_NAME,
    display_title: controllerDisplayTitle(candidate.task_id),
    project_id: completedHandoff.campaign_binding.project_id,
    campaign_id: completedHandoff.campaign_binding.campaign_id,
    campaign_version: completedHandoff.campaign_binding.campaign_version,
    canonical_campaign_identity: "CONTROLLER_CANDIDATE",
    parent_handoff_sha256: completedHandoff.handoff_sha256,
    parent_reconciliation_sha256: parentReconciliation.reconciliation_sha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    policy_epoch: policy.policy_epoch,
    policy_state_sha256: policy.policy_state_sha256,
    authorization_status: "OWNER_AUTHORIZED_EXACT_TASK",
    authorization_route: authorizationRoute,
    goal: candidate.goal,
    scope: candidate.scope,
    change_set: structuredClone(candidate.change_set),
    excluded_scope: structuredClone(candidate.excluded_scope),
    checks: structuredClone(candidate.checks),
    stop_conditions: structuredClone(candidate.stop_conditions),
    undo: structuredClone(candidate.undo),
    start_boundary: candidate.start_boundary,
    boundary: structuredClone(candidate.boundary),
    started_at_utc: startedAtUtc,
    task_sha256: null,
  };
  task.task_sha256 = digestWithout(task, "task_sha256");
  return validateContinuationTask(task);
}

export function compileContinuationHandoff({task, completedHandoff, parentReconciliation, currentStatus, phase = "START", recordedAtUtc, auditReports = [], auditReconciliation = null}) {
  validateContinuationTask(task);
  validateContinuationContext({completedHandoff, parentReconciliation, currentStatus});
  assert(["START", "COMPLETION"].includes(phase), "continuation handoff phase is invalid");
  requireUtc(recordedAtUtc, "continuation handoff time");
  if (phase === "COMPLETION") {
    assert(Array.isArray(auditReports) && auditReports.length === 4, "continuation completion handoff requires four audit reports");
    auditReports.forEach((report) => validateAuditReport(report, task));
    validateAuditReconciliation(auditReconciliation, task, auditReports);
  } else {
    assert(Array.isArray(auditReports) && auditReports.length === 0 && auditReconciliation === null, "continuation start handoff cannot carry incomplete audit evidence");
  }
  const handoff = {
    schema: CONTINUATION_HANDOFF_SCHEMA,
    version: 1,
    status: phase === "START" ? CONTINUATION_START_HANDOFF_STATUS : CONTINUATION_COMPLETION_HANDOFF_STATUS,
    phase,
    task_sha256: task.task_sha256,
    controller_role: task.controller_role,
    controller_display_name: task.controller_display_name,
    display_title: task.display_title,
    parent_handoff_sha256: completedHandoff.handoff_sha256,
    parent_reconciliation_sha256: parentReconciliation.reconciliation_sha256,
    task: structuredClone(task),
    campaign_binding: structuredClone(completedHandoff.campaign_binding),
    source_checkpoint: {commit: task.source_commit, tree: task.source_tree, clean: true, pushed: false, remote_commit: "UNPUBLISHED", remote_tree: "UNPUBLISHED"},
    boundary: {...structuredClone(task.boundary), controller_status: "PREPARED_NOT_ACTIVATED"},
    audit_reports: structuredClone(auditReports),
    audit_reconciliation: structuredClone(auditReconciliation),
    findings: [],
    next_action: phase === "START"
      ? "Controller will regulate only the selected control-plane task; keep the campaign inactive and do not spawn Product agents."
      : "Review the exact completed Controller handoff; keep the campaign inactive until a separate start boundary is authorized.",
    stop_conditions: structuredClone(task.stop_conditions),
    undo: structuredClone(task.undo),
    recorded_at_utc: recordedAtUtc,
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = digestWithout(handoff, "handoff_sha256");
  return validateContinuationHandoff(handoff);
}

export function validateContinuationHandoff(handoff) {
  const hasRoleDisplay = exactKeysWithLegacy(handoff, HANDOFF_KEYS, LEGACY_HANDOFF_KEYS, "continuation handoff");
  assert(handoff.schema === CONTINUATION_HANDOFF_SCHEMA && handoff.version === 1, "continuation handoff identity is invalid");
  assert([CONTINUATION_START_HANDOFF_STATUS, CONTINUATION_COMPLETION_HANDOFF_STATUS].includes(handoff.status), "continuation handoff status is invalid");
  assert(handoff.phase === "START" ? handoff.status === CONTINUATION_START_HANDOFF_STATUS : handoff.status === CONTINUATION_COMPLETION_HANDOFF_STATUS, "continuation handoff phase/status differs");
  validateContinuationTask(handoff.task);
  assert(handoff.task_sha256 === handoff.task.task_sha256, "continuation handoff task differs");
  if (hasRoleDisplay) {
    validateControllerRoleDisplay({controllerRole: handoff.controller_role, controllerDisplayName: handoff.controller_display_name, displayTitle: handoff.display_title}, {taskId: handoff.task.task_id, label: "continuation handoff display"});
    assert(handoff.controller_role === handoff.task.controller_role
      && handoff.controller_display_name === handoff.task.controller_display_name
      && handoff.display_title === handoff.task.display_title,
    "continuation handoff display differs from task");
  }
  assert(handoff.parent_handoff_sha256 === handoff.task.parent_handoff_sha256 && handoff.parent_reconciliation_sha256 === handoff.task.parent_reconciliation_sha256, "continuation handoff parent differs");
  requireRecord(handoff.campaign_binding, "continuation handoff campaign binding");
  assert(handoff.campaign_binding.canonical_campaign_identity === "CONTROLLER_CANDIDATE"
    && handoff.campaign_binding.project_id === handoff.task.project_id
    && handoff.campaign_binding.campaign_id === handoff.task.campaign_id
    && handoff.campaign_binding.campaign_version === handoff.task.campaign_version,
  "continuation handoff campaign identity differs");
  requireGitObject(handoff.source_checkpoint.commit, "continuation handoff checkpoint commit");
  requireGitObject(handoff.source_checkpoint.tree, "continuation handoff checkpoint tree");
  assert(handoff.source_checkpoint.commit === handoff.task.source_commit && handoff.source_checkpoint.tree === handoff.task.source_tree && handoff.source_checkpoint.clean === true && handoff.source_checkpoint.pushed === false, "continuation handoff checkpoint differs");
  validateBoundary(handoff.boundary, "continuation handoff boundary", {controllerStatus: true});
  assert(Array.isArray(handoff.findings) && handoff.findings.length === 0, "continuation handoff contains findings");
  if (handoff.phase === "START") {
    assert(handoff.audit_reports.length === 0 && handoff.audit_reconciliation === null, "continuation start handoff contains incomplete audit evidence");
  } else {
    assert(Array.isArray(handoff.audit_reports) && handoff.audit_reports.length === 4, "continuation completion handoff lacks four audit reports");
    handoff.audit_reports.forEach((report) => validateAuditReport(report, handoff.task));
    validateAuditReconciliation(handoff.audit_reconciliation, handoff.task, handoff.audit_reports);
  }
  requireUtc(handoff.recorded_at_utc, "continuation handoff time");
  requireSha(handoff.handoff_sha256, "continuation handoff digest");
  assert(handoff.handoff_sha256 === digestWithout(handoff, "handoff_sha256"), "continuation handoff digest mismatch");
  return handoff;
}

function safeRecordPath(authorityRoot, recordPath) {
  requireString(authorityRoot, "continuation authority root");
  requireString(recordPath, "continuation record path");
  assert(path.isAbsolute(authorityRoot), "continuation authority root must be absolute");
  assert(!path.isAbsolute(recordPath), "continuation record path must be relative");
  const resolvedRoot = fs.realpathSync.native(authorityRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "continuation authority root must be a real directory");
  const target = path.resolve(resolvedRoot, recordPath);
  assert(target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`), "continuation record path escapes authority root");
  let cursor = target;
  while (cursor !== resolvedRoot) {
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "continuation record path may not contain symlinks");
    cursor = path.dirname(cursor);
  }
  return {resolvedRoot, target};
}

function validateContinuationRecord(record) {
  requireRecord(record, "continuation record");
  if (record.schema === CONTINUATION_TASK_SCHEMA) return validateContinuationTask(record);
  if (record.schema === CONTINUATION_HANDOFF_SCHEMA) return validateContinuationHandoff(record);
  throw new Error("continuation record schema is unsupported");
}

function recordDigest(record) {
  const field = RECORD_SCHEMA_TO_DIGEST.get(record.schema);
  assert(field, "continuation record digest field is unsupported");
  return record[field];
}

export function readContinuationRecord({authorityRoot, recordPath}) {
  const {target} = safeRecordPath(authorityRoot, recordPath);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), "continuation record must be a regular file");
  let record;
  try {
    record = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`continuation record JSON is invalid: ${error.message}`);
  }
  return validateContinuationRecord(record);
}

export function writeContinuationRecordCompareAndSwap({authorityRoot, recordPath, expectedRecordSha256 = null, record}) {
  validateContinuationRecord(record);
  requireSha(expectedRecordSha256, "expected continuation record", {nullable: true});
  const {target} = safeRecordPath(authorityRoot, recordPath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let lockHeld = false;
  let temporary;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    lockHeld = true;
    const current = readContinuationRecord({authorityRoot, recordPath});
    if (expectedRecordSha256 === null) assert(current === null, "continuation record already exists");
    else assert(current !== null && recordDigest(current) === expectedRecordSha256, "continuation record compare-and-swap parent is stale");
    temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.stage`);
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
    temporary = null;
  } finally {
    if (temporary !== undefined && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    if (lockHeld) {
      try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const readback = readContinuationRecord({authorityRoot, recordPath});
  assert(recordDigest(readback) === recordDigest(record), "continuation record readback digest differs");
  return {path: recordPath, record_sha256: recordDigest(readback)};
}
