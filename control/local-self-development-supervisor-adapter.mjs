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
import {
  startDurableWorkerSession,
  stopDurableWorkerSession,
  validateLocalDurableSessionRecord,
  validateLocalWorkerHeartbeat,
  validateLocalWorkerReadback,
} from "./local-agent-runtime.mjs";
import {
  compileSupervisorObservation,
  supervisorDigest,
} from "./controller-supervisor.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a lowercase SHA-256`);
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
    .filter(({record}) => record?.campaign_id === campaignId && typeof record.task_kind === "string" && record.task_kind.startsWith("CONTROLLER_SUPERVISOR_"))
    .map(({target, record}) => ({target, record}));
}

function sessionEntries(campaignRoot, handoff) {
  const declared = Array.isArray(handoff.supervised_sessions) ? handoff.supervised_sessions : [];
  const paths = declared.map((entry) => entry.session_record_path).filter((value) => typeof value === "string");
  const discovered = paths.length > 0
    ? paths.map((relativePath) => ({target: relativeChild(campaignRoot, relativePath, "supervised session path"), record: null}))
    : discoverSupervisorSessions(campaignRoot, handoff.campaign_id).filter(({record}) => record.status === "RUNNING");
  return discovered.map(({target, record}) => ({target, record: record ?? readJson(target)})).filter(({record}) => record !== null);
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

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function runControllerChecks(worktreePath, taskKind = "CONTROLLER_SUPERVISOR_REPAIR") {
  const checks = [
    "node --check control/controller-supervisor.mjs",
    "node --check control/controller-supervisor-runtime.mjs",
    "node --check control/local-agent-session.mjs",
    "node tests/verify-controller-supervisor.mjs",
  ];
  if (taskKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR") checks.push("node tests/verify-all.mjs");
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
    const permissions = permissionsFrom(handoff, activation);
    const lifecycle = gateFinding?.lifecycle_roi_finding ?? null;
    const lifecycleResolution = lifecycle === null ? null : readAddressed(campaignRoot, `autonomous-supervisor-lifecycle-resolutions/${lifecycle.finding_id}.json`, "resolution_sha256");
    const lifecycleResolved = lifecycleResolution?.status === "RESOLVED" && lifecycleResolution.source_finding_sha256 === gateFinding?.finding_sha256;
    const findings = lifecycle && lifecycle.status !== "RESOLVED" && !lifecycleResolved ? [{
      finding_id: lifecycle.finding_id,
      classification: lifecycle.classification,
      status: lifecycle.status,
      summary: lifecycle.symptom,
      source_sha256: gateFinding.finding_sha256,
    }] : [];
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
    findings.sort((left, right) => left.finding_id.localeCompare(right.finding_id));
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
    const candidate = readJson(path.join(campaignRoot, "candidate.json"));
    const gateFinding = readJson(path.join(campaignRoot, "gate-evidence-anti-drift-rca.json"));
    const lifecycleFinding = gateFinding.lifecycle_roi_finding;
    const bindingFinding = controllerSupervisorBindingFinding(repositoryRoot);
    const repairKind = goal.finding_ids.includes(bindingFinding?.finding_id)
      ? "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
      : "CONTROLLER_SUPERVISOR_REPAIR";
    const routeFinding = repairKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR" ? bindingFinding : {
      finding_id: lifecycleFinding?.finding_id,
      source_sha256: gateFinding.finding_sha256,
      status: lifecycleFinding?.status,
    };
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const permissions = permissionsFrom(handoff, activation);
    assert(permissions.local_development_writes_allowed && permissions.local_worker_agent_spawns_allowed, "local Controller route lacks local development authorization");
    assert(!permissions.product_writes_allowed && !permissions.product_agent_spawns_allowed, "local Controller route cannot enter Product custody");
    assert(!permissions.external_deployment_allowed && !permissions.external_release_allowed && !permissions.external_publication_allowed && !permissions.external_push_allowed && !permissions.external_merge_allowed, "local Controller route cannot perform external actions");
    const taskId = `TASK-CONTROLLER-SUPERVISOR-${goal.goal_sha256.slice(0, 16).toUpperCase()}`;
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
      scope: repairKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
        ? ["schemas/bootstrap-binding.v1.json", "control/controller-supervisor.mjs", "tests/verify-all.mjs"].sort()
        : ["control/controller-supervisor.mjs", "control/controller-supervisor-runtime.mjs", "control/local-agent-session.mjs", "tests/verify-controller-supervisor.mjs"].sort(),
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
      task: "Supervise the bounded Controller supervisor repair and return the exact role handoff.",
      taskId: `${taskId}-ORCHESTRATOR`,
      taskKind: "CONTROLLER_SUPERVISOR_ORCHESTRATE",
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
      task: repairKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
        ? "Repair the exact Controller supervisor repository binding in isolated Feature-Agent custody, then run the full repository checks."
        : "Repair the Controller supervisor boundary classification in isolated Feature-Agent custody, then run its focused checks.",
      taskId,
      taskKind: repairKind,
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
      task: repairKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
        ? "Independently inspect the Feature-Agent Controller supervisor binding checkpoint and return full repository audit evidence."
        : "Independently inspect the Feature-Agent Controller supervisor checkpoint and return source-bound audit evidence.",
      taskId: `${taskId}-AUDITOR`,
      taskKind: repairKind,
      featureWorktree: feature.session_record.worktree_path,
    });
    const controllerChecks = runControllerChecks(feature.session_record.worktree_path, repairKind);
    const featureReadback = feature.readback;
    const auditorReadback = auditor.readback;
    validateLocalWorkerReadback(featureReadback, repairKind);
    validateLocalWorkerReadback(auditorReadback, repairKind);
    assert(featureReadback.build_commit === auditorReadback.build_commit && featureReadback.build_tree === auditorReadback.build_tree, "Controller supervisor Feature-Agent and Auditor checkpoints differ");
    const readbackRoot = `autonomous-supervisor-readbacks/${taskId}`;
    const orchestratorRecordPath = `${readbackRoot}/orchestrator.json`;
    const featureRecordPath = `${readbackRoot}/feature-agent.json`;
    const auditorRecordPath = `${readbackRoot}/auditor.json`;
    const controllerRecordPath = `${readbackRoot}/controller-recheck.json`;
    writeAddressed(campaignRoot, orchestratorRecordPath, {schema: "agentos.controller_autonomous_supervisor_orchestrator_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: orchestrator.session_record.session_id, pid: orchestrator.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: orchestrator.readback, record_sha256: null});
    writeAddressed(campaignRoot, featureRecordPath, {schema: "agentos.controller_autonomous_supervisor_feature_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: feature.session_record.session_id, pid: feature.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: featureReadback, record_sha256: null});
    writeAddressed(campaignRoot, auditorRecordPath, {schema: "agentos.controller_autonomous_supervisor_auditor_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: auditor.session_record.session_id, pid: auditor.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: auditorReadback, record_sha256: null});
    const controllerRecheck = writeAddressed(campaignRoot, controllerRecordPath, {schema: "agentos.controller_autonomous_supervisor_controller_recheck.v1", version: 1, status: "PASS", controller_role: "AGENTOS_CONTROLLER", task_id: taskId, source_commit: sourceCommit, source_tree: sourceTree, feature_commit: featureReadback.build_commit, feature_tree: featureReadback.build_tree, auditor_commit: auditorReadback.build_commit, auditor_tree: auditorReadback.build_tree, checks: controllerChecks, record_sha256: null});
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
    const priorSessions = sessionEntries(campaignRoot, handoff);
    const transitionedHandoff = compileSupervisorHandoff({
      previous: handoff,
      goal,
      status: "SUPERVISOR_REPAIR_ACCEPTED",
      sourceCommit: finalizerResult.adopted_commit,
      sourceTree: finalizerResult.adopted_tree,
      nextAction: "AgentOS Controller reconciles the durable campaign roles at the adopted checkpoint, then continues the next safe control-plane action without an outside prompt.",
      permissions,
      repair: {
        summary: repairKind === "CONTROLLER_SUPERVISOR_BINDING_REPAIR"
          ? "Restore the exact repository binding for the adopted Controller supervisor source and require the full verifier to pass."
          : "Replace one-shot Controller supervision with a durable, autonomous observation-to-route loop.",
        changed_paths: [...new Set(featureReadback.changed_paths)].sort(),
        source_commit: sourceCommit,
        source_tree: sourceTree,
        adopted_commit: finalizerResult.adopted_commit,
        adopted_tree: finalizerResult.adopted_tree,
      },
      finalizer: {
        record_path: finalizerRecordPath,
        finalizer_sha256: finalizerRecord.finalizer_sha256,
        status: finalizerRecord.status,
      },
      lifecycleResolutionSha256: lifecycleResolution.resolution_sha256,
      supervisedSessions: priorSessions.map((entry) => sessionSummary(campaignRoot, entry)).sort((left, right) => left.session_id.localeCompare(right.session_id)),
    });
    const transitioned = writeCurrentHandoff(campaignRoot, transitionedHandoff, priorPointer?.pointer_sha256 ?? null);
    return {
      status: "ROUTED_CONTROLLER_RECHECKED_AND_ADOPTED",
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
      supervised_session_record_paths: priorSessions.map((entry) => path.relative(campaignRoot, entry.target)).sort(),
      task_record_path: taskRecordPath,
      readback_record_paths: [orchestratorRecordPath, featureRecordPath, auditorRecordPath, controllerRecordPath, finalizerRecordPath, resolutionPath].sort(),
      protected_boundaries: permissions,
    };
  }

  async function routeLiveness(goal) {
    const handoff = readCurrentHandoff(campaignRoot, handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const candidate = readJson(path.join(campaignRoot, "candidate.json"));
    const permissions = permissionsFrom(handoff, activation);
    assert(permissions.local_development_writes_allowed && permissions.local_worker_agent_spawns_allowed, "local Controller liveness route lacks local development authorization");
    assert(!permissions.product_writes_allowed && !permissions.product_agent_spawns_allowed, "local Controller liveness route cannot enter Product custody");
    assert(!permissions.external_deployment_allowed && !permissions.external_release_allowed && !permissions.external_publication_allowed && !permissions.external_push_allowed && !permissions.external_merge_allowed, "local Controller liveness route cannot perform external actions");
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const existingSessions = sessionEntries(campaignRoot, handoff);
    const retainedFailureRcas = discoverSupervisorSessions(campaignRoot, goal.campaign_id)
      .filter(({record}) => record.status === "FAILED")
      .map((entry) => recordFailedSessionRca(campaignRoot, entry, sourceCommit, sourceTree).rca_sha256);
    if (existingSessions.length === 3 && existingSessions.every((entry) => sessionIsHealthy({record: entry.record, sourceCommit, sourceTree}))) {
      return {
        status: "LIVENESS_HEALTHY",
        source_commit: sourceCommit,
        source_tree: sourceTree,
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

  async function route(goal) {
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
