#!/usr/bin/env node

/* Operational, read-only evaluator for the Function Scope specialist. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateFunctionScopeBoundary, FUNCTION_SCOPE_INPUT_SCHEMA} from "./function-scope-boundary-gate.mjs";

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
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
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
    assert(!map.has(fixture.class), `Function Scope duplicate fixture class: ${name}`, "FUNCTION_SCOPE_FIXTURE_ALIAS");
    assert(![...map.values()].some((entry) => entry.fixture.fixture_id === fixture.fixture_id), `Function Scope duplicate fixture ID: ${name}`, "FUNCTION_SCOPE_FIXTURE_ID_DUPLICATE");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "Function Scope fixture classes are incomplete", "FUNCTION_SCOPE_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function baseInput(candidateDigest) {
  const adversarial_flags = Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false]));
  return {schema: FUNCTION_SCOPE_INPUT_SCHEMA, version: 1, request_kind: "ANALYZE_FUNCTION_SCOPE", evidence: {
    authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.SECURITY.FUNCTION_SCOPE", custody_ref: "opaque:FUNCTION_SCOPE.CUSTODY",
    source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: "1", source_effective_date: "2026-08-11", source_retrieved_date: "2026-08-20",
    candidate_status: "CURRENT_CANDIDATE", candidate_digest: candidateDigest, signal: "FUNCTION_SCOPE", signal_status: "BOUND", context_status: "FUNCTION_SCOPE_CONTEXT", context_complete: true,
    requested_action: "ANALYZE", requested_tools: ["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CONTEXT"], required_block_identities: ["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "specialist.security.access-control-router", "specialist.standard.owasp-asvs"],
    model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "FUNCTION_SCOPE", scope: "NARROW", project_data_present: false, secret_data_present: false, adversarial_flags,
  }};
}
function inputFor(fixtureClass, candidateDigest) {
  const input = baseInput(candidateDigest); const flags = input.evidence.adversarial_flags;
  const mapping = {
    authority_conflict: {authority_conflict: true}, broad_when_narrow_exists: {broad_claim: true}, cross_provider_version_claim: {cross_provider: true},
    duplicate_sibling_authority: {duplicate_authority: true}, false_positive: {false_positive: true}, missing_context: {missing_context: true},
    router_self_accept: {self_acceptance: true}, silent_scope_expansion: {scope_expanded: true}, stale_source: {stale_source: true},
    umbrella_authority: {broad_claim: true}, unrelated_scope: {unrelated_scope: true}, unsafe_action: {unsafe_action: true},
  }[fixtureClass] ?? {};
  Object.assign(flags, mapping);
  if (fixtureClass === "tool_limit") input.evidence.requested_tools = ["READ_CANDIDATE", "READ_SOURCE_LOCK"];
  return input;
}
async function mutation(candidateDigest) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-function-scope-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "function-scope-boundary-gate.mjs"); let source = read(path.join(ROOT, "control/function-scope-boundary-gate.mjs"));
    const anchor = 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("DENY", "NARROW_SCOPE_REQUIRED", "FUNCTION_SCOPE_SCOPE_EXPANSION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Function Scope mutation anchor missing", "FUNCTION_SCOPE_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim || e.scope !== "NARROW") return result("ROUTE", "FUNCTION_SCOPE_ANALYSIS_HANDOFF", "MUTATED_SCOPE_EXPANSION_ALLOWED", input, {analysis_allowed: true});');
    fs.writeFileSync(target, source, {flag: "wx"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`); const observed = module.evaluateFunctionScopeBoundary(inputFor("broad_when_narrow_exists", candidateDigest));
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export async function evaluateFunctionScopePackage() {
  const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Function Scope package state invalid", "FUNCTION_SCOPE_PACKAGE_STATE_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Function Scope gates incomplete", "FUNCTION_SCOPE_GATE_INVENTORY_INVALID");
  const map = fixtureMap(root); const results = [];
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const fixture = entry.fixture; const expected = fixture.expected; const input = inputFor(fixture.class, block.block_sha256); const actual = evaluateFunctionScopeBoundary(input);
    assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `Function Scope vector failed: ${fixture.class}`, "FUNCTION_SCOPE_HOSTILE_RESULT_FAILED"); assert(Object.values(actual.external_side_effects).every((value) => value === 0), "Function Scope side effect observed", "FUNCTION_SCOPE_SIDE_EFFECT");
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: "control/function-scope-boundary-gate.mjs#evaluateFunctionScopeBoundary", entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected, actual: actual.result_sha256})});
  }
  const sensitivity = await mutation(block.block_sha256); assert(sensitivity.mutation_detected, "Function Scope mutation proof missing", "FUNCTION_SCOPE_MUTATION_PROOF_MISSING");
  const evaluation = {schema: FUNCTION_SCOPE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateFunctionScopePackage(), null, 2)}\n`);
