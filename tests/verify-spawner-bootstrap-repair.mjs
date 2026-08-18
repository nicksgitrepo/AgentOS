#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  CONTROLLER_FORBIDDEN_OPERATIONS,
  SPAWNER_BLOCK_LAYERS,
  assertControllerOperationAuthorized,
  compileExactSpawnerAdmission,
  compileInertSeed,
  compileOwnershipClassification,
  compileRedistributionHandoff,
  compileSpawnerTurnCloseout,
  transitionInertSeed,
  auditSpawnerAdmissionArtifactsAtUntrustedRoot,
  prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation,
  resolveCanonicalSpawnerBootstrapPackage,
  validateCanonicalSpawnerBootstrapPackage,
} from "../control/spawner-bootstrap-governance.mjs";
import {
  compileModelPolicyProjection,
  selectEcoModelRoute,
  validateModelPolicySnapshot,
} from "../control/eco-model-policy.mjs";
import {
  compileSpawnerDefectEnvelope,
  compileSpawnerRepairReceipt,
  compileIndependentRepairEvaluationHandoff,
  reenterFailedSpawnerRepair,
} from "../control/spawner-defect-repair-loop.mjs";
import {admitAgentSpawnerIsolatedLocalCustody} from "../control/agent-spawner-lifecycle.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";
import {auditHostileGateMutationAtUntrustedRoot} from "../control/spawner-hostile-fixture-evaluator.mjs";
import {provisionTestExternalSpawnerReview} from "./helpers/spawner-external-review-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-08-18T08:30:00.000Z";
const SHA = (character) => character.repeat(64);
const blockPackage = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/control-plane/agent-spawner/block.json"), "utf8"));
const preparedPolicy = JSON.parse(fs.readFileSync(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json"), "utf8"));
const governanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-spawner-global-governance-"));
const governedFixture = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot, nowUtc: NOW});

const resolvedPackage = prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation({});
assert.equal(resolvedPackage.disposition, "PREPARED_FOR_EXTERNAL_REVIEW_NOT_ADMITTED");
assert.equal(resolvedPackage.hostile_evaluation.result_count, 38);
assert.equal(new Set(resolvedPackage.hostile_evaluation.results.map((entry) => entry.fixture_id)).size, 38);
assert(resolvedPackage.hostile_evaluation.results.every((entry) => entry.implementation_entrypoint.startsWith("control/") && entry.negative_assertion_count >= 2));
assert.equal(resolvedPackage.spawner_package.package_sha256, blockPackage.package_sha256);
assert.throws(() => validateCanonicalSpawnerBootstrapPackage(blockPackage, resolvedPackage), /sealed canonical artifact resolution/iu);
assert.throws(() => resolveCanonicalSpawnerBootstrapPackage({}), /separately provisioned reviewer|external review/iu);
const externalReviewFixture = provisionTestExternalSpawnerReview({candidate: resolvedPackage});
const packageRoot = path.join(root, "specialist-blocks/control-plane/agent-spawner");
const gateManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "gates/manifest.json"), "utf8"));
assert.equal(gateManifest.manifest_sha256, canonicalDigest({...gateManifest, manifest_sha256: null}));
assert.equal(blockPackage.gate_manifest_sha256, gateManifest.manifest_sha256);
for (const entry of gateManifest.entries) {
  const gateBytes = fs.readFileSync(path.join(packageRoot, entry.path));
  const gate = JSON.parse(gateBytes);
  assert.equal(crypto.createHash("sha256").update(gateBytes).digest("hex"), entry.file_sha256, `gate file digest mismatch: ${entry.path}`);
  assert.equal(gate.gate_sha256, canonicalDigest({...gate, gate_sha256: null}), `gate digest mismatch: ${entry.path}`);
}
const decisionTree = JSON.parse(fs.readFileSync(path.join(packageRoot, "decision-tree.json"), "utf8"));
assert.equal(decisionTree.decision_tree_sha256, canonicalDigest({...decisionTree, decision_tree_sha256: null}));
assert.equal(blockPackage.decision_tree_sha256, decisionTree.decision_tree_sha256);
assert.equal(decisionTree.owner_approval_for_spawner_lane, false);
assert.equal(decisionTree.controller_approval_for_spawner_lane, false);
validateModelPolicySnapshot(preparedPolicy, {nowUtc: NOW});
assert.equal(preparedPolicy.status, "PREPARED_INACTIVE");

const activePolicy = structuredClone(preparedPolicy);
activePolicy.status = "ACCEPTED_ACTIVE";
activePolicy.snapshot_sha256 = null;
activePolicy.snapshot_sha256 = canonicalDigest({...activePolicy, snapshot_sha256: null});
validateModelPolicySnapshot(activePolicy, {nowUtc: NOW, requireActive: true});

const narrowRoute = selectEcoModelRoute({
  snapshot: activePolicy,
  taskClass: "NARROW_CODING",
  roleCapabilityFloor: 49,
  requiredContextTokens: 64000,
  requiredCapabilities: ["CODE", "TOOLS"],
  nowUtc: NOW,
});
assert.equal(narrowRoute.model_id, "gpt-5.6-luna", "ECO must select the least-cost capable model, not the least capable model");
const securityRoute = selectEcoModelRoute({
  snapshot: activePolicy,
  taskClass: "SECURITY_REVIEW",
  roleCapabilityFloor: 59,
  requiredContextTokens: 128000,
  requiredCapabilities: ["SECURITY"],
  nowUtc: NOW,
});
assert.equal(securityRoute.model_id, "gpt-5.6-sol", "security capability floor must reject cheaper incapable models");

const projection = compileModelPolicyProjection({snapshot: activePolicy, roleClass: "WORKING_AGENT", selectedRoute: narrowRoute, projectedAtUtc: NOW});
const seedProjection = compileModelPolicyProjection({snapshot: activePolicy, roleClass: "INERT_SEED", selectedRoute: narrowRoute, projectedAtUtc: NOW});
assert.equal(projection.read_only, true);
assert.equal(projection.mutation_authority, false);
assert.deepEqual(Object.keys(projection.selected).sort(), [
  "capability_floor", "context_floor_tokens", "escalation_triggers", "fallback_models", "input_usd_per_million",
  "max_concurrency", "max_heavyweight_processes", "model_id", "output_usd_per_million", "reasoning_effort",
].sort());

const admission = compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.TEST", globalGovernanceAuthorityStore: governedFixture.authorityStore});
assert.equal(admission.status, "READY_FOR_INERT_SEED");
assert.equal(admission.block_evidence.length, SPAWNER_BLOCK_LAYERS.length);
assert(admission.block_evidence.every((entry) => fs.existsSync(path.join(root, entry.artifact_path))));
assert.throws(() => resolveCanonicalSpawnerBootstrapPackage({}), /already consumed|external review/iu);
assert.throws(() => compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.CALLER", spawnerPackage: blockPackage, applicableBlocks: [{status: "PASS"}], globalGovernanceAuthorityStore: governedFixture.authorityStore}), /Caller-supplied/iu);
assert.throws(() => compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.MISSING_LAYER", requiredLayers: SPAWNER_BLOCK_LAYERS.slice(1), globalGovernanceAuthorityStore: governedFixture.authorityStore}), /Caller-supplied applicable layers/iu);
assert.throws(() => compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.FORGED_PROJECTION", modelPolicyProjection: projection, globalGovernanceAuthorityStore: governedFixture.authorityStore}), /Caller-supplied model-policy/iu);

const shaBytes = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function hostileAuthority(mutator) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-spawner-artifact-hostile-"));
  fs.mkdirSync(path.join(temp, "specialist-blocks/control-plane"), {recursive: true});
  fs.cpSync(packageRoot, path.join(temp, "specialist-blocks/control-plane/agent-spawner"), {recursive: true});
  fs.mkdirSync(path.join(temp, "fixtures/model-policy-evidence"), {recursive: true});
  fs.copyFileSync(path.join(root, "fixtures/model-policy-evidence/source-registry.v1.json"), path.join(temp, "fixtures/model-policy-evidence/source-registry.v1.json"));
  mutator(temp);
  return temp;
}
function rebindAdmissionBlock(temp, fileName, mutate) {
  const directory = path.join(temp, "specialist-blocks/control-plane/agent-spawner/admission");
  const blockPath = path.join(directory, fileName);
  const block = JSON.parse(fs.readFileSync(blockPath, "utf8"));
  mutate(block);
  block.content_sha256 = canonicalDigest(block.semantic_content);
  block.source_identity.content_sha256 = block.content_sha256;
  block.block_sha256 = canonicalDigest({...block, block_sha256: null});
  fs.writeFileSync(blockPath, `${JSON.stringify(block)}\n`);
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entry = manifest.entries.find((candidate) => candidate.path === fileName);
  entry.file_sha256 = shaBytes(fs.readFileSync(blockPath));
  entry.block_sha256 = block.block_sha256;
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
}
function rebindPackage(temp, mutate) {
  const blockPath = path.join(temp, "specialist-blocks/control-plane/agent-spawner/block.json");
  const block = JSON.parse(fs.readFileSync(blockPath, "utf8"));
  mutate(block);
  block.package_sha256 = canonicalDigest({...block, package_sha256: null});
  fs.writeFileSync(blockPath, `${JSON.stringify(block)}\n`);
}

const weakenedGateRoot = hostileAuthority((temp) => {
  const gatePath = path.join(temp, "specialist-blocks/control-plane/agent-spawner/gates/controller-authority.gate");
  const gate = JSON.parse(fs.readFileSync(gatePath));
  gate.fail = "CONTINUE_WITHOUT_REJECTION";
  gate.unknown = "CONTINUE_WITHOUT_REJECTION";
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  fs.writeFileSync(gatePath, `${JSON.stringify(gate)}\n`);
});
try {
  const weakenedEvaluation = auditHostileGateMutationAtUntrustedRoot({authorityRoot: weakenedGateRoot});
  assert.equal(weakenedEvaluation.status, "FAIL");
  assert(weakenedEvaluation.failed_fixture_ids.includes("FIXTURE.SPAWNER.CONTROLLER_DIRECT_SPAWN"), "weakening a gate must fail a bound hostile fixture");
} finally {
  fs.rmSync(weakenedGateRoot, {recursive: true, force: true});
}
function expectHostile(mutator, pattern) {
  const temp = hostileAuthority(mutator);
  try { assert.throws(() => auditSpawnerAdmissionArtifactsAtUntrustedRoot({authorityRoot: temp, observedAtUtc: NOW}), pattern); }
  finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
expectHostile((temp) => fs.unlinkSync(path.join(temp, "specialist-blocks/control-plane/agent-spawner/admission/task.block.json")), /ENOENT|missing/iu);
expectHostile((temp) => rebindAdmissionBlock(temp, "global.block.json", (block) => { block.expires_at_utc = "2026-08-16T00:00:00.000Z"; }), /stale/iu);
expectHostile((temp) => rebindAdmissionBlock(temp, "project.block.json", (block) => { block.semantic_content.purpose = "TODO"; }), /placeholder/iu);
expectHostile((temp) => {
  const manifestPath = path.join(temp, "specialist-blocks/control-plane/agent-spawner/admission/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.entries[1].block_id = manifest.entries[0].block_id;
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
}, /duplicated|coverage|identity/iu);
expectHostile((temp) => {
  const manifestPath = path.join(temp, "specialist-blocks/control-plane/agent-spawner/admission/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  [manifest.entries[0].path, manifest.entries[1].path] = [manifest.entries[1].path, manifest.entries[0].path];
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
}, /file digest differs|identity differs|binding differs/iu);
expectHostile((temp) => {
  const manifestPath = path.join(temp, "specialist-blocks/control-plane/agent-spawner/admission/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.entries[0].file_sha256 = "a".repeat(64);
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
}, /placeholder-style evidence|file digest differs/iu);
expectHostile((temp) => {
  const manifestPath = path.join(temp, "specialist-blocks/control-plane/agent-spawner/gates/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.entries[1].gate_id = manifest.entries[0].gate_id;
  manifest.manifest_sha256 = canonicalDigest({...manifest, manifest_sha256: null});
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  rebindPackage(temp, (block) => { block.gate_manifest_sha256 = manifest.manifest_sha256; block.gates = manifest.entries; });
}, /duplicate IDs|gate ID|coverage differs/iu);
expectHostile((temp) => {
  const fixtureManifestPath = path.join(temp, "specialist-blocks/control-plane/agent-spawner/hostile-fixtures.manifest.json");
  const fixtureManifest = JSON.parse(fs.readFileSync(fixtureManifestPath));
  fixtureManifest.entries.pop();
  fixtureManifest.manifest_sha256 = canonicalDigest({...fixtureManifest, manifest_sha256: null});
  fs.writeFileSync(fixtureManifestPath, `${JSON.stringify(fixtureManifest)}\n`);
  rebindPackage(temp, (block) => { block.hostile_fixture_manifest_sha256 = fixtureManifest.manifest_sha256; block.hostile_fixtures = fixtureManifest.entries.map((entry) => entry.fixture_id).sort(); block.gates = block.gates.map((gate) => ({...gate, hostile_fixture_ids: gate.hostile_fixture_ids.filter((id) => block.hostile_fixtures.includes(id))})); });
}, /inventory|coverage|binding differs/iu);
assert.throws(() => compileInertSeed({seedId: "SEED.SPAWNER.FORGED", admission, contextSha256: SHA("a"), rosterSha256: SHA("b"), globalGovernanceAuthorityStore: governedFixture.authorityStore}), /Direct seed compilation/iu);
assert.throws(() => transitionInertSeed({seed_sha256: SHA("a")}, {transition: "CLONE_TO_WORKER", observedAtUtc: NOW}), /Direct seed transition/iu);

for (const operation of CONTROLLER_FORBIDDEN_OPERATIONS) assert.throws(() => assertControllerOperationAuthorized(operation), /forbidden/iu);
assert.equal(assertControllerOperationAuthorized("startAgentSpawner"), "startAgentSpawner");
assert.throws(() => admitAgentSpawnerIsolatedLocalCustody(), /independent clearance/iu);

const owned = compileSpawnerDefectEnvelope({defectId: "DEFECT.SPAWNER.OWNED", defectKind: "FAILED_QA", owningLayer: "GLOBAL", withinSpawnerAuthority: true, evidenceSha256: SHA("c"), affectedDigests: [SHA("d")], requiredRepair: "Patch the global Spawner gate and rerun hostile QA.", observedAtUtc: NOW});
assert.equal(owned.status, "AUTONOMOUS_REPAIR_STARTED");
assert.equal(owned.owner_approval_required, false);
const retry = reenterFailedSpawnerRepair({failedDefect: owned, failureEvidenceSha256: SHA("e"), observedAtUtc: NOW});
assert.equal(retry.defect_kind, "FAILED_REPAIR");
assert.equal(retry.status, "AUTONOMOUS_REPAIR_STARTED");
const verifierHandoff = compileIndependentRepairEvaluationHandoff({handoffId: "HANDOFF.SPAWNER.INDEPENDENT.HOSTILE", defect: owned, candidateCommit: "1".repeat(40), candidateTree: "2".repeat(40), packageSha256: blockPackage.package_sha256, evidenceSetSha256: SHA("3"), builderIdentitySha256: SHA("4"), modelPolicySnapshotSha256: activePolicy.snapshot_sha256, verifierRouteSha256: SHA("5"), verifierCapabilityFloor: 49, hostileFixtureIds: blockPackage.hostile_fixtures, observedAtUtc: NOW});
assert.equal(verifierHandoff.verifier_selection, "MOST_ECONOMICAL_CAPABLE_AVAILABLE_MODEL");
assert.equal(verifierHandoff.repair_worker_may_self_clear, false);
assert.equal(verifierHandoff.verifier_may_patch_candidate, false);
assert.equal(verifierHandoff.fail_or_inconclusive_route, "TYPED_OWNED_DEFECT_REENTERS_AUTONOMOUS_REPAIR");

const outside = compileOwnershipClassification({defectId: "DEFECT.SPAWNER.OUTSIDE", defectKind: "OBSERVED_DEFECT", affectedLayer: "PROJECT", withinSpawnerAuthority: false, evidenceSha256: SHA("f"), observedAtUtc: NOW});
const redistribution = compileRedistributionHandoff({classification: outside, affectedScope: "External product-intent decision", reasonOutsideLane: "The decision changes product intent and is not portable Spawner governance.", requiredCapabilities: ["PRODUCT_INTENT_AUTHORITY"], suggestedDestination: "PROJECT_INTENT_LANE", dependencies: ["OWNER_INTENT_RECORD"], urgency: "NORMAL", custodyState: "NO_MUTATION_PERFORMED", rollback: "No changes exist to roll back.", nextAction: "Controller dispatches the typed packet to the project-intent lane without approving it."});
assert.equal(redistribution.controller_is_dispatcher_not_approver, true);
const outsideDefect = compileSpawnerDefectEnvelope({defectId: "DEFECT.SPAWNER.OUTSIDE.MUTATION", defectKind: "OBSERVED_DEFECT", owningLayer: "PROJECT", withinSpawnerAuthority: false, evidenceSha256: SHA("f"), affectedDigests: [SHA("a")], requiredRepair: "Redistribute external scope without mutation.", observedAtUtc: NOW});
assert.equal(outsideDefect.status, "REDISTRIBUTION_REQUIRED");
assert.throws(() => compileSpawnerRepairReceipt({defect: outsideDefect, patchedLayer: "PROJECT"}), /cannot repair an out-of-lane/iu);

assert.throws(() => compileOwnershipClassification({defectId: "DEFECT.SPAWNER.FALSE_BLOCKER", defectKind: "FAILED_GATE", affectedLayer: "GLOBAL", withinSpawnerAuthority: true, protectedBoundary: "ROUTINE_TEST_FAILURE", evidenceSha256: SHA("a"), observedAtUtc: NOW}), /not genuine/iu);
assert.throws(() => compileSpawnerTurnCloseout({turnId: "TURN.SPAWNER.INVALID", outcome: "NEXT_REPAIR_STARTED"}), /SHA-256/iu);
const closeout = compileSpawnerTurnCloseout({turnId: "TURN.SPAWNER.VALID", outcome: "REPAIR_COMPLETED_AND_NEXT_STARTED", successorStartedSha256: SHA("b")});
assert.equal(closeout.status, "VALID_CLOSEOUT");

const unavailable = structuredClone(activePolicy);
unavailable.models.forEach((model) => { model.host_available = false; });
unavailable.snapshot_sha256 = canonicalDigest({...unavailable, snapshot_sha256: null});
assert.throws(() => selectEcoModelRoute({snapshot: unavailable, taskClass: "NARROW_CODING", roleCapabilityFloor: 49, requiredContextTokens: 64000, nowUtc: NOW}), /Host availability binding differs|No available model/iu);
const stalePolicy = structuredClone(activePolicy);
stalePolicy.expires_at_utc = "2026-08-16T00:00:00.000Z";
stalePolicy.snapshot_sha256 = canonicalDigest({...stalePolicy, snapshot_sha256: null});
assert.throws(() => validateModelPolicySnapshot(stalePolicy, {nowUtc: NOW, requireActive: true}), /stale/iu);

fs.rmSync(governanceRoot, {recursive: true, force: true});
fs.rmSync(externalReviewFixture.root, {recursive: true, force: true});
console.log("PASS canonical Spawner bootstrap repair: exact layered QA, canonical ECO projections, independent clearance, inert seeds, ownership recursion, redistribution, and mandatory successor closeout");
