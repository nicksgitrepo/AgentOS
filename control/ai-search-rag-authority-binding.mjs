#!/usr/bin/env node

/*
 * Canonical, repository-bound evidence for the AI Search/RAG specialist.
 *
 * This resolver is intentionally independent from the public boundary.  The
 * public boundary evaluates a serialized synthetic request; this module
 * resolves the package, source locks, reusable standards, upstream router,
 * roster entry, model-policy snapshot, and lifecycle receipts from the active
 * AgentOS repository.  A caller cannot make a substituted digest current by
 * repeating it in a request.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateAiSearchRouterBoundary, AI_SEARCH_ROUTER_INPUT_SCHEMA} from "./ai-search-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const AI_SEARCH_RAG_PACKAGE_PATH = "specialist-blocks/wave-06/search-rag";
export const AI_SEARCH_RAG_BLOCK_ID = "specialist.ai.search-rag";
export const AI_SEARCH_RAG_CUSTODY_REF = "opaque:AI_SEARCH_RAG.CUSTODY";
export const AI_SEARCH_RAG_MODEL_TASK_CLASS = "NARROW_CODING";
export const AI_SEARCH_RAG_MODEL_CAPABILITY_FLOOR = 49;
export const AI_SEARCH_RAG_MODEL_CAPABILITIES = Object.freeze(["CODE", "TOOLS"]);
export const AI_SEARCH_RAG_SOURCE_ID = "source.nist-ai-100-1";
export const AI_SEARCH_RAG_SOURCE_IDENTITY = "SOURCE.NIST_AI_RMF";
export const AI_SEARCH_RAG_SOURCE_VERSION = "1.0";
export const AI_SEARCH_RAG_STANDARD_IDS = Object.freeze([
  "specialist.standard.nist-ai-rmf-1-0",
  "specialist.standard.nist-genai-profile-1-0",
]);
export const AI_SEARCH_RAG_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
export const AI_SEARCH_RAG_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim",
  "data_limit", "duplicate_sibling_authority", "false_positive", "handoff",
  "missing_context", "narrowness", "router_self_accept", "routing",
  "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority",
  "unrelated_scope", "unsafe_action",
]);
export const AI_SEARCH_RAG_PROTECTED_BLOCKERS = Object.freeze([
  "POLICY_SNAPSHOT_STALE",
  "CANONICAL_EVALUATOR_HANDOFF_REQUIRED",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const ACCEPTANCE_LEDGER_PATH = path.join(ROOT, "specialist-blocks/registry/accepted-agent-receipts.v1.json");
const MODEL_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const UPSTREAM_ROUTER_PATH = path.join(ROOT, "control/ai-search-router-boundary-gate.mjs");
const PACKAGE = path.join(ROOT, AI_SEARCH_RAG_PACKAGE_PATH);
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function fail(message, code = "AI_SEARCH_RAG_CANONICAL_AUTHORITY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "AI_SEARCH_RAG_DIGEST_INVALID"); }
function fileSha(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function body(value, field) { return {...structuredClone(value), [field]: null}; }

function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "AI_SEARCH_RAG_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical file`, "AI_SEARCH_RAG_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}

function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "AI_SEARCH_RAG_CANONICAL_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}

function validDate(value, label, nowMs) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "AI_SEARCH_RAG_SOURCE_DATE_INVALID");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  assert(time <= nowMs, `${label} is future-dated`, "AI_SEARCH_RAG_SOURCE_FUTURE");
  return time;
}

function freshDate(value, label, nowMs, maxAgeDays = 31) {
  const time = validDate(value, label, nowMs);
  assert(nowMs - time <= maxAgeDays * 86_400_000, `${label} is stale`, "AI_SEARCH_RAG_SOURCE_STALE");
  return time;
}

function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.block_id === expectedId && block.activation === "OFF", `${label} identity differs`, "AI_SEARCH_RAG_BLOCK_BINDING_INVALID");
  sha(block.block_sha256, `${label} digest`);
  assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), `${label} digest does not match its bytes`, "AI_SEARCH_RAG_BLOCK_DIGEST_INVALID");
  return block;
}

function checkSourceManifest(artifact, expectedId, label) {
  const source = artifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.version === 1 && source.block_id === expectedId, `${label} identity differs`, "AI_SEARCH_RAG_SOURCE_LOCK_INVALID");
  sha(source.manifest_sha256, `${label} digest`);
  assert(source.manifest_sha256 === canonicalDigest(body(source, "manifest_sha256")), `${label} digest does not match its bytes`, "AI_SEARCH_RAG_SOURCE_LOCK_INVALID");
  return source;
}

function checkGate(gate, gateId) {
  assert(gate.schema === "agentos.specialist_gate.v1" && gate.version === 1 && gate.gate_id === gateId && gate.block_id === AI_SEARCH_RAG_BLOCK_ID, `Gate ${gateId} identity differs`, "AI_SEARCH_RAG_GATE_INVALID");
  assert(gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Gate ${gateId} is not executable`, "AI_SEARCH_RAG_GATE_INVALID");
  assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `Gate ${gateId} outcomes differ`, "AI_SEARCH_RAG_GATE_INVALID");
  sha(gate.gate_sha256, `Gate ${gateId} digest`);
  assert(gate.gate_sha256 === canonicalDigest(body(gate, "gate_sha256")), `Gate ${gateId} digest does not match its bytes`, "AI_SEARCH_RAG_GATE_DIGEST_INVALID");
  return gate;
}

function canonicalRouterResult(candidateDigest) {
  const input = {
    schema: AI_SEARCH_ROUTER_INPUT_SCHEMA,
    version: 1,
    request_kind: "ROUTE_SEARCH_HANDOFF",
    evidence: {
      authority_status: "CURRENT", corpus_scope: "EXTERNAL_TYPED_CORPUS", corpus_ref: "ref:CORPUS/EXTERNAL/1",
      source_status: "CURRENT_VERIFIED", source_identity: AI_SEARCH_RAG_SOURCE_IDENTITY, source_version: AI_SEARCH_RAG_SOURCE_VERSION,
      candidate_status: "CURRENT_CANDIDATE", candidate_digest: candidateDigest, retrieval_signal: "AI.SEARCH_RAG",
      signal_status: "BOUND", task_status: "RETRIEVAL_CLASSIFICATION", context_status: "ROUTER_CONTEXT", context_complete: true,
      requested_action: "ROUTE", requested_tools: ["READ_SIGNAL", "READ_SOURCE_LOCK", "READ_CORPUS_DESCRIPTOR", "READ_CONTEXT", "READ_ROUTER_CATALOG"],
      required_block_identities: ["SPECIALIST.FOUNDATION.AUTHORITY_JURISDICTION_GATE", "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE", "SPECIALIST.FOUNDATION.ROLE_INTAKE_CLASSIFIER", "SPECIALIST.FOUNDATION.SCOPE_NON_GOAL_GATE", "SPECIALIST.FOUNDATION.TOOL_CUSTODY_GATE"],
      model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "SEARCH_ROUTER", new_findings: false,
      project_data_present: false, secret_data_present: false,
      adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false])),
    },
  };
  const result = evaluateAiSearchRouterBoundary(input);
  assert(result.disposition === "ROUTE" && result.route === "SEARCH_ATOMIC_HANDOFF" && result.routing_allowed === true && result.acceptance_allowed === false, "Canonical upstream router did not produce a narrow route", "AI_SEARCH_RAG_UPSTREAM_ROUTER_INVALID");
  return result;
}

function resolveModelPreflight(modelArtifact) {
  const model = modelArtifact.value;
  assert(model.schema === "agentos.model_policy_snapshot.v1" && model.version === 1, "Model-policy snapshot identity is invalid", "AI_SEARCH_RAG_MODEL_POLICY_INVALID");
  sha(model.snapshot_sha256, "Model-policy snapshot digest");
  assert(model.snapshot_sha256 === canonicalDigest(body(model, "snapshot_sha256")), "Model-policy snapshot digest differs", "AI_SEARCH_RAG_MODEL_POLICY_INVALID");
  let preflight_status = "CURRENT";
  let blocker = null;
  try {
    validateModelPolicySnapshot(model, {requireActive: false});
  } catch (error) {
    if (error?.code !== "POLICY_SNAPSHOT_STALE") throw error;
    preflight_status = "BLOCKED_EXACT";
    blocker = "POLICY_SNAPSHOT_STALE";
  }
  const task = model.task_classes?.find((candidate) => candidate.task_class === AI_SEARCH_RAG_MODEL_TASK_CLASS);
  assert(task && task.minimum_capability_score === AI_SEARCH_RAG_MODEL_CAPABILITY_FLOOR && JSON.stringify(task.required_capabilities) === JSON.stringify(AI_SEARCH_RAG_MODEL_CAPABILITIES), "NARROW_CODING model route is not canonical", "AI_SEARCH_RAG_MODEL_ROUTE_INVALID");
  return Object.freeze({
    snapshot_sha256: model.snapshot_sha256,
    model_file_sha256: modelArtifact.file_sha256,
    observed_at_utc: model.observed_at_utc,
    expires_at_utc: model.expires_at_utc,
    snapshot_status: model.status,
    preflight_status,
    blocker,
    task_class: AI_SEARCH_RAG_MODEL_TASK_CLASS,
    minimum_capability: task.minimum_capability_score,
    required_capabilities: Object.freeze([...task.required_capabilities]),
  });
}

export function resolveAiSearchRagCanonicalAuthority() {
  const nowMs = Date.now();
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "AI Search/RAG block");
  const block = checkBlock(blockArtifact, AI_SEARCH_RAG_BLOCK_ID, "AI Search/RAG block");
  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "AI Search/RAG source lock");
  const source = checkSourceManifest(sourceArtifact, AI_SEARCH_RAG_BLOCK_ID, "AI Search/RAG source lock");
  const atomic = source.sources?.find((entry) => entry.source_id === "source.atomic-specialization-law");
  const nist = source.sources?.find((entry) => entry.source_id === AI_SEARCH_RAG_SOURCE_ID);
  const genai = source.sources?.find((entry) => entry.source_id === "source.nist-ai-600-1");
  assert(atomic && atomic.immutable_identity === "agentos-atomic-specialization-law-v1" && atomic.authority_class === "AGENTOS_PORTABLE", "Atomic source identity is not canonical", "AI_SEARCH_RAG_SOURCE_IDENTITY_INVALID");
  assert(nist && nist.immutable_identity === "nist-ai-100-1-ai-rmf-1.0-20230126" && nist.authority_class === "PRIMARY_NORMATIVE", "NIST AI RMF source identity is not canonical", "AI_SEARCH_RAG_SOURCE_IDENTITY_INVALID");
  assert(genai && genai.immutable_identity === "nist-ai-600-1-genai-profile-20240726" && genai.authority_class === "PRIMARY_NORMATIVE", "NIST GenAI source identity is not canonical", "AI_SEARCH_RAG_SOURCE_IDENTITY_INVALID");
  freshDate(atomic.retrieved_date, "Atomic source retrieved date", nowMs);
  freshDate(nist.retrieved_date, "NIST AI RMF source retrieved date", nowMs);
  freshDate(genai.retrieved_date, "NIST GenAI source retrieved date", nowMs);
  validDate(atomic.effective_date, "Atomic source effective date", nowMs);
  validDate(nist.effective_date, "NIST AI RMF source effective date", nowMs);
  validDate(genai.effective_date, "NIST GenAI source effective date", nowMs);

  const standards = AI_SEARCH_RAG_STANDARD_IDS.map((id) => {
    const name = id.endsWith("nist-ai-rmf-1-0") ? "nist-ai-rmf-1-0" : "nist-genai-profile-1-0";
    const standardArtifact = readJson(path.join(ROOT, `specialist-blocks/standards/${name}/block.json`), `${id} block`);
    const standard = checkBlock(standardArtifact, id, `${id} block`);
    const standardSourceArtifact = readJson(path.join(ROOT, `specialist-blocks/standards/${name}/sources.lock`), `${id} source lock`);
    const standardSource = checkSourceManifest(standardSourceArtifact, id, `${id} source lock`);
    return Object.freeze({id, block_sha256: standard.block_sha256, source_manifest_sha256: standardSource.manifest_sha256, source_file_sha256: standardSourceArtifact.file_sha256});
  });

  const rosterArtifact = readJson(ROSTER_PATH, "Reusable-agent roster");
  const roster = rosterArtifact.value;
  assert(roster.schema === "agentos.reusable_agent_roster.v1" && roster.version === 1 && roster.project_agnostic === true && roster.roster_sha256 === canonicalDigest(body(roster, "roster_sha256")), "Reusable-agent roster identity is invalid", "AI_SEARCH_RAG_ROSTER_INVALID");
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === "AGENT.AI_SEARCH_RAG");
  assert(entry && entry.canonical_block_id === AI_SEARCH_RAG_BLOCK_ID && entry.package_path === AI_SEARCH_RAG_PACKAGE_PATH && entry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION", "AI Search/RAG roster entry is missing, substituted, or accepted", "AI_SEARCH_RAG_ROSTER_BINDING_INVALID");
  assert(entry.model_route?.task_class === AI_SEARCH_RAG_MODEL_TASK_CLASS && entry.model_route.minimum_capability === AI_SEARCH_RAG_MODEL_CAPABILITY_FLOOR && JSON.stringify(entry.model_route.required_capabilities) === JSON.stringify(AI_SEARCH_RAG_MODEL_CAPABILITIES) && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "AI Search/RAG model route is not canonical", "AI_SEARCH_RAG_MODEL_ROUTE_INVALID");

  const acceptanceArtifact = readJson(ACCEPTANCE_LEDGER_PATH, "Reusable-agent acceptance ledger");
  const acceptanceLedger = acceptanceArtifact.value;
  assert(acceptanceLedger.schema === "agentos.reusable_agent_acceptance_ledger.v1" && acceptanceLedger.status === "READ_ONLY_INDEPENDENT_EVALUATION_INDEX" && acceptanceLedger.project_agnostic === true && acceptanceLedger.ledger_sha256 === canonicalDigest(body(acceptanceLedger, "ledger_sha256")), "Acceptance ledger identity is invalid", "AI_SEARCH_RAG_ACCEPTANCE_LEDGER_INVALID");
  assert((acceptanceLedger.entries ?? []).filter((candidate) => candidate.stable_agent_id === "AGENT.AI_SEARCH_RAG").length === 0, "AI Search/RAG has an ungoverned acceptance row", "AI_SEARCH_RAG_ACCEPTANCE_ROW_INVALID");

  const manifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "AI Search/RAG gate manifest");
  const manifest = manifestArtifact.value;
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.block_id === AI_SEARCH_RAG_BLOCK_ID && JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(AI_SEARCH_RAG_GATE_IDS) && JSON.stringify(manifest.gate_paths) === JSON.stringify(AI_SEARCH_RAG_GATE_IDS.map((id) => `gates/${id}.gate`)), "AI Search/RAG gate manifest is not exact", "AI_SEARCH_RAG_GATE_MANIFEST_INVALID");
  sha(manifest.manifest_sha256, "AI Search/RAG gate manifest digest");
  assert(manifest.manifest_sha256 === canonicalDigest(body(manifest, "manifest_sha256")), "AI Search/RAG gate manifest digest differs", "AI_SEARCH_RAG_GATE_MANIFEST_INVALID");
  assert(entry.deterministic_gates?.status === "BOUND" && entry.deterministic_gates.manifest_path === `${AI_SEARCH_RAG_PACKAGE_PATH}/gates/manifest.json` && entry.deterministic_gates.gates.length === AI_SEARCH_RAG_GATE_IDS.length, "AI Search/RAG roster gate binding is incomplete", "AI_SEARCH_RAG_ROSTER_GATE_INVALID");
  const gates = AI_SEARCH_RAG_GATE_IDS.map((gateId, index) => {
    const artifact = readJson(path.join(PACKAGE, "gates", `${gateId}.gate`), `AI Search/RAG gate ${gateId}`);
    checkGate(artifact.value, gateId);
    const rosterGate = entry.deterministic_gates.gates[index];
    assert(rosterGate.gate_id === gateId && rosterGate.path === `${AI_SEARCH_RAG_PACKAGE_PATH}/gates/${gateId}.gate` && rosterGate.file_sha256 === artifact.file_sha256, `AI Search/RAG gate ${gateId} differs from roster`, "AI_SEARCH_RAG_ROSTER_GATE_INVALID");
    return Object.freeze({gate_id: gateId, file_sha256: artifact.file_sha256, gate_sha256: artifact.value.gate_sha256, next: artifact.value.next});
  });

  const fixtureDirectory = path.join(PACKAGE, "fixtures");
  const fixtureNames = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(fixtureNames.length === AI_SEARCH_RAG_FIXTURE_CLASSES.length && new Set(fixtureNames).size === AI_SEARCH_RAG_FIXTURE_CLASSES.length, "AI Search/RAG hostile fixture inventory is incomplete", "AI_SEARCH_RAG_FIXTURE_INVENTORY_INVALID");
  assert(entry.hostile_fixtures?.status === "BOUND" && entry.hostile_fixtures.fixtures.length === AI_SEARCH_RAG_FIXTURE_CLASSES.length, "AI Search/RAG roster fixture binding is incomplete", "AI_SEARCH_RAG_ROSTER_FIXTURE_INVALID");
  const fixtures = fixtureNames.map((name) => {
    const artifact = readJson(path.join(fixtureDirectory, name), `AI Search/RAG hostile fixture ${name}`);
    const fixture = artifact.value;
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === AI_SEARCH_RAG_BLOCK_ID && fixture.hostile === true && AI_SEARCH_RAG_FIXTURE_CLASSES.includes(fixture.class), `AI Search/RAG fixture ${name} is not canonical`, "AI_SEARCH_RAG_FIXTURE_INVALID");
    assert(fixture.vector?.entrypoint === "control/ai-search-rag-boundary-gate.mjs#evaluateAiSearchRagBoundary" && fixture.vector?.expected_readback?.disposition, `AI Search/RAG fixture ${name} is not executable`, "AI_SEARCH_RAG_FIXTURE_UNBOUND");
    const rosterMatches = entry.hostile_fixtures.fixtures.filter((candidate) => candidate.path === `${AI_SEARCH_RAG_PACKAGE_PATH}/fixtures/${name}`);
    assert(rosterMatches.length === 1 && rosterMatches[0].fixture_id === fixture.fixture_id && rosterMatches[0].file_sha256 === artifact.file_sha256 && rosterMatches[0].expected_outcome === fixture.vector.expected_readback.disposition, `AI Search/RAG fixture ${name} differs from roster`, "AI_SEARCH_RAG_ROSTER_FIXTURE_INVALID");
    return Object.freeze({name, fixture_id: fixture.fixture_id, class: fixture.class, file_sha256: artifact.file_sha256, expected: fixture.vector.expected_readback});
  });

  const hostileManifestArtifact = readJson(path.join(PACKAGE, "hostile-fixtures.manifest.json"), "AI Search/RAG hostile fixture manifest");
  const hostileManifest = hostileManifestArtifact.value;
  assert(hostileManifest.schema === "agentos.ai_search_rag_hostile_fixtures_manifest.v1" && hostileManifest.version === 1 && hostileManifest.block_id === AI_SEARCH_RAG_BLOCK_ID && hostileManifest.entrypoint === "control/ai-search-rag-boundary-gate.mjs#evaluateAiSearchRagBoundary" && hostileManifest.entries.length === AI_SEARCH_RAG_FIXTURE_CLASSES.length && hostileManifest.manifest_sha256 === canonicalDigest(body(hostileManifest, "manifest_sha256")), "AI Search/RAG hostile fixture manifest is invalid", "AI_SEARCH_RAG_FIXTURE_MANIFEST_INVALID");

  const executionArtifact = readJson(path.join(PACKAGE, "gates/execution.json"), "AI Search/RAG gate execution manifest");
  const execution = executionArtifact.value;
  assert(execution.schema === "agentos.ai_search_rag_gate_execution.v1" && execution.version === 1 && execution.block_id === AI_SEARCH_RAG_BLOCK_ID && execution.evaluator_entrypoint === "control/ai-search-rag-package-evaluator.mjs#evaluateAiSearchRagPackage" && JSON.stringify(execution.ordered_gate_ids) === JSON.stringify(AI_SEARCH_RAG_GATE_IDS) && execution.executions.length === AI_SEARCH_RAG_GATE_IDS.length, "AI Search/RAG gate execution manifest is invalid", "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");
  assert(execution.execution_sha256 === canonicalDigest(body(execution, "execution_sha256")), "AI Search/RAG gate execution digest differs", "AI_SEARCH_RAG_GATE_EXECUTION_INVALID");

  const evaluationArtifact = readJson(path.join(PACKAGE, "evaluation.json"), "AI Search/RAG static evaluation dossier");
  const evaluation = evaluationArtifact.value;
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.receipt_id === "specialist-eval.search-rag.v1" && evaluation.block_id === AI_SEARCH_RAG_BLOCK_ID && evaluation.candidate_digest === block.block_sha256 && evaluation.results?.passed === 17 && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "STATIC_PASS_REVIEW_REQUIRED" && evaluation.independence_rule === "AUTHOR_AND_EVALUATOR_MUST_BE_SEPARATE_CONTROLLED_IDENTITIES_BEFORE_ADMISSION", "AI Search/RAG static evaluation dossier is not current", "AI_SEARCH_RAG_EVALUATION_DOSSIER_INVALID");

  const handoffArtifact = readJson(path.join(PACKAGE, "handoff.json"), "AI Search/RAG handoff");
  const handoff = handoffArtifact.value;
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.search-rag.v1" && handoff.block_id === AI_SEARCH_RAG_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === block.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION" && COMMIT.test(handoff.source_commit) && COMMIT.test(handoff.source_tree), "AI Search/RAG handoff is not an immutable candidate receipt", "AI_SEARCH_RAG_HANDOFF_INVALID");
  assert(handoff.changed_paths.every((changedPath) => changedPath.startsWith(`${AI_SEARCH_RAG_PACKAGE_PATH}/`)) && handoff.changed_paths.includes(`${AI_SEARCH_RAG_PACKAGE_PATH}/gates/execution.json`) && handoff.changed_paths.includes(`${AI_SEARCH_RAG_PACKAGE_PATH}/hostile-fixtures.manifest.json`), "AI Search/RAG handoff escapes package scope or omits package execution artifacts", "AI_SEARCH_RAG_HANDOFF_INVALID");
  assert(entry.required_evidence_handoff?.handoff_path === `${AI_SEARCH_RAG_PACKAGE_PATH}/handoff.json` && entry.required_evidence_handoff.handoff_file_sha256 === handoffArtifact.file_sha256 && entry.required_evidence_handoff.independent_review_required === true, "AI Search/RAG roster handoff binding is stale", "AI_SEARCH_RAG_HANDOFF_PROVENANCE_INVALID");

  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot");
  const model = resolveModelPreflight(modelArtifact);
  const modelRoute = Object.freeze({task_class: entry.model_route.task_class, minimum_capability: entry.model_route.minimum_capability, required_capabilities: Object.freeze([...entry.model_route.required_capabilities]), route_source: entry.model_route.route_source, snapshot_sha256: model.snapshot_sha256, snapshot_status: model.snapshot_status, model_file_sha256: model.model_file_sha256});
  const modelRouteSha256 = canonicalDigest(modelRoute);
  const routerFileSha256 = fileSha(UPSTREAM_ROUTER_PATH);
  const routerResult = canonicalRouterResult(block.block_sha256);
  const context = Object.freeze({block_sha256: block.block_sha256, source_manifest_sha256: source.manifest_sha256, standard_block_sha256: standards[0].block_sha256, standard_source_manifest_sha256: standards[0].source_manifest_sha256, genai_standard_block_sha256: standards[1].block_sha256, genai_standard_source_manifest_sha256: standards[1].source_manifest_sha256, gate_manifest_sha256: manifest.manifest_sha256, fixture_manifest_sha256: hostileManifest.manifest_sha256, model_route_sha256: modelRouteSha256, upstream_router_file_sha256: routerFileSha256, upstream_router_result_sha256: routerResult.result_sha256, custody_ref: AI_SEARCH_RAG_CUSTODY_REF, memory_write_allowed: false, context_invalidation_rule: "INVALIDATE_ON_BLOCK_SOURCE_GATE_FIXTURE_MODEL_OR_REGISTRY_CHANGE"});
  const contextSha256 = canonicalDigest(context);

  return Object.freeze({
    repository_root: ROOT,
    package_path: AI_SEARCH_RAG_PACKAGE_PATH,
    block_sha256: block.block_sha256,
    block_file_sha256: blockArtifact.file_sha256,
    source_manifest_sha256: source.manifest_sha256,
    source_file_sha256: sourceArtifact.file_sha256,
    source_identity: AI_SEARCH_RAG_SOURCE_IDENTITY,
    source_version: AI_SEARCH_RAG_SOURCE_VERSION,
    source_effective_date: nist.effective_date,
    source_retrieved_date: nist.retrieved_date,
    standard_block_sha256: standards[0].block_sha256,
    standard_source_manifest_sha256: standards[0].source_manifest_sha256,
    genai_standard_block_sha256: standards[1].block_sha256,
    genai_standard_source_manifest_sha256: standards[1].source_manifest_sha256,
    gate_manifest_sha256: manifest.manifest_sha256,
    gate_manifest_file_sha256: manifestArtifact.file_sha256,
    gates: Object.freeze(gates),
    fixtures: Object.freeze(fixtures),
    model: modelRoute,
    model_route_sha256: modelRouteSha256,
    model_preflight_status: model.preflight_status,
    model_blocker: model.blocker,
    acceptance_ledger_file_sha256: acceptanceArtifact.file_sha256,
    router_file_sha256: routerFileSha256,
    router_result_sha256: routerResult.result_sha256,
    context: context,
    context_sha256: contextSha256,
    custody_ref: AI_SEARCH_RAG_CUSTODY_REF,
    protected_blockers: AI_SEARCH_RAG_PROTECTED_BLOCKERS,
    audit_started: false,
    independent_reviewer_required: true,
  });
}

export function assertAiSearchRagCanonicalEvidence(evidence, authority = resolveAiSearchRagCanonicalAuthority()) {
  assert(evidence.candidate_digest === authority.block_sha256, "AI Search/RAG candidate digest is not canonical", "AI_SEARCH_RAG_CANDIDATE_BINDING_INVALID");
  assert(evidence.authority_scope === "AI_SEARCH_RAG" && evidence.scope === "NARROW" && evidence.custody_ref === authority.custody_ref, "AI Search/RAG scope or custody is not canonical", "AI_SEARCH_RAG_CUSTODY_BINDING_INVALID");
  assert(evidence.standard_block_sha256 === authority.standard_block_sha256 && evidence.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256 && evidence.genai_standard_block_sha256 === authority.genai_standard_block_sha256 && evidence.genai_standard_source_manifest_sha256 === authority.genai_standard_source_manifest_sha256, "AI Search/RAG standard evidence is not canonical", "AI_SEARCH_RAG_STANDARD_BINDING_INVALID");
  assert(evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_effective_date === authority.source_effective_date && evidence.source_retrieved_date === authority.source_retrieved_date, "AI Search/RAG source evidence is not canonical", "AI_SEARCH_RAG_SOURCE_BINDING_INVALID");
  assert(evidence.model_snapshot_sha256 === authority.model.snapshot_sha256 && evidence.model_route_sha256 === authority.model_route_sha256, "AI Search/RAG model route is not canonical", "AI_SEARCH_RAG_MODEL_ROUTE_UNBOUND");
  assert(evidence.context_receipt_sha256 === authority.context_sha256 && evidence.upstream_router_result_sha256 === authority.router_result_sha256, "AI Search/RAG context receipt is not canonical", "AI_SEARCH_RAG_CONTEXT_RECEIPT_INVALID");
  assert(evidence.memory_context_status === "INVALIDATED_ON_CANDIDATE_CHANGE" && evidence.context_invalidation_status === "BOUND" && evidence.memory_write_requested === false, "AI Search/RAG memory/context invalidation is not bound", "AI_SEARCH_RAG_CONTEXT_INVALIDATION_INVALID");
  assert(evidence.model_policy_status === authority.model_preflight_status && evidence.model_route_status === (authority.model_preflight_status === "BLOCKED_EXACT" ? "BLOCKED_EXACT" : "BOUND"), "AI Search/RAG protected model preflight is not canonical", "AI_SEARCH_RAG_MODEL_PREFLIGHT_INVALID");
  return authority;
}
