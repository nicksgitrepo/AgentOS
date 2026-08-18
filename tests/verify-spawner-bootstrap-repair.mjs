#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
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
  reenterFailedSpawnerRepair,
} from "../control/spawner-defect-repair-loop.mjs";
import {admitAgentSpawnerIsolatedLocalCustody} from "../control/agent-spawner-lifecycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-08-17T23:30:00.000Z";
const SHA = (character) => character.repeat(64);
const blockPackage = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/control-plane/agent-spawner/block.json"), "utf8"));
const preparedPolicy = JSON.parse(fs.readFileSync(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json"), "utf8"));

validateCanonicalSpawnerBootstrapPackage(blockPackage);
const packageRoot = path.join(root, "specialist-blocks/control-plane/agent-spawner");
const gateManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "gates/manifest.json"), "utf8"));
assert.equal(gateManifest.manifest_sha256, canonicalDigest({...gateManifest, manifest_sha256: null}));
assert.equal(blockPackage.gate_manifest_sha256, gateManifest.manifest_sha256);
for (const relative of gateManifest.ordered_gate_paths) {
  const gate = JSON.parse(fs.readFileSync(path.join(packageRoot, relative), "utf8"));
  assert.equal(gate.gate_sha256, canonicalDigest({...gate, gate_sha256: null}), `gate digest mismatch: ${relative}`);
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
  roleCapabilityFloor: 50,
  requiredContextTokens: 64000,
  requiredCapabilities: ["CODE", "TOOLS"],
  nowUtc: NOW,
});
assert.equal(narrowRoute.model_id, "gpt-5.6-luna", "ECO must select the least-cost capable model, not the least capable model");
const securityRoute = selectEcoModelRoute({
  snapshot: activePolicy,
  taskClass: "SECURITY_REVIEW",
  roleCapabilityFloor: 60,
  requiredContextTokens: 128000,
  requiredCapabilities: ["SECURITY"],
  nowUtc: NOW,
});
assert.equal(securityRoute.model_id, "gpt-5.6-sol", "security capability floor must reject cheaper incapable models");

const projection = compileModelPolicyProjection({snapshot: activePolicy, roleClass: "WORKING_AGENT", selectedRoute: narrowRoute, projectedAtUtc: NOW});
assert.equal(projection.read_only, true);
assert.equal(projection.mutation_authority, false);
assert.deepEqual(Object.keys(projection.selected).sort(), [
  "capability_floor", "context_floor_tokens", "escalation_triggers", "fallback_models", "input_usd_per_million",
  "max_concurrency", "max_heavyweight_processes", "model_id", "output_usd_per_million", "reasoning_effort",
].sort());

function evidenceFor(layer, index) {
  const record = {
    block_id: `BLOCK.${layer}.${index}`,
    layer,
    block_sha256: SHA(String(index + 1)),
    status: "COMPLETE_QA_PASS",
    non_placeholder: true,
    evaluation: "PASS",
    availability: "AVAILABLE",
    observed_at_utc: NOW,
    expires_at_utc: "2026-09-16T23:30:00.000Z",
    contradictions: [],
    gates: [{gate_id: `GATE.${layer}.${index}`, outcome: "PASS", evidence_sha256: SHA(String(index + 2))}],
    evidence_sha256: null,
  };
  record.evidence_sha256 = canonicalDigest({...record, evidence_sha256: null});
  return record;
}
const blocks = SPAWNER_BLOCK_LAYERS.map(evidenceFor);
const admission = compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.TEST", spawnerPackage: blockPackage, requiredLayers: SPAWNER_BLOCK_LAYERS, applicableBlocks: blocks, modelPolicyProjection: projection, observedAtUtc: NOW});
assert.equal(admission.status, "READY_FOR_INERT_SEED");
assert.throws(() => compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.MISSING", spawnerPackage: blockPackage, requiredLayers: SPAWNER_BLOCK_LAYERS, applicableBlocks: blocks.slice(1), modelPolicyProjection: projection, observedAtUtc: NOW}), /missing/iu);
const staleBlocks = structuredClone(blocks);
staleBlocks[0].expires_at_utc = "2026-08-16T00:00:00.000Z";
staleBlocks[0].evidence_sha256 = canonicalDigest({...staleBlocks[0], evidence_sha256: null});
assert.throws(() => compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.STALE", spawnerPackage: blockPackage, requiredLayers: SPAWNER_BLOCK_LAYERS, applicableBlocks: staleBlocks, modelPolicyProjection: projection, observedAtUtc: NOW}), /stale/iu);
const inconclusive = structuredClone(blocks);
inconclusive[0].evaluation = "UNKNOWN";
inconclusive[0].evidence_sha256 = canonicalDigest({...inconclusive[0], evidence_sha256: null});
assert.throws(() => compileExactSpawnerAdmission({requestId: "REQUEST.SPAWNER.UNKNOWN", spawnerPackage: blockPackage, requiredLayers: SPAWNER_BLOCK_LAYERS, applicableBlocks: inconclusive, modelPolicyProjection: projection, observedAtUtc: NOW}), /inconclusive/iu);

const seed = compileInertSeed({seedId: "SEED.SPAWNER.TEST", admission, contextSha256: SHA("a"), rosterSha256: SHA("b"), modelPolicySnapshotSha256: activePolicy.snapshot_sha256, createdAtUtc: NOW});
assert.equal(seed.execution_authority, false);
assert.throws(() => transitionInertSeed(seed, {transition: "EXECUTE_WORK", observedAtUtc: NOW}), /never execute/iu);
const clone = transitionInertSeed(seed, {transition: "CLONE_TO_WORKER", observedAtUtc: NOW});
assert.equal(clone.source_seed_sha256, seed.seed_sha256);
assert.equal(clone.bound_model_policy_snapshot_sha256, activePolicy.snapshot_sha256);

for (const operation of CONTROLLER_FORBIDDEN_OPERATIONS) assert.throws(() => assertControllerOperationAuthorized(operation), /forbidden/iu);
assert.equal(assertControllerOperationAuthorized("startAgentSpawner"), "startAgentSpawner");
assert.throws(() => admitAgentSpawnerIsolatedLocalCustody(), /independent clearance/iu);

const owned = compileSpawnerDefectEnvelope({defectId: "DEFECT.SPAWNER.OWNED", defectKind: "FAILED_QA", owningLayer: "GLOBAL", withinSpawnerAuthority: true, evidenceSha256: SHA("c"), affectedDigests: [SHA("d")], requiredRepair: "Patch the global Spawner gate and rerun hostile QA.", observedAtUtc: NOW});
assert.equal(owned.status, "AUTONOMOUS_REPAIR_STARTED");
assert.equal(owned.owner_approval_required, false);
const retry = reenterFailedSpawnerRepair({failedDefect: owned, failureEvidenceSha256: SHA("e"), observedAtUtc: NOW});
assert.equal(retry.defect_kind, "FAILED_REPAIR");
assert.equal(retry.status, "AUTONOMOUS_REPAIR_STARTED");

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
assert.throws(() => selectEcoModelRoute({snapshot: unavailable, taskClass: "NARROW_CODING", roleCapabilityFloor: 50, requiredContextTokens: 64000, nowUtc: NOW}), /No available model/iu);
const stalePolicy = structuredClone(activePolicy);
stalePolicy.expires_at_utc = "2026-08-16T00:00:00.000Z";
stalePolicy.snapshot_sha256 = canonicalDigest({...stalePolicy, snapshot_sha256: null});
assert.throws(() => validateModelPolicySnapshot(stalePolicy, {nowUtc: NOW, requireActive: true}), /stale/iu);

console.log("PASS canonical Spawner bootstrap repair: exact layered QA, capability-first ECO, independent clearance, inert seeds, ownership recursion, redistribution, and mandatory successor closeout");
