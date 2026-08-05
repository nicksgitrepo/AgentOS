#!/usr/bin/env node

import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {compileCampaignAdmission, toNativeAdmission} from "../control/campaign-admission.mjs";
import {createGoal} from "../control/campaign-state.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace_boundary = compileWorkspaceBoundary({release_root: "/workspace/AgentOS", projects_root: "/workspace/projects", project_root: "/workspace/projects/example-project", control_root: "/workspace/AgentOS-control"});
const plan = await compileBootstrapPlan(ROOT, {
  project_id: "PROJECT-001",
  owner_context: {objective: "Make a small helpful tool"},
  source_binding: {
    source_commit: "a".repeat(40),
    source_tree: "b".repeat(40),
    worktree_id: "WORKTREE-001",
    bootstrap_session_id: "BOOTSTRAP-SESSION-001",
    environment_id: "ENVIRONMENT-001",
  },
  workspace_boundary,
});
const goal = createGoal({
  goal_id: "GOAL-001",
  objective: "Build the first bounded result",
  scope: {lane: "functionality"},
  intent: {outcome: "works"},
  boundaries: {hard: ["no release"], soft: ["review"]},
  created_at_utc: "2026-01-01T00:00:00.000Z",
});
const admission = compileCampaignAdmission({
  plan,
  goal,
  project_id: "PROJECT-001",
  campaign_id: "CAMPAIGN-001",
  campaign_version: "CAMPAIGN-V1",
  lane_id: "functionality",
  source: {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001", environment_id: "ENVIRONMENT-001"},
  task_name: "functionality_worker_001",
  prompt: "Build the admitted functionality and return evidence.",
});
assert.equal(admission.phase_id, "RAPID_BUILD");
assert.equal(admission.role_display_name, "functionality Worker");
assert.equal(admission.progress_window_minutes, 15);
const native = toNativeAdmission(admission);
assert.equal(native.lane_id, "functionality");
assert.equal(native.workspace_boundary.control_root, "/workspace/AgentOS-control");
assert.equal(native.goal_sha256, goal.digest);
assert.equal(native.source_commit, admission.source.source_commit);
assert.throws(() => compileCampaignAdmission({plan, goal, project_id: "PROJECT-001", campaign_id: "CAMPAIGN-002", campaign_version: "CAMPAIGN-V1", lane_id: "not-a-lane", source: admission.source, task_name: "functionality_worker_002", prompt: "x"}), /not in the bootstrap plan/u);
console.log(JSON.stringify({status: "PASS", phase_id: admission.phase_id, lane_id: admission.lane_id}));
