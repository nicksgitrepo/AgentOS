#!/usr/bin/env node

/* Local, executable evaluator for the Cloudflare DNS candidate. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {pathToFileURL, fileURLToPath} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateCloudflareDnsBoundary, CLOUDFLARE_DNS_BOUNDARY_SCHEMA} from "./cloudflare-dns-boundary-gate.mjs";
import {
  CLOUDFLARE_DNS_BLOCK_ID,
  CLOUDFLARE_DNS_FIXTURE_CLASSES,
  CLOUDFLARE_DNS_GATE_IDS,
  resolveCloudflareDnsCanonicalAuthority,
} from "./cloudflare-dns-authority-binding.mjs";

export const CLOUDFLARE_DNS_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_cloudflare_dns_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-02/cloudflare-dns";
const PACKAGE_ROOT = path.join(ROOT, PACKAGE_RELATIVE);
const ENTRYPOINT = "control/cloudflare-dns-boundary-gate.mjs#evaluateCloudflareDnsBoundary";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fail(message, code = "CLOUDFLARE_DNS_PACKAGE_EVALUATION_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function read(file, label = file) {
  assert(fs.existsSync(file), `${label} is missing`, "CLOUDFLARE_DNS_PACKAGE_FILE_MISSING");
  return fs.readFileSync(file);
}

function readJson(file, label = file) {
  try { return JSON.parse(read(file, label)); } catch (error) { fail(`${label} is not valid JSON: ${error.message}`, "CLOUDFLARE_DNS_PACKAGE_JSON_INVALID"); }
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
  assert(names.length === CLOUDFLARE_DNS_FIXTURE_CLASSES.length, "Cloudflare DNS fixture inventory is incomplete", "CLOUDFLARE_DNS_FIXTURE_INVENTORY_INVALID");
  const fixtures = names.map((name) => {
    const file = path.join(directory, name);
    const fixture = readJson(file, `Cloudflare DNS fixture ${name}`);
    assert(fixture.block_id === CLOUDFLARE_DNS_BLOCK_ID && fixture.fixture_id === `cloudflare-dns-${fixture.class}` && fixture.hostile === true, `Cloudflare DNS fixture ${name} identity is invalid`, "CLOUDFLARE_DNS_FIXTURE_ID_INVALID");
    assert(CLOUDFLARE_DNS_FIXTURE_CLASSES.includes(fixture.class), `Cloudflare DNS fixture ${name} class is invalid`, "CLOUDFLARE_DNS_FIXTURE_CLASS_INVALID");
    assert(fixture.vector?.entrypoint === ENTRYPOINT && fixture.vector.input?.schema === CLOUDFLARE_DNS_BOUNDARY_SCHEMA, `Cloudflare DNS fixture ${name} is not executable`, "CLOUDFLARE_DNS_FIXTURE_UNBOUND");
    assert(fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `Cloudflare DNS fixture ${name} lacks an expected readback`, "CLOUDFLARE_DNS_FIXTURE_EXPECTATION_INVALID");
    assert(JSON.stringify(fixture.expected) === JSON.stringify(fixture.vector.expected_readback), `Cloudflare DNS fixture ${name} has contradictory expectations`, "CLOUDFLARE_DNS_FIXTURE_CONTRADICTION");
    return {name, file, fixture, file_sha256: sha(read(file))};
  });
  assert(new Set(fixtures.map(({fixture}) => fixture.class)).size === CLOUDFLARE_DNS_FIXTURE_CLASSES.length, "Cloudflare DNS fixture classes are not unique", "CLOUDFLARE_DNS_FIXTURE_CLASS_INVALID");
  return fixtures.sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id));
}

function validateGateExecution(fixtures) {
  const manifest = readJson(path.join(PACKAGE_ROOT, "gates/manifest.json"), "Cloudflare DNS gate manifest");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(CLOUDFLARE_DNS_GATE_IDS), "Cloudflare DNS gate manifest order is invalid", "CLOUDFLARE_DNS_GATE_ORDER_INVALID");
  const execution = readJson(path.join(PACKAGE_ROOT, "gates/execution.json"), "Cloudflare DNS gate execution");
  assert(execution.block_id === CLOUDFLARE_DNS_BLOCK_ID && execution.evaluator_entrypoint === "control/cloudflare-dns-package-evaluator.mjs#evaluateCloudflareDnsPackage", "Cloudflare DNS gate execution is not bound to the evaluator", "CLOUDFLARE_DNS_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(CLOUDFLARE_DNS_GATE_IDS) && execution.executions.length === CLOUDFLARE_DNS_GATE_IDS.length, "Cloudflare DNS gate execution is incomplete", "CLOUDFLARE_DNS_GATE_EXECUTION_INVALID");
  assert(execution.execution_sha256 === canonicalDigest({...execution, execution_sha256: null}), "Cloudflare DNS gate execution digest is invalid", "CLOUDFLARE_DNS_GATE_EXECUTION_DIGEST_INVALID");
  const byClass = new Map(fixtures.map((record) => [record.fixture.class, record]));
  const executions = execution.executions.map((entry) => {
    assert(CLOUDFLARE_DNS_GATE_IDS.includes(entry.gate_id) && byClass.has(entry.fixture_class), `Cloudflare DNS gate ${entry.gate_id} references an unknown fixture`, "CLOUDFLARE_DNS_GATE_EXECUTION_INVALID");
    const actual = byClass.get(entry.fixture_class).actual;
    assert(actual.disposition === entry.expected.disposition && actual.route === entry.expected.route && actual.error_code === entry.expected.error_code, `Cloudflare DNS gate ${entry.gate_id} readback differs`, "CLOUDFLARE_DNS_GATE_READBACK_FAILED");
    return {gate_id: entry.gate_id, fixture_class: entry.fixture_class, public_entrypoint_invoked: true, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code}, readback_sha256: canonicalDigest(actual)};
  });
  return {manifest_sha256: manifest.manifest_sha256, execution_sha256: execution.execution_sha256, executions};
}

async function mutationProof(fixture) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-cloudflare-dns-mutation-"));
  try {
    const control = path.join(directory, "control");
    fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const sourcePath = path.join(ROOT, "control/cloudflare-dns-boundary-gate.mjs");
    const targetPath = path.join(control, "cloudflare-dns-boundary-gate.mjs");
    let source = fs.readFileSync(sourcePath, "utf8");
    const anchor = 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_DNS_SIDE_EFFECT", "CLOUDFLARE_DNS_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Cloudflare DNS mutation anchor is missing", "CLOUDFLARE_DNS_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("ROUTE", "DNS_SPECIALIST_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed:true, selected_specialist:"specialist.platform.cloudflare-dns"});');
    fs.writeFileSync(targetPath, source, {flag: "wx"});
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`);
    const observed = mutated.evaluateCloudflareDnsBoundary(fixture.fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

export async function evaluateCloudflareDnsPackage() {
  const block = readJson(path.join(PACKAGE_ROOT, "block.json"), "Cloudflare DNS block");
  assert(block.block_id === CLOUDFLARE_DNS_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Cloudflare DNS package is not an inactive candidate", "CLOUDFLARE_DNS_PACKAGE_STATE_INVALID");
  const fixtures = loadFixtures();
  const fixtureResults = [];
  for (const record of fixtures) {
    let actual;
    try { actual = evaluateCloudflareDnsBoundary(record.fixture.vector.input); } catch (error) { fail(`${record.fixture.fixture_id} public entrypoint failed: ${error.code ?? error.message}`, "CLOUDFLARE_DNS_HOSTILE_EXECUTION_FAILED"); }
    record.actual = actual;
    const expected = record.fixture.vector.expected_readback;
    const zero = Object.values(actual.external_side_effects).every((value) => value === 0);
    const checks = [
      {assertion: "TYPED_DISPOSITION", observed: actual.disposition === expected.disposition, evidence: `${actual.disposition}/${expected.disposition}`},
      {assertion: "TYPED_ROUTE", observed: actual.route === expected.route, evidence: `${actual.route}/${expected.route}`},
      {assertion: "TYPED_ERROR", observed: actual.error_code === expected.error_code, evidence: `${actual.error_code}/${expected.error_code}`},
      {assertion: "NO_DNS_SIDE_EFFECT", observed: zero, evidence: JSON.stringify(actual.external_side_effects)},
      {assertion: "ACCEPTANCE_FORBIDDEN", observed: actual.acceptance_allowed === false, evidence: `${actual.acceptance_allowed}`},
      {assertion: "RESULT_DIGEST", observed: actual.result_sha256 === resultDigest(actual), evidence: actual.result_sha256},
    ];
    assert(checks.every((check) => check.observed), `${record.fixture.fixture_id} hostile readback failed`, "CLOUDFLARE_DNS_HOSTILE_RESULT_FAILED");
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
  assert(mutationSensitivity.status === "WEAKENED" && mutationSensitivity.mutation_detected === true, "Cloudflare DNS mutation proof did not execute", "CLOUDFLARE_DNS_MUTATION_PROOF_MISSING");
  const authority = resolveCloudflareDnsCanonicalAuthority();
  assert(authority.status === "BLOCKED_EXACT" && authority.model_policy.code === "POLICY_SNAPSHOT_STALE", "Cloudflare DNS protected model policy did not fail closed", "CLOUDFLARE_DNS_PROTECTED_POLICY_NOT_BLOCKED");
  const files = packageFiles().map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: sha(read(path.join(PACKAGE_ROOT, relativePath)))}));
  const evaluation = {
    schema: CLOUDFLARE_DNS_PACKAGE_EVALUATION_SCHEMA,
    version: 1,
    status: "BLOCKED_EXACT",
    local_status: "PASS_LOCAL_ONLY",
    block_id: CLOUDFLARE_DNS_BLOCK_ID,
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

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateCloudflareDnsPackage(), null, 2)}\n`);
