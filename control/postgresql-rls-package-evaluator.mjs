#!/usr/bin/env node

/* Operational, read-only evaluator for the PostgreSQL RLS specialist. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluatePostgresqlRlsBoundary, POSTGRESQL_RLS_INPUT_SCHEMA, POSTGRESQL_RLS_RESULT_SCHEMA} from "./postgresql-rls-boundary-gate.mjs";
import {assertPostgresqlRlsCommittedHandoff, resolvePostgresqlRlsCanonicalAuthority, POSTGRESQL_RLS_BLOCK_ID} from "./postgresql-rls-authority-binding.mjs";

export const POSTGRESQL_RLS_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_postgresql_rls_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-02/postgresql-rls";
const PACKAGE = path.join(ROOT, PACKAGE_RELATIVE);
const CLASSES = Object.freeze(["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"]);
const GATE_IDS = Object.freeze(["00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals", "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody", "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff", "10-proof-acceptance", "11-lifecycle-recovery-archive"]);
const SIDE_EFFECT_KEYS = Object.freeze(["candidate_reads", "source_reads", "protected_data_reads", "tenant_boundary_decisions", "policy_mutations", "project_writes", "memory_writes", "credential_accesses", "state_changes"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => { if (!fs.existsSync(file)) fail(`${file} is missing`, "POSTGRESQL_RLS_PACKAGE_FILE_MISSING"); return fs.readFileSync(file); };
const json = (file) => JSON.parse(read(file));
const fail = (message, code = "POSTGRESQL_RLS_PACKAGE_EVALUATION_INVALID") => { const error = new Error(message); error.code = code; throw error; };
const assert = (value, message, code) => { if (!value) fail(message, code); };
const resultDigest = (value) => canonicalDigest({...value, result_sha256: null});

function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}

function assertResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} result is not an object`, "POSTGRESQL_RLS_RESULT_SCHEMA_INVALID");
  const expectedKeys = expected.disposition === "ROUTE"
    ? ["schema", "version", "disposition", "route", "analysis_allowed", "routing_allowed", "acceptance_allowed", "tenant_boundary_decision_allowed", "policy_mutation_allowed", "memory_write_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256", "selected_specialist", "handoff"]
    : ["schema", "version", "disposition", "route", "analysis_allowed", "routing_allowed", "acceptance_allowed", "tenant_boundary_decision_allowed", "policy_mutation_allowed", "memory_write_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256"];
  assert(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(expectedKeys.sort()), `${label} result shape differs`, "POSTGRESQL_RLS_RESULT_SCHEMA_INVALID");
  assert(actual.schema === POSTGRESQL_RLS_RESULT_SCHEMA && actual.version === 1, `${label} result identity differs`, "POSTGRESQL_RLS_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} disposition/route/error differs`, "POSTGRESQL_RLS_HOSTILE_RESULT_FAILED");
  assert(actual.analysis_allowed === (expected.disposition === "ROUTE") && actual.routing_allowed === (expected.disposition === "ROUTE"), `${label} analysis/routing capability is not derived from the expected disposition`, "POSTGRESQL_RLS_RESULT_CAPABILITY_INVALID");
  assert(actual.acceptance_allowed === false && actual.tenant_boundary_decision_allowed === false && actual.policy_mutation_allowed === false && actual.memory_write_allowed === false, `${label} result exposes forbidden capability`, "POSTGRESQL_RLS_RESULT_CAPABILITY_INVALID");
  assert(actual.external_side_effects && JSON.stringify(Object.keys(actual.external_side_effects).sort()) === JSON.stringify([...SIDE_EFFECT_KEYS].sort()) && SIDE_EFFECT_KEYS.every((key) => actual.external_side_effects[key] === 0), `${label} side-effect readback is nonzero or malformed`, "POSTGRESQL_RLS_RESULT_SIDE_EFFECT");
  assert(/^[0-9a-f]{64}$/u.test(actual.input_sha256) && /^[0-9a-f]{64}$/u.test(actual.result_sha256) && actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "POSTGRESQL_RLS_RESULT_DIGEST_INVALID");
  if (expected.disposition === "ROUTE") {
    assert(actual.selected_specialist === POSTGRESQL_RLS_BLOCK_ID, `${label} selected specialist differs`, "POSTGRESQL_RLS_RESULT_CAPABILITY_INVALID");
    assert(actual.handoff && JSON.stringify(Object.keys(actual.handoff).sort()) === JSON.stringify(["execution_instruction", "next_action", "status"].sort()) && actual.handoff.status === "WAITING_WITH_RECEIPT" && actual.handoff.execution_instruction === false, `${label} handoff is not bounded`, "POSTGRESQL_RLS_RESULT_SCHEMA_INVALID");
  }
  return actual;
}

function fixtureMap(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === CLASSES.length && new Set(names).size === CLASSES.length, "PostgreSQL RLS fixture inventory is incomplete", "POSTGRESQL_RLS_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.block_id === POSTGRESQL_RLS_BLOCK_ID && CLASSES.includes(fixture.class) && fixture.hostile === true, `PostgreSQL RLS fixture is not a bound hostile vector: ${name}`, "POSTGRESQL_RLS_FIXTURE_UNBOUND");
    assert(fixture.fixture_id === `postgresql-rls-${fixture.class}`, `PostgreSQL RLS fixture ID is not canonical: ${name}`, "POSTGRESQL_RLS_FIXTURE_ID_INVALID");
    assert(fixture.expected && JSON.stringify(Object.keys(fixture.expected).sort()) === JSON.stringify(["disposition", "error_code", "route"].sort()), `PostgreSQL RLS fixture expectation is invalid: ${name}`, "POSTGRESQL_RLS_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector?.entrypoint === "control/postgresql-rls-boundary-gate.mjs#evaluatePostgresqlRlsBoundary" && fixture.vector.input?.schema === POSTGRESQL_RLS_INPUT_SCHEMA && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `PostgreSQL RLS fixture vector is not executable/bound: ${name}`, "POSTGRESQL_RLS_FIXTURE_VECTOR_INVALID");
    assert(!map.has(fixture.class), `PostgreSQL RLS duplicate fixture class: ${name}`, "POSTGRESQL_RLS_FIXTURE_ALIAS"); map.set(fixture.class, {fixture, file_sha256: sha(read(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "PostgreSQL RLS fixture classes are incomplete", "POSTGRESQL_RLS_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function gateExecutions(root, map, authority) {
  const manifest = json(path.join(root, "gates/manifest.json")); const execution = json(path.join(root, "gates/execution.json"));
  assert(execution.schema === "agentos.postgresql_rls_gate_execution.v1" && execution.version === 1 && execution.block_id === POSTGRESQL_RLS_BLOCK_ID, "PostgreSQL RLS gate execution manifest is invalid", "POSTGRESQL_RLS_GATE_EXECUTION_INVALID");
  assert(execution.evaluator_entrypoint === "control/postgresql-rls-package-evaluator.mjs#evaluatePostgresqlRlsPackage" && JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(manifest.ordered_gate_ids) && execution.executions.length === GATE_IDS.length, "PostgreSQL RLS gate execution order/inventory is invalid", "POSTGRESQL_RLS_GATE_EXECUTION_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && GATE_IDS.includes(entry.gate_id) && map.has(entry.fixture_class), `PostgreSQL RLS gate execution is duplicated or missing: ${entry.gate_id}`, "POSTGRESQL_RLS_GATE_EXECUTION_ID_INVALID"); seen.add(entry.gate_id);
    const fixture = map.get(entry.fixture_class).fixture; const input = structuredClone(fixture.vector.input); Object.assign(input.evidence.adversarial_flags, entry.adversarial_flags ?? {}); input.evidence.candidate_digest = authority.block_sha256;
    const expected = entry.adversarial_flags && Object.keys(entry.adversarial_flags).length > 0 ? entry.expected : fixture.expected;
    if (!entry.adversarial_flags || Object.keys(entry.adversarial_flags).length === 0) assert(JSON.stringify(entry.expected) === JSON.stringify(fixture.expected) && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(entry.expected), `PostgreSQL RLS gate ${entry.gate_id} is not fixture-bound`, "POSTGRESQL_RLS_GATE_EXPECTATION_UNBOUND");
    const actual = evaluatePostgresqlRlsBoundary(input); assertResult(actual, expected, `PostgreSQL RLS gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: execution.evaluator_entrypoint, expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, side_effects: actual.external_side_effects});
  }
  assert(seen.size === GATE_IDS.length, "PostgreSQL RLS gate execution coverage is incomplete", "POSTGRESQL_RLS_GATE_EXECUTION_COVERAGE_INVALID"); return results;
}

async function mutation(candidateDigest) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-postgresql-rls-mutation-"));
  try {
    fs.cpSync(path.join(ROOT, "control"), path.join(temp, "control"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "wave-02", "postgresql-rls"), path.join(temp, "specialist-blocks", "wave-02", "postgresql-rls"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "standards", "postgresql-17-rls"), path.join(temp, "specialist-blocks", "standards", "postgresql-17-rls"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
    fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true}); fs.copyFileSync(path.join(ROOT, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json")); fs.cpSync(path.join(ROOT, "fixtures", "model-policy-evidence"), path.join(temp, "fixtures", "model-policy-evidence"), {recursive: true});
    const target = path.join(temp, "control", "postgresql-rls-boundary-gate.mjs"); let source = fs.readFileSync(target, "utf8");
    const anchor = 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "POSTGRESQL_RLS_SCOPE_EXPANSION_FORBIDDEN", input);';
    assert(source.includes(anchor), "PostgreSQL RLS mutation anchor is missing", "POSTGRESQL_RLS_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("ROUTE", "POSTGRESQL_RLS_ANALYSIS_HANDOFF", "MUTATED_SCOPE_EXPANSION_ALLOWED", input, {analysis_allowed: true, routing_allowed: true, selected_specialist: "specialist.data.postgresql-rls", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "mutated", execution_instruction: false}});');
    fs.writeFileSync(target, source, {flag: "w"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`); const fixture = json(path.join(PACKAGE, "fixtures", "broad_when_narrow_exists.json")); const input = structuredClone(fixture.vector.input); input.evidence.candidate_digest = candidateDigest; const observed = module.evaluatePostgresqlRlsBoundary(input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

export async function evaluatePostgresqlRlsPackage() {
  const authority = resolvePostgresqlRlsCanonicalAuthority(); const root = path.join(ROOT, PACKAGE_RELATIVE); const block = json(path.join(root, "block.json"));
  assert(block.block_id === POSTGRESQL_RLS_BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.block_sha256 === authority.block_sha256, "PostgreSQL RLS package state or canonical identity is invalid", "POSTGRESQL_RLS_PACKAGE_STATE_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE_RELATIVE}/${relative_path}`, sha256: sha(read(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === GATE_IDS.length, "PostgreSQL RLS gates are incomplete", "POSTGRESQL_RLS_GATE_INVENTORY_INVALID");
  const map = fixtureMap(root); const gateExecution = gateExecutions(root, map, authority); const results = [];
  for (const entry of [...map.values()].sort((left, right) => left.fixture.class.localeCompare(right.fixture.class))) {
    const {fixture} = entry; const actual = evaluatePostgresqlRlsBoundary(structuredClone(fixture.vector.input)); assertResult(actual, fixture.expected, `PostgreSQL RLS vector ${fixture.class}`);
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: fixture.expected.route, actual_route: actual.route, expected_error_code: fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected: fixture.expected, actual: actual.result_sha256})});
  }
  const evaluationArtifact = {value: json(path.join(root, "evaluation.json")), file_sha256: sha(read(path.join(root, "evaluation.json")))}; const handoffArtifact = {value: json(path.join(root, "handoff.json")), file_sha256: sha(read(path.join(root, "handoff.json")))};
  assertPostgresqlRlsCommittedHandoff({authority, evaluation: evaluationArtifact.value, handoff: handoffArtifact.value, evaluationFileSha256: evaluationArtifact.file_sha256, handoffFileSha256: handoffArtifact.file_sha256});
  const sensitivity = await mutation(block.block_sha256); assert(sensitivity.mutation_detected, "PostgreSQL RLS mutation proof is missing", "POSTGRESQL_RLS_MUTATION_PROOF_MISSING");
  const evaluation = {schema: POSTGRESQL_RLS_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: POSTGRESQL_RLS_BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), gate_execution: gateExecution, fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), source_manifest_sha256: authority.source_manifest_sha256, source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date, model_snapshot_sha256: authority.model.snapshot_sha256, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, upstream_router_result_sha256: authority.router_result_sha256, gate_semantic_inventory_sha256: authority.gate_semantic_inventory_sha256, evaluation_file_sha256: evaluationArtifact.file_sha256, handoff_file_sha256: handoffArtifact.file_sha256, roster_file_sha256: authority.roster_file_sha256, evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluatePostgresqlRlsPackage(), null, 2)}\n`);
