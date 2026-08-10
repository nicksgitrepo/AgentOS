#!/usr/bin/env node

/* Project-agnostic evaluation and independent replay records for routing. */

import {assertPersistedRecordSafe, canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  selectExecutionRoute,
  validateRoute,
} from "./task-model-routing.mjs";

export const TASK_ROUTING_EVALUATION_SCHEMA = "agentos.task_routing_evaluation.v1";
export const TASK_ROUTING_REPLAY_SCHEMA = "agentos.task_routing_replay.v1";
export const REPRESENTATIVE_TASK_CLASSES = Object.freeze([
  "ROUTINE_BUILD",
  "SENSITIVE_REVIEW",
  "CONTEXT_RETRIEVAL",
  "REPAIR_RECOVERY",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}(?:T|$)/u;

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireRecord(value, label) {
  assertCondition(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function requireString(value, label) {
  assertCondition(typeof value === "string" && value.length > 0 && value === value.trim(), `${label} must be a trimmed nonempty string`);
  assertCondition(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assertCondition(IDENTIFIER.test(value), `${label} is not a safe identifier`);
  return value;
}

function requireSha(value, label) {
  assertCondition(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

function requireUtc(value, label) {
  requireString(value, label);
  assertCondition(UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
  return value;
}

function requireProbability(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1, `${label} must be in [0, 1]`);
  return value;
}

function requireNonnegativeFinite(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value) && value >= 0, `${label} must be finite and nonnegative`);
  return value;
}

function requirePositiveFinite(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value) && value > 0, `${label} must be finite and positive`);
  return value;
}

function exactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const keys = [...expected].sort(compareUtf8);
  assertCondition(JSON.stringify(actual) === JSON.stringify(keys), `${label} fields mismatch`);
}

function digestWithout(record, field) {
  return canonicalDigest({...record, [field]: null});
}

function validatePrivacy(record, label) {
  try {
    assertPersistedRecordSafe(record);
  } catch (error) {
    throw new Error(`${label} failed persisted-record privacy check: ${error.message}`);
  }
  return record;
}

function validateEvaluationShape(record) {
  exactKeys(record, [
    "schema", "version", "status", "task_class", "task_profile_sha256", "route_sha256", "context_selection_sha256",
    "evaluator_ref_sha256", "observed_at_utc", "quality_score", "expected_cost", "observed_latency_seconds",
    "context_sufficiency", "policy_compliant", "accepted_result", "digest",
  ], "task routing evaluation");
  assertCondition(record.schema === TASK_ROUTING_EVALUATION_SCHEMA && record.version === 1 && record.status === "OBSERVED", "task routing evaluation identity is invalid");
  requireIdentifier(record.task_class, "task routing evaluation task_class");
  assertCondition(REPRESENTATIVE_TASK_CLASSES.includes(record.task_class), "task routing evaluation task_class is not representative");
  for (const field of ["task_profile_sha256", "route_sha256", "context_selection_sha256", "evaluator_ref_sha256"]) requireSha(record[field], `task routing evaluation ${field}`);
  requireUtc(record.observed_at_utc, "task routing evaluation observed_at_utc");
  requireProbability(record.quality_score, "task routing evaluation quality_score");
  requireNonnegativeFinite(record.expected_cost, "task routing evaluation expected_cost");
  requirePositiveFinite(record.observed_latency_seconds, "task routing evaluation observed_latency_seconds");
  requireProbability(record.context_sufficiency, "task routing evaluation context_sufficiency");
  assertCondition(typeof record.policy_compliant === "boolean" && typeof record.accepted_result === "boolean", "task routing evaluation booleans are invalid");
  assertCondition(record.digest === digestWithout(record, "digest"), "task routing evaluation digest does not match content");
  return validatePrivacy(record, "task routing evaluation");
}

export function compileTaskRoutingEvaluation({taskClass, taskProfileSha256, routeSha256, contextSelectionSha256, evaluatorRefSha256, observedAtUtc, qualityScore, expectedCost, observedLatencySeconds, contextSufficiency, policyCompliant, acceptedResult}) {
  const record = {
    schema: TASK_ROUTING_EVALUATION_SCHEMA,
    version: 1,
    status: "OBSERVED",
    task_class: requireIdentifier(taskClass, "taskClass"),
    task_profile_sha256: requireSha(taskProfileSha256, "taskProfileSha256"),
    route_sha256: requireSha(routeSha256, "routeSha256"),
    context_selection_sha256: requireSha(contextSelectionSha256, "contextSelectionSha256"),
    evaluator_ref_sha256: requireSha(evaluatorRefSha256, "evaluatorRefSha256"),
    observed_at_utc: requireUtc(observedAtUtc, "observedAtUtc"),
    quality_score: requireProbability(qualityScore, "qualityScore"),
    expected_cost: requireNonnegativeFinite(expectedCost, "expectedCost"),
    observed_latency_seconds: requirePositiveFinite(observedLatencySeconds, "observedLatencySeconds"),
    context_sufficiency: requireProbability(contextSufficiency, "contextSufficiency"),
    policy_compliant: Boolean(policyCompliant),
    accepted_result: Boolean(acceptedResult),
    digest: null,
  };
  record.digest = digestWithout(record, "digest");
  return validateEvaluationShape(record);
}

export function validateTaskRoutingEvaluation(record) {
  return validateEvaluationShape(record);
}

function validateReplayShape(record) {
  exactKeys(record, [
    "schema", "version", "status", "expected_route_sha256", "reproduced_route_sha256", "task_profile_sha256", "policy_sha256",
    "capability_catalog_sha256", "context_policy_sha256", "context_selection_sha256", "host_attestation_sha256", "builder_ref_sha256", "evaluator_ref_sha256",
    "observed_at_utc", "reason_code", "digest",
  ], "task routing replay");
  assertCondition(record.schema === TASK_ROUTING_REPLAY_SCHEMA && record.version === 1, "task routing replay identity is invalid");
  assertCondition(["MATCH", "MISMATCH", "UNAVAILABLE"].includes(record.status), "task routing replay status is invalid");
  for (const field of ["expected_route_sha256", "builder_ref_sha256", "evaluator_ref_sha256"]) requireSha(record[field], `task routing replay ${field}`);
  if (record.reproduced_route_sha256 !== null) requireSha(record.reproduced_route_sha256, "task routing replay reproduced_route_sha256");
  for (const field of ["task_profile_sha256", "policy_sha256", "capability_catalog_sha256", "context_policy_sha256", "context_selection_sha256", "host_attestation_sha256"]) requireSha(record[field], `task routing replay ${field}`);
  assertCondition(record.builder_ref_sha256 !== record.evaluator_ref_sha256, "task routing replay requires evaluator separation");
  requireUtc(record.observed_at_utc, "task routing replay observed_at_utc");
  requireIdentifier(record.reason_code, "task routing replay reason_code");
  assertCondition(record.digest === digestWithout(record, "digest"), "task routing replay digest does not match content");
  return validatePrivacy(record, "task routing replay");
}

export function replayTaskRouting({taskProfile, policy, contextPolicy, capabilityCatalog, contextSelection, hostAttestation, sourceBindingSha256, observedAtUtc, expectedRouteSha256, builderRefSha256, evaluatorRefSha256}) {
  requireSha(expectedRouteSha256, "expectedRouteSha256");
  requireSha(builderRefSha256, "builderRefSha256");
  requireSha(evaluatorRefSha256, "evaluatorRefSha256");
  assertCondition(builderRefSha256 !== evaluatorRefSha256, "evaluator must be independent of builder");
  let reproduced = null;
  let status = "UNAVAILABLE";
  let reasonCode = "ROUTING_UNAVAILABLE";
  try {
    const route = selectExecutionRoute({taskProfile, policy, contextPolicy, capabilityCatalog, contextSelection, hostAttestation, sourceBindingSha256, observedAtUtc});
    validateRoute(route);
    reproduced = route.digest;
    status = reproduced === expectedRouteSha256 ? "MATCH" : "MISMATCH";
    reasonCode = status === "MATCH" ? "ROUTE_REPLAY_MATCHED" : "ROUTE_REPLAY_MISMATCH";
  } catch (error) {
    if (error.code !== "ROUTING_UNAVAILABLE") throw error;
  }
  const record = {
    schema: TASK_ROUTING_REPLAY_SCHEMA,
    version: 1,
    status,
    expected_route_sha256: expectedRouteSha256,
    reproduced_route_sha256: reproduced,
    task_profile_sha256: taskProfile.digest,
    policy_sha256: policy.digest,
    context_policy_sha256: contextPolicy.digest,
    capability_catalog_sha256: capabilityCatalog.digest,
    context_selection_sha256: contextSelection.digest,
    host_attestation_sha256: hostAttestation.digest,
    builder_ref_sha256: builderRefSha256,
    evaluator_ref_sha256: evaluatorRefSha256,
    observed_at_utc: observedAtUtc,
    reason_code: reasonCode,
    digest: null,
  };
  record.digest = digestWithout(record, "digest");
  return validateReplayShape(record);
}

export function validateTaskRoutingReplay(record) {
  return validateReplayShape(record);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("task-routing-evaluation module loaded\n");

