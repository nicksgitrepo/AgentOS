#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, compareUtf8} from "../control/content-addressing.mjs";
import {
  CONTROLLER_GOVERNANCE_GATE_IDS,
  compileControllerGovernance,
  compileControllerGovernanceReadiness,
} from "../control/controller-governance-readiness.mjs";
import {compileSealedBootstrapHandoff} from "../control/sealed-bootstrap-handoff.mjs";
import {
  compileSpawnerGoverningBlockSet,
  compileTypedSpawnerAdmission,
} from "../control/typed-spawner-admission.mjs";
import {
  PERMANENT_ROLE_IDS,
  admitNextPermanentRole,
  compilePermanentRoleCandidate,
  compilePermanentRoleRoster,
  validatePermanentRoleRoster,
} from "../control/permanent-role-roster.mjs";
import {controllerActionHandlerFor, controllerContinuationDigest} from "../control/controller-action-dispatcher.mjs";
import {compileOperationalGlobalGovernanceContext} from "../control/global-governance-operational-context.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const SHA = (char) => char.repeat(64);
const NOW = "2026-08-16T00:00:00.000Z";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const governanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-permanent-role-governance-"));
const globalFixture = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot});
const permanentRoleContext = compileOperationalGlobalGovernanceContext({authorityStore: globalFixture.authorityStore, roleClass: "PERMANENT_ROLE", operationalId: "CONTEXT.PERMANENT.ROLE.ROSTER.TEST"});
const BLOCK_DIGEST_CHARS = ["8", "9", "a", "b"];
const EVALUATION_DIGEST_CHARS = ["c", "d", "e", "f"];
const redigest = (value, field) => {
  value[field] = canonicalDigest({...value, [field]: null});
  return value;
};
const gateFor = (gateId) => ({
  gate_id: gateId,
  status: "PASS",
  rule: `The ${gateId} gate has a deterministic project-agnostic rule and exact stop behavior.`,
  evidence_sha256: SHA("a"),
  hostile_fixture_ids: [`FIXTURE.CONTROLLER.${gateId.split(".").at(-1)}.MISSING`, `FIXTURE.CONTROLLER.${gateId.split(".").at(-1)}.PLACEHOLDER`].sort(compareUtf8),
  authority: "PROJECT_AGNOSTIC_CONTROLLER",
  stop_condition: "Reject work acceptance and preserve the typed blocked readiness receipt until this gate passes.",
});

const governance = compileControllerGovernance({
  sourceCommit: "AGENTOS-COMMIT-1",
  sourceTree: "AGENTOS-TREE-1",
  gates: CONTROLLER_GOVERNANCE_GATE_IDS.map(gateFor),
});
const readiness = compileControllerGovernanceReadiness({controllerId: "CONTROLLER-TASK-1", governance, observedAtUtc: NOW});
const handoff = compileSealedBootstrapHandoff({
  handoffId: "BOOTSTRAP-HANDOFF-1", bootstrapSessionId: "BOOTSTRAP-SESSION-1", controllerTaskId: "CONTROLLER-TASK-1", hostId: "local",
  projectBindingSha256: SHA("b"), controlPlaneBindingSha256: SHA("c"), planSha256: SHA("d"), executionStateSha256: SHA("e"),
  setupAuditSha256: SHA("f"), runtimeReadbackSha256: SHA("0"), controllerRuntimeReadbackSha256: SHA("1"), capabilitySetSha256: SHA("2"),
  sourceMappingSha256: SHA("3"), memoryPlanSha256: SHA("4"), quarantineGateStateSha256: SHA("5"), productZeroTraceReceiptSha256: SHA("6"),
});
const blockSet = compileSpawnerGoverningBlockSet({
  blockSetId: "SPAWNER.BLOCK.SET.PERMANENT.ROLE.TEST",
  globalGovernanceAuthorityStore: globalFixture.authorityStore,
});
const admission = compileTypedSpawnerAdmission({
  spawnerId: "AGENTOS-SPAWNER-1",
  controllerId: "CONTROLLER-TASK-1",
  governanceReadiness: readiness,
  sealedBootstrapHandoff: handoff,
  globalGovernanceAuthorityStore: globalFixture.authorityStore,
});

assert.throws(() => compilePermanentRoleCandidate({
  roleId: PERMANENT_ROLE_IDS[0], blockSetSha256: SHA("8"), independentEvaluationSha256: SHA("9"),
  stopConditions: "Reject incomplete permanent role governance before admission.",
  globalGovernanceContext: permanentRoleContext, globalGovernanceAuthorityStore: globalFixture.authorityStore,
}), /hostile fixture ids input is required/u);
assert.throws(() => compilePermanentRoleCandidate({
  roleId: "AGENTOS.UNKNOWN", blockSetSha256: SHA("8"), independentEvaluationSha256: SHA("9"),
  hostileFixtureIds: ["FIXTURE.PERMANENT.UNKNOWN"], stopConditions: "Reject incomplete permanent role governance before admission.",
  globalGovernanceContext: permanentRoleContext, globalGovernanceAuthorityStore: globalFixture.authorityStore,
}), /role is not canonical/u);
assert.throws(() => compilePermanentRoleRoster({spawnerAdmissionSha256: admission.admission_sha256, candidates: [null]}), /Permanent role candidate must be an object/u);
assert.throws(() => compilePermanentRoleRoster({spawnerAdmissionSha256: admission.admission_sha256, candidates: [], admittedRoleIds: null}), /admitted roles are required/u);

const candidates = PERMANENT_ROLE_IDS.map((roleId, index) => compilePermanentRoleCandidate({
  roleId,
  blockSetSha256: SHA(BLOCK_DIGEST_CHARS[index]),
  independentEvaluationSha256: SHA(EVALUATION_DIGEST_CHARS[index]),
  hostileFixtureIds: [`FIXTURE.PERMANENT.${roleId.split(".").at(-1)}.ADMISSION`, `FIXTURE.PERMANENT.${roleId.split(".").at(-1)}.QA`],
  stopConditions: "Reject incomplete permanent role governance before admission.",
  globalGovernanceContext: permanentRoleContext, globalGovernanceAuthorityStore: globalFixture.authorityStore,
}));

let roster = compilePermanentRoleRoster({spawnerAdmissionSha256: admission.admission_sha256, candidates});
assert.deepEqual(roster.admitted_role_ids, []);
assert.equal(roster.next_role_id, PERMANENT_ROLE_IDS[0]);
assert.equal(roster.status, "READY_FOR_NEXT_ROLE");
assert.equal(roster.next_action, "ADMIT_NEXT_PERMANENT_ROLE");
assert.equal(roster.next_handler, controllerActionHandlerFor("ADMIT_NEXT_PERMANENT_ROLE"));
assert.equal(roster.continuation_sha256, controllerContinuationDigest(roster.continuation));
assert.equal(roster.continuation.same_turn_dispatch, true);
assert.equal(roster.activation_state, "OFF");
assert.equal(roster.worker_spawned_count, 0);

for (let index = 0; index < PERMANENT_ROLE_IDS.length; index += 1) {
  roster = admitNextPermanentRole(roster, PERMANENT_ROLE_IDS[index], {globalGovernanceContext: permanentRoleContext, globalGovernanceAuthorityStore: globalFixture.authorityStore});
  assert.deepEqual(roster.admitted_role_ids, PERMANENT_ROLE_IDS.slice(0, index + 1));
  assert.equal(roster.worker_spawned_count, 0);
  assert.equal(roster.activation_state, "OFF");
  assert.equal(roster.next_role_id, index + 1 < PERMANENT_ROLE_IDS.length ? PERMANENT_ROLE_IDS[index + 1] : null);
  assert.equal(roster.next_action, index + 1 < PERMANENT_ROLE_IDS.length ? "ADMIT_NEXT_PERMANENT_ROLE" : "INJECT_ORCHESTRATOR_GOVERNANCE");
  assert.equal(roster.next_handler, controllerActionHandlerFor(roster.next_action));
  assert.equal(roster.continuation_sha256, controllerContinuationDigest(roster.continuation));
}
assert.equal(roster.status, "PERMANENT_ROSTER_READY");

const unknownSuccessorHandler = structuredClone(roster);
unknownSuccessorHandler.next_handler = "HANDLER.UNKNOWN";
redigest(unknownSuccessorHandler, "roster_sha256");
assert.throws(() => validatePermanentRoleRoster(unknownSuccessorHandler), /next handler is inconsistent/u);

const tamperedSuccessorContinuation = structuredClone(roster);
tamperedSuccessorContinuation.continuation.same_turn_dispatch = false;
redigest(tamperedSuccessorContinuation, "roster_sha256");
assert.throws(() => validatePermanentRoleRoster(tamperedSuccessorContinuation), /continuation is inconsistent|continuation digest mismatch/u);

const reordered = structuredClone(roster);
reordered.candidates.reverse();
redigest(reordered, "roster_sha256");
assert.throws(() => validatePermanentRoleRoster(reordered), /candidates must be canonical and ordered/u);

const duplicateController = structuredClone(roster);
duplicateController.candidates[1].role_id = PERMANENT_ROLE_IDS[0];
redigest(duplicateController.candidates[1], "candidate_sha256");
redigest(duplicateController, "roster_sha256");
assert.throws(() => validatePermanentRoleRoster(duplicateController), /role kind differs|candidates must be canonical and ordered/u);

const duplicateRoleSet = structuredClone(roster);
duplicateRoleSet.permanent_role_ids[1] = PERMANENT_ROLE_IDS[0];
redigest(duplicateRoleSet, "roster_sha256");
assert.throws(() => validatePermanentRoleRoster(duplicateRoleSet), /role set is incomplete or reordered/u);

assert.throws(() => compilePermanentRoleRoster({spawnerAdmissionSha256: admission.admission_sha256, candidates: candidates.slice(0, -1)}), /candidates are incomplete/u);
assert.throws(() => admitNextPermanentRole(compilePermanentRoleRoster({spawnerAdmissionSha256: admission.admission_sha256, candidates}), PERMANENT_ROLE_IDS[1], {globalGovernanceContext: permanentRoleContext, globalGovernanceAuthorityStore: globalFixture.authorityStore}), /typed next role/u);

const badQa = structuredClone(roster);
badQa.candidates[0].qa_status = "QA_PENDING";
redigest(badQa.candidates[0], "candidate_sha256");
redigest(badQa, "roster_sha256");
assert.throws(() => validatePermanentRoleRoster(badQa), /QA is incomplete/u);

const activationBypass = structuredClone(roster);
activationBypass.candidates[0].activation_state = "ON";
redigest(activationBypass.candidates[0], "candidate_sha256");
redigest(activationBypass, "roster_sha256");
assert.throws(() => validatePermanentRoleRoster(activationBypass), /activation must remain off/u);

const workerBypass = structuredClone(roster);
workerBypass.worker_spawned_count = 1;
redigest(workerBypass, "roster_sha256");
assert.throws(() => validatePermanentRoleRoster(workerBypass), /cannot spawn workers/u);

const staleAdmission = structuredClone(admission);
staleAdmission.block_set.independent_evaluation_sha256 = SHA("e");
redigest(staleAdmission.block_set, "block_set_sha256");
redigest(staleAdmission, "admission_sha256");
assert.throws(() => validatePermanentRoleRoster(roster, {spawnerAdmission: staleAdmission}), /not resolved from canonical reviewed artifacts|Spawner admission is stale/u);

fs.rmSync(governanceRoot, {recursive: true, force: true});
console.log("PASS permanent role roster: one-at-a-time canonical admission, canonical global-policy context, compiler-only boundaries, successor handoff, malformed-input rejection, stale custody, and hostile lifecycle checks");
