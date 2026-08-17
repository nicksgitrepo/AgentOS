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

The Controller supervisor also routes failures that occur before a valid
observation exists (for example, an adapter load or observation exception)
through the same intake. Those records bind only opaque runtime identity and an
error fingerprint, reuse the exact record for repeated identical failures,
and remain non-spawnable until the normal repair and independent-evaluation
gates pass.

The Import Orchestrator binds the ordered defect queue by digest and derives
its next action from that queue. A ready or Controller-custodied repair takes
the Orchestrator to `REPAIRING`/`REPAIR_BLOCKS`; a protected defect becomes an
exact protected wait; duplicates are retained as invalidation evidence. The
persistent Controller does not consume or reinterpret the queue: it only
repairs Orchestrator liveness when the next transition fails to start.

`control/agent-spawner-defect-queue.mjs` is the durable queue boundary. It
sorts and validates every intake by defect identity, rejects duplicates, and
persists the complete queue with an atomic digest compare-and-swap, exclusive
lock, fsync, and strict authority-root path/symlink checks. Use
`appendAgentSpawnerDefectQueueRecord` for a new typed finding and pass the
resulting queue digest into the Orchestrator; a queue write never admits or
spawns an agent by itself.
