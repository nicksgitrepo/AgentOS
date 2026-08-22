#!/usr/bin/env node

/* Local executable evaluator for the OpenAPI HTTP Contract candidate. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {pathToFileURL, fileURLToPath} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateOpenApiContractBoundary, OPENAPI_CONTRACT_BOUNDARY_SCHEMA} from "./openapi-contract-boundary-gate.mjs";
import {
  OPENAPI_CONTRACT_BLOCK_ID,
  OPENAPI_CONTRACT_FIXTURE_CLASSES,
  OPENAPI_CONTRACT_GATE_IDS,
  resolveOpenApiContractCanonicalAuthority,
} from "./openapi-contract-authority-binding.mjs";

export const OPENAPI_CONTRACT_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_openapi_contract_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-02/openapi-contracts";
const PACKAGE_ROOT = path.join(ROOT, PACKAGE_RELATIVE);
const ENTRYPOINT = "control/openapi-contract-boundary-gate.mjs#evaluateOpenApiContractBoundary";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fail(message, code = "OPENAPI_CONTRACT_PACKAGE_EVALUATION_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function read(file, label = file) {
  assert(fs.existsSync(file), `${label} is missing`, "OPENAPI_CONTRACT_PACKAGE_FILE_MISSING");
  return fs.readFileSync(file);
}

function readJson(file, label = file) {
  try { return JSON.parse(read(file, label)); } catch (error) { fail(`${label} is not valid JSON: ${error.message}`, "OPENAPI_CONTRACT_PACKAGE_JSON_INVALID"); }
}

function resultDigest(value) {
  return canonicalDigest({...value, result_sha256: null});
}

function packageFiles() {
  const files = ["block.json", "sources.lock", "gates/execution.json", "gates/manifest.json", "evaluation.json", "handoff.json"];
  files.push(...fs.readdirSync(path.join(PACKAGE_ROOT, "gates")).filter((name) => name.endsWith(".gate")).map((name) => `gates/${name}`));
  files.push(...fs.readdirSync(path.join(PACKAGE_ROOT, "fixtures")).filter((name) => name.endsWith(".json")).map((name) => `fixtures/${name}`));
  return [...new Set(files)].sort();
}

function loadFixtures() {
  const directory = path.join(PACKAGE_ROOT, "fixtures");
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === OPENAPI_CONTRACT_FIXTURE_CLASSES.length, "OpenAPI fixture inventory is incomplete", "OPENAPI_CONTRACT_FIXTURE_INVENTORY_INVALID");
  const fixtures = names.map((name) => {
    const file = path.join(directory, name);
    const fixture = readJson(file, `OpenAPI fixture ${name}`);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === OPENAPI_CONTRACT_BLOCK_ID && fixture.fixture_id === `openapi-contracts-${fixture.class}` && fixture.hostile === true, `OpenAPI fixture ${name} identity is invalid`, "OPENAPI_CONTRACT_FIXTURE_ID_INVALID");
    assert(OPENAPI_CONTRACT_FIXTURE_CLASSES.includes(fixture.class), `OpenAPI fixture ${name} class is invalid`, "OPENAPI_CONTRACT_FIXTURE_CLASS_INVALID");
    assert(fixture.vector?.entrypoint === ENTRYPOINT && fixture.vector.input?.schema === OPENAPI_CONTRACT_BOUNDARY_SCHEMA, `OpenAPI fixture ${name} is not executable`, "OPENAPI_CONTRACT_FIXTURE_UNBOUND");
    assert(fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `OpenAPI fixture ${name} lacks a typed expectation`, "OPENAPI_CONTRACT_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.expected === fixture.vector.expected_readback.disposition, `OpenAPI fixture ${name} has contradictory expectations`, "OPENAPI_CONTRACT_FIXTURE_CONTRADICTION");
    return {name, file, fixture, file_sha256: sha(read(file))};
  });
  assert(new Set(fixtures.map(({fixture}) => fixture.class)).size === OPENAPI_CONTRACT_FIXTURE_CLASSES.length, "OpenAPI fixture classes are not unique", "OPENAPI_CONTRACT_FIXTURE_CLASS_INVALID");
  return fixtures.sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id));
}

function validateGateExecution(fixtures) {
  const manifest = readJson(path.join(PACKAGE_ROOT, "gates/manifest.json"), "OpenAPI gate manifest");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(OPENAPI_CONTRACT_GATE_IDS), "OpenAPI gate manifest order is invalid", "OPENAPI_CONTRACT_GATE_ORDER_INVALID");
  const execution = readJson(path.join(PACKAGE_ROOT, "gates/execution.json"), "OpenAPI gate execution");
  assert(execution.block_id === OPENAPI_CONTRACT_BLOCK_ID && execution.evaluator_entrypoint === "control/openapi-contract-package-evaluator.mjs#evaluateOpenApiContractPackage", "OpenAPI gate execution is not bound to the evaluator", "OPENAPI_CONTRACT_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(OPENAPI_CONTRACT_GATE_IDS) && execution.executions.length === OPENAPI_CONTRACT_GATE_IDS.length, "OpenAPI gate execution is incomplete", "OPENAPI_CONTRACT_GATE_EXECUTION_INVALID");
  assert(execution.execution_sha256 === canonicalDigest({...execution, execution_sha256: null}), "OpenAPI gate execution digest is invalid", "OPENAPI_CONTRACT_GATE_EXECUTION_DIGEST_INVALID");
  const byClass = new Map(fixtures.map((record) => [record.fixture.class, record]));
  const executions = execution.executions.map((entry) => {
    assert(OPENAPI_CONTRACT_GATE_IDS.includes(entry.gate_id) && byClass.has(entry.fixture_class), `OpenAPI gate ${entry.gate_id} references an unknown fixture`, "OPENAPI_CONTRACT_GATE_EXECUTION_INVALID");
    const actual = byClass.get(entry.fixture_class).actual;
    assert(actual.disposition === entry.expected.disposition && actual.route === entry.expected.route && actual.error_code === entry.expected.error_code, `OpenAPI gate ${entry.gate_id} readback differs`, "OPENAPI_CONTRACT_GATE_READBACK_FAILED");
    return {gate_id: entry.gate_id, fixture_class: entry.fixture_class, public_entrypoint_invoked: true, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, readback_sha256: canonicalDigest(actual)};
  });
  return {manifest_sha256: manifest.manifest_sha256, execution_sha256: execution.execution_sha256, executions};
}

async function mutationProof(fixture) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-openapi-contract-mutation-"));
  try {
    const control = path.join(directory, "control");
    fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const sourcePath = path.join(ROOT, "control/openapi-contract-boundary-gate.mjs");
    const targetPath = path.join(control, "openapi-contract-boundary-gate.mjs");
    let source = fs.readFileSync(sourcePath, "utf8");
    const anchor = 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_CONTRACT_SIDE_EFFECT", "OPENAPI_CONTRACT_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "OpenAPI mutation anchor is missing", "OPENAPI_CONTRACT_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("ROUTE", "OPENAPI_CONTRACT_SPECIALIST_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed:true, selected_specialist:"specialist.product-client.openapi-contracts"});');
    fs.writeFileSync(targetPath, source, {flag: "wx"});
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`);
    const observed = mutated.evaluateOpenApiContractBoundary(fixture.fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

export async function evaluateOpenApiContractPackage() {
  const block = readJson(path.join(PACKAGE_ROOT, "block.json"), "OpenAPI block");
  assert(block.block_id === OPENAPI_CONTRACT_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "OpenAPI package is not an inactive candidate", "OPENAPI_CONTRACT_PACKAGE_STATE_INVALID");
  const fixtures = loadFixtures();
  const fixtureResults = [];
  for (const record of fixtures) {
    let actual;
    try { actual = evaluateOpenApiContractBoundary(record.fixture.vector.input); } catch (error) { fail(`${record.fixture.fixture_id} public entrypoint failed: ${error.code ?? error.message}`, "OPENAPI_CONTRACT_HOSTILE_EXECUTION_FAILED"); }
    record.actual = actual;
    const expected = record.fixture.vector.expected_readback;
    const zero = Object.values(actual.external_side_effects).every((value) => value === 0);
    const checks = [
      {assertion: "TYPED_DISPOSITION", observed: actual.disposition === expected.disposition, evidence: `${actual.disposition}/${expected.disposition}`},
      {assertion: "TYPED_ROUTE", observed: actual.route === expected.route, evidence: `${actual.route}/${expected.route}`},
      {assertion: "TYPED_ERROR", observed: actual.error_code === expected.error_code, evidence: `${actual.error_code}/${expected.error_code}`},
      {assertion: "NO_OPENAPI_CONTRACT_SIDE_EFFECT", observed: zero, evidence: JSON.stringify(actual.external_side_effects)},
      {assertion: "ACCEPTANCE_FORBIDDEN", observed: actual.acceptance_allowed === false, evidence: `${actual.acceptance_allowed}`},
      {assertion: "RESULT_DIGEST", observed: actual.result_sha256 === resultDigest(actual), evidence: actual.result_sha256},
    ];
    assert(checks.every((check) => check.observed), `${record.fixture.fixture_id} hostile readback failed`, "OPENAPI_CONTRACT_HOSTILE_RESULT_FAILED");
    fixtureResults.push({
      fixture_id: record.fixture.fixture_id,
      fixture_class: record.fixture.class,
      fixture_file_sha256: record.file_sha256,
      entrypoint: record.fixture.vector.entrypoint,
      entrypoint_invoked: true,
      semantic_execution_completed: true,
      expected_outcome: expected.disposition,
      actual_outcome: actual.disposition,
      expected_route: expected.route,
      actual_route: actual.route,
      expected_error_code: expected.error_code,
      actual_error_code: actual.error_code,
      assertion_readbacks: checks,
      external_side_effects: actual.external_side_effects,
      result_sha256: actual.result_sha256,
    });
  }
  const gateExecution = validateGateExecution(fixtures);
  const mutationSensitivity = await mutationProof(fixtures.find(({fixture}) => fixture.class === "unsafe_action"));
  assert(mutationSensitivity.status === "WEAKENED" && mutationSensitivity.mutation_detected === true, "OpenAPI mutation proof did not execute", "OPENAPI_CONTRACT_MUTATION_PROOF_MISSING");
  const authority = resolveOpenApiContractCanonicalAuthority();
  assert(authority.status === "BLOCKED_EXACT" && authority.model_policy.code === "POLICY_SNAPSHOT_STALE", "OpenAPI protected model policy did not fail closed", "OPENAPI_CONTRACT_PROTECTED_POLICY_NOT_BLOCKED");
  const files = packageFiles().map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: sha(read(path.join(PACKAGE_ROOT, relativePath)))}));
  const evaluation = {
    schema: OPENAPI_CONTRACT_PACKAGE_EVALUATION_SCHEMA,
    version: 1,
    status: "BLOCKED_EXACT",
    local_status: "PASS_LOCAL_ONLY",
    block_id: OPENAPI_CONTRACT_BLOCK_ID,
    lifecycle: block.lifecycle,
    activation: block.activation,
    package_root_sha256: canonicalDigest(files),
    package_block_sha256: block.block_sha256,
    authority_sha256: authority.authority_sha256,
    gate_execution: gateExecution,
    fixture_results: fixtureResults.sort((left, right) => left.fixture_id.localeCompare(right.fixture_id)),
    mutation_sensitivity: mutationSensitivity,
    protected_dependency: authority.model_policy,
    memory_context_receipt_sha256: authority.context.receipt_sha256,
    independent_signature_required: true,
    ready_for_admission: false,
    observed_at_utc: new Date().toISOString(),
    evaluation_sha256: null,
  };
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

export const evaluateOpenAPIContractPackage = evaluateOpenApiContractPackage;

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateOpenApiContractPackage(), null, 2)}\n`);
