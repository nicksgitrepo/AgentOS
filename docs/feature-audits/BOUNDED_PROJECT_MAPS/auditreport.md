# BOUNDED_PROJECT_MAPS audit report

Status: `REPAIR_IN_PROGRESS`

This is an append-only audit, repair, self-audit, and re-audit record for the
`BOUNDED_PROJECT_MAPS` named capability. Functional tests are intentionally
pending; no npm workflow is used.

## Audit cycle 1 — initial audit of the authoritative accepted merge

### Scope and custody

- Feature inventory entry: `BOUNDED_PROJECT_MAPS`, named capability,
  `NOT_STARTED`.
- Inventory sources: `schemas/project-map.v1.json`,
  `schemas/derived-index.v1.json`, `control/project-map.mjs`, and
  `control/derived-index.mjs`.
- Authoritative source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`.
- Authoritative committed tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- The authoritative accepted merge is a dirty assembly worktree with the
  target slice and other accepted work in tracked and untracked form. It was
  read only. The isolated writable worktree started clean at the same commit
  and did not contain the target slice.
- No private machine paths, credentials, provider tokens, or chat links are
  recorded here.

### Intent audit

The roadmap still marks capability 10, “Bounded maps and repository
intelligence,” as `Planned`. Its promise is evidence-bound views of
dependencies, authority, workflow, feature coverage, and recovery state that
never become a second source of truth (`docs/roadmap.md:276-281`). Its done
criteria require source traceability, visible bounds/omissions/freshness/
uncertainty/source identity, explicit stale or conflict states, no authority
or acceptance effect, and independent comparison with underlying records
(`docs/roadmap.md:283-290`). Phase 5 makes derived intelligence a later phase
and requires privacy, provenance, and boundary support
(`docs/roadmap.md:410-423`). Visual maps and repository intelligence are
explicitly deferred from the current local workflow
(`docs/roadmap.md:435-445`).

The feature-specific machine contracts preserve that intent: both contracts
are `PREPARED_NOT_ACTIVATED`, control-space, advisory-only, and
non-authoritative. Project maps require typed source bindings, bounded nodes
and edges, source digests on nodes and edges, explicit omissions/uncertainty/
conflict state, and fail-closed unavailable behavior. The derived index keeps
raw source text transient, persists only digests/metadata/hashed postings,
filters retrieval by role, and exposes source/policy staleness. No activation
or protected action is authorized.

The inventory’s global source catalog mentions
`research-records-linked-by-owner`, but the `BOUNDED_PROJECT_MAPS` entry does
not name a feature-specific research record and no such record is present in
the accepted merge tree. Research intent is therefore recorded as unknown,
not inferred or fabricated.

### Actual implementation evidence

The authoritative slice contains:

- `control/project-map.mjs`: typed-input-only deterministic graph compilation;
  UTF-8 ordering; selected-root prioritization; node/edge bounds; explicit
  `READY`, `BOUNDED_PARTIAL`, `STALE`, `CONFLICT`, and `UNAVAILABLE` states;
  source commit/tree/snapshot/policy binding; role scope; digest binding;
  advisory-only and non-acceptance invariants.
- `control/derived-index.mjs`: transient normalized text; privacy-safe content
  digests; hashed lexical postings; deterministic document/posting ordering;
  role-filtered ranked queries; explicit `STALE` query behavior; bounded
  document/token inputs; advisory-only and non-acceptance invariants.
- `control/map-memory-common.mjs` and the shared privacy/content-addressing
  seam: canonical digests, safe-record scans, portable identifiers, sorted
  collections, and bounded notices.
- Contract and instance schemas for both projections and query results.
- Focused verifier files covering deterministic rebuilds, bounds, stale/conflict/
  unavailable map states, role filtering, hashed retrieval, privacy rejection,
  tamper rejection, and advisory boundaries.
- Accepted project-memory projection code binds map/index digests into a
  rebuildable snapshot and propagates stale/partial/conflict conditions. That
  integration is evidence in the authority worktree, not an independent
  acceptance claim for this feature.

Static syntax checks and JSON parsing passed on the authoritative target files.
Focused functional tests were not run by instruction.

### Findings and builder actions

| ID | Severity | Finding | Why it matters | Action |
| --- | --- | --- | --- | --- |
| `BOUNDED_PROJECT_MAPS-001` | Material | The runtime identifier validator rejects UUID-shaped session/task identities, but the map, index, and query instance schemas accept them through their generic `id` pattern. | A schema-only consumer could accept an identity that the portable runtime rejects, weakening the no-session/task-identity boundary and parity evidence. | Add the same UUID exclusion to all three instance-schema `id` definitions and add a hostile schema-parity assertion. |
| `BOUNDED_PROJECT_MAPS-002` | Material | The derived-index runtime requires at least one document, while its instance schema permits an empty `documents` array. | Schema validation could advertise a record that the authoritative runtime cannot validate, making empty indexes look usable instead of unavailable. | Add `minItems: 1` to the derived-index instance schema and assert the contract in the focused verifier. |
| `BOUNDED_PROJECT_MAPS-003` | Boundary residual | The implementation is a typed projection compiler and lookup seam; it does not discover repository dependencies, render a visual map, or independently compare a map against live canonical records. | Those are part of the full roadmap promise, so this slice cannot be called full Roadmap 10 production acceptance. | Preserve the typed-input-only boundary, label the candidate as the bounded compiler/index slice, and leave repository discovery/visual rendering/independent comparison for the roadmap capability audit. |
| `BOUNDED_PROJECT_MAPS-004` | Evidence residual | No feature-specific research record is available in the authoritative source catalog. | Research-backed intent cannot be verified beyond the roadmap and contracts. | Record the unknown and do not invent research conclusions; no external blocker is claimed. |
| `BOUNDED_PROJECT_MAPS-005` | Custody | The isolated worktree has no target implementation because the accepted merge’s feature files are untracked assembly inputs. | The builder must materialize only the in-scope feature slice and its narrowly required privacy/digest support without copying unrelated accepted work. | Add the target controls, schemas, focused verifiers, and required shared support in the isolated worktree; verify changed paths. |

### Cross-cutting audit lenses

- Quality: deterministic normalization, exact keys, digest recomputation, and
  hostile checks are present. Findings 001–002 are schema/runtime parity gaps.
- Hygiene: no npm dependency or product-specific payload is required; the
  accepted merge is broad and dirty, so only target/support paths may be
  materialized here.
- Minimality: the typed compiler boundary is appropriately small. Do not add
  a repository crawler or visual renderer under this named-capability repair.
- Security and privacy: raw index text and query text are not persisted;
  labels/notices are scanned; maps/indexes cannot authorize acceptance. The
  schema UUID gap is the recorded security repair.
- Durability: maps and indexes are content-addressed and source/policy-bound;
  accepted memory projections retain their digests and stale dependencies.
  Durable external storage and capsule portability remain outside this slice.
- Regression: focused verifiers cover the direct contracts, but they have not
  run. No existing product path is changed by the planned materialization.
- Custody: the accepted merge is read-only authority; this worktree is the
  only write scope. No merge, push, activation, deployment, or external action
  is allowed.
- Boundary: `PREPARED_NOT_ACTIVATED`, `CONTROL_SPACE`, advisory-only, and
  `acceptance_authority: false` are required at runtime and in schemas.
- Intent: the implementation honors the derived-view/non-authority intent and
  is a production candidate only for the bounded compiler/index slice pending
  functional and independent checks, not for the entire roadmap promise.

### Initial production-readiness decision

The accepted implementation is a strong prepared candidate for the typed,
bounded, privacy-safe projection slice, but not yet ready for independent
clearance because two schema parity findings are open, the target is not yet
materialized in the isolated worktree, functional tests remain pending, and
the full repository-intelligence promise remains a documented boundary
residual. There is no genuine external blocker. Next action: perform the
recorded schema repairs while materializing only the in-scope slice, then
self-audit and re-audit it.

## Builder self-audit — repair pass 1

### Repair record

The builder materialized only the following feature/support paths from the
authoritative accepted merge: the project-map and derived-index controllers,
their shared canonical/privacy helpers, the two contract schemas and three
instance schemas, and three focused verifiers. No controller, campaign,
product, package-manager, provider, or release files were copied.

Recorded repairs:

1. Added a UUID-shaped identity exclusion to the `id` definition in
   `schemas/project-map-instance.v1.json`,
   `schemas/derived-index-instance.v1.json`, and
   `schemas/derived-index-query-instance.v1.json`, matching the runtime
   `requireIdentifier` rule.
2. Added `minItems: 1` to the derived-index instance `documents` array,
   matching the runtime nonempty-index rule.
3. Added hostile schema-parity assertions to
   `tests/verify-map-memory-contracts.mjs` for UUID-shaped identities and the
   nonempty document contract.

### Self-audit evidence

- `node --check` passed for all materialized controllers, support helpers, and
  focused verifiers.
- `jq empty` passed for all five materialized JSON contracts/instances.
- The copied controllers, support helpers, and unmodified focused verifiers
  compare equal to the authoritative accepted versions.
- The isolated worktree status contains only the target report, target
  controls, target/support schemas, and target verifiers listed above.
- Functional tests remain `NOT_RUN` by explicit instruction. No npm command,
  external action, activation, merge, push, or deployment occurred.

### Self-audit result

The two material findings have recorded repairs and no unrecorded implementation
changes were found. The roadmap residual (no repository discovery/visual
renderer/independent live-record comparison) and research evidence unknown
remain intentionally open and correctly bounded to the full roadmap capability;
they are not blockers for this typed compiler/index candidate. Proceed to a
fresh auditor re-audit of the repaired schemas, privacy/boundary surface,
changed-path custody, and remaining findings.

## Auditor re-audit — repair pass 1

### Re-audit evidence

- The three instance schemas now carry the UUID-shaped identity exclusion in
  their shared `id` definitions (`schemas/project-map-instance.v1.json:99-105`,
  `schemas/derived-index-instance.v1.json:60-66`, and
  `schemas/derived-index-query-instance.v1.json:50-56`). This matches
  `control/map-memory-common.mjs:47-51`.
- The derived-index instance now requires at least one document
  (`schemas/derived-index-instance.v1.json:48-52`), matching
  `control/derived-index.mjs:101-107`.
- The focused contract verifier asserts both repairs and exercises all three
  `id` definitions (`tests/verify-map-memory-contracts.mjs:121-136`).
- Static syntax checks, JSON parsing, whitespace scanning, authority-file
  comparison, schema-property queries, and the changed-path review all pass.
- The final changed-path set is limited to the feature report, five control
  support/compiler files, five contract/instance schemas, and three focused
  verifiers. No unrelated project file, package manifest, provider binding,
  private path, credential, token, or chat link was added.
- Functional tests and independent acceptance remain `NOT_RUN`, as required.

### Re-audit findings

`BOUNDED_PROJECT_MAPS-001` and `BOUNDED_PROJECT_MAPS-002` are `RESOLVED` in
the isolated candidate. No new material finding was found in the repaired
surface. `BOUNDED_PROJECT_MAPS-003` (full roadmap intelligence remains
unimplemented) and `BOUNDED_PROJECT_MAPS-004` (feature-specific research
evidence unavailable) remain open as explicitly bounded residuals, not true
blockers. `BOUNDED_PROJECT_MAPS-005` is resolved by isolated materialization.

### Final readiness and next action

This worktree is a production candidate for the bounded, typed,
privacy-safe, advisory project-map/derived-index compiler slice pending the
explicitly deferred functional tests and an independent checker. It is not a
full acceptance of Roadmap 10, and `2.1rc` remains prepared but inactive.

There is no external blocker: the remaining work is a normal later audit and
test action. Next action is to hand this exact isolated candidate to the
functional-test and independent-clearance step; any future repository
discovery, visual rendering, or feature-specific research must be admitted as
a separately scoped roadmap capability rather than silently added here.

Final cycle status: `FINISHED_PENDING_FUNCTIONAL_TESTS_AND_INDEPENDENT_CLEARANCE`.
