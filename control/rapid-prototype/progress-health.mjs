#!/usr/bin/env node

/*
 * Compact progress/liveness observation for one bounded worker outcome.
 *
 * A heartbeat proves that the observation channel is alive.  It never counts
 * as meaningful progress, extends the deadline, or proves completion.
 */

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;

export const PROGRESS_HEALTH_SCHEMA = "agentos.rapid_prototype.progress_health.v1";
export const PROGRESS_STATUSES = Object.freeze(["IN_PROGRESS", "COMPLETED", "TIMEOUT", "FAILED", "BLOCKED", "UNAVAILABLE"]);
export const PROGRESS_KINDS = Object.freeze(["MEANINGFUL", "HEARTBEAT_ONLY", "NO_PROGRESS"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(value === value.trim(), `${label} must not have surrounding whitespace`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentity(value, label) {
  requireString(value, label);
  assert(IDENTITY.test(value), `${label} is not a stable identity`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object`);
}

function validateProgressEvidence({taskId, scope, sourceCommit, sourceTree, evidence}, required) {
  if (!required) return null;
  requireIdentity(taskId, "progress task ID");
  assert(Array.isArray(scope) && scope.length > 0, "progress scope is required for meaningful progress");
  const scopeIds = scope.map((value) => {
    requireIdentity(value, "progress scope item");
    return value;
  });
  assert(new Set(scopeIds).size === scopeIds.length, "progress scope items must be unique");
  requireGitObject(sourceCommit, "progress source commit");
  requireGitObject(sourceTree, "progress source tree");
  assert(isRecord(evidence), "progress evidence is required for meaningful progress");
  const evidenceKeys = ["digest", "identity", "kind"];
  assert(JSON.stringify(Object.keys(evidence).sort()) === JSON.stringify(evidenceKeys), "progress evidence fields are invalid");
  requireIdentity(evidence.kind, "progress evidence kind");
  requireIdentity(evidence.identity, "progress evidence identity");
  requireSha(evidence.digest, "progress evidence digest");
  return {
    task_id: taskId,
    scope: scopeIds,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    kind: evidence.kind,
    identity: evidence.identity,
    digest: evidence.digest,
  };
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
  return Date.parse(value);
}

function clone(value) {
  return value === undefined ? null : structuredClone(value);
}

function statusToken(value, label) {
  let token = value;
  if (isRecord(value)) token = value.status ?? value.outcome ?? value.state ?? value.code ?? value.kind;
  requireString(token, `${label} status`);
  return token.trim().toUpperCase().replace(/[\s-]+/gu, "_");
}

function classifyResult(result) {
  if (result === undefined || result === null) return "PENDING";
  if (typeof result === "boolean") return result ? "SUCCESS" : "PENDING";

  const token = statusToken(result, "progress result");
  if (["SUCCESS", "SUCCEEDED", "COMPLETE", "COMPLETED", "DONE", "PASS", "PASSED"].includes(token)) return "SUCCESS";
  if (["FAIL", "FAILED", "FAILURE", "ERROR"].includes(token)) return "FAILED";
  if (["BLOCKED", "WAITING", "HELD"].includes(token)) return "BLOCKED";
  if (["UNAVAILABLE", "UNKNOWN", "UNPROVEN"].includes(token)) return "UNAVAILABLE";
  if (["PENDING", "IN_PROGRESS", "NOT_STARTED", "NOT_RUN"].includes(token)) return "PENDING";
  throw new Error(`progress result status is unsupported: ${token}`);
}

function classifyError(error) {
  if (error === undefined || error === null) return "NONE";

  if (typeof error === "string") {
    requireString(error, "progress error");
    const token = error.toUpperCase();
    if (/\bUNAVAILABLE\b|\bUNKNOWN\b|CAPABILITY_/u.test(token)) return "UNAVAILABLE";
    if (/\bBLOCKED\b|\bWAITING\b|\bHELD\b/u.test(token)) return "BLOCKED";
    return "FAILED";
  }

  if (isRecord(error)) {
    const candidate = error.status ?? error.kind ?? error.code ?? error.type;
    if (candidate !== undefined) {
      const token = statusToken(candidate, "progress error");
      if (["UNAVAILABLE", "UNKNOWN"].includes(token)) return "UNAVAILABLE";
      if (["BLOCKED", "WAITING", "HELD"].includes(token)) return "BLOCKED";
    }
    assert(Object.keys(error).length > 0, "progress error must not be empty");
    return "FAILED";
  }

  throw new Error("progress error must be text or an object");
}

function resolveStatus({resultStatus, errorStatus, observedAtMs, deadlineMs}) {
  if (errorStatus === "UNAVAILABLE") return "UNAVAILABLE";
  if (errorStatus === "BLOCKED") return "BLOCKED";
  if (errorStatus === "FAILED") return "FAILED";
  if (resultStatus === "UNAVAILABLE") return "UNAVAILABLE";
  if (resultStatus === "BLOCKED") return "BLOCKED";
  if (resultStatus === "FAILED") return "FAILED";
  if (resultStatus === "SUCCESS") return observedAtMs <= deadlineMs ? "COMPLETED" : "TIMEOUT";
  return observedAtMs > deadlineMs ? "TIMEOUT" : "IN_PROGRESS";
}

function healthFor(status, heartbeat) {
  if (status === "UNAVAILABLE") return "UNAVAILABLE";
  if (status === "TIMEOUT") return heartbeat ? "DEGRADED" : "STALE";
  if (status === "BLOCKED" || status === "FAILED") return "DEGRADED";
  if (status === "COMPLETED") return "HEALTHY";
  return heartbeat ? "HEALTHY" : "STALE";
}

export function recordProgress({
  workerIdentity,
  phase,
  meaningfulProgress,
  heartbeat,
  startedAt,
  observedAt,
  deadline,
  result = null,
  error = null,
  taskId = null,
  scope = null,
  sourceCommit = null,
  sourceTree = null,
  evidence = null,
  progressEvidence = null,
}) {
  requireIdentity(workerIdentity, "worker identity");
  requireString(phase, "progress phase");
  assert(typeof meaningfulProgress === "boolean", "meaningful progress must be boolean");
  assert(typeof heartbeat === "boolean", "heartbeat must be boolean");
  const startedAtMs = requireUtc(startedAt, "progress start time");
  const observedAtMs = requireUtc(observedAt, "progress observation time");
  const deadlineMs = requireUtc(deadline, "progress deadline");
  assert(observedAtMs >= startedAtMs, "progress observation precedes its start");
  assert(deadlineMs >= startedAtMs, "progress deadline precedes its start");

  const resultStatus = classifyResult(result);
  const errorStatus = classifyError(error);
  assert(resultStatus !== "SUCCESS" || meaningfulProgress === true, "successful progress requires meaningful evidence");
  const progressEvidenceRecord = validateProgressEvidence({
    taskId,
    scope,
    sourceCommit,
    sourceTree,
    evidence: progressEvidence ?? evidence,
  }, meaningfulProgress === true || resultStatus === "SUCCESS");
  const status = resolveStatus({resultStatus, errorStatus, observedAtMs, deadlineMs});
  const progress = progressEvidenceRecord !== null ? "MEANINGFUL" : heartbeat ? "HEARTBEAT_ONLY" : "NO_PROGRESS";

  return {
    schema: PROGRESS_HEALTH_SCHEMA,
    version: 1,
    worker_identity: workerIdentity,
    phase,
    task_id: taskId,
    scope: clone(scope),
    source_commit: sourceCommit,
    source_tree: sourceTree,
    progress_evidence: clone(progressEvidenceRecord),
    progress_evidence_digest: progressEvidenceRecord?.digest ?? null,
    progress,
    meaningful_progress: progressEvidenceRecord !== null,
    heartbeat,
    liveness: heartbeat ? "LIVE" : "UNKNOWN",
    health: healthFor(status, heartbeat),
    started_at: startedAt,
    observed_at: observedAt,
    deadline,
    result: clone(result),
    result_status: resultStatus,
    error: clone(error),
    error_status: errorStatus,
    status,
    completed: status === "COMPLETED",
    timed_out: status === "TIMEOUT",
  };
}
