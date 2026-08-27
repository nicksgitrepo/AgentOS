# Agent Spawner lifecycle

The Agent Spawner is a persistent project-agnostic compiler role, not an
implicit temporary worker and not a wave-activation shortcut.

It has two deliberately separate modes:

- `COMPILER_ONLY` — the compiler may perform bounded local block compilation,
  QA, and typed roster projection work. `COMPILER_ACTIVE` is a real persistent
  lifecycle state for that compiler: it stays alive and event-driven while
  independent admission is pending, but it never means governed worker
  spawning is active. It cannot spawn a worker, touch a Product, access a
  provider or credential, sync externally, or poll a protected dependency.
- `GOVERNED_SPAWN` — admission and activation require complete blocks,
  independent clearance, and a project-bound spawn-adapter readback. A static
  QA pass is never sufficient.

The readback exposes the persistent lifecycle state as one of `PREPARED`,
`QA_READY`, `COMPILER_ACTIVE`, `ADMITTED`, `ACTIVE`, or `STALLED`, separately
from temporary worker admission and wave activation. A
protected hold moves the persistent role to `STALLED`, clears resources, and
waits for a typed owner or protected-dependency event. It never uses a heartbeat
as a substitute for that event.

The executable contract is in
`control/agent-spawner-lifecycle.mjs`; the machine-readable contract is
`schemas/agent-spawner-lifecycle.v1.json`. The focused hostile coverage is
`tests/verify-agent-spawner-lifecycle.mjs`.

## Controller-owned storage decision tree

Storage is a Controller observation, not an ordinary-agent polling loop.  The
Controller emits at most one content-addressed daily receipt per 24-hour
window (`agentos.agent_spawner_storage_governance.v1`); ordinary agents must
not poll the host or use a disk threshold as a routine test gate.

The cleanup target is 80–100 GiB free space and is not a work-stopping floor.
When a daily reading is below 80 GiB, the Controller may finish and verify the
current issue, freeze the exact candidate, complete its authorized handoff and
Runtime delivery, deny admission of the next issue while it performs
custody-safe cleanup, and resume next-issue admission only after that
transition closes.  A 79 GiB ordinary compile or test therefore continues.

At or below 50 GiB the receipt adds a subtle owner warning.  At or below 25
GiB the Controller fails closed for new or storage-heavy work, preserves and
freezes active or unmerged custody with only minimum required writes, alerts
the owner, and waits for recovery authority.  If cleanup cannot reach 80 GiB,
the owner is alerted and ordinary work may resume once the cleanup transition
has closed and free space is above 25 GiB.  Active or ambiguous custody is
never deleted or cleaned; only proven-safe disposable data, stale caches,
redundant build outputs, and clean released worktrees are eligible.

The decision receipt carries all ten hostile fixture identifiers, its policy
snapshot, the current-issue transition, next-issue admission decision,
cleanup result, custody-preservation flags, and a parent receipt digest.  A
duplicate or stale daily check, historical receipt, ordinary-agent poll, or
next-issue request during cleanup is rejected by the validator.

## Immutable audit-routing receipts

An audit-routing receipt is a separate, project-agnostic control record with
schema `agentos.agent_spawner_routing_receipt.v1`.  The final audit receipt
bytes are finalized and byte-hashed before any route payload is emitted.  The
payload binds the final receipt reference, its exact UTF-8 byte SHA-256, the
immutable routing-receipt path, recipient, and routing-receipt digest.  A
consumer must recompute the final byte digest immediately before audit and
receives the typed `ROUTING_RECEIPT_PROVENANCE_BLOCKED` boundary for stale,
missing, substituted, or otherwise inconsistent bytes.

The finalized receipt is never amended to record that it was routed: its
`route_emitted` value remains `false`, `finalized_before_route` and
`post_route_mutation_forbidden` remain true, and the route payload is the
separate emission record.  If a correction is needed, the correction uses a
distinct successor receipt path and preserves the historical path and byte
digest.  A correction requires an explicit fresh replacement-audit authority,
and `product_verdict` remains null with `product_verdict_inherited` false; no
old audit verdict is inherited.  The lifecycle module exports the strict
compile/validate/finalize/consumer helpers and the schema `$defs.routing_receipt`
and `$defs.routing_payload` describe the exact records.

## Atomic project-bound Spawner admission

`compileAgentSpawnerAtomicAdmission` is the narrow boundary between a
compiler handoff and a governed task admission. It accepts persisted facts,
not a creation acknowledgement: a fresh host readback, fresh task-index and
state readbacks, a fresh process-set readback, and an exact local project,
role, model, reasoning, queue, seam, worktree, and custody match. The project
identifier is typed input and is never embedded in this portable module; the
local environment and configured model/effort are checked explicitly.

Task, role, worktree, custody, writer, auditor, and process collisions produce
the typed `ATOMIC_ADMISSION_DUPLICATE_OR_COLLISION` blocker. Historical
`FAILED`, `HELD`, or `ARCHIVED` rows remain independent and do not poison a
new admission. A failed admission yields one content-addressed
`HOLD_OR_ARCHIVE_ONCE` blocker with `substantive_work_started: false` and
`retry_allowed: false`; it does not send a substantive prompt, create a
worktree, or start a process. Only after every readback validates does the
adapter emit one `ADMITTED` receipt bound to all four readback digests and the
next governed action. Prompt text, title, local process cwd, or an API
acknowledgement cannot substitute for persisted metadata.
