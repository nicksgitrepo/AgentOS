#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateDataRouterBoundary, DATA_ROUTER_BOUNDARY_SCHEMA, DATA_ROUTER_RESULT_SCHEMA} from "../control/data-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-02/data-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/data-router-boundary-gate.mjs#evaluateDataRouterBoundary");
  assert.equal(fixture.vector.input.schema, DATA_ROUTER_BOUNDARY_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateDataRouterBoundary(fixture.vector.input); const expected = fixture.vector.expected_readback;
  assert.equal(actual.schema, DATA_ROUTER_RESULT_SCHEMA); assert.equal(actual.disposition, expected.disposition, fixture.fixture_id); assert.equal(actual.route, expected.route, fixture.fixture_id); assert.equal(actual.error_code, expected.error_code, fixture.fixture_id); assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {specialist_invocations: 0, schema_writes: 0, project_writes: 0, migration_calls: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateDataRouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "DATA_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateDataRouterBoundary({...valid, evidence: {...valid.evidence, custody_ref: "/private"}}), (error) => error.code === "DATA_ROUTER_CUSTODY_REF_INVALID");
console.log("PASS Data Router boundary: 17 typed hostile vectors executed with zero data, migration, or project side effects");
