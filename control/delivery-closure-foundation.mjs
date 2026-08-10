#!/usr/bin/env node

/*
 * Portable delivery and closure boundary.
 *
 * This module records owner intent and validates host-supplied receipts. It
 * never performs a protected action, reads credentials, opens a network
 * connection, or calls a host adapter.
 */

import crypto from "node:crypto";

const DELIVERY_CHOICE_SCHEMA = "agentos.delivery_choice.v2";
const DELIVERY_STATE_SCHEMA = "agentos.delivery_state.v1";
const RUNTIME_REQUEST_SCHEMA = "agentos.runtime_delivery_request.v1";
const RUNTIME_RECEIPT_SCHEMA = "agentos.delivery_receipt.v1";
const ROLLBACK_RECEIPT_SCHEMA = "agentos.rollback_receipt.v1";
const LIVE_AUDIT_SCHEMA = "agentos.delivery_live_audit_receipt.v1";
const FINAL_HANDOFF_SCHEMA = "agentos.delivery_final_handoff.v1";
const CLOSURE_SCHEMA = "agentos.delivery_closure.v1";

const DELIVERY_OUTCOMES = Object.freeze([
  "LOCAL_ONLY",
  "PREPARED",
  "PUSH",
  "MERGE",
  "DEPLOY",
  "RELEASE",
  "ROLLBACK",
]);

const DELIVERY_ACTIONS = Object.freeze([
  "NONE",
  "PUSH",
  "MERGE",
  "DEPLOY",
  "RELEASE",
  "ROLLBACK",
]);

const DELIVERY_STATE_STATUSES = Object.freeze([
  "CHOICE_REQUIRED",
  "CHOICE_SELECTED",
  "RUNTIME_AUTHORIZED",
  "ACTION_IN_FLIGHT",
  "RECEIPT_VERIFIED",
  "LIVE_AUDIT_PENDING",
  "CLOSURE_PENDING",
  "ROLLBACK_REQUIRED",
  "CLOSED",
  "FAILED",
  "UNKNOWN",
]);

const RUNTIME_REQUEST_STATUSES = Object.freeze(["PREPARED", "AUTHORIZED"]);
const RUNTIME_RECEIPT_STATUSES = Object.freeze([
  "IN_FLIGHT",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
  "NO_EXTERNAL_ACTION",
]);
const LIVE_AUDIT_STATUSES = Object.freeze(["PASS", "FAIL", "UNKNOWN"]);
const CLOSURE_ROSTER_STATUSES = Object.freeze(["VERIFIED_ZERO_ACTIVE"]);

const ACTION_BY_OUTCOME = Object.freeze({
  LOCAL_ONLY: "NONE",
  PREPARED: "NONE",
  PUSH: "PUSH",
  MERGE: "MERGE",
  DEPLOY: "DEPLOY",
  RELEASE: "RELEASE",
  ROLLBACK: "ROLLBACK",
});

const EXTERNAL_OUTCOMES = new Set(["PUSH", "MERGE", "DEPLOY", "RELEASE", "ROLLBACK"]);
const LIVE_OUTCOMES = new Set(["DEPLOY", "RELEASE"]);
const RECEIPT_SUCCESS_OUTCOMES = new Set(["LOCAL_ONLY", "PUSH", "MERGE", "DEPLOY", "RELEASE", "ROLLBACK"]);
const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_ID = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const OPAQUE_REF = /^opaque:[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SAFE_CODE = /^[A-Z][A-Z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;
const CREDENTIAL_URL = /https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu;
const ABSOLUTE_PATH = /(?:^|[\s("'])\/(?:Users|home|private|tmp|var|etc|opt|srv|workspace|workspaces)(?:[\/\s)"]|$)/iu;
const WINDOWS_PATH = /(?:^|[\s("'])[A-Za-z]:[\\/]/u;

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
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(!SECRET_PATTERN.test(value), `${label} contains secret material`);
  assert(!CREDENTIAL_URL.test(value), `${label} contains a credential-bearing URL`);
  assert(!ABSOLUTE_PATH.test(value) && !WINDOWS_PATH.test(value), `${label} contains a private path`);
}

function nullableString(value, label) {
  if (value !== null) requireString(value, label);
}

function enumValue(value, allowed, label) {
  assert(allowed.includes(value), `${label} is invalid`);
}

function safeId(value, label) {
  requireString(value, label);
  assert(SAFE_ID.test(value) && !value.includes("/") && !value.includes("\\") && !value.includes(".."), `${label} is unsafe`);
}

function safeCode(value, label) {
  requireString(value, label);
  assert(SAFE_CODE.test(value), `${label} is not a safe code`);
}

function opaqueRef(value, label) {
  requireString(value, label);
  assert(OPAQUE_REF.test(value), `${label} must be an opaque reference`);
}

function nullableOpaqueRef(value, label) {
  if (value !== null) opaqueRef(value, label);
}

function sha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256 digest`);
}

function nullableSha(value, label) {
  if (value !== null) sha(value, label);
}

function sourceId(value, label) {
  assert(typeof value === "string" && SOURCE_ID.test(value), `${label} must be a 40-character source identity`);
}

function time(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value), `${label} must be an ISO UTC timestamp`);
  assert(new Date(value).toISOString() === value, `${label} is not a valid timestamp`);
}

function positiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
}

function nonnegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative integer`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function digestWithout(value, field = "digest") {
  const body = {...value};
  delete body[field];
  return canonicalDigest(body);
}

function withDigest(value, field = "digest") {
  const result = {...value, [field]: null};
  result[field] = digestWithout(result, field);
  return result;
}

function validateDigest(value, label, record, field = "digest") {
  sha(value, label);
  assert(value === digestWithout(record, field), `${label} does not match content`);
}

function validateCodes(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    safeCode(value, `${label}[${index}]`);
    assert(!seen.has(value), `${label} contains a duplicate code`);
    seen.add(value);
  }
}

function validateDigestList(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    sha(value, `${label}[${index}]`);
    assert(!seen.has(value), `${label} contains a duplicate digest`);
    seen.add(value);
  }
}

function contextMatches(record, context, label) {
  for (const field of ["project_ref", "campaign_id", "campaign_version", "goal_id"]) {
    if (context[field] !== undefined) assert(record[field] === context[field], `${label} ${field} differs from expected context`);
  }
}

function validateOwnerApproval(approval, expectedScopeDigest) {
  exactKeys(approval, ["decision", "scope_digest", "approval_ref", "approved_at_utc", "digest"], "owner approval");
  assert(approval.decision === "APPROVE", "owner approval must explicitly approve");
  sha(approval.scope_digest, "owner approval scope digest");
  assert(approval.scope_digest === expectedScopeDigest, "owner approval scope differs from delivery choice");
  opaqueRef(approval.approval_ref, "owner approval reference");
  time(approval.approved_at_utc, "owner approval time");
  validateDigest(approval.digest, "owner approval digest", approval);
  return approval;
}

function compileOwnerApproval(approval, scopeDigest) {
  requireRecord(approval, "owner approval");
  exactKeys(approval, ["decision", "scope_digest", "approval_ref", "approved_at_utc"], "owner approval input");
  const result = withDigest({
    decision: approval.decision,
    scope_digest: approval.scope_digest ?? scopeDigest,
    approval_ref: approval.approval_ref,
    approved_at_utc: approval.approved_at_utc,
  });
  return validateOwnerApproval(result, scopeDigest);
}

function validateChoiceBindings(choice) {
  const prepared = choice.outcome === "PREPARED";
  const rollback = choice.outcome === "ROLLBACK";
  if (prepared) {
    assert(choice.accepted_result_digest === null && choice.final_audit_digest === null, "prepared choice cannot claim acceptance");
  } else {
    sha(choice.accepted_result_digest, "choice accepted result digest");
    sha(choice.final_audit_digest, "choice final audit digest");
  }
  for (const field of ["source_commit", "source_tree"]) sourceId(choice[field], `choice ${field}`);
  opaqueRef(choice.worktree_ref, "choice worktree reference");
  if (["DEPLOY", "RELEASE", "ROLLBACK"].includes(choice.outcome)) opaqueRef(choice.environment_ref, "choice environment reference");
  else nullableOpaqueRef(choice.environment_ref, "choice environment reference");
  if (rollback) sha(choice.rollback_target_digest, "rollback target digest");
  else assert(choice.rollback_target_digest === null, "non-rollback choice cannot name a rollback target");
}

export {
  DELIVERY_CHOICE_SCHEMA,
  DELIVERY_STATE_SCHEMA,
  RUNTIME_REQUEST_SCHEMA,
  RUNTIME_RECEIPT_SCHEMA,
  ROLLBACK_RECEIPT_SCHEMA,
  LIVE_AUDIT_SCHEMA,
  FINAL_HANDOFF_SCHEMA,
  CLOSURE_SCHEMA,
  DELIVERY_OUTCOMES,
  DELIVERY_ACTIONS,
  DELIVERY_STATE_STATUSES,
  RUNTIME_REQUEST_STATUSES,
  RUNTIME_RECEIPT_STATUSES,
  LIVE_AUDIT_STATUSES,
  CLOSURE_ROSTER_STATUSES,
  ACTION_BY_OUTCOME,
  EXTERNAL_OUTCOMES,
  LIVE_OUTCOMES,
  assert,
  requireRecord,
  exactKeys,
  requireString,
  nullableString,
  enumValue,
  safeId,
  safeCode,
  opaqueRef,
  nullableOpaqueRef,
  sha,
  nullableSha,
  sourceId,
  time,
  positiveInteger,
  nonnegativeInteger,
  canonicalDigest,
  digestWithout,
  withDigest,
  validateDigest,
  validateCodes,
  validateDigestList,
  contextMatches,
  validateOwnerApproval,
  compileOwnerApproval,
  validateChoiceBindings,
};
