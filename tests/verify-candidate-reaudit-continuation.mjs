#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileCandidateReauditContinuation,
  validateCandidateIndependentReauditReceipt,
  validateCandidateReauditContinuation,
} from "../control/candidate-reaudit-continuation.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(id)});
const reaudit = {
  schema: "agentos.candidate_independent_reaudit.v1",
  version: 1,
  candidate_sha256: sha("candidate"),
  evidence_sha256: sha("evidence"),
  residual_risk_sha256: sha("residual-risk"),
  accepted: true,
  reaudit_sha256: sha("reaudit"),
};
validateCandidateIndependentReauditReceipt(reaudit);

const record = compileCandidateReauditContinuation({
  resultId: "RESULT.CANDIDATE_REAUDIT.001",
  reaudit,
  semanticBeforeSha256: sha("before"),
  semanticAfterSha256: sha("after"),
  nextAction: "START_PLATFORM_REVIEW",
  evidenceRefs: [evidence("EVIDENCE.CANDIDATE_REAUDIT"), evidence("EVIDENCE.FILESYSTEM_PROOF")],
  hostileFixtureRefs: ["FIXTURE.REAUDIT.NO_PROTECTED_WAIT", "FIXTURE.REAUDIT.NO_TIMER_WAIT"],
  receiptRef: "ref:control-plane/candidate-reaudit/001",
  receiptSha256: sha("successor-receipt"),
});
validateCandidateReauditContinuation(record);
assert.equal(record.next_action, "START_PLATFORM_REVIEW");
assert.equal(record.next_handler, "HANDLER.ORCHESTRATOR_PLATFORM_REVIEW");
assert.equal(record.continuation.same_turn_dispatch, true);
assert.equal(record.continuation.timer_deferral, false);
assert.equal(record.continuation.heartbeat_deferral, false);

const rejects = (mutator, message) => {
  const candidate = structuredClone(record);
  mutator(candidate);
  assert.throws(() => validateCandidateReauditContinuation(candidate), message);
};
rejects((candidate) => { candidate.result.status = "REASONING_ONLY"; }, /typed|digest/u);
rejects((candidate) => { candidate.next_action = "WAIT_FOR_PROTECTED_EVENT"; }, /ordinary local route|digest/u);
rejects((candidate) => { candidate.continuation.timer_deferral = true; }, /timer or heartbeat|digest/u);
rejects((candidate) => { candidate.semantic_after_sha256 = candidate.semantic_before_sha256; }, /did not advance|digest/u);
rejects((candidate) => { candidate.evidence_refs = []; }, /evidence refs are required|digest/u);

const outputRoute = compileCandidateReauditContinuation({
  resultId: "RESULT.CANDIDATE_REAUDIT.002",
  reaudit,
  semanticBeforeSha256: sha("output-before"),
  semanticAfterSha256: sha("output-after"),
  nextAction: "PREPARE_PYRAMID_IMPORT_OUTPUT",
  evidenceRefs: [evidence("EVIDENCE.CANDIDATE_REAUDIT")],
  hostileFixtureRefs: ["FIXTURE.REAUDIT.OUTPUT_ROUTE"],
  receiptRef: "ref:control-plane/candidate-reaudit/002",
  receiptSha256: sha("output-receipt"),
});
assert.equal(outputRoute.next_handler, "HANDLER.ORCHESTRATOR.PREPARE_PYRAMID_IMPORT_OUTPUT");

console.log("PASS candidate re-audit continuation: accepted proof requires immediate ordinary successor, atomic persistence, and hostile no-wait/no-loop coverage");
