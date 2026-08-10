# ROADMAP_02_LAYERED_GOVERNANCE audit report

Feature: `ROADMAP_02_LAYERED_GOVERNANCE` — Layered Governance and Project Contracts  
Audit mode: source-bound audit → repair → self-audit → re-audit  
Contract status: `PREPARED_NOT_ACTIVATED`  
Functional-test status: pending by task instruction; no npm use

## Initial audit — 2026-08-07

### Baseline and custody

- Authoritative accepted-merge checkpoint: commit
  `590c07ddd4be7a8c24727c24b40808e44ca7357d`, tree
  `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- The authoritative checkout contains accepted-merge worktree additions that
  are not present in the writable checkout at that commit. The writable
  checkout is the only mutation scope; the accepted checkout remains read-only.
- Inventory authority: `docs/feature-inventory.v1.json`; the feature is entry
  `ROADMAP_02_LAYERED_GOVERNANCE`, report path
  `docs/feature-audits/ROADMAP_02_LAYERED_GOVERNANCE/auditreport.md`, status
  `NOT_STARTED`.
- Inventory sources are `docs/roadmap.md`,
  `schemas/governance-library.v1.json`, and
  `schemas/project-general-library.v1.json`. The catalog also names
  `docs/bootstrap-rapid-prototype-plan.md`, `docs/architecture.md`,
  `governance/`, `control/`, `schemas/`, and owner-linked research records as
  context. No owner-linked research record is present in the accepted public
  checkout; this is an evidence unknown, not a blocker.

### Intended behavior

The roadmap requires a friendly Bootstrap conversation to compile into a
private, typed, secret-free project contract covering outcomes, workflows,
terminology, boundaries, acceptance conditions, unknowns, providers,
retention, delivery intent, and owner-only decisions. Every decision must bind
authority, scope, lifetime, provenance class, and a revision trigger.

Four governance layers must compose deterministically in this order:

1. shared general governance;
2. base-role governance;
3. persistent project governance; and
4. generated task-role governance.

Generated task packets must be reproducible, task-shaped, and limited to the
rules/questions applicable to the admitted task. Project governance must remain
recoverable across AgentOS upgrades, or produce an explicit, conflict-aware,
reversible migration review. An independent checker must be able to compare
conversation outcome, contract, packet, and upgrade result from digests and
typed records rather than narrative claims.

### Actual implementation observed

| Area | Evidence in accepted merge | Initial disposition |
| --- | --- | --- |
| Two-layer portable architecture | `control/governance-library.mjs`, `control/role-governance-library.mjs`, `schemas/governance-library.v1.json`, `schemas/architecture-repair-plan.v1.json`, and architecture-repair evidence provide deterministic shared-plus-generated role rules, source/tree/question-tree bindings, portability checks, and a controller gate. | Useful and independently described, but not the roadmap’s four-layer project contract. |
| Four-library composition | `control/four-library-foundation.mjs`, `control/four-library-operations.mjs`, `control/four-library-history.mjs`, and `control/four-library-governance.mjs` provide base-general, base-role, project-general, generated-project-role records, digests, additive overlays, ownership, lifecycle transitions, conflicts, upgrade preparation, and append-only history. | Strong isolated slice; not bound into the public two-layer wrapper or task-shaped packet path. |
| Project contract slice | `control/bootstrap-conversation.mjs`, `control/bootstrap-project-contract.mjs`, `control/bootstrap-compile-receipt.mjs`, and their schemas provide normalized answers, typed values/lists, discovery projection, reassessment, fail-closed boundaries, privacy flags, content digests, and public failure receipts. | Real contract slice; coverage and decision metadata are incomplete against roadmap intent. |
| Persistence and migration schemas | `schemas/project-governance-appendix.v1.json`, `schemas/project-governance-update.v1.json`, `schemas/governance-migration.v1.json`, and `schemas/project-governance-history-entry.v1.json` describe related persistence/migration shapes. | Parallel schemas are not one executable persistence authority. |
| Focused verification intent | `tests/verify-four-library-governance.mjs`, `tests/verify-governance-library.mjs`, `tests/verify-role-governance-library.mjs`, and Bootstrap contract verifiers cover determinism, hostile ownership/path/privacy cases, conflicts, lifecycle, upgrade preservation, reassessment, and append-only history. | Functional execution intentionally pending. |

### Findings recorded before repair

#### F-01 — isolated candidate does not contain the authoritative feature slice

- Severity: high; custody/provenance/minimality.
- Evidence: the authoritative accepted merge has the feature-specific control,
  schema, documentation, and verifier additions; the writable checkout at the
  same commit has none of those additions and has no roadmap/inventory files.
- Why it matters: repairing against a thinner checkout would either produce a
  false acceptance or silently import unrelated merge work. The candidate must
  carry only the feature’s source-bound accepted slice.
- Repair action: port the exact feature-scoped authoritative files into this
  worktree through the normal patch path, then record the relative changed-path
  manifest and re-audit it for unrelated content.

#### F-02 — public governance contract is two-layer while the roadmap is four-layer

- Severity: high; intent/boundary/regression.
- Evidence: `docs/roadmap.md:89-109` requires four layers; the
  `schemas/governance-library.v1.json` architecture envelope names only
  `SHARED_GENERAL_GOVERNANCE` and `GENERATED_ROLE_SPECIFIC_GOVERNANCE`; the
  accepted four-library compiler is a separate authority with no wrapper-level
  binding to the project contract or architecture gate.
- Why it matters: two competing precedence descriptions can admit a packet that
  passed the old gate but omitted persistent project governance or upgrade
  lineage. This is an authority-source and regression risk.
- Repair action: make the public governance contract explicitly advertise and
  bind the four-library stack while retaining the older shared/generated slice
  as a compatibility foundation. Add a deterministic layer order, project
  contract binding, and required acceptance requirements without activating
  `2.1rc`.

#### F-03 — Bootstrap contract does not compile the full roadmap context

- Severity: high; intent/functionality/privacy.
- Evidence: the accepted conversation asks audience, outcome, first result,
  allowed/non-goal scope, hard/soft boundaries, memory, delivery finish, and
  review interval. `bootstrap-project-contract.v1` has no explicit workflow,
  terminology, acceptance-condition, provider, or retention fields. Delivery
  route is a compiler placeholder and the small slice is not the main
  Bootstrap plan’s typed contract.
- Why it matters: omitted context is later guessed, lost, or re-asked; provider
  and retention decisions can cross a protected boundary without an explicit
  owner record.
- Repair action: extend the friendly conversation and contract with typed
  workflow, terminology, acceptance conditions, provider posture, retention,
  and delivery-intent fields. Preserve raw-text exclusion and fail closed on
  unresolved material owner choices.

#### F-04 — decision records omit required revision metadata

- Severity: high; durability/intent.
- Evidence: `compileDecisions` records decision ref, question, value, status,
  certainty, authority, provenance, and answer digest only. The roadmap also
  requires decision scope, lifetime, provenance class, and revision trigger.
- Why it matters: a later compiler cannot determine where a decision applies,
  how long it remains valid, or what change invalidates it.
- Repair action: add stable `scope`, `lifetime`, `provenance_class`, and
  `revision_trigger` fields to the contract schema and compiler, with canonical
  defaults derived from question families and content-addressed decision data.

#### F-05 — generated four-library output is role-shaped, not task-shaped

- Severity: medium-high; minimality/routing.
- Evidence: `compileGeneratedProjectRoleLibrary` emits one packet for every
  base role and applies all matching project overlays. It has no admitted task
  digest, task kind, applicable question set, or task-specific projection.
  The older role library has question selectors, but the two authorities are
  not joined.
- Why it matters: workers can receive unnecessary governance or miss the exact
  task questions, violating least-context and reproducibility requirements.
- Repair action: add a task-packet projection over the four-layer result. It
  must bind task identity as an opaque digest, select only requested role/task
  rules and questions, reject unbound task inputs, and remain unable to expand
  authority.

#### F-06 — project governance persistence has parallel, unconnected shapes

- Severity: medium; durability/regression.
- Evidence: appendix/update schemas and four-library migration/history schemas
  overlap in purpose, while only the four-library history appender is
  executable. The history compiler accepts a `previous` entry without first
  checking that it belongs to the same project. The appender resolves the
  history parent before creating a missing parent directory.
- Why it matters: an upgrade can preserve the wrong project’s lineage or fail
  on a valid first write, and callers cannot tell which persistence record is
  authoritative.
- Repair action: make the four-library migration/history path the executable
  authority, add project/revision checks and safe parent creation, and document
  the appendix/update schemas as compatibility projections or validate them
  through the same digest/lineage rules.

#### F-07 — machine schemas are weaker than executable portability rules

- Severity: medium; security/hygiene.
- Evidence: project-general schema permits unconstrained project IDs and graph
  paths, while the executable validator requires stable identifiers, normalized
  relative paths, and portable content. The two-layer wrapper has no explicit
  four-layer binding fields.
- Why it matters: a schema-only consumer can accept a record the canonical
  compiler rejects, creating a custody or privacy split.
- Repair action: align schema patterns/enums and wrapper bindings with the
  executable validators, without embedding project names or host paths.

### Quality and readiness assessment

- Quality: deterministic canonical JSON and digest checks are present in both
  compiler families; the split authority is the principal maintainability risk.
- Hygiene/minimality: the accepted merge is broad, but the feature repair scope
  is limited to the contract, four-layer governance, schemas, focused verifiers,
  and this report. No npm or package dependency is needed.
- Security/privacy: portable validators reject paths, credentials, provider
  labels, session identities, and raw conversation in the relevant slices;
  schema parity and typed context coverage still need repair.
- Durability: lineage and append-only history exist, but cross-project previous
  records and first-write parent handling need repair.
- Regression: functional tests are intentionally pending. Static syntax,
  changed-path, schema-parse, digest-shape, and privacy scans are the permitted
  pre-test evidence.
- Custody/boundary: no activation, delivery, external action, owner decision,
  provider binding, or child/hidden agent is authorized or performed.
- Production readiness at initial audit: `NOT_READY`; no true external blocker.

### True blockers and exact recovery

None. The missing research records are an evidence unknown that can be handled
by recording `UNKNOWN`/`DEFERRED` typed values. The accepted merge is available
as read-only authority, and all repairs are possible in the writable worktree.
Functional verification is pending by explicit task instruction, not a claim of
failure or a reason to stop the repair loop.

### Builder actions

1. Port only F-01’s feature-scoped accepted files.
2. Repair F-02 through F-07 in the writable worktree.
3. Run static-only self-audit checks; do not run npm or functional verifiers.
4. Append each repair result, resolved history, residual unknowns, and exact
   next action here.
5. Re-audit the final source against the roadmap and inventory before handoff.

Initial audit disposition: `REPAIR_REQUIRED`; goal remains active.

## Repair pass — 2026-08-07

The builder repaired only findings F-01 through F-07 in this isolated
worktree. The accepted merge remained read-only, no child or hidden agent was
created, no unrelated project was touched, no provider or external action was
performed, and the prepared state remains inactive.

### Changed-file manifest

Controls:

- control/task-gate-questions.mjs
- control/bootstrap-conversation.mjs
- control/bootstrap-compile-receipt.mjs
- control/bootstrap-project-contract.mjs
- control/governance-library.mjs
- control/governance-role-definitions.mjs
- control/role-governance-library.mjs
- control/four-library-foundation.mjs
- control/four-library-operations.mjs
- control/four-library-history.mjs
- control/four-library-governance.mjs
- control/layered-governance-contract.mjs

Schemas:

- schemas/bootstrap-answer.v1.json
- schemas/bootstrap-conversation.v1.json
- schemas/bootstrap-compile-receipt.v1.json
- schemas/bootstrap-project-contract.v1.json
- schemas/base-general-library.v1.json
- schemas/base-role-library.v1.json
- schemas/project-general-library.v1.json
- schemas/generated-project-role-library.v1.json
- schemas/generated-task-role-packet.v1.json
- schemas/governance-library.v1.json
- schemas/governance-binding.v1.json
- schemas/governance-conflict.v1.json
- schemas/governance-migration.v1.json
- schemas/layered-governance.v1.json
- schemas/project-governance-history-entry.v1.json

Focused verifiers:

- tests/verify-bootstrap-conversation-contract.mjs
- tests/verify-bootstrap-project-contract.mjs
- tests/verify-bootstrap-project-contract-schema.mjs
- tests/verify-four-library-governance.mjs
- tests/verify-governance-library.mjs
- tests/verify-role-governance-library.mjs

### Builder actions completed

- F-01: ported only the feature-scoped accepted control, schema, and focused
  verifier slice into the writable worktree.
- F-02: added the layered-governance envelope with the explicit four-layer
  order, project-contract digest binding, additive-only precedence rule,
  migration controller, and inactive activation state. The older two-layer
  library remains a compatibility foundation; the envelope does not activate
  2.1rc.
- F-03: added typed workflow, terminology, acceptance-condition, provider,
  retention, delivery-intent, and unknown projections to the Bootstrap
  contract while retaining raw-text exclusion and fail-closed required
  questions.
- F-04: added decision scope, lifetime, provenance class, and revision trigger
  metadata with deterministic question-family derivation and schema parity.
- F-05: added a generated task-role packet that binds an opaque task digest,
  role/lane, task kind, canonical gate catalog digest, selected question IDs,
  effective graph scope, and non-expanding authority.
- F-06: made the four-library history path reject cross-project predecessors,
  preserve monotonic revisions, create only real directories below the
  control root, and keep append-only writes protected. The four-library
  history record is the executable persistence authority; appendix/update
  shapes remain compatibility schemas.
- F-07: aligned project-general schema identifiers, normalized relative graph
  paths, graph IDs, revision tokens, and uniqueness constraints with the
  executable validators.

### Self-audit evidence

- Static JavaScript syntax checks passed for every changed control module.
- JSON parsing passed for every changed schema.
- Diff whitespace check passed.
- Module import sanity passed for the repaired Bootstrap, four-library,
  history, layered-envelope, and public governance entrypoints.
- A scoped scan found no persisted private machine path, provider token,
  credential, session/task identity, or chat link in the report or repaired
  public contract files.
- The changed-path manifest is limited to the feature inventory slice, its
  report, and the focused verifiers.
- Functional verifiers were not executed, and npm was not used, per task
  instruction.

## Re-audit — 2026-08-07

| Finding | Re-audit result | Evidence | Remaining state |
| --- | --- | --- | --- |
| F-01 | Resolved | Feature-scoped accepted controls, schemas, and verifiers are present in the isolated candidate. | None. |
| F-02 | Resolved | layered-governance-contract.mjs and layered-governance.v1.json bind all four layers, project contract digest, precedence, migration, and inactive activation. | None; activation remains intentionally pending. |
| F-03 | Resolved | Bootstrap conversation and project contract carry workflow, terminology, acceptance, provider, retention, delivery intent, and typed unknowns. | Owner-omitted optional context remains explicit UNKNOWN/DEFERRED data. |
| F-04 | Resolved | Contract decisions now carry scope, lifetime, provenance_class, revision_trigger, and answer digest. | None. |
| F-05 | Resolved | Generated task-role packet compiler/validator and focused assertions bind role/task scope and selected gate questions without authority expansion. | None. |
| F-06 | Resolved | History compiler checks project identity; safe target creation rejects symlinked or escaping parents and appends only within the control root. | Functional execution remains pending. |
| F-07 | Resolved | Project-general schema patterns now match stable identifiers, normalized relative paths, and executable uniqueness rules. | None. |

### Final readiness and unknowns

The candidate is a production candidate pending the explicitly deferred
functional verifiers. It is deterministic, typed, content-addressed,
portable, privacy-bounded, four-layer bound, task-scoped, and prepared but not
activated. No implementation finding remains open.

The only evidence unknown is the absence of owner-linked research records in
the accepted public checkout. That unknown is represented as
UNKNOWN/DEFERRED rather than inferred into the contract. The functional test
queue is a process condition, not a true external blocker.

True blockers: none. Exact recovery is to run the focused functional
verifiers under the approved test authority, then independently compare the
conversation, project contract, task packet, and upgrade/history result before
any activation decision.

Final builder disposition: PRODUCTION_CANDIDATE_PENDING_TESTS; goal remains
active until the handoff is recorded.

## Final re-audit addendum — 2026-08-07

The public four-library entrypoint was checked after the repair pass and now
re-exports the layered-governance envelope and generated task-role packet
compiler/validator. Public export presence, final JavaScript syntax, and
whitespace integrity all pass. The re-audit disposition is unchanged:
PRODUCTION_CANDIDATE_PENDING_TESTS, with no true blocker and no remaining
implementation finding.

## Central integration intake — 2026-08-09

- visible_task_ref: TASK_REF_ROADMAP_02_LAYERED_GOVERNANCE_VISIBLE
- isolated_worktree_ref: WORKTREE_REF_B155
- source_head: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- source_tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- isolated_report_sha256: `5fa1e58ee0a748364663923bffa87dbad7f9e9e4d0638137e57a206804682d8c`
- central_disposition: SOURCE_BOUND_CANDIDATE_INTEGRATED_PENDING_BINDING_REFRESH
- changed_path_disposition: layered contract, task packet, schemas, docs, verifier, and overlapping Bootstrap/governance hardening integrated; binding refresh deferred until combined source is settled
- functional_status: NOT_RUN_BY_INSTRUCTION
- archive_status: WITHHELD_UNTIL_DOWNSTREAM_REVIEW
PRODUCTION_CANDIDATE_PENDING_TESTS, with no true blocker and no remaining
implementation finding.

## Next admitted feature wave — audit 0 — 2026-08-09

### Source-bound scope and intent review

- Feature: `ROADMAP_02_LAYERED_GOVERNANCE` — Layered Governance and Project Contracts.
- Authoritative source checkpoint: commit `bd6c46253d921b94dd9b308ffaf93cfbcfe1bcac`, tree `40d495f1599cd0b0f07de83748b74253b526b145`.
- Inventory source: `docs/feature-inventory.v1.json`; the feature remains `CENTRAL_INTEGRATION_PENDING` and names the roadmap, layered-governance wrapper, and project-general contract as its source intent.
- The prior candidate and its audit history were preserved. This wave is being repaired only in the isolated feature worktree; no central, neighboring-lane, or unrelated project surface was changed.
- No npm command or functional verifier was run. `2.1rc` remains prepared and inactive.

The roadmap, layered-governance documentation, Bootstrap contract shape, four-library contracts, migration/history records, and accepted architecture evidence were read together. The intended behavior is a deterministic four-layer composition: general governance/base-general, base role, persistent project governance, and a generated task-role projection. Later layers may add restrictions or evidence but cannot remove prohibitions, replace an authority source, expand graph scope, or make a disposable task packet authoritative. The project contract must bind typed intent, workflow, terminology, acceptance, boundaries, unknowns, provider/retention/delivery posture, and owner decisions without persisting raw owner text. Task packets must bind an opaque task and task-scope digest, the admitted role, applicable gate questions, effective graph evidence, parent library digests, and non-expanding authority. Upgrades must preserve project source, retain rollback evidence, and keep activation separate from compilation.

The accepted seed adds a canonical `agentos.layered_governance.v1` binding and a canonical `agentos.generated_task_role_packet.v1` projection. It also carries a newer Bootstrap question-map binding and cross-layer graph-path collision checks. The current worktree contains the prior compatibility envelope and older task-packet shape, so the seed delta is material to source identity, public API custody, and independent evidence comparison.

### Findings before repair

#### W-01 — canonical four-layer binding was not the public contract — repair required

The current public layered module exposed the preserved compatibility envelope under the old `agentos.layered_governance_contract.v1` shape. The authoritative checkpoint defines the canonical `agentos.layered_governance.v1` contract with exact four-layer order, seven digest bindings, additive-only precedence, typed migration status, inactive activation, and independent evidence requirements.

Why it matters: downstream checkers could bind to the compatibility record while missing the canonical project-contract/task-packet custody and layer semantics. The activation boundary and `2.1rc` inactive posture must remain explicit in the canonical public surface.

Builder action: add the accepted canonical binding as a feature-owned module, export it through the public facade, and retain the old implementation under explicit legacy names and schema custody. Do not activate or replace the compatibility history.

#### W-02 — generated task-role packet was stale and under-bound — repair required

The current public task packet binds only the generated-role library, task ID/kind, gate catalog/questions, graph IDs, and authority. The accepted checkpoint binds task scope, project contract, every parent library digest, role-packet digest, gate context and canonical question projections, effective graph digests, generation inputs, and an explicit authority-expansion rejection.

Why it matters: a task projection without task-scope and project-contract custody can be replayed or detached from the admitted project context, and a packet that does not carry parent/source evidence weakens least-privilege review.

Builder action: add the accepted `control/task-role-packet.mjs` compiler/validator and canonical schema; preserve the old packet compiler/validator as legacy compatibility APIs until downstream callers migrate.

#### W-03 — cross-layer graph namespace was still path-permissive — repair required

The current four-library foundation rejects graph-ID collisions in the established compile paths but does not reject a normalized `path_ref` collision between base-general, base-role, and project graphs whenever validated parent records are supplied. Rebase checks IDs but not paths. The accepted seed provides a shared namespace-collision helper and typed path conflict handling.

Why it matters: distinct graph IDs can still alias one governed source path, creating authority shadowing during validation or upgrade and violating additive-only composition.

Builder action: port only the feature-owned namespace helper and its validation/compile/rebase call sites, preserving the existing stronger safe-history path behavior. Add synthetic hostile path fixtures to the focused verifier without running it.

#### W-04 — canonical Bootstrap question-map binding is a shared-lane seam — deferred integration

The accepted seed’s canonical layered evidence comparison expects `conversation.question_map.map_sha256` and `projectContract.source_binding.question_map_sha256`. The current isolated Bootstrap conversation/contract modules and schemas predate that central binding. The inventory marks `BOOTSTRAP_PROJECT_CONTRACT` as another central-integration lane, and its accepted report records ownership of the overlapping Bootstrap surfaces.

Why it matters: the isolated candidate cannot honestly claim a combined conversation-to-contract question-map comparison until the owning Bootstrap source settles. Cross-editing those shared files would violate custody and could overwrite a newer semantic repair.

Disposition and exact recovery: record the seam and defer only the binding refresh. The owning Bootstrap lane must provide the settled conversation/contract pair; then rebase the feature-owned canonical binding against those exact fields, update the focused fixture, run the static re-audit, and leave functional execution pending under the approved test authority. This is not a true external blocker.

#### W-05 — focused verifier targeted superseded public signatures — repair required

The current `tests/verify-four-library-governance.mjs` calls the public task-packet and layered-contract names with the legacy argument shapes and asserts the legacy status/layer fields. Once the canonical seed surface is public, the verifier would exercise the wrong API and could fail to cover the accepted canonical contract.

Why it matters: a stale focused verifier gives false regression confidence at exactly the boundary where the new contract is meant to be independently checked.

Builder action: route existing compatibility assertions through explicit legacy exports, add canonical export/schema and hostile namespace assertions, and leave execution pending as instructed.

### Cross-cutting audit lenses

| Lens | Finding | Initial disposition |
| --- | --- | --- |
| Quality | W-01, W-02, W-05: public contract and verifier identities were not aligned with the accepted seed. | Repair required |
| Hygiene | W-01–W-03: legacy and canonical records needed explicit names so compatibility history is not mistaken for authority. | Repair required |
| Minimality | The repair can remain in the layered binding, task packet, graph namespace helper, schemas, focused verifier, and feature documentation. | Acceptable after scoped repair |
| Security | W-02 and W-03: detached task scope and graph-path aliasing weaken least privilege and additive-only composition. | Repair required |
| Privacy | No new private paths, credentials, provider tokens, task identities, or chat links are needed; opaque digests remain the boundary. | No source finding observed |
| Durability | Canonical migration/activation bindings preserve prepared/inactive state; history custody is retained and functional durability remains unverified. | Repair; tests pending |
| Regression | W-05 leaves the focused verifier pointed at superseded signatures until repaired. | Repair required |
| Custody | W-04 is owned by the Bootstrap lane; shared files remain untouched and the seam is explicit. | Defer integration |
| Boundary | The canonical task packet is disposable, the project contract is persistent, and activation remains a separate owner/checker decision. | Preserved |
| Intent | The accepted roadmap/documentation intent is four-layer governance with project-contract and task-scope custody; the question-map portion remains an explicit integration seam. | Repair and re-audit |

### Production readiness, blockers, and builder actions

Initial status: `NOT_READY_FOR_INDEPENDENT_CLEARANCE` for this wave. W-01,
W-02, W-03, and W-05 are ordinary in-scope implementation/coverage gaps and
must be repaired. W-04 is a custody seam, not a blocker. Missing owner-linked
research remains an evidence unknown carried forward from the prior report;
no record will be invented.

True blockers: none. Functional tests, schema-engine execution, hostile
runtime checks, and independent clearance are pending by instruction. If the
Bootstrap lane later withholds the settled question-map fields, recovery is
the exact owner-lane source readback and feature binding refresh described in
W-04; no ordinary implementation gap may be reclassified as a blocker.

Builder actions recorded before repair:

1. Add canonical task-packet and layered-binding modules from the named seed checkpoint.
2. Re-export canonical public names while preserving legacy compatibility history.
3. Add the feature-owned graph namespace/path hardening and hostile fixtures.
4. Preserve the Bootstrap shared-file seam and document its exact refresh condition.
5. Update the focused verifier and feature documentation, then perform static self-audit and re-audit without npm or functional tests.

Initial handoff for this wave: changed file is this append-only report only;
remaining findings are W-01 through W-05; next action is the scoped repair pass.

## Repair pass 1 and static self-audit — 2026-08-09

### Changed files and recorded self-audit finding

The builder repaired W-01 through W-03 and W-05 within the feature-owned
surface. During public module loading, the self-audit found one ordinary
source defect:

- `control/task-role-packet.mjs` imported
  `validateGeneratedProjectRoleLibrary` from the foundation even though the
  validator is owned by `control/four-library-operations.mjs`.

This was recorded as W-06, `RESOLVED_IN_SOURCE`, and was repaired by moving
the import to the operations module. No shared Bootstrap file was changed.

The repair set is:

- `control/task-role-packet.mjs` — canonical task/scope/project/library/gate
  binding and corrected validator custody;
- `control/layered-governance-binding.mjs` — canonical four-layer contract,
  activation, and evidence comparison;
- `control/layered-governance-contract.mjs` — explicit legacy compatibility
  names plus canonical re-exports;
- `control/four-library-governance.mjs` — canonical and legacy public exports;
- `control/four-library-foundation.mjs` and
  `control/four-library-operations.mjs` — graph ID/path namespace checks in
  validation, compilation, and rebase;
- `schemas/generated-task-role-packet.v1.json`,
  `schemas/layered-governance.v1.json`, and
  `schemas/layered-governance-check.v1.json` — canonical contracts;
- `schemas/legacy-generated-task-role-packet.v1.json` and
  `schemas/legacy-layered-governance-contract.v1.json` — preserved legacy
  contract custody;
- `docs/layered-governance.md` — canonical four-layer intent and W-04 seam;
- `tests/verify-four-library-governance.mjs` — legacy calls routed through
  explicit compatibility exports plus graph-path hostile fixtures; and
- `tests/verify-layered-governance.mjs` — canonical public/schema inventory
  coverage with no shared Bootstrap edits.

### Static evidence collected

- `node --check` passed for every changed control module and focused verifier.
- JSON parsing passed for all canonical and preserved legacy governance
  schemas.
- The first public module-load check exposed W-06; after the import repair,
  the public facade and canonical binding/task-packet modules must be loaded
  again before re-audit.
- No functional verifier, schema-engine run, npm command, activation, merge,
  push, release, deployment, or archive action was performed.

### Self-audit by lens

| Lens | Result |
| --- | --- |
| Quality | W-06 exposed and repaired at the module ownership boundary; canonical and legacy APIs are named distinctly. |
| Hygiene | Legacy schemas remain available under explicit legacy IDs; no compatibility record was silently overwritten. |
| Minimality | Changes remain inside layered/task contracts, the graph namespace seam, documentation, and focused verifiers. |
| Security | Task scope and parent digests are bound; graph IDs and normalized paths are checked across layers and upgrades. |
| Privacy | New records carry only opaque digests and normalized project-agnostic values; no private or secret material was added. |
| Durability | Migration/activation evidence remains typed and inactive; history code was preserved rather than weakened. |
| Regression | Compatibility assertions use legacy names, and canonical surface coverage is separate; execution remains pending. |
| Custody | Bootstrap question-map fields remain a deferred shared-lane seam; no cross-edit was made. |
| Boundary | The disposable task packet cannot expand authority, and `2.1rc` remains `PREPARED_NOT_ACTIVATED`. |
| Intent | The canonical docs, schemas, and public names now reflect the four-layer roadmap intent, subject to W-04 refresh. |

### Remaining findings and next action

W-01, W-02, W-03, W-05, and W-06 are resolved in source pending the final
static re-audit and functional verification. W-04 remains an explicit
deferred integration seam owned by the Bootstrap lane. Owner-linked research
provenance, functional tests, schema-engine execution, and independent
clearance remain evidence conditions, not blockers. Next action: rerun public
module loading, syntax/JSON/portability checks, then append the re-audit and
typed source-bound handoff.

## Re-audit 1 — 2026-08-09

### Finding disposition

| Finding | Re-audit result | Evidence | Remaining state |
| --- | --- | --- | --- |
| W-01 | Resolved in source | Canonical `agentos.layered_governance.v1` binding is present, publicly exported, four-layer ordered, digest-bound, migration-aware, and inactive by default. Legacy envelope names/schema remain explicit. | Functional and combined-source checks pending. |
| W-02 | Resolved in source | Canonical task packet binds task/task-scope, project contract, all four library digests, role packet, gate context/questions, effective graph evidence, generation inputs, and `authority_expansion: REJECT`. | Functional hostile checks pending. |
| W-03 | Resolved in source | Namespace collisions now compare graph IDs and normalized paths during base-role/project validation, compilation, and project rebase; typed path conflict fixtures are present. | Functional collision/rebase checks pending. |
| W-04 | Deferred shared-lane seam | Current Bootstrap modules intentionally remain unchanged; the canonical binding documents the required question-map fields and the feature verifier avoids claiming them until the owning lane settles its source. | Refresh required at central integration. Not a blocker. |
| W-05 | Resolved in source | Existing compatibility verifier calls use explicit legacy exports; the new canonical verifier checks canonical public names, legacy custody, schema inventory, and four-layer order. | Functional verifier execution pending. |
| W-06 | Resolved in source | Public module loading passed after moving the generated-role validator import to `four-library-operations.mjs`. | None beyond functional evidence. |

### Static evidence

- `node --check` passed for all feature control modules and focused verifiers.
- Every schema in the writable `schemas/` surface parsed as JSON.
- Public module loading passed for the canonical task packet, canonical
  layered binding, compatibility envelope, and public facade. Canonical and
  legacy schema identities were checked explicitly.
- The portability scan over the report, feature documentation, and governance
  schemas found no persisted private machine path, credential, provider
  token, task/session identity, or chat link.
- No new trailing whitespace was found in the repaired control, schema,
  documentation, or verifier files. Pre-existing trailing spaces in the
  preserved opening audit lines were not rewritten, maintaining append-only
  history custody.
- Functional tests, schema-engine validation, hostile runtime execution,
  upgrade/history execution, independent checking, npm, commit, push,
  activation, merge, release, deployment, and archive actions remain
  intentionally unperformed.

### Final readiness and unknowns

The feature-owned candidate is `PRODUCTION_CANDIDATE_PENDING_TESTS`. It is
deterministic, typed, content-addressed, project-agnostic, task-scoped,
least-privilege, privacy-bounded, four-layer bound, and prepared rather than
activated. The preserved legacy surface is explicit and cannot be confused
with the canonical authority contract.

The remaining evidence conditions are the requested functional/hostile/schema
checks, independent clearance, owner-linked research provenance, and the
central Bootstrap question-map binding refresh. None is a genuine external
blocker for this bounded source repair. Exact recovery for the shared seam is
the owning Bootstrap lane’s settled conversation/contract readback followed
by a feature-only binding/fixture refresh and static re-audit; no shared file
should be cross-edited here.

## Typed source-bound handoff — 2026-08-09

```json
{
  "schema": "agentos.layered_governance_handoff.v1",
  "status": "PRODUCTION_CANDIDATE_PENDING_TESTS",
  "feature": "ROADMAP_02_LAYERED_GOVERNANCE",
  "source": {
    "commit": "bd6c46253d921b94dd9b308ffaf93cfbcfe1bcac",
    "tree": "40d495f1599cd0b0f07de83748b74253b526b145"
  },
  "candidate": {
    "canonical_layered_schema": "agentos.layered_governance.v1",
    "canonical_task_packet_schema": "agentos.generated_task_role_packet.v1",
    "activation": "PREPARED_NOT_ACTIVATED",
    "functional_tests": "PENDING_BY_INSTRUCTION",
    "shared_bootstrap_question_map": "DEFERRED_OWNER_LANE_REFRESH"
  },
  "changed_paths": [
    "control/four-library-foundation.mjs",
    "control/four-library-operations.mjs",
    "control/four-library-governance.mjs",
    "control/layered-governance-binding.mjs",
    "control/layered-governance-contract.mjs",
    "control/task-role-packet.mjs",
    "docs/layered-governance.md",
    "schemas/generated-task-role-packet.v1.json",
    "schemas/layered-governance-check.v1.json",
    "schemas/layered-governance.v1.json",
    "schemas/legacy-generated-task-role-packet.v1.json",
    "schemas/legacy-layered-governance-contract.v1.json",
    "tests/verify-four-library-governance.mjs",
    "tests/verify-layered-governance.mjs",
    "docs/feature-audits/ROADMAP_02_LAYERED_GOVERNANCE/auditreport.md"
  ],
  "true_blocker": null,
  "next_action": "Run the focused functional and independent verification pass on the exact candidate after the owner-lane Bootstrap binding refresh; append any result without rewriting this history."
}
```

## Handoff preservation and consumption receipt — 2026-08-09

The typed handoff above is preserved in the append-only feature audit and was
read back against the authoritative checkpoint, canonical public export
surface, repaired changed-path set, inactive activation state, and explicit
Bootstrap custody seam. Consumption result: `ACCEPTED_FOR_DOWNSTREAM_REVIEW`.
The handoff does not authorize tests, activation, merge, release, push, or
archive. The visible task may close this goal with functional tests and the
owner-lane binding refresh still pending as recorded evidence conditions.

## Central integration intake — 2026-08-09 (Layered Governance handoff)

- visible_task_ref: `TASK_REF_ROADMAP_02_LAYERED_GOVERNANCE_VISIBLE`
- isolated_worktree_ref: `WORKTREE_REF_CD69`
- source_head: `bd6c46253d921b94dd9b308ffaf93cfbcfe1bcac`
- source_tree: `40d495f1599cd0b0f07de83748b74253b526b145`
- isolated_report_sha256: `404960b8478d0d2cdb71add67cf8bb085a404b52754b112dc5d220567c211b92`
- central_disposition: `SOURCE_BOUND_CANDIDATE_INTEGRATED_PENDING_STATIC_REVIEW`
- changed_path_disposition: `ONLY_TYPED_HANDOFF_PATHS_INTEGRATED; UNRELATED_LANE_FILES_RETAINED_AT_BASELINE`
- functional_status: `NOT_RUN_BY_INSTRUCTION`
- activation_status: `PREPARED_NOT_ACTIVATED`
- archive_status: `WITHHELD_UNTIL_DOWNSTREAM_REVIEW`

The Controller consumed the typed handoff after checking its source checkpoint
and changed-path list. Static syntax, schema parsing, module loading, privacy
scan, and diff hygiene passed. Functional execution, activation, release,
push, and archive remain outside this intake.
