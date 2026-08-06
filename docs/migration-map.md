# Legacy seam migration map

The refactor migrates behavior by authority seam, not by copying large files.
The old implementation remains the reference outside this milestone.

| Previous boundary | New boundary | Status |
|---|---|---|
| Governance decision tree and task questions | `.gate` parser, graph validator, and gate engine | First slice migrated |
| Bootstrap compiler and owner conversation | Bootstrap plan, campaign admission route, owner question surface, automatic continuation, and Bootstrap runtime | Core behavior migrated; provider host remains external |
| Role governance library | General manifest, role selection, role-library compiler | Migrated for twelve lanes |
| Native session team and runner | Native host contract, typed host attachment, release-only visible worker boundary, and lifecycle cleanup | Contract and boundary gate migrated; real provider adapter remains external |
| Campaign lifecycle and cascade | Campaign admission, campaign coordinator, runner, goal/progress state, and live closure proofs | Four-phase coordinator and all twelve portable lane executions migrated; real host execution remains external |
| Controller and supervisor | Intent Regulator audit loop and campaign routing | Audit decisions and bounded phase routing migrated; long-running host loop remains an external host seam |
| Owner review and acceptance bridge | Owner question surface and independent acceptance contract | First slice migrated |
| Local worker runtime | Named lane worker admission and native session binding | Portable runner exercised across all twelve lanes; provider-backed host attachment remains external |
| Runtime authority and release boundary | Persistent Runtime record and protected-action request | Project/environment-bound request contract migrated; host action execution remains intentionally external |
| Delivery and campaign closure | Delivery choice, repository checkpoint, deployment receipt, live audit, and Runtime request | Choice and proof contracts migrated; provider action execution remains external |
| Persistent controller identity | Persistent Intent Regulator/Runtime records and fifteen-minute audit loop | Record and decision contract migrated; host session attachment remains external |
| Repository and control-plane boundary | Sibling workspace boundary and control-repository worktree policy | Boundary contract migrated; host creation of the sibling repository remains external |

## Extraction rule

Each remaining seam must be migrated with:

1. one named authority;
2. one canonical input and output contract;
3. one parity fixture against the reference behavior;
4. one hostile boundary test;
5. one independent Auditor handoff;
6. removal of the old path from the migrated route.

No old module is copied into this public milestone merely to make a test
green. If a behavior cannot yet be migrated, it remains explicitly pending.

The nine historical transaction boundaries are now individually represented
in the registry as `LEGACY_*` seams. Each points to focused replacement
modules and the extraction verifier; none remains as a monolithic control
module in this repository.

The machine-readable companion is `control/migration-registry.mjs`. It checks
that every replacement and evidence path stays inside this repository and
that no control module exceeds the milestone's seam-size limit. `PARTIAL` and
`EXTERNAL_HOST_REQUIRED` are deliberate non-complete states; they are not
silently treated as migrated.
