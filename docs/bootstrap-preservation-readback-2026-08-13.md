# Read-only preservation-plan readback

Status: `VERIFIED_PLAN` / execution `NOT_AUTHORIZED`

At the current debug breakpoint, the exact admitted Product source roots were
re-observed without writing to any source or destination. Status counts are
recorded with their command semantics so collapsed untracked directories are
not confused with the full untracked inventory:

| repository role | commit | tree | porcelain-v1 entries | tracked modified | untracked (all) | worktrees | submodules |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| clients | `8391d30d1518113c2b074a128a6262e92649a278` | `7631dc717a4575435f5643128692c63af2e7a9b1` | 272 | 100 | 505 | 59 | 0 |
| platform | `81c2deb4244fc371af97d4da95a5f8e042224c18` | `4639b2fcf3625a90ec015777478c29048c58f255` | 1035 | 1034 | 1 | 57 | 0 |
| data | `384ad69501a6a0353d4242c13707334e3bea92f6` | `213a300de352026cc4834cf5c1f5d807ea7f59ee` | 1 | 0 | 1 | 27 | 0 |

The destination `/Users/nicholaspacheco/Projects/Sociuna` remains empty and
the sibling control-plane path remains absent. The excluded orchestration
repository and separate Wiki context train were not traversed or mutated.

The preservation plan and composed-import plan both pass their focused hostile
verifiers. This readback does not create an archive, manifest, or receipt and
does not decide the owner-bound disposition of dirty and untracked material.
The evidence ceiling and next protected decision are unchanged: obtain that
disposition before any archive creation or permanent-role admission.
