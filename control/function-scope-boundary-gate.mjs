#!/usr/bin/env node

/* Read-only Function Scope Authorization specialist boundary.  It accepts
 * typed evidence, checks that the concern is narrow and current, and emits a
 * bounded analysis handoff.  It never decides permission, writes a project,
 * changes policy, accepts a candidate, or invokes tools. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {assertFunctionScopeCanonicalEvidence, resolveFunctionScopeCanonicalAuthority} from "./function-scope-authority-binding.mjs";

export const FUNCTION_SCOPE_INPUT_SCHEMA = "agentos.function_scope_boundary_input.v1";
export const FUNCTION_SCOPE_RESULT_SCHEMA = "agentos.function_scope_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{1,160}$/u;
const REQUESTS = new Set([
  "ANALYZE_FUNCTION_SCOPE", "ROUTE_FUNCTION_SCOPE", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "ISSUE_CREDENTIAL",
]);
const FORBIDDEN = new Set([
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "ISSUE_CREDENTIAL",
]);
const TOOLS = new Set(["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT"]);
const FLAGS = [
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive",
];
const REQUIRED_BLOCKS = [
  "specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate", "specialist.security.access-control-router",
  "specialist.standard.owasp-asvs",
];

function fail(message, code = "FUNCTION_SCOPE_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "FUNCTION_SCOPE_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "FUNCTION_SCOPE_UNKNOWN_FIELD");
}
function string(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} is invalid`, "FUNCTION_SCOPE_FIELD_INVALID"); }
function id(value, label) { string(value, label); assert(ID.test(value), `${label} is not canonical`, "FUNCTION_SCOPE_ID_INVALID"); }
function digest(value, label) { string(value, label, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "FUNCTION_SCOPE_DIGEST_INVALID"); }

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: FUNCTION_SCOPE_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    analysis_allowed: false,
    acceptance_allowed: false,
    authorization_decision_allowed: false,
    policy_mutation_allowed: false,
    external_side_effects: {
      candidate_reads: 0,
      source_reads: 0,
      protected_data_reads: 0,
      authorization_decisions: 0,
      policy_mutations: 0,
      project_writes: 0,
      memory_writes: 0,
      credential_accesses: 0,
      state_changes: 0,
    },
    error_code: errorCode,
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "function-scope input");
  assert(input.schema === FUNCTION_SCOPE_INPUT_SCHEMA && input.version === 1, "function-scope schema mismatch", "FUNCTION_SCOPE_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "function-scope request is unknown", "FUNCTION_SCOPE_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal", "signal_status",
    "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status",
    "model_route_status", "authority_scope", "scope", "tenant_scope_status", "standard_id", "standard_version", "standard_block_sha256",
    "standard_source_manifest_sha256", "model_snapshot_sha256", "model_task_class", "model_capability_floor", "model_required_capabilities",
    "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "project_data_present", "secret_data_present", "adversarial_flags",
  ]), "function-scope evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "custody_owner", "source_status", "source_identity", "source_version", "source_effective_date",
    "source_retrieved_date", "candidate_status", "signal", "signal_status", "context_status", "requested_action", "model_policy_status",
    "model_route_status", "authority_scope", "scope", "tenant_scope_status", "standard_id", "standard_version",
  ]) string(e[key], `evidence.${key}`);
  id(e.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(e.custody_ref), "custody reference is not opaque", "FUNCTION_SCOPE_CUSTODY_REF_INVALID");
  digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.standard_id === "source.owasp-asvs-5-0-0" && e.standard_version === "5.0.0", "standard identity is not canonical", "FUNCTION_SCOPE_STANDARD_BINDING_INVALID");
  digest(e.standard_block_sha256, "evidence.standard_block_sha256");
  digest(e.standard_source_manifest_sha256, "evidence.standard_source_manifest_sha256");
  digest(e.model_snapshot_sha256, "evidence.model_snapshot_sha256");
  string(e.model_task_class, "evidence.model_task_class", 80);
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "evidence.model_capability_floor is invalid", "FUNCTION_SCOPE_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "evidence.model_required_capabilities is invalid", "FUNCTION_SCOPE_MODEL_ROUTE_UNBOUND");
  digest(e.model_route_sha256, "evidence.model_route_sha256");
  digest(e.context_receipt_sha256, "evidence.context_receipt_sha256");
  digest(e.upstream_router_result_sha256, "evidence.upstream_router_result_sha256");
  assert(e.tenant_scope_status === "BOUND", "tenant scope context is not bound", "FUNCTION_SCOPE_TENANT_SCOPE_REQUIRED");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= 3, "requested tools are invalid", "FUNCTION_SCOPE_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 60); assert(TOOLS.has(tool), "unsupported tool", "FUNCTION_SCOPE_TOOL_SCOPE_INVALID"); });
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "FUNCTION_SCOPE_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "FUNCTION_SCOPE_BLOCK_BINDING_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "FUNCTION_SCOPE_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "function-scope adversarial flags");
  FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "FUNCTION_SCOPE_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "function-scope input contains protected data", "FUNCTION_SCOPE_PRIVACY_DENIED");
  assertFunctionScopeCanonicalEvidence(e, resolveFunctionScopeCanonicalAuthority());
}

export function evaluateFunctionScopeBoundary(input) {
  validate(input);
  const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || e.adversarial_flags.unrelated_scope) return result("DENY", "NO_FUNCTION_SCOPE", "FUNCTION_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_FUNCTION_SCOPE_SIDE_EFFECT", "FUNCTION_SCOPE_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "FUNCTION_SCOPE_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "FUNCTION_SCOPE_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "FUNCTION_SCOPE_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "FUNCTION_SCOPE_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "FUNCTION_SCOPE_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "FUNCTION_SCOPE_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "FUNCTION_SCOPE_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "FUNCTION_SCOPE_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_FUNCTION_SCOPE_SIDE_EFFECT", "FUNCTION_SCOPE_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.custody_owner !== "AGENT.SECURITY.FUNCTION_SCOPE") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "FUNCTION_SCOPE_AUTHORITY_UNVERIFIED", input);
  if (e.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "FUNCTION_SCOPE_SOURCE_IDENTITY_INVALID", input);
  if (e.candidate_status !== "CURRENT_CANDIDATE" || e.signal !== "FUNCTION_SCOPE" || e.signal_status !== "BOUND" || e.context_status !== "FUNCTION_SCOPE_CONTEXT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "FUNCTION_SCOPE_CONTEXT_BINDING_INVALID", input);
  if (e.model_route_status !== "BOUND") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "FUNCTION_SCOPE_MODEL_ROUTE_UNBOUND", input);
  if (!["ANALYZE", "ROUTE"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "FUNCTION_SCOPE_ACTION_INVALID", input);
  return result("ROUTE", "FUNCTION_SCOPE_ANALYSIS_HANDOFF", "FUNCTION_SCOPE_ROUTE_READY", input, {
    analysis_allowed: true,
    selected_specialist: "specialist.security.function-scope",
    handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Run only the named Function Scope Authorization analysis, then return a typed finding or NOT_APPLICABLE handoff; do not decide permission or mutate policy.", execution_instruction: false},
  });
}
