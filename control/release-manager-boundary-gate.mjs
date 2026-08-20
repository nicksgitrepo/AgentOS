#!/usr/bin/env node

/* Read-only Release Manager boundary. It checks version, change, proof,
 * provenance, and rollback evidence, then routes a typed readiness handoff.
 * It never merges, publishes, deploys, or accepts a release.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const RELEASE_MANAGER_BOUNDARY_SCHEMA = "agentos.release_manager_boundary_input.v1";
export const RELEASE_MANAGER_RESULT_SCHEMA = "agentos.release_manager_boundary_result.v1";
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUESTS = new Set(["ASSESS_RELEASE_READINESS", "CLASSIFY_VERSION_CHANGE", "RECONCILE_ROLLBACK_PROOF", "ROUTE_RELEASE_HANDOFF", "NOT_APPLICABLE", "UNRELATED_REQUEST", "MERGE", "DEPLOY", "PUBLISH", "ACTIVATE", "APPROVE", "ACCEPT", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW"]);
const FORBIDDEN_REQUESTS = new Set(["MERGE", "DEPLOY", "PUBLISH", "ACTIVATE", "APPROVE", "ACCEPT", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW"]);
const ACTIONS = new Set(["ASSESS", "CLASSIFY", "RECONCILE", "ROUTE"]);
const ALLOWED_TOOLS = new Set(["READ_RELEASE_MANIFEST", "READ_CHANGE_RECEIPTS", "READ_ROLLBACK_PROOF", "READ_CONTEXT"]);
const SIGNALS = new Set(["AGENT.RELEASE_MANAGER", "RELEASE_READINESS", "ROLLBACK_EVIDENCE", "VERSION_CHANGE", "PROVENANCE", "CHANGE_RECEIPT"]);
const EVIDENCE_KEYS = new Set(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_identities", "release_identity", "release_digest", "release_status", "release_scope", "requested_action", "signals", "context_complete", "handoff_ref", "version_status", "changes_status", "proof_status", "rollback_status", "provenance_status", "model_policy_status", "model_task_class", "model_route_status", "standard_identities", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "unbound_receipt", "unreviewed_gate", "unknown_context", "authority_scope", "sibling_authorities"]);

function fail(message, code = "RELEASE_MANAGER_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "RELEASE_MANAGER_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "RELEASE_MANAGER_UNKNOWN_FIELD"); }
function bounded(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} must be bounded`, "RELEASE_MANAGER_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not canonical`, "RELEASE_MANAGER_ID_INVALID"); }
function opaque(value, name) { bounded(value, name, 180); assert(OPAQUE_REF.test(value), `${name} is not opaque`, "RELEASE_MANAGER_REF_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: RELEASE_MANAGER_RESULT_SCHEMA, version: 1, disposition, route, error_code: errorCode, routing_allowed: false, acceptance_allowed: false, external_side_effects: {release_reads: 0, receipt_writes: 0, merge_calls: 0, deployment_calls: 0, publish_calls: 0, credential_accesses: 0, state_changes: 0}, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "release manager input"); assert(input.schema === RELEASE_MANAGER_BOUNDARY_SCHEMA && input.version === 1, "release manager schema mismatch", "RELEASE_MANAGER_SCHEMA_MISMATCH"); assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "release manager request kind is not recognized", "RELEASE_MANAGER_REQUEST_INVALID"); exactKeys(input.evidence, EVIDENCE_KEYS, "release manager evidence"); const e = input.evidence;
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "release_status", "release_scope", "requested_action", "version_status", "changes_status", "proof_status", "rollback_status", "provenance_status", "model_policy_status", "model_task_class", "model_route_status", "authority_scope"]) if (e[key] !== undefined) bounded(e[key], `evidence.${key}`);
  for (const key of ["custody_owner", "release_identity"]) if (e[key] !== undefined) safeId(e[key], `evidence.${key}`);
  for (const key of ["custody_ref", "handoff_ref"]) if (e[key] !== undefined) opaque(e[key], `evidence.${key}`);
  if (e.release_digest !== undefined) { bounded(e.release_digest, "evidence.release_digest", 64); assert(SHA256.test(e.release_digest), "release digest is not SHA-256", "RELEASE_MANAGER_DIGEST_INVALID"); assert(!/^([0-9a-f])\1{63}$/u.test(e.release_digest), "release digest is placeholder-like", "RELEASE_MANAGER_DIGEST_PLACEHOLDER"); }
  for (const key of ["signals", "source_identities", "standard_identities", "requested_tools", "sibling_authorities"]) if (e[key] !== undefined) { assert(Array.isArray(e[key]) && e[key].length <= 8, `${key} must be bounded`, "RELEASE_MANAGER_LIST_INVALID"); for (const value of e[key]) safeId(value, key); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "unbound_receipt", "unreviewed_gate", "unknown_context"]) if (e[key] !== undefined) assert(typeof e[key] === "boolean", `${key} must be boolean`, "RELEASE_MANAGER_BOOLEAN_INVALID");
  assert(scanPersistedRecord(input).safe, "release manager evidence contains protected or secret-like data", "RELEASE_MANAGER_PRIVACY_DENIED");
}
function missing(e) { return ["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identities", "release_identity", "release_digest", "release_status", "release_scope", "requested_action", "signals", "context_complete", "handoff_ref", "version_status", "changes_status", "proof_status", "rollback_status", "provenance_status", "model_policy_status", "model_task_class", "model_route_status", "standard_identities"].filter((key) => e[key] === undefined || e[key] === null || e[key] === "" || (Array.isArray(e[key]) && e[key].length === 0)); }
export function evaluateReleaseManagerBoundary(input) {
  validateInput(input); const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_RELEASE_SCOPE", "RELEASE_MANAGER_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_RELEASE_SIDE_EFFECT", "RELEASE_MANAGER_OPERATION_FORBIDDEN", input);
  if (e.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "RELEASE_MANAGER_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (e.authority_conflict === true) return result("DENY", "CONTROLLER_ESCALATION", "RELEASE_MANAGER_AUTHORITY_CONFLICT", input);
  if (e.scope_expanded === true || e.release_scope === "BROAD" || e.release_scope === "UNRELATED") return result("DENY", "NARROW_SCOPE_REQUIRED", "RELEASE_MANAGER_SCOPE_EXPANSION_FORBIDDEN", input);
  if (e.project_data_present === true || e.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "RELEASE_MANAGER_PROTECTED_DATA_FORBIDDEN", input);
  if (e.unbound_receipt === true || e.unreviewed_gate === true || e.unknown_context === true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RELEASE_MANAGER_EVIDENCE_UNBOUND", input);
  if (e.authority_scope === "UMBRELLA") return result("DENY", "NARROW_SCOPE_REQUIRED", "RELEASE_MANAGER_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (e.sibling_authorities?.length > 1 || e.sibling_authorities?.includes("DUPLICATE")) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "RELEASE_MANAGER_DUPLICATE_AUTHORITY", input);
  const absent = missing(e); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RELEASE_MANAGER_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.custody_owner !== "AGENT.CONTROL_RELEASE_MANAGER") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "RELEASE_MANAGER_AUTHORITY_UNVERIFIED", input);
  if (e.source_status !== "CURRENT" || e.source_version !== "2.0.0" || !Array.isArray(e.source_identities) || e.source_identities.length !== 3 || new Set(e.source_identities).size !== 3 || !e.source_identities.includes("SOURCE.SEMANTIC_VERSIONING_2_0_0") || !e.source_identities.includes("SOURCE.CONVENTIONAL_COMMITS_1_0_0") || !e.source_identities.includes("SOURCE.SLSA_PROVENANCE")) return result("DENY", "SOURCE_REFRESH_REQUIRED", "RELEASE_MANAGER_SOURCE_STALE_OR_UNVERIFIED", input);
  if (e.release_status !== "CURRENT_CANDIDATE" || e.release_scope !== "NARROW_RELEASE_READINESS") return result("DENY", "CANDIDATE_CONTEXT_REQUIRED", "RELEASE_MANAGER_RELEASE_SCOPE_INVALID", input);
  if (e.context_complete !== true || e.version_status !== "BOUND" || e.changes_status !== "BOUND" || e.proof_status !== "BOUND" || e.rollback_status !== "BOUND" || e.provenance_status !== "BOUND") return result("DENY", "TYPED_CONTEXT_REQUIRED", "RELEASE_MANAGER_CONTEXT_INCOMPLETE", input);
  if (!ACTIONS.has(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RELEASE_MANAGER_ACTION_INVALID", input);
  if (!Array.isArray(e.requested_tools) || e.requested_tools.length === 0 || e.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "RELEASE_MANAGER_TOOL_SCOPE_FORBIDDEN", input);
  if (!Array.isArray(e.signals) || e.signals.length === 0 || e.signals.some((signal) => !SIGNALS.has(signal))) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RELEASE_MANAGER_SIGNAL_UNSUPPORTED", input);
  if (!Array.isArray(e.standard_identities) || e.standard_identities.length !== 4 || new Set(e.standard_identities).size !== 4 || !e.standard_identities.includes("SPECIALIST.STANDARD.CONVENTIONAL_COMMITS_1_0_0") || !e.standard_identities.includes("SPECIALIST.STANDARD.NIST_SSDF") || !e.standard_identities.includes("SPECIALIST.STANDARD.SEMANTIC_VERSIONING_2_0_0") || !e.standard_identities.includes("SPECIALIST.STANDARD.SLSA")) return result("DENY", "SOURCE_REFRESH_REQUIRED", "RELEASE_MANAGER_STANDARD_BINDING_INVALID", input);
  if (e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.model_task_class !== "DETERMINISTIC_QA") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "RELEASE_MANAGER_MODEL_ROUTE_INVALID", input);
  return result("ROUTE", "CONTROLLER_RELEASE_HANDOFF", "RELEASE_MANAGER_ROUTE_READY", input, {routing_allowed: true, selected_owner: "AGENTOS_CONTROLLER", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed release-readiness evidence to Controller and Runtime; do not merge, publish, deploy, or accept.", execution_instruction: false}});
}
