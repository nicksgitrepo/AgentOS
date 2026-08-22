#!/usr/bin/env node

/* Read-only Rust Reference 1.97.1 language/backend specialist boundary. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const RUST_BACKEND_BOUNDARY_SCHEMA = "agentos.rust_backend_boundary_input.v1";
export const RUST_BACKEND_RESULT_SCHEMA = "agentos.rust_backend_result.v1";
export const RUST_BACKEND_BLOCK_ID = "specialist.software-language-runtime.rust-backend";
export const RUST_BACKEND_SPECIALIST = RUST_BACKEND_BLOCK_ID;

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const REQUESTS = new Set(["ANALYZE_RUST_BACKEND", "NOT_APPLICABLE", "UNRELATED_REQUEST", "COMPILE_ARTIFACT", "WRITE_PROJECT", "DEPLOY", "PUBLISH", "MUTATE_TOOLCHAIN", "ACCEPT", "SELF_REVIEW", "CERTIFY_CODE"]);
const FORBIDDEN_REQUESTS = new Set(["COMPILE_ARTIFACT", "WRITE_PROJECT", "DEPLOY", "PUBLISH", "MUTATE_TOOLCHAIN", "ACCEPT", "SELF_REVIEW", "CERTIFY_CODE"]);
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_CONTEXT"]);
const FLAG_KEYS = new Set(["authority_conflict", "scope_expanded", "cross_provider", "duplicate_authority", "umbrella_authority", "false_positive", "stale_source", "unsupported_tool", "missing_context", "unsafe_action", "wrong_language", "wrong_version", "borrow_unverified", "crate_mismatch", "unsafe_boundary"]);
const EVIDENCE_KEYS = new Set(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "standard_identity", "standard_version", "standard_effective_date", "standard_retrieved_date", "publisher_identity", "language", "edition", "toolchain", "runtime_surface", "crate_ref", "target_triple", "async_model", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_status", "applicability_complete", "runtime_evidence", "ownership_evidence", "runtime_context", "code_evidence", "candidate_digest", "block_revision", "source_manifest_sha256", "source_content_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding", "adversarial_flags"]);
const REQUIRED_FIELDS = Object.freeze(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "standard_identity", "standard_version", "standard_retrieved_date", "publisher_identity", "language", "edition", "toolchain", "runtime_surface", "crate_ref", "target_triple", "async_model", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "applicability_status", "applicability_complete", "runtime_evidence", "ownership_evidence", "runtime_context", "code_evidence", "candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding"]);

function fail(message, code = "RUST_BACKEND_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, label, code = "RUST_BACKEND_SHAPE_INVALID") { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, code); for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "RUST_BACKEND_UNKNOWN_FIELD"); }
function bounded(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be bounded`, "RUST_BACKEND_FIELD_INVALID"); }
function safeId(value, label) { bounded(value, label); assert(SAFE_ID.test(value), `${label} is not canonical`, "RUST_BACKEND_ID_INVALID"); }
function opaqueRef(value, label) { bounded(value, label); assert(OPAQUE_REF.test(value), `${label} is not opaque`, "RUST_BACKEND_REF_INVALID"); }
function hash(value, label, {nullable = false} = {}) { if (nullable && value === null) return; assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "RUST_BACKEND_DIGEST_INVALID"); }
function date(value, label) { bounded(value, label, 20); assert(DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "RUST_BACKEND_DATE_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: RUST_BACKEND_RESULT_SCHEMA, version: 1, disposition, route, error_code: errorCode, routing_allowed: false, acceptance_allowed: false, external_side_effects: {specialist_invocations: 0, source_reads: 0, runtime_reads: 0, toolchain_mutations: 0, project_writes: 0, credential_accesses: 0, state_changes: 0}, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }

function validateOwnership(value) {
  exactKeys(value, new Set(["status", "borrow_model", "lifetime_status", "unsafe_boundary", "aliasing_status", "context_digest"]), "ownership_evidence");
  assert(value.status === "BOUNDED", "ownership evidence is not bounded", "RUST_BACKEND_OWNERSHIP_INVALID");
  assert(value.borrow_model === "OWNERSHIP_BORROWING", "borrow model is not Rust ownership/borrowing", "RUST_BACKEND_OWNERSHIP_INVALID");
  assert(value.lifetime_status === "BOUNDED" && value.unsafe_boundary === "DECLARED" && value.aliasing_status === "EXPLICIT", "ownership boundary is incomplete", "RUST_BACKEND_OWNERSHIP_INVALID");
  hash(value.context_digest, "ownership_evidence.context_digest");
}
function validateRuntimeContext(value) {
  exactKeys(value, new Set(["language", "edition", "toolchain", "crate_ref", "target_triple", "async_model", "context_digest"]), "runtime_context");
  assert(value.language === "RUST" && value.edition === "2024" && value.toolchain === "1.97.1", "runtime context identity is not Rust 2024/1.97.1", "RUST_BACKEND_RUNTIME_IDENTITY_INVALID");
  opaqueRef(value.crate_ref, "runtime_context.crate_ref"); opaqueRef(value.target_triple, "runtime_context.target_triple"); bounded(value.async_model, "runtime_context.async_model", 60); hash(value.context_digest, "runtime_context.context_digest");
}
function validateCodeEvidence(value) {
  exactKeys(value, new Set(["status", "language", "edition", "toolchain", "borrow_check_status", "unsafe_blocks", "compile_mode"]), "code_evidence");
  assert(value.status === "BOUNDED" && value.language === "RUST" && value.edition === "2024" && value.toolchain === "1.97.1", "code evidence identity is not exact", "RUST_BACKEND_CODE_EVIDENCE_INVALID");
  assert(value.borrow_check_status === "EVIDENCED" && Number.isSafeInteger(value.unsafe_blocks) && value.unsafe_blocks >= 0 && value.unsafe_blocks <= 1024 && value.compile_mode === "ANALYSIS_ONLY", "code evidence is not bounded read-only evidence", "RUST_BACKEND_CODE_EVIDENCE_INVALID");
}
function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, "Rust Backend evidence");
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "standard_identity", "standard_version", "publisher_identity", "language", "edition", "toolchain", "runtime_surface", "signal", "target_ref", "scope", "requested_action", "applicability_status", "runtime_evidence", "block_revision", "memory_binding"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.custody_owner !== undefined) safeId(evidence.custody_owner, "evidence.custody_owner"); if (evidence.custody_ref !== undefined) opaqueRef(evidence.custody_ref, "evidence.custody_ref");
  if (evidence.crate_ref !== undefined) opaqueRef(evidence.crate_ref, "evidence.crate_ref"); if (evidence.target_triple !== undefined) opaqueRef(evidence.target_triple, "evidence.target_triple");
  for (const key of ["source_effective_date", "source_retrieved_date", "standard_retrieved_date"]) if (evidence[key] !== undefined && evidence[key] !== null) date(evidence[key], `evidence.${key}`);
  if (evidence.standard_effective_date !== undefined && evidence.standard_effective_date !== null) date(evidence.standard_effective_date, "evidence.standard_effective_date");
  if (evidence.requested_tools !== undefined) { assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "requested tools are not bounded", "RUST_BACKEND_TOOL_LIST_INVALID"); for (const tool of evidence.requested_tools) bounded(tool, "requested tool", 60); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_complete"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "RUST_BACKEND_BOOLEAN_INVALID");
  if (evidence.adversarial_flags !== undefined) { exactKeys(evidence.adversarial_flags, FLAG_KEYS, "adversarial_flags"); for (const value of Object.values(evidence.adversarial_flags)) assert(typeof value === "boolean", "adversarial flag must be boolean", "RUST_BACKEND_BOOLEAN_INVALID"); }
  validateOwnership(evidence.ownership_evidence); validateRuntimeContext(evidence.runtime_context); validateCodeEvidence(evidence.code_evidence);
  for (const key of ["candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256"]) if (evidence[key] !== undefined) hash(evidence[key], `evidence.${key}`);
  if (evidence.source_content_sha256 !== undefined) hash(evidence.source_content_sha256, "evidence.source_content_sha256", {nullable: true});
  assert(scanPersistedRecord({schema: RUST_BACKEND_BOUNDARY_SCHEMA, version: 1, evidence}).safe, "Rust evidence contains protected data", "RUST_BACKEND_PRIVACY_DENIED");
}
function missing(evidence) { return REQUIRED_FIELDS.filter((key) => evidence[key] === undefined || evidence[key] === ""); }

export function evaluateRustBackendBoundary(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "Rust Backend input");
  assert(input.schema === RUST_BACKEND_BOUNDARY_SCHEMA && input.version === 1, "Rust Backend schema mismatch", "RUST_BACKEND_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "Rust Backend request kind is not recognized", "RUST_BACKEND_REQUEST_INVALID");
  validateEvidence(input.evidence); const evidence = input.evidence; const flags = evidence.adversarial_flags ?? {};
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || flags.false_positive === true) return result("DENY", "NO_RUST_BACKEND_SCOPE", "RUST_BACKEND_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_RUST_BACKEND_SIDE_EFFECT", "RUST_BACKEND_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "RUST_BACKEND_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || flags.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "RUST_BACKEND_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED" || flags.scope_expanded === true) return result("DENY", "NARROW_SCOPE_REQUIRED", "RUST_BACKEND_SCOPE_EXPANSION_FORBIDDEN", input);
  if (flags.duplicate_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "RUST_BACKEND_SIBLING_SUBSTITUTION_FORBIDDEN", input);
  if (flags.umbrella_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "RUST_BACKEND_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (flags.cross_provider === true || flags.wrong_language === true || flags.wrong_version === true) return result("DENY", "SOURCE_REFRESH_REQUIRED", "RUST_BACKEND_STANDARD_IDENTITY_INVALID", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "RUST_BACKEND_PROTECTED_DATA_FORBIDDEN", input);
  if (flags.stale_source === true || evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "RUST_BACKEND_SOURCE_STALE_OR_UNVERIFIED", input);
  if (flags.unsupported_tool === true || (Array.isArray(evidence.requested_tools) && evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool)))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "RUST_BACKEND_TOOL_SCOPE_FORBIDDEN", input);
  if (flags.missing_context === true || evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUST_BACKEND_CONTEXT_INCOMPLETE", input, {missing_fields: missing(evidence)});
  const absent = missing(evidence); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUST_BACKEND_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.SOFTWARE_LANGUAGE_RUNTIME_RUST_BACKEND") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "RUST_BACKEND_AUTHORITY_UNVERIFIED", input);
  if (evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "RUST_BACKEND_SOURCE_IDENTITY_INVALID", input);
  if (evidence.standard_identity !== "source.rust-reference-1-97-1" || evidence.standard_version !== "1.97.1" || evidence.publisher_identity !== "Rust Project" || evidence.standard_effective_date !== null) return result("DENY", "SOURCE_REFRESH_REQUIRED", "RUST_BACKEND_STANDARD_IDENTITY_INVALID", input);
  if (evidence.language !== "RUST" || evidence.edition !== "2024" || evidence.toolchain !== "1.97.1" || evidence.runtime_surface !== "BACKEND" || evidence.signal !== "RUST") return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUST_BACKEND_RUNTIME_IDENTITY_INVALID", input);
  if (evidence.target_ref !== RUST_BACKEND_BLOCK_ID) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "RUST_BACKEND_TARGET_MISMATCH", input);
  if (evidence.scope !== "NARROW" || evidence.requested_action !== "ANALYZE_RUST_BACKEND") return result("DENY", "NARROW_SCOPE_REQUIRED", "RUST_BACKEND_SCOPE_INVALID", input);
  if (evidence.applicability_status !== "EXTERNAL_TYPED" || evidence.applicability_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUST_BACKEND_APPLICABILITY_INCOMPLETE", input);
  if (evidence.runtime_evidence !== "BOUNDED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUST_BACKEND_RUNTIME_EVIDENCE_UNBOUNDED", input);
  const runtime = evidence.runtime_context; if (runtime.language !== evidence.language || runtime.edition !== evidence.edition || runtime.toolchain !== evidence.toolchain || runtime.crate_ref !== evidence.crate_ref || runtime.target_triple !== evidence.target_triple) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUST_BACKEND_RUNTIME_CONTEXT_INVALID", input);
  if (flags.borrow_unverified === true || evidence.ownership_evidence.status !== "BOUNDED" || evidence.ownership_evidence.unsafe_boundary !== "DECLARED" || evidence.code_evidence.borrow_check_status !== "EVIDENCED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUST_BACKEND_OWNERSHIP_EVIDENCE_INCOMPLETE", input);
  if (flags.unsafe_boundary === true || evidence.code_evidence.unsafe_blocks > 0) return result("DENY", "TYPED_CONTEXT_REQUIRED", "RUST_BACKEND_UNSAFE_BOUNDARY_UNRESOLVED", input);
  return result("ROUTE", "RUST_BACKEND_SPECIALIST_HANDOFF", "RUST_BACKEND_ROUTE_READY", input, {routing_allowed: true, selected_specialist: RUST_BACKEND_SPECIALIST, handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Analyze only the supplied bounded Rust language/backend evidence; do not compile, mutate toolchains, write projects, or certify code.", execution_instruction: false}});
}

export const evaluateRustBackend = evaluateRustBackendBoundary;
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(evaluateRustBackendBoundary(JSON.parse(process.argv[2] ?? "null")), null, 2)}\n`);
