#!/usr/bin/env node

/*
 * Project-agnostic successor gate for an accepted independent candidate
 * re-audit.  A re-audit receipt is evidence, not a workflow transition: this
 * contract makes the next local route explicit and dispatchable in the same
 * turn.  It deliberately cannot emit a protected wait, NONE, or DONE.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  compileActionResultContinuation,
  validateActionResultContinuation,
} from "./action-result-continuation.mjs";

export const CANDIDATE_REAUDIT_CONTINUATION_SCHEMA = "agentos.candidate_reaudit_continuation.v1";
export const CANDIDATE_REAUDIT_CONTINUATION_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const NEXT_ROUTES = Object.freeze({
  START_PLATFORM_REVIEW: "HANDLER.ORCHESTRATOR_PLATFORM_REVIEW",
  PREPARE_PYRAMID_IMPORT_OUTPUT: "HANDLER.ORCHESTRATOR.PREPARE_PYRAMID_IMPORT_OUTPUT",
});
const RECEIPT_KEYS = Object.freeze([
  "schema", "version", "candidate_sha256", "evidence_sha256", "residual_risk_sha256", "accepted", "reaudit_sha256",
]);

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
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable uppercase identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

export function validateCandidateIndependentReauditReceipt(receipt) {
  exactKeys(receipt, RECEIPT_KEYS, "Candidate independent re-audit receipt");
  assert(typeof receipt.schema === "string" && receipt.schema.startsWith("agentos."), "Candidate re-audit schema is not project-agnostic");
  assert(receipt.version === 1, "Candidate re-audit version is invalid");
  requireSha(receipt.candidate_sha256, "Candidate re-audit candidate digest");
  requireSha(receipt.evidence_sha256, "Candidate re-audit evidence digest");
  requireSha(receipt.residual_risk_sha256, "Candidate re-audit residual-risk digest");
  assert(receipt.accepted === true, "Candidate re-audit is not accepted");
  requireSha(receipt.reaudit_sha256, "Candidate re-audit digest");
  return receipt;
}

function validateRoute(nextAction, nextHandler) {
  assert(Object.hasOwn(NEXT_ROUTES, nextAction), "Candidate re-audit successor is not an ordinary local route");
  assert(nextHandler === NEXT_ROUTES[nextAction], "Candidate re-audit successor handler does not match its route");
  assert(nextAction !== "NONE" && nextAction !== "DONE" && nextAction !== "WAIT_FOR_PROTECTED_EVENT", "Candidate re-audit cannot close or wait for protection");
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Candidate re-audit successor evidence refs are required");
  const ids = refs.map((ref) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], "Candidate re-audit successor evidence ref");
    requireIdentifier(ref.evidence_id, "Candidate re-audit successor evidence id");
    requireReference(ref.reference, "Candidate re-audit successor evidence reference");
    requireSha(ref.sha256, "Candidate re-audit successor evidence digest");
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Candidate re-audit successor evidence refs must be sorted and unique");
  return refs;
}

export function validateCandidateReauditContinuation(record) {
  validateActionResultContinuation(record);
  assert(record.schema === "agentos.action_result_continuation.v1", "Candidate re-audit successor must use the action-result contract");
  assert(record.action_id === "START_INDEPENDENT_REAUDIT", "Candidate re-audit successor action is invalid");
  validateRoute(record.next_action, record.next_handler);
  assert(record.continuation.mode === "IMMEDIATE_SAME_TURN" && record.continuation.same_turn_dispatch === true, "Candidate re-audit successor must dispatch in the same turn");
  assert(record.persistence.status === "PERSISTED" && record.persistence.atomic === true && record.persistence.same_turn === true, "Candidate re-audit successor persistence is not atomic");
  assert(record.protected_event_id === undefined, "Candidate re-audit successor contains an unexpected protected event");
  assert(record.result?.status === "ACCEPTED_REAUDIT", "Candidate re-audit successor result is not typed");
  validateEvidenceRefs(record.evidence_refs);
  return record;
}

export function compileCandidateReauditContinuation({
  resultId,
  reaudit,
  semanticBeforeSha256,
  semanticAfterSha256,
  nextAction = "START_PLATFORM_REVIEW",
  evidenceRefs,
  hostileFixtureRefs,
  receiptRef,
  receiptSha256,
} = {}) {
  validateCandidateIndependentReauditReceipt(reaudit);
  const nextHandler = NEXT_ROUTES[nextAction];
  validateRoute(nextAction, nextHandler);
  requireSha(semanticBeforeSha256, "Candidate re-audit semantic state before");
  requireSha(semanticAfterSha256, "Candidate re-audit semantic state after");
  requireReference(receiptRef, "Candidate re-audit successor receipt reference");
  requireSha(receiptSha256, "Candidate re-audit successor receipt digest");
  const evidence = validateEvidenceRefs(evidenceRefs);
  assert(Array.isArray(hostileFixtureRefs) && hostileFixtureRefs.length > 0, "Candidate re-audit successor hostile fixtures are required");
  assert(hostileFixtureRefs.every((value) => typeof value === "string" && IDENTIFIER.test(value)), "Candidate re-audit successor hostile fixture id is invalid");
  const orderedFixtures = [...hostileFixtureRefs].sort(compareUtf8);
  assert(new Set(hostileFixtureRefs).size === hostileFixtureRefs.length && JSON.stringify(hostileFixtureRefs) === JSON.stringify(orderedFixtures), "Candidate re-audit successor hostile fixtures must be sorted and unique");
  const continuation = {
    mode: "IMMEDIATE_SAME_TURN",
    timer_deferral: false,
    heartbeat_deferral: false,
    same_turn_dispatch: true,
    protected_event_id: null,
    resume_condition: `Dispatch ${nextAction} through ${nextHandler} in this same lifecycle turn.`,
  };
  const persistence = {
    status: "PERSISTED",
    receipt_ref: receiptRef,
    receipt_sha256: receiptSha256,
    atomic: true,
    same_turn: true,
    write_scope: "CONTROL_PLANE_ONLY",
  };
  const record = compileActionResultContinuation({
    actionId: "START_INDEPENDENT_REAUDIT",
    resultId,
    result: {
      status: "ACCEPTED_REAUDIT",
      candidate_sha256: reaudit.candidate_sha256,
      evidence_sha256: reaudit.evidence_sha256,
      residual_risk_sha256: reaudit.residual_risk_sha256,
      reaudit_sha256: reaudit.reaudit_sha256,
      next_route: nextAction,
    },
    semanticBeforeSha256,
    semanticAfterSha256,
    nextAction,
    nextHandler,
    continuation,
    persistence,
    evidenceRefs: evidence,
    hostileFixtureRefs: orderedFixtures,
  });
  return validateCandidateReauditContinuation(record);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Candidate re-audit continuation contract loaded\n");
