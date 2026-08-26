# Campaign closeout, Memory, and archive hygiene

This contract keeps closeout evidence durable, lane-scoped, and independent of
filesystem cleanup. A campaign may move through `CHECKPOINT_REACHED`,
`HANDOFF_READY`, and `AUDIT_ROUTED` only when the corresponding immutable
receipt is present. A missing projection, stale task readback, live process,
or ambiguous owner is a blocker; it is never evidence of absence.

## Custody rules

- Controller owns lifecycle transitions and recovery-roster generation.
- Runtime owns delivery authorization and returns a typed correlation receipt;
  delivery does not grant deletion authority.
- Memory receives only the filtered consolidation payload and its digest. Raw
  private payloads, credentials, and unrelated product custody never cross the
  boundary.
- Hygiene may perform a manifest-bound dry run and a freshly revalidated
  execution. Every existing path component is checked for symlink escape and
  the after-state is recorded.
- Archive is a lifecycle result, not filesystem deletion. Spawner must return a
  closed archive precheck before any bounded metadata prune.

## Temporary-task lifecycle

The permanent task remains monitored until all other closeout transitions are
complete, then drains last. Same-task permanent rebootstrap, temporary/permanent
overlap, wake-on-cleanup, and inferred acceptance from an active state are
forbidden. A live or ambiguously owned process keeps the lane open and produces
an evidence-complete blocker.

## Receipts and replay

Every receipt binds the task, turn, lane, source tree, manifest, authority,
parent receipt, and a content digest. Delivery and recovery are idempotent:
duplicate packets are acknowledged without a second transition, while a late
material item is preserved as post-checkpoint material. A receipt is consumed
exactly once; it cannot wake, rerun, redeliver, or silently close work.

The final handoff, Memory receipt, Runtime correlation, Controller recheck, and
Spawner archive result are retained with the candidate manifest. Cleanup may
remove only explicitly listed, non-live metadata after the closed result. No
route may mutate another product, shared repository, Memory source, or frozen
lane.

## Storage lifecycle and default retention

Every substantial generated path is classified as `ACTIVE_CUSTODY`,
`REGENERABLE`, `DELIVERY_EVIDENCE`, `RETAINED_RUNTIME_STATE`, or
`CLEANUP_ELIGIBLE`. Unclassified large paths are a Controller hygiene defect;
they are not deletion authority. Build products are not evidence: Cargo
`target`, `dist`, `.next`, `node_modules`, extracted dependency builds,
browser profiles, copied base/candidate trees, and per-run package stores are
`REGENERABLE` unless a narrower authority explicitly says otherwise.

Toolchains, registries, package stores, browser binaries, and source archives
are shared and content-addressed at product scope when practical. Independent
audits require immutable source identity and fresh commands, not permanent
duplicate toolchain or build directories. One lane may retain at most one
bounded runtime fixture for its current proof. A completed fixture is reduced
to a compact digest-bound dump when reproduction requires it; otherwise its
data directory becomes cleanup-eligible after delivery.

Delivery alone does not delete anything. A path becomes `CLEANUP_ELIGIBLE`
only after all of these facts are freshly proven:

- no active process, dirty bytes, live reference, or shared consumer;
- the owner released custody and the current checkpoint is complete;
- the filtered Memory/documentation handoff is complete;
- a worktree's exact commit and tree are preserved on the authorized remote;
- no active retention reason remains; and
- the exact relative path, estimated bytes, deletion condition, and evidence
  digest are bound into the cleanup manifest.

`DELIVERY_EVIDENCE` is retained by default. Photos, messages, mail, personal
documents, host task/session databases, canonical source shelves, dirty or
unmerged worktrees, unpushed commits, permanent-agent custody, and ambiguous
runtime state are never automatic hygiene targets.

## Controller cadence

Controller performs the scheduled storage check once per 24 hours. The
80–100 GB range is a cleanup target, not an execution floor; ordinary work may
continue below it. At or below 50 GB Controller warns the owner and closes the
current issue before starting new work. At or below 25 GB no storage-heavy new
work starts. Cleanup resumes work only after manifest-bound execution and a
fresh after-state receipt.
