# Platform Audit — Native Session and Evidence Custody

Status: `HANDOFF_RECEIVED_PENDING_INDEPENDENT_CLEARANCE`

This is the platform-lane report for `PLATFORM_NATIVE_SESSION_EVIDENCE`. It is
separate from the dependent feature report for
`NATIVE_HOST_SESSION_LIFECYCLE`; the feature report remains preserved at
`docs/feature-audits/NATIVE_HOST_SESSION_LIFECYCLE/auditreport.md`.

## Source-bound scope

- Domain: `NATIVE_SESSION_AND_EVIDENCE_CUSTODY`
- Dependent features: `NATIVE_HOST_SESSION_LIFECYCLE`, `EVIDENCE_IDENTITY_HANDOFFS`
- Handoff: `docs/platform-handoffs/native-session-evidence-platform-handoff.md`
- Source surfaces: `control/native-session-runner.mjs`,
  `control/native-session-team.mjs`, `control/native-host-attachment.mjs`,
  `control/native-session-host-attestation.mjs`, and the related native-session
  schemas and bindings.
- Source identity: `590c07ddd4be7a8c24727c24b40808e44ca7357d` /
  `f1b358d87e6a969fb9631e202a3d478540edd4d9`.

## Current findings

The preserved handoff identifies the shared platform boundary as native-session
identity, typed evidence, digest-bound checkpoints, and ordered
preserve/unpin/archive/roster closure. The current candidate remains dirty and
has no independent clearance or clean checkpoint. The missing shared
Evidence-and-Identity/checkpoint allowlist is an ordinary platform integration
finding for the Controller to resolve before feature admission, not a release
claim.

Static evidence is preserved in the handoff and dependent feature report.
Functional tests, host lifecycle, commit, push, deployment, and activation were
not performed.

## Required next action

The platform task must append its audit and repair passes here, preserve the
typed handoff before any downstream use, and return a source-bound platform
candidate. The Controller must independently clear the shared checkpoint
contract before admitting dependent feature lanes.

## Controller integration and checkpoint repair — 2026-08-09

The central cumulative worktree now carries the external-host native-session
surface and its transitive contracts in the content-addressed binding. The
Controller also joined native completion to the existing
`agentos.digest_bound_checkpoint.v1` contract:

- a completed native wave must receive a validated checkpoint;
- checkpoint source commit and tree must equal the wave source binding;
- a missing or mismatched checkpoint fails before native spawn;
- the run record retains the checkpoint and validates it again;
- the native host contract requires a caller-supplied model and reasoning
  profile instead of embedding one provider's default.

Static evidence: 438 bound paths have zero digest mismatches; the native
source and schema set parses; native syntax and diff hygiene pass; no private
paths, secrets, credentials, or chat links were added.

Disposition remains `HOLD_PENDING_CLEAN_CUSTODY_AND_FUNCTIONAL_VERIFICATION`.
The central worktree is still dirty and uncommitted, no live host readback or
functional verification was performed, and the visible platform task remains
preserved and unarchived until a clean source-bound checkpoint is recorded and
downstream preservation is complete.

## Controller preservation receipt — 2026-08-09

The completed visible native platform task supplied a refreshed source-bound
handoff with handoff digest
`286c908ca911cf2e3d17a342f579ac310ae9c0d8f9992cc641bcc6d6128c1a17` and this
platform-report digest
`ca47594aae2e11f4bb46731df7e3a65e877baa224e431283a9f599d8dcc73fa3`.
Its existing feature-report history is preserved under the central batch
receipt. The report records 49 physical custodians, three platform aliases,
zero duplicate platform tasks, and the same clean-custody and independent-
clearance hold. No worker code was consumed without central review.
