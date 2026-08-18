#!/usr/bin/env node

/* Canonical project-agnostic Agent Spawner bootstrap and admission authority. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {resolveCanonicalGlobalGovernanceProjection} from "./global-governance-bootstrap.mjs";
import {loadCanonicalControllerOperationRegistry} from "./controller-event-authority.mjs";
import {getSealedCanonicalAuthority, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";
import {verifyAndConsumeCurrentExternalSpawnerReview} from "./spawner-external-review.mjs";

export const SPAWNER_BOOTSTRAP_SCHEMA = "agentos.spawner_bootstrap_package.v1";
export const SPAWNER_ADMISSION_SCHEMA = "agentos.exact_spawner_admission.v1";
export const INERT_SEED_SCHEMA = "agentos.inert_seed_lifecycle.v1";
export const OWNERSHIP_CLASSIFICATION_SCHEMA = "agentos.spawner_ownership_classification.v1";
export const REDISTRIBUTION_HANDOFF_SCHEMA = "agentos.spawner_redistribution_handoff.v1";
export const SPAWNER_TURN_CLOSEOUT_SCHEMA = "agentos.spawner_turn_closeout.v1";

export const SPAWNER_BLOCK_LAYERS = Object.freeze([
  "GLOBAL", "PROJECT", "ROLE", "TECHNOLOGY_OR_STANDARD", "ENVIRONMENT", "TASK",
]);
export const SPAWNER_BOOTSTRAP_INJECTION_ORDER = Object.freeze([
  "CANONICAL_SPAWNER_BLOCK",
  "GLOBAL_GOVERNANCE_MEMORY_READBACK",
  "MODEL_POLICY_SNAPSHOT",
  "HOST_CAPABILITY_ATTESTATION",
  "REQUESTED_ROLE_BLOCK_GRAPH",
  "EXACT_BLOCK_QA",
  "INERT_SEED_CHECKPOINT",
  "WORKER_CONTEXT_PROJECTION",
]);
export const SPAWNER_DEFECT_KINDS = Object.freeze([
  "OBSERVED_DEFECT", "FAILED_GATE", "CONTRADICTION", "STALE_BLOCK", "MISSING_CONTEXT",
  "INVALID_HANDOFF", "UNAVAILABLE_MODEL", "BAD_RECEIPT", "SEED_INVALIDATION",
  "ROSTER_DEFECT", "SPAWNER_BOOTSTRAP_FLAW", "FAILED_REPAIR", "FAILED_QA",
]);
export const PROTECTED_BOUNDARIES = Object.freeze([
  "MATERIAL_SPEND", "IRREVERSIBLE_USER_WORK_LOSS", "DIRECT_CREDENTIAL_OR_HUMAN_INTERACTION",
  "MATERIAL_LEGAL_OR_SAFETY_EXPOSURE", "MAJOR_PRODUCT_RELEASE_OR_PRODUCTION_DECISION",
]);
export const CONTROLLER_ALLOWED_OPERATIONS = Object.freeze(loadCanonicalControllerOperationRegistry().operations.flatMap((entry) => entry.adapters));
export const CONTROLLER_FORBIDDEN_OPERATIONS = Object.freeze([
  "admitLocalSelfDevelopment", "admitSeed", "admitWorker", "applyPolicyReconciliation", "approveLaneHandoff", "runBootstrap",
  "archiveCampaignAgents", "bindPersistentRuntime", "closeCampaign", "compileRoleBlocks", "deployAcceptedArtifact",
  "despawnAgent", "mutateRoster", "notifyAuditor", "reconcileUserReview", "recoverStalledSession", "runLiveAudit",
  "sendLiveDeltaToNextOrchestrator", "spawnCampaignOrchestrator", "spawnFeatureAgents", "spawnIndependentAuditor",
  "spawnNextCampaignOrchestrator", "verifyCheckpoint", "wakeControllerAgent",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PLACEHOLDER = /(?:TBD|TODO|FIXME|PLACEHOLDER|FILL[ _-]?ME|LATER)/iu;
const REPEATED_SHA = /^([0-9a-f])\1{63}$/u;
const CANONICAL_PACKAGE_PATH = "specialist-blocks/control-plane/agent-spawner/block.json";
const CANONICAL_BLOCK_MANIFEST_PATH = "specialist-blocks/control-plane/agent-spawner/admission/manifest.json";
const canonicalPackageResolutions = new WeakSet();

function assert(condition, message, code = "SPAWNER_GOVERNANCE_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!PLACEHOLDER.test(value), `${label} contains a placeholder`, "PLACEHOLDER_BLOCK");
}
function requireId(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`); }
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function body(value, digestField) { return {...structuredClone(value), [digestField]: null}; }
function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const result = [...values].sort(compareUtf8);
  assert(new Set(result).size === result.length, `${label} contains duplicates`);
  return result;
}
function assertDigest(value, field, label) {
  requireSha(value[field], `${label} digest`);
  assert(value[field] === canonicalDigest(body(value, field)), `${label} digest mismatch`, "DIGEST_INVALID");
}
function sha256Bytes(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function safeArtifactPath(authorityRoot, relativePath, label) {
  requireString(authorityRoot, "Authority root");
  assert(typeof relativePath === "string" && relativePath.length > 0 && !/[\u0000-\u001f\u007f]/u.test(relativePath), `${label} must be a safe path`);
  assert(!path.isAbsolute(relativePath) && !relativePath.split("/").includes(".."), `${label} must be a safe relative path`, "ARTIFACT_PATH_INVALID");
  const root = fs.realpathSync.native(authorityRoot);
  const target = path.resolve(root, relativePath);
  assert(target.startsWith(`${root}${path.sep}`), `${label} escapes authority root`, "ARTIFACT_PATH_INVALID");
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must resolve to a regular non-symlink file`, "ARTIFACT_FILE_INVALID");
  return {root, target};
}
function readJsonArtifact(authorityRoot, relativePath, label) {
  const {root, target} = safeArtifactPath(authorityRoot, relativePath, label);
  const bytes = fs.readFileSync(target);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { assert(false, `${label} is not valid JSON`, "ARTIFACT_JSON_INVALID"); }
  return {root, target, relative_path: relativePath, bytes, file_sha256: sha256Bytes(bytes), value};
}
function assertNonPlaceholderSha(value, label) {
  requireSha(value, label);
  assert(!REPEATED_SHA.test(value), `${label} is placeholder-style evidence`, "PLACEHOLDER_EVIDENCE");
}

export function assertControllerOperationAuthorized(operation) {
  requireString(operation, "Controller operation");
  assert(CONTROLLER_ALLOWED_OPERATIONS.includes(operation), `Controller operation is forbidden: ${operation}`, "CONTROLLER_OPERATION_FORBIDDEN");
  return operation;
}

function validateCanonicalSpawnerBootstrapPackageShape(spawnerPackage) {
  requireRecord(spawnerPackage, "Spawner bootstrap package");
  assert(spawnerPackage.schema === SPAWNER_BOOTSTRAP_SCHEMA && spawnerPackage.version === 1, "Spawner bootstrap identity is invalid");
  assert(spawnerPackage.status === "COMPLETE_QA_PASS" && spawnerPackage.activation === "PREPARED_NOT_ACTIVATED", "Spawner bootstrap is not prepared and QA complete");
  requireId(spawnerPackage.block_id, "Spawner block ID");
  assert(spawnerPackage.project_agnostic === true && spawnerPackage.non_placeholder === true && spawnerPackage.content_addressed === true, "Spawner bootstrap portability/content-addressing invariant failed");
  for (const field of ["purpose", "scope", "authority", "required_knowledge", "stop_conditions", "typed_inputs", "typed_outputs", "custody", "lifecycle", "handoff_contract"]) {
    const value = spawnerPackage[field];
    assert(Array.isArray(value) && value.length > 0, `Spawner bootstrap lacks ${field}`);
    value.forEach((entry) => requireString(entry, `Spawner bootstrap ${field}`));
  }
  assert(JSON.stringify(spawnerPackage.bootstrap_injection_order) === JSON.stringify(SPAWNER_BOOTSTRAP_INJECTION_ORDER), "Spawner bootstrap injection order is invalid");
  assertNonPlaceholderSha(spawnerPackage.gate_manifest_sha256, "Spawner gate manifest");
  assertNonPlaceholderSha(spawnerPackage.hostile_fixture_manifest_sha256, "Spawner hostile fixture manifest");
  assertNonPlaceholderSha(spawnerPackage.controller_issuer_registry_sha256, "Spawner Controller issuer registry");
  assertNonPlaceholderSha(spawnerPackage.controller_operation_registry_sha256, "Spawner Controller operation registry");
  assertNonPlaceholderSha(spawnerPackage.independent_clearance_trust_anchor_sha256, "Spawner independent-clearance trust anchor");
  assertNonPlaceholderSha(spawnerPackage.model_policy_source_registry_sha256, "Spawner model-policy source registry");
  assertNonPlaceholderSha(spawnerPackage.decision_tree_sha256, "Spawner decision tree");
  assert(Array.isArray(spawnerPackage.gates) && spawnerPackage.gates.length >= 8, "Spawner bootstrap gate pack is incomplete");
  assert(Array.isArray(spawnerPackage.hostile_fixtures) && spawnerPackage.hostile_fixtures.length >= 12, "Spawner bootstrap hostile fixtures are incomplete");
  for (const gate of spawnerPackage.gates) {
    requireRecord(gate, "Spawner gate");
    requireId(gate.gate_id, "Spawner gate ID");
    requireString(gate.path, "Spawner gate path");
    assertNonPlaceholderSha(gate.file_sha256, "Spawner gate file digest");
    assertNonPlaceholderSha(gate.gate_sha256, "Spawner gate semantic digest");
    sortedUnique(gate.hostile_fixture_ids, `Spawner gate hostile fixtures ${gate.gate_id}`).forEach((fixture) => requireId(fixture, "Spawner hostile fixture"));
  }
  assert(new Set(spawnerPackage.gates.map((gate) => gate.gate_id)).size === spawnerPackage.gates.length, "Spawner bootstrap gate IDs are duplicated");
  assert(new Set(spawnerPackage.gates.map((gate) => gate.file_sha256)).size === spawnerPackage.gates.length, "Spawner bootstrap gate evidence hashes are repeated");
  sortedUnique(spawnerPackage.hostile_fixtures, "Spawner hostile fixtures").forEach((fixture) => requireId(fixture, "Spawner hostile fixture"));
  assertDigest(spawnerPackage, "package_sha256", "Spawner bootstrap package");
  return spawnerPackage;
}

function resolveCanonicalHostileFixtureInventory({authorityRoot, packageDirectory, spawnerPackage, resolvedGates}) {
  const fixtureManifestArtifact = readJsonArtifact(authorityRoot, path.posix.join(packageDirectory, "hostile-fixtures.manifest.json"), "Spawner hostile fixture manifest");
  const fixtureManifest = fixtureManifestArtifact.value;
  const admissionManifest = readJsonArtifact(authorityRoot, path.posix.join(packageDirectory, "admission/manifest.json"), "Spawner admission block manifest").value;
  const executedEvaluation = readJsonArtifact(authorityRoot, path.posix.join(packageDirectory, "hostile-evaluation.v1.json"), "Spawner executed hostile evaluation").value;
  assert(fixtureManifest.schema === "agentos.spawner_hostile_fixture_manifest.v1" && fixtureManifest.version === 1, "Spawner hostile fixture manifest identity is invalid");
  assertDigest(fixtureManifest, "manifest_sha256", "Spawner hostile fixture manifest");
  assert(fixtureManifest.manifest_sha256 === spawnerPackage.hostile_fixture_manifest_sha256, "Spawner hostile fixture manifest binding differs");
  const declaredIds = [...spawnerPackage.hostile_fixtures].sort(compareUtf8);
  const boundIds = resolvedGates.flatMap((gate) => gate.hostile_fixture_ids).sort(compareUtf8);
  assert(new Set(boundIds).size === boundIds.length && JSON.stringify(boundIds) === JSON.stringify(declaredIds), "Spawner hostile fixture inventory is incomplete, duplicated, or unbound");
  assert(Array.isArray(fixtureManifest.entries) && fixtureManifest.entries.length === declaredIds.length, "Spawner hostile fixture manifest coverage is incomplete");
  const fixtureIds = new Set(), fixtureHashes = new Set();
  for (const entry of fixtureManifest.entries) {
    requireId(entry.fixture_id, "Spawner hostile fixture ID"); requireId(entry.gate_id, "Spawner hostile fixture gate ID"); assert(typeof entry.path === "string" && entry.path.length > 0, "Spawner hostile fixture path is invalid"); requireSha(entry.file_sha256, "Spawner hostile fixture file digest");
    assert(entry.expected_outcome === "REJECT_WITH_TYPED_DEFECT", `Spawner hostile fixture lacks a negative expected outcome: ${entry.fixture_id}`);
    assert(!fixtureIds.has(entry.fixture_id) && !fixtureHashes.has(entry.file_sha256), `Spawner hostile fixture is duplicated or digest-aliased: ${entry.fixture_id}`); fixtureIds.add(entry.fixture_id); fixtureHashes.add(entry.file_sha256);
    const gate = resolvedGates.find((candidate) => candidate.gate_id === entry.gate_id); assert(gate?.hostile_fixture_ids.includes(entry.fixture_id), `Spawner hostile fixture is not bound to its gate: ${entry.fixture_id}`);
    const artifact = readJsonArtifact(authorityRoot, path.posix.join(packageDirectory, entry.path), `Spawner hostile fixture ${entry.fixture_id}`);
    assert(artifact.file_sha256 === entry.file_sha256, `Spawner hostile fixture file digest differs: ${entry.fixture_id}`);
    assert(artifact.value.schema === "agentos.spawner_hostile_fixture.v1" && artifact.value.fixture_id === entry.fixture_id && artifact.value.gate_id === entry.gate_id && artifact.value.expected_outcome === entry.expected_outcome, `Spawner hostile fixture content differs: ${entry.fixture_id}`);
  }
  assert(JSON.stringify([...fixtureIds].sort(compareUtf8)) === JSON.stringify(declaredIds), "Spawner hostile fixture manifest IDs differ from package");
  assert(executedEvaluation.schema === "agentos.spawner_hostile_evaluation.v1" && executedEvaluation.status === "PASS" && executedEvaluation.evaluation_sha256 === canonicalDigest({...executedEvaluation, evaluation_sha256: null}), "Spawner executed hostile evaluation receipt is invalid");
  assert(admissionManifest.manifest_sha256 === canonicalDigest({...admissionManifest, manifest_sha256: null}), "Spawner admission manifest digest is invalid");
  const candidateRootSha256 = canonicalDigest({
    admission_manifest_sha256: admissionManifest.manifest_sha256,
    controller_issuer_registry_sha256: spawnerPackage.controller_issuer_registry_sha256,
    controller_operation_registry_sha256: spawnerPackage.controller_operation_registry_sha256,
    decision_tree_sha256: spawnerPackage.decision_tree_sha256,
    fixture_manifest_sha256: fixtureManifest.manifest_sha256,
    gate_manifest_sha256: spawnerPackage.gate_manifest_sha256,
    model_policy_source_registry_sha256: spawnerPackage.model_policy_source_registry_sha256,
  });
  return {fixture_manifest: fixtureManifest, review_candidate_root_sha256: candidateRootSha256, review_authority_status: "EXTERNAL_PROVISIONING_REQUIRED"};
}

export function auditSpawnerBootstrapPackageAtUntrustedRoot({authorityRoot, packagePath = CANONICAL_PACKAGE_PATH} = {}) {
  const packageArtifact = readJsonArtifact(authorityRoot, packagePath, "Spawner package artifact");
  const spawnerPackage = validateCanonicalSpawnerBootstrapPackageShape(packageArtifact.value);
  const packageDirectory = path.posix.dirname(packagePath);
  const controllerIssuerRegistry = readJsonArtifact(authorityRoot, path.posix.join(packageDirectory, "controller-issuer-registry.v1.json"), "Spawner Controller issuer registry").value;
  const controllerOperationRegistry = readJsonArtifact(authorityRoot, path.posix.join(packageDirectory, "controller-operation-registry.v1.json"), "Spawner Controller operation registry").value;
  const clearanceTrustAnchor = readJsonArtifact(authorityRoot, path.posix.join(packageDirectory, "independent-clearance-trust-anchor.v1.json"), "Spawner independent-clearance trust anchor").value;
  const modelSourceRegistry = readJsonArtifact(authorityRoot, "fixtures/model-policy-evidence/source-registry.v1.json", "Spawner model-policy source registry").value;
  assertDigest(controllerIssuerRegistry, "registry_sha256", "Spawner Controller issuer registry");
  assertDigest(controllerOperationRegistry, "registry_sha256", "Spawner Controller operation registry");
  assertDigest(clearanceTrustAnchor, "anchor_sha256", "Spawner independent-clearance trust anchor");
  assertDigest(modelSourceRegistry, "registry_sha256", "Spawner model-policy source registry");
  assert(controllerIssuerRegistry.registry_sha256 === spawnerPackage.controller_issuer_registry_sha256, "Spawner Controller issuer registry binding differs");
  assert(controllerOperationRegistry.registry_sha256 === spawnerPackage.controller_operation_registry_sha256 && controllerIssuerRegistry.operation_registry_sha256 === controllerOperationRegistry.registry_sha256, "Spawner Controller operation registry binding differs");
  assert(clearanceTrustAnchor.anchor_sha256 === spawnerPackage.independent_clearance_trust_anchor_sha256, "Spawner independent-clearance trust anchor binding differs");
  assert(modelSourceRegistry.registry_sha256 === spawnerPackage.model_policy_source_registry_sha256, "Spawner model-policy source registry binding differs");
  const manifestPath = path.posix.join(packageDirectory, "gates/manifest.json");
  const decisionTreePath = path.posix.join(packageDirectory, "decision-tree.json");
  const manifestArtifact = readJsonArtifact(authorityRoot, manifestPath, "Spawner gate manifest artifact");
  const decisionArtifact = readJsonArtifact(authorityRoot, decisionTreePath, "Spawner decision-tree artifact");
  const manifest = manifestArtifact.value;
  assert(manifest.schema === "agentos.spawner_gate_manifest.v2" && manifest.version === 2, "Spawner gate manifest identity is invalid");
  assertDigest(manifest, "manifest_sha256", "Spawner gate manifest");
  assert(spawnerPackage.gate_manifest_sha256 === manifest.manifest_sha256, "Spawner package gate manifest binding differs");
  assert(decisionArtifact.value.decision_tree_sha256 === canonicalDigest({...decisionArtifact.value, decision_tree_sha256: null}), "Spawner decision-tree digest mismatch");
  assert(spawnerPackage.decision_tree_sha256 === decisionArtifact.value.decision_tree_sha256, "Spawner decision-tree binding differs");
  assert(Array.isArray(manifest.entries) && manifest.entries.length === spawnerPackage.gates.length, "Spawner gate manifest coverage differs");
  const fixtureSet = new Set(spawnerPackage.hostile_fixtures);
  const resolved = [];
  for (const entry of manifest.entries) {
    requireId(entry.gate_id, "Manifest gate ID");
    requireString(entry.path, "Manifest gate path");
    assertNonPlaceholderSha(entry.file_sha256, "Manifest gate file digest");
    assertNonPlaceholderSha(entry.gate_sha256, "Manifest gate semantic digest");
    const gatePath = path.posix.join(packageDirectory, entry.path);
    const gateArtifact = readJsonArtifact(authorityRoot, gatePath, `Gate artifact ${entry.gate_id}`);
    assert(gateArtifact.file_sha256 === entry.file_sha256, `Gate file digest differs: ${entry.gate_id}`, "GATE_FILE_DIGEST_MISMATCH");
    assert(gateArtifact.value.gate_id === entry.gate_id, `Gate ID/path binding differs: ${entry.gate_id}`, "GATE_ID_PATH_MISMATCH");
    assert(gateArtifact.value.gate_sha256 === canonicalDigest({...gateArtifact.value, gate_sha256: null}), `Gate semantic digest invalid: ${entry.gate_id}`);
    assert(gateArtifact.value.gate_sha256 === entry.gate_sha256, `Gate semantic digest differs: ${entry.gate_id}`);
    const fixtures = sortedUnique(entry.hostile_fixture_ids, `Manifest gate fixtures ${entry.gate_id}`);
    assert(fixtures.length > 0 && fixtures.every((fixture) => fixtureSet.has(fixture)), `Gate hostile fixture binding differs: ${entry.gate_id}`);
    resolved.push({...entry, artifact_path: gatePath});
  }
  assert(new Set(resolved.map((entry) => entry.gate_id)).size === resolved.length, "Spawner gate manifest contains duplicate IDs");
  assert(new Set(resolved.map((entry) => entry.file_sha256)).size === resolved.length, "Spawner gate manifest repeats file evidence");
  assert(JSON.stringify(resolved.map((entry) => entry.gate_id).sort(compareUtf8)) === JSON.stringify(spawnerPackage.gates.map((entry) => entry.gate_id).sort(compareUtf8)), "Spawner package/manifest gate IDs differ");
  for (const declared of spawnerPackage.gates) {
    const actual = resolved.find((entry) => entry.gate_id === declared.gate_id);
    assert(actual.path === declared.path && actual.file_sha256 === declared.file_sha256 && actual.gate_sha256 === declared.gate_sha256, `Spawner package gate binding differs: ${declared.gate_id}`);
  }
  const reviewedEvidence = resolveCanonicalHostileFixtureInventory({authorityRoot, packageDirectory, spawnerPackage, resolvedGates: resolved});
  return {spawner_package: spawnerPackage, package_file_sha256: packageArtifact.file_sha256, manifest, manifest_file_sha256: manifestArtifact.file_sha256, decision_tree: decisionArtifact.value, decision_tree_file_sha256: decisionArtifact.file_sha256, resolved_gates: resolved, ...reviewedEvidence};
}

export function auditSpawnerAdmissionArtifactsAtUntrustedRoot({authorityRoot, observedAtUtc} = {}) {
  requireUtc(observedAtUtc, "Untrusted admission audit time");
  const resolvedPackage = auditSpawnerBootstrapPackageAtUntrustedRoot({authorityRoot});
  return resolveAdmissionBlocks({authorityRoot, manifestPath: CANONICAL_BLOCK_MANIFEST_PATH, requiredLayers: [...SPAWNER_BLOCK_LAYERS].sort(compareUtf8), resolvedGates: resolvedPackage.resolved_gates, observedAtUtc});
}

export function resolveCanonicalSpawnerBootstrapPackage(options = undefined) {
  assert(options === undefined || (isRecord(options) && Object.keys(options).length === 0), "Caller-supplied package roots or paths are forbidden", "SEALED_AUTHORITY_REQUIRED");
  const canonicalRoot = sealedAuthorityRepositoryRoot(getSealedCanonicalAuthority());
  const resolution = auditSpawnerBootstrapPackageAtUntrustedRoot({authorityRoot: canonicalRoot, packagePath: CANONICAL_PACKAGE_PATH});
  const evaluation = JSON.parse(execFileSync(process.execPath, [path.join(canonicalRoot, "control/spawner-hostile-fixture-evaluator.mjs")], {cwd: canonicalRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024}));
  assert(evaluation.schema === "agentos.spawner_hostile_evaluation.v1" && evaluation.status === "PASS", "Canonical hostile fixture execution did not pass", "HOSTILE_FIXTURE_EXECUTION_FAILED");
  assert(evaluation.result_count === resolution.fixture_manifest.entries.length && evaluation.negative_assertion_count >= evaluation.result_count, "Canonical hostile fixture execution coverage is incomplete", "HOSTILE_FIXTURE_EXECUTION_INCOMPLETE");
  assert(evaluation.results.every((result) => result.actual_outcome === "REJECT_WITH_TYPED_DEFECT" && result.negative_assertion_count > 0), "Canonical hostile fixture did not produce its bound negative outcome", "HOSTILE_FIXTURE_EXECUTION_FAILED");
  const externalReview = verifyAndConsumeCurrentExternalSpawnerReview({candidate: resolution, hostileEvaluation: evaluation});
  resolution.hostile_evaluation = evaluation; resolution.external_review = externalReview;
  canonicalPackageResolutions.add(resolution);
  return Object.freeze(resolution);
}

export function prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation(options = undefined) {
  assert(options === undefined || (isRecord(options) && Object.keys(options).length === 0), "Caller-supplied package roots or paths are forbidden", "SEALED_AUTHORITY_REQUIRED");
  const canonicalRoot = sealedAuthorityRepositoryRoot(getSealedCanonicalAuthority());
  const resolution = auditSpawnerBootstrapPackageAtUntrustedRoot({authorityRoot: canonicalRoot, packagePath: CANONICAL_PACKAGE_PATH});
  const evaluation = JSON.parse(execFileSync(process.execPath, [path.join(canonicalRoot, "control/spawner-hostile-fixture-evaluator.mjs")], {cwd: canonicalRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024}));
  assert(evaluation.status === "PASS" && evaluation.result_count === resolution.fixture_manifest.entries.length && new Set(evaluation.results.map((entry) => entry.fixture_id)).size === evaluation.result_count, "Prepared candidate hostile execution is incomplete", "HOSTILE_FIXTURE_EXECUTION_FAILED");
  return Object.freeze({...resolution, hostile_evaluation: evaluation, disposition: "PREPARED_FOR_EXTERNAL_REVIEW_NOT_ADMITTED"});
}

export function validateCanonicalSpawnerBootstrapPackage(spawnerPackage, resolution = null) {
  validateCanonicalSpawnerBootstrapPackageShape(spawnerPackage);
  assert(canonicalPackageResolutions.has(resolution) && resolution?.spawner_package?.package_sha256 === spawnerPackage.package_sha256, "Spawner package requires sealed canonical artifact resolution", "CANONICAL_RESOLUTION_REQUIRED");
  return spawnerPackage;
}

export function compileSpawnerDenial({requestId, code, blockId = null, layer = null, detail, repairRoute, observedAtUtc}) {
  requireId(requestId, "Spawner denial request ID");
  requireId(code, "Spawner denial code");
  if (blockId !== null) requireId(blockId, "Spawner denial block ID");
  if (layer !== null) assert(SPAWNER_BLOCK_LAYERS.includes(layer), "Spawner denial layer is invalid");
  requireString(detail, "Spawner denial detail");
  requireString(repairRoute, "Spawner denial repair route");
  requireUtc(observedAtUtc, "Spawner denial time");
  const denial = {schema: "agentos.spawner_admission_denial.v1", version: 1, status: "DENIED", request_id: requestId, code, block_id: blockId, layer, detail, repair_route: repairRoute, observed_at_utc: observedAtUtc, denial_sha256: null};
  denial.denial_sha256 = canonicalDigest(body(denial, "denial_sha256"));
  return denial;
}

function resolveAdmissionBlocks({authorityRoot, manifestPath, requiredLayers, resolvedGates, observedAtUtc}) {
  const manifestArtifact = readJsonArtifact(authorityRoot, manifestPath, "Admission block manifest artifact");
  const manifest = manifestArtifact.value;
  assert(manifest.schema === "agentos.spawner_admission_block_manifest.v1" && manifest.version === 1, "Admission block manifest identity is invalid");
  assertDigest(manifest, "manifest_sha256", "Admission block manifest");
  const layers = sortedUnique(requiredLayers, "Required block layers");
  assert(JSON.stringify(layers) === JSON.stringify([...manifest.applicable_layers].sort(compareUtf8)), "Admission manifest applicable layers differ from the exact request", "APPLICABLE_LAYER_MISMATCH");
  assert(Array.isArray(manifest.entries) && manifest.entries.length === layers.length, "Admission manifest block coverage is not exact");
  const gateMap = new Map(resolvedGates.map((gate) => [gate.gate_id, gate]));
  const nowMs = Date.parse(observedAtUtc);
  const blocks = [];
  for (const entry of manifest.entries) {
    requireId(entry.block_id, "Admission manifest block ID");
    assert(SPAWNER_BLOCK_LAYERS.includes(entry.layer), `Admission manifest layer is invalid: ${entry.block_id}`);
    requireString(entry.version, "Admission manifest block version");
    requireString(entry.path, "Admission manifest block path");
    assertNonPlaceholderSha(entry.file_sha256, "Admission manifest block file digest");
    assertNonPlaceholderSha(entry.block_sha256, "Admission manifest block semantic digest");
    const artifact = readJsonArtifact(authorityRoot, path.posix.join(path.posix.dirname(manifestPath), entry.path), `Admission block artifact ${entry.block_id}`);
    assert(artifact.file_sha256 === entry.file_sha256, `Admission block file digest differs: ${entry.block_id}`, "BLOCK_FILE_DIGEST_MISMATCH");
    const block = artifact.value;
    assert(block.schema === "agentos.governance_block.v1" && block.version === 1, `Admission block identity is invalid: ${entry.block_id}`);
    assert(block.block_id === entry.block_id && block.layer === entry.layer && block.revision === entry.version, `Admission block manifest identity differs: ${entry.block_id}`);
    assert(block.block_sha256 === canonicalDigest({...block, block_sha256: null}), `Admission block semantic digest invalid: ${entry.block_id}`);
    assert(block.block_sha256 === entry.block_sha256, `Admission block semantic digest differs: ${entry.block_id}`);
    assert(block.status === "COMPLETE_QA_PASS" && block.availability === "AVAILABLE", `Admission block is not available and QA complete: ${entry.block_id}`);
    requireUtc(block.observed_at_utc, "Admission block observation time");
    requireUtc(block.expires_at_utc, "Admission block expiry time");
    assert(Date.parse(block.observed_at_utc) <= nowMs, `Admission block observation is in the future: ${entry.block_id}`, "BLOCK_FUTURE_EVIDENCE");
    assert(Date.parse(block.expires_at_utc) > nowMs, `Admission block is stale: ${entry.block_id}`, "BLOCK_STALE");
    requireRecord(block.semantic_content, "Admission block semantic content");
    const semanticText = JSON.stringify(block.semantic_content);
    assert(semanticText.length >= 160 && !PLACEHOLDER.test(semanticText), `Admission block semantic content is incomplete or placeholder: ${entry.block_id}`, "PLACEHOLDER_BLOCK");
    assertNonPlaceholderSha(block.content_sha256, "Admission block content digest");
    assert(block.content_sha256 === canonicalDigest(block.semantic_content), `Admission block content digest differs: ${entry.block_id}`);
    requireRecord(block.source_identity, "Admission block source identity");
    requireId(block.source_identity.source_id, "Admission block source ID");
    requireString(block.source_identity.source_version, "Admission block source version");
    assert(block.source_identity.source_version === block.revision && block.source_identity.content_sha256 === block.content_sha256, `Admission block source identity differs: ${entry.block_id}`);
    assert(Array.isArray(block.contradictions) && block.contradictions.length === 0, `Admission block is contradictory: ${entry.block_id}`);
    assert(Array.isArray(block.dependencies), `Admission block dependencies are invalid: ${entry.block_id}`);
    assert(Array.isArray(block.gate_bindings) && block.gate_bindings.length > 0, `Admission block lacks gate bindings: ${entry.block_id}`);
    const gateIds = new Set();
    for (const binding of block.gate_bindings) {
      requireId(binding.gate_id, "Admission block gate ID");
      assert(!gateIds.has(binding.gate_id), `Admission block gate ID is duplicated: ${entry.block_id}/${binding.gate_id}`);
      gateIds.add(binding.gate_id);
      const canonicalGate = gateMap.get(binding.gate_id);
      assert(canonicalGate !== undefined, `Admission block references an unknown gate: ${entry.block_id}/${binding.gate_id}`);
      assert(binding.gate_file_sha256 === canonicalGate.file_sha256 && binding.gate_sha256 === canonicalGate.gate_sha256, `Admission block gate artifact binding differs: ${entry.block_id}/${binding.gate_id}`);
      const fixtures = sortedUnique(binding.hostile_fixture_ids, `Admission block gate fixtures ${entry.block_id}/${binding.gate_id}`);
      assert(fixtures.length > 0 && fixtures.every((fixture) => canonicalGate.hostile_fixture_ids.includes(fixture)), `Admission block hostile fixtures differ: ${entry.block_id}/${binding.gate_id}`);
    }
    blocks.push({...block, artifact_path: artifact.relative_path, file_sha256: artifact.file_sha256});
  }
  assert(new Set(blocks.map((block) => block.block_id)).size === blocks.length, "Admission block IDs are duplicated");
  assert(new Set(blocks.map((block) => block.file_sha256)).size === blocks.length, "Admission block files alias repeated evidence");
  assert(new Set(blocks.map((block) => block.layer)).size === layers.length && layers.every((layer) => blocks.some((block) => block.layer === layer)), "Admission block layer coverage differs");
  const blockIds = new Set(blocks.map((block) => block.block_id));
  for (const block of blocks) for (const dependency of block.dependencies) assert(blockIds.has(dependency), `Admission dependency closure is incomplete: ${block.block_id}/${dependency}`);
  return {manifest, manifest_file_sha256: manifestArtifact.file_sha256, blocks};
}

export function compileExactSpawnerAdmission(options = {}) {
  requireRecord(options, "Spawner admission request");
  const allowedKeys = ["requestId", "globalGovernanceAuthorityStore", "applicableBlocks", "spawnerPackage", "modelPolicyProjection", "requiredLayers"];
  assert(Object.keys(options).every((key) => allowedKeys.includes(key)), "Caller-supplied package roots, paths, or authority objects are forbidden", "SEALED_AUTHORITY_REQUIRED");
  const {requestId, globalGovernanceAuthorityStore, applicableBlocks = undefined, spawnerPackage: callerSpawnerPackage = undefined, modelPolicyProjection = undefined, requiredLayers = undefined} = options;
  assert(applicableBlocks === undefined && callerSpawnerPackage === undefined, "Caller-supplied package or PASS evidence is forbidden; canonical artifacts must be resolved", "CALLER_EVIDENCE_FORBIDDEN");
  assert(modelPolicyProjection === undefined, "Caller-supplied model-policy projection is forbidden", "CALLER_EVIDENCE_FORBIDDEN");
  assert(requiredLayers === undefined, "Caller-supplied applicable layers are forbidden", "CALLER_EVIDENCE_FORBIDDEN");
  const canonicalAuthorityRoot = sealedAuthorityRepositoryRoot(getSealedCanonicalAuthority());
  const resolvedPackage = resolveCanonicalSpawnerBootstrapPackage();
  const spawnerPackage = resolvedPackage.spawner_package;
  requireId(requestId, "Spawner admission request ID");
  const governed = resolveCanonicalGlobalGovernanceProjection({authorityStore: globalGovernanceAuthorityStore, roleClass: "INERT_SEED"});
  const observedAtUtc = governed.observed_at_utc;
  requireUtc(observedAtUtc, "Spawner admission time");
  const layers = [...SPAWNER_BLOCK_LAYERS].sort(compareUtf8);
  const resolvedBlocks = resolveAdmissionBlocks({authorityRoot: canonicalAuthorityRoot, manifestPath: CANONICAL_BLOCK_MANIFEST_PATH, requiredLayers: layers, resolvedGates: resolvedPackage.resolved_gates, observedAtUtc});
  const canonicalProjection = governed.projection;
  assert(canonicalProjection.status === "READY" && canonicalProjection.spawn_eligible === true && canonicalProjection.selected !== null, "Canonical model-policy projection is not spawn eligible", "MODEL_POLICY_UNAVAILABLE");
  const admission = {
    schema: SPAWNER_ADMISSION_SCHEMA,
    version: 1,
    status: "READY_FOR_INERT_SEED",
    request_id: requestId,
    spawner_package_sha256: spawnerPackage.package_sha256,
    spawner_package_file_sha256: resolvedPackage.package_file_sha256,
    hostile_fixture_ids: [...spawnerPackage.hostile_fixtures].sort(compareUtf8),
    hostile_evaluation_sha256: resolvedPackage.hostile_evaluation.evaluation_sha256,
    spawner_stop_conditions: [...spawnerPackage.stop_conditions],
    block_manifest_sha256: resolvedBlocks.manifest.manifest_sha256,
    block_manifest_file_sha256: resolvedBlocks.manifest_file_sha256,
    required_layers: layers,
    block_evidence: resolvedBlocks.blocks.map((block) => ({block_id: block.block_id, layer: block.layer, revision: block.revision, artifact_path: block.artifact_path, file_sha256: block.file_sha256, block_sha256: block.block_sha256, content_sha256: block.content_sha256})).sort((left, right) => compareUtf8(left.block_id, right.block_id)),
    model_policy_snapshot_sha256: canonicalProjection.snapshot_sha256,
    model_policy_projection_sha256: canonicalProjection.projection_sha256,
    global_governance_ledger_head_sha256: governed.ledger_head_sha256,
    global_governance_bootstrap_sha256: governed.bootstrap_sha256,
    observed_at_utc: observedAtUtc,
    admission_sha256: null,
  };
  admission.admission_sha256 = canonicalDigest(body(admission, "admission_sha256"));
  return admission;
}

function compileInertSeedInternal({seedId, admission, contextSha256, rosterSha256, globalGovernanceAuthorityStore}) {
  requireId(seedId, "Seed ID");
  assert(admission?.schema === SPAWNER_ADMISSION_SCHEMA && admission.status === "READY_FOR_INERT_SEED", "Seed requires exact passing admission");
  [contextSha256, rosterSha256].forEach((value) => requireSha(value, "Seed binding"));
  const governed = resolveCanonicalGlobalGovernanceProjection({authorityStore: globalGovernanceAuthorityStore, roleClass: "INERT_SEED"});
  const modelPolicyProjection = governed.projection;
  const modelPolicySnapshotSha256 = governed.snapshot.snapshot_sha256;
  const createdAtUtc = new Date().toISOString();
  assert(modelPolicySnapshotSha256 === admission.model_policy_snapshot_sha256 && governed.ledger_head_sha256 === admission.global_governance_ledger_head_sha256 && governed.bootstrap_sha256 === admission.global_governance_bootstrap_sha256, "Seed model policy or governance head differs from admission");
  const seed = {
    schema: INERT_SEED_SCHEMA, version: 1, seed_id: seedId, state: "VERIFIED_INERT", immutable: true,
    work_authority: false, execution_authority: false, network_authority: false, mutation_authority: false,
    admission_sha256: admission.admission_sha256, context_sha256: contextSha256, roster_sha256: rosterSha256,
    model_policy_snapshot_sha256: modelPolicySnapshotSha256, model_policy_projection_sha256: modelPolicyProjection.projection_sha256,
    global_governance_ledger_head_sha256: governed.ledger_head_sha256, global_governance_bootstrap_sha256: governed.bootstrap_sha256,
    compact_model_policy: structuredClone(modelPolicyProjection.selected), predecessor_seed_sha256: null,
    created_at_utc: createdAtUtc, invalidated_at_utc: null, invalidation_reason: null,
    allowed_transitions: ["CLONE_TO_WORKER", "INVALIDATE", "ARCHIVE", "SUPERSEDE"], seed_sha256: null,
  };
  seed.seed_sha256 = canonicalDigest(body(seed, "seed_sha256"));
  return validateInertSeedShape(seed);
}

function validateInertSeedShape(seed) {
  requireRecord(seed, "Inert seed");
  assert(seed.schema === INERT_SEED_SCHEMA && seed.version === 1, "Inert seed identity is invalid");
  requireId(seed.seed_id, "Seed ID");
  assert(["VERIFIED_INERT", "INVALIDATED", "ARCHIVED", "SUPERSEDED"].includes(seed.state), "Inert seed state is invalid");
  assert(seed.immutable === true && seed.work_authority === false && seed.execution_authority === false && seed.network_authority === false && seed.mutation_authority === false, "Seed is not inert", "SEED_EXECUTION_FORBIDDEN");
  for (const field of ["admission_sha256", "context_sha256", "roster_sha256", "model_policy_snapshot_sha256", "model_policy_projection_sha256", "global_governance_ledger_head_sha256", "global_governance_bootstrap_sha256"]) requireSha(seed[field], `Seed ${field}`);
  requireRecord(seed.compact_model_policy, "Seed compact model policy");
  assertDigest(seed, "seed_sha256", "Inert seed");
  return seed;
}

function transitionInertSeedInternal(seed, {transition, observedAtUtc, reason = null, replacementSeedSha256 = null, globalGovernanceAuthorityStore, workerModelPolicyProjection = undefined} = {}) {
  validateInertSeedShape(seed);
  assert(seed.state === "VERIFIED_INERT", "Only a verified inert seed may transition");
  requireUtc(observedAtUtc, "Seed transition time");
  if (transition === "EXECUTE_WORK") assert(false, "An inert seed can never execute work", "SEED_EXECUTION_FORBIDDEN");
  if (transition === "CLONE_TO_WORKER") {
    assert(workerModelPolicyProjection === undefined, "Caller-supplied worker projection is forbidden");
    const governed = resolveCanonicalGlobalGovernanceProjection({authorityStore: globalGovernanceAuthorityStore, roleClass: "WORKING_AGENT"});
    assert(governed.snapshot.snapshot_sha256 === seed.model_policy_snapshot_sha256 && governed.ledger_head_sha256 === seed.global_governance_ledger_head_sha256 && governed.bootstrap_sha256 === seed.global_governance_bootstrap_sha256, "Inert seed is stale after model-policy supersession and must be invalidated/rebuilt");
    const canonicalWorkerProjection = governed.projection;
    const clone = {schema: "agentos.seed_worker_clone.v1", version: 1, status: "WORKER_CONTEXT_CANDIDATE", source_seed_sha256: seed.seed_sha256, bound_model_policy_snapshot_sha256: seed.model_policy_snapshot_sha256, bound_global_governance_ledger_head_sha256: governed.ledger_head_sha256, model_policy_projection_sha256: canonicalWorkerProjection.projection_sha256, compact_model_policy: structuredClone(canonicalWorkerProjection.selected), refresh_rule: "BOUND_UNTIL_HANDOFF_OR_TYPED_SAFE_REFRESH", created_at_utc: observedAtUtc, clone_sha256: null};
    clone.clone_sha256 = canonicalDigest(body(clone, "clone_sha256"));
    const readback = resolveCanonicalGlobalGovernanceProjection({authorityStore: globalGovernanceAuthorityStore, roleClass: "WORKING_AGENT"});
    assert(readback.ledger_head_sha256 === governed.ledger_head_sha256 && readback.projection.projection_sha256 === canonicalWorkerProjection.projection_sha256, "Global model policy changed during worker clone; retry after invalidation/rebuild");
    return clone;
  }
  assert(["INVALIDATE", "ARCHIVE", "SUPERSEDE"].includes(transition), "Seed transition is invalid");
  requireString(reason, "Seed transition reason");
  if (transition === "SUPERSEDE") requireSha(replacementSeedSha256, "Replacement seed digest");
  const next = structuredClone(seed);
  next.state = {INVALIDATE: "INVALIDATED", ARCHIVE: "ARCHIVED", SUPERSEDE: "SUPERSEDED"}[transition];
  next.invalidated_at_utc = observedAtUtc;
  next.invalidation_reason = reason;
  next.predecessor_seed_sha256 = transition === "SUPERSEDE" ? replacementSeedSha256 : next.predecessor_seed_sha256;
  next.seed_sha256 = canonicalDigest(body(next, "seed_sha256"));
  return validateInertSeedShape(next);
}

export function compileInertSeed() {
  assert(false, "Direct seed compilation is non-authoritative and forbidden; use the canonical governed admission receipt consumer", "DIRECT_SEED_AUTHORITY_FORBIDDEN");
}

export function validateInertSeed() {
  assert(false, "A seed shape or digest cannot prove current authority; use canonical seed readback", "DIRECT_SEED_AUTHORITY_FORBIDDEN");
}

export function transitionInertSeed() {
  assert(false, "Direct seed transition or clone is forbidden; use the canonical seed lifecycle adapter", "DIRECT_SEED_AUTHORITY_FORBIDDEN");
}

export function auditInertSeedShapeNonAuthoritatively(seed) {
  return validateInertSeedShape(seed);
}

export function compileOwnershipClassification({defectId, defectKind, affectedLayer, withinSpawnerAuthority, protectedBoundary = null, evidenceSha256, observedAtUtc}) {
  requireId(defectId, "Ownership defect ID");
  assert(SPAWNER_DEFECT_KINDS.includes(defectKind), "Ownership defect kind is invalid");
  assert(SPAWNER_BLOCK_LAYERS.includes(affectedLayer), "Ownership affected layer is invalid");
  requireSha(evidenceSha256, "Ownership evidence");
  requireUtc(observedAtUtc, "Ownership observation time");
  if (protectedBoundary !== null) assert(PROTECTED_BOUNDARIES.includes(protectedBoundary), "Protected boundary is not genuine", "FALSE_PROTECTED_BLOCKER");
  const ownership = withinSpawnerAuthority === true && protectedBoundary === null ? "SPAWNER_LANE" : "OUTSIDE_SPAWNER_LANE";
  const result = {
    schema: OWNERSHIP_CLASSIFICATION_SCHEMA, version: 1, status: "CLASSIFIED", defect_id: defectId,
    defect_kind: defectKind, affected_layer: affectedLayer, ownership, protected_boundary: protectedBoundary,
    owner_approval_required: false, controller_approval_required: false, evidence_sha256: evidenceSha256,
    next_action: ownership === "SPAWNER_LANE" ? "START_AUTONOMOUS_REPAIR" : "DELIVER_REDISTRIBUTION_HANDOFF",
    observed_at_utc: observedAtUtc, classification_sha256: null,
  };
  result.classification_sha256 = canonicalDigest(body(result, "classification_sha256"));
  return result;
}

export function compileRedistributionHandoff({classification, affectedScope, reasonOutsideLane, requiredCapabilities, suggestedDestination, dependencies, urgency, custodyState, rollback, nextAction}) {
  assert(classification?.schema === OWNERSHIP_CLASSIFICATION_SCHEMA && classification.ownership === "OUTSIDE_SPAWNER_LANE", "Redistribution requires out-of-lane ownership");
  [affectedScope, reasonOutsideLane, suggestedDestination, urgency, custodyState, rollback, nextAction].forEach((value) => requireString(value, "Redistribution field"));
  const handoff = {
    schema: REDISTRIBUTION_HANDOFF_SCHEMA, version: 1, status: "DELIVERED_TO_CONTROLLER_DISPATCH",
    classification_sha256: classification.classification_sha256, affected_scope: affectedScope,
    reason_outside_lane: reasonOutsideLane, required_capabilities: sortedUnique(requiredCapabilities, "Redistribution capabilities"),
    suggested_destination: suggestedDestination, dependencies: sortedUnique(dependencies, "Redistribution dependencies"),
    urgency, custody_state: custodyState, rollback, next_action: nextAction,
    controller_is_dispatcher_not_approver: true, handoff_sha256: null,
  };
  handoff.handoff_sha256 = canonicalDigest(body(handoff, "handoff_sha256"));
  return handoff;
}

export function compileSpawnerTurnCloseout({turnId, outcome, successorStartedSha256 = null, redistributionHandoffSha256 = null, protectedBlocker = null, resourcesActive = 0, restartEvent = null}) {
  requireId(turnId, "Spawner turn ID");
  assert(["NEXT_REPAIR_STARTED", "REPAIR_COMPLETED_AND_NEXT_STARTED", "REDISTRIBUTION_DELIVERED", "GENUINE_PROTECTED_BLOCKER"].includes(outcome), "Spawner turn closeout is invalid");
  if (["NEXT_REPAIR_STARTED", "REPAIR_COMPLETED_AND_NEXT_STARTED"].includes(outcome)) requireSha(successorStartedSha256, "Started successor");
  if (outcome === "REDISTRIBUTION_DELIVERED") requireSha(redistributionHandoffSha256, "Redistribution handoff");
  if (outcome === "GENUINE_PROTECTED_BLOCKER") {
    assert(PROTECTED_BOUNDARIES.includes(protectedBlocker), "False protected blocker cannot close a Spawner turn", "FALSE_PROTECTED_BLOCKER");
    assert(resourcesActive === 0, "Protected blocker closeout must have zero active resources");
    requireString(restartEvent, "Protected blocker restart event");
  }
  const closeout = {schema: SPAWNER_TURN_CLOSEOUT_SCHEMA, version: 1, status: "VALID_CLOSEOUT", turn_id: turnId, outcome, successor_started_sha256: successorStartedSha256, redistribution_handoff_sha256: redistributionHandoffSha256, protected_blocker: protectedBlocker, resources_active: resourcesActive, restart_event: restartEvent, closeout_sha256: null};
  closeout.closeout_sha256 = canonicalDigest(body(closeout, "closeout_sha256"));
  return closeout;
}

export function computeInvalidationClosure({changedDigests, dependencyGraph}) {
  const changed = new Set(sortedUnique(changedDigests, "Changed digests"));
  changed.forEach((digest) => requireSha(digest, "Changed digest"));
  assert(Array.isArray(dependencyGraph), "Dependency graph must be an array");
  const affected = new Set(changed);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const edge of dependencyGraph) {
      requireSha(edge.source_sha256, "Dependency source");
      requireSha(edge.dependent_sha256, "Dependency dependent");
      if (affected.has(edge.source_sha256) && !affected.has(edge.dependent_sha256)) {
        affected.add(edge.dependent_sha256);
        progressed = true;
      }
    }
  }
  return [...affected].sort(compareUtf8);
}
