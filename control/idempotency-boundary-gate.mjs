#!/usr/bin/env node

/*
 * Read-only, project-agnostic Idempotency evidence boundary.  It accepts a
 * typed request, resolves repository authority, and emits only a bounded
 * analysis handoff.  It never submits/replays a request, mutates a project or
 * memory store, accepts a candidate, or decides authorization.
 */

import {canonicalDigest, scanPersistedRecord} from "./content-addressing.mjs";
import {assertIdempotencyCanonicalEvidence, IDEMPOTENCY_BLOCK_ID, IDEMPOTENCY_SOURCE_ID, IDEMPOTENCY_SOURCE_VERSION, resolveIdempotencyCanonicalAuthority} from "./idempotency-authority-binding.mjs";

export const IDEMPOTENCY_INPUT_SCHEMA = "agentos.idempotency_boundary_input.v1";
export const IDEMPOTENCY_RESULT_SCHEMA = "agentos.idempotency_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{1,160}$/u;
const REQUESTS = new Set([
  "ANALYZE_IDEMPOTENCY", "ROUTE_IDEMPOTENCY", "REVIEW_IDEMPOTENCY", "HANDOFF_IDEMPOTENCY",
  "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "ARCHIVE",
  "DESPAWN", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW",
  "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "CHANGE_IDEMPOTENCY", "REPLAY_REQUEST", "SUBMIT_REQUEST",
  "ISSUE_CREDENTIAL", "OVERRIDE_SCOPE", "CERTIFY_SECURITY",
]);
const FORBIDDEN = new Set([
  "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "MERGE", "PUSH", "DEPLOY", "PUBLISH",
  "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "CHANGE_IDEMPOTENCY",
  "REPLAY_REQUEST", "SUBMIT_REQUEST", "ISSUE_CREDENTIAL", "OVERRIDE_SCOPE", "CERTIFY_SECURITY",
]);
const TOOLS = new Set(["READ_IDEMPOTENCY_RECORD", "READ_IDEMPOTENCY_STORE", "READ_SOURCE_LOCK", "READ_CONCURRENCY_SCOPE", "READ_CONTEXT"]);
const FLAGS = Object.freeze([
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority",
  "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider",
  "false_positive", "duplicate_request", "key_missing", "version_ambiguous", "replay_unproven", "concurrency_unbounded",
]);
const REQUIRED_BLOCKS = Object.freeze([
  "specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate", "specialist.security.access-control-router", "specialist.standard.owasp-asvs",
]);

function fail(message, code = "IDEMPOTENCY_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "IDEMPOTENCY_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} has unknown field ${key}`, "IDEMPOTENCY_UNKNOWN_FIELD");
}
function string(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim(), `${label} is invalid`, "IDEMPOTENCY_FIELD_INVALID"); }
function id(value, label) { string(value, label); assert(ID.test(value), `${label} is not canonical`, "IDEMPOTENCY_ID_INVALID"); }
function digest(value, label) { string(value, label, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "IDEMPOTENCY_DIGEST_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: IDEMPOTENCY_RESULT_SCHEMA, version: 1, disposition, route,
    analysis_allowed: false, routing_allowed: false, acceptance_allowed: false,
    authorization_decision_allowed: false, policy_mutation_allowed: false,
    submission_mutation_allowed: false, replay_mutation_allowed: false, credential_issue_allowed: false,
    memory_write_allowed: false,
    external_side_effects: {
      idempotency_record_reads: 0, idempotency_store_reads: 0, source_reads: 0, concurrency_checks: 0,
      duplicate_decisions: 0, submission_writes: 0, replay_mutations: 0, memory_writes: 0,
      acceptance_calls: 0, credential_accesses: 0, state_changes: 0,
    },
    error_code: errorCode, input_sha256: canonicalDigest(input), ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Idempotency input");
  assert(input.schema === IDEMPOTENCY_INPUT_SCHEMA && input.version === 1, "Idempotency schema mismatch", "IDEMPOTENCY_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Idempotency request is unknown", "IDEMPOTENCY_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "custody_status", "custody_owner", "custody_ref", "security_domain", "request_identity", "idempotency_key",
    "duplicate_detection_status", "replay_status", "concurrency_scope", "operation_identity", "operation_version", "source_status",
    "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "source_manifest_sha256", "candidate_status",
    "candidate_digest", "signal", "signal_status", "task_status", "context_status", "context_complete", "requested_action",
    "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "scope",
    "standard_id", "standard_version", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256",
    "model_task_class", "model_capability_floor", "model_required_capabilities", "model_route_sha256", "context_receipt_sha256",
    "upstream_router_result_sha256", "operation_context_sha256", "project_data_present", "secret_data_present", "policy_status",
    "replay_mutation_requested", "submission_mutation_requested", "credential_issue_requested", "adversarial_flags",
  ]), "Idempotency evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "custody_owner", "security_domain", "request_identity", "duplicate_detection_status", "replay_status",
    "concurrency_scope", "operation_identity", "operation_version", "source_status", "source_identity", "source_version", "source_effective_date",
    "source_retrieved_date", "candidate_status", "signal", "signal_status", "task_status", "context_status", "requested_action",
    "model_policy_status", "model_route_status", "authority_scope", "scope", "standard_id", "standard_version", "model_task_class", "policy_status",
  ]) string(e[key], `evidence.${key}`);
  id(e.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(e.custody_ref), "Idempotency custody reference is not opaque", "IDEMPOTENCY_CUSTODY_REF_INVALID");
  for (const key of ["idempotency_key", "candidate_digest", "source_manifest_sha256", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "operation_context_sha256"]) digest(e[key], `evidence.${key}`);
  assert(e.security_domain === "IDEMPOTENCY", "Idempotency security domain is not typed", "IDEMPOTENCY_DOMAIN_INVALID");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= TOOLS.size, "Idempotency tools are invalid", "IDEMPOTENCY_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported Idempotency tool", "IDEMPOTENCY_TOOL_SCOPE_INVALID"); });
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "Idempotency block identities are incomplete", "IDEMPOTENCY_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "Idempotency block identity is not canonical", "IDEMPOTENCY_BLOCK_BINDING_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "replay_mutation_requested", "submission_mutation_requested", "credential_issue_requested"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "IDEMPOTENCY_BOOLEAN_INVALID");
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "Idempotency model capability floor is invalid", "IDEMPOTENCY_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "Idempotency model capabilities are invalid", "IDEMPOTENCY_MODEL_ROUTE_UNBOUND");
  exact(e.adversarial_flags, new Set(FLAGS), "Idempotency adversarial flags"); FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "IDEMPOTENCY_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Idempotency input contains protected data", "IDEMPOTENCY_PRIVACY_DENIED");
  const authority = resolveIdempotencyCanonicalAuthority();
  assertIdempotencyCanonicalEvidence(e, authority);
  assert(e.source_status === "CURRENT_VERIFIED" && e.source_effective_date === authority.source_effective_date && e.source_retrieved_date === authority.source_retrieved_date, "Idempotency source freshness is not current", "IDEMPOTENCY_SOURCE_STALE_OR_UNVERIFIED");
  assert(e.candidate_status === "CURRENT_CANDIDATE" && e.signal === "IDEMPOTENCY" && e.signal_status === "BOUND" && e.context_status === "IDEMPOTENCY_CONTEXT" && e.context_complete === true, "Idempotency context binding is incomplete", "IDEMPOTENCY_CONTEXT_BINDING_INVALID");
  return authority;
}
export function evaluateIdempotencyBoundary(input) {
  const authority = validate(input); const e = input.evidence; const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_IDEMPOTENCY_SCOPE", "IDEMPOTENCY_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_IDEMPOTENCY_SIDE_EFFECT", "IDEMPOTENCY_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "IDEMPOTENCY_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "IDEMPOTENCY_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "IDEMPOTENCY_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "IDEMPOTENCY_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "IDEMPOTENCY_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_request) return result("DENY", "SINGLE_IDEMPOTENCY_AUTHORITY_REQUIRED", "IDEMPOTENCY_DUPLICATE_REQUEST_UNPROVEN", input);
  if (f.unsupported_tool) return result("DENY", "TYPED_TOOL_SCOPE_REQUIRED", "IDEMPOTENCY_TOOL_SCOPE_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || f.replay_unproven) return result("DENY", "SOURCE_REFRESH_REQUIRED", "IDEMPOTENCY_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.key_missing || f.version_ambiguous || f.concurrency_unbounded) return result("DENY", "TYPED_IDEMPOTENCY_CONTEXT_REQUIRED", "IDEMPOTENCY_IDENTITY_UNPROVEN", input);
  if (e.replay_mutation_requested || e.submission_mutation_requested || e.credential_issue_requested || f.unsafe_action) return result("DENY", "NO_IDEMPOTENCY_SIDE_EFFECT", "IDEMPOTENCY_OPERATION_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "IDEMPOTENCY_FINDING_UNSUPPORTED", input);
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.model_route_status !== "BOUND" || e.policy_status !== "CURRENT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "IDEMPOTENCY_CONTEXT_BINDING_INVALID", input);
  if (! ["ANALYZE", "ROUTE", "REVIEW", "HANDOFF"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "IDEMPOTENCY_ACTION_INVALID", input);
  if (e.duplicate_detection_status !== "EVIDENCE_COMPLETE" || e.replay_status !== "BOUND" || e.idempotency_key !== authority.block_sha256) return result("DENY", "TYPED_IDEMPOTENCY_CONTEXT_REQUIRED", "IDEMPOTENCY_STATUS_UNPROVEN", input);
  assert(authority.block_sha256 === e.candidate_digest, "Idempotency authority changed during evaluation", "IDEMPOTENCY_CANONICAL_PROVENANCE_INVALID");
  return result("ROUTE", "IDEMPOTENCY_ANALYSIS_HANDOFF", "IDEMPOTENCY_ANALYSIS_READY", input, {
    analysis_allowed: true, routing_allowed: true, selected_specialist: IDEMPOTENCY_BLOCK_ID,
    handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Run only the named Idempotency analysis, then return a typed evidence-bounded finding or NOT_APPLICABLE handoff; do not submit, replay, mutate, accept, or certify requests.", execution_instruction: false},
  });
}
