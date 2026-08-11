#!/usr/bin/env node

/*
 * Project-agnostic public-context boundary.
 *
 * The detector knows only generic private-context shapes. Project or provider
 * identity terms may be supplied transiently by a typed runtime context, but
 * they are never stored, returned, or compiled into public records.
 */

import crypto from "node:crypto";

export const PRIVATE_CONTEXT_DETECTOR_SCHEMA = "agentos.private_context_detector.v1";
export const PRIVATE_CONTEXT_DETECTOR_VERSION = 1;
export const PRIVATE_CONTEXT_CATEGORIES = Object.freeze([
  "PRIVATE_PATH",
  "ENVIRONMENT_REFERENCE",
  "SECRET_VALUE",
  "PRIVATE_LINK",
  "RAW_HOST_OR_SESSION_ID",
  "RUNTIME_PROJECT_IDENTITY",
]);

const PRIVATE_LINK_PATTERN = new RegExp(`(?:file|${["chat", "gpt", "-conversation"].join("")}):\\/\\/|https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|[^\\s/]+\\.(?:local|internal|private|corp))(?:[/:?\\s]|$)`, "iu");

const GENERIC_RULES = Object.freeze([
  Object.freeze({
    category: "PRIVATE_PATH",
    pattern: /(?:^|[\s"'(=:])(?:\/(?:Users|home|private|var)\/|[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/](?:Users|home|private|var)[\\/])/iu,
  }),
  Object.freeze({
    category: "PRIVATE_PATH",
    pattern: /(?:^|[\s"'(=:])\/(?:[^\/\s]+\/){2,}[^\s"'<>]*/u,
  }),
  Object.freeze({
    category: "PRIVATE_PATH",
    pattern: /(?:^|[\s"'(=:])[A-Za-z]:[\\/](?:[^\\\s"'<>]+[\\/]){1,}[^\\\s"'<>]*/u,
  }),
  Object.freeze({
    category: "PRIVATE_PATH",
    pattern: /(?:^|[\s"'(=:])\\\\[^\\/\s]+[\\/](?:[^\\/\s]+[\\/]?){2,}/u,
  }),
  Object.freeze({
    category: "ENVIRONMENT_REFERENCE",
    pattern: /\$[A-Z][A-Z0-9_]*\b/u,
  }),
  Object.freeze({
    category: "SECRET_VALUE",
    pattern: /\b(?:password|passwd|secret|credential|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private[_ -]?key)\s*[:=]\s*(?!\[?redacted\]?\b)[^\s,;)}\]]+/iu,
  }),
  Object.freeze({
    category: "PRIVATE_LINK",
    pattern: PRIVATE_LINK_PATTERN,
  }),
  Object.freeze({
    category: "RAW_HOST_OR_SESSION_ID",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  }),
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateIdentityTerms(identityTerms) {
  if (identityTerms === undefined) return [];
  if (!Array.isArray(identityTerms)) throw new TypeError("identityTerms must be an array");
  const terms = identityTerms.map((term, index) => {
    if (typeof term !== "string" || term.trim().length < 2 || term.length > 256 || /[\u0000-\u001f\u007f]/u.test(term)) {
      throw new TypeError(`identityTerms[${index}] is invalid`);
    }
    return term.trim();
  });
  return [...new Set(terms)].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function textOf(value) {
  if (typeof value === "string") return value;
  return canonicalJson(value) ?? String(value);
}

export function findPrivateContextLeaks(value, {identityTerms = []} = {}) {
  const text = textOf(value);
  const rules = [...GENERIC_RULES];
  const terms = validateIdentityTerms(identityTerms);
  if (terms.length > 0) {
    rules.push({
      category: "RUNTIME_PROJECT_IDENTITY",
      pattern: new RegExp(`(?:^|[^A-Za-z0-9])(?:${terms.map(escapeRegExp).join("|")})(?:$|[^A-Za-z0-9])`, "iu"),
    });
  }
  const leaks = [];
  for (const rule of rules) {
    const match = text.match(rule.pattern);
    if (match !== null) {
      leaks.push({category: rule.category, match_sha256: digest(match[0])});
    }
  }
  const seen = new Set();
  return leaks.filter((leak) => {
    const key = `${leak.category}:${leak.match_sha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function assertPublicContext(value, {identityTerms = []} = {}, label = "public context") {
  const leaks = findPrivateContextLeaks(value, {identityTerms});
  if (leaks.length > 0) {
    throw new Error(`${label} contains private context (${leaks.map((leak) => leak.category).join(",")})`);
  }
  return value;
}

export function publicContextDetectorContract() {
  return {
    schema: PRIVATE_CONTEXT_DETECTOR_SCHEMA,
    version: PRIVATE_CONTEXT_DETECTOR_VERSION,
    categories: [...PRIVATE_CONTEXT_CATEGORIES],
    generic_rules_only: true,
    runtime_identity_terms: "TRANSIENT_INPUT_ONLY",
    returned_match_detail: "CATEGORY_AND_DIGEST_ONLY",
    persisted_private_values: "FORBIDDEN",
  };
}
