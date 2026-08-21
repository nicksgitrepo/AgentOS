#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {evaluateIdempotencyBoundary, IDEMPOTENCY_INPUT_SCHEMA, IDEMPOTENCY_RESULT_SCHEMA} from "../control/idempotency-boundary-gate.mjs";
import {evaluateIdempotencyPackage} from "../control/idempotency-package-evaluator.mjs";

const evaluation = await evaluateIdempotencyPackage();
assert.equal(evaluation.status, "PASS"); assert.equal(evaluation.fixture_results.length, 17); assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
const validInput = {schema: IDEMPOTENCY_INPUT_SCHEMA, version: 1, request_kind: "ANALYZE_IDEMPOTENCY", evidence: {
  authority_status: "CURRENT", security_domain: "IDEMPOTENCY", request_identity: "REQUEST.IDEMPOTENCY.ANALYSIS", idempotency_key: "0123456789abcdef".repeat(4), duplicate_detection_status: "EVIDENCE_COMPLETE", replay_status: "BOUND", concurrency_scope: "ONE_OPERATION", operation_identity: "OPERATION.IDEMPOTENCY", operation_version: "1", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.AGENTOS_IDEMPOTENCY", source_version: "1", source_effective_date: "2026-08-11", source_retrieved_date: "2026-08-20", candidate_status: "CURRENT_CANDIDATE", candidate_digest: "abcdef0123456789".repeat(4), signal_status: "BOUND", task_status: "IDEMPOTENCY_ANALYSIS", context_status: "IDEMPOTENCY_CONTEXT", context_complete: true, requested_action: "ANALYZE", requested_tools: ["READ_IDEMPOTENCY_RECORD"], required_block_identities: ["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "BLOCK.SECURITY.ACCESS_CONTROL_ROUTER"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "IDEMPOTENCY", project_data_present: false, secret_data_present: false, adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive", "duplicate_request", "key_missing", "version_ambiguous", "replay_unproven", "concurrency_unbounded"].map((key) => [key, false])),
}};
const denied = evaluateIdempotencyBoundary({...validInput, request_kind: "DEPLOY"});
assert.equal(denied.schema, IDEMPOTENCY_RESULT_SCHEMA); assert.equal(denied.disposition, "DENY"); assert.equal(denied.error_code, "IDEMPOTENCY_OPERATION_FORBIDDEN");

// Changing a committed expected route in an isolated copy must invalidate the
// evaluation; otherwise the evaluator could be echoing implementation output.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-idempotency-fixture-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "idempotency"), path.join(temp, "specialist-blocks", "wave-03", "idempotency"), {recursive: true});
  const mutated = path.join(temp, "specialist-blocks/wave-03/idempotency/fixtures/authority_conflict.json"); const fixture = JSON.parse(fs.readFileSync(mutated, "utf8")); fixture.expected.route = "NO_IDEMPOTENCY_SCOPE"; fs.writeFileSync(mutated, `${JSON.stringify(fixture)}\n`);
  const evaluator = await import(`${pathToFileURL(path.join(temp, "control/idempotency-package-evaluator.mjs")).href}?fixture-mutation=${Date.now()}`);
  await assert.rejects(() => evaluator.evaluateIdempotencyPackage(), (error) => error?.code === "IDEMPOTENCY_HOSTILE_RESULT_FAILED");
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
console.log("PASS Idempotency boundary: 17 executable typed vectors, fixture-bound expectations, mutation proof, and zero side effects");
