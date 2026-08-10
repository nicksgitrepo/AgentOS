# Central intake preservation manifest — Roadmap 08

- authority_sha256: `a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`
- scheduler_authority_sha256: `3cef7fcb7897ad44f7975c1c6cb50cd20ca82cfa1ce1c3c8849c18de9aedda10`
- central_baseline_commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- central_baseline_tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- candidate_feature_id: `ROADMAP_08_MEMORY_CAPSULES`
- candidate_source_commit: `5ba4f57df4f42cdf38b98eb66d20c9f9d144a332`
- candidate_source_tree: `1572da3a78dba0153f71e0010d52d36b137467a9`
- candidate_report_sha256: `d4a8af983c19740976ccf126a70f04d736ecfbe6aef30b25414123cde51349f0`
- downstream_consumed_before_intake: `false`
- central_disposition: `CENTRAL_INTAKE_PENDING_STATIC_REAUDIT`

## Preservation boundary

The candidate worktree and visible task remain preserved and unarchived. Central
intake may consume only the five documented additive deltas and the three new
capsule files below. Fourteen shared paths were byte-reconciled to the current
central versions and are not replaced.

### Additive existing-file deltas

- `control/persisted-record-privacy.mjs` — symlink-safe private parent creation
- `control/private-control-bundle.mjs` — deterministic UTF-8 manifest/exclusion ordering
- `control/project-memory-projections.mjs` — disjoint scopes and explicit invalidation reason
- `control/project-memory-store.mjs` — pre-write/readback binding validation
- `control/project-memory.mjs` — bounded capsule API export was already present in the current central bytes; no replacement was needed

### New capsule files

- `control/project-memory-capsule.mjs`
- `schemas/project-memory-capsule-import.v1.json`
- `schemas/project-memory-capsule.v1.json`

### Explicitly not consumed

No functional, live, browser, deployment, clean-machine, encryption,
synchronization, migration, rollback, compaction, or accepted-live proof is
claimed. The candidate remains `downstream_consumed: false` until a later
platform consumer is source-backed and records its own intake.
