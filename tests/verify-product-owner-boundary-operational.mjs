#!/usr/bin/env node

import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL, fileURLToPath} from "node:url";
import {evaluateProductOwnerBoundary} from "../control/product-owner-boundary-gate.mjs";
import {evaluateCanonicalProductOwnerBoundaryFixtures} from "../control/product-owner-pre-admission-evaluator.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base = {schema: "agentos.product_owner_boundary_input.v1", version: 1, admission_status: "CURRENT", model_context_status: "CURRENT", intent_context_status: "CURRENT", project_binding_status: "MATCHED", detail_level: "SIMPLE"};
const expected = new Map([
  ["INTENT_CONFLICT", ["ESCALATE_USER", "PRODUCT_OWNER_BOUNDED_QUESTION"]],
  ["INTENT_CLARIFICATION", ["ALLOW_CONVERSATION", "PRODUCT_OWNER"]],
  ["SIMPLE_EXPLANATION", ["ALLOW_CONVERSATION", "PRODUCT_OWNER"]],
  ["DECLARED_INTENT_IMPLEMENTATION", ["ROUTE_HANDOFF", "ORCHESTRATOR"]],
  ["IMPLEMENTATION", ["DENY", "ORCHESTRATOR"]], ["WORKFLOW_CONTROL", ["DENY", "CONTROLLER"]],
  ["LIFECYCLE", ["DENY", "SPAWNER"]], ["DEPLOYMENT", ["DENY", "RUNTIME"]],
  ["MEMORY_WRITE", ["DENY", "MEMORY"]], ["MODEL_OVERRIDE", ["DENY", "CONTROLLER"]],
  ["SELF_REVIEW", ["DENY", "INDEPENDENT_EVALUATOR"]], ["CROSS_PROJECT_CONTEXT", ["DENY", "CONTROLLER"]],
  ["UNSAFE_IRREVERSIBLE_ACTION", ["DENY", "PRODUCT_OWNER_BOUNDED_QUESTION"]],
]);
for (const [requestKind, [disposition, route]] of expected) {
  const input = {...base, request_kind: requestKind, ...(requestKind === "INTENT_CONFLICT" ? {intent_context_status: "CONTRADICTORY"} : {}), ...(requestKind === "CROSS_PROJECT_CONTEXT" ? {project_binding_status: "MISMATCHED"} : {})};
  const result = evaluateProductOwnerBoundary(input); assert.equal(result.disposition, disposition); assert.equal(result.route, route);
  assert.equal(result.implementation_performed, false); assert.deepEqual([result.workflow_mutations, result.lifecycle_mutations, result.deployment_calls, result.memory_writes, result.model_overrides, result.acceptance_mutations], [0, 0, 0, 0, 0, 0]);
}
assert.equal(evaluateProductOwnerBoundary({...base, request_kind: "SIMPLE_EXPLANATION", model_context_status: "STALE"}).reason_code, "CURRENT_MODEL_CONTEXT_REQUIRED");
assert.equal(evaluateProductOwnerBoundary({...base, request_kind: "SIMPLE_EXPLANATION", admission_status: "STALE"}).reason_code, "CURRENT_ADMISSION_REQUIRED");

const evaluation = evaluateCanonicalProductOwnerBoundaryFixtures();
assert.equal(evaluation.status, "EXECUTED_RESULTS_COMPLETE_REVIEW_PENDING"); assert.equal(evaluation.authority_status, "NON_AUTHORITATIVE_PRE_ADMISSION_EVIDENCE"); assert.equal(evaluation.fixture_count, 17); assert.equal(new Set(evaluation.results.map((item) => item.fixture_id)).size, 17);
assert(evaluation.results.every((item) => item.outcome === "EXPECTED_OUTCOME_OBSERVED" && Object.values(item.side_effect_spy_readback).every((count) => count === 0)));

const testTempParent = path.join(root, "Temp");
const testTempParentExisted = fs.existsSync(testTempParent);
fs.mkdirSync(testTempParent, {recursive: true});
const temporary = fs.mkdtempSync(path.join(testTempParent, "product-owner-mutation-"));
try {
  const originalPath = path.join(root, "control/product-owner-boundary-gate.mjs"), original = fs.readFileSync(originalPath, "utf8");
  const mutated = original.replace("void sideEffectBoundary;", "sideEffectBoundary.workflow();"); assert.notEqual(mutated, original);
  const mutationPath = path.join(temporary, "product-owner-boundary-gate.mjs"); fs.writeFileSync(mutationPath, mutated);
  fs.copyFileSync(path.join(root, "control/content-addressing.mjs"), path.join(temporary, "content-addressing.mjs"));
  fs.copyFileSync(path.join(root, "control/persisted-record-privacy.mjs"), path.join(temporary, "persisted-record-privacy.mjs"));
  const module = await import(`${pathToFileURL(mutationPath).href}?mutation=1`); let calls = 0;
  assert.throws(() => module.evaluateProductOwnerBoundary({...base, request_kind: "SIMPLE_EXPLANATION"}, {workflow() { calls += 1; throw new Error("mutation side effect"); }}), /mutation side effect/u); assert.equal(calls, 1);
  const originalSha = createHash("sha256").update(original).digest("hex"), mutatedSha = createHash("sha256").update(mutated).digest("hex"); assert.notEqual(mutatedSha, originalSha); assert.notEqual(mutatedSha, evaluation.implementation_file_sha256);
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
  if (!testTempParentExisted && fs.readdirSync(testTempParent).length === 0) fs.rmdirSync(testTempParent);
}

console.log("PASS Product Owner boundary: typed intent routes and forbidden authorities execute through one production gate; 17 canonical fixtures have zero side effects and a weakened gate invalidates review");
