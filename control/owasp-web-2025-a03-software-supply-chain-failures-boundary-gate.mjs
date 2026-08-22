#!/usr/bin/env node

/* Read-only OWASP Web A03 boundary with exact category identity. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const OWASP_WEB_A03_INPUT_SCHEMA = "agentos.owasp_web_2025_a03_security_misconfiguration_boundary_input.v1";
export const OWASP_WEB_A03_RESULT_SCHEMA = "agentos.owasp_web_2025_a03_security_misconfiguration_boundary_result.v1";
export const OWASP_WEB_A03_BLOCK_ID = "specialist.security.owasp-web-2025-a03-software-supply-chain-failures";
export const OWASP_WEB_A03_FLAG_NAMES = Object.freeze(["authority_conflict", "scope_expanded", "data_limit", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive", "handoff_incomplete", "lifecycle_invalid"]);
export const OWASP_WEB_A03_FIXTURE_CLASSES = Object.freeze(["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"]);
export const OWASP_WEB_A03_REQUIRED_BLOCKS = Object.freeze(["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "BLOCK.SECURITY.ROUTER"]);
export const OWASP_WEB_A03_TOOLS = Object.freeze(["READ_OWASP_WEB_TOP10_SIGNAL", "READ_SOURCE_LOCK", "READ_OWASP_WEB_TOP10_CATALOG", "READ_CONTEXT", "READ_APPLICABILITY_RULES"]);
const REQUESTS = new Set(["ANALYZE_OWASP_WEB_A03", "ROUTE_OWASP_WEB_A03", "NOT_APPLICABLE", "UNRELATED_REQUEST", "ACCEPT", "ADMIT", "ACTIVATE", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "ISSUE_CREDENTIAL", "CHANGE_ROLE"]);
const CANONICAL_FIELDS = Object.freeze(["authority_status", "custody_status", "custody_ref", "web_domain", "web_category", "web_scope", "source_status", "source_identity", "source_version", "source_manifest_sha256", "candidate_status", "candidate_digest", "signal_status", "task_status", "context_status", "context_complete", "context_receipt_sha256", "standard_edition", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "model_task_class", "model_snapshot_sha256", "model_route_sha256", "model_capability_floor", "model_required_capabilities", "authority_scope", "upstream_router_result_sha256", "standard_web_block_sha256", "standard_asvs_block_sha256"]);
function fail(message, code = "OWASP_WEB_A03_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function sideEffects() { return {web_reads: 0, protected_data_reads: 0, authorization_decisions: 0, policy_mutations: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}; }
function output(input, disposition, route, errorCode, extra = {}) { const base = {schema: OWASP_WEB_A03_RESULT_SCHEMA, version: 1, disposition, route, routing_allowed: disposition === "ROUTE", acceptance_allowed: false, authorization_decision_allowed: false, policy_mutation_allowed: false, credential_issue_allowed: false, external_side_effects: sideEffects(), error_code: errorCode, input_sha256: canonicalDigest(input), lifecycle_status: disposition === "ROUTE" ? "CANDIDATE_WAITING_INDEPENDENT_REVIEW" : "CANDIDATE_ACTION_CLOSED", handoff: null, ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function handoff(input, route, errorCode) { return output(input, "ROUTE", route, errorCode, {selected_owner: "AGENTOS.ORCHESTRATOR", handoff: {status: "WAITING_WITH_RECEIPT", block_id: OWASP_WEB_A03_BLOCK_ID, next_action: "Return evidence-bounded OWASP Web A03 analysis to the named owner; do not decide authorization, mutate policy, issue credentials, or widen the atomic scope.", execution_instruction: false, independent_review_required: true}}); }
function assertShape(input) {
  assert(input && typeof input === "object" && !Array.isArray(input), "Web A03 input must be an object", "OWASP_WEB_A03_SHAPE_INVALID");
  assert(input.schema === OWASP_WEB_A03_INPUT_SCHEMA && input.version === 1, "Web A03 schema mismatch", "OWASP_WEB_A03_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Web A03 request is unknown", "OWASP_WEB_A03_REQUEST_INVALID");
  const e = input.evidence;
  assert(e && typeof e === "object" && !Array.isArray(e), "Web A03 evidence is invalid", "OWASP_WEB_A03_SHAPE_INVALID");
  for (const field of ["web_domain", "web_category", "web_scope", "context_status", "task_status", "authority_scope"]) assert(typeof e[field] === "string" && e[field].length > 0, `evidence.${field} is invalid`, "OWASP_WEB_A03_FIELD_INVALID");
  assert(e.web_domain === "OWASP_WEB_SECURITY" && e.web_category === "A03:2025" && e.web_scope === "SOFTWARE_SUPPLY_CHAIN_FAILURES", "Web A03 scope identity differs", "OWASP_WEB_A03_SCOPE_INVALID");
  assert(e.context_status === "OWASP_WEB_A03_CONTEXT" && e.task_status === "OWASP_WEB_A03_ANALYSIS" && e.authority_scope === "OWASP_WEB_A03_SOFTWARE_SUPPLY_CHAIN_FAILURES", "Web A03 context identity differs", "OWASP_WEB_A03_CONTEXT_INVALID");
  assert(Array.isArray(e.required_block_identities) && JSON.stringify(e.required_block_identities) === JSON.stringify(OWASP_WEB_A03_REQUIRED_BLOCKS), "Web A03 required blocks differ", "OWASP_WEB_A03_BLOCK_BINDING_INVALID");
  assert(Array.isArray(e.requested_tools) && JSON.stringify(e.requested_tools) === JSON.stringify(OWASP_WEB_A03_TOOLS), "Web A03 requested tools differ", "OWASP_WEB_A03_TOOL_SCOPE_INVALID");
  assert(e.adversarial_flags && typeof e.adversarial_flags === "object" && !Array.isArray(e.adversarial_flags), "Web A03 adversarial flags are missing", "OWASP_WEB_A03_BOOLEAN_INVALID");
  for (const flag of OWASP_WEB_A03_FLAG_NAMES) assert(typeof e.adversarial_flags[flag] === "boolean", `Web A03 flag ${flag} is invalid`, "OWASP_WEB_A03_BOOLEAN_INVALID");
  for (const field of ["context_complete", "project_data_present", "secret_data_present"]) assert(typeof e[field] === "boolean", `evidence.${field} must be boolean`, "OWASP_WEB_A03_BOOLEAN_INVALID");
  assert(typeof e.candidate_digest === "string" && /^[0-9a-f]{64}$/u.test(e.candidate_digest), "Web A03 candidate digest is invalid", "OWASP_WEB_A03_DIGEST_INVALID");
  assert(scanPersistedRecord(input).safe, "Web A03 input contains protected or secret-like data", "OWASP_WEB_A03_PRIVACY_DENIED");
}
function canonicalMismatch(input, canonicalEvidence) { return CANONICAL_FIELDS.some((field) => JSON.stringify(input.evidence[field]) !== JSON.stringify(canonicalEvidence[field])); }
export function evaluateOwaspWebA03Boundary(input, canonicalEvidence = null) {
  assertShape(input);
  if (canonicalEvidence && canonicalMismatch(input, canonicalEvidence)) return output(input, "DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_WEB_A03_CANONICAL_BINDING_MISMATCH");
  const flags = input.evidence.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || flags.unrelated_scope) return output(input, "DENY", "NO_OWASP_WEB_A03_SCOPE", "OWASP_WEB_A03_SCOPE_NOT_APPLICABLE");
  if (flags.unsafe_action) return output(input, "DENY", "NO_OWASP_WEB_A03_SIDE_EFFECT", "OWASP_WEB_A03_OPERATION_FORBIDDEN");
  if (flags.authority_conflict) return output(input, "DENY", "CONTROL_PLANE_ESCALATION", "OWASP_WEB_A03_AUTHORITY_CONFLICT");
  if (flags.scope_expanded || flags.broad_claim) return output(input, "DENY", "NARROW_SCOPE_REQUIRED", "OWASP_WEB_A03_SCOPE_EXPANSION_FORBIDDEN");
  if (flags.stale_source || flags.cross_provider) return output(input, "DENY", "SOURCE_REFRESH_REQUIRED", "OWASP_WEB_A03_SOURCE_STALE_OR_UNVERIFIED");
  if (flags.missing_context) return output(input, "DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_WEB_A03_CONTEXT_INCOMPLETE");
  if (flags.protected_data || input.evidence.project_data_present || input.evidence.secret_data_present) return output(input, "DENY", "PRIVACY_BOUNDARY_REQUIRED", "OWASP_WEB_A03_PROTECTED_DATA_FORBIDDEN");
  if (flags.duplicate_authority) return output(input, "DENY", "SINGLE_AUTHORITY_REQUIRED", "OWASP_WEB_A03_DUPLICATE_AUTHORITY");
  if (flags.false_positive) return output(input, "DENY", "TYPED_EVIDENCE_REQUIRED", "OWASP_WEB_A03_FINDING_UNSUPPORTED");
  if (flags.self_acceptance) return output(input, "DENY", "INDEPENDENT_REVIEW_REQUIRED", "OWASP_WEB_A03_SELF_ACCEPTANCE_FORBIDDEN");
  if (flags.handoff_incomplete || flags.lifecycle_invalid) return output(input, "DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_WEB_A03_HANDOFF_INCOMPLETE");
  if (flags.data_limit) return handoff(input, "OWASP_WEB_A03_DATA_CUSTODY_REVIEW", "OWASP_WEB_A03_DATA_LIMIT_REVIEW_REQUIRED");
  if (flags.unsupported_tool) return handoff(input, "OWASP_WEB_A03_TOOL_CUSTODY_REVIEW", "OWASP_WEB_A03_TOOL_REVIEW_REQUIRED");
  return handoff(input, "OWASP_WEB_A03_ANALYSIS_HANDOFF", "OWASP_WEB_A03_ROUTE_READY");
}
