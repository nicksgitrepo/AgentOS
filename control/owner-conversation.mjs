import {assert, digestWithout} from "./canonical-json.mjs";

export const OWNER_SURFACE_SCHEMA = "agentos.owner_question.v1";
const TECHNICAL_WORDS = /\b(?:agentos|governance|campaign|schema|commit|worktree|session|runtime|orchestrator|auditor|audit|model|repository|repo|git|deployment|digest|lane|packet|role|source|environment)\b/iu;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function plain(value, label) {
  nonempty(value, label);
  assert(!TECHNICAL_WORDS.test(value), `${label} contains internal language`);
  assert(value.trim().split(/\s+/u).length <= 24, `${label} is too long`);
  assert(!/[{}[\]<>`]/u.test(value), `${label} looks like a technical form`);
}

export function validateOwnerQuestion(surface) {
  exactKeys(surface, ["schema", "version", "question_id", "prompt", "choices", "boolean_answers", "internal_fields_hidden", "digest"], "owner question");
  assert(surface.schema === OWNER_SURFACE_SCHEMA && surface.version === 1 && surface.internal_fields_hidden === true, "owner question identity is invalid");
  assert(typeof surface.boolean_answers === "boolean", "owner question boolean_answers is invalid");
  plain(surface.prompt, "prompt");
  assert(Array.isArray(surface.choices) && surface.choices.length >= 2 && surface.choices.length <= 5, "owner question choices are invalid");
  const choiceValues = new Set();
  for (const [index, choice] of surface.choices.entries()) {
    exactKeys(choice, ["number", "value", "label"], `owner question choice ${index}`);
    assert(choice.number === index + 1, `owner question choice ${index} number is invalid`);
    nonempty(choice.value, `owner question choice ${index}.value`);
    assert(!choiceValues.has(choice.value), `owner question choice ${index}.value is duplicated`);
    choiceValues.add(choice.value);
    plain(choice.label, `owner question choice ${index}.label`);
  }
  assert(surface.digest === digestWithout(surface, "digest"), "owner question digest does not match content");
  return surface;
}

export function renderOwnerQuestion({question_id, prompt, choices, allow_boolean = false}) {
  assert(typeof question_id === "string" && /^[A-Z][A-Z0-9._-]*$/u.test(question_id), "question_id is invalid");
  plain(prompt, "prompt");
  assert(Array.isArray(choices) && choices.length >= 2 && choices.length <= 5, "choices must contain between two and five options");
  const numbers = choices.map((choice, index) => {
    exactKeys(choice, ["value", "label"], `choice ${index}`);
    nonempty(choice.value, `choice ${index}.value`);
    plain(choice.label, `choice ${index}.label`);
    return {number: index + 1, value: choice.value, label: choice.label};
  });
  const surface = {
    schema: OWNER_SURFACE_SCHEMA,
    version: 1,
    question_id,
    prompt,
    choices: numbers,
    boolean_answers: allow_boolean,
    internal_fields_hidden: true,
    digest: null,
  };
  surface.digest = digestWithout(surface, "digest");
  return validateOwnerQuestion(surface);
}

export function parseOwnerAnswer(surface, input) {
  validateOwnerQuestion(surface);
  nonempty(String(input), "owner answer");
  const normalized = String(input).trim().toLowerCase();
  if (surface.boolean_answers && ["yes", "y"].includes(normalized)) return {question_id: surface.question_id, answer: "YES", value: true};
  if (surface.boolean_answers && ["no", "n"].includes(normalized)) return {question_id: surface.question_id, answer: "NO", value: false};
  const number = Number.parseInt(normalized, 10);
  assert(Number.isInteger(number) && String(number) === normalized, "answer must be one of the shown numbers or yes/no");
  const choice = surface.choices.find((item) => item.number === number);
  assert(choice, "answer number is not one of the shown choices");
  return {question_id: surface.question_id, answer: "CHOICE", value: choice.value};
}
