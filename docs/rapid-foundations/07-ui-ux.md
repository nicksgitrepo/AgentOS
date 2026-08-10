# UI/UX Foundation

Status: `PORTABLE_PUBLIC_FOUNDATION`

Role: `FOUNDATION_UI_UX`

Public lane: `UI/UX`

## Boundary

This lane defines the usable public-facing surface for a thin, governed
workflow. It covers how a person can understand the current outcome, state,
ownership, next action, and honest limitations from a rendered surface or a
plain-text/Markdown fallback.

In scope:

- a clear hierarchy that puts the current outcome and state before detail;
- stable labels for ready, working, waiting for a decision, blocked,
  unavailable, conflict, and complete states;
- explicit next actions, safe defaults, concise error recovery, and preserved
  user choices;
- readable content, semantic structure, keyboard access, visible focus,
  reflow/zoom support, and text alternatives when a rendered surface exists;
- explicit loading, empty, stale, partial, permission, offline, and error
  states; and
- presentation of only admitted public roles and public evidence summaries.

Out of scope:

- product-specific branding, product workflows, provider integrations, or
  deployment/release behavior;
- private control-plane records, raw conversations, credentials, secrets,
  session details, or environment paths;
- creating, admitting, routing, or supervising workers, children, generic
  roles, shell stand-ins, or legacy compatibility roles; and
- claiming accessibility, completion, or acceptance without the corresponding
  focused check.

The surface is a view of typed intent, state, evidence, and handoff. It is not
a second authority source and must never turn missing evidence into a success
message.

## Intended behavior

1. **Show one truthful current view.** Present the intended outcome, current
   state, responsible public role, next action, and any material limitation in
   the same view. Keep the state label stable while the underlying state is
   unchanged.
2. **Make every action legible.** Name an action by its outcome, show what it
   will change, and make the safe path the default. Do not hide an external,
   irreversible, or approval-dependent effect behind a routine-looking control.
3. **Make waiting observable.** A working state explains what is being waited
   on and what evidence will end the wait. A waiting state is not a success
   state, and an absent update is not proof of progress.
4. **Make failure recoverable.** An error or blocked state gives a short reason,
   preserves the last known safe context, and names the next bounded action or
   handoff. Never use an endless spinner or a generic failure message when the
   capability is known to be unavailable.
5. **Support inclusive use.** Use plain language, meaningful headings and
   labels, logical focus order, visible focus, sufficient contrast, text
   alternatives, keyboard operation, and layouts that survive zoom, narrow
   widths, long labels, empty lists, and large text. Mark unchecked properties
   as `UNPROVEN` rather than implying a pass.
6. **Keep the public boundary visible.** Show public role names and compact
   evidence summaries only. A legacy compatibility name, unknown role, or
   internal record is not a current public actor and must not be presented as
   one.

## Unavailable behavior

Unavailable behavior is a typed result, not a silent omission or a fabricated
fallback.

| Condition | Required public behavior |
| --- | --- |
| No rendered surface is available | Use the plain-text/Markdown contract, label the rendered experience `UNAVAILABLE`, and do not claim interactive completion. |
| Current state or ownership cannot be verified | Show `UNPROVEN` or `UNAVAILABLE`, identify the missing readback in general terms, and hold acceptance. |
| Source or state readbacks disagree | Show `CONFLICT`, preserve the known facts, block a success/complete transition, and route for a fresh exact check. |
| A required capability or host is unavailable | Show the capability as unavailable, state the safe next action, and do not simulate progress. |
| Accessibility or layout checks have not run | Show the surface as `UNPROVEN`; retain the check as open work rather than clearing the lane. |
| A public action is not permitted in the current boundary | Explain that it is unavailable here and name the allowed local handoff, without offering a hidden bypass. |

## Hostile cases

The following cases are part of the lane’s minimum hostile coverage. Each
must produce a deterministic, visible outcome rather than a silent repair.

| Hostile input or condition | Expected handling |
| --- | --- |
| A stale or mismatched source/readback is paired with a success message | Replace success with `CONFLICT` or `BLOCKED`; preserve the mismatch for the evidence owner and require a fresh check. |
| A secret, credential, private path, raw session detail, or private conversation is injected into public content | Refuse or redact the content, prevent publication of the affected view, and route a security/privacy hard stop. |
| A legacy compatibility name, unknown role, child, generic worker, or shell stand-in appears as an active actor | Mark it unadmitted, do not route or display it as current authority, and do not create a replacement actor from the surface. |
| An unavailable capability is represented as an endless spinner, disabled control with no reason, or fabricated progress | Show `UNAVAILABLE` with the known limitation and bounded next action; never infer progress from silence. |
| Duplicate or contradictory states are supplied for one outcome | Show `CONFLICT`, do not choose one silently, and hold the dependent action until the authority is reconciled. |
| Long, malformed, or hostile text breaks hierarchy, escapes its container, or hides a required action | Render it as inert text, preserve the required state and action, and classify the affected layout check as failed or `UNPROVEN`. |
| Keyboard focus is trapped, a control has no meaningful label, or status is conveyed by color alone | Do not clear the UI/UX gate; record the specific accessibility failure and keep the outcome `UNPROVEN`. |

## Focused check ideas

- **State matrix:** For each meaningful state, verify a human-readable label,
  reason/limitation, owner or route, next action, and acceptance consequence.
- **Unavailable fixtures:** Remove the surface, capability, readback, and
  permission one at a time. Expect `UNAVAILABLE`/`UNPROVEN`, a safe message,
  and no false completion.
- **Conflict fixtures:** Feed stale, mismatched, duplicate, and contradictory
  state records. Expect deterministic `CONFLICT`/`BLOCKED` behavior and a
  preserved handoff request.
- **Public-boundary scan:** Check that public text contains no secrets,
  private paths, raw session records, provider names, or unadmitted roles, and
  that it names no external action as complete.
- **Rendered-surface check:** When a surface exists, exercise keyboard-only
  navigation, focus visibility, labels, text alternatives, contrast, zoom,
  reflow, long content, empty states, and narrow layouts. If it does not exist,
  record the check as `UNAVAILABLE`, not `PASS`.
- **Handoff consistency:** Confirm that the visible state, next action, typed
  handoff, and evidence summary agree; a public summary may shorten detail but
  may not change its classification.

## Typed handoff

This is a public, portable handoff contract. Exact project, session, source,
and environment readbacks belong in the control-plane receipt supplied with
the lane; they are deliberately not embedded in this public foundation.

```yaml
schema: foundation_handoff.v1
phase: ASSEMBLE_FOUNDATION_LANES
role: FOUNDATION_UI_UX
public_lane: UI/UX
task: Define the usable public-facing surface boundary for a thin governed workflow.
scope: BOUNDED_UI_UX_FOUNDATION
progress: COMPLETE
result: READY_FOR_INDEPENDENT_CLEARANCE
hostile_coverage:
  status: COMPLETE
  cases: 7
independent_check:
  status: REQUIRED_NOT_RUN
  owner: FOUNDATION_CLEARANCE_AUDITOR
evidence:
  public_cleanliness: CHECKED
  state_and_unavailable_contract: PRESENT
  exact_source_readback: CONTROL_PLANE_RECEIPT_REQUIRED
open_risks:
  - A rendered surface and its accessibility checks may remain unavailable until a later thin-slice implementation exists.
  - Cross-lane clearance has not yet been performed.
next_handoff: FOUNDATION_CLEARANCE_AUDITOR
disposition: READY_FOR_INDEPENDENT_CLEARANCE
```

This lane is not independently cleared by this document. Clearance requires a
separate review of this file, its hostile coverage, the exact source-bound
receipt, and the focused checks.
