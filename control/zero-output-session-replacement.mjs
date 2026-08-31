#!/usr/bin/env node

import {canonicalDigest} from "./content-addressing.mjs";

export const ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA = "agentos.zero_output_session_replacement.v1";
export const ZERO_OUTPUT_MINIMUM_ELAPSED_SECONDS = 30;
export const PERMANENT_SESSION_ROLLOVER_SCHEMA = "agentos.permanent_session_rollover.v1";
export const PERMANENT_SESSION_ROLLOVER_ADMITTED = "ROLLOVER_ADMITTED";
export const PERMANENT_SESSION_ROLLOVER_REJECTED = "ROLLOVER_REJECTED";

const SHA = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
function assert(condition, message) { if (!condition) throw new Error(message); }
function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function sha(value, label) { assert(typeof value === "string" && SHA.test(value), `${label} must be SHA-256`); }
function count(value, label) { assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`); }
function utcMillis(value, label) {
  assert(typeof value === "string" && UTC.test(value), `${label} must be UTC`);
  const millis = Date.parse(value);
  const canonicalInput = value.includes(".") ? value : value.replace(/Z$/u, ".000Z");
  assert(Number.isFinite(millis) && new Date(millis).toISOString() === canonicalInput, `${label} is not a valid UTC instant`);
  return millis;
}
function validateTurn(turn) {
  assert(turn && typeof turn === "object", "turn observation is required");
  assert(turn.status === "COMPLETED" && turn.error === null, "only a completed non-error turn may be classified as silent");
  count(turn.elapsed_seconds, "turn elapsed seconds");
  assert(turn.elapsed_seconds >= ZERO_OUTPUT_MINIMUM_ELAPSED_SECONDS, "turn is below the zero-output observation floor");
  for (const field of ["assistant_items", "tool_items", "command_items", "durable_result_items", "live_process_count"]) count(turn[field], `turn ${field}`);
  assert(turn.assistant_items + turn.tool_items + turn.command_items + turn.durable_result_items === 0, "turn contains material output and may not be replaced as silent");
  assert(turn.live_process_count === 0, "session still has a live process");
  sha(turn.turn_readback_sha256, "turn readback digest");
  assert(turn.turn_readback_sha256 === canonicalDigest({...turn, turn_readback_sha256: null}), "turn readback digest does not bind the observation");
  return turn;
}
function validateCustody(custody) {
  assert(custody && typeof custody === "object", "custody is required");
  for (const field of ["worktree_ref", "branch_ref"]) id(custody[field], `custody ${field}`);
  for (const field of ["head", "tree", "status_sha256", "handoff_sha256"]) sha(custody[field], `custody ${field}`);
  assert(custody.preserved === true && custody.reset_or_cleanup === false, "custody must be preserved without reset or cleanup");
  return custody;
}
function validateReplacement(replacement, {failedSessionId, pairedSessionId, custody, evaluatedAtUtc}) {
  assert(replacement && typeof replacement === "object", "replacement probe is required");
  for (const field of ["session_id", "project_ref", "cwd_ref", "worktree_ref"]) id(replacement[field], `replacement ${field}`);
  assert(replacement.session_id !== failedSessionId && replacement.session_id !== pairedSessionId, "replacement identity collides with the pair");
  assert(replacement.project_bound === true && replacement.cwd_verified === true, "replacement must be project-bound with verified cwd");
  const observedMillis = utcMillis(replacement.observed_at_utc, "replacement observation");
  const evaluatedMillis = utcMillis(evaluatedAtUtc, "replacement evaluation");
  assert(evaluatedMillis >= observedMillis, "replacement observation is in the future");
  count(replacement.freshness_seconds, "replacement freshness seconds");
  assert(replacement.freshness_seconds === Math.floor((evaluatedMillis - observedMillis) / 1000), "replacement freshness is not bound to observation and evaluation time");
  assert(replacement.freshness_seconds <= 300, "replacement execution proof is stale");
  count(replacement.visible_assistant_items, "replacement visible assistant items");
  count(replacement.visible_tool_items, "replacement visible tool items");
  assert(replacement.visible_assistant_items + replacement.visible_tool_items > 0, "replacement visible-execution probe failed");
  assert(replacement.worktree_ref === custody.worktree_ref, "replacement worktree does not match preserved custody");
  assert(replacement.same_worktree === true && replacement.custody_mutated === false, "replacement must adopt preserved custody without mutation");
  sha(replacement.probe_readback_sha256, "replacement probe digest");
  assert(replacement.probe_readback_sha256 === canonicalDigest({...replacement, probe_readback_sha256: null}), "replacement probe digest does not bind project/cwd/worktree evidence");
  return replacement;
}

export function compileZeroOutputSessionReplacement({
  replacementId,
  laneId,
  role,
  failedSessionId,
  pairedSessionId,
  turn,
  custody,
  replacement,
  evaluatedAtUtc,
  unrelatedLanesContinue = true,
} = {}) {
  for (const [value, label] of [[replacementId, "replacement ID"], [laneId, "lane ID"], [role, "role"], [failedSessionId, "failed session ID"], [pairedSessionId, "paired session ID"]]) id(value, label);
  assert(replacementId !== failedSessionId && replacementId !== pairedSessionId, "replacement operation identity collides with the pair");
  validateTurn(turn);
  validateCustody(custody);
  utcMillis(evaluatedAtUtc, "replacement evaluation");
  validateReplacement(replacement, {failedSessionId, pairedSessionId, custody, evaluatedAtUtc});
  assert(unrelatedLanesContinue === true, "one silent session may not stop unrelated lanes");

  const decision = {
    schema: ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA,
    version: 1,
    replacement_id: replacementId,
    lane_id: laneId,
    role,
    failed_session_id: failedSessionId,
    paired_session_id: pairedSessionId,
    classification: "HOST_SESSION_ZERO_OUTPUT",
    action: "ADMIT_VISIBLE_REPLACEMENT_AND_ARCHIVE_FAILED_SESSION",
    controller_approval_required: false,
    ordinary_pair_autonomy_preserved: true,
    unrelated_lanes_continue: true,
    retry_same_session: false,
    evaluated_at_utc: evaluatedAtUtc,
    turn: structuredClone(turn),
    custody: structuredClone(custody),
    replacement: structuredClone(replacement),
    decision_sha256: null,
  };
  decision.decision_sha256 = canonicalDigest({...decision, decision_sha256: null});
  return decision;
}

export function validateZeroOutputSessionReplacement(decision) {
  assert(decision?.schema === ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA && decision.version === 1, "replacement decision schema mismatch");
  assert(decision.classification === "HOST_SESSION_ZERO_OUTPUT", "replacement classification mismatch");
  assert(decision.action === "ADMIT_VISIBLE_REPLACEMENT_AND_ARCHIVE_FAILED_SESSION", "replacement action mismatch");
  assert(decision.controller_approval_required === false && decision.ordinary_pair_autonomy_preserved === true, "replacement added an approval gate or removed autonomy");
  assert(decision.unrelated_lanes_continue === true && decision.retry_same_session === false, "replacement may not stall other lanes or retry the failed session");
  id(decision.replacement_id, "replacement ID");
  id(decision.failed_session_id, "failed session ID");
  id(decision.paired_session_id, "paired session ID");
  assert(decision.replacement_id !== decision.failed_session_id && decision.replacement_id !== decision.paired_session_id, "replacement operation identity collides with the pair");
  validateTurn(decision.turn);
  validateCustody(decision.custody);
  utcMillis(decision.evaluated_at_utc, "replacement evaluation");
  validateReplacement(decision.replacement, {failedSessionId: decision.failed_session_id, pairedSessionId: decision.paired_session_id, custody: decision.custody, evaluatedAtUtc: decision.evaluated_at_utc});
  sha(decision.decision_sha256, "replacement decision digest");
  assert(decision.decision_sha256 === canonicalDigest({...decision, decision_sha256: null}), "replacement decision digest mismatch");
  return decision;
}

function rolloverRecord(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} is required`);
  return value;
}

function rolloverIdentifier(value, label) {
  id(value, label);
  return value;
}

function rolloverDigest(value, label) {
  sha(value, label);
  return value;
}

function stateOwned(value, label) {
  rolloverRecord(value, label);
  assert(value.state_owned === true || value.state_owned === "AGENTOS_STATE" || value.stateOwned === true || value.stateOwned === "AGENTOS_STATE" || value.owner === "AGENTOS_STATE" || value.owner_scope === "AGENTOS_STATE" || value.state_owner === "AGENTOS_STATE", `${label} must be owned by durable AgentOS State`);
  return value;
}

function entryIdentity(entry, keys) {
  if (!entry || typeof entry !== "object") return null;
  for (const key of keys) if (entry[key] !== undefined && entry[key] !== null) return String(entry[key]);
  return null;
}

/**
 * Admit exactly one permanent-task session successor at a clean stopping
 * point.  The old session and every continuity record remain retained; this
 * pure compiler never starts a task, timer, or Scheduler job.
 */
export function compilePermanentSessionRollover({
  taskId,
  task_id,
  roleId,
  role_id,
  oldSession,
  old_session,
  successorSession,
  successor_session,
  queue,
  state_queue,
  custody,
  state_custody,
  incident,
  state_incident,
  stoppingPoint,
  stopping_point,
  existingSessions = [],
  existing_sessions,
  existingRoles = [],
  existing_roles,
  existingTimers = [],
  existing_timers,
  existingJobs = [],
  existing_jobs,
  evaluatedAtUtc = new Date().toISOString(),
  evaluated_at_utc,
} = {}) {
  taskId = taskId ?? task_id;
  roleId = roleId ?? role_id;
  oldSession = oldSession ?? old_session;
  successorSession = successorSession ?? successor_session;
  queue = queue ?? state_queue;
  custody = custody ?? state_custody;
  incident = incident ?? state_incident;
  stoppingPoint = stoppingPoint ?? stopping_point;
  existingSessions = existing_sessions ?? existingSessions;
  existingRoles = existing_roles ?? existingRoles;
  existingTimers = existing_timers ?? existingTimers;
  existingJobs = existing_jobs ?? existingJobs;
  evaluatedAtUtc = evaluated_at_utc ?? evaluatedAtUtc;
  rolloverIdentifier(taskId, "rollover task ID");
  rolloverIdentifier(roleId, "rollover permanent role ID");
  rolloverRecord(oldSession, "old permanent session");
  rolloverRecord(successorSession, "successor permanent session");
  const oldId = rolloverIdentifier(oldSession.session_id ?? oldSession.id, "old permanent session ID");
  const successorId = rolloverIdentifier(successorSession.session_id ?? successorSession.id, "successor permanent session ID");
  assert(oldId !== successorId, "successor session must have a distinct identity");
  assert(oldSession.task_id === undefined || oldSession.task_id === taskId, "old session task identity mismatch");
  assert(successorSession.task_id === undefined || successorSession.task_id === taskId, "successor session task identity mismatch");
  assert(oldSession.retained !== false && oldSession.archived !== true, "old permanent session must remain retained");
  assert(["CLEAN", "CLEAN_STOPPING_POINT", "STOPPED", "CHECKPOINT_REACHED", "COMPLETED"].includes(String(oldSession.status ?? oldSession.lifecycle ?? "CLEAN_STOPPING_POINT").toUpperCase()), "old session is not at a clean stopping point");
  assert(successorSession.successor === true || successorSession.role_id === undefined || successorSession.role_id === roleId, "successor role binding is invalid");
  const sessions = Array.isArray(existingSessions) ? existingSessions : [];
  const duplicateSession = sessions.some((entry) => entryIdentity(entry, ["session_id", "sessionId", "id"]) === successorId);
  assert(!duplicateSession, "duplicate permanent successor session is forbidden");
  const roles = Array.isArray(existingRoles) ? existingRoles : [];
  const timers = Array.isArray(existingTimers) ? existingTimers : [];
  const jobs = Array.isArray(existingJobs) ? existingJobs : [];
  const successorRole = entryIdentity(successorSession, ["role_id", "roleId", "role"]);
  if (successorRole) assert(!roles.some((entry) => entryIdentity(entry, ["role_id", "roleId", "role"]) === successorRole), "duplicate permanent role is forbidden");
  const successorTimer = entryIdentity(successorSession, ["timer_id", "timerId"]);
  if (successorTimer) assert(!timers.some((entry) => entryIdentity(entry, ["timer_id", "timerId"]) === successorTimer), "duplicate permanent timer is forbidden");
  const successorJob = entryIdentity(successorSession, ["job_id", "jobId", "scheduler_job_id", "schedulerJobId"]);
  if (successorJob) assert(!jobs.some((entry) => entryIdentity(entry, ["job_id", "jobId", "scheduler_job_id", "schedulerJobId"]) === successorJob), "duplicate Scheduler job is forbidden");
  assert(!Array.isArray(queue) && !Array.isArray(custody) && !Array.isArray(incident) && !Array.isArray(stoppingPoint), "rollover continuity records must be objects");
  stateOwned(queue, "rollover queue");
  stateOwned(custody, "rollover custody");
  stateOwned(incident, "rollover incident");
  stateOwned(stoppingPoint, "rollover stopping point");
  assert(stoppingPoint.clean === true || stoppingPoint.complete === true || stoppingPoint.clean_stopping_point === true || stoppingPoint.status === "CLEAN_STOPPING_POINT", "rollover requires a clean stopping point");
  for (const [value, label] of [[queue.queue_sha256 ?? queue.queue_digest_sha256 ?? queue.digest_sha256 ?? queue.sha256, "rollover queue digest"], [custody.custody_sha256 ?? custody.custody_digest_sha256 ?? custody.digest_sha256 ?? custody.sha256, "rollover custody digest"], [incident.incident_sha256 ?? incident.incident_digest_sha256 ?? incident.digest_sha256 ?? incident.sha256, "rollover incident digest"], [stoppingPoint.stopping_point_sha256 ?? stoppingPoint.stopping_point_digest_sha256 ?? stoppingPoint.digest_sha256 ?? stoppingPoint.sha256, "rollover stopping-point digest"]]) rolloverDigest(value, label);
  assert(queue.chat_history_owned !== true && custody.chat_history_owned !== true && incident.chat_history_owned !== true && stoppingPoint.chat_history_owned !== true, "chat-history-owned rollover continuity is forbidden");
  assert(typeof evaluatedAtUtc === "string" && Number.isFinite(Date.parse(evaluatedAtUtc)), "rollover evaluation time must be UTC");
  const decision = {
    schema: PERMANENT_SESSION_ROLLOVER_SCHEMA,
    version: 1,
    status: PERMANENT_SESSION_ROLLOVER_ADMITTED,
    task_id: taskId,
    role_id: roleId,
    old_session: {...oldSession, session_id: oldId},
    successor_session: {...successorSession, session_id: successorId},
    continuity: {queue: structuredClone(queue), custody: structuredClone(custody), incident: structuredClone(incident), stopping_point: structuredClone(stoppingPoint), owner: "AGENTOS_STATE"},
    retained_old_session: true,
    exactly_one_successor: true,
    duplicate_role_denied: true,
    duplicate_timer_denied: true,
    duplicate_scheduler_job_denied: true,
    chat_history_owned_state_denied: true,
    evaluated_at_utc: evaluatedAtUtc,
    rollover_sha256: null,
  };
  decision.rollover_sha256 = canonicalDigest({...decision, rollover_sha256: null});
  return decision;
}

export function validatePermanentSessionRollover(decision) {
  rolloverRecord(decision, "permanent session rollover decision");
  assert(decision.schema === PERMANENT_SESSION_ROLLOVER_SCHEMA && decision.version === 1, "permanent session rollover schema mismatch");
  assert(decision.status === PERMANENT_SESSION_ROLLOVER_ADMITTED, "permanent session rollover is not admitted");
  rolloverIdentifier(decision.task_id, "rollover task ID");
  rolloverIdentifier(decision.role_id, "rollover role ID");
  rolloverRecord(decision.old_session, "rollover old session");
  rolloverRecord(decision.successor_session, "rollover successor session");
  assert(decision.retained_old_session === true && decision.exactly_one_successor === true, "rollover cardinality/retention is invalid");
  assert(decision.duplicate_role_denied === true && decision.duplicate_timer_denied === true && decision.duplicate_scheduler_job_denied === true && decision.chat_history_owned_state_denied === true, "rollover denial invariants are missing");
  stateOwned(decision.continuity?.queue, "rollover queue");
  stateOwned(decision.continuity?.custody, "rollover custody");
  stateOwned(decision.continuity?.incident, "rollover incident");
  stateOwned(decision.continuity?.stopping_point, "rollover stopping point");
  rolloverDigest(decision.rollover_sha256, "rollover digest");
  assert(decision.rollover_sha256 === canonicalDigest({...decision, rollover_sha256: null}), "permanent session rollover digest mismatch");
  return decision;
}

export const compilePermanentTaskSessionRollover = compilePermanentSessionRollover;
export const validatePermanentTaskSessionRollover = validatePermanentSessionRollover;
