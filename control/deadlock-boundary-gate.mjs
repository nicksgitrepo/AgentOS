#!/usr/bin/env node

/* Read-only, project-agnostic deadlock evidence boundary. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const DEADLOCK_INPUT_SCHEMA = "agentos.deadlock_boundary_input.v1";
export const DEADLOCK_RESULT_SCHEMA = "agentos.deadlock_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REQUESTS = new Set(["ANALYZE_DEADLOCK", "REVIEW_DEADLOCK", "HANDOFF_DEADLOCK", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "CERTIFY_SECURITY", "CHANGE_LOCK_ORDER", "ISSUE_CREDENTIAL", "OVERRIDE_SCOPE"]);
const REQUEST_ACTIONS = Object.freeze({ANALYZE_DEADLOCK: new Set(["ANALYZE"]), REVIEW_DEADLOCK: new Set(["REVIEW"]), HANDOFF_DEADLOCK: new Set(["HANDOFF"])});
const FORBIDDEN = new Set(["REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "CERTIFY_SECURITY", "CHANGE_LOCK_ORDER", "ISSUE_CREDENTIAL", "OVERRIDE_SCOPE"]);
const TOOLS = new Set(["READ_TRACE_EVIDENCE", "READ_LOCK_GRAPH", "READ_SOURCE_LOCK", "READ_CONTEXT"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive", "deadlock_missing", "lock_order_ambiguous", "duplicate_lock", "unverified_order"];
const REQUIRED_BLOCKS = ["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "BLOCK.SECURITY.ACCESS_CONTROL_ROUTER"];
function fail(message, code = "DEADLOCK_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), name + " must be an object", "DEADLOCK_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), name + " has unknown field " + key, "DEADLOCK_UNKNOWN_FIELD"); }
function str(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, name + " is invalid", "DEADLOCK_FIELD_INVALID"); }
function id(value, name) { str(value, name); assert(ID.test(value), name + " is not canonical", "DEADLOCK_ID_INVALID"); }
function digest(value, name) { str(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), name + " is not a real digest", "DEADLOCK_DIGEST_INVALID"); }
function result(disposition, route, code, input, extra = {}) {
  const base = {schema: DEADLOCK_RESULT_SCHEMA, version: 1, disposition, route, routing_allowed: false, acceptance_allowed: false, certification_allowed: false, lock_mutation_allowed: false, dependency_mutation_allowed: false, credential_issue_allowed: false, external_side_effects: {trace_reads: 0, lock_graph_reads: 0, source_reads: 0, deadlock_decisions: 0, lock_writes: 0, dependency_mutations: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, error_code: code, input_sha256: canonicalDigest(input), ...extra};
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Deadlock input");
  assert(input.schema === DEADLOCK_INPUT_SCHEMA && input.version === 1, "Deadlock schema mismatch", "DEADLOCK_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Deadlock request is unknown", "DEADLOCK_REQUEST_INVALID");
  exact(input.evidence, new Set(["authority_status", "deadlock_domain", "candidate_identity", "candidate_version", "deadlock_status", "lock_scope", "lock_ordering", "lock_graph_identity", "control_identity", "control_activity", "control_entity", "control_version", "policy_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "project_data_present", "secret_data_present", "lock_mutation_requested", "dependency_mutation_requested", "credential_issue_requested", "adversarial_flags"]), "Deadlock evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "deadlock_domain", "candidate_identity", "candidate_version", "deadlock_status", "lock_scope", "lock_ordering", "lock_graph_identity", "control_identity", "control_activity", "control_entity", "control_version", "policy_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope"]) str(e[key], "evidence." + key);
  digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.deadlock_domain === "DEADLOCK", "security domain is not typed", "DEADLOCK_DOMAIN_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "DEADLOCK_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "DEADLOCK_BLOCK_BINDING_INVALID"); });
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "DEADLOCK_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "DEADLOCK_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "lock_mutation_requested", "dependency_mutation_requested", "credential_issue_requested"]) assert(typeof e[key] === "boolean", "evidence." + key + " must be boolean", "DEADLOCK_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Deadlock adversarial flags"); assert(Object.keys(e.adversarial_flags).length === FLAGS.length && FLAGS.every((flag) => Object.hasOwn(e.adversarial_flags, flag)), "adversarial flags are incomplete", "DEADLOCK_FLAGS_INVALID"); Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "DEADLOCK_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Deadlock input contains protected data", "DEADLOCK_PRIVACY_DENIED");
}
export function evaluateDeadlockBoundary(input) {
  validate(input); const e = input.evidence; const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_DEADLOCK_SCOPE", "DEADLOCK_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_DEADLOCK_SIDE_EFFECT", "DEADLOCK_OPERATION_FORBIDDEN", input);
  if (f.unrelated_scope) return result("DENY", "NO_DEADLOCK_SCOPE", "DEADLOCK_SCOPE_NOT_APPLICABLE", input);
  if (f.authority_conflict) return result("DENY", "CONTROL_PLANE_ESCALATION", "DEADLOCK_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DEADLOCK_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "DEADLOCK_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "DEADLOCK_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "DEADLOCK_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority || f.duplicate_lock) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "DEADLOCK_DUPLICATE_LOCK_AUTHORITY", input);
  if (f.unsupported_tool) return result("DENY", "TYPED_TOOL_SCOPE_REQUIRED", "DEADLOCK_TOOL_SCOPE_INVALID", input);
  if (f.cross_provider || f.stale_source || f.unverified_order) return result("DENY", "SOURCE_REFRESH_REQUIRED", "DEADLOCK_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.deadlock_missing || f.lock_order_ambiguous) return result("DENY", "TYPED_LOCK_GRAPH_REQUIRED", "DEADLOCK_ORDERING_UNPROVEN", input);
  if (e.lock_mutation_requested || e.dependency_mutation_requested || e.credential_issue_requested) return result("DENY", "ATOMIC_SPECIALIST_REQUIRED", "DEADLOCK_SIDE_EFFECT_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "DEADLOCK_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_DEADLOCK_SIDE_EFFECT", "DEADLOCK_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.policy_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "DEADLOCK_CONTEXT" || e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DEADLOCK_CONTEXT_BINDING_INVALID", input);
  if (e.authority_scope !== "DEADLOCK") return result("DENY", "NARROW_SCOPE_REQUIRED", "DEADLOCK_SCOPE_INVALID", input);
  if (!["ANALYZE", "REVIEW", "HANDOFF"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DEADLOCK_ACTION_INVALID", input);
  if (!REQUEST_ACTIONS[input.request_kind]?.has(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DEADLOCK_ACTION_INVALID", input);
  if (e.signal_status !== "BOUND" || e.task_status !== "DEADLOCK_ANALYSIS") return result("DENY", "TYPED_CONTEXT_REQUIRED", "DEADLOCK_SIGNAL_INVALID", input);
  if (e.control_identity !== "CONTROL.DEADLOCK" || e.control_version !== "1" || e.source_identity !== "SOURCE.AGENTOS_DEADLOCK" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "DEADLOCK_SOURCE_BINDING_INVALID", input);
  if (e.deadlock_status !== "EVIDENCE_COMPLETE" || e.lock_ordering !== "TOTAL_ORDER") return result("DENY", "TYPED_LOCK_GRAPH_REQUIRED", "DEADLOCK_STATUS_UNPROVEN", input);
  return result("ROUTE", "DEADLOCK_REMEDIATION_HANDOFF", "DEADLOCK_ANALYSIS_READY", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Hand the exact lock-order evidence to the project owner; do not mutate locks, dependencies, or project state.", execution_instruction: false}});
}
