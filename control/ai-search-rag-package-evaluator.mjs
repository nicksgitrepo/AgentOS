#!/usr/bin/env node

/* Operational, read-only evaluator for the AI Search/RAG specialist.  It
 * invokes the public boundary with every committed hostile fixture, executes
 * the twelve-gate tree, proves a weakened implementation is detected, and
 * reports protected governance blockers without converting local QA into
 * independent clearance. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateAiSearchRagBoundary, AI_SEARCH_RAG_INPUT_SCHEMA} from "./ai-search-rag-boundary-gate.mjs";
import {AI_SEARCH_RAG_BLOCK_ID, AI_SEARCH_RAG_CUSTODY_REF, AI_SEARCH_RAG_FIXTURE_CLASSES, AI_SEARCH_RAG_GATE_IDS, AI_SEARCH_RAG_MODEL_CAPABILITIES, AI_SEARCH_RAG_MODEL_CAPABILITY_FLOOR, AI_SEARCH_RAG_MODEL_TASK_CLASS, AI_SEARCH_RAG_SOURCE_IDENTITY, AI_SEARCH_RAG_SOURCE_VERSION, resolveAiSearchRagCanonicalAuthority} from "./ai-search-rag-authority-binding.mjs";

export const AI_SEARCH_RAG_EVALUATION_SCHEMA = "agentos.specialist_ai_search_rag_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-06/search-rag";
const FLAGS = ["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fail(message, code = "AI_SEARCH_RAG_EVALUATION_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function deepFlags(overrides = {}) { return {...Object.fromEntries(FLAGS.map((key) => [key, false])), ...(overrides ?? {})}; }

export function buildAiSearchRagInput(authority, {request_kind = "ANALYZE_SEARCH_RAG", evidence_overrides = {}} = {}) {
  const base = {
    schema: AI_SEARCH_RAG_INPUT_SCHEMA,
    version: 1,
    request_kind,
    evidence: {
      authority_status: "CURRENT",
      custody_status: "BOUND",
      custody_owner: "AGENT.AI_SEARCH_RAG",
      custody_ref: AI_SEARCH_RAG_CUSTODY_REF,
      source_status: "CURRENT_VERIFIED",
      source_identity: AI_SEARCH_RAG_SOURCE_IDENTITY,
      source_version: AI_SEARCH_RAG_SOURCE_VERSION,
      source_effective_date: authority.source_effective_date,
      source_retrieved_date: authority.source_retrieved_date,
      candidate_status: "CURRENT_CANDIDATE",
      candidate_digest: authority.block_sha256,
      signal: "AI.SEARCH_RAG",
      signal_status: "BOUND",
      task_status: "RETRIEVAL_ANALYSIS",
      context_status: "AI_SEARCH_RAG_CONTEXT",
      context_complete: true,
      requested_action: request_kind === "ROUTE_SEARCH_RAG_HANDOFF" ? "ROUTE" : "ANALYZE",
      requested_tools: ["READ_CANDIDATE", "READ_SOURCE_LOCK", "READ_CORPUS_DESCRIPTOR", "READ_CONTEXT", "READ_STANDARD_BLOCK"],
      required_block_identities: ["SPECIALIST.FOUNDATION.AUTHORITY_JURISDICTION_GATE", "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE", "SPECIALIST.FOUNDATION.ROLE_INTAKE_CLASSIFIER", "SPECIALIST.FOUNDATION.SCOPE_NON_GOAL_GATE", "SPECIALIST.FOUNDATION.TOOL_CUSTODY_GATE"],
      model_policy_status: "CURRENT",
      model_route_status: "BOUND",
      authority_scope: "AI_SEARCH_RAG",
      scope: "NARROW",
      corpus_scope: "EXTERNAL_TYPED_CORPUS",
      corpus_ref: "ref:CORPUS/EXTERNAL/1",
      tenant_scope_status: "BOUND",
      standard_block_sha256: authority.standard_block_sha256,
      standard_source_manifest_sha256: authority.standard_source_manifest_sha256,
      genai_standard_block_sha256: authority.genai_standard_block_sha256,
      genai_standard_source_manifest_sha256: authority.genai_standard_source_manifest_sha256,
      model_snapshot_sha256: authority.model.snapshot_sha256,
      model_task_class: AI_SEARCH_RAG_MODEL_TASK_CLASS,
      model_capability_floor: AI_SEARCH_RAG_MODEL_CAPABILITY_FLOOR,
      model_required_capabilities: [...AI_SEARCH_RAG_MODEL_CAPABILITIES],
      model_route_sha256: authority.model_route_sha256,
      context_receipt_sha256: authority.context_sha256,
      upstream_router_result_sha256: authority.router_result_sha256,
      memory_context_status: "INVALIDATED_ON_CANDIDATE_CHANGE",
      context_invalidation_status: "BOUND",
      project_data_present: false,
      secret_data_present: false,
      memory_write_requested: false,
      adversarial_flags: deepFlags(),
    },
  };
  const overrides = structuredClone(evidence_overrides ?? {});
  base.evidence = {...base.evidence, ...overrides, adversarial_flags: deepFlags(overrides.adversarial_flags)};
  return base;
}

function inventory(root) {
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "hostile-fixtures.manifest.json", "evaluation.json", "handoff.json"];
  for (const name of fs.readdirSync(path.join(root, "gates")).filter((name) => name.endsWith(".gate"))) files.push(`gates/${name}`);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json"))) files.push(`fixtures/${name}`);
  return files.sort(compareUtf8);
}

function fixtureMap(root) {
  const names = fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(names.length === AI_SEARCH_RAG_FIXTURE_CLASSES.length && new Set(names).size === AI_SEARCH_RAG_FIXTURE_CLASSES.length, "AI Search/RAG fixture count is invalid", "AI_SEARCH_RAG_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, "fixtures", name);
    const fixture = json(file);
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === AI_SEARCH_RAG_BLOCK_ID && fixture.hostile === true && AI_SEARCH_RAG_FIXTURE_CLASSES.includes(fixture.class), `AI Search/RAG fixture is not canonical: ${name}`, "AI_SEARCH_RAG_FIXTURE_INVALID");
    assert(fixture.vector?.entrypoint === "control/ai-search-rag-boundary-gate.mjs#evaluateAiSearchRagBoundary" && fixture.vector?.input?.schema === AI_SEARCH_RAG_INPUT_SCHEMA && fixture.vector?.input?.request_kind && fixture.vector?.expected_readback?.disposition && fixture.vector?.expected_readback?.route && fixture.vector?.expected_readback?.error_code, `AI Search/RAG fixture is not executable: ${name}`, "AI_SEARCH_RAG_FIXTURE_UNBOUND");
    assert(!map.has(fixture.class), `AI Search/RAG fixture class is duplicated: ${fixture.class}`, "AI_SEARCH_RAG_FIXTURE_ALIAS");
    map.set(fixture.class, {fixture, file_sha256: sha(fs.readFileSync(file)), name});
  }
  assert([...map.keys()].sort(compareUtf8).join("\0") === [...AI_SEARCH_RAG_FIXTURE_CLASSES].sort(compareUtf8).join("\0"), "AI Search/RAG fixture classes are incomplete", "AI_SEARCH_RAG_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function executeGateTree(root, execution) {
  const gates = new Map(AI_SEARCH_RAG_GATE_IDS.map((gateId) => [gateId, json(path.join(root, "gates", `${gateId}.gate`))]));
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(AI_SEARCH_RAG_GATE_IDS), "AI Search/RAG gate order is not canonical", "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
  let cursor = AI_SEARCH_RAG_GATE_IDS[0];
  const trace = [];
  for (let index = 0; index < AI_SEARCH_RAG_GATE_IDS.length; index += 1) {
    const gateId = AI_SEARCH_RAG_GATE_IDS[index];
    assert(cursor === gateId, `AI Search/RAG gate cursor diverged at ${gateId}`, "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
    const gate = gates.get(gateId);
    assert(gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `AI Search/RAG gate ${gateId} is not executable`, "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
    assert(gate.next.YES === (index === AI_SEARCH_RAG_GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : AI_SEARCH_RAG_GATE_IDS[index + 1]), `AI Search/RAG gate ${gateId} YES transition is invalid`, "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
    assert(gate.next.NO === "OUTCOME:DENY" && gate.next.UNKNOWN === "OUTCOME:UNKNOWN_DEPENDENT_ONLY" && gate.next.NOT_APPLICABLE === (index === AI_SEARCH_RAG_GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : AI_SEARCH_RAG_GATE_IDS[index + 1]), `AI Search/RAG gate ${gateId} fail-closed transition is invalid`, "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
    trace.push({gate_id: gateId, answer: "YES", next: gate.next.YES});
    cursor = gate.next.YES;
  }
  assert(cursor === "OUTCOME:ROUTE", "AI Search/RAG gate tree did not reach ROUTE", "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
  return trace;
}

async function mutation(authority) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ai-search-rag-mutation-"));
  try {
    const control = path.join(temp, "control"); fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "ai-search-rag-boundary-gate.mjs");
    let source = read(path.join(ROOT, "control/ai-search-rag-boundary-gate.mjs"));
    const anchor = 'if (f.unsafe_action) return result("DENY", "NO_SEARCH_RAG_SIDE_EFFECT", "AI_SEARCH_RAG_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "AI Search/RAG mutation anchor is missing", "AI_SEARCH_RAG_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, 'if (f.unsafe_action) return result("ROUTE", "AI_SEARCH_RAG_HANDOFF", "MUTATED_UNSAFE_OPERATION_ALLOWED", input, {routing_allowed: true});');
    fs.writeFileSync(target, source, {flag: "wx"});
    const isolated = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const input = buildAiSearchRagInput(authority, {request_kind: "ANALYZE_SEARCH_RAG"});
    input.evidence.adversarial_flags.unsafe_action = true;
    const observed = isolated.evaluateAiSearchRagBoundary(input);
    return {status: observed.disposition === "ROUTE" ? "WEAKENED" : "INTACT", mutation_detected: observed.disposition === "ROUTE", expected_disposition: "DENY", observed_disposition: observed.disposition};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

export async function evaluateAiSearchRagPackage() {
  const authority = resolveAiSearchRagCanonicalAuthority();
  const root = path.join(ROOT, PACKAGE);
  const block = json(path.join(root, "block.json"));
  const files = inventory(root);
  const digests = files.map((relative_path) => ({relative_path: `${PACKAGE}/${relative_path}`, sha256: sha(fs.readFileSync(path.join(root, relative_path)))}));
  const fixtures = fixtureMap(root);
  const execution = json(path.join(root, "gates/execution.json"));
  const gate_trace = executeGateTree(root, execution);
  const results = [];
  for (const entry of [...fixtures.values()].sort((left, right) => compareUtf8(left.fixture.class, right.fixture.class))) {
    const fixture = entry.fixture;
    const input = buildAiSearchRagInput(authority, {request_kind: fixture.vector.input.request_kind, evidence_overrides: fixture.vector.input.evidence_overrides});
    const expected = fixture.vector.expected_readback;
    const actual = evaluateAiSearchRagBoundary(input);
    assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `AI Search/RAG hostile vector failed: ${fixture.class}`, "AI_SEARCH_RAG_HOSTILE_RESULT_FAILED");
    assert(Object.values(actual.external_side_effects).every((value) => value === 0), `AI Search/RAG side effect observed: ${fixture.class}`, "AI_SEARCH_RAG_SIDE_EFFECT");
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, result_sha256: canonicalDigest({class: fixture.class, result: actual.result_sha256})});
  }
  const executionFixtureClasses = new Set(execution.executions.map((entry) => entry.fixture_class));
  assert(execution.executions.length === AI_SEARCH_RAG_GATE_IDS.length && execution.executions.every((entry) => AI_SEARCH_RAG_GATE_IDS.includes(entry.gate_id) && fixtures.has(entry.fixture_class) && entry.expected?.disposition), "AI Search/RAG gate execution fixtures are incomplete", "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
  assert(executionFixtureClasses.size === AI_SEARCH_RAG_GATE_IDS.length, "AI Search/RAG gate execution fixture inventory is aliased", "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
  const sensitivity = await mutation(authority);
  assert(sensitivity.mutation_detected, "AI Search/RAG mutation proof is missing", "AI_SEARCH_RAG_MUTATION_PROOF_MISSING");
  const evaluation = {schema: AI_SEARCH_RAG_EVALUATION_SCHEMA, version: 1, status: "BLOCKED_EXACT", local_status: "PASS_LOCAL_ONLY", block_id: AI_SEARCH_RAG_BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(digests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(digests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results, gate_trace, mutation_sensitivity: sensitivity, model_preflight_status: authority.model_preflight_status, protected_blockers: [...authority.protected_blockers], audit_started: false, audit_verdict: "NOT_STARTED", independent_reviewer_required: true, ready_for_admission: false, next_action: "Refresh the protected model-policy snapshot and obtain the canonical signed evaluator handoff; then rebind this exact candidate before any fresh Luna-max audit.", observed_at_utc: new Date().toISOString(), evaluation_sha256: null};
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateAiSearchRagPackage(), null, 2)}\n`);
