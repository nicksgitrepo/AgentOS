# Platform Foundation Controller Audit

> Historical record: this report was produced under the superseded
> platform-before-feature workflow. The active authority is now the rolling
> feature-audit -> platform-domain integration -> Central sequence. Preserve
> this report for provenance, but do not use its feature-admission decision as
> a current orchestration gate.

Status: `PLATFORM_CANDIDATE_PENDING_TESTS`

Feature admission: `HOLD`

Activation: `PREPARED_NOT_ACTIVATED`

## Receipt

The Controller received twelve platform-foundation handoffs, one from each
governance lane. Each handoff is retained in its lane report or companion
handoff artifact. The handoffs consistently cover the shared skeleton,
directory and custody boundaries, technology-stack facts or recommendations,
feature boundaries and routing, shared contracts, UI and Design Bible
direction, security and privacy constraints, and unresolved owner questions.

The visible platform tasks were archived only after their handoff records were
written. No feature task was released by the platform handoff set.

The canonical feature inventory contains thirty-seven feature tasks and
thirty-seven feature reports. Those tasks remain held at the platform gate.

## Independent Controller findings

### Complete

- The former platform-before-feature rule is preserved only as historical
  evidence. The active workflow now admits feature audit and repair first,
  then starts platform intake as candidates arrive.
- Platform acceptance now requires a source-bound, independently issued
  `INDEPENDENT_AUDITOR` receipt, and platform merge now requires an audited
  integration receipt bound to that exact audit candidate. Feature acceptance
  and feature merge use the same proof chain. A Controller cannot advance a
  phase from a generic evidence hash or a merge-worktree claim alone.
- Imported projects have an explicit owner approval hold. Without approval,
  the workflow remains at `IMPORT_APPROVAL_REQUIRED` and cannot start rapid
  development.
- The Controller can derive the platform roster from the twelve governance
  lanes and the feature roster from the canonical inventory only after exact
  task parity.
- External workflow state and the secret-free question queue are designed to
  live in the controller authority, outside Product repositories.
- Every platform handoff explicitly keeps feature release on hold.

### Not yet accepted

- The authoritative merge worktree is still a dirty development snapshot.
  Clean-source admission and independent clearance are therefore unavailable.
- The twelve handoff records are now preserved under
  `docs/platform-handoffs/` in the authoritative tree. Their temporary visible
  tasks and stale worktree records were then unpinned and archived. They have
  not yet been reconciled into one content-addressed platform merge receipt.
- Any broader pre-existing builder changes are intentionally not inferred from
  the archived task state. The Controller must review each candidate path for
  scope, compatibility, custody, and direct evidence before integration.
- Owner questions are recorded, but unresolved authority, stack, design, and
  boundary choices must be answered or explicitly retained before a feature
  lane can be admitted. The Controller must not silently choose defaults that
  change scope or authority.
- Functional tests and external host/provider clearance remain pending by
  instruction. This report does not claim those checks passed.

### Closeout repair finding

The first platform closeout preserved the handoff documents before archiving
the visible tasks, but it did not yet retain a per-task audited integration
receipt. That is now a general-governance finding, not a reason to leave dead
tasks visible: the tasks remain archived, their handoffs remain preserved, and
the Controller must reconcile the accepted source changes into one cumulative
platform tree before marking the platform phase accepted. Future closeout must
use the enforced sequence `preserve -> persist -> audit -> integrate ->
unpin -> stale-worktree-close -> active-scope-remove -> chat-out-of-scope ->
archive`.

## Controller decision

The platform phase is complete as an evidence-bearing handoff set, but it is
not yet an accepted platform merge. The correct next transition is:

`COLLECTED_HANDOFFS -> INDEPENDENT_PLATFORM_AUDIT -> ONE_PLATFORM_MERGE -> FEATURE_ADMISSION`

The Controller must not advance to feature development until the middle two
steps produce a retained independent-audit and merge receipt chain with exact
source, tree, changed-path, question, and custody evidence. Ordinary implementation gaps are repair work;
the dirty-source and unavailable-clearance conditions are retained custody
boundaries, not feature blockers to be hidden or waived.

Next action: reconcile the twelve handoffs and unique platform-scope changes
into one new platform candidate, preserve every resolved finding and handoff
digest, then re-audit that candidate before releasing the thirty-seven feature
lanes.

## Controller audit pass — executable merge receipt added

The previous next action is now represented by an executable, source-neutral
receipt boundary:

- `control/platform-foundation-merge.mjs` compiles and validates one
  Controller-owned platform merge receipt.
- `schemas/platform-foundation-merge-receipt.v1.json` defines the exact
  receipt shape and rejects additional fields.
- The receipt requires exactly twelve sorted lane handoffs, feature/report and
  governance/report parity, a safe relative candidate scope, a typed question
  queue path, the current source identity, independent-audit evidence, and an
  integration receipt.
- The receipt carries the general governance closeout sequence and cannot
  report `READY` while the source is dirty, the independent audit is pending,
  or the integration is pending. Platform implementation is expected in this
  phase; the compatibility `implementation_started` flag is informational and
  does not authorize feature work by itself.
- Rapid-prototype `PLATFORM_MERGE_COMPLETE` now requires this typed receipt and
  its `READY` admission state; a generic merge digest is insufficient.

Static evidence for this pass is limited to JavaScript syntax, JSON parsing,
diff hygiene, portability review of the new receipt/compiler, and exact
normative binding parity. Functional execution, clean-source readback, host
readback, independent clearance, and feature admission remain pending by the
existing verification boundary. No feature task is released by this pass.

Current status remains: `PLATFORM_CANDIDATE_PENDING_TESTS`.

The independent static audit is retained at
`docs/platform-foundation-independent-audit.md`. Its decision remains
`PENDING_CLEAN_SOURCE_AND_REQUIRED_CLEARANCE`; it does not release feature
lanes or convert the pending platform receipt into an acceptance claim.

## Controller handoff-seam repair

The Bootstrap-to-Intent-Regulator seam previously advanced a campaign only to
the batch-handoff stage and did not expose a durable way for the supervising
process to submit the required independent audit, integration receipt, and
next-phase transition. That was an ordinary implementation gap and has been
repaired in the accepted merge worktree:

- `control/intent-regulator-runtime.mjs` now converts a closed, independently
  accepted campaign into exact roster-bound handoff payloads and rejects
  incomplete closure, acceptance, or native-roster evidence.
- `control/bootstrap-runtime.mjs` now exposes existing-workflow advancement and
  next-phase start operations while retaining the external question queue and
  compare-and-swap workflow persistence.
- `control/platform-foundation-merge.mjs` now emits the complete universal
  closeout contract that its validator requires; the receipt compiler no
  longer generates a structurally impossible platform receipt.
- The feature phase still requires `platform_acceptance === true`; no feature
  lane can bypass the platform audit and merge transitions.

Static evidence for this repair: both changed modules pass syntax checking,
diff hygiene passes, and all 236 normative binding digests match. Functional
execution, host readback, clean-source admission, and platform acceptance
remain pending; this repair does not claim feature admission or release.
