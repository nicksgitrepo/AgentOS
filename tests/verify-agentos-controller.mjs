#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileAgentOSControllerState, compileControllerAdapterReadback, compileControllerEvent, compileControllerRuntimeReadback, processControllerEvent, readAgentOSControllerState, validateAgentOSControllerState, writeAgentOSControllerStateCompareAndSwap} from "../control/agentos-controller.mjs";
import {compileGlobalPolicyState} from "../control/global-policy-state.mjs";
import {CONTROLLER_FORBIDDEN_OPERATIONS, assertControllerOperationAuthorized} from "../control/spawner-bootstrap-governance.mjs";

const SHA = "a".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT = "synthetic-project";
const CONTROLLER = "AGENTOS-CONTROLLER-1";
const SPAWNER = "AGENTOS-SPAWNER-1";
const policy = compileGlobalPolicyState({projectId: PROJECT, nowUtc: NOW});
const runtime = compileControllerRuntimeReadback({projectId: PROJECT, controllerRuntimeId: "CONTROLLER-RUNTIME-1", runtimeId: "PROJECT-RUNTIME-1", environmentIdentity: "CONTROLLER-ENV-1", capabilitySetSha256: SHA, observedBySession: "HOST-READBACK-1", observedAtUtc: NOW});
let state = compileAgentOSControllerState({projectId: PROJECT, logicalControllerId: CONTROLLER, currentSessionId: "CONTROLLER-SESSION-1", policyState: policy, controllerRuntimeReadback: runtime, nowUtc: NOW});
validateAgentOSControllerState(state);

function event(type, payload, sequence = state.event_cursor + 1) {
  return compileControllerEvent({eventId: `EVENT-${sequence}`, eventType: type, sourceRole: "AGENTOS_CONTROLLER", controllerId: CONTROLLER, projectId: PROJECT, policyEpoch: state.policy_epoch, policyStateSha256: state.policy_state_sha256, sequence, priorControllerHeadSha256: state.event_ledger_head_sha256, payload, occurredAtUtc: NOW});
}
function readback(context, details) {
  return compileControllerAdapterReadback({operation: context.operation, actionId: context.action_id, eventId: context.event.event_id, controllerId: CONTROLLER, projectId: PROJECT, policyEpoch: state.policy_epoch, policyStateSha256: state.policy_state_sha256, externalIdentity: `READBACK-${context.operation}`, observedAtUtc: NOW, details});
}
const adapters = {
  validateControllerGovernance: (context) => readback(context, {status: "PASS"}),
  validateSpawnerHandoff: (context) => readback(context, {status: "PASS", spawner_id: SPAWNER}),
  startAgentSpawner: (context) => readback(context, {spawner_id: SPAWNER, bootstrap_package_sha256: context.payload.bootstrap_package_sha256, started_count: 1}),
  wakeAgentSpawner: (context) => readback(context, {spawner_id: SPAWNER, status: "WOKEN"}),
  dispatchRedistribution: (context) => readback(context, {status: "DISPATCHED", approval_required: false, destination: "ROLE.LANE.DESTINATION"}),
};

state = processControllerEvent({state, event: event("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}), adapters});
validateAgentOSControllerState(state);
assert.equal(state.action_receipts.filter((receipt) => receipt.operation === "startAgentSpawner").length, 1);
assert.throws(() => processControllerEvent({state, event: event("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}), adapters}), /exactly one/iu);
state = processControllerEvent({state, event: event("SPAWNER_WAKE_REQUESTED", {spawner_id: SPAWNER}), adapters});
state = processControllerEvent({state, event: event("REDISTRIBUTION_RECEIVED", {redistribution_handoff_sha256: SHA}), adapters});
assert.equal(state.action_receipts.at(-1).details.approval_required, false);

for (const operation of CONTROLLER_FORBIDDEN_OPERATIONS) assert.throws(() => assertControllerOperationAuthorized(operation), /forbidden/iu);
assert.throws(() => processControllerEvent({state, event: event("CAMPAIGN_APPROVED", {candidate: {}}), adapters: {spawnCampaignOrchestrator: () => null}}), /forbidden|candidate/iu);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-test-"));
try {
  writeAgentOSControllerStateCompareAndSwap({authorityRoot: tempRoot, state});
  assert.deepEqual(readAgentOSControllerState({authorityRoot: tempRoot}), state);
  assert.throws(() => writeAgentOSControllerStateCompareAndSwap({authorityRoot: tempRoot, expectedStateSha256: "b".repeat(64), state}), /compare-and-swap parent is stale/u);
} finally {
  fs.rmSync(tempRoot, {recursive: true, force: true});
}

console.log("PASS AgentOS Controller: exactly one Spawner start, Spawner wake, redistribution dispatch without approval, forbidden lifecycle paths, and durable CAS");
