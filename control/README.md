# Control

Canonical executable authorities:

- `bootstrap-compiler.mjs` — discovery-backed exact setup plan and transaction;
- `bootstrap-coverage.mjs` — deterministic setup output-gap inventory and material-question planner input;
- `campaign-lifecycle.mjs` — custody, leases, holds, checkpoints, Runtime, and
  next-campaign orientation;
- `campaign-cascade.mjs` — rolling applicable audits, Finalizer, and delta path;
- `campaign-controller.mjs` — canonical lifecycle-facing transport and paired-state boundary;
- `campaign-state-owner.mjs` — one serialized lifecycle/cascade/bridge snapshot with compare-and-swap persistence and policy-boundary reconciliation;
- `agentos-controller.mjs` — persistent project-level `AGENTOS_CONTROLLER` with a judgment boundary, deterministic event loop, adapter readbacks, policy/session reconciliation, and compare-and-swap state;
- `repository-readback.mjs` — local Git checkpoint readback; provider and hosted-runtime readback remain typed external adapters;
- `question-tree.mjs` — three-root answer/lifecycle acceptance compiler;
- `gpt-assist.mjs` — optional Auditor-bound Markdown exchange;
- `legacy-preservation.mjs`, `authority-corpus.mjs`, and `evidence-library.mjs` —
  preservation and corpus/evidence utilities.

`bootstrap-interview.mjs`, `guided-bootstrap.mjs`, and `dynamic-bootstrap.mjs`
are migration-only compatibility aliases. They cannot create setup state,
campaign state, provider identity, Product custody, or successor rosters.

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
