#!/usr/bin/env node

/*
 * Repository-bound authority for the Cloudflare Cache Rules specialist.
 *
 * The boundary receives typed evidence, but the package, source lock, model
 * route, standard, roster, gate pack, hostile fixtures, and provider router
 * are resolved from this repository.  Caller-supplied PASS values therefore
 * cannot substitute a different candidate or make stale evidence current.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateProviderEdgeRouterBoundary, PROVIDER_EDGE_ROUTER_BOUNDARY_SCHEMA} from "./provider-edge-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const CLOUDFLARE_CACHE_PACKAGE_PATH = "specialist-blocks/wave-02/cloudflare-cache";
export const CLOUDFLARE_CACHE_BLOCK_ID = "specialist.platform.cloudflare-cache";
export const CLOUDFLARE_CACHE_STABLE_AGENT_ID = "AGENT.PLATFORM_CLOUDFLARE_CACHE";
export const CLOUDFLARE_CACHE_STANDARD_BLOCK_ID = "specialist.standard.cloudflare-cache-current";
export const CLOUDFLARE_CACHE_STANDARD_ID = "source.cloudflare-cache-rules";
export const CLOUDFLARE_CACHE_SOURCE_ID = "source.cloudflare-cache-rules";
export const CLOUDFLARE_CACHE_SOURCE_VERSION = "current";
export const CLOUDFLARE_CACHE_CUSTODY_OWNER = CLOUDFLARE_CACHE_STABLE_AGENT_ID;
export const CLOUDFLARE_CACHE_CUSTODY_REF = "opaque:CLOUDFLARE_CACHE.CUSTODY";
export const CLOUDFLARE_CACHE_MODEL_TASK_CLASS = "NARROW_CODING";
export const CLOUDFLARE_CACHE_MODEL_CAPABILITY_FLOOR = 49;
export const CLOUDFLARE_CACHE_MODEL_CAPABILITIES = Object.freeze(["CODE", "TOOLS"]);
export const CLOUDFLARE_CACHE_MODEL_SNAPSHOT_SHA256 = "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27";
export const CLOUDFLARE_CACHE_MODEL_FILE_SHA256 = "203d555399fb84345cede6f122fff3568272a9dda27a350ff04d7387084b392d";
export const CLOUDFLARE_CACHE_STANDARD_BLOCK_SHA256 = "fd2aee0c3d782a3f37b68a188e314c754ddb25ed3ccde036c9853eced75c9fd0";
export const CLOUDFLARE_CACHE_STANDARD_SOURCE_MANIFEST_SHA256 = "5b0be23138cb3082aaba736daf69ddfbfc814c978f143af844299df63e5d0adf";
export const CLOUDFLARE_CACHE_STANDARD_FILE_SHA256 = "6957f3916fa9589b673710c533ab28a559ddd74dd85261615af6dcaff7c287a4";
export const CLOUDFLARE_CACHE_UPSTREAM_ROUTER_FILE_SHA256 = "1e7cbe3898ba80c6dbf10dd09a8c1b687c097134992c1da78a3c904066a23b8b";

/* Filled with observed bytes before the candidate is frozen.  Null is only
 * tolerated during local construction; a committed candidate must contain
 * real, non-placeholder digests in every slot. */
export const CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256 = Object.freeze({
  block: "c7e9a4de344e5e175c8285d79f8ef9ffc14621c6651689873bed4c09ee20dd10",
  block_semantic: "386617a5518625c226bd8b863163a2ab47fa7b33c14456aa13ca5f9d1ba6bab6",
  source_lock: "11afefe45431fb128b0f38439d152bddd05513a96368aa09bac53afa124669c6",
  gate_manifest: "d4c77fd720b8b5a1e593c9bb78b468811d1ee4fd8cfbbaad389dd914923894f9",
  gate_execution: "9b05322de737ae408b6427dfc55f5425ce944ece487ec0d862ffb8a35735fa06",
  evaluation: "61711b0159e409d36ea5bef90f272efba35f441162bff21e8a6fd9735ffb5b08",
  handoff: "1a863a13b029fc962b7d2ceaaac47bae4f6b836cdb133b6ce5f286eeb7aa59a5",
  roster_file: "4149778d219e26e46ac4529af607136a7da5332cb0b0b2e9d708eb58b13b7219",
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, CLOUDFLARE_CACHE_PACKAGE_PATH);
const ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const ACCEPTANCE_LEDGER_PATH = path.join(ROOT, "specialist-blocks/registry/accepted-agent-receipts.v1.json");
const MODEL_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const STANDARD_PATH = path.join(ROOT, "specialist-blocks/standards/cloudflare-cache-current/block.json");
const STANDARD_SOURCES_PATH = path.join(ROOT, "specialist-blocks/standards/cloudflare-cache-current/sources.lock");
const UPSTREAM_ROUTER_PATH = path.join(ROOT, "control/provider-edge-router-boundary-gate.mjs");
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
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
  "specialist.platform.provider-edge-router",
  "specialist.standard.cloudflare-cache-current",
]);

function fail(message, code = "CLOUDFLARE_CACHE_CANONICAL_AUTHORITY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(value, message, code) {
  if (!value) fail(message, code);
}

function sha(value, label) {
  assert(typeof value === "string" && SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} must be a real SHA-256`, "CLOUDFLARE_CACHE_CANONICAL_DIGEST_INVALID");
}

function fileSha(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function body(value, field) {
  const copy = structuredClone(value);
  copy[field] = null;
  return copy;
}

function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}

function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "CLOUDFLARE_CACHE_CANONICAL_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "CLOUDFLARE_CACHE_CANONICAL_SCHEMA_INVALID");
}

function pin(actual, expected, label) {
  if (expected !== null) {
    sha(expected, `${label} pinned digest`);
    assert(actual === expected, `${label} is not the pinned candidate`, "CLOUDFLARE_CACHE_CANONICAL_PROVENANCE_INVALID");
  }
}

function validDate(value, label, nowMs) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "CLOUDFLARE_CACHE_SOURCE_DATE_INVALID");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  assert(time <= nowMs, `${label} is future-dated`, "CLOUDFLARE_CACHE_SOURCE_FUTURE");
  return time;
}

function freshDate(value, label, nowMs, maxAgeDays = 31) {
  const time = validDate(value, label, nowMs);
  assert(nowMs - time <= maxAgeDays * 86_400_000, `${label} is stale`, "CLOUDFLARE_CACHE_SOURCE_STALE");
  return time;
}

function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.block_id === expectedId && block.schema === "agentos.specialist_block.v1" && block.lifecycle === "CANDIDATE" && block.activation === "OFF", `${label} identity or inert lifecycle differs`, "CLOUDFLARE_CACHE_CANONICAL_BINDING_INVALID");
  sha(block.block_sha256, `${label} digest`);
  assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), `${label} digest does not match its bytes`, "CLOUDFLARE_CACHE_CANONICAL_DIGEST_INVALID");
  return block;
}

function expectedGateNext(index, outcome) {
  if (outcome === "NO") return "OUTCOME:DENY";
  if (outcome === "UNKNOWN") return "OUTCOME:UNKNOWN_DEPENDENT_ONLY";
  if (index === GATE_IDS.length - 1) return "OUTCOME:ROUTE";
  return GATE_IDS[index + 1];
}

function checkGateSemantics(gates, manifest) {
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.version === 1 && manifest.block_id === CLOUDFLARE_CACHE_BLOCK_ID, "Cloudflare Cache gate manifest identity differs", "CLOUDFLARE_CACHE_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(GATE_IDS), "Cloudflare Cache gate order differs", "CLOUDFLARE_CACHE_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "Cloudflare Cache gate outcomes differ", "CLOUDFLARE_CACHE_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(GATE_IDS.map((id) => `gates/${id}.gate`)), "Cloudflare Cache gate paths differ", "CLOUDFLARE_CACHE_GATE_SEMANTICS_INVALID");
  assert(manifest.manifest_sha256 === canonicalDigest(body(manifest, "manifest_sha256")), "Cloudflare Cache gate manifest digest differs", "CLOUDFLARE_CACHE_GATE_MANIFEST_INVALID");
  const expectedRules = {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"};
  const semantic = [];
  gates.forEach((gate, index) => {
    exactKeys(gate, ["schema", "version", "gate_id", "block_id", "status", "answer_type", "allowed_outcomes", "question", "evidence", "next", "rules", "gate_sha256"], `Cloudflare Cache gate ${gate.gate_id}`);
    assert(gate.gate_id === GATE_IDS[index] && gate.block_id === CLOUDFLARE_CACHE_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Cloudflare Cache gate ${gate.gate_id} identity differs`, "CLOUDFLARE_CACHE_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `Cloudflare Cache gate ${gate.gate_id} outcomes differ`, "CLOUDFLARE_CACHE_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.rules) === JSON.stringify(expectedRules), `Cloudflare Cache gate ${gate.gate_id} rules are not fail-closed`, "CLOUDFLARE_CACHE_GATE_SEMANTICS_INVALID");
    for (const outcome of ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]) assert(gate.next?.[outcome] === expectedGateNext(index, outcome), `Cloudflare Cache gate ${gate.gate_id} ${outcome} branch differs`, "CLOUDFLARE_CACHE_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `Cloudflare Cache gate ${gate.gate_id}`);
    assert(gate.gate_sha256 === canonicalDigest(body(gate, "gate_sha256")), `Cloudflare Cache gate ${gate.gate_id} digest differs`, "CLOUDFLARE_CACHE_GATE_DIGEST_INVALID");
    semantic.push({gate_id: gate.gate_id, gate_sha256: gate.gate_sha256, next: gate.next, rules: gate.rules, evidence: gate.evidence});
  });
  return canonicalDigest(semantic);
}

function canonicalRouterResult(candidateDigest) {
  const input = {
    schema: PROVIDER_EDGE_ROUTER_BOUNDARY_SCHEMA,
    version: 1,
    request_kind: "ROUTE_PROVIDER_EDGE",
    evidence: {
      authority_status: "CURRENT",
      custody_status: "BOUND",
      custody_owner: "AGENT.PLATFORM_PROVIDER_EDGE_ROUTER",
      custody_ref: "opaque:PROVIDER_EDGE_ROUTER.CUSTODY",
      source_status: "CURRENT",
      source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW",
      source_version: "1",
      provider_identity: "CLOUDFLARE",
      provider_version: "CURRENT",
      signal: "EDGE.CLOUDFLARE_CACHE",
      target_ref: CLOUDFLARE_CACHE_BLOCK_ID,
      context_complete: true,
      scope: "NARROW",
      requested_action: "CLASSIFY",
      requested_tools: ["READ_SOURCE", "READ_CONTEXT"],
      self_acceptance: false,
      scope_expanded: false,
      authority_conflict: false,
      project_data_present: false,
      secret_data_present: false,
      provider_evidence: "BOUNDED",
    },
  };
  const result = evaluateProviderEdgeRouterBoundary(input);
  assert(result.disposition === "ROUTE" && result.route === "SPECIALIST_HANDOFF" && result.routing_allowed === true && result.selected_specialist === CLOUDFLARE_CACHE_BLOCK_ID, "Canonical provider-edge router did not produce the Cloudflare route", "CLOUDFLARE_CACHE_UPSTREAM_ROUTER_INVALID");
  assert(result.input_sha256 === canonicalDigest(input) && result.result_sha256 === canonicalDigest({...result, result_sha256: null}), "Canonical provider-edge router receipt is not self-consistent", "CLOUDFLARE_CACHE_UPSTREAM_ROUTER_INVALID");
  assert(typeof candidateDigest === "string" && SHA256.test(candidateDigest), "Candidate digest was not bound to the upstream route", "CLOUDFLARE_CACHE_CANDIDATE_BINDING_INVALID");
  return result;
}

function validateAcceptanceLedger(artifact) {
  const ledger = artifact.value;
  assert(ledger.schema === "agentos.reusable_agent_acceptance_ledger.v1" && ledger.version === 1 && ledger.status === "READ_ONLY_INDEPENDENT_EVALUATION_INDEX" && ledger.project_agnostic === true && ledger.ledger_sha256 === canonicalDigest(body(ledger, "ledger_sha256")), "Cloudflare Cache acceptance ledger identity is invalid", "CLOUDFLARE_CACHE_ACCEPTANCE_LEDGER_INVALID");
  const rows = ledger.entries?.filter((entry) => entry.stable_agent_id === CLOUDFLARE_CACHE_STABLE_AGENT_ID) ?? [];
  assert(rows.length === 0, "Cloudflare Cache candidate has an acceptance row before independent admission", "CLOUDFLARE_CACHE_ACCEPTANCE_RECEIPT_INVALID");
}

export function resolveCloudflareCacheCanonicalAuthority() {
  const nowMs = Date.now();
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "Cloudflare Cache block");
  const block = checkBlock(blockArtifact, CLOUDFLARE_CACHE_BLOCK_ID, "Cloudflare Cache block");
  pin(blockArtifact.file_sha256, CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.block, "Cloudflare Cache block file");
  pin(block.block_sha256, CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.block_semantic, "Cloudflare Cache block semantic");

  const rosterArtifact = readJson(ROSTER_PATH, "Reusable-agent roster");
  pin(rosterArtifact.file_sha256, CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.roster_file, "Reusable-agent roster file");
  const roster = rosterArtifact.value;
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === CLOUDFLARE_CACHE_STABLE_AGENT_ID);
  assert(entry && entry.canonical_block_id === CLOUDFLARE_CACHE_BLOCK_ID && entry.package_path === CLOUDFLARE_CACHE_PACKAGE_PATH, "Cloudflare Cache roster binding is missing or substituted", "CLOUDFLARE_CACHE_ROSTER_BINDING_INVALID");
  assert(entry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION" && entry.qa_state === "STATIC_PASS_REVIEW_REQUIRED" && entry.independent_evaluation_state === "STATIC_PASS_REVIEW_REQUIRED", "Cloudflare Cache roster state is not inert candidate state", "CLOUDFLARE_CACHE_ROSTER_STATE_INVALID");
  assert(entry.model_route?.task_class === CLOUDFLARE_CACHE_MODEL_TASK_CLASS && entry.model_route.minimum_capability === CLOUDFLARE_CACHE_MODEL_CAPABILITY_FLOOR && JSON.stringify(entry.model_route.required_capabilities) === JSON.stringify(CLOUDFLARE_CACHE_MODEL_CAPABILITIES) && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "Cloudflare Cache model route is not canonical", "CLOUDFLARE_CACHE_MODEL_ROUTE_INVALID");
  assert(entry.candidate_digest === block.block_sha256, "Cloudflare Cache roster candidate digest differs from block", "CLOUDFLARE_CACHE_ROSTER_BINDING_INVALID");

  const acceptanceArtifact = readJson(ACCEPTANCE_LEDGER_PATH, "Reusable-agent acceptance ledger");
  validateAcceptanceLedger(acceptanceArtifact);

  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "Cloudflare Cache source lock");
  pin(sourceArtifact.file_sha256, CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.source_lock, "Cloudflare Cache source lock file");
  const source = sourceArtifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.version === 1 && source.block_id === CLOUDFLARE_CACHE_BLOCK_ID && source.manifest_sha256 === canonicalDigest(body(source, "manifest_sha256")), "Cloudflare Cache source lock identity or digest is invalid", "CLOUDFLARE_CACHE_SOURCE_LOCK_INVALID");
  const atomic = source.sources?.find((candidate) => candidate.source_id === "source.atomic-specialization-law");
  const cloudflare = source.sources?.find((candidate) => candidate.source_id === CLOUDFLARE_CACHE_SOURCE_ID);
  assert(source.sources?.length === 2 && atomic && cloudflare, "Cloudflare Cache source lock coverage is incomplete", "CLOUDFLARE_CACHE_SOURCE_LOCK_INVALID");
  assert(atomic.immutable_identity === "agentos-atomic-specialization-law-v1" && atomic.authority_class === "AGENTOS_PORTABLE" && atomic.version === "1", "Atomic specialization source is not canonical", "CLOUDFLARE_CACHE_SOURCE_IDENTITY_INVALID");
  assert(cloudflare.title === "Cloudflare Cache Rules" && cloudflare.publisher === "Cloudflare" && cloudflare.url === "https://developers.cloudflare.com/cache/how-to/cache-rules/" && cloudflare.version === CLOUDFLARE_CACHE_SOURCE_VERSION && cloudflare.immutable_identity === "cloudflare-cache-rules-current-2026-08-11" && cloudflare.authority_class === "PRIMARY_DESCRIPTIVE" && cloudflare.effective_date === null, "Cloudflare Cache primary source identity is not canonical", "CLOUDFLARE_CACHE_SOURCE_IDENTITY_INVALID");
  freshDate(atomic.retrieved_date, "Atomic source retrieved date", nowMs);
  freshDate(cloudflare.retrieved_date, "Cloudflare Cache source retrieved date", nowMs);

  const standardArtifact = readJson(STANDARD_PATH, "Cloudflare Cache standard block");
  const standard = checkBlock(standardArtifact, CLOUDFLARE_CACHE_STANDARD_BLOCK_ID, "Cloudflare Cache standard block");
  pin(standardArtifact.file_sha256, CLOUDFLARE_CACHE_STANDARD_FILE_SHA256, "Cloudflare Cache standard block file");
  assert(standard.block_sha256 === CLOUDFLARE_CACHE_STANDARD_BLOCK_SHA256, "Cloudflare Cache standard block is not the current canonical version", "CLOUDFLARE_CACHE_STANDARD_BINDING_INVALID");
  const standardSourcesArtifact = readJson(STANDARD_SOURCES_PATH, "Cloudflare Cache standard source manifest");
  const standardSources = standardSourcesArtifact.value;
  assert(standardSources.manifest_sha256 === CLOUDFLARE_CACHE_STANDARD_SOURCE_MANIFEST_SHA256 && standardSources.manifest_sha256 === canonicalDigest(body(standardSources, "manifest_sha256")), "Cloudflare Cache standard source manifest is not canonical", "CLOUDFLARE_CACHE_STANDARD_SOURCE_INVALID");

  const manifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "Cloudflare Cache gate manifest");
  pin(manifestArtifact.file_sha256, CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.gate_manifest, "Cloudflare Cache gate manifest file");
  const manifest = manifestArtifact.value;
  const gates = GATE_IDS.map((gateId, index) => {
    const artifact = readJson(path.join(PACKAGE, "gates", `${gateId}.gate`), `Cloudflare Cache gate ${gateId}`);
    const rosterGate = entry.deterministic_gates?.gates?.[index];
    assert(rosterGate?.gate_id === gateId && rosterGate.path === `${CLOUDFLARE_CACHE_PACKAGE_PATH}/gates/${gateId}.gate` && rosterGate.file_sha256 === artifact.file_sha256, `Cloudflare Cache gate ${gateId} differs from the canonical roster`, "CLOUDFLARE_CACHE_GATE_PROVENANCE_INVALID");
    return artifact.value;
  });
  assert(entry.deterministic_gates?.status === "BOUND" && entry.deterministic_gates.manifest_path === `${CLOUDFLARE_CACHE_PACKAGE_PATH}/gates/manifest.json` && entry.deterministic_gates.gates?.length === GATE_IDS.length, "Cloudflare Cache roster gate provenance is incomplete", "CLOUDFLARE_CACHE_ROSTER_GATE_PROVENANCE_INVALID");
  const gateSemanticInventorySha256 = checkGateSemantics(gates, manifest);

  const fixtureDirectory = path.join(PACKAGE, "fixtures");
  const fixtureNames = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(fixtureNames.length === FIXTURE_CLASSES.length && new Set(fixtureNames).size === FIXTURE_CLASSES.length, "Cloudflare Cache hostile fixture inventory is incomplete", "CLOUDFLARE_CACHE_FIXTURE_INVENTORY_INVALID");
  const rosterFixtures = entry.hostile_fixtures;
  assert(rosterFixtures?.status === "BOUND" && rosterFixtures.fixtures?.length === FIXTURE_CLASSES.length, "Cloudflare Cache roster fixture provenance is incomplete", "CLOUDFLARE_CACHE_ROSTER_FIXTURE_PROVENANCE_INVALID");
  const fixtures = fixtureNames.map((name) => {
    const artifact = readJson(path.join(fixtureDirectory, name), `Cloudflare Cache hostile fixture ${name}`);
    const fixture = artifact.value;
    assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === CLOUDFLARE_CACHE_BLOCK_ID && fixture.hostile === true, `Cloudflare Cache fixture ${name} is not operational`, "CLOUDFLARE_CACHE_FIXTURE_UNBOUND");
    assert(FIXTURE_CLASSES.includes(fixture.class) && fixture.fixture_id === `cloudflare-cache-${fixture.class}`, `Cloudflare Cache fixture ${name} identity is invalid`, "CLOUDFLARE_CACHE_FIXTURE_INVALID");
    assert(fixture.expected && JSON.stringify(Object.keys(fixture.expected).sort(compareUtf8)) === JSON.stringify(["disposition", "error_code", "route"].sort(compareUtf8)) && ["DENY", "ROUTE"].includes(fixture.expected.disposition), `Cloudflare Cache fixture ${name} expected readback is invalid`, "CLOUDFLARE_CACHE_FIXTURE_EXPECTATION_INVALID");
    assert(fixture.vector && JSON.stringify(Object.keys(fixture.vector).sort(compareUtf8)) === JSON.stringify(["entrypoint", "expected_readback", "input"].sort(compareUtf8)) && fixture.vector.entrypoint === "control/cloudflare-cache-boundary-gate.mjs#evaluateCloudflareCacheBoundary", `Cloudflare Cache fixture ${name} vector entrypoint is not canonical`, "CLOUDFLARE_CACHE_FIXTURE_VECTOR_INVALID");
    assert(JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Cloudflare Cache fixture ${name} expected readback is caller-divergent`, "CLOUDFLARE_CACHE_FIXTURE_VECTOR_INVALID");
    assert(fixture.vector.input?.schema === "agentos.cloudflare_cache_boundary_input.v1" && fixture.vector.input.version === 1 && fixture.vector.input.evidence?.candidate_digest === block.block_sha256 && fixture.vector.input.evidence?.context_receipt_sha256, `Cloudflare Cache fixture ${name} does not carry a complete real input`, "CLOUDFLARE_CACHE_FIXTURE_INPUT_INVALID");
    const rosterMatches = rosterFixtures.fixtures.filter((candidate) => candidate.path === `${CLOUDFLARE_CACHE_PACKAGE_PATH}/fixtures/${name}`);
    assert(rosterMatches.length === 1 && rosterMatches[0].fixture_id === fixture.fixture_id && rosterMatches[0].file_sha256 === artifact.file_sha256 && rosterMatches[0].expected_outcome === fixture.expected.disposition, `Cloudflare Cache fixture ${name} differs from the canonical roster`, "CLOUDFLARE_CACHE_FIXTURE_PROVENANCE_INVALID");
    return Object.freeze({fixture_id: fixture.fixture_id, class: fixture.class, file_sha256: artifact.file_sha256, expected: fixture.expected, input: fixture.vector.input});
  });
  assert(new Set(fixtures.map((fixture) => fixture.class)).size === FIXTURE_CLASSES.length, "Cloudflare Cache fixture classes are aliased", "CLOUDFLARE_CACHE_FIXTURE_ALIAS");

  const handoffArtifact = readJson(path.join(PACKAGE, "handoff.json"), "Cloudflare Cache handoff");
  pin(handoffArtifact.file_sha256, CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.handoff, "Cloudflare Cache handoff file");
  assert(entry.required_evidence_handoff?.handoff_path === `${CLOUDFLARE_CACHE_PACKAGE_PATH}/handoff.json` && entry.required_evidence_handoff.handoff_file_sha256 === handoffArtifact.file_sha256, "Cloudflare Cache roster handoff provenance is stale", "CLOUDFLARE_CACHE_HANDOFF_PROVENANCE_INVALID");

  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot");
  pin(modelArtifact.file_sha256, CLOUDFLARE_CACHE_MODEL_FILE_SHA256, "Global model-policy snapshot file");
  const model = modelArtifact.value;
  assert(model.snapshot_sha256 === CLOUDFLARE_CACHE_MODEL_SNAPSHOT_SHA256, "Global model-policy snapshot digest differs", "CLOUDFLARE_CACHE_MODEL_POLICY_PROVENANCE_INVALID");
  validateModelPolicySnapshot(model, {requireActive: false});
  assert(model.project_agnostic === true && model.visibility === "PRIVATE_GLOBAL_GOVERNANCE" && model.contains_consumer_context === false && model.raw_browsing_transcripts === false, "Global model-policy snapshot crosses the privacy boundary", "CLOUDFLARE_CACHE_MODEL_POLICY_INVALID");
  const codingTask = model.task_classes?.find((task) => task.task_class === CLOUDFLARE_CACHE_MODEL_TASK_CLASS);
  assert(codingTask && codingTask.minimum_capability_score === CLOUDFLARE_CACHE_MODEL_CAPABILITY_FLOOR && codingTask.minimum_context_tokens === 64000 && JSON.stringify(codingTask.required_capabilities) === JSON.stringify(CLOUDFLARE_CACHE_MODEL_CAPABILITIES) && JSON.stringify(codingTask.preferred_models) === JSON.stringify(["gpt-5.6-luna", "gpt-5.6-terra"]) && JSON.stringify(codingTask.fallback_models) === JSON.stringify(["gpt-5.6-sol"]), "NARROW_CODING model-policy route semantics are not canonical", "CLOUDFLARE_CACHE_MODEL_ROUTE_SEMANTICS_INVALID");
  const modelRoute = Object.freeze({task_class: entry.model_route.task_class, minimum_capability: entry.model_route.minimum_capability, required_capabilities: Object.freeze([...entry.model_route.required_capabilities]), route_source: entry.model_route.route_source, snapshot_sha256: model.snapshot_sha256, snapshot_status: model.status, model_file_sha256: modelArtifact.file_sha256});
  const modelRouteSha256 = canonicalDigest(modelRoute);

  const routerFileSha256 = fileSha(UPSTREAM_ROUTER_PATH);
  assert(routerFileSha256 === CLOUDFLARE_CACHE_UPSTREAM_ROUTER_FILE_SHA256, "Provider-edge router source is not the pinned canonical artifact", "CLOUDFLARE_CACHE_UPSTREAM_ROUTER_PROVENANCE_INVALID");
  const routerResult = canonicalRouterResult(block.block_sha256);
  const contextSha256 = canonicalDigest({
    block_sha256: block.block_sha256,
    source_manifest_sha256: source.manifest_sha256,
    source_identity: CLOUDFLARE_CACHE_SOURCE_ID,
    source_version: CLOUDFLARE_CACHE_SOURCE_VERSION,
    standard_block_sha256: standard.block_sha256,
    standard_source_manifest_sha256: standardSources.manifest_sha256,
    authority_scope: "CLOUDFLARE_CACHE_RULES",
    scope: "NARROW",
    cache_rule_status: "BOUND",
    cache_scope_status: "BOUND",
    provider_identity: "CLOUDFLARE",
    provider_version: "CURRENT",
    custody_ref: CLOUDFLARE_CACHE_CUSTODY_REF,
    memory_binding: "TYPED_HANDOFF_ONLY",
    lifecycle_revision: block.revision,
    router_file_sha256: routerFileSha256,
    router_result_sha256: routerResult.result_sha256,
    model_route_sha256: modelRouteSha256,
  });
  for (const fixture of fixtures) {
    const evidence = fixture.input.evidence;
    assert(evidence.candidate_digest === block.block_sha256 && evidence.source_manifest_sha256 === source.manifest_sha256 && evidence.standard_block_sha256 === standard.block_sha256 && evidence.standard_source_manifest_sha256 === standardSources.manifest_sha256 && evidence.model_snapshot_sha256 === model.snapshot_sha256 && evidence.model_route_sha256 === modelRouteSha256 && evidence.context_receipt_sha256 === contextSha256 && evidence.upstream_router_result_sha256 === routerResult.result_sha256, `Cloudflare Cache fixture ${fixture.class} is not bound to current authority`, "CLOUDFLARE_CACHE_FIXTURE_CONTEXT_INVALID");
  }

  return Object.freeze({
    repository_root: ROOT,
    package_path: CLOUDFLARE_CACHE_PACKAGE_PATH,
    block_sha256: block.block_sha256,
    block_file_sha256: blockArtifact.file_sha256,
    source_manifest_sha256: source.manifest_sha256,
    source_file_sha256: sourceArtifact.file_sha256,
    source_identity: CLOUDFLARE_CACHE_SOURCE_ID,
    source_version: CLOUDFLARE_CACHE_SOURCE_VERSION,
    source_effective_date: cloudflare.effective_date,
    source_retrieved_date: cloudflare.retrieved_date,
    standard_block_sha256: standard.block_sha256,
    standard_source_manifest_sha256: standardSources.manifest_sha256,
    gate_manifest_sha256: manifest.manifest_sha256,
    gate_manifest_file_sha256: manifestArtifact.file_sha256,
    gate_semantic_inventory_sha256: gateSemanticInventorySha256,
    fixtures: Object.freeze(fixtures),
    gates: Object.freeze(gates),
    model: modelRoute,
    model_route_sha256: modelRouteSha256,
    router_file_sha256: routerFileSha256,
    router_result_sha256: routerResult.result_sha256,
    context_sha256: contextSha256,
    custody_owner: CLOUDFLARE_CACHE_CUSTODY_OWNER,
    custody_ref: CLOUDFLARE_CACHE_CUSTODY_REF,
    required_blocks: REQUIRED_BLOCKS,
    evaluation_file_sha256: fileSha(path.join(PACKAGE, "evaluation.json")),
    handoff_file_sha256: handoffArtifact.file_sha256,
    gate_execution_file_sha256: fileSha(path.join(PACKAGE, "gates/execution.json")),
  });
}

export function assertCloudflareCacheCanonicalEvidence(evidence, authority = resolveCloudflareCacheCanonicalAuthority()) {
  assert(evidence.candidate_digest === authority.block_sha256 && evidence.candidate_status === "CURRENT_CANDIDATE", "Cloudflare Cache candidate is not the canonical inert candidate", "CLOUDFLARE_CACHE_CANDIDATE_BINDING_INVALID");
  assert(evidence.authority_status === "CURRENT" && evidence.custody_status === "BOUND" && evidence.custody_owner === authority.custody_owner && evidence.custody_ref === authority.custody_ref, "Cloudflare Cache authority custody is not canonical", "CLOUDFLARE_CACHE_CUSTODY_BINDING_INVALID");
  assert(evidence.authority_scope === "CLOUDFLARE_CACHE_RULES" && evidence.scope === "NARROW", "Cloudflare Cache authority scope is not canonical", "CLOUDFLARE_CACHE_AUTHORITY_SCOPE_INVALID");
  assert(evidence.source_status === "CURRENT_VERIFIED" && evidence.source_manifest_sha256 === authority.source_manifest_sha256 && evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_effective_date === authority.source_effective_date && evidence.source_retrieved_date === authority.source_retrieved_date, "Cloudflare Cache source evidence is not current and exact", "CLOUDFLARE_CACHE_SOURCE_IDENTITY_INVALID");
  assert(evidence.standard_id === CLOUDFLARE_CACHE_SOURCE_ID && evidence.standard_version === CLOUDFLARE_CACHE_SOURCE_VERSION && evidence.standard_block_sha256 === authority.standard_block_sha256 && evidence.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256, "Cloudflare Cache standard evidence is not canonical", "CLOUDFLARE_CACHE_STANDARD_BINDING_INVALID");
  assert(evidence.provider_identity === "CLOUDFLARE" && evidence.provider_version === "CURRENT" && evidence.signal === "EDGE.CLOUDFLARE_CACHE" && evidence.signal_status === "BOUND", "Cloudflare Cache provider signal is not canonical", "CLOUDFLARE_CACHE_PROVIDER_BINDING_INVALID");
  assert(evidence.cache_rule_status === "BOUND" && evidence.cache_scope_status === "BOUND", "Cloudflare Cache context scope is not bound", "CLOUDFLARE_CACHE_CONTEXT_BINDING_INVALID");
  assert(evidence.model_policy_status === authority.model.snapshot_status && evidence.model_snapshot_sha256 === authority.model.snapshot_sha256 && evidence.model_task_class === authority.model.task_class && evidence.model_capability_floor === authority.model.minimum_capability && JSON.stringify(evidence.model_required_capabilities) === JSON.stringify(authority.model.required_capabilities) && evidence.model_route_sha256 === authority.model_route_sha256 && evidence.model_route_status === "BOUND", "Cloudflare Cache model route is not bound to the canonical snapshot", "CLOUDFLARE_CACHE_MODEL_ROUTE_UNBOUND");
  assert(evidence.context_status === "CLOUDFLARE_CACHE_CONTEXT" && evidence.context_receipt_sha256 === authority.context_sha256, "Cloudflare Cache typed context receipt is not canonical", "CLOUDFLARE_CACHE_CONTEXT_RECEIPT_INVALID");
  assert(evidence.upstream_router_result_sha256 === authority.router_result_sha256 && authority.router_file_sha256 === CLOUDFLARE_CACHE_UPSTREAM_ROUTER_FILE_SHA256, "Cloudflare Cache upstream router receipt is not canonical", "CLOUDFLARE_CACHE_UPSTREAM_ROUTER_INVALID");
  assert(evidence.memory_binding === "TYPED_HANDOFF_ONLY", "Cloudflare Cache memory binding permits untyped context", "CLOUDFLARE_CACHE_MEMORY_BINDING_INVALID");
  assert(Array.isArray(evidence.required_block_identities) && JSON.stringify(evidence.required_block_identities) === JSON.stringify(REQUIRED_BLOCKS), "Cloudflare Cache required block identity chain is incomplete", "CLOUDFLARE_CACHE_BLOCK_BINDING_INVALID");
  return authority;
}

export function assertCloudflareCacheCommittedHandoff({authority = resolveCloudflareCacheCanonicalAuthority(), evaluation, handoff, evaluationFileSha256, handoffFileSha256} = {}) {
  pin(evaluationFileSha256, CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.evaluation, "Cloudflare Cache evaluation dossier");
  pin(handoffFileSha256, CLOUDFLARE_CACHE_CANONICAL_ARTIFACT_SHA256.handoff, "Cloudflare Cache handoff");
  exactKeys(evaluation, ["schema", "version", "receipt_id", "block_id", "candidate_digest", "model_requirement", "harness", "cases", "results", "disposition", "independence_rule"], "Cloudflare Cache committed evaluation");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.cloudflare-cache.v1" && evaluation.block_id === CLOUDFLARE_CACHE_BLOCK_ID, "Cloudflare Cache evaluation identity differs", "CLOUDFLARE_CACHE_EVALUATION_DOSSIER_INVALID");
  assert(evaluation.candidate_digest === authority.block_sha256 && evaluation.model_requirement === "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE" && evaluation.results?.passed === FIXTURE_CLASSES.length && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "STATIC_PASS_REVIEW_REQUIRED", "Cloudflare Cache evaluation dossier is not current", "CLOUDFLARE_CACHE_EVALUATION_DOSSIER_INVALID");
  const expectedClasses = new Set(authority.fixtures.map((fixture) => fixture.class));
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === FIXTURE_CLASSES.length && new Set(evaluation.cases.map((item) => item.class)).size === FIXTURE_CLASSES.length, "Cloudflare Cache evaluation coverage is incomplete", "CLOUDFLARE_CACHE_EVALUATION_DOSSIER_INVALID");
  for (const item of evaluation.cases) assert(expectedClasses.has(item.class) && item.observed === "PASS" && ["DENY", "ROUTE"].includes(item.expected), `Cloudflare Cache evaluation case ${item.class} is not a current PASS`, "CLOUDFLARE_CACHE_EVALUATION_DOSSIER_INVALID");
  exactKeys(handoff, ["schema", "version", "handoff_id", "block_id", "disposition", "candidate_digest", "source_commit", "source_tree", "changed_paths", "proof", "residuals", "next_action", "authority"], "Cloudflare Cache committed handoff");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.cloudflare-cache.v1" && handoff.block_id === CLOUDFLARE_CACHE_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "Cloudflare Cache handoff identity differs", "CLOUDFLARE_CACHE_HANDOFF_INVALID");
  for (const proof of [
    `evaluation_file_sha256:${evaluationFileSha256}`,
    `gate_execution_file_sha256:${authority.gate_execution_file_sha256}`,
    `gate_semantic_inventory_sha256:${authority.gate_semantic_inventory_sha256}`,
    `model_route_sha256:${authority.model_route_sha256}`,
    `context_receipt_sha256:${authority.context_sha256}`,
    `upstream_router_file_sha256:${authority.router_file_sha256}`,
    `source_manifest_sha256:${authority.source_manifest_sha256}`,
  ]) assert(handoff.proof.includes(proof), `Cloudflare Cache handoff omits ${proof}`, "CLOUDFLARE_CACHE_HANDOFF_INVALID");
  return true;
}
