#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateSecurityRouterBoundary, SECURITY_ROUTER_BOUNDARY_SCHEMA, SECURITY_ROUTER_RESULT_SCHEMA} from "../control/security-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-02/security-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const fixtureIds = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/security-router-boundary-gate.mjs#evaluateSecurityRouterBoundary");
  assert.equal(fixture.vector.input.schema, SECURITY_ROUTER_BOUNDARY_SCHEMA);
  assert(!fixtureIds.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); fixtureIds.add(fixture.fixture_id);
  const actual = evaluateSecurityRouterBoundary(fixture.vector.input);
  const expected = fixture.vector.expected_readback;
  assert.equal(actual.schema, SECURITY_ROUTER_RESULT_SCHEMA);
  assert.equal(actual.disposition, expected.disposition, fixture.fixture_id);
  assert.equal(actual.route, expected.route, fixture.fixture_id);
  assert.equal(actual.error_code, expected.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {specialist_invocations: 0, source_writes: 0, project_writes: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}

const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateSecurityRouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "SECURITY_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateSecurityRouterBoundary({...valid, evidence: {...valid.evidence, custody_ref: "/tmp/private"}}), (error) => error.code === "SECURITY_ROUTER_CUSTODY_REF_INVALID");
assert.throws(() => evaluateSecurityRouterBoundary({...valid, evidence: {...valid.evidence, secret_data_present: "false"}}), (error) => error.code === "SECURITY_ROUTER_BOOLEAN_INVALID");
console.log("PASS Security Router boundary: 17 typed hostile vectors executed, narrow routes checked, and all side effects denied");
