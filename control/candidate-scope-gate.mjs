#!/usr/bin/env node

/*
 * Project-agnostic scope classifier for the import/cutover boundary.
 *
 * Isolated candidate custody is ordinary reversible development work.  The
 * final consumer Git repoint or release is a protected boundary.  Keeping
 * these routes explicit prevents the stop gate from treating candidate
 * assembly as if it were publication.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  compileRoutineDevelopmentStopDecision,
  evaluateStopWorkflowGate,
  validateStopWorkflowDecision,
} from "./stop-workflow-gate.mjs";

export const CANDIDATE_SCOPE_GATE_SCHEMA = "agentos.candidate_scope_gate.v1";
export const CANDIDATE_SCOPE_GATE_VERSION = 1;
export const CANDIDATE_SCOPE_MODES = Object.freeze([
  "ISOLATED_CANDIDATE_CUSTODY",
  "FINAL_RUNTIME_GIT_REPOINT_OR_RELEASE",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[A-Za-z0-9._:/-]+$/u;
const HOSTILE_FIXTURES = Object.freeze([
  "FIXTURE.STOP_GATE.FINAL_GIT_REPOINT_MUST_STOP",
  "FIXTURE.STOP_GATE.ISOLATED_CANDIDATE_MUST_CONTINUE",
  "FIXTURE.STOP_GATE.SCOPE_CONFLATION_REJECTED",
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

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque or content-addressed reference`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

function compileScopeStopDecision({
  mode,
  decisionId,
  actionRef,
  rollbackRef,
  candidateScopeRef,
  finalCutoverScopeRef,
  zeroCostRef,
  preservationRef,
  rollbackEvidenceRef,
  delegatedAuthorityRef,
}) {
  if (mode === "ISOLATED_CANDIDATE_CUSTODY") {
    return compileRoutineDevelopmentStopDecision({
      decisionId,
      actionRef,
      rollbackRef,
      admittedScopeRef: candidateScopeRef,
      zeroCostRef,
      preservationRef,
      rollbackEvidenceRef,
      delegatedAuthorityRef,
    });
  }
  return evaluateStopWorkflowGate({
    decisionId,
    actionRef,
    rollbackRef,
    answers: [
      {question_id: "COSTS_MONEY", answer: "NO", evidence_refs: [zeroCostRef]},
      {question_id: "CHANGES_PROTECTED_PROJECT_OR_SCOPE", answer: "YES", evidence_refs: [finalCutoverScopeRef]},
      {question_id: "DELETES_UNSAVED_OR_UNBACKED_UP_WORK", answer: "NO", evidence_refs: [preservationRef]},
      {question_id: "DESTROYS_OR_IRREVERSIBLY_MODIFIES", answer: "NO", evidence_refs: [rollbackEvidenceRef, rollbackRef].sort(compareUtf8)},
      {question_id: "OWNER_DECISION_REQUIRED", answer: "NO", evidence_refs: [delegatedAuthorityRef]},
    ],
  });
}

function validateScopeDecision(decision, mode) {
  validateStopWorkflowDecision(decision);
  if (mode === "ISOLATED_CANDIDATE_CUSTODY") {
    assert(decision.outcome === "CONTINUE_AUTONOMOUS" && decision.stop === false, "isolated candidate custody must continue autonomously");
  } else {
    assert(decision.outcome === "STOP_OWNER_DECISION" && decision.stop === true, "final Git repoint or release must stop for protected authority");
    assert(decision.primary_trigger_question_id === "CHANGES_PROTECTED_PROJECT_OR_SCOPE", "final cutover must stop on protected project scope");
  }
  return decision;
}

export function validateCandidateScopeGate(gate) {
  exactKeys(gate, [
    "schema", "version", "gate_id", "mode", "action_ref", "rollback_ref", "candidate_scope_ref",
    "final_cutover_scope_ref", "stop_decision", "successor", "hostile_fixture_refs", "invalidation_rule", "gate_sha256",
  ], "candidate scope gate");
  assert(gate.schema === CANDIDATE_SCOPE_GATE_SCHEMA && gate.version === CANDIDATE_SCOPE_GATE_VERSION, "candidate scope gate identity is invalid");
  requireIdentifier(gate.gate_id, "candidate scope gate ID");
  assert(CANDIDATE_SCOPE_MODES.includes(gate.mode), "candidate scope mode is invalid");
  requireReference(gate.action_ref, "candidate scope action reference");
  requireReference(gate.rollback_ref, "candidate scope rollback reference");
  requireReference(gate.candidate_scope_ref, "candidate scope evidence reference");
  requireReference(gate.final_cutover_scope_ref, "final cutover scope evidence reference");
  validateScopeDecision(gate.stop_decision, gate.mode);
  exactKeys(gate.successor, ["route", "next_action", "stop"], "candidate scope successor");
  requireIdentifier(gate.successor.route, "candidate scope successor route");
  requireIdentifier(gate.successor.next_action, "candidate scope successor action");
  assert(typeof gate.successor.stop === "boolean", "candidate scope successor stop flag is invalid");
  if (gate.mode === "ISOLATED_CANDIDATE_CUSTODY") {
    assert(gate.successor.route === "CONTINUE_ISOLATED_CANDIDATE_CUSTODY" && gate.successor.next_action === "CONTINUE_NEXT_ACTION" && gate.successor.stop === false, "isolated candidate successor is invalid");
  } else {
    assert(gate.successor.route === "WAIT_FOR_PROTECTED_RUNTIME_REPOINT_OR_RELEASE" && gate.successor.next_action === "STOP_DEPENDENT_WORK_OWNER_REVIEW" && gate.successor.stop === true, "final cutover successor is invalid");
  }
  sortedUnique(gate.hostile_fixture_refs, "candidate scope hostile fixtures");
  assert(JSON.stringify(gate.hostile_fixture_refs) === JSON.stringify([...HOSTILE_FIXTURES].sort(compareUtf8)), "candidate scope hostile fixture set is incomplete");
  assert(gate.invalidation_rule === "Any governing block, gate, source, applicability, or authority change invalidates dependent seeds and rebuilds them before reuse.", "candidate scope invalidation rule is incomplete");
  requireSha(gate.gate_sha256, "candidate scope gate digest");
  assert(gate.gate_sha256 === digestWithout(gate, "gate_sha256"), "candidate scope gate digest mismatch");
  return gate;
}

export function compileCandidateScopeGate({
  gateId,
  mode,
  actionRef,
  rollbackRef,
  candidateScopeRef,
  finalCutoverScopeRef,
  zeroCostRef,
  preservationRef,
  rollbackEvidenceRef,
  delegatedAuthorityRef,
}) {
  requireIdentifier(gateId, "candidate scope gate ID");
  assert(CANDIDATE_SCOPE_MODES.includes(mode), "candidate scope mode is invalid");
  for (const [value, label] of [
    [actionRef, "candidate scope action reference"],
    [rollbackRef, "candidate scope rollback reference"],
    [candidateScopeRef, "candidate scope evidence reference"],
    [finalCutoverScopeRef, "final cutover scope evidence reference"],
    [zeroCostRef, "candidate scope zero-cost reference"],
    [preservationRef, "candidate scope preservation reference"],
    [rollbackEvidenceRef, "candidate scope rollback evidence reference"],
    [delegatedAuthorityRef, "candidate scope delegated-authority reference"],
  ]) requireReference(value, label);
  const stopDecision = compileScopeStopDecision({
    mode,
    decisionId: `${gateId}.STOP`,
    actionRef,
    rollbackRef,
    candidateScopeRef,
    finalCutoverScopeRef,
    zeroCostRef,
    preservationRef,
    rollbackEvidenceRef,
    delegatedAuthorityRef,
  });
  const gate = {
    schema: CANDIDATE_SCOPE_GATE_SCHEMA,
    version: CANDIDATE_SCOPE_GATE_VERSION,
    gate_id: gateId,
    mode,
    action_ref: actionRef,
    rollback_ref: rollbackRef,
    candidate_scope_ref: candidateScopeRef,
    final_cutover_scope_ref: finalCutoverScopeRef,
    stop_decision: stopDecision,
    successor: mode === "ISOLATED_CANDIDATE_CUSTODY"
      ? {route: "CONTINUE_ISOLATED_CANDIDATE_CUSTODY", next_action: "CONTINUE_NEXT_ACTION", stop: false}
      : {route: "WAIT_FOR_PROTECTED_RUNTIME_REPOINT_OR_RELEASE", next_action: "STOP_DEPENDENT_WORK_OWNER_REVIEW", stop: true},
    hostile_fixture_refs: [...HOSTILE_FIXTURES].sort(compareUtf8),
    invalidation_rule: "Any governing block, gate, source, applicability, or authority change invalidates dependent seeds and rebuilds them before reuse.",
    gate_sha256: null,
  };
  gate.gate_sha256 = digestWithout(gate, "gate_sha256");
  return validateCandidateScopeGate(gate);
}

export const CANDIDATE_SCOPE_GATE_HOSTILE_FIXTURES = HOSTILE_FIXTURES;

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("candidate-scope gate loaded\n");
