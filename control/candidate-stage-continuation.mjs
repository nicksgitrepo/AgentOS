#!/usr/bin/env node

/*
 * Project-agnostic liveness contract for the ordinary candidate pipeline.
 *
 * Candidate review, isolated integration, re-audit, and platform review are
 * all local stages.  A typed result from one stage must therefore name the
 * next registered stage and dispatch it in the same turn.  This wrapper keeps
 * those routes explicit while reusing the generic action-result persistence
 * and digest rules.
 */

import {compareUtf8} from "./content-addressing.mjs";
import {
  compileActionResultContinuation,
  validateActionResultContinuation,
} from "./action-result-continuation.mjs";

export const CANDIDATE_STAGE_CONTINUATION_SCHEMA = "agentos.candidate_stage_continuation.v1";
export const CANDIDATE_STAGE_CONTINUATION_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const FORBIDDEN_STATUS = /^(?:NONE|DONE|WAIT(?:ING)?|PLANNING_ONLY|REASONING_ONLY|COMMENTARY_ONLY|PLACEHOLDER)(?:$|[_:-])/u;

export const CANDIDATE_STAGE_ROUTES = Object.freeze({
  PREPARE_CANDIDATE_REVIEW: "HANDLER.CONTROLLER_CANDIDATE_REVIEW",
  START_CENTRAL_INTEGRATION: "HANDLER.ORCHESTRATOR_CENTRAL_INTEGRATION",
  START_INDEPENDENT_REAUDIT: "HANDLER.ORCHESTRATOR_INDEPENDENT_REAUDIT",
  START_PLATFORM_REVIEW: "HANDLER.ORCHESTRATOR_PLATFORM_REVIEW",
});
export const CANDIDATE_STAGE_ACTIONS = Object.freeze(Object.keys(CANDIDATE_STAGE_ROUTES).sort(compareUtf8));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function validateRefs(refs, label) {
  assert(Array.isArray(refs) && refs.length > 0, `${label} are required`);
  const ids = refs.map((ref) => {
    assert(isRecord(ref), `${label} entry must be an object`);
    const keys = Object.keys(ref).sort(compareUtf8);
    assert(JSON.stringify(keys) === JSON.stringify(["evidence_id", "reference", "sha256"].sort(compareUtf8)), `${label} entry fields mismatch`);
    requireIdentifier(ref.evidence_id, `${label} evidence id`);
    requireReference(ref.reference, `${label} reference`);
    requireSha(ref.sha256, `${label} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return refs;
}

export function validateCandidateStageResult(result, actionId) {
  assert(isRecord(result) && Object.keys(result).length > 0, "Candidate stage result must be a typed non-empty object");
  requireIdentifier(actionId, "Candidate stage action");
  assert(CANDIDATE_STAGE_ACTIONS.includes(actionId), `Candidate stage action ${actionId} is not registered`);
  requireIdentifier(result.status, "Candidate stage result status");
  assert(!FORBIDDEN_STATUS.test(result.status), "Candidate stage result cannot be a planning, waiting, or placeholder status");
  requireSha(result.candidate_sha256, "Candidate stage candidate digest");
  requireSha(result.candidate_before_sha256, "Candidate stage candidate-before digest");
  requireSha(result.candidate_after_sha256, "Candidate stage candidate-after digest");
  assert(result.product_mutation === false, "Candidate stage result cannot mutate the Product");
  assert(result.source_roots_preserved === true, "Candidate stage result must preserve source roots");
  return result;
}

export function validateCandidateStageContinuation(record) {
  validateActionResultContinuation(record);
  assert(record.schema === "agentos.action_result_continuation.v1", "Candidate stage continuation must use the action-result contract");
  assert(CANDIDATE_STAGE_ACTIONS.includes(record.action_id), `Candidate stage action ${record.action_id} is not registered`);
  assert(CANDIDATE_STAGE_ACTIONS.includes(record.next_action), `Candidate stage successor ${record.next_action} is not registered`);
  assert(record.next_handler === CANDIDATE_STAGE_ROUTES[record.next_action], "Candidate stage successor handler is stale");
  assert(record.continuation.mode === "IMMEDIATE_SAME_TURN" && record.continuation.same_turn_dispatch === true, "Candidate stage must dispatch in the same turn");
  assert(record.continuation.protected_event_id === null, "Candidate stage cannot carry a protected event");
  assert(record.persistence.status === "PERSISTED" && record.persistence.atomic === true && record.persistence.same_turn === true && record.persistence.write_scope === "CONTROL_PLANE_ONLY", "Candidate stage persistence is not atomic control-plane state");
  validateCandidateStageResult(record.result, record.action_id);
  validateRefs(record.evidence_refs, "Candidate stage evidence refs");
  return record;
}

export function compileCandidateStageContinuation({
  actionId,
  resultId,
  result,
  semanticBeforeSha256,
  semanticAfterSha256,
  nextAction,
  evidenceRefs,
  hostileFixtureRefs,
  receiptRef,
  receiptSha256,
} = {}) {
  validateCandidateStageResult(result, actionId);
  requireIdentifier(nextAction, "Candidate stage next action");
  assert(CANDIDATE_STAGE_ACTIONS.includes(nextAction), `Candidate stage successor ${nextAction} is not registered`);
  requireSha(semanticBeforeSha256, "Candidate stage semantic state before");
  requireSha(semanticAfterSha256, "Candidate stage semantic state after");
  requireReference(receiptRef, "Candidate stage receipt reference");
  requireSha(receiptSha256, "Candidate stage receipt digest");
  const evidence = validateRefs(evidenceRefs, "Candidate stage evidence refs");
  assert(Array.isArray(hostileFixtureRefs) && hostileFixtureRefs.length > 0, "Candidate stage hostile fixtures are required");
  assert(hostileFixtureRefs.every((value) => typeof value === "string" && IDENTIFIER.test(value)), "Candidate stage hostile fixture id is invalid");
  const orderedFixtures = [...hostileFixtureRefs].sort(compareUtf8);
  assert(new Set(hostileFixtureRefs).size === hostileFixtureRefs.length && JSON.stringify(hostileFixtureRefs) === JSON.stringify(orderedFixtures), "Candidate stage hostile fixtures must be sorted and unique");
  const continuation = {
    mode: "IMMEDIATE_SAME_TURN",
    timer_deferral: false,
    heartbeat_deferral: false,
    same_turn_dispatch: true,
    protected_event_id: null,
    resume_condition: `Dispatch ${nextAction} through ${CANDIDATE_STAGE_ROUTES[nextAction]} in this same lifecycle turn.`,
  };
  const persistence = {
    status: "PERSISTED",
    receipt_ref: receiptRef,
    receipt_sha256: receiptSha256,
    atomic: true,
    same_turn: true,
    write_scope: "CONTROL_PLANE_ONLY",
  };
  return validateCandidateStageContinuation(compileActionResultContinuation({
    actionId,
    resultId,
    result: structuredClone(result),
    semanticBeforeSha256,
    semanticAfterSha256,
    nextAction,
    nextHandler: CANDIDATE_STAGE_ROUTES[nextAction],
    continuation,
    persistence,
    evidenceRefs: evidence,
    hostileFixtureRefs: orderedFixtures,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Candidate stage continuation contract loaded\n");
