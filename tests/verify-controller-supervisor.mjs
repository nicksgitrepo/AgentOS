#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compileSupervisorGoal,
  compileSupervisorObservation,
  deriveSupervisorAction,
  readSupervisorRecord,
  runSupervisorIteration,
  validateSupervisorGoal,
  validateSupervisorObservation,
  writeSupervisorRecordCompareAndSwap,
} from "../control/controller-supervisor.mjs";
import {runControllerSupervisorIteration} from "../control/controller-supervisor-runtime.mjs";

const sourceCommit = "1".repeat(40);
const sourceTree = "2".repeat(40);
const parentHandoffSha256 = "3".repeat(64);
const sourceSha256 = "4".repeat(64);
const now = "2026-08-04T12:00:00.000Z";

function boundary(overrides = {}) {
  return {
    hard_stop: false,
    soft_review: false,
    owner_decision_required: false,
    scope_changed: false,
    local_development_writes_allowed: true,
    local_worker_agent_spawns_allowed: true,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    external_deployment_allowed: false,
    external_release_allowed: false,
    external_publication_allowed: false,
    external_push_allowed: false,
    external_merge_allowed: false,
    secrets_allowed: false,
    destructive_work_allowed: false,
    ...overrides,
  };
}

function observation(overrides = {}) {
  return compileSupervisorObservation({
    projectId: "PROJECT-1",
    campaignId: "CAMPAIGN-1",
    campaignVersion: "v1",
    activeCampaign: true,
    boundary: boundary(),
    findings: [],
    nextAction: "Observe the current campaign handoff.",
    sourceCommit,
    sourceTree,
    parentHandoffSha256,
    observedAtUtc: now,
    ...overrides,
  });
}

const puzzle = observation({
  findings: [{
    finding_id: "F-LIFECYCLE-1",
    classification: "REPAIRABLE_ENGINEERING_PUZZLE",
    status: "OPEN_NEXT_REQUIRED_BEHAVIOR",
    summary: "A campaign worker exited after one handoff instead of remaining supervised.",
    source_sha256: sourceSha256,
  }],
});
assert.equal(deriveSupervisorAction(puzzle), "ROUTE_REPAIRABLE_PUZZLE");
let routed = 0;
const routedResult = runSupervisorIteration({
  observation: puzzle,
  route: (goal) => {
    routed += 1;
    assert.equal(goal.action, "ROUTE_REPAIRABLE_PUZZLE");
    return {status: "ROUTED", task_id: "TASK-1"};
  },
});
assert.equal(routed, 1);
assert.equal(routedResult.tick.route_status, "ROUTED");
validateSupervisorGoal(routedResult.goal);

const failedRoute = runSupervisorIteration({observation: puzzle, route: () => { throw new Error("route adapter unavailable"); }});
assert.equal(failedRoute.tick.route_status, "ROUTE_FAILED");
assert.match(failedRoute.tick.route_error, /route adapter unavailable/u);

const soft = observation({
  boundary: boundary({soft_review: true, scope_changed: true}),
});
assert.equal(deriveSupervisorAction(soft), "REVIEW_SOFT_BOUNDARY");
assert.equal(runSupervisorIteration({observation: soft, route: () => ({status: "REVIEWED"})}).goal.action, "REVIEW_SOFT_BOUNDARY");

const hard = observation({
  ownerDecisionRequired: true,
  boundary: boundary({hard_stop: true, owner_decision_required: true}),
});
assert.equal(deriveSupervisorAction(hard), "STOP_HARD_BOUNDARY");
let attemptedHardRoute = false;
const hardResult = runSupervisorIteration({observation: hard, route: () => { attemptedHardRoute = true; return {}; }});
assert.equal(attemptedHardRoute, false, "a hard boundary must not be routed");
assert.equal(hardResult.tick.route_status, "STOPPED_HARD_BOUNDARY");

const liveness = observation({findings: []});
assert.equal(deriveSupervisorAction(liveness), "RECONCILE_LIVENESS");
const idle = observation({activeCampaign: false});
assert.equal(deriveSupervisorAction(idle), "WAIT_FOR_AUTHORIZED_WORK");

const tampered = structuredClone(puzzle);
tampered.next_action = "invent Product work";
assert.throws(() => validateSupervisorObservation(tampered), /digest mismatch/u);
assert.throws(() => compileSupervisorObservation({
  projectId: "PROJECT-1",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  activeCampaign: true,
  boundary: boundary({owner_decision_required: true}),
  nextAction: "Owner decision is required.",
  sourceCommit,
  sourceTree,
  parentHandoffSha256,
  observedAtUtc: now,
}), /owner decision is always a hard stop/u);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-supervisor-"));
const record = {
  schema: "agentos.controller_supervisor_record_test.v1",
  version: 1,
  record_sha256: sourceSha256,
};
writeSupervisorRecordCompareAndSwap({authorityRoot: root, recordPath: "controller/record.json", expectedDigest: null, record, digestField: "record_sha256"});
assert.deepEqual(readSupervisorRecord({authorityRoot: root, recordPath: "controller/record.json"}), record);
assert.throws(() => writeSupervisorRecordCompareAndSwap({authorityRoot: root, recordPath: "controller/record.json", expectedDigest: "5".repeat(64), record, digestField: "record_sha256"}), /compare-and-swap parent is stale/u);
fs.rmSync(root, {recursive: true, force: true});

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-supervisor-runtime-"));
const changedObservation = observation({sourceCommit: "5".repeat(40), sourceTree: "6".repeat(40)});
let runtimeObservation = puzzle;
let routeAttempts = 0;
const runtimeAdapter = {
  observe: () => runtimeObservation,
  route: () => {
    routeAttempts += 1;
    if (routeAttempts === 1) throw new Error("stale route adapter");
    return {status: "ROUTED", attempt: routeAttempts};
  },
};
const firstRuntime = await runControllerSupervisorIteration({runtimeRoot, adapter: runtimeAdapter, runtimeId: "SUPERVISOR-RUNTIME-TEST"});
assert.equal(firstRuntime.tick.route_status, "ROUTE_FAILED");
runtimeObservation = changedObservation;
const secondRuntime = await runControllerSupervisorIteration({runtimeRoot, adapter: runtimeAdapter, runtimeId: "SUPERVISOR-RUNTIME-TEST"});
assert.equal(secondRuntime.tick.route_status, "ROUTED");
assert.equal(fs.existsSync(path.join(runtimeRoot, "supervisor", "route-failures", `${firstRuntime.goal.goal_id}.json`)), true);
const reusedRuntime = await runControllerSupervisorIteration({runtimeRoot, adapter: runtimeAdapter, runtimeId: "SUPERVISOR-RUNTIME-TEST"});
assert.equal(reusedRuntime.reused, true, "an unchanged observation must not retry the same route");
assert.equal(routeAttempts, 2);
fs.rmSync(runtimeRoot, {recursive: true, force: true});

console.log("PASS Controller supervisor: deterministic goal minting, hard-stop enforcement, soft review routing, repair routing, liveness choice, failure retention, and CAS records verified");
