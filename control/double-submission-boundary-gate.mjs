#!/usr/bin/env node

/* Read-only, project-agnostic Double Submission evidence boundary. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const DOUBLE_SUBMISSION_INPUT_SCHEMA = "agentos.double_submission_boundary_input.v1";
export const DOUBLE_SUBMISSION_RESULT_SCHEMA = "agentos.double_submission_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REQUESTS = new Set(["ANALYZE_DOUBLE_SUBMISSION", "REVIEW_DOUBLE_SUBMISSION", "HANDOFF_DOUBLE_SUBMISSION", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "CERTIFY_SECURITY", "CHANGE_SUBMISSION", "ISSUE_CREDENTIAL", "OVERRIDE_SCOPE"]);
const FORBIDDEN = new Set(["REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "ANSWER_USER", "CERTIFY_SECURITY", "CHANGE_SUBMISSION", "ISSUE_CREDENTIAL", "OVERRIDE_SCOPE"]);
const TOOLS = new Set(["READ_SUBMISSION_RECORD", "READ_IDEMPOTENCY_STORE", "READ_SOURCE_LOCK", "READ_CONCURRENCY_SCOPE", "READ_CONTEXT"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive", "duplicate_request", "submission_missing", "version_ambiguous", "replay_unproven"];
const REQUIRED_BLOCKS = ["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "BLOCK.SECURITY.ACCESS_CONTROL_ROUTER"];
function fail(message, code = "DOUBLE_SUBMISSION_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), name + " must be an object", "DOUBLE_SUBMISSION_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), name + " has unknown field " + key, "DOUBLE_SUBMISSION_UNKNOWN_FIELD"); }
function str(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, name + " is invalid", "DOUBLE_SUBMISSION_FIELD_INVALID"); }
function id(value, name) { str(value, name); assert(ID.test(value), name + " is not canonical", "DOUBLE_SUBMISSION_ID_INVALID"); }
function digest(value, name) { str(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), name + " is not a real digest", "DOUBLE_SUBMISSION_DIGEST_INVALID"); }
function result(disposition, route, code, input, extra = {}) {
  const base = {schema: DOUBLE_SUBMISSION_RESULT_SCHEMA, version: 1, disposition, route, routing_allowed: false, acceptance_allowed: false, certification_allowed: false, submission_mutation_allowed: false, credential_issue_allowed: false, external_side_effects: {submission_record_reads: 0, idempotency_reads: 0, source_reads: 0, concurrency_checks: 0, duplicate_decisions: 0, submission_writes: 0, replay_mutations: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, error_code: code, input_sha256: canonicalDigest(input), ...extra};
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Double Submission input");
  assert(input.schema === DOUBLE_SUBMISSION_INPUT_SCHEMA && input.version === 1, "Double Submission schema mismatch", "DOUBLE_SUBMISSION_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Double Submission request is unknown", "DOUBLE_SUBMISSION_REQUEST_INVALID");
  exact(input.evidence, new Set(["authority_status", "security_domain", "request_identity", "submission_identity", "duplicate_detection_status", "idempotency_key", "replay_status", "concurrency_scope", "operation_identity", "operation_version", "policy_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "project_data_present", "secret_data_present", "submission_mutation_requested", "credential_issue_requested", "adversarial_flags"]), "Double Submission evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "security_domain", "request_identity", "submission_identity", "duplicate_detection_status", "idempotency_key", "replay_status", "concurrency_scope", "operation_identity", "operation_version", "policy_status", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope"]) str(e[key], "evidence." + key);
  digest(e.candidate_status === "CURRENT_CANDIDATE" ? e.submission_identity : "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "evidence.submission_identity");
  assert(e.security_domain === "DOUBLE_SUBMISSION", "security domain is not typed", "DOUBLE_SUBMISSION_DOMAIN_INVALID");
  assert(SHA256.test(e.idempotency_key) && !/^([0-9a-f])\1{63}$/u.test(e.idempotency_key), "idempotency key is not a content identity", "DOUBLE_SUBMISSION_IDEMPOTENCY_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "DOUBLE_SUBMISSION_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "DOUBLE_SUBMISSION_BLOCK_BINDING_INVALID"); });
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "DOUBLE_SUBMISSION_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "DOUBLE_SUBMISSION_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "submission_mutation_requested", "credential_issue_requested"]) assert(typeof e[key] === "boolean", "evidence." + key + " must be boolean", "DOUBLE_SUBMISSION_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Double Submission adversarial flags"); Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "DOUBLE_SUBMISSION_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Double Submission input contains protected data", "DOUBLE_SUBMISSION_PRIVACY_DENIED");
}
export function evaluateDoubleSubmissionBoundary(input) {
  validate(input); const e = input.evidence; const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_DOUBLE_SUBMISSION_SCOPE", "DOUBLE_SUBMISSION_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_DOUBLE_SUBMISSION_SIDE_EFFECT", "DOUBLE_SUBMISSION_OPERATION_FORBIDDEN", input);
  if (f.unrelated_scope) return result("DENY", "NO_DOUBLE_SUBMISSION_SCOPE", "DOUBLE_SUBMISSION_SCOPE_NOT_APPLICABLE", input);
  if (f.authority_conflict) return result("DENY", "CONTROL_PLANE_ESCALATION", "DOUBLE_SUBMISSION_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DOUBLE_SUBMISSION_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "DOUBLE_SUBMISSION_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "DOUBLE_SUBMISSION_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "DOUBLE_SUBMISSION_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority || f.duplicate_request) return result("DENY", "SINGLE_SUBMISSION_AUTHORITY_REQUIRED", "DOUBLE_SUBMISSION_DUPLICATE_AUTHORITY", input);
  if (f.unsupported_tool) return result("ROUTE", "TYPED_TOOL_SCOPE_REQUIRED", "DOUBLE_SUBMISSION_TOOL_SCOPE_REVIEW_REQUIRED", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR"});
  if (f.cross_provider || f.stale_source || f.replay_unproven) return result("DENY", "SOURCE_REFRESH_REQUIRED", "DOUBLE_SUBMISSION_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.submission_missing || f.version_ambiguous) return result("DENY", "TYPED_SUBMISSION_CONTEXT_REQUIRED", "DOUBLE_SUBMISSION_IDENTITY_UNPROVEN", input);
  if (e.submission_mutation_requested || e.credential_issue_requested) return result("DENY", "ATOMIC_SPECIALIST_REQUIRED", "DOUBLE_SUBMISSION_SIDE_EFFECT_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "DOUBLE_SUBMISSION_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_DOUBLE_SUBMISSION_SIDE_EFFECT", "DOUBLE_SUBMISSION_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.policy_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "DOUBLE_SUBMISSION_CONTEXT" || e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DOUBLE_SUBMISSION_CONTEXT_BINDING_INVALID", input);
  if (e.authority_scope !== "DOUBLE_SUBMISSION") return result("DENY", "NARROW_SCOPE_REQUIRED", "DOUBLE_SUBMISSION_SCOPE_INVALID", input);
  if (!["ANALYZE", "REVIEW", "HANDOFF"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DOUBLE_SUBMISSION_ACTION_INVALID", input);
  if (e.signal_status !== "BOUND" || e.task_status !== "DOUBLE_SUBMISSION_ANALYSIS") return result("DENY", "TYPED_CONTEXT_REQUIRED", "DOUBLE_SUBMISSION_SIGNAL_INVALID", input);
  if (e.operation_identity !== "OPERATION.DOUBLE_SUBMISSION" || e.operation_version !== "1" || e.source_identity !== "SOURCE.AGENTOS_DOUBLE_SUBMISSION" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "DOUBLE_SUBMISSION_SOURCE_BINDING_INVALID", input);
  if (e.duplicate_detection_status !== "EVIDENCE_COMPLETE" || e.replay_status !== "BOUND" || e.idempotency_key.length !== 64) return result("DENY", "TYPED_SUBMISSION_CONTEXT_REQUIRED", "DOUBLE_SUBMISSION_STATUS_UNPROVEN", input);
  if (!["CURRENT", "VERIFIED"].includes(e.authority_status)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DOUBLE_SUBMISSION_AUTHORITY_UNPROVEN", input);
  return result("ROUTE", "DOUBLE_SUBMISSION_HANDOFF", "DOUBLE_SUBMISSION_ANALYSIS_READY", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Hand the exact duplicate-submission evidence to the project owner; do not submit, replay, or mutate requests or project state.", execution_instruction: false}});
}
