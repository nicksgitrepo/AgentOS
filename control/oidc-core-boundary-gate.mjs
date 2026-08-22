#!/usr/bin/env node

/* Read-only OpenID Connect Core 1.0 claims specialist boundary. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const OIDC_CORE_BOUNDARY_SCHEMA = "agentos.oidc_core_boundary_input.v1";
export const OIDC_CORE_RESULT_SCHEMA = "agentos.oidc_core_result.v1";
export const OIDC_CORE_BLOCK_ID = "specialist.security.oidc-core";
export const OIDC_CORE_SPECIALIST = OIDC_CORE_BLOCK_ID;

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const REQUESTS = new Set([
  "ANALYZE_OIDC_CLAIMS", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REGISTER_CLIENT", "ISSUE_TOKEN",
  "MANAGE_ACCOUNT", "CHANGE_CLAIMS", "DEPLOY_IDENTITY", "PUBLISH_POLICY", "WRITE_PROJECT", "ACCEPT",
  "SELF_REVIEW", "CERTIFY_IDENTITY",
]);
const FORBIDDEN_REQUESTS = new Set([
  "REGISTER_CLIENT", "ISSUE_TOKEN", "MANAGE_ACCOUNT", "CHANGE_CLAIMS", "DEPLOY_IDENTITY", "PUBLISH_POLICY",
  "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW", "CERTIFY_IDENTITY",
]);
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_CONTEXT"]);
const CLIENT_TYPES = new Set(["PUBLIC", "CONFIDENTIAL"]);
const FLOWS = new Set(["AUTHORIZATION_CODE", "IMPLICIT", "HYBRID"]);
const RESPONSE_TYPES = new Set(["CODE", "ID_TOKEN", "CODE_ID_TOKEN", "CODE_ID_TOKEN_TOKEN"]);
const RESPONSE_MODES = new Set(["QUERY", "FORM_POST", "FRAGMENT"]);
const CLAIM_SOURCES = new Set(["ID_TOKEN", "USERINFO"]);
const CLAIM_STATUSES = new Set(["EVIDENCED", "MISSING", "UNKNOWN", "NOT_APPLICABLE"]);
const FLAG_KEYS = new Set([
  "authority_conflict", "scope_expanded", "cross_provider", "duplicate_authority", "umbrella_authority",
  "false_positive", "stale_source", "unsupported_tool", "missing_context", "unsafe_action", "issuer_mismatch",
  "claims_unverified",
]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity",
  "source_version", "source_effective_date", "source_retrieved_date", "standard_identity", "standard_version",
  "standard_effective_date", "standard_retrieved_date", "publisher_identity", "issuer_ref", "client_type", "flow",
  "protocol", "response_type", "response_mode", "claims_profile", "signal", "target_ref", "context_complete", "scope",
  "requested_action", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present",
  "secret_data_present", "applicability_status", "applicability_complete", "claims_evidence_status", "oidc_context", "claims",
  "candidate_digest", "block_revision", "source_manifest_sha256", "source_content_sha256", "standard_block_sha256",
  "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding", "adversarial_flags",
]);
const REQUIRED_FIELDS = Object.freeze([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
  "source_effective_date", "source_retrieved_date", "standard_identity", "standard_version", "standard_effective_date",
  "standard_retrieved_date", "publisher_identity", "issuer_ref", "client_type", "flow", "protocol", "response_type",
  "response_mode", "claims_profile", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools",
  "applicability_status", "applicability_complete", "claims_evidence_status", "oidc_context", "claims", "candidate_digest",
  "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256",
  "memory_binding",
]);

function fail(message, code = "OIDC_CORE_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, label, code = "OIDC_CORE_SHAPE_INVALID") {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, code);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "OIDC_CORE_UNKNOWN_FIELD");
}
function bounded(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be bounded`, "OIDC_CORE_FIELD_INVALID"); }
function safeId(value, label) { bounded(value, label); assert(SAFE_ID.test(value), `${label} is not canonical`, "OIDC_CORE_ID_INVALID"); }
function opaqueRef(value, label) { bounded(value, label); assert(OPAQUE_REF.test(value), `${label} is not opaque`, "OIDC_CORE_REF_INVALID"); }
function hash(value, label, {nullable = false} = {}) { if (nullable && value === null) return; assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "OIDC_CORE_DIGEST_INVALID"); }
function date(value, label) { bounded(value, label, 20); assert(DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "OIDC_CORE_DATE_INVALID"); }

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: OIDC_CORE_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    routing_allowed: false,
    acceptance_allowed: false,
    external_side_effects: {
      specialist_invocations: 0,
      source_reads: 0,
      issuer_metadata_reads: 0,
      credential_accesses: 0,
      account_mutations: 0,
      project_writes: 0,
      state_changes: 0,
    },
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateOidcContext(value) {
  exactKeys(value, new Set([
    "issuer_ref", "client_type", "flow", "protocol", "response_type", "response_mode", "scope_values", "claims_requested",
    "claims_present", "nonce_present", "issuer_claims_digest", "id_token_alg", "id_token_signing_verified", "context_digest",
  ]), "oidc_context");
  opaqueRef(value.issuer_ref, "oidc_context.issuer_ref");
  assert(typeof value.client_type === "string" && CLIENT_TYPES.has(value.client_type), "oidc_context.client_type is invalid", "OIDC_CORE_CONTEXT_INVALID");
  assert(typeof value.flow === "string" && FLOWS.has(value.flow), "oidc_context.flow is invalid", "OIDC_CORE_CONTEXT_INVALID");
  assert(value.protocol === "OIDC", "oidc_context.protocol is invalid", "OIDC_CORE_PROTOCOL_INVALID");
  assert(typeof value.response_type === "string" && RESPONSE_TYPES.has(value.response_type), "oidc_context.response_type is invalid", "OIDC_CORE_RESPONSE_TYPE_INVALID");
  assert(typeof value.response_mode === "string" && RESPONSE_MODES.has(value.response_mode), "oidc_context.response_mode is invalid", "OIDC_CORE_RESPONSE_MODE_INVALID");
  for (const key of ["scope_values", "claims_requested", "claims_present"]) {
    assert(Array.isArray(value[key]) && value[key].length > 0 && value[key].length <= 16, `oidc_context.${key} is invalid`, "OIDC_CORE_CONTEXT_LIST_INVALID");
    for (const item of value[key]) bounded(item, `oidc_context.${key} item`, 80);
    assert(new Set(value[key]).size === value[key].length, `oidc_context.${key} contains duplicates`, "OIDC_CORE_CONTEXT_ALIAS");
  }
  assert(value.scope_values.includes("openid"), "oidc_context.scope_values omits openid", "OIDC_CORE_SCOPE_INVALID");
  assert(typeof value.nonce_present === "boolean", "oidc_context.nonce_present is invalid", "OIDC_CORE_BOOLEAN_INVALID");
  opaqueRef(value.issuer_claims_digest, "oidc_context.issuer_claims_digest");
  bounded(value.id_token_alg, "oidc_context.id_token_alg", 40);
  assert(typeof value.id_token_signing_verified === "boolean", "oidc_context.id_token_signing_verified is invalid", "OIDC_CORE_BOOLEAN_INVALID");
  hash(value.context_digest, "oidc_context.context_digest");
  assert(value.context_digest === canonicalDigest({...value, context_digest: null}), "oidc_context.context_digest is not self-consistent", "OIDC_CORE_CONTEXT_DIGEST_INVALID");
}

function validateClaim(value, index) {
  exactKeys(value, new Set(["claim_id", "source", "validation_status", "evidence_ref"]), `claims[${index}]`);
  safeId(value.claim_id, `claims[${index}].claim_id`);
  assert(typeof value.source === "string" && CLAIM_SOURCES.has(value.source), `claims[${index}].source is invalid`, "OIDC_CORE_CLAIM_INVALID");
  assert(typeof value.validation_status === "string" && CLAIM_STATUSES.has(value.validation_status), `claims[${index}].validation_status is invalid`, "OIDC_CORE_CLAIM_INVALID");
  opaqueRef(value.evidence_ref, `claims[${index}].evidence_ref`);
}

function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, "OIDC Core evidence");
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "standard_identity", "standard_version", "publisher_identity", "issuer_ref", "client_type", "flow", "protocol", "response_type", "response_mode", "claims_profile", "signal", "target_ref", "scope", "requested_action", "applicability_status", "claims_evidence_status", "block_revision", "memory_binding"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.custody_owner !== undefined) safeId(evidence.custody_owner, "evidence.custody_owner");
  if (evidence.custody_ref !== undefined) opaqueRef(evidence.custody_ref, "evidence.custody_ref");
  for (const key of ["source_effective_date", "source_retrieved_date", "standard_effective_date", "standard_retrieved_date"]) if (evidence[key] !== null && evidence[key] !== undefined) date(evidence[key], `evidence.${key}`);
  if (evidence.requested_tools !== undefined) {
    assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "evidence.requested_tools is not bounded", "OIDC_CORE_TOOL_LIST_INVALID");
    for (const tool of evidence.requested_tools) bounded(tool, "evidence.requested_tool", 60);
  }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_complete"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `evidence.${key} must be boolean`, "OIDC_CORE_BOOLEAN_INVALID");
  if (evidence.adversarial_flags !== undefined) {
    exactKeys(evidence.adversarial_flags, FLAG_KEYS, "evidence.adversarial_flags");
    for (const [key, value] of Object.entries(evidence.adversarial_flags)) assert(typeof value === "boolean", `evidence.adversarial_flags.${key} must be boolean`, "OIDC_CORE_BOOLEAN_INVALID");
  }
  if (evidence.oidc_context !== undefined) validateOidcContext(evidence.oidc_context);
  if (evidence.claims !== undefined) {
    assert(Array.isArray(evidence.claims) && evidence.claims.length <= 32, "claims is not bounded", "OIDC_CORE_CLAIM_LIST_INVALID");
    evidence.claims.forEach(validateClaim);
    assert(new Set(evidence.claims.map((claim) => claim.claim_id)).size === evidence.claims.length, "claim identifiers are duplicated", "OIDC_CORE_CLAIM_ALIAS");
  }
  for (const key of ["candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256"]) if (evidence[key] !== undefined) hash(evidence[key], `evidence.${key}`);
  if (evidence.source_content_sha256 !== undefined) hash(evidence.source_content_sha256, "evidence.source_content_sha256", {nullable: true});
  assert(scanPersistedRecord({schema: OIDC_CORE_BOUNDARY_SCHEMA, version: 1, evidence}).safe, "OIDC Core evidence contains protected data", "OIDC_CORE_PRIVACY_DENIED");
}

function missing(evidence) { return REQUIRED_FIELDS.filter((key) => evidence[key] === undefined || evidence[key] === ""); }

export function evaluateOidcCoreBoundary(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "OIDC Core input");
  assert(input.schema === OIDC_CORE_BOUNDARY_SCHEMA && input.version === 1, "OIDC Core schema mismatch", "OIDC_CORE_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "OIDC Core request kind is not recognized", "OIDC_CORE_REQUEST_INVALID");
  validateEvidence(input.evidence);
  const evidence = input.evidence;
  const flags = evidence.adversarial_flags ?? {};
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || flags.false_positive === true) return result("DENY", "NO_OIDC_CORE_SCOPE", "OIDC_CORE_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_OIDC_CORE_SIDE_EFFECT", "OIDC_CORE_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "OIDC_CORE_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || flags.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "OIDC_CORE_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED" || flags.scope_expanded === true) return result("DENY", "NARROW_SCOPE_REQUIRED", "OIDC_CORE_SCOPE_EXPANSION_FORBIDDEN", input);
  if (flags.duplicate_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OIDC_CORE_SIBLING_SUBSTITUTION_FORBIDDEN", input);
  if (flags.umbrella_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OIDC_CORE_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (flags.cross_provider === true) return result("DENY", "SOURCE_REFRESH_REQUIRED", "OIDC_CORE_STANDARD_IDENTITY_INVALID", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "OIDC_CORE_PROTECTED_DATA_FORBIDDEN", input);
  if (flags.stale_source === true || evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OIDC_CORE_SOURCE_STALE_OR_UNVERIFIED", input);
  if (flags.unsupported_tool === true || (Array.isArray(evidence.requested_tools) && evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool)))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "OIDC_CORE_TOOL_SCOPE_FORBIDDEN", input);
  if (flags.missing_context === true || evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OIDC_CORE_CONTEXT_INCOMPLETE", input, {missing_fields: missing(evidence)});
  const absent = missing(evidence);
  if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OIDC_CORE_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.SECURITY_OIDC_CORE") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "OIDC_CORE_AUTHORITY_UNVERIFIED", input);
  if (evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OIDC_CORE_SOURCE_IDENTITY_INVALID", input);
  if (evidence.standard_identity !== "source.oidc-core-1-0" || evidence.standard_version !== "1.0" || evidence.publisher_identity !== "OpenID Foundation" || evidence.standard_effective_date !== "2014-11-08") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OIDC_CORE_STANDARD_IDENTITY_INVALID", input);
  if (evidence.issuer_ref !== "opaque:OIDC.ISSUER.SYNTHETIC" || evidence.client_type !== "PUBLIC" || evidence.flow !== "AUTHORIZATION_CODE" || evidence.protocol !== "OIDC" || evidence.response_type !== "CODE" || evidence.response_mode !== "QUERY" || evidence.signal !== "OIDC") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OIDC_CORE_FLOW_IDENTITY_INVALID", input);
  if (flags.issuer_mismatch === true) return result("DENY", "SOURCE_REFRESH_REQUIRED", "OIDC_CORE_ISSUER_IDENTITY_INVALID", input);
  if (evidence.target_ref !== OIDC_CORE_BLOCK_ID) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OIDC_CORE_TARGET_MISMATCH", input);
  if (evidence.scope !== "NARROW" || evidence.requested_action !== "ANALYZE_OIDC_CLAIMS") return result("DENY", "NARROW_SCOPE_REQUIRED", "OIDC_CORE_SCOPE_INVALID", input);
  if (evidence.applicability_status !== "EXTERNAL_TYPED" || evidence.applicability_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OIDC_CORE_APPLICABILITY_INCOMPLETE", input);
  if (evidence.claims_evidence_status !== "BOUNDED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OIDC_CORE_CLAIMS_EVIDENCE_UNBOUNDED", input);
  const context = evidence.oidc_context;
  if (context.issuer_ref !== evidence.issuer_ref || context.client_type !== evidence.client_type || context.flow !== evidence.flow || context.protocol !== evidence.protocol || context.response_type !== evidence.response_type || context.response_mode !== evidence.response_mode || context.nonce_present !== true || context.id_token_alg !== "RS256" || context.id_token_signing_verified !== true || flags.claims_unverified === true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OIDC_CORE_CLAIMS_CONTEXT_INCOMPLETE", input);
  const requiredClaims = new Set(["SUB", "ISS", "AUD", "EXP"]);
  if (evidence.claims.length === 0 || [...requiredClaims].some((claim) => !evidence.claims.some((entry) => entry.claim_id === claim && entry.validation_status === "EVIDENCED")) || evidence.claims.some((claim) => claim.validation_status === "MISSING" || claim.validation_status === "UNKNOWN")) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OIDC_CORE_CLAIMS_EVIDENCE_INCOMPLETE", input);
  return result("ROUTE", "OIDC_CORE_SPECIALIST_HANDOFF", "OIDC_CORE_ROUTE_READY", input, {
    routing_allowed: true,
    selected_specialist: OIDC_CORE_SPECIALIST,
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the supplied bounded OpenID Connect Core 1.0 issuer and claims evidence; do not handle credentials, mutate accounts, or certify identity.",
      execution_instruction: false,
    },
  });
}

export const evaluateOIDCCoreBoundary = evaluateOidcCoreBoundary;

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(evaluateOidcCoreBoundary(JSON.parse(process.argv[2] ?? "null")), null, 2)}\n`);
