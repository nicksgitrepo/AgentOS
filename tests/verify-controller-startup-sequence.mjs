#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {CONTROLLER_ACTION_IDS, controllerActionHandlerFor} from "../control/controller-action-dispatcher.mjs";
import {
  CONTROLLER_STARTUP_SEQUENCE_SCHEMA,
  CONTROLLER_STARTUP_STAGES,
  compileControllerStartupSuccessor,
  validateControllerStartupSuccessor,
} from "../control/controller-startup-sequence.mjs";
import * as publicKernel from "../control/agentos.mjs";

const HASH = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: HASH(id)});
const hostile = (id) => [`FIXTURE.CONTROLLER.STARTUP.${id}`];
const facts = ({nextRoleId = null, incompleteBlockCount = 0, pendingRouteCount = 0, isolatedLocalCustody = true, independentClearanceStatus = "PENDING_EXTERNAL_AUTHORITY"} = {}) => ({
  next_role_id: nextRoleId,
  incomplete_block_count: incompleteBlockCount,
  pending_route_count: pendingRouteCount,
  isolated_local_custody: isolatedLocalCustody,
  independent_clearance_status: independentClearanceStatus,
});
const event = {
  blocker_id: "INDEPENDENT.UTILITY_HARM_CLEARANCE",
  blocker_class: "PROTECTED_EXTERNAL_DEPENDENCY",
  evidence_ceiling: "No independent clearance exists for a route that would activate governed workers or external capabilities.",
  restart_event: "Resume only on the exact typed clearance event.",
  resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
};
const base = {sequenceId: "STARTUP-SEQUENCE-1", stateSha256: HASH("startup"), evidenceRefs: [evidence("EVIDENCE.CONTROLLER.STARTUP")], hostileFixtureRefs: hostile("ROUTE")};

assert.deepEqual(CONTROLLER_STARTUP_STAGES, [
  "SEALED_BOOTSTRAP_ACCEPTED", "SPAWNER_ADMITTED", "PERMANENT_ROLES_IN_PROGRESS", "PERMANENT_ROLES_READY",
  "ORCHESTRATOR_GOVERNANCE_READY", "SPAWNER_COMPILER_ACTIVE", "SPAWNER_ROSTER_PUBLISHED", "GOVERNED_SPAWN_ADMITTED",
  "GOVERNED_SPAWN_ACTIVE", "IMPORT_ORCHESTRATOR_ACTIVE",
]);
const expected = {
  SEALED_BOOTSTRAP_ACCEPTED: "ADMIT_TYPED_AGENT_SPAWNER",
  SPAWNER_ADMITTED: "CONSTRUCT_PERMANENT_ROLES_ONE_AT_A_TIME",
  PERMANENT_ROLES_IN_PROGRESS: "ADMIT_NEXT_PERMANENT_ROLE",
  PERMANENT_ROLES_READY: "INJECT_ORCHESTRATOR_GOVERNANCE",
  ORCHESTRATOR_GOVERNANCE_READY: "START_COMPILER",
  SPAWNER_COMPILER_ACTIVE: "ADMIT_GOVERNED_SPAWN",
  SPAWNER_ROSTER_PUBLISHED: "ADMIT_GOVERNED_SPAWN",
  GOVERNED_SPAWN_ADMITTED: "START_GOVERNED_SPAWN",
  GOVERNED_SPAWN_ACTIVE: "START_IMPORT_ORCHESTRATOR",
  IMPORT_ORCHESTRATOR_ACTIVE: "REQUEST_SPAWNER_QA",
};
for (const stage of CONTROLLER_STARTUP_STAGES) {
  const sequence = compileControllerStartupSuccessor({
    ...base,
    stage,
    routeFacts: facts({nextRoleId: stage === "PERMANENT_ROLES_IN_PROGRESS" ? "AGENTOS.RUNTIME" : null}),
    hostileFixtureRefs: hostile(stage),
  });
  validateControllerStartupSuccessor(sequence);
  assert.equal(sequence.schema, CONTROLLER_STARTUP_SEQUENCE_SCHEMA);
  assert.equal(sequence.next_action, expected[stage]);
  assert.equal(sequence.next_handler, controllerActionHandlerFor(expected[stage]));
  assert.equal(sequence.true_blocker, false);
  assert.equal(sequence.protected_event, null);
  assert.equal(sequence.continuation.timer_deferral, false);
  assert.equal(sequence.continuation.heartbeat_deferral, false);
}

const compileNext = compileControllerStartupSuccessor({
  ...base, stage: "SPAWNER_COMPILER_ACTIVE", routeFacts: facts({incompleteBlockCount: 3}), hostileFixtureRefs: hostile("INCOMPLETE")
});
assert.equal(compileNext.next_action, "COMPILE_NEXT_BLOCK");
const publishNext = compileControllerStartupSuccessor({
  ...base, stage: "SPAWNER_COMPILER_ACTIVE", routeFacts: facts({pendingRouteCount: 2}), hostileFixtureRefs: hostile("PENDING")
});
assert.equal(publishNext.next_action, "PUBLISH_TYPED_ROSTER");

assert.throws(() => compileControllerStartupSuccessor({
  ...base,
  stage: "SPAWNER_COMPILER_ACTIVE",
  routeFacts: facts({isolatedLocalCustody: false}),
  protectedEvent: event,
  hostileFixtureRefs: hostile("PROTECTED"),
}), /cannot mask an eligible startup successor/u, "compiler-only handoff cannot be hidden by a protected event");

const compilerHandoff = compileControllerStartupSuccessor({
  ...base,
  stage: "SPAWNER_COMPILER_ACTIVE",
  routeFacts: facts({isolatedLocalCustody: false}),
  hostileFixtureRefs: hostile("COMPILER_HANDOFF"),
});
assert.equal(compilerHandoff.next_action, "ADMIT_GOVERNED_SPAWN", "completed compiler-only work must hand off to the adapter");
assert.equal(compilerHandoff.true_blocker, false);
assert.equal(compilerHandoff.protected_event, null);

assert.throws(() => compileControllerStartupSuccessor({
  ...base,
  stage: "GOVERNED_SPAWN_ADMITTED",
  routeFacts: facts({isolatedLocalCustody: false}),
  hostileFixtureRefs: hostile("GOVERNED_MISSING_CLEARANCE"),
}), /cannot activate without a typed true blocker/u, "governed activation cannot silently bypass clearance");

for (const [label, overrides] of [["INCOMPLETE_BLOCKS", {incompleteBlockCount: 1}], ["PENDING_ROUTES", {pendingRouteCount: 1}]]) {
  assert.throws(() => compileControllerStartupSuccessor({
    ...base,
    stage: "GOVERNED_SPAWN_ADMITTED",
    routeFacts: facts(overrides),
    hostileFixtureRefs: hostile(label),
  }), /cannot activate without a typed true blocker/u, `governed activation cannot bypass ${label.toLowerCase()}`);
}
assert.throws(() => compileControllerStartupSuccessor({
  ...base,
  stage: "GOVERNED_SPAWN_ADMITTED",
  routeFacts: facts({nextRoleId: "AGENTOS.RUNTIME"}),
  hostileFixtureRefs: hostile("PENDING_ROLE"),
}), /cannot activate without a typed true blocker/u, "governed activation cannot bypass an incomplete permanent roster");

const governedWait = compileControllerStartupSuccessor({
  ...base,
  stage: "GOVERNED_SPAWN_ADMITTED",
  routeFacts: facts({isolatedLocalCustody: false}),
  protectedEvent: event,
  hostileFixtureRefs: hostile("GOVERNED_PROTECTED"),
});
assert.equal(governedWait.next_action, "WAIT_FOR_INDEPENDENT_CLEARANCE");
assert.equal(governedWait.true_blocker, true);
assert.equal(governedWait.protected_event.blocker_id, event.blocker_id);

assert.throws(() => compileControllerStartupSuccessor({
  ...base,
  stage: "ORCHESTRATOR_GOVERNANCE_READY",
  routeFacts: facts(),
  protectedEvent: event,
  hostileFixtureRefs: hostile("FALSE_WAIT"),
}), /cannot mask an eligible startup successor/u);
const compilerHandoffWithoutEvent = compileControllerStartupSuccessor({
  ...base,
  stage: "SPAWNER_COMPILER_ACTIVE",
  routeFacts: facts({isolatedLocalCustody: false}),
  hostileFixtureRefs: hostile("MISSING_EVENT"),
});
assert.equal(compilerHandoffWithoutEvent.next_action, "ADMIT_GOVERNED_SPAWN");
assert.throws(() => compileControllerStartupSuccessor({
  ...base,
  stage: "PERMANENT_ROLES_IN_PROGRESS",
  routeFacts: facts(),
  hostileFixtureRefs: hostile("MISSING_ROLE"),
}), /requires a next role/u);

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/controller-startup-sequence.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, "https://agentos.dev/schemas/controller-startup-sequence.v1.json");
assert.deepEqual(schema.properties.stage.enum, CONTROLLER_STARTUP_STAGES);
const compilerRule = schema.allOf.find((rule) => rule.if?.properties?.stage?.const === "SPAWNER_COMPILER_ACTIVE");
assert.deepEqual(compilerRule.then.properties.next_action.enum, ["COMPILE_NEXT_BLOCK", "PUBLISH_TYPED_ROSTER", "ADMIT_GOVERNED_SPAWN"]);
const rosterRule = schema.allOf.find((rule) => rule.if?.properties?.stage?.const === "SPAWNER_ROSTER_PUBLISHED");
assert.equal(rosterRule.then.properties.next_action.const, "ADMIT_GOVERNED_SPAWN");
assert.equal(publicKernel.compileControllerStartupSuccessor, compileControllerStartupSuccessor);
assert.equal(publicKernel.validateControllerStartupSuccessor, validateControllerStartupSuccessor);
assert.equal(publicKernel.controllerStartup.compileControllerStartupSuccessor, compileControllerStartupSuccessor);
assert.equal(typeof publicKernel.admitAgentSpawnerIsolatedLocalCustody, "function");
for (const action of ["START_IMPORT_ORCHESTRATOR", ...Object.values(expected)]) assert(CONTROLLER_ACTION_IDS.includes(action), `startup action is not registered: ${action}`);

console.log("PASS Controller startup sequence: same-turn Bootstrap→Spawner→roles→governance→compiler→roster→spawn→Orchestrator routing, true-blocker-only waits, and hostile false-idle rejection");
