#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import * as publicKernel from "../control/agentos.mjs";
import {
  applyAndWriteAgentOSControllerEventAsync,
  compileAgentOSControllerState,
  compileControllerRuntimeReadback,
  readAgentOSControllerState,
  writeAgentOSControllerStateCompareAndSwap,
} from "../control/agentos-controller.mjs";
import {compileGlobalPolicyState} from "../control/global-policy-state.mjs";
import {
  CONTROLLER_ROLE_ID,
  PRODUCT_OWNER_ROLE_ID,
  compileControllerWorkflowMonitorTick,
  compileControllerWorkflowRegulatorContract,
  validateControllerWorkflowRegulator,
} from "../control/controller-workflow-regulator.mjs";
import {CONTROLLER_FORBIDDEN_OPERATIONS} from "../control/spawner-bootstrap-governance.mjs";
import {disposeEphemeralControllerProjectStoreForTest, openControllerProjectStore, prepareEphemeralControllerProjectStoreForTest} from "./helpers/controller-project-store-fixture.mjs";

const contract = compileControllerWorkflowRegulatorContract();
validateControllerWorkflowRegulator(contract);
assert.equal(contract.role_id, CONTROLLER_ROLE_ID);
assert.equal(contract.intent_owner_role_id, PRODUCT_OWNER_ROLE_ID);
assert.equal(contract.public_name, "Controller");
assert.equal(contract.human_facing, false);
assert.equal(contract.workflow_scope, "WORKFLOW_REGULATION_ONLY");
assert.equal(contract.progress_interval_minutes, 15);
assert.deepEqual(contract.forbidden_controller_operations, [...CONTROLLER_FORBIDDEN_OPERATIONS].sort());
assert.equal(publicKernel.compileControllerWorkflowRegulatorContract, compileControllerWorkflowRegulatorContract);
assert.equal(Object.hasOwn(publicKernel, "createIntentRegulatorRuntime"), false, "legacy Intent Regulator runtime must not be public Controller authority");
assert.equal(Object.hasOwn(publicKernel, "projectOwnerBootstrap"), false, "Product Owner must not receive Bootstrap/Controller workflow mutation exports");
assert.equal(Object.hasOwn(publicKernel, "projectOwnerConversation"), false);
assert.equal(typeof publicKernel.productOwnerOperational.runProductOwnerOperationalRequest, "function");
assert.throws(() => publicKernel.productOwnerOperational.runProductOwnerOperationalRequest({operation: "RESPOND_TO_USER", request: {message: "The team is moving forward."}}), /opaque governed authority/u);
assert.equal(Object.hasOwn(publicKernel.productOwnerOperational, "advanceRapidPrototype"), false);
assert.equal(Object.hasOwn(publicKernel.productOwnerOperational, "compileControllerProgressTick"), false);

assert.equal(compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress: 0, activeWorkInProgress: true, claimedBlocker: false, protectedBlockerProven: false}).status, "MOVING");
assert.equal(compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress: 15, activeWorkInProgress: false, claimedBlocker: false, protectedBlockerProven: false}).status, "FALSE_STALL_REJECTED");
assert.equal(compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress: 15, activeWorkInProgress: false, claimedBlocker: true, protectedBlockerProven: true}).status, "TRUE_BLOCKER");
for (const tick of [
  compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress: 0, activeWorkInProgress: true, claimedBlocker: false, protectedBlockerProven: false}),
  compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress: 15, activeWorkInProgress: false, claimedBlocker: false, protectedBlockerProven: false}),
  compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress: 15, activeWorkInProgress: false, claimedBlocker: true, protectedBlockerProven: true}),
]) {
  assert.equal(tick.role_id, CONTROLLER_ROLE_ID);
  assert.equal(tick.intent_owner_role_id, PRODUCT_OWNER_ROLE_ID);
  assert.equal(tick.timer_minutes, 15);
}

const denied = [
  "admitLocalSelfDevelopment", "archiveCampaignAgents", "bindPersistentRuntime", "despawnAgent",
  "mutateGovernanceMemory", "mutateRoster", "spawnCampaignOrchestrator", "spawnFeatureAgents",
  "spawnIndependentAuditor", "spawnSeed", "spawnWorker",
];
for (const operation of denied) {
  assert.throws(() => publicKernel.assertControllerWorkflowOperation(operation), /forbidden|not authorized|invalid/u, `Controller must deny ${operation}`);
}

// The test-only fixture is deliberately not a production provisioner. The
// production Controller must remain unavailable until trusted Bootstrap binds
// the project store, and must reject every fixture capability before adapters.
const projectStoreProvision = prepareEphemeralControllerProjectStoreForTest();
const projectStore = openControllerProjectStore({projectControlStoreCapability: projectStoreProvision});
try {
  const projectId = "synthetic-project";
  const policy = compileGlobalPolicyState({projectId, nowUtc: "2026-01-01T00:00:00.000Z"});
  const runtime = compileControllerRuntimeReadback({projectId, controllerRuntimeId: "CONTROLLER-RUNTIME-SEPARATION", runtimeId: "PROJECT-RUNTIME-SEPARATION", environmentIdentity: "CONTROLLER-ENV-SEPARATION", capabilitySetSha256: "a".repeat(64), observedBySession: "CONTROLLER-SESSION-SEPARATION", observedAtUtc: "2026-01-01T00:00:00.000Z"});
  const initial = compileAgentOSControllerState({projectId, logicalControllerId: "AGENTOS-CONTROLLER-SEPARATION", currentSessionId: "CONTROLLER-SESSION-SEPARATION", policyState: policy, controllerRuntimeReadback: runtime, nowUtc: "2026-01-01T00:00:00.000Z"});
  assert.throws(() => readAgentOSControllerState({authorityRoot: "/tmp/forged", statePath: "controller-state.json"}), /rejects caller roots|paths|environment/u);
  assert.throws(() => writeAgentOSControllerStateCompareAndSwap({projectControlStoreCapability: projectStore, state: initial}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u);
  let calls = 0;
  const adapters = new Proxy({}, {get: () => async () => { calls += 1; throw new Error("adapter must not run"); }});
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({projectControlStoreCapability: projectStore, event: {}, adapters}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u);
  assert.equal(calls, 0, "unprovisioned Controller invoked an adapter");
} finally {
  disposeEphemeralControllerProjectStoreForTest(projectStoreProvision);
}

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/controller-workflow-regulator.v1.json", import.meta.url), "utf8"));
assert.equal(schema.schema, contract.schema);
assert.equal(schema.role_id, contract.role_id);
assert.equal(schema.intent_owner_role_id, contract.intent_owner_role_id);
assert.equal(schema.public_name, contract.public_name);
assert.equal(schema.human_facing, contract.human_facing);
assert.equal(schema.progress_interval_minutes, contract.progress_interval_minutes);

console.log("PASS Controller/Product Owner separation: workflow-only Controller, separate intent owner, 15-minute progress monitor, legacy authority removed from public facade, and forbidden lifecycle operations fail closed");
