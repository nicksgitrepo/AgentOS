# Refactor plan

## Completed in this milestone slice

- New clean repository boundary.
- No package manager or third-party runtime dependency.
- Canonical line-oriented `.gate` format.
- Canonical JSON graph with deterministic SHA-256 digest.
- Semantic graph checks, including explicit answer paths, unreachable-gate
  rejection, and explicitly bounded repair edges.
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
- The campaign coordinator now compiles all four phases, twelve named lane
  assignments, persistent authority references, and one fresh Auditor slot per
  phase; its ordered runner requires complete phase acceptance before moving
  forward.
- A bounded fake-host campaign now exercises all twelve lane graphs through
  native spawn, attested evidence, meaningful progress, typed handoff,
  closure, and independent phase acceptance.
- Persistent Intent Regulator audit decisions and the configurable fifteen-
  minute loop are now explicit and abortable.
- Owner questions are rendered as short plain choices with numeric and
  optional yes/no answers while internal fields remain hidden.
- The remaining legacy boundaries are tracked in
  [`migration-map.md`](migration-map.md), with no old control module copied
  into the clean milestone.
- Bounded repair edges are represented in the graph model and counted by the
  host engine; they cannot become an unbounded retry loop.
- A machine-readable seam registry now records migrated, partial, and
  external-host responsibilities and rejects oversized control modules or
  paths that escape the clean repository.

## Next slices

1. Migrate Bootstrap and campaign routing through the new engine with a real
   host adapter supplied by the surrounding runtime.
2. Extract old transaction boundaries one at a time after parity tests pass.

Each slice must have a focused verifier, a hostile verifier, a deterministic
replay fixture, and an independent audit handoff before the next slice starts.
