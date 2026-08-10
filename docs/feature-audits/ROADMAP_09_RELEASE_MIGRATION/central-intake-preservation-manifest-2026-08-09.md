# Central intake preservation manifest — Roadmap 09

- authority_sha256: `a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`
- scheduler_authority_sha256: `3cef7fcb7897ad44f7975c1c6cb50cd20ca82cfa1ce1c3c8849c18de9aedda10`
- central_baseline_commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- central_baseline_tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- candidate_feature_id: `ROADMAP_09_RELEASE_MIGRATION`
- candidate_source_commit: `ffd9dd9f5407297ca8f24bf7db26701a8a4834ea`
- candidate_source_tree: `ba3db5bb59940f4b62472664105e04ef1c6a201f`
- candidate_report_sha256: `3df64ce729163bc4615d61276775dd927933bf8418c6bbf7822efc72ff2a5011`
- downstream_consumed_before_intake: `false`
- central_disposition: `CENTRAL_INTEGRATION_PENDING`

## Preservation boundary

The visible Roadmap 09 task and its isolated worktree remain preserved and
unarchived. Central accepts only the release-specific additive changes after
rebasing onto current central bytes. The prior stale copies of the shared
README, release lifecycle/gate, blocker, release documentation, schemas, and
verifier are rejected as source history and are not copied over central.

### New release slice

- `control/release-common.mjs`
- `control/release-compatibility.mjs`
- `control/release-model-check.mjs`
- `control/release-policy-replay.mjs`
- `control/release-safety-gate.mjs`
- `schemas/release-compatibility.v1.json`
- `schemas/release-migration.v1.json`
- `schemas/release-model-check.v1.json`
- `schemas/release-policy-replay.v1.json`
- `schemas/release-safety-gate.v1.json`
- `tests/verify-release-safety.mjs`

### Shared surfaces admitted only as additive deltas

The current central versions remain the base for release lifecycle and
promotion gate behavior, documentation, schema metadata, blocker records, and
the canonical verifier. Only release-safety/migration fields, additive
documentation, and dynamic verifier discovery for the focused release verifier
are admitted.

No functional, scheduler, host, owner-activation, deployment, live-site,
commit-to-central, push, release, or archive proof is claimed. The handoff
remains `downstream_consumed: false` until central records the intake and a
later scheduler-bound verification is authorized.

## Central intake readback — updated pyramid authority

The updated pyramid and scheduler companion were re-read before intake. The
Roadmap 09 candidate was accepted only as a source-bound additive release
slice after stale shared copies were compared against current central bytes.
Central preserved the current README, lifecycle, promotion gate, blocker,
release article, schema metadata, and canonical verifier behavior, while
adding only the release-safety and migration-provenance deltas recorded in the
feature report.

The candidate remains visible and unarchived. Its handoff commit and tree are
preserved above; its report, this manifest, and the central integration audit
are the retained evidence chain. `downstream_consumed` remains `false` until a
later source-bound central consumer proves the integrated candidate and the
applicable scheduler admits its functional verification. No release,
activation, push, deployment, or archive action was performed.
