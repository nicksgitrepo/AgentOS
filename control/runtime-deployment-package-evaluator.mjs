#!/usr/bin/env node

/* Operational evaluator for the Runtime/Deployment Operator package.
 *
 * Every fixture is resolved from the package, then executed through the real
 * read-only boundary.  This proves semantic outcomes and zero operational
 * side effects; fixture metadata alone is never treated as proof.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateRuntimeDeploymentBoundary, RUNTIME_DEPLOYMENT_BOUNDARY_SCHEMA} from "./runtime-deployment-boundary-gate.mjs";

export const RUNTIME_DEPLOYMENT_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_runtime_deployment_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-01/runtime-deployment-operator";
const BLOCK_ID = "specialist.control.runtime-deployment-operator";
const FOCUSED_SUITES = [
  "tests/verify-delivery-adapter.mjs",
  "tests/verify-delivery-closure-state.mjs",
  "tests/verify-delivery-policy.mjs",
  "tests/verify-delivery-target.mjs",
  "tests/verify-release-lifecycle.mjs",
  "tests/verify-release-promotion-gate.mjs",
  "tests/verify-release-safety.mjs",
  "tests/verify-runtime-operation-governance.mjs",
];

function fail(message, code = "RUNTIME_PACKAGE_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function rawSha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function digestResult(value) { return canonicalDigest({...value, result_sha256: null}); }
function readJson(file) { assert(fs.existsSync(file), `${file} is missing`, "RUNTIME_PACKAGE_FILE_MISSING"); return JSON.parse(fs.readFileSync(file, "utf8")); }
function readBytes(file) { assert(fs.existsSync(file), `${file} is missing`, "RUNTIME_PACKAGE_FILE_MISSING"); return fs.readFileSync(file); }

function readFixtureMap(expectedClasses) {
  const fixtureRoot = path.join(ROOT, PACKAGE_RELATIVE, "fixtures");
  const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
  assert(files.length === expectedClasses.length && new Set(files).size === expectedClasses.length, "Runtime hostile fixture inventory is not exact", "RUNTIME_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of files) {
    const bytes = readBytes(path.join(fixtureRoot, name));
    const fixture = JSON.parse(bytes);
    assert(fixture.block_id === BLOCK_ID && typeof fixture.fixture_id === "string" && fixture.vector?.entrypoint === "control/runtime-deployment-boundary-gate.mjs#evaluateRuntimeDeploymentBoundary", `Runtime fixture ${name} is not bound to the real boundary`, "RUNTIME_FIXTURE_UNBOUND");
    assert(fixture.vector.input?.schema === RUNTIME_DEPLOYMENT_BOUNDARY_SCHEMA, `Runtime fixture ${name} input schema is not canonical`, "RUNTIME_FIXTURE_INPUT_INVALID");
    assert(fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `Runtime fixture ${name} has no typed expected readback`, "RUNTIME_FIXTURE_EXPECTATION_INVALID");
    assert(!map.has(fixture.fixture_id), `Duplicate Runtime fixture ${name}`, "RUNTIME_FIXTURE_ALIAS");
    map.set(fixture.fixture_id, {fixture, file_sha256: rawSha256(bytes), relative_path: `${PACKAGE_RELATIVE}/fixtures/${name}`});
  }
  assert([...map.values()].map(({fixture}) => fixture.class).sort().join("\0") === expectedClasses.slice().sort().join("\0"), "Runtime fixture classes do not match the canonical package inventory", "RUNTIME_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function packageFiles(packageRoot) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(packageRoot, "gates")).filter((entry) => entry.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(packageRoot, "fixtures")).filter((entry) => entry.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}

function runFocusedSuites() {
  return FOCUSED_SUITES.map((relativePath) => {
    const result = spawnSync(process.execPath, [relativePath], {cwd: ROOT, encoding: "utf8", timeout: 120000});
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return {suite: relativePath, status: result.status === 0 ? "PASS" : "FAIL", exit_code: result.status, output_sha256: rawSha256(Buffer.from(output, "utf8"))};
  });
}

async function auditBoundaryMutation(fixture) {
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-runtime-boundary-mutation-"));
  try {
    const controlRoot = path.join(mutationRoot, "control"); fs.mkdirSync(controlRoot, {recursive: true});
    fs.copyFileSync(path.join(ROOT, "control/content-addressing.mjs"), path.join(controlRoot, "content-addressing.mjs"));
    fs.copyFileSync(path.join(ROOT, "control/persisted-record-privacy.mjs"), path.join(controlRoot, "persisted-record-privacy.mjs"));
    const sourcePath = path.join(ROOT, "control/runtime-deployment-boundary-gate.mjs");
    const targetPath = path.join(controlRoot, "runtime-deployment-boundary-gate.mjs");
    let source = fs.readFileSync(sourcePath, "utf8");
    const anchor = 'return result("DENY", "NO_EXECUTION", "RUNTIME_EXECUTION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Runtime execution denial mutation anchor is missing", "RUNTIME_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'return result("ROUTE", "RUNTIME_EVIDENCE_HANDOFF", "MUTATED_EXECUTION_ALLOWED", input);');
    fs.writeFileSync(targetPath, source, {flag: "wx"});
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`);
    const observed = mutated.evaluateRuntimeDeploymentBoundary(fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
}

export async function evaluateRuntimeDeploymentPackage() {
  const packageRoot = path.join(ROOT, PACKAGE_RELATIVE);
  const block = readJson(path.join(packageRoot, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Runtime package is not an inactive candidate", "RUNTIME_PACKAGE_STATE_INVALID");
  const files = packageFiles(packageRoot);
  const fileDigests = files.map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: rawSha256(readBytes(path.join(packageRoot, relativePath)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Runtime gate inventory is incomplete", "RUNTIME_GATE_INVENTORY_INVALID");
  const expectedFixtureClasses = Array.isArray(block.evaluation?.fixture_classes) ? block.evaluation.fixture_classes : [];
  const fixtures = readFixtureMap(expectedFixtureClasses);
  const results = [];
  for (const fixtureInfo of [...fixtures.values()].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id))) {
    const fixture = fixtureInfo.fixture; const expected = fixture.vector.expected_readback; const started = Date.now();
    let actual;
    try { actual = evaluateRuntimeDeploymentBoundary(fixture.vector.input); }
    catch (error) { fail(`${fixture.fixture_id} execution failed: ${error.code ?? error.message}`, "RUNTIME_HOSTILE_EXECUTION_FAILED"); }
    const assertionReadbacks = [
      {assertion: "TYPED_DISPOSITION", observed: actual.disposition === expected.disposition, evidence: `actual=${actual.disposition}; expected=${expected.disposition}`},
      {assertion: "TYPED_ROUTE", observed: actual.route === expected.route, evidence: `actual=${actual.route}; expected=${expected.route}`},
      {assertion: "TYPED_ERROR", observed: actual.error_code === expected.error_code, evidence: `actual=${actual.error_code}; expected=${expected.error_code}`},
      {assertion: "NO_OPERATIONAL_SIDE_EFFECT", observed: Object.values(actual.external_side_effects).every((value) => value === 0), evidence: JSON.stringify(actual.external_side_effects)},
      {assertion: "EXECUTION_REMAINS_FORBIDDEN", observed: actual.execution_allowed === false, evidence: `execution_allowed=${actual.execution_allowed}`},
    ];
    assert(assertionReadbacks.every((entry) => entry.observed), `${fixture.fixture_id} hostile result failed`, "RUNTIME_HOSTILE_RESULT_FAILED");
    const result = {fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: fixtureInfo.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, assertion_readbacks: assertionReadbacks, external_side_effects: actual.external_side_effects, duration_ms: Date.now() - started, result_sha256: null};
    result.result_sha256 = digestResult(result); results.push(result);
  }
  const focusedSuites = runFocusedSuites();
  assert(focusedSuites.every((suite) => suite.status === "PASS"), "One or more focused Runtime suites failed", "RUNTIME_FOCUSED_SUITE_FAILED");
  const mutation = await auditBoundaryMutation(readJson(path.join(ROOT, PACKAGE_RELATIVE, "fixtures/unsafe_action.json")));
  assert(mutation.status === "WEAKENED" && mutation.mutation_detected === true, "Runtime boundary mutation proof did not execute", "RUNTIME_MUTATION_PROOF_MISSING");
  const observedAtUtc = new Date().toISOString();
  const packageRootSha256 = canonicalDigest(fileDigests);
  const evaluation = {schema: RUNTIME_DEPLOYMENT_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: packageRootSha256, package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, focused_suites: focusedSuites, mutation_sensitivity: mutation, independent_signature_required: true, observed_at_utc: observedAtUtc, evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateRuntimeDeploymentPackage(), null, 2)}\n`);
