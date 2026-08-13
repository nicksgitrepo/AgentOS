# AgentOS 3.0 Audit–Repair Convergence

Status: `PORTABLE_CANDIDATE_INACTIVE`

The executable authority is
[`control/audit-repair-convergence.mjs`](../../control/audit-repair-convergence.mjs).
It is a custody and decision substrate; it does not run Scheduler jobs, mutate a
repository, deploy, or accept its own output.

## Finding truth

Every audit finding is `agentos.audit_finding.v1`. It binds a stable identity,
semantic key, causal root, exact source observations, multi-item evidence,
gate/clause references, affected surfaces, severity, confidence, blast radius,
dependency and conflict edges, repair class, focused proof, independent
acceptance, and an explicit evidence ceiling. Lifecycle history is append-only.
Fresh re-audit may reopen an accepted finding. Deferred real-host proof stays
`UNTESTED_DEFERRED`; it cannot support a real-host claim.

Semantic consolidation groups only an exact `(causal_root_id, semantic_key)`.
Aliases that cross either boundary fail closed. All source finding identities,
observations, evidence, and priority variants survive consolidation. No prose
similarity heuristic may erase evidence.

## Repair graph and waves

Every declared conflict requires evidence-backed resolution. Dependency and
ordered-conflict edges form one DAG; cycles fail closed. Ready nodes are ordered
deterministically by:

1. dependency eligibility;
2. Wave A, then B, then C repair class;
3. severity and blast radius;
4. number of downstream nodes unblocked;
5. UTF-8 finding ID.

Wave A contains safety/data/security blockers, characterization, architecture,
structural boundaries, and shared security/data/concurrency foundations. Wave B
contains shared seams, functional correctness, cross-cutting controls, and
semantic deduplication. Wave C contains localized quality, documentation/test
organization, and release metadata hygiene.

## Candidate custody

Every Feature candidate carries exact commit/tree, focused proof, independent
acceptance, and a validated Scheduler admission receipt. Accepted and rejected
candidates both remain in a content-addressed retention ledger; rejection never
deletes custody evidence.

For each accepted Feature candidate, the Platform matrix contains one cell for
every registered Platform. Every cell is exactly `CONSUMED` or
`NOT_APPLICABLE_WITH_EVIDENCE`. Each applicable Platform produces a cumulative
candidate and independent re-audit over every consumed finding. Reopened
findings return to the repair loop and block Central intake.

Central intake binds the complete candidate ledger, every matrix cell, each
passing cumulative Platform candidate, the repair DAG, and the converged finding
ledger. It explicitly retains rejected candidates and cannot silently omit an
accepted Feature or matrix cell.

## Existing controller interfaces

- Scheduler integration is receipt-only through
  `validateSchedulerAdmissionReceipt`; this controller never executes a job.
- Cascade integration emits an `AUDIT_REPAIR_CONVERGENCE` event for the repaired
  `applyCascadeTransition` transaction and validates exact append-only readback.
  The cascade remains the stage-transition authority.

## Exhaustion and closure

`BLOCKED_EXACT` requires three immediately relevant failed recovery records with
one exact failure signature and three distinct bounded recovery routes. A
convergence ledger is terminal only when every finding is accepted, explicitly
deferred, rejected as a false positive, or exactly blocked. Terminal disposition
does not convert deferred proof into proof.

Any controller, schema, governance, migration, dependency interface, or binding
digest change invalidates dependent DAGs, candidate receipts, Platform matrices,
cumulative Platform candidates, Central manifests, convergence ledgers, cascade
events, and release manifests. Recompile from preserved source findings; never
rewrite historical records in place.
