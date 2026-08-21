#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateCloudflareCacheBoundary} from "../control/cloudflare-cache-boundary-gate.mjs";
import {evaluateCloudflareCachePackage} from "../control/cloudflare-cache-package-evaluator.mjs";
import {resolveCloudflareCacheCanonicalAuthority} from "../control/cloudflare-cache-authority-binding.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-02/cloudflare-cache/fixtures");
const authority = resolveCloudflareCacheCanonicalAuthority();
const evaluation = await evaluateCloudflareCachePackage();

assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.block_id, "specialist.platform.cloudflare-cache");
assert.equal(evaluation.package_block_sha256, authority.block_sha256);
assert.equal(evaluation.gate_execution.length, 12);
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.independent_signature_required, true);
for (const item of [...evaluation.gate_execution, ...evaluation.fixture_results]) {
  for (const value of Object.values(item.side_effects ?? item.external_side_effects)) assert.equal(value, 0);
}

const fixtureFiles = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(fixtureFiles.length, 17);
for (const name of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/cloudflare-cache-boundary-gate.mjs#evaluateCloudflareCacheBoundary");
  const actual = evaluateCloudflareCacheBoundary(fixture.vector.input);
  assert.deepEqual({disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, fixture.vector.expected_readback, name);
  assert.equal(actual.acceptance_allowed, false, name);
  assert.equal(actual.cache_mutation_allowed, false, name);
  assert.equal(actual.purge_allowed, false, name);
  assert.equal(actual.deployment_allowed, false, name);
  assert.equal(actual.memory_write_allowed, false, name);
}

const routeInput = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "routing.json"), "utf8")).vector.input;
const notApplicable = evaluateCloudflareCacheBoundary({...routeInput, request_kind: "NOT_APPLICABLE"});
assert.deepEqual({disposition: notApplicable.disposition, route: notApplicable.route, error_code: notApplicable.error_code}, {disposition: "DENY", route: "NO_CLOUDFLARE_CACHE_SCOPE", error_code: "CLOUDFLARE_CACHE_SCOPE_NOT_APPLICABLE"});
const protectedInput = {...routeInput, evidence: {...routeInput.evidence, project_data_present: true}};
assert.equal(evaluateCloudflareCacheBoundary(protectedInput).error_code, "CLOUDFLARE_CACHE_PROTECTED_DATA_FORBIDDEN");
assert.throws(() => evaluateCloudflareCacheBoundary({...routeInput, evidence: {...routeInput.evidence, caller_pass: true}}), /unknown field/iu);

console.log("PASS Cloudflare Cache Rules package: canonical authority, real 12-gate execution, 17 hostile vectors, model/context/source binding, zero side effects, and mutation proof");
