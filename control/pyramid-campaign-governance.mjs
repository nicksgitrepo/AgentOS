#!/usr/bin/env node

/*
 * Project-agnostic pyramid campaign governance.
 *
 * The Spawner supplies typed specialist candidates from architecture, goals,
 * host, and environment evidence.  The Orchestrator advances one bounded
 * audit/repair wave at a time, never more than six lanes, and platform review
 * changes only the isolated cumulative candidate when a typed handoff is
 * accepted.  The final coherence/polish route assembles an isolated
 * candidate, dispatches an independent re-audit, and only then reaches the
 * protected runtime cutover/release boundary. Candidate assembly and
 * re-audit are ordinary project-agnostic work and must not become a silent
 * wait.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  controllerActionHandlerFor,
  compileControllerContinuation,
  controllerContinuationDigest,
} from "./controller-action-dispatcher.mjs";
import {
  compileStopWorkflowNoStopAnswers,
  evaluateStopWorkflowGate,
  validateStopWorkflowDecision,
} from "./stop-workflow-gate.mjs";
import {
  compileCandidateScopeGate,
  CANDIDATE_SCOPE_MODES,
} from "./candidate-scope-gate.mjs";
import {validatePyramidImportOutput} from "./project-import.mjs";

export const PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA = "agentos.pyramid_campaign_governance.v1";
export const PYRAMID_CAMPAIGN_GOVERNANCE_VERSION = 1;
export const PYRAMID_CAMPAIGN_MAX_LANES = 6;
export const PYRAMID_CAMPAIGN_MAX_HEAVYWEIGHT_PROCESSES = 1;
export const PYRAMID_LOCAL_PROOF_STEP_IDS = Object.freeze([
  "AUDIT_REPAIR_INTEGRATION_PREPARATION",
  "PROVE_LOCAL_BUILD_AND_TEST",
  "PROVE_LOCAL_INSTALLATION",
  "REPLAY_DEPENDENCY_CLOSURE_OFFLINE",
  "REPLAY_SAFE_PROVENANCE",
  "ZERO_TRACE_ROLLBACK_AND_UNINSTALL_PROOF",
]);
export const PYRAMID_CAMPAIGN_ACTIONS = Object.freeze([
  "START_SPECIALIST_WAVE",
  "START_PLATFORM_REVIEW",
  "PREPARE_CANDIDATE_REVIEW",
  "ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE",
  "START_INDEPENDENT_REAUDIT",
  "PREPARE_PYRAMID_IMPORT_OUTPUT",
  "MATERIALIZE_NEW_PROJECT_REPOSITORIES",
  "RUNTIME_ATOMIC_GIT_REPOINT",
  "RUN_LOCAL_CANDIDATE_PROOF",
  "WAIT_FOR_PROTECTED_EVENT",
]);
export const PYRAMID_CAMPAIGN_STATUSES = Object.freeze([
  "PREPARED",
  "PLATFORM_REVIEW_PENDING",
  "FINAL_REVIEW_PENDING",
  "CANDIDATE_ASSEMBLY_PENDING",
  "INDEPENDENT_REAUDIT_PENDING",
  "IMPORT_OUTPUT_PENDING",
  "CANDIDATE_REPOSITORIES_PENDING",
  "CANDIDATE_CUTOVER_PENDING",
  "LOCAL_PROOF_PENDING",
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
const INDEPENDENT_REAUDIT_KEYS = Object.freeze([
  "reviewer_role", "candidate_sha256", "evidence_sha256", "residual_risk_sha256", "accepted", "reaudit_sha256",
]);
const ISOLATED_CANDIDATE_ASSEMBLY_KEYS = Object.freeze([
  "schema", "version", "candidate_id", "base_candidate_sha256", "assembled_candidate_sha256", "worktree_ref", "rollback_ref",
  "source_roots_preserved", "zero_trace", "custody", "proof_refs", "status", "assembly_sha256",
]);
const ISOLATED_CANDIDATE_CUSTODY_KEYS = Object.freeze([
  "isolated_worktree", "shared_workspace_read_only", "source_roots_preserved", "product_mutation", "provider_access",
  "credential_access", "external_sync", "spend", "destructive_work", "deployment_publication_merge", "release",
  "heavyweight_processes", "timer_count", "polling",
]);
const CANDIDATE_MATERIALIZATION_KEYS = Object.freeze([
  "schema", "version", "materialization_id", "pyramid_output_sha256", "candidate_repository_ids", "destination_root_ref",
  "legacy_policy", "source_roots_preserved", "product_mutation", "provider_access", "credential_access", "external_sync",
  "spend", "destructive_work", "clean_candidate", "status", "rollback_ref", "evidence_refs", "materialization_sha256",
]);
const DEVELOPMENT_CUTOVER_KEYS = Object.freeze([
  "schema", "version", "result_id", "materialization_sha256", "target_root_ref", "rollback_ref",
  "source_roots_preserved", "legacy_roots_untouched", "product_mutation", "provider_access", "credential_access",
  "external_sync", "spend", "destructive_work", "clean_target", "status", "evidence_refs", "result_sha256",
]);
const LOCAL_PROOF_STEP_KEYS = Object.freeze(["step_id", "status", "disposition", "evidence_refs"]);
const LOCAL_CANDIDATE_PROOF_KEYS = Object.freeze([
  "schema", "version", "materialization_sha256", "development_cutover_result_sha256", "target_root_ref", "rollback_ref",
  "steps", "source_roots_preserved", "legacy_roots_untouched", "product_mutation", "provider_access", "credential_access",
  "external_sync", "spend", "destructive_work", "clean_target", "proof_sha256",
]);
const LANE_POLICY_KEYS = Object.freeze([
  "max_active_lanes", "max_heavyweight_processes", "heavyweight_processes", "timers", "polling",
]);
const AUTHORITY_KEYS = Object.freeze([
  "roster_derivation", "wave_routing", "isolated_audit_admission", "platform_review_routing", "cumulative_candidate_write",
  "central_integration", "product_mutation", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "release",
]);
const PROTECTED_EVENT_KEYS = Object.freeze([
  "blocker_id", "blocker_class", "affected_action", "evidence_ceiling", "restart_event", "resources",
]);
const RESOURCE_KEYS = Object.freeze(["jobs", "workers", "heavyweight_processes", "timers"]);
const SOURCE_SCOPE_KEYS = Object.freeze(["required_repository_ids", "opaque_repository_ids", "source_mapping_sha256", "scope_sha256"]);
const STATE_KEYS = Object.freeze([
  "schema", "version", "campaign_id", "context_sha256", "roster_sha256", "candidate", "status", "wave_index",
  "pending_specialist_ids", "completed_specialist_ids", "active_lane_ids", "platform_review_batch", "accepted_platform_lane_ids",
  "final_review", "isolated_candidate_assembly", "independent_reaudit", "lane_policy", "authority", "next_action", "next_handler", "continuation", "continuation_sha256",
  "source_scope", "pyramid_import_output", "protected_event", "stop_workflow_decision", "state_sha256",
  "candidate_materialization", "development_cutover", "local_candidate_proof",
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

const REPOSITORY_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,191}$/u;

function requireSortedRepositoryIds(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values) && (allowEmpty || values.length > 0), `${label} are required`);
  values.forEach((value, index) => assert(typeof value === "string" && REPOSITORY_ID.test(value), `${label} ${index} is invalid`));
  sortedUnique(values, label);
}

function validateSourceScope(sourceScope) {
  exactKeys(sourceScope, SOURCE_SCOPE_KEYS, "pyramid source scope");
  requireSortedRepositoryIds(sourceScope.required_repository_ids, "pyramid source scope required repository IDs");
  requireSortedRepositoryIds(sourceScope.opaque_repository_ids, "pyramid source scope opaque repository IDs", {allowEmpty: true});
  assert(sourceScope.opaque_repository_ids.every((value) => sourceScope.required_repository_ids.includes(value)), "pyramid source scope opaque repository is unbound");
  requireSha(sourceScope.source_mapping_sha256, "pyramid source mapping");
  requireSha(sourceScope.scope_sha256, "pyramid source scope digest");
  assert(sourceScope.scope_sha256 === digestWithout(sourceScope, "scope_sha256"), "pyramid source scope digest mismatch");
  return sourceScope;
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

function validateIndependentReaudit(reaudit, candidateSha256) {
  if (reaudit === null) return null;
  exactKeys(reaudit, INDEPENDENT_REAUDIT_KEYS, "pyramid independent re-audit");
  requireIdentifier(reaudit.reviewer_role, "pyramid independent re-audit reviewer");
  assert(reaudit.reviewer_role === "INDEPENDENT_CANDIDATE_REAUDITOR", "pyramid independent re-audit role is invalid");
  requireSha(reaudit.candidate_sha256, "pyramid independent re-audit candidate");
  assert(reaudit.candidate_sha256 === candidateSha256, "pyramid independent re-audit candidate binding is stale");
  requireSha(reaudit.evidence_sha256, "pyramid independent re-audit evidence");
  requireSha(reaudit.residual_risk_sha256, "pyramid independent re-audit residual risk");
  assert(reaudit.accepted === true, "pyramid independent re-audit must be accepted");
  requireSha(reaudit.reaudit_sha256, "pyramid independent re-audit digest");
  assert(reaudit.reaudit_sha256 === digestWithout(reaudit, "reaudit_sha256"), "pyramid independent re-audit digest mismatch");
  return reaudit;
}

function validateIsolatedCandidateCustody(custody) {
  exactKeys(custody, ISOLATED_CANDIDATE_CUSTODY_KEYS, "pyramid isolated candidate custody");
  for (const key of ["isolated_worktree", "shared_workspace_read_only", "source_roots_preserved"]) {
    assert(custody[key] === true, `pyramid isolated candidate custody ${key} is required`);
  }
  for (const key of ["product_mutation", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "deployment_publication_merge", "release", "polling"]) {
    assert(custody[key] === false, `pyramid isolated candidate crossed protected boundary: ${key}`);
  }
  assert(Number.isSafeInteger(custody.heavyweight_processes) && custody.heavyweight_processes === 0, "pyramid isolated candidate heavyweight processes must be zero");
  assert(Number.isSafeInteger(custody.timer_count) && custody.timer_count === 0, "pyramid isolated candidate timers must be zero");
  return custody;
}

function isolatedCandidateContentDigest(assembly) {
  return canonicalDigest({
    candidate_id: assembly.candidate_id,
    base_candidate_sha256: assembly.base_candidate_sha256,
    worktree_ref: assembly.worktree_ref,
    rollback_ref: assembly.rollback_ref,
    source_roots_preserved: assembly.source_roots_preserved,
    zero_trace: assembly.zero_trace,
    custody: assembly.custody,
    proof_refs: assembly.proof_refs,
  });
}

export function compilePyramidIsolatedCandidateAssembly({candidate, proofRefs, custody, zeroTrace = true} = {}) {
  validateCandidate(candidate);
  const assembly = {
    schema: `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.isolated_candidate_assembly`,
    version: PYRAMID_CAMPAIGN_GOVERNANCE_VERSION,
    candidate_id: candidate.candidate_id,
    base_candidate_sha256: candidate.candidate_sha256,
    assembled_candidate_sha256: null,
    worktree_ref: candidate.worktree_ref,
    rollback_ref: candidate.rollback_ref,
    source_roots_preserved: candidate.source_roots_preserved,
    zero_trace: zeroTrace,
    custody,
    proof_refs: proofRefs,
    status: "ISOLATED_CUMULATIVE_CANDIDATE_ASSEMBLED",
    assembly_sha256: null,
  };
  assembly.assembled_candidate_sha256 = isolatedCandidateContentDigest(assembly);
  assembly.assembly_sha256 = digestWithout(assembly, "assembly_sha256");
  return validatePyramidIsolatedCandidateAssembly(assembly);
}

export function validatePyramidIsolatedCandidateAssembly(assembly) {
  exactKeys(assembly, ISOLATED_CANDIDATE_ASSEMBLY_KEYS, "pyramid isolated candidate assembly");
  assert(assembly.schema === `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.isolated_candidate_assembly` && assembly.version === PYRAMID_CAMPAIGN_GOVERNANCE_VERSION, "pyramid isolated candidate assembly identity is invalid");
  requireIdentifier(assembly.candidate_id, "pyramid isolated candidate ID");
  requireSha(assembly.base_candidate_sha256, "pyramid isolated candidate base");
  requireSha(assembly.assembled_candidate_sha256, "pyramid isolated candidate assembled digest");
  requireReference(assembly.worktree_ref, "pyramid isolated candidate worktree");
  requireReference(assembly.rollback_ref, "pyramid isolated candidate rollback");
  assert(assembly.source_roots_preserved === true, "pyramid isolated candidate source roots must be preserved");
  assert(assembly.zero_trace === true, "pyramid isolated candidate must have zero protected trace");
  validateIsolatedCandidateCustody(assembly.custody);
  requireSortedReferences(assembly.proof_refs, "pyramid isolated candidate proof refs");
  assert(assembly.status === "ISOLATED_CUMULATIVE_CANDIDATE_ASSEMBLED", "pyramid isolated candidate assembly status is invalid");
  assert(assembly.assembled_candidate_sha256 === isolatedCandidateContentDigest(assembly), "pyramid isolated candidate digest mismatch");
  requireSha(assembly.assembly_sha256, "pyramid isolated candidate assembly digest");
  assert(assembly.assembly_sha256 === digestWithout(assembly, "assembly_sha256"), "pyramid isolated candidate assembly receipt digest mismatch");
  return assembly;
}

function candidateMaterializationBody(materialization) {
  return {...materialization, materialization_sha256: null};
}

function validateCandidateMaterialization(materialization, {pyramidImportOutput = null} = {}) {
  exactKeys(materialization, CANDIDATE_MATERIALIZATION_KEYS, "pyramid candidate materialization");
  assert(materialization.schema === `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.candidate_materialization` && materialization.version === PYRAMID_CAMPAIGN_GOVERNANCE_VERSION, "pyramid candidate materialization identity is invalid");
  requireIdentifier(materialization.materialization_id, "pyramid candidate materialization ID");
  requireSha(materialization.pyramid_output_sha256, "pyramid candidate materialization output binding");
  requireSortedRepositoryIds(materialization.candidate_repository_ids, "pyramid candidate materialization repositories");
  requireReference(materialization.destination_root_ref, "pyramid candidate materialization destination");
  assert(materialization.legacy_policy === "RETAIN_LEGACY_REPOSITORIES_UNTOUCHED", "pyramid candidate materialization legacy policy is unsafe");
  for (const field of ["source_roots_preserved", "product_mutation", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "clean_candidate"]) assert(typeof materialization[field] === "boolean", `pyramid candidate materialization ${field} is invalid`);
  assert(materialization.source_roots_preserved === true && materialization.product_mutation === false && materialization.provider_access === false
    && materialization.credential_access === false && materialization.external_sync === false && materialization.spend === false
    && materialization.destructive_work === false && materialization.clean_candidate === true, "pyramid candidate materialization crossed a protected boundary");
  assert(["READY_FOR_LOCAL_MATERIALIZATION", "MATERIALIZED_CANDIDATE_REPOSITORIES"].includes(materialization.status), "pyramid candidate materialization status is invalid");
  requireReference(materialization.rollback_ref, "pyramid candidate materialization rollback");
  requireSortedReferences(materialization.evidence_refs, "pyramid candidate materialization evidence refs");
  requireSha(materialization.materialization_sha256, "pyramid candidate materialization digest");
  assert(materialization.materialization_sha256 === canonicalDigest(candidateMaterializationBody(materialization)), "pyramid candidate materialization digest mismatch");
  if (pyramidImportOutput !== null) {
    validatePyramidImportOutput(pyramidImportOutput);
    assert(materialization.pyramid_output_sha256 === pyramidImportOutput.output_sha256, "pyramid candidate materialization output is stale");
    assert(JSON.stringify(materialization.candidate_repository_ids) === JSON.stringify(pyramidImportOutput.candidate_repositories.map((repository) => repository.repository_id)), "pyramid candidate materialization repositories are stale");
    assert(materialization.rollback_ref === pyramidImportOutput.git_repoint.rollback_ref, "pyramid candidate materialization rollback is stale");
  }
  return materialization;
}

function validateDevelopmentCutoverResult(result, {materialization = null} = {}) {
  exactKeys(result, DEVELOPMENT_CUTOVER_KEYS, "pyramid development cutover result");
  assert(result.schema === `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.development_cutover`, "pyramid development cutover result schema is invalid");
  assert(result.version === PYRAMID_CAMPAIGN_GOVERNANCE_VERSION, "pyramid development cutover result version is invalid");
  requireIdentifier(result.result_id, "pyramid development cutover result ID");
  requireSha(result.materialization_sha256, "pyramid development cutover materialization binding");
  requireReference(result.target_root_ref, "pyramid development cutover target");
  requireReference(result.rollback_ref, "pyramid development cutover rollback");
  for (const field of ["source_roots_preserved", "legacy_roots_untouched", "product_mutation", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "clean_target"]) {
    assert(typeof result[field] === "boolean", `pyramid development cutover ${field} is invalid`);
  }
  assert(result.source_roots_preserved === true && result.legacy_roots_untouched === true && result.product_mutation === false
    && result.provider_access === false && result.credential_access === false && result.external_sync === false
    && result.spend === false && result.destructive_work === false && result.clean_target === true, "pyramid development cutover crossed a protected boundary");
  assert(result.status === "DEVELOPMENT_CANDIDATE_CUTOVER_COMPLETE", "pyramid development cutover result is incomplete");
  requireSortedReferences(result.evidence_refs, "pyramid development cutover evidence refs");
  requireSha(result.result_sha256, "pyramid development cutover result digest");
  assert(result.result_sha256 === digestWithout(result, "result_sha256"), "pyramid development cutover result digest mismatch");
  if (materialization !== null) {
    assert(result.materialization_sha256 === materialization.materialization_sha256, "pyramid development cutover materialization binding is stale");
    assert(result.rollback_ref === materialization.rollback_ref, "pyramid development cutover rollback is stale");
  }
  return result;
}

function validateLocalProofStep(step, expectedStepId) {
  exactKeys(step, LOCAL_PROOF_STEP_KEYS, `pyramid local proof step ${expectedStepId}`);
  assert(step.step_id === expectedStepId, `pyramid local proof step ${expectedStepId} is missing or out of order`);
  assert(step.status === "PASS" || step.status === "NOT_APPLICABLE", `pyramid local proof step ${expectedStepId} status is invalid`);
  assert(typeof step.disposition === "string" && step.disposition.trim().length >= 16, `pyramid local proof step ${expectedStepId} disposition is too short`);
  if (step.status === "NOT_APPLICABLE") {
    const allowedPrefix = expectedStepId === "PROVE_LOCAL_INSTALLATION" || expectedStepId === "ZERO_TRACE_ROLLBACK_AND_UNINSTALL_PROOF"
      ? /^(?:EXCLUDED_BY_BOUND_SCOPE|NO_INSTALL_SURFACE):\s/u
      : /^EXCLUDED_BY_BOUND_SCOPE:\s/u;
    assert(allowedPrefix.test(step.disposition), `pyramid local proof step ${expectedStepId} NOT_APPLICABLE requires an explicit bound-scope reason`);
    assert(!/\b(?:not executed|not run|unexecuted|missing execution|skipped)\b/iu.test(step.disposition), `pyramid local proof step ${expectedStepId} cannot relabel an unexecuted check as NOT_APPLICABLE`);
  }
  requireSortedReferences(step.evidence_refs, `pyramid local proof step ${expectedStepId} evidence refs`);
  return step;
}

export function validatePyramidLocalCandidateProof(proof, {materialization = null, developmentCutover = null} = {}) {
  exactKeys(proof, LOCAL_CANDIDATE_PROOF_KEYS, "pyramid local candidate proof");
  assert(proof.schema === `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.local_candidate_proof` && proof.version === PYRAMID_CAMPAIGN_GOVERNANCE_VERSION, "pyramid local candidate proof identity is invalid");
  requireSha(proof.materialization_sha256, "pyramid local candidate proof materialization binding");
  requireSha(proof.development_cutover_result_sha256, "pyramid local candidate proof cutover binding");
  requireReference(proof.target_root_ref, "pyramid local candidate proof target");
  requireReference(proof.rollback_ref, "pyramid local candidate proof rollback");
  assert(Array.isArray(proof.steps) && proof.steps.length === PYRAMID_LOCAL_PROOF_STEP_IDS.length, "pyramid local candidate proof must cover every required local step");
  proof.steps.forEach((step, index) => validateLocalProofStep(step, PYRAMID_LOCAL_PROOF_STEP_IDS[index]));
  assert(JSON.stringify(proof.steps.map((step) => step.step_id)) === JSON.stringify(PYRAMID_LOCAL_PROOF_STEP_IDS), "pyramid local candidate proof steps are not canonical");
  for (const field of ["source_roots_preserved", "legacy_roots_untouched", "product_mutation", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "clean_target"]) {
    assert(typeof proof[field] === "boolean", `pyramid local candidate proof ${field} is invalid`);
  }
  assert(proof.source_roots_preserved === true && proof.legacy_roots_untouched === true && proof.product_mutation === false
    && proof.provider_access === false && proof.credential_access === false && proof.external_sync === false
    && proof.spend === false && proof.destructive_work === false && proof.clean_target === true, "pyramid local candidate proof crossed a protected boundary");
  if (materialization !== null) {
    assert(proof.materialization_sha256 === materialization.materialization_sha256, "pyramid local candidate proof materialization is stale");
    assert(proof.rollback_ref === materialization.rollback_ref, "pyramid local candidate proof rollback is stale");
  }
  if (developmentCutover !== null) {
    assert(proof.development_cutover_result_sha256 === developmentCutover.result_sha256, "pyramid local candidate proof cutover result is stale");
    assert(proof.target_root_ref === developmentCutover.target_root_ref, "pyramid local candidate proof target is stale");
  }
  requireSha(proof.proof_sha256, "pyramid local candidate proof digest");
  assert(proof.proof_sha256 === digestWithout(proof, "proof_sha256"), "pyramid local candidate proof digest mismatch");
  return proof;
}

/**
 * Compile the ordinary local step between a completed pyramid output and the
 * protected Runtime cutover.  This is deliberately a plan/receipt, not a
 * Git repoint: it creates a typed destination for new candidate repositories,
 * retains the legacy source untouched, and keeps all protected capabilities
 * closed.  A Runtime adapter may later turn the READY plan into a
 * MATERIALIZED receipt without changing the source project.
 */
export function compilePyramidCandidateMaterialization({
  pyramidImportOutput,
  materializationId,
  destinationRootRef,
  evidenceRefs,
  status = "READY_FOR_LOCAL_MATERIALIZATION",
} = {}) {
  validatePyramidImportOutput(pyramidImportOutput);
  requireIdentifier(materializationId, "pyramid candidate materialization ID");
  requireReference(destinationRootRef, "pyramid candidate materialization destination");
  assert(status === "READY_FOR_LOCAL_MATERIALIZATION" || status === "MATERIALIZED_CANDIDATE_REPOSITORIES", "pyramid candidate materialization status is invalid");
  const materialization = {
    schema: `${PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA}.candidate_materialization`,
    version: PYRAMID_CAMPAIGN_GOVERNANCE_VERSION,
    materialization_id: materializationId,
    pyramid_output_sha256: pyramidImportOutput.output_sha256,
    candidate_repository_ids: pyramidImportOutput.candidate_repositories.map((repository) => repository.repository_id),
    destination_root_ref: destinationRootRef,
    legacy_policy: "RETAIN_LEGACY_REPOSITORIES_UNTOUCHED",
    source_roots_preserved: true,
    product_mutation: false,
    provider_access: false,
    credential_access: false,
    external_sync: false,
    spend: false,
    destructive_work: false,
    clean_candidate: true,
    status,
    rollback_ref: pyramidImportOutput.git_repoint.rollback_ref,
    evidence_refs: [...evidenceRefs].sort((left, right) => compareUtf8(left, right)),
    materialization_sha256: null,
  };
  materialization.materialization_sha256 = canonicalDigest(candidateMaterializationBody(materialization));
  return validateCandidateMaterialization(materialization, {pyramidImportOutput});
}

/*
 * The materialized destination is still an isolated development target.  It
 * is not the consumer Product and it is not a public Git/release cutover.
 * Compile the five-question gate here so the subsequent Runtime action is
 * explicitly autonomous and cannot inherit the final-cutover YES answer.
 */
function compilePyramidIsolatedCandidateScopeGate(materialization) {
  requireIdentifier(materialization.materialization_id, "pyramid candidate materialization ID");
  return compileCandidateScopeGate({
    gateId: `GATE.PYRAMID.CANDIDATE_SCOPE.${materialization.materialization_id}`,
    mode: CANDIDATE_SCOPE_MODES[0],
    actionRef: `opaque:pyramid-candidate-cutover/${materialization.materialization_id.toLowerCase()}`,
    rollbackRef: materialization.rollback_ref,
    candidateScopeRef: `opaque:pyramid-candidate-scope/${materialization.materialization_id.toLowerCase()}`,
    finalCutoverScopeRef: `opaque:pyramid-final-cutover/${materialization.materialization_id.toLowerCase()}`,
    zeroCostRef: `opaque:pyramid-candidate-cost/${materialization.materialization_id.toLowerCase()}`,
    preservationRef: `opaque:pyramid-candidate-preservation/${materialization.materialization_id.toLowerCase()}`,
    rollbackEvidenceRef: `opaque:pyramid-candidate-rollback-evidence/${materialization.materialization_id.toLowerCase()}`,
    delegatedAuthorityRef: "opaque:agentos-owner-voice/development-candidate-custody",
  });
}

function compileProtectedEvent(protectedEvent) {
  const event = protectedEvent ?? {
    blocker_id: "PROTECTED.PRODUCT_MUTATION.CENTRAL_INTEGRATION_AUTHORITY",
    blocker_class: "MAJOR_PRODUCT_OR_PRODUCTION_DECISION",
    affected_action: "PROMOTE_ISOLATED_CUMULATIVE_CANDIDATE_TO_PRODUCT",
    evidence_ceiling: "Static typed findings, accepted platform handoffs, and isolated cumulative-candidate metadata only; no Product mutation or release evidence is inferred.",
    restart_event: "CURRENT_TYPED_CENTRAL_INTEGRATION_AUTHORIZATION_OR_EXPLICIT_OWNER_RESUMPTION",
    resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
  };
  exactKeys(event, PROTECTED_EVENT_KEYS, "pyramid protected event");
  requireIdentifier(event.blocker_id, "pyramid protected blocker");
  assert(["CREDENTIAL_OR_AUTHENTICATION", "IRREVERSIBLE_DESTRUCTIVE_USER_WORK", "MAJOR_PRODUCT_OR_PRODUCTION_DECISION", "MATERIAL_SPEND_OR_FINANCIAL_AUTHORITY", "PROTECTED_EXTERNAL_DEPENDENCY"].includes(event.blocker_class), "pyramid protected blocker class is invalid");
  requireIdentifier(event.affected_action, "pyramid protected affected action");
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

/*
 * A protected wait is only terminal for the dependent route when the same
 * state carries a valid five-question stop decision.  The protected-event
 * class selects the matching question: product/production changes, spend,
 * destruction, credentials, or an external dependency.  Ordinary isolated
 * work remains explicitly all-NO and therefore continues autonomously.
 */
export function compilePyramidProtectedStopDecision({protectedEvent, rollbackRef} = {}) {
  const event = compileProtectedEvent(protectedEvent);
  requireReference(rollbackRef, "pyramid protected stop rollback reference");
  const answers = compileStopWorkflowNoStopAnswers({evidenceRefPrefix: `opaque:stop-gate/${event.blocker_id}`});
  const questionByClass = {
    CREDENTIAL_OR_AUTHENTICATION: "OWNER_DECISION_REQUIRED",
    IRREVERSIBLE_DESTRUCTIVE_USER_WORK: "DESTROYS_OR_IRREVERSIBLY_MODIFIES",
    MAJOR_PRODUCT_OR_PRODUCTION_DECISION: "CHANGES_PROTECTED_PROJECT_OR_SCOPE",
    MATERIAL_SPEND_OR_FINANCIAL_AUTHORITY: "COSTS_MONEY",
    PROTECTED_EXTERNAL_DEPENDENCY: "OWNER_DECISION_REQUIRED",
  };
  const questionId = questionByClass[event.blocker_class];
  assert(questionId !== undefined, "pyramid protected event has no stop-gate question mapping");
  const answerIndex = answers.findIndex((answer) => answer.question_id === questionId);
  assert(answerIndex >= 0, "pyramid stop gate mapped question is unavailable");
  answers[answerIndex] = {
    question_id: questionId,
    answer: "YES",
    evidence_refs: [`opaque:protected-event/${event.blocker_id}`],
  };
  const decisionToken = canonicalDigest({blocker_id: event.blocker_id, affected_action: event.affected_action}).slice(0, 32).toUpperCase();
  return evaluateStopWorkflowGate({
    decisionId: `DECISION.PROTECTED.${decisionToken}`,
    actionRef: `opaque:protected-action/${event.affected_action}`,
    rollbackRef,
    answers,
  });
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
  if (state.isolated_candidate_assembly !== null) {
    validatePyramidIsolatedCandidateAssembly(state.isolated_candidate_assembly);
    assert(state.final_review?.accepted === true, "pyramid isolated candidate assembly lacks accepted final review");
    assert(state.isolated_candidate_assembly.candidate_id === state.candidate.candidate_id, "pyramid isolated candidate identity is stale");
    assert(state.isolated_candidate_assembly.base_candidate_sha256 === state.candidate.candidate_sha256, "pyramid isolated candidate baseline is stale");
    assert(state.isolated_candidate_assembly.worktree_ref === state.candidate.worktree_ref, "pyramid isolated candidate worktree binding is stale");
    assert(state.isolated_candidate_assembly.rollback_ref === state.candidate.rollback_ref, "pyramid isolated candidate rollback binding is stale");
  }
  validateSourceScope(state.source_scope);
  validateIndependentReaudit(state.independent_reaudit, state.candidate.candidate_sha256);
  if (state.pyramid_import_output !== null) {
    validatePyramidImportOutput(state.pyramid_import_output, {
      requiredSourceRepositoryIds: state.source_scope.required_repository_ids,
      sourceMappingSha256: state.source_scope.source_mapping_sha256,
    });
    assert(state.pyramid_import_output.status === "READY_FOR_GIT_REPOINT", "pyramid import output must remain a prepared cutover candidate");
    assert(state.independent_reaudit?.accepted === true, "pyramid import output lacks an accepted independent re-audit");
    assert(state.pyramid_import_output.pyramid.independent_reaudit_sha256 === state.independent_reaudit.reaudit_sha256, "pyramid import output independent re-audit binding is stale");
    assert(state.pyramid_import_output.legacy.untouched === true && state.pyramid_import_output.legacy.read_only === true, "pyramid import output legacy source is not preserved");
  }
  if (state.candidate_materialization !== null) {
    validateCandidateMaterialization(state.candidate_materialization, {pyramidImportOutput: state.pyramid_import_output});
    assert(state.pyramid_import_output !== null, "pyramid candidate materialization lacks import output");
  }
  if (state.development_cutover !== null) {
    validateDevelopmentCutoverResult(state.development_cutover, {materialization: state.candidate_materialization});
    assert(state.candidate_materialization !== null && state.candidate_materialization.status === "MATERIALIZED_CANDIDATE_REPOSITORIES", "pyramid development cutover lacks materialized candidate repositories");
  }
  if (state.local_candidate_proof !== null) {
    validatePyramidLocalCandidateProof(state.local_candidate_proof, {
      materialization: state.candidate_materialization,
      developmentCutover: state.development_cutover,
    });
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
    assert(state.pending_specialist_ids.length === 0, "pyramid protected wait cannot hide pending specialist work");
    assert(state.active_lane_ids.length === 0, "pyramid protected wait cannot hide active specialist lanes");
    assert(state.platform_review_batch.length === 0, "pyramid protected wait cannot hide queued platform review work");
    compileProtectedEvent(state.protected_event);
    assert(state.stop_workflow_decision !== null, "pyramid protected wait lacks stop-workflow decision");
    validateStopWorkflowDecision(state.stop_workflow_decision);
    const expectedStopDecision = compilePyramidProtectedStopDecision({protectedEvent: state.protected_event, rollbackRef: state.candidate.rollback_ref});
    assert(state.stop_workflow_decision.stop === true, "pyramid protected wait stop-workflow decision must stop");
    assert(state.stop_workflow_decision.decision_sha256 === expectedStopDecision.decision_sha256, "pyramid protected wait stop-workflow decision is stale");
    if (state.final_review !== null) assert(state.isolated_candidate_assembly !== null, "pyramid protected promotion wait lacks isolated candidate assembly");
    if (state.pyramid_import_output !== null) {
      assert(state.candidate_materialization !== null && state.candidate_materialization.status === "MATERIALIZED_CANDIDATE_REPOSITORIES", "pyramid protected cutover wait requires materialized candidate repositories");
    }
    if (state.protected_event.affected_action === "RUNTIME_ATOMIC_GIT_REPOINT_OR_RELEASE") {
      assert(state.development_cutover !== null, "pyramid protected cutover wait requires completed development cutover");
      assert(state.local_candidate_proof !== null, "pyramid protected cutover wait requires complete local candidate proof");
    }
  } else if (state.status === "LOCAL_PROOF_PENDING") {
    assert(state.next_action === "RUN_LOCAL_CANDIDATE_PROOF", "pyramid local proof successor is not the proof action");
    assert(state.protected_event === null && state.stop_workflow_decision === null, "local candidate proof must not carry a protected wait");
    assert(state.candidate_materialization?.status === "MATERIALIZED_CANDIDATE_REPOSITORIES", "local candidate proof requires materialized candidate repositories");
    assert(state.development_cutover !== null && state.local_candidate_proof === null, "local candidate proof successor is already resolved");
  } else if (state.status === "CANDIDATE_CUTOVER_PENDING") {
    assert(state.next_action === "RUNTIME_ATOMIC_GIT_REPOINT", "pyramid candidate cutover successor is not the Runtime action");
    assert(state.protected_event === null && state.stop_workflow_decision === null, "isolated candidate cutover must not carry a protected wait");
    assert(state.pyramid_import_output !== null, "pyramid candidate cutover lacks import output");
    assert(state.candidate_materialization !== null && state.candidate_materialization.status === "MATERIALIZED_CANDIDATE_REPOSITORIES", "pyramid candidate cutover requires materialized candidate repositories");
    const scopeGate = compilePyramidIsolatedCandidateScopeGate(state.candidate_materialization);
    assert(scopeGate.stop_decision.outcome === "CONTINUE_AUTONOMOUS" && scopeGate.stop_decision.stop === false, "isolated candidate cutover must pass the all-NO stop gate");
    assert(state.development_cutover === null && state.local_candidate_proof === null, "candidate cutover pending carries a stale proof result");
  } else {
    assert(state.protected_event === null, "pyramid non-protected state carries a protected event");
    assert(state.stop_workflow_decision === null, "pyramid non-protected state carries a stop-workflow decision");
  }
  if (state.status === "CANDIDATE_ASSEMBLY_PENDING") {
    assert(state.next_action === "ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE" && state.final_review?.accepted === true, "pyramid candidate assembly successor is not ready");
    assert(state.isolated_candidate_assembly === null, "pyramid candidate assembly is already recorded");
  }
  if (state.status === "INDEPENDENT_REAUDIT_PENDING") {
    assert(state.next_action === "START_INDEPENDENT_REAUDIT", "pyramid independent re-audit successor is not ready");
    assert(state.final_review?.accepted === true && state.isolated_candidate_assembly !== null, "pyramid independent re-audit lacks assembled candidate");
    assert(state.independent_reaudit === null, "pyramid independent re-audit is already recorded");
  }
  if (state.status === "IMPORT_OUTPUT_PENDING") {
    assert(state.next_action === "PREPARE_PYRAMID_IMPORT_OUTPUT", "pyramid import-output successor is not ready");
    assert(state.independent_reaudit?.accepted === true && state.isolated_candidate_assembly !== null, "pyramid import-output preparation lacks an accepted candidate");
    assert(state.pyramid_import_output === null, "pyramid import output is already recorded");
  }
  if (state.status === "CANDIDATE_REPOSITORIES_PENDING") {
    assert(state.next_action === "MATERIALIZE_NEW_PROJECT_REPOSITORIES", "pyramid candidate materialization successor is not ready");
    assert(state.pyramid_import_output !== null && state.candidate_materialization === null, "pyramid candidate materialization route is already resolved");
  }
  if (state.status !== "IMPORT_OUTPUT_PENDING" && state.pyramid_import_output !== null) {
    assert(["CANDIDATE_REPOSITORIES_PENDING", "CANDIDATE_CUTOVER_PENDING", "LOCAL_PROOF_PENDING", "PROTECTED_WAIT"].includes(state.status), "pyramid import output advanced without materialization or protected cutover");
  }
  if (!["LOCAL_PROOF_PENDING", "PROTECTED_WAIT"].includes(state.status)) {
    assert(state.development_cutover === null && state.local_candidate_proof === null, "pyramid non-proof state carries stale local proof evidence");
  }
  validateRoute(state);
  requireSha(state.state_sha256, "pyramid state digest");
  assert(state.state_sha256 === digestWithout(state, "state_sha256"), "pyramid state digest mismatch");
  return state;
}

export function compilePyramidCampaignState({campaignId, roster, candidateId, candidateSha256, worktreeRef, rollbackRef, sourceScope, initialProtectedWait = false, protectedEvent = null} = {}) {
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
  validateSourceScope(sourceScope);
  const shouldWait = initialProtectedWait === true;
  if (shouldWait) {
    assert(roster.applicable_specialist_ids.length === 0, "pyramid initial protected wait cannot hide applicable specialist work");
  }
  const initialProtectedEvent = shouldWait ? compileProtectedEvent(protectedEvent) : null;
  const route = shouldWait ? compileRoute("WAIT_FOR_PROTECTED_EVENT", initialProtectedEvent) : compileRoute(roster.applicable_specialist_ids.length === 0 ? "PREPARE_CANDIDATE_REVIEW" : "START_SPECIALIST_WAVE");
  const state = {
    schema: PYRAMID_CAMPAIGN_GOVERNANCE_SCHEMA,
    version: PYRAMID_CAMPAIGN_GOVERNANCE_VERSION,
    campaign_id: campaignId,
    context_sha256: roster.context.context_sha256,
    roster_sha256: roster.roster_sha256,
    candidate,
    source_scope: structuredClone(sourceScope),
    status: shouldWait ? "PROTECTED_WAIT" : (roster.applicable_specialist_ids.length === 0 ? "FINAL_REVIEW_PENDING" : "PREPARED"),
    wave_index: 0,
    pending_specialist_ids: [...roster.applicable_specialist_ids],
    completed_specialist_ids: [],
    active_lane_ids: [],
    platform_review_batch: [],
    accepted_platform_lane_ids: [],
    final_review: null,
    isolated_candidate_assembly: null,
    independent_reaudit: null,
    pyramid_import_output: null,
    candidate_materialization: null,
    development_cutover: null,
    local_candidate_proof: null,
    lane_policy: {max_active_lanes: PYRAMID_CAMPAIGN_MAX_LANES, max_heavyweight_processes: PYRAMID_CAMPAIGN_MAX_HEAVYWEIGHT_PROCESSES, heavyweight_processes: 0, timers: 0, polling: false},
    authority: structuredClone(PYRAMID_AUTHORITY),
    next_action: route.next_action,
    next_handler: route.next_handler,
    continuation: route.continuation,
    continuation_sha256: route.continuation_sha256,
    protected_event: initialProtectedEvent,
    stop_workflow_decision: shouldWait ? compilePyramidProtectedStopDecision({protectedEvent: initialProtectedEvent, rollbackRef}) : null,
    state_sha256: null,
  };
  state.state_sha256 = digestWithout(state, "state_sha256");
  return validatePyramidCampaignState(state, {roster});
}

function cloneState(state) {
  return structuredClone(state);
}

function finishState(next, {status, nextAction, protectedEvent = null} = {}) {
  const compiledProtectedEvent = protectedEvent === null ? null : compileProtectedEvent(protectedEvent);
  const route = compileRoute(nextAction, compiledProtectedEvent);
  next.status = status;
  next.next_action = route.next_action;
  next.next_handler = route.next_handler;
  next.continuation = route.continuation;
  next.continuation_sha256 = route.continuation_sha256;
  next.protected_event = compiledProtectedEvent;
  next.stop_workflow_decision = status === "PROTECTED_WAIT"
    ? compilePyramidProtectedStopDecision({protectedEvent: compiledProtectedEvent, rollbackRef: next.candidate.rollback_ref})
    : null;
  next.state_sha256 = digestWithout(next, "state_sha256");
  return next;
}

export function advancePyramidCampaign(state, {roster, event, handoffs = [], reviews = [], finalReview = null, assembly = null, independentReaudit = null, pyramidImportOutput = null, protectedEvent = null} = {}) {
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
    return finishState(next, {status: "CANDIDATE_ASSEMBLY_PENDING", nextAction: "ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE"});
  }
  if (event === "ISOLATED_CUMULATIVE_CANDIDATE_ASSEMBLED") {
    assert(state.next_action === "ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE", "pyramid isolated candidate assembly is not the current successor");
    assert(state.pending_specialist_ids.length === 0 && state.active_lane_ids.length === 0 && state.platform_review_batch.length === 0, "pyramid isolated candidate cannot assemble before all applicable specialist lanes are covered");
    assert(state.final_review?.accepted === true, "pyramid isolated candidate cannot assemble before final coherence review");
    const assembled = validatePyramidIsolatedCandidateAssembly(assembly);
    assert(assembled.candidate_id === state.candidate.candidate_id, "pyramid isolated candidate assembly targets a different candidate");
    assert(assembled.base_candidate_sha256 === state.candidate.candidate_sha256, "pyramid isolated candidate assembly baseline is stale");
    assert(assembled.worktree_ref === state.candidate.worktree_ref, "pyramid isolated candidate assembly worktree is stale");
    assert(assembled.rollback_ref === state.candidate.rollback_ref, "pyramid isolated candidate assembly rollback is stale");
    next.isolated_candidate_assembly = structuredClone(assembled);
    return finishState(next, {status: "INDEPENDENT_REAUDIT_PENDING", nextAction: "START_INDEPENDENT_REAUDIT"});
  }
  if (event === "INDEPENDENT_REAUDIT_COMPLETED") {
    assert(state.next_action === "START_INDEPENDENT_REAUDIT", "pyramid independent re-audit is not the current successor");
    assert(state.isolated_candidate_assembly !== null && state.final_review?.accepted === true, "pyramid independent re-audit lacks an assembled candidate");
    validateIndependentReaudit(independentReaudit, state.candidate.candidate_sha256);
    next.independent_reaudit = structuredClone(independentReaudit);
    // Materializing the promised pyramid output is ordinary isolated work.
    // Do not jump directly from re-audit to a protected cutover; the output
    // must first name clean candidate repositories and preserve the old
    // repositories as immutable legacy evidence.
    return finishState(next, {status: "IMPORT_OUTPUT_PENDING", nextAction: "PREPARE_PYRAMID_IMPORT_OUTPUT"});
  }
  if (event === "PYRAMID_IMPORT_OUTPUT_READY") {
    assert(state.next_action === "PREPARE_PYRAMID_IMPORT_OUTPUT", "pyramid import output is not the current successor");
    assert(state.independent_reaudit?.accepted === true && state.isolated_candidate_assembly !== null, "pyramid import output lacks an accepted candidate");
    validatePyramidImportOutput(pyramidImportOutput, {
      requiredSourceRepositoryIds: state.source_scope.required_repository_ids,
      sourceMappingSha256: state.source_scope.source_mapping_sha256,
    });
    assert(pyramidImportOutput.status === "READY_FOR_GIT_REPOINT", "pyramid import output must stop before Git cutover");
    assert(pyramidImportOutput.pyramid.independent_reaudit_sha256 === state.independent_reaudit.reaudit_sha256, "pyramid import output re-audit evidence is stale");
    assert(pyramidImportOutput.pyramid.central_integration_sha256 === state.isolated_candidate_assembly.assembly_sha256, "pyramid import output central-integration evidence is stale");
    next.pyramid_import_output = structuredClone(pyramidImportOutput);
    // The output names the new repositories, but it is not itself proof that
    // those repositories have been materialized.  Keep the campaign moving
    // through that ordinary local step before creating the final cutover hold.
    return finishState(next, {status: "CANDIDATE_REPOSITORIES_PENDING", nextAction: "MATERIALIZE_NEW_PROJECT_REPOSITORIES"});
  }
  if (event === "CANDIDATE_REPOSITORIES_MATERIALIZED") {
    assert(state.next_action === "MATERIALIZE_NEW_PROJECT_REPOSITORIES", "pyramid candidate materialization is not the current successor");
    assert(state.pyramid_import_output !== null, "pyramid candidate materialization lacks import output");
    const materialization = validateCandidateMaterialization(assembly, {pyramidImportOutput: state.pyramid_import_output});
    assert(materialization.status === "MATERIALIZED_CANDIDATE_REPOSITORIES", "pyramid candidate materialization has not completed");
    next.candidate_materialization = structuredClone(materialization);
    /*
     * This is still a bounded, isolated development action.  The old route
     * incorrectly treated the materialized destination as a Product/public
     * Git cutover and stopped here.  The candidate-scope gate proves the
     * distinction and hands Runtime the local cutover in the same turn.
     */
    const scopeGate = compilePyramidIsolatedCandidateScopeGate(materialization);
    assert(scopeGate.stop_decision.outcome === "CONTINUE_AUTONOMOUS" && scopeGate.stop_decision.stop === false, "candidate materialization crossed the isolated-custody boundary");
    return finishState(next, {status: "CANDIDATE_CUTOVER_PENDING", nextAction: "RUNTIME_ATOMIC_GIT_REPOINT"});
  }
  if (event === "DEVELOPMENT_CANDIDATE_CUTOVER_COMPLETE") {
    assert(state.next_action === "RUNTIME_ATOMIC_GIT_REPOINT", "pyramid development cutover is not the current successor");
    assert(state.candidate_materialization !== null && state.candidate_materialization.status === "MATERIALIZED_CANDIDATE_REPOSITORIES", "pyramid development cutover lacks materialized candidate repositories");
    assert(isRecord(assembly), "pyramid development cutover requires a typed Runtime result");
    validateDevelopmentCutoverResult(assembly, {materialization: state.candidate_materialization});
    next.development_cutover = structuredClone(assembly);
    // Local dependency, installation, build/test, repair-integration, and
    // zero-trace proofs are ordinary isolated work.  Never jump directly to
    // the protected Product/public Git boundary while any of them is absent.
    return finishState(next, {status: "LOCAL_PROOF_PENDING", nextAction: "RUN_LOCAL_CANDIDATE_PROOF"});
  }
  if (event === "LOCAL_CANDIDATE_PROOF_COMPLETED") {
    assert(state.next_action === "RUN_LOCAL_CANDIDATE_PROOF", "pyramid local candidate proof is not the current successor");
    assert(state.development_cutover !== null, "pyramid local candidate proof lacks development cutover");
    const proof = validatePyramidLocalCandidateProof(assembly, {
      materialization: state.candidate_materialization,
      developmentCutover: state.development_cutover,
    });
    next.local_candidate_proof = structuredClone(proof);
    const cutoverEvent = protectedEvent ?? {
      blocker_id: "PROTECTED.RUNTIME.GIT_REPOINT_OR_RELEASE",
      blocker_class: "MAJOR_PRODUCT_OR_PRODUCTION_DECISION",
      affected_action: "RUNTIME_ATOMIC_GIT_REPOINT_OR_RELEASE",
      evidence_ceiling: "The isolated Development candidate cutover is verified; the consumer Product and public Git/release state remain untouched, so only final Product repoint or release remains protected.",
      restart_event: "CURRENT_TYPED_PUBLIC_PRODUCT_REPOINT_OR_RELEASE_AUTHORIZATION",
      resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
    };
    return finishState(next, {status: "PROTECTED_WAIT", nextAction: "WAIT_FOR_PROTECTED_EVENT", protectedEvent: compileProtectedEvent(cutoverEvent)});
  }
  assert(false, `Unsupported pyramid campaign event: ${event}`);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("pyramid campaign governance loaded\n");
