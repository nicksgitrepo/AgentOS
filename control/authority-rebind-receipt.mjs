#!/usr/bin/env node

/*
 * Project-agnostic authority rebind receipt.
 *
 * A repair may change the portable AgentOS authority while a live lane is
 * holding an older source digest.  The rebind itself is governance state, not
 * commentary: it must be content-addressed, prove the clean remote/tree
 * identity, describe the exact repair gate, and carry the same custody
 * boundary that the successor will consume.  A null or hand-written receipt
 * is therefore never admissible as a current authority.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const AUTHORITY_REBIND_RECEIPT_SCHEMA = "agentos.authority_rebind_receipt.v1";
export const AUTHORITY_REBIND_RECEIPT_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const TEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:|refs\/)[^\s]+$/u;
const RECEIPT_KEYS = Object.freeze([
  "schema", "version", "receipt_id", "status", "authority", "repair", "focused_checks", "check_status",
  "custody", "superseded_history", "receipt_sha256",
]);
const AUTHORITY_KEYS = Object.freeze(["repository", "branch", "remote_ref", "commit", "tree", "parent", "remote_verified", "worktree_clean"]);
const REPAIR_KEYS = Object.freeze(["helper", "source_helper", "schema", "rule"]);
const CUSTODY_KEYS = Object.freeze([
  "execution_owner", "direct_consumer", "controller_approval_required", "control_plane_only", "consumer_product_mutated",
  "protected_action", "provider_access", "credential_access", "spend", "destructive_work", "wave_activation",
]);
const HISTORY_KEYS = Object.freeze(["commit", "tree", "status", "preserved"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  assert(value !== "0".repeat(64) && value !== "f".repeat(64), `${label} may not be a placeholder digest`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a 40-character Git object`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireTextId(value, label) {
  assert(typeof value === "string" && TEXT_ID.test(value), `${label} must be a non-empty stable text identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must be non-empty`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid entry`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function validateAuthority(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "Authority rebind identity");
  requireTextId(authority.repository, "Authority repository");
  requireTextId(authority.branch, "Authority branch");
  requireReference(authority.remote_ref, "Authority remote ref");
  requireGitObject(authority.commit, "Authority commit");
  requireGitObject(authority.tree, "Authority tree");
  requireGitObject(authority.parent, "Authority parent");
  assert(authority.remote_verified === true, "Authority remote identity is not verified");
  assert(authority.worktree_clean === true, "Authority worktree is not clean");
  return authority;
}

function validateRepair(repair) {
  exactKeys(repair, REPAIR_KEYS, "Authority rebind repair");
  for (const key of ["helper", "source_helper", "schema"]) requireTextId(repair[key], `Authority rebind repair ${key}`);
  assert(typeof repair.rule === "string" && repair.rule.trim().length >= 24, "Authority rebind repair rule is incomplete");
  return repair;
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "Authority rebind custody");
  requireIdentifier(custody.execution_owner, "Authority rebind execution owner");
  requireIdentifier(custody.direct_consumer, "Authority rebind direct consumer");
  for (const key of ["controller_approval_required", "control_plane_only", "consumer_product_mutated", "protected_action", "provider_access", "credential_access", "spend", "destructive_work"]) {
    assert(typeof custody[key] === "boolean", `Authority rebind custody ${key} must be boolean`);
  }
  assert(custody.execution_owner === "LANE_AGENT", "Authority rebind must remain lane-owned");
  assert(custody.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Authority rebind must route to independent platform review");
  assert(custody.controller_approval_required === false, "Authority rebind cannot require Controller approval");
  assert(custody.control_plane_only === true, "Authority rebind must be control-plane-only");
  for (const key of ["consumer_product_mutated", "protected_action", "provider_access", "credential_access", "spend", "destructive_work"]) assert(custody[key] === false, `Authority rebind custody crosses protected boundary: ${key}`);
  assert(custody.wave_activation === "OFF", "Authority rebind cannot activate a wave");
  return custody;
}

function validateHistory(history) {
  assert(Array.isArray(history), "Authority rebind superseded history is required");
  for (const [index, entry] of history.entries()) {
    exactKeys(entry, HISTORY_KEYS, `Authority rebind superseded history ${index}`);
    requireGitObject(entry.commit, `Authority rebind superseded history ${index} commit`);
    requireGitObject(entry.tree, `Authority rebind superseded history ${index} tree`);
    requireTextId(entry.status, `Authority rebind superseded history ${index} status`);
    assert(entry.preserved === true, `Authority rebind superseded history ${index} must be preserved`);
  }
  const commits = history.map((entry) => entry.commit);
  const ordered = [...commits].sort(compareUtf8);
  assert(new Set(commits).size === commits.length && JSON.stringify(commits) === JSON.stringify(ordered), "Authority rebind superseded history must be sorted and unique");
  return history;
}

export function validateAuthorityRebindReceipt(receipt) {
  exactKeys(receipt, RECEIPT_KEYS, "Authority rebind receipt");
  assert(receipt.schema === AUTHORITY_REBIND_RECEIPT_SCHEMA && receipt.version === AUTHORITY_REBIND_RECEIPT_VERSION, "Authority rebind receipt identity is invalid");
  requireIdentifier(receipt.receipt_id, "Authority rebind receipt ID");
  assert(receipt.status === "CURRENT_AUTHORITY_REBOUND", "Authority rebind receipt status is not current");
  validateAuthority(receipt.authority);
  validateRepair(receipt.repair);
  sortedUnique(receipt.focused_checks, "Authority rebind focused checks");
  assert(receipt.check_status === "PASS", "Authority rebind focused checks did not pass");
  validateCustody(receipt.custody);
  validateHistory(receipt.superseded_history);
  requireSha(receipt.receipt_sha256, "Authority rebind receipt digest");
  assert(receipt.receipt_sha256 === canonicalDigest({...receipt, receipt_sha256: null}), "Authority rebind receipt digest mismatch");
  return receipt;
}

export function compileAuthorityRebindReceipt({receiptId, authority, repair, focusedChecks, custody, supersededHistory = []} = {}) {
  requireIdentifier(receiptId, "Authority rebind receipt ID");
  const receipt = {
    schema: AUTHORITY_REBIND_RECEIPT_SCHEMA,
    version: AUTHORITY_REBIND_RECEIPT_VERSION,
    receipt_id: receiptId,
    status: "CURRENT_AUTHORITY_REBOUND",
    authority: structuredClone(authority),
    repair: structuredClone(repair),
    focused_checks: [...focusedChecks].sort(compareUtf8),
    check_status: "PASS",
    custody: structuredClone(custody),
    superseded_history: structuredClone(supersededHistory).sort((left, right) => compareUtf8(left.commit, right.commit)),
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = canonicalDigest({...receipt, receipt_sha256: null});
  return validateAuthorityRebindReceipt(receipt);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Authority rebind receipt gate loaded\n");
