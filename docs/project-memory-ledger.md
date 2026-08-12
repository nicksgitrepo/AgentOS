# Project memory ledger

Status: `PREPARED_NOT_ACTIVATED`

This document describes the portable project-memory contract and its opt-in
operational candidate. It is not a project record, acceptance decision,
activation permission, or substitute for a typed project contract.

## Authority and boundaries

The canonical authority is the ordered event ledger. Each event contains one
content-addressed record and is bound to the project, campaign, goal, role,
source commit/tree/snapshot, policy, and handoff digests. A record or event that
does not validate its binding, digest, privacy classification, prior head, or
sequence is unavailable and cannot be treated as current truth.

Snapshots, invalidation sets, maps, indexes, and role capsules are derived
projections. They are advisory only and cannot grant acceptance, activation,
publication, deployment, spending, or other protected authority. A role capsule
contains selected record digests and explicit allowed and prohibited scopes; it
never stores a transcript or host-bound path. The operational runtime may
resolve those digests to privacy-screened semantic artifacts below the external
authority root. Artifacts remain advisory, content-addressed, project-scoped,
and outside the Product repository.

## Replay and lifecycle

Replay starts at the zero digest and validates every event in sequence. A
`RECORD_SUPERSEDED` event carries the current successor and its pointer to an
earlier record. The old record remains preserved in history while the replayed
current set excludes it. A supersession that points to a future event is
rejected. Divergent records with one logical key produce an explicit conflict
state; a conflict record must match the logical key of every referenced record
that is available in the ledger. A rejected external candidate may remain an
explicitly unavailable side of an unresolved conflict.

Restart reconstruction must be deterministic. It must preserve unresolved
conflicts, invalidations, uncertainty notices, and recovery obligations rather
than silently choosing a plausible branch.

## Storage and recovery

Private ledger, semantic artifact, and snapshot files live below an external
authority root, separate from the repository. Relative paths cannot traverse,
and existing parent components and files must not be symbolic links. Appends
use a lock, expected-head compare-and-swap, contiguous sequence, idempotency,
complete-ledger atomic replacement, durable write, and readback validation. The
old or new complete ledger survives an interrupted replacement; an append never
intentionally exposes a partial JSONL tail. Snapshot replacement stages a
regular file, fsyncs it, atomically renames it, fsyncs the containing directory,
and validates the readback. Blank ledger lines and malformed JSON are
corruption, not empty state.

The authority root may be unavailable or locked. Locks carry a content-addressed
host-process lease. Recovery preserves the lock as evidence and proceeds only
when the recorded process is provably absent; a live, malformed, ambiguous, or
permission-hidden owner fails closed. Deleting a lock, guessing a head, or
rebuilding canonical truth from a projection is not recovery.

The operational loader always reads and replays the ledger first. A missing,
wrong-binding, stale-head, or stale-cursor snapshot is rebuilt through snapshot
CAS before a role capsule is returned. A structurally valid stale snapshot is
never treated as current memory.

## Bootstrap and task-context integration

When a caller explicitly supplies a validated project contract and exact Memory
binding, Bootstrap writes privacy-screened context, intent, plan, governance,
boundary, goal, acceptance, and decision artifacts; appends their canonical
records; rebuilds the current snapshot; and returns a role-scoped hydrated
Memory state. Repeating the same capture is idempotent.

The runtime bridge converts hydrated artifacts into `MEMORY_AUTHORITY` /
`MEMORY_RECORD` task-context items while keeping payload bytes transient. The
ordinary task-context policy must still explicitly allow bound Memory. A role or
lane never receives a prohibited scope merely because the artifact exists.

An authoritative capsule import accepts only an exact binding, validates the
existing destination as an exact prefix, appends the missing canonical events
by CAS, verifies the final head, and returns a content-addressed receipt.
Divergent or later destination history fails closed. Capsule artifacts remain
`REFERENCE_ONLY`; transferring semantic payloads requires a separately admitted
authority path and is not implied by ledger import.

## Projection states

`READY` means the canonical replay has a current context, no active invalidation,
no unresolved conflict, and no dependency uncertainty. `PARTIAL`, `STALE`,
`CONFLICT`, and `UNAVAILABLE` carry explicit notices. Active invalidations are
derived from current ledger records even when the caller does not repeat them as
an argument. A stale map or index requires an appended invalidation before it
can be represented as current context. Map campaign, goal, project, and role
scope must match the snapshot binding.

## Privacy and evidence

Canonical records and portable capsules contain only opaque references and
digests. Semantic artifact payloads remain inside the external authority root
and pass the shared privacy scanner before addressing and again on read.
Absolute paths, worktree paths, environment values, secrets, session/task
identities, private links, and raw transcripts are rejected. Research or owner
decisions that are not available remain unknown; they are never invented from a
summary or fixture.

Focused functional proof now covers Bootstrap capture, semantic hydration,
task-context conversion, idempotent restart, stale-snapshot rebuilding,
authoritative exact-binding capsule import, project-tree isolation, privacy
rejection, wrong-binding snapshot rebuilding, reference-only import degradation,
divergent-import rejection, live-lock preservation, and proven-dead-process lock
recovery. Encryption, provider/cloud
synchronization, changed-binding migration, rollback, compaction, and portable
semantic-payload transfer remain explicitly unavailable. The contract remains
`PREPARED_NOT_ACTIVATED` until independent clearance and an activation decision.
