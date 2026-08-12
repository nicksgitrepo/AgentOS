#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GENESIS_EVENT_SHA256,
  compileDecisionRecord,
  compileGoalRecord,
  compileHandoffRecord,
  compileMemoryConflictRecord,
  compileMemoryEvent,
  compileMemoryInvalidationSet,
  compileMemorySnapshot,
  compileProjectContextRecord,
  compileRoleContextCapsule,
  compileRepositoryMapReference,
  compilePolicyReference,
  replayMemoryLedger,
  validateMemoryEvent,
  validateMemoryRecord,
  validateMemorySnapshot,
} from "../control/project-memory.mjs";
import {
  appendProjectMemoryEvent,
  readProjectMemoryLedger,
  readProjectMemorySnapshot,
  reconstructProjectMemory,
  writeProjectMemorySnapshotCompareAndSwap,
} from "../control/project-memory-store.mjs";
import {canonicalDigest, scanPersistedRecord} from "../control/content-addressing.mjs";
import {compileProjectMap} from "../control/project-map.mjs";
import {compileDerivedIndex} from "../control/derived-index.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "schemas/project-memory.v1.json"), "utf8"));
assert.equal(contract.status, "PREPARED_NOT_ACTIVATED");
assert.equal(contract.activation.active, false);
assert.equal(contract.authority.canonical.includes("agentos.project_memory_event.v1"), true);

const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-project-memory-"));
const binding = {
  project_ref: "PROJECT-1",
  campaign_ref: "CAMPAIGN-1",
  goal_ref: "GOAL-1",
  role_ref: "ORCHESTRATOR",
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
  source_snapshot_sha256: "c".repeat(64),
  policy_sha256: "d".repeat(64),
  handoff_sha256: "e".repeat(64),
};

function makeDigest(seed) {
  return canonicalDigest({seed});
}

const context = compileProjectContextRecord({
  recordId: "CONTEXT-1",
  binding,
  contextInputSha256: makeDigest("context-input"),
  intentSha256: makeDigest("intent"),
  planSha256: makeDigest("plan"),
  governanceSha256: makeDigest("governance"),
  boundarySha256: makeDigest("boundary"),
});
const goal = compileGoalRecord({
  recordId: "GOAL-1",
  binding,
  goalSha256: makeDigest("goal"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: makeDigest("scope"),
  acceptanceSha256: makeDigest("acceptance"),
});
const decision = compileDecisionRecord({
  recordId: "DECISION-1",
  binding,
  decisionSha256: makeDigest("decision"),
  decisionKind: "OWNER_CHOICE",
  selectionRef: "KEEP_CONTROL_SPACE",
  effectScope: ["PROJECT_MEMORY", "ROLE_CAPSULE"],
  rationaleSha256: makeDigest("rationale"),
});
const handoff = compileHandoffRecord({
  recordId: "HANDOFF-1",
  binding,
  handoffKind: "MEMORY_LANE",
  nextActionRef: "INDEPENDENT_AUDITOR",
  resultSha256: makeDigest("result"),
});
const policy = compilePolicyReference({
  recordId: "POLICY-1",
  binding,
  policyEpoch: 1,
  policyKind: "CURRENT_POLICY",
});
const mapRef = compileRepositoryMapReference({
  recordId: "MAP-REF-1",
  binding,
  mapSha256: makeDigest("map"),
  mapStatus: "READY",
  mapSourceSnapshotSha256: binding.source_snapshot_sha256,
});

for (const record of [context, goal, decision, handoff, policy, mapRef]) {
  assert.doesNotThrow(() => validateMemoryRecord(record));
  assert.equal(scanPersistedRecord(record).safe, true);
}

let events = [];
function appendRecord(record, eventType = "RECORD_APPENDED", key = `APPEND-${events.length}`) {
  const event = compileMemoryEvent({
    eventId: `EVENT-${events.length}`,
    idempotencyKey: key,
    sequence: events.length,
    eventType,
    record,
    priorEventSha256: events.at(-1)?.event_sha256 ?? GENESIS_EVENT_SHA256,
  });
  const result = appendProjectMemoryEvent({
    authorityRoot,
    expectedHeadSha256: events.at(-1)?.event_sha256 ?? GENESIS_EVENT_SHA256,
    event,
  });
  assert.equal(result.status, "APPENDED");
  events.push(event);
  return event;
}

appendRecord(context);
appendRecord(goal);
appendRecord(decision);
appendRecord(handoff);
appendRecord(policy);
appendRecord(mapRef);

const ledger = readProjectMemoryLedger({authorityRoot});
assert.equal(ledger.event_count, events.length);
assert.equal(ledger.head_sha256, events.at(-1).event_sha256);
assert.deepEqual(ledger.events, events);

const replay = reconstructProjectMemory({authorityRoot, binding});
assert.equal(replay.status, "READY");
assert.equal(replay.event_count, events.length);
assert.equal(replay.current_records.some((record) => record.record_sha256 === context.record_sha256), true);

const projectMap = compileProjectMap({
  mapId: "MAP-1",
  projectRef: binding.project_ref,
  campaignRef: binding.campaign_ref,
  goalRef: binding.goal_ref,
  mapKind: "COMPOSITE",
  roleScope: [binding.role_ref],
  sourceCommit: binding.source_commit,
  sourceTree: binding.source_tree,
  sourceSnapshotSha256: binding.source_snapshot_sha256,
  policySha256: binding.policy_sha256,
  nodes: [{
    node_id: "PROJECT-1",
    node_kind: "PROJECT",
    label: "Project root",
    status: "CURRENT",
    source_record_digests: [context.record_sha256],
    epistemic_class: "DIRECT",
    role_scope: [binding.role_ref],
  }],
  edges: [],
  selectedRoots: ["PROJECT-1"],
});
const derivedIndex = compileDerivedIndex({
  indexId: "INDEX-1",
  projectRef: binding.project_ref,
  sourceSnapshotSha256: binding.source_snapshot_sha256,
  policySha256: binding.policy_sha256,
  documents: [{
    document_id: "DOC-1",
    document_kind: "OTHER",
    source_record_digests: [context.record_sha256],
    role_scope: [binding.role_ref],
    content: "project context",
  }],
});

const supersedingDecision = compileDecisionRecord({
  recordId: "DECISION-1",
  recordVersion: 2,
  binding,
  supersedesRecordSha256: decision.record_sha256,
  decisionSha256: makeDigest("decision-v2"),
  decisionKind: "OWNER_CHOICE",
  selectionRef: "KEEP_CONTROL_SPACE",
  effectScope: ["PROJECT_MEMORY", "ROLE_CAPSULE"],
  rationaleSha256: makeDigest("rationale-v2"),
  supersedesDecisionSha256: decision.body.decision_sha256,
});
const supersedingEvent = compileMemoryEvent({
  eventId: "EVENT-SUPERSEDES",
  idempotencyKey: "SUPERSEDES-1",
  sequence: events.length,
  record: supersedingDecision,
  priorEventSha256: events.at(-1).event_sha256,
});
const supersededReplay = replayMemoryLedger([...events, supersedingEvent], {binding});
assert.equal(supersededReplay.current_records.some((record) => record.record_sha256 === decision.record_sha256), false);
assert.equal(supersededReplay.current_records.some((record) => record.record_sha256 === supersedingDecision.record_sha256), true);

const snapshot = compileMemorySnapshot({
  binding,
  replay,
  projectMap,
  derivedIndex,
  observedAtUtc: "2026-08-06T12:00:00.000Z",
});
assert.equal(snapshot.status, "READY");
assert.equal(snapshot.context_record_sha256, context.record_sha256);
assert.equal(snapshot.project_map_sha256, projectMap.map_sha256);
assert.equal(snapshot.derived_index_sha256, derivedIndex.index_sha256);
assert.doesNotThrow(() => validateMemorySnapshot(snapshot, {binding}));

const invalidatedContextV2 = compileProjectContextRecord({
  recordId: context.record_id,
  recordVersion: 2,
  binding,
  status: "INVALIDATED",
  supersedesRecordSha256: context.record_sha256,
  contextInputSha256: makeDigest("context-input-v2"),
  intentSha256: makeDigest("intent-v2"),
  planSha256: makeDigest("plan-v2"),
  governanceSha256: makeDigest("governance-v2"),
  boundarySha256: makeDigest("boundary-v2"),
});
const invalidatedContextEvent = compileMemoryEvent({
  eventId: "EVENT-CONTEXT-INVALIDATED",
  idempotencyKey: "CONTEXT-INVALIDATED",
  sequence: events.length,
  eventType: "RECORD_INVALIDATED",
  record: invalidatedContextV2,
  priorEventSha256: events.at(-1).event_sha256,
});
const invalidatedContextSnapshot = compileMemorySnapshot({
  binding,
  replay: replayMemoryLedger([...events, invalidatedContextEvent], {binding}),
  observedAtUtc: "2026-08-06T12:00:00.050Z",
});
assert.equal(invalidatedContextSnapshot.status, "UNAVAILABLE");
assert.equal(invalidatedContextSnapshot.context_record_sha256, null);

const staleProjectMap = compileProjectMap({
  mapId: "MAP-STALE",
  projectRef: binding.project_ref,
  campaignRef: binding.campaign_ref,
  goalRef: binding.goal_ref,
  mapKind: "COMPOSITE",
  roleScope: [binding.role_ref],
  sourceCommit: binding.source_commit,
  sourceTree: binding.source_tree,
  sourceSnapshotSha256: binding.source_snapshot_sha256,
  policySha256: binding.policy_sha256,
  nodes: projectMap.nodes,
  edges: [],
  selectedRoots: ["PROJECT-1"],
  staleSourceDigests: [makeDigest("stale-map-source")],
});
assert.throws(
  () => compileMemorySnapshot({
    binding,
    replay,
    projectMap: staleProjectMap,
    derivedIndex,
    observedAtUtc: "2026-08-06T12:00:00.500Z",
  }),
  /invalidation record/u,
);

const snapshotWrite = writeProjectMemorySnapshotCompareAndSwap({authorityRoot, snapshot});
assert.equal(snapshotWrite.status, "UPDATED");
assert.equal(readProjectMemorySnapshot({authorityRoot}).snapshot_sha256, snapshot.snapshot_sha256);
const snapshotReplay = writeProjectMemorySnapshotCompareAndSwap({
  authorityRoot,
  expectedSnapshotSha256: snapshot.snapshot_sha256,
  snapshot,
});
assert.equal(snapshotReplay.status, "IDEMPOTENT_REPLAY");
const changedSnapshot = compileMemorySnapshot({
  binding,
  replay,
  projectMap,
  derivedIndex,
  observedAtUtc: "2026-08-06T12:00:01.000Z",
});
assert.throws(
  () => writeProjectMemorySnapshotCompareAndSwap({authorityRoot, expectedSnapshotSha256: "1".repeat(64), snapshot: changedSnapshot}),
  (error) => error.code === "SNAPSHOT_CAS_MISMATCH",
);

const capsule = compileRoleContextCapsule({
  snapshot,
  roleRef: "ORCHESTRATOR",
  laneRef: "PROJECT_MEMORY",
  selectedRecordSha256s: [context.record_sha256, goal.record_sha256, decision.record_sha256].sort(),
  allowedScopeRefs: ["PROJECT_MEMORY", "ROLE_CAPSULE"],
  prohibitedScopeRefs: ["ACTIVATION", "PRODUCT_WRITE", "TRANSCRIPT"],
  requiredEvidenceSha256s: [handoff.body.result_sha256],
});
assert.equal(capsule.status, "READY");
assert.equal(capsule.acceptance_authority, false);
assert.equal(scanPersistedRecord(capsule).safe, true);
assert.throws(
  () => compileRoleContextCapsule({
    snapshot,
    roleRef: "ORCHESTRATOR",
    laneRef: "PROJECT_MEMORY",
    selectedRecordSha256s: [context.record_sha256],
    allowedScopeRefs: ["PROJECT_MEMORY"],
    prohibitedScopeRefs: ["PROJECT_MEMORY"],
  }),
  /scopes must be disjoint/u,
);

const forgedReplaySnapshot = compileMemorySnapshot({
  binding,
  replay: {...replay, event_count: 0, head_sha256: GENESIS_EVENT_SHA256, current_records: []},
  observedAtUtc: "2026-08-06T12:00:00.100Z",
});
assert.equal(forgedReplaySnapshot.event_cursor, replay.event_count);
assert.equal(forgedReplaySnapshot.event_ledger_head_sha256, replay.head_sha256);
assert.throws(
  () => compileMemorySnapshot({binding, replay: {...replay, events: undefined}, observedAtUtc: "2026-08-06T12:00:00.200Z"}),
  /memory replay events are required/u,
);

const invalidations = compileMemoryInvalidationSet({
  binding,
  changes: [{
    trigger: "SOURCE_CHANGED",
    reasonCode: "SOURCE_READBACK_CHANGED",
    affectedRecordSha256s: [context.record_sha256, mapRef.record_sha256].sort(),
    affectedCapsuleSha256s: [capsule.capsule_sha256],
    action: "STOP",
    oldValueSha256: binding.source_snapshot_sha256,
    newValueSha256: "f".repeat(64),
  }],
});
assert.equal(invalidations.length, 1);
appendRecord(invalidations[0]);
const staleReplay = reconstructProjectMemory({authorityRoot, binding});
const staleSnapshot = compileMemorySnapshot({
  binding,
  replay: staleReplay,
  observedAtUtc: "2026-08-06T12:01:00.000Z",
});
assert.equal(staleSnapshot.status, "STALE");
assert.ok(staleSnapshot.invalidation_sha256s.includes(invalidations[0].record_sha256));
const staleCapsule = compileRoleContextCapsule({
  snapshot: staleSnapshot,
  roleRef: "ORCHESTRATOR",
  laneRef: "PROJECT_MEMORY",
  selectedRecordSha256s: [context.record_sha256],
  allowedScopeRefs: ["PROJECT_MEMORY"],
  prohibitedScopeRefs: ["PRODUCT_WRITE"],
});
assert.equal(staleCapsule.status, "STALE");

const idempotentEvent = events[0];
const idempotent = appendProjectMemoryEvent({
  authorityRoot,
  expectedHeadSha256: "1".repeat(64),
  event: idempotentEvent,
});
assert.equal(idempotent.status, "IDEMPOTENT_REPLAY");

const staleEvent = compileMemoryEvent({
  eventId: "EVENT-STALE",
  idempotencyKey: "STALE-KEY",
  sequence: events.length,
  record: compileGoalRecord({
    recordId: "GOAL-2",
    binding,
    goalSha256: makeDigest("goal-2"),
    goalKind: "BOUNDED_LANE",
    scopeSha256: makeDigest("scope-2"),
    acceptanceSha256: makeDigest("acceptance-2"),
  }),
  priorEventSha256: "1".repeat(64),
});
assert.throws(
  () => appendProjectMemoryEvent({authorityRoot, expectedHeadSha256: "1".repeat(64), event: staleEvent}),
  (error) => error.code === "CAS_MISMATCH",
);

const conflictingGoal = compileGoalRecord({
  recordId: "GOAL-1",
  binding,
  recordVersion: 1,
  goalSha256: makeDigest("different-goal"),
  goalKind: "BOUNDED_LANE",
  scopeSha256: makeDigest("scope-different"),
  acceptanceSha256: makeDigest("acceptance-different"),
});
const conflictRecord = compileMemoryConflictRecord({
  recordId: "CONFLICT-1",
  binding,
  conflictKey: "GOAL:GOAL-1:1",
  leftRecordSha256: goal.record_sha256,
  rightRecordSha256: conflictingGoal.record_sha256,
});
assert.equal(conflictRecord.status, "CONFLICT");
const conflictingEvent = compileMemoryEvent({
  eventId: "EVENT-CONFLICT",
  idempotencyKey: "CONFLICT-KEY",
  sequence: events.length,
  record: conflictingGoal,
  priorEventSha256: events.at(-1).event_sha256,
});
assert.throws(
  () => appendProjectMemoryEvent({authorityRoot, expectedHeadSha256: events.at(-1).event_sha256, event: conflictingEvent}),
  (error) => error.code === "RECORD_CONFLICT",
);
appendRecord(conflictRecord, "CONFLICT_RECORDED", "CONFLICT-RECORDED");
const conflictReplay = reconstructProjectMemory({authorityRoot, binding});
assert.equal(conflictReplay.status, "CONFLICT");
assert.equal(conflictReplay.conflicts.length, 1);
assert.equal(conflictReplay.current_records.some((record) => record.record_type === "CONFLICT"), true);

const privateRecordInput = () => compileProjectContextRecord({
  recordId: "CONTEXT-PRIVATE",
  binding,
  contextInputSha256: makeDigest("context-private"),
  intentSha256: makeDigest("intent-private"),
  planSha256: makeDigest("plan-private"),
  governanceSha256: makeDigest("governance-private"),
  boundarySha256: makeDigest("boundary-private"),
  uncertainties: [{code: "LEAK", subject_ref: null, detail: ["/", "synthetic", "/", "absolute", "/", "path"].join("")}],
});
assert.throws(privateRecordInput, /privacy-safe|ABSOLUTE_PATH/u);

const transcriptRecordInput = () => compileProjectContextRecord({
  recordId: "CONTEXT-TRANSCRIPT",
  binding,
  contextInputSha256: makeDigest("context-transcript"),
  intentSha256: makeDigest("intent-transcript"),
  planSha256: makeDigest("plan-transcript"),
  governanceSha256: makeDigest("governance-transcript"),
  boundarySha256: makeDigest("boundary-transcript"),
  transcript: "not accepted",
});
assert.throws(transcriptRecordInput, /options are not permitted|fields mismatch/u);

const tampered = structuredClone(events[0]);
tampered.record.body.intent_sha256 = "1".repeat(64);
assert.throws(() => validateMemoryEvent(tampered), /digest mismatch|memory record/u);

const tamperedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-project-memory-tampered-"));
fs.mkdirSync(path.join(tamperedRoot, "ledgers"));
fs.copyFileSync(path.join(authorityRoot, "ledgers/project-memory-events.jsonl"), path.join(tamperedRoot, "ledgers/project-memory-events.jsonl"));
const tamperedLedgerPath = path.join(tamperedRoot, "ledgers/project-memory-events.jsonl");
const tamperedLedger = fs.readFileSync(tamperedLedgerPath, "utf8").replace(/"event_sha256":"[0-9a-f]{64}"/u, `"event_sha256":"${"1".repeat(64)}"`);
fs.writeFileSync(tamperedLedgerPath, tamperedLedger);
assert.throws(() => readProjectMemoryLedger({authorityRoot: tamperedRoot}), /digest mismatch/u);
fs.rmSync(tamperedRoot, {recursive: true, force: true});

const symlinkTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-project-memory-symlink-"));
fs.symlinkSync(symlinkTarget, path.join(authorityRoot, "unsafe"), "dir");
assert.throws(() => readProjectMemoryLedger({authorityRoot, relativePath: "unsafe/events.jsonl"}), /unsafe directory/u);
fs.unlinkSync(path.join(authorityRoot, "unsafe"));
fs.rmSync(symlinkTarget, {recursive: true, force: true});

const mismatchedBinding = {...binding, source_tree: "f".repeat(40)};
assert.throws(() => readProjectMemoryLedger({authorityRoot, binding: mismatchedBinding}), /memory ledger scope mismatch/u);

fs.rmSync(authorityRoot, {recursive: true, force: true});
console.log("PASS project memory: canonical records, CAS/idempotent append, restart replay, snapshots, capsules, invalidation, conflicts, privacy, and hostile cases verified");
