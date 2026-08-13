# AgentOS 3 side-by-side installation topology

The inactive AgentOS 3 candidate installs only into a private sibling directory. The consumer root may be:

- an actually empty, non-Git project root;
- a non-Git project root with ordinary files;
- one Git worktree; or
- a composition root containing multiple Git worktrees, including a root worktree plus nested worktrees.

Before staging, before atomic publication, after publication, before rollback, and after rollback, AgentOS creates a deterministic `agentos.integration.project_snapshot.v2` readback. It hashes every visible file and directory while excluding every `.git` administrative object. Each real Git worktree is represented separately by relative root, HEAD/tree or unborn state, branch, exact porcelain-status bytes, and Git-administration kind. AgentOS never walks Git object stores.

Symbolic links, special files, unsafe `.git` objects, incomplete nested-repository discovery, a noncanonical root, a nonsibling companion, or any consumer mutation fail closed. Empty directories are material consumer state and therefore participate in zero-trace comparison.

The snapshot is evidence, not authority to change the consumer. Installation remains inactive and rollback deletes only the exact content-addressed companion payload after verifying its receipt and the unchanged consumer snapshot. A later uninstall contract may permit ordinary consumer evolution, but this test-build rollback intentionally remains stricter.

Changing this snapshot contract invalidates install receipts and requires a fresh install from the new bundle. Version 1 receipts are not silently migrated.
