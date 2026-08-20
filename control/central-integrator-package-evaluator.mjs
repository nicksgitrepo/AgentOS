#!/usr/bin/env node

/* Operational evaluator for the Central Integrator candidate.  It resolves
 * real package bytes, executes every bound hostile vector through the real
 * boundary, and proves that weakening a forbidden branch changes the result.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateCentralIntegratorBoundary, CENTRAL_INTEGRATOR_BOUNDARY_SCHEMA} from "./central-integrator-boundary-gate.mjs";

export const CENTRAL_INTEGRATOR_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_central_integrator_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-04/central-integrator";
const BLOCK_ID = "specialist.control.central-integrator";
const FIXTURE_CLASSES = ["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fail(message, code = "CENTRAL_INTEGRATOR_PACKAGE_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function readBytes(file) { assert(fs.existsSync(file), `${file} is missing`, "CENTRAL_INTEGRATOR_PACKAGE_FILE_MISSING"); return fs.readFileSync(file); }
function readJson(file) { return JSON.parse(readBytes(file)); }
function resultDigest(value) { return canonicalDigest({...value, result_sha256: null}); }
function packageFiles(packageRoot) { const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"]; for (const name of fs.readdirSync(path.join(packageRoot, "gates")).filter((entry) => entry.endsWith(".gate"))) files.push(`gates/${name}`); for (const name of fs.readdirSync(path.join(packageRoot, "fixtures")).filter((entry) => entry.endsWith(".json"))) files.push(`fixtures/${name}`); return files.sort(); }
function fixtureMap(packageRoot) {
  const fixtureRoot = path.join(packageRoot, "fixtures"); const names = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === FIXTURE_CLASSES.length && new Set(names).size === FIXTURE_CLASSES.length, "Central Integrator fixture inventory is not exact", "CENTRAL_INTEGRATOR_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const bytes = readBytes(path.join(fixtureRoot, name)); const fixture = JSON.parse(bytes);
    assert(fixture.block_id === BLOCK_ID && typeof fixture.fixture_id === "string", `Central Integrator fixture ${name} identity is invalid`, "CENTRAL_INTEGRATOR_FIXTURE_ID_INVALID");
    assert(fixture.vector?.entrypoint === "control/central-integrator-boundary-gate.mjs#evaluateCentralIntegratorBoundary", `Central Integrator fixture ${name} is not bound to the real entrypoint`, "CENTRAL_INTEGRATOR_FIXTURE_UNBOUND");
    assert(fixture.vector.input?.schema === CENTRAL_INTEGRATOR_BOUNDARY_SCHEMA, `Central Integrator fixture ${name} schema mismatch`, "CENTRAL_INTEGRATOR_FIXTURE_INPUT_INVALID");
    assert(fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `Central Integrator fixture ${name} lacks typed expectation`, "CENTRAL_INTEGRATOR_FIXTURE_EXPECTATION_INVALID");
    assert(!map.has(fixture.fixture_id), `Duplicate Central Integrator fixture ${name}`, "CENTRAL_INTEGRATOR_FIXTURE_ALIAS"); map.set(fixture.fixture_id, {fixture, file_sha256: sha256(bytes)});
  }
  assert([...map.values()].map(({fixture}) => fixture.class).sort().join("\0") === FIXTURE_CLASSES.slice().sort().join("\0"), "Central Integrator fixture classes do not match the canonical inventory", "CENTRAL_INTEGRATOR_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
async function mutation(fixture) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-central-integrator-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "central-integrator-boundary-gate.mjs"); let source = fs.readFileSync(path.join(ROOT, "control/central-integrator-boundary-gate.mjs"), "utf8");
    const anchor = 'return result("DENY", "NO_INTEGRATION_SIDE_EFFECT", "CENTRAL_INTEGRATOR_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Central Integrator mutation anchor is missing", "CENTRAL_INTEGRATOR_MUTATION_ANCHOR_MISSING"); source = source.replace(anchor, 'return result("ROUTE", "CONTROLLER_INTEGRATION_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed:true, selected_owner:"AGENTOS_CONTROLLER"});'); fs.writeFileSync(target, source, {flag: "wx"});
    const mutated = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`); const observed = mutated.evaluateCentralIntegratorBoundary(fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export async function evaluateCentralIntegratorPackage() {
  const packageRoot = path.join(ROOT, PACKAGE_RELATIVE); const block = readJson(path.join(packageRoot, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Central Integrator package is not an inactive candidate", "CENTRAL_INTEGRATOR_PACKAGE_STATE_INVALID");
  const files = packageFiles(packageRoot); const digests = files.map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: sha256(readBytes(path.join(packageRoot, relativePath)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Central Integrator gate inventory is incomplete", "CENTRAL_INTEGRATOR_GATE_INVENTORY_INVALID");
  const fixtures = fixtureMap(packageRoot); const results = [];
  for (const {fixture, file_sha256} of [...fixtures.values()].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id))) {
    const expected = fixture.vector.expected_readback; let actual;
    try { actual = evaluateCentralIntegratorBoundary(fixture.vector.input); } catch (error) { fail(`${fixture.fixture_id} execution failed: ${error.code ?? error.message}`, "CENTRAL_INTEGRATOR_HOSTILE_EXECUTION_FAILED"); }
    const sideEffectsZero = Object.values(actual.external_side_effects).every((value) => value === 0);
    const assertionReadbacks = [
      {assertion: "TYPED_DISPOSITION", observed: actual.disposition === expected.disposition, evidence: `actual=${actual.disposition}; expected=${expected.disposition}`},
      {assertion: "TYPED_ROUTE", observed: actual.route === expected.route, evidence: `actual=${actual.route}; expected=${expected.route}`},
      {assertion: "TYPED_ERROR", observed: actual.error_code === expected.error_code, evidence: `actual=${actual.error_code}; expected=${expected.error_code}`},
      {assertion: "NO_INTEGRATION_SIDE_EFFECT", observed: sideEffectsZero, evidence: JSON.stringify(actual.external_side_effects)},
      {assertion: "ACCEPTANCE_REMAINS_FORBIDDEN", observed: actual.acceptance_allowed === false, evidence: `acceptance_allowed=${actual.acceptance_allowed}`},
    ];
    assert(assertionReadbacks.every((entry) => entry.observed), `${fixture.fixture_id} hostile result failed`, "CENTRAL_INTEGRATOR_HOSTILE_RESULT_FAILED");
    const record = {fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, assertion_readbacks: assertionReadbacks, external_side_effects: actual.external_side_effects, result_sha256: null}; record.result_sha256 = resultDigest(record); results.push(record);
  }
  const mutationSensitivity = await mutation(readJson(path.join(packageRoot, "fixtures/unsafe_action.json"))); assert(mutationSensitivity.status === "WEAKENED" && mutationSensitivity.mutation_detected, "Central Integrator mutation proof did not execute", "CENTRAL_INTEGRATOR_MUTATION_PROOF_MISSING");
  const evaluation = {schema: CENTRAL_INTEGRATOR_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, mutation_sensitivity: mutationSensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null}; evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateCentralIntegratorPackage(), null, 2)}\n`);
