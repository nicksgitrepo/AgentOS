# 2.1rc Campaign Cascade

Status: `PREPARED_NOT_ACTIVATED`

The executable authority is [control/campaign-cascade.mjs](../../control/campaign-cascade.mjs) and [schemas/campaign-cascade.v1.json](../../schemas/campaign-cascade.v1.json). This article describes the adaptive first-pass, audit, Finalizer, and delta path.

```text
accepted campaign root
        |
        v
FIRST_PASS_BUILDING <-----------------------------+
        |                                          |
        +--> rolling checkpoint-bound audits       |
        |                                          |
        v                                          |
TERMINAL_PROPOSED                                 |
        |                                          |
        +--> immediate first-pass repair ----------+
        |                                          |
        v                                          |
TERMINAL_SETTLED                                  |
        |                                          |
        v                                          |
FINALIZER_ACTIVE -> FINALIZER_COMPLETE             |
        |                                          |
        v                                          |
DELTA_AUDIT <---- targeted delta repair -----------+
        |
        v
READY_FOR_ACCEPTANCE -> Runtime -> live audit -> exact closure
```

## First pass

The Feature Agents build one logical Product lineage and publish substantial immutable checkpoints. Each checkpoint binds campaign, lineage, worktree, branch, commit, tree, remote identity, clean/pushed proof, changed paths, changed surfaces, quality floor, and parent identity.

The quality floor proves the intended path exists, affected stable checks pass, interfaces are coherent, critical defects are disclosed, safe operations hold, and the checkpoint is clean and pushed. A terminal checkpoint cannot be rewritten; a repair creates a new identity on the same lineage.

## Audits

Audits are read-only and concurrent with useful building. Applicability is derived from changed surfaces. The four disciplines are:

- `FUNCTIONALITY`
- `DESIGN_UI_SHELL_NAVIGATION`
- `SECURITY`
- `CODE_QUALITY_HYGIENE`

Unrelated disciplines remain deferred. Security and hygiene do not become mandatory merely because a campaign is substantial. At terminalization every applicable discipline settles exactly once as `REQUIRED`, `DETERMINISTIC_ONLY`, or `NOT_APPLICABLE_WITH_PROOF`. Deterministic proof has no worker session; required reports use distinct fresh read-only workers.

Findings are content-addressed and question-bound. Catastrophic, wrong-direction, foundational, and critical safety/security findings return to the first-pass owner immediately. Material findings are consolidated by causal root. A noncritical hygiene finding is nonblocking unless it names a concrete consequence in one of the three Product roots.

## Campaign Finalizer

The Finalizer receives the exact terminal proposed commit/tree in a fresh clean worktree after the Feature Agent releases Product custody. Its scope is one consolidated causal correction batch, bounded simplification, and proof preparation. It has no owner-intent, acceptance, deployment, exception, or self-acceptance authority.

On completion the Finalizer releases its writer lease and the campaign root adopts the exact final commit/tree through a recorded handoff. The finalizer never silently replaces the Product root or changes the campaign identity.

## Delta proof

Delta audit includes previously failed questions, directly touched questions, dependent descendants, and one small end-to-end smoke set. Unaffected accepted evidence is reused only when question-tree version, relevant hashes, build identity, and environment identity still match. A repair invalidates only dependent answers; it does not restart the whole question corpus or create a serial approval queue.

One targeted delta repair and one supervisor-selected reframe per causal root are the normal limit. Equivalent retries stop and the failure is classified.

## Closure

The final candidate is admissible only when the exact cascade state binds `FUNCTION_REQUIREMENTS_PASS`, `DESIGN_BIBLE_PASS`, `SECURITY_PASS`, deployment and rollback identities, independent live audit, and the closure receipt. Runtime is the sole merge/deployment executor. Until all closure facts are reconciled, the campaign is `ACCEPTED_LIVE_PENDING_CLOSURE`.
