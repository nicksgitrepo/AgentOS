# Central intake preservation manifest — Roadmap 10

- authority_sha256: `a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`
- scheduler_authority_sha256: `3cef7fcb7897ad44f7975c1c6cb50cd20ca82cfa1ce1c3c8849c18de9aedda10`
- central_baseline_commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- central_baseline_tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- candidate_feature_id: `ROADMAP_10_MAPS_INTELLIGENCE`
- candidate_source_commit: `1d7619f52a037c71fbfd65d3186cede21e9823ad`
- candidate_source_tree: `1218c433f210963e1e0b08fc3cfaef45eb646c6a`
- candidate_report_sha256: `eeed42c03e97bf94614f818216d937c8658fca4f122b08be44c19ba7daf08d4b`
- downstream_consumed_before_intake: `false`
- central_disposition: `CENTRAL_INTEGRATION_PENDING`

## Preservation boundary

The visible Roadmap 10 task and isolated worktree remain preserved and
unarchived. Central accepts the bounded map/index slice only after comparing
the candidate against current central bytes. Current shared privacy,
content-addressing, and aggregate-verifier bytes are retained when identical;
stale local copies cannot overwrite newer central behavior.

## Candidate changed paths

- `control/README.md` — additive map/index documentation only
- `control/content-addressing.mjs` — already equal to current central bytes
- `control/derived-index.mjs`
- `control/map-memory-common.mjs`
- `control/persisted-record-privacy.mjs` — already equal to current central bytes
- `control/project-map.mjs`
- `docs/feature-audits/ROADMAP_10_MAPS_INTELLIGENCE/auditreport.md`
- `schemas/README.md` — additive map/index documentation only
- `schemas/derived-index-instance.v1.json`
- `schemas/derived-index-query-instance.v1.json`
- `schemas/derived-index.v1.json`
- `schemas/project-map-instance.v1.json`
- `schemas/project-map.v1.json`
- `tests/verify-all.mjs` — byte-identical to current central verifier
- `tests/verify-derived-index.mjs`
- `tests/verify-map-memory-contracts.mjs`
- `tests/verify-project-map.mjs`

## Intake ceiling

The candidate is `PREPARED_NOT_ACTIVATED` and advisory-only. Static syntax,
JSON, diff, privacy, and exact-byte evidence may be recorded here. Functional
verification, scheduler terminal proof, host readback, clean release
promotion, deployment, live audit, owner acceptance, and archive remain
pending. No central commit, push, release, activation, or task archival is
performed by this intake.

## Central intake readback — updated pyramid authority

The updated pyramid and scheduler companion were re-read before intake. The
candidate report is preserved in full, and the Roadmap 10 map/index controllers,
schemas, and focused checks were byte-compared against the current central
snapshot. Current shared privacy, content-addressing, and aggregate-verifier
bytes were retained; only the additive README boundary and retained evidence
were admitted here.

The candidate remains `PREPARED_NOT_ACTIVATED` and advisory-only. Its visible
task and isolated worktree remain preserved and unarchived with
`downstream_consumed=false`. Functional checks, scheduler terminal proof,
release, activation, deployment, owner acceptance, and archive remain pending.
