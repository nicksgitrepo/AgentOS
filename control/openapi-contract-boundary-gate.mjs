#!/usr/bin/env node

/*
 * Read-only OpenAPI contract specialist boundary.
 *
 * The public entrypoint consumes only a bounded synthetic evidence packet. It
 * never fetches a contract, writes Product or project state, selects an
 * implementation, accesses credentials, or certifies applicability.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const OPENAPI_CONTRACT_BOUNDARY_SCHEMA = "agentos.openapi_contract_boundary_input.v1";
export const OPENAPI_CONTRACT_RESULT_SCHEMA = "agentos.openapi_contract_boundary_result.v1";
export const OPENAPI_CONTRACT_BLOCK_ID = "specialist.product-client.openapi-contracts";
export const OPENAPI_CONTRACT_SPECIALIST = OPENAPI_CONTRACT_BLOCK_ID;

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const OPENAPI_VERSION = "3.1.1";
const REQUESTS = new Set([
  "ANALYZE_OPENAPI_CONTRACT", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "CREATE_API", "UPDATE_API", "DELETE_API", "DEPLOY_API", "PUBLISH_API",
  "WRITE_PRODUCT", "ACCEPT", "SELF_REVIEW", "CERTIFY_CONTRACT",
]);
const FORBIDDEN_REQUESTS = new Set([
  "CREATE_API", "UPDATE_API", "DELETE_API", "DEPLOY_API", "PUBLISH_API",
  "WRITE_PRODUCT", "ACCEPT", "SELF_REVIEW", "CERTIFY_CONTRACT",
]);
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_CONTEXT"]);
const METHODS = new Set(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);
const SCHEMA_TYPES = new Set(["array", "boolean", "integer", "number", "object", "string"]);
const FLAG_KEYS = new Set([
  "authority_conflict", "scope_expanded", "cross_provider", "duplicate_authority",
  "umbrella_authority", "false_positive", "stale_source", "unsupported_tool",
  "missing_context", "unsafe_action",
]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref",
  "source_status", "source_identity", "source_version", "source_effective_date",
  "source_retrieved_date", "standard_identity", "standard_version",
  "standard_effective_date", "standard_retrieved_date", "publisher_identity",
  "contract_identity", "contract_version", "openapi_version", "signal", "target_ref",
  "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance",
  "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present",
  "applicability_status", "applicability_complete", "contract_evidence", "api_contract",
  "operations", "schemas", "candidate_digest", "block_revision", "source_manifest_sha256",
  "source_content_sha256", "standard_block_sha256", "model_snapshot_sha256",
  "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding",
  "adversarial_flags",
]);
const REQUIRED_FIELDS = Object.freeze([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status",
  "source_identity", "source_version", "source_effective_date", "source_retrieved_date",
  "standard_identity", "standard_version", "standard_effective_date", "standard_retrieved_date",
  "publisher_identity", "contract_identity", "contract_version", "openapi_version", "signal",
  "target_ref", "context_complete", "scope", "requested_action", "requested_tools",
  "applicability_status", "applicability_complete", "contract_evidence", "api_contract",
  "operations", "schemas", "candidate_digest", "source_manifest_sha256", "standard_block_sha256",
  "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding",
]);

function fail(message, code = "OPENAPI_CONTRACT_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exactKeys(value, allowed, label, code = "OPENAPI_CONTRACT_SHAPE_INVALID") {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, code);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "OPENAPI_CONTRACT_UNKNOWN_FIELD");
}

function bounded(value, label, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be bounded`, "OPENAPI_CONTRACT_FIELD_INVALID");
}

function safeId(value, label) {
  bounded(value, label);
  assert(SAFE_ID.test(value), `${label} is not canonical`, "OPENAPI_CONTRACT_ID_INVALID");
}

function opaqueRef(value, label) {
  bounded(value, label);
  assert(OPAQUE_REF.test(value), `${label} is not opaque`, "OPENAPI_CONTRACT_REF_INVALID");
}

function hash(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "OPENAPI_CONTRACT_DIGEST_INVALID");
}

function date(value, label) {
  bounded(value, label, 20);
  assert(DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "OPENAPI_CONTRACT_DATE_INVALID");
}

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: OPENAPI_CONTRACT_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    routing_allowed: false,
    acceptance_allowed: false,
    external_side_effects: {
      specialist_invocations: 0,
      contract_reads: 0,
      product_mutations: 0,
      project_writes: 0,
      credential_accesses: 0,
      state_changes: 0,
    },
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateOperation(value, index) {
  exactKeys(value, new Set(["method", "path", "operation_id", "response_statuses"]), `operations[${index}]`);
  assert(typeof value.method === "string" && METHODS.has(value.method), `operations[${index}].method is invalid`, "OPENAPI_CONTRACT_OPERATION_INVALID");
  bounded(value.path, `operations[${index}].path`, 253);
  assert(value.path.startsWith("/"), `operations[${index}].path must be absolute`, "OPENAPI_CONTRACT_OPERATION_INVALID");
  safeId(value.operation_id, `operations[${index}].operation_id`);
  assert(Array.isArray(value.response_statuses) && value.response_statuses.length > 0 && value.response_statuses.length <= 8, `operations[${index}].response_statuses is invalid`, "OPENAPI_CONTRACT_OPERATION_INVALID");
  for (const status of value.response_statuses) {
    bounded(status, `operations[${index}].response_status`, 3);
    assert(/^\d{3}$/u.test(status), `operations[${index}].response_status is invalid`, "OPENAPI_CONTRACT_OPERATION_INVALID");
  }
}

function validateSchema(value, index) {
  exactKeys(value, new Set(["name", "type", "required"]), `schemas[${index}]`);
  safeId(value.name, `schemas[${index}].name`);
  assert(typeof value.type === "string" && SCHEMA_TYPES.has(value.type), `schemas[${index}].type is invalid`, "OPENAPI_CONTRACT_SCHEMA_INVALID");
  assert(Array.isArray(value.required) && value.required.length <= 32, `schemas[${index}].required is invalid`, "OPENAPI_CONTRACT_SCHEMA_INVALID");
  for (const name of value.required) safeId(name, `schemas[${index}].required`);
}

function validateContract(value) {
  exactKeys(value, new Set(["contract_ref", "openapi_version", "server_count", "operation_count", "schema_count", "contract_digest"]), "api_contract");
  opaqueRef(value.contract_ref, "api_contract.contract_ref");
  bounded(value.openapi_version, "api_contract.openapi_version", 16);
  assert(value.openapi_version === OPENAPI_VERSION, "api_contract.openapi_version is not OpenAPI 3.1.1", "OPENAPI_CONTRACT_VERSION_INVALID");
  for (const key of ["server_count", "operation_count", "schema_count"]) assert(Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 64, `api_contract.${key} is invalid`, "OPENAPI_CONTRACT_CONTRACT_INVALID");
  hash(value.contract_digest, "api_contract.contract_digest");
}

function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, "OpenAPI contract evidence");
  for (const key of [
    "authority_status", "custody_status", "source_status", "source_identity", "source_version",
    "standard_identity", "standard_version", "publisher_identity", "contract_version", "openapi_version",
    "signal", "target_ref", "scope", "requested_action", "applicability_status", "contract_evidence",
    "block_revision", "memory_binding",
  ]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.custody_owner !== undefined) safeId(evidence.custody_owner, "evidence.custody_owner");
  if (evidence.custody_ref !== undefined) opaqueRef(evidence.custody_ref, "evidence.custody_ref");
  for (const key of ["source_effective_date", "source_retrieved_date", "standard_effective_date", "standard_retrieved_date"]) if (evidence[key] !== undefined) date(evidence[key], `evidence.${key}`);
  for (const key of ["contract_identity"]) if (evidence[key] !== undefined) opaqueRef(evidence[key], `evidence.${key}`);
  if (evidence.requested_tools !== undefined) {
    assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "evidence.requested_tools is not bounded", "OPENAPI_CONTRACT_TOOL_LIST_INVALID");
    for (const tool of evidence.requested_tools) bounded(tool, "evidence.requested_tool", 60);
  }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_complete"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `evidence.${key} must be boolean`, "OPENAPI_CONTRACT_BOOLEAN_INVALID");
  if (evidence.adversarial_flags !== undefined) {
    exactKeys(evidence.adversarial_flags, FLAG_KEYS, "evidence.adversarial_flags");
    for (const [key, value] of Object.entries(evidence.adversarial_flags)) assert(typeof value === "boolean", `evidence.adversarial_flags.${key} must be boolean`, "OPENAPI_CONTRACT_BOOLEAN_INVALID");
  }
  if (evidence.api_contract !== undefined) validateContract(evidence.api_contract);
  if (evidence.operations !== undefined) {
    assert(Array.isArray(evidence.operations) && evidence.operations.length <= 64, "operations is not bounded", "OPENAPI_CONTRACT_OPERATION_LIST_INVALID");
    evidence.operations.forEach(validateOperation);
  }
  if (evidence.schemas !== undefined) {
    assert(Array.isArray(evidence.schemas) && evidence.schemas.length <= 64, "schemas is not bounded", "OPENAPI_CONTRACT_SCHEMA_LIST_INVALID");
    evidence.schemas.forEach(validateSchema);
  }
  for (const key of [
    "candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256",
    "context_receipt_sha256", "upstream_router_result_sha256",
  ]) if (evidence[key] !== undefined) hash(evidence[key], `evidence.${key}`);
  if (evidence.source_content_sha256 !== undefined) hash(evidence.source_content_sha256, "evidence.source_content_sha256", {nullable: true});
  if (evidence.memory_binding !== undefined) assert(evidence.memory_binding === "TYPED_CONTEXT_INVALIDATION_V1", "memory binding is not canonical", "OPENAPI_CONTRACT_MEMORY_BINDING_INVALID");
  assert(scanPersistedRecord({schema: OPENAPI_CONTRACT_BOUNDARY_SCHEMA, version: 1, evidence}).safe, "OpenAPI contract evidence contains protected data", "OPENAPI_CONTRACT_PRIVACY_DENIED");
}

function missing(evidence) {
  return REQUIRED_FIELDS.filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === "");
}

export function evaluateOpenApiContractBoundary(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "OpenAPI contract input");
  assert(input.schema === OPENAPI_CONTRACT_BOUNDARY_SCHEMA && input.version === 1, "OpenAPI contract schema mismatch", "OPENAPI_CONTRACT_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "OpenAPI contract request kind is not recognized", "OPENAPI_CONTRACT_REQUEST_INVALID");
  validateEvidence(input.evidence);
  const evidence = input.evidence;
  const flags = evidence.adversarial_flags ?? {};

  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || flags.false_positive === true) return result("DENY", "NO_OPENAPI_CONTRACT_SCOPE", "OPENAPI_CONTRACT_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_CONTRACT_SIDE_EFFECT", "OPENAPI_CONTRACT_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "OPENAPI_CONTRACT_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || flags.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "OPENAPI_CONTRACT_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED" || flags.scope_expanded === true) return result("DENY", "NARROW_SCOPE_REQUIRED", "OPENAPI_CONTRACT_SCOPE_EXPANSION_FORBIDDEN", input);
  if (flags.duplicate_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OPENAPI_CONTRACT_SIBLING_SUBSTITUTION_FORBIDDEN", input);
  if (flags.umbrella_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OPENAPI_CONTRACT_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (flags.cross_provider === true) return result("DENY", "SOURCE_REFRESH_REQUIRED", "OPENAPI_CONTRACT_STANDARD_IDENTITY_INVALID", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "OPENAPI_CONTRACT_PROTECTED_DATA_FORBIDDEN", input);
  if (flags.stale_source === true || evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OPENAPI_CONTRACT_SOURCE_STALE_OR_UNVERIFIED", input);
  if (flags.unsupported_tool === true || (Array.isArray(evidence.requested_tools) && evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool)))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "OPENAPI_CONTRACT_TOOL_SCOPE_FORBIDDEN", input);
  if (flags.missing_context === true || evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACT_CONTEXT_INCOMPLETE", input, {missing_fields: missing(evidence)});
  const absent = missing(evidence);
  if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACT_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "OPENAPI_CONTRACT_AUTHORITY_UNVERIFIED", input);
  if (evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OPENAPI_CONTRACT_SOURCE_IDENTITY_INVALID", input);
  if (evidence.standard_identity !== "source.openapi-3-1-1" || evidence.standard_version !== OPENAPI_VERSION || evidence.publisher_identity !== "OPENAPI_INITIATIVE" || evidence.openapi_version !== OPENAPI_VERSION || evidence.contract_version !== OPENAPI_VERSION) return result("DENY", "SOURCE_REFRESH_REQUIRED", "OPENAPI_CONTRACT_STANDARD_IDENTITY_INVALID", input);
  if (evidence.contract_identity !== "opaque:OPENAPI.CONTRACT.SYNTHETIC") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACT_IDENTITY_UNVERIFIED", input);
  if (evidence.target_ref !== OPENAPI_CONTRACT_BLOCK_ID) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OPENAPI_CONTRACT_TARGET_MISMATCH", input);
  if (evidence.signal !== "ARCH.API_CONTRACTS" || evidence.scope !== "NARROW" || evidence.requested_action !== "ANALYZE_CONTRACT") return result("DENY", "NARROW_SCOPE_REQUIRED", "OPENAPI_CONTRACT_SCOPE_INVALID", input);
  if (evidence.applicability_status !== "EXTERNAL_TYPED" || evidence.applicability_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACT_APPLICABILITY_INCOMPLETE", input);
  if (evidence.contract_evidence !== "BOUNDED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACT_EVIDENCE_UNBOUNDED", input);
  if (evidence.api_contract.contract_ref !== evidence.contract_identity || evidence.api_contract.openapi_version !== OPENAPI_VERSION || evidence.api_contract.operation_count !== evidence.operations.length || evidence.api_contract.schema_count !== evidence.schemas.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACT_TRACEABILITY_INCOMPLETE", input);

  return result("ROUTE", "OPENAPI_CONTRACT_SPECIALIST_HANDOFF", "OPENAPI_CONTRACT_ROUTE_READY", input, {
    routing_allowed: true,
    selected_specialist: OPENAPI_CONTRACT_SPECIALIST,
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the supplied bounded OpenAPI 3.1.1 contract evidence; do not write Product state or certify applicability.",
      execution_instruction: false,
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(process.argv[2] ?? "null");
  process.stdout.write(`${JSON.stringify(evaluateOpenApiContractBoundary(input), null, 2)}\n`);
}
