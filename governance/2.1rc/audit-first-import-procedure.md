# Canonical Audit-First Import Procedure

Status: `PREPARED_NOT_ACTIVATED`

Full project imports use an audit-first convergence procedure. Import is not a
copy followed by a broad security review. AgentOS preserves the legacy source,
admits exact clean commit/tree baselines, verifies the external control-plane
boundary, and compiles a complete standards inventory before repair work.

Every registry, discovered, and owner-declared standard receives an independent
source-freshness and applicability decision. Only an `APPLICABLE` result creates
clause-level work. `NOT_APPLICABLE_WITH_EVIDENCE`, `UNKNOWN_BLOCKED`, and
`SUPERSEDED` remain visible and content-addressed; unknown applicability blocks
the dependent release claim.

Each applicable mandatory clause is traced through product surface,
implementation commit/tree, proof, finding, repair candidate, independent
disposition, evidence ceiling, rollback identity, and residual risk. One atomic
specialist owns one standard/version or one narrow technical failure mode.
Applicability, audit, repair, and acceptance identities are separate and cannot
self-accept.

Repair clones use isolated worktrees and Scheduler custody, with at most six
concurrent repair clones. Accepted work passes through Platform and Central
integration and repeats independent audit/repair until mandatory findings
close. Deterministic local proof precedes required deployed-real-use proof.

The final pack contains traceability, applicability/source receipts, independent
dispositions, local and real-host proof, applicable SBOM/provenance, rollback,
residual risk, and a release recommendation. The recommendation is not legal
certification, regulatory approval, security perfection, or universal
compliance.

Every bounded debug or Bootstrap action ends with an immediate typed handoff.
Missing requested evidence is an incomplete failed handoff, not successful
discovery deferred to a later pass.
