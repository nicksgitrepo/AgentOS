# PRIVATE_CONTROL_AND_MEMORY_MAPS platform handoff

Status: PLATFORM_DOMAIN_AUDIT_REPAIR_REAUDIT_COMPLETE
Platform domain: PRIVATE_CONTROL_AND_MEMORY_MAPS
Dependent feature: ROADMAP_08_MEMORY_CAPSULES
Dependent features: OFFLINE_LOCAL_MODE, PROVIDER_DISCOVERY, PRIVATE_CONTROL_INSTANCE, PROJECT_MEMORY_LEDGER, BOUNDED_PROJECT_MAPS
Downstream consumed: false
Central intake: pending platform-registry admission and downstream preservation

## Authority and source identity

- Pyramid authority: a882a74b6a71ba1fe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d
- Central source commit: 590c07ddd4be7a8c24727c24b40808e44ca7357d
- Central source tree: f1b358d87e6a969fb9631e202a3d478540edd4d9
- Central readback: DIRTY_ASSEMBLY_WORKTREE; named inputs include untracked source files.
- Candidate base commit: 1fba3305c959df4de1b26c39441d8d7769e61686
- Candidate base tree: bbc298bad534740a50e64acec910d81f459c790f
- Candidate handoff SHA-256: dc72f13f3100defb85b285cca94eb5692dcdee784161f6e23231ea40ad4d7c33
- Candidate feature-report SHA-256: 2e748e1fa2173a09754a37e216023e131b4ae5a1fd48721576025ac6a0bf2d13
- Candidate task/worktree references remain opaque and are not portable path data.

## Platform boundary

This domain joins private control-plane custody, offline/provider selection, the canonical project-memory ledger, and derived project maps and indexes. The ledger is authoritative; maps and indexes are rebuildable projections. Provider capability is an adapter boundary, not a project-memory authority.

Named seams inspected: private-control common/bundle/discovery/offline modules, project-memory and projections, project-map, derived-index, map-memory common, and their private-control, project-memory, project-map, and derived-index schemas, reports, and bindings.

Six provider/offline/binding inputs are central-only and remain separate custody. No source-code repair was admissible; only the platform handoff, current-state projection, and feature-report history changed in the candidate.

## Findings and custody rules

- Private control data stays outside product repositories and portable public records.
- Offline mode must remain usable without provider access; provider discovery may recommend a remote private workspace but cannot silently activate one.
- Project memory is canonical, append-oriented, privacy-safe, and partial; map/index artifacts are derived and never acceptance authority.
- Capsules are advisory-only. They do not claim encryption, synchronization, migration, rollback, compaction, full payload transfer, functional proof, or accepted live behavior.
- No secret, credential, provider token, private machine path, chat link, raw session, or product identity is stored in this handoff.

## Evidence, failure, and downstream contract

Static syntax, JSON, actual-byte comparison, whitespace, and privacy checks passed. Functional tests, npm, live/provider behavior, deployment, clean-machine, and independent acceptance proof were not run.

Missing provider capability, authority-root mismatch, privacy violation, corrupted ledger, stale projection, or unsupported capsule operation fails closed as typed unavailable/partial evidence. The Controller owns platform-registry admission and any shared contract/binding change. Feature lanes may consume the accepted public memory/capsule contract but may not edit private control or ledger seams.

## Disposition and next action

Status: PLATFORM_DOMAIN_CANDIDATE_READY_FOR_CENTRAL_PENDING_COMMIT_AUTHORITY. The source is not clean or pushed, and downstream adoption remains false.

Exact next action: re-audit the combined binding and source surfaces, record platform-registry admission when an applicable consumer exists, preserve the candidate report and handoff, and only then release dependent feature lanes. Keep this lane/worktree visible until downstream preservation is proven.

## Controller preservation receipt — 2026-08-09

The completed visible task's refreshed alias-aware handoff was preserved in the
central platform-batch receipt under digest
`a99fa8644c111c5e823ebd0b2fd24cbf1b001ddaea13da343360d03ab5ed97bd`.
Central has not consumed unreviewed worker code; this handoff remains held for
central audit, registry admission, clean custody, and independent clearance.
