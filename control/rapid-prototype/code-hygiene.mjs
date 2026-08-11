#!/usr/bin/env node

import crypto from "node:crypto";

export const PATH_VALIDATION_SCHEMA = "portable.changed_path_validation.v1";
export const HYGIENE_RESULT_SCHEMA = "portable.code_hygiene_result.v1";
export const HYGIENE_HANDOFF_SCHEMA = "portable.code_hygiene_handoff.v1";
export const LANE_ROLE = "IMPLEMENTATION_CODE_HYGIENE";
export const HYGIENE_STATUSES = Object.freeze(["CLEAN", "SOFT_REVIEW", "HARD_STOP"]);
export const HYGIENE_INDEPENDENT_CHECK_STATUSES = Object.freeze(["NOT_RUN", "REQUESTED", "PASS", "FAIL"]);
export const EXACT_LANE_PATHS = Object.freeze([
  "control/rapid-prototype/code-hygiene.mjs",
  "tests/rapid-prototype/code-hygiene.mjs",
]);
export const CODE_HYGIENE_ALLOWED_PATHS = EXACT_LANE_PATHS;

const DELEGATED_CHECKS = Object.freeze([
  Object.freeze({check: "SOURCE_BINDING", owner_boundary: "HOST_READBACK", status: "DELEGATED"}),
  Object.freeze({check: "FOCUSED_CHECK_EXECUTION", owner_boundary: "VERIFICATION_RUNNER", status: "DELEGATED"}),
  Object.freeze({check: "CONTENT_PORTABILITY", owner_boundary: "SECURITY_PRIVACY", status: "DELEGATED"}),
  Object.freeze({check: "GENERATED_FILE_AUTHORITY", owner_boundary: "PROJECT_CONFIGURATION", status: "DELEGATED"}),
  Object.freeze({check: "STALE_EVIDENCE", owner_boundary: "SOURCE_SNAPSHOT_VERIFIER", status: "DELEGATED"}),
]);

const STATUS_RANK = Object.freeze({CLEAN: 0, SOFT_REVIEW: 1, HARD_STOP: 2});
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|[\\]{2})/u;
const EXTERNAL_REFERENCE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const SAFE_PUBLIC_RELATIVE_PATH = /^[A-Za-z0-9._/-]+$/u;

const SHARED_PATHS = new Set([
  "control/host-runtime-adapter.mjs",
  "control/native-session-team.mjs",
  "control/rapid-prototype/index.mjs",
  "docs/bootstrap-rapid-prototype-plan.md",
  "schemas/rapid-prototype-plan.v1.json",
  "tests/verify-rapid-prototype.mjs",
]);

const PRIVATE_SEGMENTS = new Set([
  [".", "code", "x"].join(""),
  "control-plane",
  "control_plane",
  "credentials",
  "credential",
  "owner-record",
  "owner-records",
  "private",
  "secret",
  "secrets",
  "session",
  "session-record",
  "session-records",
  "sessions",
  "token",
  "tokens",
]);

const TEMPORARY_SEGMENTS = new Set([
  ".cache",
  ".stage",
  ".staging",
  ".tmp",
  "cache",
  "scratch",
  "stage",
  "staging",
  "temp",
  "temporary",
  "tmp",
]);

const GENERATED_SEGMENTS = new Set([
  ".generated",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

const FINDING_MESSAGES = Object.freeze({
  ABSOLUTE_PATH: "absolute paths are outside the portable lane boundary",
  BACKSLASH_PATH: "backslash-separated paths are ambiguous in the portable lane",
  DOCS_ONLY_PATH: "documentation-only changes require a typed scope review",
  DUPLICATE_PATH: "a changed path was declared more than once",
  EXTERNAL_REFERENCE: "external references are outside the local lane boundary",
  GENERATED_PATH: "generated or vendored paths require their governing owner",
  INVALID_ALLOWLIST: "the allowed-path declaration is not a valid path list",
  INVALID_CHANGED_PATHS: "the changed-path observation is not a valid path list",
  INVALID_PATH: "a changed path is not a safe relative file path",
  LANE_SCOPE_MISMATCH: "the allowed paths do not equal the exact lane scope",
  NO_CHANGED_PATHS: "no changed paths were observed for the lane check",
  PATH_TRAVERSAL: "path traversal or dot segments are forbidden",
  PRIVATE_PATH: "private or control-plane paths cannot enter public lane evidence",
  SHARED_PATH: "shared control, plan, schema, or assembler paths are outside this lane",
  SIBLING_LANE_PATH: "another implementation lane cannot be changed by this lane",
  TEMPORARY_PATH: "temporary or staging paths are outside the portable lane boundary",
  UNDECLARED_PATH: "the path is outside the exact declared lane scope and needs review",
});

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(
    Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
  );
  return value;
}

function stableText(value) {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(canonicalize(value));
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function digest(value) {
  return crypto.createHash("sha256").update(stableText(value), "utf8").digest("hex");
}

function pathDigest(value) {
  return digest(value);
}

function highestStatus(left, right) {
  return STATUS_RANK[left] >= STATUS_RANK[right] ? left : right;
}

function normalizedSegments(value) {
  return value.split("/").map((segment) => segment.toLowerCase());
}

function segmentStem(segment) {
  return segment.replace(/\.[^.]+$/u, "");
}

function containsNamedSegment(value, names) {
  return normalizedSegments(value).some((segment) => names.has(segment) || names.has(segmentStem(segment)));
}

function isPrivatePath(value) {
  const lower = value.toLowerCase();
  return containsNamedSegment(value, PRIVATE_SEGMENTS)
    || normalizedSegments(value).some((segment) => segment.startsWith(".env"))
    || lower.includes("credential")
    || lower.includes("secret")
    || lower.includes("owner-record")
    || lower.includes("session-record");
}

function isTemporaryPath(value) {
  return containsNamedSegment(value, TEMPORARY_SEGMENTS);
}

function isGeneratedPath(value) {
  return containsNamedSegment(value, GENERATED_SEGMENTS)
    || /(?:^|\/)(?:.+\.)?(?:generated|bundle|manifest)\.(?:json|js|mjs|map)$/iu.test(value);
}

function isSiblingLanePath(value) {
  return (value.startsWith("control/rapid-prototype/") || value.startsWith("tests/rapid-prototype/"))
    && value.endsWith(".mjs")
    && !EXACT_LANE_PATHS.includes(value);
}

function isDocsOnlyPath(value) {
  return value === "README.md"
    || value.startsWith("docs/")
    || /\.(?:adoc|md|rst|txt)$/iu.test(value);
}

function isSafePublicRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (!SAFE_PUBLIC_RELATIVE_PATH.test(value) || value.includes("\\")) return false;
  if (value.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(value) || value.includes("//") || value.endsWith("/")) return false;
  const segments = value.split("/");
  if (segments.includes(".") || segments.includes("..")) return false;
  return !isPrivatePath(value) && !isTemporaryPath(value) && !isGeneratedPath(value);
}

function pathEvidence(value) {
  const evidence = {path_sha256: pathDigest(value)};
  if (isSafePublicRelativePath(value)) evidence.path = value;
  return evidence;
}

function finding(code, severity, value = null, evidenceKey = "path") {
  const result = {
    code,
    severity,
    message: FINDING_MESSAGES[code],
  };
  if (evidenceKey === "path") Object.assign(result, pathEvidence(value));
  else result.evidence_sha256 = pathDigest(value);
  return result;
}

function classifyPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.trim() !== value || CONTROL_CHARACTER.test(value)) {
    return {code: "INVALID_PATH", severity: "HARD_STOP"};
  }
  if (EXTERNAL_REFERENCE.test(value)) return {code: "EXTERNAL_REFERENCE", severity: "HARD_STOP"};
  if (value.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(value)) return {code: "ABSOLUTE_PATH", severity: "HARD_STOP"};
  if (value.includes("\\")) return {code: "BACKSLASH_PATH", severity: "HARD_STOP"};
  const segments = value.split("/");
  if (value.includes("//") || value.endsWith("/") || segments.includes(".") || segments.includes("..")) {
    return {code: "PATH_TRAVERSAL", severity: "HARD_STOP"};
  }
  if (isPrivatePath(value)) return {code: "PRIVATE_PATH", severity: "HARD_STOP"};
  if (isTemporaryPath(value)) return {code: "TEMPORARY_PATH", severity: "HARD_STOP"};
  if (isGeneratedPath(value)) return {code: "GENERATED_PATH", severity: "HARD_STOP"};
  if (SHARED_PATHS.has(value) || value.startsWith("schemas/") || /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(value)) {
    return {code: "SHARED_PATH", severity: "HARD_STOP"};
  }
  if (isSiblingLanePath(value)) return {code: "SIBLING_LANE_PATH", severity: "HARD_STOP"};
  if (!isSafePublicRelativePath(value)) return {code: "INVALID_PATH", severity: "HARD_STOP"};
  if (EXACT_LANE_PATHS.includes(value)) return {code: "ALLOWED_PATH", severity: "CLEAN"};
  if (isDocsOnlyPath(value)) return {code: "DOCS_ONLY_PATH", severity: "SOFT_REVIEW"};
  return {code: "UNDECLARED_PATH", severity: "SOFT_REVIEW"};
}

function normalizePathList(value) {
  if (!Array.isArray(value)) return {valid: false, values: []};
  const values = [...value].filter((entry) => typeof entry === "string").sort(compareUtf8);
  const hasInvalidEntry = values.length !== value.length || values.some((entry) => entry.length === 0);
  const uniqueValues = [...new Set(values)];
  return {
    valid: !hasInvalidEntry,
    values,
    uniqueValues,
    hasDuplicates: uniqueValues.length !== values.length,
  };
}

function samePaths(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const codeOrder = compareUtf8(left.code, right.code);
    if (codeOrder !== 0) return codeOrder;
    const leftEvidence = left.path_sha256 ?? left.evidence_sha256 ?? "";
    const rightEvidence = right.path_sha256 ?? right.evidence_sha256 ?? "";
    return compareUtf8(leftEvidence, rightEvidence);
  });
}

function uniqueEvidence(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.path_sha256 ?? entry.evidence_sha256}:${entry.code ?? "PATH"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateChangedPaths(changedPaths, allowedPaths = EXACT_LANE_PATHS) {
  const findings = [];
  const changedList = normalizePathList(changedPaths);
  const allowList = normalizePathList(allowedPaths);
  const expectedPaths = [...EXACT_LANE_PATHS].sort(compareUtf8);
  const scopeMatches = allowList.valid && !allowList.hasDuplicates && samePaths(allowList.uniqueValues, expectedPaths);

  if (!changedList.valid || !Array.isArray(changedPaths)) findings.push(finding("INVALID_CHANGED_PATHS", "HARD_STOP", changedPaths, "input"));
  if (!allowList.valid || !Array.isArray(allowedPaths)) findings.push(finding("INVALID_ALLOWLIST", "HARD_STOP", allowedPaths, "input"));
  if (!scopeMatches) findings.push(finding("LANE_SCOPE_MISMATCH", "HARD_STOP", allowList.values, "input"));

  const observedValues = Array.isArray(changedPaths) ? changedPaths : [];
  const acceptedPaths = [];
  const rejectedPaths = [];
  const seenPaths = new Set();
  for (const value of observedValues) {
    const classification = classifyPath(value);
    if (classification.code === "ALLOWED_PATH" && scopeMatches) acceptedPaths.push(value);
    if (classification.code !== "ALLOWED_PATH") {
      const pathFinding = finding(classification.code, classification.severity, value);
      findings.push(pathFinding);
      rejectedPaths.push(pathEvidence(value));
    }
    if (typeof value === "string") {
      if (seenPaths.has(value)) {
        findings.push(finding("DUPLICATE_PATH", "HARD_STOP", value));
        rejectedPaths.push(pathEvidence(value));
      }
      seenPaths.add(value);
    }
  }
  if (Array.isArray(changedPaths) && changedPaths.length === 0) findings.push(finding("NO_CHANGED_PATHS", "SOFT_REVIEW", changedPaths, "input"));

  const uniqueFindings = sortFindings(uniqueEvidence(findings));
  let status = "CLEAN";
  for (const item of uniqueFindings) status = highestStatus(status, item.severity);
  const uniqueAcceptedPaths = [...new Set(acceptedPaths)].sort(compareUtf8);
  const body = {
    schema: PATH_VALIDATION_SCHEMA,
    version: 1,
    lane_role: LANE_ROLE,
    status,
    valid: status === "CLEAN",
    exact_lane_scope: scopeMatches,
    allowed_paths: expectedPaths,
    accepted_paths: uniqueAcceptedPaths,
    rejected_paths: uniqueEvidence(rejectedPaths).sort((left, right) => compareUtf8(left.path_sha256, right.path_sha256)),
    observed_path_count: observedValues.length,
    changed_paths_sha256: digest(observedValues.map(stableText).sort(compareUtf8)),
    allowed_paths_sha256: digest(allowList.values.map(stableText).sort(compareUtf8)),
    findings: uniqueFindings,
  };
  return {...body, validation_sha256: digest(body)};
}

function compileInput(input, positionalAllowedPaths) {
  if (Array.isArray(input)) return {
    changedPaths: input,
    allowedPaths: positionalAllowedPaths === undefined ? EXACT_LANE_PATHS : positionalAllowedPaths,
  };
  if (!isRecord(input)) return {
    changedPaths: input,
    allowedPaths: positionalAllowedPaths === undefined ? EXACT_LANE_PATHS : positionalAllowedPaths,
  };
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const allowedPaths = hasOwn("allowedPaths")
    ? input.allowedPaths
    : hasOwn("allowed_paths")
      ? input.allowed_paths
      : EXACT_LANE_PATHS;
  return {
    changedPaths: hasOwn("changedPaths") ? input.changedPaths : input.changed_paths,
    allowedPaths,
  };
}

export function compileHygieneResult(input, positionalAllowedPaths) {
  const {changedPaths, allowedPaths} = compileInput(input, positionalAllowedPaths);
  const pathValidation = validateChangedPaths(changedPaths, allowedPaths);
  const body = {
    schema: HYGIENE_RESULT_SCHEMA,
    version: 1,
    lane_role: LANE_ROLE,
    status: pathValidation.status,
    decision: pathValidation.status,
    exact_lane_scope: pathValidation.exact_lane_scope,
    path_validation: pathValidation,
    handoff: {
      schema: HYGIENE_HANDOFF_SCHEMA,
      version: 1,
      lane_role: LANE_ROLE,
      status: pathValidation.status,
      independent_check: "REQUESTED",
      clearance: "NOT_CLAIMED",
      next_handoff: "INDEPENDENT_AUDITOR",
      delegated_checks: DELEGATED_CHECKS,
      evidence: {
        changed_paths_sha256: pathValidation.changed_paths_sha256,
        validation_sha256: pathValidation.validation_sha256,
      },
      open_risks: [
        "SOURCE_BINDING_REQUIRES_HOST_READBACK",
        "FOCUSED_CHECK_EXECUTION_REQUIRES_VERIFICATION_RUNNER",
        "CONTENT_PORTABILITY_REQUIRES_SECURITY_PRIVACY_SCAN",
        "GENERATED_FILE_AUTHORITY_REQUIRES_TYPED_PROJECT_CONFIGURATION",
        "STALE_EVIDENCE_REQUIRES_SOURCE_SNAPSHOT_RECHECK",
      ],
    },
  };
  return {...body, result_sha256: digest(body)};
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("changed-path hygiene loaded\n");
