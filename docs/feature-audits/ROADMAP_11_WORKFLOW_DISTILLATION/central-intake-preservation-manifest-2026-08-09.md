# Roadmap 11 Central Intake Preservation Manifest

Feature: `ROADMAP_11_WORKFLOW_DISTILLATION`

## Authority

- Pyramid SHA-256: `a882a74b6a71ba1fe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`
- Scheduler companion SHA-256: `3cef7fcb7897ad44f7975c1c6cb50cd20ca82cfa1ce1c3c8849c18de9aedda10`

## Candidate identity

- Isolated worktree: `WORKTREE_REF_ROADMAP_11_CANDIDATE [REDACTED_FOR_PORTABLE_RECORD]`
- Candidate commit: `ae489fb44e5e1081a48f4d5ea4cb4bd9905a7ba1`
- Candidate tree: `a400d33bf0c3d56e8a14a33066d5f0bb2c606267`
- Candidate report SHA-256: `173c05e52ec0d2844f928cb09c8662c164d1b8b72e3f0e5c93710d442f042b12`

## Central baseline

- Central worktree: `CENTRAL_MERGE_WORKTREE_REF [REDACTED_FOR_PORTABLE_RECORD]`
- Baseline commit: `590c07ddd4be7a8c24727c24b40808e44ca7357`
- Baseline tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`

## Path disposition

### Central additive

- `docs/feature-audits/ROADMAP_11_WORKFLOW_DISTILLATION/auditreport.md` — append-only suffix retained; central history preserved.

### Central repair replayed

- `control/apprenticeship-common.mjs`
- `control/apprenticeship-drill.mjs`
- `control/apprenticeship-native-runner.mjs`
- `control/apprenticeship-observation.mjs`
- `control/apprenticeship-reproduction.mjs`
- `control/apprenticeship-role-packet.mjs`
- `control/native-host-attachment.mjs`
- `schemas/apprenticeship-common.v1.json`
- `schemas/apprenticeship-independent-review.v1.json`
- `schemas/apprenticeship-observation.v1.json`
- `schemas/apprenticeship-plan.v1.json`
- `schemas/apprenticeship-proposal.v1.json`
- `schemas/apprenticeship-reconstruction.v1.json`
- `schemas/apprenticeship-reproduction.v1.json`
- `schemas/apprenticeship-role-packet.v1.json`
- `tests/verify-apprenticeship-contracts.mjs`
- `tests/verify-apprenticeship-native-observation.mjs`

### Already central byte-identical and retained

- `control/apprenticeship-contract-hardening.mjs`
- `control/apprenticeship-contracts.mjs`
- `control/content-addressing.mjs`
- `control/persisted-record-privacy.mjs`
- `schemas/apprenticeship-admission.v1.json`
- `schemas/apprenticeship-evidence-attestation.v1.json`
- `schemas/apprenticeship-gate-source.v1.json`
- `schemas/apprenticeship-handoff.v1.json`
- `schemas/apprenticeship-native-run.v1.json`
- `schemas/apprenticeship-owner-decision.v1.json`
- `schemas/apprenticeship-record-envelope.v1.json`
- `schemas/apprenticeship-state.v1.json`
- `schemas/persisted-record-privacy.v1.json`
- `schemas/workflow-auditor-drill.v1.json`
- `tests/verify-apprenticeship-contract-hardening.mjs`

### Candidate-only/rejected

- `control/native-host-contract.mjs` — hygiene-only whitespace normalization; not replayed.
- `control/agentos.mjs` — stale minimal aggregate excluded before candidate commit; central full aggregate remains authoritative.

## Safety and lifecycle

- Static-only intake. No npm or functional tests used.
- Native/live-host fresh-worker evidence remains `PENDING_EXTERNAL_EVIDENCE`.
- Lifecycle remains `PREPARED_NOT_ACTIVATED`.
- `downstream_consumed=false`.
- No release, activation, deployment, publication, merge, or archive occurred.
- The visible Roadmap 11 task and isolated worktree remain preserved and unarchived.

## Central disposition

`CENTRAL_INTEGRATION_PENDING`

The replayed bytes are not a release claim. Central must perform its permitted static readback and later authorized functional/native evidence before any downstream consumption or lifecycle transition.
