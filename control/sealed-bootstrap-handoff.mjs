#!/usr/bin/env node

/* Validate the sealed Bootstrap handoff before any roster or campaign admission. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const SEALED_BOOTSTRAP_HANDOFF_SCHEMA = "agentos.sealed_bootstrap_handoff.v1";
export const SEALED_BOOTSTRAP_HANDOFF_VERSION = 1;
export const SEALED_BOOTSTRAP_HANDOFF_NEXT_ACTION = "ADMIT_TYPED_AGENT_SPAWNER";

const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const EXCLUSION_ID = /^[A-Z][A-Z0-9._:-]*$/u;
const HANDOFF_KEYS = Object.freeze([
  "schema", "version", "handoff_id", "bootstrap_session_id", "controller_task_id", "host_id",
  "project_binding_sha256", "control_plane_binding_sha256", "plan_sha256", "execution_state_sha256",
  "setup_audit_sha256", "runtime_readback_sha256", "controller_runtime_readback_sha256",
  "capability_set_sha256", "source_mapping_sha256", "memory_plan_sha256", "quarantine_gate_state_sha256",
  "product_zero_trace_receipt_sha256", "setup_audit_status", "memory_status", "memory_sync",
  "product_mutated", "deployment_attempted", "permanent_roster_admitted", "model_policy",
  "source_boundaries", "next_action", "handoff_sha256",
]);
const MODEL_POLICY_KEYS = Object.freeze(["model", "reasoning_effort", "continuity"]);
const BOUNDARY_KEYS = Object.freeze([
  "agentos_core_project_agnostic", "control_plane_scope", "original_source_roots_untouched",
  "product_zero_trace", "quarantine_access", "credential_access", "external_sync", "opaque_exclusions",
]);
const EXCLUSION_KEYS = Object.freeze(["exclusion_id", "classification", "content_access", "evidence_ceiling"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireToken(value, label) {
  assert(typeof value === "string" && TOKEN.test(value), `${label} must be a stable token`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function digestWithout(value, field) {
  return canonicalDigest({...structuredClone(value), [field]: null});
}

function sortedUnique(values, label, pattern = null) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && (pattern === null || pattern.test(value))), `${label} contains an invalid value`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return values;
}

export const SEALED_BOOTSTRAP_SOURCE_BOUNDARIES = Object.freeze({
  agentos_core_project_agnostic: true,
  control_plane_scope: "PRIVATE_EXTERNAL_CONTROL_PLANE",
  original_source_roots_untouched: true,
  product_zero_trace: true,
  quarantine_access: "FORBIDDEN",
  credential_access: "FORBIDDEN",
  external_sync: "FORBIDDEN",
  opaque_exclusions: Object.freeze([
    Object.freeze({exclusion_id: "EXTERNAL_DEPENDENCY", classification: "QUARANTINED_EXTERNAL_DEPENDENCY", content_access: "FORBIDDEN", evidence_ceiling: "No content or execution evidence is available; preserve the opaque exclusion."}),
    Object.freeze({exclusion_id: "SECRET_MATERIAL", classification: "PERMANENT_SECRET_EXCLUSION", content_access: "FORBIDDEN", evidence_ceiling: "No content, copy, hash, or exposure is permitted; preserve the secret exclusion."}),
  ]),
});

function validateSourceBoundaries(boundaries) {
  exactKeys(boundaries, BOUNDARY_KEYS, "sealed Bootstrap source boundaries");
  assert(boundaries.agentos_core_project_agnostic === true, "AgentOS core must remain project-agnostic");
  assert(boundaries.control_plane_scope === "PRIVATE_EXTERNAL_CONTROL_PLANE", "control-plane scope is invalid");
  assert(boundaries.original_source_roots_untouched === true, "original source roots must remain untouched");
  assert(boundaries.product_zero_trace === true, "Product zero-trace boundary is missing");
  assert(boundaries.quarantine_access === "FORBIDDEN", "quarantine access boundary is weakened");
  assert(boundaries.credential_access === "FORBIDDEN", "credential access boundary is weakened");
  assert(boundaries.external_sync === "FORBIDDEN", "external sync boundary is weakened");
  assert(Array.isArray(boundaries.opaque_exclusions) && boundaries.opaque_exclusions.length === 2, "opaque source exclusions are incomplete");
  const ids = [];
  for (const exclusion of boundaries.opaque_exclusions) {
    exactKeys(exclusion, EXCLUSION_KEYS, "sealed Bootstrap opaque exclusion");
    assert(EXCLUSION_ID.test(exclusion.exclusion_id), "opaque exclusion id is invalid");
    ids.push(exclusion.exclusion_id);
    assert(["QUARANTINED_EXTERNAL_DEPENDENCY", "PERMANENT_SECRET_EXCLUSION"].includes(exclusion.classification), "opaque exclusion classification is invalid");
    assert(exclusion.content_access === "FORBIDDEN", "opaque exclusion content access is invalid");
    assert(typeof exclusion.evidence_ceiling === "string" && exclusion.evidence_ceiling.length >= 32, "opaque exclusion evidence ceiling is incomplete");
  }
  assert(JSON.stringify(ids) === JSON.stringify(["EXTERNAL_DEPENDENCY", "SECRET_MATERIAL"]), "opaque exclusions must be canonical and ordered");
  return boundaries;
}

function validateModelPolicy(policy) {
  exactKeys(policy, MODEL_POLICY_KEYS, "sealed Bootstrap model policy");
  assert(policy.model === "gpt-5.6-luna", "sealed Bootstrap model policy is invalid");
  assert(policy.reasoning_effort === "max", "sealed Bootstrap reasoning policy is invalid");
  assert(policy.continuity === "ECO_CONTINUOUS", "sealed Bootstrap continuity policy is invalid");
  return policy;
}

export function validateSealedBootstrapHandoff(handoff) {
  exactKeys(handoff, HANDOFF_KEYS, "sealed Bootstrap handoff");
  assert(handoff.schema === SEALED_BOOTSTRAP_HANDOFF_SCHEMA && handoff.version === SEALED_BOOTSTRAP_HANDOFF_VERSION, "sealed Bootstrap handoff identity is invalid");
  for (const [field, label] of [
    ["handoff_id", "sealed Bootstrap handoff id"], ["bootstrap_session_id", "Bootstrap session"],
    ["controller_task_id", "Controller task"], ["host_id", "Bootstrap host"],
  ]) requireToken(handoff[field], label);
  for (const field of [
    "project_binding_sha256", "control_plane_binding_sha256", "plan_sha256", "execution_state_sha256",
    "setup_audit_sha256", "runtime_readback_sha256", "controller_runtime_readback_sha256",
    "capability_set_sha256", "source_mapping_sha256", "memory_plan_sha256", "quarantine_gate_state_sha256",
    "product_zero_trace_receipt_sha256",
  ]) requireSha(handoff[field], `sealed Bootstrap ${field}`);
  assert(handoff.setup_audit_status === "PASS", "sealed Bootstrap setup audit is not passing");
  assert(handoff.memory_status === "PREPARED_NOT_ACTIVATED", "sealed Bootstrap Memory posture is not prepared-only");
  assert(handoff.memory_sync === "PROJECT_ONLY_NO_EXTERNAL_SYNC", "sealed Bootstrap Memory sync boundary is invalid");
  assert(handoff.product_mutated === false, "sealed Bootstrap claims Product mutation");
  assert(handoff.deployment_attempted === false, "sealed Bootstrap claims deployment");
  assert(handoff.permanent_roster_admitted === false, "sealed Bootstrap claims permanent roster admission too early");
  validateModelPolicy(handoff.model_policy);
  validateSourceBoundaries(handoff.source_boundaries);
  assert(handoff.next_action === SEALED_BOOTSTRAP_HANDOFF_NEXT_ACTION, "sealed Bootstrap next action is invalid");
  requireSha(handoff.handoff_sha256, "sealed Bootstrap handoff digest");
  assert(handoff.handoff_sha256 === digestWithout(handoff, "handoff_sha256"), "sealed Bootstrap handoff digest mismatch");
  return handoff;
}

export function validateSealedBootstrapHandoffForController(handoff, {controllerTaskId, hostId} = {}) {
  validateSealedBootstrapHandoff(handoff);
  requireToken(controllerTaskId, "expected Controller task");
  requireToken(hostId, "expected Bootstrap host");
  assert(handoff.controller_task_id === controllerTaskId, "sealed Bootstrap handoff Controller identity differs");
  assert(handoff.host_id === hostId, "sealed Bootstrap handoff host identity differs");
  return {status: "SEALED_BOOTSTRAP_HANDOFF_VALID", handoff_sha256: handoff.handoff_sha256, next_action: handoff.next_action};
}

export function compileSealedBootstrapHandoff({
  handoffId,
  bootstrapSessionId,
  controllerTaskId,
  hostId,
  projectBindingSha256,
  controlPlaneBindingSha256,
  planSha256,
  executionStateSha256,
  setupAuditSha256,
  runtimeReadbackSha256,
  controllerRuntimeReadbackSha256,
  capabilitySetSha256,
  sourceMappingSha256,
  memoryPlanSha256,
  quarantineGateStateSha256,
  productZeroTraceReceiptSha256,
  modelPolicy = {model: "gpt-5.6-luna", reasoning_effort: "max", continuity: "ECO_CONTINUOUS"},
  sourceBoundaries = SEALED_BOOTSTRAP_SOURCE_BOUNDARIES,
} = {}) {
  const handoff = {
    schema: SEALED_BOOTSTRAP_HANDOFF_SCHEMA,
    version: SEALED_BOOTSTRAP_HANDOFF_VERSION,
    handoff_id: handoffId,
    bootstrap_session_id: bootstrapSessionId,
    controller_task_id: controllerTaskId,
    host_id: hostId,
    project_binding_sha256: projectBindingSha256,
    control_plane_binding_sha256: controlPlaneBindingSha256,
    plan_sha256: planSha256,
    execution_state_sha256: executionStateSha256,
    setup_audit_sha256: setupAuditSha256,
    runtime_readback_sha256: runtimeReadbackSha256,
    controller_runtime_readback_sha256: controllerRuntimeReadbackSha256,
    capability_set_sha256: capabilitySetSha256,
    source_mapping_sha256: sourceMappingSha256,
    memory_plan_sha256: memoryPlanSha256,
    quarantine_gate_state_sha256: quarantineGateStateSha256,
    product_zero_trace_receipt_sha256: productZeroTraceReceiptSha256,
    setup_audit_status: "PASS",
    memory_status: "PREPARED_NOT_ACTIVATED",
    memory_sync: "PROJECT_ONLY_NO_EXTERNAL_SYNC",
    product_mutated: false,
    deployment_attempted: false,
    permanent_roster_admitted: false,
    model_policy: structuredClone(modelPolicy),
    source_boundaries: structuredClone(sourceBoundaries),
    next_action: SEALED_BOOTSTRAP_HANDOFF_NEXT_ACTION,
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = digestWithout(handoff, "handoff_sha256");
  return validateSealedBootstrapHandoff(handoff);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Sealed Bootstrap handoff contract loaded\n");
