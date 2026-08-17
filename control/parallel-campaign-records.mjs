#!/usr/bin/env node

/*
 * A host-neutral, content-addressed campaign scheduler.
 *
 * This module owns campaign planning, dependency ordering, exclusive worker
 * custody, progress/handoff records, and clean closure. It deliberately does
 * not create threads, worktrees, or provider sessions. Those capabilities are
 * injected through executeWorker and auditHandoff, so this layer cannot claim
 * success without an actual host result.
 */

import {
  assertPersistedRecordSafe,
  canonicalDigest,
  compareUtf8,
} from "./content-addressing.mjs";
import {validateAutonomousLaneHandoff} from "./autonomous-lane-handoff.mjs";

export const PARALLEL_CAMPAIGN_PLAN_SCHEMA = "agentos.parallel_campaign_plan.v1";
export const PARALLEL_CAMPAIGN_STATE_SCHEMA = "agentos.parallel_campaign_state.v1";
export const PARALLEL_CAMPAIGN_WORKER_SCHEMA = "agentos.parallel_campaign_worker.v1";
export const PARALLEL_CAMPAIGN_LEASE_SCHEMA = "agentos.parallel_campaign_lease.v1";
export const PARALLEL_CAMPAIGN_PROGRESS_SCHEMA = "agentos.parallel_campaign_progress.v1";
export const PARALLEL_CAMPAIGN_HANDOFF_SCHEMA = "agentos.parallel_campaign_handoff.v1";
export const PARALLEL_CAMPAIGN_AUDIT_SCHEMA = "agentos.parallel_campaign_audit.v1";
export const PARALLEL_CAMPAIGN_FAILURE_SCHEMA = "agentos.parallel_campaign_failure.v1";
export const PARALLEL_CAMPAIGN_EVENT_SCHEMA = "agentos.parallel_campaign_event.v1";

export const CAMPAIGN_STATES = Object.freeze([
  "PREPARED_NOT_ACTIVATED",
  "RUNNING",
  "BLOCKED",
  "CLOSED",
]);

export const WORKER_STATES = Object.freeze([
  "READY",
  "LEASED",
  "RUNNING",
  "PROGRESS_RECORDED",
  "HANDOFF_READY",
  "CLOSING",
  "CLOSED",
  "FAILED",
  "REPAIR_REQUIRED",
]);

export const LEASE_STATES = Object.freeze([
  "ACTIVE",
  "RELEASED",
  "EXPIRED",
  "FENCED",
]);

export const MEANINGFUL_RESULT_TYPES = Object.freeze([
  "ARTIFACT",
  "VERIFIED_BEHAVIOR",
  "BOUNDED_HANDOFF",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const OPAQUE_SESSION_REF = /^opaque:session:[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const FAILURE_CODE = /^[A-Z][A-Z0-9_:-]*$/u;

const PLAN_KEYS = [
  "schema", "version", "status", "campaign_id", "campaign_version", "logical_lineage_id",
  "goal_id", "goal_sha256", "source", "policy", "lanes", "plan_sha256",
];
const PLAN_SOURCE_KEYS = ["commit", "tree", "worktree_id"];
const PLAN_POLICY_KEYS = ["progress_window_minutes", "max_concurrent_workers"];
const LANE_KEYS = [
  "lane_id", "role", "display_name", "dependencies", "writable_scope", "task_sha256", "lane_sha256",
];
const STATE_KEYS = [
  "schema", "version", "status", "campaign_id", "campaign_version", "logical_lineage_id",
  "goal_id", "goal_sha256", "source", "plan_sha256", "policy", "workers", "events",
  "closed_at_utc", "state_sha256",
];
const WORKER_KEYS = [
  "schema", "version", "worker_ref", "display_name", "role", "lane_id", "campaign_id",
  "campaign_version", "logical_lineage_id", "goal_id", "goal_sha256", "source", "dependencies",
  "writable_scope", "task_sha256", "attempt", "state", "lease", "session_ref", "progress",
  "handoff", "autonomous_handoff", "audit", "failure",
];
const LEASE_KEYS = [
  "schema", "version", "lease_id", "campaign_id", "campaign_version", "worker_ref", "lane_id",
  "goal_id", "goal_sha256", "source", "epoch", "status", "acquired_at_utc", "expires_at_utc",
  "renewed_at_utc", "released_at_utc", "release_reason", "lease_sha256",
];
const PROGRESS_KEYS = [
  "schema", "version", "worker_ref", "session_ref", "campaign_id", "campaign_version",
  "logical_lineage_id", "goal_id", "goal_sha256", "source", "result_type", "summary",
  "artifact_sha256", "evidence_sha256", "observed_at_utc", "progress_sha256",
];
const HANDOFF_KEYS = [
  "schema", "version", "worker_ref", "session_ref", "campaign_id", "campaign_version",
  "logical_lineage_id", "goal_id", "goal_sha256", "source", "result_type", "summary",
  "artifact_sha256", "evidence_sha256", "progress_sha256", "observed_at_utc", "handoff_sha256",
];
const AUDIT_KEYS = [
  "schema", "version", "worker_ref", "auditor_ref", "session_ref", "auditor_session_ref",
  "campaign_id", "campaign_version", "logical_lineage_id", "goal_id", "goal_sha256", "source",
  "handoff_sha256", "accepted", "evidence_sha256", "observed_at_utc", "audit_sha256",
];
const FAILURE_KEYS = [
  "schema", "version", "worker_ref", "lease_id", "campaign_id", "campaign_version",
  "code", "error_sha256", "observed_at_utc", "failure_sha256",
];
const EVENT_KEYS = [
  "schema", "version", "sequence", "event_type", "campaign_id", "campaign_version",
  "worker_ref", "lease_id", "from_campaign_status", "to_campaign_status", "prior_event_sha256",
  "payload_sha256", "observed_at_utc", "event_sha256",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(!value.includes("/") && !value.includes("\\"), `${label} contains a private path`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireOpaqueSessionRef(value, label) {
  requireString(value, label);
  assert(OPAQUE_SESSION_REF.test(value), `${label} must be an opaque session reference`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function requireFailureCode(value, label) {
  requireString(value, label);
  assert(FAILURE_CODE.test(value), `${label} is invalid`);
}

function requirePositiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
}

function clone(value) {
  return structuredClone(value);
}

function digestWithout(value, field) {
  return canonicalDigest({...clone(value), [field]: null});
}

function seal(value, field) {
  const next = clone(value);
  next[field] = digestWithout(next, field);
  return next;
}

function validateSource(source, label = "source") {
  exactKeys(source, PLAN_SOURCE_KEYS, label);
  for (const field of PLAN_SOURCE_KEYS) requireIdentifier(source[field], `${label}.${field}`);
  return source;
}

function validatePolicy(policy, label = "policy") {
  exactKeys(policy, PLAN_POLICY_KEYS, label);
  assert(Number.isSafeInteger(policy.progress_window_minutes) && policy.progress_window_minutes >= 1 && policy.progress_window_minutes <= 240,
    `${label}.progress_window_minutes must be between 1 and 240`);
  requirePositiveInteger(policy.max_concurrent_workers, `${label}.max_concurrent_workers`);
  return policy;
}

function validateDependencies(dependencies, laneIds, laneId) {
  assert(Array.isArray(dependencies), `${laneId} dependencies must be an array`);
  const sorted = [...dependencies].sort(compareUtf8);
  assert(JSON.stringify(dependencies) === JSON.stringify(sorted), `${laneId} dependencies must be sorted`);
  assert(new Set(dependencies).size === dependencies.length, `${laneId} dependencies must be unique`);
  for (const dependency of dependencies) {
    requireIdentifier(dependency, `${laneId} dependency`);
    assert(dependency !== laneId, `${laneId} cannot depend on itself`);
    assert(laneIds.has(dependency), `${laneId} depends on an unknown lane`);
  }
}

function validateLane(lane, laneIds = null, label = "lane") {
  exactKeys(lane, LANE_KEYS, label);
  for (const field of ["lane_id", "role", "display_name", "writable_scope"]) requireIdentifier(lane[field], `${label}.${field}`);
  requireSha(lane.task_sha256, `${label}.task_sha256`);
  assert(lane.role === "NAMED_LANE_WORKER", `${label}.role must be NAMED_LANE_WORKER`);
  if (laneIds !== null) validateDependencies(lane.dependencies, laneIds, lane.lane_id);
  requireSha(lane.lane_sha256, `${label}.lane_sha256`);
  assert(lane.lane_sha256 === digestWithout(lane, "lane_sha256"), `${label}.lane_sha256 does not match content`);
  return lane;
}

function detectDependencyCycle(lanes) {
  const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]));
  const visiting = new Set();
  const visited = new Set();
  const walk = (laneId) => {
    if (visited.has(laneId)) return;
    assert(!visiting.has(laneId), `campaign lane dependency cycle includes ${laneId}`);
    visiting.add(laneId);
    for (const dependency of byId.get(laneId).dependencies) walk(dependency);
    visiting.delete(laneId);
    visited.add(laneId);
  };
  for (const lane of lanes) walk(lane.lane_id);
}

export function workerDisplayName(laneId, campaignVersion, attempt = 1) {
  requireIdentifier(laneId, "lane ID");
  requireIdentifier(campaignVersion, "campaign version");
  requirePositiveInteger(attempt, "worker attempt");
  return `${laneId}:${campaignVersion}:ATTEMPT-${attempt}`;
}

export function opaqueSessionRef(runtimeIdentity) {
  assert((typeof runtimeIdentity === "string" && runtimeIdentity.length > 0) || (isRecord(runtimeIdentity) && Object.keys(runtimeIdentity).length > 0), "runtime session identity is required");
  return `opaque:session:${canonicalDigest({runtime_identity: runtimeIdentity})}`;
}

export function compileParallelCampaignPlan({
  campaignId,
  campaignVersion,
  logicalLineageId,
  goalId,
  goalSha256,
  source,
  lanes,
  progressWindowMinutes = 15,
  maxConcurrentWorkers = null,
}) {
  for (const [value, label] of [[campaignId, "campaign ID"], [campaignVersion, "campaign version"], [logicalLineageId, "logical lineage ID"], [goalId, "goal ID"]]) {
    requireIdentifier(value, label);
  }
  requireSha(goalSha256, "goal SHA-256");
  validateSource(source);
  assert(Array.isArray(lanes) && lanes.length > 0, "campaign lanes must be a nonempty array");
  const laneIds = new Set(lanes.map((lane) => lane?.lane_id));
  assert(laneIds.size === lanes.length && ![...laneIds].some((laneId) => typeof laneId !== "string"), "campaign lane IDs must be unique");
  const normalizedLanes = lanes.map((input) => {
    requireIdentifier(input?.lane_id, "campaign lane ID");
    const dependencies = [...(input.dependencies ?? [])].sort(compareUtf8);
    const lane = {
      lane_id: input.lane_id,
      role: "NAMED_LANE_WORKER",
      display_name: workerDisplayName(input.lane_id, campaignVersion),
      dependencies,
      writable_scope: input.writable_scope,
      task_sha256: input.task_sha256,
      lane_sha256: null,
    };
    lane.lane_sha256 = digestWithout(lane, "lane_sha256");
    return lane;
  }).sort((left, right) => compareUtf8(left.lane_id, right.lane_id));
  const normalizedPolicy = {
    progress_window_minutes: progressWindowMinutes,
    max_concurrent_workers: maxConcurrentWorkers ?? 1,
  };
  validatePolicy(normalizedPolicy);
  const normalizedPlan = {
    schema: PARALLEL_CAMPAIGN_PLAN_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    logical_lineage_id: logicalLineageId,
    goal_id: goalId,
    goal_sha256: goalSha256,
    source: clone(source),
    policy: normalizedPolicy,
    lanes: normalizedLanes,
    plan_sha256: null,
  };
  const sealedPlan = seal(normalizedPlan, "plan_sha256");
  return validateParallelCampaignPlan(sealedPlan);
}

export function validateParallelCampaignPlan(plan) {
  exactKeys(plan, PLAN_KEYS, "parallel campaign plan");
  assert(plan.schema === PARALLEL_CAMPAIGN_PLAN_SCHEMA && plan.version === 1, "parallel campaign plan identity is invalid");
  assert(plan.status === "PREPARED_NOT_ACTIVATED", "parallel campaign plan must remain prepared and inactive");
  for (const [value, label] of [[plan.campaign_id, "campaign ID"], [plan.campaign_version, "campaign version"], [plan.logical_lineage_id, "logical lineage ID"], [plan.goal_id, "goal ID"]]) requireIdentifier(value, label);
  requireSha(plan.goal_sha256, "campaign goal SHA-256");
  validateSource(plan.source, "campaign plan source");
  validatePolicy(plan.policy, "campaign plan policy");
  assert(Array.isArray(plan.lanes) && plan.lanes.length > 0, "parallel campaign plan lanes are missing");
  const laneIds = new Set(plan.lanes.map((lane) => lane.lane_id));
  assert(laneIds.size === plan.lanes.length, "parallel campaign plan lane IDs must be unique");
  let previousLaneId = null;
  for (const lane of plan.lanes) {
    validateLane(lane, laneIds, "parallel campaign lane");
    if (previousLaneId !== null) assert(compareUtf8(previousLaneId, lane.lane_id) < 0, "parallel campaign lanes must be sorted");
    previousLaneId = lane.lane_id;
  }
  detectDependencyCycle(plan.lanes);
  assert(plan.policy.max_concurrent_workers <= plan.lanes.length, "parallel campaign concurrency exceeds lane count");
  requireSha(plan.plan_sha256, "parallel campaign plan");
  assert(plan.plan_sha256 === digestWithout(plan, "plan_sha256"), "parallel campaign plan digest does not match content");
  assertPersistedRecordSafe(plan);
  return plan;
}

function compileWorker(plan, lane, attempt = 1) {
  const worker = {
    schema: PARALLEL_CAMPAIGN_WORKER_SCHEMA,
    version: 1,
    worker_ref: `${plan.campaign_id}:${plan.campaign_version}:${lane.lane_id}:ATTEMPT-${attempt}`,
    display_name: workerDisplayName(lane.lane_id, plan.campaign_version, attempt),
    role: lane.role,
    lane_id: lane.lane_id,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    logical_lineage_id: plan.logical_lineage_id,
    goal_id: plan.goal_id,
    goal_sha256: plan.goal_sha256,
    source: clone(plan.source),
    dependencies: [...lane.dependencies],
    writable_scope: lane.writable_scope,
    task_sha256: lane.task_sha256,
    attempt,
    state: "READY",
    lease: null,
    session_ref: null,
    progress: null,
    handoff: null,
    autonomous_handoff: null,
    audit: null,
    failure: null,
  };
  validateWorker(worker, plan);
  return worker;
}

function compileEvent(state, {eventType, workerRef = null, leaseId = null, payload, observedAtUtc, toCampaignStatus = state.status}) {
  const body = {
    schema: PARALLEL_CAMPAIGN_EVENT_SCHEMA,
    version: 1,
    sequence: state.events.length,
    event_type: eventType,
    campaign_id: state.campaign_id,
    campaign_version: state.campaign_version,
    worker_ref: workerRef,
    lease_id: leaseId,
    from_campaign_status: state.status,
    to_campaign_status: toCampaignStatus,
    prior_event_sha256: state.events.at(-1)?.event_sha256 ?? null,
    payload_sha256: canonicalDigest(payload ?? {}),
    observed_at_utc: observedAtUtc,
    event_sha256: null,
  };
  body.event_sha256 = digestWithout(body, "event_sha256");
  return body;
}

function validateEvent(event, state, index) {
  exactKeys(event, EVENT_KEYS, `parallel campaign event ${index}`);
  assert(event.schema === PARALLEL_CAMPAIGN_EVENT_SCHEMA && event.version === 1, `parallel campaign event ${index} identity is invalid`);
  assert(event.sequence === index, `parallel campaign event ${index} sequence is invalid`);
  requireIdentifier(event.event_type, `parallel campaign event ${index} type`);
  assert(event.campaign_id === state.campaign_id && event.campaign_version === state.campaign_version, `parallel campaign event ${index} campaign identity differs`);
  if (event.worker_ref !== null) requireIdentifier(event.worker_ref, `parallel campaign event ${index} worker`);
  if (event.lease_id !== null) requireIdentifier(event.lease_id, `parallel campaign event ${index} lease`);
  assert(CAMPAIGN_STATES.includes(event.from_campaign_status) && CAMPAIGN_STATES.includes(event.to_campaign_status), `parallel campaign event ${index} campaign status is invalid`);
  if (event.prior_event_sha256 !== null) requireSha(event.prior_event_sha256, `parallel campaign event ${index} predecessor`);
  requireSha(event.payload_sha256, `parallel campaign event ${index} payload`);
  requireUtc(event.observed_at_utc, `parallel campaign event ${index} time`);
  requireSha(event.event_sha256, `parallel campaign event ${index}`);
  assert(event.event_sha256 === digestWithout(event, "event_sha256"), `parallel campaign event ${index} digest does not match content`);
}

function compileLease(plan, worker, atUtc) {
  const lease = {
    schema: PARALLEL_CAMPAIGN_LEASE_SCHEMA,
    version: 1,
    lease_id: `${worker.worker_ref}:LEASE-1`,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    worker_ref: worker.worker_ref,
    lane_id: worker.lane_id,
    goal_id: plan.goal_id,
    goal_sha256: plan.goal_sha256,
    source: clone(plan.source),
    epoch: 1,
    status: "ACTIVE",
    acquired_at_utc: atUtc,
    expires_at_utc: addMinutes(atUtc, plan.policy.progress_window_minutes),
    renewed_at_utc: null,
    released_at_utc: null,
    release_reason: null,
    lease_sha256: null,
  };
  return seal(lease, "lease_sha256");
}

function validateLease(lease, plan, worker, label = "parallel campaign lease") {
  exactKeys(lease, LEASE_KEYS, label);
  assert(lease.schema === PARALLEL_CAMPAIGN_LEASE_SCHEMA && lease.version === 1, `${label} identity is invalid`);
  assert(lease.lease_id === `${worker.worker_ref}:LEASE-1`, `${label} ID is not bound to the worker`);
  assert(lease.campaign_id === plan.campaign_id && lease.campaign_version === plan.campaign_version, `${label} campaign identity differs`);
  assert(lease.worker_ref === worker.worker_ref && lease.lane_id === worker.lane_id, `${label} worker identity differs`);
  assert(lease.goal_id === plan.goal_id && lease.goal_sha256 === plan.goal_sha256, `${label} goal differs`);
  validateSource(lease.source, `${label} source`);
  assert(JSON.stringify(lease.source) === JSON.stringify(plan.source), `${label} source differs`);
  assert(lease.epoch === 1, `${label} epoch is invalid`);
  assert(LEASE_STATES.includes(lease.status), `${label} status is invalid`);
  requireUtc(lease.acquired_at_utc, `${label} acquisition time`);
  requireUtc(lease.expires_at_utc, `${label} expiry time`);
  if (lease.renewed_at_utc !== null) requireUtc(lease.renewed_at_utc, `${label} renewal time`);
  if (lease.released_at_utc !== null) requireUtc(lease.released_at_utc, `${label} release time`);
  if (lease.release_reason !== null) requireIdentifier(lease.release_reason, `${label} release reason`);
  requireSha(lease.lease_sha256, label);
  assert(lease.lease_sha256 === digestWithout(lease, "lease_sha256"), `${label} digest does not match content`);
  return lease;
}

function compileProgress({plan, worker, sessionRef, resultType, summary, artifactSha256, evidenceSha256, observedAtUtc}) {
  const progress = {
    schema: PARALLEL_CAMPAIGN_PROGRESS_SCHEMA,
    version: 1,
    worker_ref: worker.worker_ref,
    session_ref: sessionRef,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    logical_lineage_id: plan.logical_lineage_id,
    goal_id: plan.goal_id,
    goal_sha256: plan.goal_sha256,
    source: clone(plan.source),
    result_type: resultType,
    summary,
    artifact_sha256: artifactSha256,
    evidence_sha256: evidenceSha256,
    observed_at_utc: observedAtUtc,
    progress_sha256: null,
  };
  progress.progress_sha256 = digestWithout(progress, "progress_sha256");
  return progress;
}

export function validateParallelCampaignProgress(progress, plan, worker, label = "parallel campaign progress") {
  exactKeys(progress, PROGRESS_KEYS, label);
  assert(progress.schema === PARALLEL_CAMPAIGN_PROGRESS_SCHEMA && progress.version === 1, `${label} identity is invalid`);
  validateBoundIdentity(progress, plan, worker, label);
  requireOpaqueSessionRef(progress.session_ref, `${label} session reference`);
  assert(MEANINGFUL_RESULT_TYPES.includes(progress.result_type), `${label} result is not meaningful`);
  requireString(progress.summary, `${label} summary`);
  assert(progress.summary.length <= 4_000, `${label} summary is too long`);
  requireSha(progress.artifact_sha256, `${label} artifact`);
  requireSha(progress.evidence_sha256, `${label} evidence`);
  requireUtc(progress.observed_at_utc, `${label} observed time`);
  requireSha(progress.progress_sha256, label);
  assert(progress.progress_sha256 === digestWithout(progress, "progress_sha256"), `${label} digest does not match content`);
  assertPersistedRecordSafe(progress);
  return progress;
}

function compileHandoff({plan, worker, progress, observedAtUtc}) {
  const handoff = {
    schema: PARALLEL_CAMPAIGN_HANDOFF_SCHEMA,
    version: 1,
    worker_ref: worker.worker_ref,
    session_ref: progress.session_ref,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    logical_lineage_id: plan.logical_lineage_id,
    goal_id: plan.goal_id,
    goal_sha256: plan.goal_sha256,
    source: clone(plan.source),
    result_type: progress.result_type,
    summary: progress.summary,
    artifact_sha256: progress.artifact_sha256,
    evidence_sha256: progress.evidence_sha256,
    progress_sha256: progress.progress_sha256,
    observed_at_utc: observedAtUtc,
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = digestWithout(handoff, "handoff_sha256");
  return handoff;
}

export function validateParallelCampaignHandoff(handoff, plan, worker, progress, label = "parallel campaign handoff") {
  exactKeys(handoff, HANDOFF_KEYS, label);
  assert(handoff.schema === PARALLEL_CAMPAIGN_HANDOFF_SCHEMA && handoff.version === 1, `${label} identity is invalid`);
  validateBoundIdentity(handoff, plan, worker, label);
  assert(handoff.session_ref === progress.session_ref, `${label} session differs from progress`);
  assert(handoff.result_type === progress.result_type && handoff.summary === progress.summary, `${label} result differs from progress`);
  assert(handoff.artifact_sha256 === progress.artifact_sha256 && handoff.evidence_sha256 === progress.evidence_sha256, `${label} evidence differs from progress`);
  assert(handoff.progress_sha256 === progress.progress_sha256, `${label} is not bound to progress`);
  requireUtc(handoff.observed_at_utc, `${label} observed time`);
  requireSha(handoff.handoff_sha256, label);
  assert(handoff.handoff_sha256 === digestWithout(handoff, "handoff_sha256"), `${label} digest does not match content`);
  assertPersistedRecordSafe(handoff);
  return handoff;
}

function compileAudit({plan, worker, handoff, auditorRef, auditorSessionRef, accepted, evidenceSha256, observedAtUtc}) {
  const audit = {
    schema: PARALLEL_CAMPAIGN_AUDIT_SCHEMA,
    version: 1,
    worker_ref: worker.worker_ref,
    auditor_ref: auditorRef,
    session_ref: worker.session_ref,
    auditor_session_ref: auditorSessionRef,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    logical_lineage_id: plan.logical_lineage_id,
    goal_id: plan.goal_id,
    goal_sha256: plan.goal_sha256,
    source: clone(plan.source),
    handoff_sha256: handoff.handoff_sha256,
    accepted,
    evidence_sha256: evidenceSha256,
    observed_at_utc: observedAtUtc,
    audit_sha256: null,
  };
  audit.audit_sha256 = digestWithout(audit, "audit_sha256");
  return audit;
}

export function validateParallelCampaignAudit(audit, plan, worker, handoff, label = "parallel campaign audit") {
  exactKeys(audit, AUDIT_KEYS, label);
  assert(audit.schema === PARALLEL_CAMPAIGN_AUDIT_SCHEMA && audit.version === 1, `${label} identity is invalid`);
  validateBoundIdentity(audit, plan, worker, label);
  requireIdentifier(audit.auditor_ref, `${label} Auditor reference`);
  requireOpaqueSessionRef(audit.auditor_session_ref, `${label} Auditor session reference`);
  assert(audit.auditor_ref !== worker.worker_ref, `${label} cannot be issued by the worker`);
  assert(audit.auditor_session_ref !== worker.session_ref, `${label} cannot reuse the worker session`);
  assert(audit.handoff_sha256 === handoff.handoff_sha256, `${label} handoff differs`);
  assert(typeof audit.accepted === "boolean", `${label} acceptance must be boolean`);
  requireSha(audit.evidence_sha256, `${label} evidence`);
  requireUtc(audit.observed_at_utc, `${label} observed time`);
  requireSha(audit.audit_sha256, label);
  assert(audit.audit_sha256 === digestWithout(audit, "audit_sha256"), `${label} digest does not match content`);
  assertPersistedRecordSafe(audit);
  return audit;
}

function compileFailure({plan, worker, leaseId, error, code, observedAtUtc}) {
  const safeCode = typeof code === "string" && FAILURE_CODE.test(code) ? code : "WORKER_EXECUTION_FAILED";
  const failure = {
    schema: PARALLEL_CAMPAIGN_FAILURE_SCHEMA,
    version: 1,
    worker_ref: worker.worker_ref,
    lease_id: leaseId,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    code: safeCode,
    error_sha256: canonicalDigest({name: error?.name ?? "Error", message: String(error?.message ?? error ?? "unknown")}),
    observed_at_utc: observedAtUtc,
    failure_sha256: null,
  };
  return seal(failure, "failure_sha256");
}

function validateFailure(failure, plan, worker, label = "parallel campaign failure") {
  exactKeys(failure, FAILURE_KEYS, label);
  assert(failure.schema === PARALLEL_CAMPAIGN_FAILURE_SCHEMA && failure.version === 1, `${label} identity is invalid`);
  assert(failure.worker_ref === worker.worker_ref && failure.lease_id === worker.lease.lease_id, `${label} worker or lease differs`);
  assert(failure.campaign_id === plan.campaign_id && failure.campaign_version === plan.campaign_version, `${label} campaign identity differs`);
  requireFailureCode(failure.code, `${label} code`);
  requireSha(failure.error_sha256, `${label} error`);
  requireUtc(failure.observed_at_utc, `${label} observed time`);
  requireSha(failure.failure_sha256, label);
  assert(failure.failure_sha256 === digestWithout(failure, "failure_sha256"), `${label} digest does not match content`);
  assertPersistedRecordSafe(failure);
  return failure;
}

function validateBoundIdentity(value, plan, worker, label) {
  assert(value.worker_ref === worker.worker_ref, `${label} worker identity differs`);
  assert(value.campaign_id === plan.campaign_id && value.campaign_version === plan.campaign_version, `${label} campaign identity differs`);
  assert(value.logical_lineage_id === plan.logical_lineage_id, `${label} lineage differs`);
  assert(value.goal_id === plan.goal_id && value.goal_sha256 === plan.goal_sha256, `${label} goal differs`);
  validateSource(value.source, `${label} source`);
  assert(JSON.stringify(value.source) === JSON.stringify(plan.source), `${label} source differs`);
}

function validateWorker(worker, plan, label = "parallel campaign worker") {
  exactKeys(worker, WORKER_KEYS, label);
  assert(worker.schema === PARALLEL_CAMPAIGN_WORKER_SCHEMA && worker.version === 1, `${label} identity is invalid`);
  for (const field of ["worker_ref", "display_name", "role", "lane_id", "campaign_id", "campaign_version", "logical_lineage_id", "goal_id", "writable_scope"]) requireIdentifier(worker[field], `${label}.${field}`);
  requireSha(worker.goal_sha256, `${label}.goal_sha256`);
  requireSha(worker.task_sha256, `${label}.task_sha256`);
  assert(worker.role === "NAMED_LANE_WORKER", `${label} role is invalid`);
  assert(worker.campaign_id === plan.campaign_id && worker.campaign_version === plan.campaign_version, `${label} campaign identity differs`);
  assert(worker.logical_lineage_id === plan.logical_lineage_id && worker.goal_id === plan.goal_id && worker.goal_sha256 === plan.goal_sha256, `${label} goal lineage differs`);
  validateSource(worker.source, `${label} source`);
  assert(JSON.stringify(worker.source) === JSON.stringify(plan.source), `${label} source differs`);
  const planLane = plan.lanes.find((lane) => lane.lane_id === worker.lane_id);
  assert(planLane, `${label} lane is not in plan`);
  assert(worker.display_name === workerDisplayName(worker.lane_id, worker.campaign_version, worker.attempt), `${label} display name is not versioned`);
  assert(worker.dependencies.length === planLane.dependencies.length && worker.dependencies.every((value, index) => value === planLane.dependencies[index]), `${label} dependency binding differs`);
  assert(worker.writable_scope === planLane.writable_scope && worker.task_sha256 === planLane.task_sha256, `${label} assignment binding differs`);
  requirePositiveInteger(worker.attempt, `${label} attempt`);
  assert(WORKER_STATES.includes(worker.state), `${label} state is invalid`);
  if (worker.session_ref !== null) requireOpaqueSessionRef(worker.session_ref, `${label} session reference`);
  if (worker.lease !== null) validateLease(worker.lease, plan, worker, `${label} lease`);
  if (worker.progress !== null) validateParallelCampaignProgress(worker.progress, plan, worker, `${label} progress`);
  if (worker.handoff !== null) validateParallelCampaignHandoff(worker.handoff, plan, worker, worker.progress, `${label} handoff`);
  if (worker.autonomous_handoff !== null) {
    validateAutonomousLaneHandoff(worker.autonomous_handoff);
    assert(worker.autonomous_handoff.lane_id === worker.lane_id, `${label} autonomous handoff lane differs`);
    assert(worker.autonomous_handoff.worker_ref === worker.worker_ref, `${label} autonomous handoff worker differs`);
    assert(worker.autonomous_handoff.campaign_id === worker.campaign_id, `${label} autonomous handoff campaign differs`);
    assert(worker.autonomous_handoff.campaign_version === worker.campaign_version, `${label} autonomous handoff version differs`);
    assert(worker.autonomous_handoff.goal_sha256 === worker.goal_sha256, `${label} autonomous handoff goal differs`);
    assert(worker.autonomous_handoff.writable_scope === worker.writable_scope, `${label} autonomous handoff scope differs`);
  }
  if (worker.audit !== null) validateParallelCampaignAudit(worker.audit, plan, worker, worker.handoff, `${label} audit`);
  if (worker.failure !== null) validateFailure(worker.failure, plan, worker, `${label} failure`);
  const activeStates = new Set(["LEASED", "RUNNING", "PROGRESS_RECORDED", "HANDOFF_READY", "CLOSING"]);
  if (worker.state === "READY") assert(worker.lease === null && worker.session_ref === null && worker.progress === null && worker.handoff === null && worker.autonomous_handoff === null && worker.audit === null && worker.failure === null, `${label} READY state has execution data`);
  if (activeStates.has(worker.state)) assert(worker.lease?.status === "ACTIVE", `${label} active state lacks an active lease`);
  if (["RUNNING", "PROGRESS_RECORDED", "HANDOFF_READY", "CLOSING", "CLOSED"].includes(worker.state)) assert(worker.session_ref !== null, `${label} execution state lacks a session reference`);
  if (["PROGRESS_RECORDED", "HANDOFF_READY", "CLOSING", "CLOSED"].includes(worker.state)) assert(worker.progress !== null, `${label} handoff state lacks progress`);
  if (["HANDOFF_READY", "CLOSING", "CLOSED", "REPAIR_REQUIRED"].includes(worker.state)) assert(worker.handoff !== null, `${label} terminal handoff state lacks a handoff`);
  if (["CLOSING", "CLOSED"].includes(worker.state)) {
    if (worker.autonomous_handoff !== null) {
      assert(worker.audit === null, `${label} autonomous closing state may not carry a Controller audit`);
    } else {
      assert(worker.audit?.accepted === true, `${label} closing state lacks accepted audit`);
    }
  }
  if (worker.state === "CLOSED") assert(worker.lease?.status === "RELEASED", `${label} closed worker has an active lease`);
  if (["FAILED", "REPAIR_REQUIRED"].includes(worker.state)) assert(worker.failure !== null || worker.audit !== null, `${label} failed worker lacks failure or audit evidence`);
  assertPersistedRecordSafe(worker);
  return worker;
}

function createParallelCampaignState(plan) {
  const state = {
    schema: PARALLEL_CAMPAIGN_STATE_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    logical_lineage_id: plan.logical_lineage_id,
    goal_id: plan.goal_id,
    goal_sha256: plan.goal_sha256,
    source: clone(plan.source),
    plan_sha256: plan.plan_sha256,
    policy: clone(plan.policy),
    workers: plan.lanes.map((lane) => compileWorker(plan, lane)),
    events: [],
    closed_at_utc: null,
    state_sha256: null,
  };
  return seal(state, "state_sha256");
}

export function validateParallelCampaignState(state, plan) {
  validateParallelCampaignPlan(plan);
  exactKeys(state, STATE_KEYS, "parallel campaign state");
  assert(state.schema === PARALLEL_CAMPAIGN_STATE_SCHEMA && state.version === 1, "parallel campaign state identity is invalid");
  assert(state.campaign_id === plan.campaign_id && state.campaign_version === plan.campaign_version, "parallel campaign state campaign identity differs");
  assert(state.logical_lineage_id === plan.logical_lineage_id && state.goal_id === plan.goal_id && state.goal_sha256 === plan.goal_sha256, "parallel campaign state goal lineage differs");
  validateSource(state.source, "parallel campaign state source");
  assert(JSON.stringify(state.source) === JSON.stringify(plan.source), "parallel campaign state source differs");
  assert(state.plan_sha256 === plan.plan_sha256, "parallel campaign state plan differs");
  validatePolicy(state.policy, "parallel campaign state policy");
  assert(JSON.stringify(state.policy) === JSON.stringify(plan.policy), "parallel campaign state policy differs");
  assert(CAMPAIGN_STATES.includes(state.status), "parallel campaign state status is invalid");
  assert(Array.isArray(state.workers) && state.workers.length === plan.lanes.length, "parallel campaign state workers are incomplete");
  const laneIds = new Set();
  const workerRefs = new Set();
  const workerSessionRefs = new Set();
  for (const worker of state.workers) {
    validateWorker(worker, plan);
    assert(!laneIds.has(worker.lane_id), "parallel campaign state duplicates a lane");
    assert(!workerRefs.has(worker.worker_ref), "parallel campaign state duplicates a worker reference");
    laneIds.add(worker.lane_id);
    workerRefs.add(worker.worker_ref);
    if (worker.session_ref !== null) {
      assert(!workerSessionRefs.has(worker.session_ref), "parallel campaign state reuses a worker session reference");
      workerSessionRefs.add(worker.session_ref);
    }
  }
  assert(laneIds.size === plan.lanes.length, "parallel campaign state lane coverage is incomplete");
  for (const worker of state.workers) {
    if (worker.audit === null) continue;
    assert(!workerRefs.has(worker.audit.auditor_ref), "parallel campaign state Auditor reference belongs to a worker");
    assert(!workerSessionRefs.has(worker.audit.auditor_session_ref), "parallel campaign state Auditor session belongs to a worker");
  }
  assert(Array.isArray(state.events), "parallel campaign state events are missing");
  for (const [index, event] of state.events.entries()) validateEvent(event, state, index);
  for (let index = 1; index < state.events.length; index += 1) {
    assert(state.events[index].prior_event_sha256 === state.events[index - 1].event_sha256, "parallel campaign event chain is broken");
    assert(state.events[index].from_campaign_status === state.events[index - 1].to_campaign_status, "parallel campaign event status chain is broken");
  }
  if (state.events.length > 0) assert(state.events.at(-1).to_campaign_status === state.status, "parallel campaign event head status differs from state");
  if (state.closed_at_utc !== null) requireUtc(state.closed_at_utc, "parallel campaign closed time");
  const active = state.workers.filter((worker) => worker.lease?.status === "ACTIVE");
  assert(active.length <= state.policy.max_concurrent_workers, "parallel campaign exceeds its concurrency policy");
  const scopes = new Set();
  for (const worker of active) {
    assert(!scopes.has(worker.writable_scope), "parallel campaign has exclusive custody conflict");
    scopes.add(worker.writable_scope);
  }
  if (state.status === "CLOSED") {
    assert(state.closed_at_utc !== null, "closed campaign lacks closure time");
    assert(state.workers.every((worker) => worker.state === "CLOSED"), "closed campaign has unfinished workers");
    assert(active.length === 0, "closed campaign has active leases");
  }
  if (state.status === "BLOCKED") assert(state.workers.some((worker) => ["FAILED", "REPAIR_REQUIRED"].includes(worker.state)), "blocked campaign lacks a blocked worker");
  requireSha(state.state_sha256, "parallel campaign state");
  assert(state.state_sha256 === digestWithout(state, "state_sha256"), "parallel campaign state digest does not match content");
  assertPersistedRecordSafe(state);
  return state;
}

function addMinutes(isoUtc, minutes) {
  return new Date(Date.parse(isoUtc) + minutes * 60_000).toISOString();
}

export {
  assert,
  clone,
  compileAudit,
  compileEvent,
  compileFailure,
  compileHandoff,
  compileLease,
  compileProgress,
  createParallelCampaignState,
  digestWithout,
  exactKeys,
  requireOpaqueSessionRef,
  requireUtc,
  validateFailure,
  validateLease,
  validateWorker,
};
