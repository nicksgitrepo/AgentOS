#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileAgentSpawnerLifecycle,
  runAgentSpawnerCompilerTick,
} from "../control/agent-spawner-lifecycle.mjs";
import {
  assertCanonicalGovernedAdmission,
  compileAgentSpawnerGovernedAdmission,
  validateAgentSpawnerGovernedAdmission,
} from "../control/agent-spawner-governed-admission.mjs";

const SHA = (char) => char.repeat(64);
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
    independent_clearance_receipt_sha256: SHA("9"),
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
assert.throws(() => compileAgentSpawnerGovernedAdmission({
  adapterId: "ADAPTER.SPAWNER.GOVERNED_ADMISSION", sourceContinuation: realContinuation, lifecycleBefore: published,
  independentClearance: {status: "PASS"}, clearanceCandidate: {candidate_sha256: SHA("a")},
  evidenceRefs: [{evidence_id: "EVIDENCE.SPAWNER.ADAPTER.CUSTODY", reference: "opaque:spawner/isolated-custody", sha256: SHA("f")}],
  hostileFixtureRefs: ["FIXTURE.SPAWNER.ADAPTER.PRODUCT_BYPASS"],
}), /authority root|canonical|clearance/iu, "caller-authored independent clearance must never promote");
assert.throws(() => compileAgentSpawnerGovernedAdmission({
  adapterId: "ADAPTER.SPAWNER.GOVERNED_ADMISSION", sourceContinuation: realContinuation, lifecycleBefore: published,
  clearanceReceiptSha256: SHA("9"), evidenceRefs: [{evidence_id: "EVIDENCE.FORGED", reference: "ref:forged", sha256: SHA("f")}], hostileFixtureRefs: ["FIXTURE.FORGED"],
}), /rejects caller evidence/iu, "caller-authored evidence or fixture references entered spawnable readback");

const fabricated = {
  schema: "agentos.agent_spawner_governed_admission.v1", version: 1, adapter_id: "ADAPTER.SPAWNER.GOVERNED_ADMISSION",
  source_continuation_sha256: realContinuation.continuation_sha256, source_lifecycle_sha256: published.lifecycle_sha256,
  lifecycle_after_sha256: SHA("8"), status: "ADAPTER_STARTED", next_action: "START_GOVERNED_SPAWN",
  next_handler: "HANDLER.GOVERNED_SPAWN_ADAPTER", same_turn_dispatch: true,
  authority: {compiler_only: false, admission: true, activation: false, product_mutation: false, provider_access: false, credential_access: false},
  admission: {spawnable: true, worker_spawned: false, wave_activation: "OFF", isolated_local_custody: false},
  evidence_refs: [{evidence_id: "EVIDENCE.SPAWNER.ADAPTER.CUSTODY", reference: "opaque:spawner/isolated-custody", sha256: SHA("f")}],
  hostile_fixture_refs: ["FIXTURE.SPAWNER.ADAPTER.PRODUCT_BYPASS"], readback_sha256: null,
};
fabricated.readback_sha256 = canonicalDigest({...fabricated, readback_sha256: null});
assert.throws(() => validateAgentSpawnerGovernedAdmission(fabricated, {sourceContinuation: realContinuation, lifecycleBefore: published}), /not produced by the canonical clearance-consuming adapter/u);
assert.throws(() => assertCanonicalGovernedAdmission(fabricated), /not produced by the canonical clearance-consuming adapter/u);
const bypass = structuredClone(fabricated); bypass.admission.worker_spawned = true; bypass.readback_sha256 = canonicalDigest({...bypass, readback_sha256: null});
assert.throws(() => validateAgentSpawnerGovernedAdmission(bypass), /not produced by the canonical clearance-consuming adapter/u);
console.log("PASS governed-admission adapter: caller clearance cannot promote, only canonical receipt consumption mints authority, and fabricated/activation bypasses fail closed");
