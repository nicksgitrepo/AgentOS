#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PYRAMID_CAMPAIGN_ACTIONS,
  PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA,
  advancePyramidCampaign,
  compilePyramidCampaignContext,
  compilePyramidCampaignState,
  compilePyramidIsolatedCandidateAssembly,
  compilePyramidPlatformReview,
  compilePyramidSpecialistHandoff,
  deriveApplicableSpecialistRoster,
  validatePyramidCampaignState,
} from "../control/pyramid-campaign-governance.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {controllerActionHandlerFor} from "../control/controller-action-dispatcher.mjs";

const HASH = (value) => canonicalDigest({value});
const context = compilePyramidCampaignContext({
  architectureSha256: HASH("architecture"),
  goalsSha256: HASH("goals"),
  hostSha256: HASH("host"),
  environmentSha256: HASH("environment"),
});

const specialistTypes = Array.from({length: 7}, (_, index) => {
  const id = `SPECIALIST_${String(index + 1).padStart(2, "0")}`;
  return {
    specialist_id: id,
    role_kind: "AUDIT_REPAIR_SPECIALIST",
    applicability: "APPLICABLE",
    applicability_sha256: HASH(`applicability-${id}`),
    block_ids: [`BLOCK_${String(index + 1).padStart(2, "0")}`],
    source_refs: [`ref:specialist/${id}`],
    task_template_sha256: HASH(`task-template-${id}`),
  };
});
specialistTypes.push({
  specialist_id: "SPECIALIST_99",
  role_kind: "AUDIT_REPAIR_SPECIALIST",
  applicability: "NOT_APPLICABLE",
  applicability_sha256: HASH("not-applicable"),
  block_ids: [],
  source_refs: ["ref:specialist/SPECIALIST_99"],
  task_template_sha256: HASH("task-template-99"),
});

const roster = deriveApplicableSpecialistRoster({context, specialistTypes});
assert.equal(roster.specialists.length, 7);
assert.equal(roster.applicable_specialist_ids.at(-1), "SPECIALIST_07");
assert.equal(roster.specialists.some((entry) => entry.specialist_id === "SPECIALIST_99"), false);

const initial = compilePyramidCampaignState({
  campaignId: "CAMPAIGN.PYRAMID.GENERIC",
  roster,
  candidateId: "CANDIDATE.ISOLATED.CUMULATIVE",
  candidateSha256: HASH("candidate-0"),
  worktreeRef: "opaque:cumulative-candidate-worktree",
  rollbackRef: "opaque:cumulative-candidate-rollback",
});
assert.equal(initial.status, "PREPARED");
assert.equal(initial.next_action, "START_SPECIALIST_WAVE");
assert.equal(initial.next_handler, controllerActionHandlerFor(initial.next_action));
assert.ok(PYRAMID_CAMPAIGN_ACTIONS.includes(initial.next_action));

const initiallyProtected = compilePyramidCampaignState({
  campaignId: "CAMPAIGN.PYRAMID.INITIAL_PROTECTED",
  roster,
  candidateId: "CANDIDATE.INITIAL.PROTECTED",
  candidateSha256: HASH("initial-protected-candidate"),
  worktreeRef: "opaque:initial-protected-worktree",
  rollbackRef: "opaque:initial-protected-rollback",
  initialProtectedWait: true,
  protectedEvent: {
    blocker_id: "PROTECTED.INITIAL.DECISION",
    blocker_class: "MAJOR_PRODUCT_OR_PRODUCTION_DECISION",
    affected_action: "INITIAL_PROTECTED_ACTION",
    evidence_ceiling: "Only typed local evidence is available before protected review.",
    restart_event: "CURRENT_TYPED_OWNER_DECISION",
    resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
  },
});
assert.equal(initiallyProtected.status, "PROTECTED_WAIT");
assert.equal(initiallyProtected.stop_workflow_decision.primary_trigger_question_id, "OWNER_DECISION_REQUIRED");
assert.equal(initiallyProtected.stop_workflow_decision.stop, true);
const missingProtectedDecision = structuredClone(initiallyProtected);
missingProtectedDecision.stop_workflow_decision = null;
missingProtectedDecision.state_sha256 = canonicalDigest({...missingProtectedDecision, state_sha256: null});
assert.throws(() => validatePyramidCampaignState(missingProtectedDecision, {roster}), /lacks stop-workflow decision/u);

function custody() {
  return {
    isolated_worktree: true,
    shared_workspace_read_only: true,
    source_roots_preserved: true,
    product_mutation: false,
    provider_access: false,
    credential_access: false,
    external_sync: false,
    spend: false,
    destructive_work: false,
    heavyweight_processes: 0,
    timer_count: 0,
    polling: false,
  };
}

function handoffFor(state, specialistId, waveIndex) {
  return compilePyramidSpecialistHandoff({
    laneId: `SPECIALIST_LANE:${specialistId}`,
    specialistId,
    waveIndex,
    taskRef: `opaque:task/${specialistId}`,
    worktreeRef: `opaque:worktree/${specialistId}`,
    baseCandidateSha256: state.candidate.candidate_sha256,
    findingSha256: HASH(`finding-${specialistId}-${waveIndex}`),
    repairCandidateSha256: HASH(`repair-${specialistId}-${waveIndex}`),
    evidenceSha256: HASH(`evidence-${specialistId}-${waveIndex}`),
    hostileFixtureRefs: [`FIXTURE.${specialistId}.POSITIVE`, `FIXTURE.${specialistId}.HOSTILE`].sort(),
    sourceBindingSha256: HASH(`source-${specialistId}`),
    custody: custody(),
    rollbackRef: "opaque:lane-rollback",
  });
}

function reviewFor(handoff, before, after, accepted = true) {
  return compilePyramidPlatformReview({
    reviewId: `REVIEW.${handoff.specialist_id}`,
    laneId: handoff.lane_id,
    handoffSha256: handoff.handoff_sha256,
    reviewerRole: "PLATFORM_REVIEW_INDEPENDENT",
    accepted,
    reviewEvidenceSha256: HASH(`review-evidence-${handoff.specialist_id}`),
    cumulativeCandidateBeforeSha256: before,
    cumulativeCandidateAfterSha256: after,
    rollbackRef: "opaque:cumulative-candidate-rollback",
  });
}

assert.throws(
  () => advancePyramidCampaign(initial, {roster, event: "SPECIALIST_WAVE_HANDOFFS_READY", handoffs: []}),
  /one typed handoff per selected specialist/u,
  "a wave cannot close without typed findings and repair candidates",
);
assert.throws(
  () => advancePyramidCampaign(initial, {
    roster,
    event: "SPECIALIST_WAVE_HANDOFFS_READY",
    handoffs: [...roster.specialists.map((entry) => handoffFor(initial, entry.specialist_id, 1)), handoffFor(initial, "SPECIALIST_01", 1)],
  }),
  /one typed handoff per selected specialist|duplicated|cover the selected/u,
  "a wave cannot exceed six or duplicate a lane",
);

const firstBatch = roster.applicable_specialist_ids.slice(0, 6).map((id) => handoffFor(initial, id, 1));
const platformPending = advancePyramidCampaign(initial, {roster, event: "SPECIALIST_WAVE_HANDOFFS_READY", handoffs: firstBatch});
assert.equal(platformPending.status, "PLATFORM_REVIEW_PENDING");
assert.equal(platformPending.next_action, "START_PLATFORM_REVIEW");
assert.equal(platformPending.active_lane_ids.length, 6);

const beforeReviews = platformPending.candidate.candidate_sha256;
const firstReviews = [];
let chainedCandidate = beforeReviews;
for (const handoff of platformPending.platform_review_batch) {
  const nextCandidate = HASH(`candidate-after-${handoff.specialist_id}`);
  firstReviews.push(reviewFor(handoff, chainedCandidate, nextCandidate));
  chainedCandidate = nextCandidate;
}
const afterFirstPlatformReview = advancePyramidCampaign(platformPending, {roster, event: "PLATFORM_REVIEW_COMPLETED", reviews: firstReviews});
assert.equal(afterFirstPlatformReview.status, "PREPARED");
assert.equal(afterFirstPlatformReview.next_action, "START_SPECIALIST_WAVE");
assert.deepEqual(afterFirstPlatformReview.pending_specialist_ids, ["SPECIALIST_07"]);
assert.equal(afterFirstPlatformReview.completed_specialist_ids.length, 6);
assert.equal(afterFirstPlatformReview.candidate.candidate_sha256, chainedCandidate);

const secondHandoff = handoffFor(afterFirstPlatformReview, "SPECIALIST_07", 2);
const secondPlatformPending = advancePyramidCampaign(afterFirstPlatformReview, {roster, event: "SPECIALIST_WAVE_HANDOFFS_READY", handoffs: [secondHandoff]});
const secondCandidate = HASH("candidate-after-specialist-07");
const secondReview = reviewFor(secondHandoff, secondPlatformPending.candidate.candidate_sha256, secondCandidate);
const finalReviewPending = advancePyramidCampaign(secondPlatformPending, {roster, event: "PLATFORM_REVIEW_COMPLETED", reviews: [secondReview]});
assert.equal(finalReviewPending.status, "FINAL_REVIEW_PENDING");
assert.equal(finalReviewPending.next_action, "PREPARE_CANDIDATE_REVIEW");

const finalReview = {
  reviewer_role: "FINAL_HIGHER_TIER_COHERENCE_POLISH_REVIEWER",
  candidate_sha256: finalReviewPending.candidate.candidate_sha256,
  coherence_evidence_sha256: HASH("coherence"),
  release_evidence_sha256: HASH("release-evidence"),
  residual_risk_sha256: HASH("residual-risk"),
  accepted: true,
  review_sha256: null,
};
finalReview.review_sha256 = canonicalDigest({...finalReview, review_sha256: null});
const assemblyPending = advancePyramidCampaign(finalReviewPending, {roster, event: "FINAL_REVIEW_COMPLETED", finalReview});
assert.equal(assemblyPending.status, "CANDIDATE_ASSEMBLY_PENDING");
assert.equal(assemblyPending.next_action, "ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE");
assert.equal(assemblyPending.next_handler, "HANDLER.PLATFORM_AGENT.ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE");

function assemblyCustody() {
  return {
    isolated_worktree: true,
    shared_workspace_read_only: true,
    source_roots_preserved: true,
    product_mutation: false,
    provider_access: false,
    credential_access: false,
    external_sync: false,
    spend: false,
    destructive_work: false,
    deployment_publication_merge: false,
    release: false,
    heavyweight_processes: 0,
    timer_count: 0,
    polling: false,
  };
}

const isolatedAssembly = compilePyramidIsolatedCandidateAssembly({
  candidate: assemblyPending.candidate,
  proofRefs: ["opaque:proof/accepted-platform-handoffs", "opaque:proof/isolated-candidate-custody"],
  custody: assemblyCustody(),
});
assert.equal(isolatedAssembly.candidate_id, assemblyPending.candidate.candidate_id);
assert.equal(isolatedAssembly.base_candidate_sha256, assemblyPending.candidate.candidate_sha256);
assert.equal(isolatedAssembly.source_roots_preserved, true);
assert.equal(isolatedAssembly.zero_trace, true);
const protectedWait = advancePyramidCampaign(assemblyPending, {roster, event: "ISOLATED_CUMULATIVE_CANDIDATE_ASSEMBLED", assembly: isolatedAssembly});
assert.equal(protectedWait.status, "PROTECTED_WAIT");
assert.equal(protectedWait.next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(protectedWait.next_handler, "HANDLER.PROTECTED_EVENT_WAIT");
assert.equal(protectedWait.protected_event.affected_action, "PROMOTE_ISOLATED_CUMULATIVE_CANDIDATE_TO_PRODUCT");
assert.deepEqual(protectedWait.protected_event.resources, {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0});
assert.equal(protectedWait.authority.central_integration, false);
assert.equal(protectedWait.stop_workflow_decision.outcome, "STOP_OWNER_DECISION");
assert.equal(protectedWait.stop_workflow_decision.primary_trigger_question_id, "OWNER_DECISION_REQUIRED");
assert.equal(protectedWait.stop_workflow_decision.stop, true);
assert.equal(protectedWait.stop_workflow_decision.rollback_ref, protectedWait.candidate.rollback_ref);
assert.equal(protectedWait.isolated_candidate_assembly.assembly_sha256, isolatedAssembly.assembly_sha256);
validatePyramidCampaignState(protectedWait, {roster});

assert.throws(
  () => advancePyramidCampaign(assemblyPending, {roster, event: "ISOLATED_CUMULATIVE_CANDIDATE_ASSEMBLED", assembly: {...isolatedAssembly, base_candidate_sha256: HASH("stale-base"), assembly_sha256: canonicalDigest({...isolatedAssembly, base_candidate_sha256: HASH("stale-base"), assembly_sha256: null})}}),
  /baseline is stale|candidate digest mismatch/u,
  "isolated assembly must bind the exact cumulative candidate baseline",
);
assert.throws(
  () => compilePyramidIsolatedCandidateAssembly({candidate: assemblyPending.candidate, proofRefs: isolatedAssembly.proof_refs, custody: {...assemblyCustody(), product_mutation: true}}),
  /crossed protected boundary/u,
  "isolated assembly cannot carry product mutation authority",
);
assert.throws(
  () => compilePyramidIsolatedCandidateAssembly({candidate: assemblyPending.candidate, proofRefs: [], custody: assemblyCustody()}),
  /proof refs are required/u,
  "isolated assembly requires deterministic proof references",
);

assert.throws(
  () => advancePyramidCampaign(finalReviewPending, {roster, event: "FINAL_REVIEW_COMPLETED", finalReview: {...finalReview, candidate_sha256: HASH("stale")}}),
  /candidate binding is stale/u,
  "final review must bind the exact cumulative candidate",
);

const staleHandoff = handoffFor(initial, "SPECIALIST_01", 1);
staleHandoff.base_candidate_sha256 = HASH("stale-baseline");
staleHandoff.handoff_sha256 = canonicalDigest({...staleHandoff, handoff_sha256: null});
assert.throws(
  () => advancePyramidCampaign(initial, {roster, event: "SPECIALIST_WAVE_HANDOFFS_READY", handoffs: [staleHandoff, ...firstBatch.slice(1)]}),
  /baseline is stale|cover the selected/u,
  "stale lane baseline must be rejected",
);

const rejectedReview = reviewFor(platformPending.platform_review_batch[0], beforeReviews, beforeReviews, false);
assert.equal(rejectedReview.accepted, false);
assert.equal(rejectedReview.integrated, false);
assert.throws(
  () => advancePyramidCampaign(platformPending, {roster, event: "PLATFORM_REVIEW_COMPLETED", reviews: [rejectedReview]}),
  /cover the complete typed handoff batch/u,
  "platform review cannot silently omit the other handoffs",
);

const emptyRoster = deriveApplicableSpecialistRoster({context, specialistTypes: specialistTypes.map((entry) => ({...entry, applicability: "NOT_APPLICABLE", block_ids: []}))});
const emptyState = compilePyramidCampaignState({
  campaignId: "CAMPAIGN.PYRAMID.EMPTY_APPLICABLE_SET",
  roster: emptyRoster,
  candidateId: "CANDIDATE.EMPTY_APPLICABLE_SET",
  candidateSha256: HASH("empty-candidate"),
  worktreeRef: "opaque:empty-worktree",
  rollbackRef: "opaque:empty-rollback",
});
assert.equal(emptyState.next_action, "PREPARE_CANDIDATE_REVIEW");
assert.notEqual(emptyState.next_action, "NONE");

assert.throws(() => deriveApplicableSpecialistRoster({context, specialistTypes: [specialistTypes[0], specialistTypes[0]]}), /specialist type IDs must be sorted and unique/u);
assert.throws(() => deriveApplicableSpecialistRoster({context, specialistTypes: [{...specialistTypes[0], block_ids: undefined}]}), /block IDs are required/u);
assert.throws(() => validatePyramidCampaignState({...initial, active_lane_ids: Array.from({length: 7}, (_, index) => `SPECIALIST_LANE:SPECIALIST_${index + 1}`), state_sha256: HASH("tampered")}, {roster}), /exceeds six|partition|digest/u);

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/pyramid-campaign-governance.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA);
assert.deepEqual([...schema.properties.next_action.enum].sort(), [...PYRAMID_CAMPAIGN_ACTIONS].sort());
assert.deepEqual([...schema.required].sort(), [
  "schema", "version", "campaign_id", "context_sha256", "roster_sha256", "candidate", "status", "wave_index", "pending_specialist_ids", "completed_specialist_ids", "active_lane_ids", "platform_review_batch", "accepted_platform_lane_ids", "final_review", "isolated_candidate_assembly", "lane_policy", "authority", "next_action", "next_handler", "continuation", "continuation_sha256", "protected_event", "stop_workflow_decision", "state_sha256",
].sort());
assert.deepEqual([...schema.properties.next_action.enum].sort(), [...PYRAMID_CAMPAIGN_ACTIONS].sort());
assert(schema.$defs.isolatedCandidateAssembly, "schema must bind isolated candidate assembly");
assert(schema.$defs.protectedEvent.required.includes("affected_action"), "protected promotion event must name its affected action");
assert(schema.$defs.stopWorkflowDecision, "protected waits must bind the stop-workflow decision tree");
for (const relative of ["control/pyramid-campaign-governance.mjs", "schemas/pyramid-campaign-governance.v1.json", "control/import-orchestrator.mjs"]) {
  const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  assert(!/Sociuna|JobSight|WellSight/iu.test(source), `${relative} contains consumer-specific policy`);
}

console.log("PASS pyramid campaign governance: context-derived specialist roster, six-lane waves, typed findings/repairs, accepted platform accumulation, final coherence route, protected integration wait, and hostile coverage");
