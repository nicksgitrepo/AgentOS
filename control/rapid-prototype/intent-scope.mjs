#!/usr/bin/env node

import crypto from "node:crypto";

export const INTENT_ENVELOPE_SCHEMA = "agentos.intent_envelope.v1";
export const INTENT_CHANGE_CLASSIFICATIONS = Object.freeze([
  "PROCEED",
  "PUZZLE",
  "SOFT_REVIEW",
  "HARD_STOP",
  "DEFERRED_ITERATION",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*["']?\s*[:=]/iu;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const REQUIRED_INPUT_FIELDS = Object.freeze([
  "goal",
  "workflow",
  "inScope",
  "outOfScope",
  "acceptance",
  "protectedBoundaries",
  "assumptions",
]);
const ENVELOPE_FIELDS = Object.freeze([
  "schema",
  "version",
  "status",
  "goal",
  "workflow",
  "in_scope",
  "out_of_scope",
  "acceptance",
  "protected_boundaries",
  "assumptions",
  "intent_envelope_sha256",
]);
const SEMANTIC_FIELDS = Object.freeze([
  "goal",
  "workflow",
  "in_scope",
  "out_of_scope",
  "acceptance",
  "protected_boundaries",
  "assumptions",
]);
const CONTROLLED_CHANGE_FIELDS = Object.freeze([
  ["intent", "INTENT"],
  ["scope", "SCOPE"],
  ["policy", "POLICY"],
  ["condition", "CONDITION"],
  ["conditions", "CONDITION"],
  ["source_condition", "CONDITION"],
  ["operating_condition", "CONDITION"],
]);
const SOFT_REVIEW_FIELDS = Object.freeze([
  "architecture",
  "implementation_choice",
  "implementationChoice",
  "operating_preference",
  "operatingPreference",
  "preference",
  "route",
  "presentation",
  "format",
  "tooling",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  assert(prototype === Object.prototype || prototype === null, `${label} must be a plain object`);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value, seen = new Set(), label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${label} contains a non-finite number`);
    return value;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error(`${label} contains a non-JSON value`);
  }
  if (Array.isArray(value)) {
    assert(!seen.has(value), `${label} contains a cycle`);
    seen.add(value);
    const result = value.map((item, index) => canonicalize(item, seen, `${label}[${index}]`));
    seen.delete(value);
    return result;
  }
  requireRecord(value, label);
  assert(!seen.has(value), `${label} contains a cycle`);
  seen.add(value);
  const result = Object.fromEntries(Object.keys(value)
    .sort(compareUtf8)
    .map((key) => {
      assert(!FORBIDDEN_KEYS.has(key), `${label} contains an unsafe field name`);
      return [key, canonicalize(value[key], seen, `${label}.${key}`)];
    }));
  seen.delete(value);
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function safeText(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(!SECRET_PATTERN.test(value) && !CREDENTIAL_URL_PATTERN.test(value), `${label} contains secret material`);
  return value.trim();
}

function secretFree(value, label) {
  const text = canonicalJson(value);
  assert(!SECRET_PATTERN.test(text) && !CREDENTIAL_URL_PATTERN.test(text), `${label} contains secret material`);
}

function normalizeStringList(value, label, {allowEmpty = true, ordered = false} = {}) {
  const items = typeof value === "string" ? [value] : value;
  assert(Array.isArray(items), `${label} must be an array of strings`);
  if (!allowEmpty) assert(items.length > 0, `${label} must not be empty`);
  const normalized = items.map((item, index) => safeText(item, `${label}[${index}]`));
  if (ordered) {
    const result = [];
    const seen = new Set();
    for (const item of normalized) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
    return result;
  }
  return [...new Set(normalized)].sort(compareUtf8);
}

function normalizeMaterial(value, label, {allowEmpty = true} = {}) {
  if (typeof value === "string") return [safeText(value, label)];
  if (Array.isArray(value)) {
    if (!allowEmpty) assert(value.length > 0, `${label} must not be empty`);
    if (value.every((item) => typeof item === "string")) return normalizeStringList(value, label, {allowEmpty});
    const result = canonicalize(value, new Set(), label);
    secretFree(result, label);
    return result;
  }
  requireRecord(value, label);
  const result = canonicalize(value, new Set(), label);
  secretFree(result, label);
  return result;
}

function hasOwn(value, key) {
  return isRecord(value) && Object.hasOwn(value, key);
}

function valueFor(source, snakeKey, camelKey) {
  if (hasOwn(source, snakeKey)) return source[snakeKey];
  if (hasOwn(source, camelKey)) return source[camelKey];
  return undefined;
}

function inputForEnvelope(source) {
  return {
    goal: valueFor(source, "goal", "goal"),
    workflow: valueFor(source, "workflow", "workflow"),
    inScope: valueFor(source, "in_scope", "inScope"),
    outOfScope: valueFor(source, "out_of_scope", "outOfScope"),
    acceptance: valueFor(source, "acceptance", "acceptance"),
    protectedBoundaries: valueFor(source, "protected_boundaries", "protectedBoundaries"),
    assumptions: valueFor(source, "assumptions", "assumptions"),
  };
}

function assertRequiredInput(input) {
  requireRecord(input, "intent envelope input");
  for (const field of REQUIRED_INPUT_FIELDS) assert(Object.hasOwn(input, field), `intent envelope ${field} is required`);
}

function intentEnvelopeBody(envelope) {
  const body = structuredClone(envelope);
  body.intent_envelope_sha256 = null;
  return body;
}

export function intentEnvelopeDigest(envelope) {
  return canonicalDigest(intentEnvelopeBody(envelope));
}

function attachCompatibilityAliases(envelope) {
  Object.defineProperties(envelope, {
    inScope: {enumerable: false, get: () => envelope.in_scope},
    outOfScope: {enumerable: false, get: () => envelope.out_of_scope},
    protectedBoundaries: {enumerable: false, get: () => envelope.protected_boundaries},
    intent_sha256: {enumerable: false, get: () => envelope.intent_envelope_sha256},
    envelope_sha256: {enumerable: false, get: () => envelope.intent_envelope_sha256},
    digest: {enumerable: false, get: () => envelope.intent_envelope_sha256},
  });
  return envelope;
}

export function compileIntentEnvelope(input = {}) {
  assertRequiredInput(input);
  const normalized = {
    schema: INTENT_ENVELOPE_SCHEMA,
    version: 1,
    status: "COMPILED",
    goal: safeText(input.goal, "intent envelope goal"),
    workflow: typeof input.workflow === "string"
      ? safeText(input.workflow, "intent envelope workflow")
      : normalizeStringList(input.workflow, "intent envelope workflow", {allowEmpty: false, ordered: true}),
    in_scope: normalizeStringList(input.inScope, "intent envelope inScope", {allowEmpty: false}),
    out_of_scope: normalizeStringList(input.outOfScope, "intent envelope outOfScope"),
    acceptance: normalizeMaterial(input.acceptance, "intent envelope acceptance", {allowEmpty: false}),
    protected_boundaries: normalizeMaterial(input.protectedBoundaries, "intent envelope protectedBoundaries", {allowEmpty: false}),
    assumptions: normalizeMaterial(input.assumptions, "intent envelope assumptions"),
    intent_envelope_sha256: null,
  };
  if (Array.isArray(normalized.in_scope) && Array.isArray(normalized.out_of_scope)) {
    const excluded = new Set(normalized.out_of_scope);
    assert(!normalized.in_scope.some((item) => excluded.has(item)), "intent envelope scope overlaps its exclusions");
  }
  secretFree(normalized, "intent envelope");
  normalized.intent_envelope_sha256 = intentEnvelopeDigest(normalized);
  return attachCompatibilityAliases(normalized);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

export function validateIntentEnvelope(envelope) {
  exactKeys(envelope, ENVELOPE_FIELDS, "intent envelope");
  assert(envelope.schema === INTENT_ENVELOPE_SCHEMA && envelope.version === 1 && envelope.status === "COMPILED", "intent envelope identity is invalid");
  const rebuilt = compileIntentEnvelope(inputForEnvelope(envelope));
  for (const field of SEMANTIC_FIELDS) assert(canonicalJson(envelope[field]) === canonicalJson(rebuilt[field]), `intent envelope ${field} is not normalized`);
  assert(typeof envelope.intent_envelope_sha256 === "string" && SHA256.test(envelope.intent_envelope_sha256), "intent envelope digest is invalid");
  assert(envelope.intent_envelope_sha256 === intentEnvelopeDigest(envelope), "intent envelope digest mismatch");
  return envelope;
}

function comparableEnvelope(source, label) {
  if (!isRecord(source)) return {valid: false, source};
  try {
    const normalized = compileIntentEnvelope(inputForEnvelope(source));
    const providedDigest = valueFor(source, "intent_envelope_sha256", "intentEnvelopeSha256");
    const digestValid = providedDigest === undefined
      || (typeof providedDigest === "string" && SHA256.test(providedDigest) && providedDigest === normalized.intent_envelope_sha256);
    return {valid: digestValid, source, envelope: normalized};
  } catch {
    return {valid: false, source};
  }
}

function canonicalEqual(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function optionalFieldChanged(baseline, candidate, field) {
  const baselineHas = hasOwn(baseline, field);
  const candidateHas = hasOwn(candidate, field);
  if (baselineHas !== candidateHas) return true;
  return baselineHas && !canonicalEqual(baseline[field], candidate[field]);
}

function normalizeToken(value) {
  if (typeof value !== "string") return null;
  return value.trim().toUpperCase().replaceAll(/[\s-]+/gu, "_");
}

function changeSources(source) {
  const nested = [];
  for (const field of ["change", "event", "issue", "problem", "finding", "review"]) {
    if (isRecord(source?.[field])) nested.push(source[field]);
  }
  return [source, ...nested];
}

function explicitClassification(source) {
  const tokens = [];
  for (const record of changeSources(source)) {
    for (const field of ["classification", "change_classification", "change_type", "change_kind", "kind", "type", "event_type"]) {
      const token = normalizeToken(record[field]);
      if (token !== null) tokens.push(token);
    }
  }
  if (tokens.some((token) => ["HARD_STOP", "SCOPE_CHANGE", "INTENT_CHANGE", "POLICY_CHANGE", "CONDITION_CHANGE", "SOURCE_CHANGE", "BOUNDARY_CROSSING", "CONFLICT", "OWNER_REQUIRED", "UNAVAILABLE"].includes(token))) return "HARD_STOP";
  if (tokens.some((token) => ["SOFT_REVIEW", "SOFT_BOUNDARY", "OPERATING_PREFERENCE_CHANGE", "ARCHITECTURE_CHANGE", "ROUTE_CHANGE", "PREFERENCE_CHANGE"].includes(token))) return "SOFT_REVIEW";
  if (tokens.some((token) => ["DEFERRED_ITERATION", "ITERATION_DEFERRED", "DEFERRED", "DEFER", "WAIT_FOR_NEXT_ITERATION"].includes(token))) return "DEFERRED_ITERATION";
  if (tokens.some((token) => ["PUZZLE", "REPAIRABLE_PUZZLE", "IMPLEMENTATION_PUZZLE", "BOUNDED_REPAIR"].includes(token))) return "PUZZLE";
  if (tokens.some((token) => ["PROCEED", "UNCHANGED", "NO_CHANGE"].includes(token))) return "PROCEED";
  return null;
}

function booleanMarker(source, fields) {
  return changeSources(source).some((record) => fields.some((field) => record[field] === true));
}

function hasPuzzleMarker(source) {
  return booleanMarker(source, ["puzzle", "repairable_puzzle", "engineering_puzzle", "reversible_problem"])
    || changeSources(source).some((record) => isRecord(record.puzzle) || isRecord(record.repair) || isRecord(record.reversible_problem));
}

function hasSoftReviewMarker(source) {
  return booleanMarker(source, ["soft_review", "softReview", "review_required", "operating_preference_change"])
    || changeSources(source).some((record) => isRecord(record.soft_review) || isRecord(record.softReview));
}

function hasDeferredIterationMarker(source) {
  return booleanMarker(source, ["deferred_iteration", "deferredIteration", "iteration_deferred", "iterationDeferred", "defer", "deferred"])
    || changeSources(source).some((record) => isRecord(record.deferred_iteration)
      || isRecord(record.deferredIteration)
      || isRecord(record.iteration_deferred)
      || isRecord(record.iterationDeferred));
}

function hasHardStopMarker(source) {
  return booleanMarker(source, ["hard_stop", "hardStop", "scope_changed", "intent_changed", "policy_changed", "condition_changed", "source_changed", "boundary_crossed", "conflict", "owner_decision_required", "unavailable"]);
}

function semanticChanges(baseline, candidate) {
  return SEMANTIC_FIELDS.filter((field) => !canonicalEqual(baseline[field], candidate[field]));
}

function controlledChanges(baseline, candidate) {
  return CONTROLLED_CHANGE_FIELDS
    .filter(([field]) => optionalFieldChanged(baseline, candidate, field))
    .map(([, category]) => category);
}

function softReviewChanges(baseline, candidate) {
  return SOFT_REVIEW_FIELDS.filter((field) => optionalFieldChanged(baseline, candidate, field));
}

export function classifyIntentChange(input, positionalCandidate = undefined) {
  const baseline = arguments.length > 1 ? input : input?.baseline;
  const candidate = arguments.length > 1 ? positionalCandidate : input?.candidate;
  const baselineRecord = comparableEnvelope(baseline, "baseline");
  const candidateRecord = comparableEnvelope(candidate, "candidate");
  if (!baselineRecord.valid || !candidateRecord.valid) return "HARD_STOP";

  const semanticDelta = semanticChanges(baselineRecord.envelope, candidateRecord.envelope);
  const controlledDelta = controlledChanges(baselineRecord.source, candidateRecord.source);
  if (semanticDelta.length > 0 || controlledDelta.length > 0 || hasHardStopMarker(candidateRecord.source)) return "HARD_STOP";

  const explicit = explicitClassification(candidateRecord.source);
  if (explicit === "HARD_STOP") return "HARD_STOP";
  if (explicit === "SOFT_REVIEW" || hasSoftReviewMarker(candidateRecord.source) || softReviewChanges(baselineRecord.source, candidateRecord.source).length > 0) return "SOFT_REVIEW";
  if (explicit === "DEFERRED_ITERATION" || hasDeferredIterationMarker(candidateRecord.source)) return "DEFERRED_ITERATION";
  if (explicit === "PUZZLE" || hasPuzzleMarker(candidateRecord.source)) return "PUZZLE";
  return "PROCEED";
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("rapid prototype intent and scope controller loaded\n");
