#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  CONTROLLER_ACTION_AUTHORITY,
  CONTROLLER_ACTION_COVERAGE,
  CONTROLLER_ACTION_IDS,
  CONTROLLER_ACTION_REGISTRY,
  CONTROLLER_EMITTED_ACTION_IDS,
  ControllerActionDefect,
  advanceControllerAction,
  compileControllerActionDefect,
  compileControllerActionReceipt,
  compileControllerContinuation,
  controllerActionCoverageFor,
  controllerActionHandlerFor,
  controllerContinuationDigest,
  deriveControllerSuccessor,
  validateControllerActionReceipt,
} from "../control/controller-action-dispatcher.mjs";

const HASH = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: HASH(id)});
const hostile = (id) => [`FIXTURE.CONTROLLER.ACTION.${id}`];
const protectedEvent = {
  blocker_id: "INDEPENDENT.UTILITY_HARM_CLEARANCE",
  blocker_class: "PROTECTED_EXTERNAL_DEPENDENCY",
  evidence_ceiling: "Independent authority has not supplied a clearance receipt; no admission or activation evidence may be inferred.",
  restart_event: "Resume only when the independent clearance receipt is explicitly bound.",
  resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
};

const initial = compileControllerActionReceipt({
  receiptId: "RECEIPT.CONTROLLER.ROOT",
  actionId: "BOOTSTRAP_ACCEPTED",
  semanticBeforeSha256: HASH("state-0"),
  semanticAfterSha256: HASH("state-1"),
  evidenceRefs: [evidence("EVIDENCE.CONTROLLER.ROOT")],
  hostileFixtureRefs: hostile("ROOT"),
  nextAction: "ADMIT_NEXT_PERMANENT_ROLE",
});
validateControllerActionReceipt(initial);
assert.equal(initial.next_handler, "HANDLER.PERMANENT_ROLE_ADMISSION");
assert.equal(initial.continuation.mode, "IMMEDIATE_SAME_TURN");
assert.equal(initial.continuation.timer_deferral, false);
assert.equal(initial.continuation.heartbeat_deferral, false);

const emittedInventory = [
  "ADMIT_TYPED_AGENT_SPAWNER", "CONSTRUCT_PERMANENT_ROLES_ONE_AT_A_TIME", "START_COMPILER", "COMPILE_NEXT_BLOCK", "PUBLISH_TYPED_ROSTER",
  "WAIT_FOR_INDEPENDENT_CLEARANCE", "ADMIT_GOVERNED_SPAWN", "START_GOVERNED_SPAWN", "WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT",
  "ADMIT_NEXT_PERMANENT_ROLE", "INJECT_ORCHESTRATOR_GOVERNANCE", "REQUEST_SPAWNER_QA", "REPAIR_BLOCKS", "START_SPECIALIST_WAVE",
  "START_PLATFORM_REVIEW", "START_CENTRAL_INTEGRATION", "START_INDEPENDENT_REAUDIT", "PREPARE_CANDIDATE_REVIEW", "WAIT_FOR_PROTECTED_EVENT", "NONE",
  "ASSEMBLE_ISOLATED_CUMULATIVE_CANDIDATE",
  "START_NEXT_AVAILABLE_CONTROLLER_TRANSITION", "START_NEXT_LOCAL_BLOCK_REPAIR", "WAIT_FOR_PROTECTED_WAVE_ACTIVATION", "PREPARE_DEVELOPMENT_CANDIDATE_REVIEW",
].sort();
const dispatcherSchema = JSON.parse(fs.readFileSync(new URL("../schemas/controller-action-dispatcher.v1.json", import.meta.url), "utf8"));
assert.deepEqual([...dispatcherSchema.properties.next_action.enum].sort(), [...CONTROLLER_ACTION_IDS].sort(), "Dispatcher schema action enum drifted from registry");
assert.deepEqual([...dispatcherSchema.properties.next_handler.enum].sort(), [...new Set(CONTROLLER_ACTION_IDS.map((id) => CONTROLLER_ACTION_REGISTRY[id].handler))].sort(), "Dispatcher schema handler enum drifted from registry");
assert.ok(dispatcherSchema.required.includes("continuation_sha256"), "Dispatcher schema must require continuation_sha256");
assert.ok(dispatcherSchema.properties.continuation_sha256, "Dispatcher schema must expose continuation_sha256");
for (const actionId of emittedInventory) {
  assert.ok(CONTROLLER_EMITTED_ACTION_IDS.includes(actionId), `Emitted action inventory omitted ${actionId}`);
  assert.ok(controllerActionCoverageFor(actionId), `Emitted action has no coverage descriptor: ${actionId}`);
}
assert.equal(CONTROLLER_ACTION_COVERAGE.NONE.mode, "INVALID_TERMINAL");
assert.equal(CONTROLLER_ACTION_COVERAGE.NONE.handler, null);
assert.equal(CONTROLLER_ACTION_COVERAGE.PREPARE_CANDIDATE_REVIEW.mode, "LOCAL");
assert.equal(CONTROLLER_ACTION_COVERAGE.PREPARE_DEVELOPMENT_CANDIDATE_REVIEW.mode, "LOCAL");
assert.equal(CONTROLLER_ACTION_COVERAGE.PREPARE_CANDIDATE_REVIEW.handler, "HANDLER.CONTROLLER_CANDIDATE_REVIEW");
assert.equal(CONTROLLER_ACTION_COVERAGE.PREPARE_DEVELOPMENT_CANDIDATE_REVIEW.handler, "HANDLER.CONTROLLER_CANDIDATE_REVIEW");
assert.throws(() => controllerActionHandlerFor("NONE"), (error) => error instanceof ControllerActionDefect && error.code === "INVALID_SUCCESSOR");

for (const actionId of CONTROLLER_ACTION_IDS) {
  const descriptor = CONTROLLER_ACTION_REGISTRY[actionId];
  const isProtected = descriptor.mode === "PROTECTED_WAIT";
  const isOwner = descriptor.mode === "OWNER_REVIEW";
  const route = isOwner
    ? (() => {
      const continuation = compileControllerContinuation(actionId);
      return {next_action: actionId, next_handler: controllerActionHandlerFor(actionId), continuation, continuation_sha256: controllerContinuationDigest(continuation), protected_event: null, defect: null};
    })()
    : deriveControllerSuccessor({
      localActions: isProtected ? [] : [actionId],
      protectedEvent: isProtected ? protectedEvent : null,
      protectedActionId: isProtected ? actionId : "WAIT_FOR_PROTECTED_EVENT",
    });
  const expectedAction = actionId;
  assert.equal(route.next_action, expectedAction);
  assert.equal(route.next_handler, CONTROLLER_ACTION_REGISTRY[expectedAction].handler);
  assert.ok(route.continuation);
  assert.equal(route.continuation_sha256, controllerContinuationDigest(route.continuation));
  const receipt = compileControllerActionReceipt({
    receiptId: `RECEIPT.CONTROLLER.REGISTRY.${actionId}`,
    actionId: "REGISTRY_COVERAGE",
    semanticBeforeSha256: HASH(`before-${actionId}`),
    semanticAfterSha256: isProtected ? HASH(`before-${actionId}`) : HASH(`after-${actionId}`),
    evidenceRefs: [evidence(`EVIDENCE.CONTROLLER.${actionId}`)],
    hostileFixtureRefs: hostile(actionId),
    nextAction: expectedAction,
    nextHandler: route.next_handler,
    continuation: route.continuation,
    authority: CONTROLLER_ACTION_AUTHORITY,
    protectedEvent: route.protected_event,
    defect: route.defect,
  });
  validateControllerActionReceipt(receipt);
}

const persisted = [];
const calls = [];
const handlers = {
  "HANDLER.PERMANENT_ROLE_ADMISSION": (cursor) => {
    calls.push(cursor.next_handler);
    return {
      semantic_after_sha256: HASH("state-2"),
      next_action: "INJECT_ORCHESTRATOR_GOVERNANCE",
      next_handler: "HANDLER.ORCHESTRATOR_GOVERNANCE",
      continuation: compileControllerContinuation("INJECT_ORCHESTRATOR_GOVERNANCE"),
      continuation_sha256: controllerContinuationDigest(compileControllerContinuation("INJECT_ORCHESTRATOR_GOVERNANCE")),
      evidence_refs: [evidence("EVIDENCE.CONTROLLER.ROLE_ADMITTED")],
      hostile_fixture_refs: hostile("ROLE_ADMITTED"),
      protected_event: null,
      defect: null,
    };
  },
  "HANDLER.ORCHESTRATOR_GOVERNANCE": (cursor) => {
    calls.push(cursor.next_handler);
    return {
      semantic_after_sha256: HASH("state-3"),
      next_action: "WAIT_FOR_PROTECTED_EVENT",
      next_handler: "HANDLER.PROTECTED_EVENT_WAIT",
      continuation: compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: protectedEvent.blocker_id}),
      continuation_sha256: controllerContinuationDigest(compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: protectedEvent.blocker_id})),
      evidence_refs: [evidence("EVIDENCE.CONTROLLER.ORCHESTRATOR_GATES")],
      hostile_fixture_refs: hostile("ORCHESTRATOR_GATES"),
      protected_event: structuredClone(protectedEvent),
      defect: null,
    };
  },
};
const advanced = advanceControllerAction(initial, {handlers, persist: (receipt) => { persisted.push(receipt); return true; }});
assert.equal(advanced.status, "PROTECTED_EVENT_WAIT");
assert.equal(advanced.receipt.next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(advanced.dispatched_count, 2);
assert.deepEqual(calls, ["HANDLER.PERMANENT_ROLE_ADMISSION", "HANDLER.ORCHESTRATOR_GOVERNANCE"]);
assert.equal(persisted.length, 2);
assert.equal(persisted[0].next_action, "INJECT_ORCHESTRATOR_GOVERNANCE");
assert.equal(persisted[1].next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.deepEqual(persisted[1].protected_event.resources, {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0});
assert.equal(persisted[1].stop_workflow_decision.primary_trigger_question_id, "OWNER_DECISION_REQUIRED");
assert.equal(persisted[1].stop_workflow_decision.stop, true);
const missingStopDecision = structuredClone(persisted[1]);
missingStopDecision.stop_workflow_decision = null;
assert.throws(() => validateControllerActionReceipt(missingStopDecision), /stop-workflow decision/u);
const staleStopDecision = structuredClone(persisted[1]);
staleStopDecision.stop_workflow_decision.answers[0].answer = "YES";
assert.throws(() => validateControllerActionReceipt(staleStopDecision), /decision|digest|outcome/u);

const deadEndRoute = deriveControllerSuccessor({localActions: []});
assert.equal(deadEndRoute.next_action, "SELF_REPAIR_WORKFLOW_DEAD_END");
assert.equal(deadEndRoute.next_handler, "HANDLER.SELF_REPAIR_WORKFLOW");
assert.equal(deadEndRoute.continuation.timer_deferral, false);
assert.ok(deadEndRoute.defect);
const deadEnd = compileControllerActionReceipt({
  receiptId: "RECEIPT.CONTROLLER.DEAD_END",
  actionId: "CLOSEOUT_WITHOUT_SUCCESSOR",
  semanticBeforeSha256: HASH("dead-end"), semanticAfterSha256: HASH("dead-end"),
  evidenceRefs: [evidence("EVIDENCE.CONTROLLER.DEAD_END")], hostileFixtureRefs: hostile("DEAD_END"),
  nextAction: deadEndRoute.next_action, nextHandler: deadEndRoute.next_handler, continuation: deadEndRoute.continuation, defect: deadEndRoute.defect,
});
assert.equal(deadEnd.next_action, "SELF_REPAIR_WORKFLOW_DEAD_END");
assert.throws(() => compileControllerActionReceipt({
  receiptId: "RECEIPT.CONTROLLER.ILLEGAL_DONE", actionId: "ILLEGAL_DONE", semanticBeforeSha256: HASH("a"), semanticAfterSha256: HASH("b"),
  evidenceRefs: [evidence("EVIDENCE.CONTROLLER.ILLEGAL_DONE")], hostileFixtureRefs: hostile("ILLEGAL_DONE"), nextAction: null,
}), /stable uppercase identifier|not registered/u);

const defectReports = [];
const incompleteHandler = {...handlers, "HANDLER.PERMANENT_ROLE_ADMISSION": () => ({
  semantic_after_sha256: HASH("state-2"), next_handler: "HANDLER.ORCHESTRATOR_GOVERNANCE", continuation: compileControllerContinuation("INJECT_ORCHESTRATOR_GOVERNANCE"),
  evidence_refs: [evidence("EVIDENCE.CONTROLLER.MISSING_NEXT_ACTION")], hostile_fixture_refs: hostile("MISSING_NEXT_ACTION"), protected_event: null, defect: null,
})};
assert.throws(() => advanceControllerAction(initial, {handlers: incompleteHandler, persist: () => true, onDefect: (defect) => defectReports.push(defect)}), (error) => error instanceof ControllerActionDefect && error.code === "INVALID_SUCCESSOR");
assert.equal(defectReports.at(-1).defect_class, "INVALID_SUCCESSOR");

const missingContinuationDigestReports = [];
const missingContinuationDigestHandler = {...handlers, "HANDLER.PERMANENT_ROLE_ADMISSION": () => ({
  semantic_after_sha256: HASH("state-2"), next_action: "INJECT_ORCHESTRATOR_GOVERNANCE", next_handler: "HANDLER.ORCHESTRATOR_GOVERNANCE",
  continuation: compileControllerContinuation("INJECT_ORCHESTRATOR_GOVERNANCE"), evidence_refs: [evidence("EVIDENCE.CONTROLLER.MISSING_CONTINUATION_DIGEST")], hostile_fixture_refs: hostile("MISSING_CONTINUATION_DIGEST"), protected_event: null, defect: null,
})};
assert.throws(() => advanceControllerAction(initial, {handlers: missingContinuationDigestHandler, persist: () => true, onDefect: (defect) => missingContinuationDigestReports.push(defect)}), (error) => error.code === "INVALID_SUCCESSOR");
assert.equal(missingContinuationDigestReports.at(-1).defect_class, "INVALID_SUCCESSOR");

const tamperedContinuationDigestReports = [];
const tamperedContinuationDigestHandler = {...handlers, "HANDLER.PERMANENT_ROLE_ADMISSION": () => {
  const continuation = compileControllerContinuation("INJECT_ORCHESTRATOR_GOVERNANCE");
  return {
    semantic_after_sha256: HASH("state-2"), next_action: "INJECT_ORCHESTRATOR_GOVERNANCE", next_handler: "HANDLER.ORCHESTRATOR_GOVERNANCE",
    continuation, continuation_sha256: HASH("tampered-continuation"), evidence_refs: [evidence("EVIDENCE.CONTROLLER.TAMPERED_CONTINUATION_DIGEST")], hostile_fixture_refs: hostile("TAMPERED_CONTINUATION_DIGEST"), protected_event: null, defect: null,
  };
}};
assert.throws(() => advanceControllerAction(initial, {handlers: tamperedContinuationDigestHandler, persist: () => true, onDefect: (defect) => tamperedContinuationDigestReports.push(defect)}), (error) => error.code === "INVALID_SUCCESSOR");
assert.equal(tamperedContinuationDigestReports.at(-1).defect_class, "INVALID_SUCCESSOR");

const missingPersistenceReports = [];
assert.throws(() => advanceControllerAction(initial, {handlers, onDefect: (defect) => missingPersistenceReports.push(defect)}), (error) => error.code === "MISSING_ATOMIC_PERSISTENCE");
assert.equal(missingPersistenceReports.at(-1).defect_class, "MISSING_ATOMIC_PERSISTENCE");

const missingHandlerReports = [];
assert.throws(() => advanceControllerAction(initial, {handlers: {}, persist: () => true, onDefect: (defect) => missingHandlerReports.push(defect)}), (error) => error.code === "STALE_OR_UNKNOWN_HANDLER");
assert.equal(missingHandlerReports.at(-1).defect_class, "STALE_OR_UNKNOWN_HANDLER");

const unknownHandler = structuredClone(initial);
unknownHandler.next_handler = "HANDLER.UNKNOWN";
unknownHandler.receipt_sha256 = canonicalDigest({...unknownHandler, receipt_sha256: null});
const staleReports = [];
assert.throws(() => advanceControllerAction(unknownHandler, {handlers, persist: () => true, onDefect: (defect) => staleReports.push(defect)}), (error) => error.code === "STALE_OR_UNKNOWN_HANDLER");
assert.equal(staleReports.at(-1).defect_class, "STALE_OR_UNKNOWN_HANDLER");

const unchangedReports = [];
const unchangedHandler = {...handlers, "HANDLER.PERMANENT_ROLE_ADMISSION": (cursor) => ({
  semantic_after_sha256: cursor.semantic_after_sha256, next_action: "INJECT_ORCHESTRATOR_GOVERNANCE", next_handler: "HANDLER.ORCHESTRATOR_GOVERNANCE",
  continuation: compileControllerContinuation("INJECT_ORCHESTRATOR_GOVERNANCE"), continuation_sha256: controllerContinuationDigest(compileControllerContinuation("INJECT_ORCHESTRATOR_GOVERNANCE")), evidence_refs: [evidence("EVIDENCE.CONTROLLER.UNCHANGED")], hostile_fixture_refs: hostile("UNCHANGED"), protected_event: null, defect: null,
})};
assert.throws(() => advanceControllerAction(initial, {handlers: unchangedHandler, persist: () => true, onDefect: (defect) => unchangedReports.push(defect)}), (error) => error.code === "UNCHANGED_SEMANTIC_STATE");
assert.equal(unchangedReports.at(-1).defect_class, "UNCHANGED_SEMANTIC_STATE");

const waitReceipt = compileControllerActionReceipt({
  receiptId: "RECEIPT.CONTROLLER.PROTECTED", actionId: "PROTECTED_CLOSEOUT", semanticBeforeSha256: HASH("protected"), semanticAfterSha256: HASH("protected"),
  evidenceRefs: [evidence("EVIDENCE.CONTROLLER.PROTECTED")], hostileFixtureRefs: hostile("PROTECTED"), nextAction: "WAIT_FOR_PROTECTED_EVENT", protectedEvent,
});
let protectedHandlerCalled = false;
const protectedResult = advanceControllerAction(waitReceipt, {handlers: {"HANDLER.PROTECTED_EVENT_WAIT": () => { protectedHandlerCalled = true; }}, persist: () => true});
assert.equal(protectedResult.status, "PROTECTED_EVENT_WAIT");
assert.equal(protectedHandlerCalled, false);
assert.throws(() => compileControllerActionReceipt({
  receiptId: "RECEIPT.CONTROLLER.BAD_PROTECTED", actionId: "BAD_PROTECTED", semanticBeforeSha256: HASH("a"), semanticAfterSha256: HASH("a"),
  evidenceRefs: [evidence("EVIDENCE.CONTROLLER.BAD_PROTECTED")], hostileFixtureRefs: hostile("BAD_PROTECTED"), nextAction: "WAIT_FOR_PROTECTED_EVENT", protectedEvent: {...protectedEvent, resources: {...protectedEvent.resources, workers: 1}},
}), /resource workers must be zero/u);

const deadWatchdog = deriveControllerSuccessor({localActions: [], protectedEvent: null});
assert.equal(deadWatchdog.next_action, "SELF_REPAIR_WORKFLOW_DEAD_END");
assert.notEqual(deadWatchdog.next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(deadWatchdog.continuation.same_turn_dispatch, true);

// A stale protected event must not mask ordinary work.  The route compiler
// rejects this as a typed successor defect so Spawner/Controller repair it
// rather than parking the campaign behind a false wait.
assert.throws(
  () => deriveControllerSuccessor({localActions: ["START_SPECIALIST_WAVE"], protectedEvent}),
  (error) => error instanceof ControllerActionDefect && error.code === "INVALID_SUCCESSOR" && /conflicts/u.test(error.message),
);
assert.throws(
  () => deriveControllerSuccessor({localActions: ["START_SPECIALIST_WAVE"], ownerReview: true}),
  (error) => error instanceof ControllerActionDefect && error.code === "INVALID_SUCCESSOR" && /conflicts/u.test(error.message),
);

console.log("PASS Controller successor dispatcher: closed registry coverage, same-turn local chaining, protected wait narrowing, self-repair dead ends, and typed defect routing");
