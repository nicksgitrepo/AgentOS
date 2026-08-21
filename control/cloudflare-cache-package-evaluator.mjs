#!/usr/bin/env node

/* Independent, read-only operational evaluator for Cloudflare Cache Rules. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL, fileURLToPath} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateCloudflareCacheBoundary, CLOUDFLARE_CACHE_INPUT_SCHEMA} from "./cloudflare-cache-boundary-gate.mjs";
import {
  assertCloudflareCacheCommittedHandoff,
  CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256,
  resolveCloudflareCacheCanonicalAuthority,
} from "./cloudflare-cache-authority-binding.mjs";

export const CLOUDFLARE_CACHE_EVALUATION_SCHEMA = "agentos.specialist_cloudflare_cache_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "specialist-blocks/wave-02/cloudflare-cache";
const BLOCK_ID = "specialist.platform.cloudflare-cache";
const CLASSES = [
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
const RESULT_BASE_KEYS = Object.freeze([
  "schema", "version", "disposition", "route", "analysis_allowed", "routing_allowed", "acceptance_allowed",
  "cache_mutation_allowed", "purge_allowed", "deployment_allowed", "memory_write_allowed", "external_side_effects",
  "error_code", "input_sha256", "result_sha256",
]);
const RESULT_SIDE_EFFECT_KEYS = Object.freeze([
  "candidate_reads", "source_reads", "provider_reads", "cache_mutations", "cache_purges", "deployment_calls",
  "project_writes", "memory_writes", "credential_accesses", "state_changes",
]);
const RESULT_SHA256 = /^[0-9a-f]{64}$/u;

function fail(message, code = "CLOUDFLARE_CACHE_EVALUATION_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function assertBoundaryResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} result is not an object`, "CLOUDFLARE_CACHE_RESULT_SCHEMA_INVALID");
  const expectedKeys = expected.disposition === "ROUTE" ? [...RESULT_BASE_KEYS, "selected_specialist", "handoff"] : RESULT_BASE_KEYS;
  assert(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(expectedKeys.slice().sort()), `${label} result fields differ`, "CLOUDFLARE_CACHE_RESULT_SCHEMA_INVALID");
  assert(actual.schema === "agentos.cloudflare_cache_boundary_result.v1" && actual.version === 1, `${label} result identity differs`, "CLOUDFLARE_CACHE_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result disposition, route, or error differs`, "CLOUDFLARE_CACHE_HOSTILE_RESULT_FAILED");
  assert(actual.analysis_allowed === (expected.disposition === "ROUTE") && actual.routing_allowed === (expected.disposition === "ROUTE"), `${label} capability is not derived from the real route`, "CLOUDFLARE_CACHE_RESULT_CAPABILITY_INVALID");
  assert(actual.acceptance_allowed === false && actual.cache_mutation_allowed === false && actual.purge_allowed === false && actual.deployment_allowed === false && actual.memory_write_allowed === false, `${label} exposes a forbidden capability`, "CLOUDFLARE_CACHE_RESULT_CAPABILITY_INVALID");
  assert(actual.external_side_effects && typeof actual.external_side_effects === "object" && !Array.isArray(actual.external_side_effects), `${label} side-effect readback is invalid`, "CLOUDFLARE_CACHE_RESULT_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(actual.external_side_effects).sort()) === JSON.stringify(RESULT_SIDE_EFFECT_KEYS.slice().sort()), `${label} side-effect fields differ`, "CLOUDFLARE_CACHE_RESULT_SCHEMA_INVALID");
  assert(RESULT_SIDE_EFFECT_KEYS.every((key) => actual.external_side_effects[key] === 0), `${label} side-effect readback is non-zero`, "CLOUDFLARE_CACHE_RESULT_SIDE_EFFECT");
  assert(typeof actual.input_sha256 === "string" && RESULT_SHA256.test(actual.input_sha256) && typeof actual.result_sha256 === "string" && RESULT_SHA256.test(actual.result_sha256), `${label} result digests are invalid`, "CLOUDFLARE_CACHE_RESULT_SCHEMA_INVALID");
  assert(actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "CLOUDFLARE_CACHE_RESULT_DIGEST_INVALID");
  if (expected.disposition === "ROUTE") {
    assert(actual.selected_specialist === BLOCK_ID, `${label} selected specialist is not canonical`, "CLOUDFLARE_CACHE_RESULT_CAPABILITY_INVALID");
    assert(actual.handoff && typeof actual.handoff === "object" && !Array.isArray(actual.handoff) && JSON.stringify(Object.keys(actual.handoff).sort()) === JSON.stringify(["execution_instruction", "next_action", "status"].sort()), `${label} handoff is not typed`, "CLOUDFLARE_CACHE_RESULT_SCHEMA_INVALID");
    assert(actual.handoff.status === "WAITING_WITH_RECEIPT" && typeof actual.handoff.next_action === "string" && actual.handoff.execution_instruction === false, `${label} handoff widens authority`, "CLOUDFLARE_CACHE_RESULT_CAPABILITY_INVALID");
  }
  return actual;
}

function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((entry) => entry.endsWith(".gate") || entry === "manifest.json" || entry === "execution.json")) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((entry) => entry.endsWith(".json"))) files.push(`fixtures/${name}`);
  return [...new Set(files)].sort();
}

function fixtureMap(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === CLASSES.length && new Set(names).size === CLASSES.length, "Cloudflare Cache fixture inventory is invalid", "CLOUDFLARE_CACHE_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name);
    const fixture = json(file);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === BLOCK_ID && fixture.hostile === true, `Cloudflare Cache fixture is not a bound hostile vector: ${name}`, "CLOUDFLARE_CACHE_FIXTURE_UNBOUND");
    assert(CLASSES.includes(fixture.class) && fixture.fixture_id === `cloudflare-cache-${fixture.class}`, `Cloudflare Cache fixture ID is invalid: ${name}`, "CLOUDFLARE_CACHE_FIXTURE_ID_INVALID");
    assert(fixture.expected && JSON.stringify(Object.keys(fixture.expected).sort()) === JSON.stringify(["disposition", "error_code", "route"].sort()), `Cloudflare Cache fixture expectation shape is invalid: ${name}`, "CLOUDFLARE_CACHE_FIXTURE_EXPECTATION_INVALID");
    assert(["DENY", "ROUTE"].includes(fixture.expected.disposition), `Cloudflare Cache fixture disposition is invalid: ${name}`, "CLOUDFLARE_CACHE_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector && JSON.stringify(Object.keys(fixture.vector).sort()) === JSON.stringify(["entrypoint", "expected_readback", "input"].sort()), `Cloudflare Cache fixture vector shape is invalid: ${name}`, "CLOUDFLARE_CACHE_FIXTURE_VECTOR_INVALID");
    assert(fixture.vector.entrypoint === "control/cloudflare-cache-boundary-gate.mjs#evaluateCloudflareCacheBoundary", `Cloudflare Cache fixture entrypoint is not canonical: ${name}`, "CLOUDFLARE_CACHE_FIXTURE_ENTRYPOINT_INVALID");
    assert(fixture.vector.input?.schema === CLOUDFLARE_CACHE_INPUT_SCHEMA && fixture.vector.input?.evidence && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Cloudflare Cache fixture vector is not executable and bound: ${name}`, "CLOUDFLARE_CACHE_FIXTURE_VECTOR_INVALID");
    assert(!map.has(fixture.class), `Cloudflare Cache duplicate fixture class: ${name}`, "CLOUDFLARE_CACHE_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "Cloudflare Cache fixture classes are incomplete", "CLOUDFLARE_CACHE_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function gateExecutions(root, manifest, fixtureMap) {
  const executionPath = path.join(root, "gates/execution.json");
  const execution = json(executionPath);
  assert(sha(fs.readFileSync(executionPath)) === CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.gate_execution, "Cloudflare Cache gate execution manifest is not the pinned candidate", "CLOUDFLARE_CACHE_CANONICAL_PROVENANCE_INVALID");
  assert(execution.schema === "agentos.cloudflare_cache_gate_execution.v1" && execution.version === 1 && execution.block_id === BLOCK_ID, "Cloudflare Cache gate execution manifest is invalid", "CLOUDFLARE_CACHE_GATE_EXECUTION_MANIFEST_INVALID");
  assert(execution.execution_sha256 === canonicalDigest({...execution, execution_sha256: null}), "Cloudflare Cache gate execution digest is invalid", "CLOUDFLARE_CACHE_GATE_EXECUTION_DIGEST_INVALID");
  assert(execution.evaluator_entrypoint === "control/cloudflare-cache-package-evaluator.mjs#evaluateCloudflareCachePackage" && execution.boundary_entrypoint === "control/cloudflare-cache-boundary-gate.mjs#evaluateCloudflareCacheBoundary", "Cloudflare Cache gate evaluator binding is invalid", "CLOUDFLARE_CACHE_GATE_EXECUTION_ENTRYPOINT_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(manifest.ordered_gate_ids), "Cloudflare Cache gate execution order differs", "CLOUDFLARE_CACHE_GATE_EXECUTION_ORDER_INVALID");
  assert(Array.isArray(execution.executions) && execution.executions.length === manifest.ordered_gate_ids.length, "Cloudflare Cache gate executions are incomplete", "CLOUDFLARE_CACHE_GATE_EXECUTION_INVENTORY_INVALID");
  const seen = new Set();
  const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && manifest.ordered_gate_ids.includes(entry.gate_id), `Cloudflare Cache gate execution is duplicated or unknown: ${entry.gate_id}`, "CLOUDFLARE_CACHE_GATE_EXECUTION_ID_INVALID");
    seen.add(entry.gate_id);
    assert(entry.entrypoint === execution.boundary_entrypoint, `Cloudflare Cache gate ${entry.gate_id} does not invoke the public boundary`, "CLOUDFLARE_CACHE_GATE_EXECUTION_ENTRYPOINT_INVALID");
    const fixtureEntry = fixtureMap.get(entry.fixture_class);
    assert(fixtureEntry, `Cloudflare Cache gate fixture is missing: ${entry.fixture_class}`, "CLOUDFLARE_CACHE_GATE_FIXTURE_MISSING");
    const actual = evaluateCloudflareCacheBoundary(fixtureEntry.fixture.vector.input);
    assertBoundaryResult(actual, entry.expected, `Cloudflare Cache gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: entry.entrypoint, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, side_effects: actual.external_side_effects});
  }
  assert(seen.size === manifest.ordered_gate_ids.length, "Cloudflare Cache gate execution coverage is incomplete", "CLOUDFLARE_CACHE_GATE_EXECUTION_COVERAGE_INVALID");
  return results;
}

async function mutation() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-cloudflare-cache-mutation-"));
  try {
    const control = path.join(temp, "control");
    fs.cpSync(path.join(ROOT, "control"), control, {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "wave-02", "cloudflare-cache"), path.join(temp, "specialist-blocks", "wave-02", "cloudflare-cache"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "standards", "cloudflare-cache-current"), path.join(temp, "specialist-blocks", "standards", "cloudflare-cache-current"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
    fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true});
    fs.copyFileSync(path.join(ROOT, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json"));
    fs.cpSync(path.join(ROOT, "fixtures", "model-policy-evidence"), path.join(temp, "fixtures", "model-policy-evidence"), {recursive: true});
    const sourcePath = path.join(ROOT, "control/cloudflare-cache-boundary-gate.mjs");
    const targetPath = path.join(control, "cloudflare-cache-boundary-gate.mjs");
    let source = read(sourcePath);
    const anchor = 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "CLOUDFLARE_CACHE_SCOPE_EXPANSION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Cloudflare Cache mutation anchor is missing", "CLOUDFLARE_CACHE_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("ROUTE", "CLOUDFLARE_CACHE_ANALYSIS_HANDOFF", "MUTATED_SCOPE_EXPANSION_ALLOWED", input, {analysis_allowed: true, routing_allowed: true, selected_specialist: "specialist.platform.cloudflare-cache", handoff: {status: "WAITING_WITH_RECEIPT", next_action: "mutated", execution_instruction: false}});');
    fs.writeFileSync(targetPath, source);
  const fixture = json(path.join(ROOT, PACKAGE, "fixtures/broad_when_narrow_exists.json"));
    const module = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`);
    const observed = module.evaluateCloudflareCacheBoundary(fixture.vector.input);
    return {
      status: observed.disposition === "DENY" ? "INTACT" : "WEAKENED",
      mutation_detected: true,
      mutation_kind: "SCOPE_GUARD_WEAKENING",
      expected_disposition: "DENY",
      observed_disposition: observed.disposition,
      mutation_rejected_by_independent_tripwire: observed.disposition === "DENY",
    };
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
}

export async function evaluateCloudflareCachePackage() {
  const authority = resolveCloudflareCacheCanonicalAuthority();
  const root = path.join(ROOT, PACKAGE);
  const block = json(path.join(root, "block.json"));
  const evaluationSchema = json(path.join(ROOT, "schemas/specialist-evaluation.v1.json"));
  assert(evaluationSchema.$id === "https://agentos.dev/schemas/specialist-evaluation.v1.json" && evaluationSchema.properties?.cases?.items?.required?.includes("case_id"), "Cloudflare Cache specialist evaluation schema does not require case IDs", "CLOUDFLARE_CACHE_EVALUATION_SCHEMA_INVALID");
  const executionSchema = json(path.join(ROOT, "schemas/cloudflare-cache-gate-execution.v1.json"));
  assert(executionSchema.$id === "https://agentos.dev/schemas/cloudflare-cache-gate-execution.v1.json" && executionSchema.properties?.block_id?.const === BLOCK_ID, "Cloudflare Cache gate execution schema binding is invalid", "CLOUDFLARE_CACHE_GATE_EXECUTION_SCHEMA_INVALID");
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.block_sha256 === authority.block_sha256, "Cloudflare Cache package state or canonical identity is invalid", "CLOUDFLARE_CACHE_PACKAGE_STATE_INVALID");
  const files = inventory(root);
  const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Cloudflare Cache gates are incomplete", "CLOUDFLARE_CACHE_GATE_INVENTORY_INVALID");
  const fixtures = fixtureMap(root);
  const gateManifest = json(path.join(root, "gates/manifest.json"));
  const gateExecution = gateExecutions(root, gateManifest, fixtures);
  const fixtureResults = [];
  for (const entry of [...fixtures.values()].sort((left, right) => left.fixture.class.localeCompare(right.fixture.class))) {
    const fixture = entry.fixture;
    const actual = evaluateCloudflareCacheBoundary(fixture.vector.input);
    assertBoundaryResult(actual, fixture.expected, `Cloudflare Cache vector ${fixture.class}`);
    fixtureResults.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: fixture.expected.disposition, actual_outcome: actual.disposition, expected_route: fixture.expected.route, actual_route: actual.route, expected_error_code: fixture.expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected: fixture.expected, actual: actual.result_sha256})});
  }
  const evaluationFile = path.join(root, "evaluation.json");
  const handoffFile = path.join(root, "handoff.json");
  const evaluation = json(evaluationFile);
  const handoff = json(handoffFile);
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === fixtures.size, "Cloudflare Cache evaluation case inventory is incomplete", "CLOUDFLARE_CACHE_EVALUATION_DOSSIER_INVALID");
  const evaluationCases = new Map();
  for (const item of evaluation.cases) {
    assert(typeof item.case_id === "string" && item.case_id === `cloudflare-cache-${item.class}`, `Cloudflare Cache evaluation case ID is not canonical: ${item.class}`, "CLOUDFLARE_CACHE_EVALUATION_CASE_BINDING_INVALID");
    assert(!evaluationCases.has(item.case_id), `Cloudflare Cache evaluation case ID is duplicated: ${item.case_id}`, "CLOUDFLARE_CACHE_EVALUATION_CASE_BINDING_INVALID");
    evaluationCases.set(item.case_id, item);
  }
  for (const entry of fixtures.values()) {
    const item = evaluationCases.get(entry.fixture.fixture_id);
    assert(item && item.class === entry.fixture.class && item.expected === entry.fixture.expected.disposition && item.observed === "PASS", `Cloudflare Cache evaluation case is not bound to fixture ${entry.fixture.fixture_id}`, "CLOUDFLARE_CACHE_EVALUATION_CASE_BINDING_INVALID");
  }
  assertCloudflareCacheCommittedHandoff({authority, evaluation, handoff, evaluationFileSha256: sha(fs.readFileSync(evaluationFile)), handoffFileSha256: sha(fs.readFileSync(handoffFile))});
  const sensitivity = await mutation();
  assert(sensitivity.mutation_detected && sensitivity.status === "INTACT" && sensitivity.expected_disposition === "DENY" && sensitivity.observed_disposition === "DENY" && sensitivity.mutation_rejected_by_independent_tripwire === true, "Cloudflare Cache mutation guard did not fail closed", "CLOUDFLARE_CACHE_MUTATION_GUARD_WEAKENED");
  const output = {
    schema: CLOUDFLARE_CACHE_EVALUATION_SCHEMA,
    version: 1,
    status: "PASS",
    block_id: BLOCK_ID,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    package_root_sha256: canonicalDigest(digests),
    package_block_sha256: block.block_sha256,
    gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))),
    fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))),
    gate_execution: gateExecution,
    fixture_results: fixtureResults,
    mutation_sensitivity: sensitivity,
    independent_signature_required: true,
    observed_at_utc: new Date().toISOString(),
    source_manifest_sha256: authority.source_manifest_sha256,
    source_effective_date: authority.source_effective_date,
    source_retrieved_date: authority.source_retrieved_date,
    source_content_sha256: authority.source_content_sha256,
    model_snapshot_sha256: authority.model.snapshot_sha256,
    model_route_sha256: authority.model_route_sha256,
    context_receipt_sha256: authority.context_sha256,
    upstream_router_result_sha256: authority.router_result_sha256,
    gate_semantic_inventory_sha256: authority.gate_semantic_inventory_sha256,
    evaluation_file_sha256: sha(fs.readFileSync(evaluationFile)),
    handoff_file_sha256: sha(fs.readFileSync(handoffFile)),
    evaluation_sha256: null,
  };
  output.evaluation_sha256 = canonicalDigest({...output, evaluation_sha256: null});
  return Object.freeze(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.stdout.write(`${JSON.stringify(await evaluateCloudflareCachePackage(), null, 2)}\n`);
