#!/usr/bin/env node

/*
 * Read-only liveness monitor.  It records a deduplicated observation and
 * routes a typed report; it never stops processes, archives tasks, wakes a
 * worker, or changes custody.  Closeout projection reconciliation is kept in
 * campaign-closeout-lifecycle.mjs and is intentionally injected here.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {
  ACTIVE_OR_PROJECTION_LAG,
  LOW_CONFIDENCE_CORRELATION_BLOCKER,
  MATERIAL_LIVENESS_ACTIVE,
  MATERIAL_LIVENESS_STAGNANT,
  PROJECTION_LIVENESS_EVIDENCE_REQUIRED,
  SAME_TASK_RECOVERY_REQUIRED,
  SCHEDULER_PROJECTION_LIVENESS_SCHEMA,
  TYPED_HOST_CAPABILITY_ESCALATION,
  compileProjectionLivenessObservation,
  compileSchedulerProjectionLivenessObservation,
  THREAD_READBACK_PROJECTION_DIVERGENCE,
  reconcileThreadReadbackProjection,
  validateProjectionLivenessObservation,
  validateSchedulerProjectionLivenessObservation,
} from "./campaign-closeout-lifecycle.mjs";

export {
  ACTIVE_OR_PROJECTION_LAG,
  MATERIAL_LIVENESS_ACTIVE,
  MATERIAL_LIVENESS_STAGNANT,
  PROJECTION_LIVENESS_EVIDENCE_REQUIRED,
  SAME_TASK_RECOVERY_REQUIRED,
  SCHEDULER_PROJECTION_LIVENESS_SCHEMA,
  TYPED_HOST_CAPABILITY_ESCALATION,
  compileProjectionLivenessObservation,
  compileSchedulerProjectionLivenessObservation,
  validateProjectionLivenessObservation,
  validateSchedulerProjectionLivenessObservation,
};

export const LIVENESS_SENTINEL_SCHEMA = "agentos.liveness_sentinel.v1";
export const LIVENESS_STATES = Object.freeze(["ACTIVE_MONITORING", "QUIESCENT"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
  return value;
}

function processPid(value, label) {
  if (typeof value === "number") {
    assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer or canonical digit string`);
    return String(value);
  }
  assert(typeof value === "string" && /^[1-9]\d*$/u.test(value), `${label} must be a positive safe integer or canonical digit string`);
  const numeric = Number(value);
  assert(Number.isSafeInteger(numeric) && numeric > 0, `${label} must be a positive safe integer or canonical digit string`);
  return String(numeric);
}

function optionalProcessPid(value, label) {
  if (value === undefined || value === null) return null;
  return processPid(value, label);
}

function optionalString(value, label) {
  if (value === undefined || value === null) return null;
  return requireString(value, label);
}

function requireArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
}

function sorted(values) {
  return [...values].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

function processIdentity(process) {
  assert(isRecord(process), "liveness process observation must be an object");
  return {
    pid: processPid(process.pid, "liveness process pid"),
    start_identity: requireString(process.start_identity, "liveness process start_identity"),
    command: requireString(process.command, "liveness process command"),
    cwd: requireString(process.cwd, "liveness process cwd"),
    owner: requireString(process.owner, "liveness process owner"),
    listener: optionalString(process.listener, "liveness process listener"),
    parent_pid: optionalProcessPid(process.parent_pid, "liveness process parent_pid"),
  };
}

export function livenessSignature({taskId, turnId, className, evidence} = {}) {
  requireString(taskId, "liveness task ID");
  requireString(turnId, "liveness turn ID");
  requireString(className, "liveness class");
  return canonicalDigest({task_id: taskId, turn_id: turnId, class: className, evidence: evidence ?? null});
}

export function classifySilentTurn({taskId, turnId, projection, durableHistory = null, adapter = undefined, originalClassification = null} = {}) {
  const receipt = reconcileThreadReadbackProjection({taskId, turnId, projection, durableHistory, adapter, originalClassification});
  if (receipt.status === THREAD_READBACK_PROJECTION_DIVERGENCE) {
    return {classification: THREAD_READBACK_PROJECTION_DIVERGENCE, confidence: receipt.confidence, receipt};
  }
  if (receipt.status === LOW_CONFIDENCE_CORRELATION_BLOCKER) {
    return {classification: LOW_CONFIDENCE_CORRELATION_BLOCKER, confidence: receipt.confidence, receipt};
  }
  return {classification: "NO_SILENCE", confidence: receipt.confidence, receipt};
}

export function validateLivenessObservation(observation) {
  assert(isRecord(observation), "liveness observation must be an object");
  requireArray(observation.tasks, "liveness task roster");
  requireArray(observation.processes, "liveness process roster");
  for (const task of observation.tasks) {
    assert(isRecord(task), "liveness task roster entry must be an object");
    requireString(task.task_id, "liveness task ID");
    requireString(task.role, "liveness task role");
    requireString(task.status, "liveness task status");
  }
  const processes = observation.processes.map(processIdentity);
  const processKeys = processes.map((process) => `${process.pid}\u0000${process.start_identity}`);
  assert(new Set(processKeys).size === processKeys.length, "liveness process roster contains duplicate identities");
  return {
    tasks: observation.tasks.map((task) => ({...task})).sort((a, b) => Buffer.compare(Buffer.from(a.task_id), Buffer.from(b.task_id))),
    processes: processes.sort((a, b) => Buffer.compare(Buffer.from(`${a.pid}\u0000${a.start_identity}`), Buffer.from(`${b.pid}\u0000${b.start_identity}`))),
  };
}

export function createLivenessSentinel({readRoster = null, readProcesses = null} = {}) {
  assert(readRoster === null || typeof readRoster === "function", "liveness roster reader must be a function");
  assert(readProcesses === null || typeof readProcesses === "function", "liveness process reader must be a function");
  const signatures = new Set();
  let state = "QUIESCENT";
  let sequence = 0;
  const observeProjection = (input = {}) => {
    const result = compileSchedulerProjectionLivenessObservation(input);
    validateSchedulerProjectionLivenessObservation(result);
    return result;
  };
  const observe = (input = {}) => {
    if (input.projection !== undefined || input.durable_session !== undefined || input.durableSession !== undefined) {
      return observeProjection({
        ...input,
        durableSession: input.durableSession ?? input.durable_session,
        taskId: input.taskId ?? input.task_id,
        laneId: input.laneId ?? input.lane_id ?? input.lane ?? "LIVENESS-SENTINEL",
      });
    }
    const rawTasks = input.tasks ?? (readRoster ? readRoster() : []);
    const rawProcesses = input.processes ?? (readProcesses ? readProcesses() : []);
    const observation = validateLivenessObservation({tasks: rawTasks, processes: rawProcesses});
    const monitoring = observation.tasks.length > 0 || observation.processes.length > 0 || input.pending_transition === true || input.unconsumed_receipt === true;
    state = monitoring ? "ACTIVE_MONITORING" : "QUIESCENT";
    const className = input.classification ?? (monitoring ? "MATERIAL_LIVENESS" : "NO_OPEN_MONITORING_CONDITION");
    // A missing turn identity is one stable observation stream, not a new
    // event on every polling pass; otherwise an unchanged stall would report
    // forever merely because the sentinel incremented its local sequence.
    const signature = livenessSignature({taskId: input.task_id ?? "SENTINEL", turnId: input.turn_id ?? "OBSERVATION", className, evidence: observation});
    const duplicate = signatures.has(signature);
    if (!duplicate) signatures.add(signature);
    sequence += 1;
    return {
      schema: LIVENESS_SENTINEL_SCHEMA,
      version: 1,
      sequence,
      state,
      classification: className,
      signature,
      duplicate,
      report_action: duplicate ? "KEEP_OPEN_NO_RESEND" : monitoring ? "ONE_DEDUPLICATED_REPORT" : "QUIET",
      tasks: observation.tasks,
      processes: observation.processes,
      lifecycle_action_taken: false,
      custody_mutated: false,
    };
  };
  return Object.freeze({observe, observeProjection, read: () => ({state, sequence, signatures: sorted([...signatures])})});
}
