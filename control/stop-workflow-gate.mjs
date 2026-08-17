#!/usr/bin/env node

/*
 * Project-agnostic stop-workflow gate.
 *
 * The Controller may stop only when a typed answer proves one of the five
 * owner-protected conditions.  An UNKNOWN answer is not permission to stop
 * and is not permission to continue the dependent action: it routes one
 * bounded evidence-recovery step instead.  This keeps ordinary development
 * moving while making cost, protected project changes, data loss, destruction,
 * and genuinely owner-level decisions fail closed.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const STOP_WORKFLOW_GATE_SCHEMA = "agentos.stop_workflow_gate.v1";
export const STOP_WORKFLOW_GATE_VERSION = 1;

export const STOP_WORKFLOW_QUESTIONS = Object.freeze([
  Object.freeze({
    question_id: "COSTS_MONEY",
    question: "Does this action spend money or consume a paid external allowance?",
    yes_outcome: "STOP_OWNER_DECISION",
    reason: "The action has material financial or paid-provider consequences.",
  }),
  Object.freeze({
    question_id: "CHANGES_PROTECTED_PROJECT_OR_SCOPE",
    question: "Does this action change the protected/shared project or expand product intent?",
    yes_outcome: "STOP_OWNER_DECISION",
    reason: "The action changes protected project state or product scope.",
  }),
  Object.freeze({
    question_id: "DELETES_UNSAVED_OR_UNBACKED_UP_WORK",
    question: "Does this action delete work that is not saved and backed up?",
    yes_outcome: "STOP_DESTRUCTIVE_BOUNDARY",
    reason: "The action could remove work without a verified recovery copy.",
  }),
  Object.freeze({
    question_id: "DESTROYS_OR_IRREVERSIBLY_MODIFIES",
    question: "Does this action destroy or irreversibly modify anything?",
    yes_outcome: "STOP_DESTRUCTIVE_BOUNDARY",
    reason: "The action is destructive or cannot be safely rolled back.",
  }),
  Object.freeze({
    question_id: "OWNER_DECISION_REQUIRED",
    question: "Is this genuinely too difficult or route-changing for the Controller to decide within its authority?",
    yes_outcome: "STOP_OWNER_DECISION",
    reason: "The action requires a protected owner choice rather than routine judgment.",
  }),
]);

export const STOP_WORKFLOW_ANSWER_VALUES = Object.freeze(["YES", "NO", "UNKNOWN"]);
export const STOP_WORKFLOW_OUTCOMES = Object.freeze([
  "CONTINUE_AUTONOMOUS",
  "EVIDENCE_REQUIRED",
  "STOP_OWNER_DECISION",
  "STOP_DESTRUCTIVE_BOUNDARY",
]);
export const STOP_WORKFLOW_NEXT_ACTIONS = Object.freeze([
  "CONTINUE_NEXT_ACTION",
  "RUN_NEXT_BOUNDED_RECOVERY",
  "STOP_DEPENDENT_WORK_OWNER_REVIEW",
  "STOP_DEPENDENT_WORK_DESTRUCTIVE_REVIEW",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const REFERENCE = /^(?:opaque:|ref:)[A-Za-z0-9._:/-]+$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;

const QUESTION_IDS = Object.freeze(STOP_WORKFLOW_QUESTIONS.map(({question_id}) => question_id));
const QUESTION_BY_ID = new Map(STOP_WORKFLOW_QUESTIONS.map((question) => [question.question_id, question]));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable uppercase identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque or content-addressed reference`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

function validateQuestionOrder(questionOrder) {
  assert(Array.isArray(questionOrder), "Stop-workflow question order is required");
  assert(JSON.stringify(questionOrder) === JSON.stringify(QUESTION_IDS), "Stop-workflow question order is not canonical");
}

function validateAnswer(answer, index) {
  exactKeys(answer, ["question_id", "answer", "evidence_refs"], `Stop-workflow answer ${index}`);
  assert(answer.question_id === QUESTION_IDS[index], `Stop-workflow answer ${index} is out of order`);
  assert(STOP_WORKFLOW_ANSWER_VALUES.includes(answer.answer), `Stop-workflow answer ${answer.question_id} is invalid`);
  assert(Array.isArray(answer.evidence_refs) && answer.evidence_refs.length > 0, `Stop-workflow answer ${answer.question_id} evidence is required`);
  answer.evidence_refs.forEach((reference, referenceIndex) => requireReference(reference, `Stop-workflow answer ${answer.question_id} evidence ${referenceIndex}`));
  sortedUnique(answer.evidence_refs, `Stop-workflow answer ${answer.question_id} evidence`);
  return answer;
}

function expectedOutcome(answers) {
  const unknown = [];
  const triggered = [];
  for (const answer of answers) {
    if (answer.answer === "UNKNOWN") unknown.push(answer.question_id);
    if (answer.answer === "YES") triggered.push(answer.question_id);
  }
  if (triggered.length > 0) {
    const primary = QUESTION_BY_ID.get(triggered[0]);
    return {
      outcome: primary.yes_outcome,
      primary_trigger_question_id: primary.question_id,
      triggered_question_ids: triggered,
      unknown_question_ids: unknown,
      next_action: primary.yes_outcome === "STOP_DESTRUCTIVE_BOUNDARY"
        ? "STOP_DEPENDENT_WORK_DESTRUCTIVE_REVIEW"
        : "STOP_DEPENDENT_WORK_OWNER_REVIEW",
      stop: true,
      owner_decision_required: primary.yes_outcome === "STOP_OWNER_DECISION",
      reason: triggered.map((questionId) => QUESTION_BY_ID.get(questionId).reason).join(" "),
    };
  }
  if (unknown.length > 0) {
    return {
      outcome: "EVIDENCE_REQUIRED",
      primary_trigger_question_id: null,
      triggered_question_ids: [],
      unknown_question_ids: unknown,
      next_action: "RUN_NEXT_BOUNDED_RECOVERY",
      stop: false,
      owner_decision_required: false,
      reason: "A stop question is unknown; gather bounded evidence before deciding, without stopping the whole workflow.",
    };
  }
  return {
    outcome: "CONTINUE_AUTONOMOUS",
    primary_trigger_question_id: null,
    triggered_question_ids: [],
    unknown_question_ids: [],
    next_action: "CONTINUE_NEXT_ACTION",
    stop: false,
    owner_decision_required: false,
    reason: "All five stop questions are explicitly NO; continue the next governed action.",
  };
}

export function validateStopWorkflowDecision(decision) {
  exactKeys(decision, [
    "schema", "version", "decision_id", "action_ref", "rollback_ref", "question_order", "answers", "outcome",
    "primary_trigger_question_id", "triggered_question_ids", "unknown_question_ids", "next_action", "stop",
    "owner_decision_required", "reason", "decision_sha256",
  ], "Stop-workflow decision");
  assert(decision.schema === STOP_WORKFLOW_GATE_SCHEMA && decision.version === STOP_WORKFLOW_GATE_VERSION, "Stop-workflow decision identity is invalid");
  requireIdentifier(decision.decision_id, "Stop-workflow decision ID");
  requireReference(decision.action_ref, "Stop-workflow action reference");
  requireReference(decision.rollback_ref, "Stop-workflow rollback reference");
  validateQuestionOrder(decision.question_order);
  assert(Array.isArray(decision.answers) && decision.answers.length === STOP_WORKFLOW_QUESTIONS.length, "Stop-workflow answers are incomplete");
  decision.answers.forEach((answer, index) => validateAnswer(answer, index));
  assert(STOP_WORKFLOW_OUTCOMES.includes(decision.outcome), "Stop-workflow outcome is invalid");
  assert(decision.primary_trigger_question_id === null || QUESTION_IDS.includes(decision.primary_trigger_question_id), "Stop-workflow primary trigger is invalid");
  assert(Array.isArray(decision.triggered_question_ids), "Stop-workflow triggered questions are required");
  assert(Array.isArray(decision.unknown_question_ids), "Stop-workflow unknown questions are required");
  [...decision.triggered_question_ids, ...decision.unknown_question_ids].forEach((questionId) => assert(QUESTION_IDS.includes(questionId), "Stop-workflow question projection is invalid"));
  assert(new Set(decision.triggered_question_ids).size === decision.triggered_question_ids.length, "Stop-workflow triggered questions are duplicated");
  assert(new Set(decision.unknown_question_ids).size === decision.unknown_question_ids.length, "Stop-workflow unknown questions are duplicated");
  assert(STOP_WORKFLOW_NEXT_ACTIONS.includes(decision.next_action), "Stop-workflow next action is invalid");
  assert(typeof decision.stop === "boolean" && typeof decision.owner_decision_required === "boolean", "Stop-workflow flags are invalid");
  assert(typeof decision.reason === "string" && decision.reason.length >= 24, "Stop-workflow reason is incomplete");
  const expected = expectedOutcome(decision.answers);
  for (const field of ["outcome", "primary_trigger_question_id", "next_action", "stop", "owner_decision_required", "reason"]) assert(decision[field] === expected[field], `Stop-workflow ${field} does not match the decision tree`);
  assert(JSON.stringify(decision.triggered_question_ids) === JSON.stringify(expected.triggered_question_ids), "Stop-workflow triggered projection is stale");
  assert(JSON.stringify(decision.unknown_question_ids) === JSON.stringify(expected.unknown_question_ids), "Stop-workflow unknown projection is stale");
  requireSha(decision.decision_sha256, "Stop-workflow decision digest");
  assert(decision.decision_sha256 === digestWithout(decision, "decision_sha256"), "Stop-workflow decision digest mismatch");
  return decision;
}

export function evaluateStopWorkflowGate({decisionId, actionRef, rollbackRef, answers} = {}) {
  requireIdentifier(decisionId, "Stop-workflow decision ID");
  requireReference(actionRef, "Stop-workflow action reference");
  requireReference(rollbackRef, "Stop-workflow rollback reference");
  assert(Array.isArray(answers) && answers.length === STOP_WORKFLOW_QUESTIONS.length, "Stop-workflow answers must cover all five questions");
  answers.forEach((answer, index) => validateAnswer(answer, index));
  const result = expectedOutcome(answers);
  const decision = {
    schema: STOP_WORKFLOW_GATE_SCHEMA,
    version: STOP_WORKFLOW_GATE_VERSION,
    decision_id: decisionId,
    action_ref: actionRef,
    rollback_ref: rollbackRef,
    question_order: [...QUESTION_IDS],
    answers: structuredClone(answers),
    ...result,
    decision_sha256: null,
  };
  decision.decision_sha256 = digestWithout(decision, "decision_sha256");
  return validateStopWorkflowDecision(decision);
}

export function compileStopWorkflowNoStopAnswers({evidenceRefPrefix = "opaque:stop-gate-evidence"} = {}) {
  requireReference(evidenceRefPrefix, "Stop-workflow evidence prefix");
  const answers = STOP_WORKFLOW_QUESTIONS.map(({question_id}) => ({
    question_id,
    answer: "NO",
    evidence_refs: [`${evidenceRefPrefix}/${question_id.toLowerCase()}`],
  }));
  return answers;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("stop-workflow gate loaded\n");
