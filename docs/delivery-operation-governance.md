# Project operation governance

Bootstrap compiles delivery choices into a project-bound operation-governance
record. The portable AgentOS kernel does not guess a repository, runner,
hosting provider, environment, account, quota, or spend amount.

The record covers:

- Git push and merge authority;
- CI route selection, including local versus hosted runners, concurrency, and
  runner-minute limits;
- hosting and deployment route, provider binding, environment identity, and
  rollback route;
- release and rollback behavior; and
- currency, one-time cost, recurring cost, duration, runner minutes,
  concurrency, and rollback cost.

Agents, Controllers, Auditors, and the Spawner may discover facts, prepare a
candidate, build a cost projection, and return a decision packet. They never
perform an external effect. The persistent Runtime is the only authority that
may authorize or execute a protected operation.

Before Runtime authorization, every protected operation must have:

1. the exact project policy digest;
2. the accepted candidate commit, tree, and artifact digest;
3. the exact route/provider/environment binding;
4. a complete content-addressed cost projection; and
5. an explicit owner decision bound to that projection.

Unknown cost, a cost boundary breach, a route change, or a policy change fails
closed for that operation. Runtime returns a typed owner decision packet. A
route change may proceed only as an explicitly approved one-time exception. A
policy change requires Bootstrap to compile a new policy and Runtime to be
reauthorized against its new digest. No action may silently switch from local
execution to hosted CI, GitHub Actions, a new host, or another provider.

The contract is implemented by:

- `control/delivery-operation-governance.mjs`
- `schemas/delivery-operation-governance.v1.json`
- `schemas/runtime-operation-authorization.v1.json`
- `schemas/runtime-operation-cost-projection.v1.json`
- `schemas/runtime-operation-owner-decision.v1.json`

## Post-delivery output closeout

Runtime delivery closeout consumes the issue-bound disposable-output manifest
from `control/storage-regeneration-governance.mjs`.  The manifest records every
dependency, build, and temporary output path with its issue, operation,
lifecycle class, size, and content fingerprint.  A pre-delivery or
status-only delivery cannot produce a cleanup decision: local, fetched-origin,
and GitHub commit/tree identities must be equal and independently verified.

After that proof, `compilePostDeliveryCleanup` emits a content-addressed
decision that may clear only the listed issue-scoped regenerable entries.
Worktrees, active custody, shared live caches, toolchains, PostgreSQL state,
Artifacts, receipts, session history, and outside-Projects caches remain
protected and require their own lifecycle authority.  The contract is
idempotent and records the manifest and delivered candidate digests so a
partial or replayed cleanup fails closed.
