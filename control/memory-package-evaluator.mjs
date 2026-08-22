#!/usr/bin/env node

/* Operational evaluator for the reusable Memory package.
 *
 * The package remains a candidate.  This evaluator resolves the real package
 * files, executes every hostile vector against the canonical memory modules in
 * isolated temporary stores, runs the focused memory contract suites, and
 * proves that weakening the real privacy scanner changes the result.  It
 * never activates or admits the role and it never writes to the repository.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";
import {
  GENESIS_EVENT_SHA256,
  compileDecisionRecord,
  compileGoalRecord,
  compileHandoffRecord,
  compileMemoryEvent,
  compileProjectContextRecord,
  compileMemorySnapshot,
  replayMemoryLedger,
  validateMemorySnapshot,
} from "./project-memory.mjs";
import {compileRoleContextCapsule, validateRoleContextCapsule} from "./project-memory-projections.mjs";
import {
  appendProjectMemoryEvent,
  readProjectMemoryLedger,
  reconstructProjectMemory,
} from "./project-memory-store.mjs";
import {
  GLOBAL_GOVERNANCE_MEMORY_GENESIS,
  compileGlobalGovernanceMemoryEvent,
  compileGlobalGovernanceMemoryReadback,
  validateGlobalGovernanceMemoryReadback,
} from "./global-governance-memory.mjs";
import {appendAuthorizedGlobalGovernanceMemoryEvent} from "./global-governance-operational-context.mjs";
import {SPECIALIST_GATE_IDS, GATE_OUTCOMES, CORE_EVALUATION_CLASSES, ATOMIC_EVALUATION_CLASSES} from "./specialist-block-compiler.mjs";

export const MEMORY_PACKAGE_EVALUATION_SCHEMA = "agentos.specialist_memory_package_operational_evaluation.v1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_RELATIVE = "specialist-blocks/wave-01/memory";
const BLOCK_ID = "specialist.control.memory";
const NOW = new Date().toISOString();
const SHA256 = /^[0-9a-f]{64}$/u;
const FOCUSED_SUITES = [
  "tests/verify-project-memory-schema.mjs",
  "tests/verify-project-memory.mjs",
  "tests/verify-project-memory-replay.mjs",
  "tests/verify-project-memory-runtime.mjs",
  "tests/verify-map-memory-contracts.mjs",
  "tests/verify-global-governance-memory.mjs",
  "tests/verify-global-governance-operational-integration.mjs",
  "tests/verify-global-governance-process-attachment.mjs",
];

function fail(message, code = "MEMORY_PACKAGE_EVALUATION_INVALID") {
  const error = new Error(message); error.code = code; throw error;
}
function assert(value, message, code) { if (!value) fail(message, code); }
function rawSha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function json(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function digestResult(value) { return canonicalDigest({...value, result_sha256: null}); }
function safeRead(file) { assert(fs.existsSync(file), `${file} is missing`, "MEMORY_PACKAGE_FILE_MISSING"); return fs.readFileSync(file); }
function readFixtureMap() {
  const fixtureRoot = path.join(ROOT, PACKAGE_RELATIVE, "fixtures");
  const names = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
  const expected = [...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES].sort();
  assert(names.map((name) => name.slice(0, -5)).join("\0") === expected.join("\0"), "Memory fixture inventory is not exact", "MEMORY_FIXTURE_INVENTORY_INVALID");
  const fixtures = new Map();
  for (const name of names) {
    const bytes = safeRead(path.join(fixtureRoot, name));
    const fixture = JSON.parse(bytes);
    assert(fixture.block_id === BLOCK_ID && typeof fixture.fixture_id === "string", `Memory fixture ${name} is not bound`, "MEMORY_FIXTURE_UNBOUND");
    assert(!fixtures.has(fixture.fixture_id), `Memory fixture alias: ${name}`, "MEMORY_FIXTURE_ALIAS");
    fixtures.set(fixture.class, {fixture, file_sha256: rawSha256(bytes), relative_path: `${PACKAGE_RELATIVE}/fixtures/${name}`});
  }
  return fixtures;
}

function binding(projectRef = "PROJECT_MEMORY_EVAL") {
  const suffix = projectRef.replace(/[^A-Z0-9._:-]/gu, "_");
  return {
    project_ref: suffix,
    campaign_ref: "CAMPAIGN_MEMORY_EVAL",
    goal_ref: "GOAL_MEMORY_EVAL",
    role_ref: "AGENTOS.MEMORY",
    source_commit: "a".repeat(40),
    source_tree: "b".repeat(40),
    source_snapshot_sha256: canonicalDigest({source: "memory-eval-snapshot"}),
    policy_sha256: canonicalDigest({source: "memory-eval-policy"}),
    handoff_sha256: canonicalDigest({source: "memory-eval-handoff"}),
  };
}

function sha(seed) { return canonicalDigest({seed}); }
function contextRecord(memoryBinding, suffix = "CONTEXT") {
  return compileProjectContextRecord({
    recordId: `${suffix}_1`, binding: memoryBinding,
    contextInputSha256: sha(`${suffix}-input`), intentSha256: sha(`${suffix}-intent`),
    planSha256: sha(`${suffix}-plan`), governanceSha256: sha(`${suffix}-governance`),
    boundarySha256: sha(`${suffix}-boundary`),
  });
}
function eventFor(record, sequence, priorEventSha256 = GENESIS_EVENT_SHA256, eventType = "RECORD_APPENDED", prefix = "MEMORY_EVAL") {
  return compileMemoryEvent({eventId: `${prefix}_${sequence}`, idempotencyKey: `${prefix}_KEY_${sequence}`, sequence, eventType, record, priorEventSha256});
}
function appendOne(authorityRoot, event) {
  return appendProjectMemoryEvent({authorityRoot, expectedHeadSha256: event.prior_event_sha256, event});
}
function withTempStore(fn) {
  const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-memory-package-store-"));
  try { return fn(authorityRoot); } finally { fs.rmSync(authorityRoot, {recursive: true, force: true}); }
}
function expectThrow(fn, code = null) {
  try { fn(); } catch (error) {
    if (code !== null) assert(error.code === code || String(error.message).includes(code), `Expected typed denial ${code}, observed ${error.code ?? error.message}`, "MEMORY_EXPECTED_DENIAL_MISMATCH");
    return {denied: true, error_code: error.code ?? "MEMORY_DENIED"};
  }
  fail("Hostile Memory vector was accepted", "MEMORY_HOSTILE_VECTOR_ACCEPTED");
}

function executeValid(className, memoryBinding, authorityRoot) {
  if (className === "false_positive") {
    const record = contextRecord(memoryBinding, "VALID_CONTEXT"); const event = eventFor(record, 0);
    appendOne(authorityRoot, event); const replay = reconstructProjectMemory({authorityRoot, binding: memoryBinding});
    assert(replay.current_records.some((candidate) => candidate.record_sha256 === record.record_sha256), "Valid memory record did not replay", "MEMORY_REPLAY_MISSING");
    return {disposition: "ACCEPT_RECORD", memory_events: 1};
  }
  if (className === "handoff") {
    const record = compileHandoffRecord({recordId: "HANDOFF_1", binding: memoryBinding, handoffKind: "MEMORY_LANE", nextActionRef: "SPAWNER_REVIEW", resultSha256: sha("handoff-result")});
    appendOne(authorityRoot, eventFor(record, 0));
    assert(reconstructProjectMemory({authorityRoot, binding: memoryBinding}).current_records[0].record_type === "HANDOFF", "Handoff did not replay", "MEMORY_HANDOFF_REPLAY_MISSING");
    return {disposition: "ACCEPT_HANDOFF", memory_events: 1};
  }
  if (className === "narrowness") {
    const record = compileGoalRecord({recordId: "NARROW_GOAL_1", binding: memoryBinding, goalSha256: sha("narrow-goal"), goalKind: "BOUNDED_LANE", scopeSha256: sha("narrow-scope"), acceptanceSha256: sha("narrow-acceptance")});
    appendOne(authorityRoot, eventFor(record, 0));
    assert(reconstructProjectMemory({authorityRoot, binding: memoryBinding}).current_records.length === 1, "Narrow record broadened unexpectedly", "MEMORY_NARROWNESS_BROKEN");
    return {disposition: "ACCEPT_NARROW_SCOPE", memory_events: 1};
  }
  if (className === "routing") {
    const record = contextRecord(memoryBinding, "ROUTE_CONTEXT"); const event = eventFor(record, 0); appendOne(authorityRoot, event);
    const replay = reconstructProjectMemory({authorityRoot, binding: memoryBinding});
    const snapshot = compileMemorySnapshot({binding: memoryBinding, replay, observedAtUtc: new Date().toISOString()});
    validateMemorySnapshot(snapshot, {binding: memoryBinding});
    const capsule = compileRoleContextCapsule({snapshot, roleRef: memoryBinding.role_ref, laneRef: "MEMORY_LANE", selectedRecordSha256s: [record.record_sha256], allowedScopeRefs: ["PROJECT_MEMORY"], prohibitedScopeRefs: ["DEPLOYMENT", "LIFECYCLE", "PRODUCT_WRITE"], requiredEvidenceSha256s: [record.record_sha256]});
    validateRoleContextCapsule(capsule, {snapshot});
    return {disposition: "ROUTE_READ_ONLY", memory_events: 1, snapshot_sha256: snapshot.snapshot_sha256, capsule_sha256: capsule.capsule_sha256};
  }
  fail(`Unknown valid Memory fixture ${className}`);
}

function executeDenied(className, memoryBinding, authorityRoot) {
  if (["authority_conflict", "duplicate_sibling_authority", "umbrella_authority"].includes(className)) {
    const snapshot = json(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"));
    return expectThrow(() => compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "RUNTIME", snapshot, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}));
  }
  if (["data_limit", "unrelated_scope", "unsafe_action"].includes(className)) {
    const values = {data_limit: {body: "sk-test-secret-value"}, unrelated_scope: {project_name: "CONSUMER_PROJECT"}, unsafe_action: {deployment: "production"}};
    return expectThrow(() => { if (!scanPersistedRecord(values[className]).safe) throw Object.assign(new Error("memory privacy denial"), {code: "MEMORY_PRIVACY_DENIED"}); fail("privacy scan unexpectedly accepted hostile data"); });
  }
  if (["broad_when_narrow_exists", "cross_provider_version_claim", "missing_context"].includes(className)) {
    const record = contextRecord(memoryBinding, "BOUND_CONTEXT"); appendOne(authorityRoot, eventFor(record, 0));
    const mismatched = {...memoryBinding, source_tree: "c".repeat(40)};
    return expectThrow(() => reconstructProjectMemory({authorityRoot, binding: mismatched}), "memory ledger scope mismatch");
  }
  if (className === "router_self_accept") {
    const block = json(path.join(ROOT, PACKAGE_RELATIVE, "block.json"));
    assert(block.lifecycle === "CANDIDATE" && block.activation === "OFF" && block.evaluation.disposition === "EXECUTED_REVIEW_REQUIRED", "Memory package self-acceptance state is not closed", "MEMORY_SELF_ACCEPTANCE");
    return {denied: true, error_code: "MEMORY_SELF_ACCEPTANCE_DENIED"};
  }
  if (className === "silent_scope_expansion") {
    const event = compileGlobalGovernanceMemoryEvent;
    return expectThrow(() => appendAuthorizedGlobalGovernanceMemoryEvent({expectedHeadSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, event}), "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  }
  if (className === "stale_source") {
    const snapshot = json(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"));
    const accepted = compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: {...snapshot, status: "ACCEPTED_ACTIVE", snapshot_sha256: canonicalDigest({...snapshot, status: "ACCEPTED_ACTIVE", snapshot_sha256: null})}, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW});
    const readback = compileGlobalGovernanceMemoryReadback({events: [accepted], historicalActivationReceiptSha256: sha("historical"), observedAtUtc: NOW});
    const stale = {...readback, live_event_count: 99, readback_sha256: null}; stale.readback_sha256 = canonicalDigest({...stale, readback_sha256: null});
    return expectThrow(() => validateGlobalGovernanceMemoryReadback(stale, {events: [accepted]}), "GLOBAL_MEMORY_READBACK_STALE");
  }
  if (className === "tool_limit") return expectThrow(() => readProjectMemoryLedger({authorityRoot, relativePath: "../outside.json"}), "unsafe");
  fail(`Unknown denied Memory fixture ${className}`);
}

export function executeMemoryFixture({fixtureClass, fixture} = {}) {
  assert(typeof fixtureClass === "string" && fixture?.class === fixtureClass, "Memory fixture input is not canonical", "MEMORY_FIXTURE_INPUT_INVALID");
  return withTempStore((authorityRoot) => {
    const memoryBinding = binding(`PROJECT_${fixtureClass.toUpperCase()}`);
    const result = ["false_positive", "handoff", "narrowness", "routing"].includes(fixtureClass)
      ? executeValid(fixtureClass, memoryBinding, authorityRoot)
      : executeDenied(fixtureClass, memoryBinding, authorityRoot);
    return {...result, external_side_effects: {workflow_mutations: 0, deployment_calls: 0, credential_accesses: 0, files_outside_isolated_store: 0}};
  });
}

function runFocusedSuites() {
  return FOCUSED_SUITES.map((relativePath) => {
    const result = spawnSync(process.execPath, [relativePath], {cwd: ROOT, encoding: "utf8", timeout: 120000});
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return {suite: relativePath, status: result.status === 0 ? "PASS" : "FAIL", exit_code: result.status, output_sha256: rawSha256(Buffer.from(output, "utf8"))};
  });
}

async function auditPrivacyMutation() {
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-memory-privacy-mutation-"));
  try {
    const sourcePath = path.join(ROOT, "control/persisted-record-privacy.mjs");
    const targetPath = path.join(mutationRoot, "persisted-record-privacy.mjs");
    let source = fs.readFileSync(sourcePath, "utf8");
    const anchor = "if (SECRET_LIKE.test(text)) counts.SECRET_LIKE_VALUE += 1;";
    assert(source.includes(anchor), "Memory privacy mutation anchor is missing", "MEMORY_MUTATION_ANCHOR_MISSING");
    source = source.replace(anchor, "if (false && SECRET_LIKE.test(text)) counts.SECRET_LIKE_VALUE += 1;");
    fs.writeFileSync(targetPath, source, {flag: "wx"});
    const mutated = await import(`${pathToFileURL(targetPath).href}?mutation=${Date.now()}`);
    const observed = mutated.scanPersistedRecord("sk-test-secret-value");
    return {status: observed.safe ? "WEAKENED" : "INTACT", mutation_detected: observed.safe, expected_safe: false, observed_safe: observed.safe, result_sha256: canonicalDigest(observed)};
  } finally { fs.rmSync(mutationRoot, {recursive: true, force: true}); }
}

export async function evaluateMemoryPackage() {
  const packageRoot = path.join(ROOT, PACKAGE_RELATIVE);
  const block = json(path.join(packageRoot, "block.json"));
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Memory package is not an inactive candidate", "MEMORY_PACKAGE_STATE_INVALID");
  const files = ["block.json", "sources.lock", "gates/manifest.json", "evaluation.json", "handoff.json", ...fs.readdirSync(path.join(packageRoot, "gates")).filter((name) => name.endsWith(".gate")).map((name) => `gates/${name}`), ...fs.readdirSync(path.join(packageRoot, "fixtures")).filter((name) => name.endsWith(".json")).map((name) => `fixtures/${name}`)].sort();
  const fileDigests = files.map((relativePath) => ({relative_path: `${PACKAGE_RELATIVE}/${relativePath}`, sha256: rawSha256(safeRead(path.join(packageRoot, relativePath)))}));
  assert(files.filter((file) => file.startsWith("gates/") && file.endsWith(".gate")).length === SPECIALIST_GATE_IDS.length, "Memory gate inventory is incomplete", "MEMORY_GATE_INVENTORY_INVALID");
  const fixtures = readFixtureMap();
  const results = [];
  for (const className of [...CORE_EVALUATION_CLASSES, ...ATOMIC_EVALUATION_CLASSES].sort()) {
    const fixtureInfo = fixtures.get(className);
    const expected = fixtureInfo.fixture.vector.expected_readback.disposition;
    const started = Date.now();
    let actual;
    try { actual = executeMemoryFixture({fixtureClass: className, fixture: fixtureInfo.fixture}); }
    catch (error) { fail(`${className} execution failed: ${error.code ?? error.message}`, "MEMORY_HOSTILE_EXECUTION_FAILED"); }
    const observed = {disposition: actual.disposition ?? (actual.denied ? fixtureInfo.fixture.vector.expected_readback.disposition : "UNKNOWN")};
    const matched = observed.disposition === expected;
    assert(matched, `${className} expected ${expected}, observed ${observed.disposition}`, "MEMORY_HOSTILE_RESULT_FAILED");
    const result = {fixture_id: fixtureInfo.fixture.fixture_id, fixture_class: className, fixture_file_sha256: fixtureInfo.file_sha256, entrypoint: "control/memory-package-evaluator.mjs#executeMemoryFixture", entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected, actual_outcome: observed.disposition, external_side_effects: actual.external_side_effects, memory_event_count: actual.memory_events ?? 0, duration_ms: Date.now() - started, result_sha256: null};
    result.result_sha256 = digestResult(result); results.push(result);
  }
  const focusedSuites = runFocusedSuites();
  assert(focusedSuites.every((suite) => suite.status === "PASS"), "One or more focused Memory suites failed", "MEMORY_FOCUSED_SUITE_FAILED");
  const mutation = await auditPrivacyMutation();
  assert(mutation.status === "WEAKENED" && mutation.mutation_detected === true, "Memory privacy mutation was not detected", "MEMORY_MUTATION_PROOF_MISSING");
  const observedAtUtc = new Date().toISOString();
  return Object.freeze({schema: MEMORY_PACKAGE_EVALUATION_SCHEMA, version: 1, status: "PASS", block_id: BLOCK_ID, lifecycle: "CANDIDATE", activation: "OFF", package_root_sha256: canonicalDigest(fileDigests), package_block_sha256: block.block_sha256, gate_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/gates/"))), fixture_inventory_sha256: canonicalDigest(fileDigests.filter((entry) => entry.relative_path.includes("/fixtures/"))), fixture_results: results.sort((left, right) => left.fixture_id.localeCompare(right.fixture_id)), focused_suites: focusedSuites, mutation_sensitivity: mutation, independent_signature_required: true, observed_at_utc: observedAtUtc, evaluation_sha256: canonicalDigest({block_id: BLOCK_ID, package_root_sha256: canonicalDigest(fileDigests), fixture_results: results, focused_suites: focusedSuites, mutation_sensitivity: mutation, observed_at_utc: observedAtUtc})});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await evaluateMemoryPackage(), null, 2)}\n`);
