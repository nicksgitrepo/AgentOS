#!/usr/bin/env node

/* Local-only React package evaluator. It never issues admission or clearance. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateReactComponentsBoundary, REACT_COMPONENTS_BOUNDARY_SCHEMA, REACT_COMPONENTS_RESULT_SCHEMA, REACT_COMPONENTS_BLOCK_ID} from "./react-components-boundary-gate.mjs";
import {resolveReactComponentsCanonicalAuthority, REACT_COMPONENTS_FIXTURE_CLASSES, REACT_COMPONENTS_GATE_IDS} from "./react-components-authority-binding.mjs";

export const REACT_COMPONENTS_PACKAGE_EVALUATION_SCHEMA = "agentos.react_components_package_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-02/react-components";
const PACKAGE_ROOT = path.join(ROOT, PACKAGE_RELATIVE);
const rawSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readFile = (file, label) => { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular file`); return fs.readFileSync(file); };
const readJson = (file, label) => JSON.parse(readFile(file, label).toString("utf8"));
const fail = (message, code = "REACT_COMPONENTS_PACKAGE_EVALUATION_INVALID") => { const error = new Error(message); error.code = code; throw error; };
const assert = (value, message, code) => { if (!value) fail(message, code); };

function assertBoundaryResult(actual, expected, label) {
  assert(actual && actual.schema === REACT_COMPONENTS_RESULT_SCHEMA && actual.version === 1, `${label} result schema is invalid`, "REACT_COMPONENTS_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result differs from typed expectation`, "REACT_COMPONENTS_FIXTURE_RESULT_MISMATCH");
  assert(expected.acceptance_allowed === false && actual.acceptance_allowed === false && actual.routing_allowed === (actual.disposition === "ROUTE"), `${label} result exposes capability`, "REACT_COMPONENTS_RESULT_CAPABILITY_INVALID");
  assert(expected.zero_side_effects === true && actual.external_side_effects && Object.values(actual.external_side_effects).every((value) => value === 0), `${label} side-effect readback is non-zero`, "REACT_COMPONENTS_RESULT_SIDE_EFFECT");
  assert(/^[0-9a-f]{64}$/u.test(actual.input_sha256) && /^[0-9a-f]{64}$/u.test(actual.result_sha256), `${label} result digest is missing`, "REACT_COMPONENTS_RESULT_DIGEST_INVALID");
  assert(actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "REACT_COMPONENTS_RESULT_DIGEST_INVALID");
  if (actual.disposition === "ROUTE") assert(actual.selected_specialist === REACT_COMPONENTS_BLOCK_ID && actual.handoff?.status === "WAITING_WITH_RECEIPT" && actual.handoff.execution_instruction === false, `${label} route handoff widens authority`, "REACT_COMPONENTS_RESULT_CAPABILITY_INVALID");
  return actual;
}

function fixtureMap() {
  const fixtureRoot = path.join(PACKAGE_ROOT, "fixtures");
  const names = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(names.length === REACT_COMPONENTS_FIXTURE_CLASSES.length, "React fixture inventory is not exact", "REACT_COMPONENTS_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const bytes = readFile(path.join(fixtureRoot, name), `React fixture ${name}`); const fixture = JSON.parse(bytes.toString("utf8"));
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === REACT_COMPONENTS_BLOCK_ID && fixture.hostile === true, `React fixture ${name} identity is invalid`, "REACT_COMPONENTS_FIXTURE_ID_INVALID");
    assert(REACT_COMPONENTS_FIXTURE_CLASSES.includes(fixture.class) && fixture.fixture_id === `react-components-${fixture.class}`, `React fixture ${name} class is invalid`, "REACT_COMPONENTS_FIXTURE_CLASS_INVALID");
    assert(fixture.vector?.entrypoint === "control/react-components-boundary-gate.mjs#evaluateReactComponentsBoundary" && fixture.vector.input?.schema === REACT_COMPONENTS_BOUNDARY_SCHEMA, `React fixture ${name} is not bound to the public entrypoint`, "REACT_COMPONENTS_FIXTURE_UNBOUND");
    assert(fixture.vector?.expected_readback?.disposition === fixture.expected, `React fixture ${name} expectation is contradictory`, "REACT_COMPONENTS_FIXTURE_CONTRADICTION");
    assert(!map.has(fixture.class), `Duplicate React fixture class ${name}`, "REACT_COMPONENTS_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: rawSha256(bytes), relative_path: `${PACKAGE_RELATIVE}/fixtures/${name}`});
  }
  assert([...map.keys()].sort(compareUtf8).join("\0") === REACT_COMPONENTS_FIXTURE_CLASSES.slice().sort(compareUtf8).join("\0"), "React fixture classes are incomplete", "REACT_COMPONENTS_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function executeFixture(entry, label = entry.fixture.fixture_id) {
  let actual;
  try { actual = evaluateReactComponentsBoundary(entry.fixture.vector.input); } catch (error) { fail(`${label} public entrypoint threw ${error.code ?? error.message}`, "REACT_COMPONENTS_HOSTILE_EXECUTION_FAILED"); }
  return assertBoundaryResult(actual, entry.fixture.vector.expected_readback, label);
}

function executeGates(fixtureEntries, block) {
  const execution = readJson(path.join(PACKAGE_ROOT, "gates/execution.json"), "React gate execution");
  const manifest = readJson(path.join(PACKAGE_ROOT, "gates/manifest.json"), "React gate manifest");
  assert(execution.schema === "agentos.react_components_gate_execution.v1" && execution.version === 1 && execution.block_id === REACT_COMPONENTS_BLOCK_ID, "React gate execution identity is invalid", "REACT_COMPONENTS_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/react-components-package-evaluator.mjs#evaluateReactComponentsPackage", "React gate evaluator entrypoint is not canonical", "REACT_COMPONENTS_GATE_EXECUTION_ENTRYPOINT_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(REACT_COMPONENTS_GATE_IDS) && JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(REACT_COMPONENTS_GATE_IDS), "React gate order is not canonical", "REACT_COMPONENTS_GATE_ORDER_INVALID");
  assert(Array.isArray(execution.executions) && execution.executions.length === REACT_COMPONENTS_GATE_IDS.length && execution.execution_sha256 === canonicalDigest({...execution, execution_sha256: null}), "React gate executions are incomplete or unsigned", "REACT_COMPONENTS_GATE_EXECUTION_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(REACT_COMPONENTS_GATE_IDS.includes(entry.gate_id) && !seen.has(entry.gate_id), `React gate execution ${entry.gate_id} is duplicated or unknown`, "REACT_COMPONENTS_GATE_EXECUTION_ID_INVALID"); seen.add(entry.gate_id);
    const gate = readJson(path.join(PACKAGE_ROOT, "gates", `${entry.gate_id}.gate`), `React gate ${entry.gate_id}`);
    assert(gate.gate_id === entry.gate_id && gate.status === "EXECUTABLE", `React gate ${entry.gate_id} is not executable`, "REACT_COMPONENTS_GATE_NOT_EXECUTABLE");
    const fixtureEntry = fixtureEntries.get(entry.fixture_class); assert(fixtureEntry && JSON.stringify(entry.expected) === JSON.stringify(fixtureEntry.fixture.vector.expected_readback), `React gate ${entry.gate_id} is not bound to its executable fixture`, "REACT_COMPONENTS_GATE_EXPECTATION_UNBOUND");
    const actual = executeFixture(fixtureEntry, `React gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: execution.evaluator_entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, external_side_effects: actual.external_side_effects});
  }
  assert(seen.size === REACT_COMPONENTS_GATE_IDS.length && block.gate_pack?.ordered_gate_ids?.join("\0") === REACT_COMPONENTS_GATE_IDS.join("\0"), "React gate execution coverage is incomplete", "REACT_COMPONENTS_GATE_EXECUTION_COVERAGE_INVALID");
  return {execution_sha256: execution.execution_sha256, results};
}

async function mutationProof(fixture) {
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-react-components-mutation-"));
  try {
    const controlRoot = path.join(mutationRoot, "control"); fs.mkdirSync(controlRoot, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(controlRoot, dependency));
    const sourcePath = path.join(ROOT, "control/react-components-boundary-gate.mjs"); const targetPath = path.join(controlRoot, "react-components-boundary-gate.mjs"); let source = readFile(sourcePath, "React boundary source").toString("utf8");
    const anchor = 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_REACT_COMPONENTS_SIDE_EFFECT", "REACT_COMPONENTS_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "React mutation anchor is missing", "REACT_COMPONENTS_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("ROUTE", "REACT_COMPONENTS_SPECIALIST_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed: true, selected_specialist: "specialist.software-language-runtime.react-components"});');
    fs.writeFileSync(targetPath, source, {flag: "wx"}); assert(fs.lstatSync(targetPath).isFile() && !fs.lstatSync(targetPath).isSymbolicLink(), "React mutation target is not isolated", "REACT_COMPONENTS_MUTATION_TARGET_INVALID");
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`); const observed = mutated.evaluateReactComponentsBoundary(fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
}

function checkEvaluationDossier(fixtureEntries, block) {
  const evaluation = readJson(path.join(PACKAGE_ROOT, "evaluation.json"), "React evaluation dossier");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.block_id === REACT_COMPONENTS_BLOCK_ID, "React evaluation dossier identity differs", "REACT_COMPONENTS_EVALUATION_DOSSIER_INVALID");
  assert(evaluation.candidate_digest === block.block_sha256 && evaluation.independent_reviewer_required === true, "React evaluation dossier is not bound to the candidate and independent review", "REACT_COMPONENTS_EVALUATION_DOSSIER_INVALID");
  assert(JSON.stringify(evaluation.cases.map((entry) => entry.class).sort(compareUtf8)) === JSON.stringify(REACT_COMPONENTS_FIXTURE_CLASSES.slice().sort(compareUtf8)), "React evaluation dossier fixture classes differ", "REACT_COMPONENTS_EVALUATION_DOSSIER_INVALID");
  for (const entry of evaluation.cases) assert(entry.expected === fixtureEntries.get(entry.class)?.fixture.expected, `React evaluation dossier expectation differs for ${entry.class}`, "REACT_COMPONENTS_EVALUATION_DOSSIER_INVALID");
  return {file_sha256: rawSha256(readFile(path.join(PACKAGE_ROOT, "evaluation.json"), "React evaluation dossier")), cases: evaluation.cases.length, disposition: evaluation.disposition};
}

export async function evaluateReactComponentsPackage() {
  const block = readJson(path.join(PACKAGE_ROOT, "block.json"), "React block");
  assert(block.block_id === REACT_COMPONENTS_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "React package is not an inactive candidate", "REACT_COMPONENTS_PACKAGE_STATE_INVALID");
  assert(block.block_sha256 === canonicalDigest({...block, block_sha256: null}), "React block digest is not self-consistent", "REACT_COMPONENTS_PACKAGE_PROVENANCE_INVALID");
  const fixtureEntries = fixtureMap(); const fixtureResults = [];
  for (const entry of [...fixtureEntries.values()].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id))) {
    const started = Date.now(); const actual = executeFixture(entry); const record = {fixture_id: entry.fixture.fixture_id, fixture_class: entry.fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: entry.fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: entry.fixture.vector.expected_readback.disposition, actual_outcome: actual.disposition, expected_route: entry.fixture.vector.expected_readback.route, actual_route: actual.route, expected_error_code: entry.fixture.vector.expected_readback.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, acceptance_allowed: actual.acceptance_allowed, duration_ms: Date.now() - started, result_sha256: null}; record.result_sha256 = canonicalDigest(record); fixtureResults.push(record);
  }
  const gate = executeGates(fixtureEntries, block); const mutation = await mutationProof(fixtureEntries.get("unsafe_action").fixture); assert(mutation.status === "WEAKENED" && mutation.mutation_detected === true, "React mutation proof did not execute", "REACT_COMPONENTS_MUTATION_PROOF_MISSING");
  const authority = resolveReactComponentsCanonicalAuthority(); assert(authority.status === "BLOCKED_EXACT" && authority.model_policy.code === "POLICY_SNAPSHOT_STALE", "React policy blocker was not preserved exactly", "REACT_COMPONENTS_POLICY_BLOCKER_LOST");
  assert(authority.protected_blockers.some((blocker) => blocker.code === "CANONICAL_EVALUATOR_HANDOFF_REQUIRED" && blocker.status === "BLOCKED_EXACT"), "React evaluator handoff blocker was not preserved exactly", "REACT_COMPONENTS_EVALUATOR_BLOCKER_LOST");
  const dossier = checkEvaluationDossier(fixtureEntries, readJson(path.join(PACKAGE_ROOT, "block.json"), "React block"));
  const fileDigests = authority.candidate.package_files_sha256;
  const evaluation = {
    schema: REACT_COMPONENTS_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "BLOCKED_EXACT", local_status: "PASS_LOCAL_ONLY",
    blocker: {code: "POLICY_SNAPSHOT_STALE", owner: "Spawner/root protected global authority", admission_allowed: false}, protected_blockers: authority.protected_blockers,
    block_id: REACT_COMPONENTS_BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", ready_for_admission: false, package_root_sha256: fileDigests,
    package_block_sha256: authority.candidate.block_sha256, gate_inventory_sha256: canonicalDigest(authority.gates), fixture_inventory_sha256: canonicalDigest(authority.fixtures), gate_execution: gate,
    fixture_results: fixtureResults, fixture_count: fixtureResults.length, gate_count: gate.results.length, mutation_sensitivity: mutation,
    independent_signature_required: true, independent_audit_required: true, audit_started: false, audit_verdict: "NOT_STARTED / BLOCKED_EXACT",
    observed_at_utc: new Date().toISOString(), authority_sha256: authority.authority_sha256, model_snapshot_sha256: authority.model_policy.snapshot_sha256,
    model_policy_status: authority.model_policy.status, model_policy_blocker: authority.model_policy.code, evaluator_handoff_status: "BLOCKED_EXACT",
    context_receipt_sha256: authority.context.receipt_sha256, upstream_router_result_sha256: authority.upstream_router.result_sha256, source_manifest_sha256: authority.candidate.source_manifest_sha256,
    standard_block_sha256: authority.standard.block_sha256, evaluation_dossier_file_sha256: dossier.file_sha256, handoff_file_sha256: authority.handoff.file_sha256, evaluation_sha256: null,
  };
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateReactComponentsPackage(), null, 2)}\n`);
