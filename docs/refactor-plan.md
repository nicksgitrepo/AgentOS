# Refactor plan

## Completed in this milestone slice

- New clean repository boundary.
- No package manager or third-party runtime dependency.
- Canonical line-oriented `.gate` format.
- Canonical JSON graph with deterministic SHA-256 digest.
- Semantic graph checks, including explicit answer paths and cycle rejection.
- Deterministic execution state with typed evidence.
- First Functionality lane.
- All twelve lane graphs with explicit four-way answer paths.
- Minimal role-packet composition.
- Goal reassessment closes changed goals as `SUCCEEDED_BY_REASSESSMENT` and
  creates a replacement goal.
- Fifteen-minute progress windows classify failure-list-only output and
  expired windows as stalled.
- Native session host contract with exact cleanup ordering.
- Discovery-based direct test runner and source-hygiene check with no npm
  entry point.
- Bootstrap plan compiler that covers all twelve lanes, starts in Rapid
  Prototyping Mode, and declares the Iteration Mode handoff.
- Campaign admission binds the active goal, phase, named lane, source, and
  fifteen-minute window before a worker can start.
- The first Functionality campaign path now runs through native session
  progress, gate readback, typed handoff, closure, and independent acceptance
  in a bounded host integration test.
- Persistent Intent Regulator audit decisions and the configurable fifteen-
  minute loop are now explicit and abortable.
- Owner questions are rendered as short plain choices with numeric and
  optional yes/no answers while internal fields remain hidden.

## Next slices

1. Add general governance blocks and compile role packets from selected blocks.
1. Migrate Bootstrap and campaign routing through the new engine.
2. Extract old transaction boundaries one at a time after parity tests pass.

Each slice must have a focused verifier, a hostile verifier, a deterministic
replay fixture, and an independent audit handoff before the next slice starts.
