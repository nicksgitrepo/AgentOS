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
import {assertSchedulerResourceCanonicalEvidence, assertSchedulerResourceCommittedHandoff, resolveSchedulerResourceCanonicalAuthority, SCHEDULER_RESOURCE_REQUIRED_TOOLS} from "./scheduler-resource-authority-binding.mjs";
import {validateSchedulerResourceRollbackReceipt} from "./scheduler-resource-receipts.mjs";

export const SCHEDULER_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_scheduler_resource_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-01/resource-scheduler";
const BLOCK_ID = "specialist.control.resource-scheduler";
const FOCUSED_SUITES = [
  "tests/verify-rapid-prototype.mjs",
  "tests/verify-specialist-block-library.mjs",
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
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json", "rollback.json"];
  for (const name of fs.readdirSync(path.join(packageRoot, "gates")).filter((entry) => entry.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(packageRoot, "fixtures")).filter((entry) => entry.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}

function boundInput(fixture, authority, {canonical = false} = {}) {
  const input = structuredClone(fixture.vector.input);
  const evidence = input.evidence;
  Object.assign(evidence, {
    authority_status: "CURRENT",
    owner_role: "AGENTOS_CONTROLLER",
    owner_identity: "OWNER.TYPED.RESOURCE",
    owner_intent_status: "BOUND",
    owner_intent_digest: "1".repeat(64),
    intent_provenance_status: "EXACT_TYPED_RECORD",
    candidate_status: "CURRENT_CANDIDATE",
    candidate_digest: authority.block_sha256,
    source_status: "CURRENT_VERIFIED",
    source_manifest_sha256: authority.source_manifest_sha256,
    source_lock_sha256: authority.source_file_sha256,
    source_identities: authority.source_identities,
    source_versions: authority.source_versions,
    signal: "EXPLICIT_TYPED_RESOURCE_SIGNAL",
    signal_status: "BOUND",
    task_status: "RESOURCE_SCHEDULING",
    context_status: "RESOURCE_SCHEDULER_CONTEXT",
    context_complete: true,
    model_policy_status: "CURRENT",
    model_route_status: "BOUND",
    model: authority.model_route.model,
    reasoning_effort: authority.model_route.reasoning_effort,
    model_route_sha256: authority.model_route_sha256,
    context_receipt_sha256: authority.context_sha256,
    route_receipt_sha256: authority.route_sha256,
    custody_status: "BOUND",
    custody_owner: "AGENTOS.CONTROL.RESOURCE_SCHEDULER",
    custody_ref: authority.custody_ref,
    project_data_present: false,
    secret_data_present: false,
  });
  if (evidence.requested_tools === undefined) evidence.requested_tools = [...SCHEDULER_RESOURCE_REQUIRED_TOOLS];
  if (canonical || evidence.authority_scope === undefined) evidence.authority_scope = "RESOURCE_SCHEDULING";
  if (canonical || evidence.scope === undefined) evidence.scope = "NARROW";
  return input;
}

function runGateExecutions(packageRoot, fixtures, authority) {
  const executionPath = path.join(packageRoot, "gates/execution.json");
  const execution = readJson(executionPath);
  assert(execution.schema === "agentos.scheduler_resource_gate_execution.v1" && execution.version === 1 && execution.block_id === BLOCK_ID, "Scheduler gate execution manifest identity is invalid", "SCHEDULER_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/scheduler-resource-package-evaluator.mjs#evaluateSchedulerResourcePackage" && execution.boundary_entrypoint === "control/scheduler-resource-boundary-gate.mjs#evaluateSchedulerResourceBoundary", "Scheduler gate execution entrypoint is not bound", "SCHEDULER_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(["00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff", "10-proof-acceptance", "11-lifecycle-recovery-archive"]), "Scheduler gate execution order is invalid", "SCHEDULER_GATE_EXECUTION_INVALID");
  assert(Array.isArray(execution.executions) && execution.executions.length === execution.ordered_gate_ids.length, "Scheduler gate execution coverage is incomplete", "SCHEDULER_GATE_EXECUTION_INVALID");
  const seen = new Set();
  const results = execution.executions.map((entry) => {
    assert(!seen.has(entry.gate_id) && execution.ordered_gate_ids.includes(entry.gate_id), `Scheduler gate execution ${entry.gate_id} is duplicated or unknown`, "SCHEDULER_GATE_EXECUTION_INVALID");
    seen.add(entry.gate_id);
    const fixtureInfo = [...fixtures.values()].find(({fixture}) => fixture.class === entry.fixture_class);
    assert(fixtureInfo, `Scheduler gate execution fixture ${entry.fixture_class} is missing`, "SCHEDULER_GATE_EXECUTION_INVALID");
    const input = boundInput(fixtureInfo.fixture, authority, {canonical: entry.fixture_class === "handoff"});
    if (entry.fixture_class === "handoff") assertSchedulerResourceCanonicalEvidence(input.evidence, authority);
    const actual = evaluateSchedulerResourceBoundary(input);
    const expected = entry.expected;
    const sideEffectsZero = Object.values(actual.external_side_effects).every((value) => value === 0);
    assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code && sideEffectsZero && actual.classification_allowed === false, `Scheduler gate ${entry.gate_id} readback failed`, "SCHEDULER_GATE_EXECUTION_FAILED");
    return {gate_id: entry.gate_id, fixture_class: entry.fixture_class, expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, external_side_effects: actual.external_side_effects};
  });
  assert(seen.size === execution.ordered_gate_ids.length, "Scheduler gate execution coverage is incomplete", "SCHEDULER_GATE_EXECUTION_INVALID");
  return {execution, execution_file_sha256: rawSha256(readBytes(executionPath)), results};
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
  const authority = resolveSchedulerResourceCanonicalAuthority();
  assert(authority.block_sha256 === block.block_sha256, "Scheduler authority binding does not match package candidate", "SCHEDULER_AUTHORITY_BINDING_INVALID");
  const gateExecution = runGateExecutions(packageRoot, fixtures, authority);
  const results = [];
  for (const fixtureInfo of [...fixtures.values()].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id))) {
    const fixture = fixtureInfo.fixture; const expected = fixture.vector.expected_readback; const started = Date.now();
    let actual;
    try { actual = evaluateSchedulerResourceBoundary(boundInput(fixture, authority)); }
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
  const evaluationPath = path.join(packageRoot, "evaluation.json");
  const handoffPath = path.join(packageRoot, "handoff.json");
  const rollbackPath = path.join(packageRoot, "rollback.json");
  const staticEvaluation = readJson(evaluationPath);
  const staticHandoff = readJson(handoffPath);
  const staticRollback = readJson(rollbackPath);
  validateSchedulerResourceRollbackReceipt(staticRollback, {
    candidateDigest: authority.block_sha256,
    gateSemanticInventorySha256: authority.gate_semantic_inventory_sha256,
    modelRouteSha256: authority.model_route_sha256,
    contextSha256: authority.context_sha256,
    routeSha256: authority.route_sha256,
  });
  assertSchedulerResourceCommittedHandoff({
    authority,
    evaluation: staticEvaluation,
    handoff: staticHandoff,
    evaluationFileSha256: rawSha256(readBytes(evaluationPath)),
    handoffFileSha256: rawSha256(readBytes(handoffPath)),
    rollbackFileSha256: rawSha256(readBytes(rollbackPath)),
    rollbackReceiptSha256: staticRollback.digest,
  });
  const observedAtUtc = new Date().toISOString();
  const packageRootSha256 = canonicalDigest(fileDigests);
  const evaluation = {schema: SCHEDULER_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: packageRootSha256, package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/fixtures/"))), gate_execution: gateExecution.results, gate_execution_file_sha256: gateExecution.execution_file_sha256, fixture_results: results, focused_suites: focusedSuites, mutation_sensitivity: mutation, source_manifest_sha256: authority.source_manifest_sha256, source_lock_file_sha256: authority.source_file_sha256, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, route_receipt_sha256: authority.route_sha256, gate_semantic_inventory_sha256: authority.gate_semantic_inventory_sha256, rollback_receipt_sha256: staticRollback.digest, authority_binding: {candidate_digest: authority.block_sha256, source_manifest_sha256: authority.source_manifest_sha256, source_lock_file_sha256: authority.source_file_sha256, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, route_receipt_sha256: authority.route_sha256, rollback_receipt_sha256: staticRollback.digest}, static_handoff_binding: {evaluation_file_sha256: rawSha256(readBytes(evaluationPath)), handoff_file_sha256: rawSha256(readBytes(handoffPath)), rollback_file_sha256: rawSha256(readBytes(rollbackPath))}, independent_signature_required: true, observed_at_utc: observedAtUtc, evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateSchedulerResourcePackage(), null, 2)}\n`);
