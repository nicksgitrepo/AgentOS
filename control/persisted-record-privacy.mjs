#!/usr/bin/env node

/*
 * Portable serializer boundary for records that leave the host boundary.
 * Resolved paths, environment values, credentials, session identities, and
 * private links are represented only by opaque digests or safe labels.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PERSISTED_RECORD_PRIVACY_SCHEMA = "agentos.persisted_record_privacy.v1";
export const PERSISTED_RECORD_PRIVACY_VERSION = 1;
export const PRIVACY_CATEGORIES = Object.freeze([
  "ABSOLUTE_PATH",
  "WORKTREE_PATH",
  "ENVIRONMENT_VALUE",
  "SECRET_LIKE_VALUE",
  "SESSION_OR_TASK_IDENTITY",
  "UNSAFE_PRIVATE_LINK",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const ABSOLUTE_PATH = /(?:^|[\s"'`=:(\[{])(?:\/(?!\/)(?:[A-Za-z0-9._-]+[\\/]){1,}[A-Za-z0-9._-]+|[A-Za-z]:[\\/]|\\\\)[^\s"'`<>)}\]]*/u;
const HOST_WORKTREE_SEGMENT = [".", "code", "x"].join("");
const CHAT_LINK_SCHEME = ["chat", "gpt", "-conversation"].join("");
const WORKTREE_PATH = new RegExp(
  String.raw`(?:^|[\s"'\x60=:(\[{])(?:[^\s"'\x60<>)}\]]*[\/])?${HOST_WORKTREE_SEGMENT.replace(".", "\\.")}[\/]worktrees[\/][^\s"'\x60<>)}\]]+`,
  "iu",
);
const ENV_SYNTAX = /(?:\$[A-Z][A-Z0-9_]*|\$\{[A-Z][A-Z0-9_]*\}|\b[A-Z][A-Z0-9_]{2,}=[^\s,;]+)/u;
const SECRET_LIKE = /(?:\b(?:sk-[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{12,})|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+(?!\[?redacted\]?\b)[A-Za-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|credential|private[_ -]?key|cookie)\s*[:=]\s*(?!\[?redacted\]?\b)[^\s,;)}\]]+)/iu;
const PRIVATE_LINK = new RegExp(`(?:${CHAT_LINK_SCHEME}:\\/\\/|chat:\\/\\/|file:\\/\\/|https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|[^\\s/]+\\.(?:local|internal|private|corp))(?:[/:?\\s]|$))`, "iu");
const PATH_KEYS = /(?:^|_)(?:path|cwd|worktree|project_root|control_root|control_plane_root|absolute_path|file_path|artifact_path|git_top_level|root)$/iu;
const ENV_KEYS = /(?:^|_)(?:env|environment|environment_value|environment_variables|variables|secret|credential|token|password|api_key|access_token|refresh_token)$/iu;
const ID_KEYS = /(?:^|_)(?:task|thread|session|source_thread|conversation|chat|run|project|campaign|environment|worker|auditor|orchestrator|runtime|host|worktree|client_thread)(?:_id|_identity|_record|_key)?$/iu;
const PRIVATE_LINK_FULL = new RegExp(
  String.raw`(?:${CHAT_LINK_SCHEME}:\/\/|chat:\/\/|file:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1|[^\s/]+\.(?:local|internal|private|corp)))(?:[^\s"'\x60<>)}\]]*)`,
  "iu",
);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function privacyDigest(value) {
  const input = typeof value === "string" ? value : JSON.stringify(canonicalize(value));
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function opaque(value, category) {
  return `opaque:${category.toLowerCase()}:${privacyDigest(String(value))}`;
}

function emptyCounts() {
  return Object.fromEntries(PRIVACY_CATEGORIES.map((category) => [category, 0]));
}

function globalPattern(pattern) {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

function redactText(text, counts) {
  let redacted = text;
  for (const [category, pattern] of [
    ["UNSAFE_PRIVATE_LINK", PRIVATE_LINK_FULL],
    ["WORKTREE_PATH", WORKTREE_PATH],
    ["ABSOLUTE_PATH", ABSOLUTE_PATH],
    ["SECRET_LIKE_VALUE", SECRET_LIKE],
    ["ENVIRONMENT_VALUE", ENV_SYNTAX],
    ["SESSION_OR_TASK_IDENTITY", UUID],
  ]) {
    redacted = redacted.replace(globalPattern(pattern), (match) => {
      counts[category] += 1;
      return opaque(match, category);
    });
  }
  return redacted;
}

export function scanPersistedRecord(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const counts = emptyCounts();
  // Count all categories independently; categoryForText is deliberately
  // first-match for serialization, while scanning reports every class.
  if (WORKTREE_PATH.test(text)) counts.WORKTREE_PATH += 1;
  if (ABSOLUTE_PATH.test(text)) counts.ABSOLUTE_PATH += 1;
  if (ENV_SYNTAX.test(text)) counts.ENVIRONMENT_VALUE += 1;
  if (SECRET_LIKE.test(text)) counts.SECRET_LIKE_VALUE += 1;
  if (UUID.test(text)) counts.SESSION_OR_TASK_IDENTITY += 1;
  if (PRIVATE_LINK.test(text)) counts.UNSAFE_PRIVATE_LINK += 1;
  return Object.freeze({
    schema: PERSISTED_RECORD_PRIVACY_SCHEMA,
    version: PERSISTED_RECORD_PRIVACY_VERSION,
    safe: Object.values(counts).every((count) => count === 0),
    categories: Object.freeze(counts),
    value_sha256: privacyDigest(text),
  });
}

function redact(value, key, counts) {
  if (Array.isArray(value)) return value.map((item) => redact(item, key, counts));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey, counts)]));
  }
  if (typeof value !== "string") return value;
  if (SHA256.test(value) && /(?:sha256|digest|hash)/iu.test(key ?? "")) return value;
  if (ID_KEYS.test(key ?? "")) {
    counts.SESSION_OR_TASK_IDENTITY += 1;
    return opaque(value, "identity");
  }
  if (PATH_KEYS.test(key ?? "")) {
    const category = WORKTREE_PATH.test(value) ? "WORKTREE_PATH" : "ABSOLUTE_PATH";
    counts[category] += 1;
    return opaque(value, category);
  }
  if (ENV_KEYS.test(key ?? "")) {
    counts.ENVIRONMENT_VALUE += 1;
    return "REDACTED";
  }
  return redactText(value, counts);
}

export function redactPersistedRecord(value) {
  const counts = emptyCounts();
  const redacted = redact(value, "", counts);
  const scan = scanPersistedRecord(redacted);
  if (!scan.safe) throw new Error(`redaction left forbidden categories: ${Object.entries(scan.categories).filter(([, count]) => count > 0).map(([category]) => category).join(",")}`);
  return {record: redacted, redaction_counts: counts, original_value_sha256: privacyDigest(value), redacted_value_sha256: privacyDigest(redacted)};
}

export function assertPersistedRecordSafe(value) {
  const scan = scanPersistedRecord(value);
  if (!scan.safe) throw new Error(`persisted record contains forbidden categories: ${Object.entries(scan.categories).filter(([, count]) => count > 0).map(([category]) => category).join(",")}`);
  return true;
}

export function redactPersistedText(value) {
  if (typeof value !== "string") throw new TypeError("persisted text must be a string");
  const trimmed = value.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const redacted = redactPersistedRecord(JSON.parse(value));
      const serialized = `${JSON.stringify(redacted.record, null, value.includes("\n") ? 2 : 0)}${value.endsWith("\n") ? "\n" : ""}`;
      return {
        text: serialized,
        redaction_counts: redacted.redaction_counts,
        original_value_sha256: redacted.original_value_sha256,
        redacted_value_sha256: privacyDigest(serialized),
      };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  const counts = emptyCounts();
  const record = redactText(value, counts);
  const scan = scanPersistedRecord(record);
  if (!scan.safe) throw new Error(`text redaction left forbidden categories: ${Object.entries(scan.categories).filter(([, count]) => count > 0).map(([category]) => category).join(",")}`);
  return {
    text: record,
    redaction_counts: counts,
    original_value_sha256: privacyDigest(value),
    redacted_value_sha256: privacyDigest(record),
  };
}

export function serializePersistedRecord(value) {
  const redacted = redactPersistedRecord(value).record;
  assertPersistedRecordSafe(redacted);
  return `${JSON.stringify(canonicalize(redacted))}\n`;
}

function canonicalHostFile(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw new Error(`${label} must be an absolute host-local path`);
  const resolved = fs.realpathSync.native(value);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular host-local file`);
  return resolved;
}

function isWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function assertNoSymlinkComponents(value, label) {
  const absolute = path.resolve(value);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic-link component`);
  }
  return absolute;
}

function ensureDirectoryNoSymlinks(value, label) {
  const destination = assertNoSymlinkComponents(value, label);
  const missing = [];
  let cursor = destination;
  while (!fs.existsSync(cursor)) {
    missing.push(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`${label} has no existing ancestor`);
    cursor = parent;
  }
  assertNoSymlinkComponents(cursor, label);
  let current = cursor;
  for (const name of missing.reverse()) {
    current = path.join(current, name);
    fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} could not be created safely`);
  }
  return current;
}

export function resolveHostLocalRuntimeConfig({configPath = process.env.AGENTOS_HOST_RUNTIME_CONFIG, repositoryRoot = process.cwd()} = {}) {
  const config = canonicalHostFile(configPath, "host runtime configuration");
  const repository = fs.realpathSync.native(repositoryRoot);
  if (isWithin(repository, config)) throw new Error("host runtime configuration must be outside the Git repository");
  return {
    schema: "agentos.host_local_runtime_config_ref.v1",
    location: "HOST_LOCAL_CONFIGURATION_OUTSIDE_REPOSITORY",
    config_ref_sha256: privacyDigest(config),
  };
}

export function compileRedactedRecord({sourceDigest, schemaHint = "OPAQUE_SOURCE_RECORD", capabilityLabels = [], redactionCounts = {}, originalDigest = null} = {}) {
  if (typeof sourceDigest !== "string" || !SHA256.test(sourceDigest)) throw new TypeError("sourceDigest must be a SHA-256");
  if (originalDigest !== null && (typeof originalDigest !== "string" || !SHA256.test(originalDigest))) throw new TypeError("originalDigest must be a SHA-256 or null");
  if (!Array.isArray(capabilityLabels) || capabilityLabels.some((label) => typeof label !== "string" || label.length === 0)) throw new TypeError("capabilityLabels must be nonempty strings");
  const record = {
    schema: PERSISTED_RECORD_PRIVACY_SCHEMA,
    version: PERSISTED_RECORD_PRIVACY_VERSION,
    status: "REDACTED",
    source_digest: sourceDigest,
    original_schema: typeof schemaHint === "string" && schemaHint.length > 0 ? schemaHint : "OPAQUE_SOURCE_RECORD",
    original_digest: originalDigest,
    capability_labels: [...new Set(capabilityLabels)].sort(),
    redaction_counts: Object.fromEntries(PRIVACY_CATEGORIES.map((category) => [category, Number.isSafeInteger(redactionCounts[category]) ? redactionCounts[category] : 0])),
    protected_actions: {
      activation: false,
      acceptance: false,
      publication: false,
      deletion: false,
    },
    content_sha256: null,
  };
  record.content_sha256 = privacyDigest(record);
  return record;
}

export function validateRedactedRecord(record) {
  if (!isRecord(record) || record.schema !== PERSISTED_RECORD_PRIVACY_SCHEMA || record.version !== PERSISTED_RECORD_PRIVACY_VERSION || record.status !== "REDACTED") throw new TypeError("redacted record identity is invalid");
  if (typeof record.source_digest !== "string" || !SHA256.test(record.source_digest)) throw new TypeError("redacted record source digest is invalid");
  if (record.original_digest !== null && (typeof record.original_digest !== "string" || !SHA256.test(record.original_digest))) throw new TypeError("redacted record original digest is invalid");
  if (!Array.isArray(record.capability_labels) || record.capability_labels.some((label) => typeof label !== "string" || label.length === 0)) throw new TypeError("redacted record capability labels are invalid");
  if (!isRecord(record.redaction_counts)) throw new TypeError("redacted record counts are invalid");
  for (const category of PRIVACY_CATEGORIES) if (!Number.isSafeInteger(record.redaction_counts[category]) || record.redaction_counts[category] < 0) throw new TypeError(`redacted record count is invalid: ${category}`);
  if (typeof record.content_sha256 !== "string" || !SHA256.test(record.content_sha256) || record.content_sha256 !== privacyDigest({...record, content_sha256: null})) throw new TypeError("redacted record content digest is invalid");
  if (record.protected_actions !== undefined) {
    if (!isRecord(record.protected_actions)
      || record.protected_actions.activation !== false
      || record.protected_actions.acceptance !== false
      || record.protected_actions.publication !== false
      || record.protected_actions.deletion !== false) throw new TypeError("redacted record protected actions are not disabled");
  }
  if (!scanPersistedRecord(record).safe) throw new TypeError("redacted record contains forbidden content");
  return record;
}

export function writePersistedRecordAtomic({filePath, value, repositoryRoot = process.cwd(), runtimeConfigPath = process.env.AGENTOS_HOST_RUNTIME_CONFIG} = {}) {
  const runtimeConfig = resolveHostLocalRuntimeConfig({configPath: runtimeConfigPath, repositoryRoot});
  if (typeof filePath !== "string" || !path.isAbsolute(filePath) || filePath.includes("\0")) throw new Error("persisted record target must be an absolute path");
  const target = path.resolve(filePath);
  const repository = fs.realpathSync.native(repositoryRoot);
  if (isWithin(repository, target)) throw new Error("persisted record target must be outside the Git repository");
  assertNoSymlinkComponents(path.dirname(target), "persisted record target parent");
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("persisted record target may not be a symbolic link");
  const redacted = redactPersistedRecord(value);
  const categories = Object.entries(redacted.redaction_counts).filter(([, count]) => count > 0).map(([category]) => category);
  const record = compileRedactedRecord({
    sourceDigest: redacted.original_value_sha256,
    schemaHint: "OPAQUE_SOURCE_RECORD",
    capabilityLabels: ["HOST_BOUNDARY_ONLY", "OPAQUE_RECORD", "PRIVACY_REDACTED", ...categories],
    redactionCounts: redacted.redaction_counts,
    originalDigest: redacted.original_value_sha256,
  });
  record.runtime_configuration_ref = runtimeConfig;
  record.content_sha256 = null;
  record.content_sha256 = privacyDigest(record);
  validateRedactedRecord(record);
  ensureDirectoryNoSymlinks(path.dirname(target), "persisted record target parent");
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(canonicalize(record))}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return record;
}
