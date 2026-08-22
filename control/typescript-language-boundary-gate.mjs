#!/usr/bin/env node

/* Read-only TypeScript 5.9 language/compiler specialist boundary. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const TYPESCRIPT_LANGUAGE_BOUNDARY_SCHEMA = "agentos.typescript_language_boundary_input.v1";
export const TYPESCRIPT_LANGUAGE_RESULT_SCHEMA = "agentos.typescript_language_result.v1";
export const TYPESCRIPT_LANGUAGE_BLOCK_ID = "specialist.software-language-runtime.typescript-language";
export const TYPESCRIPT_LANGUAGE_SPECIALIST = TYPESCRIPT_LANGUAGE_BLOCK_ID;

const SAFE_ID = /^[A-Z][A-Z0-9._:-]{1,120}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,160}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const REQUESTS = new Set(["ANALYZE_TYPESCRIPT_LANGUAGE", "NOT_APPLICABLE", "UNRELATED_REQUEST", "EMIT_ARTIFACT", "WRITE_PROJECT", "DEPLOY", "PUBLISH", "MUTATE_TOOLCHAIN", "ACCEPT", "SELF_REVIEW", "CERTIFY_CODE"]);
const FORBIDDEN_REQUESTS = new Set(["EMIT_ARTIFACT", "WRITE_PROJECT", "DEPLOY", "PUBLISH", "MUTATE_TOOLCHAIN", "ACCEPT", "SELF_REVIEW", "CERTIFY_CODE"]);
const ALLOWED_TOOLS = new Set(["READ_SOURCE", "READ_CONTEXT"]);
const FLAG_KEYS = new Set(["authority_conflict", "scope_expanded", "cross_provider", "duplicate_authority", "umbrella_authority", "false_positive", "stale_source", "unsupported_tool", "missing_context", "unsafe_action", "wrong_language", "wrong_version", "react_scope", "compiler_options_unverified", "type_system_unverified", "emit_unverified"]);
const EVIDENCE_KEYS = new Set(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "standard_identity", "standard_version", "standard_effective_date", "standard_retrieved_date", "publisher_identity", "language", "language_version", "runtime_surface", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_status", "applicability_complete", "compiler_options", "compiler_evidence", "type_system_evidence", "emission_evidence", "runtime_context", "candidate_digest", "block_revision", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding", "adversarial_flags"]);
const REQUIRED_FIELDS = Object.freeze(["authority_status", "custody_status", "custody_owner", "custody_ref", "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "standard_identity", "standard_version", "standard_effective_date", "standard_retrieved_date", "publisher_identity", "language", "language_version", "runtime_surface", "signal", "target_ref", "context_complete", "scope", "requested_action", "requested_tools", "applicability_status", "applicability_complete", "compiler_options", "compiler_evidence", "type_system_evidence", "emission_evidence", "runtime_context", "candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256", "memory_binding"]);

function fail(message, code = "TYPESCRIPT_LANGUAGE_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, label, code = "TYPESCRIPT_LANGUAGE_SHAPE_INVALID") { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, code); for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "TYPESCRIPT_LANGUAGE_UNKNOWN_FIELD"); }
function bounded(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be bounded`, "TYPESCRIPT_LANGUAGE_FIELD_INVALID"); }
function safeId(value, label) { bounded(value, label); assert(SAFE_ID.test(value), `${label} is not canonical`, "TYPESCRIPT_LANGUAGE_ID_INVALID"); }
function opaqueRef(value, label) { bounded(value, label); assert(OPAQUE_REF.test(value), `${label} is not opaque`, "TYPESCRIPT_LANGUAGE_REF_INVALID"); }
function hash(value, label, {nullable = false} = {}) { if (nullable && value === null) return; assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "TYPESCRIPT_LANGUAGE_DIGEST_INVALID"); }
function date(value, label) { bounded(value, label, 20); assert(DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "TYPESCRIPT_LANGUAGE_DATE_INVALID"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: TYPESCRIPT_LANGUAGE_RESULT_SCHEMA, version: 1, disposition, route, error_code: errorCode, routing_allowed: false, acceptance_allowed: false, external_side_effects: {specialist_invocations: 0, source_reads: 0, compiler_invocations: 0, toolchain_mutations: 0, project_writes: 0, credential_accesses: 0, state_changes: 0}, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }

function validateCompilerOptions(value) {
  exactKeys(value, new Set(["target", "module", "module_resolution", "strict", "no_emit", "declaration", "isolated_modules"]), "compiler_options");
  assert(value.target === "ES2022" && value.module === "ESNext" && value.module_resolution === "Bundler", "compiler target/module identity is not exact", "TYPESCRIPT_LANGUAGE_COMPILER_OPTIONS_INVALID");
  assert(value.strict === true && value.no_emit === true && value.declaration === false && value.isolated_modules === true, "compiler options are not bounded read-only options", "TYPESCRIPT_LANGUAGE_COMPILER_OPTIONS_INVALID");
}
function validateCompilerEvidence(value) {
  exactKeys(value, new Set(["status", "version", "options_digest", "options_status", "emit_status", "context_digest"]), "compiler_evidence");
  assert(value.status === "BOUNDED" && value.version === "5.9" && value.options_status === "EVIDENCED" && value.emit_status === "ANALYSIS_ONLY", "compiler evidence is not bounded to TypeScript 5.9", "TYPESCRIPT_LANGUAGE_COMPILER_EVIDENCE_INVALID");
  hash(value.options_digest, "compiler_evidence.options_digest"); hash(value.context_digest, "compiler_evidence.context_digest");
}
function validateTypeSystemEvidence(value) {
  exactKeys(value, new Set(["status", "version", "strictness", "check_status", "unknowns", "context_digest"]), "type_system_evidence");
  assert(value.status === "BOUNDED" && value.version === "5.9" && value.strictness === "DECLARED" && value.check_status === "EVIDENCED" && value.unknowns === "EXPLICIT", "type-system evidence is not bounded", "TYPESCRIPT_LANGUAGE_TYPE_SYSTEM_EVIDENCE_INVALID");
  hash(value.context_digest, "type_system_evidence.context_digest");
}
function validateEmissionEvidence(value) {
  exactKeys(value, new Set(["status", "no_emit", "declaration_emission", "output_status", "context_digest"]), "emission_evidence");
  assert(value.status === "BOUNDED" && value.no_emit === true && value.declaration_emission === false && value.output_status === "NOT_REQUESTED", "emission evidence is not read-only", "TYPESCRIPT_LANGUAGE_EMISSION_EVIDENCE_INVALID");
  hash(value.context_digest, "emission_evidence.context_digest");
}
function validateRuntimeContext(value) {
  exactKeys(value, new Set(["language", "version", "target", "module", "module_resolution", "context_digest"]), "runtime_context");
  assert(value.language === "TYPESCRIPT" && value.version === "5.9" && value.target === "ES2022" && value.module === "ESNext" && value.module_resolution === "Bundler", "runtime context identity is not TypeScript 5.9", "TYPESCRIPT_LANGUAGE_RUNTIME_IDENTITY_INVALID");
  hash(value.context_digest, "runtime_context.context_digest");
}
function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, "TypeScript Language evidence");
  for (const key of ["authority_status", "custody_status", "source_status", "source_identity", "source_version", "standard_identity", "standard_version", "publisher_identity", "language", "language_version", "runtime_surface", "signal", "target_ref", "scope", "requested_action", "applicability_status", "block_revision", "memory_binding"]) if (evidence[key] !== undefined) bounded(evidence[key], `evidence.${key}`);
  if (evidence.custody_owner !== undefined) safeId(evidence.custody_owner, "evidence.custody_owner"); if (evidence.custody_ref !== undefined) opaqueRef(evidence.custody_ref, "evidence.custody_ref");
  for (const key of ["source_effective_date", "source_retrieved_date", "standard_effective_date", "standard_retrieved_date"]) if (evidence[key] !== undefined && evidence[key] !== null) date(evidence[key], `evidence.${key}`);
  if (evidence.requested_tools !== undefined) { assert(Array.isArray(evidence.requested_tools) && evidence.requested_tools.length <= 4, "requested tools are not bounded", "TYPESCRIPT_LANGUAGE_TOOL_LIST_INVALID"); for (const tool of evidence.requested_tools) bounded(tool, "requested tool", 60); }
  for (const key of ["context_complete", "self_acceptance", "scope_expanded", "authority_conflict", "project_data_present", "secret_data_present", "applicability_complete"]) if (evidence[key] !== undefined) assert(typeof evidence[key] === "boolean", `${key} must be boolean`, "TYPESCRIPT_LANGUAGE_BOOLEAN_INVALID");
  if (evidence.adversarial_flags !== undefined) { exactKeys(evidence.adversarial_flags, FLAG_KEYS, "adversarial_flags"); for (const value of Object.values(evidence.adversarial_flags)) assert(typeof value === "boolean", "adversarial flag must be boolean", "TYPESCRIPT_LANGUAGE_BOOLEAN_INVALID"); }
  validateCompilerOptions(evidence.compiler_options); validateCompilerEvidence(evidence.compiler_evidence); validateTypeSystemEvidence(evidence.type_system_evidence); validateEmissionEvidence(evidence.emission_evidence); validateRuntimeContext(evidence.runtime_context);
  assert(evidence.compiler_evidence.options_digest === canonicalDigest(evidence.compiler_options), "compiler option digest differs from its options", "TYPESCRIPT_LANGUAGE_COMPILER_OPTIONS_DIGEST_INVALID");
  for (const key of ["candidate_digest", "source_manifest_sha256", "standard_block_sha256", "model_snapshot_sha256", "context_receipt_sha256", "upstream_router_result_sha256"]) if (evidence[key] !== undefined) hash(evidence[key], `evidence.${key}`);
  assert(scanPersistedRecord({schema: TYPESCRIPT_LANGUAGE_BOUNDARY_SCHEMA, version: 1, evidence}).safe, "TypeScript evidence contains protected data", "TYPESCRIPT_LANGUAGE_PRIVACY_DENIED");
}
function missing(evidence) { return REQUIRED_FIELDS.filter((key) => evidence[key] === undefined || evidence[key] === ""); }

export function evaluateTypeScriptLanguageBoundary(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "evidence"]), "TypeScript Language input");
  assert(input.schema === TYPESCRIPT_LANGUAGE_BOUNDARY_SCHEMA && input.version === 1, "TypeScript Language schema mismatch", "TYPESCRIPT_LANGUAGE_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "TypeScript Language request kind is not recognized", "TYPESCRIPT_LANGUAGE_REQUEST_INVALID");
  validateEvidence(input.evidence); const evidence = input.evidence; const flags = evidence.adversarial_flags ?? {};
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || flags.false_positive === true || flags.react_scope === true) return result("DENY", "NO_TYPESCRIPT_LANGUAGE_SCOPE", "TYPESCRIPT_LANGUAGE_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_TYPESCRIPT_LANGUAGE_SIDE_EFFECT", "TYPESCRIPT_LANGUAGE_OPERATION_FORBIDDEN", input);
  if (evidence.self_acceptance === true) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "TYPESCRIPT_LANGUAGE_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (evidence.authority_conflict === true || flags.authority_conflict === true) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "TYPESCRIPT_LANGUAGE_AUTHORITY_CONFLICT", input);
  if (evidence.scope_expanded === true || evidence.scope === "BROAD" || evidence.scope === "UNRELATED" || flags.scope_expanded === true) return result("DENY", "NARROW_SCOPE_REQUIRED", "TYPESCRIPT_LANGUAGE_SCOPE_EXPANSION_FORBIDDEN", input);
  if (flags.duplicate_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "TYPESCRIPT_LANGUAGE_SIBLING_SUBSTITUTION_FORBIDDEN", input);
  if (flags.umbrella_authority === true) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "TYPESCRIPT_LANGUAGE_UMBRELLA_AUTHORITY_FORBIDDEN", input);
  if (flags.cross_provider === true || flags.wrong_language === true || flags.wrong_version === true) return result("DENY", "SOURCE_REFRESH_REQUIRED", "TYPESCRIPT_LANGUAGE_STANDARD_IDENTITY_INVALID", input);
  if (evidence.project_data_present === true || evidence.secret_data_present === true) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "TYPESCRIPT_LANGUAGE_PROTECTED_DATA_FORBIDDEN", input);
  if (flags.stale_source === true || evidence.source_status !== "CURRENT") return result("DENY", "SOURCE_REFRESH_REQUIRED", "TYPESCRIPT_LANGUAGE_SOURCE_STALE_OR_UNVERIFIED", input);
  if (flags.unsupported_tool === true || (Array.isArray(evidence.requested_tools) && evidence.requested_tools.some((tool) => !ALLOWED_TOOLS.has(tool)))) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "TYPESCRIPT_LANGUAGE_TOOL_SCOPE_FORBIDDEN", input);
  if (flags.missing_context === true || evidence.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_CONTEXT_INCOMPLETE", input, {missing_fields: missing(evidence)});
  if (flags.compiler_options_unverified === true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_COMPILER_OPTIONS_UNVERIFIED", input);
  if (flags.type_system_unverified === true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_TYPE_SYSTEM_EVIDENCE_INCOMPLETE", input);
  if (flags.emit_unverified === true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_EMISSION_EVIDENCE_INCOMPLETE", input);
  const absent = missing(evidence); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  if (evidence.authority_status !== "CURRENT" || evidence.custody_status !== "BOUND" || evidence.custody_owner !== "AGENT.SOFTWARE_LANGUAGE_RUNTIME_TYPESCRIPT_LANGUAGE") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "TYPESCRIPT_LANGUAGE_AUTHORITY_UNVERIFIED", input);
  if (evidence.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || evidence.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "TYPESCRIPT_LANGUAGE_SOURCE_IDENTITY_INVALID", input);
  if (evidence.standard_identity !== "source.typescript-5-9" || evidence.standard_version !== "5.9" || evidence.standard_effective_date !== "2025-08-01" || evidence.publisher_identity !== "Microsoft TypeScript") return result("DENY", "SOURCE_REFRESH_REQUIRED", "TYPESCRIPT_LANGUAGE_STANDARD_IDENTITY_INVALID", input);
  if (evidence.language !== "TYPESCRIPT" || evidence.language_version !== "5.9" || evidence.runtime_surface !== "WEB" || evidence.signal !== "TYPESCRIPT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_RUNTIME_IDENTITY_INVALID", input);
  if (evidence.target_ref !== TYPESCRIPT_LANGUAGE_BLOCK_ID) return result("DENY", "NARROW_SPECIALIST_REQUIRED", "TYPESCRIPT_LANGUAGE_TARGET_MISMATCH", input);
  if (evidence.scope !== "NARROW" || evidence.requested_action !== "ANALYZE_TYPESCRIPT_LANGUAGE") return result("DENY", "NARROW_SCOPE_REQUIRED", "TYPESCRIPT_LANGUAGE_SCOPE_INVALID", input);
  if (evidence.applicability_status !== "EXTERNAL_TYPED" || evidence.applicability_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_APPLICABILITY_INCOMPLETE", input);
  const runtime = evidence.runtime_context; if (runtime.language !== evidence.language || runtime.version !== evidence.language_version || runtime.target !== evidence.compiler_options.target || runtime.module !== evidence.compiler_options.module || runtime.module_resolution !== evidence.compiler_options.module_resolution) return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_RUNTIME_CONTEXT_INVALID", input);
  if (evidence.compiler_evidence.status !== "BOUNDED" || evidence.compiler_evidence.emit_status !== "ANALYSIS_ONLY" || evidence.type_system_evidence.check_status !== "EVIDENCED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "TYPESCRIPT_LANGUAGE_COMPILER_EVIDENCE_INCOMPLETE", input);
  if (evidence.emission_evidence.no_emit !== true || evidence.emission_evidence.output_status !== "NOT_REQUESTED") return result("DENY", "NO_TYPESCRIPT_LANGUAGE_SIDE_EFFECT", "TYPESCRIPT_LANGUAGE_EMISSION_FORBIDDEN", input);
  return result("ROUTE", "TYPESCRIPT_LANGUAGE_SPECIALIST_HANDOFF", "TYPESCRIPT_LANGUAGE_ROUTE_READY", input, {routing_allowed: true, selected_specialist: TYPESCRIPT_LANGUAGE_SPECIALIST, handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Analyze only the supplied bounded TypeScript 5.9 language/compiler evidence; do not emit artifacts, mutate toolchains, write projects, or certify code.", execution_instruction: false}});
}

export const evaluateTypeScriptLanguage = evaluateTypeScriptLanguageBoundary;
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(evaluateTypeScriptLanguageBoundary(JSON.parse(process.argv[2] ?? "null")), null, 2)}\n`);
