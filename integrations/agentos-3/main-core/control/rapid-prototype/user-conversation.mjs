#!/usr/bin/env node

const CONVERSATION_STATES = Object.freeze([
  "PROCEED",
  "PUZZLE",
  "SOFT_REVIEW",
  "UNAVAILABLE",
  "HARD_STOP",
]);

const DECISION_ALIASES = Object.freeze({
  READY: "PROCEED",
  OWNER_REQUIRED: "SOFT_REVIEW",
  UNRESOLVED: "SOFT_REVIEW",
  REPAIRABLE_ENGINEERING_PUZZLE: "PUZZLE",
  SOFT_BOUNDARY_REVIEW: "SOFT_REVIEW",
});

const SENSITIVE_REASON = /(?:https?:\/\/|\/(?:Users|home|private|tmp|var)\/|(?:[A-Za-z]:[\\/]|\\\\|~[\\/])|\b(?:password|passphrase|credential|secret|token|session)\b|\S+@\S+)/iu;
const PROTECTED_ACTION = /\b(?:authenticate|log\s+in|sign\s+in|spend|pay|publish|deploy|release|delete|push|merge|upload|send\s+(?:it|this|the)|password|passphrase|credential|secret|token)\b/iu;

export {CONVERSATION_STATES};

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value, label) {
  assert(typeof value === "string", `${label} must be a string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  const text = value.replace(/\s+/gu, " ").trim();
  assert(text.length > 0, `${label} must be a nonempty string`);
  return text;
}

function optionalBinding(value, label) {
  if (value === null || value === undefined || value === "") return null;
  return normalizeText(value, label);
}

function normalizeStatement(value, label) {
  if (value === null || value === undefined || value === "") return "";
  return normalizeText(value, label).replace(/\?/gu, ".");
}

function publicReason(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const text = normalizeStatement(value, "conversation reason");
  return SENSITIVE_REASON.test(text) ? fallback : text;
}

function containsSensitiveInput(value, seen = new Set()) {
  if (typeof value === "string") return SENSITIVE_REASON.test(value);
  if (value === null || value === undefined || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => containsSensitiveInput(child, seen));
}

function normalizeDecision(decision) {
  if (decision === null || decision === undefined || decision === "") {
    return {state: "PROCEED", reason: null, decisionRef: null};
  }

  const supplied = isRecord(decision)
    ? decision.state ?? decision.status ?? decision.decision ?? decision.classification
    : decision;
  assert(typeof supplied === "string", "decision must be a supported state or state object");
  const requested = supplied.trim().toUpperCase();
  const state = DECISION_ALIASES[requested] ?? requested;
  assert(CONVERSATION_STATES.includes(state), `unsupported conversation state: ${supplied}`);
  const reason = isRecord(decision)
    ? publicReason(decision.reason ?? decision.detail ?? decision.message, null)
    : null;
  const decisionRef = isRecord(decision)
    ? optionalBinding(decision.decisionRef ?? decision.decision_ref, "owner decision reference")
    : null;
  return {state, reason, decisionRef};
}

function normalizeUnavailable(unavailable) {
  if (unavailable === null || unavailable === undefined || unavailable === false || unavailable === "") {
    return {active: false, reason: null};
  }
  if (unavailable === true) {
    return {active: true, reason: "The information or capability needed for this step is not available."};
  }
  if (typeof unavailable === "string") {
    return {active: true, reason: publicReason(unavailable, "The information or capability needed for this step is not available.")};
  }
  assert(isRecord(unavailable), "unavailable must be a boolean, reason, or state object");
  let active = unavailable.active;
  if (active === undefined) {
    if (unavailable.available !== undefined) active = unavailable.available === false;
    else if (unavailable.status !== undefined) active = unavailable.status === "UNAVAILABLE";
    else active = true;
  }
  if (!active) return {active: false, reason: null};
  return {
    active: true,
    reason: publicReason(unavailable.reason ?? unavailable.detail ?? unavailable.message, "The information or capability needed for this step is not available."),
  };
}

function questionCandidate(value) {
  if (typeof value === "string") return {text: value, realOwnerChoice: true, questionId: null, decisionRef: null};
  if (!isRecord(value)) return null;
  const realOwnerChoice = value.realOwnerChoice ?? value.real_owner_choice ?? value.ownerChoice ?? value.owner_choice ?? value.required ?? true;
  if (realOwnerChoice === false || realOwnerChoice === "false" || value.kind === "INFORMATIONAL") return null;
  const text = value.question ?? value.prompt ?? value.text ?? value.label;
  return typeof text === "string"
    ? {
      text,
      realOwnerChoice: true,
      questionId: optionalBinding(value.questionId ?? value.question_id, "owner question ID"),
      decisionRef: optionalBinding(value.decisionRef ?? value.decision_ref, "owner decision reference"),
    }
    : null;
}

function compactQuestion(value) {
  const normalized = normalizeText(value, "owner question").replace(/^[>*\-\s]*(?:\d+[.)]\s*)?/u, "");
  const firstQuestion = normalized.split("?")[0].trim();
  if (firstQuestion.length === 0) return null;
  const shortened = firstQuestion.length <= 120
    ? firstQuestion
    : `${firstQuestion.slice(0, 117).replace(/\s+\S*$/u, "").trim()}...`;
  return `${shortened.replace(/[.!]+$/u, "")}?`;
}

function firstOwnerQuestion(openQuestions) {
  for (const candidate of openQuestions) {
    const question = questionCandidate(candidate);
    if (question === null) continue;
    const compact = compactQuestion(question.text);
    if (compact !== null && !SENSITIVE_REASON.test(compact)) return {...question, text: compact};
  }
  return null;
}

function normalizeSafeDefault(value) {
  if (value === null || value === undefined || value === "") return null;
  if (isRecord(value)) value = value.value ?? value.label ?? value.text;
  assert(typeof value === "string", "safeDefault must be a string or labeled value");
  const normalized = normalizeStatement(value, "safeDefault");
  return SENSITIVE_REASON.test(normalized) ? null : normalized;
}

function stateSentence(state) {
  return {
    PROCEED: "I can continue with the current plan.",
    PUZZLE: "I found a small, fixable problem. I will try one focused repair and check it again.",
    SOFT_REVIEW: "This is a small choice about how to proceed.",
    UNAVAILABLE: "I cannot confirm what I need right now, so I am pausing this part.",
    HARD_STOP: "I need to stop here because this would cross a protected boundary.",
  }[state];
}

function selectedChoice(state, question, safeDefault) {
  if (question !== null || state === "UNAVAILABLE" || state === "HARD_STOP") return null;
  return safeDefault;
}

export function buildConversationTurn({
  message = "",
  openQuestions = [],
  safeDefault = null,
  unavailable = null,
  decision = "PROCEED",
  requireQuestionBinding = false,
} = {}) {
  assert(Array.isArray(openQuestions), "openQuestions must be an array");
  assert(typeof requireQuestionBinding === "boolean", "requireQuestionBinding must be a boolean");
  const protectedInput = containsSensitiveInput({message, openQuestions, safeDefault, unavailable, decision});
  const baseMessage = protectedInput
    ? "I am keeping the details private while I check this."
    : publicReason(message, "I am keeping the details private while I check this.");
  const normalizedDecision = normalizeDecision(decision);
  const unavailableState = normalizeUnavailable(unavailable);
  let state = normalizedDecision.state;
  let reason = normalizedDecision.reason;

  if (state === "HARD_STOP") {
    reason = reason ?? "The requested step is outside the current boundary.";
  } else if (state === "UNAVAILABLE" || unavailableState.active) {
    state = "UNAVAILABLE";
    reason = reason ?? unavailableState.reason ?? "The information or capability needed for this step is not available.";
  }

  if (protectedInput) {
    state = "HARD_STOP";
    reason = "The supplied details are protected, so I need to stop here.";
  }

  let question = !protectedInput && (state === "PROCEED" || state === "SOFT_REVIEW")
    ? firstOwnerQuestion(openQuestions)
    : null;
  if (question !== null && question.decisionRef === null) question.decisionRef = normalizedDecision.decisionRef;
  const questionBinding = question === null ? null : {
    question_id: question.questionId,
    decision_ref: question.decisionRef,
    status: question.questionId !== null && question.decisionRef !== null ? "BOUND" : "UNBOUND",
  };
  let defaultValue = protectedInput ? null : normalizeSafeDefault(safeDefault);

  if (question !== null && requireQuestionBinding && questionBinding.status !== "BOUND") {
    state = "UNAVAILABLE";
    reason = "I cannot continue until this question is tied to the platform decision it belongs to.";
    question = null;
  }

  if (question !== null && PROTECTED_ACTION.test(question.text)) {
    state = "HARD_STOP";
    reason = "The proposed choice would cross a protected boundary.";
    question = null;
  }

  if (question === null && state !== "UNAVAILABLE" && state !== "HARD_STOP" && defaultValue !== null && PROTECTED_ACTION.test(defaultValue)) {
    state = "HARD_STOP";
    reason = "The proposed default would cross a protected boundary.";
    defaultValue = null;
  }

  const questionText = question?.text ?? null;
  const choice = selectedChoice(state, questionText, defaultValue);
  if (questionText === null && choice === null && state !== "UNAVAILABLE" && state !== "HARD_STOP") {
    state = "UNAVAILABLE";
    reason = "No safe next step was provided.";
  }

  const visibleParts = [baseMessage, stateSentence(state)];
  if (reason !== null && (state === "UNAVAILABLE" || state === "HARD_STOP")) visibleParts.push(reason);
  if (questionText !== null) visibleParts.push(questionText);
  if (choice !== null) visibleParts.push(`I will use this for now: ${choice}.`);

  return {
    status: state,
    state,
    decision: state,
    message: visibleParts.filter(Boolean).join(" "),
    question: questionText,
    questions: questionText === null ? [] : [questionText],
    question_binding: questionBinding,
    safeDefault: choice,
    choice: question !== null
      ? {kind: "OWNER_CHOICE", question: questionText, question_id: questionBinding.question_id, decision_ref: questionBinding.decision_ref}
      : choice === null
        ? null
        : {kind: "SAFE_DEFAULT", value: choice},
    unavailable: state === "UNAVAILABLE",
    reason,
  };
}
