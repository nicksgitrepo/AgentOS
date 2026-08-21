#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateRepairBoundary, REPAIR_INPUT_SCHEMA} from "./repair-campaign-boundary-gate.mjs";
import {makeRepairFixtureInput, REPAIR_FIXTURE_CLASSES} from "./repair-campaign-fixture-baseline.mjs";

export const REPAIR_EVALUATION_SCHEMA = "agentos.specialist_repair_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-07/repair";
const BLOCK_ID = "specialist.control.repair";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "REPAIR_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push("gates/" + name);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push("fixtures/" + name);
  return files.sort();
}
function fixtures(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === REPAIR_FIXTURE_CLASSES.length && new Set(names).size === names.length, "Repair fixture inventory is not exact", "REPAIR_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.schema === "agentos.repair_fixture.v1" && fixture.block_id === BLOCK_ID && REPAIR_FIXTURE_CLASSES.includes(fixture.class), "Repair fixture identity invalid: " + name, "REPAIR_FIXTURE_UNBOUND");
    assert(fixture.vector?.entrypoint === "control/repair-campaign-boundary-gate.mjs#evaluateRepairBoundary", "Repair fixture entrypoint is not operational: " + name, "REPAIR_FIXTURE_ENTRYPOINT_INVALID");
    assert(fixture.vector.input_overrides && fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, "Repair fixture is not typed: " + name, "REPAIR_FIXTURE_INVALID");
    assert(!map.has(fixture.class), "Repair fixture class alias: " + name, "REPAIR_FIXTURE_ALIAS"); map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === REPAIR_FIXTURE_CLASSES.slice().sort().join("\0"), "Repair fixture classes incomplete", "REPAIR_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function inputFor(fixture) { const input = makeRepairFixtureInput(fixture.vector.input_overrides); assert(input.schema === REPAIR_INPUT_SCHEMA, "Repair fixture baseline schema mismatch", "REPAIR_FIXTURE_SCHEMA_INVALID"); return input; }
async function mutation(fixture) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-repair-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "repair-campaign-boundary-gate.mjs"); let source = read(path.join(ROOT, "control/repair-campaign-boundary-gate.mjs"));
    const anchor = 'if (e.active_lanes > e.max_lanes || e.shared_worktree) return deny("REPAIR_PARALLEL_CUSTODY_INVALID", "REPAIR_CUSTODY_REPAIR", input);';
    assert(source.includes(anchor), "Repair mutation anchor missing", "REPAIR_MUTATION_ANCHOR_MISSING"); source = source.replace(anchor, 'if (e.active_lanes > e.max_lanes || e.shared_worktree) return result("PASS", "MUTATED_PARALLEL_ACCEPTED", "MUTATED_REPAIR_GATE", input);'); fs.writeFileSync(target, source, {flag: "wx"});
    const module = await import(pathToFileURL(target).href + "?mutation=" + Date.now()); const observed = module.evaluateRepairBoundary(inputFor(fixture));
    return {status: observed.route === "MUTATED_PARALLEL_ACCEPTED" ? "WEAKENED" : "INTACT", mutation_detected: observed.route === "MUTATED_PARALLEL_ACCEPTED", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export async function evaluateRepairPackage() {
  const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json")); const manifest = json(path.join(root, "gates/manifest.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Repair package state invalid", "REPAIR_PACKAGE_STATE_INVALID");
  assert(manifest.block_id === BLOCK_ID && manifest.ordered_gate_ids.length === 12 && manifest.gate_paths.length === 12, "Repair gate manifest invalid", "REPAIR_GATE_MANIFEST_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: PACKAGE + "/" + relative_path, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Repair gate inventory incomplete", "REPAIR_GATE_INVENTORY_INVALID");
  const map = fixtures(root); const results = [];
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const fixture = entry.fixture; const expected = fixture.vector.expected_readback; const input = inputFor(fixture); const actual = evaluateRepairBoundary(input);
    assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, "Repair vector failed: " + fixture.class, "REPAIR_HOSTILE_RESULT_FAILED");
    assert(Object.values(actual.external_side_effects).every((value) => value === 0), "Repair side effect observed", "REPAIR_SIDE_EFFECT");
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, result: actual.result_sha256})});
  }
  const sensitivity = await mutation(json(path.join(root, "fixtures/parallel_shared_worktree.json"))); assert(sensitivity.mutation_detected, "Repair mutation proof missing", "REPAIR_MUTATION_PROOF_MISSING");
  const evaluation = {schema: REPAIR_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, final_review_independent_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null}; evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(JSON.stringify(await evaluateRepairPackage(), null, 2) + "\n");
