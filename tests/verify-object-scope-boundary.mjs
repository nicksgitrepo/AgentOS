#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {evaluateObjectScopeBoundary, OBJECT_SCOPE_INPUT_SCHEMA, OBJECT_SCOPE_RESULT_SCHEMA} from "../control/object-scope-boundary-gate.mjs";
import {evaluateObjectScopePackage} from "../control/object-scope-package-evaluator.mjs";
const evaluation = await evaluateObjectScopePackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
const input = {schema: OBJECT_SCOPE_INPUT_SCHEMA, version: 1, request_kind: "SPAWN", evidence: {
  authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.SECURITY.OBJECT_SCOPE", custody_ref: "opaque:OBJECT_SCOPE.CUSTODY", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: "1", source_effective_date: "2026-08-11", source_retrieved_date: "2026-08-20", candidate_status: "CURRENT_CANDIDATE", candidate_digest: "0123456789abcdef".repeat(4), signal: "OBJECT_SCOPE", signal_status: "BOUND", context_status: "OBJECT_SCOPE_CONTEXT", context_complete: true, requested_action: "ANALYZE", requested_tools: ["READ_CANDIDATE"], required_block_identities: ["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "specialist.security.access-control-router", "specialist.standard.owasp-asvs"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "OBJECT_SCOPE", scope: "NARROW", project_data_present: false, secret_data_present: false, adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false])),
}};
const denied = evaluateObjectScopeBoundary(input);
assert.equal(denied.schema, OBJECT_SCOPE_RESULT_SCHEMA); assert.equal(denied.disposition, "DENY"); assert.equal(denied.error_code, "OBJECT_SCOPE_OPERATION_FORBIDDEN");

// The evaluator must use the fixture's committed expected route/error, not echo
// whatever the implementation happened to return.  Run an isolated copy and
// mutate one expectation; a proof that still passes would be tautological.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-object-scope-fixture-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "object-scope"), path.join(temp, "specialist-blocks", "wave-03", "object-scope"), {recursive: true});
  const mutatedFixture = path.join(temp, "specialist-blocks", "wave-03", "object-scope", "fixtures", "authority_conflict.json");
  const fixture = JSON.parse(fs.readFileSync(mutatedFixture, "utf8"));
  fixture.expected.route = "NO_OBJECT_SCOPE";
  fs.writeFileSync(mutatedFixture, `${JSON.stringify(fixture, null, 2)}\n`);
  const isolatedEvaluator = await import(`${pathToFileURL(path.join(temp, "control", "object-scope-package-evaluator.mjs")).href}?fixture-mutation=${Date.now()}`);
  await assert.rejects(() => isolatedEvaluator.evaluateObjectScopePackage(), (error) => error?.code === "OBJECT_SCOPE_HOSTILE_RESULT_FAILED");
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
console.log("PASS Object Scope boundary: 17 executable adversarial vectors, fixture-bound expectations, mutation proof, and zero side effects");
