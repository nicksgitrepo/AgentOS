#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  CONTROLLER_GOVERNANCE_GATE_IDS,
  compileControllerGovernance,
  compileControllerGovernanceReadiness,
} from "../control/controller-governance-readiness.mjs";
import {compileSealedBootstrapHandoff} from "../control/sealed-bootstrap-handoff.mjs";
import {
  compileSpawnerGoverningBlockSet,
  compileTypedSpawnerAdmission,
  validateTypedSpawnerAdmission,
} from "../control/typed-spawner-admission.mjs";

const SHA = (char) => char.repeat(64);
const NOW = "2026-08-16T00:00:00.000Z";
const gateFor = (gateId) => ({
  gate_id: gateId,
  status: "PASS",
  rule: `The ${gateId} gate has a deterministic project-agnostic rule and exact stop behavior.`,
  evidence_sha256: SHA("a"),
  hostile_fixture_ids: [`FIXTURE.CONTROLLER.${gateId.split(".").at(-1)}.MISSING`, `FIXTURE.CONTROLLER.${gateId.split(".").at(-1)}.PLACEHOLDER`].sort(),
  authority: "PROJECT_AGNOSTIC_CONTROLLER",
  stop_condition: "Reject work acceptance and preserve the typed blocked readiness receipt until this gate passes.",
});
const governance = compileControllerGovernance({sourceCommit: "AGENTOS-COMMIT-1", sourceTree: "AGENTOS-TREE-1", gates: CONTROLLER_GOVERNANCE_GATE_IDS.map(gateFor)});
const readiness = compileControllerGovernanceReadiness({controllerId: "CONTROLLER-TASK-1", governance, observedAtUtc: NOW});
const handoff = compileSealedBootstrapHandoff({
  handoffId: "BOOTSTRAP-HANDOFF-1", bootstrapSessionId: "BOOTSTRAP-SESSION-1", controllerTaskId: "CONTROLLER-TASK-1", hostId: "local",
  projectBindingSha256: SHA("b"), controlPlaneBindingSha256: SHA("c"), planSha256: SHA("d"), executionStateSha256: SHA("e"),
  setupAuditSha256: SHA("f"), runtimeReadbackSha256: SHA("0"), controllerRuntimeReadbackSha256: SHA("1"), capabilitySetSha256: SHA("2"),
  sourceMappingSha256: SHA("3"), memoryPlanSha256: SHA("4"), quarantineGateStateSha256: SHA("5"), productZeroTraceReceiptSha256: SHA("6"),
});
assert.throws(() => compileSpawnerGoverningBlockSet({blockSetId: "SPAWNER-BLOCK-SET-INVALID"}), /block ids input is required/u);
assert.throws(() => compileSpawnerGoverningBlockSet({blockSetId: "SPAWNER-BLOCK-SET-INVALID", blockIds: []}), /hostile fixture ids input is required/u);
const blockSet = compileSpawnerGoverningBlockSet({
  blockSetId: "SPAWNER-BLOCK-SET-1",
  blockIds: ["SPAWNER.BLOCK.AUTHORITY", "SPAWNER.BLOCK.CUSTODY", "SPAWNER.BLOCK.COMPILER"],
  hostileFixtureIds: ["FIXTURE.SPAWNER.INCOMPLETE", "FIXTURE.SPAWNER.PLACEHOLDER", "FIXTURE.SPAWNER.ACTIVATION_BYPASS"],
  independentEvaluationSha256: SHA("7"),
  stopConditions: "Reject admission whenever a governing block is incomplete, placeholder, stale, or independently unevaluated.",
});

const admission = compileTypedSpawnerAdmission({
  spawnerId: "AGENTOS-SPAWNER-1",
  controllerId: "CONTROLLER-TASK-1",
  governanceReadiness: readiness,
  sealedBootstrapHandoff: handoff,
  blockSet,
  admittedAtUtc: NOW,
});
validateTypedSpawnerAdmission(admission, {governanceReadiness: readiness, sealedBootstrapHandoff: handoff});
assert.equal(admission.admission_state, "ADMITTED_COMPILER_ONLY");
assert.equal(admission.mode, "COMPILER_ONLY");
assert.equal(admission.temporary_admission, false);
assert.equal(admission.worker_spawned, false);
assert.equal(admission.wave_activation, "OFF");
assert.equal(admission.permanent_roles_constructed, 0);
assert.equal(admission.next_action, "CONSTRUCT_PERMANENT_ROLES_ONE_AT_A_TIME");

const blockedReadiness = compileControllerGovernanceReadiness({controllerId: "CONTROLLER-TASK-1", governance: null, observedAtUtc: NOW});
assert.throws(() => compileTypedSpawnerAdmission({spawnerId: "AGENTOS-SPAWNER-1", controllerId: "CONTROLLER-TASK-1", governanceReadiness: blockedReadiness, sealedBootstrapHandoff: handoff, blockSet, admittedAtUtc: NOW}), /Controller governance readiness/u);

const badHandoff = {...handoff, next_action: "SKIP_TO_WAVE", handoff_sha256: null};
badHandoff.handoff_sha256 = canonicalDigest({...badHandoff, handoff_sha256: null});
assert.throws(() => compileTypedSpawnerAdmission({spawnerId: "AGENTOS-SPAWNER-1", controllerId: "CONTROLLER-TASK-1", governanceReadiness: readiness, sealedBootstrapHandoff: badHandoff, blockSet, admittedAtUtc: NOW}), /next action is invalid/u);

const incompleteBlocks = {...blockSet, status: "INCOMPLETE", block_set_sha256: null};
incompleteBlocks.block_set_sha256 = canonicalDigest({...incompleteBlocks, block_set_sha256: null});
assert.throws(() => compileTypedSpawnerAdmission({spawnerId: "AGENTOS-SPAWNER-1", controllerId: "CONTROLLER-TASK-1", governanceReadiness: readiness, sealedBootstrapHandoff: handoff, blockSet: incompleteBlocks, admittedAtUtc: NOW}), /not QA complete/u);

const placeholderBlocks = {...blockSet, non_placeholder: false, block_set_sha256: null};
placeholderBlocks.block_set_sha256 = canonicalDigest({...placeholderBlocks, block_set_sha256: null});
assert.throws(() => compileTypedSpawnerAdmission({spawnerId: "AGENTOS-SPAWNER-1", controllerId: "CONTROLLER-TASK-1", governanceReadiness: readiness, sealedBootstrapHandoff: handoff, blockSet: placeholderBlocks, admittedAtUtc: NOW}), /placeholder/u);

const activationBypass = {...admission, worker_spawned: true, admission_sha256: null};
activationBypass.admission_sha256 = canonicalDigest({...activationBypass, admission_sha256: null});
assert.throws(() => validateTypedSpawnerAdmission(activationBypass), /cannot spawn a worker/u);

const custodyDrift = structuredClone(admission);
custodyDrift.custody.source_handoff_sha256 = SHA("8");
custodyDrift.custody.custody_sha256 = canonicalDigest({...custodyDrift.custody, custody_sha256: null});
custodyDrift.admission_sha256 = canonicalDigest({...custodyDrift, admission_sha256: null});
assert.throws(() => validateTypedSpawnerAdmission(custodyDrift), /custody handoff differs|custody digest mismatch/u);

const staleRosterRoute = {...admission, next_action: "PUBLISH_TYPED_ROSTER", admission_sha256: null};
staleRosterRoute.admission_sha256 = canonicalDigest({...staleRosterRoute, admission_sha256: null});
assert.throws(() => validateTypedSpawnerAdmission(staleRosterRoute), /next action is invalid/u);

console.log("PASS typed Spawner admission: predecessor identity/digest custody, complete governing blocks, compiler-only lifecycle, stale-route rejection, and hostile fail-closed checks");
