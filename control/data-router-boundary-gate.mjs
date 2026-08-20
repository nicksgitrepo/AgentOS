#!/usr/bin/env node

/* Read-only Data Router boundary. It selects the smallest database, migration,
 * tenant, or data-lifecycle specialist from current typed evidence. It never
 * reads consumer records, writes a project, runs a migration, or accepts a
 * route as proof of completion.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const DATA_ROUTER_BOUNDARY_SCHEMA = "agentos.data_router_boundary_input.v1";
export const DATA_ROUTER_RESULT_SCHEMA = "agentos.data_router_boundary_result.v1";
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const REQUESTS = new Set(["ROUTE_DATA", "CLASSIFY_DATA_SIGNAL", "NOT_APPLICABLE", "UNRELATED_REQUEST", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "MIGRATE", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW"]);
const FORBIDDEN_REQUESTS = new Set(["SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "MIGRATE", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW"]);
const TARGETS = Object.freeze({
  POSTGRES_RLS: "specialist.data.postgresql-rls",
  MIGRATION: "specialist.data.migration-rollback",
  TENANT_ISOLATION: "specialist.security.tenant-isolation",
  ACCESS_CONTROL: "specialist.security.access-control-router",
  DATA_LIFECYCLE: "specialist.privacy.data-lifecycle-router",
});
const ALLOWED_TOOLS = new Set(["READ_SCHEMA", "READ_CONTEXT"]);
const EVIDENCE_KEYS = new Set(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present"]);
function fail(message, code = "DATA_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "DATA_ROUTER_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "DATA_ROUTER_UNKNOWN_FIELD"); }
function bounded(value, name, max = 200) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} must be bounded`, "DATA_ROUTER_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not canonical`, "DATA_ROUTER_ID_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: DATA_ROUTER_RESULT_SCHEMA, version: 1, disposition, route, error_code: errorCode, routing_allowed: false, acceptance_allowed: false, external_side_effects: {specialist_invocations: 0, schema_writes: 0, project_writes: 0, migration_calls: 0, credential_accesses: 0, state_changes: 0}, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "data router input");
  assert(input.schema === DATA_ROUTER_BOUNDARY_SCHEMA && input.version === 1, "data router schema mismatch", "DATA_ROUTER_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "data router request kind is not recognized", "DATA_ROUTER_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "data router evidence"); const evidence = input.evidence;
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "signal", "target_ref", "scope", "requested_action"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.custody_owner !== undefined) safeId(evidence.custody_owner, "custody_owner");
  if (evidence.custody_ref !== undefined) assert(OPAQUE_REF.test(evidence.custody_ref), "custody_ref is not opaque", "DATA_ROUTER_CUSTODY_REF_INVALID");
  if (evidence.requested_tools !== undefined) { assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "requested_tools is not bounded", "DATA_ROUTER_TOOL_LIST_INVALID"); for (const tool of evidence.requested_tools) bounded(tool, "requested_tool", 60); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "DATA_ROUTER_BOOLEAN_INVALID");
  assert(scanPersistedRecord(input).safe, "data router evidence contains protected data", "DATA_ROUTER_PRIVACY_DENIED");
}
function missing(evidence) { return ["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "signal", "target_ref", "context_complete", "scope", "requested_action"].filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === ""); }
export function evaluateDataRouterBoundary(input) {
  validateInput(input); const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_DATA_SCOPE", "DATA_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_ROUTER_SIDE_EFFECT", "DATA_ROUTER_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "DATA_ROUTER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "DATA_ROUTER_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "DATA_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "DATA_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  const absent = missing(evidence); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_ROUTER_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.DATA_ROUTER") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "DATA_ROUTER_AUTHORITY_UNVERIFIED", input);
  if (!OPAQUE_REF.test(evidence.custody_ref)) return result("DENY", "CUSTODY_BINDING_REQUIRED", "DATA_ROUTER_CUSTODY_UNBOUND", input);
  if (evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "DATA_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (!SAFE_ID.test(evidence.source_identity) || evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "DATA_ROUTER_SOURCE_IDENTITY_INVALID", input);
  if (evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_ROUTER_CONTEXT_INCOMPLETE", input);
  if (evidence.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "DATA_ROUTER_SCOPE_INVALID", input);
  if (evidence.requested_action !== "CLASSIFY") return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_ROUTER_ACTION_NOT_CLASSIFICATION", input);
  if (!Array.isArray(evidence.requested_tools) || evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "DATA_ROUTER_TOOL_SCOPE_FORBIDDEN", input);
  const target = TARGETS[evidence.signal]; if (!target) return result("DENY", "TYPED_CONTEXT_REQUIRED", "DATA_ROUTER_SIGNAL_UNSUPPORTED", input);
  if (evidence.target_ref !== target) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "DATA_ROUTER_TARGET_MISMATCH", input);
  return result("ROUTE", "SPECIALIST_HANDOFF", "DATA_ROUTER_ROUTE_READY", input, {routing_allowed: true, selected_specialist: target, handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed data evidence to the selected narrow specialist; do not perform data work here.", execution_instruction: false}});
}
