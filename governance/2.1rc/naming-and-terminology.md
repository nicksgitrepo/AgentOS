# Naming and terminology

Status: `RELEASE CANDIDATE — PREPARED_NOT_ACTIVATED`

The machine registry at `schemas/naming-and-terminology.v1.json` is the
normative naming map. This article explains how to use it without making a
published migration harder than the change itself.

AgentOS uses one canonical name for each concept. Public names are readable;
stable machine IDs remain compact; file names use lowercase kebab case; and
accepted article numbers never move. Existing names are compatibility aliases,
not a second operating model. A controller normalizes an alias before it
validates state, and an alias may not create a new authority identity.

The setup surface is now called **Bootstrap**. Its compact question compiler is
the **Bootstrap Interview** and its read-only fact collector is **Bootstrap
Discovery**. The old `guided-bootstrap` and `dynamic-bootstrap` names remain
only as migration aliases while older state is imported.

The campaign-scoped `GLOBAL_ORCHESTRATOR` is presented to users as the
**Campaign Orchestrator**. A feature owner is presented as the **Feature
Orchestrator**; the machine role remains stable for compatibility. A
**Platform Agent** is created only when a Feature Orchestrator identifies a
material capability seam. It is exclusive to that feature and campaign,
reports directly to that Feature Orchestrator, and may be reused by that same
feature during the campaign. It is never a standing pool, a cross-feature
shared specialist, or a successor wave.

The user-facing term **Next-Campaign Candidate** replaces the legacy
`successor_wave` label. It is only a durable future-work packet; it never
creates a successor session, lease, or Product writer before a separate
campaign admission.

## Naming value test

When a rename is proposed, keep it only if it reduces ambiguity, makes a
boundary more honest, prevents a collision, or makes long-lived state easier
to migrate. Do not rename accepted IDs merely for style. New terminology must
also pass the portable-kernel context-separation test: it must not encode a
project, provider, repository, domain, deployment, or owner identity.

The model profile formerly called `ECO` or `ECONOMICAL` is canonically
`ECO_CONTINUOUS`: it represents a continuous 24/7 week with up to twenty
Codex-equivalent work slots. `STANDARD_WORKWEEK` represents a normal 40-hour
week. `PERFORMANCE` prioritizes elapsed time, and `CUSTOM` accepts explicitly
typed conditions. A recommendation excludes any model below the configured
completion-reliability floor; “eco” never means “choose a model that cannot
finish the work.”
