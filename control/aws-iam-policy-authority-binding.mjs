#!/usr/bin/env node

/*
 * Canonical, repository-bound authority for the AWS IAM Policy Elements
 * specialist.  Boundary callers may repeat these facts, but they cannot
 * replace the package, source edition, router, model-policy snapshot, or
 * typed context with caller-controlled values.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateProviderEdgeRouterBoundary} from "./provider-edge-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const AWS_IAM_POLICY_PACKAGE_PATH = "specialist-blocks/wave-02/aws-iam-policy";
export const AWS_IAM_POLICY_BLOCK_ID = "specialist.platform.aws-iam-policy";
export const AWS_IAM_POLICY_STANDARD_BLOCK_ID = "specialist.standard.aws-iam-current";
export const AWS_IAM_POLICY_STANDARD_ID = "source.aws-iam-policy-elements";
export const AWS_IAM_POLICY_CUSTODY_REF = "opaque:AWS_IAM_POLICY.CUSTODY";
export const AWS_IAM_POLICY_MODEL_TASK_CLASS = "NARROW_CODING";
export const AWS_IAM_POLICY_MODEL_CAPABILITY_FLOOR = 49;
export const AWS_IAM_POLICY_MODEL_CAPABILITIES = Object.freeze(["CODE", "TOOLS"]);
export const AWS_IAM_POLICY_MODEL_SNAPSHOT_SHA256 = "b462eb1e9a526e74a240f623b20721468b660f1da0e894c81537f9d04dd57c27";
export const AWS_IAM_POLICY_STANDARD_BLOCK_SHA256 = "b3ef939cb57279f6a88bbd416226829e2e6bb20e6aa5b2613fa9fe6d6dd3ec48";
export const AWS_IAM_POLICY_STANDARD_SOURCE_MANIFEST_SHA256 = "e87e366370301b597f9f6476f048a7d0e5d849f416dae325ef0f4f3cbfeb9c90";
export const AWS_IAM_POLICY_ROSTER_FILE_SHA256 = "7aebae94ecc4cd9280b95995e384e272fbe27b21ecb68d8c3fc6a9a52f0385ee";
export const AWS_IAM_POLICY_UPSTREAM_ROUTER_FILE_SHA256 = "1e7cbe3898ba80c6dbf10dd09a8c1b687c097134992c1da78a3c904066a23b8b";

/* Filled with the final candidate bytes before the lane is frozen. */
export const AWS_IAM_POLICY_CANONICAL_ARTIFACT_SHA256 = Object.freeze({
  block: "fb98032f90f2076d2e6ac281cf21b69cd9d21c020769f25f70e4deb0fcb37ae1",
  source_lock: "855974e3c5db67ee789f0e06b819f066f4f7635aab88cdca2ba67ccef05467a2",
  gate_manifest: "56c44f0c27748a5c8356b2fb6a3036b5526d9314ba5ee840b249d77583a8ddb0",
  gate_execution: "4114eb6794102692bfb8ae844051e9868f2aaf54889e0b4e8333e10ff386b9ec",
  evaluation: "cf1477dbade222808f83c5b02d3f0f57bd09a8e3c123b904c6a80a3ae1036d55",
  handoff: "fb4ded1e5ee85263bfccd22f82a2ad7a5d81e97d7510e1456c50268aef780aa0",
  model_snapshot: "203d555399fb84345cede6f122fff3568272a9dda27a350ff04d7387084b392d",
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, AWS_IAM_POLICY_PACKAGE_PATH);
const ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const ACCEPTANCE_LEDGER_PATH = path.join(ROOT, "specialist-blocks/registry/accepted-agent-receipts.v1.json");
const MODEL_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const STANDARD_PATH = path.join(ROOT, "specialist-blocks/standards/aws-iam-current/block.json");
const STANDARD_SOURCES_PATH = path.join(ROOT, "specialist-blocks/standards/aws-iam-current/sources.lock");
const UPSTREAM_ROUTER_PATH = path.join(ROOT, "control/provider-edge-router-boundary-gate.mjs");
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);

function fail(message, code = "AWS_IAM_POLICY_CANONICAL_AUTHORITY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "AWS_IAM_POLICY_CANONICAL_DIGEST_INVALID"); }
function fileSha(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function body(value, field) { const copy = structuredClone(value); copy[field] = null; return copy; }
function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "AWS_IAM_POLICY_CANONICAL_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical file`, "AWS_IAM_POLICY_CANONICAL_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "AWS_IAM_POLICY_CANONICAL_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}
function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "AWS_IAM_POLICY_CANONICAL_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "AWS_IAM_POLICY_CANONICAL_SCHEMA_INVALID");
}
function validDate(value, label, nowMs) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "AWS_IAM_POLICY_SOURCE_DATE_INVALID");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  assert(time <= nowMs, `${label} is future-dated`, "AWS_IAM_POLICY_SOURCE_FUTURE");
  return time;
}
function freshDate(value, label, nowMs, maxAgeDays = 31) {
  const time = validDate(value, label, nowMs);
  assert(nowMs - time <= maxAgeDays * 86_400_000, `${label} is stale`, "AWS_IAM_POLICY_SOURCE_STALE");
  return time;
}
function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.block_id === expectedId && block.schema === "agentos.specialist_block.v1" && block.activation === "OFF", `${label} identity differs`, "AWS_IAM_POLICY_CANONICAL_BINDING_INVALID");
  sha(block.block_sha256, `${label} digest`);
  assert(block.block_sha256 === canonicalDigest(body(block, "block_sha256")), `${label} digest does not match its bytes`, "AWS_IAM_POLICY_CANONICAL_DIGEST_INVALID");
  return block;
}
function expectedGateNext(index, outcome) {
  if (outcome === "NO") return "OUTCOME:DENY";
  if (outcome === "UNKNOWN") return "OUTCOME:UNKNOWN_DEPENDENT_ONLY";
  if (index === GATE_IDS.length - 1) return outcome === "YES" || outcome === "NOT_APPLICABLE" ? "OUTCOME:ROUTE" : null;
  return GATE_IDS[index + 1];
}
function checkGateSemantics(gates, manifest) {
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.block_id === AWS_IAM_POLICY_BLOCK_ID, "AWS IAM Policy gate manifest identity differs", "AWS_IAM_POLICY_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(GATE_IDS), "AWS IAM Policy gate order differs", "AWS_IAM_POLICY_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(GATE_IDS.map((id) => `gates/${id}.gate`)), "AWS IAM Policy gate paths differ", "AWS_IAM_POLICY_GATE_SEMANTICS_INVALID");
  const expectedRules = {ambiguity: "DENY", missing_evidence: "DENY", stale_source: "DENY", authority_conflict: "ESCALATE", unsafe_action: "DENY", unknown_scope: "DEPENDENT_ACTION_ONLY"};
  const semantic = [];
  gates.forEach((gate, index) => {
    exactKeys(gate, ["schema", "version", "gate_id", "block_id", "status", "answer_type", "allowed_outcomes", "question", "evidence", "next", "rules", "gate_sha256"], `AWS IAM Policy gate ${gate.gate_id}`);
    assert(gate.gate_id === GATE_IDS[index] && gate.block_id === AWS_IAM_POLICY_BLOCK_ID && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `AWS IAM Policy gate ${gate.gate_id} identity differs`, "AWS_IAM_POLICY_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `AWS IAM Policy gate ${gate.gate_id} outcomes differ`, "AWS_IAM_POLICY_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.rules) === JSON.stringify(expectedRules), `AWS IAM Policy gate ${gate.gate_id} rules differ`, "AWS_IAM_POLICY_GATE_SEMANTICS_INVALID");
    assert(gate.next && typeof gate.next === "object" && !Array.isArray(gate.next), `AWS IAM Policy gate ${gate.gate_id} next tree is missing`, "AWS_IAM_POLICY_GATE_SEMANTICS_INVALID");
    for (const outcome of ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]) assert(gate.next[outcome] === expectedGateNext(index, outcome), `AWS IAM Policy gate ${gate.gate_id} next branch differs for ${outcome}`, "AWS_IAM_POLICY_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `AWS IAM Policy gate ${gate.gate_id}`);
    assert(gate.gate_sha256 === canonicalDigest(body(gate, "gate_sha256")), `AWS IAM Policy gate ${gate.gate_id} digest differs`, "AWS_IAM_POLICY_GATE_DIGEST_INVALID");
    semantic.push({gate_id: gate.gate_id, gate_sha256: gate.gate_sha256, next: gate.next, rules: gate.rules, evidence: gate.evidence});
  });
  return canonicalDigest(semantic);
}
function canonicalRouterResult(candidateDigest) {
  const input = {
    schema: "agentos.provider_edge_router_boundary_input.v1", version: 1, request_kind: "ROUTE_PROVIDER_EDGE", evidence: {
      authority_status: "CURRENT", custody_status: "BOUND", custody_owner: "AGENT.PLATFORM_PROVIDER_EDGE_ROUTER", custody_ref: "opaque:PROVIDER_EDGE_ROUTER.CUSTODY",
      source_status: "CURRENT", source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: "1", provider_identity: "AWS", provider_version: "CURRENT", signal: "CLOUD.AWS_IAM", target_ref: AWS_IAM_POLICY_BLOCK_ID,
      context_complete: true, scope: "NARROW", requested_action: "CLASSIFY", requested_tools: ["READ_SOURCE", "READ_CONTEXT"], self_acceptance: false, scope_expanded: false, authority_conflict: false, project_data_present: false, secret_data_present: false, provider_evidence: "BOUNDED",
    },
  };
  const result = evaluateProviderEdgeRouterBoundary(input);
  assert(result.disposition === "ROUTE" && result.route === "SPECIALIST_HANDOFF" && result.routing_allowed === true && result.selected_specialist === AWS_IAM_POLICY_BLOCK_ID, "Canonical upstream router did not produce the AWS IAM Policy route", "AWS_IAM_POLICY_UPSTREAM_ROUTER_INVALID");
  return result;
}
function assertPinnedArtifacts(artifacts) {
  for (const [name, digest] of Object.entries(AWS_IAM_POLICY_CANONICAL_ARTIFACT_SHA256)) {
    sha(digest, `Pinned ${name}`);
    assert(digest !== "0".repeat(64), `Pinned ${name} is not frozen`, "AWS_IAM_POLICY_CANONICAL_PROVENANCE_INVALID");
    assert(artifacts[name] === digest, `AWS IAM Policy ${name} is not the pinned candidate`, "AWS_IAM_POLICY_CANONICAL_PROVENANCE_INVALID");
  }
}

export function resolveAwsIamPolicyCanonicalAuthority() {
  const nowMs = Date.now();
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "AWS IAM Policy block");
  const block = checkBlock(blockArtifact, AWS_IAM_POLICY_BLOCK_ID, "AWS IAM Policy block");
  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "AWS IAM Policy source lock");
  const source = sourceArtifact.value;
  assert(source.schema === "agentos.specialist_source_manifest.v1" && source.block_id === AWS_IAM_POLICY_BLOCK_ID && source.manifest_sha256 === canonicalDigest(body(source, "manifest_sha256")), "AWS IAM Policy source lock digest is invalid", "AWS_IAM_POLICY_SOURCE_LOCK_INVALID");
  const atomic = source.sources?.find((candidate) => candidate.source_id === "source.atomic-specialization-law");
  const aws = source.sources?.find((candidate) => candidate.source_id === AWS_IAM_POLICY_STANDARD_ID);
  assert(atomic && atomic.immutable_identity === "agentos-atomic-specialization-law-v1" && atomic.authority_class === "AGENTOS_PORTABLE", "AWS IAM Policy atomic source is not canonical", "AWS_IAM_POLICY_SOURCE_IDENTITY_INVALID");
  assert(aws && aws.immutable_identity === "aws-iam-policy-elements-current-2026-08-11" && aws.authority_class === "PRIMARY_DESCRIPTIVE" && aws.version === "current", "AWS IAM Policy source edition is not canonical", "AWS_IAM_POLICY_SOURCE_IDENTITY_INVALID");
  freshDate(atomic.retrieved_date, "Atomic source retrieved date", nowMs); freshDate(aws.retrieved_date, "AWS IAM source retrieved date", nowMs);
  validDate(atomic.effective_date, "Atomic source effective date", nowMs);
  assert(Object.prototype.hasOwnProperty.call(aws, "effective_date") && aws.effective_date === null, "AWS IAM source effective-date status is not explicit", "AWS_IAM_POLICY_SOURCE_IDENTITY_INVALID");

  const standardArtifact = readJson(STANDARD_PATH, "AWS IAM current standard block");
  const standard = checkBlock(standardArtifact, AWS_IAM_POLICY_STANDARD_BLOCK_ID, "AWS IAM current standard block");
  const standardSourcesArtifact = readJson(STANDARD_SOURCES_PATH, "AWS IAM current source manifest");
  const standardSources = standardSourcesArtifact.value;
  sha(standardSources.manifest_sha256, "AWS IAM current source manifest");
  assert(standardSources.manifest_sha256 === canonicalDigest(body(standardSources, "manifest_sha256")) && standardSources.manifest_sha256 === AWS_IAM_POLICY_STANDARD_SOURCE_MANIFEST_SHA256, "AWS IAM current source manifest differs", "AWS_IAM_POLICY_STANDARD_SOURCE_INVALID");
  assert(standard.block_sha256 === AWS_IAM_POLICY_STANDARD_BLOCK_SHA256, "AWS IAM current standard block differs", "AWS_IAM_POLICY_STANDARD_BINDING_INVALID");

  const rosterArtifact = readJson(ROSTER_PATH, "Reusable-agent roster");
  assert(rosterArtifact.file_sha256 === AWS_IAM_POLICY_ROSTER_FILE_SHA256, "Reusable-agent roster file is not the pinned canonical authority", "AWS_IAM_POLICY_ROSTER_PROVENANCE_INVALID");
  const roster = rosterArtifact.value;
  assert(roster.roster_sha256 === canonicalDigest(body(roster, "roster_sha256")) && roster.project_agnostic === true, "Reusable-agent roster digest or scope is invalid", "AWS_IAM_POLICY_ROSTER_INVALID");
  const entry = roster.entries?.find((candidate) => candidate.stable_agent_id === "AGENT.PLATFORM_AWS_IAM_POLICY");
  assert(entry && entry.canonical_block_id === AWS_IAM_POLICY_BLOCK_ID && entry.package_path === AWS_IAM_POLICY_PACKAGE_PATH, "AWS IAM Policy roster binding is missing or substituted", "AWS_IAM_POLICY_ROSTER_BINDING_INVALID");
  assert(entry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION" || entry.build_state === "ACCEPTED_QUALIFIED", "AWS IAM Policy roster state is invalid", "AWS_IAM_POLICY_ROSTER_STATE_INVALID");
  assert(entry.operational_entrypoints?.boundary === "control/aws-iam-policy-boundary-gate.mjs#evaluateAwsIamPolicyBoundary" && entry.operational_entrypoints?.evaluator === "control/aws-iam-policy-package-evaluator.mjs#evaluateAwsIamPolicyPackage" && entry.operational_entrypoints.real_fixture_inputs === true, "AWS IAM Policy operational entrypoints are not registry-bound", "AWS_IAM_POLICY_ROSTER_OPERATIONAL_BINDING_INVALID");
  assert(entry.context_invalidation?.memory_rule === "TYPED_HANDOFF_ONLY_NO_MEMORY_WRITE" && entry.context_invalidation?.rebuild_on_change === true, "AWS IAM Policy context/memory invalidation is not registry-bound", "AWS_IAM_POLICY_ROSTER_CONTEXT_INVALIDATION_INVALID");

  const acceptanceArtifact = readJson(ACCEPTANCE_LEDGER_PATH, "Reusable-agent acceptance ledger");
  const acceptanceLedger = acceptanceArtifact.value;
  assert(acceptanceLedger.schema === "agentos.reusable_agent_acceptance_ledger.v1" && acceptanceLedger.status === "READ_ONLY_INDEPENDENT_EVALUATION_INDEX" && acceptanceLedger.project_agnostic === true && acceptanceLedger.ledger_sha256 === canonicalDigest(body(acceptanceLedger, "ledger_sha256")), "Acceptance ledger identity is invalid", "AWS_IAM_POLICY_ACCEPTANCE_LEDGER_INVALID");
  const acceptance = acceptanceLedger.entries?.filter((candidate) => candidate.stable_agent_id === "AGENT.PLATFORM_AWS_IAM_POLICY");
  if (entry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION") assert(acceptance?.length === 0, "AWS IAM Policy candidate has a stale acceptance row", "AWS_IAM_POLICY_ACCEPTANCE_LEDGER_ROW_INVALID");
  else assert(acceptance?.length === 1, "AWS IAM Policy accepted roster row is missing or duplicated", "AWS_IAM_POLICY_ACCEPTANCE_LEDGER_ROW_INVALID");

  const manifestArtifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "AWS IAM Policy gate manifest");
  const manifest = manifestArtifact.value; sha(manifest.manifest_sha256, "AWS IAM Policy gate manifest");
  assert(manifest.manifest_sha256 === canonicalDigest(body(manifest, "manifest_sha256")), "AWS IAM Policy gate manifest digest differs", "AWS_IAM_POLICY_GATE_MANIFEST_INVALID");
  assert(manifestArtifact.file_sha256 === AWS_IAM_POLICY_CANONICAL_ARTIFACT_SHA256.gate_manifest, "AWS IAM Policy gate manifest is not the pinned candidate", "AWS_IAM_POLICY_CANONICAL_PROVENANCE_INVALID");
  const rosterGates = entry.deterministic_gates;
  assert(rosterGates?.status === "BOUND" && rosterGates.manifest_path === `${AWS_IAM_POLICY_PACKAGE_PATH}/gates/manifest.json` && rosterGates.gates?.length === GATE_IDS.length, "AWS IAM Policy roster gate provenance is incomplete", "AWS_IAM_POLICY_ROSTER_GATE_PROVENANCE_INVALID");
  const gates = GATE_IDS.map((gateId, index) => {
    const artifact = readJson(path.join(PACKAGE, "gates", `${gateId}.gate`), `AWS IAM Policy gate ${gateId}`);
    const rosterGate = rosterGates.gates[index];
    assert(rosterGate.gate_id === gateId && rosterGate.path === `${AWS_IAM_POLICY_PACKAGE_PATH}/gates/${gateId}.gate` && rosterGate.file_sha256 === artifact.file_sha256, `AWS IAM Policy gate ${gateId} differs from the canonical roster`, "AWS_IAM_POLICY_GATE_PROVENANCE_INVALID");
    return artifact.value;
  });
  const gateSemanticInventorySha256 = checkGateSemantics(gates, manifest);

  const fixtureDirectory = path.join(PACKAGE, "fixtures");
  const fixtureNames = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  assert(fixtureNames.length === 17 && new Set(fixtureNames).size === 17, "AWS IAM Policy hostile fixture inventory is incomplete", "AWS_IAM_POLICY_FIXTURE_INVENTORY_INVALID");
  const rosterFixtures = entry.hostile_fixtures;
  assert(rosterFixtures?.status === "BOUND" && rosterFixtures.fixtures?.length === 17, "AWS IAM Policy roster fixture provenance is incomplete", "AWS_IAM_POLICY_ROSTER_FIXTURE_PROVENANCE_INVALID");
  const fixtures = fixtureNames.map((name) => {
    const artifact = readJson(path.join(fixtureDirectory, name), `AWS IAM Policy hostile fixture ${name}`); const fixture = artifact.value;
    assert(fixture.block_id === AWS_IAM_POLICY_BLOCK_ID && fixture.hostile === true && fixture.vector?.entrypoint === "control/aws-iam-policy-boundary-gate.mjs#evaluateAwsIamPolicyBoundary", `AWS IAM Policy fixture ${name} is not operational`, "AWS_IAM_POLICY_FIXTURE_UNBOUND");
    assert(typeof fixture.fixture_id === "string" && typeof fixture.class === "string" && fixture.expected, `AWS IAM Policy fixture ${name} is incomplete`, "AWS_IAM_POLICY_FIXTURE_INVALID");
    assert(fixture.vector?.input?.schema === "agentos.aws_iam_policy_boundary_input.v1" && fixture.vector?.input?.evidence_overrides && JSON.stringify(fixture.vector.expected_readback) === JSON.stringify(fixture.expected), `AWS IAM Policy fixture ${name} vector is not bound to its expected result`, "AWS_IAM_POLICY_FIXTURE_VECTOR_INVALID");
    const rosterFixture = rosterFixtures.fixtures.find((candidate) => candidate.path === `${AWS_IAM_POLICY_PACKAGE_PATH}/fixtures/${name}`);
    assert(rosterFixture && rosterFixture.fixture_id === fixture.fixture_id && rosterFixture.file_sha256 === artifact.file_sha256 && rosterFixture.expected_outcome === fixture.expected.disposition, `AWS IAM Policy fixture ${name} differs from the canonical roster`, "AWS_IAM_POLICY_FIXTURE_PROVENANCE_INVALID");
    return Object.freeze({fixture_id: fixture.fixture_id, class: fixture.class, file_sha256: artifact.file_sha256, expected: fixture.expected});
  });

  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot"); const model = modelArtifact.value;
  assert(modelArtifact.file_sha256 === AWS_IAM_POLICY_CANONICAL_ARTIFACT_SHA256.model_snapshot && model.snapshot_sha256 === AWS_IAM_POLICY_MODEL_SNAPSHOT_SHA256, "AWS IAM Policy model-policy snapshot is not pinned", "AWS_IAM_POLICY_MODEL_POLICY_PROVENANCE_INVALID");
  validateModelPolicySnapshot(model, {requireActive: false});
  assert(model.project_agnostic === true && model.contains_consumer_context === false && model.raw_browsing_transcripts === false, "Global model-policy snapshot is not project-agnostic", "AWS_IAM_POLICY_MODEL_POLICY_INVALID");
  const task = model.task_classes?.find((candidate) => candidate.task_class === AWS_IAM_POLICY_MODEL_TASK_CLASS);
  assert(task && task.minimum_capability_score === AWS_IAM_POLICY_MODEL_CAPABILITY_FLOOR && task.minimum_context_tokens === 64000 && JSON.stringify(task.required_capabilities) === JSON.stringify(AWS_IAM_POLICY_MODEL_CAPABILITIES) && task.preferred_models.includes("gpt-5.6-luna"), "AWS IAM Policy model route semantics are not canonical", "AWS_IAM_POLICY_MODEL_ROUTE_INVALID");
  assert(entry.model_route?.task_class === AWS_IAM_POLICY_MODEL_TASK_CLASS && entry.model_route.minimum_capability === AWS_IAM_POLICY_MODEL_CAPABILITY_FLOOR && JSON.stringify(entry.model_route.required_capabilities) === JSON.stringify(AWS_IAM_POLICY_MODEL_CAPABILITIES) && entry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "AWS IAM Policy roster model route differs", "AWS_IAM_POLICY_MODEL_ROUTE_INVALID");
  const modelRoute = Object.freeze({task_class: entry.model_route.task_class, minimum_capability: entry.model_route.minimum_capability, required_capabilities: Object.freeze([...entry.model_route.required_capabilities]), route_source: entry.model_route.route_source, selected_model: "gpt-5.6-luna", reasoning_effort: task.preferred_reasoning_effort, snapshot_sha256: model.snapshot_sha256, snapshot_status: model.status, model_file_sha256: modelArtifact.file_sha256});
  const modelRouteSha256 = canonicalDigest(modelRoute);

  const routerFileSha256 = fileSha(UPSTREAM_ROUTER_PATH);
  assert(routerFileSha256 === AWS_IAM_POLICY_UPSTREAM_ROUTER_FILE_SHA256, "AWS IAM Policy upstream router source is not pinned", "AWS_IAM_POLICY_UPSTREAM_ROUTER_PROVENANCE_INVALID");
  const routerResult = canonicalRouterResult(block.block_sha256);
  const contextSha256 = canonicalDigest({block_sha256: block.block_sha256, source_manifest_sha256: source.manifest_sha256, standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSources.manifest_sha256, authority_scope: "AWS_IAM_POLICY", provider_identity: "AWS", provider_version: "CURRENT", policy_identity: "IAM_POLICY_ELEMENTS", scope: "NARROW", custody_ref: AWS_IAM_POLICY_CUSTODY_REF, memory_binding: "TYPED_HANDOFF_ONLY_NO_MEMORY_WRITE", lifecycle_revision: block.revision, router_file_sha256: routerFileSha256, router_result_sha256: routerResult.result_sha256, model_route_sha256: modelRouteSha256});

  const executionArtifact = readJson(path.join(PACKAGE, "gates/execution.json"), "AWS IAM Policy gate execution manifest");
  const evaluationArtifact = readJson(path.join(PACKAGE, "evaluation.json"), "AWS IAM Policy evaluation dossier");
  const handoffArtifact = readJson(path.join(PACKAGE, "handoff.json"), "AWS IAM Policy handoff");
  const artifacts = {block: blockArtifact.file_sha256, source_lock: sourceArtifact.file_sha256, gate_manifest: manifestArtifact.file_sha256, gate_execution: executionArtifact.file_sha256, evaluation: evaluationArtifact.file_sha256, handoff: handoffArtifact.file_sha256, model_snapshot: modelArtifact.file_sha256};
  assertPinnedArtifacts(artifacts);
  assert(evaluationArtifact.value.candidate_digest === block.block_sha256 && evaluationArtifact.value.block_id === AWS_IAM_POLICY_BLOCK_ID && evaluationArtifact.value.harness === "deterministic-executable-atomic-p1-harness.v1", "AWS IAM Policy evaluation dossier is stale or static-only", "AWS_IAM_POLICY_EVALUATION_DOSSIER_INVALID");
  assert(handoffArtifact.value.candidate_digest === block.block_sha256 && handoffArtifact.value.block_id === AWS_IAM_POLICY_BLOCK_ID && handoffArtifact.value.disposition === "WAITING_WITH_RECEIPT" && handoffArtifact.value.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "AWS IAM Policy handoff is not bounded", "AWS_IAM_POLICY_HANDOFF_INVALID");
  assert(handoffArtifact.value.proof?.some((item) => item.startsWith("evaluation_file_sha256:")) && handoffArtifact.value.proof?.some((item) => item.startsWith("context_receipt_sha256:")), "AWS IAM Policy handoff proof is incomplete", "AWS_IAM_POLICY_HANDOFF_INVALID");
  return Object.freeze({
    repository_root: ROOT, package_path: AWS_IAM_POLICY_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256,
    source_manifest_sha256: source.manifest_sha256, source_file_sha256: sourceArtifact.file_sha256, source_identity: "SOURCE.ATOMIC_SPECIALIZATION_LAW", source_version: atomic.version, source_effective_date: atomic.effective_date, source_retrieved_date: atomic.retrieved_date,
    aws_source_identity: aws.immutable_identity, aws_source_version: aws.version, aws_source_retrieved_date: aws.retrieved_date, standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSources.manifest_sha256,
    gate_manifest_sha256: manifest.manifest_sha256, gate_manifest_file_sha256: manifestArtifact.file_sha256, gate_semantic_inventory_sha256: gateSemanticInventorySha256, gates: Object.freeze(gates), fixtures: Object.freeze(fixtures), model: modelRoute, model_route_sha256: modelRouteSha256,
    acceptance_ledger_file_sha256: acceptanceArtifact.file_sha256, router_file_sha256: routerFileSha256, router_result_sha256: routerResult.result_sha256, router_result: routerResult, context_sha256: contextSha256, custody_ref: AWS_IAM_POLICY_CUSTODY_REF,
    gate_execution_file_sha256: executionArtifact.file_sha256, evaluation_file_sha256: evaluationArtifact.file_sha256, handoff_file_sha256: handoffArtifact.file_sha256, roster_file_sha256: rosterArtifact.file_sha256,
  });
}

export function assertAwsIamPolicyCanonicalEvidence(evidence, authority = resolveAwsIamPolicyCanonicalAuthority()) {
  assert(evidence.candidate_digest === authority.block_sha256, "AWS IAM Policy candidate digest is not canonical", "AWS_IAM_POLICY_CANDIDATE_BINDING_INVALID");
  assert(evidence.authority_scope === "AWS_IAM_POLICY" && evidence.provider_identity === "AWS" && evidence.provider_version === "CURRENT" && evidence.policy_identity === "IAM_POLICY_ELEMENTS", "AWS IAM Policy authority scope is not canonical", "AWS_IAM_POLICY_AUTHORITY_SCOPE_INVALID");
  assert(evidence.standard_id === AWS_IAM_POLICY_STANDARD_ID && evidence.standard_version === "current" && evidence.standard_block_sha256 === authority.standard_block_sha256 && evidence.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256, "AWS IAM Policy standard evidence is not canonical", "AWS_IAM_POLICY_STANDARD_BINDING_INVALID");
  assert(evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_effective_date === authority.source_effective_date && evidence.source_retrieved_date === authority.source_retrieved_date, "AWS IAM Policy source evidence is not canonical", "AWS_IAM_POLICY_SOURCE_IDENTITY_INVALID");
  assert(evidence.custody_ref === authority.custody_ref, "AWS IAM Policy custody reference is not canonical", "AWS_IAM_POLICY_CUSTODY_BINDING_INVALID");
  assert(evidence.model_policy_status === authority.model.snapshot_status && evidence.model_snapshot_sha256 === authority.model.snapshot_sha256 && evidence.model_task_class === authority.model.task_class && evidence.model_capability_floor === authority.model.minimum_capability && JSON.stringify(evidence.model_required_capabilities) === JSON.stringify(authority.model.required_capabilities) && evidence.model_route_sha256 === authority.model_route_sha256, "AWS IAM Policy model route is not bound to the canonical snapshot", "AWS_IAM_POLICY_MODEL_ROUTE_UNBOUND");
  assert(evidence.context_status === "AWS_IAM_POLICY_CONTEXT" && evidence.policy_status === "BOUND" && evidence.context_receipt_sha256 === authority.context_sha256, "AWS IAM Policy typed context receipt is not canonical", "AWS_IAM_POLICY_CONTEXT_RECEIPT_INVALID");
  assert(evidence.upstream_router_result_sha256 === authority.router_result_sha256, "AWS IAM Policy upstream router receipt is not canonical", "AWS_IAM_POLICY_UPSTREAM_ROUTER_INVALID");
  return authority;
}
