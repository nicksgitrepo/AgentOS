#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {MODEL_POLICY_ROLE_CLASSES, compileBootstrapModelPolicyContext, compileModelPolicyProjection, selectEcoModelRoute, validateModelPolicyProjection} from "../control/eco-model-policy.mjs";
import {
  GLOBAL_GOVERNANCE_MEMORY_GENESIS,
  assertProjectAgnosticGovernanceValue,
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
import {appendAuthorizedGlobalGovernanceMemoryEvent, compileOperationalGlobalGovernanceContext} from "../control/global-governance-operational-context.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

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
for (const privateValue of [
  {safe_label: "ExampleConsumer context"},
  {safe_label: ["/", "Users", "/example/", "private", "/model-notes.json"].join("")},
  {safe_label: ["/", "tmp", "/raw-browser-capture.txt"].join("")},
  {safe_label: "user: retain this raw chat\nassistant: acknowledged"},
  {safe_label: "Bearer abcdefghijklmnopqrstuvwxyz"},
  {safe_label: "api_key=not-a-real-key-but-forbidden"},
  {safe_label: Buffer.from("password=encoded-private-value").toString("base64")},
  {safe_label: [{nested: {conversation: "prompt text"}}]},
]) assert.throws(() => assertProjectAgnosticGovernanceValue(privateValue), /private|transcript|secret|filesystem|forbidden/iu);
const unknownSource = structuredClone(active);
unknownSource.evidence[0].source_url = "https://unknown.invalid/model-research";
unknownSource.snapshot_sha256 = canonicalDigest({...unknownSource, snapshot_sha256: null});
assert.throws(() => compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.BAD.URL", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: unknownSource, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /canonical registry|source identity/iu);

const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-global-memory-"));
try {
  const fixture = materializeTestGlobalGovernanceStore({authorityRoot, nowUtc: NOW});
  const writerContext = compileOperationalGlobalGovernanceContext({authorityRoot, bootstrapSha256: fixture.bootstrap.bootstrap_sha256, roleClass: "SPAWNER", operationalId: "CONTEXT.SPAWNER.MEMORY.TEST"});
  const controllerContext = compileOperationalGlobalGovernanceContext({authorityRoot, bootstrapSha256: fixture.bootstrap.bootstrap_sha256, roleClass: "CONTROLLER", operationalId: "CONTEXT.CONTROLLER.MEMORY.TEST"});
  const supersessionEvent = compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.MODEL_POLICY.TEST.SUPERSEDED", sequence: 1, eventType: "MODEL_POLICY_SUPERSEDED", writerRole: "GOVERNED_MEMORY_ADAPTER", targetSnapshotSha256: fixture.snapshot.snapshot_sha256, reasonCode: "ROUTING_POLICY_REFRESH", priorEventSha256: fixture.events[0].event_sha256, observedAtUtc: NOW});
  assert.throws(() => appendAuthorizedGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: fixture.events[0].event_sha256, event: supersessionEvent, writerContext: controllerContext, bootstrapSha256: fixture.bootstrap.bootstrap_sha256}), /Only a canonical Spawner|writer/iu);
  const appended = appendAuthorizedGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: fixture.events[0].event_sha256, event: supersessionEvent, writerContext, bootstrapSha256: fixture.bootstrap.bootstrap_sha256});
  assert.equal(appended.status, "APPENDED");
  const idempotent = appendAuthorizedGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: supersessionEvent.event_sha256, event: supersessionEvent, writerContext, bootstrapSha256: fixture.bootstrap.bootstrap_sha256});
  assert.equal(idempotent.status, "IDEMPOTENT");
  assert.throws(() => appendAuthorizedGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, event: supersessionEvent, writerContext, bootstrapSha256: fixture.bootstrap.bootstrap_sha256}), /stale/iu);
  assert.deepEqual(readGlobalGovernanceMemory({authorityRoot}), [fixture.events[0], supersessionEvent]);
  const lockPath = path.join(authorityRoot, "global-governance/model-policy-events.jsonl.lock");
  const competingWriter = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore"});
  const lock = {schema: "agentos.global_governance_memory_lock.v1", version: 1, process_id: competingWriter.pid, target_relative_path: "global-governance/model-policy-events.jsonl", acquired_at_utc: NOW, fence_sha256: null};
  lock.fence_sha256 = canonicalDigest({...lock, fence_sha256: null});
  fs.writeFileSync(lockPath, `${JSON.stringify(lock)}\n`, {mode: 0o600});
  assert.throws(() => appendAuthorizedGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: supersessionEvent.event_sha256, event: supersessionEvent, writerContext, bootstrapSha256: fixture.bootstrap.bootstrap_sha256}), /locked/iu);
  assert.throws(() => recoverGlobalGovernanceMemoryLock({authorityRoot}), /still alive|locked/iu);
  competingWriter.kill("SIGTERM");
  await once(competingWriter, "exit");
  const recovered = recoverGlobalGovernanceMemoryLock({authorityRoot, isProcessAlive: () => false});
  assert.equal(recovered.status, "RECOVERED_DEAD_LOCK");
  assert(fs.existsSync(recovered.recovered_lock_path));
  assert.equal(appendAuthorizedGlobalGovernanceMemoryEvent({authorityRoot, expectedHeadSha256: supersessionEvent.event_sha256, event: supersessionEvent, writerContext, bootstrapSha256: fixture.bootstrap.bootstrap_sha256}).status, "IDEMPOTENT");
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
