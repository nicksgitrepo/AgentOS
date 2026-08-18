#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  actionResultContinuationDigest,
  compileActionResultContinuation,
  validateActionResultContinuation,
} from "../control/action-result-continuation.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(id)});
const continuation = {
  mode: "IMMEDIATE_SAME_TURN",
  timer_deferral: false,
  heartbeat_deferral: false,
  same_turn_dispatch: true,
  protected_event_id: null,
  resume_condition: "Dispatch the registered successor handler in this same lifecycle turn.",
};
const persistence = {
  status: "PERSISTED",
  receipt_ref: "ref:control-plane/action-result/1",
  receipt_sha256: sha("persisted-receipt"),
  atomic: true,
  same_turn: true,
  write_scope: "CONTROL_PLANE_ONLY",
};

const record = compileActionResultContinuation({
  actionId: "HANDLER.SPAWNER_QA",
  resultId: "RESULT.SPAWNER_QA.001",
  result: {status: "PASS", checks: ["PORTABILITY", "DISPATCH"]},
  semanticBeforeSha256: sha("before"),
  semanticAfterSha256: sha("after"),
  nextAction: "START_NEXT_LOCAL_BLOCK_REPAIR",
  nextHandler: "HANDLER.CONTROLLER_LOCAL_BLOCK_REPAIR",
  continuation,
  persistence,
  evidenceRefs: [evidence("EVIDENCE.ACTION_RESULT")],
  hostileFixtureRefs: ["FIXTURE.ACTION_RESULT.NO_PLAN_ONLY", "FIXTURE.ACTION_RESULT.NO_TIMER_ONLY"],
});
validateActionResultContinuation(record);
assert.equal(record.result_sha256, canonicalDigest(record.result));
assert.equal(record.continuation_sha256, actionResultContinuationDigest(record.continuation));
assert.equal(record.record_sha256, canonicalDigest({...record, record_sha256: null}));

const rejects = (mutator, message) => {
  const candidate = structuredClone(record);
  mutator(candidate);
  assert.throws(() => validateActionResultContinuation(candidate), message);
};
rejects((candidate) => { candidate.result = {}; }, /non-empty result/u);
rejects((candidate) => { candidate.status = "PLANNING_ONLY"; }, /status is not persisted/u);
rejects((candidate) => { candidate.persistence.status = "PLANNED"; }, /status is not terminal/u);
rejects((candidate) => { candidate.continuation.timer_deferral = true; }, /timer or heartbeat/u);
rejects((candidate) => { candidate.next_action = "NONE"; }, /cannot close/u);
rejects((candidate) => { candidate.semantic_after_sha256 = candidate.semantic_before_sha256; }, /did not advance/u);
rejects((candidate) => { candidate.record_sha256 = "0".repeat(64); }, /record digest mismatch/u);

const protectedRecord = compileActionResultContinuation({
  actionId: "HANDLER.PROTECTED_EVENT_WAIT",
  resultId: "RESULT.PROTECTED_WAIT.001",
  result: {status: "WAITING", blocker_id: "PROTECTED.EXAMPLE"},
  semanticBeforeSha256: sha("protected-before"),
  semanticAfterSha256: sha("protected-after"),
  nextAction: "WAIT_FOR_PROTECTED_EVENT",
  nextHandler: "HANDLER.PROTECTED_EVENT_WAIT",
  continuation: {
    mode: "EVENT_DRIVEN_PROTECTED_WAIT",
    timer_deferral: false,
    heartbeat_deferral: false,
    same_turn_dispatch: false,
    protected_event_id: "PROTECTED.EXAMPLE",
    resume_condition: "Resume only when the bound protected event is explicitly delivered.",
  },
  persistence: {...persistence, status: "PERSISTED_PROTECTED_WAIT"},
  evidenceRefs: [evidence("EVIDENCE.PROTECTED_RESULT")],
  hostileFixtureRefs: ["FIXTURE.ACTION_RESULT.PROTECTED_WAIT"],
  status: "PROTECTED_WAIT_PERSISTED",
});
validateActionResultContinuation(protectedRecord);
assert.equal(protectedRecord.continuation.mode, "EVENT_DRIVEN_PROTECTED_WAIT");

// Compilers canonicalize incidental input ordering, while validation still
// rejects duplicate evidence/fixture identities.
const unsorted = compileActionResultContinuation({
  actionId: "HANDLER.ORCHESTRATOR_REPAIR",
  resultId: "RESULT.ORCHESTRATOR_REPAIR.UNSORTED",
  result: {status: "REPAIR_REQUIRED"},
  semanticBeforeSha256: sha("unsorted-before"),
  semanticAfterSha256: sha("unsorted-after"),
  nextAction: "START_NEXT_LOCAL_BLOCK_REPAIR",
  nextHandler: "HANDLER.CONTROLLER_LOCAL_BLOCK_REPAIR",
  continuation,
  persistence,
  evidenceRefs: [evidence("EVIDENCE.Z"), evidence("EVIDENCE.A")],
  hostileFixtureRefs: ["FIXTURE.Z", "FIXTURE.A"],
});
assert.deepEqual(unsorted.evidence_refs.map((ref) => ref.evidence_id), ["EVIDENCE.A", "EVIDENCE.Z"]);
assert.deepEqual(unsorted.hostile_fixture_refs, ["FIXTURE.A", "FIXTURE.Z"]);
assert.throws(() => compileActionResultContinuation({
  actionId: "HANDLER.ORCHESTRATOR_REPAIR",
  resultId: "RESULT.ORCHESTRATOR_REPAIR.DUPLICATE",
  result: {status: "REPAIR_REQUIRED"},
  semanticBeforeSha256: sha("duplicate-before"),
  semanticAfterSha256: sha("duplicate-after"),
  nextAction: "START_NEXT_LOCAL_BLOCK_REPAIR",
  nextHandler: "HANDLER.CONTROLLER_LOCAL_BLOCK_REPAIR",
  continuation,
  persistence,
  evidenceRefs: [evidence("EVIDENCE.A"), evidence("EVIDENCE.A")],
  hostileFixtureRefs: ["FIXTURE.A"],
}), /sorted and unique/u);

console.log("PASS action-result continuation: persisted result, non-terminal successor, same-turn routing, protected event wait, and hostile closeout coverage");
