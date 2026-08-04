# Control

Canonical executable authorities:

- `bootstrap-compiler.mjs` — discovery-backed exact setup plan and transaction;
- `control-plane-root.mjs` — separate control-plane binding and containment rules;
- `bootstrap-coverage.mjs` — deterministic setup output-gap inventory and material-question planner input;
- `campaign-lifecycle.mjs` — custody, leases, holds, checkpoints, Runtime, and
  next-campaign orientation;
- `campaign-cascade.mjs` — rolling applicable audits, Finalizer, and delta path;
- `campaign-controller.mjs` — canonical lifecycle-facing transport and paired-state boundary;
- `campaign-receipts.mjs` — bounded approval, audit, and inactive-status receipt with JSON readback;
- `task-continuation.mjs` — one-task control-plane continuation from a completed inactive handoff;
- `task-run-loop.mjs` — repeatable one-task inactive control-plane execution, reconciliation, and next-task queuing;
- `campaign-state-owner.mjs` — one serialized lifecycle/cascade/bridge snapshot with compare-and-swap persistence and policy-boundary reconciliation;
- `agentos-controller.mjs` — persistent project-level `AGENTOS_CONTROLLER` with a judgment boundary, deterministic event loop, adapter readbacks, policy/session reconciliation, and compare-and-swap state;
- `controller-supervisor.mjs` and `controller-supervisor-runtime.mjs` — the self-starting observation, bounded-goal, boundary, lease, heartbeat, and repair-routing loop for the persistent Controller;
- `local-agent-session.mjs` — durable campaign-role custody with source-bound commands, heartbeats, isolated worktrees, and exact initial/follow-up readbacks;
- `repository-readback.mjs` — local Git checkpoint readback; provider and hosted-runtime readback remain typed external adapters;
- `question-tree.mjs` — three-root answer/lifecycle acceptance compiler;
- `gpt-assist.mjs` — optional Auditor-bound Markdown exchange;
- `legacy-preservation.mjs`, `authority-corpus.mjs`, and `evidence-library.mjs` —
  preservation and corpus/evidence utilities.

Bootstrap writes AgentOS state to the bound control plane, not to the Product
root by default. The control plane is the AgentOS developer home and may use
local, Git, or hybrid storage. The Product root remains a project input/output
boundary.

`bootstrap-interview.mjs`, `guided-bootstrap.mjs`, and `dynamic-bootstrap.mjs`
are migration-only compatibility aliases. They cannot create setup state,
campaign state, provider identity, Product custody, or successor rosters.

After first-run setup, the ongoing project-persistent role is **AgentOS
Controller** (`AGENTOS_CONTROLLER`). Bootstrap remains the separate discovery
and setup authority.

`AGENTOS_CONTROLLER` persists across campaigns. Its Controller Agent may
The portable kernel does not contain a provider-specific model host, worktree
spawner, deployment connector, or live-site browser driver. Those are admitted
through project-bound adapters. A missing adapter is an unavailable boundary;
it cannot be represented as a successful campaign, deployment, rollback, or
live audit by supplying identity-shaped strings.

`AGENTOS_CONTROLLER` persists across campaigns. Its Controller Agent may
interpret a judgment or owner boundary, but its Controller Runtime owns the
deterministic event/state transaction and requires external readback before
completion. `CAMPAIGN_ORCHESTRATOR` remains campaign-scoped; the project
controller does not write Product code, accept Product work, override the
Auditor, deploy directly, or hold Feature/Platform worktrees.

The Controller supervisor wakes from every active handoff, liveness finding,
and boundary observation. It mints one bounded goal and routes safe work on its
own. A hard boundary stops the dependent outcome; a soft boundary goes to
Orchestrator review; a repairable puzzle keeps moving through campaign
custody. No outside chat prompt is required for those routine decisions.
