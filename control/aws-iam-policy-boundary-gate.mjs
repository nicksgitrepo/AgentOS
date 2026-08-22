#!/usr/bin/env node

/* Read-only AWS IAM Policy Elements boundary.  It emits a typed analysis
 * handoff only; it cannot mutate a policy, issue credentials, write memory,
 * accept a candidate, or change provider/project state. */

import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {assertAwsIamPolicyCanonicalEvidence, resolveAwsIamPolicyCanonicalAuthority} from "./aws-iam-policy-authority-binding.mjs";

export const AWS_IAM_POLICY_INPUT_SCHEMA = "agentos.aws_iam_policy_boundary_input.v1";
export const AWS_IAM_POLICY_RESULT_SCHEMA = "agentos.aws_iam_policy_boundary_result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque|ref):[A-Z0-9._:/-]{1,180}$/u;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{1,160}$/u;
const REQUESTS = new Set([
  "ANALYZE_AWS_IAM_POLICY", "ROUTE_AWS_IAM_POLICY", "NOT_APPLICABLE", "UNRELATED_REQUEST",
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "MUTATE_POLICY", "ISSUE_CREDENTIAL",
]);
const FORBIDDEN = new Set([
  "SPAWN", "ADMIT", "ACTIVATE", "ARCHIVE", "DESPAWN", "DEPLOY", "PUBLISH", "WRITE_PROJECT",
  "WRITE_MEMORY", "ACCEPT", "SELF_REVIEW", "MUTATE_POLICY", "ISSUE_CREDENTIAL",
]);
const TOOLS = new Set(["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT"]);
const FLAGS = [
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive",
];
const REQUIRED_BLOCKS = [
  "specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate", "specialist.platform.provider-edge-router",
  "specialist.standard.aws-iam-current",
];
const EVIDENCE_KEYS = new Set([
  "authority_status", "custody_status", "custody_owner", "custody_ref", "provider_identity", "provider_version",
  "policy_identity", "policy_scope", "policy_status", "source_status", "source_identity", "source_version",
  "source_effective_date", "source_retrieved_date", "candidate_status", "candidate_digest", "signal", "signal_status",
  "context_status", "context_complete", "requested_action", "requested_tools", "required_block_identities",
  "model_policy_status", "model_route_status", "authority_scope", "scope", "standard_id", "standard_version",
  "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256", "model_task_class",
  "model_capability_floor", "model_required_capabilities", "model_route_sha256", "context_receipt_sha256",
  "upstream_router_result_sha256", "project_data_present", "secret_data_present", "policy_mutation_requested",
  "credential_issue_requested", "adversarial_flags",
]);
const SIDE_EFFECT_KEYS = Object.freeze([
  "candidate_reads", "source_reads", "protected_data_reads", "policy_mutations", "project_writes",
  "memory_writes", "credential_accesses", "state_changes",
]);

function fail(message, code = "AWS_IAM_POLICY_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "AWS_IAM_POLICY_SHAPE_INVALID");
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`, "AWS_IAM_POLICY_UNKNOWN_FIELD");
}
function string(value, label, max = 240) { assert(typeof value === "string" && value.length > 0 && value.length <= max, `${label} is invalid`, "AWS_IAM_POLICY_FIELD_INVALID"); }
function id(value, label) { string(value, label); assert(ID.test(value), `${label} is not canonical`, "AWS_IAM_POLICY_ID_INVALID"); }
function digest(value, label) { string(value, label, 64); assert(SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real digest`, "AWS_IAM_POLICY_DIGEST_INVALID"); }

function result(disposition, route, errorCode, input, extra = {}) {
  const base = {
    schema: AWS_IAM_POLICY_RESULT_SCHEMA, version: 1, disposition, route, analysis_allowed: false, routing_allowed: false,
    acceptance_allowed: false, policy_mutation_allowed: false, credential_issue_allowed: false, memory_write_allowed: false,
    external_side_effects: Object.fromEntries(SIDE_EFFECT_KEYS.map((key) => [key, 0])), error_code: errorCode,
    input_sha256: canonicalDigest(input), ...extra,
  };
  return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})});
}
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "evidence"]), "AWS IAM Policy input");
  assert(input.schema === AWS_IAM_POLICY_INPUT_SCHEMA && input.version === 1, "AWS IAM Policy schema mismatch", "AWS_IAM_POLICY_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "AWS IAM Policy request is unknown", "AWS_IAM_POLICY_REQUEST_INVALID");
  exact(input.evidence, EVIDENCE_KEYS, "AWS IAM Policy evidence");
  const e = input.evidence;
  for (const key of [
    "authority_status", "custody_status", "provider_identity", "provider_version", "policy_identity", "policy_scope", "policy_status",
    "source_status", "source_identity", "source_version", "source_effective_date", "source_retrieved_date", "candidate_status",
    "signal", "signal_status", "context_status", "requested_action", "model_policy_status", "model_route_status", "authority_scope",
    "scope", "standard_id", "standard_version",
  ]) string(e[key], `evidence.${key}`);
  id(e.custody_owner, "evidence.custody_owner");
  assert(OPAQUE_REF.test(e.custody_ref), "custody reference is not opaque", "AWS_IAM_POLICY_CUSTODY_REF_INVALID");
  for (const key of ["candidate_digest", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256", "context_receipt_sha256", "upstream_router_result_sha256"]) digest(e[key], `evidence.${key}`);
  assert(e.standard_id === "source.aws-iam-policy-elements" && e.standard_version === "current", "standard identity is not canonical", "AWS_IAM_POLICY_STANDARD_BINDING_INVALID");
  assert(Number.isSafeInteger(e.model_capability_floor) && e.model_capability_floor >= 0, "model capability floor is invalid", "AWS_IAM_POLICY_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.model_required_capabilities) && e.model_required_capabilities.length > 0 && e.model_required_capabilities.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)), "model capabilities are invalid", "AWS_IAM_POLICY_MODEL_ROUTE_UNBOUND");
  assert(Array.isArray(e.requested_tools) && e.requested_tools.length > 0 && e.requested_tools.length <= 3 && e.requested_tools.every((tool) => TOOLS.has(tool)), "requested tools are invalid", "AWS_IAM_POLICY_TOOL_SCOPE_INVALID");
  assert(Array.isArray(e.required_block_identities) && e.required_block_identities.length === REQUIRED_BLOCKS.length && e.required_block_identities.every((value, index) => value === REQUIRED_BLOCKS[index]), "required block identities are incomplete", "AWS_IAM_POLICY_BLOCK_BINDING_INVALID");
  for (const value of e.required_block_identities) id(value, "required_block_identities[]");
  for (const key of ["context_complete", "project_data_present", "secret_data_present", "policy_mutation_requested", "credential_issue_requested"]) assert(typeof e[key] === "boolean", `evidence.${key} must be boolean`, "AWS_IAM_POLICY_BOOLEAN_INVALID");
  exact(e.adversarial_flags, new Set(FLAGS), "AWS IAM Policy adversarial flags");
  FLAGS.forEach((flag) => assert(typeof e.adversarial_flags[flag] === "boolean", `${flag} must be boolean`, "AWS_IAM_POLICY_BOOLEAN_INVALID"));
  assert(scanPersistedRecord(input).safe, "AWS IAM Policy input contains protected data", "AWS_IAM_POLICY_PRIVACY_DENIED");
  assertAwsIamPolicyCanonicalEvidence(e, resolveAwsIamPolicyCanonicalAuthority());
}

export function evaluateAwsIamPolicyBoundary(input) {
  validate(input);
  const e = input.evidence; const f = e.adversarial_flags;
  if (input.request_kind === "NOT_APPLICABLE" || input.request_kind === "UNRELATED_REQUEST" || f.unrelated_scope) return result("DENY", "NO_AWS_IAM_POLICY_SCOPE", "AWS_IAM_POLICY_SCOPE_NOT_APPLICABLE", input);
  if (FORBIDDEN.has(input.request_kind) || e.policy_mutation_requested || e.credential_issue_requested) return result("DENY", "NO_AWS_IAM_POLICY_SIDE_EFFECT", "AWS_IAM_POLICY_OPERATION_FORBIDDEN", input);
  if (f.authority_conflict || f.duplicate_authority) return result("ESCALATE", "CONTROL_PLANE_ESCALATION", "AWS_IAM_POLICY_AUTHORITY_CONFLICT", input);
  if (f.missing_context || e.context_complete !== true) return result("DENY", "TYPED_CONTEXT_REQUIRED", "AWS_IAM_POLICY_CONTEXT_INCOMPLETE", input);
  if (f.protected_data || e.project_data_present || e.secret_data_present) return result("DENY", "PRIVACY_BOUNDARY_REQUIRED", "AWS_IAM_POLICY_PROTECTED_DATA_FORBIDDEN", input);
  if (f.self_acceptance) return result("DENY", "INDEPENDENT_REVIEW_REQUIRED", "AWS_IAM_POLICY_SELF_ACCEPTANCE_FORBIDDEN", input);
  if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "AWS_IAM_POLICY_SCOPE_EXPANSION_FORBIDDEN", input);
  if (f.cross_provider || f.stale_source || e.source_status !== "CURRENT_VERIFIED") return result("DENY", "SOURCE_REFRESH_REQUIRED", "AWS_IAM_POLICY_SOURCE_STALE_OR_UNVERIFIED", input);
  if (f.unsupported_tool) return result("DENY", "READ_ONLY_TOOLS_REQUIRED", "AWS_IAM_POLICY_TOOL_SCOPE_FORBIDDEN", input);
  if (f.false_positive) return result("DENY", "TYPED_EVIDENCE_REQUIRED", "AWS_IAM_POLICY_FINDING_UNSUPPORTED", input);
  if (f.unsafe_action) return result("DENY", "NO_AWS_IAM_POLICY_SIDE_EFFECT", "AWS_IAM_POLICY_OPERATION_FORBIDDEN", input);
  if (e.authority_status !== "CURRENT" || e.custody_status !== "BOUND" || e.custody_owner !== "AGENT.PLATFORM_AWS_IAM_POLICY") return result("DENY", "AUTHORITY_REFRESH_REQUIRED", "AWS_IAM_POLICY_AUTHORITY_UNVERIFIED", input);
  if (e.source_identity !== "SOURCE.ATOMIC_SPECIALIZATION_LAW" || e.source_version !== "1") return result("DENY", "SOURCE_REFRESH_REQUIRED", "AWS_IAM_POLICY_SOURCE_IDENTITY_INVALID", input);
  if (e.candidate_status !== "CURRENT_CANDIDATE") return result("DENY", "CANDIDATE_REFRESH_REQUIRED", "AWS_IAM_POLICY_CANDIDATE_BINDING_INVALID", input);
  if (e.provider_identity !== "AWS" || e.provider_version !== "CURRENT" || e.policy_identity !== "IAM_POLICY_ELEMENTS" || e.policy_status !== "BOUND" || e.policy_scope !== "IAM_POLICY_ELEMENTS") return result("DENY", "TYPED_CONTEXT_REQUIRED", "AWS_IAM_POLICY_CONTEXT_BINDING_INVALID", input);
  if (e.signal !== "CLOUD.AWS_IAM" || e.signal_status !== "BOUND" || e.context_status !== "AWS_IAM_POLICY_CONTEXT") return result("DENY", "TYPED_CONTEXT_REQUIRED", "AWS_IAM_POLICY_CONTEXT_BINDING_INVALID", input);
  if (e.model_route_status !== "BOUND") return result("DENY", "MODEL_POLICY_REFRESH_REQUIRED", "AWS_IAM_POLICY_MODEL_ROUTE_UNBOUND", input);
  if (e.requested_action !== "ANALYZE" && e.requested_action !== "ROUTE") return result("DENY", "TYPED_CONTEXT_REQUIRED", "AWS_IAM_POLICY_ACTION_INVALID", input);
  return result("ROUTE", "AWS_IAM_POLICY_ANALYSIS_HANDOFF", "AWS_IAM_POLICY_ROUTE_READY", input, {
    analysis_allowed: true, routing_allowed: true, selected_specialist: "specialist.platform.aws-iam-policy",
    handoff: {status: "WAITING_WITH_RECEIPT", next_action: "Run only the named AWS IAM Policy Elements analysis, then return a typed finding or NOT_APPLICABLE_WITH_EVIDENCE; do not mutate policy, issue credentials, decide access, or accept the candidate.", execution_instruction: false},
  });
}
