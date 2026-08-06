#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {createGoal} from "../control/campaign-state.mjs";
import {prepareAgentOS3Launch, validateAgentOS3Launch} from "../control/agentos-3.mjs";
import {parseOwnerAnswer} from "../control/owner-conversation.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace_parent = path.dirname(ROOT);
const projects_root = path.join(workspace_parent, "projects");
const control_root = path.join(workspace_parent, "AgentOS-control");
const workspace_boundary = compileWorkspaceBoundary({
  release_root: ROOT,
  projects_root,
  project_root: path.join(projects_root, "example-project"),
  control_root,
  worktrees_root: path.join(control_root, "worktrees"),
});
const source = {
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
  worktree_id: "WORKTREE-3-0",
  environment_id: "ENV-3-0",
};
const plan = await compileBootstrapPlan(ROOT, {
  project_id: "PROJECT-3-0",
  owner_context: {objective: "Build a friendly governed release"},
  source_binding: {...source, bootstrap_session_id: "BOOTSTRAP-3-0"},
  workspace_boundary,
});
const goal = createGoal({
  goal_id: "GOAL-3-0-LAUNCH",
  objective: "Build a friendly governed release",
  scope: {prototype: true},
  intent: {outcome: "a working audited result"},
  boundaries: {hard: ["no private data in records"], soft: ["review changes"],},
  created_at_utc: "2026-01-01T00:00:00.000Z",
});

const launch = prepareAgentOS3Launch({
  activation_id: "ACTIVATION-3-0-LAUNCH",
  bootstrap_plan: plan,
  goal,
  campaign_id: "CAMPAIGN-3-0-TB-06",
  campaign_version: "v3.0.3-tb-06",
  protected_actions: ["PUSH", "MERGE"],
});

assert.equal(launch.schema, "agentos.3_launch.v1");
assert.equal(launch.status, "PREPARED_NOT_ACTIVATED");
assert.equal(launch.launch_answer_value, "START_LOCAL_CAMPAIGN");
assert.equal(launch.continuation.status, "WAITING_OWNER");
assert.equal(launch.question.prompt, "Would you like me to start building the first version now?");
assert.equal(parseOwnerAnswer(launch.question, "1").value, "START_LOCAL_CAMPAIGN");
assert.equal(parseOwnerAnswer(launch.question, "2").value, "KEEP_PREPARED");
assert.equal(JSON.stringify(launch).includes(ROOT), false);
assert.equal(JSON.stringify(launch).includes("secret"), false);
assert.doesNotThrow(() => validateAgentOS3Launch(launch));
assert.throws(() => validateAgentOS3Launch({...launch, launch_answer_value: "OTHER"}), /does not offer its launch value/u);

console.log(JSON.stringify({status: "PASS", schema: launch.schema, question: launch.question.question_id, continuation: launch.continuation.status}));
