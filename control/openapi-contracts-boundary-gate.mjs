#!/usr/bin/env node

/*
 * Read-only OpenAPI HTTP Contract specialist boundary.
 *
 * This entrypoint accepts only typed, source-bound contract evidence.  It
 * can route a narrow analysis handoff or close the dependent action.  It
 * cannot write a Product, select an implementation, mutate policy, admit a
 * package, or change AgentOS lifecycle state.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const OPENAPI_CONTRACTS_INPUT_SCHEMA = "agentos.openapi_contracts_boundary_input.v1";
export const OPENAPI_CONTRACTS_RESULT_SCHEMA = "agentos.openapi_contracts_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,160}$/u;
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const REQUESTS = new Set([
  "ANALYZE_OPENAPI_CONTRACT", "ROUTE_OPENAPI_CONTRACT", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_CONTRACT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "SELECT_IMPLEMENTATION",
]);
const FORBIDDEN = new Set([
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_CONTRACT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "SELECT_IMPLEMENTATION",
]);
const TOOLS = new Set(["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT", "READ_ROUTER_RECEIPT"]);
const REQUIRED_BLOCKS = Object.freeze([
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
  "specialist.product-client.router",
  "specialist.standard.openapi-3-1-1",
]);
const FLAGS = Object.freeze([
  "authority_conflict", "broad_claim", "cross_provider", "duplicate_authority", "false_positive",
  "missing_context", "self_acceptance", "scope_expanded", "stale_source", "unsupported_tool",
  "unrelated_scope", "unsafe_action", "umbrella_authority",
]);

function fail(message, code = "OPENAPI_CONTRACTS_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(condition, message, code) {
  if (!condition) fail(message, code);
}

function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "OPENAPI_CONTRACTS_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "OPENAPI_CONTRACTS_UNKNOWN_FIELD");
}

function string(value, label, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim(), `${label} is invalid`, "OPENAPI_CONTRACTS_FIELD_INVALID");
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains a control character`, "OPENAPI_CONTRACTS_FIELD_INVALID");
}

function id(value, label) {
  string(value, label);
  assert(ID.test(value), `${label} is not canonical`, "OPENAPI_CONTRACTS_ID_INVALID");
}

function digest(value, label) {
  string(value, label, 64);
  assert(SHA256.test(value), `${label} is not a SHA-256`, "OPENAPI_CONTRACTS_DIGEST_INVALID");
}

function boolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`, "OPENAPI_CONTRACTS_BOOLEAN_INVALID");
}

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: OPENAPI_CONTRACTS_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    analysis_allowed: false,
    acceptance_allowed: false,
    implementation_selection_allowed: false,
    lifecycle_mutation_allowed: false,
    external_side_effects: {
      candidate_reads: 0,
      source_reads: 0,
      context_reads: 0,
      router_receipt_reads: 0,
      protected_data_reads: 0,
      product_writes: 0,
      project_writes: 0,
      memory_writes: 0,
      credential_accesses: 0,
      lifecycle_changes: 0,
      state_changes: 0,
    },
    error_code: errorCode,
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateContractDocument(contract) {
  exact(contract, new Set(["openapi", "info", "paths", "components"]), "contract");
  assert(contract.openapi === "3.1.1", "contract is not OpenAPI 3.1.1", "OPENAPI_CONTRACTS_VERSION_INVALID");
  exact(contract.info, new Set(["title", "version"]), "contract.info");
  string(contract.info.title, "contract.info.title", 160);
  string(contract.info.version, "contract.info.version", 80);
  assert(contract.paths && typeof contract.paths === "object" && !Array.isArray(contract.paths), "contract.paths is invalid", "OPENAPI_CONTRACTS_DOCUMENT_INVALID");
  const paths = Object.entries(contract.paths);
  assert(paths.length > 0, "contract.paths is empty", "OPENAPI_CONTRACTS_DOCUMENT_INVALID");
  for (const [pathName, pathItem] of paths) {
    assert(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/{-]+$/u.test(pathName), `contract path is invalid: ${pathName}`, "OPENAPI_CONTRACTS_PATH_INVALID");
    assert(pathItem && typeof pathItem === "object" && !Array.isArray(pathItem), "contract path item is invalid", "OPENAPI_CONTRACTS_DOCUMENT_INVALID");
    const methods = Object.entries(pathItem).filter(([key]) => HTTP_METHODS.has(key));
    assert(methods.length > 0, "contract path has no HTTP operation", "OPENAPI_CONTRACTS_OPERATION_MISSING");
    for (const [, operation] of methods) {
      exact(operation, new Set(["operationId", "responses"]), "contract operation");
      string(operation.operationId, "contract operationId", 160);
      assert(operation.responses && typeof operation.responses === "object" && !Array.isArray(operation.responses), "contract responses are invalid", "OPENAPI_CONTRACTS_RESPONSE_INVALID");
      assert(Object.keys(operation.responses).length > 0, "contract operation has no response", "OPENAPI_CONTRACTS_RESPONSE_INVALID");
    }
  }
  exact(contract.components, new Set(["schemas"]), "contract.components");
  assert(contract.components.schemas && typeof contract.components.schemas === "object" && !Array.isArray(contract.components.schemas), "contract components.schemas is invalid", "OPENAPI_CONTRACTS_SCHEMA_INVALID");
  assert(Object.keys(contract.components.schemas).length > 0, "contract components.schemas is empty", "OPENAPI_CONTRACTS_SCHEMA_INVALID");
}

function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "OpenAPI contract input");
  assert(input.schema === OPENAPI_CONTRACTS_INPUT_SCHEMA && input.version === 1, "OpenAPI contract schema mismatch", "OPENAPI_CONTRACTS_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "OpenAPI contract request is unknown", "OPENAPI_CONTRACTS_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "source_manifest_sha256", "candidate_status", "candidate_digest", "signal",
    "signal_status", "api_contract", "api_version", "contract_identity", "operation_identity", "operation_path", "operation_method", "schema_identity", "schema_ref", "contract",
    "context_status", "context_complete", "context_sha256", "requested_action", "requested_tools", "required_block_identities",
    "model_policy_status", "model_route_status", "model_task_class", "model_capability_floor", "model_required_capabilities",
    "model_snapshot_sha256", "model_route_sha256", "model_auditor_model", "model_auditor_reasoning_effort", "standard_id",
    "standard_version", "standard_block_sha256", "standard_source_manifest_sha256", "upstream_router_result_sha256",
    "project_data_present", "secret_data_present", "adversarial_flags",
  ]), "OpenAPI contract evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "custody_owner", "source_status", "source_identity", "source_version", "source_effective_date",
    "source_retrieved_date", "candidate_status", "signal", "signal_status", "api_contract", "api_version", "contract_identity",
    "operation_identity", "operation_path", "operation_method", "schema_identity", "schema_ref", "context_status", "requested_action", "model_policy_status", "model_route_status",
    "model_task_class", "standard_id", "standard_version",
  ]) string(e[key], `evidence.${key}`);
  id(e.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(e.custody_ref), "custody reference is not opaque", "OPENAPI_CONTRACTS_CUSTODY_REF_INVALID");
  for (const key of [
    "source_manifest_sha256", "candidate_digest", "context_sha256", "model_snapshot_sha256", "model_route_sha256",
    "standard_block_sha256", "standard_source_manifest_sha256", "upstream_router_result_sha256",
  ]) digest(e[key], `evidence.${key}`);
  assert(e.source_status === "CURRENT_VERIFIED" || e.source_status === "STALE" || e.source_status === "UNVERIFIED", "source status is invalid", "OPENAPI_CONTRACTS_SOURCE_STATUS_INVALID");
  assert(e.api_contract === "OPENAPI_HTTP" && e.api_version === "3.1.1", "API contract identity is not canonical", "OPENAPI_CONTRACTS_CONTRACT_IDENTITY_INVALID");
  assert(OPAQUE_REF.test(e.contract_identity) && OPAQUE_REF.test(e.operation_identity) && OPAQUE_REF.test(e.schema_identity), "contract identity is not opaque", "OPENAPI_CONTRACTS_CONTRACT_IDENTITY_INVALID");
  assert(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/{-]+$/u.test(e.operation_path), "operation path is invalid", "OPENAPI_CONTRACTS_OPERATION_INVALID");
  assert(HTTP_METHODS.has(e.operation_method), "operation method is invalid", "OPENAPI_CONTRACTS_OPERATION_INVALID");
  string(e.schema_ref, "evidence.schema_ref", 200);
  validateContractDocument(e.contract);
  const operation = e.contract.paths[e.operation_path]?.[e.operation_method];
  assert(operation && operation.operationId && e.operation_identity.endsWith(operation.operationId), "operation identity is not traceable to the contract", "OPENAPI_CONTRACTS_OPERATION_TRACE_INVALID");
  const schemaName = e.schema_identity.split(".").at(-1);
  assert(e.schema_ref === `#/components/schemas/${schemaName}` && e.contract.components.schemas[schemaName], "schema identity is not traceable to the contract", "OPENAPI_CONTRACTS_SCHEMA_TRACE_INVALID");
  assert(e.context_status === "OPENAPI_CONTRACT_CONTEXT", "context status is not canonical", "OPENAPI_CONTRACTS_CONTEXT_INVALID");
  boolean(e.context_complete, "evidence.context_complete");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= 4, "requested tools are invalid", "OPENAPI_CONTRACTS_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 60); assert(TOOLS.has(tool), `unsupported tool: ${tool}`, "OPENAPI_CONTRACTS_TOOL_SCOPE_INVALID"); });
  assert(Array.isArray(e.required_block_identities) && JSON.stringify(e.required_block_identities) === JSON.stringify(REQUIRED_BLOCKS), "required block identities are incomplete", "OPENAPI_CONTRACTS_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value) => id(value, "required_block_identities[]"));
  assert(e.model_policy_status === "PREPARED_INACTIVE" || e.model_policy_status === "ACCEPTED_ACTIVE", "model policy status is invalid", "OPENAPI_CONTRACTS_MODEL_POLICY_INVALID");
  assert(e.model_route_status === "BOUND", "model route is not bound", "OPENAPI_CONTRACTS_MODEL_ROUTE_UNBOUND");
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "model capability floor is invalid", "OPENAPI_CONTRACTS_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "model capabilities are invalid", "OPENAPI_CONTRACTS_MODEL_ROUTE_UNBOUND");
  assert(e.model_auditor_model === "gpt-5.6-luna" && e.model_auditor_reasoning_effort === "max", "hostile auditor model route is not Luna max", "OPENAPI_CONTRACTS_MODEL_ROUTE_UNBOUND");
  assert(e.standard_id === "specialist.standard.openapi-3-1-1" && e.standard_version === "3.1.1", "standard identity is not canonical", "OPENAPI_CONTRACTS_STANDARD_BINDING_INVALID");
  for (const key of ["authority_status", "custody_status", "candidate_status", "signal_status"]) string(e[key], `evidence.${key}`);
  for (const key of ["project_data_present", "secret_data_present"]) boolean(e[key], `evidence.${key}`);
  exact(e.adversarial_flags, new Set(FLAGS), "OpenAPI contract adversarial flags");
  FLAGS.forEach((flag) => boolean(e.adversarial_flags[flag], `adversarial_flags.${flag}`));
  assert(scanPersistedRecord(input).safe, "OpenAPI contract input contains protected data", "OPENAPI_CONTRACTS_PRIVACY_DENIED");
}

export function evaluateOpenApiContractsBoundary(input) {
  validate(input);
  const e = input.evidence;
  const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("NOT_APPLICABLE", "NO_OPENAPI_CONTRACT_SCOPE", "OPENAPI_CONTRACTS_NOT_APPLICABLE", input, {unknowns: ["The named OpenAPI HTTP contract concern is absent from the typed request."]});
  if (FORBIDDEN.has(input.request_kind) || f.unsafe_action) return result("DENY", "NO_OPENAPI_CONTRACT_SIDE_EFFECT", "OPENAPI_CONTRACTS_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict || f.duplicate_authority) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "OPENAPI_CONTRACTS_AUTHORITY_CONFLICT", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "OPENAPI_CONTRACTS_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACTS_CONTEXT_INCOMPLETE", input);
  if (f.scope_expanded || f.broad_claim || f.umbrella_authority) return result("DENY", "NARROW_SCOPE_REQUIRED", "OPENAPI_CONTRACTS_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OPENAPI_CONTRACTS_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "OPENAPI_CONTRACTS_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "OPENAPI_CONTRACTS_FINDING_UNSUPPORTED", input);
  if (e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "OPENAPI_CONTRACTS_PROTECTED_DATA_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.custody_owner !== "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "OPENAPI_CONTRACTS_AUTHORITY_UNVERIFIED", input);
  if (e.candidate_status !== "CURRENT_CANDIDATE" || e.signal !== "API_CONTRACTS" || e.signal_status !== "BOUND") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACTS_CONTEXT_BINDING_INVALID", input);
  if (!['ANALYZE', 'ROUTE'].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OPENAPI_CONTRACTS_ACTION_INVALID", input);
  return result("ROUTE", "OPENAPI_CONTRACT_ANALYSIS_HANDOFF", "OPENAPI_CONTRACTS_ROUTE_READY", input, {
    analysis_allowed: true,
    selected_specialist: "specialist.product-client.openapi-contracts",
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the named OpenAPI 3.1.1 HTTP contract concern and return a typed finding or NOT_APPLICABLE_WITH_EVIDENCE; do not write Product state, select an implementation, or self-admit.",
      execution_instruction: false,
    },
  });
}

export const OPENAPI_CONTRACTS_REQUIRED_BLOCKS = REQUIRED_BLOCKS;
export const OPENAPI_CONTRACTS_ADVERSARIAL_FLAGS = FLAGS;
