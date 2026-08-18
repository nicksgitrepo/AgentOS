#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {applyAndWriteAgentOSControllerEventAsync, compileAgentOSControllerState, compileControllerAdapterReadback, compileControllerEvent, compileControllerRuntimeReadback, CONTROLLER_EVENT_TYPES, processControllerEvent, readAgentOSControllerState, validateAgentOSControllerState, writeAgentOSControllerStateCompareAndSwap} from "../control/agentos-controller.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileGlobalPolicyState} from "../control/global-policy-state.mjs";
import {CONTROLLER_FORBIDDEN_OPERATIONS, assertControllerOperationAuthorized} from "../control/spawner-bootstrap-governance.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";
import {compileControllerEventNonce, loadCanonicalControllerIssuerRegistry} from "../control/controller-event-authority.mjs";
import {compileOperationalGlobalGovernanceContext} from "../control/global-governance-operational-context.mjs";

const SHA = "a".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT = "synthetic-project";
const CONTROLLER = "AGENTOS-CONTROLLER-1";
const SPAWNER = "AGENTOS-SPAWNER-1";
const governanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-global-governance-"));
const globalFixture = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot});
const controllerGovernanceContext = compileOperationalGlobalGovernanceContext({authorityRoot: governanceRoot, bootstrapSha256: globalFixture.bootstrap.bootstrap_sha256, roleClass: "CONTROLLER", operationalId: "CONTEXT.CONTROLLER.EVENT.TEST"});
const governanceOptions = {globalGovernanceContext: controllerGovernanceContext, globalGovernanceAuthorityRoot: governanceRoot, globalGovernanceBootstrapSha256: globalFixture.bootstrap.bootstrap_sha256};
const controllerProjectionSha256 = controllerGovernanceContext.projection_sha256;
const policy = compileGlobalPolicyState({projectId: PROJECT, nowUtc: NOW});
const runtime = compileControllerRuntimeReadback({projectId: PROJECT, controllerRuntimeId: "CONTROLLER-RUNTIME-1", runtimeId: "PROJECT-RUNTIME-1", environmentIdentity: "CONTROLLER-ENV-1", capabilitySetSha256: SHA, observedBySession: "HOST-READBACK-1", observedAtUtc: NOW});
let state = compileAgentOSControllerState({projectId: PROJECT, logicalControllerId: CONTROLLER, currentSessionId: "CONTROLLER-SESSION-1", policyState: policy, controllerRuntimeReadback: runtime, nowUtc: NOW});
validateAgentOSControllerState(state);

function event(type, payload, sequence = state.event_cursor + 1) {
  return compileControllerEvent({eventId: `EVENT-${sequence}`, eventType: type, controllerId: CONTROLLER, projectId: PROJECT, policyEpoch: state.policy_epoch, policyStateSha256: state.policy_state_sha256, sequence, priorControllerHeadSha256: state.event_ledger_head_sha256, payload: {...payload, global_model_policy_projection_sha256: controllerProjectionSha256}});
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
const controllerSchema = JSON.parse(fs.readFileSync(new URL("../schemas/agentos-controller.v1.json", import.meta.url), "utf8"));
assert.deepEqual([...CONTROLLER_EVENT_TYPES], controllerSchema.event_types, "Controller runtime/schema event sets differ");

state = processControllerEvent({state, event: event("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}), adapters, ...governanceOptions});
validateAgentOSControllerState(state);
assert.equal(state.action_receipts.filter((receipt) => receipt.operation === "startAgentSpawner").length, 1);
assert.throws(() => processControllerEvent({state, event: event("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}), adapters, ...governanceOptions}), /exactly one/iu);
state = processControllerEvent({state, event: event("SPAWNER_WAKE_REQUESTED", {spawner_id: SPAWNER}), adapters, ...governanceOptions});
state = processControllerEvent({state, event: event("REDISTRIBUTION_RECEIVED", {redistribution_handoff_sha256: SHA}), adapters, ...governanceOptions});
assert.equal(state.action_receipts.at(-1).details.approval_required, false);

for (const operation of CONTROLLER_FORBIDDEN_OPERATIONS) assert.throws(() => assertControllerOperationAuthorized(operation), /forbidden/iu);
assert.throws(() => event("CAMPAIGN_APPROVED", {candidate: {}}), /event type is invalid/iu);

const forbiddenOperations = [
  "admitLocalSelfDevelopment", "spawnCampaignOrchestrator", "spawnFeatureAgents", "spawnIndependentAuditor",
  "archiveCampaignAgents", "reconcileLiveness", "runBootstrap", "bindPersistentRuntime", "recoverStalledSession",
];
const forbiddenEvents = [
  "LOCAL_SELF_DEVELOPMENT_AUTHORIZED", "CAMPAIGN_APPROVED", "BOOTSTRAP_REQUESTED", "BOOTSTRAP_PROMOTED",
  "USER_REVIEW_RETURNED", "AGENT_STALLED", "POLICY_AMENDMENT", "CHECKPOINT_READY", "AUDITOR_RELEASE_CLEARED",
  "RUNTIME_DEPLOYED", "ACCEPTED_LIVE", "TRUE_OWNER_BOUNDARY", "RECONCILIATION_TICK",
];
const asyncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-async-hostile-"));
try {
  const asyncInitial = compileAgentOSControllerState({projectId: PROJECT, logicalControllerId: CONTROLLER, currentSessionId: "CONTROLLER-ASYNC-SESSION-1", policyState: policy, controllerRuntimeReadback: runtime, nowUtc: NOW});
  writeAgentOSControllerStateCompareAndSwap({authorityRoot: asyncRoot, state: asyncInitial});
  const invocationCounts = Object.fromEntries([...forbiddenOperations, "validateControllerGovernance", "validateSpawnerHandoff", "startAgentSpawner", "wakeAgentSpawner", "dispatchRedistribution"].map((name) => [name, 0]));
  const hostileAdapters = Object.fromEntries(Object.keys(invocationCounts).map((operation) => [operation, async (context) => {
    invocationCounts[operation] += 1;
    const details = operation === "validateControllerGovernance" ? {status: "PASS"}
      : operation === "validateSpawnerHandoff" ? {status: "PASS", spawner_id: SPAWNER}
        : operation === "startAgentSpawner" ? {spawner_id: SPAWNER, bootstrap_package_sha256: SHA, started_count: 1}
          : operation === "wakeAgentSpawner" ? {spawner_id: SPAWNER, status: "WOKEN"}
            : operation === "dispatchRedistribution" ? {status: "DISPATCHED", approval_required: false, destination: "ROLE.LANE.DESTINATION"}
              : {status: "FORBIDDEN"};
    return compileControllerAdapterReadback({operation, actionId: context.action_id, eventId: context.event.event_id, controllerId: CONTROLLER, projectId: PROJECT, policyEpoch: asyncInitial.policy_epoch, policyStateSha256: asyncInitial.policy_state_sha256, externalIdentity: `ASYNC-${operation}`, observedAtUtc: NOW, details});
  }]));
  const makeAsyncEvent = (type, payload, overrides = {}) => {
    const registry = loadCanonicalControllerIssuerRegistry();
    const value = {
      schema: "agentos.controller_event.v1", version: 1, event_id: `ASYNC-${type}`,
      event_type: type, source_role: type === "REDISTRIBUTION_RECEIVED" ? "AGENT_SPAWNER" : "AGENTOS_CONTROLLER", authority_epoch: registry.authority_epoch, nonce: null, controller_id: CONTROLLER, project_id: PROJECT,
      policy_epoch: asyncInitial.policy_epoch, policy_state_sha256: asyncInitial.policy_state_sha256, campaign_id: null,
      sequence: 1, prior_controller_head_sha256: null, payload: {...payload, global_model_policy_projection_sha256: controllerProjectionSha256}, occurred_at_utc: new Date().toISOString(), event_sha256: null, ...overrides,
    };
    value.nonce = compileControllerEventNonce(value);
    value.event_sha256 = canonicalDigest({...value, event_sha256: null});
    return value;
  };
  for (const forbiddenType of forbiddenEvents) {
    await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent(forbiddenType, {}), adapters: hostileAdapters, ...governanceOptions}), /event type is invalid|CONTROLLER_EVENT_FORBIDDEN/iu);
  }
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: "bad id", bootstrap_package_sha256: "short"}), adapters: hostileAdapters, ...governanceOptions}), /identity|SHA-256|stable identifier/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {policy_epoch: 2}), adapters: hostileAdapters, ...governanceOptions}), /policy is stale/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}), adapters: hostileAdapters}), /global governance|readback|object/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}), adapters: hostileAdapters, ...governanceOptions, globalGovernanceContext: structuredClone(controllerGovernanceContext)}), /not constructed from canonical global governance memory/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {source_role: "AGENT.BUILDER"}), adapters: hostileAdapters, ...governanceOptions}), /issuer is not authorized/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {occurred_at_utc: new Date(Date.now() - 3_600_000).toISOString()}), adapters: hostileAdapters, ...governanceOptions}), /stale/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {occurred_at_utc: new Date(Date.now() + 3_600_000).toISOString()}), adapters: hostileAdapters, ...governanceOptions}), /future/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {authority_epoch: 2}), adapters: hostileAdapters, ...governanceOptions}), /authority epoch is superseded/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA, authority_registry: {registry_sha256: "f".repeat(64)}}), adapters: hostileAdapters, ...governanceOptions}), /override canonical authority/iu);
  assert(Object.values(invocationCounts).every((count) => count === 0), "invalid asynchronous routes invoked an adapter before preflight");

  const validStart = makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA});
  await applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: validStart, adapters: hostileAdapters, ...governanceOptions});
  assert.deepEqual([invocationCounts.validateControllerGovernance, invocationCounts.validateSpawnerHandoff, invocationCounts.startAgentSpawner], [1, 1, 1]);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: validStart, adapters: hostileAdapters, ...governanceOptions}), /sequence|prior head|exactly one/iu);
  assert.deepEqual([invocationCounts.validateControllerGovernance, invocationCounts.validateSpawnerHandoff, invocationCounts.startAgentSpawner], [1, 1, 1], "replay invoked asynchronous adapters");
  assert(forbiddenOperations.every((operation) => invocationCounts[operation] === 0), "Controller invoked a forbidden ordinary-agent adapter");
} finally {
  fs.rmSync(asyncRoot, {recursive: true, force: true});
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-test-"));
try {
  writeAgentOSControllerStateCompareAndSwap({authorityRoot: tempRoot, state});
  assert.deepEqual(readAgentOSControllerState({authorityRoot: tempRoot}), state);
  assert.throws(() => writeAgentOSControllerStateCompareAndSwap({authorityRoot: tempRoot, expectedStateSha256: "b".repeat(64), state}), /compare-and-swap parent is stale/u);
} finally {
  fs.rmSync(tempRoot, {recursive: true, force: true});
}

console.log("PASS AgentOS Controller: exactly one Spawner start, Spawner wake, redistribution dispatch without approval, forbidden lifecycle paths, and durable CAS");
fs.rmSync(governanceRoot, {recursive: true, force: true});
