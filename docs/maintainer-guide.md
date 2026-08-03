# AgentOS 2.1rc Maintainer Guide

Normative behavior belongs in `governance/2.1rc/`, machine contracts in `schemas/`, and executable behavior in `control/`. Project facts belong only in a consuming Project Context or synthetic examples.

Keep one canonical implementation for each authority:

- Bootstrap: `control/bootstrap-compiler.mjs`;
- Bootstrap coverage: `control/bootstrap-coverage.mjs`;
- Project Life Contract: `control/project-life-contract.mjs`;
- Delivery Target: `control/delivery-target.mjs`;
- Boundary Contract: `control/boundary-contract.mjs`;
- lifecycle and custody: `control/campaign-lifecycle.mjs`;
- cascade: `control/campaign-cascade.mjs`;
- acceptance: `control/question-tree.mjs`;
- optional exchange: `control/gpt-assist.mjs`.

Compatibility entrypoints are import-only aliases. They cannot create setup state, campaign state, provider identity, Product custody, or successor rosters.

When changing a bound controller, schema, article, or verifier, update its SHA-256 in `schemas/bootstrap-binding.v1.json`. Add positive, hostile, deterministic, containment, and transition coverage for every new boundary. Keep source provenance in migrations, not normative authority. Bootstrap coverage must remain the only output-gap and question-selection authority.

Before handoff, run `node tests/verify-portability.mjs`, `node tests/verify-all.mjs`, and each focused verifier. Never add credentials, real project paths, deployment receipts, release evidence, or product-specific policy.
