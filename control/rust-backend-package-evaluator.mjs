#!/usr/bin/env node

/* Local-only Rust Backend package evaluator. It never issues admission or clearance. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateRustBackendBoundary, RUST_BACKEND_BOUNDARY_SCHEMA, RUST_BACKEND_RESULT_SCHEMA, RUST_BACKEND_BLOCK_ID} from "./rust-backend-boundary-gate.mjs";
import {resolveRustBackendCanonicalAuthority, RUST_BACKEND_FIXTURE_CLASSES, RUST_BACKEND_GATE_IDS} from "./rust-backend-authority-binding.mjs";

export const RUST_BACKEND_PACKAGE_EVALUATION_SCHEMA = "agentos.rust_backend_package_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-02/rust-backend";
const PACKAGE_ROOT = path.join(ROOT, PACKAGE_RELATIVE);
const rawSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readFile = (file, label) => { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular file`); return fs.readFileSync(file); };
const readJson = (file, label) => JSON.parse(readFile(file, label).toString("utf8"));
const fail = (message, code = "RUST_BACKEND_PACKAGE_EVALUATION_INVALID") => { const error = new Error(message); error.code = code; throw error; };
const assert = (value, message, code) => { if (!value) fail(message, code); };

function assertBoundaryResult(actual, expected, label) {
  assert(actual && actual.schema === RUST_BACKEND_RESULT_SCHEMA && actual.version === 1, `${label} result schema is invalid`, "RUST_BACKEND_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result differs from typed expectation`, "RUST_BACKEND_FIXTURE_RESULT_MISMATCH");
  assert(expected.acceptance_allowed === false && actual.acceptance_allowed === false && actual.routing_allowed === (actual.disposition === "ROUTE"), `${label} result exposes capability`, "RUST_BACKEND_RESULT_CAPABILITY_INVALID");
  assert(expected.zero_side_effects === true && actual.external_side_effects && Object.values(actual.external_side_effects).every((value) => value === 0), `${label} side-effect readback is non-zero`, "RUST_BACKEND_RESULT_SIDE_EFFECT");
  assert(/^[0-9a-f]{64}$/u.test(actual.input_sha256) && /^[0-9a-f]{64}$/u.test(actual.result_sha256), `${label} result digest is missing`, "RUST_BACKEND_RESULT_DIGEST_INVALID");
  assert(actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "RUST_BACKEND_RESULT_DIGEST_INVALID");
  if (actual.disposition === "ROUTE") assert(actual.selected_specialist === RUST_BACKEND_BLOCK_ID && actual.handoff?.status === "WAITING_WITH_RECEIPT" && actual.handoff.execution_instruction === false, `${label} route handoff widens authority`, "RUST_BACKEND_RESULT_CAPABILITY_INVALID");
  return actual;
}

function fixtureMap() {
  const fixtureRoot = path.join(PACKAGE_ROOT, "fixtures");
  const names = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(names.length === RUST_BACKEND_FIXTURE_CLASSES.length, "Rust fixture inventory is not exact", "RUST_BACKEND_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const bytes = readFile(path.join(fixtureRoot, name), `Rust fixture ${name}`);
    const fixture = JSON.parse(bytes.toString("utf8"));
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === RUST_BACKEND_BLOCK_ID && fixture.hostile === true, `Rust fixture ${name} identity is invalid`, "RUST_BACKEND_FIXTURE_ID_INVALID");
    assert(RUST_BACKEND_FIXTURE_CLASSES.includes(fixture.class) && fixture.fixture_id === `rust-backend-${fixture.class}`, `Rust fixture ${name} class is invalid`, "RUST_BACKEND_FIXTURE_CLASS_INVALID");
    assert(fixture.vector?.entrypoint === "control/rust-backend-boundary-gate.mjs#evaluateRustBackendBoundary" && fixture.vector.input?.schema === RUST_BACKEND_BOUNDARY_SCHEMA, `Rust fixture ${name} is not bound to the public entrypoint`, "RUST_BACKEND_FIXTURE_UNBOUND");
    assert(fixture.vector?.expected_readback?.disposition === fixture.expected, `Rust fixture ${name} expectation is contradictory`, "RUST_BACKEND_FIXTURE_CONTRADICTION");
    assert(!map.has(fixture.class), `Duplicate Rust fixture class ${name}`, "RUST_BACKEND_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: rawSha256(bytes), relative_path: `${PACKAGE_RELATIVE}/fixtures/${name}`});
  }
  assert([...map.keys()].sort(compareUtf8).join("\0") === RUST_BACKEND_FIXTURE_CLASSES.slice().sort(compareUtf8).join("\0"), "Rust fixture classes are incomplete", "RUST_BACKEND_FIXTURE_CLASS_INVENTORY_INVALID");
  const manifest = readJson(path.join(PACKAGE_ROOT, "hostile-fixtures.manifest.json"), "Rust hostile fixture manifest");
  assert(manifest.schema === "agentos.rust_backend_hostile_fixture_manifest.v1" && manifest.version === 1 && manifest.block_id === RUST_BACKEND_BLOCK_ID && Array.isArray(manifest.entries), "Rust hostile fixture manifest identity is invalid", "RUST_BACKEND_FIXTURE_MANIFEST_INVALID");
  assert(manifest.entries.length === RUST_BACKEND_FIXTURE_CLASSES.length, "Rust hostile fixture manifest count is invalid", "RUST_BACKEND_FIXTURE_MANIFEST_INVALID");
  for (const entry of manifest.entries) {
    const className = entry.fixture_id?.replace(/^rust-backend-/u, "");
    const expectedPath = map.get(className)?.relative_path.replace(`${PACKAGE_RELATIVE}/`, "");
    assert(map.has(className) && entry.path === expectedPath && entry.expected_outcome === map.get(className).fixture.expected, `Rust hostile fixture manifest entry ${entry.fixture_id} is not exact`, "RUST_BACKEND_FIXTURE_MANIFEST_INVALID");
  }
  return map;
}

function executeFixture(entry, label = entry.fixture.fixture_id) {
  let actual;
  try { actual = evaluateRustBackendBoundary(entry.fixture.vector.input); } catch (error) { fail(`${label} public entrypoint threw ${error.code ?? error.message}`, "RUST_BACKEND_HOSTILE_EXECUTION_FAILED"); }
  return assertBoundaryResult(actual, entry.fixture.vector.expected_readback, label);
}

function executeGates(fixtureEntries, block) {
  const execution = readJson(path.join(PACKAGE_ROOT, "gates/execution.json"), "Rust gate execution");
  const manifest = readJson(path.join(PACKAGE_ROOT, "gates/manifest.json"), "Rust gate manifest");
  assert(execution.schema === "agentos.rust_backend_gate_execution.v1" && execution.version === 1 && execution.block_id === RUST_BACKEND_BLOCK_ID, "Rust gate execution identity is invalid", "RUST_BACKEND_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/rust-backend-package-evaluator.mjs#evaluateRustBackendPackage", "Rust gate evaluator entrypoint is not canonical", "RUST_BACKEND_GATE_EXECUTION_ENTRYPOINT_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(RUST_BACKEND_GATE_IDS) && JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(RUST_BACKEND_GATE_IDS), "Rust gate order is not canonical", "RUST_BACKEND_GATE_ORDER_INVALID");
  assert(Array.isArray(execution.executions) && execution.executions.length === RUST_BACKEND_GATE_IDS.length && execution.execution_sha256 === canonicalDigest({...execution, execution_sha256: null}), "Rust gate executions are incomplete or unsigned", "RUST_BACKEND_GATE_EXECUTION_INVALID");
  const seen = new Set();
  const results = [];
  for (const entry of execution.executions) {
    assert(RUST_BACKEND_GATE_IDS.includes(entry.gate_id) && !seen.has(entry.gate_id), `Rust gate execution ${entry.gate_id} is duplicated or unknown`, "RUST_BACKEND_GATE_EXECUTION_ID_INVALID");
    seen.add(entry.gate_id);
    const gate = readJson(path.join(PACKAGE_ROOT, "gates", `${entry.gate_id}.gate`), `Rust gate ${entry.gate_id}`);
    assert(gate.gate_id === entry.gate_id && gate.status === "EXECUTABLE", `Rust gate ${entry.gate_id} is not executable`, "RUST_BACKEND_GATE_NOT_EXECUTABLE");
    assert(entry.entrypoint === "control/rust-backend-boundary-gate.mjs#evaluateRustBackendBoundary", `Rust gate ${entry.gate_id} entrypoint is not bound`, "RUST_BACKEND_GATE_EXECUTION_ENTRYPOINT_INVALID");
    const fixtureEntry = fixtureEntries.get(entry.fixture_class);
    assert(fixtureEntry && JSON.stringify(entry.expected) === JSON.stringify(fixtureEntry.fixture.vector.expected_readback), `Rust gate ${entry.gate_id} is not bound to its executable fixture`, "RUST_BACKEND_GATE_EXPECTATION_UNBOUND");
    const actual = executeFixture(fixtureEntry, `Rust gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: entry.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, external_side_effects: actual.external_side_effects});
  }
  assert(seen.size === RUST_BACKEND_GATE_IDS.length && block.gate_pack?.ordered_gate_ids?.join("\0") === RUST_BACKEND_GATE_IDS.join("\0"), "Rust gate execution coverage is incomplete", "RUST_BACKEND_GATE_EXECUTION_COVERAGE_INVALID");
  return {execution_sha256: execution.execution_sha256, results};
}

async function mutationProof(fixture) {
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-rust-backend-mutation-"));
  try {
    const controlRoot = path.join(mutationRoot, "control");
    fs.mkdirSync(controlRoot, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(controlRoot, dependency));
    const sourcePath = path.join(ROOT, "control/rust-backend-boundary-gate.mjs");
    const targetPath = path.join(controlRoot, "rust-backend-boundary-gate.mjs");
    let source = readFile(sourcePath, "Rust boundary source").toString("utf8");
    const anchor = 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_RUST_BACKEND_SIDE_EFFECT", "RUST_BACKEND_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Rust mutation anchor is missing", "RUST_BACKEND_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("ROUTE", "RUST_BACKEND_SPECIALIST_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed: true, selected_specialist: "specialist.software-language-runtime.rust-backend"});');
    fs.writeFileSync(targetPath, source, {flag: "wx"});
    assert(fs.lstatSync(targetPath).isFile() && !fs.lstatSync(targetPath).isSymbolicLink(), "Rust mutation target is not isolated", "RUST_BACKEND_MUTATION_TARGET_INVALID");
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`);
    const observed = mutated.evaluateRustBackendBoundary(fixture.fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
}

function checkEvaluationDossier(fixtureEntries, block) {
  const evaluation = readJson(path.join(PACKAGE_ROOT, "evaluation.json"), "Rust evaluation dossier");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.block_id === RUST_BACKEND_BLOCK_ID, "Rust evaluation dossier identity differs", "RUST_BACKEND_EVALUATION_DOSSIER_INVALID");
  assert(evaluation.candidate_digest === block.block_sha256 && evaluation.independent_reviewer_required === true && evaluation.audit_status === "NOT_STARTED_BLOCKED_EXACT_PROTECTED_AUTHORITY", "Rust evaluation dossier is not bound to the candidate and independent review", "RUST_BACKEND_EVALUATION_DOSSIER_INVALID");
  assert(JSON.stringify(evaluation.cases.map((entry) => entry.class).sort(compareUtf8)) === JSON.stringify(RUST_BACKEND_FIXTURE_CLASSES.slice().sort(compareUtf8)), "Rust evaluation dossier fixture classes differ", "RUST_BACKEND_EVALUATION_DOSSIER_INVALID");
  for (const entry of evaluation.cases) assert(entry.expected === fixtureEntries.get(entry.class)?.fixture.expected, `Rust evaluation dossier expectation differs for ${entry.class}`, "RUST_BACKEND_EVALUATION_DOSSIER_INVALID");
  return {file_sha256: rawSha256(readFile(path.join(PACKAGE_ROOT, "evaluation.json"), "Rust evaluation dossier")), cases: evaluation.cases.length, disposition: evaluation.disposition};
}

function checkFixtureBindings(fixtureEntries, authority) {
  for (const entry of fixtureEntries.values()) {
    const evidence = entry.fixture.vector.input.evidence;
    assert(evidence.candidate_digest === authority.candidate.block_sha256, `${entry.fixture.fixture_id} candidate binding differs`, "RUST_BACKEND_FIXTURE_BINDING_INVALID");
    assert(evidence.source_manifest_sha256 === authority.candidate.source_manifest_sha256 && evidence.standard_block_sha256 === authority.standard.block_sha256, `${entry.fixture.fixture_id} source/standard binding differs`, "RUST_BACKEND_FIXTURE_BINDING_INVALID");
    assert(evidence.model_snapshot_sha256 === authority.model_policy.snapshot_sha256 && evidence.context_receipt_sha256 === authority.context.receipt_sha256 && evidence.upstream_router_result_sha256 === authority.upstream_router.result_sha256, `${entry.fixture.fixture_id} protected authority binding differs`, "RUST_BACKEND_FIXTURE_BINDING_INVALID");
    assert(evidence.memory_binding === "TYPED_CONTEXT_INVALIDATION_V1", `${entry.fixture.fixture_id} memory binding differs`, "RUST_BACKEND_FIXTURE_BINDING_INVALID");
  }
}

export async function evaluateRustBackendPackage() {
  const block = readJson(path.join(PACKAGE_ROOT, "block.json"), "Rust block");
  assert(block.block_id === RUST_BACKEND_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Rust package is not an inactive candidate", "RUST_BACKEND_PACKAGE_STATE_INVALID");
  assert(block.block_sha256 === canonicalDigest({...block, block_sha256: null}), "Rust block digest is not self-consistent", "RUST_BACKEND_PACKAGE_PROVENANCE_INVALID");
  const fixtureEntries = fixtureMap();
  const fixtureResults = [];
  for (const entry of [...fixtureEntries.values()].sort((left, right) => compareUtf8(left.fixture.fixture_id, right.fixture.fixture_id))) {
    const started = Date.now();
    const actual = executeFixture(entry);
    const record = {fixture_id: entry.fixture.fixture_id, fixture_class: entry.fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: entry.fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: entry.fixture.vector.expected_readback.disposition, actual_outcome: actual.disposition, expected_route: entry.fixture.vector.expected_readback.route, actual_route: actual.route, expected_error_code: entry.fixture.vector.expected_readback.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, acceptance_allowed: actual.acceptance_allowed, duration_ms: Date.now() - started, result_sha256: null};
    record.result_sha256 = canonicalDigest(record);
    fixtureResults.push(record);
  }
  const gate = executeGates(fixtureEntries, block);
  const mutation = await mutationProof(fixtureEntries.get("unsafe_action"));
  assert(mutation.status === "WEAKENED" && mutation.mutation_detected === true, "Rust mutation proof did not execute", "RUST_BACKEND_MUTATION_PROOF_MISSING");
  const authority = resolveRustBackendCanonicalAuthority();
  assert(authority.status === "BLOCKED_EXACT" && authority.model_policy.code === "POLICY_SNAPSHOT_STALE", "Rust policy blocker was not preserved exactly", "RUST_BACKEND_POLICY_BLOCKER_LOST");
  assert(authority.protected_blockers.some((blocker) => blocker.code === "CANONICAL_EVALUATOR_HANDOFF_REQUIRED" && blocker.status === "BLOCKED_EXACT"), "Rust evaluator handoff blocker was not preserved exactly", "RUST_BACKEND_EVALUATOR_BLOCKER_LOST");
  checkFixtureBindings(fixtureEntries, authority);
  const dossier = checkEvaluationDossier(fixtureEntries, block);
  const evaluation = {
    schema: RUST_BACKEND_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "BLOCKED_EXACT", local_status: "PASS_LOCAL_ONLY",
    blocker: {code: "POLICY_SNAPSHOT_STALE", owner: "Spawner/root protected global authority", admission_allowed: false}, protected_blockers: authority.protected_blockers,
    block_id: RUST_BACKEND_BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", ready_for_admission: false, package_root_sha256: authority.candidate.package_files_sha256,
    package_block_sha256: authority.candidate.block_sha256, gate_inventory_sha256: canonicalDigest(authority.gates), fixture_inventory_sha256: canonicalDigest(authority.fixtures), gate_execution: gate,
    fixture_results: fixtureResults, fixture_count: fixtureResults.length, gate_count: gate.results.length, mutation_sensitivity: mutation,
    independent_signature_required: true, independent_audit_required: true, audit_started: false, audit_verdict: "NOT_STARTED / BLOCKED_EXACT",
    observed_at_utc: new Date().toISOString(), authority_sha256: authority.authority_sha256, model_snapshot_sha256: authority.model_policy.snapshot_sha256,
    model_policy_status: authority.model_policy.status, model_policy_blocker: authority.model_policy.code, evaluator_handoff_status: "BLOCKED_EXACT",
    context_receipt_sha256: authority.context.receipt_sha256, upstream_router_result_sha256: authority.upstream_router.result_sha256, source_manifest_sha256: authority.candidate.source_manifest_sha256,
    standard_block_sha256: authority.standard.block_sha256, evaluation_dossier_file_sha256: dossier.file_sha256, handoff_file_sha256: authority.handoff.file_sha256, evaluation_sha256: null,
  };
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateRustBackendPackage(), null, 2)}\n`);
