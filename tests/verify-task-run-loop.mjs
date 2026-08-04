#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {AUDIT_DISCIPLINES} from "../control/campaign-cascade.mjs";
import {
  continuationDigest,
  validateContinuationHandoff,
  validateContinuationTask,
} from "../control/task-continuation.mjs";
import {
  QUEUED_TASK_SCHEMA,
  TASK_EXECUTION_READBACK_SCHEMA,
  TASK_RUN_RECONCILIATION_SCHEMA,
  prepareQueuedContinuationTask,
  readTaskRunLoopRecord,
  runSafeControlPlaneTaskLoop,
  validateQueuedTask,
  validateTaskExecutionReadback,
  validateTaskRunReconciliation,
  writeTaskRunLoopRecordCompareAndSwap,
} from "../control/task-run-loop.mjs";

const SHA = "a".repeat(64);
const PARENT_HANDOFF = "b".repeat(64);
const PARENT_RECONCILIATION = "c".repeat(64);
const COMMIT = "d".repeat(40);
const TREE = "e".repeat(40);
const NOW = "2026-08-04T03:00:00.000Z";
let hostileCases = 0;

const reject = (label, fn) => {
  assert.throws(fn, label);
  hostileCases += 1;
};

const boundary = () => ({
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
});

const candidate = (taskId) => ({
  task_id: taskId,
  controller_role: "AGENTOS_CONTROLLER",
  controller_display_name: "AgentOS Controller",
  display_title: `AgentOS Controller — ${taskId}`,
  version: 1,
  goal: "Run one further bounded control-plane readback iteration.",
  scope: "CONTROL_PLANE_ONLY",
  change_set: ["Record one inactive control-plane iteration."],
  excluded_scope: ["Product work", "campaign activation", "agent spawning", "delivery"],
  checks: ["focused check", "four complete audits", "hostile boundary checks", "JSON readback"],
  stop_conditions: ["Any identity, scope, intent, evidence, or boundary mismatch."],
  undo: ["Remove the loop records and revert the isolated development change."],
  start_boundary: "OWNER_AUTHORIZED_EXACT_TASK",
  boundary: boundary(),
});

const task = {
  schema: "agentos.control_plane_continuation_task.v1",
  version: 1,
  status: "IN_PROGRESS_INACTIVE",
  task_id: "TASK-CONTROLLER-RUN-LOOP-TEST",
  controller_role: "AGENTOS_CONTROLLER",
  controller_display_name: "AgentOS Controller",
  display_title: "AgentOS Controller — TASK-CONTROLLER-RUN-LOOP-TEST",
  project_id: "PROJECT-PORTABLE",
  campaign_id: "CAMPAIGN-CONTROL-PLANE-TEST",
  campaign_version: "v1",
  canonical_campaign_identity: "CONTROLLER_CANDIDATE",
  parent_handoff_sha256: PARENT_HANDOFF,
  parent_reconciliation_sha256: PARENT_RECONCILIATION,
  source_commit: COMMIT,
  source_tree: TREE,
  policy_epoch: 1,
  policy_state_sha256: SHA,
  authorization_status: "OWNER_AUTHORIZED_EXACT_TASK",
  authorization_route: "DIRECT_AGENTOS_CONFIRMATION",
  goal: "Run one bounded control-plane iteration.",
  scope: "CONTROL_PLANE_ONLY",
  change_set: ["Record one inactive control-plane iteration."],
  excluded_scope: ["Product work", "campaign activation", "agent spawning", "delivery"],
  checks: ["focused check", "four complete audits", "hostile boundary checks", "JSON readback"],
  stop_conditions: ["Any identity, scope, intent, evidence, or boundary mismatch."],
  undo: ["Remove the loop records and revert the isolated development change."],
  start_boundary: "OWNER_AUTHORIZED_EXACT_TASK",
  boundary: boundary(),
  started_at_utc: NOW,
  task_sha256: null,
};
task.task_sha256 = continuationDigest({...task, task_sha256: null});

const startHandoff = {
  schema: "agentos.control_plane_continuation_handoff.v1",
  version: 1,
  status: "STARTED_INACTIVE",
  phase: "START",
  task_sha256: task.task_sha256,
  controller_role: task.controller_role,
  controller_display_name: task.controller_display_name,
  display_title: task.display_title,
  parent_handoff_sha256: task.parent_handoff_sha256,
  parent_reconciliation_sha256: task.parent_reconciliation_sha256,
  task: structuredClone(task),
  campaign_binding: {
    project_id: task.project_id,
    campaign_id: task.campaign_id,
    campaign_version: task.campaign_version,
    canonical_campaign_identity: "CONTROLLER_CANDIDATE",
  },
  source_checkpoint: {commit: COMMIT, tree: TREE, clean: true, pushed: false, remote_commit: "UNPUBLISHED", remote_tree: "UNPUBLISHED"},
  boundary: {...boundary(), controller_status: "PREPARED_NOT_ACTIVATED"},
  audit_reports: [],
  audit_reconciliation: null,
  findings: [],
  next_action: "Run only the selected control-plane task; keep the campaign inactive.",
  stop_conditions: [...task.stop_conditions],
  undo: [...task.undo],
  recorded_at_utc: NOW,
  handoff_sha256: null,
};
startHandoff.handoff_sha256 = continuationDigest({...startHandoff, handoff_sha256: null});

validateContinuationTask(task);
validateContinuationHandoff(startHandoff);

const currentStatus = {
  active_campaign: false,
  controller_status: "PREPARED_NOT_ACTIVATED",
  controller_role: "AGENTOS_CONTROLLER",
  controller_display_name: "AgentOS Controller",
  current_reconciliation_sha256: PARENT_RECONCILIATION,
  continuation_completion_handoff_sha256: PARENT_HANDOFF,
};

const nextCandidate = candidate("TASK-CONTROLLER-RUN-LOOP-NEXT-TEST");

const execute = ({task: suppliedTask, iteration}) => {
  assert.equal(suppliedTask.task_sha256, task.task_sha256);
  assert.equal(iteration, 1);
  const readback = {
    schema: TASK_EXECUTION_READBACK_SCHEMA,
    version: 1,
    task_sha256: suppliedTask.task_sha256,
    status: "COMPLETED_INACTIVE",
    action: "CONTROL_PLANE_RECORD_ONLY",
    source_commit: suppliedTask.source_commit,
    source_tree: suppliedTask.source_tree,
    changed_paths: ["README.md", "control/task-run-loop.mjs", "schemas/task-run-loop.v1.json", "tests/verify-task-run-loop.mjs"],
    active_campaign: false,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    deployment_allowed: false,
    publication_allowed: false,
    push_allowed: false,
    merge_allowed: false,
    sterile_copy_changed: false,
    secrets_accessed: false,
    destructive_work_performed: false,
    findings: [],
    readback_sha256: null,
  };
  readback.readback_sha256 = continuationDigest({...readback, readback_sha256: null});
  return readback;
};

const result = runSafeControlPlaneTaskLoop({
  readyTask: task,
  readyHandoff: startHandoff,
  currentStatus,
  nextTaskCandidates: [nextCandidate],
  selectedNextTaskId: nextCandidate.task_id,
  execute,
  iteration: 1,
  runAtUtc: NOW,
});

validateTaskExecutionReadback(result.execution, task);
validateTaskRunReconciliation(result.reconciliation);
validateQueuedTask(result.queued);
assert.equal(result.reconciliation.execution_sha256, result.execution.readback_sha256);
assert.equal(result.reconciliation.next_task_candidate_sha256, result.queued.task_candidate_sha256);
assert.equal(result.queued.parent_task_sha256, task.task_sha256);
assert.equal(result.queued.parent_run_reconciliation_sha256, result.reconciliation.reconciliation_sha256);

const promotionBinding = {
  ...startHandoff.campaign_binding,
  source_commit: COMMIT,
  source_tree: TREE,
  controller_candidate_sha256: SHA,
  owner_review_candidate_sha256: SHA,
  approval_packet_sha256: SHA,
  identity_binding_sha256: SHA,
};
const promotionReports = AUDIT_DISCIPLINES.map((discipline) => {
  const check = {
    command: `node tests/verify-${discipline.toLowerCase()}.mjs`,
    exit_code: 0,
    stdout: "PASS synthetic promotion audit",
    stderr: "",
    passed: true,
    check_sha256: null,
  };
  check.check_sha256 = continuationDigest({...check, check_sha256: null});
  const report = {
    schema: "agentos.development_task_audit_report.v1",
    version: 1,
    report_id: `${discipline}-PROMOTION-TEST`,
    discipline,
    task_sha256: task.task_sha256,
    parent_reconciliation_sha256: task.parent_reconciliation_sha256,
    campaign_id: task.campaign_id,
    campaign_version: task.campaign_version,
    source_commit: task.source_commit,
    source_tree: task.source_tree,
    independent: true,
    auditor_role: "DETERMINISTIC_VERIFIER",
    checked_at_utc: NOW,
    scope: "Synthetic queued-candidate promotion coverage.",
    checks: [check],
    findings: [],
    settled: true,
    report_sha256: null,
  };
  report.report_sha256 = continuationDigest({...report, report_sha256: null});
  return report;
});
const promotionAuditReconciliation = {
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
  report_sha256: promotionReports.map((report) => report.report_sha256),
  findings: [],
  immediate_first_pass_repairs: [],
  finalization_queue: [],
  owner_only_findings: [],
  reconciliation_sha256: null,
};
promotionAuditReconciliation.reconciliation_sha256 = continuationDigest({...promotionAuditReconciliation, reconciliation_sha256: null});
const completedPromotionParent = {
  ...structuredClone(startHandoff),
  status: "COMPLETED_INACTIVE",
  phase: "COMPLETION",
  campaign_binding: promotionBinding,
  audit_reports: promotionReports,
  audit_reconciliation: promotionAuditReconciliation,
  next_action: "Review the exact completed continuation handoff; keep the campaign inactive.",
  handoff_sha256: null,
};
completedPromotionParent.handoff_sha256 = continuationDigest({...completedPromotionParent, handoff_sha256: null});
validateContinuationHandoff(completedPromotionParent);
const promotionStatus = {
  ...currentStatus,
  current_reconciliation_sha256: result.reconciliation.reconciliation_sha256,
  continuation_completion_handoff_sha256: completedPromotionParent.handoff_sha256,
  current_commit: COMMIT,
  current_tree: TREE,
  policy_epoch: task.policy_epoch,
  policy_state_sha256: task.policy_state_sha256,
  controller_candidate_sha256: SHA,
  owner_review_candidate_sha256: SHA,
  approval_packet_sha256: SHA,
  identity_binding_sha256: SHA,
};
const prepared = prepareQueuedContinuationTask({
  queuedTask: result.queued,
  parentHandoff: completedPromotionParent,
  currentStatus: promotionStatus,
  sourceCommit: COMMIT,
  sourceTree: TREE,
  startedAtUtc: NOW,
});
validateContinuationTask(prepared.task);
validateContinuationHandoff(prepared.startHandoff);
assert.equal(prepared.task.task_id, result.queued.task_id);
assert.equal(prepared.task.parent_handoff_sha256, completedPromotionParent.handoff_sha256);
assert.equal(prepared.task.parent_reconciliation_sha256, result.reconciliation.reconciliation_sha256);
assert.equal(prepared.startHandoff.phase, "START");
assert.equal(prepared.startHandoff.next_action.includes("AgentOS Controller"), true);

const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-task-run-loop-"));
try {
  const executionWrite = writeTaskRunLoopRecordCompareAndSwap({authorityRoot, recordPath: "loop/execution.json", record: result.execution});
  const reconciliationWrite = writeTaskRunLoopRecordCompareAndSwap({authorityRoot, recordPath: "loop/reconciliation.json", record: result.reconciliation});
  const queuedWrite = writeTaskRunLoopRecordCompareAndSwap({authorityRoot, recordPath: "loop/next.json", record: result.queued});
  assert.equal(executionWrite.record_sha256, result.execution.readback_sha256);
  assert.equal(reconciliationWrite.record_sha256, result.reconciliation.reconciliation_sha256);
  assert.equal(queuedWrite.record_sha256, result.queued.queued_task_sha256);
  assert.equal(readTaskRunLoopRecord({authorityRoot, recordPath: "loop/execution.json"}).readback_sha256, result.execution.readback_sha256);
  assert.equal(readTaskRunLoopRecord({authorityRoot, recordPath: "loop/reconciliation.json"}).reconciliation_sha256, result.reconciliation.reconciliation_sha256);
  assert.equal(readTaskRunLoopRecord({authorityRoot, recordPath: "loop/next.json"}).queued_task_sha256, result.queued.queued_task_sha256);

  reject("stale loop compare-and-swap parent", () => writeTaskRunLoopRecordCompareAndSwap({authorityRoot, recordPath: "loop/execution.json", expectedRecordSha256: "f".repeat(64), record: result.execution}));
  const malformedExecutionPath = path.join(authorityRoot, "loop/malformed.json");
  fs.writeFileSync(malformedExecutionPath, "{malformed", {mode: 0o600});
  reject("malformed loop JSON", () => readTaskRunLoopRecord({authorityRoot, recordPath: "loop/malformed.json"}));
  const malformedRecordPath = path.join(authorityRoot, "loop/malformed-record.json");
  fs.writeFileSync(malformedRecordPath, JSON.stringify({schema: TASK_EXECUTION_READBACK_SCHEMA}), {mode: 0o600});
  reject("incomplete execution readback", () => readTaskRunLoopRecord({authorityRoot, recordPath: "loop/malformed-record.json"}));
  const symlinkPath = path.join(authorityRoot, "loop/symlink.json");
  fs.symlinkSync(path.join(authorityRoot, "loop/execution.json"), symlinkPath);
  reject("symlink loop record", () => readTaskRunLoopRecord({authorityRoot, recordPath: "loop/symlink.json"}));
} finally {
  fs.rmSync(authorityRoot, {recursive: true, force: true});
}

const activeStatus = {...currentStatus, active_campaign: true};
reject("active campaign status", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: startHandoff, currentStatus: activeStatus, nextTaskCandidates: [nextCandidate], selectedNextTaskId: nextCandidate.task_id, execute, runAtUtc: NOW}));
const staleStatus = {...currentStatus, current_reconciliation_sha256: "f".repeat(64)};
reject("stale parent reconciliation", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: startHandoff, currentStatus: staleStatus, nextTaskCandidates: [nextCandidate], selectedNextTaskId: nextCandidate.task_id, execute, runAtUtc: NOW}));
const wrongPhase = {...startHandoff, phase: "COMPLETION", status: "COMPLETED_INACTIVE", handoff_sha256: null};
wrongPhase.handoff_sha256 = continuationDigest({...wrongPhase, handoff_sha256: null});
reject("non-start ready handoff", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: wrongPhase, currentStatus, nextTaskCandidates: [nextCandidate], selectedNextTaskId: nextCandidate.task_id, execute, runAtUtc: NOW}));
const unsafeReadback = () => ({...result.execution, active_campaign: true});
reject("unsafe execution readback", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: startHandoff, currentStatus, nextTaskCandidates: [nextCandidate], selectedNextTaskId: nextCandidate.task_id, execute: unsafeReadback, runAtUtc: NOW}));
const unsafePath = () => ({...result.execution, changed_paths: ["product/source.mjs"]});
reject("Product path readback", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: startHandoff, currentStatus, nextTaskCandidates: [nextCandidate], selectedNextTaskId: nextCandidate.task_id, execute: unsafePath, runAtUtc: NOW}));
reject("duplicate next candidate", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: startHandoff, currentStatus, nextTaskCandidates: [nextCandidate, nextCandidate], selectedNextTaskId: nextCandidate.task_id, execute, runAtUtc: NOW}));
reject("missing next candidate selection", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: startHandoff, currentStatus, nextTaskCandidates: [nextCandidate], selectedNextTaskId: "TASK-MISSING", execute, runAtUtc: NOW}));
const currentTaskCandidate = candidate(task.task_id);
reject("current task requeue", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: startHandoff, currentStatus, nextTaskCandidates: [currentTaskCandidate], selectedNextTaskId: task.task_id, execute, runAtUtc: NOW}));
const unsafeCandidate = candidate("TASK-UNSAFE-NEXT");
unsafeCandidate.boundary.campaign_activation_allowed = true;
reject("unsafe next candidate", () => runSafeControlPlaneTaskLoop({readyTask: task, readyHandoff: startHandoff, currentStatus, nextTaskCandidates: [unsafeCandidate], selectedNextTaskId: unsafeCandidate.task_id, execute, runAtUtc: NOW}));

reject("queued stale current reconciliation", () => prepareQueuedContinuationTask({
  queuedTask: result.queued,
  parentHandoff: completedPromotionParent,
  currentStatus: {...promotionStatus, current_reconciliation_sha256: "f".repeat(64)},
  sourceCommit: COMMIT,
  sourceTree: TREE,
  startedAtUtc: NOW,
}));
reject("queued stale parent handoff", () => prepareQueuedContinuationTask({
  queuedTask: result.queued,
  parentHandoff: completedPromotionParent,
  currentStatus: {...promotionStatus, continuation_completion_handoff_sha256: "f".repeat(64)},
  sourceCommit: COMMIT,
  sourceTree: TREE,
  startedAtUtc: NOW,
}));
const unsafeQueued = structuredClone(result.queued);
unsafeQueued.task_candidate.boundary.campaign_activation_allowed = true;
reject("unsafe queued candidate", () => prepareQueuedContinuationTask({queuedTask: unsafeQueued, parentHandoff: completedPromotionParent, currentStatus: promotionStatus, sourceCommit: COMMIT, sourceTree: TREE, startedAtUtc: NOW}));
const mismatchedQueued = structuredClone(result.queued);
mismatchedQueued.campaign_id = "CAMPAIGN-OTHER";
reject("queued campaign mismatch", () => prepareQueuedContinuationTask({queuedTask: mismatchedQueued, parentHandoff: completedPromotionParent, currentStatus: promotionStatus, sourceCommit: COMMIT, sourceTree: TREE, startedAtUtc: NOW}));
reject("queued invalid source", () => prepareQueuedContinuationTask({queuedTask: result.queued, parentHandoff: completedPromotionParent, currentStatus: promotionStatus, sourceCommit: "short", sourceTree: TREE, startedAtUtc: NOW}));
const incompleteParent = {...completedPromotionParent, phase: "START", status: "STARTED_INACTIVE"};
reject("queued incomplete parent handoff", () => prepareQueuedContinuationTask({queuedTask: result.queued, parentHandoff: incompleteParent, currentStatus: promotionStatus, sourceCommit: COMMIT, sourceTree: TREE, startedAtUtc: NOW}));

assert(hostileCases >= 18);
console.log(`PASS AgentOS repeatable safe run loop (${hostileCases} hostile cases, exact execution, reconciliation, next-task selection, inactive boundaries, CAS, JSON, and symlink checks)`);
