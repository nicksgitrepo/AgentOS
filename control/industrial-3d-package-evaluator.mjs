#!/usr/bin/env node

/* Independent, read-only operational evaluator for the Industrial 3D package. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateIndustrial3dBoundary, INDUSTRIAL_3D_INPUT_SCHEMA} from "./industrial-3d-boundary-gate.mjs";
import {
  assertIndustrial3dCommittedHandoff,
  INDUSTRIAL_3D_BLOCK_ID,
  INDUSTRIAL_3D_FIXTURE_CLASSES,
  INDUSTRIAL_3D_GATE_IDS,
  resolveIndustrial3dCanonicalAuthority,
} from "./industrial-3d-authority-binding.mjs";

export const INDUSTRIAL_3D_EVALUATION_SCHEMA = "agentos.specialist_industrial_3d_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-06/industrial-3d";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));

function fail(message, code = "INDUSTRIAL_3D_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((candidate) => candidate.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((candidate) => candidate.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}
function assertResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} result is not an object`, "INDUSTRIAL_3D_RESULT_SCHEMA_INVALID");
  const base = ["schema", "version", "disposition", "route", "analysis_allowed", "routing_allowed", "acceptance_allowed", "asset_mutation_allowed", "engineering_assertion_allowed", "memory_write_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256"];
  const expectedKeys = expected.disposition === "ROUTE" ? [...base, "selected_specialist", "handoff"] : base;
  assert(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(expectedKeys.slice().sort()), `${label} result fields differ`, "INDUSTRIAL_3D_RESULT_SCHEMA_INVALID");
  assert(actual.schema === "agentos.industrial_3d_boundary_result.v1" && actual.version === 1, `${label} result identity differs`, "INDUSTRIAL_3D_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result differs from the fixture readback`, "INDUSTRIAL_3D_HOSTILE_RESULT_FAILED");
  const normalAnalysis = expected.route === "INDUSTRIAL_3D_ANALYSIS_HANDOFF";
  assert(actual.analysis_allowed === normalAnalysis && actual.routing_allowed === (expected.disposition === "ROUTE"), `${label} capability flags are not route-derived`, "INDUSTRIAL_3D_RESULT_CAPABILITY_INVALID");
  assert(actual.acceptance_allowed === false && actual.asset_mutation_allowed === false && actual.engineering_assertion_allowed === false && actual.memory_write_allowed === false, `${label} exposes a forbidden capability`, "INDUSTRIAL_3D_RESULT_CAPABILITY_INVALID");
  const sideEffects = ["asset_evidence_reads", "asset_writes", "source_reads", "standard_reads", "memory_writes", "engineering_assertions", "acceptance_calls", "credential_accesses", "state_changes"];
  assert(JSON.stringify(Object.keys(actual.external_side_effects).sort()) === JSON.stringify(sideEffects.slice().sort()) && sideEffects.every((key) => actual.external_side_effects[key] === 0), `${label} side-effect readback is nonzero or malformed`, "INDUSTRIAL_3D_RESULT_SIDE_EFFECT");
  assert(/^[0-9a-f]{64}$/u.test(actual.input_sha256) && /^[0-9a-f]{64}$/u.test(actual.result_sha256) && actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "INDUSTRIAL_3D_RESULT_DIGEST_INVALID");
  if (expected.disposition === "ROUTE") {
    assert(actual.selected_specialist === INDUSTRIAL_3D_BLOCK_ID, `${label} selected specialist differs`, "INDUSTRIAL_3D_RESULT_CAPABILITY_INVALID");
    assert(actual.handoff && JSON.stringify(Object.keys(actual.handoff).sort()) === JSON.stringify(["execution_instruction", "next_action", "status"].sort()) && actual.handoff.status === "WAITING_WITH_RECEIPT" && actual.handoff.execution_instruction === false, `${label} handoff is not bounded`, "INDUSTRIAL_3D_RESULT_SCHEMA_INVALID");
  }
  return actual;
}
function fixtureMap(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === INDUSTRIAL_3D_FIXTURE_CLASSES.length && new Set(names).size === INDUSTRIAL_3D_FIXTURE_CLASSES.length, "Industrial 3D fixture inventory is incomplete", "INDUSTRIAL_3D_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.block_id === INDUSTRIAL_3D_BLOCK_ID && fixture.hostile === true && INDUSTRIAL_3D_FIXTURE_CLASSES.includes(fixture.class), `Industrial 3D fixture is not a bound hostile vector: ${name}`, "INDUSTRIAL_3D_FIXTURE_UNBOUND");
    assert(fixture.fixture_id === `industrial-3d-${fixture.class}`, `Industrial 3D fixture ID is not canonical: ${name}`, "INDUSTRIAL_3D_FIXTURE_ID_INVALID");
    assert(fixture.expected && JSON.stringify(Object.keys(fixture.expected).sort()) === JSON.stringify(["disposition", "error_code", "route"].sort()), `Industrial 3D fixture expectation is invalid: ${name}`, "INDUSTRIAL_3D_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector?.entrypoint === "control/industrial-3d-boundary-gate.mjs#evaluateIndustrial3dBoundary" && fixture.vector.input?.schema === INDUSTRIAL_3D_INPUT_SCHEMA && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Industrial 3D fixture vector is not executable/bound: ${name}`, "INDUSTRIAL_3D_FIXTURE_VECTOR_INVALID");
    assert(!map.has(fixture.class), `Industrial 3D duplicate fixture class: ${name}`, "INDUSTRIAL_3D_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === INDUSTRIAL_3D_FIXTURE_CLASSES.slice().sort().join("\0"), "Industrial 3D fixture classes are incomplete", "INDUSTRIAL_3D_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function gateExecutions(root, map, authority) {
  const manifest = json(path.join(root, "gates/manifest.json")); const execution = json(path.join(root, "gates/execution.json"));
  assert(execution.schema === "agentos.industrial_3d_gate_execution.v1" && execution.version === 1 && execution.block_id === INDUSTRIAL_3D_BLOCK_ID, "Industrial 3D gate execution manifest is invalid", "INDUSTRIAL_3D_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/industrial-3d-package-evaluator.mjs#evaluateIndustrial3dPackage" && JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(manifest.ordered_gate_ids) && JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(INDUSTRIAL_3D_GATE_IDS) && execution.executions.length === INDUSTRIAL_3D_GATE_IDS.length, "Industrial 3D gate execution order/inventory is invalid", "INDUSTRIAL_3D_GATE_EXECUTION_INVALID");
  assert(execution.execution_sha256 === canonicalDigest({...execution, execution_sha256: null}), "Industrial 3D gate execution digest differs", "INDUSTRIAL_3D_GATE_EXECUTION_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && INDUSTRIAL_3D_GATE_IDS.includes(entry.gate_id), `Industrial 3D gate execution is duplicated or unknown: ${entry.gate_id}`, "INDUSTRIAL_3D_GATE_EXECUTION_ID_INVALID"); seen.add(entry.gate_id);
    assert(entry.expected && map.has(entry.fixture_class), `Industrial 3D gate execution fixture is missing: ${entry.gate_id}`, "INDUSTRIAL_3D_GATE_FIXTURE_MISSING");
    const fixture = map.get(entry.fixture_class).fixture; const expected = entry.adversarial_flags && Object.keys(entry.adversarial_flags).length ? entry.expected : fixture.expected;
    if (!entry.adversarial_flags || Object.keys(entry.adversarial_flags).length === 0) assert(JSON.stringify(entry.expected) === JSON.stringify(fixture.expected), `Industrial 3D gate ${entry.gate_id} is not fixture-bound`, "INDUSTRIAL_3D_GATE_EXPECTATION_UNBOUND");
    const input = structuredClone(fixture.vector.input); Object.assign(input.evidence.adversarial_flags, entry.adversarial_flags ?? {});
    const actual = evaluateIndustrial3dBoundary(input); assertResult(actual, expected, `Industrial 3D gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: execution.evaluator_entrypoint, expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, external_side_effects: actual.external_side_effects});
  }
  assert(seen.size === INDUSTRIAL_3D_GATE_IDS.length, "Industrial 3D gate execution coverage is incomplete", "INDUSTRIAL_3D_GATE_EXECUTION_COVERAGE_INVALID");
  return results;
}
async function mutation() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-industrial-3d-mutation-"));
  try {
    fs.cpSync(path.join(ROOT, "control"), path.join(temp, "control"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks/wave-06/industrial-3d"), path.join(temp, "specialist-blocks/wave-06/industrial-3d"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks/wave-06/industrial-3d-router"), path.join(temp, "specialist-blocks/wave-06/industrial-3d-router"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks/standards/gltf-2-0-1"), path.join(temp, "specialist-blocks/standards/gltf-2-0-1"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks/registry"), path.join(temp, "specialist-blocks/registry"), {recursive: true});
    fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
    fs.copyFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures/model-policy-snapshot.initial.v1.json"));
    fs.cpSync(path.join(ROOT, "fixtures/model-policy-evidence"), path.join(temp, "fixtures/model-policy-evidence"), {recursive: true});
    const target = path.join(temp, "control/industrial-3d-boundary-gate.mjs");
    let source = read(path.join(ROOT, "control/industrial-3d-boundary-gate.mjs"));
    const anchor = 'if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "INDUSTRIAL_3D_SCOPE_EXPANSION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Industrial 3D mutation anchor is missing", "INDUSTRIAL_3D_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim) return result("ROUTE", "INDUSTRIAL_3D_ANALYSIS_HANDOFF", "MUTATED_INDUSTRIAL_3D_SCOPE_ALLOWED", input, {}, {selected_specialist: "specialist.graphics.industrial-3d", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "mutated", execution_instruction: false}});');
    fs.writeFileSync(target, source, {flag: "w"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const input = json(path.join(ROOT, `${PACKAGE}/fixtures/broad_when_narrow_exists.json`)).vector.input;
    const observed = module.evaluateIndustrial3dBoundary(structuredClone(input));
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
async function registryProvenanceMutation() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-industrial-3d-registry-provenance-"));
  try {
    fs.cpSync(path.join(ROOT, "control"), path.join(temp, "control"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks/wave-06/industrial-3d"), path.join(temp, "specialist-blocks/wave-06/industrial-3d"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks/wave-06/industrial-3d-router"), path.join(temp, "specialist-blocks/wave-06/industrial-3d-router"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks/standards/gltf-2-0-1"), path.join(temp, "specialist-blocks/standards/gltf-2-0-1"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks/registry"), path.join(temp, "specialist-blocks/registry"), {recursive: true});
    fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
    fs.copyFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures/model-policy-snapshot.initial.v1.json"));
    fs.cpSync(path.join(ROOT, "fixtures/model-policy-evidence"), path.join(temp, "fixtures/model-policy-evidence"), {recursive: true});
    const registryPath = path.join(temp, "specialist-blocks/registry/agent-roster.v1.json");
    const registry = json(registryPath);
    const unrelated = registry.entries?.find((entry) => entry.stable_agent_id !== "AGENT.GRAPHICS_INDUSTRIAL_3D");
    assert(unrelated, "Industrial 3D registry mutation target is missing", "INDUSTRIAL_3D_REGISTRY_MUTATION_TARGET_MISSING");
    unrelated.display_name = `${unrelated.display_name} [stale-projection-probe]`;
    registry.roster_sha256 = canonicalDigest({...registry, roster_sha256: null});
    fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, {flag: "w"});
    const module = await import(`${pathToFileURL(path.join(temp, "control/industrial-3d-boundary-gate.mjs")).href}?registry-provenance=${Date.now()}`);
    const input = json(path.join(ROOT, `${PACKAGE}/fixtures/routing.json`)).vector.input;
    try {
      module.evaluateIndustrial3dBoundary(structuredClone(input));
      return {status: "WEAKENED", mutation_detected: false, expected_code: "INDUSTRIAL_3D_REGISTRY_CONTEXT_INVALID", observed_code: null};
    } catch (error) {
      return {status: error.code === "INDUSTRIAL_3D_REGISTRY_CONTEXT_INVALID" ? "INTACT" : "WRONG_REJECTION", mutation_detected: error.code === "INDUSTRIAL_3D_REGISTRY_CONTEXT_INVALID", expected_code: "INDUSTRIAL_3D_REGISTRY_CONTEXT_INVALID", observed_code: error.code ?? "UNCODED"};
    }
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

export async function evaluateIndustrial3dPackage() {
  const authority = resolveIndustrial3dCanonicalAuthority(); const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json"));
  assert(block.block_id === INDUSTRIAL_3D_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.block_sha256 === authority.block_sha256, "Industrial 3D package state or canonical identity is invalid", "INDUSTRIAL_3D_PACKAGE_STATE_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === INDUSTRIAL_3D_GATE_IDS.length, "Industrial 3D gates are incomplete", "INDUSTRIAL_3D_GATE_INVENTORY_INVALID");
  const map = fixtureMap(root); const gateExecution = gateExecutions(root, map, authority); const results = [];
  for (const entry of [...map.values()].sort((left, right) => left.fixture.class.localeCompare(right.fixture.class))) {
    const {fixture} = entry; const actual = evaluateIndustrial3dBoundary(structuredClone(fixture.vector.input)); assertResult(actual, fixture.expected, `Industrial 3D vector ${fixture.class}`);
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: fixture.expected.route, actual_route: actual.route, expected_error_code: fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected: fixture.expected, actual: actual.result_sha256})});
  }
  const evaluationArtifact = {value: json(path.join(root, "evaluation.json")), file_sha256: sha(fs.readFileSync(path.join(root, "evaluation.json")))};
  const handoffArtifact = {value: json(path.join(root, "handoff.json")), file_sha256: sha(fs.readFileSync(path.join(root, "handoff.json")))};
  assertIndustrial3dCommittedHandoff({authority, evaluation: evaluationArtifact.value, handoff: handoffArtifact.value, evaluationFileSha256: evaluationArtifact.file_sha256, handoffFileSha256: handoffArtifact.file_sha256});
  const sensitivity = await mutation(); assert(sensitivity.mutation_detected, "Industrial 3D mutation proof is missing", "INDUSTRIAL_3D_MUTATION_PROOF_MISSING");
  const registryProvenanceSensitivity = await registryProvenanceMutation(); assert(registryProvenanceSensitivity.mutation_detected, "Industrial 3D raw registry provenance mutation proof is missing", "INDUSTRIAL_3D_REGISTRY_MUTATION_PROOF_MISSING");
  const evaluation = {
    schema: INDUSTRIAL_3D_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: INDUSTRIAL_3D_BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF",
    package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, source_manifest_sha256: authority.source_manifest_sha256,
    standard_block_sha256: authority.standard_block_sha256, standard_source_manifest_sha256: authority.standard_source_manifest_sha256, model_snapshot_sha256: authority.model_snapshot_sha256,
    model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_receipt_sha256, memory_readback_sha256: authority.memory_readback_sha256,
    fixture_contract_sha256: authority.fixture_contract_sha256, upstream_router_file_sha256: authority.router_file_sha256,
    upstream_router_block_sha256: authority.router_block_sha256, upstream_router_fixture_sha256: authority.router_fixture_file_sha256,
    upstream_router_input_sha256: authority.router_input_sha256, upstream_router_expected_sha256: authority.router_expected_sha256,
    upstream_router_model_snapshot_sha256: authority.router_model_policy.global_snapshot_sha256, upstream_router_model_route_sha256: authority.router_model_policy.global_route_sha256,
    upstream_router_model_policy_claim: authority.router_model_policy.router_claim, upstream_router_model_binding_status: authority.router_model_policy.status,
    upstream_router_result_sha256: authority.router_result_sha256, agent_roster_semantic_sha256: authority.registry.agent_roster_semantic_sha256,
    agent_roster_file_sha256: authority.registry.registry_raw_file_sha256.agent_roster,
    specialist_roster_file_sha256: authority.registry.registry_raw_file_sha256.specialist_roster,
    atomic_inventory_file_sha256: authority.registry.registry_raw_file_sha256.atomic_inventory,
    routing_index_file_sha256: authority.registry.registry_raw_file_sha256.routing_index,
    specialist_roster_semantic_sha256: authority.registry.specialist_roster_semantic_sha256, atomic_inventory_semantic_sha256: authority.registry.atomic_inventory_semantic_sha256,
    routing_index_semantic_sha256: authority.registry.routing_index_semantic_sha256, registry_contract_sha256: authority.registry.registry_contract_sha256,
    registry_agent_state: authority.registry.registry_agent_state, agent_roster_status: authority.registry.agent_roster_status,
    specialist_roster_status: authority.registry.specialist_roster_status, atomic_inventory_status: authority.registry.atomic_inventory_status,
    routing_index_status: authority.registry.routing_index_status, registry_activation: authority.registry.registry_activation, gate_execution: gateExecution,
    fixture_results: results, mutation_sensitivity: sensitivity, registry_provenance_sensitivity: registryProvenanceSensitivity, independent_signature_required: true, evaluation_sha256: null,
  };
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateIndustrial3dPackage(), null, 2)}\n`);
