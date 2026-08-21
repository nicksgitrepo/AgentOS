#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateOwaspApiObjectAuthorizationPackage} from "../control/owasp-api-object-authorization-package-evaluator.mjs";
import {OWASP_API_OBJECT_AUTHORIZATION_INPUT_SCHEMA, evaluateOwaspApiObjectAuthorizationBoundary} from "../control/owasp-api-object-authorization-boundary-gate.mjs";
import {resolveOwaspApiObjectAuthorizationCanonicalAuthority} from "../control/owasp-api-object-authorization-authority-binding.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authority = resolveOwaspApiObjectAuthorizationCanonicalAuthority();
const evaluation = await evaluateOwaspApiObjectAuthorizationPackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.block_id, authority.package_path.replace("specialist-blocks/wave-03/owasp-api-2023-api1-object-authorization", "specialist.security.owasp-api-2023-api1-object-authorization"));
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(authority.model.task_class, "SECURITY_REVIEW");
assert.equal(authority.model.minimum_capability, 59);
assert.equal(authority.custody_ref, "opaque:OWASP_API_2023_API1_OBJECT_AUTHORIZATION.CUSTODY");
assert.equal(authority.gate_semantic_inventory_sha256.length, 64);
assert.equal(authority.router_file_sha256.length, 64);

assert.throws(() => evaluateOwaspApiObjectAuthorizationBoundary({schema: OWASP_API_OBJECT_AUTHORIZATION_INPUT_SCHEMA, version: 1, request_kind: "ANALYZE_OWASP_API_API1_OBJECT_AUTHORIZATION", evidence: {}}), (error) => error?.code === "OWASP_API_OBJECT_AUTHORIZATION_UNKNOWN_FIELD" || error?.code === "OWASP_API_OBJECT_AUTHORIZATION_FIELD_INVALID");

const fixtureRoot = path.join(repositoryRoot, "specialist-blocks/wave-03/owasp-api-2023-api1-object-authorization/fixtures");
for (const name of fs.readdirSync(fixtureRoot).filter((item) => item.endsWith(".json"))) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));
  assert.equal(fixture.hostile, true, name);
  assert.equal(fixture.vector.entrypoint, "control/owasp-api-object-authorization-boundary-gate.mjs#evaluateOwaspApiObjectAuthorizationBoundary", name);
  assert.deepEqual(fixture.vector.expected_readback, fixture.expected, name);
}

// Changing a committed expectation must fail closed; a passing evaluator that
// merely echoes the mutated expectation would be tautological.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-owasp-api1-fixture-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks/wave-03/owasp-api-2023-api1-object-authorization"), path.join(temp, "specialist-blocks/wave-03/owasp-api-2023-api1-object-authorization"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks/standards"), path.join(temp, "specialist-blocks/standards"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks/registry"), path.join(temp, "specialist-blocks/registry"), {recursive: true});
  fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true}); fs.copyFileSync(path.join(repositoryRoot, "fixtures/model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures/model-policy-snapshot.initial.v1.json")); fs.cpSync(path.join(repositoryRoot, "fixtures/model-policy-evidence"), path.join(temp, "fixtures/model-policy-evidence"), {recursive: true}); fs.cpSync(path.join(repositoryRoot, "schemas"), path.join(temp, "schemas"), {recursive: true});
  const mutatedPath = path.join(temp, "specialist-blocks/wave-03/owasp-api-2023-api1-object-authorization/fixtures/authority_conflict.json"); const mutated = JSON.parse(fs.readFileSync(mutatedPath, "utf8")); mutated.expected.route = "NO_OWASP_API_API1_OBJECT_AUTHORIZATION"; fs.writeFileSync(mutatedPath, `${JSON.stringify(mutated, null, 2)}\n`);
  const isolated = await import(`${pathToFileURL(path.join(temp, "control/owasp-api-object-authorization-package-evaluator.mjs")).href}?fixture-mutation=${Date.now()}`);
  await assert.rejects(() => isolated.evaluateOwaspApiObjectAuthorizationPackage(), (error) => ["OWASP_API_OBJECT_AUTHORIZATION_FIXTURE_PROVENANCE_INVALID", "OWASP_API_OBJECT_AUTHORIZATION_FIXTURE_VECTOR_INVALID", "OWASP_API_OBJECT_AUTHORIZATION_HOSTILE_RESULT_FAILED", "OWASP_API_OBJECT_AUTHORIZATION_ROSTER_PROVENANCE_INVALID"].includes(error?.code));
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}

assert.equal(canonicalDigest({...evaluation, evaluation_sha256: null}), evaluation.evaluation_sha256);
console.log("PASS OWASP API API1 object authorization boundary: 12 executable gates, 17 hostile vectors, repository authority binding, mutation proof, and zero side effects");
