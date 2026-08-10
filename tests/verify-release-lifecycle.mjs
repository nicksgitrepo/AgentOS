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
const currentRelease = {
  release_version: "2.9.0",
  artifact_sha256: "1".repeat(64),
  manifest_sha256: "2".repeat(64),
};
const promotionRequest = compileReleasePromotionRequest({
  requestId: "PROMOTION-RC-001",
  candidate: approvedCandidate,
  ownerDecision: approvalDecision,
  targetReleaseVersion: "3.0.0",
  targetBinding: "STABLE_RELEASE_ROOT",
  currentRelease,
  requestedAtUtc: now,
});
validatePromotionRequest(promotionRequest, {candidate: approvedCandidate, ownerDecision: approvalDecision});
assert.throws(() => compileReleasePromotionRequest({
  requestId: "PROMOTION-RC-WRONG-TARGET",
  candidate: approvedCandidate,
  ownerDecision: approvalDecision,
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
  candidate: approvedCandidate,
  ownerDecision: approvalDecision,
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
