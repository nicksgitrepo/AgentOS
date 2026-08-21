#!/usr/bin/env node

/* Read-only AI Search/RAG atomic specialist boundary.  It accepts only a
 * typed, repository-bound retrieval concern and returns a bounded handoff.  It
 * never answers the user, chooses a model/provider/corpus, writes memory or
 * project state, grants corpus permissions, or accepts the candidate. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {AI_SEARCH_RAG_BLOCK_ID, assertAiSearchRagCanonicalEvidence, resolveAiSearchRagCanonicalAuthority} from "./ai-search-rag-authority-binding.mjs";

export const AI_SEARCH_RAG_INPUT_SCHEMA = "agentos.ai_search_rag_boundary_input.v1";
export const AI_SEARCH_RAG_RESULT_SCHEMA = "agentos.ai_search_rag_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{1,160}$/u;
const REQUESTS = new Set(["ANALYZE_SEARCH_RAG", "ASSESS_RETRIEVAL_EVIDENCE", "ROUTE_SEARCH_RAG", "NOT_APPLICABLE", "UNRELATED_REQUEST", "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "SELECT_MODEL", "SELECT_PROVIDER", "ANSWER_USER"]);
const FORBIDDEN = new Set(["SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "SELECT_MODEL", "SELECT_PROVIDER", "ANSWER_USER"]);
const TOOLS = new Set(["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT", "READ_CORPUS_DESCRIPTOR", "READ_ROUTER_CATALOG"]);
const FLAGS = Object.freeze(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"]);
const REQUIRED_BLOCKS = Object.freeze(["specialist.ai.search-router", "specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate", "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate", "specialist.standard.nist-ai-rmf-1-0", "specialist.standard.nist-genai-profile-1-0"]);

function fail(message, code = "AI_SEARCH_RAG_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "AI_SEARCH_RAG_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "AI_SEARCH_RAG_UNKNOWN_FIELD"); }
function string(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} is invalid`, "AI_SEARCH_RAG_FIELD_INVALID"); }
function id(value, label) { string(value, label); assert(ID.test(value), `${label} is not canonical`, "AI_SEARCH_RAG_ID_INVALID"); }
function digest(value, label) { string(value, label, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "AI_SEARCH_RAG_DIGEST_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: AI_SEARCH_RAG_RESULT_SCHEMA, version: 1, disposition, route, analysis_allowed: false, acceptance_allowed: false, answer_generation_allowed: false, corpus_writes_allowed: false, external_side_effects: {candidate_reads: 0, source_reads: 0, corpus_reads: 0, protected_data_reads: 0, answer_writes: 0, corpus_writes: 0, memory_writes: 0, acceptance_calls: 0, model_selections: 0, provider_selections: 0, credential_accesses: 0, state_changes: 0}, error_code: errorCode, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }

function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "AI Search/RAG input"); assert(input.schema === AI_SEARCH_RAG_INPUT_SCHEMA && input.version === 1, "AI Search/RAG schema mismatch", "AI_SEARCH_RAG_SCHEMA_MISMATCH"); assert(REQUESTS.has(input.request_kind), "AI Search/RAG request is unknown", "AI_SEARCH_RAG_REQUEST_INVALID");
  exact(input.evidence, new Set(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "retrieval_signal", "retrieval_domain", "signal_status", "task_status", "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "authority_scope", "scope", "corpus_authority_status", "corpus_scope_status", "permission_filter_status", "standard_ai_rmf_block_sha256", "standard_ai_rmf_source_manifest_sha256", "standard_genai_block_sha256", "standard_genai_source_manifest_sha256", "model_snapshot_sha256", "model_task_class", "model_capability_floor", "model_required_capabilities", "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding_status", "memory_binding_mode", "memory_binding_sha256", "invalidation_status", "invalidation_rule", "project_data_present", "secret_data_present", "adversarial_flags"]), "AI Search/RAG evidence");
  const e = input.evidence; for (const key of ["authority_status", "custody_status", "custody_owner", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status", "retrieval_signal", "retrieval_domain", "signal_status", "task_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope", "scope", "corpus_authority_status", "corpus_scope_status", "permission_filter_status", "model_task_class", "invalidation_status", "invalidation_rule"]) string(e[key], `evidence.${key}`);
  id(e.custody_owner, "evidence.custody_owner"); assert(OPAQUE_REF.test(e.custody_ref), "custody reference is not opaque", "AI_SEARCH_RAG_CUSTODY_REF_INVALID"); digest(e.candidate_digest, "evidence.candidate_digest"); for (const key of ["standard_ai_rmf_block_sha256", "standard_ai_rmf_source_manifest_sha256", "standard_genai_block_sha256", "standard_genai_source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding_sha256"]) digest(e[key], `evidence.${key}`);
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "model capability floor is invalid", "AI_SEARCH_RAG_MODEL_ROUTE_UNBOUND"); assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "model capabilities are invalid", "AI_SEARCH_RAG_MODEL_ROUTE_UNBOUND"); assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= 5, "requested tools are invalid", "AI_SEARCH_RAG_TOOL_SCOPE_INVALID"); e.requested_tools.forEach((tool) => { string(tool, "requested_tools[]", 60); assert(TOOLS.has(tool), "unsupported tool", "AI_SEARCH_RAG_TOOL_SCOPE_INVALID"); }); assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && e.required_block_identities.every((value, index) => value === REQUIRED_BLOCKS[index]), "required block identities are incomplete", "AI_SEARCH_RAG_BLOCK_BINDING_INVALID");
  for (const key of ["context_complete", "project_data_present", "secret_data_present"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "AI_SEARCH_RAG_BOOLEAN_INVALID"); exact(e.adversarial_flags, new Set(FLAGS), "AI Search/RAG adversarial flags"); FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "AI_SEARCH_RAG_BOOLEAN_INVALID")); assert(scanPersistedRecord(input).safe, "AI Search/RAG input contains protected data", "AI_SEARCH_RAG_PRIVACY_DENIED"); assertAiSearchRagCanonicalEvidence(e, resolveAiSearchRagCanonicalAuthority());
}

export function evaluateAiSearchRagBoundary(input) {
  validate(input); const e = input.evidence; const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_SEARCH_RAG", "AI_SEARCH_RAG_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_SEARCH_RAG_SIDE_EFFECT", "AI_SEARCH_RAG_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict || f.duplicate_authority) return result("DENY", "CONTROL_PLANE_ESCALATION", "AI_SEARCH_RAG_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "AI_SEARCH_RAG_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "AI_SEARCH_RAG_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "AI_SEARCH_RAG_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "AI_SEARCH_RAG_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "AI_SEARCH_RAG_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "AI_SEARCH_RAG_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "AI_SEARCH_RAG_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_SEARCH_RAG_SIDE_EFFECT", "AI_SEARCH_RAG_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.custody_owner !== "AGENT.AI_SEARCH_RAG") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "AI_SEARCH_RAG_AUTHORITY_UNVERIFIED", input);
  if (e.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "AI_SEARCH_RAG_SOURCE_IDENTITY_INVALID", input);
  if (e.candidate_status !== "CURRENT_CANDIDATE" || e.retrieval_signal !== "AI.SEARCH_RAG" || e.retrieval_domain !== "SEARCH_RAG" || e.signal_status !== "BOUND" || e.task_status !== "RETRIEVAL_EVIDENCE_ANALYSIS" || e.context_status !== "AI_SEARCH_RAG_CONTEXT" || e.corpus_authority_status !== "EXTERNAL_TYPED" || e.corpus_scope_status !== "BOUND" || e.permission_filter_status !== "EVIDENCE_ONLY") return result("DENY", "TYPED_CONTEXT_REQUIRED", "AI_SEARCH_RAG_CONTEXT_BINDING_INVALID", input);
  if (e.model_route_status !== "BOUND") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "AI_SEARCH_RAG_MODEL_ROUTE_UNBOUND", input);
  if (e.memory_binding_status !== "BOUND" || e.invalidation_status !== "CURRENT") return result("DENY", "MEMORY_BINDING_REFRESH_REQUIRED", "AI_SEARCH_RAG_MEMORY_BINDING_INVALID", input);
  if (!["ANALYZE", "ASSESS", "ROUTE"].includes(e.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "AI_SEARCH_RAG_ACTION_INVALID", input);
  return result("ROUTE", "SEARCH_RAG_ANALYSIS_HANDOFF", "AI_SEARCH_RAG_ROUTE_READY", input, {analysis_allowed: true, selected_specialist: AI_SEARCH_RAG_BLOCK_ID, handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Analyze only the named retrieval/RAG evidence concern and return a typed finding or NOT_APPLICABLE handoff; do not choose a model/provider/corpus, answer the user, grant permissions, or write memory/project state.", execution_instruction: false}});
}
