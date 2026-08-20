#!/usr/bin/env node

/* Read-only Regulatory Applicability Router. It classifies version-bound
 * regulatory signals and routes context; it never gives legal advice,
 * certifies compliance, issues regulated instructions, or mutates state. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const REGULATORY_APPLICABILITY_ROUTER_INPUT_SCHEMA = "agentos.regulatory_applicability_router_boundary_input.v1";
export const REGULATORY_APPLICABILITY_ROUTER_RESULT_SCHEMA = "agentos.regulatory_applicability_router_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REQUESTS = new Set(["CLASSIFY_REGULATORY_APPLICABILITY", "ASSEMBLE_REGULATORY_CONTEXT", "ROUTE_REGULATORY_HANDOFF", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "ASSERT_LEGAL_APPLICABILITY", "ASSERT_COMPLIANCE", "GIVE_REGULATED_INSTRUCTION", "CERTIFY_SAFETY", "CERTIFY_FINANCIAL"]);
const FORBIDDEN = new Set(["REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "ASSERT_LEGAL_APPLICABILITY", "ASSERT_COMPLIANCE", "GIVE_REGULATED_INSTRUCTION", "CERTIFY_SAFETY", "CERTIFY_FINANCIAL"]);
const TOOLS = new Set(["READ_REGULATION_SIGNAL", "READ_SOURCE_LOCK", "READ_JURISDICTION_CATALOG", "READ_CONTEXT", "READ_EXCEPTION_CATALOG"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"];

function fail(message, code = "REGULATORY_APPLICABILITY_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "REGULATORY_APPLICABILITY_ROUTER_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "REGULATORY_APPLICABILITY_ROUTER_UNKNOWN_FIELD"); }
function str(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "REGULATORY_APPLICABILITY_ROUTER_FIELD_INVALID"); }
function id(value, name) { str(value, name); assert(ID.test(value), `${name} is not canonical`, "REGULATORY_APPLICABILITY_ROUTER_ID_INVALID"); }
function digest(value, name) { str(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "REGULATORY_APPLICABILITY_ROUTER_DIGEST_INVALID"); }
function result(disposition, route, code, input, extra = {}) { const base = {schema: REGULATORY_APPLICABILITY_ROUTER_RESULT_SCHEMA, version: 1, disposition, route, routing_allowed: false, acceptance_allowed: false, legal_assertion_allowed: false, compliance_certification_allowed: false, regulated_instruction_allowed: false, external_side_effects: {regulatory_reads: 0, protected_data_reads: 0, legal_conclusions: 0, compliance_certifications: 0, regulated_instructions: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, error_code: code, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Regulatory applicability router input");
  assert(input.schema === REGULATORY_APPLICABILITY_ROUTER_INPUT_SCHEMA && input.version === 1, "Regulatory applicability router schema mismatch", "REGULATORY_APPLICABILITY_ROUTER_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Regulatory applicability request is unknown", "REGULATORY_APPLICABILITY_ROUTER_REQUEST_INVALID");
  exact(input.evidence, new Set(["authority_status", "regulatory_domain", "regulation_identity", "regulation_activity", "regulation_entity", "regulation_jurisdiction", "regulation_version", "exception_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "regulatory_signal", "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "project_data_present", "secret_data_present", "legal_conclusion_requested", "regulated_instruction_requested", "certification_requested", "adversarial_flags"]), "Regulatory applicability router evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "regulatory_domain", "regulation_identity", "regulation_activity", "regulation_entity", "regulation_jurisdiction", "regulation_version", "exception_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "regulatory_signal", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope"]) str(e[key], `evidence.${key}`);
  digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.regulatory_domain === "REGULATORY_APPLICABILITY", "regulatory domain is not typed", "REGULATORY_APPLICABILITY_ROUTER_DOMAIN_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === 5 && new Set(e.required_block_identities).size === 5, "required block identities are incomplete", "REGULATORY_APPLICABILITY_ROUTER_BLOCK_BINDING_INVALID"); e.required_block_identities.forEach((value) => id(value, "required_block_identities[]"));
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "REGULATORY_APPLICABILITY_ROUTER_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "REGULATORY_APPLICABILITY_ROUTER_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "legal_conclusion_requested", "regulated_instruction_requested", "certification_requested"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "REGULATORY_APPLICABILITY_ROUTER_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Regulatory applicability adversarial flags"); Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "REGULATORY_APPLICABILITY_ROUTER_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Regulatory applicability input contains protected data", "REGULATORY_APPLICABILITY_ROUTER_PRIVACY_DENIED");
}

export function evaluateRegulatoryApplicabilityRouterBoundary(input) {
  validate(input); const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_REGULATORY_APPLICABILITY_SCOPE", "REGULATORY_APPLICABILITY_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_REGULATORY_APPLICABILITY_SIDE_EFFECT", "REGULATORY_APPLICABILITY_ROUTER_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.unrelated_scope) return result("DENY", "NO_REGULATORY_APPLICABILITY_SCOPE", "REGULATORY_APPLICABILITY_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (f.authority_conflict) return result("DENY", "CONTROL_PLANE_ESCALATION", "REGULATORY_APPLICABILITY_ROUTER_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_DUPLICATE_AUTHORITY", input);
  if (f.cross_provider || f.stale_source) return result("DENY", "SOURCE_REFRESH_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (e.legal_conclusion_requested || e.regulated_instruction_requested || e.certification_requested) return result("DENY", "PROFESSIONAL_AUTHORITY_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_PROFESSIONAL_APPLICABILITY_EXTERNAL", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_REGULATORY_APPLICABILITY_SIDE_EFFECT", "REGULATORY_APPLICABILITY_ROUTER_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "REGULATORY_APPLICABILITY_ROUTER_CONTEXT" || e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_CONTEXT_BINDING_INVALID", input);
  if (e.authority_scope !== "REGULATORY_APPLICABILITY") return result("DENY", "NARROW_SCOPE_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_SCOPE_INVALID", input);
  if (!["CLASSIFY", "ASSEMBLE", "ROUTE"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_ACTION_INVALID", input);
  if (e.regulatory_signal !== "REGULATORY.APPLICABILITY") return result("DENY", "TYPED_CONTEXT_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_SIGNAL_INVALID", input);
  if (e.signal_status !== "BOUND" || e.task_status !== "REGULATORY_APPLICABILITY_CLASSIFICATION") return result("DENY", "TYPED_CONTEXT_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_SIGNAL_INVALID", input);
  if (e.regulation_identity !== "REG.CFR_TITLE49_PART390" || e.regulation_version !== "2025-10-01" || e.source_identity !== "SOURCE.CFR_TITLE49_PART390_2025" || e.source_version !== "2025-10-01") return result("DENY", "SOURCE_REFRESH_REQUIRED", "REGULATORY_APPLICABILITY_ROUTER_SOURCE_BINDING_INVALID", input);
  return result("ROUTE", "REGULATORY_RULE_FAMILY_HANDOFF", "REGULATORY_APPLICABILITY_ROUTER_ROUTE_READY", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route the typed applicability concern to the smallest rule-family specialist; do not give legal advice, certify compliance, issue regulated instructions, or assert professional applicability.", execution_instruction: false}});
}

