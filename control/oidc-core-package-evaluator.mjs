#!/usr/bin/env node

/* Operational evaluator for the OIDC Core candidate; local evidence only. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateOidcCoreBoundary, OIDC_CORE_BOUNDARY_SCHEMA, OIDC_CORE_RESULT_SCHEMA} from "./oidc-core-boundary-gate.mjs";
import {
  OIDC_CORE_BLOCK_ID,
  OIDC_CORE_FIXTURE_CLASSES,
  OIDC_CORE_GATE_IDS,
  resolveOidcCoreCanonicalAuthority,
} from "./oidc-core-authority-binding.mjs";

export const OIDC_CORE_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_oidc_core_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-02/oidc-core";
const SHA256 = /^[0-9a-f]{64}$/u;
const DISPOSITIONS = new Set(["DENY", "ESCALATE", "ROUTE"]);
const rawSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readFile = (file, label) => { let stat; try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "OIDC_CORE_PACKAGE_FILE_MISSING"); } assert(stat.isFile() && !stat.isSymbolicLink(), `${label} is not a regular file`, "OIDC_CORE_PACKAGE_FILE_INVALID"); return fs.readFileSync(file); };
const readJson = (file, label) => { try { return JSON.parse(readFile(file, label)); } catch (error) { if (error.code?.startsWith("OIDC_CORE_PACKAGE_")) throw error; fail(`${label} is not valid JSON`, "OIDC_CORE_PACKAGE_FILE_INVALID"); } };
function fail(message, code = "OIDC_CORE_PACKAGE_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function assertDigest(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} is not a SHA-256`, "OIDC_CORE_RESULT_DIGEST_INVALID"); }
function packageFiles(packageRoot) { const names = ["block.json", "sources.lock", "gates/execution.json", "gates/manifest.json", "evaluation.json", "handoff.json"]; const gates = fs.readdirSync(path.join(packageRoot, "gates")).filter((name) => name.endsWith(".gate")).map((name) => `gates/${name}`); const fixtures = fs.readdirSync(path.join(packageRoot, "fixtures")).filter((name) => name.endsWith(".json")).map((name) => `fixtures/${name}`); return [...new Set([...names, ...gates, ...fixtures])].sort(compareUtf8); }

function assertBoundaryResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} result is not an object`, "OIDC_CORE_RESULT_SCHEMA_INVALID");
  assert(actual.schema === OIDC_CORE_RESULT_SCHEMA && actual.version === 1 && DISPOSITIONS.has(actual.disposition), `${label} result identity differs`, "OIDC_CORE_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result disposition/route/error differs`, "OIDC_CORE_HOSTILE_RESULT_FAILED");
  assert(expected.zero_side_effects === true && expected.acceptance_allowed === false, `${label} expectation exposes a capability`, "OIDC_CORE_RESULT_CAPABILITY_INVALID");
  assert(actual.acceptance_allowed === false, `${label} result permits acceptance`, "OIDC_CORE_RESULT_CAPABILITY_INVALID");
  assert(actual.external_side_effects && Object.values(actual.external_side_effects).every((value) => value === 0), `${label} side-effect readback is non-zero`, "OIDC_CORE_RESULT_SIDE_EFFECT");
  assertDigest(actual.input_sha256, `${label}.input_sha256`); assertDigest(actual.result_sha256, `${label}.result_sha256`); assert(actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "OIDC_CORE_RESULT_DIGEST_INVALID");
  if (actual.disposition === "ROUTE") assert(actual.routing_allowed === true && actual.selected_specialist === OIDC_CORE_BLOCK_ID && actual.handoff?.status === "WAITING_WITH_RECEIPT" && actual.handoff.execution_instruction === false, `${label} route handoff widens authority`, "OIDC_CORE_RESULT_CAPABILITY_INVALID");
  else assert(actual.routing_allowed === false, `${label} non-route result exposes routing`, "OIDC_CORE_RESULT_CAPABILITY_INVALID");
  return actual;
}

function fixtureMap(packageRoot) {
  const fixtureRoot = path.join(packageRoot, "fixtures"); const names = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(names.length === OIDC_CORE_FIXTURE_CLASSES.length && new Set(names).size === names.length, "OIDC fixture inventory is not exact", "OIDC_CORE_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const bytes = readFile(path.join(fixtureRoot, name), `OIDC fixture ${name}`); const fixture = JSON.parse(bytes);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === OIDC_CORE_BLOCK_ID && fixture.hostile === true, `OIDC fixture ${name} identity is invalid`, "OIDC_CORE_FIXTURE_ID_INVALID");
    assert(OIDC_CORE_FIXTURE_CLASSES.includes(fixture.class) && fixture.fixture_id === `oidc-core-${fixture.class}`, `OIDC fixture ${name} class is invalid`, "OIDC_CORE_FIXTURE_CLASS_INVALID");
    assert(fixture.expected === fixture.vector?.expected_readback?.disposition && fixture.vector?.entrypoint === "control/oidc-core-boundary-gate.mjs#evaluateOidcCoreBoundary" && fixture.vector.input?.schema === OIDC_CORE_BOUNDARY_SCHEMA, `OIDC fixture ${name} is not bound to the public entrypoint`, "OIDC_CORE_FIXTURE_UNBOUND");
    const expectedKeys = Object.keys(fixture.vector.expected_readback ?? {}).sort(compareUtf8).join("\0");
    assert(expectedKeys === ["acceptance_allowed", "disposition", "error_code", "route", "zero_side_effects"].sort(compareUtf8).join("\0"), `OIDC fixture ${name} readback shape is invalid`, "OIDC_CORE_FIXTURE_EXPECTATION_INVALID");
    assert(!map.has(fixture.class), `Duplicate OIDC fixture class ${name}`, "OIDC_CORE_FIXTURE_ALIAS"); map.set(fixture.class, {fixture, file_sha256: rawSha256(bytes), relative_path: `${PACKAGE_RELATIVE}/fixtures/${name}`});
  }
  assert([...map.keys()].sort(compareUtf8).join("\0") === OIDC_CORE_FIXTURE_CLASSES.slice().sort(compareUtf8).join("\0"), "OIDC fixture classes are incomplete", "OIDC_CORE_FIXTURE_CLASS_INVENTORY_INVALID"); return map;
}
function executeFixture(entry, label = entry.fixture.fixture_id) { let actual; try { actual = evaluateOidcCoreBoundary(entry.fixture.vector.input); } catch (error) { fail(`${label} public entrypoint threw ${error.code ?? error.message}`, "OIDC_CORE_HOSTILE_EXECUTION_FAILED"); } return assertBoundaryResult(actual, entry.fixture.vector.expected_readback, label); }

function executeGates(packageRoot, fixtureEntries, block) {
  const execution = readJson(path.join(packageRoot, "gates/execution.json"), "OIDC gate execution"); const manifest = readJson(path.join(packageRoot, "gates/manifest.json"), "OIDC gate manifest");
  assert(execution.schema === "agentos.oidc_core_gate_execution.v1" && execution.version === 1 && execution.block_id === OIDC_CORE_BLOCK_ID, "OIDC gate execution identity is invalid", "OIDC_CORE_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/oidc-core-package-evaluator.mjs#evaluateOidcCorePackage", "OIDC gate evaluator entrypoint is not canonical", "OIDC_CORE_GATE_EXECUTION_ENTRYPOINT_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(OIDC_CORE_GATE_IDS) && JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(OIDC_CORE_GATE_IDS), "OIDC gate order is not canonical", "OIDC_CORE_GATE_ORDER_INVALID");
  assert(Array.isArray(execution.executions) && execution.executions.length === OIDC_CORE_GATE_IDS.length && execution.execution_sha256 === canonicalDigest({...execution, execution_sha256: null}), "OIDC gate executions are incomplete or unsigned", "OIDC_CORE_GATE_EXECUTION_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(OIDC_CORE_GATE_IDS.includes(entry.gate_id) && !seen.has(entry.gate_id), `OIDC gate execution ${entry.gate_id} is duplicated or unknown`, "OIDC_CORE_GATE_EXECUTION_ID_INVALID"); seen.add(entry.gate_id);
    const gate = readJson(path.join(packageRoot, "gates", `${entry.gate_id}.gate`), `OIDC gate ${entry.gate_id}`); assert(gate.gate_id === entry.gate_id && gate.status === "EXECUTABLE", `OIDC gate ${entry.gate_id} is not executable`, "OIDC_CORE_GATE_NOT_EXECUTABLE");
    const fixtureEntry = fixtureEntries.get(entry.fixture_class); assert(fixtureEntry && JSON.stringify(entry.expected) === JSON.stringify(fixtureEntry.fixture.vector.expected_readback), `OIDC gate ${entry.gate_id} is not bound to its executable fixture`, "OIDC_CORE_GATE_EXPECTATION_UNBOUND");
    const actual = executeFixture(fixtureEntry, `OIDC gate ${entry.gate_id}`); results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: execution.evaluator_entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, external_side_effects: actual.external_side_effects});
  }
  assert(seen.size === OIDC_CORE_GATE_IDS.length && block.gate_pack?.ordered_gate_ids?.join("\0") === OIDC_CORE_GATE_IDS.join("\0"), "OIDC gate execution coverage is incomplete", "OIDC_CORE_GATE_EXECUTION_COVERAGE_INVALID"); return {execution_sha256: execution.execution_sha256, results};
}

async function mutationProof(fixture) {
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-oidc-core-mutation-"));
  try {
    const controlRoot = path.join(mutationRoot, "control"); fs.mkdirSync(controlRoot, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(controlRoot, dependency));
    const sourcePath = path.join(ROOT, "control/oidc-core-boundary-gate.mjs"); const targetPath = path.join(controlRoot, "oidc-core-boundary-gate.mjs"); let source = readFile(sourcePath, "OIDC boundary source").toString("utf8");
    const anchor = 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("DENY", "NO_OIDC_CORE_SIDE_EFFECT", "OIDC_CORE_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "OIDC mutation anchor is missing", "OIDC_CORE_MUTATION_ANCHOR_MISSING"); source = source.replace(anchor, 'if (FORBIDDEN_REQUESTS.has(input.request_kind) || flags.unsafe_action === true) return result("ROUTE", "OIDC_CORE_SPECIALIST_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed: true, selected_specialist: "specialist.security.oidc-core"});');
    fs.writeFileSync(targetPath, source, {flag: "wx"}); assert(fs.lstatSync(targetPath).isFile() && !fs.lstatSync(targetPath).isSymbolicLink(), "OIDC mutation target is not isolated", "OIDC_CORE_MUTATION_TARGET_INVALID");
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`); const observed = mutated.evaluateOidcCoreBoundary(fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
}

function checkEvaluationDossier(packageRoot, block, fixtureEntries) {
  const evaluation = readJson(path.join(packageRoot, "evaluation.json"), "OIDC evaluation dossier"); assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.block_id === OIDC_CORE_BLOCK_ID, "OIDC evaluation dossier identity differs", "OIDC_CORE_EVALUATION_DOSSIER_INVALID");
  assert(evaluation.candidate_digest === block.block_sha256 && evaluation.independent_reviewer_required === true, "OIDC evaluation dossier is not bound to the candidate and independent review", "OIDC_CORE_EVALUATION_DOSSIER_INVALID");
  assert(JSON.stringify(evaluation.cases.map((entry) => entry.class).sort(compareUtf8)) === JSON.stringify(OIDC_CORE_FIXTURE_CLASSES.slice().sort(compareUtf8)), "OIDC evaluation dossier fixture classes differ", "OIDC_CORE_EVALUATION_DOSSIER_INVALID");
  for (const entry of evaluation.cases) assert(entry.expected === fixtureEntries.get(entry.class)?.fixture.expected, `OIDC evaluation dossier expectation differs for ${entry.class}`, "OIDC_CORE_EVALUATION_DOSSIER_INVALID");
  return {file_sha256: rawSha256(readFile(path.join(packageRoot, "evaluation.json"), "OIDC evaluation dossier")), cases: evaluation.cases.length, disposition: evaluation.disposition};
}

export async function evaluateOidcCorePackage() {
  const packageRoot = path.join(ROOT, PACKAGE_RELATIVE); const block = readJson(path.join(packageRoot, "block.json"), "OIDC block");
  assert(block.block_id === OIDC_CORE_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "OIDC package is not an inactive candidate", "OIDC_CORE_PACKAGE_STATE_INVALID"); assert(block.block_sha256 === canonicalDigest({...block, block_sha256: null}), "OIDC block digest is not self-consistent", "OIDC_CORE_PACKAGE_PROVENANCE_INVALID");
  const files = packageFiles(packageRoot); assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === OIDC_CORE_GATE_IDS.length, "OIDC gate inventory is incomplete", "OIDC_CORE_GATE_INVENTORY_INVALID");
  const fixtureEntries = fixtureMap(packageRoot); const fixtureResults = [];
  for (const entry of [...fixtureEntries.values()].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id))) {
    const started = Date.now(); const actual = executeFixture(entry); const record = {fixture_id: entry.fixture.fixture_id, fixture_class: entry.fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: entry.fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: entry.fixture.vector.expected_readback.disposition, actual_outcome: actual.disposition, expected_route: entry.fixture.vector.expected_readback.route, actual_route: actual.route, expected_error_code: entry.fixture.vector.expected_readback.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, acceptance_allowed: actual.acceptance_allowed, duration_ms: Date.now() - started, result_sha256: null}; record.result_sha256 = canonicalDigest(record); fixtureResults.push(record);
  }
  const gate = executeGates(packageRoot, fixtureEntries, block); const mutation = await mutationProof(fixtureEntries.get("unsafe_action").fixture); assert(mutation.status === "WEAKENED" && mutation.mutation_detected === true, "OIDC mutation proof did not execute", "OIDC_CORE_MUTATION_PROOF_MISSING");
  const authority = resolveOidcCoreCanonicalAuthority(); assert(authority.status === "BLOCKED_EXACT" && authority.model_policy.code === "POLICY_SNAPSHOT_STALE", "OIDC policy blocker was not preserved exactly", "OIDC_CORE_POLICY_BLOCKER_LOST");
  const dossier = checkEvaluationDossier(packageRoot, block, fixtureEntries); const fileDigests = files.map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: rawSha256(readFile(path.join(packageRoot, relativePath), `OIDC package file ${relativePath}`))}));
  const evaluation = {schema: OIDC_CORE_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "BLOCKED_EXACT", local_status: "PASS_LOCAL_ONLY", blocker: {code: "POLICY_SNAPSHOT_STALE", owner: "Spawner/root protected global authority", admission_allowed: false}, block_id: OIDC_CORE_BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", ready_for_admission: false, package_root_sha256: canonicalDigest(fileDigests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/fixtures/"))), gate_execution: gate, fixture_results: fixtureResults, fixture_count: fixtureResults.length, gate_count: gate.results.length, mutation_sensitivity: mutation, independent_signature_required: true, independent_audit_required: true, audit_started: false, observed_at_utc: new Date().toISOString(), authority_sha256: authority.authority_sha256, model_snapshot_sha256: authority.model_policy.snapshot_sha256, model_policy_status: authority.model_policy.status, model_policy_blocker: authority.model_policy.code, context_receipt_sha256: authority.context.receipt_sha256, upstream_router_result_sha256: authority.upstream_router.result_sha256, source_manifest_sha256: authority.candidate.source_manifest_sha256, standard_block_sha256: authority.standard.block_sha256, evaluation_dossier_file_sha256: dossier.file_sha256, handoff_file_sha256: authority.handoff.file_sha256, evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateOidcCorePackage(), null, 2)}\n`);
