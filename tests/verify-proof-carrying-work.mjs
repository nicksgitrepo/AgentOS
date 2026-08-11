#!/usr/bin/env node

/* Focused verifier for ROADMAP_07; execution remains pending for this audit task. */

import assert from "node:assert/strict";
import {
  compileClaimedScope,
  compileDependencyClaim,
  compileProofCapsule,
  compileProofCheck,
  compileProofEvidence,
  compileProofEnvironment,
  compileRollbackInformation,
  compileSourceIdentity,
  compileTypedHandoff,
  deriveRequiredRechecks,
  invalidateProofCapsule,
  validateProofCapsule,
} from "../control/proof-carrying-work.mjs";

const sha = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
const COMMIT = git("a");
const TREE = git("b");
const NOW = "2026-08-07T12:00:00.000Z";

const sourceBefore = compileSourceIdentity({commit: COMMIT, tree: TREE, workingTreeSha256: sha("1"), clean: true, pushed: false});
const sourceAfter = compileSourceIdentity({commit: COMMIT, tree: TREE, workingTreeSha256: sha("2"), clean: true, pushed: false});
const scope = compileClaimedScope({inPaths: ["control_proof_carrying_work_mjs", "schemas_proof_carrying_work_v1_json"], outPaths: ["README_md"]});
const environment = compileProofEnvironment({environmentId: "ENV-LOCAL", capabilitySha256: sha("3"), runtimeSha256: sha("4"), sourceCommit: COMMIT, sourceTree: TREE});
const evidence = [
  compileProofEvidence({evidenceId: "EVIDENCE-DIRECT", kind: "DIRECT_OBSERVATION", summary: "The named bounded check returned its observed result.", path: "tests/verify-proof-carrying-work.mjs", sourceCommit: COMMIT, sourceTree: TREE, claimIds: ["CLAIM-DIRECT"]}),
  compileProofEvidence({evidenceId: "EVIDENCE-UNAVAILABLE", kind: "UNAVAILABLE_RESULT", summary: "The deferred functional check was not available in this pass.", path: null, sourceCommit: COMMIT, sourceTree: TREE, claimIds: ["CLAIM-UNAVAILABLE"]}),
];
const checks = [
  compileProofCheck({checkId: "CHECK-DIRECT", checkRef: "tests/verify-proof-carrying-work.mjs", status: "PASS", sourceCommit: COMMIT, sourceTree: TREE, resultSha256: sha("5"), evidenceKind: "DIRECT_OBSERVATION", evidenceIds: ["EVIDENCE-DIRECT"]}),
  compileProofCheck({checkId: "CHECK-FUNCTIONAL", checkRef: "tests/verify-all.mjs", status: "NOT_RUN", sourceCommit: COMMIT, sourceTree: TREE, resultSha256: sha("6"), evidenceKind: "UNAVAILABLE_RESULT", evidenceIds: ["EVIDENCE-UNAVAILABLE"]}),
];
const dependency = compileDependencyClaim({dependencyId: "DEP-CAPSULE", kind: "SOURCE_SCHEMA", reference: "schemas/proof-carrying-work.v1.json", sourceCommit: COMMIT, sourceTree: TREE, dependencySha256: sha("7"), affectsClaimIds: ["CLAIM-DIRECT"], recheckIds: ["CHECK-DIRECT"]});
const claims = [
  {claim_id: "CLAIM-DIRECT", status: "VERIFIED", evidence_ids: ["EVIDENCE-DIRECT"], dependency_ids: ["DEP-CAPSULE"], recheck_ids: ["CHECK-DIRECT"]},
  {claim_id: "CLAIM-UNAVAILABLE", status: "UNAVAILABLE", evidence_ids: ["EVIDENCE-UNAVAILABLE"], dependency_ids: [], recheck_ids: ["CHECK-FUNCTIONAL"]},
];
const handoff = compileTypedHandoff({phase: "ROADMAP_07_REPAIR", result: "READY_FOR_INDEPENDENT_CLEARANCE", nextHandoff: "INDEPENDENT_AUDITOR", auditorId: "AUDITOR-2", independentEvidenceSha256: sha("8"), evidenceIds: ["EVIDENCE-DIRECT", "EVIDENCE-UNAVAILABLE"], summary: "The bounded proof capsule is ready for an independent check.", candidateGenerationId: "CAPSULE-1-GEN-1", proofCeiling: "FUNCTIONAL_AND_CUMULATIVE_COMPATIBILITY_CHECKS_PENDING"});
const capsule = compileProofCapsule({
  capsuleId: "CAPSULE-1",
  repositoryId: "REPOSITORY-1",
  projectGovernanceSha256: sha("9"),
  builderId: "BUILDER-1",
  auditorId: "AUDITOR-2",
  sourceBefore,
  sourceAfter,
  observedAtUtc: NOW,
  claimedScope: scope,
  changedPaths: ["control_proof_carrying_work_mjs", "schemas_proof_carrying_work_v1_json"],
  environment,
  dependencies: [dependency],
  checks,
  evidence,
  claims,
  rollback: compileRollbackInformation({available: true, planRef: "docs/rollback-plan.md", checkpointSha256: sha("a")}),
  handoff,
});

assert.doesNotThrow(() => validateProofCapsule(capsule, {currentSourceCommit: COMMIT, currentSourceTree: TREE, currentDependencyDigests: {"DEP-CAPSULE": sha("7")}}));
assert.deepEqual(deriveRequiredRechecks(capsule, {changedDependencyIds: ["DEP-CAPSULE"]}), {affected_claim_ids: ["CLAIM-DIRECT"], required_recheck_ids: ["CHECK-DIRECT"]});

const invalidated = invalidateProofCapsule(capsule, {eventId: "INVALIDATION-1", changedDependencyIds: ["DEP-CAPSULE"], cause: "A bound dependency changed after the proof was recorded.", observedAtUtc: NOW});
assert.equal(invalidated.status, "INVALIDATED");
assert.equal(invalidated.claims.find((claim) => claim.claim_id === "CLAIM-DIRECT").status, "INVALIDATED");
assert.equal(invalidated.invalidation.events[0].prior_claims[0].status, "VERIFIED");

assert.throws(() => validateProofCapsule(capsule, {currentDependencyDigests: {"DEP-CAPSULE": sha("c")}}), /dependency DEP-CAPSULE is stale/u);
const unsafe = structuredClone(capsule);
unsafe.evidence[0].summary = "credential value leaked";
assert.throws(() => validateProofCapsule(unsafe), /private|credential-like/u);

console.log("PASS ROADMAP_07 proof capsule, evidence kinds, dependency invalidation, and independent handoff contract");
