# NATIVE_SESSION_AND_EVIDENCE_CUSTODY platform handoff

Audit date: 2026-08-09
Domain ID: NATIVE_SESSION_AND_EVIDENCE_CUSTODY
Preserved feature identity: NATIVE_HOST_SESSION_LIFECYCLE
Dependent feature IDs: NATIVE_HOST_SESSION_LIFECYCLE, EVIDENCE_IDENTITY_HANDOFFS
Handoff state: PRODUCTION_CANDIDATE_PENDING_TESTS
Controller admission: BLOCKED_PENDING_CLEAN_PUSHED_PLATFORM_CHECKPOINT

This is a source-bound platform input, not completion, acceptance, merge, release, deployment, activation, or independent-clearance evidence.

## Authority and source custody

- Pyramid authority: a882a74b6a71ba1fe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d
- Committed source: 590c07ddd4be7a8c24727c24b40808e44ca7357d
- Committed source tree: f1b358d87e6a969fb9631e202a3d478540edd4d9
- Authority worktree is DIRTY; uncommitted authority files remain evidence only.
- Candidate worktree: WORKTREE_REF_C22B
- Candidate handoff SHA-256: 87868fc3741f32ce2552ba26c5a9130afe8e7f53730ba0c56bf0a5015e345a92
- Candidate feature-report SHA-256: ea577981a901cacb8436071ddc9338b9f5db89695e7ed8b6fd9dbaf263f528a4

## Platform boundary

The platform boundary is the shared seam between source-bound native-session execution and Controller-owned evidence and identity custody.

Named seams inspected: control/native-session-runner.mjs, control/native-session-team.mjs, control/native-host-attachment.mjs, control/native-session-host-attestation.mjs, control/persisted-record-privacy.mjs, schemas/native-session-run.v1.json, schemas/native-host-attachment.v1.json, schemas/native-session-host-spawn-attestation.v1.json, schemas/digest-bound-checkpoint.v1.json, and schemas/bootstrap-binding.v1.json.

The runner currently carries opaque completion digests rather than the full typed evidence receipt. The digest-bound checkpoint contract is a Controller-owned shared seam and is absent from this candidate. No parallel checkpoint subsystem was invented.

## Findings and custody rules

- P-001: the native runner does not join a typed independent-check handoff to a digest-bound checkpoint.
- P-002: the authority-side checkpoint schema is absent from the candidate and remains a Controller-owned shared-contract decision.
- P-003: the authority is dirty and no clean, pushed, remote-equal platform checkpoint or independent clearance receipt exists.

Feature lanes may consume an accepted public contract but may not edit shared platform seams or self-clear. Missing host capability, source mismatch, conflicting identity, missing meaningful progress, missing typed handoff, or nonzero active roster fails closed.

Portable records may contain relative scope, classifications, source commit/tree, and content digests only. Exact paths, environment values, host/session identities, credentials, and raw readbacks remain outside the portable handoff. The release remains PREPARED_NOT_ACTIVATED.

## Static evidence and downstream contract

Static syntax, JSON/import, privacy, and hygiene checks passed in the candidate. Functional tests, npm, live host lifecycle, commit, push, and external actions were not performed.

After the Controller selects and independently audits one clean platform tree, it must rebind the native and dependent evidence features to the accepted source and exact shared contracts, require typed evidence and honest independent-check state, preserve source/evidence/candidate digests and zero-roster closure evidence, then request independent clearance.

## Re-audit disposition

Status remains PRODUCTION_CANDIDATE_PENDING_TESTS. This handoff is not accepted, complete, or released. The platform lead made no control, schema, test, or binding change after scope correction; only documentation changed in the isolated candidate.

Exact next action: select one shared Evidence-and-Identity/checkpoint allowlist, accept one clean pushed platform checkpoint, refresh exact hashes, and independently re-audit this handoff before releasing dependent feature lanes. The full candidate handoff and report history remain preserved in the visible candidate worktree until downstream consumption.

## Controller integration correction — 2026-08-09

The central Controller has now integrated the external-host native-session
source set and joined the runner to the existing digest-bound checkpoint
contract. The earlier candidate wording that the checkpoint schema was absent
is historical and remains preserved; the current central state fails closed
before spawn when the checkpoint is missing or its source commit/tree differs.
The integration is still not an accepted platform checkpoint because the
central worktree is dirty, uncommitted, and not independently functionally
verified.

## Controller preservation receipt — 2026-08-09

The completed visible task's refreshed handoff was preserved in the central
platform-batch receipt under digest
`286c908ca911cf2e3d17a342f579ac310ae9c0d8f9992cc641bcc6d6128c1a17`.
Central has not consumed unreviewed worker code; this handoff remains held for
central audit, clean custody, and independent clearance.
