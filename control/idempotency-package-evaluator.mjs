#!/usr/bin/env node

/* Independent, read-only evaluator for the Idempotency specialist package. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateIdempotencyBoundary, IDEMPOTENCY_INPUT_SCHEMA} from "./idempotency-boundary-gate.mjs";
import {assertIdempotencyCommittedHandoff, resolveIdempotencyCanonicalAuthority, IDEMPOTENCY_BLOCK_ID, IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256} from "./idempotency-authority-binding.mjs";

export const IDEMPOTENCY_EVALUATION_SCHEMA = "agentos.specialist_idempotency_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-03/idempotency";
const CLASSES = Object.freeze(["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"]);
const GATE_IDS = Object.freeze(["00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff", "10-proof-acceptance", "11-lifecycle-recovery-archive"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "IDEMPOTENCY_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}
function assertResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} result is not an object`, "IDEMPOTENCY_RESULT_SCHEMA_INVALID");
  const base = ["schema", "version", "disposition", "route", "analysis_allowed", "routing_allowed", "acceptance_allowed", "authorization_decision_allowed", "policy_mutation_allowed", "submission_mutation_allowed", "replay_mutation_allowed", "credential_issue_allowed", "memory_write_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256"];
  const expectedKeys = expected.disposition === "ROUTE" ? [...base, "selected_specialist", "handoff"] : base;
  assert(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(expectedKeys.slice().sort()), `${label} result fields differ`, "IDEMPOTENCY_RESULT_SCHEMA_INVALID");
  assert(actual.schema === "agentos.idempotency_boundary_result.v1" && actual.version === 1, `${label} result identity differs`, "IDEMPOTENCY_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result differs from committed expected readback`, "IDEMPOTENCY_HOSTILE_RESULT_FAILED");
  assert(actual.analysis_allowed === (expected.disposition === "ROUTE") && actual.routing_allowed === (expected.disposition === "ROUTE"), `${label} analysis/routing capability is not route-derived`, "IDEMPOTENCY_RESULT_CAPABILITY_INVALID");
  assert(actual.acceptance_allowed === false && actual.authorization_decision_allowed === false && actual.policy_mutation_allowed === false && actual.submission_mutation_allowed === false && actual.replay_mutation_allowed === false && actual.credential_issue_allowed === false && actual.memory_write_allowed === false, `${label} exposes a forbidden capability`, "IDEMPOTENCY_RESULT_CAPABILITY_INVALID");
  const sideEffects = ["idempotency_record_reads", "idempotency_store_reads", "source_reads", "concurrency_checks", "duplicate_decisions", "submission_writes", "replay_mutations", "memory_writes", "acceptance_calls", "credential_accesses", "state_changes"];
  assert(JSON.stringify(Object.keys(actual.external_side_effects).sort()) === JSON.stringify(sideEffects.slice().sort()) && sideEffects.every((key) => actual.external_side_effects[key] === 0), `${label} side-effect readback is nonzero or malformed`, "IDEMPOTENCY_RESULT_SIDE_EFFECT");
  assert(/^[0-9a-f]{64}$/u.test(actual.input_sha256) && /^[0-9a-f]{64}$/u.test(actual.result_sha256) && actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "IDEMPOTENCY_RESULT_DIGEST_INVALID");
  if (expected.disposition === "ROUTE") {
    assert(actual.selected_specialist === IDEMPOTENCY_BLOCK_ID, `${label} selected specialist differs`, "IDEMPOTENCY_RESULT_CAPABILITY_INVALID");
    assert(actual.handoff && JSON.stringify(Object.keys(actual.handoff).sort()) === JSON.stringify(["execution_instruction", "next_action", "status"].sort()) && actual.handoff.status === "WAITING_WITH_RECEIPT" && actual.handoff.execution_instruction === false, `${label} handoff is not bounded`, "IDEMPOTENCY_RESULT_SCHEMA_INVALID");
  }
  return actual;
}
function fixtureMap(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === CLASSES.length && new Set(names).size === CLASSES.length, "Idempotency fixture inventory is incomplete", "IDEMPOTENCY_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.block_id === IDEMPOTENCY_BLOCK_ID && CLASSES.includes(fixture.class) && fixture.hostile === true, `Idempotency fixture is not a bound hostile vector: ${name}`, "IDEMPOTENCY_FIXTURE_UNBOUND");
    assert(fixture.fixture_id === `idempotency-${fixture.class}`, `Idempotency fixture ID is not canonical: ${name}`, "IDEMPOTENCY_FIXTURE_ID_INVALID");
    assert(fixture.expected && typeof fixture.expected === "object" && JSON.stringify(Object.keys(fixture.expected).sort()) === JSON.stringify(["disposition", "error_code", "route"].sort()), `Idempotency fixture expectation is invalid: ${name}`, "IDEMPOTENCY_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector && fixture.vector.entrypoint === "control/idempotency-boundary-gate.mjs#evaluateIdempotencyBoundary" && fixture.vector.input?.schema === IDEMPOTENCY_INPUT_SCHEMA && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Idempotency fixture vector is not executable/bound: ${name}`, "IDEMPOTENCY_FIXTURE_VECTOR_INVALID");
    assert(!map.has(fixture.class), `Idempotency duplicate fixture class: ${name}`, "IDEMPOTENCY_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "Idempotency fixture classes are incomplete", "IDEMPOTENCY_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function gateExecutions(root, map, authority) {
  const manifest = json(path.join(root, "gates/manifest.json")); const execution = json(path.join(root, "gates/execution.json"));
  assert(execution.schema === "agentos.idempotency_gate_execution.v1" && execution.version === 1 && execution.block_id === IDEMPOTENCY_BLOCK_ID, "Idempotency gate execution manifest is invalid", "IDEMPOTENCY_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/idempotency-package-evaluator.mjs#evaluateIdempotencyPackage" && JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(manifest.ordered_gate_ids) && execution.executions.length === GATE_IDS.length, "Idempotency gate execution order/inventory is invalid", "IDEMPOTENCY_GATE_EXECUTION_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && GATE_IDS.includes(entry.gate_id), `Idempotency gate execution is duplicated or unknown: ${entry.gate_id}`, "IDEMPOTENCY_GATE_EXECUTION_ID_INVALID"); seen.add(entry.gate_id);
    assert(entry.expected && map.has(entry.fixture_class), `Idempotency gate execution fixture is missing: ${entry.gate_id}`, "IDEMPOTENCY_GATE_FIXTURE_MISSING");
    const fixture = map.get(entry.fixture_class).fixture; const expected = entry.adversarial_flags && Object.keys(entry.adversarial_flags).length ? entry.expected : fixture.expected;
    if (!entry.adversarial_flags || Object.keys(entry.adversarial_flags).length === 0) assert(JSON.stringify(entry.expected) === JSON.stringify(fixture.expected) && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(entry.expected), `Idempotency gate ${entry.gate_id} is not fixture-bound`, "IDEMPOTENCY_GATE_EXPECTATION_UNBOUND");
    const input = structuredClone(fixture.vector.input); Object.assign(input.evidence.adversarial_flags, entry.adversarial_flags ?? {}); input.evidence.candidate_digest = authority.block_sha256; input.evidence.idempotency_key = authority.block_sha256;
    const actual = evaluateIdempotencyBoundary(input); assertResult(actual, expected, `Idempotency gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: execution.evaluator_entrypoint, expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, external_side_effects: actual.external_side_effects});
  }
  assert(seen.size === GATE_IDS.length, "Idempotency gate execution coverage is incomplete", "IDEMPOTENCY_GATE_EXECUTION_COVERAGE_INVALID");
  return results;
}
async function mutation(candidateDigest) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-idempotency-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.cpSync(path.join(ROOT, "control"), control, {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "wave-03", "idempotency"), path.join(temp, "specialist-blocks", "wave-03", "idempotency"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "standards", "owasp-asvs"), path.join(temp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
    fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true}); fs.copyFileSync(path.join(ROOT, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json")); fs.cpSync(path.join(ROOT, "fixtures", "model-policy-evidence"), path.join(temp, "fixtures", "model-policy-evidence"), {recursive: true});
    const target = path.join(control, "idempotency-boundary-gate.mjs"); let source = read(path.join(ROOT, "control/idempotency-boundary-gate.mjs"));
    const anchor = 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "IDEMPOTENCY_SCOPE_EXPANSION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Idempotency mutation anchor is missing", "IDEMPOTENCY_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("ROUTE", "IDEMPOTENCY_ANALYSIS_HANDOFF", "MUTATED_IDEMPOTENCY_SCOPE_ALLOWED", input, {analysis_allowed: true, routing_allowed: true, selected_specialist: "specialist.security.idempotency", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "mutated", execution_instruction: false}});');
    fs.writeFileSync(target, source);
    const authorityModule = await import(`${pathToFileURL(path.join(control, "idempotency-authority-binding.mjs")).href}?mutation-authority=${Date.now()}`); const authority = authorityModule.resolveIdempotencyCanonicalAuthority();
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`); const input = structuredClone(json(path.join(ROOT, PACKAGE, "fixtures/broad_when_narrow_exists.json")).vector.input); input.evidence.candidate_digest = candidateDigest; input.evidence.idempotency_key = candidateDigest; const observed = module.evaluateIdempotencyBoundary(input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, authority_block_sha256: authority.block_sha256};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

export async function evaluateIdempotencyPackage() {
  const authority = resolveIdempotencyCanonicalAuthority(); const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json"));
  assert(block.block_id === IDEMPOTENCY_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.block_sha256 === authority.block_sha256, "Idempotency package state or canonical identity is invalid", "IDEMPOTENCY_PACKAGE_STATE_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === GATE_IDS.length, "Idempotency gates are incomplete", "IDEMPOTENCY_GATE_INVENTORY_INVALID");
  const map = fixtureMap(root); const gateExecution = gateExecutions(root, map, authority); const results = [];
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const {fixture} = entry; const input = structuredClone(fixture.vector.input); input.evidence.candidate_digest = authority.block_sha256; input.evidence.idempotency_key = authority.block_sha256; const actual = evaluateIdempotencyBoundary(input); assertResult(actual, fixture.expected, `Idempotency vector ${fixture.class}`);
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: fixture.expected.route, actual_route: actual.route, expected_error_code: fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected: fixture.expected, actual: actual.result_sha256})});
  }
  const evaluationArtifact = {value: json(path.join(root, "evaluation.json")), file_sha256: sha(fs.readFileSync(path.join(root, "evaluation.json")))}; const handoffArtifact = {value: json(path.join(root, "handoff.json")), file_sha256: sha(fs.readFileSync(path.join(root, "handoff.json")))};
  assertIdempotencyCommittedHandoff({authority, evaluation: evaluationArtifact.value, handoff: handoffArtifact.value, evaluationFileSha256: evaluationArtifact.file_sha256, handoffFileSha256: handoffArtifact.file_sha256});
  const sensitivity = await mutation(block.block_sha256); assert(sensitivity.mutation_detected, "Idempotency mutation proof is missing", "IDEMPOTENCY_MUTATION_PROOF_MISSING");
  const evaluation = {schema: IDEMPOTENCY_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: IDEMPOTENCY_BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), gate_execution: gateExecution, fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), source_manifest_sha256: authority.source_manifest_sha256, source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date, model_snapshot_sha256: authority.model.snapshot_sha256, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, upstream_router_result_sha256: authority.router_result_sha256, gate_semantic_inventory_sha256: authority.gate_semantic_inventory_sha256, evaluation_file_sha256: authority.evaluation_file_sha256, handoff_file_sha256: authority.handoff_file_sha256, evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateIdempotencyPackage(), null, 2)}\n`);
