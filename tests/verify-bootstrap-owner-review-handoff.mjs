#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  approveBootstrapPlan,
  compileBootstrapOwnerReviewHandoff,
  compileBootstrapPlan,
  projectContextFromBootstrapPlan,
} from "../control/bootstrap-compiler.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";
import {getPolicyValue} from "../control/global-policy-state.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-owner-review-"));
const now = "2026-01-01T00:00:00.000Z";
const discovery = discoverProject(root, "RECOMMENDED").facts;
const answers = {
  "bootstrap.discovery.mode": "RECOMMENDED",
  "project.north_star": {user: "owner", outcome: "complete one useful workflow"},
  "project.first_workflow": {name: "primary workflow", success: "one accepted result"},
  "project.boundary": {project_name: "Synthetic-Review-Project", repositories: [], branches: []},
  "project.protected_boundaries": {owner_only: ["publication"], protected: ["secrets"]},
  "authority-corpus.source": {operation: "CREATE_NEW"},
  "project.design": {page_families: ["WORKFLOW"], templates: ["PRIMARY"], tokens: ["DEFAULT"], protected_surfaces: []},
  "project.technical_baseline": {testing: "deterministic"},
  "project.function_requirements": {required: ["complete one useful workflow"], excluded: ["unrelated polish"]},
  "security.baseline": {data_classes: ["non-sensitive synthetic"], authentication: "owner-only", protected_actions: ["publication"]},
  "project.delivery_policy": {source_control: {push_mode: "CHECKPOINTS_REMOTE_EQUAL"}, ci_runner: {route: "LOCAL", weekly_minutes_budget: 120}, deployment: {route: "LOCAL", environment_ids: ["synthetic"]}},
  "project.model_economics": {profile: "ECO", completion_floor: 0.8},
  "project.runtime": {session_id: "RUNTIME-REVIEW", environment_identity: "ENV-REVIEW", capabilities: ["filesystem"]},
};
const plan = compileBootstrapPlan({discovery, answers, projectRoot: root});
const approved = approveBootstrapPlan(plan, {decision: "APPROVE_EXACT_PLAN", planSha256: plan.plan_sha256, discoveryDigestSha256: plan.discovery_digest_sha256, actor: "OWNER", approvedAtUtc: now});
const policy = approved.global_policy_state;
const SHA = "a".repeat(64);
const guidance = {economy: "MEDIUM", speed: "MEDIUM", difficulty: "SUBSTANTIAL", task_fit: "GOOD", reason: "The host catalog keeps this route above the completion floor."};
const levels = ["MEDIUM", "HIGH", "EXTRA_HIGH", "PRO"].map((level) => ({level, model_class: level === "PRO" ? "FRONTIER" : level === "HIGH" ? "PERFORMANCE" : "BALANCED", available: true, completion_floor: 0.8, meets_floor: true, economics_sha256: SHA, rationale: "The admitted host catalog has a candidate at this review level.", guidance, recommended: level === "HIGH"}));
const roles = ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT", "PLATFORM_AGENT", "AUDIT_WORKER", "CAMPAIGN_FINALIZER", "RUNTIME"].sort().map((role) => ({role, model_class: getPolicyValue(policy, `MODEL.ROLE.${role}`), available: true, completion_floor: 0.8, meets_floor: true, economics_sha256: SHA, rationale: "The admitted host catalog covers this role.", guidance, recommended: true}));
const result = compileBootstrapOwnerReviewHandoff({
  plan: approved, reviewId: "BOOTSTRAP-REVIEW-001", createdAtUtc: now, expiresAtUtc: "2026-01-08T00:00:00.000Z",
  sourceBinding: {policy_epoch: policy.policy_epoch, policy_state_sha256: policy.policy_state_sha256, project_context_sha256: projectContextFromBootstrapPlan(approved).project_context.exact_context_digest, source_commit: "b".repeat(40), source_tree: "c".repeat(40), current_campaign_id: null, next_campaign_candidate_sha256: null},
  currentProject: {summary: "A new project at its Bootstrap starting point.", north_star: "Complete one useful workflow.", users: ["project owner"], accepted_capabilities: ["Bootstrap context is compiled"], working_unaccepted: ["The first workflow is not built"], unavailable: [], known_flaws: [], deferred: ["unrelated polish"], current_recommendation: "Start with the smallest useful workflow."},
  reviewScope: {may_change: ["next campaign intent"], may_not_change: ["Bootstrap authority"], protected_boundaries: ["no secrets"], owner_only_decisions: ["publication"]},
  questionIdsByRoot: {FUNCTION_REQUIREMENTS: ["FR-001"], DESIGN_BIBLE: ["DB-001"], SECURITY: ["SEC-001"]},
  candidateCampaign: {owner_outcome: "Complete one useful workflow.", first_useful_workflow: "The owner completes the workflow and sees the result.", proposed_features: ["primary workflow"], dependencies: [], excluded_scope: ["unrelated polish"], campaign_mode: "STANDARD_SUBSTANTIAL", release_stop: "Stop when the workflow and three roots are accepted.", task_profile: {difficulty: "SUBSTANTIAL", time_sensitivity: "MEDIUM", cost_sensitivity: "MEDIUM"}},
  modelCandidates: {chat_review_levels: levels, campaign_role_candidates: roles, economics_snapshot_sha256: SHA, host_catalog_sha256: SHA},
  transportBinding: {kind: "PRIVATE_MARKDOWN", handoff_locator: "BOOTSTRAP-REVIEW-001.md", return_locator: "BOOTSTRAP-REVIEW-001-RETURN.md", repository_digest_sha256: null, branch: null, commit: null, tree: null, connector_identity_sha256: null, conversation_identity_sha256: null, user_authorized: true},
});
assert(result.packet.packet_sha256);
assert(result.markdown.includes("Let's talk about the next useful step"));
assert(!result.markdown.includes("source_binding"));
assert(!result.markdown.includes("```json"));

console.log("PASS AgentOS Bootstrap owner-review handoff: exact plan/context/policy binding and friendly projection verified");
