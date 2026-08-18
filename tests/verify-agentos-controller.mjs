#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {applyAndWriteAgentOSControllerEvent, applyAndWriteAgentOSControllerEventAsync, compileAgentOSControllerState, compileControllerAdapterReadback, compileControllerEvent, compileControllerRuntimeReadback, CONTROLLER_EVENT_TYPES, readAgentOSControllerState, validateAgentOSControllerState, writeAgentOSControllerStateCompareAndSwap} from "../control/agentos-controller.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileGlobalPolicyState} from "../control/global-policy-state.mjs";
import {CONTROLLER_FORBIDDEN_OPERATIONS, assertControllerOperationAuthorized} from "../control/spawner-bootstrap-governance.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";
import {compileControllerEventNonce, controllerSignedEventDigest, loadCanonicalControllerIssuerRegistry, loadCanonicalControllerOperationRegistry, readUsedControllerEvents} from "../control/controller-event-authority.mjs";
import {compileOperationalGlobalGovernanceContext} from "../control/global-governance-operational-context.mjs";

const SHA = "a".repeat(64);
const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT = "synthetic-project";
const CONTROLLER = "AGENTOS-CONTROLLER-1";
const SPAWNER = "AGENTOS-SPAWNER-1";
const signedFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/controller-events/canonical-signed-sequence.v1.json", import.meta.url), "utf8"));
const originalDateNow = Date.now;
Date.now = () => Date.parse(signedFixture.trusted_now_utc);
const governanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-global-governance-"));
const globalFixture = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot, nowUtc: signedFixture.trusted_now_utc});
const controllerGovernanceContext = compileOperationalGlobalGovernanceContext({authorityStore: globalFixture.authorityStore, roleClass: "CONTROLLER", operationalId: "CONTEXT.CONTROLLER.EVENT.TEST"});
const governanceOptions = {globalGovernanceContext: controllerGovernanceContext, globalGovernanceAuthorityStore: globalFixture.authorityStore};
const controllerProjectionSha256 = controllerGovernanceContext.projection_sha256;
const policy = compileGlobalPolicyState({projectId: PROJECT, nowUtc: NOW});
const runtime = compileControllerRuntimeReadback({projectId: PROJECT, controllerRuntimeId: "CONTROLLER-RUNTIME-1", runtimeId: "PROJECT-RUNTIME-1", environmentIdentity: "CONTROLLER-ENV-1", capabilitySetSha256: SHA, observedBySession: "HOST-READBACK-1", observedAtUtc: NOW});
let state = compileAgentOSControllerState({projectId: PROJECT, logicalControllerId: CONTROLLER, currentSessionId: "CONTROLLER-SESSION-1", policyState: policy, controllerRuntimeReadback: runtime, nowUtc: NOW});
validateAgentOSControllerState(state);

function event(type, payload, sequence = state.event_cursor + 1) {
  const value = signedFixture.events.find((entry) => entry.event_type === type && entry.sequence === sequence);
  assert(value, `signed Controller event fixture is missing: ${type}/${sequence}`);
  assert.deepEqual(value.payload, {...payload, global_model_policy_projection_sha256: controllerProjectionSha256});
  return structuredClone(value);
}
function readback(context, details) {
  return compileControllerAdapterReadback({operation: context.operation, actionId: context.action_id, eventId: context.event.event_id, controllerId: CONTROLLER, projectId: PROJECT, policyEpoch: state.policy_epoch, policyStateSha256: state.policy_state_sha256, externalIdentity: `READBACK-${context.operation}`, observedAtUtc: NOW, details});
}
const adapters = {
  validateControllerGovernance: (context) => readback(context, {status: "PASS"}),
  validateSpawnerHandoff: (context) => readback(context, {status: "PASS", spawner_id: SPAWNER}),
  startAgentSpawner: (context) => readback(context, {spawner_id: SPAWNER, bootstrap_package_sha256: context.payload.bootstrap_package_sha256, started_count: 1}),
  wakeAgentSpawner: (context) => readback(context, {spawner_id: SPAWNER, status: "WOKEN"}),
  observeAgentSpawner: (context) => readback(context, {spawner_id: SPAWNER, status: "HEALTHY"}),
  reconcileLiveness: (context) => readback(context, {spawner_id: SPAWNER, status: "RECONCILED", ordinary_role_mutation: false}),
  dispatchRedistribution: (context) => readback(context, {status: "DISPATCHED", approval_required: false, destination: "ROLE.LANE.DESTINATION"}),
};
const controllerSchema = JSON.parse(fs.readFileSync(new URL("../schemas/agentos-controller.v1.json", import.meta.url), "utf8"));
assert.deepEqual([...CONTROLLER_EVENT_TYPES], controllerSchema.event_types, "Controller runtime/schema event sets differ");
assert.deepEqual(loadCanonicalControllerOperationRegistry().operations.map((entry) => entry.event_type), [...CONTROLLER_EVENT_TYPES]);

const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-signed-main-"));
writeAgentOSControllerStateCompareAndSwap({authorityRoot: mainRoot, state});
state = applyAndWriteAgentOSControllerEvent({authorityRoot: mainRoot, event: event("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}), adapters, ...governanceOptions}).state;
validateAgentOSControllerState(state);
assert.equal(state.action_receipts.filter((receipt) => receipt.operation === "startAgentSpawner").length, 1);
assert.throws(() => applyAndWriteAgentOSControllerEvent({authorityRoot: mainRoot, event: signedFixture.events[0], adapters, ...governanceOptions}), /consumed|sequence|prior head/iu);
state = applyAndWriteAgentOSControllerEvent({authorityRoot: mainRoot, event: event("SPAWNER_WAKE_REQUESTED", {spawner_id: SPAWNER}), adapters, ...governanceOptions}).state;
state = applyAndWriteAgentOSControllerEvent({authorityRoot: mainRoot, event: event("REDISTRIBUTION_RECEIVED", {redistribution_handoff_sha256: SHA}), adapters, ...governanceOptions}).state;
assert.equal(state.action_receipts.at(-1).details.approval_required, false);
state = applyAndWriteAgentOSControllerEvent({authorityRoot: mainRoot, event: event("SPAWNER_OBSERVE_REQUESTED", {spawner_id: SPAWNER}), adapters, ...governanceOptions}).state;
state = applyAndWriteAgentOSControllerEvent({authorityRoot: mainRoot, event: event("SPAWNER_LIVENESS_RECONCILE_REQUESTED", {spawner_id: SPAWNER}), adapters, ...governanceOptions}).state;
assert.equal(readUsedControllerEvents({stateRoot: mainRoot}).length, 5);

for (const operation of CONTROLLER_FORBIDDEN_OPERATIONS) assert.throws(() => assertControllerOperationAuthorized(operation), /forbidden/iu);
assert.throws(() => compileControllerEvent({eventType: "SPAWNER_START_REQUESTED"}), /external.*signature|role claims/iu);

const forbiddenOperations = [
  "admitLocalSelfDevelopment", "spawnCampaignOrchestrator", "spawnFeatureAgents", "spawnIndependentAuditor",
  "archiveCampaignAgents", "runBootstrap", "bindPersistentRuntime", "recoverStalledSession",
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
  const invocationCounts = Object.fromEntries([...forbiddenOperations, "validateControllerGovernance", "validateSpawnerHandoff", "startAgentSpawner", "wakeAgentSpawner", "observeAgentSpawner", "reconcileLiveness", "dispatchRedistribution"].map((name) => [name, 0]));
  const hostileAdapters = Object.fromEntries(Object.keys(invocationCounts).map((operation) => [operation, async (context) => {
    invocationCounts[operation] += 1;
    const details = operation === "validateControllerGovernance" ? {status: "PASS"}
      : operation === "validateSpawnerHandoff" ? {status: "PASS", spawner_id: SPAWNER}
        : operation === "startAgentSpawner" ? {spawner_id: SPAWNER, bootstrap_package_sha256: SHA, started_count: 1}
          : operation === "wakeAgentSpawner" ? {spawner_id: SPAWNER, status: "WOKEN"}
            : operation === "observeAgentSpawner" ? {spawner_id: SPAWNER, status: "HEALTHY"}
              : operation === "reconcileLiveness" ? {spawner_id: SPAWNER, status: "RECONCILED", ordinary_role_mutation: false}
            : operation === "dispatchRedistribution" ? {status: "DISPATCHED", approval_required: false, destination: "ROLE.LANE.DESTINATION"}
              : {status: "FORBIDDEN"};
    return compileControllerAdapterReadback({operation, actionId: context.action_id, eventId: context.event.event_id, controllerId: CONTROLLER, projectId: PROJECT, policyEpoch: asyncInitial.policy_epoch, policyStateSha256: asyncInitial.policy_state_sha256, externalIdentity: `ASYNC-${operation}`, observedAtUtc: NOW, details});
  }]));
  const makeAsyncEvent = (type, payload, overrides = {}) => {
    const value = structuredClone(signedFixture.events[0]);
    Object.assign(value, {event_type: type, payload: {...payload, global_model_policy_projection_sha256: controllerProjectionSha256}}, overrides);
    value.nonce = compileControllerEventNonce(value);
    value.event_sha256 = controllerSignedEventDigest(value);
    return value;
  };
  for (const forbiddenType of forbiddenEvents) {
    await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent(forbiddenType, {}), adapters: hostileAdapters, ...governanceOptions}), /event type is invalid|CONTROLLER_EVENT_FORBIDDEN/iu);
  }
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: "bad id", bootstrap_package_sha256: "short"}), adapters: hostileAdapters, ...governanceOptions}), /signature|identity|SHA-256|stable identifier/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {policy_epoch: 2}), adapters: hostileAdapters, ...governanceOptions}), /signature|policy is stale/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: structuredClone(signedFixture.events[0]), adapters: hostileAdapters}), /global governance|readback|object/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}), adapters: hostileAdapters, ...governanceOptions, globalGovernanceContext: structuredClone(controllerGovernanceContext)}), /not constructed from canonical global governance memory/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {source_role: "AGENT.BUILDER"}), adapters: hostileAdapters, ...governanceOptions}), /issuer.*not authorized/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {occurred_at_utc: new Date(Date.now() - 3_600_000).toISOString()}), adapters: hostileAdapters, ...governanceOptions}), /stale/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {occurred_at_utc: new Date(Date.now() + 3_600_000).toISOString()}), adapters: hostileAdapters, ...governanceOptions}), /future/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {authority_epoch: 1}), adapters: hostileAdapters, ...governanceOptions}), /authority epoch is superseded/iu);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA, authority_registry: {registry_sha256: "f".repeat(64)}}), adapters: hostileAdapters, ...governanceOptions}), /override canonical authority/iu);
  const attackerKeys = crypto.generateKeyPairSync("ed25519");
  const attackerSigned = makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA});
  attackerSigned.signature_base64 = crypto.sign(null, Buffer.from(attackerSigned.event_sha256, "hex"), attackerKeys.privateKey).toString("base64");
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: attackerSigned, adapters: hostileAdapters, ...governanceOptions}), /signature is invalid/iu);
  const roleOnly = makeAsyncEvent("SPAWNER_START_REQUESTED", {spawner_id: SPAWNER, bootstrap_package_sha256: SHA}, {issuer_id: "ISSUER.ATTACKER.FRESH.KEY", source_role: "AGENT.CONTROLLER"});
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: roleOnly, adapters: hostileAdapters, ...governanceOptions}), /signed issuer identity is not authorized/iu);
  assert(Object.values(invocationCounts).every((count) => count === 0), "invalid asynchronous routes invoked an adapter before preflight");

  const validStart = structuredClone(signedFixture.events[0]);
  await applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: validStart, adapters: hostileAdapters, ...governanceOptions});
  assert.deepEqual([invocationCounts.validateControllerGovernance, invocationCounts.validateSpawnerHandoff, invocationCounts.startAgentSpawner], [1, 1, 1]);
  await assert.rejects(() => applyAndWriteAgentOSControllerEventAsync({authorityRoot: asyncRoot, event: validStart, adapters: hostileAdapters, ...governanceOptions}), /sequence|prior head|exactly one/iu);
  assert.deepEqual([invocationCounts.validateControllerGovernance, invocationCounts.validateSpawnerHandoff, invocationCounts.startAgentSpawner], [1, 1, 1], "replay invoked asynchronous adapters");
  assert(forbiddenOperations.every((operation) => invocationCounts[operation] === 0), "Controller invoked a forbidden ordinary-agent adapter");

  const concurrentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-concurrent-event-"));
  try {
    writeAgentOSControllerStateCompareAndSwap({authorityRoot: concurrentRoot, state: asyncInitial});
    const before = Object.fromEntries(Object.entries(invocationCounts));
    const outcomes = await Promise.allSettled([
      applyAndWriteAgentOSControllerEventAsync({authorityRoot: concurrentRoot, event: structuredClone(validStart), adapters: hostileAdapters, ...governanceOptions}),
      applyAndWriteAgentOSControllerEventAsync({authorityRoot: concurrentRoot, event: structuredClone(validStart), adapters: hostileAdapters, ...governanceOptions}),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1, "exactly one concurrent signed event must be consumed");
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1, "the competing signed event must fail closed");
    assert.match(String(outcomes.find((outcome) => outcome.status === "rejected").reason), /consumed|locked|replay/iu);
    assert.deepEqual(
      [invocationCounts.validateControllerGovernance - before.validateControllerGovernance, invocationCounts.validateSpawnerHandoff - before.validateSpawnerHandoff, invocationCounts.startAgentSpawner - before.startAgentSpawner],
      [1, 1, 1],
      "concurrent replay invoked an adapter more than once",
    );
    assert.equal(readUsedControllerEvents({stateRoot: concurrentRoot}).length, 1, "concurrent event ledger recorded more than one consumption");
  } finally {
    fs.rmSync(concurrentRoot, {recursive: true, force: true});
  }
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
fs.rmSync(mainRoot, {recursive: true, force: true});
Date.now = originalDateNow;
