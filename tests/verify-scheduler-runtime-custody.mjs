#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileHybridSchedulerRequest,
  opaqueSchedulerWorktreeRef,
} from "../control/hybrid-scheduler.mjs";
import {
  acquireCustodyLease,
  bindCustodyProcess,
  commitTaskWorktreeTransfer,
  compileProcessAbsenceProof,
  compileProcessProvenance,
  compileQueueAbsenceProof,
  compileRuntimeCapability,
  compileRuntimeProtectedDecision,
  compileRuntimeReadOnlyDiscovery,
  compileSchedulerRuntimeCustodyPolicy,
  compileSchedulerRuntimeCustodyState,
  compileWorktreeTransferAck,
  inspectCustodyTimeouts,
  openSchedulerRuntimeCustodyStore,
  prepareRuntimeAction,
  prepareTaskWorktreeTransfer,
  queueCustodyJob,
  reconcileProcessInventory,
  recoverStaleQueuedJob,
  registerTaskOwnedWorktree,
  repairCustodyQueueIndex,
  requestCustodyCancellation,
  retryCustodyJob,
  settleCustodyJob,
  submitCustodyJob,
  validateProcessAbsenceProof,
  validateSchedulerRuntimeCustodyState,
  verifySchedulerRuntimeCustodyBinding,
} from "../control/scheduler-runtime-custody.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (value) => canonicalDigest({value});
const commit = "1".repeat(40);
const tree = "2".repeat(40);
const times = Array.from({length: 40}, (_, index) => new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString());
const worktreeRefA = opaqueSchedulerWorktreeRef("/fixture/worktree-a");
const worktreeRefB = opaqueSchedulerWorktreeRef("/fixture/worktree-b");

function request({id, requester, worktreeId, worktreeRef, resourceClass = "COMPILE_HEAVY"}) {
  return compileHybridSchedulerRequest({
    requestId: id,
    requesterId: requester,
    lane: `LANE-${id}`,
    repositoryId: "REPOSITORY-FIXTURE",
    worktreeId,
    candidateCommit: commit,
    candidateTreeOrDigest: tree,
    cleanState: true,
    resourceClass,
    workingDirectoryRef: worktreeRef,
    commandArgv: ["node", "fixture.mjs"],
    toolchainProfile: "NODE-HOST",
    proofClass: "FOCUSED-TEST",
    whyNeeded: "VERIFY-CUSTODY",
    expectedProof: "PASS",
  });
}

function worktree(worktreeId, repositoryId, workingDirectoryRef, ownerTaskId) {
  return {worktreeId, repositoryId, workingDirectoryRef, ownerTaskId, candidateCommit: commit, candidateTreeOrDigest: tree, dirtyPatchSha256: sha("clean")};
}

function provenance({pid, cwdRef, start = "start", minute = 4}) {
  return compileProcessProvenance({pid, ppid: 100, pgid: pid, cwdRef, executableSha256: sha("node-executable"), argvSha256: sha(`argv-${pid}`), startedAtUtc: times[minute], startIdentitySha256: sha(start)});
}

const policy = compileSchedulerRuntimeCustodyPolicy({lightweightCapacity: 2, maxAttempts: 2, queueTimeoutSeconds: 60, runTimeoutSeconds: 600, reservationTimeoutSeconds: 120});
assert.equal(policy.global_heavy.capacity, 1);
assert.deepEqual(policy.global_heavy.workload_classes, ["ARTIFACT_BUILD", "NODE_BUILD", "RENDER", "RUST_BUILD"]);
assert.equal(policy.controller_heavy_execution, "DENY");

let state = compileSchedulerRuntimeCustodyState({policy});
const initialDigest = state.state_sha256;
state = registerTaskOwnedWorktree({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[0], worktree: worktree("WORKTREE-A", "REPOSITORY-FIXTURE", worktreeRefA, "TASK-A")});
state = registerTaskOwnedWorktree({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[1], worktree: worktree("WORKTREE-B", "REPOSITORY-FIXTURE", worktreeRefB, "TASK-B")});
assert.throws(() => registerTaskOwnedWorktree({state, expectedStateSha256: initialDigest, actorId: "SCHEDULER-1", observedAtUtc: times[2], worktree: worktree("WORKTREE-C", "REPOSITORY-FIXTURE", worktreeRefB, "TASK-C")}), (error) => error?.code === "CUSTODY_CAS_MISMATCH");

const rustRequest = request({id: "REQUEST-RUST", requester: "WORKER-RUST", worktreeId: "WORKTREE-A", worktreeRef: worktreeRefA});
state = submitCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[2], request: rustRequest, requesterRole: "WORKING_AGENT", taskId: "TASK-A", workloadClass: "RUST_BUILD"});
state = queueCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[3], jobId: state.jobs.at(-1).job_id});
const rustJobId = state.jobs.at(-1).job_id;
state = acquireCustodyLease({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[4], jobId: rustJobId, leaseTokenSha256: sha("rust-lease")});
const rustLeaseId = state.jobs.find((job) => job.job_id === rustJobId).lease_id;
const rustProcess = provenance({pid: 2001, cwdRef: worktreeRefA, start: "rust-start"});
state = bindCustodyProcess({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[5], jobId: rustJobId, leaseTokenSha256: sha("rust-lease"), processProvenance: rustProcess});

// A Controller can observe state but can never directly request heavy execution.
const controllerRequest = request({id: "REQUEST-CONTROLLER", requester: "CONTROLLER-1", worktreeId: "WORKTREE-B", worktreeRef: worktreeRefB});
assert.throws(() => submitCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[6], request: controllerRequest, requesterRole: "CONTROLLER", taskId: "TASK-B", workloadClass: "NODE_BUILD"}), (error) => error?.code === "DIRECT_HEAVY_EXECUTION_DENIED");

const nodeRequest = request({id: "REQUEST-NODE", requester: "WORKER-NODE", worktreeId: "WORKTREE-B", worktreeRef: worktreeRefB});
state = submitCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[6], request: nodeRequest, requesterRole: "WORKING_AGENT", taskId: "TASK-B", workloadClass: "NODE_BUILD"});
const nodeJobId = state.jobs.at(-1).job_id;
state = queueCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[7], jobId: nodeJobId});
assert.throws(() => acquireCustodyLease({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[8], jobId: nodeJobId, leaseTokenSha256: sha("node-lease")}), (error) => error?.code === "CUSTODY_GLOBAL_HEAVY_MUTEX");

// Runtime build capability requires both independent protected authority and
// the exact active global heavyweight lease, but still cannot execute here.
const protectedBuild = compileRuntimeProtectedDecision({action: "BUILD", decidedByIdentity: "OWNER-AUTHORITY-1", subjectSha256: rustRequest.request_sha256});
assert.throws(() => compileRuntimeCapability({capabilityId: "CAPABILITY-BUILD-0", runtimeIdentity: "RUNTIME-1", action: "BUILD", projectRef: worktreeRefA, controlPlaneRef: opaqueSchedulerWorktreeRef("/fixture/control"), scopeRefs: [worktreeRefA], requestSha256: rustRequest.request_sha256}), (error) => error?.code === "RUNTIME_PROTECTED_DECISION_REQUIRED");
const buildCapability = compileRuntimeCapability({capabilityId: "CAPABILITY-BUILD-1", runtimeIdentity: "RUNTIME-1", action: "BUILD", projectRef: worktreeRefA, controlPlaneRef: opaqueSchedulerWorktreeRef("/fixture/control"), scopeRefs: [worktreeRefA], requestSha256: rustRequest.request_sha256, protectedDecision: protectedBuild, schedulerLease: state.leases.find((lease) => lease.lease_id === rustLeaseId)});
const buildPreparation = prepareRuntimeAction({capability: buildCapability, actionPlanSha256: sha("build-plan")});
assert.equal(buildPreparation.execution_authorized, false);
assert.deepEqual(buildPreparation.effects_applied, []);

const canonicalInventory = reconcileProcessInventory({state, observations: [{job_id: rustJobId, lease_id: rustLeaseId, process: rustProcess}], observerId: "RUNTIME-1", observedAtUtc: times[8]});
assert.equal(canonicalInventory.status, "CANONICAL");
const duplicateProcess = provenance({pid: 2002, cwdRef: worktreeRefA, start: "duplicate", minute: 5});
const noncanonicalInventory = reconcileProcessInventory({state, observations: [
  {job_id: rustJobId, lease_id: rustLeaseId, process: rustProcess},
  {job_id: rustJobId, lease_id: null, process: duplicateProcess},
  {job_id: null, lease_id: null, process: provenance({pid: 2003, cwdRef: worktreeRefB, start: "orphan", minute: 5})},
], observerId: "RUNTIME-1", observedAtUtc: times[9]});
assert.equal(noncanonicalInventory.status, "NONCANONICAL_PROCESS_FOUND");
assert(noncanonicalInventory.findings.some((finding) => finding.code === "DUPLICATE_PROCESS_NONCANONICAL"));
assert(noncanonicalInventory.findings.some((finding) => finding.code === "ORPHAN_PROCESS_NONCANONICAL"));
assert.deepEqual(noncanonicalInventory.effects_applied, [], "reconciliation must never terminate a process itself");

state = requestCustodyCancellation({state, expectedStateSha256: state.state_sha256, actorRole: "CONTROLLER", actorId: "CONTROLLER-1", observedAtUtc: times[10], jobId: rustJobId, reasonSha256: sha("cancel")});
const reusedProof = compileProcessAbsenceProof({jobId: rustJobId, leaseId: rustLeaseId, expectedProcess: rustProcess, observation: {status: "OBSERVED_PID_REUSED", pid: rustProcess.pid, observed_start_identity_sha256: sha("new-process-start"), probe_sha256: sha("host-probe")}, observerId: "RUNTIME-1", observedAtUtc: times[11]});
validateProcessAbsenceProof(reusedProof);
state = settleCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[12], jobId: rustJobId, outcome: "CANCELLED", terminalReason: "CANCELLED_AFTER_EXACT_INSTANCE_EXIT", absenceProof: reusedProof});
assert.equal(state.jobs.find((job) => job.job_id === rustJobId).status, "CANCELLED");

// The released heavy lock admits Node only after the exact Rust instance is
// proven absent. Merely observing the same PID identity cannot release it.
state = acquireCustodyLease({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[13], jobId: nodeJobId, leaseTokenSha256: sha("node-lease")});
const nodeLeaseId = state.jobs.find((job) => job.job_id === nodeJobId).lease_id;
const nodeProcess = provenance({pid: 2001, cwdRef: worktreeRefB, start: "node-start", minute: 13});
state = bindCustodyProcess({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[14], jobId: nodeJobId, leaseTokenSha256: sha("node-lease"), processProvenance: nodeProcess});
assert.throws(() => compileProcessAbsenceProof({jobId: nodeJobId, leaseId: nodeLeaseId, expectedProcess: nodeProcess, observation: {status: "OBSERVED_PID_REUSED", pid: nodeProcess.pid, observed_start_identity_sha256: nodeProcess.start_identity_sha256, probe_sha256: sha("bad-probe")}, observerId: "RUNTIME-1", observedAtUtc: times[15]}), (error) => error?.code === "PROCESS_ABSENCE_UNPROVEN");
const nodeAbsent = compileProcessAbsenceProof({jobId: nodeJobId, leaseId: nodeLeaseId, expectedProcess: nodeProcess, observation: {status: "OBSERVED_PID_ABSENT", pid: nodeProcess.pid, observed_start_identity_sha256: null, probe_sha256: sha("node-absent")}, observerId: "RUNTIME-1", observedAtUtc: times[15]});
state = settleCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[16], jobId: nodeJobId, outcome: "SUCCEEDED", terminalReason: "COMPLETED", absenceProof: nodeAbsent});

// Finite retry: the second failed attempt cannot queue a third.
const checkRequest = request({id: "REQUEST-CHECK", requester: "WORKER-CHECK", worktreeId: "WORKTREE-B", worktreeRef: worktreeRefB, resourceClass: "LIGHTWEIGHT_SOURCE_CHECK"});
state = submitCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[17], request: checkRequest, requesterRole: "WORKING_AGENT", taskId: "TASK-B", workloadClass: "LIGHTWEIGHT_CHECK"});
const checkJobId = state.jobs.at(-1).job_id;
state = queueCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[18], jobId: checkJobId});
state = acquireCustodyLease({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[19], jobId: checkJobId, leaseTokenSha256: sha("check-lease-1")});
let checkLeaseId = state.jobs.find((job) => job.job_id === checkJobId).lease_id;
let checkProcess = provenance({pid: 3001, cwdRef: worktreeRefB, start: "check-1", minute: 19});
state = bindCustodyProcess({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[20], jobId: checkJobId, leaseTokenSha256: sha("check-lease-1"), processProvenance: checkProcess});
let checkAbsent = compileProcessAbsenceProof({jobId: checkJobId, leaseId: checkLeaseId, expectedProcess: checkProcess, observation: {status: "OBSERVED_PID_ABSENT", pid: 3001, observed_start_identity_sha256: null, probe_sha256: sha("check-absent-1")}, observerId: "RUNTIME-1", observedAtUtc: times[21]});
state = settleCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[22], jobId: checkJobId, outcome: "FAILED", terminalReason: "FOCUSED_TEST_FAILED", absenceProof: checkAbsent});
state = retryCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[23], jobId: checkJobId, changedRouteSha256: sha("route-2")});
state = acquireCustodyLease({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[24], jobId: checkJobId, leaseTokenSha256: sha("check-lease-2")});
checkLeaseId = state.jobs.find((job) => job.job_id === checkJobId).lease_id;
checkProcess = provenance({pid: 3002, cwdRef: worktreeRefB, start: "check-2", minute: 24});
state = bindCustodyProcess({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[25], jobId: checkJobId, leaseTokenSha256: sha("check-lease-2"), processProvenance: checkProcess});
checkAbsent = compileProcessAbsenceProof({jobId: checkJobId, leaseId: checkLeaseId, expectedProcess: checkProcess, observation: {status: "OBSERVED_PID_ABSENT", pid: 3002, observed_start_identity_sha256: null, probe_sha256: sha("check-absent-2")}, observerId: "RUNTIME-1", observedAtUtc: times[26]});
state = settleCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[27], jobId: checkJobId, outcome: "FAILED", terminalReason: "FOCUSED_TEST_FAILED", absenceProof: checkAbsent});
assert.throws(() => retryCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[28], jobId: checkJobId, changedRouteSha256: sha("route-3")}), (error) => error?.code === "CUSTODY_RETRY_EXHAUSTED");

// Stale queued work and stale queue indexes require independent Runtime
// process-inventory absence evidence before recovery.
const staleRequest = request({id: "REQUEST-STALE", requester: "WORKER-STALE", worktreeId: "WORKTREE-B", worktreeRef: worktreeRefB, resourceClass: "LIGHTWEIGHT_SOURCE_CHECK"});
state = submitCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[0], request: staleRequest, requesterRole: "WORKING_AGENT", taskId: "TASK-B", workloadClass: "LIGHTWEIGHT_CHECK"});
const staleJobId = state.jobs.at(-1).job_id;
state = queueCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[1], jobId: staleJobId});
assert.equal(inspectCustodyTimeouts({state, observedAtUtc: times[10]}).status, "RECOVERY_EVIDENCE_REQUIRED");
const emptyInventory = reconcileProcessInventory({state, observations: [], observerId: "RUNTIME-1", observedAtUtc: times[10]});
const queueProof = compileQueueAbsenceProof({state, jobIds: [staleJobId], processReconciliation: emptyInventory, observerId: "RUNTIME-1", observedAtUtc: times[10]});
state = recoverStaleQueuedJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[10], jobId: staleJobId, queueAbsenceProof: queueProof});
assert.equal(state.jobs.find((job) => job.job_id === staleJobId).status, "INTERRUPTED");

const indexRequest = request({id: "REQUEST-INDEX", requester: "WORKER-INDEX", worktreeId: "WORKTREE-B", worktreeRef: worktreeRefB, resourceClass: "LIGHTWEIGHT_SOURCE_CHECK"});
state = submitCustodyJob({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[29], request: indexRequest, requesterRole: "WORKING_AGENT", taskId: "TASK-B", workloadClass: "LIGHTWEIGHT_CHECK"});
const indexJobId = state.jobs.at(-1).job_id;
const inventoryBeforeIndexDamage = reconcileProcessInventory({state, observations: [], observerId: "RUNTIME-1", observedAtUtc: times[30]});
const unsafeState = structuredClone(state);
unsafeState.queue_index = [];
unsafeState.state_sha256 = canonicalDigest({...unsafeState, state_sha256: null});
assert.throws(() => validateSchedulerRuntimeCustodyState(unsafeState), (error) => error?.code === "CUSTODY_QUEUE_INDEX_STALE");
const indexProof = compileQueueAbsenceProof({state: unsafeState, jobIds: [indexJobId], processReconciliation: inventoryBeforeIndexDamage, observerId: "RUNTIME-1", observedAtUtc: times[30]});
state = repairCustodyQueueIndex({unsafeState, expectedStateSha256: unsafeState.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[31], queueAbsenceProof: indexProof});
assert(state.queue_index.includes(indexJobId));

// Cancel the newly repaired submitted job, then transfer the task-owned
// worktree only after no active job remains and a successor ACK binds it.
state = requestCustodyCancellation({state, expectedStateSha256: state.state_sha256, actorRole: "CONTROLLER", actorId: "CONTROLLER-1", observedAtUtc: times[32], jobId: indexJobId, reasonSha256: sha("clear-for-transfer")});
state = prepareTaskWorktreeTransfer({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[33], transferId: "TRANSFER-B", worktreeId: "WORKTREE-B", fromTaskId: "TASK-B", toTaskId: "TASK-C", observedIdentity: {candidateCommit: commit, candidateTreeOrDigest: tree, dirtyPatchSha256: sha("clean")}});
const preparedWorktree = state.worktrees.find((entry) => entry.worktree_id === "WORKTREE-B");
const ack = compileWorktreeTransferAck({worktree: preparedWorktree, transferSha256: preparedWorktree.transfer.transfer_sha256, successorTaskId: "TASK-C"});
assert.throws(() => commitTaskWorktreeTransfer({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[34], transferId: "TRANSFER-B", successorAck: ack, observedIdentity: {candidateCommit: commit, candidateTreeOrDigest: tree, dirtyPatchSha256: sha("diverged")}}), (error) => error?.code === "CUSTODY_TRANSFER_DIVERGENCE");
state = commitTaskWorktreeTransfer({state, expectedStateSha256: state.state_sha256, actorId: "SCHEDULER-1", observedAtUtc: times[34], transferId: "TRANSFER-B", successorAck: ack, observedIdentity: {candidateCommit: commit, candidateTreeOrDigest: tree, dirtyPatchSha256: sha("clean")}});
assert.equal(state.worktrees.find((entry) => entry.worktree_id === "WORKTREE-B").owner_task_id, "TASK-C");
assert.equal(state.worktrees.find((entry) => entry.worktree_id === "WORKTREE-B").lease_epoch, 1);

// Read-only discovery is capability-bound, redacted, and effect-free.
const discoveryCapability = compileRuntimeCapability({capabilityId: "CAPABILITY-DISCOVERY-1", runtimeIdentity: "RUNTIME-1", action: "DISCOVER_READ_ONLY", projectRef: worktreeRefA, controlPlaneRef: opaqueSchedulerWorktreeRef("/fixture/control"), scopeRefs: [worktreeRefA], requestSha256: sha("discovery-request")});
const discovery = compileRuntimeReadOnlyDiscovery({capability: discoveryCapability, observedAtUtc: times[35], git: [sha("git")], build: [sha("build")], routing: [sha("routing")], hosting: [sha("hosting")], environments: [sha("environment")], secretInterfaces: [sha("secret-interface-only")]});
assert.equal(discovery.secrets_read, false);
assert.deepEqual(discovery.effects_applied, []);

const protectedDeploy = compileRuntimeProtectedDecision({action: "DEPLOY", decidedByIdentity: "OWNER-AUTHORITY-1", subjectSha256: sha("deploy-request")});
assert.throws(() => compileRuntimeCapability({capabilityId: "CAPABILITY-DEPLOY-0", runtimeIdentity: "RUNTIME-1", action: "DEPLOY", projectRef: worktreeRefA, controlPlaneRef: opaqueSchedulerWorktreeRef("/fixture/control"), scopeRefs: [worktreeRefA], requestSha256: sha("deploy-request")}), (error) => error?.code === "RUNTIME_PROTECTED_DECISION_REQUIRED");
const deployCapability = compileRuntimeCapability({capabilityId: "CAPABILITY-DEPLOY-1", runtimeIdentity: "RUNTIME-1", action: "DEPLOY", projectRef: worktreeRefA, controlPlaneRef: opaqueSchedulerWorktreeRef("/fixture/control"), scopeRefs: [worktreeRefA], requestSha256: sha("deploy-request"), protectedDecision: protectedDeploy});
assert.equal(prepareRuntimeAction({capability: deployCapability, actionPlanSha256: sha("deploy-plan")}).status, "PREPARED_NOT_EXECUTED");
const protectedRollback = compileRuntimeProtectedDecision({action: "ROLLBACK", decidedByIdentity: "OWNER-AUTHORITY-1", subjectSha256: sha("rollback-request")});
assert.throws(() => compileRuntimeCapability({capabilityId: "CAPABILITY-ROLLBACK-0", runtimeIdentity: "RUNTIME-1", action: "ROLLBACK", projectRef: worktreeRefA, controlPlaneRef: opaqueSchedulerWorktreeRef("/fixture/control"), scopeRefs: [worktreeRefA], requestSha256: sha("rollback-request"), protectedDecision: protectedRollback}), (error) => error?.code === "CUSTODY_DIGEST_INVALID");
const rollbackCapability = compileRuntimeCapability({capabilityId: "CAPABILITY-ROLLBACK-1", runtimeIdentity: "RUNTIME-1", action: "ROLLBACK", projectRef: worktreeRefA, controlPlaneRef: opaqueSchedulerWorktreeRef("/fixture/control"), scopeRefs: [worktreeRefA], requestSha256: sha("rollback-request"), protectedDecision: protectedRollback, rollbackIdentitySha256: sha("rollback-identity")});
assert.equal(prepareRuntimeAction({capability: rollbackCapability, actionPlanSha256: sha("rollback-plan")}).execution_authorized, false);

validateSchedulerRuntimeCustodyState(state);
assert.equal(state.events.length, state.revision);
assert.equal(state.status, "PREPARED_NOT_ACTIVATED");

// Host-safe persistence uses an exclusive file lock plus exact-state CAS. It
// never auto-recovers a PID-only lock: Runtime must prove the exact holder is
// absent, including PID-reuse identity.
const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-custody-store-"));
try {
  const storeOwner = provenance({pid: 4001, cwdRef: opaqueSchedulerWorktreeRef("/fixture/scheduler"), start: "store-owner", minute: 0});
  const store = openSchedulerRuntimeCustodyStore({authorityRoot: storeRoot, ownerProcessProvenance: storeOwner, initialState: compileSchedulerRuntimeCustodyState({policy}), clock: () => times[0]});
  const storedInitial = store.read();
  const storedNext = store.compareAndSwap({expectedStateSha256: storedInitial.state_sha256, transition: (current) => registerTaskOwnedWorktree({state: current, expectedStateSha256: current.state_sha256, actorId: "SCHEDULER-STORE", observedAtUtc: times[1], worktree: worktree("WORKTREE-STORE", "REPOSITORY-FIXTURE", opaqueSchedulerWorktreeRef("/fixture/store-worktree"), "TASK-STORE")})});
  assert.equal(storedNext.revision, 1);
  assert.equal(store.inspectLock(), null);
  const staleLock = {schema: "agentos.scheduler_runtime_custody_store_lock.v1", version: 1, status: "HELD", token_sha256: sha("stale-lock-token"), owner_process: storeOwner, acquired_at_utc: times[0], lock_sha256: null};
  staleLock.lock_sha256 = canonicalDigest({...staleLock, lock_sha256: null});
  fs.writeFileSync(path.join(store.root(), "cas.lock.json"), `${JSON.stringify(staleLock)}\n`, {flag: "wx", mode: 0o600});
  assert.throws(() => store.compareAndSwap({expectedStateSha256: storedNext.state_sha256, transition: () => storedNext}), (error) => error?.code === "CUSTODY_STORE_LOCK_HELD");
  const lockAbsence = compileProcessAbsenceProof({jobId: "CUSTODY-STORE", leaseId: "CUSTODY-STORE-LOCK", expectedProcess: storeOwner, observation: {status: "OBSERVED_PID_REUSED", pid: storeOwner.pid, observed_start_identity_sha256: sha("replacement-store-process"), probe_sha256: sha("store-lock-probe")}, observerId: "RUNTIME-1", observedAtUtc: times[2]});
  assert.equal(store.recoverLock({absenceProof: lockAbsence}).status, "STALE_LOCK_RELEASED");
  assert.equal(store.inspectLock(), null);
} finally {
  fs.rmSync(storeRoot, {recursive: true, force: true});
}

// Static typed/governance artifacts are part of the test, while exact file
// digests are separately enforced after the content-addressed binding exists.
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/scheduler-runtime-custody.v1.json"), "utf8"));
const migration = JSON.parse(fs.readFileSync(path.join(root, "migrations/scheduler-runtime-custody.v1.json"), "utf8"));
assert.equal(schema.$id, "agentos.scheduler_runtime_custody.v1");
assert.equal(migration.invalidation.authority_graph_change, "INVALIDATE_ALL_CUSTODY_STATES_RUNTIME_CAPABILITIES_AND_ROLE_MANIFESTS");
assert.equal(migration.effects.starts_processes, false);
assert.equal(migration.migration_sha256, canonicalDigest({...migration, migration_sha256: null}));
verifySchedulerRuntimeCustodyBinding({repositoryRoot: root});

console.log("PASS Scheduler/Runtime custody: global heavy mutex, exact process provenance, CAS queue/leases, bounded retry/cancel/recovery, PID reuse, worktree transfer, protected Runtime and binding verified");
