# Source-hygiene repair audit — 2026-08-10

## Scope

This record covers the public and release-bound AgentOS candidate only. It is
not an instruction to modify unrelated dirty peer worktrees.

## Finding and repair

A release-bound governance scanner carried a consumer-specific literal inside
its public-content rejection rule. That is incompatible with a standalone,
project-agnostic release because the release must not encode any particular
consumer identity.

The repair removes the consumer-specific rule and adds the generic
`control/private-context-detector.mjs` boundary. Generic paths, environment
references, secret-like assignments, private links, and raw host/session IDs
are rejected. Project identity terms can be supplied by a typed runtime scan,
but they are transient and are never returned or persisted. The role-governance
validator now uses the same detector, and the portability, README, and
aggregate verifiers use only generic synthetic identity fixtures.

## Evidence boundary

- source repair: `control/governance-library.mjs`
- detector: `control/private-context-detector.mjs`
- contract: `schemas/private-context-detector.v1.json`
- focused verifier: `tests/verify-private-context-detector.mjs`
- documentation: `docs/private-context-detector.md`
- functional execution: `NOT_RUN_BY_INSTRUCTION`
- activation: `PREPARED_NOT_ACTIVATED`

The detector reports only categories and digests of matched text. It does not
make public records safe by itself; callers must apply it before persisting
documentation, handoffs, evidence, release records, or generated governance.
