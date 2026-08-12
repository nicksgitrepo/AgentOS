#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acceptBootstrapReply,
  createBootstrapConversation,
  nextBootstrapQuestion,
} from "../control/bootstrap-conversation.mjs";
import {compileProjectContract} from "../control/bootstrap-project-contract.mjs";
import {
  compileHandoffRecord,
  compileMemoryEvent,
  compileMemorySnapshot,
} from "../control/project-memory.mjs";
import {compileProjectMemoryCapsule} from "../control/project-memory-capsule.mjs";
import {
  appendProjectMemoryEvent,
  readProjectMemoryLedger,
  recoverProjectMemoryLock,
  writeProjectMemorySnapshotCompareAndSwap,
} from "../control/project-memory-store.mjs";
import {
  compileProjectMemoryArtifact,
  writeProjectMemoryArtifact,
} from "../control/project-memory-artifacts.mjs";
import {
  assertProjectMemoryRuntimeReady,
  compileBootstrapProjectMemoryBinding,
  compileProjectMemoryTaskContext,
  createProjectMemoryRuntime,
  importProjectMemoryCapsuleAuthoritatively,
  initializeBootstrapProjectMemory,
} from "../control/project-memory-runtime.mjs";
import {canonicalDigest, canonicalJson} from "../control/content-addressing.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const operationalSchemas = Object.fromEntries([
  "project-memory-artifact.v1.json",
  "project-memory-runtime.v1.json",
  "project-memory-task-context.v1.json",
  "project-memory-capsule-import-receipt.v1.json",
].map((name) => [name, JSON.parse(fs.readFileSync(path.join(repositoryRoot, "schemas", name), "utf8"))]));

function assertSchemaKeyParity(value, schemaName) {
  const schema = operationalSchemas[schemaName];
  assert(schema, `missing operational schema ${schemaName}`);
  assert.equal(schema.$id, `agentos.${schemaName.replace(/-/gu, "_").replace(/\.json$/u, "")}`);
  assert.deepEqual(Object.keys(value).sort(), [...schema.required].sort(), `${schemaName} and runtime fields differ`);
}

const answers = {
  "intent.audience": "A small planning team",
  "intent.outcome": "Keep one bounded plan current across restarts",
  "intent.first_result": "A reviewable first plan",
  "project.starting_point": "1",
  "scope.allowed": "The agreed planning workflow",
  "scope.non_goals": "Unrelated delivery work",
  "project.capabilities": "10",
  "workflow.steps": "Understand, build, check, and hand off",
  "technology.constraints": "Portable local tools",
  "operations.conditions": "Restart-safe small-team operation",
  "quality.priorities": "1",
  "boundaries.hard": "Stop at protected actions",
  "boundaries.soft": "Reassess material intent changes",
  "governance.memory": "yes",
  "delivery.finish": "1",
  "acceptance.conditions": "The current plan is restored after restart",
};

let conversation = createBootstrapConversation({projectRef: "memory-demo"});
while (nextBootstrapQuestion(conversation) !== null) {
  const question = nextBootstrapQuestion(conversation);
  const accepted = acceptBootstrapReply(conversation, {questionId: question.question_id, reply: answers[question.question_id]});
  assert.equal(accepted.accepted, true, accepted.error?.message);
  conversation = accepted.session;
}
const projectContract = compileProjectContract({conversation});
assert.equal(projectContract.status, "READY");

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-memory-project-"));
const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-memory-authority-"));
const importRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-memory-import-"));
const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-memory-malformed-"));
const divergentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-memory-divergent-"));

try {
  const binding = compileBootstrapProjectMemoryBinding({
    projectContract,
    campaignRef: "MEMORY_CAMPAIGN",
    goalRef: "MEMORY_GOAL",
    roleRef: "ORCHESTRATOR",
    sourceCommit: "a".repeat(40),
    sourceTree: "b".repeat(40),
  });
  const initialized = initializeBootstrapProjectMemory({
    projectContract,
    observedAtUtc: "2026-08-11T00:00:00.000Z",
    authorityRoot,
    repositoryRoot: projectRoot,
    binding,
  });
  assert.equal(initialized.capture.status, "CAPTURED");
  assertSchemaKeyParity(initialized.state, "project-memory-runtime.v1.json");
  assertProjectMemoryRuntimeReady(initialized.state);
  assert(initialized.state.semantic_context.length >= 8, "Bootstrap semantics were not hydrated");
  assert.equal(initialized.state.snapshot_disposition, "REBUILT_FROM_LEDGER");
  assert.deepEqual(fs.readdirSync(projectRoot), [], "project-memory wrote into the project tree");
  const taskContext = compileProjectMemoryTaskContext({
    memoryState: initialized.state,
    taskRefSha256: canonicalDigest({task: "memory-consumer"}),
    goalRefSha256: canonicalDigest({goal: "restore-current-plan"}),
    capturedAtUtc: "2026-08-11T00:00:30.000Z",
  });
  assert.equal(taskContext.status, "READY");
  assertSchemaKeyParity(taskContext, "project-memory-task-context.v1.json");
  assert.equal(taskContext.items.length, initialized.state.semantic_context.length);
  assert(taskContext.items.every((item) => item.authority === "MEMORY_AUTHORITY" && item.content_class === "MEMORY_RECORD" && item.memory_authorized));
  assert.equal(taskContext.transient_payloads.length, taskContext.items.length);

  const restarted = createProjectMemoryRuntime({authorityRoot, repositoryRoot: projectRoot, binding});
  const wrongBinding = {...binding, role_ref: "AUDITOR"};
  const wrongSnapshot = compileMemorySnapshot({
    binding: wrongBinding,
    replay: {events: []},
    observedAtUtc: "2026-08-11T00:00:45.000Z",
  });
  writeProjectMemorySnapshotCompareAndSwap({
    authorityRoot,
    repositoryRoot: projectRoot,
    expectedSnapshotSha256: initialized.state.snapshot.snapshot_sha256,
    snapshot: wrongSnapshot,
  });
  const restartState = restarted.loadCurrent({observedAtUtc: "2026-08-11T00:01:00.000Z"});
  assertProjectMemoryRuntimeReady(restartState);
  assert.equal(restartState.snapshot_disposition, "REBUILT_FROM_LEDGER");
  assert.notEqual(restartState.snapshot.snapshot_sha256, wrongSnapshot.snapshot_sha256);
  assert.equal(restartState.snapshot.role_ref, binding.role_ref);
  assert.equal(restartState.snapshot.event_ledger_head_sha256, initialized.state.ledger_head_sha256);
  assert.deepEqual(restartState.semantic_context, initialized.state.semantic_context);

  const handoffArtifact = compileProjectMemoryArtifact({
    artifactKind: "RUNTIME_HANDOFF",
    scopeRef: "PROJECT_CONTEXT",
    projectRef: binding.project_ref,
    payload: {schema: "agentos.runtime_handoff_payload.v1", result: "BOOTSTRAP_MEMORY_READY"},
  });
  assertSchemaKeyParity(handoffArtifact, "project-memory-artifact.v1.json");
  writeProjectMemoryArtifact({authorityRoot, repositoryRoot: projectRoot, artifact: handoffArtifact});
  const beforeHandoff = readProjectMemoryLedger({authorityRoot, repositoryRoot: projectRoot, binding});
  const handoff = compileHandoffRecord({
    recordId: "BOOTSTRAP_RUNTIME_HANDOFF",
    binding,
    handoffKind: "BOOTSTRAP_RUNTIME",
    nextActionRef: "START_PROJECT_RUNTIME",
    resultSha256: handoffArtifact.payload_sha256,
  });
  const handoffEvent = compileMemoryEvent({
    eventId: `MEMORY_EVENT_${handoff.record_sha256}`,
    idempotencyKey: `MEMORY_APPEND_${handoff.record_sha256}`,
    sequence: beforeHandoff.event_count,
    record: handoff,
    priorEventSha256: beforeHandoff.head_sha256,
  });
  appendProjectMemoryEvent({
    authorityRoot,
    repositoryRoot: projectRoot,
    expectedHeadSha256: beforeHandoff.head_sha256,
    event: handoffEvent,
  });
  const refreshed = restarted.loadCurrent({observedAtUtc: "2026-08-11T00:02:00.000Z"});
  assertProjectMemoryRuntimeReady(refreshed);
  assert.equal(refreshed.snapshot_disposition, "REBUILT_FROM_LEDGER");
  assert.notEqual(refreshed.snapshot.snapshot_sha256, restartState.snapshot.snapshot_sha256, "stale snapshot was returned as current");
  assert(refreshed.semantic_context.some((entry) => entry.artifact.payload_sha256 === handoffArtifact.payload_sha256));

  const portable = compileProjectMemoryCapsule({
    binding,
    events: refreshed.replay.events,
    snapshot: refreshed.snapshot,
    roleCapsules: [refreshed.capsule],
  });
  const imported = importProjectMemoryCapsuleAuthoritatively({
    capsule: portable,
    authorityRoot: importRoot,
    repositoryRoot: projectRoot,
  });
  assert.equal(imported.status, "IMPORTED");
  assertSchemaKeyParity(imported, "project-memory-capsule-import-receipt.v1.json");
  assert.equal(imported.destination_head_sha256, refreshed.ledger_head_sha256);
  const importedAgain = importProjectMemoryCapsuleAuthoritatively({
    capsule: portable,
    authorityRoot: importRoot,
    repositoryRoot: projectRoot,
  });
  assert.equal(importedAgain.status, "IDEMPOTENT_REPLAY");
  const referenceOnlyState = createProjectMemoryRuntime({authorityRoot: importRoot, repositoryRoot: projectRoot, binding})
    .loadCurrent({observedAtUtc: "2026-08-11T00:02:30.000Z"});
  assert.equal(referenceOnlyState.status, "PARTIAL", "a reference-only capsule must not claim hydrated readiness");
  assert(referenceOnlyState.capsule.uncertainties.some((notice) => notice.code === "SEMANTIC_ARTIFACT_UNAVAILABLE"));
  for (const entry of refreshed.semantic_context) {
    writeProjectMemoryArtifact({authorityRoot: importRoot, repositoryRoot: projectRoot, artifact: entry.artifact});
  }
  const importedRuntime = createProjectMemoryRuntime({authorityRoot: importRoot, repositoryRoot: projectRoot, binding});
  const importedState = importedRuntime.loadCurrent({observedAtUtc: "2026-08-11T00:03:00.000Z"});
  assertProjectMemoryRuntimeReady(importedState);
  assert.deepEqual(importedState.semantic_context, refreshed.semantic_context);

  const divergentRecord = compileHandoffRecord({
    recordId: "DIVERGENT_DESTINATION",
    binding,
    handoffKind: "DIVERGENT_TEST",
    nextActionRef: "STOP",
    resultSha256: canonicalDigest({result: "different-history"}),
  });
  appendProjectMemoryEvent({
    authorityRoot: divergentRoot,
    repositoryRoot: projectRoot,
    expectedHeadSha256: "0".repeat(64),
    event: compileMemoryEvent({
      eventId: `MEMORY_EVENT_${divergentRecord.record_sha256}`,
      idempotencyKey: `MEMORY_APPEND_${divergentRecord.record_sha256}`,
      sequence: 0,
      record: divergentRecord,
      priorEventSha256: "0".repeat(64),
    }),
  });
  assert.throws(
    () => importProjectMemoryCapsuleAuthoritatively({capsule: portable, authorityRoot: divergentRoot, repositoryRoot: projectRoot}),
    /diverges/iu,
    "an authoritative import must reject divergent destination history",
  );

  const ledgerDirectory = path.join(importRoot, "ledgers");
  const lock = {
    schema: "agentos.project_memory_lock.v1",
    version: 1,
    process_id: 2147483647,
    operation: "APPEND_LEDGER",
    target_relative_path: "ledgers/project-memory-events.jsonl",
    acquired_at_utc: "2026-08-11T00:04:00.000Z",
    lock_sha256: null,
  };
  lock.lock_sha256 = canonicalDigest({...lock, lock_sha256: null});
  fs.writeFileSync(path.join(ledgerDirectory, "project-memory-events.jsonl.lock"), `${canonicalJson(lock)}\n`, {mode: 0o600});
  const recovered = recoverProjectMemoryLock({authorityRoot: importRoot, repositoryRoot: projectRoot});
  assert.equal(recovered.status, "RECOVERED_PROVEN_DEAD_PROCESS");
  assert.equal(recovered.lock_sha256, lock.lock_sha256);
  assert(fs.existsSync(path.join(importRoot, recovered.recovered_lock_path)), "recovered lock evidence was not preserved");

  fs.mkdirSync(path.join(malformedRoot, "ledgers"), {recursive: true});
  fs.writeFileSync(path.join(malformedRoot, "ledgers/project-memory-events.jsonl.lock"), "LOCKED\n", {mode: 0o600});
  assert.throws(
    () => recoverProjectMemoryLock({authorityRoot: malformedRoot, repositoryRoot: projectRoot}),
    (error) => error?.code === "LOCK_RECOVERY_UNPROVEN",
    "malformed crash evidence must fail closed",
  );
  fs.unlinkSync(path.join(malformedRoot, "ledgers/project-memory-events.jsonl.lock"));
  const liveLock = {...lock, process_id: process.pid, lock_sha256: null};
  liveLock.lock_sha256 = canonicalDigest({...liveLock, lock_sha256: null});
  fs.writeFileSync(path.join(malformedRoot, "ledgers/project-memory-events.jsonl.lock"), `${canonicalJson(liveLock)}\n`, {mode: 0o600});
  assert.throws(
    () => recoverProjectMemoryLock({authorityRoot: malformedRoot, repositoryRoot: projectRoot}),
    (error) => error?.code === "LEDGER_LOCKED",
    "a live lock owner must not be recovered",
  );

  assert.throws(() => compileProjectMemoryArtifact({
    artifactKind: "UNSAFE",
    scopeRef: "PROJECT_CONTEXT",
    projectRef: binding.project_ref,
    payload: {credential: "api_key=do-not-store"},
  }), /privacy|secret|credential/iu);
  assert.deepEqual(fs.readdirSync(projectRoot), [], "runtime/import/recovery wrote into the project tree");
  console.log("PASS project-memory runtime: Bootstrap capture, semantic hydration, stale-snapshot rebuild, restart, authoritative capsule import, privacy, external isolation, and proven-dead lock recovery verified");
} finally {
  for (const target of [projectRoot, authorityRoot, importRoot, malformedRoot, divergentRoot]) fs.rmSync(target, {recursive: true, force: true});
}
