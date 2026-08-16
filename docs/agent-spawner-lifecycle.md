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
