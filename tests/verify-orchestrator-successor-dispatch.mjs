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
  compileControllerNextLifecycleHandoff,
  ControllerActionDefect,
} from "../control/controller-action-dispatcher.mjs";
import {
  dispatchOrchestratorSuccessor,
  validateOrchestratorSuccessorDispatchReadback,
  ORCHESTRATOR_DISPATCHABLE_ACTIONS,
  ORCHESTRATOR_PROTECTED_RUNTIME_SUCCESSOR_ACTIONS,
} from "../control/orchestrator-successor-dispatch.mjs";
import {compileActionResultContinuation} from "../control/action-result-continuation.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(id)});
assert(ORCHESTRATOR_DISPATCHABLE_ACTIONS.includes("REQUEST_SPAWNER_QA"));
assert(ORCHESTRATOR_DISPATCHABLE_ACTIONS.includes("RETRY_SPAWNER_QA"));
assert(ORCHESTRATOR_DISPATCHABLE_ACTIONS.includes("RUN_LOCAL_CANDIDATE_PROOF"));
assert(ORCHESTRATOR_DISPATCHABLE_ACTIONS.includes("REPAIR_BLOCKS"));
assert(ORCHESTRATOR_DISPATCHABLE_ACTIONS.includes("COMPILE_BLOCK_PATCH"));
assert(!ORCHESTRATOR_DISPATCHABLE_ACTIONS.includes("RUNTIME_ATOMIC_GIT_REPOINT"));
assert.deepEqual(ORCHESTRATOR_PROTECTED_RUNTIME_SUCCESSOR_ACTIONS, ["RUNTIME_ATOMIC_GIT_REPOINT"]);
const baseResult = {
  status: "CANDIDATE_REVIEW_PASS_NO_DELTA",
  candidate_sha256: sha("candidate"),
  candidate_before_sha256: sha("before"),
  candidate_after_sha256: sha("after"),
  product_mutation: false,
  source_roots_preserved: true,
  execution_owner: "LANE_AGENT",
  direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  controller_approval_required: false,
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
const chainProtectedEvent = {
  blocker_id: "PROTECTED.ORCHESTRATOR.CHAIN.BOUNDARY",
  blocker_class: "MAJOR_PRODUCT_OR_PRODUCTION_DECISION",
  evidence_ceiling: "Only local compiler evidence is available; the protected boundary remains unperformed.",
  restart_event: "EXPLICIT_PROTECTED_BOUNDARY_AUTHORIZATION",
  resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
};
const handlers = {
  "HANDLER.ORCHESTRATOR_SPAWNER_QA": (current) => ({
    semantic_after_sha256: sha(`${current.semantic_after_sha256}:spawner-retried`),
    next_action: "WAIT_FOR_PROTECTED_EVENT",
    next_handler: "HANDLER.PROTECTED_EVENT_WAIT",
    continuation: compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: chainProtectedEvent.blocker_id}),
    continuation_sha256: canonicalDigest(compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: chainProtectedEvent.blocker_id})),
    evidence_refs: [evidence("EVIDENCE.SPAWNER.RETRY")],
    hostile_fixture_refs: ["FIXTURE.DISPATCH.NO_TIMER", "FIXTURE.SPAWNER.RETRY.DIRECT"],
    protected_event: chainProtectedEvent,
    defect: null,
  }),
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
  "HANDLER.ORCHESTRATOR_INDEPENDENT_REAUDIT": (current) => ({
    semantic_after_sha256: sha(`${current.semantic_after_sha256}:reaudited`),
    next_action: "WAIT_FOR_PROTECTED_EVENT",
    next_handler: "HANDLER.PROTECTED_EVENT_WAIT",
    continuation: compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: chainProtectedEvent.blocker_id}),
    continuation_sha256: canonicalDigest(compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: chainProtectedEvent.blocker_id})),
    evidence_refs: [evidence("EVIDENCE.REAUDIT.BOUNDARY.A"), evidence("EVIDENCE.REAUDIT.BOUNDARY.B")],
    hostile_fixture_refs: ["FIXTURE.DISPATCH.NO_TIMER", "FIXTURE.DISPATCH.PROTECTED_BOUNDARY"],
    protected_event: chainProtectedEvent,
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
assert.equal(readback.status, "DISPATCHED_TO_PROTECTED_WAIT");
assert.equal(readback.dispatch_observed, true);
assert.equal(readback.dispatched_count, 2);
assert.equal(persisted.length, 2);
assert.equal(readback.final_next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(readback.final_next_handler, "HANDLER.PROTECTED_EVENT_WAIT");
assert.equal(readback.scope.control_plane_only, true);
assert.equal(readback.scope.consumer_product_mutated, false);

// A failed Spawner handoff must have a first-class autonomous retry route.
// The retry invokes the Orchestrator→Spawner handler directly and never asks
// the persistent Controller to approve ordinary lane completion.
const retrySuccessor = compileActionResultContinuation({
  actionId: "RUN_LOCAL_CANDIDATE_PROOF",
  resultId: "RESULT.ORCHESTRATOR.SPAWNER.RETRY.SOURCE",
  result: {status: "RETRY_REQUIRED", controller_approval_required: false, execution_owner: "LANE_AGENT", direct_consumer: "INDEPENDENT_PLATFORM_REVIEW"},
  semanticBeforeSha256: sha("retry-before"),
  semanticAfterSha256: sha("retry-after"),
  nextAction: "RETRY_SPAWNER_QA",
  nextHandler: "HANDLER.ORCHESTRATOR_SPAWNER_QA",
  continuation: compileControllerContinuation("RETRY_SPAWNER_QA"),
  persistence: {status: "PERSISTED", receipt_ref: "ref:control-plane/spawner-retry", receipt_sha256: sha("spawner-retry-receipt"), atomic: true, same_turn: true, write_scope: "CONTROL_PLANE_ONLY"},
  evidenceRefs: [evidence("EVIDENCE.SPAWNER.RETRY.SOURCE")],
  hostileFixtureRefs: ["FIXTURE.SPAWNER.RETRY.NO_APPROVAL", "FIXTURE.SPAWNER.RETRY.NO_TIMER"],
});
const retryReadback = dispatchOrchestratorSuccessor({
  successor: retrySuccessor,
  dispatchId: "DISPATCH.ORCHESTRATOR.SPAWNER.RETRY.001",
  handlers,
  persist: (receipt) => { persisted.push(receipt); return true; },
});
validateOrchestratorSuccessorDispatchReadback(retryReadback);
assert.equal(retryReadback.source_action, "RETRY_SPAWNER_QA");
assert.equal(retryReadback.final_next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(retryReadback.status, "DISPATCHED_TO_PROTECTED_WAIT");

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
const missingCustody = compileCandidateStageContinuation({
  actionId: "PREPARE_CANDIDATE_REVIEW",
  resultId: "RESULT.ORCHESTRATOR.DISPATCH.MISSING.CUSTODY",
  result: {...baseResult, direct_consumer: undefined},
  semanticBeforeSha256: sha("missing-custody-before"),
  semanticAfterSha256: sha("missing-custody-after"),
  nextAction: "START_CENTRAL_INTEGRATION",
  evidenceRefs: [evidence("EVIDENCE.MISSING.CUSTODY")],
  hostileFixtureRefs: ["FIXTURE.DISPATCH.MISSING.CUSTODY"],
  receiptRef: "ref:control-plane/orchestrator/missing-custody",
  receiptSha256: sha("missing-custody-receipt"),
});
assert.throws(() => dispatchOrchestratorSuccessor({
  successor: missingCustody,
  dispatchId: "DISPATCH.ORCHESTRATOR.MISSING.CUSTODY",
  handlers,
  persist: () => true,
}), /independent platform review/u);
const boundedReadback = dispatchOrchestratorSuccessor({
  successor,
  dispatchId: "DISPATCH.ORCHESTRATOR.MAX_TRANSITIONS_ONE",
  handlers,
  persist: () => true,
  startNextLifecycle: (cursor) => compileControllerNextLifecycleHandoff({
    sourceReceiptSha256: cursor.receipt_sha256,
    nextAction: cursor.next_action,
    nextHandler: cursor.next_handler,
    handoffRef: "ref:controller/next-lifecycle/orchestrator-test",
  }),
  maxTransitions: 1,
});
validateOrchestratorSuccessorDispatchReadback(boundedReadback);
assert.equal(boundedReadback.status, "DISPATCHED_SAME_TURN");
assert.equal(boundedReadback.dispatch_observed, true);
assert.equal(boundedReadback.dispatched_count, 1);
assert.equal(boundedReadback.final_next_action, "START_INDEPENDENT_REAUDIT");
assert.equal(boundedReadback.final_next_handler, "HANDLER.ORCHESTRATOR_INDEPENDENT_REAUDIT");
assert.equal(boundedReadback.next_lifecycle.status, "STARTED");
assert.equal(boundedReadback.next_lifecycle.started_same_turn, true);
assert.throws(() => dispatchOrchestratorSuccessor({
  successor,
  dispatchId: "DISPATCH.ORCHESTRATOR.MISSING_NEXT_LIFECYCLE_STARTER",
  handlers,
  persist: () => true,
  maxTransitions: 1,
}), (error) => error instanceof ControllerActionDefect && error.code === "WORKFLOW_DEAD_END");

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

const materializationContinuation = compileControllerContinuation("MATERIALIZE_NEW_PROJECT_REPOSITORIES");
const materializationSuccessor = compileActionResultContinuation({
  actionId: "PREPARE_PYRAMID_IMPORT_OUTPUT",
  resultId: "RESULT.ORCHESTRATOR.DISPATCH.MATERIALIZE",
  result: {
    status: "PYRAMID_IMPORT_OUTPUT_PREPARED_LOCAL_ISOLATED",
    candidate_sha256: sha("candidate"),
    candidate_before_sha256: sha("candidate"),
    candidate_after_sha256: sha("candidate"),
    product_mutation: false,
    source_roots_preserved: true,
    execution_owner: "LANE_AGENT",
    direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
    controller_approval_required: false,
  },
  semanticBeforeSha256: sha("prepare-before"),
  semanticAfterSha256: sha("prepare-after"),
  nextAction: "MATERIALIZE_NEW_PROJECT_REPOSITORIES",
  nextHandler: "HANDLER.ORCHESTRATOR.MATERIALIZE_NEW_PROJECT_REPOSITORIES",
  continuation: materializationContinuation,
  continuation_sha256: canonicalDigest(materializationContinuation),
  persistence: {
    status: "PERSISTED",
    receipt_ref: "ref:control-plane/orchestrator/materialization-source",
    receipt_sha256: sha("materialization-source"),
    atomic: true,
    same_turn: true,
    write_scope: "CONTROL_PLANE_ONLY",
  },
  evidenceRefs: [evidence("EVIDENCE.MATERIALIZE.A"), evidence("EVIDENCE.MATERIALIZE.B")],
  hostileFixtureRefs: ["FIXTURE.MATERIALIZE.NO_PRODUCT", "FIXTURE.MATERIALIZE.SOURCE_PRESERVED"],
});
const materializationPersisted = [];
const materializationReadback = dispatchOrchestratorSuccessor({
  successor: materializationSuccessor,
  dispatchId: "DISPATCH.ORCHESTRATOR.MATERIALIZE",
  handlers: {
    "HANDLER.ORCHESTRATOR.MATERIALIZE_NEW_PROJECT_REPOSITORIES": (current) => ({
      semantic_after_sha256: sha(`${current.semantic_after_sha256}:materialized`),
      next_action: "PREPARE_CANDIDATE_REVIEW",
      next_handler: "HANDLER.CONTROLLER_CANDIDATE_REVIEW",
      continuation: compileControllerContinuation("PREPARE_CANDIDATE_REVIEW"),
      continuation_sha256: canonicalDigest(compileControllerContinuation("PREPARE_CANDIDATE_REVIEW")),
      evidence_refs: [evidence("EVIDENCE.MATERIALIZE.RESULT.A"), evidence("EVIDENCE.MATERIALIZE.RESULT.B")],
      hostile_fixture_refs: ["FIXTURE.MATERIALIZE.RESULT.NO_PRODUCT", "FIXTURE.MATERIALIZE.RESULT.ROLLBACK"],
      protected_event: null,
      defect: null,
    }),
    "HANDLER.CONTROLLER_CANDIDATE_REVIEW": (current) => ({
      semantic_after_sha256: sha(`${current.semantic_after_sha256}:reviewed`),
      next_action: "WAIT_FOR_PROTECTED_EVENT",
      next_handler: "HANDLER.PROTECTED_EVENT_WAIT",
      continuation: compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: chainProtectedEvent.blocker_id}),
      continuation_sha256: canonicalDigest(compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: chainProtectedEvent.blocker_id})),
      evidence_refs: [evidence("EVIDENCE.REVIEW.BOUNDARY.A"), evidence("EVIDENCE.REVIEW.BOUNDARY.B")],
      hostile_fixture_refs: ["FIXTURE.MATERIALIZE.PROTECTED.CUTOVER", "FIXTURE.MATERIALIZE.RESULT.ROLLBACK"],
      protected_event: chainProtectedEvent,
      defect: null,
    }),
  },
  persist: (receipt) => {
    materializationPersisted.push(receipt);
    return true;
  },
});
validateOrchestratorSuccessorDispatchReadback(materializationReadback);
assert.equal(materializationReadback.dispatch_observed, true);
assert.equal(materializationReadback.dispatched_count, 2);
assert.equal(materializationPersisted.length, 2);
assert.equal(materializationReadback.source_action, "MATERIALIZE_NEW_PROJECT_REPOSITORIES");
assert.equal(materializationReadback.final_next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(materializationReadback.scope.control_plane_only, true);
assert.equal(materializationReadback.scope.consumer_product_mutated, false);

const protectedEvent = {
  blocker_id: "PROTECTED.RUNTIME.GIT_REPOINT_OR_RELEASE",
  blocker_class: "MAJOR_PRODUCT_OR_PRODUCTION_DECISION",
  evidence_ceiling: "Only isolated candidate output is proven; runtime Git cutover and release remain unperformed.",
  restart_event: "CURRENT_TYPED_RUNTIME_CUTOVER_OR_RELEASE_AUTHORIZATION",
  resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
};
const protectedContinuation = compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: protectedEvent.blocker_id});
const protectedPersisted = [];
const protectedReadback = dispatchOrchestratorSuccessor({
  successor: materializationSuccessor,
  dispatchId: "DISPATCH.ORCHESTRATOR.MATERIALIZE.PROTECTED",
  handlers: {
    "HANDLER.ORCHESTRATOR.MATERIALIZE_NEW_PROJECT_REPOSITORIES": (current) => ({
      semantic_after_sha256: sha(`${current.semantic_after_sha256}:materialized`),
      next_action: "WAIT_FOR_PROTECTED_EVENT",
      next_handler: "HANDLER.PROTECTED_EVENT_WAIT",
      continuation: protectedContinuation,
      continuation_sha256: canonicalDigest(protectedContinuation),
      evidence_refs: [evidence("EVIDENCE.MATERIALIZE.PROTECTED.A"), evidence("EVIDENCE.MATERIALIZE.PROTECTED.B")],
      hostile_fixture_refs: ["FIXTURE.MATERIALIZE.PROTECTED.CUTOVER", "FIXTURE.MATERIALIZE.PROTECTED.ZERO_RESOURCE"],
      protected_event: protectedEvent,
      defect: null,
    }),
  },
  persist: (receipt) => {
    protectedPersisted.push(receipt);
    return true;
  },
});
validateOrchestratorSuccessorDispatchReadback(protectedReadback);
assert.equal(protectedReadback.status, "DISPATCHED_TO_PROTECTED_WAIT");
assert.equal(protectedReadback.final_next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(protectedReadback.continuation.mode, "EVENT_DRIVEN_PROTECTED_WAIT");
assert.equal(protectedReadback.continuation.same_turn_dispatch, false);
assert.equal(protectedReadback.continuation.protected_event_id, protectedEvent.blocker_id);
assert.equal(protectedReadback.scope.protected_event_id, protectedEvent.blocker_id);
assert.equal(protectedPersisted.length, 1);

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../schemas/orchestrator-successor-dispatch.v1.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
assert.deepEqual(schema.properties.status.enum, ["DISPATCHED_SAME_TURN", "DISPATCHED_TO_OWNER_REVIEW", "DISPATCHED_TO_PROTECTED_WAIT"]);
assert.equal(schema.properties.dispatch_observed.const, true);
assert.equal(schema.required.includes("next_lifecycle"), true);
assert.equal(schema.properties.scope.properties.control_plane_only.const, true);
assert.equal(schema.properties.scope.properties.consumer_product_mutated.const, false);
assert.match(schema.description, /next-lifecycle starter.*STARTED handoff/u);
assert.match(schema.state_rules.continuation, /next-lifecycle starter.*STARTED handoff/u);

console.log("PASS Orchestrator successor dispatch: handler invocation, atomic same-turn persistence, closed route binding, protected-boundary rejection, and hostile false-dispatch coverage");
