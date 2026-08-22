#!/usr/bin/env node

/* Read-only executable boundary for specialist.control.intent-regulator. */

import {canonicalDigest} from "./content-addressing.mjs";
import {
  INTENT_REGULATOR_BLOCK_ID,
  INTENT_REGULATOR_CUSTODY_REF,
  INTENT_REGULATOR_FLAG_KEYS,
  INTENT_REGULATOR_REQUIRED_BLOCKS,
  resolveIntentRegulatorCanonicalAuthority,
  assertIntentRegulatorCanonicalEvidence,
} from "./intent-regulator-authority-binding.mjs";

export const INTENT_REGULATOR_INPUT_SCHEMA = "agentos.intent_regulator_boundary_input.v1";
export const INTENT_REGULATOR_RESULT_SCHEMA = "agentos.intent_regulator_boundary_result.v1";

const EXTERNAL_SIDE_EFFECT_KEYS = Object.freeze([
  "typed_intent_reads", "runtime_state_reads", "source_reads", "context_reads", "route_reads",
  "intent_preservation_writes", "product_writes", "memory_writes", "acceptance_calls",
  "activation_calls", "deployment_calls", "credential_accesses", "state_changes",
]);
const EVIDENCE_KEYS = Object.freeze([
  "authority_status", "owner_role", "owner_identity", "owner_intent_status", "owner_intent_digest", "intent_provenance_status",
  "source_status", "source_identity", "source_version", "source_manifest_sha256", "source_lock_sha256",
  "candidate_status", "candidate_digest", "signal", "signal_status", "task_status", "context_status", "context_complete",
  "requested_action", "requested_tools", "required_block_identities", "model_policy_status", "model_route_status", "model",
  "reasoning_effort", "model_route_sha256", "context_receipt_sha256", "route_receipt_sha256", "custody_status", "custody_owner",
  "custody_ref", "authority_scope", "scope", "project_data_present", "secret_data_present", "adversarial_flags",
]);
const ALLOWED_ACTIONS = Object.freeze(["PRESERVE_TYPED_INTENT", "ROUTE_AUTHORITY_QUESTION", "ROUTE_RUNTIME_DECISION"]);

function fail(message, code = "INTENT_REGULATOR_BOUNDARY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function zeroSideEffects() { return Object.fromEntries(EXTERNAL_SIDE_EFFECT_KEYS.map((key) => [key, 0])); }
function boolFlags(evidence) {
  const flags = evidence?.adversarial_flags;
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return Object.fromEntries(INTENT_REGULATOR_FLAG_KEYS.map((key) => [key, false]));
  return Object.fromEntries(INTENT_REGULATOR_FLAG_KEYS.map((key) => [key, flags[key] === true]));
}
function baseResult(input, disposition, route, errorCode, extra = {}) {
  const result = {
    schema: INTENT_REGULATOR_RESULT_SCHEMA,
    version: 1,
    disposition,
    route,
    intent_preservation_allowed: disposition === "ROUTE" || disposition === "ESCALATE",
    routing_allowed: disposition === "ROUTE" || disposition === "ESCALATE",
    owner_authority_decision_allowed: false,
    acceptance_allowed: false,
    activation_allowed: false,
    product_mutation_allowed: false,
    memory_write_allowed: false,
    external_side_effects: zeroSideEffects(),
    error_code: errorCode,
    input_sha256: canonicalDigest(input),
    ...extra,
  };
  result.result_sha256 = canonicalDigest({...result, result_sha256: null});
  return Object.freeze(result);
}
function routeResult(input, route, errorCode, target, nextAction) {
  return baseResult(input, "ROUTE", route, errorCode, {
    selected_route_target: target,
    handoff: {status: "WAITING_WITH_RECEIPT", next_action: nextAction, execution_instruction: false, rollback_receipt_required: true},
  });
}
function escalateResult(input) {
  return baseResult(input, "ESCALATE", "OWNER_AUTHORITY_REVIEW", "INTENT_REGULATOR_AUTHORITY_CONFLICT", {
    selected_route_target: "AGENTOS_CONTROLLER",
    handoff: {status: "ESCALATE_WITH_RECEIPT", next_action: "Preserve the exact typed intent record and route only the conflicting authority question to AGENTOS_CONTROLLER.", execution_instruction: false, rollback_receipt_required: true},
  });
}

function evidenceShape(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  return EVIDENCE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(evidence, key));
}
function denyForInvalidContext(input, code = "INTENT_REGULATOR_CONTEXT_BINDING_INVALID") {
  return baseResult(input, "DENY", "NO_ROUTE", code);
}

export function evaluateIntentRegulatorBoundary(input, {authority = resolveIntentRegulatorCanonicalAuthority()} = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return denyForInvalidContext(input ?? null, "INTENT_REGULATOR_INPUT_INVALID");
  if (input.schema !== INTENT_REGULATOR_INPUT_SCHEMA || input.version !== 1 || !evidenceShape(input.evidence)) return denyForInvalidContext(input, "INTENT_REGULATOR_TYPED_CONTEXT_REQUIRED");
  const evidence = input.evidence;
  const flags = boolFlags(evidence);
  if (flags.authority_conflict || flags.duplicate_authority) return escalateResult(input);
  if (flags.protected_data || flags.unsafe_action || flags.self_acceptance || flags.acceptance_requested || flags.activation_requested || flags.product_write_requested || flags.memory_write_requested) return baseResult(input, "DENY", "NO_ROUTE", flags.protected_data ? "INTENT_REGULATOR_PROTECTED_DATA_FORBIDDEN" : flags.self_acceptance || flags.acceptance_requested ? "INTENT_REGULATOR_SELF_ACCEPTANCE_FORBIDDEN" : "INTENT_REGULATOR_SIDE_EFFECT_FORBIDDEN");
  if (flags.missing_context || flags.unknown_owner || flags.owner_chat_only || flags.false_positive) return baseResult(input, "DENY", "NO_ROUTE", "INTENT_REGULATOR_TYPED_CONTEXT_REQUIRED");
  if (flags.stale_source || flags.cross_provider) return baseResult(input, "DENY", "NO_ROUTE", "INTENT_REGULATOR_SOURCE_REFRESH_REQUIRED");
  if (flags.unsupported_tool || flags.tool_limit) return baseResult(input, "DENY", "NO_ROUTE", "INTENT_REGULATOR_TOOL_SCOPE_FORBIDDEN");
  if (flags.scope_expanded || flags.broad_claim || flags.unrelated_scope) return baseResult(input, "DENY", "NO_ROUTE", "INTENT_REGULATOR_SCOPE_EXPANSION_FORBIDDEN");
  try { assertIntentRegulatorCanonicalEvidence(evidence, authority); } catch (error) { return denyForInvalidContext(input, error.code ?? "INTENT_REGULATOR_CONTEXT_BINDING_INVALID"); }
  assert(evidence.custody_ref === INTENT_REGULATOR_CUSTODY_REF, "Intent-regulator custody reference changed", "INTENT_REGULATOR_CUSTODY_INVALID");
  assert(JSON.stringify(evidence.required_block_identities) === JSON.stringify(INTENT_REGULATOR_REQUIRED_BLOCKS), "Intent-regulator dependencies changed", "INTENT_REGULATOR_DEPENDENCY_INVALID");
  if (!ALLOWED_ACTIONS.includes(evidence.requested_action)) return baseResult(input, "DENY", "NO_ROUTE", "INTENT_REGULATOR_ACTION_FORBIDDEN");
  if (evidence.requested_action === "ROUTE_AUTHORITY_QUESTION") return routeResult(input, "OWNER_AUTHORITY_REVIEW", "INTENT_REGULATOR_AUTHORITY_QUESTION_ROUTED", "AGENTOS_CONTROLLER", "Review the typed authority question; do not execute, admit, activate, deploy, or write Product.");
  if (evidence.requested_action === "ROUTE_RUNTIME_DECISION") return routeResult(input, "PERSISTENT_RUNTIME_ROUTE", "INTENT_REGULATOR_RUNTIME_ROUTE_READY", "RUNTIME", "Compile the typed runtime route through persistent-intent-runtime-integration; Runtime retains durable-state custody.");
  return routeResult(input, "INTENT_PRESERVATION_HANDOFF", "INTENT_REGULATOR_TYPED_INTENT_READY", "RUNTIME", "Preserve the exact typed owner-intent record and provenance; return a typed receipt without executing the requested work.");
}

export {EVIDENCE_KEYS as INTENT_REGULATOR_EVIDENCE_KEYS, EXTERNAL_SIDE_EFFECT_KEYS as INTENT_REGULATOR_SIDE_EFFECT_KEYS};

if (process.argv[1] && process.argv[1].endsWith("intent-regulator-boundary-gate.mjs")) {
  process.stdout.write("Intent-regulator boundary is an importable read-only gate.\n");
}
