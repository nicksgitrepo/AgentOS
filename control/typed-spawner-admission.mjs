#!/usr/bin/env node

/* Admit the persistent project-agnostic Spawner/Compiler through typed custody. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {validateControllerGovernanceReadiness} from "./controller-governance-readiness.mjs";
import {validateSealedBootstrapHandoff} from "./sealed-bootstrap-handoff.mjs";

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
  "block_set", "custody", "admission_state", "mode", "temporary_admission", "worker_spawned", "wave_activation",
  "product_mutation", "provider_access", "credential_access", "permanent_roles_constructed", "next_action", "admission_sha256",
]);
const BLOCK_SET_KEYS = Object.freeze([
  "schema", "version", "block_set_id", "block_ids", "status", "non_placeholder", "hostile_fixture_ids",
  "independent_evaluation_sha256", "authority", "stop_conditions", "block_set_sha256",
]);
const CUSTODY_KEYS = Object.freeze(["route", "controller_id", "spawner_id", "source_readiness_sha256", "source_handoff_sha256", "custody_sha256"]);

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
  exactKeys(blockSet, BLOCK_SET_KEYS, "Spawner governing block set");
  assert(blockSet.schema === TYPED_SPAWNER_BLOCK_SET_SCHEMA && blockSet.version === TYPED_SPAWNER_ADMISSION_VERSION, "Spawner block set identity is invalid");
  requireToken(blockSet.block_set_id, "Spawner block set id");
  sortedUnique(blockSet.block_ids, "Spawner governing block ids");
  assert(blockSet.status === "COMPLETE_QA_PASS", "Spawner governing block set is not QA complete");
  assert(blockSet.non_placeholder === true, "Spawner governing block set contains placeholder content");
  sortedUnique(blockSet.hostile_fixture_ids, "Spawner governing hostile fixtures", {rejectPlaceholder: false});
  requireSha(blockSet.independent_evaluation_sha256, "Spawner independent evaluation");
  assert(blockSet.authority === "INDEPENDENT_ADMISSION_AUTHORITY", "Spawner block-set authority is invalid");
  nonPlaceholder(blockSet.stop_conditions, "Spawner block-set stop conditions");
  requireSha(blockSet.block_set_sha256, "Spawner block-set digest");
  assert(blockSet.block_set_sha256 === digestWithout(blockSet, "block_set_sha256"), "Spawner block-set digest mismatch");
  return blockSet;
}

export function compileSpawnerGoverningBlockSet({blockSetId, blockIds, hostileFixtureIds, independentEvaluationSha256, stopConditions} = {}) {
  assert(Array.isArray(blockIds), "Spawner block ids input is required");
  assert(Array.isArray(hostileFixtureIds), "Spawner hostile fixture ids input is required");
  const blockSet = {
    schema: TYPED_SPAWNER_BLOCK_SET_SCHEMA,
    version: TYPED_SPAWNER_ADMISSION_VERSION,
    block_set_id: blockSetId,
    block_ids: [...blockIds].sort(compareUtf8),
    status: "COMPLETE_QA_PASS",
    non_placeholder: true,
    hostile_fixture_ids: [...hostileFixtureIds].sort(compareUtf8),
    independent_evaluation_sha256: independentEvaluationSha256,
    authority: "INDEPENDENT_ADMISSION_AUTHORITY",
    stop_conditions: stopConditions,
    block_set_sha256: null,
  };
  blockSet.block_set_sha256 = digestWithout(blockSet, "block_set_sha256");
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

export function validateTypedSpawnerAdmission(admission, {governanceReadiness = null, sealedBootstrapHandoff = null} = {}) {
  exactKeys(admission, ADMISSION_KEYS, "Typed Spawner admission");
  assert(admission.schema === TYPED_SPAWNER_ADMISSION_SCHEMA && admission.version === TYPED_SPAWNER_ADMISSION_VERSION, "Typed Spawner admission identity is invalid");
  requireToken(admission.spawner_id, "Spawner admission spawner");
  requireIdentityToken(admission.controller_id, "Spawner admission Controller");
  requireSha(admission.governance_readiness_sha256, "Spawner admission governance readiness");
  requireSha(admission.sealed_handoff_sha256, "Spawner admission sealed handoff");
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

export function compileTypedSpawnerAdmission({spawnerId, controllerId, governanceReadiness, sealedBootstrapHandoff, blockSet, admittedAtUtc} = {}) {
  validateControllerGovernanceReadiness(governanceReadiness);
  validateSealedBootstrapHandoff(sealedBootstrapHandoff);
  assert(governanceReadiness.status === "READY_TO_ACCEPT_WORK", "Spawner admission requires Controller governance readiness");
  assert(sealedBootstrapHandoff.next_action === "ADMIT_TYPED_AGENT_SPAWNER", "Spawner admission requires sealed-handoff successor");
  validateSpawnerGoverningBlockSet(blockSet);
  requireToken(spawnerId, "Spawner admission spawner");
  requireIdentityToken(controllerId, "Spawner admission Controller");
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
    block_set: structuredClone(blockSet),
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
  return validateTypedSpawnerAdmission(admission, {governanceReadiness, sealedBootstrapHandoff});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Typed Spawner admission contract loaded\n");
