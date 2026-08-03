# Control

Canonical executable authorities:

- `bootstrap-compiler.mjs` — discovery-backed exact setup plan and transaction;
- `campaign-lifecycle.mjs` — custody, leases, holds, checkpoints, Runtime, and
  next-campaign orientation;
- `campaign-cascade.mjs` — rolling applicable audits, Finalizer, and delta path;
- `campaign-controller.mjs` — thin lifecycle-facing transport boundary;
- `question-tree.mjs` — three-root answer/lifecycle acceptance compiler;
- `gpt-assist.mjs` — optional Auditor-bound Markdown exchange;
- `legacy-preservation.mjs`, `authority-corpus.mjs`, and `evidence-library.mjs` —
  preservation and corpus/evidence utilities.

`bootstrap-interview.mjs`, `guided-bootstrap.mjs`, and `dynamic-bootstrap.mjs`
are migration-only compatibility aliases. They cannot create setup state,
campaign state, provider identity, Product custody, or successor rosters.
