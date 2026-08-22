#!/usr/bin/env node

/* Typed, non-authorizing rollback receipt helpers for Resource Scheduler. */

import {canonicalDigest} from "./content-addressing.mjs";

export const SCHEDULER_RESOURCE_ROLLBACK_SCHEMA = "agentos.rollback_receipt.v1";
export const SCHEDULER_RESOURCE_ROLLBACK_STATUS = "UNKNOWN";
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const OPAQUE_REF = /^opaque:[A-Z0-9._-]+$/u;
const ROLLBACK_KEYS = Object.freeze([
  "schema", "version", "rollback_id", "request_id", "request_digest", "choice_digest",
  "target_receipt_digest", "target_external_result_ref", "restored_external_result_ref", "status",
  "verified", "evidence_digest", "observed_at_utc", "digest",
]);

function fail(message, code = "SCHEDULER_RESOURCE_RECEIPT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "SCHEDULER_RESOURCE_RECEIPT_DIGEST_INVALID"); }
function exactKeys(value, keys) { assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), "rollback receipt fields differ", "SCHEDULER_RESOURCE_RECEIPT_SCHEMA_INVALID"); }
function assertEvidence(receipt, {candidateDigest, gateSemanticInventorySha256, modelRouteSha256, contextSha256, routeSha256} = {}) {
  sha(candidateDigest, "candidate digest");
  sha(gateSemanticInventorySha256, "gate semantic inventory digest");
  sha(modelRouteSha256, "model route digest");
  sha(contextSha256, "context receipt digest");
  sha(routeSha256, "route receipt digest");
  assert(receipt.target_receipt_digest === candidateDigest, "rollback target does not match candidate", "SCHEDULER_RESOURCE_RECEIPT_TARGET_INVALID");
  const expectedEvidence = canonicalDigest({candidate_digest: candidateDigest, gate_semantic_inventory_sha256: gateSemanticInventorySha256, model_route_sha256: modelRouteSha256, context_receipt_sha256: contextSha256, route_receipt_sha256: routeSha256, activation: "OFF", external_actions: false});
  assert(receipt.evidence_digest === expectedEvidence, "rollback evidence is not bound to the candidate context", "SCHEDULER_RESOURCE_RECEIPT_EVIDENCE_INVALID");
}

export function compileSchedulerResourceRollbackReceipt({candidateDigest, gateSemanticInventorySha256, modelRouteSha256, contextSha256, routeSha256, observedAtUtc = "2026-08-22T00:00:00.000Z"} = {}) {
  sha(candidateDigest, "candidate digest");
  sha(gateSemanticInventorySha256, "gate semantic inventory digest");
  sha(modelRouteSha256, "model route digest");
  sha(contextSha256, "context receipt digest");
  sha(routeSha256, "route receipt digest");
  assert(ISO_DATE_TIME.test(observedAtUtc) && Number.isFinite(Date.parse(observedAtUtc)), "rollback observed_at_utc is invalid", "SCHEDULER_RESOURCE_RECEIPT_TIME_INVALID");
  const receipt = {
    schema: SCHEDULER_RESOURCE_ROLLBACK_SCHEMA,
    version: 1,
    rollback_id: "ROLLBACK.RESOURCE_SCHEDULER.CANDIDATE",
    request_id: "REQUEST.RESOURCE_SCHEDULER.CANDIDATE",
    request_digest: canonicalDigest({request_id: "REQUEST.RESOURCE_SCHEDULER.CANDIDATE", candidate_digest: candidateDigest}),
    choice_digest: canonicalDigest({choice: "PRESERVE_CANDIDATE_EVIDENCE", candidate_digest: candidateDigest}),
    target_receipt_digest: candidateDigest,
    target_external_result_ref: "opaque:RESOURCE_SCHEDULER.CANDIDATE",
    restored_external_result_ref: "opaque:RESOURCE_SCHEDULER.CANDIDATE_RETAINED",
    status: SCHEDULER_RESOURCE_ROLLBACK_STATUS,
    verified: false,
    evidence_digest: canonicalDigest({candidate_digest: candidateDigest, gate_semantic_inventory_sha256: gateSemanticInventorySha256, model_route_sha256: modelRouteSha256, context_receipt_sha256: contextSha256, route_receipt_sha256: routeSha256, activation: "OFF", external_actions: false}),
    observed_at_utc: observedAtUtc,
    digest: null,
  };
  receipt.digest = canonicalDigest({...receipt, digest: null});
  return Object.freeze(receipt);
}

export function validateSchedulerResourceRollbackReceipt(receipt, {candidateDigest, gateSemanticInventorySha256, modelRouteSha256, contextSha256, routeSha256} = {}) {
  assert(receipt && typeof receipt === "object" && !Array.isArray(receipt), "rollback receipt must be an object", "SCHEDULER_RESOURCE_RECEIPT_SCHEMA_INVALID");
  exactKeys(receipt, ROLLBACK_KEYS);
  assert(receipt.schema === SCHEDULER_RESOURCE_ROLLBACK_SCHEMA && receipt.version === 1 && receipt.status === SCHEDULER_RESOURCE_ROLLBACK_STATUS && receipt.verified === false, "rollback receipt status is not inert", "SCHEDULER_RESOURCE_RECEIPT_STATUS_INVALID");
  for (const field of ["request_digest", "choice_digest", "target_receipt_digest", "evidence_digest", "digest"]) sha(receipt[field], `rollback ${field}`);
  assert(typeof receipt.rollback_id === "string" && typeof receipt.request_id === "string" && OPAQUE_REF.test(receipt.target_external_result_ref) && OPAQUE_REF.test(receipt.restored_external_result_ref), "rollback receipt references are not opaque", "SCHEDULER_RESOURCE_RECEIPT_REFERENCE_INVALID");
  assert(ISO_DATE_TIME.test(receipt.observed_at_utc) && Number.isFinite(Date.parse(receipt.observed_at_utc)), "rollback receipt timestamp is invalid", "SCHEDULER_RESOURCE_RECEIPT_TIME_INVALID");
  assert(receipt.digest === canonicalDigest({...receipt, digest: null}), "rollback receipt digest is invalid", "SCHEDULER_RESOURCE_RECEIPT_DIGEST_INVALID");
  if (candidateDigest !== undefined) assertEvidence(receipt, {candidateDigest, gateSemanticInventorySha256, modelRouteSha256, contextSha256, routeSha256});
  return true;
}

export const SCHEDULER_RESOURCE_ROLLBACK_RECEIPT_KEYS = ROLLBACK_KEYS;
