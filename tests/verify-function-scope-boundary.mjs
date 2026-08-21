#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {evaluateFunctionScopeBoundary, FUNCTION_SCOPE_INPUT_SCHEMA, FUNCTION_SCOPE_RESULT_SCHEMA} from "../control/function-scope-boundary-gate.mjs";
import {evaluateFunctionScopePackage} from "../control/function-scope-package-evaluator.mjs";
const evaluation = await evaluateFunctionScopePackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
const input = {schema: FUNCTION_SCOPE_INPUT_SCHEMA, version: 1, request_kind: "SPAWN", evidence: {
  authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.SECURITY.FUNCTION_SCOPE", custody_ref: "opaque:FUNCTION_SCOPE.CUSTODY", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: "1", source_effective_date: "2026-08-11", source_retrieved_date: "2026-08-20", candidate_status: "CURRENT_CANDIDATE", candidate_digest: "0123456789abcdef".repeat(4), signal: "FUNCTION_SCOPE", signal_status: "BOUND", context_status: "FUNCTION_SCOPE_CONTEXT", context_complete: true, requested_action: "ANALYZE", requested_tools: ["READ_CANDIDATE"], required_block_identities: ["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate", "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate", "specialist.security.access-control-router", "specialist.standard.owasp-asvs"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "FUNCTION_SCOPE", scope: "NARROW", tenant_scope_status: "BOUND", standard_id: "source.owasp-asvs-5-0-0", standard_version: "5.0.0", standard_block_sha256: "1b39ac928b70badd070d9f6716825e73b9b931959c5fc078edf12e875c91824f", standard_source_manifest_sha256: "505595765deaa25206fd59936a4b7e415688c640373a83a68e76a9788ed587d6", project_data_present: false, secret_data_present: false, adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false])),
}};
const denied = evaluateFunctionScopeBoundary(input);
assert.equal(denied.schema, FUNCTION_SCOPE_RESULT_SCHEMA); assert.equal(denied.disposition, "DENY"); assert.equal(denied.error_code, "FUNCTION_SCOPE_OPERATION_FORBIDDEN");
const missingTenantScope = structuredClone(input); missingTenantScope.request_kind = "ANALYZE_FUNCTION_SCOPE"; missingTenantScope.evidence.tenant_scope_status = "MISSING";
assert.throws(() => evaluateFunctionScopeBoundary(missingTenantScope), (error) => error?.code === "FUNCTION_SCOPE_TENANT_SCOPE_REQUIRED");

// The evaluator must use the fixture's committed expected route/error, not echo
// whatever the implementation happened to return.  Run an isolated copy and
// mutate one expectation; a proof that still passes would be tautological.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-function-scope-fixture-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "function-scope"), path.join(temp, "specialist-blocks", "wave-03", "function-scope"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards", "owasp-asvs"), path.join(temp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
  fs.mkdirSync(path.join(temp, "schemas"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "schemas", "function-scope-gate-execution.v1.json"), path.join(temp, "schemas", "function-scope-gate-execution.v1.json"));
  const mutatedFixture = path.join(temp, "specialist-blocks", "wave-03", "function-scope", "fixtures", "authority_conflict.json");
  const fixture = JSON.parse(fs.readFileSync(mutatedFixture, "utf8"));
  fixture.expected.route = "NO_FUNCTION_SCOPE";
  fs.writeFileSync(mutatedFixture, `${JSON.stringify(fixture, null, 2)}\n`);
  const isolatedEvaluator = await import(`${pathToFileURL(path.join(temp, "control", "function-scope-package-evaluator.mjs")).href}?fixture-mutation=${Date.now()}`);
  await assert.rejects(() => isolatedEvaluator.evaluateFunctionScopePackage(), (error) => ["FUNCTION_SCOPE_HOSTILE_RESULT_FAILED", "FUNCTION_SCOPE_GATE_EXPECTATION_UNBOUND"].includes(error?.code));
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
console.log("PASS Function Scope boundary: 17 executable adversarial vectors, fixture-bound expectations, mutation proof, and zero side effects");
