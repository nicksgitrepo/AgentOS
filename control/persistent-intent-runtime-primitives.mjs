/* Pure validation and digest helpers for the persistent Intent Regulator/Runtime. */

import {canonicalDigest, compareUtf8, assertPersistedRecordSafe} from "./content-addressing.mjs";

export const MIN_REVIEW_INTERVAL_MINUTES = 1;
export const MAX_REVIEW_INTERVAL_MINUTES = 24 * 60;
export const PROTECTED_ACTIONS = Object.freeze({
  acceptance: false,
  activation: false,
  deployment: false,
  merge: false,
  publication: false,
  push: false,
  rollback: false,
  secrets: false,
  spend: false,
});

const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_SHA1 = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const OPAQUE_REFERENCE = /^(?:RUNTIME_REF|LEASE_REF|TRANSACTION_REF)_[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export function assert(condition, message, code = "PERSISTENT_INTENT_RUNTIME_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

export function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

export function requireString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

export function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

export function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

export function requireSourceSha(value, label) {
  assert(typeof value === "string" && SOURCE_SHA1.test(value), `${label} must be a 40-character source digest`);
}

export function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

export function requireNullable(value, validator, label) {
  if (value !== null) validator(value, label);
}

export function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
}

export function requireNonnegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative integer`);
}

export function requireInterval(value, label = "review interval") {
  assert(Number.isSafeInteger(value) && value >= MIN_REVIEW_INTERVAL_MINUTES && value <= MAX_REVIEW_INTERVAL_MINUTES,
    `${label} must be between ${MIN_REVIEW_INTERVAL_MINUTES} and ${MAX_REVIEW_INTERVAL_MINUTES} minutes`);
}

export function requireOpaqueReference(value, label) {
  requireString(value, label);
  assert(OPAQUE_REFERENCE.test(value), `${label} must be an opaque runtime reference`);
}

export function clone(value) {
  return structuredClone(value);
}

export function digestWithout(value, field) {
  const body = clone(value);
  body[field] = null;
  return canonicalDigest(body);
}

export function stateContentDigest(value) {
  const body = clone(value);
  body.state_sha256 = null;
  // The event head is integrity-checked by the append-only event chain. It is
  // excluded here to avoid a state/event hash cycle.
  body.event_ledger_head_sha256 = null;
  return canonicalDigest(body);
}

export function requireSortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const ordered = [...values].sort(compareUtf8);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

export function validateProtectedActions(value, label = "protected actions") {
  exactKeys(value, Object.keys(PROTECTED_ACTIONS), label);
  for (const key of Object.keys(PROTECTED_ACTIONS)) assert(value[key] === false, `${label}.${key} must remain false`, "PROTECTED_ACTION_BLOCKED");
  return value;
}

export function privacyCheck(value, label) {
  try {
    assertPersistedRecordSafe(value);
  } catch (error) {
    const wrapped = new Error(`${label} failed privacy validation: ${error.message}`);
    wrapped.code = "PERSISTED_RECORD_PRIVACY_BOUNDARY";
    throw wrapped;
  }
  return value;
}

export {canonicalDigest, compareUtf8};
