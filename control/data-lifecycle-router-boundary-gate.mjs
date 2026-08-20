#!/usr/bin/env node

/* Read-only Privacy Data-Lifecycle Router. It classifies typed lifecycle
 * signals and routes a narrow handoff; it never decides legal applicability,
 * handles protected data, writes project state, or accepts its own work. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const DATA_LIFECYCLE_ROUTER_INPUT_SCHEMA = "agentos.privacy_data_lifecycle_router_boundary_input.v1";
export const DATA_LIFECYCLE_ROUTER_RESULT_SCHEMA = "agentos.privacy_data_lifecycle_router_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const REQUESTS = new Set(["CLASSIFY_DATA_LIFECYCLE", "ASSEMBLE_PRIVACY_CONTEXT", "ROUTE_PRIVACY_HANDOFF", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "ASSERT_LEGAL_APPLICABILITY", "HANDLE_PROTECTED_DATA"]);
const FORBIDDEN = new Set(["REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "ASSERT_LEGAL_APPLICABILITY", "HANDLE_PROTECTED_DATA"]);
const TOOLS = new Set(["READ_PRIVACY_SIGNAL", "READ_SOURCE_LOCK", "READ_JURISDICTION_CATALOG", "READ_CONTEXT", "READ_RETENTION_CATALOG"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"];

function fail(message, code = "DATA_LIFECYCLE_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "DATA_LIFECYCLE_ROUTER_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "DATA_LIFECYCLE_ROUTER_UNKNOWN_FIELD"); }
function str(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "DATA_LIFECYCLE_ROUTER_FIELD_INVALID"); }
function id(value, name) { str(value, name); assert(ID.test(value), `${name} is not canonical`, "DATA_LIFECYCLE_ROUTER_ID_INVALID"); }
function ref(value, name) { str(value, name, 180); assert(REF.test(value), `${name} is not opaque`, "DATA_LIFECYCLE_ROUTER_REF_INVALID"); }
function digest(value, name) { str(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "DATA_LIFECYCLE_ROUTER_DIGEST_INVALID"); }
function result(disposition, route, code, input, extra = {}) { const base = {schema: DATA_LIFECYCLE_ROUTER_RESULT_SCHEMA, version: 1, disposition, route, routing_allowed: false, acceptance_allowed: false, protected_data_allowed: false, legal_assertion_allowed: false, external_side_effects: {data_reads: 0, protected_data_reads: 0, policy_assertions: 0, legal_conclusions: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, error_code: code, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Privacy data-lifecycle router input");
  assert(input.schema === DATA_LIFECYCLE_ROUTER_INPUT_SCHEMA && input.version === 1, "Privacy data-lifecycle router schema mismatch", "DATA_LIFECYCLE_ROUTER_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Privacy data-lifecycle request is unknown", "DATA_LIFECYCLE_ROUTER_REQUEST_INVALID");
  exact(input.evidence, new Set(["authority_status", "privacy_domain", "data_category", "data_subject_class", "lifecycle_signal", "jurisdiction_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "privacy_signal", "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "project_data_present", "secret_data_present", "legal_conclusion_requested", "adversarial_flags"]), "Privacy data-lifecycle router evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "privacy_domain", "data_category", "data_subject_class", "lifecycle_signal", "jurisdiction_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "privacy_signal", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope"]) str(e[key], `evidence.${key}`);
  digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.privacy_domain === "PRIVACY_DATA_LIFECYCLE", "privacy domain is not typed", "DATA_LIFECYCLE_ROUTER_DOMAIN_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === 5 && new Set(e.required_block_identities).size === 5, "required block identities are incomplete", "DATA_LIFECYCLE_ROUTER_BLOCK_BINDING_INVALID"); e.required_block_identities.forEach((value) => id(value, "required_block_identities[]"));
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "DATA_LIFECYCLE_ROUTER_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "DATA_LIFECYCLE_ROUTER_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "legal_conclusion_requested"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "DATA_LIFECYCLE_ROUTER_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Privacy data-lifecycle adversarial flags"); Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "DATA_LIFECYCLE_ROUTER_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Privacy data-lifecycle input contains protected data", "DATA_LIFECYCLE_ROUTER_PRIVACY_DENIED");
}

export function evaluateDataLifecycleRouterBoundary(input) {
  validate(input); const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_PRIVACY_DATA_LIFECYCLE_SCOPE", "DATA_LIFECYCLE_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_PRIVACY_DATA_LIFECYCLE_SIDE_EFFECT", "DATA_LIFECYCLE_ROUTER_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.unrelated_scope) return result("DENY", "NO_PRIVACY_DATA_LIFECYCLE_SCOPE", "DATA_LIFECYCLE_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (f.authority_conflict) return result("DENY", "CONTROL_PLANE_ESCALATION", "DATA_LIFECYCLE_ROUTER_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_LIFECYCLE_ROUTER_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "DATA_LIFECYCLE_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "DATA_LIFECYCLE_ROUTER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "DATA_LIFECYCLE_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "DATA_LIFECYCLE_ROUTER_DUPLICATE_AUTHORITY", input);
  if (f.cross_provider || f.stale_source) return result("DENY", "SOURCE_REFRESH_REQUIRED", "DATA_LIFECYCLE_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (e.legal_conclusion_requested) return result("DENY", "JURISDICTION_BOUND_SPECIALIST_REQUIRED", "DATA_LIFECYCLE_ROUTER_LEGAL_APPLICABILITY_EXTERNAL", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "DATA_LIFECYCLE_ROUTER_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_PRIVACY_DATA_LIFECYCLE_SIDE_EFFECT", "DATA_LIFECYCLE_ROUTER_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "DATA_LIFECYCLE_ROUTER_CONTEXT" || e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_LIFECYCLE_ROUTER_CONTEXT_BINDING_INVALID", input);
  if (e.authority_scope !== "PRIVACY_DATA_LIFECYCLE") return result("DENY", "NARROW_SCOPE_REQUIRED", "DATA_LIFECYCLE_ROUTER_SCOPE_INVALID", input);
  if (!["CLASSIFY", "ASSEMBLE", "ROUTE"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_LIFECYCLE_ROUTER_ACTION_INVALID", input);
  if (e.privacy_signal !== "PRIVACY.DATA_LIFECYCLE") return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_LIFECYCLE_ROUTER_SIGNAL_INVALID", input);
  if (e.signal_status !== "BOUND" || e.task_status !== "PRIVACY_DATA_LIFECYCLE_CLASSIFICATION") return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_LIFECYCLE_ROUTER_SIGNAL_INVALID", input);
  if (e.source_identity !== "SOURCE.AGENTOS_ATOMIC_SPECIALIZATION_LAW" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "DATA_LIFECYCLE_ROUTER_SOURCE_BINDING_INVALID", input);
  return result("ROUTE", "PRIVACY_JURISDICTION_BOUND_HANDOFF", "DATA_LIFECYCLE_ROUTER_ROUTE_READY", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route the typed data-lifecycle concern to the smallest jurisdiction-bound privacy specialist; do not assert legal applicability, handle protected data, write project state, or accept results.", execution_instruction: false}});
}
