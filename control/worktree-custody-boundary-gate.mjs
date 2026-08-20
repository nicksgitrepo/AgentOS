#!/usr/bin/env node

/* Read-only Worktree/Custody Manager boundary. It binds candidate and
 * worktree evidence, checks clean and recovery readbacks, then routes a typed
 * custody handoff. It never merges, pushes, deletes, or accepts a candidate. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const WORKTREE_CUSTODY_BOUNDARY_SCHEMA = "agentos.worktree_custody_boundary_input.v1";
export const WORKTREE_CUSTODY_RESULT_SCHEMA = "agentos.worktree_custody_boundary_result.v1";
const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUESTS = new Set(["BIND_CANDIDATE", "VERIFY_CLEAN_READBACK", "RECONCILE_CUSTODY_RECEIPT", "ROUTE_CUSTODY_HANDOFF", "NOT_APPLICABLE", "UNRELATED_REQUEST", "MERGE", "PUSH", "DELETE", "REMOVE_WORKTREE", "DEPLOY", "PUBLISH", "ACTIVATE", "APPROVE", "ACCEPT", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "CHANGE_SCOPE"]);
const FORBIDDEN_REQUESTS = new Set(["MERGE", "PUSH", "DELETE", "REMOVE_WORKTREE", "DEPLOY", "PUBLISH", "ACTIVATE", "APPROVE", "ACCEPT", "SPAWN", "ADMIT", "ARCHIVE", "DESPAWN", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "CHANGE_SCOPE"]);
const ACTIONS = new Set(["BIND", "VERIFY", "RECONCILE", "ROUTE"]);
const ALLOWED_TOOLS = new Set(["READ_GIT_STATUS", "READ_WORKTREE_METADATA", "READ_CUSTODY_RECEIPT", "READ_PROVENANCE", "READ_CONTEXT"]);
const SIGNALS = new Set(["AGENT.WORKTREE_CUSTODY", "WORKTREE_CUSTODY", "CANDIDATE_IDENTITY", "CLEAN_READBACK", "CHANGED_PATHS", "CUSTODY_RECEIPT", "RECOVERY_RECEIPT"]);
const EVIDENCE_KEYS = new Set(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_identities", "candidate_identity", "candidate_digest", "candidate_status", "worktree_identity", "worktree_base", "worktree_status", "changed_paths_status", "changed_paths_digest", "changed_paths_count", "clean_readback_status", "remote_readback_status", "recovery_status", "requested_action", "signals", "context_complete", "handoff_ref", "model_policy_status", "model_task_class", "model_route_status", "standard_identities", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "unbound_receipt", "unreviewed_gate", "unknown_context", "destructive_action", "authority_scope", "sibling_authorities"]);

function fail(message, code = "WORKTREE_CUSTODY_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "WORKTREE_CUSTODY_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "WORKTREE_CUSTODY_UNKNOWN_FIELD"); }
function bounded(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} must be bounded`, "WORKTREE_CUSTODY_FIELD_INVALID"); }
function safeId(value, name) { bounded(value, name); assert(SAFE_ID.test(value), `${name} is not canonical`, "WORKTREE_CUSTODY_ID_INVALID"); }
function opaque(value, name) { bounded(value, name, 180); assert(OPAQUE_REF.test(value), `${name} is not opaque`, "WORKTREE_CUSTODY_REF_INVALID"); }
function digest(value, name) { bounded(value, name, 64); assert(SHA256.test(value), `${name} is not SHA-256`, "WORKTREE_CUSTODY_DIGEST_INVALID"); assert(!/^([0-9a-f])\1{63}$/u.test(value), `${name} is placeholder-like`, "WORKTREE_CUSTODY_DIGEST_PLACEHOLDER"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: WORKTREE_CUSTODY_RESULT_SCHEMA, version: 1, disposition, route, error_code: errorCode, routing_allowed: false, acceptance_allowed: false, external_side_effects: {worktree_reads: 0, custody_writes: 0, merge_calls: 0, push_calls: 0, delete_calls: 0, credential_accesses: 0, state_changes: 0}, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "worktree custody input");
  assert(input.schema === WORKTREE_CUSTODY_BOUNDARY_SCHEMA && input.version === 1, "worktree custody schema mismatch", "WORKTREE_CUSTODY_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "worktree custody request kind is not recognized", "WORKTREE_CUSTODY_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "worktree custody evidence"); const e = input.evidence;
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "candidate_status", "worktree_status", "changed_paths_status", "clean_readback_status", "remote_readback_status", "recovery_status", "requested_action", "model_policy_status", "model_task_class", "model_route_status", "authority_scope"]) if (e[key] !== undefined) bounded(e[key], `evidence.${key}`);
  for (const key of ["custody_owner", "candidate_identity"]) if (e[key] !== undefined) safeId(e[key], `evidence.${key}`);
  for (const key of ["custody_ref", "worktree_identity", "worktree_base", "handoff_ref"]) if (e[key] !== undefined) opaque(e[key], `evidence.${key}`);
  for (const key of ["candidate_digest", "changed_paths_digest"]) if (e[key] !== undefined) digest(e[key], `evidence.${key}`);
  if (e.changed_paths_count !== undefined) assert(Number.isInteger(e.changed_paths_count) && e.changed_paths_count >= 0 && e.changed_paths_count <= 4096, "changed path count is invalid", "WORKTREE_CUSTODY_COUNT_INVALID");
  for (const key of ["signals", "source_identities", "standard_identities", "requested_tools", "sibling_authorities"]) if (e[key] !== undefined) { assert(Array.isArray(e[key]) && e[key].length <= 8, `${key} must be bounded`, "WORKTREE_CUSTODY_LIST_INVALID"); for (const value of e[key]) safeId(value, key); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "unbound_receipt", "unreviewed_gate", "unknown_context", "destructive_action"]) if (e[key] !== undefined) assert(typeof e[key] === "boolean", `${key} must be boolean`, "WORKTREE_CUSTODY_BOOLEAN_INVALID");
  assert(scanPersistedRecord(input).safe, "worktree custody evidence contains protected or secret-like data", "WORKTREE_CUSTODY_PRIVACY_DENIED");
}
function missing(e) { return ["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identities", "candidate_identity", "candidate_digest", "candidate_status", "worktree_identity", "worktree_base", "worktree_status", "changed_paths_status", "changed_paths_digest", "changed_paths_count", "clean_readback_status", "remote_readback_status", "recovery_status", "requested_action", "signals", "context_complete", "handoff_ref", "model_policy_status", "model_task_class", "model_route_status", "standard_identities"].filter((key) => e[key] === undefined || e[key] === null || e[key] === "" || (Array.isArray(e[key]) && e[key].length === 0)); }

export function evaluateWorktreeCustodyBoundary(input) {
  validateInput(input); const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_CUSTODY_SCOPE", "WORKTREE_CUSTODY_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_CUSTODY_SIDE_EFFECT", "WORKTREE_CUSTODY_OPERATION_FORBIDDEN", input);
  if (e.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "WORKTREE_CUSTODY_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (e.authority_conflict === true) return result("DENY", "CONTROLLER_ESCALATION", "WORKTREE_CUSTODY_AUTHORITY_CONFLICT", input);
  if (e.scope_expanded === true || e.destructive_action === true) return result("DENY", "NARROW_SCOPE_REQUIRED", "WORKTREE_CUSTODY_SCOPE_EXPANSION_FORBIDDEN", input);
  if (e.project_data_present === true || e.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "WORKTREE_CUSTODY_PROTECTED_DATA_FORBIDDEN", input);
  if (e.unbound_receipt === true || e.unreviewed_gate === true || e.unknown_context === true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "WORKTREE_CUSTODY_EVIDENCE_UNBOUND", input);
  if (e.authority_scope === "UMBRELLA") return result("DENY", "NARROW_SCOPE_REQUIRED", "WORKTREE_CUSTODY_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (e.sibling_authorities?.length > 1 || e.sibling_authorities?.includes("DUPLICATE")) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "WORKTREE_CUSTODY_DUPLICATE_AUTHORITY", input);
  const absent = missing(e); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "WORKTREE_CUSTODY_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.custody_owner !== "AGENT.CONTROL_WORKTREE_CUSTODY") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "WORKTREE_CUSTODY_AUTHORITY_UNVERIFIED", input);
  if (e.source_status !== "CURRENT" || e.source_version !== "1.2" || !Array.isArray(e.source_identities) || e.source_identities.length !== 3 || new Set(e.source_identities).size !== 3 || !e.source_identities.includes("SOURCE.ATOMIC_SPECIALIZATION_LAW") || !e.source_identities.includes("SOURCE.GIT_WORKTREE") || !e.source_identities.includes("SOURCE.SLSA_PROVENANCE")) return result("DENY", "SOURCE_REFRESH_REQUIRED", "WORKTREE_CUSTODY_SOURCE_STALE_OR_UNVERIFIED", input);
  if (e.candidate_status !== "CURRENT_CANDIDATE" || e.worktree_status !== "BOUND" || e.changed_paths_status !== "BOUND") return result("DENY", "CANDIDATE_CONTEXT_REQUIRED", "WORKTREE_CUSTODY_BINDING_INVALID", input);
  if (e.context_complete !== true || e.clean_readback_status !== "CURRENT" || e.remote_readback_status !== "MATCHED" || e.recovery_status !== "CURRENT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "WORKTREE_CUSTODY_READBACK_INCOMPLETE", input);
  if (!ACTIONS.has(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "WORKTREE_CUSTODY_ACTION_INVALID", input);
  if (!Array.isArray(e.requested_tools) || e.requested_tools.length === 0 || e.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "WORKTREE_CUSTODY_TOOL_SCOPE_FORBIDDEN", input);
  if (!Array.isArray(e.signals) || e.signals.length === 0 || e.signals.some((signal) => !SIGNALS.has(signal))) return result("DENY", "TYPED_CONTEXT_REQUIRED", "WORKTREE_CUSTODY_SIGNAL_UNSUPPORTED", input);
  if (!Array.isArray(e.standard_identities) || e.standard_identities.length !== 2 || new Set(e.standard_identities).size !== 2 || !e.standard_identities.includes("SPECIALIST.STANDARD.NIST_SSDF") || !e.standard_identities.includes("SPECIALIST.STANDARD.SLSA")) return result("DENY", "SOURCE_REFRESH_REQUIRED", "WORKTREE_CUSTODY_STANDARD_BINDING_INVALID", input);
  if (e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND" || e.model_task_class !== "DETERMINISTIC_QA") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "WORKTREE_CUSTODY_MODEL_ROUTE_INVALID", input);
  return result("ROUTE", "SPAWNER_CUSTODY_HANDOFF", "WORKTREE_CUSTODY_ROUTE_READY", input, {routing_allowed: true, selected_owner: "AGENTOS.SPAWNER", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Route typed worktree and custody evidence to Spawner; do not merge, push, delete, or accept.", execution_instruction: false}});
}
