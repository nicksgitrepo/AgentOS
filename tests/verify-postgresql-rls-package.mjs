#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluatePostgresqlRlsBoundary} from "../control/postgresql-rls-boundary-gate.mjs";
import {evaluatePostgresqlRlsPackage} from "../control/postgresql-rls-package-evaluator.mjs";
import {resolvePostgresqlRlsCanonicalAuthority} from "../control/postgresql-rls-authority-binding.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-02/postgresql-rls/fixtures");
const authority = resolvePostgresqlRlsCanonicalAuthority();
const evaluation = await evaluatePostgresqlRlsPackage();

assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.gate_execution.length, 12);
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);

const sideEffectKeys = [
  "candidate_reads", "source_reads", "protected_data_reads", "tenant_boundary_decisions",
  "policy_mutations", "project_writes", "memory_writes", "credential_accesses", "state_changes",
];
for (const name of fs.readdirSync(fixtureRoot).filter((candidate) => candidate.endsWith(".json")).sort()) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));
  const actual = evaluatePostgresqlRlsBoundary(structuredClone(fixture.vector.input));
  assert.deepEqual({disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, fixture.expected, name);
  assert.deepEqual(actual.external_side_effects, Object.fromEntries(sideEffectKeys.map((key) => [key, 0])), `${name} side effects`);
  assert.equal(actual.result_sha256, canonicalDigest({...actual, result_sha256: null}), `${name} result digest`);
}

const base = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
function expectCode(mutator, code, label) {
  const input = structuredClone(base);
  mutator(input);
  assert.throws(() => evaluatePostgresqlRlsBoundary(input), (error) => error.code === code, label);
}

expectCode((input) => { input.evidence.unknown = true; }, "POSTGRESQL_RLS_UNKNOWN_FIELD", "unknown caller evidence is rejected");
expectCode((input) => { input.evidence.candidate_digest = authority.standard_block_sha256; }, "POSTGRESQL_RLS_CANDIDATE_BINDING_INVALID", "candidate substitution is rejected");
expectCode((input) => { input.evidence.standard_block_sha256 = authority.block_sha256; }, "POSTGRESQL_RLS_STANDARD_BINDING_INVALID", "standard substitution is rejected");
expectCode((input) => { input.evidence.model_route_sha256 = authority.standard_source_manifest_sha256; }, "POSTGRESQL_RLS_MODEL_ROUTE_UNBOUND", "model route substitution is rejected");
expectCode((input) => { input.evidence.context_receipt_sha256 = authority.router_result_sha256; }, "POSTGRESQL_RLS_CONTEXT_RECEIPT_INVALID", "context receipt substitution is rejected");
expectCode((input) => { input.evidence.upstream_router_result_sha256 = authority.context_sha256; }, "POSTGRESQL_RLS_CONTEXT_RECEIPT_INVALID", "upstream router substitution is rejected");
{
  const input = structuredClone(base);
  input.evidence.memory_write_requested = true;
  const actual = evaluatePostgresqlRlsBoundary(input);
  assert.deepEqual({disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, {
    disposition: "DENY", route: "NO_POSTGRESQL_RLS_SIDE_EFFECT", error_code: "POSTGRESQL_RLS_OPERATION_FORBIDDEN",
  });
}

{
  const input = structuredClone(base);
  input.request_kind = "DEPLOY";
  const actual = evaluatePostgresqlRlsBoundary(input);
  assert.deepEqual({disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, {
    disposition: "DENY", route: "NO_POSTGRESQL_RLS_SIDE_EFFECT", error_code: "POSTGRESQL_RLS_OPERATION_FORBIDDEN",
  });
}
{
  const input = structuredClone(base);
  input.evidence.adversarial_flags.stale_source = true;
  const actual = evaluatePostgresqlRlsBoundary(input);
  assert.deepEqual({disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, {
    disposition: "DENY", route: "SOURCE_REFRESH_REQUIRED", error_code: "POSTGRESQL_RLS_SOURCE_STALE_OR_UNVERIFIED",
  });
}
{
  const input = structuredClone(base);
  input.evidence.adversarial_flags.protected_data = true;
  const actual = evaluatePostgresqlRlsBoundary(input);
  assert.deepEqual({disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, {
    disposition: "DENY", route: "PRIVACY_BOUNDARY_REQUIRED", error_code: "POSTGRESQL_RLS_PROTECTED_DATA_FORBIDDEN",
  });
}

const packageText = fs.readFileSync(path.join(root, "specialist-blocks/wave-02/postgresql-rls/block.json"), "utf8");
assert(!/Sociuna|consumer project|\/Users\//u.test(packageText), "package must stay project-agnostic");
console.log("PASS PostgreSQL RLS package: 12 executable gates, 17 hostile vectors, canonical evidence substitution rejection, zero side effects, and weakened-boundary mutation detection");
