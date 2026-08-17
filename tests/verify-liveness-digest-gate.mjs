#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileActionResultContinuation} from "../control/action-result-continuation.mjs";
import {compileTypedSuccessorReadback} from "../control/typed-successor-readback.mjs";
import {
  compileLivenessDigestGate,
  evaluateLivenessBindingFreshness,
  LIVENESS_ROSTER_INVALIDATION_RULE,
  LIVENESS_ROSTER_REFRESH_TRIGGERS,
  validateLivenessDigestGate,
} from "../control/liveness-digest-gate.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(id)});
const continuation = {
  mode: "IMMEDIATE_SAME_TURN",
  timer_deferral: false,
  heartbeat_deferral: false,
  same_turn_dispatch: true,
  protected_event_id: null,
  resume_condition: "Persist the corrected liveness successor and dispatch the registered handler in this same turn.",
};
const persistence = {
  status: "PERSISTED",
  receipt_ref: "ref:control-plane/liveness-digest-gate/receipt",
  receipt_sha256: sha("receipt"),
  atomic: true,
  same_turn: true,
  write_scope: "CONTROL_PLANE_ONLY",
};

const actionResult = compileActionResultContinuation({
  actionId: "START_PLATFORM_REVIEW",
  resultId: "RESULT.LIVENESS.DIGEST.GATE.001",
  result: {
    status: "LIVENESS_DIGEST_SUCCESSOR_COMPILED",
    product_mutation: false,
    protected_event: null,
  },
  semanticBeforeSha256: sha("before"),
  semanticAfterSha256: sha("after"),
  nextAction: "START_PLATFORM_REVIEW",
  nextHandler: "HANDLER.ORCHESTRATOR_PLATFORM_REVIEW",
  continuation,
  persistence,
  evidenceRefs: [evidence("EVIDENCE.ACTION.RESULT")],
  hostileFixtureRefs: ["FIXTURE.ACTION.RESULT.NULL_DIGEST", "FIXTURE.ACTION.RESULT.TIMER_ONLY"],
});

const resourceBoundary = {
  active_lane_count: 0,
  lane_limit: 6,
  heavyweight_process_count: 0,
  heavyweight_process_limit: 1,
  wave_activation: "OFF",
};
const typedSuccessor = compileTypedSuccessorReadback({
  successorId: "SUCCESSOR.LIVENESS.DIGEST.001",
  parentSuccessorSha256: actionResult.record_sha256,
  parentNextAction: actionResult.next_action,
  transitionSequence: 1,
  state: "ACTIVE",
  nextAction: actionResult.next_action,
  nextHandler: actionResult.next_handler,
  entries: [{
    entry_id: "ENTRY.LIVENESS.DIGEST.REPAIR",
    record_sha256: sha("repair-entry"),
    authority_status: "CURRENT",
    collection_status: "COLLECTED",
    slot_status: "HELD",
  }],
  resourceBoundary,
});

const authorityBinding = {
  authority_commit: "a".repeat(40),
  authority_tree: "b".repeat(40),
  authority_receipt_sha256: sha("authority-receipt"),
  source_mapping_sha256: sha("source-mapping"),
};
const rosterBinding = {
  roster_projection_sha256: sha("roster"),
  applicability_sha256: sha("applicability"),
  invalidation_rule: LIVENESS_ROSTER_INVALIDATION_RULE,
  refresh_triggers: [...LIVENESS_ROSTER_REFRESH_TRIGGERS],
};

const gate = compileLivenessDigestGate({
  gateId: "GATE.WORKFLOW.NULL.DIGEST.LIVENESS.RECORD",
  defectId: "DEFECT.WORKFLOW.NULL.DIGEST.LIVENESS.RECORD",
  actionResult,
  typedSuccessor,
  authorityBinding,
  rosterBinding,
  evidenceRefs: [evidence("EVIDENCE.ACTION.RESULT"), evidence("EVIDENCE.TYPED.SUCCESSOR")].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id)),
  hostileFixtureRefs: [
    "FIXTURE.LIVENESS.NULL.RESULT.DIGEST",
    "FIXTURE.LIVENESS.NULL.CONTINUATION.DIGEST",
    "FIXTURE.LIVENESS.NULL.RECORDBACK.DIGEST",
    "FIXTURE.LIVENESS.NULL.RECORD.DIGEST",
    "FIXTURE.LIVENESS.PLACEHOLDER.DIGEST",
    "FIXTURE.LIVENESS.TAMPERED.RECORD",
    "FIXTURE.LIVENESS.TAMPERED.READBACK",
    "FIXTURE.LIVENESS.STALE.AUTHORITY.BINDING",
    "FIXTURE.LIVENESS.STALE.ROSTER.BINDING",
  ].sort(),
});
validateLivenessDigestGate(gate, {expectedAuthorityBinding: authorityBinding, expectedRosterBinding: rosterBinding});
assert.equal(gate.result_sha256, actionResult.result_sha256);
assert.equal(gate.continuation_sha256, actionResult.continuation_sha256);
assert.equal(gate.record_sha256, actionResult.record_sha256);
assert.equal(gate.readback_sha256, typedSuccessor.readback_sha256);
assert.notEqual(gate.readback_sha256, null);

const rejects = (mutator, pattern) => {
  const candidate = structuredClone(gate);
  mutator(candidate);
  assert.throws(() => validateLivenessDigestGate(candidate), pattern);
};
rejects((candidate) => { candidate.result_sha256 = null; }, /result digest must/u);
rejects((candidate) => { candidate.continuation_sha256 = null; }, /continuation digest must/u);
rejects((candidate) => { candidate.readback_sha256 = null; }, /readback digest must/u);
rejects((candidate) => { candidate.record_sha256 = null; }, /record digest must/u);
rejects((candidate) => { candidate.result_sha256 = "0".repeat(64); }, /placeholder digest/u);
rejects((candidate) => { candidate.action_result.result.status = "TAMPERED"; }, /result digest does not match/u);
rejects((candidate) => { candidate.action_result.continuation.resume_condition = "tampered"; }, /continuation digest mismatch/u);
rejects((candidate) => { candidate.typed_successor.readback.next_action = "OTHER_ACTION"; }, /semantic readback digest mismatch|semantic readback diverges/u);
rejects((candidate) => { candidate.readback.next_handler = "HANDLER.TAMPERED"; }, /semantic readback diverges/u);
rejects((candidate) => { candidate.typed_successor.next_action = "OTHER_ACTION"; }, /successor action diverges|semantic readback diverges/u);
rejects((candidate) => { candidate.typed_successor.parent_successor_sha256 = sha("stale-parent"); }, /parent is not the action result|successor digest mismatch/u);
rejects((candidate) => { candidate.roster_binding.refresh_triggers = ["ROSTER_CHANGE"]; }, /refresh triggers must be sorted|incomplete/u);

const staleAuthority = {...authorityBinding, authority_commit: "c".repeat(40)};
const staleAuthorityEvaluation = evaluateLivenessBindingFreshness(gate, {authorityBinding: staleAuthority});
assert.deepEqual(staleAuthorityEvaluation, {
  status: "STALE",
  invalidation_required: true,
  reason: "AUTHORITY_BINDING_CHANGED",
  next_action: "REBUILD_DEPENDENT_ROSTER",
});
const staleRoster = {...rosterBinding, roster_projection_sha256: sha("new-roster")};
const staleRosterEvaluation = evaluateLivenessBindingFreshness(gate, {rosterBinding: staleRoster});
assert.deepEqual(staleRosterEvaluation, {
  status: "STALE",
  invalidation_required: true,
  reason: "ROSTER_BINDING_CHANGED",
  next_action: "REBUILD_DEPENDENT_ROSTER",
});
assert.deepEqual(evaluateLivenessBindingFreshness(gate, {authorityBinding, rosterBinding}), {
  status: "CURRENT",
  invalidation_required: false,
  reason: null,
  next_action: "CONTINUE_NEXT_ACTION",
});

console.log("PASS liveness digest gate: four non-null matching digests, typed successor/readback binding, hostile tamper/null rejection, and stale roster invalidation");
