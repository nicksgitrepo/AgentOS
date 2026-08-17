#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  STOP_WORKFLOW_QUESTIONS,
  STOP_WORKFLOW_OUTCOMES,
  compileStopWorkflowNoStopAnswers,
  evaluateStopWorkflowGate,
  validateStopWorkflowDecision,
} from "../control/stop-workflow-gate.mjs";
import {selectAutonomousNextTask} from "../control/controller-supervisor.mjs";

const base = {
  decisionId: "DECISION.STOP_WORKFLOW.TEST",
  actionRef: "ref:action/test",
  rollbackRef: "ref:rollback/test",
};

const noAnswers = compileStopWorkflowNoStopAnswers({evidenceRefPrefix: "ref:evidence/stop-gate"});
const continueDecision = evaluateStopWorkflowGate({...base, answers: noAnswers});
assert.equal(continueDecision.outcome, "CONTINUE_AUTONOMOUS");
assert.equal(continueDecision.stop, false);
assert.equal(continueDecision.next_action, "CONTINUE_NEXT_ACTION");
assert.deepEqual(continueDecision.triggered_question_ids, []);
assert.deepEqual(continueDecision.unknown_question_ids, []);
validateStopWorkflowDecision(continueDecision);

function withAnswer(questionId, answer) {
  return noAnswers.map((entry) => entry.question_id === questionId ? {...entry, answer} : entry);
}

const costStop = evaluateStopWorkflowGate({...base, decisionId: "DECISION.STOP_WORKFLOW.COST", answers: withAnswer("COSTS_MONEY", "YES")});
assert.equal(costStop.outcome, "STOP_OWNER_DECISION");
assert.equal(costStop.next_action, "STOP_DEPENDENT_WORK_OWNER_REVIEW");
assert.equal(costStop.owner_decision_required, true);
assert.deepEqual(costStop.triggered_question_ids, ["COSTS_MONEY"]);

const projectStop = evaluateStopWorkflowGate({...base, decisionId: "DECISION.STOP_WORKFLOW.PROJECT", answers: withAnswer("CHANGES_PROTECTED_PROJECT_OR_SCOPE", "YES")});
assert.equal(projectStop.outcome, "STOP_OWNER_DECISION");
assert.equal(projectStop.primary_trigger_question_id, "CHANGES_PROTECTED_PROJECT_OR_SCOPE");

const deleteStop = evaluateStopWorkflowGate({...base, decisionId: "DECISION.STOP_WORKFLOW.DELETE", answers: withAnswer("DELETES_UNSAVED_OR_UNBACKED_UP_WORK", "YES")});
assert.equal(deleteStop.outcome, "STOP_DESTRUCTIVE_BOUNDARY");
assert.equal(deleteStop.next_action, "STOP_DEPENDENT_WORK_DESTRUCTIVE_REVIEW");
assert.equal(deleteStop.owner_decision_required, false);

const destroyStop = evaluateStopWorkflowGate({...base, decisionId: "DECISION.STOP_WORKFLOW.DESTROY", answers: withAnswer("DESTROYS_OR_IRREVERSIBLY_MODIFIES", "YES")});
assert.equal(destroyStop.outcome, "STOP_DESTRUCTIVE_BOUNDARY");

const hardDecisionStop = evaluateStopWorkflowGate({...base, decisionId: "DECISION.STOP_WORKFLOW.OWNER", answers: withAnswer("OWNER_DECISION_REQUIRED", "YES")});
assert.equal(hardDecisionStop.outcome, "STOP_OWNER_DECISION");
assert.equal(hardDecisionStop.primary_trigger_question_id, "OWNER_DECISION_REQUIRED");

const unknown = evaluateStopWorkflowGate({...base, decisionId: "DECISION.STOP_WORKFLOW.UNKNOWN", answers: withAnswer("COSTS_MONEY", "UNKNOWN")});
assert.equal(unknown.outcome, "EVIDENCE_REQUIRED");
assert.equal(unknown.stop, false);
assert.equal(unknown.next_action, "RUN_NEXT_BOUNDED_RECOVERY");
assert.deepEqual(unknown.unknown_question_ids, ["COSTS_MONEY"]);

const multipleTriggers = evaluateStopWorkflowGate({
  ...base,
  decisionId: "DECISION.STOP_WORKFLOW.MULTIPLE",
  answers: withAnswer("COSTS_MONEY", "YES").map((entry) => entry.question_id === "DESTROYS_OR_IRREVERSIBLY_MODIFIES" ? {...entry, answer: "YES"} : entry),
});
assert.deepEqual(multipleTriggers.triggered_question_ids, ["COSTS_MONEY", "DESTROYS_OR_IRREVERSIBLY_MODIFIES"]);
assert.equal(multipleTriggers.primary_trigger_question_id, "COSTS_MONEY");

const boundary = {
  hard_stop: false,
  soft_review: false,
  owner_decision_required: false,
  scope_changed: false,
  local_development_writes_allowed: true,
  local_worker_agent_spawns_allowed: true,
  product_writes_allowed: false,
  product_agent_spawns_allowed: false,
  external_deployment_allowed: false,
  external_release_allowed: false,
  external_publication_allowed: false,
  external_push_allowed: false,
  external_merge_allowed: false,
  secrets_allowed: false,
  destructive_work_allowed: false,
};
const safeTask = [{task_id: "TASK.SAFE", status: "OPEN", priority: 1, summary: "Safe local repair", scope: ["CONTROL_PLANE"], owner_decision_required: false}];
const stopSelection = selectAutonomousNextTask({tasks: safeTask, boundary, findings: [], activeCampaign: true, stopDecision: costStop});
assert.equal(stopSelection.action, "STOP_HARD_BOUNDARY");
const recoverySelection = selectAutonomousNextTask({tasks: safeTask, boundary, findings: [], activeCampaign: true, stopDecision: unknown});
assert.equal(recoverySelection.action, "ROUTE_REPAIRABLE_PUZZLE");
const normalSelection = selectAutonomousNextTask({tasks: safeTask, boundary, findings: [], activeCampaign: true, stopDecision: continueDecision});
assert.equal(normalSelection.task_id, "TASK.SAFE");

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/stop-workflow-gate.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, "https://agentos.dev/schemas/stop-workflow-gate.v1.json");
assert.deepEqual(schema.properties.question_order.const, STOP_WORKFLOW_QUESTIONS.map(({question_id}) => question_id));
assert.deepEqual([...STOP_WORKFLOW_OUTCOMES].sort(), [...schema.properties.outcome.enum].sort());
for (const relative of ["control/stop-workflow-gate.mjs", "schemas/stop-workflow-gate.v1.json"]) {
  const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  assert(!/Sociuna|JobSight|WellSight/iu.test(source), `${relative} contains consumer-specific policy`);
}

const tampered = {...continueDecision, stop: true, decision_sha256: continueDecision.decision_sha256};
assert.throws(() => validateStopWorkflowDecision(tampered), /stop|digest|decision tree/iu);
assert.throws(() => evaluateStopWorkflowGate({...base, decisionId: "DECISION.STOP_WORKFLOW.INCOMPLETE", answers: noAnswers.slice(0, -1)}), /cover all five|incomplete/u);
assert.throws(() => evaluateStopWorkflowGate({...base, decisionId: "DECISION.STOP_WORKFLOW.BAD", answers: noAnswers.map((entry, index) => index === 1 ? {...entry, question_id: "OWNER_DECISION_REQUIRED"} : entry)}), /out of order/u);

console.log("PASS stop-workflow gate: five-question fail-closed decision tree, unknown-evidence recovery, destructive/owner stops, and Controller selection binding");
