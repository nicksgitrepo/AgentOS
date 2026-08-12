# Bootstrap Multi-Repository Discovery Repair

Status: `REPAIRED_TESTED_PENDING_REVIEW`

## Assigned slice

Repair the generic Bootstrap discovery/import boundary for a parent directory
that may contain multiple nested Git repositories. The consumer project remains
outside this worktree and was not read or modified.

## Evidence

- Baseline candidate commit: `a446664bfcd719b0b4cebdfe595f8ab2a470cf63`
- Baseline tree: `640ad53354e95e136a69941fb09229c70567e2c8`
- Baseline behavior: root-only `git rev-parse` returned
  `NOT_A_GIT_REPOSITORY`; coverage could then mark project import
  `NOT_APPLICABLE_WITH_PROOF` without checking nested repositories.
- A parent directory containing nested repositories is a multi-repository
  project composition, not evidence that import is unnecessary.

## Repair

- Bootstrap now performs bounded, deterministic, read-only nested `.git`
  topology discovery.
- Git metadata is never traversed and symlinks are never followed.
- Nested repository identities are emitted as secret-free facts.
- Scan limits and unsafe/partial observations become explicit conflicts.
- Any nested-repository fact, including a conflict, makes the project-import
  output owner-required instead of silently not applicable.
- Empty non-Git roots retain the original `NOT_A_GIT_REPOSITORY` and
  `NOT_APPLICABLE_WITH_PROOF` behavior.
- The first material owner question remains `project.north_star`; topology
  discovery does not reorder intent questions.

## Verification

- Focused hostile discovery verifier passed.
- Bootstrap start, coverage, and project-import verifiers passed.
- Canonical repository verifier passed after the repair and binding refresh.
- No import, copy, normalization, build, deploy, authentication, spawn, or
  consumer mutation occurred.

## Next decision

For a detected multi-repository root, the owner must choose whether the child
repositories form one governed composition or separate projects. Import work
must wait for that typed decision and per-repository source/custody plan.
