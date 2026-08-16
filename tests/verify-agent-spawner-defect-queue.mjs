#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileAgentSpawnerDefectIntake} from "../control/agent-spawner-defect-intake.mjs";
import {
  appendAgentSpawnerDefectQueueRecord,
  compileAgentSpawnerDefectQueue,
  readAgentSpawnerDefectQueue,
  validateAgentSpawnerDefectQueue,
  writeAgentSpawnerDefectQueueCompareAndSwap,
} from "../control/agent-spawner-defect-queue.mjs";

const hash = (value) => canonicalDigest({value});
const sourceBinding = {candidate_sha256: hash("candidate"), context_sha256: hash("context"), roster_projection_sha256: hash("roster"), source_identity_sha256: hash("source")};
const makeIntake = (defectId) => compileAgentSpawnerDefectIntake({
  defectId,
  defectKind: "QA_FINDING",
  sourceBinding,
  evidenceRefs: [{evidence_id: `EVIDENCE.${defectId}`, kind: "HOST_READBACK", reference: `opaque:${defectId.toLowerCase()}`, sha256: hash(defectId)}],
  observation: {summary: "A route did not persist its next action.", expected: "The successor route is durable.", observed: "The successor route was not durable.", observed_at_utc: "2026-08-16T22:00:00.000Z", details_sha256: hash(`details:${defectId}`)},
  classification: "REPAIRABLE_GATE_GAP",
  rootCause: {category: "MISSING_DURABLE_ROUTE", statement: "The route lacked a durable queue record.", evidence_class: "OBSERVED"},
  blockId: "BLOCK.QUEUE.PERSISTENCE",
  gateId: "GATE.QUEUE.CAS",
  graphId: "GRAPH.SPAWNER",
});

const first = makeIntake("DEFECT.QUEUE.001");
const second = makeIntake("DEFECT.QUEUE.002");
const queue = compileAgentSpawnerDefectQueue({queueId: "QUEUE.SPAWNER.DEFECTS", entries: [second, first]});
assert.deepEqual(queue.entries.map((entry) => entry.defect_id), ["DEFECT.QUEUE.001", "DEFECT.QUEUE.002"]);
validateAgentSpawnerDefectQueue(queue);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-spawner-defect-queue-"));
const recordPath = "state/spawner-defect-queue.json";
try {
  const initial = writeAgentSpawnerDefectQueueCompareAndSwap({authorityRoot: root, recordPath, expectedQueueSha256: null, queue});
  assert.equal(initial.queue_sha256, queue.queue_sha256);
  assert.equal(readAgentSpawnerDefectQueue({authorityRoot: root, recordPath}).entry_count, 2);
  assert.throws(() => writeAgentSpawnerDefectQueueCompareAndSwap({authorityRoot: root, recordPath, expectedQueueSha256: "0".repeat(64), queue}), /parent is stale/u);
  const appended = appendAgentSpawnerDefectQueueRecord({authorityRoot: root, recordPath, expectedQueueSha256: queue.queue_sha256, intake: makeIntake("DEFECT.QUEUE.003")});
  assert.equal(appended.entry_count, 3);
  const readback = readAgentSpawnerDefectQueue({authorityRoot: root, recordPath});
  assert.deepEqual(readback.entries.map((entry) => entry.defect_id), ["DEFECT.QUEUE.001", "DEFECT.QUEUE.002", "DEFECT.QUEUE.003"]);
  assert.throws(() => appendAgentSpawnerDefectQueueRecord({authorityRoot: root, recordPath, expectedQueueSha256: readback.queue_sha256, intake: first}), /already contains/u);
  assert.throws(() => readAgentSpawnerDefectQueue({authorityRoot: root, recordPath: "../escape.json"}), /parent traversal/u);
  const linked = `${root}-link`;
  fs.symlinkSync(root, linked, "dir");
  try { assert.throws(() => readAgentSpawnerDefectQueue({authorityRoot: linked, recordPath}), /authority root must be a real directory/u); }
  finally { fs.rmSync(linked, {force: true}); }
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS Agent Spawner defect queue: typed sorting, duplicate rejection, digest-CAS persistence, append custody, path confinement, and hostile symlink coverage");
