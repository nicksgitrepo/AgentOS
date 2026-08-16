# Agent Spawner lifecycle

The Agent Spawner is a persistent project-agnostic compiler role, not an
implicit temporary worker and not a wave-activation shortcut.

It has two deliberately separate modes:

- `COMPILER_ONLY` — the compiler may perform bounded local block compilation,
  QA, and typed roster projection work. An operational `COMPILER_ACTIVE` tick
  is still compiled-only and never means that the persistent Spawner lifecycle
  is `ACTIVE`; it cannot spawn a worker, touch a Product, access a provider or
  credential, sync externally, or poll a protected dependency.
- `GOVERNED_SPAWN` — admission and activation require complete blocks,
  independent clearance, and a project-bound spawn-adapter readback. A static
  QA pass is never sufficient.

The readback exposes the persistent lifecycle state as one of `PREPARED`,
`QA_READY`, `ADMITTED`, `ACTIVE`, or `STALLED`, separately from the operational
compiler/spawn state, temporary worker admission, and wave activation. A
protected hold moves the persistent role to `STALLED`, clears resources, and
waits for a typed owner or protected-dependency event. It never uses a heartbeat
as a substitute for that event.

The executable contract is in
`control/agent-spawner-lifecycle.mjs`; the machine-readable contract is
`schemas/agent-spawner-lifecycle.v1.json`. The focused hostile coverage is
`tests/verify-agent-spawner-lifecycle.mjs`.
