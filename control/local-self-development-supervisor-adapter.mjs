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

const AUTONOMOUS_TASK_QUEUE_FILE = "autonomous-supervisor-task-queue.json";
const CAMPAIGN_PROGRESS_FILE = "autonomous-supervisor-campaign-progress.json";

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function readJson(target) {
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `local supervisor record is not a regular file: ${target}`);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function readOptional(root, name) {
  const target = path.join(root, name);
  return fs.existsSync(target) ? readJson(target) : null;
}

function writeAddressed(root, name, value, field = "record_sha256") {
  const target = path.join(root, name);
  const record = structuredClone(value);
  record[field] = null;
  record[field] = digestWithout(record, field);
  if (fs.existsSync(target)) {
    const existing = readJson(target);
    assert(existing[field] === record[field], `local supervisor record differs: ${name}`);
    return existing;
  }
  fs.mkdirSync(path.dirname(target), {recursive: true});
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

function ensureAutonomousTaskQueue({campaignRoot, handoff, sourceCommit, sourceTree, campaignProgress, checkpointOnCurrentSource, executionContext}) {
  const existing = readAutonomousTaskQueue(campaignRoot, handoff.campaign_id, handoff.campaign_version);
  const checkpointIsCurrent = campaignProgress !== null && checkpointOnCurrentSource === true;
  const task = checkpointIsCurrent
    ? {
      task_id: `CONTROLLER-WORKFLOW-AUDIT-${sourceCommit.slice(0, 16).toUpperCase()}`,
      status: "OPEN",
      priority: 0,
      summary: "Recheck the accepted local checkpoint, campaign handoff, worker receipts, retained failures, and the next safe control-plane action.",
      scope: ["ACTIVE_CAMPAIGN_HANDOFF", "ACCEPTED_LOCAL_CHECKPOINT", "CONTROLLER_STATE", "WORKER_RECEIPTS"].sort(),
      owner_decision_required: false,
    }
    : {
      task_id: `CAMPAIGN-PROGRESS-BUILD-${sourceCommit.slice(0, 16).toUpperCase()}`,
      status: "OPEN",
      priority: 0,
      summary: `Carry out the owner-defined first useful workflow: ${executionContext.firstUsefulWorkflow}. The Orchestrator selects the next bounded control-plane repair, the Feature Agent builds it, and the Auditor checks the same result.`,
      scope: ["ACCEPTANCE_CONTRACT", "DECISION_TREE", "OWNER_INTENT", "SCOPED_CONTROL_PLANE_CODE", "WORKER_RECEIPTS"].sort(),
      owner_decision_required: false,
    };
  const sameSource = existing !== null && existing.source_commit === sourceCommit && existing.source_tree === sourceTree;
  if (sameSource) {
    const matchingTask = existing.tasks.find((candidate) => candidate.task_id === task.task_id);
    if (["OPEN", "IN_PROGRESS", "COMPLETED"].includes(matchingTask?.status)) return existing;
    writeAddressed(campaignRoot, `autonomous-supervisor-task-queues/${existing.queue_sha256}.json`, existing, "queue_sha256");
    const queue = {
      schema: "agentos.controller_autonomous_task_queue.v1",
      version: 1,
      campaign_id: handoff.campaign_id,
      campaign_version: handoff.campaign_version,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      generated_reason: checkpointIsCurrent
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
    generated_reason: checkpointIsCurrent
      ? "ACCEPTED_LOCAL_CHECKPOINT_REQUIRES_CONTROLLER_RECHECK"
      : "ACTIVE_CAMPAIGN_FIRST_USEFUL_WORKFLOW_NOT_COMPLETED",
    tasks: [task],
    queue_sha256: null,
  };
  if (existing === null) return writeAddressed(campaignRoot, AUTONOMOUS_TASK_QUEUE_FILE, queue, "queue_sha256");
  return writeMutableAddressed(campaignRoot, AUTONOMOUS_TASK_QUEUE_FILE, queue, "queue_sha256", existing.queue_sha256);
}

function writeMutableAddressed(root, name, value, field, expectedDigest = null) {
  const target = path.join(root, name);
  const existing = fs.existsSync(target) ? readJson(target) : null;
  if (expectedDigest !== null) assert(existing?.[field] === expectedDigest, `${name} compare-and-swap parent is stale`);
  const record = structuredClone(value);
  record[field] = null;
  record[field] = digestWithout(record, field);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return readJson(target);
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
  return target;
}

function readCurrentHandoff(campaignRoot, legacyPath) {
  const pointer = readAddressed(campaignRoot, "autonomous-supervisor-current-handoff.json", "pointer_sha256");
  if (pointer === null) return readJson(legacyPath);
  const handoffPath = relativeChild(campaignRoot, pointer.handoff_path, "current handoff path");
  const handoff = readJson(handoffPath);
  requireSha(handoff.handoff_sha256, "current handoff digest");
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
  const discoveredEntries = discoverSupervisorSessions(campaignRoot, handoff.campaign_id).filter(({record}) => record.status === "RUNNING");
  const combined = [...declaredEntries, ...discoveredEntries];
  const seen = new Set();
  return combined
    .map(({target, record}) => ({target, record: record ?? readJson(target)}))
    .filter(({target, record}) => {
      if (record === null || seen.has(target)) return false;
      seen.add(target);
      return true;
    });
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
    if (entry.record.status === "RUNNING" && !processAlive(entry.record.pid)) {
      entry.record = markDurableWorkerSessionFailed({
        sessionRecordPath: entry.target,
        failure: "durable worker process exited before Controller reconciliation",
      });
    }
    return entry;
  });
}

function sessionIsHealthy({record, sourceCommit, sourceTree}) {
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
    return record.status === "RUNNING" && heartbeat.status === "RUNNING" && processAlive(record.pid);
  } catch {
    return false;
  }
}

function durableSessionLivenessSnapshot({campaignRoot, target, record, sourceCommit, sourceTree}) {
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
    source_aligned: record.source_commit === sourceCommit && record.source_tree === sourceTree,
    session_record_path: path.relative(campaignRoot, target),
    source_commit: record.source_commit,
    source_tree: record.source_tree,
    repair_required: !processIsAlive || !heartbeatValid || heartbeat?.status !== "RUNNING" || heartbeat?.session_pid !== record.pid,
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

function sessionSummary(campaignRoot, entry) {
  return {
    role: entry.record.role,
    session_id: entry.record.session_id,
    task_id: entry.record.task_id,
    task_kind: entry.record.task_kind,
    source_commit: entry.record.source_commit,
    source_tree: entry.record.source_tree,
    status: entry.record.status,
    session_record_path: path.relative(campaignRoot, entry.target),
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
  const selection = selectAutonomousNextTask({tasks: queue.tasks, boundary, findings, activeCampaign});
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

function durableSessionLivenessFinding({campaignRoot, handoff, repositoryRoot, sourceCommit, sourceTree}) {
  if (handoff.campaign_active !== true) return null;
  if (durableSessionFailureRepairPresent(repositoryRoot)) return null;
  const entries = sessionEntries(campaignRoot, handoff);
  const unhealthy = entries
    .filter(({record}) => record.status === "RUNNING")
    .map(({target, record}) => durableSessionLivenessSnapshot({campaignRoot, target, record, sourceCommit, sourceTree}))
    .filter((entry) => entry.repair_required)
    .sort((left, right) => left.session_id.localeCompare(right.session_id));
  if (unhealthy.length === 0) return null;
  const sourceSha256 = supervisorDigest({source_commit: sourceCommit, source_tree: sourceTree, unhealthy_sessions: unhealthy});
  const deadRoles = unhealthy.filter((entry) => entry.process_alive === false).map((entry) => entry.role).sort();
  return {
    finding_id: "F-DURABLE-SESSION-LIVENESS",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_REPAIR_REQUIRED",
    summary: deadRoles.length > 0
      ? `The Controller found ${deadRoles.length} campaign role process${deadRoles.length === 1 ? "" : "es"} gone while its session record still says RUNNING: ${deadRoles.join(", ")}.`
      : "A campaign role session record or heartbeat no longer matches a healthy source-bound live session.",
    source_sha256: sourceSha256,
  };
}

function recordFailedSessionRca(campaignRoot, entry, sourceCommit, sourceTree) {
  const failure = entry.record.failure ?? "durable session failed without an error message";
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
    error_message_exact: failure,
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

function runControllerChecks(worktreePath, taskKind = "CONTROLLER_SUPERVISOR_REPAIR") {
  const checks = [
    "node --check control/controller-supervisor.mjs",
    "node --check control/controller-supervisor-runtime.mjs",
    "node --check control/local-agent-session.mjs",
    "node tests/verify-controller-supervisor.mjs",
  ];
  if (taskKind === "LOCAL_AGENT_SESSION_BINDING_REPAIR") checks.push("node tests/verify-all.mjs");
  if (taskKind === "DURABLE_SESSION_LIVENESS_REPAIR") checks.push("node --check control/local-agent-runtime.mjs", "node tests/verify-local-agent-session.mjs");
  if (taskKind === "DURABLE_SESSION_TEST_ROOT_REPAIR") checks.push("node tests/verify-local-agent-session.mjs");
  if (taskKind === "OWNER_CONVERSATION_SURFACE_REPAIR") checks.push("node tests/verify-owner-conversation-surface.mjs", "node tests/verify-owner-review.mjs", "node tests/verify-bootstrap-delivery-finish.mjs");
  if (taskKind === "GOVERNANCE_EVIDENCE_REPAIR") checks.push(
    "node --check control/governance-evidence.mjs",
    "node --check control/local-agent-worker.mjs",
    "node tests/verify-governance-decision-tree.mjs",
    "node tests/verify-local-campaign-admission.mjs",
  );
  for (const check of checks) {
    const [program, ...args] = check.split(" ");
    execFileSync(program === "node" ? process.execPath : program, args, {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  }
  return checks;
}

function runControllerWorkflowAuditChecks(worktreePath) {
  const checks = [
    ...runControllerChecks(worktreePath),
    "node tests/verify-owner-conversation-surface.mjs",
    "node tests/verify-owner-review.mjs",
    "node tests/verify-bootstrap-delivery-finish.mjs",
  ];
  for (const check of checks) {
    const [program, ...args] = check.split(" ");
    execFileSync(program === "node" ? process.execPath : program, args, {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  }
  return checks;
}

function runCampaignProgressChecks(worktreePath) {
  const checks = [
    "node --check control/governance-decision-tree.mjs",
    "node tests/verify-governance-decision-tree.mjs",
    "node --check control/controller-supervisor.mjs",
    "node tests/verify-controller-supervisor.mjs",
  ];
  for (const check of checks) {
    const [program, ...args] = check.split(" ");
    execFileSync(program === "node" ? process.execPath : program, args, {cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  }
  return checks;
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
    controller_display_name: previous.controller_display_name ?? "AgentOS Controller",
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

export async function createControllerSupervisorAdapter({runtimeRoot, repoRoot}) {
  const campaignRoot = safeRoot(runtimeRoot, "local supervisor campaign root");
  const repositoryRoot = safeRoot(repoRoot, "local supervisor repository root");
  const handoffPath = path.join(campaignRoot, "autonomous-supervisor-handoff.json");

  function observe() {
    const handoff = readCurrentHandoff(campaignRoot, handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const candidate = readOptional(campaignRoot, "candidate.json");
    const gateFinding = readOptional(campaignRoot, "gate-evidence-anti-drift-rca.json");
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const executionContext = handoff.campaign_active
      ? readCampaignExecutionContext({campaignRoot, handoff, sourceCommit, sourceTree})
      : null;
    const campaignProgress = handoff.campaign_active
      ? readCampaignProgress(campaignRoot, handoff.campaign_id, handoff.campaign_version)
      : null;
    const checkpointOnCurrentSource = campaignProgress === null
      ? false
      : isAncestor(repositoryRoot, campaignProgress.source_commit, sourceCommit);
    const taskQueue = handoff.campaign_active
      ? ensureAutonomousTaskQueue({campaignRoot, handoff, sourceCommit, sourceTree, campaignProgress, checkpointOnCurrentSource, executionContext})
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
    const durableSessionLiveness = durableSessionLivenessFinding({campaignRoot, handoff, repositoryRoot, sourceCommit, sourceTree});
    if (durableSessionLiveness !== null) findings.push(durableSessionLiveness);
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
      controllerDisplayName: handoff.controller_display_name ?? "AgentOS Controller",
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
      nextAction: handoff.next_action,
      sourceCommit,
      sourceTree,
      parentHandoffSha256: handoff.handoff_sha256,
      observedAtUtc: new Date().toISOString(),
    });
  }

  async function routeRepair(goal) {
    const handoff = readCurrentHandoff(campaignRoot, handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const gateFinding = readJson(path.join(campaignRoot, "gate-evidence-anti-drift-rca.json"));
    const lifecycleFinding = gateFinding.lifecycle_roi_finding;
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const executionContext = readCampaignExecutionContext({campaignRoot, handoff, sourceCommit, sourceTree});
    const candidate = executionContext.candidate;
    const autonomousTaskFindingId = goal.finding_ids.find((findingId) => findingId.startsWith("F-AUTONOMOUS-TASK-"));
    const autonomousTaskQueue = autonomousTaskFindingId === undefined
      ? null
      : readAutonomousTaskQueue(campaignRoot, handoff.campaign_id, handoff.campaign_version);
    const autonomousTaskId = autonomousTaskFindingId?.slice("F-AUTONOMOUS-TASK-".length) ?? null;
    const autonomousTask = autonomousTaskQueue?.tasks.find((task) => task.task_id === autonomousTaskId) ?? null;
    const campaignProgressTask = autonomousTask?.task_id.startsWith("CAMPAIGN-PROGRESS-BUILD-") === true;
    const bindingFinding = controllerSupervisorBindingFinding(repositoryRoot);
    const localAgentSessionBinding = localAgentSessionBindingFinding(repositoryRoot);
    const ownerSurfaceFinding = ownerConversationSurfaceFinding(repositoryRoot);
    const boundaryPrecedenceFinding = controllerBoundaryPrecedenceFinding(repositoryRoot);
    const durableSessionFinding = durableSessionTestFinding(campaignRoot);
    const durableSessionLiveness = durableSessionLivenessFinding({campaignRoot, handoff, repositoryRoot, sourceCommit, sourceTree});
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
    const taskPrefix = governanceEvidenceRepair
      ? "TASK-GOVERNANCE-EVIDENCE"
      : campaignProgressTask
      ? "TASK-CAMPAIGN-PROGRESS"
      : repairKind === "DURABLE_SESSION_LIVENESS_REPAIR"
      ? "TASK-DURABLE-SESSION-LIVENESS"
      : "TASK-CONTROLLER-SUPERVISOR";
    const taskId = `${taskPrefix}-${goal.goal_sha256.slice(0, 16).toUpperCase()}`;
    const taskRecordPath = `autonomous-supervisor-tasks/${taskId}.json`;
    const task = writeAddressed(campaignRoot, taskRecordPath, {
      schema: "agentos.controller_autonomous_supervisor_task.v1",
      version: 1,
      status: "ROUTED_TO_DURABLE_CAMPAIGN_ROLES",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "AgentOS Controller",
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
        : governanceEvidenceRepair
        ? ["control/feature-agent-governance-evidence-repair.mjs", "control/governance-decision-tree.mjs", "control/governance-evidence.mjs", "control/local-agent-worker.mjs", "tests/verify-governance-decision-tree.mjs", "tests/verify-local-campaign-admission.mjs"].sort()
        : repairKind === "OWNER_CONVERSATION_SURFACE_REPAIR"
        ? ["control/bootstrap-compiler.mjs", "control/owner-review.mjs", "schemas/bootstrap-binding.v1.json", "tests/verify-owner-conversation-surface.mjs", "tests/verify-owner-review.mjs"].sort()
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
          : "Supervise the bounded Controller supervisor repair and return the exact role handoff.",
        taskId: `${taskId}-ORCHESTRATOR`,
        taskKind: campaignProgressTask ? "CAMPAIGN_PROGRESS_ORCHESTRATE" : "CONTROLLER_SUPERVISOR_ORCHESTRATE",
        decisionTreePath: campaignProgressTask ? path.join(campaignRoot, executionContext.decisionTreePath) : null,
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
    const controllerChecks = campaignProgressTask
      ? runCampaignProgressChecks(feature.session_record.worktree_path)
      : runControllerChecks(feature.session_record.worktree_path, repairKind);
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
      ? writeAddressed(campaignRoot, CAMPAIGN_PROGRESS_FILE, {
        schema: "agentos.controller_autonomous_campaign_progress.v1",
        version: 1,
        status: "CHECKPOINT_READY",
        controller_role: "AGENTOS_CONTROLLER",
        campaign_id: goal.campaign_id,
        campaign_version: goal.campaign_version,
        task_id: autonomousTask.task_id,
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
        next_action: "The first useful workflow reached an audited local checkpoint; the Controller will keep observing and choose the next safe control-plane action automatically.",
        external_actions_attempted: false,
        progress_sha256: null,
      }, "progress_sha256")
      : null;
    const completedQueue = campaignProgressTask
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
    const priorPointer = readAddressed(campaignRoot, "autonomous-supervisor-current-handoff.json", "pointer_sha256");
    for (const entry of previousSessions) {
      if (entry.record.status === "RUNNING" && processAlive(entry.record.pid)) await stopDurableWorkerSession({sessionRecordPath: entry.target});
    }
    const currentSessions = [orchestrator, feature, auditor].map((session) => ({target: sessionRecordPath(session.session_record), record: session.session_record}));
    const transitionedHandoff = compileSupervisorHandoff({
      previous: handoff,
      goal,
      status: campaignProgressTask ? "SUPERVISOR_CAMPAIGN_PROGRESS_ACCEPTED" : "SUPERVISOR_REPAIR_ACCEPTED",
      sourceCommit: finalizerResult.adopted_commit,
      sourceTree: finalizerResult.adopted_tree,
      nextAction: campaignProgressTask
        ? "The Controller will re-observe the new source-bound checkpoint and choose the next safe control-plane action automatically; no outside prompt is needed."
        : "AgentOS Controller reconciles the durable campaign roles at the adopted checkpoint, then continues the next safe control-plane action without an outside prompt.",
      permissions,
        repair: {
        summary: campaignProgressTask
          ? `Carry out the owner-defined first useful workflow: ${executionContext.firstUsefulWorkflow}.`
          : governanceEvidenceRepair
          ? "Replace placeholder governance gate evidence with actual source-bound command and readback evidence, then require exact Orchestrator, Auditor, and Controller re-checks."
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
    const taskQueue = ensureAutonomousTaskQueue({campaignRoot, handoff, sourceCommit, sourceTree, campaignProgress, checkpointOnCurrentSource, executionContext});
    const unhealthySessionRca = recordUnhealthySessionRca({campaignRoot, handoff, entries: existingSessions, sourceCommit, sourceTree});
    reconcileExitedSessionRecords(existingSessions);
    const orphanedSessionRca = recordOrphanedSessionRca({campaignRoot, handoff, entries: existingSessions, sourceCommit, sourceTree});
    const retainedFailureRcas = discoverSupervisorSessions(campaignRoot, goal.campaign_id)
      .filter(({record}) => record.status === "FAILED")
      .map((entry) => recordFailedSessionRca(campaignRoot, entry, sourceCommit, sourceTree).rca_sha256)
      .concat(unhealthySessionRca === null ? [] : [unhealthySessionRca.rca_sha256])
      .concat(orphanedSessionRca === null ? [] : [orphanedSessionRca.rca_sha256]);
    if (existingSessions.length === 3 && existingSessions.every((entry) => sessionIsHealthy({record: entry.record, sourceCommit, sourceTree}))) {
      return {
        status: "LIVENESS_HEALTHY",
        source_commit: sourceCommit,
        source_tree: sourceTree,
        discovered_session_count: existingSessions.length,
        stale_session_count: Math.max(0, existingSessions.length - 3),
        stale_session_rca_sha256: orphanedSessionRca?.rca_sha256 ?? null,
        autonomous_task_queue_sha256: taskQueue.queue_sha256,
        retained_failure_rcas: retainedFailureRcas.sort(),
        supervised_sessions: existingSessions.map((entry) => sessionSummary(campaignRoot, entry)).sort((left, right) => left.session_id.localeCompare(right.session_id)),
        protected_boundaries: permissions,
      };
    }
    for (const entry of existingSessions) {
      if (entry.record.status === "RUNNING" && processAlive(entry.record.pid)) await stopDurableWorkerSession({sessionRecordPath: entry.target});
    }
    const taskId = `TASK-CONTROLLER-SUPERVISOR-LIVENESS-${sourceCommit.slice(0, 16).toUpperCase()}`;
    const taskRecordPath = `autonomous-supervisor-tasks/${taskId}.json`;
    writeAddressed(campaignRoot, taskRecordPath, {
      schema: "agentos.controller_autonomous_supervisor_task.v1",
      version: 1,
      status: "RECONCILING_DURABLE_CAMPAIGN_ROLES",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "AgentOS Controller",
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
    const controllerChecks = runControllerChecks(feature.session_record.worktree_path);
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
      status: "LIVENESS_RECONCILED",
      task_id: taskId,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      discovered_session_count: existingSessions.length,
      stale_session_count: Math.max(0, existingSessions.length - 3),
      stale_session_rca_sha256: orphanedSessionRca?.rca_sha256 ?? null,
      autonomous_task_queue_sha256: taskQueue.queue_sha256,
      controller_recheck_sha256: controllerRecheck.record_sha256,
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
    if (taskId.startsWith("CAMPAIGN-PROGRESS-BUILD-")) return routeRepair(goal);
    const queue = readAutonomousTaskQueue(campaignRoot, handoff.campaign_id, handoff.campaign_version);
    assert(queue !== null, "autonomous Controller task queue disappeared before routing");
    const task = queue.tasks.find((candidateTask) => candidateTask.task_id === taskId);
    assert(task !== undefined && task.status === "OPEN", "autonomous Controller selected task is not open");
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const executionContext = readCampaignExecutionContext({campaignRoot, handoff, sourceCommit, sourceTree});
    const candidate = executionContext.candidate;
    assert(queue.source_commit === sourceCommit && queue.source_tree === sourceTree, "autonomous Controller task queue is stale for the current source");
    const checks = runControllerWorkflowAuditChecks(repositoryRoot);
    const controllerState = readOptional(campaignRoot, "controller-state.json");
    const audit = writeAddressed(campaignRoot, `autonomous-supervisor-workflow-audits/${taskId}.json`, {
      schema: "agentos.controller_autonomous_workflow_audit.v1",
      version: 1,
      status: "PASS",
      controller_role: "AGENTOS_CONTROLLER",
      controller_display_name: "AgentOS Controller",
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
      status: "AUTONOMOUS_WORKFLOW_AUDIT_COMPLETED",
      task_id: taskId,
      source_commit: sourceCommit,
      source_tree: sourceTree,
      audit_sha256: audit.audit_sha256,
      audit_path: `autonomous-supervisor-workflow-audits/${taskId}.json`,
      task_queue_sha256: queueReadback.queue_sha256,
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
    };
    throw new Error(`local Controller adapter cannot route action ${goal.action}`);
  }

  return {observe, route};
}
