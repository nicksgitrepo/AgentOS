#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {MODEL_POLICY_ROLE_CLASSES, compileBootstrapModelPolicyContext, compileModelPolicyProjection, selectEcoModelRoute, validateModelPolicyProjection} from "../control/eco-model-policy.mjs";
import {
  GLOBAL_GOVERNANCE_MEMORY_GENESIS,
  appendGlobalGovernanceMemoryEvent,
  assertGlobalPolicyVisibility,
  compileGlobalGovernanceMemoryEvent,
  compileGlobalGovernanceMemoryReadback,
  readGlobalGovernanceMemory,
  recoverGlobalGovernanceMemoryLock,
  replayGlobalGovernanceMemory,
  validateGlobalGovernanceMemoryReadback,
} from "../control/global-governance-memory.mjs";
import {computeInvalidationClosure} from "../control/spawner-bootstrap-governance.mjs";
import {compileGlobalGovernanceBootstrap, requireGlobalGovernanceRoleProjection, validateGlobalGovernanceBootstrap} from "../control/global-governance-bootstrap.mjs";

const NOW = "2026-08-18T16:30:00.000Z";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const prepared = JSON.parse(fs.readFileSync(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json"), "utf8"));
const active = structuredClone(prepared);
active.status = "ACCEPTED_ACTIVE";
active.snapshot_sha256 = canonicalDigest({...active, snapshot_sha256: null});
const event = compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.MODEL_POLICY.1", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: active, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW});
const replay = replayGlobalGovernanceMemory([event]);
assert.equal(replay.status, "READY");
assert.equal(replay.current_snapshot.snapshot_sha256, active.snapshot_sha256);
const readback = compileGlobalGovernanceMemoryReadback({events: [event], historicalActivationReceiptSha256: "a".repeat(64), observedAtUtc: NOW});
validateGlobalGovernanceMemoryReadback(readback, {events: [event]});

for (const roleClass of MODEL_POLICY_ROLE_CLASSES) {
  const visibility = assertGlobalPolicyVisibility(roleClass, readback);
  assert.equal(visibility.read_only, true);
  assert.equal(visibility.snapshot_sha256, active.snapshot_sha256);
}
const route = selectEcoModelRoute({snapshot: active, taskClass: "NARROW_CODING", roleCapabilityFloor: 49, requiredContextTokens: 64000, requiredCapabilities: ["CODE"], nowUtc: NOW});
const workerProjection = compileModelPolicyProjection({snapshot: active, roleClass: "WORKING_AGENT", selectedRoute: route, projectedAtUtc: NOW});
assert.equal(workerProjection.selected.model_id, route.model_id);
assert.equal(workerProjection.snapshot_sha256, active.snapshot_sha256);
const bootstrapContext = compileBootstrapModelPolicyContext({snapshot: active, selectedRoute: route, projectedAtUtc: NOW});
assert.deepEqual(bootstrapContext.projections.map((entry) => entry.role_class), MODEL_POLICY_ROLE_CLASSES);
assert(bootstrapContext.projections.every((entry) => entry.read_only === true && entry.snapshot_sha256 === active.snapshot_sha256));
assert.equal(bootstrapContext.injection, "AUTOMATIC_BEFORE_ROSTER_OR_WORKER_ADMISSION");
const governedBootstrap = compileGlobalGovernanceBootstrap({events: [event], readback, workerRoute: route, observedAtUtc: NOW});
for (const roleClass of MODEL_POLICY_ROLE_CLASSES) assert.equal(requireGlobalGovernanceRoleProjection({bootstrap: governedBootstrap, events: [event], readback, roleClass, observedAtUtc: NOW}).role_class, roleClass);
assert.throws(() => validateGlobalGovernanceBootstrap(governedBootstrap, {events: [event]}), /readback/iu);
const missingIntegration = structuredClone(governedBootstrap);
missingIntegration.projections = missingIntegration.projections.filter((entry) => entry.role_class !== "SCHEDULER");
missingIntegration.bootstrap_sha256 = canonicalDigest({...missingIntegration, bootstrap_sha256: null});
assert.throws(() => validateGlobalGovernanceBootstrap(missingIntegration, {events: [event], readback, observedAtUtc: NOW}), /visibility is incomplete/iu);
const widenedProjection = structuredClone(workerProjection);
widenedProjection.selected.consumer_data = "FORBIDDEN";
widenedProjection.projection_sha256 = canonicalDigest({...widenedProjection, projection_sha256: null});
assert.throws(() => validateModelPolicyProjection(widenedProjection, {snapshot: active, expectedRoleClass: "WORKING_AGENT", nowUtc: NOW}), /fields mismatch/iu);

assert.throws(() => compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.BAD.WRITER", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "CONTROLLER", snapshot: active, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /writer is forbidden/iu);
const leaked = structuredClone(active);
leaked.project_ref = "FORBIDDEN_PROJECT";
leaked.snapshot_sha256 = canonicalDigest({...leaked, snapshot_sha256: null});
assert.throws(() => compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.BAD.LEAK", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: leaked, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /fields mismatch|forbidden project|private/iu);

const conflicted = structuredClone(active);
conflicted.snapshot_sha256 = canonicalDigest({...conflicted, snapshot_sha256: null});
compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.CONFLICT.RESOLVED", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "GOVERNED_MEMORY_ADAPTER", snapshot: conflicted, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW});
const unresolved = structuredClone(conflicted);
unresolved.conflicts.find((conflict) => conflict.field === "gpt-5.6-terra.input_usd_per_million").resolution = "COMPARATIVE_GOVERNS";
unresolved.snapshot_sha256 = canonicalDigest({...unresolved, snapshot_sha256: null});
assert.throws(() => compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.CONFLICT.BAD", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: unresolved, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /first-party authority/iu);

const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-global-memory-"));
try {
  const appended = appendGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, event});
  assert.equal(appended.status, "APPENDED");
  const idempotent = appendGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: event.event_sha256, event});
  assert.equal(idempotent.status, "IDEMPOTENT");
  assert.throws(() => appendGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, event}), /stale/iu);
  assert.deepEqual(readGlobalGovernanceMemory({authorityRoot}), [event]);
  const lockPath = path.join(authorityRoot, "global-governance/model-policy-events.jsonl.lock");
  const lock = {schema: "agentos.global_governance_memory_lock.v1", version: 1, process_id: 999999, target_relative_path: "global-governance/model-policy-events.jsonl", acquired_at_utc: NOW, fence_sha256: null};
  lock.fence_sha256 = canonicalDigest({...lock, fence_sha256: null});
  fs.writeFileSync(lockPath, `${JSON.stringify(lock)}\n`, {mode: 0o600});
  assert.throws(() => appendGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: event.event_sha256, event}), /locked/iu);
  const recovered = recoverGlobalGovernanceMemoryLock({authorityRoot, isProcessAlive: () => false});
  assert.equal(recovered.status, "RECOVERED_DEAD_LOCK");
  assert(fs.existsSync(recovered.recovered_lock_path));
  assert.equal(appendGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: event.event_sha256, event}).status, "IDEMPOTENT");
} finally {
  fs.rmSync(authorityRoot, {recursive: true, force: true});
}

const superseded = compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.MODEL_POLICY.1.SUPERSEDED", sequence: 1, eventType: "MODEL_POLICY_SUPERSEDED", writerRole: "GOVERNED_MEMORY_ADAPTER", targetSnapshotSha256: active.snapshot_sha256, reasonCode: "ROUTING_POLICY_REFRESH", priorEventSha256: event.event_sha256, observedAtUtc: NOW});
const next = structuredClone(active);
next.task_classes.find((task) => task.task_class === "NARROW_CODING").max_concurrency = 3;
next.snapshot_sha256 = canonicalDigest({...next, snapshot_sha256: null});
const nextEvent = compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.MODEL_POLICY.2", sequence: 2, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "GOVERNED_MEMORY_ADAPTER", snapshot: next, priorEventSha256: superseded.event_sha256, observedAtUtc: NOW});
const updatedReplay = replayGlobalGovernanceMemory([event, superseded, nextEvent], {observedAtUtc: NOW});
assert.equal(updatedReplay.current_snapshot.snapshot_sha256, next.snapshot_sha256);
assert.equal(workerProjection.snapshot_sha256, active.snapshot_sha256, "active worker must retain its bound snapshot until safe refresh or handoff");
assert.throws(() => validateGlobalGovernanceMemoryReadback(readback, {events: [event, superseded, nextEvent]}), /stale/iu);
assert.throws(() => replayGlobalGovernanceMemory([event, nextEvent], {observedAtUtc: NOW}), /noncontiguous|superseded or invalidated/iu);
const invalidTarget = compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.MODEL_POLICY.BAD_TARGET", sequence: 1, eventType: "MODEL_POLICY_INVALIDATED", writerRole: "SPAWNER", targetSnapshotSha256: "f".repeat(64), reasonCode: "SOURCE_CONTRADICTION", priorEventSha256: event.event_sha256, observedAtUtc: NOW});
assert.throws(() => replayGlobalGovernanceMemory([event, invalidTarget], {observedAtUtc: NOW}), /target is stale or unknown/iu);
assert.throws(() => replayGlobalGovernanceMemory([event], {observedAtUtc: "2026-08-20T16:00:00.000Z"}), /stale/iu);
const contextDigest = canonicalDigest({context: active.snapshot_sha256});
const seedDigest = canonicalDigest({seed: contextDigest});
assert.deepEqual(computeInvalidationClosure({changedDigests: [active.snapshot_sha256], dependencyGraph: [
  {source_sha256: active.snapshot_sha256, dependent_sha256: contextDigest},
  {source_sha256: contextDigest, dependent_sha256: seedDigest},
]}), [active.snapshot_sha256, contextDigest, seedDigest].sort());

console.log("PASS global governance memory: append-only CAS, writer restriction, project isolation, source conflict authority, universal read visibility, supersession, and stale readback rejection");
