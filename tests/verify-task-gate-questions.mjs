#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  TASK_GATE_QUESTIONS,
  TASK_GATE_CONTEXTS,
  TASK_GATE_APPLICABILITY_EVIDENCE_KEY,
  TASK_GATE_CATALOG_SHA256,
  taskGateQuestionIds,
  taskGateQuestionsFor,
  validateTaskGateAnswerSet,
  validateTaskGateQuestionCatalog,
} from "../control/task-gate-questions.mjs";
import {
  compileGovernanceDecisionTree,
  evaluateGovernanceDecisionTree,
  evaluateTaskGateQuestions,
  validateGovernanceDecisionTree,
} from "../control/governance-decision-tree.mjs";
import {controllerDigest} from "../control/agentos-controller.mjs";

const SOURCE_COMMIT = "1".repeat(40);
const SOURCE_TREE = "2".repeat(40);
const GOAL_SHA = "a".repeat(64);
const RESULT_SHA = "b".repeat(64);
const binding = {
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  worktree_id: "worktree-task-gates",
  session_id: "session-task-gates",
  goal_id: "goal-task-gates",
  goal_sha256: GOAL_SHA,
  build_identity: "build-task-gates",
  environment_id: "environment-task-gates",
};

function evidence(question, evidenceKey, overrides = {}) {
  return {
    evidence_key: evidenceKey,
    question_id: question.question_id,
    ...binding,
    observed_at_utc: "2026-08-05T00:00:00.000Z",
    result_sha256: RESULT_SHA,
    status: "PASS",
    ...overrides,
  };
}

function answersFor(context, answer = null) {
  return Object.fromEntries(taskGateQuestionsFor(context).map((question) => [
    question.question_id,
    {
      answer: answer ?? question.pass_answer,
      evidence: Object.fromEntries(question.required_evidence.map((key) => [key, evidence(question, key)])),
      failure: null,
      recheck: null,
    },
  ]));
}

assert.equal(TASK_GATE_QUESTIONS.length, 15);
assert.deepEqual(TASK_GATE_QUESTIONS.map((question) => question.question_id), [
  "TASK-START-001", "TASK-START-002", "TASK-START-003", "TASK-START-004", "TASK-START-005", "TASK-START-006", "TASK-START-007",
  "TASK-CHANGE-008", "TASK-CHANGE-009", "TASK-PROOF-010", "TASK-PROOF-011", "TASK-PROOF-012", "TASK-PROGRESS-013", "TASK-ACCEPTANCE-014", "TASK-CLOSURE-015",
]);
assert(TASK_GATE_QUESTIONS.every((question) => question.question.endsWith("?")));
validateTaskGateQuestionCatalog();
for (const context of TASK_GATE_CONTEXTS) assert.deepEqual(taskGateQuestionIds(context), taskGateQuestionsFor(context).map((question) => question.question_id));

const tree = compileGovernanceDecisionTree({
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  ownerIntentSha256: GOAL_SHA,
  scopeSha256: RESULT_SHA,
  featureFiles: ["control/task-gate-questions.mjs"],
});
validateGovernanceDecisionTree(tree);
assert.equal(tree.task_gate_catalog_sha256, TASK_GATE_CATALOG_SHA256);
assert.deepEqual(tree.task_gate_questions, TASK_GATE_QUESTIONS);

const taskStartAnswers = answersFor("TASK_START");
assert.equal(validateTaskGateAnswerSet({context: "TASK_START", answers: taskStartAnswers, expectedBinding: binding}).status, "PASS");
assert.equal(evaluateTaskGateQuestions({tree, context: "TASK_START", answers: taskStartAnswers}).status, "PASS");

const notApplicableAnswers = answersFor("TASK_START");
const notApplicableQuestion = TASK_GATE_QUESTIONS.find((question) => question.question_id === "TASK-START-001");
notApplicableAnswers[notApplicableQuestion.question_id] = {
  answer: "NOT_APPLICABLE",
  evidence: {
    ...notApplicableAnswers[notApplicableQuestion.question_id].evidence,
    [TASK_GATE_APPLICABILITY_EVIDENCE_KEY]: evidence(notApplicableQuestion, TASK_GATE_APPLICABILITY_EVIDENCE_KEY),
  },
  failure: null,
  recheck: null,
};
assert.equal(validateTaskGateAnswerSet({context: "TASK_START", answers: notApplicableAnswers, expectedBinding: binding}).status, "PASS");
assert.equal(evaluateTaskGateQuestions({tree, context: "TASK_START", answers: notApplicableAnswers}).status, "PASS");
const missingApplicabilityEvidence = structuredClone(notApplicableAnswers);
delete missingApplicabilityEvidence[notApplicableQuestion.question_id].evidence[TASK_GATE_APPLICABILITY_EVIDENCE_KEY];
assert.throws(() => validateTaskGateAnswerSet({context: "TASK_START", answers: missingApplicabilityEvidence}), /fields mismatch/u);
assert.equal(evaluateTaskGateQuestions({tree, context: "CODE_CHANGE", answers: answersFor("CODE_CHANGE")}).status, "PASS");
assert.equal(evaluateTaskGateQuestions({tree, context: "DOCUMENTATION", answers: answersFor("DOCUMENTATION")}).status, "PASS");
assert.equal(evaluateTaskGateQuestions({tree, context: "HANDOFF", answers: answersFor("HANDOFF")}).status, "PASS");
assert.equal(evaluateTaskGateQuestions({tree, context: "RESPONSE", answers: answersFor("RESPONSE")}).status, "PASS");
assert.equal(evaluateTaskGateQuestions({tree, context: "CLOSURE", answers: answersFor("CLOSURE")}).status, "PASS");

const scopeViolation = answersFor("DOCUMENTATION");
scopeViolation["TASK-CHANGE-008"] = {
  answer: "YES",
  evidence: scopeViolation["TASK-CHANGE-008"].evidence,
  failure: {
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    reason: "The documentation changed an unapproved path.",
    route: "CONTINUE_SCOPE_CHECK",
    recheck_question_id: "TASK-CHANGE-008",
  },
  recheck: null,
};
assert.equal(evaluateTaskGateQuestions({tree, context: "DOCUMENTATION", answers: scopeViolation}).status, "REPAIR_REQUIRED");

const missing = {...taskStartAnswers};
delete missing["TASK-START-004"];
assert.equal(evaluateTaskGateQuestions({tree, context: "TASK_START", answers: missing}).status, "BLOCKED");

const repairable = answersFor("TASK_START");
repairable["TASK-START-005"] = {
  answer: "NO",
  evidence: repairable["TASK-START-005"].evidence,
  failure: {
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    reason: "The baseline is not reproducible yet.",
    route: "RECON_OR_REFRAME_TASK",
    recheck_question_id: "TASK-START-005",
  },
  recheck: null,
};
assert.equal(evaluateTaskGateQuestions({tree, context: "TASK_START", answers: repairable}).status, "REPAIR_REQUIRED");

const mismatched = answersFor("TASK_START");
mismatched["TASK-START-001"].evidence.ONE_OBSERVABLE_BEHAVIOR.goal_sha256 = "c".repeat(64);
assert.throws(() => evaluateTaskGateQuestions({tree, context: "TASK_START", answers: mismatched}), /evidence identity differs/);

const internallyMismatched = answersFor("TASK_START");
internallyMismatched["TASK-START-004"].evidence.ENVIRONMENT_READBACK.environment_id = "other-environment";
assert.throws(() => evaluateTaskGateQuestions({tree, context: "TASK_START", answers: internallyMismatched}), /identity differs within/);

function rootEvidence(key) {
  const observed = {
    command: `TASK-GATE-ROOT-${key}`,
    exit_code: 0,
    stdout_sha256: RESULT_SHA,
    stderr_sha256: RESULT_SHA,
    status: "PASS",
  };
  const record = {
    schema: "agentos.governance_gate_evidence.v1",
    version: 1,
    evidence_key: key,
    source_commit: SOURCE_COMMIT,
    source_tree: SOURCE_TREE,
    check_id: `TASK-GATE-ROOT-${key}`,
    observed,
    result_sha256: controllerDigest(observed),
    evidence_sha256: null,
  };
  record.evidence_sha256 = controllerDigest({...record, evidence_sha256: null});
  return record;
}

const rootAnswers = Object.fromEntries(tree.gates.map((gate) => [gate.gate_id, {
  answer: "YES",
  evidence: Object.fromEntries(gate.evidence_requirements.map((key) => [key, rootEvidence(key)])),
  failure: null,
  recheck: null,
}]));
const combined = evaluateGovernanceDecisionTree({tree, answers: rootAnswers, taskGateAnswers: taskStartAnswers});
assert.equal(combined.task_gate_evaluation.status, "PASS");
assert.equal(combined.status, "PASS");

console.log("task gate question catalog and decision-tree integration: PASS");
