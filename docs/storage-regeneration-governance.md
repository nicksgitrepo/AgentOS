# Storage regeneration and recurrence governance

`control/storage-regeneration-governance.mjs` is the pure, project-bound
evidence boundary for generated temporary roots, disposable build/dependency
output, shared caches, and recurring regeneration.  It observes typed facts
and emits content-addressed receipts; it never discovers the host or performs
deletion.

Every generator owns one unique temporary root beneath the project’s
Projects-contained `Temp` area.  A closeout receipt is required on both PASS
and FAIL and can preserve only explicitly durable receipt paths.  Shared or
sibling roots, broad globs, worktrees, `.git`, AgentOS State, Artifacts,
receipt files, toolchains, PostgreSQL state, Codex history, and outside-
Projects caches are never deletion targets.

Disposable-output manifests are issue- and operation-bound.  They are held
until an independent identical-byte delivery is verified against the local,
fetched-origin, and GitHub commit/tree identities.  Only then can Runtime
construct a post-delivery cleanup decision, and that decision clears the
issue-scoped regenerable entries while preserving active custody, shared live
consumers, durable state, and evidence.

Cache identities require an owner, content identity, last-use timestamp, size
ceiling, expiry, consumers, and a content digest.  Shared dependency custody
also records compatible identity, issue references, live consumers, and an
explicit release receipt; a live consumer blocks release.  This models the
Fleet replay fixtures, OT projection dependencies, Cargo homes/targets, and
other shared caches without allowing duplicate roots or broad pruning.

Controller daily inspections carry immutable regeneration cycles and prior
inspection keys.  They compute a bounded regeneration rate and mark recurrence
when the same lane/generation/root identity appears after cleanup.  Repeated
unchanged observations are deduplicated; protected storage is preserved and
the governance record cannot authorize deletion.

The measured source addendum is represented explicitly: Fleet pgdata roots,
OT projection dependencies, OT Well Cargo, shared Cargo targets, durable
Runtime PostgreSQL, Codex thread/session history, and outside-Projects
Sparkle caches each have a rule set and hostile coverage.  Any host-side
effect still requires a separate, exact Runtime/Controller admission.

Fleet replay roots are limited to one content-identified root per lane and
generation; stopped fixtures retain receipts or an active hold.  Shared Cargo
and OT dependencies require owner/use/release records, and shared-target
pruning is represented as a denial unless a safe checkpoint proves no live
consumer and orphaned or old-fingerprint content.  Durable PostgreSQL and
Codex history are protected classes, never generic cleanup targets.  Outside
Projects caches produce a deduplicated owner alert only.  Daily polling uses
one changing key and a delta receipt for unchanged observations, while
supported session rollover retains predecessor history and State ownership.
