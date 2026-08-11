#!/usr/bin/env node

/*
 * Host-independent owner conversation state for the Bootstrap project-contract
 * slice. The question map is part of the content-addressed session so a later
 * turn cannot silently change the meaning of an earlier answer. Raw replies are
 * normalized and discarded; only typed values and safe digests are retained.
 */

import crypto from "node:crypto";

export const BOOTSTRAP_CONVERSATION_SCHEMA = "agentos.bootstrap_conversation.v1";
export const BOOTSTRAP_CONVERSATION_VERSION = 1;
export const BOOTSTRAP_ANSWER_SCHEMA = "agentos.bootstrap_answer.v1";
export const BOOTSTRAP_ANSWER_VERSION = 1;
export const BOOTSTRAP_QUESTION_MAP_SCHEMA = "agentos.bootstrap_question_map.v1";
export const BOOTSTRAP_QUESTION_MAP_VERSION = 1;
export const BOOTSTRAP_CONVERSATION_HANDOFF_SCHEMA = "agentos.bootstrap_conversation_handoff.v1";
export const BOOTSTRAP_CONVERSATION_HANDOFF_VERSION = 1;
export const BOOTSTRAP_CONVERSATION_REPLAY_SCHEMA = "agentos.bootstrap_conversation_replay.v1";
export const BOOTSTRAP_CONVERSATION_REPLAY_VERSION = 1;
export const CERTAINTY = Object.freeze(["CONFIRMED", "INFERRED", "RECOMMENDED", "UNKNOWN"]);
export const ANSWER_PROVENANCE = Object.freeze(["OWNER", "DISCOVERY", "COMPILER", "UNRESOLVED_OWNER"]);
export const CONVERSATION_DISPOSITIONS = Object.freeze(["ACTIVE", "UNAVAILABLE", "HARD_STOP"]);
export const BOOTSTRAP_CONVERSATION_FLOOR = Object.freeze({
  language: "PLAIN_EVERYDAY",
  questions_per_turn: 1,
  internal_fields_hidden: true,
  ask_only: "EARLIEST_MATERIAL_UNRESOLVED",
  safe_discovery_defaults_allowed: true,
  maximum_prompt_words: 20,
  forbidden_user_terms: Object.freeze(["JSON", "authority corpus", "campaign", "digest", "policy state", "runtime", "schema", "worktree"]),
});
export const OWNER_RETRY_MESSAGE = "Please answer in a few words or choose one of the options shown.";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_PROJECT_REF = /^[a-z][a-z0-9._-]{0,63}$/u;
const SAFE_QUESTION_ID = /^[a-z][a-z0-9._-]{0,127}$/u;
const SAFE_ACTION = /^[A-Z][A-Z0-9_:-]{1,95}$/u;
const UNSAFE_TEXT = Object.freeze([
  ["PRIVATE_PATH", /(?:^|[\s"'`=:(\[{])(?:\/(?!\/)(?:[A-Za-z0-9._-]+[\\/]){1,}[A-Za-z0-9._-]+|[A-Za-z]:[\\/]|\\\\|~[\\/]|\.code[x][\\/])[^\s"'`<>)}\]]*/u],
  ["PRIVATE_LINK", /(?:file:\/\/|chat[g]pt-conversation:\/\/|chat:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1|[^\s/]+\.(?:local|internal|private|corp))(?:[/:?\s]|$))/iu],
  ["ENVIRONMENT_VALUE", /(?:\$[A-Z][A-Z0-9_]*|\$\{[A-Z][A-Z0-9_]*\}|\b[A-Z][A-Z0-9_]{2,}=[^\s,;]+)/u],
  ["SECRET", /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|credential)\s*[:=])/iu],
  ["SESSION_OR_TASK_IDENTITY", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu],
]);
const INTERNAL_PROMPT_TERMS = /\b(?:agentos|governance|schema|digest|runtime|worktree|campaign|repository|repo|git|role|lane|packet|auditor|orchestrator|source control|environment)\b/iu;

export const BOOTSTRAP_QUESTIONS = Object.freeze([
  Object.freeze({
    id: "intent.audience",
    kind: "TEXT",
    prompt: "Who is this for?",
    required: true,
  }),
  Object.freeze({
    id: "intent.outcome",
    kind: "TEXT",
    prompt: "What should it make easier?",
    required: true,
  }),
  Object.freeze({
    id: "intent.first_result",
    kind: "TEXT",
    prompt: "What would a useful first result look like?",
    required: true,
  }),
  Object.freeze({
    id: "scope.allowed",
    kind: "TEXT",
    prompt: "What should this work touch?",
    required: true,
  }),
  Object.freeze({
    id: "scope.non_goals",
    kind: "TEXT",
    prompt: "What should I explicitly leave out for now?",
    required: true,
  }),
  Object.freeze({
    id: "boundaries.hard",
    kind: "TEXT",
    prompt: "What must always make me stop?",
    required: true,
  }),
  Object.freeze({
    id: "boundaries.soft",
    kind: "TEXT",
    prompt: "What should make me pause and check with you?",
    required: true,
  }),
  Object.freeze({
    id: "governance.memory",
    kind: "BOOLEAN",
    prompt: "Should I remember this next time?",
    choices: Object.freeze([
      Object.freeze({value: true, label: "Yes"}),
      Object.freeze({value: false, label: "No"}),
    ]),
    required: true,
  }),
  Object.freeze({
    id: "delivery.finish",
    kind: "CHOICE",
    prompt: "When the first version is ready, what should happen?",
    choices: Object.freeze([
      Object.freeze({value: "REVIEW", label: "Leave it ready for review"}),
      Object.freeze({value: "SAVE", label: "Save it safely for later"}),
      Object.freeze({value: "SHARE", label: "Share the saved work"}),
      Object.freeze({value: "LIVE", label: "Put it live"}),
    ]),
    required: true,
  }),
  Object.freeze({
    id: "workflow.steps",
    kind: "TEXT",
    prompt: "What steps should the first version follow?",
    required: false,
  }),
  Object.freeze({
    id: "terminology.preferred",
    kind: "TEXT",
    prompt: "Which words should we use consistently?",
    required: false,
  }),
  Object.freeze({
    id: "acceptance.conditions",
    kind: "TEXT",
    prompt: "How will you know the result is good enough?",
    required: false,
  }),
  Object.freeze({
    id: "governance.providers",
    kind: "CHOICE",
    prompt: "Should outside services be used?",
    choices: Object.freeze([
      Object.freeze({value: "LOCAL_ONLY", label: "Use only this workspace"}),
      Object.freeze({value: "OWNER_APPROVAL", label: "Ask before using outside services"}),
      Object.freeze({value: "DEFERRED", label: "Decide later"}),
    ]),
    required: false,
    default_value: "LOCAL_ONLY",
  }),
  Object.freeze({
    id: "governance.retention",
    kind: "CHOICE",
    prompt: "How long should saved information be kept?",
    choices: Object.freeze([
      Object.freeze({value: "SESSION_ONLY", label: "This session only"}),
      Object.freeze({value: "PROJECT_LIFETIME", label: "For this project"}),
      Object.freeze({value: "OWNER_REVIEW", label: "Ask before keeping it"}),
    ]),
    required: false,
    default_value: "OWNER_REVIEW",
  }),
  Object.freeze({
    id: "delivery.intent",
    kind: "CHOICE",
    prompt: "Where should the result go first?",
    choices: Object.freeze([
      Object.freeze({value: "LOCAL_REVIEW", label: "Keep it here for review"}),
      Object.freeze({value: "SAFE_STORAGE", label: "Save it for later"}),
      Object.freeze({value: "OWNER_DECIDES", label: "Let me decide later"}),
    ]),
    required: false,
    default_value: "LOCAL_REVIEW",
  }),
  Object.freeze({
    id: "governance.review_interval",
    kind: "CHOICE",
    prompt: "How often should I pause to review progress?",
    choices: Object.freeze([
      Object.freeze({value: 15, label: "15 minutes (recommended)"}),
      Object.freeze({value: 30, label: "30 minutes"}),
      Object.freeze({value: 60, label: "60 minutes"}),
    ]),
    required: false,
    default_value: 15,
  }),
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSafeText(value, label) {
  assert(typeof value === "string", `${label} must be text`);
  for (const [category, pattern] of UNSAFE_TEXT) {
    if (pattern.test(value)) throw new Error(`${label} contains unsafe ${category}`);
  }
}

function assertSafeValue(value, label) {
  if (typeof value === "string") {
    assertSafeText(value, label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValue(item, `${label}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, child]) => assertSafeValue(child, `${label}.${key}`));
  }
}

function normalizeText(value, label) {
  assertSafeText(value, label);
  const normalized = value.trim().replace(/[\t\r\n ]+/gu, " ");
  assert(normalized.length >= 2, `${label} is too short`);
  assert(normalized.length <= 1000, `${label} is too long`);
  return normalized;
}

function normalizePublicText(value, label, maximum = 500) {
  assertSafeText(value, label);
  const normalized = value.trim().replace(/[\t\r\n ]+/gu, " ");
  assert(normalized.length >= 2 && normalized.length <= maximum, `${label} length is invalid`);
  return normalized;
}

function normalizePrompt(value, label) {
  assert(typeof value === "string", `${label} must be text`);
  assertSafeText(value, label);
  const normalized = value.trim().replace(/[\t\r\n ]+/gu, " ");
  assert(normalized.length >= 2 && normalized.length <= 160, `${label} length is invalid`);
  assert((normalized.match(/\?/gu) ?? []).length === 1 && normalized.endsWith("?"), `${label} must contain exactly one question`);
  assert(normalized.split(/\s+/u).length <= 20, `${label} is too long for the owner surface`);
  assert(!INTERNAL_PROMPT_TERMS.test(normalized), `${label} contains internal vocabulary`);
  const forbidden = BOOTSTRAP_CONVERSATION_FLOOR.forbidden_user_terms.map((term) => term.toLocaleLowerCase());
  assert(!forbidden.some((term) => normalized.toLocaleLowerCase().includes(term)), `${label} contains forbidden vocabulary`);
  return normalized;
}

function normalizeLabel(value, label) {
  const normalized = normalizePublicText(value, label, 120);
  assert(!INTERNAL_PROMPT_TERMS.test(normalized), `${label} contains internal vocabulary`);
  const forbidden = BOOTSTRAP_CONVERSATION_FLOOR.forbidden_user_terms.map((term) => term.toLocaleLowerCase());
  assert(!forbidden.some((term) => normalized.toLocaleLowerCase().includes(term)), `${label} contains forbidden vocabulary`);
  assert(!/[{}[\]<>`]/u.test(normalized), `${label} looks like a technical form`);
  return normalized;
}

function normalizeBoolean(value, label) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 1 || value === 2)) return value === 1;
  if (typeof value !== "string") throw new Error(`${label} must be yes or no`);
  const normalized = value.trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "2"].includes(normalized)) return false;
  throw new Error(`${label} must be yes or no`);
}

function primitiveChoiceValue(value, label) {
  assert(["string", "number", "boolean"].includes(typeof value), `${label} value must be a primitive`);
  if (typeof value === "number") assert(Number.isFinite(value), `${label} value must be finite`);
  assertSafeValue(value, label);
  return value;
}

function normalizeChoice(question, value) {
  let choice = value;
  if (typeof choice === "string" && /^\d+$/u.test(choice.trim())) {
    const selected = question.choices[Number(choice.trim()) - 1];
    if (selected) return selected.value;
  }
  const selected = question.choices.find((candidate) => Object.is(candidate.value, choice)
    || (typeof choice === "string"
      && (candidate.label.toLowerCase() === choice.trim().toLowerCase() || String(candidate.value).toLowerCase() === choice.trim().toLowerCase())));
  if (selected) return selected.value;
  if (Number.isSafeInteger(choice)) {
    const indexed = question.choices[choice - 1];
    if (indexed) return indexed.value;
  }
  throw new Error("answer is not one of the listed choices");
}

function normalizeAnswer(question, value) {
  if (question.kind === "TEXT") return normalizeText(value, question.id);
  if (question.kind === "BOOLEAN") return normalizeBoolean(value, question.id);
  if (question.kind === "CHOICE") return normalizeChoice(question, value);
  throw new Error(`unsupported Bootstrap question kind: ${question.kind}`);
}

export function normalizeBootstrapAnswer(question, value) {
  return normalizeAnswer(question, value);
}

function normalizeQuestion(question, index) {
  assert(isRecord(question), `Bootstrap question ${index} must be an object`);
  const id = question.id ?? question.question_id;
  assert(typeof id === "string" && SAFE_QUESTION_ID.test(id), `Bootstrap question ${index} ID is invalid`);
  const kind = question.kind ?? question.answer_kind;
  assert(["TEXT", "BOOLEAN", "CHOICE"].includes(kind), `Bootstrap question ${id} answer kind is invalid`);
  const prompt = normalizePrompt(question.prompt, `Bootstrap question ${id} prompt`);
  const required = question.required !== false;
  let choices = question.choices ?? [];
  if (kind === "BOOLEAN" && choices.length === 0) choices = [{value: true, label: "Yes"}, {value: false, label: "No"}];
  assert(Array.isArray(choices), `Bootstrap question ${id} choices are invalid`);
  if (kind === "TEXT") assert(choices.length === 0, `Bootstrap question ${id} text choices are invalid`);
  if (kind === "BOOLEAN") assert(choices.length === 2, `Bootstrap question ${id} boolean choices are invalid`);
  if (kind === "CHOICE") assert(choices.length >= 2 && choices.length <= 5, `Bootstrap question ${id} choices are invalid`);
  const normalizedChoices = choices.map((choice, choiceIndex) => {
    assert(isRecord(choice), `Bootstrap question ${id} choice ${choiceIndex} is invalid`);
    return {
      value: primitiveChoiceValue(choice.value, `Bootstrap question ${id} choice ${choiceIndex}`),
      label: normalizeLabel(choice.label, `Bootstrap question ${id} choice ${choiceIndex} label`),
    };
  });
  if (kind === "BOOLEAN") {
    assert(normalizedChoices.some((choice) => choice.value === true) && normalizedChoices.some((choice) => choice.value === false), `Bootstrap question ${id} boolean choices must be true and false`);
  }
  assert(new Set(normalizedChoices.map((choice) => canonicalDigest(choice.value))).size === normalizedChoices.length, `Bootstrap question ${id} choices are duplicated`);
  const defaultValue = question.default_value === undefined ? null : question.default_value;
  if (defaultValue !== null) {
    const normalizedDefault = normalizeAnswer({id, kind, choices: normalizedChoices}, defaultValue);
    assert(canonicalDigest(normalizedDefault) === canonicalDigest(defaultValue), `Bootstrap question ${id} default is not normalized`);
  }
  return {
    id,
    kind,
    prompt,
    choices: normalizedChoices,
    required,
    default_value: defaultValue === null ? null : normalizeAnswer({id, kind, choices: normalizedChoices}, defaultValue),
  };
}

export function createBootstrapQuestionMap(questionMap = BOOTSTRAP_QUESTIONS) {
  const supplied = isRecord(questionMap) && Array.isArray(questionMap.questions) ? questionMap.questions : questionMap;
  assert(Array.isArray(supplied) && supplied.length > 0 && supplied.length <= 128, "Bootstrap question map must contain between one and 128 questions");
  const questions = supplied.map(normalizeQuestion);
  const ids = questions.map((question) => question.id);
  assert(new Set(ids).size === ids.length, "Bootstrap question map contains duplicate IDs");
  const map = {
    schema: BOOTSTRAP_QUESTION_MAP_SCHEMA,
    version: BOOTSTRAP_QUESTION_MAP_VERSION,
    questions,
    map_sha256: null,
  };
  map.map_sha256 = canonicalDigest({...map, map_sha256: null});
  return map;
}

export function validateBootstrapQuestionMap(questionMap) {
  assert(isRecord(questionMap), "Bootstrap question map must be an object");
  assert(JSON.stringify(Object.keys(questionMap).sort()) === JSON.stringify(["map_sha256", "questions", "schema", "version"]), "Bootstrap question map fields mismatch");
  assert(questionMap.schema === BOOTSTRAP_QUESTION_MAP_SCHEMA && questionMap.version === BOOTSTRAP_QUESTION_MAP_VERSION, "Bootstrap question map identity is invalid");
  assert(Array.isArray(questionMap.questions) && questionMap.questions.length > 0, "Bootstrap question map questions are missing");
  const normalized = createBootstrapQuestionMap(questionMap.questions);
  assert(canonicalDigest(normalized.questions) === canonicalDigest(questionMap.questions), "Bootstrap question map questions are not normalized");
  assert(SHA256.test(questionMap.map_sha256) && questionMap.map_sha256 === canonicalDigest({...questionMap, map_sha256: null}), "Bootstrap question map is not content-addressed");
  return questionMap;
}

function resolveQuestionMap(questionMap = BOOTSTRAP_QUESTIONS) {
  if (isRecord(questionMap) && questionMap.schema === BOOTSTRAP_QUESTION_MAP_SCHEMA) {
    validateBootstrapQuestionMap(questionMap);
    return questionMap;
  }
  return createBootstrapQuestionMap(questionMap);
}

export function bootstrapQuestionById(questionId, questionMap = BOOTSTRAP_QUESTIONS) {
  assert(typeof questionId === "string", "Bootstrap question ID must be text");
  const map = resolveQuestionMap(questionMap);
  const normalizedId = questionId.toLowerCase();
  const question = map.questions.find((candidate) => candidate.id === normalizedId);
  if (!question) throw new Error(`unknown Bootstrap question: ${questionId}`);
  return question;
}

export function parseBootstrapReply(questionId, reply, {questionMap = BOOTSTRAP_QUESTIONS} = {}) {
  const question = bootstrapQuestionById(questionId, questionMap);
  return {question_id: question.id, value: normalizeAnswer(question, reply)};
}

function answerDigest(answer) {
  return canonicalDigest({
    question_id: answer.question_id,
    value: answer.value,
    certainty: answer.certainty,
    provenance: answer.provenance,
  });
}

function answerIsResolved(answer) {
  return isRecord(answer) && answer.provenance !== "UNRESOLVED_OWNER" && answer.certainty !== "UNKNOWN";
}

function answerRecord(question, source) {
  const typed = isRecord(source) && Object.hasOwn(source, "value")
    ? source
    : {value: source, certainty: "CONFIRMED", provenance: "OWNER"};
  const allowedKeys = ["value", "certainty", "provenance"];
  assert(Object.keys(typed).every((key) => allowedKeys.includes(key)), `Bootstrap answer ${question.id} contains an unknown field`);
  const provenance = typed.provenance ?? "OWNER";
  const certainty = typed.certainty ?? "CONFIRMED";
  assert(ANSWER_PROVENANCE.includes(provenance), `Bootstrap answer ${question.id} provenance is invalid`);
  assert(CERTAINTY.includes(certainty), `Bootstrap answer ${question.id} certainty is invalid`);
  let value = typed.value;
  if (provenance === "UNRESOLVED_OWNER") {
    assert(certainty === "UNKNOWN" && (value === null || value === undefined), `Bootstrap unresolved answer ${question.id} is invalid`);
    value = null;
  } else {
    value = normalizeAnswer(question, value);
    assertSafeValue(value, `Bootstrap answer ${question.id}`);
    if (provenance === "OWNER") assert(certainty === "CONFIRMED", `Bootstrap owner answer ${question.id} must be confirmed`);
    assert(certainty !== "UNKNOWN", `Bootstrap resolved answer ${question.id} cannot be unknown`);
  }
  const answer = {
    schema: BOOTSTRAP_ANSWER_SCHEMA,
    version: BOOTSTRAP_ANSWER_VERSION,
    question_id: question.id,
    value,
    certainty,
    provenance,
    answer_sha256: null,
  };
  answer.answer_sha256 = answerDigest(answer);
  return answer;
}

function validateAnswer(question, answer) {
  assert(isRecord(answer), `Bootstrap answer is invalid: ${question.id}`);
  assert(JSON.stringify(Object.keys(answer).sort()) === JSON.stringify(["answer_sha256", "certainty", "provenance", "question_id", "schema", "value", "version"]), `Bootstrap answer keys are invalid: ${question.id}`);
  assert(answer.schema === BOOTSTRAP_ANSWER_SCHEMA && answer.version === BOOTSTRAP_ANSWER_VERSION, `Bootstrap answer identity is invalid: ${question.id}`);
  assert(answer.question_id === question.id, `Bootstrap answer question binding is invalid: ${question.id}`);
  const rebuilt = answerRecord(question, {
    value: answer.value,
    certainty: answer.certainty,
    provenance: answer.provenance,
  });
  assert(canonicalDigest(rebuilt) === canonicalDigest(answer), `Bootstrap answer semantics are not canonical: ${question.id}`);
  assert(SHA256.test(answer.answer_sha256) && answer.answer_sha256 === answerDigest(answer), `Bootstrap answer digest is invalid: ${question.id}`);
  return answer;
}

function sessionDigest(session) {
  return canonicalDigest({...session, session_sha256: null});
}

function sealSession(session) {
  const sealed = structuredClone({...session, session_sha256: null});
  sealed.session_sha256 = sessionDigest(sealed);
  return Object.freeze(sealed);
}

function missingRequired(session) {
  return session.question_map.questions
    .filter((question) => question.required && !answerIsResolved(session.answers[question.id]))
    .map((question) => question.id);
}

function nextQuestionId(session, includeOptional) {
  return session.question_map.questions.find((question) => !answerIsResolved(session.answers[question.id])
    && (question.required || includeOptional))?.id ?? null;
}

function sessionStatus(session) {
  return session.disposition !== "ACTIVE" || missingRequired(session).length > 0
    ? "QUESTION_PENDING"
    : "READY_FOR_CONTRACT";
}

function questionSurface(question) {
  return {
    question_id: question.id,
    prompt: question.prompt,
    answer_kind: question.kind,
    choices: question.choices.map((choice) => choice.label),
    required: question.required,
  };
}

function safeAction(value, fallback) {
  const action = value ?? fallback;
  assert(typeof action === "string" && SAFE_ACTION.test(action), "conversation next action is invalid");
  return action;
}

export function createBootstrapConversation({
  projectRef = "unbound-project",
  priorContractDigest = null,
  questionMap = BOOTSTRAP_QUESTIONS,
  initialAnswers = {},
} = {}) {
  assert(typeof projectRef === "string" && SAFE_PROJECT_REF.test(projectRef), "projectRef must be a safe opaque project label");
  assert(priorContractDigest === null || SHA256.test(priorContractDigest), "priorContractDigest must be a SHA-256 or null");
  assert(isRecord(initialAnswers), "initialAnswers must be an object");
  const map = resolveQuestionMap(questionMap);
  const answers = {};
  for (const [questionId, source] of Object.entries(initialAnswers)) {
    const question = bootstrapQuestionById(questionId, map);
    answers[question.id] = answerRecord(question, source);
  }
  const answerOrder = map.questions.filter((question) => Object.hasOwn(answers, question.id)).map((question) => question.id);
  const session = {
    schema: BOOTSTRAP_CONVERSATION_SCHEMA,
    version: BOOTSTRAP_CONVERSATION_VERSION,
    status: "QUESTION_PENDING",
    project_ref: projectRef,
    question_map: map,
    answers,
    answer_order: answerOrder,
    reassessment_required: false,
    prior_contract_sha256: priorContractDigest,
    disposition: "ACTIVE",
    disposition_reason: null,
    next_action: "ANSWER_NEXT_MATERIAL_QUESTION",
    session_sha256: null,
  };
  session.status = sessionStatus(session);
  session.next_action = session.status === "READY_FOR_CONTRACT" ? "COMPILE_PROJECT_CONTRACT" : "ANSWER_NEXT_MATERIAL_QUESTION";
  return sealSession(session);
}

export function nextBootstrapQuestion(session, {includeOptional = false} = {}) {
  validateBootstrapConversation(session);
  if (session.disposition !== "ACTIVE") return null;
  const id = nextQuestionId(session, includeOptional);
  return id === null ? null : questionSurface(bootstrapQuestionById(id, session.question_map));
}

function failedReply(session, question = null, code = "ANSWER_NOT_RECOGNIZED") {
  return {
    accepted: false,
    replayed: false,
    error: {
      code,
      message: code === "CONVERSATION_NOT_ACTIVE"
        ? "This part is paused until the missing condition is available."
        : OWNER_RETRY_MESSAGE,
    },
    session,
    next_question: session.disposition === "ACTIVE"
      ? nextBootstrapQuestion(session)
      : question === null ? null : questionSurface(question),
  };
}

export function acceptBootstrapReply(session, {questionId, reply} = {}) {
  validateBootstrapConversation(session);
  if (session.disposition !== "ACTIVE") return failedReply(session, null, "CONVERSATION_NOT_ACTIVE");
  let question;
  try {
    question = bootstrapQuestionById(questionId, session.question_map);
    const value = parseBootstrapReply(question.id, reply, {questionMap: session.question_map}).value;
    const previous = session.answers[question.id];
    const replayed = previous?.provenance === "OWNER"
      && previous?.certainty === "CONFIRMED"
      && canonicalDigest(previous.value) === canonicalDigest(value);
    if (replayed) {
      return {
        accepted: true,
        replayed: true,
        session,
        next_question: nextBootstrapQuestion(session),
      };
    }
    const expected = nextQuestionId(session, true);
    const expectedQuestion = expected === null ? null : bootstrapQuestionById(expected, session.question_map);
    const optionalSkip = question.required === false && expectedQuestion?.required === false;
    const revision = previous !== undefined;
    assert(revision || expected === question.id || optionalSkip, "Bootstrap answers must follow the current question");
    const answers = {...session.answers, [question.id]: answerRecord(question, value)};
    const answerOrder = revision ? [...session.answer_order] : [...session.answer_order, question.id];
    const reassessmentRequired = session.reassessment_required
      || (previous !== undefined && ["intent.audience", "intent.outcome", "intent.first_result", "scope.allowed", "scope.non_goals"].includes(question.id));
    const next = {
      ...session,
      status: "QUESTION_PENDING",
      answers,
      answer_order: answerOrder,
      reassessment_required: reassessmentRequired,
      disposition: "ACTIVE",
      disposition_reason: null,
      next_action: "ANSWER_NEXT_MATERIAL_QUESTION",
      session_sha256: null,
    };
    next.status = sessionStatus(next);
    next.next_action = next.status === "READY_FOR_CONTRACT" ? "COMPILE_PROJECT_CONTRACT" : "ANSWER_NEXT_MATERIAL_QUESTION";
    const sealedNext = sealSession(next);
    return {
      accepted: true,
      replayed: false,
      session: sealedNext,
      next_question: nextBootstrapQuestion(sealedNext),
    };
  } catch {
    return failedReply(session, question);
  }
}

export function setBootstrapConversationDisposition(session, {disposition, reason = null, nextAction} = {}) {
  validateBootstrapConversation(session);
  assert(CONVERSATION_DISPOSITIONS.includes(disposition), "conversation disposition is invalid");
  assert(reason === null || typeof reason === "string", "conversation disposition reason is invalid");
  if (reason !== null) normalizePublicText(reason, "conversation disposition reason");
  const next = {
    ...session,
    status: "QUESTION_PENDING",
    disposition,
    disposition_reason: reason === null ? null : normalizePublicText(reason, "conversation disposition reason"),
    next_action: safeAction(nextAction, disposition === "ACTIVE" ? (session.status === "READY_FOR_CONTRACT" ? "COMPILE_PROJECT_CONTRACT" : "ANSWER_NEXT_MATERIAL_QUESTION") : "WAIT_FOR_BOUND_CONDITION"),
    session_sha256: null,
  };
  next.status = sessionStatus(next);
  return sealSession(next);
}

function publicSummaryList(value, label) {
  assert(Array.isArray(value), `${label} must be a list`);
  return value.map((item, index) => normalizePublicText(item, `${label}[${index}]`));
}

export function buildBootstrapConversationReplay(session, {
  outcome = null,
  firstUsefulWorkflow = null,
  boundaries = [],
} = {}) {
  validateBootstrapConversation(session);
  const replay = {
    schema: BOOTSTRAP_CONVERSATION_REPLAY_SCHEMA,
    version: BOOTSTRAP_CONVERSATION_REPLAY_VERSION,
    status: session.status === "READY_FOR_CONTRACT" && session.disposition === "ACTIVE" ? "READY_FOR_OWNER_CHECK" : "INCOMPLETE",
    session_sha256: session.session_sha256,
    question_map_sha256: session.question_map.map_sha256,
    outcome: outcome === null ? null : normalizePublicText(outcome, "replay outcome"),
    first_useful_workflow: firstUsefulWorkflow === null ? null : normalizePublicText(firstUsefulWorkflow, "replay first useful workflow"),
    boundaries: publicSummaryList(boundaries, "replay boundaries"),
    unresolved_question_ids: missingRequired(session),
    disposition: session.disposition,
    unavailable_reason: session.disposition === "ACTIVE" ? null : session.disposition_reason,
    next_action: session.next_action,
    owner_approval_required_for_protected_actions: true,
    replay_sha256: null,
  };
  replay.replay_sha256 = canonicalDigest({...replay, replay_sha256: null});
  return validateBootstrapConversationReplay(replay, {session});
}

function validateQuestionIdList(value, label) {
  assert(Array.isArray(value), `${label} must be a list`);
  assert(new Set(value).size === value.length, `${label} contains duplicates`);
  value.forEach((id, index) => assert(typeof id === "string" && SAFE_QUESTION_ID.test(id), `${label}[${index}] is invalid`));
  return value;
}

export function validateBootstrapConversationReplay(replay, {session = null} = {}) {
  assert(isRecord(replay), "Bootstrap conversation replay must be an object");
  const expectedKeys = [
    "boundaries", "disposition", "first_useful_workflow", "next_action", "outcome",
    "owner_approval_required_for_protected_actions", "question_map_sha256", "replay_sha256",
    "schema", "session_sha256", "status", "unavailable_reason", "unresolved_question_ids", "version",
  ];
  assert(JSON.stringify(Object.keys(replay).sort()) === JSON.stringify(expectedKeys.sort()), "Bootstrap conversation replay fields mismatch");
  assert(replay.schema === BOOTSTRAP_CONVERSATION_REPLAY_SCHEMA && replay.version === BOOTSTRAP_CONVERSATION_REPLAY_VERSION, "Bootstrap conversation replay identity is invalid");
  assert(["INCOMPLETE", "READY_FOR_OWNER_CHECK"].includes(replay.status), "Bootstrap conversation replay status is invalid");
  assert(SHA256.test(replay.session_sha256), "Bootstrap conversation replay session digest is invalid");
  assert(SHA256.test(replay.question_map_sha256), "Bootstrap conversation replay map digest is invalid");
  assert(replay.outcome === null || replay.outcome === normalizePublicText(replay.outcome, "replay outcome"), "Bootstrap replay outcome is not normalized");
  assert(replay.first_useful_workflow === null || replay.first_useful_workflow === normalizePublicText(replay.first_useful_workflow, "replay first useful workflow"), "Bootstrap replay workflow is not normalized");
  const boundaries = publicSummaryList(replay.boundaries, "replay boundaries");
  assert(canonicalDigest(boundaries) === canonicalDigest(replay.boundaries), "Bootstrap replay boundaries are not normalized");
  assert(CONVERSATION_DISPOSITIONS.includes(replay.disposition), "Bootstrap replay disposition is invalid");
  assert(replay.unavailable_reason === null || replay.unavailable_reason === normalizePublicText(replay.unavailable_reason, "replay unavailable reason"), "Bootstrap replay unavailable reason is not normalized");
  validateQuestionIdList(replay.unresolved_question_ids, "replay unresolved question IDs");
  assert(typeof replay.next_action === "string" && SAFE_ACTION.test(replay.next_action), "Bootstrap replay next action is invalid");
  assert(replay.owner_approval_required_for_protected_actions === true, "Bootstrap replay weakens owner approval");
  assert(SHA256.test(replay.replay_sha256) && replay.replay_sha256 === canonicalDigest({...replay, replay_sha256: null}), "Bootstrap conversation replay is not content-addressed");
  if (session !== null) {
    validateBootstrapConversation(session);
    const expectedStatus = session.status === "READY_FOR_CONTRACT" && session.disposition === "ACTIVE" ? "READY_FOR_OWNER_CHECK" : "INCOMPLETE";
    assert(replay.session_sha256 === session.session_sha256 && replay.question_map_sha256 === session.question_map.map_sha256, "Bootstrap replay is bound to a different session");
    assert(replay.status === expectedStatus && replay.disposition === session.disposition && replay.next_action === session.next_action, "Bootstrap replay state differs from the session");
    assert(JSON.stringify(replay.unresolved_question_ids) === JSON.stringify(missingRequired(session)), "Bootstrap replay unresolved questions differ from the session");
  }
  return replay;
}

function validateSourceBinding(sourceBinding) {
  const source = sourceBinding ?? {};
  assert(isRecord(source), "conversation source binding must be an object");
  const sourceCommit = source.source_commit ?? null;
  const sourceTree = source.source_tree ?? null;
  assert(sourceCommit === null || GIT_OBJECT.test(sourceCommit), "conversation source commit is invalid");
  assert(sourceTree === null || GIT_OBJECT.test(sourceTree), "conversation source tree is invalid");
  const normalized = {
    status: sourceCommit !== null && sourceTree !== null ? "BOUND" : "PENDING_READBACK",
    source_commit: sourceCommit,
    source_tree: sourceTree,
  };
  if (Object.hasOwn(source, "status")) assert(source.status === normalized.status, "conversation source binding status is invalid");
  return normalized;
}

export function buildBootstrapConversationHandoff(session, {sourceBinding = {}, replay = null} = {}) {
  validateBootstrapConversation(session);
  const source = validateSourceBinding(sourceBinding);
  if (replay !== null) {
    validateBootstrapConversationReplay(replay, {session});
  }
  const handoff = {
    schema: BOOTSTRAP_CONVERSATION_HANDOFF_SCHEMA,
    version: BOOTSTRAP_CONVERSATION_HANDOFF_VERSION,
    status: session.status,
    disposition: session.disposition,
    session_sha256: session.session_sha256,
    question_map_sha256: session.question_map.map_sha256,
    source_binding: source,
    answered_question_ids: [...session.answer_order],
    unresolved_question_ids: missingRequired(session),
    next_action: session.next_action,
    replay_sha256: replay?.replay_sha256 ?? null,
    raw_owner_text_persisted: false,
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = canonicalDigest({...handoff, handoff_sha256: null});
  return validateBootstrapConversationHandoff(handoff, {session, replay});
}

export function validateBootstrapConversationHandoff(handoff, {session = null, replay = null} = {}) {
  assert(isRecord(handoff), "Bootstrap conversation handoff must be an object");
  const expectedKeys = [
    "answered_question_ids", "disposition", "handoff_sha256", "next_action", "question_map_sha256",
    "raw_owner_text_persisted", "replay_sha256", "schema", "session_sha256", "source_binding", "status",
    "unresolved_question_ids", "version",
  ];
  assert(JSON.stringify(Object.keys(handoff).sort()) === JSON.stringify(expectedKeys.sort()), "Bootstrap conversation handoff fields mismatch");
  assert(handoff.schema === BOOTSTRAP_CONVERSATION_HANDOFF_SCHEMA && handoff.version === BOOTSTRAP_CONVERSATION_HANDOFF_VERSION, "Bootstrap conversation handoff identity is invalid");
  assert(["QUESTION_PENDING", "READY_FOR_CONTRACT"].includes(handoff.status), "Bootstrap conversation handoff status is invalid");
  assert(CONVERSATION_DISPOSITIONS.includes(handoff.disposition), "Bootstrap conversation handoff disposition is invalid");
  assert(SHA256.test(handoff.session_sha256), "Bootstrap conversation handoff session digest is invalid");
  assert(SHA256.test(handoff.question_map_sha256), "Bootstrap conversation handoff map digest is invalid");
  validateSourceBinding(handoff.source_binding);
  validateQuestionIdList(handoff.answered_question_ids, "handoff answered question IDs");
  validateQuestionIdList(handoff.unresolved_question_ids, "handoff unresolved question IDs");
  assert(typeof handoff.next_action === "string" && SAFE_ACTION.test(handoff.next_action), "Bootstrap conversation handoff next action is invalid");
  assert(handoff.replay_sha256 === null || SHA256.test(handoff.replay_sha256), "Bootstrap conversation handoff replay digest is invalid");
  assert(handoff.raw_owner_text_persisted === false, "Bootstrap conversation handoff persists raw owner text");
  assert(SHA256.test(handoff.handoff_sha256) && handoff.handoff_sha256 === canonicalDigest({...handoff, handoff_sha256: null}), "Bootstrap conversation handoff is not content-addressed");
  if (replay !== null) {
    validateBootstrapConversationReplay(replay, {session});
    assert(handoff.replay_sha256 === replay.replay_sha256, "Bootstrap handoff replay digest differs from the replay");
  }
  if (session !== null) {
    validateBootstrapConversation(session);
    assert(handoff.status === session.status && handoff.disposition === session.disposition, "Bootstrap handoff state differs from the session");
    assert(handoff.session_sha256 === session.session_sha256 && handoff.question_map_sha256 === session.question_map.map_sha256, "Bootstrap handoff is bound to a different session");
    assert(JSON.stringify(handoff.answered_question_ids) === JSON.stringify(session.answer_order), "Bootstrap handoff answered questions differ from the session");
    assert(JSON.stringify(handoff.unresolved_question_ids) === JSON.stringify(missingRequired(session)), "Bootstrap handoff unresolved questions differ from the session");
    assert(handoff.next_action === session.next_action, "Bootstrap handoff next action differs from the session");
  }
  return handoff;
}

export function validateBootstrapConversation(session) {
  assert(isRecord(session), "Bootstrap conversation must be an object");
  const expectedKeys = [
    "answer_order", "answers", "disposition", "disposition_reason", "next_action", "prior_contract_sha256",
    "project_ref", "question_map", "reassessment_required", "schema", "session_sha256", "status", "version",
  ];
  assert(JSON.stringify(Object.keys(session).sort()) === JSON.stringify(expectedKeys.sort()), "Bootstrap conversation fields mismatch");
  assert(session.schema === BOOTSTRAP_CONVERSATION_SCHEMA && session.version === BOOTSTRAP_CONVERSATION_VERSION, "Bootstrap conversation identity is invalid");
  assert(["QUESTION_PENDING", "READY_FOR_CONTRACT"].includes(session.status), "Bootstrap conversation status is invalid");
  assert(typeof session.project_ref === "string" && SAFE_PROJECT_REF.test(session.project_ref), "Bootstrap conversation project reference is invalid");
  validateBootstrapQuestionMap(session.question_map);
  assert(isRecord(session.answers), "Bootstrap conversation answers are invalid");
  for (const [questionId, answer] of Object.entries(session.answers)) {
    const question = bootstrapQuestionById(questionId, session.question_map);
    validateAnswer(question, answer);
  }
  assert(Array.isArray(session.answer_order), "Bootstrap answer order is invalid");
  assert(new Set(session.answer_order).size === session.answer_order.length, "Bootstrap answer order contains duplicates");
  assert(session.answer_order.length === Object.keys(session.answers).length, "Bootstrap answer order is incomplete");
  assert(session.answer_order.every((id) => Object.hasOwn(session.answers, id)), "Bootstrap answer order references an unknown answer");
  assert(JSON.stringify([...session.answer_order].sort(compareUtf8)) === JSON.stringify(Object.keys(session.answers).sort(compareUtf8)), "Bootstrap answer order does not cover answers");
  assert(typeof session.reassessment_required === "boolean", "Bootstrap reassessment flag is invalid");
  assert(session.prior_contract_sha256 === null || SHA256.test(session.prior_contract_sha256), "Bootstrap prior contract digest is invalid");
  assert(CONVERSATION_DISPOSITIONS.includes(session.disposition), "Bootstrap conversation disposition is invalid");
  assert(session.disposition_reason === null || (typeof session.disposition_reason === "string"
    && session.disposition_reason === normalizePublicText(session.disposition_reason, "Bootstrap conversation disposition reason")), "Bootstrap conversation disposition reason is invalid");
  assert(typeof session.next_action === "string" && SAFE_ACTION.test(session.next_action), "Bootstrap conversation next action is invalid");
  assert(session.status === sessionStatus(session), "Bootstrap conversation status does not match resolved answers");
  assert(SHA256.test(session.session_sha256) && session.session_sha256 === sessionDigest(session), "Bootstrap conversation is not content-addressed");
  return session;
}

export function requiredBootstrapQuestionIds(questionMap = BOOTSTRAP_QUESTIONS) {
  return resolveQuestionMap(questionMap).questions.filter((question) => question.required).map((question) => question.id);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Bootstrap conversation surface loaded\n");
