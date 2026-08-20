#!/usr/bin/env node

/* Read-only Security Router boundary.
 *
 * This entrypoint turns a typed security signal into the smallest declared
 * downstream specialist route. It never performs security work, accepts a
 * finding, changes a project, or invokes tools. Missing, stale, conflicting,
 * broad, or unsafe evidence closes only this route and returns a typed result.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const SECURITY_ROUTER_BOUNDARY_SCHEMA = "agentos.security_router_boundary_input.v1";
export const SECURITY_ROUTER_RESULT_SCHEMA = "agentos.security_router_boundary_result.v1";

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const REQUESTS = new Set(["ROUTE_SECURITY", "CLASSIFY_SIGNAL", "NOT_APPLICABLE", "UNRELATED_REQUEST", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW"]);
const FORBIDDEN_REQUESTS = new Set(["SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW"]);
const TARGETS = Object.freeze({
  OAUTH: "specialist.security.oauth-identity",
  OIDC: "specialist.security.oidc-core",
  RBAC: "specialist.security.rbac",
  ABAC: "specialist.security.abac",
  REBAC: "specialist.security.rebac",
  TENANT_ISOLATION: "specialist.security.tenant-isolation",
  OBJECT_SCOPE: "specialist.security.object-scope",
  FUNCTION_SCOPE: "specialist.security.function-scope",
  WEB_TOP10: "specialist.security.owasp-web-top10-router",
  API_TOP10: "specialist.security.owasp-api-top10-router",
  SUPPLY_CHAIN: "specialist.security.supply-chain-router",
});
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_CONTEXT"]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
  "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance",
  "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present",
]);

function fail(message, code = "SECURITY_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "SECURITY_ROUTER_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "SECURITY_ROUTER_UNKNOWN_FIELD");
}
function bounded(value, name, max = 200) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} must be bounded`, "SECURITY_ROUTER_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not a canonical identifier`, "SECURITY_ROUTER_ID_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: SECURITY_ROUTER_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    routing_allowed: false,
    acceptance_allowed: false,
    external_side_effects: {
      specialist_invocations: 0,
      source_writes: 0,
      project_writes: 0,
      credential_accesses: 0,
      state_changes: 0,
    },
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "security router input");
  assert(input.schema === SECURITY_ROUTER_BOUNDARY_SCHEMA && input.version === 1, "security router schema mismatch", "SECURITY_ROUTER_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "security router request kind is not recognized", "SECURITY_ROUTER_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "security router evidence");
  const evidence = input.evidence;
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "signal", "target_ref", "scope", "requested_action"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.custody_owner !== undefined) safeId(evidence.custody_owner, "custody_owner");
  if (evidence.custody_ref !== undefined) assert(OPAQUE_REF.test(evidence.custody_ref), "custody_ref is not opaque", "SECURITY_ROUTER_CUSTODY_REF_INVALID");
  if (evidence.requested_tools !== undefined) {
    assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "requested_tools must be bounded", "SECURITY_ROUTER_TOOL_LIST_INVALID");
    for (const tool of evidence.requested_tools) bounded(tool, "requested_tool", 60);
  }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "SECURITY_ROUTER_BOOLEAN_INVALID");
  const privacy = scanPersistedRecord(input);
  assert(privacy.safe, "security router evidence contains protected or secret-like data", "SECURITY_ROUTER_PRIVACY_DENIED");
}

function requiredMissing(evidence) {
  return ["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "signal", "target_ref", "context_complete", "scope", "requested_action"]
    .filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === "");
}

export function evaluateSecurityRouterBoundary(input) {
  validateInput(input);
  const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_SECURITY_SCOPE", "SECURITY_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_ROUTER_SIDE_EFFECT", "SECURITY_ROUTER_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "SECURITY_ROUTER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "SECURITY_ROUTER_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "SECURITY_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "SECURITY_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  const missing = requiredMissing(evidence);
  if (missing.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "SECURITY_ROUTER_CONTEXT_INCOMPLETE", input, {missing_fields: missing});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.SECURITY_ROUTER") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "SECURITY_ROUTER_AUTHORITY_UNVERIFIED", input);
  if (!OPAQUE_REF.test(evidence.custody_ref)) return result("DENY", "CUSTODY_BINDING_REQUIRED", "SECURITY_ROUTER_CUSTODY_UNBOUND", input);
  if (evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "SECURITY_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (!SAFE_ID.test(evidence.source_identity) || evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "SECURITY_ROUTER_SOURCE_IDENTITY_INVALID", input);
  if (evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "SECURITY_ROUTER_CONTEXT_INCOMPLETE", input);
  if (evidence.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "SECURITY_ROUTER_SCOPE_INVALID", input);
  if (evidence.requested_action !== "CLASSIFY") return result("DENY", "TYPED_CONTEXT_REQUIRED", "SECURITY_ROUTER_ACTION_NOT_CLASSIFICATION", input);
  if (!Array.isArray(evidence.requested_tools) || evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "SECURITY_ROUTER_TOOL_SCOPE_FORBIDDEN", input);
  const target = TARGETS[evidence.signal];
  if (!target) return result("DENY", "TYPED_CONTEXT_REQUIRED", "SECURITY_ROUTER_SIGNAL_UNSUPPORTED", input);
  if (evidence.target_ref !== target) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "SECURITY_ROUTER_TARGET_MISMATCH", input);
  return result("ROUTE", "SPECIALIST_HANDOFF", "SECURITY_ROUTER_ROUTE_READY", input, {
    routing_allowed: true,
    selected_specialist: target,
    handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route this typed evidence to the selected narrow specialist; do not perform specialist work here.", execution_instruction: false},
  });
}

