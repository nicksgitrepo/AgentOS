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
