# Agent Spawner to Controller bridge

`control/agent-spawner-controller-bridge.mjs` is the narrow project-agnostic
adapter between the Spawner's defect compiler and the Controller's closed
successor registry.

The Spawner may describe a repair with a route such as
`REBUILD_DEPENDENT_ROSTER`. That route is a compiler vocabulary, not an
executable Controller action. The bridge validates the complete Spawner intake,
checks its custody status and source handoff digest, maps the route to a
registered action and handler, and emits a content-addressed Controller action
receipt. Local routes are dispatched in the same turn. A protected route is
converted to `WAIT_FOR_PROTECTED_EVENT` and must carry a typed blocker with
zero resources; no protected permission is inferred.

The mapping is deliberately small and closed:

| Spawner route | Controller successor |
| --- | --- |
| `COMPILE_BLOCK_PATCH` | `START_NEXT_LOCAL_BLOCK_REPAIR` |
| `REPAIR_ORCHESTRATOR_ROUTE` | `START_NEXT_AVAILABLE_CONTROLLER_TRANSITION` |
| `REBUILD_DEPENDENT_ROSTER` | `START_NEXT_AVAILABLE_CONTROLLER_TRANSITION` |
| `REJECT_DUPLICATE` | `START_NEXT_AVAILABLE_CONTROLLER_TRANSITION` |
| `ESCALATE_PROTECTED` | `WAIT_FOR_PROTECTED_EVENT` |

Every bridge preserves the source handoff, Controller receipt predecessor,
roster invalidation status, evidence, hostile fixtures, continuation, and
canonical readback. Unknown actions, stale source bindings, missing protected
events, digest tampering, incomplete blocks, and unqualified intakes fail
closed. The bridge never spawns, admits, activates, mutates a consumer
project, accesses a provider, or performs a merge/deployment.
