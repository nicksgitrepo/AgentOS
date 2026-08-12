# Project Memory operational candidate

Status: `OPERATIONAL_CANDIDATE_NOT_ACTIVATED`

## Outcome

The prepared Project Memory contract now has an opt-in operational path:

`Bootstrap project contract -> external semantic artifacts -> canonical ledger
-> ledger-first current snapshot -> role capsule -> transient task context`.

No project file, activation state, provider, deployment, migration, or release
authority changes through this candidate.

## Changed surfaces

- `control/project-memory-artifacts.mjs` owns privacy-screened,
  project-isolated, content-addressed semantic artifacts.
- `control/project-memory-runtime.mjs` owns Bootstrap capture, ledger-first
  reload, role hydration, task-context conversion, and authoritative
  exact-binding capsule import.
- `control/project-memory-store.mjs` now atomically replaces complete ledgers
  and preserves recoverable crash-lock evidence.
- `control/bootstrap-runtime.mjs` exposes opt-in Memory initialization,
  rehydrated state, and refresh.
- `control/agentos.mjs` exposes the stable public APIs.
- Four machine-readable schemas describe the new artifact, runtime,
  task-context, and import-receipt boundaries.

## Verified behavior

The focused operational verifier proves:

- a validated Bootstrap contract creates usable semantic Memory;
- all canonical bytes remain outside a clean project directory;
- a restart returns the identical current snapshot and hydrated context;
- a later ledger event invalidates snapshot freshness and forces rebuild;
- Memory becomes typed `MEMORY_AUTHORITY` task context without persisting raw
  task payloads in the task-context selection record;
- exact capsule replay into another authority is prefix-checked, CAS-bound,
  idempotent, and read back by final ledger head;
- a capsule without its separately admitted semantic artifacts remains
  explicitly `PARTIAL` rather than claiming hydrated readiness;
- a valid snapshot with the wrong binding is discarded and rebuilt from the
  canonical ledger;
- divergent destination history and a live lock owner fail closed;
- transferred semantic artifacts hydrate to the same scoped context;
- malformed crash locks fail closed;
- a lock whose recorded process is provably absent is preserved and recovered;
  and
- unsafe semantic payloads are rejected.

## Honest evidence ceiling

All affected Memory, Bootstrap, routing, private-control, architecture,
portability, source-hygiene, README, and Rapid Prototype verifiers pass. A
follow-up kernel audit repaired the Rapid Prototype fixture and integration
drift that had previously stopped the repository-wide canonical verifier.
The complete canonical verifier now passes without weakening its fail-closed
source, host-authority, scheduler-proof, or evidence-identity contracts.

The candidate does not claim encryption, provider synchronization,
changed-binding migration, rollback, compaction, remote multi-host locking,
portable private-payload transport, deployment, live use, or independent
acceptance. Portable capsules remain reference-only. A new contract/source
binding must use an explicitly selected ledger namespace and reconciliation
policy; it cannot silently append to an older binding.

## Next disposition

Run the complete affected and repository-wide suites, classify any unchanged
baseline failure, obtain independent source/hostile-test clearance, then make a
separate activation decision. Until then the exact status remains
`OPERATIONAL_CANDIDATE_NOT_ACTIVATED`.

Owner intent changed: `no`.
