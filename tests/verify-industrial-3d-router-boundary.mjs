#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateIndustrial3dRouterBoundary, INDUSTRIAL_3D_ROUTER_INPUT_SCHEMA, INDUSTRIAL_3D_ROUTER_RESULT_SCHEMA} from "../control/industrial-3d-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-06/industrial-3d-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/industrial-3d-router-boundary-gate.mjs#evaluateIndustrial3dRouterBoundary");
  assert.equal(fixture.vector.input.schema, INDUSTRIAL_3D_ROUTER_INPUT_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateIndustrial3dRouterBoundary(fixture.vector.input);
  assert.equal(actual.schema, INDUSTRIAL_3D_ROUTER_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.equal(actual.asset_mutation_allowed, false, fixture.fixture_id);
  assert.equal(actual.engineering_assertion_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {asset_reads: 0, mesh_writes: 0, engineering_assertions: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateIndustrial3dRouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "INDUSTRIAL_3D_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateIndustrial3dRouterBoundary({...valid, evidence: {...valid.evidence, asset_ref: "/private/asset"}}), (error) => error.code === "INDUSTRIAL_3D_ROUTER_REF_INVALID");
assert.throws(() => evaluateIndustrial3dRouterBoundary({...valid, evidence: {...valid.evidence, asset_identity: "PRIVATE CHAT /Users/secret"}}), (error) => error.code === "INDUSTRIAL_3D_ROUTER_PRIVACY_DENIED");
assert.equal(evaluateIndustrial3dRouterBoundary({...valid, evidence: {...valid.evidence, source_identity: "SOURCE.OTHER"}}).error_code, "INDUSTRIAL_3D_ROUTER_SOURCE_BINDING_INVALID");
console.log("PASS Industrial 3D Asset Router boundary: 17 executable typed vectors, engineering/protected-data denials, zero asset/engineering/acceptance side effects");
