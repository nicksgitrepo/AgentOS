#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateDataLifecycleRouterBoundary, DATA_LIFECYCLE_ROUTER_INPUT_SCHEMA, DATA_LIFECYCLE_ROUTER_RESULT_SCHEMA} from "../control/data-lifecycle-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-03/data-lifecycle-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/data-lifecycle-router-boundary-gate.mjs#evaluateDataLifecycleRouterBoundary");
  assert.equal(fixture.vector.input.schema, DATA_LIFECYCLE_ROUTER_INPUT_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateDataLifecycleRouterBoundary(fixture.vector.input);
  assert.equal(actual.schema, DATA_LIFECYCLE_ROUTER_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, fixture.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.equal(actual.protected_data_allowed, false, fixture.fixture_id);
  assert.equal(actual.legal_assertion_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {data_reads: 0, protected_data_reads: 0, policy_assertions: 0, legal_conclusions: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateDataLifecycleRouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "DATA_LIFECYCLE_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateDataLifecycleRouterBoundary({...valid, evidence: {...valid.evidence, candidate_digest: "a".repeat(64)}}), (error) => error.code === "DATA_LIFECYCLE_ROUTER_DIGEST_INVALID");
const privatePath = ["/", "Users", "/", "secret"].join("");
assert.throws(() => evaluateDataLifecycleRouterBoundary({...valid, evidence: {...valid.evidence, data_category: `PRIVATE CHAT ${privatePath}`}}), (error) => error.code === "DATA_LIFECYCLE_ROUTER_PRIVACY_DENIED");
assert.equal(evaluateDataLifecycleRouterBoundary({...valid, evidence: {...valid.evidence, legal_conclusion_requested: true}}).error_code, "DATA_LIFECYCLE_ROUTER_LEGAL_APPLICABILITY_EXTERNAL");
assert.equal(evaluateDataLifecycleRouterBoundary({...valid, evidence: {...valid.evidence, source_identity: "SOURCE.OTHER"}}).error_code, "DATA_LIFECYCLE_ROUTER_SOURCE_BINDING_INVALID");
console.log("PASS Privacy Data-Lifecycle Router boundary: 17 executable typed vectors, privacy/legal denials, zero protected-data/acceptance side effects");
