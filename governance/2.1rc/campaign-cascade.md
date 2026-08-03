# Campaign cascade authority

Status: `RELEASE CANDIDATE — PREPARED_NOT_ACTIVATED`

This article defines the adaptive development path for substantial work. The
machine contract is [`schemas/campaign-cascade.v1.json`](../../schemas/campaign-cascade.v1.json),
SHA-256: `e5e4c02787503b088b2bb5258baa4c4839ae6d5fdb010b806184ebed0bc0a595`, and the executable controller is
[`control/campaign-cascade.mjs`](../../control/campaign-cascade.mjs),
SHA-256: `a9c26dfae9814559468d59da27bdaee269a38c449f3492ab30d082971b7309a9`.

## Canonical path

One logical Product lineage moves forward through immutable, pushed
checkpoints. Physical worktrees can be isolated, but no audit, finalizer, or
Runtime action may claim a different parent than the exact commit and tree it
received.

```text
Capability-selected Feature / Platform Agents
        |
        +--> immutable substantial checkpoints
        |          |
        |          +--> applicable read-only audit lenses in parallel
        |          |
        +----------+--> terminal FIRST_PASS_CANDIDATE
                              |
                              +--> four-lens terminal settlement
                              |
                              +--> fresh CAMPAIGN_FINALIZER worktree
                                           |
                                           +--> one correction batch
                                           |
                                           +--> delta-only audit and at most one targeted repair
                                                        |
                                                        +--> three-root RC_READY
                                                                     |
                                                                     +--> Runtime integration, deployment, and live audit
```

The four lenses are `FUNCTIONALITY`, `DESIGN_UI_SHELL_NAVIGATION`, `SECURITY`,
and `CODE_QUALITY_HYGIENE`. Intermediate checkpoints run only the materially
applicable lenses. The terminal checkpoint settles every lens exactly once as
required, deterministic-only, or not applicable with content-addressed proof.
The reconciliation binds the exact non-deferred discipline set and one report
for each required discipline, including the Auditor session, worker session,
and report digest. Terminal reports use distinct on-demand worker sessions;
missing roster bindings cannot advance the cascade.

## First-pass floor

The first-pass builder is allowed to be economical, but it must produce a
coherent candidate. The intended route exists, affected stable checks pass,
interfaces are coherent, known critical defects are disclosed, operations are
safe, and the checkpoint is clean and pushed. Incomplete work is named in the
handoff. “Rough draft” is not a machine state; the canonical state is
`FIRST_PASS_CANDIDATE`.

Wrong direction, foundational dependency failure, catastrophic safety or
security evidence, and a concealed critical defect return immediately to the
first-pass owner. Ordinary material findings are deduplicated by causal root
and sent to finalization.

## Campaign Finalizer

The `CAMPAIGN_FINALIZER` is spawned only after terminal first-pass audit
settlement. It receives one exact first-pass commit/tree, one fresh clean
worktree, exclusive writer custody, a content-addressed model policy, and one
consolidated correction batch. It may repair cross-cutting causes and make a
bounded simplification when the reliability, security, performance, or
maintenance consequence is explicit.

It cannot change owner intent, grant an exception, decide Product acceptance,
deploy, rollback, or accept its own work. A greenfield rewrite, style-only
change, or unrelated scope expansion is outside its custody.

## Delta proof and loop limits

After finalizer changes, retest only previously failed questions, directly
touched questions, dependent child questions, and one small end-to-end smoke
set. Reuse unaffected accepted evidence only when its exact question-tree
version, relevant hashes, build, and environment still match. A complete tree
restart without invalidation is invalid.

The normal limit is one finalization pass and zero or one targeted delta-repair
pass. The same causal failure gets one materially different route or one
supervisor-selected reframe. Equivalent retries stop and are classified as an
ordinary blocker, honest unavailability, model-promotion need, or owner-only
boundary.

## Acceptance and release boundary

The Campaign Finalizer prepares the candidate and proof. The Auditor remains
independent and read-only. `FUNCTION_REQUIREMENTS → DESIGN_BIBLE → SECURITY`
must all be `PASS` before `RC_READY`. The accepted-live closure additionally
binds the cascade digest, final candidate commit/tree, Product acceptance
digest, deployment identity, rollback identity, independent live-audit
identity, and closure receipt. Runtime alone performs integration and
deployment; no pre-deployment audit can substitute for live proof.

## Model economics

Model choice is role- and workload-specific. Bootstrap compares current
external model facts against the completion-reliability floor, required tools,
context, privacy, deadline, and expected accepted cost including retries,
supervision, repair, and integration. It excludes candidates below the floor
and fails closed when no eligible or budget-feasible candidate remains. Model
names and market snapshots are project configuration, not portable authority.

The cascade records secret-free telemetry for first-pass cost, audit cost by
lens, finalizer cost, delta cost, wall time, first-pass survival, rewrite rate,
evidence reuse, escaped findings, owner interruptions, and cost per accepted
Function outcome. Recalibration waits for several observed campaigns and never
quietly lowers the completion floor.
