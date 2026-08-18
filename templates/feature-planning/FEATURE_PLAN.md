# Feature plan: `<FEATURE_ID>`

Copy this file into the project's control plane. Keep one plan per feature and
keep its revision history. This template is a planning and implementation
handoff, not an acceptance receipt.

## Plan identity

- plan status: `DRAFT | READY_FOR_IMPLEMENTATION | SUPERSEDED`
- plan revision: `<revision>`
- feature id: `<feature-id>`
- planner role/session: `<opaque-planner-reference>`
- owner-intent reference: `<opaque-owner-intent-reference>`
- source baseline reference: `<commit/tree or typed source readback>`
- isolated implementation area: `<opaque-worktree-reference>`
- related platform domain or workflow lane: `<relative-reference>`
- created/updated: `<UTC timestamp>`

## 1. Plain-language outcome

### Problem

What user or project problem is this feature solving?

`<one short paragraph>`

### Desired result

What should be true when the feature is complete? Describe observable behavior,
not an implementation preference.

`<one short paragraph>`

### User path or workflow

Describe the normal path, including the important starting state and result.

`<short scenario or numbered path>`

## 2. Scope boundary

### Included

- `<specific behavior, surface, contract, or evidence>`
- `<specific behavior, surface, contract, or evidence>`

### Explicitly not included

- `<related but deferred capability>`
- `<unnecessary refactor, polish, provider, or abstraction>`

### Non-negotiable constraints

- `<existing contract, design, security, privacy, or compatibility rule>`
- `<owner choice or delivery boundary>`

Do not add work because it might be useful later. A new requirement requires an
owner-approved scope decision and a plan revision.

## 3. Current context and unknowns

### Source and existing behavior

Record the facts checked by the planner. Include relevant existing files,
contracts, tests, APIs, design surfaces, and platform seams as relative
references. Do not turn a guess into a fact.

- `<fact and evidence reference>`
- `<fact and evidence reference>`

### Assumptions to validate

- `<assumption>` — validation: `<how and when>`

### Open questions

- `<question>` — owner or authority needed: `<role>` — dependent action:
  `<action>`

If an open question affects implementation, keep the plan at `DRAFT` or record
the protected hold. Do not silently decide it.

## 4. Smallest sound design

Explain the design in enough detail to build and check it. Prefer the existing
project convention that already solves the problem. Introduce a new
abstraction, dependency, migration, or cross-cutting refactor only when the
outcome and acceptance checks require it.

### Behavior and data flow

`<inputs → decisions → outputs, including errors and boundary cases>`

### Surfaces and contracts

- `<relative file/API/UI surface>` — change: `<what and why>`
- `<contract or compatibility rule>` — evidence: `<how it will be checked>`

### Failure, recovery, and security

`<safe failure behavior, recovery path, privacy/security constraints, and what
must not happen>`

### Design or UI notes (when applicable)

`<layout, interaction, accessibility, copy, or design-token constraints; write
Not applicable when this feature has no user-facing surface>`

## 5. Acceptance contract

Every item must be observable and independently checkable.

| ID | Given / condition | When / action | Then / expected result | Evidence or test |
| --- | --- | --- | --- | --- |
| `AC-01` | `<starting state>` | `<action>` | `<observable result>` | `<test/evidence ref>` |
| `AC-02` | `<starting state>` | `<action>` | `<observable result>` | `<test/evidence ref>` |

### Required negative checks

- `<invalid input or unsupported state is handled safely>`
- `<scope, custody, permission, or protected action cannot be bypassed>`

### Done means

- [ ] All acceptance criteria pass with retained evidence.
- [ ] Required tests and focused checks pass on the bound source.
- [ ] No unplanned files, behavior, dependency, or scope expansion remains.
- [ ] Documentation and user-facing behavior match the accepted outcome.
- [ ] The implementation handoff is complete and points to the exact candidate.

## 6. Implementation instructions

These instructions are for an economical, capable implementer. Make each step
small enough to verify and specific enough that the implementer need not guess.

1. `<read or confirm the relevant context and baseline>`
2. `<make the smallest implementation change at relative path(s)>`
3. `<update the directly affected contract, copy, or documentation>`
4. `<run focused tests/checks and retain the result>`
5. `<prepare the typed handoff without accepting the candidate>`

### Allowed change surface

- `<relative path or declared surface>`
- `<relative path or declared surface>`

Anything outside this list needs a plan revision or an explicit bounded reason.

### Implementation notes

- Reuse: `<existing helper/pattern to reuse, or why none fits>`
- Do not: `<specific premature abstraction, unrelated cleanup, or expansion>`
- Compatibility: `<old behavior that must remain>`
- Performance/cost: `<bounded expectation and check>`

### Model and execution suggestion

- planner suggestion: `<optional model/reasoning suggestion, for example Luna xhigh>`
- canonical policy: `CURRENT_CANONICAL_MODEL_POLICY`
- actual selected route: `<Scheduler/Controller policy readback>`
- policy note: A suggestion is not a required model, host capability, or
  spending authority. The canonical policy chooses the actual model and any
  fallback; do not hard-code a suggestion to bypass that policy.

## 7. Verification and handoff

### Focused checks

- command/check: `<relative or project-provided command>`
  - proves: `<acceptance IDs>`
  - expected result: `<result>`
- command/check: `<relative or project-provided command>`
  - proves: `<acceptance IDs>`
  - expected result: `<result>`

### Handoff contents

- candidate source identity: `<exact commit/tree or typed readback>`
- changed paths: `<relative paths only>`
- test/evidence references: `<opaque references>`
- known limitations: `<bounded list or none>`
- protected actions requested: `<none, or exact held action>`
- implementer test results: `RAW_PREPARATION_EVIDENCE_ONLY_NOT_REVIEWED_OR_ACCEPTED`

The implementer may say what was tested. The implementer may not say that the
feature is independently accepted.

## 8. Plan readiness checklist

- [ ] The problem and observable result are clear in plain language.
- [ ] Included work, non-goals, constraints, and allowed change surface are
      explicit.
- [ ] Existing source and relevant authority were read and referenced.
- [ ] Unknowns are either resolved, assigned to an owner, or held as protected
      blockers.
- [ ] The design is sufficient to build but does not add speculative machinery.
- [ ] Acceptance checks include normal, negative, and boundary behavior.
- [ ] Implementation steps, tests, evidence, and handoff are detailed.
- [ ] The suggested model/effort is advisory only and remains subject to the
      current canonical model policy.
- [ ] Planner has not accepted the future implementation.

Planner readiness disposition: `READY_FOR_IMPLEMENTATION | HOLD`

Reason: `<short evidence-backed reason>`
