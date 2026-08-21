#!/usr/bin/env node

/*
 * Repository-bound authority for the Industrial 3D atomic specialist.
 *
 * This module is deliberately dynamic: every digest is read from the sealed
 * worktree and checked against the bytes it names. A caller can submit typed
 * evidence, but cannot choose the package, source lock, standard, model
 * snapshot, upstream router, context receipt, memory readback, or roster.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {evaluateIndustrial3dRouterBoundary} from "./industrial-3d-router-boundary-gate.mjs";
import {validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const INDUSTRIAL_3D_PACKAGE_PATH = "specialist-blocks/wave-06/industrial-3d";
export const INDUSTRIAL_3D_BLOCK_ID = "specialist.graphics.industrial-3d";
export const INDUSTRIAL_3D_STANDARD_BLOCK_ID = "specialist.standard.gltf-2-0-1";
export const INDUSTRIAL_3D_STANDARD_ID = "source.khronos-gltf-2-0-1";
export const INDUSTRIAL_3D_SOURCE_ID = "source.blender-gltf-2-0-manual";
export const INDUSTRIAL_3D_SOURCE_VERSION = "3.3";
export const INDUSTRIAL_3D_SOURCE_INPUT_ID = "SOURCE.BLENDER_GLTF_2_0_MANUAL";
export const INDUSTRIAL_3D_CUSTODY_REF = "opaque:GRAPHICS.INDUSTRIAL_3D.CUSTODY";
export const INDUSTRIAL_3D_MODEL_TASK_CLASS = "NARROW_CODING";
export const INDUSTRIAL_3D_MODEL_CAPABILITY_FLOOR = 49;
export const INDUSTRIAL_3D_MODEL_CAPABILITIES = Object.freeze(["CODE", "TOOLS"]);
export const INDUSTRIAL_3D_MODEL_PREFERRED_MODELS = Object.freeze(["gpt-5.6-luna", "gpt-5.6-terra"]);
export const INDUSTRIAL_3D_MODEL_FALLBACK_MODELS = Object.freeze(["gpt-5.6-sol"]);
export const INDUSTRIAL_3D_CONTEXT_STATUS = "INDUSTRIAL_3D_CONTEXT";
export const INDUSTRIAL_3D_ROUTER_BLOCK_ID = "specialist.graphics.industrial-3d-router";

export const INDUSTRIAL_3D_GATE_IDS = Object.freeze([
  "00-intake", "01-applicability", "02-authority-precedence", "03-scope-nongoals",
  "04-source-evidence-freshness", "05-context-completeness", "06-tool-resource-custody",
  "07-data-secret-privacy", "08-build-browser-runtime", "09-output-handoff",
  "10-proof-acceptance", "11-lifecycle-recovery-archive",
]);
export const INDUSTRIAL_3D_FIXTURE_CLASSES = Object.freeze([
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit",
  "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness",
  "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit",
  "umbrella_authority", "unrelated_scope", "unsafe_action",
]);
export const INDUSTRIAL_3D_REQUIRED_BLOCKS = Object.freeze([
  "specialist.foundation.authority-jurisdiction-gate",
  "specialist.foundation.evidence-freshness-gate",
  "specialist.foundation.role-intake-classifier",
  "specialist.foundation.scope-non-goal-gate",
  "specialist.foundation.tool-custody-gate",
  "specialist.graphics.industrial-3d-router",
  "specialist.standard.gltf-2-0-1",
]);
export const INDUSTRIAL_3D_ALLOWED_TOOLS = Object.freeze([
  "READ_ASSET_EVIDENCE", "READ_SOURCE_LOCK", "READ_STANDARD_BLOCK", "READ_CONTEXT",
]);
export const INDUSTRIAL_3D_FLAG_KEYS = Object.freeze([
  "authority_conflict", "scope_expanded", "protected_data", "stale_source", "unsupported_tool",
  "duplicate_authority", "self_acceptance", "unrelated_scope", "missing_context", "unsafe_action",
  "broad_claim", "cross_provider", "false_positive", "memory_stale", "context_invalidated",
  "model_policy_drift", "source_superseded", "lifecycle_invalid",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, INDUSTRIAL_3D_PACKAGE_PATH);
const STANDARD_BLOCK_PATH = path.join(ROOT, "specialist-blocks/standards/gltf-2-0-1/block.json");
const STANDARD_SOURCE_PATH = path.join(ROOT, "specialist-blocks/standards/gltf-2-0-1/sources.lock");
const MODEL_PATH = path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json");
const AGENT_ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/agent-roster.v1.json");
const SPECIALIST_ROSTER_PATH = path.join(ROOT, "specialist-blocks/registry/roster.v1.json");
const ATOMIC_INVENTORY_PATH = path.join(ROOT, "specialist-blocks/registry/atomic-inventory.v1.json");
const ROUTING_INDEX_PATH = path.join(ROOT, "specialist-blocks/registry/routing-index.v1.json");
const ROUTER_PATH = path.join(ROOT, "control/industrial-3d-router-boundary-gate.mjs");
const ROUTER_BLOCK_PATH = path.join(ROOT, "specialist-blocks/wave-06/industrial-3d-router/block.json");
const ROUTER_FIXTURE_PATH = path.join(ROOT, "specialist-blocks/wave-06/industrial-3d-router/fixtures/routing.json");
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function fail(message, code = "INDUSTRIAL_3D_CANONICAL_AUTHORITY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "INDUSTRIAL_3D_DIGEST_INVALID"); }
function fileSha(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function without(value, field) { return {...structuredClone(value), [field]: null}; }
function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "INDUSTRIAL_3D_SCHEMA_INVALID");
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "INDUSTRIAL_3D_SCHEMA_INVALID");
}
function readFile(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(`${label} is missing`, "INDUSTRIAL_3D_ARTIFACT_MISSING"); }
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(file) === file, `${label} is not a canonical regular file`, "INDUSTRIAL_3D_ARTIFACT_INVALID");
  return fs.readFileSync(file);
}
function readJson(file, label) {
  const bytes = readFile(file, label);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} is not valid JSON`, "INDUSTRIAL_3D_ARTIFACT_INVALID"); }
  return Object.freeze({value, file_sha256: fileSha(file)});
}
function validDate(value, label, nowMs) {
  assert(typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)), `${label} is invalid`, "INDUSTRIAL_3D_SOURCE_DATE_INVALID");
  assert(Date.parse(`${value}T00:00:00.000Z`) <= nowMs, `${label} is future-dated`, "INDUSTRIAL_3D_SOURCE_FUTURE");
}
function freshDate(value, label, nowMs, maxAgeDays = 31) {
  validDate(value, label, nowMs);
  assert(nowMs - Date.parse(`${value}T00:00:00.000Z`) <= maxAgeDays * 86_400_000, `${label} is stale`, "INDUSTRIAL_3D_SOURCE_STALE");
}
function checkBlock(artifact, expectedId, label) {
  const block = artifact.value;
  assert(block.schema === "agentos.specialist_block.v1" && block.version === 1 && block.block_id === expectedId && block.activation === "OFF", `${label} identity differs`, "INDUSTRIAL_3D_CANONICAL_BINDING_INVALID");
  sha(block.block_sha256, `${label} digest`);
  assert(block.block_sha256 === canonicalDigest(without(block, "block_sha256")), `${label} digest does not match its bytes`, "INDUSTRIAL_3D_CANONICAL_DIGEST_INVALID");
  return block;
}
function checkManifest(manifest, expectedBlockId, label) {
  assert(manifest.schema === "agentos.specialist_source_manifest.v1" && manifest.version === 1 && manifest.block_id === expectedBlockId, `${label} identity differs`, "INDUSTRIAL_3D_SOURCE_LOCK_INVALID");
  assert(Array.isArray(manifest.sources) && manifest.sources.length > 0 && manifest.manifest_sha256 === canonicalDigest(without(manifest, "manifest_sha256")), `${label} digest differs`, "INDUSTRIAL_3D_SOURCE_LOCK_INVALID");
  sha(manifest.manifest_sha256, `${label} digest`);
  return manifest;
}
function checkFreshSource(source, label, nowMs) {
  assert(source && typeof source === "object", `${label} is missing`, "INDUSTRIAL_3D_SOURCE_IDENTITY_INVALID");
  freshDate(source.retrieved_date, `${label} retrieved date`, nowMs);
  if (source.effective_date !== null) validDate(source.effective_date, `${label} effective date`, nowMs);
  assert(typeof source.immutable_identity === "string" && source.immutable_identity.length >= 8, `${label} immutable identity is missing`, "INDUSTRIAL_3D_SOURCE_IDENTITY_INVALID");
}
function checkGateManifestAndFiles() {
  const artifact = readJson(path.join(PACKAGE, "gates/manifest.json"), "Industrial 3D gate manifest");
  const manifest = artifact.value;
  assert(manifest.schema === "agentos.specialist_gate_manifest.v1" && manifest.version === 1 && manifest.block_id === INDUSTRIAL_3D_BLOCK_ID, "Industrial 3D gate manifest identity differs", "INDUSTRIAL_3D_GATE_MANIFEST_INVALID");
  assert(JSON.stringify(manifest.ordered_gate_ids) === JSON.stringify(INDUSTRIAL_3D_GATE_IDS), "Industrial 3D gate order differs", "INDUSTRIAL_3D_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.gate_paths) === JSON.stringify(INDUSTRIAL_3D_GATE_IDS.map((id) => `gates/${id}.gate`)), "Industrial 3D gate paths differ", "INDUSTRIAL_3D_GATE_SEMANTICS_INVALID");
  assert(JSON.stringify(manifest.outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), "Industrial 3D gate outcomes differ", "INDUSTRIAL_3D_GATE_SEMANTICS_INVALID");
  sha(manifest.manifest_sha256, "Industrial 3D gate manifest digest");
  assert(manifest.manifest_sha256 === canonicalDigest(without(manifest, "manifest_sha256")), "Industrial 3D gate manifest digest differs", "INDUSTRIAL_3D_GATE_DIGEST_INVALID");
  const gates = INDUSTRIAL_3D_GATE_IDS.map((gateId) => {
    const gate = readJson(path.join(PACKAGE, "gates", `${gateId}.gate`), `Industrial 3D gate ${gateId}`).value;
    assert(gate.schema === "agentos.specialist_gate.v1" && gate.version === 1 && gate.block_id === INDUSTRIAL_3D_BLOCK_ID && gate.gate_id === gateId && gate.status === "EXECUTABLE" && gate.answer_type === "FOUR_VALUED", `Industrial 3D gate ${gateId} identity differs`, "INDUSTRIAL_3D_GATE_SEMANTICS_INVALID");
    assert(JSON.stringify(gate.allowed_outcomes) === JSON.stringify(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]), `Industrial 3D gate ${gateId} outcomes differ`, "INDUSTRIAL_3D_GATE_SEMANTICS_INVALID");
    sha(gate.gate_sha256, `Industrial 3D gate ${gateId} digest`);
    assert(gate.gate_sha256 === canonicalDigest(without(gate, "gate_sha256")), `Industrial 3D gate ${gateId} digest differs`, "INDUSTRIAL_3D_GATE_DIGEST_INVALID");
    return Object.freeze({gate_id: gateId, gate_sha256: gate.gate_sha256, evidence: gate.evidence, rules: gate.rules, next: gate.next});
  });
  return Object.freeze({manifest, manifest_file_sha256: artifact.file_sha256, gates, gate_semantic_inventory_sha256: canonicalDigest(gates)});
}
function canonicalRouterResult(modelRoute) {
  const routerBlockArtifact = readJson(ROUTER_BLOCK_PATH, "Industrial 3D upstream router block");
  const routerBlock = checkBlock(routerBlockArtifact, INDUSTRIAL_3D_ROUTER_BLOCK_ID, "Industrial 3D upstream router block");
  const fixtureArtifact = readJson(ROUTER_FIXTURE_PATH, "Industrial 3D upstream router routing fixture");
  const fixture = fixtureArtifact.value;
  assert(fixture.schema === "agentos.specialist_fixture.v1" && fixture.version === 1 && fixture.block_id === INDUSTRIAL_3D_ROUTER_BLOCK_ID && fixture.class === "routing" && fixture.hostile === true, "Industrial 3D upstream router fixture identity differs", "INDUSTRIAL_3D_UPSTREAM_ROUTER_INVALID");
  assert(fixture.vector?.entrypoint === "control/industrial-3d-router-boundary-gate.mjs#evaluateIndustrial3dRouterBoundary", "Industrial 3D upstream router fixture entrypoint differs", "INDUSTRIAL_3D_UPSTREAM_ROUTER_INVALID");
  const input = structuredClone(fixture.vector.input);
  assert(input.evidence?.candidate_digest === routerBlock.block_sha256, "Industrial 3D upstream router candidate is not bound to its block", "INDUSTRIAL_3D_UPSTREAM_ROUTER_INVALID");
  assert(input.evidence?.model_policy_status === "CURRENT", "Industrial 3D upstream router model-policy claim changed", "INDUSTRIAL_3D_UPSTREAM_MODEL_BINDING_INVALID");
  assert(modelRoute.snapshot_status === "PREPARED_INACTIVE", "Industrial 3D global model snapshot is not the required inactive snapshot", "INDUSTRIAL_3D_MODEL_ROUTE_INVALID");
  const result = evaluateIndustrial3dRouterBoundary(input);
  const expected = fixture.vector.expected_readback;
  assert(expected && result.disposition === expected.disposition && result.route === expected.route && result.error_code === expected.error_code, "Industrial 3D upstream router result differs from its executable fixture", "INDUSTRIAL_3D_UPSTREAM_ROUTER_INVALID");
  assert(result.disposition === "ROUTE" && result.route === "INDUSTRIAL_3D_ATOMIC_HANDOFF" && result.routing_allowed === true, "Industrial 3D upstream router did not produce the canonical route", "INDUSTRIAL_3D_UPSTREAM_ROUTER_INVALID");
  assert(Object.values(result.external_side_effects).every((value) => value === 0), "Industrial 3D upstream router produced a side effect", "INDUSTRIAL_3D_UPSTREAM_ROUTER_INVALID");
  const policy = Object.freeze({
    schema: "agentos.industrial_3d_upstream_model_policy_reconciliation.v1", version: 1,
    router_claim: input.evidence.model_policy_status, global_snapshot_sha256: modelRoute.snapshot_sha256,
    global_snapshot_status: modelRoute.snapshot_status, global_route_sha256: modelRoute.route_sha256,
    status: "RECONCILED_NOT_ACTIVE",
    reconciliation: "ROUTER_CURRENT_SOURCE_CONTEXT_ONLY;_GLOBAL_MODEL_SNAPSHOT_PREPARED_INACTIVE",
  });
  return Object.freeze({
    block_id: routerBlock.block_id, block_sha256: routerBlock.block_sha256, block_file_sha256: routerBlockArtifact.file_sha256,
    file_sha256: fileSha(ROUTER_PATH), fixture_file_sha256: fixtureArtifact.file_sha256,
    fixture_expected_sha256: canonicalDigest(expected), input_sha256: canonicalDigest(input), result,
    result_sha256: result.result_sha256, policy,
  });
}
function fixtureContractSha() {
  const directory = path.join(PACKAGE, "fixtures");
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(compareUtf8);
  const contract = names.map((name) => {
    const fixture = JSON.parse(readFile(path.join(directory, name), `Industrial 3D fixture ${name}`).toString("utf8"));
    const input = structuredClone(fixture.vector?.input ?? {});
    const evidence = input.evidence ?? {};
    for (const key of ["candidate_digest", "source_manifest_sha256", "standard_block_sha256", "standard_source_manifest_sha256", "model_snapshot_sha256", "model_route_sha256", "upstream_router_file_sha256", "upstream_router_block_sha256", "upstream_router_fixture_sha256", "upstream_router_input_sha256", "upstream_router_expected_sha256", "upstream_router_result_sha256", "upstream_router_model_snapshot_sha256", "upstream_router_model_route_sha256", "context_receipt_sha256", "memory_readback_sha256", "fixture_contract_sha256", "agent_roster_semantic_sha256", "specialist_roster_semantic_sha256", "atomic_inventory_semantic_sha256", "routing_index_semantic_sha256", "registry_contract_sha256"]) if (key in evidence) evidence[key] = "BOUND";
    for (const key of ["upstream_router_model_policy_claim", "upstream_router_model_binding_status", "agent_roster_status", "specialist_roster_status", "atomic_inventory_status", "routing_index_status", "registry_agent_state", "registry_activation"]) if (key in evidence) evidence[key] = "BOUND";
    return {name, fixture_id: fixture.fixture_id, class: fixture.class, entrypoint: fixture.vector?.entrypoint, expected: fixture.expected, input};
  });
  return canonicalDigest(contract);
}
function canonicalModelRoute(modelArtifact) {
  const model = modelArtifact.value;
  validateModelPolicySnapshot(model, {requireActive: false});
  assert(model.project_agnostic === true && model.contains_consumer_context === false && model.raw_browsing_transcripts === false, "Industrial 3D model policy is not project-agnostic", "INDUSTRIAL_3D_MODEL_POLICY_INVALID");
  const task = model.task_classes?.find((candidate) => candidate.task_class === INDUSTRIAL_3D_MODEL_TASK_CLASS);
  assert(task && task.minimum_capability_score === INDUSTRIAL_3D_MODEL_CAPABILITY_FLOOR && JSON.stringify(task.required_capabilities) === JSON.stringify(INDUSTRIAL_3D_MODEL_CAPABILITIES), "Industrial 3D model task route differs", "INDUSTRIAL_3D_MODEL_ROUTE_INVALID");
  assert(JSON.stringify(task.preferred_models) === JSON.stringify(INDUSTRIAL_3D_MODEL_PREFERRED_MODELS) && JSON.stringify(task.fallback_models) === JSON.stringify(INDUSTRIAL_3D_MODEL_FALLBACK_MODELS), "Industrial 3D model preference route differs", "INDUSTRIAL_3D_MODEL_ROUTE_INVALID");
  const body = {
    schema: "agentos.industrial_3d_model_route.v1", version: 1, status: "BOUND", task_class: task.task_class,
    minimum_capability: task.minimum_capability_score, minimum_context_tokens: task.minimum_context_tokens,
    required_capabilities: [...task.required_capabilities], preferred_reasoning_effort: task.preferred_reasoning_effort,
    preferred_models: [...task.preferred_models], fallback_models: [...task.fallback_models], max_evidence_age_days: task.max_evidence_age_days,
    route_source: "GLOBAL_MODEL_POLICY_SNAPSHOT", snapshot_sha256: model.snapshot_sha256, snapshot_status: model.status,
  };
  const route = Object.freeze({...body, route_sha256: canonicalDigest({...body, route_sha256: null})});
  return Object.freeze({route, route_sha256: canonicalDigest(route), snapshot_sha256: model.snapshot_sha256, snapshot_status: model.status, model_file_sha256: modelArtifact.file_sha256});
}
function canonicalContext({blockSha, sourceManifestSha, standardSha, standardSourceSha, routerFileSha, routerBlockSha, routerFixtureSha, routerInputSha, routerResultSha, routerModelSnapshotSha, routerModelRouteSha, routerModelPolicyClaim, routerModelBindingStatus, modelSnapshotSha, modelRouteSha, fixtureContractSha, registry}) {
  const body = {
    schema: "agentos.industrial_3d_context_receipt.v1", version: 1, status: "CURRENT", package_path: INDUSTRIAL_3D_PACKAGE_PATH,
    block_sha256: blockSha, source_manifest_sha256: sourceManifestSha, standard_block_sha256: standardSha,
    standard_source_manifest_sha256: standardSourceSha, router_file_sha256: routerFileSha, router_block_sha256: routerBlockSha,
    router_fixture_sha256: routerFixtureSha, router_input_sha256: routerInputSha, router_result_sha256: routerResultSha,
    router_model_snapshot_sha256: routerModelSnapshotSha, router_model_route_sha256: routerModelRouteSha,
    router_model_policy_claim: routerModelPolicyClaim, router_model_binding_status: routerModelBindingStatus,
    model_snapshot_sha256: modelSnapshotSha, model_route_sha256: modelRouteSha, fixture_contract_sha256: fixtureContractSha, authority_scope: "INDUSTRIAL_3D_ATOMIC",
    agent_roster_semantic_sha256: registry.agent_roster_semantic_sha256, specialist_roster_semantic_sha256: registry.specialist_roster_semantic_sha256,
    atomic_inventory_semantic_sha256: registry.atomic_inventory_semantic_sha256, routing_index_semantic_sha256: registry.routing_index_semantic_sha256,
    registry_contract_sha256: registry.registry_contract_sha256, registry_agent_state: registry.registry_agent_state,
    agent_roster_status: registry.agent_roster_status, specialist_roster_status: registry.specialist_roster_status,
    atomic_inventory_status: registry.atomic_inventory_status, routing_index_status: registry.routing_index_status,
    registry_activation: registry.registry_activation,
    custody_ref: INDUSTRIAL_3D_CUSTODY_REF, memory_rule: "MEMORY_READBACK_IS_CONTEXT_ONLY;_NO_MEMORY_WRITE_OR_AUTHORITY_PROMOTION",
    invalidation_triggers: [
      "block semantic digest changes", "source lock identity, version, freshness, or supersession changes", "standard block or source manifest changes",
      "gate or hostile fixture bytes change", "model-policy snapshot or route changes", "upstream router bytes or result changes",
      "registry projection, entry state, or semantic digest changes", "memory readback or context receipt changes", "custody or lifecycle state changes",
    ].sort(compareUtf8),
    context_sha256: null,
  };
  return Object.freeze({...body, context_sha256: canonicalDigest(body)});
}
function canonicalMemoryReadback(contextSha) {
  return Object.freeze({schema: "agentos.industrial_3d_memory_readback.v1", version: 1, status: "CURRENT", context_sha256: contextSha, policy: "READ_ONLY_CONTEXT_ONLY"});
}
function stripRawRegistryProvenance(value) {
  if (Array.isArray(value)) return value.map(stripRawRegistryProvenance);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.endsWith("_file_sha256") && key !== "file_sha256")
    .map(([key, child]) => [key, stripRawRegistryProvenance(child)]));
}
function registryContract({blockSha, modelRoute}) {
  sha(blockSha, "Industrial 3D registry candidate digest");
  const agentArtifact = readJson(AGENT_ROSTER_PATH, "Reusable-agent roster");
  const specialistArtifact = readJson(SPECIALIST_ROSTER_PATH, "Specialist roster");
  const atomicArtifact = readJson(ATOMIC_INVENTORY_PATH, "Atomic specialist inventory");
  const routingArtifact = readJson(ROUTING_INDEX_PATH, "Specialist routing index");
  const agent = agentArtifact.value; const specialist = specialistArtifact.value; const atomic = atomicArtifact.value; const routing = routingArtifact.value;
  assert(agent.schema === "agentos.reusable_agent_roster.v1" && agent.version === 1 && agent.status === "COMPILED_CANDIDATE" && agent.project_agnostic === true, "Industrial 3D agent roster identity differs", "INDUSTRIAL_3D_REGISTRY_INVALID");
  assert(specialist.schema === "agentos.specialist_roster.v1" && specialist.version === 1 && specialist.status === "COMPILED_CANDIDATE" && specialist.activation === "OFF", "Industrial 3D specialist roster identity differs", "INDUSTRIAL_3D_REGISTRY_INVALID");
  assert(atomic.schema === "agentos.atomic_specialist_inventory.v1" && atomic.version === 1 && atomic.status === "PLANNED_ATOMIC_BACKLOG" && atomic.activation === "OFF", "Industrial 3D atomic inventory identity differs", "INDUSTRIAL_3D_REGISTRY_INVALID");
  assert(routing.schema === "agentos.specialist_routing.v1" && routing.version === 1 && routing.status === "COMPILED_CANDIDATE", "Industrial 3D routing index identity differs", "INDUSTRIAL_3D_REGISTRY_INVALID");
  sha(agent.roster_sha256, "Industrial 3D agent roster digest");
  sha(specialist.roster_sha256, "Industrial 3D specialist roster digest");
  sha(routing.routing_sha256, "Industrial 3D routing index digest");
  assert(agent.roster_sha256 === canonicalDigest(without(agent, "roster_sha256")), "Industrial 3D agent roster digest differs", "INDUSTRIAL_3D_REGISTRY_DIGEST_INVALID");
  assert(specialist.roster_sha256 === canonicalDigest(without(specialist, "roster_sha256")), "Industrial 3D specialist roster digest differs", "INDUSTRIAL_3D_REGISTRY_DIGEST_INVALID");
  assert(routing.routing_sha256 === canonicalDigest(without(routing, "routing_sha256")), "Industrial 3D routing index digest differs", "INDUSTRIAL_3D_REGISTRY_DIGEST_INVALID");
  const agentEntry = agent.entries?.find((entry) => entry.stable_agent_id === "AGENT.GRAPHICS_INDUSTRIAL_3D");
  const specialistEntry = specialist.blocks?.find((entry) => entry.block_id === INDUSTRIAL_3D_BLOCK_ID);
  const atomicEntry = atomic.atomic_specialists?.find((entry) => entry.generic_id === "GRAPHICS.INDUSTRIAL_3D");
  const routingEntry = routing.routes?.find((entry) => entry.route_id === "route.graphics.industrial-3d");
  assert(agentEntry && agentEntry.canonical_block_id === INDUSTRIAL_3D_BLOCK_ID && agentEntry.package_path === INDUSTRIAL_3D_PACKAGE_PATH, "Industrial 3D agent roster binding is missing or substituted", "INDUSTRIAL_3D_ROSTER_BINDING_INVALID");
  assert(agentEntry.build_state === "CANDIDATE_READY_FOR_QUALIFICATION" && agentEntry.qa_state === "STATIC_PASS_REVIEW_REQUIRED" && agentEntry.independent_evaluation_state === "STATIC_PASS_REVIEW_REQUIRED", "Industrial 3D agent roster is not an inactive candidate", "INDUSTRIAL_3D_ROSTER_STATE_INVALID");
  assert(agentEntry.model_route?.task_class === INDUSTRIAL_3D_MODEL_TASK_CLASS && agentEntry.model_route.minimum_capability === INDUSTRIAL_3D_MODEL_CAPABILITY_FLOOR && JSON.stringify(agentEntry.model_route.required_capabilities) === JSON.stringify(INDUSTRIAL_3D_MODEL_CAPABILITIES) && agentEntry.model_route.route_source === "GLOBAL_MODEL_POLICY_SNAPSHOT", "Industrial 3D agent roster model route is invalid", "INDUSTRIAL_3D_MODEL_ROUTE_INVALID");
  assert(agentEntry.deterministic_gates?.status === "BOUND" && agentEntry.deterministic_gates.gates?.length === INDUSTRIAL_3D_GATE_IDS.length, "Industrial 3D agent roster gate provenance is incomplete", "INDUSTRIAL_3D_ROSTER_GATE_INVALID");
  assert(agentEntry.hostile_fixtures?.status === "BOUND" && agentEntry.hostile_fixtures.fixtures?.length === INDUSTRIAL_3D_FIXTURE_CLASSES.length, "Industrial 3D agent roster fixture provenance is incomplete", "INDUSTRIAL_3D_ROSTER_FIXTURE_INVALID");
  assert(agentEntry.required_evidence_handoff?.handoff_path === `${INDUSTRIAL_3D_PACKAGE_PATH}/handoff.json`, "Industrial 3D agent roster handoff binding is incomplete", "INDUSTRIAL_3D_ROSTER_HANDOFF_INVALID");
  assert(agentEntry.lifecycle?.kind === "SEED_TO_WORKER" && agentEntry.supersession_invalidation?.links?.includes(`${INDUSTRIAL_3D_PACKAGE_PATH}/evaluation.json`), "Industrial 3D agent roster lifecycle binding is incomplete", "INDUSTRIAL_3D_ROSTER_LIFECYCLE_INVALID");
  assert(modelRoute.route.task_class === agentEntry.model_route.task_class && modelRoute.route.minimum_capability === agentEntry.model_route.minimum_capability && JSON.stringify(modelRoute.route.required_capabilities) === JSON.stringify(agentEntry.model_route.required_capabilities), "Industrial 3D agent roster route differs from model policy", "INDUSTRIAL_3D_MODEL_ROUTE_INVALID");
  assert(specialistEntry && specialistEntry.candidate_digest === blockSha && specialistEntry.role_kind === "ATOMIC_SPECIALIST" && specialistEntry.status === "CANDIDATE" && specialistEntry.lifecycle === "NOT_ADMITTED" && specialistEntry.activation === "OFF", "Industrial 3D specialist roster candidate binding is invalid", "INDUSTRIAL_3D_ROSTER_STATE_INVALID");
  assert(atomicEntry && atomicEntry.router === "specialist.graphics.industrial-3d-router" && atomicEntry.block_id === INDUSTRIAL_3D_BLOCK_ID && atomicEntry.package_status === "COMPILED_CANDIDATE" && atomicEntry.evaluator_status === "STATIC_PASS_REVIEW_REQUIRED" && atomicEntry.evaluator_receipt === "specialist-eval.industrial-3d.v1", "Industrial 3D atomic inventory binding is invalid", "INDUSTRIAL_3D_ATOMIC_INVENTORY_INVALID");
  assert(routingEntry && routingEntry.role_kind === "ATOMIC_SPECIALIST" && JSON.stringify(routingEntry.select) === JSON.stringify([INDUSTRIAL_3D_BLOCK_ID]), "Industrial 3D routing index binding is invalid", "INDUSTRIAL_3D_ROUTING_INDEX_INVALID");
  const agentSemantic = stripRawRegistryProvenance({schema: agent.schema, version: agent.version, status: agent.status, project_agnostic: agent.project_agnostic, entry: agentEntry});
  const specialistSemantic = stripRawRegistryProvenance({schema: specialist.schema, version: specialist.version, status: specialist.status, activation: specialist.activation, entry: specialistEntry});
  const atomicSemantic = stripRawRegistryProvenance({schema: atomic.schema, version: atomic.version, status: atomic.status, activation: atomic.activation, entry: atomicEntry});
  const routingSemantic = stripRawRegistryProvenance({schema: routing.schema, version: routing.version, status: routing.status, entry: routingEntry});
  const agentRosterSemanticSha256 = canonicalDigest(agentSemantic);
  const specialistRosterSemanticSha256 = canonicalDigest(specialistSemantic);
  const atomicInventorySemanticSha256 = canonicalDigest(atomicSemantic);
  const routingIndexSemanticSha256 = canonicalDigest(routingSemantic);
  const registryAgentState = agentEntry.build_state;
  const registryActivation = "OFF";
  const registryContractSha256 = canonicalDigest({
    schema: "agentos.industrial_3d_registry_contract.v1", version: 1,
    agent_roster_semantic_sha256: agentRosterSemanticSha256, specialist_roster_semantic_sha256: specialistRosterSemanticSha256,
    atomic_inventory_semantic_sha256: atomicInventorySemanticSha256, routing_index_semantic_sha256: routingIndexSemanticSha256,
    agent_roster_status: agent.status, specialist_roster_status: specialist.status, atomic_inventory_status: atomic.status,
    routing_index_status: routing.status, registry_agent_state: registryAgentState, registry_activation: registryActivation,
  });
  return Object.freeze({
    agent_roster_file_sha256: agentArtifact.file_sha256, specialist_roster_file_sha256: specialistArtifact.file_sha256,
    atomic_inventory_file_sha256: atomicArtifact.file_sha256, routing_index_file_sha256: routingArtifact.file_sha256,
    agent_roster_semantic_sha256: agentRosterSemanticSha256, specialist_roster_semantic_sha256: specialistRosterSemanticSha256,
    atomic_inventory_semantic_sha256: atomicInventorySemanticSha256, routing_index_semantic_sha256: routingIndexSemanticSha256,
    registry_contract_sha256: registryContractSha256, registry_agent_state: registryAgentState, registry_activation: registryActivation,
    agent_roster_status: agent.status, specialist_roster_status: specialist.status, atomic_inventory_status: atomic.status, routing_index_status: routing.status,
    agent_entry: agentEntry, specialist_entry: specialistEntry, atomic_entry: atomicEntry, routing_entry: routingEntry,
  });
}

export function resolveIndustrial3dCanonicalAuthority() {
  const nowMs = Date.now();
  const blockArtifact = readJson(path.join(PACKAGE, "block.json"), "Industrial 3D block");
  const block = checkBlock(blockArtifact, INDUSTRIAL_3D_BLOCK_ID, "Industrial 3D block");
  assert(block.lifecycle === "CANDIDATE", "Industrial 3D block is not a candidate", "INDUSTRIAL_3D_LIFECYCLE_INVALID");

  const sourceArtifact = readJson(path.join(PACKAGE, "sources.lock"), "Industrial 3D source lock");
  const sourceManifest = checkManifest(sourceArtifact.value, INDUSTRIAL_3D_BLOCK_ID, "Industrial 3D source lock");
  const atomicSource = sourceManifest.sources.find((source) => source.source_id === "source.atomic-specialization-law");
  const domainSource = sourceManifest.sources.find((source) => source.source_id === INDUSTRIAL_3D_SOURCE_ID);
  assert(atomicSource?.immutable_identity === "agentos-atomic-specialization-law-v1" && atomicSource.authority_class === "AGENTOS_PORTABLE", "Industrial 3D atomic source identity differs", "INDUSTRIAL_3D_SOURCE_IDENTITY_INVALID");
  assert(domainSource?.immutable_identity === "blender-gltf-2.0-manual-3.3-retrieved-2026-08-11" && domainSource.version === INDUSTRIAL_3D_SOURCE_VERSION && domainSource.authority_class === "PRIMARY_DESCRIPTIVE", "Industrial 3D domain source identity differs", "INDUSTRIAL_3D_SOURCE_IDENTITY_INVALID");
  checkFreshSource(atomicSource, "Industrial 3D atomic source", nowMs);
  checkFreshSource(domainSource, "Industrial 3D Blender source", nowMs);

  const standardArtifact = readJson(STANDARD_BLOCK_PATH, "glTF 2.0.1 standard block");
  const standard = checkBlock(standardArtifact, INDUSTRIAL_3D_STANDARD_BLOCK_ID, "glTF 2.0.1 standard block");
  const standardSourceArtifact = readJson(STANDARD_SOURCE_PATH, "glTF 2.0.1 standard source lock");
  const standardSourceManifest = checkManifest(standardSourceArtifact.value, INDUSTRIAL_3D_STANDARD_BLOCK_ID, "glTF 2.0.1 standard source lock");
  const standardSource = standardSourceManifest.sources.find((source) => source.source_id === INDUSTRIAL_3D_STANDARD_ID);
  assert(standardSource?.version === "2.0.1" && standardSource.immutable_identity === "khronos-gltf-2.0.1-specification-20230729" && standardSource.authority_class === "PRIMARY_NORMATIVE", "glTF 2.0.1 standard source identity differs", "INDUSTRIAL_3D_STANDARD_INVALID");
  checkFreshSource(standardSource, "glTF 2.0.1 standard source", nowMs);

  const modelArtifact = readJson(MODEL_PATH, "Global model-policy snapshot");
  const modelRoute = canonicalModelRoute(modelArtifact);
  const routerResult = canonicalRouterResult(modelRoute);
  const fixtureContractSha256 = fixtureContractSha();
  const registry = registryContract({blockSha: block.block_sha256, modelRoute});
  const context = canonicalContext({
    blockSha: block.block_sha256, sourceManifestSha: sourceManifest.manifest_sha256, standardSha: standard.block_sha256,
    standardSourceSha: standardSourceManifest.manifest_sha256, routerFileSha: routerResult.file_sha256,
    routerBlockSha: routerResult.block_sha256, routerFixtureSha: routerResult.fixture_file_sha256, routerInputSha: routerResult.input_sha256,
    routerResultSha: routerResult.result_sha256, routerModelSnapshotSha: routerResult.policy.global_snapshot_sha256,
    routerModelRouteSha: routerResult.policy.global_route_sha256, routerModelPolicyClaim: routerResult.policy.router_claim,
    routerModelBindingStatus: routerResult.policy.status, modelSnapshotSha: modelRoute.snapshot_sha256,
    modelRouteSha: modelRoute.route_sha256, fixtureContractSha: fixtureContractSha256, registry,
  });
  const memoryReadback = canonicalMemoryReadback(context.context_sha256);
  const memoryReadbackSha = canonicalDigest(memoryReadback);
  const gate = checkGateManifestAndFiles();
  const executionArtifact = readJson(path.join(PACKAGE, "gates/execution.json"), "Industrial 3D gate execution manifest");
  assert(executionArtifact.value.schema === "agentos.industrial_3d_gate_execution.v1" && executionArtifact.value.version === 1 && executionArtifact.value.block_id === INDUSTRIAL_3D_BLOCK_ID && JSON.stringify(executionArtifact.value.ordered_gate_ids) === JSON.stringify(INDUSTRIAL_3D_GATE_IDS), "Industrial 3D gate execution manifest is invalid", "INDUSTRIAL_3D_GATE_EXECUTION_INVALID");
  sha(executionArtifact.value.execution_sha256, "Industrial 3D gate execution digest");
  assert(executionArtifact.value.execution_sha256 === canonicalDigest(without(executionArtifact.value, "execution_sha256")), "Industrial 3D gate execution digest differs", "INDUSTRIAL_3D_GATE_EXECUTION_INVALID");
  const evaluationArtifact = readJson(path.join(PACKAGE, "evaluation.json"), "Industrial 3D evaluation dossier");
  const handoffArtifact = readJson(path.join(PACKAGE, "handoff.json"), "Industrial 3D handoff");
  const authority = {
    repository_root: ROOT, package_path: INDUSTRIAL_3D_PACKAGE_PATH, block_sha256: block.block_sha256, block_file_sha256: blockArtifact.file_sha256,
    source_manifest_sha256: sourceManifest.manifest_sha256, source_file_sha256: sourceArtifact.file_sha256, source_identity: INDUSTRIAL_3D_SOURCE_INPUT_ID,
    source_lock_identity: INDUSTRIAL_3D_SOURCE_ID, source_version: INDUSTRIAL_3D_SOURCE_VERSION, source_effective_date: domainSource.effective_date,
    source_retrieved_date: domainSource.retrieved_date, standard_block_id: INDUSTRIAL_3D_STANDARD_BLOCK_ID, standard_version: "2.0.1",
    standard_block_sha256: standard.block_sha256, standard_source_manifest_sha256: standardSourceManifest.manifest_sha256,
    standard_source_file_sha256: standardSourceArtifact.file_sha256, model: modelRoute.route, model_snapshot_sha256: modelRoute.snapshot_sha256,
    model_route_sha256: modelRoute.route_sha256, model_file_sha256: modelRoute.model_file_sha256, roster_file_sha256: registry.agent_roster_file_sha256,
    router_file_sha256: routerResult.file_sha256, router_block_sha256: routerResult.block_sha256, router_block_file_sha256: routerResult.block_file_sha256,
    router_fixture_file_sha256: routerResult.fixture_file_sha256, router_input_sha256: routerResult.input_sha256, router_expected_sha256: routerResult.fixture_expected_sha256,
    router_model_policy: routerResult.policy, router_result_sha256: routerResult.result_sha256, context_receipt_sha256: context.context_sha256,
    context_receipt: context, memory_readback: memoryReadback, memory_readback_sha256: memoryReadbackSha, fixture_contract_sha256: fixtureContractSha256, custody_ref: INDUSTRIAL_3D_CUSTODY_REF,
    registry,
    gate_manifest_sha256: gate.manifest.manifest_sha256, gate_manifest_file_sha256: gate.manifest_file_sha256, gate_semantic_inventory_sha256: gate.gate_semantic_inventory_sha256,
    gates: gate.gates, gate_execution: executionArtifact.value, gate_execution_file_sha256: executionArtifact.file_sha256,
    evaluation_file_sha256: evaluationArtifact.file_sha256, handoff_file_sha256: handoffArtifact.file_sha256,
  };
  return Object.freeze(authority);
}

export function assertIndustrial3dCanonicalEvidence(evidence, authority = resolveIndustrial3dCanonicalAuthority()) {
  assert(evidence.candidate_digest === authority.block_sha256, "Industrial 3D candidate digest is not canonical", "INDUSTRIAL_3D_CANDIDATE_BINDING_INVALID");
  assert(evidence.custody_ref === authority.custody_ref, "Industrial 3D custody reference is not canonical", "INDUSTRIAL_3D_CUSTODY_BINDING_INVALID");
  assert(evidence.authority_status === "CURRENT" && evidence.authority_scope === "INDUSTRIAL_3D_ATOMIC", "Industrial 3D authority scope is not canonical", "INDUSTRIAL_3D_SCOPE_INVALID");
  assert(evidence.asset_domain === "INDUSTRIAL_3D" && evidence.graphics_signal === "GRAPHICS.INDUSTRIAL_3D" && evidence.signal_status === "BOUND", "Industrial 3D signal is not canonical", "INDUSTRIAL_3D_SIGNAL_INVALID");
  assert(evidence.source_identity === authority.source_identity && evidence.source_version === authority.source_version && evidence.source_retrieved_date === authority.source_retrieved_date && evidence.source_manifest_sha256 === authority.source_manifest_sha256 && evidence.source_status === "CURRENT_VERIFIED", "Industrial 3D source evidence is not canonical", "INDUSTRIAL_3D_SOURCE_BINDING_INVALID");
  assert(evidence.standard_identity === authority.standard_block_id && evidence.standard_version === authority.standard_version && evidence.standard_block_sha256 === authority.standard_block_sha256 && evidence.standard_source_manifest_sha256 === authority.standard_source_manifest_sha256, "Industrial 3D standard identity is not canonical", "INDUSTRIAL_3D_STANDARD_BINDING_INVALID");
  assert(evidence.model_policy_status === authority.model.snapshot_status && evidence.model_snapshot_sha256 === authority.model_snapshot_sha256 && evidence.model_task_class === authority.model.task_class && evidence.model_capability_floor === authority.model.minimum_capability && JSON.stringify(evidence.model_required_capabilities) === JSON.stringify(authority.model.required_capabilities) && evidence.model_route_sha256 === authority.model_route_sha256 && evidence.model_route_status === "BOUND", "Industrial 3D model policy status is not canonical", "INDUSTRIAL_3D_MODEL_ROUTE_UNBOUND");
  assert(evidence.upstream_router_file_sha256 === authority.router_file_sha256 && evidence.upstream_router_block_sha256 === authority.router_block_sha256 && evidence.upstream_router_fixture_sha256 === authority.router_fixture_file_sha256 && evidence.upstream_router_input_sha256 === authority.router_input_sha256 && evidence.upstream_router_expected_sha256 === authority.router_expected_sha256 && evidence.upstream_router_result_sha256 === authority.router_result_sha256 && evidence.upstream_router_model_snapshot_sha256 === authority.router_model_policy.global_snapshot_sha256 && evidence.upstream_router_model_route_sha256 === authority.router_model_policy.global_route_sha256 && evidence.upstream_router_model_policy_claim === authority.router_model_policy.router_claim && evidence.upstream_router_model_binding_status === authority.router_model_policy.status, "Industrial 3D upstream router/model-policy binding is not canonical", "INDUSTRIAL_3D_UPSTREAM_MODEL_BINDING_INVALID");
  assert(evidence.context_receipt_sha256 === authority.context_receipt_sha256 && evidence.memory_readback_sha256 === authority.memory_readback_sha256 && evidence.fixture_contract_sha256 === authority.fixture_contract_sha256, "Industrial 3D context, memory, or fixture receipt is not canonical", "INDUSTRIAL_3D_CONTEXT_RECEIPT_INVALID");
  assert(evidence.agent_roster_semantic_sha256 === authority.registry.agent_roster_semantic_sha256 && evidence.specialist_roster_semantic_sha256 === authority.registry.specialist_roster_semantic_sha256 && evidence.atomic_inventory_semantic_sha256 === authority.registry.atomic_inventory_semantic_sha256 && evidence.routing_index_semantic_sha256 === authority.registry.routing_index_semantic_sha256 && evidence.registry_contract_sha256 === authority.registry.registry_contract_sha256 && evidence.registry_agent_state === authority.registry.registry_agent_state && evidence.agent_roster_status === authority.registry.agent_roster_status && evidence.specialist_roster_status === authority.registry.specialist_roster_status && evidence.atomic_inventory_status === authority.registry.atomic_inventory_status && evidence.routing_index_status === authority.registry.routing_index_status && evidence.registry_activation === authority.registry.registry_activation && evidence.registry_agent_state === "CANDIDATE_READY_FOR_QUALIFICATION" && evidence.registry_activation === "OFF", "Industrial 3D registry/context binding is not canonical", "INDUSTRIAL_3D_REGISTRY_CONTEXT_INVALID");
  assert(evidence.required_block_identities && JSON.stringify(evidence.required_block_identities) === JSON.stringify(INDUSTRIAL_3D_REQUIRED_BLOCKS), "Industrial 3D dependency identities are not canonical", "INDUSTRIAL_3D_BLOCK_BINDING_INVALID");
  assert(evidence.candidate_status === "CURRENT_CANDIDATE" && evidence.context_status === INDUSTRIAL_3D_CONTEXT_STATUS && evidence.context_complete === true && evidence.task_status === "INDUSTRIAL_3D_ANALYSIS", "Industrial 3D context binding is incomplete", "INDUSTRIAL_3D_CONTEXT_BINDING_INVALID");
  assert(evidence.asset_identity === "TYPED_ASSET" && evidence.asset_format === "GLTF" && evidence.asset_version === "2.0.1" && evidence.source_status === "CURRENT_VERIFIED", "Industrial 3D asset identity is not canonical", "INDUSTRIAL_3D_ASSET_BINDING_INVALID");
  assert(["IDENTITY", "INTERCHANGE", "MATERIALS", "TOPOLOGY", "PLACEMENT", "RUNTIME_ATTACHMENT"].includes(evidence.concern), "Industrial 3D concern is not atomic", "INDUSTRIAL_3D_CONCERN_INVALID");
  return authority;
}

export function assertIndustrial3dCommittedHandoff({authority = resolveIndustrial3dCanonicalAuthority(), evaluation, handoff, evaluationFileSha256, handoffFileSha256} = {}) {
  assert(evaluationFileSha256 === authority.evaluation_file_sha256 && handoffFileSha256 === authority.handoff_file_sha256, "Industrial 3D committed dossier is not current", "INDUSTRIAL_3D_CANONICAL_PROVENANCE_INVALID");
  exactKeys(evaluation, ["schema", "version", "receipt_id", "block_id", "candidate_digest", "model_requirement", "harness", "cases", "results", "disposition", "independence_rule"], "Industrial 3D committed evaluation");
  assert(evaluation.schema === "agentos.specialist_evaluation.v1" && evaluation.version === 1 && evaluation.receipt_id === "specialist-eval.industrial-3d.v1" && evaluation.block_id === INDUSTRIAL_3D_BLOCK_ID && evaluation.candidate_digest === authority.block_sha256 && evaluation.results?.passed === 17 && evaluation.results?.failed === 0 && evaluation.results?.pending === 0 && evaluation.disposition === "STATIC_PASS_REVIEW_REQUIRED", "Industrial 3D evaluation dossier is not current", "INDUSTRIAL_3D_EVALUATION_DOSSIER_INVALID");
  assert(Array.isArray(evaluation.cases) && evaluation.cases.length === INDUSTRIAL_3D_FIXTURE_CLASSES.length && new Set(evaluation.cases.map((entry) => entry.class)).size === INDUSTRIAL_3D_FIXTURE_CLASSES.length && evaluation.cases.every((entry) => INDUSTRIAL_3D_FIXTURE_CLASSES.includes(entry.class) && entry.observed === "PASS"), "Industrial 3D evaluation case coverage is incomplete", "INDUSTRIAL_3D_EVALUATION_DOSSIER_INVALID");
  exactKeys(handoff, ["schema", "version", "handoff_id", "block_id", "disposition", "candidate_digest", "source_commit", "source_tree", "changed_paths", "proof", "residuals", "next_action", "authority"], "Industrial 3D committed handoff");
  assert(handoff.schema === "agentos.specialist_handoff.v1" && handoff.version === 1 && handoff.handoff_id === "specialist-handoff.industrial-3d.v1" && handoff.block_id === INDUSTRIAL_3D_BLOCK_ID && handoff.disposition === "WAITING_WITH_RECEIPT" && handoff.candidate_digest === authority.block_sha256 && handoff.authority === "ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION", "Industrial 3D handoff identity differs", "INDUSTRIAL_3D_HANDOFF_INVALID");
  assert(GIT_OBJECT.test(handoff.source_commit) && GIT_OBJECT.test(handoff.source_tree), "Industrial 3D handoff source identity is not a Git object", "INDUSTRIAL_3D_HANDOFF_INVALID");
  assert(Array.isArray(handoff.proof) && handoff.proof.includes(`evaluation_file_sha256:${authority.evaluation_file_sha256}`) && handoff.proof.includes(`gate_execution_file_sha256:${authority.gate_execution_file_sha256}`) && handoff.proof.includes(`model_route_sha256:${authority.model_route_sha256}`) && handoff.proof.includes(`context_receipt_sha256:${authority.context_receipt_sha256}`) && handoff.proof.includes(`memory_readback_sha256:${authority.memory_readback_sha256}`) && handoff.proof.includes(`upstream_router_file_sha256:${authority.router_file_sha256}`) && handoff.proof.includes(`upstream_router_block_sha256:${authority.router_block_sha256}`) && handoff.proof.includes(`upstream_router_fixture_sha256:${authority.router_fixture_file_sha256}`) && handoff.proof.includes(`upstream_router_input_sha256:${authority.router_input_sha256}`) && handoff.proof.includes(`upstream_router_expected_sha256:${authority.router_expected_sha256}`) && handoff.proof.includes(`upstream_router_model_snapshot_sha256:${authority.router_model_policy.global_snapshot_sha256}`) && handoff.proof.includes(`upstream_router_model_route_sha256:${authority.router_model_policy.global_route_sha256}`) && handoff.proof.includes(`upstream_router_model_binding_status:${authority.router_model_policy.status}`) && handoff.proof.includes(`agent_roster_semantic_sha256:${authority.registry.agent_roster_semantic_sha256}`) && handoff.proof.includes(`specialist_roster_semantic_sha256:${authority.registry.specialist_roster_semantic_sha256}`) && handoff.proof.includes(`atomic_inventory_semantic_sha256:${authority.registry.atomic_inventory_semantic_sha256}`) && handoff.proof.includes(`routing_index_semantic_sha256:${authority.registry.routing_index_semantic_sha256}`) && handoff.proof.includes(`registry_contract_sha256:${authority.registry.registry_contract_sha256}`) && handoff.proof.includes(`registry_agent_state:${authority.registry.registry_agent_state}`) && handoff.proof.includes(`registry_activation:${authority.registry.registry_activation}`), "Industrial 3D handoff is not bound to current execution artifacts", "INDUSTRIAL_3D_HANDOFF_INVALID");
  return true;
}
