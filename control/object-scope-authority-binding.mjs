#!/usr/bin/env node

/*
 * Canonical, repository-bound evidence for the Object Scope specialist.
 *
 * The public boundary accepts a serialized request, but none of the authority
 * in that request is trusted.  This module resolves the package, standard,
 * source, roster, model snapshot, and upstream router from the repository
 * itself.  A caller can repeat the same facts, but cannot substitute a second
 * package or make a stale/future record current by changing a field.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateAccessControlRouterBoundary} from "./access-control-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const OBJECT_SCOPE_PACKAGE_PATH = "specialist-blocks/wave-03/object-scope";
export const OBJECT_SCOPE_BLOCK_ID = "specialist.security.object-scope";
export const OBJECT_SCOPE_STANDARD_BLOCK_ID = "specialist.standard.owasp-asvs";
export const OBJECT_SCOPE_STANDARD_ID = "source.owasp-asvs-5-0-0";
export const OBJECT_SCOPE_CUSTODY_REF = "opaque:OBJECT_SCOPE.CUSTODY";
export const OBJECT_SCOPE_MODEL_TASK_CLASS = "SECURITY_REVIEW";
export const OBJECT_SCOPE_MODEL_CAPABILITY_FLOOR = 59;
export const OBJECT_SCOPE_MODEL_CAPABILITIES = Object.freeze(["CODE", "SECURITY", "TOOLS"]);
export const OBJECT_SCOPE_MODEL_SNAPSHOT_SHA256 = "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27";
export const OBJECT_SCOPE_ROSTER_FILE_SHA256 = "98aa86f50a8adda4bbca5ab10a93dc2326793faaeea610c11d1e0293da902b78";
export const OBJECT_SCOPE_UPSTREAM_ROUTER_FILE_SHA256 = "7cb64aac3a89adc6dcb611237025160743bd40bc44edd99d4919184de78d039a";
export const OBJECT_SCOPE_CANONICAL_ARTIFACT_SHA256 = Object.freeze({
  block: "014e8b3bb8b4ac7ee302c8a5c5f45f9c69c7307a5f6993f593bcde5055a5097b",
  source_lock: "2ba45563f538c9b9ac86fdc455269f5620570687c27cffb7d0d8244a33c84117",
  gate_manifest: "6f24dba97e079cc71e6049c46efffd1f0a26e938f59c1e1fff1c842e2e650ba4",
  gate_execution: "c73826fe4366b6513dae244f00e31f221b300b1cca14fe79cb97e3f713716ea7",
  evaluation: "6cdda97efb9cfe63cf2f10f4b6d90f3d3fe44912e46f6865ccd6fd09cea1b22f",
  handoff: "f1907acd8e7aed484b1fbe396d43b014e53c8d85252eab9f7a28c4761ce44177",
  model_snapshot: "203d555399fb84345cede6f122fff3568272a9dda27a350ff04d7387084b392d",
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, OBJECT_SCOPE_PACKAGE_PATH);
const ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const ACCEPTANCE_LEDGER_PATH = path.join(ROOT, "specialist-blocks/registry/accepted-agent-receipts.v1.json");
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

function fail(message, code = "OBJECT_SCOPE_CANONICAL_AUTHORITY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "OBJECT_SCOPE_CANONICAL_DIGEST_INVALID"); }
function fileSha(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function body(value, field) { const copy = structuredClone(value); copy[field] = null; return copy; }
function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "OBJECT_SCOPE_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical file`, "OBJECT_SCOPE_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  const bytes = readFile(file, label);
  let value; try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "OBJECT_SCOPE_CANONICAL_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}
function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "OBJECT_SCOPE_CANONICAL_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "OBJECT_SCOPE_CANONICAL_SCHEMA_INVALID");
}
function validDate(value, label, nowMs) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "OBJECT_SCOPE_SOURCE_DATE_INVALID");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  assert(time <= nowMs, `${label} is future-dated`, "OBJECT_SCOPE_SOURCE_FUTURE");
  return time;
}
function freshDate(value, label, nowMs, maxAgeDays = 31) {
  const time = validDate(value, label, nowMs);
  assert(nowMs - time <= maxAgeDays * 86_400_000, `${label} is stale`, "OBJECT_SCOPE_SOURCE_STALE");
  return time;
}
function checkBlock(blockArtifact, expectedId, label) {
  const block = blockArtifact.value;
  assert(block.block_id === expectedId && block.schema === "agentos.specialist_block.v1" && block.activation === "OFF", `${label} identity differs`, "OBJECT_SCOPE_CANONICAL_BINDING_INVALID");
  sha(block.block_sha256, `${label} digest`);
  assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), `${label} digest does not match its bytes`, "OBJECT_SCOPE_CANONICAL_DIGEST_INVALID");
  return block;
}
function expectedGateNext(index, outcome) {
  if (outcome === "NO") return "OUTCOME:DENY";
  if (outcome === "UNKNOWN") return "OUTCOME:UNKNOWN_DEPENDENT_ONLY";
  if (index === GATE_IDS.length - 1) return outcome === "YES" || outcome === "NOT_APPLICABLE" ? "OUTCOME:ROUTE" : null;
  return GATE_IDS[index + 1];
}
function checkGateSemantics(gates, manifest) {
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.block_id === OBJECT_SCOPE_BLOCK_ID, "Object Scope gate manifest identity differs", "OBJECT_SCOPE_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(GATE_IDS), "Object Scope gate order differs", "OBJECT_SCOPE_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(GATE_IDS.map((id) => `gates/${id}.gate`)), "Object Scope gate paths differ", "OBJECT_SCOPE_GATE_SEMANTICS_INVALID");
  const expectedRules = {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"};
  const semantic = [];
  gates.forEach((gate, index) => {
    exactKeys(gate, ["schema", "version", "gate_id", "block_id", "status", "answer_type", "allowed_outcomes", "question", "evidence", "next", "rules", "gate_sha256"], `Object Scope gate ${gate.gate_id}`);
    assert(gate.gate_id === GATE_IDS[index] && gate.block_id === OBJECT_SCOPE_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Object Scope gate ${gate.gate_id} identity differs`, "OBJECT_SCOPE_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `Object Scope gate ${gate.gate_id} outcomes differ`, "OBJECT_SCOPE_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.rules) === JSON.stringify(expectedRules), `Object Scope gate ${gate.gate_id} rules differ`, "OBJECT_SCOPE_GATE_SEMANTICS_INVALID");
    assert(gate.next && typeof gate.next === "object" && !Array.isArray(gate.next), `Object Scope gate ${gate.gate_id} next tree is missing`, "OBJECT_SCOPE_GATE_SEMANTICS_INVALID");
    for (const outcome of ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]) assert(gate.next[outcome] === expectedGateNext(index, outcome), `Object Scope gate ${gate.gate_id} next branch differs for ${outcome}`, "OBJECT_SCOPE_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `Object Scope gate ${gate.gate_id}`);
    assert(gate.gate_sha256 === canonicalDigest(body(gate, "gate_sha256")), `Object Scope gate ${gate.gate_id} digest differs`, "OBJECT_SCOPE_GATE_DIGEST_INVALID");
    semantic.push({gate_id: gate.gate_id, gate_sha256: gate.gate_sha256, next: gate.next, rules: gate.rules, evidence: gate.evidence});
  });
  return canonicalDigest(semantic);
}

function canonicalRouterResult(candidateDigest) {
  const input = {
    schema: "agentos.access_control_router_boundary_input.v1", version: 1, request_kind: "ROUTE_ACCESS_CONTROL_HANDOFF", evidence: {
      authority_status: "CURRENT", security_domain: "ACCESS_CONTROL_COMPOSITION", control_identity: "CONTROL.ACCESS_CONTROL_ROUTER", control_activity: "CLASSIFY_OBJECT_SCOPE", control_entity: "OBJECT_SCOPE", control_scope: "NARROW", control_version: "1",
      policy_status: "CURRENT", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.AGENTOS_ACCESS_CONTROL_ROUTER", source_version: "1", source_effective_date: "2026-08-11", source_retrieved_date: "2026-08-21",
      candidate_status: "CURRENT_CANDIDATE", candidate_digest: candidateDigest, security_signal: "SECURITY.ACCESS_CONTROL", signal_status: "BOUND", task_status: "ACCESS_CONTROL_CLASSIFICATION", context_status: "ACCESS_CONTROL_ROUTER_CONTEXT", context_complete: true,
      requested_action: "ROUTE", requested_tools: ["READ_ACCESS_SIGNAL", "READ_SOURCE_LOCK", "READ_CONTEXT"], required_block_identities: ["BLOCK.ACCESS.AUTHORITY", "BLOCK.ACCESS.EVIDENCE", "BLOCK.ACCESS.SCOPE", "BLOCK.ACCESS.CUSTODY", "BLOCK.ACCESS.HANDOFF", "BLOCK.ACCESS.SECURITY_ROUTER"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "ACCESS_CONTROL_COMPOSITION",
      project_data_present: false, secret_data_present: false, authorization_decision_requested: false, policy_mutation_requested: false, credential_issue_requested: false,
      adversarial_flags: Object.fromEntries(["authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool", "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action", "broad_claim", "cross_provider", "false_positive"].map((key) => [key, false])),
    },
  };
  const result = evaluateAccessControlRouterBoundary(input);
  assert(result.disposition === "ROUTE" && result.route === "ACCESS_CONTROL_ATOMIC_SPECIALIST_HANDOFF" && result.routing_allowed === true, "Canonical upstream router did not produce a route", "OBJECT_SCOPE_UPSTREAM_ROUTER_INVALID");
  return result;
}

export function resolveObjectScopeCanonicalAuthority() {
  const nowMs = Date.now();
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "Object Scope block");
  const block = checkBlock(blockArtifact, OBJECT_SCOPE_BLOCK_ID, "Object Scope block");
  assert(blockArtifact.file_sha256 === OBJECT_SCOPE_CANONICAL_ARTIFACT_SHA256.block, "Object Scope block file is not the pinned candidate", "OBJECT_SCOPE_CANONICAL_PROVENANCE_INVALID");
  const rosterArtifact = readJson(ROSTER_PATH, "Reusable-agent roster");
  assert(rosterArtifact.file_sha256 === OBJECT_SCOPE_ROSTER_FILE_SHA256, "Reusable-agent roster file is not the pinned canonical authority", "OBJECT_SCOPE_ROSTER_PROVENANCE_INVALID");
  const roster = rosterArtifact.value;
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === "AGENT.SECURITY_OBJECT_SCOPE");
  assert(entry && entry.canonical_block_id === OBJECT_SCOPE_BLOCK_ID && entry.package_path === OBJECT_SCOPE_PACKAGE_PATH, "Object Scope roster binding is missing or substituted", "OBJECT_SCOPE_ROSTER_BINDING_INVALID");
  assert(entry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION" || entry.build_state === "ACCEPTED_QUALIFIED", "Object Scope roster state is invalid", "OBJECT_SCOPE_ROSTER_STATE_INVALID");
  assert(entry.model_route?.task_class === OBJECT_SCOPE_MODEL_TASK_CLASS && entry.model_route.minimum_capability === OBJECT_SCOPE_MODEL_CAPABILITY_FLOOR && JSON.stringify(entry.model_route.required_capabilities) === JSON.stringify(OBJECT_SCOPE_MODEL_CAPABILITIES) && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "Object Scope model route is not canonical", "OBJECT_SCOPE_MODEL_ROUTE_INVALID");

  const acceptanceArtifact = readJson(ACCEPTANCE_LEDGER_PATH, "Reusable-agent acceptance ledger");
  const acceptanceLedger = acceptanceArtifact.value;
  assert(acceptanceLedger.schema === "agentos.reusable_agent_acceptance_ledger.v1" && acceptanceLedger.status === "READ_ONLY_INDEPENDENT_EVALUATION_INDEX" && acceptanceLedger.project_agnostic === true && acceptanceLedger.ledger_sha256 === canonicalDigest(body(acceptanceLedger, "ledger_sha256")), "Object Scope acceptance ledger identity is invalid", "OBJECT_SCOPE_ACCEPTANCE_LEDGER_INVALID");
  const acceptance = acceptanceLedger.entries?.filter((candidate) => candidate.stable_agent_id === "AGENT.SECURITY_OBJECT_SCOPE");
  const acceptanceEntry = acceptance?.length === 1 ? acceptance[0] : null;
  if (entry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION") {
    assert(acceptance?.length === 0, "Object Scope candidate has a stale or duplicated acceptance row", "OBJECT_SCOPE_ACCEPTANCE_LEDGER_ROW_INVALID");
  } else {
    assert(acceptance?.length === 1, "Object Scope acceptance ledger row is missing or duplicated", "OBJECT_SCOPE_ACCEPTANCE_LEDGER_ROW_INVALID");
    assert(acceptanceEntry.package_path === OBJECT_SCOPE_PACKAGE_PATH && /^[0-9a-f]{40}$/u.test(acceptanceEntry.candidate_commit) && /^[0-9a-f]{40}$/u.test(acceptanceEntry.candidate_tree) && acceptanceEntry.independent_status === "PASS" && acceptanceEntry.receipt_ref === `INDEPENDENT_EVALUATOR_HANDOFF/${acceptanceEntry.candidate_commit}` && ((acceptanceEntry.readback_scope === "READBACK_SUMMARY_ONLY" && acceptanceEntry.receipt_sha256 === null) || (acceptanceEntry.readback_scope === "EXACT_RECEIPT_RETAINED" && /^[0-9a-f]{64}$/u.test(acceptanceEntry.receipt_sha256))), "Object Scope acceptance receipt is not a canonical independent readback", "OBJECT_SCOPE_ACCEPTANCE_RECEIPT_INVALID");
  }

  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "Object Scope source lock");
  assert(sourceArtifact.file_sha256 === OBJECT_SCOPE_CANONICAL_ARTIFACT_SHA256.source_lock, "Object Scope source lock file is not the pinned candidate", "OBJECT_SCOPE_CANONICAL_PROVENANCE_INVALID");
  const source = sourceArtifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.block_id === OBJECT_SCOPE_BLOCK_ID && source.manifest_sha256 === canonicalDigest(body(source, "manifest_sha256")), "Object Scope source lock digest is invalid", "OBJECT_SCOPE_SOURCE_LOCK_INVALID");
  const atomic = source.sources?.find((candidate) => candidate.source_id === "source.atomic-specialization-law");
  const owasp = source.sources?.find((candidate) => candidate.source_id === OBJECT_SCOPE_STANDARD_ID);
  assert(atomic && atomic.immutable_identity === "agentos-atomic-specialization-law-v1" && atomic.authority_class === "AGENTOS_PORTABLE", "Object Scope atomic source is not canonical", "OBJECT_SCOPE_SOURCE_IDENTITY_INVALID");
  assert(owasp && owasp.immutable_identity === "owasp-asvs-5.0.0-release-20250530" && owasp.authority_class === "PRIMARY_NORMATIVE", "Object Scope OWASP source is not canonical", "OBJECT_SCOPE_SOURCE_IDENTITY_INVALID");
  freshDate(atomic.retrieved_date, "Atomic source retrieved date", nowMs, 31); freshDate(owasp.retrieved_date, "OWASP source retrieved date", nowMs, 31);
  validDate(atomic.effective_date, "Atomic source effective date", nowMs); validDate(owasp.effective_date, "OWASP source effective date", nowMs);

  const standardArtifact = readJson(STANDARD_PATH, "OWASP ASVS standard block");
  const standard = checkBlock(standardArtifact, OBJECT_SCOPE_STANDARD_BLOCK_ID, "OWASP ASVS standard block");
  const standardSourcesArtifact = readJson(STANDARD_SOURCES_PATH, "OWASP ASVS source manifest");
  const standardSources = standardSourcesArtifact.value;
  sha(standardSources.manifest_sha256, "OWASP ASVS source manifest");
  assert(standardSources.manifest_sha256 === canonicalDigest(body(standardSources, "manifest_sha256")), "OWASP ASVS source manifest digest differs", "OBJECT_SCOPE_STANDARD_SOURCE_INVALID");
  assert(standard.block_sha256 === "1b39ac928b70badd070d9f6716825e73b9b931959c5fc078edf12e875c91824f" && standardSources.manifest_sha256 === "505595765deaa25206fd59936a4b7e415688c640373a83a68e76a9788ed587d6", "OWASP ASVS standard bytes are not the canonical version", "OBJECT_SCOPE_STANDARD_BINDING_INVALID");

  const manifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "Object Scope gate manifest");
  assert(manifestArtifact.file_sha256 === OBJECT_SCOPE_CANONICAL_ARTIFACT_SHA256.gate_manifest, "Object Scope gate manifest file is not the pinned candidate", "OBJECT_SCOPE_CANONICAL_PROVENANCE_INVALID");
  const manifest = manifestArtifact.value; sha(manifest.manifest_sha256, "Object Scope gate manifest");
  assert(manifest.manifest_sha256 === canonicalDigest(body(manifest, "manifest_sha256")), "Object Scope gate manifest digest differs", "OBJECT_SCOPE_GATE_MANIFEST_INVALID");
  const rosterGates = entry.deterministic_gates;
  assert(rosterGates && rosterGates.status === "BOUND" && rosterGates.manifest_path === `${OBJECT_SCOPE_PACKAGE_PATH}/gates/manifest.json` && Array.isArray(rosterGates.gates) && rosterGates.gates.length === GATE_IDS.length, "Object Scope roster gate provenance is incomplete", "OBJECT_SCOPE_ROSTER_GATE_PROVENANCE_INVALID");
  assert(JSON.stringify(rosterGates.gates.map((gate) => gate.gate_id)) === JSON.stringify(GATE_IDS) && JSON.stringify(rosterGates.gates.map((gate) => gate.path)) === JSON.stringify(GATE_IDS.map((id) => `${OBJECT_SCOPE_PACKAGE_PATH}/gates/${id}.gate`)), "Object Scope roster gate inventory is not exact", "OBJECT_SCOPE_ROSTER_GATE_PROVENANCE_INVALID");
  const gates = GATE_IDS.map((gateId, index) => {
    const artifact = readJson(path.join(PACKAGE, "gates", `${gateId}.gate`), `Object Scope gate ${gateId}`);
    const rosterGate = rosterGates.gates[index];
    assert(rosterGate.file_sha256 === artifact.file_sha256, `Object Scope gate ${gateId} differs from the canonical roster`, "OBJECT_SCOPE_GATE_PROVENANCE_INVALID");
    return artifact.value;
  });
  const gateSemanticInventorySha256 = checkGateSemantics(gates, manifest);

  const fixtureDirectory = path.join(PACKAGE, "fixtures");
  const fixtureNames = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(fixtureNames.length === 17 && new Set(fixtureNames).size === 17, "Object Scope hostile fixture inventory is incomplete", "OBJECT_SCOPE_FIXTURE_INVENTORY_INVALID");
  const rosterFixtures = entry.hostile_fixtures;
  assert(rosterFixtures && rosterFixtures.status === "BOUND" && Array.isArray(rosterFixtures.fixtures) && rosterFixtures.fixtures.length === 17, "Object Scope roster fixture provenance is incomplete", "OBJECT_SCOPE_ROSTER_FIXTURE_PROVENANCE_INVALID");
  assert(new Set(rosterFixtures.fixtures.map((fixture) => fixture.fixture_id)).size === 17 && new Set(rosterFixtures.fixtures.map((fixture) => fixture.path)).size === 17, "Object Scope roster fixture inventory is aliased", "OBJECT_SCOPE_ROSTER_FIXTURE_PROVENANCE_INVALID");
  const fixtures = fixtureNames.map((name) => {
    const artifact = readJson(path.join(fixtureDirectory, name), `Object Scope hostile fixture ${name}`); const fixture = artifact.value;
    assert(fixture.block_id === OBJECT_SCOPE_BLOCK_ID && fixture.hostile === true && fixture.vector?.entrypoint === "control/object-scope-boundary-gate.mjs#evaluateObjectScopeBoundary", `Object Scope fixture ${name} is not operational`, "OBJECT_SCOPE_FIXTURE_UNBOUND");
    assert(typeof fixture.fixture_id === "string" && typeof fixture.class === "string" && fixture.expected, `Object Scope fixture ${name} is incomplete`, "OBJECT_SCOPE_FIXTURE_INVALID");
    assert(fixture.vector?.input?.request_kind && fixture.vector?.input?.evidence_overrides && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `Object Scope fixture ${name} vector is not bound to its expected result`, "OBJECT_SCOPE_FIXTURE_VECTOR_INVALID");
    const rosterMatches = rosterFixtures.fixtures.filter((candidate) => candidate.path === `${OBJECT_SCOPE_PACKAGE_PATH}/fixtures/${name}`);
    assert(rosterMatches.length === 1, `Object Scope fixture ${name} is not bound exactly once in the canonical roster`, "OBJECT_SCOPE_ROSTER_FIXTURE_PROVENANCE_INVALID");
    const rosterFixture = rosterMatches[0];
    assert(rosterFixture.fixture_id === fixture.fixture_id && rosterFixture.file_sha256 === artifact.file_sha256 && rosterFixture.expected_outcome === fixture.expected.disposition, `Object Scope fixture ${name} differs from the canonical roster`, "OBJECT_SCOPE_FIXTURE_PROVENANCE_INVALID");
    return Object.freeze({fixture_id: fixture.fixture_id, class: fixture.class, file_sha256: artifact.file_sha256, expected: fixture.expected});
  });

  const handoffArtifact = readJson(path.join(PACKAGE, "handoff.json"), "Object Scope handoff");
  assert(entry.required_evidence_handoff?.handoff_path === `${OBJECT_SCOPE_PACKAGE_PATH}/handoff.json` && entry.required_evidence_handoff.handoff_file_sha256 === handoffArtifact.file_sha256, "Object Scope roster handoff provenance is stale or missing", "OBJECT_SCOPE_HANDOFF_PROVENANCE_INVALID");

  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot"); const model = modelArtifact.value;
  assert(modelArtifact.file_sha256 === OBJECT_SCOPE_CANONICAL_ARTIFACT_SHA256.model_snapshot && model.snapshot_sha256 === OBJECT_SCOPE_MODEL_SNAPSHOT_SHA256, "Object Scope model-policy snapshot is not the pinned candidate", "OBJECT_SCOPE_MODEL_POLICY_PROVENANCE_INVALID");
  validateModelPolicySnapshot(model, {requireActive: false});
  assert(model.project_agnostic === true && model.contains_consumer_context === false && model.raw_browsing_transcripts === false, "Global model-policy snapshot is not project-agnostic", "OBJECT_SCOPE_MODEL_POLICY_INVALID");
  const securityTask = model.task_classes?.find((task) => task.task_class === OBJECT_SCOPE_MODEL_TASK_CLASS);
  assert(securityTask && securityTask.minimum_capability_score === OBJECT_SCOPE_MODEL_CAPABILITY_FLOOR && JSON.stringify(securityTask.required_capabilities) === JSON.stringify(OBJECT_SCOPE_MODEL_CAPABILITIES) && JSON.stringify(securityTask.preferred_models) === JSON.stringify(["gpt-5.6-sol"]) && JSON.stringify(securityTask.fallback_models) === JSON.stringify([]), "Object Scope SECURITY_REVIEW model route semantics are not canonical", "OBJECT_SCOPE_MODEL_ROUTE_SEMANTICS_INVALID");
  const modelRoute = Object.freeze({task_class: entry.model_route.task_class, minimum_capability: entry.model_route.minimum_capability, required_capabilities: Object.freeze([...entry.model_route.required_capabilities]), route_source: entry.model_route.route_source, snapshot_sha256: model.snapshot_sha256, snapshot_status: model.status, model_file_sha256: modelArtifact.file_sha256});
  const modelRouteSha256 = canonicalDigest(modelRoute);
  const routerFileSha256 = fileSha(UPSTREAM_ROUTER_PATH);
  assert(routerFileSha256 === OBJECT_SCOPE_UPSTREAM_ROUTER_FILE_SHA256, "Object Scope upstream router source is not the pinned canonical artifact", "OBJECT_SCOPE_UPSTREAM_ROUTER_PROVENANCE_INVALID");
  const routerResult = canonicalRouterResult(block.block_sha256);
  const contextSha256 = canonicalDigest({block_sha256: block.block_sha256, source_manifest_sha256: source.manifest_sha256, standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSources.manifest_sha256, authority_scope: "OBJECT_SCOPE", scope: "NARROW", object_scope_status: "BOUND", authorization_boundary_status: "BOUND", custody_ref: OBJECT_SCOPE_CUSTODY_REF, memory_binding: "TYPED_HANDOFF_ONLY", lifecycle_revision: block.revision, router_file_sha256: routerFileSha256, router_result_sha256: routerResult.result_sha256, model_route_sha256: modelRouteSha256});
  return Object.freeze({
    repository_root: ROOT, package_path: OBJECT_SCOPE_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256,
    source_manifest_sha256: source.manifest_sha256, source_file_sha256: sourceArtifact.file_sha256,
    source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: atomic.version, source_effective_date: atomic.effective_date, source_retrieved_date: atomic.retrieved_date,
    standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSources.manifest_sha256,
    gate_manifest_sha256: manifest.manifest_sha256, gate_manifest_file_sha256: manifestArtifact.file_sha256, gate_semantic_inventory_sha256: gateSemanticInventorySha256,
    gates: Object.freeze(gates), fixtures: Object.freeze(fixtures), model: Object.freeze(modelRoute), model_route_sha256: modelRouteSha256,
    acceptance_ledger_file_sha256: acceptanceArtifact.file_sha256, acceptance_candidate_commit: acceptanceEntry?.candidate_commit ?? null, acceptance_candidate_tree: acceptanceEntry?.candidate_tree ?? null, acceptance_receipt_ref: acceptanceEntry?.receipt_ref ?? null,
    router_file_sha256: routerFileSha256, router_result_sha256: routerResult.result_sha256, context_sha256: contextSha256, custody_ref: OBJECT_SCOPE_CUSTODY_REF,
  });
}

export function assertObjectScopeCanonicalEvidence(evidence, authority = resolveObjectScopeCanonicalAuthority()) {
  assert(evidence.candidate_digest === authority.block_sha256, "Object Scope candidate digest is not the canonical block", "OBJECT_SCOPE_CANDIDATE_BINDING_INVALID");
  assert(evidence.authority_scope === "OBJECT_SCOPE", "Object Scope authority scope is not canonical", "OBJECT_SCOPE_AUTHORITY_SCOPE_INVALID");
  assert(evidence.standard_block_sha256 === authority.standard_block_sha256 && evidence.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256, "Object Scope standard evidence is not canonical", "OBJECT_SCOPE_STANDARD_BINDING_INVALID");
  assert(evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_effective_date === authority.source_effective_date && evidence.source_retrieved_date === authority.source_retrieved_date, "Object Scope source evidence is not canonical", "OBJECT_SCOPE_SOURCE_IDENTITY_INVALID");
  assert(evidence.custody_ref === authority.custody_ref, "Object Scope custody reference is not canonical", "OBJECT_SCOPE_CUSTODY_BINDING_INVALID");
  assert(evidence.model_policy_status === authority.model.snapshot_status && evidence.model_snapshot_sha256 === authority.model.snapshot_sha256 && evidence.model_task_class === authority.model.task_class && evidence.model_capability_floor === authority.model.minimum_capability && JSON.stringify(evidence.model_required_capabilities) === JSON.stringify(authority.model.required_capabilities) && evidence.model_route_sha256 === authority.model_route_sha256, "Object Scope model route is not bound to the canonical snapshot", "OBJECT_SCOPE_MODEL_ROUTE_UNBOUND");
  assert(evidence.object_scope_status === "BOUND" && evidence.authorization_boundary_status === "BOUND", "Object Scope context scope is not canonical", "OBJECT_SCOPE_CONTEXT_BINDING_INVALID");
  assert(evidence.context_receipt_sha256 === authority.context_sha256, "Object Scope typed context receipt is not canonical", "OBJECT_SCOPE_CONTEXT_RECEIPT_INVALID");
  assert(authority.router_file_sha256 === OBJECT_SCOPE_UPSTREAM_ROUTER_FILE_SHA256 && fileSha(UPSTREAM_ROUTER_PATH) === authority.router_file_sha256, "Object Scope upstream router source is not the current canonical artifact", "OBJECT_SCOPE_UPSTREAM_ROUTER_PROVENANCE_INVALID");
  assert(evidence.upstream_router_result_sha256 === authority.router_result_sha256, "Object Scope upstream router receipt is not canonical", "OBJECT_SCOPE_UPSTREAM_ROUTER_INVALID");
  return authority;
}

export function assertObjectScopeCommittedHandoff({authority = resolveObjectScopeCanonicalAuthority(), evaluation, handoff, evaluationFileSha256, handoffFileSha256} = {}) {
  assert(evaluationFileSha256 === OBJECT_SCOPE_CANONICAL_ARTIFACT_SHA256.evaluation && handoffFileSha256 === OBJECT_SCOPE_CANONICAL_ARTIFACT_SHA256.handoff, "Object Scope committed dossier is not the pinned candidate", "OBJECT_SCOPE_CANONICAL_PROVENANCE_INVALID");
  exactKeys(evaluation, ["schema", "version", "receipt_id", "block_id", "candidate_digest", "model_requirement", "harness", "cases", "results", "disposition", "independence_rule"], "Object Scope committed evaluation");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.object-scope.v1" && evaluation.block_id === OBJECT_SCOPE_BLOCK_ID, "Object Scope evaluation identity differs", "OBJECT_SCOPE_EVALUATION_DOSSIER_INVALID");
  assert(evaluation.candidate_digest === authority.block_sha256 && evaluation.model_requirement === "GLOBAL_MODEL_POLICY_SNAPSHOT/TASK_CLASS_ROUTE" && evaluation.results?.passed === 17 && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "STATIC_PASS_REVIEW_REQUIRED", "Object Scope evaluation dossier is not current", "OBJECT_SCOPE_EVALUATION_DOSSIER_INVALID");
  const expectedClasses = new Set(authority.fixtures.map((fixture) => fixture.class));
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === 17 && new Set(evaluation.cases.map((entry) => entry.class)).size === 17, "Object Scope evaluation case coverage is incomplete", "OBJECT_SCOPE_EVALUATION_DOSSIER_INVALID");
  for (const item of evaluation.cases) assert(expectedClasses.has(item.class) && item.observed === "PASS" && ["DENY", "ROUTE"].includes(item.expected), `Object Scope evaluation case ${item.class} is not a current PASS`, "OBJECT_SCOPE_EVALUATION_DOSSIER_INVALID");
  exactKeys(handoff, ["schema", "version", "handoff_id", "block_id", "disposition", "candidate_digest", "source_commit", "source_tree", "changed_paths", "proof", "residuals", "next_action", "authority"], "Object Scope committed handoff");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.object-scope.v1" && handoff.block_id === OBJECT_SCOPE_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "Object Scope handoff identity differs", "OBJECT_SCOPE_HANDOFF_INVALID");
  assert(handoff.proof.includes(`evaluation_file_sha256:${evaluationFileSha256}`) && handoff.proof.includes(`gate_semantic_inventory_sha256:${authority.gate_semantic_inventory_sha256}`) && handoff.proof.includes(`model_route_sha256:${authority.model_route_sha256}`) && handoff.proof.includes(`context_receipt_sha256:${authority.context_sha256}`) && handoff.proof.includes(`upstream_router_file_sha256:${authority.router_file_sha256}`), "Object Scope handoff is not bound to current execution artifacts", "OBJECT_SCOPE_HANDOFF_INVALID");
  assert(typeof handoffFileSha256 === "string" && SHA256.test(handoffFileSha256), "Object Scope handoff file digest is invalid", "OBJECT_SCOPE_HANDOFF_INVALID");
  return true;
}
