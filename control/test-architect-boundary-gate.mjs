#!/usr/bin/env node

/*
 * Read-only Test Architecture specialist boundary.
 *
 * The boundary accepts typed evidence, but caller-authored identities are
 * never authority.  Canonical package, source, standard, model, router,
 * context, memory, and invalidation bytes are resolved from this repository
 * before a route is emitted.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {
  assertTestArchitectCanonicalEvidence,
  resolveTestArchitectCanonicalAuthority,
} from "./test-architect-authority-binding.mjs";

export const TEST_ARCHITECT_INPUT_SCHEMA = "agentos.test_architect_boundary_input.v1";
export const TEST_ARCHITECT_RESULT_SCHEMA = "agentos.test_architect_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{1,160}$/u;
const REQUESTS = new Set([
  "ANALYZE_TEST_ARCHITECTURE", "ROUTE_TEST_ARCHITECTURE", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "EXECUTE_TESTS", "MUTATE_TEST_PLAN", "ISSUE_CREDENTIAL",
]);
const FORBIDDEN = new Set([
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "EXECUTE_TESTS", "MUTATE_TEST_PLAN", "ISSUE_CREDENTIAL",
]);
const TOOLS = new Set(["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT", "READ_STANDARD", "READ_MEMORY_PROJECTION"]);
const FLAGS = [
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive",
];
const REQUIRED_BLOCKS = [
  "specialist.assurance-enterprise.router",
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
  "specialist.standard.nist-ssdf",
];

function fail(message, code = "TEST_ARCHITECT_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "TEST_ARCHITECT_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "TEST_ARCHITECT_UNKNOWN_FIELD");
}
function string(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} is invalid`, "TEST_ARCHITECT_FIELD_INVALID"); }
function id(value, label) { string(value, label); assert(ID.test(value), `${label} is not canonical`, "TEST_ARCHITECT_ID_INVALID"); }
function digest(value, label) { string(value, label, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "TEST_ARCHITECT_DIGEST_INVALID"); }

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: TEST_ARCHITECT_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    analysis_allowed: false,
    acceptance_allowed: false,
    test_execution_allowed: false,
    test_plan_mutation_allowed: false,
    memory_write_allowed: false,
    external_side_effects: {
      candidate_reads: 0,
      source_reads: 0,
      standard_reads: 0,
      context_reads: 0,
      memory_reads: 0,
      protected_data_reads: 0,
      test_executions: 0,
      test_plan_writes: 0,
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
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "test-architect input");
  assert(input.schema === TEST_ARCHITECT_INPUT_SCHEMA && input.version === 1, "test-architect schema mismatch", "TEST_ARCHITECT_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "test-architect request is unknown", "TEST_ARCHITECT_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal", "signal_status",
    "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status",
    "model_route_status", "authority_scope", "scope", "test_architecture_status", "test_scope_status", "test_strategy_status",
    "test_evidence_status", "standard_id", "standard_version", "standard_block_sha256", "standard_source_manifest_sha256",
    "model_snapshot_sha256", "model_task_class", "model_capability_floor", "model_required_capabilities", "model_route_sha256",
    "context_receipt_sha256", "memory_binding_sha256", "invalidation_sha256", "upstream_router_result_sha256",
    "project_data_present", "secret_data_present", "adversarial_flags",
  ]), "test-architect evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "custody_owner", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "candidate_status", "signal", "signal_status", "context_status",
    "requested_action", "model_policy_status", "model_route_status", "authority_scope", "scope", "test_architecture_status",
    "test_scope_status", "test_strategy_status", "test_evidence_status", "standard_id", "standard_version", "model_task_class",
  ]) string(e[key], `evidence.${key}`);
  id(e.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(e.custody_ref), "custody reference is not opaque", "TEST_ARCHITECT_CUSTODY_REF_INVALID");
  for (const key of [
    "candidate_digest", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256",
    "context_receipt_sha256", "memory_binding_sha256", "invalidation_sha256", "upstream_router_result_sha256",
  ]) digest(e[key], `evidence.${key}`);
  assert(e.standard_id === "source.nist-sp-800-218" && e.standard_version === "1.1", "standard identity is not canonical", "TEST_ARCHITECT_STANDARD_BINDING_INVALID");
  assert(e.model_task_class === "DETERMINISTIC_QA" && Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "model route task is invalid", "TEST_ARCHITECT_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "model capabilities are invalid", "TEST_ARCHITECT_MODEL_ROUTE_UNBOUND");
  assert(e.test_architecture_status === "BOUND" && e.test_scope_status === "BOUND" && e.test_strategy_status === "BOUND" && e.test_evidence_status === "BOUND", "test context is not bound", "TEST_ARCHITECT_CONTEXT_REQUIRED");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= 5, "requested tools are invalid", "TEST_ARCHITECT_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 60); assert(TOOLS.has(tool), "unsupported tool", "TEST_ARCHITECT_TOOL_SCOPE_INVALID"); });
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === REQUIRED_BLOCKS.length, "required block identities are incomplete", "TEST_ARCHITECT_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => { id(value, "required_block_identities[]"); assert(value === REQUIRED_BLOCKS[index], "required block identity is not canonical", "TEST_ARCHITECT_BLOCK_BINDING_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "TEST_ARCHITECT_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "test-architect adversarial flags");
  FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "TEST_ARCHITECT_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "test-architect input contains protected data", "TEST_ARCHITECT_PRIVACY_DENIED");
  assertTestArchitectCanonicalEvidence(e, resolveTestArchitectCanonicalAuthority());
}

export function evaluateTestArchitectBoundary(input) {
  validate(input);
  const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || e.adversarial_flags.unrelated_scope) return result("DENY", "NO_TEST_ARCHITECTURE", "TEST_ARCHITECTURE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_TEST_ARCHITECTURE_SIDE_EFFECT", "TEST_ARCHITECTURE_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "TEST_ARCHITECTURE_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TEST_ARCHITECTURE_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "TEST_ARCHITECTURE_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "TEST_ARCHITECTURE_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "TEST_ARCHITECTURE_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "TEST_ARCHITECTURE_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "TEST_ARCHITECTURE_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "TEST_ARCHITECTURE_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_TEST_ARCHITECTURE_SIDE_EFFECT", "TEST_ARCHITECTURE_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.custody_owner !== "AGENT.ASSURANCE_ENTERPRISE_TEST_ARCHITECT") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "TEST_ARCHITECTURE_AUTHORITY_UNVERIFIED", input);
  if (e.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "TEST_ARCHITECTURE_SOURCE_IDENTITY_INVALID", input);
  if (e.candidate_status !== "CURRENT_CANDIDATE" || e.signal !== "QA.TEST_ARCHITECT" || e.signal_status !== "BOUND" || e.context_status !== "TEST_ARCHITECT_CONTEXT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "TEST_ARCHITECTURE_CONTEXT_BINDING_INVALID", input);
  if (e.model_route_status !== "BOUND") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "TEST_ARCHITECTURE_MODEL_ROUTE_UNBOUND", input);
  if (!(["ANALYZE", "ROUTE"].includes(e.requested_action))) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TEST_ARCHITECTURE_ACTION_INVALID", input);
  return result("ROUTE", "TEST_ARCHITECTURE_ANALYSIS_HANDOFF", "TEST_ARCHITECTURE_ROUTE_READY", input, {
    analysis_allowed: true,
    selected_specialist: "specialist.assurance-enterprise.test-architect",
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the named test-architecture concern using the bound test scope, strategy, and evidence; return a typed finding or NOT_APPLICABLE handoff. Do not execute tests, mutate a test plan, accept product completeness, or write memory.",
      execution_instruction: false,
    },
  });
}
