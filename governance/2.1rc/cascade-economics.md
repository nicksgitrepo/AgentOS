# 2.1rc Cascade Economics and Finalizer Scope

Status: `PREPARED_NOT_ACTIVATED`

The executable authority is [control/cascade-economics.mjs](../../control/cascade-economics.mjs), with its contract in [schemas/cascade-economics.v1.json](../../schemas/cascade-economics.v1.json). This article keeps model and provider names in project context while making the operating economics and Finalizer boundary explicit.

## ELI5

The first-pass builder does the broad work. Independent auditors make one concise punch list. The Campaign Finalizer repairs the retained implementation. A delta audit checks the exact Finalizer candidate before release.

The cascade is not declared cheaper because one model has a lower token rate. It is cheaper only when the complete cascade produces an independently accepted result at no more than 75% of an equivalent direct accepted result.

## Accepted-result cost

The cost ledger compares:

```text
CASCADE_COST =
    first-pass implementation
  + rolling audit
  + Finalizer
  + delta re-audit
  + additional repair
  + integration

DIRECT_COST =
    full direct implementation
  + equivalent final audit
  + equivalent integration

EFFICIENCY_RATIO = CASCADE_COST / DIRECT_COST
```

The comparison is content-addressed to two equivalent accepted-result identities. Estimates are `UNPROVEN`; they cannot be reported as demonstrated savings.

```text
ratio <= 0.75
    COST_SAVING_DEMONSTRATED

0.75 < ratio <= 1.00
    NONCOST_JUSTIFICATION_REQUIRED
    Speed, assurance, or escaped-defect reduction must justify the route.

ratio > 1.00
    RECONSIDER_CASCADE
```

The default route for a task class requires at least three accepted observations. Those observations track first-pass survival, Finalizer rebuild rate, audit cost, repair rounds, escaped findings, and accepted-result cost.

## Finalizer versus rebuild

The Finalizer must preserve the retained candidate’s intent and architecture while repairing the consolidated findings. It records rewrite signals instead of relying on line count alone.

A one-third relevant-hunk replacement is an early warning, not an automatic rebuild. `REBUILD_REQUIRED` is derived when the Finalizer:

- reinterprets a public contract;
- changes the architecture;
- recompiles owner intent;
- replaces the load-bearing implementation;
- requires broad repository rediscovery;
- fails to preserve first-pass behavior; or
- repeats a task class with low rough-draft survival.

A `REBUILD_REQUIRED` assessment cannot close a Campaign Finalizer as `TARGETED_REPAIR`. The work must be deliberately reclassified and rebuilt under the appropriate route.

## Control-plane wake behavior

Routine progress does not wake the expensive model. Deterministic control-plane reconciliation checks state, liveness, leases, worktrees, checkpoints, findings, budgets, and intervention triggers first. A model is woken only for a real liveness, custody, contradiction, or authority problem. The existing project-configured health interval remains authoritative.

Telemetry is secret-free and never grants Product acceptance, deployment, spending, or owner authority.
