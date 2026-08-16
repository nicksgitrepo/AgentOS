#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  advanceAgentSpawnerLifecycle,
  compileAgentSpawnerLifecycle,
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
assert.equal(tick.next_action, "COMPILE_NEXT_BLOCK");
assert.equal(tick.continuation.same_turn_next_action, true);
assert.equal(tick.admission.spawnable, false);

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
  qa: pendingQa,
});
assert.equal(stalled.persistent_state, "STALLED");
assert.equal(stalled.mode, "COMPILER_ONLY");
assert.equal(stalled.wave_activation, "OFF");
assert.equal(stalled.authority.temporary_worker_admission, false);
assert.equal(stalled.authority.spawn_authority, false);
assert.deepEqual(stalled.execution, {compiler_ticks: 0, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false});

const resumedCompiler = advanceAgentSpawnerLifecycle(stalled, {
  event_type: "START_COMPILER",
  event_sha256: canonicalDigest({event_type: "START_COMPILER", event_sha256: null}),
});
assert.equal(resumedCompiler.state, "COMPILER_ACTIVE");
assert.equal(resumedCompiler.persistent_state, "COMPILER_ACTIVE");
assert.equal(resumedCompiler.mode, "COMPILER_ONLY");

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

console.log("PASS Agent Spawner lifecycle: persistent PREPARED/QA_READY/COMPILER_ACTIVE/ADMITTED/ACTIVE/STALLED state, compiler-only safe mode, separate wave activation, and hostile gate checks");
