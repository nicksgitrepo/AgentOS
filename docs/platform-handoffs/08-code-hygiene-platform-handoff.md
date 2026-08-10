# Preserved platform handoff: 08-code-hygiene


## PLATFORM-FOUNDATION HANDOFF — CODE HYGIENE

Handoff status: `PRODUCTION_CANDIDATE_PENDING_TESTS`

Platform gate status: `CONTEXT_NEEDED`

This is a platform-foundation handoff only. It does not implement or release a
Product feature, create a hidden task, authorize an external action, or clear
the platform tree. The Controller must collect all platform-foundation
handoffs, independently audit and merge one platform tree, and keep feature
lanes held until that merge and its evidence are complete.

### Source binding and custody

- Source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`.
- Committed source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- The compared authoritative merge has the same commit/tree and the same
  pre-repair foundation/check files. The repaired Code Hygiene implementation
  and focused test are intentionally local to this lane.
- Working state is dirty with 289 pre-existing status entries. Therefore this
  is a source-bound candidate pending a fresh `CLEAN_EXACT_SOURCE` readback and
  tests, not a production clearance.
- Public evidence contains only relative repository paths, opaque Git/digest
  values, and portable summaries. No private worktree path, credential,
  session value, provider account, or external identity is carried forward.

### Shared skeleton and directory boundaries

- The platform skeleton is the portable control/schema/documentation tree, with
  the rapid implementation/test surface under `control/rapid-prototype/` and
  `tests/rapid-prototype/`.
- Code Hygiene owns exactly these implementation paths:
  - `control/rapid-prototype/code-hygiene.mjs`
  - `tests/rapid-prototype/code-hygiene.mjs`
- The lane must not write sibling lane modules/tests, the shared assembler
  `control/rapid-prototype/index.mjs`, the parent test
  `tests/verify-rapid-prototype.mjs`, shared plan/schema/role-registry files,
  product directories, generated/vendor/output directories, or private/control
  records.
- The public foundation and this audit report document the boundary; they do
  not authorize a feature implementation or a shared-skeleton rewrite.

### Technology-stack facts and recommendations

- Facts: the direct lane is portable Node ESM (`.mjs`), uses only the built-in
  `node:crypto` dependency for deterministic SHA-256 evidence, and has no
  filesystem, network, provider, publication, deployment, or package-manager
  effect. The merge review records no npm runtime/release dependency.
- Facts: focused checks are direct Node invocations; the platform verification
  contract uses `process.execPath` and forbids bare executable lookup through
  `PATH`.
- Recommendation: keep this lane dependency-light and direct-Node based. Add a
  formatter, linter, generated-file rule, or dependency policy only through
  typed project configuration or an authority-corpus extension; do not invent
  project conventions in the portable kernel.
- Recommendation: preserve canonical sorting/digest behavior and the existing
  public API. Any shared digest consolidation is a separately reviewed
  compatibility change, not a cleanup side effect.

### Routing and feature boundaries

- Code Hygiene owns changed-path scope, path safety classification, deterministic
  result construction, and the portable handoff/delegation summary.
- Source identity, cwd/project binding, and stale-source invalidation route to
  host readback/evidence/verification boundaries.
- Public-content, credential, private-context, provider/account, URL, and
  session-record scanning routes to Security and Privacy.
- Generated-file ownership, regeneration, dependency policy, and maintenance
  thresholds route to typed project configuration or the authority corpus.
- Independent clearance routes to the separate auditor. `CLEAN` in this lane
  means exact declared path scope only; it is not independent acceptance.
- `control/rapid-prototype/index.mjs` consumes `hygiene.status === "CLEAN"`
  before assembling the local slice. A non-clean result must hold the dependent
  outcome and must not release a feature lane by narration.

### Shared contracts to carry into the platform merge

- `portable.changed_path_validation.v1` — deterministic path validation,
  accepted/rejected path evidence, findings, and validation digest.
- `portable.code_hygiene_result.v1` — Code Hygiene result envelope with status,
  exact scope, path validation, and result digest.
- `portable.code_hygiene_handoff.v1` — `REQUESTED` independent check,
  `NOT_CLAIMED` clearance, named `INDEPENDENT_AUDITOR`, digest-bound evidence,
  delegated checks, and open risks.
- `IMPLEMENTATION_CODE_HYGIENE` and the exact two-path allowlist are stable
  role/scope identifiers. Shared plan contracts still require pre-write source
  identity, hostile coverage, typed handoff, no shared writes, and independent
  acceptance before feature-lane release.
- The handoff must remain paired with the parent implementation receipt and
  the clean-source/verification receipt; neither receipt may be replaced by
  this prose summary.

### UI/design direction

- No Product UI, visual asset, navigation, or design-system work belongs to this
  lane. Do not create a feature surface from a hygiene finding.
- The platform-facing result should remain plain, typed, and legible: `CLEAN`,
  `SOFT_REVIEW`, or `HARD_STOP`, with relative paths or digests and an explicit
  next handoff. Rendered owner-facing states remain the UI/UX lane's boundary.
- A soft review or hard stop must be visible as an unavailable/held platform
  outcome; it must not be styled or narrated as successful feature delivery.

### Security, privacy, and custody constraints

- Unsafe path inputs are digest-only and must not be echoed. Synthetic hostile
  strings remain verifier fixtures only; they are not runtime defaults or
  production records.
- Keep public kernel/report content free of secrets, private locations,
  credentials, session records, provider accounts, task identities, and domain
  policy. Exact host custody remains opaque control-plane evidence.
- No lane action may authenticate, spend, push, merge, publish, deploy, delete,
  activate, or take Product custody. `2.1rc` stays `PREPARED_NOT_ACTIVATED`.
- The Controller must preserve this handoff and all bound evidence before
  archiving temporary workers, and must independently verify custody and source
  identity before merging the platform tree.

### Unresolved owner/platform questions

These are platform-governance questions only; no Product feature question is
being introduced by this lane:

1. Which typed project configuration supplies the generated-file authority,
   dependency policy, and formatter/linter thresholds for the first consuming
   project?
2. Is a clean working tree mandatory for every platform handoff, or may a
   dirty but exactly bound candidate be admitted with an explicit owner-approved
   exception? The current verification contract requires clean exact source.
3. Which independent auditor and exact post-clean-source verification sequence
   will provide the final platform clearance and merge decision?
4. Should content/symlink/semantic-diff hygiene remain delegated to the owning
   platform boundaries, or should a later, separately scoped Code Hygiene
   extension add those checks?

### Controller release condition and next action

`RELEASE_FEATURE_LANES: HOLD`.

Next action: collect the remaining platform handoffs, obtain a fresh clean exact
source/cwd/commit/tree readback for this candidate, run the recorded bounded
verification sequence, and have the Controller's independent auditor compare
all platform handoffs before merging one platform tree. Only after that gate
passes may the Controller release feature lanes. If the clean readback or owner
answers remain unavailable, retain `CONTEXT_NEEDED` and preserve this handoff
without expanding scope.

