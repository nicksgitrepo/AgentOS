#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateCentralIntegratorBoundary, CENTRAL_INTEGRATOR_BOUNDARY_SCHEMA, CENTRAL_INTEGRATOR_RESULT_SCHEMA} from "../control/central-integrator-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-04/central-integrator/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/central-integrator-boundary-gate.mjs#evaluateCentralIntegratorBoundary");
  assert.equal(fixture.vector.input.schema, CENTRAL_INTEGRATOR_BOUNDARY_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateCentralIntegratorBoundary(fixture.vector.input); const expected = fixture.vector.expected_readback;
  assert.equal(actual.schema, CENTRAL_INTEGRATOR_RESULT_SCHEMA); assert.equal(actual.disposition, expected.disposition, fixture.fixture_id); assert.equal(actual.route, expected.route, fixture.fixture_id); assert.equal(actual.error_code, expected.error_code, fixture.fixture_id); assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {dependency_reads: 0, receipt_writes: 0, project_writes: 0, merge_calls: 0, deployment_calls: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateCentralIntegratorBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "CENTRAL_INTEGRATOR_UNKNOWN_FIELD");
assert.throws(() => evaluateCentralIntegratorBoundary({...valid, evidence: {...valid.evidence, custody_ref: "/private"}}), (error) => error.code === "CENTRAL_INTEGRATOR_REF_INVALID");
assert.throws(() => evaluateCentralIntegratorBoundary({...valid, evidence: {...valid.evidence, candidate_digest: "0".repeat(64)}}), (error) => error.code === "CENTRAL_INTEGRATOR_DIGEST_PLACEHOLDER");
assert.equal(evaluateCentralIntegratorBoundary({...valid, evidence: {...valid.evidence, model_task_class: "BROAD_ARCHITECTURE"}}).error_code, "CENTRAL_INTEGRATOR_MODEL_ROUTE_INVALID");
assert.equal(evaluateCentralIntegratorBoundary({...valid, evidence: {...valid.evidence, standard_identities: ["SPECIALIST.STANDARD.NIST_SSDF"]}}).error_code, "CENTRAL_INTEGRATOR_STANDARD_BINDING_INVALID");
console.log("PASS Central Integrator boundary: 17 typed vectors executed with zero project, merge, deploy, credential, or state side effects");
