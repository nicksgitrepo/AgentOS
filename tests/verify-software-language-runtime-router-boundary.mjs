#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateSoftwareLanguageRuntimeRouterBoundary,
  SOFTWARE_LANGUAGE_RUNTIME_ROUTER_BOUNDARY_SCHEMA,
  SOFTWARE_LANGUAGE_RUNTIME_ROUTER_RESULT_SCHEMA,
} from "../control/software-language-runtime-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-02/software-language-runtime-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17, "software language/runtime router must have 17 hostile vectors");
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/software-language-runtime-router-boundary-gate.mjs#evaluateSoftwareLanguageRuntimeRouterBoundary");
  assert.equal(fixture.vector.input.schema, SOFTWARE_LANGUAGE_RUNTIME_ROUTER_BOUNDARY_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`);
  ids.add(fixture.fixture_id);
  const actual = evaluateSoftwareLanguageRuntimeRouterBoundary(fixture.vector.input);
  const expected = fixture.expected_readback;
  assert.equal(actual.schema, SOFTWARE_LANGUAGE_RUNTIME_ROUTER_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, expected.disposition, fixture.fixture_id);
  assert.equal(actual.route, expected.route, fixture.fixture_id);
  assert.equal(actual.error_code, expected.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {
    specialist_invocations: 0,
    runtime_reads: 0,
    runtime_mutations: 0,
    project_writes: 0,
    credential_accesses: 0,
    state_changes: 0,
  }, fixture.fixture_id);
}

const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "narrowness.json"), "utf8")).vector.input;
assert.throws(
  () => evaluateSoftwareLanguageRuntimeRouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}),
  (error) => error.code === "SOFTWARE_LANGUAGE_RUNTIME_ROUTER_UNKNOWN_FIELD",
);
assert.throws(
  () => evaluateSoftwareLanguageRuntimeRouterBoundary({...valid, evidence: {...valid.evidence, custody_ref: "/private"}}),
  (error) => error.code === "SOFTWARE_LANGUAGE_RUNTIME_ROUTER_CUSTODY_REF_INVALID",
);
assert.equal(
  evaluateSoftwareLanguageRuntimeRouterBoundary({...valid, evidence: {...valid.evidence, target_ref: "specialist.software-language-runtime.router"}}).error_code,
  "SOFTWARE_LANGUAGE_RUNTIME_ROUTER_TARGET_MISMATCH",
);
const privatePath = ["/", "Users", "/", "secret"].join("");
assert.throws(
  () => evaluateSoftwareLanguageRuntimeRouterBoundary({...valid, evidence: {...valid.evidence, runtime_evidence: `PRIVATE CHAT ${privatePath}`}}),
  (error) => error.code === "SOFTWARE_LANGUAGE_RUNTIME_ROUTER_PRIVACY_DENIED",
);
console.log("PASS Software Language and Runtime Router boundary: 17 typed hostile vectors executed with zero runtime, project, credential, or state side effects");
