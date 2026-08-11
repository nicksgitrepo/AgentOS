import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RETAINED_FAILED_ATTEMPT_MARKER = ".agentos-retained-failed-attempt.json";
const SHA256 = /^[0-9a-f]{64}$/u;
const TASK_ID = /^[A-Z0-9][A-Z0-9:_-]*$/u;
const OPAQUE_ERROR = /^opaque:error:[0-9a-f]{64}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requireRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular file`);
}

function digestBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]), `${label} fields are invalid`);
}

function resolveEvidencePath(root, relativePath) {
  assert(typeof relativePath === "string" && relativePath.length > 0 && !path.isAbsolute(relativePath), "retained failure RCA path must be relative");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  assert(isContained(resolvedRoot, resolved) && resolved !== resolvedRoot, "retained failure RCA path escapes the campaign root");
  return resolved;
}

export function validateRetainedFailedAttemptMarker(marker, {directory, root}) {
  exactKeys(marker, [
    "schema", "version", "status", "active_checkpoint", "evidence_retained", "task_id",
    "failure_rca_path", "failure_rca_sha256", "reason",
  ], "retained failed attempt marker");
  assert(marker.schema === "agentos.retained_failed_attempt.v1" && marker.version === 1, "retained failed attempt marker identity is invalid");
  assert(marker.status === "RETAINED_FAILED_ATTEMPT", "retained failed attempt marker status is invalid");
  assert(marker.active_checkpoint === false, "an active checkpoint cannot be skipped");
  assert(marker.evidence_retained === true, "retained failed attempt has no retained evidence");
  assert(typeof marker.task_id === "string" && TASK_ID.test(marker.task_id), "retained failed attempt task identity is invalid");
  assert(typeof marker.reason === "string" && marker.reason.length > 0, "retained failed attempt reason is missing");
  assert(typeof marker.failure_rca_sha256 === "string" && SHA256.test(marker.failure_rca_sha256), "retained failure RCA digest is invalid");

  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  assert(isContained(resolvedRoot, resolvedDirectory), "retained failed attempt directory escapes the root");
  const rcaPath = resolveEvidencePath(resolvedRoot, marker.failure_rca_path);
  requireRegularFile(rcaPath, "retained failure RCA");
  const rcaBytes = fs.readFileSync(rcaPath);
  assert(digestBytes(rcaBytes) === marker.failure_rca_sha256, "retained failure RCA digest mismatch");
  const rca = JSON.parse(rcaBytes.toString("utf8"));
  assert(rca && rca.status === "OPEN_REPAIR_REQUIRED", "retained failure RCA is not open");
  assert(typeof rca.failed_command === "string" && rca.failed_command.length > 0, "retained failure RCA has no failed command");
  assert(typeof rca.error_message_exact === "string" && OPAQUE_ERROR.test(rca.error_message_exact), "retained failure RCA error must be opaque");
  return marker;
}

export function readRetainedFailedAttemptMarker(directory, root) {
  const markerPath = path.join(directory, RETAINED_FAILED_ATTEMPT_MARKER);
  if (!fs.existsSync(markerPath)) return null;
  requireRegularFile(markerPath, "retained failed attempt marker");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  return validateRetainedFailedAttemptMarker(marker, {directory, root});
}

export function isRetainedFailedAttempt(directory, root) {
  return readRetainedFailedAttemptMarker(directory, root) !== null;
}
