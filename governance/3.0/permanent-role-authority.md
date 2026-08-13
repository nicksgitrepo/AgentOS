# Permanent-role authority

Status: `PREPARED_NOT_ACTIVATED`

The sole AgentOS 3.0 permanent-role authority source is the portable,
content-addressed graph in
[`permanent-role-authority-graph.v1.json`](permanent-role-authority-graph.v1.json).
The graph digest is
`7395e70dff8ee2237907ac1da2689beaca34dc38d988e8baec286bfd4fca9d2d`.
Role packets, plans, rosters, and compatibility records are projections or
inputs; none is a second role canon.

## Five permanent roles

| Role | Owns | Must not own |
| --- | --- | --- |
| `INTENT_REGULATOR` | Owner intent, scope boundaries, protected-decision routing | Project execution, Product writes, lifecycle supervision |
| `CONTROLLER` | State and lifecycle observation, fifteen-minute supervision, liveness and recovery routing | Intent rewrite, Product writes, role-context compilation, host spawn |
| `AGENT_SPAWNER_COMPILER` | Fail-closed role-context compilation and the future host-spawn boundary after independent manifest acceptance | Project work, self-acceptance, scheduling, Product or release work |
| `SCHEDULER` | Job, capacity, worktree, and process custody | Product acceptance, Product writing, release promotion, intent or spawn authority |
| `RUNTIME` | Read-only environment discovery and capability-bound build, deploy, and rollback at protected boundaries | Intent regulation, appointment, role compilation, or spawn authority |

The roles are permanent but not interchangeable. Their role identities are
distinct, every appointment carries separate requester, subject, compiler,
acceptor, and appointing identities, and an action request requires an
independent reviewer. A handoff transfers evidence and custody only; it never
transfers the sender's authority.

## Admission and effects

`control/permanent-role-authority.mjs` validates the exact graph, emits an
inactive five-role roster, and evaluates action authority, model duty,
independent identity, accepted-manifest, capability, and protected-decision
evidence. A positive result is `SHAPE_ACCEPTED_NOT_ACTIVATED`, not permission
to execute. Every receipt keeps activation off, host spawning unwired, and
execution unauthorized.

The substrate performs no Product writes and does not start a role, create a
session, allocate a real process, call a host, deploy, roll back, publish, or
promote a release. Those effects require later capability wiring and a
separate protected decision.

## Compatibility and conflict resolution

`AGENTOS_CONTROLLER` is a legacy machine alias for `INTENT_REGULATOR` only.
It never means `CONTROLLER`. Migration requires an admitted legacy schema,
version, and explicit `INTENT_SCOPE_AND_PROTECTED_DECISION_ROUTING` semantic
evidence. An old `AGENTOS_CONTROLLER` record carrying lifecycle-supervision or
state-controller duty is ambiguous and is denied until explicitly rebound.

`AGENT_SPAWNER_GOVERNANCE_COMPILER` is the exact legacy rename for
`AGENT_SPAWNER_COMPILER` when its role-context-compilation semantics are
present. Generic `PROJECT_CONTROLLER`, `CONTROLLER_RUNTIME`, and
`AGENT.PROJECT_CONTROLLER` labels are ambiguous and never normalize by name
alone.

The older `agentos-controller.v1`, persistent Intent-Regulator/Runtime pair,
continuous-loop roster, and imported expanded permanent-role lists remain
readable compatibility surfaces. They are not complete AgentOS 3.0 rosters
and grant no current authority without a new graph-bound migration receipt,
five distinct bindings, and independent identity evidence. Accepted history
is not rewritten.
