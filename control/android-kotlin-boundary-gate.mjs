#!/usr/bin/env node

/* Project-agnostic Android/Kotlin applicability router.  This is a narrow,
 * read-only classifier: it assembles a typed handoff to the smallest
 * sufficient Android/Kotlin specialist and never verifies, accepts, or changes a
 * project. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const ANDROID_KOTLIN_BOUNDARY_INPUT_SCHEMA = "agentos.android_kotlin_boundary_input.v1";
export const ANDROID_KOTLIN_BOUNDARY_RESULT_SCHEMA = "agentos.android_kotlin_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REQUESTS = new Set([
  "CLASSIFY_ANDROID_KOTLIN", "ASSEMBLE_ANDROID_KOTLIN_CONTEXT", "ROUTE_ANDROID_KOTLIN_HANDOFF",
  "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE",
  "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER",
  "VERIFY", "CERTIFY_SECURITY", "OVERRIDE_SCOPE", "CHANGE_STANDARD", "ISSUE_CREDENTIAL"
]);
const FORBIDDEN = new Set([
  "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "VERIFY", "CERTIFY_SECURITY", "OVERRIDE_SCOPE",
  "CHANGE_STANDARD", "ISSUE_CREDENTIAL"
]);
const TOOLS = new Set(["READ_ANDROID_KOTLIN_SIGNAL", "READ_SOURCE_LOCK", "READ_ANDROID_KOTLIN_REQUIREMENTS", "READ_CONTEXT", "READ_APPLICABILITY_RULES"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"];
const REQUIRED_BLOCKS = [
  "BLOCK.CLIENT.AUTHORITY", "BLOCK.CLIENT.EVIDENCE", "BLOCK.CLIENT.SCOPE",
  "BLOCK.CLIENT.CUSTODY", "BLOCK.CLIENT.HANDOFF", "BLOCK.CLIENT.ROUTER"
];

function fail(message, code = "ANDROID_KOTLIN_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "ANDROID_KOTLIN_ROUTER_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "ANDROID_KOTLIN_ROUTER_UNKNOWN_FIELD");
}
function str(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "ANDROID_KOTLIN_ROUTER_FIELD_INVALID"); }
function id(value, name) { str(value, name); assert(ID.test(value), `${name} is not canonical`, "ANDROID_KOTLIN_ROUTER_ID_INVALID"); }
function digest(value, name) { str(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "ANDROID_KOTLIN_ROUTER_DIGEST_INVALID"); }
function result(disposition, route, code, input, extra = {}) {
  const base = {
    schema: ANDROID_KOTLIN_BOUNDARY_RESULT_SCHEMA, version: 1, disposition, route,
    routing_allowed: false, acceptance_allowed: false, verification_allowed: false,
    standard_mutation_allowed: false, external_side_effects: {
      source_reads: 0, protected_data_reads: 0, verification_runs: 0,
      standard_mutations: 0, memory_writes: 0, acceptance_calls: 0,
      credential_accesses: 0, state_changes: 0
    }, error_code: code, input_sha256: canonicalDigest(input), ...extra
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Android/Kotlin router input");
  assert(input.schema === ANDROID_KOTLIN_BOUNDARY_INPUT_SCHEMA && input.version === 1, "Android/Kotlin schema mismatch", "ANDROID_KOTLIN_ROUTER_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Android/Kotlin request is unknown", "ANDROID_KOTLIN_ROUTER_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "android_kotlin_domain", "control_identity", "control_activity", "control_entity", "control_scope", "control_version",
    "policy_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date",
    "candidate_status", "candidate_digest", "android_kotlin_signal", "signal_status", "task_status", "context_status", "context_complete",
    "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "standard_edition",
    "verification_level", "applicability_status", "authority_scope", "project_data_present", "secret_data_present", "verification_requested",
    "acceptance_requested", "adversarial_flags"
  ]), "Android/Kotlin router evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "android_kotlin_domain", "control_identity", "control_activity", "control_entity", "control_scope", "control_version",
    "policy_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date",
    "candidate_status", "android_kotlin_signal", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status",
    "model_route_status", "standard_edition", "verification_level", "applicability_status", "authority_scope"
  ]) str(e[key], `evidence.${key}`);
  digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.android_kotlin_domain === "ANDROID_KOTLIN", "data domain is not typed", "ANDROID_KOTLIN_ROUTER_DOMAIN_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "ANDROID_KOTLIN_ROUTER_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "ANDROID_KOTLIN_ROUTER_BLOCK_BINDING_INVALID"); });
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "ANDROID_KOTLIN_ROUTER_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "ANDROID_KOTLIN_ROUTER_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "verification_requested", "acceptance_requested"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "ANDROID_KOTLIN_ROUTER_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Android/Kotlin adversarial flags");
  Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "ANDROID_KOTLIN_ROUTER_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Android/Kotlin input contains protected data", "ANDROID_KOTLIN_ROUTER_PRIVACY_DENIED");
}

export function evaluateAndroidKotlinBoundary(input) {
  validate(input); const e = input.evidence; const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_ANDROID_KOTLIN_SCOPE", "ANDROID_KOTLIN_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_ANDROID_KOTLIN_SIDE_EFFECT", "ANDROID_KOTLIN_ROUTER_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict) return result("DENY", "CONTROL_PLANE_ESCALATION", "ANDROID_KOTLIN_ROUTER_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ANDROID_KOTLIN_ROUTER_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "ANDROID_KOTLIN_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance || f.unsafe_action || e.acceptance_requested || e.verification_requested) return result("DENY", "INDEPENDENT_SPECIALIST_REQUIRED", "ANDROID_KOTLIN_ROUTER_SIDE_EFFECT_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "ANDROID_KOTLIN_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "ANDROID_KOTLIN_ROUTER_DUPLICATE_AUTHORITY", input);
  if (f.unsupported_tool) return result("DENY", "TYPED_TOOL_SCOPE_REQUIRED", "ANDROID_KOTLIN_ROUTER_TOOL_SCOPE_INVALID", input);
  if (f.cross_provider || f.stale_source) return result("DENY", "SOURCE_REFRESH_REQUIRED", "ANDROID_KOTLIN_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "ANDROID_KOTLIN_ROUTER_FINDING_UNSUPPORTED", input);
  if (e.authority_status !== "CURRENT" || e.policy_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "ANDROID_KOTLIN_ROUTER_CONTEXT" || e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ANDROID_KOTLIN_ROUTER_CONTEXT_BINDING_INVALID", input);
  if (e.authority_scope !== "ANDROID_KOTLIN" || e.applicability_status !== "BOUND") return result("DENY", "APPLICABILITY_REQUIRED", "ANDROID_KOTLIN_ROUTER_APPLICABILITY_INVALID", input);
  if (!["CLASSIFY", "ASSEMBLE", "ROUTE"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ANDROID_KOTLIN_ROUTER_ACTION_INVALID", input);
  if (e.android_kotlin_signal !== "CLIENT.ANDROID_KOTLIN" || e.signal_status !== "BOUND" || e.task_status !== "ANDROID_KOTLIN_CLASSIFICATION") return result("DENY", "TYPED_CONTEXT_REQUIRED", "ANDROID_KOTLIN_ROUTER_SIGNAL_INVALID", input);
  if (e.control_identity !== "CONTROL.ANDROID_KOTLIN_ROUTER" || e.control_version !== "1" || e.source_identity !== "SOURCE.ANDROID_JETPACK_COMPOSE" || e.source_version !== "CURRENT" || e.standard_edition !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "ANDROID_KOTLIN_ROUTER_SOURCE_BINDING_INVALID", input);
  if (!["BASELINE", "ENHANCED"].includes(e.verification_level)) return result("DENY", "APPLICABILITY_REQUIRED", "ANDROID_KOTLIN_ROUTER_LEVEL_INVALID", input);
  return result("ROUTE", "ANDROID_KOTLIN_ATOMIC_SPECIALIST_HANDOFF", "ANDROID_KOTLIN_ROUTER_ROUTE_READY", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route the typed Android/Kotlin concern to the smallest sufficient versioned requirement specialist; do not verify, certify, accept, or widen scope.", execution_instruction: false}});
}
