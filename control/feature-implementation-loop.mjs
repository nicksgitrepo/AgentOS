#!/usr/bin/env node

/* Bounded feature planning, economical implementation, and Orchestrator-only acceptance. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {resolveCanonicalGlobalGovernanceProjection} from "./global-governance-bootstrap.mjs";

export const FEATURE_PLAN_SCHEMA = "agentos.feature_plan.v1";
export const FEATURE_DISPATCH_SCHEMA = "agentos.feature_implementation_dispatch.v1";
export const FEATURE_REVIEW_SCHEMA = "agentos.orchestrator_feature_review.v1";
export const FEATURE_PLANNING_PRINCIPLES = Object.freeze([
  "NO_OVER_ENGINEERING", "NO_PREMATURE_ABSTRACTIONS", "NO_SCOPE_CREEP",
]);

const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const SHA = /^[0-9a-f]{64}$/u;
function assert(condition, message, code = "FEATURE_LOOP_INVALID") { if (!condition) { const error = new Error(message); error.code = code; throw error; } }
function record(value, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); return value; }
function exact(value, keys, label) { record(value, label); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`); }
function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); return value; }
function text(value, label, minimum = 12) { assert(typeof value === "string" && value.trim().length >= minimum, `${label} is incomplete`); return value.trim(); }
function ref(value, label, prefix = /^(?:opaque:|ref:)/u) { assert(typeof value === "string" && prefix.test(value), `${label} must be an opaque or governed reference`); return value; }
function sha(value, label) { assert(typeof value === "string" && SHA.test(value), `${label} must be a SHA-256`); return value; }
function strings(values, label, minimum = 1) { assert(Array.isArray(values) && values.length >= minimum, `${label} is incomplete`); const result = values.map((value, index) => text(value, `${label} ${index}`, 4)).sort(compareUtf8); assert(new Set(result).size === result.length, `${label} contains duplicates`); return result; }
function digest(value, field) { return canonicalDigest({...structuredClone(value), [field]: null}); }

export function validateFeaturePlan(plan) {
  exact(plan, ["schema", "version", "status", "feature_id", "title", "request", "planner_id", "planner_role", "project_agnostic", "scope", "requirements", "acceptance_criteria", "non_goals", "planning_principles", "implementation_instructions", "model_routing", "plan_sha256"], "Feature plan");
  assert(plan.schema === FEATURE_PLAN_SCHEMA && plan.version === 1 && plan.status === "READY_FOR_IMPLEMENTATION", "Feature plan identity is invalid"); id(plan.feature_id, "feature ID"); id(plan.planner_id, "planner ID"); assert(plan.planner_role === "AGENTOS.FEATURE_PLANNER" && plan.project_agnostic === true, "Feature planner authority is invalid");
  text(plan.title, "feature title", 4); text(plan.request, "feature request"); exact(plan.scope, ["in_scope", "out_of_scope"], "Feature scope"); strings(plan.scope.in_scope, "in-scope work"); strings(plan.scope.out_of_scope, "out-of-scope work"); strings(plan.requirements, "feature requirements"); strings(plan.acceptance_criteria, "feature acceptance criteria"); strings(plan.non_goals, "feature non-goals"); strings(plan.implementation_instructions, "feature implementation instructions");
  assert(JSON.stringify(plan.planning_principles) === JSON.stringify(FEATURE_PLANNING_PRINCIPLES), "Feature plan may not weaken scope-control principles");
  exact(plan.model_routing, ["planner_task_class", "implementer_task_class", "canonical_policy_ref", "model_suggestion", "suggestion_is_authority"], "Feature model routing");
  assert(plan.model_routing.planner_task_class === "BROAD_ARCHITECTURE" && plan.model_routing.implementer_task_class === "NARROW_CODING", "Feature model task classes are invalid"); ref(plan.model_routing.canonical_policy_ref, "canonical model-policy reference"); if (plan.model_routing.model_suggestion !== null) text(plan.model_routing.model_suggestion, "feature model suggestion", 4); assert(plan.model_routing.suggestion_is_authority === false, "Model suggestions can never be routing authority", "MODEL_SUGGESTION_AUTHORITY_FORBIDDEN");
  sha(plan.plan_sha256, "feature plan"); assert(plan.plan_sha256 === digest(plan, "plan_sha256"), "Feature plan digest differs"); return plan;
}

export function compileFeaturePlan(options = {}) {
  exact(options, ["featureId", "title", "request", "plannerId", "scope", "requirements", "acceptanceCriteria", "nonGoals", "implementationInstructions", "canonicalModelPolicyRef", "modelSuggestion"], "Feature plan request");
  const {featureId, title, request, plannerId, scope, requirements, acceptanceCriteria, nonGoals, implementationInstructions, canonicalModelPolicyRef, modelSuggestion = null} = options;
  id(featureId, "feature ID"); id(plannerId, "planner ID"); record(scope, "feature scope"); exact(scope, ["inScope", "outOfScope"], "feature scope request");
  const plan = {schema: FEATURE_PLAN_SCHEMA, version: 1, status: "READY_FOR_IMPLEMENTATION", feature_id: featureId, title: text(title, "feature title", 4), request: text(request, "feature request"), planner_id: plannerId, planner_role: "AGENTOS.FEATURE_PLANNER", project_agnostic: true, scope: {in_scope: strings(scope.inScope, "in-scope work"), out_of_scope: strings(scope.outOfScope, "out-of-scope work")}, requirements: strings(requirements, "feature requirements"), acceptance_criteria: strings(acceptanceCriteria, "acceptance criteria"), non_goals: strings(nonGoals, "feature non-goals"), planning_principles: [...FEATURE_PLANNING_PRINCIPLES], implementation_instructions: strings(implementationInstructions, "implementation instructions"), model_routing: {planner_task_class: "BROAD_ARCHITECTURE", implementer_task_class: "NARROW_CODING", canonical_policy_ref: ref(canonicalModelPolicyRef, "canonical model-policy reference"), model_suggestion: modelSuggestion, suggestion_is_authority: false}, plan_sha256: null};
  plan.plan_sha256 = digest(plan, "plan_sha256"); return Object.freeze(validateFeaturePlan(plan));
}

export function validateFeatureImplementationDispatch(dispatch) {
  exact(dispatch, ["schema", "version", "status", "feature_id", "plan_sha256", "implementer_id", "worktree_ref", "round", "canonical_route_ref", "canonical_route_sha256", "instructions", "model_suggestion", "model_suggestion_is_authority", "prior_review_sha256", "dispatch_sha256"], "Feature implementation dispatch");
  assert(dispatch.schema === FEATURE_DISPATCH_SCHEMA && dispatch.version === 1 && dispatch.status === "IMPLEMENTATION_AUTHORIZED", "Feature dispatch identity is invalid"); id(dispatch.feature_id, "dispatch feature"); id(dispatch.implementer_id, "feature implementer"); sha(dispatch.plan_sha256, "dispatch plan"); ref(dispatch.worktree_ref, "feature worktree", /^opaque:worktree:/u); assert(Number.isInteger(dispatch.round) && dispatch.round >= 1, "Feature implementation round is invalid"); ref(dispatch.canonical_route_ref, "canonical route"); sha(dispatch.canonical_route_sha256, "canonical route"); strings(dispatch.instructions, "dispatch instructions"); assert(dispatch.model_suggestion === null || typeof dispatch.model_suggestion === "string", "Dispatch model suggestion is invalid"); assert(dispatch.model_suggestion_is_authority === false, "Model suggestion cannot authorize dispatch", "MODEL_SUGGESTION_AUTHORITY_FORBIDDEN"); if (dispatch.prior_review_sha256 !== null) sha(dispatch.prior_review_sha256, "prior feature review"); sha(dispatch.dispatch_sha256, "feature dispatch"); assert(dispatch.dispatch_sha256 === digest(dispatch, "dispatch_sha256"), "Feature dispatch digest differs"); return dispatch;
}

export function compileFeatureImplementationDispatch(options = {}) {
  exact(options, ["plan", "implementerId", "worktreeRef", "globalGovernanceAuthorityStore", "priorReview"], "Feature implementation dispatch request");
  const {plan, implementerId, worktreeRef, globalGovernanceAuthorityStore, priorReview = null} = options; validateFeaturePlan(plan); id(implementerId, "feature implementer"); assert(implementerId !== plan.planner_id, "Planner and implementer must be separate identities");
  const governed = resolveCanonicalGlobalGovernanceProjection({authorityStore: globalGovernanceAuthorityStore, roleClass: "WORKING_AGENT"});
  assert(governed.projection.selected !== null, "Canonical model policy has no working-agent route", "FEATURE_MODEL_ROUTE_UNAVAILABLE");
  let instructions = plan.implementation_instructions, round = 1, priorReviewSha256 = null;
  if (priorReview !== null) { validateOrchestratorFeatureReview(priorReview); assert(priorReview.status === "REPAIR_REQUIRED" && priorReview.plan_sha256 === plan.plan_sha256, "Only a current repair-required review can re-enter implementation"); instructions = priorReview.findings.map((finding) => `${finding.issue_id}: ${finding.required_repair} Re-test: ${finding.retest}`); round = priorReview.round + 1; priorReviewSha256 = priorReview.review_sha256; }
  const dispatch = {schema: FEATURE_DISPATCH_SCHEMA, version: 1, status: "IMPLEMENTATION_AUTHORIZED", feature_id: plan.feature_id, plan_sha256: plan.plan_sha256, implementer_id: implementerId, worktree_ref: ref(worktreeRef, "feature worktree", /^opaque:worktree:/u), round, canonical_route_ref: `ref:global-model-policy:${governed.snapshot.snapshot_sha256}`, canonical_route_sha256: governed.projection.projection_sha256, instructions, model_suggestion: plan.model_routing.model_suggestion, model_suggestion_is_authority: false, prior_review_sha256: priorReviewSha256, dispatch_sha256: null};
  dispatch.dispatch_sha256 = digest(dispatch, "dispatch_sha256"); return Object.freeze(validateFeatureImplementationDispatch(dispatch));
}

function validateFinding(finding) { exact(finding, ["issue_id", "severity", "location", "evidence_ref", "required_repair", "retest"], "Orchestrator finding"); id(finding.issue_id, "feature finding"); assert(["BLOCKER", "HIGH", "MEDIUM", "LOW"].includes(finding.severity), "Feature finding severity is invalid"); text(finding.location, "feature finding location", 3); ref(finding.evidence_ref, "feature finding evidence"); text(finding.required_repair, "required feature repair", 20); text(finding.retest, "feature finding re-test", 12); return finding; }

export function validateOrchestratorFeatureReview(review) {
  exact(review, ["schema", "version", "status", "feature_id", "plan_sha256", "dispatch_sha256", "orchestrator_id", "implementer_id", "candidate_ref", "round", "evidence_refs", "findings", "protected_blocker", "next_action", "review_sha256"], "Orchestrator feature review");
  assert(review.schema === FEATURE_REVIEW_SCHEMA && review.version === 1 && ["ACCEPTED", "REPAIR_REQUIRED", "PROTECTED_BLOCKED"].includes(review.status), "Feature review identity is invalid"); id(review.feature_id, "review feature"); sha(review.plan_sha256, "review plan"); sha(review.dispatch_sha256, "review dispatch"); id(review.orchestrator_id, "feature Orchestrator"); id(review.implementer_id, "review implementer"); assert(review.orchestrator_id !== review.implementer_id && review.orchestrator_id.startsWith("AGENTOS.ORCHESTRATOR"), "Only a separate Orchestrator may review or accept feature work", "FEATURE_SELF_REVIEW_FORBIDDEN"); ref(review.candidate_ref, "feature candidate"); assert(Number.isInteger(review.round) && review.round >= 1, "Feature review round is invalid"); assert(Array.isArray(review.evidence_refs) && review.evidence_refs.length > 0, "Feature review evidence is incomplete"); review.evidence_refs.forEach((value) => ref(value, "feature review evidence")); assert(new Set(review.evidence_refs).size === review.evidence_refs.length && JSON.stringify(review.evidence_refs) === JSON.stringify([...review.evidence_refs].sort(compareUtf8)), "Feature review evidence must be unique and canonical"); assert(Array.isArray(review.findings), "Feature review findings are invalid"); review.findings.forEach(validateFinding);
  if (review.status === "ACCEPTED") assert(review.findings.length === 0 && review.protected_blocker === null && review.next_action === "GOVERNED_DOWNSTREAM_HANDOFF", "Accepted feature review has open findings or blockers");
  if (review.status === "REPAIR_REQUIRED") assert(review.findings.length > 0 && review.protected_blocker === null && review.next_action === "RETURN_DETAILED_INSTRUCTIONS_TO_IMPLEMENTER", "Repair review lacks detailed findings");
  if (review.status === "PROTECTED_BLOCKED") { exact(review.protected_blocker, ["boundary", "evidence_ref", "next_action"], "Feature protected blocker"); text(review.protected_blocker.boundary, "protected boundary", 4); ref(review.protected_blocker.evidence_ref, "protected blocker evidence"); text(review.protected_blocker.next_action, "protected blocker next action", 12); assert(review.findings.length === 0 && review.next_action === "ROUTE_PROTECTED_BOUNDARY", "Protected feature review is invalid"); }
  sha(review.review_sha256, "feature review"); assert(review.review_sha256 === digest(review, "review_sha256"), "Feature review digest differs"); return review;
}

export function compileOrchestratorFeatureReview(options = {}) {
  exact(options, ["plan", "dispatch", "orchestratorId", "candidateRef", "evidenceRefs", "findings", "protectedBlocker"], "Orchestrator feature review request");
  const {plan, dispatch, orchestratorId, candidateRef, evidenceRefs, findings = [], protectedBlocker = null} = options; validateFeaturePlan(plan); validateFeatureImplementationDispatch(dispatch); assert(dispatch.plan_sha256 === plan.plan_sha256, "Feature review plan/dispatch binding differs"); id(orchestratorId, "feature Orchestrator"); assert(orchestratorId !== dispatch.implementer_id && orchestratorId.startsWith("AGENTOS.ORCHESTRATOR"), "Only a separate Orchestrator may review or accept feature work", "FEATURE_SELF_REVIEW_FORBIDDEN");
  assert(Array.isArray(findings), "Feature review findings are invalid"); findings.forEach(validateFinding); assert(Array.isArray(evidenceRefs) && evidenceRefs.length > 0, "Feature review requires current evidence");
  const status = protectedBlocker !== null ? "PROTECTED_BLOCKED" : findings.length > 0 ? "REPAIR_REQUIRED" : "ACCEPTED";
  const review = {schema: FEATURE_REVIEW_SCHEMA, version: 1, status, feature_id: plan.feature_id, plan_sha256: plan.plan_sha256, dispatch_sha256: dispatch.dispatch_sha256, orchestrator_id: orchestratorId, implementer_id: dispatch.implementer_id, candidate_ref: ref(candidateRef, "feature candidate"), round: dispatch.round, evidence_refs: [...evidenceRefs].sort(compareUtf8), findings: structuredClone(findings).sort((a, b) => compareUtf8(a.issue_id, b.issue_id)), protected_blocker: protectedBlocker === null ? null : structuredClone(protectedBlocker), next_action: status === "ACCEPTED" ? "GOVERNED_DOWNSTREAM_HANDOFF" : status === "REPAIR_REQUIRED" ? "RETURN_DETAILED_INSTRUCTIONS_TO_IMPLEMENTER" : "ROUTE_PROTECTED_BOUNDARY", review_sha256: null};
  review.review_sha256 = digest(review, "review_sha256"); return Object.freeze(validateOrchestratorFeatureReview(review));
}
