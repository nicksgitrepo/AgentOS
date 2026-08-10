# REPAIR_RECOVERY_LOOP audit report

Feature: `REPAIR_RECOVERY_LOOP`
Name: Repair, Recovery, Reframing, and Continuous Operating Loop
Inventory status at audit start: `NOT_STARTED`
Authority: current accepted merge snapshot, source identity recorded as Git commit/tree digests only
Functional-test status: `PENDING` by instruction; no functional test command is claimed here.

This report is append-only. Each audit pass records its source readback, findings,
repairs, remaining evidence, and next action. The report contains portable
summaries and digests only; it does not store secrets, credentials, private
machine paths, provider tokens, chat links, or raw host/session material.

## Intended behavior audit

The roadmap promises controller-owned goals, explicit repair/reassessment/closure,
meaningful progress distinct from liveness, source-bound handoffs, preserved
failures, bounded repair, fresh replacement identity, independent clearance, and
true-blocker escalation. The recovery foundation adds puzzle versus soft review,
hard stop, and unavailable routing; changed intent, scope, policy, source, or
operating condition requires a fresh source-bound goal. Protected actions remain
closed and `2.1rc` remains prepared but inactive.

The feature inventory names these authoritative implementation inputs:

- `schemas/root-cause-analysis.v1.json`
- `schemas/continuous-operating-loop.v1.json`
- `control/continuous-operating-loop.mjs`
- `control/repair-recovery.mjs`

Direct supporting contracts used by the recovery module are
`control/repair-governance.mjs`, `control/content-addressing.mjs`,
`control/persisted-record-privacy.mjs`, `schemas/digest-bound-checkpoint.v1.json`,
`schemas/repair-receipt.v1.json`, `schemas/repair-respawn.v1.json`, and
`schemas/repair-rollback.v1.json`.

Research and documentation intent was read from the roadmap, architecture,
recovery/boundaries foundation, progress/health foundation, security/privacy
foundation, implementation-audit evidence, and iteration continuation evidence.
No separate portable research-record directory was available in the accepted
snapshot; that absence is recorded as an evidence limitation, not treated as
authority to invent product context.

## Audit pass 1 — initial accepted-snapshot audit (pre-repair)

### Actual implementation

The authoritative snapshot contains deterministic loop compilation and validation,
15-minute meaningful-progress inspection, source/intent reassessment, typed
repair receipts, predecessor evidence, replacement-goal and replacement-receipt
construction, host-closure receipt checking, independent-clearance checking,
bounded respawn, owner-gated rollback, privacy-safe recovery records, and
compare-and-swap record persistence. Syntax checks and JSON parsing were read-only
static evidence and passed for the target modules and their direct supporting
contracts. The feature source was not materialized in this isolated checkout at
audit start because the accepted snapshot carried it as uncommitted merge
material; no authority worktree was modified.

### Findings

#### `RRL-001` — target source is not materialized in the writable checkout

- Classification: `REPAIRABLE_PUZZLE`; custody/hygiene.
- Evidence: the authoritative snapshot has the four inventory paths and direct
  recovery dependencies; the writable checkout began at the accepted commit but
  did not contain those uncommitted files.
- Why it matters: a handoff from this checkout would not be self-contained or
  reproducible, and repairs could not be verified against the accepted source.
- Exact recovery: add only the target feature and direct supporting files to this
  isolated checkout through controlled patches, then re-audit their source and
  dependency identities.

#### `RRL-002` — free-form loop failure text is not privacy guarded

- Classification: `TRUE_BLOCKER` for public/persisted safety until repaired.
- Evidence: `control/continuous-operating-loop.mjs` accepts worker summaries and
  host error messages as free text; host failure construction persists the raw
  error message, while loop record validation does not apply the persisted-record
  privacy guard used by the repair-governance records.
- Why it matters: an adapter error can carry a secret, credential, private path,
  provider token, or chat link into a retained repair record, violating the
  portable-kernel and privacy boundaries.
- Exact recovery: keep only a safe phase-labelled message plus digests of the raw
  error/receipt; reject unsafe free-form summaries and root-cause text before a
  loop record is accepted.

#### `RRL-003` — an applied repair may claim refreshed normative bindings without a digest

- Classification: `REPAIRABLE_PUZZLE`; proof/durability.
- Evidence: applied repair validation requires `refreshed: true` but permits a
  null `binding_sha256`; the test-build identity is independently validated but
  is not enough to prove the normative binding readback.
- Why it matters: a replacement can be minted without an exact normative
  contract identity, so “refreshed” becomes narration rather than evidence.
- Exact recovery: require a non-null SHA-256 binding for `APPLIED` repairs and
  require a null binding only for retained failed repairs.

#### `RRL-004` — repair/source/evidence identities are not fully cross-bound

- Classification: `REPAIRABLE_PUZZLE`; custody/regression.
- Evidence: the iteration validates the repair record shape but does not require
  its preserved-evidence digest and `source_before` to equal the inspected loop;
  it also does not require an applied test-build identity to match
  `source_after`, changed-path digest, and predecessor handoff.
- Why it matters: a syntactically valid receipt from another observation could be
  attached to this inspection, allowing stale or unrelated work to continue.
- Exact recovery: add explicit cross-record assertions before replacement-goal
  minting and bind the test-build identity to predecessor handoff, source-after,
  and changed paths.

#### `RRL-005` — replacement naming can create a generic lane and accept a stale build tag

- Classification: `REPAIRABLE_PUZZLE`; intent/topology.
- Evidence: replacement goals use the literal display name `Worker <build-tag>`;
  predecessor validation accepts any syntactically valid build tag rather than
  the loop’s exact tag.
- Why it matters: generic workers are outside the admitted topology, and a
  replacement can silently run under a different governance test build.
- Exact recovery: preserve the predecessor’s clear lane label, append the exact
  current build tag, and require the predecessor tag to match the loop tag.

#### `RRL-006` — closure receipts permit digest reuse across host phases

- Classification: `REPAIRABLE_PUZZLE`; custody.
- Evidence: each named host phase only requires `status: OBSERVED` and a valid
  digest; the same digest may be supplied for every phase.
- Why it matters: one observed fact can be replayed as proof of creation, handoff,
  archival, post-close readback, and roster absence.
- Exact recovery: require distinct receipt digests for the nine named host phases
  and retain the existing fail-closed behavior for missing or malformed phases.

#### `RRL-007` — source/intent reassessment closes without minting the required fresh goal

- Classification: `REPAIRABLE_PUZZLE`; intent/continuity.
- Evidence: the contract requires a fresh goal after source or intent change, but
  the iteration returns `SUCCEEDED_BY_REASSESSMENT` with no replacement goal when
  no patch is supplied; the existing replacement compiler requires an applied
  repair and therefore cannot represent a pure reassessment.
- Why it matters: changed conditions can terminate continuity without a typed,
  source-bound successor, losing the exact reframe obligation.
- Exact recovery: add a pure reassessment-goal compiler/return path that binds the
  observed source and intent, carries predecessor history, and cannot claim a
  repair patch or independent clearance.

#### `RRL-008` — CAS persistence fsyncs the file but not the containing directory

- Classification: `REPAIRABLE_PUZZLE`; durability.
- Evidence: the writer fsyncs the staged file and renames it, but does not fsync
  the parent directory after the rename.
- Why it matters: a crash can lose the rename even after the record’s content was
  flushed, undermining durable recovery history.
- Exact recovery: fsync the validated parent directory after the atomic rename;
  fail closed if the durability barrier cannot be established.

### Production-readiness gate after pass 1

Not ready. The implementation has a strong bounded shape, but the findings above
leave privacy, source custody, reassessment continuity, topology, closure proof,
and durability below the production-candidate bar. The only declared external
limitation is the requested functional-test hold; all findings are locally
repairable and are not accepted as blockers.

### Builder actions authorized by this audit

1. Materialize the target feature and direct dependencies in this isolated
   checkout only.
2. Repair `RRL-002` through `RRL-008` with the smallest focused changes.
3. Add hostile/static coverage for each repaired invariant without running
   functional tests.
4. Re-audit the exact changed paths and update this report append-only.

## Evidence and unresolved external limits

- Static syntax and JSON-parse evidence: PASS for the authoritative target files.
- Functional tests: PENDING by explicit instruction; no pass is claimed.
- External provider, publication, deployment, activation, authentication,
  spending, merge, push, and rollback execution: out of scope and not attempted.
- No genuine external blocker is present for the recorded repairs.

## Audit pass 2 — self-audit finding before recovery-module repair

The repaired continuous-loop slice was re-read. Its syntax and JSON contracts
remain statically valid, and the new invariants are present in the code and
focused test source. One cross-contract issue remains in the direct recovery
module:

#### `RRL-009` — respawn receipt validation accepts a plan-only status

- Classification: `REPAIRABLE_PUZZLE`; schema parity/fail-closed behavior.
- Evidence: `validateRespawnReceipt` checks the shared plan/receipt status list,
  which includes `ADMITTED`, while `schemas/repair-respawn.v1.json` permits only
  `RESPAWNED_AND_BOUND` or `RESPAWN_BLOCKED` for a receipt.
- Why it matters: a plan-status record can be admitted past the executable
  receipt boundary and then be interpreted as a successful receipt path.
- Exact recovery: give respawn receipts their own two-value status set and reject
  `ADMITTED` before any receipt branch is evaluated.

This is local schema/validator drift, not an external blocker. The next action is
to repair it and run the final append-only re-audit; functional tests remain
pending.

## Audit pass 3 — final self-audit after recorded repairs

The target inventory and its direct recovery contracts were re-read in the
isolated checkout. The target source is now materialized here; the authority
snapshot was not modified. A source readback against the accepted snapshot
shows only the recorded repair changes in the target modules, schemas, and
focused test sources. No unrelated project files were changed.

### Resolved findings

- `RRL-001` resolved: the four inventory implementation inputs and their direct
  recovery contracts are present in this checkout, with the report and focused
  hostile/static coverage alongside them.
- `RRL-002` resolved: free-form summaries and root-cause text are privacy-guarded;
  retained host failures use a safe phase message and error/receipt digests, not
  raw adapter text.
- `RRL-003` resolved: an applied repair requires a normative binding digest;
  only a retained failed repair may carry a null binding.
- `RRL-004` resolved: inspection evidence, source-before/source-after, changed
  paths, predecessor handoff, and test-build identity are cross-bound before a
  replacement is admitted.
- `RRL-005` resolved: replacement names preserve the predecessor lane label and
  the current exact build tag; stale predecessor tags are rejected.
- `RRL-006` resolved: the nine closure-phase receipt digests must be distinct.
- `RRL-007` resolved: source/intent change mints a source-bound reassessment
  goal carrying predecessor history with null repair/test-build identities; it
  cannot be mistaken for a repaired replacement.
- `RRL-008` resolved: compare-and-swap persistence fsyncs the containing
  directory after rename and fails closed if that barrier fails.
- `RRL-009` resolved: respawn receipts now accept only
  `RESPAWNED_AND_BOUND` or `RESPAWN_BLOCKED`; plan-only `ADMITTED` is rejected.

### Cross-dimension final findings

- Quality: `PASS` on static structure, exact-key validation, typed lifecycle
  boundaries, and focused hostile assertions.
- Hygiene/minimality: `PASS` for the isolated scope; changes are limited to the
  feature, direct contracts, focused coverage, and this append-only report.
- Security/privacy: `PASS` on the static review; no raw host/session material is
  retained by the repaired loop path, and protected actions remain false.
- Durability: `PASS` on the static contract review; CAS records now include the
  post-rename directory barrier and fail closed on barrier failure.
- Regression: `PASS` on syntax, JSON parsing, source readback, and explicit
  hostile/static coverage; functional execution is still pending.
- Custody/boundary: `PASS`; source, evidence, predecessor handoff, and receipt
  identities are bound, and host/provider/deployment actions remain injected and
  out of scope.
- Intent/continuity: `PASS`; progress is distinct from liveness, repair is
  bounded, and changed source or intent produces a fresh typed reassessment.

### Changed files

The isolated worktree changes are:

- `control/content-addressing.mjs`
- `control/continuous-operating-loop.mjs`
- `control/persisted-record-privacy.mjs`
- `control/repair-governance.mjs`
- `control/repair-recovery.mjs`
- `schemas/continuous-operating-loop.v1.json`
- `schemas/digest-bound-checkpoint.v1.json`
- `schemas/owner-repair-approval.v1.json`
- `schemas/repair-receipt.v1.json`
- `schemas/repair-respawn.v1.json`
- `schemas/repair-rollback.v1.json`
- `schemas/root-cause-analysis.v1.json`
- `tests/verify-continuous-operating-loop.mjs`
- `tests/verify-live-governance-repair.mjs`
- `docs/feature-audits/REPAIR_RECOVERY_LOOP/auditreport.md`

### Final readiness and next action

Final status: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`. Static syntax
checks and JSON parsing pass for the changed implementation, contracts, and
focused test sources. Functional tests were not run, as required; no functional
pass is claimed. The absence of a separate portable research-record directory
remains a documented evidence limitation, not a blocker. External provider,
deployment, activation, authentication, spending, merge, push, and rollback
actions were not attempted and are outside this task’s custody boundary.

No unresolved repair finding or genuine external blocker remains. Next action:
run the two focused functional test files without npm, then obtain the required
independent clearance before any activation decision. `2.1rc` remains prepared
but inactive.

## Privacy re-audit addendum — generated check evidence

The repair generator previously emitted raw stdout and stderr into
`control/check-failure-receipts`. It now emits `OUTPUT_EMPTY` or
`OUTPUT_PRESENT` classifications plus SHA-256 digests, preserving failure
identity without persisting command output. The generated verifier asserts that
hostile output text is absent from the retained receipt. Functional execution
and independent clearance remain pending.

The retained-failed-worktree boundary was tightened in the same pass: retained
failure RCAs now require an opaque error identity instead of accepting exact
error text, and the hostile verifier rejects a non-opaque RCA while preserving
the evidence digest and inactive-checkpoint rules.
