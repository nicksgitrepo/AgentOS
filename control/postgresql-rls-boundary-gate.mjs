#!/usr/bin/env node

/*
 * Read-only PostgreSQL Row-Level Security specialist boundary.
 *
 * The boundary accepts a typed request, but the caller does not supply the
 * authority that makes a request current.  Canonical package, standard,
 * source, model, context, and upstream-router evidence are resolved from the
 * repository by postgresql-rls-authority-binding.mjs and every supplied value
 * is compared against that readback before analysis can route.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {
  assertPostgresqlRlsCanonicalEvidence,
  resolvePostgresqlRlsCanonicalAuthority,
  POSTGRESQL_RLS_BLOCK_ID,
} from "./postgresql-rls-authority-binding.mjs";

export const POSTGRESQL_RLS_INPUT_SCHEMA = "agentos.postgresql_rls_boundary_input.v1";
export const POSTGRESQL_RLS_RESULT_SCHEMA = "agentos.postgresql_rls_boundary_result.v1";

const SAFE_ID = /^[A-Za-z][A-Za-z0-9._:-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const REQUESTS = new Set([
  "ANALYZE_POSTGRES_RLS", "ROUTE_POSTGRES_RLS", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH",
  "WRITE_PROJECT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "MUTATE_POLICY",
]);
const FORBIDDEN_REQUESTS = new Set([
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH",
  "WRITE_PROJECT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "MUTATE_POLICY",
]);
const TOOLS = new Set(["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT"]);
const FLAGS = Object.freeze([
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive",
]);
const REQUIRED_BLOCKS = Object.freeze([
  "specialist.data.router",
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
  "specialist.standard.postgresql-17-rls",
]);
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref",
  "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date",
  "candidate_status", "candidate_digest", "signal", "signal_status", "context_status", "context_complete",
  "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status",
  "authority_scope", "scope", "database_engine", "database_version", "tenant_boundary_status",
  "policy_evidence_status", "bypass_role_evidence_status", "standard_id", "standard_version",
  "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256", "model_task_class",
  "model_capability_floor", "model_required_capabilities", "model_route_sha256", "context_receipt_sha256",
  "upstream_router_result_sha256", "memory_binding", "memory_write_requested", "project_data_present",
  "secret_data_present", "adversarial_flags",
]);
const SIDE_EFFECT_KEYS = Object.freeze([
  "candidate_reads", "source_reads", "protected_data_reads", "tenant_boundary_decisions",
  "policy_mutations", "project_writes", "memory_writes", "credential_accesses", "state_changes",
]);

function fail(message, code = "POSTGRESQL_RLS_INPUT_INVALID") {
  const error = new Error(message); error.code = code; throw error;
}
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "POSTGRESQL_RLS_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "POSTGRESQL_RLS_UNKNOWN_FIELD");
}
function bounded(value, label, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} is invalid`, "POSTGRESQL_RLS_FIELD_INVALID");
}
function safeId(value, label) { bounded(value, label); assert(SAFE_ID.test(value), `${label} is not canonical`, "POSTGRESQL_RLS_ID_INVALID"); }
function digest(value, label) { bounded(value, label, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "POSTGRESQL_RLS_DIGEST_INVALID"); }
function date(value, label) { bounded(value, label, 10); assert(DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "POSTGRESQL_RLS_DATE_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: POSTGRESQL_RLS_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    analysis_allowed: false,
    routing_allowed: false,
    acceptance_allowed: false,
    tenant_boundary_decision_allowed: false,
    policy_mutation_allowed: false,
    memory_write_allowed: false,
    external_side_effects: Object.fromEntries(SIDE_EFFECT_KEYS.map((key) => [key, 0])),
    error_code: errorCode,
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "PostgreSQL RLS input");
  assert(input.schema === POSTGRESQL_RLS_INPUT_SCHEMA && input.version === 1, "PostgreSQL RLS schema mismatch", "POSTGRESQL_RLS_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "PostgreSQL RLS request kind is not recognized", "POSTGRESQL_RLS_REQUEST_INVALID");
  exactKeys(input.evidence, EVIDENCE_KEYS, "PostgreSQL RLS evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "source_status", "source_identity", "source_version", "candidate_status",
    "signal", "signal_status", "context_status", "requested_action", "model_policy_status", "model_route_status",
    "authority_scope", "scope", "database_engine", "database_version", "tenant_boundary_status",
    "policy_evidence_status", "bypass_role_evidence_status", "standard_id", "standard_version", "model_task_class",
    "memory_binding",
  ]) if (e[key] !== undefined) bounded(e[key], `evidence.${key}`);
  safeId(e.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(e.custody_ref), "evidence.custody_ref is not opaque", "POSTGRESQL_RLS_CUSTODY_REF_INVALID");
  for (const key of [
    "candidate_digest", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256",
    "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256",
  ]) digest(e[key], `evidence.${key}`);
  date(e.source_effective_date, "evidence.source_effective_date"); date(e.source_retrieved_date, "evidence.source_retrieved_date");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length >= 1 && e.requested_tools.length <= 3, "requested_tools is invalid", "POSTGRESQL_RLS_TOOL_LIST_INVALID");
  for (const tool of e.requested_tools) { bounded(tool, "requested_tools[]", 60); assert(TOOLS.has(tool), `unsupported tool: ${tool}`, "POSTGRESQL_RLS_TOOL_SCOPE_INVALID"); }
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length, "required block identities are incomplete", "POSTGRESQL_RLS_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { safeId(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "POSTGRESQL_RLS_BLOCK_BINDING_INVALID"); });
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length >= 1 && e.model_required_capabilities.every((value) => typeof value === "string"), "model_required_capabilities is invalid", "POSTGRESQL_RLS_MODEL_ROUTE_INVALID");
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor > 0, "model_capability_floor is invalid", "POSTGRESQL_RLS_MODEL_ROUTE_INVALID");
  assert(typeof e.context_complete === "boolean" && typeof e.memory_write_requested === "boolean" && typeof e.project_data_present === "boolean" && typeof e.secret_data_present === "boolean", "PostgreSQL RLS boolean evidence is invalid", "POSTGRESQL_RLS_BOOLEAN_INVALID");
  exactKeys(e.adversarial_flags, new Set(FLAGS), "PostgreSQL RLS adversarial flags");
  FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "POSTGRESQL_RLS_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "PostgreSQL RLS input contains protected data", "POSTGRESQL_RLS_PRIVACY_DENIED");
}

export function evaluatePostgresqlRlsBoundary(input) {
  validateInput(input);
  const authority = resolvePostgresqlRlsCanonicalAuthority();
  const e = input.evidence;
  const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_POSTGRESQL_RLS", "POSTGRESQL_RLS_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind)) return result("DENY", "NO_POSTGRESQL_RLS_SIDE_EFFECT", "POSTGRESQL_RLS_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "POSTGRESQL_RLS_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "POSTGRESQL_RLS_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "POSTGRESQL_RLS_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "POSTGRESQL_RLS_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "POSTGRESQL_RLS_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "POSTGRESQL_RLS_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "POSTGRESQL_RLS_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "POSTGRESQL_RLS_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action || e.memory_write_requested) return result("DENY", "NO_POSTGRESQL_RLS_SIDE_EFFECT", "POSTGRESQL_RLS_OPERATION_FORBIDDEN", input);
  assertPostgresqlRlsCanonicalEvidence(e, authority);
  if (!['ANALYZE_POSTGRES_RLS', 'ROUTE_POSTGRES_RLS'].includes(input.request_kind)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "POSTGRESQL_RLS_ACTION_INVALID", input);
  if (!['ANALYZE', 'ROUTE'].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "POSTGRESQL_RLS_ACTION_INVALID", input);
  return result("ROUTE", "POSTGRESQL_RLS_ANALYSIS_HANDOFF", "POSTGRESQL_RLS_ROUTE_READY", input, {
    analysis_allowed: true,
    routing_allowed: true,
    selected_specialist: POSTGRESQL_RLS_BLOCK_ID,
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only PostgreSQL 17 Row-Level Security policy and tenant-boundary evidence, then return a typed finding or NOT_APPLICABLE handoff; do not mutate policy, decide authorization, write memory, or accept the candidate.",
      execution_instruction: false,
    },
  });
}
