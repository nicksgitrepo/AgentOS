#!/usr/bin/env node

import {scanPublicPayload} from "./security-privacy.mjs";

const MAX_MESSAGE_LENGTH = 280;
const MAX_QUESTION_LENGTH = 240;
const MAX_NEXT_STEP_LENGTH = 240;
const MAX_OPTION_LENGTH = 120;
const MAX_OPTIONS = 6;

const STATUS_DEFINITIONS = Object.freeze({
  ready: Object.freeze({
    label: "READY",
    message: "The requested outcome is ready for review.",
    nextStep: "Review the result.",
  }),
  "one-question": Object.freeze({
    label: "ONE QUESTION",
    message: "One owner decision is needed before work can continue.",
    nextStep: "Choose one safe option to continue.",
  }),
  unavailable: Object.freeze({
    label: "UNAVAILABLE",
    message: "This capability is unavailable here; no interactive completion is claimed.",
    nextStep: "Use the safe local handoff or retry when the capability is available.",
  }),
  puzzle: Object.freeze({
    label: "PUZZLE",
    message: "A bounded implementation issue needs a small repair.",
    nextStep: "Apply the bounded repair and run the focused check.",
  }),
  "soft-review": Object.freeze({
    label: "SOFT REVIEW",
    message: "A non-protected choice needs owner review before work continues.",
    nextStep: "Record the choice and its impact before continuing.",
  }),
  "hard-stop": Object.freeze({
    label: "HARD STOP",
    message: "Work is stopped at a protected boundary.",
    nextStep: "Preserve the evidence and obtain a fresh authorized handoff.",
  }),
  conflict: Object.freeze({
    label: "CONFLICT",
    message: "The supplied outcome is contradictory, so no success state is shown.",
    nextStep: "Reconcile the current state and run a fresh exact check.",
  }),
});

const STATUS_ALIASES = new Map([
  ["ready", "ready"],
  ["one-question", "one-question"],
  ["onequestion", "one-question"],
  ["unavailable", "unavailable"],
  ["puzzle", "puzzle"],
  ["soft-review", "soft-review"],
  ["softreview", "soft-review"],
  ["hard-stop", "hard-stop"],
  ["hardstop", "hard-stop"],
  ["conflict", "conflict"],
]);

// These patterns identify content that must never be copied into a public
// surface. They describe classes of protected data, not any project or
// provider identity.
const PROTECTED_CONTENT_PATTERNS = Object.freeze([
  /(?:https?|file):\/\//iu,
  /\/(?:Users|home|private|tmp|var|etc|root|Volumes|mnt|opt)\//iu,
  /(?:[A-Za-z]:[\\/]|\\\\[A-Za-z0-9._-]+[\\/]|~[\\/])/u,
  /(?:^|[\s"'(])(?:\.\.?(?:[\\/])|[A-Za-z]:[\\/]|\\\\)/u,
  /\b(?:api[_ -]?key|access[_ -]?token|auth(?:orization)?|password|passwd|secret|credential|private[_ -]?key|bearer)\s*[:=]/iu,
  /\b(?:sk|pk|ghp|github_pat|xox[baprs]-|AIza|AKIA)[-_A-Za-z0-9]{8,}\b/u,
  /\b(?:clientThreadId|session[_ -]?id|thread[_ -]?id|host[_ -]?id|project[_ -]?id|provider[_ -]?id|workspace[_ -]?id|role[_ -]?id)\b\s*[:=]?\s*[A-Za-z0-9._:-]+/iu,
  /\b(?:clientThreadId|session[_ -]?id|thread[_ -]?id|host[_ -]?id|project[_ -]?id|provider[_ -]?id|workspace[_ -]?id|role[_ -]?id)\b/iu,
  /\b(?:session|thread|host|project|provider|workspace|client)\s*[:=]\s*[A-Za-z0-9._:-]+/iu,
  /\bprovider(?:\s+name)?\s*[:=]\s*[A-Za-z0-9._:-]+/iu,
  /\b(?:SESSION|THREAD|HOST|PROJECT|PROVIDER|CLIENT)[-_][A-Z0-9]{2,}\b/u,
  /\b(?:decision[_ -]?tree|control[_ -]?plane|internal[_ -]?route|subagent|shell[_ -]?worker|local[_ -]?daemon|parent[_ -]?child|private[_ -]?(?:conversation|chat|transcript|context)|raw[_ -]?(?:session|conversation|chat|transcript|context))\b/iu,
  /\b(?:classification|decision[_ -]?branch|route[_ -]?record)\s*[:=]/iu,
  /(?:^|\n)\s*(?:system|assistant|user|tool|developer)\s*:\s*/imu,
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectStrings(value, seen = new Set()) {
  if (typeof value === "string") return [value];
  if (value === null || value === undefined) return [];
  if (typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const strings = [];
  if (Array.isArray(value)) {
    for (const item of value) strings.push(...collectStrings(item, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      strings.push(key, ...collectStrings(item, seen));
    }
  }
  return strings;
}

function containsProtectedContent(value) {
  return collectStrings(value).some((candidate) =>
    PROTECTED_CONTENT_PATTERNS.some((pattern) => pattern.test(candidate))
  );
}

function cleanText(value, fallback, limit) {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(/[\u202A-\u202E\u2066-\u2069\u200B\u200C\u200D\uFEFF]/gu, "")
    .replace(/[<>]/gu, (character) => (character === "<" ? "‹" : "›"))
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit)
    .trim();
  return cleaned || fallback;
}

function classifyStatus(value) {
  if (Array.isArray(value)) return {kind: "conflict", recognized: true};
  if (typeof value !== "string") return {kind: "hard-stop", recognized: false};
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
  if (/[|,;/]/u.test(normalized) || /\s+(?:and|or)\s+/u.test(normalized)) return {kind: "conflict", recognized: true};
  const kind = STATUS_ALIASES.get(normalized);
  return {kind: kind ?? "hard-stop", recognized: kind !== undefined};
}

function normalizeOptions(value) {
  if (value === undefined || value === null) return {valid: true, options: []};
  if (!Array.isArray(value)) return {valid: false, options: []};
  const options = [];
  const seen = new Set();
  for (const option of value) {
    const label = typeof option === "string"
      ? option
      : isRecord(option) && typeof option.label === "string" ? option.label : null;
    if (label === null) continue;
    const cleaned = cleanText(label, "", MAX_OPTION_LENGTH);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    options.push(cleaned);
    if (options.length === MAX_OPTIONS) break;
  }
  return {valid: true, options};
}

function buildSurface({status, message, question = null, options = [], nextStep}) {
  const definition = STATUS_DEFINITIONS[status];
  const surface = {
    schema: "agentos.owner_surface.v1",
    version: 1,
    status,
    label: definition.label,
    message: cleanText(message, definition.message, MAX_MESSAGE_LENGTH),
    question: question === null ? null : cleanText(question, null, MAX_QUESTION_LENGTH),
    options: Object.freeze([...options]),
    nextStep: cleanText(nextStep, definition.nextStep, MAX_NEXT_STEP_LENGTH),
  };
  const lines = [surface.label, surface.message];
  if (surface.question !== null) lines.push(`Question: ${surface.question}`);
  if (surface.options.length > 0) {
    lines.push(`Options: ${surface.options.map((option, index) => `${index + 1}. ${option}`).join("; ")}`);
  }
  lines.push(`Next: ${surface.nextStep}`);
  surface.text = lines.join("\n");
  return Object.freeze(surface);
}

function surfaceIsSafe(surface) {
  try {
    const publicContent = Object.fromEntries(Object.entries(surface).filter(([key]) => !["schema", "version"].includes(key)));
    return scanPublicPayload({text: collectStrings(publicContent).join("\n"), allowRelativePaths: false}).safe;
  } catch {
    return false;
  }
}

export function validateOwnerSurface(surface) {
  if (!isRecord(surface) || !surfaceIsSafe(surface)) throw new TypeError("owner surface privacy boundary failed");
  if (surface.schema !== "agentos.owner_surface.v1" || surface.version !== 1) throw new TypeError("owner surface identity is invalid");
  if (!OWNER_SURFACE_STATUSES.includes(surface.status) || surface.label !== STATUS_DEFINITIONS[surface.status].label) throw new TypeError("owner surface status is invalid");
  return surface;
}

function protectedContentSurface() {
  return buildSurface({
    status: "hard-stop",
    message: "The public surface is withheld because protected or unsafe content was supplied.",
    nextStep: "Remove protected content and run a fresh privacy check.",
  });
}

function invalidSurface() {
  return buildSurface({
    status: "hard-stop",
    message: "The current outcome cannot be verified, so work is stopped.",
    nextStep: "Run a fresh exact state check before continuing.",
  });
}

export const OWNER_SURFACE_STATUSES = Object.freeze(Object.keys(STATUS_DEFINITIONS));

export function renderOwnerSurface(input) {
  if (!isRecord(input)) return invalidSurface();
  if (containsProtectedContent(input) || !surfaceIsSafe(input)) return protectedContentSurface();

  const {status: requestedStatus, message, question, options: requestedOptions, nextStep} = input;
  const {kind: status, recognized} = classifyStatus(requestedStatus);
  if (!recognized) return invalidSurface();
  if (status === "conflict") return buildSurface({status, nextStep});

  const normalizedOptions = normalizeOptions(requestedOptions);
  const normalizedQuestion = question === null || question === undefined
    ? null
    : cleanText(question, "", MAX_QUESTION_LENGTH);

  if (status === "one-question") {
    const questionCount = normalizedQuestion === null ? 0 : (normalizedQuestion.match(/[?？]/gu) ?? []).length;
    if (!normalizedOptions.valid || normalizedQuestion === null || normalizedQuestion.length === 0 || questionCount > 1) {
      return buildSurface({
        status: "unavailable",
        message: "One owner question is not available yet; no decision is being assumed.",
        nextStep: "Provide one concise owner question and run the surface check again.",
      });
    }
    return buildSurface({status, message, question: normalizedQuestion, options: normalizedOptions.options, nextStep});
  }

  return buildSurface({status, message, nextStep});
}
