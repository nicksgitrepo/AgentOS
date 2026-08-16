# Agent Spawner defect intake

`control/agent-spawner-defect-intake.mjs` is the project-agnostic defect-to-
governance compiler. It accepts a typed record for a failed check, QA finding,
complaint, contradiction, rejected route, failed handoff, or other non-passing
check and emits a content-addressed repair candidate.

Every candidate carries:

- exact source, context, roster, and evidence bindings;
- a root-cause classification and deterministic YES/NO/UNKNOWN/
  NOT_APPLICABLE rule;
- a reusable block/gate patch or Orchestrator-route repair;
- hostile fixture references, authority scope, stop conditions, binding
  refresh requirements, and dependent-roster invalidation;
- a typed Controller handoff.

The candidate is always `spawnable: false` until independent evaluation and
the normal Spawner admission gates clear. Protected boundaries remain pending
protected decisions, and duplicate/stale blocks invalidate dependent seeds
instead of being silently reused. `acceptAgentSpawnerDefectRepair` only places
an otherwise-ready candidate into Controller custody; it does not activate or
spawn anything.

The Import Orchestrator binds the ordered defect queue by digest and derives
its next action from that queue. A ready or Controller-custodied repair takes
the Orchestrator to `REPAIRING`/`REPAIR_BLOCKS`; a protected defect becomes an
exact protected wait; duplicates are retained as invalidation evidence. The
persistent Controller does not consume or reinterpret the queue: it only
repairs Orchestrator liveness when the next transition fails to start.
