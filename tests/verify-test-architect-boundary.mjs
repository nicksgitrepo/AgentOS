#!/usr/bin/env node

/* Focused operational and hostile checks for the Test Architecture candidate. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL, fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  evaluateTestArchitectBoundary,
  TEST_ARCHITECT_INPUT_SCHEMA,
  TEST_ARCHITECT_RESULT_SCHEMA,
} from "../control/test-architect-boundary-gate.mjs";
import {evaluateTestArchitectPackage} from "../control/test-architect-package-evaluator.mjs";
import {resolveTestArchitectCanonicalAuthority} from "../control/test-architect-authority-binding.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-04/test-architect");
const SHA256 = /^[0-9a-f]{64}$/u;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function copyAuthorityFixture(temp) {
  fs.mkdirSync(path.join(temp, "specialist-blocks"), {recursive: true});
  fs.cpSync(path.join(ROOT, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(PACKAGE, path.join(temp, "specialist-blocks/wave-04/test-architect"), {recursive: true});
  fs.cpSync(path.join(ROOT, "specialist-blocks/standards/nist-ssdf"), path.join(temp, "specialist-blocks/standards/nist-ssdf"), {recursive: true});
  fs.cpSync(path.join(ROOT, "specialist-blocks/registry"), path.join(temp, "specialist-blocks/registry"), {recursive: true});
  fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures/model-policy-snapshot.initial.v1.json"));
  fs.cpSync(path.join(ROOT, "fixtures/model-policy-evidence"), path.join(temp, "fixtures/model-policy-evidence"), {recursive: true});
}

function assertBoundaryShape(result, expected) {
  assert.equal(result.schema, TEST_ARCHITECT_RESULT_SCHEMA);
  assert.equal(result.version, 1);
  assert.equal(result.disposition, expected.disposition);
  assert.equal(result.route, expected.route);
  assert.equal(result.error_code, expected.error_code);
  assert(SHA256.test(result.input_sha256));
  assert.equal(result.result_sha256, canonicalDigest({...result, result_sha256: null}));
  assert.equal(result.acceptance_allowed, false);
  assert.equal(result.test_execution_allowed, false);
  assert.equal(result.test_plan_mutation_allowed, false);
  assert.equal(result.memory_write_allowed, false);
  assert(Object.values(result.external_side_effects).every((value) => value === 0));
}

const authority = resolveTestArchitectCanonicalAuthority();
const packageEvaluation = await evaluateTestArchitectPackage();
assert.equal(packageEvaluation.status, "PASS");
assert.equal(packageEvaluation.fixture_results.length, 17);
assert.equal(packageEvaluation.gate_execution.length, 12);
assert.equal(packageEvaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(packageEvaluation.independent_signature_required, true);

const routeFixture = readJson(path.join(PACKAGE, "fixtures/narrowness.json"));
assert.equal(routeFixture.vector.input.schema, TEST_ARCHITECT_INPUT_SCHEMA);
const routed = evaluateTestArchitectBoundary(routeFixture.vector.input);
assertBoundaryShape(routed, routeFixture.expected);
assert.equal(routed.analysis_allowed, true);
assert.equal(routed.selected_specialist, "specialist.assurance-enterprise.test-architect");
assert.equal(routed.handoff.execution_instruction, false);

const denialFixture = readJson(path.join(PACKAGE, "fixtures/unsafe_action.json"));
const denied = evaluateTestArchitectBoundary(denialFixture.vector.input);
assertBoundaryShape(denied, denialFixture.expected);
assert.equal(denied.analysis_allowed, false);

// A fixture expectation is not authority.  Mutating a committed hostile
// expectation must fail closed in an isolated evaluator, even though the
// mutation is syntactically valid JSON.
const fixtureTemp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-test-architect-fixture-"));
try {
  copyAuthorityFixture(fixtureTemp);
  const target = path.join(fixtureTemp, "specialist-blocks/wave-04/test-architect/fixtures/unsafe_action.json");
  const fixture = readJson(target);
  fixture.expected.disposition = "ROUTE";
  fixture.vector.expected_readback.disposition = "ROUTE";
  fs.writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`);
  const isolated = await import(`${pathToFileURL(path.join(fixtureTemp, "control/test-architect-package-evaluator.mjs")).href}?fixture-claim=${Date.now()}`);
  await assert.rejects(() => isolated.evaluateTestArchitectPackage(), (error) => [
    "TEST_ARCHITECT_FIXTURE_PROVENANCE_INVALID",
    "TEST_ARCHITECT_HOSTILE_RESULT_FAILED",
    "TEST_ARCHITECT_GATE_EXPECTATION_UNBOUND",
  ].includes(error?.code));
} finally {
  fs.rmSync(fixtureTemp, {recursive: true, force: true});
}

// Rehashing a changed model snapshot cannot manufacture canonical authority.
const modelTemp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-test-architect-model-"));
try {
  copyAuthorityFixture(modelTemp);
  const modelPath = path.join(modelTemp, "fixtures/model-policy-snapshot.initial.v1.json");
  const model = readJson(modelPath);
  model.status = "SUPERSEDED";
  model.snapshot_sha256 = canonicalDigest({...model, snapshot_sha256: null});
  fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`);
  const isolated = await import(`${pathToFileURL(path.join(modelTemp, "control/test-architect-boundary-gate.mjs")).href}?model-claim=${Date.now()}`);
  assert.throws(() => isolated.evaluateTestArchitectBoundary(routeFixture.vector.input), (error) => [
    "TEST_ARCHITECT_MODEL_POLICY_PROVENANCE_INVALID",
    "TEST_ARCHITECT_MODEL_ROUTE_SEMANTICS_INVALID",
  ].includes(error?.code));
} finally {
  fs.rmSync(modelTemp, {recursive: true, force: true});
}

// Upstream source bytes are canonical inputs, not caller-authored labels.
const routerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-test-architect-router-"));
try {
  copyAuthorityFixture(routerTemp);
  const routerPath = path.join(routerTemp, "control/assurance-enterprise-router-boundary-gate.mjs");
  const source = fs.readFileSync(routerPath, "utf8");
  assert(source.includes("if (FORBIDDEN_REQUESTS.has(input.request_kind))"));
  fs.writeFileSync(routerPath, source.replace("if (FORBIDDEN_REQUESTS.has(input.request_kind))", "if (false && FORBIDDEN_REQUESTS.has(input.request_kind))"));
  const isolated = await import(`${pathToFileURL(path.join(routerTemp, "control/test-architect-authority-binding.mjs")).href}?router-claim=${Date.now()}`);
  assert.throws(() => isolated.resolveTestArchitectCanonicalAuthority(), (error) => error?.code === "TEST_ARCHITECT_UPSTREAM_ROUTER_PROVENANCE_INVALID");
} finally {
  fs.rmSync(routerTemp, {recursive: true, force: true});
}

// Context and memory bindings are invalidation inputs; changing their bytes
// must close the candidate before a handoff can be reused.
const contextTemp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-test-architect-context-"));
try {
  copyAuthorityFixture(contextTemp);
  const contextPath = path.join(contextTemp, "specialist-blocks/wave-04/test-architect/context-binding.json");
  const context = readJson(contextPath);
  context.memory_write = "ALLOW";
  fs.writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`);
  const isolated = await import(`${pathToFileURL(path.join(contextTemp, "control/test-architect-authority-binding.mjs")).href}?context-claim=${Date.now()}`);
  assert.throws(() => isolated.resolveTestArchitectCanonicalAuthority(), (error) => [
    "TEST_ARCHITECT_CONTEXT_PROVENANCE_INVALID",
    "TEST_ARCHITECT_MEMORY_CUSTODY_INVALID",
  ].includes(error?.code));
} finally {
  fs.rmSync(contextTemp, {recursive: true, force: true});
}

// Rehashed roster bytes still cannot substitute for the canonical roster.
const rosterTemp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-test-architect-roster-"));
try {
  copyAuthorityFixture(rosterTemp);
  const rosterPath = path.join(rosterTemp, "specialist-blocks/registry/agent-roster.v1.json");
  const roster = readJson(rosterPath);
  const entry = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.ASSURANCE_ENTERPRISE_TEST_ARCHITECT");
  entry.deterministic_gates.gates.pop();
  fs.writeFileSync(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);
  const isolated = await import(`${pathToFileURL(path.join(rosterTemp, "control/test-architect-authority-binding.mjs")).href}?roster-claim=${Date.now()}`);
  assert.throws(() => isolated.resolveTestArchitectCanonicalAuthority(), (error) => error?.code === "TEST_ARCHITECT_ROSTER_PROVENANCE_INVALID");
} finally {
  fs.rmSync(rosterTemp, {recursive: true, force: true});
}

console.log(`PASS Test Architecture boundary: ${packageEvaluation.fixture_results.length} executable hostile vectors, ${packageEvaluation.gate_execution.length} deterministic gates, canonical re-resolution, zero side effects, and mutation fail-closed checks`);
