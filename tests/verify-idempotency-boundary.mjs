#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateIdempotencyBoundary, IDEMPOTENCY_INPUT_SCHEMA, IDEMPOTENCY_RESULT_SCHEMA} from "../control/idempotency-boundary-gate.mjs";
import {evaluateIdempotencyPackage} from "../control/idempotency-package-evaluator.mjs";
import {resolveIdempotencyCanonicalAuthority} from "../control/idempotency-authority-binding.mjs";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(repositoryRoot, "specialist-blocks/wave-03/idempotency/fixtures");
const zeroEffects = {
  idempotency_record_reads: 0, idempotency_store_reads: 0, source_reads: 0, concurrency_checks: 0,
  duplicate_decisions: 0, submission_writes: 0, replay_mutations: 0, memory_writes: 0,
  acceptance_calls: 0, credential_accesses: 0, state_changes: 0,
};

const authority = resolveIdempotencyCanonicalAuthority();
const evaluation = await evaluateIdempotencyPackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.gate_execution.length, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");

const fixtureFiles = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(fixtureFiles.length, 17);
for (const name of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/idempotency-boundary-gate.mjs#evaluateIdempotencyBoundary");
  assert.equal(fixture.vector.input.schema, IDEMPOTENCY_INPUT_SCHEMA);
  const actual = evaluateIdempotencyBoundary(fixture.vector.input);
  assert.equal(actual.schema, IDEMPOTENCY_RESULT_SCHEMA, fixture.fixture_id);
  assert.deepEqual({disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, fixture.vector.expected_readback, fixture.fixture_id);
  assert.equal(actual.result_sha256, canonicalDigest({...actual, result_sha256: null}), fixture.fixture_id);
  assert.deepEqual(actual.external_side_effects, zeroEffects, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.equal(actual.authorization_decision_allowed, false, fixture.fixture_id);
  assert.equal(actual.policy_mutation_allowed, false, fixture.fixture_id);
  assert.equal(actual.submission_mutation_allowed, false, fixture.fixture_id);
  assert.equal(actual.replay_mutation_allowed, false, fixture.fixture_id);
  assert.equal(actual.memory_write_allowed, false, fixture.fixture_id);
}

const valid = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
const substitutionDigest = canonicalDigest("caller-substitution");
assert.throws(() => evaluateIdempotencyBoundary({...valid, evidence: {...valid.evidence, caller_authority: authority.block_sha256}}), (error) => error?.code === "IDEMPOTENCY_UNKNOWN_FIELD");
assert.throws(() => evaluateIdempotencyBoundary({...valid, evidence: {...valid.evidence, candidate_digest: substitutionDigest, idempotency_key: substitutionDigest}}), (error) => error?.code === "IDEMPOTENCY_CANDIDATE_BINDING_INVALID");
assert.throws(() => evaluateIdempotencyBoundary({...valid, evidence: {...valid.evidence, standard_block_sha256: substitutionDigest}}), (error) => error?.code === "IDEMPOTENCY_STANDARD_BINDING_INVALID");
assert.throws(() => evaluateIdempotencyBoundary({...valid, evidence: {...valid.evidence, model_route_sha256: substitutionDigest}}), (error) => error?.code === "IDEMPOTENCY_MODEL_ROUTE_UNBOUND");
assert.throws(() => evaluateIdempotencyBoundary({...valid, evidence: {...valid.evidence, context_receipt_sha256: substitutionDigest}}), (error) => error?.code === "IDEMPOTENCY_CONTEXT_RECEIPT_INVALID");
assert.throws(() => evaluateIdempotencyBoundary({...valid, evidence: {...valid.evidence, upstream_router_result_sha256: substitutionDigest}}), (error) => error?.code === "IDEMPOTENCY_CONTEXT_RECEIPT_INVALID");
assert.throws(() => evaluateIdempotencyBoundary({...valid, evidence: {...valid.evidence, idempotency_key: substitutionDigest}}), (error) => error?.code === "IDEMPOTENCY_KEY_BINDING_INVALID");
const forbidden = evaluateIdempotencyBoundary({...valid, request_kind: "DEPLOY"});
assert.equal(forbidden.disposition, "DENY");
assert.equal(forbidden.error_code, "IDEMPOTENCY_OPERATION_FORBIDDEN");
assert.deepEqual(forbidden.external_side_effects, zeroEffects);

function copyAuthorityFixture(prefix) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "idempotency"), path.join(temp, "specialist-blocks", "wave-03", "idempotency"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards", "owasp-asvs"), path.join(temp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
  fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json"));
  fs.cpSync(path.join(repositoryRoot, "fixtures", "model-policy-evidence"), path.join(temp, "fixtures", "model-policy-evidence"), {recursive: true});
  return temp;
}

const modelTemp = copyAuthorityFixture("agentos-idempotency-model-substitution-");
try {
  const modelPath = path.join(modelTemp, "fixtures/model-policy-snapshot.initial.v1.json");
  const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
  model.status = "SUPERSEDED";
  model.snapshot_sha256 = canonicalDigest({...model, snapshot_sha256: null});
  fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`);
  const isolated = await import(`${pathToFileURL(path.join(modelTemp, "control/idempotency-authority-binding.mjs")).href}?model-substitution=${Date.now()}`);
  assert.throws(() => isolated.resolveIdempotencyCanonicalAuthority(), (error) => ["IDEMPOTENCY_CANONICAL_PROVENANCE_INVALID", "IDEMPOTENCY_MODEL_POLICY_PROVENANCE_INVALID", "IDEMPOTENCY_MODEL_ROUTE_INVALID"].includes(error?.code));
} finally {
  fs.rmSync(modelTemp, {recursive: true, force: true});
}

const routerTemp = copyAuthorityFixture("agentos-idempotency-router-substitution-");
try {
  const routerPath = path.join(routerTemp, "control/access-control-router-boundary-gate.mjs");
  fs.appendFileSync(routerPath, "\n// hostile source substitution\n");
  const isolated = await import(`${pathToFileURL(path.join(routerTemp, "control/idempotency-authority-binding.mjs")).href}?router-substitution=${Date.now()}`);
  assert.throws(() => isolated.resolveIdempotencyCanonicalAuthority(), (error) => error?.code === "IDEMPOTENCY_CANONICAL_PROVENANCE_INVALID");
} finally {
  fs.rmSync(routerTemp, {recursive: true, force: true});
}

console.log("PASS Idempotency boundary: 17 executable hostile vectors, caller-substitution denials, mutation proof, model/router provenance, and zero side effects");
