#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  assertOperationalGlobalGovernanceContext,
  compileAllOperationalGlobalGovernanceContexts,
  compileOperationalGlobalGovernanceContext,
} from "../control/global-governance-operational-context.mjs";
import {MODEL_POLICY_ROLE_CLASSES} from "../control/eco-model-policy.mjs";
import {createHybridScheduler} from "../control/hybrid-scheduler.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootSegments = repositoryRoot.split(path.sep);
const worktreesIndex = rootSegments.lastIndexOf("Worktrees");
assert(worktreesIndex > 0, "test repository is not in the governed AgentOS Worktrees layout");
const tempParent = path.join(path.sep, ...rootSegments.slice(1, worktreesIndex), "Temp");
const tempParentExisted = fs.existsSync(tempParent);
fs.mkdirSync(tempParent, {recursive: true});
const root = fs.mkdtempSync(path.join(tempParent, "operational-global-governance-"));
const schedulerRoot = path.join(root, "scheduler");
const nowUtc = new Date().toISOString();
const firstObservedAtUtc = new Date(Date.parse(nowUtc) - 60_000).toISOString();
const first = materializeTestGlobalGovernanceStore({authorityRoot: root, nowUtc: firstObservedAtUtc});
const contexts = compileAllOperationalGlobalGovernanceContexts({authorityStore: first.authorityStore});

assert.deepEqual(Object.keys(contexts), MODEL_POLICY_ROLE_CLASSES);
for (const roleClass of MODEL_POLICY_ROLE_CLASSES) {
  const result = assertOperationalGlobalGovernanceContext(contexts[roleClass], {authorityStore: first.authorityStore, expectedRoleClass: roleClass});
  assert.equal(result.status, "READY_FOR_WORK");
  assert.equal(contexts[roleClass].read_only_projection, true);
  assert.equal(contexts[roleClass].global_memory_write_capability, roleClass === "MEMORY");
  assert.equal(contexts[roleClass].ledger_head_sha256, first.readback.live_ledger_head_sha256);
  assert.equal(contexts[roleClass].snapshot_sha256, first.snapshot.snapshot_sha256);
  assert(contexts[roleClass].compact_selection !== null, `${roleClass} did not receive a selected economical model route`);
  assert.equal(contexts[roleClass].global_behavior_policy.current_role_human_facing_authority, roleClass === "PRODUCT_OWNER" ? "PROJECT_OWNER_ONLY" : "NONE");
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
const second = materializeTestGlobalGovernanceStore({authorityRoot: root, nowUtc});
assert.notEqual(second.bootstrap.bootstrap_sha256, first.bootstrap.bootstrap_sha256);
assert.throws(() => assertOperationalGlobalGovernanceContext(contexts.CONTROLLER, {authorityStore: first.authorityStore, expectedRoleClass: "CONTROLLER"}), /stale|aliased/iu);
assert.throws(() => scheduler.globalGovernanceContext() && assertOperationalGlobalGovernanceContext(contexts.SCHEDULER, {authorityStore: first.authorityStore, expectedRoleClass: "SCHEDULER"}), /stale|aliased/iu);
const activeWorker = assertOperationalGlobalGovernanceContext(contexts.WORKING_AGENT, {authorityStore: first.authorityStore, expectedRoleClass: "WORKING_AGENT", activeWorker: true});
assert.equal(activeWorker.status, "BOUND_UNTIL_HANDOFF");
const rebuilt = compileOperationalGlobalGovernanceContext({authorityStore: second.authorityStore, roleClass: "RUNTIME", operationalId: "CONTEXT.RUNTIME.REBUILT"});
assert.equal(assertOperationalGlobalGovernanceContext(rebuilt, {authorityStore: second.authorityStore, expectedRoleClass: "RUNTIME"}).status, "READY_FOR_WORK");

fs.rmSync(root, {recursive: true, force: true});
if (!tempParentExisted && fs.readdirSync(tempParent).length === 0) fs.rmdirSync(tempParent);
console.log("PASS operational global governance: every concrete permanent role receives a canonical economical model selection, only Product Owner is human-facing, non-writers cannot widen authority, supersession invalidates contexts, and active workers remain exactly bound until handoff");
