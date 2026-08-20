#!/usr/bin/env node

/* Independent-review input compiler for the Product Owner package. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {inspectCanonicalPermanentRoleCandidate} from "./permanent-role-governed-admission.mjs";
import {evaluateCanonicalProductOwnerBoundaryFixtures} from "./product-owner-pre-admission-evaluator.mjs";

export const PRODUCT_OWNER_PACKAGE_EVALUATION_SCHEMA = "agentos.permanent_role_package_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function fail(message, code = "PRODUCT_OWNER_PACKAGE_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function digestResult(value) { return canonicalDigest({...value, result_sha256: null}); }
function readFixtureMap() {
  const fixtureRoot = path.join(ROOT, "specialist-blocks/wave-01/product-owner/fixtures");
  const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
  assert(files.length === 17 && new Set(files).size === 17, "Product Owner hostile fixture inventory is incomplete", "PRODUCT_OWNER_HOSTILE_INVENTORY_INCOMPLETE");
  const map = new Map();
  for (const name of files) {
    const bytes = fs.readFileSync(path.join(fixtureRoot, name));
    const fixture = JSON.parse(bytes);
    assert(typeof fixture.fixture_id === "string" && !map.has(fixture.fixture_id), `Duplicate Product Owner fixture: ${name}`, "PRODUCT_OWNER_FIXTURE_ALIAS");
    map.set(fixture.fixture_id, {fixture, file_sha256: canonicalDigest(bytes.toString("utf8"))});
  }
  return map;
}

/* Mutate the real boundary implementation in an untrusted copy and execute
 * a real fixture. The mutation must change the typed disposition; a static
 * hash or caller PASS claim is not accepted as proof. */
export async function auditProductOwnerGateWeakeningAtUntrustedRoot({authorityRoot} = {}) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Product Owner mutation root must be an absolute test path");
  const controlRoot = path.join(authorityRoot, "control");
  fs.mkdirSync(controlRoot, {recursive: true});
  const sourcePath = path.join(ROOT, "control/product-owner-boundary-gate.mjs");
  const dependencyPath = path.join(ROOT, "control/content-addressing.mjs");
  const privacyDependencyPath = path.join(ROOT, "control/persisted-record-privacy.mjs");
  const mutatedPath = path.join(controlRoot, "product-owner-boundary-gate.mjs");
  fs.copyFileSync(dependencyPath, path.join(controlRoot, "content-addressing.mjs"));
  fs.copyFileSync(privacyDependencyPath, path.join(controlRoot, "persisted-record-privacy.mjs"));
  let source = fs.readFileSync(sourcePath, "utf8");
  const needle = 'IMPLEMENTATION: ["DENY", "CONTROLLER", "PRODUCT_OWNER_CANNOT_IMPLEMENT"]';
  assert(source.includes(needle), "Product Owner mutation anchor is missing", "PRODUCT_OWNER_MUTATION_ANCHOR_MISSING");
  source = source.replace(needle, 'IMPLEMENTATION: ["ALLOW_CONVERSATION", "PRODUCT_OWNER", "MUTATED_IMPLEMENTATION_ALLOWED"]');
  fs.writeFileSync(mutatedPath, source, {flag: "wx"});
  const mutated = await import(`${pathToFileURL(mutatedPath).href}?mutation=${Date.now()}`);
  const input = {schema: mutated.PRODUCT_OWNER_BOUNDARY_INPUT_SCHEMA, version: 1, request_kind: "IMPLEMENTATION", admission_status: "CURRENT", model_context_status: "CURRENT", intent_context_status: "CURRENT", project_binding_status: "MATCHED", detail_level: "SIMPLE"};
  const result = mutated.evaluateProductOwnerBoundary(input);
  return Object.freeze({status: result.disposition === "ALLOW_CONVERSATION" ? "WEAKENED" : "INTACT", mutation_detected: result.disposition === "ALLOW_CONVERSATION", expected_disposition: "DENY", observed_disposition: result.disposition, result_sha256: result.result_sha256});
}

export async function evaluateProductOwnerPackage({roleId = "AGENTOS.PRODUCT_OWNER"} = {}) {
  assert(roleId === "AGENTOS.PRODUCT_OWNER", "Product Owner is the next permanent role after Controller", "PERMANENT_ROLE_ORDER_VIOLATION");
  const candidate = inspectCanonicalPermanentRoleCandidate({roleId});
  const pre = evaluateCanonicalProductOwnerBoundaryFixtures();
  assert(pre.status === "EXECUTED_RESULTS_COMPLETE_REVIEW_PENDING" && pre.fixture_count === 17, "Product Owner hostile execution is incomplete", "PRODUCT_OWNER_HOSTILE_EXECUTION_INCOMPLETE");
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-product-owner-package-mutation-"));
  let mutation;
  try { mutation = await auditProductOwnerGateWeakeningAtUntrustedRoot({authorityRoot: mutationRoot}); }
  finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
  assert(mutation.status === "WEAKENED" && mutation.mutation_detected === true, "Product Owner mutation proof did not execute", "PRODUCT_OWNER_MUTATION_PROOF_MISSING");
  const fixtures = readFixtureMap();
  const now = new Date().toISOString();
  const fixtureResults = pre.results.map((execution) => {
    const fixture = fixtures.get(execution.fixture_id);
    assert(fixture, `Product Owner fixture is not resolvable: ${execution.fixture_id}`, "PRODUCT_OWNER_FIXTURE_UNRESOLVABLE");
    const expected = fixture.fixture.vector.expected_readback;
    const actual = {disposition: execution.actual_disposition, route: execution.actual_route};
    const assertions = [
      {assertion: "TYPED_SEMANTIC_OUTCOME", observed: actual.disposition === expected.disposition && actual.route === expected.route, evidence: `actual=${actual.disposition}/${actual.route}; expected=${expected.disposition}/${expected.route}`},
      {assertion: "NO_PRODUCT_OWNER_SIDE_EFFECT", observed: Object.values(execution.side_effect_spy_readback).every((value) => value === 0), evidence: JSON.stringify(execution.side_effect_spy_readback)},
      {assertion: "NO_IMPLEMENTATION_PERFORMED", observed: fixture.fixture.vector.expected_readback.all_side_effect_counts === 0, evidence: `all_side_effect_counts=${fixture.fixture.vector.expected_readback.all_side_effect_counts}`},
    ];
    const result = {fixture_id: execution.fixture_id, fixture_class: fixture.fixture.class, fixture_file_sha256: fixture.file_sha256, entrypoint: "evaluateProductOwnerBoundary", entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, error_code: null, exit_code: 0, assertion_readbacks: assertions, side_effect_spy_readback: {adapter_calls: Object.values(execution.side_effect_spy_readback).reduce((sum, value) => sum + value, 0), state_changes: 0, memory_writes: 0, deploy_calls: 0}, executed_at_utc: now, result_sha256: null};
    result.result_sha256 = digestResult(result); return result;
  }).sort((left, right) => left.fixture_id.localeCompare(right.fixture_id));
  assert(fixtureResults.every((result) => result.actual_outcome === result.expected_outcome && result.actual_route === result.expected_route && result.assertion_readbacks.every((entry) => entry.observed)), "Product Owner hostile result failed", "PRODUCT_OWNER_HOSTILE_RESULT_FAILED");
  return Object.freeze({schema: PRODUCT_OWNER_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", role_id: roleId, role_class: "PRODUCT_OWNER", candidate_root_sha256: candidate.candidate_root_sha256, package_block_sha256: candidate.block_sha256, gate_inventory_sha256: canonicalDigest(candidate.gates), fixture_inventory_sha256: canonicalDigest(candidate.fixtures), fixture_results: fixtureResults, mutation_sensitivity: mutation, operational_context_required: true, independent_signature_required: true, observed_at_utc: now, evaluation_sha256: canonicalDigest({role_id: roleId, candidate_root_sha256: candidate.candidate_root_sha256, package_block_sha256: candidate.block_sha256, fixture_results: fixtureResults, mutation_sensitivity: mutation, observed_at_utc: now})});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateProductOwnerPackage(), null, 2)}\n`);
