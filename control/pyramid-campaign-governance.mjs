#!/usr/bin/env node

/*
 * Project-agnostic pyramid campaign governance.
 *
 * The Spawner supplies typed specialist candidates from architecture, goals,
 * host, and environment evidence.  The Orchestrator advances one bounded
 * audit/repair wave at a time, never more than six lanes, and platform review
 * changes only the isolated cumulative candidate when a typed handoff is
 * accepted.  The final coherence/polish route ends at the existing protected
 * central-integration event until an exact authorization and candidate
 * identity are supplied.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  controllerActionHandlerFor,
  compileControllerContinuation,
  controllerContinuationDigest,
} from "./controller-action-dispatcher.mjs";

export const PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA = "agentos.pyramid_campaign_governance.v1";
export const PYRAMID_CAMPAIGN_GOVERNANCE_VERSION = 1;
export const PYRAMID_CAMPAIGN_MAX_LANES = 6;
export const PYRAMID_CAMPAIGN_MAX_HEAVYWEIGHT_PROCESSES = 1;
export const PYRAMID_CAMPAIGN_ACTIONS = Object.freeze([
  "START_SPECIALIST_WAVE",
  "START_PLATFORM_REVIEW",
  "PREPARE_CANDIDATE_REVIEW",
  "WAIT_FOR_PROTECTED_EVENT",
]);
export const PYRAMID_CAMPAIGN_STATUSES = Object.freeze([
  "PREPARED",
  "PLATFORM_REVIEW_PENDING",
  "FINAL_REVIEW_PENDING",
  "PROTECTED_WAIT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[A-Za-z0-9._:/-]+$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;

const CONTEXT_KEYS = Object.freeze([
  "architecture_sha256", "goals_sha256", "host_sha256", "environment_sha256", "context_sha256",
]);
const SPECIALIST_TYPE_KEYS = Object.freeze([
  "specialist_id", "role_kind", "applicability", "applicability_sha256", "block_ids", "source_refs", "task_template_sha256",
]);
const SPECIALIST_KEYS = Object.freeze([
  "specialist_id", "role_kind", "lane_id", "applicability_sha256", "block_ids", "source_refs", "task_template_sha256",
]);
const ROSTER_KEYS = Object.freeze([
  "schema", "version", "context", "specialists", "applicable_specialist_ids", "roster_sha256",
]);
const CANDIDATE_KEYS = Object.freeze([
  "candidate_id", "candidate_sha256", "worktree_ref", "rollback_ref", "clean", "source_roots_preserved", "status",
]);
const CUSTODY_KEYS = Object.freeze([
  "isolated_worktree", "shared_workspace_read_only", "source_roots_preserved", "product_mutation", "provider_access",
  "credential_access", "external_sync", "spend", "destructive_work", "heavyweight_processes", "timer_count", "polling",
]);
const HANDOFF_KEYS = Object.freeze([
  "schema", "version", "lane_id", "specialist_id", "wave_index", "task_ref", "worktree_ref", "base_candidate_sha256",
  "finding_sha256", "repair_candidate_sha256", "evidence_sha256", "hostile_fixture_refs", "source_binding_sha256",
  "custody", "rollback_ref", "status", "handoff_sha256",
]);
const REVIEW_KEYS = Object.freeze([
  "schema", "version", "review_id", "lane_id", "handoff_sha256", "reviewer_role", "accepted", "integrated",
  "review_evidence_sha256", "cumulative_candidate_before_sha256", "cumulative_candidate_after_sha256", "rollback_ref", "review_sha256",
]);
const FINAL_REVIEW_KEYS = Object.freeze([
  "reviewer_role", "candidate_sha256", "coherence_evidence_sha256", "release_evidence_sha256", "residual_risk_sha256", "accepted", "review_sha256",
]);
const LANE_POLICY_KEYS = Object.freeze([
  "max_active_lanes", "max_heavyweight_processes", "heavyweight_processes", "timers", "polling",
]);
const AUTHORITY_KEYS = Object.freeze([
  "roster_derivation", "wave_routing", "isolated_audit_admission", "platform_review_routing", "cumulative_candidate_write",
  "central_integration", "product_mutation", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "release",
]);
const PROTECTED_EVENT_KEYS = Object.freeze([
  "blocker_id", "blocker_class", "evidence_ceiling", "restart_event", "resources",
]);
const RESOURCE_KEYS = Object.freeze(["jobs", "workers", "heavyweight_processes", "timers"]);
const STATE_KEYS = Object.freeze([
  "schema", "version", "campaign_id", "context_sha256", "roster_sha256", "candidate", "status", "wave_index",
  "pending_specialist_ids", "completed_specialist_ids", "active_lane_ids", "platform_review_batch", "accepted_platform_lane_ids",
  "final_review", "lane_policy", "authority", "next_action", "next_handler", "continuation", "continuation_sha256",
  "protected_event", "state_sha256",
]);

function assert(condition, message, code = "PYRAMID_CAMPAIGN_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable uppercase identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque or content-addressed reference`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function requireSortedReferences(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} are required`);
  values.forEach((value, index) => requireReference(value, `${label} ${index}`));
  sortedUnique(values, label);
}

function requireSortedIdentifiers(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} are required`);
  values.forEach((value, index) => requireIdentifier(value, `${label} ${index}`));
  sortedUnique(values, label);
}

function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

function validateContext(context) {
  exactKeys(context, CONTEXT_KEYS, "pyramid campaign context");
  for (const field of CONTEXT_KEYS.filter((key) => key !== "context_sha256")) requireSha(context[field], `pyramid ${field}`);
  requireSha(context.context_sha256, "pyramid context digest");
  assert(context.context_sha256 === digestWithout(context, "context_sha256"), "pyramid context digest mismatch");
  return context;
}

export function compilePyramidCampaignContext({architectureSha256, goalsSha256, hostSha256, environmentSha256} = {}) {
  const context = {
    architecture_sha256: architectureSha256,
    goals_sha256: goalsSha256,
    host_sha256: hostSha256,
    environment_sha256: environmentSha256,
    context_sha256: null,
  };
  context.context_sha256 = digestWithout(context, "context_sha256");
  return validateContext(context);
}

function validateSpecialistType(entry, index) {
  exactKeys(entry, SPECIALIST_TYPE_KEYS, `specialist type ${index}`);
  requireIdentifier(entry.specialist_id, `specialist type ${index} ID`);
  requireIdentifier(entry.role_kind, `specialist type ${index} role kind`);
  assert(entry.applicability === "APPLICABLE" || entry.applicability === "NOT_APPLICABLE", `specialist type ${index} applicability is invalid`);
  requireSha(entry.applicability_sha256, `specialist type ${index} applicability evidence`);
  assert(Array.isArray(entry.block_ids), `specialist type ${index} block IDs are required`);
  entry.block_ids.forEach((value, blockIndex) => requireIdentifier(value, `specialist type ${index} block ${blockIndex}`));
  sortedUnique(entry.block_ids, `specialist type ${index} block IDs`);
  if (entry.applicability === "APPLICABLE") assert(entry.block_ids.length > 0, `specialist type ${index} applicable route has no governing blocks`);
  requireSortedReferences(entry.source_refs, `specialist type ${index} source refs`);
  requireSha(entry.task_template_sha256, `specialist type ${index} task template`);
  return entry;
}

function validateSpecialist(entry, index) {
  exactKeys(entry, SPECIALIST_KEYS, `applicable specialist ${index}`);
  requireIdentifier(entry.specialist_id, `applicable specialist ${index} ID`);
  requireIdentifier(entry.role_kind, `applicable specialist ${index} role kind`);
  requireIdentifier(entry.lane_id, `applicable specialist ${index} lane ID`);
  assert(entry.lane_id === `SPECIALIST_LANE:${entry.specialist_id}`, `applicable specialist ${index} lane identity is not canonical`);
  requireSha(entry.applicability_sha256, `applicable specialist ${index} applicability evidence`);
  assert(Array.isArray(entry.block_ids) && entry.block_ids.length > 0, `applicable specialist ${index} governing blocks are required`);
  entry.block_ids.forEach((value, blockIndex) => requireIdentifier(value, `applicable specialist ${index} block ${blockIndex}`));
  sortedUnique(entry.block_ids, `applicable specialist ${index} block IDs`);
  requireSortedReferences(entry.source_refs, `applicable specialist ${index} source refs`);
  requireSha(entry.task_template_sha256, `applicable specialist ${index} task template`);
  return entry;
}

export function deriveApplicableSpecialistRoster({context, specialistTypes} = {}) {
  validateContext(context);
  assert(Array.isArray(specialistTypes), "project specialist type inventory is required");
  const candidates = specialistTypes.map((entry, index) => validateSpecialistType(entry, index));
  const candidateIds = candidates.map((entry) => entry.specialist_id);
  sortedUnique(candidateIds, "specialist type IDs");
  const specialists = candidates
    .filter((entry) => entry.applicability === "APPLICABLE")
    .map((entry) => ({
      specialist_id: entry.specialist_id,
      role_kind: entry.role_kind,
      lane_id: `SPECIALIST_LANE:${entry.specialist_id}`,
      applicability_sha256: entry.applicability_sha256,
      block_ids: [...entry.block_ids],
      source_refs: [...entry.source_refs],
      task_template_sha256: entry.task_template_sha256,
    }))
    .sort((left, right) => compareUtf8(left.specialist_id, right.specialist_id));
  const roster = {
    schema: PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA,
    version: PYRAMID_CAMPAIGN_GOVERNANCE_VERSION,
    context: structuredClone(context),
    specialists,
    applicable_specialist_ids: specialists.map((entry) => entry.specialist_id),
    roster_sha256: null,
  };
  roster.roster_sha256 = digestWithout(roster, "roster_sha256");
  return validatePyramidSpecialistRoster(roster);
}

export function validatePyramidSpecialistRoster(roster) {
  exactKeys(roster, ROSTER_KEYS, "pyramid specialist roster");
  assert(roster.schema === PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA && roster.version === PYRAMID_CAMPAIGN_GOVERNANCE_VERSION, "pyramid specialist roster identity is invalid");
  validateContext(roster.context);
  assert(Array.isArray(roster.specialists), "pyramid specialist roster entries are required");
  roster.specialists.forEach((entry, index) => validateSpecialist(entry, index));
  const ids = roster.specialists.map((entry) => entry.specialist_id);
  sortedUnique(ids, "applicable specialist IDs");
  assert(JSON.stringify(roster.applicable_specialist_ids) === JSON.stringify(ids), "applicable specialist ID projection is stale");
  requireSha(roster.roster_sha256, "pyramid roster digest");
  assert(roster.roster_sha256 === digestWithout(roster, "roster_sha256"), "pyramid roster digest mismatch");
  return roster;
}

function validateCandidate(candidate) {
  exactKeys(candidate, CANDIDATE_KEYS, "pyramid cumulative candidate");
  requireIdentifier(candidate.candidate_id, "pyramid candidate ID");
  requireSha(candidate.candidate_sha256, "pyramid candidate digest");
  requireReference(candidate.worktree_ref, "pyramid candidate worktree");
  requireReference(candidate.rollback_ref, "pyramid candidate rollback");
  assert(candidate.clean === true && candidate.source_roots_preserved === true, "pyramid candidate custody is not clean and source-preserving");
  assert(candidate.status === "PREPARED_ISOLATED_CANDIDATE" || candidate.status === "CUMULATIVE_CANDIDATE", "pyramid candidate status is invalid");
  return candidate;
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "pyramid lane custody");
  for (const key of ["isolated_worktree", "shared_workspace_read_only", "source_roots_preserved"]) assert(custody[key] === true, `pyramid lane custody ${key} is required`);
  for (const key of ["product_mutation", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "polling"]) assert(custody[key] === false, `pyramid lane crossed protected boundary: ${key}`);
  assert(Number.isSafeInteger(custody.heavyweight_processes) && custody.heavyweight_processes >= 0 && custody.heavyweight_processes <= PYRAMID_CAMPAIGN_MAX_HEAVYWEIGHT_PROCESSES, "pyramid heavyweight process policy is invalid");
  assert(Number.isSafeInteger(custody.timer_count) && custody.timer_count === 0, "pyramid lane timers are forbidden");
  return custody;
}

export function compilePyramidSpecialistHandoff({laneId, specialistId, waveIndex, taskRef, worktreeRef, baseCandidateSha256, findingSha256, repairCandidateSha256, evidenceSha256, hostileFixtureRefs, sourceBindingSha256, custody, rollbackRef} = {}) {
  const handoff = {
    schema: `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.handoff`,
    version: PYRAMID_CAMPAIGN_GOVERNANCE_VERSION,
    lane_id: laneId,
    specialist_id: specialistId,
    wave_index: waveIndex,
    task_ref: taskRef,
    worktree_ref: worktreeRef,
    base_candidate_sha256: baseCandidateSha256,
    finding_sha256: findingSha256,
    repair_candidate_sha256: repairCandidateSha256,
    evidence_sha256: evidenceSha256,
    hostile_fixture_refs: hostileFixtureRefs,
    source_binding_sha256: sourceBindingSha256,
    custody,
    rollback_ref: rollbackRef,
    status: "TYPED_FINDING_AND_REPAIR_READY",
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = digestWithout(handoff, "handoff_sha256");
  return validatePyramidSpecialistHandoff(handoff);
}

export function validatePyramidSpecialistHandoff(handoff) {
  exactKeys(handoff, HANDOFF_KEYS, "pyramid specialist handoff");
  assert(handoff.schema === `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.handoff` && handoff.version === PYRAMID_CAMPAIGN_GOVERNANCE_VERSION, "pyramid specialist handoff identity is invalid");
  requireIdentifier(handoff.lane_id, "pyramid handoff lane");
  requireIdentifier(handoff.specialist_id, "pyramid handoff specialist");
  assert(Number.isSafeInteger(handoff.wave_index) && handoff.wave_index >= 1, "pyramid handoff wave is invalid");
  requireReference(handoff.task_ref, "pyramid handoff task");
  requireReference(handoff.worktree_ref, "pyramid handoff worktree");
  for (const field of ["base_candidate_sha256", "finding_sha256", "repair_candidate_sha256", "evidence_sha256", "source_binding_sha256"]) requireSha(handoff[field], `pyramid handoff ${field}`);
  requireSortedIdentifiers(handoff.hostile_fixture_refs, "pyramid handoff hostile fixtures");
  validateCustody(handoff.custody);
  requireReference(handoff.rollback_ref, "pyramid handoff rollback");
  assert(handoff.status === "TYPED_FINDING_AND_REPAIR_READY", "pyramid handoff status is invalid");
  requireSha(handoff.handoff_sha256, "pyramid handoff digest");
  assert(handoff.handoff_sha256 === digestWithout(handoff, "handoff_sha256"), "pyramid handoff digest mismatch");
  return handoff;
}

export function compilePyramidPlatformReview({reviewId, laneId, handoffSha256, reviewerRole, accepted, reviewEvidenceSha256, cumulativeCandidateBeforeSha256, cumulativeCandidateAfterSha256, rollbackRef} = {}) {
  const review = {
    schema: `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.platform_review`,
    version: PYRAMID_CAMPAIGN_GOVERNANCE_VERSION,
    review_id: reviewId,
    lane_id: laneId,
    handoff_sha256: handoffSha256,
    reviewer_role: reviewerRole,
    accepted,
    integrated: accepted,
    review_evidence_sha256: reviewEvidenceSha256,
    cumulative_candidate_before_sha256: cumulativeCandidateBeforeSha256,
    cumulative_candidate_after_sha256: cumulativeCandidateAfterSha256,
    rollback_ref: rollbackRef,
    review_sha256: null,
  };
  review.review_sha256 = digestWithout(review, "review_sha256");
  return validatePyramidPlatformReview(review);
}

export function validatePyramidPlatformReview(review) {
  exactKeys(review, REVIEW_KEYS, "pyramid platform review");
  assert(review.schema === `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.platform_review` && review.version === PYRAMID_CAMPAIGN_GOVERNANCE_VERSION, "pyramid platform review identity is invalid");
  requireIdentifier(review.review_id, "pyramid platform review ID");
  requireIdentifier(review.lane_id, "pyramid platform review lane");
  requireSha(review.handoff_sha256, "pyramid platform review handoff");
  requireIdentifier(review.reviewer_role, "pyramid platform reviewer");
  assert(typeof review.accepted === "boolean" && review.integrated === review.accepted, "pyramid platform review acceptance/integration mismatch");
  requireSha(review.review_evidence_sha256, "pyramid platform review evidence");
  requireSha(review.cumulative_candidate_before_sha256, "pyramid platform review candidate before");
  requireSha(review.cumulative_candidate_after_sha256, "pyramid platform review candidate after");
  if (review.accepted) assert(review.cumulative_candidate_before_sha256 !== review.cumulative_candidate_after_sha256, "accepted platform review did not advance the cumulative candidate");
  else assert(review.cumulative_candidate_before_sha256 === review.cumulative_candidate_after_sha256, "rejected platform review changed the cumulative candidate");
  requireReference(review.rollback_ref, "pyramid platform review rollback");
  requireSha(review.review_sha256, "pyramid platform review digest");
  assert(review.review_sha256 === digestWithout(review, "review_sha256"), "pyramid platform review digest mismatch");
  return review;
}

function validateFinalReview(review, candidateSha256) {
  if (review === null) return null;
  exactKeys(review, FINAL_REVIEW_KEYS, "pyramid final coherence review");
  requireIdentifier(review.reviewer_role, "pyramid final reviewer");
  assert(review.reviewer_role === "FINAL_HIGHER_TIER_COHERENCE_POLISH_REVIEWER", "pyramid final reviewer is not the higher-tier coherence/polish role");
  requireSha(review.candidate_sha256, "pyramid final review candidate");
  assert(review.candidate_sha256 === candidateSha256, "pyramid final review candidate binding is stale");
  for (const field of ["coherence_evidence_sha256", "release_evidence_sha256", "residual_risk_sha256", "review_sha256"]) requireSha(review[field], `pyramid final review ${field}`);
  assert(review.accepted === true, "pyramid final coherence review must be accepted before protected handoff");
  assert(review.review_sha256 === digestWithout(review, "review_sha256"), "pyramid final review digest mismatch");
  return review;
}

function compileProtectedEvent(protectedEvent) {
  const event = protectedEvent ?? {
    blocker_id: "PROTECTED.PRODUCT_MUTATION.CENTRAL_INTEGRATION_AUTHORITY",
    blocker_class: "MAJOR_PRODUCT_OR_PRODUCTION_DECISION",
    evidence_ceiling: "Static typed findings, accepted platform handoffs, and isolated cumulative-candidate metadata only; no Product mutation or release evidence is inferred.",
    restart_event: "CURRENT_TYPED_CENTRAL_INTEGRATION_AUTHORIZATION_OR_EXPLICIT_OWNER_RESUMPTION",
    resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
  };
  exactKeys(event, PROTECTED_EVENT_KEYS, "pyramid protected event");
  requireIdentifier(event.blocker_id, "pyramid protected blocker");
  assert(["CREDENTIAL_OR_AUTHENTICATION", "IRREVERSIBLE_DESTRUCTIVE_USER_WORK", "MAJOR_PRODUCT_OR_PRODUCTION_DECISION", "MATERIAL_SPEND_OR_FINANCIAL_AUTHORITY", "PROTECTED_EXTERNAL_DEPENDENCY"].includes(event.blocker_class), "pyramid protected blocker class is invalid");
  assert(typeof event.evidence_ceiling === "string" && event.evidence_ceiling.length >= 24, "pyramid protected evidence ceiling is incomplete");
  assert(typeof event.restart_event === "string" && event.restart_event.length >= 8, "pyramid protected restart event is incomplete");
  exactKeys(event.resources, RESOURCE_KEYS, "pyramid protected resources");
  for (const key of RESOURCE_KEYS) assert(event.resources[key] === 0, `pyramid protected resource ${key} must be zero`);
  return event;
}

function validateLanePolicy(policy) {
  exactKeys(policy, LANE_POLICY_KEYS, "pyramid lane policy");
  assert(policy.max_active_lanes === PYRAMID_CAMPAIGN_MAX_LANES, "pyramid lane cap must be six");
  assert(policy.max_heavyweight_processes === PYRAMID_CAMPAIGN_MAX_HEAVYWEIGHT_PROCESSES, "pyramid heavyweight cap must be one");
  assert(Number.isSafeInteger(policy.heavyweight_processes) && policy.heavyweight_processes >= 0 && policy.heavyweight_processes <= policy.max_heavyweight_processes, "pyramid heavyweight count is invalid");
  assert(policy.timers === 0 && policy.polling === false, "pyramid timer/polling policy is weakened");
  return policy;
}

function validateAuthority(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "pyramid campaign authority");
  for (const field of ["roster_derivation", "wave_routing", "isolated_audit_admission", "platform_review_routing", "cumulative_candidate_write"]) assert(authority[field] === true, `pyramid authority ${field} is required`);
  for (const field of ["central_integration", "product_mutation", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "release"]) assert(authority[field] === false, `pyramid authority crossed protected boundary: ${field}`);
  return authority;
}

const PYRAMID_AUTHORITY = Object.freeze({
  roster_derivation: true,
  wave_routing: true,
  isolated_audit_admission: true,
  platform_review_routing: true,
  cumulative_candidate_write: true,
  central_integration: false,
  product_mutation: false,
  provider_access: false,
  credential_access: false,
  external_sync: false,
  spend: false,
  destructive_work: false,
  release: false,
});

function compileRoute(nextAction, protectedEvent = null) {
  assert(PYRAMID_CAMPAIGN_ACTIONS.includes(nextAction), `pyramid action is outside the closed campaign route: ${nextAction}`);
  const nextHandler = controllerActionHandlerFor(nextAction);
  const continuation = compileControllerContinuation(nextAction, {protectedEventId: protectedEvent?.blocker_id ?? null});
  return {next_action: nextAction, next_handler: nextHandler, continuation, continuation_sha256: controllerContinuationDigest(continuation)};
}

function validateRoute(state) {
  const route = compileRoute(state.next_action, state.protected_event);
  assert(state.next_handler === route.next_handler, "pyramid next handler is stale");
  assert(JSON.stringify(state.continuation) === JSON.stringify(route.continuation), "pyramid continuation is stale");
  requireSha(state.continuation_sha256, "pyramid continuation digest");
  assert(state.continuation_sha256 === route.continuation_sha256, "pyramid continuation digest mismatch");
}

function validateStateArrays(state, roster) {
  const ids = roster.applicable_specialist_ids;
  for (const [field, values] of [["pending specialist IDs", state.pending_specialist_ids], ["completed specialist IDs", state.completed_specialist_ids], ["active lane IDs", state.active_lane_ids]]) {
    assert(Array.isArray(values), `pyramid ${field} are required`);
    sortedUnique(values, `pyramid ${field}`);
  }
  assert(state.active_lane_ids.length <= PYRAMID_CAMPAIGN_MAX_LANES, "pyramid wave exceeds six lanes");
  const activeSpecialistIds = new Set(state.active_lane_ids.map((laneId) => laneId.replace(/^SPECIALIST_LANE:/u, "")));
  for (const id of [...state.pending_specialist_ids, ...state.completed_specialist_ids]) assert(ids.includes(id), `pyramid state references unknown specialist ${id}`);
  for (const laneId of state.active_lane_ids) assert(activeSpecialistIds.has(laneId.replace(/^SPECIALIST_LANE:/u, "")) && ids.includes(laneId.replace(/^SPECIALIST_LANE:/u, "")), `pyramid state references unknown active lane ${laneId}`);
  const pendingSet = new Set(state.pending_specialist_ids);
  const completedSet = new Set(state.completed_specialist_ids);
  assert([...completedSet].every((id) => !pendingSet.has(id)), "pyramid completed specialist remains pending");
  assert([...activeSpecialistIds].every((id) => pendingSet.has(id)), "pyramid active lane is not pending");
  assert(pendingSet.size + completedSet.size === ids.length, "pyramid specialist counts do not cover the roster");
}

export function validatePyramidCampaignState(state, {roster} = {}) {
  exactKeys(state, STATE_KEYS, "pyramid campaign state");
  assert(state.schema === PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA && state.version === PYRAMID_CAMPAIGN_GOVERNANCE_VERSION, "pyramid campaign state identity is invalid");
  requireIdentifier(state.campaign_id, "pyramid campaign ID");
  requireSha(state.context_sha256, "pyramid state context");
  requireSha(state.roster_sha256, "pyramid state roster");
  validateCandidate(state.candidate);
  assert(PYRAMID_CAMPAIGN_STATUSES.includes(state.status), "pyramid campaign status is invalid");
  assert(Number.isSafeInteger(state.wave_index) && state.wave_index >= 0, "pyramid campaign wave index is invalid");
  if (roster !== undefined) {
    validatePyramidSpecialistRoster(roster);
    assert(state.context_sha256 === roster.context.context_sha256, "pyramid state context binding is stale");
    assert(state.roster_sha256 === roster.roster_sha256, "pyramid state roster binding is stale");
    validateStateArrays(state, roster);
  }
  assert(Array.isArray(state.platform_review_batch), "pyramid platform review batch is required");
  state.platform_review_batch.forEach((handoff) => validatePyramidSpecialistHandoff(handoff));
  sortedUnique(state.platform_review_batch.map((handoff) => handoff.lane_id), "pyramid platform review batch lanes");
  assert(state.platform_review_batch.length <= PYRAMID_CAMPAIGN_MAX_LANES, "pyramid platform review batch exceeds six lanes");
  assert(Array.isArray(state.accepted_platform_lane_ids), "pyramid accepted platform lanes are required");
  sortedUnique(state.accepted_platform_lane_ids, "pyramid accepted platform lanes");
  state.accepted_platform_lane_ids.forEach((laneId) => requireIdentifier(laneId, "pyramid accepted platform lane"));
  validateFinalReview(state.final_review, state.candidate.candidate_sha256);
  validateLanePolicy(state.lane_policy);
  validateAuthority(state.authority);
  if (state.status === "PROTECTED_WAIT") {
    assert(state.next_action === "WAIT_FOR_PROTECTED_EVENT" && state.protected_event !== null, "pyramid protected wait is not explicit");
    compileProtectedEvent(state.protected_event);
  } else assert(state.protected_event === null, "pyramid non-protected state carries a protected event");
  validateRoute(state);
  requireSha(state.state_sha256, "pyramid state digest");
  assert(state.state_sha256 === digestWithout(state, "state_sha256"), "pyramid state digest mismatch");
  return state;
}

export function compilePyramidCampaignState({campaignId, roster, candidateId, candidateSha256, worktreeRef, rollbackRef, initialProtectedWait = false, protectedEvent = null} = {}) {
  validatePyramidSpecialistRoster(roster);
  requireIdentifier(campaignId, "pyramid campaign ID");
  const candidate = {
    candidate_id: candidateId,
    candidate_sha256: candidateSha256,
    worktree_ref: worktreeRef,
    rollback_ref: rollbackRef,
    clean: true,
    source_roots_preserved: true,
    status: "PREPARED_ISOLATED_CANDIDATE",
  };
  validateCandidate(candidate);
  const shouldWait = initialProtectedWait === true;
  const route = shouldWait ? compileRoute("WAIT_FOR_PROTECTED_EVENT", compileProtectedEvent(protectedEvent)) : compileRoute(roster.applicable_specialist_ids.length === 0 ? "PREPARE_CANDIDATE_REVIEW" : "START_SPECIALIST_WAVE");
  const state = {
    schema: PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA,
    version: PYRAMID_CAMPAIGN_GOVERNANCE_VERSION,
    campaign_id: campaignId,
    context_sha256: roster.context.context_sha256,
    roster_sha256: roster.roster_sha256,
    candidate,
    status: shouldWait ? "PROTECTED_WAIT" : (roster.applicable_specialist_ids.length === 0 ? "FINAL_REVIEW_PENDING" : "PREPARED"),
    wave_index: 0,
    pending_specialist_ids: [...roster.applicable_specialist_ids],
    completed_specialist_ids: [],
    active_lane_ids: [],
    platform_review_batch: [],
    accepted_platform_lane_ids: [],
    final_review: null,
    lane_policy: {max_active_lanes: PYRAMID_CAMPAIGN_MAX_LANES, max_heavyweight_processes: PYRAMID_CAMPAIGN_MAX_HEAVYWEIGHT_PROCESSES, heavyweight_processes: 0, timers: 0, polling: false},
    authority: structuredClone(PYRAMID_AUTHORITY),
    next_action: route.next_action,
    next_handler: route.next_handler,
    continuation: route.continuation,
    continuation_sha256: route.continuation_sha256,
    protected_event: shouldWait ? compileProtectedEvent(protectedEvent) : null,
    state_sha256: null,
  };
  state.state_sha256 = digestWithout(state, "state_sha256");
  return validatePyramidCampaignState(state, {roster});
}

function cloneState(state) {
  return structuredClone(state);
}

function finishState(next, {status, nextAction, protectedEvent = null} = {}) {
  const route = compileRoute(nextAction, protectedEvent);
  next.status = status;
  next.next_action = route.next_action;
  next.next_handler = route.next_handler;
  next.continuation = route.continuation;
  next.continuation_sha256 = route.continuation_sha256;
  next.protected_event = protectedEvent;
  next.state_sha256 = digestWithout(next, "state_sha256");
  return next;
}

export function advancePyramidCampaign(state, {roster, event, handoffs = [], reviews = [], finalReview = null, protectedEvent = null} = {}) {
  validatePyramidCampaignState(state, {roster});
  const next = cloneState(state);
  if (event === "SPECIALIST_WAVE_HANDOFFS_READY") {
    assert(state.next_action === "START_SPECIALIST_WAVE", "pyramid wave handoff is not the current successor");
    const expectedIds = state.pending_specialist_ids.slice(0, PYRAMID_CAMPAIGN_MAX_LANES);
    assert(expectedIds.length > 0, "pyramid cannot start an empty specialist wave");
    assert(Array.isArray(handoffs) && handoffs.length === expectedIds.length, "pyramid wave must return one typed handoff per selected specialist");
    const ordered = [...handoffs].sort((left, right) => compareUtf8(left.lane_id, right.lane_id));
    ordered.forEach((handoff) => validatePyramidSpecialistHandoff(handoff));
    assert(new Set(ordered.map((handoff) => handoff.lane_id)).size === ordered.length, "pyramid wave handoffs are duplicated");
    assert(JSON.stringify(ordered.map((handoff) => handoff.specialist_id).sort(compareUtf8)) === JSON.stringify([...expectedIds].sort(compareUtf8)), "pyramid wave handoffs do not cover the selected applicable specialists");
    assert(ordered.every((handoff) => handoff.wave_index === state.wave_index + 1 && handoff.base_candidate_sha256 === state.candidate.candidate_sha256), "pyramid wave handoff baseline is stale");
    next.wave_index += 1;
    next.active_lane_ids = ordered.map((handoff) => handoff.lane_id).sort(compareUtf8);
    next.platform_review_batch = ordered;
    return finishState(next, {status: "PLATFORM_REVIEW_PENDING", nextAction: "START_PLATFORM_REVIEW"});
  }
  if (event === "PLATFORM_REVIEW_COMPLETED") {
    assert(state.next_action === "START_PLATFORM_REVIEW", "pyramid platform review is not the current successor");
    assert(Array.isArray(reviews) && reviews.length === state.platform_review_batch.length && reviews.length > 0, "pyramid platform review must cover the complete typed handoff batch");
    const handoffByLane = new Map(state.platform_review_batch.map((handoff) => [handoff.lane_id, handoff]));
    const ordered = [...reviews].sort((left, right) => compareUtf8(left.lane_id, right.lane_id));
    ordered.forEach((review) => validatePyramidPlatformReview(review));
    assert(new Set(ordered.map((review) => review.lane_id)).size === ordered.length, "pyramid platform reviews are duplicated");
    assert(JSON.stringify(ordered.map((review) => review.lane_id)) === JSON.stringify([...handoffByLane.keys()].sort(compareUtf8)), "pyramid platform reviews do not cover the typed handoff batch");
    let candidateSha256 = state.candidate.candidate_sha256;
    const accepted = [];
    for (const review of ordered) {
      const handoff = handoffByLane.get(review.lane_id);
      assert(review.handoff_sha256 === handoff.handoff_sha256, "pyramid platform review is bound to the wrong handoff");
      assert(review.cumulative_candidate_before_sha256 === candidateSha256, "pyramid platform reviews are not chained to the cumulative candidate");
      if (review.accepted) {
        candidateSha256 = review.cumulative_candidate_after_sha256;
        accepted.push(review.lane_id);
      }
    }
    const batchSpecialistIds = state.platform_review_batch.map((handoff) => handoff.specialist_id);
    next.pending_specialist_ids = next.pending_specialist_ids.filter((id) => !accepted.includes(`SPECIALIST_LANE:${id}`));
    next.completed_specialist_ids = [...next.completed_specialist_ids, ...batchSpecialistIds.filter((id) => accepted.includes(`SPECIALIST_LANE:${id}`))].sort(compareUtf8);
    next.accepted_platform_lane_ids = [...new Set([...next.accepted_platform_lane_ids, ...accepted])].sort(compareUtf8);
    next.active_lane_ids = [];
    next.platform_review_batch = [];
    next.candidate.candidate_sha256 = candidateSha256;
    next.candidate.status = "CUMULATIVE_CANDIDATE";
    return finishState(next, next.pending_specialist_ids.length > 0
      ? {status: "PREPARED", nextAction: "START_SPECIALIST_WAVE"}
      : {status: "FINAL_REVIEW_PENDING", nextAction: "PREPARE_CANDIDATE_REVIEW"});
  }
  if (event === "FINAL_REVIEW_COMPLETED") {
    assert(state.next_action === "PREPARE_CANDIDATE_REVIEW", "pyramid final review is not the current successor");
    assert(state.pending_specialist_ids.length === 0 && state.active_lane_ids.length === 0 && state.platform_review_batch.length === 0, "pyramid final review cannot start before all applicable specialist lanes are covered");
    validateFinalReview(finalReview, state.candidate.candidate_sha256);
    next.final_review = structuredClone(finalReview);
    return finishState(next, {status: "PROTECTED_WAIT", nextAction: "WAIT_FOR_PROTECTED_EVENT", protectedEvent: compileProtectedEvent(protectedEvent)});
  }
  assert(false, `Unsupported pyramid campaign event: ${event}`);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("pyramid campaign governance loaded\n");
