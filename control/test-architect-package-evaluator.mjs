#!/usr/bin/env node

/* Operational evaluator for the Test Architecture specialist candidate. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL, fileURLToPath} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateTestArchitectBoundary, TEST_ARCHITECT_INPUT_SCHEMA} from "./test-architect-boundary-gate.mjs";
import {
  assertTestArchitectCommittedHandoff,
  TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256,
  resolveTestArchitectCanonicalAuthority,
} from "./test-architect-authority-binding.mjs";

export const TEST_ARCHITECT_EVALUATION_SCHEMA = "agentos.specialist_test_architect_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-04/test-architect";
const BLOCK_ID = "specialist.assurance-enterprise.test-architect";
const CLASSES = ["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"];
const GATE_IDS = ["00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff", "10-proof-acceptance", "11-lifecycle-recovery-archive"];
const RESULT_KEYS = ["schema", "version", "disposition", "route", "analysis_allowed", "acceptance_allowed", "test_execution_allowed", "test_plan_mutation_allowed", "memory_write_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256"];
const SIDE_EFFECT_KEYS = ["candidate_reads", "source_reads", "standard_reads", "context_reads", "memory_reads", "protected_data_reads", "test_executions", "test_plan_writes", "project_writes", "memory_writes", "credential_accesses", "state_changes"];
const SHA256 = /^[0-9a-f]{64}$/u;
const read = (file) => fs.readFileSync(file, "utf8");
const bytes = (file) => fs.readFileSync(file);
const json = (file) => JSON.parse(read(file));
const sha = (file) => createHash("sha256").update(bytes(file)).digest("hex");
function fail(message, code = "TEST_ARCHITECT_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exactKeys(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "TEST_ARCHITECT_RESULT_SHAPE_INVALID"); assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields differ`, "TEST_ARCHITECT_RESULT_SHAPE_INVALID"); }
function assertBoundaryResult(actual, expected, label) {
  exactKeys(actual, RESULT_KEYS.concat(actual.disposition === "ROUTE" ? ["selected_specialist", "handoff"] : []), `${label} result`);
  assert(actual.schema === "agentos.test_architect_boundary_result.v1" && actual.version === 1 && actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} typed result differs from fixture expectation`, "TEST_ARCHITECT_HOSTILE_RESULT_FAILED");
  assert(actual.acceptance_allowed === false && actual.test_execution_allowed === false && actual.test_plan_mutation_allowed === false && actual.memory_write_allowed === false, `${label} grants forbidden authority`, "TEST_ARCHITECT_SIDE_EFFECT_AUTHORITY_FAILED");
  exactKeys(actual.external_side_effects, SIDE_EFFECT_KEYS, `${label} side effects`); assert(Object.values(actual.external_side_effects).every((value) => value === 0), `${label} emitted a side effect`, "TEST_ARCHITECT_SIDE_EFFECT_FAILED");
  assert(SHA256.test(actual.input_sha256) && SHA256.test(actual.result_sha256) && actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not independently recomputed`, "TEST_ARCHITECT_RESULT_DIGEST_INVALID");
}
function inventory(root) {
  const expected = ["block.json", "sources.lock", "context-binding.json", "invalidation.json", "gates/execution.json", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const id of GATE_IDS) expected.push(`gates/${id}.gate`);
  for (const cls of CLASSES) expected.push(`fixtures/${cls}.json`);
  return expected.sort();
}
function fixtureMap(root) {
  const dir = path.join(root, "fixtures"); const names = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  assert(JSON.stringify(names.map((name) => name.slice(0, -5))) === JSON.stringify([...CLASSES].sort()), "Test Architecture fixture inventory is not exact", "TEST_ARCHITECT_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(dir, name); const fixture = json(file);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === BLOCK_ID && fixture.hostile === true && fixture.class === name.slice(0, -5), `Test Architecture fixture ${name} identity is invalid`, "TEST_ARCHITECT_FIXTURE_INVALID");
    assert(fixture.vector?.entrypoint === "control/test-architect-boundary-gate.mjs#evaluateTestArchitectBoundary" && fixture.vector.input?.schema === TEST_ARCHITECT_INPUT_SCHEMA && fixture.vector.input?.evidence && fixture.vector.expected_readback && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Test Architecture fixture ${name} is not an executable bound vector`, "TEST_ARCHITECT_FIXTURE_UNBOUND");
    assert(fixture.vector.assertions?.length >= 3 && fixture.required_assertions?.includes("NO_SIDE_EFFECTS"), `Test Architecture fixture ${name} lacks hostile assertions`, "TEST_ARCHITECT_FIXTURE_ASSERTIONS_INVALID");
    assert(!map.has(fixture.class), `Test Architecture fixture ${name} aliases another class`, "TEST_ARCHITECT_FIXTURE_ALIAS"); map.set(fixture.class, {fixture, file_sha256: sha(file)});
  }
  return map;
}
function gateExecutions(root, authority, fixtureMapValue) {
  const execution = json(path.join(root, "gates/execution.json")); const manifest = json(path.join(root, "gates/manifest.json"));
  assert(execution.schema === "agentos.test_architect_gate_execution.v1" && execution.version === 1 && execution.block_id === BLOCK_ID && execution.evaluator_entrypoint === "control/test-architect-package-evaluator.mjs#evaluateTestArchitectPackage", "Test Architecture gate execution identity is invalid", "TEST_ARCHITECT_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(manifest.ordered_gate_ids) && JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(GATE_IDS) && execution.executions.length === GATE_IDS.length, "Test Architecture gate execution order is incomplete", "TEST_ARCHITECT_GATE_EXECUTION_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && GATE_IDS.includes(entry.gate_id), `Test Architecture gate ${entry.gate_id} is duplicated or unknown`, "TEST_ARCHITECT_GATE_EXECUTION_INVALID"); seen.add(entry.gate_id);
    const fixtureEntry = fixtureMapValue.get(entry.fixture_class); assert(fixtureEntry, `Test Architecture gate fixture ${entry.fixture_class} is missing`, "TEST_ARCHITECT_GATE_FIXTURE_MISSING");
    assert(JSON.stringify(entry.expected) === JSON.stringify(fixtureEntry.fixture.expected), `Test Architecture gate ${entry.gate_id} expectation is not bound to its fixture`, "TEST_ARCHITECT_GATE_EXPECTATION_UNBOUND");
    const actual = evaluateTestArchitectBoundary(fixtureEntry.fixture.vector.input); assertBoundaryResult(actual, entry.expected, `Test Architecture gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: "control/test-architect-boundary-gate.mjs#evaluateTestArchitectBoundary", expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, side_effects: actual.external_side_effects});
  }
  assert(seen.size === GATE_IDS.length, "Test Architecture gate execution coverage is incomplete", "TEST_ARCHITECT_GATE_EXECUTION_INVALID");
  return results;
}
async function mutation(authority, fixtureMapValue) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-test-architect-mutation-"));
  try {
    for (const dir of ["control", "specialist-blocks", "fixtures", "schemas"]) fs.mkdirSync(path.join(temp, dir), {recursive: true});
    for (const file of ["content-addressing.mjs", "persisted-record-privacy.mjs", "assurance-enterprise-router-boundary-gate.mjs", "eco-model-policy.mjs", "test-architect-authority-binding.mjs", "test-architect-boundary-gate.mjs"]) fs.copyFileSync(path.join(ROOT, "control", file), path.join(temp, "control", file));
    fs.cpSync(path.join(ROOT, PACKAGE_RELATIVE), path.join(temp, PACKAGE_RELATIVE), {recursive: true}); fs.cpSync(path.join(ROOT, "specialist-blocks/standards/nist-ssdf"), path.join(temp, "specialist-blocks/standards/nist-ssdf"), {recursive: true}); fs.cpSync(path.join(ROOT, "specialist-blocks/registry"), path.join(temp, "specialist-blocks/registry"), {recursive: true}); fs.copyFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures/model-policy-snapshot.initial.v1.json")); fs.cpSync(path.join(ROOT, "fixtures/model-policy-evidence"), path.join(temp, "fixtures/model-policy-evidence"), {recursive: true});
    const target = path.join(temp, "control/test-architect-boundary-gate.mjs"); let source = read(target); const anchor = 'if (f.unsafe_action) return result("DENY", "NO_TEST_ARCHITECTURE_SIDE_EFFECT", "TEST_ARCHITECTURE_OPERATION_FORBIDDEN", input);'; assert(source.includes(anchor), "Test Architecture mutation anchor is missing", "TEST_ARCHITECT_MUTATION_ANCHOR_MISSING"); source = source.replace(anchor, 'if (f.unsafe_action) return result("ROUTE", "TEST_ARCHITECTURE_ANALYSIS_HANDOFF", "MUTATED_UNSAFE_ACTION_ALLOWED", input, {analysis_allowed: true, selected_specialist: "specialist.assurance-enterprise.test-architect", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "mutated", execution_instruction: false}});'); fs.writeFileSync(target, source, {flag: "w"});
    const mod = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`); const fixture = fixtureMapValue.get("unsafe_action").fixture; const observed = mod.evaluateTestArchitectBoundary(fixture.vector.input); return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

export async function evaluateTestArchitectPackage() {
  const authority = resolveTestArchitectCanonicalAuthority(); const root = path.join(ROOT, PACKAGE_RELATIVE);
  const files = inventory(root); const actualFiles = []; for (const relative of files) { const file = path.join(root, relative); assert(fs.existsSync(file), `Test Architecture package file is missing: ${relative}`, "TEST_ARCHITECT_PACKAGE_FILE_MISSING"); actualFiles.push({relative_path: `${PACKAGE_RELATIVE}/${relative}`, sha256: sha(file)}); }
  assert(JSON.stringify(actualFiles.map((entry) => entry.relative_path.replace(`${PACKAGE_RELATIVE}/`, "")).sort()) === JSON.stringify(files), "Test Architecture package contains an incomplete canonical inventory", "TEST_ARCHITECT_PACKAGE_INVENTORY_INVALID");
  const block = json(path.join(root, "block.json")); assert(block.block_id === BLOCK_ID && block.block_sha256 === authority.block_sha256 && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Test Architecture package state is invalid", "TEST_ARCHITECT_PACKAGE_STATE_INVALID");
  const fixtureMapValue = fixtureMap(root); const gateExecution = gateExecutions(root, authority, fixtureMapValue); const fixtureResults = [];
  for (const className of [...CLASSES].sort()) { const {fixture, file_sha256} = fixtureMapValue.get(className); let actual; try { actual = evaluateTestArchitectBoundary(fixture.vector.input); } catch (error) { fail(`${fixture.fixture_id} execution failed: ${error.code ?? error.message}`, "TEST_ARCHITECT_HOSTILE_EXECUTION_FAILED"); } assertBoundaryResult(actual, fixture.expected, fixture.fixture_id); fixtureResults.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: fixture.expected.route, actual_route: actual.route, expected_error_code: fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({fixture_id: fixture.fixture_id, actual: actual.result_sha256})}); }
  const evaluationArtifact = {value: json(path.join(root, "evaluation.json")), file_sha256: sha(path.join(root, "evaluation.json"))}; const handoffArtifact = {value: json(path.join(root, "handoff.json")), file_sha256: sha(path.join(root, "handoff.json"))}; assertTestArchitectCommittedHandoff({authority, evaluation: evaluationArtifact.value, handoff: handoffArtifact.value, evaluationFileSha256: evaluationArtifact.file_sha256, handoffFileSha256: handoffArtifact.file_sha256});
  const sensitivity = await mutation(authority, fixtureMapValue); assert(sensitivity.mutation_detected, "Test Architecture mutation proof is missing", "TEST_ARCHITECT_MUTATION_PROOF_MISSING");
  const evaluation = {schema: TEST_ARCHITECT_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(actualFiles), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(actualFiles.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(actualFiles.filter((entry) => entry.relative_path.includes("/fixtures/"))), gate_execution: gateExecution, fixture_results: fixtureResults, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), source_manifest_sha256: authority.source_manifest_sha256, source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date, model_snapshot_sha256: authority.model.snapshot_sha256, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, memory_binding_sha256: authority.context_binding_sha256, invalidation_sha256: authority.invalidation_sha256, upstream_router_result_sha256: authority.router_result_sha256, gate_semantic_inventory_sha256: authority.gate_semantic_inventory_sha256, evaluation_file_sha256: evaluationArtifact.file_sha256, handoff_file_sha256: handoffArtifact.file_sha256, evaluation_sha256: null}; evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.stdout.write(`${JSON.stringify(await evaluateTestArchitectPackage(), null, 2)}\n`);
