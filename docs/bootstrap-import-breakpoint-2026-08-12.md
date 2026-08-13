# Bootstrap import breakpoint checkpoint

Status: `WAITING_FOR_SOURCE_ROOT`
Governance: `2.1rc`
Candidate state: `REPAIRED_TESTED_PENDING_REVIEW`

## Fresh generic hostile start

A temporary generic parent was created with two nested repository identities: one directory-form `.git` boundary and one worktree-form `.git` file. A fresh read-only invocation of `control/bootstrap-compiler.mjs start <fixture> RECOMMENDED` produced:

- `READ_ONLY_DISCOVERY_COMPLETE`
- `repositories.topology = MULTI_REPOSITORY_PROJECT_ROOT` (`OBSERVED_FACT`)
- `repositories.nested.count = 2`
- `PROJECT_IMPORT = OWNER_REQUIRED` and blocking
- `SOURCE_PRESERVATION = DEPENDENCY_PENDING` and blocking
- first owner question remains `project.north_star`
- authentication, publication, deployment, and deletion remained unattempted
- before/after fixture tree and file hashes were identical

This proves that a multi-repository parent is treated as an explicit composition/import decision. Bootstrap does not silently adopt, copy, normalize, or merge any nested source.

## External source-root observation

The caller-supplied source root was observed read-only and contained zero entries: no root `.git`, no nested repository identity, and no importable source files. The fresh start result was:

- topology: `UNKNOWN` / `NOT_A_GIT_REPOSITORY`
- project import: `NOT_APPLICABLE_WITH_PROOF`
- next question: `project.north_star`
- external control-plane path was resolved but not created

No source path was invented, copied, imported, or mutated. Source-preservation proof cannot begin until an actual source root is supplied.

## Generic work completed before waiting

- local/remote branch and commit identity verified
- hostile multi-repository discovery and read-only start tests passed
- empty-root proof and symlink/dependency-tree hostile coverage passed
- full canonical verifier passed: 5,350 files, 474 normative paths, 132 test modules
- consumer and source repositories remained byte-for-byte untouched

## Restart condition

Resume the import slice only when a real source root or a typed owner project-boundary decision is available. The next allowed action is read-only source identity and preservation planning; no import, copy, normalization, build, deployment, or activation is authorized by this checkpoint.
