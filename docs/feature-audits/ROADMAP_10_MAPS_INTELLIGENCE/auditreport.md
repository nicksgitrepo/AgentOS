# ROADMAP_10_MAPS_INTELLIGENCE audit report

## Pass 0 — initial audit of intent and isolated baseline

Status: `REPAIR_REQUIRED`; no external blocker identified.

Baseline identity: accepted merge source commit `590c07ddd4be7a8c24727c24b40808e44ca7357d`.
The accepted merge worktree was read as authority. This report and all builder
changes are confined to the isolated worktree for this feature.

### Scope and evidence read

The inventory entry is `ROADMAP_10_MAPS_INTELLIGENCE`, named **Bounded Maps and
Repository Intelligence**, with the roadmap, `schemas/project-map.v1.json`, and
`schemas/derived-index.v1.json` as its direct sources. The related named
capability is `BOUNDED_PROJECT_MAPS`, whose accepted-merge reference files are
`control/project-map.mjs` and `control/derived-index.mjs`. I also read the
roadmap purpose/boundaries, the Phase 5 exit gate, the architecture and feature
inventory documentation, the project-memory projection references, the map and
index instance schemas, and the accepted-merge focused contract/hostile-test
fixtures.

The inventory's `research-records-linked-by-owner` reference is not present in
the public accepted snapshot. It is recorded as an evidence unknown, not as a
blocker, because the portable roadmap and schemas provide the normative intent
needed for this bounded kernel slice.

### Intended behavior

AgentOS must derive optional, bounded visual maps for dependencies, authority,
workflow, feature coverage, and recovery, plus repository-planning intelligence.
The result is an evidence-bound projection, never a second authority source.

The roadmap's done criteria require:

- every node and edge to trace to a current typed source or direct observation;
- visible bounds, omissions, freshness, uncertainty, and source identity;
- explicit unavailable or conflict state for stale or contradictory input;
- no ability for a map or index to modify authority or satisfy acceptance; and
- independent comparison of representative projections with their underlying
  records.

The accepted schemas further require `PREPARED_NOT_ACTIVATED`, control-space,
advisory-only records; exact source/tree/snapshot/policy/compiler binding for
maps; bounded deterministic nodes/edges; and privacy-safe hashed lexical index
documents with role-filtered query results. Raw source text and raw queries must
not be persisted. The portable kernel must consume typed snapshots rather than
walk a product repository, host, session, or transcript.

### Actual implementation at audit time

The isolated baseline has no map or derived-index schemas, instance schemas,
runtime controllers, shared content-addressing/privacy seam, focused tests, or
public control documentation for this capability. Its existing project-memory,
repository, and campaign code therefore cannot compile or validate a ROADMAP_10
projection.

The accepted merge contains a useful reference implementation and focused
fixtures, but those files are not present in this writable baseline. The
reference is itself a typed-input compiler, not a raw repository scanner; that
is the correct portable-kernel boundary and requires an admitted adapter to
perform any repository observation before handing a typed snapshot to the
compiler.

### Findings

| ID | Finding | Why it matters | Evidence / disposition |
| --- | --- | --- | --- |
| `MAP-001` | The isolated baseline is missing the complete map/index vertical slice. | The roadmap promise is not executable, source-bound, or independently checkable. | Direct baseline inventory; repair by adding the contracts, validators, compilers, query projection, and focused checks. |
| `MAP-002` | The baseline lacks a shared canonical digest and persisted-record privacy boundary needed by the contracts. | Without one deterministic hash and final-record scan, source identity, compiler identity, and privacy claims can drift or leak. | Accepted reference imports a shared content-addressing/privacy seam; repair with the smallest project-agnostic seam required by this feature. |
| `MAP-003` | Initial hostile coverage is absent in the isolated baseline, and the accepted reference does not explicitly cap oversized map source arrays before producing bounded omission counts. | A bounded output must not accept unbounded source material or fail only after constructing an invalid omission count; malformed, stale, contradictory, unauthorized, and privacy-bearing inputs need regression protection. | Repair with explicit source-size bounds and focused hostile cases; leave full functional execution pending as directed. |
| `MAP-004` | No isolated-baseline documentation/public module listing explains the non-authoritative typed-snapshot boundary. | Future builders could add repository walking or treat a projection as acceptance authority, violating custody and portability. | Repair by documenting the controller seam and its boundary in the feature slice. |

### Quality and governance lenses

- **Intent:** aligned only when the roadmap's evidence-bound projection and
  Phase 5 non-authority rule are preserved; `MAP-001` currently leaves intent
  unimplemented in the isolated baseline.
- **Functionality:** no runnable map/index compiler or query exists in the
  baseline; functional tests remain pending.
- **Quality/minimality:** the repair should add only the map/index contracts,
  shared digest/privacy primitive, focused validators/compilers, and checks. It
  must not import product context or duplicate canonicalization logic.
- **Hygiene:** no feature audit directory/report exists in the accepted
  snapshot; this report is the first append-only record for this feature. New
  public files must remain project-agnostic and free of private machine paths,
  secrets, credentials, provider tokens, task identities, and chat links.
- **Security/privacy:** maps must reject unsafe persisted values; indexes may
  accept source text only transiently and must persist metadata, digests, and
  hashed postings, never raw content or raw queries. Role scope must filter
  retrieval.
- **Durability:** map/index records need content digests, exact source/policy/
  compiler bindings, deterministic ordering, explicit stale state, and
  rebuildability from typed input.
- **Regression:** focused contract, determinism, bound, stale, conflict,
  unavailable, role-filter, privacy, dangling-reference, tamper, and authority
  tests are required; execution is pending in this cycle.
- **Custody/boundary:** projections remain in control space and cannot write
  authority, accept work, activate `2.1rc`, publish, deploy, or perform any
  protected action. Repository observation belongs to a separate typed adapter.
- **Production readiness:** not ready at this pass because the vertical slice
  is absent from the isolated baseline. The target after repair is a
  production candidate pending the directed functional test run and
  independent re-audit.

### True blockers and exact recovery

There is no genuine external blocker. Missing owner-linked research records are
an evidence unknown and do not prevent a project-agnostic contract repair.

If a later check finds the actual source snapshot, policy digest, or independent
functional runner unavailable, recovery is exact: preserve the failed evidence,
keep the projection `STALE` or `UNAVAILABLE`, record the missing binding or
runner capability, and rerun the same focused checks after the authoritative
source or host capability is supplied. Do not convert unavailable evidence into
acceptance.

### Builder actions recorded from this audit

1. Add strict map and derived-index contract/instance schemas, retaining
   `PREPARED_NOT_ACTIVATED` and explicit advisory-only fields.
2. Add a small shared project-agnostic digest/privacy seam and deterministic
   map compiler/validator plus hashed, role-scoped index compiler/query.
3. Enforce source-size bounds, deterministic ordering, source-record traces,
   stale/conflict/unavailable states, dangling-reference rejection, and final
   privacy scans.
4. Add focused hostile/contract fixtures and document the typed-input-only,
   non-authoritative boundary.
5. Self-audit the changes, re-audit against the roadmap and accepted schemas,
   and append the result without rewriting this pass.

## Pass 1 — builder self-audit and re-audit

Status: `PRODUCTION_CANDIDATE_PENDING_TESTS`; no genuine external blocker.

### Changed files

- `control/persisted-record-privacy.mjs`
- `control/content-addressing.mjs`
- `control/map-memory-common.mjs`
- `control/project-map.mjs`
- `control/derived-index.mjs`
- `schemas/project-map.v1.json`
- `schemas/project-map-instance.v1.json`
- `schemas/derived-index.v1.json`
- `schemas/derived-index-instance.v1.json`
- `schemas/derived-index-query-instance.v1.json`
- `tests/verify-map-memory-contracts.mjs`
- `tests/verify-project-map.mjs`
- `tests/verify-derived-index.mjs`
- `tests/verify-all.mjs`
- `control/README.md`
- `schemas/README.md`
- this append-only report

### Repairs and evidence

- `MAP-001` is resolved by a complete map/index vertical slice. Map records
  carry exact source commit/tree/snapshot/policy/compiler bindings and typed
  node/edge source digests. Index records carry snapshot/policy/compiler
  bindings, hashed postings, transient-only input content, and role-scoped
  query results.
- `MAP-002` is resolved by one shared canonical UTF-8 digest primitive and a
  project-agnostic persisted-record privacy scan. Final map, index, and query
  records are scanned before return; raw index content and raw query text are
  not persisted.
- `MAP-003` is resolved in implementation by explicit 100,000-source-node and
  100,000-source-edge caps, output node/edge bounds, deterministic omissions,
  stale/conflict/unavailable state rules, dangling-reference checks, role
  filtering, tamper checks, and hostile fixtures. The focused fixtures are also
  wired into `tests/verify-all.mjs`.
- `MAP-004` is resolved by the control/schema documentation stating that map
  and index authorities accept typed snapshots/documents only and cannot walk
  repositories, change authority, satisfy acceptance, or perform protected
  actions.
- The re-audit found and resolved one ordinary integration gap: the focused
  feature checks were initially not in the aggregate verifier. `MAP-005` is
  therefore closed by the `tests/verify-all.mjs` change.

Static evidence collected in this pass: all new `.mjs` files and focused test
files pass `node --check`; all five new JSON contracts parse; the new modules
import successfully; required-field parity matches the contract fixtures;
`git diff --check` is clean; a boundary scan found no filesystem, process,
network, authority-write, or protected-action path in the map/index compilers;
and a privacy/hygiene scan found no private machine paths, secrets, provider
tokens, task identities, or chat links. The accepted merge worktree remained
read-only and was not modified by this task.

### Remaining findings and unknowns

- `VERIFY-PENDING-001` — the focused functional fixtures and aggregate verifier
  have not been executed in this cycle, per the requested “functional tests
  remain pending” condition. This is a verification hold, not a code defect or
  external blocker.
- `RESEARCH-UNKNOWN-001` — owner-linked research records named by the inventory
  are not present in the public snapshot. The implementation remains limited to
  the roadmap/schema authority and does not invent research conclusions.
- `ADAPTER-BOUNDARY-001` — no raw repository scanner is included. Re-audit
  disposition is intentional: repository observation is product/context data
  for an admitted adapter, while the portable kernel accepts only its typed,
  source-bound snapshot. Adding a scanner here would violate the repository and
  product-boundary intent.

### Production readiness and next action

The isolated worktree is a production candidate pending the directed functional
checks. `2.1rc` remains `PREPARED_NOT_ACTIVATED`; no map or index can authorize
acceptance or protected action. The exact next action is to run the three
focused checks and then the aggregate verifier with Node (never npm), preserve
any failure evidence, and repair only a reproduced failure before the next
independent re-audit. If the runner is unavailable, retain this candidate as
pending rather than converting unavailable evidence into acceptance.
## Pass 2 — Central snapshot reconciliation and re-audit

Date: 2026-08-09

### Authority, intent, and source state

The updated Audit-Driven Integration Pyramid and its hybrid-scheduler companion were
re-read before this pass. Their supplied SHA-256 values matched exactly:
a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d and
3cef7fcb7897ad44f7975c1c6cb50cd20ca82cfa1ce1c3c8849c18de9aedda10.

The current central source state was treated as read-only authority:
central commit 590c07ddd4be7a8c24727c24b40808e44ca7357d and central tree
f1b358d87e6a969fb9631e202a3d478540edd4d9. The feature inventory remains the
source of scope. The current inventory also admits newer Roadmap 08/09 and
integration-pyramid surfaces; those central surfaces were not independently
rewritten or copied into this feature lane.

Roadmap 10 intent remains: compile bounded maps and derived repository indexes
from typed, source-bound project snapshots; preserve provenance, freshness,
omissions, uncertainty, conflicts, role scope, privacy, and deterministic
content identity; and keep repository, host, session, transcript, credential,
provider, acceptance, deployment, and protected-action authority outside this
portable kernel.

### Reconciliation actions

The isolated candidate contained an older copy of the Roadmap 10 slice. It was
reconciled against the current central bytes for:

- control/persisted-record-privacy.mjs
- control/content-addressing.mjs
- control/map-memory-common.mjs
- control/project-map.mjs
- control/derived-index.mjs
- schemas/project-map.v1.json
- schemas/project-map-instance.v1.json
- schemas/derived-index.v1.json
- schemas/derived-index-instance.v1.json
- schemas/derived-index-query-instance.v1.json
- tests/verify-map-memory-contracts.mjs
- tests/verify-project-map.mjs
- tests/verify-derived-index.mjs
- tests/verify-all.mjs

control/README.md and schemas/README.md were first brought to the current
central bytes, then received only additive Roadmap 10 boundary documentation.
The current aggregate verifier is retained; its dynamic discovery includes the
focused feature checks without restoring the stale explicit test list. No
Roadmap 08/09 controller, scheduler, project-memory, release, or central
integration implementation was replaced by this lane. The accepted central
worktree was not modified.

A previous local pass described project-map source-array constants that are
absent from the current central project-map bytes. Those constants were not
reintroduced: doing so would replace newer central behavior with a stale local
variant. The current implementation still validates typed source records,
bounds persisted node and edge output, records deterministic omission counts,
rejects invalid or dangling references, preserves freshness/conflict/
unavailable states, and never persists the source arrays as an unbounded
authority. If a future threat model requires an input-size cap in addition to
the current typed adapter and output bounds, that is a central contract
evolution to be recorded and owned there, not an unapproved local divergence.

### Actual implementation after reconciliation

- project-map.mjs provides deterministic, source-bound map compilation and
  validation with commit/tree/snapshot/policy/compiler identity, role scope,
  sorted digests, bounded nodes and edges, selected-root handling, explicit
  omission notices, stale/conflict/unavailable states, and privacy-safe
  persisted-record serialization.
- derived-index.mjs provides bounded document/token indexing and bounded query
  results. It binds the index and query to source snapshot, policy, compiler,
  role, and index identity, and does not persist raw source content or raw query
  text.
- persisted-record-privacy.mjs is the current shared redaction and serialized
  record boundary. content-addressing.mjs re-exports the shared canonical
  digest/serialization surface so map and index records cannot drift into
  parallel hashing.
- the versioned schemas describe the contract, instance, and query records;
  the focused checks cover contract parity, deterministic ordering, bounds,
  omission/freshness/tamper cases, role filtering, and no-raw-content
  persistence expectations.
- verify-all.mjs remains the current central aggregate-discovery surface.

### Re-audit findings by quality dimension

- Intent: PASS. The implementation is an evidence-bound projection, not a
  repository scanner or product-aware planner.
- Minimality: PASS. Only the Roadmap 10 controllers, contracts, focused checks,
  shared bytes required for their current boundary, and two README additions
  are carried. No parallel implementation or unrelated Roadmap 08/09 surface
  was introduced.
- Quality: PASS under static review. Exact-key checks, deterministic sorting,
  bounded counts/text, source identity, and explicit state transitions remain
  visible in the reconciled bytes.
- Hygiene: PASS. The focused implementation and contract paths contain no
  private machine paths, secrets, provider tokens, task identities, or chat
  links. The report uses relative repository paths and opaque commit/tree
  references only.
- Security and privacy: PASS under static review. Raw repository, host,
  session, transcript, credential, and provider access is absent from the
  map/index compilers. Persisted records pass through the shared privacy
  boundary; raw index content and raw query text remain transient.
- Durability: PASS under static review. Map/index records bind source,
  policy, compiler, and content identity and reject stale or tampered
  records instead of silently treating them as current.
- Regression: PASS for byte reconciliation and syntax/contract checks. The
  aggregate verifier is the current central dynamic-discovery version, so the
  focused checks remain discoverable without a stale list merge.
- Custody: PASS. Central was read-only; all edits are isolated here. No
  deployment, release, archive, downstream consume, or protected action was
  attempted.
- Boundary: PASS. Raw observation remains an admitted adapter responsibility;
  this kernel accepts typed source-bound data only. Missing live/browser/
  provider proof is not represented as success.
- Integration: PASS for the local source-bound candidate. Shared README,
  schema README, privacy, content addressing, and aggregate-verifier bytes
  were reconciled to the current central snapshot before the additive docs
  were applied.
- Research: UNKNOWN remains limited to the owner-linked research records
  absent from the public inventory snapshot. No research conclusion was
  invented.

### Static evidence, blockers, and production readiness

The authority hashes matched. All nine reconciled .mjs files passed node
syntax checks; all five Roadmap 10 JSON contracts parsed; central/local
SHA-256 spot checks matched for the reconciled implementation, schema, and
verifier files; and git whitespace checks were clean. A relative-path privacy
scan found no forbidden private path, secret, provider-token, or chat-link
marker. No npm command and no functional test was run.

There is no genuine external, authority, unavailable-host, or custody blocker.
VERIFY-PENDING-001 remains a deliberate proof ceiling because functional checks
were explicitly left pending. Exact recovery is for the Central consumer to
run the three focused Node checks and then the aggregate Node verifier, retain
any failure evidence, repair only a reproduced failure in an isolated
generation, and re-audit. If that runner is unavailable, retain the candidate
as pending rather than converting missing evidence into acceptance.

Disposition: PRODUCTION_CANDIDATE_PENDING_TESTS. Lifecycle remains
PREPARED_NOT_ACTIVATED; downstream_consumed remains false. This is a
source-bound local candidate awaiting Central consumption and directed
functional proof, not a release, deployment, live audit, or archive.

### Builder actions and current state

Builder actions completed in this pass: re-read authority and inventory;
compared current central versus local state; replaced stale local copies with
current central bytes; preserved the current shared privacy/content-addressing
and dynamic-verifier behavior; added only the typed Roadmap 10 documentation
boundary; ran static syntax/JSON/diff/privacy/hash checks; and prepared this
append-only audit update.

CURRENT STATE
candidate_identity: ROADMAP_10_MAPS_INTELLIGENCE_RECONCILED_STATIC_CANDIDATE
central_commit: 590c07ddd4be7a8c24727c24b40808e44ca7357d
central_tree: f1b358d87e6a969fb9631e202a3d478540edd4d9
local_commit: RECORDED_IN_FINAL_HANDOFF
local_tree: RECORDED_IN_FINAL_HANDOFF
lifecycle: PREPARED_NOT_ACTIVATED
downstream_consumed: false
disposition: TERMINAL_PRESERVED_PENDING_TESTS
superseded_identities: prior local pre-reconciliation byte variant
unresolved_seams: directed functional checks; owner-linked research records
proof_ceiling: static-only; no functional, live, browser, deployment, or user proof
immediate_next_action: Central consumes the preserved candidate, then runs the
three focused Node checks followed by the aggregate Node verifier.
report_sha256: RECORDED_IN_FINAL_HANDOFF
