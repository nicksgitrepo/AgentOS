# Orchestrator review: `<FEATURE_ID>`

Copy this file for each independent review and re-review. The Orchestrator
compares the candidate with the feature plan and current authority. This file
is a review record; it is not a replacement for a typed acceptance receipt.

## Review identity

- review status: `IN_PROGRESS | REPAIR_REQUIRED | ACCEPTED | PROTECTED_BLOCKED`
- review revision: `<revision>`
- feature id: `<feature-id>`
- plan reference/revision: `<opaque-plan-reference>`
- candidate source identity: `<exact commit/tree or typed readback>`
- implementation work area: `<opaque-worktree-reference>`
- implementer reference: `<opaque-implementer-reference>`
- Orchestrator reference: `<opaque-orchestrator-reference>`
- review round: `<number>`
- reviewed at: `<UTC timestamp>`

## Review scope

The Orchestrator reviewed:

- [ ] the current feature plan and owner-intent binding;
- [ ] the exact candidate source and changed-path readback;
- [ ] each acceptance criterion and required negative check;
- [ ] focused tests, broader checks required by the workflow, and retained
      evidence;
- [ ] scope, contracts, security/privacy, design/accessibility, and code
      hygiene where applicable;
- [ ] the required Pyramid or Collaborative Audit handoff evidence.

Evidence references: `<opaque references>`

The Orchestrator records the actual model route from the current canonical
policy, not from a planner's suggestion. A name such as `Luna xhigh` is
advisory only and cannot authorize capacity, spending, or a policy bypass.

## Findings and repair instructions

Use one row per issue. Do not combine unrelated failures into a vague request.
If there are no issues, write `None` and still retain the checks above.

| Issue ID | Severity | Exact location | Plan/acceptance reference | Observed evidence | Required repair | Re-test |
| --- | --- | --- | --- | --- | --- | --- |
| `ORCH-001` | `BLOCKER/HIGH/MEDIUM/LOW` | `<relative path, symbol, or boundary>` | `<AC or plan section>` | `<what failed and evidence ref>` | `<smallest issue-bound change>` | `<specific check and expected result>` |

Repair instructions are complete only when an implementer can act without
guessing. They must not ask for an unrelated cleanup or silently add scope.
Protected blockers belong in the section below, not hidden as ordinary repair.

## Acceptance gate

- [ ] The candidate solves the stated problem and follows the normal user or
      project path.
- [ ] Every acceptance criterion passes with current evidence.
- [ ] Required negative, boundary, security, privacy, and recovery checks pass.
- [ ] The implementation stays within the declared scope and allowed paths.
- [ ] No premature abstraction, speculative dependency, or scope creep was
      introduced.
- [ ] Focused tests and required workflow checks pass on this candidate.
- [ ] Source identity and evidence are current, complete, and bound to this
      review.
- [ ] The implementer did not review, accept, merge, publish, deploy, or clear
      a protected action for its own work.
- [ ] The result is ready for the next governed Pyramid or Collaborative Audit
      handoff.

## Disposition

Choose exactly one:

- `ACCEPTED` — all gates pass; record the evidence and route the candidate to
  the governed downstream handoff.
- `REPAIR_REQUIRED` — retain the issue table, send it to the implementer, and
  request a new candidate/review round.
- `PROTECTED_BLOCKED` — retain the hold and route only the authority question;
  do not accept or ask an implementer to bypass it.

Disposition: `<one value>`

Reason and evidence: `<short evidence-backed statement>`

## Repair loop

When the disposition is `REPAIR_REQUIRED`:

1. Orchestrator preserves this review and sends every open issue with its exact
   location, expected result, evidence, and re-test.
2. Implementer repairs only the issue-bound scope in the isolated work area.
   The implementer may not self-accept the candidate.
3. Implementer returns a new source identity and evidence list.
4. Orchestrator creates a new review round and checks the repaired issue plus
   all acceptance criteria that could have been affected.
5. Repeat until `ACCEPTED` or `PROTECTED_BLOCKED`.

An empty issue table from an implementer is not an Orchestrator acceptance.
Fresh review evidence is required after every repair.

## Protected blocker record

Complete this section when the dependent action cannot proceed safely.

- boundary: `<owner, authentication, spending, secrets, publication, merge,
  deployment, destructive action, custody, model policy, source, or other>`
- affected action: `<exact action held>`
- observed evidence: `<opaque evidence reference>`
- required authority/readback: `<what must be supplied and by whom>`
- unrelated safe work that may continue: `<bounded list>`
- next safe action: `<record, ask, refresh, or wait>`
- blocker status: `OPEN | CLEARED_BY_AUTHORITY`

Protected blockers remain governed. No feature plan, model suggestion,
implementer, review, or workflow choice can clear one by implication.

## Final handoff

- accepted candidate identity: `<exact source identity, only when ACCEPTED>`
- review evidence: `<opaque references>`
- downstream route: `<Pyramid Platform intake, Collaborative Audit wave, or other governed route>`
- owner delivery decision needed: `<yes/no and exact boundary>`
- closure/archive status: `<held until handoff and custody rules are satisfied>`
