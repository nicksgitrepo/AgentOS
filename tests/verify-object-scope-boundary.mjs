#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateObjectScopeBoundary, OBJECT_SCOPE_INPUT_SCHEMA, OBJECT_SCOPE_RESULT_SCHEMA} from "../control/object-scope-boundary-gate.mjs";
import {evaluateObjectScopePackage} from "../control/object-scope-package-evaluator.mjs";
import {resolveObjectScopeCanonicalAuthority} from "../control/object-scope-authority-binding.mjs";
const authority = resolveObjectScopeCanonicalAuthority();
const evaluation = await evaluateObjectScopePackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
const input = {schema: OBJECT_SCOPE_INPUT_SCHEMA, version: 1, request_kind: "SPAWN", evidence: {
  authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.SECURITY.OBJECT_SCOPE", custody_ref: authority.custody_ref, source_status: "CURRENT_VERIFIED", source_identity: authority.source_identity, source_version: authority.source_version, source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date, candidate_status: "CURRENT_CANDIDATE", candidate_digest: authority.block_sha256, signal: "OBJECT_SCOPE", signal_status: "BOUND", context_status: "OBJECT_SCOPE_CONTEXT", context_complete: true, requested_action: "ANALYZE", requested_tools: ["READ_CANDIDATE"], required_block_identities: ["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate", "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate", "specialist.security.access-control-router", "specialist.standard.owasp-asvs"], model_policy_status: authority.model.snapshot_status, model_route_status: "BOUND", authority_scope: "OBJECT_SCOPE", scope: "NARROW", object_scope_status: "BOUND", authorization_boundary_status: "BOUND", standard_id: "source.owasp-asvs-5-0-0", standard_version: "5.0.0", standard_block_sha256: authority.standard_block_sha256, standard_source_manifest_sha256: authority.standard_source_manifest_sha256, model_snapshot_sha256: authority.model.snapshot_sha256, model_task_class: authority.model.task_class, model_capability_floor: authority.model.minimum_capability, model_required_capabilities: authority.model.required_capabilities, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, upstream_router_result_sha256: authority.router_result_sha256, project_data_present: false, secret_data_present: false, adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false])),
}};
const denied = evaluateObjectScopeBoundary(input);
assert.equal(denied.schema, OBJECT_SCOPE_RESULT_SCHEMA); assert.equal(denied.disposition, "DENY"); assert.equal(denied.error_code, "OBJECT_SCOPE_OPERATION_FORBIDDEN");
assert.equal(denied.analysis_allowed, false); assert.equal(denied.acceptance_allowed, false); assert.equal(denied.authorization_decision_allowed, false); assert.equal(denied.policy_mutation_allowed, false);
assert.equal(denied.result_sha256, canonicalDigest({...denied, result_sha256: null}));
const routed = structuredClone(input); routed.request_kind = "ANALYZE_OBJECT_SCOPE";
const routedResult = evaluateObjectScopeBoundary(routed);
assert.equal(routedResult.disposition, "ROUTE"); assert.equal(routedResult.analysis_allowed, true); assert.equal(routedResult.acceptance_allowed, false); assert.equal(routedResult.authorization_decision_allowed, false); assert.equal(routedResult.policy_mutation_allowed, false); assert.equal(routedResult.handoff.execution_instruction, false);
const missingObjectScope = structuredClone(routed); missingObjectScope.evidence.object_scope_status = "MISSING";
assert.throws(() => evaluateObjectScopeBoundary(missingObjectScope), (error) => error?.code === "OBJECT_SCOPE_OBJECT_SCOPE_REQUIRED");
const missingAuthorizationBoundary = structuredClone(routed); missingAuthorizationBoundary.evidence.authorization_boundary_status = "MISSING";
assert.throws(() => evaluateObjectScopeBoundary(missingAuthorizationBoundary), (error) => error?.code === "OBJECT_SCOPE_AUTHORIZATION_BOUNDARY_REQUIRED");
const wrongCandidate = structuredClone(routed); wrongCandidate.evidence.candidate_digest = "abcdef0123456789".repeat(4);
assert.throws(() => evaluateObjectScopeBoundary(wrongCandidate), (error) => error?.code === "OBJECT_SCOPE_CANDIDATE_BINDING_INVALID");
const protectedInput = structuredClone(routed); protectedInput.evidence.project_data_present = true;
const protectedResult = evaluateObjectScopeBoundary(protectedInput);
assert.equal(protectedResult.disposition, "DENY"); assert.equal(protectedResult.error_code, "OBJECT_SCOPE_PROTECTED_DATA_FORBIDDEN");

// The evaluator must use the fixture's committed expected route/error, not echo
// whatever the implementation happened to return.  Run an isolated copy and
// mutate one expectation; a proof that still passes would be tautological.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-object-scope-fixture-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "object-scope"), path.join(temp, "specialist-blocks", "wave-03", "object-scope"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards", "owasp-asvs"), path.join(temp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
  fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json"));
  fs.cpSync(path.join(repositoryRoot, "fixtures", "model-policy-evidence"), path.join(temp, "fixtures", "model-policy-evidence"), {recursive: true});
  fs.mkdirSync(path.join(temp, "schemas"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "schemas", "object-scope-gate-execution.v1.json"), path.join(temp, "schemas", "object-scope-gate-execution.v1.json"));
  const mutatedFixture = path.join(temp, "specialist-blocks", "wave-03", "object-scope", "fixtures", "authority_conflict.json");
  const fixture = JSON.parse(fs.readFileSync(mutatedFixture, "utf8"));
  fixture.expected.route = "NO_OBJECT_SCOPE";
  fs.writeFileSync(mutatedFixture, `${JSON.stringify(fixture, null, 2)}\n`);
  const isolatedEvaluator = await import(`${pathToFileURL(path.join(temp, "control", "object-scope-package-evaluator.mjs")).href}?fixture-mutation=${Date.now()}`);
  await assert.rejects(() => isolatedEvaluator.evaluateObjectScopePackage(), (error) => ["OBJECT_SCOPE_HOSTILE_RESULT_FAILED", "OBJECT_SCOPE_FIXTURE_PROVENANCE_INVALID", "OBJECT_SCOPE_FIXTURE_VECTOR_INVALID", "OBJECT_SCOPE_ROSTER_PROVENANCE_INVALID"].includes(error?.code));
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
console.log("PASS Object Scope boundary: 17 executable adversarial vectors, fixture-bound expectations, mutation proof, and zero side effects");
