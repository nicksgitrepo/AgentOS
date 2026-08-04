#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AUDIT_DISCIPLINES,
} from "../control/campaign-cascade.mjs";
import {
  compileContinuationHandoff,
  compileContinuationTask,
  continuationDigest,
  readContinuationRecord,
  selectContinuationTask,
  validateContinuationContext,
  validateContinuationHandoff,
  validateContinuationTask,
  writeContinuationRecordCompareAndSwap,
} from "../control/task-continuation.mjs";

const SHA = "a".repeat(64);
const COMMIT = "c".repeat(40);
const TREE = "d".repeat(40);
const TASK_COMMIT = "e".repeat(40);
const TASK_TREE = "f".repeat(40);
const NOW = "2026-08-04T00:00:00.000Z";
const LATER = "2026-08-04T01:00:00.000Z";
let hostiles = 0;

function reject(label, operation) {
  try {
    operation();
    throw new Error(`hostile accepted: ${label}`);
  } catch (error) {
    if (error.message === `hostile accepted: ${label}`) throw error;
    hostiles += 1;
  }
}

function boundary() {
  return {
    secrets_allowed: false,
    destructive_work_allowed: false,
    campaign_activation_allowed: false,
    active_campaign: false,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    deployment_allowed: false,
    publication_allowed: false,
    push_allowed: false,
    merge_allowed: false,
    sterile_copy_allowed: false,
    policy_changes_allowed: false,
    owner_intent_changes_allowed: false,
    campaign_identity_changes_allowed: false,
    release_candidate_activation_allowed: false,
  };
}

function priorBoundary() {
  return {
    active_campaign: false,
    campaign_identity_changed: false,
    controller_status: "PREPARED_NOT_ACTIVATED",
    deployment_allowed: false,
    merge_allowed: false,
    owner_intent_changed: false,
    policy_changed: false,
    product_agent_spawns_allowed: false,
    product_writes_allowed: false,
    publication_allowed: false,
    push_allowed: false,
    release_candidate_activation: false,
    sterile_copy_changed: false,
  };
}

function reportCheck(name) {
  const check = {
    command: `node tests/${name}.mjs`,
    exit_code: 0,
    stdout: "PASS synthetic continuation check",
    stderr: "",
    passed: true,
    check_sha256: null,
  };
  check.check_sha256 = continuationDigest({...check, check_sha256: null});
  return check;
}

function auditEvidence(task) {
  const reports = AUDIT_DISCIPLINES.map((discipline) => {
    const report = {
      schema: "agentos.development_task_audit_report.v1",
      version: 1,
      report_id: `${discipline}-CONTINUATION-1`,
      discipline,
      task_sha256: task.task_sha256,
      parent_reconciliation_sha256: task.parent_reconciliation_sha256,
      campaign_id: task.campaign_id,
      campaign_version: task.campaign_version,
      source_commit: task.source_commit,
      source_tree: task.source_tree,
      independent: true,
      auditor_role: "DETERMINISTIC_VERIFIER",
      checked_at_utc: LATER,
      scope: `Synthetic ${discipline} continuation coverage.`,
      checks: [reportCheck(discipline.toLowerCase())],
      findings: [],
      settled: true,
      report_sha256: null,
    };
    report.report_sha256 = continuationDigest({...report, report_sha256: null});
    return report;
  });
  const reconciliation = {
    schema: "agentos.development_task_audit_reconciliation.v1",
    version: 1,
    status: "SETTLED_CLEAN",
    task_sha256: task.task_sha256,
    parent_reconciliation_sha256: task.parent_reconciliation_sha256,
    campaign_id: task.campaign_id,
    campaign_version: task.campaign_version,
    source_commit: task.source_commit,
    source_tree: task.source_tree,
    complete_reports: 4,
    settled_disciplines: [...AUDIT_DISCIPLINES],
    report_sha256: reports.map((report) => report.report_sha256),
    findings: [],
    immediate_first_pass_repairs: [],
    finalization_queue: [],
    owner_only_findings: [],
    reconciliation_sha256: null,
  };
  reconciliation.reconciliation_sha256 = continuationDigest({...reconciliation, reconciliation_sha256: null});
  return {reports, reconciliation};
}

const campaignBinding = {
  canonical_campaign_identity: "CONTROLLER_CANDIDATE",
  project_id: "synthetic-project",
  campaign_id: "CAMPAIGN-OWNER-REVIEW-1",
  campaign_version: "v1",
  source_commit: COMMIT,
  source_tree: TREE,
  controller_candidate_sha256: SHA,
  owner_review_candidate_sha256: SHA,
  approval_packet_sha256: SHA,
  identity_binding_sha256: SHA,
  audit_checkpoint_sha256: SHA,
  audit_plan_sha256: SHA,
  audit_reconciliation_sha256: SHA,
  control_plane_receipt_path: "control-plane-receipt.json",
  control_plane_receipt_sha256: SHA,
  retained_status: {active_campaign: false, controller_status: "PREPARED_NOT_ACTIVATED"},
};

const parentTaskSha = SHA;
const parentReconciliationSha = "b".repeat(64);
const completedHandoff = {
  schema: "agentos.development_task_handoff.v1",
  version: 1,
  status: "COMPLETED_INACTIVE",
  task_sha256: parentTaskSha,
  parent_reconciliation_sha256: parentReconciliationSha,
  authorization: {status: "EXACT_TASK_AUTHORIZED"},
  task_definition: {status: "COMPLETED_INACTIVE"},
  parent_reconciliation: {reconciliation_sha256: parentReconciliationSha, status: "RECONCILED_INACTIVE", active_campaign: false, policy_epoch: 1, policy_state_sha256: SHA},
  campaign_binding: campaignBinding,
  task_checkpoint: {source_commit: COMMIT, source_tree: TREE, branch: "continuation-test", clean: true, pushed: false, remote_commit: "UNPUBLISHED", remote_tree: "UNPUBLISHED", changed_paths: ["control/previous.mjs"]},
  focused_checks: [],
  four_audits: [],
  audit_reconciliation: null,
  boundary: priorBoundary(),
  findings: [],
  stop_conditions: ["stop on mismatch"],
  ready: true,
  next_action: "Continue only through the inactive control plane.",
  undo: ["Remove the continuation record."],
  recorded_at_utc: NOW,
  handoff_sha256: null,
};

const parentTaskStub = {
  task_sha256: parentTaskSha,
  parent_reconciliation_sha256: parentReconciliationSha,
  campaign_id: campaignBinding.campaign_id,
  campaign_version: campaignBinding.campaign_version,
  source_commit: COMMIT,
  source_tree: TREE,
};
const priorReports = AUDIT_DISCIPLINES.map((discipline) => {
  const report = {
    schema: "agentos.development_task_audit_report.v1",
    version: 1,
    report_id: `${discipline}-PRIOR-1`,
    discipline,
    task_sha256: parentTaskStub.task_sha256,
    parent_reconciliation_sha256: parentTaskStub.parent_reconciliation_sha256,
    campaign_id: parentTaskStub.campaign_id,
    campaign_version: parentTaskStub.campaign_version,
    source_commit: parentTaskStub.source_commit,
    source_tree: parentTaskStub.source_tree,
    independent: true,
    auditor_role: "DETERMINISTIC_VERIFIER",
    checked_at_utc: NOW,
    scope: "Prior complete report body.",
    checks: [reportCheck("prior")],
    findings: [],
    settled: true,
    report_sha256: null,
  };
  report.report_sha256 = continuationDigest({...report, report_sha256: null});
  return report;
});
const priorAuditReconciliation = {
  schema: "agentos.development_task_audit_reconciliation.v1",
  version: 1,
  status: "SETTLED_CLEAN",
  task_sha256: parentTaskSha,
  parent_reconciliation_sha256: parentReconciliationSha,
  campaign_id: campaignBinding.campaign_id,
  campaign_version: campaignBinding.campaign_version,
  source_commit: COMMIT,
  source_tree: TREE,
  complete_reports: 4,
  settled_disciplines: [...AUDIT_DISCIPLINES],
  report_sha256: priorReports.map((report) => report.report_sha256),
  findings: [],
  immediate_first_pass_repairs: [],
  finalization_queue: [],
  owner_only_findings: [],
  reconciliation_sha256: null,
};
priorAuditReconciliation.reconciliation_sha256 = continuationDigest({...priorAuditReconciliation, reconciliation_sha256: null});
completedHandoff.four_audits = priorReports;
completedHandoff.audit_reconciliation = priorAuditReconciliation;
completedHandoff.handoff_sha256 = continuationDigest({...completedHandoff, handoff_sha256: null});

const parentReconciliation = {
  schema: "agentos.controller_orchestrator_task_reconciliation.v1",
  version: 1,
  status: "RECONCILED_INACTIVE",
  canonical_campaign_identity: "CONTROLLER_CANDIDATE",
  project_id: campaignBinding.project_id,
  campaign_id: campaignBinding.campaign_id,
  campaign_version: campaignBinding.campaign_version,
  source_commit: COMMIT,
  source_tree: TREE,
  parent_reconciliation_sha256: parentReconciliationSha,
  task_sha256: parentTaskSha,
  task_handoff_sha256: completedHandoff.handoff_sha256,
  task_status: "COMPLETED_INACTIVE",
  task_checkpoint_commit: COMMIT,
  task_checkpoint_tree: TREE,
  control_plane_receipt_sha256: SHA,
  prior_status_sha256: SHA,
  status_update: {next_development_task_status: "COMPLETED_INACTIVE"},
  active_campaign: false,
  product_writes_allowed: false,
  product_agent_spawns_allowed: false,
  deployment_allowed: false,
  scope_intent_unchanged: true,
  campaign_identity_unchanged: true,
  policy_unchanged: true,
  sterile_copy_changed: false,
  reconciled_at_utc: LATER,
  next_action: "Start only one control-plane task.",
  reconciliation_sha256: null,
};
parentReconciliation.reconciliation_sha256 = continuationDigest({...parentReconciliation, reconciliation_sha256: null});

const currentStatus = {
  active_campaign: false,
  controller_status: "PREPARED_NOT_ACTIVATED",
  controller_role: "AGENTOS_CONTROLLER",
  controller_display_name: "AgentOS Controller",
  current_reconciliation_sha256: parentReconciliation.reconciliation_sha256,
  current_commit: COMMIT,
  current_tree: TREE,
  policy_epoch: 1,
  policy_state_sha256: SHA,
  controller_candidate_sha256: SHA,
  owner_review_candidate_sha256: SHA,
  approval_packet_sha256: SHA,
  identity_binding_sha256: SHA,
};

const taskCandidate = {
  task_id: "TASK-CONTINUATION-1",
  controller_role: "AGENTOS_CONTROLLER",
  controller_display_name: "AgentOS Controller",
  display_title: "AgentOS Controller — TASK-CONTINUATION-1",
  version: 1,
  goal: "Exercise one safe control-plane continuation task.",
  scope: "CONTROL_PLANE_ONLY",
  change_set: ["Read and record one bounded continuation task."],
  excluded_scope: ["Product work", "campaign activation", "agent spawning"],
  checks: ["focused check", "four complete audits", "readback"],
  stop_conditions: ["Any identity or boundary mismatch."],
  undo: ["Remove the task and handoff records."],
  start_boundary: "OWNER_AUTHORIZED_EXACT_TASK",
  boundary: boundary(),
};

const context = {completedHandoff, parentReconciliation, currentStatus};
validateContinuationContext(context);
const selected = selectContinuationTask({availableTasks: [taskCandidate], selectedTaskId: taskCandidate.task_id});
const task = compileContinuationTask({
  candidate: selected,
  ...context,
  sourceCommit: TASK_COMMIT,
  sourceTree: TASK_TREE,
  startedAtUtc: LATER,
});
validateContinuationTask(task);
const startHandoff = compileContinuationHandoff({task, ...context, phase: "START", recordedAtUtc: LATER});
validateContinuationHandoff(startHandoff);
const {reports, reconciliation} = auditEvidence(task);
const completionHandoff = compileContinuationHandoff({task, ...context, phase: "COMPLETION", recordedAtUtc: "2026-08-04T02:00:00.000Z", auditReports: reports, auditReconciliation: reconciliation});
validateContinuationHandoff(completionHandoff);

const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-continuation-"));
try {
  const persistedTask = writeContinuationRecordCompareAndSwap({authorityRoot, recordPath: "continuation/task.json", expectedRecordSha256: null, record: task});
  const persistedHandoff = writeContinuationRecordCompareAndSwap({authorityRoot, recordPath: "continuation/start.json", expectedRecordSha256: null, record: startHandoff});
  assert.equal(persistedTask.record_sha256, task.task_sha256);
  assert.equal(persistedHandoff.record_sha256, startHandoff.handoff_sha256);
  assert.equal(readContinuationRecord({authorityRoot, recordPath: "continuation/task.json"}).task_sha256, task.task_sha256);
  assert.equal(readContinuationRecord({authorityRoot, recordPath: "continuation/start.json"}).handoff_sha256, startHandoff.handoff_sha256);
  reject("stale compare-and-swap parent", () => writeContinuationRecordCompareAndSwap({authorityRoot, recordPath: "continuation/start.json", expectedRecordSha256: "f".repeat(64), record: startHandoff}));
  reject("duplicate task selection", () => selectContinuationTask({availableTasks: [taskCandidate, taskCandidate], selectedTaskId: taskCandidate.task_id}));
  reject("missing task selection", () => selectContinuationTask({availableTasks: [taskCandidate], selectedTaskId: "TASK-MISSING"}));
  const productTask = structuredClone(taskCandidate);
  productTask.boundary.product_writes_allowed = true;
  reject("Product write boundary", () => selectContinuationTask({availableTasks: [productTask], selectedTaskId: productTask.task_id}));
  const staleContext = {...context, currentStatus: {...currentStatus, current_reconciliation_sha256: "f".repeat(64)}};
  reject("stale parent reconciliation", () => compileContinuationTask({candidate: taskCandidate, ...staleContext, sourceCommit: TASK_COMMIT, sourceTree: TASK_TREE, startedAtUtc: LATER}));
  reject("invalid task source", () => compileContinuationTask({candidate: taskCandidate, ...context, sourceCommit: "short", sourceTree: TASK_TREE, startedAtUtc: LATER}));
  reject("start handoff carries incomplete audits", () => compileContinuationHandoff({task, ...context, phase: "START", recordedAtUtc: LATER, auditReports: reports, auditReconciliation: reconciliation}));
  reject("completion handoff missing report body", () => compileContinuationHandoff({task, ...context, phase: "COMPLETION", recordedAtUtc: LATER, auditReports: reports.slice(0, 3), auditReconciliation: null}));
  fs.writeFileSync(path.join(authorityRoot, "continuation/start.json"), "{malformed", {mode: 0o600});
  reject("malformed continuation JSON", () => readContinuationRecord({authorityRoot, recordPath: "continuation/start.json"}));
  const symlinkPath = path.join(authorityRoot, "continuation/symlink.json");
  fs.symlinkSync(path.join(authorityRoot, "continuation/task.json"), symlinkPath);
  reject("symlink continuation record", () => readContinuationRecord({authorityRoot, recordPath: "continuation/symlink.json"}));
} finally {
  fs.rmSync(authorityRoot, {recursive: true, force: true});
}

assert(hostiles >= 9);
console.log(`PASS AgentOS safe continuation (${hostiles} hostile cases, exact selection, parent binding, inactive boundary, complete audits, CAS, JSON, and symlink checks)`);
