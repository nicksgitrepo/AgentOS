# Composed multi-repository import

AgentOS must represent a composed project explicitly when one product is
formed from two or more source repositories. A non-Git parent or a directory
containing nested repositories is not itself a source. Bootstrap records each
included repository, the separate destination, and every excluded repository
before any mutation.

The read-only `agentos.composed_project_import.v1` plan binds each source to an
opaque worktree reference, commit, tree, branch, remote identity, dirty and
untracked counts, owner disposition policy, worktree inventory, submodule count,
repository role, and preservation procedure. Historical worktrees are evidence
only and are excluded from source traversal. Operational/control repositories
remain preserved exclusions unless a later typed decision changes scope.

`NORMALIZE_AND_AUDIT` is a candidate mode, not permission to write. All source
roots remain unchanged. Before any normalization, archive, or destination write,
the Scheduler/Runtime custody must produce independently verified, external
content-addressed preservation artifacts for every included root. A composed
plan with incomplete preservation is `NOT_AUTHORIZED`, and its execution helper
fails closed rather than silently treating the first repository as the source.

The destination is a distinct sibling binding. It cannot equal or overlap any
source. Rollback retains every original root and returns to the exact source
identities if the candidate fails. No raw host path is persisted in the plan;
paths are resolved only at the read-only execution boundary and become opaque
references in durable receipts.
