#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  allocateTestBuild,
  applyOwnerDecision,
  buildReleaseArtifactManifest,
  compileOwnerDecision,
  compileReleaseCandidate,
  compileReleasePromotionReceipt,
  compileReleasePromotionRequest,
  compileRejectionFeedback,
  compileVersionAllocationLedger,
  parseReleaseVersion,
  parseTestBuildTag,
  transitionReleaseCandidate,
  validateArtifactManifest,
  validatePromotionRequest,
  validateRejectionFeedback,
  validateReleaseCandidate,
  validateVersionAllocationLedger,
  verifyArtifactIdentity,
} from "../control/release-lifecycle.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileCompatibilityEvidence, compileMigrationPlan, requireCompatibilityPass} from "../control/release-compatibility.mjs";
import {compilePolicyReplay} from "../control/release-policy-replay.mjs";
import {compileReleaseModelCheck} from "../control/release-model-check.mjs";
import {compileReleaseSafetyGate} from "../control/release-safety-gate.mjs";

// Keep the fixture tree disposable and synthetic. No fixture value is a
// persisted host path or an external identity.
const now = "2026-08-06T00:00:00.000Z";
const sourceIdentity = {commit_sha256: "a".repeat(64), tree_sha256: "b".repeat(64)};
const normativeSnapshot = "c".repeat(64);
const auditDigest = "d".repeat(64);
const actorDigest = "e".repeat(64);

assert.equal(parseReleaseVersion("3.0.0-rc.1").release_channel, "RELEASE_CANDIDATE");
assert.equal(parseTestBuildTag("v3.0.0-rc.1-tb-01").test_build_number, 1);
assert.throws(() => parseReleaseVersion("3.0.0-rc.0"), /strict SemVer/u);
assert.throws(() => parseReleaseVersion("3.0.0-rc.01"), /strict SemVer/u);
assert.throws(() => parseReleaseVersion("banana"), /strict SemVer/u);
assert.throws(() => parseTestBuildTag("v3.0.0-rc.1-tb-00"), /canonical/u);
assert.throws(() => parseTestBuildTag("v3.0.0-rc.1-tb-1"), /canonical/u);

let ledger = compileVersionAllocationLedger({releaseVersion: "3.0.0-rc.1"});
const firstAllocation = allocateTestBuild({
  ledger,
  source: sourceIdentity,
  normativeSnapshotSha256: normativeSnapshot,
  allocatedAtUtc: now,
});
ledger = firstAllocation.ledger;
assert.equal(firstAllocation.allocation.test_build_tag, "v3.0.0-rc.1-tb-01");
assert.equal(firstAllocation.allocation.campaign_version, firstAllocation.allocation.test_build_tag);
const secondAllocation = allocateTestBuild({
  ledger,
  source: sourceIdentity,
  normativeSnapshotSha256: normativeSnapshot,
  predecessorCandidateSha256: "f".repeat(64),
  allocatedAtUtc: now,
});
ledger = secondAllocation.ledger;
assert.equal(secondAllocation.allocation.test_build_number, 2);
assert.equal(ledger.next_test_build_number, 3);
validateVersionAllocationLedger(ledger);
assert.throws(() => compileVersionAllocationLedger({
  releaseVersion: "3.0.0-rc.1",
  allocations: [secondAllocation.allocation],
}), /retain every consumed number/u);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-release-lifecycle-"));
const sourceRoot = path.join(fixtureRoot, "source");
const sterileRoot = path.join(fixtureRoot, "sterile");
fs.mkdirSync(path.join(sourceRoot, "src"), {recursive: true});
fs.mkdirSync(sterileRoot, {recursive: true});
fs.writeFileSync(path.join(sourceRoot, "README.md"), "synthetic release fixture\n");
fs.writeFileSync(path.join(sourceRoot, "src", "main.mjs"), "export const release = true;\n");
fs.cpSync(sourceRoot, sterileRoot, {recursive: true});

const sourceManifest = buildReleaseArtifactManifest({
  rootPath: sourceRoot,
  rootBinding: "ACTIVE_DEVELOPMENT_RELEASE_ROOT",
  releaseVersion: "3.0.0-rc.1",
  testBuildTag: "v3.0.0-rc.1-tb-01",
  source: sourceIdentity,
});
const sterileManifest = buildReleaseArtifactManifest({
  rootPath: sterileRoot,
  rootBinding: "STABLE_RELEASE_ROOT",
  releaseVersion: "3.0.0-rc.1",
  testBuildTag: "v3.0.0-rc.1-tb-01",
  source: sourceIdentity,
});
const exactIdentity = verifyArtifactIdentity({expectedManifest: sourceManifest, actualManifest: sterileManifest});
assert.equal(exactIdentity.status, "VERIFIED_EXACT");
assert.equal(sourceManifest.artifact_sha256, sterileManifest.artifact_sha256);
assert.equal(sourceManifest.manifest_sha256, sterileManifest.manifest_sha256);
assert(!JSON.stringify(sourceManifest).includes(sourceRoot), "manifest persisted a host path");
const unsafeManifest = structuredClone(sourceManifest);
unsafeManifest.files[0].path = "../escape";
assert.throws(() => validateArtifactManifest(unsafeManifest), /unsafe segment/u);

fs.writeFileSync(path.join(sterileRoot, "src", "main.mjs"), "export const release = false;\n");
const changedSterileManifest = buildReleaseArtifactManifest({
  rootPath: sterileRoot,
  rootBinding: "STABLE_RELEASE_ROOT",
  releaseVersion: "3.0.0-rc.1",
  testBuildTag: "v3.0.0-rc.1-tb-01",
  source: sourceIdentity,
});
assert.throws(() => verifyArtifactIdentity({expectedManifest: sourceManifest, actualManifest: changedSterileManifest}), /artifact bytes differ|artifact manifest differs/u);
fs.cpSync(sourceRoot, sterileRoot, {recursive: true});

const symlinkRoot = path.join(fixtureRoot, "symlink");
fs.mkdirSync(symlinkRoot);
fs.writeFileSync(path.join(symlinkRoot, "real.txt"), "real\n");
fs.symlinkSync(path.join(sourceRoot, "README.md"), path.join(symlinkRoot, "linked.txt"));
assert.throws(() => buildReleaseArtifactManifest({
  rootPath: symlinkRoot,
  rootBinding: "STERILE_RELEASE_ROOT",
  releaseVersion: "3.0.0-rc.1",
  testBuildTag: "v3.0.0-rc.1-tb-01",
  source: sourceIdentity,
}), /symbolic link/u);

const privateRoot = path.join(fixtureRoot, "private-file");
fs.mkdirSync(privateRoot);
fs.writeFileSync(path.join(privateRoot, ".env"), "TOKEN=must-not-enter-release\n");
assert.throws(() => buildReleaseArtifactManifest({
  rootPath: privateRoot,
  rootBinding: "ACTIVE_DEVELOPMENT_RELEASE_ROOT",
  releaseVersion: "3.0.0-rc.1",
  testBuildTag: "v3.0.0-rc.1-tb-01",
  source: sourceIdentity,
}), /private or secret-like/u);

const privateContentRoot = path.join(fixtureRoot, "private-content");
fs.mkdirSync(privateContentRoot);
fs.writeFileSync(path.join(privateContentRoot, "safe.txt"), "TOKEN=must-not-enter-release\n");
assert.throws(() => buildReleaseArtifactManifest({
  rootPath: privateContentRoot,
  rootBinding: "ACTIVE_DEVELOPMENT_RELEASE_ROOT",
  releaseVersion: "3.0.0-rc.1",
  testBuildTag: "v3.0.0-rc.1-tb-01",
  source: sourceIdentity,
}), /ENVIRONMENT_VALUE|SECRET_LIKE_VALUE/u);

const assembled = compileReleaseCandidate({
  candidateId: "RC-3.0.0-rc.1-TB-01",
  manifest: sourceManifest,
  normativeSnapshotSha256: normativeSnapshot,
});
const sterileVerified = transitionReleaseCandidate(assembled, {nextState: "STERILE_VERIFIED"});
const reviewPending = transitionReleaseCandidate(sterileVerified, {
  nextState: "OWNER_REVIEW_PENDING",
  independentAuditSha256: auditDigest,
});
validateReleaseCandidate(reviewPending);

const rejectionFeedback = compileRejectionFeedback({
  feedbackId: "FEEDBACK-RC-001",
  candidate: reviewPending,
  classification: "TEST_FAILURE",
  summary: "The independent release check found a required verification gap.",
  requiredChangeIds: ["RELEASE_VERIFICATION"],
  route: "NEW_TEST_BUILD",
  createdAtUtc: now,
});
const rejectedDecision = compileOwnerDecision({
  decisionId: "DECISION-RC-001",
  candidate: reviewPending,
  decision: "REJECT",
  actorDigestSha256: actorDigest,
  decidedAtUtc: now,
  feedback: rejectionFeedback,
});
const rejectedCandidate = applyOwnerDecision({candidate: reviewPending, decision: rejectedDecision});
assert.equal(rejectedCandidate.candidate_state, "OWNER_REJECTED");
assert.equal(rejectedCandidate.activation, false);
assert.throws(() => compileReleasePromotionRequest({
  requestId: "PROMOTION-RC-REJECTED",
  candidate: rejectedCandidate,
  ownerDecision: rejectedDecision,
  targetBinding: "STABLE_RELEASE_ROOT",
  requestedAtUtc: now,
}), /owner-accepted candidate/u);

const approvalDecision = compileOwnerDecision({
  decisionId: "DECISION-RC-002",
  candidate: reviewPending,
  decision: "APPROVE",
  actorDigestSha256: actorDigest,
  decidedAtUtc: now,
});
const approvedCandidate = applyOwnerDecision({candidate: reviewPending, decision: approvalDecision});

const safetyHash = (character) => character.repeat(64);
const safetyMigration = compileMigrationPlan({
  migrationId: "MIGRATION-3-4",
  sourceSchemaVersion: "STATE-3",
  targetSchemaVersion: "STATE-4",
  backfillStrategy: "BATCHED",
  cutoverStrategy: "DUAL_READ",
  reconciliationStrategy: "REPLAY_AND_COMPARE",
  irreversiblePoint: "AT_CUTOVER",
  rollbackStrategy: "RESTORE_CHECKPOINT",
  migrationJournalStatus: "INTENTIONALLY_JOURNALLESS",
  migrationSourceSha256: safetyHash("a"),
  loadBearingFingerprints: [
    {object_kind: "FUNCTION_BODY", object_id: "public.calculate_total.body", fingerprint_sha256: safetyHash("2")},
    {object_kind: "FUNCTION_SIGNATURE", object_id: "public.calculate_total.signature", fingerprint_sha256: safetyHash("3")},
    {object_kind: "GRANT", object_id: "public.orders.read", fingerprint_sha256: safetyHash("4")},
    {object_kind: "INDEX", object_id: "public.orders.by_owner", fingerprint_sha256: safetyHash("5")},
    {object_kind: "POLICY", object_id: "public.orders.owner_access", fingerprint_sha256: safetyHash("6")},
    {object_kind: "REVOKE", object_id: "public.orders.public_write", fingerprint_sha256: safetyHash("7")},
    {object_kind: "RLS_POSTURE", object_id: "public.orders", fingerprint_sha256: safetyHash("8")},
    {object_kind: "SCHEMA_OBJECT", object_id: "public.orders", fingerprint_sha256: safetyHash("9")},
    {object_kind: "TRIGGER", object_id: "public.orders.audit", fingerprint_sha256: safetyHash("b")},
  ],
  steps: [
    {step_id: "STEP-BACKFILL", phase: "BACKFILL", order: 1, reversible: true, required: true, evidence_sha256: safetyHash("d")},
    {step_id: "STEP-CUTOVER", phase: "CUTOVER", order: 2, reversible: false, required: true, evidence_sha256: safetyHash("e")},
    {step_id: "STEP-RECONCILE", phase: "RECONCILIATION", order: 3, reversible: true, required: true, evidence_sha256: safetyHash("f")},
    {step_id: "STEP-ROLLBACK", phase: "ROLLBACK", order: 4, reversible: true, required: true, evidence_sha256: safetyHash("1")},
  ],
});
const safetyCases = [
  {case_id: "CASE-OLD", scenario: "OLD_STATE", source_state_sha256: safetyHash("3"), target_state_sha256: null, observed_state_sha256: null, rollback_state_sha256: null, result: "PASS", evidence_sha256: safetyHash("4")},
  {case_id: "CASE-NEW", scenario: "NEW_STATE", source_state_sha256: null, target_state_sha256: safetyHash("5"), observed_state_sha256: null, rollback_state_sha256: null, result: "PASS", evidence_sha256: safetyHash("6")},
  {case_id: "CASE-MIXED", scenario: "MIXED_VERSION", source_state_sha256: safetyHash("3"), target_state_sha256: safetyHash("5"), observed_state_sha256: null, rollback_state_sha256: null, result: "PASS", evidence_sha256: safetyHash("7")},
  {case_id: "CASE-FAILED", scenario: "FAILED_MIGRATION", source_state_sha256: null, target_state_sha256: null, observed_state_sha256: safetyHash("8"), rollback_state_sha256: safetyHash("9"), result: "PASS", evidence_sha256: safetyHash("a")},
  {case_id: "CASE-INTERRUPTED", scenario: "INTERRUPTED_CUTOVER", source_state_sha256: null, target_state_sha256: null, observed_state_sha256: safetyHash("b"), rollback_state_sha256: safetyHash("c"), result: "PASS", evidence_sha256: safetyHash("d")},
  {case_id: "CASE-RECONCILE", scenario: "RECONCILIATION", source_state_sha256: null, target_state_sha256: null, observed_state_sha256: safetyHash("e"), rollback_state_sha256: null, result: "PASS", evidence_sha256: safetyHash("f")},
  {case_id: "CASE-ROLLBACK", scenario: "ROLLBACK", source_state_sha256: null, target_state_sha256: null, observed_state_sha256: null, rollback_state_sha256: safetyHash("1"), result: "PASS", evidence_sha256: safetyHash("0")},
];
const safetyCompatibility = compileCompatibilityEvidence({
  subjectCandidateSha256: safetyHash("2"),
  releaseVersion: approvedCandidate.release_version,
  migrationPlan: safetyMigration,
  independentCheckerSha256: safetyHash("c"),
  checkedAtUtc: now,
  cases: safetyCases,
});
requireCompatibilityPass(safetyCompatibility, {migrationPlan: safetyMigration});
const safetyPolicyReplay = compilePolicyReplay({
  subjectCandidateSha256: safetyHash("2"),
  beforePolicySha256: safetyHash("2"),
  afterPolicySha256: safetyHash("3"),
  independentCheckerSha256: safetyHash("c"),
  replayedAtUtc: now,
  cases: [
    {case_id: "POLICY-001", input_sha256: safetyHash("4"), before_decision_sha256: safetyHash("5"), after_decision_sha256: safetyHash("6"), before_authority_sha256: safetyHash("7"), after_authority_sha256: safetyHash("8"), decision_changed: true, authority_changed: true, result: "PASS", evidence_sha256: safetyHash("9")},
    {case_id: "POLICY-002", input_sha256: safetyHash("a"), before_decision_sha256: safetyHash("b"), after_decision_sha256: safetyHash("b"), before_authority_sha256: safetyHash("c"), after_authority_sha256: safetyHash("c"), decision_changed: false, authority_changed: false, result: "PASS", evidence_sha256: safetyHash("d")},
  ],
});
const modelStates = [
  {state_id: "ASSEMBLED", terminal: false, owner_controlled: false, requires_recovery: false, activation: false},
  {state_id: "BLOCKED", terminal: true, owner_controlled: false, requires_recovery: false, activation: false},
  {state_id: "INTERRUPTED", terminal: false, owner_controlled: false, requires_recovery: true, activation: false},
  {state_id: "OWNER_ACCEPTED", terminal: false, owner_controlled: true, requires_recovery: false, activation: false},
  {state_id: "OWNER_REVIEW_PENDING", terminal: false, owner_controlled: false, requires_recovery: false, activation: false},
  {state_id: "PROMOTED_PREPARED", terminal: true, owner_controlled: false, requires_recovery: false, activation: false},
  {state_id: "STERILE_VERIFIED", terminal: false, owner_controlled: false, requires_recovery: false, activation: false},
];
const modelEdge = (transition_id, from_state_id, to_state_id, action, requires_owner = false, protected_action = false) => ({transition_id, from_state_id, to_state_id, action, requires_owner, protected_action, evidence_sha256: safetyHash(transition_id.slice(-1))});
const modelTransitions = [
  modelEdge("T-01", "ASSEMBLED", "BLOCKED", "BLOCK"),
  modelEdge("T-02", "ASSEMBLED", "STERILE_VERIFIED", "VERIFY"),
  modelEdge("T-03", "STERILE_VERIFIED", "BLOCKED", "BLOCK"),
  modelEdge("T-04", "STERILE_VERIFIED", "INTERRUPTED", "INTERRUPT"),
  modelEdge("T-05", "STERILE_VERIFIED", "OWNER_REVIEW_PENDING", "AUDIT"),
  modelEdge("T-06", "INTERRUPTED", "OWNER_REVIEW_PENDING", "ROLLBACK", true, true),
  modelEdge("T-07", "OWNER_REVIEW_PENDING", "BLOCKED", "OWNER_REJECT", true, true),
  modelEdge("T-08", "OWNER_REVIEW_PENDING", "OWNER_ACCEPTED", "OWNER_APPROVE", true, true),
  modelEdge("T-09", "OWNER_ACCEPTED", "BLOCKED", "OWNER_HOLD", true, true),
  modelEdge("T-10", "OWNER_ACCEPTED", "PROMOTED_PREPARED", "PREPARE_PROMOTION", true, true),
];
const safetyModelCheck = compileReleaseModelCheck({subjectCandidateSha256: safetyHash("2"), initialStateId: "ASSEMBLED", states: modelStates, transitions: modelTransitions, independentCheckerSha256: safetyHash("c"), checkedAtUtc: now});
const safetyGate = compileReleaseSafetyGate({subjectCandidateSha256: safetyHash("2"), releaseVersion: approvedCandidate.release_version, compatibility: safetyCompatibility, policyReplay: safetyPolicyReplay, modelCheck: safetyModelCheck, independentCheckerSha256: safetyHash("c"), checkedAtUtc: now});
const safetyEvidence = {gate: safetyGate, compatibility: safetyCompatibility, policyReplay: safetyPolicyReplay, modelCheck: safetyModelCheck};
const safetySubject = sterileVerified.candidate_sha256;
const boundSafety = {
  gate: {...safetyGate, subject_candidate_sha256: safetySubject, safety_sha256: null},
  compatibility: {...safetyCompatibility, subject_candidate_sha256: safetySubject, compatibility_sha256: null},
  policyReplay: {...safetyPolicyReplay, subject_candidate_sha256: safetySubject, replay_sha256: null},
  modelCheck: {...safetyModelCheck, subject_candidate_sha256: safetySubject, model_sha256: null},
};
boundSafety.compatibility.compatibility_sha256 = canonicalDigest({...boundSafety.compatibility, compatibility_sha256: null});
boundSafety.policyReplay.replay_sha256 = canonicalDigest({...boundSafety.policyReplay, replay_sha256: null});
boundSafety.modelCheck.model_sha256 = canonicalDigest({...boundSafety.modelCheck, model_sha256: null});
boundSafety.gate.compatibility_evidence_sha256 = boundSafety.compatibility.compatibility_sha256;
boundSafety.gate.policy_replay_sha256 = boundSafety.policyReplay.replay_sha256;
boundSafety.gate.model_check_sha256 = boundSafety.modelCheck.model_sha256;
boundSafety.gate.safety_sha256 = canonicalDigest({...boundSafety.gate, safety_sha256: null});
const safetyBoundEvidence = boundSafety;
const safetyBoundCandidate = transitionReleaseCandidate(sterileVerified, {nextState: "OWNER_REVIEW_PENDING", independentAuditSha256: auditDigest, safetyEvidenceSha256: safetyBoundEvidence.gate.safety_sha256, safetySubjectSha256: safetySubject});
const safetyBoundDecision = compileOwnerDecision({decisionId: "DECISION-RC-003", candidate: safetyBoundCandidate, decision: "APPROVE", actorDigestSha256: actorDigest, decidedAtUtc: now});
const safetyApprovedCandidate = applyOwnerDecision({candidate: safetyBoundCandidate, decision: safetyBoundDecision});
const currentRelease = {
  release_version: "2.9.0",
  artifact_sha256: "1".repeat(64),
  manifest_sha256: "2".repeat(64),
};
const promotionRequest = compileReleasePromotionRequest({
  requestId: "PROMOTION-RC-001",
  candidate: safetyApprovedCandidate,
  ownerDecision: safetyBoundDecision,
  safetyEvidence: safetyBoundEvidence,
  targetReleaseVersion: "3.0.0",
  targetBinding: "STABLE_RELEASE_ROOT",
  currentRelease,
  requestedAtUtc: now,
});
validatePromotionRequest(promotionRequest, {candidate: safetyApprovedCandidate, ownerDecision: safetyBoundDecision, safetyEvidence: safetyBoundEvidence});
assert.throws(() => compileReleasePromotionRequest({
  requestId: "PROMOTION-RC-WRONG-TARGET",
  candidate: safetyApprovedCandidate,
  ownerDecision: safetyBoundDecision,
  safetyEvidence: safetyBoundEvidence,
  targetReleaseVersion: "3.0.1",
  targetBinding: "STABLE_RELEASE_ROOT",
  requestedAtUtc: now,
}), /match the candidate core version/u);

const staleCandidate = {
  ...approvedCandidate,
  artifact_sha256: "3".repeat(64),
  candidate_sha256: null,
};
staleCandidate.candidate_sha256 = canonicalDigest({...staleCandidate, candidate_sha256: null});
assert.throws(() => validatePromotionRequest(promotionRequest, {candidate: staleCandidate, ownerDecision: approvalDecision}), /owner decision artifact differs|candidate is stale|artifact is stale/u);

const promotionReceipt = compileReleasePromotionReceipt({
  request: promotionRequest,
  candidate: safetyApprovedCandidate,
  ownerDecision: safetyBoundDecision,
  safetyEvidence: safetyBoundEvidence,
  expectedManifest: sourceManifest,
  targetManifest: sterileManifest,
  hostReceiptSha256: "6".repeat(64),
  promotedAtUtc: now,
});
assert.equal(promotionReceipt.status, "PROMOTED_PREPARED");
assert.equal(promotionReceipt.activation, false);
assert.equal(promotionReceipt.previous_release_disposition, "RETAINED");

const activationTamper = {...promotionRequest, activation: true, request_sha256: null};
activationTamper.request_sha256 = canonicalDigest({...activationTamper, request_sha256: null});
assert.throws(() => validatePromotionRequest(activationTamper), /cannot activate/u);

const unsafeFeedback = {...rejectionFeedback, summary: "See /private/secret and TOKEN=raw-value", feedback_sha256: null};
unsafeFeedback.feedback_sha256 = canonicalDigest({...unsafeFeedback, feedback_sha256: null});
assert.throws(() => validateRejectionFeedback(unsafeFeedback), /private or secret-like|forbidden/u);

fs.rmSync(fixtureRoot, {recursive: true, force: true});
console.log("PASS release lifecycle (strict versions, monotonic allocation, exact manifests, privacy/symlink rejection, owner decisions, stale evidence, and non-activating promotion receipts)");
