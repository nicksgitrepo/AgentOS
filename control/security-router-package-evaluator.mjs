#!/usr/bin/env node

/* Operational evaluator for the Security Router candidate.
 * It resolves real package files, executes every typed hostile vector through
 * the production boundary, and proves a weakened forbidden-operation branch
 * changes a real result.  It never admits or activates the package.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateSecurityRouterBoundary, SECURITY_ROUTER_BOUNDARY_SCHEMA} from "./security-router-boundary-gate.mjs";

export const SECURITY_ROUTER_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_security_router_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-02/security-router";
const BLOCK_ID = "specialist.security.router";
const rawSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fail(message, code = "SECURITY_ROUTER_PACKAGE_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function readJson(file) { assert(fs.existsSync(file), `${file} is missing`, "SECURITY_ROUTER_PACKAGE_FILE_MISSING"); return JSON.parse(fs.readFileSync(file, "utf8")); }
function readBytes(file) { assert(fs.existsSync(file), `${file} is missing`, "SECURITY_ROUTER_PACKAGE_FILE_MISSING"); return fs.readFileSync(file); }
function digestResult(value) { return canonicalDigest({...value, result_sha256: null}); }
function packageFiles(packageRoot) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(packageRoot, "gates")).filter((entry) => entry.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(packageRoot, "fixtures")).filter((entry) => entry.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}
function fixtureMap(expectedClasses) {
  const fixtureRoot = path.join(ROOT, PACKAGE_RELATIVE);
  const names = fs.readdirSync(path.join(fixtureRoot, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === expectedClasses.length && new Set(names).size === expectedClasses.length, "Security Router fixture inventory is not exact", "SECURITY_ROUTER_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const bytes = readBytes(path.join(fixtureRoot, "fixtures", name)); const fixture = JSON.parse(bytes);
    assert(fixture.block_id === BLOCK_ID && typeof fixture.fixture_id === "string", `Security Router fixture ${name} identity is invalid`, "SECURITY_ROUTER_FIXTURE_ID_INVALID");
    assert(fixture.vector?.entrypoint === "control/security-router-boundary-gate.mjs#evaluateSecurityRouterBoundary", `Security Router fixture ${name} is not bound to the real boundary`, "SECURITY_ROUTER_FIXTURE_UNBOUND");
    assert(fixture.vector.input?.schema === SECURITY_ROUTER_BOUNDARY_SCHEMA, `Security Router fixture ${name} has the wrong input schema`, "SECURITY_ROUTER_FIXTURE_INPUT_INVALID");
    assert(fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `Security Router fixture ${name} has no typed expectation`, "SECURITY_ROUTER_FIXTURE_EXPECTATION_INVALID");
    assert(!map.has(fixture.fixture_id), `Duplicate Security Router fixture ${name}`, "SECURITY_ROUTER_FIXTURE_ALIAS");
    map.set(fixture.fixture_id, {fixture, file_sha256: rawSha256(bytes), relative_path: `${PACKAGE_RELATIVE}/fixtures/${name}`});
  }
  assert([...map.values()].map(({fixture}) => fixture.class).sort().join("\0") === expectedClasses.slice().sort().join("\0"), "Security Router fixture classes do not match the package inventory", "SECURITY_ROUTER_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
async function mutationProof(fixture) {
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-security-router-mutation-"));
  try {
    const controlRoot = path.join(mutationRoot, "control"); fs.mkdirSync(controlRoot, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(controlRoot, dependency));
    const sourcePath = path.join(ROOT, "control/security-router-boundary-gate.mjs"); const targetPath = path.join(controlRoot, "security-router-boundary-gate.mjs");
    let source = fs.readFileSync(sourcePath, "utf8");
    const anchor = 'return result("DENY", "NO_ROUTER_SIDE_EFFECT", "SECURITY_ROUTER_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Security Router mutation anchor is missing", "SECURITY_ROUTER_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'return result("ROUTE", "SPECIALIST_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed: true, selected_specialist: "specialist.security.oauth-identity"});');
    fs.writeFileSync(targetPath, source, {flag: "wx"});
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`);
    const observed = mutated.evaluateSecurityRouterBoundary(fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
}

export async function evaluateSecurityRouterPackage() {
  const packageRoot = path.join(ROOT, PACKAGE_RELATIVE); const block = readJson(path.join(packageRoot, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Security Router package is not an inactive candidate", "SECURITY_ROUTER_PACKAGE_STATE_INVALID");
  const files = packageFiles(packageRoot); const fileDigests = files.map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: rawSha256(readBytes(path.join(packageRoot, relativePath)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Security Router gate inventory is incomplete", "SECURITY_ROUTER_GATE_INVENTORY_INVALID");
  const expectedClasses = Array.isArray(block.evaluation?.fixture_classes) ? block.evaluation.fixture_classes : []; const fixtures = fixtureMap(expectedClasses); const results = [];
  for (const info of [...fixtures.values()].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id))) {
    const fixture = info.fixture; const expected = fixture.vector.expected_readback; const started = Date.now(); let actual;
    try { actual = evaluateSecurityRouterBoundary(fixture.vector.input); } catch (error) { fail(`${fixture.fixture_id} execution failed: ${error.code ?? error.message}`, "SECURITY_ROUTER_HOSTILE_EXECUTION_FAILED"); }
    const sideEffectsZero = Object.values(actual.external_side_effects).every((value) => value === 0);
    const assertions = [
      {assertion: "TYPED_DISPOSITION", observed: actual.disposition === expected.disposition, evidence: `actual=${actual.disposition}; expected=${expected.disposition}`},
      {assertion: "TYPED_ROUTE", observed: actual.route === expected.route, evidence: `actual=${actual.route}; expected=${expected.route}`},
      {assertion: "TYPED_ERROR", observed: actual.error_code === expected.error_code, evidence: `actual=${actual.error_code}; expected=${expected.error_code}`},
      {assertion: "NO_SECURITY_SIDE_EFFECT", observed: sideEffectsZero, evidence: JSON.stringify(actual.external_side_effects)},
      {assertion: "ACCEPTANCE_REMAINS_FORBIDDEN", observed: actual.acceptance_allowed === false, evidence: `acceptance_allowed=${actual.acceptance_allowed}`},
    ];
    assert(assertions.every((entry) => entry.observed), `${fixture.fixture_id} hostile result failed`, "SECURITY_ROUTER_HOSTILE_RESULT_FAILED");
    const record = {fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: info.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, assertion_readbacks: assertions, external_side_effects: actual.external_side_effects, duration_ms: Date.now() - started, result_sha256: null};
    record.result_sha256 = digestResult(record); results.push(record);
  }
  const mutation = await mutationProof(readJson(path.join(packageRoot, "fixtures/unsafe_action.json")));
  assert(mutation.status === "WEAKENED" && mutation.mutation_detected === true, "Security Router mutation proof did not execute", "SECURITY_ROUTER_MUTATION_PROOF_MISSING");
  const evaluation = {schema: SECURITY_ROUTER_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(fileDigests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, mutation_sensitivity: mutation, independent_signature_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateSecurityRouterPackage(), null, 2)}\n`);

