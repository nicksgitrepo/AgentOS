#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateJobCostAccountingBoundary,
  JOB_COST_ACCOUNTING_INPUT_SCHEMA,
  JOB_COST_ACCOUNTING_RESULT_SCHEMA,
} from "../control/job-cost-accounting-boundary-gate.mjs";
import {evaluateJobCostAccountingPackage} from "../control/job-cost-accounting-package-evaluator.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-06/job-cost-accounting/fixtures");
const inputSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/job-cost-accounting-boundary-input.v1.json"), "utf8"));
const resultSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/job-cost-accounting-boundary-result.v1.json"), "utf8"));
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);

for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/job-cost-accounting-boundary-gate.mjs#evaluateJobCostAccountingBoundary", fixture.fixture_id);
  assert.equal(fixture.vector.input.schema, JOB_COST_ACCOUNTING_INPUT_SCHEMA, fixture.fixture_id);
  const actual = evaluateJobCostAccountingBoundary(fixture.vector.input);
  assert.equal(actual.schema, JOB_COST_ACCOUNTING_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.equal(actual.professional_opinion_allowed, false, fixture.fixture_id);
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), fixture.fixture_id);
}

const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateJobCostAccountingBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "JOB_COST_ACCOUNTING_UNKNOWN_FIELD");
assert.throws(() => evaluateJobCostAccountingBoundary({...valid, evidence: {...valid.evidence, candidate_digest: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"}}), (error) => error.code === "JOB_COST_ACCOUNTING_CANDIDATE_PROVENANCE_INVALID");
assert.throws(() => evaluateJobCostAccountingBoundary({...valid, evidence: {...valid.evidence, upstream_router_result_sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"}}), (error) => error.code === "JOB_COST_ACCOUNTING_CONTEXT_PROVENANCE_INVALID");
assert.throws(() => evaluateJobCostAccountingBoundary({...valid, evidence: {...valid.evidence, accounting_policy: "password=not-redacted"}}), (error) => error.code === "JOB_COST_ACCOUNTING_PRIVACY_DENIED");

const evaluation = await evaluateJobCostAccountingPackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.admission_ceiling, "BLOCKED_EXACT");
assert.equal(evaluation.gate_executions.length, 12);
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.privacy_probe.secret_rejected, true);
assert(evaluation.global_authority_defects.some((defect) => defect.code === "SPAWNER_GLOBAL_ROSTER_PROVENANCE_STALE"));
assert.equal(evaluation.spawner_receipt.status, "BLOCKED_EXACT");
assert.equal(evaluation.spawner_receipt.prepare_code, "CANONICAL_EVALUATOR_HANDOFF_REQUIRED");
assert.equal(evaluation.spawner_receipt.resolve_code, "SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");
assert.equal(inputSchema.properties.schema.const, JOB_COST_ACCOUNTING_INPUT_SCHEMA);
assert.equal(resultSchema.properties.schema.const, JOB_COST_ACCOUNTING_RESULT_SCHEMA);
console.log("PASS Job-Cost Accounting boundary: 17 executable vectors, provenance spoof/privacy regressions, zero side effects, mutation proof, and preserved BLOCKED_EXACT ceiling");
