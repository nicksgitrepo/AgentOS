#!/usr/bin/env node

/*
 * Repository-owned authority resolver for the Test Architecture specialist.
 * Every public boundary claim is checked against canonical bytes here.  The
 * resolver intentionally reads the acceptance index only to prove that this
 * candidate has not self-admitted; it never creates or upgrades a receipt.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateAssuranceEnterpriseRouterBoundary} from "./assurance-enterprise-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const TEST_ARCHITECT_PACKAGE_PATH = "specialist-blocks/wave-04/test-architect";
export const TEST_ARCHITECT_BLOCK_ID = "specialist.assurance-enterprise.test-architect";
export const TEST_ARCHITECT_STANDARD_BLOCK_ID = "specialist.standard.nist-ssdf";
export const TEST_ARCHITECT_STANDARD_ID = "source.nist-sp-800-218";
export const TEST_ARCHITECT_ROUTER_BLOCK_ID = "specialist.assurance-enterprise.router";
export const TEST_ARCHITECT_CUSTODY_REF = "opaque:TEST_ARCHITECT.CUSTODY";
export const TEST_ARCHITECT_MODEL_TASK_CLASS = "DETERMINISTIC_QA";
export const TEST_ARCHITECT_MODEL_CAPABILITY_FLOOR = 45;
export const TEST_ARCHITECT_MODEL_CAPABILITIES = Object.freeze(["TEXT", "TOOLS"]);
export const TEST_ARCHITECT_MODEL_SNAPSHOT_SHA256 = "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27";
export const TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256 = Object.freeze({
  block: "76b22ae746e06b00508f6c54d25994b85be48c8b4c4e13501ebbfeb4ac0523c8",
  source_lock: "7e72cbbee7b73fc4d82af4d6a295b62cd7b45afcd966e062f5d2b34e92749655",
  gate_manifest: "78a7e67b3ad7c98426e7dca185b084129f44576be97156e8953e492744892c0f",
  gate_execution: "b699aa6f475c585a768c7951b7ce13ee0fb7de592d08d252d506e1b85dbf4154",
  context_binding: "8793e19413088cdb8cfc827e553eac5edf2416582ec2bf93405d6566adab9544",
  invalidation: "c859900ac9215a8b3427fdfbe5bf50238aeae66a47a3f35c29d281b5f0fb6f69",
  evaluation: "adb4278d2591b8932448e2d1496d5489e58bc6f415b7bd0c6ab3d7c88947dfac",
  handoff: "969a6303b9bd5b5354735065314370728267093d41b1bb0468047f1578dc1217",
  model_snapshot: "203d555399fb84345cede6f122fff3568272a9dda27a350ff04d7387084b392d",
});
export const TEST_ARCHITECT_ROSTER_FILE_SHA256 = "98aa86f50a8adda4bbca5ab10a93dc2326793faaeea610c11d1e0293da902b78";
export const TEST_ARCHITECT_UPSTREAM_ROUTER_FILE_SHA256 = "280e5954262a19d3457bb64bc48d36a088a2657dd0fc3c9d1621276e81a3bf0c";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, TEST_ARCHITECT_PACKAGE_PATH);
const ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const ACCEPTANCE_LEDGER_PATH = path.join(ROOT, "specialist-blocks/registry/accepted-agent-receipts.v1.json");
const MODEL_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const STANDARD_PATH = path.join(ROOT, "specialist-blocks/standards/nist-ssdf/block.json");
const STANDARD_SOURCES_PATH = path.join(ROOT, "specialist-blocks/standards/nist-ssdf/sources.lock");
const UPSTREAM_ROUTER_PATH = path.join(ROOT, "control/assurance-enterprise-router-boundary-gate.mjs");
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
const FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
]);
const REQUIRED_CONTEXT = Object.freeze([
  "authority", "candidate.identity", "custody", "request", "signals", "source_lock",
  "test.evidence", "test.scope", "test.strategy",
]);
const MEMORY_AUTHORITY = "GLOBAL_GOVERNANCE_MEMORY";

function fail(message, code = "TEST_ARCHITECT_CANONICAL_AUTHORITY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function fileSha(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function body(value, field) { const copy = structuredClone(value); copy[field] = null; return copy; }
function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "TEST_ARCHITECT_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical file`, "TEST_ARCHITECT_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "TEST_ARCHITECT_CANONICAL_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}
function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "TEST_ARCHITECT_CANONICAL_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "TEST_ARCHITECT_CANONICAL_SCHEMA_INVALID");
}
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a real SHA-256`, "TEST_ARCHITECT_CANONICAL_DIGEST_INVALID"); }
function validDate(value, label, nowMs) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "TEST_ARCHITECT_SOURCE_DATE_INVALID");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  assert(time <= nowMs, `${label} is future-dated`, "TEST_ARCHITECT_SOURCE_FUTURE");
  return time;
}
function freshDate(value, label, nowMs, maxAgeDays = 31) { const time = validDate(value, label, nowMs); assert(nowMs - time <= maxAgeDays * 86_400_000, `${label} is stale`, "TEST_ARCHITECT_SOURCE_STALE"); return time; }
function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.block_id === expectedId && block.schema === "agentos.specialist_block.v1" && block.lifecycle === "CANDIDATE" && block.activation === "OFF", `${label} identity or lifecycle differs`, "TEST_ARCHITECT_CANONICAL_BINDING_INVALID");
  sha(block.block_sha256, `${label} digest`);
  assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), `${label} digest does not match its bytes`, "TEST_ARCHITECT_CANONICAL_DIGEST_INVALID");
  return block;
}
function expectedGateNext(index, outcome) {
  if (outcome === "NO") return "OUTCOME:DENY";
  if (outcome === "UNKNOWN") return "OUTCOME:UNKNOWN_DEPENDENT_ONLY";
  if (index === GATE_IDS.length - 1) return "OUTCOME:ROUTE";
  return GATE_IDS[index + 1];
}
function checkGateSemantics(gates, manifest) {
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.block_id === TEST_ARCHITECT_BLOCK_ID, "Test Architecture gate manifest identity differs", "TEST_ARCHITECT_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(GATE_IDS), "Test Architecture gate order differs", "TEST_ARCHITECT_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(GATE_IDS.map((id) => `gates/${id}.gate`)), "Test Architecture gate paths differ", "TEST_ARCHITECT_GATE_SEMANTICS_INVALID");
  const expectedRules = {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"};
  const semantic = [];
  gates.forEach((gate, index) => {
    exactKeys(gate, ["schema", "version", "gate_id", "block_id", "status", "answer_type", "allowed_outcomes", "question", "evidence", "next", "rules", "gate_sha256"], `Test Architecture gate ${gate.gate_id}`);
    assert(gate.schema === "agentos.specialist_gate.v1" && gate.gate_id === GATE_IDS[index] && gate.block_id === TEST_ARCHITECT_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Test Architecture gate ${gate.gate_id} identity differs`, "TEST_ARCHITECT_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `Test Architecture gate ${gate.gate_id} outcomes differ`, "TEST_ARCHITECT_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.rules) === JSON.stringify(expectedRules), `Test Architecture gate ${gate.gate_id} rules differ`, "TEST_ARCHITECT_GATE_SEMANTICS_INVALID");
    for (const outcome of ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]) assert(gate.next?.[outcome] === expectedGateNext(index, outcome), `Test Architecture gate ${gate.gate_id} branch differs for ${outcome}`, "TEST_ARCHITECT_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `Test Architecture gate ${gate.gate_id}`);
    assert(gate.gate_sha256 === canonicalDigest(body(gate, "gate_sha256")), `Test Architecture gate ${gate.gate_id} digest differs`, "TEST_ARCHITECT_GATE_DIGEST_INVALID");
    semantic.push({gate_id: gate.gate_id, gate_sha256: gate.gate_sha256, next: gate.next, rules: gate.rules, evidence: gate.evidence});
  });
  return canonicalDigest(semantic);
}
function checkContextBinding(artifact, block) {
  const value = artifact.value;
  exactKeys(value, ["schema", "version", "block_id", "context_schema", "required_context", "memory_authority", "memory_mode", "memory_write", "source_lock_path", "model_policy_path", "upstream_router_block_id", "binding_sha256"], "Test Architecture context binding");
  assert(value.schema === "agentos.specialist_context_binding.v1" && value.version === 1 && value.block_id === block.block_id && value.context_schema === "schemas/specialist-context.v1.json", "Test Architecture context binding identity differs", "TEST_ARCHITECT_CONTEXT_BINDING_INVALID");
  assert(JSON.stringify(value.required_context) === JSON.stringify(REQUIRED_CONTEXT), "Test Architecture required context differs", "TEST_ARCHITECT_CONTEXT_BINDING_INVALID");
  assert(value.memory_authority === MEMORY_AUTHORITY && value.memory_mode === "READ_ONLY_BOUND_PROJECTION" && value.memory_write === "DENY", "Test Architecture memory custody is not read-only", "TEST_ARCHITECT_MEMORY_CUSTODY_INVALID");
  assert(value.source_lock_path === `${TEST_ARCHITECT_PACKAGE_PATH}/sources.lock` && value.model_policy_path === "fixtures/model-policy-snapshot.initial.v1.json" && value.upstream_router_block_id === TEST_ARCHITECT_ROUTER_BLOCK_ID, "Test Architecture context dependencies differ", "TEST_ARCHITECT_CONTEXT_BINDING_INVALID");
  sha(value.binding_sha256, "Test Architecture context binding digest");
  assert(value.binding_sha256 === canonicalDigest(body(value, "binding_sha256")), "Test Architecture context binding digest differs", "TEST_ARCHITECT_CONTEXT_BINDING_INVALID");
  return value;
}
function checkInvalidation(artifact, block) {
  const value = artifact.value;
  exactKeys(value, ["schema", "version", "block_id", "rules", "rebuild_action", "invalidation_sha256"], "Test Architecture invalidation contract");
  assert(value.schema === "agentos.specialist_invalidation.v1" && value.version === 1 && value.block_id === block.block_id && value.rebuild_action === "INVALIDATE_DEPENDENTS_REBUILD_AND_REQUALIFY", "Test Architecture invalidation contract identity differs", "TEST_ARCHITECT_INVALIDATION_INVALID");
  assert(Array.isArray(value.rules) && value.rules.length === 8, "Test Architecture invalidation coverage is incomplete", "TEST_ARCHITECT_INVALIDATION_INVALID");
  const ids = value.rules.map((rule) => rule.rule_id);
  assert(JSON.stringify([...ids].sort(compareUtf8)) === JSON.stringify(ids) && new Set(ids).size === ids.length, "Test Architecture invalidation rule order is not deterministic", "TEST_ARCHITECT_INVALIDATION_INVALID");
  for (const rule of value.rules) {
    exactKeys(rule, ["rule_id", "trigger", "affected", "action"], `Test Architecture invalidation ${rule.rule_id}`);
    assert(typeof rule.rule_id === "string" && typeof rule.trigger === "string" && Array.isArray(rule.affected) && rule.affected.length > 0 && rule.action === "INVALIDATE_AND_REBUILD", `Test Architecture invalidation ${rule.rule_id} is incomplete`, "TEST_ARCHITECT_INVALIDATION_INVALID");
  }
  sha(value.invalidation_sha256, "Test Architecture invalidation digest");
  assert(value.invalidation_sha256 === canonicalDigest(body(value, "invalidation_sha256")), "Test Architecture invalidation digest differs", "TEST_ARCHITECT_INVALIDATION_INVALID");
  return value;
}
function canonicalRouterResult(candidateDigest) {
  const input = {
    schema: "agentos.assurance_enterprise_router_boundary_input.v1", version: 1, request_kind: "ROUTE_ASSURANCE_HANDOFF", evidence: {
      authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.ASSURANCE_ENTERPRISE_ROUTER", custody_ref: "ref:ASSURANCE_ROUTER/BOUND", source_status: "CURRENT", source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: "1", candidate_identity: "CANDIDATE.AGENTOS.TEST_ARCHITECT", candidate_digest: candidateDigest, candidate_status: "CURRENT_CANDIDATE", assurance_signal: "QA.TEST_ARCHITECT", signal_status: "BOUND", atomic_scope: "NARROW_ASSURANCE_CLASSIFICATION", atomic_candidates: ["AGENT.ASSURANCE_ENTERPRISE_TEST_ARCHITECT"], context_status: "ROUTER_CONTEXT", requested_action: "ROUTE", signals: ["QA.TEST_ARCHITECT", "TEST_ARCHITECTURE"], context_complete: true, handoff_ref: "ref:HANDOFF/TEST_ARCHITECT", model_policy_status: "CURRENT", model_task_class: "DETERMINISTIC_QA", model_route_status: "BOUND", required_block_identities: ["SPECIALIST.FOUNDATION.ROLE_INTAKE_CLASSIFIER", "SPECIALIST.FOUNDATION.SCOPE_NON_GOAL_GATE"], requested_tools: ["READ_CONTEXT"], authority_scope: "NARROW_ASSURANCE_ROUTING", sibling_authorities: ["ASSURANCE_ROUTER"], self_acceptance: false, scope_expanded: false, authority_conflict: false, project_data_present: false, secret_data_present: false, unbound_receipt: false, unreviewed_gate: false, unknown_context: false,
    },
  };
  const result = evaluateAssuranceEnterpriseRouterBoundary(input);
  assert(result.disposition === "ROUTE" && result.route === "ASSURANCE_ATOMIC_HANDOFF" && result.routing_allowed === true, "Canonical upstream assurance router did not produce a route", "TEST_ARCHITECT_UPSTREAM_ROUTER_INVALID");
  return result;
}

export function resolveTestArchitectCanonicalAuthority() {
  const nowMs = Date.now();
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "Test Architecture block");
  const block = checkBlock(blockArtifact, TEST_ARCHITECT_BLOCK_ID, "Test Architecture block");
  assert(blockArtifact.file_sha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.block, "Test Architecture block is not the pinned candidate", "TEST_ARCHITECT_CANONICAL_PROVENANCE_INVALID");
  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "Test Architecture source lock");
  const source = sourceArtifact.value;
  assert(sourceArtifact.file_sha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.source_lock && source.schema === "agentos.specialist_source_manifest.v1" && source.block_id === TEST_ARCHITECT_BLOCK_ID && source.manifest_sha256 === canonicalDigest(body(source, "manifest_sha256")), "Test Architecture source lock is not canonical", "TEST_ARCHITECT_SOURCE_LOCK_INVALID");
  const atomic = source.sources?.find((entry) => entry.source_id === "source.atomic-specialization-law");
  const sre = source.sources?.find((entry) => entry.source_id === "source.google-sre-testing-reliability");
  const nist = source.sources?.find((entry) => entry.source_id === TEST_ARCHITECT_STANDARD_ID);
  assert(atomic?.immutable_identity === "agentos-atomic-specialization-law-v1" && atomic.authority_class === "AGENTOS_PORTABLE", "Atomic source identity is not canonical", "TEST_ARCHITECT_SOURCE_IDENTITY_INVALID");
  assert(sre?.immutable_identity === "google-sre-testing-reliability-current-2026-08-11" && sre.authority_class === "PRIMARY_DESCRIPTIVE", "Google SRE source identity is not canonical", "TEST_ARCHITECT_SOURCE_IDENTITY_INVALID");
  assert(nist?.immutable_identity === "nist-sp-800-218-v1.1-final-20220203" && nist.authority_class === "PRIMARY_NORMATIVE", "NIST source identity is not canonical", "TEST_ARCHITECT_SOURCE_IDENTITY_INVALID");
  for (const entry of [atomic, sre, nist]) freshDate(entry.retrieved_date, `${entry.source_id} retrieved date`, nowMs); validDate(nist.effective_date, "NIST source effective date", nowMs);

  const standardArtifact = readJson(STANDARD_PATH, "NIST SSDF standard block");
  const standard = checkBlock(standardArtifact, TEST_ARCHITECT_STANDARD_BLOCK_ID, "NIST SSDF standard block");
  const standardSourcesArtifact = readJson(STANDARD_SOURCES_PATH, "NIST SSDF source manifest");
  const standardSources = standardSourcesArtifact.value;
  sha(standardSources.manifest_sha256, "NIST SSDF source manifest");
  assert(standardSources.manifest_sha256 === canonicalDigest(body(standardSources, "manifest_sha256")) && standard.block_sha256 === "8475acafc2aab24903deae55734967f5a8098919276fc023b7d50b3257c35bbb" && standardSources.manifest_sha256 === "b35cde6aef0781b771035ed41490b885f1f060ea6df96b5f532207e6bffc56fa", "NIST SSDF standard binding is not canonical", "TEST_ARCHITECT_STANDARD_BINDING_INVALID");

  const manifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "Test Architecture gate manifest");
  const manifest = manifestArtifact.value; sha(manifest.manifest_sha256, "Test Architecture gate manifest");
  assert(manifestArtifact.file_sha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.gate_manifest && manifest.manifest_sha256 === canonicalDigest(body(manifest, "manifest_sha256")), "Test Architecture gate manifest is not canonical", "TEST_ARCHITECT_GATE_MANIFEST_INVALID");
  const gates = GATE_IDS.map((gateId) => readJson(path.join(PACKAGE, "gates", `${gateId}.gate`), `Test Architecture gate ${gateId}`).value);
  const gateSemanticInventorySha256 = checkGateSemantics(gates, manifest);
  const executionArtifact = readJson(path.join(PACKAGE, "gates/execution.json"), "Test Architecture gate execution");
  assert(executionArtifact.file_sha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.gate_execution, "Test Architecture gate execution is not canonical", "TEST_ARCHITECT_GATE_EXECUTION_PROVENANCE_INVALID");

  const contextArtifact = readJson(path.join(PACKAGE, "context-binding.json"), "Test Architecture context binding");
  const contextBinding = checkContextBinding(contextArtifact, block);
  assert(contextArtifact.file_sha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.context_binding, "Test Architecture context binding is not canonical", "TEST_ARCHITECT_CONTEXT_PROVENANCE_INVALID");
  const invalidationArtifact = readJson(path.join(PACKAGE, "invalidation.json"), "Test Architecture invalidation");
  const invalidation = checkInvalidation(invalidationArtifact, block);
  assert(invalidationArtifact.file_sha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.invalidation, "Test Architecture invalidation is not canonical", "TEST_ARCHITECT_INVALIDATION_PROVENANCE_INVALID");

  const rosterArtifact = readJson(ROSTER_PATH, "Reusable-agent roster");
  assert(rosterArtifact.file_sha256 === TEST_ARCHITECT_ROSTER_FILE_SHA256, "Reusable-agent roster is not canonical", "TEST_ARCHITECT_ROSTER_PROVENANCE_INVALID");
  const roster = rosterArtifact.value;
  assert(roster.schema === "agentos.reusable_agent_roster.v1" && roster.roster_sha256 === canonicalDigest(body(roster, "roster_sha256")), "Reusable-agent roster digest is invalid", "TEST_ARCHITECT_ROSTER_INVALID");
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === "AGENT.ASSURANCE_ENTERPRISE_TEST_ARCHITECT");
  assert(entry && entry.canonical_block_id === TEST_ARCHITECT_BLOCK_ID && entry.package_path === TEST_ARCHITECT_PACKAGE_PATH && entry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION", "Test Architecture roster binding is missing or admitted", "TEST_ARCHITECT_ROSTER_BINDING_INVALID");
  assert(entry.model_route?.task_class === TEST_ARCHITECT_MODEL_TASK_CLASS && entry.model_route.minimum_capability === TEST_ARCHITECT_MODEL_CAPABILITY_FLOOR && JSON.stringify(entry.model_route.required_capabilities) === JSON.stringify(TEST_ARCHITECT_MODEL_CAPABILITIES) && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "Test Architecture model route is not canonical", "TEST_ARCHITECT_MODEL_ROUTE_INVALID");
  assert(entry.deterministic_gates?.status === "BOUND" && entry.deterministic_gates.gates.length === GATE_IDS.length, "Test Architecture roster gate provenance is incomplete", "TEST_ARCHITECT_ROSTER_GATE_PROVENANCE_INVALID");
  for (let i = 0; i < GATE_IDS.length; i += 1) { const file = path.join(PACKAGE, "gates", `${GATE_IDS[i]}.gate`); assert(entry.deterministic_gates.gates[i].gate_id === GATE_IDS[i] && entry.deterministic_gates.gates[i].path === `${TEST_ARCHITECT_PACKAGE_PATH}/gates/${GATE_IDS[i]}.gate` && entry.deterministic_gates.gates[i].file_sha256 === fileSha(file), `Test Architecture roster gate ${GATE_IDS[i]} is stale`, "TEST_ARCHITECT_GATE_PROVENANCE_INVALID"); }
  const fixtureNames = fs.readdirSync(path.join(PACKAGE, "fixtures")).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(fixtureNames.length === FIXTURE_CLASSES.length && JSON.stringify(fixtureNames.map((name) => name.slice(0, -5)).sort(compareUtf8)) === JSON.stringify([...FIXTURE_CLASSES].sort(compareUtf8)), "Test Architecture fixture inventory is incomplete", "TEST_ARCHITECT_FIXTURE_INVENTORY_INVALID");
  assert(entry.hostile_fixtures?.status === "BOUND" && entry.hostile_fixtures.fixtures.length === FIXTURE_CLASSES.length, "Test Architecture roster fixture provenance is incomplete", "TEST_ARCHITECT_ROSTER_FIXTURE_PROVENANCE_INVALID");
  const fixtures = fixtureNames.map((name) => { const artifact = readJson(path.join(PACKAGE, "fixtures", name), `Test Architecture fixture ${name}`); const fixture = artifact.value; const rosterFixture = entry.hostile_fixtures.fixtures.find((candidate) => candidate.path === `${TEST_ARCHITECT_PACKAGE_PATH}/fixtures/${name}`); assert(rosterFixture && rosterFixture.fixture_id === fixture.fixture_id && rosterFixture.file_sha256 === artifact.file_sha256 && rosterFixture.expected_outcome === fixture.expected.disposition, `Test Architecture fixture ${name} is stale in the roster`, "TEST_ARCHITECT_FIXTURE_PROVENANCE_INVALID"); return Object.freeze({fixture_id: fixture.fixture_id, class: fixture.class, file_sha256: artifact.file_sha256, expected: fixture.expected}); });
  const handoffArtifact = readJson(path.join(PACKAGE, "handoff.json"), "Test Architecture handoff");
  assert(handoffArtifact.file_sha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.handoff && entry.required_evidence_handoff?.handoff_path === `${TEST_ARCHITECT_PACKAGE_PATH}/handoff.json` && entry.required_evidence_handoff.handoff_file_sha256 === handoffArtifact.file_sha256, "Test Architecture handoff provenance is stale", "TEST_ARCHITECT_HANDOFF_PROVENANCE_INVALID");

  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot");
  assert(modelArtifact.file_sha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.model_snapshot, "Global model-policy snapshot file is not canonical", "TEST_ARCHITECT_MODEL_POLICY_PROVENANCE_INVALID");
  const model = modelArtifact.value; assert(model.status === "PREPARED_INACTIVE" && model.snapshot_sha256 === TEST_ARCHITECT_MODEL_SNAPSHOT_SHA256, "Global model-policy snapshot status or digest differs", "TEST_ARCHITECT_MODEL_POLICY_PROVENANCE_INVALID"); validateModelPolicySnapshot(model, {requireActive: false});
  const task = model.task_classes?.find((candidate) => candidate.task_class === TEST_ARCHITECT_MODEL_TASK_CLASS);
  assert(task && task.minimum_capability_score === TEST_ARCHITECT_MODEL_CAPABILITY_FLOOR && JSON.stringify(task.required_capabilities) === JSON.stringify(TEST_ARCHITECT_MODEL_CAPABILITIES) && JSON.stringify(task.preferred_models) === JSON.stringify(["gpt-5.6-luna"]) && JSON.stringify(task.fallback_models) === JSON.stringify(["gpt-5.6-terra", "gpt-5.6-sol"]), "DETERMINISTIC_QA model route semantics are not canonical", "TEST_ARCHITECT_MODEL_ROUTE_SEMANTICS_INVALID");
  const modelRoute = Object.freeze({task_class: entry.model_route.task_class, minimum_capability: entry.model_route.minimum_capability, required_capabilities: Object.freeze([...entry.model_route.required_capabilities]), route_source: entry.model_route.route_source, snapshot_sha256: model.snapshot_sha256, snapshot_status: model.status, model_file_sha256: modelArtifact.file_sha256});
  const modelRouteSha256 = canonicalDigest(modelRoute);
  const routerFileSha256 = fileSha(UPSTREAM_ROUTER_PATH);
  assert(routerFileSha256 === TEST_ARCHITECT_UPSTREAM_ROUTER_FILE_SHA256, "Assurance-enterprise router source is not canonical", "TEST_ARCHITECT_UPSTREAM_ROUTER_PROVENANCE_INVALID");
  const routerResult = canonicalRouterResult(block.block_sha256);
  const contextSha256 = canonicalDigest({block_sha256: block.block_sha256, source_manifest_sha256: source.manifest_sha256, standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSources.manifest_sha256, gate_manifest_sha256: manifest.manifest_sha256, gate_semantic_inventory_sha256: gateSemanticInventorySha256, model_route_sha256: modelRouteSha256, router_file_sha256: routerFileSha256, router_result_sha256: routerResult.result_sha256, context_binding_sha256: contextBinding.binding_sha256, invalidation_sha256: invalidation.invalidation_sha256, memory_authority: contextBinding.memory_authority, memory_mode: contextBinding.memory_mode, memory_write: contextBinding.memory_write, required_context: REQUIRED_CONTEXT});
  const acceptanceArtifact = readJson(ACCEPTANCE_LEDGER_PATH, "Reusable-agent acceptance ledger"); const acceptanceLedger = acceptanceArtifact.value;
  assert(acceptanceLedger.schema === "agentos.reusable_agent_acceptance_ledger.v1" && acceptanceLedger.status === "READ_ONLY_INDEPENDENT_EVALUATION_INDEX" && acceptanceLedger.project_agnostic === true && acceptanceLedger.ledger_sha256 === canonicalDigest(body(acceptanceLedger, "ledger_sha256")), "Acceptance ledger identity is invalid", "TEST_ARCHITECT_ACCEPTANCE_LEDGER_INVALID");
  assert(!acceptanceLedger.entries?.some((candidate) => candidate.stable_agent_id === "AGENT.ASSURANCE_ENTERPRISE_TEST_ARCHITECT"), "Test Architecture candidate has a self-authored acceptance row", "TEST_ARCHITECT_ACCEPTANCE_LEDGER_ROW_INVALID");
  return Object.freeze({repository_root: ROOT, package_path: TEST_ARCHITECT_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256, source_manifest_sha256: source.manifest_sha256, source_file_sha256: sourceArtifact.file_sha256, source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: atomic.version, source_effective_date: atomic.effective_date, source_retrieved_date: atomic.retrieved_date, standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSources.manifest_sha256, gate_manifest_sha256: manifest.manifest_sha256, gate_manifest_file_sha256: manifestArtifact.file_sha256, gate_semantic_inventory_sha256: gateSemanticInventorySha256, gate_execution_file_sha256: executionArtifact.file_sha256, context_binding_sha256: contextBinding.binding_sha256, context_binding_file_sha256: contextArtifact.file_sha256, invalidation_sha256: invalidation.invalidation_sha256, invalidation_file_sha256: invalidationArtifact.file_sha256, gates: Object.freeze(gates), fixtures: Object.freeze(fixtures), model: Object.freeze(modelRoute), model_route_sha256: modelRouteSha256, router_file_sha256: routerFileSha256, router_result_sha256: routerResult.result_sha256, context_sha256: contextSha256, custody_ref: TEST_ARCHITECT_CUSTODY_REF, memory_authority: contextBinding.memory_authority, memory_mode: contextBinding.memory_mode, memory_write: contextBinding.memory_write, acceptance_ledger_file_sha256: acceptanceArtifact.file_sha256});
}

export function assertTestArchitectCanonicalEvidence(evidence, authority = resolveTestArchitectCanonicalAuthority()) {
  assert(evidence.candidate_digest === authority.block_sha256 && evidence.authority_scope === "TEST_ARCHITECTURE", "Test Architecture candidate or authority scope is not canonical", "TEST_ARCHITECT_CANDIDATE_BINDING_INVALID");
  assert(evidence.standard_block_sha256 === authority.standard_block_sha256 && evidence.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256 && evidence.standard_id === TEST_ARCHITECT_STANDARD_ID && evidence.standard_version === "1.1", "Test Architecture standard evidence is not canonical", "TEST_ARCHITECT_STANDARD_BINDING_INVALID");
  assert(evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_effective_date === authority.source_effective_date && evidence.source_retrieved_date === authority.source_retrieved_date, "Test Architecture source evidence is not canonical", "TEST_ARCHITECT_SOURCE_IDENTITY_INVALID");
  assert(evidence.custody_ref === authority.custody_ref && evidence.model_policy_status === authority.model.snapshot_status && evidence.model_snapshot_sha256 === authority.model.snapshot_sha256 && evidence.model_task_class === authority.model.task_class && evidence.model_capability_floor === authority.model.minimum_capability && JSON.stringify(evidence.model_required_capabilities) === JSON.stringify(authority.model.required_capabilities) && evidence.model_route_sha256 === authority.model_route_sha256, "Test Architecture model or custody evidence is not canonical", "TEST_ARCHITECT_MODEL_ROUTE_UNBOUND");
  assert(evidence.context_receipt_sha256 === authority.context_sha256 && evidence.memory_binding_sha256 === authority.context_binding_sha256 && evidence.invalidation_sha256 === authority.invalidation_sha256 && evidence.upstream_router_result_sha256 === authority.router_result_sha256, "Test Architecture context or router receipt is not canonical", "TEST_ARCHITECT_CONTEXT_RECEIPT_INVALID");
  return authority;
}

export function assertTestArchitectCommittedHandoff({authority = resolveTestArchitectCanonicalAuthority(), evaluation, handoff, evaluationFileSha256, handoffFileSha256} = {}) {
  assert(evaluationFileSha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.evaluation && handoffFileSha256 === TEST_ARCHITECT_CANONICAL_ARTIFACT_SHA256.handoff, "Test Architecture dossier is not canonical", "TEST_ARCHITECT_CANONICAL_PROVENANCE_INVALID");
  exactKeys(evaluation, ["schema", "version", "receipt_id", "block_id", "candidate_digest", "model_requirement", "harness", "cases", "results", "disposition", "independence_rule"], "Test Architecture evaluation");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.test-architect.v1" && evaluation.block_id === TEST_ARCHITECT_BLOCK_ID && evaluation.candidate_digest === authority.block_sha256 && evaluation.model_requirement === "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE" && evaluation.results?.passed === FIXTURE_CLASSES.length && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "STATIC_PASS_REVIEW_REQUIRED", "Test Architecture evaluation is not current", "TEST_ARCHITECT_EVALUATION_DOSSIER_INVALID");
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === FIXTURE_CLASSES.length && new Set(evaluation.cases.map((entry) => entry.class)).size === FIXTURE_CLASSES.length && evaluation.cases.every((entry) => FIXTURE_CLASSES.includes(entry.class) && entry.observed === "PASS" && ["DENY", "ROUTE"].includes(entry.expected)), "Test Architecture evaluation coverage is incomplete", "TEST_ARCHITECT_EVALUATION_DOSSIER_INVALID");
  exactKeys(handoff, ["schema", "version", "handoff_id", "block_id", "disposition", "candidate_digest", "source_commit", "source_tree", "changed_paths", "proof", "residuals", "next_action", "authority"], "Test Architecture handoff");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.test-architect.v1" && handoff.block_id === TEST_ARCHITECT_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "Test Architecture handoff identity differs", "TEST_ARCHITECT_HANDOFF_INVALID");
  for (const proof of [`evaluation_file_sha256:${evaluationFileSha256}`, `gate_semantic_inventory_sha256:${authority.gate_semantic_inventory_sha256}`, `model_route_sha256:${authority.model_route_sha256}`, `context_receipt_sha256:${authority.context_sha256}`, `context_binding_sha256:${authority.context_binding_sha256}`, `invalidation_sha256:${authority.invalidation_sha256}`, `upstream_router_file_sha256:${authority.router_file_sha256}`]) assert(handoff.proof.includes(proof), `Test Architecture handoff omits ${proof}`, "TEST_ARCHITECT_HANDOFF_INVALID");
  sha(handoffFileSha256, "Test Architecture handoff file digest");
  return true;
}
