#!/usr/bin/env node

/* Read-only boundary for the OWASP Web A02:2025 atomic specialist. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const OWASP_WEB_A02_INPUT_SCHEMA = "agentos.owasp_web_2025_a02_broken_access_control_boundary_input.v1";
export const OWASP_WEB_A02_RESULT_SCHEMA = "agentos.owasp_web_2025_a02_broken_access_control_boundary_result.v1";
export const OWASP_WEB_A02_BLOCK_ID = "specialist.security.owasp-web-2025-a02-security-misconfiguration";

const SHA256 = /^[0-9a-f]{64}$/u;
const REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
export const OWASP_WEB_A02_FLAG_NAMES = Object.freeze([
  "authority_conflict", "scope_expanded", "data_limit", "protected_data", "stale_source",
  "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope",
  "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive",
  "handoff_incomplete", "lifecycle_invalid",
]);
export const OWASP_WEB_A02_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
]);
export const OWASP_WEB_A02_REQUIRED_BLOCKS = Object.freeze([
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
  "specialist.security.owasp-web-top10-router",
  "specialist.standard.owasp-asvs",
  "specialist.standard.owasp-top10-2025",
]);
export const OWASP_WEB_A02_TOOLS = Object.freeze([
  "READ_WEB_SIGNAL", "READ_SOURCE_LOCK", "READ_STANDARD_BLOCK", "READ_CONTEXT", "READ_ROUTER_RESULT",
]);

const REQUESTS = new Set([
  "ANALYZE_OWASP_WEB_A02", "ROUTE_OWASP_WEB_A02", "NOT_APPLICABLE", "UNRELATED_REQUEST", "ACCEPT",
  "ADMIT", "ACTIVATE", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW",
  "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "ISSUE_CREDENTIAL", "CHANGE_ROLE",
]);
const FORBIDDEN_REQUESTS = new Set([
  "ACCEPT", "ADMIT", "ACTIVATE", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY",
  "SELF_REVIEW", "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "ISSUE_CREDENTIAL", "CHANGE_ROLE",
]);
const ALLOWED_ACTIONS = new Set(["ANALYZE", "ROUTE"]);
const CANONICAL_EVIDENCE_FIELDS = Object.freeze([
  "authority_status", "custody_status", "custody_ref", "web_domain", "web_category", "web_scope",
  "source_status", "source_identity", "source_version", "source_manifest_sha256", "candidate_status",
  "candidate_digest", "signal_status", "task_status", "context_status", "context_complete",
  "context_receipt_sha256", "standard_edition", "requested_action", "requested_tools",
  "required_block_identities", "model_policy_status", "model_route_status", "model_task_class",
  "model_snapshot_sha256", "model_route_sha256", "model_capability_floor", "model_required_capabilities",
  "authority_scope", "upstream_router_result_sha256", "standard_web_block_sha256", "standard_asvs_block_sha256",
]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_ref", "web_domain", "web_category", "web_scope",
  "source_status", "source_identity", "source_version", "source_manifest_sha256", "candidate_status",
  "candidate_digest", "signal_status", "task_status", "context_status", "context_complete",
  "context_receipt_sha256", "standard_edition", "requested_action", "requested_tools",
  "required_block_identities", "model_policy_status", "model_route_status", "model_task_class",
  "model_snapshot_sha256", "model_route_sha256", "model_capability_floor", "model_required_capabilities",
  "authority_scope", "upstream_router_result_sha256", "standard_web_block_sha256", "standard_asvs_block_sha256",
  "project_data_present", "secret_data_present", "adversarial_flags",
]);

function fail(message, code = "OWASP_WEB_A02_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "OWASP_WEB_A02_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "OWASP_WEB_A02_UNKNOWN_FIELD");
}

function string(value, label, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} is invalid`, "OWASP_WEB_A02_FIELD_INVALID");
}

function digest(value, label) {
  string(value, label, 64);
  assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "OWASP_WEB_A02_DIGEST_INVALID");
}

function ref(value, label) {
  string(value, label, 180);
  assert(REF.test(value), `${label} is not opaque`, "OWASP_WEB_A02_REF_INVALID");
}

function validateInput(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "OWASP WEB_A02 input");
  assert(input.schema === OWASP_WEB_A02_INPUT_SCHEMA && input.version === 1, "OWASP WEB_A02 schema mismatch", "OWASP_WEB_A02_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "OWASP WEB_A02 request is unknown", "OWASP_WEB_A02_REQUEST_INVALID");
  exact(input.evidence, EVIDENCE_KEYS, "OWASP WEB_A02 evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "web_domain", "web_category", "web_scope", "source_status",
    "source_identity", "source_version", "candidate_status", "signal_status", "task_status", "context_status",
    "standard_edition", "requested_action", "model_policy_status", "model_route_status", "model_task_class",
    "authority_scope",
  ]) string(e[key], `evidence.${key}`);
  ref(e.custody_ref, "evidence.custody_ref");
  for (const key of [
    "source_manifest_sha256", "candidate_digest", "context_receipt_sha256", "model_snapshot_sha256",
    "model_route_sha256", "upstream_router_result_sha256", "standard_web_block_sha256", "standard_asvs_block_sha256",
  ]) digest(e[key], `evidence.${key}`);
  assert(Number.isInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "model capability floor is invalid", "OWASP_WEB_A02_MODEL_ROUTE_INVALID");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((item) => typeof item === "string"), "model capabilities are invalid", "OWASP_WEB_A02_MODEL_ROUTE_INVALID");
  assert(Array.isArray(e.required_block_identities) && JSON.stringify(e.required_block_identities) === JSON.stringify(OWASP_WEB_A02_REQUIRED_BLOCKS), "required block identities are not canonical", "OWASP_WEB_A02_BLOCK_BINDING_INVALID");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.every((tool) => OWASP_WEB_A02_TOOLS.includes(tool)), "requested tools are not read-only", "OWASP_WEB_A02_TOOL_SCOPE_INVALID");
  for (const key of ["context_complete", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `${key} must be boolean`, "OWASP_WEB_A02_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(OWASP_WEB_A02_FLAG_NAMES), "OWASP WEB_A02 adversarial flags");
  for (const key of OWASP_WEB_A02_FLAG_NAMES) assert(typeof e.adversarial_flags[key] === "boolean", `adversarial flag ${key} is not boolean`, "OWASP_WEB_A02_BOOLEAN_INVALID");
  assert(ALLOWED_ACTIONS.has(e.requested_action), "requested action is not allowed", "OWASP_WEB_A02_ACTION_INVALID");
  assert(scanPersistedRecord(input).safe, "OWASP WEB_A02 input contains protected or secret-like data", "OWASP_WEB_A02_PRIVACY_DENIED");
}

function sideEffects() {
  return {web_reads: 0, protected_data_reads: 0, authorization_decisions: 0, policy_mutations: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0};
}

function result(input, disposition, route, errorCode, extra = {}) {
  const base = {
    schema: OWASP_WEB_A02_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    routing_allowed: disposition === "ROUTE",
    acceptance_allowed: false,
    authorization_decision_allowed: false,
    policy_mutation_allowed: false,
    credential_issue_allowed: false,
    external_side_effects: sideEffects(),
    error_code: errorCode,
    input_sha256: canonicalDigest(input),
    lifecycle_status: disposition === "ROUTE" ? "CANDIDATE_WAITING_INDEPENDENT_REVIEW" : "CANDIDATE_ACTION_CLOSED",
    handoff: null,
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function handoff(input, route, errorCode) {
  return result(input, "ROUTE", route, errorCode, {
    selected_owner: "AGENTOS.ORCHESTRATOR",
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      block_id: OWASP_WEB_A02_BLOCK_ID,
      next_action: "Return evidence-bounded Web A02 analysis to the named owner; do not decide authorization, mutate policy, issue credentials, or widen the atomic scope.",
      execution_instruction: false,
      independent_review_required: true,
    },
  });
}

function canonicalEvidenceMismatch(input, canonicalEvidence) {
  return CANONICAL_EVIDENCE_FIELDS.some((field) => JSON.stringify(input.evidence[field]) !== JSON.stringify(canonicalEvidence[field]));
}

export function evaluateOwaspWebA02Boundary(input, canonicalEvidence = null) {
  validateInput(input);
  if (canonicalEvidence && canonicalEvidenceMismatch(input, canonicalEvidence)) return result(input, "DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_WEB_A02_CANONICAL_BINDING_MISMATCH");
  const e = input.evidence;
  const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result(input, "DENY", "NO_OWASP_WEB_A02_SCOPE", "OWASP_WEB_A02_SCOPE_NOT_APPLICABLE");
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result(input, "DENY", "NO_OWASP_WEB_A02_SIDE_EFFECT", "OWASP_WEB_A02_OPERATION_FORBIDDEN");
  if (f.authority_conflict) return result(input, "DENY", "CONTROL_PLANE_ESCALATION", "OWASP_WEB_A02_AUTHORITY_CONFLICT");
  if (f.missing_context || e.context_complete !== true) return result(input, "DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_WEB_A02_CONTEXT_INCOMPLETE");
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result(input, "DENY", "PRIVACY_BOUNDARY_REQUIRED", "OWASP_WEB_A02_PROTECTED_DATA_FORBIDDEN");
  if (f.self_acceptance) return result(input, "DENY", "INDEPENDENT_REVIEW_REQUIRED", "OWASP_WEB_A02_SELF_ACCEPTANCE_FORBIDDEN");
  if (f.scope_expanded || f.broad_claim) return result(input, "DENY", "NARROW_SCOPE_REQUIRED", "OWASP_WEB_A02_SCOPE_EXPANSION_FORBIDDEN");
  if (f.duplicate_authority) return result(input, "DENY", "SINGLE_AUTHORITY_REQUIRED", "OWASP_WEB_A02_DUPLICATE_AUTHORITY");
  if (f.cross_provider || f.stale_source) return result(input, "DENY", "SOURCE_REFRESH_REQUIRED", "OWASP_WEB_A02_SOURCE_STALE_OR_UNVERIFIED");
  if (f.handoff_incomplete) return result(input, "DENY", "TYPED_HANDOFF_REQUIRED", "OWASP_WEB_A02_HANDOFF_INCOMPLETE");
  if (f.lifecycle_invalid) return result(input, "DENY", "LIFECYCLE_REVIEW_REQUIRED", "OWASP_WEB_A02_LIFECYCLE_INVALID");
  if (f.unsupported_tool) return handoff(input, "OWASP_WEB_A02_TOOL_CUSTODY_REVIEW", "OWASP_WEB_A02_TOOL_REVIEW_REQUIRED");
  if (f.data_limit) return handoff(input, "OWASP_WEB_A02_DATA_CUSTODY_REVIEW", "OWASP_WEB_A02_DATA_LIMIT_REVIEW_REQUIRED");
  if (f.false_positive) return result(input, "DENY", "TYPED_EVIDENCE_REQUIRED", "OWASP_WEB_A02_FINDING_UNSUPPORTED");
  if (f.unsafe_action) return result(input, "DENY", "NO_OWASP_WEB_A02_SIDE_EFFECT", "OWASP_WEB_A02_OPERATION_FORBIDDEN");
  if (e.authority_status !== "CURRENT_CANDIDATE" || e.custody_status !== "ISOLATED_BUILDER" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "OWASP_WEB_A02_CONTEXT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result(input, "DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_WEB_A02_CONTEXT_BINDING_INVALID");
  if (e.web_domain !== "OWASP_WEB_SECURITY_TOP10" || e.web_category !== "A02:2025" || e.web_scope !== "SECURITY_MISCONFIGURATION" || e.signal_status !== "BOUND" || e.task_status !== "OWASP_WEB_A02_ANALYSIS" || e.authority_scope !== "OWASP_WEB_A02_SECURITY_MISCONFIGURATION") return result(input, "DENY", "NARROW_SCOPE_REQUIRED", "OWASP_WEB_A02_SCOPE_INVALID");
  if (e.model_policy_status !== "PREPARED_INACTIVE" || e.model_task_class !== "SECURITY_REVIEW" || e.model_capability_floor !== 59 || JSON.stringify(e.model_required_capabilities) !== JSON.stringify(["CODE", "SECURITY", "TOOLS"])) return result(input, "DENY", "MODEL_POLICY_REVIEW_REQUIRED", "OWASP_WEB_A02_MODEL_ROUTE_INVALID");
  return handoff(input, "OWASP_WEB_A02_ANALYSIS_HANDOFF", "OWASP_WEB_A02_ROUTE_READY");
}
