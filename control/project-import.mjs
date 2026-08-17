#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {buildStoredZip, parseStoredZip} from "./deterministic-zip.mjs";
import {AUDIT_DISCIPLINES} from "./campaign-cascade.mjs";
import {
  assertUniversalDevelopmentMode,
  universalTaskCloseoutPolicy,
} from "./governance-library.mjs";
import {validateNormalizationPolicy} from "./normalization-policy.mjs";
import {validateStandardsRegistry} from "./standards-registry.mjs";
import {readSourceControlBinding} from "./bootstrap-discovery.mjs";
import {opaqueSchedulerWorktreeRef} from "./hybrid-scheduler.mjs";
import {
  assertNoSymlinkComponents as assertSafePathComponents,
  ensureDirectory as ensureSafeDirectory,
} from "./private-control-common.mjs";

export const PROJECT_IMPORT_SCHEMA = "agentos.project_import.v1";
export const PROJECT_IMPORT_MODES = Object.freeze([
  "ADOPT_IN_PLACE",
  "CLEAN_COPY",
  "NORMALIZE_AND_AUDIT",
  "RECONSTRUCT_FROM_INTENT",
]);
export const PROJECT_IMPORT_STATUSES = Object.freeze([
  "PLANNED",
  "PRESERVED",
  "MIGRATION_IN_PROGRESS",
  "CUTOVER_READY",
  "CUTOVER_COMPLETE",
  "ROLLED_BACK",
]);
export const IMPORT_AUDIT_LANES = Object.freeze([...AUDIT_DISCIPLINES]);
export const PROJECT_IMPORT_STORAGE_MODES = Object.freeze(["PROJECT_SIDE_CAR", "EXTERNAL_CONTROL_PLANE"]);
export const PYRAMID_IMPORT_OUTPUT_SCHEMA = "agentos.pyramid_import_output.v1";
export const PYRAMID_IMPORT_OUTPUT_STATUSES = Object.freeze(["READY_FOR_GIT_REPOINT", "GIT_REPOINTED"]);
export const GIT_REPOINT_PLAN_SCHEMA = "agentos.git_repoint_plan.v1";
export const GIT_REPOINT_PLAN_STATUSES = Object.freeze(["READY_FOR_PROTECTED_CUTOVER", "AUTHORIZED_PENDING_RUNTIME_EXECUTION", "EXECUTED"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const REFERENCE = /^(?:opaque:|ref:)[A-Za-z0-9._:/-]+$/u;
const REPOSITORY_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,191}$/u;
const SECRET_NAME = /(?:^|[._-])(?:env|credentials?|secrets?|private[-_]?keys?|id_(?:rsa|dsa|ecdsa|ed25519)|access[-_]?tokens?)(?:$|[._-])/iu;
const ENV_NAME = /^\.env(?:$|\.)/u;
const SENSITIVE_ASSIGNMENT = /(?:^|[,{]\s*)["']?(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE)|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|password|secret|private[_-]?key)["']?\s*[:=]\s*["']?([^\s"'#,}\]]+)/imu;
const SAFE_PLACEHOLDER = /^(?:example|placeholder|change[-_]?me|your[-_].*|replace[-_].*|none|null|false|true)$/iu;
const GENERATED_DIRECTORIES = new Map([
  [".git", "version-control object storage"], ["node_modules", "dependency installation"],
  [".next", "generated framework output"], [".turbo", "generated task cache"],
  ["build", "generated build output"], ["dist", "generated distribution output"],
  ["coverage", "generated test coverage"], [".cache", "cache directory"],
]);
const GENERATED_SUFFIXES = new Map([[".swp", "editor swap file"], [".swo", "editor swap file"], [".tmp", "temporary file"]]);
const OUTPUT_NAMES = new Set([
  "source-preservation.zip", "source-preservation.manifest.json", "source-preservation.index.jsonl",
  "source-preservation.receipt.json", "import-exclusions.md",
]);
const RESERVED_PRESERVATION_ROOT = ".agentos/import";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function exactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object ID`);
}

function requireReference(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque or content-addressed reference`);
}

function requireRepositoryId(value, label) {
  assert(typeof value === "string" && REPOSITORY_ID.test(value), `${label} must be a stable repository identifier`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function safeRelative(value, label) {
  requireString(value, label);
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  assert(!path.posix.isAbsolute(normalized) && normalized !== "." && normalized !== ".."
    && !normalized.startsWith("../") && !normalized.includes("\0"), `${label} is unsafe`);
  return normalized;
}

function canonicalExistingDirectory(root, label) {
  requireString(root, label);
  assert(path.isAbsolute(root), `${label} must be absolute`);
  const absolute = path.resolve(root);
  const initial = fs.lstatSync(absolute);
  assert(!initial.isSymbolicLink(), `${label} must not be a symbolic link`);
  const real = fs.realpathSync.native(absolute);
  const stat = fs.lstatSync(real);
  assert(stat.isDirectory() && fs.realpathSync.native(real) === real, `${label} must be a canonical directory`);
  return real;
}

function canonicalDestination(root, label) {
  requireString(root, label);
  assert(path.isAbsolute(root), `${label} must be absolute`);
  const absolute = path.resolve(root);
  if (fs.existsSync(absolute)) return canonicalExistingDirectory(absolute, label);
  const missing = [];
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) {
    missing.push(path.basename(ancestor));
    const next = path.dirname(ancestor);
    assert(next !== ancestor, `${label} has no existing parent`);
    ancestor = next;
  }
  const parent = canonicalExistingDirectory(ancestor, `${label} parent`);
  return path.join(parent, ...missing.reverse());
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function pathsOverlap(left, right) {
  return isInside(left, right) || isInside(right, left);
}

function sourceDestination(sourceRoot, destinationRoot, {allowNullDestination = false, allowDestinationInsideSource = false} = {}) {
  const source = canonicalExistingDirectory(sourceRoot, "project import source root");
  if (destinationRoot === null && allowNullDestination) return {source, destination: null};
  const destination = canonicalDestination(destinationRoot, "project import destination root");
  assert(source !== destination && (!isInside(source, destination) || allowDestinationInsideSource) && !isInside(destination, source), "project import source and destination must be separate non-overlapping roots");
  return {source, destination};
}

function sourceExclusion(relative, entry, bytes = null) {
  const name = path.posix.basename(relative);
  if (entry.isDirectory() && GENERATED_DIRECTORIES.has(name)) return GENERATED_DIRECTORIES.get(name);
  if (entry.isFile() && name === ".DS_Store") return "operating-system metadata";
  if (entry.isFile() && OUTPUT_NAMES.has(name)) return "AgentOS import preservation output";
  if (entry.isFile() && GENERATED_SUFFIXES.has(path.extname(name))) return GENERATED_SUFFIXES.get(path.extname(name));
  if (entry.isFile() && (ENV_NAME.test(name) || SECRET_NAME.test(name))) return "secret-bearing or environment file; never archived";
  if (entry.isFile() && bytes !== null) {
    const text = bytes.toString("utf8");
    const match = SENSITIVE_ASSIGNMENT.exec(text);
    if (match && !SAFE_PLACEHOLDER.test(match[1])) return "credential-bearing content; never archived";
  }
  return null;
}

function collectSource(source) {
  const included = [];
  const excluded = [{path: RESERVED_PRESERVATION_ROOT, reason: "reserved AgentOS source-preservation output root"}];
  function visit(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => compareUtf8(left.name, right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (relative === entry.name && entry.name.startsWith(".agentos-bootstrap-stage-")) continue;
      if (relative === RESERVED_PRESERVATION_ROOT) continue;
      if (relative.startsWith(`${RESERVED_PRESERVATION_ROOT}/`)) continue;
      const earlyExclusion = sourceExclusion(relative, stat);
      if (earlyExclusion !== null) {
        excluded.push({path: safeRelative(relative, "excluded source path"), reason: earlyExclusion});
        continue;
      }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`project import source contains an unsafe filesystem entry: ${relative}`);
      }
      if (stat.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      const bytes = fs.readFileSync(absolute);
      const contentExclusion = sourceExclusion(relative, stat, bytes);
      if (contentExclusion !== null) {
        excluded.push({path: safeRelative(relative, "excluded source path"), reason: contentExclusion});
        continue;
      }
      included.push({
        path: safeRelative(relative, "source path"),
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
  assert(included.length > 0, "project import source contains no preservable regular files");
  return {included, excluded};
}

function publicFiles(entries) {
  return entries.map(({bytes, ...entry}) => entry);
}

function sourceObservation(source, collected) {
  const body = {
    source_root_ref: opaqueSchedulerWorktreeRef(source),
    source_content_sha256: canonicalDigest({included_files: publicFiles(collected.included), excluded_paths: collected.excluded}),
    included_files: collected.included.length,
    excluded_paths: collected.excluded.length,
  };
  return {...body, observation_sha256: canonicalDigest(body)};
}

function sourceManifest(source, collected) {
  const observation = sourceObservation(source, collected);
  return {
    schema: "agentos.project_source_preservation_manifest.v1",
    version: 1,
    archive_entry_root: "SOURCE_ROOT",
    source_observation: observation,
    source_content_sha256: observation.source_content_sha256,
    included_files: publicFiles(collected.included),
    excluded_paths: collected.excluded,
  };
}

function indexBytes(included) {
  return Buffer.from(included.map(({bytes, ...entry}) => canonicalJson(entry)).join(""), "utf8");
}

function exclusionsMarkdown(manifest) {
  const lines = [
    "# Import exclusions",
    "",
    "This file records source entries intentionally excluded from the deterministic preservation archive. Exclusions are not silently discarded.",
    "",
    "| Path | Reason |",
    "| --- | --- |",
    ...manifest.excluded_paths.map((entry) => `| ${entry.path.replaceAll("|", "\\|")} | ${entry.reason.replaceAll("|", "\\|")} |`),
    "",
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

export function inspectProjectSource(sourceRoot) {
  const source = canonicalExistingDirectory(sourceRoot, "project import source root");
  const collected = collectSource(source);
  const manifest = sourceManifest(source, collected);
  let sourceControl = null;
  try {
    sourceControl = readSourceControlBinding(source);
  } catch (error) {
    if (error?.code !== "SOURCE_CONTROL_READBACK_REQUIRED") throw error;
  }
  return {
    source_root_ref: opaqueSchedulerWorktreeRef(source),
    source_commit: sourceControl?.source_commit ?? null,
    source_tree: sourceControl?.source_tree ?? null,
    source_content_sha256: manifest.source_content_sha256,
    source_observation_sha256: manifest.source_observation.observation_sha256,
    included_files: manifest.included_files.length,
    excluded_paths: manifest.excluded_paths.length,
  };
}

export function compileSourcePreservationPlan(sourceRoot, destinationRoot, {allowDestinationInsideSource = false} = {}) {
  const roots = sourceDestination(sourceRoot, destinationRoot, {allowDestinationInsideSource});
  const collected = collectSource(roots.source);
  const manifest = sourceManifest(roots.source, collected);
  const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
  const index = indexBytes(collected.included);
  const archive = buildStoredZip(collected.included.map((entry) => ({name: entry.path, bytes: entry.bytes, mode: entry.mode})));
  const exclusions = exclusionsMarkdown(manifest);
  return {
    schema: "agentos.project_source_preservation_plan.v1",
    source_root: roots.source,
    destination_root: roots.destination,
    manifest,
    manifest_bytes: manifestBytes,
    index_bytes: index,
    archive_bytes: archive,
    exclusions_bytes: exclusions,
    archive_sha256: sha256(archive),
    manifest_sha256: sha256(manifestBytes),
    index_sha256: sha256(index),
    exclusions_sha256: sha256(exclusions),
  };
}

function writeExclusive(target, bytes) {
  assertSafePathComponents(path.dirname(target), "source preservation target parent");
  const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o444);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function moveExclusive(source, target) {
  assertSafePathComponents(source, "source preservation staged artifact");
  assertSafePathComponents(path.dirname(target), "source preservation destination parent");
  assert(!fs.existsSync(target), `source preservation destination already exists: ${path.basename(target)}`);
  fs.linkSync(source, target);
  const targetStat = fs.lstatSync(target);
  assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "source preservation destination became unsafe");
  fs.unlinkSync(source);
}

function rollbackPublishedArtifacts(destinationRoot, published, expectedBytes) {
  const rolledBack = [];
  for (const name of [...published].reverse()) {
    const target = path.join(destinationRoot, name);
    assertSafePathComponents(target, `source preservation rollback target ${name}`);
    const stat = fs.lstatSync(target);
    assert(stat.isFile() && !stat.isSymbolicLink(), `source preservation rollback target is unsafe: ${name}`);
    assert(sha256(fs.readFileSync(target)) === sha256(expectedBytes.get(name)), `source preservation rollback target changed: ${name}`);
    fs.unlinkSync(target);
    rolledBack.push(name);
  }
  return rolledBack.sort(compareUtf8);
}

export function verifySourcePreservation(outputRoot, expectedReceipt = null) {
  const root = canonicalExistingDirectory(outputRoot, "project preservation output root");
  const archive = fs.readFileSync(path.join(root, "source-preservation.zip"));
  const manifestBytes = fs.readFileSync(path.join(root, "source-preservation.manifest.json"));
  const index = fs.readFileSync(path.join(root, "source-preservation.index.jsonl"));
  const exclusions = fs.readFileSync(path.join(root, "import-exclusions.md"));
  const receiptBytes = fs.readFileSync(path.join(root, "source-preservation.receipt.json"));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert(canonicalJson(receipt) === receiptBytes.toString("utf8"), "source preservation receipt is not canonical JSON");
  assert(receipt.schema === "agentos.project_source_preservation_receipt.v1" && receipt.preserved_before_migration === true, "source preservation receipt identity is invalid");
  for (const field of ["source_content_sha256", "source_observation_sha256", "archive_sha256", "manifest_sha256", "index_sha256", "exclusions_sha256", "receipt_sha256"]) requireSha(receipt[field], `source preservation receipt ${field}`);
  const receiptBody = structuredClone(receipt);
  delete receiptBody.receipt_sha256;
  assert(receipt.receipt_sha256 === canonicalDigest(receiptBody), "source preservation receipt digest is invalid");
  assert(canonicalJson(JSON.parse(manifestBytes.toString("utf8"))) === manifestBytes.toString("utf8"), "source preservation manifest is not canonical JSON");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert(manifest.schema === "agentos.project_source_preservation_manifest.v1" && manifest.archive_entry_root === "SOURCE_ROOT", "source preservation manifest identity is invalid");
  assert(manifest.included_files.length > 0 && Array.isArray(manifest.excluded_paths), "source preservation manifest inventory is invalid");
  assert(canonicalDigest({included_files: manifest.included_files, excluded_paths: manifest.excluded_paths}) === manifest.source_content_sha256, "source preservation content digest mismatch");
  assert(sha256(archive) === receipt.archive_sha256 && sha256(manifestBytes) === receipt.manifest_sha256
    && sha256(index) === receipt.index_sha256 && sha256(exclusions) === receipt.exclusions_sha256, "source preservation receipt does not bind its artifacts");
  assert(receipt.source_content_sha256 === manifest.source_content_sha256 && receipt.source_observation_sha256 === manifest.source_observation.observation_sha256, "source preservation receipt is not bound to the manifest");
  const entries = parseStoredZip(archive);
  const expected = new Set(manifest.included_files.map((entry) => entry.path));
  assert(entries.size === expected.size && [...entries.keys()].every((name) => expected.has(name)), "source preservation archive entries do not match the manifest");
  for (const entry of manifest.included_files) {
    const actual = entries.get(entry.path);
    assert(actual && actual.mode === entry.mode && actual.bytes.length === entry.size && sha256(actual.bytes) === entry.sha256, `source preservation archive content mismatch: ${entry.path}`);
  }
  assert(index.toString("utf8") === manifest.included_files.map((entry) => canonicalJson(entry)).join(""), "source preservation index does not match the manifest");
  assert(exclusions.toString("utf8") === exclusionsMarkdown(manifest).toString("utf8"), "source exclusion record does not match the manifest");
  if (expectedReceipt !== null) assert(JSON.stringify(receipt) === JSON.stringify(expectedReceipt), "source preservation receipt differs from expected receipt");
  return {schema: "agentos.project_source_preservation_verification.v1", archive_sha256: receipt.archive_sha256, manifest_sha256: receipt.manifest_sha256, index_sha256: receipt.index_sha256, exclusions_sha256: receipt.exclusions_sha256, included_files: manifest.included_files.length, excluded_paths: manifest.excluded_paths.length, status: "VERIFIED_EXACT"};
}

export function preserveProjectSource(sourceRoot, destinationRoot, nowUtc, {allowDestinationInsideSource = false} = {}) {
  requireUtc(nowUtc, "project source preservation time");
  const plan = compileSourcePreservationPlan(sourceRoot, destinationRoot, {allowDestinationInsideSource});
  const repeat = compileSourcePreservationPlan(sourceRoot, destinationRoot, {allowDestinationInsideSource});
  for (const field of ["archive_sha256", "manifest_sha256", "index_sha256", "exclusions_sha256"]) assert(plan[field] === repeat[field], `project source preservation is not deterministic: ${field}`);
  const receiptBody = {
    schema: "agentos.project_source_preservation_receipt.v1",
    source_content_sha256: plan.manifest.source_content_sha256,
    source_observation_sha256: plan.manifest.source_observation.observation_sha256,
    archive_sha256: plan.archive_sha256,
    manifest_sha256: plan.manifest_sha256,
    index_sha256: plan.index_sha256,
    exclusions_sha256: plan.exclusions_sha256,
    included_files: plan.manifest.included_files.length,
    excluded_paths: plan.manifest.excluded_paths.length,
    preserved_before_migration: true,
    created_at_utc: nowUtc,
  };
  const receipt = {...receiptBody, receipt_sha256: canonicalDigest(receiptBody)};
  const destinationRootPath = ensureSafeDirectory(plan.destination_root, "project preservation output root");
  const artifactBytes = new Map([
    ["source-preservation.zip", plan.archive_bytes],
    ["source-preservation.manifest.json", plan.manifest_bytes],
    ["source-preservation.index.jsonl", plan.index_bytes],
    ["import-exclusions.md", plan.exclusions_bytes],
    ["source-preservation.receipt.json", Buffer.from(canonicalJson(receipt), "utf8")],
  ]);
  const artifactNames = [...artifactBytes.keys()];
  const existing = artifactNames.filter((name) => fs.existsSync(path.join(destinationRootPath, name)));
  if (existing.length > 0) {
    const exact = existing.length === artifactNames.length && existing.every((name) => {
      const target = path.join(destinationRootPath, name);
      assertSafePathComponents(target, `existing source preservation target ${name}`);
      const stat = fs.lstatSync(target);
      return stat.isFile() && !stat.isSymbolicLink() && sha256(fs.readFileSync(target)) === sha256(artifactBytes.get(name));
    });
    if (exact) return {receipt: JSON.parse(fs.readFileSync(path.join(destinationRootPath, "source-preservation.receipt.json"), "utf8")), verification: verifySourcePreservation(destinationRootPath)};
    const conflict = new Error("source preservation destination contains a partial or conflicting artifact set");
    conflict.code = "SOURCE_PRESERVATION_TARGET_CONFLICT";
    throw conflict;
  }
  const temporary = fs.mkdtempSync(path.join(plan.destination_root, ".agentos-source-preservation-"));
  assertSafePathComponents(temporary, "source preservation staging root");
  const published = [];
  try {
    for (const [name, bytes] of artifactBytes) writeExclusive(path.join(temporary, name), bytes);
    verifySourcePreservation(temporary);
    const finalCheck = compileSourcePreservationPlan(plan.source_root, plan.destination_root, {allowDestinationInsideSource});
    assert(finalCheck.manifest.source_content_sha256 === plan.manifest.source_content_sha256
      && finalCheck.manifest.source_observation.observation_sha256 === plan.manifest.source_observation.observation_sha256, "source changed during preservation publish");
    for (const name of artifactNames) {
      const beforePublish = compileSourcePreservationPlan(plan.source_root, plan.destination_root, {allowDestinationInsideSource});
      assert(beforePublish.manifest.source_content_sha256 === plan.manifest.source_content_sha256
        && beforePublish.manifest.source_observation.observation_sha256 === plan.manifest.source_observation.observation_sha256, "source changed during preservation publish");
      moveExclusive(path.join(temporary, name), path.join(destinationRootPath, name));
      published.push(name);
    }
    fs.rmdirSync(temporary);
    return {receipt, verification: verifySourcePreservation(destinationRootPath)};
  } catch (error) {
    try {
      rollbackPublishedArtifacts(destinationRootPath, published, artifactBytes);
    } catch (rollbackError) {
      const recovery = new Error(`${error.message}; source preservation rollback failed: ${rollbackError.message}`);
      recovery.code = "SOURCE_PRESERVATION_RECOVERY_REQUIRED";
      throw recovery;
    }
    const rolledBack = new Error(`source preservation rolled back after publish failure: ${error.message}`);
    rolledBack.code = "SOURCE_PRESERVATION_ROLLED_BACK";
    rolledBack.published_paths = [...published].sort(compareUtf8);
    throw rolledBack;
  } finally {
    if (fs.existsSync(temporary)) {
      assertSafePathComponents(temporary, "source preservation staging root");
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  }
}

function phaseNames(mode) {
  const planning = "CONTROLLER_PROJECT_DISCOVERY_AND_CAMPAIGN_PLANNING";
  if (mode === "ADOPT_IN_PLACE") return ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", planning, "BIND_GOVERNANCE", "CUTOVER_OR_CONTINUE"];
  if (mode === "CLEAN_COPY") return ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", "COPY_ALLOWED_SOURCE", planning, "MATERIALIZE_NEW_PROJECT_REPOSITORIES", "PREPARE_GIT_REPOINT", "BIND_GOVERNANCE", "CUTOVER_OR_ROLLBACK"];
  const pyramid = [planning, "CONTROLLER_DERIVED_AUDIT_REPAIR_PYRAMID", "PLATFORM_AND_CENTRAL_INTEGRATION", "INDEPENDENT_REAUDIT", "MATERIALIZE_NEW_PROJECT_REPOSITORIES", "PREPARE_GIT_REPOINT", "CUTOVER_OR_ROLLBACK"];
  if (mode === "NORMALIZE_AND_AUDIT") return ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", "COPY_ALLOWED_SOURCE", "NORMALIZE_STRUCTURE_AND_NAMES", ...pyramid];
  return ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", "RECONSTRUCT_FROM_ACCEPTED_INTENT", ...pyramid];
}

function auditSchedule(mode) {
  const full = ["NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(mode);
  return IMPORT_AUDIT_LANES.map((discipline) => ({
    discipline,
    disposition: full ? "REQUIRED" : "DETERMINISTIC_ONLY",
    schedule: full ? "PARALLEL_READ_ONLY_AT_SUBSTANTIAL_CHECKPOINTS" : "BASELINE_ONLY_UNTIL_CAMPAIGN_ADMISSION",
    writer: "NONE_READ_ONLY",
  }));
}

function validatePyramidImportLegacy(legacy) {
  const keys = [
    "source_root_ref", "source_commit", "source_tree", "source_content_sha256", "source_observation_sha256",
    "preservation_ref", "preservation_receipt_sha256", "immutable", "untouched", "read_only", "retention",
  ];
  exactKeys(legacy, keys, "pyramid import legacy source");
  requireReference(legacy.source_root_ref, "pyramid import legacy source root");
  requireGitObject(legacy.source_commit, "pyramid import legacy source commit", {nullable: true});
  requireGitObject(legacy.source_tree, "pyramid import legacy source tree", {nullable: true});
  requireSha(legacy.source_content_sha256, "pyramid import legacy source content");
  requireSha(legacy.source_observation_sha256, "pyramid import legacy source observation");
  requireReference(legacy.preservation_ref, "pyramid import legacy preservation");
  requireSha(legacy.preservation_receipt_sha256, "pyramid import legacy preservation receipt");
  assert(legacy.immutable === true && legacy.untouched === true && legacy.read_only === true, "pyramid import legacy source must be immutable, untouched, and read-only");
  assert(legacy.retention === "LEGACY_REPOSITORY_UNTOUCHED", "pyramid import legacy retention policy is invalid");
  return legacy;
}

function validatePyramidImportRepository(repository, index, legacy) {
  const keys = [
    "repository_id", "repository_ref", "branch_ref", "commit", "tree", "candidate_sha256",
    "source_content_sha256", "source_observation_sha256", "pyramid_candidate_sha256", "rollback_ref", "clean", "status",
  ];
  exactKeys(repository, keys, `pyramid import candidate repository ${index}`);
  requireRepositoryId(repository.repository_id, `pyramid import candidate repository ${index} ID`);
  requireReference(repository.repository_ref, `pyramid import candidate repository ${index} reference`);
  requireString(repository.branch_ref, `pyramid import candidate repository ${index} branch`);
  assert(!repository.branch_ref.startsWith("/") && !repository.branch_ref.includes("\\") && !repository.branch_ref.split("/").includes(".."), `pyramid import candidate repository ${index} branch is unsafe`);
  requireGitObject(repository.commit, `pyramid import candidate repository ${index} commit`);
  requireGitObject(repository.tree, `pyramid import candidate repository ${index} tree`);
  requireSha(repository.candidate_sha256, `pyramid import candidate repository ${index} candidate`);
  requireSha(repository.source_content_sha256, `pyramid import candidate repository ${index} source content`);
  requireSha(repository.source_observation_sha256, `pyramid import candidate repository ${index} source observation`);
  requireSha(repository.pyramid_candidate_sha256, `pyramid import candidate repository ${index} pyramid candidate`);
  requireReference(repository.rollback_ref, `pyramid import candidate repository ${index} rollback`);
  assert(repository.clean === true, `pyramid import candidate repository ${index} must be clean`);
  assert(repository.status === "INDEPENDENT_REAUDITED_CANDIDATE", `pyramid import candidate repository ${index} is not independently re-audited`);
  assert(repository.source_content_sha256 === legacy.source_content_sha256, `pyramid import candidate repository ${index} source content lineage is stale`);
  assert(repository.source_observation_sha256 === legacy.source_observation_sha256, `pyramid import candidate repository ${index} source observation lineage is stale`);
  return repository;
}

function validatePyramidImportPyramid(pyramid) {
  const keys = [
    "specialist_audit_repair_sha256", "platform_review_sha256", "central_integration_sha256", "independent_reaudit_sha256",
    "audit_repair_complete", "platform_review_complete", "central_integration_complete", "independent_reaudit_complete", "wave_count",
  ];
  exactKeys(pyramid, keys, "pyramid import acceptance");
  for (const field of ["specialist_audit_repair_sha256", "platform_review_sha256", "central_integration_sha256", "independent_reaudit_sha256"]) requireSha(pyramid[field], `pyramid import ${field}`);
  for (const field of ["audit_repair_complete", "platform_review_complete", "central_integration_complete", "independent_reaudit_complete"]) assert(pyramid[field] === true, `pyramid import ${field} is incomplete`);
  assert(Number.isSafeInteger(pyramid.wave_count) && pyramid.wave_count >= 1, "pyramid import wave count is invalid");
  return pyramid;
}

function validateGitRepointPolicy(policy, repositoryIds, {allowExecuted = false} = {}) {
  const keys = [
    "status", "operation", "target_repository_ids", "legacy_policy", "source_recheck_required", "candidate_recheck_required",
    "rollback_receipt_required", "legacy_delete_forbidden", "source_mutation_forbidden", "destructive_work_forbidden", "authorization_ref", "rollback_ref", "next_action",
  ];
  exactKeys(policy, keys, "pyramid import Git repoint policy");
  assert(GIT_REPOINT_PLAN_STATUSES.includes(policy.status), "pyramid import Git repoint status is invalid");
  if (!allowExecuted) assert(policy.status !== "EXECUTED", "pyramid import output cannot claim Git repoint execution");
  assert(policy.operation === "ATOMIC_REPOINT_PROJECT_GIT_TO_NEW_REPOSITORIES", "pyramid import Git repoint operation is invalid");
  assert(Array.isArray(policy.target_repository_ids) && JSON.stringify(policy.target_repository_ids) === JSON.stringify([...repositoryIds].sort(compareUtf8)), "pyramid import Git repoint repository projection is stale");
  policy.target_repository_ids.forEach((value, index) => requireRepositoryId(value, `pyramid import Git repoint repository ${index}`));
  assert(policy.legacy_policy === "RETAIN_LEGACY_REPOSITORIES_UNTOUCHED", "pyramid import Git repoint legacy policy is unsafe");
  for (const field of ["source_recheck_required", "candidate_recheck_required", "rollback_receipt_required", "legacy_delete_forbidden", "source_mutation_forbidden", "destructive_work_forbidden"]) assert(policy[field] === true, `pyramid import Git repoint ${field} is weakened`);
  requireReference(policy.authorization_ref, "pyramid import Git repoint authorization", {nullable: true});
  requireReference(policy.rollback_ref, "pyramid import Git repoint rollback");
  assert(["WAIT_FOR_GIT_REPOINT_AUTHORIZATION", "RUNTIME_ATOMIC_GIT_REPOINT", "GIT_REPOINT_COMPLETE"].includes(policy.next_action), "pyramid import Git repoint next action is invalid");
  if (policy.status === "READY_FOR_PROTECTED_CUTOVER") assert(policy.authorization_ref === null && policy.next_action === "WAIT_FOR_GIT_REPOINT_AUTHORIZATION", "unapproved Git repoint must wait for authorization");
  if (policy.status === "AUTHORIZED_PENDING_RUNTIME_EXECUTION") assert(policy.authorization_ref !== null && policy.next_action === "RUNTIME_ATOMIC_GIT_REPOINT", "authorized Git repoint is not runtime-bound");
  if (policy.status === "EXECUTED") assert(policy.authorization_ref !== null && policy.next_action === "GIT_REPOINT_COMPLETE", "executed Git repoint lacks authorization or completion action");
  return policy;
}

export function compilePyramidImportOutput({projectId, sourceIdentity, preservationRef, preservationReceiptSha256, candidateRepositories, pyramid, rollbackRef} = {}) {
  assert(typeof projectId === "string" && /^[A-Za-z][A-Za-z0-9._:-]*$/u.test(projectId), "pyramid import output project ID is required");
  requireRecord(sourceIdentity, "pyramid import output source identity");
  const legacy = {
    source_root_ref: sourceIdentity.source_root_ref,
    source_commit: sourceIdentity.source_commit ?? null,
    source_tree: sourceIdentity.source_tree ?? null,
    source_content_sha256: sourceIdentity.source_content_sha256,
    source_observation_sha256: sourceIdentity.source_observation_sha256,
    preservation_ref: preservationRef,
    preservation_receipt_sha256: preservationReceiptSha256,
    immutable: true,
    untouched: true,
    read_only: true,
    retention: "LEGACY_REPOSITORY_UNTOUCHED",
  };
  validatePyramidImportLegacy(legacy);
  assert(Array.isArray(candidateRepositories) && candidateRepositories.length > 0, "pyramid import output candidate repositories are required");
  const repositories = [...candidateRepositories].sort((left, right) => compareUtf8(left.repository_id, right.repository_id));
  assert(new Set(repositories.map((repository) => repository.repository_id)).size === repositories.length, "pyramid import output candidate repository IDs are duplicated");
  repositories.forEach((repository, index) => validatePyramidImportRepository(repository, index, legacy));
  validatePyramidImportPyramid(pyramid);
  requireReference(rollbackRef, "pyramid import output rollback");
  const repositoryIds = repositories.map((repository) => repository.repository_id);
  const gitRepoint = {
    status: "READY_FOR_PROTECTED_CUTOVER",
    operation: "ATOMIC_REPOINT_PROJECT_GIT_TO_NEW_REPOSITORIES",
    target_repository_ids: repositoryIds,
    legacy_policy: "RETAIN_LEGACY_REPOSITORIES_UNTOUCHED",
    source_recheck_required: true,
    candidate_recheck_required: true,
    rollback_receipt_required: true,
    legacy_delete_forbidden: true,
    source_mutation_forbidden: true,
    destructive_work_forbidden: true,
    authorization_ref: null,
    rollback_ref: rollbackRef,
    next_action: "WAIT_FOR_GIT_REPOINT_AUTHORIZATION",
  };
  validateGitRepointPolicy(gitRepoint, repositoryIds);
  const output = {
    schema: PYRAMID_IMPORT_OUTPUT_SCHEMA,
    version: 1,
    project_id: projectId,
    status: "READY_FOR_GIT_REPOINT",
    legacy,
    candidate_repositories: repositories,
    pyramid: structuredClone(pyramid),
    git_repoint: gitRepoint,
    output_sha256: null,
  };
  output.output_sha256 = canonicalDigest({...output, output_sha256: null});
  return validatePyramidImportOutput(output);
}

export function validatePyramidImportOutput(output) {
  const keys = ["schema", "version", "project_id", "status", "legacy", "candidate_repositories", "pyramid", "git_repoint", "output_sha256"];
  exactKeys(output, keys, "pyramid import output");
  assert(output.schema === PYRAMID_IMPORT_OUTPUT_SCHEMA && output.version === 1, "pyramid import output identity is invalid");
  assert(typeof output.project_id === "string" && /^[A-Za-z][A-Za-z0-9._:-]*$/u.test(output.project_id), "pyramid import output project ID is invalid");
  assert(PYRAMID_IMPORT_OUTPUT_STATUSES.includes(output.status), "pyramid import output status is invalid");
  validatePyramidImportLegacy(output.legacy);
  assert(Array.isArray(output.candidate_repositories) && output.candidate_repositories.length > 0, "pyramid import output candidate repositories are required");
  const repositories = [...output.candidate_repositories].sort((left, right) => compareUtf8(left.repository_id, right.repository_id));
  assert(JSON.stringify(repositories) === JSON.stringify(output.candidate_repositories), "pyramid import output candidate repositories are not sorted");
  assert(new Set(repositories.map((repository) => repository.repository_id)).size === repositories.length, "pyramid import output candidate repositories are duplicated");
  repositories.forEach((repository, index) => validatePyramidImportRepository(repository, index, output.legacy));
  validatePyramidImportPyramid(output.pyramid);
  validateGitRepointPolicy(output.git_repoint, repositories.map((repository) => repository.repository_id), {allowExecuted: output.status === "GIT_REPOINTED"});
  if (output.status === "READY_FOR_GIT_REPOINT") assert(output.git_repoint.status === "READY_FOR_PROTECTED_CUTOVER", "pyramid import output cannot claim an unverified Git repoint");
  if (output.status === "GIT_REPOINTED") assert(output.git_repoint.status === "EXECUTED", "repointed pyramid output lacks an executed Git repoint receipt");
  requireSha(output.output_sha256, "pyramid import output digest");
  assert(output.output_sha256 === canonicalDigest({...output, output_sha256: null}), "pyramid import output digest mismatch");
  return output;
}

export function compileGitRepointPlan({output, targetProjectRef, authorizationRef = null} = {}) {
  validatePyramidImportOutput(output);
  requireReference(targetProjectRef, "Git repoint target project");
  requireReference(authorizationRef, "Git repoint authorization", {nullable: true});
  const authorized = authorizationRef !== null;
  const body = {
    schema: GIT_REPOINT_PLAN_SCHEMA,
    version: 1,
    output_sha256: output.output_sha256,
    target_project_ref: targetProjectRef,
    target_repository_ids: output.candidate_repositories.map((repository) => repository.repository_id),
    legacy_source_ref: output.legacy.source_root_ref,
    legacy_policy: "RETAIN_LEGACY_REPOSITORIES_UNTOUCHED",
    authorization_ref: authorizationRef,
    status: authorized ? "AUTHORIZED_PENDING_RUNTIME_EXECUTION" : "READY_FOR_PROTECTED_CUTOVER",
    execution_allowed: false,
    source_recheck_required: true,
    candidate_recheck_required: true,
    legacy_delete_forbidden: true,
    source_mutation_forbidden: true,
    destructive_work_forbidden: true,
    rollback_ref: output.git_repoint.rollback_ref,
    next_action: authorized ? "RUNTIME_ATOMIC_GIT_REPOINT" : "WAIT_FOR_GIT_REPOINT_AUTHORIZATION",
    plan_sha256: null,
  };
  body.plan_sha256 = canonicalDigest({...body, plan_sha256: null});
  return validateGitRepointPlan(body);
}

export function validateGitRepointPlan(plan) {
  const keys = [
    "schema", "version", "output_sha256", "target_project_ref", "target_repository_ids", "legacy_source_ref", "legacy_policy",
    "authorization_ref", "status", "execution_allowed", "source_recheck_required", "candidate_recheck_required", "legacy_delete_forbidden",
    "source_mutation_forbidden", "destructive_work_forbidden", "rollback_ref", "next_action", "plan_sha256",
  ];
  exactKeys(plan, keys, "Git repoint plan");
  assert(plan.schema === GIT_REPOINT_PLAN_SCHEMA && plan.version === 1, "Git repoint plan identity is invalid");
  requireSha(plan.output_sha256, "Git repoint output binding");
  requireReference(plan.target_project_ref, "Git repoint target project");
  assert(Array.isArray(plan.target_repository_ids) && plan.target_repository_ids.length > 0, "Git repoint target repositories are required");
  const ids = [...plan.target_repository_ids].sort(compareUtf8);
  assert(JSON.stringify(ids) === JSON.stringify(plan.target_repository_ids), "Git repoint target repositories are not sorted");
  ids.forEach((value, index) => requireRepositoryId(value, `Git repoint target repository ${index}`));
  requireReference(plan.legacy_source_ref, "Git repoint legacy source");
  assert(plan.legacy_policy === "RETAIN_LEGACY_REPOSITORIES_UNTOUCHED", "Git repoint legacy policy is unsafe");
  requireReference(plan.authorization_ref, "Git repoint authorization", {nullable: true});
  assert(GIT_REPOINT_PLAN_STATUSES.includes(plan.status), "Git repoint plan status is invalid");
  assert(plan.execution_allowed === false, "Git repoint plan may not grant execution authority");
  for (const field of ["source_recheck_required", "candidate_recheck_required", "legacy_delete_forbidden", "source_mutation_forbidden", "destructive_work_forbidden"]) assert(plan[field] === true, `Git repoint plan ${field} is weakened`);
  requireReference(plan.rollback_ref, "Git repoint rollback");
  if (plan.status === "READY_FOR_PROTECTED_CUTOVER") assert(plan.authorization_ref === null && plan.next_action === "WAIT_FOR_GIT_REPOINT_AUTHORIZATION", "unapproved Git repoint plan must wait");
  if (plan.status === "AUTHORIZED_PENDING_RUNTIME_EXECUTION") assert(plan.authorization_ref !== null && plan.next_action === "RUNTIME_ATOMIC_GIT_REPOINT", "authorized Git repoint plan is not runtime-bound");
  requireSha(plan.plan_sha256, "Git repoint plan digest");
  assert(plan.plan_sha256 === canonicalDigest({...plan, plan_sha256: null}), "Git repoint plan digest mismatch");
  return plan;
}

export function recommendProjectImportMode(discoveryFacts = []) {
  assert(Array.isArray(discoveryFacts), "project import discovery facts must be an array");
  const ids = discoveryFacts.map((fact) => String(fact?.fact_id ?? "")).sort(compareUtf8);
  const conflict = discoveryFacts.some((fact) => ["CONFLICT", "UNKNOWN"].includes(fact?.status));
  const hasAuthority = ids.some((id) => /authority|design|delivery|deploy|migration|auth/iu.test(id));
  const mode = conflict || hasAuthority ? "NORMALIZE_AND_AUDIT" : "CLEAN_COPY";
  return {
    schema: "agentos.project_import_recommendation.v1",
    status: "CANDIDATE_ONLY",
    recommended_mode: mode,
    reason: conflict ? "DISCOVERY_CONFLICT_REQUIRES_RECONCILIATION_AND_FULL_LANE_AUDIT" : hasAuthority ? "EXISTING_AUTHORITY_OR_OPERATIONAL_SURFACES_REQUIRE_COMPATIBILITY_FIRST_NORMALIZATION" : "EXISTING_PROJECT_CAN_START_WITH_A_SOURCE_PRESERVING_CLEAN_COPY",
    discovery_fact_ids: ids,
    recommendation_sha256: canonicalDigest({recommended_mode: mode, reason: conflict ? "DISCOVERY_CONFLICT_REQUIRES_RECONCILIATION_AND_FULL_LANE_AUDIT" : hasAuthority ? "EXISTING_AUTHORITY_OR_OPERATIONAL_SURFACES_REQUIRE_COMPATIBILITY_FIRST_NORMALIZATION" : "EXISTING_PROJECT_CAN_START_WITH_A_SOURCE_PRESERVING_CLEAN_COPY", discovery_fact_ids: ids}),
  };
}

export function compileProjectImportPlan({projectId, mode, sourceRoot, destinationRoot = null, discoveryFacts = [], standardsRegistry, normalizationPolicy, sourcePreservationRoot = null, preservationBoundaryRoot = null, preservationStorageMode = null, rapidDevelopmentApproved = false, rapidDevelopmentApproval = null} = {}) {
  assert(typeof projectId === "string" && /^[A-Za-z][A-Za-z0-9._:-]*$/u.test(projectId), "project import project ID is required", "PROJECT_BINDING_REQUIRED");
  if (rapidDevelopmentApproved) assert(rapidDevelopmentApproval !== null && typeof rapidDevelopmentApproval === "object", "imported rapid development requires a typed owner approval receipt", "OWNER_APPROVAL_REQUIRED");
  if (!rapidDevelopmentApproved) assert(rapidDevelopmentApproval === null, "unactivated imported owner approval cannot be retained", "IMPORTED_OWNER_APPROVAL_INVALID");
  assertUniversalDevelopmentMode("IMPORT");
  assert(PROJECT_IMPORT_MODES.includes(mode), "project import mode is invalid or missing");
  requireRecord(standardsRegistry, "project import standards registry");
  validateStandardsRegistry(standardsRegistry);
  requireRecord(normalizationPolicy, "project import normalization policy");
  validateNormalizationPolicy(normalizationPolicy);
  assert(normalizationPolicy.import_mode === mode, "normalization policy is bound to a different import mode");
  assert(Array.isArray(discoveryFacts), "project import discovery facts must be an array");
  const roots = sourceDestination(sourceRoot, destinationRoot, {allowNullDestination: mode === "ADOPT_IN_PLACE"});
  const sourceIdentity = inspectProjectSource(roots.source);
  const fullAudit = ["NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(mode);
  const storageMode = preservationStorageMode ?? (preservationBoundaryRoot === null ? "PROJECT_SIDE_CAR" : "EXTERNAL_CONTROL_PLANE");
  assert(PROJECT_IMPORT_STORAGE_MODES.includes(storageMode), "project source preservation storage mode is invalid");
  let preservationRoot = sourcePreservationRoot ?? (roots.destination === null
    ? (preservationBoundaryRoot === null ? null : path.join(preservationBoundaryRoot, ".agentos", "import"))
    : path.join(roots.destination, ".agentos", "import"));
  const boundaryRoot = preservationBoundaryRoot === null
    ? null
    : canonicalDestination(preservationBoundaryRoot, "project source preservation boundary");
  if (preservationRoot !== null) {
    assert(path.isAbsolute(preservationRoot), "project source preservation root must be absolute");
    const resolvedPreservationRoot = canonicalDestination(preservationRoot, "project source preservation root");
    const reservedInSource = path.join(roots.source, RESERVED_PRESERVATION_ROOT);
    const insideImportedSource = isInside(roots.source, resolvedPreservationRoot);
    assert(!insideImportedSource || (mode === "ADOPT_IN_PLACE" && isInside(reservedInSource, resolvedPreservationRoot)), "project source preservation root cannot be inside the imported source");
    if (storageMode === "EXTERNAL_CONTROL_PLANE") {
      assert(boundaryRoot !== null && isInside(boundaryRoot, resolvedPreservationRoot), "project source preservation root must remain inside the external control plane");
      assert(!pathsOverlap(roots.source, boundaryRoot), "external control plane overlaps the project import source");
    } else if (roots.destination !== null) {
      assert(isInside(roots.destination, resolvedPreservationRoot), "project source preservation root must remain inside the destination project");
    }
    preservationRoot = resolvedPreservationRoot;
  }
  const body = {
    schema: PROJECT_IMPORT_SCHEMA,
    version: 1,
    governance_version: "2.1rc",
    status: "PLANNED",
    project_id: projectId,
    mode,
    source_root_ref: sourceIdentity.source_root_ref,
    destination_root_ref: roots.destination === null ? null : opaqueSchedulerWorktreeRef(roots.destination),
    source_remains_unchanged_until_cutover: true,
    source_sidecar_exception: storageMode === "EXTERNAL_CONTROL_PLANE"
      ? "EXTERNAL_CONTROL_PLANE_WRITES_DETERMINISTIC_SOURCE_PRESERVATION_ARTIFACTS_OUTSIDE_PROJECT_ROOT;_PRODUCT_SOURCE_FILES_REMAIN_UNCHANGED"
      : "ADOPT_IN_PLACE_MAY_WRITE_ONLY_THE_DETERMINISTIC_SOURCE_PRESERVATION_ARTIFACTS_TO_THE_RESERVED_AGENTOS_IMPORT_ROOT;_PRODUCT_SOURCE_FILES_REMAIN_UNCHANGED",
    source_identity: sourceIdentity,
    rapid_development: {
      mode: "OPT_IN",
      owner_approval_required: true,
      owner_approved: Boolean(rapidDevelopmentApproved),
      owner_approval: rapidDevelopmentApproval,
      owner_approval_sha256: rapidDevelopmentApproval?.approval_sha256 ?? null,
      initial_stage: rapidDevelopmentApproved ? "CONTROLLER_PROJECT_DISCOVERY_AND_CAMPAIGN_PLANNING" : "IMPORT_APPROVAL_REQUIRED",
      workflow: "agentos.rapid_prototype_workflow.v1",
      rule: "IMPORTED_PROJECT_REMAINS_DISCOVERY_ONLY_UNTIL_EXPLICIT_OWNER_APPROVAL_FOR_RAPID_DEVELOPMENT",
    },
    preservation: {
      required_before_build: true,
      storage_mode: storageMode,
      boundary_root_ref: boundaryRoot === null ? null : opaqueSchedulerWorktreeRef(boundaryRoot),
      root_ref: preservationRoot === null ? null : opaqueSchedulerWorktreeRef(preservationRoot),
      artifacts: ["source-preservation.zip", "source-preservation.manifest.json", "source-preservation.index.jsonl", "source-preservation.receipt.json", "import-exclusions.md"],
      secret_handling: "EXCLUDE_AND_RECORD;_NEVER_COPY_SECRETS_OR_CREDENTIALS",
      unsafe_object_handling: "REJECT_SYMLINKS_DEVICES_SOCKETS_AND_UNSAFE_FILESYSTEM_OBJECTS",
      source_untouched_proof: "RECOMPARE_SOURCE_CONTENT_AND_OBSERVATION_DIGESTS_BEFORE_EACH_PUBLISH",
    },
    standards_registry_sha256: standardsRegistry.registry_sha256,
    normalization_sha256: normalizationPolicy.normalization_sha256,
    discovery_fact_ids: discoveryFacts.map((fact) => fact?.fact_id).filter((id) => typeof id === "string").sort(compareUtf8),
    phases: phaseNames(mode),
    controller_planning: {
      authority: "AGENTOS_CONTROLLER",
      compiler: "control/controller-import-planner.mjs",
      contract: "schemas/controller-import-planning.v1.json",
      status: "AWAITING_SOURCE_BOUND_PROJECT_CONTEXT",
      required_inputs: ["ENVIRONMENT_INVENTORY", "FEATURE_INVENTORY", "HARDWARE_PROFILE", "OWNER_BOUND_PROJECT_CONTRACT", "PROJECT_ARCHITECTURE", "SOURCE_IDENTITY", "STANDARD_APPLICABILITY"],
      outputs: ["ACCEPTANCE_MATRIX", "CAMPAIGN_ROADMAP", "PLATFORM_OWNERSHIP_MAP", "PROJECT_ARCHITECTURE_GRAPH", "REPLAN_STATE", "RESOURCE_PLAN", "SIX_LANE_WAVE_SCHEDULE", "SPECIALIST_APPLICABILITY_ROSTER"],
      fixed_project_roster_forbidden: true,
      maximum_parallel_lanes: 6,
      routine_transition: "AUTOMATIC_EVENT_DRIVEN",
      owner_review: "PROTECTED_BOUNDARIES_ONLY",
      spawner_boundary: "CONTROLLER_REQUESTS_ROLES;_SPAWNER_QA_COMPILES_SEEDS;_SPAWNER_DOES_NOT_SET_PROJECT_PRIORITY",
      seed_rule: "SEEDS_NEVER_WORK",
    },
    audit: {
      full_audit_required: fullAudit,
      lanes: auditSchedule(mode),
      lanes_are_minimum_coverage_not_roster: true,
      roster_source: "CONTROLLER_DERIVED_FROM_PROJECT_ARCHITECTURE_GOALS_FEATURES_ENVIRONMENTS_HARDWARE_STANDARDS_AND_EVIDENCE",
      fixed_roster_forbidden: true,
      maximum_parallel_lanes: 6,
      scheduler: "control/campaign-cascade.mjs",
      governed_scheduler: "control/hybrid-scheduler.mjs",
      acceptance: "CONTROLLER_DERIVED_SPECIALIST_AUDIT_REPAIR_THEN_PLATFORM_REVIEW_TEST_INTEGRATION_THEN_CENTRAL_INTEGRATION_THEN_INDEPENDENT_REAUDIT",
      pyramid_cycle: "SPECIALIST_AUDIT_REPAIR_TO_PLATFORM_TO_CENTRAL_TO_INDEPENDENT_REAUDIT",
      platform_review_after_every_wave: true,
      central_integration_after_every_wave: true,
      independent_reaudit_after_every_wave: true,
      writer_rule: "AUDITORS_READ_ONLY;_ONE_MIGRATION_WRITER_CUSTODY_AT_A_TIME",
    },
    pyramid_output: {
      contract: "agentos.pyramid_import_output.v1",
      compiler: "control/project-import.mjs",
      output_kind: mode === "ADOPT_IN_PLACE" ? "EXISTING_REPOSITORY_BINDING" : "NEW_PROJECT_REPOSITORIES",
      source_lineage: "EVERY_CANDIDATE_REPOSITORY_BINDS_TO_THE_EXACT_PRESERVED_SOURCE_CONTENT_AND_OBSERVATION",
      required_stages: mode === "ADOPT_IN_PLACE"
        ? ["SOURCE_PRESERVATION", "GOVERNANCE_BINDING", "REVIEWABLE_EXISTING_REPOSITORY"]
        : ["SPECIALIST_AUDIT_REPAIR", "PLATFORM_REVIEW_TEST_INTEGRATION", "CENTRAL_INTEGRATION", "INDEPENDENT_REAUDIT", "MATERIALIZE_NEW_PROJECT_REPOSITORIES"],
      candidate_repository_rule: "PYRAMID_OUTPUT_IS_ONE_OR_MORE_CLEAN_NEW_PROJECT_REPOSITORIES_WITH_EXACT_COMMIT_TREE_AND_ROLLBACK_IDENTITY",
      legacy_policy: "PRESERVE_OLD_REPOSITORIES_UNTOUCHED_AS_LEGACY_READ_ONLY_EVIDENCE",
      git_repoint_contract: "agentos.git_repoint_plan.v1",
      git_repoint_executor: "RUNTIME_ONLY_ATOMIC_REPOINT_AFTER_SOURCE_AND_CANDIDATE_RECHECK",
      git_repoint_default: "READY_FOR_PROTECTED_CUTOVER",
      legacy_delete_forbidden: true,
      source_mutation_forbidden: true,
    },
    universal_closeout: universalTaskCloseoutPolicy("IMPORT"),
    normalization: {
      execute_in_first_governed_campaign: fullAudit,
      rename_rule: "PRESERVE_EXTERNAL;_ALIAS_THEN_MIGRATE_WHEN_SAFE;_RENAME_INTERNAL_ONLY_AFTER_REFERENCE_SCAN",
      exclusion_record: "import-exclusions.md",
    },
    cutover: {
      status: "NOT_AUTHORIZED",
      requires_owner_authority_for_external_identity_or_destructive_change: true,
      requires_exact_source_destination_and_candidate_identity: true,
      requires_independent_audit_for_full_modes: fullAudit,
      never_rewrites_source_in_place: true,
      target: mode === "ADOPT_IN_PLACE" ? "EXISTING_REPOSITORY_BINDING" : "NEW_PROJECT_REPOSITORIES",
      git_repoint: mode === "ADOPT_IN_PLACE" ? "NOT_APPLICABLE" : "RUNTIME_ONLY_ATOMIC_REPOINT",
      legacy_repository_policy: "RETAIN_OLD_REPOSITORIES_UNTOUCHED",
      legacy_delete_forbidden: true,
      source_mutation_forbidden: true,
      rollback_contract: "agentos.git_repoint_plan.v1",
    },
    rollback: {
      required: mode !== "ADOPT_IN_PLACE",
      rule: "RETAIN_SOURCE_AND_PRESERVATION_RECEIPT;_CUTOVER_IS_REVERTIBLE_TO_EXACT_SOURCE_OR_LAST_ACCEPTED_DESTINATION",
      trigger: "MATERIAL_FUNCTION_DESIGN_SECURITY_OR_COMPATIBILITY_FAILURE",
    },
  };
  const plan = {...body, plan_sha256: canonicalDigest(body)};
  validateProjectImportPlan(plan);
  return plan;
}

export function validateProjectImportPlan(plan) {
  assert(!Object.hasOwn(plan, "destination_root"), "project import plan cannot persist a raw destination root", "PROJECT_IMPORT_PRIVATE_PATH");
  assert(!Object.hasOwn(plan.preservation ?? {}, "root") && !Object.hasOwn(plan.preservation ?? {}, "boundary_root"), "project import plan cannot persist raw preservation roots", "PROJECT_IMPORT_PRIVATE_PATH");
  assert(typeof plan.project_id === "string" && /^[A-Za-z][A-Za-z0-9._:-]*$/u.test(plan.project_id), "project import project ID is invalid", "PROJECT_BINDING_REQUIRED");
  if (plan.rapid_development?.owner_approved) {
    const approval = plan.rapid_development.owner_approval;
    validateTypedImportedApproval(approval, {projectId: plan.project_id, sourceBinding: plan.source_identity});
    assert(plan.rapid_development.owner_approval_sha256 === approval.approval_sha256, "project import owner approval digest is not bound to the embedded receipt", "IMPORTED_OWNER_APPROVAL_INVALID");
    const sourceContentSha256 = plan.source_identity?.source_content_sha256 ?? plan.source_identity?.content_sha256;
    const sourceObservationSha256 = plan.source_identity?.source_observation_sha256 ?? plan.source_identity?.observation_sha256;
    assert(approval.import_mode === plan.mode, "project import owner approval mode is stale", "IMPORTED_OWNER_APPROVAL_SOURCE_MISMATCH");
    assert(typeof sourceContentSha256 === "string" && approval.source_content_sha256 === sourceContentSha256, "project import owner approval content binding is stale", "IMPORTED_OWNER_APPROVAL_SOURCE_MISMATCH");
    assert(typeof sourceObservationSha256 === "string" && approval.source_observation_sha256 === sourceObservationSha256, "project import owner approval observation binding is stale", "IMPORTED_OWNER_APPROVAL_SOURCE_MISMATCH");
    assert(typeof plan.source_identity?.source_commit === "string" && approval.source_commit === plan.source_identity.source_commit, "project import owner approval commit binding is unavailable or stale", "IMPORTED_OWNER_APPROVAL_SOURCE_MISMATCH");
    assert(typeof plan.source_identity?.source_tree === "string" && approval.source_tree === plan.source_identity.source_tree, "project import owner approval tree binding is unavailable or stale", "IMPORTED_OWNER_APPROVAL_SOURCE_MISMATCH");
  }
  if (!plan.rapid_development?.owner_approved) assert(plan.rapid_development?.owner_approval === null, "project import cannot retain an unactivated owner approval", "IMPORTED_OWNER_APPROVAL_INVALID");
  assertUniversalDevelopmentMode("IMPORT");
  requireRecord(plan, "project import plan");
  assert(plan.schema === PROJECT_IMPORT_SCHEMA && plan.version === 1 && plan.governance_version === "2.1rc", "project import plan identity is invalid");
  assert(PROJECT_IMPORT_STATUSES.includes(plan.status), "project import plan status is invalid");
  assert(PROJECT_IMPORT_MODES.includes(plan.mode), "project import plan mode is invalid");
  assert(typeof plan.source_root_ref === "string" && /^opaque:worktree:[0-9a-f]{64}$/u.test(plan.source_root_ref), "project import source root reference is invalid", "PROJECT_SOURCE_REFERENCE_REQUIRED");
  assert(plan.destination_root_ref === null || (typeof plan.destination_root_ref === "string" && /^opaque:worktree:[0-9a-f]{64}$/u.test(plan.destination_root_ref)), "project import destination root reference is invalid");
  assert(plan.source_remains_unchanged_until_cutover === true, "project import plan permits source mutation before cutover");
  assert(plan.source_sidecar_exception.includes("DETERMINISTIC_SOURCE_PRESERVATION_ARTIFACTS")
    && plan.source_sidecar_exception.includes("PRODUCT_SOURCE_FILES_REMAIN_UNCHANGED"), "project import source sidecar boundary is weakened");
  requireRecord(plan.source_identity, "project import source identity");
  assert(typeof plan.source_identity.source_root_ref === "string" && /^opaque:worktree:[0-9a-f]{64}$/u.test(plan.source_identity.source_root_ref), "project import source identity reference is invalid", "PROJECT_SOURCE_REFERENCE_REQUIRED");
  requireSha(plan.source_identity.source_content_sha256, "project import source content identity");
  requireSha(plan.source_identity.source_observation_sha256, "project import source observation identity");
  assert(plan.source_identity.source_root_ref === plan.source_root_ref, "project import source identity is bound to a different source reference");
  requireRecord(plan.rapid_development, "project import rapid development policy");
  assert(plan.rapid_development.mode === "OPT_IN" && plan.rapid_development.owner_approval_required === true, "project import rapid development must remain owner opt-in");
  assert(typeof plan.rapid_development.owner_approved === "boolean", "project import rapid development approval is invalid");
  assert(plan.rapid_development.initial_stage === (plan.rapid_development.owner_approved ? "CONTROLLER_PROJECT_DISCOVERY_AND_CAMPAIGN_PLANNING" : "IMPORT_APPROVAL_REQUIRED"), "project import rapid development stage is inconsistent with approval");
  assert(plan.rapid_development.workflow === "agentos.rapid_prototype_workflow.v1", "project import rapid development workflow is invalid");
  assert(plan.rapid_development.rule.includes("EXPLICIT_OWNER_APPROVAL"), "project import rapid development approval rule is weakened");
  requireRecord(plan.preservation, "project import preservation");
  assert(plan.preservation.required_before_build === true && Array.isArray(plan.preservation.artifacts)
    && JSON.stringify(plan.preservation.artifacts) === JSON.stringify(["source-preservation.zip", "source-preservation.manifest.json", "source-preservation.index.jsonl", "source-preservation.receipt.json", "import-exclusions.md"]), "project import preservation gate is incomplete");
  assert(PROJECT_IMPORT_STORAGE_MODES.includes(plan.preservation.storage_mode), "project import preservation storage mode is invalid");
  assert(plan.preservation.boundary_root_ref === null || (typeof plan.preservation.boundary_root_ref === "string" && /^opaque:worktree:[0-9a-f]{64}$/u.test(plan.preservation.boundary_root_ref)), "project import preservation boundary reference is invalid");
  assert(plan.preservation.root_ref === null || (typeof plan.preservation.root_ref === "string" && /^opaque:worktree:[0-9a-f]{64}$/u.test(plan.preservation.root_ref)), "project import preservation root reference is invalid");
  requireSha(plan.standards_registry_sha256, "project import standards binding");
  requireSha(plan.normalization_sha256, "project import normalization binding");
  assert(Array.isArray(plan.phases) && JSON.stringify(plan.phases) === JSON.stringify(phaseNames(plan.mode)), "project import phase plan does not match its mode");
  requireRecord(plan.controller_planning, "project import Controller planning policy");
  assert(plan.controller_planning.authority === "AGENTOS_CONTROLLER" && plan.controller_planning.compiler === "control/controller-import-planner.mjs" && plan.controller_planning.contract === "schemas/controller-import-planning.v1.json", "project import Controller planning authority is invalid");
  assert(plan.controller_planning.status === "AWAITING_SOURCE_BOUND_PROJECT_CONTEXT" && plan.controller_planning.fixed_project_roster_forbidden === true, "project import embeds or prematurely compiles a project roster");
  assert(plan.controller_planning.maximum_parallel_lanes === 6 && plan.controller_planning.routine_transition === "AUTOMATIC_EVENT_DRIVEN" && plan.controller_planning.owner_review === "PROTECTED_BOUNDARIES_ONLY", "project import Controller continuation policy is invalid");
  assert(plan.controller_planning.spawner_boundary.includes("SPAWNER_QA_COMPILES_SEEDS") && plan.controller_planning.seed_rule === "SEEDS_NEVER_WORK", "project import Controller/Spawner custody is invalid");
  assert(Array.isArray(plan.audit?.lanes) && plan.audit.lanes.length === IMPORT_AUDIT_LANES.length, "project import audit schedule is incomplete");
  const fullAudit = ["NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(plan.mode);
  assert(plan.audit.full_audit_required === fullAudit, "project import full-audit converse is invalid");
  assert(plan.audit.lanes_are_minimum_coverage_not_roster === true && plan.audit.fixed_roster_forbidden === true && plan.audit.maximum_parallel_lanes === 6, "project import incorrectly treats minimum disciplines as a fixed roster");
  assert(plan.audit.roster_source.includes("PROJECT_ARCHITECTURE_GOALS_FEATURES_ENVIRONMENTS_HARDWARE_STANDARDS_AND_EVIDENCE"), "project import roster is not project-derived");
  const seen = new Set();
  for (const lane of plan.audit.lanes) {
    assert(IMPORT_AUDIT_LANES.includes(lane.discipline) && !seen.has(lane.discipline), "project import audit lane is duplicate or unknown");
    seen.add(lane.discipline);
    assert(["REQUIRED", "DETERMINISTIC_ONLY"].includes(lane.disposition), "project import audit disposition is invalid");
    assert(lane.writer === "NONE_READ_ONLY", "project import audit lane has write custody");
    assert(lane.disposition === (fullAudit ? "REQUIRED" : "DETERMINISTIC_ONLY"), "project import audit disposition does not match its mode");
    assert(lane.schedule === (fullAudit ? "PARALLEL_READ_ONLY_AT_SUBSTANTIAL_CHECKPOINTS" : "BASELINE_ONLY_UNTIL_CAMPAIGN_ADMISSION"), "project import audit schedule does not match its mode");
  }
  assert(plan.audit.scheduler === "control/campaign-cascade.mjs", "project import created a competing audit scheduler");
  assert(plan.audit.governed_scheduler === "control/hybrid-scheduler.mjs", "project import resource-governed work is not bound to the shared hybrid scheduler");
  assert(JSON.stringify(plan.universal_closeout) === JSON.stringify(universalTaskCloseoutPolicy("IMPORT")),
    "project import universal closeout policy differs from general governance");
  assert(plan.audit.acceptance.includes("PLATFORM_REVIEW_TEST_INTEGRATION_THEN_CENTRAL_INTEGRATION_THEN_INDEPENDENT_REAUDIT"), "project import acceptance pyramid is invalid");
  assert(plan.audit.platform_review_after_every_wave === true && plan.audit.central_integration_after_every_wave === true && plan.audit.independent_reaudit_after_every_wave === true, "project import pyramid does not re-integrate and re-audit every wave");
  requireRecord(plan.pyramid_output, "project import pyramid output policy");
  assert(plan.pyramid_output.contract === "agentos.pyramid_import_output.v1" && plan.pyramid_output.compiler === "control/project-import.mjs", "project import pyramid output contract is invalid");
  const expectedOutputKind = plan.mode === "ADOPT_IN_PLACE" ? "EXISTING_REPOSITORY_BINDING" : "NEW_PROJECT_REPOSITORIES";
  assert(plan.pyramid_output.output_kind === expectedOutputKind, "project import pyramid output kind is inconsistent with mode");
  assert(plan.pyramid_output.source_lineage.includes("EXACT_PRESERVED_SOURCE_CONTENT_AND_OBSERVATION"), "project import pyramid output source lineage is weakened");
  assert(plan.pyramid_output.legacy_policy === "PRESERVE_OLD_REPOSITORIES_UNTOUCHED_AS_LEGACY_READ_ONLY_EVIDENCE", "project import pyramid output legacy policy is unsafe");
  assert(plan.pyramid_output.git_repoint_contract === "agentos.git_repoint_plan.v1" && plan.pyramid_output.git_repoint_executor === "RUNTIME_ONLY_ATOMIC_REPOINT_AFTER_SOURCE_AND_CANDIDATE_RECHECK", "project import Git repoint executor is invalid");
  assert(plan.pyramid_output.legacy_delete_forbidden === true && plan.pyramid_output.source_mutation_forbidden === true, "project import pyramid output protection is weakened");
  assert(plan.cutover.status === "NOT_AUTHORIZED" && plan.cutover.never_rewrites_source_in_place === true, "project import cutover boundary is weakened");
  assert(plan.cutover.target === expectedOutputKind, "project import cutover target is stale");
  assert(plan.cutover.legacy_repository_policy === "RETAIN_OLD_REPOSITORIES_UNTOUCHED" && plan.cutover.legacy_delete_forbidden === true && plan.cutover.source_mutation_forbidden === true, "project import cutover legacy policy is unsafe");
  assert(plan.cutover.rollback_contract === "agentos.git_repoint_plan.v1", "project import cutover rollback contract is invalid");
  assert(plan.normalization.execute_in_first_governed_campaign === fullAudit, "project import normalization phase is not bound to its mode");
  assert(plan.rollback.required === (plan.mode !== "ADOPT_IN_PLACE"), "project import rollback requirement is invalid");
  assert(plan.rollback.rule.includes("RETAIN_SOURCE") && plan.rollback.rule.includes("RECEIPT"), "project import rollback does not retain source evidence");
  const body = structuredClone(plan);
  delete body.plan_sha256;
  requireSha(plan.plan_sha256, "project import plan digest");
  assert(plan.plan_sha256 === canonicalDigest(body), "project import plan is not content-addressed");
  return plan;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("project import controller loaded\n");
import {validateTypedImportedApproval} from "./audit-driven-integration-pyramid.mjs";
