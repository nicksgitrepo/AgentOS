#!/usr/bin/env node

/* Operational, read-only evaluator for the Idempotency specialist. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateIdempotencyBoundary, IDEMPOTENCY_INPUT_SCHEMA} from "./idempotency-boundary-gate.mjs";

export const IDEMPOTENCY_EVALUATION_SCHEMA = "agentos.specialist_idempotency_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-03/idempotency";
const BLOCK_ID = "specialist.security.idempotency";
const CLASSES = ["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "IDEMPOTENCY_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}
function fixtures(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === 17 && new Set(names).size === 17, "Idempotency fixture inventory invalid", "IDEMPOTENCY_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.block_id === BLOCK_ID && CLASSES.includes(fixture.class) && fixture.hostile === true, `Idempotency fixture is not a bound hostile vector: ${name}`, "IDEMPOTENCY_FIXTURE_UNBOUND");
    assert(fixture.fixture_id === `idempotency-${fixture.class}`, `Idempotency fixture ID is not canonical: ${name}`, "IDEMPOTENCY_FIXTURE_ID_INVALID");
    assert(fixture.vector?.entrypoint === "control/idempotency-boundary-gate.mjs#evaluateIdempotencyBoundary", `Idempotency fixture entrypoint is not operational: ${name}`, "IDEMPOTENCY_FIXTURE_ENTRYPOINT_INVALID");
    assert(fixture.vector?.adversarial_flags && typeof fixture.vector.adversarial_flags === "object", `Idempotency fixture flags are missing: ${name}`, "IDEMPOTENCY_FIXTURE_FLAGS_MISSING");
    assert(fixture.expected && typeof fixture.expected === "object" && !Array.isArray(fixture.expected), `Idempotency fixture expectation is missing: ${name}`, "IDEMPOTENCY_FIXTURE_EXPECTATION_MISSING");
    assert(Object.keys(fixture.expected).sort().join("\0") === ["disposition", "error_code", "route"].join("\0"), `Idempotency fixture expectation shape is invalid: ${name}`, "IDEMPOTENCY_FIXTURE_EXPECTATION_SHAPE_INVALID");
    assert(["DENY", "ROUTE"].includes(fixture.expected.disposition), `Idempotency fixture disposition is invalid: ${name}`, "IDEMPOTENCY_FIXTURE_EXPECTATION_INVALID");
    for (const key of ["route", "error_code"]) assert(typeof fixture.expected[key] === "string" && /^[A-Z][A-Z0-9_]*$/u.test(fixture.expected[key]), `Idempotency fixture ${key} is invalid: ${name}`, "IDEMPOTENCY_FIXTURE_EXPECTATION_INVALID");
    assert(!map.has(fixture.class), `Idempotency duplicate fixture class: ${name}`, "IDEMPOTENCY_FIXTURE_ALIAS"); map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "Idempotency fixture classes incomplete", "IDEMPOTENCY_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function baseInput(candidateDigest, flags) {
  return {schema: IDEMPOTENCY_INPUT_SCHEMA, version: 1, request_kind: "ANALYZE_IDEMPOTENCY", evidence: {
    authority_status: "CURRENT", security_domain: "IDEMPOTENCY", request_identity: "REQUEST.IDEMPOTENCY.ANALYSIS", idempotency_key: candidateDigest, duplicate_detection_status: "EVIDENCE_COMPLETE", replay_status: "BOUND", concurrency_scope: "ONE_OPERATION", operation_identity: "OPERATION.IDEMPOTENCY", operation_version: "1", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.AGENTOS_IDEMPOTENCY", source_version: "1", source_effective_date: "2026-08-11", source_retrieved_date: "2026-08-20", candidate_status: "CURRENT_CANDIDATE", candidate_digest: candidateDigest, signal_status: "BOUND", task_status: "IDEMPOTENCY_ANALYSIS", context_status: "IDEMPOTENCY_CONTEXT", context_complete: true, requested_action: "ANALYZE", requested_tools: ["READ_IDEMPOTENCY_RECORD", "READ_IDEMPOTENCY_STORE", "READ_SOURCE_LOCK", "READ_CONCURRENCY_SCOPE", "READ_CONTEXT"], required_block_identities: ["BLOCK.SECURITY.AUTHORITY", "BLOCK.SECURITY.EVIDENCE", "BLOCK.SECURITY.SCOPE", "BLOCK.SECURITY.CUSTODY", "BLOCK.SECURITY.HANDOFF", "BLOCK.SECURITY.ACCESS_CONTROL_ROUTER"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "IDEMPOTENCY", project_data_present: false, secret_data_present: false, adversarial_flags: flags,
  }};
}
function inputFor(fixture, candidateDigest) {
  const flags = Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive", "duplicate_request", "key_missing", "version_ambiguous", "replay_unproven", "concurrency_unbounded"].map((key) => [key, false]));
  Object.assign(flags, fixture.vector.adversarial_flags);
  const input = baseInput(candidateDigest, flags); if (fixture.class === "tool_limit") input.evidence.requested_tools = ["READ_IDEMPOTENCY_RECORD"]; return input;
}
async function mutation(fixture, digest) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-idempotency-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "idempotency-boundary-gate.mjs"); let source = read(path.join(ROOT, "control/idempotency-boundary-gate.mjs"));
    const anchor = 'if (f.scope_expanded || f.broad_claim) return result("DENY", "NARROW_SCOPE_REQUIRED", "IDEMPOTENCY_SCOPE_EXPANSION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Idempotency mutation anchor missing", "IDEMPOTENCY_MUTATION_ANCHOR_MISSING"); source = source.replace(anchor, 'if (f.scope_expanded || f.broad_claim) return result("ROUTE", "IDEMPOTENCY_ANALYSIS_HANDOFF", "MUTATED_IDEMPOTENCY_SCOPE_ALLOWED", input, {analysis_allowed: true});'); fs.writeFileSync(target, source, {flag: "wx"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`); const observed = module.evaluateIdempotencyBoundary(inputFor(fixture, digest));
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export async function evaluateIdempotencyPackage() {
  const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json")); assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Idempotency package state invalid", "IDEMPOTENCY_PACKAGE_STATE_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))})); assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Idempotency gates incomplete", "IDEMPOTENCY_GATE_INVENTORY_INVALID");
  const map = fixtures(root); const results = [];
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) { const fixture = entry.fixture; const expected = fixture.expected; const actual = evaluateIdempotencyBoundary(inputFor(fixture, block.block_sha256)); assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `Idempotency vector failed: ${fixture.class}`, "IDEMPOTENCY_HOSTILE_RESULT_FAILED"); assert(Object.values(actual.external_side_effects).every((value) => value === 0), "Idempotency side effect observed", "IDEMPOTENCY_SIDE_EFFECT"); results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, expected, actual: actual.result_sha256})}); }
  const sensitivity = await mutation(map.get("broad_when_narrow_exists").fixture, block.block_sha256); assert(sensitivity.mutation_detected, "Idempotency mutation proof missing", "IDEMPOTENCY_MUTATION_PROOF_MISSING");
  const evaluation = {schema: IDEMPOTENCY_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null}; evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
