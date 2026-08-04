# Bootstrap discovery and exact-plan authority

Status: `PREPARED_NOT_ACTIVATED`

The canonical setup machine authority is [control/bootstrap-compiler.mjs](../../control/bootstrap-compiler.mjs) with [control/bootstrap-coverage.mjs](../../control/bootstrap-coverage.mjs), [control/bootstrap-discovery.mjs](../../control/bootstrap-discovery.mjs), [schemas/bootstrap-plan.v1.json](../../schemas/bootstrap-plan.v1.json), [schemas/bootstrap-coverage.v1.json](../../schemas/bootstrap-coverage.v1.json), and [schemas/bootstrap-discovery.v1.json](../../schemas/bootstrap-discovery.v1.json). Older guided and dynamic paths are migration-only aliases.

## Discovery

Bootstrap Discovery is secret-free, read-only, deterministic, and contained by the admitted project root. It observes repository topology, credential-free remote shape, authority/design candidates, project markers, deployment markers, and available local tools. It rejects inherited parent repositories, unsafe paths, symlinks, credential-bearing remotes, query/fragment secret material, and any operation that authenticates, spends, publishes, deploys, deletes, or mutates.

Facts are typed `OBSERVED_FACT`, `CANDIDATE_INTERPRETATION`, `CONFLICT`, or `UNKNOWN`. A fact can recommend an answer but cannot supply owner intent or select an import/refactor/create decision without an owner-bound plan. Delivery facts include source-control state, CI/hosting/deployment markers, and local tool availability; they never authorize a push, merge, provider login, spend, deployment, or rollback.

## Coverage-driven question compiler

The compact question catalog classifies each owner-facing question as exactly one of `DISCOVERY_PERMISSION`, `OWNER_INTENT`, `OWNER_BOUNDARY`, `MATERIAL_PREFERENCE`, or `CREATION_AUTHORIZATION`. The Bootstrap Coverage matrix is the authority for output completeness and question selection. It records every creation, trust, data, delivery, recovery, proof, and activation obligation, including obligations resolved by discovery, a portable default, derivation, or an explicit unavailable state. Mechanical facts are discovered, not asked. Bootstrap asks only when the matrix has a material `OWNER_REQUIRED`, `DEPENDENCY_PENDING`, or `CONFLICT` row that cannot be settled by existing owner input. Multiple rows may point to one compact question; coverage never expands into a whole-project questionnaire.

## Complete creation plan

Bootstrap compiles one content-addressed plan containing:

- project definition and north star;
- smallest first useful workflow;
- candidate Function Requirements compiled from the North Star and first useful workflow;
- technical baseline, first-class delivery policy, and Design Bible;
- typed Security standard and requirement identities;
- authority boundaries and authority corpus roots/numbering;
- model economics and completion floor;
- persistent Runtime binding;
- first campaign context;
- exact files, roots, side effects, prohibited actions, rollback, and legacy gate;
- exact `FUNCTION_REQUIREMENTS`, `DESIGN_BIBLE`, `SECURITY` slice.

The plan digest excludes only its digest field. Approval requires `APPROVE_EXACT_PLAN`, the displayed plan digest, the current discovery digest, a nonempty actor, and UTC time. Any TOCTOU change fails closed. `PROCEED` is not a valid plan approval.

## Transaction and audit

Execution is resumable and staged inside the project root. Approved plans run the bound local delivery probes before setup writes continue; their result is staged as `delivery.probe.results.json`. Imported or refactored authority must first be sealed as `legacy.zip`, with manifest, index, receipt, source observation, and exact readback. Replacement writes begin only after that gate. The plan is read back from staging before the state becomes `SEALED`.

A distinct setup Auditor verifies plan and approval identity, TOCTOU readback, project-context separation, no secrets, legacy gate, corpus output, Runtime binding, and the three-root slice. Setup output is not Product work and does not activate a campaign.

## Project-specific extensions

Project Context may add repositories, providers, model candidates, authentication routes, deployment bindings, design details, retention preferences, and feature intent. It may add stricter constraints but cannot weaken the portable kernel. The project-context digest remains separate from the governance digest.
