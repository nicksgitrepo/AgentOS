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

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function runControllerChecks(worktreePath) {
  const checks = [
    "node --check control/controller-supervisor.mjs",
    "node --check control/controller-supervisor-runtime.mjs",
    "node --check control/local-agent-session.mjs",
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

export async function createControllerSupervisorAdapter({runtimeRoot, repoRoot}) {
  const campaignRoot = safeRoot(runtimeRoot, "local supervisor campaign root");
  const repositoryRoot = safeRoot(repoRoot, "local supervisor repository root");
  const handoffPath = path.join(campaignRoot, "autonomous-supervisor-handoff.json");

  function observe() {
    const handoff = readJson(handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const candidate = readOptional(campaignRoot, "candidate.json");
    const gateFinding = readOptional(campaignRoot, "gate-evidence-anti-drift-rca.json");
    const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
    const permissions = permissionsFrom(handoff, activation);
    const lifecycle = gateFinding?.lifecycle_roi_finding ?? null;
    const findings = lifecycle && lifecycle.status !== "RESOLVED" ? [{
      finding_id: lifecycle.finding_id,
      classification: lifecycle.classification,
      status: lifecycle.status,
      summary: lifecycle.symptom,
      source_sha256: gateFinding.finding_sha256,
    }] : [];
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

  async function route(goal) {
    const handoff = readJson(handoffPath);
    const activation = readOptional(campaignRoot, "activation.json");
    const candidate = readJson(path.join(campaignRoot, "candidate.json"));
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
      task_kind: "CONTROLLER_SUPERVISOR_REPAIR",
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
      task: "Repair the Controller supervisor boundary classification in isolated Feature-Agent custody, then run its focused checks.",
      taskId,
      taskKind: "CONTROLLER_SUPERVISOR_REPAIR",
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
      task: "Independently inspect the Feature-Agent Controller supervisor checkpoint and return source-bound audit evidence.",
      taskId: `${taskId}-AUDITOR`,
      taskKind: "CONTROLLER_SUPERVISOR_REPAIR",
      featureWorktree: feature.session_record.worktree_path,
    });
    const controllerChecks = runControllerChecks(feature.session_record.worktree_path);
    const featureReadback = feature.readback;
    const auditorReadback = auditor.readback;
    validateLocalWorkerReadback(featureReadback, "CONTROLLER_SUPERVISOR_REPAIR");
    validateLocalWorkerReadback(auditorReadback, "CONTROLLER_SUPERVISOR_REPAIR");
    assert(featureReadback.build_commit === auditorReadback.build_commit && featureReadback.build_tree === auditorReadback.build_tree, "Controller supervisor Feature-Agent and Auditor checkpoints differ");
    writeAddressed(campaignRoot, "autonomous-supervisor-orchestrator-readback.json", {schema: "agentos.controller_autonomous_supervisor_orchestrator_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: orchestrator.session_record.session_id, pid: orchestrator.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: orchestrator.readback, record_sha256: null});
    writeAddressed(campaignRoot, "autonomous-supervisor-feature-agent-readback.json", {schema: "agentos.controller_autonomous_supervisor_feature_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: feature.session_record.session_id, pid: feature.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: featureReadback, record_sha256: null});
    writeAddressed(campaignRoot, "autonomous-supervisor-auditor-readback.json", {schema: "agentos.controller_autonomous_supervisor_auditor_readback.v1", version: 1, status: "DURABLE_SESSION_RUNNING", task_id: taskId, session_id: auditor.session_record.session_id, pid: auditor.session_record.pid, source_commit: sourceCommit, source_tree: sourceTree, readback: auditorReadback, record_sha256: null});
    const controllerRecheck = writeAddressed(campaignRoot, "autonomous-supervisor-controller-recheck.json", {schema: "agentos.controller_autonomous_supervisor_controller_recheck.v1", version: 1, status: "PASS", controller_role: "AGENTOS_CONTROLLER", task_id: taskId, source_commit: sourceCommit, source_tree: sourceTree, feature_commit: featureReadback.build_commit, feature_tree: featureReadback.build_tree, auditor_commit: auditorReadback.build_commit, auditor_tree: auditorReadback.build_tree, checks: controllerChecks, record_sha256: null});
    return {
      status: "ROUTED_AND_CONTROLLER_RECHECKED",
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
      task_record_path: taskRecordPath,
      protected_boundaries: permissions,
    };
  }

  return {observe, route};
}
