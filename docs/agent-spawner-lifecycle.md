# Agent Spawner lifecycle

The Agent Spawner is the persistent, project-agnostic lifecycle executor for
agents. Its ordinary job is deliberately narrow: consume an authorized typed
request, create or archive the exact agent named by that request, update the
active lifecycle roster, and return a typed host readback. Bootstrap may create
the first Spawner; after that, only the Spawner performs ordinary agent create,
archive, and despawn operations.

The Spawner does not decide what work should happen. Project Owner,
Orchestrator, and Controller remain responsible for intent, campaign planning,
task direction, liveness, and repair routing according to their own authority.
Independent evaluators and owning integration roles decide quality,
admission evidence, acceptance, and integration. The Spawner may validate that
their required receipts are present and exact, but it may not produce,
reinterpret, or overrule those decisions.

This responsibility contract supersedes older Spawner artifacts that describe
campaign compilation, autonomous repair, audit-group management, substantive
handoff review, acceptance, or integration. Those behaviors are historical
compatibility material, not current Spawner authority. A conflicting request
fails closed and returns to the governing authority.

For creation, the Spawner validates the request issuer, role, parent/campaign
binding, model and tool route, repository or read-only context, custody,
capacity, uniqueness, and return destination. It then provisions exactly one
agent and returns a spawn receipt or a typed provisioning failure. It does not
plan the assignment, select project priorities, direct the worker, supervise
progress, or review the worker's result.

For archival, the Spawner consumes an authorized terminal lifecycle request
and exact preservation, inactivity, worktree, and custody-release receipts. It
then performs the requested host archive/despawn operation, removes the agent
from the active lifecycle roster, and returns an archive receipt. Archival is
administrative and never means that the agent's work was accepted.

Agent archival is not storage-deletion authority. A requesting custody or
storage authority must supply the exact preserve or cleanup disposition. The
Spawner may mechanically execute that exact disposition and report what was
removed or retained, but it cannot select cleanup targets, infer deletion from
age or storage pressure, or make retention and recoverability judgments.

Any authorized cleanup fails closed while an agent or process is live, a file
handle is open, a worktree is dirty or contains unpushed work without an exact
preservation disposition, a database/runtime/mount is live, archive coverage
is unverified, or custody is unresolved. Worktree removal uses the version
control worktree interface and requires branch, commit, remote-custody, and
cleanliness readbacks as applicable. History removal requires an exact
manifest and integrity verification; rebuildable-cache removal requires proof
that no active process depends on it. Operating-system-managed storage is
never a Spawner cleanup target.

The resulting receipt names exact paths removed or retained, recovery and
access impact, branch/commit/remote/worktree state, process and open-handle
readback, retention or deletion authority, and free-space readback when
storage changed. If cleanup is unsafe or unauthorized, the Spawner may still
archive the agent with retained custody when the request permits it; otherwise
it returns a typed failure without deleting anything.

The Spawner is not an implicit temporary worker and not a wave-activation
shortcut.

It has two deliberately separate modes:

- `COMPILER_ONLY` — the Spawner may validate and compile lifecycle requests and
  typed lifecycle-roster projections without calling a host create/archive
  adapter. `COMPILER_ACTIVE` is a real persistent lifecycle state while an
  authorized lifecycle request is incomplete or awaiting external admission
  evidence. It cannot create or archive an agent, touch a Product, access a
  provider or credential, sync externally, or poll a protected dependency.
- `GOVERNED_SPAWN` — admission and activation require complete blocks,
  independent clearance, and a project-bound spawn-adapter readback. A static
  QA pass is never sufficient.

The readback exposes the persistent Spawner state as one of `PREPARED`,
`QA_READY`, `COMPILER_ACTIVE`, `ADMITTED`, `ACTIVE`, or `STALLED`, separately
from an individual agent's lifecycle and from wave activation. A protected
hold moves the persistent role to `STALLED`, clears resources, and waits for a
typed owner or protected-dependency event. It never uses a heartbeat as a
substitute for that event.

The executable contract is in
`control/agent-spawner-lifecycle.mjs`; the machine-readable contract is
`schemas/agent-spawner-lifecycle.v1.json`. The focused hostile coverage is
`tests/verify-agent-spawner-lifecycle.mjs`. The responsibility boundary is
`schemas/agent-spawner-role-boundary.v1.json`, verified by
`tests/verify-agent-spawner-role-boundary.mjs`.
