#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import * as publicKernel from "../control/agentos.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {controllerActionHandlerFor, compileControllerContinuation} from "../control/controller-action-dispatcher.mjs";
import {compileControllerStartupSuccessor} from "../control/controller-startup-sequence.mjs";
import {
  CONTROLLER_STARTUP_RUNNER_SCHEMA,
  compileControllerStartupRunReadback,
  runControllerStartupCycle,
  validateControllerStartupRunReadback,
} from "../control/controller-startup-runner.mjs";

const HASH = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: HASH(id)});
const hostile = (id) => [`FIXTURE.CONTROLLER.STARTUP.RUNNER.${id}`];
const protectedEvent = {
  blocker_id: "INDEPENDENT.UTILITY_HARM_CLEARANCE",
  blocker_class: "PROTECTED_EXTERNAL_DEPENDENCY",
  evidence_ceiling: "No typed independent clearance exists for the next governed activation boundary.",
  restart_event: "Resume only on the exact bound clearance event.",
  resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
};
const sequence = compileControllerStartupSuccessor({
  sequenceId: "STARTUP-RUNNER-1",
  stage: "SEALED_BOOTSTRAP_ACCEPTED",
  stateSha256: HASH("sealed-bootstrap"),
  routeFacts: {next_role_id: null, incomplete_block_count: 0, pending_route_count: 0, isolated_local_custody: true, independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY"},
  evidenceRefs: [evidence("EVIDENCE.CONTROLLER.STARTUP.RUNNER.ROOT")],
  hostileFixtureRefs: hostile("ROOT"),
});

let governedCalls = 0;
const calls = [];
const resultFor = (cursor, nextAction, label, event = null) => {
  calls.push(cursor.next_handler);
  const continuation = compileControllerContinuation(nextAction, {protectedEventId: event?.blocker_id ?? null});
  return {
    semantic_after_sha256: HASH(`${label}:${cursor.semantic_after_sha256}`),
    next_action: nextAction,
    next_handler: controllerActionHandlerFor(nextAction),
    continuation,
    continuation_sha256: canonicalDigest(continuation),
    evidence_refs: [evidence(`EVIDENCE.CONTROLLER.STARTUP.RUNNER.${label}`)],
    hostile_fixture_refs: hostile(label),
    protected_event: structuredClone(event),
    defect: null,
  };
};
const handlers = {
  "HANDLER.SPAWNER_ADMISSION": (cursor) => resultFor(cursor, "CONSTRUCT_PERMANENT_ROLES_ONE_AT_A_TIME", "SPAWNER_ADMITTED"),
  "HANDLER.PERMANENT_ROLE_CONSTRUCTION": (cursor) => resultFor(cursor, "ADMIT_NEXT_PERMANENT_ROLE", "ROLE_CONSTRUCTION"),
  "HANDLER.PERMANENT_ROLE_ADMISSION": (cursor) => resultFor(cursor, "INJECT_ORCHESTRATOR_GOVERNANCE", "ROLE_ADMITTED"),
  "HANDLER.ORCHESTRATOR_GOVERNANCE": (cursor) => resultFor(cursor, "START_COMPILER", "GOVERNANCE_READY"),
  "HANDLER.SPAWNER_COMPILER": (cursor) => resultFor(cursor, "COMPILE_NEXT_BLOCK", "COMPILER_ACTIVE"),
  "HANDLER.SPAWNER_BLOCK_COMPILER": (cursor) => resultFor(cursor, "PUBLISH_TYPED_ROSTER", "BLOCK_COMPILED"),
  "HANDLER.SPAWNER_ROSTER_PUBLISHER": (cursor) => resultFor(cursor, "ADMIT_GOVERNED_SPAWN", "ROSTER_PUBLISHED"),
  "HANDLER.GOVERNED_SPAWN_ADAPTER": (cursor) => {
    governedCalls += 1;
    return governedCalls === 1
      ? resultFor(cursor, "START_GOVERNED_SPAWN", "SPAWN_ADMITTED")
      : resultFor(cursor, "START_IMPORT_ORCHESTRATOR", "SPAWN_ACTIVE");
  },
  "HANDLER.ORCHESTRATOR_START": (cursor) => resultFor(cursor, "WAIT_FOR_PROTECTED_EVENT", "ORCHESTRATOR_STARTED", protectedEvent),
};
const persisted = [];
const readbacks = [];
const run = runControllerStartupCycle({
  sequence,
  handlers,
  persist: (receipt) => { persisted.push(receipt); return true; },
  persistReadback: (readback) => { readbacks.push(readback); return true; },
});
assert.equal(run.status, "PROTECTED_EVENT_WAIT");
assert.equal(run.dispatched_count, 10);
assert.equal(run.receipt.next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(run.receipt.continuation.timer_deferral, false);
assert.equal(run.receipt.continuation.heartbeat_deferral, false);
assert.equal(persisted.length, 11, "initial cursor plus every same-turn successor must be persisted");
assert.equal(readbacks.length, 1);
assert.equal(readbacks[0].schema, CONTROLLER_STARTUP_RUNNER_SCHEMA);
assert.equal(readbacks[0].next_action, "WAIT_FOR_PROTECTED_EVENT");
validateControllerStartupRunReadback(readbacks[0]);
assert.deepEqual(calls, [
  "HANDLER.SPAWNER_ADMISSION", "HANDLER.PERMANENT_ROLE_CONSTRUCTION", "HANDLER.PERMANENT_ROLE_ADMISSION",
  "HANDLER.ORCHESTRATOR_GOVERNANCE", "HANDLER.SPAWNER_COMPILER", "HANDLER.SPAWNER_BLOCK_COMPILER",
  "HANDLER.SPAWNER_ROSTER_PUBLISHER", "HANDLER.GOVERNED_SPAWN_ADAPTER", "HANDLER.GOVERNED_SPAWN_ADAPTER",
  "HANDLER.ORCHESTRATOR_START",
]);
assert.equal(publicKernel.runControllerStartupCycle, runControllerStartupCycle);
assert.equal(publicKernel.controllerStartupRunner.runControllerStartupCycle, runControllerStartupCycle);

const tampered = structuredClone(readbacks[0]);
tampered.next_action = "NONE";
assert.throws(() => validateControllerStartupRunReadback(tampered), /handler|action/u);
const schema = JSON.parse(fs.readFileSync(new URL("../schemas/controller-startup-runner.v1.json", import.meta.url), "utf8"));
assert.equal(schema.properties.schema.const, CONTROLLER_STARTUP_RUNNER_SCHEMA);
assert.deepEqual(schema.properties.status.enum, ["ROUTED_SAME_TURN", "PROTECTED_EVENT_WAIT", "OWNER_REVIEW_REQUIRED"]);
assert.equal(compileControllerStartupRunReadback({sequence, initialReceipt: run.initial_receipt, result: run}).runner_sha256, readbacks[0].runner_sha256);

console.log("PASS Controller startup runner: durable initial cursor, same-turn Bootstrap→Spawner→roles→Orchestrator dispatch, typed protected boundary, and non-null readback");
