# OWNER_PUBLIC_SURFACE audit report

Feature: `OWNER_PUBLIC_SURFACE` — Owner-Facing UI, UX, Responses, and Public Surface
Cycle: audit → repair → self-audit → re-audit
Status: `PLATFORM_GATE_PENDING_CONTROLLER_RELEASE`

## Scope and source binding

This report uses the current accepted merge snapshot as the read-only authority
for the initial audit. The accepted snapshot is identified by source commit
`590c07ddd4be7a8c24727c24b40808e44ca7357d`, committed tree
`f1b358d87e6a969fb9631e202a3d478540edd4d9`, and accepted working-tree readback
tree `1e87ade05535877fb9678eaa46b9d953cfc0f860`. The writable task worktree
started at the same committed source but did not contain the accepted merge
working-tree additions. The accepted source was not modified.

The inventory entry names these authoritative feature sources:

- `docs/rapid-foundations/07-ui-ux.md`
- `control/rapid-prototype/ui-ux.mjs`
- `control/bootstrap-owner-surface.mjs`

The intent review also covered the complete `docs/roadmap.md`, the architecture
and accepted-merge review, the feature inventory, the rapid-prototype plan,
all twelve rapid-foundation contracts and clearance evidence, the relevant
Bootstrap and UI/UX schemas, the response/security gate catalog, and the
owner-conversation implementation and focused checks. No secrets, credentials,
provider accounts, chat links, private locations, or task identities are stored
in this report.

## Campaign correction and release gate

The platform foundation is a hard prerequisite for this feature. The current
feature lane is held until the Controller has accepted and merged the platform
skeleton, routing, stack, shared contracts, and UI direction.

The prior audit findings and the repair artifacts already present in this
isolated worktree are preserved as unaccepted candidate material. They are not
released implementation, re-audit clearance, production readiness, or
acceptance evidence. Do not apply them to the accepted merge or claim feature
completion before the platform gate is released. No new implementation or
repair work is authorized during this hold, and no hidden or child task is
created.

## Intended behavior

The public surface is a deterministic view of typed intent, current state,
public ownership, next action, limitation, and compact evidence. It must remain
plain enough for an owner, fail closed when state or privacy is not proven, and
never become a second authority. The UI/UX foundation requires stable labels
for ready, working, waiting for a decision, blocked, unavailable, conflict,
and complete; explicit recovery; one-question behavior; public-only role and
evidence summaries; and a plain-text/Markdown fallback when no rendered UI is
available. Accessibility/layout checks remain `UNPROVEN` or `UNAVAILABLE` when
they have not run.

The Bootstrap owner adapter must expose only short ordinary prompts and labels,
keep internal fields out of the owner-facing text, map replies to the exact
canonical question, reject unsafe input, and preserve normalized answers rather
than raw conversation text.

## Actual implementation in the accepted snapshot

- `control/rapid-prototype/ui-ux.mjs` renders a frozen text surface with a
  deterministic label, message, optional question/options, and next step. It
  has privacy-pattern hard stops, conflict detection, one-question checks,
  hostile-text normalization, and the states `ready`, `one-question`,
  `unavailable`, `puzzle`, `soft-review`, `hard-stop`, and `conflict`.
- `control/rapid-prototype/ui-ux.mjs` is composed into the rapid prototype and
  its focused test covers the recorded seven-state surface, hostile content,
  malformed status, one-question boundaries, and markup inertness.
- `control/bootstrap-owner-surface.mjs` renders short Bootstrap prompts,
  numbered choices, a `digest`, and `internal_fields_hidden: true`; it delegates
  answer normalization to `control/bootstrap-conversation.mjs`.
- `schemas/bootstrap-owner-question.v1.json` constrains the Bootstrap transport
  shape, while the owner-surface renderer has only an inline schema string and
  no standalone contract or validator.
- Existing accepted evidence records the rapid-slice focused checks as PASS,
  but that evidence has not been independently rerun in this task. Functional
  tests remain pending by instruction.

## Initial findings

### OPS-001 — Writable scope does not contain the accepted feature slice

Severity: `HIGH` for custody/reproducibility; classification: `REPAIRABLE`.

The accepted merge working tree contains the feature sources and their rapid
prototype dependencies, while this task’s writable worktree contains only the
older committed baseline. Building directly from the writable baseline would
audit a different candidate than the accepted snapshot. This is a scope and
custody problem, not permission to edit the accepted authority.

Why it matters: the report, repair, and re-audit must bind to one candidate;
otherwise a clean local result could omit the accepted implementation entirely.

Evidence: accepted working-tree tree `1e87ade…`; writable initial tree
`f1b358d…`; the feature source paths are absent from the writable baseline.

Recovery: copy only the accepted OWNER_PUBLIC_SURFACE implementation,
Bootstrap adapter dependencies, schemas, focused tests, and the minimum
integration files into this worktree; record the exact changed-path list; then
repair those paths only.

### UI-001 — Public state taxonomy does not cover the foundation contract

Severity: `HIGH`; classification: `REPAIRABLE_ENGINEERING_PUZZLE`.

The renderer exposes seven internal statuses but no explicit `working`,
`waiting`, `blocked`, `complete`, or `unproven` public states. `puzzle`,
`soft-review`, and `hard-stop` are useful internal outcomes, but they do not
fully replace the required stable public labels. A caller can therefore collapse
waiting, blocked, incomplete, and complete into a misleading ready/unavailable
view.

Why it matters: owners cannot distinguish liveness from success or understand
whether a missing check, a blocked boundary, or a completed outcome is pending.
This violates the UI state matrix and risks false completion.

Recovery: add the missing stable states and aliases without removing the
existing typed outcomes; define their safe messages and next actions; ensure
conflict/unknown inputs never become success; add focused matrix fixtures.

### UI-002 — The current-view contract omits material public context

Severity: `HIGH`; classification: `REPAIRABLE_ENGINEERING_PUZZLE`.

The renderer returns status, label, message, question, options, next step, and
text, but not the intended outcome, responsible public role, material
limitation, compact evidence/readback summary, or whether the rendered
experience is available. The rapid-slice summary drops the same context.

Why it matters: the foundation requires one truthful view that makes outcome,
state, ownership, next action, and limitations legible. Without those fields,
the owner-facing text can be readable while still being incomplete or detached
from the evidence that supports it.

Recovery: define a small project-agnostic owner-surface contract, validate and
normalize public context, include a plain-text fallback and explicit
`UNAVAILABLE`/`UNPROVEN` presentation metadata, and carry the safe fields
through the rapid-slice summary. Do not expose source, session, provider, or
private evidence values.

### UI-003 — Direct surface safety and malformed-input handling are not canonical

Severity: `HIGH`; classification: `REPAIRABLE_ENGINEERING_PUZZLE`.

The UI renderer duplicates a local protected-content regex set instead of
binding its public output to the accepted public-payload scanner. Invalid
option entries are silently dropped, and the direct surface has no standalone
schema validation or content digest. The composed rapid slice performs a later
scan, but direct callers can receive a surface without the same explicit safety
and evidence contract.

Why it matters: silent input loss can hide a required action, and divergent
privacy checks allow regression between direct and composed responses. A frozen
object is not durable evidence by itself.

Recovery: use the canonical public-payload scan at the public boundary, reject
malformed option collections as `UNAVAILABLE` rather than silently repairing
them, add schema validation and a deterministic safe-content digest, and extend
hostile fixtures for direct and composed calls.

### UI-004 — Bootstrap owner-question validation trusts caller-shaped content

Severity: `HIGH`; classification: `REPAIRABLE_ENGINEERING_PUZZLE`.

`validateBootstrapOwnerQuestion` checks the supplied fields and a digest of
those same supplied fields, but does not compare the prompt, answer kind,
choices, or boolean flag to the canonical question definition. A caller that
changes the display and recomputes the digest can present a mismatched question
while `parseBootstrapOwnerAnswer` still parses against the canonical question.

Why it matters: this can mislead the owner and misbind a reply at the public
boundary. A content digest proves self-consistency, not authority.

Recovery: validate the surface against the canonical question definition before
accepting its digest; reject mismatched prompt/kind/choice/boolean data; add a
tamper fixture that recomputes the digest and still fails.

### UI-005 — Focused evidence does not prove the required UI/UX gate set

Severity: `MEDIUM`; classification: `REPAIRABLE_ENGINEERING_PUZZLE`.

The focused test proves text rendering and hostile fixtures, but not the full
state matrix, current-view context, schema parity, explicit rendered-surface
availability, malformed collection behavior, or canonical Bootstrap question
integrity. Keyboard/assistive and responsive checks are correctly unavailable
for this text-only slice, but the public result does not say so.

Why it matters: the accepted implementation evidence can be read as broader UI
clearance than the available checks support.

Recovery: add focused checks for every repaired contract and preserve the
text-only status as `UNAVAILABLE`/`UNPROVEN`; do not claim browser accessibility
or production acceptance from Node-only checks.

### UI-006 — Bootstrap owner questions are not bound to the canonical compiler

Severity: `HIGH`; classification: `REPAIRABLE_ENGINEERING_PUZZLE`.

The accepted `control/bootstrap-owner-surface.mjs` imports a separate compact
question table from `control/bootstrap-conversation.mjs`, while the active
Bootstrap authority in `control/bootstrap-compiler.mjs` owns a different
question set and the six-option delivery-finish choice. The two surfaces can
therefore show different prompts or answer values, and the accepted owner
schema’s five-choice ceiling cannot represent the canonical six-choice finish
question.

Why it matters: an owner reply must bind to the exact question currently used by
Bootstrap. A self-consistent digest over a duplicate question table does not
preserve that authority and can misroute a delivery choice.

Recovery: make the owner adapter derive display and choice parsing directly from
`control/bootstrap-compiler.mjs`, accept the canonical six-choice finish list,
validate structured answers through the compiler, and add a canonical-question
tamper/choice-parity fixture.

## Cross-cutting audit lenses

- Production readiness: `NOT_READY`; the initial candidate has repairable
  contract gaps, and functional tests are pending.
- Quality: implementation is small and deterministic, but the surface contract
  is ad hoc and duplicates privacy logic.
- Hygiene/minimality: the public renderer is focused, but the accepted slice
  must be imported without unrelated merge files; malformed input must not be
  silently discarded.
- Security/privacy: hostile content is generally withheld without echoing it,
  but direct safety is not aligned with the canonical scanner and Bootstrap
  question authority can be spoofed by self-recomputed digest.
- Durability: Bootstrap questions are content-addressed; owner surfaces are
  frozen but not content-addressed or schema-validated.
- Regression: the existing seven-state assertions will need deliberate updates
  when the required public state taxonomy is added; the one-question invariant
  and protected-action hard stops must remain unchanged.
- Custody: the accepted authority remains read-only; this worktree alone is
  writable. The initial baseline mismatch is recorded as OPS-001 and is
  recoverable by a narrow import.
- Boundary: no provider, publication, deployment, activation, secret access,
  private-context export, or role-topology change is in scope. `2.1rc` remains
  prepared but inactive.
- Intent: preserve low-chat operation, exact owner choices, truthful
  uncertainty, one bounded repair pass at a time, and no inferred protected
  action.

## Evidence and unknowns

Evidence available: the inventory entry, foundation contract, rapid-prototype
plan, UI/UX and response/security gate definitions, source readbacks, accepted
focused-test source, and accepted implementation-audit record. The accepted
test claims are treated as prior evidence, not as a new check result here.

Unknown: the inventory’s `research-records-linked-by-owner` placeholder does not
resolve to a portable research record in the accepted source. No owner-specific
design bible, browser host, or assistive-technology runtime is supplied. These
are not blockers for the bounded text-surface repair; they limit claims to the
portable contract and focused static/Node behavior.

## Builder actions recorded for this cycle

1. Import the minimum accepted feature slice into this isolated worktree and
   record its changed paths.
2. Repair UI-001 through UI-004 and UI-006 in the public renderer, surface
   contract, canonical Bootstrap question validation, and the minimum
   rapid-slice integration.
3. Add or update focused hostile tests for UI-005, without running functional
   tests under the current instruction.
4. Self-audit the diff for portability, privacy, minimality, custody, and
   authority boundaries.
5. Re-audit every initial finding and record remaining evidence, pending checks,
   production-readiness classification, and the exact next action.

## True blockers

None at initial audit. Functional-test execution is pending by instruction, not
an external blocker. The missing browser/assistive runtime is an unavailable
evidence path and will remain explicitly `UNAVAILABLE`/`UNPROVEN`, with exact
recovery being a later admitted host-backed rendered-surface check.

## Preserved repair material — not released

The recorded repair scope remains only in this writable worktree. The accepted
merge worktree remained read-only and unchanged. The following notes describe
the preserved candidate artifacts for later post-gate review; they are not
acceptance claims:

- `UI-001`: the public renderer has stable `READY`, `WORKING`, `WAITING`,
  `ONE QUESTION`, `BLOCKED`, `UNAVAILABLE`, `CONFLICT`, `COMPLETE`,
  `UNPROVEN`, `PUZZLE`, `SOFT REVIEW`, and `HARD STOP` states. Legacy input
  aliases are normalized, while unknown or contradictory status input fails
  closed.
- `UI-002`: every surface carries a bounded outcome, public owner,
  limitation, evidence status/summary, explicit plain-text presentation
  availability, completion claim, question/options when applicable, next
  action, and human-readable text. A requested completion without verified
  evidence is downgraded to `UNPROVEN`.
- `UI-003`: direct rendering uses the shared public-payload scanner, rejects
  malformed option/evidence/presentation collections as `UNAVAILABLE`, and
  emits a frozen, schema-shaped, deterministic SHA-256 surface. Validation
  scans the complete public surface rather than only its display text.
- `UI-004`: the owner surface has a standalone JSON contract and validates its
  prompt, answer kind, choices, boolean flag, one-question rule, hidden
  internal fields, and digest against the canonical question definition before
  accepting the supplied digest.
- `UI-005`: focused fixtures cover the complete state matrix, context and
  evidence fields, plain-text fallback, malformed collections, conflict
  handling, markup inertness, protected-content withholding, schema presence,
  canonical question parity, and digest tampering. The fixture source was not
  executed under the explicit pending-tests instruction.
- `UI-006`: the Bootstrap adapter no longer owns a duplicate question table.
  It derives questions and choice values from `bootstrap-compiler.mjs`, keeps
  the canonical six-option delivery finish list, validates structured answers
  through the compiler, and uses the compiler's model-economics shorthand
  normalizer when that accepted export is present. The namespace-compatible
  fallback keeps the isolated older baseline loadable without creating a
  second authority.
- `OPS-001`: the minimum portable owner-surface slice was created in this
  isolated worktree, with the accepted source binding retained as the
  read-only authority. No accepted-merge file was edited and no unrelated
  project was touched.

### Changed files

The exact writable-scope change list is:

- `control/bootstrap-owner-surface.mjs`
- `control/rapid-prototype/security-privacy.mjs`
- `control/rapid-prototype/ui-ux.mjs`
- `schemas/bootstrap-owner-question.v1.json`
- `schemas/owner-surface.v1.json`
- `tests/rapid-prototype/ui-ux.mjs`
- `tests/verify-bootstrap-conversation-contract.mjs`
- `docs/feature-audits/OWNER_PUBLIC_SURFACE/auditreport.md`

No credentials, provider tokens, private machine paths, chat links, task
identities, or product-specific policy were added. Hostile cases use generic
synthetic placeholders only. The implementation does not write externally,
publish, deploy, activate `2.1rc`, access secrets, or retain raw owner
conversation text.

### Pre-gate source evidence — not acceptance

The following non-functional checks passed on the preserved source artifacts,
but they do not satisfy the platform gate or authorize acceptance:

- `node --check` passed for both repaired control modules and both focused test
  modules.
- `jq empty` passed for `schemas/owner-surface.v1.json` and
  `schemas/bootstrap-owner-question.v1.json`.
- The repaired files contain no trailing-whitespace findings.
- The source review found no actual secret value, credential, private location,
  provider account, session identity, or chat link.
- The owner surface and Bootstrap question validators preserve deterministic
  content digests and reject canonical-question tampering even when a caller
  recomputes the tampered digest.

Functional tests were deliberately not run. No browser, rendered UI, keyboard,
or assistive-technology host was available for an honest runtime claim; the
portable result therefore states that plain text is available while rendered
surface and accessibility are `UNAVAILABLE`.

### Pre-gate lens review

- Production readiness: `HOLD_FOR_PLATFORM_FOUNDATION`; no production
  candidate or acceptance claim is active until Controller release.
- Quality: the public boundary is typed, deterministic, frozen, content-
  addressed, and explicit about uncertainty; malformed input is withheld
  rather than silently repaired.
- Hygiene and minimality: the repair adds only the owner-surface scanner,
  renderer, Bootstrap adapter contract, focused fixtures, and this report.
  No product context or unrelated authority implementation was copied into the
  portable surface.
- Security and privacy: protected patterns, local paths, unsafe URLs,
  provider/account identifiers, session records, and caller-supplied private
  terms produce a hard stop without echoing the offending value. Whole-surface
  validation closes the direct-caller gap found in the initial audit.
- Durability: surface and question digests are deterministic; nested public
  fields are frozen; Bootstrap replies return only normalized values and do not
  retain raw conversation text.
- Regression: existing internal status aliases and the one-question behavior
  remain supported; verified completion is the only path to a `COMPLETE`
  claim; conflict and unknown status never become success.
- Custody: only this worktree contains the repair changes. The accepted
  authority remains untouched, and the changed-path list above is the handoff
  boundary.
- Boundary: no role topology, deployment, publication, merge, push, spending,
  credential, or activation behavior changed. `2.1rc` remains prepared but
  inactive.
- Intent: the result preserves low-chat operation, plain owner language,
  exact canonical question binding, explicit recovery, true-blocker handling,
  and truthful limits on rendered/accessibility evidence.

## Remaining findings and exact recovery

### PLATFORM-001 — Platform foundation gate is not released

Classification: `EXTERNAL_AUTHORITY_GATE`; this is the current release blocker.

The feature cannot be implemented, repaired, re-audited, or accepted against a
moving platform boundary. The Controller must first accept and merge the
platform skeleton, routing, stack, shared contracts, and UI direction.

Exact recovery: wait for the Controller's explicit release of this lane. Then
bind the feature audit to the newly accepted merge, re-check the platform
interfaces and UI direction, and only then resume the recorded repair and
post-gate re-audit. Preserve the current finding IDs and do not create a new
task or activate `2.1rc` during the hold.

### TEST-001 — Functional execution remains pending

Classification: `PENDING_AFTER_PLATFORM_GATE`.

After `PLATFORM-001` is released and the accepted merge is rebound, run the two
focused modules:

1. `node tests/rapid-prototype/ui-ux.mjs`
2. `node tests/verify-bootstrap-conversation-contract.mjs`

Then run the accepted rapid-prototype verification entry point and record its
readback against the exact accepted source tree. Do not replace this with an
`npm` workflow.

### HOST-001 — Rendered and assistive surfaces remain unproven

Classification: `UNAVAILABLE` evidence path, to be revisited after the platform
gate; it does not authorize a rendered-surface claim.

Recovery is to admit a browser-backed rendered check plus keyboard and
assistive-technology readback, then change only the presentation evidence
fields supported by those exact results. Until then, the implementation must
continue to report rendered surface and accessibility as unavailable.

### INTEGRATION-001 — Accepted-merge composition is pending

Classification: `PENDING_AFTER_PLATFORM_GATE`. The isolated worktree started
from the committed baseline while the accepted merge contains additional
uncommitted authority changes. The adapter is bound to the compiler module
rather than duplicating its questions and is namespace-compatible with the
accepted compiler's optional normalizers, but full composition must be checked
only after the platform gate and accepted-candidate rebinding.

Exact recovery: after Controller release, apply only the changed-path list
above to the accepted merge, run the focused modules and the accepted full
rapid-prototype verifier, then re-audit any failure against the same finding
IDs. Preserve the accepted compiler as the authority and do not activate
`2.1rc` as part of that check.

## Final held disposition

Status: `PLATFORM_GATE_PENDING_CONTROLLER_RELEASE`.

The initial audit findings and prior repair notes are preserved, but the feature
cycle remains held and no implementation, repair, re-audit, production, or
acceptance claim is active. The exact next action is for the Controller to
accept and merge the platform skeleton, routing, stack, shared contracts, and
UI direction, then release this lane for the post-gate audit cycle.
