#!/usr/bin/env node

import assert from "node:assert/strict";
import {selectValidatedAutonomousTask} from "../control/local-self-development-supervisor-adapter.mjs";

const boundary = {hard_stop: false, soft_review: false, owner_decision_required: false, scope_changed: false, local_development_writes_allowed: true, local_worker_agent_spawns_allowed: true, product_writes_allowed: false, product_agent_spawns_allowed: false, external_deployment_allowed: false, external_release_allowed: false, external_publication_allowed: false, external_push_allowed: false, external_merge_allowed: false, secrets_allowed: false, destructive_work_allowed: false};
const tasks = [{task_id: "CONTROLLER-TASK-FIRST", status: "OPEN", priority: 0, summary: "First bounded task.", scope: ["CONTROL_PLANE"], owner_decision_required: false}, {task_id: "CONTROLLER-TASK-LATER", status: "OPEN", priority: 1, summary: "Later bounded task.", scope: ["CONTROL_PLANE"], owner_decision_required: false}];
const selection = selectValidatedAutonomousTask({tasks, boundary, findings: [], activeCampaign: true});
assert.equal(selection.action, "ROUTE_REPAIRABLE_PUZZLE");
assert.equal(selection.task_id, "CONTROLLER-TASK-FIRST");
const ownerDecisionTask = [{...tasks[0], owner_decision_required: true}];
assert.equal(selectValidatedAutonomousTask({tasks: ownerDecisionTask, boundary, findings: [], activeCampaign: true}).action, "STOP_HARD_BOUNDARY");
const higherPriorityPuzzle = [{finding_id: "F-REPAIR", classification: "REPAIRABLE_ENGINEERING_PUZZLE", status: "OPEN_REPAIR_REQUIRED", summary: "Repair first.", source_sha256: "a".repeat(64)}];
assert.equal(selectValidatedAutonomousTask({tasks, boundary, findings: higherPriorityPuzzle, activeCampaign: true}).task_id, null);
console.log("PASS Controller selects one validated queued task without a manual task declaration");
