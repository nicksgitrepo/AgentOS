#!/usr/bin/env node

/*
 * Sealed authority adapter for independent auditor-round receipts.
 *
 * A round's local PASS is descriptive evidence only.  The collaborative
 * workflow may consume a round only after a separately provisioned evaluator
 * receipt has been resolved from this opaque, one-use store capability.
 */

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";
import {assertSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";
import {consumeProtectedSpawnerReviewProvisioning} from "./protected-spawner-review-provisioning.mjs";

export const AUDITOR_ROUND_REVIEW_SCHEMA = "agentos.auditor_round_independent_review.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_ID = /^[0-9a-f]{40}$/u;
const REF = /^opaque:(?:round|receipt|candidate):[A-Z0-9._:/-]{1,180}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{2,191}$/u;
const stores = new WeakMap();

function fail(message, code = "AUDITOR_ROUND_EXTERNAL_REVIEW_REQUIRED") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "AUDITOR_ROUND_REVIEW_SHAPE_INVALID"); assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields differ`, "AUDITOR_ROUND_REVIEW_UNKNOWN_FIELD"); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a content digest`, "AUDITOR_ROUND_REVIEW_DIGEST_INVALID"); }
function git(value, label) { assert(typeof value === "string" && GIT_ID.test(value) && !/^([0-9a-f])\1{39}$/u.test(value), `${label} is not a Git identity`, "AUDITOR_ROUND_REVIEW_GIT_INVALID"); }
function ref(value, label) { assert(typeof value === "string" && REF.test(value), `${label} is not an opaque reference`, "AUDITOR_ROUND_REVIEW_REF_INVALID"); }
function id(value, label) { assert(typeof value === "string" && IDENTIFIER.test(value), `${label} is not an identity`, "AUDITOR_ROUND_REVIEW_ID_INVALID"); }
function digestBody(value) { return canonicalDigest({...value, receipt_sha256: null}); }

export function installAuditorRoundReviewAuthority({sealedAuthority, reviewProvisioning} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  const {realRoot} = consumeProtectedSpawnerReviewProvisioning(reviewProvisioning);
  const receiptsRoot = path.join(realRoot, "receipts");
  const stat = fs.lstatSync(receiptsRoot, {throwIfNoEntry: false});
  assert(stat?.isDirectory() && !stat.isSymbolicLink(), "Independent round-review receipts directory is unavailable", "AUDITOR_ROUND_REVIEW_STORE_UNAVAILABLE");
  const capability = Object.freeze(Object.create(null));
  stores.set(capability, Object.freeze({realRoot, receiptsRoot, used: new Set()}));
  return capability;
}

function stateFor(authority) {
  const state = stores.get(authority);
  assert(state, "Independent round-review authority must be installed by sealed bootstrap", "AUDITOR_ROUND_REVIEW_AUTHORITY_REQUIRED");
  return state;
}

function readReceipt(state, receiptSha256) {
  sha(receiptSha256, "review receipt reference");
  assert(!state.used.has(receiptSha256), "Independent round-review receipt was already consumed", "AUDITOR_ROUND_REVIEW_REPLAY");
  const file = path.join(state.receiptsRoot, `${receiptSha256}.json`);
  assert(file.startsWith(`${state.receiptsRoot}${path.sep}`), "Review receipt path escaped its sealed store", "AUDITOR_ROUND_REVIEW_PATH_ESCAPE");
  const stat = fs.lstatSync(file, {throwIfNoEntry: false});
  assert(stat?.isFile() && !stat.isSymbolicLink(), "Independent round-review receipt is missing or aliased", "AUDITOR_ROUND_REVIEW_RECEIPT_MISSING");
  const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
  exact(receipt, ["schema", "version", "receipt_id", "issuer_id", "issuer_role", "result", "candidate_commit_sha1", "candidate_tree_sha1", "rollback_commit_sha1", "rollback_tree_sha1", "candidate_ref", "round_ref", "round_sha256", "package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256", "execution_sha256", "evaluator_admission_sha256", "authority_epoch", "issued_at_utc", "expires_at_utc", "signature_status", "receipt_sha256"], "independent round-review receipt");
  assert(receipt.schema === AUDITOR_ROUND_REVIEW_SCHEMA && receipt.version === 1, "Independent round-review receipt identity differs", "AUDITOR_ROUND_REVIEW_SCHEMA_MISMATCH");
  id(receipt.issuer_id, "review issuer"); assert(receipt.issuer_role === "AGENT.INDEPENDENT_EVALUATOR", "Review issuer is not a separately governed evaluator", "AUDITOR_ROUND_REVIEW_ISSUER_INVALID"); assert(receipt.result === "PASS" || receipt.result === "NOT_APPLICABLE_WITH_EVIDENCE", "Independent review did not pass", "AUDITOR_ROUND_REVIEW_NOT_PASS");
  for (const [key, value] of Object.entries({candidate_ref: receipt.candidate_ref, round_ref: receipt.round_ref, receipt_id: receipt.receipt_id})) ref(value, key);
  for (const [key, value] of Object.entries({candidate_commit_sha1: receipt.candidate_commit_sha1, candidate_tree_sha1: receipt.candidate_tree_sha1, rollback_commit_sha1: receipt.rollback_commit_sha1, rollback_tree_sha1: receipt.rollback_tree_sha1})) git(value, key);
  for (const key of ["round_sha256", "package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256", "execution_sha256", "evaluator_admission_sha256"]) sha(receipt[key], key);
  assert(receipt.signature_status === "VERIFIED_BY_EXTERNAL_EVALUATOR", "Review receipt is not externally verified", "AUDITOR_ROUND_REVIEW_SIGNATURE_REQUIRED");
  const issued = Date.parse(receipt.issued_at_utc), expires = Date.parse(receipt.expires_at_utc), now = Date.now(); assert(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && now <= expires && expires - issued <= 24 * 60 * 60 * 1000, "Review receipt is stale, future-dated, or too long-lived", "AUDITOR_ROUND_REVIEW_STALE");
  assert(receipt.receipt_sha256 === digestBody(receipt), "Review receipt digest differs", "AUDITOR_ROUND_REVIEW_DIGEST_MISMATCH");
  return receipt;
}

export function consumeAuditorRoundReview({authority, receiptSha256, expected = {}} = {}) {
  const state = stateFor(authority); const receipt = readReceipt(state, receiptSha256);
  for (const key of ["candidate_commit_sha1", "candidate_tree_sha1", "rollback_commit_sha1", "rollback_tree_sha1", "round_sha256", "package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256", "execution_sha256"]) {
    if (expected[key] !== undefined) assert(receipt[key] === expected[key], `Review receipt ${key} differs from the expected immutable binding`, "AUDITOR_ROUND_REVIEW_BINDING_MISMATCH");
  }
  state.used.add(receiptSha256);
  return Object.freeze(receipt);
}

