# Refactor plan

## Completed in this milestone slice

- New clean repository boundary.
- No package manager or third-party runtime dependency.
- Canonical line-oriented `.gate` format.
- Canonical JSON graph with deterministic SHA-256 digest.
- Semantic graph checks, including explicit answer paths and cycle rejection.
- Deterministic execution state with typed evidence.
- First Functionality lane.
- Minimal role-packet composition.

## Next slices

1. Add the remaining eleven lane graphs without changing the engine.
2. Add general governance blocks and compile role packets from selected blocks.
3. Add the 15-minute progress state machine and JSA goal reassessment.
4. Add native host/session binding and exact temporary-agent closure.
5. Migrate Bootstrap and campaign routing through the new engine.
6. Extract old transaction boundaries one at a time after parity tests pass.

Each slice must have a focused verifier, a hostile verifier, a deterministic
replay fixture, and an independent audit handoff before the next slice starts.

