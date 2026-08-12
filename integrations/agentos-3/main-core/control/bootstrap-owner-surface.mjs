#!/usr/bin/env node

/*
 * Owner-facing adapter for a Bootstrap question map. Machine question IDs and
 * answer rules remain in the private typed session; this projection exposes
 * only a short prompt and simple labels.
 */

import {
  BOOTSTRAP_QUESTIONS,
  BOOTSTRAP_CONVERSATION_FLOOR,
  BOOTSTRAP_QUESTION_MAP_SCHEMA,
  bootstrapQuestionById,
  canonicalDigest,
  createBootstrapQuestionMap,
  parseBootstrapReply,
  validateBootstrapQuestionMap,
} from "./bootstrap-conversation.mjs";

export const BOOTSTRAP_OWNER_QUESTION_SCHEMA = "agentos.bootstrap_owner_question.v1";
export const BOOTSTRAP_OWNER_QUESTION_VERSION = 1;

const QUESTION_ID = /^[A-Z][A-Z0-9._-]*$/u;
const INTERNAL_TERMS = /\b(?:agentos|governance|campaign|schema|commit|worktree|session|runtime|orchestrator|auditor|audit|model|repository|repo|git|deployment|digest|lane|packet|role|source|environment)\b/iu;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function plain(value, label) {
  nonempty(value, label);
  assert(!INTERNAL_TERMS.test(value), `${label} contains internal vocabulary`);
  const forbidden = BOOTSTRAP_CONVERSATION_FLOOR.forbidden_user_terms.map((term) => term.toLocaleLowerCase());
  assert(!forbidden.some((term) => value.toLocaleLowerCase().includes(term)), `${label} contains forbidden vocabulary`);
  assert(value.trim().split(/\s+/u).length <= 20, `${label} is too long`);
  assert(!/[{}[\]<>`]/u.test(value), `${label} looks like a technical form`);
}

function surfaceQuestionId(questionId) {
  return questionId.toUpperCase();
}

function internalQuestionId(questionId) {
  return questionId.toLowerCase();
}

function resolveMap(questionMap) {
  if (isRecord(questionMap) && questionMap.schema === BOOTSTRAP_QUESTION_MAP_SCHEMA) {
    validateBootstrapQuestionMap(questionMap);
    return questionMap;
  }
  return createBootstrapQuestionMap(questionMap);
}

function surfaceChoices(question) {
  return question.choices.map((choice, index) => ({
    number: index + 1,
    value: String(choice.value).toUpperCase(),
    label: choice.label,
  }));
}

function validateChoice(choice, index) {
  assert(isRecord(choice), `owner choice ${index} must be an object`);
  assert(choice.number === index + 1, `owner choice ${index} number is invalid`);
  nonempty(choice.value, `owner choice ${index}.value`);
  plain(choice.label, `owner choice ${index}.label`);
}

export function validateBootstrapOwnerQuestion(surface) {
  assert(isRecord(surface), "owner question must be an object");
  const expected = ["schema", "version", "question_id", "prompt", "answer_kind", "choices", "boolean_answers", "internal_fields_hidden", "digest"];
  assert(JSON.stringify(Object.keys(surface).sort()) === JSON.stringify(expected.sort()), "owner question fields mismatch");
  assert(surface.schema === BOOTSTRAP_OWNER_QUESTION_SCHEMA && surface.version === BOOTSTRAP_OWNER_QUESTION_VERSION, "owner question identity is invalid");
  assert(typeof surface.question_id === "string" && QUESTION_ID.test(surface.question_id), "owner question ID is invalid");
  assert(["TEXT", "BOOLEAN", "CHOICE", "MULTI_CHOICE"].includes(surface.answer_kind), "owner answer kind is invalid");
  plain(surface.prompt, "owner prompt");
  assert(Array.isArray(surface.choices) && surface.choices.length <= 12, "owner choices are invalid");
  surface.choices.forEach(validateChoice);
  if (surface.answer_kind === "TEXT") assert(surface.choices.length === 0 && surface.boolean_answers === false, "text owner question choices are invalid");
  if (surface.answer_kind === "BOOLEAN") assert(surface.choices.length === 2 && surface.boolean_answers === true, "boolean owner question choices are invalid");
  if (surface.answer_kind === "CHOICE") assert(surface.choices.length >= 2 && surface.boolean_answers === false, "choice owner question choices are invalid");
  if (surface.answer_kind === "MULTI_CHOICE") assert(surface.choices.length >= 2 && surface.boolean_answers === false, "multi-choice owner question choices are invalid");
  assert(surface.internal_fields_hidden === true, "owner question exposes internal fields");
  assert(typeof surface.digest === "string" && surface.digest === canonicalDigest({...surface, digest: null}), "owner question digest is invalid");
  return surface;
}

export function renderBootstrapOwnerQuestion(questionId, {questionMap = BOOTSTRAP_QUESTIONS} = {}) {
  const question = bootstrapQuestionById(questionId, resolveMap(questionMap));
  return renderSurface({
    schema: BOOTSTRAP_OWNER_QUESTION_SCHEMA,
    version: BOOTSTRAP_OWNER_QUESTION_VERSION,
    question_id: surfaceQuestionId(question.id),
    prompt: question.prompt,
    answer_kind: question.kind,
    choices: surfaceChoices(question),
    boolean_answers: question.kind === "BOOLEAN",
    internal_fields_hidden: true,
  });
}

function renderSurface(surface) {
  const result = {...surface, digest: null};
  result.digest = canonicalDigest(result);
  return validateBootstrapOwnerQuestion(result);
}

export function renderBootstrapOwnerQuestionFromPlan(questionPlan) {
  assert(isRecord(questionPlan) && questionPlan.schema === "agentos.bootstrap_question_plan.v1", "Bootstrap question plan identity is invalid");
  assert(Array.isArray(questionPlan.questions) && Array.isArray(questionPlan.owner_questions), "Bootstrap question plan questions are invalid");
  if (questionPlan.next === null) {
    assert(questionPlan.questions.length === 0 && questionPlan.owner_questions.length === 0, "completed Bootstrap question plan still exposes an owner question");
    return null;
  }
  assert(questionPlan.questions.length === 1 && questionPlan.owner_questions.length === 1, "Bootstrap question plan must expose one question");
  const machineQuestion = questionPlan.questions[0];
  const ownerQuestion = questionPlan.owner_questions[0];
  assert(machineQuestion.id === questionPlan.next, "Bootstrap question plan next ID is not bound to its question");
  assert(ownerQuestion.prompt === machineQuestion.prompt, "Bootstrap owner prompt differs from the machine question");
  const machineChoices = machineQuestion.choices ?? null;
  const ownerChoices = ownerQuestion.choices ?? null;
  assert(canonicalDigest(machineChoices) === canonicalDigest(ownerChoices), "Bootstrap owner choices differ from the machine question");
  const choices = ownerChoices ?? [];
  assert(Array.isArray(choices) && choices.length <= 5, "Bootstrap plan owner choices are invalid");
  return renderSurface({
    schema: BOOTSTRAP_OWNER_QUESTION_SCHEMA,
    version: BOOTSTRAP_OWNER_QUESTION_VERSION,
    question_id: surfaceQuestionId(machineQuestion.id),
    prompt: ownerQuestion.prompt,
    answer_kind: choices.length === 0 ? "TEXT" : "CHOICE",
    choices: choices.map((label, index) => ({number: index + 1, value: String(index + 1), label})),
    boolean_answers: false,
    internal_fields_hidden: true,
  });
}

export function parseBootstrapOwnerAnswer(surface, input, {questionMap = BOOTSTRAP_QUESTIONS} = {}) {
  validateBootstrapOwnerQuestion(surface);
  const map = resolveMap(questionMap);
  const question = bootstrapQuestionById(internalQuestionId(surface.question_id), map);
  assert(question.kind === surface.answer_kind, "owner question answer kind differs from the bound question map");
  const parsed = parseBootstrapReply(question.id, input, {questionMap: map});
  return {
    question_id: parsed.question_id,
    value: parsed.value,
    answer_kind: surface.answer_kind,
  };
}

export function ownerQuestionFor(questionId, options = {}) {
  return renderBootstrapOwnerQuestion(questionId, options);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Bootstrap owner surface loaded\n");
