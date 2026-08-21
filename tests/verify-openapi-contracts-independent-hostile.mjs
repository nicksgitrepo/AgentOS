#!/usr/bin/env node

/* Independent read-only hostile harness: execute real vectors through the public boundary. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateOpenApiContractsBoundary, OPENAPI_CONTRACTS_RESULT_SCHEMA} from "../control/openapi-contracts-boundary-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "specialist-blocks/wave-02/openapi-contracts/operational-fixtures");
assert.equal(typeof require, "undefined", "independent hostile harness must remain ESM-safe");
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
const expectedClasses = [
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority",
  "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion",
  "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action",
].sort();
assert.deepEqual(files.map((name) => name.replace(/\.json$/u, "")).sort(), expectedClasses, "operational fixture inventory is not unique and complete");

const seenIds = new Set();
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/openapi-contracts-boundary-gate.mjs#evaluateOpenApiContractsBoundary", file);
  assert.equal(fixture.vector.input.schema, "agentos.openapi_contracts_boundary_input.v1", file);
  assert.equal(fixture.vector.input.version, 1, file);
  assert(!seenIds.has(fixture.fixture_id), `duplicate fixture id: ${fixture.fixture_id}`);
  seenIds.add(fixture.fixture_id);

  const actual = evaluateOpenApiContractsBoundary(fixture.vector.input);
  const expected = fixture.vector.expected_readback;
  assert.equal(actual.schema, OPENAPI_CONTRACTS_RESULT_SCHEMA, file);
  assert.deepEqual(
    {disposition: actual.disposition, route: actual.route, error_code: actual.error_code},
    expected,
    `public entrypoint result mismatch: ${file}`,
  );
  assert.equal(actual.input_sha256, canonicalDigest(fixture.vector.input), `input digest mismatch: ${file}`);
  assert.equal(actual.result_sha256, canonicalDigest({...actual, result_sha256: null}), `result digest mismatch: ${file}`);
  assert.equal(actual.acceptance_allowed, false, file);
  assert.equal(actual.implementation_selection_allowed, false, file);
  assert.equal(actual.lifecycle_mutation_allowed, false, file);
  for (const [key, value] of Object.entries(actual.external_side_effects)) assert.equal(value, 0, `${file}: side effect ${key}`);
}

assert.equal(seenIds.size, files.length);
console.log(`PASS independent OpenAPI hostile harness: ${files.length} unique operational fixtures executed through the public entrypoint with zero side effects`);
