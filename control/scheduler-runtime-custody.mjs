#!/usr/bin/env node

/*
 * AgentOS 3 Scheduler/Runtime custody substrate.
 *
 * This module is intentionally effect-free. It compiles and validates the
 * durable CAS state that a host adapter must obey, but it never spawns,
 * signals, builds, deploys, rolls back, authenticates, or mutates a consumer.
 * The Scheduler owns queue/capacity/worktree/process custody; Runtime owns
 * read-only discovery and capability-bound action preparation. Controllers
 * can observe or request lifecycle recovery, but cannot execute heavy work.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertPersistedRecordSafe,
  canonicalDigest,
} from "./content-addressing.mjs";
import {
  PERMANENT_ROLE_AUTHORITY_SHA256,
  permanentRoleById,
} from "./permanent-role-authority.mjs";
import {validateHybridSchedulerRequest} from "./hybrid-scheduler.mjs";

export const SCHEDULER_RUNTIME_CUSTODY_POLICY_SCHEMA = "agentos.scheduler_runtime_custody_policy.v1";
export const SCHEDULER_RUNTIME_CUSTODY_STATE_SCHEMA = "agentos.scheduler_runtime_custody_state.v1";
export const SCHEDULER_RUNTIME_PROCESS_SCHEMA = "agentos.scheduler_process_provenance.v1";
export const SCHEDULER_RUNTIME_ABSENCE_PROOF_SCHEMA = "agentos.scheduler_process_absence_proof.v1";
export const RUNTIME_CAPABILITY_SCHEMA = "agentos.runtime_bound_capability.v1";
export const RUNTIME_DISCOVERY_SCHEMA = "agentos.runtime_read_only_discovery.v1";
export const RUNTIME_ACTION_PREPARATION_SCHEMA = "agentos.runtime_action_preparation.v1";
export const SCHEDULER_RUNTIME_CUSTODY_VERSION = 1;

export const CUSTODY_WORKLOAD_CLASSES = Object.freeze([
  "ARTIFACT_BUILD",
  "DATABASE_EXCLUSIVE",
  "IO_BOUNDED",
  "LIGHTWEIGHT_CHECK",
  "NETWORK_BOUNDED",
  "NODE_BUILD",
  "RENDER",
  "RUST_BUILD",
]);

export const GLOBAL_HEAVY_WORKLOADS = Object.freeze([
  "ARTIFACT_BUILD",
  "NODE_BUILD",
  "RENDER",
  "RUST_BUILD",
]);

export const CUSTODY_JOB_STATES = Object.freeze([
  "SUBMITTED",
  "QUEUED",
  "LEASED",
  "RUNNING",
  "CANCEL_REQUESTED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);

export const RUNTIME_ACTIONS = Object.freeze([
  "BUILD",
  "DEPLOY",
  "DISCOVER_READ_ONLY",
  "ROLLBACK",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const OPAQUE_REF = /^opaque:[a-z][a-z0-9._-]*:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"]);
const ACTIVE_LEASE = new Set(["RESERVED", "PROCESS_BOUND", "CANCEL_REQUESTED"]);
const HEAVY_DENIED_ROLES = new Set(["AGENT_SPAWNER_COMPILER", "CONTROLLER", "INTENT_REGULATOR", "SCHEDULER"]);
const PROTECTED_RUNTIME_ACTIONS = new Set(["BUILD", "DEPLOY", "ROLLBACK"]);

export class SchedulerRuntimeCustodyError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "SchedulerRuntimeCustodyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SchedulerRuntimeCustodyError(code, message);
}

function assert(condition, code, message) {
  if (!condition) fail(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), "CUSTODY_SCHEMA_INVALID", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), "CUSTODY_SCHEMA_INVALID", `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), "CUSTODY_IDENTITY_INVALID", `${label} is invalid`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), "CUSTODY_DIGEST_INVALID", `${label} must be a lowercase SHA-256`);
}

function requireCandidate(value, label) {
  assert(typeof value === "string" && (GIT_OBJECT.test(value) || SHA256.test(value)), "CUSTODY_CANDIDATE_INVALID", `${label} is invalid`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && UTC.test(value) && Number.isFinite(Date.parse(value)), "CUSTODY_TIME_INVALID", `${label} must be UTC`);
}

function requireOpaqueRef(value, label) {
  assert(typeof value === "string" && OPAQUE_REF.test(value), "CUSTODY_REFERENCE_INVALID", `${label} must be opaque`);
}

function requirePositiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, "CUSTODY_NUMBER_INVALID", `${label} must be a positive integer`);
}

function digestWithout(value, field) {
  return canonicalDigest({...structuredClone(value), [field]: null});
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), "CUSTODY_SCHEMA_INVALID", `${label} must be an array`);
  assert(new Set(values).size === values.length, "CUSTODY_SCHEMA_INVALID", `${label} must be unique`);
  const sorted = [...values].sort();
  assert(JSON.stringify(sorted) === JSON.stringify(values), "CUSTODY_SCHEMA_INVALID", `${label} must be sorted`);
}

function unique(values, label) {
  assert(Array.isArray(values), "CUSTODY_SCHEMA_INVALID", `${label} must be an array`);
  assert(new Set(values).size === values.length, "CUSTODY_SCHEMA_INVALID", `${label} must be unique`);
}

function addressed(value, digestField) {
  const record = {...structuredClone(value), [digestField]: null};
  record[digestField] = digestWithout(record, digestField);
  return record;
}

function nextRevision(state, changes, event) {
  const next = {
    ...structuredClone(state),
    ...structuredClone(changes),
    revision: state.revision + 1,
    events: [...state.events, compileEvent(state, event)],
    state_sha256: null,
  };
  next.queue_index = deriveQueueIndex(next.jobs);
  next.state_sha256 = digestWithout(next, "state_sha256");
  return validateSchedulerRuntimeCustodyState(next);
}

function assertCas(state, expectedStateSha256) {
  validateSchedulerRuntimeCustodyState(state);
  requireSha(expectedStateSha256, "expected custody state digest");
  assert(state.state_sha256 === expectedStateSha256, "CUSTODY_CAS_MISMATCH", "custody state changed before transition");
}

function compileEvent(state, {eventType, subjectId, actorRole, actorId, observedAtUtc, detailSha256}) {
  requireIdentifier(eventType, "custody event type");
  requireIdentifier(subjectId, "custody event subject");
  requireIdentifier(actorRole, "custody event actor role");
  requireIdentifier(actorId, "custody event actor identity");
  requireUtc(observedAtUtc, "custody event time");
  requireSha(detailSha256, "custody event detail digest");
  return addressed({
    schema: "agentos.scheduler_runtime_custody_event.v1",
    version: 1,
    sequence: state.events.length + 1,
    prior_state_sha256: state.state_sha256,
    event_type: eventType,
    subject_id: subjectId,
    actor_role: actorRole,
    actor_id: actorId,
    observed_at_utc: observedAtUtc,
    detail_sha256: detailSha256,
    event_sha256: null,
  }, "event_sha256");
}

function validateEvent(event, index) {
  exactKeys(event, ["schema", "version", "sequence", "prior_state_sha256", "event_type", "subject_id", "actor_role", "actor_id", "observed_at_utc", "detail_sha256", "event_sha256"], `custody event ${index}`);
  assert(event.schema === "agentos.scheduler_runtime_custody_event.v1" && event.version === 1, "CUSTODY_SCHEMA_INVALID", "custody event identity is invalid");
  assert(event.sequence === index + 1, "CUSTODY_EVENT_SEQUENCE_INVALID", "custody event sequence is discontinuous");
  for (const field of ["event_type", "subject_id", "actor_role", "actor_id"]) requireIdentifier(event[field], `custody event ${field}`);
  requireUtc(event.observed_at_utc, "custody event time");
  for (const field of ["prior_state_sha256", "detail_sha256", "event_sha256"]) requireSha(event[field], `custody event ${field}`);
  assert(event.event_sha256 === digestWithout(event, "event_sha256"), "CUSTODY_DIGEST_INVALID", "custody event digest mismatch");
}

function poolFor(workloadClass) {
  if (GLOBAL_HEAVY_WORKLOADS.includes(workloadClass)) return "GLOBAL_HEAVY";
  if (workloadClass === "DATABASE_EXCLUSIVE") return "DATABASE_EXCLUSIVE";
  return "LIGHTWEIGHT";
}

export function compileSchedulerRuntimeCustodyPolicy({
  lightweightCapacity = 4,
  maxAttempts = 3,
  queueTimeoutSeconds = 900,
  runTimeoutSeconds = 1800,
  reservationTimeoutSeconds = 120,
  policyRevision = "CUSTODY-POLICY-1",
} = {}) {
  for (const [value, label] of [[lightweightCapacity, "lightweight capacity"], [maxAttempts, "retry bound"], [queueTimeoutSeconds, "queue timeout"], [runTimeoutSeconds, "run timeout"], [reservationTimeoutSeconds, "reservation timeout"]]) requirePositiveInteger(value, label);
  assert(lightweightCapacity <= 64 && maxAttempts <= 10, "CUSTODY_POLICY_INVALID", "custody policy is unbounded");
  requireIdentifier(policyRevision, "custody policy revision");
  return validateSchedulerRuntimeCustodyPolicy(addressed({
    schema: SCHEDULER_RUNTIME_CUSTODY_POLICY_SCHEMA,
    version: SCHEDULER_RUNTIME_CUSTODY_VERSION,
    status: "PREPARED_NOT_ACTIVATED",
    authority_graph_sha256: PERMANENT_ROLE_AUTHORITY_SHA256,
    policy_revision: policyRevision,
    global_heavy: {
      capacity: 1,
      workload_classes: [...GLOBAL_HEAVY_WORKLOADS],
      rust_node_render_mutually_exclusive: true,
    },
    lighter_capacity: lightweightCapacity,
    database_exclusive_capacity: 1,
    max_attempts: maxAttempts,
    queue_timeout_seconds: queueTimeoutSeconds,
    run_timeout_seconds: runTimeoutSeconds,
    reservation_timeout_seconds: reservationTimeoutSeconds,
    controller_heavy_execution: "DENY",
    stale_recovery: "EXACT_PROCESS_ABSENCE_OR_REUSED_IDENTITY_PROOF_REQUIRED",
    direct_effects: false,
    policy_sha256: null,
  }, "policy_sha256"));
}

export function validateSchedulerRuntimeCustodyPolicy(policy) {
  exactKeys(policy, ["schema", "version", "status", "authority_graph_sha256", "policy_revision", "global_heavy", "lighter_capacity", "database_exclusive_capacity", "max_attempts", "queue_timeout_seconds", "run_timeout_seconds", "reservation_timeout_seconds", "controller_heavy_execution", "stale_recovery", "direct_effects", "policy_sha256"], "custody policy");
  assert(policy.schema === SCHEDULER_RUNTIME_CUSTODY_POLICY_SCHEMA && policy.version === 1, "CUSTODY_POLICY_INVALID", "custody policy identity is invalid");
  assert(policy.status === "PREPARED_NOT_ACTIVATED" && policy.direct_effects === false, "CUSTODY_POLICY_INVALID", "custody policy must remain inactive and effect-free");
  assert(policy.authority_graph_sha256 === PERMANENT_ROLE_AUTHORITY_SHA256, "CUSTODY_AUTHORITY_STALE", "custody policy authority graph is stale");
  requireIdentifier(policy.policy_revision, "custody policy revision");
  exactKeys(policy.global_heavy, ["capacity", "workload_classes", "rust_node_render_mutually_exclusive"], "global heavy policy");
  assert(policy.global_heavy.capacity === 1 && policy.global_heavy.rust_node_render_mutually_exclusive === true, "CUSTODY_POLICY_INVALID", "global heavy mutex is weakened");
  assert(JSON.stringify(policy.global_heavy.workload_classes) === JSON.stringify(GLOBAL_HEAVY_WORKLOADS), "CUSTODY_POLICY_INVALID", "global heavy workload set differs");
  for (const field of ["lighter_capacity", "database_exclusive_capacity", "max_attempts", "queue_timeout_seconds", "run_timeout_seconds", "reservation_timeout_seconds"]) requirePositiveInteger(policy[field], `custody policy ${field}`);
  assert(policy.database_exclusive_capacity === 1 && policy.max_attempts <= 10 && policy.lighter_capacity <= 64, "CUSTODY_POLICY_INVALID", "custody capacity or retry bound is unsafe");
  assert(policy.controller_heavy_execution === "DENY" && policy.stale_recovery === "EXACT_PROCESS_ABSENCE_OR_REUSED_IDENTITY_PROOF_REQUIRED", "CUSTODY_POLICY_INVALID", "custody fail-closed rules are weakened");
  requireSha(policy.policy_sha256, "custody policy digest");
  assert(policy.policy_sha256 === digestWithout(policy, "policy_sha256"), "CUSTODY_DIGEST_INVALID", "custody policy digest mismatch");
  assertPersistedRecordSafe(policy);
  return policy;
}

export function compileSchedulerRuntimeCustodyState({policy = compileSchedulerRuntimeCustodyPolicy()} = {}) {
  validateSchedulerRuntimeCustodyPolicy(policy);
  const state = {
    schema: SCHEDULER_RUNTIME_CUSTODY_STATE_SCHEMA,
    version: SCHEDULER_RUNTIME_CUSTODY_VERSION,
    status: "PREPARED_NOT_ACTIVATED",
    authority_graph_sha256: PERMANENT_ROLE_AUTHORITY_SHA256,
    policy,
    revision: 0,
    worktrees: [],
    jobs: [],
    leases: [],
    queue_index: [],
    events: [],
    state_sha256: null,
  };
  state.state_sha256 = digestWithout(state, "state_sha256");
  return validateSchedulerRuntimeCustodyState(state);
}

function validateWorktree(worktree) {
  exactKeys(worktree, ["worktree_id", "repository_id", "working_directory_ref", "owner_task_id", "candidate_commit", "candidate_tree_or_digest", "dirty_patch_sha256", "lease_epoch", "status", "transfer", "worktree_sha256"], "custody worktree");
  for (const field of ["worktree_id", "repository_id", "owner_task_id"]) requireIdentifier(worktree[field], `custody worktree ${field}`);
  requireOpaqueRef(worktree.working_directory_ref, "custody worktree directory ref");
  requireCandidate(worktree.candidate_commit, "custody worktree commit");
  requireCandidate(worktree.candidate_tree_or_digest, "custody worktree tree");
  requireSha(worktree.dirty_patch_sha256, "custody worktree dirty patch digest");
  assert(Number.isSafeInteger(worktree.lease_epoch) && worktree.lease_epoch >= 0, "CUSTODY_WORKTREE_INVALID", "custody worktree epoch is invalid");
  assert(["ACTIVE", "TRANSFER_PREPARED"].includes(worktree.status), "CUSTODY_WORKTREE_INVALID", "custody worktree status is invalid");
  if (worktree.status === "ACTIVE") assert(worktree.transfer === null, "CUSTODY_WORKTREE_INVALID", "active worktree has a transfer");
  else {
    exactKeys(worktree.transfer, ["transfer_id", "from_task_id", "to_task_id", "expected_lease_epoch", "expected_commit", "expected_tree_or_digest", "expected_dirty_patch_sha256", "prepared_at_utc", "transfer_sha256"], "custody worktree transfer");
    for (const field of ["transfer_id", "from_task_id", "to_task_id"]) requireIdentifier(worktree.transfer[field], `custody transfer ${field}`);
    assert(worktree.transfer.from_task_id === worktree.owner_task_id, "CUSTODY_TRANSFER_INVALID", "transfer predecessor is not the current task owner");
    assert(worktree.transfer.expected_lease_epoch === worktree.lease_epoch, "CUSTODY_TRANSFER_INVALID", "transfer worktree epoch is stale");
    requireCandidate(worktree.transfer.expected_commit, "transfer expected commit");
    requireCandidate(worktree.transfer.expected_tree_or_digest, "transfer expected tree");
    requireSha(worktree.transfer.expected_dirty_patch_sha256, "transfer expected patch digest");
    requireUtc(worktree.transfer.prepared_at_utc, "transfer preparation time");
    requireSha(worktree.transfer.transfer_sha256, "transfer digest");
    assert(worktree.transfer.transfer_sha256 === digestWithout(worktree.transfer, "transfer_sha256"), "CUSTODY_DIGEST_INVALID", "transfer digest mismatch");
  }
  requireSha(worktree.worktree_sha256, "custody worktree digest");
  assert(worktree.worktree_sha256 === digestWithout(worktree, "worktree_sha256"), "CUSTODY_DIGEST_INVALID", "custody worktree digest mismatch");
}

function validateJob(job) {
  exactKeys(job, ["job_id", "request_id", "request_sha256", "requester_id", "requester_role", "task_id", "worktree_id", "worktree_epoch", "workload_class", "resource_pool", "status", "attempt", "max_attempts", "submitted_at_utc", "queued_at_utc", "leased_at_utc", "started_at_utc", "finished_at_utc", "lease_id", "terminal_reason", "job_sha256"], "custody job");
  for (const field of ["job_id", "request_id", "requester_id", "requester_role", "task_id", "worktree_id"]) requireIdentifier(job[field], `custody job ${field}`);
  requireSha(job.request_sha256, "custody job request digest");
  assert(Number.isSafeInteger(job.worktree_epoch) && job.worktree_epoch >= 0, "CUSTODY_JOB_INVALID", "job worktree epoch is invalid");
  assert(CUSTODY_WORKLOAD_CLASSES.includes(job.workload_class), "CUSTODY_JOB_INVALID", "job workload class is invalid");
  assert(job.resource_pool === poolFor(job.workload_class), "CUSTODY_JOB_INVALID", "job resource pool is invalid");
  assert(CUSTODY_JOB_STATES.includes(job.status), "CUSTODY_JOB_INVALID", "job status is invalid");
  requirePositiveInteger(job.attempt, "custody job attempt");
  requirePositiveInteger(job.max_attempts, "custody job retry bound");
  assert(job.attempt <= job.max_attempts, "CUSTODY_RETRY_EXHAUSTED", "job attempt exceeds retry bound");
  requireUtc(job.submitted_at_utc, "custody job submit time");
  for (const field of ["queued_at_utc", "leased_at_utc", "started_at_utc", "finished_at_utc"]) if (job[field] !== null) requireUtc(job[field], `custody job ${field}`);
  if (job.lease_id !== null) requireIdentifier(job.lease_id, "custody job lease ID");
  if (job.terminal_reason !== null) requireIdentifier(job.terminal_reason, "custody job terminal reason");
  if (TERMINAL.has(job.status)) assert(job.finished_at_utc !== null && job.lease_id === null, "CUSTODY_JOB_INVALID", "terminal job retained active custody");
  if (["LEASED", "RUNNING", "CANCEL_REQUESTED"].includes(job.status)) assert(job.lease_id !== null, "CUSTODY_JOB_INVALID", "active job lacks a lease");
  requireSha(job.job_sha256, "custody job digest");
  assert(job.job_sha256 === digestWithout(job, "job_sha256"), "CUSTODY_DIGEST_INVALID", "custody job digest mismatch");
}

export function validateProcessProvenance(provenance) {
  exactKeys(provenance, ["schema", "version", "pid", "ppid", "pgid", "cwd_ref", "executable_sha256", "argv_sha256", "started_at_utc", "start_identity_sha256", "process_instance_sha256"], "process provenance");
  assert(provenance.schema === SCHEDULER_RUNTIME_PROCESS_SCHEMA && provenance.version === 1, "PROCESS_PROVENANCE_INVALID", "process provenance identity is invalid");
  for (const field of ["pid", "ppid", "pgid"]) requirePositiveInteger(provenance[field], `process ${field}`);
  requireOpaqueRef(provenance.cwd_ref, "process CWD ref");
  for (const field of ["executable_sha256", "argv_sha256", "start_identity_sha256", "process_instance_sha256"]) requireSha(provenance[field], `process ${field}`);
  requireUtc(provenance.started_at_utc, "process start time");
  assert(provenance.process_instance_sha256 === digestWithout(provenance, "process_instance_sha256"), "PROCESS_PROVENANCE_INVALID", "process provenance digest mismatch");
  assertPersistedRecordSafe(provenance);
  return provenance;
}

export function compileProcessProvenance({pid, ppid, pgid, cwdRef, executableSha256, argvSha256, startedAtUtc, startIdentitySha256} = {}) {
  return validateProcessProvenance(addressed({
    schema: SCHEDULER_RUNTIME_PROCESS_SCHEMA,
    version: 1,
    pid,
    ppid,
    pgid,
    cwd_ref: cwdRef,
    executable_sha256: executableSha256,
    argv_sha256: argvSha256,
    started_at_utc: startedAtUtc,
    start_identity_sha256: startIdentitySha256,
    process_instance_sha256: null,
  }, "process_instance_sha256"));
}

function validateLease(lease) {
  exactKeys(lease, ["lease_id", "lease_epoch", "lease_token_sha256", "job_id", "requester_id", "task_id", "worktree_id", "worktree_epoch", "resource_pool", "slot", "status", "acquired_at_utc", "expires_at_utc", "process", "lease_sha256"], "custody lease");
  for (const field of ["lease_id", "job_id", "requester_id", "task_id", "worktree_id", "resource_pool"]) requireIdentifier(lease[field], `custody lease ${field}`);
  requirePositiveInteger(lease.lease_epoch, "custody lease epoch");
  requireSha(lease.lease_token_sha256, "custody lease token digest");
  assert(Number.isSafeInteger(lease.worktree_epoch) && lease.worktree_epoch >= 0, "CUSTODY_LEASE_INVALID", "custody lease worktree epoch is invalid");
  assert(Number.isSafeInteger(lease.slot) && lease.slot >= 0, "CUSTODY_LEASE_INVALID", "custody lease slot is invalid");
  assert(ACTIVE_LEASE.has(lease.status) || lease.status === "RELEASED", "CUSTODY_LEASE_INVALID", "custody lease status is invalid");
  requireUtc(lease.acquired_at_utc, "custody lease acquisition time");
  requireUtc(lease.expires_at_utc, "custody lease expiry");
  assert(Date.parse(lease.expires_at_utc) > Date.parse(lease.acquired_at_utc), "CUSTODY_LEASE_INVALID", "custody lease expiry is not after acquisition");
  if (lease.status === "RESERVED") assert(lease.process === null, "CUSTODY_LEASE_INVALID", "reserved lease already has process provenance");
  else if (lease.process !== null) validateProcessProvenance(lease.process);
  requireSha(lease.lease_sha256, "custody lease digest");
  assert(lease.lease_sha256 === digestWithout(lease, "lease_sha256"), "CUSTODY_DIGEST_INVALID", "custody lease digest mismatch");
}

function deriveQueueIndex(jobs) {
  return jobs.filter((job) => ["SUBMITTED", "QUEUED"].includes(job.status))
    .sort((left, right) => left.submitted_at_utc.localeCompare(right.submitted_at_utc) || left.job_id.localeCompare(right.job_id))
    .map((job) => job.job_id);
}

export function validateSchedulerRuntimeCustodyState(state) {
  exactKeys(state, ["schema", "version", "status", "authority_graph_sha256", "policy", "revision", "worktrees", "jobs", "leases", "queue_index", "events", "state_sha256"], "custody state");
  assert(state.schema === SCHEDULER_RUNTIME_CUSTODY_STATE_SCHEMA && state.version === 1, "CUSTODY_SCHEMA_INVALID", "custody state identity is invalid");
  assert(state.status === "PREPARED_NOT_ACTIVATED", "CUSTODY_EFFECTS_FORBIDDEN", "custody state must remain inactive");
  assert(state.authority_graph_sha256 === PERMANENT_ROLE_AUTHORITY_SHA256, "CUSTODY_AUTHORITY_STALE", "custody authority graph is stale");
  validateSchedulerRuntimeCustodyPolicy(state.policy);
  assert(Number.isSafeInteger(state.revision) && state.revision >= 0, "CUSTODY_REVISION_INVALID", "custody state revision is invalid");
  for (const [collection, validator] of [[state.worktrees, validateWorktree], [state.jobs, validateJob], [state.leases, validateLease]]) {
    assert(Array.isArray(collection), "CUSTODY_SCHEMA_INVALID", "custody collection is invalid");
    collection.forEach(validator);
  }
  for (const [collection, field] of [[state.worktrees, "worktree_id"], [state.jobs, "job_id"], [state.leases, "lease_id"]]) assert(new Set(collection.map((entry) => entry[field])).size === collection.length, "CUSTODY_DUPLICATE_ID", `duplicate custody ${field}`);
  unique(state.queue_index, "custody queue index");
  assert(JSON.stringify(state.queue_index) === JSON.stringify(deriveQueueIndex(state.jobs)), "CUSTODY_QUEUE_INDEX_STALE", "custody queue index differs from job states");
  state.events.forEach(validateEvent);
  assert(state.events.length === state.revision, "CUSTODY_EVENT_SEQUENCE_INVALID", "custody revision differs from event count");
  const worktrees = new Map(state.worktrees.map((entry) => [entry.worktree_id, entry]));
  const jobs = new Map(state.jobs.map((entry) => [entry.job_id, entry]));
  for (const job of state.jobs) {
    const worktree = worktrees.get(job.worktree_id);
    assert(worktree !== undefined, "CUSTODY_WORKTREE_MISSING", `job ${job.job_id} names a missing worktree`);
    if (!TERMINAL.has(job.status)) assert(job.task_id === worktree.owner_task_id && job.worktree_epoch === worktree.lease_epoch, "CUSTODY_WORKTREE_STALE", `job ${job.job_id} is not bound to current task ownership`);
  }
  for (const lease of state.leases.filter((entry) => ACTIVE_LEASE.has(entry.status))) {
    const job = jobs.get(lease.job_id);
    assert(job !== undefined && job.lease_id === lease.lease_id, "CUSTODY_LEASE_ORPHAN", `lease ${lease.lease_id} is not bound to its job`);
    if (lease.process !== null) {
      const worktree = worktrees.get(lease.worktree_id);
      assert(lease.process.cwd_ref === worktree.working_directory_ref, "CUSTODY_PROCESS_CWD_MISMATCH", "process CWD is outside exact worktree custody");
    }
  }
  assert(state.leases.filter((entry) => ACTIVE_LEASE.has(entry.status) && entry.resource_pool === "GLOBAL_HEAVY").length <= 1, "CUSTODY_GLOBAL_HEAVY_MUTEX", "more than one global heavyweight lease is active");
  assert(state.leases.filter((entry) => ACTIVE_LEASE.has(entry.status) && entry.resource_pool === "DATABASE_EXCLUSIVE").length <= 1, "CUSTODY_DATABASE_MUTEX", "more than one database-exclusive lease is active");
  assert(state.leases.filter((entry) => ACTIVE_LEASE.has(entry.status) && entry.resource_pool === "LIGHTWEIGHT").length <= state.policy.lighter_capacity, "CUSTODY_LIGHT_CAPACITY", "lightweight capacity is exceeded");
  const processInstances = state.leases.filter((entry) => ACTIVE_LEASE.has(entry.status) && entry.process !== null).map((entry) => entry.process.process_instance_sha256);
  assert(new Set(processInstances).size === processInstances.length, "CUSTODY_DUPLICATE_PROCESS", "one process instance is bound to multiple leases");
  requireSha(state.state_sha256, "custody state digest");
  assert(state.state_sha256 === digestWithout(state, "state_sha256"), "CUSTODY_DIGEST_INVALID", "custody state digest mismatch");
  assertPersistedRecordSafe(state);
  return state;
}

export function registerTaskOwnedWorktree({state, expectedStateSha256, actorId, observedAtUtc, worktree} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  assert(state.worktrees.every((entry) => entry.worktree_id !== worktree?.worktree_id), "CUSTODY_DUPLICATE_ID", "worktree ID already exists");
  const record = addressed({
    worktree_id: worktree.worktreeId,
    repository_id: worktree.repositoryId,
    working_directory_ref: worktree.workingDirectoryRef,
    owner_task_id: worktree.ownerTaskId,
    candidate_commit: worktree.candidateCommit,
    candidate_tree_or_digest: worktree.candidateTreeOrDigest,
    dirty_patch_sha256: worktree.dirtyPatchSha256,
    lease_epoch: 0,
    status: "ACTIVE",
    transfer: null,
    worktree_sha256: null,
  }, "worktree_sha256");
  validateWorktree(record);
  return nextRevision(state, {worktrees: [...state.worktrees, record]}, {eventType: "WORKTREE_REGISTERED", subjectId: record.worktree_id, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: record.worktree_sha256});
}

function replaceById(values, field, id, replacement) {
  return values.map((entry) => entry[field] === id ? replacement : entry);
}

function jobRecord({request, requesterRole, taskId, workloadClass, worktree, maxAttempts, observedAtUtc}) {
  requireIdentifier(requesterRole, "job requester role");
  assert(CUSTODY_WORKLOAD_CLASSES.includes(workloadClass), "CUSTODY_JOB_INVALID", "job workload class is invalid");
  const heavy = GLOBAL_HEAVY_WORKLOADS.includes(workloadClass);
  assert(!(heavy && HEAVY_DENIED_ROLES.has(requesterRole)), "DIRECT_HEAVY_EXECUTION_DENIED", `${requesterRole} cannot directly request heavyweight execution`);
  assert(requesterRole !== "SCHEDULER", "SCHEDULER_SELF_EXECUTION_DENIED", "Scheduler cannot request its own work");
  return addressed({
    job_id: `JOB-${canonicalDigest({request: request.request_sha256, task: taskId, workload: workloadClass}).slice(0, 40).toUpperCase()}`,
    request_id: request.request_id,
    request_sha256: request.request_sha256,
    requester_id: request.requester_id,
    requester_role: requesterRole,
    task_id: taskId,
    worktree_id: request.worktree_id,
    worktree_epoch: worktree.lease_epoch,
    workload_class: workloadClass,
    resource_pool: poolFor(workloadClass),
    status: "SUBMITTED",
    attempt: 1,
    max_attempts: maxAttempts,
    submitted_at_utc: observedAtUtc,
    queued_at_utc: null,
    leased_at_utc: null,
    started_at_utc: null,
    finished_at_utc: null,
    lease_id: null,
    terminal_reason: null,
    job_sha256: null,
  }, "job_sha256");
}

export function submitCustodyJob({state, expectedStateSha256, actorId, observedAtUtc, request, requesterRole, taskId, workloadClass} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  requireIdentifier(taskId, "job task ID");
  validateHybridSchedulerRequest(request);
  requireUtc(observedAtUtc, "job submission time");
  const worktree = state.worktrees.find((entry) => entry.worktree_id === request.worktree_id);
  assert(worktree !== undefined, "CUSTODY_WORKTREE_MISSING", "job worktree is not registered");
  assert(worktree.status === "ACTIVE" && worktree.owner_task_id === taskId, "CUSTODY_WORKTREE_STALE", "job task does not own the worktree");
  assert(worktree.working_directory_ref === request.working_directory_ref, "CUSTODY_PROCESS_CWD_MISMATCH", "job request CWD does not match worktree custody");
  const job = jobRecord({request, requesterRole, taskId, workloadClass, worktree, maxAttempts: state.policy.max_attempts, observedAtUtc});
  const existing = state.jobs.find((entry) => entry.job_id === job.job_id || entry.request_id === job.request_id);
  if (existing !== undefined) {
    assert(existing.request_sha256 === job.request_sha256 && existing.task_id === taskId && existing.workload_class === workloadClass, "CUSTODY_DUPLICATE_CONFLICT", "duplicate job request differs");
    return state;
  }
  return nextRevision(state, {jobs: [...state.jobs, job]}, {eventType: "JOB_SUBMITTED", subjectId: job.job_id, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: job.job_sha256});
}

export function queueCustodyJob({state, expectedStateSha256, actorId, observedAtUtc, jobId} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  const job = state.jobs.find((entry) => entry.job_id === jobId);
  assert(job?.status === "SUBMITTED", "CUSTODY_TRANSITION_INVALID", "only a submitted job may queue");
  const queued = addressed({...job, status: "QUEUED", queued_at_utc: observedAtUtc, job_sha256: null}, "job_sha256");
  validateJob(queued);
  return nextRevision(state, {jobs: replaceById(state.jobs, "job_id", jobId, queued)}, {eventType: "JOB_QUEUED", subjectId: jobId, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: queued.job_sha256});
}

function firstFreeSlot(state, pool) {
  const occupied = new Set(state.leases.filter((entry) => ACTIVE_LEASE.has(entry.status) && entry.resource_pool === pool).map((entry) => entry.slot));
  let slot = 0;
  while (occupied.has(slot)) slot += 1;
  return slot;
}

export function acquireCustodyLease({state, expectedStateSha256, actorId, observedAtUtc, jobId, leaseTokenSha256, ttlSeconds = null} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  requireSha(leaseTokenSha256, "lease token digest");
  requireUtc(observedAtUtc, "lease acquisition time");
  const job = state.jobs.find((entry) => entry.job_id === jobId);
  assert(job?.status === "QUEUED", "CUSTODY_TRANSITION_INVALID", "only a queued job may acquire capacity");
  const worktree = state.worktrees.find((entry) => entry.worktree_id === job.worktree_id);
  assert(worktree?.status === "ACTIVE" && worktree.owner_task_id === job.task_id && worktree.lease_epoch === job.worktree_epoch, "CUSTODY_WORKTREE_STALE", "job worktree custody changed before leasing");
  const activeInPool = state.leases.filter((entry) => ACTIVE_LEASE.has(entry.status) && entry.resource_pool === job.resource_pool).length;
  const capacity = job.resource_pool === "GLOBAL_HEAVY" || job.resource_pool === "DATABASE_EXCLUSIVE" ? 1 : state.policy.lighter_capacity;
  assert(activeInPool < capacity, job.resource_pool === "GLOBAL_HEAVY" ? "CUSTODY_GLOBAL_HEAVY_MUTEX" : "CUSTODY_CAPACITY_HOLD", `capacity is exhausted for ${job.resource_pool}`);
  const ttl = ttlSeconds ?? state.policy.reservation_timeout_seconds;
  requirePositiveInteger(ttl, "lease TTL");
  assert(ttl <= state.policy.run_timeout_seconds, "CUSTODY_LEASE_INVALID", "lease TTL exceeds run timeout");
  const leaseId = `LEASE-${canonicalDigest({job: job.job_sha256, epoch: job.attempt, token: leaseTokenSha256}).slice(0, 40).toUpperCase()}`;
  const lease = addressed({
    lease_id: leaseId,
    lease_epoch: job.attempt,
    lease_token_sha256: leaseTokenSha256,
    job_id: job.job_id,
    requester_id: job.requester_id,
    task_id: job.task_id,
    worktree_id: job.worktree_id,
    worktree_epoch: job.worktree_epoch,
    resource_pool: job.resource_pool,
    slot: firstFreeSlot(state, job.resource_pool),
    status: "RESERVED",
    acquired_at_utc: observedAtUtc,
    expires_at_utc: new Date(Date.parse(observedAtUtc) + ttl * 1000).toISOString(),
    process: null,
    lease_sha256: null,
  }, "lease_sha256");
  validateLease(lease);
  const leasedJob = addressed({...job, status: "LEASED", leased_at_utc: observedAtUtc, lease_id: leaseId, job_sha256: null}, "job_sha256");
  return nextRevision(state, {jobs: replaceById(state.jobs, "job_id", jobId, leasedJob), leases: [...state.leases, lease]}, {eventType: "LEASE_ACQUIRED", subjectId: leaseId, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: lease.lease_sha256});
}

export function bindCustodyProcess({state, expectedStateSha256, actorId, observedAtUtc, jobId, leaseTokenSha256, processProvenance} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  requireUtc(observedAtUtc, "process binding time");
  validateProcessProvenance(processProvenance);
  const job = state.jobs.find((entry) => entry.job_id === jobId);
  assert(job?.status === "LEASED", "CUSTODY_TRANSITION_INVALID", "only a leased job may bind a process");
  const lease = state.leases.find((entry) => entry.lease_id === job.lease_id);
  assert(lease?.status === "RESERVED" && lease.lease_token_sha256 === leaseTokenSha256, "CUSTODY_LEASE_CAS_MISMATCH", "process lease token differs");
  assert(Date.parse(observedAtUtc) <= Date.parse(lease.expires_at_utc), "CUSTODY_LEASE_EXPIRED", "process binding arrived after lease expiry");
  const worktree = state.worktrees.find((entry) => entry.worktree_id === job.worktree_id);
  assert(processProvenance.cwd_ref === worktree.working_directory_ref, "CUSTODY_PROCESS_CWD_MISMATCH", "process CWD does not match exact worktree custody");
  assert(!state.leases.some((entry) => ACTIVE_LEASE.has(entry.status) && entry.process?.process_instance_sha256 === processProvenance.process_instance_sha256), "CUSTODY_DUPLICATE_PROCESS", "process instance already belongs to another lease");
  const boundLease = addressed({...lease, status: "PROCESS_BOUND", process: processProvenance, lease_sha256: null}, "lease_sha256");
  const runningJob = addressed({...job, status: "RUNNING", started_at_utc: observedAtUtc, job_sha256: null}, "job_sha256");
  return nextRevision(state, {jobs: replaceById(state.jobs, "job_id", jobId, runningJob), leases: replaceById(state.leases, "lease_id", lease.lease_id, boundLease)}, {eventType: "PROCESS_BOUND", subjectId: jobId, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: processProvenance.process_instance_sha256});
}

export function compileProcessAbsenceProof({jobId, leaseId, expectedProcess, observation, observerId, observedAtUtc} = {}) {
  validateProcessProvenance(expectedProcess);
  requireIdentifier(jobId, "absence proof job ID");
  requireIdentifier(leaseId, "absence proof lease ID");
  requireIdentifier(observerId, "absence proof Runtime identity");
  requireUtc(observedAtUtc, "absence proof time");
  assert(isRecord(observation), "PROCESS_ABSENCE_UNPROVEN", "process absence observation is required");
  exactKeys(observation, ["status", "pid", "observed_start_identity_sha256", "probe_sha256"], "process absence observation");
  assert(["OBSERVED_PID_ABSENT", "OBSERVED_PID_REUSED"].includes(observation.status), "PROCESS_ABSENCE_UNPROVEN", "process observation does not prove exact-instance absence");
  assert(observation.pid === expectedProcess.pid, "PROCESS_ABSENCE_UNPROVEN", "process absence PID differs");
  if (observation.status === "OBSERVED_PID_ABSENT") assert(observation.observed_start_identity_sha256 === null, "PROCESS_ABSENCE_UNPROVEN", "absent PID unexpectedly has identity");
  else {
    requireSha(observation.observed_start_identity_sha256, "reused PID start identity");
    assert(observation.observed_start_identity_sha256 !== expectedProcess.start_identity_sha256, "PROCESS_ABSENCE_UNPROVEN", "observed PID is still the exact leased process");
  }
  requireSha(observation.probe_sha256, "process probe digest");
  return validateProcessAbsenceProof(addressed({
    schema: SCHEDULER_RUNTIME_ABSENCE_PROOF_SCHEMA,
    version: 1,
    status: "EXACT_INSTANCE_ABSENT",
    job_id: jobId,
    lease_id: leaseId,
    expected_process_instance_sha256: expectedProcess.process_instance_sha256,
    expected_pid: expectedProcess.pid,
    observed_pid_status: observation.status,
    observed_start_identity_sha256: observation.observed_start_identity_sha256,
    probe_sha256: observation.probe_sha256,
    observer_role: "RUNTIME",
    observer_id: observerId,
    observed_at_utc: observedAtUtc,
    proof_sha256: null,
  }, "proof_sha256"));
}

export function validateProcessAbsenceProof(proof) {
  exactKeys(proof, ["schema", "version", "status", "job_id", "lease_id", "expected_process_instance_sha256", "expected_pid", "observed_pid_status", "observed_start_identity_sha256", "probe_sha256", "observer_role", "observer_id", "observed_at_utc", "proof_sha256"], "process absence proof");
  assert(proof.schema === SCHEDULER_RUNTIME_ABSENCE_PROOF_SCHEMA && proof.version === 1 && proof.status === "EXACT_INSTANCE_ABSENT", "PROCESS_ABSENCE_UNPROVEN", "process absence proof identity is invalid");
  for (const field of ["job_id", "lease_id", "observer_role", "observer_id"]) requireIdentifier(proof[field], `absence proof ${field}`);
  assert(proof.observer_role === "RUNTIME", "PROCESS_ABSENCE_UNPROVEN", "only Runtime may attest process absence");
  requirePositiveInteger(proof.expected_pid, "absence proof PID");
  for (const field of ["expected_process_instance_sha256", "probe_sha256", "proof_sha256"]) requireSha(proof[field], `absence proof ${field}`);
  assert(["OBSERVED_PID_ABSENT", "OBSERVED_PID_REUSED"].includes(proof.observed_pid_status), "PROCESS_ABSENCE_UNPROVEN", "absence proof status is invalid");
  if (proof.observed_pid_status === "OBSERVED_PID_ABSENT") assert(proof.observed_start_identity_sha256 === null, "PROCESS_ABSENCE_UNPROVEN", "absent PID has an observed identity");
  else requireSha(proof.observed_start_identity_sha256, "reused PID identity");
  requireUtc(proof.observed_at_utc, "absence proof time");
  assert(proof.proof_sha256 === digestWithout(proof, "proof_sha256"), "CUSTODY_DIGEST_INVALID", "absence proof digest mismatch");
  assertPersistedRecordSafe(proof);
  return proof;
}

export function settleCustodyJob({state, expectedStateSha256, actorId, observedAtUtc, jobId, outcome, terminalReason, absenceProof} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  requireUtc(observedAtUtc, "job settlement time");
  requireIdentifier(terminalReason, "job terminal reason");
  assert(["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(outcome), "CUSTODY_TRANSITION_INVALID", "job outcome is invalid");
  const job = state.jobs.find((entry) => entry.job_id === jobId);
  assert(["RUNNING", "CANCEL_REQUESTED"].includes(job?.status), "CUSTODY_TRANSITION_INVALID", "job is not running or cancelling");
  const lease = state.leases.find((entry) => entry.lease_id === job.lease_id);
  validateProcessAbsenceProof(absenceProof);
  assert(absenceProof.job_id === jobId && absenceProof.lease_id === lease.lease_id && absenceProof.expected_process_instance_sha256 === lease.process?.process_instance_sha256, "PROCESS_ABSENCE_UNPROVEN", "process absence proof is not bound to the exact lease instance");
  if (absenceProof.observed_pid_status === "OBSERVED_PID_REUSED") assert(absenceProof.observed_start_identity_sha256 !== lease.process.start_identity_sha256, "PROCESS_ABSENCE_UNPROVEN", "PID reuse proof still identifies the leased process");
  if (job.status === "CANCEL_REQUESTED") assert(outcome === "CANCELLED" || outcome === "INTERRUPTED", "CUSTODY_TRANSITION_INVALID", "cancelling job cannot claim success");
  const terminalJob = addressed({...job, status: outcome, finished_at_utc: observedAtUtc, lease_id: null, terminal_reason: terminalReason, job_sha256: null}, "job_sha256");
  const releasedLease = addressed({...lease, status: "RELEASED", lease_sha256: null}, "lease_sha256");
  return nextRevision(state, {jobs: replaceById(state.jobs, "job_id", jobId, terminalJob), leases: replaceById(state.leases, "lease_id", lease.lease_id, releasedLease)}, {eventType: `JOB_${outcome}`, subjectId: jobId, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: absenceProof.proof_sha256});
}

export function requestCustodyCancellation({state, expectedStateSha256, actorRole, actorId, observedAtUtc, jobId, reasonSha256} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorRole, "cancellation actor role");
  requireIdentifier(actorId, "cancellation actor identity");
  requireUtc(observedAtUtc, "cancellation time");
  requireSha(reasonSha256, "cancellation reason digest");
  assert(["CONTROLLER", "RUNTIME", "SCHEDULER"].includes(actorRole), "CUSTODY_AUTHORITY_DENIED", "actor cannot request cancellation");
  const job = state.jobs.find((entry) => entry.job_id === jobId);
  assert(job !== undefined && !TERMINAL.has(job.status), "CUSTODY_TRANSITION_INVALID", "job cannot be cancelled");
  let nextJob;
  let leases = state.leases;
  if (["SUBMITTED", "QUEUED"].includes(job.status)) nextJob = addressed({...job, status: "CANCELLED", finished_at_utc: observedAtUtc, terminal_reason: "CANCELLED_BEFORE_PROCESS", job_sha256: null}, "job_sha256");
  else if (job.status === "LEASED") {
    const lease = state.leases.find((entry) => entry.lease_id === job.lease_id);
    nextJob = addressed({...job, status: "CANCELLED", finished_at_utc: observedAtUtc, lease_id: null, terminal_reason: "CANCELLED_BEFORE_PROCESS", job_sha256: null}, "job_sha256");
    leases = replaceById(state.leases, "lease_id", lease.lease_id, addressed({...lease, status: "RELEASED", lease_sha256: null}, "lease_sha256"));
  } else {
    nextJob = addressed({...job, status: "CANCEL_REQUESTED", terminal_reason: "CANCELLATION_PENDING_PROCESS_EXIT", job_sha256: null}, "job_sha256");
    const lease = state.leases.find((entry) => entry.lease_id === job.lease_id);
    leases = replaceById(state.leases, "lease_id", lease.lease_id, addressed({...lease, status: "CANCEL_REQUESTED", lease_sha256: null}, "lease_sha256"));
  }
  return nextRevision(state, {jobs: replaceById(state.jobs, "job_id", jobId, nextJob), leases}, {eventType: "CANCELLATION_REQUESTED", subjectId: jobId, actorRole, actorId, observedAtUtc, detailSha256: reasonSha256});
}

export function retryCustodyJob({state, expectedStateSha256, actorId, observedAtUtc, jobId, changedRouteSha256} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  requireUtc(observedAtUtc, "job retry time");
  requireSha(changedRouteSha256, "retry route digest");
  const job = state.jobs.find((entry) => entry.job_id === jobId);
  assert(["FAILED", "INTERRUPTED"].includes(job?.status), "CUSTODY_TRANSITION_INVALID", "only failed or interrupted jobs may retry");
  assert(job.attempt < job.max_attempts, "CUSTODY_RETRY_EXHAUSTED", "job retry bound is exhausted");
  const worktree = state.worktrees.find((entry) => entry.worktree_id === job.worktree_id);
  assert(worktree.status === "ACTIVE" && worktree.owner_task_id === job.task_id && worktree.lease_epoch === job.worktree_epoch, "CUSTODY_WORKTREE_STALE", "job worktree changed before retry");
  const retried = addressed({...job, status: "QUEUED", attempt: job.attempt + 1, queued_at_utc: observedAtUtc, leased_at_utc: null, started_at_utc: null, finished_at_utc: null, lease_id: null, terminal_reason: null, job_sha256: null}, "job_sha256");
  return nextRevision(state, {jobs: replaceById(state.jobs, "job_id", jobId, retried)}, {eventType: "JOB_RETRY_QUEUED", subjectId: jobId, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: changedRouteSha256});
}

export function inspectCustodyTimeouts({state, observedAtUtc} = {}) {
  validateSchedulerRuntimeCustodyState(state);
  requireUtc(observedAtUtc, "timeout observation time");
  const now = Date.parse(observedAtUtc);
  const findings = [];
  for (const job of state.jobs) {
    if (job.status === "QUEUED" && now - Date.parse(job.queued_at_utc) > state.policy.queue_timeout_seconds * 1000) findings.push({job_id: job.job_id, code: "QUEUE_TIMEOUT_ABSENCE_PROOF_REQUIRED"});
    if (["LEASED", "RUNNING", "CANCEL_REQUESTED"].includes(job.status)) {
      const lease = state.leases.find((entry) => entry.lease_id === job.lease_id);
      if (now > Date.parse(lease.expires_at_utc)) findings.push({job_id: job.job_id, code: "LEASE_TIMEOUT_EXACT_PROCESS_PROBE_REQUIRED"});
    }
  }
  return addressed({schema: "agentos.scheduler_timeout_inspection.v1", version: 1, status: findings.length === 0 ? "CLEAR" : "RECOVERY_EVIDENCE_REQUIRED", observed_at_utc: observedAtUtc, findings, inspection_sha256: null}, "inspection_sha256");
}

function validateProcessReconciliation(reconciliation) {
  exactKeys(reconciliation, ["schema", "version", "status", "observer_role", "observer_id", "observed_at_utc", "findings", "effects_applied", "reconciliation_sha256"], "process inventory reconciliation");
  assert(reconciliation.schema === "agentos.scheduler_process_inventory_reconciliation.v1" && reconciliation.version === 1, "PROCESS_INVENTORY_INVALID", "process reconciliation identity is invalid");
  assert(["CANONICAL", "NONCANONICAL_PROCESS_FOUND"].includes(reconciliation.status), "PROCESS_INVENTORY_INVALID", "process reconciliation status is invalid");
  assert(reconciliation.observer_role === "RUNTIME", "PROCESS_INVENTORY_INVALID", "process reconciliation must be Runtime-owned");
  requireIdentifier(reconciliation.observer_id, "process reconciliation observer");
  requireUtc(reconciliation.observed_at_utc, "process reconciliation time");
  assert(Array.isArray(reconciliation.findings), "PROCESS_INVENTORY_INVALID", "process reconciliation findings are invalid");
  assert(Array.isArray(reconciliation.effects_applied) && reconciliation.effects_applied.length === 0, "CUSTODY_EFFECTS_FORBIDDEN", "process reconciliation applied an effect");
  requireSha(reconciliation.reconciliation_sha256, "process reconciliation digest");
  assert(reconciliation.reconciliation_sha256 === digestWithout(reconciliation, "reconciliation_sha256"), "CUSTODY_DIGEST_INVALID", "process reconciliation digest mismatch");
  return reconciliation;
}

export function compileQueueAbsenceProof({state, jobIds, processReconciliation, observerId, observedAtUtc} = {}) {
  assert(isRecord(state), "CUSTODY_QUEUE_INDEX_STALE", "queue absence proof state is missing");
  requireSha(state.state_sha256, "queue absence state digest");
  assert(state.state_sha256 === digestWithout(state, "state_sha256"), "CUSTODY_DIGEST_INVALID", "queue absence state digest mismatch");
  sortedUnique(jobIds, "queue absence job IDs");
  jobIds.forEach((jobId) => requireIdentifier(jobId, "queue absence job ID"));
  requireIdentifier(observerId, "queue absence Runtime identity");
  requireUtc(observedAtUtc, "queue absence observation time");
  validateProcessReconciliation(processReconciliation);
  assert(processReconciliation.observer_id === observerId, "PROCESS_ABSENCE_UNPROVEN", "queue absence observer differs from process inventory");
  for (const jobId of jobIds) {
    const job = state.jobs.find((entry) => entry.job_id === jobId);
    assert(job === undefined || ["SUBMITTED", "QUEUED"].includes(job.status), "PROCESS_ABSENCE_UNPROVEN", `queue absence target ${jobId} is process-capable`);
    assert(!state.leases.some((lease) => lease.job_id === jobId && ACTIVE_LEASE.has(lease.status)), "PROCESS_ABSENCE_UNPROVEN", `queue absence target ${jobId} has an active lease`);
    assert(!processReconciliation.findings.some((finding) => finding.job_id === jobId), "PROCESS_ABSENCE_UNPROVEN", `queue absence target ${jobId} appears in process inventory`);
  }
  return addressed({
    schema: "agentos.scheduler_queue_absence_proof.v1",
    version: 1,
    status: "NO_PROCESS_CUSTODY_PRESENT",
    observed_state_sha256: state.state_sha256,
    job_ids: [...jobIds],
    process_reconciliation_sha256: processReconciliation.reconciliation_sha256,
    observer_role: "RUNTIME",
    observer_id: observerId,
    observed_at_utc: observedAtUtc,
    proof_sha256: null,
  }, "proof_sha256");
}

function validateQueueAbsenceProof(proof) {
  exactKeys(proof, ["schema", "version", "status", "observed_state_sha256", "job_ids", "process_reconciliation_sha256", "observer_role", "observer_id", "observed_at_utc", "proof_sha256"], "queue absence proof");
  assert(proof.schema === "agentos.scheduler_queue_absence_proof.v1" && proof.version === 1 && proof.status === "NO_PROCESS_CUSTODY_PRESENT", "PROCESS_ABSENCE_UNPROVEN", "queue absence proof identity is invalid");
  sortedUnique(proof.job_ids, "queue absence job IDs");
  proof.job_ids.forEach((jobId) => requireIdentifier(jobId, "queue absence job ID"));
  for (const field of ["observed_state_sha256", "process_reconciliation_sha256", "proof_sha256"]) requireSha(proof[field], `queue absence ${field}`);
  assert(proof.observer_role === "RUNTIME", "PROCESS_ABSENCE_UNPROVEN", "queue absence proof must be Runtime-owned");
  requireIdentifier(proof.observer_id, "queue absence observer");
  requireUtc(proof.observed_at_utc, "queue absence time");
  assert(proof.proof_sha256 === digestWithout(proof, "proof_sha256"), "CUSTODY_DIGEST_INVALID", "queue absence proof digest mismatch");
  return proof;
}

export function recoverStaleQueuedJob({state, expectedStateSha256, actorId, observedAtUtc, jobId, queueAbsenceProof} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  requireUtc(observedAtUtc, "queue recovery time");
  validateQueueAbsenceProof(queueAbsenceProof);
  assert(queueAbsenceProof.observed_state_sha256 === state.state_sha256 && queueAbsenceProof.job_ids.includes(jobId), "PROCESS_ABSENCE_UNPROVEN", "queue absence proof is not bound to this state and job");
  const job = state.jobs.find((entry) => entry.job_id === jobId);
  assert(job?.status === "QUEUED", "CUSTODY_TRANSITION_INVALID", "only a queued job may be recovered as stale");
  assert(Date.parse(observedAtUtc) - Date.parse(job.queued_at_utc) > state.policy.queue_timeout_seconds * 1000, "CUSTODY_TIMEOUT_NOT_REACHED", "queue timeout has not elapsed");
  const interrupted = addressed({...job, status: "INTERRUPTED", finished_at_utc: observedAtUtc, terminal_reason: "STALE_QUEUE_RECOVERED_WITH_ABSENCE_PROOF", job_sha256: null}, "job_sha256");
  return nextRevision(state, {jobs: replaceById(state.jobs, "job_id", jobId, interrupted)}, {eventType: "STALE_QUEUE_RECOVERED", subjectId: jobId, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: queueAbsenceProof.proof_sha256});
}

export function repairCustodyQueueIndex({unsafeState, expectedStateSha256, actorId, observedAtUtc, queueAbsenceProof} = {}) {
  assert(isRecord(unsafeState), "CUSTODY_SCHEMA_INVALID", "unsafe custody state is required");
  requireSha(expectedStateSha256, "expected stale custody state digest");
  assert(unsafeState.state_sha256 === expectedStateSha256 && unsafeState.state_sha256 === digestWithout(unsafeState, "state_sha256"), "CUSTODY_CAS_MISMATCH", "stale custody state digest differs");
  requireIdentifier(actorId, "Scheduler identity");
  requireUtc(observedAtUtc, "queue-index repair time");
  validateQueueAbsenceProof(queueAbsenceProof);
  assert(queueAbsenceProof.observed_state_sha256 === unsafeState.state_sha256, "PROCESS_ABSENCE_UNPROVEN", "queue absence proof is not bound to stale state");
  const derived = deriveQueueIndex(unsafeState.jobs);
  const affected = [...new Set([...unsafeState.queue_index, ...derived].filter((jobId) => !unsafeState.queue_index.includes(jobId) || !derived.includes(jobId)))].sort();
  assert(affected.length > 0 && JSON.stringify(affected) === JSON.stringify(queueAbsenceProof.job_ids), "PROCESS_ABSENCE_UNPROVEN", "queue absence proof does not cover the exact stale index delta");
  const normalized = {...structuredClone(unsafeState), queue_index: derived, state_sha256: null};
  normalized.state_sha256 = digestWithout(normalized, "state_sha256");
  validateSchedulerRuntimeCustodyState(normalized);
  return nextRevision(normalized, {}, {eventType: "QUEUE_INDEX_REPAIRED", subjectId: "QUEUE-INDEX", actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: queueAbsenceProof.proof_sha256});
}

export function prepareTaskWorktreeTransfer({state, expectedStateSha256, actorId, observedAtUtc, transferId, worktreeId, fromTaskId, toTaskId, observedIdentity} = {}) {
  assertCas(state, expectedStateSha256);
  for (const [value, label] of [[actorId, "Scheduler identity"], [transferId, "transfer ID"], [worktreeId, "transfer worktree ID"], [fromTaskId, "transfer predecessor task"], [toTaskId, "transfer successor task"]]) requireIdentifier(value, label);
  requireUtc(observedAtUtc, "transfer preparation time");
  assert(fromTaskId !== toTaskId, "CUSTODY_TRANSFER_INVALID", "worktree transfer tasks must differ");
  const worktree = state.worktrees.find((entry) => entry.worktree_id === worktreeId);
  assert(worktree?.status === "ACTIVE" && worktree.owner_task_id === fromTaskId, "CUSTODY_TRANSFER_INVALID", "predecessor does not own an active worktree");
  assert(!state.jobs.some((job) => job.worktree_id === worktreeId && !TERMINAL.has(job.status)), "CUSTODY_TRANSFER_ACTIVE_JOB", "worktree cannot transfer with active jobs");
  assert(observedIdentity?.candidateCommit === worktree.candidate_commit && observedIdentity?.candidateTreeOrDigest === worktree.candidate_tree_or_digest && observedIdentity?.dirtyPatchSha256 === worktree.dirty_patch_sha256, "CUSTODY_TRANSFER_DIVERGENCE", "worktree state diverged before transfer preparation");
  const transfer = addressed({transfer_id: transferId, from_task_id: fromTaskId, to_task_id: toTaskId, expected_lease_epoch: worktree.lease_epoch, expected_commit: worktree.candidate_commit, expected_tree_or_digest: worktree.candidate_tree_or_digest, expected_dirty_patch_sha256: worktree.dirty_patch_sha256, prepared_at_utc: observedAtUtc, transfer_sha256: null}, "transfer_sha256");
  const prepared = addressed({...worktree, status: "TRANSFER_PREPARED", transfer, worktree_sha256: null}, "worktree_sha256");
  return nextRevision(state, {worktrees: replaceById(state.worktrees, "worktree_id", worktreeId, prepared)}, {eventType: "WORKTREE_TRANSFER_PREPARED", subjectId: transferId, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: transfer.transfer_sha256});
}

export function commitTaskWorktreeTransfer({state, expectedStateSha256, actorId, observedAtUtc, transferId, successorAck, observedIdentity} = {}) {
  assertCas(state, expectedStateSha256);
  requireIdentifier(actorId, "Scheduler identity");
  requireIdentifier(transferId, "transfer ID");
  requireUtc(observedAtUtc, "transfer commit time");
  const worktree = state.worktrees.find((entry) => entry.transfer?.transfer_id === transferId);
  assert(worktree?.status === "TRANSFER_PREPARED", "CUSTODY_TRANSFER_INVALID", "worktree transfer is not prepared");
  exactKeys(successorAck, ["schema", "version", "status", "transfer_sha256", "successor_task_id", "observed_worktree_sha256", "ack_sha256"], "successor worktree ACK");
  assert(successorAck.schema === "agentos.worktree_transfer_successor_ack.v1" && successorAck.version === 1 && successorAck.status === "ACKNOWLEDGED", "CUSTODY_TRANSFER_INVALID", "successor ACK identity is invalid");
  assert(successorAck.transfer_sha256 === worktree.transfer.transfer_sha256 && successorAck.successor_task_id === worktree.transfer.to_task_id && successorAck.observed_worktree_sha256 === worktree.worktree_sha256, "CUSTODY_TRANSFER_DIVERGENCE", "successor ACK differs from prepared transfer");
  requireSha(successorAck.ack_sha256, "successor ACK digest");
  assert(successorAck.ack_sha256 === digestWithout(successorAck, "ack_sha256"), "CUSTODY_DIGEST_INVALID", "successor ACK digest mismatch");
  assert(observedIdentity?.candidateCommit === worktree.transfer.expected_commit && observedIdentity?.candidateTreeOrDigest === worktree.transfer.expected_tree_or_digest && observedIdentity?.dirtyPatchSha256 === worktree.transfer.expected_dirty_patch_sha256, "CUSTODY_TRANSFER_DIVERGENCE", "worktree state diverged before transfer commit");
  const committed = addressed({...worktree, owner_task_id: worktree.transfer.to_task_id, lease_epoch: worktree.lease_epoch + 1, status: "ACTIVE", transfer: null, worktree_sha256: null}, "worktree_sha256");
  return nextRevision(state, {worktrees: replaceById(state.worktrees, "worktree_id", worktree.worktree_id, committed)}, {eventType: "WORKTREE_TRANSFER_COMMITTED", subjectId: transferId, actorRole: "SCHEDULER", actorId, observedAtUtc, detailSha256: successorAck.ack_sha256});
}

export function compileWorktreeTransferAck({worktree, transferSha256, successorTaskId} = {}) {
  validateWorktree(worktree);
  requireSha(transferSha256, "transfer ACK source digest");
  requireIdentifier(successorTaskId, "transfer ACK successor task");
  return addressed({schema: "agentos.worktree_transfer_successor_ack.v1", version: 1, status: "ACKNOWLEDGED", transfer_sha256: transferSha256, successor_task_id: successorTaskId, observed_worktree_sha256: worktree.worktree_sha256, ack_sha256: null}, "ack_sha256");
}

export function reconcileProcessInventory({state, observations, observerId, observedAtUtc} = {}) {
  validateSchedulerRuntimeCustodyState(state);
  requireIdentifier(observerId, "Runtime inventory observer");
  requireUtc(observedAtUtc, "process inventory time");
  assert(Array.isArray(observations), "PROCESS_INVENTORY_INVALID", "process inventory must be an array");
  const canonical = new Map(state.leases.filter((entry) => ACTIVE_LEASE.has(entry.status) && entry.process !== null).map((entry) => [entry.process.process_instance_sha256, entry]));
  const seenByJob = new Map();
  const findings = [];
  for (const observation of observations) {
    validateProcessProvenance(observation.process);
    if (observation.job_id !== null) requireIdentifier(observation.job_id, "observed process job ID");
    if (observation.lease_id !== null) requireIdentifier(observation.lease_id, "observed process lease ID");
    const lease = canonical.get(observation.process.process_instance_sha256);
    if (lease === undefined) findings.push({code: "ORPHAN_PROCESS_NONCANONICAL", process_instance_sha256: observation.process.process_instance_sha256, job_id: observation.job_id, lease_id: observation.lease_id, action: "FREEZE_AND_ROUTE_EXACT_GROUP_REVIEW"});
    else if (observation.job_id !== lease.job_id || observation.lease_id !== lease.lease_id) findings.push({code: "PROCESS_BINDING_MISMATCH", process_instance_sha256: observation.process.process_instance_sha256, job_id: observation.job_id, lease_id: observation.lease_id, action: "FREEZE_AND_FAIL_CLOSED"});
    if (observation.job_id !== null) {
      const count = (seenByJob.get(observation.job_id) ?? 0) + 1;
      seenByJob.set(observation.job_id, count);
      if (count > 1) findings.push({code: "DUPLICATE_PROCESS_NONCANONICAL", process_instance_sha256: observation.process.process_instance_sha256, job_id: observation.job_id, lease_id: observation.lease_id, action: "FREEZE_AND_ROUTE_EXACT_GROUP_REVIEW"});
    }
  }
  return validateProcessReconciliation(addressed({schema: "agentos.scheduler_process_inventory_reconciliation.v1", version: 1, status: findings.length === 0 ? "CANONICAL" : "NONCANONICAL_PROCESS_FOUND", observer_role: "RUNTIME", observer_id: observerId, observed_at_utc: observedAtUtc, findings, effects_applied: [], reconciliation_sha256: null}, "reconciliation_sha256"));
}

function validateProtectedDecision(decision, action, runtimeIdentity) {
  exactKeys(decision, ["schema", "version", "status", "action", "decided_by_identity", "subject_sha256", "decision_sha256"], "protected decision");
  assert(decision.schema === "agentos.runtime_protected_decision.v1" && decision.version === 1 && decision.status === "ACCEPTED", "RUNTIME_PROTECTED_DECISION_REQUIRED", "protected decision identity is invalid");
  assert(decision.action === action && decision.decided_by_identity !== runtimeIdentity, "RUNTIME_PROTECTED_DECISION_REQUIRED", "protected decision is missing independent authority");
  requireIdentifier(decision.decided_by_identity, "protected decision identity");
  requireSha(decision.subject_sha256, "protected decision subject");
  requireSha(decision.decision_sha256, "protected decision digest");
  assert(decision.decision_sha256 === digestWithout(decision, "decision_sha256"), "CUSTODY_DIGEST_INVALID", "protected decision digest mismatch");
}

export function compileRuntimeProtectedDecision({action, decidedByIdentity, subjectSha256} = {}) {
  assert(PROTECTED_RUNTIME_ACTIONS.has(action), "RUNTIME_ACTION_INVALID", "action is not protected");
  requireIdentifier(decidedByIdentity, "protected decider identity");
  requireSha(subjectSha256, "protected decision subject");
  return addressed({schema: "agentos.runtime_protected_decision.v1", version: 1, status: "ACCEPTED", action, decided_by_identity: decidedByIdentity, subject_sha256: subjectSha256, decision_sha256: null}, "decision_sha256");
}

export function compileRuntimeCapability({capabilityId, runtimeIdentity, action, projectRef, controlPlaneRef, scopeRefs, requestSha256, protectedDecision = null, schedulerLease = null, rollbackIdentitySha256 = null} = {}) {
  for (const [value, label] of [[capabilityId, "Runtime capability ID"], [runtimeIdentity, "Runtime identity"]]) requireIdentifier(value, label);
  assert(RUNTIME_ACTIONS.includes(action), "RUNTIME_ACTION_INVALID", "Runtime action is invalid");
  requireOpaqueRef(projectRef, "Runtime project ref");
  requireOpaqueRef(controlPlaneRef, "Runtime control-plane ref");
  sortedUnique(scopeRefs, "Runtime scope refs");
  scopeRefs.forEach((entry) => requireOpaqueRef(entry, "Runtime scope ref"));
  requireSha(requestSha256, "Runtime capability request digest");
  let decisionSha256 = null;
  let schedulerLeaseSha256 = null;
  if (PROTECTED_RUNTIME_ACTIONS.has(action)) {
    assert(protectedDecision !== null, "RUNTIME_PROTECTED_DECISION_REQUIRED", `${action} is default-denied without a protected decision`);
    validateProtectedDecision(protectedDecision, action, runtimeIdentity);
    decisionSha256 = protectedDecision.decision_sha256;
  } else assert(protectedDecision === null, "RUNTIME_AUTHORITY_EXCESS", "read-only discovery may not inherit protected authority");
  if (action === "BUILD") {
    assert(schedulerLease !== null, "RUNTIME_SCHEDULER_LEASE_REQUIRED", "build capability requires Scheduler custody");
    validateLease(schedulerLease);
    assert(ACTIVE_LEASE.has(schedulerLease.status) && schedulerLease.resource_pool === "GLOBAL_HEAVY", "RUNTIME_SCHEDULER_LEASE_REQUIRED", "build capability lacks active heavyweight custody");
    schedulerLeaseSha256 = schedulerLease.lease_sha256;
  } else assert(schedulerLease === null, "RUNTIME_AUTHORITY_EXCESS", "non-build capability may not carry a build lease");
  if (action === "ROLLBACK") requireSha(rollbackIdentitySha256, "Runtime rollback identity");
  else assert(rollbackIdentitySha256 === null, "RUNTIME_AUTHORITY_EXCESS", "non-rollback capability may not carry rollback identity");
  return validateRuntimeCapability(addressed({
    schema: RUNTIME_CAPABILITY_SCHEMA,
    version: 1,
    status: "BOUND_PREPARED_NOT_EXECUTED",
    authority_graph_sha256: PERMANENT_ROLE_AUTHORITY_SHA256,
    runtime_role: "RUNTIME",
    runtime_identity: runtimeIdentity,
    capability_id: capabilityId,
    action,
    project_ref: projectRef,
    control_plane_ref: controlPlaneRef,
    scope_refs: [...scopeRefs],
    request_sha256: requestSha256,
    protected_decision_sha256: decisionSha256,
    scheduler_lease_sha256: schedulerLeaseSha256,
    rollback_identity_sha256: rollbackIdentitySha256,
    execution_authorized: false,
    capability_sha256: null,
  }, "capability_sha256"));
}

export function validateRuntimeCapability(capability) {
  exactKeys(capability, ["schema", "version", "status", "authority_graph_sha256", "runtime_role", "runtime_identity", "capability_id", "action", "project_ref", "control_plane_ref", "scope_refs", "request_sha256", "protected_decision_sha256", "scheduler_lease_sha256", "rollback_identity_sha256", "execution_authorized", "capability_sha256"], "Runtime capability");
  assert(capability.schema === RUNTIME_CAPABILITY_SCHEMA && capability.version === 1 && capability.status === "BOUND_PREPARED_NOT_EXECUTED", "RUNTIME_CAPABILITY_INVALID", "Runtime capability identity is invalid");
  assert(capability.authority_graph_sha256 === PERMANENT_ROLE_AUTHORITY_SHA256 && capability.runtime_role === "RUNTIME", "CUSTODY_AUTHORITY_STALE", "Runtime capability authority binding is stale");
  requireIdentifier(capability.runtime_identity, "Runtime capability identity");
  requireIdentifier(capability.capability_id, "Runtime capability ID");
  assert(RUNTIME_ACTIONS.includes(capability.action), "RUNTIME_ACTION_INVALID", "Runtime capability action is invalid");
  requireOpaqueRef(capability.project_ref, "Runtime capability project ref");
  requireOpaqueRef(capability.control_plane_ref, "Runtime capability control-plane ref");
  sortedUnique(capability.scope_refs, "Runtime capability scope refs");
  capability.scope_refs.forEach((entry) => requireOpaqueRef(entry, "Runtime capability scope ref"));
  requireSha(capability.request_sha256, "Runtime capability request digest");
  if (PROTECTED_RUNTIME_ACTIONS.has(capability.action)) requireSha(capability.protected_decision_sha256, "Runtime protected decision digest");
  else assert(capability.protected_decision_sha256 === null, "RUNTIME_AUTHORITY_EXCESS", "read-only discovery carries protected authority");
  if (capability.action === "BUILD") requireSha(capability.scheduler_lease_sha256, "Runtime Scheduler lease digest");
  else assert(capability.scheduler_lease_sha256 === null, "RUNTIME_AUTHORITY_EXCESS", "non-build capability carries a build lease");
  if (capability.action === "ROLLBACK") requireSha(capability.rollback_identity_sha256, "Runtime rollback identity");
  else assert(capability.rollback_identity_sha256 === null, "RUNTIME_AUTHORITY_EXCESS", "non-rollback capability carries rollback identity");
  assert(capability.execution_authorized === false, "CUSTODY_EFFECTS_FORBIDDEN", "portable Runtime capability may not execute effects");
  requireSha(capability.capability_sha256, "Runtime capability digest");
  assert(capability.capability_sha256 === digestWithout(capability, "capability_sha256"), "CUSTODY_DIGEST_INVALID", "Runtime capability digest mismatch");
  assertPersistedRecordSafe(capability);
  return capability;
}

export function compileRuntimeReadOnlyDiscovery({capability, observedAtUtc, git, build, routing, hosting, environments, secretInterfaces} = {}) {
  validateRuntimeCapability(capability);
  assert(capability.action === "DISCOVER_READ_ONLY", "RUNTIME_CAPABILITY_MISMATCH", "Runtime capability does not allow discovery");
  requireUtc(observedAtUtc, "Runtime discovery time");
  const observations = {git, build, routing, hosting, environments, secret_interfaces: secretInterfaces};
  for (const [name, values] of Object.entries(observations)) {
    sortedUnique(values, `Runtime discovery ${name}`);
    values.forEach((value) => requireSha(value, `Runtime discovery ${name} identity`));
  }
  return addressed({
    schema: RUNTIME_DISCOVERY_SCHEMA,
    version: 1,
    status: "READ_ONLY_COMPLETE",
    capability_sha256: capability.capability_sha256,
    observed_at_utc: observedAtUtc,
    observations,
    secrets_read: false,
    effects_applied: [],
    discovery_sha256: null,
  }, "discovery_sha256");
}

export function prepareRuntimeAction({capability, actionPlanSha256} = {}) {
  validateRuntimeCapability(capability);
  assert(PROTECTED_RUNTIME_ACTIONS.has(capability.action), "RUNTIME_ACTION_INVALID", "read-only discovery has no effectful action plan");
  requireSha(actionPlanSha256, "Runtime action plan digest");
  return addressed({
    schema: RUNTIME_ACTION_PREPARATION_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_EXECUTED",
    action: capability.action,
    capability_sha256: capability.capability_sha256,
    action_plan_sha256: actionPlanSha256,
    authority_graph_sha256: PERMANENT_ROLE_AUTHORITY_SHA256,
    execution_authorized: false,
    effects_applied: [],
    preparation_sha256: null,
  }, "preparation_sha256");
}

function writeJsonExclusive(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true, mode: 0o700});
  const handle = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value)}\n`, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.stage`;
  try {
    writeJsonExclusive(temporary, value);
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary) && !fs.lstatSync(temporary).isSymbolicLink()) fs.unlinkSync(temporary);
  }
}

function readSafeJson(filePath, label) {
  assert(fs.existsSync(filePath), "CUSTODY_STORE_MISSING", `${label} is missing`);
  assert(!fs.lstatSync(filePath).isSymbolicLink() && fs.statSync(filePath).isFile(), "CUSTODY_STORE_UNSAFE", `${label} is not a regular file`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateStoreLock(lock) {
  exactKeys(lock, ["schema", "version", "status", "token_sha256", "owner_process", "acquired_at_utc", "lock_sha256"], "custody store lock");
  assert(lock.schema === "agentos.scheduler_runtime_custody_store_lock.v1" && lock.version === 1 && lock.status === "HELD", "CUSTODY_STORE_UNSAFE", "custody store lock identity is invalid");
  requireSha(lock.token_sha256, "custody store lock token");
  validateProcessProvenance(lock.owner_process);
  requireUtc(lock.acquired_at_utc, "custody store lock time");
  requireSha(lock.lock_sha256, "custody store lock digest");
  assert(lock.lock_sha256 === digestWithout(lock, "lock_sha256"), "CUSTODY_DIGEST_INVALID", "custody store lock digest mismatch");
  return lock;
}

/**
 * Open a host-local file-backed CAS store. The caller supplies its exact
 * process provenance; this store never infers identity from a PID alone and
 * never auto-deletes a stale lock. Stale recovery requires Runtime proof that
 * the exact lock-holder process instance is absent.
 */
export function openSchedulerRuntimeCustodyStore({authorityRoot, ownerProcessProvenance, initialState = null, clock = () => new Date().toISOString()} = {}) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "CUSTODY_STORE_INVALID", "custody store authority root must be absolute at runtime");
  validateProcessProvenance(ownerProcessProvenance);
  assert(typeof clock === "function", "CUSTODY_STORE_INVALID", "custody store clock is invalid");
  const resolvedAuthority = path.resolve(authorityRoot);
  if (fs.existsSync(resolvedAuthority)) assert(!fs.lstatSync(resolvedAuthority).isSymbolicLink() && fs.statSync(resolvedAuthority).isDirectory(), "CUSTODY_STORE_UNSAFE", "custody authority root must be a real directory");
  else fs.mkdirSync(resolvedAuthority, {recursive: true, mode: 0o700});
  const storeRoot = path.join(resolvedAuthority, "scheduler-runtime-custody-v1");
  fs.mkdirSync(storeRoot, {recursive: true, mode: 0o700});
  assert(!fs.lstatSync(storeRoot).isSymbolicLink(), "CUSTODY_STORE_UNSAFE", "custody store root may not be a symlink");
  const statePath = path.join(storeRoot, "state.json");
  const lockPath = path.join(storeRoot, "cas.lock.json");
  if (!fs.existsSync(statePath)) {
    const seed = initialState ?? compileSchedulerRuntimeCustodyState();
    validateSchedulerRuntimeCustodyState(seed);
    try {
      writeJsonExclusive(statePath, seed);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }

  function read() {
    return validateSchedulerRuntimeCustodyState(readSafeJson(statePath, "custody store state"));
  }

  function acquireLock() {
    const observedAtUtc = clock();
    requireUtc(observedAtUtc, "custody store clock");
    const lock = addressed({schema: "agentos.scheduler_runtime_custody_store_lock.v1", version: 1, status: "HELD", token_sha256: canonicalDigest(crypto.randomBytes(32).toString("hex")), owner_process: ownerProcessProvenance, acquired_at_utc: observedAtUtc, lock_sha256: null}, "lock_sha256");
    try {
      writeJsonExclusive(lockPath, lock);
      return validateStoreLock(lock);
    } catch (error) {
      if (error?.code === "EEXIST") fail("CUSTODY_STORE_LOCK_HELD", "custody store lock requires exact process readback or absence recovery");
      throw error;
    }
  }

  function releaseLock(lock) {
    const current = validateStoreLock(readSafeJson(lockPath, "custody store lock"));
    assert(current.lock_sha256 === lock.lock_sha256 && current.token_sha256 === lock.token_sha256 && current.owner_process.process_instance_sha256 === ownerProcessProvenance.process_instance_sha256, "CUSTODY_STORE_LOCK_REPLACED", "custody store lock identity changed before release");
    fs.unlinkSync(lockPath);
  }

  return Object.freeze({
    root: () => storeRoot,
    read,
    compareAndSwap({expectedStateSha256, transition} = {}) {
      requireSha(expectedStateSha256, "custody store expected state digest");
      assert(typeof transition === "function", "CUSTODY_STORE_INVALID", "custody store transition must be callable");
      const lock = acquireLock();
      try {
        const current = read();
        assert(current.state_sha256 === expectedStateSha256, "CUSTODY_CAS_MISMATCH", "custody store state changed before commit");
        const next = transition(structuredClone(current));
        validateSchedulerRuntimeCustodyState(next);
        assert(next.revision === current.revision + 1, "CUSTODY_REVISION_INVALID", "custody store transition must append exactly one revision");
        writeJsonAtomic(statePath, next);
        const readback = read();
        assert(readback.state_sha256 === next.state_sha256, "CUSTODY_STORE_READBACK_FAILED", "custody store atomic readback differs");
        return readback;
      } finally {
        releaseLock(lock);
      }
    },
    inspectLock() {
      return fs.existsSync(lockPath) ? validateStoreLock(readSafeJson(lockPath, "custody store lock")) : null;
    },
    recoverLock({absenceProof} = {}) {
      const lock = validateStoreLock(readSafeJson(lockPath, "custody store lock"));
      validateProcessAbsenceProof(absenceProof);
      assert(absenceProof.job_id === "CUSTODY-STORE" && absenceProof.lease_id === "CUSTODY-STORE-LOCK" && absenceProof.expected_process_instance_sha256 === lock.owner_process.process_instance_sha256 && absenceProof.expected_pid === lock.owner_process.pid, "PROCESS_ABSENCE_UNPROVEN", "store lock absence proof differs from exact holder");
      if (absenceProof.observed_pid_status === "OBSERVED_PID_REUSED") assert(absenceProof.observed_start_identity_sha256 !== lock.owner_process.start_identity_sha256, "PROCESS_ABSENCE_UNPROVEN", "store lock PID still belongs to the exact holder");
      fs.unlinkSync(lockPath);
      return addressed({schema: "agentos.scheduler_runtime_custody_store_recovery.v1", version: 1, status: "STALE_LOCK_RELEASED", prior_lock_sha256: lock.lock_sha256, absence_proof_sha256: absenceProof.proof_sha256, effects_applied: ["EXACT_STALE_LOCK_FILE_REMOVED"], recovery_sha256: null}, "recovery_sha256");
    },
  });
}

export function verifySchedulerRuntimeCustodyBinding({repositoryRoot, bindingPath = "governance/3.0/scheduler-runtime-custody-binding.v1.json"} = {}) {
  assert(typeof repositoryRoot === "string" && path.isAbsolute(repositoryRoot), "CUSTODY_BINDING_INVALID", "repository root must be absolute at verification time");
  const binding = JSON.parse(fs.readFileSync(path.join(repositoryRoot, bindingPath), "utf8"));
  exactKeys(binding, ["schema", "version", "status", "authority_graph_sha256", "artifacts", "migration", "invalidation", "runtime_effects", "binding_sha256"], "custody binding");
  assert(binding.schema === "agentos.scheduler_runtime_custody_binding.v1" && binding.version === 1 && binding.status === "PREPARED_NOT_ACTIVATED", "CUSTODY_BINDING_INVALID", "custody binding identity is invalid");
  assert(binding.authority_graph_sha256 === PERMANENT_ROLE_AUTHORITY_SHA256, "CUSTODY_AUTHORITY_STALE", "custody binding authority graph is stale");
  sortedUnique(binding.artifacts.map((entry) => entry.path), "custody binding artifact paths");
  for (const artifact of binding.artifacts) {
    exactKeys(artifact, ["path", "sha256"], "custody binding artifact");
    requireSha(artifact.sha256, "custody binding artifact digest");
    const absolute = path.join(repositoryRoot, artifact.path);
    assert(fs.existsSync(absolute) && fs.statSync(absolute).isFile(), "CUSTODY_BINDING_INVALID", `bound artifact is missing: ${artifact.path}`);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    assert(actual === artifact.sha256, "CUSTODY_BINDING_INVALID", `bound artifact is stale: ${artifact.path}`);
  }
  assert(binding.migration.path === "migrations/scheduler-runtime-custody.v1.json", "CUSTODY_BINDING_INVALID", "custody migration path is invalid");
  requireSha(binding.migration.sha256, "custody migration digest");
  assert(binding.invalidation.policy_change === "INVALIDATE_ACTIVE_LEASE_MANIFESTS_AND_REQUIRE_REBIND" && binding.invalidation.authority_graph_change === "INVALIDATE_ALL_CUSTODY_AND_RUNTIME_CAPABILITIES", "CUSTODY_BINDING_INVALID", "custody invalidation fan-out is incomplete");
  assert(Object.values(binding.runtime_effects).every((value) => value === false), "CUSTODY_EFFECTS_FORBIDDEN", "custody binding grants runtime effects");
  requireSha(binding.binding_sha256, "custody binding digest");
  assert(binding.binding_sha256 === digestWithout(binding, "binding_sha256"), "CUSTODY_DIGEST_INVALID", "custody binding digest mismatch");
  return binding;
}

// Read the canonical graph roles at module load so authority drift fails before
// any state can compile, without starting or appointing any role.
assert(permanentRoleById("SCHEDULER").allowed_authority.includes("CUSTODY_PROCESSES"), "CUSTODY_AUTHORITY_STALE", "Scheduler process custody authority is absent");
assert(permanentRoleById("RUNTIME").allowed_authority.includes("DISCOVER_ENVIRONMENT_READ_ONLY"), "CUSTODY_AUTHORITY_STALE", "Runtime read-only discovery authority is absent");
assert(permanentRoleById("CONTROLLER").prohibited_authority.includes("BUILD_WITH_BOUND_CAPABILITY"), "CUSTODY_AUTHORITY_STALE", "Controller heavy-execution prohibition is absent");

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("scheduler/runtime custody substrate loaded\n");
