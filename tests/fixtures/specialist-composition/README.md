# Specialist composition fixture

This fixture is generic and synthetic. It exercises the on-demand bootstrap
compiler with three task-shaped recipes that share immutable governance and
versioned standard blocks while receiving different lane/context overlays.

The fixture intentionally keeps project governance, candidate/worktree custody,
current context, corpus authority, and freshness overlays external to the
portable library. Generated instances belong in a temporary companion
workspace, never in the AgentOS repository.

Required assertions are implemented in `tests/verify-specialist-agent-compiler.mjs`:

- three distinct bootstrap packages share standard block hashes;
- lane/context overlays change package hashes;
- selection is minimal and dependency-complete;
- missing context/authority, stale evidence, conflicting editions, missing
  standards/provenance, broad-router substitution, unsafe authority, and silent
  mutation fail closed;
- bootstrap.md reflects machine locks and identical recompiles are byte stable;
- deleting the external companion output leaves the AgentOS Git tree/status
  unchanged.
