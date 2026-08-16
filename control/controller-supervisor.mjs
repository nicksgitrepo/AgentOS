#!/usr/bin/env node

/*
 * Project-persistent Controller supervisor decision engine.
 *
 * The engine is deliberately separate from Product work.  It consumes a
 * typed observation, chooses one bounded next action, and produces a
 * content-addressed goal.  A project-bound adapter may then carry out the
 * selected action and return a readback.  Nothing in this module treats a
 * caller-supplied string as proof of an external identity or permission.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const CONTROLLER_ROLE = "AGENTOS_CONTROLLER";
const OBSERVATION_SCHEMA = "agentos.controller_supervisor_observation.v1";
const GOAL_SCHEMA = "agentos.controller_supervisor_goal.v1";
const TICK_SCHEMA = "agentos.controller_supervisor_tick.v1";
const ACTIONS = Object.freeze([
  "ROUTE_REPAIRABLE_PUZZLE",
  "REVIEW_SOFT_BOUNDARY",
  "STOP_HARD_BOUNDARY",
  "RECONCILE_LIVENESS",
  "WAIT_FOR_AUTHORIZED_WORK",
]);
const FINDING_CLASSIFICATIONS = Object.freeze([
  "REPAIRABLE_ENGINEERING_PUZZLE",
  "SOFT_BOUNDARY",
  "TRUE_OWNER_BOUNDARY",
  "HARD_SECURITY_BOUNDARY",
]);
const FINDING_STATUSES = Object.freeze([
  "OPEN_REPAIR_REQUIRED",
  "OPEN_NEXT_REQUIRED_BEHAVIOR",
  "OPEN_REVIEW_REQUIRED",
  "RESOLVED",
]);
const AUTONOMOUS_TASK_STATUSES = Object.freeze(["OPEN", "IN_PROGRESS", "COMPLETED", "HELD"]);

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalSupervisorJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function supervisorDigest(value) {
  return crypto.createHash("sha256").update(canonicalSupervisorJson(value), "utf8").digest("hex");
}

function opaqueError(value) {
  const raw = value?.message ?? String(value);
  if (/^opaque:error:[0-9a-f]{64}$/u.test(raw)) return raw;
  return `opaque:error:${crypto.createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return supervisorDigest(body);
}

function stableObservationDigest(value) {
  const body = structuredClone(value);
  body.observation_sha256 = null;
  body.observed_at_utc = null;
  return supervisorDigest(body);
}

function stableGoalDigest(value) {
  const body = structuredClone(value);
  body.goal_sha256 = null;
  body.created_at_utc = null;
  return supervisorDigest(body);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`);
}

function sortedUnique(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${label} contains an invalid value`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return values;
}

function validateBoundary(boundary) {
  const keys = [
    "hard_stop",
    "soft_review",
    "owner_decision_required",
    "scope_changed",
    "local_development_writes_allowed",
    "local_worker_agent_spawns_allowed",
    "product_writes_allowed",
    "product_agent_spawns_allowed",
    "external_deployment_allowed",
    "external_release_allowed",
    "external_publication_allowed",
    "external_push_allowed",
    "external_merge_allowed",
    "secrets_allowed",
    "destructive_work_allowed",
  ];
  exactKeys(boundary, keys, "supervisor boundary");
  for (const key of keys) assert(typeof boundary[key] === "boolean", `supervisor boundary ${key} must be boolean`);
  if (boundary.owner_decision_required) assert(boundary.hard_stop, "an owner decision is always a hard stop");
  if (boundary.secrets_allowed || boundary.destructive_work_allowed || boundary.external_merge_allowed) {
    assert(boundary.hard_stop, "protected external or destructive permission cannot bypass a hard stop");
  }
  if (boundary.scope_changed) assert(boundary.soft_review || boundary.hard_stop, "a scope change requires review or a hard stop");
  return boundary;
}

function validateFinding(finding) {
  const keys = ["finding_id", "classification", "status", "summary", "source_sha256"];
  exactKeys(finding, keys, "supervisor finding");
  requireIdentifier(finding.finding_id, "supervisor finding ID");
  assert(FINDING_CLASSIFICATIONS.includes(finding.classification), "supervisor finding classification is invalid");
  assert(FINDING_STATUSES.includes(finding.status), "supervisor finding status is invalid");
  requireString(finding.summary, "supervisor finding summary");
  requireSha(finding.source_sha256, "supervisor finding source digest");
  return finding;
}

function validateFindingList(findings) {
  assert(Array.isArray(findings), "supervisor findings are required");
  const ordered = [...findings].sort((left, right) => compareUtf8(left.finding_id, right.finding_id));
  assert(JSON.stringify(findings) === JSON.stringify(ordered), "supervisor findings must be sorted by ID");
  const ids = new Set();
  for (const finding of findings) {
    validateFinding(finding);
    assert(!ids.has(finding.finding_id), "supervisor finding IDs must be unique");
    ids.add(finding.finding_id);
  }
  return findings;
}

function validateAutonomousTask(task) {
  const keys = ["task_id", "status", "priority", "summary", "scope", "owner_decision_required"];
  exactKeys(task, keys, "autonomous Controller task");
  requireIdentifier(task.task_id, "autonomous Controller task ID");
  assert(AUTONOMOUS_TASK_STATUSES.includes(task.status), "autonomous Controller task status is invalid");
  assert(Number.isSafeInteger(task.priority) && task.priority >= 0, "autonomous Controller task priority is invalid");
  requireString(task.summary, "autonomous Controller task summary");
  sortedUnique(task.scope, "autonomous Controller task scope", {allowEmpty: true});
  assert(typeof task.owner_decision_required === "boolean", "autonomous Controller task owner-decision flag is invalid");
  return task;
}

function validateAutonomousTaskList(tasks) {
  assert(Array.isArray(tasks), "autonomous Controller tasks are required");
  const ordered = [...tasks].sort((left, right) => left.priority - right.priority || compareUtf8(left.task_id, right.task_id));
  assert(JSON.stringify(tasks) === JSON.stringify(ordered), "autonomous Controller tasks must be sorted by priority and ID");
  const ids = new Set();
  for (const task of tasks) {
    validateAutonomousTask(task);
    assert(!ids.has(task.task_id), "autonomous Controller task IDs must be unique");
    ids.add(task.task_id);
  }
  return tasks;
}

/*
 * Choose the next bounded control-plane task without asking an outside
 * operator to name it.  Project adapters provide typed task candidates; this
 * function only chooses among them and never grants a new permission.
 */
export function selectAutonomousNextTask({tasks = [], boundary, findings = [], activeCampaign}) {
  validateBoundary(boundary);
  validateFindingList(findings);
  validateAutonomousTaskList(tasks);
  assert(typeof activeCampaign === "boolean", "autonomous Controller active-campaign flag is invalid");
  const hardFinding = hasOpenFinding(findings, ["HARD_SECURITY_BOUNDARY", "TRUE_OWNER_BOUNDARY"]);
  const softFinding = hasOpenFinding(findings, ["SOFT_BOUNDARY"]);
  if (boundary.hard_stop || boundary.owner_decision_required || hardFinding) {
    return {action: "STOP_HARD_BOUNDARY", task_id: null, reason: "A hard boundary or protected finding must stop dependent work."};
  }
  if (boundary.soft_review || boundary.scope_changed || softFinding) {
    return {action: "REVIEW_SOFT_BOUNDARY", task_id: null, reason: "A changed scope or soft boundary requires Orchestrator review."};
  }
  if (hasOpenFinding(findings, ["REPAIRABLE_ENGINEERING_PUZZLE"])) {
    return {action: "ROUTE_REPAIRABLE_PUZZLE", task_id: null, reason: "An open repair puzzle is already the next bounded task."};
  }
  const nextTask = tasks.find((task) => task.status === "OPEN");
  if (nextTask !== undefined) {
    if (nextTask.owner_decision_required) {
      return {action: "STOP_HARD_BOUNDARY", task_id: nextTask.task_id, reason: "The next task requires an owner decision before it can continue."};
    }
    return {action: "ROUTE_REPAIRABLE_PUZZLE", task_id: nextTask.task_id, reason: nextTask.summary};
  }
  if (activeCampaign) return {action: "RECONCILE_LIVENESS", task_id: null, reason: "No queued task is open; reconcile the active campaign and mint the next safe task if needed."};
  return {action: "RECONCILE_LIVENESS", task_id: null, reason: "No campaign is marked active; reconcile the workflow state and recover or mint the next safe control-plane task before any wait."};
}

export function validateSupervisorObservation(observation) {
  const keys = [
    "schema",
    "version",
    "controller_role",
    "controller_display_name",
    "project_id",
    "campaign_id",
    "campaign_version",
    "active_campaign",
    "owner_decision_required",
    "hard_boundary",
    "soft_boundary",
    "boundary",
    "findings",
    "next_action",
    "source_commit",
    "source_tree",
    "parent_handoff_sha256",
    "observed_at_utc",
    "observation_sha256",
  ];
  exactKeys(observation, keys, "supervisor observation");
  assert(observation.schema === OBSERVATION_SCHEMA && observation.version === 1, "supervisor observation identity is invalid");
  assert(observation.controller_role === CONTROLLER_ROLE, "supervisor observation controller role is invalid");
  requireString(observation.controller_display_name, "supervisor controller display name");
  requireString(observation.project_id, "supervisor project ID");
  requireString(observation.campaign_id, "supervisor campaign ID");
  requireString(observation.campaign_version, "supervisor campaign version");
  for (const field of ["active_campaign", "owner_decision_required", "hard_boundary", "soft_boundary"]) assert(typeof observation[field] === "boolean", `supervisor observation ${field} must be boolean`);
  validateBoundary(observation.boundary);
  assert(observation.owner_decision_required === observation.boundary.owner_decision_required, "supervisor owner-decision boundary is inconsistent");
  assert(observation.hard_boundary === observation.boundary.hard_stop, "supervisor hard boundary is inconsistent");
  assert(observation.soft_boundary === observation.boundary.soft_review, "supervisor soft boundary is inconsistent");
  validateFindingList(observation.findings);
  requireString(observation.next_action, "supervisor next action");
  requireGitObject(observation.source_commit, "supervisor source commit");
  requireGitObject(observation.source_tree, "supervisor source tree");
  requireSha(observation.parent_handoff_sha256, "supervisor parent handoff digest");
  requireUtc(observation.observed_at_utc, "supervisor observation time");
  requireSha(observation.observation_sha256, "supervisor observation digest");
  assert(observation.observation_sha256 === stableObservationDigest(observation), "supervisor observation digest mismatch");
  return observation;
}

export function compileSupervisorObservation({
  controllerDisplayName = "Intent Regulator",
  projectId,
  campaignId,
  campaignVersion,
  activeCampaign,
  ownerDecisionRequired = false,
  boundary,
  findings = [],
  nextAction,
  sourceCommit,
  sourceTree,
  parentHandoffSha256,
  observedAtUtc,
}) {
  const observation = {
    schema: OBSERVATION_SCHEMA,
    version: 1,
    controller_role: CONTROLLER_ROLE,
    controller_display_name: controllerDisplayName,
    project_id: projectId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    active_campaign: activeCampaign,
    owner_decision_required: ownerDecisionRequired,
    hard_boundary: boundary.hard_stop,
    soft_boundary: boundary.soft_review,
    boundary,
    findings,
    next_action: nextAction,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    parent_handoff_sha256: parentHandoffSha256,
    observed_at_utc: observedAtUtc,
    observation_sha256: null,
  };
  observation.observation_sha256 = stableObservationDigest(observation);
  return validateSupervisorObservation(observation);
}

function hasOpenFinding(findings, classifications) {
  return findings.some((finding) => finding.status !== "RESOLVED" && classifications.includes(finding.classification));
}

export function deriveSupervisorAction(observation) {
  validateSupervisorObservation(observation);
  if (observation.hard_boundary || observation.owner_decision_required) return "STOP_HARD_BOUNDARY";
  if (hasOpenFinding(observation.findings, ["HARD_SECURITY_BOUNDARY", "TRUE_OWNER_BOUNDARY"])) return "STOP_HARD_BOUNDARY";
  if (observation.soft_boundary || hasOpenFinding(observation.findings, ["SOFT_BOUNDARY"])) return "REVIEW_SOFT_BOUNDARY";
  if (hasOpenFinding(observation.findings, ["REPAIRABLE_ENGINEERING_PUZZLE"])) {
    return "ROUTE_REPAIRABLE_PUZZLE";
  }
  return "RECONCILE_LIVENESS";
}

function actionClassification(action) {
  if (action === "STOP_HARD_BOUNDARY") return "TRUE_OWNER_BOUNDARY";
  if (action === "REVIEW_SOFT_BOUNDARY") return "SOFT_BOUNDARY";
  if (action === "ROUTE_REPAIRABLE_PUZZLE") return "REPAIRABLE_ENGINEERING_PUZZLE";
  return "ROUTINE_CONTROLLER_OPERATION";
}

function actionGoal(action, observation) {
  const open = observation.findings.filter((finding) => finding.status !== "RESOLVED");
  if (action === "STOP_HARD_BOUNDARY") return "Stop the dependent work, preserve the exact boundary evidence, and wait for the required owner decision or protected authority.";
  if (action === "REVIEW_SOFT_BOUNDARY") return "Have the campaign Orchestrator review the changed scope or operating choice, keep unrelated safe work moving, and return a bounded decision record.";
  if (action === "ROUTE_REPAIRABLE_PUZZLE") return open.length === 0
    ? "Inspect the active campaign handoff, find the next safe repair, and return a source-bound readback."
    : "Route the open repair puzzle through the campaign roles, retain exact evidence, and recheck the result at the Controller boundary.";
  if (action === "RECONCILE_LIVENESS") return "Observe the workflow roles and receipts, repair any safe liveness gap, and recover or mint the next safe control-plane task before waiting. Waiting is allowed only after a true protected blocker is recorded.";
  return "Wait for an owner-authorized campaign or control-plane task; do not invent Product work.";
}

export function compileSupervisorGoal({observation, goalId = null}) {
  validateSupervisorObservation(observation);
  const action = deriveSupervisorAction(observation);
  const stableId = `CONTROLLER-GOAL-${observation.observation_sha256.slice(0, 16).toUpperCase()}`;
  if (goalId !== null) assert(goalId === stableId, "supervisor goal ID must be derived from the observation");
  requireIdentifier(stableId, "supervisor goal ID");
  const findings = observation.findings.filter((finding) => finding.status !== "RESOLVED").map((finding) => finding.finding_id).sort(compareUtf8);
  const goal = {
    schema: GOAL_SCHEMA,
    version: 1,
    goal_id: stableId,
    controller_role: CONTROLLER_ROLE,
    controller_display_name: observation.controller_display_name,
    project_id: observation.project_id,
    campaign_id: observation.campaign_id,
    campaign_version: observation.campaign_version,
    parent_handoff_sha256: observation.parent_handoff_sha256,
    source_commit: observation.source_commit,
    source_tree: observation.source_tree,
    action,
    classification: actionClassification(action),
    goal: actionGoal(action, observation),
    finding_ids: findings,
    scope: action === "STOP_HARD_BOUNDARY" ? "DEPENDENT_OUTCOME_ONLY" : "CURRENT_CAMPAIGN_CONTROL_PLANE",
    boundary: {
      ...structuredClone(observation.boundary),
      hard_stop: action === "STOP_HARD_BOUNDARY" || observation.boundary.hard_stop,
    },
    stop_conditions: [
      "A hard boundary, missing owner authority, identity mismatch, or evidence mismatch stops the dependent route.",
      "A scope change is reviewed before the changed work continues.",
      "No external, Product, destructive, credential, push, merge, release, or deployment action is inferred from this goal.",
    ].sort(compareUtf8),
    undo: "Do not alter protected state; retain the failed attempt and return to the last source-bound checkpoint.",
    created_at_utc: observation.observed_at_utc,
    goal_sha256: null,
  };
  goal.goal_sha256 = stableGoalDigest(goal);
  return validateSupervisorGoal(goal);
}

export function validateSupervisorGoal(goal) {
  const keys = [
    "schema", "version", "goal_id", "controller_role", "controller_display_name", "project_id", "campaign_id", "campaign_version",
    "parent_handoff_sha256", "source_commit", "source_tree", "action", "classification", "goal", "finding_ids", "scope", "boundary",
    "stop_conditions", "undo", "created_at_utc", "goal_sha256",
  ];
  exactKeys(goal, keys, "supervisor goal");
  assert(goal.schema === GOAL_SCHEMA && goal.version === 1, "supervisor goal identity is invalid");
  requireIdentifier(goal.goal_id, "supervisor goal ID");
  assert(goal.controller_role === CONTROLLER_ROLE, "supervisor goal controller role is invalid");
  for (const field of ["controller_display_name", "project_id", "campaign_id", "campaign_version", "goal", "scope", "undo"]) requireString(goal[field], `supervisor goal ${field}`);
  requireSha(goal.parent_handoff_sha256, "supervisor goal parent handoff");
  requireGitObject(goal.source_commit, "supervisor goal source commit");
  requireGitObject(goal.source_tree, "supervisor goal source tree");
  assert(ACTIONS.includes(goal.action), "supervisor goal action is invalid");
  assert(["TRUE_OWNER_BOUNDARY", "SOFT_BOUNDARY", "REPAIRABLE_ENGINEERING_PUZZLE", "ROUTINE_CONTROLLER_OPERATION"].includes(goal.classification), "supervisor goal classification is invalid");
  sortedUnique(goal.finding_ids, "supervisor goal finding IDs", {allowEmpty: true});
  validateBoundary(goal.boundary);
  sortedUnique(goal.stop_conditions, "supervisor goal stop conditions");
  requireUtc(goal.created_at_utc, "supervisor goal creation time");
  requireSha(goal.goal_sha256, "supervisor goal digest");
  assert(goal.goal_sha256 === stableGoalDigest(goal) || goal.goal_sha256 === digestWithout(goal, "goal_sha256"), "supervisor goal digest mismatch");
  if (goal.action === "STOP_HARD_BOUNDARY") assert(goal.boundary.hard_stop, "hard-stop goal lacks a hard boundary");
  if (goal.action === "REVIEW_SOFT_BOUNDARY") assert(goal.boundary.soft_review, "soft-review goal lacks a soft boundary");
  return goal;
}

export function compileSupervisorTick({observation, goal, routeStatus, routeReadback = null, routeError = null}) {
  validateSupervisorObservation(observation);
  validateSupervisorGoal(goal);
  requireString(routeStatus, "supervisor route status");
  assert(["NOT_ATTEMPTED", "ROUTED", "STOPPED_HARD_BOUNDARY", "ROUTE_FAILED"].includes(routeStatus), "supervisor route status is invalid");
  if (routeStatus === "ROUTED") requireRecord(routeReadback, "supervisor route readback");
  if (routeStatus === "ROUTE_FAILED") requireString(routeError, "supervisor route error");
  if (goal.action === "STOP_HARD_BOUNDARY") assert(routeStatus === "STOPPED_HARD_BOUNDARY", "hard-boundary goal must stop before routing");
  if (goal.action !== "STOP_HARD_BOUNDARY") assert(routeStatus !== "STOPPED_HARD_BOUNDARY", "non-boundary goal cannot claim a hard stop");
  const safeRouteError = routeStatus === "ROUTE_FAILED" ? opaqueError(routeError) : null;
  const tick = {
    schema: TICK_SCHEMA,
    version: 1,
    controller_role: CONTROLLER_ROLE,
    goal_id: goal.goal_id,
    goal_sha256: goal.goal_sha256,
    observation_sha256: observation.observation_sha256,
    action: goal.action,
    route_status: routeStatus,
    route_readback: routeReadback,
    route_error: safeRouteError,
    observed_at_utc: observation.observed_at_utc,
    tick_sha256: null,
  };
  tick.tick_sha256 = digestWithout(tick, "tick_sha256");
  return validateSupervisorTick(tick);
}

export function validateSupervisorTick(tick) {
  const keys = ["schema", "version", "controller_role", "goal_id", "goal_sha256", "observation_sha256", "action", "route_status", "route_readback", "route_error", "observed_at_utc", "tick_sha256"];
  exactKeys(tick, keys, "supervisor tick");
  assert(tick.schema === TICK_SCHEMA && tick.version === 1 && tick.controller_role === CONTROLLER_ROLE, "supervisor tick identity is invalid");
  requireIdentifier(tick.goal_id, "supervisor tick goal ID");
  requireSha(tick.goal_sha256, "supervisor tick goal digest");
  requireSha(tick.observation_sha256, "supervisor tick observation digest");
  assert(ACTIONS.includes(tick.action), "supervisor tick action is invalid");
  assert(["NOT_ATTEMPTED", "ROUTED", "STOPPED_HARD_BOUNDARY", "ROUTE_FAILED"].includes(tick.route_status), "supervisor tick route status is invalid");
  if (tick.route_status === "ROUTED") requireRecord(tick.route_readback, "supervisor tick route readback");
  else assert(tick.route_readback === null, "supervisor tick has an unexpected route readback");
  if (tick.route_status === "ROUTE_FAILED") requireString(tick.route_error, "supervisor tick route error");
  else assert(tick.route_error === null, "supervisor tick has an unexpected route error");
  requireUtc(tick.observed_at_utc, "supervisor tick time");
  requireSha(tick.tick_sha256, "supervisor tick digest");
  assert(tick.tick_sha256 === digestWithout(tick, "tick_sha256"), "supervisor tick digest mismatch");
  return tick;
}

function canonicalRoot(root) {
  requireString(root, "supervisor authority root");
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "supervisor authority root must be a real directory");
  return resolved;
}

function safeRecordPath(root, relativePath) {
  const resolvedRoot = canonicalRoot(root);
  requireString(relativePath, "supervisor record path");
  assert(!path.isAbsolute(relativePath), "supervisor record path must be relative");
  const target = path.resolve(resolvedRoot, relativePath);
  assert(target.startsWith(`${resolvedRoot}${path.sep}`), "supervisor record path escapes authority root");
  return target;
}

export function readSupervisorRecord({authorityRoot, recordPath}) {
  const target = safeRecordPath(authorityRoot, recordPath);
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), "supervisor record must be a regular file");
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

export function writeSupervisorRecordCompareAndSwap({authorityRoot, recordPath, expectedDigest = null, record, digestField}) {
  const target = safeRecordPath(authorityRoot, recordPath);
  requireString(digestField, "supervisor record digest field");
  requireRecord(record, "supervisor record");
  requireSha(record[digestField], "supervisor record digest");
  const current = readSupervisorRecord({authorityRoot, recordPath});
  if (expectedDigest === null) assert(current === null, "supervisor record already exists");
  else {
    requireSha(expectedDigest, "supervisor expected record digest");
    assert(current !== null && current[digestField] === expectedDigest, "supervisor record compare-and-swap parent is stale");
  }
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const lock = `${target}.lock`;
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  let lockHeld = false;
  try {
    fs.writeFileSync(lock, `${process.pid}\n`, {flag: "wx", mode: 0o600});
    lockHeld = true;
    fs.writeFileSync(temporary, `${canonicalSupervisorJson(record)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockHeld && fs.existsSync(lock)) fs.unlinkSync(lock);
  }
  const readback = readSupervisorRecord({authorityRoot, recordPath});
  assert(readback?.[digestField] === record[digestField], "supervisor record readback differs");
  return readback;
}

export function runSupervisorIteration({observation, route = null}) {
  const goal = compileSupervisorGoal({observation});
  if (goal.action === "STOP_HARD_BOUNDARY") {
    return {goal, tick: compileSupervisorTick({observation, goal, routeStatus: "STOPPED_HARD_BOUNDARY"})};
  }
  if (route === null) return {goal, tick: compileSupervisorTick({observation, goal, routeStatus: "NOT_ATTEMPTED"})};
  try {
    const routeReadback = route(goal);
    return {goal, tick: compileSupervisorTick({observation, goal, routeStatus: "ROUTED", routeReadback})};
  } catch (error) {
    const routeError = JSON.stringify(error?.message ?? String(error));
    return {goal, tick: compileSupervisorTick({observation, goal, routeStatus: "ROUTE_FAILED", routeError})};
  }
}

export async function runSupervisorIterationAsync({observation, route = null}) {
  const goal = compileSupervisorGoal({observation});
  if (goal.action === "STOP_HARD_BOUNDARY") {
    return {goal, tick: compileSupervisorTick({observation, goal, routeStatus: "STOPPED_HARD_BOUNDARY"})};
  }
  if (route === null) return {goal, tick: compileSupervisorTick({observation, goal, routeStatus: "NOT_ATTEMPTED"})};
  try {
    const routeReadback = await route(goal);
    return {goal, tick: compileSupervisorTick({observation, goal, routeStatus: "ROUTED", routeReadback})};
  } catch (error) {
    const routeError = JSON.stringify(error?.message ?? String(error));
    return {goal, tick: compileSupervisorTick({observation, goal, routeStatus: "ROUTE_FAILED", routeError})};
  }
}

export const CONTROLLER_SUPERVISOR_SCHEMAS = Object.freeze({
  observation: OBSERVATION_SCHEMA,
  goal: GOAL_SCHEMA,
  tick: TICK_SCHEMA,
});
