#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileAgentSpawnerLifecycle,
  runAgentSpawnerCompilerTick,
} from "../control/agent-spawner-lifecycle.mjs";
import {
  compileAgentSpawnerGovernedAdmission,
  validateAgentSpawnerGovernedAdmission,
} from "../control/agent-spawner-governed-admission.mjs";
import {independentlyVerifyTestCandidate} from "./helpers/independent-clearance-fixture.mjs";

const SHA = (char) => char.repeat(64);
const clearanceCandidate = {
  commit_sha1: "1".repeat(40), tree_sha1: "2".repeat(40), package_sha256: SHA("3"), package_file_sha256: SHA("4"),
  evidence_set_sha256: SHA("5"), lifecycle_candidate_sha256: SHA("a"), roster_projection_sha256: SHA("e"), context_sha256: SHA("c"),
};
const {clearance, receipt: clearanceReceipt} = independentlyVerifyTestCandidate(clearanceCandidate);
const common = {
  lifecycleId: "LIFECYCLE.SPAWNER.GOVERNED_ADMISSION",
  candidateSha256: SHA("a"),
  rosterProjectionSha256: SHA("b"),
  contextSha256: SHA("c"),
  qa: {
    status: "INDEPENDENT_PASS",
    complete_block_count: 4,
    incomplete_block_count: 0,
    pending_route_count: 1,
    independent_clearance_status: "CLEARED",
    independent_clearance_receipt_sha256: clearanceReceipt.receipt_sha256,
  },
  execution: {compiler_ticks: 2, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false},
};
const compiler = compileAgentSpawnerLifecycle({...common, mode: "COMPILER_ONLY", state: "COMPILER_ACTIVE"});
// The continuation helper requires a semantic delta; compile a realistic
// post-publish lifecycle with a changed roster projection and no pending
// routes.
const published = compileAgentSpawnerLifecycle({...common, rosterProjectionSha256: SHA("e"), qa: {...common.qa, pending_route_count: 0}, mode: "COMPILER_ONLY", state: "COMPILER_ACTIVE"});
const realContinuation = runAgentSpawnerCompilerTick(compiler, {
  onPublishRoster: () => ({
    outcome: "TYPED_ROSTER_PUBLISHED",
    lifecycle_after: published,
    evidence_refs: [{evidence_id: "EVIDENCE.SPAWNER.ROSTER", reference: "opaque:spawner/roster", sha256: SHA("d")}],
    hostile_fixture_refs: ["FIXTURE.SPAWNER.ROSTER.EMPTY", "FIXTURE.SPAWNER.ROSTER.STALE"],
  }),
});
assert.equal(realContinuation.next_action, "ADMIT_GOVERNED_SPAWN");
const readback = compileAgentSpawnerGovernedAdmission({
  adapterId: "ADAPTER.SPAWNER.GOVERNED_ADMISSION",
  sourceContinuation: realContinuation,
  lifecycleBefore: published,
  independentClearance: clearance,
  clearanceCandidate,
  evidenceRefs: [
    {evidence_id: "EVIDENCE.SPAWNER.ADAPTER.CUSTODY", reference: "opaque:spawner/isolated-custody", sha256: SHA("f")},
    {evidence_id: "EVIDENCE.SPAWNER.ADAPTER.ROSTER", reference: "opaque:spawner/published-roster", sha256: SHA("0")},
  ],
  hostileFixtureRefs: ["FIXTURE.SPAWNER.ADAPTER.PRODUCT_BYPASS", "FIXTURE.SPAWNER.ADAPTER.WORKER_EAGER_START"],
});
validateAgentSpawnerGovernedAdmission(readback, {sourceContinuation: realContinuation, lifecycleBefore: published});
assert.equal(readback.status, "ADAPTER_STARTED");
assert.equal(readback.next_action, "START_GOVERNED_SPAWN");
assert.equal(readback.same_turn_dispatch, true);
assert.equal(readback.authority.activation, false);
assert.equal(readback.admission.worker_spawned, false);
assert.equal(readback.admission.isolated_local_custody, false);
assert.throws(() => validateAgentSpawnerGovernedAdmission({...readback, next_action: "WAIT_FOR_PROTECTED_EVENT", readback_sha256: null}), /next action is invalid/u);
const stale = structuredClone(readback);
stale.source_continuation_sha256 = SHA("1");
stale.readback_sha256 = canonicalDigest({...stale, readback_sha256: null});
assert.throws(() => validateAgentSpawnerGovernedAdmission(stale, {sourceContinuation: realContinuation}), /source continuation is stale/u);
const bypass = structuredClone(readback);
bypass.admission.worker_spawned = true;
bypass.readback_sha256 = canonicalDigest({...bypass, readback_sha256: null});
assert.throws(() => validateAgentSpawnerGovernedAdmission(bypass), /cannot spawn a worker/u);
console.log("PASS governed-admission adapter: independently cleared compiler successor is consumed same-turn, isolated-custody bypass is rejected, and activation/protected bypasses fail closed");
