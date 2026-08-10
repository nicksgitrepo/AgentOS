#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  BOOTSTRAP_OPERATING_MODES,
  DEFAULT_BOOTSTRAP_OPERATING_MODE,
  JSA_HARD_BOUNDARIES,
  JSA_IN_SCOPE_ACTIONS,
  JSA_PLAN_STATUS,
  LOCAL_CAMPAIGN_START_ACTION,
  compileInScopeLocalCampaignStart,
  PROTECTED_BOOTSTRAP_ACTIONS,
  compileBootstrapSafetyAnalysis,
  validateBootstrapActionScope,
  validateBootstrapSafetyAnalysis,
} from "../control/bootstrap-safety-analysis.mjs";

const authorityBoundaries = {owner_only: ["protected changes"], protected: ["secrets"]};
const deliveryPolicy = {finish: {selected: "REVIEW"}, deployment: {route: "LOCAL"}};
const projectLifeContract = {maturity: "PRIVATE_PROTOTYPE", status: "PREPARED_NOT_ACTIVATED"};

assert.deepEqual(BOOTSTRAP_OPERATING_MODES, ["JSA", "EXACT_PLAN_APPROVAL"]);
assert.equal(DEFAULT_BOOTSTRAP_OPERATING_MODE, "JSA");
const jsa = compileBootstrapSafetyAnalysis({authorityBoundaries, deliveryPolicy, projectLifeContract});
validateBootstrapSafetyAnalysis(jsa);
assert.equal(jsa.operating_mode, "JSA");
assert.equal(jsa.plan_status, undefined, "plan status belongs to the plan, not the safety record");
assert.equal(jsa.in_scope_actions.includes("WRITE_TYPED_PROJECT_CONTEXT"), true);
assert.deepEqual(jsa.in_scope_actions, [...JSA_IN_SCOPE_ACTIONS]);
assert.deepEqual(jsa.hard_boundaries, [...JSA_HARD_BOUNDARIES]);
assert.deepEqual(jsa.protected_activation.protected_actions, [...PROTECTED_BOOTSTRAP_ACTIONS]);
assert.deepEqual(validateBootstrapActionScope(["RUN_SETUP_AUDIT"], jsa), {
  status: "CONTINUE_WITHIN_SCOPE",
  actions: ["RUN_SETUP_AUDIT"],
});
assert.deepEqual(validateBootstrapActionScope(["START_IN_SCOPE_LOCAL_CAMPAIGN"], jsa), {
  status: "CONTINUE_WITHIN_SCOPE",
  actions: ["START_IN_SCOPE_LOCAL_CAMPAIGN"],
});
const hostReadbacks = {
  schema: "agentos.gui_host_readbacks.v1",
  version: 1,
  project_id: "project-1",
  project_root: process.cwd(),
  source_commit: "1".repeat(40),
  source_tree: "2".repeat(40),
  environment_identity: "ENV-1",
  workspace_readback: {project_root: process.cwd(), source_commit: "1".repeat(40), source_tree: "2".repeat(40)},
  runtime_readback: {session_id: "runtime-1", persistent: true, pinned: true, resume_readback: true},
  controller_runtime_readback: {project_id: "project-1", controller_runtime_id: "controller-1", runtime_id: "runtime-1", status: "ACTIVE"},
  proof: {
    listed_controller_thread_id: "controller-1",
    listed_runtime_thread_id: "runtime-1",
    controller_read_thread_id: "controller-1",
    runtime_read_thread_id: "runtime-1",
    runtime_send_thread_id: "runtime-1",
    runtime_resume_turn_id: "turn-1",
    controller_pinned: true,
    runtime_pinned: true,
    controller_active: true,
    runtime_resumed: true,
  },
};
const start = compileInScopeLocalCampaignStart({
  bootstrapBinding: {
    status: JSA_PLAN_STATUS,
    operating_mode: "JSA",
    recorded_plan_is_launch_gate: true,
    separate_owner_approval_required: false,
    owner_approval_pause: false,
    project_root: process.cwd(),
    source_commit: "1".repeat(40),
    source_tree: "2".repeat(40),
    plan_sha256: "3".repeat(64),
  },
  safetyAnalysis: jsa,
  hostReadbacks,
  observedAtUtc: "2026-08-05T20:30:00.000Z",
});
assert.equal(start.action, LOCAL_CAMPAIGN_START_ACTION);
assert.equal(start.status, "CAMPAIGN_STARTED_EMPTY_ROSTER");
assert.equal(start.owner_approval_pause, false);
assert.equal(start.active_campaign, true);
assert.equal(start.active_worker_count, 0);
assert.deepEqual(start.protected_actions, {
  publication: false,
  push: false,
  merge: false,
  deployment: false,
  spending: false,
  remote_authentication: false,
  secrets: false,
  destructive_overwrite: false,
  product_custody: false,
  product_write: false,
  generic_campaign_activation: false,
});
assert.equal(start.start_sha256.length, 64);
assert.throws(() => compileInScopeLocalCampaignStart({
  bootstrapBinding: {...start, status: JSA_PLAN_STATUS, operating_mode: "JSA", recorded_plan_is_launch_gate: false, separate_owner_approval_required: true, owner_approval_pause: true, plan_sha256: start.plan_sha256, project_root: start.project_root, source_commit: start.source_commit, source_tree: start.source_tree},
  safetyAnalysis: jsa,
  hostReadbacks,
  observedAtUtc: "2026-08-05T20:30:00.000Z",
}), /approval-only path/u);
assert.throws(
  () => validateBootstrapActionScope(["CAMPAIGN_ACTIVATION"], jsa),
  /JSA_HARD_BOUNDARY_PROTECTED_ACTION/u,
);
assert.throws(
  () => validateBootstrapActionScope(["PUSH"], jsa),
  /JSA_HARD_BOUNDARY_PROTECTED_ACTION/u,
);
assert.throws(
  () => validateBootstrapActionScope(["CREATE_CONTROL_PLANE_STAGING", "DEPLOYMENT"], jsa),
  /JSA_HARD_BOUNDARY_PROTECTED_ACTION/u,
);
assert.throws(
  () => validateBootstrapActionScope(["REMOTE_READ", "RUN_SETUP_AUDIT"], jsa),
  /JSA_REASSESS_REQUIRED_OUT_OF_SCOPE/u,
);

const exact = compileBootstrapSafetyAnalysis({
  operatingMode: "EXACT_PLAN_APPROVAL",
  authorityBoundaries,
  deliveryPolicy,
  projectLifeContract,
});
assert.equal(exact.operating_mode, "EXACT_PLAN_APPROVAL");
assert.equal(exact.safety_sha256.length, 64);
assert.notEqual(exact.safety_sha256, jsa.safety_sha256);

console.log("PASS Bootstrap JSA safety analysis: bounded continuation, reassessment, protected actions, and exact-mode fallback verified");
