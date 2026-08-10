# PROJECT_GOVERNANCE_PERSISTENCE audit report

Feature: Persistent Project Governance and Upgrade Migration  
Inventory kind: `NAMED_CAPABILITY`  
Inventory status at audit start: `NOT_STARTED`  
Report status: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`

This is an append-only audit, repair, self-audit, and re-audit record. It is
project-agnostic and contains no private paths, credentials, provider tokens,
chat links, or runtime identities.

## Audit 0 — baseline, intent, and evidence

### Baseline identity and authority

- Isolated builder baseline: accepted-merge commit `590c07d`.
- Authoritative source: the current accepted merge content at the same source
  identity, including its accepted uncommitted feature files. The source was
  read before any builder edit.
- Functional tests were not run, per task instruction. All test claims below
  are pending execution on the exact repaired candidate.
- The prepared `2.1rc` line remains inactive; this task records no activation,
  release, merge, push, deployment, or external delivery.

### Intended behavior

The feature is intended to make project governance durable and upgrade-safe:

1. Four content-addressed governance layers compose in one direction:
   release-owned base general rules, release-owned base role rules,
   project-owned additive governance, and generated role packets.
2. Project governance remains project-owned across a release upgrade. A base
   replacement may rebase the project layer, but may not overwrite its source,
   expand authority, or silently rename a project graph.
3. A compatible upgrade produces a candidate binding with explicit lineage,
   preservation evidence, conflict evidence, rollback identity, and a separate
   independent-check/owner-activation path. A reset is an explicit owner
   choice, not an inferred technical result.
4. Graph and role conflicts fail closed with a typed, durable migration result;
   the previous binding remains active until the candidate is checked.
5. Project governance history is append-only, digest-linked, portable, and
   recoverable after interruption. Release replacement never mutates the
   project repository and retains the previous release until verification.
6. Public contracts stay project-agnostic and `2.1rc` remains
   `PREPARED_NOT_ACTIVATED`.

### Roadmap and documentation intent reviewed

- `docs/roadmap.md` defines four-layer governance, preservation across
  upgrades or explicit migration review, conflict-safe upgrade tests, and a
  Phase 4 exit gate covering old/new, mixed-version, interruption,
  reconciliation, rollback, and independent checking.
- The same roadmap marks layered governance and release/migration safety as
  partial, so the feature must not claim full production acceptance merely
  because compiler primitives exist.
- `docs/bootstrap-rapid-prototype-plan.md` and the `governance/2.1rc/`
  corpus preserve the separate public kernel, private control plane, source
  preservation, owner-only boundaries, and inactive release posture.
- `docs/architecture.md` in the authoritative merge still documents only two
  governance libraries and does not explain project persistence, upgrade
  rebasing, or append-only history. `docs/release-promotion.md` does not yet
  describe the governance migration seam. This is a documentation-intent gap,
  not an external blocker.

### Research and inventory evidence

- `docs/feature-inventory.v1.json` names this feature and points to
  `schemas/project-governance-appendix.v1.json`,
  `schemas/governance-migration.v1.json`, and owner-linked research records.
- No research-record file is present in the accepted merge source catalog.
  The research requirement is therefore recorded as an unknown provenance
  input, not treated as permission to invent product facts. The typed roadmap,
  schemas, executable source, and synthetic hostile fixtures are sufficient to
  audit the implementation seam; owner-linked research remains evidence to
  be supplied by the owning governance process.

### Actual implementation found in the authoritative merge

- `control/four-library-foundation.mjs` compiles and validates the base and
  project libraries, ownership, lineage, digests, portability, graph binding,
  composition, and conflict records.
- `control/four-library-operations.mjs` compiles generated role libraries and
  bindings, transitions lifecycle status, rebases project governance, and
  prepares keep/reset migration results.
- `control/four-library-history.mjs` validates and appends JSONL project
  governance history inside a control root.
- `control/four-library-governance.mjs` is the public four-library entrypoint.
- `control/private-release-update.mjs` and its private-control dependencies
  provide a separate external release replacement boundary using project
  governance appendices, compatibility checks, reset/archive records, release
  retention, and rollback.
- The related schemas and synthetic verifier
  `tests/verify-four-library-governance.mjs` cover deterministic composition,
  lineage, collisions, preservation, reset staging, lifecycle transitions,
  and append-only history. `tests/verify-private-control-slice.mjs` covers the
  private release path and hostile workspace boundaries. Neither was run.

## Findings recorded before repair

### F-001 — feature surface absent from the isolated builder baseline (P0)

Evidence: the isolated worktree has no four-library modules, project-governance
schemas, migration/history schemas, private release-governance seam, or focused
verifier, while the authoritative merge contains those accepted feature files.

Why it matters: without porting the accepted feature surface, this worktree
cannot produce a candidate or preserve the authoritative feature behavior.

Builder action: add only the feature files and their direct feature dependencies
to this worktree, then repair the findings below. Do not copy unrelated merge
work.

### F-002 — documentation does not describe the delivered persistence contract (P1)

Evidence: `docs/architecture.md` describes only shared general and generated
role-specific governance; `docs/release-promotion.md` omits project-governance
preservation, reset review, history, and rollback; the maintainer/operator
guidance does not name the four-library entrypoint or migration evidence.

Why it matters: operators cannot distinguish project-owned governance from
replaceable release rules, cannot know when an upgrade must stop for review, and
may mistake a compiled candidate for activation.

Builder action: update the smallest relevant public docs with the four layers,
keep/reset behavior, history/rollback rules, inactive-release boundary, and
test-pending posture. Keep all examples synthetic and project-agnostic.

### F-003 — generated role packets do not prove graph inheritance and source digests (P0)

Evidence: `control/four-library-operations.mjs` validates packet graph IDs and
their self-reported `effective_graph_digests`, but does not require every base
role graph to remain effective and does not compare each effective graph digest
and source to the corresponding base-general, base-role, or project binding.

Why it matters: a forged packet can keep a valid packet digest while dropping a
base governance graph or substituting a different graph digest. That can change
effective authority without changing the parent records.

Builder action: derive the expected graph binding map from the validated parent
libraries, require base graph inheritance, require project selection to match,
and compare every effective graph digest/source to that map. Add hostile fixture
coverage for omission and substitution.

### F-004 — migration preparation does not fail closed as a durable result (P0)

Evidence: `prepareGovernanceUpgrade` validates only a positive `policy_epoch`,
does not require an owner decision for `RESET_GOVERNANCE_CLEAN`, allows
status/mode/candidate combinations that do not express a safe state, and lets a
graph collision escape as an exception even though the migration schema defines
`BLOCKED` and `conflicts`.

Why it matters: a stale migration can replay an old policy epoch; reset can be
selected without owner evidence; and a collision loses the typed migration
record needed for recovery, audit, and exact re-attempt.

Builder action: require a strictly newer epoch, add explicit reset owner
decision evidence, enforce READY/BLOCKED candidate invariants, and convert
typed governance conflicts into a validated BLOCKED migration record while
preserving the current binding and project source.

### F-005 — JSON schemas are weaker than executable contracts (P1)

Evidence: `project-governance-appendix.v1.json` permits arbitrary `role_overlays`
objects and does not constrain normalized graph paths; `governance-migration.v1.json`
uses an unconstrained project ID and arbitrary conflict objects; the history
schema leaves project ID and migration-chain semantics broad. Executable
validators are stricter, so schema-only consumers can accept records runtime
consumers reject.

Why it matters: independent checkers, storage tooling, and future readers can
disagree about whether a governance record is valid, creating portability and
upgrade ambiguity.

Builder action: tighten the affected schemas to the portable executable shapes,
including overlay fields, safe identifiers, conflict records, candidate/mode
relations, and digest/chain constraints. Keep runtime validation as the final
authority.

### F-006 — append-only history is not crash-durable or writer-serialized (P1)

Evidence: `appendProjectGovernanceHistory` reads and validates the chain, then
opens the JSONL file with append flags and writes without an exclusive writer
lock or `fsync`; two concurrent writers can validate the same predecessor and
both append, and a process crash can leave acknowledged bytes unflushed.

Why it matters: project governance history is an authority record. A broken
chain or lost append prevents deterministic restart/recovery and can hide which
governance version was active.

Builder action: add a bounded exclusive lock around read/validate/append,
fsync the file and containing directory after the append, and fail closed on a
pre-existing lock or malformed chain. The exact lock target remains inside the
control root and is not a portable record.

### F-007 — private release cutover can leave governance state ahead of release state (P0)

Evidence: `executePrivateReleaseReplacement` writes preserved, archived, and
active governance records before moving the release roots. If cutover or
readback fails, the release rollback restores the old release but those
governance records remain. The executor also trusts a caller-supplied current
appendix without binding its digest to a persisted current-governance identity.

Why it matters: after an interrupted upgrade, the control plane can claim clean
or preserved governance for a release that was never activated, and a stale or
omitted caller argument can select the wrong project-governance state.

Builder action: stage only the decision/plan before cutover, commit active,
archive, and preservation records only after verified cutover, clean up only
records created by a failed attempt, and bind the supplied current appendix to
an explicit planned digest when present. Preserve the old release until the
verified receipt exists.

## Cross-cutting audit lenses

| Lens | Finding | Initial assessment |
| --- | --- | --- |
| Quality | F-003, F-004 | Parent/source bindings and migration outcomes need stronger invariants. |
| Hygiene/minimality | F-001, F-002 | The accepted feature is split across two seams; the public docs do not yet explain that boundary. Port only direct feature files. |
| Security/privacy | F-003, F-005, F-007 | Forged graph bindings, schema-only acceptance, and stale release governance can cross authority boundaries; portability scans are present but functional evidence is pending. |
| Durability | F-006, F-007 | History flush/serialization and cutover atomicity need repair. |
| Regression | F-001, F-003–F-006 | Existing accepted fixtures cover the happy path but do not cover the identified hostile cases. |
| Custody | F-004, F-007 | Reset and release replacement must preserve previous authority until independent verification. |
| Boundary | F-002, F-007 | Public kernel, private control plane, project repository, and release root need explicit documented and executable separation. |
| Intent | F-002, F-004 | Owner reset choice and inactive activation posture must remain explicit. |

## True blockers and recovery

No genuine external blocker is present at this audit pass. Missing owner-linked
research is an evidence unknown, not an implementation blocker; the reframe is
to use the typed roadmap/contracts and preserve the unknown for owner review.
Functional test execution is intentionally pending by instruction, not a
blocker to code repair. If later work encounters a true blocker, the exact
recovery must name the unavailable external authority or host capability, the
record that proves it, and the single owner/host action that unblocks it; no
ordinary implementation gap may be classified as blocked.

## Builder plan

1. Port the direct accepted feature surface into this isolated worktree.
2. Repair F-003 through F-007 under their recorded scopes.
3. Re-read the changed contracts and perform a static self-audit without
   running functional tests.
4. Append the exact changed files, evidence, residual findings, and next action.
5. Re-audit each repaired finding and conclude as a production candidate
   pending the requested functional tests, unless a genuine external blocker
   appears.

## Initial handoff

Changed files in this audit pass: this report only.  
Evidence: accepted source inventory, roadmap/release/architecture intent,
feature schemas, feature implementation, focused fixtures, and clean isolated
baseline were read; no functional test was run.  
Remaining findings: F-001 through F-007.  
Next action: port the direct feature surface, then repair the recorded
source-binding, migration, schema, durability, cutover, and documentation gaps.

## Repair pass 1 and static self-audit

### Changed files

The builder added the direct feature surface and repaired only the recorded
findings:

- Four-library composition, migration, and history: `control/four-library-foundation.mjs`,
  `control/four-library-operations.mjs`, `control/four-library-history.mjs`,
  `control/four-library-governance.mjs`.
- Private release/control boundary: `control/private-control-common.mjs`,
  `control/private-control-storage.mjs`, `control/private-release-update.mjs`.
- Four-library, appendix, migration, history, conflict, workspace, and release
  contracts under `schemas/`.
- Focused synthetic governance verifier:
  `tests/verify-four-library-governance.mjs`.
- Public architecture/operator/maintainer/user documentation and
  `control/README.md`.
- This append-only report.

No unrelated project or product source was changed.

### Repairs applied

- F-001: ported the accepted direct implementation surface into the isolated
  worktree.
- F-002: documented four-library ownership, preservation/rebase/reset behavior,
  append-only history, release retention, rollback, and inactive activation
  boundaries.
- F-003: generated packets now retain every base graph, derive expected graph
  source/digest bindings from validated parents, reject duplicate base/role
  graph IDs and graph paths, and reject substituted effective graph digests or
  source labels. Hostile omission/substitution fixtures were added.
- F-004: migration preparation now requires a newer policy epoch, records reset
  owner evidence, enforces READY/BLOCKED candidate/conflict invariants, and
  returns a digest-bound `BLOCKED` migration for typed governance conflicts.
  The previous binding and project source are returned unchanged on that path.
- F-005: appendix overlays, normalized relative graph paths, safe identifiers,
  conflict records, migration state relations, and history identifiers are now
  constrained in JSON schemas and executable validation. Appendix compilation
  also sorts and de-duplicates its portable inputs.
- F-006: history append now holds an exclusive control-root lock across
  read/validate/append, fsyncs the record and containing directory, and fails
  closed on an existing lock or malformed chain.
- F-007: release plans now bind the current project-governance digest or an
  explicit absence. Preservation/archive/active records are committed only
  after release identity readback; records created by a failed cutover are
  removed after the retained release is restored. The project tree remains
  untouched.

### Evidence collected without functional tests

- `node --check` passed for every added/changed feature module and focused
  verifier.
- JSON parsing passed for every affected schema.
- Module import checks passed for the public four-library and private release
  entrypoints.
- `git diff --check` passed.
- A targeted portability scan found no actual private machine path, secret,
  credential, provider token, or chat link in the added feature records/docs.
  Intentional validator regexes and module `file://` main guards are source
  mechanics, not persisted records.
- Functional tests, schema-engine validation, race/crash simulation, release
  cutover simulation, and independent acceptance remain pending by instruction.

### Static self-audit result

All seven recorded findings have a corresponding code/schema/documentation
repair and no new source-level finding was identified in the repaired scope.
The private release path remains an explicit caller-boundary operation: its
current appendix must match the digest in the exact plan; the portable control
plane does not infer project governance from an omitted argument. A pre-existing
history lock is an intentional fail-closed recovery condition and must be
removed only after the host confirms no writer remains.

Remaining evidence conditions are not implementation blockers:

- owner-linked research records remain unavailable in the source catalog;
- the focused functional verifier and private release verifier have not been
  run;
- independent checking and owner activation remain pending;
- `2.1rc` remains prepared and inactive.

## Re-audit 1 — production-candidate disposition

### Findings disposition

| Finding | Re-audit result | Evidence |
| --- | --- | --- |
| F-001 | Resolved in this worktree | Direct feature modules, contracts, docs, and focused verifier are present. |
| F-002 | Resolved for documented intent | Architecture, release, maintainer, operator, and user guidance now describe the seam. |
| F-003 | Resolved pending hostile execution | Parent graph inheritance and source/digest equality are checked before packet acceptance. |
| F-004 | Resolved pending migration fixtures | Epoch, reset decision, conflict record, and candidate-state invariants are executable. |
| F-005 | Resolved pending schema-engine execution | Affected schemas now mirror the portable executable shapes and relations. |
| F-006 | Resolved pending race/crash execution | Lock, file fsync, directory fsync, and chain validation are present. |
| F-007 | Resolved pending cutover/rollback execution | Exact current-governance binding and post-readback governance commit are present. |

### Production readiness

Disposition: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`.

The repaired candidate is suitable for the next verification pass, but it is
not functionally accepted, independently checked, activated, or released. The
next action is to run the focused four-library and private release verifiers,
schema validation, race/interruption cases, portability/hostile checks, and an
independent audit on the exact candidate. Any failure should append a new
finding and repair pass here; it must not rewrite this history.

### Final handoff for this task

Changed files: the feature modules, affected schemas, focused governance
verifier, public feature documentation, and this report.  
Evidence: static syntax/import/JSON/whitespace/privacy checks passed; functional
tests remain pending by explicit instruction.  
Remaining findings: none in the repaired implementation scope; research
provenance and functional/independent acceptance are pending evidence.  
Next action: run the pending focused and independent verification pass on the
exact candidate, then record its result as the next append-only audit entry.

## Repair pass 2 and static self-audit

The second static self-audit found one implementation defect in the repaired
history seam: `control/four-library-history.mjs` exported a
`canonicalDigest` wrapper whose `digest` binding was absent. This was an
ordinary implementation gap, not an external blocker. The builder imported
the foundation canonical digest under that binding and preserved the public
wrapper.

Changed file: `control/four-library-history.mjs` only. No unrelated scope was
changed and no functional verifier was run.

Evidence: module syntax check passed, and a direct digest invocation returned
a 64-character digest. The repair remains pending the full history append,
lock, interruption, and chain fixtures.

## Re-audit 2 — production-candidate disposition

The history export defect is resolved in source and no new static finding was
identified in the changed scope. The candidate remains
`PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`; focused governance, private
release, schema-engine, race/interruption, and independent acceptance checks
are still the next action. Functional tests remain pending by instruction.

## Repair pass 3 and static self-audit

F-005 received one further contract-only repair. The appendix schema now
rejects duplicate binding/overlay objects and non-normalized forms such as
double separators, dot segments, and trailing separators. The history schema
now caps revisions at the JavaScript safe-integer boundary used by executable
validation.

Changed files: `schemas/project-governance-appendix.v1.json` and
`schemas/project-governance-history-entry.v1.json`.

Evidence: the affected JSON parsed, the normalized-path pattern accepted
portable examples and rejected absolute, backslash, parent, duplicate-
separator, dot-segment, and trailing-separator forms, module syntax/import
checks passed, and `git diff --check` passed. Schema-engine execution remains
pending with the functional verification pass.

## Re-audit 3 — production-candidate disposition

The remaining source-level F-005 gap found during self-audit is resolved. The
candidate remains `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`; no external
blocker is present, and the next action is still the explicitly pending
focused, schema-engine, interruption, private release, and independent
verification pass.

## Final handoff — production candidate pending tests

Changed files are limited to the four-library foundation/operations/history/
entrypoint modules, private control and release-boundary modules, their
governance/release schemas, the focused four-library verifier, the public
architecture/release/operator/maintainer/user documentation, and this audit
report.

Evidence is clean static syntax/import/JSON/normalized-path/whitespace/
portability coverage, including the repaired history digest binding. No
functional test, schema-engine run, race/interruption simulation, or
independent acceptance run was performed. No npm command was used.

Remaining findings: none in the repaired implementation scope. Pending
evidence is the owner-linked research provenance, functional and hostile
fixtures, private release cutover/rollback execution, independent checking,
and explicit activation; `2.1rc` remains prepared and inactive.

Next action: run the pending verification pass against this exact isolated
candidate and append its result without rewriting prior audit history.
