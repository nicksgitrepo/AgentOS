#!/usr/bin/env node

/* Read-only, project-agnostic Idempotency evidence boundary. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const IDEMPOTENCY_INPUT_SCHEMA = "agentos.idempotency_boundary_input.v1";
export const IDEMPOTENCY_RESULT_SCHEMA = "agentos.idempotency_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REQUESTS = new Set(["ANALYZE_IDEMPOTENCY", "REVIEW_IDEMPOTENCY", "HANDOFF_IDEMPOTENCY", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "CERTIFY_SECURITY", "CHANGE_IDEMPOTENCY", "ISSUE_CREDENTIAL", "OVERRIDE_SCOPE"]);
const FORBIDDEN = new Set(["REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "CERTIFY_SECURITY", "CHANGE_IDEMPOTENCY", "ISSUE_CREDENTIAL", "OVERRIDE_SCOPE"]);
const TOOLS = new Set(["READ_IDEMPOTENCY_RECORD", "READ_IDEMPOTENCY_STORE", "READ_SOURCE_LOCK", "READ_CONCURRENCY_SCOPE", "READ_CONTEXT"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive", "duplicate_request", "key_missing", "version_ambiguous", "replay_unproven", "concurrency_unbounded"];
const REQUIRED_BLOCKS = ["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "BLOCK.SECURITY.ACCESS_CONTROL_ROUTER"];

function fail(message, code = "IDEMPOTENCY_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "IDEMPOTENCY_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "IDEMPOTENCY_UNKNOWN_FIELD"); }
function str(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "IDEMPOTENCY_FIELD_INVALID"); }
function id(value, name) { str(value, name); assert(ID.test(value), `${name} is not canonical`, "IDEMPOTENCY_ID_INVALID"); }
function digest(value, name) { str(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "IDEMPOTENCY_DIGEST_INVALID"); }
function result(disposition, route, code, input, extra = {}) {
  const base = {schema: IDEMPOTENCY_RESULT_SCHEMA, version: 1, disposition, route, analysis_allowed: false, acceptance_allowed: false, authorization_decision_allowed: false, policy_mutation_allowed: false, submission_mutation_allowed: false, external_side_effects: {idempotency_record_reads: 0, idempotency_store_reads: 0, source_reads: 0, concurrency_checks: 0, duplicate_decisions: 0, submission_writes: 0, replay_mutations: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, error_code: code, input_sha256: canonicalDigest(input), ...extra};
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Idempotency input");
  assert(input.schema === IDEMPOTENCY_INPUT_SCHEMA && input.version === 1, "Idempotency schema mismatch", "IDEMPOTENCY_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Idempotency request is unknown", "IDEMPOTENCY_REQUEST_INVALID");
  exact(input.evidence, new Set(["authority_status", "security_domain", "request_identity", "idempotency_key", "duplicate_detection_status", "replay_status", "concurrency_scope", "operation_identity", "operation_version", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "project_data_present", "secret_data_present", "adversarial_flags"]), "Idempotency evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "security_domain", "request_identity", "duplicate_detection_status", "replay_status", "concurrency_scope", "operation_identity", "operation_version", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope"]) str(e[key], `evidence.${key}`);
  digest(e.idempotency_key, "evidence.idempotency_key"); digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.security_domain === "IDEMPOTENCY", "security domain is not typed", "IDEMPOTENCY_DOMAIN_INVALID");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= TOOLS.size, "requested tools are invalid", "IDEMPOTENCY_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "IDEMPOTENCY_TOOL_SCOPE_INVALID"); });
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "IDEMPOTENCY_BLOCK_BINDING_INVALID"); e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "IDEMPOTENCY_BLOCK_BINDING_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "IDEMPOTENCY_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Idempotency adversarial flags"); Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "IDEMPOTENCY_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Idempotency input contains protected data", "IDEMPOTENCY_PRIVACY_DENIED");
}
export function evaluateIdempotencyBoundary(input) {
  validate(input); const e = input.evidence; const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_IDEMPOTENCY_SCOPE", "IDEMPOTENCY_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_IDEMPOTENCY_SIDE_EFFECT", "IDEMPOTENCY_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "IDEMPOTENCY_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "IDEMPOTENCY_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "IDEMPOTENCY_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "IDEMPOTENCY_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "IDEMPOTENCY_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_request) return result("DENY", "SINGLE_IDEMPOTENCY_AUTHORITY_REQUIRED", "IDEMPOTENCY_DUPLICATE_REQUEST_UNPROVEN", input);
  if (f.unsupported_tool) return result("DENY", "TYPED_TOOL_SCOPE_REQUIRED", "IDEMPOTENCY_TOOL_SCOPE_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || f.replay_unproven) return result("DENY", "SOURCE_REFRESH_REQUIRED", "IDEMPOTENCY_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.key_missing || f.version_ambiguous || f.concurrency_unbounded) return result("DENY", "TYPED_IDEMPOTENCY_CONTEXT_REQUIRED", "IDEMPOTENCY_IDENTITY_UNPROVEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "IDEMPOTENCY_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_IDEMPOTENCY_SIDE_EFFECT", "IDEMPOTENCY_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "IDEMPOTENCY_CONTEXT" || e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND") return result("DENY", "TYPED_CONTEXT_REQUIRED", "IDEMPOTENCY_CONTEXT_BINDING_INVALID", input);
  if (e.authority_scope !== "IDEMPOTENCY") return result("DENY", "NARROW_SCOPE_REQUIRED", "IDEMPOTENCY_SCOPE_INVALID", input);
  if (!["ANALYZE", "REVIEW", "HANDOFF"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "IDEMPOTENCY_ACTION_INVALID", input);
  if (e.signal_status !== "BOUND" || e.task_status !== "IDEMPOTENCY_ANALYSIS") return result("DENY", "TYPED_CONTEXT_REQUIRED", "IDEMPOTENCY_SIGNAL_INVALID", input);
  if (e.operation_identity !== "OPERATION.IDEMPOTENCY" || e.operation_version !== "1" || e.source_identity !== "SOURCE.AGENTOS_IDEMPOTENCY" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "IDEMPOTENCY_SOURCE_BINDING_INVALID", input);
  if (e.duplicate_detection_status !== "EVIDENCE_COMPLETE" || e.replay_status !== "BOUND" || e.idempotency_key.length !== 64) return result("DENY", "TYPED_IDEMPOTENCY_CONTEXT_REQUIRED", "IDEMPOTENCY_STATUS_UNPROVEN", input);
  return result("ROUTE", "IDEMPOTENCY_ANALYSIS_HANDOFF", "IDEMPOTENCY_ANALYSIS_READY", input, {analysis_allowed: true, selected_specialist: "specialist.security.idempotency", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Hand the exact idempotency evidence to the governed owner; do not submit, replay, mutate, accept, or certify requests.", execution_instruction: false}});
}
