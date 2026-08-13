# Schemas

Machine-readable contracts and versioned validation schemas.

`permanent-role-authority.v1.json` types the AgentOS 3.0 content-addressed
five-role graph, inactive independently appointed roster, legacy-reference
migration receipt, action request, and fail-closed admission receipt. Runtime
effects remain disabled by contract.

Release contracts are additive typed records: `release-lifecycle.v1.json`
covers candidate and promotion identities, while `release-migration.v1.json`,
`release-compatibility.v1.json`, `release-policy-replay.v1.json`,
`release-model-check.v1.json`, and `release-safety-gate.v1.json` cover
migration provenance, compatibility evidence, governance replay, finite-state
checks, and the required pre-activation safety join.

Roadmap 10 adds typed contracts for bounded project maps and derived indexes:
`project-map.v1.json`, `project-map-instance.v1.json`,
`derived-index.v1.json`, `derived-index-instance.v1.json`, and
`derived-index-query-instance.v1.json`. These contracts describe
evidence-bound projections only; they do not authorize repository, host,
session, transcript, credential, or provider introspection.

### Four-library governance contracts

- `base-general-library.v1.json` and `base-role-library.v1.json` define release-owned portable governance.
- `project-general-library.v1.json` defines additive project governance.
- `generated-project-role-library.v1.json` defines disposable generated packets.
- `governance-binding.v1.json`, `governance-migration.v1.json`, and `governance-conflict.v1.json` define binding, upgrade, and fail-closed review.
- `project-governance-history-entry.v1.json` defines append-only project lineage.

Executable authority lives in `control/four-library-governance.mjs` and its foundation, operations, and history modules. These contracts remain portable, project-agnostic, and `PREPARED_NOT_ACTIVATED` until an explicit activation decision is recorded.
