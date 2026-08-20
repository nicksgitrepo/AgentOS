#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateAndroidKotlinBoundary, ANDROID_KOTLIN_BOUNDARY_INPUT_SCHEMA, ANDROID_KOTLIN_BOUNDARY_RESULT_SCHEMA} from "../control/android-kotlin-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-05/android-kotlin/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/android-kotlin-boundary-gate.mjs#evaluateAndroidKotlinBoundary");
  assert.equal(fixture.vector.input.schema, ANDROID_KOTLIN_BOUNDARY_INPUT_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateAndroidKotlinBoundary(fixture.vector.input);
  assert.equal(actual.schema, ANDROID_KOTLIN_BOUNDARY_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.equal(actual.verification_allowed, false, fixture.fixture_id);
  assert.equal(actual.standard_mutation_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {source_reads: 0, protected_data_reads: 0, verification_runs: 0, standard_mutations: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateAndroidKotlinBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "ANDROID_KOTLIN_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateAndroidKotlinBoundary({...valid, evidence: {...valid.evidence, candidate_digest: "a".repeat(64)}}), (error) => error.code === "ANDROID_KOTLIN_ROUTER_DIGEST_INVALID");
const privatePath = ["/", "Users", "/", "secret"].join("");
assert.throws(() => evaluateAndroidKotlinBoundary({...valid, evidence: {...valid.evidence, control_activity: `PRIVATE CHAT ${privatePath}`}}), (error) => error.code === "ANDROID_KOTLIN_ROUTER_PRIVACY_DENIED");
assert.equal(evaluateAndroidKotlinBoundary({...valid, evidence: {...valid.evidence, verification_requested: true}}).error_code, "ANDROID_KOTLIN_ROUTER_SIDE_EFFECT_FORBIDDEN");
assert.equal(evaluateAndroidKotlinBoundary({...valid, evidence: {...valid.evidence, source_identity: "SOURCE.OTHER"}}).error_code, "ANDROID_KOTLIN_ROUTER_SOURCE_BINDING_INVALID");
console.log("PASS Android/Kotlin Applicability Router boundary: 17 executable typed vectors, version/applicability denials, zero security or state side effects");
