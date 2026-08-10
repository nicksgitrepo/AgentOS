# Cycle 1 — Release Candidate Rollout audit report

Audit date: `2026-08-07`

Feature: `RELEASE_CANDIDATE_ROLLOUT` — Test-Build, Release-Candidate, and
Owner-Accepted Rollout

Authority: `CURRENT_ACCEPTED_MERGE`

Baseline source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`

Baseline custody: the accepted merge working tree is dirty and is treated as
read-only authority. No private machine path, credential, provider token,
task identity, or chat link is persisted here. A clean baseline tree digest is
not asserted because producing one would change neither authority nor this
audit.

Functional test status: `PENDING` by task instruction. This cycle uses static
inspection, source/schema comparison, and hostile-case design only; no npm
command or functional verifier was run.

## Initial audit — intended behavior

The inventory and roadmap require a project-agnostic release boundary with
distinct test-build, release-candidate, owner-decision, promotion-prepared,
and inactive-release states. The intended flow is:

1. Allocate a canonical, monotonic test-build identity from a content-addressed
   ledger.
2. Build an exact, portable artifact manifest from a development or sterile
   checkout without persisting host paths or private content.
3. Assemble a release candidate bound to source, normative snapshot, artifact,
   and manifest identities.
4. Independently verify the sterile artifact, then hold the exact candidate for
   owner review.
5. Record an explicit owner decision. Approval may create a promotion request,
   but must never activate the release.
6. Require stable-target compatibility, target readback, previous-release
   retention, and a non-activating promotion receipt. `2.1rc` remains prepared
   and inactive until a separate owner activation decision exists.

The release boundary must fail closed on stale evidence, unsafe paths,
privacy material, invalid state transitions, contradictory verification, and
missing sterile-release custody. Rejection feedback must preserve the exact
candidate identity and route a repair or successor test build without
rewriting history.

## Initial audit — actual implementation

The accepted merge provides:

- `control/release-lifecycle.mjs` with strict release/test-build parsing,
  monotonic allocation, content-addressed artifact manifests, source and file
  identity checks, candidate transitions, owner decisions, rejection feedback,
  promotion requests, and non-activating promotion receipts.
- `schemas/release-lifecycle.v1.json` describing allocation, manifest,
  candidate, decision, feedback, request, and receipt records.
- `control/release-promotion-gate.mjs` and its contract/blocked record for the
  development-to-sterile boundary. It records evidence and never publishes,
  pushes, merges, deploys, or activates.
- Focused lifecycle and promotion-gate verifier modules, plus canonical
  discovery through the whole-project verifier.
- A public kernel export for the release lifecycle and promotion gate, while
  the accepted binding currently hashes the promotion-gate slice but omits the
  release-lifecycle controller, schema, and focused verifier.
- A short promotion-boundary article and an intentionally blocked
  `2.1rc` development-promotion record.

## Initial audit — missing findings and why they matter

### F-RC-01 — stable artifacts can enter the release-candidate state

`compileReleaseCandidate` derives `release_channel` from the manifest and
`validateReleaseCandidate` checks only equality with the parsed channel. A
stable `1.2.3` manifest can therefore become an `OWNER_ACCEPTED` candidate,
although the JSON schema requires `release_channel` to be
`RELEASE_CANDIDATE`. Promotion later rejects it, but the invalid state can
still reach owner review and be persisted.

Evidence: accepted `control/release-lifecycle.mjs`, candidate validation and
compilation; accepted `schemas/release-lifecycle.v1.json`, `releaseCandidate`
definition.

Why it matters: release-channel confusion weakens the owner boundary and
creates a runtime/schema contradiction at the exact point where rollout
authority is recorded.

Builder action: require the release-candidate channel both when compiling and
when validating a candidate; add a stable-manifest hostile case.

### F-RC-02 — artifact-content privacy omits session/task identities

Artifact file bytes are scanned for paths, environment values, secret-like
values, and private links, but `SESSION_OR_TASK_IDENTITY` is omitted from the
rejection loop. A UUID or equivalent task/session identity in a release file
can therefore enter an otherwise privacy-safe manifest.

Evidence: accepted `control/release-lifecycle.mjs`,
`assertArtifactBytesPrivacy`; the shared privacy contract includes
`SESSION_OR_TASK_IDENTITY` in `PRIVACY_CATEGORIES`.

Why it matters: release artifacts are portable and may be retained or
published later. Identity leakage violates the repository boundary and can
break custody even when the manifest itself contains only opaque digests.

Builder action: reject every nonzero privacy category for artifact bytes and
add a UUID hostile case.

### F-RC-03 — promotion changed paths are not constrained

`control/release-promotion-gate.mjs` declares `SAFE_PATH` but its generic
string sorter only checks nonempty, sorted, unique strings. Absolute paths,
backslashes, traversal, and control characters can be carried in
`changed_paths`, despite the contract saying those paths are contained.

Why it matters: the gate is a public handoff and its changed-path list is
release custody evidence. Unsafe values can leak host locations or mislead
exact review.

Builder action: validate each changed path as a safe relative portable path
and add traversal/absolute-path hostile cases.

### F-RC-04 — impossible calendar dates pass timestamp validation

Lifecycle timestamps match an ISO-looking regular expression and
`Date.parse`, but JavaScript normalizes dates such as February 31 instead of
rejecting them. Content-addressed evidence can therefore carry an impossible
event time.

Why it matters: ordering, retention, audit replay, and owner-decision custody
depend on truthful timestamps. A syntactically valid but impossible date is
not durable evidence.

Builder action: require a canonical UTC round trip and add an invalid-date
hostile case.

### F-RC-05 — owner decisions can be replayed onto settled candidates

`applyOwnerDecision` validates the decision/candidate binding but does not
require the candidate to still be `OWNER_REVIEW_PENDING`. Its lower-level
validator intentionally accepts a matching decision subject on a settled
candidate, so a caller can attempt to rewrite an already accepted/rejected
candidate through the apply helper.

Why it matters: owner decisions and candidate states are append-only custody
events. Reapplying a decision must fail rather than mutate a settled history.

Builder action: make `applyOwnerDecision` accept only a pending review
candidate and add a replay hostile case.

### F-RC-06 — canonical identity comparison can false-negative on key order

The artifact verifier uses `JSON.stringify` for source and file-array
comparisons even though the manifest digest is canonicalized. Equivalent
records with different JSON object insertion order can be rejected as
different sterile identities.

Why it matters: sterile readback must compare typed meaning, not incidental
serialization order. False mismatches create unnecessary release holds and
invite unsafe manual bypasses.

Builder action: compare canonical digests for semantic source/file identity and
add a reordered-record case.

### F-RC-07 — gate validation does not derive readiness from all evidence

The gate compiler requires all verification results to be `PASS`, but the
validator's expected-status expression does not check those results and also
accepts a caller-supplied blocked status even when all evidence is ready.

Why it matters: a forged or stale gate can report `READY_FOR_EXPLICIT_PROMOTION`
with pending verification, or preserve an untruthful status that downstream
code treats as authoritative.

Builder action: derive the status from source/sterile verification, all
verification results, and the explicit-owner flag; add pending-verification
and false-block hostile cases.

### F-RC-08 — release lifecycle is not fully bound in the normative registry

The accepted binding contains promotion-gate entries but does not hash the
release-lifecycle controller, schema, or focused verifier. The public kernel
exports the lifecycle, so this omission allows the central release primitives
to drift without the normal binding readback noticing.

Why it matters: exact source custody and independent verification are part of
the release promise, not optional documentation.

Builder action: add the three release-lifecycle paths and their final SHA-256
digests to the normative binding, and assert their presence in the focused
verifier.

## Initial audit — cross-cutting quality and boundary findings

- Quality: the implementation is cohesive and uses shared canonical/privacy
  primitives, but the seven gaps above leave runtime and contract edge cases
  under-specified.
- Hygiene/minimality: the release logic is isolated from product context and
  does not use npm. The focused verifier is appropriately synthetic; no
  unrelated feature repair is indicated.
- Security/privacy: symlink and unsafe-file checks are present; UUID content
  rejection and changed-path containment are missing until repair.
- Durability/regression: records are content-addressed and stale candidate
  checks exist, but invalid timestamps and replayable decision application
  need repair. The lifecycle verifier lacks the newly identified hostile
  cases.
- Custody: source, tree, manifest, candidate, owner decision, request, and
  receipt digests are represented. The normative registry omission and the
  lack of a clean authoritative tree digest prevent a complete custody claim.
- Boundary: the code correctly keeps activation, publication, push, merge,
  deployment, and project-repository mutation false. Host Git readback and
  sterile-release execution remain adapter responsibilities.
- Intent: `2.1rc` is explicitly prepared and inactive; no owner activation is
  inferred. The stable-candidate acceptance bug is the only observed intent
  contradiction in the local feature slice.

## Evidence and unknowns

Observed baseline evidence includes the inventory record, roadmap, release
article, lifecycle schema, promotion-gate schema, lifecycle controller,
promotion-gate controller, both focused verifier sources, and the blocked
promotion record. Their baseline SHA-256 values were read from the accepted
merge without writing to it. The inventory entry names owner-linked research
records, but no such research corpus is present in the public accepted merge;
owner research intent is therefore `UNKNOWN`, not inferred.

The accepted merge is a dirty development assembly. No sterile release
checkout identity, clean-source identity, actual host Git readback,
compatibility/migration replay, rollback execution, or explicit owner
activation decision is available in this audit. Those are required later
evidence, not reasons to fabricate a pass.

## Production readiness after initial audit

`NOT READY FOR PRODUCTION.` The feature is a useful prepared local slice, but
the recorded runtime/schema, privacy, custody, and hostile-path gaps must be
repaired before a production candidate can be offered. Functional tests remain
pending by instruction. `2.1rc` remains inactive.

## True blockers and exact recovery

There is no genuine external blocker to the scoped repair. The dirty accepted
merge, unavailable owner-linked research records, absent sterile checkout, and
pending functional tests are evidence limitations and explicit boundaries;
they do not authorize a bypass.

Exact recovery for final release readiness is: integrate the scoped repair,
run the focused lifecycle/gate, canonical, architecture, hygiene, and
portability checks on the exact clean source, build and independently verify a
sterile release checkout, review exact changed paths, preserve the resulting
receipts, obtain explicit maintainer promotion and later owner activation, and
keep all external effects disabled until those decisions are recorded.

## Builder actions

The same task now repairs only the recorded release findings in the isolated
worktree. Planned files are the release lifecycle controller and verifier,
promotion-gate controller and verifier, release lifecycle documentation, the
normative binding, and this append-only report. No unrelated project or
provider integration will be touched.

Initial status: `REPAIR_REQUIRED`

## Audit history — pre-repair self-audit extension

### F-RC-09 — promotion states are not evidence-bound on the candidate

The candidate schema exposes `PROMOTION_PENDING` and
`PROMOTED_PREPARED`, and the transition helper can enter those states, but a
candidate record has no request or receipt digest. The promotion request and
receipt separately point back to the earlier owner-accepted candidate, so a
state transition can be recorded without a durable candidate-side link to the
promotion evidence.

Why it matters: rollout state must be replayable from the candidate and its
receipts. Without the link, an auditor cannot prove which request/target
readback caused a prepared promotion state, and a later record can be
misassociated by narration.

Builder action: add nullable request/receipt digests to the candidate record,
require them for the promotion states, and provide non-mutating helpers that
advance the candidate only from a validated request and receipt. Preserve the
request digest when a promotion is blocked.

The repair scope is extended only by this release-lifecycle finding.

## Builder repair and self-audit

The builder repaired only F-RC-01 through F-RC-09:

- Candidate compilation and validation now require the release-candidate
  channel; stable manifests cannot become candidates.
- Artifact byte scanning now rejects every shared privacy category, including
  session/task UUID identities.
- Promotion changed paths must be safe, relative, portable, non-control paths.
- Lifecycle timestamps must round-trip to a real UTC calendar value.
- Owner decisions can only settle a still-pending review candidate.
- Sterile source/file identity comparison uses canonical meaning rather than
  JSON insertion order.
- Promotion-gate readiness is derived from verified source and sterile
  identities, all `PASS` verification results, and the inactive explicit-owner
  boundary. A false blocked/ready status is rejected.
- Candidate records now carry promotion-request and promotion-receipt digests;
  validated helpers bind `PROMOTION_PENDING` and `PROMOTED_PREPARED` states,
  while blocked promotion preserves request custody.
- The normative binding now includes the release-lifecycle controller,
  contract, verifier, and the repaired promotion-gate/document records.
- The release article now documents allocation, manifest privacy, owner
  decisions, promotion readiness, evidence binding, and exact recovery.

No unrelated project, provider, deployment, activation, or external delivery
surface was changed.

### Static self-audit evidence

- JavaScript syntax readback: `PASS` for both release controllers and both
  focused verifiers.
- Selected JSON parse readback: `PASS` for the binding, lifecycle schema,
  promotion-gate schema, and blocked promotion record.
- Release binding digest readback: `PASS` for all eight release entries.
- Scoped whitespace/final-newline readback: `PASS`.
- Persisted-path/private-link scan for the report and release documentation:
  `PASS`.
- Logical diff against the authoritative accepted feature files contains only
  the recorded repair hunks and their hostile-case coverage.
- Functional verifiers were not run, per instruction; no npm command was used.

### Re-audit findings

F-RC-01 through F-RC-09 are resolved by static source/schema/binding review.
The repaired implementation remains project-agnostic, deterministic,
content-addressed, inactive, and fail-closed at the owner and sterile-release
boundaries.

Cross-cutting re-audit:

- Quality/minimality: repairs are local guards, evidence links, documentation,
  and focused hostile cases; no duplicate provider or product policy was
  introduced.
- Hygiene/security/privacy: path, symlink, secret-like, environment, private
  link, and task/session identity boundaries are explicit in the release
  slice; synthetic hostile strings remain test-only fixtures.
- Durability/regression: timestamps, canonical identity, monotonic allocation,
  stale candidate checks, and promotion evidence links are now checked by the
  focused verifier source; execution remains pending.
- Custody: lifecycle files and their final digests are in the normative binding;
  candidate promotion states point to request/receipt evidence.
- Boundary/intent: publishing, pushing, merging, deployment, activation, and
  project-repository mutation remain false. `2.1rc` remains prepared and
  inactive; no owner decision is inferred.

## Remaining findings and production candidate status

The local repair has no remaining implementation finding in this feature
slice. The following evidence is intentionally still pending and is not
converted into a pass:

- Functional lifecycle, gate, canonical, architecture, hygiene, and
  portability verification on the exact integrated source.
- A clean source identity and independently verified sterile-release checkout.
- Owner-linked research records named by the inventory.
- Compatibility, migration, policy-replay, model-check, rollback, and
  provider/host receipt evidence required for a broader production release.
- Explicit maintainer promotion and the separate owner activation decision.

Status: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS_AND_STERILE_RELEASE_CUSTODY`

Production readiness: `NOT CLAIMED`; the prepared `2.1rc` release is inactive.

## Changed files and exact next action

Logical repair delta relative to the authoritative accepted feature slice:

- `control/release-lifecycle.mjs` — `3ca59f3964705243ccbc86119f3f31ac47ccefae37f358fbace66ddc83d22776`
- `control/release-promotion-gate.mjs` — `c93e8f012d033acba4b69f2249eb81fffbf6277edf67a784053879f1b162db4d`
- `schemas/release-lifecycle.v1.json` — `7faa3aec9863a4eb966c1f7d9fad8fad8044275466045098a86f5bd16d1b1959`
- `tests/verify-release-lifecycle.mjs` — `6d601945c2221281f8d446974eb3aae89574348f719636c2f0e04eccca1059ea`
- `tests/verify-release-promotion-gate.mjs` — `814dbaa66e01ce2fbdaa5dbe67aca8fc31808ccf88b63ae58948ba8ecfe67625`
- `docs/release-promotion.md` — `1e823212746740d3d8c2c2de5c709b58a5d86f47c4e13f93f16d42735e057759`
- `schemas/bootstrap-binding.v1.json` — `d03cac1eabfbb29f891ed24d6370c7f706b52d74eeb6911fe12acd167d8010ac`
- `docs/feature-audits/RELEASE_CANDIDATE_ROLLOUT/auditreport.md`

The schema/gate/blocker files carried into this isolated worktree unchanged
from the accepted feature slice are retained as integration context; their
release binding entries are included for exact merge readback.

Exact next action: run the pending functional verifiers on a clean integrated
source, then independently verify the sterile release checkout and preserve
the resulting evidence. Do not publish, push, merge, deploy, or activate.

Final cycle status: `FINISHED_PENDING_REQUIRED_TESTS_AND_EXTERNAL_RELEASE_EVIDENCE`
