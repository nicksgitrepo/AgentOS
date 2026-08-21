#!/usr/bin/env node

/*
 * Read-only OWASP API API1:2023 Broken Object Level Authorization boundary.
 *
 * The boundary only accepts repository-bound, typed evidence and emits a
 * bounded analysis handoff.  It never decides authorization, changes policy,
 * reads project data, writes memory, accepts a candidate, or invokes tools.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {
  assertOwaspApiObjectAuthorizationCanonicalEvidence,
  resolveOwaspApiObjectAuthorizationCanonicalAuthority,
} from "./owasp-api-object-authorization-authority-binding.mjs";

export const OWASP_API_OBJECT_AUTHORIZATION_INPUT_SCHEMA = "agentos.owasp_api_object_authorization_boundary_input.v1";
export const OWASP_API_OBJECT_AUTHORIZATION_RESULT_SCHEMA = "agentos.owasp_api_object_authorization_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{1,160}$/u;
const REQUESTS = new Set([
  "ANALYZE_OWASP_API_API1_OBJECT_AUTHORIZATION", "ROUTE_OWASP_API_API1_OBJECT_AUTHORIZATION",
  "NOT_APPLICABLE", "UNRELATED_REQUEST", "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN",
  "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW",
  "DECIDE_AUTHORIZATION", "MUTATE_POLICY", "ISSUE_CREDENTIAL",
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
  "specialist.foundation.tool-custody-gate", "specialist.security.owasp-api-top10-router",
  "specialist.standard.owasp-api-top10-2023", "specialist.standard.owasp-asvs",
];

function fail(message, code = "OWASP_API_OBJECT_AUTHORIZATION_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "OWASP_API_OBJECT_AUTHORIZATION_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "OWASP_API_OBJECT_AUTHORIZATION_UNKNOWN_FIELD");
}
function string(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} is invalid`, "OWASP_API_OBJECT_AUTHORIZATION_FIELD_INVALID"); }
function id(value, label) { string(value, label); assert(ID.test(value), `${label} is not canonical`, "OWASP_API_OBJECT_AUTHORIZATION_ID_INVALID"); }
function digest(value, label) { string(value, label, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "OWASP_API_OBJECT_AUTHORIZATION_DIGEST_INVALID"); }

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: OWASP_API_OBJECT_AUTHORIZATION_RESULT_SCHEMA,
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
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "OWASP API API1 input");
  assert(input.schema === OWASP_API_OBJECT_AUTHORIZATION_INPUT_SCHEMA && input.version === 1, "OWASP API API1 schema mismatch", "OWASP_API_OBJECT_AUTHORIZATION_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "OWASP API API1 request is unknown", "OWASP_API_OBJECT_AUTHORIZATION_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal", "signal_status",
    "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status",
    "model_route_status", "authority_scope", "scope", "api_category", "api_scope", "object_authorization_status",
    "authorization_boundary_status", "standard_id", "standard_version", "standard_block_sha256", "standard_source_manifest_sha256",
    "asvs_block_sha256", "asvs_source_manifest_sha256", "model_snapshot_sha256", "model_task_class", "model_capability_floor",
    "model_required_capabilities", "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256",
    "project_data_present", "secret_data_present", "adversarial_flags",
  ]), "OWASP API API1 evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "custody_owner", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "candidate_status", "signal", "signal_status", "context_status",
    "requested_action", "model_policy_status", "model_route_status", "authority_scope", "scope", "api_category", "api_scope",
    "object_authorization_status", "authorization_boundary_status", "standard_id", "standard_version",
  ]) string(e[key], `evidence.${key}`);
  id(e.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(e.custody_ref), "custody reference is not opaque", "OWASP_API_OBJECT_AUTHORIZATION_CUSTODY_REF_INVALID");
  digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.standard_id === "source.owasp-api-top10-2023" && e.standard_version === "2023", "API standard identity is not canonical", "OWASP_API_OBJECT_AUTHORIZATION_STANDARD_BINDING_INVALID");
  digest(e.standard_block_sha256, "evidence.standard_block_sha256");
  digest(e.standard_source_manifest_sha256, "evidence.standard_source_manifest_sha256");
  digest(e.asvs_block_sha256, "evidence.asvs_block_sha256");
  digest(e.asvs_source_manifest_sha256, "evidence.asvs_source_manifest_sha256");
  digest(e.model_snapshot_sha256, "evidence.model_snapshot_sha256");
  string(e.model_task_class, "evidence.model_task_class", 80);
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "model capability floor is invalid", "OWASP_API_OBJECT_AUTHORIZATION_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "model capabilities are invalid", "OWASP_API_OBJECT_AUTHORIZATION_MODEL_ROUTE_UNBOUND");
  digest(e.model_route_sha256, "evidence.model_route_sha256");
  digest(e.context_receipt_sha256, "evidence.context_receipt_sha256");
  digest(e.upstream_router_result_sha256, "evidence.upstream_router_result_sha256");
  assert(e.api_category === "API1:2023" && e.api_scope === "BOUND", "API category context is not canonical", "OWASP_API_OBJECT_AUTHORIZATION_API_CATEGORY_REQUIRED");
  assert(e.object_authorization_status === "BOUND" && e.authorization_boundary_status === "BOUND", "object authorization context is not bound", "OWASP_API_OBJECT_AUTHORIZATION_BOUNDARY_REQUIRED");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= 3, "requested tools are invalid", "OWASP_API_OBJECT_AUTHORIZATION_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 60); assert(TOOLS.has(tool), "unsupported tool", "OWASP_API_OBJECT_AUTHORIZATION_TOOL_SCOPE_INVALID"); });
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "OWASP_API_OBJECT_AUTHORIZATION_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "OWASP_API_OBJECT_AUTHORIZATION_BLOCK_BINDING_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "OWASP_API_OBJECT_AUTHORIZATION_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "OWASP API API1 adversarial flags");
  FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "OWASP_API_OBJECT_AUTHORIZATION_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "OWASP API API1 input contains protected data", "OWASP_API_OBJECT_AUTHORIZATION_PRIVACY_DENIED");
  assertOwaspApiObjectAuthorizationCanonicalEvidence(e, resolveOwaspApiObjectAuthorizationCanonicalAuthority());
}

export function evaluateOwaspApiObjectAuthorizationBoundary(input) {
  validate(input);
  const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || e.adversarial_flags.unrelated_scope) return result("DENY", "NO_OWASP_API_API1_OBJECT_AUTHORIZATION", "OWASP_API_OBJECT_AUTHORIZATION_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_OWASP_API_API1_OBJECT_AUTHORIZATION_SIDE_EFFECT", "OWASP_API_OBJECT_AUTHORIZATION_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "OWASP_API_OBJECT_AUTHORIZATION_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_OWASP_API_API1_OBJECT_AUTHORIZATION_SIDE_EFFECT", "OWASP_API_OBJECT_AUTHORIZATION_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.custody_owner !== "AGENT.SECURITY.OWASP_API_2023_API1_OBJECT_AUTHORIZATION") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_AUTHORITY_UNVERIFIED", input);
  if (e.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_SOURCE_IDENTITY_INVALID", input);
  if (e.candidate_status !== "CURRENT_CANDIDATE" || e.signal !== "OWASP_API_API1_OBJECT_AUTHORIZATION" || e.signal_status !== "BOUND" || e.context_status !== "OWASP_API_API1_OBJECT_AUTHORIZATION_CONTEXT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_CONTEXT_BINDING_INVALID", input);
  if (e.model_route_status !== "BOUND") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_MODEL_ROUTE_UNBOUND", input);
  if (!['ANALYZE', 'ROUTE'].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_ACTION_INVALID", input);
  return result("ROUTE", "OWASP_API_API1_OBJECT_AUTHORIZATION_ANALYSIS_HANDOFF", "OWASP_API_OBJECT_AUTHORIZATION_ROUTE_READY", input, {
    analysis_allowed: true,
    selected_specialist: "specialist.security.owasp-api-2023-api1-object-authorization",
    handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Run only the named OWASP API API1:2023 Broken Object Level Authorization analysis, then return a typed evidence finding or NOT_APPLICABLE handoff; do not decide authorization or mutate policy.", execution_instruction: false},
  });
}
