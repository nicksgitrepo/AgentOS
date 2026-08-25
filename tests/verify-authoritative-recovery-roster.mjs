#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileRecoveryManifest,
  compileRecoveryRoster,
  classifyTaskCustody,
  validatePermanentRoster,
  validateRecoveryManifest,
  validateRecoveryRoster,
} from "../control/authoritative-recovery-roster.mjs";

const permanent = {schema: "agentos.permanent_agent_roster.v1", agents: [
  {role_id: "CONTROLLER", task_id: "TASK-CONTROLLER", worktree: "/worktrees/controller"},
  {role_id: "SENTINEL", task_id: "TASK-SENTINEL", worktree: null},
]};
validatePermanentRoster(permanent);
assert.equal(classifyTaskCustody({task: {task_id: "TASK-CONTROLLER", role_id: "CONTROLLER", worktree: "/worktrees/controller"}, permanentRoster: permanent}).classification, "PERMANENT_EXEMPT");
assert.equal(classifyTaskCustody({task: {task_id: "TASK-SENTINEL", role_id: "SENTINEL", worktree: "/wrong"}, permanentRoster: permanent}).classification, "TEMPORARY_PENDING_RECONCILIATION");
assert.throws(() => validatePermanentRoster({schema: permanent.schema, agents: [...permanent.agents, permanent.agents[0]]}), /duplicate permanent role|task/u);
assert.throws(() => validatePermanentRoster({schema: permanent.schema, agents: [{role_id: "A", task_id: "A", worktree: "/same"}, {role_id: "B", task_id: "B", worktree: "/same"}]}), /duplicate non-null/u);

const roster = compileRecoveryRoster({
  observedTasks: [
    {task_id: "TASK-CONTROLLER", role_id: "CONTROLLER", worktree: "/worktrees/controller", status: "active"},
    {task_id: "TASK-ORPHAN", role_id: "UNKNOWN", worktree: "/worktrees/orphan", status: "active"},
  ],
  permanentRoster: permanent,
  processes: [],
  artifacts: [],
});
validateRecoveryRoster(roster);
assert.equal(roster.counters.unaccounted_count, 1);
const manifest = compileRecoveryManifest({roster, candidate: {tree: "a".repeat(40)}, changedPaths: ["control/a.mjs", "tests/a.mjs"]});
validateRecoveryManifest(manifest);
assert.throws(() => validateRecoveryManifest({...manifest, paths: ["tests/a.mjs", "control/a.mjs"]}), /sorted/u);

console.log("PASS authoritative recovery roster: exact role/task/worktree exemption, null-worktree fail-closed behavior, duplicate/cross-binding rejection, and digest-bound manifest");
