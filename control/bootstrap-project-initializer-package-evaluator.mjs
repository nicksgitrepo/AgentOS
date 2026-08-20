#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateBootstrapProjectInitializerBoundary, BOOTSTRAP_PROJECT_INITIALIZER_BOUNDARY_SCHEMA} from "./bootstrap-project-initializer-boundary-gate.mjs";

export const BOOTSTRAP_PROJECT_INITIALIZER_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_bootstrap_project_initializer_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-01/agent-bootstrap";
const BLOCK_ID = "specialist.control.bootstrap-project-initializer";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message, code = "BOOTSTRAP_PROJECT_INITIALIZER_PACKAGE_EVALUATION_INVALID") => { const error = new Error(message); error.code = code; throw error; };
const assert = (condition, message, code) => { if (!condition) fail(message, code); };
const read = (file) => { assert(fs.existsSync(file), `${file} is missing`, "BOOTSTRAP_PROJECT_INITIALIZER_PACKAGE_FILE_MISSING"); return fs.readFileSync(file); };
const readJson = (file) => JSON.parse(read(file));
const resultDigest = (value) => canonicalDigest({...value, result_sha256: null});

function packageFiles(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((item) => item.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((item) => item.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}

function fixtureMap(classes) {
  const root = path.join(ROOT, PACKAGE_RELATIVE);
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === classes.length && new Set(names).size === classes.length, "Bootstrap initializer fixture inventory is not exact", "BOOTSTRAP_PROJECT_INITIALIZER_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const bytes = read(path.join(root, "fixtures", name));
    const fixture = JSON.parse(bytes);
    assert(fixture.block_id === BLOCK_ID && typeof fixture.fixture_id === "string", `Fixture ${name} identity is invalid`, "BOOTSTRAP_PROJECT_INITIALIZER_FIXTURE_ID_INVALID");
    assert(fixture.vector?.entrypoint === "control/bootstrap-project-initializer-boundary-gate.mjs#evaluateBootstrapProjectInitializerBoundary", `Fixture ${name} is not operational`, "BOOTSTRAP_PROJECT_INITIALIZER_FIXTURE_UNBOUND");
    assert(fixture.vector.input?.schema === BOOTSTRAP_PROJECT_INITIALIZER_BOUNDARY_SCHEMA, `Fixture ${name} input schema mismatch`, "BOOTSTRAP_PROJECT_INITIALIZER_FIXTURE_INPUT_INVALID");
    assert(fixture.expected_readback?.disposition && fixture.expected_readback?.route && fixture.expected_readback?.error_code, `Fixture ${name} expectation is incomplete`, "BOOTSTRAP_PROJECT_INITIALIZER_FIXTURE_EXPECTATION_INVALID");
    assert(!map.has(fixture.fixture_id), `Duplicate fixture ${name}`, "BOOTSTRAP_PROJECT_INITIALIZER_FIXTURE_ALIAS");
    map.set(fixture.fixture_id, {fixture, file_sha256: sha(bytes)});
  }
  assert([...map.values()].map((entry) => entry.fixture.class).sort().join("\0") === classes.slice().sort().join("\0"), "Bootstrap initializer fixture classes do not match inventory", "BOOTSTRAP_PROJECT_INITIALIZER_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

async function mutation(fixture) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-project-initializer-mutation-"));
  try {
    const control = path.join(directory, "control");
    fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "bootstrap-project-initializer-boundary-gate.mjs");
    let source = fs.readFileSync(path.join(ROOT, "control/bootstrap-project-initializer-boundary-gate.mjs"), "utf8");
    const anchor = 'return result("DENY", "NO_INITIALIZER_SIDE_EFFECT", "BOOTSTRAP_PROJECT_INITIALIZER_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Bootstrap initializer mutation anchor is missing", "BOOTSTRAP_PROJECT_INITIALIZER_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'return result("ROUTE", "CONTROLLER_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed:true, selected_recipient:"AGENTOS_CONTROLLER"});');
    fs.writeFileSync(target, source, {flag: "wx"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const observed = module.evaluateBootstrapProjectInitializerBoundary(fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

export async function evaluateBootstrapProjectInitializerPackage() {
  const packageRoot = path.join(ROOT, PACKAGE_RELATIVE);
  const block = readJson(path.join(packageRoot, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Bootstrap initializer package is not an inactive candidate", "BOOTSTRAP_PROJECT_INITIALIZER_PACKAGE_STATE_INVALID");
  const files = packageFiles(packageRoot);
  const digests = files.map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: sha(read(path.join(packageRoot, relativePath)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Bootstrap initializer gate inventory is incomplete", "BOOTSTRAP_PROJECT_INITIALIZER_GATE_INVENTORY_INVALID");
  const fixtures = fixtureMap(block.evaluation?.fixture_classes ?? []);
  const fixtureResults = [];
  for (const entry of [...fixtures.values()].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id))) {
    const fixture = entry.fixture;
    const expected = fixture.expected_readback;
    let actual;
    try { actual = evaluateBootstrapProjectInitializerBoundary(fixture.vector.input); }
    catch (error) { fail(`${fixture.fixture_id} execution failed: ${error.code ?? error.message}`, "BOOTSTRAP_PROJECT_INITIALIZER_HOSTILE_EXECUTION_FAILED"); }
    const zero = Object.values(actual.external_side_effects).every((value) => value === 0);
    const checks = [
      {assertion: "TYPED_DISPOSITION", observed: actual.disposition === expected.disposition, evidence: `${actual.disposition}/${expected.disposition}`},
      {assertion: "TYPED_ROUTE", observed: actual.route === expected.route, evidence: `${actual.route}/${expected.route}`},
      {assertion: "TYPED_ERROR", observed: actual.error_code === expected.error_code, evidence: `${actual.error_code}/${expected.error_code}`},
      {assertion: "NO_INITIALIZER_SIDE_EFFECT", observed: zero, evidence: JSON.stringify(actual.external_side_effects)},
      {assertion: "ACCEPTANCE_FORBIDDEN", observed: actual.acceptance_allowed === false, evidence: `${actual.acceptance_allowed}`},
    ];
    assert(checks.every((check) => check.observed), `${fixture.fixture_id} hostile result failed`, "BOOTSTRAP_PROJECT_INITIALIZER_HOSTILE_RESULT_FAILED");
    const record = {fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, assertion_readbacks: checks, external_side_effects: actual.external_side_effects, duration_ms: 0, result_sha256: null};
    record.result_sha256 = resultDigest(record);
    fixtureResults.push(record);
  }
  const mutationSensitivity = await mutation(readJson(path.join(packageRoot, "fixtures/unsafe_action.json")));
  assert(mutationSensitivity.status === "WEAKENED" && mutationSensitivity.mutation_detected, "Bootstrap initializer mutation proof did not execute", "BOOTSTRAP_PROJECT_INITIALIZER_MUTATION_PROOF_MISSING");
  const evaluation = {schema: BOOTSTRAP_PROJECT_INITIALIZER_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: fixtureResults, mutation_sensitivity: mutationSensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateBootstrapProjectInitializerPackage(), null, 2)}\n`);
