#!/usr/bin/env node

/* Admit the persistent project-agnostic Spawner/Compiler through typed custody. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import fs from "node:fs";
import path from "node:path";
import {validateControllerGovernanceReadiness} from "./controller-governance-readiness.mjs";
import {validateSealedBootstrapHandoff} from "./sealed-bootstrap-handoff.mjs";
import {SPAWNER_BLOCK_LAYERS, compileExactSpawnerAdmission} from "./spawner-bootstrap-governance.mjs";
import {validateModelPolicyProjection} from "./eco-model-policy.mjs";
import {resolveCanonicalGlobalGovernanceProjection} from "./global-governance-bootstrap.mjs";

export const TYPED_SPAWNER_ADMISSION_SCHEMA = "agentos.typed_spawner_admission.v1";
export const TYPED_SPAWNER_BLOCK_SET_SCHEMA = "agentos.spawner_governing_block_set.v1";
export const TYPED_SPAWNER_ADMISSION_VERSION = 1;
export const TYPED_SPAWNER_ADMISSION_NEXT_ACTION = "CONSTRUCT_PERMANENT_ROLES_ONE_AT_A_TIME";

const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Z][A-Z0-9._:-]*$/u;
const IDENTITY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PLACEHOLDER = /(?:^|[^A-Z])(TBD|TODO|FIXME|PLACEHOLDER|FILL[ _-]?ME|LATER)(?:$|[^A-Z])/iu;
const PLACEHOLDER_ONLY = /^(?:TBD|TODO|FIXME|PLACEHOLDER|FILL[ _-]?ME|LATER)$/iu;
const ADMISSION_KEYS = Object.freeze([
  "schema", "version", "spawner_id", "controller_id", "governance_readiness_sha256", "sealed_handoff_sha256",
  "global_model_policy_projection_sha256",
  "block_set", "custody", "admission_state", "mode", "temporary_admission", "worker_spawned", "wave_activation",
  "product_mutation", "provider_access", "credential_access", "permanent_roles_constructed", "next_action", "admission_sha256",
]);
const BLOCK_SET_KEYS = Object.freeze([
  "schema", "version", "block_set_id", "required_layers", "block_evidence", "validated_at_utc", "status", "hostile_fixture_ids",
  "independent_evaluation_sha256", "authority", "stop_conditions", "block_set_sha256",
]);
const CUSTODY_KEYS = Object.freeze(["route", "controller_id", "spawner_id", "source_readiness_sha256", "source_handoff_sha256", "custody_sha256"]);
const canonicalBlockSets = new WeakSet();

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}
function requireToken(value, label) {
  assert(typeof value === "string" && TOKEN.test(value), `${label} must be a stable uppercase identifier`);
  assert(!PLACEHOLDER.test(value), `${label} cannot be a placeholder`);
}
function requireIdentityToken(value, label) {
  assert(typeof value === "string" && IDENTITY_TOKEN.test(value), `${label} must be a stable identity token`);
  assert(!PLACEHOLDER.test(value), `${label} cannot be a placeholder`);
}
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function digestWithout(value, field) { return canonicalDigest({...structuredClone(value), [field]: null}); }
function sortedUnique(values, label, {rejectPlaceholder = true} = {}) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && TOKEN.test(value) && (!rejectPlaceholder || !PLACEHOLDER.test(value))), `${label} contains an invalid value`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return values;
}
function nonPlaceholder(value, label, minimumLength = 24) {
  assert(typeof value === "string" && value.trim().length >= minimumLength && !PLACEHOLDER_ONLY.test(value.trim()), `${label} is incomplete or a placeholder`);
}

export function validateSpawnerGoverningBlockSet(blockSet) {
  assert(canonicalBlockSets.has(blockSet), "Spawner governing block set was not resolved from canonical reviewed artifacts");
  exactKeys(blockSet, BLOCK_SET_KEYS, "Spawner governing block set");
  assert(blockSet.schema === TYPED_SPAWNER_BLOCK_SET_SCHEMA && blockSet.version === TYPED_SPAWNER_ADMISSION_VERSION, "Spawner block set identity is invalid");
  requireToken(blockSet.block_set_id, "Spawner block set id");
  requireUtc(blockSet.validated_at_utc, "Spawner block-set validation time");
  assert(Array.isArray(blockSet.required_layers) && blockSet.required_layers.length > 0, "Spawner required layers are missing");
  const requiredLayers = [...blockSet.required_layers].sort(compareUtf8);
  assert(JSON.stringify(requiredLayers) === JSON.stringify(blockSet.required_layers) && new Set(requiredLayers).size === requiredLayers.length, "Spawner required layers must be sorted and unique");
  requiredLayers.forEach((layer) => assert(SPAWNER_BLOCK_LAYERS.includes(layer), `Spawner required layer is invalid: ${layer}`));
  assert(Array.isArray(blockSet.block_evidence) && blockSet.block_evidence.length > 0, "Spawner exact block evidence is missing");
  const blockIds = [];
  const coveredLayers = new Set();
  for (const block of blockSet.block_evidence) {
    exactKeys(block, ["block_id", "layer", "block_sha256", "status", "non_placeholder", "evaluation", "expires_at_utc", "contradictions", "gate_evidence", "evidence_sha256"], "Spawner exact block evidence");
    requireToken(block.block_id, "Spawner exact block id");
    assert(SPAWNER_BLOCK_LAYERS.includes(block.layer), `Spawner exact block layer is invalid: ${block.block_id}`);
    requireSha(block.block_sha256, "Spawner exact block digest");
    assert(block.status === "COMPLETE_QA_PASS", `Spawner exact block is not QA complete: ${block.block_id}`);
    assert(block.non_placeholder === true, `Spawner exact block contains placeholder content: ${block.block_id}`);
    assert(block.evaluation === "PASS", `Spawner exact block evaluation is inconclusive: ${block.block_id}`);
    requireUtc(block.expires_at_utc, "Spawner exact block expiry");
    assert(Date.parse(block.expires_at_utc) > Date.parse(blockSet.validated_at_utc), `Spawner exact block is stale: ${block.block_id}`);
    assert(Array.isArray(block.contradictions) && block.contradictions.length === 0, `Spawner exact block is contradictory: ${block.block_id}`);
    assert(Array.isArray(block.gate_evidence) && block.gate_evidence.length > 0, `Spawner exact block lacks gate evidence: ${block.block_id}`);
    for (const gate of block.gate_evidence) {
      exactKeys(gate, ["gate_id", "outcome", "evidence_sha256"], "Spawner exact gate evidence");
      requireToken(gate.gate_id, "Spawner exact gate id");
      assert(gate.outcome === "PASS", `Spawner exact gate did not pass: ${block.block_id}/${gate.gate_id}`);
      requireSha(gate.evidence_sha256, "Spawner exact gate evidence digest");
    }
    requireSha(block.evidence_sha256, "Spawner exact block evidence digest");
    assert(block.evidence_sha256 === digestWithout(block, "evidence_sha256"), `Spawner exact block evidence digest mismatch: ${block.block_id}`);
    blockIds.push(block.block_id);
    coveredLayers.add(block.layer);
  }
  assert(JSON.stringify(blockIds) === JSON.stringify([...blockIds].sort(compareUtf8)) && new Set(blockIds).size === blockIds.length, "Spawner exact block evidence must be sorted and unique");
  requiredLayers.forEach((layer) => assert(coveredLayers.has(layer), `Spawner required block layer is missing: ${layer}`));
  assert(blockSet.status === "COMPLETE_QA_PASS", "Spawner governing block set is not QA complete");
  sortedUnique(blockSet.hostile_fixture_ids, "Spawner governing hostile fixtures", {rejectPlaceholder: false});
  requireSha(blockSet.independent_evaluation_sha256, "Spawner independent evaluation");
  assert(blockSet.authority === "CANONICAL_SIGNED_GATE_REVIEW_AUTHORITY", "Spawner block-set authority is invalid");
  nonPlaceholder(blockSet.stop_conditions, "Spawner block-set stop conditions");
  requireSha(blockSet.block_set_sha256, "Spawner block-set digest");
  assert(blockSet.block_set_sha256 === digestWithout(blockSet, "block_set_sha256"), "Spawner block-set digest mismatch");
  return blockSet;
}

export function compileSpawnerGoverningBlockSet({blockSetId, globalGovernanceAuthorityStore, requiredLayers = undefined, blockEvidence = undefined, hostileFixtureIds = undefined, independentEvaluationSha256 = undefined} = {}) {
  assert(requiredLayers === undefined && blockEvidence === undefined && hostileFixtureIds === undefined && independentEvaluationSha256 === undefined, "Caller-authored governing block evidence is forbidden");
  const exactAdmission = compileExactSpawnerAdmission({requestId: `${blockSetId}.EXACT_ADMISSION`, globalGovernanceAuthorityStore});
  const canonicalBlockEvidence = exactAdmission.block_evidence.map((block) => {
    const artifact = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."), block.artifact_path), "utf8"));
    const evidence = {
      block_id: block.block_id, layer: block.layer, block_sha256: block.block_sha256, status: "COMPLETE_QA_PASS", non_placeholder: true, evaluation: "PASS",
      expires_at_utc: artifact.expires_at_utc, contradictions: [],
      gate_evidence: artifact.gate_bindings.map((gate) => ({gate_id: gate.gate_id, outcome: "PASS", evidence_sha256: gate.gate_sha256})).sort((left, right) => compareUtf8(left.gate_id, right.gate_id)),
      evidence_sha256: null,
    };
    evidence.evidence_sha256 = digestWithout(evidence, "evidence_sha256"); return evidence;
  });
  const blockSet = {
    schema: TYPED_SPAWNER_BLOCK_SET_SCHEMA,
    version: TYPED_SPAWNER_ADMISSION_VERSION,
    block_set_id: blockSetId,
    required_layers: [...SPAWNER_BLOCK_LAYERS].sort(compareUtf8),
    block_evidence: canonicalBlockEvidence.sort((left, right) => compareUtf8(left.block_id, right.block_id)),
    validated_at_utc: exactAdmission.observed_at_utc,
    status: "COMPLETE_QA_PASS",
    hostile_fixture_ids: [...exactAdmission.hostile_fixture_ids],
    independent_evaluation_sha256: exactAdmission.hostile_evaluation_sha256,
    authority: "CANONICAL_SIGNED_GATE_REVIEW_AUTHORITY",
    stop_conditions: exactAdmission.spawner_stop_conditions.join(" "),
    block_set_sha256: null,
  };
  blockSet.block_set_sha256 = digestWithout(blockSet, "block_set_sha256");
  canonicalBlockSets.add(blockSet);
  return validateSpawnerGoverningBlockSet(blockSet);
}

function validateCustody(custody, {controllerId, spawnerId, readinessSha256, handoffSha256} = {}) {
  exactKeys(custody, CUSTODY_KEYS, "Spawner admission custody");
  assert(custody.route === "CONTROLLER_TO_PERSISTENT_SPAWNER", "Spawner admission custody route is invalid");
  assert(custody.controller_id === controllerId && custody.spawner_id === spawnerId, "Spawner admission custody identity differs");
  assert(custody.source_readiness_sha256 === readinessSha256, "Spawner admission custody readiness differs");
  assert(custody.source_handoff_sha256 === handoffSha256, "Spawner admission custody handoff differs");
  requireSha(custody.custody_sha256, "Spawner admission custody digest");
  assert(custody.custody_sha256 === digestWithout(custody, "custody_sha256"), "Spawner admission custody digest mismatch");
  return custody;
}

export function validateTypedSpawnerAdmission(admission, {governanceReadiness = null, sealedBootstrapHandoff = null, globalPolicyProjection = null, modelPolicySnapshot = null} = {}) {
  exactKeys(admission, ADMISSION_KEYS, "Typed Spawner admission");
  assert(admission.schema === TYPED_SPAWNER_ADMISSION_SCHEMA && admission.version === TYPED_SPAWNER_ADMISSION_VERSION, "Typed Spawner admission identity is invalid");
  requireToken(admission.spawner_id, "Spawner admission spawner");
  requireIdentityToken(admission.controller_id, "Spawner admission Controller");
  requireSha(admission.governance_readiness_sha256, "Spawner admission governance readiness");
  requireSha(admission.sealed_handoff_sha256, "Spawner admission sealed handoff");
  requireSha(admission.global_model_policy_projection_sha256, "Spawner global model-policy projection");
  if (globalPolicyProjection !== null || modelPolicySnapshot !== null) {
    assert(globalPolicyProjection !== null && modelPolicySnapshot !== null, "Spawner admission requires projection and snapshot together");
    validateModelPolicyProjection(globalPolicyProjection, {snapshot: modelPolicySnapshot, expectedRoleClass: "SPAWNER"});
    assert(admission.global_model_policy_projection_sha256 === globalPolicyProjection.projection_sha256, "Spawner global model-policy projection is stale");
  }
  validateSpawnerGoverningBlockSet(admission.block_set);
  validateCustody(admission.custody, {
    controllerId: admission.controller_id,
    spawnerId: admission.spawner_id,
    readinessSha256: admission.governance_readiness_sha256,
    handoffSha256: admission.sealed_handoff_sha256,
  });
  assert(admission.admission_state === "ADMITTED_COMPILER_ONLY", "Spawner admission state is invalid");
  assert(admission.mode === "COMPILER_ONLY", "Spawner admission mode is invalid");
  assert(admission.temporary_admission === false, "Spawner admission cannot admit temporary workers");
  assert(admission.worker_spawned === false, "Spawner admission cannot spawn a worker");
  assert(admission.wave_activation === "OFF", "Spawner admission cannot activate a wave");
  assert(admission.product_mutation === "FORBIDDEN", "Spawner admission Product boundary is invalid");
  assert(admission.provider_access === "FORBIDDEN" && admission.credential_access === "FORBIDDEN", "Spawner admission external boundary is weakened");
  assert(admission.permanent_roles_constructed === 0, "Spawner admission constructed permanent roles too early");
  assert(admission.next_action === TYPED_SPAWNER_ADMISSION_NEXT_ACTION, "Spawner admission next action is invalid");
  requireSha(admission.admission_sha256, "Spawner admission digest");
  assert(admission.admission_sha256 === digestWithout(admission, "admission_sha256"), "Spawner admission digest mismatch");
  if (governanceReadiness !== null) {
    validateControllerGovernanceReadiness(governanceReadiness);
    assert(governanceReadiness.status === "READY_TO_ACCEPT_WORK", "Spawner admission requires Controller governance readiness");
    assert(admission.governance_readiness_sha256 === governanceReadiness.readiness_sha256, "Spawner admission governance readiness is stale");
  }
  if (sealedBootstrapHandoff !== null) {
    validateSealedBootstrapHandoff(sealedBootstrapHandoff);
    assert(sealedBootstrapHandoff.next_action === "ADMIT_TYPED_AGENT_SPAWNER", "Spawner admission requires the sealed handoff successor");
    assert(admission.sealed_handoff_sha256 === sealedBootstrapHandoff.handoff_sha256, "Spawner admission sealed handoff is stale");
    assert(admission.controller_id === sealedBootstrapHandoff.controller_task_id, "Spawner admission Controller differs from sealed handoff");
  }
  return admission;
}

export function compileTypedSpawnerAdmission({spawnerId, controllerId, governanceReadiness, sealedBootstrapHandoff, globalGovernanceAuthorityStore, blockSet = undefined, globalPolicyProjection = undefined, modelPolicySnapshot = undefined} = {}) {
  validateControllerGovernanceReadiness(governanceReadiness);
  validateSealedBootstrapHandoff(sealedBootstrapHandoff);
  assert(governanceReadiness.status === "READY_TO_ACCEPT_WORK", "Spawner admission requires Controller governance readiness");
  assert(sealedBootstrapHandoff.next_action === "ADMIT_TYPED_AGENT_SPAWNER", "Spawner admission requires sealed-handoff successor");
  assert(blockSet === undefined && globalPolicyProjection === undefined && modelPolicySnapshot === undefined, "Caller-authored block sets or model-policy projections are forbidden");
  const canonicalBlockSet = compileSpawnerGoverningBlockSet({blockSetId: "SPAWNER.BLOCK.SET.CANONICAL", globalGovernanceAuthorityStore});
  const governed = resolveCanonicalGlobalGovernanceProjection({authorityStore: globalGovernanceAuthorityStore, roleClass: "SPAWNER"});
  const canonicalProjection = governed.projection;
  requireToken(spawnerId, "Spawner admission spawner");
  requireIdentityToken(controllerId, "Spawner admission Controller");
  const admittedAtUtc = governed.observed_at_utc;
  requireUtc(admittedAtUtc, "Spawner admission time");
  assert(controllerId === sealedBootstrapHandoff.controller_task_id, "Spawner admission Controller differs from sealed handoff");
  const custody = {
    route: "CONTROLLER_TO_PERSISTENT_SPAWNER",
    controller_id: controllerId,
    spawner_id: spawnerId,
    source_readiness_sha256: governanceReadiness.readiness_sha256,
    source_handoff_sha256: sealedBootstrapHandoff.handoff_sha256,
    custody_sha256: null,
  };
  custody.custody_sha256 = digestWithout(custody, "custody_sha256");
  const admission = {
    schema: TYPED_SPAWNER_ADMISSION_SCHEMA,
    version: TYPED_SPAWNER_ADMISSION_VERSION,
    spawner_id: spawnerId,
    controller_id: controllerId,
    governance_readiness_sha256: governanceReadiness.readiness_sha256,
    sealed_handoff_sha256: sealedBootstrapHandoff.handoff_sha256,
    global_model_policy_projection_sha256: canonicalProjection.projection_sha256,
    block_set: canonicalBlockSet,
    custody,
    admission_state: "ADMITTED_COMPILER_ONLY",
    mode: "COMPILER_ONLY",
    temporary_admission: false,
    worker_spawned: false,
    wave_activation: "OFF",
    product_mutation: "FORBIDDEN",
    provider_access: "FORBIDDEN",
    credential_access: "FORBIDDEN",
    permanent_roles_constructed: 0,
    next_action: TYPED_SPAWNER_ADMISSION_NEXT_ACTION,
    admission_sha256: null,
  };
  admission.admission_sha256 = digestWithout(admission, "admission_sha256");
  return validateTypedSpawnerAdmission(admission, {governanceReadiness, sealedBootstrapHandoff, globalPolicyProjection: canonicalProjection, modelPolicySnapshot: governed.snapshot});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Typed Spawner admission contract loaded\n");
