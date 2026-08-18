#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bootstrapAndStartAgentOS, createCampaignStatePersistence, createQuestionQueuePersistence, createWorkflowStatePersistence} from "../control/bootstrap-runtime.mjs";
import {createIntentRegulatorRuntime} from "../control/intent-regulator-runtime.mjs";
import {runContinuousOperatingLoop, runContinuousOperatingLoopIteration} from "../control/continuous-operating-loop.mjs";
import {runControllerSupervisor, runControllerSupervisorIteration} from "../control/controller-supervisor-runtime.mjs";
import {runCanonicalCampaign, inspectCanonicalCampaignRuntime} from "../control/canonical-campaign-orchestration-adapter.mjs";
import {openPersistentIntentRuntime, inspectPersistentIntentRuntime} from "../control/persistent-intent-runtime.mjs";
import {startLocalSelfDevelopment} from "../control/start-local-self-development.mjs";
import {createControllerSupervisorAdapter} from "../control/local-self-development-supervisor-adapter.mjs";
import {openRuntimeStorage, resumeRuntimeStorage, renewRuntimeStorage, releaseRuntimeStorage, commitRuntimeTransaction, inspectRuntimeStorage, readRuntimeState, readRuntimeEvents} from "../control/persistent-intent-runtime-storage.mjs";
import {compilePersistentRuntimeObservation, compilePersistentRuntimeRoute} from "../control/persistent-intent-runtime-integration.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindings = JSON.parse(fs.readFileSync(path.join(root, "schemas/bootstrap-binding.v1.json")));
const normativePaths = new Set(Object.values(bindings.normative).map((entry) => entry.path));
const compatibilityPaths = new Set(Object.values(bindings.compatibility_only).map((entry) => entry.path));
for (const historicalVerifier of [
  "tests/verify-continuous-operating-loop.mjs",
  "tests/verify-controller-supervisor.mjs",
  "tests/verify-controller-supervisor-liveness.mjs",
  "tests/verify-persistent-intent-runtime.mjs",
  "tests/verify-persistent-intent-runtime-hostile.mjs",
  "tests/verify-persistent-intent-runtime-recovery.mjs",
]) {
  assert(compatibilityPaths.has(historicalVerifier), `${historicalVerifier} lacks an explicit compatibility-only retirement classification`);
  assert(!normativePaths.has(historicalVerifier), `${historicalVerifier} can still authorize current behavior`);
}
for (const currentVerifier of [
  "tests/verify-retired-operational-authority.mjs",
  "tests/verify-controller-product-owner-separation.mjs",
  "tests/verify-product-owner-boundary-operational.mjs",
  "tests/verify-project-owner-governance.mjs",
]) assert(normativePaths.has(currentVerifier), `${currentVerifier} is missing from the current normative proof inventory`);

const retired = (error) => ["LEGACY_BOOTSTRAP_RUNTIME_RETIRED", "RETIRED_ROLE_AUTHORITY_FORBIDDEN", "LEGACY_CONTROLLER_SUPERVISOR_RETIRED", "READ_ONLY_MIGRATION_REQUIRED"].includes(error.code);
assert.throws(() => createCampaignStatePersistence({authorityRoot: "/tmp/forged"}), retired);
assert.throws(() => createWorkflowStatePersistence({authorityRoot: "/tmp/forged"}), retired);
assert.throws(() => createQuestionQueuePersistence({authorityRoot: "/tmp/forged"}), retired);
await assert.rejects(() => bootstrapAndStartAgentOS({authorityRoot: "/tmp/forged"}), retired);
assert.throws(() => createIntentRegulatorRuntime({authorityRoot: "/tmp/forged"}), retired);
assert.throws(() => openPersistentIntentRuntime({authorityRoot: "/tmp/forged"}), retired);
assert.throws(() => inspectPersistentIntentRuntime({authorityRoot: "/tmp/forged"}), retired);
assert.throws(() => inspectCanonicalCampaignRuntime({authorityRoot: "/tmp/forged"}), retired);
await assert.rejects(() => runCanonicalCampaign({authorityRoot: "/tmp/forged", persistCampaignState() { throw new Error("must not persist"); }}), retired);
await assert.rejects(() => startLocalSelfDevelopment([], {nativeHost: {}}), retired);
await assert.rejects(() => createControllerSupervisorAdapter({runtimeRoot: "/tmp/forged", repoRoot: "/tmp/forged"}), retired);
assert.throws(() => openRuntimeStorage({authorityRoot: "/tmp/forged"}), retired);
assert.throws(() => resumeRuntimeStorage({root: "/tmp/forged"}), retired);
assert.throws(() => renewRuntimeStorage({root: "/tmp/forged"}), retired);
assert.throws(() => releaseRuntimeStorage({root: "/tmp/forged"}), retired);
assert.throws(() => commitRuntimeTransaction({root: "/tmp/forged"}), retired);
assert.throws(() => inspectRuntimeStorage({authorityRoot: "/tmp/forged"}), retired);
assert.throws(() => readRuntimeState("/tmp/forged"), retired);
assert.throws(() => readRuntimeEvents("/tmp/forged", {}), retired);
assert.throws(() => compilePersistentRuntimeObservation({}), retired);
assert.throws(() => compilePersistentRuntimeRoute({}), retired);
assert.throws(() => runContinuousOperatingLoopIteration({}), retired);
await assert.rejects(() => runContinuousOperatingLoop({observe() { throw new Error("must not observe"); }}), retired);

const calls = {observe: 0, route: 0, reconcile: 0};
const adapter = {
  async observe() { calls.observe += 1; return {}; },
  async route() { calls.route += 1; return {}; },
  async reconcile() { calls.reconcile += 1; return {}; },
};
await assert.rejects(() => runControllerSupervisorIteration({runtimeRoot: "/tmp/forged", adapter}), retired);
await assert.rejects(() => runControllerSupervisor({runtimeRoot: "/tmp/forged", adapter, once: true}), retired);
assert.deepEqual(calls, {observe: 0, route: 0, reconcile: 0}, "retired Controller supervisor invoked an adapter before rejection");

console.log("PASS retired operational authority: old Bootstrap, Intent Regulator, continuous-loop, and arbitrary Controller adapter paths fail before side effects");
