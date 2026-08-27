#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import path from "node:path";
import {
  compileAgentSpawnerLifecycle,
  runAgentSpawnerCompilerTick,
} from "../control/agent-spawner-lifecycle.mjs";
import {
  compileAgentSpawnerGovernedAdmission,
  validateAgentSpawnerGovernedAdmission,
  compileAgentSpawnerAtomicAdmission,
  validateAgentSpawnerAtomicAdmission,
  evaluateAgentSpawnerAtomicAdmission,
  AgentSpawnerAtomicAdmissionError,
  AGENT_SPAWNER_ATOMIC_ADMISSION_REQUEST_SCHEMA,
  AGENT_SPAWNER_ATOMIC_ADMISSION_SCHEMA,
  AGENT_SPAWNER_ATOMIC_ADMISSION_HOSTILE_FIXTURE_REFS,
} from "../control/agent-spawner-governed-admission.mjs";

const SHA = (char) => char.repeat(64);
const common = {
  lifecycleId: "LIFECYCLE.SPAWNER.GOVERNED_ADMISSION",
  candidateSha256: SHA("a"),
  rosterProjectionSha256: SHA("b"),
  contextSha256: SHA("c"),
  qa: {
    status: "STATIC_PASS_REVIEW_REQUIRED",
    complete_block_count: 4,
    incomplete_block_count: 0,
    pending_route_count: 1,
    independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY",
    independent_clearance_receipt_sha256: null,
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
assert.throws(() => validateAgentSpawnerGovernedAdmission({...readback, next_action: "WAIT_FOR_PROTECTED_EVENT", readback_sha256: null}), /next action is invalid/u);
const stale = structuredClone(readback);
stale.source_continuation_sha256 = SHA("1");
stale.readback_sha256 = canonicalDigest({...stale, readback_sha256: null});
assert.throws(() => validateAgentSpawnerGovernedAdmission(stale, {sourceContinuation: realContinuation}), /source continuation is stale/u);
const bypass = structuredClone(readback);
bypass.admission.worker_spawned = true;
bypass.readback_sha256 = canonicalDigest({...bypass, readback_sha256: null});
assert.throws(() => validateAgentSpawnerGovernedAdmission(bypass), /cannot spawn a worker/u);
console.log("PASS governed-admission adapter: complete compiler successor is consumed same-turn, isolated custody is explicit, and activation/protected bypasses fail closed");

const PROJECT_ID = ["f74d76d4", "c8d9", "45cf", "9c85", "5853b497f31f"].join("-");
const CWD = path.resolve("fixture-project");
const WORKTREE = path.join(CWD, "gov02-fixture");
const atomicRequest = {
  schema: AGENT_SPAWNER_ATOMIC_ADMISSION_REQUEST_SCHEMA,
  version: 1,
  request_id: "REQ.GOV02.ATOMIC.001",
  task_id: "TASK-GOV02-ATOMIC-001",
  role_id: "AGENT.GOV02.ATOMIC",
  role_kind: "ATOMIC_SPECIALIST",
  model: "gpt-5.6-luna",
  reasoning_effort: "max",
  target: {projectId: PROJECT_ID, environment: "local"},
  cwd: CWD,
  worktree: WORKTREE,
  custody_ref: "ref:custody/gov02-atomic-001",
  queue: "GOV-02-ATOMIC-SPAWNER-ADMISSION",
  seam: "GOV-02",
  prompt_ref: "opaque:prompt/gov02-atomic-001",
  title: "GOV-02 atomic admission fixture",
};
const digestRecord = (record, field = "readback_sha256") => ({...structuredClone(record), [field]: canonicalDigest({...structuredClone(record), [field]: null})});
const makeHost = (overrides = {}) => digestRecord({
  schema: "agentos.agent_spawner_host_readback.v1",
  version: 1,
  fresh: true,
  project_id: PROJECT_ID,
  cwd: CWD,
  role_id: atomicRequest.role_id,
  role_kind: atomicRequest.role_kind,
  model: atomicRequest.model,
  reasoning_effort: atomicRequest.reasoning_effort,
  queue: atomicRequest.queue,
  seam: atomicRequest.seam,
  worktree: WORKTREE,
  custody_ref: atomicRequest.custody_ref,
  worktree_clean: true,
  readback_sha256: null,
  ...overrides,
});
const makeRow = (overrides = {}) => ({
  task_id: atomicRequest.task_id,
  role_id: atomicRequest.role_id,
  role_kind: atomicRequest.role_kind,
  project_id: PROJECT_ID,
  cwd: CWD,
  worktree: WORKTREE,
  custody_ref: atomicRequest.custody_ref,
  model: atomicRequest.model,
  reasoning_effort: atomicRequest.reasoning_effort,
  queue: atomicRequest.queue,
  seam: atomicRequest.seam,
  status: "PENDING",
  lifecycle: "PENDING",
  ...overrides,
});
const makeIndex = (rows = [makeRow()]) => digestRecord({
  schema: "agentos.agent_spawner_task_index_readback.v1",
  version: 1,
  fresh: true,
  project_id: PROJECT_ID,
  cwd: CWD,
  queue: atomicRequest.queue,
  seam: atomicRequest.seam,
  rows,
  readback_sha256: null,
});
const makeState = (overrides = {}) => digestRecord({
  schema: "agentos.agent_spawner_task_state_readback.v1",
  version: 1,
  fresh: true,
  task_id: atomicRequest.task_id,
  role_id: atomicRequest.role_id,
  role_kind: atomicRequest.role_kind,
  project_id: PROJECT_ID,
  cwd: CWD,
  worktree: WORKTREE,
  custody_ref: atomicRequest.custody_ref,
  model: atomicRequest.model,
  reasoning_effort: atomicRequest.reasoning_effort,
  queue: atomicRequest.queue,
  seam: atomicRequest.seam,
  status: "PENDING",
  lifecycle: "PENDING",
  substantive_prompt_sent: false,
  process_started: false,
  readback_sha256: null,
  ...overrides,
});
const makeProcess = (processes = []) => digestRecord({
  schema: "agentos.agent_spawner_process_readback.v1",
  version: 1,
  fresh: true,
  processes,
  readback_sha256: null,
});
const atomicInput = () => ({request: structuredClone(atomicRequest), projectBinding: {project_id: PROJECT_ID, cwd: CWD, environment: "local"}, hostReadback: makeHost(), taskIndexReadback: makeIndex(), stateReadback: makeState(), processReadback: makeProcess(), existingClaims: []});
const expectBlock = (input, code, message) => {
  assert.throws(() => compileAgentSpawnerAtomicAdmission(input), (error) => {
    assert(error instanceof AgentSpawnerAtomicAdmissionError);
    assert.equal(error.code, code);
    assert.equal(error.blocker.cleanup_action, "HOLD_OR_ARCHIVE_ONCE");
    assert.equal(error.blocker.hold_or_archive_count, 1);
    assert.equal(error.blocker.substantive_work_started, false);
    assert.equal(error.blocker.retry_allowed, false);
    if (message) assert.match(error.message, message);
    return true;
  });
};

const admitted = compileAgentSpawnerAtomicAdmission(atomicInput());
assert.equal(admitted.schema, AGENT_SPAWNER_ATOMIC_ADMISSION_SCHEMA);
assert.equal(admitted.status, "ADMITTED");
assert.equal(admitted.substantive_prompt_sent, false);
assert.equal(admitted.process_started, false);
assert.deepEqual(admitted.hostile_fixture_refs, [...AGENT_SPAWNER_ATOMIC_ADMISSION_HOSTILE_FIXTURE_REFS]);
validateAgentSpawnerAtomicAdmission(admitted, atomicInput());
assert.equal(admitted.receipt_sha256, canonicalDigest({...admitted, receipt_sha256: null}));

const wrongCwd = atomicInput();
wrongCwd.hostReadback = makeHost({cwd: "/"});
expectBlock(wrongCwd, "ATOMIC_ADMISSION_PROJECT_BINDING_MISMATCH", /host readback cwd/u);
expectBlock({...atomicInput(), hostReadback: null}, "ATOMIC_ADMISSION_FRESH_READBACK_REQUIRED", /fresh host/u);
const roleDrift = atomicInput();
roleDrift.hostReadback = makeHost({role_id: "AGENT.GOV02.OTHER"});
expectBlock(roleDrift, "ATOMIC_ADMISSION_ROLE_BINDING_MISMATCH", /role_id/u);
const duplicate = atomicInput();
duplicate.taskIndexReadback = makeIndex([makeRow(), makeRow({task_id: "TASK-GOV02-OTHER", role_id: atomicRequest.role_id})]);
expectBlock(duplicate, "ATOMIC_ADMISSION_DUPLICATE_OR_COLLISION", /duplicate/u);
const duplicateProcess = atomicInput();
duplicateProcess.processReadback = makeProcess([{process_id: "PROCESS-GOV02-OTHER", task_id: "TASK-GOV02-OTHER", role_id: atomicRequest.role_id, worktree: WORKTREE, command: "node"}]);
expectBlock(duplicateProcess, "ATOMIC_ADMISSION_DUPLICATE_OR_COLLISION", /process readback/u);
const duplicateWriter = atomicInput();
duplicateWriter.existingClaims = [{kind: "WRITER", identity: atomicRequest.role_id, status: "ACTIVE"}];
expectBlock(duplicateWriter, "ATOMIC_ADMISSION_DUPLICATE_OR_COLLISION", /existing identity claim/u);
const failedRow = atomicInput();
failedRow.taskIndexReadback = makeIndex([makeRow(), makeRow({task_id: atomicRequest.task_id, role_id: atomicRequest.role_id, status: "FAILED", lifecycle: "FAILED"})]);
assert.equal(compileAgentSpawnerAtomicAdmission(failedRow).status, "ADMITTED", "a failed historical row must not block an independent admission");
const substantive = atomicInput();
substantive.stateReadback = makeState({substantive_prompt_sent: true});
expectBlock(substantive, "ATOMIC_ADMISSION_SUBSTANTIVE_WORK_STARTED", /substantive prompt/u);
const noAckSubstitute = atomicInput();
noAckSubstitute.stateReadback = null;
expectBlock(noAckSubstitute, "ATOMIC_ADMISSION_FRESH_READBACK_REQUIRED", /fresh host.*state/u);
const badTarget = atomicInput();
badTarget.request.target = {projectId: "OTHER-PROJECT", environment: "local"};
expectBlock(badTarget, "ATOMIC_ADMISSION_PROJECT_BINDING_MISMATCH", /authoritative saved-project/u);
const evaluated = evaluateAgentSpawnerAtomicAdmission(substantive);
assert.equal(evaluated.accepted, false);
assert.equal(evaluated.status, "HELD");
assert.equal(evaluated.blocker.cleanup_action, "HOLD_OR_ARCHIVE_ONCE");
console.log("PASS atomic Spawner admission: project/cwd/role/model/custody readbacks are exact, duplicate and pre-work states fail closed with one hold/archive blocker, failed rows remain independent, and successful admission emits one durable receipt");
