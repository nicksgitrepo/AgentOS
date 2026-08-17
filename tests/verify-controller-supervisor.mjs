#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compileSupervisorGoal,
  compileSupervisorObservation,
  compileSupervisorTick,
  deriveSupervisorAction,
  readSupervisorRecord,
  selectAutonomousNextTask,
  runSupervisorIteration,
  supervisorDigest,
  validateSupervisorGoal,
  validateSupervisorObservation,
  writeSupervisorRecordCompareAndSwap,
} from "../control/controller-supervisor.mjs";
import {runControllerSupervisorIteration} from "../control/controller-supervisor-runtime.mjs";
import {validateAgentSpawnerDefectIntake} from "../control/agent-spawner-defect-intake.mjs";

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
const sameObservationLater = observation({observedAtUtc: "2026-08-04T12:00:01.000Z", findings: puzzle.findings});
assert.equal(sameObservationLater.observation_sha256, puzzle.observation_sha256, "observation identity must ignore the heartbeat clock");
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
assert.match(failedRoute.tick.route_error, /^opaque:error:[0-9a-f]{64}$/u);
assert.doesNotMatch(JSON.stringify(failedRoute.tick), /route adapter unavailable/u);

const soft = observation({
  boundary: boundary({soft_review: true, scope_changed: true}),
});
assert.equal(deriveSupervisorAction(soft), "REVIEW_SOFT_BOUNDARY");
assert.equal(runSupervisorIteration({observation: soft, route: () => ({status: "REVIEWED"})}).goal.action, "REVIEW_SOFT_BOUNDARY");

const hardFindingWithSoftScopeChange = observation({
  boundary: boundary({soft_review: true, scope_changed: true}),
  findings: [{
    finding_id: "F-HARD-SECURITY-1",
    classification: "HARD_SECURITY_BOUNDARY",
    status: "OPEN_REPAIR_REQUIRED",
    summary: "A protected security boundary is open while the campaign scope also changed.",
    source_sha256: sourceSha256,
  }],
});
assert.equal(deriveSupervisorAction(hardFindingWithSoftScopeChange), "STOP_HARD_BOUNDARY", "hard security findings must outrank soft review");
let attemptedMixedBoundaryRoute = false;
const mixedBoundaryResult = runSupervisorIteration({
  observation: hardFindingWithSoftScopeChange,
  route: () => { attemptedMixedBoundaryRoute = true; return {}; },
});
assert.equal(attemptedMixedBoundaryRoute, false, "a hard security finding must not be routed through soft review");
assert.equal(mixedBoundaryResult.tick.route_status, "STOPPED_HARD_BOUNDARY");

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
assert.equal(deriveSupervisorAction(idle), "RECONCILE_LIVENESS", "an inactive workflow must be repaired or reconciled before any wait");

const autonomousTasks = [
  {
    task_id: "CONTROLLER-TASK-SECOND",
    status: "OPEN",
    priority: 2,
    summary: "Second safe task.",
    scope: ["CONTROL_PLANE"],
    owner_decision_required: false,
  },
  {
    task_id: "CONTROLLER-TASK-FIRST",
    status: "OPEN",
    priority: 1,
    summary: "First safe task.",
    scope: ["CONTROL_PLANE"],
    owner_decision_required: false,
  },
].sort((left, right) => left.priority - right.priority || left.task_id.localeCompare(right.task_id));
assert.deepEqual(selectAutonomousNextTask({tasks: autonomousTasks, boundary: boundary(), findings: [], activeCampaign: true}), {
  action: "ROUTE_REPAIRABLE_PUZZLE",
  task_id: "CONTROLLER-TASK-FIRST",
  reason: "First safe task.",
});
assert.equal(selectAutonomousNextTask({tasks: autonomousTasks, boundary: boundary({soft_review: true, scope_changed: true}), findings: [], activeCampaign: true}).action, "REVIEW_SOFT_BOUNDARY");
assert.equal(selectAutonomousNextTask({tasks: autonomousTasks, boundary: boundary({soft_review: true, scope_changed: true}), findings: [{
  finding_id: "F-HARD-SECURITY-2",
  classification: "HARD_SECURITY_BOUNDARY",
  status: "OPEN_REPAIR_REQUIRED",
  summary: "Hard security boundary.",
  source_sha256: sourceSha256,
}], activeCampaign: true}).action, "STOP_HARD_BOUNDARY");
assert.equal(selectAutonomousNextTask({tasks: [], boundary: boundary(), findings: [], activeCampaign: true}).action, "RECONCILE_LIVENESS");
assert.equal(selectAutonomousNextTask({tasks: [], boundary: boundary(), findings: [], activeCampaign: false}).action, "RECONCILE_LIVENESS");
assert.equal(selectAutonomousNextTask({tasks: [{...autonomousTasks[0], task_id: "CONTROLLER-TASK-OWNER", owner_decision_required: true}], boundary: boundary(), findings: [], activeCampaign: true}).action, "STOP_HARD_BOUNDARY");

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
assert.equal(secondRuntime.priorSpawnerDefect?.defect_kind, "NON_PASSING_CHECK");
assert.equal(fs.existsSync(path.join(runtimeRoot, "supervisor", "route-failures", `${firstRuntime.goal.goal_id}.json`)), true);
const spawnerDefectDirectory = path.join(runtimeRoot, "supervisor", "spawner-defects");
const routeFailureDefectFiles = fs.readdirSync(spawnerDefectDirectory).filter((name) => name.endsWith(".json"));
assert.equal(routeFailureDefectFiles.length, 1, "a route failure must produce one typed Spawner intake");
const routeFailureDefect = JSON.parse(fs.readFileSync(path.join(spawnerDefectDirectory, routeFailureDefectFiles[0]), "utf8"));
validateAgentSpawnerDefectIntake(routeFailureDefect);
assert.equal(routeFailureDefect.repair.kind, "REUSABLE_BLOCK_PATCH");
assert.equal(routeFailureDefect.handoff.next_action, "ROUTE_TO_CONTROLLER_CUSTODY");
const reusedRuntime = await runControllerSupervisorIteration({runtimeRoot, adapter: runtimeAdapter, runtimeId: "SUPERVISOR-RUNTIME-TEST"});
assert.equal(reusedRuntime.recovery_started_same_turn, true, "an unchanged observation must start a bounded recovery in the same turn");
assert.equal(reusedRuntime.reused, false, "the bounded recovery must mint a distinct successor goal");
assert.equal(routeAttempts, 3);
const reusedRuntimeState = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "supervisor", "runtime.json"), "utf8"));
assert.equal(reusedRuntimeState.status, "ROUTED_OR_RECONCILED", "the bounded liveness repair must be routed immediately");
assert.equal(reusedRuntime.noProgressRca.error_message_exact, "NO_SEMANTIC_PROGRESS_AFTER_ROUTED_SUCCESS");
assert.equal(fs.existsSync(path.join(runtimeRoot, "supervisor", "no-progress", `${secondRuntime.goal.goal_id}.json`)), true);
const noProgressDefectFiles = fs.readdirSync(spawnerDefectDirectory).filter((name) => name.endsWith(".json"));
assert.equal(noProgressDefectFiles.length, 2, "a no-progress RCA must add a typed Spawner intake");
assert.equal(reusedRuntime.spawnerDefect.repair.block_id, "BLOCK.CONTROLLER.SUPERVISOR.LIVENESS");
fs.rmSync(runtimeRoot, {recursive: true, force: true});

const authorizedWaitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-supervisor-authorized-wait-"));
const authorizedWaitAdapter = {
  observe: () => liveness,
  route: () => ({
    status: "WAITING_FOR_AUTHORIZED_WORK",
    resume_event_id: "OWNER-EVENT-1",
    resume_condition: "Resume only when the exact owner event arrives.",
  }),
};
const authorizedWaitRuntime = await runControllerSupervisorIteration({runtimeRoot: authorizedWaitRoot, adapter: authorizedWaitAdapter, runtimeId: "SUPERVISOR-AUTHORIZED-WAIT-TEST"});
assert.equal(JSON.parse(fs.readFileSync(path.join(authorizedWaitRoot, "supervisor", "runtime.json"), "utf8")).status, "ROUTED_OR_RECONCILED", "a normal routed result is not a wait without an explicit event action");
// The runtime must recognize an explicit event readback when the goal itself requests it.
const eventWaitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-supervisor-event-wait-"));
const eventWaitObservation = observation({nextAction: "Wait for the exact owner event before continuing."});
const eventWaitAdapter = {
  observe: () => eventWaitObservation,
  route: () => ({
    status: "WAITING_FOR_AUTHORIZED_WORK",
    resume_event_id: "OWNER-EVENT-1",
    resume_condition: "Resume only when the exact owner event arrives.",
  }),
};
const eventWaitRuntime = await runControllerSupervisorIteration({runtimeRoot: eventWaitRoot, adapter: eventWaitAdapter, runtimeId: "SUPERVISOR-EVENT-WAIT-TEST"});
const eventWaitGoal = {...eventWaitRuntime.goal, action: "WAIT_FOR_AUTHORIZED_WORK", goal_sha256: null};
eventWaitGoal.goal_sha256 = supervisorDigest({...eventWaitGoal, created_at_utc: null});
const reboundEventWaitTick = compileSupervisorTick({observation: eventWaitObservation, goal: eventWaitGoal, routeStatus: "ROUTED", routeReadback: eventWaitRuntime.tick.route_readback});
fs.writeFileSync(path.join(eventWaitRoot, "supervisor", "goal.json"), `${JSON.stringify(eventWaitGoal)}\n`);
fs.writeFileSync(path.join(eventWaitRoot, "supervisor", "tick.json"), `${JSON.stringify(reboundEventWaitTick)}\n`);
// The synthetic route is accepted only when its exact event binding is present; no no-progress RCA is produced.
const eventWaitReuse = await runControllerSupervisorIteration({runtimeRoot: eventWaitRoot, adapter: eventWaitAdapter, runtimeId: "SUPERVISOR-EVENT-WAIT-TEST"});
assert.equal(eventWaitReuse.reused, true);
assert.equal(JSON.parse(fs.readFileSync(path.join(eventWaitRoot, "supervisor", "runtime.json"), "utf8")).status, "ACTIVE_EVENT_WAIT");
assert.equal(eventWaitReuse.noProgressRca, undefined);
fs.rmSync(authorizedWaitRoot, {recursive: true, force: true});
fs.rmSync(eventWaitRoot, {recursive: true, force: true});

const evolvingFailureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-supervisor-evolving-failure-"));
let evolvingObservation = puzzle;
let evolvingAttempts = 0;
const evolvingAdapter = {
  observe: () => evolvingObservation,
  route: () => {
    evolvingAttempts += 1;
    throw new Error(`route failure ${evolvingAttempts}`);
  },
};
const firstEvolvingRuntime = await runControllerSupervisorIteration({runtimeRoot: evolvingFailureRoot, adapter: evolvingAdapter, runtimeId: "SUPERVISOR-EVOLVING-FAILURE-TEST"});
evolvingObservation = changedObservation;
const secondEvolvingRuntime = await runControllerSupervisorIteration({runtimeRoot: evolvingFailureRoot, adapter: evolvingAdapter, runtimeId: "SUPERVISOR-EVOLVING-FAILURE-TEST"});
assert.equal(secondEvolvingRuntime.tick.route_status, "ROUTE_FAILED");
assert.equal(fs.existsSync(path.join(evolvingFailureRoot, "supervisor", "route-failures", `${firstEvolvingRuntime.goal.goal_id}.json`)), true);
fs.writeFileSync(path.join(evolvingFailureRoot, "supervisor", "goal.json"), `${JSON.stringify(firstEvolvingRuntime.goal)}\n`);
fs.writeFileSync(path.join(evolvingFailureRoot, "supervisor", "tick.json"), `${JSON.stringify(firstEvolvingRuntime.tick)}\n`);
evolvingObservation = observation({sourceCommit: "7".repeat(40), sourceTree: "8".repeat(40)});
await runControllerSupervisorIteration({runtimeRoot: evolvingFailureRoot, adapter: evolvingAdapter, runtimeId: "SUPERVISOR-EVOLVING-FAILURE-TEST"});
assert.equal(fs.existsSync(path.join(evolvingFailureRoot, "supervisor", "route-failures", `${firstEvolvingRuntime.goal.goal_id}-${evolvingObservation.observation_sha256}.json`)), true);
fs.rmSync(evolvingFailureRoot, {recursive: true, force: true});

console.log("PASS Controller supervisor: deterministic goal minting, hard-stop enforcement, soft review routing, repair routing, liveness choice, failure retention, and CAS records verified");
