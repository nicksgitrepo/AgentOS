#!/usr/bin/env node

/* Read-only Orchestrator coordination boundary.
 *
 * This gate classifies plans, integration evidence, and typed handoffs. It
 * never starts, admits, archives, despawns, merges, deploys, or changes a
 * project. Complete current records route to their named owner; anything
 * incomplete, stale, conflicting, or unsafe closes only the dependent route.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const ORCHESTRATOR_COORDINATION_BOUNDARY_SCHEMA = "agentos.orchestrator_coordination_boundary_input.v1";
export const ORCHESTRATOR_COORDINATION_RESULT_SCHEMA = "agentos.orchestrator_coordination_boundary_result.v1";

const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const REQUESTS = new Set([
  "PLAN_COORDINATION", "INTEGRATION_REVIEW", "HANDOFF_ROUTING", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "MERGE", "DEPLOY", "PUBLISH", "MUTATE_PROJECT", "APPROVE",
]);
const CLASSIFICATION_ACTIONS = new Set(["CLASSIFY_PLAN", "CLASSIFY_INTEGRATION", "CLASSIFY_HANDOFF"]);
const FORBIDDEN_REQUESTS = new Set(["SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "MERGE", "DEPLOY", "PUBLISH", "MUTATE_PROJECT", "APPROVE"]);
const EVIDENCE_KEYS = new Set([
  "authority", "custody", "candidate", "source_lock", "requested_action", "signals", "scope",
  "authority_scope", "sibling_authorities", "self_acceptance", "scope_expanded", "authority_conflict",
  "tool_mode", "requested_tools",
]);

function fail(message, code = "ORCHESTRATOR_COORDINATION_BOUNDARY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "ORCHESTRATOR_COORDINATION_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "ORCHESTRATOR_COORDINATION_UNKNOWN_FIELD");
}
function bounded(value, name) { assert(typeof value === "string" && value.length > 0 && value.length <= 240, `${name} must be bounded`, "ORCHESTRATOR_COORDINATION_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not a canonical identifier`, "ORCHESTRATOR_COORDINATION_ID_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: ORCHESTRATOR_COORDINATION_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    classification_allowed: false,
    external_side_effects: {
      spawn_calls: 0,
      admission_calls: 0,
      archive_calls: 0,
      despawn_calls: 0,
      merge_calls: 0,
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
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "orchestrator coordination input");
  assert(input.schema === ORCHESTRATOR_COORDINATION_BOUNDARY_SCHEMA && input.version === 1, "orchestrator coordination schema mismatch", "ORCHESTRATOR_COORDINATION_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "orchestrator request kind is not recognized", "ORCHESTRATOR_COORDINATION_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "orchestrator coordination evidence");
  const evidence = input.evidence;
  if (evidence.authority !== undefined) {
    exactKeys(evidence.authority, new Set(["status", "source_status"]), "orchestrator authority evidence");
    for (const key of ["status", "source_status"]) if (evidence.authority[key] !== undefined) bounded(evidence.authority[key], `authority.${key}`);
  }
  if (evidence.custody !== undefined) {
    exactKeys(evidence.custody, new Set(["status", "ref", "owner"]), "orchestrator custody evidence");
    bounded(evidence.custody.status, "custody.status");
    if (evidence.custody.ref !== undefined) assert(OPAQUE_REF.test(evidence.custody.ref), "custody reference is not opaque", "ORCHESTRATOR_CUSTODY_REF_INVALID");
    if (evidence.custody.owner !== undefined) safeId(evidence.custody.owner, "custody.owner");
  }
  if (evidence.candidate !== undefined) {
    exactKeys(evidence.candidate, new Set(["identity", "digest", "review_status", "package_scope"]), "orchestrator candidate evidence");
    if (evidence.candidate.identity !== undefined) safeId(evidence.candidate.identity, "candidate.identity");
    if (evidence.candidate.digest !== undefined) assert(/^[0-9a-f]{64}$/u.test(evidence.candidate.digest), "candidate.digest is not a SHA-256", "ORCHESTRATOR_CANDIDATE_DIGEST_INVALID");
    for (const key of ["review_status", "package_scope"]) if (evidence.candidate[key] !== undefined) bounded(evidence.candidate[key], `candidate.${key}`);
  }
  if (evidence.source_lock !== undefined) {
    exactKeys(evidence.source_lock, new Set(["status", "identity", "version"]), "orchestrator source lock");
    if (evidence.source_lock.status !== undefined) bounded(evidence.source_lock.status, "source_lock.status");
    if (evidence.source_lock.identity !== undefined) safeId(evidence.source_lock.identity, "source_lock.identity");
    if (evidence.source_lock.version !== undefined) bounded(evidence.source_lock.version, "source_lock.version");
  }
  if (evidence.requested_action !== undefined) bounded(evidence.requested_action, "requested_action");
  if (evidence.signals !== undefined) {
    assert(Array.isArray(evidence.signals) && evidence.signals.length <= 16, "signals must be a bounded list", "ORCHESTRATOR_SIGNAL_LIST_INVALID");
    for (const signal of evidence.signals) safeId(signal, "signal");
  }
  for (const key of ["scope", "authority_scope", "tool_mode"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.sibling_authorities !== undefined) {
    assert(Array.isArray(evidence.sibling_authorities) && evidence.sibling_authorities.length <= 8, "sibling authorities must be bounded", "ORCHESTRATOR_AUTHORITY_LIST_INVALID");
    for (const authority of evidence.sibling_authorities) safeId(authority, "sibling authority");
  }
  if (evidence.requested_tools !== undefined) {
    assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 8, "requested tools must be bounded", "ORCHESTRATOR_TOOL_LIST_INVALID");
    for (const tool of evidence.requested_tools) bounded(tool, "requested tool");
  }
  for (const key of ["self_acceptance", "scope_expanded", "authority_conflict"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "ORCHESTRATOR_BOOLEAN_INVALID");
  const privacy = scanPersistedRecord(input);
  assert(privacy.safe, "orchestrator evidence contains protected or secret-like data", "ORCHESTRATOR_COORDINATION_PRIVACY_DENIED");
}

function missingEvidence(input) {
  const evidence = input.evidence;
  return ["authority", "custody", "candidate", "source_lock", "requested_action", "signals"].filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === "");
}

export function evaluateOrchestratorCoordinationBoundary(input) {
  validateInput(input);
  const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_ORCHESTRATOR_SCOPE", "ORCHESTRATOR_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_WORKFLOW_SIDE_EFFECT", "ORCHESTRATOR_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "ORCHESTRATOR_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || evidence.authority?.status === "CONFLICT") return result("ESCALATE", "CONTROLLER_ESCALATION", "ORCHESTRATOR_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "ORCHESTRATOR_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.authority_scope === "UMBRELLA") return result("DENY", "NARROW_SCOPE_REQUIRED", "ORCHESTRATOR_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (evidence.tool_mode === "WRITE" || evidence.requested_tools?.some((tool) => /(?:spawn|admit|archive|despawn|merge|deploy|publish|credential|execute)/iu.test(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "ORCHESTRATOR_TOOL_SCOPE_FORBIDDEN", input);
  if (evidence.sibling_authorities?.length > 1 || evidence.sibling_authorities?.includes("DUPLICATE")) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "ORCHESTRATOR_DUPLICATE_AUTHORITY", input);
  const missing = missingEvidence(input);
  if (missing.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ORCHESTRATOR_CONTEXT_INCOMPLETE", input, {missing_fields: missing});
  if (evidence.authority.status !== "CURRENT" || evidence.authority.source_status !== "CURRENT") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "ORCHESTRATOR_AUTHORITY_UNVERIFIED", input);
  if (evidence.custody.status !== "BOUND" || evidence.custody.owner !== "AGENTOS.ORCHESTRATOR") return result("DENY", "CUSTODY_BINDING_REQUIRED", "ORCHESTRATOR_CUSTODY_UNBOUND", input);
  if (evidence.source_lock.status !== "CURRENT" || !SAFE_ID.test(evidence.source_lock.identity ?? "") || typeof evidence.source_lock.version !== "string" || evidence.source_lock.version.length === 0) return result("DENY", "SOURCE_REFRESH_REQUIRED", "ORCHESTRATOR_SOURCE_STALE_OR_UNVERIFIED", input);
  if (!SAFE_ID.test(evidence.candidate.identity ?? "") || !/^[0-9a-f]{64}$/u.test(evidence.candidate.digest ?? "")) return result("DENY", "CANDIDATE_CONTEXT_REQUIRED", "ORCHESTRATOR_CANDIDATE_IDENTITY_INVALID", input);
  if (evidence.candidate.review_status !== "INDEPENDENT_CURRENT") return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "ORCHESTRATOR_REVIEW_STALE_OR_MISSING", input);
  if (evidence.candidate.package_scope !== "ORCHESTRATOR_COORDINATION_ONLY") return result("DENY", "NARROW_SCOPE_REQUIRED", "ORCHESTRATOR_PACKAGE_SCOPE_INVALID", input);
  if (!CLASSIFICATION_ACTIONS.has(evidence.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ORCHESTRATOR_ACTION_NOT_CLASSIFICATION", input);
  if (evidence.signals.length === 0) return result("DENY", "TYPED_CONTEXT_REQUIRED", "ORCHESTRATOR_SIGNAL_CONTEXT_MISSING", input);
  const route = input.request_kind === "INTEGRATION_REVIEW" ? "INTEGRATION_OWNER_HANDOFF" : "CONTROLLER_ORCHESTRATOR_HANDOFF";
  return result("ROUTE", route, "ORCHESTRATOR_COORDINATION_EVIDENCE_READY", input, {handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed coordination evidence to the named owner; do not mutate workflow state or project files.", execution_instruction: false}});
}

