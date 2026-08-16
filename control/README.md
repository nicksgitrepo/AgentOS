# Control

Canonical executable authorities:

- `bootstrap-compiler.mjs` — discovery-backed exact setup plan and transaction;
- `control-plane-root.mjs` — separate control-plane binding and containment rules;
- `bootstrap-coverage.mjs` — deterministic setup output-gap inventory and material-question planner input;
- `bootstrap-output-definitions.mjs` — extracted canonical inventory of Bootstrap obligations used by the coverage compiler;
- `campaign-lifecycle.mjs` — custody, leases, holds, checkpoints, Runtime, and
  next-campaign orientation;
- `campaign-cascade.mjs` — rolling applicable audits, Finalizer, and delta path;
- `campaign-controller.mjs` — canonical lifecycle-facing transport and paired-state boundary;
- `campaign-receipts.mjs` — bounded approval, audit, and inactive-status receipt with JSON readback;
- `task-continuation.mjs` — one-task control-plane continuation from a completed inactive handoff;
- `task-run-loop.mjs` — repeatable one-task inactive control-plane execution, reconciliation, and next-task queuing;
- `campaign-state-owner.mjs` — one serialized lifecycle/cascade/bridge snapshot with compare-and-swap persistence and policy-boundary reconciliation;
- `agentos-controller.mjs` — persistent project-level `AGENTOS_CONTROLLER` with a judgment boundary, deterministic event loop, adapter readbacks, policy/session reconciliation, and compare-and-swap state;
- `controller-import-planner.mjs` — deterministic source-bound Controller planning from project goals, architecture, features, environments, hardware, standards, and evidence into a QA-gated specialist roster and six-lane audit/repair pyramid;
- `continuous-operating-loop.mjs` — fifteen-minute meaningful-progress inspection, evidence-preserving in-scope repair, predecessor-bound replacement, and independent clearance;
- `controller-supervisor.mjs` and `controller-supervisor-runtime.mjs` — the self-starting observation, bounded-goal, boundary, lease, heartbeat, and repair-routing loop for the persistent Controller;
- `local-agent-session.mjs` — durable campaign-role custody with source-bound commands, heartbeats, isolated worktrees, and exact initial/follow-up readbacks;
- `repository-readback.mjs` — local Git checkpoint readback; provider and hosted-runtime readback remain typed external adapters;
- `project-map.mjs` — bounded, deterministic project-map compilation from typed repository snapshots with explicit omission and freshness metadata;
- `derived-index.mjs` — bounded derived repository indexing and query compilation over the typed project-map boundary;
- `question-tree.mjs` — three-root answer/lifecycle acceptance compiler;
- `governance-library.mjs` and `role-governance-library.mjs` — the shared
  general rules and generated role-specific rule packets;
- `governance-role-definitions.mjs` — the persistent-role and one-lane worker
  seed source;
- `native-session-runner.mjs` — the only host-facing rapid-team lifecycle;
- `codex-native-host-adapter.mjs` — the in-app Codex bridge; host callbacks
  remain outside the portable kernel and are bound to one project/environment;
- `intent-regulator-runtime.mjs` — the project-persistent Intent Regulator
  facade, four-library mount, campaign admission boundary, and configurable
  meaningful-progress monitor (15 minutes by default);
- `bootstrap-runtime.mjs` — the Bootstrap-to-Intent-Regulator application
  transition, external campaign-state persistence, optional always-on monitor
  attachment, and the project-setup/platform-foundation/platform-merge/
  feature-wave/central-integration route;
- `audit-driven-integration-pyramid.mjs` — the canonical project-agnostic
  rapid-prototype Controller. It handles new-project stack and repository
  setup, imported-project approval, platform foundation and platform merge,
  feature audit waves from the accepted skeleton, central convergence,
  source-bound closeout, and dynamic archival;
- `rapid-prototype-workflow.mjs` — a compatibility entry point that re-exports
  the audit-driven integration pyramid and contains no alternate workflow;
- `agentos.mjs` — the stable public kernel surface with namespaced access to
  Bootstrap, governance, native sessions, dynamic lanes, memory, offline/Git,
  release, apprenticeship, and delivery authorities;
- `release-lifecycle.mjs`, `release-compatibility.mjs`,
  `release-policy-replay.mjs`, `release-model-check.mjs`, and
  `release-safety-gate.mjs` — content-addressed release identity, migration
  provenance and scenario evidence, governance replay, finite-state safety
  checks, and the pre-activation promotion boundary;
- `rapid-prototype/index.mjs` — the thin assembly point for the twelve named
  behavior lanes;
- `gpt-assist.mjs` — optional Auditor-bound Markdown exchange;
- `legacy-preservation.mjs`, `authority-corpus.mjs`, and `evidence-library.mjs` —
  preservation and corpus/evidence utilities.

Bootstrap writes AgentOS state to the bound control plane, not to the Product
root by default. The control plane is the AgentOS developer home and may use
local, Git, or hybrid storage. The Product root remains a project input/output
boundary.

The self-development launcher follows the same boundary. Its typed Bootstrap
handoff is supplied with `--bootstrap-handoff-root`; campaign state is written
to an external runtime authority, selected with `--runtime-authority-root`,
`AGENTOS_RUNTIME_ROOT`, or an isolated runtime directory beside the handoff.
The launcher exposes only opaque authority and worktree references in records
and user-facing readbacks.

`bootstrap-interview.mjs`, `guided-bootstrap.mjs`, and `dynamic-bootstrap.mjs`
are migration-only compatibility aliases. They cannot create setup state,
campaign state, provider identity, Product custody, or successor rosters.

After first-run setup, the ongoing project-persistent role is **Intent
Regulator** (`AGENTOS_CONTROLLER`). Bootstrap remains the separate discovery
and setup authority. The public name is intentional; the machine role remains
stable for source compatibility.

`AGENTOS_CONTROLLER` persists across campaigns. The Intent Regulator may
interpret a judgment or owner boundary, but its Controller Runtime owns the
deterministic event/state transaction and requires external readback before
completion. `CAMPAIGN_ORCHESTRATOR` remains campaign-scoped; the project
controller does not write Product code, accept Product work, override the
Auditor, deploy directly, or hold Feature/Platform worktrees.

The portable kernel does not contain a provider-specific model host, worktree
spawner, deployment connector, or live-site browser driver. Those are admitted
through project-bound adapters. A missing adapter is an unavailable boundary;
it cannot be represented as a successful campaign, deployment, rollback, or
live audit by supplying identity-shaped strings.

The Controller supervisor wakes from every active handoff, liveness finding,
and boundary observation. It mints one bounded goal and routes safe work on its
own. A hard boundary stops the dependent outcome; a soft boundary goes to
Orchestrator review; a repairable puzzle keeps moving through campaign
custody. No outside chat prompt is required for those routine decisions.

Project maps and derived indexes are evidence-bound projections, not repository
or host introspection. Their inputs are typed project snapshots, their outputs
are bounded and content-addressed, and omission, freshness, privacy, and
unsupported-adapter states remain explicit at the boundary.

### Four-library governance

- `four-library-governance.mjs` is the public facade for the release-owned base-general and base-role libraries, the project-owned general library, the generated project-role library, binding, migration, and append-only history contracts.
- `four-library-foundation.mjs`, `four-library-operations.mjs`, and `four-library-history.mjs` provide deterministic composition, validation, conflict, transition, upgrade, and append-only history authority.
