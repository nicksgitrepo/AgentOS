#!/usr/bin/env node

/* Read-only AI Search/RAG specialist boundary.  It analyzes one typed
 * retrieval-evidence concern and returns a narrow handoff; it never selects a
 * model/provider/corpus, answers a user, writes memory, or mutates project
 * state. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const AI_SEARCH_RAG_INPUT_SCHEMA = "agentos.ai_search_rag_boundary_input.v1";
export const AI_SEARCH_RAG_RESULT_SCHEMA = "agentos.ai_search_rag_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const REQUESTS = new Set(["ANALYZE_SEARCH_RAG", "ROUTE_SEARCH_RAG_HANDOFF", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "SELECT_MODEL", "SELECT_PROVIDER", "ANSWER_USER"]);
const FORBIDDEN = new Set(["REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "SELECT_MODEL", "SELECT_PROVIDER", "ANSWER_USER"]);
const TOOLS = new Set(["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CORPUS_DESCRIPTOR", "READ_CONTEXT", "READ_STANDARD_BLOCK"]);
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"];
const EVIDENCE_KEYS = ["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal", "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "scope", "corpus_scope", "corpus_ref", "tenant_scope_status", "standard_block_sha256", "standard_source_manifest_sha256", "genai_standard_block_sha256", "genai_standard_source_manifest_sha256", "model_snapshot_sha256", "model_task_class", "model_capability_floor", "model_required_capabilities", "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_context_status", "context_invalidation_status", "project_data_present", "secret_data_present", "memory_write_requested", "adversarial_flags"];

function fail(message, code = "AI_SEARCH_RAG_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "AI_SEARCH_RAG_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} has unknown field ${key}`, "AI_SEARCH_RAG_UNKNOWN_FIELD"); }
function string(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} is invalid`, "AI_SEARCH_RAG_FIELD_INVALID"); }
function digest(value, name) { string(value, name, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${name} is not a real digest`, "AI_SEARCH_RAG_DIGEST_INVALID"); }
function id(value, name) { string(value, name); assert(ID.test(value), `${name} is not canonical`, "AI_SEARCH_RAG_ID_INVALID"); }
function ref(value, name) { string(value, name, 180); assert(REF.test(value), `${name} is not opaque`, "AI_SEARCH_RAG_REF_INVALID"); }
function result(disposition, route, code, input, extra = {}) { const base = {schema: AI_SEARCH_RAG_RESULT_SCHEMA, version: 1, disposition, route, analysis_allowed: false, routing_allowed: false, acceptance_allowed: false, model_selection_allowed: false, corpus_write_allowed: false, memory_write_allowed: false, external_side_effects: {corpus_reads: 0, corpus_writes: 0, answer_writes: 0, model_selections: 0, provider_selections: 0, acceptance_calls: 0, credential_accesses: 0, memory_writes: 0, state_changes: 0}, error_code: code, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }

function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "AI Search/RAG input");
  assert(input.schema === AI_SEARCH_RAG_INPUT_SCHEMA && input.version === 1, "AI Search/RAG schema mismatch", "AI_SEARCH_RAG_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "AI Search/RAG request is unknown", "AI_SEARCH_RAG_REQUEST_INVALID");
  exact(input.evidence, new Set(EVIDENCE_KEYS), "AI Search/RAG evidence");
  const e = input.evidence;
  for (const key of ["authority_status", "custody_status", "custody_owner", "source_status", "source_identity", "source_version", "candidate_status", "signal", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope", "scope", "corpus_scope", "tenant_scope_status", "model_task_class", "memory_context_status", "context_invalidation_status"]) string(e[key], `evidence.${key}`);
  for (const key of ["source_effective_date", "source_retrieved_date"]) { string(e[key], `evidence.${key}`, 10); assert(DATE.test(e[key]), `evidence.${key} is not an ISO date`, "AI_SEARCH_RAG_DATE_INVALID"); }
  ref(e.custody_ref, "evidence.custody_ref"); ref(e.corpus_ref, "evidence.corpus_ref");
  for (const key of ["candidate_digest", "standard_block_sha256", "standard_source_manifest_sha256", "genai_standard_block_sha256", "genai_standard_source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256"]) digest(e[key], `evidence.${key}`);
  assert(Number.isInteger(e.model_capability_floor) && e.model_capability_floor > 0, "evidence.model_capability_floor is invalid", "AI_SEARCH_RAG_MODEL_ROUTE_INVALID");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0, "evidence.model_required_capabilities is invalid", "AI_SEARCH_RAG_MODEL_ROUTE_INVALID"); e.model_required_capabilities.forEach((value) => id(value, "model_required_capabilities[]"));
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === 5 && new Set(e.required_block_identities).size === 5, "required block identities are incomplete", "AI_SEARCH_RAG_BLOCK_BINDING_INVALID"); e.required_block_identities.forEach((value) => id(value, "required_block_identities[]"));
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0, "requested tools are invalid", "AI_SEARCH_RAG_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 80); assert(TOOLS.has(tool), "unsupported tool", "AI_SEARCH_RAG_TOOL_SCOPE_INVALID"); });
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "memory_write_requested"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "AI_SEARCH_RAG_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "AI Search/RAG adversarial flags"); Object.values(e.adversarial_flags).forEach((value) => assert(typeof value === "boolean", "adversarial flag must be boolean", "AI_SEARCH_RAG_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "AI Search/RAG input contains protected data", "AI_SEARCH_RAG_PRIVACY_DENIED");
}

export function evaluateAiSearchRagBoundary(input) {
  validate(input);
  const e = input.evidence;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || e.adversarial_flags.unrelated_scope) return result("DENY", "NO_SEARCH_RAG_SCOPE", "AI_SEARCH_RAG_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_SEARCH_RAG_SIDE_EFFECT", "AI_SEARCH_RAG_OPERATION_FORBIDDEN", input);
  const f = e.adversarial_flags;
  if (f.authority_conflict) return result("DENY", "CONTROLLER_ESCALATION", "AI_SEARCH_RAG_AUTHORITY_CONFLICT", input);
  if (f.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "AI_SEARCH_RAG_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "AI_SEARCH_RAG_PROTECTED_DATA_FORBIDDEN", input);
  if (e.memory_write_requested) return result("DENY", "MEMORY_BOUNDARY_REQUIRED", "AI_SEARCH_RAG_MEMORY_WRITE_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "AI_SEARCH_RAG_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "AI_SEARCH_RAG_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.duplicate_authority) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "AI_SEARCH_RAG_DUPLICATE_AUTHORITY", input);
  if (f.cross_provider) return result("DENY", "SOURCE_REFRESH_REQUIRED", "AI_SEARCH_RAG_SOURCE_IDENTITY_INVALID", input);
  if (f.stale_source) return result("DENY", "SOURCE_REFRESH_REQUIRED", "AI_SEARCH_RAG_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("ROUTE", "TOOL_CUSTODY_REVIEW", "AI_SEARCH_RAG_TOOL_REVIEW_REQUIRED", input, {routing_allowed: true, selected_owner: "AGENTOS.ORCHESTRATOR"});
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "AI_SEARCH_RAG_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_SEARCH_RAG_SIDE_EFFECT", "AI_SEARCH_RAG_OPERATION_FORBIDDEN", input);
  if (e.model_policy_status === "POLICY_SNAPSHOT_STALE") return result("BLOCKED_EXACT", "MODEL_POLICY_REFRESH_REQUIRED", "POLICY_SNAPSHOT_STALE", input, {blocked_by: "POLICY_SNAPSHOT_STALE"});
  if (e.model_policy_status !== "CURRENT" || e.model_route_status !== "BOUND") return result("BLOCKED_EXACT", "MODEL_POLICY_REFRESH_REQUIRED", "AI_SEARCH_RAG_MODEL_ROUTE_UNBOUND", input, {blocked_by: "CANONICAL_MODEL_ROUTE_REQUIRED"});
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.source_status !== "CURRENT_VERIFIED" || e.candidate_status !== "CURRENT_CANDIDATE" || e.context_status !== "AI_SEARCH_RAG_CONTEXT" || e.context_complete !== true || e.authority_scope !== "AI_SEARCH_RAG" || e.scope !== "NARROW" || e.corpus_scope !== "EXTERNAL_TYPED_CORPUS" || e.tenant_scope_status !== "BOUND") return result("DENY", "TYPED_CONTEXT_REQUIRED", "AI_SEARCH_RAG_CONTEXT_BINDING_INVALID", input);
  if (!(["ANALYZE", "ROUTE", "CLASSIFY"].includes(e.requested_action))) return result("DENY", "TYPED_CONTEXT_REQUIRED", "AI_SEARCH_RAG_ACTION_INVALID", input);
  if (e.signal !== "AI.SEARCH_RAG" || e.signal_status !== "BOUND" || e.task_status !== "RETRIEVAL_ANALYSIS") return result("DENY", "TYPED_CONTEXT_REQUIRED", "AI_SEARCH_RAG_SIGNAL_INVALID", input);
  if (e.source_identity !== "SOURCE.NIST_AI_RMF" || e.source_version !== "1.0") return result("DENY", "SOURCE_REFRESH_REQUIRED", "AI_SEARCH_RAG_SOURCE_BINDING_INVALID", input);
  if (e.memory_context_status !== "INVALIDATED_ON_CANDIDATE_CHANGE" || e.context_invalidation_status !== "BOUND") return result("DENY", "TYPED_CONTEXT_REQUIRED", "AI_SEARCH_RAG_CONTEXT_INVALIDATION_INVALID", input);
  if (input.request_kind === "ROUTE_SEARCH_RAG_HANDOFF" || e.requested_action === "ROUTE") return result("ROUTE", "AI_SEARCH_RAG_HANDOFF", "AI_SEARCH_RAG_HANDOFF_READY", input, {analysis_allowed: true, routing_allowed: true, selected_specialist: "specialist.ai.search-rag", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Analyze only the named retrieval/RAG evidence concern, then return an evidence-bounded finding or NOT_APPLICABLE; do not select a model/provider/corpus or write memory.", execution_instruction: false}});
  return result("ROUTE", "AI_SEARCH_RAG_ANALYSIS_HANDOFF", "AI_SEARCH_RAG_ROUTE_READY", input, {analysis_allowed: true, selected_specialist: "specialist.ai.search-rag", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Analyze only the named retrieval/RAG evidence concern, then return an evidence-bounded finding or NOT_APPLICABLE; do not select a model/provider/corpus or write memory.", execution_instruction: false}});
}
