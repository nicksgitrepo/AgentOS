#!/usr/bin/env node

/* Operational, read-only evaluator for the Function Scope specialist. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateFunctionScopeBoundary, FUNCTION_SCOPE_INPUT_SCHEMA} from "./function-scope-boundary-gate.mjs";
import {assertFunctionScopeCommittedHandoff, FUNCTION_SCOPE_CANONICAL_ARTIFACT_SHA256, resolveFunctionScopeCanonicalAuthority} from "./function-scope-authority-binding.mjs";

export const FUNCTION_SCOPE_EVALUATION_SCHEMA = "agentos.specialist_function_scope_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-03/function-scope";
const BLOCK_ID = "specialist.security.function-scope";
const CLASSES = ["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "FUNCTION_SCOPE_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
const RESULT_BASE_KEYS = Object.freeze(["schema", "version", "disposition", "route", "analysis_allowed", "acceptance_allowed", "authorization_decision_allowed", "policy_mutation_allowed", "external_side_effects", "error_code", "input_sha256", "result_sha256"]);
const RESULT_SIDE_EFFECT_KEYS = Object.freeze(["candidate_reads", "source_reads", "protected_data_reads", "authorization_decisions", "policy_mutations", "project_writes", "memory_writes", "credential_accesses", "state_changes"]);
const RESULT_SHA256 = /^[0-9a-f]{64}$/u;
function assertBoundaryResult(actual, expected, label) {
  assert(actual && typeof actual === "object" && !Array.isArray(actual), `${label} result is not an object`, "FUNCTION_SCOPE_RESULT_SCHEMA_INVALID");
  const expectedKeys = expected.disposition === "ROUTE" ? [...RESULT_BASE_KEYS, "selected_specialist", "handoff"] : RESULT_BASE_KEYS;
  assert(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(expectedKeys.slice().sort()), `${label} result fields differ`, "FUNCTION_SCOPE_RESULT_SCHEMA_INVALID");
  assert(actual.schema === "agentos.function_scope_boundary_result.v1" && actual.version === 1, `${label} result identity differs`, "FUNCTION_SCOPE_RESULT_SCHEMA_INVALID");
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} result disposition/route/error differs`, "FUNCTION_SCOPE_HOSTILE_RESULT_FAILED");
  assert(actual.analysis_allowed === (expected.disposition === "ROUTE"), `${label} analysis capability is not derived from the expected route`, "FUNCTION_SCOPE_RESULT_CAPABILITY_INVALID");
  assert(actual.acceptance_allowed === false && actual.authorization_decision_allowed === false && actual.policy_mutation_allowed === false, `${label} result exposes forbidden capability`, "FUNCTION_SCOPE_RESULT_CAPABILITY_INVALID");
  assert(actual.external_side_effects && typeof actual.external_side_effects === "object" && !Array.isArray(actual.external_side_effects), `${label} side-effect readback is invalid`, "FUNCTION_SCOPE_RESULT_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(actual.external_side_effects).sort()) === JSON.stringify(RESULT_SIDE_EFFECT_KEYS.slice().sort()), `${label} side-effect fields differ`, "FUNCTION_SCOPE_RESULT_SCHEMA_INVALID");
  assert(RESULT_SIDE_EFFECT_KEYS.every((key) => actual.external_side_effects[key] === 0), `${label} side-effect readback is non-zero`, "FUNCTION_SCOPE_RESULT_SIDE_EFFECT");
  assert(typeof actual.input_sha256 === "string" && RESULT_SHA256.test(actual.input_sha256) && typeof actual.result_sha256 === "string" && RESULT_SHA256.test(actual.result_sha256), `${label} result digests are invalid`, "FUNCTION_SCOPE_RESULT_SCHEMA_INVALID");
  assert(actual.result_sha256 === canonicalDigest({...actual, result_sha256: null}), `${label} result digest is not self-consistent`, "FUNCTION_SCOPE_RESULT_DIGEST_INVALID");
  if (expected.disposition === "ROUTE") {
    assert(actual.selected_specialist === "specialist.security.function-scope", `${label} selected specialist is not canonical`, "FUNCTION_SCOPE_RESULT_CAPABILITY_INVALID");
    assert(actual.handoff && typeof actual.handoff === "object" && !Array.isArray(actual.handoff) && JSON.stringify(Object.keys(actual.handoff).sort()) === JSON.stringify(["execution_instruction", "next_action", "status"].sort()), `${label} handoff is not typed`, "FUNCTION_SCOPE_RESULT_SCHEMA_INVALID");
    assert(actual.handoff.status === "WAITING_WITH_RECEIPT" && typeof actual.handoff.next_action === "string" && actual.handoff.execution_instruction === false, `${label} handoff widens authority`, "FUNCTION_SCOPE_RESULT_CAPABILITY_INVALID");
  }
  return actual;
}
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}
function fixtureMap(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === 17 && new Set(names).size === 17, "Function Scope fixture inventory is invalid", "FUNCTION_SCOPE_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.block_id === BLOCK_ID && CLASSES.includes(fixture.class) && fixture.hostile === true, `Function Scope fixture is not a bound hostile vector: ${name}`, "FUNCTION_SCOPE_FIXTURE_UNBOUND");
    assert(typeof fixture.fixture_id === "string" && /^function-scope-[a-z0-9_]+$/u.test(fixture.fixture_id), `Function Scope fixture ID is invalid: ${name}`, "FUNCTION_SCOPE_FIXTURE_ID_INVALID");
    assert(fixture.fixture_id === `function-scope-${fixture.class}`, `Function Scope fixture ID is not class-bound: ${name}`, "FUNCTION_SCOPE_FIXTURE_ID_UNBOUND");
    assert(fixture.expected && typeof fixture.expected === "object" && !Array.isArray(fixture.expected), `Function Scope fixture expectation is missing: ${name}`, "FUNCTION_SCOPE_FIXTURE_EXPECTATION_MISSING");
    assert(Object.keys(fixture.expected).sort().join("\0") === ["disposition", "error_code", "route"].join("\0"), `Function Scope fixture expectation shape is invalid: ${name}`, "FUNCTION_SCOPE_FIXTURE_EXPECTATION_SHAPE_INVALID");
    assert(["DENY", "ROUTE"].includes(fixture.expected.disposition), `Function Scope fixture disposition is invalid: ${name}`, "FUNCTION_SCOPE_FIXTURE_EXPECTATION_INVALID");
    for (const key of ["route", "error_code"]) assert(typeof fixture.expected[key] === "string" && /^[A-Z][A-Z0-9_]*$/u.test(fixture.expected[key]), `Function Scope fixture ${key} is invalid: ${name}`, "FUNCTION_SCOPE_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector && typeof fixture.vector === "object" && !Array.isArray(fixture.vector), `Function Scope fixture vector is missing: ${name}`, "FUNCTION_SCOPE_FIXTURE_VECTOR_MISSING");
    assert(JSON.stringify(Object.keys(fixture.vector).sort()) === JSON.stringify(["entrypoint", "expected_readback", "input"].sort()), `Function Scope fixture vector shape is invalid: ${name}`, "FUNCTION_SCOPE_FIXTURE_VECTOR_INVALID");
    assert(fixture.vector.entrypoint === "control/function-scope-boundary-gate.mjs#evaluateFunctionScopeBoundary", `Function Scope fixture entrypoint is not canonical: ${name}`, "FUNCTION_SCOPE_FIXTURE_ENTRYPOINT_INVALID");
    assert(fixture.vector.input && typeof fixture.vector.input === "object" && !Array.isArray(fixture.vector.input) && typeof fixture.vector.input.request_kind === "string", `Function Scope fixture input is invalid: ${name}`, "FUNCTION_SCOPE_FIXTURE_VECTOR_INVALID");
    assert(fixture.vector.input.evidence_overrides && typeof fixture.vector.input.evidence_overrides === "object" && !Array.isArray(fixture.vector.input.evidence_overrides), `Function Scope fixture evidence overrides are invalid: ${name}`, "FUNCTION_SCOPE_FIXTURE_VECTOR_INVALID");
    assert(JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Function Scope fixture vector expectation is not bound: ${name}`, "FUNCTION_SCOPE_FIXTURE_VECTOR_INVALID");
    assert(!map.has(fixture.class), `Function Scope duplicate fixture class: ${name}`, "FUNCTION_SCOPE_FIXTURE_ALIAS");
    assert(![...map.values()].some((entry) => entry.fixture.fixture_id === fixture.fixture_id), `Function Scope duplicate fixture ID: ${name}`, "FUNCTION_SCOPE_FIXTURE_ID_DUPLICATE");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "Function Scope fixture classes are incomplete", "FUNCTION_SCOPE_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function baseInput(candidateDigest, standard = {block_sha256: "1b39ac928b70badd070d9f6716825e73b9b931959c5fc078edf12e875c91824f", source_manifest_sha256: "505595765deaa25206fd59936a4b7e415688c640373a83a68e76a9788ed587d6"}, authority = null) {
  const adversarial_flags = Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false]));
  return {schema: FUNCTION_SCOPE_INPUT_SCHEMA, version: 1, request_kind: "ANALYZE_FUNCTION_SCOPE", evidence: {
    authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.SECURITY.FUNCTION_SCOPE", custody_ref: "opaque:FUNCTION_SCOPE.CUSTODY",
    source_status: "CURRENT_VERIFIED", source_identity: authority?.source_identity ?? "source.owasp-asvs-5-0-0", source_version: authority?.source_version ?? "5.0.0", source_effective_date: authority?.source_effective_date ?? "2025-05-30", source_retrieved_date: authority?.source_retrieved_date ?? "2026-08-11",
    candidate_status: "CURRENT_CANDIDATE", candidate_digest: candidateDigest, signal: "FUNCTION_SCOPE", signal_status: "BOUND", context_status: "FUNCTION_SCOPE_CONTEXT", context_complete: true,
    requested_action: "ANALYZE", requested_tools: ["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT"], required_block_identities: ["specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate", "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate", "specialist.foundation.tool-custody-gate", "specialist.security.access-control-router", "specialist.standard.owasp-asvs"],
    model_policy_status: authority?.model?.snapshot_status ?? "PREPARED_INACTIVE", model_route_status: "BOUND", authority_scope: "FUNCTION_SCOPE", scope: "NARROW", tenant_scope_status: "BOUND", standard_id: "source.owasp-asvs-5-0-0", standard_version: "5.0.0", standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standard.source_manifest_sha256,
    model_snapshot_sha256: authority?.model?.snapshot_sha256 ?? "0".repeat(64), model_task_class: authority?.model?.task_class ?? "SECURITY_REVIEW", model_capability_floor: authority?.model?.minimum_capability ?? 59, model_required_capabilities: authority?.model?.required_capabilities ?? ["CODE", "SECURITY", "TOOLS"], model_route_sha256: authority?.model_route_sha256 ?? "0".repeat(64), context_receipt_sha256: authority?.context_sha256 ?? "0".repeat(64), upstream_router_result_sha256: authority?.router_result_sha256 ?? "0".repeat(64), project_data_present: false, secret_data_present: false, adversarial_flags,
  }};
}
function inputFor(fixtureClass, candidateDigest, standard, overrides = {}, authority = null) {
  const input = baseInput(candidateDigest, standard, authority); const flags = input.evidence.adversarial_flags;
  const mapping = {
    authority_conflict: {authority_conflict: true}, broad_when_narrow_exists: {broad_claim: true}, cross_provider_version_claim: {cross_provider: true},
    duplicate_sibling_authority: {duplicate_authority: true}, false_positive: {false_positive: true}, missing_context: {missing_context: true},
    router_self_accept: {self_acceptance: true}, silent_scope_expansion: {scope_expanded: true}, stale_source: {stale_source: true},
    umbrella_authority: {broad_claim: true}, unrelated_scope: {unrelated_scope: true}, unsafe_action: {unsafe_action: true},
  }[fixtureClass] ?? {};
  const evidenceOverrides = overrides.evidence_overrides ?? {};
  Object.assign(flags, mapping, evidenceOverrides.adversarial_flags ?? {}, overrides.adversarial_flags ?? {});
  if (evidenceOverrides.request_kind ?? overrides.request_kind) input.request_kind = evidenceOverrides.request_kind ?? overrides.request_kind;
  if (evidenceOverrides.evidence) Object.assign(input.evidence, evidenceOverrides.evidence);
  if (overrides.evidence) Object.assign(input.evidence, overrides.evidence);
  if (fixtureClass === "tool_limit") input.evidence.requested_tools = ["READ_CANDIDATE", "READ_SOURCE_LOCK"];
  return input;
}
function gateExecutions(root, manifest, fixtureMap, block, standard, authority) {
  const execution = json(path.join(root, "gates/execution.json"));
  assert(execution.schema === "agentos.function_scope_gate_execution.v1" && execution.version === 1 && execution.block_id === BLOCK_ID, "Function Scope gate execution manifest is invalid", "FUNCTION_SCOPE_GATE_EXECUTION_MANIFEST_INVALID");
  assert(execution.evaluator_entrypoint === "control/function-scope-package-evaluator.mjs#evaluateFunctionScopePackage", "Function Scope gate evaluator binding is invalid", "FUNCTION_SCOPE_GATE_EXECUTION_ENTRYPOINT_INVALID");
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(manifest.ordered_gate_ids), "Function Scope gate execution order differs", "FUNCTION_SCOPE_GATE_EXECUTION_ORDER_INVALID");
  assert(Array.isArray(execution.executions) && execution.executions.length === manifest.ordered_gate_ids.length, "Function Scope gate executions are incomplete", "FUNCTION_SCOPE_GATE_EXECUTION_INVENTORY_INVALID");
  const seen = new Set(); const results = [];
  for (const entry of execution.executions) {
    assert(!seen.has(entry.gate_id) && manifest.ordered_gate_ids.includes(entry.gate_id), `Function Scope gate execution is duplicated or unknown: ${entry.gate_id}`, "FUNCTION_SCOPE_GATE_EXECUTION_ID_INVALID"); seen.add(entry.gate_id);
    const gate = json(path.join(root, "gates", `${entry.gate_id}.gate`)); assert(gate.gate_id === entry.gate_id && gate.status === "EXECUTABLE", `Function Scope gate is not executable: ${entry.gate_id}`, "FUNCTION_SCOPE_GATE_NOT_EXECUTABLE");
    const fixtureEntry = fixtureMap.get(entry.fixture_class); assert(fixtureEntry, `Function Scope gate fixture is missing: ${entry.fixture_class}`, "FUNCTION_SCOPE_GATE_FIXTURE_MISSING");
    const fixtureExpected = fixtureEntry.fixture.expected; const vectorInput = fixtureEntry.fixture.vector.input; const overrides = {request_kind: vectorInput.request_kind, evidence_overrides: vectorInput.evidence_overrides, adversarial_flags: entry.adversarial_flags ?? {}};
    if (Object.keys(overrides.adversarial_flags).length === 0) assert(JSON.stringify(entry.expected) === JSON.stringify(fixtureExpected) && JSON.stringify(entry.expected) === JSON.stringify(fixtureEntry.fixture.vector.expected_readback), `Function Scope gate expected result is not bound to fixture: ${entry.gate_id}`, "FUNCTION_SCOPE_GATE_EXPECTATION_UNBOUND");
    const actual = evaluateFunctionScopeBoundary(inputFor(entry.fixture_class, block.block_sha256, standard, overrides, authority));
    assertBoundaryResult(actual, entry.expected, `Function Scope gate ${entry.gate_id}`);
    results.push({gate_id: entry.gate_id, fixture_class: entry.fixture_class, entrypoint: execution.evaluator_entrypoint, expected: entry.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, side_effects: actual.external_side_effects});
  }
  assert(seen.size === manifest.ordered_gate_ids.length, "Function Scope gate execution coverage is incomplete", "FUNCTION_SCOPE_GATE_EXECUTION_COVERAGE_INVALID");
  return results;
}
async function mutation(candidateDigest) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-function-scope-mutation-"));
  try {
    const control = path.join(temp, "control");
    fs.cpSync(path.join(ROOT, "control"), control, {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "wave-03", "function-scope"), path.join(temp, "specialist-blocks", "wave-03", "function-scope"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "standards", "owasp-asvs"), path.join(temp, "specialist-blocks", "standards", "owasp-asvs"), {recursive: true});
    fs.cpSync(path.join(ROOT, "specialist-blocks", "registry"), path.join(temp, "specialist-blocks", "registry"), {recursive: true});
    fs.mkdirSync(path.join(temp, "fixtures"), {recursive: true}); fs.copyFileSync(path.join(ROOT, "fixtures", "model-policy-snapshot.initial.v1.json"), path.join(temp, "fixtures", "model-policy-snapshot.initial.v1.json")); fs.cpSync(path.join(ROOT, "fixtures", "model-policy-evidence"), path.join(temp, "fixtures", "model-policy-evidence"), {recursive: true});
    const target = path.join(control, "function-scope-boundary-gate.mjs"); let source = read(path.join(ROOT, "control/function-scope-boundary-gate.mjs"));
    const anchor = 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "FUNCTION_SCOPE_SCOPE_EXPANSION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Function Scope mutation anchor missing", "FUNCTION_SCOPE_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("ROUTE", "FUNCTION_SCOPE_ANALYSIS_HANDOFF", "MUTATED_SCOPE_EXPANSION_ALLOWED", input, {analysis_allowed: true});');
    assert(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(), "Function Scope mutation target is not an isolated regular file", "FUNCTION_SCOPE_MUTATION_TARGET_INVALID");
    fs.writeFileSync(target, source);
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`); const authority = (await import(`${pathToFileURL(path.join(control, "function-scope-authority-binding.mjs")).href}?mutation-authority=${Date.now()}`)).resolveFunctionScopeCanonicalAuthority(); const observed = module.evaluateFunctionScopeBoundary(inputFor("broad_when_narrow_exists", authority.block_sha256, {block_sha256: authority.standard_block_sha256, source_manifest_sha256: authority.standard_source_manifest_sha256}, {}, authority));
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export async function evaluateFunctionScopePackage() {
  const authority = resolveFunctionScopeCanonicalAuthority();
  const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json")); const executionSchema = json(path.join(ROOT, "schemas/function-scope-gate-execution.v1.json")); const executionPath = path.join(root, "gates/execution.json"); assert(sha(fs.readFileSync(executionPath)) === FUNCTION_SCOPE_CANONICAL_ARTIFACT_SHA256.gate_execution, "Function Scope gate execution manifest is not the pinned candidate", "FUNCTION_SCOPE_CANONICAL_PROVENANCE_INVALID"); const standard = json(path.join(ROOT, "specialist-blocks/standards/owasp-asvs/block.json")); const standardSources = json(path.join(ROOT, "specialist-blocks/standards/owasp-asvs/sources.lock"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.block_sha256 === authority.block_sha256, "Function Scope package state or canonical identity is invalid", "FUNCTION_SCOPE_PACKAGE_STATE_INVALID");
  assert(executionSchema.$id === "https://agentos.dev/schemas/function-scope-gate-execution.v1.json" && executionSchema.properties?.block_id?.const === BLOCK_ID, "Function Scope gate execution schema binding is invalid", "FUNCTION_SCOPE_GATE_EXECUTION_SCHEMA_INVALID");
  assert(standard.block_id === "specialist.standard.owasp-asvs" && standard.block_sha256 === "1b39ac928b70badd070d9f6716825e73b9b931959c5fc078edf12e875c91824f", "OWASP ASVS standard binding is not canonical", "FUNCTION_SCOPE_STANDARD_BINDING_INVALID"); assert(standardSources.manifest_sha256 === "505595765deaa25206fd59936a4b7e415688c640373a83a68e76a9788ed587d6", "OWASP ASVS source manifest binding is not canonical", "FUNCTION_SCOPE_STANDARD_SOURCE_INVALID"); const lockedSources = json(path.join(root, "sources.lock")); assert(lockedSources.sources.some((source) => source.source_id === "source.owasp-asvs-5-0-0" && source.immutable_identity === "owasp-asvs-5.0.0-release-20250530"), "Function Scope package omits locked OWASP ASVS source", "FUNCTION_SCOPE_STANDARD_SOURCE_MISSING");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Function Scope gates incomplete", "FUNCTION_SCOPE_GATE_INVENTORY_INVALID");
  const map = fixtureMap(root); const results = [];
  const gateManifest = json(path.join(root, "gates/manifest.json")); const gateExecution = gateExecutions(root, gateManifest, map, block, standard, authority);
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const fixture = entry.fixture; const expected = fixture.expected; const input = inputFor(fixture.class, block.block_sha256, standard, {request_kind: fixture.vector.input.request_kind, evidence_overrides: fixture.vector.input.evidence_overrides}, authority); const actual = evaluateFunctionScopeBoundary(input);
    assertBoundaryResult(actual, expected, `Function Scope vector ${fixture.class}`);
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: "control/function-scope-boundary-gate.mjs#evaluateFunctionScopeBoundary", entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected, actual: actual.result_sha256})});
  }
  const evaluationArtifact = {value: json(path.join(root, "evaluation.json")), file_sha256: sha(fs.readFileSync(path.join(root, "evaluation.json")))};
  const handoffArtifact = {value: json(path.join(root, "handoff.json")), file_sha256: sha(fs.readFileSync(path.join(root, "handoff.json")))};
  assertFunctionScopeCommittedHandoff({authority, evaluation: evaluationArtifact.value, handoff: handoffArtifact.value, evaluationFileSha256: evaluationArtifact.file_sha256, handoffFileSha256: handoffArtifact.file_sha256});
  const sensitivity = await mutation(block.block_sha256); assert(sensitivity.mutation_detected, "Function Scope mutation proof missing", "FUNCTION_SCOPE_MUTATION_PROOF_MISSING");
  const evaluation = {schema: FUNCTION_SCOPE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), gate_execution: gateExecution, fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), source_manifest_sha256: authority.source_manifest_sha256, source_effective_date: authority.source_effective_date, source_retrieved_date: authority.source_retrieved_date, model_snapshot_sha256: authority.model.snapshot_sha256, model_route_sha256: authority.model_route_sha256, context_receipt_sha256: authority.context_sha256, upstream_router_result_sha256: authority.router_result_sha256, gate_semantic_inventory_sha256: authority.gate_semantic_inventory_sha256, evaluation_file_sha256: evaluationArtifact.file_sha256, handoff_file_sha256: handoffArtifact.file_sha256, evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateFunctionScopePackage(), null, 2)}\n`);
