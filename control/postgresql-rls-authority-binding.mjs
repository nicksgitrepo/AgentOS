#!/usr/bin/env node

/*
 * Repository-bound authority for the PostgreSQL RLS specialist.
 *
 * A caller may submit typed evidence, but it cannot choose the package,
 * standard, source manifest, model snapshot, roster, context receipt, or
 * upstream router.  Every one of those artifacts is read from this repository
 * and compared to immutable pins before a boundary result can route.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateDataRouterBoundary} from "./data-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const POSTGRESQL_RLS_PACKAGE_PATH = "specialist-blocks/wave-02/postgresql-rls";
export const POSTGRESQL_RLS_BLOCK_ID = "specialist.data.postgresql-rls";
export const POSTGRESQL_RLS_STANDARD_BLOCK_ID = "specialist.standard.postgresql-17-rls";
export const POSTGRESQL_RLS_STANDARD_ID = "source.postgresql-17-rls";
export const POSTGRESQL_RLS_SOURCE_ID = "SOURCE.POSTGRESQL_17_RLS";
export const POSTGRESQL_RLS_SOURCE_VERSION = "17.10";
export const POSTGRESQL_RLS_CUSTODY_REF = "opaque:POSTGRESQL_RLS.CUSTODY";
export const POSTGRESQL_RLS_MODEL_TASK_CLASS = "NARROW_CODING";
export const POSTGRESQL_RLS_MODEL_CAPABILITY_FLOOR = 49;
export const POSTGRESQL_RLS_MODEL_CAPABILITIES = Object.freeze(["CODE", "TOOLS"]);
export const POSTGRESQL_RLS_MODEL_SNAPSHOT_SHA256 = "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27";
export const POSTGRESQL_RLS_STANDARD_BLOCK_SHA256 = "09b45ba38933b2e46e3bf5fe8b862603d3f5f13c6c8d2950343db31c3e3fbd94";
export const POSTGRESQL_RLS_STANDARD_SOURCE_MANIFEST_SHA256 = "b5e8473072a5b897a945a86e3f75aada19fe06f7a2faa7354594b7ee1645e1d0";

/* Candidate artifact pins are immutable readback anchors for this frozen lane. */
export const POSTGRESQL_RLS_ROSTER_FILE_SHA256 = "900a912dfa9a5cc369bb04f7027ab543244a60a88d7c9db9f6efd2b874a0517c";
export const POSTGRESQL_RLS_UPSTREAM_ROUTER_FILE_SHA256 = "fd29420a4cdf7c7640564b6cfb4408149dec94028056c0f82dd4e5c348018bca";
export const POSTGRESQL_RLS_CANONICAL_ARTIFACT_SHA256 = Object.freeze({
  block: "40379ed780a340594a4c00c018e3e646e817bd99cb70eaa6e5a41a378ece101c",
  source_lock: "86ae521cdd0d3adef216d113c41e9f6621335282a6f850d4fcd4e75f06bbb1f8",
  gate_manifest: "3dae974af920be316217d2c34e219e890eefb733a03fa9f1684ddbf859d82e50",
  gate_execution: "e44397c246f0fc7042b8770734153dc312e8b43faff026e4602c10d5f8e7bc2c",
  evaluation: "eafe1edbac2342bad1b8838b19833e250ed1eccf6f829de9a02f57a4084aa253",
  handoff: "885a130f6ad9e58db61de14ed23628c738ce9eb4528f3e1e6e15cfbaceeb4a9f",
  model_snapshot: "203d555399fb84345cede6f122fff3568272a9dda27a350ff04d7387084b392d",
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, POSTGRESQL_RLS_PACKAGE_PATH);
const STANDARD_PATH = path.join(ROOT, "specialist-blocks/standards/postgresql-17-rls/block.json");
const STANDARD_SOURCES_PATH = path.join(ROOT, "specialist-blocks/standards/postgresql-17-rls/sources.lock");
const ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const MODEL_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const UPSTREAM_ROUTER_PATH = path.join(ROOT, "control/data-router-boundary-gate.mjs");
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
const REQUIRED_BLOCKS = Object.freeze([
  "specialist.data.router",
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
  POSTGRESQL_RLS_STANDARD_BLOCK_ID,
]);

function fail(message, code = "POSTGRESQL_RLS_CANONICAL_AUTHORITY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function fileSha(file) { return crypto.createHash("sha256").update(readFile(file, "artifact")).digest("hex"); }
function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "POSTGRESQL_RLS_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "POSTGRESQL_RLS_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  let value;
  try { value = JSON.parse(readFile(file, label).toString("utf8")); } catch (error) { fail(`${label} is not valid JSON: ${error.message}`, "POSTGRESQL_RLS_CANONICAL_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}
function body(value, field) { return {...structuredClone(value), [field]: null}; }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value) && !/^0+$|^f+$/u.test(value), `${label} must be a real SHA-256`, "POSTGRESQL_RLS_CANONICAL_DIGEST_INVALID"); }
function pin(actual, expected, label) {
  sha(expected, `${label} pin`); assert(actual === expected, `${label} is not the pinned candidate`, "POSTGRESQL_RLS_CANONICAL_PROVENANCE_INVALID");
}
function validDate(value, label, nowMs) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "POSTGRESQL_RLS_SOURCE_DATE_INVALID");
  assert(Date.parse(`${value}T00:00:00.000Z`) <= nowMs, `${label} is future-dated`, "POSTGRESQL_RLS_SOURCE_FUTURE");
}
function freshDate(value, label, nowMs, maxAgeDays = 31) {
  validDate(value, label, nowMs); assert(nowMs - Date.parse(`${value}T00:00:00.000Z`) <= maxAgeDays * 86_400_000, `${label} is stale`, "POSTGRESQL_RLS_SOURCE_STALE");
}
function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.block_id === expectedId && block.schema === "agentos.specialist_block.v1" && block.lifecycle === "CANDIDATE" && block.activation === "OFF", `${label} identity differs`, "POSTGRESQL_RLS_CANONICAL_BINDING_INVALID");
  sha(block.block_sha256, `${label}.block_sha256`); assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), `${label} digest does not match bytes`, "POSTGRESQL_RLS_CANONICAL_DIGEST_INVALID");
  return block;
}
function standardSource(sourceLock, nowMs) {
  assert(sourceLock.schema === "agentos.specialist_source_manifest.v1" && sourceLock.block_id === POSTGRESQL_RLS_STANDARD_BLOCK_ID, "PostgreSQL standard source manifest identity differs", "POSTGRESQL_RLS_STANDARD_SOURCE_INVALID");
  assert(sourceLock.manifest_sha256 === canonicalDigest(body(sourceLock, "manifest_sha256")), "PostgreSQL standard source manifest digest differs", "POSTGRESQL_RLS_STANDARD_SOURCE_INVALID");
  const source = sourceLock.sources?.find((candidate) => candidate.source_id === POSTGRESQL_RLS_STANDARD_ID);
  assert(source && source.version === POSTGRESQL_RLS_SOURCE_VERSION && source.publisher === "PostgreSQL Global Development Group" && source.immutable_identity === "postgresql-17-row-security-docs-17.10-2026-08-11", "PostgreSQL standard source identity differs", "POSTGRESQL_RLS_STANDARD_SOURCE_INVALID");
  freshDate(source.retrieved_date, "PostgreSQL standard source retrieved date", nowMs);
  return source;
}
function canonicalRouterResult(candidateDigest) {
  const input = {
    schema: "agentos.data_router_boundary_input.v1", version: 1, request_kind: "ROUTE_DATA", evidence: {
      authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.DATA_ROUTER", custody_ref: "opaque:DATA_ROUTER.CUSTODY",
      source_status: "CURRENT", source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: "1", signal: "POSTGRES_RLS",
      target_ref: POSTGRESQL_RLS_BLOCK_ID, context_complete: true, scope: "NARROW", requested_action: "CLASSIFY", requested_tools: ["READ_CONTEXT", "READ_SCHEMA"],
      self_acceptance: false, scope_expanded: false, authority_conflict: false, project_data_present: false, secret_data_present: false,
    },
  };
  input.evidence.signal = "POSTGRES_RLS";
  const result = evaluateDataRouterBoundary(input);
  assert(result.disposition === "ROUTE" && result.route === "SPECIALIST_HANDOFF" && result.selected_specialist === POSTGRESQL_RLS_BLOCK_ID && result.routing_allowed === true, "Canonical data router did not produce the PostgreSQL RLS route", "POSTGRESQL_RLS_UPSTREAM_ROUTER_INVALID");
  return result;
}
function modelRoute(modelArtifact, nowMs) {
  const model = modelArtifact.value;
  pin(modelArtifact.file_sha256, POSTGRESQL_RLS_CANONICAL_ARTIFACT_SHA256.model_snapshot, "Global model-policy snapshot file");
  assert(model.snapshot_sha256 === POSTGRESQL_RLS_MODEL_SNAPSHOT_SHA256, "Global model-policy snapshot is not pinned", "POSTGRESQL_RLS_MODEL_POLICY_PROVENANCE_INVALID");
  validateModelPolicySnapshot(model, {requireActive: false, nowUtc: new Date(nowMs).toISOString()});
  assert(model.project_agnostic === true && model.contains_consumer_context === false && model.raw_browsing_transcripts === false, "Global model-policy snapshot is not project-agnostic", "POSTGRESQL_RLS_MODEL_POLICY_INVALID");
  const task = model.task_classes?.find((candidate) => candidate.task_class === POSTGRESQL_RLS_MODEL_TASK_CLASS);
  assert(task && task.minimum_capability_score === POSTGRESQL_RLS_MODEL_CAPABILITY_FLOOR && JSON.stringify(task.required_capabilities) === JSON.stringify(POSTGRESQL_RLS_MODEL_CAPABILITIES), "PostgreSQL RLS model route semantics are not canonical", "POSTGRESQL_RLS_MODEL_ROUTE_INVALID");
  const route = {task_class: POSTGRESQL_RLS_MODEL_TASK_CLASS, minimum_capability: task.minimum_capability_score, required_capabilities: [...task.required_capabilities], preferred_models: [...task.preferred_models], fallback_models: [...task.fallback_models], route_source: "GLOBAL_MODEL_POLICY_SNAPSHOT", snapshot_sha256: model.snapshot_sha256, snapshot_status: model.status};
  return Object.freeze({...route, route_sha256: canonicalDigest(route)});
}
function gateSemanticInventory(root, manifest) {
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.block_id === POSTGRESQL_RLS_BLOCK_ID, "PostgreSQL RLS gate manifest identity differs", "POSTGRESQL_RLS_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(GATE_IDS) && JSON.stringify(manifest.gate_paths) === JSON.stringify(GATE_IDS.map((id) => `gates/${id}.gate`)), "PostgreSQL RLS gate order differs", "POSTGRESQL_RLS_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "PostgreSQL RLS gate outcomes differ", "POSTGRESQL_RLS_GATE_SEMANTICS_INVALID");
  const expectedRules = {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"};
  const semantic = [];
  GATE_IDS.forEach((gateId, index) => {
    const artifact = readJson(path.join(root, "gates", `${gateId}.gate`), `PostgreSQL RLS gate ${gateId}`); const gate = artifact.value;
    assert(gate.schema === "agentos.specialist_gate.v1" && gate.version === 1 && gate.gate_id === gateId && gate.block_id === POSTGRESQL_RLS_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `PostgreSQL RLS gate ${gateId} identity differs`, "POSTGRESQL_RLS_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]) && JSON.stringify(gate.rules) === JSON.stringify(expectedRules), `PostgreSQL RLS gate ${gateId} semantics differ`, "POSTGRESQL_RLS_GATE_SEMANTICS_INVALID");
    const expectedNext = (outcome) => outcome === "NO" ? "OUTCOME:DENY" : outcome === "UNKNOWN" ? "OUTCOME:UNKNOWN_DEPENDENT_ONLY" : index === GATE_IDS.length - 1 ? "OUTCOME:ROUTE" : GATE_IDS[index + 1];
    for (const outcome of ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]) assert(gate.next[outcome] === expectedNext(outcome), `PostgreSQL RLS gate ${gateId} next branch differs`, "POSTGRESQL_RLS_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `PostgreSQL RLS gate ${gateId}`); assert(gate.gate_sha256 === canonicalDigest(body(gate, "gate_sha256")), `PostgreSQL RLS gate ${gateId} digest differs`, "POSTGRESQL_RLS_GATE_DIGEST_INVALID");
    semantic.push({gate_id: gate.gate_id, gate_sha256: gate.gate_sha256, next: gate.next, rules: gate.rules, evidence: gate.evidence});
  });
  return canonicalDigest(semantic);
}
function assertRoster(rosterArtifact, block, model, gateManifest, packageRoot) {
  pin(rosterArtifact.file_sha256, POSTGRESQL_RLS_ROSTER_FILE_SHA256, "PostgreSQL RLS reusable-agent roster file");
  const roster = rosterArtifact.value;
  assert(roster.schema === "agentos.reusable_agent_roster.v1" && roster.version === 1 && roster.project_agnostic === true && roster.activation !== "ON", "PostgreSQL RLS roster identity is invalid", "POSTGRESQL_RLS_ROSTER_INVALID");
  assert(roster.roster_sha256 === canonicalDigest(body(roster, "roster_sha256")), "PostgreSQL RLS roster digest is invalid", "POSTGRESQL_RLS_ROSTER_DIGEST_INVALID");
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === "AGENT.DATA_POSTGRESQL_RLS");
  assert(entry && entry.canonical_block_id === POSTGRESQL_RLS_BLOCK_ID && entry.package_path === POSTGRESQL_RLS_PACKAGE_PATH, "PostgreSQL RLS roster binding is missing or substituted", "POSTGRESQL_RLS_ROSTER_BINDING_INVALID");
  assert(entry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION" && entry.qa_state === "STATIC_PASS_REVIEW_REQUIRED" && entry.independent_evaluation_state === "STATIC_PASS_REVIEW_REQUIRED", "PostgreSQL RLS roster state is not candidate-only", "POSTGRESQL_RLS_ROSTER_STATE_INVALID");
  assert(entry.model_route?.task_class === model.task_class && entry.model_route.minimum_capability === model.minimum_capability && JSON.stringify(entry.model_route.required_capabilities) === JSON.stringify(model.required_capabilities) && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "PostgreSQL RLS roster model route differs", "POSTGRESQL_RLS_MODEL_ROUTE_INVALID");
  assert(entry.deterministic_gates?.status === "BOUND" && entry.deterministic_gates.manifest_path === `${POSTGRESQL_RLS_PACKAGE_PATH}/gates/manifest.json` && entry.deterministic_gates.gates.length === GATE_IDS.length, "PostgreSQL RLS roster gate binding is incomplete", "POSTGRESQL_RLS_ROSTER_GATE_PROVENANCE_INVALID");
  for (const gate of entry.deterministic_gates.gates) { const actual = fileSha(path.join(ROOT, gate.path)); assert(actual === gate.file_sha256, `PostgreSQL RLS roster gate digest differs: ${gate.gate_id}`, "POSTGRESQL_RLS_ROSTER_GATE_PROVENANCE_INVALID"); }
  assert(entry.hostile_fixtures?.status === "BOUND" && entry.hostile_fixtures.fixtures.length === FIXTURE_CLASSES.length, "PostgreSQL RLS roster fixture binding is incomplete", "POSTGRESQL_RLS_ROSTER_FIXTURE_PROVENANCE_INVALID");
  for (const fixture of entry.hostile_fixtures.fixtures) { const actual = fileSha(path.join(ROOT, fixture.path)); assert(actual === fixture.file_sha256, `PostgreSQL RLS roster fixture digest differs: ${fixture.fixture_id}`, "POSTGRESQL_RLS_ROSTER_FIXTURE_PROVENANCE_INVALID"); }
  const handoffPath = `${POSTGRESQL_RLS_PACKAGE_PATH}/handoff.json`; assert(entry.required_evidence_handoff?.handoff_path === handoffPath && entry.required_evidence_handoff.handoff_file_sha256 === fileSha(path.join(ROOT, handoffPath)), "PostgreSQL RLS roster handoff binding is incomplete", "POSTGRESQL_RLS_HANDOFF_PROVENANCE_INVALID");
  assert(entry.lifecycle?.kind === "SEED_TO_WORKER" && entry.supersession_invalidation?.links?.includes(`${POSTGRESQL_RLS_PACKAGE_PATH}/evaluation.json`), "PostgreSQL RLS lifecycle/invalidation binding is incomplete", "POSTGRESQL_RLS_LIFECYCLE_BINDING_INVALID");
  assert(gateManifest.manifest_sha256 === canonicalDigest(body(gateManifest, "manifest_sha256")), "PostgreSQL RLS gate manifest digest is invalid", "POSTGRESQL_RLS_GATE_MANIFEST_INVALID");
  return entry;
}

export function resolvePostgresqlRlsCanonicalAuthority() {
  const nowMs = Date.now();
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "PostgreSQL RLS block"); pin(blockArtifact.file_sha256, POSTGRESQL_RLS_CANONICAL_ARTIFACT_SHA256.block, "PostgreSQL RLS block file"); const block = checkBlock(blockArtifact, POSTGRESQL_RLS_BLOCK_ID, "PostgreSQL RLS block");
  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "PostgreSQL RLS source lock"); pin(sourceArtifact.file_sha256, POSTGRESQL_RLS_CANONICAL_ARTIFACT_SHA256.source_lock, "PostgreSQL RLS source lock file"); const sourceLock = sourceArtifact.value;
  assert(sourceLock.schema === "agentos.specialist_source_manifest.v1" && sourceLock.block_id === POSTGRESQL_RLS_BLOCK_ID && sourceLock.manifest_sha256 === canonicalDigest(body(sourceLock, "manifest_sha256")), "PostgreSQL RLS source lock is invalid", "POSTGRESQL_RLS_SOURCE_LOCK_INVALID");
  const source = sourceLock.sources?.find((candidate) => candidate.source_id === "source.postgresql-17-rls"); const atomic = sourceLock.sources?.find((candidate) => candidate.source_id === "source.atomic-specialization-law");
  assert(source && source.version === POSTGRESQL_RLS_SOURCE_VERSION && source.publisher === "PostgreSQL Global Development Group" && source.immutable_identity === "postgresql-17-row-security-docs-17.10-2026-08-11", "PostgreSQL RLS source identity is invalid", "POSTGRESQL_RLS_SOURCE_IDENTITY_INVALID");
  assert(atomic && atomic.version === "1" && atomic.immutable_identity === "agentos-atomic-specialization-law-v1", "PostgreSQL RLS atomic source identity is invalid", "POSTGRESQL_RLS_SOURCE_IDENTITY_INVALID");
  freshDate(source.retrieved_date, "PostgreSQL RLS source retrieved date", nowMs); validDate(source.effective_date, "PostgreSQL RLS source effective date", nowMs); freshDate(atomic.retrieved_date, "PostgreSQL atomic source retrieved date", nowMs); validDate(atomic.effective_date, "PostgreSQL atomic source effective date", nowMs);

  const standardArtifact = readJson(STANDARD_PATH, "PostgreSQL 17 RLS standard block"); const standard = checkBlock(standardArtifact, POSTGRESQL_RLS_STANDARD_BLOCK_ID, "PostgreSQL RLS standard block"); pin(standard.block_sha256, POSTGRESQL_RLS_STANDARD_BLOCK_SHA256, "PostgreSQL RLS standard block");
  const standardSourcesArtifact = readJson(STANDARD_SOURCES_PATH, "PostgreSQL 17 RLS standard source manifest"); const standardSources = standardSourcesArtifact.value; pin(standardSources.manifest_sha256, POSTGRESQL_RLS_STANDARD_SOURCE_MANIFEST_SHA256, "PostgreSQL RLS standard source manifest"); const standardPrimary = standardSource(standardSources, nowMs);
  assert(source.immutable_identity === standardPrimary.immutable_identity && source.version === standardPrimary.version, "PostgreSQL RLS package source is not bound to standard source", "POSTGRESQL_RLS_STANDARD_SOURCE_INVALID");

  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot"); const model = modelRoute(modelArtifact, nowMs);
  const routerFileSha = fileSha(UPSTREAM_ROUTER_PATH); pin(routerFileSha, POSTGRESQL_RLS_UPSTREAM_ROUTER_FILE_SHA256, "PostgreSQL RLS upstream data router source"); const routerResult = canonicalRouterResult(block.block_sha256);
  const manifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "PostgreSQL RLS gate manifest"); pin(manifestArtifact.file_sha256, POSTGRESQL_RLS_CANONICAL_ARTIFACT_SHA256.gate_manifest, "PostgreSQL RLS gate manifest file"); const manifest = manifestArtifact.value; assert(manifest.manifest_sha256 === canonicalDigest(body(manifest, "manifest_sha256")), "PostgreSQL RLS gate manifest digest is invalid", "POSTGRESQL_RLS_GATE_MANIFEST_INVALID"); const gateSemanticInventorySha = gateSemanticInventory(PACKAGE, manifest);
  const gateExecutionArtifact = readJson(path.join(PACKAGE, "gates/execution.json"), "PostgreSQL RLS gate execution manifest"); pin(gateExecutionArtifact.file_sha256, POSTGRESQL_RLS_CANONICAL_ARTIFACT_SHA256.gate_execution, "PostgreSQL RLS gate execution file");
  const contextSha = canonicalDigest({block_sha256: block.block_sha256, source_manifest_sha256: sourceLock.manifest_sha256, standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSources.manifest_sha256, authority_scope: "POSTGRESQL_RLS", scope: "NARROW", database_engine: "postgresql", database_version: POSTGRESQL_RLS_SOURCE_VERSION, tenant_boundary_status: "BOUND", custody_ref: POSTGRESQL_RLS_CUSTODY_REF, model_route_sha256: model.route_sha256, router_file_sha256: routerFileSha, router_result_sha256: routerResult.result_sha256, memory_binding: "TYPED_HANDOFF_ONLY", lifecycle_revision: block.revision, invalidation_links: [`${POSTGRESQL_RLS_PACKAGE_PATH}/evaluation.json`, `${POSTGRESQL_RLS_PACKAGE_PATH}/sources.lock`], gate_semantic_inventory_sha256: gateSemanticInventorySha});
  const rosterArtifact = readJson(ROSTER_PATH, "PostgreSQL RLS reusable-agent roster"); const rosterEntry = assertRoster(rosterArtifact, block, model, manifest, PACKAGE);
  return Object.freeze({repository_root: ROOT, package_path: POSTGRESQL_RLS_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256, source_manifest_sha256: sourceLock.manifest_sha256, source_file_sha256: sourceArtifact.file_sha256, source_identity: POSTGRESQL_RLS_SOURCE_ID, source_version: POSTGRESQL_RLS_SOURCE_VERSION, source_effective_date: source.effective_date, source_retrieved_date: source.retrieved_date, standard_id: POSTGRESQL_RLS_STANDARD_ID, standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSources.manifest_sha256, gate_manifest_sha256: manifest.manifest_sha256, gate_manifest_file_sha256: manifestArtifact.file_sha256, gate_execution_file_sha256: gateExecutionArtifact.file_sha256, gate_semantic_inventory_sha256: gateSemanticInventorySha, fixtures: Object.freeze(FIXTURE_CLASSES.map((fixtureClass) => ({fixture_id: `postgresql-rls-${fixtureClass}`, class: fixtureClass, path: `${POSTGRESQL_RLS_PACKAGE_PATH}/fixtures/${fixtureClass}.json`, file_sha256: fileSha(path.join(PACKAGE, "fixtures", `${fixtureClass}.json`))}))), model, model_route_sha256: model.route_sha256, router_file_sha256: routerFileSha, router_result_sha256: routerResult.result_sha256, context_sha256: contextSha, custody_ref: POSTGRESQL_RLS_CUSTODY_REF, roster_file_sha256: rosterArtifact.file_sha256, roster_entry_id: rosterEntry.stable_agent_id, lifecycle_invalidation_links: Object.freeze([`${POSTGRESQL_RLS_PACKAGE_PATH}/evaluation.json`, `${POSTGRESQL_RLS_PACKAGE_PATH}/sources.lock`])});
}

export function assertPostgresqlRlsCanonicalEvidence(evidence, authority = resolvePostgresqlRlsCanonicalAuthority()) {
  const checks = [
    [evidence.authority_status === "CURRENT", "authority status", "POSTGRESQL_RLS_AUTHORITY_UNVERIFIED"],
    [evidence.custody_status === "BOUND" && evidence.custody_owner === "AGENT.DATA_POSTGRESQL_RLS" && evidence.custody_ref === authority.custody_ref, "custody binding", "POSTGRESQL_RLS_CUSTODY_BINDING_INVALID"],
    [evidence.source_status === "CURRENT_VERIFIED" && evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_effective_date === authority.source_effective_date && evidence.source_retrieved_date === authority.source_retrieved_date, "source identity/freshness", "POSTGRESQL_RLS_SOURCE_IDENTITY_INVALID"],
    [evidence.candidate_status === "CURRENT_CANDIDATE" && evidence.candidate_digest === authority.block_sha256, "candidate binding", "POSTGRESQL_RLS_CANDIDATE_BINDING_INVALID"],
    [evidence.signal === "DATA.POSTGRES_RLS" && evidence.signal_status === "BOUND" && evidence.context_status === "POSTGRESQL_RLS_CONTEXT" && evidence.authority_scope === "POSTGRESQL_RLS", "scope signal", "POSTGRESQL_RLS_CONTEXT_BINDING_INVALID"],
    [evidence.database_engine === "postgresql" && evidence.database_version === POSTGRESQL_RLS_SOURCE_VERSION && evidence.tenant_boundary_status === "BOUND" && evidence.policy_evidence_status === "BOUND" && evidence.bypass_role_evidence_status === "BOUND", "database/tenant evidence", "POSTGRESQL_RLS_CONTEXT_BINDING_INVALID"],
    [evidence.standard_id === authority.standard_id && evidence.standard_version === POSTGRESQL_RLS_SOURCE_VERSION && evidence.standard_block_sha256 === authority.standard_block_sha256 && evidence.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256, "standard binding", "POSTGRESQL_RLS_STANDARD_BINDING_INVALID"],
    [evidence.model_policy_status === authority.model.snapshot_status && evidence.model_route_status === "BOUND" && evidence.model_snapshot_sha256 === POSTGRESQL_RLS_MODEL_SNAPSHOT_SHA256 && evidence.model_task_class === authority.model.task_class && evidence.model_capability_floor === authority.model.minimum_capability && JSON.stringify(evidence.model_required_capabilities) === JSON.stringify(authority.model.required_capabilities) && evidence.model_route_sha256 === authority.model_route_sha256, "model route", "POSTGRESQL_RLS_MODEL_ROUTE_UNBOUND"],
    [evidence.context_receipt_sha256 === authority.context_sha256 && evidence.upstream_router_result_sha256 === authority.router_result_sha256 && evidence.memory_binding === "TYPED_HANDOFF_ONLY", "typed context receipt", "POSTGRESQL_RLS_CONTEXT_RECEIPT_INVALID"],
  ];
  for (const [condition, label, code] of checks) assert(condition, `PostgreSQL RLS ${label} is not canonical`, code);
  assert(evidence.requested_tools.length === 3 && evidence.requested_tools.every((tool) => ["READ_CANDIDATE", "READ_CONTEXT", "READ_SOURCE_LOCK"].includes(tool)), "PostgreSQL RLS tool custody is not canonical", "POSTGRESQL_RLS_TOOL_SCOPE_FORBIDDEN");
  assert(evidence.memory_write_requested === false, "PostgreSQL RLS memory writes are forbidden", "POSTGRESQL_RLS_MEMORY_WRITE_FORBIDDEN");
  return authority;
}

export function assertPostgresqlRlsCommittedHandoff({authority = resolvePostgresqlRlsCanonicalAuthority(), evaluation, handoff, evaluationFileSha256, handoffFileSha256} = {}) {
  pin(evaluationFileSha256, POSTGRESQL_RLS_CANONICAL_ARTIFACT_SHA256.evaluation, "PostgreSQL RLS evaluation file"); pin(handoffFileSha256, POSTGRESQL_RLS_CANONICAL_ARTIFACT_SHA256.handoff, "PostgreSQL RLS handoff file");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.postgresql-rls.v1" && evaluation.block_id === POSTGRESQL_RLS_BLOCK_ID && evaluation.candidate_digest === authority.block_sha256 && evaluation.model_requirement === "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE" && evaluation.results?.passed === 17 && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "STATIC_PASS_REVIEW_REQUIRED", "PostgreSQL RLS evaluation dossier is not current", "POSTGRESQL_RLS_EVALUATION_DOSSIER_INVALID");
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === FIXTURE_CLASSES.length && new Set(evaluation.cases.map((entry) => entry.class)).size === FIXTURE_CLASSES.length, "PostgreSQL RLS evaluation case coverage is incomplete", "POSTGRESQL_RLS_EVALUATION_DOSSIER_INVALID");
  for (const item of evaluation.cases) assert(FIXTURE_CLASSES.includes(item.class) && item.observed === "PASS" && ["DENY", "ROUTE"].includes(item.expected), `PostgreSQL RLS evaluation case ${item.class} is not a current PASS`, "POSTGRESQL_RLS_EVALUATION_DOSSIER_INVALID");
  assert(evaluation.independence_rule === "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION", "PostgreSQL RLS evaluation independence rule is invalid", "POSTGRESQL_RLS_EVALUATION_DOSSIER_INVALID");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.postgresql-rls.v1" && handoff.block_id === POSTGRESQL_RLS_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "PostgreSQL RLS handoff identity differs", "POSTGRESQL_RLS_HANDOFF_INVALID");
  assert(Array.isArray(handoff.proof) && handoff.proof.includes(`evaluation_file_sha256:${evaluationFileSha256}`) && handoff.proof.includes(`gate_semantic_inventory_sha256:${authority.gate_semantic_inventory_sha256}`) && handoff.proof.includes(`model_route_sha256:${authority.model_route_sha256}`) && handoff.proof.includes(`context_receipt_sha256:${authority.context_sha256}`) && handoff.proof.includes(`upstream_router_file_sha256:${authority.router_file_sha256}`), "PostgreSQL RLS handoff is not bound to execution artifacts", "POSTGRESQL_RLS_HANDOFF_INVALID");
  return true;
}
