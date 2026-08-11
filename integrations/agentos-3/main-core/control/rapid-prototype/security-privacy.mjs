#!/usr/bin/env node

import crypto from "node:crypto";
import {isIP} from "node:net";

export const PUBLIC_PAYLOAD_SCAN_SCHEMA = "agentos.public_payload_scan.v1";
export const PUBLIC_PAYLOAD_VIOLATION_CODES = Object.freeze([
  "CREDENTIAL",
  "ABSOLUTE_LOCAL_PATH",
  "PROVIDER_OR_ACCOUNT_IDENTIFIER",
  "SESSION_RECORD",
  "EXTERNAL_PROJECT_NAME",
  "CHAT_LINK",
  "UNSAFE_EXTERNAL_URL",
  "UNSAFE_RELATIVE_PATH",
  "RELATIVE_PATH_NOT_ALLOWED",
]);

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
const URL_TOKEN = /(?:https?|ftp|file|ssh|chat):\/\/[^\s<>"'`]+|(?:javascript|data|file|ftp|ssh|vbscript|mailto|tel|callto|chat):[^\s<>"'`]+|\/\/[A-Za-z0-9.-]+(?::\d+)?[^\s<>"'`]*/giu;
const CREDENTIAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/iu;
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u;
const UPPERCASE_KEY_SHAPE = /\b[A-Z]{2,}[A-Z0-9]{18,}\b/u;
const PREFIXED_SECRET_SHAPE = /\b[A-Za-z]{2,16}[_-][A-Za-z0-9_-]{16,}\b/u;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u;
const BEARER = /\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+(?!<*redacted|\[redacted\]|redacted\b)[A-Za-z0-9._~+/=-]{8,}/iu;
const CREDENTIAL_ASSIGNMENT = /\b(?:password|passwd|passcode|api(?:[_ -]?key)|access(?:[_ -]?token)|refresh(?:[_ -]?token)|auth(?:[_ -]?token)|client(?:[_ -]?secret)|secret|cookie|connection(?:[_ -]?string)|private(?:[_ -]?key)|credential|token)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|(\[[^\s,;)}\]]*\]|[^\s,;)}\]]+))/giu;

const ABSOLUTE_POSIX_PATH = /(?:^|[\s"'`=:(\[{])\/(?!\/)(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:[^\s"'`<>)\]}]*)?/u;
const ABSOLUTE_WINDOWS_PATH = /(?:^|[\s"'`=:(\[{])[A-Za-z]:[\\/][^\s"'`<>)\]}]+/u;
const ABSOLUTE_UNC_PATH = /(?:^|[\s"'`=:(\[{])\\\\[A-Za-z0-9._-]+[\\/][^\s"'`<>)\]}]+/u;
const HOME_RELATIVE_PATH = /(?:^|[\s"'`=:(\[{])~[\\/][^\s"'`<>)\]}]+/u;
const RELATIVE_TRAVERSAL = /(?:^|[^\p{L}\p{N}_])\.\.(?:[\\/]|$)/u;
const RELATIVE_PATH = /(?<![A-Za-z0-9+./:-])(?:\.\/)?(?:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+)(?![A-Za-z0-9._-])/u;

const IDENTIFIER_ASSIGNMENT = /\b(?:provider|vendor|account|account(?:[_ -]?id|[_ -]?number)|subscription(?:[_ -]?id)?|tenant(?:[_ -]?id)?|organization(?:[_ -]?id)?|org(?:[_ -]?id)?|workspace(?:[_ -]?id)?|resource(?:[_ -]?id)?|deployment(?:[_ -]?id)?|project[_ -]?id)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,;)}\]]+))/giu;
const IDENTIFIER_SHAPE = /\b(?:arn|acct|account|subscription|tenant|organization|org|workspace|resource|deployment)[_:/-][A-Za-z0-9][A-Za-z0-9._:/-]{4,}\b/iu;
const NUMERIC_IDENTIFIER = /\b(?:account|subscription|tenant|organization|org|workspace|project|deployment|resource)(?:[_ -]?(?:id|number))?\s*[:=]\s*["']?\d{6,}/iu;
const RESOURCE_SHAPE = /\b[A-Za-z]{1,8}-[0-9a-f]{8,}\b/iu;
const RESOURCE_PATH = /\b(?:accounts?|subscriptions?|tenants?|projects?|workspaces?)\/(?:\d{6,}|(?:acct|account|subscription|tenant|org|workspace|resource|deployment)[_-][A-Za-z0-9._-]{4,})\b/iu;

const SESSION_ASSIGNMENT = /\b(?:session|thread|conversation|chat|run)(?:[_ -]?(?:id|identity|record|metadata|key|link))\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,;)}\]]+))/giu;
const PROJECT_ASSIGNMENT = /\b(?:project|repository|repo|workspace|application)(?:[_ -]?(?:name|slug|label))\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,;)}\]]+))/giu;

const SENSITIVE_QUERY_KEY = /^(?:access[_-]?token|api[_-]?key|auth(?:orization)?|code|credential|key|password|secret|session|signature|sig|token)$/iu;
const PRIVATE_HOST_SUFFIX = /\.(?:local|internal|private|corp)$/iu;
const CHAT_HOST = /(?:^|[.-])chat(?:[.-]|$)/iu;
const CHAT_PATH = /\/(?:chat|thread|conversation|messages?|channels?|inbox|dm|direct|archives|client)(?:\/|$)/iu;

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlaceholder(value) {
  const normalized = value.trim().replace(/^["']|["']$/gu, "");
  return /^(?:<\s*(?:redacted|omitted|withheld|placeholder|synthetic)\s*>|\[(?:redacted|omitted|withheld|placeholder|synthetic)\]|(?:redacted|removed|omitted|withheld|placeholder|synthetic|example|generic|portable|public|local|none|unknown|unavailable|null|undefined|test)|[*-]{3,})$/iu.test(normalized);
}

function normalizeOptions(input, positionalForbiddenTerms, positionalAllowRelativePaths) {
  const options = isRecord(input) && Object.hasOwn(input, "text")
    ? input
    : {text: input, forbiddenTerms: positionalForbiddenTerms, allowRelativePaths: positionalAllowRelativePaths};
  const {
    text,
    forbiddenTerms = [],
    allowRelativePaths = true,
  } = options;
  assert(typeof text === "string", "public payload text must be a string");
  assert(!CONTROL_CHARACTERS.test(text), "public payload text contains control characters");
  assert(Array.isArray(forbiddenTerms), "public payload forbiddenTerms must be an array");
  assert(typeof allowRelativePaths === "boolean", "public payload allowRelativePaths must be a boolean");
  const normalizedTerms = [...new Set(forbiddenTerms.map((term) => {
    assert(typeof term === "string" && term.trim().length > 0, "public payload forbiddenTerms contains an invalid value");
    assert(!CONTROL_CHARACTERS.test(term), "public payload forbiddenTerms contains control characters");
    return term.trim();
  }))];
  return {text, forbiddenTerms: normalizedTerms, allowRelativePaths};
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function hasForbiddenTerm(text, terms) {
  const lowerText = text.toLowerCase();
  return terms.some((term) => {
    const lowerTerm = term.toLowerCase();
    if (!lowerText.includes(lowerTerm)) return false;
    const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
  });
}

function hasCredential(text) {
  if (PRIVATE_KEY.test(text) || UPPERCASE_KEY_SHAPE.test(text) || PREFIXED_SECRET_SHAPE.test(text) || JWT.test(text) || CREDENTIAL_URL.test(text) || BEARER.test(text)) return true;
  for (const match of text.matchAll(CREDENTIAL_ASSIGNMENT)) {
    const value = match.slice(1).find((candidate) => candidate !== undefined) ?? "";
    if (!isPlaceholder(value)) return true;
  }
  return false;
}

function hasAbsoluteLocalPath(text) {
  return ABSOLUTE_POSIX_PATH.test(text)
    || ABSOLUTE_WINDOWS_PATH.test(text)
    || ABSOLUTE_UNC_PATH.test(text)
    || HOME_RELATIVE_PATH.test(text);
}

function hasProviderOrAccountIdentifier(text) {
  if (IDENTIFIER_SHAPE.test(text) || NUMERIC_IDENTIFIER.test(text) || RESOURCE_SHAPE.test(text) || RESOURCE_PATH.test(text)) return true;
  for (const match of text.matchAll(IDENTIFIER_ASSIGNMENT)) {
    const value = match.slice(1).find((candidate) => candidate !== undefined) ?? "";
    if (!isPlaceholder(value)) return true;
  }
  return false;
}

function hasSessionRecord(text) {
  if (UUID.test(text)) return true;
  for (const match of text.matchAll(SESSION_ASSIGNMENT)) {
    const value = match.slice(1).find((candidate) => candidate !== undefined) ?? "";
    if (!isPlaceholder(value)) return true;
  }
  return false;
}

function hasExternalProjectName(text) {
  for (const match of text.matchAll(PROJECT_ASSIGNMENT)) {
    const value = match.slice(1).find((candidate) => candidate !== undefined) ?? "";
    if (!isPlaceholder(value)) return true;
  }
  return false;
}

function urlTokens(text) {
  return [...text.matchAll(URL_TOKEN)].map(([value]) => value.replace(/[.,;!?]+$/u, ""));
}

function parseUrl(value) {
  try {
    return new URL(value, value.startsWith("//") ? "https://placeholder.invalid" : undefined);
  } catch {
    return null;
  }
}

function isChatLink(url) {
  if (!url) return false;
  return url.protocol === "chat:" || CHAT_HOST.test(url.hostname) || CHAT_PATH.test(url.pathname);
}

function isPrivateOrUnsafeHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (host === "localhost" || host === "local" || PRIVATE_HOST_SUFFIX.test(host)) return true;
  if (isIP(host) !== 0) return true;
  if (!host.includes(".")) return true;
  return false;
}

function isUnsafeExternalUrl(url) {
  if (!url || url.protocol !== "https:") return true;
  if (url.username || url.password || isPrivateOrUnsafeHost(url.hostname)) return true;
  if (url.port && url.port !== "443") return true;
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) return true;
  }
  return false;
}

function hasRelativePathProblem(text, allowRelativePaths) {
  if (RELATIVE_TRAVERSAL.test(text)) return "UNSAFE_RELATIVE_PATH";
  if (!allowRelativePaths && RELATIVE_PATH.test(text)) return "RELATIVE_PATH_NOT_ALLOWED";
  return null;
}

function scanUrls(text, findings) {
  for (const token of urlTokens(text)) {
    const url = parseUrl(token);
    if (isChatLink(url)) findings.add("CHAT_LINK");
    if (isUnsafeExternalUrl(url)) findings.add("UNSAFE_EXTERNAL_URL");
  }
}

export function scanPublicPayload(textOrOptions, forbiddenTerms = [], allowRelativePaths = true) {
  const options = normalizeOptions(textOrOptions, forbiddenTerms, allowRelativePaths);
  const findings = new Set();
  if (hasCredential(options.text)) findings.add("CREDENTIAL");
  if (hasAbsoluteLocalPath(options.text)) findings.add("ABSOLUTE_LOCAL_PATH");
  if (hasProviderOrAccountIdentifier(options.text)) findings.add("PROVIDER_OR_ACCOUNT_IDENTIFIER");
  if (hasSessionRecord(options.text)) findings.add("SESSION_RECORD");
  if (hasExternalProjectName(options.text) || hasForbiddenTerm(options.text, options.forbiddenTerms)) findings.add("EXTERNAL_PROJECT_NAME");
  const relativePathProblem = hasRelativePathProblem(options.text, options.allowRelativePaths);
  if (relativePathProblem !== null) findings.add(relativePathProblem);
  scanUrls(options.text, findings);

  const violations = PUBLIC_PAYLOAD_VIOLATION_CODES.filter((code) => findings.has(code));
  return Object.freeze({
    schema: PUBLIC_PAYLOAD_SCAN_SCHEMA,
    version: 1,
    status: violations.length === 0 ? "SAFE" : "HARD_STOP",
    safe: violations.length === 0,
    violations,
    payload_sha256: sha256(options.text),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("public payload scanner loaded\n");
