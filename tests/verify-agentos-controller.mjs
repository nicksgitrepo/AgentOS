#!/usr/bin/env node

/* Focused hostile checks for the production Controller boundary. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyAndWriteAgentOSControllerEvent,
  applyAndWriteAgentOSControllerEventAsync,
  compileAgentOSControllerState,
  compileControllerRuntimeReadback,
  CONTROLLER_EVENT_TYPES,
  readAgentOSControllerState,
  validateAgentOSControllerState,
  writeAgentOSControllerStateCompareAndSwap,
} from "../control/agentos-controller.mjs";
import {compileGlobalPolicyState} from "../control/global-policy-state.mjs";
import {CONTROLLER_FORBIDDEN_OPERATIONS, assertControllerOperationAuthorized} from "../control/spawner-bootstrap-governance.mjs";
import {compileOperationalGlobalGovernanceContext} from "../control/global-governance-operational-context.mjs";
import {loadCanonicalControllerOperationRegistry} from "../control/controller-event-authority.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";
import {openControllerProjectStore, prepareEphemeralControllerProjectStoreForTest, disposeEphemeralControllerProjectStoreForTest} from "./helpers/controller-project-store-fixture.mjs";

const SHA = "a".repeat(64);
const PROJECT = "synthetic-project";
const NOW = "2026-01-01T00:00:00.000Z";
const schema = JSON.parse(fs.readFileSync(new URL("../schemas/agentos-controller.v1.json", import.meta.url), "utf8"));
assert.deepEqual([...CONTROLLER_EVENT_TYPES], schema.event_types, "Controller runtime/schema event sets differ");
assert.deepEqual(loadCanonicalControllerOperationRegistry().operations.map((entry) => entry.event_type), [...CONTROLLER_EVENT_TYPES]);

const policy = compileGlobalPolicyState({projectId: PROJECT, nowUtc: NOW});
const runtime = compileControllerRuntimeReadback({projectId: PROJECT, controllerRuntimeId: "CONTROLLER-RUNTIME-1", runtimeId: "PROJECT-RUNTIME-1", environmentIdentity: "CONTROLLER-ENV-1", capabilitySetSha256: SHA, observedBySession: "HOST-READBACK-1", observedAtUtc: NOW});
const state = compileAgentOSControllerState({projectId: PROJECT, logicalControllerId: "AGENTOS-CONTROLLER-1", currentSessionId: "CONTROLLER-SESSION-1", policyState: policy, controllerRuntimeReadback: runtime, nowUtc: NOW});
validateAgentOSControllerState(state);

const forgedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-forged-root-"));
const fixtureProvision = prepareEphemeralControllerProjectStoreForTest();
const fixtureCapability = openControllerProjectStore({projectControlStoreCapability: fixtureProvision});
try {
  assert.throws(() => readAgentOSControllerState({authorityRoot: forgedRoot, statePath: "other.json"}), /rejects caller roots|paths|environment/u);
  assert.throws(() => writeAgentOSControllerStateCompareAndSwap({projectControlStoreCapability: fixtureCapability, state, statePath: "other.json"}), /rejects caller roots|paths|environment/u);
  assert.throws(() => readAgentOSControllerState({projectControlStoreCapability: fixtureCapability}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u, "test fixture must not provision production Controller storage");
  assert.throws(() => readAgentOSControllerState({projectControlStoreCapability: structuredClone(fixtureCapability)}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u);
  assert.throws(() => writeAgentOSControllerStateCompareAndSwap({projectControlStoreCapability: fixtureCapability, state}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u);

  let adapterCalls = 0;
  const adapters = new Proxy({}, {get: () => async () => { adapterCalls += 1; throw new Error("adapter must not run"); }});
  assert.rejects(
    () => applyAndWriteAgentOSControllerEventAsync({projectControlStoreCapability: fixtureCapability, event: {}, adapters}),
    /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u,
  );
  assert.equal(adapterCalls, 0, "unprovisioned Controller must fail before adapters");
  assert.throws(() => applyAndWriteAgentOSControllerEvent({projectControlStoreCapability: fixtureCapability, event: {}, adapters}), /trusted Bootstrap provisioning|PROVISIONING_REQUIRED/u);
  assert.equal(adapterCalls, 0, "unprovisioned synchronous Controller must fail before adapters");
} finally {
  disposeEphemeralControllerProjectStoreForTest(fixtureProvision);
  fs.rmSync(forgedRoot, {recursive: true, force: true});
}

for (const operation of CONTROLLER_FORBIDDEN_OPERATIONS) assert.throws(() => assertControllerOperationAuthorized(operation), /forbidden/iu);
console.log("PASS AgentOS Controller hostile boundary: caller roots rejected, fixture capabilities do not activate production, and unprovisioned Controller fails before adapters");
