#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateRegulatoryApplicabilityRouterBoundary, REGULATORY_APPLICABILITY_ROUTER_INPUT_SCHEMA, REGULATORY_APPLICABILITY_ROUTER_RESULT_SCHEMA} from "../control/regulatory-applicability-router-boundary-gate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-06/regulatory-applicability-router/fixtures");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);
const ids = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/regulatory-applicability-router-boundary-gate.mjs#evaluateRegulatoryApplicabilityRouterBoundary");
  assert.equal(fixture.vector.input.schema, REGULATORY_APPLICABILITY_ROUTER_INPUT_SCHEMA);
  assert(!ids.has(fixture.fixture_id), `duplicate fixture ${fixture.fixture_id}`); ids.add(fixture.fixture_id);
  const actual = evaluateRegulatoryApplicabilityRouterBoundary(fixture.vector.input);
  assert.equal(actual.schema, REGULATORY_APPLICABILITY_ROUTER_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.equal(actual.legal_assertion_allowed, false, fixture.fixture_id);
  assert.equal(actual.compliance_certification_allowed, false, fixture.fixture_id);
  assert.equal(actual.regulated_instruction_allowed, false, fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, {regulatory_reads: 0, protected_data_reads: 0, legal_conclusions: 0, compliance_certifications: 0, regulated_instructions: 0, memory_writes: 0, acceptance_calls: 0, credential_accesses: 0, state_changes: 0}, fixture.fixture_id);
}
const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
assert.throws(() => evaluateRegulatoryApplicabilityRouterBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "REGULATORY_APPLICABILITY_ROUTER_UNKNOWN_FIELD");
assert.throws(() => evaluateRegulatoryApplicabilityRouterBoundary({...valid, evidence: {...valid.evidence, candidate_digest: "a".repeat(64)}}), (error) => error.code === "REGULATORY_APPLICABILITY_ROUTER_DIGEST_INVALID");
const privatePath = ["/", "Users", "/", "secret"].join("");
assert.throws(() => evaluateRegulatoryApplicabilityRouterBoundary({...valid, evidence: {...valid.evidence, regulation_activity: `PRIVATE CHAT ${privatePath}`}}), (error) => error.code === "REGULATORY_APPLICABILITY_ROUTER_PRIVACY_DENIED");
assert.equal(evaluateRegulatoryApplicabilityRouterBoundary({...valid, evidence: {...valid.evidence, legal_conclusion_requested: true}}).error_code, "REGULATORY_APPLICABILITY_ROUTER_PROFESSIONAL_APPLICABILITY_EXTERNAL");
assert.equal(evaluateRegulatoryApplicabilityRouterBoundary({...valid, evidence: {...valid.evidence, source_identity: "SOURCE.OTHER"}}).error_code, "REGULATORY_APPLICABILITY_ROUTER_SOURCE_BINDING_INVALID");
console.log("PASS Regulatory Applicability Router boundary: 17 executable typed vectors, legal/certification denials, zero professional or state side effects");

