#!/usr/bin/env node

/*
 * Portable release lifecycle primitives.
 *
 * This module allocates immutable build identities, records exact artifact
 * manifests, and binds owner decisions and promotion evidence to those
 * identities. It never copies, publishes, activates, or writes a release.
 * A real host adapter must provide any promotion receipt.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertPersistedRecordSafe,
  canonicalDigest,
  compareUtf8,
  PRIVACY_CATEGORIES,
  scanPersistedRecord,
} from "./content-addressing.mjs";
import {validateReleaseSafetyBundle} from "./release-safety-gate.mjs";

export const RELEASE_LIFECYCLE_SCHEMA = "agentos.release_lifecycle.v1";
export const VERSION_ALLOCATION_SCHEMA = "agentos.release_version_allocation.v1";
export const ARTIFACT_MANIFEST_SCHEMA = "agentos.release_artifact_manifest.v1";
export const ARTIFACT_IDENTITY_SCHEMA = "agentos.release_artifact_identity.v1";
export const RELEASE_CANDIDATE_SCHEMA = "agentos.release_candidate.v1";
export const OWNER_DECISION_SCHEMA = "agentos.release_owner_decision.v1";
export const REJECTION_FEEDBACK_SCHEMA = "agentos.release_rejection_feedback.v1";
export const PROMOTION_REQUEST_SCHEMA = "agentos.release_promotion_request.v1";
export const PROMOTION_RECEIPT_SCHEMA = "agentos.release_promotion_receipt.v1";

export const RELEASE_CHANNELS = Object.freeze(["STABLE", "RELEASE_CANDIDATE"]);
export const CANDIDATE_STATES = Object.freeze([
  "ASSEMBLED",
  "STERILE_VERIFIED",
  "OWNER_REVIEW_PENDING",
  "OWNER_ACCEPTED",
  "KEEP_PREPARED",
  "OWNER_REJECTED",
  "PROMOTION_PENDING",
  "PROMOTED_PREPARED",
  "BLOCKED",
]);
export const OWNER_DECISIONS = Object.freeze(["APPROVE", "REJECT", "KEEP_PREPARED"]);
export const FEEDBACK_CLASSIFICATIONS = Object.freeze([
  "ARTIFACT_DEFECT",
  "GOVERNANCE_GAP",
  "TEST_FAILURE",
  "DOCUMENTATION",
  "OWNER_INTENT_CHANGE",
  "UNAVAILABLE_EVIDENCE",
]);
export const FEEDBACK_ROUTES = Object.freeze([
  "REPAIR_SAME_CANDIDATE",
  "NEW_TEST_BUILD",
  "NEW_RELEASE_CANDIDATE",
  "OWNER_DECISION",
]);
export const PROMOTION_STATUS = "PROMOTION_PENDING";
export const PROMOTED_PREPARED_STATUS = "PROMOTED_PREPARED";

const SHA256 = /^[0-9a-f]{64}$/u;
const SEMVER = /^(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)(?:-rc\.(?<rc>[1-9][0-9]*))?$/u;
const TEST_BUILD_NUMBER = /^(?:0[1-9]|[1-9][0-9]*)$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SAFE_CHANGE_ID = /^[A-Z][A-Z0-9_.:-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SENSITIVE_FILE_NAME = /(?:^|\/)(?:\.env(?:\.[^/]*)?|.*(?:credential|secret|password|token|private[_-]?key|id_rsa).*|.*\.(?:pem|key|p12|pfx))$/iu;

const ALLOCATION_KEYS = [
  "schema", "version", "release_version", "release_channel", "test_build_number",
  "test_build_tag", "campaign_version", "source", "normative_snapshot_sha256",
  "predecessor_candidate_sha256", "status", "allocated_at_utc", "allocation_sha256",
];
const LEDGER_KEYS = [
  "schema", "version", "release_version", "release_channel", "allocations",
  "next_test_build_number", "ledger_sha256",
];
const SOURCE_KEYS = ["commit_sha256", "tree_sha256"];
const FILE_KEYS = ["path", "size", "mode", "sha256"];
const MANIFEST_KEYS = [
  "schema", "version", "status", "root_binding", "release_version", "test_build_tag",
  "source", "files", "file_count", "artifact_sha256", "manifest_sha256", "privacy",
];
const PRIVACY_KEYS = ["safe", "categories"];
const CANDIDATE_KEYS = [
  "schema", "version", "candidate_id", "release_version", "release_channel",
  "test_build_tag", "source", "normative_snapshot_sha256", "artifact_sha256",
  "manifest_sha256", "candidate_state", "independent_audit_sha256",
  "safety_evidence_sha256", "safety_subject_sha256",
  "owner_decision_sha256", "decision_candidate_sha256", "rejection_feedback_sha256",
  "predecessor_candidate_sha256", "activation", "candidate_sha256",
];
const OWNER_DECISION_KEYS = [
  "schema", "version", "decision_id", "candidate_sha256", "release_version",
  "test_build_tag", "artifact_sha256", "independent_audit_sha256", "decision",
  "actor_digest_sha256", "decided_at_utc", "feedback_sha256", "activation", "decision_sha256",
];
const FEEDBACK_KEYS = [
  "schema", "version", "feedback_id", "candidate_sha256", "release_version",
  "test_build_tag", "artifact_sha256", "classification", "summary", "required_change_ids",
  "route", "status", "created_at_utc", "successor_candidate_sha256", "feedback_sha256",
];
const RELEASE_IDENTITY_KEYS = ["release_version", "artifact_sha256", "manifest_sha256"];
const PROMOTION_REQUEST_KEYS = [
  "schema", "version", "request_id", "candidate_sha256", "owner_decision_sha256",
  "release_version", "target_release_version", "test_build_tag", "artifact_sha256", "manifest_sha256", "target_binding",
  "current_release", "safety_gate_sha256", "safety_subject_sha256", "action", "project_action", "activation", "status", "requested_at_utc",
  "request_sha256",
];
const PROMOTION_RECEIPT_KEYS = [
  "schema", "version", "request_id", "request_sha256", "candidate_sha256", "release_version",
  "target_release_version", "test_build_tag", "artifact_sha256", "manifest_sha256", "target_binding",
  "target_manifest_sha256", "host_receipt_sha256", "previous_release_disposition", "previous_release_sha256",
  "safety_gate_sha256", "status", "project_action", "activation", "promoted_at_utc", "receipt_sha256",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireText(value, label, {max = 4000} = {}) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty text`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(value.length <= max, `${label} is too long`);
}

function requireIdentifier(value, label) {
  requireText(value, label, {max: 160});
  assert(!value.includes("/") && !value.includes("\\"), `${label} contains a path separator`);
  assert(SAFE_IDENTIFIER.test(value), `${label} is not a safe identifier`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256${nullable ? " or null" : ""}`);
}

function requireUtc(value, label) {
  requireText(value, label, {max: 30});
  assert(UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function sortedUnique(values, label, {allowEmpty = false, itemPattern = null} = {}) {
  assert(Array.isArray(values) && (allowEmpty || values.length > 0), `${label} must be ${allowEmpty ? "an array" : "a nonempty array"}`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  if (itemPattern) assert(values.every((value) => itemPattern.test(value)), `${label} contains an invalid identifier`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function digestWithout(value, field) {
  return canonicalDigest({...clone(value), [field]: null});
}

function seal(value, field) {
  const next = clone(value);
  next[field] = digestWithout(next, field);
  return next;
}

function parseSafeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a safe nonnegative integer`);
  return value;
}

export function parseReleaseVersion(value) {
  requireText(value, "release version", {max: 64});
  const match = SEMVER.exec(value);
  assert(match, "release version must be strict SemVer with optional -rc.N");
  const major = Number(match.groups.major);
  const minor = Number(match.groups.minor);
  const patch = Number(match.groups.patch);
  const rcNumber = match.groups.rc === undefined ? null : Number(match.groups.rc);
  for (const [number, label] of [[major, "release major"], [minor, "release minor"], [patch, "release patch"]]) parseSafeInteger(number, label);
  if (rcNumber !== null) parseSafeInteger(rcNumber, "release candidate number");
  return Object.freeze({
    release_version: value,
    release_line: `${major}.${minor}`,
    major,
    minor,
    patch,
    release_channel: rcNumber === null ? "STABLE" : "RELEASE_CANDIDATE",
    rc_number: rcNumber,
  });
}

export function formatTestBuildTag(releaseVersion, testBuildNumber) {
  const parsed = parseReleaseVersion(releaseVersion);
  assert(Number.isSafeInteger(testBuildNumber) && testBuildNumber > 0, "test-build number must be a positive safe integer");
  const suffix = String(testBuildNumber).padStart(2, "0");
  return `v${parsed.release_version}-tb-${suffix}`;
}

export function parseTestBuildTag(value) {
  requireText(value, "test-build tag", {max: 80});
  assert(value.startsWith("v"), "test-build tag must start with v");
  const separator = value.lastIndexOf("-tb-");
  assert(separator > 1, "test-build tag must end with -tb-N");
  const releaseVersion = value.slice(1, separator);
  const numberText = value.slice(separator + 4);
  const release = parseReleaseVersion(releaseVersion);
  assert(TEST_BUILD_NUMBER.test(numberText), "test-build number must be canonical and nonzero");
  const testBuildNumber = Number(numberText);
  parseSafeInteger(testBuildNumber, "test-build number");
  assert(formatTestBuildTag(releaseVersion, testBuildNumber) === value, "test-build tag is not canonical");
  return Object.freeze({
    ...release,
    test_build_tag: value,
    campaign_version: value,
    test_build_number: testBuildNumber,
  });
}

function validateSource(source, label = "source") {
  exactKeys(source, SOURCE_KEYS, label);
  requireSha(source.commit_sha256, `${label}.commit_sha256`);
  requireSha(source.tree_sha256, `${label}.tree_sha256`);
  return source;
}

function validateReleaseIdentity(identity, label = "release identity") {
  if (identity === null) return null;
  exactKeys(identity, RELEASE_IDENTITY_KEYS, label);
  const release = parseReleaseVersion(identity.release_version);
  assert(release.release_channel === "STABLE", `${label}.release_version must be stable`);
  requireSha(identity.artifact_sha256, `${label}.artifact_sha256`);
  requireSha(identity.manifest_sha256, `${label}.manifest_sha256`);
  return identity;
}

function validateStableTargetVersion(candidateReleaseVersion, targetReleaseVersion, label = "stable target version") {
  const candidate = parseReleaseVersion(candidateReleaseVersion);
  const target = parseReleaseVersion(targetReleaseVersion);
  assert(candidate.release_channel === "RELEASE_CANDIDATE", `${label} source must be a release candidate`);
  assert(target.release_channel === "STABLE", `${label} must be stable SemVer`);
  assert(candidate.major === target.major && candidate.minor === target.minor && candidate.patch === target.patch, `${label} must match the candidate core version`);
  return target;
}

export function validateVersionAllocation(allocation) {
  exactKeys(allocation, ALLOCATION_KEYS, "version allocation");
  assert(allocation.schema === VERSION_ALLOCATION_SCHEMA && allocation.version === 1, "version allocation identity is invalid");
  const parsed = parseReleaseVersion(allocation.release_version);
  assert(allocation.release_channel === parsed.release_channel, "version allocation release channel differs");
  assert(Number.isSafeInteger(allocation.test_build_number) && allocation.test_build_number > 0, "version allocation number is invalid");
  const tag = parseTestBuildTag(allocation.test_build_tag);
  assert(tag.release_version === allocation.release_version && tag.test_build_number === allocation.test_build_number, "version allocation tag differs");
  assert(allocation.campaign_version === allocation.test_build_tag, "version allocation campaign version differs");
  validateSource(allocation.source, "version allocation source");
  requireSha(allocation.normative_snapshot_sha256, "version allocation normative snapshot");
  requireSha(allocation.predecessor_candidate_sha256, "version allocation predecessor", {nullable: true});
  assert(allocation.status === "ALLOCATED", "version allocation status is invalid");
  requireUtc(allocation.allocated_at_utc, "version allocation time");
  requireSha(allocation.allocation_sha256, "version allocation digest");
  assert(allocation.allocation_sha256 === digestWithout(allocation, "allocation_sha256"), "version allocation digest does not match content");
  assertPersistedRecordSafe(allocation);
  return allocation;
}

export function compileVersionAllocationLedger({releaseVersion, allocations = []} = {}) {
  const parsed = parseReleaseVersion(releaseVersion);
  assert(Array.isArray(allocations), "version allocations must be an array");
  const ordered = [...allocations].sort((left, right) => left.test_build_number - right.test_build_number);
  ordered.forEach((allocation, index) => {
    validateVersionAllocation(allocation);
    assert(allocation.release_version === releaseVersion, "version allocation ledger mixes release versions");
    assert(allocation.test_build_number === index + 1, "version allocation ledger must retain every consumed number");
  });
  const ledger = {
    schema: VERSION_ALLOCATION_SCHEMA,
    version: 1,
    release_version: releaseVersion,
    release_channel: parsed.release_channel,
    allocations: ordered.map(clone),
    next_test_build_number: ordered.length + 1,
    ledger_sha256: null,
  };
  const sealed = seal(ledger, "ledger_sha256");
  validateVersionAllocationLedger(sealed);
  return sealed;
}

export function validateVersionAllocationLedger(ledger) {
  exactKeys(ledger, LEDGER_KEYS, "version allocation ledger");
  assert(ledger.schema === VERSION_ALLOCATION_SCHEMA && ledger.version === 1, "version allocation ledger identity is invalid");
  const parsed = parseReleaseVersion(ledger.release_version);
  assert(ledger.release_channel === parsed.release_channel, "version allocation ledger channel differs");
  assert(Array.isArray(ledger.allocations), "version allocation ledger allocations are missing");
  let expected = 1;
  for (const allocation of ledger.allocations) {
    validateVersionAllocation(allocation);
    assert(allocation.release_version === ledger.release_version, "version allocation ledger release differs");
    assert(allocation.test_build_number === expected, "version allocation ledger is not monotonic");
    expected += 1;
  }
  assert(ledger.next_test_build_number === expected, "version allocation ledger next number is stale");
  requireSha(ledger.ledger_sha256, "version allocation ledger digest");
  assert(ledger.ledger_sha256 === digestWithout(ledger, "ledger_sha256"), "version allocation ledger digest does not match content");
  assertPersistedRecordSafe(ledger);
  return ledger;
}

export function allocateTestBuild({ledger, source, normativeSnapshotSha256, predecessorCandidateSha256 = null, allocatedAtUtc} = {}) {
  validateVersionAllocationLedger(ledger);
  validateSource(source, "test-build source");
  requireSha(normativeSnapshotSha256, "test-build normative snapshot");
  requireSha(predecessorCandidateSha256, "test-build predecessor", {nullable: true});
  requireUtc(allocatedAtUtc, "test-build allocation time");
  const testBuildNumber = ledger.next_test_build_number;
  const testBuildTag = formatTestBuildTag(ledger.release_version, testBuildNumber);
  const allocation = seal({
    schema: VERSION_ALLOCATION_SCHEMA,
    version: 1,
    release_version: ledger.release_version,
    release_channel: ledger.release_channel,
    test_build_number: testBuildNumber,
    test_build_tag: testBuildTag,
    campaign_version: testBuildTag,
    source: clone(source),
    normative_snapshot_sha256: normativeSnapshotSha256,
    predecessor_candidate_sha256: predecessorCandidateSha256,
    status: "ALLOCATED",
    allocated_at_utc: allocatedAtUtc,
    allocation_sha256: null,
  }, "allocation_sha256");
  validateVersionAllocation(allocation);
  const nextLedger = compileVersionAllocationLedger({releaseVersion: ledger.release_version, allocations: [...ledger.allocations, allocation]});
  return {allocation, ledger: nextLedger};
}

function validateSafeRelativePath(relativePath, label = "artifact path") {
  requireText(relativePath, label, {max: 1000});
  assert(!relativePath.startsWith("/"), `${label} must be relative`);
  assert(!relativePath.includes("\\"), `${label} must use portable separators`);
  const parts = relativePath.split("/");
  assert(parts.every((part) => part.length > 0 && part !== "." && part !== ".."), `${label} contains an unsafe segment`);
  assert(!SENSITIVE_FILE_NAME.test(relativePath), `${label} names a private or secret-like file`);
  assert(scanPersistedRecord({path: relativePath}).safe, `${label} contains private content`);
  return relativePath;
}

function validateFileEntry(file, index) {
  exactKeys(file, FILE_KEYS, `artifact file ${index}`);
  validateSafeRelativePath(file.path, `artifact file ${index} path`);
  assert(Number.isSafeInteger(file.size) && file.size >= 0, `artifact file ${index} size is invalid`);
  assert(Number.isSafeInteger(file.mode) && file.mode >= 0 && file.mode <= 0o7777, `artifact file ${index} mode is invalid`);
  requireSha(file.sha256, `artifact file ${index} digest`);
  return file;
}

function assertArtifactBytesPrivacy(relativePath, bytes) {
  const scan = scanPersistedRecord(bytes.toString("utf8"));
  for (const category of ["ABSOLUTE_PATH", "WORKTREE_PATH", "ENVIRONMENT_VALUE", "SECRET_LIKE_VALUE", "UNSAFE_PRIVATE_LINK"]) {
    assert(scan.categories[category] === 0, `artifact file ${relativePath} contains ${category}`);
  }
}

function artifactDigest(files) {
  return canonicalDigest({files: files.map(({path: filePath, size, mode, sha256}) => ({path: filePath, size, mode, sha256}))});
}

function manifestIdentity(manifest) {
  return {
    schema: manifest.schema,
    version: manifest.version,
    release_version: manifest.release_version,
    test_build_tag: manifest.test_build_tag,
    source: manifest.source,
    files: manifest.files,
    file_count: manifest.file_count,
    artifact_sha256: manifest.artifact_sha256,
  };
}

function privacySummary(value) {
  const scan = scanPersistedRecord(value);
  assert(scan.safe, "release record contains private or secret-like content");
  return {
    safe: true,
    categories: Object.fromEntries(PRIVACY_CATEGORIES.map((category) => [category, scan.categories[category]])),
  };
}

function collectArtifactFiles(rootPath, currentPath = rootPath, parts = []) {
  const entries = fs.readdirSync(currentPath, {withFileTypes: true}).sort((left, right) => compareUtf8(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const nextParts = [...parts, entry.name];
    const relativePath = nextParts.join("/");
    validateSafeRelativePath(relativePath);
    const absolutePath = path.join(currentPath, entry.name);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`artifact contains a symbolic link: ${relativePath}`);
    if (stat.isDirectory()) {
      files.push(...collectArtifactFiles(rootPath, absolutePath, nextParts));
      continue;
    }
    if (!stat.isFile()) throw new Error(`artifact contains a non-regular entry: ${relativePath}`);
    const bytes = fs.readFileSync(absolutePath);
    assertArtifactBytesPrivacy(relativePath, bytes);
    files.push({
      path: relativePath,
      size: bytes.byteLength,
      mode: stat.mode & 0o7777,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return files;
}

export function validateArtifactManifest(manifest) {
  exactKeys(manifest, MANIFEST_KEYS, "artifact manifest");
  assert(manifest.schema === ARTIFACT_MANIFEST_SCHEMA && manifest.version === 1, "artifact manifest identity is invalid");
  assert(manifest.status === "VERIFIED_EXACT", "artifact manifest status is invalid");
  requireIdentifier(manifest.root_binding, "artifact manifest root binding");
  const tag = parseTestBuildTag(manifest.test_build_tag);
  assert(tag.release_version === manifest.release_version, "artifact manifest release version differs from test-build tag");
  validateSource(manifest.source, "artifact manifest source");
  assert(Array.isArray(manifest.files), "artifact manifest files are missing");
  let previousPath = null;
  for (const [index, file] of manifest.files.entries()) {
    validateFileEntry(file, index);
    if (previousPath !== null) assert(compareUtf8(previousPath, file.path) < 0, "artifact manifest paths must be sorted and unique");
    previousPath = file.path;
  }
  assert(manifest.file_count === manifest.files.length, "artifact manifest file count is stale");
  requireSha(manifest.artifact_sha256, "artifact manifest artifact digest");
  assert(manifest.artifact_sha256 === artifactDigest(manifest.files), "artifact manifest artifact digest does not match files");
  exactKeys(manifest.privacy, PRIVACY_KEYS, "artifact manifest privacy");
  assert(manifest.privacy.safe === true, "artifact manifest privacy check did not pass");
  for (const category of PRIVACY_CATEGORIES) assert(manifest.privacy.categories[category] === 0, `artifact manifest privacy category is nonzero: ${category}`);
  requireSha(manifest.manifest_sha256, "artifact manifest digest");
  assert(manifest.manifest_sha256 === canonicalDigest(manifestIdentity(manifest)), "artifact manifest digest does not match content");
  assertPersistedRecordSafe(manifest);
  return manifest;
}

export function buildReleaseArtifactManifest({rootPath, rootBinding, releaseVersion, testBuildTag, source} = {}) {
  assert(typeof rootPath === "string" && path.isAbsolute(rootPath) && !rootPath.includes("\0"), "artifact root must be an absolute host-local path");
  const stat = fs.lstatSync(rootPath);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "artifact root must be a regular directory");
  requireIdentifier(rootBinding, "artifact root binding");
  const parsedTag = parseTestBuildTag(testBuildTag);
  assert(parsedTag.release_version === releaseVersion, "artifact release version differs from test-build tag");
  validateSource(source, "artifact source");
  const files = collectArtifactFiles(rootPath);
  const manifest = {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    version: 1,
    status: "VERIFIED_EXACT",
    root_binding: rootBinding,
    release_version: releaseVersion,
    test_build_tag: testBuildTag,
    source: clone(source),
    files: files.sort((left, right) => compareUtf8(left.path, right.path)),
    file_count: files.length,
    artifact_sha256: null,
    manifest_sha256: null,
    privacy: null,
  };
  manifest.artifact_sha256 = artifactDigest(manifest.files);
  manifest.privacy = privacySummary({
    schema: ARTIFACT_MANIFEST_SCHEMA,
    version: 1,
    root_binding: manifest.root_binding,
    release_version: manifest.release_version,
    test_build_tag: manifest.test_build_tag,
    source: manifest.source,
    files: manifest.files,
  });
  manifest.manifest_sha256 = canonicalDigest(manifestIdentity(manifest));
  return validateArtifactManifest(manifest);
}

export function verifyArtifactIdentity({expectedManifest, actualManifest} = {}) {
  validateArtifactManifest(expectedManifest);
  validateArtifactManifest(actualManifest);
  assert(expectedManifest.release_version === actualManifest.release_version, "artifact release version differs");
  assert(expectedManifest.test_build_tag === actualManifest.test_build_tag, "artifact test-build tag differs");
  assert(JSON.stringify(expectedManifest.source) === JSON.stringify(actualManifest.source), "artifact source identity differs");
  assert(expectedManifest.artifact_sha256 === actualManifest.artifact_sha256, "artifact bytes differ");
  assert(expectedManifest.manifest_sha256 === actualManifest.manifest_sha256, "artifact manifest differs");
  assert(JSON.stringify(expectedManifest.files) === JSON.stringify(actualManifest.files), "artifact file identity differs");
  const identity = {
    schema: ARTIFACT_IDENTITY_SCHEMA,
    version: 1,
    status: "VERIFIED_EXACT",
    release_version: expectedManifest.release_version,
    test_build_tag: expectedManifest.test_build_tag,
    artifact_sha256: expectedManifest.artifact_sha256,
    manifest_sha256: expectedManifest.manifest_sha256,
    identity_sha256: null,
  };
  identity.identity_sha256 = digestWithout(identity, "identity_sha256");
  assertPersistedRecordSafe(identity);
  return identity;
}

function candidateBody(candidate) {
  return {...candidate, candidate_sha256: null};
}

export function validateReleaseCandidate(candidate) {
  exactKeys(candidate, CANDIDATE_KEYS, "release candidate");
  assert(candidate.schema === RELEASE_CANDIDATE_SCHEMA && candidate.version === 1, "release candidate identity is invalid");
  requireIdentifier(candidate.candidate_id, "release candidate ID");
  const parsed = parseReleaseVersion(candidate.release_version);
  assert(candidate.release_channel === parsed.release_channel, "release candidate channel differs");
  const tag = parseTestBuildTag(candidate.test_build_tag);
  assert(tag.release_version === candidate.release_version, "release candidate test-build tag differs");
  validateSource(candidate.source, "release candidate source");
  requireSha(candidate.normative_snapshot_sha256, "release candidate normative snapshot");
  requireSha(candidate.artifact_sha256, "release candidate artifact");
  requireSha(candidate.manifest_sha256, "release candidate manifest");
  assert(CANDIDATE_STATES.includes(candidate.candidate_state), "release candidate state is invalid");
  requireSha(candidate.independent_audit_sha256, "release candidate audit", {nullable: true});
  requireSha(candidate.safety_evidence_sha256, "release candidate safety evidence", {nullable: true});
  requireSha(candidate.safety_subject_sha256, "release candidate safety subject", {nullable: true});
  requireSha(candidate.owner_decision_sha256, "release candidate owner decision", {nullable: true});
  requireSha(candidate.decision_candidate_sha256, "release candidate decision subject", {nullable: true});
  requireSha(candidate.rejection_feedback_sha256, "release candidate rejection feedback", {nullable: true});
  requireSha(candidate.predecessor_candidate_sha256, "release candidate predecessor", {nullable: true});
  assert(candidate.activation === false, "release candidate activation must remain false");
  if (["OWNER_REVIEW_PENDING", "OWNER_ACCEPTED", "KEEP_PREPARED", "OWNER_REJECTED", "PROMOTION_PENDING", "PROMOTED_PREPARED"].includes(candidate.candidate_state)) {
    requireSha(candidate.independent_audit_sha256, "release candidate audit for owner review");
  }
  if (["OWNER_ACCEPTED", "KEEP_PREPARED", "OWNER_REJECTED", "PROMOTION_PENDING", "PROMOTED_PREPARED"].includes(candidate.candidate_state)) {
    requireSha(candidate.owner_decision_sha256, "release candidate owner decision");
    requireSha(candidate.decision_candidate_sha256, "release candidate decision subject");
  }
  if (candidate.candidate_state === "OWNER_REJECTED") requireSha(candidate.rejection_feedback_sha256, "release candidate rejection feedback");
  if (candidate.candidate_state === "PROMOTED_PREPARED") assert(candidate.owner_decision_sha256 !== null, "promoted candidate lacks owner decision");
  requireSha(candidate.candidate_sha256, "release candidate digest");
  assert(candidate.candidate_sha256 === canonicalDigest(candidateBody(candidate)), "release candidate digest does not match content");
  assertPersistedRecordSafe(candidate);
  return candidate;
}

export function compileReleaseCandidate({candidateId, manifest, normativeSnapshotSha256, predecessorCandidateSha256 = null} = {}) {
  validateArtifactManifest(manifest);
  requireIdentifier(candidateId, "release candidate ID");
  requireSha(normativeSnapshotSha256, "release candidate normative snapshot");
  requireSha(predecessorCandidateSha256, "release candidate predecessor", {nullable: true});
  const candidate = {
    schema: RELEASE_CANDIDATE_SCHEMA,
    version: 1,
    candidate_id: candidateId,
    release_version: manifest.release_version,
    release_channel: parseReleaseVersion(manifest.release_version).release_channel,
    test_build_tag: manifest.test_build_tag,
    source: clone(manifest.source),
    normative_snapshot_sha256: normativeSnapshotSha256,
    artifact_sha256: manifest.artifact_sha256,
    manifest_sha256: manifest.manifest_sha256,
    candidate_state: "ASSEMBLED",
    independent_audit_sha256: null,
    safety_evidence_sha256: null,
    safety_subject_sha256: null,
    owner_decision_sha256: null,
    decision_candidate_sha256: null,
    rejection_feedback_sha256: null,
    predecessor_candidate_sha256: predecessorCandidateSha256,
    activation: false,
    candidate_sha256: null,
  };
  candidate.candidate_sha256 = canonicalDigest(candidateBody(candidate));
  return validateReleaseCandidate(candidate);
}

export function transitionReleaseCandidate(candidate, {
  nextState,
  independentAuditSha256 = candidate.independent_audit_sha256,
  safetyEvidenceSha256 = candidate.safety_evidence_sha256,
  safetySubjectSha256 = candidate.safety_subject_sha256,
} = {}) {
  validateReleaseCandidate(candidate);
  assert(CANDIDATE_STATES.includes(nextState), "release candidate next state is invalid");
  const transitions = {
    ASSEMBLED: ["STERILE_VERIFIED", "BLOCKED"],
    STERILE_VERIFIED: ["OWNER_REVIEW_PENDING", "BLOCKED"],
    OWNER_REVIEW_PENDING: ["BLOCKED"],
    OWNER_ACCEPTED: ["PROMOTION_PENDING", "BLOCKED"],
    PROMOTION_PENDING: ["PROMOTED_PREPARED", "BLOCKED"],
  };
  assert(transitions[candidate.candidate_state]?.includes(nextState), `release candidate cannot transition from ${candidate.candidate_state} to ${nextState}`);
  requireSha(independentAuditSha256, "release candidate audit", {nullable: true});
  requireSha(safetyEvidenceSha256, "release candidate safety evidence", {nullable: true});
  requireSha(safetySubjectSha256, "release candidate safety subject", {nullable: true});
  const next = {
    ...candidate,
    candidate_state: nextState,
    independent_audit_sha256: independentAuditSha256,
    safety_evidence_sha256: safetyEvidenceSha256,
    safety_subject_sha256: safetySubjectSha256,
    candidate_sha256: null,
  };
  next.candidate_sha256 = canonicalDigest(candidateBody(next));
  return validateReleaseCandidate(next);
}

export function validateRejectionFeedback(feedback) {
  exactKeys(feedback, FEEDBACK_KEYS, "release rejection feedback");
  assert(feedback.schema === REJECTION_FEEDBACK_SCHEMA && feedback.version === 1, "release rejection feedback identity is invalid");
  requireIdentifier(feedback.feedback_id, "release rejection feedback ID");
  requireSha(feedback.candidate_sha256, "release rejection feedback candidate");
  const release = parseReleaseVersion(feedback.release_version);
  assert(release.release_channel === "RELEASE_CANDIDATE", "release rejection feedback must target a release candidate");
  const tag = parseTestBuildTag(feedback.test_build_tag);
  assert(tag.release_version === feedback.release_version, "release rejection feedback test-build differs");
  requireSha(feedback.artifact_sha256, "release rejection feedback artifact");
  assert(FEEDBACK_CLASSIFICATIONS.includes(feedback.classification), "release rejection feedback classification is invalid");
  requireText(feedback.summary, "release rejection feedback summary", {max: 2000});
  sortedUnique(feedback.required_change_ids, "release rejection feedback change IDs", {itemPattern: SAFE_CHANGE_ID});
  assert(FEEDBACK_ROUTES.includes(feedback.route), "release rejection feedback route is invalid");
  assert(feedback.status === "OPEN", "release rejection feedback status is invalid");
  requireUtc(feedback.created_at_utc, "release rejection feedback time");
  requireSha(feedback.successor_candidate_sha256, "release rejection feedback successor", {nullable: true});
  requireSha(feedback.feedback_sha256, "release rejection feedback digest");
  assert(feedback.feedback_sha256 === digestWithout(feedback, "feedback_sha256"), "release rejection feedback digest does not match content");
  assertPersistedRecordSafe(feedback);
  return feedback;
}

export function compileRejectionFeedback({feedbackId, candidate, classification, summary, requiredChangeIds, route, createdAtUtc} = {}) {
  validateReleaseCandidate(candidate);
  assert(candidate.candidate_state === "OWNER_REVIEW_PENDING", "rejection feedback requires an owner-review candidate");
  requireIdentifier(feedbackId, "release rejection feedback ID");
  requireText(summary, "release rejection feedback summary", {max: 2000});
  const feedback = {
    schema: REJECTION_FEEDBACK_SCHEMA,
    version: 1,
    feedback_id: feedbackId,
    candidate_sha256: candidate.candidate_sha256,
    release_version: candidate.release_version,
    test_build_tag: candidate.test_build_tag,
    artifact_sha256: candidate.artifact_sha256,
    classification,
    summary,
    required_change_ids: [...requiredChangeIds].sort(compareUtf8),
    route,
    status: "OPEN",
    created_at_utc: createdAtUtc,
    successor_candidate_sha256: null,
    feedback_sha256: null,
  };
  feedback.feedback_sha256 = digestWithout(feedback, "feedback_sha256");
  return validateRejectionFeedback(feedback);
}

export function validateOwnerDecision(decision, candidate = null) {
  exactKeys(decision, OWNER_DECISION_KEYS, "release owner decision");
  assert(decision.schema === OWNER_DECISION_SCHEMA && decision.version === 1, "release owner decision identity is invalid");
  requireIdentifier(decision.decision_id, "release owner decision ID");
  requireSha(decision.candidate_sha256, "release owner decision candidate");
  const release = parseReleaseVersion(decision.release_version);
  assert(release.release_channel === "RELEASE_CANDIDATE", "release owner decision must target a release candidate");
  const tag = parseTestBuildTag(decision.test_build_tag);
  assert(tag.release_version === decision.release_version, "release owner decision test-build differs");
  requireSha(decision.artifact_sha256, "release owner decision artifact");
  requireSha(decision.independent_audit_sha256, "release owner decision audit");
  assert(OWNER_DECISIONS.includes(decision.decision), "release owner decision is invalid");
  requireSha(decision.actor_digest_sha256, "release owner decision actor");
  requireUtc(decision.decided_at_utc, "release owner decision time");
  requireSha(decision.feedback_sha256, "release owner decision feedback", {nullable: true});
  if (decision.decision === "REJECT") requireSha(decision.feedback_sha256, "rejected owner decision feedback");
  else assert(decision.feedback_sha256 === null, "non-rejection owner decision carries feedback");
  assert(decision.activation === false, "owner decision cannot activate a release");
  requireSha(decision.decision_sha256, "release owner decision digest");
  assert(decision.decision_sha256 === digestWithout(decision, "decision_sha256"), "release owner decision digest does not match content");
  if (candidate !== null) {
    validateReleaseCandidate(candidate);
    assert(candidate.candidate_state === "OWNER_REVIEW_PENDING" || candidate.decision_candidate_sha256 === decision.candidate_sha256, "owner decision is stale for candidate");
    assert(candidate.release_version === decision.release_version && candidate.test_build_tag === decision.test_build_tag, "owner decision release differs");
    assert(candidate.artifact_sha256 === decision.artifact_sha256, "owner decision artifact differs");
    assert(candidate.independent_audit_sha256 === decision.independent_audit_sha256, "owner decision audit differs");
  }
  assertPersistedRecordSafe(decision);
  return decision;
}

export function compileOwnerDecision({decisionId, candidate, decision, actorDigestSha256, decidedAtUtc, feedback = null} = {}) {
  validateReleaseCandidate(candidate);
  assert(candidate.candidate_state === "OWNER_REVIEW_PENDING", "owner decision requires a pending candidate");
  requireIdentifier(decisionId, "release owner decision ID");
  requireSha(actorDigestSha256, "release owner decision actor");
  requireUtc(decidedAtUtc, "release owner decision time");
  if (decision === "REJECT") {
    assert(feedback !== null, "rejected owner decision requires feedback");
    validateRejectionFeedback(feedback);
    assert(feedback.candidate_sha256 === candidate.candidate_sha256, "rejection feedback is stale");
  } else {
    assert(feedback === null, "non-rejection owner decision cannot carry feedback");
  }
  const record = {
    schema: OWNER_DECISION_SCHEMA,
    version: 1,
    decision_id: decisionId,
    candidate_sha256: candidate.candidate_sha256,
    release_version: candidate.release_version,
    test_build_tag: candidate.test_build_tag,
    artifact_sha256: candidate.artifact_sha256,
    independent_audit_sha256: candidate.independent_audit_sha256,
    decision,
    actor_digest_sha256: actorDigestSha256,
    decided_at_utc: decidedAtUtc,
    feedback_sha256: feedback?.feedback_sha256 ?? null,
    activation: false,
    decision_sha256: null,
  };
  record.decision_sha256 = digestWithout(record, "decision_sha256");
  return validateOwnerDecision(record, candidate);
}

export function applyOwnerDecision({candidate, decision} = {}) {
  validateReleaseCandidate(candidate);
  validateOwnerDecision(decision, candidate);
  const nextState = {
    APPROVE: "OWNER_ACCEPTED",
    KEEP_PREPARED: "KEEP_PREPARED",
    REJECT: "OWNER_REJECTED",
  }[decision.decision];
  const next = {
    ...candidate,
    candidate_state: nextState,
    owner_decision_sha256: decision.decision_sha256,
    decision_candidate_sha256: decision.candidate_sha256,
    rejection_feedback_sha256: decision.feedback_sha256,
    candidate_sha256: null,
  };
  next.candidate_sha256 = canonicalDigest(candidateBody(next));
  return validateReleaseCandidate(next);
}

function currentReleaseDigest(currentRelease) {
  return currentRelease === null ? null : canonicalDigest(currentRelease);
}

function validatePromotionSafety(candidate, safetyEvidence) {
  assert(safetyEvidence !== null && safetyEvidence !== undefined, "promotion requires release safety evidence");
  validateReleaseSafetyBundle(safetyEvidence);
  const gate = safetyEvidence.gate;
  assert(candidate.safety_evidence_sha256 === gate.safety_sha256, "candidate safety evidence is stale");
  assert(candidate.safety_subject_sha256 === gate.subject_candidate_sha256, "candidate safety subject differs");
  assert(gate.release_version === candidate.release_version, "candidate safety release differs");
  assert(gate.status === "PASS", "promotion requires a passing release safety gate");
  return gate;
}

export function validatePromotionRequest(request, {candidate = null, ownerDecision = null, safetyEvidence = null} = {}) {
  exactKeys(request, PROMOTION_REQUEST_KEYS, "release promotion request");
  assert(request.schema === PROMOTION_REQUEST_SCHEMA && request.version === 1, "release promotion request identity is invalid");
  requireIdentifier(request.request_id, "release promotion request ID");
  requireSha(request.candidate_sha256, "release promotion request candidate");
  requireSha(request.owner_decision_sha256, "release promotion request owner decision");
  const release = parseReleaseVersion(request.release_version);
  assert(release.release_channel === "RELEASE_CANDIDATE", "release promotion request must target a release candidate");
  validateStableTargetVersion(request.release_version, request.target_release_version);
  const tag = parseTestBuildTag(request.test_build_tag);
  assert(tag.release_version === request.release_version, "release promotion request test-build differs");
  requireSha(request.artifact_sha256, "release promotion request artifact");
  requireSha(request.manifest_sha256, "release promotion request manifest");
  requireIdentifier(request.target_binding, "release promotion target binding");
  validateReleaseIdentity(request.current_release, "release promotion current release");
  requireSha(request.safety_gate_sha256, "release promotion safety gate");
  requireSha(request.safety_subject_sha256, "release promotion safety subject");
  assert(request.action === "REPLACE_RELEASE_AT_SAME_ROOT", "release promotion action is invalid");
  assert(request.project_action === "LEAVE_PROJECT_REPOSITORIES_UNCHANGED", "release promotion project action is invalid");
  assert(request.activation === false, "release promotion request cannot activate");
  assert(request.status === PROMOTION_STATUS, "release promotion request status is invalid");
  requireUtc(request.requested_at_utc, "release promotion request time");
  requireSha(request.request_sha256, "release promotion request digest");
  assert(request.request_sha256 === digestWithout(request, "request_sha256"), "release promotion request digest does not match content");
  if (candidate !== null) {
    validateReleaseCandidate(candidate);
    assert(candidate.candidate_state === "OWNER_ACCEPTED", "release promotion requires an owner-accepted candidate");
    assert(candidate.candidate_sha256 === request.candidate_sha256, "release promotion request candidate is stale");
    assert(candidate.owner_decision_sha256 === request.owner_decision_sha256, "release promotion request owner decision is stale");
    assert(candidate.release_version === request.release_version && candidate.test_build_tag === request.test_build_tag, "release promotion request release differs");
    assert(candidate.artifact_sha256 === request.artifact_sha256 && candidate.manifest_sha256 === request.manifest_sha256, "release promotion request artifact is stale");
    assert(candidate.safety_evidence_sha256 === request.safety_gate_sha256 && candidate.safety_subject_sha256 === request.safety_subject_sha256, "release promotion request safety evidence is stale");
  }
  if (ownerDecision !== null) {
    validateOwnerDecision(ownerDecision, candidate);
    assert(ownerDecision.decision === "APPROVE", "release promotion requires an approving owner decision");
    assert(ownerDecision.decision_sha256 === request.owner_decision_sha256, "release promotion request decision differs");
  }
  if (safetyEvidence !== null) {
    const gate = validatePromotionSafety(candidate ?? {
      safety_evidence_sha256: request.safety_gate_sha256,
      safety_subject_sha256: request.safety_subject_sha256,
      release_version: request.release_version,
    }, safetyEvidence);
    assert(gate.safety_sha256 === request.safety_gate_sha256 && gate.subject_candidate_sha256 === request.safety_subject_sha256, "release promotion request safety gate differs");
  }
  assertPersistedRecordSafe(request);
  return request;
}

export function compileReleasePromotionRequest({requestId, candidate, ownerDecision, safetyEvidence, targetReleaseVersion, targetBinding, currentRelease = null, requestedAtUtc} = {}) {
  validateReleaseCandidate(candidate);
  validateOwnerDecision(ownerDecision, candidate);
  assert(candidate.candidate_state === "OWNER_ACCEPTED", "release promotion requires an owner-accepted candidate");
  assert(ownerDecision.decision === "APPROVE", "release promotion requires an approving owner decision");
  const gate = validatePromotionSafety(candidate, safetyEvidence);
  validateStableTargetVersion(candidate.release_version, targetReleaseVersion);
  requireIdentifier(requestId, "release promotion request ID");
  requireIdentifier(targetBinding, "release promotion target binding");
  validateReleaseIdentity(currentRelease, "release promotion current release");
  requireUtc(requestedAtUtc, "release promotion request time");
  const request = {
    schema: PROMOTION_REQUEST_SCHEMA,
    version: 1,
    request_id: requestId,
    candidate_sha256: candidate.candidate_sha256,
    owner_decision_sha256: ownerDecision.decision_sha256,
    release_version: candidate.release_version,
    target_release_version: targetReleaseVersion,
    test_build_tag: candidate.test_build_tag,
    artifact_sha256: candidate.artifact_sha256,
    manifest_sha256: candidate.manifest_sha256,
    target_binding: targetBinding,
    current_release: currentRelease === null ? null : clone(currentRelease),
    safety_gate_sha256: gate.safety_sha256,
    safety_subject_sha256: gate.subject_candidate_sha256,
    action: "REPLACE_RELEASE_AT_SAME_ROOT",
    project_action: "LEAVE_PROJECT_REPOSITORIES_UNCHANGED",
    activation: false,
    status: PROMOTION_STATUS,
    requested_at_utc: requestedAtUtc,
    request_sha256: null,
  };
  request.request_sha256 = digestWithout(request, "request_sha256");
  return validatePromotionRequest(request, {candidate, ownerDecision, safetyEvidence});
}

export function validatePromotionReceipt(receipt, {
  request = null,
  candidate = null,
  ownerDecision = null,
  safetyEvidence = null,
  expectedManifest = null,
  targetManifest = null,
  hostReceiptSha256 = null,
} = {}) {
  assert(request !== null, "release promotion receipt requires the originating promotion request");
  assert(candidate !== null, "release promotion receipt requires the originating candidate");
  assert(ownerDecision !== null, "release promotion receipt requires the originating owner decision");
  assert(safetyEvidence !== null, "release promotion receipt requires the originating safety evidence");
  assert(expectedManifest !== null, "release promotion receipt requires the originating expected manifest");
  assert(targetManifest !== null, "release promotion receipt requires the originating target manifest");
  requireSha(hostReceiptSha256, "release promotion receipt expected host evidence");
  exactKeys(receipt, PROMOTION_RECEIPT_KEYS, "release promotion receipt");
  assert(receipt.schema === PROMOTION_RECEIPT_SCHEMA && receipt.version === 1, "release promotion receipt identity is invalid");
  requireIdentifier(receipt.request_id, "release promotion receipt request ID");
  requireSha(receipt.request_sha256, "release promotion receipt request");
  requireSha(receipt.candidate_sha256, "release promotion receipt candidate");
  const release = parseReleaseVersion(receipt.release_version);
  assert(release.release_channel === "RELEASE_CANDIDATE", "release promotion receipt must target a release candidate");
  validateStableTargetVersion(receipt.release_version, receipt.target_release_version);
  const tag = parseTestBuildTag(receipt.test_build_tag);
  assert(tag.release_version === receipt.release_version, "release promotion receipt test-build differs");
  requireSha(receipt.artifact_sha256, "release promotion receipt artifact");
  requireSha(receipt.manifest_sha256, "release promotion receipt manifest");
  requireIdentifier(receipt.target_binding, "release promotion receipt target binding");
  requireSha(receipt.target_manifest_sha256, "release promotion receipt target manifest");
  requireSha(receipt.host_receipt_sha256, "release promotion receipt host evidence");
  requireSha(receipt.safety_gate_sha256, "release promotion receipt safety gate");
  assert(["RETAINED", "NONE_EXISTED"].includes(receipt.previous_release_disposition), "release promotion receipt previous release disposition is invalid");
  requireSha(receipt.previous_release_sha256, "release promotion receipt previous release", {nullable: true});
  if (receipt.previous_release_disposition === "RETAINED") requireSha(receipt.previous_release_sha256, "retained previous release");
  else assert(receipt.previous_release_sha256 === null, "none-existed previous release carries an identity");
  assert(receipt.status === PROMOTED_PREPARED_STATUS, "release promotion receipt status is invalid");
  assert(receipt.project_action === "LEAVE_PROJECT_REPOSITORIES_UNCHANGED", "release promotion receipt project action is invalid");
  assert(receipt.activation === false, "release promotion receipt cannot activate");
  requireUtc(receipt.promoted_at_utc, "release promotion receipt time");
  requireSha(receipt.receipt_sha256, "release promotion receipt digest");
  assert(receipt.receipt_sha256 === digestWithout(receipt, "receipt_sha256"), "release promotion receipt digest does not match content");
  assert(receipt.host_receipt_sha256 === hostReceiptSha256, "release promotion receipt host evidence differs");
  {
    validatePromotionRequest(request, {candidate, ownerDecision, safetyEvidence});
    assert(receipt.request_id === request.request_id && receipt.request_sha256 === request.request_sha256, "release promotion receipt request differs");
    assert(receipt.candidate_sha256 === request.candidate_sha256, "release promotion receipt candidate differs");
    assert(receipt.release_version === request.release_version && receipt.target_release_version === request.target_release_version && receipt.test_build_tag === request.test_build_tag, "release promotion receipt release differs");
    assert(receipt.artifact_sha256 === request.artifact_sha256 && receipt.manifest_sha256 === request.manifest_sha256, "release promotion receipt artifact differs");
    assert(receipt.target_binding === request.target_binding, "release promotion receipt target differs");
    assert(receipt.safety_gate_sha256 === request.safety_gate_sha256, "release promotion receipt safety evidence differs");
    assert(receipt.previous_release_sha256 === currentReleaseDigest(request.current_release), "release promotion receipt previous release differs");
    if (request.current_release === null) assert(receipt.previous_release_disposition === "NONE_EXISTED", "release promotion receipt falsely claims a retained release");
    else assert(receipt.previous_release_disposition === "RETAINED", "release promotion receipt did not retain the previous release");
  }
  {
    validateArtifactManifest(expectedManifest);
    assert(expectedManifest.manifest_sha256 === receipt.manifest_sha256, "release promotion receipt expected manifest differs");
    assert(expectedManifest.manifest_sha256 === request.manifest_sha256, "release promotion receipt request manifest differs");
  }
  {
    validateArtifactManifest(targetManifest);
    assert(targetManifest.root_binding === receipt.target_binding, "release promotion target manifest binding differs");
    verifyArtifactIdentity({expectedManifest, actualManifest: targetManifest});
    assert(targetManifest.manifest_sha256 === receipt.target_manifest_sha256, "release promotion target readback differs");
  }
  assertPersistedRecordSafe(receipt);
  return receipt;
}

export function compileReleasePromotionReceipt({request, candidate, ownerDecision, safetyEvidence, expectedManifest, targetManifest, hostReceiptSha256, promotedAtUtc} = {}) {
  assert(candidate !== null && candidate !== undefined, "release promotion receipt requires the candidate record");
  assert(ownerDecision !== null && ownerDecision !== undefined, "release promotion receipt requires the owner decision");
  validatePromotionRequest(request, {candidate, ownerDecision, safetyEvidence});
  validateArtifactManifest(expectedManifest);
  validateArtifactManifest(targetManifest);
  verifyArtifactIdentity({expectedManifest, actualManifest: targetManifest});
  assert(targetManifest.root_binding === request.target_binding, "release promotion target binding differs");
  assert(expectedManifest.manifest_sha256 === request.manifest_sha256, "release promotion request is stale for manifest");
  requireSha(hostReceiptSha256, "release promotion host evidence");
  requireUtc(promotedAtUtc, "release promotion receipt time");
  const previousReleaseSha256 = currentReleaseDigest(request.current_release);
  const receipt = {
    schema: PROMOTION_RECEIPT_SCHEMA,
    version: 1,
    request_id: request.request_id,
    request_sha256: request.request_sha256,
    candidate_sha256: request.candidate_sha256,
    release_version: request.release_version,
    target_release_version: request.target_release_version,
    test_build_tag: request.test_build_tag,
    artifact_sha256: request.artifact_sha256,
    manifest_sha256: request.manifest_sha256,
    target_binding: request.target_binding,
    target_manifest_sha256: targetManifest.manifest_sha256,
    host_receipt_sha256: hostReceiptSha256,
    safety_gate_sha256: request.safety_gate_sha256,
    previous_release_disposition: request.current_release === null ? "NONE_EXISTED" : "RETAINED",
    previous_release_sha256: previousReleaseSha256,
    status: PROMOTED_PREPARED_STATUS,
    project_action: "LEAVE_PROJECT_REPOSITORIES_UNCHANGED",
    activation: false,
    promoted_at_utc: promotedAtUtc,
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = digestWithout(receipt, "receipt_sha256");
  return validatePromotionReceipt(receipt, {
    request,
    candidate,
    ownerDecision,
    safetyEvidence,
    expectedManifest,
    targetManifest,
    hostReceiptSha256,
  });
}
