# ROADMAP_08_MEMORY_CAPSULES audit report

Status: `AUDIT_PASS_1_REPAIR_ADMITTED`

Current status: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`

Feature: `ROADMAP_08_MEMORY_CAPSULES` — Structured Memory, Recovery, and Portable Project Capsules

Authority readback: the current accepted-merge worktree was inspected as the
read-only implementation authority before this worktree was edited. This
report uses repository-relative evidence only. No product data, credentials,
provider tokens, private paths, or conversation links are stored here.

## Audit scope and source readback

The feature inventory names this capability as a roadmap capability with these
normative sources:

- `docs/roadmap.md` — section 8, phase 3, deferred-scope language, and release
  status rules;
- `schemas/project-memory.v1.json` — canonical records/events and derived
  snapshot/role-capsule contracts;
- `schemas/private-control-bundle.v1.json` — private control transport shape;
- related authority intent in `governance/2.1rc/portable-kernel.md`,
  `governance/2.1rc/portable-authority-corpus-format.md`,
  `governance/2.1rc/project-import.md`,
  `governance/2.1rc/project-life-contract.md`, and the recovery/security
  foundation documents;
- accepted implementation surfaces in `control/project-memory-records.mjs`,
  `control/project-memory-projections.mjs`, `control/project-memory-store.mjs`,
  `control/project-map.mjs`, `control/derived-index.mjs`,
  `control/persisted-record-privacy.mjs`, `control/private-control-*.mjs`,
  and their focused verifiers.

The inventory also refers to `research-records-linked-by-owner`. No repository
local `research/`, `research-records/`, or feature-linked research artifact was
present in the accepted merge readback. Research evidence is therefore
`UNKNOWN`, not silently inferred from implementation prose.

## Intended behavior

The roadmap promises lossless private records, compact structured state,
selective retrieval, startup reconciliation, recovery history, and portable
project capsules that can move a project contract, governance, memory,
campaign history, evidence metadata, and registrations between local
installations. Derived snapshots, indexes, maps, and role capsules must remain
advisory and never become authority. Restart and crash recovery must reconstruct
the same authoritative state; unresolved owner decisions, active boundaries,
evidence roots, and recovery obligations must survive compaction. Export/import
must be versioned and deterministic, reject secrets and machine-bound
identifiers, encrypt where required, detect synchronization conflicts and
offline divergence, and support tested migration and rollback. `2.1rc` remains
prepared and inactive.

The accepted contracts narrow that promise safely for the current slice:

- canonical project-memory records and append-only events are the rebuildable
  authority;
- snapshots and role context capsules are content-addressed, advisory-only
  projections;
- bindings carry project/campaign/goal/role/source/policy/handoff identity;
- append uses contiguous sequence, prior-head, CAS, idempotency, privacy, and
  conflict rules;
- private control artifacts live outside the project by default and export/import
  excludes workspace-bound identity and worktrees.

## Actual implementation readback

The accepted merge contains a coherent partial memory slice:

- `control/project-memory-records.mjs` compiles and validates typed records,
  events, invalidations, conflicts, bindings, digests, notices, and replay;
- `control/project-memory-store.mjs` provides external authority-root JSONL
  append, lock, fsync, CAS snapshot write, readback, and restart reconstruction;
- `control/project-memory-projections.mjs` compiles snapshots, invalidation
  sets, and role-scoped capsules, binding them to source/policy/handoff state;
- `control/project-map.mjs` and `control/derived-index.mjs` provide bounded,
  source-bound, privacy-safe derived map/index retrieval;
- `control/persisted-record-privacy.mjs` scans and redacts prohibited values;
- `control/private-control-bundle.mjs` and private-control storage provide a
  versioned private control repository bundle, deterministic file manifest,
  staging, exact merge behavior, and a no-project-write receipt;
- focused tests cover canonical replay, supersession, conflict/invalidation
  states, privacy hostile values, private-control round trips, symlinks, and
  containment. Functional acceptance was intentionally not run.

## Findings from audit pass 1

### F-001 — Roadmap capsule scope is not implemented

Severity: `P1`

The private-control bundle moves only portable files from the private control
repository. It does not define or transport the complete project capsule
promised by roadmap section 8: typed project contract/governance, canonical
memory plus campaign history, evidence metadata, registrations, encryption
policy, synchronization divergence, capsule migration, or rollback. There is no
capsule envelope/schema/API that proves these items are included or explicitly
absent. This matters because a control-repository round trip can be mistaken for
continuity portability while silently losing project authority and recovery
history.

Evidence: `docs/roadmap.md:230-249`, `docs/roadmap.md:387-390`,
`schemas/project-memory.v1.json`, `schemas/private-control-bundle.v1.json`,
`control/private-control-bundle.mjs:176-318`.

Disposition: repair the current slice with a versioned, deterministic,
privacy-safe project-memory capsule envelope and explicit scope/omission
metadata. Keep encryption/synchronization/migration/rollback as typed
unavailable states until their authority and functional proof exist; do not
claim the full roadmap done.

### F-002 — Append can write a cross-binding event before rejecting it

Severity: `P0`

`appendProjectMemoryEvent` validates the candidate event, reads the current
ledger, checks head/sequence/prior, writes the line, and only then validates the
whole ledger. A candidate with a different binding can therefore be written to
disk before the final readback rejects the mixed ledger. The failed operation
leaves canonical authority mutated and recovery no longer deterministic.

Evidence: `control/project-memory-store.mjs:173-220`; the final validation call
does not receive a binding and occurs after the append write.

Disposition: validate the existing ledger and the complete candidate ledger,
including binding equality, before any file write; retain post-write readback.

### F-003 — Authority-root containment check is one-directional

Severity: `P1`

`resolveAuthorityRoot` rejects an authority root nested inside the repository,
but permits an authority root that contains the repository. That violates the
separate-authority-root boundary and allows a later relative-path choice to
cross through the repository tree. Both overlap directions must fail closed.

Evidence: `control/project-memory-store.mjs:27-38`.

Disposition: reject either root containing the other after canonicalization.

### F-004 — Role capsule scopes can be contradictory

Severity: `P1`

`compileRoleContextCapsule` accepts the same scope reference in both
`allowed_scope_refs` and `prohibited_scope_refs`. A downstream worker cannot
derive one safe boundary from contradictory inputs. The validator also permits
an `INVALIDATED` capsule with no uncertainty or conflict explanation.

Evidence: `control/project-memory-projections.mjs:205-235` and `270-302`.

Disposition: require disjoint scope sets and require an explicit reason for
every non-ready capsule status, including `INVALIDATED`.

### F-005 — Private bundle ordering is not byte-deterministic

Severity: `P2`

Bundle artifacts use `localeCompare` and exclusions use the host default
`.sort()`, while the contract and inventory digest otherwise require unsigned
UTF-8 ordering. Locale-sensitive ordering can produce different bundle
manifests/digests on different installations.

Evidence: `control/private-control-bundle.mjs:124-126`.

Disposition: use the shared UTF-8 comparator for every manifest and exclusion
sort.

### F-006 — Host-local persisted-record writes do not reject symlinked parents

Severity: `P1`

`writePersistedRecordAtomic` rejects a symlink target but creates the parent
tree with recursive mkdir and does not inspect existing parent components. A
hostile symlinked parent can redirect a supposedly external private write.

Evidence: `control/persisted-record-privacy.mjs:250-277`.

Disposition: reject symlink components and verify canonical containment before
creating parents or replacing the target.

## Production-readiness lenses (pass 1)

| Lens | Result | Evidence / reason |
| --- | --- | --- |
| Quality and hygiene | `PARTIAL` | Small focused modules and strict keys are good; the writable worktree does not yet contain the accepted feature slice, and no feature audit existed. |
| Minimality | `PARTIAL` | The memory slice is purposefully narrow; private-control/release additions are adjacent and must not be expanded into unrelated work. |
| Security | `REPAIR_REQUIRED` | Binding-root overlap and symlink-parent gaps can redirect or mix private authority. |
| Privacy | `PARTIAL` | Record scanners reject common paths/secrets/identities, but complete capsule export and host-parent safety are absent. |
| Durability | `REPAIR_REQUIRED` | Cross-binding append-after-write is a canonical-ledger corruption path; directory fsync and stale-lock recovery remain unproven. |
| Regression | `PENDING` | Functional tests remain pending by instruction; static comparison and source readback are the current evidence class. |
| Custody | `PARTIAL` | Private control has external custody and no-project-write receipts; complete capsule custody and import ownership are not yet modeled. |
| Boundary | `REPAIR_REQUIRED` | Capsule scope, authority-root separation, and role-scope disjointness need explicit enforcement. |
| Intent | `PARTIAL` | The partial-memory/deferred-capsule roadmap language is preserved, but the implementation must state omissions instead of implying full portability. |

## True blockers and exact recovery

No genuine external blocker is present. Missing research artifacts are an
evidence unknown that can be reported honestly. Functional verification is
intentionally pending, not a blocker: after repair, run the focused verifiers
on a clean candidate when the owner authorizes testing. Encryption keys,
provider synchronization authority, and migration/rollback authority are not
available in this portable kernel; the exact recovery is to bind those as typed
project authority and add independent tests before claiming those roadmap
items. They are scoped unavailable behavior, not permission to stop ordinary
local repairs.

## Builder actions admitted from this audit

1. Materialize only the accepted ROADMAP_08 memory/privacy/private-control
   slice and its normative schemas in this isolated worktree.
2. Add a versioned project-memory capsule envelope with deterministic manifest,
   content-addressed canonical records, explicit omitted/deferred capability
   states, and no machine-bound values; keep it advisory and inactive.
3. Repair F-002 through F-006 with pre-write validation, bidirectional root
   containment, disjoint capsule scopes, explicit invalidation reasons,
   UTF-8 ordering, and symlink-safe host writes.
4. Perform a self-audit, re-audit each repaired finding, preserve this report’s
   resolved history, and leave functional tests pending.

## Initial next action

Create the smallest portable capsule contract and materialize the accepted
feature files through the isolated worktree, then apply the six recorded
repairs before any test execution.

## Audit pass 2 — builder self-audit and re-audit

The builder materialized only the feature slice and its direct dependencies in
this isolated worktree. The added capsule envelope carries the canonical
project-memory event ledger, optional snapshot and role capsules, opaque
contract/governance/campaign/evidence/registration references, and explicit
`UNAVAILABLE` capability records for encryption, synchronization, migration,
and rollback. It contains no workspace paths, resolved host bindings, raw
project payloads, or machine-bound identifiers. Import preparation is
read-only, scope-bound, and reports whether replay can proceed or reconciliation
is required; it does not touch the project tree.

### Self-audit finding S-001 — capsule module import closure

The first static import-closure check caught incorrect utility export imports
in the new capsule module. The module attempted to import common constants and
validators from the public memory barrel even though those symbols are owned by
the shared map-memory helper. The builder corrected the imports before any
functional execution. `node --check` and the module import closure now pass.

### Self-audit finding S-002 — binding comparison must be field-based

The first capsule import-preparation implementation compared binding objects by
`JSON.stringify`, which could report reconciliation for semantically identical
objects with a different key insertion order. The builder changed this to an
explicit comparison across the typed binding fields and re-ran static syntax and
import checks.

### Re-audit disposition

- `F-002` resolved: append now validates the existing ledger and the complete
  candidate ledger, including binding equality, before writing; readback keeps
  the binding constraint.
- `F-003` resolved: authority roots are rejected when either root contains the
  other after canonicalization.
- `F-004` resolved: role capsule allowed/prohibited scopes must be disjoint,
  and `INVALIDATED` now requires a reason notice or conflict evidence.
- `F-005` resolved: private bundle manifests and exclusions use the shared
  unsigned UTF-8 ordering.
- `F-006` resolved: host-local persisted writes reject symlinked parents and
  create missing parent components one at a time with readback checks.
- `F-001` partially resolved with an explicit memory capsule envelope and
  import-preparation contract. The full roadmap remains honestly partial:
  encryption, live synchronization/offline divergence, migration, rollback,
  complete payload transfer, compaction, and clean-machine functional proof are
  still unavailable and are not claimed by this candidate.

### Static evidence

- All added/changed JavaScript modules pass `node --check`.
- The feature module import closure loads successfully, including memory,
  projections, map/index, store, privacy, and private-control boundaries.
- All feature JSON contracts parse successfully.
- Static privacy scan of the audit report and new capsule contract found no
  private machine paths, credentials, provider tokens, or chat links.
- No npm command or dependency was introduced. Functional tests remain pending
  by instruction.

## Remaining findings after pass 2

### R-001 — Full roadmap portability is still unavailable

Status: `OPEN_UNAVAILABLE_SCOPE`, severity `P1`, not an external blocker.

The candidate can deterministically replay and prepare import of the canonical
memory ledger and derived context. It cannot claim encrypted capsule payload
transfer, private synchronization, offline merge/conflict reconciliation,
version migration, rollback, or compaction-preservation proof. Exact recovery
requires a project-bound encryption/synchronization/migration authority and
independent functional suites; until then the capsule records each capability
as `UNAVAILABLE` with a typed recovery reference.

### R-002 — Functional verification is pending

Status: `PENDING_OWNER_AUTHORIZED_TEST_RUN`, severity `P1`.

The focused project-memory, replay, map/index, private-control, and hostile
boundary verifiers were not run, per the delegated instruction. Exact next
action: run those verifiers on a clean candidate, then independently compare
replay, capsule serialization/import preparation, privacy, and filesystem
readbacks.

### R-003 — Research evidence remains unknown

Status: `EVIDENCE_UNKNOWN`, severity `P2`.

The inventory names owner-linked research records, but no local research corpus
was available in the authoritative tree. Exact recovery: supply the owner-bound
research record or record the feature decision that no external research is
required; do not infer research from code or prose.

## Production-readiness decision after pass 2

`PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS` for the explicitly bounded
partial-memory/capsule slice. It is not an accepted-live release and it is not
the complete roadmap section 8 promise. The candidate is suitable for focused
functional verification because canonical authority, privacy, scope, import
custody, deterministic serialization, and unavailable behavior are now
explicitly represented. No true external blocker is accepted.

## Changed files in the isolated worktree

- `control/content-addressing.mjs`
- `control/derived-index.mjs`
- `control/map-memory-common.mjs`
- `control/persisted-record-privacy.mjs`
- `control/private-control-bundle.mjs`
- `control/private-control-common.mjs`
- `control/private-control-storage.mjs`
- `control/project-map.mjs`
- `control/project-memory-capsule.mjs`
- `control/project-memory-projections.mjs`
- `control/project-memory-records.mjs`
- `control/project-memory-store.mjs`
- `control/project-memory.mjs`
- `docs/feature-audits/ROADMAP_08_MEMORY_CAPSULES/auditreport.md`
- `schemas/derived-index-instance.v1.json`
- `schemas/derived-index-query-instance.v1.json`
- `schemas/derived-index.v1.json`
- `schemas/private-control-bundle.v1.json`
- `schemas/private-control-import.v1.json`
- `schemas/private-control-repository.v1.json`
- `schemas/project-map-instance.v1.json`
- `schemas/project-map.v1.json`
- `schemas/project-memory-capsule-import.v1.json`
- `schemas/project-memory-capsule.v1.json`
- `schemas/project-memory.v1.json`

## Next action

Hand off this candidate for the owner-authorized focused functional test run;
then re-audit any failing verifier against the exact finding and preserve the
resolved history here. If tests are not authorized, retain the candidate as
prepared/inactive with R-002 open and do not claim full ROADMAP_08 completion.

### Self-audit finding S-003 — public export name collision

The final API-closure review found that the new envelope constant initially
used the existing role-capsule constant name. Re-exporting the envelope through
`control/project-memory.mjs` could make the canonical role-capsule schema
ambiguous. The builder renamed the envelope export to
`PROJECT_MEMORY_CAPSULE_ENVELOPE_SCHEMA`, preserved
`PROJECT_MEMORY_CAPSULE_SCHEMA` for the role context capsule, and verified both
public values plus the capsule compiler through the barrel import.

## Central intake cycle — reconciled source handoff — 2026-08-09

Central preserved the exact source-bound handoff before intake. The source
commit is `5ba4f57df4f42cdf38b98eb66d20c9f9d144a332` with tree
`1572da3a78dba0153f71e0010d52d36b137467a9`; the candidate report hash at
handoff was `d4a8af983c19740976ccf126a70f04d736ecfbe6aef30b25414123cde51349f0`.

The current central bytes were authoritative for shared surfaces. Fourteen
paths differed only by terminal blank-line noise and were normalized in the
candidate before handoff. Validated additive deltas were accepted where they
were not already present centrally: symlink-safe private persistence parents,
deterministic UTF-8 private-bundle ordering, disjoint role-capsule scopes with
an explicit `INVALIDATED` reason, and memory-ledger binding validation before
write and after readback. The public memory barrel already exposed the capsule
API in central and needed no replacement. Three new files were accepted:
`control/project-memory-capsule.mjs`,
`schemas/project-memory-capsule-import.v1.json`, and
`schemas/project-memory-capsule.v1.json`.

The capsule is advisory-only, privacy-safe, and partial. It does not provide
acceptance authority or claim encryption, synchronization, migration,
rollback, compaction, full payload transfer, functional proof, or accepted
live behavior. Static syntax, JSON, actual-byte comparison, whitespace, and
privacy checks were the permitted evidence; npm and functional tests were not
run. Central intake is recorded, but downstream adoption remains false.

### CURRENT STATE

Candidate: `5ba4f57df4f42cdf38b98eb66d20c9f9d144a332` / tree `1572da3a78dba0153f71e0010d52d36b137467a9` / `codex/roadmap-08-memory-capsules`
Lifecycle: `FEATURE_CANDIDATE_READY_FOR_PLATFORM`
Disposition: `CENTRAL_INTEGRATED_PENDING_DOWNSTREAM`
Supersedes: `2b2960c976a26eff2930efff8f3cd805716fe5da` and prior stale source identities
Downstream consumed: `false`
Material seams: source-backed platform adoption pending; full capsule portability and functional proof remain unavailable
Proof: `SOURCE_AUDITED_STATIC` — syntax, JSON, actual-byte, whitespace, and privacy checks pass; functional, live, browser, user, deployment, and clean-machine checks are not checked
Next: Central re-audits the combined binding and source surfaces, then records a platform intake when an applicable consumer exists; retain this task and worktree until downstream preservation is proven

## Platform foundation admission — PRIVATE_CONTROL_AND_MEMORY_MAPS — 2026-08-09

This append-only history records the source-backed platform domain admission under pyramid authority a882a74b6a71ba1fe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d. It preserves ROADMAP_08_MEMORY_CAPSULES and dependent features OFFLINE_LOCAL_MODE, PROVIDER_DISCOVERY, PRIVATE_CONTROL_INSTANCE, PROJECT_MEMORY_LEDGER, and BOUNDED_PROJECT_MAPS.

### Typed status

- Domain: PRIVATE_CONTROL_AND_MEMORY_MAPS
- Status: PLATFORM_DOMAIN_CANDIDATE_READY_FOR_CENTRAL_PENDING_COMMIT_AUTHORITY
- Downstream consumed: false
- Verification: STATIC_ONLY; functional and independent proof pending
- Release and activation: HOLD / NOT_PERFORMED

The central source identity is commit 590c07ddd4be7a8c24727c24b40808e44ca7357d and tree f1b358d87e6a969fb9631e202a3d478540edd4d9. The central working snapshot is dirty and the named feature inputs include untracked source files. The candidate performed actual-byte comparisons across the named memory/map/private-control seams; no source-code repair was admissible.

The platform boundary keeps private control-plane custody, offline/provider selection, the canonical project-memory ledger, and derived maps/indexes separate. The ledger is authoritative; projections are rebuildable. Provider capability is an adapter boundary. The capsule remains advisory-only and does not claim encryption, synchronization, migration, rollback, compaction, full payload transfer, functional proof, or accepted live behavior.

### Scope, evidence, and recovery

Only the platform handoff/current-state projection and this report history changed in the candidate. Static syntax, JSON, actual-byte, whitespace, and privacy checks passed. Functional tests, npm, provider/live behavior, deployment, clean-machine checks, and independent acceptance were not run. Six provider/offline/binding inputs remain central-only and were not copied into this lane.

The Controller owns platform-registry admission and shared contract/binding changes. Missing provider capability, authority mismatch, privacy violation, corrupted ledger, stale projection, or unsupported capsule operation fails closed as typed unavailable/partial evidence. Feature lanes may consume the accepted public contract but may not edit private-control or ledger seams.

Exact next action: re-audit combined bindings and source surfaces, record platform-registry admission when an applicable consumer exists, preserve this handoff and report, and release dependent feature lanes only after downstream preservation is proven.
downstream preservation is proven.

## Controller platform-batch preservation — 2026-08-09

The platform custodian completed its alias-aware handoff. The preserved
platform report digest is
`6f3be0475ab6feb4f36090c3f30827406ad21878fc47feca758cfc0cd0524d9d`; the
preserved handoff digest is
`a99fa8644c111c5e823ebd0b2fd24cbf1b001ddaea13da343360d03ab5ed97bd`.
This feature remains held until the Controller completes central audit,
platform-registry admission, clean-custody integration, and independent
clearance. The task and worktree remain preserved; no archive or downstream
consumption is claimed.
