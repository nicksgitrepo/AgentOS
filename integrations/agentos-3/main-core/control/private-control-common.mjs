#!/usr/bin/env node

/*
 * Shared primitives for the private external control-plane slice.
 *
 * Runtime paths are accepted only at the host boundary.  The records emitted
 * by this module contain references, relative paths, safe identifiers, and
 * digests; they never contain resolved paths or host runtime values.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

export const SHA256 = /^[0-9a-f]{64}$/u;
export const GIT_OBJECT = /^[0-9a-f]{40}$/u;
export const ENVIRONMENT_REFERENCE = /^[A-Z][A-Z0-9_]*$/u;
export const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const RAW_PATH_KEY = /(?:^|_)(?:absolute_path|candidate_root|config_path|control_root|control_plane_root|cwd|destination_root|file_path|git_top_level|home_directory|project_root|projects_root|release_root|resolved_path|retention_root|source_root|worktree_root|working_directory|workspace_path)$/iu;
const RUNTIME_ID_KEY = /(?:^|_)(?:auditor|client_thread|conversation|host|orchestrator|runtime|session|source_thread|task|thread|worker)(?:_id|_identity|_key|_record)?$/iu;
const SECRET_KEY = /(?:^|_)(?:access_key|api_key|authorization|cookie|credential|password|private_key|refresh_token|secret|token)(?:$|_)/iu;
const RAW_PATH_VALUE = /(?:^|[\s"'`=:(\[{])(?:\/(?!\/)(?:[A-Za-z0-9._-]+[\/]){1,}[A-Za-z0-9._-]+|[A-Za-z]:[\\/]|\\\\)[^\s"'`<>)}\]]*/u;
const CHAT_LINK_SCHEME = ["chat", "gpt", "-conversation"].join("");
const PRIVATE_LINK_VALUE = new RegExp(`(?:file:\\/\\/|chat:\\/\\/|${CHAT_LINK_SCHEME}:\\/\\/|https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|[^\\s/]+\\.(?:local|internal|private|corp)))`, "iu");
const ENVIRONMENT_VALUE = /(?:\$\{?[A-Z][A-Z0-9_]*\}?|\b[A-Z][A-Z0-9_]{2,}=[^\s,;]+)/u;
const SECRET_VALUE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+[^\s]+|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|passwd|secret|credential|private[_ -]?key)\s*[:=]\s*(?!\[?redacted\]?\b)[^\s,;)}\]]+)/iu;

export class PrivateControlError extends Error {
  constructor(message, code = "PRIVATE_CONTROL_ERROR") {
    super(message);
    this.name = "PrivateControlError";
    this.code = code;
  }
}

export function invariant(condition, message, code = "PRIVATE_CONTROL_INVALID") {
  if (!condition) throw new PrivateControlError(message, code);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireRecord(value, label) {
  invariant(isRecord(value), `${label} must be an object`);
  return value;
}

export function requireString(value, label) {
  invariant(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  invariant(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

export function requireSafeIdentifier(value, label) {
  requireString(value, label);
  invariant(SAFE_IDENTIFIER.test(value), `${label} is not a safe identifier`);
  return value;
}

export function requireDigest(value, label) {
  invariant(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256 digest`);
  return value;
}

export function requireGitObject(value, label) {
  invariant(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
  return value;
}

export function requireEnvironmentReference(value, label) {
  invariant(typeof value === "string" && ENVIRONMENT_REFERENCE.test(value), `${label} must be an opaque environment reference`);
  return value;
}

export function requireUtc(value, label) {
  requireString(value, label);
  invariant(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
  return value;
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function canonicalDigest(value) {
  return sha256(canonicalJson(value));
}

export function digestWithout(value, key) {
  const body = structuredClone(value);
  delete body[key];
  return canonicalDigest(body);
}

export function exactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  invariant(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

export function safeRelativePath(value, label = "relative path") {
  requireString(value, label);
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  invariant(!path.posix.isAbsolute(normalized)
    && normalized !== "."
    && normalized !== ".."
    && !normalized.startsWith("../")
    && !normalized.includes("/../")
    && !normalized.includes("\0"), `${label} escapes its root`);
  return normalized;
}

function isBase64(value) {
  return typeof value === "string" && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(value);
}

function assertPortableString(value, key, label) {
  if (key === "content_base64" || key === "bytes_base64") {
    invariant(isBase64(value), `${label} contains invalid base64`);
    return;
  }
  invariant(!RAW_PATH_VALUE.test(value), `${label} contains a resolved path`);
  invariant(!PRIVATE_LINK_VALUE.test(value), `${label} contains a private link`);
  invariant(!ENVIRONMENT_VALUE.test(value), `${label} contains an environment value`);
  invariant(!SECRET_VALUE.test(value), `${label} contains secret-like material`);
  if (key === "path" || key === "relative_path" || key.endsWith("_path")) safeRelativePath(value, label);
}

function assertPortableValue(value, key, label, seen) {
  if (typeof value === "string") {
    assertPortableString(value, key, label);
    return;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  invariant(typeof value === "object", `${label} has an unsupported value`);
  invariant(!seen.has(value), `${label} is cyclic`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertPortableValue(item, "", `${label}[${index}]`, seen));
  else {
    for (const [childKey, childValue] of Object.entries(value)) {
      invariant(!RAW_PATH_KEY.test(childKey), `${label}.${childKey} is a resolved path field`);
      invariant(childKey.endsWith("_digest") || !SECRET_KEY.test(childKey), `${label}.${childKey} is a secret field`);
      invariant(!RUNTIME_ID_KEY.test(childKey), `${label}.${childKey} is a runtime identity field`);
      if (childKey.endsWith("_ref") || childKey.endsWith("_root_ref")) requireEnvironmentReference(childValue, `${label}.${childKey}`);
      assertPortableValue(childValue, childKey, `${label}.${childKey}`, seen);
    }
  }
  seen.delete(value);
}

export function assertPortableRecord(value, label = "portable record") {
  requireRecord(value, label);
  assertPortableValue(value, "", label, new Set());
  return value;
}

export function assertPortableText(value, label = "portable text") {
  requireString(value, label);
  invariant(!RAW_PATH_VALUE.test(value), `${label} contains a resolved path`);
  invariant(!PRIVATE_LINK_VALUE.test(value), `${label} contains a private link`);
  invariant(!ENVIRONMENT_VALUE.test(value), `${label} contains an environment value`);
  invariant(!SECRET_VALUE.test(value), `${label} contains secret-like material`);
  return value;
}

function pathComponents(value) {
  const absolute = path.resolve(value);
  const parsed = path.parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const result = [parsed.root];
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    result.push(current);
  }
  return result;
}

export function assertNoSymlinkComponents(value, label = "path") {
  for (const component of pathComponents(value)) {
    if (!fs.existsSync(component)) continue;
    const stat = fs.lstatSync(component);
    invariant(!stat.isSymbolicLink(), `${label} contains a symbolic-link component`, "SYMLINK_COMPONENT_REJECTED");
  }
  return path.resolve(value);
}

export function canonicalExistingDirectory(value, label = "directory") {
  requireString(value, label);
  invariant(path.isAbsolute(value), `${label} must be absolute`);
  const absolute = path.resolve(value);
  assertNoSymlinkComponents(absolute, label);
  const stat = fs.lstatSync(absolute);
  invariant(stat.isDirectory(), `${label} must be a directory`);
  const real = fs.realpathSync.native(absolute);
  invariant(real === absolute, `${label} must be canonical and not an alias`);
  return real;
}

export function canonicalDestination(value, label = "destination") {
  requireString(value, label);
  invariant(path.isAbsolute(value), `${label} must be absolute`);
  const absolute = path.resolve(value);
  if (fs.existsSync(absolute)) {
    assertNoSymlinkComponents(absolute, label);
    const stat = fs.lstatSync(absolute);
    invariant(stat.isDirectory(), `${label} must be a directory`);
    return fs.realpathSync.native(absolute);
  }
  const missing = [];
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) {
    missing.push(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    invariant(parent !== ancestor, `${label} has no existing ancestor`);
    ancestor = parent;
  }
  assertNoSymlinkComponents(ancestor, `${label} ancestor`);
  const realAncestor = fs.realpathSync.native(ancestor);
  let destination = realAncestor;
  for (const name of missing.reverse()) destination = path.join(destination, name);
  return destination;
}

export function isWithin(root, candidate, {strict = false} = {}) {
  const parent = path.resolve(root);
  const child = path.resolve(candidate);
  return strict ? child !== parent && child.startsWith(`${parent}${path.sep}`) : child === parent || child.startsWith(`${parent}${path.sep}`);
}

export function assertContainedPath(root, candidate, label = "contained path", {allowRoot = false, mustExist = false} = {}) {
  const parent = canonicalExistingDirectory(root, `${label} root`);
  const target = path.resolve(candidate);
  invariant((allowRoot ? isWithin(parent, target) : isWithin(parent, target, {strict: true})), `${label} escapes its root`, "CONTAINMENT_REJECTED");
  assertNoSymlinkComponents(path.dirname(target), label);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    invariant(!stat.isSymbolicLink(), `${label} is a symbolic link`, "SYMLINK_COMPONENT_REJECTED");
    const real = fs.realpathSync.native(target);
    invariant(isWithin(parent, real, {strict: !allowRoot}), `${label} resolves outside its root`, "CONTAINMENT_REJECTED");
  } else if (mustExist) invariant(false, `${label} does not exist`, "MISSING_PATH");
  return target;
}

export function ensureDirectory(value, label = "directory") {
  const destination = canonicalDestination(value, label);
  if (fs.existsSync(destination)) return canonicalExistingDirectory(destination, label);
  const missing = [];
  let cursor = destination;
  while (!fs.existsSync(cursor)) {
    missing.push(path.basename(cursor));
    const parent = path.dirname(cursor);
    invariant(parent !== cursor, `${label} has no existing ancestor`);
    cursor = parent;
  }
  assertNoSymlinkComponents(cursor, `${label} ancestor`);
  let current = fs.realpathSync.native(cursor);
  for (const name of missing.reverse()) {
    current = path.join(current, name);
    fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    invariant(stat.isDirectory() && !stat.isSymbolicLink(), `${label} could not be created safely`, "UNSAFE_DIRECTORY");
  }
  return canonicalExistingDirectory(current, label);
}

export function writeExclusiveFile(target, bytes, {mode = 0o600} = {}) {
  requireString(target, "file target");
  invariant(path.isAbsolute(target), "file target must be absolute");
  invariant(Number.isSafeInteger(mode) && mode >= 0 && mode <= 0o777, "file mode is invalid");
  const absolute = path.resolve(target);
  assertNoSymlinkComponents(path.dirname(absolute), "file target parent");
  invariant(!fs.existsSync(absolute), "file target already exists", "SHARED_FILE_CONFLICT");
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.stage`;
  const handle = fs.openSync(temporary, "wx", mode);
  try {
    fs.fchmodSync(handle, mode);
    fs.writeFileSync(handle, payload);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  try {
    fs.linkSync(temporary, absolute);
    fs.unlinkSync(temporary);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    if (error?.code === "EEXIST") throw new PrivateControlError("file target already exists", "SHARED_FILE_CONFLICT");
    throw error;
  }
  return {path: absolute, sha256: sha256(payload), bytes: payload.length};
}

export function writeExactFile(target, bytes, options = {}) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  if (fs.existsSync(target)) {
    assertNoSymlinkComponents(target, "existing file target");
    const stat = fs.lstatSync(target);
    invariant(stat.isFile() && !stat.isSymbolicLink(), "existing file target is unsafe", "UNSAFE_FILE");
    invariant(sha256(fs.readFileSync(target)) === sha256(payload), "existing file differs", "SHARED_FILE_CONFLICT");
    return {path: path.resolve(target), sha256: sha256(payload), bytes: payload.length, status: "EXISTING_EXACT"};
  }
  return {...writeExclusiveFile(target, payload, options), status: "CREATED"};
}

export function runGit(root, args, {allowFailure = false} = {}) {
  const result = spawnSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  if (!allowFailure && result.status !== 0) {
    throw new PrivateControlError(`Git action failed: ${(result.stderr ?? "").trim() || args.join(" ")}`, "GIT_READBACK_FAILED");
  }
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

export function readGitIdentity(root) {
  const top = runGit(root, ["rev-parse", "--show-toplevel"], {allowFailure: true});
  invariant(top.status === 0, "path is not a Git repository", "NOT_A_GIT_REPOSITORY");
  const topReal = fs.realpathSync.native(top.stdout);
  const expected = fs.realpathSync.native(root);
  invariant(topReal === expected, "Git repository is not independent", "FOREIGN_GIT_REPOSITORY");
  const commit = runGit(root, ["rev-parse", "HEAD"], {allowFailure: true});
  const tree = runGit(root, ["rev-parse", "HEAD^{tree}"], {allowFailure: true});
  const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], {allowFailure: true});
  return {
    repository: "INDEPENDENT_GIT",
    commit: commit.status === 0 && GIT_OBJECT.test(commit.stdout) ? commit.stdout : null,
    tree: tree.status === 0 && GIT_OBJECT.test(tree.stdout) ? tree.stdout : null,
    clean: status.status === 0 && status.stdout.length === 0,
  };
}

export function ensurePrivateGitRepository(root) {
  const existing = runGit(root, ["rev-parse", "--show-toplevel"], {allowFailure: true});
  if (existing.status !== 0) runGit(root, ["init", "--quiet"]);
  const identity = readGitIdentity(root);
  invariant(identity.repository === "INDEPENDENT_GIT", "control repository is not independent", "FOREIGN_GIT_REPOSITORY");
  return identity;
}

export function collectRegularFiles(root, {excludeRootNames = new Set(), excludeRelativePrefixes = [], rejectHardlinks = true} = {}) {
  const directory = canonicalExistingDirectory(root, "file inventory root");
  const entries = [];
  const seenInodes = new Set();
  const excludedPrefixes = excludeRelativePrefixes.map((value) => safeRelativePath(value, "excluded inventory prefix"));
  function visit(current, relative = "") {
    const names = fs.readdirSync(current, {withFileTypes: true}).sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of names) {
      if (!relative && excludeRootNames.has(entry.name)) continue;
      const child = path.join(current, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (excludedPrefixes.some((prefix) => prefix === childRelative)) continue;
      const stat = fs.lstatSync(child);
      invariant(!stat.isSymbolicLink(), `file inventory contains a symbolic link: ${childRelative}`, "SYMLINK_COMPONENT_REJECTED");
      if (stat.isDirectory()) {
        invariant(entry.name !== ".git" || !relative, `nested Git directory is not portable: ${childRelative}`, "UNSAFE_GIT_OBJECT");
        visit(child, childRelative);
      } else {
        invariant(stat.isFile(), `file inventory contains an unsafe object: ${childRelative}`, "UNSAFE_FILE");
        if (rejectHardlinks) {
          const inode = `${stat.dev}:${stat.ino}`;
          invariant(!seenInodes.has(inode), `file inventory contains a hardlink alias: ${childRelative}`, "HARDLINK_REJECTED");
          seenInodes.add(inode);
        }
        const bytes = fs.readFileSync(child);
        entries.push({path: childRelative, bytes, mode: stat.mode & 0o777, size: bytes.length, sha256: sha256(bytes)});
      }
    }
  }
  visit(directory);
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  return entries;
}

export function inventoryDigest(entries) {
  return canonicalDigest(entries.map(({bytes, ...entry}) => entry));
}

export function directoryContentDigest(root, options = {}) {
  return inventoryDigest(collectRegularFiles(root, options));
}

export function readJsonFile(filePath, label = "JSON record") {
  assertNoSymlinkComponents(filePath, label);
  const stat = fs.lstatSync(filePath);
  invariant(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular file`, "UNSAFE_FILE");
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new PrivateControlError(`${label} is not valid JSON: ${error.message}`, "INVALID_JSON");
  }
}
