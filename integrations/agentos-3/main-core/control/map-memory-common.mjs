#!/usr/bin/env node

/* Shared, map-lane-only validation helpers. Canonical hashing stays in the
 * repository-wide content-addressing primitive. */

import {assertPersistedRecordSafe, canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const CONTRACT_STATUS = "PREPARED_NOT_ACTIVATED";
export const CONTROL_SPACE = "CONTROL_SPACE";
export const SHA256 = /^[0-9a-f]{64}$/u;
export const GIT_OBJECT = /^[0-9a-f]{40}$/u;
export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;

export function assert(condition, message) {
  if (!condition) throw new Error(message);
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

export function requireString(value, label, {maxLength = 512} = {}) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(value.length <= maxLength, `${label} exceeds the portable length bound`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assertPersistedRecordSafe(value);
}

export function requireSafeText(value, label, options = {}) {
  requireString(value, label, options);
  return value;
}

export function requireIdentifier(value, label) {
  requireString(value, label, {maxLength: 128});
  assert(IDENTIFIER.test(value), `${label} must be a portable identifier`);
  assert(!UUID.test(value), `${label} must not be a session or task identity`);
  return value;
}

export function requireNullableIdentifier(value, label) {
  assert(value === null || typeof value === "string", `${label} must be null or a portable identifier`);
  if (value !== null) requireIdentifier(value, label);
  return value;
}

export function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

export function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
  return value;
}

export function requireSafeInteger(value, label, {min = 0, max = 100000} = {}) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, `${label} must be a safe integer in range`);
  return value;
}

export function requireSortedUniqueStrings(values, label, {allowEmpty = false, validator = requireIdentifier} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  values.forEach((value, index) => validator(value, `${label}[${index}]`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted`);
  return values;
}

export function requireSortedUniqueDigests(values, label, {allowEmpty = false} = {}) {
  return requireSortedUniqueStrings(values, label, {allowEmpty, validator: requireSha});
}

export function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

export function assertSafeRecord(value, label) {
  try {
    assertPersistedRecordSafe(value);
  } catch (error) {
    throw new Error(`${label} is not privacy-safe: ${error.message}`, {cause: error});
  }
  return value;
}

export function sortByUtf8(values, key) {
  return [...values].sort((left, right) => compareUtf8(key(left), key(right)));
}

export function sortNotices(values) {
  return sortByUtf8(values, (notice) => `${notice.code}\u0000${notice.subject_ref ?? ""}\u0000${notice.detail}`);
}

export function validateNotice(notice, index, label = "notice") {
  exactKeys(notice, ["code", "subject_ref", "detail"], `${label} ${index}`);
  requireIdentifier(notice.code, `${label} ${index} code`);
  requireNullableIdentifier(notice.subject_ref, `${label} ${index} subject`);
  requireSafeText(notice.detail, `${label} ${index} detail`, {maxLength: 512});
  return notice;
}

export function validateSortedNotices(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  values.forEach((notice, index) => validateNotice(notice, index, label));
  const sorted = sortNotices(values);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted`);
  const keys = values.map((notice) => `${notice.code}\u0000${notice.subject_ref ?? ""}\u0000${notice.detail}`);
  assert(new Set(keys).size === keys.length, `${label} contains duplicates`);
  return values;
}
