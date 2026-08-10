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
  compileVersionAllocationLedger,
  transitionReleaseCandidate,
  verifyArtifactIdentity,
} from "../control/release-lifecycle.mjs";
import {
  compileCompatibilityEvidence,
  compileMigrationPlan,
  requireCompatibilityPass,
} from "../control/release-compatibility.mjs";
import {compilePolicyReplay} from "../control/release-policy-replay.mjs";
import {compileReleaseModelCheck} from "../control/release-model-check.mjs";
import {compileReleaseSafetyGate} from "../control/release-safety-gate.mjs";
import {
  compileBlockedDevelopmentPromotionGate,
  compileReleasePromotionGate,
  validateReleasePromotionGate,
} from "../control/release-promotion-gate.mjs";
import {canonicalDigest} from "../control/release-common.mjs";

const NOW = "2026-08-07T00:00:00.000Z";
const HASH = (character) => character.repeat(64);
const SOURCE = {commit_sha256: HASH("a"), tree_sha256: HASH("b")};
const CHECKER = HASH("c");

const migration = compileMigrationPlan({
  migrationId: "MIGRATION-3-4",
  sourceSchemaVersion: "STATE-3",
  targetSchemaVersion: "STATE-4",
  backfillStrategy: "BATCHED",
  cutoverStrategy: "DUAL_READ",
  reconciliationStrategy: "REPLAY_AND_COMPARE",
  irreversiblePoint: "AT_CUTOVER",
  rollbackStrategy: "RESTORE_CHECKPOINT",
  migrationJournalStatus: "INTENTIONALLY_JOURNALLESS",
  migrationSourceSha256: HASH("a"),
  loadBearingFingerprints: [
    {object_kind: "FUNCTION_BODY", object_id: "public.calculate_total.body", fingerprint_sha256: HASH("2")},
    {object_kind: "FUNCTION_SIGNATURE", object_id: "public.calculate_total.signature", fingerprint_sha256: HASH("3")},
    {object_kind: "GRANT", object_id: "public.orders.read", fingerprint_sha256: HASH("4")},
    {object_kind: "INDEX", object_id: "public.orders.by_owner", fingerprint_sha256: HASH("5")},
    {object_kind: "POLICY", object_id: "public.orders.owner_access", fingerprint_sha256: HASH("6")},
    {object_kind: "REVOKE", object_id: "public.orders.public_write", fingerprint_sha256: HASH("7")},
    {object_kind: "RLS_POSTURE", object_id: "public.orders", fingerprint_sha256: HASH("8")},
    {object_kind: "SCHEMA_OBJECT", object_id: "public.orders", fingerprint_sha256: HASH("9")},
    {object_kind: "TRIGGER", object_id: "public.orders.audit", fingerprint_sha256: HASH("b")},
  ],
  steps: [
    {step_id: "STEP-BACKFILL", phase: "BACKFILL", order: 1, reversible: true, required: true, evidence_sha256: HASH("d")},
    {step_id: "STEP-CUTOVER", phase: "CUTOVER", order: 2, reversible: false, required: true, evidence_sha256: HASH("e")},
    {step_id: "STEP-RECONCILE", phase: "RECONCILIATION", order: 3, reversible: true, required: true, evidence_sha256: HASH("f")},
    {step_id: "STEP-ROLLBACK", phase: "ROLLBACK", order: 4, reversible: true, required: true, evidence_sha256: HASH("1")},
  ],
});

const unprovenMigration = compileMigrationPlan({
  migrationId: "MIGRATION-3-5-UNPROVEN",
  sourceSchemaVersion: "STATE-3",
  targetSchemaVersion: "STATE-5",
  migrationJournalStatus: "MISSING_OR_UNPROVEN",
  migrationSourceSha256: HASH("c"),
  steps: [
    {step_id: "STEP-BACKFILL", phase: "BACKFILL", order: 1, reversible: true, required: true, evidence_sha256: HASH("d")},
    {step_id: "STEP-CUTOVER", phase: "CUTOVER", order: 2, reversible: false, required: true, evidence_sha256: HASH("e")},
    {step_id: "STEP-RECONCILE", phase: "RECONCILIATION", order: 3, reversible: true, required: true, evidence_sha256: HASH("f")},
    {step_id: "STEP-ROLLBACK", phase: "ROLLBACK", order: 4, reversible: true, required: true, evidence_sha256: HASH("1")},
  ],
});

const journaledMigration = compileMigrationPlan({
  migrationId: "MIGRATION-3-4-JOURNALED",
  sourceSchemaVersion: "STATE-3",
  targetSchemaVersion: "STATE-4",
  migrationJournalStatus: "JOURNALED",
  migrationSourceSha256: HASH("e"),
  journalEntryKey: "MIGRATION-3-4-JOURNALED",
  journalEntryChecksumSha256: HASH("f"),
  journalEntrySha256: HASH("1"),
  steps: migration.steps,
});
assert.equal(journaledMigration.migration_journal_status, "JOURNALED");

const compatibilityCases = [
  {case_id: "CASE-OLD", scenario: "OLD_STATE", source_state_sha256: HASH("3"), target_state_sha256: null, observed_state_sha256: null, rollback_state_sha256: null, result: "PASS", evidence_sha256: HASH("4")},
  {case_id: "CASE-NEW", scenario: "NEW_STATE", source_state_sha256: null, target_state_sha256: HASH("5"), observed_state_sha256: null, rollback_state_sha256: null, result: "PASS", evidence_sha256: HASH("6")},
  {case_id: "CASE-MIXED", scenario: "MIXED_VERSION", source_state_sha256: HASH("3"), target_state_sha256: HASH("5"), observed_state_sha256: null, rollback_state_sha256: null, result: "PASS", evidence_sha256: HASH("7")},
  {case_id: "CASE-FAILED", scenario: "FAILED_MIGRATION", source_state_sha256: null, target_state_sha256: null, observed_state_sha256: HASH("8"), rollback_state_sha256: HASH("9"), result: "PASS", evidence_sha256: HASH("a")},
  {case_id: "CASE-INTERRUPTED", scenario: "INTERRUPTED_CUTOVER", source_state_sha256: null, target_state_sha256: null, observed_state_sha256: HASH("b"), rollback_state_sha256: HASH("c"), result: "PASS", evidence_sha256: HASH("d")},
  {case_id: "CASE-RECONCILE", scenario: "RECONCILIATION", source_state_sha256: null, target_state_sha256: null, observed_state_sha256: HASH("e"), rollback_state_sha256: null, result: "PASS", evidence_sha256: HASH("f")},
  {case_id: "CASE-ROLLBACK", scenario: "ROLLBACK", source_state_sha256: null, target_state_sha256: null, observed_state_sha256: null, rollback_state_sha256: HASH("1"), result: "PASS", evidence_sha256: HASH("0")},
];

const compatibility = compileCompatibilityEvidence({
  subjectCandidateSha256: HASH("2"),
  releaseVersion: "4.0.0-rc.1",
  migrationPlan: migration,
  independentCheckerSha256: CHECKER,
  checkedAtUtc: NOW,
  cases: compatibilityCases,
});
requireCompatibilityPass(compatibility, {migrationPlan: migration});

const unprovenCompatibility = compileCompatibilityEvidence({
  subjectCandidateSha256: HASH("2"),
  releaseVersion: "5.0.0-rc.1",
  migrationPlan: unprovenMigration,
  independentCheckerSha256: CHECKER,
  checkedAtUtc: NOW,
  cases: compatibilityCases,
});
assert.equal(unprovenCompatibility.status, "BLOCKED");
assert.throws(() => requireCompatibilityPass(unprovenCompatibility), /not passing/u);

const policyReplay = compilePolicyReplay({
  subjectCandidateSha256: HASH("2"),
  beforePolicySha256: HASH("2"),
  afterPolicySha256: HASH("3"),
  independentCheckerSha256: CHECKER,
  replayedAtUtc: NOW,
  cases: [
    {case_id: "POLICY-001", input_sha256: HASH("4"), before_decision_sha256: HASH("5"), after_decision_sha256: HASH("6"), before_authority_sha256: HASH("7"), after_authority_sha256: HASH("8"), decision_changed: true, authority_changed: true, result: "PASS", evidence_sha256: HASH("9")},
    {case_id: "POLICY-002", input_sha256: HASH("a"), before_decision_sha256: HASH("b"), after_decision_sha256: HASH("b"), before_authority_sha256: HASH("c"), after_authority_sha256: HASH("c"), decision_changed: false, authority_changed: false, result: "PASS", evidence_sha256: HASH("d")},
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
const edge = (transition_id, from_state_id, to_state_id, action, requires_owner = false, protected_action = false) => ({transition_id, from_state_id, to_state_id, action, requires_owner, protected_action, evidence_sha256: HASH(transition_id.slice(-1))});
const modelTransitions = [
  edge("T-01", "ASSEMBLED", "BLOCKED", "BLOCK"),
  edge("T-02", "ASSEMBLED", "STERILE_VERIFIED", "VERIFY"),
  edge("T-03", "STERILE_VERIFIED", "BLOCKED", "BLOCK"),
  edge("T-04", "STERILE_VERIFIED", "INTERRUPTED", "INTERRUPT"),
  edge("T-05", "STERILE_VERIFIED", "OWNER_REVIEW_PENDING", "AUDIT"),
  edge("T-06", "INTERRUPTED", "OWNER_REVIEW_PENDING", "ROLLBACK", true, true),
  edge("T-07", "OWNER_REVIEW_PENDING", "BLOCKED", "OWNER_REJECT", true, true),
  edge("T-08", "OWNER_REVIEW_PENDING", "OWNER_ACCEPTED", "OWNER_APPROVE", true, true),
  edge("T-09", "OWNER_ACCEPTED", "BLOCKED", "OWNER_HOLD", true, true),
  edge("T-10", "OWNER_ACCEPTED", "PROMOTED_PREPARED", "PREPARE_PROMOTION", true, true),
];
const modelCheck = compileReleaseModelCheck({
  subjectCandidateSha256: HASH("2"),
  initialStateId: "ASSEMBLED",
  states: modelStates,
  transitions: modelTransitions,
  independentCheckerSha256: CHECKER,
  checkedAtUtc: NOW,
});
assert.equal(modelCheck.status, "PASS");

const safetyGate = compileReleaseSafetyGate({
  subjectCandidateSha256: HASH("2"),
  releaseVersion: "4.0.0-rc.1",
  compatibility,
  policyReplay,
  modelCheck,
  independentCheckerSha256: CHECKER,
  checkedAtUtc: NOW,
});
const safetyEvidence = {gate: safetyGate, compatibility, policyReplay, modelCheck};

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-safety-fixture-"));
try {
  const developmentRoot = path.join(fixtureRoot, "development");
  const sterileRoot = path.join(fixtureRoot, "sterile");
  fs.mkdirSync(path.join(developmentRoot, "src"), {recursive: true});
  fs.writeFileSync(path.join(developmentRoot, "README.md"), "portable release fixture\n");
  fs.writeFileSync(path.join(developmentRoot, "src", "main.mjs"), "export const safe = true;\n");
  fs.mkdirSync(path.join(developmentRoot, ".git"));
  fs.writeFileSync(path.join(developmentRoot, ".git", "metadata"), "ignored repository metadata\n");
  fs.cpSync(developmentRoot, sterileRoot, {recursive: true});

  const sourceManifest = buildReleaseArtifactManifest({rootPath: developmentRoot, rootBinding: "ACTIVE_DEVELOPMENT_RELEASE_ROOT", releaseVersion: "4.0.0-rc.1", testBuildTag: "v4.0.0-rc.1-tb-01", source: SOURCE});
  const sterileManifest = buildReleaseArtifactManifest({rootPath: sterileRoot, rootBinding: "STERILE_RELEASE_ROOT", releaseVersion: "4.0.0-rc.1", testBuildTag: "v4.0.0-rc.1-tb-01", source: SOURCE});
  assert.equal(sourceManifest.artifact_sha256, sterileManifest.artifact_sha256);
  assert(!sourceManifest.files.some((file) => file.path.startsWith(".git/")));
  assert(!JSON.stringify(sourceManifest).includes(developmentRoot));
  verifyArtifactIdentity({expectedManifest: sourceManifest, actualManifest: sterileManifest});

  let ledger = compileVersionAllocationLedger({releaseVersion: "4.0.0-rc.1"});
  const allocation = allocateTestBuild({ledger, source: SOURCE, normativeSnapshotSha256: HASH("4"), allocatedAtUtc: NOW});
  ledger = allocation.ledger;
  assert.equal(ledger.next_test_build_number, 2);

  const assembled = compileReleaseCandidate({candidateId: "RC-4-01", manifest: sourceManifest, normativeSnapshotSha256: HASH("4")});
  const sterileVerified = transitionReleaseCandidate(assembled, {nextState: "STERILE_VERIFIED"});
  const subject = sterileVerified.candidate_sha256;
  const subjectBoundSafety = {
    gate: {...safetyGate, subject_candidate_sha256: subject, safety_sha256: null},
    compatibility: {...compatibility, subject_candidate_sha256: subject, compatibility_sha256: null},
    policyReplay: {...policyReplay, subject_candidate_sha256: subject, replay_sha256: null},
    modelCheck: {...modelCheck, subject_candidate_sha256: subject, model_sha256: null},
  };
  for (const key of ["compatibility", "policyReplay", "modelCheck"]) {
    const field = key === "compatibility" ? "compatibility_sha256" : key === "policyReplay" ? "replay_sha256" : "model_sha256";
    subjectBoundSafety[key][field] = canonicalDigest({...subjectBoundSafety[key], [field]: null});
  }
  subjectBoundSafety.gate.compatibility_evidence_sha256 = subjectBoundSafety.compatibility.compatibility_sha256;
  subjectBoundSafety.gate.policy_replay_sha256 = subjectBoundSafety.policyReplay.replay_sha256;
  subjectBoundSafety.gate.model_check_sha256 = subjectBoundSafety.modelCheck.model_sha256;
  subjectBoundSafety.gate.safety_sha256 = canonicalDigest({...subjectBoundSafety.gate, safety_sha256: null});
  const review = transitionReleaseCandidate(sterileVerified, {nextState: "OWNER_REVIEW_PENDING", independentAuditSha256: HASH("5"), safetyEvidenceSha256: subjectBoundSafety.gate.safety_sha256, safetySubjectSha256: subject});
  const ownerDecision = compileOwnerDecision({decisionId: "DECISION-01", candidate: review, decision: "APPROVE", actorDigestSha256: HASH("6"), decidedAtUtc: NOW});
  const approved = applyOwnerDecision({candidate: review, decision: ownerDecision});
  const request = compileReleasePromotionRequest({requestId: "PROMOTION-01", candidate: approved, ownerDecision, safetyEvidence: subjectBoundSafety, targetReleaseVersion: "4.0.0", targetBinding: "STERILE_RELEASE_ROOT", currentRelease: null, requestedAtUtc: NOW});
  const receipt = compileReleasePromotionReceipt({request, candidate: approved, ownerDecision, safetyEvidence: subjectBoundSafety, expectedManifest: sourceManifest, targetManifest: sterileManifest, hostReceiptSha256: HASH("7"), promotedAtUtc: NOW});
  assert.equal(receipt.activation, false);

  const blockedGate = compileBlockedDevelopmentPromotionGate({changedPaths: ["control/release-lifecycle.mjs"]});
  validateReleasePromotionGate(blockedGate);
  const tamperedGate = {...blockedGate, status: "READY_FOR_EXPLICIT_PROMOTION", verification: {...blockedGate.verification, ARCHITECTURE: "PASS", CANONICAL: "PASS", HYGIENE: "PASS", PORTABILITY: "PASS"}, safety_gate_sha256: HASH("8"), gate_sha256: null};
  tamperedGate.source = {role: "ACTIVE_DEVELOPMENT_CHECKOUT", status: "VERIFIED", commit_sha256: HASH("9"), tree_sha256: HASH("a"), artifact_sha256: HASH("b"), manifest_sha256: HASH("c"), verification_sha256: HASH("d")};
  tamperedGate.sterile_release = {role: "STERILE_RELEASE_CHECKOUT", status: "VERIFIED", commit_sha256: HASH("e"), tree_sha256: HASH("f"), artifact_sha256: HASH("1"), manifest_sha256: HASH("2"), verification_sha256: HASH("3")};
  tamperedGate.blockers = [];
  tamperedGate.required_actions = ["OBTAIN_EXPLICIT_MAINTAINER_PROMOTION"];
  tamperedGate.gate_sha256 = canonicalDigest({...tamperedGate, gate_sha256: null});
  assert.throws(() => validateReleasePromotionGate(tamperedGate), /status does not match evidence/u);

  const missingSafety = {...approved, safety_evidence_sha256: null, safety_subject_sha256: null, candidate_sha256: null};
  missingSafety.candidate_sha256 = canonicalDigest({...missingSafety, candidate_sha256: null});
  assert.throws(() => compileReleasePromotionRequest({requestId: "PROMOTION-NO-SAFETY", candidate: missingSafety, ownerDecision, safetyEvidence: null, targetReleaseVersion: "4.0.0", targetBinding: "STERILE_RELEASE_ROOT", requestedAtUtc: NOW}), /safety/u);

  const interruptedModel = compileReleaseModelCheck({subjectCandidateSha256: HASH("2"), initialStateId: "ASSEMBLED", states: [...modelStates, {state_id: "UNREACHABLE", terminal: true, owner_controlled: false, requires_recovery: false, activation: false}], transitions: modelTransitions, independentCheckerSha256: CHECKER, checkedAtUtc: NOW});
  assert.equal(interruptedModel.status, "BLOCKED");
  assert(interruptedModel.checks.reachability.unreachable_state_ids.includes("UNREACHABLE"));

  const symlinkRoot = path.join(fixtureRoot, "symlink");
  fs.mkdirSync(symlinkRoot);
  fs.writeFileSync(path.join(symlinkRoot, "real.txt"), "real\n");
  fs.symlinkSync(path.join(developmentRoot, "README.md"), path.join(symlinkRoot, "link.txt"));
  assert.throws(() => buildReleaseArtifactManifest({rootPath: symlinkRoot, rootBinding: "STERILE_RELEASE_ROOT", releaseVersion: "4.0.0-rc.1", testBuildTag: "v4.0.0-rc.1-tb-01", source: SOURCE}), /symbolic link/u);
} finally {
  fs.rmSync(fixtureRoot, {recursive: true, force: true});
}

console.log("PASS release safety contract (migration scenarios, policy replay, finite model checks, safety-bound promotion, sterile identity, privacy, and activation boundary)");
