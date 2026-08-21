#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";
import {evaluateAccountingRouterBoundary, ACCOUNTING_ROUTER_INPUT_SCHEMA} from "./accounting-router-boundary-gate.mjs";
import {
  evaluateJobCostAccountingBoundary,
  JOB_COST_ACCOUNTING_BLOCK_ID,
  JOB_COST_ACCOUNTING_CONTEXT_RECEIPT_SHA256,
  JOB_COST_ACCOUNTING_CUSTODY_REF,
  JOB_COST_ACCOUNTING_REQUIRED_BLOCKS,
  JOB_COST_ACCOUNTING_ROLLBACK_REF,
  JOB_COST_ACCOUNTING_INPUT_SCHEMA,
} from "./job-cost-accounting-boundary-gate.mjs";

export const JOB_COST_ACCOUNTING_EVALUATION_SCHEMA = "agentos.specialist_job_cost_accounting_package_operational_evaluation.v1";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "specialist-blocks/wave-06/job-cost-accounting";
const BLOCK_ID = JOB_COST_ACCOUNTING_BLOCK_ID;
const MODEL_PATH = "fixtures/model-policy-snapshot.initial.v1.json";
const ROSTER_PATH = "specialist-blocks/registry/agent-roster.v1.json";
const STANDARD_PATH = "specialist-blocks/standards/gao-green-book-2025";
const CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
]);
const GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff", "10-proof-acceptance",
  "11-lifecycle-recovery-archive",
]);
const FLAGS = Object.freeze([
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive", "data_limit",
]);
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message, code = "JOB_COST_ACCOUNTING_EVALUATION_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function readJson(relativePath, label = relativePath) {
  const absolute = path.join(ROOT, relativePath);
  let value;
  try { value = JSON.parse(fs.readFileSync(absolute, "utf8")); } catch (error) { fail(`${label} is unreadable: ${error.message}`, "JOB_COST_ACCOUNTING_ARTIFACT_UNREADABLE"); }
  return value;
}

function fileSha(relativePath) {
  return createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex");
}

function gitRead(args) {
  return execFileSync("git", args, {cwd: ROOT, encoding: "utf8"}).trim();
}

function inventory() {
  const root = path.join(ROOT, PACKAGE);
  const manifest = readJson(`${PACKAGE}/gates/manifest.json`, "Job-Cost gate manifest");
  const files = ["block.json", "sources.lock", "gates/manifest.json", "gates/execution.json", "evaluation.json", "handoff.json"];
  for (const gatePath of manifest.gate_paths ?? []) files.push(gatePath);
  for (const name of fs.readdirSync(path.join(root, "fixtures")).filter((name) => name.endsWith(".json")).sort()) files.push(`fixtures/${name}`);
  return [...new Set(files)].sort().map((relativePath) => ({relative_path: relativePath, sha256: fileSha(`${PACKAGE}/${relativePath}`)}));
}

function findRosterEntry(value) {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value) && value.stable_agent_id === "AGENT.FINANCE_JOB_COST_ACCOUNTING") return value;
  for (const child of Object.values(value)) {
    const found = findRosterEntry(child);
    if (found) return found;
  }
  return null;
}

function accountingRouterInput(candidateDigest) {
  const flags = Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false]));
  return {
    schema: ACCOUNTING_ROUTER_INPUT_SCHEMA,
    version: 1,
    request_kind: "CLASSIFY_ACCOUNTING_SIGNAL",
    evidence: {
      authority_status: "CURRENT", accounting_domain: "JOB_COST", accounting_entity: "TYPED_ENTITY", accounting_objective: "INTERNAL_CONTROL_CLASSIFICATION", accounting_period: "TYPED_PERIOD", accounting_policy: "TYPED_POLICY_REF", accounting_ref: "ref:ACCOUNTING/EXTERNAL/1", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.GAO_GREEN_BOOK_2025", source_version: "2025", candidate_status: "CURRENT_CANDIDATE", candidate_digest: candidateDigest, accounting_signal: "FIN.JOB_COST_ACCOUNTING", signal_status: "BOUND", task_status: "ACCOUNTING_CLASSIFICATION", context_status: "ACCOUNTING_ROUTER_CONTEXT", context_complete: true, requested_action: "CLASSIFY", requested_tools: ["READ_SIGNAL", "READ_SOURCE_LOCK", "READ_ACCOUNTING_CATALOG", "READ_CONTEXT", "READ_PROFESSIONAL_BOUNDARY"], required_block_identities: JOB_COST_ACCOUNTING_REQUIRED_BLOCKS, model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "ACCOUNTING_ROUTER", new_findings: false, project_data_present: false, secret_data_present: false, adversarial_flags: flags,
    },
  };
}

function assertInputBinding(input, authority, label) {
  assert(input && input.schema === JOB_COST_ACCOUNTING_INPUT_SCHEMA && input.version === 1, `${label} does not carry the executable input schema`, "JOB_COST_ACCOUNTING_FIXTURE_INPUT_INVALID");
  const e = input.evidence;
  assert(e.candidate_digest === authority.block_sha256, `${label} candidate digest is not the package block`, "JOB_COST_ACCOUNTING_CANDIDATE_BINDING_INVALID");
  assert(e.source_lock_sha256 === authority.source_lock_sha256 && e.standard_block_sha256 === authority.standard_block_sha256 && e.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256, `${label} source or standard binding is stale`, "JOB_COST_ACCOUNTING_SOURCE_BINDING_INVALID");
  assert(e.context_receipt_sha256 === authority.context_receipt_sha256 && e.context_registry_sha256 === authority.context_registry_sha256, `${label} context receipt is not canonical`, "JOB_COST_ACCOUNTING_CONTEXT_BINDING_INVALID");
  assert(e.model_snapshot_sha256 === authority.model_snapshot_sha256 && e.model_file_sha256 === authority.model_file_sha256 && e.model_route_status === "BOUND", `${label} model-policy snapshot is not bound`, "JOB_COST_ACCOUNTING_MODEL_BINDING_INVALID");
  assert(e.custody_ref === JOB_COST_ACCOUNTING_CUSTODY_REF && e.rollback_ref === JOB_COST_ACCOUNTING_ROLLBACK_REF, `${label} custody or rollback is not canonical`, "JOB_COST_ACCOUNTING_CUSTODY_BINDING_INVALID");
  assert(e.upstream_router_result_sha256 === authority.upstream_router_result_sha256 && e.upstream_router_status === "BOUND", `${label} upstream router receipt is not canonical`, "JOB_COST_ACCOUNTING_UPSTREAM_ROUTER_BINDING_INVALID");
}

function loadAuthority(block, roster) {
  const sourceLockSha = fileSha(`${PACKAGE}/sources.lock`);
  const standard = readJson(`${STANDARD_PATH}/block.json`, "GAO standard block");
  const standardSources = readJson(`${STANDARD_PATH}/sources.lock`, "GAO standard sources");
  const model = readJson(MODEL_PATH, "model policy snapshot");
  const upstream = evaluateAccountingRouterBoundary(accountingRouterInput(block.block_sha256));
  assert(upstream.disposition === "ROUTE" && upstream.route === "ACCOUNTING_ATOMIC_HANDOFF" && upstream.error_code === "ACCOUNTING_ROUTER_ROUTE_READY", "upstream accounting router did not return its typed handoff", "JOB_COST_ACCOUNTING_UPSTREAM_ROUTER_FAILED");
  assert(model.status === "PREPARED_INACTIVE" && model.project_agnostic === true && model.contains_consumer_context === false && model.raw_browsing_transcripts === false, "model policy snapshot is not the prepared project-agnostic snapshot", "JOB_COST_ACCOUNTING_MODEL_POLICY_INVALID");
  const route = model.task_classes?.find((task) => task.task_class === "NARROW_CODING");
  assert(route && route.minimum_capability_score === 49 && JSON.stringify(route.required_capabilities) === JSON.stringify(["CODE", "TOOLS"]), "NARROW_CODING model route is not canonical", "JOB_COST_ACCOUNTING_MODEL_ROUTE_INVALID");
  return Object.freeze({
    block_sha256: block.block_sha256,
    source_lock_sha256: sourceLockSha,
    standard_block_sha256: standard.block_sha256,
    standard_source_manifest_sha256: standard.source_manifest_sha256,
    model_snapshot_sha256: model.snapshot_sha256,
    model_file_sha256: fileSha(MODEL_PATH),
    context_registry_sha256: fileSha(ROSTER_PATH),
    context_receipt_sha256: JOB_COST_ACCOUNTING_CONTEXT_RECEIPT_SHA256,
    upstream_router_result_sha256: upstream.result_sha256,
    upstream_router_file_sha256: fileSha("control/accounting-router-boundary-gate.mjs"),
    model_task_class: route.task_class,
    model_capability_floor: route.minimum_capability_score,
    model_capabilities: route.required_capabilities,
  });
}

function loadFixtures(authority) {
  const directory = path.join(ROOT, PACKAGE, "fixtures");
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  assert(names.length === CLASSES.length, "Job-Cost fixture inventory is incomplete", "JOB_COST_ACCOUNTING_FIXTURE_INVENTORY_INVALID");
  const map = new Map();
  for (const name of names) {
    const fixture = readJson(`${PACKAGE}/fixtures/${name}`, `Job-Cost fixture ${name}`);
    assert(fixture.block_id === BLOCK_ID && fixture.hostile === true && CLASSES.includes(fixture.class), `Job-Cost fixture ${name} identity is invalid`, "JOB_COST_ACCOUNTING_FIXTURE_INVALID");
    assert(fixture.fixture_id === `${BLOCK_ID}.${fixture.class.toUpperCase()}`, `Job-Cost fixture ${name} has no canonical fixture id`, "JOB_COST_ACCOUNTING_FIXTURE_ID_INVALID");
    assert(fixture.vector?.entrypoint === "control/job-cost-accounting-boundary-gate.mjs#evaluateJobCostAccountingBoundary", `Job-Cost fixture ${name} is not bound to the public boundary`, "JOB_COST_ACCOUNTING_FIXTURE_ENTRYPOINT_INVALID");
    assert(fixture.vector.input && fixture.vector.expected_readback && fixture.vector.expected_readback.disposition === fixture.expected, `Job-Cost fixture ${name} has no executable input/readback pair`, "JOB_COST_ACCOUNTING_FIXTURE_VECTOR_INVALID");
    assert(!map.has(fixture.class), `Job-Cost fixture class is duplicated: ${fixture.class}`, "JOB_COST_ACCOUNTING_FIXTURE_ALIAS");
    assertInputBinding(fixture.vector.input, authority, `Job-Cost fixture ${name}`);
    map.set(fixture.class, Object.freeze({fixture, file_sha256: fileSha(`${PACKAGE}/fixtures/${name}`), name}));
  }
  assert([...map.keys()].sort().join("\0") === CLASSES.slice().sort().join("\0"), "Job-Cost fixture classes are incomplete", "JOB_COST_ACCOUNTING_FIXTURE_CLASS_INVENTORY_INVALID");
  return map;
}

function assertResult(actual, expected, label) {
  assert(actual.disposition === expected.disposition && actual.route === expected.route && actual.error_code === expected.error_code, `${label} readback mismatch`, "JOB_COST_ACCOUNTING_HOSTILE_RESULT_FAILED");
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), `${label} observed an external side effect`, "JOB_COST_ACCOUNTING_SIDE_EFFECT");
  assert(actual.acceptance_allowed === false && actual.professional_opinion_allowed === false, `${label} exposed forbidden capability`, "JOB_COST_ACCOUNTING_CAPABILITY_LEAK");
}

function executeFixtures(fixtures) {
  const results = [];
  for (const entry of [...fixtures.values()].sort((a, b) => a.fixture.class.localeCompare(b.fixture.class))) {
    const fixture = entry.fixture;
    const expected = fixture.vector.expected_readback;
    const actual = evaluateJobCostAccountingBoundary(fixture.vector.input);
    assertResult(actual, expected, `Job-Cost fixture ${fixture.class}`);
    results.push({fixture_id: fixture.fixture_id, fixture_class: fixture.class, fixture_file_sha256: entry.file_sha256, entrypoint: fixture.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: true, expected_outcome: expected.disposition, actual_outcome: actual.disposition, expected_route: expected.route, actual_route: actual.route, expected_error_code: expected.error_code, actual_error_code: actual.error_code, external_side_effects: actual.external_side_effects, input_sha256: actual.input_sha256, result_sha256: actual.result_sha256});
  }
  return results;
}

function executeGates(authority, fixtures, manifest, execution) {
  assert(JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(manifest.ordered_gate_ids), "Job-Cost gate execution order differs from the package manifest", "JOB_COST_ACCOUNTING_GATE_EXECUTION_ORDER_INVALID");
  assert(execution.executions.length === GATE_IDS.length && new Set(execution.executions.map((entry) => entry.gate_id)).size === GATE_IDS.length, "Job-Cost gate execution inventory is incomplete", "JOB_COST_ACCOUNTING_GATE_EXECUTION_INVENTORY_INVALID");
  const results = [];
  for (const item of execution.executions) {
    assert(GATE_IDS.includes(item.gate_id), `unknown Job-Cost gate ${item.gate_id}`, "JOB_COST_ACCOUNTING_GATE_ID_INVALID");
    const gate = readJson(`${PACKAGE}/gates/${item.gate_id}.gate`, `Job-Cost gate ${item.gate_id}`);
    assert(gate.gate_id === item.gate_id && gate.status === "EXECUTABLE" && gate.block_id === BLOCK_ID, `Job-Cost gate ${item.gate_id} is not executable`, "JOB_COST_ACCOUNTING_GATE_NOT_EXECUTABLE");
    const fixtureEntry = fixtures.get(item.fixture_class);
    assert(fixtureEntry, `Job-Cost gate ${item.gate_id} is not linked to a fixture`, "JOB_COST_ACCOUNTING_GATE_FIXTURE_MISSING");
    const actual = evaluateJobCostAccountingBoundary(fixtureEntry.fixture.vector.input);
    assertResult(actual, item.expected, `Job-Cost gate ${item.gate_id}`);
    results.push({gate_id: item.gate_id, fixture_class: item.fixture_class, entrypoint: execution.evaluator_entrypoint, expected: item.expected, actual: {disposition: actual.disposition, route: actual.route, error_code: actual.error_code, result_sha256: actual.result_sha256}, side_effects: actual.external_side_effects});
  }
  return results;
}

async function mutationProbe(fixtures) {
  const fixture = fixtures.get("unsafe_action").fixture;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-job-cost-accounting-mutation-"));
  try {
    const control = path.join(temp, "control");
    fs.mkdirSync(control, {recursive: true});
    for (const dependency of ["content-addressing.mjs", "persisted-record-privacy.mjs"]) fs.copyFileSync(path.join(ROOT, "control", dependency), path.join(control, dependency));
    const target = path.join(control, "job-cost-accounting-boundary-gate.mjs");
    const source = fs.readFileSync(path.join(ROOT, "control/job-cost-accounting-boundary-gate.mjs"), "utf8");
    const anchor = 'if (f.unsafe_action) return result("DENY", "NO_JOB_COST_SIDE_EFFECT", "JOB_COST_ACCOUNTING_OPERATION_FORBIDDEN", input);';
    assert(source.includes(anchor), "Job-Cost mutation anchor is missing", "JOB_COST_ACCOUNTING_MUTATION_ANCHOR_MISSING");
    const mutated = source.replace(anchor, 'if (f.unsafe_action) return result("ROUTE", "JOB_COST_ACCOUNTING_ATOMIC_HANDOFF", "MUTATED_UNSAFE_OPERATION_ALLOWED", input, {routing_allowed: true});');
    fs.writeFileSync(target, mutated, {flag: "wx"});
    const module = await import(`${pathToFileURL(target).href}?mutation=${Date.now()}`);
    const actual = module.evaluateJobCostAccountingBoundary(fixture.vector.input);
    const mutationDetected = actual.disposition === "ROUTE";
    assert(mutationDetected, "Job-Cost mutation did not weaken the unsafe-action guard", "JOB_COST_ACCOUNTING_MUTATION_PROOF_MISSING");
    return {status: "INTACT", mutation_detected: mutationDetected, expected_disposition: "DENY", observed_disposition: actual.disposition, observed_route: actual.route, observed_error_code: actual.error_code};
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
}

function privacyProbe(fixtures) {
  const input = JSON.parse(JSON.stringify(fixtures.get("routing").fixture.vector.input));
  input.evidence.accounting_policy = "password=not-redacted";
  try {
    evaluateJobCostAccountingBoundary(input);
    fail("privacy probe unexpectedly completed", "JOB_COST_ACCOUNTING_PRIVACY_PROBE_FAILED");
  } catch (error) {
    assert(error.code === "JOB_COST_ACCOUNTING_PRIVACY_DENIED", `privacy probe returned ${error.code ?? "an untyped error"}`, "JOB_COST_ACCOUNTING_PRIVACY_PROBE_FAILED");
    return {status: "REJECTED", secret_rejected: true, error_code: error.code};
  }
}

function globalAuthorityDefects(roster, fixtures, manifest) {
  const defects = [];
  const entry = findRosterEntry(roster);
  if (!entry) return [{severity: "BLOCKER", code: "SPAWNER_GLOBAL_ROSTER_ENTRY_MISSING", evidence: "AGENT.FINANCE_JOB_COST_ACCOUNTING was not found in the read-only canonical roster", owning_layer: "Spawner/global authority", repair_route: "Provision the canonical evaluator handoff and regenerate the roster binding", residual_ceiling: "No admission or activation"}];
  const rosterFixtures = entry.hostile_fixtures?.fixtures ?? [];
  const currentFixtureMismatches = [];
  for (const fixture of fixtures.values()) {
    const pathName = `${PACKAGE}/fixtures/${fixture.name}`;
    const bound = rosterFixtures.find((candidate) => candidate.path === pathName);
    if (!bound || bound.file_sha256 !== fixture.file_sha256) currentFixtureMismatches.push({path: pathName, expected_roster_sha256: bound?.file_sha256 ?? null, actual_sha256: fixture.file_sha256});
  }
  if (currentFixtureMismatches.length > 0) defects.push({severity: "BLOCKER", code: "SPAWNER_GLOBAL_ROSTER_PROVENANCE_STALE", evidence: {fixture_mismatches: currentFixtureMismatches, manifest_sha256: fileSha(`${PACKAGE}/gates/manifest.json`)}, owning_layer: "Spawner/global authority", repair_route: "After independent signer provisioning, regenerate only the canonical roster provenance for this package and rerun Spawner admission", residual_ceiling: "Local package PASS only; no admission, activation, merge, publication, or deployment"});
  if (entry.model_route?.task_class !== "NARROW_CODING" || entry.model_route?.minimum_capability !== 49) defects.push({severity: "BLOCKER", code: "SPAWNER_GLOBAL_MODEL_ROUTE_DRIFT", evidence: entry.model_route ?? null, owning_layer: "Spawner/global authority", repair_route: "Rebind the roster model route to the pinned NARROW_CODING snapshot", residual_ceiling: "No model admission"});
  const manifestDigest = canonicalDigest({...manifest, manifest_sha256: null});
  if (manifest.manifest_sha256 !== manifestDigest) defects.push({severity: "BLOCKER", code: "SPAWNER_GLOBAL_GATE_MANIFEST_PROVENANCE_STALE", evidence: {declared: manifest.manifest_sha256, actual: manifestDigest}, owning_layer: "Spawner/global authority", repair_route: "Regenerate the package gate-manifest provenance through the signer", residual_ceiling: "No admission"});
  return defects;
}

export async function evaluateJobCostAccountingPackage() {
  const root = path.join(ROOT, PACKAGE);
  const block = readJson(`${PACKAGE}/block.json`, "Job-Cost block");
  assert(block.block_id === BLOCK_ID && block.lifecycle === "CANDIDATE" && block.activation === "OFF", "Job-Cost package state is not inert candidate state", "JOB_COST_ACCOUNTING_PACKAGE_STATE_INVALID");
  assert(SHA256.test(block.block_sha256), "Job-Cost block digest is invalid", "JOB_COST_ACCOUNTING_BLOCK_DIGEST_INVALID");
  const manifest = readJson(`${PACKAGE}/gates/manifest.json`, "Job-Cost gate manifest");
  assert(manifest.block_id === BLOCK_ID && JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(GATE_IDS), "Job-Cost gate manifest is not the exact 12-gate pack", "JOB_COST_ACCOUNTING_GATE_MANIFEST_INVALID");
  const execution = readJson(`${PACKAGE}/gates/execution.json`, "Job-Cost gate execution manifest");
  assert(execution.schema === "agentos.job_cost_accounting_gate_execution.v1" && execution.version === 1 && execution.block_id === BLOCK_ID, "Job-Cost gate execution manifest is invalid", "JOB_COST_ACCOUNTING_GATE_EXECUTION_INVALID");
  const files = inventory();
  assert(files.filter((file) => file.relative_path.startsWith("gates/") && file.relative_path.endsWith(".gate")).length === 12, "Job-Cost gate inventory is incomplete", "JOB_COST_ACCOUNTING_GATE_INVENTORY_INVALID");
  const commit = gitRead(["rev-parse", "HEAD^{commit}"]);
  const tree = gitRead(["rev-parse", "HEAD^{tree}"]);
  const status = gitRead(["status", "--porcelain"]);
  assert(status === "", "Job-Cost review candidate is not clean and immutable", "JOB_COST_ACCOUNTING_CANDIDATE_NOT_CLEAN");
  const authority = loadAuthority(block, readJson(ROSTER_PATH, "canonical agent roster"));
  const fixtures = loadFixtures(authority);
  const fixtureResults = executeFixtures(fixtures);
  const gateExecutions = executeGates(authority, fixtures, manifest, execution);
  const mutation = await mutationProbe(fixtures);
  const privacy = privacyProbe(fixtures);
  const packageRootSha256 = canonicalDigest(files);
  const gateInventorySha256 = canonicalDigest(files.filter((file) => file.relative_path.startsWith("gates/")));
  const fixtureInventorySha256 = canonicalDigest(files.filter((file) => file.relative_path.startsWith("fixtures/")));
  const roster = readJson(ROSTER_PATH, "canonical agent roster");
  const globalDefects = globalAuthorityDefects(roster, fixtures, manifest);
  const evaluation = {
    schema: JOB_COST_ACCOUNTING_EVALUATION_SCHEMA,
    version: 1,
    status: "PASS",
    local_operational_status: "PASS",
    admission_ceiling: "BLOCKED_EXACT",
    block_id: BLOCK_ID,
    lifecycle: "CANDIDATE",
    activation: "OFF",
    review_binding: {
      candidate_commit: commit,
      candidate_tree: tree,
      clean: true,
      package_root: PACKAGE,
      package_root_sha256: packageRootSha256,
      package_block_sha256: block.block_sha256,
      gate_inventory_sha256: gateInventorySha256,
      fixture_inventory_sha256: fixtureInventorySha256,
      gates: {count: GATE_IDS.length, ordered_gate_ids: GATE_IDS, execution_entrypoint: execution.evaluator_entrypoint},
      fixtures: {count: CLASSES.length, actual_entrypoint: "control/job-cost-accounting-boundary-gate.mjs#evaluateJobCostAccountingBoundary"},
      model_policy: {file: MODEL_PATH, file_sha256: authority.model_file_sha256, snapshot_sha256: authority.model_snapshot_sha256, status: "PREPARED_INACTIVE", task_class: authority.model_task_class, capability_floor: authority.model_capability_floor, capabilities: authority.model_capabilities},
      context: {registry_file: ROSTER_PATH, registry_sha256: authority.context_registry_sha256, receipt_sha256: authority.context_receipt_sha256, source_lock_sha256: authority.source_lock_sha256, standard_block_sha256: authority.standard_block_sha256, standard_source_manifest_sha256: authority.standard_source_manifest_sha256, upstream_router_result_sha256: authority.upstream_router_result_sha256},
      custody_ref: JOB_COST_ACCOUNTING_CUSTODY_REF,
      rollback: {base_commit: commit, rollback_ref: JOB_COST_ACCOUNTING_ROLLBACK_REF, merge_into_lane_only: true, publication: false, deployment: false, promotion: false},
    },
    gate_executions: gateExecutions,
    fixture_results: fixtureResults,
    mutation_sensitivity: mutation,
    privacy_probe: privacy,
    global_authority_defects: globalDefects,
    spawner_receipt: {
      status: "BLOCKED_EXACT",
      prepare_code: "CANONICAL_EVALUATOR_HANDOFF_REQUIRED",
      prepare_message: "Separately controlled evaluator handoff is not available for the current candidate",
      resolve_code: "SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED",
      resolve_message: "external reviewer authority is not provisioned",
      authority_binding_sha256: "efb15125644f96c04b6c0029a7374da4f713fa92ef55acadb7df8bbd4e6f9bed",
      authority_sha256: "0be1ba4cba9b1e7ccbdddaed3036dd29f705917a3e8c3924364c0f35aee659ee",
      promotion: false,
    },
    independent_signature_required: true,
    residuals: ["professional accounting and regulated applicability remain external", "global roster provenance is not rewritten by this lane", "candidate remains not admitted and activation remains OFF", "independent utility/harm evaluation remains external to this deterministic package evaluator"],
    observed_at_utc: new Date().toISOString(),
    evaluation_sha256: null,
  };
  evaluation.evaluation_sha256 = canonicalDigest({...evaluation, evaluation_sha256: null});
  return Object.freeze(evaluation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.stdout.write(`${JSON.stringify(await evaluateJobCostAccountingPackage(), null, 2)}\n`);
