#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  DELIVERY_CLOSURE_LIFECYCLE,
  completeTemporaryWorker,
  compileClosureReceipt,
} from "../../control/rapid-prototype/delivery-closure.mjs";
import {canonicalDigest} from "../../control/content-addressing.mjs";

const NOW = "2026-08-04T12:00:00.000Z";
const THREAD_ID = "thread-1";
const HOST_ID = "host-1";
const closeoutEvidenceBindings = new Map();
function closeoutEvidenceRef(step) {
  const payload = {kind: "rapid-delivery-closure-test", step};
  const receipt_sha256 = canonicalDigest(payload);
  const reference = `digest:${receipt_sha256}`;
  closeoutEvidenceBindings.set(reference, {payload, receipt_sha256, status: "PROVEN"});
  return reference;
}
const CLOSEOUT_EVIDENCE = Object.freeze({
  PERSIST_HANDOFF: closeoutEvidenceRef("PERSIST_HANDOFF"),
  AUDIT_CANDIDATE: closeoutEvidenceRef("AUDIT_CANDIDATE"),
  INTEGRATE_ACCEPTED_WORK: closeoutEvidenceRef("INTEGRATE_ACCEPTED_WORK"),
  CLOSE_STALE_WORKTREE: closeoutEvidenceRef("CLOSE_STALE_WORKTREE"),
  REMOVE_ACTIVE_TASK_SCOPE: closeoutEvidenceRef("REMOVE_ACTIVE_TASK_SCOPE"),
  MARK_CHAT_OUT_OF_SCOPE: closeoutEvidenceRef("MARK_CHAT_OUT_OF_SCOPE"),
});
const closeoutEvidenceResolver = (reference, {authority}) => ({...closeoutEvidenceBindings.get(reference), authority});

function makeHandoff(overrides = {}) {
  return {
    schema: "DELIVERY_AND_CLOSURE_HANDOFF_V1",
    status: "READY_FOR_INDEPENDENT_CLEARANCE",
    public_lane: "Delivery and closure",
    task_scope: {
      in_scope: ["local review"],
      out_of_scope: ["external delivery"],
      changed_paths: ["control/rapid-prototype/delivery-closure.mjs", "tests/rapid-prototype/delivery-closure.mjs"],
    },
    source_binding: {
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      result: "MATCH",
    },
    progress: {
      state: "MEANINGFUL",
      summary: "Closure behavior and its focused check are ready for independent review.",
    },
    result: {
      local_review: "READY",
      external_effects: "NONE",
    },
    independent_check: {
      status: "REQUESTED",
      evidence_digest: null,
    },
    closure: {
      handoff_preserved: false,
      temporary_work: "PENDING",
      active_temporary_count: 1,
      receipt_digest: null,
    },
    iteration: {items: []},
    open_risks: ["Independent check remains outstanding."],
    next_handoff: "FOUNDATION_CLEARANCE",
    clearance: "NOT_CLAIMED",
    ...overrides,
  };
}

function makeRoster() {
  return [{
    threadId: THREAD_ID,
    hostId: HOST_ID,
    active: true,
    pinned: true,
    archived: false,
    status: "ACTIVE",
  }];
}

function makeHost(calls, {pin = {}, archive = {}} = {}) {
  return {
    async set_thread_pinned(payload) {
      calls.push(["set_thread_pinned", structuredClone(payload)]);
      if (pin.throw) throw new Error("pin failure");
      return {threadId: payload.threadId, pinned: false, operation: "set_thread_pinned"};
    },
    async set_thread_archived(payload) {
      calls.push(["set_thread_archived", structuredClone(payload)]);
      if (archive.throw) throw new Error("archive failure");
      return {threadId: payload.threadId, hostId: payload.hostId, archived: true, operation: "set_thread_archived"};
    },
    async list_threads() {
      calls.push(["list_threads", {}]);
      return {operation: "list_threads", active_roster: []};
    },
  };
}

const handoff = makeHandoff();
const calls = [];
const roster = makeRoster();
const result = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff,
  activeRoster: roster,
  host: makeHost(calls),
  universalCloseoutEvidence: CLOSEOUT_EVIDENCE,
  universalCloseoutReceiptResolver: closeoutEvidenceResolver,
});
assert.equal(result.status, "CLOSED");
assert.deepEqual(calls, [
  ["set_thread_pinned", {threadId: THREAD_ID, pinned: false}],
  ["set_thread_archived", {threadId: THREAD_ID, hostId: HOST_ID, archived: true}],
  ["list_threads", {}],
]);
assert.equal(roster.length, 1, "caller-owned roster data must not be mutated as proof");
assert.equal(result.active_roster.length, 0);
assert.equal(result.receipt.status, "CLOSED");
assert.equal(result.receipt.handoff_preserved, true);
assert.equal(result.receipt.active_workers_for_worker, 0);
assert.deepEqual(result.lifecycle, DELIVERY_CLOSURE_LIFECYCLE);
assert.equal(result.receipt.preservation_receipt_sha256.length, 64);
assert.equal(result.receipt.receipt_sha256.length, 64);

const unpinFailureCalls = [];
const unpinFailure = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff: makeHandoff(),
  activeRoster: makeRoster(),
  host: makeHost(unpinFailureCalls, {pin: {throw: true}}),
  universalCloseoutEvidence: CLOSEOUT_EVIDENCE,
  universalCloseoutReceiptResolver: closeoutEvidenceResolver,
});
assert.equal(unpinFailure.status, "HARD_STOP");
assert.equal(unpinFailure.code, "HOST_FAILURE");
assert.equal(unpinFailure.phase, "UNPIN");
assert.equal(unpinFailure.preserved_handoff, true);
assert.equal(unpinFailure.receipt.status, "PRESERVED");
assert.deepEqual(unpinFailureCalls.map(([operation]) => operation), ["set_thread_pinned"]);

const preservedFailureCalls = [];
const preservedFailure = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff: makeHandoff(),
  activeRoster: makeRoster(),
  host: makeHost(preservedFailureCalls, {archive: {throw: true}}),
  universalCloseoutEvidence: CLOSEOUT_EVIDENCE,
  universalCloseoutReceiptResolver: closeoutEvidenceResolver,
});
assert.equal(preservedFailure.status, "HARD_STOP");
assert.equal(preservedFailure.phase, "ARCHIVE");
assert.equal(preservedFailure.preserved_handoff, true);
assert.equal(preservedFailure.receipt.status, "PRESERVED");
assert.deepEqual(preservedFailureCalls.map(([operation]) => operation), ["set_thread_pinned", "set_thread_archived"]);

const missingHandoffCalls = [];
const missingHandoff = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  activeRoster: makeRoster(),
  host: makeHost(missingHandoffCalls),
});
assert.equal(missingHandoff.status, "HARD_STOP");
assert.equal(missingHandoff.code, "MISSING_TYPED_HANDOFF");
assert.deepEqual(missingHandoffCalls, []);

const invalidHandoffCalls = [];
const invalidHandoff = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff: {...makeHandoff(), clearance: "PASS"},
  activeRoster: makeRoster(),
  host: makeHost(invalidHandoffCalls),
});
assert.equal(invalidHandoff.status, "HARD_STOP");
assert.equal(invalidHandoff.code, "INVALID_TYPED_HANDOFF");
assert.deepEqual(invalidHandoffCalls, []);

const identityCalls = [];
const identityMismatch = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff: makeHandoff(),
  activeRoster: [{threadId: THREAD_ID, hostId: "different-host", active: true}],
  host: makeHost(identityCalls),
  universalCloseoutEvidence: CLOSEOUT_EVIDENCE,
  universalCloseoutReceiptResolver: closeoutEvidenceResolver,
});
assert.equal(identityMismatch.status, "HARD_STOP");
assert.equal(identityMismatch.code, "IDENTITY_MISMATCH");
assert.deepEqual(identityCalls, []);

const unavailable = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff: makeHandoff(),
  activeRoster: makeRoster(),
  host: {},
  universalCloseoutEvidence: CLOSEOUT_EVIDENCE,
  universalCloseoutReceiptResolver: closeoutEvidenceResolver,
});
assert.equal(unavailable.status, "UNAVAILABLE");
assert.equal(unavailable.code, "HOST_CAPABILITY_UNAVAILABLE");
assert.equal(unavailable.receipt.status, "PRESERVED");

const badOrderCalls = [];
const badOrder = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff: makeHandoff(),
  activeRoster: makeRoster(),
  host: {
    async set_thread_pinned(payload) {
      badOrderCalls.push(["set_thread_pinned", payload]);
      return {threadId: payload.threadId, pinned: false, operation: "set_thread_archived"};
    },
    async set_thread_archived(payload) {
      badOrderCalls.push(["set_thread_archived", payload]);
      return {threadId: payload.threadId, hostId: payload.hostId, archived: true, operation: "set_thread_archived"};
    },
  },
  universalCloseoutEvidence: CLOSEOUT_EVIDENCE,
  universalCloseoutReceiptResolver: closeoutEvidenceResolver,
});
assert.equal(badOrder.status, "HARD_STOP");
assert.equal(badOrder.code, "BAD_ORDER");
assert.deepEqual(badOrderCalls.map(([operation]) => operation), ["set_thread_pinned"]);

const nonzeroRoster = makeRoster();
const nonzeroActive = await completeTemporaryWorker({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff: makeHandoff(),
  activeRoster: nonzeroRoster,
  host: {
    async set_thread_pinned(payload) {
      return {threadId: payload.threadId, pinned: false, operation: "set_thread_pinned"};
    },
    async set_thread_archived(payload) {
      nonzeroRoster.push({threadId: payload.threadId, hostId: payload.hostId, active: true, status: "ACTIVE"});
      return {threadId: payload.threadId, hostId: payload.hostId, archived: true, operation: "set_thread_archived"};
    },
    async list_threads() {
      return {operation: "list_threads", active_roster: [{threadId: THREAD_ID, hostId: HOST_ID, active: true, status: "ACTIVE"}]};
    },
  },
  universalCloseoutEvidence: CLOSEOUT_EVIDENCE,
  universalCloseoutReceiptResolver: closeoutEvidenceResolver,
});
assert.equal(nonzeroActive.status, "HARD_STOP");
assert.equal(nonzeroActive.code, "ROSTER_REMOVAL_FAILED");
assert.equal(nonzeroRoster.length, 2);

const directReceipt = compileClosureReceipt({
  threadId: THREAD_ID,
  hostId: HOST_ID,
  handoff: makeHandoff(),
  observedAtUtc: NOW,
});
assert.equal(directReceipt.status, "PRESERVED");
assert.equal(directReceipt.handoff_preserved, true);
assert.equal(directReceipt.observed_at_utc, NOW);

console.log("PASS delivery closure: preserve-before-lifecycle, exact host order/arguments, roster removal, zero-active verification, and 8 hostile/failure cases");
