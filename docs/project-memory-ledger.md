# Project memory ledger

Status: `PREPARED_NOT_ACTIVATED`

This document describes the portable project-memory contract. It is not a
project record, acceptance decision, activation permission, or substitute for a
typed project contract.

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
never stores a transcript or host-bound path.

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

Private ledger and snapshot files live below an external authority root, separate
from the repository. Relative paths cannot traverse, and existing parent
components and files must not be symbolic links. Appends use a lock, expected
head compare-and-swap, contiguous sequence, idempotency, durable write, and
readback validation. Snapshot replacement stages a regular file, fsyncs it,
atomically renames it, fsyncs the containing directory, and validates the
readback. Blank ledger lines and malformed JSON are corruption, not empty state.

The authority root may be unavailable or locked. The honest result is a typed
unavailable/conflict outcome with the exact safe recovery route; deleting a lock,
guessing a head, or rebuilding from a projection is not recovery.

## Projection states

`READY` means the canonical replay has a current context, no active invalidation,
no unresolved conflict, and no dependency uncertainty. `PARTIAL`, `STALE`,
`CONFLICT`, and `UNAVAILABLE` carry explicit notices. Active invalidations are
derived from current ledger records even when the caller does not repeat them as
an argument. A stale map or index requires an appended invalidation before it
can be represented as current context. Map campaign, goal, project, and role
scope must match the snapshot binding.

## Privacy and evidence

Only opaque references and digests cross the portable boundary. Absolute paths,
worktree paths, environment values, secrets, session/task identities, private
links, and raw transcripts are rejected by the shared privacy scanner. Research
or owner decisions that are not available remain unknown; they are never
invented from a summary or fixture. Functional verification and independent
clearance are separate evidence steps and remain pending until explicitly run.

