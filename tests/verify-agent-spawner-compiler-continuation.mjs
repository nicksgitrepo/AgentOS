#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  advanceAgentSpawnerLifecycle,
  compileAgentSpawnerLifecycle,
  runAgentSpawnerCompilerTick,
  validateAgentSpawnerCompilerContinuation,
} from "../control/agent-spawner-lifecycle.mjs";

const HASH = (value) => canonicalDigest({value});
const base = {
  lifecycleId: "LIFECYCLE.SPAWNER.CONTINUATION",
  candidateSha256: HASH("candidate"),
  rosterProjectionSha256: HASH("roster"),
  contextSha256: HASH("context"),
};
const pending = {
  status: "STATIC_PASS_REVIEW_REQUIRED",
  complete_block_count: 148,
  incomplete_block_count: 0,
  pending_route_count: 0,
  independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY",
  independent_clearance_receipt_sha256: null,
};

const compileReady = compileAgentSpawnerLifecycle({
  ...base,
  lifecycleId: "LIFECYCLE.SPAWNER.CONTINUATION.LOCAL",
  state: "COMPILER_ACTIVE",
  qa: {...pending, incomplete_block_count: 1, status: "NOT_READY"},
});
const localContinuation = runAgentSpawnerCompilerTick(compileReady, {
  onCompileBlock: () => {
    const lifecycleAfter = advanceAgentSpawnerLifecycle(compileReady, {
      event_type: "BLOCK_LIBRARY_UPDATED",
      event_sha256: canonicalDigest({event_type: "BLOCK_LIBRARY_UPDATED", event_sha256: null}),
    });
    return {
      outcome: "BLOCK_COMPILED",
      lifecycle_after: lifecycleAfter,
      evidence_refs: [{evidence_id: "EVIDENCE.SPAWNER.BLOCK", reference: `opaque:block:${HASH("candidate")}`, sha256: HASH("candidate")}],
      hostile_fixture_refs: ["FIXTURE.SPAWNER.INCOMPLETE_ROUTE", "FIXTURE.SPAWNER.STALE_SOURCE"],
    };
  },
});
validateAgentSpawnerCompilerContinuation(localContinuation);
assert.equal(localContinuation.outcome, "BLOCK_COMPILED");
assert.notEqual(localContinuation.lifecycle_before_sha256, localContinuation.lifecycle_after_sha256);
assert.equal(localContinuation.continuation.same_turn_next_action, true);
assert.equal(localContinuation.continuation.timer_deferral, false);
assert.equal(localContinuation.admission.spawnable, false);

const protectedReady = compileAgentSpawnerLifecycle({
  ...base,
  lifecycleId: "LIFECYCLE.SPAWNER.CONTINUATION.PROTECTED",
  state: "COMPILER_ACTIVE",
  qa: pending,
});
const protectedContinuation = runAgentSpawnerCompilerTick(protectedReady, {protectedEventId: "INDEPENDENT.UTILITY_HARM_CLEARANCE"});
validateAgentSpawnerCompilerContinuation(protectedContinuation);
assert.equal(protectedContinuation.outcome, "PROTECTED_EVENT_WAIT");
assert.equal(protectedContinuation.next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(protectedContinuation.continuation.protected_event_id, "INDEPENDENT.UTILITY_HARM_CLEARANCE");
assert.equal(protectedContinuation.continuation.heartbeat_deferral, false);
assert.equal(protectedContinuation.continuation.timer_deferral, false);

assert.throws(
  () => runAgentSpawnerCompilerTick(compileReady, {onCompileBlock: () => ({
    outcome: "BLOCK_COMPILED",
    lifecycle_after: compileReady,
    evidence_refs: [{evidence_id: "EVIDENCE.SPAWNER.BLOCK", reference: "opaque:block:unchanged", sha256: HASH("unchanged")}],
    hostile_fixture_refs: ["FIXTURE.SPAWNER.INCOMPLETE_ROUTE"],
  })}),
  /real lifecycle progress delta/u,
  "unchanged lifecycle must be rejected",
);

const tampered = structuredClone(localContinuation);
tampered.continuation.timer_deferral = true;
tampered.continuation_sha256 = canonicalDigest({...tampered, continuation_sha256: null});
assert.throws(() => validateAgentSpawnerCompilerContinuation(tampered), /cannot defer to a timer or heartbeat/u);

const admitted = structuredClone(localContinuation);
admitted.authority.admission = true;
admitted.continuation_sha256 = canonicalDigest({...admitted, continuation_sha256: null});
assert.throws(() => validateAgentSpawnerCompilerContinuation(admitted), /crossed protected boundary/u);

console.log("PASS Agent Spawner compiler continuation: typed local progress, protected event wait, lifecycle delta, no timer deferral, and hostile boundary checks");
