#!/usr/bin/env node

/*
 * Canonical repository-bound authority for the Idempotency specialist.
 *
 * A caller may submit typed evidence, but it cannot choose the package,
 * standard, model snapshot, upstream router, or any of their digests.  This
 * module resolves those artifacts from the repository and returns an opaque
 * authority projection for the read-only boundary and evaluator.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateAccessControlRouterBoundary} from "./access-control-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const IDEMPOTENCY_PACKAGE_PATH = "specialist-blocks/wave-03/idempotency";
export const IDEMPOTENCY_BLOCK_ID = "specialist.security.idempotency";
export const IDEMPOTENCY_STANDARD_BLOCK_ID = "specialist.standard.owasp-asvs";
export const IDEMPOTENCY_STANDARD_ID = "source.owasp-asvs-5-0-0";
export const IDEMPOTENCY_SOURCE_ID = "SOURCE.AGENTOS_IDEMPOTENCY";
export const IDEMPOTENCY_SOURCE_VERSION = "1";
export const IDEMPOTENCY_CUSTODY_REF = "opaque:IDEMPOTENCY.CUSTODY";
export const IDEMPOTENCY_MODEL_TASK_CLASS = "SECURITY_REVIEW";
export const IDEMPOTENCY_MODEL_CAPABILITY_FLOOR = 59;
export const IDEMPOTENCY_MODEL_CAPABILITIES = Object.freeze(["CODE", "SECURITY", "TOOLS"]);
export const IDEMPOTENCY_MODEL_SNAPSHOT_SHA256 = "dcb11bb16c205eac3ad9ef3fbdb78262258914451447977511c41a248a40aa8f";
export const IDEMPOTENCY_UPSTREAM_ROUTER_FILE_SHA256 = "7cb64aac3a89adc6dcb611237025160743bd40bc44edd99d4919184de78d039a";
export const IDEMPOTENCY_STANDARD_BLOCK_SHA256 = "1b39ac928b70badd070d9f6716825e73b9b931959c5fc078edf12e875c91824f";
export const IDEMPOTENCY_STANDARD_SOURCE_MANIFEST_SHA256 = "505595765deaa25206fd59936a4b7e415688c640373a83a68e76a9788ed587d6";

/* These are filled with the final candidate bytes before the branch is
 * committed.  Keeping the pins in code makes any later substitution fail
 * closed instead of silently becoming the new authority. */
export const IDEMPOTENCY_ROSTER_FILE_SHA256 = "4b9215c043903e4b05c62e57e5801d8901809e8b9d9ea869c6e19b37be429007";
export const IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256 = Object.freeze({
  block: "ba562077520d62a0ce6a949926a8a8b02aaa54038aa064bcd1e87191991cc939",
  source_lock: "27604b72651005c4dd53c4d92d45ed3bc2084b06f56d901b619499030c60549f",
  gate_manifest: "6b9a448bdb5e601490bcc4b70d4b4fb0cad39a77d34fca9c67085daef7626107",
  gate_execution: "ad10811e0d13fcc566af30fa134ec26275d50e34d0a85d52e32405d34f333b63",
  evaluation: "b2255d35d131e3d118d7f19819b9b442e3437fbb19e3e380f6be1c6f4ee631aa",
  handoff: "663e807bd51b12b8f6823da8912615251846a40c9dc96871f64bc451fb41c3f6",
  model_snapshot: "756a58f532d1e46ee64cbbfd836096a408f199488c6e4a6e200a0efbc10d592e",
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, IDEMPOTENCY_PACKAGE_PATH);
const ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const MODEL_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const STANDARD_PATH = path.join(ROOT, "specialist-blocks/standards/owasp-asvs/block.json");
const STANDARD_SOURCES_PATH = path.join(ROOT, "specialist-blocks/standards/owasp-asvs/sources.lock");
const UPSTREAM_ROUTER_PATH = path.join(ROOT, "control/access-control-router-boundary-gate.mjs");
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
  "specialist.foundation.authority-jurisdiction-gate", "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier", "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate", "specialist.security.access-control-router",
  "specialist.standard.owasp-asvs",
]);

function fail(message, code = "IDEMPOTENCY_CANONICAL_AUTHORITY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "IDEMPOTENCY_CANONICAL_DIGEST_INVALID"); }
function fileSha(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function body(value, field) { const copy = structuredClone(value); copy[field] = null; return copy; }
function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "IDEMPOTENCY_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "IDEMPOTENCY_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "IDEMPOTENCY_CANONICAL_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}
function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "IDEMPOTENCY_CANONICAL_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "IDEMPOTENCY_CANONICAL_SCHEMA_INVALID");
}
function validDate(value, label, nowMs) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "IDEMPOTENCY_SOURCE_DATE_INVALID");
  assert(Date.parse(`${value}T00:00:00.000Z`) <= nowMs, `${label} is future-dated`, "IDEMPOTENCY_SOURCE_FUTURE");
}
function freshDate(value, label, nowMs, maxAgeDays = 31) {
  validDate(value, label, nowMs);
  assert(nowMs - Date.parse(`${value}T00:00:00.000Z`) <= maxAgeDays * 86_400_000, `${label} is stale`, "IDEMPOTENCY_SOURCE_STALE");
}
function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.block_id === expectedId && block.schema === "agentos.specialist_block.v1" && block.activation === "OFF", `${label} identity differs`, "IDEMPOTENCY_CANONICAL_BINDING_INVALID");
  sha(block.block_sha256, `${label} digest`);
  assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), `${label} digest does not match its bytes`, "IDEMPOTENCY_CANONICAL_DIGEST_INVALID");
  return block;
}
function pin(actual, expected, label) {
  sha(expected, `${label} pin`);
  assert(actual === expected, `${label} is not the pinned candidate`, "IDEMPOTENCY_CANONICAL_PROVENANCE_INVALID");
}
function expectedGateNext(index, outcome) {
  if (outcome === "NO") return "OUTCOME:DENY";
  if (outcome === "UNKNOWN") return "OUTCOME:UNKNOWN_DEPENDENT_ONLY";
  if (index === GATE_IDS.length - 1) return outcome === "YES" || outcome === "NOT_APPLICABLE" ? "OUTCOME:ROUTE" : null;
  return GATE_IDS[index + 1];
}
function checkGateSemantics(gates, manifest) {
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.block_id === IDEMPOTENCY_BLOCK_ID, "Idempotency gate manifest identity differs", "IDEMPOTENCY_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(GATE_IDS), "Idempotency gate order differs", "IDEMPOTENCY_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(GATE_IDS.map((id) => `gates/${id}.gate`)), "Idempotency gate paths differ", "IDEMPOTENCY_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "Idempotency gate outcomes differ", "IDEMPOTENCY_GATE_SEMANTICS_INVALID");
  const expectedRules = {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"};
  const semantic = [];
  gates.forEach((gate, index) => {
    exactKeys(gate, ["schema", "version", "gate_id", "block_id", "status", "answer_type", "allowed_outcomes", "question", "evidence", "next", "rules", "gate_sha256"], `Idempotency gate ${gate.gate_id}`);
    assert(gate.gate_id === GATE_IDS[index] && gate.block_id === IDEMPOTENCY_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Idempotency gate ${gate.gate_id} identity differs`, "IDEMPOTENCY_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `Idempotency gate ${gate.gate_id} outcomes differ`, "IDEMPOTENCY_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.rules) === JSON.stringify(expectedRules), `Idempotency gate ${gate.gate_id} rules differ`, "IDEMPOTENCY_GATE_SEMANTICS_INVALID");
    for (const outcome of ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]) assert(gate.next[outcome] === expectedGateNext(index, outcome), `Idempotency gate ${gate.gate_id} next branch differs for ${outcome}`, "IDEMPOTENCY_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `Idempotency gate ${gate.gate_id}`);
    assert(gate.gate_sha256 === canonicalDigest(body(gate, "gate_sha256")), `Idempotency gate ${gate.gate_id} digest differs`, "IDEMPOTENCY_GATE_DIGEST_INVALID");
    semantic.push({gate_id: gate.gate_id, gate_sha256: gate.gate_sha256, next: gate.next, rules: gate.rules, evidence: gate.evidence});
  });
  return canonicalDigest(semantic);
}
function canonicalRouterResult(candidateDigest) {
  const input = {
    schema: "agentos.access_control_router_boundary_input.v1", version: 1, request_kind: "ROUTE_ACCESS_CONTROL_HANDOFF", evidence: {
      authority_status: "CURRENT", security_domain: "ACCESS_CONTROL_COMPOSITION", control_identity: "CONTROL.ACCESS_CONTROL_ROUTER", control_activity: "CLASSIFY_IDEMPOTENCY", control_entity: "IDEMPOTENCY", control_scope: "NARROW", control_version: "1",
      policy_status: "CURRENT", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.AGENTOS_ACCESS_CONTROL_ROUTER", source_version: "1", source_effective_date: "2026-08-11", source_retrieved_date: "2026-08-21",
      candidate_status: "CURRENT_CANDIDATE", candidate_digest: candidateDigest, security_signal: "SECURITY.ACCESS_CONTROL", signal_status: "BOUND", task_status: "ACCESS_CONTROL_CLASSIFICATION", context_status: "ACCESS_CONTROL_ROUTER_CONTEXT", context_complete: true,
      requested_action: "ROUTE", requested_tools: ["READ_ACCESS_SIGNAL", "READ_SOURCE_LOCK", "READ_CONTEXT"], required_block_identities: ["BLOCK.ACCESS.AUTHORITY", "BLOCK.ACCESS.EVIDENCE", "BLOCK.ACCESS.SCOPE", "BLOCK.ACCESS.CUSTODY", "BLOCK.ACCESS.HANDOFF", "BLOCK.ACCESS.SECURITY_ROUTER"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "ACCESS_CONTROL_COMPOSITION",
      project_data_present: false, secret_data_present: false, authorization_decision_requested: false, policy_mutation_requested: false, credential_issue_requested: false,
      adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false])),
    },
  };
  const result = evaluateAccessControlRouterBoundary(input);
  assert(result.disposition === "ROUTE" && result.route === "ACCESS_CONTROL_ATOMIC_SPECIALIST_HANDOFF" && result.routing_allowed === true, "Canonical upstream router did not produce a route", "IDEMPOTENCY_UPSTREAM_ROUTER_INVALID");
  return result;
}
function canonicalContext({blockSha, sourceManifestSha, standardSha, standardSourceSha, routerFileSha, routerResultSha, modelRouteSha}) {
  return canonicalDigest({
    block_sha256: blockSha, source_manifest_sha256: sourceManifestSha, standard_block_sha256: standardSha,
    standard_source_manifest_sha256: standardSourceSha, authority_scope: "IDEMPOTENCY", scope: "NARROW",
    custody_ref: IDEMPOTENCY_CUSTODY_REF, operation_identity: "OPERATION.IDEMPOTENCY", operation_version: "1",
    concurrency_scope: "NAMED_OPERATION_SCOPE", router_file_sha256: routerFileSha, router_result_sha256: routerResultSha,
    model_route_sha256: modelRouteSha, memory_binding: "TYPED_HANDOFF_ONLY", lifecycle_revision: "1.0.0",
  });
}
function assertPinnedRoster(rosterArtifact, block, modelRoute) {
  pin(rosterArtifact.file_sha256, IDEMPOTENCY_ROSTER_FILE_SHA256, "Idempotency reusable-agent roster file");
  const roster = rosterArtifact.value;
  assert(roster.schema === "agentos.reusable_agent_roster.v1" && roster.version === 1 && roster.project_agnostic === true, "Idempotency roster identity is invalid", "IDEMPOTENCY_ROSTER_INVALID");
  assert(roster.roster_sha256 === canonicalDigest(body(roster, "roster_sha256")), "Idempotency roster digest is invalid", "IDEMPOTENCY_ROSTER_DIGEST_INVALID");
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === "AGENT.SECURITY_IDEMPOTENCY");
  assert(entry && entry.canonical_block_id === IDEMPOTENCY_BLOCK_ID && entry.package_path === IDEMPOTENCY_PACKAGE_PATH, "Idempotency roster binding is missing or substituted", "IDEMPOTENCY_ROSTER_BINDING_INVALID");
  assert(["CANDIDATE_READY_FOR_QUALIFICATION", "ACCEPTED_QUALIFIED"].includes(entry.build_state), "Idempotency roster state is invalid", "IDEMPOTENCY_ROSTER_STATE_INVALID");
  assert(entry.model_route?.task_class === IDEMPOTENCY_MODEL_TASK_CLASS && entry.model_route.minimum_capability === IDEMPOTENCY_MODEL_CAPABILITY_FLOOR && JSON.stringify(entry.model_route.required_capabilities) === JSON.stringify(IDEMPOTENCY_MODEL_CAPABILITIES) && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "Idempotency model route is not canonical", "IDEMPOTENCY_MODEL_ROUTE_INVALID");
  assert(entry.deterministic_gates?.status === "BOUND" && entry.deterministic_gates.manifest_path === `${IDEMPOTENCY_PACKAGE_PATH}/gates/manifest.json` && entry.deterministic_gates.gates.length === GATE_IDS.length, "Idempotency roster gate binding is incomplete", "IDEMPOTENCY_ROSTER_GATE_PROVENANCE_INVALID");
  assert(entry.hostile_fixtures?.status === "BOUND" && entry.hostile_fixtures.fixtures.length === FIXTURE_CLASSES.length, "Idempotency roster fixture binding is incomplete", "IDEMPOTENCY_ROSTER_FIXTURE_PROVENANCE_INVALID");
  assert(entry.required_evidence_handoff?.handoff_path === `${IDEMPOTENCY_PACKAGE_PATH}/handoff.json`, "Idempotency roster handoff binding is incomplete", "IDEMPOTENCY_HANDOFF_PROVENANCE_INVALID");
  assert(entry.lifecycle?.kind === "SEED_TO_WORKER" && entry.supersession_invalidation?.links?.includes(`${IDEMPOTENCY_PACKAGE_PATH}/evaluation.json`), "Idempotency roster lifecycle/invalidation binding is incomplete", "IDEMPOTENCY_LIFECYCLE_BINDING_INVALID");
  assert(modelRoute.task_class === entry.model_route.task_class && modelRoute.minimum_capability === entry.model_route.minimum_capability && JSON.stringify(modelRoute.required_capabilities) === JSON.stringify(entry.model_route.required_capabilities), "Idempotency roster model route differs", "IDEMPOTENCY_MODEL_ROUTE_INVALID");
  return entry;
}

export function resolveIdempotencyCanonicalAuthority() {
  const nowMs = Date.now();
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "Idempotency block");
  pin(blockArtifact.file_sha256, IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256.block, "Idempotency block file");
  const block = checkBlock(blockArtifact, IDEMPOTENCY_BLOCK_ID, "Idempotency block");
  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "Idempotency source lock");
  pin(sourceArtifact.file_sha256, IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256.source_lock, "Idempotency source lock file");
  const source = sourceArtifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.block_id === IDEMPOTENCY_BLOCK_ID && source.manifest_sha256 === canonicalDigest(body(source, "manifest_sha256")), "Idempotency source lock digest is invalid", "IDEMPOTENCY_SOURCE_LOCK_INVALID");
  const domainSource = source.sources?.find((candidate) => candidate.source_id === "source.agentos-idempotency");
  const atomicSource = source.sources?.find((candidate) => candidate.source_id === "source.atomic-specialization-law");
  const standardSource = source.sources?.find((candidate) => candidate.source_id === IDEMPOTENCY_STANDARD_ID);
  assert(domainSource?.immutable_identity === "agentos-idempotency-evidence-contract-v1" && domainSource.version === "1" && domainSource.authority_class === "AGENTOS_PORTABLE", "Idempotency domain source identity is not canonical", "IDEMPOTENCY_SOURCE_IDENTITY_INVALID");
  assert(atomicSource?.immutable_identity === "agentos-atomic-specialization-law-v1" && atomicSource.version === "1" && atomicSource.authority_class === "AGENTOS_PORTABLE", "Idempotency atomic source identity is not canonical", "IDEMPOTENCY_SOURCE_IDENTITY_INVALID");
  assert(standardSource?.immutable_identity === "owasp-asvs-5.0.0-release-20250530" && standardSource.version === "5.0.0" && standardSource.authority_class === "PRIMARY_NORMATIVE", "Idempotency OWASP source identity is not canonical", "IDEMPOTENCY_SOURCE_IDENTITY_INVALID");
  freshDate(domainSource.retrieved_date, "Idempotency domain source retrieved date", nowMs); freshDate(atomicSource.retrieved_date, "Atomic source retrieved date", nowMs); freshDate(standardSource.retrieved_date, "OWASP source retrieved date", nowMs);
  validDate(domainSource.effective_date, "Idempotency domain source effective date", nowMs); validDate(atomicSource.effective_date, "Atomic source effective date", nowMs); validDate(standardSource.effective_date, "OWASP source effective date", nowMs);

  const standardArtifact = readJson(STANDARD_PATH, "OWASP ASVS standard block");
  const standard = checkBlock(standardArtifact, IDEMPOTENCY_STANDARD_BLOCK_ID, "OWASP ASVS standard block");
  pin(standard.block_sha256, IDEMPOTENCY_STANDARD_BLOCK_SHA256, "OWASP ASVS standard block");
  const standardSourcesArtifact = readJson(STANDARD_SOURCES_PATH, "OWASP ASVS source manifest");
  const standardSources = standardSourcesArtifact.value;
  pin(standardSources.manifest_sha256, IDEMPOTENCY_STANDARD_SOURCE_MANIFEST_SHA256, "OWASP ASVS source manifest");
  assert(standardSources.manifest_sha256 === canonicalDigest(body(standardSources, "manifest_sha256")), "OWASP ASVS source manifest digest differs", "IDEMPOTENCY_STANDARD_SOURCE_INVALID");

  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot");
  pin(modelArtifact.file_sha256, IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256.model_snapshot, "Global model-policy snapshot file");
  const model = modelArtifact.value;
  assert(model.snapshot_sha256 === IDEMPOTENCY_MODEL_SNAPSHOT_SHA256, "Global model-policy snapshot is not the pinned candidate", "IDEMPOTENCY_MODEL_POLICY_PROVENANCE_INVALID");
  validateModelPolicySnapshot(model, {requireActive: false});
  assert(model.project_agnostic === true && model.contains_consumer_context === false && model.raw_browsing_transcripts === false, "Global model-policy snapshot is not project-agnostic", "IDEMPOTENCY_MODEL_POLICY_INVALID");
  const securityTask = model.task_classes?.find((task) => task.task_class === IDEMPOTENCY_MODEL_TASK_CLASS);
  assert(securityTask && securityTask.minimum_capability_score === IDEMPOTENCY_MODEL_CAPABILITY_FLOOR && JSON.stringify(securityTask.required_capabilities) === JSON.stringify(IDEMPOTENCY_MODEL_CAPABILITIES) && JSON.stringify(securityTask.preferred_models) === JSON.stringify(["gpt-5.6-sol"]) && JSON.stringify(securityTask.fallback_models) === JSON.stringify([]), "Idempotency SECURITY_REVIEW model route is not canonical", "IDEMPOTENCY_MODEL_ROUTE_INVALID");
  const modelRoute = Object.freeze({task_class: IDEMPOTENCY_MODEL_TASK_CLASS, minimum_capability: IDEMPOTENCY_MODEL_CAPABILITY_FLOOR, required_capabilities: Object.freeze([...IDEMPOTENCY_MODEL_CAPABILITIES]), route_source: "GLOBAL_MODEL_POLICY_SNAPSHOT", snapshot_sha256: model.snapshot_sha256, snapshot_status: model.status, model_file_sha256: modelArtifact.file_sha256});
  const modelRouteSha256 = canonicalDigest(modelRoute);

  const routerFileSha = fileSha(UPSTREAM_ROUTER_PATH);
  pin(routerFileSha, IDEMPOTENCY_UPSTREAM_ROUTER_FILE_SHA256, "Idempotency upstream router source");
  const routerResult = canonicalRouterResult(block.block_sha256);
  const contextSha256 = canonicalContext({blockSha: block.block_sha256, sourceManifestSha: source.manifest_sha256, standardSha: standard.block_sha256, standardSourceSha: standardSources.manifest_sha256, routerFileSha, routerResultSha: routerResult.result_sha256, modelRouteSha: modelRouteSha256});
  const rosterArtifact = readJson(ROSTER_PATH, "Reusable-agent roster");
  const rosterModelRoute = {task_class: IDEMPOTENCY_MODEL_TASK_CLASS, minimum_capability: IDEMPOTENCY_MODEL_CAPABILITY_FLOOR, required_capabilities: IDEMPOTENCY_MODEL_CAPABILITIES};
  const entry = assertPinnedRoster(rosterArtifact, block, rosterModelRoute);

  const gateManifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "Idempotency gate manifest");
  pin(gateManifestArtifact.file_sha256, IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256.gate_manifest, "Idempotency gate manifest file");
  const gateManifest = gateManifestArtifact.value;
  assert(gateManifest.manifest_sha256 === canonicalDigest(body(gateManifest, "manifest_sha256")), "Idempotency gate manifest digest differs", "IDEMPOTENCY_GATE_MANIFEST_INVALID");
  const gates = GATE_IDS.map((gateId) => readJson(path.join(PACKAGE, "gates", `${gateId}.gate`), `Idempotency gate ${gateId}`).value);
  const gateSemanticInventorySha256 = checkGateSemantics(gates, gateManifest);
  const executionArtifact = readJson(path.join(PACKAGE, "gates/execution.json"), "Idempotency gate execution manifest");
  pin(executionArtifact.file_sha256, IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256.gate_execution, "Idempotency gate execution manifest file");
  assert(executionArtifact.value.schema === "agentos.idempotency_gate_execution.v1" && executionArtifact.value.block_id === IDEMPOTENCY_BLOCK_ID, "Idempotency gate execution manifest is invalid", "IDEMPOTENCY_GATE_EXECUTION_INVALID");

  const fixtureDirectory = path.join(PACKAGE, "fixtures");
  const fixtureNames = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(JSON.stringify(fixtureNames.map((name) => name.slice(0, -5)).sort(compareUtf8)) === JSON.stringify(FIXTURE_CLASSES.slice().sort(compareUtf8)), "Idempotency hostile fixture inventory is incomplete", "IDEMPOTENCY_FIXTURE_INVENTORY_INVALID");
  const fixtureArtifacts = fixtureNames.map((name) => ({name, ...readJson(path.join(fixtureDirectory, name), `Idempotency hostile fixture ${name}`)}));
  const rosterFixtures = entry.hostile_fixtures.fixtures;
  const fixtures = fixtureArtifacts.map((artifact) => {
    const fixture = artifact.value;
    assert(fixture.block_id === IDEMPOTENCY_BLOCK_ID && fixture.hostile === true && fixture.vector?.entrypoint === "control/idempotency-boundary-gate.mjs#evaluateIdempotencyBoundary", `Idempotency fixture ${artifact.name} is not operational`, "IDEMPOTENCY_FIXTURE_UNBOUND");
    assert(fixture.fixture_id === `idempotency-${fixture.class}` && FIXTURE_CLASSES.includes(fixture.class), `Idempotency fixture ${artifact.name} identity differs`, "IDEMPOTENCY_FIXTURE_INVALID");
    assert(fixture.vector.input?.schema === "agentos.idempotency_boundary_input.v1" && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Idempotency fixture ${artifact.name} vector is not bound to its expected result`, "IDEMPOTENCY_FIXTURE_VECTOR_INVALID");
    const matches = rosterFixtures.filter((candidate) => candidate.path === `${IDEMPOTENCY_PACKAGE_PATH}/fixtures/${artifact.name}`);
    assert(matches.length === 1 && matches[0].fixture_id === fixture.fixture_id && matches[0].file_sha256 === artifact.file_sha256 && matches[0].expected_outcome === fixture.expected.disposition, `Idempotency fixture ${artifact.name} differs from canonical roster`, "IDEMPOTENCY_ROSTER_FIXTURE_PROVENANCE_INVALID");
    return Object.freeze({fixture_id: fixture.fixture_id, class: fixture.class, file_sha256: artifact.file_sha256, expected: fixture.expected, input: fixture.vector.input});
  });
  const evaluationArtifact = readJson(path.join(PACKAGE, "evaluation.json"), "Idempotency evaluation dossier");
  pin(evaluationArtifact.file_sha256, IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256.evaluation, "Idempotency evaluation dossier file");
  assert(evaluationArtifact.value.schema === "agentos.specialist_evaluation.v1" && evaluationArtifact.value.block_id === IDEMPOTENCY_BLOCK_ID && evaluationArtifact.value.candidate_digest === block.block_sha256, "Idempotency evaluation dossier is not bound", "IDEMPOTENCY_EVALUATION_DOSSIER_INVALID");
  const handoffArtifact = readJson(path.join(PACKAGE, "handoff.json"), "Idempotency handoff");
  pin(handoffArtifact.file_sha256, IDEMPOTENCY_CANONICAL_ARTIFACT_SHA256.handoff, "Idempotency handoff file");
  assert(handoffArtifact.value.schema === "agentos.specialist_handoff.v1" && handoffArtifact.value.block_id === IDEMPOTENCY_BLOCK_ID && handoffArtifact.value.candidate_digest === block.block_sha256 && handoffArtifact.value.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "Idempotency handoff is not bound", "IDEMPOTENCY_HANDOFF_INVALID");
  assert(entry.required_evidence_handoff.handoff_file_sha256 === handoffArtifact.file_sha256, "Idempotency roster handoff digest is stale", "IDEMPOTENCY_HANDOFF_PROVENANCE_INVALID");

  return Object.freeze({
    repository_root: ROOT, package_path: IDEMPOTENCY_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256,
    source_manifest_sha256: source.manifest_sha256, source_file_sha256: sourceArtifact.file_sha256, source_identity: IDEMPOTENCY_SOURCE_ID, source_version: IDEMPOTENCY_SOURCE_VERSION,
    source_effective_date: domainSource.effective_date, source_retrieved_date: domainSource.retrieved_date, standard_block_sha256: standard.block_sha256,
    standard_source_manifest_sha256: standardSources.manifest_sha256, gate_manifest_sha256: gateManifest.manifest_sha256, gate_manifest_file_sha256: gateManifestArtifact.file_sha256,
    gate_execution_file_sha256: executionArtifact.file_sha256, gate_semantic_inventory_sha256: gateSemanticInventorySha256, gates: Object.freeze(gates), fixtures: Object.freeze(fixtures),
    model: modelRoute, model_route_sha256: modelRouteSha256, router_file_sha256: routerFileSha, router_result_sha256: routerResult.result_sha256,
    context_sha256: contextSha256, custody_ref: IDEMPOTENCY_CUSTODY_REF, evaluation_file_sha256: evaluationArtifact.file_sha256, handoff_file_sha256: handoffArtifact.file_sha256,
  });
}

export function assertIdempotencyCanonicalEvidence(evidence, authority = resolveIdempotencyCanonicalAuthority()) {
  assert(evidence.candidate_digest === authority.block_sha256, "Idempotency candidate digest is not canonical", "IDEMPOTENCY_CANDIDATE_BINDING_INVALID");
  assert(evidence.authority_scope === "IDEMPOTENCY" && evidence.scope === "NARROW", "Idempotency authority scope is not canonical", "IDEMPOTENCY_SCOPE_INVALID");
  assert(evidence.custody_status === "BOUND" && evidence.custody_owner === "AGENT.SECURITY.IDEMPOTENCY" && evidence.custody_ref === authority.custody_ref, "Idempotency custody is not canonical", "IDEMPOTENCY_CUSTODY_BINDING_INVALID");
  assert(evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_manifest_sha256 === authority.source_manifest_sha256, "Idempotency source evidence is not canonical", "IDEMPOTENCY_SOURCE_BINDING_INVALID");
  assert(evidence.standard_id === IDEMPOTENCY_STANDARD_ID && evidence.standard_version === "5.0.0" && evidence.standard_block_sha256 === authority.standard_block_sha256 && evidence.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256, "Idempotency standard evidence is not canonical", "IDEMPOTENCY_STANDARD_BINDING_INVALID");
  assert(evidence.model_policy_status === authority.model.snapshot_status && evidence.model_snapshot_sha256 === authority.model.snapshot_sha256 && evidence.model_task_class === authority.model.task_class && evidence.model_capability_floor === authority.model.minimum_capability && JSON.stringify(evidence.model_required_capabilities) === JSON.stringify(authority.model.required_capabilities) && evidence.model_route_sha256 === authority.model_route_sha256, "Idempotency model route is not bound to the canonical snapshot", "IDEMPOTENCY_MODEL_ROUTE_UNBOUND");
  assert(evidence.context_receipt_sha256 === authority.context_sha256 && evidence.upstream_router_result_sha256 === authority.router_result_sha256, "Idempotency context or upstream receipt is not canonical", "IDEMPOTENCY_CONTEXT_RECEIPT_INVALID");
  assert(evidence.required_block_identities && JSON.stringify(evidence.required_block_identities) === JSON.stringify(REQUIRED_BLOCKS), "Idempotency dependency identities are not canonical", "IDEMPOTENCY_BLOCK_BINDING_INVALID");
  assert(evidence.idempotency_key === evidence.candidate_digest, "Idempotency key is not the candidate content identity", "IDEMPOTENCY_KEY_BINDING_INVALID");
  assert(evidence.operation_identity === "OPERATION.IDEMPOTENCY" && evidence.operation_version === "1" && evidence.concurrency_scope === "NAMED_OPERATION_SCOPE", "Idempotency operation context is not canonical", "IDEMPOTENCY_OPERATION_BINDING_INVALID");
  assert(evidence.operation_context_sha256 === canonicalDigest({request_identity: evidence.request_identity, idempotency_key: evidence.idempotency_key, operation_identity: evidence.operation_identity, operation_version: evidence.operation_version, concurrency_scope: evidence.concurrency_scope, candidate_digest: evidence.candidate_digest, context_receipt_sha256: evidence.context_receipt_sha256, upstream_router_result_sha256: evidence.upstream_router_result_sha256}), "Idempotency operation context digest is invalid", "IDEMPOTENCY_OPERATION_CONTEXT_INVALID");
  return authority;
}

export function assertIdempotencyCommittedHandoff({authority = resolveIdempotencyCanonicalAuthority(), evaluation, handoff, evaluationFileSha256, handoffFileSha256} = {}) {
  assert(evaluationFileSha256 === authority.evaluation_file_sha256 && handoffFileSha256 === authority.handoff_file_sha256, "Idempotency committed dossier is not current", "IDEMPOTENCY_CANONICAL_PROVENANCE_INVALID");
  exactKeys(evaluation, ["schema", "version", "receipt_id", "block_id", "candidate_digest", "model_requirement", "harness", "cases", "results", "disposition", "independence_rule"], "Idempotency committed evaluation");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.idempotency.v1" && evaluation.block_id === IDEMPOTENCY_BLOCK_ID && evaluation.candidate_digest === authority.block_sha256 && evaluation.results?.passed === 17 && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "STATIC_PASS_REVIEW_REQUIRED", "Idempotency evaluation dossier is not current", "IDEMPOTENCY_EVALUATION_DOSSIER_INVALID");
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === FIXTURE_CLASSES.length && new Set(evaluation.cases.map((entry) => entry.class)).size === FIXTURE_CLASSES.length && evaluation.cases.every((entry) => FIXTURE_CLASSES.includes(entry.class) && entry.observed === "PASS"), "Idempotency evaluation case coverage is incomplete", "IDEMPOTENCY_EVALUATION_DOSSIER_INVALID");
  exactKeys(handoff, ["schema", "version", "handoff_id", "block_id", "disposition", "candidate_digest", "source_commit", "source_tree", "changed_paths", "proof", "residuals", "next_action", "authority"], "Idempotency committed handoff");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.idempotency.v1" && handoff.block_id === IDEMPOTENCY_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "Idempotency handoff identity differs", "IDEMPOTENCY_HANDOFF_INVALID");
  assert(handoff.proof.includes(`evaluation_file_sha256:${evaluationFileSha256}`) && handoff.proof.includes(`gate_semantic_inventory_sha256:${authority.gate_semantic_inventory_sha256}`) && handoff.proof.includes(`model_route_sha256:${authority.model_route_sha256}`) && handoff.proof.includes(`upstream_router_file_sha256:${authority.router_file_sha256}`) && handoff.proof.includes(`context_receipt_sha256:${authority.context_sha256}`), "Idempotency handoff is not bound to current execution artifacts", "IDEMPOTENCY_HANDOFF_INVALID");
  return true;
}
