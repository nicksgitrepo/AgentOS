#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  compileAuditFinding,
  compileCandidateRetentionLedger,
  compileCascadeConvergenceEvent,
  compileCentralIntakeManifest,
  compileConvergenceLedger,
  compileCumulativePlatformCandidate,
  compileEvidenceCeiling,
  compileEvidenceItem,
  compileFeatureCandidateReceipt,
  compileFindingConsolidation,
  compileFindingEvidenceContract,
  compilePlatformConsumptionMatrix,
  compileRepairDag,
  compileSourceObservation,
  transitionAuditFinding,
  validateAuditRepairConvergenceBinding,
} from "../control/audit-repair-convergence.mjs";
import {compileSchedulerAdmissionReceipt} from "../control/scheduler-admission.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = (character) => character.repeat(64);
const GIT = (character) => character.repeat(40);
const proofContract = compileFindingEvidenceContract({
  contractKind: "FOCUSED_PROOF",
  requiredChecks: ["FOCUSED_HOSTILE", "FOCUSED_POSITIVE"],
  requiredEvidenceClasses: ["DETERMINISTIC"],
  prohibitedClaims: ["UNRUN_REAL_HOST_PROOF"],
});
const acceptanceContract = compileFindingEvidenceContract({
  contractKind: "INDEPENDENT_ACCEPTANCE",
  requiredChecks: ["EXACT_CANDIDATE_READBACK", "INDEPENDENT_REAUDIT"],
  requiredEvidenceClasses: ["INDEPENDENT"],
  prohibitedClaims: ["SELF_ACCEPTANCE"],
});
const localCeiling = compileEvidenceCeiling({
  availableLocalChecks: ["DETERMINISTIC_FIXTURE"],
  unavailableProof: [],
  realHostRequired: false,
  realHostStatus: "NOT_REQUIRED",
  maxClaim: "LOCALLY_PROVEN",
});
const deferredCeiling = compileEvidenceCeiling({
  availableLocalChecks: ["LOCAL_CONTRACT"],
  unavailableProof: ["FINAL_DEPLOYED_CANDIDATE"],
  realHostRequired: true,
  realHostStatus: "UNTESTED_DEFERRED",
  mandatoryRetest: "Re-run the exact finding contract against the deployed final candidate.",
  maxClaim: "LOCALLY_PROVEN",
});
assert.equal(deferredCeiling.real_host_status, "UNTESTED_DEFERRED");
assert.throws(() => compileEvidenceCeiling({
  availableLocalChecks: ["LOCAL_CONTRACT"], unavailableProof: ["LIVE"], realHostRequired: true,
  realHostStatus: "UNTESTED_DEFERRED", mandatoryRetest: "Run live proof.", maxClaim: "REAL_HOST_PROVEN",
}), /exceeds its ceiling|lacks passed proof/u);

function finding({id, semantic = id, rootId = `ROOT-${id}`, aliases = [], dependencies = [], conflicts = [], repairClass = "FEATURE_CORRECTNESS", severity = "HIGH", blast = "COMPONENT", evidenceCharacter = "a"}) {
  const observation = compileSourceObservation({
    observationId: `OBS-${id}`,
    sourceIdentitySha256: SHA(evidenceCharacter),
    sourceRef: `fixture:${id}`,
    observedAtUtc: "2026-08-13T00:00:00.000Z",
    observerRole: "INDEPENDENT_AUDITOR",
    statement: `Exact source observation for ${id}.`,
  });
  const evidence = compileEvidenceItem({
    evidenceId: `EVID-${id}`,
    kind: "HOSTILE_FIXTURE",
    sourceObservationId: observation.observation_id,
    artifactSha256: SHA(evidenceCharacter),
    claim: `The fixture reproduces ${id}.`,
    evidenceClass: "DETERMINISTIC",
  });
  return compileAuditFinding({
    findingId: id,
    semanticKey: semantic,
    stableAliases: aliases,
    causalRootId: rootId,
    title: `Finding ${id}`,
    summary: `Portable finding ${id}.`,
    discipline: "PORTABLE_KERNEL",
    gateRef: "governance:3.0/audit-repair-convergence",
    clauseRefs: ["CLAUSE-1"],
    sourceObservations: [observation],
    evidenceItems: [evidence],
    affectedSurfaces: ["control/audit-repair-convergence.mjs"],
    severity,
    confidence: "HIGH",
    blastRadius: blast,
    dependencyFindingIds: dependencies,
    conflictFindingIds: conflicts,
    proposedRepairClass: repairClass,
    focusedProofContract: proofContract,
    independentAcceptanceContract: acceptanceContract,
    evidenceCeiling: localCeiling,
    observedAtUtc: "2026-08-13T00:00:00.000Z",
    observerRole: "INDEPENDENT_AUDITOR",
    openReason: `Audit opened ${id}.`,
    openEvidenceSha256: SHA(evidenceCharacter),
    candidateId: "BASE-CANDIDATE",
  });
}

const sourceFindings = [
  finding({id: "F-A", semantic: "AUTHORITY-SEAM", rootId: "ROOT-AUTHORITY", aliases: ["ALIAS-A"], repairClass: "SAFETY_SECURITY_DATA_BLOCKER", severity: "BLOCKER", blast: "SYSTEM", evidenceCharacter: "a"}),
  finding({id: "F-A2", semantic: "AUTHORITY-SEAM", rootId: "ROOT-AUTHORITY", aliases: ["ALIAS-A"], repairClass: "SHARED_SECURITY_DATA_CONCURRENCY", severity: "CRITICAL", blast: "REPOSITORY", evidenceCharacter: "b"}),
  finding({id: "F-C", dependencies: ["F-A2"], conflicts: ["F-D"], repairClass: "FEATURE_CORRECTNESS", evidenceCharacter: "c"}),
  finding({id: "F-D", conflicts: ["F-C"], repairClass: "DUPLICATION_SIMPLIFICATION", severity: "MEDIUM", blast: "LOCAL", evidenceCharacter: "d"}),
];
const consolidation = compileFindingConsolidation(sourceFindings);
assert.equal(consolidation.entries.length, 3);
const merged = consolidation.entries.find((entry) => entry.canonical_finding_id === "F-A");
assert.deepEqual(merged.source_finding_ids, ["F-A", "F-A2"]);
assert.equal(merged.source_observations.length, 2);
assert.equal(merged.evidence_items.length, 2);
assert.equal(consolidation.source_to_canonical["F-A2"], "F-A");

const aliasAcrossRoots = [
  finding({id: "F-X", aliases: ["SHARED-ALIAS"], evidenceCharacter: "e"}),
  finding({id: "F-Y", aliases: ["SHARED-ALIAS"], evidenceCharacter: "f"}),
];
assert.throws(() => compileFindingConsolidation(aliasAcrossRoots), /spans causal roots/u);
assert.throws(() => compileRepairDag({consolidation}), /unresolved/u);
const conflictResolution = [{
  finding_ids: ["F-C", "F-D"],
  resolution: "ORDER_FIRST_BEFORE_SECOND",
  reason: "Repair feature correctness before simplifying the implementation.",
  evidence_sha256: SHA("e"),
}];
const repairDag = compileRepairDag({consolidation, conflictResolutions: conflictResolution});
assert.equal(repairDag.plan[0].finding_id, "F-A");
assert(repairDag.plan.findIndex((item) => item.finding_id === "F-C") < repairDag.plan.findIndex((item) => item.finding_id === "F-D"));
assert.deepEqual(repairDag.plan.map((item) => item.wave), ["A", "B", "B"]);

const cyclic = compileFindingConsolidation([
  finding({id: "F-E", dependencies: ["F-F"], evidenceCharacter: "e"}),
  finding({id: "F-F", dependencies: ["F-E"], evidenceCharacter: "f"}),
]);
assert.throws(() => compileRepairDag({consolidation: cyclic}), /cycle/u);

let fA = sourceFindings[0];
let fC = sourceFindings[2];
let fD = sourceFindings[3];
function advance(item, toStatus, event, minute, evidence = "1") {
  return transitionAuditFinding(item, {
    toStatus, event, atUtc: `2026-08-13T00:${String(minute).padStart(2, "0")}:00.000Z`, actorRole: "CONVERGENCE_CONTROLLER",
    reason: `${event} exact transition.`, evidenceSha256: SHA(evidence), candidateId: "CANDIDATE-ACCEPTED",
  });
}
for (const [status, event, minute] of [["CONSOLIDATED", "FINDING_CONSOLIDATED", 1], ["PLANNED", "REPAIR_PLANNED", 2], ["IN_REPAIR", "REPAIR_STARTED", 3], ["REPAIRED_PENDING_REAUDIT", "LOCAL_PROOF_PASSED", 4], ["ACCEPTED", "INDEPENDENT_ACCEPTED", 5]]) fA = advance(fA, status, event, minute, "a");
for (const [status, event, minute] of [["CONSOLIDATED", "FINDING_CONSOLIDATED", 1], ["PLANNED", "REPAIR_PLANNED", 2], ["IN_REPAIR", "REPAIR_STARTED", 3], ["REPAIRED_PENDING_REAUDIT", "LOCAL_PROOF_PASSED", 4], ["ACCEPTED", "INDEPENDENT_ACCEPTED", 5], ["REOPENED", "FRESH_AUDIT_REOPENED", 6]]) fC = advance(fC, status, event, minute, "c");
for (const [status, event, minute] of [["CONSOLIDATED", "FINDING_CONSOLIDATED", 1], ["PLANNED", "REPAIR_PLANNED", 2], ["IN_REPAIR", "REPAIR_STARTED", 3], ["REPAIRED_PENDING_REAUDIT", "LOCAL_PROOF_PASSED", 4], ["ACCEPTED", "INDEPENDENT_ACCEPTED", 5]]) fD = advance(fD, status, event, minute, "d");
const activeLedger = compileConvergenceLedger([fA, fC, fD]);
assert.equal(activeLedger.status, "REPAIR_LOOP_ACTIVE");
assert.equal(activeLedger.reopened_event_count, 1);
for (const [status, event, minute] of [["IN_REPAIR", "REPAIR_RESTARTED", 7], ["REPAIRED_PENDING_REAUDIT", "LOCAL_PROOF_PASSED", 8], ["ACCEPTED", "INDEPENDENT_ACCEPTED", 9]]) fC = advance(fC, status, event, minute, "c");
const convergenceLedger = compileConvergenceLedger([fA, fC, fD]);
assert.equal(convergenceLedger.status, "CONVERGED_WITH_EXACT_DISPOSITIONS");
assert.equal(convergenceLedger.reopened_event_count, 1);

let blocked = finding({id: "F-BLOCK", evidenceCharacter: "f"});
for (const [status, event, minute] of [["PLANNED", "REPAIR_PLANNED", 1], ["IN_REPAIR", "REPAIR_STARTED", 2]]) blocked = advance(blocked, status, event, minute, "f");
assert.throws(() => advance(blocked, "BLOCKED_EXACT", "BLOCKED_EXACT", 3, "f"), /three failed recoveries/u);
for (const [index, route] of ["ROUTE-A", "ROUTE-B", "ROUTE-C"].entries()) {
  blocked = transitionAuditFinding(blocked, {
    event: "RECOVERY_FAILED", atUtc: `2026-08-13T00:0${index + 3}:00.000Z`, actorRole: "CONVERGENCE_CONTROLLER",
    reason: `Bounded recovery ${route} reproduced the exact blocker.`, evidenceSha256: SHA("f"), candidateId: "BLOCKED-CANDIDATE",
    failureSignatureSha256: SHA("9"), recoveryRouteId: route,
  });
}
blocked = transitionAuditFinding(blocked, {
  toStatus: "BLOCKED_EXACT", event: "BLOCKED_EXACT", atUtc: "2026-08-13T00:06:00.000Z", actorRole: "CONVERGENCE_CONTROLLER",
  reason: "Three distinct bounded routes exhausted the same exact blocker.", evidenceSha256: SHA("f"), candidateId: "BLOCKED-CANDIDATE",
  failureSignatureSha256: SHA("9"), recoveryRouteId: "EXHAUSTED",
});
assert.deepEqual(compileConvergenceLedger([blocked]).blocked_exact_finding_ids, ["F-BLOCK"]);

function scheduler(requestId, commit, tree, character) {
  return compileSchedulerAdmissionReceipt({
    requestId, candidateCommit: commit, candidateTree: tree, candidateGeneration: 1,
    effectiveArgv: ["node", "focused-proof.mjs"], workingDirectoryRef: `opaque:${requestId}`,
    dependencyPreflight: {closure_sha256: SHA(character)}, runtimePreflight: {closure_sha256: SHA(character)},
    executionUnitId: `EXEC-${requestId}`, laneCursorRef: `LANE-${requestId}`, queueCursorRef: `QUEUE-${requestId}`,
  });
}
const acceptedFeature = compileFeatureCandidateReceipt({
  receiptId: "RECEIPT-FEATURE-1", featureId: "FEATURE-1", candidateId: "FEATURE-CANDIDATE-1", commit: GIT("1"), tree: GIT("2"),
  findingIds: ["F-A", "F-C"], applicablePlatformIds: ["PLATFORM-API"], proofEvidenceSha256: SHA("1"), independentAcceptanceSha256: SHA("2"),
  schedulerAdmission: scheduler("FEATURE-1", GIT("1"), GIT("2"), "3"), status: "ACCEPTED_FOR_PLATFORM", createdAtUtc: "2026-08-13T01:00:00.000Z",
});
const rejectedFeature = compileFeatureCandidateReceipt({
  receiptId: "RECEIPT-FEATURE-REJECTED", featureId: "FEATURE-2", candidateId: "FEATURE-CANDIDATE-REJECTED", commit: GIT("3"), tree: GIT("4"),
  findingIds: ["F-D"], applicablePlatformIds: [], proofEvidenceSha256: SHA("3"), independentAcceptanceSha256: SHA("4"),
  schedulerAdmission: scheduler("FEATURE-REJECTED", GIT("3"), GIT("4"), "5"), status: "REJECTED_RETAINED",
  rejectionReason: "Independent acceptance rejected the candidate.", rejectionEvidenceSha256: SHA("5"), createdAtUtc: "2026-08-13T01:01:00.000Z",
});
assert.throws(() => compileCandidateRetentionLedger({receipts: [acceptedFeature], expectedCandidateIds: ["FEATURE-CANDIDATE-1", "FEATURE-CANDIDATE-REJECTED"]}), /silently dropped/u);
const candidateLedger = compileCandidateRetentionLedger({receipts: [acceptedFeature, rejectedFeature], expectedCandidateIds: ["FEATURE-CANDIDATE-1", "FEATURE-CANDIDATE-REJECTED"]});
assert.deepEqual(candidateLedger.rejected_candidate_ids, ["FEATURE-CANDIDATE-REJECTED"]);
assert.throws(() => compilePlatformConsumptionMatrix({
  platformIds: ["PLATFORM-API", "PLATFORM-DATA"], candidateLedger,
  dispositions: {"FEATURE-CANDIDATE-1::PLATFORM-API": {status: "CONSUMED", reason: null, evidence_sha256: SHA("6")}},
}), /does not cover every/u);
const matrix = compilePlatformConsumptionMatrix({
  platformIds: ["PLATFORM-API", "PLATFORM-DATA"], candidateLedger,
  dispositions: {
    "FEATURE-CANDIDATE-1::PLATFORM-API": {status: "CONSUMED", reason: null, evidence_sha256: SHA("6")},
    "FEATURE-CANDIDATE-1::PLATFORM-DATA": {status: "NOT_APPLICABLE_WITH_EVIDENCE", reason: "The exact Feature candidate has no data seam.", evidence_sha256: SHA("7")},
  },
});
assert.equal(matrix.cells.length, 2);

const reopenedPlatform = compileCumulativePlatformCandidate({
  platformId: "PLATFORM-API", candidateId: "PLATFORM-API-R1", commit: GIT("5"), tree: GIT("6"), matrix, candidateLedger,
  schedulerAdmission: scheduler("PLATFORM-API-R1", GIT("5"), GIT("6"), "8"), reAuditStatus: "REOPENED",
  reviewedFindingIds: ["F-A", "F-C"], reopenedFindingIds: ["F-C"], auditorRole: "INDEPENDENT_AUDITOR", reAuditEvidenceSha256: SHA("8"), createdAtUtc: "2026-08-13T01:02:00.000Z",
});
assert.equal(reopenedPlatform.status, "CUMULATIVE_REAUDIT_REOPENED");
assert.throws(() => compileCentralIntakeManifest({
  centralCandidateId: "CENTRAL-1", commit: GIT("7"), tree: GIT("8"), matrix, candidateLedger, platformCandidates: [reopenedPlatform],
  convergenceLedger, repairDag, intakeEvidenceSha256: SHA("9"), createdAtUtc: "2026-08-13T01:04:00.000Z",
}), /reopened findings/u);
assert.throws(() => compileCentralIntakeManifest({
  centralCandidateId: "CENTRAL-1", commit: GIT("7"), tree: GIT("8"), matrix, candidateLedger, platformCandidates: [],
  convergenceLedger: activeLedger, repairDag, intakeEvidenceSha256: SHA("9"), createdAtUtc: "2026-08-13T01:04:00.000Z",
}), /active repair/u);
const platformCandidate = compileCumulativePlatformCandidate({
  platformId: "PLATFORM-API", candidateId: "PLATFORM-API-R2", commit: GIT("7"), tree: GIT("8"), matrix, candidateLedger,
  schedulerAdmission: scheduler("PLATFORM-API-R2", GIT("7"), GIT("8"), "9"), reAuditStatus: "PASS",
  reviewedFindingIds: ["F-A", "F-C"], auditorRole: "INDEPENDENT_AUDITOR", reAuditEvidenceSha256: SHA("9"), createdAtUtc: "2026-08-13T01:03:00.000Z",
});
const central = compileCentralIntakeManifest({
  centralCandidateId: "CENTRAL-1", commit: GIT("9"), tree: GIT("a"), matrix, candidateLedger, platformCandidates: [platformCandidate],
  convergenceLedger, repairDag, intakeEvidenceSha256: SHA("a"), createdAtUtc: "2026-08-13T01:04:00.000Z",
});
assert.equal(central.matrix_cell_dispositions.length, 2);
assert.deepEqual(central.retained_rejected_candidate_ids, ["FEATURE-CANDIDATE-REJECTED"]);
assert.equal(central.platform_entries.find((entry) => entry.platform_id === "PLATFORM-DATA").status, "NOT_APPLICABLE_WITH_EVIDENCE");
const cascadeEvent = compileCascadeConvergenceEvent({centralManifest: central, outcomeId: "CENTRAL-INTAKE-1", atUtc: "2026-08-13T01:05:00.000Z"});
assert.equal(cascadeEvent.type, "AUDIT_REPAIR_CONVERGENCE");
assert.equal(cascadeEvent.payload.central_intake_sha256, central.manifest_sha256);

const bindingPath = path.join(root, "governance", "3.0", "audit-repair-convergence.binding.v1.json");
if (fs.existsSync(bindingPath)) {
  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  const bindingContext = {
    repositoryRoot: root,
    readFile: (repositoryRoot, relative) => fs.existsSync(path.join(repositoryRoot, relative)) && fs.lstatSync(path.join(repositoryRoot, relative)).isFile(),
    sha256File: (repositoryRoot, relative) => crypto.createHash("sha256").update(fs.readFileSync(path.join(repositoryRoot, relative))).digest("hex"),
  };
  validateAuditRepairConvergenceBinding(binding, bindingContext);
  const staleBinding = structuredClone(binding);
  staleBinding.files[0].sha256 = SHA("0");
  assert.throws(() => validateAuditRepairConvergenceBinding(staleBinding, bindingContext), /digest mismatch/u);
}

console.log("PASS audit-repair convergence: full findings, multi-source semantic/causal dedupe, conflict and cycle rejection, deterministic A/B/C DAG, exact failure exhaustion, reopened convergence, Scheduler-bound retained candidates, complete Feature/Platform matrix, Platform re-audit, Central custody, evidence ceilings, and cascade event binding");
