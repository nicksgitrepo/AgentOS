#!/usr/bin/env node

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const BOOTSTRAP_PROJECT_INITIALIZER_BOUNDARY_SCHEMA = "agentos.bootstrap_project_initializer_boundary_input.v1";
export const BOOTSTRAP_PROJECT_INITIALIZER_RESULT_SCHEMA = "agentos.bootstrap_project_initializer_boundary_result.v1";

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const REQUESTS = new Set([
  "INITIALIZE_PROJECT_BOOTSTRAP",
  "DISCOVER_SETUP_CONTEXT",
  "CLASSIFY_BOOTSTRAP_SIGNAL",
  "NOT_APPLICABLE",
  "UNRELATED_REQUEST",
  "SPAWN",
  "ADMIT",
  "ARCHIVE",
  "DESPAWN",
  "DEPLOY",
  "PUBLISH",
  "CREATE_PROVIDER_IDENTITY",
  "CREATE_CREDENTIAL",
  "ROTATE_CREDENTIAL",
  "WRITE_PROJECT",
  "WRITE_MEMORY",
  "REGULATE_WORKFLOW",
  "ACCEPT",
  "SELF_REVIEW",
  "APPROVE_OWNER",
]);
const FORBIDDEN_REQUESTS = new Set([
  "SPAWN",
  "ADMIT",
  "ARCHIVE",
  "DESPAWN",
  "DEPLOY",
  "PUBLISH",
  "CREATE_PROVIDER_IDENTITY",
  "CREATE_CREDENTIAL",
  "ROTATE_CREDENTIAL",
  "WRITE_PROJECT",
  "WRITE_MEMORY",
  "REGULATE_WORKFLOW",
  "ACCEPT",
  "SELF_REVIEW",
  "APPROVE_OWNER",
]);
const SIGNALS = new Set(["PROJECT_BOOTSTRAP", "REPOSITORY_DISCOVERY", "RUNTIME_DISCOVERY", "ENVIRONMENT_DISCOVERY"]);
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_FILESYSTEM_METADATA", "READ_GIT_METADATA"]);
const EVIDENCE_KEYS = new Set([
  "authority_status",
  "custody_status",
  "custody_owner",
  "custody_ref",
  "source_status",
  "source_identity",
  "source_version",
  "bootstrap_surface",
  "signal",
  "target_ref",
  "project_context_ref",
  "context_complete",
  "scope",
  "requested_action",
  "requested_tools",
  "discovery_evidence",
  "source_control_readback",
  "unknowns_typed",
  "conflicts_typed",
  "unknown_count",
  "conflict_count",
  "self_acceptance",
  "scope_expanded",
  "authority_conflict",
  "project_data_present",
  "secret_data_present",
  "provider_identity_asserted",
  "credential_material_present",
]);

function fail(message, code = "BOOTSTRAP_PROJECT_INITIALIZER_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(condition, message, code) {
  if (!condition) fail(message, code);
}

function exactKeys(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "BOOTSTRAP_PROJECT_INITIALIZER_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "BOOTSTRAP_PROJECT_INITIALIZER_UNKNOWN_FIELD");
}

function bounded(value, label, max = 200) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be bounded`, "BOOTSTRAP_PROJECT_INITIALIZER_FIELD_INVALID");
}

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: BOOTSTRAP_PROJECT_INITIALIZER_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    routing_allowed: false,
    acceptance_allowed: false,
    external_side_effects: {
      initializer_invocations: 0,
      filesystem_metadata_reads: 0,
      git_metadata_reads: 0,
      project_writes: 0,
      memory_writes: 0,
      provider_mutations: 0,
      credential_accesses: 0,
      owner_decisions: 0,
      state_changes: 0,
    },
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "bootstrap initializer input");
  assert(input.schema === BOOTSTRAP_PROJECT_INITIALIZER_BOUNDARY_SCHEMA && input.version === 1, "bootstrap initializer schema mismatch", "BOOTSTRAP_PROJECT_INITIALIZER_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "bootstrap initializer request kind is not recognized", "BOOTSTRAP_PROJECT_INITIALIZER_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "bootstrap initializer evidence");
  const evidence = input.evidence;
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "bootstrap_surface", "signal", "target_ref", "scope", "requested_action", "discovery_evidence", "source_control_readback"]) {
    if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  }
  for (const key of ["custody_owner"]) {
    if (evidence[key] !== undefined) {
      bounded(evidence[key], `evidence.${key}`);
      assert(SAFE_ID.test(evidence[key]), `${key} is not canonical`, "BOOTSTRAP_PROJECT_INITIALIZER_ID_INVALID");
    }
  }
  for (const key of ["custody_ref", "project_context_ref"]) if (evidence[key] !== undefined) assert(OPAQUE_REF.test(evidence[key]), `${key} is not opaque`, "BOOTSTRAP_PROJECT_INITIALIZER_REF_INVALID");
  if (evidence.requested_tools !== undefined) {
    assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "requested_tools is not bounded", "BOOTSTRAP_PROJECT_INITIALIZER_TOOL_LIST_INVALID");
    for (const tool of evidence.requested_tools) bounded(tool, "requested_tool", 60);
  }
  for (const key of ["context_complete", "unknowns_typed", "conflicts_typed", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "provider_identity_asserted", "credential_material_present"]) {
    if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "BOOTSTRAP_PROJECT_INITIALIZER_BOOLEAN_INVALID");
  }
  for (const key of ["unknown_count", "conflict_count"]) {
    if (evidence[key] !== undefined) assert(Number.isSafeInteger(evidence[key]) && evidence[key] >= 0 && evidence[key] <= 10000, `${key} is not bounded`, "BOOTSTRAP_PROJECT_INITIALIZER_COUNT_INVALID");
  }
  assert(scanPersistedRecord(input).safe, "bootstrap initializer evidence contains protected data", "BOOTSTRAP_PROJECT_INITIALIZER_PRIVACY_DENIED");
}

function missing(evidence) {
  return [
    "authority_status",
    "custody_status",
    "custody_owner",
    "custody_ref",
    "source_status",
    "source_identity",
    "source_version",
    "bootstrap_surface",
    "signal",
    "target_ref",
    "project_context_ref",
    "context_complete",
    "scope",
    "requested_action",
    "discovery_evidence",
    "source_control_readback",
    "unknowns_typed",
    "conflicts_typed",
    "unknown_count",
    "conflict_count",
  ].filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === "");
}

export function evaluateBootstrapProjectInitializerBoundary(input) {
  validateInput(input);
  const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_BOOTSTRAP_SCOPE", "BOOTSTRAP_PROJECT_INITIALIZER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_INITIALIZER_SIDE_EFFECT", "BOOTSTRAP_PROJECT_INITIALIZER_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "BOOTSTRAP_PROJECT_INITIALIZER_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true || evidence.credential_material_present === true) return result("DENY", "DATA_CUSTODY_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_PROTECTED_DATA_FORBIDDEN", input);
  if (evidence.provider_identity_asserted === true) return result("DENY", "PROVIDER_AUTHORITY_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_PROVIDER_AUTHORITY_FORBIDDEN", input);
  const absent = missing(evidence);
  if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.CONTROL_BOOTSTRAP_PROJECT_INITIALIZER") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_AUTHORITY_UNVERIFIED", input);
  if (!OPAQUE_REF.test(evidence.custody_ref) || !OPAQUE_REF.test(evidence.project_context_ref)) return result("DENY", "CUSTODY_BINDING_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_REF_UNBOUND", input);
  if (evidence.source_status !== "CURRENT" || evidence.source_identity !== "SOURCE.JSON_SCHEMA_2020_12" || evidence.source_version !== "DRAFT_2020_12") return result("DENY", "SOURCE_REFRESH_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_SOURCE_IDENTITY_INVALID", input);
  if (evidence.bootstrap_surface !== "DISCOVERY") return result("DENY", "TYPED_CONTEXT_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_SURFACE_INVALID", input);
  if (!SIGNALS.has(evidence.signal)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_SIGNAL_UNSUPPORTED", input);
  if (evidence.target_ref !== "AGENTOS_CONTROLLER") return result("DENY", "CONTROL_PLANE_HANDOFF_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_TARGET_MISMATCH", input);
  if (evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_CONTEXT_INCOMPLETE", input);
  if (evidence.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_SCOPE_INVALID", input);
  if (!["INITIALIZE", "DISCOVER_AND_TYPE", "CLASSIFY"].includes(evidence.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_ACTION_INVALID", input);
  if (!Array.isArray(evidence.requested_tools) || evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_TOOL_SCOPE_FORBIDDEN", input);
  if (evidence.discovery_evidence !== "TYPED_PROVENANCE" || evidence.source_control_readback !== "BOUND") return result("DENY", "TYPED_CONTEXT_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_PROVENANCE_INCOMPLETE", input);
  if (evidence.unknowns_typed !== true || evidence.conflicts_typed !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "BOOTSTRAP_PROJECT_INITIALIZER_UNKNOWN_CONFLICT_UNTYPED", input);
  if (evidence.conflict_count !== 0) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "BOOTSTRAP_PROJECT_INITIALIZER_DISCOVERY_CONFLICT", input);
  return result("ROUTE", "CONTROLLER_HANDOFF", "BOOTSTRAP_PROJECT_INITIALIZER_ROUTE_READY", input, {
    routing_allowed: true,
    selected_recipient: "AGENTOS_CONTROLLER",
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Pass the typed, project-scoped discovery readback to Controller; preserve unknowns and do not infer owner intent or provider authority.",
      execution_instruction: false,
    },
  });
}
