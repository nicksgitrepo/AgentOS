#!/usr/bin/env node

/* Read-only Industrial 3D router. It classifies typed asset-pipeline signals;
 * it never edits assets, asserts engineering truth, or mutates project state. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const INDUSTRIAL_3D_ROUTER_INPUT_SCHEMA = "agentos.industrial_3d_router_boundary_input.v1";
export const INDUSTRIAL_3D_ROUTER_RESULT_SCHEMA = "agentos.industrial_3d_router_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const REQUESTS = new Set(["CLASSIFY_3D_SIGNAL", "ASSEMBLE_3D_CONTEXT", "ROUTE_3D_HANDOFF", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "BUILD_ASSET", "EDIT_MESH", "ASSERT_DIMENSIONS", "CERTIFY_ENGINEERING", "ANSWER_USER"]);
const FORBIDDEN = new Set(["REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "BUILD_ASSET", "EDIT_MESH", "ASSERT_DIMENSIONS", "CERTIFY_ENGINEERING", "ANSWER_USER"]);
const TOOLS = new Set(["READ_ASSET_SIGNAL", "READ_SOURCE_LOCK", "READ_GRAPHICS_CATALOG", "READ_CONTEXT", "READ_ENGINEERING_BOUNDARY"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"];
function fail(message, code = "INDUSTRIAL_3D_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "INDUSTRIAL_3D_ROUTER_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "INDUSTRIAL_3D_ROUTER_UNKNOWN_FIELD"); }
function str(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "INDUSTRIAL_3D_ROUTER_FIELD_INVALID"); }
function id(value, name) { str(value, name); assert(ID.test(value), `${name} is not canonical`, "INDUSTRIAL_3D_ROUTER_ID_INVALID"); }
function ref(value, name) { str(value, name, 180); assert(REF.test(value), `${name} is not opaque`, "INDUSTRIAL_3D_ROUTER_REF_INVALID"); }
function digest(value, name) { str(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "INDUSTRIAL_3D_ROUTER_DIGEST_INVALID"); }
function result(disposition, route, code, input, extra = {}) { const base = {schema: INDUSTRIAL_3D_ROUTER_RESULT_SCHEMA, version: 1, disposition, route, routing_allowed: false, acceptance_allowed: false, asset_mutation_allowed: false, engineering_assertion_allowed: false, external_side_effects: {asset_reads: 0, mesh_writes: 0, engineering_assertions: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, error_code: code, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Industrial 3D router input");
  assert(input.schema === INDUSTRIAL_3D_ROUTER_INPUT_SCHEMA && input.version === 1, "Industrial 3D router schema mismatch", "INDUSTRIAL_3D_ROUTER_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Industrial 3D request is unknown", "INDUSTRIAL_3D_ROUTER_REQUEST_INVALID");
  exact(input.evidence, new Set(["authority_status", "asset_domain", "asset_identity", "asset_stage", "asset_objective", "asset_version", "asset_ref", "source_status", "source_identity", "source_version", "candidate_status", "candidate_digest", "graphics_signal", "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "new_findings", "project_data_present", "secret_data_present", "adversarial_flags"]), "Industrial 3D router evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "asset_domain", "asset_identity", "asset_stage", "asset_objective", "asset_version", "source_status", "source_identity", "source_version", "candidate_status", "graphics_signal", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope"]) str(e[key], `evidence.${key}`);
  ref(e.asset_ref, "evidence.asset_ref"); digest(e.candidate_digest, "evidence.candidate_digest");
  assert(e.asset_domain === "INDUSTRIAL_3D", "asset domain is not typed", "INDUSTRIAL_3D_ROUTER_DOMAIN_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === 5 && new Set(e.required_block_identities).size === 5, "required block identities are incomplete", "INDUSTRIAL_3D_ROUTER_BLOCK_BINDING_INVALID"); e.required_block_identities.forEach((value) => id(value, "required_block_identities[]"));
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "INDUSTRIAL_3D_ROUTER_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "INDUSTRIAL_3D_ROUTER_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "new_findings", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "INDUSTRIAL_3D_ROUTER_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Industrial 3D router adversarial flags"); Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "INDUSTRIAL_3D_ROUTER_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Industrial 3D router input contains protected data", "INDUSTRIAL_3D_ROUTER_PRIVACY_DENIED");
}
export function evaluateIndustrial3dRouterBoundary(input) {
  validate(input); const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_INDUSTRIAL_3D_SCOPE", "INDUSTRIAL_3D_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_INDUSTRIAL_3D_SIDE_EFFECT", "INDUSTRIAL_3D_ROUTER_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.unrelated_scope) return result("DENY", "NO_INDUSTRIAL_3D_SCOPE", "INDUSTRIAL_3D_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (f.authority_conflict) return result("DENY", "CONTROL_PLANE_ESCALATION", "INDUSTRIAL_3D_ROUTER_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDUSTRIAL_3D_ROUTER_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "INDUSTRIAL_3D_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "INDUSTRIAL_3D_ROUTER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "INDUSTRIAL_3D_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "INDUSTRIAL_3D_ROUTER_DUPLICATE_AUTHORITY", input);
  if (f.cross_provider || f.stale_source) return result("DENY", "SOURCE_REFRESH_REQUIRED", "INDUSTRIAL_3D_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool || (e.asset_stage === "ENGINEERING_TRUTH" && f.false_positive === false && f.unsafe_action === false && f.authority_conflict === false && f.missing_context === false && f.scope_expanded === false && f.broad_claim === false && f.duplicate_authority === false && f.cross_provider === false && f.stale_source === false && f.self_acceptance === false && f.unrelated_scope === false)) return result("ROUTE", "ENGINEERING_REVIEW", "INDUSTRIAL_3D_ROUTER_ENGINEERING_REVIEW_REQUIRED", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR"});
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "INDUSTRIAL_3D_ROUTER_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_INDUSTRIAL_3D_SIDE_EFFECT", "INDUSTRIAL_3D_ROUTER_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "INDUSTRIAL_3D_ROUTER_CONTEXT" || e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDUSTRIAL_3D_ROUTER_CONTEXT_BINDING_INVALID", input);
  if (e.authority_scope !== "INDUSTRIAL_3D_ROUTER") return result("DENY", "NARROW_SCOPE_REQUIRED", "INDUSTRIAL_3D_ROUTER_SCOPE_INVALID", input);
  if (!["CLASSIFY", "ASSEMBLE", "ROUTE"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDUSTRIAL_3D_ROUTER_ACTION_INVALID", input);
  if (e.graphics_signal !== "GRAPHICS.INDUSTRIAL_3D") return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDUSTRIAL_3D_ROUTER_SIGNAL_INVALID", input);
  if (e.signal_status !== "BOUND" || e.task_status !== "INDUSTRIAL_3D_CLASSIFICATION") return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDUSTRIAL_3D_ROUTER_SIGNAL_INVALID", input);
  if (e.source_identity !== "SOURCE.BLENDER_GLTF_2_0_MANUAL" || e.source_version !== "3.3") return result("DENY", "SOURCE_REFRESH_REQUIRED", "INDUSTRIAL_3D_ROUTER_SOURCE_BINDING_INVALID", input);
  return result("ROUTE", "INDUSTRIAL_3D_ATOMIC_HANDOFF", "INDUSTRIAL_3D_ROUTER_ROUTE_READY", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route the typed Industrial 3D concern to the smallest modeling, interchange, runtime, or engineering-truth atom; do not edit assets, assert dimensions, certify engineering, or accept results.", execution_instruction: false}});
}
