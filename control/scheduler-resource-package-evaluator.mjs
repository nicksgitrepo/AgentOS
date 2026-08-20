#!/usr/bin/env node

/* Operational evaluator for the Scheduler resource-classification package.
 *
 * It resolves the real package files, executes every typed hostile vector
 * through the real read-only boundary, runs the focused scheduler contracts,
 * and proves that weakening the execution denial changes a result.  It never
 * allocates a resource, starts a process, or activates the role.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateSchedulerResourceBoundary, SCHEDULER_RESOURCE_BOUNDARY_SCHEMA} from "./scheduler-resource-boundary-gate.mjs";

export const SCHEDULER_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_scheduler_resource_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-01/resource-scheduler";
const BLOCK_ID = "specialist.control.resource-scheduler";
const FOCUSED_SUITES = [
  "tests/verify-rapid-prototype.mjs",
  "tests/verify-global-governance-operational-integration.mjs",
  "tests/verify-durable-session-process-provenance.mjs",
  "tests/verify-task-run-loop.mjs",
];

function fail(message, code = "SCHEDULER_PACKAGE_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function rawSha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function readJson(file) { assert(fs.existsSync(file), `${file} is missing`, "SCHEDULER_PACKAGE_FILE_MISSING"); return JSON.parse(fs.readFileSync(file, "utf8")); }
function readBytes(file) { assert(fs.existsSync(file), `${file} is missing`, "SCHEDULER_PACKAGE_FILE_MISSING"); return fs.readFileSync(file); }
function digestResult(value) { return canonicalDigest({...value, result_sha256: null}); }

function packageFiles(packageRoot) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(packageRoot, "gates")).filter((entry) => entry.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(packageRoot, "fixtures")).filter((entry) => entry.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}

function readFixtureMap(expectedClasses) {
  const fixtureRoot = path.join(ROOT, PACKAGE_RELATIVE, "fixtures");
  const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
  assert(files.length === expectedClasses.length && new Set(files).size === expectedClasses.length, "Scheduler hostile fixture inventory is not exact", "SCHEDULER_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of files) {
    const bytes = readBytes(path.join(fixtureRoot, name));
    const fixture = JSON.parse(bytes);
    assert(fixture.block_id === BLOCK_ID && typeof fixture.fixture_id === "string" && fixture.vector?.entrypoint === "control/scheduler-resource-boundary-gate.mjs#evaluateSchedulerResourceBoundary", `Scheduler fixture ${name} is not bound to the real boundary`, "SCHEDULER_FIXTURE_UNBOUND");
    assert(fixture.vector.input?.schema === SCHEDULER_RESOURCE_BOUNDARY_SCHEMA, `Scheduler fixture ${name} has the wrong input schema`, "SCHEDULER_FIXTURE_INPUT_INVALID");
    assert(fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `Scheduler fixture ${name} has no typed expectation`, "SCHEDULER_FIXTURE_EXPECTATION_INVALID");
    assert(!map.has(fixture.fixture_id), `Duplicate Scheduler fixture ${name}`, "SCHEDULER_FIXTURE_ALIAS");
    map.set(fixture.fixture_id, {fixture, file_sha256: rawSha256(bytes), relative_path: `${PACKAGE_RELATIVE}/fixtures/${name}`});
  }
  assert([...map.values()].map(({fixture}) => fixture.class).sort().join("\0") === expectedClasses.slice().sort().join("\0"), "Scheduler fixture classes do not match the package inventory", "SCHEDULER_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function runFocusedSuites() {
  return FOCUSED_SUITES.map((relativePath) => {
    const result = spawnSync(process.execPath, [relativePath], {cwd: ROOT, encoding: "utf8", timeout: 120000});
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return {suite: relativePath, status: result.status === 0 ? "PASS" : "FAIL", exit_code: result.status, output_sha256: rawSha256(Buffer.from(output, "utf8"))};
  });
}

async function auditBoundaryMutation(fixture) {
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-scheduler-boundary-mutation-"));
  try {
    const controlRoot = path.join(mutationRoot, "control"); fs.mkdirSync(controlRoot, {recursive: true});
    fs.copyFileSync(path.join(ROOT, "control/content-addressing.mjs"), path.join(controlRoot, "content-addressing.mjs"));
    fs.copyFileSync(path.join(ROOT, "control/persisted-record-privacy.mjs"), path.join(controlRoot, "persisted-record-privacy.mjs"));
    const sourcePath = path.join(ROOT, "control/scheduler-resource-boundary-gate.mjs");
    const targetPath = path.join(controlRoot, "scheduler-resource-boundary-gate.mjs");
    let source = fs.readFileSync(sourcePath, "utf8");
    const anchor = 'return result("DENY", "NO_EXTERNAL_STATE_CHANGE", "SCHEDULER_EXTERNAL_STATE_FORBIDDEN", input);';
    assert(source.includes(anchor), "Scheduler execution denial mutation anchor is missing", "SCHEDULER_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'return result("ROUTE", "RESOURCE_OWNER_HANDOFF", "MUTATED_EXTERNAL_STATE_ALLOWED", input);');
    fs.writeFileSync(targetPath, source, {flag: "wx"});
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`);
    const observed = mutated.evaluateSchedulerResourceBoundary(fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
}

export async function evaluateSchedulerResourcePackage() {
  const packageRoot = path.join(ROOT, PACKAGE_RELATIVE);
  const block = readJson(path.join(packageRoot, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Scheduler package is not an inactive candidate", "SCHEDULER_PACKAGE_STATE_INVALID");
  const files = packageFiles(packageRoot);
  const fileDigests = files.map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: rawSha256(readBytes(path.join(packageRoot, relativePath)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Scheduler gate inventory is incomplete", "SCHEDULER_GATE_INVENTORY_INVALID");
  const expectedFixtureClasses = Array.isArray(block.evaluation?.fixture_classes) ? block.evaluation.fixture_classes : [];
  const fixtures = readFixtureMap(expectedFixtureClasses);
  const results = [];
  for (const fixtureInfo of [...fixtures.values()].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id))) {
    const fixture = fixtureInfo.fixture; const expected = fixture.vector.expected_readback; const started = Date.now();
    let actual;
    try { actual = evaluateSchedulerResourceBoundary(fixture.vector.input); }
    catch (error) { fail(`${fixture.fixture_id} execution failed: ${error.code ?? error.message}`, "SCHEDULER_HOSTILE_EXECUTION_FAILED"); }
    const sideEffectsZero = Object.values(actual.external_side_effects).every((value) => value === 0);
    const assertionReadbacks = [
      {assertion: "TYPED_DISPOSITION", observed: actual.disposition === expected.disposition, evidence: `actual=${actual.disposition}; expected=${expected.disposition}`},
      {assertion: "TYPED_ROUTE", observed: actual.route === expected.route, evidence: `actual=${actual.route}; expected=${expected.route}`},
      {assertion: "TYPED_ERROR", observed: actual.error_code === expected.error_code, evidence: `actual=${actual.error_code}; expected=${expected.error_code}`},
      {assertion: "NO_RESOURCE_SIDE_EFFECT", observed: sideEffectsZero, evidence: JSON.stringify(actual.external_side_effects)},
      {assertion: "CLASSIFICATION_REMAINS_NON_AUTHORITATIVE", observed: actual.classification_allowed === false, evidence: `classification_allowed=${actual.classification_allowed}`},
    ];
    assert(assertionReadbacks.every((entry) => entry.observed), `${fixture.fixture_id} hostile result failed`, "SCHEDULER_HOSTILE_RESULT_FAILED");
    const result = {fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: fixtureInfo.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, assertion_readbacks: assertionReadbacks, external_side_effects: actual.external_side_effects, duration_ms: Date.now() - started, result_sha256: null};
    result.result_sha256 = digestResult(result); results.push(result);
  }
  const focusedSuites = runFocusedSuites();
  assert(focusedSuites.every((suite) => suite.status === "PASS"), "One or more focused Scheduler suites failed", "SCHEDULER_FOCUSED_SUITE_FAILED");
  const mutation = await auditBoundaryMutation(readJson(path.join(packageRoot, "fixtures/unsafe_action.json")));
  assert(mutation.status === "WEAKENED" && mutation.mutation_detected === true, "Scheduler mutation proof did not execute", "SCHEDULER_MUTATION_PROOF_MISSING");
  const observedAtUtc = new Date().toISOString();
  const packageRootSha256 = canonicalDigest(fileDigests);
  const evaluation = {schema: SCHEDULER_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: packageRootSha256, package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, focused_suites: focusedSuites, mutation_sensitivity: mutation, independent_signature_required: true, observed_at_utc: observedAtUtc, evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateSchedulerResourcePackage(), null, 2)}\n`);
