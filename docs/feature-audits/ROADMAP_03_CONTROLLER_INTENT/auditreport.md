# ROADMAP_03_CONTROLLER_INTENT — Controller-Owned Intent and Low-Chat Operation

Status: `INITIAL_AUDIT_REPAIR_PENDING`

Audit date: `2026-08-07`

Baseline: `CURRENT_ACCEPTED_MERGE`; source `HEAD` commit `590c07ddd4be7a8c24727c24b40808e44ca7357d`, source `HEAD` tree `f1b358d87e6a969fb9631e202a3d478540edd4d9`. The accepted merge working tree is intentionally dirty and was read-only authority for this audit. The isolated auditor worktree is the only writable scope.

Functional tests were not run, per task instruction. No npm dependency or command is used.

## Inventory and intent sources

The inventory record is `docs/feature-inventory.v1.json`, feature `ROADMAP_03_CONTROLLER_INTENT`, with source catalog entries `docs/roadmap.md`, `schemas/controller-supervisor.v1.json`, and `schemas/continuous-operating-loop.v1.json`. The inventory is `PREPARED_NOT_ACTIVATED`; it authorizes audit coverage, not activation or delivery.

The complete intent readback covered:

- `docs/roadmap.md`, section 3: the Controller owns goals, evidence, routing, repair, reassessment, and closure; agents propose/report; routine puzzles remain autonomous; real choices stop at the owner boundary; progress is distinct from liveness; and the end-to-end cases include success, repair, owner choice, changed goal, unavailable dependency, and hard stop.
- `schemas/controller-supervisor.v1.json`: one deterministic bounded goal per observation, hard/soft/puzzle/liveness/idle precedence, source-bound observations, content-addressed history, explicit owner approval for activation, and no inferred Product or protected action.
- `schemas/continuous-operating-loop.v1.json`: persistent Intent Regulator and Runtime, fifteen-minute meaningful-progress default, heartbeat/plan/failure-list non-progress, full active-worker inspection, source/intent reassessment, repair/replacement sequence, predecessor handoff custody, independent clearance, and retained host failures.
- `governance/2.1rc/portable-kernel.md`, `docs/rapid-foundations/01-intent-and-scope.md`, `docs/rapid-foundations/03-user-conversation.md`, `docs/rapid-foundations/05-progress-and-health.md`, `docs/rapid-foundations/10-evidence-and-identity.md`, and `docs/rapid-foundations/11-recovery-and-boundaries.md`: project-agnostic authority, one short owner question only for a real unresolved choice, fail-closed identity/evidence boundaries, bounded repair, and no silent topology or custody expansion.
- `docs/architecture.md`, `docs/control/README.md` equivalent control documentation, `docs/user-guide.md`, and `docs/operator-guide.md`: Bootstrap is separate from the ongoing Intent Regulator; Runtime is the deterministic state writer; Campaign Orchestrator owns temporary worker routing; Auditor remains independent; and `2.1rc` stays inactive.

The inventory also names `research-records-linked-by-owner`, but no linked research-record corpus is present in the accepted merge. This is recorded as an evidence unknown, not treated as permission to infer intent. The portable roadmap, governance, schemas, and implementation contracts are sufficient for the bounded audit; owner-linked research can be supplied later without changing the kernel.

## Intended behavior

The production candidate must:

1. Keep one authoritative, source-bound Controller goal at a time and make equivalent observations idempotent.
2. Derive routing from typed boundaries and findings with hard-stop precedence over soft review, puzzle repair, liveness reconciliation, and idle waiting.
3. Keep ordinary engineering puzzles inside admitted campaign custody while refusing scope, intent, authority, identity, evidence, credential, destructive, external, Product, deployment, publication, push, merge, and release expansion.
4. Reassess and close the current goal when source or intent changes, preserving the predecessor and requiring a fresh bound goal.
5. Distinguish meaningful progress from heartbeat, plan, failure-list narration, and liveness; inspect every active worker and require a source-bound typed handoff.
6. Treat identity/evidence/authority blockers as Intent Regulator review, never as an Orchestrator success path.
7. Preserve exact repair and host-closure history without persisting secrets, credentials, private paths, provider tokens, task identities, deployment identities, or chat links.
8. Keep the owner surface concise and plain-language, asking one short question only when a real owner choice is missing. Technical acceptance, activation, and protected action remain separate.

## Actual implementation readback

The accepted merge contains the intended slice in `control/controller-supervisor.mjs`, `control/controller-supervisor-runtime.mjs`, `control/continuous-operating-loop.mjs`, `control/intent-regulator-runtime.mjs`, the persistent Runtime seam, the two feature schemas, the local self-development supervisor adapter, and focused verifiers. The implementation already has useful positive coverage for deterministic digests, hard/soft/puzzle/liveness selection, CAS records, source/intent drift, heartbeat-only timer expiry, active-worker inspection, predecessor-bound replacements, host receipts, independent clearance, symlink rejection, Runtime fencing/recovery, and inactive activation.

The Controller supervisor derives its action from observation boundaries and open findings, and the continuous loop gives `TRUE_BLOCKER` observations `route_to: INTENT_REGULATOR`. The gaps below are in the transition enforcement around those otherwise-correct records.

## Initial findings

### F03-01 — Caller-supplied goal IDs defeat equivalent-observation identity

Severity: `HIGH`; classification: `REPAIRABLE_ENGINEERING_PUZZLE`; status: `OPEN_REPAIR_REQUIRED`.

Evidence: `control/controller-supervisor.mjs` `compileSupervisorGoal` accepts an optional `goalId` and uses it directly instead of requiring the observation-derived `CONTROLLER-GOAL-<observation digest>` identity. The schema requires one deterministic goal per observation, but the focused verifier does not attempt two different caller IDs for the same observation.

Why it matters: two equivalent observations can create different authoritative goal identities, allowing duplicate work, broken idempotency, and ambiguous predecessor history. This violates controller ownership and makes low-chat continuation dependent on an outside caller choosing the right label.

Recovery: derive the stable ID unconditionally and reject any supplied override that does not equal it. Add a hostile verifier for mismatched overrides and preserve the deterministic default.

### F03-02 — A true blocker can enter the replacement path

Severity: `CRITICAL`; classification: `TRUE_BLOCKER`; status: `OPEN_REPAIR_REQUIRED`.

Evidence: `control/continuous-operating-loop.mjs` classifies missing/stale source, missing evidence, scope drift, or missing typed handoff as `TRUE_BLOCKER`, and `compileLoopInspection` routes that observation to `INTENT_REGULATOR`. However, `runContinuousOperatingLoopIteration` continues from `ORCHESTRATOR_REPAIR` whenever a caller supplies a repair record and predecessor, then can mint a replacement goal and accept it after Auditor clearance. There is no guard that blocks the Orchestrator path when a report is `TRUE_BLOCKER`.

Why it matters: an identity/evidence/authority failure can be converted into apparent success by the wrong custody owner. Independent clearance cannot grant the missing authority. This is a direct violation of the true-blocker rule and can cause stale or unproven work to continue.

Recovery: return a preserved `INTENT_REGULATOR_REVIEW_REQUIRED` result before accepting a repair or predecessor for any `TRUE_BLOCKER`; persist the inspection as the evidence root; add hostile coverage proving that neither a repair callback nor independent-clearance-shaped input can create a replacement.

### F03-03 — Host-failure retention can persist raw error text

Severity: `HIGH`; classification: `SECURITY_PRIVACY`; status: `OPEN_REPAIR_REQUIRED`.

Evidence: `control/continuous-operating-loop.mjs` `compileHostFailure` copies `error.message` into the durable repair workflow record, and the patch-adapter catch path copies the raw message into root-cause summary. The accepted merge has a privacy helper for the supervisor runtime, but the continuous-loop module does not use an equivalent safe representation.

Why it matters: host errors can contain private paths, subprocess details, credentials, provider/account fragments, or external links. The public kernel must retain the failure class and reproducible digest without echoing sensitive text.

Recovery: replace persisted error text with a stable opaque digest message and retain only the phase plus raw-receipt digest; update the continuous-loop contract wording and add a hostile privacy assertion that unsafe error text never appears in a retained record.

### F03-04 — Functional and independent acceptance evidence is unavailable

Severity: `HIGH`; classification: `UNAVAILABLE`; status: `OPEN_NEXT_REQUIRED_BEHAVIOR`.

Evidence: the accepted merge review explicitly records static inventory/privacy/binding review only; the feature verifiers are present but have not been run in this task. The accepted merge is dirty, so no clean committed candidate/tree readback exists for production clearance. The owner-linked research records named by the inventory are also not available.

Why it matters: a deterministic-looking contract is not a production acceptance record. The roadmap requires end-to-end success, repair, owner choice, changed goal, unavailable dependency, hard stop, independent review, and clean-source evidence.

Recovery: after this bounded repair, obtain a clean exact source commit/tree, run the focused Controller and continuous-loop verifiers plus the parent suite, independently review the resulting evidence, and record any owner-linked research input. Until then, keep the candidate prepared and inactive.

## Cross-cutting audit lenses

- Quality: `PARTIAL`. The decision functions are small and deterministic, but F03-01/F03-02 expose transition authority gaps.
- Hygiene/minimality: `PARTIAL`. The feature is separated into controller, runtime, loop, schema, and verifier surfaces; the unbound goal override and raw error echo are unnecessary authority/data surfaces.
- Security/privacy: `FINDING`. F03-03 must be repaired before production claims. Protected-action flags and supervisor redaction are positive evidence.
- Durability: `PARTIAL`. CAS and content-addressed per-observation records exist; end-to-end functional persistence/closure proof remains pending under F03-04.
- Regression: `UNPROVEN`. Focused and whole-project verifiers exist; no functional test execution is claimed.
- Custody: `FINDING`. F03-02 permits the wrong route to act on a true blocker; normal worker replacement and independent Auditor separation are otherwise explicit.
- Boundary: `FINDING`. Hard/soft precedence is present, but true-blocker enforcement is incomplete.
- Intent: `PARTIAL`. Roadmap, schema, governance, and owner-surface intent agree; caller-supplied goal identity is not fully controlled.

## True blockers and exact recovery

No genuine external blocker was accepted. The missing research corpus and functional evidence are re-framed as bounded evidence work, not reasons to invent behavior or stop repair. The only permitted next external authority is an independent test/clearance run and, if later needed, owner-linked research supplied through the control plane. No activation, publication, push, merge, deployment, authentication, spending, or protected action is requested or performed.

## Builder actions for this pass

1. Repair F03-01 in the supervisor engine and add a mismatch hostile check.
2. Materialize the authoritative continuous-loop slice in the isolated worktree only as needed for the recorded F03-02/F03-03 repairs; do not copy unrelated merge work.
3. Prevent `TRUE_BLOCKER` replacement and preserve the Intent Regulator review route.
4. Opaque-hash retained host error text and update the contract statement.
5. Re-audit all four findings and retain resolved findings in this append-only report. Functional tests remain pending.

## Initial production readiness

`NOT READY FOR PRODUCTION; BOUNDED REPAIR CANDIDATE ONLY.`

The accepted merge demonstrates substantial implementation, but the true-blocker custody bypass, deterministic goal-ID override, raw host-error retention, dirty source state, unavailable functional checks, and missing linked research evidence prevent production clearance.

## Audit continuation finding before repair

### F03-05 — Supervisor route-failure ticks can expose raw adapter errors

Severity: `HIGH`; classification: `SECURITY_PRIVACY`; status: `OPEN_REPAIR_REQUIRED`.

Evidence: `control/controller-supervisor.mjs` `runSupervisorIteration` and `runSupervisorIterationAsync` pass the adapter error text into the durable tick shape. The runtime redacts its separate runtime/RCA fields, but the tick itself is written through the supervisor record path without an opaque transformation. The existing verifier asserts the raw route message rather than its safe representation.

Why it matters: a route adapter error can contain a private path, provider/account detail, credential fragment, or external link. The Controller record must preserve failure classification and reproducibility without making raw host text part of the source-bound history.

Recovery: normalize every `ROUTE_FAILED` tick error to a stable opaque digest at tick compilation, pass only the in-memory error into that compiler, and assert hostile raw-text absence in the focused verifier.

Builder action added: repair F03-05 before the final self-audit; retain F03-03 separately because it covers the continuous-loop repair and host-closure records.

## Builder repair pass 1

Recorded findings were repaired only in the isolated worktree:

- F03-01: `compileSupervisorGoal` now derives the goal ID unconditionally from the observation digest and rejects a mismatched caller override. The Controller default display is aligned to `Intent Regulator`. `tests/verify-controller-intent-hardening.mjs` defines the hostile mismatch case.
- F03-02: `runContinuousOperatingLoopIteration` now returns `INTENT_REGULATOR_REVIEW_REQUIRED` immediately when any inspected active worker is a `TRUE_BLOCKER`, before it accepts a repair, predecessor, replacement callback, or clearance-shaped input. The inspection and preserved evidence digest remain in the returned result.
- F03-03: continuous-loop host failures now retain an opaque deterministic error digest; patch-adapter root-cause summaries use the same safe form. The continuous-loop contract now says opaque error digest rather than exact error text. The hostile verifier defines raw-text absence for a retained host failure.
- F03-05: supervisor route-failure ticks now normalize the error at tick compilation to an opaque deterministic digest. Synchronous and asynchronous adapters pass only transient error text to that compiler, and the existing verifier now asserts raw-text absence.

Changed feature-scoped files: `control/controller-supervisor.mjs`, `control/continuous-operating-loop.mjs`, `schemas/continuous-operating-loop.v1.json`, `tests/verify-controller-supervisor.mjs`, `tests/verify-controller-intent-hardening.mjs`, and this report. No unrelated project or product files were changed.

## Self-audit and re-audit pass 1

Static re-audit evidence:

- The continuous-loop implementation was materialized from the accepted merge slice and differs only at the recorded F03-02/F03-03 repair points.
- Goal identity is now observation-derived even when a caller supplies a non-null `goalId`; the mismatch is rejected before a goal record can be minted.
- A `TRUE_BLOCKER` inspection cannot reach predecessor validation, patch application, replacement creation, or independent-clearance handling in the iteration transition.
- Continuous-loop host-failure `error_message` and patch-failure root-cause `summary` are opaque digests; raw receipts remain represented only by their digest.
- Supervisor route-failure ticks are opaque before they enter the tick record and before the runtime writes the record path.
- `node --check` passed for the changed JavaScript modules and focused verifiers. `git diff --check` passed. Sensitive-path/link scan returned no matches in the feature report or changed feature files.
- Functional verifiers were not run, per instruction. No npm command or dependency was used.

Finding disposition after re-audit:

- F03-01: `RESOLVED_PENDING_TESTS`. Static repair and hostile case are present; functional execution remains part of F03-04.
- F03-02: `RESOLVED_PENDING_TESTS`. The custody guard is before all replacement inputs; functional execution remains part of F03-04.
- F03-03: `RESOLVED_PENDING_TESTS`. Continuous-loop contract and retained-record paths are opaque; functional privacy assertion remains part of F03-04.
- F03-05: `RESOLVED_PENDING_TESTS`. Tick compilation and verifier expectation are aligned; functional execution remains part of F03-04.
- F03-04: `OPEN_NEXT_REQUIRED_BEHAVIOR`. Clean-source, focused functional, parent-suite, independent-clearance, and owner-linked research evidence are still unavailable.

Re-audited quality lenses: quality `IMPROVED_PENDING_TESTS`; hygiene/minimality `PASS` for the bounded repair; security/privacy `PASS` statically with functional confirmation pending; durability `PARTIAL` pending clean-source persistence proof; regression `UNPROVEN`; custody `PASS` statically for true-blocker routing; boundary `PASS` statically for the repaired transition; intent `ALIGNED` across roadmap, schemas, implementation, and hostile cases. No new feature-scoped gap was found in this pass.

## Final production readiness and exact handoff

Status: `CONTEXT_NEEDED` — production candidate pending functional and independent clearance.

No genuine external blocker was accepted. F03-04 is an evidence/authority handoff, not permission to infer behavior or activate `2.1rc`. Exact recovery is to obtain a clean source commit/tree for this repaired slice, run the focused Controller, continuous-loop, and hardening verifiers plus the parent suite without npm, have an independent reviewer inspect the retained records, and supply the inventory-named owner-linked research corpus if it is required for final intent confirmation. Record all results in a follow-up audit append before any activation decision.

Remaining findings: only F03-04. The next action is the clean-source functional and independent review handoff; until that evidence exists, keep the candidate prepared, inactive, and outside Product, deployment, publication, push, merge, release, credential, destructive, and external-action boundaries.

## Privacy re-audit addendum — source/report drift repair

The prior static report described opaque retained host errors, but the current
source readback still copied raw adapter text into continuous-loop host failures
and patch-failure root-cause summaries. That drift is now repaired: both paths
retain only `opaque:error:<sha256>` values while the raw error remains transient
in memory for the digest operation. The hostile verifier now injects a private
path and provider-like value and asserts that neither appears in the retained
record. Functional execution remains pending and no production or activation
claim is made.

The same re-audit confirms the supervisor tick boundary: route failures are
normalized to an opaque deterministic digest at tick compilation, so a
caller-provided path, provider detail, or secret fragment cannot enter the
retained tick. The focused verifier now asserts that the raw route message is
absent.

## Central integration intake — 2026-08-09

- visible_task_ref: TASK_REF_ROADMAP_03_CONTROLLER_INTENT_VISIBLE
- isolated_worktree_ref: WORKTREE_REF_32E9
- source_head: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- source_tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- isolated_report_sha256: `ea45c99f306b76d074a13c681dc913d630f6c81ef23b9a4021100df0ecc84253`
- central_disposition: SOURCE_BOUND_CANDIDATE_INTEGRATED_PENDING_BINDING_REFRESH
- changed_path_disposition: continuous operating loop, schema, and focused verifier hardening integrated; binding refresh deferred until combined source is settled
- functional_status: NOT_RUN_BY_INSTRUCTION
- archive_status: WITHHELD_UNTIL_DOWNSTREAM_REVIEW
Remaining findings: only F03-04. The next action is the clean-source functional and independent review handoff; until that evidence exists, keep the candidate prepared, inactive, and outside Product, deployment, publication, push, merge, release, credential, destructive, and external-action boundaries.

## Cumulative wave-02 audit pass — 2026-08-09

### Source authority and intent readback

This pass audited the cumulative candidate on branch `codex/feature-integration-wave-02`, cumulative HEAD `f0336c53ac5ffa63917891f481d56c4e5d6cce8f`, cumulative tree `7a3526b2d0d1718a69b2524a86bbfd5ba591687d`, and the feature code candidate at commit `b9c1dcd524dabd8b3d7248e38693e9ce9cd915e1` with tree `b31f00136f614d0b99676612550a17cd9dec4ce1`. The cumulative candidate is the read-only source authority for this pass.

The inventory still identifies `ROADMAP_03_CONTROLLER_INTENT` as `Controller-Owned Intent and Low-Chat Operation`, sourced from `docs/roadmap.md`, `schemas/controller-supervisor.v1.json`, and `schemas/continuous-operating-loop.v1.json`. The roadmap promise remains one Controller-owned goal/evidence/routing/repair/reassessment/closure authority, low-chat operation, bounded routine repair, hard owner boundaries, meaningful-progress distinction, and independent acceptance. `2.1rc` remains prepared and inactive.

The wave-02 candidate adds or tightens the feature slice with shared canonical content addressing, privacy-safe persisted text, source-bound governance test-build identities, predecessor-bound repair evidence, exact host-receipt operation/session/source/progress bindings, source/intent stale-repair rejection, durable directory fsync after CAS rename, supervisor cadence documentation, and dedicated liveness/continuous-loop coverage. These are positive source changes and were read as authority; no Bootstrap or global binding file was cross-edited.

### Wave finding F03-01-W02 — cumulative Controller still accepts a goal-ID override

Severity: `HIGH`; classification: `REPAIRABLE_ENGINEERING_PUZZLE`; status before repair: `OPEN_REPAIR_REQUIRED`.

Evidence: the cumulative candidate's `compileSupervisorGoal({observation, goalId})` still selected `goalId` when non-null, even though the schema and roadmap require one deterministic goal identity for an equivalent observation. The wave-02 focused verifier covered opaque route failure, liveness, and CAS behavior but did not supply a hostile mismatched goal ID.

Why it matters: an outside caller could mint a second authoritative label for the same observation, weakening idempotency, predecessor custody, and low-chat continuation. This is a Controller-owned identity decision and cannot be delegated to a caller label.

Recovery: derive `CONTROLLER-GOAL-<observation digest prefix>` unconditionally, reject a non-null mismatch, and preserve a hostile verifier. No shared policy, Bootstrap, binding-manifest, or platform file is needed for this repair.

### Wave custody seam and evidence unknowns

The new controller cadence schema names `OPERATIONS.HEARTBEAT_INTERVAL_MINUTES`, while the Bootstrap/global-policy and binding-manifest owners supply the typed policy value. This lane does not own those shared Bootstrap/binding files and made no semantic edit to them. Exact recovery is for the owning lane to refresh the settled policy/binding manifest, then the central Controller to rebind the supervisor cadence and source digest against that clean shared checkpoint. This is a custody seam, not a true blocker or permission to cross-edit.

Owner-linked research records named by the inventory remain unavailable. Functional tests, schema-engine execution, clean isolated-tree acceptance, and independent clearance remain pending by instruction. No behavior is inferred from those unknowns.

### Wave builder actions

1. Preserve the prior report and materialize only the cumulative Controller Intent implementation, its exact schemas/verifiers, and the unchanged content-addressing/privacy support dependencies needed by that implementation.
2. Repair F03-01-W02 in `control/controller-supervisor.mjs` and add the hostile mismatch case in the focused verifier.
3. Reconcile the existing verifier expectations with the cumulative opaque route-error and privacy-safe host-failure shapes.
4. Keep the Bootstrap/global-policy/binding-manifest seam explicit and untouched.
5. Run static syntax/schema/whitespace/hygiene checks only; do not run functional tests or npm.

## Wave-02 repair and self-audit

The recorded repair is complete in the isolated worktree:

- `compileSupervisorGoal` now derives the observation-bound goal ID unconditionally and rejects a mismatched caller value.
- The cumulative loop's existing true-blocker guard, stale source/intent repair rejection, predecessor/test-build binding, exact host receipts, opaque error digest, privacy-safe text, and fsync-backed CAS persistence were preserved from authority without semantic alteration.
- The cumulative supervisor's existing `opaque:error:<digest>` route-failure shape was preserved; the verifier now asserts raw route text is absent.
- The feature hardening verifier now checks the repaired goal-ID rejection and the cumulative `error_digest` field.

Changed paths in this wave are: `control/controller-supervisor.mjs`, `control/controller-supervisor-runtime.mjs`, `control/continuous-operating-loop.mjs`, `control/content-addressing.mjs`, `control/persisted-record-privacy.mjs`, `schemas/controller-supervisor.v1.json`, `schemas/continuous-operating-loop.v1.json`, `tests/verify-controller-supervisor.mjs`, `tests/verify-controller-intent-hardening.mjs`, `tests/verify-continuous-operating-loop.mjs`, `tests/verify-controller-supervisor-liveness.mjs`, and this append-only report. The two support modules are exact authority materializations; they were not semantically repaired. No unrelated or Bootstrap/binding file was changed.

Static self-audit/re-audit evidence:

- The Controller source differs from the cumulative code candidate only by the recorded goal-ID derivation/rejection.
- The continuous loop, supervisor runtime, continuous-loop schema, focused continuous verifier, and liveness verifier match the cumulative source authority byte-for-byte.
- The repaired goal ID is source-bound before goal validation/digesting; the hostile verifier supplies a valid-looking but mismatched override.
- The wave-02 tests and schema now describe source-bound test-build identities, exact host receipts, opaque error digests, source/intent reassessment, true-blocker Intent Regulator routing, and directory-fsync persistence.
- `node --check` passed for changed JavaScript files; changed JSON parsing passed; `git diff --check` passed. Functional verifiers were not run and no npm command was used.
- No absolute machine paths, private links, credentials, provider tokens, task identities, deployment identities, or chat links were added to the report or handoff.

Wave disposition:

- F03-01-W02: `RESOLVED_PENDING_TESTS`.
- Prior F03-02, F03-03, and F03-05: `RESOLVED_IN_CUMULATIVE_SOURCE_PENDING_TESTS`; the stronger wave-02 authority implementation preserves their repairs.
- Prior F03-04: `OPEN_NEXT_REQUIRED_BEHAVIOR`; functional and independent acceptance evidence remains the only feature finding.
- Bootstrap/global-policy/binding-manifest seam: `DEFERRED_TO_OWNER`; exact recovery is recorded above and no cross-edit was made.

Wave lenses: quality `PASS_PENDING_TESTS`; hygiene/minimality `PASS` for the feature-owned repair and exact dependencies; security/privacy `PASS_STATICALLY`; durability `PASS_STATICALLY_PENDING_CLEAN-TREE_REVIEW`; regression `UNPROVEN`; custody `PASS` for Controller/Orchestrator/Auditor separation with the shared policy seam deferred; boundary `PASS_STATICALLY`; intent `ALIGNED_AFTER_REPAIR`.

## Typed source-bound handoff — wave-02

Handoff status: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_AND_INDEPENDENT_CLEARANCE`.

The candidate is coherent for downstream consumption at the exact source authority recorded above. It is prepared but not functionally accepted, independently cleared, activated, released, merged, pushed, deployed, published, or archived. `2.1rc` remains `PREPARED_NOT_ACTIVATED`.

The handoff record is `docs/feature-handoffs/ROADMAP_03_CONTROLLER_INTENT-2026-08-09.md`. It binds this feature, the cumulative/code-candidate commit and tree identities, the append-only audit report, the exact changed paths, the remaining F03-04 evidence requirement, and the Bootstrap/global-policy custody seam.

Exact next action: on a clean candidate tree, run `tests/verify-controller-supervisor.mjs`, `tests/verify-controller-supervisor-liveness.mjs`, `tests/verify-continuous-operating-loop.mjs`, `tests/verify-controller-intent-hardening.mjs`, and the approved parent suite without npm; then have an independent checker inspect the source-bound records and append the results before any activation decision. The shared Bootstrap/binding owner must separately refresh the policy/manifests before cadence/source binding is claimed complete.

## Central integration intake — 2026-08-10

- visible_task_ref: `019fdcf9-97f6-7200-bad2-6606d1259e99`
- isolated_worktree_ref: `WORKTREE_REF_746B`
- source_baseline_head: `f0336c53ac5ffa63917891f481d56c4e5d6cce8f`
- source_baseline_tree: `7a3526b2d0d1718a69b2524a86bbfd5ba591687d`
- isolated_report_sha256: `8dbf0bdb903eef1190328eeaa49a53f5f95a8ebee54942698bb6c9f81421545e`
- central_disposition: `SOURCE_BOUND_CONTROLLER_REPAIR_INTEGRATED_PENDING_STATIC_REVIEW`
- changed_path_disposition: `CONTROLLER_INTENT_REPAIR_AND_GENERIC_PRIVATE_CONTEXT_BOUNDARY_INTEGRATED`
- functional_status: `NOT_RUN_BY_INSTRUCTION`
- activation_status: `PREPARED_NOT_ACTIVATED`
- archive_status: `WITHHELD_UNTIL_DOWNSTREAM_REVIEW`

The Controller repair was consumed from the existing visible task without
duplicating the already-integrated support files. A release-bound governance
scanner carried a consumer-specific literal in the candidate source. That
literal was removed and replaced by the generic private-context detector at
`control/private-context-detector.mjs`. The detector accepts project identity
terms only as transient typed input, returns category and digest metadata, and
never persists the matched value. The detector contract, source, focused
verifier, and documentation are now part of the candidate binding. Functional
execution remains intentionally pending. The same source-hygiene repair was
applied to the role-governance validator and to generic synthetic fixtures in
the portability, README, and aggregate verifiers.
