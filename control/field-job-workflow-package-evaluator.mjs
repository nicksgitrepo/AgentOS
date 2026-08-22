#!/usr/bin/env node

/*
 * Independent, read-only package evaluator for Field Job Workflow.
 * Every hostile fixture is converted into a real boundary input and sent
 * through the exported public entrypoint.  Fixture metadata is never used as
 * a caller-supplied PASS flag.  The evaluator also executes the ordered gate
 * readback, proves mutation sensitivity, and records context/memory
 * invalidation closure.  The ordinary evaluator is read-only; --write-readback
 * writes only the current operational receipt for the explicit refresh/rebind
 * sequence.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest} from "./content-addressing.mjs";
import {validateGatePack} from "./specialist-block-compiler.mjs";
import {evaluateFieldJobWorkflowBoundaryForEvaluator, FIELD_JOB_WORKFLOW_INPUT_SCHEMA} from "./field-job-workflow-boundary-gate.mjs";
import {
  FIELD_JOB_WORKFLOW_BLOCK_ID,
  FIELD_JOB_WORKFLOW_FIXTURE_CLASSES,
  FIELD_JOB_WORKFLOW_FLAG_NAMES,
  FIELD_JOB_WORKFLOW_GATE_IDS,
  FIELD_JOB_WORKFLOW_OPERATIONAL_READBACK_PATH,
  computeFieldJobWorkflowInvalidationClosure,
  resolveFieldJobWorkflowCanonicalAuthority,
} from "./field-job-workflow-authority-binding.mjs";
import {compileTaskWorkspaceCustodyReceipt, assertTaskWorkspaceCustody} from "./task-workspace-custody.mjs";

export const FIELD_JOB_WORKFLOW_EVALUATION_SCHEMA = "agentos.specialist_field_job_workflow_package_operational_evaluation.v1";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-06/field-job-workflow";
const PACKAGE = path.join(ROOT, PACKAGE_RELATIVE);
const ENTRYPOINT = "control/field-job-workflow-boundary-gate.mjs#evaluateFieldJobWorkflowBoundary";
const READBACK_SCHEMA = "agentos.field_job_workflow_operational_readback.v1";
const READBACK_PATH = path.join(ROOT, FIELD_JOB_WORKFLOW_OPERATIONAL_READBACK_PATH);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));

function fail(message, code = "FIELD_JOB_WORKFLOW_EVALUATION_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "FIELD_JOB_WORKFLOW_EVALUATION_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields differ`, "FIELD_JOB_WORKFLOW_EVALUATION_SCHEMA_INVALID");
}

function inventory(root) {
  const output = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else output.push(path.relative(root, target).split(path.sep).join("/"));
    }
  };
  visit(root);
  return output.sort();
}

function compileOperationalReadback(evaluation) {
  const readback = {
    schema: READBACK_SCHEMA,
    version: 1,
    status: evaluation.status,
    block_id: evaluation.block_id,
    candidate_digest: evaluation.package_block_sha256,
    model_snapshot_sha256: evaluation.model_snapshot_sha256,
    model_route_sha256: evaluation.model_route_sha256,
    context_receipt_sha256: evaluation.context_receipt_sha256,
    memory_invalidation_sha256: evaluation.memory_invalidation_sha256,
    upstream_router_result_sha256: evaluation.upstream_router_result_sha256,
    gate_execution_sha256: evaluation.gate_execution.execution_sha256,
    fixture_count: evaluation.fixture_results.length,
    gate_count: evaluation.gate_execution.results.length,
    mutation_detected: evaluation.mutation_sensitivity.mutation_detected,
    invalidation_status: evaluation.context_memory_invalidation.status,
    workspace_custody_status: evaluation.task_workspace_custody.status,
    observed_at_utc: evaluation.observed_at_utc,
    readback_sha256: null,
  };
  readback.readback_sha256 = canonicalDigest({...readback, readback_sha256: null});
  return Object.freeze(readback);
}

export function writeFieldJobWorkflowOperationalReadback(evaluation, {file = READBACK_PATH} = {}) {
  assert(evaluation?.status === "PASS", "Field Job Workflow operational evaluator readback requires a PASS evaluation", "FIELD_JOB_WORKFLOW_EVALUATOR_READBACK_INVALID");
  const readback = compileOperationalReadback(evaluation);
  fs.writeFileSync(file, `${JSON.stringify(readback, null, 2)}\n`);
  return Object.freeze({path: FIELD_JOB_WORKFLOW_OPERATIONAL_READBACK_PATH, readback_sha256: readback.readback_sha256, file_sha256: sha(fs.readFileSync(file))});
}

function loadFixtures(root) {
  const files = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(files.length === FIELD_JOB_WORKFLOW_FIXTURE_CLASSES.length && new Set(files).size === files.length, "Field Job Workflow fixture count is not exactly 17", "FIELD_JOB_WORKFLOW_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of files) {
    const file = path.join(root, "fixtures", name);
    const fixture = json(file);
    exactKeys(fixture, ["schema", "version", "block_id", "fixture_id", "class", "hostile", "expected", "note", "vector"], `Field Job Workflow fixture ${name}`);
    exactKeys(fixture.expected, ["disposition", "route", "error_code"], `Field Job Workflow fixture ${name} expected`);
    exactKeys(fixture.vector, ["entrypoint", "input", "expected_readback"], `Field Job Workflow fixture ${name} vector`);
    exactKeys(fixture.vector.input, ["request_kind", "evidence_overrides"], `Field Job Workflow fixture ${name} input`);
    exactKeys(fixture.vector.expected_readback, ["disposition", "route", "error_code"], `Field Job Workflow fixture ${name} readback`);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && fixture.fixture_id === `${FIELD_JOB_WORKFLOW_BLOCK_ID}.${fixture.class.toUpperCase()}`, `Field Job Workflow fixture ${name} identity differs`, "FIELD_JOB_WORKFLOW_FIXTURE_PROVENANCE_INVALID");
    assert(FIELD_JOB_WORKFLOW_FIXTURE_CLASSES.includes(fixture.class) && fixture.hostile === true && fixture.vector.entrypoint === ENTRYPOINT, `Field Job Workflow fixture ${name} is not operational`, "FIELD_JOB_WORKFLOW_FIXTURE_UNBOUND");
    assert(JSON.stringify(fixture.expected) === JSON.stringify(fixture.vector.expected_readback), `Field Job Workflow fixture ${name} expected readback differs`, "FIELD_JOB_WORKFLOW_FIXTURE_EXPECTATION_MISMATCH");
    assert(!map.has(fixture.class), `Field Job Workflow fixture class is duplicated: ${fixture.class}`, "FIELD_JOB_WORKFLOW_FIXTURE_ALIAS");
    for (const key of FIELD_JOB_WORKFLOW_FLAG_NAMES) if (Object.prototype.hasOwnProperty.call(fixture.vector.input.evidence_overrides, key)) assert(typeof fixture.vector.input.evidence_overrides[key] === "boolean", `Field Job Workflow fixture ${name} flag is not boolean`, "FIELD_JOB_WORKFLOW_FIXTURE_VECTOR_INVALID");
    map.set(fixture.class, {fixture, relative_path: `${PACKAGE_RELATIVE}/fixtures/${name}`, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === FIELD_JOB_WORKFLOW_FIXTURE_CLASSES.slice().sort().join("\0"), "Field Job Workflow fixture class coverage is incomplete", "FIELD_JOB_WORKFLOW_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function inputFor(fixture, authority) {
  const overrides = fixture.vector.input.evidence_overrides ?? {};
  const evidence = structuredClone(authority.evidence);
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "adversarial_flags") evidence.adversarial_flags = {...evidence.adversarial_flags, ...value};
    else evidence[key] = value;
  }
  return {schema: FIELD_JOB_WORKFLOW_INPUT_SCHEMA, version: 1, request_kind: fixture.vector.input.request_kind, evidence};
}

function assertReadback(actual, expected, label) {
  assert(actual.schema === "agentos.field_job_workflow_boundary_result.v1" && actual.version === 1, `${label} result schema differs`, "FIELD_JOB_WORKFLOW_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} hostile vector failed`, "FIELD_JOB_WORKFLOW_HOSTILE_RESULT_FAILED");
  assert(actual.acceptance_allowed === false && actual.operational_dispatch_allowed === false && actual.engineering_or_safety_claim_allowed === false && actual.admission_allowed === false && actual.activation_allowed === false && actual.memory_write_allowed === false, `${label} capability ceiling widened`, "FIELD_JOB_WORKFLOW_CAPABILITY_CEILING_FAILED");
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), `${label} observed an external side effect`, "FIELD_JOB_WORKFLOW_SIDE_EFFECT");
}

function readGateExecution(root) {
  const manifest = json(path.join(root, "gates", "execution.json"));
  exactKeys(manifest, ["schema", "version", "block_id", "evaluator_entrypoint", "ordered_gate_ids", "executions"], "Field Job Workflow gate execution manifest");
  assert(manifest.schema === "agentos.field_job_workflow_gate_execution.v1" && manifest.version === 1 && manifest.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && manifest.evaluator_entrypoint === "control/field-job-workflow-package-evaluator.mjs#evaluateFieldJobWorkflowPackage", "Field Job Workflow gate execution manifest identity differs", "FIELD_JOB_WORKFLOW_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(FIELD_JOB_WORKFLOW_GATE_IDS) && manifest.executions.length === FIELD_JOB_WORKFLOW_GATE_IDS.length, "Field Job Workflow gate execution order is incomplete", "FIELD_JOB_WORKFLOW_GATE_EXECUTION_INVALID");
  return manifest;
}

function executeGates(root, block, fixtures, authority) {
  validateGatePack(root, block);
  const execution = readGateExecution(root);
  const results = [];
  for (const entry of execution.executions) {
    exactKeys(entry, ["gate_id", "fixture_class", "expected"], `Field Job Workflow gate execution ${entry.gate_id}`);
    exactKeys(entry.expected, ["disposition", "route", "error_code"], `Field Job Workflow gate execution ${entry.gate_id} expected`);
    assert(entry.gate_id === FIELD_JOB_WORKFLOW_GATE_IDS[results.length], `Field Job Workflow gate order drifted at ${entry.gate_id}`, "FIELD_JOB_WORKFLOW_GATE_EXECUTION_INVALID");
    const fixtureEntry = fixtures.get(entry.fixture_class);
    assert(fixtureEntry, `Field Job Workflow gate fixture is missing: ${entry.fixture_class}`, "FIELD_JOB_WORKFLOW_GATE_FIXTURE_INVALID");
    const actual = evaluateFieldJobWorkflowBoundaryForEvaluator(inputFor(fixtureEntry.fixture, authority));
    assertReadback(actual, entry.expected, `Field Job Workflow gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: ENTRYPOINT, entrypoint_invoked: true, semantic_execution_completed: true, expected: entry.expected, observed: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}});
  }
  return {manifest: execution, results, execution_sha256: canonicalDigest(results)};
}

async function mutationProof(fixture, authority) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-field-job-workflow-mutation-"));
  try {
    fs.cpSync(path.join(ROOT, "control"), path.join(temp, "control"), {recursive: true});
    fs.mkdirSync(path.join(temp, "specialist-blocks", "wave-06"), {recursive: true});
    fs.cpSync(PACKAGE, path.join(temp, PACKAGE_RELATIVE), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
    fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
    fs.copyFileSync(path.join(ROOT, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json"));
    fs.cpSync(path.join(ROOT, "fixtures", "model-policy-evidence"), path.join(temp, "fixtures", "model-policy-evidence"), {recursive: true});
    fs.mkdirSync(path.join(temp, "tests"), {recursive: true});
    fs.copyFileSync(path.join(ROOT, "tests", "verify-field-job-workflow-boundary.mjs"), path.join(temp, "tests", "verify-field-job-workflow-boundary.mjs"));
    const target = path.join(temp, "control", "field-job-workflow-boundary-gate.mjs");
    const anchor = 'if (flags.unsafe_action) return result(input, "DENY", "NO_FIELD_WORKFLOW_SIDE_EFFECT", "FIELD_JOB_WORKFLOW_OPERATION_FORBIDDEN", authority);';
    let source = read(target);
    assert(source.includes(anchor), "Field Job Workflow mutation anchor is missing", "FIELD_JOB_WORKFLOW_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (flags.unsafe_action) return routeHandoff(input, authority, "FIELD_WORKFLOW_ANALYSIS_HANDOFF", "MUTATED_UNSAFE_OPERATION_ALLOWED");');
    fs.writeFileSync(target, source);
    const isolated = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const actual = isolated.evaluateFieldJobWorkflowBoundaryForEvaluator(inputFor(fixture, authority));
    return {status: actual.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: actual.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: actual.disposition, observed_route: actual.route};
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
}

function evaluateInvalidation(authority) {
  const sourceClosure = computeFieldJobWorkflowInvalidationClosure(["source_manifest"], authority.invalidation);
  const modelClosure = computeFieldJobWorkflowInvalidationClosure(["model_policy_snapshot"], authority.invalidation);
  const custodyClosure = computeFieldJobWorkflowInvalidationClosure(["custody_ref"], authority.invalidation);
  const required = ["context_projection", "workflow_route", "handoff", "evaluation"];
  for (const [label, closure] of [["source", sourceClosure], ["model", modelClosure], ["custody", custodyClosure]]) for (const item of required) assert(closure.includes(item), `Field Job Workflow ${label} invalidation closure omits ${item}`, "FIELD_JOB_WORKFLOW_INVALIDATION_PROOF_FAILED");
  return {status: "PASS", memory_scope: authority.context.context.memory_scope, write_allowed: authority.context.context.memory_write_allowed, source_changed: sourceClosure, model_changed: modelClosure, custody_changed: custodyClosure, invalidation_sha256: canonicalDigest({sourceClosure, modelClosure, custodyClosure})};
}

export async function evaluateFieldJobWorkflowPackage({allowMissingOperationalReadback = true} = {}) {
  const root = PACKAGE;
  const block = json(path.join(root, "block.json"));
  assert(block.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Field Job Workflow package state is not candidate/off", "FIELD_JOB_WORKFLOW_PACKAGE_STATE_INVALID");
  const authority = resolveFieldJobWorkflowCanonicalAuthority({allowMissingOperationalReadback});
  const fixtures = loadFixtures(root);
  const evaluationArtifact = json(path.join(root, "evaluation.json"));
  assert(evaluationArtifact.schema === "agentos.specialist_evaluation.v1" && evaluationArtifact.block_id === FIELD_JOB_WORKFLOW_BLOCK_ID && evaluationArtifact.candidate_digest === block.block_sha256, "Field Job Workflow evaluation dossier is stale", "FIELD_JOB_WORKFLOW_EVALUATION_DOSSIER_STALE");
  assert(evaluationArtifact.disposition === "EXECUTED_REVIEW_REQUIRED" && evaluationArtifact.independence_rule === "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION", "Field Job Workflow evaluation dossier claims unsupported clearance", "FIELD_JOB_WORKFLOW_EVALUATION_STATE_INVALID");
  const list = inventory(root);
  assert(list.filter((relative) => relative.startsWith("gates/") && relative.endsWith(".gate")).length === FIELD_JOB_WORKFLOW_GATE_IDS.length, "Field Job Workflow gate inventory is incomplete", "FIELD_JOB_WORKFLOW_GATE_INVENTORY_INVALID");
  const fixtureResults = [];
  for (const entry of [...fixtures.values()].sort((left, right) => left.fixture.class.localeCompare(right.fixture.class))) {
    const actual = evaluateFieldJobWorkflowBoundaryForEvaluator(inputFor(entry.fixture, authority));
    assertReadback(actual, entry.fixture.expected, `Field Job Workflow fixture ${entry.fixture.class}`);
    fixtureResults.push({fixture_id: entry.fixture.fixture_id, fixture_class: entry.fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: entry.fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: entry.fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: entry.fixture.expected.route, actual_route: actual.route, expected_error_code: entry.fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: actual.result_sha256});
  }
  const gateExecution = executeGates(root, block, fixtures, authority);
  const mutation = await mutationProof(fixtures.get("unsafe_action").fixture, authority);
  assert(mutation.mutation_detected === true, "Field Job Workflow mutation proof did not detect a weakened boundary", "FIELD_JOB_WORKFLOW_MUTATION_PROOF_MISSING");
  const invalidation = evaluateInvalidation(authority);
  const taskWorkspaceCustody = compileTaskWorkspaceCustodyReceipt({projectRoot: ROOT, taskCheckout: ROOT, taskWorktree: ROOT});
  assertTaskWorkspaceCustody(taskWorkspaceCustody);
  const packageDigests = list.map((relative_path) => ({relative_path: `${PACKAGE_RELATIVE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  const evaluation = {
    schema: FIELD_JOB_WORKFLOW_EVALUATION_SCHEMA,
    version: 1,
    status: "PASS",
    block_id: FIELD_JOB_WORKFLOW_BLOCK_ID,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    package_root_sha256: canonicalDigest(packageDigests),
    package_block_sha256: block.block_sha256,
    source_manifest_sha256: authority.source.source.manifest_sha256,
    model_snapshot_sha256: authority.model.snapshot.snapshot_sha256,
    model_route_sha256: authority.model.route.route_sha256,
    context_receipt_sha256: authority.context.context.context_sha256,
    memory_invalidation_sha256: authority.invalidation.graph_sha256,
    upstream_router_result_sha256: authority.upstream_result.result_sha256,
    shared_registry_integration: authority.registry.shared_registry_integration,
    gate_execution: gateExecution,
    fixture_results: fixtureResults,
    mutation_sensitivity: mutation,
    context_memory_invalidation: invalidation,
    task_workspace_custody: taskWorkspaceCustody,
    independent_signature_required: true,
    canonical_external_admission: "BLOCKED_EXACT:SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED",
    observed_at_utc: new Date().toISOString(),
    evaluation_sha256: null,
  };
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const evaluation = await evaluateFieldJobWorkflowPackage({allowMissingOperationalReadback: true});
  if (process.argv.includes("--write-readback")) process.stdout.write(`${JSON.stringify({...evaluation, operational_readback: writeFieldJobWorkflowOperationalReadback(evaluation)}, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(evaluation, null, 2)}\n`);
}
