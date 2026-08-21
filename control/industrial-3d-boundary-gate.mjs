#!/usr/bin/env node

/*
 * Read-only Industrial 3D atomic boundary. It accepts only repository-bound
 * typed evidence and returns a bounded handoff. It never edits assets,
 * writes memory, asserts engineering truth, accepts a candidate, or changes
 * lifecycle state.
 */

import {canonicalDigest, scanPersistedRecord} from "./content-addressing.mjs";
import {
  assertIndustrial3dCanonicalEvidence,
  INDUSTRIAL_3D_ALLOWED_TOOLS,
  INDUSTRIAL_3D_BLOCK_ID,
  INDUSTRIAL_3D_CONTEXT_STATUS,
  INDUSTRIAL_3D_FLAG_KEYS,
  INDUSTRIAL_3D_REQUIRED_BLOCKS,
  INDUSTRIAL_3D_SOURCE_INPUT_ID,
  resolveIndustrial3dCanonicalAuthority,
} from "./industrial-3d-authority-binding.mjs";

export const INDUSTRIAL_3D_INPUT_SCHEMA = "agentos.industrial_3d_boundary_input.v1";
export const INDUSTRIAL_3D_RESULT_SCHEMA = "agentos.industrial_3d_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const REQUESTS = new Set([
  "ANALYZE_INDUSTRIAL_3D", "ROUTE_INDUSTRIAL_3D", "HANDOFF_INDUSTRIAL_3D", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "MERGE", "PUSH", "DEPLOY", "PUBLISH",
  "WRITE_ASSET", "WRITE_MEMORY", "SELF_REVIEW", "CERTIFY_ENGINEERING", "OVERRIDE_SCOPE", "CHANGE_STANDARD", "ISSUE_CREDENTIAL",
]);
const FORBIDDEN = new Set([
  "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "MERGE", "PUSH", "DEPLOY", "PUBLISH",
  "WRITE_ASSET", "WRITE_MEMORY", "SELF_REVIEW", "CERTIFY_ENGINEERING", "OVERRIDE_SCOPE", "CHANGE_STANDARD", "ISSUE_CREDENTIAL",
]);
const REQUEST_ACTIONS = new Set(["ANALYZE", "ROUTE", "HANDOFF"]);
const CONCERNS = new Set(["IDENTITY", "INTERCHANGE", "MATERIALS", "TOPOLOGY", "PLACEMENT", "RUNTIME_ATTACHMENT"]);
const STAGES = new Set(["INTERCHANGE", "MATERIALS", "TOPOLOGY", "PLACEMENT", "RUNTIME_ATTACHMENT"]);

function fail(message, code = "INDUSTRIAL_3D_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "INDUSTRIAL_3D_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} has unknown field ${key}`, "INDUSTRIAL_3D_UNKNOWN_FIELD");
}
function string(value, label, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim(), `${label} is invalid`, "INDUSTRIAL_3D_FIELD_INVALID");
}
function digest(value, label) {
  string(value, label, 64);
  assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "INDUSTRIAL_3D_DIGEST_INVALID");
}
function ref(value, label) { string(value, label, 180); assert(OPAQUE_REF.test(value), `${label} is not opaque`, "INDUSTRIAL_3D_REF_INVALID"); }
function result(disposition, route, errorCode, input, {analysisAllowed = disposition === "ROUTE", routingAllowed = disposition === "ROUTE"} = {}, extra = {}) {
  const base = {
    schema: INDUSTRIAL_3D_RESULT_SCHEMA, version: 1, disposition, route,
    analysis_allowed: analysisAllowed, routing_allowed: routingAllowed, acceptance_allowed: false,
    asset_mutation_allowed: false, engineering_assertion_allowed: false, memory_write_allowed: false,
    external_side_effects: {
      asset_evidence_reads: 0, asset_writes: 0, source_reads: 0, standard_reads: 0, memory_writes: 0,
      engineering_assertions: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0,
    },
    error_code: errorCode, input_sha256: canonicalDigest(input), ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Industrial 3D input");
  assert(input.schema === INDUSTRIAL_3D_INPUT_SCHEMA && input.version === 1, "Industrial 3D schema mismatch", "INDUSTRIAL_3D_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Industrial 3D request is unknown", "INDUSTRIAL_3D_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "custody_ref", "asset_domain", "asset_identity", "asset_stage", "asset_format", "asset_version", "asset_ref", "concern",
    "source_status", "source_identity", "source_version", "source_retrieved_date", "source_manifest_sha256", "standard_identity", "standard_version",
    "standard_block_sha256", "standard_source_manifest_sha256", "candidate_status", "candidate_digest", "graphics_signal", "signal_status", "task_status",
    "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status",
    "model_snapshot_sha256", "model_task_class", "model_capability_floor", "model_required_capabilities", "model_route_sha256", "authority_scope",
    "upstream_router_file_sha256", "upstream_router_block_sha256", "upstream_router_fixture_sha256", "upstream_router_input_sha256", "upstream_router_expected_sha256", "upstream_router_result_sha256", "upstream_router_model_snapshot_sha256", "upstream_router_model_route_sha256", "upstream_router_model_policy_claim", "upstream_router_model_binding_status", "context_receipt_sha256", "memory_readback_sha256", "fixture_contract_sha256", "agent_roster_file_sha256", "specialist_roster_file_sha256", "atomic_inventory_file_sha256", "routing_index_file_sha256", "agent_roster_semantic_sha256", "specialist_roster_semantic_sha256", "atomic_inventory_semantic_sha256", "routing_index_semantic_sha256", "registry_contract_sha256", "registry_agent_state", "agent_roster_status", "specialist_roster_status", "atomic_inventory_status", "routing_index_status", "registry_activation", "project_data_present", "secret_data_present", "adversarial_flags",
  ]), "Industrial 3D evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "asset_domain", "asset_identity", "asset_stage", "asset_format", "asset_version", "concern", "source_status", "source_identity", "source_version", "source_retrieved_date", "standard_identity", "standard_version", "candidate_status", "graphics_signal", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "model_task_class", "authority_scope"]) string(e[key], `evidence.${key}`);
  ref(e.asset_ref, "evidence.asset_ref"); ref(e.custody_ref, "evidence.custody_ref");
  for (const key of ["candidate_digest", "source_manifest_sha256", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256", "upstream_router_file_sha256", "upstream_router_block_sha256", "upstream_router_fixture_sha256", "upstream_router_input_sha256", "upstream_router_expected_sha256", "upstream_router_result_sha256", "upstream_router_model_snapshot_sha256", "upstream_router_model_route_sha256", "context_receipt_sha256", "memory_readback_sha256", "fixture_contract_sha256", "agent_roster_file_sha256", "specialist_roster_file_sha256", "atomic_inventory_file_sha256", "routing_index_file_sha256", "agent_roster_semantic_sha256", "specialist_roster_semantic_sha256", "atomic_inventory_semantic_sha256", "routing_index_semantic_sha256", "registry_contract_sha256"]) digest(e[key], `evidence.${key}`);
  for (const key of ["upstream_router_model_policy_claim", "upstream_router_model_binding_status", "agent_roster_status", "specialist_roster_status", "atomic_inventory_status", "routing_index_status", "registry_activation"]) string(e[key], `evidence.${key}`);
  assert(e.registry_agent_state === "CANDIDATE_READY_FOR_QUALIFICATION", "Industrial 3D registry state is not an inactive candidate", "INDUSTRIAL_3D_REGISTRY_STATE_INVALID");
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "Industrial 3D model capability floor is invalid", "INDUSTRIAL_3D_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "Industrial 3D model capabilities are invalid", "INDUSTRIAL_3D_MODEL_ROUTE_UNBOUND");
  assert(typeof e.context_complete === "boolean" && typeof e.project_data_present === "boolean" && typeof e.secret_data_present === "boolean", "Industrial 3D boolean evidence is invalid", "INDUSTRIAL_3D_BOOLEAN_INVALID");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= INDUSTRIAL_3D_ALLOWED_TOOLS.length, "Industrial 3D tools are invalid", "INDUSTRIAL_3D_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 80); assert(INDUSTRIAL_3D_ALLOWED_TOOLS.includes(tool), "Industrial 3D tool is outside custody", "INDUSTRIAL_3D_TOOL_SCOPE_INVALID"); });
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === INDUSTRIAL_3D_REQUIRED_BLOCKS.length && JSON.stringify(e.required_block_identities) === JSON.stringify(INDUSTRIAL_3D_REQUIRED_BLOCKS), "Industrial 3D required blocks are not canonical", "INDUSTRIAL_3D_BLOCK_BINDING_INVALID");
  assert(e.context_status === INDUSTRIAL_3D_CONTEXT_STATUS, "Industrial 3D context status is invalid", "INDUSTRIAL_3D_CONTEXT_BINDING_INVALID");
  exact(e.adversarial_flags, new Set(INDUSTRIAL_3D_FLAG_KEYS), "Industrial 3D adversarial flags");
  INDUSTRIAL_3D_FLAG_KEYS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "INDUSTRIAL_3D_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Industrial 3D input contains protected data", "INDUSTRIAL_3D_PRIVACY_DENIED");
  const authority = resolveIndustrial3dCanonicalAuthority();
  assertIndustrial3dCanonicalEvidence(e, authority);
  return authority;
}

export function evaluateIndustrial3dBoundary(input) {
  const authority = validate(input);
  const e = input.evidence;
  const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_INDUSTRIAL_3D_SCOPE", "INDUSTRIAL_3D_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_INDUSTRIAL_3D_SIDE_EFFECT", "INDUSTRIAL_3D_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "INDUSTRIAL_3D_AUTHORITY_CONFLICT", input);
  if (f.memory_stale || f.context_invalidated || f.model_policy_drift || e.context_complete !== true) return result("DENY", "CONTEXT_REFRESH_REQUIRED", "INDUSTRIAL_3D_CONTEXT_INVALIDATED", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDUSTRIAL_3D_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "INDUSTRIAL_3D_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "INDUSTRIAL_3D_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "INDUSTRIAL_3D_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || f.source_superseded) return result("DENY", "SOURCE_REFRESH_REQUIRED", "INDUSTRIAL_3D_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("ROUTE", "TOOL_CUSTODY_REVIEW", "INDUSTRIAL_3D_TOOL_LIMIT", input, {analysisAllowed: false, routingAllowed: true}, {selected_specialist: INDUSTRIAL_3D_BLOCK_ID, handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Obtain the named tool-custody evidence before analysis; preserve the candidate and do not broaden tool authority.", execution_instruction: false}});
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "INDUSTRIAL_3D_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action || f.lifecycle_invalid) return result("DENY", "NO_INDUSTRIAL_3D_SIDE_EFFECT", "INDUSTRIAL_3D_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result("DENY", "CONTEXT_REFRESH_REQUIRED", "INDUSTRIAL_3D_CONTEXT_BINDING_INVALID", input);
  if (e.asset_domain !== "INDUSTRIAL_3D" || !CONCERNS.has(e.concern) || !STAGES.has(e.asset_stage) || e.asset_format !== "GLTF" || e.asset_version !== "2.0.1") return result("DENY", "NARROW_SCOPE_REQUIRED", "INDUSTRIAL_3D_ASSET_SCOPE_INVALID", input);
  if (!REQUEST_ACTIONS.has(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDUSTRIAL_3D_ACTION_INVALID", input);
  if (e.graphics_signal !== "GRAPHICS.INDUSTRIAL_3D" || e.signal_status !== "BOUND" || e.task_status !== "INDUSTRIAL_3D_ANALYSIS") return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDUSTRIAL_3D_SIGNAL_INVALID", input);
  if (e.source_identity !== INDUSTRIAL_3D_SOURCE_INPUT_ID || e.source_version !== "3.3") return result("DENY", "SOURCE_REFRESH_REQUIRED", "INDUSTRIAL_3D_SOURCE_BINDING_INVALID", input);
  assert(authority.block_sha256 === e.candidate_digest, "Industrial 3D authority changed during evaluation", "INDUSTRIAL_3D_CANONICAL_PROVENANCE_INVALID");
  return result("ROUTE", "INDUSTRIAL_3D_ANALYSIS_HANDOFF", "INDUSTRIAL_3D_ROUTE_READY", input, {}, {
    selected_specialist: INDUSTRIAL_3D_BLOCK_ID,
    handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Analyze only the named Industrial 3D concern against exact glTF/source evidence; preserve unknowns and route engineering truth externally.", execution_instruction: false},
  });
}
