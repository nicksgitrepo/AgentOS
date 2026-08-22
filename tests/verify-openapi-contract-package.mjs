#!/usr/bin/env node

/* Focused deterministic QA for the OpenAPI HTTP Contract candidate. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateOpenApiContractBoundary, OPENAPI_CONTRACT_BOUNDARY_SCHEMA} from "../control/openapi-contract-boundary-gate.mjs";
import {evaluateOpenApiContractPackage} from "../control/openapi-contract-package-evaluator.mjs";
import {openApiContractContextReceiptSha256, resolveOpenApiContractCanonicalAuthority} from "../control/openapi-contract-authority-binding.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-02/openapi-contracts");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertNoPersonalPathLiterals() {
  const slash = String.fromCharCode(47);
  const personalRoots = [`${slash}${String.fromCharCode(85, 115, 101, 114, 115)}${slash}`, `${slash}${String.fromCharCode(104, 111, 109, 101)}${slash}`];
  const files = [
    "control/openapi-contract-boundary-gate.mjs",
    "control/openapi-contract-authority-binding.mjs",
    "control/openapi-contract-package-evaluator.mjs",
    "tests/verify-openapi-contract-package.mjs",
    "schemas/openapi-contract-gate-execution.v1.json",
  ];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.equal(personalRoots.some((prefix) => text.includes(prefix)), false, `${relative} contains a personal filesystem path literal`);
  }
}

const modelPath = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const beforeModel = fs.readFileSync(modelPath);
const authority = resolveOpenApiContractCanonicalAuthority();
assert.equal(authority.status, "BLOCKED_EXACT");
assert.equal(authority.model_policy.code, "POLICY_SNAPSHOT_STALE");
assert.equal(authority.context.memory_binding, "TYPED_CONTEXT_INVALIDATION_V1");
assert.equal(authority.context.receipt_sha256, openApiContractContextReceiptSha256({
  blockSha: authority.candidate.block_sha256,
  sourceManifestSha: authority.candidate.source_manifest_sha256,
  standardBlockSha: authority.standard.block_sha256,
  standardSourceManifestSha: authority.standard.source_manifest_sha256,
  routerFileSha: authority.upstream_router.file_sha256,
  routerResultSha: authority.upstream_router.result_sha256,
  modelSnapshotSha: authority.model_policy.snapshot_sha256,
}));
assert.equal(authority.registry.entry?.stable_agent_id, "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS");
assert.equal(authority.registry.entry?.model_route?.task_class, "NARROW_CODING");

const packageEvaluation = await evaluateOpenApiContractPackage();
assert.equal(packageEvaluation.status, "BLOCKED_EXACT");
assert.equal(packageEvaluation.local_status, "PASS_LOCAL_ONLY");
assert.equal(packageEvaluation.ready_for_admission, false);
assert.equal(packageEvaluation.fixture_results.length, 17);
assert.equal(packageEvaluation.gate_execution.executions.length, 12);
assert.equal(packageEvaluation.mutation_sensitivity.mutation_detected, true);

const fixtureDirectory = path.join(PACKAGE, "fixtures");
for (const name of fs.readdirSync(fixtureDirectory).filter((entry) => entry.endsWith(".json")).sort()) {
  const fixture = readJson(path.join(fixtureDirectory, name));
  assert.equal(fixture.vector.input.schema, OPENAPI_CONTRACT_BOUNDARY_SCHEMA, `${name} input schema is not canonical`);
  const actual = evaluateOpenApiContractBoundary(fixture.vector.input);
  const expected = fixture.vector.expected_readback;
  assert.equal(actual.disposition, expected.disposition, fixture.fixture_id);
  assert.equal(actual.route, expected.route, fixture.fixture_id);
  assert.equal(actual.error_code, expected.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), `${fixture.fixture_id} has a side effect`);
  assert.equal(actual.result_sha256, canonicalDigest({...actual, result_sha256: null}), `${fixture.fixture_id} result digest is not self-consistent`);
}

const routeFixture = readJson(path.join(fixtureDirectory, "routing.json"));
const unknownFieldInput = structuredClone(routeFixture.vector.input);
unknownFieldInput.evidence.unexpected = true;
assert.throws(() => evaluateOpenApiContractBoundary(unknownFieldInput), (error) => error.code === "OPENAPI_CONTRACT_UNKNOWN_FIELD");

const staleFixture = readJson(path.join(fixtureDirectory, "stale_source.json"));
assert.equal(staleFixture.vector.expected_readback.error_code, "OPENAPI_CONTRACT_SOURCE_STALE_OR_UNVERIFIED");
const unsafeFixture = readJson(path.join(fixtureDirectory, "unsafe_action.json"));
assert.equal(unsafeFixture.vector.expected_readback.error_code, "OPENAPI_CONTRACT_OPERATION_FORBIDDEN");
assert.equal(Buffer.compare(beforeModel, fs.readFileSync(modelPath)), 0, "local OpenAPI QA mutated protected model policy");
assertNoPersonalPathLiterals();
process.stdout.write(`${JSON.stringify({status: "PASS_LOCAL_ONLY", protected_dependency: authority.model_policy, hostile_fixtures: 17, deterministic_gates: 12, mutation_detected: true, ready_for_admission: false}, null, 2)}\n`);
