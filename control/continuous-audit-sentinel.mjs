#!/usr/bin/env node

import crypto from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const STATUSES = Object.freeze(["ACTIVE", "ARCHIVED_UNPINNED"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label, pattern = null) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  if (pattern !== null) assert(pattern.test(value), `${label} is invalid`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function sentinelDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

const SENTINEL_KEYS = [
  "schema", "campaign_id", "campaign_version", "logical_lineage_id", "role_id", "auditor_session_id",
  "status", "read_only", "pinned", "scope", "started_at_utc", "archived_at_utc", "archive_reason", "sentinel_sha256",
];

export function validateContinuousAuditSentinel(sentinel, {campaignId, campaignVersion, logicalLineageId, auditorSessionId} = {}) {
  assert(sentinel && typeof sentinel === "object" && !Array.isArray(sentinel), "continuous audit sentinel must be an object");
  assert(JSON.stringify(Object.keys(sentinel).sort()) === JSON.stringify([...SENTINEL_KEYS].sort()), "continuous audit sentinel fields mismatch");
  assert(sentinel.schema === "governance.continuous_audit_sentinel.v1", "continuous audit sentinel schema mismatch");
  for (const [value, label] of [[sentinel.campaign_id, "sentinel campaign ID"], [sentinel.campaign_version, "sentinel campaign version"], [sentinel.logical_lineage_id, "sentinel lineage"], [sentinel.role_id, "sentinel role"], [sentinel.auditor_session_id, "sentinel Auditor session"], [sentinel.scope, "sentinel scope"]]) requireString(value, label, IDENTIFIER);
  assert(sentinel.role_id === "CONTINUOUS_AUDIT_SENTINEL", "continuous audit sentinel role is invalid");
  assert(STATUSES.includes(sentinel.status), "continuous audit sentinel status is invalid");
  assert(sentinel.read_only === true && typeof sentinel.pinned === "boolean", "continuous audit sentinel custody is invalid");
  assert(sentinel.status === "ACTIVE" ? sentinel.pinned === true : sentinel.pinned === false, "continuous audit sentinel pin state does not match status");
  requireUtc(sentinel.started_at_utc, "continuous audit sentinel start time");
  if (sentinel.archived_at_utc === null) assert(sentinel.status === "ACTIVE" && sentinel.archive_reason === null, "active continuous audit sentinel carries archive metadata");
  else {
    requireUtc(sentinel.archived_at_utc, "continuous audit sentinel archive time");
    requireString(sentinel.archive_reason, "continuous audit sentinel archive reason");
    assert(sentinel.status === "ARCHIVED_UNPINNED", "archived continuous audit sentinel status is invalid");
  }
  if (campaignId !== undefined) assert(sentinel.campaign_id === campaignId, "continuous audit sentinel campaign mismatch");
  if (campaignVersion !== undefined) assert(sentinel.campaign_version === campaignVersion, "continuous audit sentinel version mismatch");
  if (logicalLineageId !== undefined) assert(sentinel.logical_lineage_id === logicalLineageId, "continuous audit sentinel lineage mismatch");
  if (auditorSessionId !== undefined) assert(sentinel.auditor_session_id === auditorSessionId, "continuous audit sentinel Auditor mismatch");
  requireSha(sentinel.sentinel_sha256, "continuous audit sentinel digest");
  assert(sentinel.sentinel_sha256 === sentinelDigest({...sentinel, sentinel_sha256: null}), "continuous audit sentinel is not content-addressed");
  return sentinel;
}

export function compileContinuousAuditSentinel({campaignId, campaignVersion, logicalLineageId, auditorSessionId, startedAtUtc, scope = "CAMPAIGN_LIFETIME_READ_ONLY_AUDIT"}) {
  const sentinel = {
    schema: "governance.continuous_audit_sentinel.v1",
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    logical_lineage_id: logicalLineageId,
    role_id: "CONTINUOUS_AUDIT_SENTINEL",
    auditor_session_id: auditorSessionId,
    status: "ACTIVE",
    read_only: true,
    pinned: true,
    scope,
    started_at_utc: startedAtUtc,
    archived_at_utc: null,
    archive_reason: null,
    sentinel_sha256: null,
  };
  sentinel.sentinel_sha256 = sentinelDigest({...sentinel, sentinel_sha256: null});
  return validateContinuousAuditSentinel(sentinel);
}

export function archiveContinuousAuditSentinel(sentinel, {archivedAtUtc, reason = "ACCEPTED_LIVE_CLOSURE"} = {}) {
  validateContinuousAuditSentinel(sentinel);
  assert(sentinel.status === "ACTIVE", "continuous audit sentinel is already archived");
  requireUtc(archivedAtUtc, "continuous audit sentinel archive time");
  requireString(reason, "continuous audit sentinel archive reason");
  const archived = {
    ...structuredClone(sentinel),
    status: "ARCHIVED_UNPINNED",
    pinned: false,
    archived_at_utc: archivedAtUtc,
    archive_reason: reason,
    sentinel_sha256: null,
  };
  archived.sentinel_sha256 = sentinelDigest({...archived, sentinel_sha256: null});
  return validateContinuousAuditSentinel(archived);
}

export function requireActiveContinuousAuditSentinel(sentinel, expected = {}) {
  validateContinuousAuditSentinel(sentinel, expected);
  assert(sentinel.status === "ACTIVE" && sentinel.pinned === true, "continuous audit sentinel is not active and pinned");
  return sentinel;
}

