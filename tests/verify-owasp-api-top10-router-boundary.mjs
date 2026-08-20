#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateOwaspApiTop10RouterBoundary, OWASP_API_TOP10_ROUTER_INPUT_SCHEMA, OWASP_API_TOP10_ROUTER_RESULT_SCHEMA} from "../control/owasp-api-top10-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-03/owasp-api-top10-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/owasp-api-top10-router-boundary-gate.mjs#evaluateOwaspApiTop10RouterBoundary");
  assert.equal(fixture.vector.input.schema, OWASP_API_TOP10_ROUTER_INPUT_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateOwaspApiTop10RouterBoundary(fixture.vector.input);
  assert.equal(actual.schema, OWASP_API_TOP10_ROUTER_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.equal(actual.authorization_decision_allowed, false, fixture.fixture_id);
  assert.equal(actual.policy_mutation_allowed, false, fixture.fixture_id);
  assert.equal(actual.credential_issue_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {api_reads: 0, protected_data_reads: 0, authorization_decisions: 0, policy_mutations: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateOwaspApiTop10RouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "OWASP_API_TOP10_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateOwaspApiTop10RouterBoundary({...valid, evidence: {...valid.evidence, candidate_digest: "a".repeat(64)}}), (error) => error.code === "OWASP_API_TOP10_ROUTER_DIGEST_INVALID");
const privatePath = ["/", "Users", "/", "secret"].join("");
assert.throws(() => evaluateOwaspApiTop10RouterBoundary({...valid, evidence: {...valid.evidence, control_activity: `PRIVATE CHAT ${privatePath}`}}), (error) => error.code === "OWASP_API_TOP10_ROUTER_PRIVACY_DENIED");
assert.equal(evaluateOwaspApiTop10RouterBoundary({...valid, evidence: {...valid.evidence, authorization_decision_requested: true}}).error_code, "OWASP_API_TOP10_ROUTER_AUTHORIZATION_SIDE_EFFECT_FORBIDDEN");
assert.equal(evaluateOwaspApiTop10RouterBoundary({...valid, evidence: {...valid.evidence, source_identity: "SOURCE.OTHER"}}).error_code, "OWASP_API_TOP10_ROUTER_SOURCE_BINDING_INVALID");
console.log("PASS OWASP API Top 10 Composition Router boundary: 17 executable typed vectors, authorization/policy denials, zero security or state side effects");
