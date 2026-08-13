#!/usr/bin/env node

/*
 * Project-agnostic decision tree for conservative source preservation.
 * Product paths and identities enter only through an opaque typed overlay.
 */

import crypto from "node:crypto";

export const CONSERVATIVE_PRESERVATION_SCHEMA = "agentos.conservative_source_preservation_policy.v1";
export const CONSERVATIVE_PRESERVATION_VERSION = 1;
export const PRESERVATION_DECISIONS = Object.freeze([
  "PRESERVE_USER_CONTENT",
  "EXCLUDE_GIT_ADMINISTRATIVE_INTERNAL",
  "EXCLUDE_IGNORED_REPRODUCIBLE_OUTPUT",
]);
export const PRESERVATION_INVALIDATION = "DEPENDENT_MANIFEST_INVALIDATED_POLICY_DIGEST_CHANGED";

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Z][A-Z0-9._:-]*$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireId(value, label) {
  assert(typeof value === "string" && SAFE_ID.test(value), `${label} must be a safe uppercase identity`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be lowercase SHA-256`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.every((value) => typeof value === "string" && /^[A-Za-z0-9._-]+$/u.test(value)), `${label} contains an unsafe name`);
  const sorted = [...new Set(values)].sort();
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted and unique`);
  return values;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

const DEFAULT_REPRODUCIBLE_DIRECTORIES = [
  ".cache", ".next", ".turbo", "build", "coverage", "dist", "node_modules",
];

export function compileConservativePreservationPolicy({
  policyId = "CONSERVATIVE_SOURCE_PRESERVATION",
  version = 1,
  projectOverlay = null,
} = {}) {
  requireId(policyId, "preservation policy ID");
  assert(Number.isSafeInteger(version) && version > 0, "preservation policy version is invalid");
  if (projectOverlay !== null) validateProjectPreservationOverlay(projectOverlay);
  const overlayDirectories = projectOverlay?.reproducible_ignored_directory_names ?? [];
  const directories = [...new Set([...DEFAULT_REPRODUCIBLE_DIRECTORIES, ...overlayDirectories])].sort();
  const body = {
    schema: CONSERVATIVE_PRESERVATION_SCHEMA,
    version: CONSERVATIVE_PRESERVATION_VERSION,
    policy_id: policyId,
    policy_version: version,
    status: "PREPARED_NOT_ACTIVATED",
    git_administrative_names: [".git"],
    reproducible_ignored_directory_names: directories,
    reproducible_ignored_file_suffixes: [],
    ambiguous_ignored_content: "PRESERVE",
    sensitive_user_content: "PRESERVE_IN_EXTERNAL_CUSTODY",
    source_overlay_digest: projectOverlay?.overlay_sha256 ?? null,
    rules: [
      "Exclude .git administrative entries regardless of tracked state.",
      "Exclude a named reproducible directory only when ignored, untracked, and without tracked descendants.",
      "Preserve every tracked entry, tracked modification, and untracked user-owned file.",
      "Preserve ignored content when applicability is ambiguous; no file suffix is excluded by default.",
      "Invalidate dependent manifests when this policy digest or overlay digest changes.",
    ],
  };
  return {...body, policy_sha256: canonicalDigest(body)};
}

export function validateProjectPreservationOverlay(overlay) {
  requireRecord(overlay, "project preservation overlay");
  assert(overlay.schema === "agentos.project_preservation_overlay.v1" && overlay.version === 1, "project preservation overlay schema is invalid");
  requireSha(overlay.overlay_sha256, "project preservation overlay digest");
  assert(overlay.project_context_digest === null || SHA256.test(overlay.project_context_digest), "project preservation context digest is invalid");
  sortedUnique(overlay.reproducible_ignored_directory_names, "project reproducible directories");
  assert(overlay.reproducible_ignored_file_suffixes.length === 0, "project overlays may not introduce file-suffix exclusions");
  const body = structuredClone(overlay);
  delete body.overlay_sha256;
  assert(overlay.overlay_sha256 === canonicalDigest(body), "project preservation overlay digest is stale");
  return overlay;
}

export function compileProjectPreservationOverlay({projectContextDigest = null, reproducibleIgnoredDirectoryNames = []} = {}) {
  if (projectContextDigest !== null) requireSha(projectContextDigest, "project context digest");
  sortedUnique(reproducibleIgnoredDirectoryNames, "project reproducible directories");
  const body = {
    schema: "agentos.project_preservation_overlay.v1",
    version: 1,
    project_context_digest: projectContextDigest,
    reproducible_ignored_directory_names: [...reproducibleIgnoredDirectoryNames],
    reproducible_ignored_file_suffixes: [],
  };
  return {...body, overlay_sha256: canonicalDigest(body)};
}

export function validateConservativePreservationPolicy(policy) {
  requireRecord(policy, "conservative preservation policy");
  assert(policy.schema === CONSERVATIVE_PRESERVATION_SCHEMA && policy.version === CONSERVATIVE_PRESERVATION_VERSION, "conservative preservation policy schema is invalid");
  requireId(policy.policy_id, "preservation policy ID");
  assert(Number.isSafeInteger(policy.policy_version) && policy.policy_version > 0, "preservation policy version is invalid");
  assert(policy.status === "PREPARED_NOT_ACTIVATED", "conservative preservation policy must remain prepared");
  sortedUnique(policy.git_administrative_names, "Git administrative names");
  sortedUnique(policy.reproducible_ignored_directory_names, "reproducible directories");
  assert(JSON.stringify(policy.reproducible_ignored_file_suffixes) === "[]", "file suffix exclusions must remain empty");
  assert(policy.ambiguous_ignored_content === "PRESERVE" && policy.sensitive_user_content === "PRESERVE_IN_EXTERNAL_CUSTODY", "conservative policy weakens preservation");
  assert(policy.source_overlay_digest === null || SHA256.test(policy.source_overlay_digest), "policy overlay digest is invalid");
  requireSha(policy.policy_sha256, "preservation policy digest");
  const body = structuredClone(policy);
  delete body.policy_sha256;
  assert(policy.policy_sha256 === canonicalDigest(body), "preservation policy digest is stale");
  return policy;
}

export function decideConservativePreservation({
  entryName,
  entryKind,
  tracked,
  ignored,
  hasTrackedDescendant = false,
  policy = compileConservativePreservationPolicy(),
} = {}) {
  validateConservativePreservationPolicy(policy);
  assert(typeof entryName === "string" && entryName.length > 0 && !entryName.includes("/") && !entryName.includes("\\") && !entryName.includes("\0"), "preservation entry name is invalid");
  assert(["file", "directory"].includes(entryKind), "preservation entry kind is invalid");
  assert(typeof tracked === "boolean" && typeof ignored === "boolean" && typeof hasTrackedDescendant === "boolean", "preservation path facts are invalid");
  if (policy.git_administrative_names.includes(entryName)) {
    return {decision: "EXCLUDE_GIT_ADMINISTRATIVE_INTERNAL", reason: "Git administrative internals"};
  }
  if (entryKind === "directory"
      && !tracked
      && ignored
      && !hasTrackedDescendant
      && policy.reproducible_ignored_directory_names.includes(entryName)) {
    return {decision: "EXCLUDE_IGNORED_REPRODUCIBLE_OUTPUT", reason: "ignored reproducible cache/build/dependency output"};
  }
  return {decision: "PRESERVE_USER_CONTENT", reason: "tracked or user-owned/ambiguous content"};
}

export function invalidateDependentPreservationManifest({manifestPolicySha256, currentPolicySha256} = {}) {
  requireSha(manifestPolicySha256, "manifest policy digest");
  requireSha(currentPolicySha256, "current policy digest");
  if (manifestPolicySha256 === currentPolicySha256) {
    return {status: "VALID", invalidated: false, reason: "policy digest unchanged"};
  }
  return {status: "INVALIDATED", invalidated: true, reason: PRESERVATION_INVALIDATION};
}
