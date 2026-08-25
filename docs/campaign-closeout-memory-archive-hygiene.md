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
