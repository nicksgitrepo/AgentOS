#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileTypedSuccessorReadback,
  readTypedSuccessorReadback,
  validateTypedSuccessorReadback,
  writeTypedSuccessorReadbackCompareAndSwap,
} from "../control/typed-successor-readback.mjs";

const sha = (value) => canonicalDigest({value});
const boundary = {active_lane_count: 2, lane_limit: 6, heavyweight_process_count: 0, heavyweight_process_limit: 1, wave_activation: "OFF"};
const entries = [
  {entry_id: "ENTRY.API", record_sha256: sha("api"), authority_status: "CURRENT", collection_status: "COLLECTED", slot_status: "RELEASED"},
  {entry_id: "ENTRY.UX", record_sha256: sha("ux"), authority_status: "CURRENT", collection_status: "COLLECTED", slot_status: "RELEASED"},
];
const record = compileTypedSuccessorReadback({successorId: "SUCCESSOR.REVIEW.001", state: "ACTIVE", nextAction: "START_PLATFORM_REVIEW", nextHandler: "HANDLER.PLATFORM_REVIEW", entries, resourceBoundary: boundary});
validateTypedSuccessorReadback(record);
assert.equal(record.accepted_current_authority_count, 2);
assert.equal(record.collected_count, 2);
assert.equal(record.released_slot_count, 2);
assert.notEqual(record.readback_sha256, null);

const staleCount = structuredClone(record);
staleCount.accepted_current_authority_count = 0;
assert.throws(() => validateTypedSuccessorReadback(staleCount), /accepted count diverges/u);
const divergentReadback = structuredClone(record);
divergentReadback.readback.collected_count = 0;
assert.throws(() => validateTypedSuccessorReadback(divergentReadback), /semantic readback diverges/u);
const nullReadback = structuredClone(record);
nullReadback.readback_sha256 = null;
assert.throws(() => validateTypedSuccessorReadback(nullReadback), /semantic readback digest must be/u);
const mismatchedReadbackDigest = structuredClone(record);
mismatchedReadbackDigest.readback_sha256 = "0".repeat(64);
assert.throws(() => validateTypedSuccessorReadback(mismatchedReadbackDigest), /semantic readback digest mismatch/u);
assert.throws(() => compileTypedSuccessorReadback({successorId: "SUCCESSOR.REVIEW.002", parentSuccessorSha256: record.successor_sha256, parentNextAction: "START_PLATFORM_REVIEW", transitionSequence: 1, state: "ACTIVE", nextAction: "START_PLATFORM_REVIEW", nextHandler: "HANDLER.PLATFORM_REVIEW", entries: [], resourceBoundary: boundary}), /zero-progress loop/u);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-typed-successor-"));
try {
  const result = writeTypedSuccessorReadbackCompareAndSwap({authorityRoot: root, recordPath: "state/successor.json", expectedSuccessorSha256: null, record});
  assert.equal(result.readback_sha256, record.readback_sha256);
  assert.equal(readTypedSuccessorReadback({authorityRoot: root, recordPath: "state/successor.json"}).successor_sha256, record.successor_sha256);
  assert.throws(() => writeTypedSuccessorReadbackCompareAndSwap({authorityRoot: root, recordPath: "state/successor.json", expectedSuccessorSha256: sha("stale"), record}), /parent is stale/u);
  assert.throws(() => readTypedSuccessorReadback({authorityRoot: root, recordPath: "../escape.json"}), /parent traversal/u);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS typed semantic successor readback: atomic CAS, derived queue counts, non-null semantic digest, no-op rejection, and hostile divergence coverage");
