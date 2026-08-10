#!/usr/bin/env node

/*
 * Content-addressed result for the Bootstrap project-contract compiler.
 * The receipt records only safe digests, typed blocking state, and public
 * failure codes; it never carries compiler error text or owner input.
 */

import {
  canonicalDigest,
} from "./bootstrap-conversation.mjs";

export const BOOTSTRAP_COMPILE_RECEIPT_SCHEMA = "agentos.bootstrap_compile_receipt.v1";
export const BOOTSTRAP_COMPILE_RECEIPT_VERSION = 1;
export const BOOTSTRAP_COMPILE_RECEIPT_STATUSES = Object.freeze([
  "QUESTION_PENDING",
  "READY",
  "REASSESSMENT_REQUIRED",
  "BLOCKED",
]);
export const BOOTSTRAP_COMPILE_FAILURE_CODES = Object.freeze([
  "COMPILATION_VALIDATION_FAILURE",
  "PRIVACY_BOUNDARY_FAILURE",
  "INTEGRITY_FAILURE",
  "UNKNOWN_INPUT_REJECTED",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_TOKEN = /^[a-z][a-z0-9._-]{0,127}$/u;
const SAFE_QUESTION_ID = /^[a-z][a-z0-9._-]{0,127}$/u;
const RECEIPT_KEYS = Object.freeze([
  "schema",
  "version",
  "status",
  "conversation_sha256",
  "discovery_sha256",
  "contract_sha256",
  "intent_scope_sha256",
  "blocking_question_ids",
  "failure_code",
  "reassessment_required",
  "compiler_version",
  "receipt_sha256",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} keys are invalid`);
}

function assertOptionalSha(value, label) {
  assert(value === null || (typeof value === "string" && SHA256.test(value)), `${label} must be a SHA-256 or null`);
}

function assertQuestionIds(value) {
  assert(Array.isArray(value), "blocking question ids must be a list");
  const sorted = [...value].sort();
  assert(JSON.stringify(value) === JSON.stringify(sorted), "blocking question ids must be sorted");
  assert(new Set(value).size === value.length, "blocking question ids must be unique");
  value.forEach((questionId) => assert(typeof questionId === "string" && SAFE_QUESTION_ID.test(questionId), "blocking question id is invalid"));
}

export function validateBootstrapCompileReceipt(receipt) {
  assert(isRecord(receipt), "Bootstrap compile receipt must be an object");
  assertExactKeys(receipt, RECEIPT_KEYS, "Bootstrap compile receipt");
  assert(receipt.schema === BOOTSTRAP_COMPILE_RECEIPT_SCHEMA && receipt.version === BOOTSTRAP_COMPILE_RECEIPT_VERSION, "Bootstrap compile receipt identity is invalid");
  assert(BOOTSTRAP_COMPILE_RECEIPT_STATUSES.includes(receipt.status), "Bootstrap compile receipt status is invalid");
  assertOptionalSha(receipt.conversation_sha256, "Bootstrap compile receipt conversation digest");
  assertOptionalSha(receipt.discovery_sha256, "Bootstrap compile receipt discovery digest");
  assertOptionalSha(receipt.contract_sha256, "Bootstrap compile receipt contract digest");
  assertOptionalSha(receipt.intent_scope_sha256, "Bootstrap compile receipt intent/scope digest");
  assertQuestionIds(receipt.blocking_question_ids);
  assert(receipt.failure_code === null || BOOTSTRAP_COMPILE_FAILURE_CODES.includes(receipt.failure_code), "Bootstrap compile receipt failure code is invalid");
  assert(typeof receipt.reassessment_required === "boolean", "Bootstrap compile receipt reassessment flag is invalid");
  assert(typeof receipt.compiler_version === "string" && SAFE_TOKEN.test(receipt.compiler_version), "Bootstrap compile receipt compiler version is invalid");
  assert(typeof receipt.receipt_sha256 === "string" && SHA256.test(receipt.receipt_sha256), "Bootstrap compile receipt digest is invalid");

  if (receipt.status === "BLOCKED") {
    assert(receipt.contract_sha256 === null && receipt.intent_scope_sha256 === null, "blocked receipt cannot bind a contract");
    assert(receipt.failure_code !== null, "blocked receipt requires a failure code");
    assert(receipt.blocking_question_ids.length === 0, "blocked receipt cannot expose owner questions");
    assert(receipt.reassessment_required === false, "blocked receipt cannot request reassessment");
  } else {
    assert(receipt.conversation_sha256 !== null && receipt.discovery_sha256 !== null, "successful receipt source digests are required");
    assert(receipt.contract_sha256 !== null && receipt.intent_scope_sha256 !== null, "successful receipt contract digests are required");
    assert(receipt.failure_code === null, "successful receipt cannot carry a failure code");
    if (receipt.status === "QUESTION_PENDING") {
      assert(receipt.blocking_question_ids.length > 0, "question-pending receipt requires blocking questions");
      assert(receipt.reassessment_required === false, "question-pending receipt cannot request reassessment");
    }
    if (receipt.status === "READY") {
      assert(receipt.blocking_question_ids.length === 0, "ready receipt has blocking questions");
      assert(receipt.reassessment_required === false, "ready receipt cannot request reassessment");
    }
    if (receipt.status === "REASSESSMENT_REQUIRED") {
      assert(receipt.reassessment_required === true, "reassessment receipt flag is missing");
    }
  }

  assert(receipt.receipt_sha256 === canonicalDigest({...receipt, receipt_sha256: null}), "Bootstrap compile receipt is not content-addressed");
  return receipt;
}

export function compileBootstrapCompileReceipt({
  status,
  conversationSha256 = null,
  discoverySha256 = null,
  contractSha256 = null,
  intentScopeSha256 = null,
  blockingQuestionIds = [],
  failureCode = null,
  reassessmentRequired = false,
  compilerVersion = "bootstrap-project-contract.v1",
} = {}) {
  const receipt = {
    schema: BOOTSTRAP_COMPILE_RECEIPT_SCHEMA,
    version: BOOTSTRAP_COMPILE_RECEIPT_VERSION,
    status,
    conversation_sha256: conversationSha256,
    discovery_sha256: discoverySha256,
    contract_sha256: contractSha256,
    intent_scope_sha256: intentScopeSha256,
    blocking_question_ids: [...blockingQuestionIds].sort(),
    failure_code: failureCode,
    reassessment_required: reassessmentRequired,
    compiler_version: compilerVersion,
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = canonicalDigest(receipt);
  return validateBootstrapCompileReceipt(receipt);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Bootstrap compile receipt loaded\n");
