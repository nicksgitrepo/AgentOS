#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileControllerPlanningProgress} from "../control/local-self-development-supervisor-adapter.mjs";
import {supervisorDigest} from "../control/controller-supervisor.mjs";

const goal = {project_id: "PROJECT", campaign_id: "CAMPAIGN-1", campaign_version: "v1", goal_id: "CONTROLLER-GOAL-1", goal_sha256: "a".repeat(64)};
const progress = compileControllerPlanningProgress({goal, taskId: "TASK-1", sourceCommit: "b".repeat(40), sourceTree: "c".repeat(40), phase: "ORCHESTRATOR_REVIEW", message: "The Controller selected one bounded repair.", nextAction: "The Campaign Orchestrator is selecting the exact repair.", updatedAtUtc: "2026-01-01T00:00:00.000Z"});
assert.equal(progress.schema, "agentos.controller_planning_progress.v1");
assert.equal(progress.status, "IN_PROGRESS");
assert.equal(progress.phase, "ORCHESTRATOR_REVIEW");
assert.equal(progress.next_action, "The Campaign Orchestrator is selecting the exact repair.");
assert.equal(progress.progress_sha256, supervisorDigest({...progress, progress_sha256: null}));
assert.throws(() => compileControllerPlanningProgress({goal, taskId: "TASK-1", sourceCommit: "b".repeat(40), sourceTree: "c".repeat(40), phase: "UNKNOWN", message: "The Controller selected one bounded repair.", nextAction: "The Campaign Orchestrator is selecting the exact repair."}), /phase is invalid/u);
console.log("PASS Controller exposes concise source-bound planning progress and next action");
