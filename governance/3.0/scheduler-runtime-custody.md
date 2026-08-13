# Scheduler and Runtime custody — prepared AgentOS 3 substrate

Status: `PREPARED_NOT_ACTIVATED`
Authority graph: `agentos.permanent_role_authority_graph.v1`

This substrate makes the existing permanent-role boundary executable without
starting any role or process. Scheduler owns durable queue, capacity,
worktree, and process custody. Runtime owns read-only environment discovery
and preparation of capability-bound build, deploy, and rollback actions.
Neither role may accept Product, appoint itself, rewrite owner intent, or
promote a release.

## Capacity and process law

- Rust builds, Node builds, rendering, and artifact builds share one global
  heavyweight mutex. At most one has an active lease on a host.
- Database-exclusive work has its own single slot. Lighter checks, bounded I/O,
  and bounded network observations use a configurable finite pool.
- A Controller, Intent Regulator, Agent Spawner/Compiler, or Scheduler cannot
  directly request heavyweight execution. A Scheduler cannot request any job.
- A job becomes `RUNNING` only after a CAS-bound lease records exact requester,
  task, worktree and epoch plus PID, PPID, PGID, opaque CWD identity,
  executable digest, argv digest, start identity, and process-instance digest.
- PID liveness alone is never identity evidence. Recovery requires a Runtime
  proof that the exact process instance is absent or that the PID was reused
  with a different start identity. Reused processes are never signalled by
  this portable controller.
- Duplicate and orphan process observations freeze the affected route for
  exact-group review. Inventory reconciliation is read-only and applies no
  termination effect.

## Queue, retry, cancellation, and recovery law

Every transition uses the prior `state_sha256` as a compare-and-swap fence and
appends a content-addressed event. Queue indexes are derived from job state.
The host-local store serializes those transitions with an exclusive regular-
file lock and atomic rename/readback. It does not recover a lock from PID
liveness alone; the exact lock-holder process identity must be proven absent.
Repairing a stale queue index or timing out a queued job requires a Runtime
inventory receipt proving no process custody exists for the exact affected
job IDs. Running cancellation enters `CANCEL_REQUESTED` and retains the lease
until exact process absence is proven. Retry is finite and requires a changed
route digest; the prior terminal event remains immutable.

## Task-owned worktree law

An agent lifecycle never owns the worktree. The task owns it. A transfer is a
two-phase transaction: Scheduler prepares against exact commit, tree/content,
dirty-patch digest, and lease epoch; the successor acknowledges the prepared
worktree digest; Scheduler verifies unchanged state and only then increments
the epoch and changes task ownership. Active jobs prohibit transfer.

## Runtime law

`DISCOVER_READ_ONLY` accepts only content-addressed observations for Git,
build, routing, hosting, environment, and secret-interface surfaces; it never
reads a secret or applies an effect. Build, deploy, and rollback are
default-denied. They require an independent protected-decision receipt; build
also requires the exact active Scheduler heavyweight lease, and rollback
requires an exact rollback identity. The portable Runtime emits only
`PREPARED_NOT_EXECUTED` records with `execution_authorized: false`. A later
host adapter must independently verify the same capability and may not be
controlled by Controller execution callbacks.

## Migration and invalidation

The v1 migration at `migrations/scheduler-runtime-custody.v1.json` adapts
historical hybrid-scheduler requests but never treats PID-only or per-class
leases as current custody. Existing live leases require exact process-absence
or fresh process-provenance rebind. Authority-graph changes invalidate all
custody states and Runtime capabilities. Policy changes invalidate active
lease manifests and require rebind; worktree identity changes fence jobs by
epoch. Historical evidence remains immutable.

The content-addressed binding is
`governance/3.0/scheduler-runtime-custody-binding.v1.json`. It grants no host,
build, deployment, rollback, authentication, publication, or activation
authority.
