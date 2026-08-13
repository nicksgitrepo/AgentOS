# Composed source-preservation planning

For a composed project, preservation is planned independently for every
included repository. The plan binds the exact source root reference, commit,
tree, branch, remotes, dirty and untracked ownership policy, worktree
inventory, submodule rule, exclusions, restore procedure, and five required
artifacts: archive, manifest, index, receipt, and exclusions record.

The plan is external to both the sources and the clean destination. It is
content-addressed, but it does not create archives. Before-write checks prove
the destination is separate, every source identity is current, excluded
repositories remain outside Product scope, historical worktrees are not
traversed as source, and no unsafe or secret-bearing objects are admitted.

After creation, an independent reviewer must verify archive bytes against the
manifest, all artifact digests and receipt bindings, exclusion readback,
restore procedure, source byte-for-byte stability, and destination zero trace.
Any mismatch keeps execution `NOT_AUTHORIZED`; no normalization or import may
begin from a plan alone.
