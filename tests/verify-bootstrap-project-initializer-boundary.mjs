#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateBootstrapProjectInitializerBoundary,
  BOOTSTRAP_PROJECT_INITIALIZER_BOUNDARY_SCHEMA,
  BOOTSTRAP_PROJECT_INITIALIZER_RESULT_SCHEMA,
} from "../control/bootstrap-project-initializer-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-01/agent-bootstrap/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17, "bootstrap initializer must have 17 hostile vectors");
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/bootstrap-project-initializer-boundary-gate.mjs#evaluateBootstrapProjectInitializerBoundary");
  assert.equal(fixture.vector.input.schema, BOOTSTRAP_PROJECT_INITIALIZER_BOUNDARY_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`);
  ids.add(fixture.fixture_id);
  const actual = evaluateBootstrapProjectInitializerBoundary(fixture.vector.input);
  const expected = fixture.expected_readback;
  assert.equal(actual.schema, BOOTSTRAP_PROJECT_INITIALIZER_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, expected.disposition, fixture.fixture_id);
  assert.equal(actual.route, expected.route, fixture.fixture_id);
  assert.equal(actual.error_code, expected.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {
    initializer_invocations: 0,
    filesystem_metadata_reads: 0,
    git_metadata_reads: 0,
    project_writes: 0,
    memory_writes: 0,
    provider_mutations: 0,
    credential_accesses: 0,
    owner_decisions: 0,
    state_changes: 0,
  }, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "narrowness.json"), "utf8")).vector.input;
assert.throws(() => evaluateBootstrapProjectInitializerBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "BOOTSTRAP_PROJECT_INITIALIZER_UNKNOWN_FIELD");
assert.throws(() => evaluateBootstrapProjectInitializerBoundary({...valid, evidence: {...valid.evidence, custody_ref: "/private"}}), (error) => error.code === "BOOTSTRAP_PROJECT_INITIALIZER_REF_INVALID");
assert.equal(evaluateBootstrapProjectInitializerBoundary({...valid, evidence: {...valid.evidence, target_ref: "AGENTOS_SPAWNER"}}).error_code, "BOOTSTRAP_PROJECT_INITIALIZER_TARGET_MISMATCH");
const privatePath = ["/", "Users", "/", "secret"].join("");
assert.throws(() => evaluateBootstrapProjectInitializerBoundary({...valid, evidence: {...valid.evidence, signal: `PRIVATE ${privatePath}`}}), (error) => error.code === "BOOTSTRAP_PROJECT_INITIALIZER_PRIVACY_DENIED");
console.log("PASS Bootstrap/Project Initializer boundary: 17 typed hostile vectors executed with zero project, memory, provider, credential, owner, or state side effects");
