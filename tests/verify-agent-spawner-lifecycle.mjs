#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  advanceAgentSpawnerLifecycle,
  compileAgentSpawnerLifecycle,
  AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256,
  runAgentSpawnerCompilerTick,
  validateAgentSpawnerLifecycle,
} from "../control/agent-spawner-lifecycle.mjs";

const HASH = (value) => canonicalDigest({value});
const common = {
  lifecycleId: "LIFECYCLE.SPAWNER.CURRENT",
  candidateSha256: HASH("candidate"),
  rosterProjectionSha256: HASH("projection"),
  contextSha256: HASH("context"),
};
const pendingQa = {
  status: "STATIC_PASS_REVIEW_REQUIRED",
  complete_block_count: 148,
  incomplete_block_count: 0,
  pending_route_count: 0,
  independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY",
  independent_clearance_receipt_sha256: null,
};
const clearedQa = {
  ...pendingQa,
  status: "INDEPENDENT_PASS",
  independent_clearance_status: "CLEARED",
  independent_clearance_receipt_sha256: HASH("clearance"),
};

const prepared = compileAgentSpawnerLifecycle({...common, state: "PREPARED", qa: pendingQa});
assert.equal(prepared.persistent_state, "PREPARED");
assert.equal(prepared.mode, "COMPILER_ONLY");
assert.equal(prepared.wave_activation, "OFF");

const compilerOnly = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.COMPILER_ONLY",
  state: "COMPILER_ACTIVE",
  qa: {...pendingQa, incomplete_block_count: 1, status: "NOT_READY"},
});
assert.equal(compilerOnly.persistent_state, "COMPILER_ACTIVE");
assert.equal(compilerOnly.mode, "COMPILER_ONLY");
assert.equal(compilerOnly.wave_activation, "OFF");
let compiled = 0;
const tick = runAgentSpawnerCompilerTick(compilerOnly, {
  onCompileBlock: (request) => {
    compiled += 1;
    assert.equal(request.product_mutation, false);
    assert.equal(request.spawn_authority, false);
    const after = advanceAgentSpawnerLifecycle(compilerOnly, {
      event_type: "BLOCK_LIBRARY_UPDATED",
      event_sha256: canonicalDigest({event_type: "BLOCK_LIBRARY_UPDATED", event_sha256: null}),
    });
    after.qa.incomplete_block_count = 0;
    after.qa.status = "STATIC_PASS_REVIEW_REQUIRED";
    after.next_action = "WAIT_FOR_INDEPENDENT_CLEARANCE";
    after.lifecycle_sha256 = canonicalDigest({...after, lifecycle_sha256: null});
    return {
      outcome: "BLOCK_COMPILED",
      lifecycle_after: after,
      evidence_refs: [{evidence_id: "EVIDENCE.BLOCK.CANDIDATE", reference: `opaque:block:${HASH("block-evidence")}`, sha256: HASH("block-evidence")}],
      hostile_fixture_refs: ["FIXTURE.BLOCK.INCOMPLETE", "FIXTURE.BLOCK.STALE_SOURCE"],
    };
  },
});
assert.equal(compiled, 1);
assert.equal(tick.outcome, "BLOCK_COMPILED");
assert.equal(tick.next_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(tick.continuation.same_turn_next_action, true);
assert.equal(tick.admission.spawnable, false);

const completePendingCompiler = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.COMPILER_ONLY.COMPLETE_PENDING",
  state: "COMPILER_ACTIVE",
  qa: pendingQa,
});
assert.equal(completePendingCompiler.next_action, "WAIT_FOR_INDEPENDENT_CLEARANCE", "governed spawn must wait for independent clearance");

assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ADMITTED",
  mode: "GOVERNED_SPAWN",
  state: "SPAWN_ADMITTED",
  qa: clearedQa,
}), /descriptive-only|cannot compile governed spawn authority/u, "caller QA flags cannot mint admission");

assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.UNPUBLISHED_ROSTER",
  mode: "GOVERNED_SPAWN",
  state: "SPAWN_ADMITTED",
  qa: {...clearedQa, pending_route_count: 1},
}), /descriptive-only|cannot compile governed spawn authority/u, "public lifecycle cannot admit workers regardless of caller roster flags");

assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ISOLATED_LOCAL",
  mode: "GOVERNED_SPAWN",
  isolatedLocalCustody: true,
  qa: pendingQa,
}), /descriptive-only|cannot compile governed spawn authority/iu, "isolated custody cannot bypass independent clearance");

assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ACTIVE",
  mode: "GOVERNED_SPAWN",
  state: "SPAWN_ACTIVE",
  waveActivation: "ON",
  qa: clearedQa,
  execution: {compiler_ticks: 0, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false},
}), /descriptive-only|cannot compile governed spawn authority/u, "caller flags cannot mint active spawn authority");

assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  mode: "GOVERNED_SPAWN",
  lifecycleId: "LIFECYCLE.SPAWNER.STALLED",
  state: "STALLED",
  protectedHoldEventSha256: AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256,
  qa: pendingQa,
}), /descriptive-only|cannot compile governed spawn authority/u);
assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  mode: "GOVERNED_SPAWN",
  lifecycleId: "LIFECYCLE.SPAWNER.UNBOUND_STALLED",
  state: "STALLED",
  qa: pendingQa,
}), /descriptive-only|cannot compile governed spawn authority/u, "public lifecycle cannot construct governed protected holds");

const resumedCompiler = advanceAgentSpawnerLifecycle(prepared, {
  event_type: "START_COMPILER",
  event_sha256: canonicalDigest({event_type: "START_COMPILER", event_sha256: null}),
});
assert.equal(resumedCompiler.state, "COMPILER_ACTIVE");
assert.equal(resumedCompiler.persistent_state, "COMPILER_ACTIVE");
assert.equal(resumedCompiler.mode, "COMPILER_ONLY");
assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.COMPILER_ONLY.STALLED",
  state: "STALLED",
  protectedHoldEventSha256: AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256,
  qa: pendingQa,
}), /cannot enter a protected stall/u, "compiler-only Spawner cannot park behind a protected hold");

assert.throws(() => advanceAgentSpawnerLifecycle(compilerOnly, {
  event_type: "PROTECTED_HOLD",
  event_sha256: canonicalDigest({event_type: "PROTECTED_HOLD", event_sha256: null}),
}), /cannot enter a protected hold/u, "compiler-only Spawner cannot be parked by an external hold event");

const fakeAdmission = structuredClone(compilerOnly);
fakeAdmission.authority.temporary_worker_admission = true;
fakeAdmission.lifecycle_sha256 = canonicalDigest({...fakeAdmission, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(fakeAdmission),
  /Compiler-only Spawner cannot admit or spawn workers/u,
  "compiler-only Spawner must reject temporary admission",
);

console.log("PASS Agent Spawner lifecycle: public lifecycle is descriptive compiler-only state, caller QA cannot promote or activate, and hostile gate checks fail closed");
