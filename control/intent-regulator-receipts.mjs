#!/usr/bin/env node

/* Typed, non-authorizing handoff and rollback receipt helpers. */

import {canonicalDigest} from "./content-addressing.mjs";

export const INTENT_REGULATOR_ROLLBACK_SCHEMA = "agentos.rollback_receipt.v1";
export const INTENT_REGULATOR_ROLLBACK_STATUS = "UNKNOWN";
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ROLLBACK_KEYS = Object.freeze([
  "schema", "version", "rollback_id", "request_id", "request_digest", "choice_digest",
  "target_receipt_digest", "target_external_result_ref", "restored_external_result_ref", "status",
  "verified", "evidence_digest", "observed_at_utc", "digest",
]);
function fail(message, code = "INTENT_REGULATOR_RECEIPT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "INTENT_REGULATOR_RECEIPT_DIGEST_INVALID"); }

export function compileIntentRegulatorRollbackReceipt({candidateDigest, gateSemanticInventorySha256, observedAtUtc = "2026-08-21T00:00:00.000Z"} = {}) {
  sha(candidateDigest, "candidate digest");
  sha(gateSemanticInventorySha256, "gate semantic inventory digest");
  assert(ISO_DATE_TIME.test(observedAtUtc) && Number.isFinite(Date.parse(observedAtUtc)), "rollback observed_at_utc is invalid", "INTENT_REGULATOR_RECEIPT_TIME_INVALID");
  const receipt = {
    schema: INTENT_REGULATOR_ROLLBACK_SCHEMA,
    version: 1,
    rollback_id: "ROLLBACK.INTENT_REGULATOR.CANDIDATE",
    request_id: "REQUEST.INTENT_REGULATOR.CANDIDATE",
    request_digest: canonicalDigest({request_id: "REQUEST.INTENT_REGULATOR.CANDIDATE", candidate_digest: candidateDigest}),
    choice_digest: canonicalDigest({choice: "PRESERVE_CANDIDATE_EVIDENCE", candidate_digest: candidateDigest}),
    target_receipt_digest: candidateDigest,
    target_external_result_ref: "opaque:INTENT_REGULATOR.CANDIDATE",
    restored_external_result_ref: "opaque:INTENT_REGULATOR.CANDIDATE_RETAINED",
    status: INTENT_REGULATOR_ROLLBACK_STATUS,
    verified: false,
    evidence_digest: canonicalDigest({candidate_digest: candidateDigest, gate_semantic_inventory_sha256: gateSemanticInventorySha256, activation: "OFF", external_actions: false}),
    observed_at_utc: observedAtUtc,
    digest: null,
  };
  receipt.digest = canonicalDigest({...receipt, digest: null});
  return Object.freeze(receipt);
}

export function validateIntentRegulatorRollbackReceipt(receipt, {candidateDigest} = {}) {
  assert(receipt && typeof receipt === "object" && !Array.isArray(receipt), "rollback receipt must be an object");
  assert(JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify([...ROLLBACK_KEYS].sort()), "rollback receipt fields differ", "INTENT_REGULATOR_RECEIPT_SCHEMA_INVALID");
  assert(receipt.schema === INTENT_REGULATOR_ROLLBACK_SCHEMA && receipt.version === 1 && receipt.status === INTENT_REGULATOR_ROLLBACK_STATUS && receipt.verified === false, "rollback receipt status is not inert", "INTENT_REGULATOR_RECEIPT_STATUS_INVALID");
  for (const field of ["request_digest", "choice_digest", "target_receipt_digest", "evidence_digest", "digest"]) sha(receipt[field], `rollback ${field}`);
  if (candidateDigest !== undefined) assert(receipt.target_receipt_digest === candidateDigest, "rollback target does not match candidate", "INTENT_REGULATOR_RECEIPT_TARGET_INVALID");
  assert(typeof receipt.rollback_id === "string" && typeof receipt.request_id === "string" && /^opaque:[A-Z0-9._-]+$/u.test(receipt.target_external_result_ref) && /^opaque:[A-Z0-9._-]+$/u.test(receipt.restored_external_result_ref), "rollback receipt references are not opaque", "INTENT_REGULATOR_RECEIPT_REFERENCE_INVALID");
  assert(ISO_DATE_TIME.test(receipt.observed_at_utc) && Number.isFinite(Date.parse(receipt.observed_at_utc)), "rollback receipt timestamp is invalid", "INTENT_REGULATOR_RECEIPT_TIME_INVALID");
  assert(receipt.digest === canonicalDigest({...receipt, digest: null}), "rollback receipt digest is invalid", "INTENT_REGULATOR_RECEIPT_DIGEST_INVALID");
  return true;
}

export const INTENT_REGULATOR_ROLLBACK_RECEIPT_KEYS = ROLLBACK_KEYS;
