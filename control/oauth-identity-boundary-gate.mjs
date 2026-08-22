#!/usr/bin/env node

/*
 * Read-only OAuth security identity-flow specialist boundary.
 *
 * The entrypoint evaluates only a bounded synthetic OAuth evidence packet. It
 * never handles credentials, contacts an authorization server, changes client
 * registration, writes a project, certifies compliance, or accepts a finding.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const OAUTH_IDENTITY_BOUNDARY_SCHEMA = "agentos.oauth_identity_boundary_input.v1";
export const OAUTH_IDENTITY_RESULT_SCHEMA = "agentos.oauth_identity_boundary_result.v1";
export const OAUTH_IDENTITY_BLOCK_ID = "specialist.security.oauth-identity";
export const OAUTH_IDENTITY_SPECIALIST = OAUTH_IDENTITY_BLOCK_ID;

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const RFC_VERSION = "RFC 9700";
const REQUESTS = new Set([
  "ANALYZE_OAUTH_FLOW", "NOT_APPLICABLE", "UNRELATED_REQUEST", "CONFIGURE_CLIENT",
  "CHANGE_REDIRECT_URI", "ISSUE_TOKEN", "ROTATE_SECRET", "DEPLOY_IDENTITY",
  "PUBLISH_POLICY", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW", "CERTIFY_SECURITY",
]);
const FORBIDDEN_REQUESTS = new Set([
  "CONFIGURE_CLIENT", "CHANGE_REDIRECT_URI", "ISSUE_TOKEN", "ROTATE_SECRET",
  "DEPLOY_IDENTITY", "PUBLISH_POLICY", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW",
  "CERTIFY_SECURITY",
]);
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_CONTEXT"]);
const CLIENT_TYPES = new Set(["PUBLIC", "CONFIDENTIAL"]);
const FLOWS = new Set(["AUTHORIZATION_CODE", "DEVICE_AUTHORIZATION", "CLIENT_CREDENTIALS", "REFRESH_TOKEN"]);
const PKCE_METHODS = new Set(["S256", "NONE"]);
const RESPONSE_MODES = new Set(["QUERY", "FORM_POST", "FRAGMENT"]);
const TOKEN_AUTH_METHODS = new Set(["NONE", "CLIENT_SECRET_BASIC", "CLIENT_SECRET_POST", "PRIVATE_KEY_JWT"]);
const MITIGATION_STATUSES = new Set(["EVIDENCED", "MISSING", "UNKNOWN", "NOT_APPLICABLE"]);
const FLAG_KEYS = new Set([
  "authority_conflict", "scope_expanded", "cross_provider", "duplicate_authority",
  "umbrella_authority", "false_positive", "stale_source", "unsupported_tool",
  "missing_context", "unsafe_action",
]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status",
  "source_identity", "source_version", "source_effective_date", "source_retrieved_date",
  "standard_identity", "standard_version", "standard_effective_date", "standard_retrieved_date",
  "publisher_identity", "client_type", "flow", "protocol", "signal", "target_ref",
  "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance",
  "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present",
  "applicability_status", "applicability_complete", "flow_evidence", "oauth_context", "threats",
  "candidate_digest", "block_revision", "source_manifest_sha256", "source_content_sha256",
  "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256",
  "upstream_router_result_sha256", "memory_binding", "adversarial_flags",
]);
const REQUIRED_FIELDS = Object.freeze([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status",
  "source_identity", "source_version", "source_effective_date", "source_retrieved_date",
  "standard_identity", "standard_version", "standard_effective_date", "standard_retrieved_date",
  "publisher_identity", "client_type", "flow", "protocol", "signal", "target_ref",
  "context_complete", "scope", "requested_action", "requested_tools", "applicability_status",
  "applicability_complete", "flow_evidence", "oauth_context", "threats", "candidate_digest",
  "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256",
  "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding",
]);

function fail(message, code = "OAUTH_IDENTITY_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exactKeys(value, allowed, label, code = "OAUTH_IDENTITY_SHAPE_INVALID") {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, code);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "OAUTH_IDENTITY_UNKNOWN_FIELD");
}

function bounded(value, label, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be bounded`, "OAUTH_IDENTITY_FIELD_INVALID");
}

function safeId(value, label) {
  bounded(value, label);
  assert(SAFE_ID.test(value), `${label} is not canonical`, "OAUTH_IDENTITY_ID_INVALID");
}

function opaqueRef(value, label) {
  bounded(value, label);
  assert(OPAQUE_REF.test(value), `${label} is not opaque`, "OAUTH_IDENTITY_REF_INVALID");
}

function hash(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "OAUTH_IDENTITY_DIGEST_INVALID");
}

function date(value, label) {
  bounded(value, label, 20);
  assert(DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "OAUTH_IDENTITY_DATE_INVALID");
}

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: OAUTH_IDENTITY_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    routing_allowed: false,
    acceptance_allowed: false,
    external_side_effects: {
      specialist_invocations: 0,
      source_reads: 0,
      authorization_server_reads: 0,
      credential_accesses: 0,
      project_writes: 0,
      state_changes: 0,
    },
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateOAuthContext(value) {
  exactKeys(value, new Set([
    "client_type", "flow", "protocol", "authorization_server_ref", "redirect_uri_count",
    "pkce_method", "response_mode", "token_endpoint_auth_method", "scope_count", "context_digest",
  ]), "oauth_context");
  assert(typeof value.client_type === "string" && CLIENT_TYPES.has(value.client_type), "oauth_context.client_type is invalid", "OAUTH_IDENTITY_CONTEXT_INVALID");
  assert(typeof value.flow === "string" && FLOWS.has(value.flow), "oauth_context.flow is invalid", "OAUTH_IDENTITY_CONTEXT_INVALID");
  assert(value.protocol === "OAUTH2", "oauth_context.protocol is invalid", "OAUTH_IDENTITY_PROTOCOL_INVALID");
  opaqueRef(value.authorization_server_ref, "oauth_context.authorization_server_ref");
  assert(Number.isInteger(value.redirect_uri_count) && value.redirect_uri_count >= 0 && value.redirect_uri_count <= 16, "oauth_context.redirect_uri_count is invalid", "OAUTH_IDENTITY_REDIRECT_URI_INVALID");
  assert(typeof value.pkce_method === "string" && PKCE_METHODS.has(value.pkce_method), "oauth_context.pkce_method is invalid", "OAUTH_IDENTITY_PKCE_INVALID");
  assert(typeof value.response_mode === "string" && RESPONSE_MODES.has(value.response_mode), "oauth_context.response_mode is invalid", "OAUTH_IDENTITY_RESPONSE_MODE_INVALID");
  assert(typeof value.token_endpoint_auth_method === "string" && TOKEN_AUTH_METHODS.has(value.token_endpoint_auth_method), "oauth_context.token_endpoint_auth_method is invalid", "OAUTH_IDENTITY_TOKEN_AUTH_INVALID");
  assert(Number.isInteger(value.scope_count) && value.scope_count >= 0 && value.scope_count <= 64, "oauth_context.scope_count is invalid", "OAUTH_IDENTITY_SCOPE_COUNT_INVALID");
  hash(value.context_digest, "oauth_context.context_digest");
}

function validateThreat(value, index) {
  exactKeys(value, new Set(["threat_id", "mitigation_status", "requirement_refs", "evidence_ref"]), `threats[${index}]`);
  safeId(value.threat_id, `threats[${index}].threat_id`);
  assert(typeof value.mitigation_status === "string" && MITIGATION_STATUSES.has(value.mitigation_status), `threats[${index}].mitigation_status is invalid`, "OAUTH_IDENTITY_THREAT_INVALID");
  assert(Array.isArray(value.requirement_refs) && value.requirement_refs.length > 0 && value.requirement_refs.length <= 8, `threats[${index}].requirement_refs is invalid`, "OAUTH_IDENTITY_THREAT_INVALID");
  for (const requirement of value.requirement_refs) safeId(requirement, `threats[${index}].requirement_ref`);
  opaqueRef(value.evidence_ref, `threats[${index}].evidence_ref`);
}

function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, "OAuth identity evidence");
  for (const key of [
    "authority_status", "custody_status", "source_status", "source_identity", "source_version",
    "standard_identity", "standard_version", "publisher_identity", "client_type", "flow", "protocol",
    "signal", "target_ref", "scope", "requested_action", "applicability_status", "flow_evidence",
    "block_revision", "memory_binding",
  ]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.custody_owner !== undefined) safeId(evidence.custody_owner, "evidence.custody_owner");
  if (evidence.custody_ref !== undefined) opaqueRef(evidence.custody_ref, "evidence.custody_ref");
  for (const key of ["source_effective_date", "source_retrieved_date", "standard_retrieved_date"]) if (evidence[key] !== undefined) date(evidence[key], `evidence.${key}`);
  if (evidence.standard_effective_date !== undefined && evidence.standard_effective_date !== null) date(evidence.standard_effective_date, "evidence.standard_effective_date");
  if (evidence.requested_tools !== undefined) {
    assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "evidence.requested_tools is not bounded", "OAUTH_IDENTITY_TOOL_LIST_INVALID");
    for (const tool of evidence.requested_tools) bounded(tool, "evidence.requested_tool", 60);
  }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_complete"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `evidence.${key} must be boolean`, "OAUTH_IDENTITY_BOOLEAN_INVALID");
  if (evidence.adversarial_flags !== undefined) {
    exactKeys(evidence.adversarial_flags, FLAG_KEYS, "evidence.adversarial_flags");
    for (const [key, value] of Object.entries(evidence.adversarial_flags)) assert(typeof value === "boolean", `evidence.adversarial_flags.${key} must be boolean`, "OAUTH_IDENTITY_BOOLEAN_INVALID");
  }
  if (evidence.oauth_context !== undefined) validateOAuthContext(evidence.oauth_context);
  if (evidence.threats !== undefined) {
    assert(Array.isArray(evidence.threats) && evidence.threats.length <= 32, "threats is not bounded", "OAUTH_IDENTITY_THREAT_LIST_INVALID");
    evidence.threats.forEach(validateThreat);
    assert(new Set(evidence.threats.map((threat) => threat.threat_id)).size === evidence.threats.length, "threat identifiers are duplicated", "OAUTH_IDENTITY_THREAT_ALIAS");
  }
  for (const key of ["candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256"]) if (evidence[key] !== undefined) hash(evidence[key], `evidence.${key}`);
  if (evidence.source_content_sha256 !== undefined) hash(evidence.source_content_sha256, "evidence.source_content_sha256", {nullable: true});
  if (evidence.memory_binding !== undefined) assert(evidence.memory_binding === "TYPED_CONTEXT_INVALIDATION_V1", "memory binding is not canonical", "OAUTH_IDENTITY_MEMORY_BINDING_INVALID");
  assert(scanPersistedRecord({schema: OAUTH_IDENTITY_BOUNDARY_SCHEMA, version: 1, evidence}).safe, "OAuth identity evidence contains protected data", "OAUTH_IDENTITY_PRIVACY_DENIED");
}

function missing(evidence) {
  return REQUIRED_FIELDS.filter((key) => evidence[key] === undefined || evidence[key] === "");
}

export function evaluateOAuthIdentityBoundary(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "OAuth identity input");
  assert(input.schema === OAUTH_IDENTITY_BOUNDARY_SCHEMA && input.version === 1, "OAuth identity schema mismatch", "OAUTH_IDENTITY_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "OAuth identity request kind is not recognized", "OAUTH_IDENTITY_REQUEST_INVALID");
  validateEvidence(input.evidence);
  const evidence = input.evidence;
  const flags = evidence.adversarial_flags ?? {};

  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || flags.false_positive === true) return result("DENY", "NO_OAUTH_IDENTITY_SCOPE", "OAUTH_IDENTITY_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_IDENTITY_SIDE_EFFECT", "OAUTH_IDENTITY_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "OAUTH_IDENTITY_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || flags.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "OAUTH_IDENTITY_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED" || flags.scope_expanded === true) return result("DENY", "NARROW_SCOPE_REQUIRED", "OAUTH_IDENTITY_SCOPE_EXPANSION_FORBIDDEN", input);
  if (flags.duplicate_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OAUTH_IDENTITY_SIBLING_SUBSTITUTION_FORBIDDEN", input);
  if (flags.umbrella_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OAUTH_IDENTITY_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (flags.cross_provider === true) return result("DENY", "SOURCE_REFRESH_REQUIRED", "OAUTH_IDENTITY_STANDARD_IDENTITY_INVALID", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "OAUTH_IDENTITY_PROTECTED_DATA_FORBIDDEN", input);
  if (flags.stale_source === true || evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OAUTH_IDENTITY_SOURCE_STALE_OR_UNVERIFIED", input);
  if (flags.unsupported_tool === true || (Array.isArray(evidence.requested_tools) && evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool)))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "OAUTH_IDENTITY_TOOL_SCOPE_FORBIDDEN", input);
  if (flags.missing_context === true || evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OAUTH_IDENTITY_CONTEXT_INCOMPLETE", input, {missing_fields: missing(evidence)});
  const absent = missing(evidence);
  if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OAUTH_IDENTITY_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.SECURITY_OAUTH_IDENTITY") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "OAUTH_IDENTITY_AUTHORITY_UNVERIFIED", input);
  if (evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OAUTH_IDENTITY_SOURCE_IDENTITY_INVALID", input);
  if (evidence.standard_identity !== "source.rfc-9700" || evidence.standard_version !== RFC_VERSION || evidence.publisher_identity !== "IETF" || evidence.standard_effective_date !== null) return result("DENY", "SOURCE_REFRESH_REQUIRED", "OAUTH_IDENTITY_STANDARD_IDENTITY_INVALID", input);
  if (evidence.client_type !== "PUBLIC" || evidence.flow !== "AUTHORIZATION_CODE" || evidence.protocol !== "OAUTH2" || evidence.signal !== "OAUTH") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OAUTH_IDENTITY_FLOW_IDENTITY_INVALID", input);
  if (evidence.target_ref !== OAUTH_IDENTITY_BLOCK_ID) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OAUTH_IDENTITY_TARGET_MISMATCH", input);
  if (evidence.scope !== "NARROW" || evidence.requested_action !== "ANALYZE_OAUTH_FLOW") return result("DENY", "NARROW_SCOPE_REQUIRED", "OAUTH_IDENTITY_SCOPE_INVALID", input);
  if (evidence.applicability_status !== "EXTERNAL_TYPED" || evidence.applicability_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OAUTH_IDENTITY_APPLICABILITY_INCOMPLETE", input);
  if (evidence.flow_evidence !== "BOUNDED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OAUTH_IDENTITY_EVIDENCE_UNBOUNDED", input);
  if (evidence.oauth_context.client_type !== evidence.client_type || evidence.oauth_context.flow !== evidence.flow || evidence.oauth_context.protocol !== evidence.protocol || evidence.oauth_context.pkce_method !== "S256" || evidence.oauth_context.redirect_uri_count !== 1) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OAUTH_IDENTITY_FLOW_CONTEXT_INCOMPLETE", input);
  if (evidence.threats.length === 0 || evidence.threats.some((threat) => threat.mitigation_status === "MISSING")) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OAUTH_IDENTITY_MITIGATION_EVIDENCE_INCOMPLETE", input);

  return result("ROUTE", "OAUTH_IDENTITY_SPECIALIST_HANDOFF", "OAUTH_IDENTITY_ROUTE_READY", input, {
    routing_allowed: true,
    selected_specialist: OAUTH_IDENTITY_SPECIALIST,
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the supplied bounded OAuth authorization-flow evidence against RFC 9700; do not handle credentials, mutate client registration, or certify compliance.",
      execution_instruction: false,
    },
  });
}

export const evaluateOauthIdentityBoundary = evaluateOAuthIdentityBoundary;

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(process.argv[2] ?? "null");
  process.stdout.write(`${JSON.stringify(evaluateOAuthIdentityBoundary(input), null, 2)}\n`);
}
