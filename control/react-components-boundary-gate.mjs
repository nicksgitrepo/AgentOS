#!/usr/bin/env node

/* Read-only React 19.2 component-runtime specialist boundary. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const REACT_COMPONENTS_BOUNDARY_SCHEMA = "agentos.react_components_boundary_input.v1";
export const REACT_COMPONENTS_RESULT_SCHEMA = "agentos.react_components_result.v1";
export const REACT_COMPONENTS_BLOCK_ID = "specialist.software-language-runtime.react-components";
export const REACT_COMPONENTS_SPECIALIST = REACT_COMPONENTS_BLOCK_ID;

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const REQUESTS = new Set([
  "ANALYZE_REACT_COMPONENT", "NOT_APPLICABLE", "UNRELATED_REQUEST", "RENDER_COMPONENT", "MUTATE_RUNTIME",
  "WRITE_PROJECT", "DEPLOY", "PUBLISH", "ACCEPT", "SELF_REVIEW", "CERTIFY_COMPONENT",
]);
const FORBIDDEN_REQUESTS = new Set([
  "RENDER_COMPONENT", "MUTATE_RUNTIME", "WRITE_PROJECT", "DEPLOY", "PUBLISH", "ACCEPT", "SELF_REVIEW", "CERTIFY_COMPONENT",
]);
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_CONTEXT"]);
const COMPONENT_KINDS = new Set(["FUNCTION", "CLASS"]);
const RENDER_MODES = new Set(["CLIENT", "SERVER", "HYBRID"]);
const FLAG_KEYS = new Set([
  "authority_conflict", "scope_expanded", "cross_provider", "duplicate_authority", "umbrella_authority", "false_positive",
  "stale_source", "unsupported_tool", "missing_context", "unsafe_action", "wrong_framework", "wrong_version", "server_boundary_mismatch",
]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
  "source_effective_date", "source_retrieved_date", "standard_identity", "standard_version", "standard_effective_date",
  "standard_retrieved_date", "publisher_identity", "framework", "runtime_surface", "version", "component_ref", "component_kind",
  "render_mode", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance",
  "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_status", "applicability_complete",
  "runtime_evidence", "component_context", "props_evidence", "candidate_digest", "block_revision", "source_manifest_sha256",
  "source_content_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256",
  "memory_binding", "adversarial_flags",
]);
const REQUIRED_FIELDS = Object.freeze([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
  "source_effective_date", "source_retrieved_date", "standard_identity", "standard_version", "standard_effective_date",
  "standard_retrieved_date", "publisher_identity", "framework", "runtime_surface", "version", "component_ref", "component_kind",
  "render_mode", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "applicability_status",
  "applicability_complete", "runtime_evidence", "component_context", "props_evidence", "candidate_digest", "source_manifest_sha256",
  "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding",
]);

function fail(message, code = "REACT_COMPONENTS_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, label, code = "REACT_COMPONENTS_SHAPE_INVALID") {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, code);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "REACT_COMPONENTS_UNKNOWN_FIELD");
}
function bounded(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be bounded`, "REACT_COMPONENTS_FIELD_INVALID"); }
function safeId(value, label) { bounded(value, label); assert(SAFE_ID.test(value), `${label} is not canonical`, "REACT_COMPONENTS_ID_INVALID"); }
function opaqueRef(value, label) { bounded(value, label); assert(OPAQUE_REF.test(value), `${label} is not opaque`, "REACT_COMPONENTS_REF_INVALID"); }
function hash(value, label, {nullable = false} = {}) { if (nullable && value === null) return; assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "REACT_COMPONENTS_DIGEST_INVALID"); }
function date(value, label) { bounded(value, label, 20); assert(DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "REACT_COMPONENTS_DATE_INVALID"); }

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: REACT_COMPONENTS_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    routing_allowed: false,
    acceptance_allowed: false,
    external_side_effects: {
      specialist_invocations: 0,
      source_reads: 0,
      runtime_reads: 0,
      runtime_mutations: 0,
      project_writes: 0,
      credential_accesses: 0,
      state_changes: 0,
    },
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateComponentContext(value) {
  exactKeys(value, new Set([
    "framework", "version", "component_ref", "component_kind", "render_mode", "server_boundary", "hook_mode", "props_digest", "context_digest",
  ]), "component_context");
  assert(value.framework === "REACT", "component_context.framework is not React", "REACT_COMPONENTS_FRAMEWORK_INVALID");
  assert(value.version === "19.2", "component_context.version is not React 19.2", "REACT_COMPONENTS_VERSION_INVALID");
  opaqueRef(value.component_ref, "component_context.component_ref");
  assert(typeof value.component_kind === "string" && COMPONENT_KINDS.has(value.component_kind), "component_context.component_kind is invalid", "REACT_COMPONENTS_CONTEXT_INVALID");
  assert(typeof value.render_mode === "string" && RENDER_MODES.has(value.render_mode), "component_context.render_mode is invalid", "REACT_COMPONENTS_CONTEXT_INVALID");
  assert(value.server_boundary === "DECLARED" || value.server_boundary === "NONE", "component_context.server_boundary is invalid", "REACT_COMPONENTS_CONTEXT_INVALID");
  assert(value.hook_mode === "HOOKS" || value.hook_mode === "NO_HOOKS", "component_context.hook_mode is invalid", "REACT_COMPONENTS_CONTEXT_INVALID");
  opaqueRef(value.props_digest, "component_context.props_digest");
  hash(value.context_digest, "component_context.context_digest");
}

function validatePropsEvidence(value) {
  exactKeys(value, new Set(["status", "props_digest", "serializable", "unknown_keys"]), "props_evidence");
  assert(value.status === "BOUNDED", "props_evidence.status is not bounded", "REACT_COMPONENTS_PROPS_INVALID");
  opaqueRef(value.props_digest, "props_evidence.props_digest");
  assert(typeof value.serializable === "boolean", "props_evidence.serializable is invalid", "REACT_COMPONENTS_BOOLEAN_INVALID");
  assert(Array.isArray(value.unknown_keys) && value.unknown_keys.length <= 16 && value.unknown_keys.every((key) => typeof key === "string" && key.length <= 80), "props_evidence.unknown_keys is invalid", "REACT_COMPONENTS_PROPS_INVALID");
}

function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, "React Component Runtime evidence");
  for (const key of [
    "authority_status", "custody_status", "source_status", "source_identity", "source_version", "standard_identity", "standard_version",
    "publisher_identity", "framework", "runtime_surface", "version", "component_ref", "component_kind", "render_mode", "signal", "target_ref",
    "scope", "requested_action", "applicability_status", "runtime_evidence", "block_revision", "memory_binding",
  ]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.custody_owner !== undefined) safeId(evidence.custody_owner, "evidence.custody_owner");
  if (evidence.custody_ref !== undefined) opaqueRef(evidence.custody_ref, "evidence.custody_ref");
  for (const key of ["source_effective_date", "source_retrieved_date", "standard_effective_date", "standard_retrieved_date"]) if (evidence[key] !== undefined && evidence[key] !== null) date(evidence[key], `evidence.${key}`);
  if (evidence.requested_tools !== undefined) {
    assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "evidence.requested_tools is not bounded", "REACT_COMPONENTS_TOOL_LIST_INVALID");
    for (const tool of evidence.requested_tools) bounded(tool, "evidence.requested_tool", 60);
  }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_complete"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `evidence.${key} must be boolean`, "REACT_COMPONENTS_BOOLEAN_INVALID");
  if (evidence.adversarial_flags !== undefined) {
    exactKeys(evidence.adversarial_flags, FLAG_KEYS, "evidence.adversarial_flags");
    for (const [key, value] of Object.entries(evidence.adversarial_flags)) assert(typeof value === "boolean", `evidence.adversarial_flags.${key} must be boolean`, "REACT_COMPONENTS_BOOLEAN_INVALID");
  }
  if (evidence.component_context !== undefined) validateComponentContext(evidence.component_context);
  if (evidence.props_evidence !== undefined) validatePropsEvidence(evidence.props_evidence);
  for (const key of ["candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256"]) if (evidence[key] !== undefined) hash(evidence[key], `evidence.${key}`);
  if (evidence.source_content_sha256 !== undefined) hash(evidence.source_content_sha256, "evidence.source_content_sha256", {nullable: true});
  assert(scanPersistedRecord({schema: REACT_COMPONENTS_BOUNDARY_SCHEMA, version: 1, evidence}).safe, "React evidence contains protected data", "REACT_COMPONENTS_PRIVACY_DENIED");
}

function missing(evidence) { return REQUIRED_FIELDS.filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === ""); }

export function evaluateReactComponentsBoundary(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "React Component Runtime input");
  assert(input.schema === REACT_COMPONENTS_BOUNDARY_SCHEMA && input.version === 1, "React Component Runtime schema mismatch", "REACT_COMPONENTS_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "React Component Runtime request kind is not recognized", "REACT_COMPONENTS_REQUEST_INVALID");
  validateEvidence(input.evidence);
  const evidence = input.evidence;
  const flags = evidence.adversarial_flags ?? {};
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || flags.false_positive === true) return result("DENY", "NO_REACT_COMPONENTS_SCOPE", "REACT_COMPONENTS_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_REACT_COMPONENTS_SIDE_EFFECT", "REACT_COMPONENTS_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "REACT_COMPONENTS_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || flags.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "REACT_COMPONENTS_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED" || flags.scope_expanded === true) return result("DENY", "NARROW_SCOPE_REQUIRED", "REACT_COMPONENTS_SCOPE_EXPANSION_FORBIDDEN", input);
  if (flags.duplicate_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "REACT_COMPONENTS_SIBLING_SUBSTITUTION_FORBIDDEN", input);
  if (flags.umbrella_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "REACT_COMPONENTS_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (flags.cross_provider === true || flags.wrong_framework === true || flags.wrong_version === true) return result("DENY", "SOURCE_REFRESH_REQUIRED", "REACT_COMPONENTS_STANDARD_IDENTITY_INVALID", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "REACT_COMPONENTS_PROTECTED_DATA_FORBIDDEN", input);
  if (flags.stale_source === true || evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "REACT_COMPONENTS_SOURCE_STALE_OR_UNVERIFIED", input);
  if (flags.unsupported_tool === true || (Array.isArray(evidence.requested_tools) && evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool)))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "REACT_COMPONENTS_TOOL_SCOPE_FORBIDDEN", input);
  if (flags.missing_context === true || evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "REACT_COMPONENTS_CONTEXT_INCOMPLETE", input, {missing_fields: missing(evidence)});
  const absent = missing(evidence);
  if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "REACT_COMPONENTS_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.SOFTWARE_LANGUAGE_RUNTIME_REACT_COMPONENTS") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "REACT_COMPONENTS_AUTHORITY_UNVERIFIED", input);
  if (evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "REACT_COMPONENTS_SOURCE_IDENTITY_INVALID", input);
  if (evidence.standard_identity !== "source.react-19-2" || evidence.standard_version !== "19.2" || evidence.publisher_identity !== "React" || evidence.standard_effective_date !== "2025-10-01") return result("DENY", "SOURCE_REFRESH_REQUIRED", "REACT_COMPONENTS_STANDARD_IDENTITY_INVALID", input);
  if (evidence.framework !== "REACT" || evidence.version !== "19.2" || evidence.runtime_surface !== "WEB" || evidence.component_kind !== "FUNCTION" || evidence.render_mode !== "CLIENT" || evidence.signal !== "REACT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "REACT_COMPONENTS_RUNTIME_IDENTITY_INVALID", input);
  if (evidence.target_ref !== REACT_COMPONENTS_BLOCK_ID) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "REACT_COMPONENTS_TARGET_MISMATCH", input);
  if (evidence.scope !== "NARROW" || evidence.requested_action !== "ANALYZE_COMPONENT_RUNTIME") return result("DENY", "NARROW_SCOPE_REQUIRED", "REACT_COMPONENTS_SCOPE_INVALID", input);
  if (evidence.applicability_status !== "EXTERNAL_TYPED" || evidence.applicability_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "REACT_COMPONENTS_APPLICABILITY_INCOMPLETE", input);
  if (evidence.runtime_evidence !== "BOUNDED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "REACT_COMPONENTS_RUNTIME_EVIDENCE_UNBOUNDED", input);
  const context = evidence.component_context;
  if (context.framework !== "REACT" || context.version !== "19.2" || context.component_ref !== evidence.component_ref || context.component_kind !== evidence.component_kind || context.render_mode !== evidence.render_mode || flags.server_boundary_mismatch === true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "REACT_COMPONENTS_COMPONENT_CONTEXT_INVALID", input);
  if (evidence.props_evidence.status !== "BOUNDED" || evidence.props_evidence.props_digest !== context.props_digest || evidence.props_evidence.serializable !== true || evidence.props_evidence.unknown_keys.length > 0) return result("DENY", "TYPED_CONTEXT_REQUIRED", "REACT_COMPONENTS_PROPS_EVIDENCE_INCOMPLETE", input);
  return result("ROUTE", "REACT_COMPONENTS_SPECIALIST_HANDOFF", "REACT_COMPONENTS_ROUTE_READY", input, {
    routing_allowed: true,
    selected_specialist: REACT_COMPONENTS_SPECIALIST,
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the supplied bounded React 19.2 component-runtime evidence; do not render, mutate runtime state, write projects, or certify applicability.",
      execution_instruction: false,
    },
  });
}

export const evaluateReactComponentBoundary = evaluateReactComponentsBoundary;

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(evaluateReactComponentsBoundary(JSON.parse(process.argv[2] ?? "null")), null, 2)}\n`);
