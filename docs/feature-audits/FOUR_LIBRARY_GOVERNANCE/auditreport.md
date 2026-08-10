# FOUR_LIBRARY_GOVERNANCE — Four-Library Governance Composition

This report is append-only. It records the audit, the bounded builder repairs,
the self-audit, and the re-audit for this feature.

## Pass 0 — initial audit — 2026-08-07

### Scope and source binding

- Inventory feature: `FOUR_LIBRARY_GOVERNANCE` / Four-Library Governance Composition.
- Inventory contract status: `PREPARED_NOT_ACTIVATED`.
- Read-only authority: `CURRENT_ACCEPTED_MERGE`.
- Authority source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`.
- Authority source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- The accepted merge worktree is dirty and contains the feature as uncommitted
  additions; it was inspected without changing it. The writable worktree began
  at the same commit but did not contain those accepted additions.
- No npm command was used. Functional tests remain pending by instruction.

### Intended behavior

The roadmap and architecture intent require four distinct governance layers:

1. portable release-owned base general governance;
2. release-owned base-role governance derived against the base general layer;
3. project-owned persistent general governance that is additive only; and
4. disposable generated project-role governance compiled from the three inputs.

The composition must be deterministic, content-addressed, least-privilege, and
source-bound. Project governance must not override base authority, generated
packets must not expand authority, and upgrades must preserve project-owned
source while detecting graph conflicts and retaining rollback/history evidence.
Statuses, ownership, lineage, independent-check and owner-decision evidence,
activation, and the prepared-but-inactive `2.1rc` boundary must remain explicit.

The four source schemas define the record shapes. The roadmap's layered
governance and release-safety sections define precedence, generated packets,
upgrade review, and activation separation. The architecture-repair plan and
its accepted evidence provide the linked research/implementation intent for
portable deterministic libraries, generated role packets, hostile validation,
and public secret-free boundaries. The inventory's
`research-records-linked-by-owner` item is a symbolic source reference; no
owner-linked research record was present in the public checkout, so research
provenance cannot be claimed beyond the checked roadmap and typed evidence.

### Actual implementation observed in the authority worktree

The accepted slice contains:

- `control/four-library-foundation.mjs` — canonicalization, digests, portable
  validation, ownership/lifecycle rules, graph and role validation, and base or
  project compilation;
- `control/four-library-operations.mjs` — generated-role compilation, binding,
  status transitions, rebasing, and upgrade preparation;
- `control/four-library-history.mjs` — append-only JSONL project governance
  history;
- `control/four-library-governance.mjs` — the public feature facade;
- the four library schemas plus binding, migration, conflict, and history
  schemas; and
- `tests/verify-four-library-governance.mjs` — deterministic, ownership,
  conflict, upgrade-preservation, hostile path, lifecycle, and append-only
  history coverage.

The accepted public entrypoint also exposes the feature and the accepted
runtime facade mounts all four library digests. The focused verifier was read
for intent and coverage but was not run.

### Findings

#### F-001 — broken exported history digest helper — repair required

`control/four-library-history.mjs` exports `canonicalDigest()` but calls
`digest()` without importing or defining it. The facade's separate export masks
the defect in the current focused test, but a direct caller of the history
module fails at runtime. This breaks a public history utility and weakens
durability evidence for the append-only custody path.

Evidence: `control/four-library-history.mjs:6-22,136-138`.

Builder action: re-export the foundation canonical digest implementation and
add a focused regression assertion for the history module's public helper.

#### F-002 — cross-library graph namespace is not fully fail-closed — repair required

The compiler rejects project/base graph-ID collisions, but supplied validated
records can still carry a base-role graph ID collision unless the caller used
the compiler path, and graph `path_ref` collisions across base general,
base-role, and project-general layers are not rejected at all. A different ID
pointing at an already-governed path can shadow or ambiguously resolve a graph,
contradicting additive-only composition and the `base_override: REJECT`
policy. Rebase checks IDs only, so the same ambiguity can appear during upgrade.

Evidence: `control/four-library-foundation.mjs:478-487,521-609` and
`control/four-library-operations.mjs:299-319,345-368`; the schemas declare
precedence and graph IDs but do not by themselves enforce cross-layer path
disjointness.

Builder action: enforce cross-layer graph-ID and normalized-path disjointness
whenever parent libraries are supplied; emit typed conflicts from compilation
and apply the same checks during rebase. Add hostile regression fixtures for
both ID and path aliasing.

#### F-003 — documentation intent still names the superseded two-library model — repair required

`docs/architecture.md` describes only the older general and role-specific
libraries, while the roadmap and accepted implementation describe four
distinct layers. The control and schema indexes also do not make the four
library facade and its contracts easy to discover. This creates an operator and
maintainer ambiguity about which source is authoritative and risks future
changes being made to the compatibility pair instead of the four-library
composition.

Evidence: `docs/architecture.md:16-25`, `control/README.md`, and
`schemas/README.md` versus `docs/roadmap.md:89-109` and the four-library
source files.

Builder action: add a concise four-library composition section and enumerate
the canonical feature entrypoint and schema contracts in the relevant indexes;
retain the older two-library modules only as compatibility history where the
documentation says so.

#### F-004 — accepted feature slice is absent from the writable candidate — repair required

The writable worktree has none of the accepted four-library source, schema, or
focused verifier files even though the read-only authority contains them as
the accepted merge implementation. Without porting only these feature-owned
files, the builder cannot produce a candidate or preserve the accepted
behavior for repair. This is a worktree reproducibility gap, not permission to
copy unrelated merge work.

Builder action: add the four feature modules, eight feature contracts, and
focused verifier from the read-only authority, then apply only F-001 through
F-003 and record the exact changed-path set.

#### F-005 — owner-linked research evidence is unavailable — evidence gap, not blocker

The inventory requests owner-linked research records, but the inspected public
source exposes only the symbolic link and typed architecture-repair evidence.
No private or owner record will be invented or copied into the public report.
This keeps research provenance unproven and limits independent clearance, but
does not block the bounded code repair. Exact recovery is for the owner/control
plane to provide the linked record or mark the research source unavailable;
then re-audit the intent trace without changing the portable kernel.

### Cross-cutting audit lenses

| Lens | Finding | Initial disposition |
| --- | --- | --- |
| Quality | The layer split, deterministic digests, lifecycle evidence, and typed conflict records are clear; F-001 is a direct runtime defect. | Repair required |
| Hygiene | Public records use relative graph references and hostile fixtures are synthetic; the writable candidate lacks the accepted files and documentation index coverage. | Repair required |
| Minimality | The feature is split into foundation, operations, history, and facade modules; repairs can stay within the feature plus its two small indexes. | Acceptable after scoped port |
| Security | Ownership, authority non-expansion, path normalization, and private-text rejection exist; cross-layer path aliasing remains an authority-shadowing route. | Repair required |
| Privacy | No private paths, credentials, provider identities, or chat links are needed or present in the feature payload. | No finding observed |
| Durability | Digests, lineage, rollback references, and append-only JSONL exist; F-001 and the untested cross-layer namespace boundary weaken the claim. | Repair and tests pending |
| Regression | Focused hostile and transition coverage exists but does not cover F-001 or cross-layer path/validated-record aliasing. | Add regression coverage; tests pending |
| Custody | Project history is confined to a caller-supplied control root and uses append-only writes; concurrent custody behavior remains unverified. | Evidence pending |
| Boundary | Compilation and activation are separate; `2.1rc` remains prepared/inactive. | Preserved |
| Intent | Roadmap intent is four-layer composition and upgrade preservation; documentation drift and missing owner-linked research evidence obscure traceability. | Repair docs; preserve unknown |

### Production readiness and blockers

Initial status: `NOT_READY_FOR_INDEPENDENT_CLEARANCE`.

There is no genuine external blocker. All recorded implementation and
documentation findings are ordinary in-scope repairs. Functional tests,
JSON-schema execution, hostile runtime checks, and independent clearance
remain pending by instruction. The exact recovery for the evidence gap is an
owner/control-plane research record or an explicit unavailable disposition;
it is not a reason to invent evidence or stop the bounded repair.

### Builder handoff

1. Port only the accepted four-library feature files into this worktree.
2. Repair F-001 and F-002 in the executable layer and focused verifier.
3. Repair F-003 in the architecture/control/schema indexes.
4. Run static syntax and scope/hygiene checks only; do not run functional tests.
5. Append a self-audit and re-audit with changed files, evidence, remaining
   findings, and the next action.

## Pass 1 — builder self-audit — 2026-08-07

### Changed files

The writable candidate now contains only the accepted feature slice and the
recorded documentation/report surfaces:

- `control/four-library-foundation.mjs`
- `control/four-library-operations.mjs`
- `control/four-library-history.mjs`
- `control/four-library-governance.mjs`
- `schemas/base-general-library.v1.json`
- `schemas/base-role-library.v1.json`
- `schemas/project-general-library.v1.json`
- `schemas/generated-project-role-library.v1.json`
- `schemas/governance-binding.v1.json`
- `schemas/governance-migration.v1.json`
- `schemas/governance-conflict.v1.json`
- `schemas/project-governance-history-entry.v1.json`
- `tests/verify-four-library-governance.mjs`
- `docs/architecture.md`
- `control/README.md`
- `schemas/README.md`
- `docs/README.md`
- `docs/feature-audits/FOUR_LIBRARY_GOVERNANCE/auditreport.md`

No unrelated implementation, governance, product, provider, or deployment
file was changed.

### Repair evidence

- F-001: `four-library-history.mjs` imports and re-exports the foundation
  `canonicalDigest`; the focused verifier now directly imports that history
  export. There is no remaining undefined `digest()` reference in the history
  module.
- F-002: `graphNamespaceCollisions()` deterministically compares IDs and
  normalized paths. Base-role validation and compilation reject collisions with
  base-general graphs; project-general validation and compilation reject
  collisions with both base layers; rebase rejects both collision classes with
  typed conflict records. New focused fixtures cover base-role path collision,
  project path collision, and a forged validated base-role record.
- F-003: `docs/architecture.md` now states the four-layer authority flow and
  compatibility status; the control, schema, and documentation indexes name
  the canonical facade and contracts.
- F-004: the feature modules, eight contracts, focused verifier, and report are
  present in this worktree. Read-only comparison against the authority shows
  the feature files were ported unchanged except for the recorded repairs and
  regression fixtures.

### Static checks performed

- `node --check` passed for the four feature modules and focused verifier.
- `jq empty` passed for all eight feature contracts.
- `git diff --check` passed.
- A targeted public-boundary scan found no absolute machine paths, credential
  assignments, chat/file links, or secret-like values in the changed feature,
  schema, documentation, or report surfaces.
- Functional verifiers and the full suite were not run. No npm command was used.

### Self-audit by lens

| Lens | Self-audit result |
| --- | --- |
| Quality | Repairs are centralized in the foundation namespace helper; operations consume the same helper rather than duplicating rules. |
| Hygiene | New hostile fixtures are synthetic, relative, and confined to the focused verifier; no generated records or runtime state were added. |
| Minimality | The repair adds one shared collision helper, typed conflict branches, one history import/export correction, and focused coverage; schemas were not widened. |
| Security | A project or role graph can no longer alias a base graph by ID or path when the parent records are bound. |
| Privacy | Conflict resolutions expose only already-relative graph references; portable scans remain clean. |
| Durability | History digest callers are repaired and lineage/history behavior is preserved; append concurrency remains a runtime evidence item. |
| Regression | Existing accepted fixtures were retained; new collision and direct-export cases are present but not executed. |
| Custody | The history writer remains control-root confined and append-only; host-level multiwriter behavior is still unverified. |
| Boundary | No activation, merge, push, deployment, release, provider, or external write was attempted. |
| Intent | Documentation now agrees with the roadmap's four distinct layers; owner-linked research provenance remains explicitly unknown. |

## Pass 2 — re-audit after repair — 2026-08-07

### Finding disposition

- `F-001`: `RESOLVED_IN_SOURCE_PENDING_FUNCTIONAL_CHECK`. The missing binding
  is repaired and directly covered; runtime execution is intentionally pending.
- `F-002`: `RESOLVED_IN_SOURCE_PENDING_FUNCTIONAL_CHECK`. Cross-layer ID/path
  checks now apply in validation, compilation, and upgrade rebase; hostile
  execution is intentionally pending.
- `F-003`: `RESOLVED_IN_DOCUMENTATION`. Architecture and indexes identify the
  four-library source of authority and the compatibility boundary.
- `F-004`: `RESOLVED_IN_WRITABLE_SCOPE`. The candidate contains the complete
  accepted feature slice plus only recorded repairs.
- `F-005`: `OPEN_EVIDENCE_UNKNOWN`, not an external blocker. The owner/control
  plane must provide the linked research record or an explicit unavailable
  disposition before independent clearance can claim complete research
  provenance. No public secret, private path, credential, or chat link was
  added to compensate.

### Remaining findings and readiness

The implementation is a production candidate pending functional tests and
independent clearance. Remaining evidence items are bounded and honest:

1. Run the focused feature verifier and schema-aware checks on this exact
   candidate; exercise the new digest, namespace, collision, rebase, history,
   lifecycle, and hostile-boundary cases.
2. Run the broader repository checks when the parent cycle authorizes functional
   execution; preserve any failure evidence before repair.
3. Resolve or explicitly classify the owner-linked research-record reference.
4. Independently review the candidate without using the builder identity for
   clearance. Activation remains a separate owner decision.

No true blocker is present. Exact recovery for the only unresolved intent
evidence is the owner/control-plane research record or a typed unavailable
record; the next technical action is the pending functional verifier.

## Central-intake audit append — FOUR_LIBRARY_GOVERNANCE — 2026-08-09

### Intake

The preserved candidate is the abstract feature-owned `FOUR_LIBRARY_GOVERNANCE` source candidate at baseline commit `590c07ddd4be7a8c24727c24b40808e44ca7357` and tree `f1b358d87e6a969fb9631e202a3d478540edd4d9`; it is dirty and uncommitted. Authority hashes remain `a882a74b6a71ba1fe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d` and `3cef7fcb7897ad44f7975c1c6cb50cd20ca82cfa1ce1c3c8849c18de9aedda10`. The preserved candidate report hash before this append is `c57765ba02242f4aa09c86559edba67ddb3f662bdf719970a756279b6d8ba2d8`.

### Exact repair delta and central reconciliation

- `control/four-library-foundation.mjs`: retained helper-based base-role graph ID/path collision handling and project graph namespace checks.
- `control/four-library-operations.mjs`: retained rebase-time project graph ID/path collision rejection.
- `control/four-library-history.mjs`: now re-exports the canonical foundation digest helper.
- `tests/verify-four-library-governance.mjs`: added digest-export, base-role path, project path, and forged-record hostile fixtures.
- Four-library facade and contracts were retained; shared README and architecture documentation were merged additively to preserve newer central content.
- The preservation manifest was retained before downstream use. `downstream_consumed=false`.

### Static evidence and disposition

The lane’s static self-audit passed: five JavaScript sources parsed, eight schemas parsed, diff/trailing-whitespace checks, portable-boundary and secret-pattern scans, and exact 19-path custody verification. Functional tests and package-manager commands remain pending by instruction. No commit, push, release, deployment, activation, archive, or live-host action occurred.

Central binding projection and final static readback remain pending. Readiness is `CENTRAL_INTEGRATION_PENDING_STATIC_REAUDIT_AND_FUNCTIONAL_PROOF`; lifecycle remains `PREPARED_NOT_ACTIVATED`.
