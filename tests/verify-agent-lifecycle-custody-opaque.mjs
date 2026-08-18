#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as lifecycle from "../control/agent-lifecycle-custody.mjs";
import * as store from "../control/spawner-lifecycle-store.mjs";
import {prepareInstalledProjectLifecycleCustody, reattachInstalledProjectLifecycleCustody, consumeInstalledProjectLifecycleCustody} from "../control/project-lifecycle-custody.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.dirname(here);

for (const removed of ["prepareEphemeralProjectControlStoreForTest", "reattachEphemeralProjectControlStoreForTest", "disposeEphemeralProjectControlStoreForTest", "appendSpawnerLifecycleStoreEventForTest", "stageSpawnerLifecycleLockForTest", "clearSpawnerLifecycleLockForTest"]) {
  assert.equal(removed in store, false, `${removed} escaped into the production module`);
}
const productionSource = fs.readFileSync(path.join(root, "control/spawner-lifecycle-store.mjs"), "utf8");
assert(!/process\.(?:argv|env)|ForTest|TMPDIR/u.test(productionSource), "Lifecycle store retains a mutable test-mode gate");

const chosen = {sealedAuthority: Object.freeze(Object.create(null)), installedProjectStoreRoot: "/tmp", projectIdentitySha256: "a".repeat(64), bootstrapCustodySha256: "b".repeat(64)};
assert.throws(() => prepareInstalledProjectLifecycleCustody(chosen), (error) => error.code === "PROJECT_LIFECYCLE_CALLER_AUTHORITY_FORBIDDEN");
assert.throws(() => prepareInstalledProjectLifecycleCustody(), (error) => error.code === "PROJECT_LIFECYCLE_MANIFEST_INACTIVE");
assert.throws(() => reattachInstalledProjectLifecycleCustody({attachment: {}, secret: "attacker"}), (error) => error.code === "PROJECT_LIFECYCLE_CALLER_AUTHORITY_FORBIDDEN");
assert.throws(() => reattachInstalledProjectLifecycleCustody(), (error) => error.code === "PROJECT_LIFECYCLE_MANIFEST_INACTIVE");
assert.throws(() => consumeInstalledProjectLifecycleCustody(Object.freeze(Object.create(null))), (error) => error.code === "PROJECT_LIFECYCLE_CUSTODY_REQUIRED");

assert.throws(() => store.openSpawnerLifecycleStore({spawnerContext: {}, globalGovernanceAuthorityStore: {}, projectLifecycleCustody: {}}), /context|authority|projection/iu);
assert.throws(() => lifecycle.prepareSpawnerLifecycleAuthority({authorityRoot: "/tmp", spawnerAdmissionReceiptRef: `ref:admission/${"a".repeat(64)}`}), /rejects caller roots/iu);
assert.throws(() => lifecycle.authorizeAgentSpawn({authority: {}, requestId: "SPAWN.TEST", requestedRoleId: "AGENTOS.CONTROLLER", agentId: "AGENT.TEST", admissionReceiptRef: `ref:admission/${"a".repeat(64)}`, transitionReceiptRef: `ref:admission/${"b".repeat(64)}`}), (error) => error.code === "SPAWNER_LIFECYCLE_AUTHORITY_REQUIRED");
assert.throws(() => lifecycle.authorizeAgentDespawn({authority: {}, requestId: "DESPAWN.TEST", agentId: "AGENT.TEST", transitionReceiptRef: `ref:lifecycle/${"c".repeat(64)}`, handoffAccepted: true, worktreeReferenced: false}), /rejects caller roots/iu);

for (const schema of ["project-lifecycle-custody.v1.json", "spawner-lifecycle-store.v2.json", "spawner-lifecycle-transition-receipt.v1.json", "agent-lifecycle-custody.v2.json"]) JSON.parse(fs.readFileSync(path.join(root, "schemas", schema), "utf8"));

console.log("PASS lifecycle authority boundary: production has no test-mode mint/append API, caller roots and shaped custody are rejected, and the pinned prepared manifest keeps lifecycle inactive");
