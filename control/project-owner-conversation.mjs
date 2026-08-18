#!/usr/bin/env node

/* Plain-language, Project-Owner-only human conversation contract. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const PROJECT_OWNER_CONVERSATION_SCHEMA = "agentos.project_owner_conversation.v1";
export const PROJECT_OWNER_QUESTION_SCHEMA = "agentos.project_owner_choice_question.v1";
export const HUMAN_FACING_ROLE = "AGENTOS.PROJECT_OWNER";
export const DEFAULT_EXPLANATION_LEVEL = "SIMPLE";
export const EXPLANATION_LEVELS = Object.freeze(["SIMPLE", "ELABORATE", "ADVANCED"]);

const HASH_OR_CODE = /(?:\b[0-9a-f]{12,64}\b|\b[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+){1,}\b|\b(?:sha256|commit|tree|digest|schema|stack trace)\b)/iu;
const TECHNICAL_FENCE = /```|`[^`]+`|(?:^|\n)\s*(?:at\s+\S+\s*\(|Error:|[A-Za-z]:\\|\/(?:[A-Za-z0-9._-]+\/){2,})/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function assert(condition, message) { if (!condition) throw new Error(message); }
function record(value, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); }
function exact(value, keys, label) { record(value, label); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`); }
function text(value, label) { assert(typeof value === "string" && value.trim().length > 0 && !CONTROL.test(value), `${label} must be plain text`); }
function body(value, digest = "conversation_sha256") { return {...structuredClone(value), [digest]: null}; }

export function validateProjectOwnerConversation(value) {
  exact(value, ["schema", "version", "speaker_role", "explanation_level", "message", "choices", "technical_details_hidden", "private_evidence_refs", "conversation_sha256"], "Project Owner conversation");
  assert(value.schema === PROJECT_OWNER_CONVERSATION_SCHEMA && value.version === 1, "Project Owner conversation identity differs");
  assert(value.speaker_role === HUMAN_FACING_ROLE, "Only the Project Owner may speak to the user by default");
  assert(EXPLANATION_LEVELS.includes(value.explanation_level), "Project Owner explanation level is invalid");
  text(value.message, "Project Owner message");
  if (value.explanation_level === "SIMPLE") {
    assert(!HASH_OR_CODE.test(value.message) && !TECHNICAL_FENCE.test(value.message), "Simple user response exposes codes, hashes, paths, or debugging details");
    assert(value.message.split(/\s+/u).length <= 180, "Simple user response is too long");
  }
  assert(Array.isArray(value.choices) && value.choices.length <= 5, "Project Owner choices are invalid");
  for (const [index, choice] of value.choices.entries()) {
    exact(choice, ["key", "label", "meaning"], `Project Owner choice ${index}`);
    assert(choice.key === String(index + 1) || choice.key === String.fromCharCode(97 + index) || choice.key === "n", "Project Owner choice key is invalid");
    text(choice.label, `Project Owner choice ${index} label`); text(choice.meaning, `Project Owner choice ${index} meaning`);
    assert(!HASH_OR_CODE.test(choice.label) && !TECHNICAL_FENCE.test(choice.label), "Project Owner choice is not simple language");
  }
  assert(value.technical_details_hidden === (value.explanation_level !== "ADVANCED"), "Project Owner technical-detail visibility differs");
  assert(Array.isArray(value.private_evidence_refs) && value.private_evidence_refs.every((item) => typeof item === "string" && /^(?:opaque:|ref:)/u.test(item)), "Project Owner private evidence references are invalid");
  assert(value.conversation_sha256 === canonicalDigest(body(value)), "Project Owner conversation digest differs");
  return value;
}

export function compileProjectOwnerResponse({message, explanationLevel = DEFAULT_EXPLANATION_LEVEL, choices = [], privateEvidenceRefs = []} = {}) {
  const value = {schema: PROJECT_OWNER_CONVERSATION_SCHEMA, version: 1, speaker_role: HUMAN_FACING_ROLE, explanation_level: explanationLevel, message, choices: structuredClone(choices), technical_details_hidden: explanationLevel !== "ADVANCED", private_evidence_refs: [...privateEvidenceRefs].sort(compareUtf8), conversation_sha256: null};
  value.conversation_sha256 = canonicalDigest(body(value)); return validateProjectOwnerConversation(value);
}

export function compileStandardOwnerQuestion({message, keyStyle = "NUMBER"} = {}) {
  assert(["NUMBER", "LETTER"].includes(keyStyle), "Project Owner question key style is invalid");
  const keys = keyStyle === "NUMBER" ? ["1", "2", "3", "4", "n"] : ["a", "b", "c", "d", "n"];
  return compileProjectOwnerResponse({message, choices: [
    {key: keys[0], label: "Yes", meaning: "Use this choice."},
    {key: keys[1], label: "No", meaning: "Do not use this choice."},
    {key: keys[2], label: "Explain more", meaning: "Give a longer, simple explanation with pros and cons."},
    {key: keys[3], label: "Advanced details", meaning: "Show the full technical explanation and debugging details."},
    {key: keys[4], label: "Not sure", meaning: "Help me choose without guessing for me."},
  ]});
}

export function explanationLevelForChoice(choice) {
  if (["3", "c"].includes(String(choice).toLowerCase())) return "ELABORATE";
  if (["4", "d"].includes(String(choice).toLowerCase())) return "ADVANCED";
  return "SIMPLE";
}
