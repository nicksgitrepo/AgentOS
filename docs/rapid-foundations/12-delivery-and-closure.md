# Delivery and closure

Status: `READY_FOR_INDEPENDENT_CLEARANCE`

This foundation defines how a thin, source-bound governance slice reaches a
truthful local review finish, how temporary work is closed, and how unfinished
work becomes typed Iteration work. It is a portable governance contract. It
does not claim that this foundation has been independently cleared.

## Boundary

In scope:

- a local workspace checkpoint prepared for review;
- exact source, scope, changed-path, result, and evidence custody;
- a separate independent check of the exact handoff;
- preservation of the handoff before temporary work is closed;
- host-mediated close, archive, and removal of temporary work;
- a zero-active-temporary-work readback; and
- a typed handoff into Iteration Mode when work remains.

Out of scope for this rapid slice:

- authentication, secrets, spending, provider selection, or provider access;
- remote push, merge, publication, deployment, release, or production claims;
- replacing a missing readback with a caller assertion, a generic worker, a
  child, or a shell stand-in;
- deleting preserved evidence or public authority records; and
- activating a prepared release candidate or silently inheriting an old
  roster.

The rapid finish is local and review-ready. A later delivery finish may add
remote or live actions only through a fresh typed boundary, exact adapters,
independent evidence, and an owner-approved plan. A local review finish never
implies remote equality, availability, deployment, or release.

## Intended behavior

1. **Bind the exact source before handoff.** Read back the host project
   identity, working directory, Git top-level, source commit, and source tree.
   The readback is authoritative; a setup token or caller assertion is not.
   Compare it with the launch-gate binding before any delivery or closure
   decision. If the lane write changes the working tree, distinguish the
   pre-write source identity from the later checkpoint identity.

2. **Reconcile the approved scope.** Record the bounded task, intended
   outcome, changed paths, focused checks, and any local cleanliness or
   checkpoint result. A handoff may name only work that is observable and
   inside the approved scope. A failed or omitted check remains failed or
   omitted; narration cannot turn it into a pass.

3. **Prepare for independent review.** The handoff identifies the exact
   checkpoint and asks a separate admitted checker to inspect it. The builder,
   coordinator, or delivery writer must not accept its own result. The
   independent checker uses the same source identity and evidence roots, and
   records `PASS`, `FAIL`, or `UNAVAILABLE` with a digest-backed reason.

4. **Preserve before closing.** Store the typed handoff, evidence index, open
   risks, and any deferred items before stopping temporary work. Public
   summaries contain portable facts and digests only; private environment and
   identity readbacks remain in the typed control plane.

5. **Close the temporary roster through the universal sequence.** The
   Controller must prove `PRESERVE_HANDOFF`, `PERSIST_HANDOFF`,
   `AUDIT_CANDIDATE`, `INTEGRATE_ACCEPTED_WORK`, `UNPIN_SESSION`,
   `CLOSE_STALE_WORKTREE`, `REMOVE_ACTIVE_TASK_SCOPE`,
   `MARK_CHAT_OUT_OF_SCOPE`, and `ARCHIVE_VISIBLE_TASK`, in that order.
   Archival is dynamic and happens as soon as the task's own handoff,
   integration, scope-removal, stale-worktree, and chat-out-of-scope receipts
   are present. Read back each host result and verify that no temporary role
   remains active. The persistent coordinator and project Runtime, when
   admitted, are not temporary work and remain bound. Preserved evidence is
   never treated as disposable temporary work.

6. **Enter Iteration explicitly.** Any deferred result becomes a typed item
   bound to the accepted source and reason for deferral. A later campaign is a
   fresh admission with a fresh source-bound goal; it is not an automatic
   continuation of a closed temporary roster.

## Decision routing

Routine, bounded local problems remain a puzzle: route one reversible repair,
recheck the exact checkpoint, and refresh the evidence. A change to a
non-protected preference inside the owner boundary is a soft review: record
the choice, impact, and new digest, and pause only dependent delivery work.

Changed intent or scope, stale source, false or unavailable identity, secret or
private-context exposure, an unapproved role, an external action, destructive
cleanup, or an inability to close temporary work is a hard stop. Preserve the
evidence, do not claim delivery, and require a fresh source-bound decision when
the condition changes.

## Unavailable behavior

Unavailable behavior is explicit and fail-closed:

- If the host cannot provide a real identity, pinned readback, exact source
  binding, or current working-directory readback, return
  `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH` when a value differs;
  otherwise return `UNAVAILABLE_IDENTITY_READBACK`. Stop before the affected
  write or acceptance and preserve the finding.
- If the source changes after the launch-gate readback, mark the handoff
  stale. Do not reuse the earlier evidence; close the current outcome and
  request a fresh source-bound goal.
- If an independent checker, focused check, archive operation, or zero-active
  roster readback cannot run, report `UNAVAILABLE`, keep acceptance open, and
  do not substitute a self-check or a verbal success claim.
- If a requested finish needs push, merge, publication, deployment, release,
  authentication, or spending but the exact typed boundary and adapter are
  absent, report `NOT_RUN_OWNER_BOUNDARY` or `UNAVAILABLE`. The safe result is
  local review only, or a hard stop for the dependent outcome.
- If closure is partial, preserve the handoff and report the exact close
  failure. Do not create successor work, reuse the temporary identity, or
  declare the roster closed while any temporary work is unverified.

## Hostile cases

The following cases must remain rejected or explicitly unavailable:

| Hostile attempt | Required response |
| --- | --- |
| A session reports the expected project but its host readback names a different project, working directory, or Git source. | Stop before the affected write; record `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`; archive/remove only through the host; accept nothing. |
| A changed commit or tree is paired with evidence from the earlier source snapshot. | Reject the stale handoff and require fresh evidence for the exact checkpoint. |
| A dirty, untracked, or out-of-scope path is omitted from the changed-path manifest. | Do not mark the checkpoint review-ready; route one bounded repair or a hard stop according to the cause. |
| The builder, writer, or coordinator also supplies the independent acceptance. | Reject self-acceptance and request a separate admitted checker with distinct readback. |
| A local review request is treated as permission to push, merge, deploy, publish, release, authenticate, or spend. | Keep the action `NOT_RUN_OWNER_BOUNDARY`; do not infer permission or claim completion. |
| Evidence is discarded before the temporary work is archived and read back. | Refuse closure, preserve what remains, and report a closure failure. |
| A child, generic role, shell stand-in, inherited old record, or unverified temporary role appears in the roster. | Freeze roster closure and acceptance; do not count or repair the unadmitted entry inside this lane. |
| The host cannot prove that every temporary role is closed, archived, or removed. | Report `UNAVAILABLE` or `HARD_STOP`; no successor campaign starts. |

## Focused check ideas

These checks are intentionally narrow and should be run by the owning host or
independent checker:

- **Source-binding check:** compare host project identity, working directory,
  Git top-level, commit, and tree against the exact launch-gate readback; test
  mismatch before write and stale source before acceptance.
- **Scope/checkpoint check:** recompute changed paths and the checkpoint
  observation, verify that every path is approved, and ensure focused checks
  have typed results rather than prose-only claims.
- **Handoff integrity check:** validate required fields, allowed status values,
  source binding, evidence digests, open-risk classification, next handoff, and
  the rule that clearance is not claimed by the lane writer.
- **Independent-check check:** require a distinct admitted checker, the exact
  same checkpoint identity, and a result of `PASS`, `FAIL`, or `UNAVAILABLE`;
  reject duplicate or self-supplied acceptance.
- **Closure check:** validate the complete universal closeout receipt sequence,
  read back close/archive/remove results, verify zero active temporary work,
  confirm the chat is out of scope, and confirm that persistent control roles
  are not accidentally removed or duplicated.
- **Iteration-binding check:** require every deferred item to carry an ID,
  kind, status, source digest, bounded scope, owner lane, acceptance roots or
  checks, dependency, reopen trigger, and handoff digest; reject an untyped
  continuation.
- **Public-cleanliness check:** scan the public lane and handoff summary for
  secrets, private paths, provider or account identities, chat links, and
  session records; reduce permitted private readbacks to typed status and
  digests.

## Typed handoff

The lane returns one structured handoff. The values are supplied by typed
project context and host readback; this public contract does not carry private
identity values or session records.

```text
schema: DELIVERY_AND_CLOSURE_HANDOFF_V1
status: READY_FOR_INDEPENDENT_CLEARANCE | UNAVAILABLE | HARD_STOP | DEFERRED
public_lane: Delivery and closure
task_scope:
  in_scope: typed list
  out_of_scope: typed list
  changed_paths: typed list
source_binding:
  commit: exact Git object readback
  tree: exact Git tree readback
  result: MATCH | STALE | MISMATCH | UNAVAILABLE
progress:
  state: NOT_STARTED | IN_PROGRESS | MEANINGFUL | BLOCKED
  summary: secret-free bounded summary
result:
  local_review: READY | NOT_READY | UNAVAILABLE
  external_effects: NONE | NOT_RUN_OWNER_BOUNDARY | UNAVAILABLE
independent_check:
  status: REQUESTED | PASS | FAIL | UNAVAILABLE
  evidence_digest: SHA256 digest or null
closure:
  handoff_preserved: true | false
  temporary_work: PENDING | CLOSED | ARCHIVED | REMOVED | UNAVAILABLE
  active_temporary_count: typed count or null
  receipt_digest: SHA256 digest or null
iteration:
  items: typed list of deferred records or empty list
open_risks: typed secret-free list
next_handoff: FOUNDATION_CLEARANCE | REPAIR | ITERATION | HUMAN_REVIEW
clearance: NOT_CLAIMED
```

`READY_FOR_INDEPENDENT_CLEARANCE` means the lane has supplied meaningful,
source-bound work and a checkable handoff. It is not `PASS`, `ACCEPTED`, or
`CLEARED`. The next recipient independently checks this foundation, records
the evidence digest and any bounded finding, and only then decides whether the
foundation set may advance.

## Close readiness

This lane is ready to hand off when its public boundary is portable and
secret-free, the source and scope are read back exactly, the local review
result is honest, hostile cases and focused checks are recorded, the typed
handoff is preserved, and no clearance claim is made. Final closure remains
conditional on independent clearance and the host's exact temporary-roster
readback. The prepared release candidate remains inactive.
