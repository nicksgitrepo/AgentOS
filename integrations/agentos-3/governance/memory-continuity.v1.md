# AgentOS 3 memory continuity v1

Status: `CANDIDATE_INACTIVE`

Version: `1.0.0`

This is a portable, project-agnostic, test-only extension of the exclusive
Memory M2 authority. It does not activate memory for a consumer, spawn or
archive a real agent, transfer a real Scheduler lease, deploy, or publish.

## Authority and custody

Every continuity call passes through the existing capability, external
authority-readback, and signed Memory M2 authority guard. Legacy project
memory cannot co-author the same project. The signed structured task and event
ledger is machine authority. `handoff.md` is an append-first human/LLM
projection of that signed checkpoint chain; unexpected projection bytes fail
closed and never become memory.

The task—not an agent—owns one persistent worktree identity. An agent holds a
generational lease. Archiving an agent can release that lease only after a
committed successor handoff and must record
`RETAINED_TASK_CUSTODY`; it never copies, removes, or cleans the worktree.
Seeds remain idle and no controller in this slice spawns an agent. The
`SPAWN_SUCCESSOR` transition only admits an externally verified spawn receipt.

## Immutable goal and append-first checkpoint chain

The opening task object permanently binds the original objective and success
criteria. Change uses a numbered, authority- and evidence-bound amendment;
the original goal is retained. An amendment changes the active goal digest and
invalidates any successor context or uncommitted handoff compiled from the old
digest.

Each checkpoint binds task, agent, generation, worktree ID and path, branch,
HEAD, tree, dirty-patch digest, sequence number, status, UTC time, active goal
digest, and predecessor checkpoint digest. Entries identify an event class,
an epistemic class (`FACT`, `CLAIM`, or `RECOMMENDATION`), evidence/provenance,
and an attempt disposition. `DISPROVEN`, `REJECTED`, and `BLOCKED` preserve
negative knowledge instead of letting a successor repeat a dead route.

The controller appends the deterministic Markdown projection after the signed
ledger commit. If a crash leaves the projection absent or prefix-truncated,
recovery appends only the missing signed suffix. A byte that is not a prefix of
the signed rendering is divergence and cannot be overwritten automatically.

The default 15-minute checkpoint interval is a failsafe. Lifecycle authority
is always the state machine. Material decisions, tests, discoveries, blockers,
risky boundaries, phase completion, and pre-compression state require event-
driven checkpoints rather than waiting for the timer.

## Chain failures and route change

Failure identity is the digest of normalized failure class, scope, cause, and
affected gate. The streak survives generation changes. The third successive
materially identical signature returns `ROUTE_CHANGE_REQUIRED` and the
controller refuses another handoff whose seed, role manifest, model/duty, and
strategy produce the same route digest. A materially changed and authorized
route may proceed. The controller never guesses a new protected model or role.

## Transactional successor handoff

The only accepted order is:

1. `PREPARE_HANDOFF`
2. `FREEZE_PREDECESSOR_WRITES`
3. `FINAL_CHECKPOINT`
4. `SPAWNER_VERIFY_WORKTREE_AND_EVIDENCE`
5. `CONSOLIDATE_SUCCESSOR_CONTEXT`
6. `SPAWN_SUCCESSOR` (verified external receipt only)
7. `SUCCESSOR_VERIFY_CHECKSUM`
8. `SUCCESSOR_ACK` or `DIVERGENCE`
9. `TRANSFER_TASK_WORKTREE_LEASE` (proposal only)
10. `VERIFY_HEAD_DIRTY_PATCH_AND_MANIFEST`
11. `HANDOFF_COMMITTED`
12. `ARCHIVE_PREDECESSOR`

Predecessor writes freeze before the final checkpoint. A successor checksum
binds context, checkpoint, active goal, worktree manifest, and role-context
manifest. Divergence leaves predecessor ownership unchanged. A proposed lease
transfer is not authoritative until exact state verification and
`HANDOFF_COMMITTED`; therefore disappearance before ACK, after ACK, or during
transfer remains recoverable from the predecessor. Only commit changes the
lease holder, and only a committed handoff permits predecessor archive.

## Migration, invalidation, and rollback

Existing projects are not silently adopted. Migration from the P0 stubs
requires an exclusive M2 binding, a typed task manifest, and a first signed
checkpoint. Goal amendment, worktree drift, role/seed change, or authority
change invalidates the corresponding successor material. Controller/schema
change invalidates the content binding and requires focused reevaluation.

Rollback disables the test capability while retaining the signed ledger and
task-owned worktree. No rollback path deletes project work. Unrecorded external
state after the last checkpoint is honestly outside recovery evidence; default
time-bounded exposure is 15 minutes, while material events are required to
checkpoint immediately.

## Evidence ceiling

The focused fixtures prove local deterministic replay, append-only projection
repair, typed negative knowledge, goal amendment, failure streaks across a
generation, checksum/ACK, proposed-transfer crash recovery, exact commit, and
archive ordering. Independent clearance, real process disappearance, real
Spawner/Scheduler integration, consumer adoption, activation, release
promotion, and publication remain untested.
