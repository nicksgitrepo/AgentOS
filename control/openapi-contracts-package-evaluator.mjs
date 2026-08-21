#!/usr/bin/env node

/* Independent, read-only operational evaluator for the OpenAPI package. */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {canonicalDigest, scanPersistedRecord} from "./content-addressing.mjs";
import {compileSpecialistLibrary, evaluateGateAnswer} from "./specialist-block-compiler.mjs";
import {evaluateOpenApiContractsBoundary, OPENAPI_CONTRACTS_INPUT_SCHEMA, OPENAPI_CONTRACTS_RESULT_SCHEMA} from "./openapi-contracts-boundary-gate.mjs";
import {invalidationReadback, resolveOpenApiContractsCanonicalAuthority, validateOpenApiContractsContext} from "./openapi-contracts-authority-binding.mjs";
import {assertOpenApiContractsLifecycleReadback, transitionOpenApiContractsLifecycle} from "./openapi-contracts-lifecycle.mjs";
import {validateOpenApiContractsCandidateBinding} from "./openapi-contracts-candidate-freeze.mjs";

export const OPENAPI_CONTRACTS_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_openapi_contracts_package_operational_evaluation.v1";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-02/openapi-contracts";
const BLOCK_ID = "specialist.product-client.openapi-contracts";
const CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority",
  "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion",
  "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action",
]);
const GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness",
  "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime",
  "09-output-handoff", "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fileText = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(fileText(file));
const fileSha = (file) => sha(fs.readFileSync(file));
function fail(message, code = "OPENAPI_CONTRACTS_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }

function inventory(packageRoot) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json", "model-policy-route.json", "context-binding.json", "registry-entry.json"];
  for (const name of fs.readdirSync(path.join(packageRoot, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(packageRoot, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  for (const name of fs.readdirSync(path.join(packageRoot, "operational-fixtures")).filter((name) => name.endsWith(".json"))) files.push(`operational-fixtures/${name}`);
  return files.sort();
}

function fixtureMap(packageRoot) {
  const names = fs.readdirSync(path.join(packageRoot, "operational-fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === CLASSES.length && new Set(names).size === CLASSES.length, "OpenAPI fixture inventory is not exact", "OPENAPI_CONTRACTS_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(packageRoot, "operational-fixtures", name);
    const fixture = json(file);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === BLOCK_ID && fixture.hostile === true, `OpenAPI fixture is not a bound hostile vector: ${name}`, "OPENAPI_CONTRACTS_FIXTURE_UNBOUND");
    assert(CLASSES.includes(fixture.class) && fixture.fixture_id === `specialist.product-client.openapi-contracts.${fixture.class.toUpperCase()}`, `OpenAPI fixture identity is invalid: ${name}`, "OPENAPI_CONTRACTS_FIXTURE_ID_INVALID");
    assert(fixture.expected && typeof fixture.expected === "object" && JSON.stringify(Object.keys(fixture.expected).sort()) === JSON.stringify(["disposition", "error_code", "route"].sort()), `OpenAPI fixture expectation is invalid: ${name}`, "OPENAPI_CONTRACTS_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector && fixture.vector.entrypoint === "control/openapi-contracts-boundary-gate.mjs#evaluateOpenApiContractsBoundary", `OpenAPI fixture entrypoint is not public: ${name}`, "OPENAPI_CONTRACTS_FIXTURE_ENTRYPOINT_INVALID");
    assert(fixture.vector.input?.schema === OPENAPI_CONTRACTS_INPUT_SCHEMA && fixture.vector.input?.version === 1, `OpenAPI fixture input is not executable: ${name}`, "OPENAPI_CONTRACTS_FIXTURE_INPUT_INVALID");
    assert(JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `OpenAPI fixture expected readback is not bound: ${name}`, "OPENAPI_CONTRACTS_FIXTURE_EXPECTATION_UNBOUND");
    assert(!map.has(fixture.class), `Duplicate OpenAPI fixture class: ${name}`, "OPENAPI_CONTRACTS_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: fileSha(file)});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "OpenAPI fixture classes are incomplete", "OPENAPI_CONTRACTS_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function assertBoundaryResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} result is not an object`, "OPENAPI_CONTRACTS_RESULT_SCHEMA_INVALID");
  const baseKeys = ["schema", "version", "disposition", "route", "analysis_allowed", "acceptance_allowed", "implementation_selection_allowed", "lifecycle_mutation_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256"];
  const allowed = new Set([...baseKeys, "selected_specialist", "handoff", "unknowns", "missing_fields"]);
  assert(Object.keys(actual).every((key) => allowed.has(key)), `${label} result contains unknown fields`, "OPENAPI_CONTRACTS_RESULT_SCHEMA_INVALID");
  assert(actual.schema === OPENAPI_CONTRACTS_RESULT_SCHEMA && actual.version === 1, `${label} result identity differs`, "OPENAPI_CONTRACTS_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} disposition/route/error differs`, "OPENAPI_CONTRACTS_HOSTILE_RESULT_FAILED");
  assert(actual.acceptance_allowed === false && actual.implementation_selection_allowed === false && actual.lifecycle_mutation_allowed === false, `${label} exposes forbidden capability`, "OPENAPI_CONTRACTS_RESULT_CAPABILITY_INVALID");
  assert(actual.external_side_effects && Object.values(actual.external_side_effects).every((value) => value === 0), `${label} reports a side effect`, "OPENAPI_CONTRACTS_RESULT_SIDE_EFFECT");
  assert(actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is inconsistent`, "OPENAPI_CONTRACTS_RESULT_DIGEST_INVALID");
  if (expected.disposition === "ROUTE") {
    assert(actual.analysis_allowed === true && actual.selected_specialist === BLOCK_ID, `${label} route capability is not bound`, "OPENAPI_CONTRACTS_RESULT_CAPABILITY_INVALID");
    assert(actual.handoff?.status === "WAITING_WITH_RECEIPT" && actual.handoff.execution_instruction === false, `${label} handoff widens authority`, "OPENAPI_CONTRACTS_RESULT_CAPABILITY_INVALID");
  } else assert(actual.analysis_allowed === false, `${label} non-route result allows analysis`, "OPENAPI_CONTRACTS_RESULT_CAPABILITY_INVALID");
  return actual;
}

function executeGates(packageRoot, fixtureMapValue) {
  const manifest = json(path.join(packageRoot, "gates/manifest.json"));
  const execution = json(path.join(packageRoot, "gates/execution.json"));
  assert(execution.schema === "agentos.openapi_contracts_gate_execution.v1" && execution.version === 1 && execution.block_id === BLOCK_ID, "OpenAPI gate execution manifest is invalid", "OPENAPI_CONTRACTS_GATE_EXECUTION_MANIFEST_INVALID");
  assert(execution.evaluator_entrypoint === "control/openapi-contracts-package-evaluator.mjs#evaluateOpenApiContractsPackage", "OpenAPI gate evaluator binding is invalid", "OPENAPI_CONTRACTS_GATE_EXECUTION_ENTRYPOINT_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(manifest.ordered_gate_ids), "OpenAPI gate execution order differs", "OPENAPI_CONTRACTS_GATE_EXECUTION_ORDER_INVALID");
  assert(Array.isArray(execution.executions) && execution.executions.length === GATE_IDS.length, "OpenAPI gate executions are incomplete", "OPENAPI_CONTRACTS_GATE_EXECUTION_INVENTORY_INVALID");
  const seen = new Set();
  const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && GATE_IDS.includes(entry.gate_id), `OpenAPI gate execution is duplicated or unknown: ${entry.gate_id}`, "OPENAPI_CONTRACTS_GATE_EXECUTION_ID_INVALID");
    seen.add(entry.gate_id);
    const gate = json(path.join(packageRoot, "gates", `${entry.gate_id}.gate`));
    assert(gate.gate_id === entry.gate_id && gate.status === "EXECUTABLE", `OpenAPI gate is not executable: ${entry.gate_id}`, "OPENAPI_CONTRACTS_GATE_NOT_EXECUTABLE");
    const fixtureEntry = fixtureMapValue.get(entry.fixture_class);
    assert(fixtureEntry, `OpenAPI gate fixture is missing: ${entry.fixture_class}`, "OPENAPI_CONTRACTS_GATE_FIXTURE_MISSING");
    const actual = evaluateOpenApiContractsBoundary(fixtureEntry.fixture.vector.input);
    assertBoundaryResult(actual, entry.expected, `OpenAPI gate ${entry.gate_id}`);
    const evidence = Object.fromEntries(gate.evidence.map((key) => [key, "bound"]));
    const yes = evaluateGateAnswer(gate, "YES", evidence);
    const no = evaluateGateAnswer(gate, "NO", evidence);
    const unknown = evaluateGateAnswer(gate, "UNKNOWN", evidence);
    const notApplicable = evaluateGateAnswer(gate, "NOT_APPLICABLE", evidence);
    assert(yes.outcome === "YES" && yes.dependent_action === "ADVANCES", `OpenAPI gate YES branch is invalid: ${entry.gate_id}`, "OPENAPI_CONTRACTS_GATE_BRANCH_INVALID");
    assert(no.outcome === "NO" && no.dependent_action === "DENIED", `OpenAPI gate NO branch is invalid: ${entry.gate_id}`, "OPENAPI_CONTRACTS_GATE_BRANCH_INVALID");
    assert(unknown.outcome === "UNKNOWN" && unknown.dependent_action === "CLOSED" && unknown.unrelated_work === "CONTINUES", `OpenAPI gate UNKNOWN branch is not fail-closed: ${entry.gate_id}`, "OPENAPI_CONTRACTS_GATE_BRANCH_INVALID");
    assert(notApplicable.outcome === "NOT_APPLICABLE" && notApplicable.dependent_action === "SKIPPED", `OpenAPI gate NOT_APPLICABLE branch is invalid: ${entry.gate_id}`, "OPENAPI_CONTRACTS_GATE_BRANCH_INVALID");
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: execution.evaluator_entrypoint, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, four_valued_branches: {yes, no, unknown, not_applicable: notApplicable}, external_side_effects: actual.external_side_effects});
  }
  assert(seen.size === GATE_IDS.length, "OpenAPI gate execution coverage is incomplete", "OPENAPI_CONTRACTS_GATE_EXECUTION_COVERAGE_INVALID");
  return results;
}

async function mutationSensitivity(fixtureMapValue) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-openapi-contracts-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "openapi-contracts-boundary-gate.mjs");
    const sourceFile = path.join(ROOT, "control/openapi-contracts-boundary-gate.mjs");
    const anchor = 'if (f.scope_expanded || f.broad_claim || f.umbrella_authority) return result("DENY", "NARROW_SCOPE_REQUIRED", "OPENAPI_CONTRACTS_SCOPE_EXPANSION_FORBIDDEN", input);';
    let source = fileText(sourceFile);
    assert(source.includes(anchor), "OpenAPI mutation anchor is missing", "OPENAPI_CONTRACTS_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim || f.umbrella_authority) return result("ROUTE", "OPENAPI_CONTRACT_ANALYSIS_HANDOFF", "MUTATED_SCOPE_EXPANSION_ALLOWED", input, {analysis_allowed:true, selected_specialist:"specialist.product-client.openapi-contracts", handoff:{status:"WAITING_WITH_RECEIPT", next_action:"mutated", execution_instruction:false}});');
    fs.writeFileSync(target, source, {flag: "wx"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const observed = module.evaluateOpenApiContractsBoundary(fixtureMapValue.get("broad_when_narrow_exists").fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, observed_result_sha256: observed.result_sha256};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

export async function evaluateOpenApiContractsPackage({candidateBinding = null} = {}) {
  const authority = resolveOpenApiContractsCanonicalAuthority();
  const packageRoot = path.join(ROOT, PACKAGE);
  if (candidateBinding) {
    validateOpenApiContractsCandidateBinding(candidateBinding, {repositoryRoot: ROOT});
    assert(candidateBinding.block_sha256 === authority.block_sha256 && candidateBinding.package_id === PACKAGE, "candidate binding is for another OpenAPI package", "OPENAPI_CONTRACTS_CANDIDATE_SCOPE_INVALID");
  }
  const block = json(path.join(packageRoot, "block.json"));
  const routeArtifact = json(path.join(packageRoot, "model-policy-route.json"));
  const contextArtifact = json(path.join(packageRoot, "context-binding.json"));
  const registryEntry = json(path.join(packageRoot, "registry-entry.json"));
  assert(registryEntry.stable_agent_id === "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS" && registryEntry.block_id === BLOCK_ID && registryEntry.status === "CANDIDATE_READY_FOR_QUALIFICATION" && registryEntry.activation === "OFF" && registryEntry.admission_allowed === false, "OpenAPI registry entry is not an inactive candidate", "OPENAPI_CONTRACTS_REGISTRY_ENTRY_INVALID");
  assert(registryEntry.registry_entry_sha256 === canonicalDigest({...registryEntry, registry_entry_sha256: null}), "OpenAPI registry entry digest is invalid", "OPENAPI_CONTRACTS_REGISTRY_ENTRY_INVALID");
  assert(canonicalDigest({...routeArtifact, route_sha256: null}) === routeArtifact.route_sha256 && JSON.stringify(routeArtifact) === JSON.stringify(authority.model_route), "OpenAPI model-policy route artifact is stale or substituted", "OPENAPI_CONTRACTS_MODEL_ROUTE_ARTIFACT_INVALID");
  validateOpenApiContractsContext(contextArtifact, authority);
  assert(JSON.stringify(contextArtifact) === JSON.stringify(authority.context), "OpenAPI context artifact is stale or substituted", "OPENAPI_CONTRACTS_CONTEXT_ARTIFACT_INVALID");
  const compiled = compileSpecialistLibrary({repositoryRoot: ROOT, writeGenerated: false});
  const compiledRecord = compiled.records.find((record) => record.block.block_id === BLOCK_ID);
  assert(compiledRecord, "OpenAPI package is absent from the static specialist compiler", "OPENAPI_CONTRACTS_STATIC_PACKAGE_MISSING");
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "OpenAPI package is not an inactive candidate", "OPENAPI_CONTRACTS_PACKAGE_STATE_INVALID");
  const files = inventory(packageRoot);
  const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: fileSha(path.join(packageRoot, relative_path))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "OpenAPI gate inventory is incomplete", "OPENAPI_CONTRACTS_GATE_INVENTORY_INVALID");
  const fixtures = fixtureMap(packageRoot);
  const fixtureResults = [];
  for (const entry of [...fixtures.values()].sort((left, right) => left.fixture.class.localeCompare(right.fixture.class))) {
    const fixture = entry.fixture;
    assert(scanPersistedRecord(fixture.vector.input).safe, `OpenAPI fixture contains protected data: ${fixture.class}`, "OPENAPI_CONTRACTS_FIXTURE_PRIVACY_DENIED");
    const actual = evaluateOpenApiContractsBoundary(fixture.vector.input);
    assertBoundaryResult(actual, fixture.expected, `OpenAPI fixture ${fixture.class}`);
    fixtureResults.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: fixture.expected.route, actual_route: actual.route, expected_error_code: fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({fixture_id: fixture.fixture_id, actual_result_sha256: actual.result_sha256})});
  }
  const gateExecution = executeGates(packageRoot, fixtures);
  const unsupportedToolInput = JSON.parse(JSON.stringify(fixtures.get("narrowness").fixture.vector.input));
  unsupportedToolInput.evidence.adversarial_flags.unsupported_tool = true;
  const unsupportedToolResult = evaluateOpenApiContractsBoundary(unsupportedToolInput);
  assert(unsupportedToolResult.disposition === "DENY" && unsupportedToolResult.error_code === "OPENAPI_CONTRACTS_TOOL_SCOPE_FORBIDDEN", "unsupported-tool hostile branch did not deny", "OPENAPI_CONTRACTS_HOSTILE_BRANCH_MISSING");
  const protectedInput = JSON.parse(JSON.stringify(fixtures.get("narrowness").fixture.vector.input));
  protectedInput.evidence.project_data_present = true;
  const protectedResult = evaluateOpenApiContractsBoundary(protectedInput);
  assert(protectedResult.disposition === "DENY" && protectedResult.error_code === "OPENAPI_CONTRACTS_PROTECTED_DATA_FORBIDDEN", "protected-data hostile branch did not deny", "OPENAPI_CONTRACTS_HOSTILE_BRANCH_MISSING");
  const baseContextReadback = invalidationReadback({context: contextArtifact, authority});
  const staleContextReadback = invalidationReadback({context: contextArtifact, authority, observed: {model_snapshot_sha256: "f".repeat(64)}});
  assert(baseContextReadback.invalidated === false && baseContextReadback.reuse_allowed === true, "bound OpenAPI context was not reusable", "OPENAPI_CONTRACTS_INVALIDATION_INVALID");
  assert(staleContextReadback.invalidated === true && staleContextReadback.reuse_allowed === false && staleContextReadback.fresh_binding_required === true, "stale OpenAPI context was not invalidated", "OPENAPI_CONTRACTS_INVALIDATION_INVALID");
  const lifecycleReady = assertOpenApiContractsLifecycleReadback(transitionOpenApiContractsLifecycle({from: "CANDIDATE", to: "EVALUATION_PENDING", actor: "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS"}));
  const lifecycleBlocked = assertOpenApiContractsLifecycleReadback(transitionOpenApiContractsLifecycle({from: "CANDIDATE", to: "ADMITTED", actor: "AGENT.PRODUCT_CLIENT_OPENAPI_CONTRACTS"}));
  assert(lifecycleReady.allowed === true && lifecycleReady.activation === "OFF", "OpenAPI candidate lifecycle entry is invalid", "OPENAPI_CONTRACTS_LIFECYCLE_INVALID");
  assert(lifecycleBlocked.allowed === false, "OpenAPI builder lifecycle self-admission was allowed", "OPENAPI_CONTRACTS_LIFECYCLE_AUTHORITY_INVALID");
  const mutation = await mutationSensitivity(fixtures);
  assert(mutation.mutation_detected === true && mutation.status === "WEAKENED", "OpenAPI mutation proof did not execute", "OPENAPI_CONTRACTS_MUTATION_PROOF_MISSING");
  const evaluationArtifactSha = fileSha(path.join(packageRoot, "evaluation.json"));
  const handoffArtifactSha = fileSha(path.join(packageRoot, "handoff.json"));
  const evaluation = {
    schema: OPENAPI_CONTRACTS_PACKAGE_EVALUATION_SCHEMA,
    version: 1,
    status: "PASS_PENDING_INDEPENDENT_REVIEW",
    deterministic_status: "PASS",
    block_id: BLOCK_ID,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    admission_allowed: false,
    package_root_sha256: canonicalDigest(digests),
    package_block_sha256: block.block_sha256,
    gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))),
    fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))),
    gate_execution: gateExecution,
    fixture_results: fixtureResults,
    additional_hostile_branches: [
      {branch: "unsupported_tool", disposition: unsupportedToolResult.disposition, error_code: unsupportedToolResult.error_code, result_sha256: unsupportedToolResult.result_sha256},
      {branch: "protected_data", disposition: protectedResult.disposition, error_code: protectedResult.error_code, result_sha256: protectedResult.result_sha256},
    ],
    mutation_sensitivity: mutation,
    context_invalidation: {bound: baseContextReadback, stale: staleContextReadback},
    lifecycle_readback: {builder_entry: lifecycleReady, builder_admission_attempt: lifecycleBlocked},
    independent_signature_required: true,
    independent_auditor_model: "gpt-5.6-luna",
    independent_auditor_reasoning_effort: "max",
    source_manifest_sha256: authority.source_manifest_sha256,
    model_policy_snapshot_sha256: authority.model.snapshot_sha256,
    model_route_sha256: authority.model_route_sha256,
    context_sha256: authority.context_sha256,
    upstream_router_result_sha256: authority.router_result_sha256,
    evaluation_file_sha256: evaluationArtifactSha,
    handoff_file_sha256: handoffArtifactSha,
    candidate_binding_sha256: candidateBinding?.binding_sha256 ?? null,
    observed_at_utc: new Date().toISOString(),
    evaluation_sha256: null,
  };
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const bindingIndex = process.argv.indexOf("--candidate-binding");
  const candidateBinding = bindingIndex >= 0 ? json(path.resolve(process.argv[bindingIndex + 1])) : null;
  const result = await evaluateOpenApiContractsPackage({candidateBinding});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
