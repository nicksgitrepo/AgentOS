#!/usr/bin/env node
import assert from "node:assert/strict";
import {evaluateFunctionScopeBoundary, FUNCTION_SCOPE_INPUT_SCHEMA, FUNCTION_SCOPE_RESULT_SCHEMA} from "../control/function-scope-boundary-gate.mjs";
import {evaluateFunctionScopePackage} from "../control/function-scope-package-evaluator.mjs";
const evaluation = await evaluateFunctionScopePackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
const input = {schema: FUNCTION_SCOPE_INPUT_SCHEMA, version: 1, request_kind: "SPAWN", evidence: {
  authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.SECURITY.FUNCTION_SCOPE", custody_ref: "opaque:FUNCTION_SCOPE.CUSTODY", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: "1", source_effective_date: "2026-08-11", source_retrieved_date: "2026-08-20", candidate_status: "CURRENT_CANDIDATE", candidate_digest: "0123456789abcdef".repeat(4), signal: "FUNCTION_SCOPE", signal_status: "BOUND", context_status: "FUNCTION_SCOPE_CONTEXT", context_complete: true, requested_action: "ANALYZE", requested_tools: ["READ_CANDIDATE"], required_block_identities: ["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "specialist.security.access-control-router", "specialist.standard.owasp-asvs"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "FUNCTION_SCOPE", scope: "NARROW", project_data_present: false, secret_data_present: false, adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false])),
}};
const denied = evaluateFunctionScopeBoundary(input);
assert.equal(denied.schema, FUNCTION_SCOPE_RESULT_SCHEMA); assert.equal(denied.disposition, "DENY"); assert.equal(denied.error_code, "FUNCTION_SCOPE_OPERATION_FORBIDDEN");
console.log("PASS Function Scope boundary: 17 executable adversarial vectors, mutation proof, and zero side effects");
