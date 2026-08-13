# AgentOS 3.0 governance candidates

Status: `PREPARED_NOT_ACTIVATED`

This directory contains versioned AgentOS 3.0 authority candidates. A record
here is not an activation, release promotion, Product rebind, host-session
binding, deployment authorization, or publication decision.

The permanent-role authority source is
[`permanent-role-authority-graph.v1.json`](permanent-role-authority-graph.v1.json).
Its executable boundary is `control/permanent-role-authority.mjs`, its typed
records are described by `schemas/permanent-role-authority.v1.json`, and legacy
references are handled by `migrations/permanent-role-authority.v1.json`.

The portable audit-to-repair convergence candidate is
[`audit-repair-convergence.md`](audit-repair-convergence.md). Its exact
controller, schemas, migration, Scheduler/cascade interfaces, and invalidation
fan-out are frozen by
[`audit-repair-convergence.binding.v1.json`](audit-repair-convergence.binding.v1.json).
It remains inactive and does not grant Product, Scheduler-execution, cascade,
deployment, or release authority.
