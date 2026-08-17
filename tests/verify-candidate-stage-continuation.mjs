#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  CANDIDATE_STAGE_ROUTES,
  compileCandidateStageContinuation,
  validateCandidateStageContinuation,
} from "../control/candidate-stage-continuation.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(id)});
const baseResult = {status: "PLATFORM_REVIEW_PASS_NO_DELTA", candidate_sha256: sha("candidate"), candidate_before_sha256: sha("before"), candidate_after_sha256: sha("after"), product_mutation: false, source_roots_preserved: true};

const record = compileCandidateStageContinuation({
  actionId: "START_PLATFORM_REVIEW",
  resultId: "RESULT.CANDIDATE_STAGE.001",
  result: baseResult,
  semanticBeforeSha256: sha("semantic-before"),
  semanticAfterSha256: sha("semantic-after"),
  nextAction: "PREPARE_CANDIDATE_REVIEW",
  evidenceRefs: [evidence("EVIDENCE.CANDIDATE"), evidence("EVIDENCE.FILESYSTEM")],
  hostileFixtureRefs: ["FIXTURE.CANDIDATE.NO_PLACEHOLDER", "FIXTURE.CANDIDATE.NO_WAIT"],
  receiptRef: "ref:control-plane/candidate-stage/001",
  receiptSha256: sha("receipt"),
});
validateCandidateStageContinuation(record);
assert.equal(record.next_handler, CANDIDATE_STAGE_ROUTES.PREPARE_CANDIDATE_REVIEW);
assert.equal(record.continuation.same_turn_dispatch, true);
assert.equal(record.continuation.timer_deferral, false);
assert.equal(record.continuation.protected_event_id, null);

for (const [action, handler] of Object.entries(CANDIDATE_STAGE_ROUTES)) {
  const next = compileCandidateStageContinuation({
    actionId: action,
    resultId: `RESULT.CANDIDATE_STAGE.${action}`,
    result: {...baseResult, status: `${action}_PASS_NO_DELTA`},
    semanticBeforeSha256: sha(`${action}-before`),
    semanticAfterSha256: sha(`${action}-after`),
    nextAction: action,
    evidenceRefs: [evidence(`EVIDENCE.${action}`)],
    hostileFixtureRefs: [`FIXTURE.${action}.NO_TIMER`],
    receiptRef: `ref:control-plane/candidate-stage/${action.toLowerCase()}`,
    receiptSha256: sha(`${action}-receipt`),
  });
  assert.equal(next.next_handler, handler);
}

const rejects = (mutator, message) => {
  const candidate = structuredClone(record);
  mutator(candidate);
  assert.throws(() => validateCandidateStageContinuation(candidate), message);
};
rejects((candidate) => { candidate.next_action = "WAIT_FOR_PROTECTED_EVENT"; }, /successor|registered|digest/u);
rejects((candidate) => { candidate.result.status = "PLANNING_ONLY"; }, /planning|placeholder|digest/u);
rejects((candidate) => { candidate.result.product_mutation = true; }, /Product mutation|digest/u);
rejects((candidate) => { candidate.result.source_roots_preserved = false; }, /source roots|digest/u);
rejects((candidate) => { candidate.continuation.same_turn_dispatch = false; }, /same-turn|digest/u);
rejects((candidate) => { candidate.persistence.write_scope = "PRODUCT"; }, /write scope|digest/u);

console.log("PASS candidate-stage continuation: ordinary review/integration stages require typed results, atomic persistence, and same-turn successors");
