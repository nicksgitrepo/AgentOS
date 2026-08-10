# AgentOS feature inventory

This is the canonical inventory for production-readiness coverage. The
machine-readable record is `docs/feature-inventory.v1.json`.

The inventory deliberately separates two kinds of work:

- 37 named product capabilities drawn from the roadmap, research records,
  feature/completeness contracts, schemas, and project documentation.
- 12 existing governance audit lanes that independently inspect intent,
  Bootstrap, conversation, routing, progress, functionality, UI/UX, hygiene,
  security, evidence, recovery, and delivery.

Platform domains are a separate, source-discovered table. They are not the
governance audit lanes. An active platform domain is admitted only when the
source proves a material cross-feature surface; dormant, absent, and parity-
held domains do not receive active tasks, worktrees, reports, or goals. The
current migration has no proven active platform domain, so the platform roster
is intentionally empty rather than padded with placeholder tasks.

The required logical parity is therefore 49 assigned auditor tasks, 49
isolated-worktree assignments, 49 append-only `auditreport.md` files, and 49
persistent controller-owned lane goals. A capability is not covered merely
because a nearby governance lane mentions it.

Logical assignments are not proof that the visible host tasks exist. Before a
workflow can start, the runtime must supply an external visible-task registry
with exactly one visible task and isolated runtime worktree for every target.
The registry must match the inventory assignments, report path, and
content-addressed active lane goal, and contain only opaque runtime
identifiers. It must not persist chat content, private machine paths,
credentials, or secrets. Missing, synthetic, duplicate, archived, or
mismatched runtime records fail closed as visible-task parity failure.

The current campaign has logical inventory parity: 37 feature assignments and
37 feature reports are present, alongside the 12 governance-lane assignments
and reports. The reports are not all clean; their individual audit and builder
states remain the authoritative worklist for the next consolidation cycle.
Runtime-visible task parity is not claimed until the external registry is
provided and independently reconciled. The current campaign therefore remains
held before workflow admission when that registry is absent.

Each feature auditor must use the current accepted merge worktree selected by
the parent cycle as its read-only baseline, create its own visible task goal,
write only inside its own worktree, and report the exact baseline identity in
its report without persisting private machine paths, secrets, chat links, or
provider credentials. After the audit, the same task becomes the builder for
that feature and remains responsible for its repair/re-audit loop. The
Controller validates the exact target, task, worktree, report, source-reference,
and goal digest again at every handoff and closeout.

The inventory is `PREPARED_NOT_ACTIVATED`; it is not a production acceptance
record and does not authorize deployment, release activation, or external
delivery.
