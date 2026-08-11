#!/usr/bin/env node

/* Shared deterministic and privacy-safe primitives for the release slice. */

import crypto from "node:crypto";

export const PRIVACY_CATEGORIES = Object.freeze([
  "ABSOLUTE_PATH",
  "WORKTREE_PATH",
  "ENVIRONMENT_VALUE",
  "SECRET_LIKE_VALUE",
  "SESSION_OR_TASK_IDENTITY",
  "UNSAFE_PRIVATE_LINK",
]);

export const SHA256 = /^[0-9a-f]{64}$/u;
export const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
export const CHANGE_ID = /^[A-Z][A-Z0-9_.:-]*$/u;

const PRIVATE_FILE_NAME = /(?:^|\/)(?:\.env(?:\.[^/]*)?|.*(?:credential|secret|password|token|private[_-]?key|id_rsa).*|.*\.(?:pem|key|p12|pfx))$/iu;
const PRIVACY_PATTERNS = Object.freeze({
  ABSOLUTE_PATH: /(?:^|[\s"'(])(?:\/(?:Users|home|private|var|opt|etc|tmp|workspace|workspaces|projects)\/|[A-Za-z]:[\\/])/gmu,
  WORKTREE_PATH: /(?:^|[\s"'(])(?:worktree|worktrees|workspace|workspaces)[\\/][^\s"')]+/gimu,
  ENVIRONMENT_VALUE: /\b(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY)\s*[=:]\s*[^,\s}"']+/gimu,
  SECRET_LIKE_VALUE: /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{12,})\b/gmu,
  SESSION_OR_TASK_IDENTITY: /\b(?:session|task|thread|chat)[_-](?:id)?\s*[=:]\s*[A-Za-z0-9._:-]{3,}/gimu,
  UNSAFE_PRIVATE_LINK: /\b(?:file|ssh|app):\/\/[^\s"']+|\b(?:slack|discord|notion)\.com\/[A-Za-z0-9._/?=&%-]+/gimu,
});

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function clone(value) {
  return structuredClone(value);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    assert(Number.isFinite(value), "canonical records cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  assert(isRecord(value), "canonical records must contain JSON values");
  return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function bytesDigest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function digestWithout(value, field) {
  return canonicalDigest({...clone(value), [field]: null});
}

export function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
  return value;
}

export function requireText(value, label, {max = 4000} = {}) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty text`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(value.length <= max, `${label} is too long`);
  return value;
}

export function requireIdentifier(value, label) {
  requireText(value, label, {max: 160});
  assert(!value.includes("/") && !value.includes("\\"), `${label} contains a path separator`);
  assert(IDENTIFIER.test(value), `${label} is not a safe identifier`);
  return value;
}

export function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return value;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256${nullable ? " or null" : ""}`);
  return value;
}

export function requireUtc(value, label) {
  requireText(value, label, {max: 30});
  assert(UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be a valid UTC timestamp`);
  return value;
}

export function sortedUnique(values, label, {allowEmpty = false, pattern = null} = {}) {
  assert(Array.isArray(values) && (allowEmpty || values.length > 0), `${label} must be ${allowEmpty ? "an array" : "a nonempty array"}`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  if (pattern) assert(values.every((value) => pattern.test(value)), `${label} contains an invalid identifier`);
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted and unique`);
  return values;
}

export function safeRelativePath(value, label = "relative path") {
  requireText(value, label, {max: 1000});
  assert(!value.startsWith("/") && !value.includes("\\") && !value.includes("\0"), `${label} must be portable and relative`);
  const parts = value.split("/");
  assert(parts.every((part) => part.length > 0 && part !== "." && part !== ".."), `${label} contains an unsafe segment`);
  assert(!PRIVATE_FILE_NAME.test(value), `${label} names a private or secret-like file`);
  return value;
}

export function scanReleasePrivacy(value) {
  const text = typeof value === "string" ? value : canonicalJson(value);
  const categories = Object.fromEntries(PRIVACY_CATEGORIES.map((category) => [category, 0]));
  for (const category of PRIVACY_CATEGORIES) {
    const pattern = PRIVACY_PATTERNS[category];
    pattern.lastIndex = 0;
    categories[category] = [...text.matchAll(pattern)].length;
  }
  return {safe: PRIVACY_CATEGORIES.every((category) => categories[category] === 0), categories};
}

export function assertPortableRecord(value, label = "release record") {
  const scan = scanReleasePrivacy(value);
  assert(scan.safe, `${label} contains private or secret-like content`);
  return value;
}

export function privacySummary(value) {
  const scan = scanReleasePrivacy(value);
  assert(scan.safe, "release record contains private or secret-like content");
  return {safe: true, categories: Object.fromEntries(PRIVACY_CATEGORIES.map((category) => [category, 0]))};
}

export function validateSourceIdentity(value, label = "source identity") {
  exactKeys(value, ["commit_sha256", "tree_sha256"], label);
  requireSha(value.commit_sha256, `${label}.commit_sha256`);
  requireSha(value.tree_sha256, `${label}.tree_sha256`);
  return value;
}

export function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
  return value;
}
