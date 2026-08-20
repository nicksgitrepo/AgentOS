#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateDataMigrationRollbackRouterBoundary, DATA_MIGRATION_ROLLBACK_ROUTER_INPUT_SCHEMA} from "./data-migration-rollback-router-boundary-gate.mjs";

export const DATA_MIGRATION_ROLLBACK_ROUTER_EVALUATION_SCHEMA = "agentos.specialist_data_migration_rollback_router_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-04/migration-rollback";
const BLOCK_ID = "specialist.data.migration-rollback";
const CLASSES = ["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "DATA_MIGRATION_ROLLBACK_ROUTER_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}
function fixtures(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === 17 && new Set(names).size === 17, "Data Migration/Rollback fixture inventory invalid", "DATA_MIGRATION_ROLLBACK_ROUTER_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.block_id === BLOCK_ID && CLASSES.includes(fixture.class) && fixture.vector?.entrypoint === "control/data-migration-rollback-router-boundary-gate.mjs#evaluateDataMigrationRollbackRouterBoundary", `Data Migration/Rollback fixture is not operational: ${name}`, "DATA_MIGRATION_ROLLBACK_ROUTER_FIXTURE_UNBOUND");
    assert(fixture.vector.input?.schema === DATA_MIGRATION_ROLLBACK_ROUTER_INPUT_SCHEMA && fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `Data Migration/Rollback fixture lacks typed input/readback: ${name}`, "DATA_MIGRATION_ROLLBACK_ROUTER_FIXTURE_INVALID");
    assert(!map.has(fixture.class), `Data Migration/Rollback duplicate fixture class: ${name}`, "DATA_MIGRATION_ROLLBACK_ROUTER_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "Data Migration/Rollback fixture classes incomplete", "DATA_MIGRATION_ROLLBACK_ROUTER_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function inputFor(fixture, digest) { const input = structuredClone(fixture.vector.input); input.evidence.candidate_digest = digest; return input; }
async function mutation(fixture, digest) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-migration-rollback-router-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "data-migration-rollback-router-boundary-gate.mjs");
    let source = read(path.join(ROOT, "control/data-migration-rollback-router-boundary-gate.mjs"));
    const anchor = 'if (f.self_acceptance || f.unsafe_action || e.acceptance_requested || e.verification_requested) return result("DENY", "INDEPENDENT_SPECIALIST_REQUIRED", "DATA_MIGRATION_ROLLBACK_ROUTER_SIDE_EFFECT_FORBIDDEN", input);';
    assert(source.includes(anchor), "Data Migration/Rollback mutation anchor missing", "DATA_MIGRATION_ROLLBACK_ROUTER_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.self_acceptance || f.unsafe_action || e.acceptance_requested || e.verification_requested) return result("ROUTE", "DATA_MIGRATION_ROLLBACK_ATOMIC_SPECIALIST_HANDOFF", "MUTATED_DATA_MIGRATION_ROLLBACK_SIDE_EFFECT_ALLOWED", input, {routing_allowed: true});');
    fs.writeFileSync(target, source, {flag: "wx"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const observed = module.evaluateDataMigrationRollbackRouterBoundary(inputFor(fixture, digest));
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export async function evaluateDataMigrationRollbackRouterPackage() {
  const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Data Migration/Rollback package state invalid", "DATA_MIGRATION_ROLLBACK_ROUTER_PACKAGE_STATE_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Data Migration/Rollback gates incomplete", "DATA_MIGRATION_ROLLBACK_ROUTER_GATE_INVENTORY_INVALID");
  const map = fixtures(root); const results = [];
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const fixture = entry.fixture; const expected = fixture.vector.expected_readback; const actual = evaluateDataMigrationRollbackRouterBoundary(inputFor(fixture, block.block_sha256));
    assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `Data Migration/Rollback vector failed: ${fixture.class}`, "DATA_MIGRATION_ROLLBACK_ROUTER_HOSTILE_RESULT_FAILED");
    assert(Object.values(actual.external_side_effects).every((value) => value === 0), "Data Migration/Rollback side effect observed", "DATA_MIGRATION_ROLLBACK_ROUTER_SIDE_EFFECT");
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, result: actual.result_sha256})});
  }
  const sensitivity = await mutation(json(path.join(root, "fixtures/unsafe_action.json")), block.block_sha256);
  assert(sensitivity.mutation_detected, "Data Migration/Rollback mutation proof missing", "DATA_MIGRATION_ROLLBACK_ROUTER_MUTATION_PROOF_MISSING");
  const evaluation = {schema: DATA_MIGRATION_ROLLBACK_ROUTER_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateDataMigrationRollbackRouterPackage(), null, 2)}\n`);
