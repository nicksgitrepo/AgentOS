#!/usr/bin/env node

/* Operational evaluator for the Desktop/Offline/Realtime Client Router. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateDesktopOfflineRealtimeRouterBoundary, DESKTOP_OFFLINE_REALTIME_ROUTER_BOUNDARY_SCHEMA} from "./desktop-offline-realtime-router-boundary-gate.mjs";

export const DESKTOP_OFFLINE_REALTIME_ROUTER_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_desktop_offline_realtime_router_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-05/desktop-offline-realtime-router";
const BLOCK_ID = "specialist.product-client.desktop-offline-realtime-router";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message, code = "DESKTOP_OFFLINE_REALTIME_ROUTER_PACKAGE_EVALUATION_INVALID") => { const error = new Error(message); error.code = code; throw error; };
const assert = (value, message, code) => { if (!value) fail(message, code); };
const read = (file) => { assert(fs.existsSync(file), `${file} is missing`, "DESKTOP_OFFLINE_REALTIME_ROUTER_PACKAGE_FILE_MISSING"); return fs.readFileSync(file); };
const readJson = (file) => JSON.parse(read(file));
const resultDigest = (value) => canonicalDigest({...value, result_sha256: null});

function files(root) {
  const out = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) out.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) out.push(`fixtures/${name}`);
  return out.sort();
}

function fixtureMap(expectedClasses) {
  const root = path.join(ROOT, PACKAGE_RELATIVE);
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === expectedClasses.length && new Set(names).size === expectedClasses.length, "Desktop Offline Realtime fixture inventory is not exact", "DESKTOP_OFFLINE_REALTIME_ROUTER_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const bytes = read(path.join(root, "fixtures", name));
    const fixture = JSON.parse(bytes);
    assert(fixture.block_id === BLOCK_ID && typeof fixture.fixture_id === "string", `Fixture ${name} identity is invalid`, "DESKTOP_OFFLINE_REALTIME_ROUTER_FIXTURE_ID_INVALID");
    assert(fixture.vector?.entrypoint === "control/desktop-offline-realtime-router-boundary-gate.mjs#evaluateDesktopOfflineRealtimeRouterBoundary", `Fixture ${name} is not operational`, "DESKTOP_OFFLINE_REALTIME_ROUTER_FIXTURE_UNBOUND");
    assert(fixture.vector.input?.schema === DESKTOP_OFFLINE_REALTIME_ROUTER_BOUNDARY_SCHEMA, `Fixture ${name} input schema mismatch`, "DESKTOP_OFFLINE_REALTIME_ROUTER_FIXTURE_INPUT_INVALID");
    assert(fixture.expected_readback?.disposition && fixture.expected_readback?.route && fixture.expected_readback?.error_code, `Fixture ${name} lacks typed expectation`, "DESKTOP_OFFLINE_REALTIME_ROUTER_FIXTURE_EXPECTATION_INVALID");
    assert(!map.has(fixture.fixture_id), `Duplicate fixture ${name}`, "DESKTOP_OFFLINE_REALTIME_ROUTER_FIXTURE_ALIAS");
    map.set(fixture.fixture_id, {fixture, file_sha256: sha(bytes)});
  }
  assert([...map.values()].map((value) => value.fixture.class).sort().join("\0") === expectedClasses.slice().sort().join("\0"), "Desktop Offline Realtime fixture classes do not match package inventory", "DESKTOP_OFFLINE_REALTIME_ROUTER_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

async function mutation(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-desktop-offline-realtime-mutation-"));
  try {
    const control = path.join(dir, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dep of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dep), path.join(control, dep));
    const target = path.join(control, "desktop-offline-realtime-router-boundary-gate.mjs");
    let source = fs.readFileSync(path.join(ROOT, "control/desktop-offline-realtime-router-boundary-gate.mjs"), "utf8");
    const anchor = 'return result("DENY", "NO_ROUTER_SIDE_EFFECT", "DESKTOP_OFFLINE_REALTIME_ROUTER_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Desktop router mutation anchor missing", "DESKTOP_OFFLINE_REALTIME_ROUTER_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'return result("ROUTE", "SPECIALIST_HANDOFF", "MUTATED_OPERATION_ALLOWED", input, {routing_allowed:true, selected_specialist:"specialist.product-client.product-interaction"});');
    fs.writeFileSync(target, source, {flag: "wx"});
    const mod = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const observed = mod.evaluateDesktopOfflineRealtimeRouterBoundary(fixture.vector.input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

export async function evaluateDesktopOfflineRealtimeRouterPackage() {
  const packageRoot = path.join(ROOT, PACKAGE_RELATIVE);
  const block = readJson(path.join(packageRoot, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Desktop router package is not an inactive candidate", "DESKTOP_OFFLINE_REALTIME_ROUTER_PACKAGE_STATE_INVALID");
  const packageFiles = files(packageRoot);
  const digests = packageFiles.map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: sha(read(path.join(packageRoot, relativePath)))}));
  assert(packageFiles.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "Desktop router gate inventory is incomplete", "DESKTOP_OFFLINE_REALTIME_ROUTER_GATE_INVENTORY_INVALID");
  const map = fixtureMap(block.evaluation?.fixture_classes ?? []);
  const results = [];
  for (const info of [...map.values()].sort((a, b) => a.fixture.fixture_id.localeCompare(b.fixture.fixture_id))) {
    const fixture = info.fixture; const expected = fixture.expected_readback; let actual;
    try { actual = evaluateDesktopOfflineRealtimeRouterBoundary(fixture.vector.input); } catch (error) { fail(`${fixture.fixture_id} execution failed: ${error.code ?? error.message}`, "DESKTOP_OFFLINE_REALTIME_ROUTER_HOSTILE_EXECUTION_FAILED"); }
    const zero = Object.values(actual.external_side_effects).every((value) => value === 0);
    const checks = [
      {assertion: "TYPED_DISPOSITION", observed: actual.disposition === expected.disposition, evidence: `${actual.disposition}/${expected.disposition}`},
      {assertion: "TYPED_ROUTE", observed: actual.route === expected.route, evidence: `${actual.route}/${expected.route}`},
      {assertion: "TYPED_ERROR", observed: actual.error_code === expected.error_code, evidence: `${actual.error_code}/${expected.error_code}`},
      {assertion: "NO_CLIENT_SIDE_EFFECT", observed: zero, evidence: JSON.stringify(actual.external_side_effects)},
      {assertion: "ACCEPTANCE_FORBIDDEN", observed: actual.acceptance_allowed === false, evidence: `${actual.acceptance_allowed}`}
    ];
    assert(checks.every((check) => check.observed), `${fixture.fixture_id} hostile result failed`, "DESKTOP_OFFLINE_REALTIME_ROUTER_HOSTILE_RESULT_FAILED");
    const record = {fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: info.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, assertion_readbacks: checks, external_side_effects: actual.external_side_effects, duration_ms: 0, result_sha256: null};
    record.result_sha256 = resultDigest(record); results.push(record);
  }
  const mutationSensitivity = await mutation(readJson(path.join(packageRoot, "fixtures/unsafe_action.json")));
  assert(mutationSensitivity.status === "WEAKENED" && mutationSensitivity.mutation_detected, "Desktop router mutation proof did not execute", "DESKTOP_OFFLINE_REALTIME_ROUTER_MUTATION_PROOF_MISSING");
  const evaluation = {schema: DESKTOP_OFFLINE_REALTIME_ROUTER_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, mutation_sensitivity: mutationSensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateDesktopOfflineRealtimeRouterPackage(), null, 2)}\n`);
