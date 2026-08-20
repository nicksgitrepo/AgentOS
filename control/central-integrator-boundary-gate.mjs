#!/usr/bin/env node

/* Read-only Central Integrator boundary.
 *
 * This boundary coordinates evidence about dependency order, authority edges,
 * block locks, and typed handoffs.  It never accepts a candidate, changes a
 * project, merges, deploys, or changes another agent's custody.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const CENTRAL_INTEGRATOR_BOUNDARY_SCHEMA = "agentos.central_integrator_boundary_input.v1";
export const CENTRAL_INTEGRATOR_RESULT_SCHEMA = "agentos.central_integrator_boundary_result.v1";

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUESTS = new Set([
  "COORDINATE_INTEGRATION",
  "RECONCILE_AUTHORITY_GRAPH",
  "CLASSIFY_HANDOFF",
  "NOT_APPLICABLE",
  "UNRELATED_REQUEST",
  "SPAWN",
  "ADMIT",
  "ARCHIVE",
  "DESPAWN",
  "MERGE",
  "DEPLOY",
  "PUBLISH",
  "WRITE_PROJECT",
  "WRITE_MEMORY",
  "ACCEPT",
  "SELF_REVIEW",
]);
const FORBIDDEN_REQUESTS = new Set(["SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "MERGE", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW"]);
const ACTIONS = new Set(["RECONCILE", "ORDER_DEPENDENCIES", "ROUTE_HANDOFF", "CLASSIFY_CONFLICT"]);
const ALLOWED_TOOLS = new Set(["READ_MANIFEST", "READ_RECEIPTS", "READ_CONTEXT", "READ_SOURCE_LOCK"]);
const SIGNALS = new Set(["AGENT.CENTRAL_INTEGRATOR", "AUTHORITY_GRAPH", "BLOCK_LOCK", "CENTRAL_INTEGRATION", "DEPENDENCY_ORDER", "TYPED_HANDOFF"]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
  "candidate_identity", "candidate_digest", "candidate_status", "integration_scope", "authority_scope", "requested_action", "signals", "context_complete",
  "handoff_ref", "dependencies_status", "conflicts_status", "proof_status", "provenance_status", "model_policy_status", "model_task_class",
  "model_route_status", "standard_identities", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict",
  "sibling_authorities", "project_data_present", "secret_data_present", "unbound_receipt", "unreviewed_gate", "unknown_context",
]);

function fail(message, code = "CENTRAL_INTEGRATOR_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "CENTRAL_INTEGRATOR_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "CENTRAL_INTEGRATOR_UNKNOWN_FIELD");
}
function bounded(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} must be bounded`, "CENTRAL_INTEGRATOR_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not canonical`, "CENTRAL_INTEGRATOR_ID_INVALID"); }
function opaque(value, name) { bounded(value, name, 180); assert(OPAQUE_REF.test(value), `${name} is not opaque`, "CENTRAL_INTEGRATOR_REF_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: CENTRAL_INTEGRATOR_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    error_code: errorCode,
    routing_allowed: false,
    acceptance_allowed: false,
    external_side_effects: {
      dependency_reads: 0,
      receipt_writes: 0,
      project_writes: 0,
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
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "central integrator input");
  assert(input.schema === CENTRAL_INTEGRATOR_BOUNDARY_SCHEMA && input.version === 1, "central integrator schema mismatch", "CENTRAL_INTEGRATOR_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "central integrator request kind is not recognized", "CENTRAL_INTEGRATOR_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "central integrator evidence");
  const evidence = input.evidence;
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "candidate_status", "integration_scope", "authority_scope", "requested_action", "dependencies_status", "conflicts_status", "proof_status", "provenance_status", "model_policy_status", "model_task_class", "model_route_status"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  for (const key of ["custody_owner", "candidate_identity"]) if (evidence[key] !== undefined) safeId(evidence[key], `evidence.${key}`);
  for (const key of ["custody_ref", "handoff_ref"]) if (evidence[key] !== undefined) opaque(evidence[key], `evidence.${key}`);
  if (evidence.candidate_digest !== undefined) { bounded(evidence.candidate_digest, "evidence.candidate_digest", 64); assert(SHA256.test(evidence.candidate_digest), "candidate digest is not SHA-256", "CENTRAL_INTEGRATOR_DIGEST_INVALID"); assert(!/^([0-9a-f])\1{63}$/u.test(evidence.candidate_digest), "candidate digest is placeholder-like", "CENTRAL_INTEGRATOR_DIGEST_PLACEHOLDER"); }
  if (evidence.signals !== undefined) { assert(Array.isArray(evidence.signals) && evidence.signals.length <= 8, "signals must be bounded", "CENTRAL_INTEGRATOR_SIGNAL_LIST_INVALID"); for (const signal of evidence.signals) { safeId(signal, "signal"); } }
  if (evidence.standard_identities !== undefined) { assert(Array.isArray(evidence.standard_identities) && evidence.standard_identities.length <= 4, "standard identities must be bounded", "CENTRAL_INTEGRATOR_STANDARD_LIST_INVALID"); for (const standard of evidence.standard_identities) safeId(standard, "standard identity"); }
  if (evidence.requested_tools !== undefined) { assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 6, "requested tools must be bounded", "CENTRAL_INTEGRATOR_TOOL_LIST_INVALID"); for (const tool of evidence.requested_tools) safeId(tool, "requested tool"); }
  if (evidence.sibling_authorities !== undefined) { assert(Array.isArray(evidence.sibling_authorities) && evidence.sibling_authorities.length <= 6, "sibling authorities must be bounded", "CENTRAL_INTEGRATOR_AUTHORITY_LIST_INVALID"); for (const sibling of evidence.sibling_authorities) safeId(sibling, "sibling authority"); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "unbound_receipt", "unreviewed_gate", "unknown_context"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "CENTRAL_INTEGRATOR_BOOLEAN_INVALID");
  assert(scanPersistedRecord(input).safe, "central integrator evidence contains protected or secret-like data", "CENTRAL_INTEGRATOR_PRIVACY_DENIED");
}
function missing(evidence) {
  return ["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "candidate_identity", "candidate_digest", "candidate_status", "integration_scope", "requested_action", "signals", "context_complete", "handoff_ref", "dependencies_status", "conflicts_status", "proof_status", "provenance_status", "model_policy_status", "model_task_class", "model_route_status", "standard_identities"].filter((key) => evidence[key] === undefined || evidence[key] === null || evidence[key] === "");
}

export function evaluateCentralIntegratorBoundary(input) {
  validateInput(input);
  const evidence = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_CENTRAL_INTEGRATION_SCOPE", "CENTRAL_INTEGRATOR_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_INTEGRATION_SIDE_EFFECT", "CENTRAL_INTEGRATOR_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "CENTRAL_INTEGRATOR_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || evidence.conflicts_status === "CONFLICT") return result("DENY", "CONTROLLER_ESCALATION", "CENTRAL_INTEGRATOR_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.integration_scope === "BROAD" || evidence.integration_scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "CENTRAL_INTEGRATOR_SCOPE_EXPANSION_FORBIDDEN", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "CENTRAL_INTEGRATOR_PROTECTED_DATA_FORBIDDEN", input);
  if (evidence.unbound_receipt === true || evidence.unreviewed_gate === true || evidence.unknown_context === true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "CENTRAL_INTEGRATOR_EVIDENCE_UNBOUND", input);
  if (evidence.authority_scope === "UMBRELLA") return result("DENY", "NARROW_SCOPE_REQUIRED", "CENTRAL_INTEGRATOR_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (evidence.sibling_authorities?.length > 1 || evidence.sibling_authorities?.includes("DUPLICATE")) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "CENTRAL_INTEGRATOR_DUPLICATE_AUTHORITY", input);
  const absent = missing(evidence); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "CENTRAL_INTEGRATOR_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.CONTROL_CENTRAL_INTEGRATOR") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "CENTRAL_INTEGRATOR_AUTHORITY_UNVERIFIED", input);
  if (evidence.source_status !== "CURRENT" || evidence.source_identity !== "SOURCE.SLSA_PROVENANCE" || evidence.source_version !== "1.2") return result("DENY", "SOURCE_REFRESH_REQUIRED", "CENTRAL_INTEGRATOR_SOURCE_STALE_OR_UNVERIFIED", input);
  if (evidence.candidate_status !== "CURRENT_CANDIDATE" || evidence.integration_scope !== "NARROW_GOVERNANCE") return result("DENY", "CANDIDATE_CONTEXT_REQUIRED", "CENTRAL_INTEGRATOR_CANDIDATE_SCOPE_INVALID", input);
  if (evidence.context_complete !== true || evidence.dependencies_status !== "COMPLETE" || evidence.proof_status !== "BOUND" || evidence.provenance_status !== "BOUND" || evidence.conflicts_status !== "NONE") return result("DENY", "TYPED_CONTEXT_REQUIRED", "CENTRAL_INTEGRATOR_CONTEXT_INCOMPLETE", input);
  if (!ACTIONS.has(evidence.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "CENTRAL_INTEGRATOR_ACTION_INVALID", input);
  if (!Array.isArray(evidence.requested_tools) || evidence.requested_tools.length === 0 || evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "CENTRAL_INTEGRATOR_TOOL_SCOPE_FORBIDDEN", input);
  if (!Array.isArray(evidence.signals) || evidence.signals.length === 0 || evidence.signals.some((signal) => !SIGNALS.has(signal))) return result("DENY", "TYPED_CONTEXT_REQUIRED", "CENTRAL_INTEGRATOR_SIGNAL_UNSUPPORTED", input);
  if (!Array.isArray(evidence.standard_identities) || evidence.standard_identities.length !== 2 || new Set(evidence.standard_identities).size !== 2 || !evidence.standard_identities.includes("SPECIALIST.STANDARD.NIST_SSDF") || !evidence.standard_identities.includes("SPECIALIST.STANDARD.SLSA")) return result("DENY", "SOURCE_REFRESH_REQUIRED", "CENTRAL_INTEGRATOR_STANDARD_BINDING_INVALID", input);
  if (evidence.model_policy_status !== "CURRENT" || evidence.model_route_status !== "BOUND" || evidence.model_task_class !== "DETERMINISTIC_QA") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "CENTRAL_INTEGRATOR_MODEL_ROUTE_INVALID", input);
  return result("ROUTE", "CONTROLLER_INTEGRATION_HANDOFF", "CENTRAL_INTEGRATOR_ROUTE_READY", input, {routing_allowed: true, selected_owner: "AGENTOS_CONTROLLER", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed integration evidence to Controller; do not mutate project, roster, merge, deployment, or acceptance state.", execution_instruction: false}});
}
