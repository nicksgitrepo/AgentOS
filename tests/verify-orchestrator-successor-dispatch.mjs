#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileCandidateStageContinuation,
} from "../control/candidate-stage-continuation.mjs";
import {
  compileControllerContinuation,
  ControllerActionDefect,
} from "../control/controller-action-dispatcher.mjs";
import {
  dispatchOrchestratorSuccessor,
  validateOrchestratorSuccessorDispatchReadback,
} from "../control/orchestrator-successor-dispatch.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(id)});
const baseResult = {
  status: "CANDIDATE_REVIEW_PASS_NO_DELTA",
  candidate_sha256: sha("candidate"),
  candidate_before_sha256: sha("before"),
  candidate_after_sha256: sha("after"),
  product_mutation: false,
  source_roots_preserved: true,
};

const successor = compileCandidateStageContinuation({
  actionId: "PREPARE_CANDIDATE_REVIEW",
  resultId: "RESULT.ORCHESTRATOR.DISPATCH.SOURCE",
  result: baseResult,
  semanticBeforeSha256: sha("review-before"),
  semanticAfterSha256: sha("review-after"),
  nextAction: "START_CENTRAL_INTEGRATION",
  evidenceRefs: [evidence("EVIDENCE.CANDIDATE"), evidence("EVIDENCE.REVIEW")],
  hostileFixtureRefs: ["FIXTURE.CANDIDATE.NO_TIMER", "FIXTURE.CANDIDATE.NO_WAIT"],
  receiptRef: "ref:control-plane/orchestrator/successor-source",
  receiptSha256: sha("source-receipt"),
});

const nextEvidence = [evidence("EVIDENCE.INTEGRATION"), evidence("EVIDENCE.SUCCESSOR")];
const handlers = {
  "HANDLER.ORCHESTRATOR_CENTRAL_INTEGRATION": (current) => ({
    semantic_after_sha256: sha(`${current.semantic_after_sha256}:integrated`),
    next_action: "START_INDEPENDENT_REAUDIT",
    next_handler: "HANDLER.ORCHESTRATOR_INDEPENDENT_REAUDIT",
    continuation: compileControllerContinuation("START_INDEPENDENT_REAUDIT"),
    continuation_sha256: canonicalDigest(compileControllerContinuation("START_INDEPENDENT_REAUDIT")),
    evidence_refs: nextEvidence,
    hostile_fixture_refs: ["FIXTURE.DISPATCH.NO_DUPLICATE", "FIXTURE.DISPATCH.NO_TIMER"],
    protected_event: null,
    defect: null,
  }),
};
const persisted = [];
const readback = dispatchOrchestratorSuccessor({
  successor,
  dispatchId: "DISPATCH.ORCHESTRATOR.CENTRAL.001",
  handlers,
  persist: (receipt) => {
    persisted.push(receipt);
    return true;
  },
});
validateOrchestratorSuccessorDispatchReadback(readback);
assert.equal(readback.status, "DISPATCHED_SAME_TURN");
assert.equal(readback.dispatch_observed, true);
assert.equal(readback.dispatched_count, 1);
assert.equal(persisted.length, 1);
assert.equal(readback.final_next_action, "START_INDEPENDENT_REAUDIT");
assert.equal(readback.final_next_handler, "HANDLER.ORCHESTRATOR_INDEPENDENT_REAUDIT");
assert.equal(readback.scope.control_plane_only, true);
assert.equal(readback.scope.consumer_product_mutated, false);

const rejects = (mutator, pattern) => {
  const candidate = structuredClone(successor);
  mutator(candidate);
  assert.throws(() => dispatchOrchestratorSuccessor({
    successor: candidate,
    dispatchId: "DISPATCH.ORCHESTRATOR.HOSTILE",
    handlers,
    persist: () => true,
  }), pattern);
};
rejects((candidate) => { candidate.continuation.same_turn_dispatch = false; }, /same-turn|digest/u);
rejects((candidate) => { candidate.next_action = "WAIT_FOR_PROTECTED_EVENT"; }, /dispatchable|handler|digest/u);
rejects((candidate) => { candidate.persistence.write_scope = "PRODUCT"; }, /control-plane|write scope|persistence|digest/u);

assert.throws(() => dispatchOrchestratorSuccessor({
  successor,
  dispatchId: "DISPATCH.ORCHESTRATOR.MISSING_HANDLER",
  handlers: {},
  persist: () => true,
}), (error) => error instanceof ControllerActionDefect && error.code === "STALE_OR_UNKNOWN_HANDLER");

assert.throws(() => dispatchOrchestratorSuccessor({
  successor,
  dispatchId: "DISPATCH.ORCHESTRATOR.PERSIST_FALSE",
  handlers,
  persist: () => false,
}), (error) => error instanceof ControllerActionDefect && error.code === "MISSING_ATOMIC_PERSISTENCE");

const unchangedHandlers = {
  "HANDLER.ORCHESTRATOR_CENTRAL_INTEGRATION": (current) => ({
    ...handlers["HANDLER.ORCHESTRATOR_CENTRAL_INTEGRATION"](current),
    semantic_after_sha256: current.semantic_after_sha256,
  }),
};
assert.throws(() => dispatchOrchestratorSuccessor({
  successor,
  dispatchId: "DISPATCH.ORCHESTRATOR.UNCHANGED",
  handlers: unchangedHandlers,
  persist: () => true,
}), (error) => error instanceof ControllerActionDefect && error.code === "UNCHANGED_SEMANTIC_STATE");

const tamperedReadback = structuredClone(readback);
tamperedReadback.readback_sha256 = sha("tampered");
assert.throws(() => validateOrchestratorSuccessorDispatchReadback(tamperedReadback), /readback digest/u);

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../schemas/orchestrator-successor-dispatch.v1.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
assert.equal(schema.properties.status.const, "DISPATCHED_SAME_TURN");
assert.equal(schema.properties.dispatch_observed.const, true);
assert.equal(schema.properties.scope.properties.control_plane_only.const, true);
assert.equal(schema.properties.scope.properties.consumer_product_mutated.const, false);

console.log("PASS Orchestrator successor dispatch: handler invocation, atomic same-turn persistence, closed route binding, protected-boundary rejection, and hostile false-dispatch coverage");
