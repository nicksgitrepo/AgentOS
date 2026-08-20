#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateOwaspApiTop10RouterBoundary, OWASP_API_TOP10_ROUTER_INPUT_SCHEMA} from "./owasp-api-top10-router-boundary-gate.mjs";

export const OWASP_API_TOP10_ROUTER_EVALUATION_SCHEMA = "agentos.specialist_owasp_api_top10_router_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-03/owasp-api-top10-router";
const BLOCK_ID = "specialist.security.owasp-api-top10-router";
const CLASSES = ["authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "OWASP_API_TOP10_ROUTER_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort();
}
function fixtures(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === 17 && new Set(names).size === 17, "OWASP API Top 10 fixture inventory invalid", "OWASP_API_TOP10_ROUTER_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name); const fixture = json(file);
    assert(fixture.block_id === BLOCK_ID && CLASSES.includes(fixture.class) && fixture.vector?.entrypoint === "control/owasp-api-top10-router-boundary-gate.mjs#evaluateOwaspApiTop10RouterBoundary", `OWASP API Top 10 fixture is not operational: ${name}`, "OWASP_API_TOP10_ROUTER_FIXTURE_UNBOUND");
    assert(fixture.vector.input?.schema === OWASP_API_TOP10_ROUTER_INPUT_SCHEMA && fixture.vector.expected_readback?.disposition && fixture.vector.expected_readback?.route && fixture.vector.expected_readback?.error_code, `OWASP API Top 10 fixture lacks typed input/readback: ${name}`, "OWASP_API_TOP10_ROUTER_FIXTURE_INVALID");
    assert(!map.has(fixture.class), `OWASP API Top 10 duplicate fixture class: ${name}`, "OWASP_API_TOP10_ROUTER_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file))});
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "OWASP API Top 10 fixture classes incomplete", "OWASP_API_TOP10_ROUTER_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}
function inputFor(fixture, digest) { const input = structuredClone(fixture.vector.input); input.evidence.candidate_digest = digest; return input; }
async function mutation(fixture, digest) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-owasp-api-top10-router-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "owasp-api-top10-router-boundary-gate.mjs");
    let source = read(path.join(ROOT, "control/owasp-api-top10-router-boundary-gate.mjs"));
    const anchor = 'if (f.unsafe_action) return result("DENY", "NO_OWASP_API_SECURITY_SIDE_EFFECT", "OWASP_API_TOP10_ROUTER_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "OWASP API Top 10 mutation anchor missing", "OWASP_API_TOP10_ROUTER_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.unsafe_action) return result("ROUTE", "OWASP_API_ATOMIC_SPECIALIST_HANDOFF", "MUTATED_UNSAFE_OPERATION_ALLOWED", input, {routing_allowed: true});');
    fs.writeFileSync(target, source, {flag: "wx"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const observed = module.evaluateOwaspApiTop10RouterBoundary(inputFor(fixture, digest));
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export async function evaluateOwaspApiTop10RouterPackage() {
  const root = path.join(ROOT, PACKAGE); const block = json(path.join(root, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "OWASP API Top 10 package state invalid", "OWASP_API_TOP10_ROUTER_PACKAGE_STATE_INVALID");
  const files = inventory(root); const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === 12, "OWASP API Top 10 gates incomplete", "OWASP_API_TOP10_ROUTER_GATE_INVENTORY_INVALID");
  const map = fixtures(root); const results = [];
  for (const entry of [...map.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const fixture = entry.fixture; const expected = fixture.vector.expected_readback; const actual = evaluateOwaspApiTop10RouterBoundary(inputFor(fixture, block.block_sha256));
    assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `OWASP API Top 10 vector failed: ${fixture.class}`, "OWASP_API_TOP10_ROUTER_HOSTILE_RESULT_FAILED");
    assert(Object.values(actual.external_side_effects).every((value) => value === 0), "OWASP API Top 10 side effect observed", "OWASP_API_TOP10_ROUTER_SIDE_EFFECT");
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, result: actual.result_sha256})});
  }
  const sensitivity = await mutation(json(path.join(root, "fixtures/unsafe_action.json")), block.block_sha256);
  assert(sensitivity.mutation_detected, "OWASP API Top 10 mutation proof missing", "OWASP_API_TOP10_ROUTER_MUTATION_PROOF_MISSING");
  const evaluation = {schema: OWASP_API_TOP10_ROUTER_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, mutation_sensitivity: sensitivity, independent_signature_required: true, observed_at_utc: new Date().toISOString(), evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null}); return Object.freeze(evaluation);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateOwaspApiTop10RouterPackage(), null, 2)}\n`);
