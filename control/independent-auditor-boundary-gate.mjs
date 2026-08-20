#!/usr/bin/env node

/* Read-only Independent Auditor boundary. It may inspect and recheck exact
 * candidate evidence, but it never repairs, accepts, activates, or mutates it. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const INDEPENDENT_AUDITOR_INPUT_SCHEMA = "agentos.independent_auditor_boundary_input.v1";
export const INDEPENDENT_AUDITOR_RESULT_SCHEMA = "agentos.independent_auditor_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{1,160}$/u;
const REQUESTS = new Set(["EVALUATE_CANDIDATE", "RECHECK_EARLIER_PACKAGES", "NOT_APPLICABLE", "UNRELATED_REQUEST", "REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "SPAWN", "DESPAWN"]);
const FORBIDDEN = new Set(["REPAIR", "ACCEPT", "ADMIT", "ACTIVATE", "MERGE", "PUSH", "DEPLOY", "PUBLISH", "WRITE_PROJECT", "WRITE_MEMORY", "SELF_REVIEW", "SPAWN", "DESPAWN"]);
const ALLOWED_ACTIONS = new Set(["INSPECT", "ISSUE_RECEIPT", "RECHECK_EARLIER"]);
const ALLOWED_TOOLS = new Set(["READ_CANDIDATE", "READ_GATES", "READ_FIXTURES", "READ_SOURCE_LOCK", "READ_MODEL_POLICY", "READ_CUSTODY"]);
const REQUIRED_BLOCKS = new Set(["SPECIALIST.FOUNDATION.EVALUATION_ADMISSION_GATE", "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE"]);

function fail(message, code = "INDEPENDENT_AUDITOR_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`, "INDEPENDENT_AUDITOR_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), `${name} contains unknown field ${key}`, "INDEPENDENT_AUDITOR_UNKNOWN_FIELD"); }
function bounded(value, name, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${name} must be bounded`, "INDEPENDENT_AUDITOR_FIELD_INVALID"); }
function id(value, name) { bounded(value, name); assert(ID.test(value), `${name} is not canonical`, "INDEPENDENT_AUDITOR_ID_INVALID"); }
function ref(value, name) { bounded(value, name, 180); assert(OPAQUE_REF.test(value), `${name} is not opaque`, "INDEPENDENT_AUDITOR_REF_INVALID"); }
function digest(value, name) { bounded(value, name, 64); assert(SHA256.test(value), `${name} is not SHA-256`, "INDEPENDENT_AUDITOR_DIGEST_INVALID"); assert(!/^([0-9a-f])\1{63}$/u.test(value), `${name} is placeholder-like`, "INDEPENDENT_AUDITOR_DIGEST_PLACEHOLDER"); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: INDEPENDENT_AUDITOR_RESULT_SCHEMA, version: 1, disposition, route, error_code: errorCode, receipt_authority: false, mutation_allowed: false, acceptance_allowed: false, external_side_effects: {candidate_writes: 0, acceptance_calls: 0, activation_calls: 0, repair_calls: 0, project_writes: 0, memory_writes: 0, credential_accesses: 0, state_changes: 0}, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }

function validateInput(input) {
  exactKeys(input, new Set(["schema", "version", "request_kind", "review"]), "independent auditor input");
  assert(input.schema === INDEPENDENT_AUDITOR_INPUT_SCHEMA && input.version === 1, "independent auditor schema mismatch", "INDEPENDENT_AUDITOR_SCHEMA_MISMATCH");
  assert(typeof input.request_kind === "string" && REQUESTS.has(input.request_kind), "independent auditor request is not recognized", "INDEPENDENT_AUDITOR_REQUEST_INVALID");
  exactKeys(input.review, new Set(["candidate_ref", "candidate_digest", "candidate_status", "package_scope", "author_identity", "evaluator_identity", "evaluator_status", "independence_status", "gate_status", "fixture_status", "source_status", "custody_status", "model_policy_status", "requested_action", "requested_tools", "required_blocks", "earlier_packages_status", "new_findings", "recheck_scope", "project_data_present", "secret_data_present", "adversarial_flags"]), "independent auditor review");
  const r = input.review;
  for (const key of ["candidate_ref"]) ref(r[key], `review.${key}`);
  for (const key of ["candidate_status", "package_scope", "author_identity", "evaluator_identity", "evaluator_status", "independence_status", "gate_status", "fixture_status", "source_status", "custody_status", "model_policy_status", "requested_action", "earlier_packages_status", "recheck_scope"]) bounded(r[key], `review.${key}`);
  digest(r.candidate_digest, "review.candidate_digest");
  for (const key of ["author_identity", "evaluator_identity"]) id(r[key], `review.${key}`);
  assert(Array.isArray(r.requested_tools) && r.requested_tools.length > 0 && r.requested_tools.length <= 8, "review.requested_tools is invalid", "INDEPENDENT_AUDITOR_TOOL_SCOPE_INVALID");
  for (const tool of r.requested_tools) { bounded(tool, "review.requested_tools[]", 80); assert(ALLOWED_TOOLS.has(tool), `unsupported tool ${tool}`, "INDEPENDENT_AUDITOR_TOOL_SCOPE_INVALID"); }
  assert(Array.isArray(r.required_blocks) && r.required_blocks.length === 2 && new Set(r.required_blocks).size === 2, "review.required_blocks is incomplete", "INDEPENDENT_AUDITOR_BLOCK_BINDING_INVALID");
  for (const block of r.required_blocks) { bounded(block, "review.required_blocks[]", 120); assert(REQUIRED_BLOCKS.has(block), `unexpected required block ${block}`, "INDEPENDENT_AUDITOR_BLOCK_BINDING_INVALID"); }
  for (const key of ["new_findings", "project_data_present", "secret_data_present"]) assert(typeof r[key] === "boolean", `review.${key} must be boolean`, "INDEPENDENT_AUDITOR_BOOLEAN_INVALID");
  exactKeys(r.adversarial_flags, new Set(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"]), "review.adversarial_flags");
  for (const key of ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"]) assert(typeof r.adversarial_flags[key] === "boolean", `review.adversarial_flags.${key} must be boolean`, "INDEPENDENT_AUDITOR_BOOLEAN_INVALID");
  assert(scanPersistedRecord(input).safe, "independent auditor input contains protected or secret-like data", "INDEPENDENT_AUDITOR_PRIVACY_DENIED");
}

function missing(review) { return ["candidate_ref", "candidate_digest", "candidate_status", "package_scope", "author_identity", "evaluator_identity", "evaluator_status", "independence_status", "gate_status", "fixture_status", "source_status", "custody_status", "model_policy_status", "requested_action", "requested_tools", "required_blocks", "earlier_packages_status", "recheck_scope", "adversarial_flags"].filter((key) => review[key] === undefined || review[key] === null || review[key] === "" || (Array.isArray(review[key]) && review[key].length === 0)); }

export function evaluateIndependentAuditorBoundary(input) {
  validateInput(input);
  const r = input.review;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST") return result("DENY", "NO_AUDIT_SCOPE", "INDEPENDENT_AUDITOR_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind)) return result("DENY", "NO_AUDITOR_SIDE_EFFECT", "INDEPENDENT_AUDITOR_OPERATION_FORBIDDEN", input);
  const absent = missing(r); if (absent.length) return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDEPENDENT_AUDITOR_CONTEXT_INCOMPLETE", input, {missing_fields: absent});
  const flags = r.adversarial_flags;
  if (flags.unrelated_scope) return result("DENY", "NO_AUDIT_SCOPE", "INDEPENDENT_AUDITOR_SCOPE_NOT_APPLICABLE", input);
  if (flags.authority_conflict) return result("DENY", "CONTROLLER_ESCALATION", "INDEPENDENT_AUDITOR_AUTHORITY_CONFLICT", input);
  if (flags.missing_context) return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDEPENDENT_AUDITOR_CONTEXT_INCOMPLETE", input);
  if (flags.protected_data || r.project_data_present || r.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "INDEPENDENT_AUDITOR_PROTECTED_DATA_FORBIDDEN", input);
  if (flags.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "INDEPENDENT_AUDITOR_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (flags.scope_expanded || flags.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "INDEPENDENT_AUDITOR_SCOPE_EXPANSION_FORBIDDEN", input);
  if (flags.duplicate_authority) return result("DENY", "SINGLE_AUTHORITY_REQUIRED", "INDEPENDENT_AUDITOR_DUPLICATE_AUTHORITY", input);
  if (flags.cross_provider || flags.stale_source) return result("DENY", "REFRESH_REQUIRED", "INDEPENDENT_AUDITOR_SOURCE_STALE_OR_UNVERIFIED", input);
  if (flags.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "INDEPENDENT_AUDITOR_TOOL_SCOPE_FORBIDDEN", input);
  if (flags.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "INDEPENDENT_AUDITOR_FINDING_UNSUPPORTED", input);
  if (flags.unsafe_action) return result("DENY", "NO_AUDITOR_SIDE_EFFECT", "INDEPENDENT_AUDITOR_OPERATION_FORBIDDEN", input);
  if (r.evaluator_identity === r.author_identity || r.independence_status !== "SEPARATE_CONTROLLED_IDENTITIES") return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "INDEPENDENT_AUDITOR_INDEPENDENCE_INVALID", input);
  if (r.evaluator_status !== "ADMITTED_CURRENT" || r.custody_status !== "BOUND") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "INDEPENDENT_AUDITOR_EVALUATOR_UNAVAILABLE", input);
  if (r.candidate_status !== "CURRENT_CANDIDATE" || r.package_scope !== "ONE_EXACT_CANDIDATE" || r.gate_status !== "COMPLETE_EXECUTABLE" || r.fixture_status !== "COMPLETE_EXECUTABLE") return result("DENY", "CANDIDATE_REFRESH_REQUIRED", "INDEPENDENT_AUDITOR_CANDIDATE_NOT_REVIEWABLE", input);
  if (r.source_status !== "CURRENT_VERIFIED" || r.model_policy_status !== "CURRENT_BOUND") return result("DENY", "REFRESH_REQUIRED", "INDEPENDENT_AUDITOR_EVIDENCE_STALE", input);
  if (!ALLOWED_ACTIONS.has(r.requested_action)) return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDEPENDENT_AUDITOR_ACTION_INVALID", input);
  if (input.request_kind === "RECHECK_EARLIER_PACKAGES" || r.requested_action === "RECHECK_EARLIER") {
    if (r.new_findings !== true || r.earlier_packages_status !== "RECHECK_REQUIRED" || r.recheck_scope !== "ALL_EARLIER_NON_ARCHIVED") return result("DENY", "TYPED_CONTEXT_REQUIRED", "INDEPENDENT_AUDITOR_RECHECK_CONTEXT_INVALID", input);
    return result("ROUTE", "EARLIER_PACKAGE_RECHECK", "INDEPENDENT_AUDITOR_RECHECK_REQUIRED", input, {selected_owner: "AGENTOS.SPAWNER", recheck: {policy: "ALL_EARLIER_NON_ARCHIVED_PACKAGES", receipt_authority: false}});
  }
  if (r.new_findings === true && r.earlier_packages_status !== "RECHECK_REQUIRED") return result("DENY", "EARLIER_PACKAGE_RECHECK", "INDEPENDENT_AUDITOR_RECHECK_REQUIRED", input, {selected_owner: "AGENTOS.SPAWNER"});
  return result("ROUTE", "EVALUATION_RECEIPT_TO_SPAWNER", "INDEPENDENT_AUDITOR_EVALUATION_READY", input, {selected_owner: "AGENTOS.SPAWNER", receipt: {status: "TYPED_EVALUATION_ONLY", admission_allowed: false, activation_allowed: false}});
}
