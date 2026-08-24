#!/usr/bin/env node

/*
 * Local adapter for the current self-development campaign.
 *
 * The portable supervisor only knows typed observations and boundaries.  This
 * adapter translates the local campaign records into that shape and routes
 * one authorized Controller goal through durable local campaign roles.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {
  markDurableWorkerSessionFailed,
  startDurableWorkerSession,
  stopDurableWorkerSession,
  validateLocalDurableSessionRecord,
  validateLocalWorkerHeartbeat,
  validateLocalWorkerReadback,
} from "./local-agent-runtime.mjs";
import {compileControllerCampaignCandidate, controllerDigest} from "./agentos-controller.mjs";
import {compileGovernanceDecisionTree} from "./governance-decision-tree.mjs";
import {
  compileSupervisorObservation,
  selectAutonomousNextTask,
  supervisorDigest,
} from "./controller-supervisor.mjs";
import {
  compileHybridSchedulerRequest,
  createHybridScheduler,
  opaqueSchedulerWorktreeRef,
} from "./hybrid-scheduler.mjs";
import {parseCheckCommand} from "./check-runner.mjs";

const AUTONOMOUS_TASK_QUEUE_FILE = "autonomous-supervisor-task-queue.json";
const CAMPAIGN_PROGRESS_FILE = "autonomous-supervisor-campaign-progress.json";
const CONTROLLER_PLANNING_PROGRESS_FILE = "autonomous-supervisor-planning-progress.json";
const OWNER_FEEDBACK_BACKLOG_FILE = "docs/owner-feedback-backlog.md";
const REQUIRED_CAMPAIGN_ROLES = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR",
  "FEATURE_AGENT",
  "INDEPENDENT_AUDITOR",
]);
const MEANINGFUL_PROGRESS_WINDOW_MINUTES = 15;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function opaqueError(value) {
  const raw = value?.message ?? String(value);
  return `opaque:error:${controllerDigest(raw)}`;
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{40}$/u.test(value), `${label} must be a Git object`);
}

export function parseOwnerFeedbackBacklogMarkdown(markdown) {
  requireString(markdown, "owner feedback backlog");
  const items = [];
  const rowPattern = /^\|\s*`(FEEDBACK-\d+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*`?(OPEN|IN_PROGRESS|RESOLVED|DEFERRED)`?\s*\|$/u;
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(rowPattern);
    if (match === null) continue;
    items.push({
      id: match[1],
      symptom: match[2].trim(),
      expected_behavior: match[3].trim(),
      follow_up_campaign: match[4].trim(),
      status: match[5],
    });
  }
  assert(new Set(items.map((item) => item.id)).size === items.length, "owner feedback backlog IDs are duplicated");
  return items.sort((left, right) => Number(left.id.slice("FEEDBACK-".length)) - Number(right.id.slice("FEEDBACK-".length)));
}

function readOwnerFeedbackBacklog(repositoryRoot) {
  const target = path.join(repositoryRoot, OWNER_FEEDBACK_BACKLOG_FILE);
  if (!fs.existsSync(target)) return {items: [], backlog_sha256: null};
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), "owner feedback backlog must be a regular file");
  const markdown = fs.readFileSync(target, "utf8");
  return {
    items: parseOwnerFeedbackBacklogMarkdown(markdown),
    backlog_sha256: crypto.createHash("sha256").update(markdown, "utf8").digest("hex"),
  };
}

function nextOpenOwnerFeedbackItem(repositoryRoot) {
  return readOwnerFeedbackBacklog(repositoryRoot).items.find((item) => item.status === "OPEN") ?? null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return supervisorDigest(body);
}

function safeRoot(root, label) {
  requireString(root, label);
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a real directory`);
  return resolved;
}

function assertNoSymlinkAncestors(root, target, label) {
  let current = target;
  while (true) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), `${label} contains a symbolic-link component`);
    if (current === root) return;
    const parent = path.dirname(current);
    assert(parent !== current && parent.startsWith(`${root}${path.sep}`), `${label} escapes the bound root`);
    current = parent;
  }
}

function readJson(target) {
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `local supervisor record is not a regular file: ${target}`);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function readOptional(root, name) {
  const target = path.join(root, name);
  return fs.existsSync(target) ? readJson(target) : null;
}

export function resolveAddressedRecordConflict({recordName, digestField, existingRecord, replacementRecord}) {
  requireString(recordName, "addressed record name");
  requireString(digestField, "addressed record digest field");
  assert(existingRecord && typeof existingRecord === "object" && !Array.isArray(existingRecord), "existing addressed record is required");
  assert(replacementRecord && typeof replacementRecord === "object" && !Array.isArray(replacementRecord), "replacement addressed record is required");
  requireSha(existingRecord[digestField], "existing addressed record digest");
  requireSha(replacementRecord[digestField], "replacement addressed record digest");
  if (existingRecord[digestField] === replacementRecord[digestField]) return {action: "KEEP_EXISTING", record_name: recordName, digest_field: digestField, original_digest: existingRecord[digestField], replacement_digest: replacementRecord[digestField]};
  return {
    action: "PRESERVE_AND_REPLACE",
    record_name: recordName,
    digest_field: digestField,
    original_digest: existingRecord[digestField],
    replacement_digest: replacementRecord[digestField],
    reason: "existing completion record is bound to a stale parent; preserve it before writing the current parent-bound record",
  };
}

function writeAddressed(root, name, value, field = "record_sha256") {
  assert(!path.isAbsolute(name), "addressed record name must be relative");
  const target = path.join(root, name);
  assertNoSymlinkAncestors(root, target, "addressed record path");
  const record = structuredClone(value);
  record[field] = null;
  record[field] = digestWithout(record, field);
  if (fs.existsSync(target)) {
    const existing = readJson(target);
    const conflict = resolveAddressedRecordConflict({recordName: name, digestField: field, existingRecord: existing, replacementRecord: record});
    if (conflict.action === "KEEP_EXISTING") return existing;
    const safeName = name.replaceAll("/", "__").replace(/[^A-Za-z0-9._-]/gu, "_");
    const archiveDirectory = path.join(root, "autonomous-supervisor-stale-records");
    const archivePath = path.join(archiveDirectory, `${safeName}-${conflict.original_digest}.json`);
    const originalBytes = fs.readFileSync(target);
    assertNoSymlinkAncestors(root, archiveDirectory, "stale record archive path");
    fs.mkdirSync(archiveDirectory, {recursive: true});
    assertNoSymlinkAncestors(root, archivePath, "stale record archive path");
    if (!fs.existsSync(archivePath)) fs.writeFileSync(archivePath, originalBytes, {flag: "wx", mode: 0o600});
    else { assert(!fs.lstatSync(archivePath).isSymbolicLink(), "stale addressed record archive may not be a symlink"); assert(fs.readFileSync(archivePath).equals(originalBytes), "stale addressed record archive changed"); }
    const mismatch = {...conflict, schema: "agentos.controller_stale_completion_record_mismatch.v1", version: 1, original_evidence_path: path.relative(root, archivePath), observed_at_utc: new Date().toISOString(), mismatch_sha256: null};
    mismatch.mismatch_sha256 = digestWithout(mismatch, "mismatch_sha256");
    const mismatchPath = `${archivePath}.mismatch.json`;
    if (!fs.existsSync(mismatchPath)) fs.writeFileSync(mismatchPath, `${JSON.stringify(mismatch)}\n`, {flag: "wx", mode: 0o600});
  }
  fs.mkdirSync(path.dirname(target), {recursive: true});
  assertNoSymlinkAncestors(root, target, "addressed record path");
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return readJson(target);
}
function readAddressed(root, name, field) {
  const record = readOptional(root, name);
  if (record === null) return null;
  requireSha(record[field], `${name} ${field}`);
  assert(record[field] === digestWithout(record, field), `${name} is not content-addressed`);
  return record;
}

function validateAutonomousTaskQueue(queue, campaignId, campaignVersion) {
  assert(queue?.schema === "agentos.controller_autonomous_task_queue.v1" && queue.version === 1, "autonomous Controller task queue identity is invalid");
  assert(queue.campaign_id === campaignId && queue.campaign_version === campaignVersion, "autonomous Controller task queue campaign differs");
  requireSha(queue.queue_sha256, "autonomous Controller task queue digest");
  assert(queue.queue_sha256 === digestWithout(queue, "queue_sha256"), "autonomous Controller task queue digest mismatch");
  assert(Array.isArray(queue.tasks), "autonomous Controller task queue tasks are required");
  for (const task of queue.tasks) {
    assert(task && typeof task === "object" && !Array.isArray(task), "autonomous Controller task is invalid");
    assert(typeof task.task_id === "string" && /^[A-Z][A-Z0-9._:-]*$/u.test(task.task_id), "autonomous Controller task ID is invalid");
    assert(["OPEN", "IN_PROGRESS", "COMPLETED", "HELD"].includes(task.status), "autonomous Controller task status is invalid");
    assert(Number.isSafeInteger(task.priority) && task.priority >= 0, "autonomous Controller task priority is invalid");
    assert(typeof task.summary === "string" && task.summary.trim().length > 0, "autonomous Controller task summary is invalid");
    assert(Array.isArray(task.scope) && task.scope.every((value) => typeof value === "string"), "autonomous Controller task scope is invalid");
    assert(typeof task.owner_decision_required === "boolean", "autonomous Controller task owner-decision flag is invalid");
  }
  const ordered = [...queue.tasks].sort((left, right) => left.priority - right.priority || left.task_id.localeCompare(right.task_id));
  assert(JSON.stringify(queue.tasks) === JSON.stringify(ordered), "autonomous Controller tasks are not ordered");
  assert(new Set(queue.tasks.map((task) => task.task_id)).size === queue.tasks.length, "autonomous Controller task IDs are duplicated");
  return queue;
}

function readAutonomousTaskQueue(campaignRoot, campaignId, campaignVersion) {
  const queue = readAddressed(campaignRoot, AUTONOMOUS_TASK_QUEUE_FILE, "queue_sha256");
  return queue === null ? null : validateAutonomousTaskQueue(queue, campaignId, campaignVersion);
}

function ensureAutonomousTaskQueue({campaignRoot, repositoryRoot, handoff, sourceCommit, sourceTree, campaignProgress, checkpointOnCurrentSource, executionContext}) {
  const existing = readAutonomousTaskQueue(campaignRoot, handoff.campaign_id, handoff.campaign_version);
  const checkpointIsCurrent = campaignProgress !== null && checkpointOnCurrentSource === true;
  const firstUsefulWorkflowCompleted = campaignProgress?.first_useful_workflow_completed === true;
  const nextOwnerFeedback = nextOpenOwnerFeedbackItem(repositoryRoot);
  const auditTaskId = `CONTROLLER-WORKFLOW-AUDIT-${sourceCommit.slice(0, 16).toUpperCase()}`;
  const buildTaskId = `CAMPAIGN-PROGRESS-BUILD-${sourceCommit.slice(0, 16).toUpperCase()}`;
  const completedTaskId = `CAMPAIGN-FIRST-USEFUL-WORKFLOW-COMPLETED-${sourceCommit.slice(0, 16).toUpperCase()}`;
  const ownerFeedbackTaskId = nextOwnerFeedback === null ? null : `CAMPAIGN-OWNER-FEEDBACK-${nextOwnerFeedback.id}-${sourceCommit.slice(0, 16).toUpperCase()}`;
  const sameSource = existing !== null && existing.source_commit === sourceCommit && existing.source_tree === sourceTree;
  const completedCurrentAudit = sameSource && existing.tasks.some((candidate) => candidate.task_id === auditTaskId && candidate.status === "COMPLETED");
  // A completed continuation is not a global stop condition. The source-bound
  // task ID and compare-and-swap queue are the idempotency boundary: the same
  // source cannot mint the same task twice, while a new adopted source may
  // legitimately mint the next bounded internal campaign.
  const continuationEligible = firstUsefulWorkflowCompleted;
  const task = continuationEligible
    ? {
      task_id: buildTaskId,
      status: "OPEN",
      priority: 0,
      summary: `The Controller selected one bounded next control-plane behavior from the standing owner intent: ${executionContext.firstUsefulWorkflow}. The Campaign Orchestrator selects its exact repair, the named lane worker builds it, and the Independent Auditor checks the same result.`,
      scope: ["ACCEPTANCE_CONTRACT", "DECISION_TREE", "OWNER_INTENT", "SCOPED_CONTROL_PLANE_CODE", "WORKER_RECEIPTS"].sort(),
      owner_decision_required: false,
    }
    : firstUsefulWorkflowCompleted && nextOwnerFeedback !== null
    ? {
      task_id: ownerFeedbackTaskId,
      status: "OPEN",
      priority: 0,
      summary: `Continue from owner feedback ${nextOwnerFeedback.id}: ${nextOwnerFeedback.expected_behavior} The Controller will route this bounded repair through the Campaign Orchestrator, named lane worker, and Independent Auditor.`,
      scope: ["CONTROL_PLANE_CODE", "OWNER_FEEDBACK_BACKLOG", "FOCUSED_CHECKS", "WORKER_RECEIPTS"].sort(),
      owner_decision_required: false,
    }
    : firstUsefulWorkflowCompleted
    ? {
      task_id: completedTaskId,
      status: "HELD",
      priority: 0,
      summary: "The owner-defined first useful workflow and the current bounded continuation are complete at audited local checkpoints; the Controller will inspect the next source-bound internal item instead of treating completion as a permanent stop.",
      scope: ["ACCEPTANCE_CONTRACT", "CONTROLLER_STATE", "OWNER_INTENT", "WORKER_RECEIPTS"].sort(),
      owner_decision_required: false,
    }
    : completedCurrentAudit
    ? {
      task_id: buildTaskId,
      status: "OPEN",
      priority: 0,
      summary: `Continue the owner-defined first useful workflow: ${executionContext.firstUsefulWorkflow}. The Campaign Orchestrator selects the next bounded control-plane behavior, the named lane worker builds it, and the Independent Auditor checks the same result.`,
      scope: ["ACCEPTANCE_CONTRACT", "DECISION_TREE", "OWNER_INTENT", "SCOPED_CONTROL_PLANE_CODE", "WORKER_RECEIPTS"].sort(),
      owner_decision_required: false,
    }
    : checkpointIsCurrent
    ? {
      task_id: auditTaskId,
      status: "OPEN",
      priority: 0,
      summary: "Recheck the accepted local checkpoint, campaign handoff, worker receipts, retained failures, and the next safe control-plane action.",
      scope: ["ACTIVE_CAMPAIGN_HANDOFF", "ACCEPTED_LOCAL_CHECKPOINT", "CONTROLLER_STATE", "WORKER_RECEIPTS"].sort(),
      owner_decision_required: false,
    }
    : {
      task_id: buildTaskId,
      status: "OPEN",
      priority: 0,
      summary: `Carry out the owner-defined first useful workflow: ${executionContext.firstUsefulWorkflow}. The Orchestrator selects the next bounded control-plane repair, the Feature Agent builds it, and the Auditor checks the same result.`,
      scope: ["ACCEPTANCE_CONTRACT", "DECISION_TREE", "OWNER_INTENT", "SCOPED_CONTROL_PLANE_CODE", "WORKER_RECEIPTS"].sort(),
      owner_decision_required: false,
    };
  if (sameSource) {
    const matchingTask = existing.tasks.find((candidate) => candidate.task_id === task.task_id);
    if (["OPEN", "IN_PROGRESS", "COMPLETED", "HELD"].includes(matchingTask?.status)) return existing;
    writeAddressed(campaignRoot, `autonomous-supervisor-task-queues/${existing.queue_sha256}.json`, existing, "queue_sha256");
    const queue = {
      schema: "agentos.controller_autonomous_task_queue.v1",
      version: 1,
      campaign_id: handoff.campaign_id,
      campaign_version: handoff.campaign_version,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      generated_reason: continuationEligible
        ? "AUTONOMOUS_CONTINUATION_REQUIRED"
        : firstUsefulWorkflowCompleted
        ? nextOwnerFeedback !== null
          ? "OWNER_FEEDBACK_BACKLOG_REQUIRES_NEXT_CAMPAIGN"
          : "FIRST_USEFUL_WORKFLOW_COMPLETED_AWAITING_NEXT_INTENT"
        : completedCurrentAudit
        ? "ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_NEXT_CAMPAIGN_BEHAVIOR"
        : checkpointIsCurrent
        ? "ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_CONTROLLER_RECHECK"
        : "ACTIVE_CAMPAIGN_FIRST_USEFUL_WORKFLOW_NOT_COMPLETED",
      tasks: [task],
      queue_sha256: null,
    };
    return writeMutableAddressed(campaignRoot, AUTONOMOUS_TASK_QUEUE_FILE, queue, "queue_sha256", existing.queue_sha256);
  }
  if (existing !== null) writeAddressed(campaignRoot, `autonomous-supervisor-task-queues/${existing.queue_sha256}.json`, existing, "queue_sha256");
  const queue = {
    schema: "agentos.controller_autonomous_task_queue.v1",
    version: 1,
    campaign_id: handoff.campaign_id,
    campaign_version: handoff.campaign_version,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    generated_reason: continuationEligible
      ? "AUTONOMOUS_CONTINUATION_REQUIRED"
      : firstUsefulWorkflowCompleted
      ? nextOwnerFeedback !== null
        ? "OWNER_FEEDBACK_BACKLOG_REQUIRES_NEXT_CAMPAIGN"
        : "FIRST_USEFUL_WORKFLOW_COMPLETED_AWAITING_NEXT_INTENT"
      : completedCurrentAudit
      ? "ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_NEXT_CAMPAIGN_BEHAVIOR"
      : checkpointIsCurrent
      ? "ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_CONTROLLER_RECHECK"
      : "ACTIVE_CAMPAIGN_FIRST_USEFUL_WORKFLOW_NOT_COMPLETED",
    tasks: [task],
    queue_sha256: null,
  };
  if (existing === null) return writeAddressed(campaignRoot, AUTONOMOUS_TASK_QUEUE_FILE, queue, "queue_sha256");
  return writeMutableAddressed(campaignRoot, AUTONOMOUS_TASK_QUEUE_FILE, queue, "queue_sha256", existing.queue_sha256);
}

function writeMutableAddressed(root, name, value, field, expectedDigest = null) {
  assert(!path.isAbsolute(name), "mutable addressed record name must be relative");
  const target = path.join(root, name);
  assertNoSymlinkAncestors(root, target, "mutable addressed record path");
  const existing = fs.existsSync(target) ? readJson(target) : null;
  if (expectedDigest !== null) assert(existing?.[field] === expectedDigest, `${name} compare-and-swap parent is stale`);
  const record = structuredClone(value);
  record[field] = null;
  record[field] = digestWithout(record, field);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  assertNoSymlinkAncestors(root, target, "mutable addressed record path");
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return readJson(target);
}

const CONTROLLER_PLANNING_PHASES = Object.freeze(["ORCHESTRATOR_REVIEW", "FEATURE_BUILD", "INDEPENDENT_AUDIT", "FINALIZER_REVIEW", "COMPLETED", "FAILED"]);

export function compileControllerPlanningProgress({goal, taskId, sourceCommit, sourceTree, status = "IN_PROGRESS", phase, message, nextAction, updatedAtUtc = new Date().toISOString()}) {
  assert(goal && typeof goal === "object" && !Array.isArray(goal), "planning progress goal is required");
  requireString(taskId, "planning progress task ID");
  requireGitObject(sourceCommit, "planning progress source commit");
  requireGitObject(sourceTree, "planning progress source tree");
  assert(["IN_PROGRESS", "COMPLETED", "FAILED"].includes(status), "planning progress status is invalid");
  assert(CONTROLLER_PLANNING_PHASES.includes(phase), "planning progress phase is invalid");
  requireString(message, "planning progress message");
  requireString(nextAction, "planning progress next action");
  requireString(updatedAtUtc, "planning progress time");
  assert(updatedAtUtc.endsWith("Z") && Number.isFinite(Date.parse(updatedAtUtc)), "planning progress time must be UTC");
  const progress = {
    schema: "agentos.controller_planning_progress.v1",
    version: 1,
    status,
    controller_role: "AGENTOS_CONTROLLER",
    controller_display_name: "Intent Regulator",
    project_id: goal.project_id,
    campaign_id: goal.campaign_id,
    campaign_version: goal.campaign_version,
    goal_id: goal.goal_id,
    goal_sha256: goal.goal_sha256,
    task_id: taskId,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    phase,
    message,
    next_action: nextAction,
    updated_at_utc: updatedAtUtc,
    progress_sha256: null,
  };
  requireString(progress.project_id, "planning progress project ID");
  requireString(progress.campaign_id, "planning progress campaign ID");
  requireString(progress.campaign_version, "planning progress campaign version");
  requireString(progress.goal_id, "planning progress goal ID");
  requireSha(progress.goal_sha256, "planning progress goal digest");
  progress.progress_sha256 = digestWithout(progress, "progress_sha256");
  return progress;
}

function readControllerPlanningProgress(campaignRoot, campaignId, campaignVersion) {
  const progress = readAddressed(campaignRoot, CONTROLLER_PLANNING_PROGRESS_FILE, "progress_sha256");
  if (progress === null) return null;
  assert(progress.schema === "agentos.controller_planning_progress.v1" && progress.version === 1, "Controller planning progress identity is invalid");
  assert(progress.campaign_id === campaignId && progress.campaign_version === campaignVersion, "Controller planning progress campaign differs");
  assert(["IN_PROGRESS", "COMPLETED", "FAILED"].includes(progress.status), "Controller planning progress status is invalid");
  assert(CONTROLLER_PLANNING_PHASES.includes(progress.phase), "Controller planning progress phase is invalid");
  requireGitObject(progress.source_commit, "Controller planning progress source commit");
  requireGitObject(progress.source_tree, "Controller planning progress source tree");
  requireSha(progress.goal_sha256, "Controller planning progress goal digest");
  requireString(progress.message, "Controller planning progress message");
  requireString(progress.next_action, "Controller planning progress next action");
  return progress;
}

function writeControllerPlanningProgress({campaignRoot, goal, taskId, sourceCommit, sourceTree, status = "IN_PROGRESS", phase, message, nextAction}) {
  const existing = readAddressed(campaignRoot, CONTROLLER_PLANNING_PROGRESS_FILE, "progress_sha256");
  const progress = compileControllerPlanningProgress({goal, taskId, sourceCommit, sourceTree, status, phase, message, nextAction});
  return writeMutableAddressed(campaignRoot, CONTROLLER_PLANNING_PROGRESS_FILE, progress, "progress_sha256", existing?.progress_sha256 ?? null);
}
function readCampaignProgress(campaignRoot, campaignId, campaignVersion) {
  const progress = readAddressed(campaignRoot, CAMPAIGN_PROGRESS_FILE, "progress_sha256");
  if (progress === null) return null;
  assert(progress.schema === "agentos.controller_autonomous_campaign_progress.v1" && progress.version === 1, "autonomous campaign progress identity is invalid");
  assert(progress.campaign_id === campaignId && progress.campaign_version === campaignVersion, "autonomous campaign progress campaign differs");
  assert(progress.status === "CHECKPOINT_READY", "autonomous campaign progress status is invalid");
  requireGitObject(progress.source_commit, "autonomous campaign progress source commit");
  requireGitObject(progress.source_tree, "autonomous campaign progress source tree");
  requireSha(progress.candidate_sha256, "autonomous campaign progress candidate");
  requireSha(progress.context_sha256, "autonomous campaign progress context");
  return progress;
}

function readCampaignExecutionContext({campaignRoot, handoff, sourceCommit, sourceTree}) {
  const ownerIntent = readJson(path.join(campaignRoot, "owner-intent.json"));
  const scope = readJson(path.join(campaignRoot, "scope.json"));
  const acceptance = readJson(path.join(campaignRoot, "acceptance-contract.json"));
  const decisionTreeRequirement = readJson(path.join(campaignRoot, "decision-tree-requirement.json"));
  const decisionTree = readJson(path.join(campaignRoot, "decision-tree.json"));
  const modelPlan = readJson(path.join(campaignRoot, "model-plan.json"));
  const controllerState = readJson(path.join(campaignRoot, "controller-state.json"));
  assert(ownerIntent?.schema === "agentos.agentos_self_development_owner_intent.v1", "autonomous campaign owner intent is unavailable");
  assert(scope?.schema === "agentos.local_self_development_scope.v1", "autonomous campaign scope is unavailable");
  assert(acceptance?.schema === "agentos.local_self_development_acceptance.v1", "autonomous campaign acceptance contract is unavailable");
  assert(decisionTreeRequirement?.schema === "agentos.executable_decision_tree_requirement.v1", "autonomous campaign decision-tree requirement is unavailable");
  assert(modelPlan?.schema === "agentos.local_self_development_model_plan.v1", "autonomous campaign model plan is unavailable");
  assert(controllerState?.schema === "agentos.controller_state.v1", "autonomous campaign Controller state is unavailable");
  assert(controllerState.active_campaign_id === handoff.campaign_id, "autonomous campaign Controller state is not bound to the active campaign");
  for (const [value, label] of [
    [ownerIntent.owner_intent_sha256, "owner intent"],
    [scope.scope_sha256, "scope"],
    [acceptance.acceptance_sha256, "acceptance contract"],
    [decisionTreeRequirement.decision_tree_requirement_sha256, "decision-tree requirement"],
    [modelPlan.model_plan_sha256, "model plan"],
    [controllerState.policy_state_sha256, "Controller policy"],
  ]) requireSha(value, `autonomous campaign ${label}`);
  requireString(ownerIntent.goal, "autonomous campaign owner goal");
  const policyVariables = controllerState.policy_state?.variables;
  assert(Array.isArray(policyVariables), "autonomous campaign policy variables are unavailable");
  const firstUsefulWorkflow = policyVariables.find((variable) => variable?.variable_id === "PROJECT.FIRST_USEFUL_WORKFLOW")?.current_value;
  requireString(firstUsefulWorkflow ?? ownerIntent.current_run, "autonomous campaign first useful workflow");
  assert(decisionTree?.schema === "agentos.governance_decision_tree.v1", "autonomous campaign decision tree is unavailable");
  assert(Array.isArray(decisionTree.gates) && decisionTree.gates.length > 0, "autonomous campaign decision tree has no gates");
  const featureFiles = [...new Set(decisionTree.gates.flatMap((gate) => gate.feature_files))].sort();
  assert(featureFiles.length > 0, "autonomous campaign decision tree has no feature files");

  /*
   * A prior audited checkpoint may have changed the source after Bootstrap
   * wrote its original candidate and tree.  Rebind those immutable intent and
   * scope records to the exact source the Controller is observing before any
   * worker is started.  This is a control-plane reconciliation, not a scope
   * expansion and not Product work.
   */
  const candidate = compileControllerCampaignCandidate({
    projectId: ownerIntent.project_id,
    campaignId: handoff.campaign_id,
    campaignVersion: handoff.campaign_version,
    policyEpoch: controllerState.policy_epoch,
    policyStateSha256: controllerState.policy_state_sha256,
    ownerIntentSha256: ownerIntent.owner_intent_sha256,
    acceptanceContractSha256: acceptance.acceptance_sha256,
    modelPlanSha256: modelPlan.model_plan_sha256,
    scopeSha256: scope.scope_sha256,
    sourceCommit,
    sourceTree,
  });
  const sourceBoundDecisionTree = compileGovernanceDecisionTree({
    sourceCommit,
    sourceTree,
    ownerIntentSha256: ownerIntent.owner_intent_sha256,
    scopeSha256: scope.scope_sha256,
    featureFiles,
  });
  const contextPath = `autonomous-supervisor-context/${sourceCommit}.json`;
  const context = writeAddressed(campaignRoot, contextPath, {
    schema: "agentos.controller_autonomous_campaign_context.v1",
    version: 1,
    status: "SOURCE_BOUND",
    campaign_id: handoff.campaign_id,
    campaign_version: handoff.campaign_version,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    owner_intent_sha256: ownerIntent.owner_intent_sha256,
    scope_sha256: scope.scope_sha256,
    acceptance_sha256: acceptance.acceptance_sha256,
    model_plan_sha256: modelPlan.model_plan_sha256,
    decision_tree_requirement_sha256: decisionTreeRequirement.decision_tree_requirement_sha256,
    candidate_sha256: candidate.candidate_sha256,
    decision_tree_sha256: sourceBoundDecisionTree.tree_sha256,
    first_useful_workflow: firstUsefulWorkflow ?? ownerIntent.current_run,
    owner_goal: ownerIntent.goal,
    allowed_work: [...scope.allowed_work].sort(),
    required_evidence: [...acceptance.required_evidence].sort(),
    external_actions_attempted: false,
    context_sha256: null,
  }, "context_sha256");
  const candidatePath = `autonomous-supervisor-context/${sourceCommit}-candidate.json`;
  const decisionTreePath = `autonomous-supervisor-context/${sourceCommit}-decision-tree.json`;
  const writtenCandidate = writeAddressed(campaignRoot, candidatePath, candidate, "candidate_sha256");
  const writtenDecisionTree = writeAddressed(campaignRoot, decisionTreePath, sourceBoundDecisionTree, "tree_sha256");
  return {
    ownerIntent,
    scope,
    acceptance,
    decisionTreeRequirement,
    modelPlan,
    controllerState,
    context,
    contextPath,
    candidate: writtenCandidate,
    decisionTree: writtenDecisionTree,
    candidatePath,
    decisionTreePath,
    firstUsefulWorkflow: firstUsefulWorkflow ?? ownerIntent.current_run,
  };
}

function relativeChild(root, relativePath, label) {
  requireString(relativePath, label);
  assert(!path.isAbsolute(relativePath), `${label} must be relative`);
  const resolvedRoot = fs.realpathSync.native(path.resolve(root));
  const target = path.resolve(resolvedRoot, relativePath);
  assert(target.startsWith(`${resolvedRoot}${path.sep}`), `${label} escapes the campaign root`);
  assertNoSymlinkAncestors(resolvedRoot, target, label);
  return target;
}

function readCurrentHandoff(campaignRoot, legacyPath) {
  const pointer = readAddressed(campaignRoot, "autonomous-supervisor-current-handoff.json", "pointer_sha256");
  if (pointer === null) {
    const handoff = readJson(legacyPath);
    requireSha(handoff.handoff_sha256, "legacy current handoff digest");
    assert(handoff.handoff_sha256 === digestWithout(handoff, "handoff_sha256"), "legacy current handoff content digest is invalid");
    return handoff;
  }
  const handoffPath = relativeChild(campaignRoot, pointer.handoff_path, "current handoff path");
  const handoff = readJson(handoffPath);
  requireSha(handoff.handoff_sha256, "current handoff digest");
  assert(handoff.handoff_sha256 === digestWithout(handoff, "handoff_sha256"), "current handoff content digest is invalid");
  assert(pointer.handoff_sha256 === handoff.handoff_sha256, "current handoff pointer differs from its content");
  return handoff;
}

function writeCurrentHandoff(campaignRoot, handoff, expectedPointerDigest = null) {
  const handoffPath = `autonomous-supervisor-handoffs/${handoff.goal_id}.json`;
  const written = writeAddressed(campaignRoot, handoffPath, handoff, "handoff_sha256");
  const pointer = writeMutableAddressed(campaignRoot, "autonomous-supervisor-current-handoff.json", {
    schema: "agentos.controller_autonomous_supervisor_current_handoff.v1",
    version: 1,
    handoff_path: handoffPath,
    handoff_sha256: written.handoff_sha256,
    previous_pointer_sha256: expectedPointerDigest,
    pointer_sha256: null,
  }, "pointer_sha256", expectedPointerDigest);
  return {handoff: written, pointer};
}

function walkRegularFiles(root, directory = root, result = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkRegularFiles(root, absolute, result);
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

function sessionRecordPath(session) {
  return path.join(path.dirname(session.heartbeat_path), "session.json");
}

function discoverSupervisorSessions(campaignRoot, campaignId) {
  const sessionsRoot = path.join(campaignRoot, "sessions");
  if (!fs.existsSync(sessionsRoot)) return [];
  return walkRegularFiles(campaignRoot, sessionsRoot)
    .filter((target) => path.basename(target) === "session.json")
    .map((target) => ({target, record: readJson(target)}))
    .filter(({record}) => record?.campaign_id === campaignId && typeof record.task_id === "string" && typeof record.task_kind === "string")
    .map(({target, record}) => ({target, record}));
}

function sessionEntries(campaignRoot, handoff) {
  const declared = Array.isArray(handoff.supervised_sessions) ? handoff.supervised_sessions : [];
  const paths = declared.map((entry) => entry.session_record_path).filter((value) => typeof value === "string");
  const declaredEntries = paths.map((relativePath) => ({target: relativeChild(campaignRoot, relativePath, "supervised session path"), record: null}));
  const discoveredEntries = discoverSupervisorSessions(campaignRoot, handoff.campaign_id).filter(({record}) => ["RUNNING", "STARTING"].includes(record.status));
  const combined = [...declaredEntries, ...discoveredEntries];
  const seen = new Set();
  const entries = combined
    .map(({target, record}) => ({target, record: record ?? readJson(target)}))
    .filter(({target, record}) => {
      if (record === null || seen.has(target)) return false;
      seen.add(target);
      return true;
    });
  const sessionIds = new Set();
  const roles = new Set();
  for (const {record} of entries) {
    assert(record.campaign_id === handoff.campaign_id, "supervised session campaign identity differs from the current handoff");
    assert(record.campaign_version === handoff.campaign_version, "supervised session campaign version differs from the current handoff");
    assert(typeof record.session_id === "string" && record.session_id.length > 0, "supervised session identity is missing");
    assert(!sessionIds.has(record.session_id), "supervised session identities are duplicated");
    sessionIds.add(record.session_id);
    assert(typeof record.role === "string" && record.role.length > 0, "supervised session role is missing");
    assert(!roles.has(record.role), "supervised session roles are duplicated");
    roles.add(record.role);
  }
  return entries;
}

function processAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function compareFindingIds(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function reconcileExitedSessionRecords(entries) {
  return entries.map((entry) => {
    if (["RUNNING", "STARTING"].includes(entry.record.status) && !processAlive(entry.record.pid)) {
      entry.record = markDurableWorkerSessionFailed({
        sessionRecordPath: entry.target,
        failure: "durable worker process exited before Controller reconciliation",
      });
    }
    return entry;
  });
}

function sessionProgressState(record, observedAtUtc = new Date().toISOString()) {
  const candidates = [];
  const initialReadback = record.initial_readback;
  if (initialReadback?.status === "COMPLETED"
    && initialReadback.session_id === record.session_id
    && initialReadback.campaign_id === record.campaign_id
    && initialReadback.campaign_version === record.campaign_version
    && initialReadback.source_commit === record.source_commit
    && initialReadback.source_tree === record.source_tree
    && typeof initialReadback.observed_at_utc === "string"
    && /^[0-9a-f]{64}$/u.test(initialReadback.readback_sha256 ?? "")) {
    const evidenceSha256 = /^[0-9a-f]{64}$/u.test(initialReadback.build_checkpoint_sha256 ?? "")
      ? initialReadback.build_checkpoint_sha256
      : initialReadback.readback_sha256;
    candidates.push({
      observed_at_utc: initialReadback.observed_at_utc,
      evidence_sha256: evidenceSha256,
    });
  }
  try {
    const commandResult = record.command_result_path ? readJson(record.command_result_path) : null;
    if (commandResult?.status === "COMPLETED"
      && commandResult.session_id === record.session_id
      && commandResult.campaign_id === record.campaign_id
      && commandResult.campaign_version === record.campaign_version
      && commandResult.source_commit === record.source_commit
      && commandResult.source_tree === record.source_tree
      && commandResult.handshake?.source_commit === record.source_commit
      && commandResult.handshake?.source_tree === record.source_tree
      && typeof commandResult.observed_at_utc === "string"
      && /^[0-9a-f]{64}$/u.test(commandResult.result_sha256 ?? "")) {
      candidates.push({
        observed_at_utc: commandResult.observed_at_utc,
        evidence_sha256: commandResult.result_sha256,
      });
    }
  } catch {
    // A missing or malformed result is absent progress, not fresh liveness.
  }
  const latest = candidates
    .filter((candidate) => Number.isFinite(Date.parse(candidate.observed_at_utc)) && /^[0-9a-f]{64}$/u.test(candidate.evidence_sha256 ?? ""))
    .sort((left, right) => Date.parse(left.observed_at_utc) - Date.parse(right.observed_at_utc))
    .at(-1) ?? null;
  const observedAtMs = Date.parse(observedAtUtc);
  const lastProgressMs = latest === null ? null : Date.parse(latest.observed_at_utc);
  const stale = latest === null
    || !Number.isFinite(observedAtMs)
    || !Number.isFinite(lastProgressMs)
    || observedAtMs - lastProgressMs >= MEANINGFUL_PROGRESS_WINDOW_MINUTES * 60 * 1000;
  return {
    meaningful_progress: latest !== null,
    last_meaningful_progress_at_utc: latest?.observed_at_utc ?? null,
    progress_evidence_sha256: latest?.evidence_sha256 ?? null,
    progress_stale: stale,
  };
}

function sessionIsHealthy({record, sourceCommit, sourceTree, observedAtUtc = new Date().toISOString()}) {
  try {
    validateLocalDurableSessionRecord(record);
    const heartbeat = readJson(record.heartbeat_path);
    validateLocalWorkerHeartbeat(heartbeat, {
      role: record.role,
      sessionId: record.session_id,
      campaignId: record.campaign_id,
      campaignVersion: record.campaign_version,
      candidateSha256: record.candidate_sha256,
      sourceCommit,
      sourceTree,
    });
    const progress = sessionProgressState(record, observedAtUtc);
    return record.status === "RUNNING" && heartbeat.status === "RUNNING" && processAlive(record.pid) && !progress.progress_stale;
  } catch {
    return false;
  }
}

function durableSessionLivenessSnapshot({campaignRoot, target, record, sourceCommit, sourceTree, observedAtUtc = new Date().toISOString()}) {
  const heartbeat = (() => {
    try {
      return readJson(record.heartbeat_path);
    } catch {
      return null;
    }
  })();
  let heartbeatValid = false;
  try {
    validateLocalDurableSessionRecord(record);
    validateLocalWorkerHeartbeat(heartbeat, {
      role: record.role,
      sessionId: record.session_id,
      campaignId: record.campaign_id,
      campaignVersion: record.campaign_version,
      candidateSha256: record.candidate_sha256,
      sourceCommit: record.source_commit,
      sourceTree: record.source_tree,
    });
    heartbeatValid = true;
  } catch {
    heartbeatValid = false;
  }
  const processIsAlive = processAlive(record.pid);
  const progress = sessionProgressState(record, observedAtUtc);
  return {
    role: record.role,
    session_id: record.session_id,
    task_id: record.task_id,
    task_kind: record.task_kind,
    pid: record.pid,
    process_alive: processIsAlive,
    record_status: record.status,
    heartbeat_status: heartbeat?.status ?? null,
    heartbeat_session_pid: heartbeat?.session_pid ?? null,
    heartbeat_valid: heartbeatValid,
    meaningful_progress: progress.meaningful_progress,
    last_meaningful_progress_at_utc: progress.last_meaningful_progress_at_utc,
    progress_evidence_sha256: progress.progress_evidence_sha256,
    progress_stale: progress.progress_stale,
    source_aligned: record.source_commit === sourceCommit && record.source_tree === sourceTree,
    session_record_path: path.relative(campaignRoot, target),
    source_commit: record.source_commit,
    source_tree: record.source_tree,
    repair_required: !processIsAlive
      || !heartbeatValid
      || heartbeat?.status !== "RUNNING"
      || heartbeat?.session_pid !== record.pid
      || record.source_commit !== sourceCommit
      || record.source_tree !== sourceTree
      || progress.progress_stale,
  };
}

export function summarizeDurableSessionLiveness({snapshots, declaredSessionIds = [], requiredRoles = REQUIRED_CAMPAIGN_ROLES}) {
  assert(Array.isArray(snapshots), "durable session liveness snapshots are required");
  assert(Array.isArray(declaredSessionIds), "declared durable session IDs are required");
  assert(Array.isArray(requiredRoles) && requiredRoles.length > 0, "required durable session roles are required");
  assert(new Set(declaredSessionIds).size === declaredSessionIds.length, "declared durable session identities are duplicated");
  const snapshotIds = new Set();
  for (const snapshot of snapshots) {
    assert(typeof snapshot.session_id === "string" && snapshot.session_id.length > 0, "durable session snapshot identity is missing");
    assert(!snapshotIds.has(snapshot.session_id), "durable session snapshot identities are duplicated");
    snapshotIds.add(snapshot.session_id);
    assert(typeof snapshot.role === "string" && snapshot.role.length > 0, "durable session snapshot role is missing");
  }
  const declared = new Set(declaredSessionIds);
  const unhealthy = snapshots
    .filter((snapshot) => !declared.has(snapshot.session_id) || snapshot.repair_required)
    .map((snapshot) => ({...snapshot, declared: declared.has(snapshot.session_id)}));
  const declaredRoles = new Set(snapshots
    .filter((snapshot) => declared.has(snapshot.session_id))
    .map((snapshot) => snapshot.role));
  const missingRoles = requiredRoles
    .filter((role) => !declaredRoles.has(role))
    .map((role) => ({
      role,
      session_id: null,
      task_id: null,
      pid: null,
      process_alive: false,
      record_status: "MISSING",
      heartbeat_status: null,
      heartbeat_session_pid: null,
      heartbeat_valid: false,
      meaningful_progress: false,
      last_meaningful_progress_at_utc: null,
      progress_evidence_sha256: null,
      progress_stale: true,
      source_aligned: false,
      session_record_path: null,
      source_commit: null,
      source_tree: null,
      repair_required: true,
      declared: true,
    }));
  const allUnhealthy = [...unhealthy, ...missingRoles]
    .sort((left, right) => `${left.role}:${left.session_id ?? ""}`.localeCompare(`${right.role}:${right.session_id ?? ""}`));
  return {
    unhealthy: allUnhealthy,
    missing_roles: missingRoles.map((entry) => entry.role).sort(),
    orphaned_session_ids: unhealthy.filter((entry) => entry.declared === false).map((entry) => entry.session_id).sort(),
  };
}

function durableSessionFailureRepairPresent(repositoryRoot) {
  try {
    const runtimeSource = fs.readFileSync(path.join(repositoryRoot, "control/local-agent-runtime.mjs"), "utf8");
    return runtimeSource.includes("return markDurableWorkerSessionFailed({sessionRecordPath");
  } catch {
    return false;
  }
}

function sessionSummary(campaignRoot, entry, observedAtUtc = new Date().toISOString()) {
  const progress = sessionProgressState(entry.record, observedAtUtc);
  return {
    role: entry.record.role,
    session_id: entry.record.session_id,
    task_id: entry.record.task_id,
    task_kind: entry.record.task_kind,
    source_commit: entry.record.source_commit,
    source_tree: entry.record.source_tree,
    status: entry.record.status,
    session_record_path: path.relative(campaignRoot, entry.target),
    meaningful_progress: progress.meaningful_progress,
    last_meaningful_progress_at_utc: progress.last_meaningful_progress_at_utc,
    progress_evidence_sha256: progress.progress_evidence_sha256,
    progress_stale: progress.progress_stale,
  };
}

function controllerSupervisorBindingFinding(repositoryRoot) {
  const bindingPath = path.join(repositoryRoot, "schemas/bootstrap-binding.v1.json");
  const controllerPath = path.join(repositoryRoot, "control/controller-supervisor.mjs");
  const binding = readJson(bindingPath);
  const expected = binding?.normative?.controller_supervisor_controller?.sha256;
  requireSha(expected, "Controller supervisor binding digest");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(controllerPath)).digest("hex");
  if (actual === expected) return null;
  return {
    finding_id: "F-CONTROLLER-SUPERVISOR-BINDING-MISMATCH",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "The adopted Controller supervisor source does not match the exact digest recorded in the repository binding.",
    source_sha256: expected,
    expected_sha256: expected,
    actual_sha256: actual,
    observed_path: "schemas/bootstrap-binding.v1.json",
  };
}

function controllerBoundaryPrecedenceFinding(repositoryRoot) {
  const controllerPath = path.join(repositoryRoot, "control/controller-supervisor.mjs");
  const source = fs.readFileSync(controllerPath, "utf8");
  const hardFindingBranch = 'if (hasOpenFinding(observation.findings, ["HARD_SECURITY_BOUNDARY", "TRUE_OWNER_BOUNDARY"])) return "STOP_HARD_BOUNDARY";';
  const softReviewBranch = 'if (observation.soft_boundary || hasOpenFinding(observation.findings, ["SOFT_BOUNDARY"])) return "REVIEW_SOFT_BOUNDARY";';
  const hardIndex = source.indexOf(hardFindingBranch);
  const softIndex = source.indexOf(softReviewBranch);
  if (hardIndex >= 0 && softIndex >= 0 && hardIndex < softIndex) return null;
  return {
    finding_id: "F-CONTROLLER-HARD-BOUNDARY-PRECEDENCE",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "The Controller can send a soft-scope review ahead of an open hard security or owner boundary instead of stopping the dependent work.",
    source_sha256: crypto.createHash("sha256").update(source, "utf8").digest("hex"),
  };
}

function localAgentSessionBindingFinding(repositoryRoot) {
  const bindingPath = path.join(repositoryRoot, "schemas/bootstrap-binding.v1.json");
  const verifierPath = path.join(repositoryRoot, "tests/verify-local-agent-session.mjs");
  const binding = readJson(bindingPath);
  const expected = binding?.normative?.local_agent_session_verifier?.sha256;
  requireSha(expected, "local agent session binding digest");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(verifierPath)).digest("hex");
  if (actual === expected) return null;
  return {
    finding_id: "F-LOCAL-AGENT-SESSION-BINDING-MISMATCH",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "The adopted durable-session verifier does not match the exact digest recorded in the repository binding.",
    source_sha256: expected,
    expected_sha256: expected,
    actual_sha256: actual,
    observed_path: "schemas/bootstrap-binding.v1.json",
  };
}

function ownerConversationSurfaceFinding(repositoryRoot) {
  const bootstrapPath = path.join(repositoryRoot, "control/bootstrap-compiler.mjs");
  const ownerReviewPath = path.join(repositoryRoot, "control/owner-review.mjs");
  const source = fs.readFileSync(bootstrapPath, "utf8");
  const ownerReviewSource = fs.readFileSync(ownerReviewPath, "utf8");
  const promptTexts = [...source.matchAll(/prompt:\s+"([^"]*)"/gu)].map((match) => match[1]);
  const leakedPrompts = [
    "technical setup questions",
    "proves the project is useful",
    "repositories, data, environments, and external systems",
    "normalize and audit it",
    "authentication, irreversible-action",
    "authority corpus",
    "Design Bible",
    "stack, authentication, testing, data, or observability",
    "pushes, merges, CI runners, hosting, deployment, rollback, provider binding",
    "operating conditions",
    "persistent Runtime session and environment",
  ].filter((term) => promptTexts.some((prompt) => prompt.includes(term)));
  const ownerVisibilityLeak = source.includes("owner_visible: false") && source.includes("prompt: question.prompt");
  const leakedReviewOutput = [
    "For the build itself, the current recommendation is",
    "The role recommendations are:",
    "This task is currently described as",
    "technical governance terms",
    "exact result for separate approval",
    "Use only the prompts that are needed; they are examples, not a fixed script:",
    "What would you love this to make easier?",
  ].filter((term) => ownerReviewSource.includes(term));
  if (leakedPrompts.length === 0 && !ownerVisibilityLeak && leakedReviewOutput.length === 0) return null;
  return {
    finding_id: "F-OWNER-CONVERSATION-SURFACE",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: ownerVisibilityLeak
      ? "Bootstrap still exposes a hidden technical setup field through the owner question projection."
      : leakedReviewOutput.length > 0
        ? "The ongoing owner review still exposes internal build recommendations instead of keeping them behind the casual conversation."
        : "Bootstrap still exposes technical governance wording in the owner-facing conversation instead of translating it into ordinary language.",
    source_sha256: supervisorDigest({
      paths: ["control/bootstrap-compiler.mjs", "control/owner-review.mjs"],
      leaked_prompts: leakedPrompts,
      owner_visibility_leak: ownerVisibilityLeak,
      leaked_review_output: leakedReviewOutput,
      source: {
        bootstrap: crypto.createHash("sha256").update(source, "utf8").digest("hex"),
        owner_review: crypto.createHash("sha256").update(ownerReviewSource, "utf8").digest("hex"),
      },
    }),
  };
}

export function selectValidatedAutonomousTask({tasks, boundary, findings = [], activeCampaign}) {
  const selection = selectAutonomousNextTask({tasks, boundary, findings, activeCampaign});
  if (selection.action === "ROUTE_REPAIRABLE_PUZZLE" && selection.task_id !== null) {
    const selectedTask = tasks.find((task) => task.task_id === selection.task_id);
    assert(selectedTask !== undefined && selectedTask.status === "OPEN", "Controller selected task is not an open queued task");
    assert(selectedTask.owner_decision_required === false, "Controller selected task requires an owner decision");
  }
  return selection;
}
function autonomousTaskFinding({campaignRoot, handoff, activation, findings, activeCampaign}) {
  const queue = readAutonomousTaskQueue(campaignRoot, handoff.campaign_id, handoff.campaign_version);
  if (queue === null) return null;
  const permissions = permissionsFrom(handoff, activation);
  const boundary = {
    hard_stop: handoff.owner_decision_required === true,
    soft_review: handoff.scope_changed === true,
    owner_decision_required: handoff.owner_decision_required === true,
    scope_changed: handoff.scope_changed === true,
    ...permissions,
  };
  const selection = selectValidatedAutonomousTask({tasks: queue.tasks, boundary, findings, activeCampaign});
  if (selection.action !== "ROUTE_REPAIRABLE_PUZZLE" || selection.task_id === null) return null;
  const task = queue.tasks.find((candidate) => candidate.task_id === selection.task_id);
  if (task === undefined) throw new Error("autonomous Controller selected a task missing from its queue");
  return {
    finding_id: `F-AUTONOMOUS-TASK-${task.task_id}`,
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_NEXT_REQUIRED_BEHAVIOR",
    summary: task.summary,
    source_sha256: queue.queue_sha256,
  };
}

function autonomousCampaignProgressStallFinding({campaignRoot, handoff, campaignProgress, checkpointOnCurrentSource, taskQueue, sourceCommit, sourceTree}) {
  if (handoff.campaign_active !== true || campaignProgress === null || campaignProgress.first_useful_workflow_completed === true || checkpointOnCurrentSource !== true || taskQueue === null) return null;
  const auditTaskId = `CONTROLLER-WORKFLOW-AUDIT-${sourceCommit.slice(0, 16).toUpperCase()}`;
  const auditTask = taskQueue.tasks.find((task) => task.task_id === auditTaskId);
  if (auditTask?.status !== "COMPLETED") return null;
  return {
    finding_id: "F-AUTONOMOUS-CAMPAIGN-PROGRESS-STALL",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "The active campaign completed its self-audit but did not mint the next bounded build behavior from the owner’s ongoing self-development intent.",
    source_sha256: supervisorDigest({
      campaign_progress_sha256: campaignProgress.progress_sha256,
      queue_sha256: taskQueue.queue_sha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
    }),
  };
}

function autonomousCampaignContinuationFinding({handoff, campaignProgress, checkpointOnCurrentSource, taskQueue, sourceCommit, sourceTree}) {
  if (handoff.campaign_active !== true || campaignProgress?.first_useful_workflow_completed !== true || checkpointOnCurrentSource !== true || taskQueue === null) return null;
  if (taskQueue.tasks.some((task) => task.status === "OPEN" || task.status === "IN_PROGRESS")) return null;
  const heldCompletion = taskQueue.tasks.find((task) => task.status === "HELD" && task.task_id.startsWith("CAMPAIGN-FIRST-USEFUL-WORKFLOW-COMPLETED-"));
  if (heldCompletion === undefined) return null;
  return {
    finding_id: "F-CONTROLLER-AUTOMATIC-CONTINUATION",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "The Controller held an active, locally authorized campaign after its first audited checkpoint instead of selecting the next bounded control-plane behavior from the standing owner intent.",
    source_sha256: supervisorDigest({
      campaign_progress_sha256: campaignProgress.progress_sha256,
      queue_sha256: taskQueue.queue_sha256,
      held_task_id: heldCompletion.task_id,
      source_commit: sourceCommit,
      source_tree: sourceTree,
    }),
  };
}

function durableSessionTestFinding(campaignRoot) {
  const tick = readOptional(campaignRoot, "supervisor/tick.json");
  const routeError = typeof tick?.route_error === "string" ? tick.route_error : "";
  const goal = readOptional(campaignRoot, "supervisor/goal.json");
  const priorGoalOwnedFinding = Array.isArray(goal?.finding_ids) && goal.finding_ids.includes("F-DURABLE-SESSION-TEST-TMP-ROOT");
  const matchesKnownFailure = routeError.includes("mkdtemp") && routeError.includes("agentos-durable-session");
  if (tick?.route_status !== "ROUTE_FAILED" || (!matchesKnownFailure && !priorGoalOwnedFinding)) return null;
  return {
    finding_id: "F-DURABLE-SESSION-TEST-TMP-ROOT",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "The durable-session verifier cannot create its temporary test folder inside an isolated worktree.",
    source_sha256: tick.tick_sha256,
    observed_path: "tests/verify-local-agent-session.mjs",
  };
}

function durableSessionLivenessFinding({campaignRoot, handoff, repositoryRoot, sourceCommit, sourceTree, observedAtUtc = new Date().toISOString()}) {
  if (handoff.campaign_active !== true) return null;
  const entries = sessionEntries(campaignRoot, handoff);
  const declaredSessionIds = (Array.isArray(handoff.supervised_sessions) ? handoff.supervised_sessions : [])
    .map((entry) => entry.session_id)
    .filter((sessionId) => typeof sessionId === "string")
    .sort();
  const declaredTargets = new Set((Array.isArray(handoff.supervised_sessions) ? handoff.supervised_sessions : [])
    .map((entry) => typeof entry?.session_record_path === "string" ? relativeChild(campaignRoot, entry.session_record_path, "declared supervised session path") : null)
    .filter((target) => target !== null));
  const snapshots = entries.map(({target, record}) => ({
    ...durableSessionLivenessSnapshot({campaignRoot, target, record, sourceCommit, sourceTree, observedAtUtc}),
    declared: declaredTargets.has(target),
  }));
  const liveness = summarizeDurableSessionLiveness({snapshots, declaredSessionIds});
  if (liveness.unhealthy.length === 0) return null;
  const sourceSha256 = supervisorDigest({
    source_commit: sourceCommit,
    source_tree: sourceTree,
    unhealthy_sessions: liveness.unhealthy,
    missing_roles: liveness.missing_roles,
    orphaned_session_ids: liveness.orphaned_session_ids,
  });
  const deadRoles = [...new Set(liveness.unhealthy.filter((entry) => entry.process_alive === false).map((entry) => entry.role))].sort();
  const progressStalledRoles = [...new Set(liveness.unhealthy.filter((entry) => entry.progress_stale === true).map((entry) => entry.role))].sort();
  const staleRoles = [...new Set(liveness.unhealthy.map((entry) => entry.role))].sort();
  return {
    finding_id: "F-DURABLE-SESSION-LIVENESS",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: progressStalledRoles.length > 0
      ? `The Controller found campaign role${progressStalledRoles.length === 1 ? "" : "s"} with no source-bound meaningful progress within ${MEANINGFUL_PROGRESS_WINDOW_MINUTES} minutes: ${progressStalledRoles.join(", ")}.`
      : deadRoles.length > 0
      ? `The Controller found missing, stopped, or stale campaign role process${deadRoles.length === 1 ? "" : "es"}: ${staleRoles.join(", ")}.`
      : `The Controller found missing, orphaned, or source-stale campaign roles: ${staleRoles.join(", ")}.`,
    source_sha256: sourceSha256,
  };
}

function recordFailedSessionRca(campaignRoot, entry, sourceCommit, sourceTree) {
  const failure = entry.record.failure ?? "durable session failed without an error message";
  const safeFailure = opaqueError(failure);
  const rcaPath = `autonomous-supervisor-route-rcas/${entry.record.task_id}.json`;
  const existing = readOptional(campaignRoot, rcaPath);
  if (existing !== null) return existing;
  return writeAddressed(campaignRoot, rcaPath, {
    schema: "agentos.controller_autonomous_supervisor_route_rca.v1",
    version: 1,
    status: "OPEN_REPAIR_REQUIRED",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    controller_role: "AGENTOS_CONTROLLER",
    task_id: entry.record.task_id,
    task_kind: entry.record.task_kind,
    role: entry.record.role,
    session_id: entry.record.session_id,
    source_commit: entry.record.source_commit,
    source_tree: entry.record.source_tree,
    observed_against_commit: sourceCommit,
    observed_against_tree: sourceTree,
    error_message_exact: safeFailure,
    evidence_path: path.relative(campaignRoot, entry.target),
    root_cause: failure.includes("Auditor liveness observed source changes")
      ? "The liveness Auditor compared the Feature-Agent commit diff with its parent instead of comparing the Feature-Agent checkpoint with the current source identity."
      : "A durable campaign role exited before returning a source-bound readback.",
    required_repair: "Preserve the failed session, correct the source-bound observation or worker behavior, then rerun the bounded liveness route.",
    external_actions_attempted: false,
    rca_sha256: null,
  }, "rca_sha256");
}

function recordOrphanedSessionRca({campaignRoot, handoff, entries, sourceCommit, sourceTree}) {
  const declaredTargets = new Set((Array.isArray(handoff.supervised_sessions) ? handoff.supervised_sessions : [])
    .map((entry) => typeof entry?.session_record_path === "string" ? relativeChild(campaignRoot, entry.session_record_path, "declared supervised session path") : null)
    .filter((target) => target !== null));
  const orphaned = entries.filter(({target, record}) => record.status === "RUNNING" && !declaredTargets.has(target));
  if (orphaned.length === 0) return null;
  const rcaPath = `autonomous-supervisor-route-rcas/ORPHANED-SESSIONS-${sourceCommit}.json`;
  const existing = readOptional(campaignRoot, rcaPath);
  if (existing !== null) return existing;
  return writeAddressed(campaignRoot, rcaPath, {
    schema: "agentos.controller_autonomous_supervisor_orphaned_sessions_rca.v1",
    version: 1,
    status: "OPEN_REPAIR_REQUIRED",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    controller_role: "AGENTOS_CONTROLLER",
    campaign_id: handoff.campaign_id,
    campaign_version: handoff.campaign_version,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    observed_session_count: entries.length,
    declared_session_count: declaredTargets.size,
    orphaned_sessions: orphaned.map(({target, record}) => ({
      role: record.role,
      session_id: record.session_id,
      task_id: record.task_id,
      task_kind: record.task_kind,
      session_record_path: path.relative(campaignRoot, target),
      source_commit: record.source_commit,
      source_tree: record.source_tree,
    })).sort((left, right) => left.session_id.localeCompare(right.session_id)),
    symptom: "Superseded campaign worker sessions remained RUNNING after an earlier route changed the active handoff.",
    expected_behavior: "The Controller discovers every session in campaign custody, retains its evidence, and stops superseded workers before declaring liveness healthy.",
    root_cause: "Session discovery admitted only an old task-name prefix, so Campaign Progress and governance-evidence workers were invisible to liveness reconciliation.",
    required_repair: "Stop the orphaned workers, retain their session and route evidence, and verify exactly three source-bound roles remain.",
    external_actions_attempted: false,
    rca_sha256: null,
  }, "rca_sha256");
}

function recordUnhealthySessionRca({campaignRoot, handoff, entries, sourceCommit, sourceTree}) {
  const unhealthy = entries
    .filter(({record}) => record.status === "RUNNING")
    .map(({target, record}) => durableSessionLivenessSnapshot({campaignRoot, target, record, sourceCommit, sourceTree}))
    .filter((entry) => entry.repair_required)
    .sort((left, right) => left.session_id.localeCompare(right.session_id));
  if (unhealthy.length === 0) return null;
  const observationSha256 = supervisorDigest({source_commit: sourceCommit, source_tree: sourceTree, unhealthy_sessions: unhealthy});
  const rcaPath = `autonomous-supervisor-route-rcas/UNHEALTHY-SESSIONS-${observationSha256.slice(0, 32).toUpperCase()}.json`;
  const existing = readOptional(campaignRoot, rcaPath);
  if (existing !== null) return existing;
  return writeAddressed(campaignRoot, rcaPath, {
    schema: "agentos.controller_autonomous_supervisor_unhealthy_sessions_rca.v1",
    version: 1,
    status: "OPEN_REPAIR_REQUIRED",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    controller_role: "AGENTOS_CONTROLLER",
    campaign_id: handoff.campaign_id,
    campaign_version: handoff.campaign_version,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    unhealthy_sessions: unhealthy,
    symptom: "A campaign role process disappeared or stopped reporting valid source-bound liveness while its durable session record remained RUNNING.",
    expected_behavior: "The Controller observation must change when a role process disappears, retain the exact failed session, and route recovery without an outside prompt.",
    root_cause: "The supervisor observation was derived from the last handoff and did not include verified host-process liveness, so the runtime reused an unchanged observation after the Feature Agent exited.",
    required_repair: "Bind observation identity to current session process and heartbeat facts, mark an exited session as failed, and rerun the three-role liveness route through the Controller.",
    external_actions_attempted: false,
    rca_sha256: null,
  }, "rca_sha256");
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function isAncestor(root, ancestorCommit, descendantCommit) {
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestorCommit, descendantCommit], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    return true;
  } catch {
    return false;
  }
}

function schedulerCandidateIdentity(worktreePath) {
  const commit = git(worktreePath, ["rev-parse", "HEAD"]);
  const tree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
  const status = git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.length === 0) return {commit, tree, clean: true};
  const diff = execFileSync("git", ["-C", worktreePath, "diff", "--binary"], {encoding: "buffer", maxBuffer: 64 * 1024 * 1024});
  const untracked = git(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return {
    commit: "PRELIMINARY_DIAGNOSTIC",
    tree: controllerDigest({commit, tree, status, diff_sha256: crypto.createHash("sha256").update(diff).digest("hex"), untracked}),
    clean: false,
  };
}

function controllerCheckList(taskKind = "CONTROLLER_SUPERVISOR_REPAIR") {
  const checks = [
    "node --check control/controller-supervisor.mjs",
    "node --check control/controller-supervisor-runtime.mjs",
    "node --check control/local-agent-session.mjs",
    "node tests/verify-controller-supervisor.mjs",
  ];
  if (taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR") checks.push("node tests/verify-all.mjs");
  if (taskKind === "DURABLE_SESSION_LIVENESS_REPAIR") checks.push("node --check control/local-agent-runtime.mjs", "node tests/verify-local-agent-session.mjs", "node tests/verify-controller-supervisor-liveness.mjs");
  if (taskKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR") checks.push("node --check control/local-self-development-supervisor-adapter.mjs");
  if (taskKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR") checks.push("node --check control/local-self-development-supervisor-adapter.mjs", "node tests/verify-controller-supervisor.mjs");
  if (taskKind === "OWNER_FEEDBACK_REPAIR") checks.push("node --check control/check-runner.mjs", "node --check control/task-run-loop.mjs", "node --check control/local-agent-runtime.mjs", "node --check control/local-self-development-supervisor-adapter.mjs", "node tests/verify-task-run-loop.mjs", "node tests/verify-local-agent-session.mjs", "node tests/verify-owner-feedback-digest.mjs", "node tests/verify-owner-feedback-progress.mjs", "node tests/verify-owner-feedback-continuation.mjs", "node tests/verify-owner-feedback-execution-boundary.mjs", "node tests/verify-owner-feedback-check-repair.mjs", "node tests/verify-owner-feedback-backlog.mjs", "node tests/verify-all.mjs");
  if (taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR") checks.push("node tests/verify-local-agent-session.mjs");
  if (taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR") checks.push("node tests/verify-owner-conversation-surface.mjs", "node tests/verify-owner-review.mjs", "node tests/verify-bootstrap-delivery-finish.mjs");
  if (taskKind === "GOVERNANCE_EVIDENCE_REPAIR") checks.push(
    "node --check control/governance-evidence.mjs",
    "node --check control/local-agent-worker.mjs",
    "node tests/verify-governance-decision-tree.mjs",
    "node tests/verify-local-campaign-admission.mjs",
  );
  return checks;
}

function runScheduledControllerChecks({scheduler, repositoryRoot, worktreePath, checks, taskKind}) {
  const candidate = schedulerCandidateIdentity(worktreePath);
  const repositoryId = `REPOSITORY-${controllerDigest(repositoryRoot).slice(0, 24).toUpperCase()}`;
  const worktreeId = `WORKTREE-${controllerDigest(worktreePath).slice(0, 24).toUpperCase()}`;
  const request = compileHybridSchedulerRequest({
    requestId: `CONTROLLER-CHECK-${controllerDigest({candidate, checks, taskKind}).slice(0, 32).toUpperCase()}`,
    requesterId: "AGENTOS_CONTROLLER",
    lane: "CONTROLLER_CHECKS",
    repositoryId,
    worktreeId,
    candidateCommit: candidate.commit,
    candidateTreeOrDigest: candidate.tree,
    cleanState: candidate.clean,
    resourceClass: checks.some((check) => /(?:build|compile|test|verify|integration|database|artifact|runtime)/iu.test(check))
      ? "COMPILE_HEAVY"
      : "LIGHTWEIGHT_SOURCE_CHECK",
    workingDirectoryRef: opaqueSchedulerWorktreeRef(worktreePath),
    commandArgv: ["AGENTOS_CONTROLLER_CHECK_PLAN", ...checks],
    toolchainProfile: "NODE_CONTROLLER_CHECKS",
    proofClass: "TEST_BATCH",
    whyNeeded: "RUN_CONTROLLER_CHECK_PLAN",
    expectedProof: "ALL_COMMANDS_EXIT_ZERO",
    coverage: checks.map((check) => `CHECK-${controllerDigest(check).slice(0, 16).toUpperCase()}`).sort(),
    timeoutClass: "BOUNDED",
    cachePolicy: "NO_SHARED_OUTPUT",
    secretPolicy: "REDACTED",
  });
  const execute = () => {
    for (const check of checks) {
      const {program, args} = parseCheckCommand(check);
      execFileSync(program, args, {cwd: worktreePath, encoding: "utf8", maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"]});
    }
    return checks;
  };
  return scheduler.runSync({
    request,
    admission: {
      effectiveArgv: request.command_argv,
      workingDirectory: worktreePath,
      workingDirectoryRef: request.working_directory_ref,
      allowedScope: ["."],
      dependencyPreflight: () => ({status: "READY", identity: `DEPENDENCY_${request.request_sha256.slice(0, 24).toUpperCase()}`}),
      runtimePreflight: () => ({status: "READY", identity: `RUNTIME_${request.request_sha256.slice(0, 24).toUpperCase()}`}),
    },
    resolveCandidate: () => schedulerCandidateIdentity(worktreePath),
    execute,
  }).output ?? checks;
}

function runControllerChecks({scheduler, repositoryRoot, worktreePath, taskKind = "CONTROLLER_SUPERVISOR_REPAIR"}) {
  return runScheduledControllerChecks({scheduler, repositoryRoot, worktreePath, checks: controllerCheckList(taskKind), taskKind});
}

function runControllerWorkflowAuditChecks({scheduler, repositoryRoot, worktreePath}) {
  const checks = [
    ...controllerCheckList(),
    "node tests/verify-owner-conversation-surface.mjs",
    "node tests/verify-owner-review.mjs",
    "node tests/verify-bootstrap-delivery-finish.mjs",
  ];
  return runScheduledControllerChecks({scheduler, repositoryRoot, worktreePath, checks, taskKind: "CONTROLLER_WORKFLOW_AUDIT"});
}

function runCampaignProgressChecks({scheduler, repositoryRoot, worktreePath}) {
  const checks = [
    "node --check control/governance-decision-tree.mjs",
    "node tests/verify-governance-decision-tree.mjs",
    "node --check control/controller-supervisor.mjs",
    "node tests/verify-controller-supervisor.mjs",
  ];
  return runScheduledControllerChecks({scheduler, repositoryRoot, worktreePath, checks, taskKind: "CAMPAIGN_PROGRESS_CHECK"});
}

function permissionsFrom(handoff, activation) {
  const permissions = activation?.permissions ?? handoff.boundary ?? {};
  return {
    local_development_writes_allowed: permissions.local_development_writes_allowed === true,
    local_worker_agent_spawns_allowed: permissions.local_worker_agent_spawns_allowed === true,
    product_writes_allowed: permissions.product_writes_allowed === true,
    product_agent_spawns_allowed: permissions.product_agent_spawns_allowed === true,
    external_deployment_allowed: permissions.external_deployment_allowed === true,
    external_release_allowed: permissions.external_release_allowed === true,
    external_publication_allowed: permissions.external_publication_allowed === true,
    external_push_allowed: permissions.external_push_allowed === true,
    external_merge_allowed: permissions.external_merge_allowed === true,
    secrets_allowed: permissions.secrets_allowed === true,
    destructive_work_allowed: permissions.destructive_work_allowed === true,
  };
}

function adoptFeatureCheckpoint({repositoryRoot, sourceCommit, sourceTree, featureCommit, featureTree}) {
  assert(git(repositoryRoot, ["status", "--porcelain", "--untracked-files=all"]) === "", "Controller finalizer requires a clean development copy");
  assert(git(repositoryRoot, ["rev-parse", "HEAD"]) === sourceCommit, "Controller finalizer source commit changed during the route");
  assert(git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]) === sourceTree, "Controller finalizer source tree changed during the route");
  let isDescendant = false;
  try {
    execFileSync("git", ["-C", repositoryRoot, "merge-base", "--is-ancestor", sourceCommit, featureCommit], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    isDescendant = true;
  } catch {
    isDescendant = false;
  }
  assert(isDescendant, "Controller finalizer will not adopt a Feature-Agent checkpoint outside the current source line");
  execFileSync("git", ["-C", repositoryRoot, "merge", "--ff-only", featureCommit], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  const activeCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const activeTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
  assert(activeCommit === featureCommit && activeTree === featureTree, "Controller finalizer adoption readback differs from the audited Feature-Agent checkpoint");
  return {
    status: "ADOPTED_AUDITED_FEATURE_CHECKPOINT",
    source_commit: sourceCommit,
    source_tree: sourceTree,
    adopted_commit: activeCommit,
    adopted_tree: activeTree,
    pushed: false,
    external_action: false,
  };
}

function compileSupervisorHandoff({previous, goal, status, sourceCommit, sourceTree, nextAction, permissions, repair = null, finalizer = null, lifecycleResolutionSha256 = null, supervisedSessions = [], preservedFailureRcas = []}) {
  return {
    schema: "agentos.controller_autonomous_supervisor_handoff.v1",
    version: 1,
    status,
    controller_role: "AGENTOS_CONTROLLER",
    controller_display_name: previous.controller_display_name ?? "Intent Regulator",
    project_id: previous.project_id ?? goal.project_id,
    campaign_id: goal.campaign_id,
    campaign_version: goal.campaign_version,
    goal_id: goal.goal_id,
    goal_sha256: goal.goal_sha256,
    campaign_active: true,
    parent_repair_handoff_sha256: previous.handoff_sha256,
    source_checkpoint: {
      commit: sourceCommit,
      tree: sourceTree,
      clean: true,
      pushed: false,
    },
    repair,
    finalizer,
    lifecycle_resolution_sha256: lifecycleResolutionSha256,
    supervised_sessions: supervisedSessions,
    preserved_failure_rcas: [...new Set([
      ...(Array.isArray(previous.preserved_failure_rcas) ? previous.preserved_failure_rcas : []),
      ...preservedFailureRcas,
    ])].sort(),
    boundary: permissions,
    next_action: nextAction,
    owner_decision_required: false,
    undo: [
      "Keep the adopted local checkpoint and exact route evidence unless the owner directs a local revert.",
      "Do not delete retained failed attempts or alter protected external state as part of undo.",
      "Do not touch a sterile release copy or perform external actions.",
    ],
    handoff_sha256: null,
  };
}

function compileLifecycleResolution({goal, finding, sourceCommit, sourceTree, taskId, featureCommit, featureTree, auditorCommit, auditorTree, controllerRecheckSha256, finalizerSha256}) {
  return {
    schema: "agentos.controller_autonomous_supervisor_lifecycle_resolution.v1",
    version: 1,
    status: "RESOLVED",
    controller_role: "AGENTOS_CONTROLLER",
    campaign_id: goal.campaign_id,
    campaign_version: goal.campaign_version,
    finding_id: finding.finding_id,
    source_finding_sha256: finding.source_sha256,
    parent_handoff_sha256: goal.parent_handoff_sha256,
    task_id: taskId,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    feature_commit: featureCommit,
    feature_tree: featureTree,
    auditor_commit: auditorCommit,
    auditor_tree: auditorTree,
    controller_recheck_sha256: controllerRecheckSha256,
    finalizer_sha256: finalizerSha256,
    next_action: "RECONCILE_DURABLE_SESSION_LIVENESS",
    owner_decision_required: false,
    external_actions_attempted: false,
    resolution_sha256: null,
  };
}

export async function createControllerSupervisorAdapter({runtimeRoot, repoRoot, schedulerRoot = null, schedulerPolicy = null}) {
  const campaignRoot = safeRoot(runtimeRoot, "local supervisor campaign root");
  const repositoryRoot = safeRoot(repoRoot, "local supervisor repository root");
  const schedulerOptions = {authorityRoot: schedulerRoot ?? path.join(campaignRoot, "scheduler-authority")};
  if (schedulerPolicy !== null) schedulerOptions.policy = schedulerPolicy;
  const controllerScheduler = createHybridScheduler(schedulerOptions);
  const handoffPath = path.join(campaignRoot, "autonomous-supervisor-handoff.json");

  function observe() {
    const handoff = readCurrentHandoff(campaignRoot, handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const candidate = readOptional(campaignRoot, "candidate.json");
    const gateFinding = readOptional(campaignRoot, "gate-evidence-anti-drift-rca.json");
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const observedAtUtc = new Date().toISOString();
    const executionContext = handoff.campaign_active
      ? readCampaignExecutionContext({campaignRoot, handoff, sourceCommit, sourceTree})
      : null;
    const campaignProgress = handoff.campaign_active
      ? readCampaignProgress(campaignRoot, handoff.campaign_id, handoff.campaign_version)
      : null;
    const planningProgress = handoff.campaign_active
      ? readControllerPlanningProgress(campaignRoot, handoff.campaign_id, handoff.campaign_version)
      : null;
    const checkpointOnCurrentSource = campaignProgress === null
      ? false
      : isAncestor(repositoryRoot, campaignProgress.source_commit, sourceCommit);
    const taskQueue = handoff.campaign_active
      ? ensureAutonomousTaskQueue({campaignRoot, repositoryRoot, handoff, sourceCommit, sourceTree, campaignProgress, checkpointOnCurrentSource, executionContext})
      : null;
    const permissions = permissionsFrom(handoff, activation);
    const lifecycle = gateFinding?.lifecycle_roi_finding ?? null;
    const lifecycleResolution = lifecycle === null ? null : readAddressed(campaignRoot, `autonomous-supervisor-lifecycle-resolutions/${lifecycle.finding_id}.json`, "resolution_sha256");
    const lifecycleResolved = lifecycleResolution?.status === "RESOLVED" && lifecycleResolution.source_finding_sha256 === gateFinding?.finding_sha256;
    const findings = [];
    const gateEvidenceResolution = gateFinding?.finding_id === undefined
      ? null
      : readAddressed(campaignRoot, `autonomous-supervisor-lifecycle-resolutions/${gateFinding.finding_id}.json`, "resolution_sha256");
    const gateEvidenceResolved = gateEvidenceResolution?.status === "RESOLVED" && gateEvidenceResolution.source_finding_sha256 === gateFinding?.finding_sha256;
    if (gateFinding?.status === "OPEN_BLOCKS_ACCEPTANCE" && !gateEvidenceResolved) findings.push({
      finding_id: gateFinding.finding_id,
      classification: gateFinding.classification,
      status: "OPEN_REPAIR_REQUIRED",
      summary: gateFinding.next_action ?? gateFinding.symptom,
      source_sha256: gateFinding.finding_sha256,
    });
    if (lifecycle && lifecycle.status !== "RESOLVED" && !lifecycleResolved) findings.push({
      finding_id: lifecycle.finding_id,
      classification: lifecycle.classification,
      status: lifecycle.status,
      summary: lifecycle.symptom,
      source_sha256: gateFinding.finding_sha256,
    });
    const bindingFinding = controllerSupervisorBindingFinding(repositoryRoot);
    const bindingResolution = bindingFinding === null ? null : readAddressed(campaignRoot, `autonomous-supervisor-lifecycle-resolutions/${bindingFinding.finding_id}.json`, "resolution_sha256");
    if (bindingFinding !== null && !(bindingResolution?.status === "RESOLVED" && bindingResolution.source_finding_sha256 === bindingFinding.source_sha256)) {
      findings.push({
        finding_id: bindingFinding.finding_id,
        classification: bindingFinding.classification,
        status: bindingFinding.status,
        summary: bindingFinding.summary,
        source_sha256: bindingFinding.source_sha256,
      });
    }
    const localAgentSessionBinding = localAgentSessionBindingFinding(repositoryRoot);
    const localAgentSessionBindingResolution = localAgentSessionBinding === null ? null : readAddressed(campaignRoot, `autonomous-supervisor-lifecycle-resolutions/${localAgentSessionBinding.finding_id}.json`, "resolution_sha256");
    if (localAgentSessionBinding !== null && !(localAgentSessionBindingResolution?.status === "RESOLVED" && localAgentSessionBindingResolution.source_finding_sha256 === localAgentSessionBinding.source_sha256)) {
      findings.push({
        finding_id: localAgentSessionBinding.finding_id,
        classification: localAgentSessionBinding.classification,
        status: localAgentSessionBinding.status,
        summary: localAgentSessionBinding.summary,
        source_sha256: localAgentSessionBinding.source_sha256,
      });
    }
    const ownerSurfaceFinding = ownerConversationSurfaceFinding(repositoryRoot);
    if (ownerSurfaceFinding !== null) findings.push(ownerSurfaceFinding);
    const boundaryPrecedenceFinding = controllerBoundaryPrecedenceFinding(repositoryRoot);
    if (boundaryPrecedenceFinding !== null) {
      const boundaryPrecedenceResolutionPath = "autonomous-supervisor-lifecycle-resolutions/" + boundaryPrecedenceFinding.finding_id + ".json";
      const boundaryPrecedenceResolution = readAddressed(campaignRoot, boundaryPrecedenceResolutionPath, "resolution_sha256");
      if (!(boundaryPrecedenceResolution?.status === "RESOLVED" && boundaryPrecedenceResolution.source_finding_sha256 === boundaryPrecedenceFinding.source_sha256)) {
        findings.push(boundaryPrecedenceFinding);
      }
    }
    const durableSessionFinding = durableSessionTestFinding(campaignRoot);
    if (durableSessionFinding !== null) {
      findings.push({
        finding_id: durableSessionFinding.finding_id,
        classification: durableSessionFinding.classification,
        status: durableSessionFinding.status,
        summary: durableSessionFinding.summary,
        source_sha256: durableSessionFinding.source_sha256,
      });
    }
    const durableSessionLiveness = durableSessionLivenessFinding({campaignRoot, handoff, repositoryRoot, sourceCommit, sourceTree, observedAtUtc});
    if (durableSessionLiveness !== null) findings.push(durableSessionLiveness);
    const campaignProgressStall = autonomousCampaignProgressStallFinding({
      campaignRoot,
      handoff,
      campaignProgress,
      checkpointOnCurrentSource,
      taskQueue,
      sourceCommit,
      sourceTree,
    });
    if (campaignProgressStall !== null) findings.push(campaignProgressStall);
    const campaignContinuation = autonomousCampaignContinuationFinding({
      handoff,
      campaignProgress,
      checkpointOnCurrentSource,
      taskQueue,
      sourceCommit,
      sourceTree,
    });
    if (campaignContinuation !== null) findings.push(campaignContinuation);
    findings.sort((left, right) => compareFindingIds(left.finding_id, right.finding_id));
    const autonomousFinding = autonomousTaskFinding({
      campaignRoot,
      handoff,
      activation,
      findings,
      activeCampaign: handoff.campaign_active === true,
    });
    if (autonomousFinding !== null) findings.push(autonomousFinding);
    findings.sort((left, right) => compareFindingIds(left.finding_id, right.finding_id));
    const ownerDecisionRequired = handoff.owner_decision_required === true;
    return compileSupervisorObservation({
      controllerDisplayName: handoff.controller_display_name ?? "Intent Regulator",
      projectId: handoff.project_id ?? candidate?.project_id ?? "PROJECT",
      campaignId: handoff.campaign_id,
      campaignVersion: handoff.campaign_version,
      activeCampaign: handoff.campaign_active === true,
      ownerDecisionRequired,
      boundary: {
        hard_stop: ownerDecisionRequired,
        soft_review: handoff.scope_changed === true,
        owner_decision_required: ownerDecisionRequired,
        scope_changed: handoff.scope_changed === true,
        ...permissions,
      },
      findings,
      nextAction: planningProgress?.status === "IN_PROGRESS" ? planningProgress.next_action : handoff.next_action,
      sourceCommit,
      sourceTree,
      parentHandoffSha256: handoff.handoff_sha256,
      observedAtUtc,
    });
  }

  async function routeRepair(goal) {
    const handoff = readCurrentHandoff(campaignRoot, handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const gateFinding = readJson(path.join(campaignRoot, "gate-evidence-anti-drift-rca.json"));
    const lifecycleFinding = gateFinding.lifecycle_roi_finding;
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const observedAtUtc = new Date().toISOString();
    const executionContext = readCampaignExecutionContext({campaignRoot, handoff, sourceCommit, sourceTree});
    const candidate = executionContext.candidate;
    const autonomousTaskFindingId = goal.finding_ids.find((findingId) => findingId.startsWith("F-AUTONOMOUS-TASK-"));
    const autonomousTaskQueue = autonomousTaskFindingId === undefined
      ? null
      : readAutonomousTaskQueue(campaignRoot, handoff.campaign_id, handoff.campaign_version);
    const autonomousTaskId = autonomousTaskFindingId?.slice("F-AUTONOMOUS-TASK-".length) ?? null;
    const autonomousTask = autonomousTaskQueue?.tasks.find((task) => task.task_id === autonomousTaskId) ?? null;
    const campaignProgressTask = autonomousTask?.task_id.startsWith("CAMPAIGN-PROGRESS-BUILD-") === true;
    const ownerFeedbackTask = autonomousTask?.task_id.startsWith("CAMPAIGN-OWNER-FEEDBACK-") === true;
    const ownerFeedbackId = ownerFeedbackTask ? autonomousTask.task_id.match(/(FEEDBACK-\d+)/u)?.[1] ?? null : null;
    const ownerFeedbackItem = ownerFeedbackId === null ? null : nextOpenOwnerFeedbackItem(repositoryRoot);
    if (ownerFeedbackTask) assert(ownerFeedbackItem?.id === ownerFeedbackId, "selected owner feedback item is no longer open");
    const existingCampaignProgress = readCampaignProgress(campaignRoot, handoff.campaign_id, handoff.campaign_version);
    const checkpointOnCurrentSource = existingCampaignProgress !== null && isAncestor(repositoryRoot, existingCampaignProgress.source_commit, sourceCommit);
    const currentTaskQueue = autonomousTaskQueue ?? readAutonomousTaskQueue(campaignRoot, handoff.campaign_id, handoff.campaign_version);
    const campaignProgressStall = autonomousCampaignProgressStallFinding({
      campaignRoot,
      handoff,
      campaignProgress: existingCampaignProgress,
      checkpointOnCurrentSource,
      taskQueue: currentTaskQueue,
      sourceCommit,
      sourceTree,
    });
    const campaignContinuation = autonomousCampaignContinuationFinding({
      handoff,
      campaignProgress: existingCampaignProgress,
      checkpointOnCurrentSource,
      taskQueue: currentTaskQueue,
      sourceCommit,
      sourceTree,
    });
    const bindingFinding = controllerSupervisorBindingFinding(repositoryRoot);
    const localAgentSessionBinding = localAgentSessionBindingFinding(repositoryRoot);
    const ownerSurfaceFinding = ownerConversationSurfaceFinding(repositoryRoot);
    const boundaryPrecedenceFinding = controllerBoundaryPrecedenceFinding(repositoryRoot);
    const durableSessionFinding = durableSessionTestFinding(campaignRoot);
    const durableSessionLiveness = durableSessionLivenessFinding({campaignRoot, handoff, repositoryRoot, sourceCommit, sourceTree});
    if (goal.finding_ids.includes("F-DURABLE-SESSION-LIVENESS") && durableSessionLiveness !== null) return routeLiveness(goal);
    const governanceEvidenceRepair = goal.finding_ids.includes(gateFinding.finding_id);
    const governanceEvidenceFinding = governanceEvidenceRepair ? {
      finding_id: gateFinding.finding_id,
      classification: gateFinding.classification,
      status: "OPEN_REPAIR_REQUIRED",
      summary: gateFinding.next_action ?? gateFinding.symptom,
      source_sha256: gateFinding.finding_sha256,
    } : null;
    const repairKind = governanceEvidenceRepair
      ? "GOVERNANCE_EVIDENCE_REPAIR"
      : campaignProgressTask
      ? "CAMPAIGN_PROGRESS_BUILD"
      : ownerFeedbackTask
      ? "OWNER_FEEDBACK_REPAIR"
      : goal.finding_ids.includes(campaignProgressStall?.finding_id)
      ? "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
      : goal.finding_ids.includes(campaignContinuation?.finding_id)
      ? "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
      : goal.finding_ids.includes(boundaryPrecedenceFinding?.finding_id)
      ? "CONTROLLER_SUPERVISOR_REPAIR"
      : goal.finding_ids.includes(ownerSurfaceFinding?.finding_id)
      ? "OWNER_CONVERSATION_SURFACE_REPAIR"
      : goal.finding_ids.includes(durableSessionLiveness?.finding_id)
      ? "DURABLE_SESSION_LIVENESS_REPAIR"
      : goal.finding_ids.includes(durableSessionFinding?.finding_id)
      ? "DURABLE_SESSION_TEST_ROOT_REPAIR"
      : goal.finding_ids.includes(bindingFinding?.finding_id)
        ? "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
        : goal.finding_ids.includes(localAgentSessionBinding?.finding_id)
          ? "LOCAL_AGENT_SESSION_BINDING_REPAIR"
        : "CONTROLLER_SUPERVISOR_REPAIR";
    const routeFinding = governanceEvidenceRepair
      ? governanceEvidenceFinding
      : campaignProgressTask
      ? {
        finding_id: autonomousTaskFindingId,
        source_sha256: autonomousTaskQueue.queue_sha256,
        status: "OPEN_NEXT_REQUIRED_BEHAVIOR",
      }
      : ownerFeedbackTask
      ? {
        finding_id: autonomousTaskFindingId,
        source_sha256: autonomousTaskQueue.queue_sha256,
        status: "OPEN_NEXT_REQUIRED_BEHAVIOR",
      }
      : repairKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
      ? campaignProgressStall
      : repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
      ? campaignContinuation
      : goal.finding_ids.includes(boundaryPrecedenceFinding?.finding_id) ? boundaryPrecedenceFinding : repairKind === "OWNER_CONVERSATION_SURFACE_REPAIR" ? ownerSurfaceFinding : repairKind === "DURABLE_SESSION_LIVENESS_REPAIR" ? durableSessionLiveness : repairKind === "DURABLE_SESSION_TEST_ROOT_REPAIR" ? durableSessionFinding : repairKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR" ? bindingFinding : repairKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR" ? localAgentSessionBinding : {
      finding_id: lifecycleFinding?.finding_id,
      source_sha256: gateFinding.finding_sha256,
      status: lifecycleFinding?.status,
    };
    const bindingRepair = repairKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR" || repairKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR";
    const permissions = permissionsFrom(handoff, activation);
    assert(permissions.local_development_writes_allowed && permissions.local_worker_agent_spawns_allowed, "local Controller route lacks local development authorization");
    assert(!permissions.product_writes_allowed && !permissions.product_agent_spawns_allowed, "local Controller route cannot enter Product custody");
    assert(!permissions.external_deployment_allowed && !permissions.external_release_allowed && !permissions.external_publication_allowed && !permissions.external_push_allowed && !permissions.external_merge_allowed, "local Controller route cannot perform external actions");
    const previousSessions = sessionEntries(campaignRoot, handoff);
    const unhealthySessionRca = recordUnhealthySessionRca({campaignRoot, handoff, entries: previousSessions, sourceCommit, sourceTree});
    reconcileExitedSessionRecords(previousSessions);
    for (const entry of previousSessions) {
      if (["RUNNING", "STARTING"].includes(entry.record.status) && processAlive(entry.record.pid)) await stopDurableWorkerSession({sessionRecordPath: entry.target});
    }
    const taskPrefix = governanceEvidenceRepair
      ? "TASK-GOVERNANCE-EVIDENCE"
      : campaignProgressTask
      ? "TASK-CAMPAIGN-PROGRESS"
      : ownerFeedbackTask
      ? "TASK-OWNER-FEEDBACK"
      : repairKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
      ? "TASK-AUTONOMOUS-CAMPAIGN-PROGRESS"
      : repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
      ? "TASK-AUTONOMOUS-CAMPAIGN-CONTINUATION"
      : repairKind === "DURABLE_SESSION_LIVENESS_REPAIR"
      ? "TASK-DURABLE-SESSION-LIVENESS"
      : "TASK-CONTROLLER-SUPERVISOR";
    const taskId = `${taskPrefix}-${goal.goal_sha256.slice(0, 16).toUpperCase()}`;
    writeControllerPlanningProgress({
      campaignRoot,
      goal,
      taskId,
      sourceCommit,
      sourceTree,
      phase: "ORCHESTRATOR_REVIEW",
      message: "The Controller has selected a bounded repair and started the campaign handoff.",
      nextAction: "The Campaign Orchestrator is selecting the exact repair; no Product or external work is allowed.",
    });
    const taskRecordPath = `autonomous-supervisor-tasks/${taskId}.json`;
    const task = writeAddressed(campaignRoot, taskRecordPath, {
      schema: "agentos.controller_autonomous_supervisor_task.v1",
      version: 1,
      status: "ROUTED_TO_DURABLE_CAMPAIGN_ROLES",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "Intent Regulator",
      project_id: goal.project_id,
      campaign_id: goal.campaign_id,
      campaign_version: goal.campaign_version,
      task_id: taskId,
      task_kind: repairKind,
      goal_id: goal.goal_id,
      goal_sha256: goal.goal_sha256,
      parent_handoff_sha256: goal.parent_handoff_sha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      scope: campaignProgressTask
        ? ["acceptance-contract.json", "decision-tree-requirement.json", "decision-tree.json", "owner-intent.json", "scope.json"].sort()
        : ownerFeedbackTask
        ? ["control/check-runner.mjs", "control/local-agent-runtime.mjs", "control/local-campaign-admission.mjs", "control/local-self-development-supervisor-adapter.mjs", "control/owner-feedback-check-repair-receipt.mjs", "control/owner-feedback-continuation-repair-receipt.mjs", "control/owner-feedback-digest-repair-receipt.mjs", "control/owner-feedback-execution-boundary-repair-receipt.mjs", "control/owner-feedback-inactive-explanation-repair-receipt.mjs", "control/owner-feedback-progress-repair-receipt.mjs", "control/owner-feedback-status-reconciliation-repair-receipt.mjs", "control/task-run-loop.mjs", "docs/owner-feedback-backlog.md", "schemas/bootstrap-binding.v1.json", "tests/verify-local-agent-session.mjs", "tests/verify-owner-feedback-backlog.mjs", "tests/verify-owner-feedback-check-repair.mjs", "tests/verify-owner-feedback-continuation.mjs", "tests/verify-owner-feedback-digest.mjs", "tests/verify-owner-feedback-execution-boundary.mjs", "tests/verify-owner-feedback-progress.mjs", "tests/verify-task-run-loop.mjs"].sort()
        : governanceEvidenceRepair
        ? ["control/feature-agent-governance-evidence-repair.mjs", "control/governance-decision-tree.mjs", "control/governance-evidence.mjs", "control/local-agent-worker.mjs", "tests/verify-governance-decision-tree.mjs", "tests/verify-local-campaign-admission.mjs"].sort()
        : repairKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
        ? ["control/bootstrap-compiler.mjs", "control/owner-review.mjs", "schemas/bootstrap-binding.v1.json", "tests/verify-owner-conversation-surface.mjs", "tests/verify-owner-review.mjs"].sort()
        : repairKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
        ? ["control/local-self-development-supervisor-adapter.mjs"].sort()
        : repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
        ? ["control/local-self-development-supervisor-adapter.mjs", "tests/verify-controller-supervisor.mjs"].sort()
        : repairKind === "DURABLE_SESSION_LIVENESS_REPAIR"
        ? ["control/local-agent-runtime.mjs", "tests/verify-local-agent-session.mjs"].sort()
        : repairKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
        ? ["tests/verify-local-agent-session.mjs"].sort()
        : bindingRepair
        ? ["schemas/bootstrap-binding.v1.json", "control/controller-supervisor.mjs", "tests/verify-all.mjs"].sort()
        : ["control/controller-supervisor.mjs", "control/controller-supervisor-runtime.mjs", "control/local-agent-session.mjs", "schemas/bootstrap-binding.v1.json", "tests/verify-controller-supervisor.mjs"].sort(),
      protected_boundaries: permissions,
      record_sha256: null,
    });
    let orchestrator;
    let feature;
    let governanceEvidenceDecisionTreePath = null;
    if (governanceEvidenceRepair) {
      feature = await startDurableWorkerSession({
        repoRoot: repositoryRoot,
        runtimeRoot: campaignRoot,
        role: "FEATURE_AGENT",
        campaignId: goal.campaign_id,
        campaignVersion: goal.campaign_version,
        candidateSha256: candidate.candidate_sha256,
        sourceCommit,
        sourceTree,
        task: "Replace placeholder governance gate answers with real source-bound command and readback evidence, then run the strict evidence checks.",
        taskId,
        taskKind: repairKind,
      });
      const featureCheckpoint = feature.readback;
      const repairTree = compileGovernanceDecisionTree({
        sourceCommit: featureCheckpoint.build_commit,
        sourceTree: featureCheckpoint.build_tree,
        ownerIntentSha256: executionContext.ownerIntent.owner_intent_sha256,
        scopeSha256: executionContext.scope.scope_sha256,
        featureFiles: [...new Set([
          ...executionContext.scope.changed_paths,
          "control/governance-evidence.mjs",
        ])].sort(),
      });
      const repairTreeRecordPath = `autonomous-supervisor-context/${featureCheckpoint.build_commit}-governance-evidence-decision-tree.json`;
      writeAddressed(campaignRoot, repairTreeRecordPath, repairTree, "tree_sha256");
      governanceEvidenceDecisionTreePath = path.join(campaignRoot, repairTreeRecordPath);
      orchestrator = await startDurableWorkerSession({
        repoRoot: repositoryRoot,
        runtimeRoot: campaignRoot,
        role: "CAMPAIGN_ORCHESTRATOR",
        campaignId: goal.campaign_id,
        campaignVersion: goal.campaign_version,
        candidateSha256: candidate.candidate_sha256,
        sourceCommit: featureCheckpoint.build_commit,
        sourceTree: featureCheckpoint.build_tree,
        task: "Run every governance gate against the repaired source and return actual passing command and readback evidence.",
        taskId: `${taskId}-ORCHESTRATOR`,
        taskKind: "GOVERNANCE_EVIDENCE_RECHECK",
        decisionTreePath: governanceEvidenceDecisionTreePath,
        workerScriptPath: path.join(feature.session_record.worktree_path, "control/local-agent-worker.mjs"),
      });
    } else {
      orchestrator = await startDurableWorkerSession({
        repoRoot: repositoryRoot,
        runtimeRoot: campaignRoot,
        role: "CAMPAIGN_ORCHESTRATOR",
        campaignId: goal.campaign_id,
        campaignVersion: goal.campaign_version,
        candidateSha256: candidate.candidate_sha256,
        sourceCommit,
        sourceTree,
        task: campaignProgressTask
          ? `Read the bound owner intent, scope, acceptance contract, and executable decision tree. Select the next bounded control-plane repair for the first useful workflow: ${executionContext.firstUsefulWorkflow}. Return the exact Feature-Agent handoff without expanding scope.`
          : ownerFeedbackTask
          ? `Read owner feedback ${ownerFeedbackItem.id}: ${ownerFeedbackItem.symptom} The expected behavior is: ${ownerFeedbackItem.expected_behavior} Select the exact bounded repair and keep the work inside the existing control-plane scope.`
          : repairKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
          ? "Inspect the completed self-audit and return the exact bounded handoff for repairing the Controller queue so it mints the next campaign behavior."
          : repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
          ? "Inspect the held completion state and return the exact bounded handoff that lets the Controller choose one next safe control-plane behavior without an outside prompt."
          : "Supervise the bounded Controller supervisor repair and return the exact role handoff.",
        taskId: `${taskId}-ORCHESTRATOR`,
        taskKind: campaignProgressTask || repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR" ? "CAMPAIGN_PROGRESS_ORCHESTRATE" : "CONTROLLER_SUPERVISOR_ORCHESTRATE",
        decisionTreePath: campaignProgressTask || repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR" ? path.join(campaignRoot, executionContext.decisionTreePath) : null,
      });
      feature = await startDurableWorkerSession({
        repoRoot: repositoryRoot,
        runtimeRoot: campaignRoot,
        role: "FEATURE_AGENT",
        campaignId: goal.campaign_id,
        campaignVersion: goal.campaign_version,
        candidateSha256: candidate.candidate_sha256,
        sourceCommit,
        sourceTree,
        task: campaignProgressTask
          ? "Build the next bounded AgentOS control-plane repair selected from the bound first useful workflow. Change only declared control-plane files, run focused checks, and return a real clean commit and tree."
          : ownerFeedbackTask
          ? `Implement the exact bounded repair for owner feedback ${ownerFeedbackItem.id}: ${ownerFeedbackItem.expected_behavior} Update the feedback record only when the repair and its focused checks are complete; return a clean source-bound commit and tree.`
          : repairKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
          ? "Repair the Controller queue so a completed self-audit mints the next bounded self-development behavior from the owner’s ongoing intent, then run the focused checks."
          : repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
          ? "Repair the Controller queue so a completed local checkpoint selects one bounded next control-plane behavior instead of falsely waiting for a new prompt, then run the focused checks."
          : goal.finding_ids.includes(boundaryPrecedenceFinding?.finding_id)
          ? "Make every open hard security or owner boundary stop before any soft-scope review, then run the focused Controller checks."
          : repairKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
          ? "Keep Bootstrap and the ongoing owner review casual and nontechnical while preserving the typed internal plan, then return exact focused evidence."
          : repairKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
          ? "Repair the durable-session verifier so it creates its temporary folder in an isolated worktree, then run its focused check."
          : repairKind === "DURABLE_SESSION_LIVENESS_REPAIR"
          ? "Repair durable session recovery so an exited worker is retained as failed instead of being mistaken for a running session, then run the focused durability checks."
          : bindingRepair
            ? "Repair the exact changed repository binding in isolated Feature-Agent custody, then run the full repository checks."
          : "Repair the Controller supervisor boundary classification in isolated Feature-Agent custody, then run its focused checks.",
        taskId,
        taskKind: repairKind,
      });
    }
    writeControllerPlanningProgress({
      campaignRoot,
      goal,
      taskId,
      sourceCommit,
      sourceTree,
      phase: "INDEPENDENT_AUDIT",
      message: "The bounded build is complete and the independent audit is running against the same source.",
      nextAction: "The Independent Auditor is checking the exact files, checks, source identity, and boundaries.",
    });
    const featureReadback = feature.readback;
    const auditorTaskKind = governanceEvidenceRepair ? "GOVERNANCE_EVIDENCE_RECHECK" : repairKind;
    const auditorSourceCommit = governanceEvidenceRepair ? featureReadback.build_commit : sourceCommit;
    const auditorSourceTree = governanceEvidenceRepair ? featureReadback.build_tree : sourceTree;
    const auditor = await startDurableWorkerSession({
      repoRoot: repositoryRoot,
      runtimeRoot: campaignRoot,
      role: "INDEPENDENT_AUDITOR",
      campaignId: goal.campaign_id,
      campaignVersion: goal.campaign_version,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit: auditorSourceCommit,
      sourceTree: auditorSourceTree,
        task: governanceEvidenceRepair
        ? "Independently verify every governance gate evidence record and exact evaluation against the repaired Feature-Agent checkpoint."
        : campaignProgressTask
        ? "Independently inspect the Feature-Agent changed tree and verify the same source-bound commit, tree, changed files, focused checks, and protected boundaries."
        : ownerFeedbackTask
        ? `Independently inspect the Feature-Agent repair for owner feedback ${ownerFeedbackItem.id}. Verify the exact changed files, focused checks, source identity, and that the feedback item was closed only after the repair passed.`
        : repairKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
        ? "Independently inspect the Feature-Agent queue-state repair and verify that the completed self-audit cannot leave the active campaign without a next bounded behavior."
        : repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
        ? "Independently inspect the Feature-Agent continuation repair and verify that an active authorized campaign selects one bounded next behavior without inventing Product work or bypassing boundaries."
        : goal.finding_ids.includes(boundaryPrecedenceFinding?.finding_id)
        ? "Independently verify that every open hard security or owner boundary stops before any soft-scope review."
        : repairKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
        ? "Independently inspect the Feature-Agent repair and verify that Bootstrap and the ongoing owner review keep technical governance wording behind the conversation."
        : repairKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
        ? "Independently inspect the Feature-Agent durable-session verifier repair and return source-bound test evidence."
        : repairKind === "DURABLE_SESSION_LIVENESS_REPAIR"
        ? "Independently inspect the Feature-Agent durable-session recovery repair and verify that an abrupt worker exit is retained and recoverable."
        : bindingRepair
          ? "Independently inspect the Feature-Agent repository binding checkpoint and return full repository audit evidence."
        : "Independently inspect the Feature-Agent Controller supervisor checkpoint and return source-bound audit evidence.",
      taskId: `${taskId}-AUDITOR`,
      taskKind: auditorTaskKind,
      featureWorktree: feature.session_record.worktree_path,
      evidenceWorktree: governanceEvidenceRepair ? orchestrator.session_record.worktree_path : null,
      decisionTreePath: governanceEvidenceRepair ? governanceEvidenceDecisionTreePath : null,
      workerScriptPath: governanceEvidenceRepair ? path.join(feature.session_record.worktree_path, "control/local-agent-worker.mjs") : null,
    });
    writeControllerPlanningProgress({
      campaignRoot,
      goal,
      taskId,
      sourceCommit,
      sourceTree,
      phase: "FINALIZER_REVIEW",
      message: "The audit readback is complete and the Controller is checking the local checkpoint before adoption.",
      nextAction: "The Controller Finalizer is checking the audited checkpoint; external actions remain closed.",
    });
    const controllerChecks = campaignProgressTask
      ? runCampaignProgressChecks({scheduler: controllerScheduler, repositoryRoot, worktreePath: feature.session_record.worktree_path})
      : runControllerChecks({scheduler: controllerScheduler, repositoryRoot, worktreePath: feature.session_record.worktree_path, taskKind: repairKind});
    const auditorReadback = auditor.readback;
    validateLocalWorkerReadback(featureReadback, repairKind);
    validateLocalWorkerReadback(auditorReadback, auditorTaskKind);
    assert(featureReadback.build_commit === auditorReadback.build_commit && featureReadback.build_tree === auditorReadback.build_tree, "Controller supervisor Feature-Agent and Auditor checkpoints differ");
    let governanceEvidenceAudit = null;
    if (governanceEvidenceRepair) {
      const repairTree = readJson(governanceEvidenceDecisionTreePath);
      const orchestratorPlan = readJson(path.join(orchestrator.session_record.worktree_path, orchestrator.readback.artifact_path));
      const auditorArtifact = readJson(path.join(auditor.session_record.worktree_path, auditor.readback.artifact_path));
      const {evaluateGovernanceDecisionTree} = await import(pathToFileURL(path.join(feature.session_record.worktree_path, "control/governance-decision-tree.mjs")).href);
      const controllerEvaluation = evaluateGovernanceDecisionTree({tree: repairTree, answers: orchestratorPlan.gate_answers});
      assert(orchestratorPlan.source_commit === featureReadback.build_commit && orchestratorPlan.source_tree === featureReadback.build_tree, "Controller governance evidence source differs from Feature-Agent checkpoint");
      assert(controllerEvaluation.status === "PASS", "Controller governance evidence re-check did not pass");
      assert(controllerEvaluation.evaluation_sha256 === orchestratorPlan.gate_evaluation?.evaluation_sha256, "Controller governance evaluation differs from Orchestrator evidence");
      assert(auditorArtifact.audit_status === "GOVERNANCE_EVIDENCE_VERIFIED", "Auditor did not return a governance evidence verification");
      assert(auditorArtifact.audited_feature_commit === featureReadback.build_commit && auditorArtifact.audited_feature_tree === featureReadback.build_tree, "Auditor governance evidence source differs from Feature-Agent checkpoint");
      assert(auditorArtifact.audited_gate_evaluation?.evaluation_sha256 === controllerEvaluation.evaluation_sha256, "Controller governance evaluation differs from Auditor evidence");
      assert(controllerDigest(orchestratorPlan.gate_evidence) === controllerDigest(auditorArtifact.audited_gate_evidence), "Controller governance evidence differs from Auditor evidence");
      governanceEvidenceAudit = {
        decision_tree_sha256: repairTree.tree_sha256,
        gate_evidence_sha256: controllerDigest(orchestratorPlan.gate_evidence),
        evaluation_sha256: controllerEvaluation.evaluation_sha256,
        auditor_evidence_sha256: controllerDigest(auditorArtifact.audited_gate_evidence),
      };
    }
    const readbackRoot = `autonomous-supervisor-readbacks/${taskId}`;
    const orchestratorRecordPath = `${readbackRoot}/orchestrator.json`;
    const featureRecordPath = `${readbackRoot}/feature-agent.json`;
    const auditorRecordPath = `${readbackRoot}/auditor.json`;
    const controllerRecordPath = `${readbackRoot}/controller-recheck.json`;
    writeAddressed(campaignRoot, orchestratorRecordPath, {schema: "agentos.controller_autonomous_supervisor_orchestrator_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: orchestrator.session_record.session_id, pid: orchestrator.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: orchestrator.readback, record_sha256: null});
    writeAddressed(campaignRoot, featureRecordPath, {schema: "agentos.controller_autonomous_supervisor_feature_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: feature.session_record.session_id, pid: feature.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: featureReadback, record_sha256: null});
    writeAddressed(campaignRoot, auditorRecordPath, {schema: "agentos.controller_autonomous_supervisor_auditor_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: auditor.session_record.session_id, pid: auditor.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: auditorReadback, record_sha256: null});
    const controllerRecheck = writeAddressed(campaignRoot, controllerRecordPath, {schema: "agentos.controller_autonomous_supervisor_controller_recheck.v1", version: 1, status: "PASS", controller_role: "AGENTOS_CONTROLLER", task_id: taskId, source_commit: sourceCommit, source_tree: sourceTree, feature_commit: featureReadback.build_commit, feature_tree: featureReadback.build_tree, auditor_commit: auditorReadback.build_commit, auditor_tree: auditorReadback.build_tree, checks: controllerChecks, ...(governanceEvidenceAudit === null ? {} : {governance_evidence: governanceEvidenceAudit}), record_sha256: null});
    const finalizerResult = adoptFeatureCheckpoint({
      repositoryRoot,
      sourceCommit,
      sourceTree,
      featureCommit: featureReadback.build_commit,
      featureTree: featureReadback.build_tree,
    });
    const finalizerRecordPath = `autonomous-supervisor-finalizers/${taskId}.json`;
    const finalizerRecord = writeAddressed(campaignRoot, finalizerRecordPath, {
      schema: "agentos.controller_autonomous_supervisor_finalizer_receipt.v1",
      version: 1,
      status: finalizerResult.status,
      controller_role: "AGENTOS_CONTROLLER",
      task_id: taskId,
      parent_handoff_sha256: goal.parent_handoff_sha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      feature_commit: featureReadback.build_commit,
      feature_tree: featureReadback.build_tree,
      auditor_commit: auditorReadback.build_commit,
      auditor_tree: auditorReadback.build_tree,
      controller_recheck_sha256: controllerRecheck.record_sha256,
      adoption: finalizerResult,
      external_actions_attempted: false,
      finalizer_sha256: null,
    }, "finalizer_sha256");
    const adoptedExecutionContext = campaignProgressTask
      ? readCampaignExecutionContext({campaignRoot, handoff, sourceCommit: finalizerResult.adopted_commit, sourceTree: finalizerResult.adopted_tree})
      : null;
    const campaignProgress = campaignProgressTask
      ? writeMutableAddressed(campaignRoot, CAMPAIGN_PROGRESS_FILE, {
        schema: "agentos.controller_autonomous_campaign_progress.v1",
        version: 1,
        status: "CHECKPOINT_READY",
        controller_role: "AGENTOS_CONTROLLER",
        campaign_id: goal.campaign_id,
        campaign_version: goal.campaign_version,
        task_id: autonomousTask.task_id,
        parent_handoff_sha256: goal.parent_handoff_sha256,
        source_commit: finalizerResult.adopted_commit,
        source_tree: finalizerResult.adopted_tree,
        candidate_sha256: adoptedExecutionContext.candidate.candidate_sha256,
        context_sha256: adoptedExecutionContext.context.context_sha256,
        feature_commit: featureReadback.build_commit,
        feature_tree: featureReadback.build_tree,
        auditor_commit: auditorReadback.build_commit,
        auditor_tree: auditorReadback.build_tree,
        controller_recheck_sha256: controllerRecheck.record_sha256,
        finalizer_sha256: finalizerRecord.finalizer_sha256,
        first_useful_workflow_completed: true,
        autonomous_continuation_count: (existingCampaignProgress?.autonomous_continuation_count ?? 0) + (existingCampaignProgress?.first_useful_workflow_completed === true ? 1 : 0),
        next_action: "The owner-defined first useful workflow is complete at an audited local checkpoint; the Controller will remain available for a new bounded intent without prompting for approval.",
        external_actions_attempted: false,
        progress_sha256: null,
      }, "progress_sha256", existingCampaignProgress?.progress_sha256 ?? null)
      : null;
    const completedQueue = campaignProgressTask
      || ownerFeedbackTask
      ? writeMutableAddressed(campaignRoot, AUTONOMOUS_TASK_QUEUE_FILE, {
        ...autonomousTaskQueue,
        tasks: autonomousTaskQueue.tasks.map((taskCandidate) => taskCandidate.task_id === autonomousTask.task_id
          ? {...taskCandidate, status: "COMPLETED"}
          : taskCandidate),
      }, "queue_sha256", autonomousTaskQueue.queue_sha256)
      : null;
    assert(routeFinding?.finding_id && routeFinding.status !== "RESOLVED", "Controller repair route lacks the open finding it was asked to close");
    const resolutionPath = `autonomous-supervisor-lifecycle-resolutions/${routeFinding.finding_id}.json`;
    const lifecycleResolution = writeAddressed(campaignRoot, resolutionPath, compileLifecycleResolution({
      goal,
      finding: routeFinding,
      sourceCommit: finalizerResult.adopted_commit,
      sourceTree: finalizerResult.adopted_tree,
      taskId,
      featureCommit: featureReadback.build_commit,
      featureTree: featureReadback.build_tree,
      auditorCommit: auditorReadback.build_commit,
      auditorTree: auditorReadback.build_tree,
      controllerRecheckSha256: controllerRecheck.record_sha256,
      finalizerSha256: finalizerRecord.finalizer_sha256,
    }), "resolution_sha256");
    writeControllerPlanningProgress({
      campaignRoot,
      goal,
      taskId,
      sourceCommit: finalizerResult.adopted_commit,
      sourceTree: finalizerResult.adopted_tree,
      status: "COMPLETED",
      phase: "COMPLETED",
      message: "The Controller finished the bounded campaign and retained the audited local checkpoint.",
      nextAction: "The Controller will inspect the next bounded item automatically; no outside prompt is needed.",
    });
    const priorPointer = readAddressed(campaignRoot, "autonomous-supervisor-current-handoff.json", "pointer_sha256");
    for (const entry of previousSessions) {
      if (["RUNNING", "STARTING"].includes(entry.record.status) && processAlive(entry.record.pid)) await stopDurableWorkerSession({sessionRecordPath: entry.target});
    }
    const currentSessions = [orchestrator, feature, auditor].map((session) => ({target: sessionRecordPath(session.session_record), record: session.session_record}));
    const transitionedHandoff = compileSupervisorHandoff({
      previous: handoff,
      goal,
      status: campaignProgressTask ? "SUPERVISOR_CAMPAIGN_PROGRESS_ACCEPTED" : "SUPERVISOR_REPAIR_ACCEPTED",
      sourceCommit: finalizerResult.adopted_commit,
      sourceTree: finalizerResult.adopted_tree,
      nextAction: campaignProgressTask
        ? "The owner-defined first useful workflow is complete at an audited local checkpoint; the Controller will remain available for a new bounded intent without prompting for approval."
        : "Intent Regulator reconciles the durable campaign roles at the adopted checkpoint, then continues the next safe control-plane action without an outside prompt.",
      permissions,
        repair: {
        summary: campaignProgressTask
          ? `Carry out the owner-defined first useful workflow: ${executionContext.firstUsefulWorkflow}.`
          : governanceEvidenceRepair
          ? "Replace placeholder governance gate evidence with actual source-bound command and readback evidence, then require exact Orchestrator, Auditor, and Controller re-checks."
          : repairKind === "AUTONOMOUS_CAMPAIGN_PROGRESS_REPAIR"
          ? "Make the active Controller mint the next bounded campaign behavior after a completed self-audit while preserving scope, evidence, and owner boundaries."
          : repairKind === "AUTONOMOUS_CAMPAIGN_CONTINUATION_REPAIR"
          ? "Make the active Controller select one bounded next campaign behavior after a completed local checkpoint instead of waiting for a routine outside prompt."
          : repairKind === "OWNER_FEEDBACK_REPAIR"
          ? `Repair owner feedback ${ownerFeedbackItem.id} through the Orchestrator, Feature Agent, and Auditor, then continue to the next open bounded feedback item.`
          : goal.finding_ids.includes(boundaryPrecedenceFinding?.finding_id)
          ? "Make hard security and owner boundaries take precedence over soft-scope review."
          : repairKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
          ? "Keep Bootstrap and the ongoing owner review in short everyday language while preserving the typed internal plan."
          : repairKind === "DURABLE_SESSION_LIVENESS_REPAIR"
          ? "Make unexpected worker exits change Controller observation, retain the failed session, and recover the three source-bound roles automatically."
          : repairKind === "DURABLE_SESSION_TEST_ROOT_REPAIR"
          ? "Make the durable-session verifier create its temporary root inside every isolated worktree."
          : bindingRepair
            ? repairKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR"
              ? "Restore the exact repository binding for the adopted durable-session verifier and require the full verifier to pass."
              : "Restore the exact repository binding for the adopted Controller supervisor source and require the full verifier to pass."
            : "Replace one-shot Controller supervision with a durable, autonomous observation-to-route loop.",
        changed_paths: [...new Set(featureReadback.changed_paths)].sort(),
        source_commit: sourceCommit,
        source_tree: sourceTree,
        adopted_commit: finalizerResult.adopted_commit,
        adopted_tree: finalizerResult.adopted_tree,
        ...(campaignProgress === null ? {} : {
          campaign_progress_sha256: campaignProgress.progress_sha256,
          completed_task_queue_sha256: completedQueue.queue_sha256,
        }),
      },
      finalizer: {
        record_path: finalizerRecordPath,
        finalizer_sha256: finalizerRecord.finalizer_sha256,
        status: finalizerRecord.status,
      },
      lifecycleResolutionSha256: lifecycleResolution.resolution_sha256,
      supervisedSessions: currentSessions.map((entry) => sessionSummary(campaignRoot, entry)).sort((left, right) => left.session_id.localeCompare(right.session_id)),
      preservedFailureRcas: unhealthySessionRca === null ? [] : [unhealthySessionRca.rca_sha256],
    });
    const transitioned = writeCurrentHandoff(campaignRoot, transitionedHandoff, priorPointer?.pointer_sha256 ?? null);
    return {
      controller_role: "AGENTOS_CONTROLLER",
      status: campaignProgressTask ? "CAMPAIGN_PROGRESS_RECHECKED_AND_ADOPTED" : "ROUTED_CONTROLLER_RECHECKED_AND_ADOPTED",
      task_id: taskId,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      feature_agent_session_id: feature.session_record.session_id,
      feature_agent_pid: feature.session_record.pid,
      feature_commit: featureReadback.build_commit,
      feature_tree: featureReadback.build_tree,
      auditor_session_id: auditor.session_record.session_id,
      auditor_pid: auditor.session_record.pid,
      auditor_commit: auditorReadback.build_commit,
      auditor_tree: auditorReadback.build_tree,
      orchestrator_session_id: orchestrator.session_record.session_id,
      orchestrator_pid: orchestrator.session_record.pid,
      controller_recheck_sha256: controllerRecheck.record_sha256,
      finalizer_sha256: finalizerRecord.finalizer_sha256,
      finalizer_record_path: finalizerRecordPath,
      lifecycle_resolution_sha256: lifecycleResolution.resolution_sha256,
      lifecycle_resolution_path: resolutionPath,
      adopted_commit: finalizerResult.adopted_commit,
      adopted_tree: finalizerResult.adopted_tree,
      semantic_before_sha256: goal.parent_handoff_sha256,
      semantic_after_sha256: transitioned.handoff.handoff_sha256,
      handoff_path: `autonomous-supervisor-handoffs/${transitioned.handoff.goal_id}.json`,
      current_handoff_pointer_sha256: transitioned.pointer.pointer_sha256,
      supervised_session_record_paths: currentSessions.map((entry) => path.relative(campaignRoot, entry.target)).sort(),
      task_record_path: taskRecordPath,
      readback_record_paths: [orchestratorRecordPath, featureRecordPath, auditorRecordPath, controllerRecordPath, finalizerRecordPath, resolutionPath].sort(),
      campaign_progress_sha256: campaignProgress?.progress_sha256 ?? null,
      autonomous_task_queue_sha256: completedQueue?.queue_sha256 ?? null,
      protected_boundaries: permissions,
    };
  }

  async function routeLiveness(goal) {
    const handoff = readCurrentHandoff(campaignRoot, handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const permissions = permissionsFrom(handoff, activation);
    assert(permissions.local_development_writes_allowed && permissions.local_worker_agent_spawns_allowed, "local Controller liveness route lacks local development authorization");
    assert(!permissions.product_writes_allowed && !permissions.product_agent_spawns_allowed, "local Controller liveness route cannot enter Product custody");
    assert(!permissions.external_deployment_allowed && !permissions.external_release_allowed && !permissions.external_publication_allowed && !permissions.external_push_allowed && !permissions.external_merge_allowed, "local Controller liveness route cannot perform external actions");
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const executionContext = readCampaignExecutionContext({campaignRoot, handoff, sourceCommit, sourceTree});
    const candidate = executionContext.candidate;
    const campaignProgress = readCampaignProgress(campaignRoot, handoff.campaign_id, handoff.campaign_version);
    const checkpointOnCurrentSource = campaignProgress === null
      ? false
      : isAncestor(repositoryRoot, campaignProgress.source_commit, sourceCommit);
    const existingSessions = sessionEntries(campaignRoot, handoff);
    const taskQueue = ensureAutonomousTaskQueue({campaignRoot, repositoryRoot, handoff, sourceCommit, sourceTree, campaignProgress, checkpointOnCurrentSource, executionContext});
    const unhealthySessionRca = recordUnhealthySessionRca({campaignRoot, handoff, entries: existingSessions, sourceCommit, sourceTree});
    reconcileExitedSessionRecords(existingSessions);
    const orphanedSessionRca = recordOrphanedSessionRca({campaignRoot, handoff, entries: existingSessions, sourceCommit, sourceTree});
    const retainedFailureRcas = discoverSupervisorSessions(campaignRoot, goal.campaign_id)
      .filter(({record}) => record.status === "FAILED")
      .map((entry) => recordFailedSessionRca(campaignRoot, entry, sourceCommit, sourceTree).rca_sha256)
      .concat(unhealthySessionRca === null ? [] : [unhealthySessionRca.rca_sha256])
      .concat(orphanedSessionRca === null ? [] : [orphanedSessionRca.rca_sha256]);
    const existingRoles = existingSessions.map((entry) => entry.record.role).sort();
    const requiredRoles = [...REQUIRED_CAMPAIGN_ROLES].sort();
    if (existingSessions.length === requiredRoles.length
      && JSON.stringify(existingRoles) === JSON.stringify(requiredRoles)
      && existingSessions.every((entry) => sessionIsHealthy({record: entry.record, sourceCommit, sourceTree, observedAtUtc}))) {
      return {
        controller_role: "AGENTOS_CONTROLLER",
        status: "LIVENESS_HEALTHY",
        source_commit: sourceCommit,
        source_tree: sourceTree,
        discovered_session_count: existingSessions.length,
        stale_session_count: Math.max(0, existingSessions.length - 3),
        stale_session_rca_sha256: orphanedSessionRca?.rca_sha256 ?? null,
        autonomous_task_queue_sha256: taskQueue.queue_sha256,
        retained_failure_rcas: retainedFailureRcas.sort(),
        supervised_sessions: existingSessions.map((entry) => sessionSummary(campaignRoot, entry, observedAtUtc)).sort((left, right) => left.session_id.localeCompare(right.session_id)),
        protected_boundaries: permissions,
      };
    }
    for (const entry of existingSessions) {
      if (["RUNNING", "STARTING"].includes(entry.record.status) && processAlive(entry.record.pid)) await stopDurableWorkerSession({sessionRecordPath: entry.target});
    }
    const taskId = `TASK-CONTROLLER-SUPERVISOR-LIVENESS-${sourceCommit.slice(0, 16).toUpperCase()}`;
    const taskRecordPath = `autonomous-supervisor-tasks/${taskId}.json`;
    writeAddressed(campaignRoot, taskRecordPath, {
      schema: "agentos.controller_autonomous_supervisor_task.v1",
      version: 1,
      status: "RECONCILING_DURABLE_CAMPAIGN_ROLES",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "Intent Regulator",
      project_id: goal.project_id,
      campaign_id: goal.campaign_id,
      campaign_version: goal.campaign_version,
      task_id: taskId,
      task_kind: "CONTROLLER_SUPERVISOR_LIVENESS",
      goal_id: goal.goal_id,
      goal_sha256: goal.goal_sha256,
      parent_handoff_sha256: goal.parent_handoff_sha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      scope: ["control/controller-supervisor.mjs", "control/controller-supervisor-runtime.mjs", "control/local-agent-session.mjs", "tests/verify-controller-supervisor.mjs"].sort(),
      protected_boundaries: permissions,
      record_sha256: null,
    });
    const orchestrator = await startDurableWorkerSession({
      repoRoot: repositoryRoot,
      runtimeRoot: campaignRoot,
      role: "CAMPAIGN_ORCHESTRATOR",
      campaignId: goal.campaign_id,
      campaignVersion: goal.campaign_version,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit,
      sourceTree,
      task: "Observe the adopted Controller checkpoint and keep the campaign roles source-bound without changing scope.",
      taskId: `${taskId}-ORCHESTRATOR`,
      taskKind: "CONTROLLER_SUPERVISOR_LIVENESS",
    });
    const feature = await startDurableWorkerSession({
      repoRoot: repositoryRoot,
      runtimeRoot: campaignRoot,
      role: "FEATURE_AGENT",
      campaignId: goal.campaign_id,
      campaignVersion: goal.campaign_version,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit,
      sourceTree,
      task: "Observe the adopted Controller checkpoint and return source-bound focused checks without changing code.",
      taskId,
      taskKind: "CONTROLLER_SUPERVISOR_LIVENESS",
    });
    const auditor = await startDurableWorkerSession({
      repoRoot: repositoryRoot,
      runtimeRoot: campaignRoot,
      role: "INDEPENDENT_AUDITOR",
      campaignId: goal.campaign_id,
      campaignVersion: goal.campaign_version,
      candidateSha256: candidate.candidate_sha256,
      sourceCommit,
      sourceTree,
      task: "Independently verify the adopted Controller checkpoint and durable role liveness.",
      taskId: `${taskId}-AUDITOR`,
      taskKind: "CONTROLLER_SUPERVISOR_LIVENESS",
      featureWorktree: feature.session_record.worktree_path,
    });
    const controllerChecks = runControllerChecks({scheduler: controllerScheduler, repositoryRoot, worktreePath: feature.session_record.worktree_path});
    const featureReadback = feature.readback;
    const auditorReadback = auditor.readback;
    validateLocalWorkerReadback(featureReadback, "CONTROLLER_SUPERVISOR_LIVENESS");
    validateLocalWorkerReadback(auditorReadback, "CONTROLLER_SUPERVISOR_LIVENESS");
    assert(featureReadback.build_commit === sourceCommit && featureReadback.build_tree === sourceTree, "Controller liveness Feature-Agent source differs");
    assert(auditorReadback.build_commit === sourceCommit && auditorReadback.build_tree === sourceTree, "Controller liveness Auditor source differs");
    const readbackRoot = `autonomous-supervisor-readbacks/${taskId}`;
    const orchestratorRecordPath = `${readbackRoot}/orchestrator.json`;
    const featureRecordPath = `${readbackRoot}/feature-agent.json`;
    const auditorRecordPath = `${readbackRoot}/auditor.json`;
    const controllerRecordPath = `${readbackRoot}/controller-recheck.json`;
    writeAddressed(campaignRoot, orchestratorRecordPath, {schema: "agentos.controller_autonomous_supervisor_orchestrator_liveness_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: orchestrator.session_record.session_id, pid: orchestrator.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: orchestrator.readback, record_sha256: null});
    writeAddressed(campaignRoot, featureRecordPath, {schema: "agentos.controller_autonomous_supervisor_feature_liveness_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: feature.session_record.session_id, pid: feature.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: featureReadback, record_sha256: null});
    writeAddressed(campaignRoot, auditorRecordPath, {schema: "agentos.controller_autonomous_supervisor_auditor_liveness_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: auditor.session_record.session_id, pid: auditor.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: auditorReadback, record_sha256: null});
    const controllerRecheck = writeAddressed(campaignRoot, controllerRecordPath, {schema: "agentos.controller_autonomous_supervisor_controller_liveness_recheck.v1", version: 1, status: "PASS", controller_role: "AGENTOS_CONTROLLER", task_id: taskId, source_commit: sourceCommit, source_tree: sourceTree, feature_commit: featureReadback.build_commit, feature_tree: featureReadback.build_tree, auditor_commit: auditorReadback.build_commit, auditor_tree: auditorReadback.build_tree, checks: controllerChecks, record_sha256: null});
    const activeSessions = [orchestrator, feature, auditor].map((session) => ({target: sessionRecordPath(session.session_record), record: session.session_record}));
    const priorPointer = readAddressed(campaignRoot, "autonomous-supervisor-current-handoff.json", "pointer_sha256");
    const transitionedHandoff = compileSupervisorHandoff({
      previous: handoff,
      goal,
      status: "SUPERVISOR_LIVENESS_RECONCILED",
      sourceCommit,
      sourceTree,
      nextAction: "Continue observing the active campaign; route any new repair puzzle, soft boundary, or hard boundary automatically.",
      permissions,
      repair: handoff.repair ?? null,
      finalizer: handoff.finalizer ?? null,
      lifecycleResolutionSha256: handoff.lifecycle_resolution_sha256 ?? null,
      supervisedSessions: activeSessions.map((entry) => sessionSummary(campaignRoot, entry)).sort((left, right) => left.session_id.localeCompare(right.session_id)),
      preservedFailureRcas: retainedFailureRcas,
    });
    const transitioned = writeCurrentHandoff(campaignRoot, transitionedHandoff, priorPointer?.pointer_sha256 ?? null);
    return {
      controller_role: "AGENTOS_CONTROLLER",
      status: "LIVENESS_RECONCILED",
      task_id: taskId,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      discovered_session_count: existingSessions.length,
      stale_session_count: Math.max(0, existingSessions.length - 3),
      stale_session_rca_sha256: orphanedSessionRca?.rca_sha256 ?? null,
      autonomous_task_queue_sha256: taskQueue.queue_sha256,
      controller_recheck_sha256: controllerRecheck.record_sha256,
      semantic_before_sha256: goal.parent_handoff_sha256,
      semantic_after_sha256: transitioned.handoff.handoff_sha256,
      task_record_path: taskRecordPath,
      readback_record_paths: [orchestratorRecordPath, featureRecordPath, auditorRecordPath, controllerRecordPath].sort(),
      handoff_path: `autonomous-supervisor-handoffs/${transitioned.handoff.goal_id}.json`,
      current_handoff_pointer_sha256: transitioned.pointer.pointer_sha256,
      retained_failure_rcas: retainedFailureRcas.sort(),
      supervised_session_record_paths: activeSessions.map((entry) => path.relative(campaignRoot, entry.target)).sort(),
      protected_boundaries: permissions,
    };
  }

  async function routeAutonomousWorkflowTask(goal) {
    const handoff = readCurrentHandoff(campaignRoot, handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const permissions = permissionsFrom(handoff, activation);
    assert(permissions.local_development_writes_allowed && permissions.local_worker_agent_spawns_allowed, "autonomous Controller task lacks local development authorization");
    assert(!permissions.product_writes_allowed && !permissions.product_agent_spawns_allowed, "autonomous Controller task cannot enter Product custody");
    assert(!permissions.external_deployment_allowed && !permissions.external_release_allowed && !permissions.external_publication_allowed && !permissions.external_push_allowed && !permissions.external_merge_allowed, "autonomous Controller task cannot perform external actions");
    const taskFindingId = goal.finding_ids.find((findingId) => findingId.startsWith("F-AUTONOMOUS-TASK-"));
    assert(taskFindingId !== undefined, "autonomous Controller workflow goal lacks its selected task");
    const taskId = taskFindingId.slice("F-AUTONOMOUS-TASK-".length);
    if (taskId.startsWith("CAMPAIGN-PROGRESS-BUILD-") || taskId.startsWith("CAMPAIGN-OWNER-FEEDBACK-")) return routeRepair(goal);
    const queue = readAutonomousTaskQueue(campaignRoot, handoff.campaign_id, handoff.campaign_version);
    assert(queue !== null, "autonomous Controller task queue disappeared before routing");
    const task = queue.tasks.find((candidateTask) => candidateTask.task_id === taskId);
    assert(task !== undefined && task.status === "OPEN", "autonomous Controller selected task is not open");
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const executionContext = readCampaignExecutionContext({campaignRoot, handoff, sourceCommit, sourceTree});
    const candidate = executionContext.candidate;
    assert(queue.source_commit === sourceCommit && queue.source_tree === sourceTree, "autonomous Controller task queue is stale for the current source");
    const checks = runControllerWorkflowAuditChecks({scheduler: controllerScheduler, repositoryRoot, worktreePath: repositoryRoot});
    const controllerState = readOptional(campaignRoot, "controller-state.json");
    const audit = writeAddressed(campaignRoot, `autonomous-supervisor-workflow-audits/${taskId}.json`, {
      schema: "agentos.controller_autonomous_workflow_audit.v1",
      version: 1,
      status: "PASS",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "Intent Regulator",
      project_id: goal.project_id,
      campaign_id: goal.campaign_id,
      campaign_version: goal.campaign_version,
      task_id: taskId,
      goal_id: goal.goal_id,
      goal_sha256: goal.goal_sha256,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      checks,
      active_campaign: handoff.campaign_active === true,
      controller_state_sha256: controllerState?.state_sha256 ?? null,
      next_action: "Controller will continue observing the active campaign and choose the next safe control-plane action without an outside prompt.",
      external_actions_attempted: false,
      audit_sha256: null,
    }, "audit_sha256");
    const updatedQueue = structuredClone(queue);
    updatedQueue.tasks = updatedQueue.tasks.map((candidateTask) => candidateTask.task_id === taskId
      ? {...candidateTask, status: "COMPLETED"}
      : candidateTask);
    const queueReadback = writeMutableAddressed(campaignRoot, AUTONOMOUS_TASK_QUEUE_FILE, updatedQueue, "queue_sha256", queue.queue_sha256);
    const priorPointer = readAddressed(campaignRoot, "autonomous-supervisor-current-handoff.json", "pointer_sha256");
    const transitionedHandoff = compileSupervisorHandoff({
      previous: handoff,
      goal,
      status: "SUPERVISOR_AUTONOMOUS_TASK_COMPLETED",
      sourceCommit,
      sourceTree,
      nextAction: "The Controller completed its self-directed workflow audit; it will continue observing and choose the next safe action automatically.",
      permissions,
      repair: handoff.repair ?? null,
      finalizer: handoff.finalizer ?? null,
      lifecycleResolutionSha256: handoff.lifecycle_resolution_sha256 ?? null,
      supervisedSessions: handoff.supervised_sessions ?? [],
      preservedFailureRcas: handoff.preserved_failure_rcas ?? [],
    });
    const transitioned = writeCurrentHandoff(campaignRoot, transitionedHandoff, priorPointer?.pointer_sha256 ?? null);
    return {
      controller_role: "AGENTOS_CONTROLLER",
      status: "AUTONOMOUS_WORKFLOW_AUDIT_COMPLETED",
      task_id: taskId,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      audit_sha256: audit.audit_sha256,
      audit_path: `autonomous-supervisor-workflow-audits/${taskId}.json`,
      task_queue_sha256: queueReadback.queue_sha256,
      semantic_before_sha256: goal.parent_handoff_sha256,
      semantic_after_sha256: transitioned.handoff.handoff_sha256,
      handoff_path: `autonomous-supervisor-handoffs/${transitioned.handoff.goal_id}.json`,
      current_handoff_pointer_sha256: transitioned.pointer.pointer_sha256,
      protected_boundaries: permissions,
      candidate_sha256: candidate.candidate_sha256,
    };
  }

  async function route(goal) {
    if (goal.action === "ROUTE_REPAIRABLE_PUZZLE" && goal.finding_ids.some((findingId) => findingId.startsWith("F-AUTONOMOUS-TASK-"))) return routeAutonomousWorkflowTask(goal);
    if (goal.action === "ROUTE_REPAIRABLE_PUZZLE") return routeRepair(goal);
    if (goal.action === "RECONCILE_LIVENESS") return routeLiveness(goal);
    if (goal.action === "REVIEW_SOFT_BOUNDARY") return {
      status: "SOFT_BOUNDARY_REVIEW_REQUIRED",
      controller_role: "AGENTOS_CONTROLLER",
      owner_decision_required: false,
      next_action: "Campaign Orchestrator review is required before changed scope continues.",
    };
    if (goal.action === "WAIT_FOR_AUTHORIZED_WORK") return {
      status: "WAITING_FOR_AUTHORIZED_WORK",
      controller_role: "AGENTOS_CONTROLLER",
      owner_decision_required: false,
      resume_event_id: `OWNER-EVENT-${goal.goal_sha256.slice(0, 16).toUpperCase()}`,
      resume_condition: "Resume only when the exact authorized owner event arrives.",
    };
    throw new Error(`local Controller adapter cannot route action ${goal.action}`);
  }

  return {observe, route};
}
