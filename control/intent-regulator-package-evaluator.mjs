#!/usr/bin/env node

/* Independent executable evaluator for the intent-regulator candidate. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath, pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateIntentRegulatorBoundary, INTENT_REGULATOR_INPUT_SCHEMA, INTENT_REGULATOR_SIDE_EFFECT_KEYS} from "./intent-regulator-boundary-gate.mjs";
import {
  INTENT_REGULATOR_BLOCK_ID,
  INTENT_REGULATOR_FIXTURE_CLASSES,
  INTENT_REGULATOR_GATE_IDS,
  INTENT_REGULATOR_FLAG_KEYS,
  resolveIntentRegulatorCanonicalAuthority,
  assertIntentRegulatorCommittedHandoff,
} from "./intent-regulator-authority-binding.mjs";
import {validateIntentRegulatorRollbackReceipt} from "./intent-regulator-receipts.mjs";

export const INTENT_REGULATOR_EVALUATION_SCHEMA = "agentos.specialist_intent_regulator_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "specialist-blocks/wave-01/intent-regulator";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "INTENT_REGULATOR_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function fixtureFiles(root) { return fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort(); }
function assertResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} boundary result is not an object`, "INTENT_REGULATOR_RESULT_SCHEMA_INVALID");
  const base = ["schema", "version", "disposition", "route", "intent_preservation_allowed", "routing_allowed", "owner_authority_decision_allowed", "acceptance_allowed", "activation_allowed", "product_mutation_allowed", "memory_write_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256"];
  const routed = actual.disposition === "ROUTE" || actual.disposition === "ESCALATE";
  const expectedKeys = routed ? [...base, "selected_route_target", "handoff"] : base;
  assert(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(expectedKeys.sort()), `${label} result fields differ`, "INTENT_REGULATOR_RESULT_SCHEMA_INVALID");
  assert(actual.schema === "agentos.intent_regulator_boundary_result.v1" && actual.version === 1 && actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result differs from expected readback`, "INTENT_REGULATOR_HOSTILE_RESULT_FAILED");
  assert(actual.intent_preservation_allowed === routed && actual.routing_allowed === routed && actual.owner_authority_decision_allowed === false && actual.acceptance_allowed === false && actual.activation_allowed === false && actual.product_mutation_allowed === false && actual.memory_write_allowed === false, `${label} exposes an unauthorized capability`, "INTENT_REGULATOR_CAPABILITY_INVALID");
  assert(JSON.stringify(Object.keys(actual.external_side_effects).sort()) === JSON.stringify([...INTENT_REGULATOR_SIDE_EFFECT_KEYS].sort()) && INTENT_REGULATOR_SIDE_EFFECT_KEYS.every((key) => actual.external_side_effects[key] === 0), `${label} side-effect readback is nonzero or malformed`, "INTENT_REGULATOR_SIDE_EFFECT_INVALID");
  assert(/^[0-9a-f]{64}$/u.test(actual.input_sha256) && /^[0-9a-f]{64}$/u.test(actual.result_sha256) && actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "INTENT_REGULATOR_RESULT_DIGEST_INVALID");
  if (routed) assert(actual.handoff && JSON.stringify(Object.keys(actual.handoff).sort()) === JSON.stringify(["execution_instruction", "next_action", "rollback_receipt_required", "status"].sort()) && actual.handoff.execution_instruction === false && actual.handoff.rollback_receipt_required === true, `${label} handoff is not bounded`, "INTENT_REGULATOR_HANDOFF_BOUNDARY_INVALID");
  return actual;
}
function fixtureMap(root) {
  const names = fixtureFiles(root);
  assert(JSON.stringify(names.map((name) => name.slice(0, -5)).sort()) === JSON.stringify(INTENT_REGULATOR_FIXTURE_CLASSES.slice().sort()), "Intent-regulator fixture inventory is incomplete", "INTENT_REGULATOR_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === INTENT_REGULATOR_BLOCK_ID && fixture.hostile === true, `Intent-regulator fixture is not bound: ${name}`, "INTENT_REGULATOR_FIXTURE_UNBOUND");
    assert(fixture.fixture_id === `intent-regulator-${fixture.class}` && INTENT_REGULATOR_FIXTURE_CLASSES.includes(fixture.class), `Intent-regulator fixture identity is invalid: ${name}`, "INTENT_REGULATOR_FIXTURE_ID_INVALID");
    assert(fixture.expected && JSON.stringify(Object.keys(fixture.expected).sort()) === JSON.stringify(["disposition", "error_code", "route"].sort()), `Intent-regulator fixture expectation is invalid: ${name}`, "INTENT_REGULATOR_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector?.entrypoint === "control/intent-regulator-boundary-gate.mjs#evaluateIntentRegulatorBoundary" && fixture.vector.input?.schema === INTENT_REGULATOR_INPUT_SCHEMA && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Intent-regulator fixture vector is not executable: ${name}`, "INTENT_REGULATOR_FIXTURE_VECTOR_INVALID");
    assert(!map.has(fixture.class), `Intent-regulator fixture class is duplicated: ${name}`, "INTENT_REGULATOR_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  return map;
}
function boundInput(fixture, authority) {
  const input = structuredClone(fixture.vector.input);
  input.evidence.candidate_digest = authority.block_sha256;
  input.evidence.source_manifest_sha256 = authority.source_manifest_sha256;
  input.evidence.source_lock_sha256 = authority.source_file_sha256;
  input.evidence.model_route_sha256 = authority.model_route_sha256;
  input.evidence.context_receipt_sha256 = authority.context_sha256;
  input.evidence.route_receipt_sha256 = authority.route_sha256;
  return input;
}
function runGateExecutions(root, map, authority) {
  const execution = json(path.join(root, "gates/execution.json"));
  assert(execution.schema === "agentos.intent_regulator_gate_execution.v1" && execution.version === 1 && execution.block_id === INTENT_REGULATOR_BLOCK_ID && execution.evaluator_entrypoint === "control/intent-regulator-package-evaluator.mjs#evaluateIntentRegulatorPackage", "Intent-regulator gate execution manifest is invalid", "INTENT_REGULATOR_GATE_EXECUTION_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(INTENT_REGULATOR_GATE_IDS) && execution.executions.length === INTENT_REGULATOR_GATE_IDS.length, "Intent-regulator gate execution inventory is incomplete", "INTENT_REGULATOR_GATE_EXECUTION_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && INTENT_REGULATOR_GATE_IDS.includes(entry.gate_id) && map.has(entry.fixture_class), `Intent-regulator gate execution is invalid: ${entry.gate_id}`, "INTENT_REGULATOR_GATE_EXECUTION_INVALID");
    seen.add(entry.gate_id);
    const fixture = map.get(entry.fixture_class).fixture; const input = boundInput(fixture, authority); const actual = evaluateIntentRegulatorBoundary(input); assertResult(actual, entry.expected, `Intent-regulator gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: execution.evaluator_entrypoint, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, external_side_effects: actual.external_side_effects});
  }
  assert(seen.size === INTENT_REGULATOR_GATE_IDS.length, "Intent-regulator gate execution coverage is incomplete", "INTENT_REGULATOR_GATE_EXECUTION_INVALID");
  return results;
}
async function mutationSensitivity(authority) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intent-regulator-mutation-"));
  try {
    fs.mkdirSync(path.join(temp, "control"), {recursive: true});
    fs.mkdirSync(path.join(temp, "specialist-blocks", "wave-01"), {recursive: true});
    fs.cpSync(path.join(ROOT, "control"), path.join(temp, "control"), {recursive: true});
    fs.cpSync(path.join(ROOT, PACKAGE), path.join(temp, PACKAGE), {recursive: true});
    const target = path.join(temp, "control", "intent-regulator-boundary-gate.mjs");
    const anchor = 'if (flags.scope_expanded || flags.broad_claim || flags.unrelated_scope) return baseResult(input, "DENY", "NO_ROUTE", "INTENT_REGULATOR_SCOPE_EXPANSION_FORBIDDEN");';
    let source = read(path.join(ROOT, "control", "intent-regulator-boundary-gate.mjs"));
    assert(source.includes(anchor), "Intent-regulator mutation anchor is missing", "INTENT_REGULATOR_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (flags.scope_expanded || flags.broad_claim || flags.unrelated_scope) return routeResult(input, "INTENT_PRESERVATION_HANDOFF", "MUTATED_SCOPE_ALLOWED", "RUNTIME", "mutated");');
    fs.writeFileSync(target, source);
    const authorityModule = await import(`${pathToFileURL(path.join(temp, "control", "intent-regulator-authority-binding.mjs")).href}?mutation-authority=${Date.now()}`);
    const mutatedBoundary = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const fixture = json(path.join(ROOT, PACKAGE, "fixtures", "broad_when_narrow_exists.json"));
    const input = boundInput(fixture, authority);
    const observed = mutatedBoundary.evaluateIntentRegulatorBoundary(input, {authority: authorityModule.resolveIntentRegulatorCanonicalAuthority()});
    return Object.freeze({status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, authority_block_sha256: authority.block_sha256});
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

export async function evaluateIntentRegulatorPackage() {
  const authority = resolveIntentRegulatorCanonicalAuthority();
  const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json"));
  assert(block.block_id === INTENT_REGULATOR_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.block_sha256 === authority.block_sha256, "Intent-regulator package is not an inert canonical candidate", "INTENT_REGULATOR_PACKAGE_STATE_INVALID");
  const map = fixtureMap(root); const gateExecution = runGateExecutions(root, map, authority); const fixtureResults = [];
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const {fixture} = entry; const actual = evaluateIntentRegulatorBoundary(boundInput(fixture, authority)); assertResult(actual, fixture.expected, `Intent-regulator fixture ${fixture.class}`);
    fixtureResults.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: fixture.expected.route, actual_route: actual.route, expected_error_code: fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected: fixture.expected, actual: actual.result_sha256})});
  }
  const rollback = json(path.join(root, "rollback.json")); validateIntentRegulatorRollbackReceipt(rollback, {candidateDigest: authority.block_sha256});
  const evaluation = json(path.join(root, "evaluation.json")); const handoff = json(path.join(root, "handoff.json"));
  assertIntentRegulatorCommittedHandoff({authority, evaluation, handoff, evaluationFileSha256: sha(fs.readFileSync(path.join(root, "evaluation.json"))), handoffFileSha256: sha(fs.readFileSync(path.join(root, "handoff.json")))});
  const sensitivity = await mutationSensitivity(authority); assert(sensitivity.mutation_detected, "Intent-regulator mutation proof is missing", "INTENT_REGULATOR_MUTATION_PROOF_MISSING");
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json", "rollback.json", ...fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate")).map((name) => `gates/${name}`), ...fixtureFiles(root).map((name) => `fixtures/${name}`)].sort();
  const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  const evaluationReceipt = {schema: INTENT_REGULATOR_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: INTENT_REGULATOR_BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: authority.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), gate_execution: gateExecution, fixture_results: fixtureResults, mutation_sensitivity: sensitivity, independent_signature_required: true, source_manifest_sha256: authority.source_manifest_sha256, source_lock_file_sha256: authority.source_file_sha256, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, route_receipt_sha256: authority.route_sha256, gate_semantic_inventory_sha256: authority.gate_semantic_inventory_sha256, rollback_receipt_sha256: rollback.digest, evaluation_sha256: null};
  evaluationReceipt.evaluation_sha256 = canonicalDigest({...evaluationReceipt, evaluation_sha256: null});
  return Object.freeze(evaluationReceipt);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.stdout.write(`${JSON.stringify(await evaluateIntentRegulatorPackage(), null, 2)}\n`);
