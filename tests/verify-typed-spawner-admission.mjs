#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
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
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";
import {prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation} from "../control/spawner-bootstrap-governance.mjs";
import {provisionTestExternalSpawnerReview} from "./helpers/spawner-external-review-fixture.mjs";

const SHA = (char) => char.repeat(64);
const NOW = "2026-08-16T00:00:00.000Z";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const governanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-typed-spawner-governance-"));
const globalFixture = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot});
const globalPolicyProjection = globalFixture.projection("SPAWNER");
const modelPolicySnapshot = globalFixture.snapshot;
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
assert.throws(() => compileSpawnerGoverningBlockSet({blockSetId: "SPAWNER-BLOCK-SET-INVALID", requiredLayers: [], blockEvidence: []}), /Caller-authored/iu);
const blockSetReviewFixture = provisionTestExternalSpawnerReview({candidate: prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation(), install: false});
assert.throws(() => compileSpawnerGoverningBlockSet({
  blockSetId: "SPAWNER-BLOCK-SET-1",
  globalGovernanceAuthorityStore: globalFixture.authorityStore,
}), /external review|independent evaluator|provision/iu);

const admissionReviewFixture = provisionTestExternalSpawnerReview({candidate: prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation(), install: false});
assert.throws(() => compileTypedSpawnerAdmission({
  spawnerId: "AGENTOS-SPAWNER-1",
  controllerId: "CONTROLLER-TASK-1",
  governanceReadiness: readiness,
  sealedBootstrapHandoff: handoff,
  globalGovernanceAuthorityStore: globalFixture.authorityStore,
}), /external review|independent evaluator|provision/iu);

const blockedReadiness = compileControllerGovernanceReadiness({controllerId: "CONTROLLER-TASK-1", governance: null, observedAtUtc: NOW});
assert.throws(() => compileTypedSpawnerAdmission({spawnerId: "AGENTOS-SPAWNER-1", controllerId: "CONTROLLER-TASK-1", governanceReadiness: blockedReadiness, sealedBootstrapHandoff: handoff, globalGovernanceAuthorityStore: globalFixture.authorityStore}), /Controller governance readiness/u);

const badHandoff = {...handoff, next_action: "SKIP_TO_WAVE", handoff_sha256: null};
badHandoff.handoff_sha256 = canonicalDigest({...badHandoff, handoff_sha256: null});
assert.throws(() => compileTypedSpawnerAdmission({spawnerId: "AGENTOS-SPAWNER-1", controllerId: "CONTROLLER-TASK-1", governanceReadiness: readiness, sealedBootstrapHandoff: badHandoff, globalGovernanceAuthorityStore: globalFixture.authorityStore}), /next action is invalid/u);

assert.throws(() => validateTypedSpawnerAdmission({}), /fields mismatch/u);

fs.rmSync(governanceRoot, {recursive: true, force: true});
fs.rmSync(blockSetReviewFixture.root, {recursive: true, force: true});
fs.rmSync(admissionReviewFixture.root, {recursive: true, force: true});
console.log("PASS typed Spawner admission: canonical reviewed blocks and global-policy projection, predecessor custody, compiler-only lifecycle, and caller-evidence denial");
