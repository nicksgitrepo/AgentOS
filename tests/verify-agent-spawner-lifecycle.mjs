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
    after.next_action = "ADMIT_GOVERNED_SPAWN";
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
assert.equal(tick.next_action, "ADMIT_GOVERNED_SPAWN");
assert.equal(tick.continuation.same_turn_next_action, true);
assert.equal(tick.admission.spawnable, false);

const completePendingCompiler = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.COMPILER_ONLY.COMPLETE_PENDING",
  state: "COMPILER_ACTIVE",
  qa: pendingQa,
});
assert.equal(completePendingCompiler.next_action, "ADMIT_GOVERNED_SPAWN", "compiler-only local QA must not stop on external clearance");

const admitted = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ADMITTED",
  mode: "GOVERNED_SPAWN",
  state: "SPAWN_ADMITTED",
  qa: clearedQa,
});
assert.equal(admitted.persistent_state, "ADMITTED");
assert.equal(admitted.wave_activation, "OFF");
assert.equal(admitted.authority.spawn_authority, true);

// Local pyramid audit/repair may be admitted without external utility/harm
// clearance when custody is isolated, product/provider/external authority is
// false, and the resource ceiling is enforced.  This is ordinary reversible
// development work, not a protected release or provider route.
const isolatedLocal = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ISOLATED_LOCAL",
  mode: "GOVERNED_SPAWN",
  isolatedLocalCustody: true,
  qa: pendingQa,
});
assert.equal(isolatedLocal.state, "SPAWN_ADMITTED");
assert.equal(isolatedLocal.authority.isolated_local_custody, true);
assert.equal(isolatedLocal.authority.spawn_authority, true);
assert.equal(isolatedLocal.wave_activation, "OFF");
const isolatedActive = advanceAgentSpawnerLifecycle(isolatedLocal, {
  event_type: "START_GOVERNED_SPAWN",
  event_sha256: canonicalDigest({event_type: "START_GOVERNED_SPAWN", event_sha256: null}),
});
assert.equal(isolatedActive.state, "SPAWN_ACTIVE");
assert.equal(isolatedActive.wave_activation, "ON");
assert.equal(isolatedActive.authority.isolated_local_custody, true);

const active = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ACTIVE",
  mode: "GOVERNED_SPAWN",
  state: "SPAWN_ACTIVE",
  waveActivation: "ON",
  qa: clearedQa,
  execution: {compiler_ticks: 0, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false},
});
assert.equal(active.persistent_state, "ACTIVE");
assert.equal(active.wave_activation, "ON");

const stalled = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.STALLED",
  state: "STALLED",
  protectedHoldEventSha256: AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256,
  qa: pendingQa,
});
assert.equal(stalled.persistent_state, "STALLED");
assert.equal(stalled.mode, "COMPILER_ONLY");
assert.equal(stalled.wave_activation, "OFF");
assert.equal(stalled.authority.temporary_worker_admission, false);
assert.equal(stalled.authority.spawn_authority, false);
assert.deepEqual(stalled.execution, {compiler_ticks: 0, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false});
assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.UNBOUND_STALLED",
  state: "STALLED",
  qa: pendingQa,
}), /protected hold receipt/u, "Spawner cannot be stalled without a typed protected-hold receipt");

const resumedCompiler = advanceAgentSpawnerLifecycle(stalled, {
  event_type: "START_COMPILER",
  event_sha256: canonicalDigest({event_type: "START_COMPILER", event_sha256: null}),
});
assert.equal(resumedCompiler.state, "COMPILER_ACTIVE");
assert.equal(resumedCompiler.persistent_state, "COMPILER_ACTIVE");
assert.equal(resumedCompiler.mode, "COMPILER_ONLY");

const retired = advanceAgentSpawnerLifecycle(active, {
  event_type: "RETIRE",
  event_sha256: canonicalDigest({event_type: "RETIRE", event_sha256: null}),
});
assert.equal(retired.state, "RETIRED");
assert.equal(retired.persistent_state, "RETIRED", "retirement must not be persisted as an active/stalled state");
assert.equal(retired.next_action, "NONE", "retirement is an explicit terminal lifecycle record, not an unexplained idle");
assert.equal(retired.execution.active_worker_count, 0);
assert.equal(retired.execution.scheduler_job_count, 0);
assert.equal(retired.execution.heavyweight_process_count, 0);
assert.equal(retired.execution.timer_count, 0);
assert.equal(retired.execution.polling, false);
assert.throws(() => advanceAgentSpawnerLifecycle(retired, {
  event_type: "START_COMPILER",
  event_sha256: canonicalDigest({event_type: "START_COMPILER", event_sha256: null}),
}), /compiler-only mode|current state/u, "retired Spawner cannot silently re-enter the workflow");

const retiredWithStalledProjection = structuredClone(retired);
retiredWithStalledProjection.persistent_state = "STALLED";
retiredWithStalledProjection.lifecycle_sha256 = canonicalDigest({...retiredWithStalledProjection, lifecycle_sha256: null});
assert.throws(() => validateAgentSpawnerLifecycle(retiredWithStalledProjection), /persistent lifecycle state is not bound/u, "retirement cannot masquerade as a stalled hold");

const fakeActivePending = structuredClone(stalled);
fakeActivePending.persistent_state = "ACTIVE";
fakeActivePending.lifecycle_sha256 = canonicalDigest({...fakeActivePending, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(fakeActivePending),
  /persistent lifecycle state is not bound|Pending utility\/harm/u,
  "pending utility/harm must reject an active persistent Spawner claim",
);

const fakeWave = structuredClone(stalled);
fakeWave.wave_activation = "ON";
fakeWave.lifecycle_sha256 = canonicalDigest({...fakeWave, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(fakeWave),
  /Pending utility\/harm must keep governed activation off/u,
  "pending utility/harm must reject wave activation",
);

const fakeAdmission = structuredClone(stalled);
fakeAdmission.authority.temporary_worker_admission = true;
fakeAdmission.lifecycle_sha256 = canonicalDigest({...fakeAdmission, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(fakeAdmission),
  /Compiler-only Spawner cannot admit or spawn workers/u,
  "compiler-only Spawner must reject temporary admission",
);

console.log("PASS Agent Spawner lifecycle: persistent PREPARED/QA_READY/COMPILER_ACTIVE/ADMITTED/ACTIVE/STALLED/RETIRED state, compiler-only safe mode, separate wave activation, and hostile gate checks");
