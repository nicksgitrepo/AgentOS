#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertOperationalGlobalGovernanceContext,
  compileAllOperationalGlobalGovernanceContexts,
  compileOperationalGlobalGovernanceContext,
} from "../control/global-governance-operational-context.mjs";
import {MODEL_POLICY_ROLE_CLASSES} from "../control/eco-model-policy.mjs";
import {createHybridScheduler} from "../control/hybrid-scheduler.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-operational-global-governance-"));
const schedulerRoot = path.join(root, "scheduler");
const first = materializeTestGlobalGovernanceStore({authorityRoot: root, nowUtc: "2026-08-18T08:30:00.000Z"});
const contexts = compileAllOperationalGlobalGovernanceContexts({authorityStore: first.authorityStore});

assert.deepEqual(Object.keys(contexts), MODEL_POLICY_ROLE_CLASSES);
for (const roleClass of MODEL_POLICY_ROLE_CLASSES) {
  const result = assertOperationalGlobalGovernanceContext(contexts[roleClass], {authorityStore: first.authorityStore, expectedRoleClass: roleClass});
  assert.equal(result.status, "READY_FOR_WORK");
  assert.equal(contexts[roleClass].read_only_projection, true);
  assert.equal(contexts[roleClass].global_memory_write_capability, roleClass === "SPAWNER");
  assert.equal(contexts[roleClass].ledger_head_sha256, first.readback.live_ledger_head_sha256);
  assert.equal(contexts[roleClass].snapshot_sha256, first.snapshot.snapshot_sha256);
}

assert.throws(() => assertOperationalGlobalGovernanceContext(structuredClone(contexts.RUNTIME), {authorityStore: first.authorityStore, expectedRoleClass: "RUNTIME"}), /not constructed from canonical global governance memory/u);
assert.throws(() => createHybridScheduler({authorityRoot: schedulerRoot}), /Operational global-governance context/u);
const scheduler = createHybridScheduler({
  authorityRoot: schedulerRoot,
  globalGovernanceContext: contexts.SCHEDULER,
  globalGovernanceAuthorityStore: first.authorityStore,
});
assert.equal(scheduler.globalGovernanceContext().context_sha256, contexts.SCHEDULER.context_sha256);

// A new accepted head invalidates every non-active context and inert seed path.
const second = materializeTestGlobalGovernanceStore({authorityRoot: root, nowUtc: "2026-08-18T08:40:00.000Z"});
assert.notEqual(second.bootstrap.bootstrap_sha256, first.bootstrap.bootstrap_sha256);
assert.throws(() => assertOperationalGlobalGovernanceContext(contexts.CONTROLLER, {authorityStore: first.authorityStore, expectedRoleClass: "CONTROLLER"}), /stale|aliased/iu);
assert.throws(() => scheduler.globalGovernanceContext() && assertOperationalGlobalGovernanceContext(contexts.SCHEDULER, {authorityStore: first.authorityStore, expectedRoleClass: "SCHEDULER"}), /stale|aliased/iu);
const activeWorker = assertOperationalGlobalGovernanceContext(contexts.WORKING_AGENT, {authorityStore: first.authorityStore, expectedRoleClass: "WORKING_AGENT", activeWorker: true});
assert.equal(activeWorker.status, "BOUND_UNTIL_HANDOFF");
const rebuilt = compileOperationalGlobalGovernanceContext({authorityStore: second.authorityStore, roleClass: "RUNTIME", operationalId: "CONTEXT.RUNTIME.REBUILT"});
assert.equal(assertOperationalGlobalGovernanceContext(rebuilt, {authorityStore: second.authorityStore, expectedRoleClass: "RUNTIME"}).status, "READY_FOR_WORK");

fs.rmSync(root, {recursive: true, force: true});
console.log("PASS operational global governance: all eight role classes receive canonical compact projections, non-writers cannot widen authority, scheduler fails closed, supersession invalidates contexts, and active workers remain exactly bound until handoff");
