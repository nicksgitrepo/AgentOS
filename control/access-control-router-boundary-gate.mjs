#!/usr/bin/env node

/* Read-only Access-Control Composition Router. It classifies typed access
 * control signals and assembles the smallest downstream specialist set. It
 * never makes an authorization decision or changes policy, credentials, or
 * project state. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const ACCESS_CONTROL_ROUTER_INPUT_SCHEMA = "agentos.access_control_router_boundary_input.v1";
export const ACCESS_CONTROL_ROUTER_RESULT_SCHEMA = "agentos.access_control_router_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REQUESTS = new Set([
  "CLASSIFY_ACCESS_CONTROL", "ASSEMBLE_ACCESS_CONTROL_CONTEXT", "ROUTE_ACCESS_CONTROL_HANDOFF",
  "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE",
  "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER",
  "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "ISSUE_CREDENTIAL", "CHANGE_ROLE", "CHANGE_TENANT",
  "CERTIFY_SECURITY", "OVERRIDE_SCOPE"
]);
const FORBIDDEN = new Set([
  "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "DECIDE_AUTHORIZATION", "MUTATE_POLICY",
  "ISSUE_CREDENTIAL", "CHANGE_ROLE", "CHANGE_TENANT", "CERTIFY_SECURITY", "OVERRIDE_SCOPE"
]);
const TOOLS = new Set(["READ_ACCESS_SIGNAL", "READ_SOURCE_LOCK", "READ_AUTHORITY_CATALOG", "READ_CONTEXT", "READ_TENANT_CATALOG"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"];
const REQUIRED_BLOCKS = [
  "BLOCK.ACCESS.AUTHORITY", "BLOCK.ACCESS.EVIDENCE", "BLOCK.ACCESS.SCOPE",
  "BLOCK.ACCESS.CUSTODY", "BLOCK.ACCESS.HANDOFF", "BLOCK.ACCESS.SECURITY_ROUTER"
];

function fail(message, code = "ACCESS_CONTROL_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "ACCESS_CONTROL_ROUTER_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "ACCESS_CONTROL_ROUTER_UNKNOWN_FIELD");
}
function str(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "ACCESS_CONTROL_ROUTER_FIELD_INVALID"); }
function id(value, name) { str(value, name); assert(ID.test(value), `${name} is not canonical`, "ACCESS_CONTROL_ROUTER_ID_INVALID"); }
function digest(value, name) { str(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "ACCESS_CONTROL_ROUTER_DIGEST_INVALID"); }
function result(disposition, route, code, input, extra = {}) {
  const base = {
    schema: ACCESS_CONTROL_ROUTER_RESULT_SCHEMA, version: 1, disposition, route,
    routing_allowed: false, acceptance_allowed: false, authorization_decision_allowed: false,
    policy_mutation_allowed: false, credential_issue_allowed: false,
    external_side_effects: {
      access_control_reads: 0, protected_data_reads: 0, authorization_decisions: 0,
      policy_mutations: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0
    }, error_code: code, input_sha256: canonicalDigest(input), ...extra
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Access-Control router input");
  assert(input.schema === ACCESS_CONTROL_ROUTER_INPUT_SCHEMA && input.version === 1, "Access-Control router schema mismatch", "ACCESS_CONTROL_ROUTER_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Access-Control request is unknown", "ACCESS_CONTROL_ROUTER_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "security_domain", "control_identity", "control_activity", "control_entity", "control_scope", "control_version",
    "policy_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date",
    "candidate_status", "candidate_digest", "security_signal", "signal_status", "task_status", "context_status", "context_complete",
    "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope",
    "project_data_present", "secret_data_present", "authorization_decision_requested", "policy_mutation_requested", "credential_issue_requested",
    "adversarial_flags"
  ]), "Access-Control router evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "security_domain", "control_identity", "control_activity", "control_entity", "control_scope", "control_version",
    "policy_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date",
    "candidate_status", "security_signal", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status",
    "model_route_status", "authority_scope"
  ]) str(e[key], `evidence.${key}`);
  digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.security_domain === "ACCESS_CONTROL_COMPOSITION", "security domain is not typed", "ACCESS_CONTROL_ROUTER_DOMAIN_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "ACCESS_CONTROL_ROUTER_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "ACCESS_CONTROL_ROUTER_BLOCK_BINDING_INVALID"); });
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "ACCESS_CONTROL_ROUTER_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "ACCESS_CONTROL_ROUTER_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "authorization_decision_requested", "policy_mutation_requested", "credential_issue_requested"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "ACCESS_CONTROL_ROUTER_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Access-Control adversarial flags");
  Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "ACCESS_CONTROL_ROUTER_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Access-Control input contains protected data", "ACCESS_CONTROL_ROUTER_PRIVACY_DENIED");
}

export function evaluateAccessControlRouterBoundary(input) {
  validate(input); const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_ACCESS_CONTROL_SCOPE", "ACCESS_CONTROL_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_ACCESS_CONTROL_SIDE_EFFECT", "ACCESS_CONTROL_ROUTER_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.unrelated_scope) return result("DENY", "NO_ACCESS_CONTROL_SCOPE", "ACCESS_CONTROL_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (f.authority_conflict) return result("DENY", "CONTROL_PLANE_ESCALATION", "ACCESS_CONTROL_ROUTER_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ACCESS_CONTROL_ROUTER_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "ACCESS_CONTROL_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "ACCESS_CONTROL_ROUTER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "ACCESS_CONTROL_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "ACCESS_CONTROL_ROUTER_DUPLICATE_AUTHORITY", input);
  if (f.unsupported_tool) return result("DENY", "TYPED_TOOL_SCOPE_REQUIRED", "ACCESS_CONTROL_ROUTER_TOOL_SCOPE_INVALID", input);
  if (f.cross_provider || f.stale_source) return result("DENY", "SOURCE_REFRESH_REQUIRED", "ACCESS_CONTROL_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (e.authorization_decision_requested || e.policy_mutation_requested || e.credential_issue_requested) return result("DENY", "ATOMIC_SPECIALIST_REQUIRED", "ACCESS_CONTROL_ROUTER_AUTHORIZATION_SIDE_EFFECT_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "ACCESS_CONTROL_ROUTER_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_ACCESS_CONTROL_SIDE_EFFECT", "ACCESS_CONTROL_ROUTER_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.policy_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "ACCESS_CONTROL_ROUTER_CONTEXT" || e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ACCESS_CONTROL_ROUTER_CONTEXT_BINDING_INVALID", input);
  if (e.authority_scope !== "ACCESS_CONTROL_COMPOSITION") return result("DENY", "NARROW_SCOPE_REQUIRED", "ACCESS_CONTROL_ROUTER_SCOPE_INVALID", input);
  if (!["CLASSIFY", "ASSEMBLE", "ROUTE"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ACCESS_CONTROL_ROUTER_ACTION_INVALID", input);
  if (e.security_signal !== "SECURITY.ACCESS_CONTROL" || e.signal_status !== "BOUND" || e.task_status !== "ACCESS_CONTROL_CLASSIFICATION") return result("DENY", "TYPED_CONTEXT_REQUIRED", "ACCESS_CONTROL_ROUTER_SIGNAL_INVALID", input);
  if (e.control_identity !== "CONTROL.ACCESS_CONTROL_ROUTER" || e.control_version !== "1" || e.source_identity !== "SOURCE.AGENTOS_ACCESS_CONTROL_ROUTER" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "ACCESS_CONTROL_ROUTER_SOURCE_BINDING_INVALID", input);
  return result("ROUTE", "ACCESS_CONTROL_ATOMIC_SPECIALIST_HANDOFF", "ACCESS_CONTROL_ROUTER_ROUTE_READY", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route the typed access-control concern to the smallest sufficient authorization specialist; do not decide authorization, mutate policy, issue credentials, or widen scope.", execution_instruction: false}});
}
