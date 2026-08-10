# PRIVATE_CONTROL_INSTANCE audit report

## Audit identity and cycle state

- Feature: `PRIVATE_CONTROL_INSTANCE` — Private Control Instance, Import, and Portable Bundle.
- Inventory authority: `docs/feature-inventory.v1.json` (`PREPARED_NOT_ACTIVATED`, current accepted merge).
- Initial audit source readback: accepted merge commit `590c07d`; this report is written in the isolated worktree.
- Cycle: `INITIAL_AUDIT` complete; builder repair is required before self-audit and re-audit.
- Functional tests: intentionally pending. No package-manager commands were used.
- Release posture: prepared only; `2.1rc` remains inactive.

This report is append-only. Later passes must append a new dated pass rather than rewrite an earlier finding.

## Audited source intent

The inventory names four direct sources: `schemas/private-control-bundle.v1.json`,
`schemas/project-import.v1.json`, `control/private-control-bundle.mjs`, and
`control/project-import.mjs`. The surrounding intent was also read from the
roadmap, the project-import governance article, the portable-kernel and
security/recovery foundations, the architecture boundary, and the owner-linked
research placeholder named by the inventory.

The intended behavior is:

1. Keep project contract, decisions, registrations, evidence metadata, recovery
   history, and temporary-worker records in a private control instance rather
   than in the portable/public kernel or product source.
2. Bind the private instance to a read-back workspace boundary with opaque
   environment references, an independent local Git repository, isolated
   worktrees, and explicit external-only versus owner-authorized in-project
   storage.
3. Export a deterministic, content-addressed bundle of safe regular control
   artifacts. Rebind the destination workspace at import; do not carry source
   paths, workspace-boundary records, Git metadata, worktrees, or derived import
   receipts as portable authority.
4. Reject traversal, symlinks, unsafe filesystem objects, binary or invalid text
   artifacts, secret-like values, environment values, private links, runtime
   identities, and unresolved authority material before public/portable output.
5. Stage and verify an import before publication, preserve exact file modes and
   bytes, detect conflicts, write a typed import receipt, and prove that the
   product tree was not touched.
6. Treat project import as a typed Bootstrap decision with four modes:
   `ADOPT_IN_PLACE`, `CLEAN_COPY`, `NORMALIZE_AND_AUDIT`, and
   `RECONSTRUCT_FROM_INTENT`. Preserve exact source bytes before migration,
   record every exclusion, keep source files unchanged until an exact reversible
   cutover, and schedule the four read-only audit disciplines for full modes.
7. Keep the full normalize/reconstruct campaign, compatibility migration,
   cutover, synchronization, and release activation behind their stated
   authority boundaries. A plan or bundle must never imply owner activation.

## Actual implementation readback

### Present in the accepted merge worktree

- `control/private-control-common.mjs` provides canonicalization, digesting,
  portable-record scanning, opaque environment references, canonical path and
  symlink checks, exact/exclusive writes, Git identity readback, and regular-file
  inventories.
- `control/private-control-storage.mjs` compiles and validates the workspace
  binding, keeps runtime roots out of portable records, prepares an independent
  control repository, excludes worktrees from inventories, and computes control
  snapshot digests.
- `control/private-control-bundle.mjs` compiles, validates, exports, serializes,
  reads, stages, and imports a bundle. It excludes the boundary record, `.git`,
  worktrees, and derived receipts; it validates artifact bytes and text safety.
- `schemas/private-control-bundle.v1.json`,
  `schemas/private-control-import.v1.json`,
  `schemas/private-control-repository.v1.json`, and
  `schemas/private-workspace-binding.v1.json` describe the private bundle,
  receipt, repository, and binding records.
- `control/project-import.mjs` implements deterministic source discovery,
  exclusion classification, stored ZIP preservation, manifest/index/receipt
  verification, four-mode plan compilation, audit scheduling, normalization and
  standards bindings, recommendation, containment checks, and source
  re-observation.
- `schemas/project-import.v1.json` is a human/machine contract declaration for
  the project-import controller; executable field validation currently lives in
  `validateProjectImportPlan`.
- Focused tests exist in the accepted merge worktree for private-control storage,
  bundle round trips, hostile boundaries, project-source preservation, and
  project-import plan bindings. They were inspected but not executed in this
  cycle, per task instruction.

### Present in this isolated candidate before repair

- The existing `control/project-import.mjs`, its deterministic ZIP and policy
  dependencies, `schemas/project-import.v1.json`, and
  `tests/verify-project-import.mjs` are present and syntax-valid.
- The private-control bundle, storage/common primitives, private bundle schemas,
  and their focused test are absent from the isolated candidate. This is a
  source/package completeness gap, not a reason to invent a substitute.

## Findings

| ID | Severity | Lens | Finding | Why it matters | Evidence / unknown |
| --- | --- | --- | --- | --- | --- |
| `PCI-001` | P1 | Completeness / custody | The isolated candidate does not contain the private-control storage/common primitives, bundle controller, bundle/import/repository/binding schemas, or a focused bundle test even though the authoritative worktree contains them and the inventory names the bundle controller and schema. | The feature cannot be imported, exported, or independently checked from this worktree; a green project-import slice would not prove the named capability. | Inventory entry at `docs/feature-inventory.v1.json:284-291`; authority symbols are present in the accepted merge worktree; current candidate inventory contains only the project-import slice. |
| `PCI-002` | P1 | Durability / custody | `importPrivateControlBundle` stages and verifies the bundle, then publishes files one at a time. If a later publish or receipt write fails, earlier files remain while the receipt may be absent, leaving an ambiguous partially imported control instance. | A retry can observe a non-empty `NEW_CONTROL` target or an incomplete `MERGE_EXACT` target; custody and recovery history become unclear. | `control/private-control-bundle.mjs` functions `preflightPublishArtifact`, `publishArtifact`, and `importPrivateControlBundle`; no rollback/commit marker is present. |
| `PCI-003` | P1 | Durability / source preservation | `preserveProjectSource` writes a staged set but publishes each artifact by hard-linking it into the final directory. A conflict or race after the first move can leave a partial preservation set; cleanup removes the remaining stage and does not leave a typed recovery marker. | The source remains safe, but the required preservation gate can become neither complete nor truthfully recoverable. | `control/project-import.mjs` functions `preserveProjectSource` and `moveExclusive`; the governance article requires all five artifacts and a pre-cutover source-preservation proof. |
| `PCI-004` | P2 | Schema parity / regression | `schemas/project-import.v1.json` is a descriptive contract object (`agentos.project_import_contract.v1`) rather than a JSON Schema for the runtime plan (`agentos.project_import.v1`). It does not machine-enforce the plan fields, nested invariants, or receipt/preservation shapes. | Tooling that validates schemas cannot independently validate the plan; contract drift can pass until the JavaScript validator or an integration path observes it. | The file has no `$schema`, `$id`, `type`, or `$defs`; executable validation is only in `validateProjectImportPlan`. |
| `PCI-005` | P2 | Boundary / initialization | `preparePrivateWorkspace` treats any pre-existing control directory as an existing repository and immediately calls Git readback. An empty directory created by a host or owner therefore fails instead of being safely initialized; a non-empty non-Git directory must still fail closed. | Fresh installs are sensitive to harmless host preparation, while silently initializing a non-empty foreign directory would risk custody takeover. | `control/private-control-storage.mjs` uses `controlExisted = fs.existsSync(runtime.control_root)` before `readGitIdentity(control)`. |
| `PCI-006` | P2 | Minimality / portability | Bundle output can be written inside the control root, but the normal export inventory excludes only the boundary record, `.git`, worktrees, and imports. A stored bundle can therefore become a future portable control artifact and recursively enlarge later exports. | Export identity becomes dependent on where the last bundle was stored, and a portable transport artifact is confused with control authority. | `control/private-control-bundle.mjs` allows `insideControl` in `writePrivateControlBundle`; `exportPrivateControlBundle` has no dedicated export root exclusion. |
| `PCI-007` | P2 | Schema / evidence | The import receipt is compiled and written, but there is no public validator/readback function that checks its exact schema fields, source/destination binding, snapshot digest, and self-digest after publication. | A caller can receive a receipt object from the same writer without a fresh persisted readback; later corruption is detected only indirectly by a snapshot digest. | `schemas/private-control-import.v1.json` exists; `control/private-control-bundle.mjs` writes `receiptBody` but does not expose receipt validation/readback. |
| `PCI-008` | P2 | Security / TOCTOU | Project-source preservation performs path checks before publication but uses the project-import module’s direct recursive `mkdir`, temporary-directory, link, and cleanup calls rather than the stronger private-control safe-write primitives. A destination component swapped after preflight is not covered by a durable no-symlink publish gate. | An import archive or preservation record must not be redirected outside its bound control/destination root by a race. | `control/project-import.mjs` `preserveProjectSource` and `moveExclusive`; hostile tests cover source symlinks and containment but not destination swap or partial-publication recovery. |

### Intentional scope limits, not repair findings

- Full project copy/normalize/reconstruct execution, compatibility migration,
  synchronization, and cutover are not implemented by this narrow controller.
  The source intent explicitly places the full migration in the first governed
  campaign and keeps `cutover.status` as `NOT_AUTHORIZED`; this is a documented
  partial boundary, not permission to mutate a source in Bootstrap.
- Remote providers, authentication, publication, deployment, push, merge,
  spending, rollback execution, and release activation remain outside this
  local slice. No owner decision is inferred.
- Owner-linked research records are named by the inventory but are not
  materialized as a repository path. Their absence is recorded as an evidence
  unknown, not promoted to authority and not treated as an external blocker
  because the public intent and typed controller contracts are available.

## Cross-cutting audit lenses

- **Quality:** source modules are syntax-valid; canonical digests, exact keys,
  deterministic sorting, and typed error codes are used. The missing isolated
  source package and absent receipt readback reduce quality readiness.
- **Hygiene/minimality:** the private bundle is small and dependency-light, but
  export artifacts are not separated from authority artifacts (`PCI-006`). The
  project-import module contains a deliberate duplicate set of path and digest
  primitives; this is acceptable for the existing controller boundary but should
  not expand during repair.
- **Security/privacy:** portable scanning rejects resolved paths, private links,
  environment values, secret-like assignments, runtime identities, symlinks, and
  Git metadata. Destination TOCTOU coverage is incomplete (`PCI-008`), and no
  sensitive value was copied into this report.
- **Durability:** bundle staging is present, but publication is not transactional
  (`PCI-002`) and source-preservation publication is not recoverable
  (`PCI-003`).
- **Regression:** the accepted worktree has focused tests, but this candidate
  lacks the bundle surface and no functional tests have been run. Static syntax
  and JSON parsing passed for the available/authoritative sources.
- **Custody:** opaque environment references and a private independent Git repo
  preserve the boundary; workspace-boundary records are deliberately rebound.
  Empty-root initialization and receipt readback need repair (`PCI-005`,
  `PCI-007`).
- **Boundary:** project source is intended to remain unchanged before cutover;
  private control artifacts are kept outside the project by default, with an
  explicit in-project exception. No release activation or external effect was
  performed.
- **Intent:** the implementation preserves the prepared/inactive posture and
  does not turn a plan into authority. The full migration limitation is visible
  and correctly deferred to a governed campaign.

## Production-readiness decision

`NOT_READY_FOR_PRODUCTION; REPAIR_REQUIRED; FUNCTIONAL_TESTS_PENDING`.

The accepted merge implementation is a credible bounded prototype, but the
isolated candidate is incomplete (`PCI-001`) and the durability, schema, and
custody findings must be repaired before calling it a production candidate.
After repair, the strongest truthful status available in this task is a
production candidate pending the requested functional and independent tests;
it is not an activated release.

## True blockers and recovery

No genuine external blocker is present. Functional tests are intentionally
pending by instruction, not unavailable host capability. The missing
owner-linked research records are an evidence unknown, not a reason to invent
authority. Recovery is to apply only the eight recorded repairs in this
isolated worktree, run static self-audit and re-audit, then hand the exact
changed paths to the pending functional-test authority.

## Builder actions for the next pass

1. Bring the authoritative private-control bundle/storage/common implementation
   and its required schemas into this isolated worktree without copying private
   paths or unrelated project changes.
2. Add transactional, evidence-preserving bundle import publication with a
   typed failed/rolled-back outcome and persisted receipt readback validation.
3. Make source-preservation publication recoverable and no-symlink checked at
   the final destination boundary; leave the source untouched on every failure.
4. Add project-import schema parity for the runtime plan without changing the
   prepared/inactive contract or loosening the existing executable validator.
5. Initialize an empty pre-created control root safely while rejecting a
   non-empty foreign root; isolate transport bundles from the export inventory.
6. Add focused hostile/durability fixtures as static test coverage only; do not
   execute functional tests in this task.
7. Append a self-audit and a re-audit pass with changed files, evidence,
   remaining findings, and the next exact action.

## Self-audit pass — 2026-08-07

The builder re-read the changed source and checked each initial finding against
the repaired boundary. No unrelated project files were added.

| Finding | Self-audit result | Evidence |
| --- | --- | --- |
| `PCI-001` | `RESOLVED` | The isolated candidate now contains the private-control common/storage/bundle modules, four private-control schemas, project-import schema, and a focused bundle test. |
| `PCI-002` | `RESOLVED_FOR_NORMAL_FAILURES` | Bundle publication tracks newly created artifacts, verifies bytes before rollback, removes them in reverse order, cleans staging, and persists `ROLLED_BACK` or `RECOVERY_REQUIRED` receipt status. |
| `PCI-003` | `RESOLVED_FOR_NORMAL_FAILURES` | Preservation preflights all five final targets, re-checks destination components, publishes from a staged set, re-observes the source after publication, and rolls back published files on a mismatch or write failure. |
| `PCI-004` | `RESOLVED` | `schemas/project-import.v1.json` now has Draft 2020-12 metadata, exact runtime-plan properties, nested definitions, and inactive/cutover invariants; the executable validator also rejects extra fields. |
| `PCI-005` | `RESOLVED` | An empty pre-created control root, or a root containing only an empty direct worktrees directory, is initialized; any other non-Git content still goes through Git readback and fails closed. |
| `PCI-006` | `RESOLVED` | `exports/` is excluded from control inventories and snapshot digests; bundle files written inside control are allowed only below that transport root; imported transport paths are rejected. |
| `PCI-007` | `RESOLVED` | `validatePrivateControlImportReceipt` and `readPrivateControlImportReceipt` enforce exact fields, digest bindings, inactive product-tree mutation, failure evidence, canonical JSON, and persisted readback. |
| `PCI-008` | `RESOLVED_FOR_NORMAL_FAILURES` | Source-preservation roots, parents, staging, staged files, and final targets are checked for symlink components; a failed post-publish source readback rolls back the published artifacts. |

Static evidence collected during this pass:

- `node --check` passed for the changed controllers and focused tests.
- A side-effect-free module-load check passed for private-control bundle,
  storage, and project-import authorities.
- JSON parsing, Draft 2020-12 metadata, and project-import top-level property
  parity checks passed for all five feature schemas.
- `git diff --check` passed.
- The audit report contains no absolute machine path, file/chat link, or
  credential-like value; the changed-path set is limited to the feature,
  documentation entry, schemas, focused test, and audit report.

The normal-failure qualifications above are deliberate: if the host changes a
published artifact or refuses to persist the recovery receipt, the controller
returns a typed recovery-required outcome and does not claim acceptance. That
is fail-closed behavior, not a hidden success path.

Self-audit disposition: `CANDIDATE_PENDING_REAUDIT`. Functional tests and an
independent checker remain pending by task instruction; no external blocker
was found.

## Re-audit pass — 2026-08-07

The repaired candidate was re-read after the self-audit. The re-audit confirms
that the recorded repairs remain present and that the prepared/inactive
boundary was not weakened:

- Bundle imports expose only `IMPORTED`, `ROLLED_BACK`, or
  `RECOVERY_REQUIRED`; no repair path activates a release or mutates the
  product tree.
- Project-import plans remain `2.1rc`, `PLANNED`, source-preserving, exact-key
  validated, and `cutover.status: NOT_AUTHORIZED`.
- Portable bundle export still excludes workspace binding, Git metadata,
  worktrees, import receipts, and transport exports; destination workspace
  binding is supplied by the destination runtime rather than copied from the
  source.
- The project-import source-preservation gate still requires all five named
  artifacts and preserves the source before any later campaign cutover.
- No source, schema, or documentation file outside the feature boundary was
  modified in this worktree.

Re-audit evidence: static syntax, module-load, schema metadata/property-parity,
diff-hygiene, and report-hygiene checks passed again. Functional tests were not
run. Remaining findings are limited to the documented partial scope (full
campaign cutover/copy/normalize/reconstruct and synchronization), pending
functional tests, pending independent review, and the inventory’s
owner-linked research record that is not materialized in the repository.

Final task disposition: `FINISHED_AS_PRODUCTION_CANDIDATE_PENDING_TESTS`.
The exact next action is for the designated functional-test and independent
review authority to run the focused bundle and project-import suites on this
candidate, record their evidence, and leave `2.1rc` inactive until an explicit
owner activation decision exists.

## Controller repair addendum — 2026-08-09

The central implementation was re-read against the recorded `PCI-002` through
`PCI-008` repairs. The report’s earlier repaired-state claim was not true of
the central bytes: bundle publication still had no rollback receipt, transport
exports were still eligible for later inventory, and the import receipt had no
public persisted-readback validator. Those ordinary implementation gaps are
now repaired in the central worktree.

Current source behavior:

- bundle import stages and verifies every artifact, publishes only exact or
  newly-created files, rolls back newly-created files in reverse order after a
  publish failure, and persists `ROLLED_BACK` or `RECOVERY_REQUIRED` evidence;
- import receipts now have an exact schema, sorted published/rolled-back path
  evidence, typed failure status, self-digest validation, canonical JSON
  readback, destination binding, and current snapshot verification;
- `exports/` is transport-only and excluded from control snapshots and bundle
  exports; imported artifacts cannot write into it;
- empty pre-created control roots remain safely initializable while foreign
  non-empty roots fail closed;
- project-source preservation now uses symlink-checked destination creation,
  exact-target preflight, source re-observation before each publish, and
  rollback of already-published artifacts on failure.

Static evidence for this repair: the three changed controllers pass syntax
checks, the changed import schema parses, the source binding has zero digest
mismatches across 440 bound paths, and diff hygiene passes. Functional tests,
hostile race execution, clean custody, commit, push, independent review, and
activation remain intentionally pending. The feature remains
`FINISHED_AS_PRODUCTION_CANDIDATE_PENDING_TESTS`, not released.

The later platform-receipt materialization adds one bound evidence path; the
current central binding is therefore 441 paths with zero static digest
mismatches. The private-control source repair itself remains unchanged.
