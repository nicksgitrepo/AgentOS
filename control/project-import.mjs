#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {buildStoredZip, parseStoredZip} from "./deterministic-zip.mjs";
import {AUDIT_DISCIPLINES} from "./campaign-cascade.mjs";
import {validateNormalizationPolicy} from "./normalization-policy.mjs";
import {validateStandardsRegistry} from "./standards-registry.mjs";

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

const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
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

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
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
    source_root: source,
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
  return {
    source_root: source,
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
  const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o444);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function moveExclusive(source, target) {
  fs.linkSync(source, target);
  fs.unlinkSync(source);
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
  fs.mkdirSync(plan.destination_root, {recursive: true});
  const temporary = fs.mkdtempSync(path.join(plan.destination_root, ".agentos-source-preservation-"));
  try {
    for (const [name, bytes] of [
      ["source-preservation.zip", plan.archive_bytes],
      ["source-preservation.manifest.json", plan.manifest_bytes],
      ["source-preservation.index.jsonl", plan.index_bytes],
      ["import-exclusions.md", plan.exclusions_bytes],
      ["source-preservation.receipt.json", Buffer.from(canonicalJson(receipt), "utf8")],
    ]) writeExclusive(path.join(temporary, name), bytes);
    verifySourcePreservation(temporary);
    const finalCheck = compileSourcePreservationPlan(plan.source_root, plan.destination_root, {allowDestinationInsideSource});
    assert(finalCheck.manifest.source_content_sha256 === plan.manifest.source_content_sha256
      && finalCheck.manifest.source_observation.observation_sha256 === plan.manifest.source_observation.observation_sha256, "source changed during preservation publish");
    for (const name of ["source-preservation.zip", "source-preservation.manifest.json", "source-preservation.index.jsonl", "import-exclusions.md", "source-preservation.receipt.json"]) moveExclusive(path.join(temporary, name), path.join(plan.destination_root, name));
    fs.rmdirSync(temporary);
    return {receipt, verification: verifySourcePreservation(plan.destination_root)};
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, {recursive: true, force: true});
  }
}

function phaseNames(mode) {
  if (mode === "ADOPT_IN_PLACE") return ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", "BIND_GOVERNANCE", "CUTOVER_OR_CONTINUE"];
  if (mode === "CLEAN_COPY") return ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", "COPY_ALLOWED_SOURCE", "BIND_GOVERNANCE", "CUTOVER_OR_ROLLBACK"];
  if (mode === "NORMALIZE_AND_AUDIT") return ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", "COPY_ALLOWED_SOURCE", "NORMALIZE_STRUCTURE_AND_NAMES", "FOUR_LANE_AUDIT", "REPAIR_GROUPED_FINDINGS", "CUTOVER_OR_ROLLBACK"];
  return ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", "RECONSTRUCT_FROM_ACCEPTED_INTENT", "FOUR_LANE_AUDIT", "REPAIR_GROUPED_FINDINGS", "CUTOVER_OR_ROLLBACK"];
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

export function compileProjectImportPlan({mode, sourceRoot, destinationRoot = null, discoveryFacts = [], standardsRegistry, normalizationPolicy, sourcePreservationRoot = null, preservationBoundaryRoot = null, preservationStorageMode = null} = {}) {
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
    mode,
    source_root: roots.source,
    destination_root: roots.destination,
    source_remains_unchanged_until_cutover: true,
    source_sidecar_exception: storageMode === "EXTERNAL_CONTROL_PLANE"
      ? "EXTERNAL_CONTROL_PLANE_WRITES_DETERMINISTIC_SOURCE_PRESERVATION_ARTIFACTS_OUTSIDE_PROJECT_ROOT;_PRODUCT_SOURCE_FILES_REMAIN_UNCHANGED"
      : "ADOPT_IN_PLACE_MAY_WRITE_ONLY_THE_DETERMINISTIC_SOURCE_PRESERVATION_ARTIFACTS_TO_THE_RESERVED_AGENTOS_IMPORT_ROOT;_PRODUCT_SOURCE_FILES_REMAIN_UNCHANGED",
    source_identity: sourceIdentity,
    preservation: {
      required_before_build: true,
      storage_mode: storageMode,
      boundary_root: boundaryRoot,
      root: preservationRoot,
      artifacts: ["source-preservation.zip", "source-preservation.manifest.json", "source-preservation.index.jsonl", "source-preservation.receipt.json", "import-exclusions.md"],
      secret_handling: "EXCLUDE_AND_RECORD;_NEVER_COPY_SECRETS_OR_CREDENTIALS",
      unsafe_object_handling: "REJECT_SYMLINKS_DEVICES_SOCKETS_AND_UNSAFE_FILESYSTEM_OBJECTS",
      source_untouched_proof: "RECOMPARE_SOURCE_CONTENT_AND_OBSERVATION_DIGESTS_BEFORE_EACH_PUBLISH",
    },
    standards_registry_sha256: standardsRegistry.registry_sha256,
    normalization_sha256: normalizationPolicy.normalization_sha256,
    discovery_fact_ids: discoveryFacts.map((fact) => fact?.fact_id).filter((id) => typeof id === "string").sort(compareUtf8),
    phases: phaseNames(mode),
    audit: {
      full_audit_required: fullAudit,
      lanes: auditSchedule(mode),
      scheduler: "control/campaign-cascade.mjs",
      acceptance: "FUNCTION_REQUIREMENTS_PASS_THEN_DESIGN_BIBLE_PASS_THEN_SECURITY_PASS;_CODE_QUALITY_HYGIENE_REMAINS_AUDIT_DISCIPLINE",
      writer_rule: "AUDITORS_READ_ONLY;_ONE_MIGRATION_WRITER_CUSTODY_AT_A_TIME",
    },
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
  requireRecord(plan, "project import plan");
  assert(plan.schema === PROJECT_IMPORT_SCHEMA && plan.version === 1 && plan.governance_version === "2.1rc", "project import plan identity is invalid");
  assert(PROJECT_IMPORT_STATUSES.includes(plan.status), "project import plan status is invalid");
  assert(PROJECT_IMPORT_MODES.includes(plan.mode), "project import plan mode is invalid");
  requireString(plan.source_root, "project import source root");
  assert(plan.destination_root === null || typeof plan.destination_root === "string", "project import destination root is invalid");
  assert(plan.source_remains_unchanged_until_cutover === true, "project import plan permits source mutation before cutover");
  assert(plan.source_sidecar_exception.includes("DETERMINISTIC_SOURCE_PRESERVATION_ARTIFACTS")
    && plan.source_sidecar_exception.includes("PRODUCT_SOURCE_FILES_REMAIN_UNCHANGED"), "project import source sidecar boundary is weakened");
  requireRecord(plan.source_identity, "project import source identity");
  requireSha(plan.source_identity.source_content_sha256, "project import source content identity");
  requireSha(plan.source_identity.source_observation_sha256, "project import source observation identity");
  assert(plan.source_identity.source_root === plan.source_root, "project import source identity is bound to a different source root");
  requireRecord(plan.preservation, "project import preservation");
  assert(plan.preservation.required_before_build === true && Array.isArray(plan.preservation.artifacts)
    && JSON.stringify(plan.preservation.artifacts) === JSON.stringify(["source-preservation.zip", "source-preservation.manifest.json", "source-preservation.index.jsonl", "source-preservation.receipt.json", "import-exclusions.md"]), "project import preservation gate is incomplete");
  assert(PROJECT_IMPORT_STORAGE_MODES.includes(plan.preservation.storage_mode), "project import preservation storage mode is invalid");
  assert(plan.preservation.boundary_root === null || typeof plan.preservation.boundary_root === "string", "project import preservation boundary is invalid");
  if (plan.preservation.root !== null) {
    requireString(plan.preservation.root, "project import preservation root");
    assert(path.isAbsolute(plan.preservation.root), "project import preservation root must be absolute");
    if (plan.preservation.storage_mode === "EXTERNAL_CONTROL_PLANE") {
      assert(plan.preservation.boundary_root !== null && isInside(path.resolve(plan.preservation.boundary_root), path.resolve(plan.preservation.root)), "external project preservation escapes its control plane");
    } else if (plan.destination_root !== null) {
      assert(isInside(path.resolve(plan.destination_root), path.resolve(plan.preservation.root)), "project source preservation root must remain inside the destination project");
    }
  }
  requireSha(plan.standards_registry_sha256, "project import standards binding");
  requireSha(plan.normalization_sha256, "project import normalization binding");
  assert(Array.isArray(plan.phases) && JSON.stringify(plan.phases) === JSON.stringify(phaseNames(plan.mode)), "project import phase plan does not match its mode");
  assert(Array.isArray(plan.audit?.lanes) && plan.audit.lanes.length === IMPORT_AUDIT_LANES.length, "project import audit schedule is incomplete");
  const fullAudit = ["NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(plan.mode);
  assert(plan.audit.full_audit_required === fullAudit, "project import full-audit converse is invalid");
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
  assert(plan.audit.acceptance.includes("FUNCTION_REQUIREMENTS_PASS_THEN_DESIGN_BIBLE_PASS_THEN_SECURITY_PASS"), "project import acceptance order is invalid");
  assert(plan.cutover.status === "NOT_AUTHORIZED" && plan.cutover.never_rewrites_source_in_place === true, "project import cutover boundary is weakened");
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
