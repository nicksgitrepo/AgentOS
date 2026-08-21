#!/usr/bin/env node

/*
 * Read-only Job-Cost Accounting specialist boundary.  This entrypoint
 * classifies one typed cost-control concern and returns a bounded handoff.
 * It never books entries, gives a professional opinion, accepts work, or
 * mutates project, financial, consumer, or AgentOS state.
 */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const JOB_COST_ACCOUNTING_INPUT_SCHEMA = "agentos.job_cost_accounting_boundary_input.v1";
export const JOB_COST_ACCOUNTING_RESULT_SCHEMA = "agentos.job_cost_accounting_boundary_result.v1";
export const JOB_COST_ACCOUNTING_BLOCK_ID = "specialist.finance.job-cost-accounting";
export const JOB_COST_ACCOUNTING_REQUIRED_BLOCKS = Object.freeze([
  "SPECIALIST.FOUNDATION.AUTHORITY_JURISDICTION_GATE",
  "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE",
  "SPECIALIST.FOUNDATION.ROLE_INTAKE_CLASSIFIER",
  "SPECIALIST.FOUNDATION.SCOPE_NON_GOAL_GATE",
  "SPECIALIST.FOUNDATION.TOOL_CUSTODY_GATE",
]);
export const JOB_COST_ACCOUNTING_CUSTODY_REF = "opaque:CUSTODY:FINANCE-JOB-COST-ACCOUNTING-20260821-01";
export const JOB_COST_ACCOUNTING_ROLLBACK_REF = "opaque:ROLLBACK:AC1733095DB2FBAE8B3E2748D7000BE7054FD2E0";
export const JOB_COST_ACCOUNTING_CONTEXT_ANCHOR = Object.freeze({
  authority_scope: "JOB_COST_ACCOUNTING",
  block_id: JOB_COST_ACCOUNTING_BLOCK_ID,
  custody_ref: JOB_COST_ACCOUNTING_CUSTODY_REF,
  rollback_ref: JOB_COST_ACCOUNTING_ROLLBACK_REF,
  source_identity: "SOURCE.GAO_GREEN_BOOK_2025",
  source_version: "2025",
  task_class: "NARROW_CODING",
});
export const JOB_COST_ACCOUNTING_CONTEXT_RECEIPT_SHA256 = canonicalDigest(JOB_COST_ACCOUNTING_CONTEXT_ANCHOR);

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const REQUESTS = new Set([
  "ANALYZE_JOB_COST", "ASSEMBLE_JOB_COST_HANDOFF", "ROUTE_JOB_COST_HANDOFF",
  "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE",
  "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW",
  "POST_ACCOUNTING_ENTRY", "GIVE_FINANCIAL_OPINION", "CERTIFY_FINANCIAL_CONTROL",
  "SELECT_TAX_TREATMENT", "ANSWER_USER",
]);
const FORBIDDEN = new Set([
  "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH",
  "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "POST_ACCOUNTING_ENTRY",
  "GIVE_FINANCIAL_OPINION", "CERTIFY_FINANCIAL_CONTROL", "SELECT_TAX_TREATMENT", "ANSWER_USER",
]);
const TOOLS = new Set([
  "READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_GAO_STANDARD", "READ_CONTEXT",
  "READ_ACCOUNTING_ROUTER_RECEIPT", "READ_CUSTODY",
]);
const FLAGS = Object.freeze([
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive", "data_limit",
]);
const RESULT_SIDE_EFFECTS = Object.freeze({
  candidate_reads: 0,
  source_reads: 0,
  standard_reads: 0,
  context_reads: 0,
  protected_data_reads: 0,
  ledger_writes: 0,
  financial_entries: 0,
  professional_opinions: 0,
  acceptance_calls: 0,
  credential_accesses: 0,
  project_writes: 0,
  memory_writes: 0,
  state_changes: 0,
});

function fail(message, code = "JOB_COST_ACCOUNTING_INPUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exact(value, allowed, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "JOB_COST_ACCOUNTING_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "JOB_COST_ACCOUNTING_UNKNOWN_FIELD");
}

function str(value, name, max = 240) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "JOB_COST_ACCOUNTING_FIELD_INVALID");
}

function id(value, name) {
  str(value, name);
  assert(ID.test(value), `${name} is not canonical`, "JOB_COST_ACCOUNTING_ID_INVALID");
}

function ref(value, name) {
  str(value, name, 180);
  assert(REF.test(value), `${name} is not opaque`, "JOB_COST_ACCOUNTING_REF_INVALID");
}

function digest(value, name) {
  str(value, name, 64);
  assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "JOB_COST_ACCOUNTING_DIGEST_INVALID");
}

function result(disposition, route, code, input, extra = {}) {
  const base = {
    schema: JOB_COST_ACCOUNTING_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    routing_allowed: false,
    acceptance_allowed: false,
    analysis_allowed: false,
    professional_opinion_allowed: false,
    external_side_effects: RESULT_SIDE_EFFECTS,
    error_code: code,
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}

function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "Job-Cost Accounting input");
  assert(input.schema === JOB_COST_ACCOUNTING_INPUT_SCHEMA && input.version === 1, "Job-Cost Accounting schema mismatch", "JOB_COST_ACCOUNTING_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Job-Cost Accounting request is unknown", "JOB_COST_ACCOUNTING_REQUEST_INVALID");
  exact(input.evidence, new Set([
    "authority_status", "accounting_domain", "cost_object", "accounting_entity", "accounting_objective",
    "accounting_period", "accounting_policy", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "source_lock_sha256", "standard_block_sha256",
    "standard_source_manifest_sha256", "candidate_status", "candidate_digest", "job_cost_signal",
    "signal_status", "task_status", "context_status", "context_complete", "context_receipt_sha256",
    "requested_action", "requested_tools", "required_block_identities", "model_policy_status",
    "model_snapshot_sha256", "model_file_sha256", "context_registry_sha256", "model_route_status", "authority_scope", "upstream_router_status",
    "upstream_router_result_sha256", "custody_ref", "rollback_ref", "new_findings", "project_data_present",
    "secret_data_present", "adversarial_flags",
  ]), "Job-Cost Accounting evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "accounting_domain", "cost_object", "accounting_entity", "accounting_objective",
    "accounting_period", "accounting_policy", "source_status", "source_identity", "source_version",
    "source_effective_date", "source_retrieved_date", "candidate_status", "job_cost_signal", "signal_status",
    "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status",
    "authority_scope", "upstream_router_status",
  ]) str(e[key], `evidence.${key}`);
  for (const key of [
    "source_lock_sha256", "standard_block_sha256", "standard_source_manifest_sha256", "candidate_digest",
    "context_receipt_sha256", "model_snapshot_sha256",
    "model_file_sha256", "context_registry_sha256", "upstream_router_result_sha256",
  ]) digest(e[key], `evidence.${key}`);
  ref(e.custody_ref, "evidence.custody_ref");
  ref(e.rollback_ref, "evidence.rollback_ref");
  assert(e.accounting_domain === "JOB_COST", "accounting domain is not typed", "JOB_COST_ACCOUNTING_DOMAIN_INVALID");
  assert(e.job_cost_signal === "FIN.JOB_COST_ACCOUNTING", "job-cost signal is not typed", "JOB_COST_ACCOUNTING_SIGNAL_INVALID");
  assert(e.authority_scope === "JOB_COST_ACCOUNTING", "authority scope is not narrow", "JOB_COST_ACCOUNTING_SCOPE_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === JOB_COST_ACCOUNTING_REQUIRED_BLOCKS.length, "required block identities are incomplete", "JOB_COST_ACCOUNTING_BLOCK_BINDING_INVALID");
  e.required_block_identities.forEach((value, index) => {
    id(value, "required_block_identities[]");
    assert(value === JOB_COST_ACCOUNTING_REQUIRED_BLOCKS[index], "required block identity is not canonical", "JOB_COST_ACCOUNTING_BLOCK_BINDING_INVALID");
  });
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "JOB_COST_ACCOUNTING_TOOL_SCOPE_INVALID");
  e.requested_tools.forEach((tool) => { str(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "JOB_COST_ACCOUNTING_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "new_findings", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "JOB_COST_ACCOUNTING_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "Job-Cost Accounting adversarial flags");
  Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "JOB_COST_ACCOUNTING_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "Job-Cost Accounting input contains protected data", "JOB_COST_ACCOUNTING_PRIVACY_DENIED");
}

export function evaluateJobCostAccountingBoundary(input) {
  validate(input);
  const e = input.evidence;
  const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_JOB_COST_SCOPE", "JOB_COST_ACCOUNTING_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_JOB_COST_SIDE_EFFECT", "JOB_COST_ACCOUNTING_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict) return result("DENY", "CONTROLLER_ESCALATION", "JOB_COST_ACCOUNTING_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "JOB_COST_ACCOUNTING_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "JOB_COST_ACCOUNTING_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "JOB_COST_ACCOUNTING_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "JOB_COST_ACCOUNTING_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "JOB_COST_ACCOUNTING_DUPLICATE_AUTHORITY", input);
  if (f.cross_provider || f.stale_source) return result("DENY", "SOURCE_REFRESH_REQUIRED", "JOB_COST_ACCOUNTING_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "JOB_COST_ACCOUNTING_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_JOB_COST_SIDE_EFFECT", "JOB_COST_ACCOUNTING_OPERATION_FORBIDDEN", input);
  if (f.data_limit) return result("ROUTE", "PROFESSIONAL_ACCOUNTING_REVIEW", "JOB_COST_ACCOUNTING_DATA_LIMIT_REVIEW_REQUIRED", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR"});
  if (f.unsupported_tool) return result("ROUTE", "PROFESSIONAL_ACCOUNTING_REVIEW", "JOB_COST_ACCOUNTING_TOOL_LIMIT_REVIEW_REQUIRED", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR"});
  if (!["CURRENT", "PREPARED_INACTIVE"].includes(e.authority_status) || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "JOB_COST_ACCOUNTING_CONTEXT" || !["CURRENT", "PREPARED_INACTIVE"].includes(e.model_policy_status) || e.model_route_status !== "BOUND" || e.upstream_router_status !== "BOUND" || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "JOB_COST_ACCOUNTING_CONTEXT_BINDING_INVALID", input);
  if (e.source_identity !== "SOURCE.GAO_GREEN_BOOK_2025" || e.source_version !== "2025" || e.job_cost_signal !== "FIN.JOB_COST_ACCOUNTING" || e.signal_status !== "BOUND" || e.task_status !== "JOB_COST_ACCOUNTING_ANALYSIS") return result("DENY", "TYPED_CONTEXT_REQUIRED", "JOB_COST_ACCOUNTING_SIGNAL_INVALID", input);
  if (!['ANALYZE', 'ASSEMBLE', 'ROUTE'].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "JOB_COST_ACCOUNTING_ACTION_INVALID", input);
  return result("ROUTE", "JOB_COST_ACCOUNTING_ATOMIC_HANDOFF", "JOB_COST_ACCOUNTING_ROUTE_READY", input, {
    routing_allowed: true,
    analysis_allowed: true,
    selected_owner: "AGENTOS.ORCHESTRATOR",
    handoff: {
      status: "WAITING_WITH_RECEIPT",
      next_action: "Analyze only the named job-cost control concern; route regulated, professional, uncertain, or out-of-scope claims to independent authority. Do not post entries, issue opinions, select tax treatment, accept results, or activate this candidate.",
      execution_instruction: false,
    },
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  process.stdin.setEncoding("utf8");
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const parsed = JSON.parse(input);
    process.stdout.write(`${JSON.stringify(evaluateJobCostAccountingBoundary(parsed), null, 2)}\n`);
  });
}
