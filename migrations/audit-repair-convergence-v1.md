# Audit–Repair Convergence v1 Migration and Invalidation

Status: `PORTABLE_CANDIDATE_INACTIVE`

## Admission

Legacy narrative findings and partial campaign reports are evidence sources, not
valid v1 findings. Preserve them unchanged. Create a new `audit_finding.v1` for
each stable finding and bind the legacy object as a source observation/evidence
item. Unknown clauses, applicability, evidence ceilings, dependencies, or
conflicts remain explicit gaps; do not infer them.

Existing Feature receipts may be admitted only after exact commit/tree,
Scheduler admission, focused proof, independent acceptance, applicable Platform
set, and retention status are present. A legacy rejection without retained
identity is an incomplete migration, not a silently discarded candidate.

## Rebuild order

1. canonical findings and append-only lifecycles;
2. semantic/causal consolidation;
3. conflict dispositions and acyclic repair DAG;
4. Feature candidate retention ledger;
5. complete Feature × Platform matrix;
6. cumulative Platform candidates and independent re-audits;
7. convergence ledger;
8. Central intake manifest;
9. cascade convergence event/readback;
10. dependent release evidence.

## Invalidation

A change to a source finding, alias, causal root, evidence, gate/clause,
dependency/conflict, priority, proof contract, evidence ceiling, lifecycle,
Scheduler admission, candidate identity, Platform roster/disposition, re-audit,
or any bound controller/schema/governance digest invalidates that object and all
downstream objects in the rebuild order. Invalidated records remain preserved
with their old digest. Rebuilding creates new identities; it never edits an
accepted historical receipt.

Activation, Product migration, deployment, and protected release remain outside
this candidate.
