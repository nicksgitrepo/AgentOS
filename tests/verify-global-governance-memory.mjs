#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {MODEL_POLICY_ROLE_CLASSES, compileBootstrapModelPolicyContext, compileModelPolicyProjection, selectEcoModelRoute} from "../control/eco-model-policy.mjs";
import {
  GLOBAL_GOVERNANCE_MEMORY_GENESIS,
  appendGlobalGovernanceMemoryEvent,
  assertGlobalPolicyVisibility,
  compileGlobalGovernanceMemoryEvent,
  compileGlobalGovernanceMemoryReadback,
  readGlobalGovernanceMemory,
  replayGlobalGovernanceMemory,
  validateGlobalGovernanceMemoryReadback,
} from "../control/global-governance-memory.mjs";
import {computeInvalidationClosure} from "../control/spawner-bootstrap-governance.mjs";

const NOW = "2026-08-17T23:30:00.000Z";
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
const route = selectEcoModelRoute({snapshot: active, taskClass: "NARROW_CODING", roleCapabilityFloor: 50, requiredContextTokens: 64000, requiredCapabilities: ["CODE"], nowUtc: NOW});
const workerProjection = compileModelPolicyProjection({snapshot: active, roleClass: "WORKING_AGENT", selectedRoute: route, projectedAtUtc: NOW});
assert.equal(workerProjection.selected.model_id, route.model_id);
assert.equal(workerProjection.snapshot_sha256, active.snapshot_sha256);
const bootstrapContext = compileBootstrapModelPolicyContext({snapshot: active, selectedRoute: route, projectedAtUtc: NOW});
assert.deepEqual(bootstrapContext.projections.map((entry) => entry.role_class), MODEL_POLICY_ROLE_CLASSES);
assert(bootstrapContext.projections.every((entry) => entry.read_only === true && entry.snapshot_sha256 === active.snapshot_sha256));
assert.equal(bootstrapContext.injection, "AUTOMATIC_BEFORE_ROSTER_OR_WORKER_ADMISSION");

assert.throws(() => compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.BAD.WRITER", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "CONTROLLER", snapshot: active, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /writer is forbidden/iu);
const leaked = structuredClone(active);
leaked.project_ref = "FORBIDDEN_PROJECT";
leaked.snapshot_sha256 = canonicalDigest({...leaked, snapshot_sha256: null});
assert.throws(() => compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.BAD.LEAK", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "SPAWNER", snapshot: leaked, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW}), /forbidden project|private key/iu);

const conflicted = structuredClone(active);
conflicted.conflicts = [{field: "input_usd_per_million", first_party_value: "2", comparative_value: "2.5", resolution: "FIRST_PARTY_GOVERNS"}];
conflicted.snapshot_sha256 = canonicalDigest({...conflicted, snapshot_sha256: null});
compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.CONFLICT.RESOLVED", sequence: 0, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "GOVERNED_MEMORY_ADAPTER", snapshot: conflicted, priorEventSha256: GLOBAL_GOVERNANCE_MEMORY_GENESIS, observedAtUtc: NOW});
const unresolved = structuredClone(conflicted);
unresolved.conflicts[0].resolution = "COMPARATIVE_GOVERNS";
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
} finally {
  fs.rmSync(authorityRoot, {recursive: true, force: true});
}

const next = structuredClone(active);
next.models.find((model) => model.model_id === "gpt-5.6-luna").capability_score = 53;
next.snapshot_sha256 = canonicalDigest({...next, snapshot_sha256: null});
const nextEvent = compileGlobalGovernanceMemoryEvent({eventId: "GLOBAL.MODEL_POLICY.2", sequence: 1, eventType: "MODEL_POLICY_ACCEPTED", writerRole: "GOVERNED_MEMORY_ADAPTER", snapshot: next, priorEventSha256: event.event_sha256, observedAtUtc: NOW});
const updatedReplay = replayGlobalGovernanceMemory([event, nextEvent]);
assert.equal(updatedReplay.current_snapshot.snapshot_sha256, next.snapshot_sha256);
assert.equal(workerProjection.snapshot_sha256, active.snapshot_sha256, "active worker must retain its bound snapshot until safe refresh or handoff");
assert.throws(() => validateGlobalGovernanceMemoryReadback(readback, {events: [event, nextEvent]}), /stale/iu);
const contextDigest = canonicalDigest({context: active.snapshot_sha256});
const seedDigest = canonicalDigest({seed: contextDigest});
assert.deepEqual(computeInvalidationClosure({changedDigests: [active.snapshot_sha256], dependencyGraph: [
  {source_sha256: active.snapshot_sha256, dependent_sha256: contextDigest},
  {source_sha256: contextDigest, dependent_sha256: seedDigest},
]}), [active.snapshot_sha256, contextDigest, seedDigest].sort());

console.log("PASS global governance memory: append-only CAS, writer restriction, project isolation, source conflict authority, universal read visibility, supersession, and stale readback rejection");
