#!/usr/bin/env node

/* Read-only Provider/Edge Router boundary. It selects the smallest declared
 * provider specialist and never touches an account, edge, or project. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const PROVIDER_EDGE_ROUTER_BOUNDARY_SCHEMA = "agentos.provider_edge_router_boundary_input.v1";
export const PROVIDER_EDGE_ROUTER_RESULT_SCHEMA = "agentos.provider_edge_router_boundary_result.v1";
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const REQUESTS = new Set(["ROUTE_PROVIDER_EDGE", "CLASSIFY_PROVIDER_SIGNAL", "NOT_APPLICABLE", "UNRELATED_REQUEST", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "MUTATE_PROVIDER", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW"]);
const FORBIDDEN_REQUESTS = new Set(["SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "MUTATE_PROVIDER", "WRITE_PROJECT", "ACCEPT", "SELF_REVIEW"]);
const TARGETS = Object.freeze({
  AWS_POLICY: {provider: "AWS", target: "specialist.platform.aws-iam-policy"},
  AWS_IAM: {provider: "AWS", target: "specialist.platform.aws-iam-policy"},
  "CLOUD.AWS_IAM": {provider: "AWS", target: "specialist.platform.aws-iam-policy"},
  "EDGE.CLOUDFLARE_CACHE": {provider: "CLOUDFLARE", target: "specialist.platform.cloudflare-cache"},
  CLOUDFLARE_CACHE: {provider: "CLOUDFLARE", target: "specialist.platform.cloudflare-cache"},
  "EDGE.CLOUDFLARE_DNS": {provider: "CLOUDFLARE", target: "specialist.platform.cloudflare-dns"},
  CLOUDFLARE_DNS: {provider: "CLOUDFLARE", target: "specialist.platform.cloudflare-dns"},
});
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_CONTEXT"]);
const EVIDENCE_KEYS = new Set(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "provider_identity", "provider_version", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "provider_evidence"]);

function fail(message, code = "PROVIDER_EDGE_ROUTER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "PROVIDER_EDGE_ROUTER_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "PROVIDER_EDGE_ROUTER_UNKNOWN_FIELD"); }
function bounded(value, name, max = 200) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} must be bounded`, "PROVIDER_EDGE_ROUTER_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not canonical`, "PROVIDER_EDGE_ROUTER_ID_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: PROVIDER_EDGE_ROUTER_RESULT_SCHEMA, version: 1, disposition, route, error_code: errorCode, routing_allowed: false, acceptance_allowed: false, external_side_effects: {specialist_invocations: 0, provider_reads: 0, account_mutations: 0, project_writes: 0, credential_accesses: 0, state_changes: 0}, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "provider edge router input");
  assert(input.schema === PROVIDER_EDGE_ROUTER_BOUNDARY_SCHEMA && input.version === 1, "provider edge router schema mismatch", "PROVIDER_EDGE_ROUTER_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "provider edge router request kind is not recognized", "PROVIDER_EDGE_ROUTER_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "provider edge router evidence"); const evidence = input.evidence;
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "provider_identity", "provider_version", "signal", "target_ref", "scope", "requested_action", "provider_evidence"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  for (const key of ["custody_owner"]) if (evidence[key] !== undefined) safeId(evidence[key], key);
  if (evidence.custody_ref !== undefined) assert(OPAQUE_REF.test(evidence.custody_ref), "custody_ref is not opaque", "PROVIDER_EDGE_ROUTER_CUSTODY_REF_INVALID");
  if (evidence.requested_tools !== undefined) { assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "requested_tools is not bounded", "PROVIDER_EDGE_ROUTER_TOOL_LIST_INVALID"); for (const tool of evidence.requested_tools) bounded(tool, "requested_tool", 60); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "PROVIDER_EDGE_ROUTER_BOOLEAN_INVALID");
  assert(scanPersistedRecord(input).safe, "provider edge router evidence contains protected data", "PROVIDER_EDGE_ROUTER_PRIVACY_DENIED");
}
function missing(evidence) { return ["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "provider_identity", "provider_version", "signal", "target_ref", "context_complete", "scope", "requested_action", "provider_evidence"].filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === ""); }
export function evaluateProviderEdgeRouterBoundary(input) {
  validateInput(input); const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_PROVIDER_EDGE_SCOPE", "PROVIDER_EDGE_ROUTER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_ROUTER_SIDE_EFFECT", "PROVIDER_EDGE_ROUTER_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "PROVIDER_EDGE_ROUTER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "PROVIDER_EDGE_ROUTER_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "PROVIDER_EDGE_ROUTER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "PROVIDER_EDGE_ROUTER_PROTECTED_DATA_FORBIDDEN", input);
  const absent = missing(evidence); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "PROVIDER_EDGE_ROUTER_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.PLATFORM_PROVIDER_EDGE_ROUTER") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "PROVIDER_EDGE_ROUTER_AUTHORITY_UNVERIFIED", input);
  if (!OPAQUE_REF.test(evidence.custody_ref)) return result("DENY", "CUSTODY_BINDING_REQUIRED", "PROVIDER_EDGE_ROUTER_CUSTODY_UNBOUND", input);
  if (evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "PROVIDER_EDGE_ROUTER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (!SAFE_ID.test(evidence.source_identity) || evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "PROVIDER_EDGE_ROUTER_SOURCE_IDENTITY_INVALID", input);
  if (evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "PROVIDER_EDGE_ROUTER_CONTEXT_INCOMPLETE", input);
  if (evidence.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "PROVIDER_EDGE_ROUTER_SCOPE_INVALID", input);
  if (evidence.requested_action !== "CLASSIFY") return result("DENY", "TYPED_CONTEXT_REQUIRED", "PROVIDER_EDGE_ROUTER_ACTION_NOT_CLASSIFICATION", input);
  if (!Array.isArray(evidence.requested_tools) || evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "PROVIDER_EDGE_ROUTER_TOOL_SCOPE_FORBIDDEN", input);
  if (evidence.provider_evidence !== "BOUNDED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "PROVIDER_EDGE_ROUTER_EVIDENCE_UNBOUNDED", input);
  const route = TARGETS[evidence.signal]; if (!route) return result("DENY", "TYPED_CONTEXT_REQUIRED", "PROVIDER_EDGE_ROUTER_SIGNAL_UNSUPPORTED", input);
  if (evidence.provider_identity !== route.provider) return result("DENY", "SOURCE_REFRESH_REQUIRED", "PROVIDER_EDGE_ROUTER_PROVIDER_IDENTITY_INVALID", input);
  if (evidence.provider_version !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "PROVIDER_EDGE_ROUTER_PROVIDER_VERSION_INVALID", input);
  if (evidence.target_ref !== route.target) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "PROVIDER_EDGE_ROUTER_TARGET_MISMATCH", input);
  return result("ROUTE", "SPECIALIST_HANDOFF", "PROVIDER_EDGE_ROUTER_ROUTE_READY", input, {routing_allowed: true, selected_specialist: route.target, handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed provider and edge evidence to the selected atomic specialist; do not mutate provider or edge state.", execution_instruction: false}});
}
