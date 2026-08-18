#!/usr/bin/env node

/* Non-authoritative execution of canonical Product Owner boundary fixtures. */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateProductOwnerBoundary} from "./product-owner-boundary-gate.mjs";

export const PRODUCT_OWNER_PRE_ADMISSION_EVALUATION_SCHEMA = "agentos.product_owner_pre_admission_evaluation.v1";
const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-01/product-owner");
function fail(message, code = "PRODUCT_OWNER_PRE_ADMISSION_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function artifact(file) { const target = path.resolve(ROOT, file); assert(target.startsWith(`${ROOT}${path.sep}`), "Evaluation artifact escaped repository"); const stat = fs.lstatSync(target); assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(target) === target, "Evaluation artifact is not a canonical real file"); const bytes = fs.readFileSync(target); return {path: file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes}; }

export function evaluateCanonicalProductOwnerBoundaryFixtures(options = {}) {
  assert(options && typeof options === "object" && Object.keys(options).length === 0, "Product Owner evaluator rejects caller roots, fixtures, expected results, implementations, PASS claims, and adapters");
  const fixtureNames = fs.readdirSync(path.join(PACKAGE, "fixtures")).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(fixtureNames.length === 17 && new Set(fixtureNames).size === 17, "Product Owner fixture inventory differs");
  const spies = {implementation: 0, workflow: 0, lifecycle: 0, deployment: 0, memory: 0, model: 0, acceptance: 0};
  const adapters = new Proxy({}, {get(_target, key) { if (key in spies) return () => { spies[key] += 1; throw new Error(`Forbidden Product Owner side effect: ${String(key)}`); }; return undefined; }});
  const results = fixtureNames.map((name) => {
    const file = artifact(`specialist-blocks/wave-01/product-owner/fixtures/${name}`), fixture = JSON.parse(file.bytes.toString("utf8"));
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === "specialist.control.product-owner" && fixture.hostile === true, `Fixture ${name} identity differs`);
    assert(typeof fixture.fixture_id === "string" && fixture.vector?.entrypoint === "evaluateProductOwnerBoundary" && fixture.vector.expected_readback, `Fixture ${name} is not a typed operational vector`);
    // Adapters are deliberately made available to the evaluator scope. The
    // production gate has no adapter parameter and therefore cannot invoke or
    // widen them; the concrete counters prove that property for each run.
    const actual = evaluateProductOwnerBoundary(fixture.vector.input, adapters), expected = fixture.vector.expected_readback;
    const zero = Object.values(spies).every((count) => count === 0) && [actual.workflow_mutations, actual.lifecycle_mutations, actual.deployment_calls, actual.memory_writes, actual.model_overrides, actual.acceptance_mutations].every((count) => count === 0) && actual.implementation_performed === false;
    const matched = actual.disposition === expected.disposition && actual.route === expected.route && expected.all_side_effect_counts === 0 && zero;
    return Object.freeze({fixture_id: fixture.fixture_id, class: fixture.class, fixture_file_sha256: file.sha256, input_sha256: canonicalDigest(fixture.vector.input), expected: Object.freeze(expected), actual_disposition: actual.disposition, actual_route: actual.route, result_sha256: actual.result_sha256, side_effect_spy_readback: Object.freeze({...spies}), outcome: matched ? "EXPECTED_OUTCOME_OBSERVED" : "MISMATCH"});
  });
  assert(new Set(results.map((item) => item.fixture_id)).size === results.length && new Set(results.map((item) => item.class)).size === results.length, "Product Owner fixture identities/classes are duplicated");
  const implementation = artifact("control/product-owner-boundary-gate.mjs"), operational = artifact("control/product-owner-operational.mjs"), block = artifact("specialist-blocks/wave-01/product-owner/block.json");
  const implementationBindingSha256 = canonicalDigest({entrypoint: "evaluateProductOwnerBoundary", implementation_sha256: implementation.sha256, operational_adapter_sha256: operational.sha256});
  const candidateSha256 = canonicalDigest({block_file_sha256: block.sha256, implementation_binding_sha256: implementationBindingSha256, fixtures: results.map((item) => ({fixture_id: item.fixture_id, file_sha256: item.fixture_file_sha256, result_sha256: item.result_sha256}))});
  return Object.freeze({schema: PRODUCT_OWNER_PRE_ADMISSION_EVALUATION_SCHEMA, version: 1, authority_status: "NON_AUTHORITATIVE_PRE_ADMISSION_EVIDENCE", status: results.every((item) => item.outcome === "EXPECTED_OUTCOME_OBSERVED") ? "EXECUTED_RESULTS_COMPLETE_REVIEW_PENDING" : "FIXTURE_MISMATCH", block_id: "specialist.control.product-owner", entrypoint: "evaluateProductOwnerBoundary", implementation_file_sha256: implementation.sha256, operational_adapter_file_sha256: operational.sha256, implementation_binding_sha256: implementationBindingSha256, candidate_sha256: candidateSha256, fixture_count: results.length, results: Object.freeze(results), independent_admission: "PENDING_SEPARATE_EVALUATOR", activation: "OFF"});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(evaluateCanonicalProductOwnerBoundaryFixtures(), null, 2)}\n`);
