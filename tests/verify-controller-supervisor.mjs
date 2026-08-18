#!/usr/bin/env node

import assert from "node:assert/strict";
import {runControllerSupervisor, runControllerSupervisorIteration} from "../control/controller-supervisor-runtime.mjs";

const calls = {observe: 0, route: 0, reconcile: 0};
const adapter = {
  async observe() { calls.observe += 1; return {}; },
  async route() { calls.route += 1; return {}; },
  async reconcile() { calls.reconcile += 1; return {}; },
};
const retired = (error) => error.code === "LEGACY_CONTROLLER_SUPERVISOR_RETIRED";
await assert.rejects(() => runControllerSupervisorIteration({runtimeRoot: "/tmp/caller-root", adapter}), retired);
await assert.rejects(() => runControllerSupervisor({runtimeRoot: "/tmp/caller-root", adapter, once: true}), retired);
assert.deepEqual(calls, {observe: 0, route: 0, reconcile: 0}, "legacy Controller supervisor invoked an arbitrary adapter");

console.log("PASS Controller supervisor retirement: arbitrary observe, route, and reconcile adapters are rejected before side effects");
