#!/usr/bin/env node

/*
 * Read-only OWASP API API1:2023 Broken Object Level Authorization boundary.
 *
 * This is an evidence router, not an authorization engine. It never reads a
 * tenant database, resolves a user's permission, fabricates backend proof,
 * writes policy/project state, or accepts a candidate. Tenant and object
 * scope are required as typed external bindings; missing or inconsistent
 * scope closes the dependent analysis.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {
  assertOwaspApiObjectAuthorizationCanonicalEvidence,
  resolveOwaspApiObjectAuthorizationCanonicalAuthority,
} from "./owasp-api-2023-api1-object-authorization-authority-binding.mjs";

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
  "BLOCK.API.AUTHORITY", "BLOCK.API.EVIDENCE", "BLOCK.API.SCOPE", "BLOCK.API.CUSTODY",
  "BLOCK.API.HANDOFF", "BLOCK.API.SECURITY_ROUTER", "specialist.security.owasp-api-top10-router",
  "specialist.standard.owasp-api-top10-2023", "specialist.standard.owasp-asvs",
];
const SIDE_EFFECT_KEYS = [
  "candidate_reads", "source_reads", "protected_data_reads", "authorization_decisions", "policy_mutations",
  "project_writes", "memory_writes", "credential_accesses", "state_changes",
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
function ref(value, label) { string(value, label, 180); assert(OPAQUE_REF.test(value), `${label} is not opaque`, "OWASP_API_OBJECT_AUTHORIZATION_REF_INVALID"); }

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
    external_side_effects: Object.fromEntries(SIDE_EFFECT_KEYS.map((key) => [key, 0])),
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
    "authority_status", "security_domain", "control_identity", "control_version", "api_category", "api_scope", "standard_edition",
    "custody_status", "custody_owner", "custody_ref", "auditor_role", "auditor_custody_status", "auditor_custody_ref",
    "auditor_write_allowed", "auditor_backend_access", "auditor_project_mutation_allowed", "source_status", "source_identity",
    "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal",
    "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools",
    "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "scope", "object_authorization_status",
    "authorization_boundary_status", "tenant_scope_status", "tenant_scope_ref", "object_scope_status", "object_scope_ref",
    "scope_relation", "backend_evidence_status", "backend_evidence_claimed", "backend_evidence_digest", "standard_id",
    "standard_version", "standard_block_sha256", "standard_source_manifest_sha256", "asvs_block_sha256", "asvs_source_manifest_sha256",
    "model_snapshot_sha256", "model_task_class", "model_capability_floor", "model_required_capabilities", "model_route_sha256",
    "context_receipt_sha256", "upstream_router_result_sha256", "project_data_present", "secret_data_present", "adversarial_flags",
  ]), "OWASP API API1 evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "security_domain", "control_identity", "control_version", "api_category", "api_scope", "standard_edition",
    "custody_status", "custody_owner", "auditor_role", "auditor_custody_status", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "candidate_status", "signal", "signal_status", "task_status", "context_status",
    "requested_action", "model_policy_status", "model_route_status", "authority_scope", "scope", "object_authorization_status",
    "authorization_boundary_status", "tenant_scope_status", "object_scope_status", "scope_relation", "backend_evidence_status", "standard_id", "standard_version", "model_task_class",
  ]) string(e[key], `evidence.${key}`);
  id(e.custody_owner, "evidence.custody_owner"); ref(e.custody_ref, "evidence.custody_ref"); ref(e.auditor_custody_ref, "evidence.auditor_custody_ref"); ref(e.tenant_scope_ref, "evidence.tenant_scope_ref"); ref(e.object_scope_ref, "evidence.object_scope_ref");
  digest(e.candidate_digest, "evidence.candidate_digest"); digest(e.standard_block_sha256, "evidence.standard_block_sha256"); digest(e.standard_source_manifest_sha256, "evidence.standard_source_manifest_sha256"); digest(e.asvs_block_sha256, "evidence.asvs_block_sha256"); digest(e.asvs_source_manifest_sha256, "evidence.asvs_source_manifest_sha256"); digest(e.model_snapshot_sha256, "evidence.model_snapshot_sha256"); digest(e.model_route_sha256, "evidence.model_route_sha256"); digest(e.context_receipt_sha256, "evidence.context_receipt_sha256"); digest(e.upstream_router_result_sha256, "evidence.upstream_router_result_sha256");
  assert(e.backend_evidence_digest === null, "backend evidence digest must be null in this read-only boundary", "OWASP_API_OBJECT_AUTHORIZATION_BACKEND_EVIDENCE_FORBIDDEN");
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "model capability floor is invalid", "OWASP_API_OBJECT_AUTHORIZATION_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "model capabilities are invalid", "OWASP_API_OBJECT_AUTHORIZATION_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= 3, "requested tools are invalid", "OWASP_API_OBJECT_AUTHORIZATION_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 60); assert(TOOLS.has(tool), "unsupported tool", "OWASP_API_OBJECT_AUTHORIZATION_TOOL_SCOPE_INVALID"); });
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "OWASP_API_OBJECT_AUTHORIZATION_BLOCK_BINDING_INVALID"); e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "OWASP_API_OBJECT_AUTHORIZATION_BLOCK_BINDING_INVALID"); });
  for (const key of ["context_complete", "auditor_write_allowed", "auditor_backend_access", "auditor_project_mutation_allowed", "backend_evidence_claimed", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "OWASP_API_OBJECT_AUTHORIZATION_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "OWASP API API1 adversarial flags"); FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "OWASP_API_OBJECT_AUTHORIZATION_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "OWASP API API1 input contains protected data", "OWASP_API_OBJECT_AUTHORIZATION_PRIVACY_DENIED");
}

export function evaluateOwaspApiObjectAuthorizationBoundary(input) {
  validate(input);
  const e = input.evidence; const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_OWASP_API_API1_OBJECT_AUTHORIZATION", "OWASP_API_OBJECT_AUTHORIZATION_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_OWASP_API_API1_OBJECT_AUTHORIZATION_SIDE_EFFECT", "OWASP_API_OBJECT_AUTHORIZATION_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "OWASP_API_OBJECT_AUTHORIZATION_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_CONTEXT_INCOMPLETE", input);
  if (e.tenant_scope_status !== "BOUND") return result("DENY", "TENANT_SCOPE_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_TENANT_SCOPE_REQUIRED", input);
  if (e.object_scope_status !== "BOUND") return result("DENY", "OBJECT_SCOPE_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_OBJECT_SCOPE_REQUIRED", input);
  if (e.scope_relation !== "TENANT_OBJECT_BOUND") return result("DENY", "TENANT_OBJECT_SCOPE_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_TENANT_OBJECT_SCOPE_UNBOUND", input);
  if (e.backend_evidence_status !== "NOT_PROVIDED" || e.backend_evidence_claimed !== false) return result("DENY", "EXTERNAL_BACKEND_EVIDENCE_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_BACKEND_EVIDENCE_FORBIDDEN", input);
  if (e.auditor_role !== "INDEPENDENT_READ_ONLY_AUDITOR" || e.auditor_custody_status !== "BOUND" || e.auditor_write_allowed || e.auditor_backend_access || e.auditor_project_mutation_allowed) return result("DENY", "READ_ONLY_AUDITOR_CUSTODY_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_AUDITOR_CUSTODY_INVALID", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_OWASP_API_API1_OBJECT_AUTHORIZATION_SIDE_EFFECT", "OWASP_API_OBJECT_AUTHORIZATION_OPERATION_FORBIDDEN", input);

  const authority = resolveOwaspApiObjectAuthorizationCanonicalAuthority();
  try { assertOwaspApiObjectAuthorizationCanonicalEvidence(e, authority); } catch (error) {
    const route = error.code?.includes("MODEL") ? "MODEL_POLICY_REFRESH_REQUIRED" : error.code?.includes("SOURCE") || error.code?.includes("STANDARD") ? "SOURCE_REFRESH_REQUIRED" : error.code?.includes("SCOPE") ? "TENANT_OBJECT_SCOPE_REQUIRED" : "TYPED_CONTEXT_REQUIRED";
    return result("DENY", route, error.code ?? "OWASP_API_OBJECT_AUTHORIZATION_CANONICAL_BINDING_INVALID", input);
  }
  if (e.authority_status !== "CURRENT" || e.security_domain !== "OWASP_API_SECURITY_TOP10" || e.control_identity !== "CONTROL.OWASP_API_2023_API1_OBJECT_AUTHORIZATION" || e.control_version !== "1" || e.custody_status !== "BOUND") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_AUTHORITY_UNVERIFIED", input);
  if (e.standard_id !== "source.owasp-api-top10-2023" || e.standard_version !== "2023" || e.standard_edition !== "2023" || e.api_category !== "API1:2023" || e.api_scope !== "BOUND" || e.object_authorization_status !== "BOUND" || e.authorization_boundary_status !== "BOUND") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_STANDARD_IDENTITY_INVALID", input);
  if (e.candidate_status !== "CURRENT_CANDIDATE" || e.signal !== "OWASP_API_API1_OBJECT_AUTHORIZATION" || e.signal_status !== "BOUND" || e.task_status !== "OWASP_API_API1_OBJECT_AUTHORIZATION_ANALYSIS" || e.context_status !== "OWASP_API_API1_OBJECT_AUTHORIZATION_CONTEXT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_CONTEXT_BINDING_INVALID", input);
  if (e.model_route_status !== "BOUND") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_MODEL_ROUTE_UNBOUND", input);
  if (!["ANALYZE", "ROUTE"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OWASP_API_OBJECT_AUTHORIZATION_ACTION_INVALID", input);
  return result("ROUTE", "OWASP_API_API1_OBJECT_AUTHORIZATION_ANALYSIS_HANDOFF", "OWASP_API_OBJECT_AUTHORIZATION_ROUTE_READY", input, {
    analysis_allowed: true,
    selected_specialist: "specialist.security.owasp-api-2023-api1-object-authorization",
    handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Run only the named OWASP API API1:2023 Broken Object Level Authorization analysis against externally supplied typed evidence; do not read backend data, decide authorization, mutate policy, or accept this candidate.", execution_instruction: false},
  });
}

