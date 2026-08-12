#!/usr/bin/env node

import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {pathToFileURL} from "node:url";
import {buildStoredZip, parseStoredZip} from "./deterministic-zip.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const OUTPUT_NAMES = [
  "legacy.zip",
  "legacy.manifest.json",
  "legacy.index.jsonl",
  "legacy.receipt.json",
];
const DEFAULT_EXCLUDED_DIRECTORIES = new Map([
  [".git", "version-control object storage"],
  [".cache", "cache directory"],
  [".next", "generated framework output"],
  [".turbo", "generated task cache"],
  ["build", "generated build output"],
  ["coverage", "generated test coverage"],
  ["dist", "generated distribution output"],
  ["node_modules", "dependency installation"],
]);
const DEFAULT_EXCLUDED_FILES = new Map([
  [".DS_Store", "operating-system metadata"],
]);
const DEFAULT_EXCLUDED_SUFFIXES = new Map([
  [".swp", "editor swap file"],
  [".swo", "editor swap file"],
  [".tmp", "temporary file"],
]);
const SENSITIVE_LEGACY_NAME = /(?:^|[._-])(?:credentials?|secrets?|private[-_]?keys?|id_(?:rsa|dsa|ecdsa|ed25519)|access[-_]?tokens?)(?:$|[._-])/iu;
const ENVIRONMENT_FILE_NAME = /^\.env(?:$|\.)/u;
const SENSITIVE_ASSIGNMENT = /^\s*(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE)|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|password|secret|private[_-]?key)\s*[:=]\s*["']?([^\s"'#]{8,})/imu;
const SAFE_PLACEHOLDER = /^(?:example|placeholder|change[-_]?me|your[-_].*|replace[-_].*|none|null|false|true)$/iu;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function digest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function requireUtc(value, label) {
  requireString(value, label);
  if (!value.endsWith("Z") || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${label} must be valid UTC`);
  }
}

function requireSafeRelativePath(value, label) {
  requireString(value, label);
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")
      || path.posix.isAbsolute(normalized) || normalized.includes("\0")) {
    throw new Error(`${label} must be safe and relative`);
  }
  return normalized;
}

function canonicalDirectory(target, label) {
  requireString(target, label);
  if (!path.isAbsolute(target)) throw new Error(`${label} must be absolute`);
  const absolute = path.resolve(target);
  const initial = fs.lstatSync(absolute);
  if (initial.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  const resolved = fs.realpathSync.native(absolute);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || fs.realpathSync.native(resolved) !== resolved) {
    throw new Error(`${label} must be a canonical directory`);
  }
  return resolved;
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sourceAndDestination(sourceRoot, destinationRoot) {
  const source = canonicalDirectory(sourceRoot, "legacy source root");
  const destination = canonicalDirectory(destinationRoot, "legacy destination root");
  if (isInside(source, destination)) {
    throw new Error("legacy destination cannot be inside the imported source");
  }
  for (const name of OUTPUT_NAMES) {
    if (fs.existsSync(path.join(destination, name))) {
      throw new Error(`legacy output already exists: ${name}`);
    }
  }
  return {source, destination};
}

function exclusionFor(name, isDirectory) {
  if (isDirectory && DEFAULT_EXCLUDED_DIRECTORIES.has(name)) {
    return DEFAULT_EXCLUDED_DIRECTORIES.get(name);
  }
  if (!isDirectory && DEFAULT_EXCLUDED_FILES.has(name)) {
    return DEFAULT_EXCLUDED_FILES.get(name);
  }
  if (!isDirectory) {
    for (const [suffix, reason] of DEFAULT_EXCLUDED_SUFFIXES.entries()) {
      if (name.endsWith(suffix)) return reason;
    }
  }
  return null;
}

function rejectSecretBearingFile(relative, bytes) {
  const basename = path.posix.basename(relative);
  if (ENVIRONMENT_FILE_NAME.test(basename) || SENSITIVE_LEGACY_NAME.test(basename)
      || /\.(?:pem|key|p12|pfx|kdbx)$/iu.test(basename)) {
    throw new Error(`legacy source contains a possible secret-bearing file: ${relative}`);
  }
  const text = bytes.toString("utf8");
  const match = SENSITIVE_ASSIGNMENT.exec(text);
  if (match && !SAFE_PLACEHOLDER.test(match[1])) {
    throw new Error(`legacy source contains a possible credential assignment: ${relative}`);
  }
}

function collectSource(source) {
  const included = [];
  const excluded = [];
  function visit(directory, prefix = "") {
    const entries = fs.readdirSync(directory, {withFileTypes: true})
      .sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      const exclusion = exclusionFor(entry.name, stat.isDirectory());
      if (exclusion !== null) {
        excluded.push({path: relative, reason: exclusion});
        continue;
      }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`legacy source contains an unsafe filesystem entry: ${relative}`);
      }
      if (stat.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      const bytes = fs.readFileSync(absolute);
      rejectSecretBearingFile(relative, bytes);
      included.push({
        path: requireSafeRelativePath(relative, "legacy source path"),
        mode: stat.mode & 0o777,
        size: bytes.length,
        sha256: sha256(bytes),
        bytes,
      });
    }
  }
  visit(source);
  included.sort((left, right) => compareUtf8(left.path, right.path));
  excluded.sort((left, right) => compareUtf8(left.path, right.path));
  if (included.length === 0) throw new Error("legacy source contains no preservable regular files");
  return {included, excluded};
}

export function inspectLegacySource(sourceRoot) {
  const source = canonicalDirectory(sourceRoot, "legacy source root");
  const collected = collectSource(source);
  const manifest = manifestFor(collected, gitObservation(source));
  return {
    source_root: source,
    source_content_sha256: manifest.source_content_sha256,
    source_observation_sha256: manifest.source_observation.observation_sha256,
    included_files: manifest.included_files.length,
    excluded_paths: manifest.excluded_paths.length,
  };
}

function gitObservation(source) {
  const environment = {
    PATH: process.env.PATH ?? "",
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const run = (args) => spawnSync("git", args, {
    cwd: source,
    encoding: "utf8",
    timeout: 10_000,
    env: environment,
  });
  const commit = run(["rev-parse", "HEAD"]);
  const tree = run(["rev-parse", "HEAD^{tree}"]);
  if (commit.status !== 0 || tree.status !== 0) {
    const observation = {repository: "NOT_A_GIT_REPOSITORY", commit: null, tree: null, dirty: null, entries: []};
    return {...observation, observation_sha256: digest(observation)};
  }
  const status = run(["status", "--porcelain=v1", "--untracked-files=all"]);
  const entries = (status.stdout ?? "").trim().split("\n").filter(Boolean).sort(compareUtf8);
  const observation = {
    repository: "GIT",
    commit: (commit.stdout ?? "").trim(),
    tree: (tree.stdout ?? "").trim(),
    dirty: entries.length > 0,
    entries,
  };
  return {...observation, observation_sha256: digest(observation)};
}

function publicFiles(included) {
  return included.map(({bytes, ...record}) => record);
}

function manifestFor(collected, sourceObservation) {
  const includedFiles = publicFiles(collected.included);
  const excludedPaths = collected.excluded;
  return {
    schema: "governance.legacy_preservation_manifest.v1",
    archive_entry_root: "SOURCE_ROOT",
    source_observation: sourceObservation,
    source_content_sha256: digest({included_files: includedFiles, excluded_paths: excludedPaths}),
    included_files: includedFiles,
    excluded_paths: excludedPaths,
  };
}

function indexBytes(included) {
  return Buffer.from(included.map(({bytes, ...record}) => canonicalJson(record)).join(""), "utf8");
}

function verifyManifest(manifest) {
  if (!manifest || manifest.schema !== "governance.legacy_preservation_manifest.v1"
      || manifest.archive_entry_root !== "SOURCE_ROOT"
      || !manifest.source_observation
      || typeof manifest.source_observation.observation_sha256 !== "string"
      || !SHA256.test(manifest.source_content_sha256)
      || !Array.isArray(manifest.included_files)
      || !Array.isArray(manifest.excluded_paths)) {
    throw new Error("legacy manifest identity is invalid");
  }
  const paths = new Set();
  for (const record of manifest.included_files) {
    if (!record || typeof record.path !== "string" || paths.has(record.path)
        || !Number.isSafeInteger(record.mode) || record.mode < 0 || record.mode > 0o777
        || !Number.isSafeInteger(record.size) || record.size < 0
        || !SHA256.test(record.sha256)) {
      throw new Error("legacy manifest included file is invalid");
    }
    requireSafeRelativePath(record.path, "legacy manifest included path");
    paths.add(record.path);
  }
  const excludedPaths = new Set();
  for (const record of manifest.excluded_paths) {
    if (!record || typeof record.path !== "string" || excludedPaths.has(record.path)) {
      throw new Error("legacy manifest excluded path is invalid");
    }
    requireSafeRelativePath(record.path, "legacy manifest excluded path");
    requireString(record.reason, "legacy exclusion reason");
    if (paths.has(record.path)) throw new Error("legacy path is both included and excluded");
    excludedPaths.add(record.path);
  }
  if (manifest.included_files.length === 0) throw new Error("legacy manifest is empty");
  const expected = digest({
    included_files: manifest.included_files,
    excluded_paths: manifest.excluded_paths,
  });
  if (expected !== manifest.source_content_sha256) {
    throw new Error("legacy source content digest mismatch");
  }
  const observationBody = structuredClone(manifest.source_observation);
  delete observationBody.observation_sha256;
  if (digest(observationBody) !== manifest.source_observation.observation_sha256) {
    throw new Error("legacy source observation digest mismatch");
  }
}

export function compileLegacyPreservationPlan(sourceRoot, destinationRoot) {
  const roots = sourceAndDestination(sourceRoot, destinationRoot);
  const collected = collectSource(roots.source);
  const manifest = manifestFor(collected, gitObservation(roots.source));
  const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
  const index = indexBytes(collected.included);
  const zipBytes = buildStoredZip(collected.included.map((entry) => ({
    name: entry.path,
    bytes: entry.bytes,
    mode: entry.mode,
  })));
  return {
    schema: "governance.legacy_preservation_plan.v1",
    source_root: roots.source,
    destination_root: roots.destination,
    manifest,
    manifest_bytes: manifestBytes,
    index_bytes: index,
    archive_bytes: zipBytes,
    archive_sha256: sha256(zipBytes),
    manifest_sha256: sha256(manifestBytes),
    index_sha256: sha256(index),
  };
}

function writeExclusive(target, bytes) {
  const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o444);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function moveExclusive(source, target) {
  // The temporary directory is created inside the destination, so a hard-link
  // gives us an exclusive, same-filesystem publish without rename overwrite.
  fs.linkSync(source, target);
  fs.unlinkSync(source);
}

export function verifyLegacyPreservation(outputRoot, expectedReceipt = null) {
  const root = canonicalDirectory(outputRoot, "legacy output root");
  const archiveBytes = fs.readFileSync(path.join(root, "legacy.zip"));
  const manifestBytes = fs.readFileSync(path.join(root, "legacy.manifest.json"));
  const indexBytesObserved = fs.readFileSync(path.join(root, "legacy.index.jsonl"));
  const receiptBytes = fs.readFileSync(path.join(root, "legacy.receipt.json"));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (canonicalJson(receipt) !== receiptBytes.toString("utf8")
      || receipt.schema !== "governance.legacy_preservation_receipt.v1"
      || receipt.destination !== "AUTHORITY_CORPUS_ROOT"
      || receipt.preserved_before_build !== true
      || !Number.isSafeInteger(receipt.included_files)
      || !Number.isSafeInteger(receipt.excluded_paths)
      || !SHA256.test(receipt.source_content_sha256)
      || !SHA256.test(receipt.source_observation_sha256)
      || !SHA256.test(receipt.archive_sha256)
      || !SHA256.test(receipt.manifest_sha256)
      || !SHA256.test(receipt.index_sha256)
      || !SHA256.test(receipt.receipt_sha256)) {
    throw new Error("legacy receipt identity is invalid");
  }
  const receiptBody = structuredClone(receipt);
  delete receiptBody.receipt_sha256;
  if (digest(receiptBody) !== receipt.receipt_sha256) {
    throw new Error("legacy receipt digest mismatch");
  }
  if (canonicalJson(JSON.parse(manifestBytes.toString("utf8"))) !== manifestBytes.toString("utf8")) {
    throw new Error("legacy manifest is not canonical JSON");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  verifyManifest(manifest);
  if (sha256(archiveBytes) !== receipt.archive_sha256
      || sha256(manifestBytes) !== receipt.manifest_sha256
      || sha256(indexBytesObserved) !== receipt.index_sha256
      || receipt.source_content_sha256 !== manifest.source_content_sha256
      || receipt.source_observation_sha256 !== manifest.source_observation.observation_sha256) {
    throw new Error("legacy receipt does not bind its outputs");
  }
  if (receipt.included_files !== manifest.included_files.length
      || receipt.excluded_paths !== manifest.excluded_paths.length) {
    throw new Error("legacy receipt inventory does not match the manifest");
  }
  const entries = parseStoredZip(archiveBytes);
  const expected = new Set(manifest.included_files.map((record) => record.path));
  if (entries.size !== expected.size
      || [...entries.keys()].some((name) => !expected.has(name))) {
    throw new Error("legacy archive entries do not match the manifest");
  }
  for (const record of manifest.included_files) {
    const entry = entries.get(record.path);
    if (entry.mode !== record.mode || entry.bytes.length !== record.size
        || sha256(entry.bytes) !== record.sha256) {
      throw new Error(`legacy archive content mismatch: ${record.path}`);
    }
  }
  const expectedIndex = manifest.included_files.map((record) => canonicalJson(record)).join("");
  if (indexBytesObserved.toString("utf8") !== expectedIndex) {
    throw new Error("legacy index does not match the manifest");
  }
  if (expectedReceipt !== null && JSON.stringify(receipt) !== JSON.stringify(expectedReceipt)) {
    throw new Error("legacy receipt differs from the expected receipt");
  }
  return {
    schema: "governance.legacy_preservation_verification.v1",
    archive_sha256: sha256(archiveBytes),
    manifest_sha256: sha256(manifestBytes),
    index_sha256: sha256(indexBytesObserved),
    included_files: manifest.included_files.length,
    excluded_paths: manifest.excluded_paths.length,
    status: "VERIFIED_EXACT",
  };
}

export function preserveLegacyCorpus(sourceRoot, destinationRoot, now) {
  requireUtc(now, "legacy preservation time");
  const plan = compileLegacyPreservationPlan(sourceRoot, destinationRoot);
  const repeat = compileLegacyPreservationPlan(sourceRoot, destinationRoot);
  if (plan.archive_sha256 !== repeat.archive_sha256
      || plan.manifest_sha256 !== repeat.manifest_sha256
      || plan.index_sha256 !== repeat.index_sha256) {
    throw new Error("legacy preservation plan is not deterministic");
  }
  const current = compileLegacyPreservationPlan(plan.source_root, plan.destination_root);
  if (current.manifest.source_content_sha256 !== plan.manifest.source_content_sha256
      || current.manifest.source_observation.observation_sha256 !== plan.manifest.source_observation.observation_sha256) {
    throw new Error("legacy source changed after inspection");
  }
  const receiptBody = {
    schema: "governance.legacy_preservation_receipt.v1",
    source_content_sha256: plan.manifest.source_content_sha256,
    source_observation_sha256: plan.manifest.source_observation.observation_sha256,
    archive_sha256: plan.archive_sha256,
    manifest_sha256: plan.manifest_sha256,
    index_sha256: plan.index_sha256,
    included_files: plan.manifest.included_files.length,
    excluded_paths: plan.manifest.excluded_paths.length,
    destination: "AUTHORITY_CORPUS_ROOT",
    preserved_before_build: true,
    created_at: now,
  };
  const receipt = {...receiptBody, receipt_sha256: digest(receiptBody)};
  const temporary = fs.mkdtempSync(path.join(plan.destination_root, ".legacy-preservation-"));
  try {
    writeExclusive(path.join(temporary, "legacy.zip"), plan.archive_bytes);
    writeExclusive(path.join(temporary, "legacy.manifest.json"), plan.manifest_bytes);
    writeExclusive(path.join(temporary, "legacy.index.jsonl"), plan.index_bytes);
    writeExclusive(path.join(temporary, "legacy.receipt.json"), Buffer.from(canonicalJson(receipt), "utf8"));
    const verification = verifyLegacyPreservation(temporary);
    const finalCheck = compileLegacyPreservationPlan(plan.source_root, plan.destination_root);
    if (finalCheck.manifest.source_content_sha256 !== plan.manifest.source_content_sha256
        || finalCheck.manifest.source_observation.observation_sha256 !== plan.manifest.source_observation.observation_sha256) {
      throw new Error("legacy source changed during preservation publish");
    }
    for (const name of OUTPUT_NAMES) moveExclusive(path.join(temporary, name), path.join(plan.destination_root, name));
    fs.rmdirSync(temporary);
    return {plan: {
      schema: plan.schema,
      archive_sha256: plan.archive_sha256,
      manifest_sha256: plan.manifest_sha256,
      index_sha256: plan.index_sha256,
      source_observation_sha256: plan.manifest.source_observation.observation_sha256,
      included_files: plan.manifest.included_files.length,
      excluded_paths: plan.manifest.excluded_paths.length,
    }, receipt, verification};
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, {recursive: true, force: true});
  }
}

function main() {
  const [command, sourceRoot, destinationRoot, now] = process.argv.slice(2);
  if (!command || !sourceRoot || !destinationRoot) {
    throw new Error("usage: legacy-preservation <plan|preserve|verify> <source-root> <authority-corpus-root> [utc]");
  }
  if (command === "plan") {
    const plan = compileLegacyPreservationPlan(sourceRoot, destinationRoot);
    delete plan.archive_bytes;
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  } else if (command === "preserve") {
    process.stdout.write(`${JSON.stringify(preserveLegacyCorpus(
      sourceRoot, destinationRoot, now ?? new Date().toISOString(),
    ))}\n`);
  } else if (command === "verify") {
    process.stdout.write(`${JSON.stringify(verifyLegacyPreservation(destinationRoot))}\n`);
  } else {
    throw new Error("unknown legacy preservation command");
  }
}

if (process.argv[1] !== undefined && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync.native(path.resolve(process.argv[1]))).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
