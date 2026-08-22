#!/usr/bin/env node

/* Canonical, read-only verifier for the OWASP API1 object-authorization package. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {
  evaluateOwaspApiObjectAuthorizationBoundary,
  OWASP_API_OBJECT_AUTHORIZATION_INPUT_SCHEMA,
  OWASP_API_OBJECT_AUTHORIZATION_RESULT_SCHEMA,
} from "../control/owasp-api-2023-api1-object-authorization-boundary-gate.mjs";
import {
  buildOwaspApiObjectAuthorizationInput,
  evaluateOwaspApiObjectAuthorizationPackage,
} from "../control/owasp-api-2023-api1-object-authorization-package-evaluator.mjs";
import {resolveOwaspApiObjectAuthorizationCanonicalAuthority} from "../control/owasp-api-2023-api1-object-authorization-authority-binding.mjs";

const evaluation = await evaluateOwaspApiObjectAuthorizationPackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.gate_execution.length, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.deepEqual(evaluation.scope_fail_closed, {
  tenant_scope: {status: "DENY", error_code: "OWASP_API_OBJECT_AUTHORIZATION_TENANT_SCOPE_REQUIRED"},
  object_scope: {status: "DENY", error_code: "OWASP_API_OBJECT_AUTHORIZATION_OBJECT_SCOPE_REQUIRED"},
});
assert.deepEqual(evaluation.backend_evidence_guard, {
  status: "DENY",
  error_code: "OWASP_API_OBJECT_AUTHORIZATION_BACKEND_EVIDENCE_FORBIDDEN",
  fabricated_backend_evidence_allowed: false,
});

const authority = resolveOwaspApiObjectAuthorizationCanonicalAuthority();
const input = buildOwaspApiObjectAuthorizationInput(authority.block_sha256, authority);
assert.equal(input.schema, OWASP_API_OBJECT_AUTHORIZATION_INPUT_SCHEMA);
assert.equal(input.evidence.backend_evidence_status, "NOT_PROVIDED");
assert.equal(input.evidence.backend_evidence_digest, null);
const routed = evaluateOwaspApiObjectAuthorizationBoundary(input);
assert.equal(routed.schema, OWASP_API_OBJECT_AUTHORIZATION_RESULT_SCHEMA);
assert.equal(routed.disposition, "ROUTE");
assert.equal(routed.route, "OWASP_API_API1_OBJECT_AUTHORIZATION_ANALYSIS_HANDOFF");
assert.equal(routed.analysis_allowed, true);
assert.equal(routed.acceptance_allowed, false);
assert.equal(routed.authorization_decision_allowed, false);
assert.equal(routed.policy_mutation_allowed, false);
assert.deepEqual(Object.values(routed.external_side_effects), [0, 0, 0, 0, 0, 0, 0, 0, 0]);

for (const [field, errorCode] of [
  ["tenant_scope_status", "OWASP_API_OBJECT_AUTHORIZATION_TENANT_SCOPE_REQUIRED"],
  ["object_scope_status", "OWASP_API_OBJECT_AUTHORIZATION_OBJECT_SCOPE_REQUIRED"],
]) {
  const missing = structuredClone(input);
  missing.evidence[field] = "MISSING";
  const result = evaluateOwaspApiObjectAuthorizationBoundary(missing);
  assert.equal(result.disposition, "DENY");
  assert.equal(result.error_code, errorCode);
}

const claimedBackend = structuredClone(input);
claimedBackend.evidence.backend_evidence_status = "CLAIMED";
claimedBackend.evidence.backend_evidence_claimed = true;
const backendResult = evaluateOwaspApiObjectAuthorizationBoundary(claimedBackend);
assert.equal(backendResult.disposition, "DENY");
assert.equal(backendResult.error_code, "OWASP_API_OBJECT_AUTHORIZATION_BACKEND_EVIDENCE_FORBIDDEN");

const writeAuditor = structuredClone(input);
writeAuditor.evidence.auditor_write_allowed = true;
const auditorResult = evaluateOwaspApiObjectAuthorizationBoundary(writeAuditor);
assert.equal(auditorResult.disposition, "DENY");
assert.equal(auditorResult.error_code, "OWASP_API_OBJECT_AUTHORIZATION_AUDITOR_CUSTODY_INVALID");

// The evaluator must use committed fixture expectations, not echo whatever the
// implementation happens to return. Mutating one expected route in an
// isolated copy must therefore fail the verifier.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-owasp-api1-object-authorization-fixture-mutation-"));
try {
  fs.cpSync(path.join(repositoryRoot, "control"), path.join(temp, "control"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "wave-03", "owasp-api-2023-api1-object-authorization"), path.join(temp, "specialist-blocks", "wave-03", "owasp-api-2023-api1-object-authorization"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "standards"), path.join(temp, "specialist-blocks", "standards"), {recursive: true});
  fs.cpSync(path.join(repositoryRoot, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
  fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
  fs.copyFileSync(path.join(repositoryRoot, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json"));
  const mutatedFixture = path.join(temp, "specialist-blocks", "wave-03", "owasp-api-2023-api1-object-authorization", "fixtures", "authority_conflict.json");
  const fixture = JSON.parse(fs.readFileSync(mutatedFixture, "utf8"));
  fixture.expected.route = "NO_OWASP_API_OBJECT_AUTHORIZATION";
  fs.writeFileSync(mutatedFixture, `${JSON.stringify(fixture, null, 2)}\n`);
  const isolatedEvaluator = await import(`${pathToFileURL(path.join(temp, "control", "owasp-api-2023-api1-object-authorization-package-evaluator.mjs")).href}?fixture-mutation=${Date.now()}`);
  await assert.rejects(
    () => isolatedEvaluator.evaluateOwaspApiObjectAuthorizationPackage(),
    (error) => [
      "OWASP_API_OBJECT_AUTHORIZATION_FIXTURE_VECTOR_INVALID",
      "OWASP_API_OBJECT_AUTHORIZATION_HOSTILE_RESULT_FAILED",
    ].includes(error?.code),
  );
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}

console.log("PASS OWASP API1 object authorization: canonical authority, 12 executable gates, 17 hostile vectors, read-only custody, fail-closed tenant/object scope, backend-evidence guard, mutation proof, and zero side effects");
