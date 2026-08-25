#!/usr/bin/env node

/*
 * Read-only liveness monitor.  It records a deduplicated observation and
 * routes a typed report; it never stops processes, archives tasks, wakes a
 * worker, or changes custody.  Closeout projection reconciliation is kept in
 * campaign-closeout-lifecycle.mjs and is intentionally injected here.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {
  LOW_CONFIDENCE_CORRELATION_BLOCKER,
  THREAD_READBACK_PROJECTION_DIVERGENCE,
  reconcileThreadReadbackProjection,
} from "./campaign-closeout-lifecycle.mjs";

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
}

function requireArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
}

function sorted(values) {
  return [...values].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

function processIdentity(process) {
  assert(isRecord(process), "liveness process observation must be an object");
  for (const field of ["pid", "start_identity", "command", "cwd", "owner"]) requireString(String(process[field]), `liveness process ${field}`);
  return {
    pid: String(process.pid),
    start_identity: String(process.start_identity),
    command: String(process.command),
    cwd: String(process.cwd),
    owner: String(process.owner),
    listener: process.listener === undefined ? null : String(process.listener),
    parent_pid: process.parent_pid === undefined ? null : String(process.parent_pid),
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
  const observe = (input = {}) => {
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
  return Object.freeze({observe, read: () => ({state, sequence, signatures: sorted([...signatures])})});
}
