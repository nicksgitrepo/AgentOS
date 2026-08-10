# ROADMAP_07_PROOF_ACCEPTANCE — Proof-Carrying Work and Whole-Project Acceptance

Status: `AUDIT_RECORDED_BUILDER_ACTIVE`

Contract status: `PREPARED_NOT_ACTIVATED`

This report is append-only. It records the audit of the current accepted merge
before repair, the bounded repair performed in this isolated worktree, and the
subsequent self-audit and re-audit. It is evidence and a handoff, not a release
activation or acceptance decision.

## Baseline and scope

The read-only authority was the current accepted merge selected by the parent
cycle. Its exact committed identity was:

- source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- committed source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- accepted-merge working-tree status entries: `291`
- accepted-merge status-list SHA-256: `5f2ff0df76d6e7d63d65f603b0f07268f908e03e1e2524306d059897153ed795`

The accepted merge contains uncommitted tracked and untracked merge material;
the commit/tree pair above is therefore not a clean snapshot of all authority
read. The working-tree status digest and count are retained so this limitation
cannot be mistaken for a clean release identity. No accepted-merge file was
written. All builder changes are confined to this worktree.

The authoritative inventory read was `docs/feature-inventory.v1.json` from the
accepted merge. It declares 37 named capabilities, 12 governance lanes, 49
auditor tasks, and 49 reports, with `ROADMAP_07_PROOF_ACCEPTANCE` mapped to
`docs/feature-audits/ROADMAP_07_PROOF_ACCEPTANCE/auditreport.md`.

## Audit pass 1 — intent, implementation, and findings

Audit date: `2026-08-07`  
Audit mode: read-only source inspection and static comparison  
Functional tests: pending by instruction; npm was not used.

### Authority and intent read

The audit read the complete roadmap context and the ROADMAP_07 source set:

- `docs/roadmap.md`, including the capability promise, done conditions,
  Phase 2 exit gate, status-change rules, and inactive/activation boundaries.
- `schemas/feature-completeness.v1.json` and its controller contract for a
  source-bound feature map, independent classification report, and fresh
  Auditor seed.
- `schemas/repair-receipt.v1.json`, plus the linked repair governance and
  recovery contracts, for bounded repair, preserved predecessor evidence,
  independent verification, rollback, and inactive status.
- `control/feature-completeness.mjs`, the accepted-merge implementation of the
  feature-map/report/seed primitives.
- Existing typed handoff, acceptance, evidence, source-identity, and repair
  material in `control/`, `schemas/`, `docs/rapid-foundations/`, and
  `governance/2.1rc/`.
- The public rapid-foundation intent for functionality, evidence and identity,
  security/privacy, and recovery/boundaries. Owner-linked research records are
  referenced by the inventory but are not available in this public repository;
  their content was not guessed or copied.

### Intended behavior

ROADMAP_07 requires every candidate change to carry a reproducible proof
capsule containing exact starting source state, claimed scope, dependencies,
environment, checks and results, rollback information, invalidation
relationships, residual risk, and a typed handoff. The proof must be
content-addressed and remain inactive until independently checked.

Evidence must distinguish direct observation, derived result, unavailable
result, and unverified assertion. A source or dependency change must invalidate
affected claims and name the rechecks rather than silently reusing stale proof.

Whole-project acceptance must enumerate every promised capability from the
canonical inventory, classify each exactly once as checked, partial, missing,
owner-choice-only, or not needed, attach source-bound evidence, and route
partial or missing work to the Campaign Orchestrator and owner-choice work to
the owner. The Auditor must be independent of the builder and acceptor, and a
clean-checkout reproduction must remain possible. `2.1rc` and all protected
actions remain prepared/inactive.

### Actual implementation observed

The accepted merge has useful but incomplete support:

- `control/feature-completeness.mjs` deterministically compiles and validates
  an abstract feature map, a public Auditor classification report, a checked
  Auditor seed, and a fresh Auditor binding. It binds commit/tree identity,
  content-addresses records, requires one classification per mapped feature,
  routes partial/missing/owner-choice statuses, rejects unsafe public paths,
  and rejects Auditor self-building or self-acceptance.
- `schemas/feature-completeness.v1.json` states the map/report/seed contract and
  keeps it `PREPARED_NOT_ACTIVATED`.
- Existing campaign and foundation handoffs carry several source-bound checks,
  evidence digests, rollback identities, and independent-check boundaries.
- `schemas/repair-receipt.v1.json` and linked repair governance provide a
  bounded inactive governance-repair receipt with preserved predecessor
  evidence, safety-floor and protected-action constraints, and independent
  verification requirements.
- Existing acceptance bridges prove a bounded acceptance tree, but they do not
  describe every roadmap feature or a candidate's dependency graph.

### Missing gaps and why they matter

#### F-07-001 — No candidate proof capsule

Evidence: the feature-completeness contract contains only map/report/seed
fields; the accepted merge has no ROADMAP_07 candidate-level schema or
controller that binds starting state, scope, dependencies, environment,
checks/results, rollback, invalidation, residual risk, and a typed handoff in
one digest.

Impact: a typed handoff or governance patch receipt can be valid while the
candidate claim itself cannot be reproduced or compared as one bounded proof.
This leaves the Phase 2 exit gate open.

Disposition: repair in this worktree with a project-agnostic proof-capsule and
evidence contract. Do not change product code or protected actions.

#### F-07-002 — Whole-project coverage is not bound to the canonical inventory

Evidence: the accepted-merge inventory declares 37 capabilities plus 12
governance lanes and 49 reports, while `control/feature-completeness.mjs`
accepts any caller-supplied feature list. No validator enforces inventory
parity, one report path per inventory feature, or the 37/12/49 coverage rule.

Impact: an incomplete or reduced feature map could be presented as whole-
project coverage without detecting omitted capabilities or lanes.

Disposition: repair with inventory validation and a deterministic compiler
adapter. The inventory remains input data and is not activated or rewritten.

#### F-07-003 — Dependency invalidation is not represented

Evidence: existing repair receipts bind a repair proposal and checkpoint, but
there is no candidate dependency claim, dependency digest, invalidation graph,
or derived recheck list for a changed dependency. Existing acceptance
invalidation is limited to its own question/tree contracts.

Impact: stale evidence may be reused after a dependency or source change, and
the Auditor cannot tell which claims must be rechecked.

Disposition: repair with explicit dependency claims, invalidation rules, and a
fresh-capsule requirement after invalidation.

#### F-07-004 — Evidence kind is not typed at the ROADMAP_07 boundary

Evidence in the generic completeness path is an opaque `kind` string and does
not enforce the four required dispositions: direct observation, derived result,
unavailable result, and unverified assertion.

Impact: a caller can label an assertion as a check without preserving the
difference between observed proof and an unavailable or unverified result;
whole-project acceptance would be vulnerable to narrative-only promotion.

Disposition: repair with a closed evidence-kind set and status rules. An
unavailable or unverified item must never satisfy a checked classification.

#### F-07-005 — Readiness evidence is incomplete

Evidence: the accepted merge is dirty and functional tests were explicitly
left pending. No independent clean-checkout reproduction or functional hostile
run was available to this task.

Impact: this is a real production-readiness limitation, but it is not an
external blocker to implementing the contracts. The candidate must remain
pending tests and independent acceptance.

Disposition: preserve as a remaining finding; do not claim functional pass,
release readiness, activation, merge, push, deployment, or publication.

### Cross-cutting audit lenses

| Lens | Finding | Repair disposition |
| --- | --- | --- |
| Quality | Generic map/report primitives are deterministic, but the candidate proof boundary is absent. | Add one minimal capsule controller and exact-key validation. |
| Hygiene | Accepted merge is uncommitted; no npm/runtime dependency is introduced. | Preserve identity/status evidence; keep changes isolated. |
| Minimality | Existing contracts should be reused as inputs; do not copy product context or rebuild unrelated campaign code. | Add only ROADMAP_07 schemas/controllers and verifier fixtures. |
| Security/privacy | Public-reference checks exist, but capsule fields need safe relative refs and must reject secrets, private paths, chat links, and provider tokens. | Enforce a public-reference boundary and safe summaries/digests. |
| Durability | Existing repair records preserve predecessor evidence, but candidate proof/invalidation history is absent. | Add append-only invalidation records and preserved predecessor digests. |
| Regression | Source/tree binding is present in generic records; dependency changes are not. | Require exact source/dependency identities and fresh rechecks. |
| Custody | Auditor self-build/self-acceptance is rejected in the generic report; capsule acceptance is not yet bound to an independent Auditor. | Require distinct builder, Auditor, and acceptor identities. |
| Boundary | Protected actions remain disabled and `2.1rc` remains inactive. | Keep all new contracts inactive and product/external writes forbidden. |
| Intent | Roadmap intent is explicit; owner-linked research details are unavailable and must not be inferred. | Record unknowns without widening scope or inventing policy. |

### True blockers and recovery

There is no genuine external blocker. The unavailable owner-linked research
records and pending functional tests are evidence limitations, not authority or
host failures that prevent this bounded repair.

Exact recovery for the remaining readiness hold: on a clean checkout of the
repaired candidate, run the focused proof-capsule, inventory-parity, hostile
privacy/invalidation, and whole-project verifiers; then run the repository's
functional checks without npm; independently compare the results to this
report and the exact source/dependency identities; preserve any failure as a
new finding and recheck only its affected claims. Keep activation pending until
the owner records the required decision.

### Builder actions recorded

1. Add a content-addressed proof-carrying-work schema and controller with the
   four evidence kinds, candidate fields, typed handoff, protected inactive
   boundary, and exact source/dependency binding.
2. Add deterministic dependency invalidation and named recheck derivation.
3. Add canonical inventory validation and a whole-project compiler adapter that
   enforces the 37/12/49 parity rule without copying private context.
4. Add focused hostile verifier coverage as pending evidence; do not run it in
   this task because functional tests remain pending by instruction.
5. Append a self-audit and re-audit after the repair. Leave any test or clean-
   checkout limitation visible in the final handoff.

### Initial handoff

Disposition: `REPAIRABLE_IMPLEMENTATION_GAPS`  
Next action: implement the four recorded repairs in this isolated worktree,
then self-audit and re-audit the exact changed surface.  
Acceptance: not claimed.  
Activation: not allowed.

## Repair pass 1 — bounded implementation

Repair date: `2026-08-07`  
Repair scope: only F-07-001 through F-07-004, as recorded above.  
External actions: none.  
Functional tests: still pending; npm was not used.

### Changed files

- `control/content-addressing.mjs` — small project-agnostic canonical JSON
  and SHA-256 primitive used by the new contracts.
- `control/proof-carrying-work.mjs` — source/scope/environment/dependency/
  check/evidence/claim/rollback/handoff capsule compiler and validator;
  closed evidence kinds; independent-custody checks; source, environment,
  scope, and dependency invalidation with named rechecks and preserved prior
  claim states.
- `control/feature-completeness.mjs` — source-bound map/report/seed contract
  plus authoritative inventory validation and 37/12/49 coverage-plan
  compilation.
- `schemas/proof-carrying-work.v1.json` — inactive proof capsule schema.
- `schemas/feature-completeness.v1.json` — inactive whole-project contract
  with the canonical inventory parity rule.
- `schemas/digest-bound-checkpoint.v1.json` and
  `schemas/repair-receipt.v1.json` — portable inactive repair/checkpoint
  schema references required by the ROADMAP_07 source set.
- `tests/verify-proof-carrying-work.mjs` and
  `tests/verify-feature-completeness.mjs` — focused future verifier fixtures;
  not executed in this task.
- This append-only report.

### Repair evidence

- `node --check` passed for both new controllers and both focused verifier
  files. This is a syntax/readability check, not functional acceptance.
- `jq empty` parsed all four new JSON schemas successfully.
- `git diff --check` reported no whitespace errors.
- Static reference scanning found no private machine path, credential value,
  provider token, chat link, or external URL in the new implementation or
  report. Standard JSON Schema URIs remain metadata, not runtime authority.
- The proof controller keeps all protected actions false, requires a distinct
  builder and independent Auditor, rejects an Auditor as acceptor, enforces
  project-relative evidence references, and keeps every capsule inactive.
- The completeness controller rejects inventory counts other than the
  authoritative 37 capabilities, 12 governance lanes, 49 auditors, and 49
  reports; it also rejects duplicate IDs/report paths and compiles all report
  paths from the inventory rather than a caller-selected subset.
- Invalidation records carry the predecessor capsule digest, affected claims,
  required rechecks, prior claim statuses, source/environment/scope triggers,
  and a new content digest. A changed dependency cannot be silently reused.

## Self-audit pass 1

Self-audit date: `2026-08-07`  
Self-audit result: `REPAIR_SCOPE_MATCHES_RECORDED_FINDINGS`

The changed surface remains limited to ROADMAP_07 proof, completeness,
repair/checkpoint schemas, focused verifier fixtures, and this report. No
product context, provider account, private path, credential, task identity,
deployment identity, or external action was added. The repair does not alter
the prepared/inactive `2.1rc` boundary.

The self-audit found and corrected two implementation details before the
re-audit: inventory order is preserved while uniqueness is enforced, and
environment/scope invalidations are covered in addition to source and
dependency changes. Evidence and dependency back-references now have to point
to existing claims/checks, preventing detached proof fragments.

Remaining readiness limitations are intentionally unchanged: the accepted
merge baseline is dirty, the authoritative inventory still reports feature
task/report creation as pending, and functional tests plus clean-checkout
reproduction have not been run. These limitations keep the candidate pending;
they do not authorize a blocker or a false acceptance claim.

## Re-audit pass 1

Re-audit date: `2026-08-07`  
Re-audit result: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_AND_INDEPENDENT_CHECKS`

### Findings disposition

| Finding | Re-audit result | Evidence |
| --- | --- | --- |
| F-07-001 candidate proof capsule | Resolved at the contract/controller boundary. | `schemas/proof-carrying-work.v1.json`, `control/proof-carrying-work.mjs` |
| F-07-002 inventory-bound whole-project coverage | Resolved at the compiler boundary; actual cross-project task/report parity remains pending. | `control/feature-completeness.mjs`, `schemas/feature-completeness.v1.json` |
| F-07-003 dependency and source invalidation | Resolved with source/environment/scope/dependency rules, predecessor digest, prior statuses, and named rechecks. | `control/proof-carrying-work.mjs` |
| F-07-004 typed evidence dispositions | Resolved with closed evidence kinds and claim/check status constraints. | `control/proof-carrying-work.mjs`, `schemas/proof-carrying-work.v1.json` |
| F-07-005 functional/clean-checkout readiness | Remaining, explicitly pending. | No functional test or independent clean-checkout run was performed. |

### Re-audited quality and boundary lenses

- Quality/minimality: the new code is isolated, deterministic, and limited to
  the recorded ROADMAP_07 gaps; no unrelated runtime was modified.
- Hygiene/durability: content digests, exact keys, sorted collections, prior
  invalidation states, and inactive statuses are preserved. The worktree is
  intentionally uncommitted and is not described as release-ready.
- Security/privacy: public references are project-relative; secret-like
  summaries, private segments, chat links, and protected actions are rejected
  or disabled. No sensitive value was recorded.
- Regression: source commit/tree and dependency digests are required; stale
  source/dependency readback raises a failure and invalidation names rechecks.
- Custody/boundary: the builder, Auditor, and acceptor cannot collapse into
  one identity; no function grants acceptance, activation, merge, push,
  deployment, publication, spending, deletion, or authority change.
- Intent: the roadmap's proof/coverage promise is represented without
  inferring owner-linked research or activation decisions.

### Remaining findings and exact next action

Remaining finding: `F-07-005` only — functional verification, hostile runtime
execution, and clean-checkout independent reproduction are pending. The
authoritative inventory's cross-project parity also remains a parent-cycle
coordination fact, not a reason to weaken this feature's compiler.

Exact next action: on a clean checkout, run the two focused ROADMAP_07
verifiers and the repository functional checks without npm; independently
re-read the source/dependency bindings and this report; preserve any failure
as an append-only finding and invalidate only affected claims. If those checks
pass, hand the inactive candidate to the independent Auditor for acceptance
review. Do not activate `2.1rc` or perform external delivery.

Final handoff: `PRODUCTION_CANDIDATE_PENDING_TESTS_AND_INDEPENDENT_AUDIT`  
True blocker: `NONE`  
Acceptance/activation: `NOT_CLAIMED` / `NOT_ALLOWED`

## Central intake cycle — reconciled proof acceptance — 2026-08-09

The visible ROADMAP_07 task completed a second shared-surface repair after the
first intake comparison found stale privacy, verifier, checkpoint, and
inventory-contract bytes. The final handoff commit is
`aacda08b9e925af05cc1ed0d1cd8a92a9d9f3c2e` with tree
`a2b5bde38200febc25e0396ef94784b0f8886533`; its report preservation commit is
`ebf5743d5cea75b86845b2d115c7413c9f01885d`.

Central applied only compatible proof and inventory additions:

- `control/proof-carrying-work.mjs` adds an inactive, source-bound proof
  capsule boundary with generation freeze, typed current state, seam and
  cumulative-compatibility ceilings, invalidation, and constant-false
  downstream custody;
- `schemas/proof-carrying-work.v1.json` and
  `tests/verify-proof-carrying-work.mjs` bind that contract and its focused
  static/hostile evidence;
- `control/feature-completeness.mjs` adds inventory/coverage validation for the
  authoritative 37 capabilities, 12 governance lanes, zero platform lanes,
  and 49 auditor/report/goal parity while retaining the central privacy guard;
- `tests/verify-feature-completeness.mjs` adds those inventory/coverage
  assertions without replacing the exhaustive central verifier; and
- the existing feature-completeness, checkpoint, repair-receipt, content-
  addressing, and privacy surfaces remain central-compatible byte-for-byte.

The pre-intake bytes are preserved in
`central-intake-preservation-manifest-2026-08-09.md`. The inventory remains
source-bound and platform-domain discovery remains empty; no platform lane was
invented. Disposition: `CENTRAL_INTEGRATED_PENDING_INDEPENDENT_REAUDIT`.
The visible task and isolated worktree remain preserved and unarchived;
`downstream_consumed=false`.

Static syntax, JSON, diff-hygiene, privacy, and inventory-shape evidence passed
in the visible lane. Functional focused verifiers, clean-checkout proof,
independent acceptance, cumulative compatibility, commit/push, activation,
release, deployment, and archive actions remain pending. No true blocker was
found.
