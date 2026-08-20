#!/usr/bin/env node

/* Read-only Observability Router boundary. It selects the smallest
 * incident/monitoring evidence specialist and never commands production. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const OBSERVABILITY_ROUTER_BOUNDARY_SCHEMA = "agentos.observability_router_boundary_input.v1";
export const OBSERVABILITY_ROUTER_RESULT_SCHEMA = "agentos.observability_router_boundary_result.v1";
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const REQUESTS = new Set(["ROUTE_OBSERVABILITY", "CLASSIFY_INCIDENT_SIGNAL", "NOT_APPLICABLE", "UNRELATED_REQUEST", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "MUTATE_PRODUCTION", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW"]);
const FORBIDDEN_REQUESTS = new Set(["SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "MUTATE_PRODUCTION", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW"]);
const TARGETS = Object.freeze({
  SRE_OBSERVABILITY_INCIDENT: "specialist.delivery-operations.observability-incident",
  ALERTING: "specialist.delivery-operations.observability-incident",
  ALERT_QUALITY: "specialist.delivery-operations.observability-incident",
  INCIDENT_RESPONSE: "specialist.delivery-operations.observability-incident",
  INCIDENT_EVIDENCE: "specialist.delivery-operations.observability-incident",
  MONITORING: "specialist.delivery-operations.observability-incident",
  OBSERVABILITY: "specialist.delivery-operations.observability-incident",
});
const ALLOWED_TOOLS = new Set(["READ_ALERTS", "READ_CONTEXT"]);
const EVIDENCE_KEYS = new Set(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "incident_identity", "service_identity", "observability_evidence"]);

function fail(message, code = "OBSERVABILITY_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "OBSERVABILITY_ROUTER_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "OBSERVABILITY_ROUTER_UNKNOWN_FIELD"); }
function bounded(value, name, max = 200) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} must be bounded`, "OBSERVABILITY_ROUTER_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not canonical`, "OBSERVABILITY_ROUTER_ID_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: OBSERVABILITY_ROUTER_RESULT_SCHEMA, version: 1, disposition, route, error_code: errorCode, routing_allowed: false, acceptance_allowed: false, external_side_effects: {specialist_invocations: 0, alert_reads: 0, production_writes: 0, incident_commands: 0, credential_accesses: 0, state_changes: 0}, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "observability router input");
  assert(input.schema === OBSERVABILITY_ROUTER_BOUNDARY_SCHEMA && input.version === 1, "observability router schema mismatch", "OBSERVABILITY_ROUTER_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "observability router request kind is not recognized", "OBSERVABILITY_ROUTER_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "observability router evidence"); const evidence = input.evidence;
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "signal", "target_ref", "scope", "requested_action", "incident_identity", "service_identity", "observability_evidence"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  for (const key of ["custody_owner", "incident_identity", "service_identity"]) if (evidence[key] !== undefined) safeId(evidence[key], key);
  if (evidence.custody_ref !== undefined) assert(OPAQUE_REF.test(evidence.custody_ref), "custody_ref is not opaque", "OBSERVABILITY_ROUTER_CUSTODY_REF_INVALID");
  if (evidence.requested_tools !== undefined) { assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "requested_tools is not bounded", "OBSERVABILITY_ROUTER_TOOL_LIST_INVALID"); for (const tool of evidence.requested_tools) bounded(tool, "requested_tool", 60); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "OBSERVABILITY_ROUTER_BOOLEAN_INVALID");
  assert(scanPersistedRecord(input).safe, "observability router evidence contains protected data", "OBSERVABILITY_ROUTER_PRIVACY_DENIED");
}
function missing(evidence) { return ["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "signal", "target_ref", "context_complete", "scope", "requested_action", "incident_identity", "service_identity", "observability_evidence"].filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === ""); }
export function evaluateObservabilityRouterBoundary(input) {
  validateInput(input); const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_OBSERVABILITY_SCOPE", "OBSERVABILITY_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_ROUTER_SIDE_EFFECT", "OBSERVABILITY_ROUTER_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "OBSERVABILITY_ROUTER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "OBSERVABILITY_ROUTER_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "OBSERVABILITY_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "OBSERVABILITY_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  const absent = missing(evidence); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OBSERVABILITY_ROUTER_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.DELIVERY_OPERATIONS_OBSERVABILITY_ROUTER") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "OBSERVABILITY_ROUTER_AUTHORITY_UNVERIFIED", input);
  if (!OPAQUE_REF.test(evidence.custody_ref)) return result("DENY", "CUSTODY_BINDING_REQUIRED", "OBSERVABILITY_ROUTER_CUSTODY_UNBOUND", input);
  if (evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OBSERVABILITY_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (!SAFE_ID.test(evidence.source_identity) || evidence.source_identity !== "SOURCE.GOOGLE_SRE_MONITORING" || evidence.source_version !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "OBSERVABILITY_ROUTER_SOURCE_IDENTITY_INVALID", input);
  if (evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OBSERVABILITY_ROUTER_CONTEXT_INCOMPLETE", input);
  if (evidence.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "OBSERVABILITY_ROUTER_SCOPE_INVALID", input);
  if (evidence.requested_action !== "CLASSIFY") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OBSERVABILITY_ROUTER_ACTION_NOT_CLASSIFICATION", input);
  if (!Array.isArray(evidence.requested_tools) || evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "OBSERVABILITY_ROUTER_TOOL_SCOPE_FORBIDDEN", input);
  if (evidence.observability_evidence !== "BOUNDED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "OBSERVABILITY_ROUTER_EVIDENCE_UNBOUNDED", input);
  const target = TARGETS[evidence.signal]; if (!target) return result("DENY", "TYPED_CONTEXT_REQUIRED", "OBSERVABILITY_ROUTER_SIGNAL_UNSUPPORTED", input);
  if (evidence.target_ref !== target) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "OBSERVABILITY_ROUTER_TARGET_MISMATCH", input);
  return result("ROUTE", "SPECIALIST_HANDOFF", "OBSERVABILITY_ROUTER_ROUTE_READY", input, {routing_allowed: true, selected_specialist: target, handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed observability evidence to the selected incident specialist; do not command production.", execution_instruction: false}});
}
