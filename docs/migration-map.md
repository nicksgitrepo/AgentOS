# Legacy seam migration map

The refactor migrates behavior by authority seam, not by copying large files.
The old implementation remains the reference outside this milestone.

| Previous boundary | New boundary | Status |
|---|---|---|
| Governance decision tree and task questions | `.gate` parser, graph validator, and gate engine | First slice migrated |
| Bootstrap compiler and owner conversation | Bootstrap plan, campaign admission, owner question surface | Core behavior migrated |
| Role governance library | General manifest, role selection, role-library compiler | Migrated for twelve lanes |
| Native session team and runner | Native host contract and lifecycle cleanup | Contract migrated; real host adapter remains external |
| Campaign lifecycle and cascade | Campaign admission, runner, goal/progress state | First Functionality path migrated |
| Controller and supervisor | Intent Regulator audit loop and campaign routing | Audit decisions migrated; full long-running host loop pending |
| Owner review and acceptance bridge | Owner question surface and independent acceptance contract | First slice migrated |
| Local worker runtime | Named lane worker admission and native session binding | Contract migrated; lane-by-lane execution migration pending |

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

