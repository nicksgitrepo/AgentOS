#!/usr/bin/env node

/*
 * Canonical questions every governed worker must answer at the point where
 * the question applies.  These are internal questions.  They are not shown
 * to the owner as a technical checklist.
 */

import crypto from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const TASK_GATE_VERSION = "2.1rc";
export const TASK_GATE_CONTEXTS = Object.freeze([
  "TASK_START",
  "CODE_CHANGE",
  "DOCUMENTATION",
  "HANDOFF",
  "RESPONSE",
  "CLOSURE",
]);
export const TASK_GATE_ANSWER_VALUES = Object.freeze(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"]);
export const TASK_GATE_APPLICABILITY_EVIDENCE_KEY = "APPLICABILITY_JUSTIFICATION";
export const TASK_GATE_EVIDENCE_FIELDS = Object.freeze([
  "evidence_key", "question_id", "source_commit", "source_tree", "worktree_id",
  "session_id", "goal_id", "goal_sha256", "build_identity", "environment_id",
  "observed_at_utc", "result_sha256", "status",
]);
export const TASK_GATE_IDENTITY_FIELDS = Object.freeze([
  "source_commit", "source_tree", "worktree_id", "session_id", "goal_id",
  "goal_sha256", "build_identity", "environment_id",
]);

const QUESTION_DEFINITIONS = [
  {
    question_id: "TASK-START-001",
    stage: "TASK_START",
    question: "Is there exactly one observable behavior being changed?",
    pass_answer: "YES",
    applies_to: ["TASK_START"],
    required_evidence: ["ONE_OBSERVABLE_BEHAVIOR", "TASK_RECORD"],
    no_route: "RECON_OR_SPLIT_TASK",
    unknown_route: "ACQUIRE_TASK_EVIDENCE_OR_STOP",
  },
  {
    question_id: "TASK-START-002",
    stage: "TASK_START",
    question: "Is the responsible lane and exact allowed file scope known?",
    pass_answer: "YES",
    applies_to: ["TASK_START"],
    required_evidence: ["ALLOWED_PATHS", "ROLE_ADMISSION"],
    no_route: "CAMPAIGN_ORCHESTRATOR_SCOPE_REVIEW",
    unknown_route: "ACQUIRE_SCOPE_AND_ROLE_READBACK_OR_STOP",
  },
  {
    question_id: "TASK-START-003",
    stage: "TASK_START",
    question: "Is the product repository separate from the AgentOS control repository?",
    pass_answer: "YES",
    applies_to: ["TASK_START"],
    required_evidence: ["CONTROL_PLANE_BINDING", "PROJECT_ROOT_READBACK"],
    no_route: "HARD_STOP_REPOSITORY_BOUNDARY",
    unknown_route: "ACQUIRE_ROOT_BINDING_OR_STOP",
  },
  {
    question_id: "TASK-START-004",
    stage: "TASK_START",
    question: "Do the goal, source commit, worktree, session, and environment all match?",
    pass_answer: "YES",
    applies_to: ["TASK_START"],
    required_evidence: ["ENVIRONMENT_READBACK", "GOAL_READBACK", "SESSION_READBACK", "SOURCE_READBACK", "WORKTREE_READBACK"],
    no_route: "HARD_STOP_IDENTITY_MISMATCH",
    unknown_route: "ACQUIRE_RUNTIME_IDENTITY_OR_STOP",
  },
  {
    question_id: "TASK-START-005",
    stage: "TASK_START",
    question: "Can the current behavior or failure be reproduced?",
    pass_answer: "YES",
    applies_to: ["TASK_START", "CODE_CHANGE"],
    required_evidence: ["BASELINE_REPRODUCTION", "CURRENT_BEHAVIOR_READBACK"],
    no_route: "RECON_OR_REFRAME_TASK",
    unknown_route: "ACQUIRE_BASELINE_EVIDENCE_OR_STOP",
  },
  {
    question_id: "TASK-START-006",
    stage: "TASK_START",
    question: "Does the evidence identify the actual cause, not just the symptom?",
    pass_answer: "YES",
    applies_to: ["TASK_START", "CODE_CHANGE"],
    required_evidence: ["CAUSAL_EVIDENCE", "EXECUTION_PATH_TRACE"],
    no_route: "RECON_OR_REFRAME_HYPOTHESIS",
    unknown_route: "ACQUIRE_CAUSAL_EVIDENCE_OR_STOP",
  },
  {
    question_id: "TASK-START-007",
    stage: "TASK_START",
    question: "Is this the smallest safe change?",
    pass_answer: "YES",
    applies_to: ["TASK_START", "CODE_CHANGE", "DOCUMENTATION"],
    required_evidence: ["MINIMAL_CHANGE_PLAN", "NON_GOALS"],
    no_route: "CAMPAIGN_ORCHESTRATOR_SCOPE_REVIEW",
    unknown_route: "RECON_OR_SPLIT_CHANGE_OR_STOP",
  },
  {
    question_id: "TASK-CHANGE-008",
    stage: "TASK_CHANGE",
    question: "Did the change touch anything outside the approved scope?",
    pass_answer: "NO",
    applies_to: ["CODE_CHANGE", "DOCUMENTATION", "HANDOFF", "RESPONSE"],
    required_evidence: ["CHANGED_PATHS_READBACK", "SCOPE_COMPARISON"],
    no_route: "CONTINUE_SCOPE_CHECK",
    unknown_route: "ACQUIRE_DIFF_OR_ARTIFACT_SCOPE_READBACK_OR_STOP",
  },
  {
    question_id: "TASK-CHANGE-009",
    stage: "TASK_CHANGE",
    question: "Did it add a dependency, schema change, secret, production action, or destructive action?",
    pass_answer: "NO",
    applies_to: ["CODE_CHANGE", "DOCUMENTATION", "HANDOFF", "RESPONSE"],
    required_evidence: ["AUTHORITY_READBACK", "RISK_SCAN"],
    no_route: "HARD_STOP_UNAUTHORIZED_RISK",
    unknown_route: "SECURITY_OR_RUNTIME_REVIEW",
  },
  {
    question_id: "TASK-PROOF-010",
    stage: "TASK_PROOF",
    question: "Did the focused test fail before the fix and pass afterward?",
    pass_answer: "YES",
    applies_to: ["CODE_CHANGE"],
    required_evidence: ["BASELINE_TEST_RESULT", "POST_CHANGE_TEST_RESULT"],
    no_route: "REPAIR_OR_REFRAME_ACCEPTANCE",
    unknown_route: "ACQUIRE_TEST_EVIDENCE_OR_STOP",
  },
  {
    question_id: "TASK-PROOF-011",
    stage: "TASK_PROOF",
    question: "Was the test actually run with observed results?",
    pass_answer: "YES",
    applies_to: ["CODE_CHANGE", "DOCUMENTATION", "HANDOFF", "RESPONSE"],
    required_evidence: ["OBSERVED_CHECK_RESULT", "CHECK_EXIT_STATUS"],
    no_route: "HARD_STOP_UNOBSERVED_PROOF",
    unknown_route: "RUN_AND_CAPTURE_CHECK_OR_STOP",
  },
  {
    question_id: "TASK-PROOF-012",
    stage: "TASK_PROOF",
    question: "Does the evidence refer to the same source, worktree, build, and environment?",
    pass_answer: "YES",
    applies_to: ["CODE_CHANGE", "DOCUMENTATION", "HANDOFF", "RESPONSE"],
    required_evidence: ["BUILD_IDENTITY", "ENVIRONMENT_ID", "SOURCE_IDENTITY", "WORKTREE_IDENTITY"],
    no_route: "HARD_STOP_EVIDENCE_IDENTITY_MISMATCH",
    unknown_route: "ACQUIRE_IDENTITY_READBACK_OR_STOP",
  },
  {
    question_id: "TASK-PROGRESS-013",
    stage: "TASK_PROGRESS",
    question: "Did the worker produce a real result within 15 minutes—not merely a failure list?",
    pass_answer: "YES",
    applies_to: ["TASK_START", "CODE_CHANGE", "DOCUMENTATION", "HANDOFF", "RESPONSE"],
    required_evidence: ["MEANINGFUL_RESULT", "PROGRESS_RECEIPT"],
    no_route: "MARK_STALLED_AND_ESCALATE",
    unknown_route: "ACQUIRE_PROGRESS_READBACK_OR_MARK_STALLED",
  },
  {
    question_id: "TASK-ACCEPTANCE-014",
    stage: "TASK_ACCEPTANCE",
    question: "Did an independent agent accept the result?",
    pass_answer: "YES",
    applies_to: ["HANDOFF", "RESPONSE", "CLOSURE"],
    required_evidence: ["INDEPENDENT_ACCEPTANCE", "REVIEWER_IDENTITY"],
    no_route: "RETURN_TO_REPAIR_OR_REVIEW",
    unknown_route: "ROUTE_TO_INDEPENDENT_REVIEW_OR_STOP",
  },
  {
    question_id: "TASK-CLOSURE-015",
    stage: "TASK_CLOSURE",
    question: "Was the handoff preserved and persisted, the candidate independently audited and integrated, the session unpinned, the stale worktree closed, the task removed from active scope, the chat placed out of scope, and the task archived?",
    pass_answer: "YES",
    applies_to: ["HANDOFF", "CLOSURE"],
    required_evidence: ["ARCHIVE_READBACK", "AUDIT_READBACK", "CHAT_SCOPE_READBACK", "HANDOFF_PRESERVATION", "INTEGRATION_READBACK", "ROSTER_READBACK", "STALE_WORKTREE_CLOSURE", "TASK_SCOPE_READBACK"],
    no_route: "HARD_STOP_UNCLOSED_TEMPORARY_WORK",
    unknown_route: "ACQUIRE_CLOSURE_READBACK_OR_STOP",
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function sortedUniqueStrings(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must not be empty`);
  assert(value.every((item) => typeof item === "string" && item.length > 0), `${label} contains an invalid value`);
  const sorted = [...value].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  assert(new Set(value).size === value.length && JSON.stringify(value) === JSON.stringify(sorted), `${label} must be sorted and unique`);
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), label + " must be an object");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), label + " fields mismatch");
}

function validateAnswerEvidence(evidence, question, evidenceKey, label) {
  exactKeys(evidence, TASK_GATE_EVIDENCE_FIELDS, label);
  assert(evidence.evidence_key === evidenceKey, label + " evidence key differs");
  assert(evidence.question_id === question.question_id, label + " question identity differs");
  assert(GIT_OBJECT.test(evidence.source_commit), label + " source commit is invalid");
  assert(GIT_OBJECT.test(evidence.source_tree), label + " source tree is invalid");
  for (const field of ["worktree_id", "session_id", "goal_id", "build_identity", "environment_id"]) {
    assert(typeof evidence[field] === "string" && evidence[field].length > 0, label + " " + field + " is required");
  }
  assert(SHA256.test(evidence.goal_sha256), label + " goal digest is invalid");
  assert(ISO_UTC.test(evidence.observed_at_utc) && Number.isFinite(Date.parse(evidence.observed_at_utc)), label + " observed time is invalid");
  assert(SHA256.test(evidence.result_sha256), label + " result digest is invalid");
  assert(evidence.status === "PASS", label + " status is not PASS");
}

function validateAnswerFailure(failure, question, label) {
  exactKeys(failure, ["classification", "reason", "route", "recheck_question_id"], label);
  assert(["OWNER_OR_HARD_BLOCKER", "REPAIRABLE_ENGINEERING_PUZZLE", "SOFT_BOUNDARY_REVIEW"].includes(failure.classification), label + " classification is invalid");
  assert(typeof failure.reason === "string" && failure.reason.length > 0, label + " reason is required");
  assert(typeof failure.route === "string" && failure.route.length > 0, label + " route is required");
  assert(failure.recheck_question_id === question.question_id, label + " must name its own re-check question");
}

function validateAnswer(question, answer, context, traces) {
  exactKeys(answer, ["answer", "evidence", "failure", "recheck"], question.question_id + " task answer");
  assert(TASK_GATE_ANSWER_VALUES.includes(answer.answer), question.question_id + " answer is not explicit");
  const evidenceKeys = [...question.required_evidence, ...(answer.answer === "NOT_APPLICABLE" ? [TASK_GATE_APPLICABILITY_EVIDENCE_KEY] : [])].sort();
  exactKeys(answer.evidence, evidenceKeys, question.question_id + " task evidence");
  for (const evidenceKey of evidenceKeys) validateAnswerEvidence(answer.evidence[evidenceKey], question, evidenceKey, question.question_id + "." + evidenceKey);
  if (answer.answer === "NOT_APPLICABLE") {
    assert(answer.failure === null && answer.recheck === null, question.question_id + " NOT_APPLICABLE requires applicability evidence, not a failure route");
    traces.push({question_id: question.question_id, context, answer: answer.answer, applicability_evidence: TASK_GATE_APPLICABILITY_EVIDENCE_KEY});
    return "PASS";
  }
  const passed = answer.answer === question.pass_answer;
  if (passed) {
    assert(answer.failure === null && answer.recheck === null, question.question_id + " safe answer carries a failure or re-check");
    traces.push({question_id: question.question_id, context, answer: answer.answer});
    return "PASS";
  }
  assert(answer.failure !== null, question.question_id + " unsafe or unknown answer lacks a failure route");
  validateAnswerFailure(answer.failure, question, question.question_id + " failure");
  if (answer.recheck !== null) {
    exactKeys(answer.recheck, ["answer", "evidence"], question.question_id + " re-check");
    assert(answer.recheck.answer === question.pass_answer, question.question_id + " re-check is not safe");
    exactKeys(answer.recheck.evidence, question.required_evidence, question.question_id + " re-check evidence");
    for (const evidenceKey of question.required_evidence) validateAnswerEvidence(answer.recheck.evidence[evidenceKey], question, evidenceKey, question.question_id + ".recheck." + evidenceKey);
  }
  traces.push({question_id: question.question_id, context, answer: answer.answer, failure: structuredClone(answer.failure), recheck: answer.recheck === null ? null : structuredClone(answer.recheck)});
  if (answer.recheck !== null) return "PASS";
  return answer.failure.classification === "REPAIRABLE_ENGINEERING_PUZZLE" ? "REPAIR_REQUIRED" : "BLOCKED";
}

function validateQuestion(question, index) {
  const keys = ["question_id", "stage", "question", "pass_answer", "applies_to", "required_evidence", "no_route", "unknown_route"];
  const actual = Object.keys(question).sort();
  assert(JSON.stringify(actual) === JSON.stringify([...keys].sort()), `task gate question ${index} fields mismatch`);
  assert(typeof question.question_id === "string" && /^[A-Z][A-Z0-9-]+$/u.test(question.question_id), `task gate question ${index} ID is invalid`);
  assert(typeof question.stage === "string" && /^TASK_[A-Z]+$/u.test(question.stage), `${question.question_id} stage is invalid`);
  assert(typeof question.question === "string" && question.question.trim().endsWith("?"), `${question.question_id} is not an exact question`);
  assert(TASK_GATE_ANSWER_VALUES.includes(question.pass_answer), `${question.question_id} pass answer is invalid`);
  sortedUniqueStrings(question.applies_to, `${question.question_id} contexts`);
  question.applies_to.forEach((context) => assert(TASK_GATE_CONTEXTS.includes(context), `${question.question_id} has an unknown context`));
  sortedUniqueStrings(question.required_evidence, `${question.question_id} evidence`);
  for (const field of ["no_route", "unknown_route"]) assert(typeof question[field] === "string" && question[field].length > 0, `${question.question_id} ${field} is required`);
}

export function validateTaskGateQuestionCatalog(questions = TASK_GATE_QUESTIONS) {
  assert(Array.isArray(questions) && questions.length === QUESTION_DEFINITIONS.length, "task gate question catalog is incomplete");
  const ids = new Set();
  questions.forEach((question, index) => {
    validateQuestion(question, index);
    assert(!ids.has(question.question_id), `duplicate task gate question ${question.question_id}`);
    ids.add(question.question_id);
    assert(question.question_id === QUESTION_DEFINITIONS[index].question_id, `task gate question order changed at ${index}`);
  });
  return questions;
}

export const TASK_GATE_QUESTIONS = Object.freeze(QUESTION_DEFINITIONS.map((question) => Object.freeze({
  ...question,
  applies_to: Object.freeze([...question.applies_to].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))),
  required_evidence: Object.freeze([...question.required_evidence].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))),
})));

validateTaskGateQuestionCatalog();

export const TASK_GATE_CATALOG_SHA256 = digest(TASK_GATE_QUESTIONS);

export function taskGateQuestionIds(context) {
  assert(TASK_GATE_CONTEXTS.includes(context), `unknown task gate context: ${context}`);
  return TASK_GATE_QUESTIONS.filter((question) => question.applies_to.includes(context)).map((question) => question.question_id);
}

export function taskGateQuestionsFor(context) {
  return TASK_GATE_QUESTIONS.filter((question) => question.applies_to.includes(context)).map((question) => structuredClone(question));
}

export function validateTaskGateAnswerSet({context, answers, expectedBinding = null}) {
  assert(TASK_GATE_CONTEXTS.includes(context), "unknown task-gate answer context: " + context);
  assert(answers && typeof answers === "object" && !Array.isArray(answers), context + " task-gate answers must be an object");
  const questions = taskGateQuestionsFor(context);
  const questionIds = new Set(questions.map((question) => question.question_id));
  Object.keys(answers).forEach((questionId) => assert(questionIds.has(questionId), context + " task-gate answers contain an inapplicable question: " + questionId));
  const traces = [];
  let observedBinding = null;
  for (const question of questions) {
    const answer = answers[question.question_id];
    if (answer === undefined) {
      const blocked = {schema: "agentos.task_gate_answer_set.v1", version: 1, context, status: "BLOCKED", blocked_question_id: question.question_id, binding: observedBinding, traces, answer_set_sha256: null};
      blocked.answer_set_sha256 = digest({...blocked, answer_set_sha256: null});
      return blocked;
    }
    const status = validateAnswer(question, answer, context, traces);
    const evidenceItems = Object.values(answer.evidence);
    const currentBinding = Object.fromEntries(TASK_GATE_IDENTITY_FIELDS.map((field) => [field, evidenceItems[0][field]]));
    for (const evidenceItem of evidenceItems) {
      for (const field of TASK_GATE_IDENTITY_FIELDS) assert(evidenceItem[field] === currentBinding[field], context + " task-gate identity differs within " + question.question_id + "." + field);
    }
    if (observedBinding === null) observedBinding = currentBinding;
    else for (const field of TASK_GATE_IDENTITY_FIELDS) assert(currentBinding[field] === observedBinding[field], context + " task-gate identity differs at " + question.question_id + "." + field);
    if (expectedBinding !== null) {
      for (const field of TASK_GATE_IDENTITY_FIELDS) {
        if (expectedBinding[field] !== undefined) assert(currentBinding[field] === expectedBinding[field], context + " task-gate identity differs from expected " + field);
      }
    }
    if (status !== "PASS") {
      const failed = {schema: "agentos.task_gate_answer_set.v1", version: 1, context, status, blocked_question_id: question.question_id, binding: observedBinding, traces, answer_set_sha256: null};
      failed.answer_set_sha256 = digest({...failed, answer_set_sha256: null});
      return failed;
    }
  }
  const result = {schema: "agentos.task_gate_answer_set.v1", version: 1, context, status: "PASS", blocked_question_id: null, binding: observedBinding, traces, answer_set_sha256: null};
  result.answer_set_sha256 = digest({...result, answer_set_sha256: null});
  return result;
}

export function taskGateInstructionText(contexts = TASK_GATE_CONTEXTS) {
  assert(Array.isArray(contexts) && contexts.length > 0, "task-gate prompt contexts are required");
  const uniqueContexts = [...new Set(contexts)];
  uniqueContexts.forEach((context) => assert(TASK_GATE_CONTEXTS.includes(context), `unknown task-gate prompt context: ${context}`));
  const questions = TASK_GATE_QUESTIONS.filter((question) => question.applies_to.some((context) => uniqueContexts.includes(context)));
  return [
    `TASK GATES (${TASK_GATE_CATALOG_SHA256}): answer these privately before acting, then repeat the applicable checks before each code change, document, handoff, or response. Use YES, NO, UNKNOWN, or NOT_APPLICABLE; NOT_APPLICABLE requires ${TASK_GATE_APPLICABILITY_EVIDENCE_KEY}.`,
    ...questions.map((question) => `${question.question_id} [${question.applies_to.filter((context) => uniqueContexts.includes(context)).join(",")}] ${question.question} Safe answer: ${question.pass_answer}.`),
    "A non-safe or unknown answer is a routed finding, not permission to guess. Include the exact evidence, route, and re-check in the typed result.",
  ].join(" ");
}

export function taskGateCatalogDigest() {
  return TASK_GATE_CATALOG_SHA256;
}
