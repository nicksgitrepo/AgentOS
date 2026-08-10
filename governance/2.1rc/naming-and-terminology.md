# Naming and terminology

Status: `PREPARED_NOT_ACTIVATED`

The normative map is [schemas/naming-and-terminology.v1.json](../../schemas/naming-and-terminology.v1.json). The goal is one clear name for each durable concept, with compatibility aliases kept only for migration.

## Canonical names

- `Bootstrap` is the read-only discovery, compact question, exact-plan, approval, and resumable setup controller.
- `Authority Corpus` is the project-bound source of truth compiled from governance and typed Project Context.
- `Intent Regulator` (`AGENTOS_CONTROLLER`) is project-persistent. It handles judgment and routing while its Controller Runtime performs deterministic events, state transactions, timers, and adapter readbacks.
- `Campaign Orchestrator` owns campaign admission, shared custody, recovery, and closure; it does not manage routine feature work.
- `Feature Agent` owns one bounded feature outcome and directly supervises its work.
- `Platform Agent` is a campaign-local logical capability with one stable worktree and sequential Feature-Agent supervision leases.
- `Independent Auditor` is read-only and evaluates exact checkpoints and the exact deployed live identity.
- `Campaign Finalizer` is a fresh exclusive writer for one consolidated causal correction batch.
- `Runtime` is the persistent integration, deployment, rollback, and live-operation identity.
- `Next-Campaign Candidate` is an orientation packet only. It does not create a successor roster or Product writer.
- `Delivery Policy` is the typed project-context contract for pushes, merges, CI runners, hosting, deployment, rollback, providers, environments, and cost boundaries.
- `Project Life Contract` is the compact owner-intent contract for maturity, assurance, audience, data, lifetime, maintenance, portability, commercialization, and retirement.
- `Delivery Target` is the intended Product target and maturity mode, separate from source-control and transport mechanics.
- `Boundary Contract` is the executable set of constitutional, owner-sovereign, derived-operating, and temporary-probe limits.
- `Delivery Probe` is a bounded read-only observation; it never authenticates, spends, pushes, merges, deploys, or rolls back.
- `Project Import` is the typed source-to-destination migration choice; `Source Preservation` is its pre-build provenance gate; `Normalization Policy` and `Standards Registry` are the corresponding deterministic contracts.
- `Migration Campaign` is the first governed campaign that executes an authorized normalization, audit, repair, and reversible cutover.
- `Cascade Economics` is the accepted-result cost comparison and task-class telemetry contract; `Finalizer Rewrite Assessment` distinguishes targeted repair from a deliberate rebuild.

## Cascade names

`FIRST_PASS_CANDIDATE` is an immutable coherent checkpoint, not a disposable or speculative draft. `CAMPAIGN_FINALIZER` receives its exact commit and tree after the Feature Agent releases Product custody. `CODE_QUALITY_HYGIENE` is an audit discipline, never a fourth Product-acceptance root. `DELIVERY_POLICY` is the canonical name; provider-specific setup remains project context.

The acceptance roots remain exactly `FUNCTION_REQUIREMENTS`, `DESIGN_BIBLE`, and `SECURITY`. Question answers and lifecycle states are separate data: an answer is `YES`, `NO`, `UNKNOWN`, `NOT_APPLICABLE`, or `EXCEPTION_REQUESTED`; lifecycle is `UNEVALUATED`, `EVIDENCE_PENDING`, `OPEN_REPAIR`, `VERIFIED`, or `INVALIDATED`.

## Migration rule

Older names normalize before validation and never rewrite accepted history. `GLOBAL_ORCHESTRATOR` normalizes to `AGENTOS_CONTROLLER`; `FEATURE_LEAD` and `FEATURE_ORCHESTRATOR` normalize to `FEATURE_AGENT`; `successor_wave` normalizes to `next_campaign_candidate`; `rough_draft` normalizes to `first_pass_candidate`. Compatibility entrypoints do not own setup state, campaign state, custody, or successor creation.

Keep a rename only when it removes ambiguity, makes a boundary more honest, prevents a collision, or improves long-term migration. Project, provider, repository, domain, deployment, and owner identities remain context data.

The canonical migration vocabulary is `PROJECT_IMPORT`,
`SOURCE_PRESERVATION`, `NORMALIZATION_POLICY`, and `STANDARDS_REGISTRY`.
Their executable paths are `control/project-import.mjs`,
`control/normalization-policy.mjs`, and `control/standards-registry.mjs`, with
matching `schemas/*.v1.json` contracts. Full project normalization is a
campaign, not a hidden Bootstrap micro-phase.

The cascade economics vocabulary is `CASCADE_ECONOMICS` and
`FINALIZER_REWRITE_ASSESSMENT`, implemented by
`control/cascade-economics.mjs` and its matching schema and article.
