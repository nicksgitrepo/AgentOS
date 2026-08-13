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

## Atomic transition journal

Every transition starts from one validated, content-addressed predecessor. The
caller supplies a content-addressed target-state candidate whose unchanged
journal is canonically equal to the predecessor journal. The transition engine
validates that candidate against the predecessor journal head, validates the
allowed edge and a plain portable JSON event payload, and works only on a
private clone.

The engine then appends exactly one journal record. Its sequence is the prior
journal length, `from_state_sha256` is the exact predecessor
`cascade_sha256`, and its source and target stages are the executed edge. The
event digest is the SHA-256 of canonical JSON for the complete record with
`event_sha256` set to `null`; genesis uses the same digest rule. The completed
state is resealed and validated normally, including the rule that its journal
head ends at its current stage. A paired serialized lifecycle/cascade
transaction likewise lets each transition engine complete this append before
the state-owner validates and persists the joined result.

Inputs are never mutated. A stale predecessor, stale candidate CAS, rewritten
journal prefix, pre-appended or replayed transition, noncontiguous sequence,
skipped stage, changed payload, nonportable payload, or invalid completed state
fails without returning partial state.

This is an additive repair to `governance.campaign_cascade_state.v1`; `2.1rc`
remains prepared and inactive. There is no accepted active-state migration. A
pre-repair fixture or persisted candidate is invalid when genesis used the
legacy digest shape, the target journal was appended before the transaction,
the journal contains an illegal edge, or its bytes cannot be derived from the
last independently validated predecessor. Regenerate genesis or replay from
that predecessor. Never rewrite or re-hash accepted journal history in place.

## First pass

The Feature Agents build one logical Product lineage and publish substantial immutable checkpoints. Each checkpoint binds campaign, lineage, worktree, branch, commit, tree, remote identity, clean/pushed proof, changed paths, changed surfaces, quality floor, and parent identity.

The quality floor proves the intended path exists, affected stable checks pass, interfaces are coherent, critical defects are disclosed, safe operations hold, and the checkpoint is clean and pushed. A terminal checkpoint cannot be rewritten; a repair creates a new identity on the same lineage.

## Audits

Audits are read-only and concurrent with useful building. Applicability is derived from changed surfaces. The four disciplines are:

- `FUNCTIONALITY`
- `DESIGN_UI_SHELL_NAVIGATION`
- `SECURITY`
- `CODE_QUALITY_HYGIENE`

Unrelated disciplines remain deferred. Security and hygiene do not become mandatory merely because a campaign is substantial. At terminalization every applicable discipline settles exactly once as `REQUIRED`, `DETERMINISTIC_ONLY`, or `NOT_APPLICABLE_WITH_PROOF`. Deterministic proof has no worker session; required reports use distinct fresh read-only workers. Every report uses the fixed `INDEPENDENT_DOMAIN_WIDE` scope basis and records that its search is independent of builder scope.

Findings are content-addressed and question-bound. Catastrophic, wrong-direction, foundational, and critical safety/security findings return to the first-pass owner immediately. Material findings are consolidated by causal root. A noncritical hygiene finding is nonblocking unless it names a concrete consequence in one of the three Product roots.

## Campaign Finalizer

The Finalizer receives the exact terminal proposed commit/tree in a fresh clean worktree after the Feature Agent releases Product custody. Its scope is one consolidated causal correction batch, bounded simplification, and proof preparation. It has no owner-intent, acceptance, deployment, exception, or self-acceptance authority.

On completion the Finalizer releases its writer lease and the campaign root adopts the exact final commit/tree through a recorded handoff. The finalizer never silently replaces the Product root or changes the campaign identity.

The Finalizer also emits the bound rewrite assessment in
[cascade-economics.md](cascade-economics.md). A one-third hunk replacement is
only an early warning. Contract reinterpretation, architecture change, owner
intent recompilation, load-bearing replacement, broad rediscovery, lost
first-pass behavior, or repeated low rough-draft survival is
`REBUILD_REQUIRED`; it cannot be closed as a targeted repair.

The cascade is economically demonstrated only when its complete accepted-result
cost is at or below 75% of an equivalent direct accepted-result cost. Token
rates and estimates alone remain `UNPROVEN`. At least three accepted task-class
observations are required before the cascade becomes the default for that task
class.

Adjacent improvements are recorded as `ADJACENT_IMPROVEMENT` entries in the
append-only next-campaign ledger. They do not silently expand the current
implementation and do not reopen a completed acceptance contract.

## Delta proof

Delta audit includes previously failed questions, directly touched questions, dependent descendants, and one small end-to-end smoke set. Unaffected accepted evidence is reused only when question-tree version, relevant hashes, build identity, and environment identity still match. A repair invalidates only dependent answers; it does not restart the whole question corpus or create a serial approval queue.

One targeted delta repair and one supervisor-selected reframe per causal root are the normal limit. Equivalent retries stop and the failure is classified.

## Closure

The final candidate is admissible only when the exact content-addressed cascade
state co-binds `FUNCTION_REQUIREMENTS_PASS`, `DESIGN_BIBLE_PASS`,
`SECURITY_PASS`, the final candidate commit/tree, and the exact executable
Product-acceptance proof. The compiled Product-acceptance object does not
invent candidate fields outside its schema; the cascade acceptance binding and
outer state digest provide that join. Typed deployment and rollback receipt
digests, a live-audit receipt from the independent campaign Auditor, and the
closure receipt remain required. Runtime is the sole merge/deployment
executor. Until all closure facts are reconciled, the campaign is
`ACCEPTED_LIVE_PENDING_CLOSURE`.
