#!/usr/bin/env node

/* Capability-first economic model policy compiled during Spawner bootstrap. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const MODEL_POLICY_SNAPSHOT_SCHEMA = "agentos.model_policy_snapshot.v1";
export const MODEL_POLICY_PROJECTION_SCHEMA = "agentos.model_policy_projection.v1";
export const MODEL_POLICY_TASK_CLASSES = Object.freeze([
  "SIMPLE_EXTRACTION", "DETERMINISTIC_QA", "NARROW_CODING", "BROAD_ARCHITECTURE",
  "SECURITY_REVIEW", "LONG_CONTEXT_SYNTHESIS", "FINAL_INTEGRATION", "REAL_HOST_DEBUGGING",
]);
export const MODEL_POLICY_ROLE_CLASSES = Object.freeze([
  "CONTROLLER", "SPAWNER", "SCHEDULER", "RUNTIME", "ORCHESTRATOR", "PERMANENT_ROLE", "INERT_SEED", "WORKING_AGENT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

function assert(condition, message, code = "MODEL_POLICY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireString(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "DIGEST_INVALID"); }
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function digestBody(value, field) { return {...structuredClone(value), [field]: null}; }
function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const result = [...values].sort(compareUtf8);
  assert(new Set(result).size === result.length, `${label} contains duplicates`);
  return result;
}

function validateEvidence(evidence, snapshotObservedMs) {
  assert(isRecord(evidence), "Model evidence must be an object");
  requireString(evidence.evidence_id, "Model evidence ID");
  assert(["FIRST_PARTY_PROVIDER", "COMPARATIVE_BENCHMARK", "HOST_ATTESTATION"].includes(evidence.authority_class), "Model evidence authority class is invalid");
  assert(/^https:\/\//u.test(evidence.source_url) || evidence.source_url.startsWith("host-attestation:"), "Model evidence source identity is invalid");
  requireUtc(evidence.observed_at_utc, "Model evidence observation time");
  requireUtc(evidence.expires_at_utc, "Model evidence expiry");
  assert(Date.parse(evidence.expires_at_utc) > snapshotObservedMs, `Model evidence is stale: ${evidence.evidence_id}`, "BENCHMARK_EVIDENCE_STALE");
  assert(Number.isInteger(evidence.max_age_days) && evidence.max_age_days > 0, "Model evidence max age is invalid");
  assert(["LOW", "MEDIUM", "HIGH"].includes(evidence.uncertainty), "Model evidence uncertainty is invalid");
  requireSha(evidence.summary_sha256, "Model evidence summary");
  assert(evidence.raw_transcript_stored === false, "Raw browsing transcripts are forbidden");
}

export function validateModelPolicySnapshot(snapshot, {nowUtc = snapshot?.observed_at_utc, requireActive = false} = {}) {
  assert(isRecord(snapshot), "Model-policy snapshot must be an object");
  assert(snapshot.schema === MODEL_POLICY_SNAPSHOT_SCHEMA && snapshot.version === 1, "Model-policy snapshot identity is invalid");
  assert(["PREPARED_INACTIVE", "ACCEPTED_ACTIVE", "SUPERSEDED"].includes(snapshot.status), "Model-policy snapshot status is invalid");
  if (requireActive) assert(snapshot.status === "ACCEPTED_ACTIVE", "Model-policy snapshot is not active", "POLICY_SNAPSHOT_INACTIVE");
  assert(snapshot.project_agnostic === true && snapshot.visibility === "PRIVATE_GLOBAL_GOVERNANCE", "Model-policy snapshot privacy boundary is invalid");
  assert(snapshot.contains_consumer_context === false && snapshot.raw_browsing_transcripts === false, "Model-policy snapshot contains forbidden context");
  requireUtc(nowUtc, "Model-policy validation time");
  requireUtc(snapshot.observed_at_utc, "Model-policy observation time");
  requireUtc(snapshot.expires_at_utc, "Model-policy expiry");
  const nowMs = Date.parse(nowUtc);
  assert(Date.parse(snapshot.expires_at_utc) > nowMs, "Model-policy snapshot is stale", "POLICY_SNAPSHOT_STALE");
  assert(Array.isArray(snapshot.evidence) && snapshot.evidence.length >= 3, "Model-policy evidence is missing", "BENCHMARK_EVIDENCE_MISSING");
  snapshot.evidence.forEach((entry) => validateEvidence(entry, nowMs));
  assert(Array.isArray(snapshot.conflicts), "Model-policy conflicts must be explicit");
  for (const conflict of snapshot.conflicts) {
    requireString(conflict.field, "Model-policy conflict field");
    requireString(conflict.first_party_value, "Model-policy first-party conflict value");
    requireString(conflict.comparative_value, "Model-policy comparative conflict value");
    assert(conflict.resolution === "FIRST_PARTY_GOVERNS", "Model-policy conflict does not honor first-party authority");
  }
  assert(Array.isArray(snapshot.models) && snapshot.models.length > 0, "Model-policy models are missing");
  const modelIds = new Set();
  for (const model of snapshot.models) {
    assert(MODEL.test(model.model_id), "Model ID is invalid");
    assert(!modelIds.has(model.model_id), "Model-policy contains duplicate models");
    modelIds.add(model.model_id);
    assert(model.host_available === true || model.host_available === false, "Host availability is unknown", "HOST_MODEL_AVAILABILITY_UNKNOWN");
    assert(Number.isFinite(model.capability_score) && model.capability_score >= 0, "Model capability score is invalid");
    assert(Number.isFinite(model.input_usd_per_million) && model.input_usd_per_million >= 0, "Model input cost is unknown", "MODEL_COST_UNKNOWN");
    assert(Number.isFinite(model.output_usd_per_million) && model.output_usd_per_million >= 0, "Model output cost is unknown", "MODEL_COST_UNKNOWN");
    assert(Number.isFinite(model.output_tokens_per_second) && model.output_tokens_per_second > 0, "Model latency evidence is missing");
    assert(Number.isInteger(model.context_tokens) && model.context_tokens > 0, "Model context is invalid");
    assert(Array.isArray(model.supported_reasoning_efforts) && model.supported_reasoning_efforts.length > 0, "Model reasoning modes are missing");
    model.supported_reasoning_efforts.forEach((effort) => assert(EFFORTS.has(effort), `Unsupported reasoning mode in policy: ${effort}`));
    assert(Array.isArray(model.capabilities), "Model capabilities are missing");
  }
  assert(Array.isArray(snapshot.task_classes) && snapshot.task_classes.length === MODEL_POLICY_TASK_CLASSES.length, "Model-policy task-class matrix is incomplete");
  const taskIds = new Set();
  for (const task of snapshot.task_classes) {
    assert(MODEL_POLICY_TASK_CLASSES.includes(task.task_class), "Model-policy task class is invalid");
    taskIds.add(task.task_class);
    assert(Number.isFinite(task.minimum_capability_score) && task.minimum_capability_score >= 0, "Task capability floor is invalid");
    assert(Number.isInteger(task.minimum_context_tokens) && task.minimum_context_tokens > 0, "Task context floor is invalid");
    assert(Number.isFinite(task.max_input_usd_per_million) && Number.isFinite(task.max_output_usd_per_million), "Task cost boundary is unknown", "MODEL_COST_BOUNDARY_UNKNOWN");
    assert(Number.isInteger(task.max_concurrency) && task.max_concurrency > 0, "Task concurrency ceiling is invalid");
    assert(Number.isInteger(task.max_heavyweight_processes) && task.max_heavyweight_processes >= 0, "Task heavyweight ceiling is invalid");
    assert(Number.isInteger(task.max_evidence_age_days) && task.max_evidence_age_days > 0, "Task evidence age is invalid");
    assert(EFFORTS.has(task.preferred_reasoning_effort), "Task reasoning preference is invalid");
    sortedUnique(task.preferred_models, "Task preferred models").forEach((model) => assert(modelIds.has(model), `Task references an unknown model: ${model}`));
    sortedUnique(task.fallback_models, "Task fallback models").forEach((model) => assert(modelIds.has(model), `Task references an unknown fallback model: ${model}`));
    assert(Array.isArray(task.required_capabilities), "Task capabilities are invalid");
    assert(Array.isArray(task.escalation_triggers) && task.escalation_triggers.length > 0, "Task escalation triggers are missing");
  }
  assert(taskIds.size === MODEL_POLICY_TASK_CLASSES.length, "Model-policy task classes contain duplicates");
  requireSha(snapshot.snapshot_sha256, "Model-policy snapshot digest");
  assert(snapshot.snapshot_sha256 === canonicalDigest(digestBody(snapshot, "snapshot_sha256")), "Model-policy snapshot digest mismatch", "DIGEST_INVALID");
  return snapshot;
}

function projectedCost(model) { return model.input_usd_per_million + (model.output_usd_per_million * 3); }

export function selectEcoModelRoute({snapshot, taskClass, roleCapabilityFloor, requiredContextTokens, requiredCapabilities = [], nowUtc}) {
  validateModelPolicySnapshot(snapshot, {nowUtc, requireActive: true});
  assert(MODEL_POLICY_TASK_CLASSES.includes(taskClass), "Requested task class is invalid");
  const task = snapshot.task_classes.find((entry) => entry.task_class === taskClass);
  const capabilityFloor = Math.max(task.minimum_capability_score, roleCapabilityFloor);
  const contextFloor = Math.max(task.minimum_context_tokens, requiredContextTokens);
  const required = new Set([...task.required_capabilities, ...requiredCapabilities]);
  const candidates = snapshot.models.filter((model) => model.host_available
    && model.capability_score >= capabilityFloor
    && model.context_tokens >= contextFloor
    && model.input_usd_per_million <= task.max_input_usd_per_million
    && model.output_usd_per_million <= task.max_output_usd_per_million
    && model.supported_reasoning_efforts.includes(task.preferred_reasoning_effort)
    && [...required].every((capability) => model.capabilities.includes(capability)));
  assert(candidates.length > 0, "No available model satisfies the task capability/cost/context/reasoning floor", "NO_CAPABLE_ECONOMICAL_MODEL");
  candidates.sort((left, right) => projectedCost(left) - projectedCost(right)
    || right.capability_score - left.capability_score
    || compareUtf8(left.model_id, right.model_id));
  const selected = candidates[0];
  const route = {
    schema: "agentos.eco_model_route.v1", version: 1, status: "READY", task_class: taskClass,
    model_id: selected.model_id, reasoning_effort: task.preferred_reasoning_effort,
    capability_floor: capabilityFloor, selected_capability_score: selected.capability_score,
    context_floor_tokens: contextFloor, selected_context_tokens: selected.context_tokens,
    input_usd_per_million: selected.input_usd_per_million, output_usd_per_million: selected.output_usd_per_million,
    max_concurrency: task.max_concurrency, max_heavyweight_processes: task.max_heavyweight_processes,
    fallback_models: task.fallback_models, escalation_triggers: task.escalation_triggers,
    snapshot_sha256: snapshot.snapshot_sha256, route_sha256: null,
  };
  route.route_sha256 = canonicalDigest(digestBody(route, "route_sha256"));
  return route;
}

export function compileModelPolicyProjection({snapshot, roleClass, selectedRoute = null, projectedAtUtc}) {
  validateModelPolicySnapshot(snapshot, {nowUtc: projectedAtUtc, requireActive: true});
  assert(MODEL_POLICY_ROLE_CLASSES.includes(roleClass), "Model-policy projection role class is invalid");
  if (["INERT_SEED", "WORKING_AGENT"].includes(roleClass)) assert(selectedRoute !== null, `${roleClass} requires a selected compact route`);
  const projection = {
    schema: MODEL_POLICY_PROJECTION_SCHEMA, version: 1, status: "READY", read_only: true,
    role_class: roleClass, snapshot_sha256: snapshot.snapshot_sha256, expires_at_utc: snapshot.expires_at_utc,
    spawn_eligible: true,
    selected: selectedRoute === null ? null : {
      model_id: selectedRoute.model_id, reasoning_effort: selectedRoute.reasoning_effort,
      capability_floor: selectedRoute.capability_floor, context_floor_tokens: selectedRoute.context_floor_tokens,
      input_usd_per_million: selectedRoute.input_usd_per_million, output_usd_per_million: selectedRoute.output_usd_per_million,
      max_concurrency: selectedRoute.max_concurrency, max_heavyweight_processes: selectedRoute.max_heavyweight_processes,
      fallback_models: selectedRoute.fallback_models, escalation_triggers: selectedRoute.escalation_triggers,
    },
    mutation_authority: ["SPAWNER", "GOVERNED_MEMORY_ADAPTER"].includes(roleClass),
    projected_at_utc: projectedAtUtc, projection_sha256: null,
  };
  projection.projection_sha256 = canonicalDigest(digestBody(projection, "projection_sha256"));
  return projection;
}

export function compileBootstrapModelPolicyContext({snapshot, selectedRoute, projectedAtUtc}) {
  validateModelPolicySnapshot(snapshot, {nowUtc: projectedAtUtc, requireActive: true});
  const projections = MODEL_POLICY_ROLE_CLASSES.map((roleClass) => compileModelPolicyProjection({
    snapshot,
    roleClass,
    selectedRoute: ["INERT_SEED", "WORKING_AGENT"].includes(roleClass) ? selectedRoute : null,
    projectedAtUtc,
  }));
  const context = {
    schema: "agentos.bootstrap_model_policy_context.v1",
    version: 1,
    status: "READY",
    injection: "AUTOMATIC_BEFORE_ROSTER_OR_WORKER_ADMISSION",
    snapshot_sha256: snapshot.snapshot_sha256,
    projections,
    invalidation_rule: "A changed accepted snapshot invalidates every dependent compiled role context and inert seed; active workers retain their exact bound snapshot until handoff or typed safe refresh.",
    context_sha256: null,
  };
  context.context_sha256 = canonicalDigest(digestBody(context, "context_sha256"));
  return context;
}
