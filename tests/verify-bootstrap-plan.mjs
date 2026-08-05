#!/usr/bin/env node

import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace_boundary = compileWorkspaceBoundary({release_root: "/workspace/AgentOS", projects_root: "/workspace/projects", project_root: "/workspace/projects/example-project", control_root: "/workspace/AgentOS-control"});
const plan = await compileBootstrapPlan(ROOT, {
  project_id: "PROJECT-001",
  owner_context: {objective: "Make a small helpful tool", audience: "people", finish: "show me the prototype"},
  source_binding: {
    source_commit: "a".repeat(40),
    source_tree: "b".repeat(40),
    worktree_id: "WORKTREE-001",
    bootstrap_session_id: "BOOTSTRAP-SESSION-001",
    environment_id: "ENVIRONMENT-001",
  },
  workspace_boundary,
});
assert.equal(plan.mode, "RAPID_PROTOTYPING");
assert.equal(plan.next_mode, "ITERATION");
assert.equal(plan.defaults.model, "gpt-5.6-luna");
assert.equal(plan.defaults.reasoning_effort, "max");
assert.equal(plan.defaults.progress_window_minutes, 15);
assert.equal(plan.conversation.numeric_answers, true);
assert.equal(plan.conversation.boolean_answers, true);
assert.equal(plan.conversation.technical_terms_hidden, true);
assert.equal(plan.activation.unchanged_in_scope_work, "CONTINUE_AFTER_JSA_REASSESSMENT");
assert.equal(plan.phases.length, 4);
assert.equal(new Set(plan.phases.flatMap((phase) => phase.lane_ids)).size, 12);
assert(plan.protected_actions.includes("PUBLISH"));
assert.equal(plan.workspace_boundary.control_repository_policy, "CREATE_SIBLING_REPOSITORY_BEFORE_ANY_WRITE");
assert(!JSON.stringify(plan).includes("APPROVE_EXACT_PLAN"));
console.log(JSON.stringify({status: "PASS", mode: plan.mode, next_mode: plan.next_mode, phases: plan.phases.map((phase) => phase.phase_id)}));
