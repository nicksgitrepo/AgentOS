#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateObservabilityRouterBoundary, OBSERVABILITY_ROUTER_BOUNDARY_SCHEMA, OBSERVABILITY_ROUTER_RESULT_SCHEMA} from "../control/observability-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-04/observability-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/observability-router-boundary-gate.mjs#evaluateObservabilityRouterBoundary");
  assert.equal(fixture.vector.input.schema, OBSERVABILITY_ROUTER_BOUNDARY_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateObservabilityRouterBoundary(fixture.vector.input); const expected = fixture.vector.expected_readback;
  assert.equal(actual.schema, OBSERVABILITY_ROUTER_RESULT_SCHEMA); assert.equal(actual.disposition, expected.disposition, fixture.fixture_id); assert.equal(actual.route, expected.route, fixture.fixture_id); assert.equal(actual.error_code, expected.error_code, fixture.fixture_id); assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {specialist_invocations: 0, alert_reads: 0, production_writes: 0, incident_commands: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateObservabilityRouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "OBSERVABILITY_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateObservabilityRouterBoundary({...valid, evidence: {...valid.evidence, custody_ref: "/private"}}), (error) => error.code === "OBSERVABILITY_ROUTER_CUSTODY_REF_INVALID");
assert.throws(() => evaluateObservabilityRouterBoundary({...valid, evidence: {...valid.evidence, incident_identity: "../PRIVATE"}}), (error) => error.code === "OBSERVABILITY_ROUTER_ID_INVALID");
console.log("PASS Observability Router boundary: 17 typed hostile vectors executed with zero alert, incident, production, or project side effects");
