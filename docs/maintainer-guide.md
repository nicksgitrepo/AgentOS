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
- control-plane boundary: `control/control-plane-root.mjs`.
- ongoing project control plane: **Intent Regulator** (`AGENTOS_CONTROLLER`);
- first-run discovery and setup: **Bootstrap** (`BOOTSTRAP`), which is not the ongoing Controller role.

Compatibility entrypoints are import-only aliases. They cannot create setup state, campaign state, provider identity, Product custody, or successor rosters.

When changing a bound controller, schema, article, or verifier, update its SHA-256 in `schemas/bootstrap-binding.v1.json`. Add positive, hostile, deterministic, containment, and transition coverage for every new boundary. Keep source provenance in migrations, not normative authority. Bootstrap coverage must remain the only output-gap and question-selection authority.

## Development and public distribution

The development checkout is not automatically the public distribution. Keep
development branches, temporary worktrees, local control-plane state, owner
conversations, and handoffs outside the clean public directory. Build the
public directory from the approved reusable files only, then check it for
secrets, private paths, chat links, credentials, runtime state, and unrelated
project material. Run the portability and hostile-boundary verifiers against
that clean directory before adding or pushing it to a public Git repository.

The public repository may contain only project-agnostic AgentOS code,
contracts, documentation, tests, and synthetic examples. A consuming Product
repository and its AgentOS control plane are separate roots and are never
copied into this distribution.

The maintainer layout is three-repository work: a baseline/source repository,
an active development repository, and a sterile release repository. Only the
sterile release repository is a public publication candidate. Product release
repositories and private work repositories remain outside that chain.

Before handoff, run `node tests/verify-portability.mjs`, `node tests/verify-all.mjs`, and each focused verifier. Never add credentials, real project paths, deployment receipts, release evidence, or product-specific policy.

### Campaign control-plane receipts

Use `control/campaign-receipts.mjs` for the one bounded receipt that joins an
exact owner approval and admission to the canonical Controller candidate,
validated audit mapping, complete four-lens report bodies, and current status.
Write through its compare-and-swap helper and always read the file back as
JSON before handing it off. A local unpushed, nonterminal checkpoint may be
valid development evidence; it is not release readiness. Stop on any digest,
campaign, policy, acceptance, source, scope, intent, report-body, JSON, or
inactive-boundary mismatch.

### Safe continuation

Use `control/task-continuation.mjs` only after a completed inactive handoff.
It selects exactly one owner-authorized `CONTROL_PLANE_ONLY` task and records
the task plus its handoff without activating the campaign or spawning agents.
The parent identity, policy, and reconciliation remain unchanged; ambiguous
selection or any forbidden boundary fails closed.

### Repeatable safe runs and owner feedback

Use `control/task-run-loop.mjs` after a continuation task has a valid inactive
start handoff. One loop iteration consumes one ready control-plane task,
records its inactive execution readback and reconciliation, and queues exactly
one validated next candidate. It does not activate a campaign, write Product,
spawn agents, deploy, release, push, merge, or change the sterile copy. A real
owner decision, scope or intent change, hard boundary, or safety problem stops
the loop.

Keep roughness found in the owner flow in `docs/owner-feedback-backlog.md`.
Each item keeps its user-visible symptom, expected behavior, and follow-up
campaign. The loop may queue those follow-ups as bounded control-plane work;
the separate campaign-start boundary remains required for real execution.
