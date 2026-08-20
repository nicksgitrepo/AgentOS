#!/usr/bin/env node

/* Read-only Scheduler boundary.
 *
 * This is evidence classification, not a scheduler implementation.  It never
 * allocates, throttles, evicts, kills, executes, or changes a resource.  A
 * complete typed record is routed to the named resource owner; incomplete,
 * stale, conflicting, or unsafe records close only the dependent decision.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const SCHEDULER_RESOURCE_BOUNDARY_SCHEMA = "agentos.scheduler_resource_boundary_input.v1";
export const SCHEDULER_RESOURCE_RESULT_SCHEMA = "agentos.scheduler_resource_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:-]{1,160}$/u;
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,96}$/u;
const REQUESTS = new Set([
  "RESOURCE_ADMISSION", "RESOURCE_PRESSURE", "RESOURCE_ROUTING", "NOT_APPLICABLE",
  "UNRELATED_REQUEST", "ALLOCATE", "THROTTLE", "EVICT", "EXECUTE", "DEPLOY",
]);
const CLASSIFICATION_ACTIONS = new Set(["CLASSIFY_ADMISSION", "CLASSIFY_PRESSURE", "CLASSIFY_ROUTING"]);
const FORBIDDEN_REQUESTS = new Set(["ALLOCATE", "THROTTLE", "EVICT", "EXECUTE", "DEPLOY"]);
const EVIDENCE_KEYS = new Set([
  "authority", "custody", "resource", "source_lock", "requested_action", "signals", "scope",
  "provider_claim", "data_class", "authority_scope", "sibling_authorities", "self_acceptance", "scope_expanded",
  "authority_conflict", "tool_mode", "requested_tools",
]);

function fail(message, code = "SCHEDULER_RESOURCE_BOUNDARY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "SCHEDULER_RESOURCE_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "SCHEDULER_RESOURCE_UNKNOWN_FIELD");
}
function bounded(value, name) { assert(typeof value === "string" && value.length > 0 && value.length <= 240, `${name} must be bounded`, "SCHEDULER_RESOURCE_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not a canonical identifier`, "SCHEDULER_RESOURCE_ID_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: SCHEDULER_RESOURCE_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    classification_allowed: false,
    external_side_effects: {
      allocation_calls: 0,
      throttle_calls: 0,
      eviction_calls: 0,
      process_calls: 0,
      deployment_calls: 0,
      credential_accesses: 0,
      state_changes: 0,
    },
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "scheduler resource input");
  assert(input.schema === SCHEDULER_RESOURCE_BOUNDARY_SCHEMA && input.version === 1, "scheduler resource schema mismatch", "SCHEDULER_RESOURCE_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "scheduler request kind is not recognized", "SCHEDULER_RESOURCE_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "scheduler resource evidence");
  const evidence = input.evidence;
  if (evidence.authority !== undefined) {
    exactKeys(evidence.authority, new Set(["status", "source_status"]), "scheduler authority evidence");
    for (const key of ["status", "source_status"]) if (evidence.authority[key] !== undefined) bounded(evidence.authority[key], `authority.${key}`);
  }
  if (evidence.custody !== undefined) {
    exactKeys(evidence.custody, new Set(["status", "ref", "owner"]), "scheduler custody evidence");
    bounded(evidence.custody.status, "custody.status");
    if (evidence.custody.ref !== undefined) assert(OPAQUE_REF.test(evidence.custody.ref), "custody reference is not opaque", "SCHEDULER_CUSTODY_REF_INVALID");
    if (evidence.custody.owner !== undefined) safeId(evidence.custody.owner, "custody.owner");
  }
  if (evidence.resource !== undefined) {
    exactKeys(evidence.resource, new Set(["identity", "unit", "observed_value", "capacity", "window"]), "resource evidence");
    if (evidence.resource.identity !== undefined) safeId(evidence.resource.identity, "resource.identity");
    if (evidence.resource.unit !== undefined) bounded(evidence.resource.unit, "resource.unit");
    for (const key of ["observed_value", "capacity"]) if (evidence.resource[key] !== undefined) assert(Number.isFinite(evidence.resource[key]) && evidence.resource[key] >= 0, `resource.${key} is invalid`, "SCHEDULER_RESOURCE_VALUE_INVALID");
    if (evidence.resource.window !== undefined) bounded(evidence.resource.window, "resource.window");
  }
  if (evidence.source_lock !== undefined) {
    exactKeys(evidence.source_lock, new Set(["status", "identity", "version"]), "scheduler source lock");
    if (evidence.source_lock.status !== undefined) bounded(evidence.source_lock.status, "source_lock.status");
    if (evidence.source_lock.identity !== undefined) safeId(evidence.source_lock.identity, "source_lock.identity");
    if (evidence.source_lock.version !== undefined) bounded(evidence.source_lock.version, "source_lock.version");
  }
  if (evidence.requested_action !== undefined) bounded(evidence.requested_action, "requested_action");
  if (evidence.signals !== undefined) {
    assert(Array.isArray(evidence.signals) && evidence.signals.length <= 16, "signals must be a bounded list", "SCHEDULER_SIGNAL_LIST_INVALID");
    for (const signal of evidence.signals) safeId(signal, "signal");
  }
  for (const key of ["scope", "provider_claim", "data_class", "authority_scope", "tool_mode"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.sibling_authorities !== undefined) {
    assert(Array.isArray(evidence.sibling_authorities) && evidence.sibling_authorities.length <= 8, "sibling authorities must be bounded", "SCHEDULER_AUTHORITY_LIST_INVALID");
    for (const authority of evidence.sibling_authorities) safeId(authority, "sibling authority");
  }
  if (evidence.requested_tools !== undefined) {
    assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 8, "requested tools must be bounded", "SCHEDULER_TOOL_LIST_INVALID");
    for (const tool of evidence.requested_tools) bounded(tool, "requested tool");
  }
  for (const key of ["self_acceptance", "scope_expanded", "authority_conflict"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "SCHEDULER_BOOLEAN_INVALID");
  const privacy = scanPersistedRecord(input);
  assert(privacy.safe, "scheduler evidence contains protected or secret-like data", "SCHEDULER_RESOURCE_PRIVACY_DENIED");
}

function missingEvidence(input) {
  const evidence = input.evidence;
  const missing = ["authority", "custody", "resource", "source_lock", "requested_action", "signals"];
  return missing.filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === "");
}

export function evaluateSchedulerResourceBoundary(input) {
  validateInput(input);
  const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_RESOURCE_SCOPE", "SCHEDULER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_EXTERNAL_STATE_CHANGE", "SCHEDULER_EXTERNAL_STATE_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "SCHEDULER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || evidence.authority?.status === "CONFLICT") return result("ESCALATE", "CONTROLLER_ESCALATION", "SCHEDULER_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "SCHEDULER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.authority_scope === "UMBRELLA") return result("DENY", "NARROW_SCOPE_REQUIRED", "SCHEDULER_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (evidence.provider_claim === "UNBOUND") return result("DENY", "APPLICABILITY_REQUIRED", "SCHEDULER_PROVIDER_VERSION_UNBOUND", input);
  if (evidence.data_class === "PROTECTED") return result("DENY", "AGGREGATE_DATA_REQUIRED", "SCHEDULER_PROTECTED_DATA_FORBIDDEN", input);
  if (evidence.tool_mode === "WRITE" || evidence.requested_tools?.some((tool) => /(?:allocate|throttle|evict|kill|execute|deploy|credential)/iu.test(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "SCHEDULER_TOOL_SCOPE_FORBIDDEN", input);
  if (evidence.sibling_authorities?.length > 1 || evidence.sibling_authorities?.includes("DUPLICATE")) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "SCHEDULER_DUPLICATE_AUTHORITY", input);
  const missing = missingEvidence(input);
  if (missing.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "SCHEDULER_CONTEXT_INCOMPLETE", input, {missing_fields: missing});
  if (evidence.authority.status !== "CURRENT" || evidence.authority.source_status !== "CURRENT") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "SCHEDULER_AUTHORITY_UNVERIFIED", input);
  if (evidence.custody.status !== "BOUND") return result("DENY", "CUSTODY_BINDING_REQUIRED", "SCHEDULER_CUSTODY_UNBOUND", input);
  if (evidence.source_lock.status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "SCHEDULER_SOURCE_STALE_OR_UNVERIFIED", input);
  const resource = evidence.resource;
  if (!SAFE_ID.test(resource.identity ?? "") || !resource.unit || !Number.isFinite(resource.observed_value) || !Number.isFinite(resource.capacity) || !resource.window) return result("DENY", "RESOURCE_CONTEXT_REQUIRED", "SCHEDULER_RESOURCE_CONTEXT_INVALID", input);
  if (!CLASSIFICATION_ACTIONS.has(evidence.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "SCHEDULER_ACTION_NOT_CLASSIFICATION", input);
  if (evidence.signals.length === 0) return result("DENY", "RESOURCE_CONTEXT_REQUIRED", "SCHEDULER_SIGNAL_CONTEXT_MISSING", input);
  return result("ROUTE", "RESOURCE_OWNER_HANDOFF", "SCHEDULER_RESOURCE_EVIDENCE_READY", input, {handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed resource evidence to the named owner; do not allocate or change external state.", execution_instruction: false}});
}
