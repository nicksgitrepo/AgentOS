# Import Orchestrator

The Import Orchestrator is the campaign-scoped execution owner for an
imported project. It consumes the Controller-generated plan and the typed
Spawner roster projection, then routes the complete pyramid:

1. request and verify Spawner QA;
2. start only complete, independently evaluated specialist waves;
3. retain one named custody/worktree owner per lane;
4. accept source-bound worker handoffs and repair candidates;
5. route Platform review, test, and typed handoff;
6. route Central integration from accepted Platform handoffs only;
7. require independent re-audit before advancing the candidate or wave.

The persistent Controller does not perform this project work. It observes the
Orchestrator, detects unexplained idle or failed continuation, and performs a
bounded generic workflow repair. A heartbeat or timer is never progress. An
active worker is progress; a protected dependency is the only valid wait.

The executable contract is `control/import-orchestrator.mjs` and the
machine-readable contract is `schemas/import-orchestrator.v1.json`. Every
compiled record binds the campaign plan, Spawner roster, run state, and
Spawner lifecycle by digest. A no-op recheck cannot advance the Orchestrator.

The Orchestrator record is durable. `writeImportOrchestratorRecordCompareAndSwap`
persists a canonical JSON record beneath an explicit control-plane authority
root using an exclusive lock, an atomic replacement, directory fsync, and a
digest compare-and-swap parent. `readImportOrchestratorRecord` validates the
readback, and `advanceImportOrchestratorRecord` performs the read/derive/write
transition against the expected parent digest. Paths must remain relative to
the authority root and may not traverse or follow symlinks. This lets a
Controller repair or resume the campaign in the same turn after a worker
handoff or process restart; it must not treat a timer-only observation as a
transition.

The Orchestrator can route campaign work, but it cannot mutate Product source,
access credentials or external providers, synchronize externally, or publish
or release a candidate. Those actions remain separate protected boundaries.
