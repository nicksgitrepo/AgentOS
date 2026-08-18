#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {MODEL_POLICY_ROLE_CLASSES, compileBootstrapModelPolicyContext, compileModelPolicyProjection, selectEcoModelRoute, validateModelPolicyProjection, validateModelPolicySnapshot} from "../control/eco-model-policy.mjs";
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

const NOW = "2026-08-18T08:30:00.000Z";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const prepared = JSON.parse(fs.readFileSync(path.join(root, "fixtures/model-policy-snapshot.initial.v1.json"), "utf8"));
const active = structuredClone(prepared);
active.status = "ACCEPTED_ACTIVE";
active.snapshot_sha256 = canonicalDigest({...active, snapshot_sha256: null});
const event = compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: active, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW});
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
const governedBootstrap = compileGlobalGovernanceBootstrap({events: [event], readback, observedAtUtc: NOW});
assert.throws(() => compileGlobalGovernanceBootstrap({events: [event], readback, workerRoute: route, observedAtUtc: NOW}), /Caller-supplied model routes/iu);
for (const roleClass of MODEL_POLICY_ROLE_CLASSES) assert.equal(requireGlobalGovernanceRoleProjection({bootstrap: governedBootstrap, events: [event], readback, roleClass}).role_class, roleClass);
assert.throws(() => validateGlobalGovernanceBootstrap(governedBootstrap, {events: [event]}), /readback/iu);
const missingIntegration = structuredClone(governedBootstrap);
missingIntegration.projections = missingIntegration.projections.filter((entry) => entry.role_class !== "SCHEDULER");
missingIntegration.bootstrap_sha256 = canonicalDigest({...missingIntegration, bootstrap_sha256: null});
assert.throws(() => validateGlobalGovernanceBootstrap(missingIntegration, {events: [event], readback}), /visibility is incomplete/iu);
const forgedBootstrapTime = structuredClone(governedBootstrap);
forgedBootstrapTime.projections[0].projected_at_utc = "2020-01-01T00:00:00.000Z";
forgedBootstrapTime.projections[0].projection_sha256 = canonicalDigest({...forgedBootstrapTime.projections[0], projection_sha256: null});
forgedBootstrapTime.bootstrap_sha256 = canonicalDigest({...forgedBootstrapTime, bootstrap_sha256: null});
assert.throws(() => validateGlobalGovernanceBootstrap(forgedBootstrapTime, {events: [event], readback}), /projection time/iu);
const forgedBootstrapFloors = structuredClone(governedBootstrap);
const forgedWorker = forgedBootstrapFloors.projections.find((projection) => projection.role_class === "WORKING_AGENT");
Object.assign(forgedWorker.selected, {capability_floor: 0, context_floor_tokens: 1});
forgedWorker.projection_sha256 = canonicalDigest({...forgedWorker, projection_sha256: null});
forgedBootstrapFloors.bootstrap_sha256 = canonicalDigest({...forgedBootstrapFloors, bootstrap_sha256: null});
assert.throws(() => validateGlobalGovernanceBootstrap(forgedBootstrapFloors, {events: [event], readback}), /floors differ/iu);
assert.throws(() => validateGlobalGovernanceBootstrap(governedBootstrap, {events: [event], readback, observedAtUtc: NOW}), /trusted time cannot be supplied/iu);
const widenedProjection = structuredClone(workerProjection);
widenedProjection.selected.consumer_data = "FORBIDDEN";
widenedProjection.projection_sha256 = canonicalDigest({...widenedProjection, projection_sha256: null});
assert.throws(() => validateModelPolicyProjection(widenedProjection, {snapshot: active, expectedRoleClass: "WORKING_AGENT", nowUtc: NOW}), /fields mismatch/iu);

assert.throws(() => compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "CONTROLLER", snapshot: active, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /writer is forbidden/iu);
const leaked = structuredClone(active);
leaked.project_ref = "FORBIDDEN_PROJECT";
leaked.snapshot_sha256 = canonicalDigest({...leaked, snapshot_sha256: null});
assert.throws(() => compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: leaked, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /fields mismatch|forbidden project|private/iu);
for (const privateValue of [
  {safe_label: "ExampleConsumer context"},
  {safe_label: ["/", "Users", "/example/", "private", "/model-notes.json"].join("")},
  {safe_label: ["/", "tmp", "/raw-browser-capture.txt"].join("")},
  {safe_label: "user: retain this raw chat\nassistant: acknowledged"},
  {safe_label: "Bearer abcdefghijklmnopqrstuvwxyz"},
  {safe_label: "api_key=not-a-real-key-but-forbidden"},
  {safe_label: Buffer.from("password=encoded-private-value").toString("base64")},
  {safe_label: "%2FUsers%2Fprivate%2Fconsumer-context.json"},
  {safe_label: "\\u002fhome\\u002fprivate\\u002fraw-chat.txt"},
  {safe_label: "ｂｅａｒｅｒ abcdefghijklmnopqrstuvwxyz"},
  {safe_label: [{nested: {conversation: "prompt text"}}]},
]) assert.throws(() => assertProjectAgnosticGovernanceValue(privateValue), /private|transcript|secret|filesystem|forbidden/iu);
assert.throws(() => compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: active, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: "not-a-time"}), /exact UTC timestamp/iu);
for (const eventId of ["PROJECT.ACME.123", "PROJECT-ACME-123", "project.acme", "PROJECT_ACME_123", "ACME_PROJECT_123", "ＰＲＯＪＥＣＴ．ＡＣＭＥ", "%50%52%4F%4A%45%43%54.ACME", Buffer.from("PROJECT.ACME").toString("base64")]) assert.throws(() => compileGlobalGovernanceMemoryEvent({eventId, sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: active, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /minted internally/iu);
const nonMonotonic = compileGlobalGovernanceMemoryEvent({sequence: 1, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: active, priorEventSha256: event.event_sha256, observedAtUtc: "2026-08-18T07:00:00.000Z"});
assert.throws(() => replayGlobalGovernanceMemory([event, nonMonotonic]), /non-monotonic|current model policy|future-dated/iu);
const forgedEventId = structuredClone(event); forgedEventId.event_id = "GGM.ACCEPTED." + "A".repeat(48); forgedEventId.event_sha256 = canonicalDigest({...forgedEventId, event_sha256: null});
assert.throws(() => replayGlobalGovernanceMemory([forgedEventId]), /internally derived/iu);
const unknownSource = structuredClone(active);
unknownSource.evidence[0].source_url = "https://unknown.invalid/model-research";
unknownSource.snapshot_sha256 = canonicalDigest({...unknownSource, snapshot_sha256: null});
assert.throws(() => compileGlobalGovernanceMemoryEvent({sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: unknownSource, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /fields mismatch|raw URL|canonical registry|source identity/iu);

const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-global-memory-"));
try {
  const fixture = materializeTestGlobalGovernanceStore({authorityRoot, nowUtc: NOW});
  const writerContext = compileOperationalGlobalGovernanceContext({authorityStore: fixture.authorityStore, roleClass: "SPAWNER", operationalId: "CONTEXT.SPAWNER.MEMORY.TEST"});
  const controllerContext = compileOperationalGlobalGovernanceContext({authorityStore: fixture.authorityStore, roleClass: "CONTROLLER", operationalId: "CONTEXT.CONTROLLER.MEMORY.TEST"});
  const supersessionEvent = compileGlobalGovernanceMemoryEvent({sequence: 1, eventType: "MODEL_POLICY_SUPERSEDED", writerRole: "GOVERNED_MEMORY_ADAPTER", targetSnapshotSha256: fixture.snapshot.snapshot_sha256, reasonCode: "ROUTING_POLICY_REFRESH", priorEventSha256: fixture.events[0].event_sha256, observedAtUtc: NOW});
  const alternateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-global-memory-wrong-root-"));
  assert.throws(() => appendAuthorizedGlobalGovernanceMemoryEvent({authorityRoot: alternateRoot, expectedHeadSha256: fixture.events[0].event_sha256, event: supersessionEvent, writerContext}), /only a bound writer context|root/iu);
  assert.deepEqual(fs.readdirSync(alternateRoot), []);
  fs.rmSync(alternateRoot, {recursive: true, force: true});
  assert.throws(() => appendAuthorizedGlobalGovernanceMemoryEvent({expectedHeadSha256: fixture.events[0].event_sha256, event: supersessionEvent, writerContext: controllerContext}), /Only a canonical Spawner|writer/iu);
  const appended = appendAuthorizedGlobalGovernanceMemoryEvent({expectedHeadSha256: fixture.events[0].event_sha256, event: supersessionEvent, writerContext});
  assert.equal(appended.status, "APPENDED");
  const idempotent = appendAuthorizedGlobalGovernanceMemoryEvent({expectedHeadSha256: supersessionEvent.event_sha256, event: supersessionEvent, writerContext});
  assert.equal(idempotent.status, "IDEMPOTENT");
  assert.throws(() => appendAuthorizedGlobalGovernanceMemoryEvent({expectedHeadSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, event: supersessionEvent, writerContext}), /stale/iu);
  assert.deepEqual(readGlobalGovernanceMemory({authorityRoot}), [fixture.events[0], supersessionEvent]);
  const lockPath = path.join(authorityRoot, "global-governance/model-policy-events.jsonl.lock");
  const competingWriter = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore"});
  const lock = {schema: "agentos.global_governance_memory_lock.v1", version: 1, process_id: competingWriter.pid, target_relative_path: "global-governance/model-policy-events.jsonl", acquired_at_utc: NOW, fence_sha256: null};
  lock.fence_sha256 = canonicalDigest({...lock, fence_sha256: null});
  fs.writeFileSync(lockPath, `${JSON.stringify(lock)}\n`, {mode: 0o600});
  assert.throws(() => appendAuthorizedGlobalGovernanceMemoryEvent({expectedHeadSha256: supersessionEvent.event_sha256, event: supersessionEvent, writerContext}), /locked/iu);
  assert.throws(() => recoverGlobalGovernanceMemoryLock({authorityRoot}), /still alive|locked/iu);
  competingWriter.kill("SIGTERM");
  await once(competingWriter, "exit");
  const recovered = recoverGlobalGovernanceMemoryLock({authorityRoot, isProcessAlive: () => false});
  assert.equal(recovered.status, "RECOVERED_DEAD_LOCK");
  assert(fs.existsSync(recovered.recovered_lock_path));
  assert.equal(appendAuthorizedGlobalGovernanceMemoryEvent({expectedHeadSha256: supersessionEvent.event_sha256, event: supersessionEvent, writerContext}).status, "IDEMPOTENT");
} finally {
  fs.rmSync(authorityRoot, {recursive: true, force: true});
}

const superseded = compileGlobalGovernanceMemoryEvent({sequence: 1, eventType: "MODEL_POLICY_SUPERSEDED", writerRole: "GOVERNED_MEMORY_ADAPTER", targetSnapshotSha256: active.snapshot_sha256, reasonCode: "ROUTING_POLICY_REFRESH", priorEventSha256: event.event_sha256, observedAtUtc: NOW});
const next = structuredClone(active);
next.task_classes.find((task) => task.task_class === "NARROW_CODING").max_concurrency = 3;
next.snapshot_sha256 = canonicalDigest({...next, snapshot_sha256: null});
const nextEvent = compileGlobalGovernanceMemoryEvent({sequence: 2, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "GOVERNED_MEMORY_ADAPTER", snapshot: next, priorEventSha256: superseded.event_sha256, observedAtUtc: NOW});
const updatedReplay = replayGlobalGovernanceMemory([event, superseded, nextEvent]);
assert.equal(updatedReplay.current_snapshot.snapshot_sha256, next.snapshot_sha256);
assert.equal(workerProjection.snapshot_sha256, active.snapshot_sha256, "active worker must retain its bound snapshot until safe refresh or handoff");
assert.throws(() => validateGlobalGovernanceMemoryReadback(readback, {events: [event, superseded, nextEvent]}), /stale/iu);
assert.throws(() => replayGlobalGovernanceMemory([event, nextEvent]), /noncontiguous|superseded or invalidated/iu);
const invalidTarget = compileGlobalGovernanceMemoryEvent({sequence: 1, eventType: "MODEL_POLICY_INVALIDATED", writerRole: "SPAWNER", targetSnapshotSha256: "f".repeat(64), reasonCode: "SOURCE_CONTRADICTION", priorEventSha256: event.event_sha256, observedAtUtc: NOW});
assert.throws(() => replayGlobalGovernanceMemory([event, invalidTarget]), /target is stale or unknown/iu);
assert.throws(() => validateModelPolicySnapshot(active, {nowUtc: "2026-08-26T08:00:00.000Z", requireActive: true}), /stale/iu);
const contextDigest = canonicalDigest({context: active.snapshot_sha256});
const seedDigest = canonicalDigest({seed: contextDigest});
assert.deepEqual(computeInvalidationClosure({changedDigests: [active.snapshot_sha256], dependencyGraph: [
  {source_sha256: active.snapshot_sha256, dependent_sha256: contextDigest},
  {source_sha256: contextDigest, dependent_sha256: seedDigest},
]}), [active.snapshot_sha256, contextDigest, seedDigest].sort());

console.log("PASS global governance memory: append-only CAS, writer restriction, project isolation, source conflict authority, universal read visibility, supersession, and stale readback rejection");
