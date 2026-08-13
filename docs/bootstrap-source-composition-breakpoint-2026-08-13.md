# Bootstrap source-composition breakpoint

Status: `READ_ONLY_COMPOSITION_CANDIDATE`
Governance: `2.1rc` (`PREPARED_NOT_ACTIVATED`)
Candidate branch: `codex/bootstrap-multirepo-discovery-fix`

## Implemented versus specified

Implemented in this candidate:

- read-only nested-repository discovery and explicit composed-import modeling;
- `agentos.composed_project_import.v1`, which binds multiple source roots,
  separate destination, included/excluded repositories, dirty/untracked state,
  worktree evidence, source preservation, rollback, and fail-closed execution;
- typed external context-block intake with provenance, freshness, applicability,
  privacy, hostile fixtures, independent evaluation, and external-only intake;
- fail-closed Agent Spawner preparation with transitive block closure,
  composition QA, contradiction routing, role-context manifest, model-duty
  restrictions, and post-spawn readback checks.

Specified but not activated: source archiving/preservation, normalization,
permanent-role compilation/spawn, Wiki/context transformation, Product import,
consumer writes, deployment, publication, and release. The composed plan is a
read-only candidate and its execution helper rejects mutation until each source
has independently verified preservation custody.

## Exact source composition

The supplied Product source is one composed import of these three repositories:

- `/Users/Shared/Workspaces/sociuna-local/workspace/sociuna-clients` — branch
  `codex/cloud-baseline-2026-07-18`, commit
  `8391d30d1518113c2b074a128a6262e92649a278`, tree
  `7631dc717a4575435f5643128692c63af2e7a9b1`, 272 tracked-status entries,
  505 untracked entries, 59 worktrees, no submodules;
- `/Users/Shared/Workspaces/sociuna-local/workspace/sociuna-platform` — branch
  `codex/release-v0.2.7-artifact-read`, commit
  `81c2deb4244fc371af97d4da95a5f8e042224c18`, tree
  `4639b2fcf3625a90ec015777478c29048c58f255`, 1035 tracked-status entries,
  1 untracked entry, 57 worktrees, no submodules;
- `/Users/Shared/Workspaces/sociuna-local/workspace/sociuna-data` — branch
  `codex/cloud-baseline-2026-07-18`, commit
  `384ad69501a6a0353d4242c13707334e3bea92f6`, tree
  `213a300de352026cc4834cf5c1f5d807ea7f59ee`, 1 tracked-status entry,
  1 untracked entry, 27 worktrees, no submodules.

The clean destination is `/Users/nicholaspacheco/Projects/Sociuna` and has zero
top-level entries. No sibling control plane was created there. The Wiki is a
separate context source train, not Product import scope; raw dirty Wiki bytes
remain unconsumed. `/Users/Shared/Workspaces/sociuna-local/workspace/sociuna-orchestration`
is operational/control evidence and is explicitly excluded/preserved. Canon
authority is pinned read-only at commit
`6e2b0aa00d7ea3107dc1119d9b59f69e7a6796b9` (tree
`2313e2955fd5e78ea7109cd5f1388a6b6a41e92b`).

## Evidence ceiling and next breakpoint

Mechanical identity and boundary facts are read-only evidence. The dirty and
untracked state is not yet owner-dispositioned, and no source-preservation
archive or manifest exists. The next canonical breakpoint is to bind the exact
per-root preservation policy and verify the external archive/manifest plan,
then re-prove destination separation and zero trace. Only after that may the
permanent Agent Spawner/Compiler role breakpoint be considered. No source
mutation, import, spawn, activation, deployment, publication, or protected
action occurred in this slice.
