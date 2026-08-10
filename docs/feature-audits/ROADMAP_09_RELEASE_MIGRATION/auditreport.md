# ROADMAP_09_RELEASE_MIGRATION — Release, Compatibility, and Migration Safety

Status: `AUDIT_REPAIR_REAUDIT_IN_PROGRESS`

This report is append-only. The accepted merge worktree was read as the
authoritative baseline; all builder changes are confined to this isolated
worktree. Functional tests remain pending by instruction. No activation,
promotion, publication, push, merge, deployment, or external delivery was
performed.

## Pass 1 — complete intent and implementation audit

### Authority and exact baseline

- Inventory entry: `ROADMAP_09_RELEASE_MIGRATION`,
  `docs/feature-inventory.v1.json`, status `NOT_STARTED`.
- Authoritative source identity: commit
  `590c07ddd4be7a8c24727c24b40808e44ca7357d`; source tree
  `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- The release slice in the accepted merge was an untracked candidate surface;
  its reference hashes were recorded without copying unrelated work:
  `control/release-lifecycle.mjs`
  `fce8ea68a3d529837aa698f69500f41713d8efce630a7067174c341ac4b0f95f`,
  `control/release-promotion-gate.mjs`
  `37b37c505b9df4d4f000a162f1280675580313d06703217f6085f0fffda06f00`,
  `schemas/release-lifecycle.v1.json`
  `88b30f3c6a934dea4ad27ef7d796e2bc237e989c964b1e04dbf270ea7b6ea0d4`,
  `schemas/release-promotion-gate.v1.json`
  `bd099707b0b3d9c0d406e897894a257812719ed6497dc0ba9d6ae68c95c31df8`,
  `docs/release-promotion.md`
  `a242e2fa84184a702bfde2146171f0c943ffd10cd2e219c5ec09e943953b3d7b`.
- The authoritative candidate had focused release verifiers
  `tests/verify-release-lifecycle.mjs` and
  `tests/verify-release-promotion-gate.mjs`; they were not run.

### Intended behavior

The roadmap states that promotion moves from development evidence to a
sterile release candidate and only then, by an explicit owner choice, to an
active release (`docs/roadmap.md:252-274`). Stateful changes must carry
compatibility, mixed-version, backfill, cutover, reconciliation,
irreversible-point, and rollback evidence. Governance changes must be replayed
and model-checked for dead ends, bypasses, livelocks, lost recovery, and
changed owner authority.

The phase exit gate requires old-state, new-state, mixed-version,
interruption, reconciliation, and rollback scenarios to pass an independent
check while activation remains pending (`docs/roadmap.md:398-408`). The owner
activation boundary is separate and recorded (`docs/roadmap.md:425-433`), and
the prepared `2.1rc` line must remain inactive (`docs/roadmap.md:435-452`,
`docs/activation.md:1-15`). The release documentation also requires the
development and sterile checkout roles to remain separate and the promotion
record to avoid performing external actions (`docs/release-promotion.md:1-15`).

The inventory names only `docs/roadmap.md`, `docs/release-promotion.md`, and
`schemas/release-lifecycle.v1.json` as this feature’s source catalog. No
release-specific research record is linked by that entry; research-linked
claims were therefore treated as unknown rather than as implementation
evidence.

### Actual implementation in the authoritative candidate

- `control/release-lifecycle.mjs` provides strict release-version and test-
  build allocation, content-addressed artifact manifests, symlink/private
  content rejection, sterile manifest comparison, release-candidate states,
  owner decisions, rejection feedback, promotion requests, and
  non-activating promotion receipts.
- `schemas/release-lifecycle.v1.json` covers those identity, manifest,
  candidate, decision, feedback, request, and receipt records. The candidate
  and promotion request definitions have no compatibility, migration,
  policy-replay, or model-check evidence binding
  (`schemas/release-lifecycle.v1.json:157-247`).
- `control/release-promotion-gate.mjs` distinguishes active-development and
  sterile-release evidence and keeps publishing, pushing, merging,
  deployment, and activation false. It does not execute or bind the required
  compatibility and governance safety checks.
- `control/private-release-update.mjs` retains the previous release during a
  private same-root replacement and rolls back on a failed readback. This is a
  useful cutover custody primitive, not a complete compatibility or migration
  proof.
- Existing focused verifiers cover versions, manifests, privacy/symlink
  rejection, owner decisions, stale evidence, and non-activating receipts
  (`tests/verify-release-lifecycle.mjs:38-251`) plus the static promotion gate
  (`tests/verify-release-promotion-gate.mjs:18-43`). They do not cover the
  roadmap’s required migration scenarios or model properties.

### Findings register

#### F-09-001 — missing compatibility and migration evidence (HIGH)

There is no typed release compatibility matrix or migration plan for old
state, new state, mixed versions, failed migration, interrupted cutover,
reconciliation, irreversible points, and rollback. The private replacement
primitive proves only one local replacement/readback path. This leaves a
stateful release promotable without proving that an upgrade can be resumed,
reconciled, or reversed.

#### F-09-002 — missing policy replay and authority-diff evidence (HIGH)

No release record captures before/after policy decisions or changed owner
authority. An owner can review artifact identity, but cannot receive a typed
pre-activation report of governance behavior changes. That is directly below
the roadmap bar and risks silent policy drift during upgrade.

#### F-09-003 — missing model checking (HIGH)

No release-scoped model checker evaluates reachability, termination/livelock,
bypass resistance, recovery availability, or owner-control invariants. The
candidate state machine is validated locally, but there is no independent
finite-model result that exercises failure and recovery paths.

#### F-09-004 — promotion is not gated on safety evidence (HIGH)

`compileReleasePromotionRequest` and its schema require candidate, owner
decision, and artifact identities but no compatibility, migration,
policy-replay, or model-check digest. Technical promotion can therefore be
requested after an artifact-only review.

#### F-09-005 — sterile verification is too opaque (MEDIUM)

The promotion gate accepts a bare `verification_sha256` for each checkout and
does not bind the required verification results to the exact sterile artifact
or expose a typed safety bundle. The manifest receipt does compare target
bytes, which is positive evidence, but it is not a substitute for re-running
the required release-safety checks on that exact target.

#### F-09-006 — artifact manifests include VCS metadata (MEDIUM)

`collectArtifactFiles` recursively walks the release root and does not exclude
`.git` metadata (`control/release-lifecycle.mjs:401-425`). A sterile checkout
can therefore receive unstable repository internals and private metadata in an
artifact identity. Exact release artifacts should enumerate source payloads,
not the checkout control directory.

#### F-09-007 — independent custody is only a digest convention (MEDIUM)

The candidate stores an independent-audit digest, but the release-safety
contract does not require an explicit independent-checker role or bind the
checker result to all safety sub-records. The owner boundary is present, but
the evidence custody chain is incomplete.

### Evidence, unknowns, and production readiness

Direct evidence supports release-state separation, deterministic identity,
privacy checks for the existing records, non-activating owner decisions, and
private replacement rollback custody. There is no direct evidence for the
Phase 4 exit gate, because the required compatibility fixtures, policy replay,
model check, and exact sterile re-run binding are absent. Functional test
execution is intentionally unknown/pending.

Production readiness for this feature is `NOT_READY — PARTIAL`. The existing
artifact and owner-control slice is reusable, but a stateful release must not
be promoted until F-09-001 through F-09-007 are resolved and the focused and
full verification suites are later run on the exact sterile candidate.

### Cross-cutting audit lenses

- Quality: strong typed identity and stale-record checks exist; the promised
  safety decision is not yet complete.
- Hygiene: records use opaque digests and the accepted candidate contains no
  release activation; `.git` enumeration is a release-hygiene defect.
- Minimality: the current artifact/owner slice is bounded, but adding safety
  as an untyped narrative would be insufficient; the repair must stay as
  small typed records and a finite checker.
- Security: activation and external actions fail closed in the existing gate;
  promotion remains unsafe without migration and authority-diff gates.
- Privacy: existing persisted records scan for private/secret-like content;
  no new migration/replay record currently exists to scan.
- Durability: version allocations and previous-release retention are useful;
  interrupted migration and reconciliation history are not durable.
- Regression: current focused tests cover artifact and owner flows only; the
  required old/new/mixed/failure/interruption/rollback matrix is untested.
- Custody: host promotion is separated from the portable kernel, but
  independent safety-check custody is not yet explicit.
- Boundary: project repositories remain unchanged and `activation` is false;
  the promotion validator has an evidence-status bypass defect.
- Intent: `2.1rc` remains prepared and inactive; no owner activation was
  inferred or performed.

### True blockers and exact recovery

There is no genuine external blocker. Missing implementation is an ordinary
repairable gap, not a reason to stop. Functional test execution is pending by
instruction, not an external authority or host limitation. Exact recovery is:

1. Add portable typed compatibility/migration, policy-replay, and model-check
   records with privacy-safe digests.
2. Bind a passing safety bundle and independent checker evidence to the
   candidate and promotion request.
3. Fix the promotion-gate status calculation and exclude `.git` metadata.
4. Add focused hostile and deterministic verifiers, then run only static
   syntax/JSON/hygiene checks now; leave functional tests pending.
5. On a later approved verification pass, run focused suites and the full
   canonical verifier against a clean sterile candidate. Any failure creates
   a new typed finding and keeps activation false.

### Recorded builder actions

- `BA-09-001`: add a project-agnostic release safety contract and schema for
  migration plans, required compatibility scenarios, policy replay, and
  finite model-check results.
- `BA-09-002`: add a release-safety gate and require its passing digest plus
  independent checker digest before an owner-approved promotion request.
- `BA-09-003`: repair sterile artifact enumeration and promotion-gate
  validation while preserving `2.1rc` inactive and project repositories
  unchanged.
- `BA-09-004`: add focused tests for required scenarios, tampered/pending
  evidence, graph bypass/livelock/recovery failures, symlinks, private
  content, and activation rejection. Do not execute them in this task.
- `BA-09-005`: append self-audit and re-audit results after implementation,
  with changed files, evidence, remaining findings, and the next action.

## Pass 2 — builder self-audit after repair

### Recorded repairs

- `F-09-001` resolved in the candidate slice by
  `control/release-compatibility.mjs`, `control/release-safety-gate.mjs`,
  `schemas/release-migration.v1.json`, and
  `schemas/release-compatibility.v1.json`. A migration plan requires
  backfill, cutover, reconciliation, and rollback steps. Compatibility
  evidence requires exactly `OLD_STATE`, `NEW_STATE`, `MIXED_VERSION`,
  `FAILED_MIGRATION`, `INTERRUPTED_CUTOVER`, `RECONCILIATION`, and `ROLLBACK`
  cases, each with state and evidence digests.
- `F-09-002` resolved by `control/release-policy-replay.mjs` and
  `schemas/release-policy-replay.v1.json`. Replay records before/after
  decision and authority digests, derives changed-case lists, and preserves an
  owner-review flag.
- `F-09-003` resolved by `control/release-model-check.mjs` and
  `schemas/release-model-check.v1.json`. The finite checker evaluates
  reachability, dead ends/termination, livelock cycles, protected-action
  bypasses, recovery transitions, and owner-control transitions. Activation is
  forbidden in every model state.
- `F-09-004` resolved by adding `safety_gate_sha256` and
  `safety_subject_sha256` to candidate/promotion records and requiring a
  passing `validateReleaseSafetyBundle` result before promotion request
  compilation. The release schema now exposes those required bindings.
- `F-09-005` resolved by extending checkout evidence with commit, tree,
  artifact, manifest, and verification digests, adding `RELEASE_SAFETY` to
  the promotion verification set, and requiring the safety digest for a ready
  gate. The validator now recomputes readiness from every verification value;
  it cannot accept a tampered ready record with pending evidence.
- `F-09-006` resolved in `control/release-lifecycle.mjs`: `.git` entries are
  excluded from artifact enumeration, while symlinks and private/secret-like
  files or bytes still fail closed.
- `F-09-007` resolved by the typed
  `INDEPENDENT_RELEASE_AUDITOR` role and by requiring one identical checker
  digest across compatibility, policy replay, model checking, and the joined
  safety gate.

### Self-audit refinements

The repair self-audit found two local quality issues and corrected them before
re-audit: canonical ordering now compares UTF-8 bytes rather than relying on a
runtime string ordering, and the safety gate now checks independent-checker
digest equality across all child records. The hostile promotion test was also
adjusted to leave `RELEASE_SAFETY` pending while tampering the status to
`READY_FOR_EXPLICIT_PROMOTION`.

### Static evidence

- `node --check` passed for all seven release controllers and the focused
  verifier.
- `jq empty` parsed all seven release schemas and the blocker record.
- Whitespace and scoped privacy scans passed for every changed release,
  schema, documentation, report, and verifier file.
- No npm command was used. Functional tests, including
  `tests/verify-release-safety.mjs` and the full canonical suite, remain
  pending by instruction.

## Pass 3 — re-audit against roadmap and documentation intent

| Intent | Re-audit result | Evidence |
| --- | --- | --- |
| Development and sterile identities are independent | Implemented as typed checkout identity plus exact artifact/manifest fields; host readback remains required | `control/release-promotion-gate.mjs`, `control/release-lifecycle.mjs` |
| Promotion reruns checks on the exact sterile candidate | Implemented as source/sterile artifact and verification digests plus exact expected/target manifest comparison; no result is inherited by narration | `control/release-promotion-gate.mjs`, `control/release-lifecycle.mjs` |
| Compatibility and migration scenarios | Implemented with a required seven-scenario matrix and four-phase migration plan | `control/release-compatibility.mjs`, `schemas/release-migration.v1.json`, `schemas/release-compatibility.v1.json` |
| Policy replay reports decision and authority changes | Implemented with derived changed-case lists and owner-review flag | `control/release-policy-replay.mjs` |
| Model checking | Implemented with deterministic graph checks for reachability, termination, livelock, bypass, recovery, and owner control | `control/release-model-check.mjs` |
| Separate owner activation | Preserved: candidate, decision, request, receipt, gate, and model states all keep `activation: false` | `control/release-lifecycle.mjs`, `control/release-safety-gate.mjs`, `docs/release-promotion.md` |

### Re-audit lenses

- Quality/minimality: the feature is now a bounded set of portable records and
  one finite checker; no provider, project, or deployment policy was added.
- Hygiene/security/privacy: release payloads exclude VCS metadata, reject
  symlinks and private content, and all persisted safety records are
  content-addressed and privacy-scanned.
- Durability/regression: predecessor candidate digests, migration step
  evidence, rollback cases, and exact receipt bindings preserve recovery
  context. Focused hostile coverage is present but not executed.
- Custody/boundary/intent: the independent checker is typed, project
  repositories remain unchanged, external host action is represented only by
  a receipt, and `2.1rc` remains prepared and inactive.

### Remaining findings and production readiness

- `R-09-TEST-EVIDENCE` — functional verification is still pending. This is an
  evidence hold required by the user’s instruction, not a code gap or external
  blocker. Exact recovery is to run the focused release verifier and then the
  full canonical suite on a clean sterile candidate; any failure reopens a
  typed finding and keeps activation false.
- `R-09-OWNER-HOST` — a real owner activation decision and host-specific
  readback remain intentionally unavailable in this portable task. They are
  owner/custody boundaries, not inferred work and not blockers to producing a
  candidate pending tests.

No implementation finding from the initial register remains open. The feature
status is `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`; it is not an active
release and no activation or external promotion was performed.

### Changed files and next action

Changed files are limited to the release slice, its contracts/docs, the
focused verifier, canonical verifier registration, and this report:

- `control/README.md`
- `control/release-common.mjs`
- `control/release-compatibility.mjs`
- `control/release-lifecycle.mjs`
- `control/release-model-check.mjs`
- `control/release-policy-replay.mjs`
- `control/release-promotion-gate.mjs`
- `control/release-safety-gate.mjs`
- `docs/feature-audits/ROADMAP_09_RELEASE_MIGRATION/auditreport.md`
- `docs/release-development-promotion-blocker.v1.json`
- `docs/release-promotion.md`
- `schemas/README.md`
- `schemas/release-compatibility.v1.json`
- `schemas/release-lifecycle.v1.json`
- `schemas/release-migration.v1.json`
- `schemas/release-model-check.v1.json`
- `schemas/release-policy-replay.v1.json`
- `schemas/release-promotion-gate.v1.json`
- `schemas/release-safety-gate.v1.json`
- `tests/verify-all.mjs`
- `tests/verify-release-safety.mjs`

Next action: leave the candidate inactive and hand off the exact changed-file
set, static evidence, remaining test-evidence hold, and the focused/full test
command for a later authorized verification pass.
## Pass 4 — updated authority audit before the next repair

The updated authority was re-read before this pass. The source-bound authority
is `pyramiddevelopment.md`, SHA-256
`a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`. Its
applicable scheduler companion is
`AUDIT_DRIVEN_INTEGRATION_PYRAMID_WITH_HYBRID_SCHEDULER.md`, SHA-256
`3cef7fcb7897ad44f7975c1c6cb50cd20ca82cfa1ce1c3c8849c18de9aedda10`.
The central source remains commit
`590c07ddd4be7a8c24727c24b40808e44ca7357d`, tree
`f1b358d87e6a969fb9631e202a3d478540edd4d9`. The feature inventory still
binds this lane to `docs/roadmap.md`, `docs/release-promotion.md`, and
`schemas/release-lifecycle.v1.json`; no release-specific research record is
linked, so research-backed claims remain unknown unless source-bound evidence
is supplied.

### Updated intent and actual state

The authority confirms the existing roadmap intent: feature audit and repair
must converge to a clean local handoff; reports remain append-only; a feature
does not become consumed merely because its report was read; exact candidate
identities and current state must be pull-readable; and ordinary migration,
fixture, stale-candidate, or proof gaps are repair work. The scheduler overlay
requires candidate-bound proof, stale-candidate cancellation, durable terminal
classification, and Central-owned scheduler admission. It is not a second
feature or platform lane.

The prior repair already supplies typed compatibility cases, migration phases,
policy replay, finite model checks, an independent safety join, exact sterile
artifact identity, and an inactive promotion boundary. The updated migration
provenance clause is not yet represented: the migration plan has no exact
journal classification, immutable migration-source digest, or load-bearing
object fingerprint set.

### Updated material finding

`UA-09-MIGRATION-PROVENANCE` — the migration contract cannot distinguish
`JOURNALED`, `INTENTIONALLY_JOURNALLESS`, and `MISSING_OR_UNPROVEN`. Without
that distinction, a release can treat an absent journal row as an ordinary
sequence gap, rerun a non-idempotent migration, or accept a journal-less
migration without immutable source and read-only fingerprints for schemas,
functions, indexes, triggers, policies, RLS posture, grants, and revokes.
This is an ordinary bounded contract repair, not a true external blocker.

The scheduler seam is recorded rather than duplicated: any later heavyweight
release verification must be admitted by the Central-owned scheduler against
the exact clean candidate commit/tree or content digest and terminal result.
This pass performs only lightweight source/schema/hygiene checks by explicit
instruction, so no scheduler lane or scheduler proof receipt is created here.

### Updated repair action

Add the journal classification, immutable migration-source digest, journal
entry digest where applicable, and deterministically ordered load-bearing
fingerprints to the migration plan. Bind the classification, source digest,
and fingerprint digest into compatibility evidence; make
`MISSING_OR_UNPROVEN` ineligible for a passing compatibility or safety gate;
update the schema, release documentation, and focused hostile coverage. Keep
the release inactive, preserve predecessor identities, and retain the
functional-verification hold.

## Pass 5 — repair self-audit

The affected-surface self-audit found and corrected one precision issue before
re-audit: a journal-row digest alone did not expose the exact journal key and
checksum required by the authority. The repaired plan now carries the key,
checksum, full journal-row digest, immutable migration-source digest, and
ordered fingerprints. `JOURNALED` requires all journal fields;
`INTENTIONALLY_JOURNALLESS` requires a nonempty fingerprint set; and
`MISSING_OR_UNPROVEN` carries no journal evidence and cannot produce a passing
compatibility result.

The schema and controller field sets are aligned by inspection. Compatibility
records bind the migration plan digest, provenance classification, source
digest, and fingerprint digest. The safety join still requires passing
compatibility, replay, and model records from the same candidate and the same
independent checker, while every activation and external-action field remains
false. The repair does not add a provider, project, database, scheduler, or
deployment policy.

Allowed static evidence after the repair: `node --check` passed for all seven
release controllers and the focused verifier; `jq empty` parsed all seven
release schemas and the blocker record; diff hygiene passed; and the scoped
privacy scan found no private path, credential, token, or unsafe link. No
functional verifier was run and no package-manager command was used.

## Pass 6 — final re-audit against updated roadmap, authority, schema, and docs intent

| Intent or seam | Re-audit result | Evidence or disposition |
| --- | --- | --- |
| Development and sterile release identities remain separate | PASS | `control/release-lifecycle.mjs`, `control/release-promotion-gate.mjs` |
| Migration provenance distinguishes journaled, intentionally journal-less, and unproven states | PASS | `control/release-compatibility.mjs`, `schemas/release-migration.v1.json` |
| Journal-less acceptance carries immutable source and load-bearing read-only fingerprints | PASS | `control/release-compatibility.mjs`, `schemas/release-migration.v1.json`, `schemas/release-compatibility.v1.json` |
| Old/new/mixed/failed/interrupted/reconciliation/rollback behavior is required | PASS | `control/release-compatibility.mjs`, `docs/release-promotion.md` |
| Policy replay and finite model checks remain independent and candidate-bound | PASS | `control/release-policy-replay.mjs`, `control/release-model-check.mjs`, `control/release-safety-gate.mjs` |
| Exact candidate, stale-proof, and scheduler seam | CENTRAL_SEQUENCE_REQUIRED | Later heavyweight proof must use the Central-owned scheduler against this clean candidate; this pass is static-only by instruction |
| Handoff custody and consumption boundary | READY_FOR_HANDOFF; downstream not consumed | Local branch and commit are required here; Central must preserve and inspect before consumption |
| Security, privacy, hygiene, minimality, durability, regression, and activation boundary | PASS within source scope | No private payloads, VCS metadata, symlinks, activation, publication, push, merge, deployment, or live claim introduced |

No new implementation defect remains. Bounded holds are functional verification
(`R-09-TEST-EVIDENCE`), owner/host readback (`R-09-OWNER-HOST`), and the
Central-owned scheduler/consumption seam. None is a genuine external blocker
for producing this local candidate. Exact recovery is to preserve and consume
the clean handoff, then admit the focused release verifier and full canonical
suite through the applicable scheduler against the exact handoff identity; a
failure reopens the report and keeps activation false. Owner activation and
host replacement remain separate custody actions.

### Changed paths and SHA-256

The following twenty changed source, schema, documentation, and verifier paths
are content-addressed in this handoff:

- `control/README.md` — `d02469ecbe6bbd50762da37b57531a857a890c10b0a14fa7696f3c9970c7b633`
- `control/release-common.mjs` — `ae25e94b542fa2b98f323d69e5cc6b02fb8929ad921bd8404e5caa34b13fcc60`
- `control/release-compatibility.mjs` — `b0e3927c8bc896b341a168e14798271e6004740396fc550b415c1c291491a871`
- `control/release-lifecycle.mjs` — `4bb6c5efab80c59a7ca997d2a1ee4da1d774c52555a3dae2e68f38ebdbe9b976`
- `control/release-model-check.mjs` — `06889618a79cfff9e3920e8122e28765bb4302b39528e339a843f517f0d2159e`
- `control/release-policy-replay.mjs` — `709a6370592d78e23e15a8b34845878da2247bb6447837334309982484174634`
- `control/release-promotion-gate.mjs` — `ab0464f1ef2b39e76ee4f2c013834124749e07af383031d7ff01befda50aceba`
- `control/release-safety-gate.mjs` — `023358be712b0969477d142cf57d5f5cfdc2a5f1cbd39b5ab231722004832a01`
- `docs/release-development-promotion-blocker.v1.json` — `28e59385f5fa362b36036b4637693948e4c455b70966fc80188219311d04ed99`
- `docs/release-promotion.md` — `6e156c14e60aff752a7e3935b3b864eeff31bc01d51991b8ab4d89c37e2b3cfe`
- `schemas/README.md` — `a35b54e2753fd04d427e02117ebbe5ced6f4574834d7ce0f81d309547b8dc3ae`
- `schemas/release-compatibility.v1.json` — `4b9fb837c1ea4d06f85f417d5c413fe430a397fc56d8764495183b78242587e5`
- `schemas/release-lifecycle.v1.json` — `f7522516f2dda74552ac441d1b9404625039cd510a256dbb2cf6279b0ea24c34`
- `schemas/release-policy-replay.v1.json` — `05362bf56b66eacd377d0abe6466c3832b0f1dbc3fd85c749305efd2881d0119`
- `schemas/release-promotion-gate.v1.json` — `8cc14ecb8d3134ff1824e7020f6797fa6ebc45a904013c1633e15718403f9764`
- `schemas/release-safety-gate.v1.json` — `27f386e70689400239f31f686b2e9eabe18db5abb0d9725a10e4b350d5be97f6`
- `tests/verify-all.mjs` — `3f31494143fc2b72ea9941c3bc82fa3c69d3c1f23ef6ac7c9ed50a7c890e4961`
- `tests/verify-release-safety.mjs` — `b25e80aa8f1350ed13d9c85e87d5f1b1c7d9c8b4d55817702361657ae86dd9e6`

The report itself is append-only and its terminal content hash is supplied in
the final local handoff readback rather than embedded in its own hash table.

### Append-only hash correction

The terminal cached hygiene check found and repaired one trailing blank line in
`control/release-promotion-gate.mjs`. Its earlier listed digest
`ab0464f1ef2b39e76ee4f2c013834124749e07af383031d7ff01befda50aceba` is
superseded by the corrected digest
`3057d4572851f2a5eec3ea2d35c8129d7c15be10d77238fa6d85e66e28e1711e`.
No behavior changed.

```text
CURRENT STATE
candidate: source_commit=590c07ddd4be7a8c24727c24b40808e44ca7357d; source_tree=f1b358d87e6a969fb9631e202a3d478540edd4d9; local_branch=codex/roadmap-09-release-migration-handoff
lifecycle: READY_FOR_HANDOFF
disposition: PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS
superseded_identities: accepted_baseline_commit=590c07ddd4be7a8c24727c24b40808e44ca7357d; accepted_baseline_tree=f1b358d87e6a969fb9631e202a3d478540edd4d9; prior pre-provenance state=UNCOMMITTED_NO_DURABLE_IDENTITY
seams: CENTRAL_SEQUENCE_REQUIRED scheduler admission and downstream consumption; OWNER_DECISION_REQUIRED host readback and activation; implementation seams=none
proof_ceiling: STATIC_SYNTAX_JSON_HYGIENE_ONLY; FUNCTIONAL_VERIFICATION_PENDING; SCHEDULER_TERMINAL_PROOF_NOT_OBTAINED
downstream_consumed: false
next_action: Central preserves and consumes this clean local handoff; later admit focused and full functional verification against the exact handoff, keeping activation false until the owner boundary
```

## Pass 7 — bounded stale shared-surface intake repair and re-audit

Central intake identified the prior handoff as stale on nine shared surfaces.
The authority readback for this pass remains central source commit
`590c07ddd4be7a8c24727c24b40808e44ca7357d`, tree
`f1b358d87e6a969fb9631e202a3d478540edd4d9`; the pyramid authority remains
SHA-256 `a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`
with scheduler companion SHA-256
`3cef7fcb7897ad44f7975c1c6cb50cd20ca82cfa1ce1c3c8849c18de9aedda10`.
The prior candidate under review was commit
`69405a03758a54168b65ec86aa3af65fc199b716`, tree
`c9a0a735ee6e3430bbb18437f91b25b1ae7dc6e9`.

### Rejected stale copies and repaired source comparison

| shared surface | stale candidate SHA-256 | current central SHA-256 | repaired disposition |
| --- | --- | --- | --- |
| `control/README.md` | `d02469ecbe6bbd50762da37b57531a857a890c10b0a14fa7696f3c9970c7b633` | `1f22c943fd4fb2bfb50c424e896aa2d620e0e5fc673bc0c98ab0bdccb5ad1ce0` | Central naming/operating-loop/Intent Regulator text retained; release bullet additive. |
| `control/release-lifecycle.mjs` | `4bb6c5efab80c59a7ca997d2a1ee4da1d774c52555a3dae2e68f38ebdbe9b976` | `fce8ea68a3d529837aa698f69500f41713d8efce630a7067174c341ac4b0f95f` | Central lifecycle retained; safety bindings, `.git` exclusion, and migration join additive. |
| `control/release-promotion-gate.mjs` | `3057d4572851f2a5eec3ea2d35c8129d7c15be10d77238fa6d85e66e28e1711e` | `37b37c505b9df4d4f000a162f1280675580313d06703217f6085f0fffda06f00` | Central tree/verification contract retained; full identities, `RELEASE_SAFETY`, safe paths, and evidence-derived status additive. |
| `docs/release-development-promotion-blocker.v1.json` | `28e59385f5fa362b36036b4637693948e4c455b70966fc80188219311d04ed99` | `2b4a4c80dff854d10f2e7e82959eb9532d341374c448e5e133b6d3b59007dbb5` | Carried additive blocker re-audited; central fields/actions retained with full checkout and safety fields. |
| `docs/release-promotion.md` | `6e156c14e60aff752a7e3935b3b864eeff31bc01d51991b8ab4d89c37e2b3cfe` | `a242e2fa84184a702bfde2146171f0c943ffd10cd2e219c5ec09e943953b3d7b` | Central boundary preface retained; typed release sequence appended. |
| `schemas/README.md` | `a35b54e2753fd04d427e02117ebbe5ced6f4574834d7ce0f81d309547b8dc3ae` | `df54826dc6dca4ee8879e9f3ab27e92a6a45d7855ac93efccac45cf6306b8a0d` | Central description retained; release routing appended. |
| `schemas/release-lifecycle.v1.json` | `f7522516f2dda74552ac441d1b9404625039cd510a256dbb2cf6279b0ea24c34` | `88b30f3c6a934dea4ad27ef7d796e2bc237e989c964b1e04dbf270ea7b6ea0d4` | Central schema retained; nullable candidate/request/receipt safety bindings added. |
| `schemas/release-promotion-gate.v1.json` | `8cc14ecb8d3134ff1824e7020f6797fa6ebc45a904013c1633e15718403f9764` | `bd099707b0b3d9c0d406e897894a257812719ed6497dc0ba9d6ae68c95c31df8` | Central metadata retained; identity, safety, and inactive-`2.1rc` invariants added. |
| `tests/verify-all.mjs` | `3f31494143fc2b72ea9941c3bc82fa3c69d3c1f23ef6ac7c9ed50a7c890e4961` | `6e6aff4856cb96a3bb4dccc2ee2d2021cebacc6492091d65c13baf0be0696772` | Exact central verifier restored (`cmp` passed); release verifier remains dynamically discovered. |

The stale verifier's role rename and stale assumptions were rejected in favor of
the current central verifier. No current central README or verifier contract was
replaced by the prior candidate copy. The authoritative lifecycle/gate imports
central digest/privacy primitives; those shared dependency files are outside
this nine-surface repair and remain a central-preservation seam for intake.

### Repair self-audit and re-audit

- Intent and boundary: PASS. Intent Regulator naming, the fifteen-minute
  operating loop, native-session contract, Bootstrap JSA safeguards, release
  separation, owner control, and inactive `2.1rc` behavior remain present.
- Actual implementation: PASS within scope. Central lifecycle and gate fields
  remain; safety evidence is candidate-bound and promotion requires a passing
  release-safety gate.
- Security/privacy/hygiene: PASS by static inspection. VCS metadata is excluded;
  changed paths reject traversal, separators, and sensitive names; records remain
  non-publishing, non-deploying, and non-activating. No secret, credential,
  private machine path, provider token, or chat link was added.
- Minimality/durability/regression: PASS. Docs/schema changes are additive;
  the central verifier is byte-exact; source, tree, artifact, manifest,
  verification, and safety identities remain content-addressed.
- Custody/seams: CENTRAL_PRESERVATION_REQUIRED for current central digest/privacy
  dependencies; CENTRAL_SEQUENCE_REQUIRED for scheduler admission and downstream
  consumption; OWNER_DECISION_REQUIRED for host readback and activation. These
  are custody seams, not implementation blockers.

Static evidence passed: diff hygiene, changed-script syntax, JSON parsing, central
verifier byte comparison, required-contract token checks, and blocker digest
recalculation. Functional verification was not run by instruction and is not a
blocker. Exact recovery is for Central to preserve the shared dependency bytes,
consume the clean handoff, then admit focused and full functional suites against
the exact handoff identity; failures reopen this append-only report and keep all
publication, deployment, and activation false.

### Bounded-repair file hashes before final handoff identity

- `control/README.md` — `2724ded80584530f48a394c38154502e1f79a80c486a12f299d63521967dd775`
- `control/release-lifecycle.mjs` — `5e87f9766936ebe047433f466125a005e769532bbef4504c471772c0b108c899`
- `control/release-promotion-gate.mjs` — `6d9eac4f7f1d534d5a8ca75aaeec7be78fc1896bedb5a40af74be4b5d39ea82e`
- `docs/release-development-promotion-blocker.v1.json` — `28e59385f5fa362b36036b4637693948e4c455b70966fc80188219311d04ed99`
- `docs/release-promotion.md` — `697632b4a5ac29232814be45f38163d807699888664ed0380b3d66cdc1b44603`
- `schemas/README.md` — `e5c2e9b9e28a6eacfa199f8bc0559822e9678a961498d492d5b9f5111cf4e29a`
- `schemas/release-lifecycle.v1.json` — `20723dd3516b24c590fae3d4efcd72f729f99b5dc3e9606dd64e01bbee543740`
- `schemas/release-promotion-gate.v1.json` — `cbf65084c2c19f10d90651beed4510f6942b758797c05859efc654a4c1b01c19`
- `tests/verify-all.mjs` — `6e6aff4856cb96a3bb4dccc2ee2d2021cebacc6492091d65c13baf0be0696772`

No true external blocker remains. Functional tests, central scheduler admission,
host readback, and downstream consumption are pending custody actions. The final
CURRENT STATE block will supersede this pre-handoff hash list after the clean
local handoff identity is created.

## Pass 8 — final handoff identity correction

The bounded repair was committed cleanly as the local handoff commit. This
correction supersedes the earlier CURRENT STATE block, which named only the
accepted central baseline.

```text
CURRENT STATE
candidate: handoff_commit=ffd9dd9f5407297ca8f24bf7db26701a8a4834ea; handoff_tree=ba3db5bb59940f4b62472664105e04ef1c6a201f; source_commit=ffd9dd9f5407297ca8f24bf7db26701a8a4834ea; source_tree=ba3db5bb59940f4b62472664105e04ef1c6a201f; local_branch=codex/roadmap-09-release-migration-handoff
lifecycle: READY_FOR_HANDOFF
disposition: PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS
superseded_identities: accepted_baseline_commit=590c07ddd4be7a8c24727c24b40808e44ca7357d; accepted_baseline_tree=f1b358d87e6a969fb9631e202a3d478540edd4d9; prior_stale_handoff_commit=69405a03758a54168b65ec86aa3af65fc199b716; prior_stale_handoff_tree=c9a0a735ee6e3430bbb18437f91b25b1ae7dc6e9
seams: CENTRAL_PRESERVATION_REQUIRED current central digest/privacy dependencies; CENTRAL_SEQUENCE_REQUIRED scheduler admission and downstream consumption; OWNER_DECISION_REQUIRED host readback and activation
proof_ceiling: STATIC_SYNTAX_JSON_HYGIENE_ONLY; FUNCTIONAL_VERIFICATION_PENDING; SCHEDULER_TERMINAL_PROOF_NOT_OBTAINED
downstream_consumed: false
next_action: Central preserves current shared dependency bytes and consumes this exact handoff commit/tree; then admits focused and full functional verification through the applicable scheduler, keeping publication, deployment, and activation false until the owner boundary
```

## Pass 9 — final source hash correction

The final indentation-only cleanup of `control/release-promotion-gate.mjs`
supersedes its pre-handoff hash in the Pass 7 list. The final file hash is
`4550a4d245b51960dc25515108c510d6a996f92f2d9c06b0bca2bf2792618bb5`.
No behavior, field set, handoff commit/tree, lifecycle, disposition, seam,
proof ceiling, or downstream-consumption state changed. All other Pass 7
file hashes remain current; the report's own final hash is supplied in the
local readback rather than embedded in its self-referential hash list.
- `schemas/release-migration.v1.json` — `b432c55f26d45e6a65f8a5a19610e8671426a1f744f996983c5c07cc80034446`
- `schemas/release-model-check.v1.json` — `b16d9c0b88b64a37aa0b0a23dee4629903310ff15cf61ae7c995be96194cdd0d`

## Pass 10 — append-only central report assembly readback

The complete updated-authority handoff from Pass 4 through Pass 9 is now
preserved in the central report. The final two schema-list lines above are the
remaining tail of the Pass 6 changed-path list carried forward during the
append-only transfer; they add no new claim and do not alter the Pass 9
terminal state. No prior report content was deleted or rewritten. The report
remains append-only, and its final content digest is computed after this
readback for the central intake manifest and binding.
