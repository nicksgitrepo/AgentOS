#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  advanceAgentSpawnerLifecycle,
  admitAgentSpawnerIndependentClearance,
  admitAgentSpawnerIsolatedLocalCustody,
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
const cleared = {
  ...pending,
  status: "INDEPENDENT_PASS",
  independent_clearance_status: "CLEARED",
  independent_clearance_receipt_sha256: HASH("clearance"),
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
    lifecycleAfter.qa.incomplete_block_count = 0;
    lifecycleAfter.qa.status = "STATIC_PASS_REVIEW_REQUIRED";
    lifecycleAfter.next_action = "WAIT_FOR_INDEPENDENT_CLEARANCE";
    lifecycleAfter.lifecycle_sha256 = canonicalDigest({...lifecycleAfter, lifecycle_sha256: null});
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
assert.equal(localContinuation.next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(localContinuation.continuation.protected_event_id, "INDEPENDENT.UTILITY_HARM_CLEARANCE");
assert.equal(localContinuation.continuation.same_turn_next_action, true);
assert.equal(localContinuation.continuation.timer_deferral, false);
assert.equal(localContinuation.admission.spawnable, false);

const protectedReady = compileAgentSpawnerLifecycle({
  ...base,
  lifecycleId: "LIFECYCLE.SPAWNER.CONTINUATION.PROTECTED",
  state: "COMPILER_ACTIVE",
  qa: pending,
});
assert.equal(protectedReady.next_action, "WAIT_FOR_INDEPENDENT_CLEARANCE");
const protectedContinuation = runAgentSpawnerCompilerTick(protectedReady, {protectedEventId: "INDEPENDENT.UTILITY_HARM_CLEARANCE"});
assert.equal(protectedContinuation.outcome, "PROTECTED_EVENT_WAIT");
assert.equal(protectedContinuation.next_action, "WAIT_FOR_PROTECTED_EVENT");

const publishReady = compileAgentSpawnerLifecycle({
  ...base,
  lifecycleId: "LIFECYCLE.SPAWNER.CONTINUATION.PUBLISH",
  state: "COMPILER_ACTIVE",
  qa: {...cleared, pending_route_count: 1},
});
assert.throws(
  () => runAgentSpawnerCompilerTick(publishReady, {onPublishRoster: () => {
    const lifecycleAfter = advanceAgentSpawnerLifecycle(publishReady, {
      event_type: "BLOCK_LIBRARY_UPDATED",
      event_sha256: canonicalDigest({event_type: "BLOCK_LIBRARY_UPDATED", event_sha256: null}),
    });
    return {
      outcome: "TYPED_ROSTER_PUBLISHED",
      lifecycle_after: lifecycleAfter,
      evidence_refs: [{evidence_id: "EVIDENCE.SPAWNER.ROSTER.FALSE_PUBLISH", reference: `opaque:roster:${HASH("false-publish")}`, sha256: HASH("false-publish")}],
      hostile_fixture_refs: ["FIXTURE.SPAWNER.ROSTER.INCIDENTAL_EXECUTION_ONLY"],
    };
  }}),
  /TYPED_ROSTER_PUBLISHED must reduce pending_route_count or advance/u,
  "roster publish must not pass on incidental execution progress",
);

let validPublishAfter = null;
const validPublish = runAgentSpawnerCompilerTick(publishReady, {onPublishRoster: () => {
  const lifecycleAfter = compileAgentSpawnerLifecycle({
    ...base,
    lifecycleId: publishReady.lifecycle_id,
    state: "COMPILER_ACTIVE",
    qa: {...cleared, pending_route_count: 0},
  });
  assert.equal(lifecycleAfter.next_action, "ADMIT_GOVERNED_SPAWN");
  validPublishAfter = lifecycleAfter;
  return {
    outcome: "TYPED_ROSTER_PUBLISHED",
    lifecycle_after: lifecycleAfter,
    evidence_refs: [{evidence_id: "EVIDENCE.SPAWNER.ROSTER.VALID", reference: `opaque:roster:${HASH("valid-publish")}`, sha256: HASH("valid-publish")}],
    hostile_fixture_refs: ["FIXTURE.SPAWNER.ROSTER.PENDING_ROUTE", "FIXTURE.SPAWNER.ROSTER.STALE_PROJECTION"],
  };
}});
assert.equal(validPublish.outcome, "TYPED_ROSTER_PUBLISHED");
assert.equal(validPublish.next_action, "ADMIT_GOVERNED_SPAWN");
assert.equal(validPublish.continuation.resume_condition, "Hand off to governed admission; adapter/readback still required.");
assert.equal(validPublish.admission.spawnable, false);
assert.throws(() => runAgentSpawnerCompilerTick(validPublishAfter), /governed admission adapter.*readback/u, "compiler must not perform governed admission");

const independentAdmission = admitAgentSpawnerIndependentClearance(validPublishAfter);
assert.equal(independentAdmission.mode, "GOVERNED_SPAWN");
assert.equal(independentAdmission.state, "SPAWN_ADMITTED");
assert.equal(independentAdmission.authority.isolated_local_custody, false);
assert.equal(independentAdmission.authority.spawn_authority, true);
assert.equal(independentAdmission.wave_activation, "OFF");
assert.equal(independentAdmission.qa.independent_clearance_status, "CLEARED");
assert.throws(() => admitAgentSpawnerIsolatedLocalCustody(validPublishAfter), /independent clearance is required/u);

const pendingLocalCompiler = compileAgentSpawnerLifecycle({
  ...base,
  lifecycleId: "LIFECYCLE.SPAWNER.CONTINUATION.LOCAL_PENDING",
  state: "COMPILER_ACTIVE",
  qa: pending,
});
assert.throws(() => admitAgentSpawnerIndependentClearance(pendingLocalCompiler), /independently cleared admission successor|independent QA clearance/u);
assert.throws(() => admitAgentSpawnerIsolatedLocalCustody(pendingLocalCompiler), /independent clearance is required/u);

const incompleteLocalCompiler = compileAgentSpawnerLifecycle({
  ...base,
  lifecycleId: "LIFECYCLE.SPAWNER.CONTINUATION.LOCAL_INCOMPLETE",
  state: "COMPILER_ACTIVE",
  qa: {...pending, incomplete_block_count: 1, status: "NOT_READY"},
});
assert.throws(() => admitAgentSpawnerIsolatedLocalCustody(incompleteLocalCompiler), /independent clearance is required/u, "isolated admission must not bypass an incomplete roster route");

assert.throws(
  () => runAgentSpawnerCompilerTick(compileReady, {onCompileBlock: () => ({
    outcome: "BLOCK_COMPILED",
    lifecycle_after: compileReady,
    evidence_refs: [{evidence_id: "EVIDENCE.SPAWNER.BLOCK", reference: "opaque:block:unchanged", sha256: HASH("unchanged")}],
    hostile_fixture_refs: ["FIXTURE.SPAWNER.INCOMPLETE_ROUTE"],
  })}),
  /BLOCK_COMPILED must reduce incomplete_block_count or advance/u,
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

console.log("PASS Agent Spawner compiler continuation: typed local progress, independent-clearance wait, lifecycle delta, no timer deferral, and isolated-bypass denial");
