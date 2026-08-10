#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SAFETY_FLOOR,
  PROTECTED_ACTIONS,
  assertResumeCheckpoint,
  classifyFailure,
  compileDigestBoundCheckpoint,
  compileEvidenceRefs,
  compileGovernancePatchVersion,
  compileOwnerRepairApproval,
  compileRepairProposal,
  compileRepairReceipt,
  compileRepairScope,
  compileRootCauseAnalysis,
  compileSourceIdentity,
  admitRepairProposal,
  rejectRepairProposal,
  transitionRootCauseAnalysis,
  validateGovernancePatchVersion,
  verifyGovernancePatchVersion,
} from "../control/repair-governance.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  RESPAWN_LIFECYCLE,
  ROLLBACK_LIFECYCLE,
  admitRollbackPlan,
  compileRespawnPlan,
  compileRollbackPlan,
  runBoundedRespawn,
  runBoundedRollback,
} from "../control/repair-recovery.mjs";

const NOW = "2026-08-06T12:00:00.000Z";
const sha = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
const reference = (kind, character) => `${kind}:${character.repeat(64)}`;
const sourceBefore = compileSourceIdentity({commit: git("a"), tree: git("b"), checkpointSha256: sha("1"), clean: true, pushed: false});
const scope = compileRepairScope({scopeRef: "CONTROL_SCOPE_1", affectedPathsSha256: sha("2"), excludedScopeSha256: sha("3"), boundarySha256: sha("4")});
const evidenceRefs = compileEvidenceRefs([
  {evidence_ref: reference("evidence", "c"), evidence_sha256: sha("5"), kind: "CHECKPOINT"},
  {evidence_ref: reference("evidence", "b"), evidence_sha256: sha("6"), kind: "WORKER_RESULT"},
]);
const predecessorEvidence = {
  record_sha256: sha("7"),
  evidence_sha256: sha("8"),
  preserved: true,
  preserved_at_utc: NOW,
};
const puzzleClassification = classifyFailure({findingId: "FINDING_WORKER_1", stalled: true, observedAtUtc: NOW});
const rca = compileRootCauseAnalysis({
  findingId: "FINDING_WORKER_1",
  classification: puzzleClassification,
  phase: "LANE_EXECUTION",
  failure: {operation: "READ_RESULT", summary: "bounded worker result was not meaningful", output_sha256: sha("9")},
  sourceBefore,
  scope,
  evidenceRefs,
  predecessorEvidence,
  rootCause: {category: "WORKER_TIMEOUT", summary: "worker stopped before a typed result", factors_sha256: sha("a")},
  repairRoute: {route_kind: "BOUNDED_REPAIR", owner_role: "INTENT_REGULATOR", max_attempts: 1, retry_policy: "ONE_BOUNDED_ATTEMPT", owner_review_required: false},
  acceptanceConsequence: "The campaign remains unaccepted until an independent verification receipt exists.",
  recordedAtUtc: NOW,
});
const candidateCheckpoint = compileDigestBoundCheckpoint({checkpointId: "CANDIDATE_1", commit: git("c"), tree: git("d"), evidenceSha256: sha("b"), candidateSha256: sha("e")});
const restoreCheckpoint = compileDigestBoundCheckpoint({checkpointId: "RESTORE_1", commit: git("a"), tree: git("b"), evidenceSha256: sha("c"), candidateSha256: sha("d")});
const ownerRef = reference("actor", "1");
const auditorRef = reference("auditor", "2");

function expectThrow(callback, pattern) {
  assert.throws(callback, pattern);
}

for (const [flags, expectedClass, expectedAction] of [
  [{hardBoundary: true}, "HARD_BOUNDARY", "STOP_HARD_BOUNDARY"],
  [{scopeChanged: true}, "SOURCE_DRIFT", "REASSESS_GOAL"],
  [{missingIdentity: true}, "TRUE_BLOCKER", "REVIEW_TRUE_BLOCKER"],
  [{softBoundary: true}, "SOFT_BOUNDARY", "REVIEW_SOFT_BOUNDARY"],
  [{repairableFailure: true}, "REPAIRABLE_PUZZLE", "PROPOSE_REPAIR"],
  [{}, "NONE", "CONTINUE"],
]) {
  const result = classifyFailure({findingId: "FINDING_CLASSIFICATION", observedAtUtc: NOW, ...flags});
  assert.equal(result.classification, expectedClass);
  assert.equal(result.action, expectedAction);
  if (expectedClass === "HARD_BOUNDARY") assert.equal(result.continuation_allowed, false);
}
expectThrow(() => compileRepairProposal({
  proposalId: "UNSAFE_PROPOSAL",
  rca: compileRootCauseAnalysis({
    findingId: "FINDING_HARD_1",
    classification: classifyFailure({findingId: "FINDING_HARD_1", hardBoundary: true, observedAtUtc: NOW}),
    phase: "GOVERNANCE_GATE",
    failure: {operation: "PROTECTED_ACTION", summary: "protected action was attempted", output_sha256: sha("f")},
    sourceBefore,
    scope,
    evidenceRefs,
    predecessorEvidence,
    rootCause: {category: "HARD_BOUNDARY", summary: "owner-only action was attempted", factors_sha256: sha("0")},
    repairRoute: {route_kind: "OWNER_STOP", owner_role: "OWNER", max_attempts: 0, retry_policy: "NEVER_RETRY", owner_review_required: true},
    acceptanceConsequence: "The work stops for owner review.",
    recordedAtUtc: NOW,
  }),
  resumeCheckpoint: candidateCheckpoint,
  scope,
  smallestSafeChange: {kind: "NO_CHANGE", summary: "no change", change_sha256: sha("0"), authority_change: false, safety_floor_change: false, external_actions: false},
  verificationPlan: {focused_checks_sha256: sha("0"), independent_audit_required: true, expected_checkpoint_sha256: candidateCheckpoint.checkpoint_sha256, expected_safety_floor_sha256: canonicalDigest(DEFAULT_SAFETY_FLOOR)},
  limits: {max_attempts: 1, max_duration_minutes: 15, max_respawns: 0, cost_limit_ref: null},
  createdAtUtc: NOW,
}), /repairable puzzle/u);
const sharedConflict = classifyFailure({findingId: "FINDING_SHARED_FILE", sharedFileConflict: true, observedAtUtc: NOW});
assert.equal(sharedConflict.classification, "HARD_BOUNDARY");
assert.equal(sharedConflict.action, "STOP_HARD_BOUNDARY");
assert.equal(sharedConflict.shared_file_conflict, true);

const routed = transitionRootCauseAnalysis(rca, {status: "ROUTED", reason: "bounded repair route selected", recordedAtUtc: NOW});
const repairing = transitionRootCauseAnalysis(routed, {status: "REPAIRING", reason: "owner-approved repair is being prepared", recordedAtUtc: NOW});
const repaired = transitionRootCauseAnalysis(repairing, {status: "REPAIRED", reason: "focused checks passed", recordedAtUtc: NOW});
const closed = transitionRootCauseAnalysis(repaired, {status: "CLOSED", reason: "receipt archived without activation", recordedAtUtc: NOW});
assert.equal(closed.parent_rca_sha256, repaired.rca_sha256);
expectThrow(() => transitionRootCauseAnalysis(rca, {status: "REPAIRED", reason: "invalid skip", recordedAtUtc: NOW}), /cannot transition/u);

const proposal = compileRepairProposal({
  proposalId: "REPAIR_PROPOSAL_1",
  rca,
  resumeCheckpoint: candidateCheckpoint,
  scope,
  smallestSafeChange: {kind: "REPAIR_RECORD_ONLY", summary: "repair the bounded governance record path", change_sha256: sha("1"), authority_change: false, safety_floor_change: false, external_actions: false},
  verificationPlan: {focused_checks_sha256: sha("2"), independent_audit_required: true, expected_checkpoint_sha256: candidateCheckpoint.checkpoint_sha256, expected_safety_floor_sha256: canonicalDigest(DEFAULT_SAFETY_FLOOR)},
  limits: {max_attempts: 1, max_duration_minutes: 15, max_respawns: 1, cost_limit_ref: null},
  createdAtUtc: NOW,
});
const rejectedProposal = rejectRepairProposal(proposal, "owner declined the proposed repair", NOW);
assert.equal(rejectedProposal.status, "REJECTED");
expectThrow(() => admitRepairProposal(rejectedProposal, compileOwnerRepairApproval({decisionId: "REJECTED_APPROVAL", decision: "APPROVE_REPAIR", actorRef: ownerRef, parentDigest: rejectedProposal.proposal_sha256, decidedAtUtc: NOW}), NOW), /awaiting admission/u);
expectThrow(() => admitRepairProposal(proposal, compileOwnerRepairApproval({decisionId: "WRONG_PARENT", decision: "APPROVE_REPAIR", actorRef: ownerRef, parentDigest: sha("f"), decidedAtUtc: NOW}), NOW), /not bound/u);
const repairApproval = compileOwnerRepairApproval({decisionId: "REPAIR_APPROVAL_1", decision: "APPROVE_REPAIR", actorRef: ownerRef, parentDigest: proposal.proposal_sha256, decidedAtUtc: NOW});
const admittedProposal = admitRepairProposal(proposal, repairApproval, NOW);
const patch = compileGovernancePatchVersion({
  governanceVersion: "v3.0.0-tb-01",
  testBuild: "tb-01",
  proposal: admittedProposal,
  candidateCheckpoint,
  changedScopeSha256: canonicalDigest(admittedProposal.scope),
  normativeDigest: sha("3"),
  recordedAtUtc: NOW,
});
expectThrow(() => verifyGovernancePatchVersion(patch, {focusedChecksSha256: sha("4"), auditorRef: ownerRef, evidenceSha256: sha("5"), verifiedAtUtc: NOW}), /independent Auditor/u);
const verifiedPatch = verifyGovernancePatchVersion(patch, {focusedChecksSha256: sha("4"), auditorRef, evidenceSha256: sha("5"), verifiedAtUtc: NOW});
assert.equal(verifiedPatch.activation, false);
expectThrow(() => {
  const activated = structuredClone(verifiedPatch);
  activated.activation = true;
  activated.patch_version_sha256 = canonicalDigest({...activated, patch_version_sha256: null});
  return validateGovernancePatchVersion(activated);
}, /may not activate/u);
const repairReceipt = compileRepairReceipt({proposal: admittedProposal, patchVersion: verifiedPatch, observedAtUtc: NOW});
assert.equal(repairReceipt.status, "VERIFIED_NOT_ACTIVATED");
assert.deepEqual(repairReceipt.protected_actions, PROTECTED_ACTIONS);

const predecessor = {
  worker_ref: reference("worker", "3"),
  session_ref: reference("session", "4"),
  status: "STALLED",
  source_commit: sourceBefore.commit,
  source_tree: sourceBefore.tree,
  evidence_sha256: predecessorEvidence.evidence_sha256,
  handoff_sha256: sha("6"),
};
const respawnPlan = compileRespawnPlan({planId: "RESPAWN_PLAN_1", repairReceipt, predecessor, createdAtUtc: NOW, maxAttempts: 1});
const respawnCalls = [];
const replacement = {worker_ref: reference("worker", "7"), session_ref: reference("session", "8"), source_commit: candidateCheckpoint.source_commit, source_tree: candidateCheckpoint.source_tree, checkpoint_sha256: candidateCheckpoint.checkpoint_sha256};
const respawnAdapter = {
  async createReplacement() { respawnCalls.push("CREATE_DISTINCT_REPLACEMENT"); return {created: true, ...replacement}; },
  async sendPredecessorHandoff() { respawnCalls.push("SEND_PREDECESSOR_HANDOFF"); return {accepted: true, predecessor_handoff_sha256: predecessor.handoff_sha256}; },
  async readMeaningfulResult() { respawnCalls.push("READ_MEANINGFUL_RESULT"); return {meaningful: true, result_sha256: sha("7"), evidence_sha256: sha("8"), typed_handoff_sha256: sha("9"), source_commit: replacement.source_commit, source_tree: replacement.source_tree, checkpoint_sha256: replacement.checkpoint_sha256}; },
  async closePredecessor() { respawnCalls.push("CLOSE_PREDECESSOR"); return {closed: true, predecessor_handoff_sha256: predecessor.handoff_sha256}; },
  async verifyActiveRoster() { respawnCalls.push("VERIFY_ACTIVE_ROSTER"); return {predecessor_absent: true, replacement_present: true, roster_sha256: sha("a")}; },
};
const respawned = await runBoundedRespawn({plan: respawnPlan, adapter: respawnAdapter, observedAtUtc: NOW});
assert.equal(respawned.status, "RESPAWNED_AND_BOUND");
assert.deepEqual(respawnCalls, RESPAWN_LIFECYCLE.slice(1));
assert.deepEqual(respawned.completed_lifecycle, [...RESPAWN_LIFECYCLE]);
assert.equal(respawned.predecessor_evidence_preserved, true);

const blockedCalls = [];
const blockedRespawn = await runBoundedRespawn({
  plan: respawnPlan,
  adapter: {
    async createReplacement() { blockedCalls.push("CREATE_DISTINCT_REPLACEMENT"); return {created: true, ...replacement}; },
    async sendPredecessorHandoff() { blockedCalls.push("SEND_PREDECESSOR_HANDOFF"); return {accepted: true, predecessor_handoff_sha256: predecessor.handoff_sha256}; },
    async readMeaningfulResult() { blockedCalls.push("READ_MEANINGFUL_RESULT"); return {meaningful: false, result_sha256: sha("1"), evidence_sha256: sha("2"), typed_handoff_sha256: sha("3"), source_commit: replacement.source_commit, source_tree: replacement.source_tree, checkpoint_sha256: replacement.checkpoint_sha256}; },
    async closePredecessor() { throw new Error("must not close after blocked result"); },
    async verifyActiveRoster() { throw new Error("must not verify after blocked result"); },
    async abortReplacement() { blockedCalls.push("ABORT_REPLACEMENT"); },
  },
  observedAtUtc: NOW,
});
assert.equal(blockedRespawn.status, "RESPAWN_BLOCKED");
assert.equal(blockedRespawn.failure.phase, "READ_MEANINGFUL_RESULT");
assert.deepEqual(blockedRespawn.completed_lifecycle, RESPAWN_LIFECYCLE.slice(0, 3));
assert.equal(blockedRespawn.predecessor_evidence_preserved, true);
assert.deepEqual(blockedCalls, ["CREATE_DISTINCT_REPLACEMENT", "SEND_PREDECESSOR_HANDOFF", "READ_MEANINGFUL_RESULT", "ABORT_REPLACEMENT"]);
expectThrow(() => {
  const noRespawnReceipt = structuredClone(repairReceipt);
  noRespawnReceipt.limits.max_respawns = 1;
  noRespawnReceipt.receipt_sha256 = canonicalDigest({...noRespawnReceipt, receipt_sha256: null});
  return compileRespawnPlan({planId: "RESPAWN_TOO_MANY", repairReceipt: noRespawnReceipt, predecessor, createdAtUtc: NOW, maxAttempts: 2});
}, /one bounded replacement attempt/u);
expectThrow(() => {
  const noRespawnReceipt = structuredClone(repairReceipt);
  noRespawnReceipt.limits.max_respawns = 0;
  noRespawnReceipt.receipt_sha256 = canonicalDigest({...noRespawnReceipt, receipt_sha256: null});
  return compileRespawnPlan({planId: "RESPAWN_NOT_ALLOWED", repairReceipt: noRespawnReceipt, predecessor, createdAtUtc: NOW, maxAttempts: 1});
}, /does not permit a respawn/u);
const rollbackPlan = compileRollbackPlan({rollbackId: "ROLLBACK_PLAN_1", repairReceipt, restoreCheckpoint, reason: "candidate requires owner-approved restoration", createdAtUtc: NOW});
await assert.rejects(runBoundedRollback({plan: rollbackPlan, executor: {}, observedAtUtc: NOW}), /owner admission/u);
const rollbackApproval = compileOwnerRepairApproval({decisionId: "ROLLBACK_APPROVAL_1", decision: "APPROVE_ROLLBACK", actorRef: reference("actor", "5"), parentDigest: rollbackPlan.plan_sha256, decidedAtUtc: NOW});
const admittedRollback = admitRollbackPlan(rollbackPlan, rollbackApproval);
const rollbackExecutor = {
  async prepareRollback() { return {ready: true, from_checkpoint_sha256: candidateCheckpoint.checkpoint_sha256, to_checkpoint_sha256: restoreCheckpoint.checkpoint_sha256}; },
  async restoreCheckpoint() { return {restored: true, checkpoint_sha256: restoreCheckpoint.checkpoint_sha256, source_commit: restoreCheckpoint.source_commit, source_tree: restoreCheckpoint.source_tree}; },
  async readbackCheckpoint() { return {restored: true, checkpoint_sha256: restoreCheckpoint.checkpoint_sha256, source_commit: restoreCheckpoint.source_commit, source_tree: restoreCheckpoint.source_tree}; },
  async independentAudit() { return {passed: true, auditor_ref: reference("auditor", "6"), evidence_sha256: sha("b")}; },
};
const rolledBack = await runBoundedRollback({plan: admittedRollback, executor: rollbackExecutor, observedAtUtc: NOW});
assert.equal(rolledBack.status, "ROLLED_BACK_AND_VERIFIED");
assert.equal(rolledBack.candidate_evidence_preserved, true);
assert.equal(rolledBack.previous_candidate_retained, false);
assert.deepEqual(rolledBack.completed_lifecycle, [...ROLLBACK_LIFECYCLE]);
const retainedFailure = await runBoundedRollback({
  plan: admittedRollback,
  executor: {
    async prepareRollback() { return {ready: false, from_checkpoint_sha256: candidateCheckpoint.checkpoint_sha256, to_checkpoint_sha256: restoreCheckpoint.checkpoint_sha256}; },
    async restoreCheckpoint() { throw new Error("must not restore when preparation fails"); },
    async readbackCheckpoint() { throw new Error("must not read back when preparation fails"); },
    async independentAudit() { throw new Error("must not audit when preparation fails"); },
  },
  observedAtUtc: NOW,
});
assert.equal(retainedFailure.status, "ROLLBACK_FAILED_RETAINED");
assert.equal(retainedFailure.previous_candidate_retained, true);
assert.deepEqual(retainedFailure.completed_lifecycle, ROLLBACK_LIFECYCLE.slice(0, 1));
const uncertainFailure = await runBoundedRollback({
  plan: admittedRollback,
  executor: {
    async prepareRollback() { return {ready: true, from_checkpoint_sha256: candidateCheckpoint.checkpoint_sha256, to_checkpoint_sha256: restoreCheckpoint.checkpoint_sha256}; },
    async restoreCheckpoint() { throw new Error("restore state cannot be proven"); },
    async readbackCheckpoint() { throw new Error("must not read back after restore failure"); },
    async independentAudit() { throw new Error("must not audit after restore failure"); },
  },
  observedAtUtc: NOW,
});
assert.equal(uncertainFailure.status, "ROLLBACK_STATE_UNCERTAIN");
assert.equal(uncertainFailure.previous_candidate_retained, false);
assert.deepEqual(uncertainFailure.completed_lifecycle, ROLLBACK_LIFECYCLE.slice(0, 2));

expectThrow(() => {
  const unsafe = structuredClone(admittedProposal);
  unsafe.smallest_safe_change.authority_change = true;
  unsafe.proposal_sha256 = canonicalDigest({...unsafe, proposal_sha256: null});
  return compileGovernancePatchVersion({governanceVersion: "v3.0.0-tb-02", testBuild: "tb-02", proposal: unsafe, candidateCheckpoint, changedScopeSha256: canonicalDigest(unsafe.scope), normativeDigest: sha("d"), recordedAtUtc: NOW});
}, /protected boundary|authority_change|digest/u);
expectThrow(() => {
  const drifted = structuredClone(candidateCheckpoint);
  drifted.candidate_sha256 = sha("f");
  drifted.checkpoint_sha256 = canonicalDigest({...drifted, checkpoint_sha256: null});
  return assertResumeCheckpoint(candidateCheckpoint, drifted);
}, /differs|candidate/u);

const schemaFiles = [
  "failure-classification.v1.json",
  "digest-bound-checkpoint.v1.json",
  "owner-repair-approval.v1.json",
  "root-cause-analysis.v1.json",
  "repair-proposal.v1.json",
  "governance-patch-version.v1.json",
  "repair-receipt.v1.json",
  "repair-respawn.v1.json",
  "repair-rollback.v1.json",
];
const schemaRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../schemas");
for (const file of schemaFiles) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemaRoot, file), "utf8"));
  assert.match(schema.$id, /^agentos\./u);
}

console.log(JSON.stringify({
  status: "PASS",
  classifications: 6,
  rca_transitions: 4,
  repair_receipt: repairReceipt.status,
  respawn: {success: respawned.status, blocked: blockedRespawn.status},
  rollback: {success: rolledBack.status, retained: retainedFailure.status, uncertain: uncertainFailure.status},
  schema_count: schemaFiles.length,
}));
