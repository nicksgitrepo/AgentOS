#!/usr/bin/env node

/*
 * Public, read-only boundary for the Field Job Workflow atomic specialist.
 * It routes typed evidence and handoffs only.  It cannot issue field
 * instructions, certify safety, approve engineering, mutate Product state,
 * admit/activate a block, or write memory.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {
  FIELD_JOB_WORKFLOW_BLOCK_ID,
  FIELD_JOB_WORKFLOW_CUSTODY_REF,
  FIELD_JOB_WORKFLOW_FLAG_NAMES,
  FIELD_JOB_WORKFLOW_REQUIRED_BLOCKS,
  FIELD_JOB_WORKFLOW_TOOLS,
  resolveFieldJobWorkflowCanonicalAuthority,
} from "./field-job-workflow-authority-binding.mjs";

export const FIELD_JOB_WORKFLOW_INPUT_SCHEMA = "agentos.field_job_workflow_boundary_input.v1";
export const FIELD_JOB_WORKFLOW_RESULT_SCHEMA = "agentos.field_job_workflow_boundary_result.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const REQUESTS = new Set([
  "ANALYZE_FIELD_JOB_WORKFLOW", "ROUTE_FIELD_JOB_WORKFLOW", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "SELF_REVIEW", "DISPATCH_OPERATION", "ISSUE_FIELD_INSTRUCTION", "CERTIFY_SAFETY",
]);
const FORBIDDEN = new Set([
  "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "SELF_REVIEW", "DISPATCH_OPERATION", "ISSUE_FIELD_INSTRUCTION", "CERTIFY_SAFETY",
]);
const ALLOWED_ACTIONS = new Set(["ANALYZE", "ROUTE"]);
const ALLOWED_WORKFLOW_DOMAINS = new Set(["FIELD_WORKFLOW"]);
const ALLOWED_TOOLS = new Set(FIELD_JOB_WORKFLOW_TOOLS);

function fail(message, code = "FIELD_JOB_WORKFLOW_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exact(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "FIELD_JOB_WORKFLOW_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "FIELD_JOB_WORKFLOW_UNKNOWN_FIELD");
}

function string(value, name, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "FIELD_JOB_WORKFLOW_FIELD_INVALID");
}

function digest(value, name) {
  string(value, name, 64);
  assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "FIELD_JOB_WORKFLOW_DIGEST_INVALID");
}

function ref(value, name) {
  string(value, name, 180);
  assert(REF.test(value), `${name} is not an opaque reference`, "FIELD_JOB_WORKFLOW_REF_INVALID");
}

function dateOrNull(value, name) {
  if (value === null) return;
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value), `${name} is not an ISO date`, "FIELD_JOB_WORKFLOW_DATE_INVALID");
}

function validateInput(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Field Job Workflow input");
  assert(input.schema === FIELD_JOB_WORKFLOW_INPUT_SCHEMA && input.version === 1, "Field Job Workflow schema mismatch", "FIELD_JOB_WORKFLOW_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Field Job Workflow request is unknown", "FIELD_JOB_WORKFLOW_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "custody_status", "custody_ref", "workflow_domain", "workflow_phase", "workflow_task", "workflow_ref", "workflow_dependencies",
    "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "source_manifest_sha256",
    "candidate_status", "candidate_digest", "workflow_signal", "signal_status", "task_status", "context_status", "context_complete", "context_receipt_sha256",
    "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "model_task_class", "model_snapshot_sha256",
    "model_route_sha256", "model_capability_floor", "model_required_capabilities", "authority_scope", "memory_binding_sha256", "upstream_router_file_sha256",
    "upstream_router_result_sha256", "project_data_present", "secret_data_present", "adversarial_flags",
  ]), "Field Job Workflow evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "custody_status", "workflow_domain", "workflow_phase", "workflow_task", "source_status", "source_identity", "source_version", "candidate_status", "workflow_signal", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "model_task_class", "authority_scope"]) string(e[key], `evidence.${key}`);
  ref(e.custody_ref, "evidence.custody_ref");
  ref(e.workflow_ref, "evidence.workflow_ref");
  assert(Array.isArray(e.workflow_dependencies) && e.workflow_dependencies.length > 0 && e.workflow_dependencies.every((item) => typeof item === "string" && item.length > 0), "evidence.workflow_dependencies is invalid", "FIELD_JOB_WORKFLOW_CONTEXT_INVALID");
  dateOrNull(e.source_effective_date, "evidence.source_effective_date");
  dateOrNull(e.source_retrieved_date, "evidence.source_retrieved_date");
  for (const key of ["source_manifest_sha256", "candidate_digest", "context_receipt_sha256", "model_snapshot_sha256", "model_route_sha256", "memory_binding_sha256", "upstream_router_file_sha256", "upstream_router_result_sha256"]) digest(e[key], `evidence.${key}`);
  assert(Number.isInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "evidence.model_capability_floor is invalid", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((item) => typeof item === "string"), "evidence.model_required_capabilities is invalid", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.every((tool) => ALLOWED_TOOLS.has(tool)), "evidence.requested_tools contains an unapproved tool", "FIELD_JOB_WORKFLOW_TOOL_SCOPE_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === FIELD_JOB_WORKFLOW_REQUIRED_BLOCKS.length && new Set(e.required_block_identities).size === e.required_block_identities.length, "evidence.required_block_identities is incomplete", "FIELD_JOB_WORKFLOW_BLOCK_BINDING_INVALID");
  assert(typeof e.context_complete === "boolean" && typeof e.project_data_present === "boolean" && typeof e.secret_data_present === "boolean", "Field Job Workflow boolean evidence is invalid", "FIELD_JOB_WORKFLOW_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FIELD_JOB_WORKFLOW_FLAG_NAMES), "evidence.adversarial_flags");
  for (const name of FIELD_JOB_WORKFLOW_FLAG_NAMES) assert(typeof e.adversarial_flags[name] === "boolean", `evidence.adversarial_flags.${name} is not boolean`, "FIELD_JOB_WORKFLOW_BOOLEAN_INVALID");
  assert(ALLOWED_WORKFLOW_DOMAINS.has(e.workflow_domain), "Field Job Workflow domain is not typed", "FIELD_JOB_WORKFLOW_DOMAIN_INVALID");
  assert(ALLOWED_ACTIONS.has(e.requested_action), "Field Job Workflow action is not allowed", "FIELD_JOB_WORKFLOW_ACTION_INVALID");
  assert(scanPersistedRecord(input).safe, "Field Job Workflow input contains protected or private data", "FIELD_JOB_WORKFLOW_PRIVACY_DENIED");
}

function sideEffects() {
  return {workflow_writes: 0, field_dispatches: 0, safety_certifications: 0, engineering_approvals: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0, memory_writes: 0};
}

function result(input, disposition, route, errorCode, authority, extra = {}) {
  const e = input.evidence;
  const base = {
    schema: FIELD_JOB_WORKFLOW_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    routing_allowed: disposition === "ROUTE",
    acceptance_allowed: false,
    operational_dispatch_allowed: false,
    engineering_or_safety_claim_allowed: false,
    admission_allowed: false,
    activation_allowed: false,
    memory_write_allowed: false,
    context_reuse_allowed: disposition === "ROUTE",
    external_side_effects: sideEffects(),
    error_code: errorCode,
    input_sha256: canonicalDigest(input),
    evidence_binding: {
      candidate_digest: authority.block.block_sha256,
      source_manifest_sha256: authority.source.source.manifest_sha256,
      model_snapshot_sha256: authority.model.snapshot.snapshot_sha256,
      model_route_sha256: authority.model.route.route_sha256,
      context_receipt_sha256: authority.context.context.context_sha256,
      memory_binding_sha256: authority.invalidation.graph_sha256,
      upstream_router_result_sha256: authority.upstream_result.result_sha256,
    },
    lifecycle_status: disposition === "ROUTE" ? "CANDIDATE_WAITING_INDEPENDENT_REVIEW" : "CANDIDATE_ACTION_CLOSED",
    selected_owner: null,
    handoff: null,
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function canonicalEvidenceMismatch(input, authority) {
  const e = input.evidence;
  const c = authority.evidence;
  const exactFields = [
    "authority_status", "custody_status", "custody_ref", "workflow_domain", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "source_manifest_sha256", "candidate_status", "candidate_digest", "workflow_signal",
    "signal_status", "task_status", "context_status", "context_receipt_sha256", "required_block_identities", "model_policy_status",
    "model_route_status", "model_task_class", "model_snapshot_sha256", "model_route_sha256", "model_capability_floor", "model_required_capabilities",
    "authority_scope", "memory_binding_sha256", "upstream_router_file_sha256", "upstream_router_result_sha256",
  ];
  return exactFields.some((field) => JSON.stringify(e[field]) !== JSON.stringify(c[field]));
}

function routeHandoff(input, authority, route, errorCode) {
  return result(input, "ROUTE", route, errorCode, authority, {
    selected_owner: "AGENTOS.ORCHESTRATOR",
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      block_id: FIELD_JOB_WORKFLOW_BLOCK_ID,
      block_sha256: authority.block.block_sha256,
      next_action: "Return the evidence-bounded field-job analysis to the named owner; do not issue field instructions, certify safety, approve engineering, dispatch operations, or mutate Product or memory.",
      execution_instruction: false,
      memory_write_allowed: false,
      independent_review_required: true,
    },
  });
}

export function evaluateFieldJobWorkflowBoundary(input) {
  validateInput(input);
  const authority = resolveFieldJobWorkflowCanonicalAuthority();
  const e = input.evidence;
  if (canonicalEvidenceMismatch(input, authority)) return result(input, "DENY", "TYPED_CONTEXT_REQUIRED", "FIELD_JOB_WORKFLOW_CANONICAL_BINDING_MISMATCH", authority);
  if (FORBIDDEN.has(input.request_kind)) return result(input, "DENY", "NO_FIELD_WORKFLOW_SIDE_EFFECT", "FIELD_JOB_WORKFLOW_OPERATION_FORBIDDEN", authority);
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || e.adversarial_flags.unrelated_scope) return result(input, "DENY", "NO_FIELD_WORKFLOW_SCOPE", "FIELD_JOB_WORKFLOW_NOT_APPLICABLE", authority);
  const flags = e.adversarial_flags;
  if (flags.authority_conflict) return result(input, "DENY", "FIELD_WORKFLOW_AUTHORITY_ESCALATION", "FIELD_JOB_WORKFLOW_AUTHORITY_CONFLICT", authority);
  if (flags.missing_context || e.context_complete !== true) return result(input, "DENY", "FIELD_WORKFLOW_TYPED_CONTEXT_REQUIRED", "FIELD_JOB_WORKFLOW_CONTEXT_INCOMPLETE", authority);
  if (flags.protected_data || e.project_data_present || e.secret_data_present) return result(input, "DENY", "FIELD_WORKFLOW_PRIVACY_BOUNDARY_REQUIRED", "FIELD_JOB_WORKFLOW_PROTECTED_DATA_FORBIDDEN", authority);
  if (flags.self_acceptance) return result(input, "DENY", "FIELD_WORKFLOW_INDEPENDENT_REVIEW_REQUIRED", "FIELD_JOB_WORKFLOW_SELF_ACCEPTANCE_FORBIDDEN", authority);
  if (flags.scope_expanded || flags.broad_claim) return result(input, "DENY", "FIELD_WORKFLOW_NARROW_SCOPE_REQUIRED", "FIELD_JOB_WORKFLOW_SCOPE_EXPANSION_FORBIDDEN", authority);
  if (flags.duplicate_authority) return result(input, "DENY", "FIELD_WORKFLOW_AUTHORITY_ESCALATION", "FIELD_JOB_WORKFLOW_DUPLICATE_AUTHORITY", authority);
  if (flags.cross_provider || flags.stale_source) return result(input, "DENY", "FIELD_WORKFLOW_SOURCE_REFRESH_REQUIRED", "FIELD_JOB_WORKFLOW_SOURCE_STALE_OR_UNVERIFIED", authority);
  if (flags.handoff_incomplete) return result(input, "DENY", "FIELD_WORKFLOW_HANDOFF_REQUIRED", "FIELD_JOB_WORKFLOW_HANDOFF_INCOMPLETE", authority);
  if (flags.lifecycle_invalid) return result(input, "DENY", "FIELD_WORKFLOW_LIFECYCLE_REVIEW_REQUIRED", "FIELD_JOB_WORKFLOW_LIFECYCLE_INVALID", authority);
  if (flags.unsupported_tool) return routeHandoff(input, authority, "FIELD_WORKFLOW_TOOL_CUSTODY_REVIEW", "FIELD_JOB_WORKFLOW_TOOL_REVIEW_REQUIRED");
  if (flags.data_limit) return routeHandoff(input, authority, "FIELD_WORKFLOW_DATA_CUSTODY_REVIEW", "FIELD_JOB_WORKFLOW_DATA_LIMIT_REVIEW_REQUIRED");
  if (flags.false_positive) return result(input, "DENY", "FIELD_WORKFLOW_TYPED_EVIDENCE_REQUIRED", "FIELD_JOB_WORKFLOW_FINDING_UNSUPPORTED", authority);
  if (flags.unsafe_action) return result(input, "DENY", "NO_FIELD_WORKFLOW_SIDE_EFFECT", "FIELD_JOB_WORKFLOW_OPERATION_FORBIDDEN", authority);
  if (e.authority_status !== "CURRENT_CANDIDATE" || e.custody_status !== "ISOLATED_BUILDER" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "FIELD_JOB_WORKFLOW_CONTEXT" || e.model_route_status !== "BOUND" || e.context_complete !== true) return result(input, "DENY", "FIELD_WORKFLOW_TYPED_CONTEXT_REQUIRED", "FIELD_JOB_WORKFLOW_CONTEXT_BINDING_INVALID", authority);
  if (e.workflow_signal !== "DOMAIN.FIELD_JOB_WORKFLOW" || e.signal_status !== "BOUND" || e.task_status !== "FIELD_WORKFLOW_CLASSIFICATION" || e.authority_scope !== "FIELD_JOB_WORKFLOW") return result(input, "DENY", "FIELD_WORKFLOW_NARROW_SCOPE_REQUIRED", "FIELD_JOB_WORKFLOW_SCOPE_INVALID", authority);
  if (e.model_policy_status !== "PREPARED_INACTIVE" || e.model_task_class !== "NARROW_CODING" || e.model_capability_floor !== 49 || JSON.stringify(e.model_required_capabilities) !== JSON.stringify(["CODE", "TOOLS"])) return result(input, "DENY", "FIELD_WORKFLOW_MODEL_POLICY_REVIEW_REQUIRED", "FIELD_JOB_WORKFLOW_MODEL_ROUTE_INVALID", authority);
  if (!ALLOWED_ACTIONS.has(e.requested_action)) return result(input, "DENY", "FIELD_WORKFLOW_TYPED_CONTEXT_REQUIRED", "FIELD_JOB_WORKFLOW_ACTION_INVALID", authority);
  return routeHandoff(input, authority, "FIELD_WORKFLOW_ANALYSIS_HANDOFF", "FIELD_JOB_WORKFLOW_ROUTE_READY");
}
