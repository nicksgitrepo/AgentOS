# Read-only composed-import plan readback

Status: `NOT_AUTHORIZED`
Plan: `5b0bf2c79c0166fe6da4547f86f65582b815c9a8057317d8833c5266b37f4f9d`
Candidate: `36d94a346029d683b735b7d3a3dfe678e797e597`

The new generic composed-import controller compiled the actual supplied source
composition without writing any file. The plan is `NORMALIZE_AND_AUDIT`, binds
three distinct opaque source roots to one composed Product, binds a separate
destination, records the operational repository as an excluded preserved
root, and keeps execution `NOT_AUTHORIZED`, mutation `NONE`, activation `OFF`.

## Source identities observed

| repository | commit | tree | branch | status entries | tracked modified | untracked files | worktrees |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| clients | `8391d30d1518113c2b074a128a6262e92649a278` | `7631dc717a4575435f5643128692c63af2e7a9b1` | `codex/cloud-baseline-2026-07-18` | 272 | 100 | 505 | 59 |
| platform | `81c2deb4244fc371af97d4da95a5f8e042224c18` | `4639b2fcf3625a90ec015777478c29048c58f255` | `codex/release-v0.2.7-artifact-read` | 1035 | 1034 | 1 | 57 |
| data | `384ad69501a6a0353d4242c13707334e3bea92f6` | `213a300de352026cc4834cf5c1f5d807ea7f59ee` | `codex/cloud-baseline-2026-07-18` | 1 | 0 | 1 | 27 |

Untracked files are counted from the exact source inventory; Git status may
collapse untracked directories into fewer porcelain entries. No submodules were
observed. Historical worktrees are evidence-only and explicitly excluded from
source traversal.

Destination `/Users/nicholaspacheco/Projects/Sociuna` has zero entries. The
sibling control-plane path is absent. Wiki remains a separate context train.
`sociuna-orchestration` is excluded and preserved as operational evidence. Canon
authority remains pinned at `6e2b0aa00d7ea3107dc1119d9b59f69e7a6796b9`.

## Evidence ceiling

This is identity, composition, containment, and zero-trace evidence only. No
archive, manifest, source-preservation receipt, normalization, import, spawn,
activation, deployment, publication, or protected action occurred. The next
breakpoint is owner-bound preservation policy for the dirty/untracked state,
followed by independent per-root archive/manifest verification. Permanent
Agent Spawner admission remains closed until that breakpoint and its synthetic
context/contradiction round trip pass.
