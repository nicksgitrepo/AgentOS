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

## Storage autopilot decision contract

The Controller records one digest-bound observation every 24 hours. The
observation has four explicitly different accounting buckets:
`APFS_PHYSICAL_FREE_AND_USED`, `PROJECT_LOGICAL`, `SYSTEM_LOGICAL`, and
`PROTECTED_LOGICAL`. Each bucket retains its provenance. Physical and logical
measurements that overlap are not added as independent reclaimable bytes; a
double-count claim is denied. The autopilot is an accounting and routing
decision, never cleanup or deletion authority.

The decision tree is deterministic at every boundary: above 80 GiB is healthy;
50–80 GiB opens orderly Controller cleanup while the current issue may finish,
verify, freeze, hand off, and (when above 25 GiB) deliver; at or below 50 GiB
the owner warning is recorded; at or below 25 GiB the hard operating floor
closes new work and waits for owner recovery authority. A next issue is not
admitted while the below-target transition is open. Ordinary agents do not
poll storage, and a task may not be stopped automatically merely because its
growth reaches 2 GiB or doubles.

macOS update/build settling is independent evidence: no installer or staged
update, quiet indexing, and two stable samples at least six hours apart. The
Controller may perform AgentOS cleanup planning while that update state is
unsettled, but it may not claim update readiness or bypass the headroom
requirement (20 GiB). System residue over 15 GiB above the settled baseline or
growing across three builds emits one deduplicated escalation. A settled build
rolls the baseline forward with source provenance.

Every generated or temporary path carries an owner task (or an explicit orphan
decision), purpose, creation time, regeneration proof, and retention/deletion
condition. Defaults remain seven-day temporary expiry, a retention reason after
30 days for generated artifacts, quarterly legacy review, bounded/rotated logs,
and cache cleanup only at a proven-safe closeout. Protected lifecycle classes,
active or unmerged custody, durable evidence, chat/session state, and ambiguous
references are never auto-deleted.

The universal discovery union includes live, pinned, non-pinned, archived,
not-loaded, interrupted, failed, idle, and active task projections; campaign
rosters; Controller, worktree, process, automation, State, Memory, handoff,
artifact, and authoritative host registries. Every deduplicated task identity
requires an independent direct readback and exactly one `PERMANENT_EXEMPT` or
`TEMPORARY_CLOSED` classification. Bounded pages, omitted identities, and an
archived app/host projection disagreement fail closed as
`ARCHIVED_REGISTRY_PROJECTION_DIVERGENCE` rather than implying absence.

If one exact path is blocked for one cycle, no route is emitted. The same path,
identity, and owner on the second cycle emits one deduplicated typed gate route;
an identity change resets the correlation. APFS calibration records estimated
bytes, actual bytes, and both ratio directions for every executed batch. These
receipts preserve the existing lifecycle classes and strict gates and are
safe to hand off without granting execution authority.

## Dual-key hygiene repair and zero-recovery scope

The hygiene repair lane is a portable, single-issue state machine with one
dedicated `AGENTOS.HYGIENE_REPAIR_WORKER` and one strictly read-only
`AGENTOS.HYGIENE_AUDITOR`. The Worker owns the bounded write custody and may
freeze at most one immutable candidate. The candidate routes directly to the
bound Auditor; a bounded failure returns the same issue to the same Worker for
a new generation. A Worker cannot accept its own candidate, and a general
roster or prototyping role cannot substitute for either key. Runtime alone may
deliver a fresh Auditor `PASS`; Controller alone may emit an
evidence-complete `TRUE_BLOCKED` liveness result. Receipts are compact and
deduplicated by issue, candidate, failure class, and evidence digest.

Zero-recovery inventory keeps the measured aggregate root and every selected
child as separate path, stable-identity, object-type, logical-byte, and
allocated-byte records. Recovery is the sum of exact eligible selected
objects only. An aggregate directory measurement is never assigned to tiny
receipt children; an empty selected-object set forces zero recovery, and any
child type, size, identity, escape, symlink, or sum mismatch fails closed.
Blank UI projections are corrected from an exact durable PASS/FAIL result once;
without a valid durable result, the typed Controller liveness blocker is
retained instead of being reported as a false stall.
