# AgentOS 3 release-source parity

An AgentOS 3 bundle is generated from one clean, exact source commit and tree.
The generated artifact commit may descend from that source only by changing the
declared `main-core` snapshot, source manifest, and `dist` paths. Any other
committed or uncommitted change invalidates the release source.

`tools/rebind-main-core.mjs` requires a clean worktree, rejects symbolic links
and special files, and records the exact source commit/tree before copying the
portable `control` tree. `tools/release-source.mjs` verifies ancestry, tree
identity, committed drift, working-tree drift, and release-file types.
`tools/build.mjs` refuses to build until that verification and the
content-addressed release-source binding pass. `tools/verify-main-core.mjs`
checks the bundled bytes against Git objects from the exact source commit and
also rejects current non-generated drift.

The generated paths are never treated as new source authority. Any portable
source change invalidates the bundle and requires a fresh clean source commit,
rebind, rebuild, independent verification, and new artifact candidate. Release
activation and publication remain outside this inactive candidate.
