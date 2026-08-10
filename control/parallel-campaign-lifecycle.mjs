#!/usr/bin/env node

/*
 * Host-neutral campaign lifecycle engine.
 *
 * Record schemas, identity binding, and state validation live in the records
 * module. This facade preserves the lifecycle API while owning scheduling,
 * leases, execution custody, progress/handoffs, audit transitions, and
 * closure.
 */

import {compareUtf8} from "./content-addressing.mjs";
import {
  assert,
  clone,
  compileAudit,
  compileEvent,
  compileFailure,
  compileHandoff,
  compileLease,
  compileProgress,
  createParallelCampaignState,
  digestWithout,
  exactKeys,
  requireOpaqueSessionRef,
  requireUtc,
  validateParallelCampaignPlan,
  validateParallelCampaignProgress,
  validateParallelCampaignHandoff,
  validateParallelCampaignAudit,
  validateParallelCampaignState,
} from "./parallel-campaign-records.mjs";

export {
  CAMPAIGN_STATES,
  LEASE_STATES,
  MEANINGFUL_RESULT_TYPES,
  PARALLEL_CAMPAIGN_AUDIT_SCHEMA,
  PARALLEL_CAMPAIGN_EVENT_SCHEMA,
  PARALLEL_CAMPAIGN_FAILURE_SCHEMA,
  PARALLEL_CAMPAIGN_HANDOFF_SCHEMA,
  PARALLEL_CAMPAIGN_LEASE_SCHEMA,
  PARALLEL_CAMPAIGN_PLAN_SCHEMA,
  PARALLEL_CAMPAIGN_PROGRESS_SCHEMA,
  PARALLEL_CAMPAIGN_STATE_SCHEMA,
  PARALLEL_CAMPAIGN_WORKER_SCHEMA,
  WORKER_STATES,
  compileParallelCampaignPlan,
  opaqueSessionRef,
  validateParallelCampaignAudit,
  validateParallelCampaignHandoff,
  validateParallelCampaignPlan,
  validateParallelCampaignProgress,
  validateParallelCampaignState,
  workerDisplayName,
} from "./parallel-campaign-records.mjs";

function addMinutes(isoUtc, minutes) {
  return new Date(Date.parse(isoUtc) + minutes * 60_000).toISOString();
}

function timestamp(value, clock) {
  const result = value ?? clock();
  requireUtc(result, "operation time");
  return result;
}

function findWorker(state, laneId) {
  const worker = state.workers.find((candidate) => candidate.lane_id === laneId);
  assert(worker, "unknown campaign lane " + laneId);
  return worker;
}

function activeLease(worker, leaseId) {
  assert(worker.lease !== null, "lane " + worker.lane_id + " has no lease");
  assert(worker.lease.lease_id === leaseId, "lane " + worker.lane_id + " lease does not match");
  assert(worker.lease.status === "ACTIVE", "lane " + worker.lane_id + " lease is not active");
}

function ensureNotExpired(worker, atUtc) {
  assert(Date.parse(atUtc) <= Date.parse(worker.lease.expires_at_utc), "lane " + worker.lane_id + " lease has expired");
}

function dependencyComplete(state, worker) {
  return worker.dependencies.every((laneId) => findWorker(state, laneId).state === "CLOSED");
}

function readyWorkers(state) {
  return state.workers
    .filter((worker) => worker.state === "READY" && dependencyComplete(state, worker))
    .sort((left, right) => compareUtf8(left.lane_id, right.lane_id));
}

function activeWorkers(state) {
  return state.workers.filter((worker) => worker.lease?.status === "ACTIVE");
}

function selectReadyWorkers(state) {
  const available = Math.max(0, state.policy.max_concurrent_workers - activeWorkers(state).length);
  const selected = [];
  const scopes = new Set(activeWorkers(state).map((worker) => worker.writable_scope));
  for (const worker of readyWorkers(state)) {
    if (selected.length >= available) break;
    if (scopes.has(worker.writable_scope)) continue;
    selected.push(worker);
    scopes.add(worker.writable_scope);
  }
  return selected;
}

export function createParallelCampaignLifecycle({
  plan,
  initialState = null,
  persist = null,
  clock = () => new Date().toISOString(),
} = {}) {
  validateParallelCampaignPlan(plan);
  assert(typeof clock === "function", "parallel campaign clock must be a function");
  assert(persist === null || typeof persist === "function", "parallel campaign persist callback must be a function");

  let state = initialState === null ? createParallelCampaignState(plan) : clone(initialState);
  validateParallelCampaignState(state, plan);

  function snapshot() {
    return clone(state);
  }

  function workerSnapshot(laneId) {
    return clone(findWorker(state, laneId));
  }

  function snapshotValue(value) {
    return clone(value);
  }

  function commit({
    eventType,
    workerRef = null,
    leaseId = null,
    payload = {},
    atUtc,
    toCampaignStatus = state.status,
    mutate,
  }) {
    const observedAtUtc = timestamp(atUtc, clock);
    const previous = state;
    const next = clone(state);
    mutate(next);
    next.events.push(compileEvent(previous, {
      eventType,
      workerRef,
      leaseId,
      payload,
      observedAtUtc,
      toCampaignStatus,
    }));
    next.state_sha256 = digestWithout(next, "state_sha256");
    validateParallelCampaignState(next, plan);
    if (persist !== null) {
      const persisted = persist({
        expected_state_sha256: previous.state_sha256,
        state: snapshotValue(next),
      });
      assert(persisted !== false, "parallel campaign state persistence was rejected");
    }
    state = next;
    return snapshot();
  }

  function acquireWorker(laneId, {atUtc = null} = {}) {
    const worker = findWorker(state, laneId);
    assert(
      ["PREPARED_NOT_ACTIVATED", "RUNNING"].includes(state.status),
      "campaign is not accepting worker leases",
    );
    assert(worker.state === "READY", "lane " + laneId + " is not ready for a lease");
    assert(dependencyComplete(state, worker), "lane " + laneId + " dependencies are incomplete");
    assert(
      activeWorkers(state).length < state.policy.max_concurrent_workers,
      "campaign concurrency limit is exhausted",
    );
    assert(
      !activeWorkers(state).some((candidate) => candidate.writable_scope === worker.writable_scope),
      "writable scope " + worker.writable_scope + " is already leased",
    );
    const lease = compileLease(plan, worker, timestamp(atUtc, clock));
    return commit({
      eventType: "WORKER_LEASE_ACQUIRED",
      workerRef: worker.worker_ref,
      leaseId: lease.lease_id,
      payload: {
        lane_id: worker.lane_id,
        worker_ref: worker.worker_ref,
        writable_scope: worker.writable_scope,
        lease_epoch: lease.epoch,
      },
      atUtc,
      toCampaignStatus: "RUNNING",
      mutate(next) {
        const target = findWorker(next, laneId);
        target.state = "LEASED";
        target.lease = lease;
        next.status = "RUNNING";
      },
    });
  }

  function renewLease(laneId, leaseId, {atUtc = null} = {}) {
    const worker = findWorker(state, laneId);
    activeLease(worker, leaseId);
    const now = timestamp(atUtc, clock);
    ensureNotExpired(worker, now);
    return commit({
      eventType: "WORKER_LEASE_RENEWED",
      workerRef: worker.worker_ref,
      leaseId,
      payload: {lane_id: laneId, lease_epoch: worker.lease.epoch},
      atUtc,
      mutate(next) {
        const target = findWorker(next, laneId);
        target.lease.renewed_at_utc = now;
        target.lease.expires_at_utc = addMinutes(now, plan.policy.progress_window_minutes);
        target.lease.lease_sha256 = digestWithout(target.lease, "lease_sha256");
      },
    });
  }

  function startWorker(laneId, leaseId, sessionRef, {atUtc = null} = {}) {
    const worker = findWorker(state, laneId);
    activeLease(worker, leaseId);
    assert(worker.state === "LEASED", "lane " + laneId + " must be LEASED before it starts");
    const now = timestamp(atUtc, clock);
    ensureNotExpired(worker, now);
    requireOpaqueSessionRef(sessionRef, "worker session reference");
    assert(
      !state.workers.some((candidate) => candidate.session_ref === sessionRef),
      "worker session reference is already in use",
    );
    return commit({
      eventType: "WORKER_SESSION_BOUND",
      workerRef: worker.worker_ref,
      leaseId,
      payload: {lane_id: laneId, worker_ref: worker.worker_ref, session_ref: sessionRef},
      atUtc,
      mutate(next) {
        const target = findWorker(next, laneId);
        target.state = "RUNNING";
        target.session_ref = sessionRef;
      },
    });
  }

  function recordProgress(laneId, leaseId, input, {atUtc = null} = {}) {
    const worker = findWorker(state, laneId);
    activeLease(worker, leaseId);
    assert(worker.state === "RUNNING", "lane " + laneId + " must be RUNNING before progress");
    const now = timestamp(atUtc, clock);
    ensureNotExpired(worker, now);
    exactKeys(input, ["result_type", "summary", "artifact_sha256", "evidence_sha256"], "worker progress input");
    const progress = compileProgress({
      plan,
      worker,
      sessionRef: worker.session_ref,
      resultType: input.result_type,
      summary: input.summary,
      artifactSha256: input.artifact_sha256,
      evidenceSha256: input.evidence_sha256,
      observedAtUtc: now,
    });
    validateParallelCampaignProgress(progress, plan, worker);
    return commit({
      eventType: "WORKER_MEANINGFUL_PROGRESS",
      workerRef: worker.worker_ref,
      leaseId,
      payload: {
        lane_id: laneId,
        worker_ref: worker.worker_ref,
        progress_sha256: progress.progress_sha256,
        result_type: progress.result_type,
      },
      atUtc,
      mutate(next) {
        const target = findWorker(next, laneId);
        target.state = "PROGRESS_RECORDED";
        target.progress = progress;
      },
    });
  }

  function recordHandoff(laneId, leaseId, {atUtc = null} = {}) {
    const worker = findWorker(state, laneId);
    activeLease(worker, leaseId);
    assert(
      worker.state === "PROGRESS_RECORDED",
      "lane " + laneId + " must record meaningful progress before handoff",
    );
    const now = timestamp(atUtc, clock);
    ensureNotExpired(worker, now);
    const handoff = compileHandoff({
      plan,
      worker,
      progress: worker.progress,
      observedAtUtc: now,
    });
    validateParallelCampaignHandoff(handoff, plan, worker, worker.progress);
    return commit({
      eventType: "WORKER_HANDOFF_READY",
      workerRef: worker.worker_ref,
      leaseId,
      payload: {
        lane_id: laneId,
        worker_ref: worker.worker_ref,
        handoff_sha256: handoff.handoff_sha256,
      },
      atUtc,
      mutate(next) {
        const target = findWorker(next, laneId);
        target.state = "HANDOFF_READY";
        target.handoff = handoff;
      },
    });
  }

  function acceptHandoff(laneId, leaseId, input, {atUtc = null} = {}) {
    const worker = findWorker(state, laneId);
    activeLease(worker, leaseId);
    assert(worker.state === "HANDOFF_READY", "lane " + laneId + " must have a ready handoff");
    const now = timestamp(atUtc, clock);
    ensureNotExpired(worker, now);
    exactKeys(
      input,
      ["auditor_ref", "auditor_session_ref", "accepted", "evidence_sha256"],
      "Auditor handoff input",
    );
    assert(
      !state.workers.some((candidate) => candidate.worker_ref === input.auditor_ref),
      "Auditor reference belongs to a campaign worker",
    );
    assert(
      !state.workers.some((candidate) => candidate.session_ref === input.auditor_session_ref),
      "Auditor session belongs to a campaign worker",
    );
    const audit = compileAudit({
      plan,
      worker,
      handoff: worker.handoff,
      auditorRef: input.auditor_ref,
      auditorSessionRef: input.auditor_session_ref,
      accepted: input.accepted,
      evidenceSha256: input.evidence_sha256,
      observedAtUtc: now,
    });
    validateParallelCampaignAudit(audit, plan, worker, worker.handoff);
    return commit({
      eventType: audit.accepted ? "WORKER_HANDOFF_ACCEPTED" : "WORKER_HANDOFF_REJECTED",
      workerRef: worker.worker_ref,
      leaseId,
      payload: {
        lane_id: laneId,
        worker_ref: worker.worker_ref,
        auditor_ref: audit.auditor_ref,
        audit_sha256: audit.audit_sha256,
        accepted: audit.accepted,
      },
      atUtc,
      toCampaignStatus: audit.accepted ? state.status : "BLOCKED",
      mutate(next) {
        const target = findWorker(next, laneId);
        target.audit = audit;
        if (audit.accepted) {
          target.state = "CLOSING";
        } else {
          target.state = "REPAIR_REQUIRED";
          target.lease.status = "FENCED";
          target.lease.released_at_utc = now;
          target.lease.release_reason = "AUDIT_REJECTED";
          target.lease.lease_sha256 = digestWithout(target.lease, "lease_sha256");
          next.status = "BLOCKED";
        }
      },
    });
  }

  function closeWorker(laneId, leaseId, {atUtc = null} = {}) {
    const worker = findWorker(state, laneId);
    activeLease(worker, leaseId);
    assert(worker.state === "CLOSING", "lane " + laneId + " must be CLOSING before closure");
    const now = timestamp(atUtc, clock);
    ensureNotExpired(worker, now);
    const allOtherWorkersClosed = state.workers.every(
      (candidate) => candidate.lane_id === laneId || candidate.state === "CLOSED",
    );
    const toCampaignStatus = allOtherWorkersClosed ? "CLOSED" : state.status;
    return commit({
      eventType: "WORKER_CLOSED",
      workerRef: worker.worker_ref,
      leaseId,
      payload: {
        lane_id: laneId,
        worker_ref: worker.worker_ref,
        closure: "LEASE_RELEASED",
      },
      atUtc,
      toCampaignStatus,
      mutate(next) {
        const target = findWorker(next, laneId);
        target.state = "CLOSED";
        target.lease.status = "RELEASED";
        target.lease.released_at_utc = now;
        target.lease.release_reason = "NORMAL_CLOSURE";
        target.lease.lease_sha256 = digestWithout(target.lease, "lease_sha256");
        if (toCampaignStatus === "CLOSED") {
          next.status = "CLOSED";
          next.closed_at_utc = now;
        }
      },
    });
  }

  function failWorker(
    laneId,
    leaseId,
    error,
    {
      code = "WORKER_EXECUTION_FAILED",
      atUtc = null,
      leaseStatus = "RELEASED",
      releaseReason = "WORKER_FAILURE",
    } = {},
  ) {
    const worker = findWorker(state, laneId);
    activeLease(worker, leaseId);
    assert(
      !["CLOSED", "FAILED", "REPAIR_REQUIRED"].includes(worker.state),
      "lane " + laneId + " is already terminal",
    );
    const now = timestamp(atUtc, clock);
    const failure = compileFailure({
      plan,
      worker,
      leaseId,
      error,
      code,
      observedAtUtc: now,
    });
    const nextStatus = "BLOCKED";
    return commit({
      eventType: "WORKER_FAILED",
      workerRef: worker.worker_ref,
      leaseId,
      payload: {
        lane_id: laneId,
        worker_ref: worker.worker_ref,
        failure_sha256: failure.failure_sha256,
        code: failure.code,
      },
      atUtc,
      toCampaignStatus: nextStatus,
      mutate(next) {
        const target = findWorker(next, laneId);
        target.state = "FAILED";
        target.failure = failure;
        target.lease.status = leaseStatus;
        target.lease.released_at_utc = now;
        target.lease.release_reason = releaseReason;
        target.lease.lease_sha256 = digestWithout(target.lease, "lease_sha256");
        next.status = nextStatus;
      },
    });
  }

  function expireLease(laneId, leaseId, {atUtc = null} = {}) {
    const worker = findWorker(state, laneId);
    activeLease(worker, leaseId);
    const now = timestamp(atUtc, clock);
    assert(
      Date.parse(now) > Date.parse(worker.lease.expires_at_utc),
      "lane " + laneId + " lease has not expired",
    );
    const error = new Error("lease expired before a complete handoff");
    return failWorker(laneId, leaseId, error, {
      code: "LEASE_EXPIRED",
      atUtc: now,
      leaseStatus: "EXPIRED",
      releaseReason: "LEASE_EXPIRED",
    });
  }

  async function run({executeWorker, auditHandoff} = {}) {
    assert(typeof executeWorker === "function", "parallel campaign executeWorker callback is required");
    assert(typeof auditHandoff === "function", "parallel campaign auditHandoff callback is required");
    while (!["BLOCKED", "CLOSED"].includes(state.status)) {
      const selected = selectReadyWorkers(state);
      if (selected.length === 0) {
        if (state.workers.every((worker) => worker.state === "CLOSED")) break;
        throw new Error("parallel campaign scheduler found no runnable lane");
      }
      const leases = selected.map((worker) => {
        const next = acquireWorker(worker.lane_id);
        return {
          laneId: worker.lane_id,
          leaseId: findWorker(next, worker.lane_id).lease.lease_id,
        };
      });
      const settled = await Promise.allSettled(leases.map(async ({laneId, leaseId}) => {
        try {
          const assignment = plan.lanes.find((lane) => lane.lane_id === laneId);
          const workerBeforeStart = workerSnapshot(laneId);
          const output = await executeWorker({
            assignment: clone(assignment),
            worker: workerBeforeStart,
            lease: clone(workerBeforeStart.lease),
          });
          exactKeys(output, ["session_ref", "progress"], "worker execution output");
          startWorker(laneId, leaseId, output.session_ref);
          recordProgress(laneId, leaseId, output.progress);
          recordHandoff(laneId, leaseId);
          const workerBeforeAudit = workerSnapshot(laneId);
          const audit = await auditHandoff({
            worker: workerBeforeAudit,
            handoff: clone(workerBeforeAudit.handoff),
            progress: clone(workerBeforeAudit.progress),
          });
          acceptHandoff(laneId, leaseId, audit);
          if (findWorker(state, laneId).state === "CLOSING") closeWorker(laneId, leaseId);
        } catch (error) {
          const current = findWorker(state, laneId);
          if (
            current.lease?.status === "ACTIVE"
            && !["FAILED", "REPAIR_REQUIRED", "CLOSED"].includes(current.state)
          ) {
            failWorker(laneId, leaseId, error, {code: error?.code ?? "WORKER_EXECUTION_FAILED"});
          }
        }
      }));
      const persistenceFailure = settled.find((result) => result.status === "rejected");
      if (persistenceFailure) throw persistenceFailure.reason;
    }
    if (state.status === "RUNNING" && state.workers.every((worker) => worker.state === "CLOSED")) {
      const now = timestamp(null, clock);
      commit({
        eventType: "CAMPAIGN_CLOSED",
        payload: {campaign_id: plan.campaign_id, campaign_version: plan.campaign_version},
        atUtc: now,
        toCampaignStatus: "CLOSED",
        mutate(next) {
          next.status = "CLOSED";
          next.closed_at_utc = now;
        },
      });
    }
    return snapshot();
  }

  return Object.freeze({
    snapshot,
    worker: workerSnapshot,
    readyAssignments: () => readyWorkers(state).map(
      (worker) => clone(plan.lanes.find((lane) => lane.lane_id === worker.lane_id)),
    ),
    acquireWorker,
    renewLease,
    startWorker,
    recordProgress,
    recordHandoff,
    acceptHandoff,
    closeWorker,
    failWorker,
    expireLease,
    run,
  });
}

