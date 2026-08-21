#!/usr/bin/env node

/*
 * Read-only Cloudflare Cache Rules boundary.  It classifies and routes a
 * narrow, typed concern; it never purges, deploys, mutates provider state,
 * writes a project, writes memory, accepts a candidate, or issues credentials.
 */

import {canonicalDigest, scanPersistedRecord} from "./content-addressing.mjs";
import {assertCloudflareCacheCanonicalEvidence, resolveCloudflareCacheCanonicalAuthority} from "./cloudflare-cache-authority-binding.mjs";

export const CLOUDFLARE_CACHE_INPUT_SCHEMA = "agentos.cloudflare_cache_boundary_input.v1";
export const CLOUDFLARE_CACHE_RESULT_SCHEMA = "agentos.cloudflare_cache_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{1,180}$/u;
const REQUESTS = new Set([
  "ANALYZE_CLOUDFLARE_CACHE", "ROUTE_CLOUDFLARE_CACHE", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "PURGE_CACHE",
  "MUTATE_PROVIDER", "WRITE_PROJECT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "ISSUE_CREDENTIAL",
]);
const FORBIDDEN = new Set([
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "PURGE_CACHE",
  "MUTATE_PROVIDER", "WRITE_PROJECT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "ISSUE_CREDENTIAL",
]);
const TOOLS = new Set(["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT"]);
const FLAGS = Object.freeze([
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive",
]);
const REQUIRED_BLOCKS = Object.freeze([
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
  "specialist.platform.provider-edge-router",
  "specialist.standard.cloudflare-cache-current",
]);

function fail(message, code = "CLOUDFLARE_CACHE_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "CLOUDFLARE_CACHE_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "CLOUDFLARE_CACHE_UNKNOWN_FIELD");
}

function string(value, label, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} is invalid`, "CLOUDFLARE_CACHE_FIELD_INVALID");
}

function id(value, label) {
  string(value, label);
  assert(ID.test(value), `${label} is not canonical`, "CLOUDFLARE_CACHE_ID_INVALID");
}

function digest(value, label) {
  string(value, label, 64);
  assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "CLOUDFLARE_CACHE_DIGEST_INVALID");
}

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: CLOUDFLARE_CACHE_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    analysis_allowed: false,
    routing_allowed: false,
    acceptance_allowed: false,
    cache_mutation_allowed: false,
    purge_allowed: false,
    deployment_allowed: false,
    memory_write_allowed: false,
    external_side_effects: {
      candidate_reads: 0,
      source_reads: 0,
      provider_reads: 0,
      cache_mutations: 0,
      cache_purges: 0,
      deployment_calls: 0,
      project_writes: 0,
      memory_writes: 0,
      credential_accesses: 0,
      state_changes: 0,
    },
    error_code: errorCode,
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Cloudflare Cache input");
  assert(input.schema === CLOUDFLARE_CACHE_INPUT_SCHEMA && input.version === 1, "Cloudflare Cache schema mismatch", "CLOUDFLARE_CACHE_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "Cloudflare Cache request kind is not recognized", "CLOUDFLARE_CACHE_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_manifest_sha256",
    "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal", "signal_status",
    "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status",
    "model_route_status", "authority_scope", "scope", "cache_rule_status", "cache_scope_status", "provider_identity", "provider_version",
    "standard_id", "standard_version", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256",
    "model_task_class", "model_capability_floor", "model_required_capabilities", "model_route_sha256", "context_receipt_sha256",
    "upstream_router_result_sha256", "memory_binding", "project_data_present", "secret_data_present", "adversarial_flags",
  ]), "Cloudflare Cache evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "custody_owner", "source_status", "source_identity", "source_version", "source_manifest_sha256", "source_retrieved_date",
    "candidate_status", "signal", "signal_status", "context_status", "requested_action", "model_policy_status", "model_route_status",
    "authority_scope", "scope", "cache_rule_status", "cache_scope_status", "provider_identity", "provider_version", "standard_id", "standard_version",
    "model_task_class", "memory_binding",
  ]) string(e[key], `evidence.${key}`);
  assert(e.source_effective_date === null || typeof e.source_effective_date === "string", "evidence.source_effective_date is invalid", "CLOUDFLARE_CACHE_SOURCE_DATE_INVALID");
  id(e.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(e.custody_ref), "evidence.custody_ref is not opaque", "CLOUDFLARE_CACHE_CUSTODY_REF_INVALID");
  digest(e.candidate_digest, "evidence.candidate_digest");
  for (const key of ["source_manifest_sha256", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256"]) digest(e[key], `evidence.${key}`);
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "evidence.model_capability_floor is invalid", "CLOUDFLARE_CACHE_MODEL_ROUTE_INVALID");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "evidence.model_required_capabilities is invalid", "CLOUDFLARE_CACHE_MODEL_ROUTE_INVALID");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= 4 && e.requested_tools.every((tool) => typeof tool === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(tool)), "evidence.requested_tools is invalid", "CLOUDFLARE_CACHE_TOOL_SCOPE_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length, "evidence.required_block_identities is incomplete", "CLOUDFLARE_CACHE_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value) => id(value, "required_block_identities[]"));
  for (const key of ["context_complete", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "CLOUDFLARE_CACHE_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Cloudflare Cache adversarial flags");
  FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "CLOUDFLARE_CACHE_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Cloudflare Cache input contains protected data", "CLOUDFLARE_CACHE_PRIVACY_DENIED");
  assertCloudflareCacheCanonicalEvidence(e, resolveCloudflareCacheCanonicalAuthority());
}

export function evaluateCloudflareCacheBoundary(input) {
  validate(input);
  const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || e.adversarial_flags.unrelated_scope) return result("DENY", "NO_CLOUDFLARE_CACHE_SCOPE", "CLOUDFLARE_CACHE_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_CLOUDFLARE_CACHE_SIDE_EFFECT", "CLOUDFLARE_CACHE_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "CLOUDFLARE_CACHE_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "CLOUDFLARE_CACHE_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "CLOUDFLARE_CACHE_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "CLOUDFLARE_CACHE_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "CLOUDFLARE_CACHE_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "CLOUDFLARE_CACHE_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool || e.requested_tools.some((tool) => !TOOLS.has(tool))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "CLOUDFLARE_CACHE_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "CLOUDFLARE_CACHE_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_CLOUDFLARE_CACHE_SIDE_EFFECT", "CLOUDFLARE_CACHE_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "CLOUDFLARE_CACHE_AUTHORITY_UNVERIFIED", input);
  if (e.requested_action !== "ANALYZE" && e.requested_action !== "ROUTE") return result("DENY", "TYPED_CONTEXT_REQUIRED", "CLOUDFLARE_CACHE_ACTION_INVALID", input);
  return result("ROUTE", "CLOUDFLARE_CACHE_ANALYSIS_HANDOFF", "CLOUDFLARE_CACHE_ROUTE_READY", input, {
    analysis_allowed: true,
    routing_allowed: true,
    selected_specialist: "specialist.platform.cloudflare-cache",
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the named Cloudflare Cache Rules concern from the current source lock; return typed evidence or NOT_APPLICABLE and never purge, deploy, mutate, accept, or write state.",
      execution_instruction: false,
    },
  });
}
