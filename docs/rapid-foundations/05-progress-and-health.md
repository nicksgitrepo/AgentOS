# Progress and health

Status: public foundation contract, prepared for independent clearance

## Purpose

This lane defines how one admitted, bounded outcome proves movement, remains
observable, waits safely, reports health, and closes. It makes progress
legible to the supervising authority without turning activity, elapsed time,
or a plausible message into evidence of completion.

This is a portable governance rule. It does not depend on a particular
product, provider, deployment target, user record, or runtime implementation.

## Boundary

In scope:

- binding progress to the exact admitted task, scope, authority, and source
  readback;
- distinguishing concrete progress from liveness, health, waiting, failure,
  and completion;
- emitting compact progress and heartbeat observations at bounded intervals;
- detecting stale work, reconciling liveness gaps, and preserving exact
  blockers and evidence; and
- returning a typed handoff that another authority can inspect independently.

Out of scope:

- changing owner intent, scope, acceptance criteria, role admission, or
  topology;
- creating children, generic or recursive workers, or shell stand-ins;
- authorizing product writes, credentials, external actions, deployment,
  publication, release, push, merge, or destructive work; and
- treating this lane as an acceptance authority. A progress record can show
  that work moved; it cannot by itself prove that the result is acceptable.

The lane has one bounded writer and one admitted task at a time. A heartbeat
proves that an observation channel is alive at a point in time. It is not
concrete progress, an acceptance decision, or permission to extend a deadline.

## Meaning of the signals

| Signal | Meaning | Minimum proof |
| --- | --- | --- |
| Concrete progress | A task-bound change that materially advances the outcome | A new bounded batch, resolved dependency or contract, released lease, immutable checkpoint, or exact blocker with an actively executing in-scope recovery |
| Liveness | The admitted session or observation channel can still return a bounded readback | Fresh heartbeat or equivalent readback tied to the same identity and source |
| Health | The work can continue safely under the current authority and boundary | Fresh identity, source, scope, dependencies, and boundary observations; no unhandled hard stop |
| Waiting | Work is intentionally paused for a named dependency or resume condition | Reason, affected outcome, next observation time or event, and resume condition |
| Stalled | The finite progress interval elapsed without concrete progress or an executing bounded recovery | Interval observation plus the exact missing progress evidence |
| Unavailable | A required identity, capability, dependency, observation, or check cannot be established | Exact unavailable reason, affected outcome, preserved evidence, and a safe next route |
| Complete | The bounded task has a recorded result and required checks, and its handoff is ready | Result, evidence, independent-check status, open risks, and closure state |

`IN_PROGRESS` is valid only when there is a concrete next action. `WAITING`
is not a disguised success. `UNPROVEN` is not `PASS`.

## Intended behavior

1. **Bind before work.** Record the exact task and scope, source commit and
   tree, authority boundary, acceptance roots, finite progress interval, and
   next action. A caller-supplied label or inherited status is not an
   identity readback.

2. **Report meaningful movement.** At each substantial transition, publish a
   compact observation containing the task identity, status, last concrete
   progress identity, observed time, current health, next action, and evidence
   digest. Preserve prior observations so a later summary cannot erase a
   failed or stale state. Do not retain unbounded logs in the public handoff.

3. **Separate cadence from progress.** Emit bounded heartbeats while active,
   but evaluate concrete progress separately. Repeated heartbeats with no
   new progress do not reset the progress interval. A healthy idle channel is
   still idle.

4. **Make waiting explicit.** A wait must name the dependency or decision it
   is waiting for, the outcome it affects, the next bounded observation, and
   the condition that resumes work. A held dependent outcome has no progress
   timer until its exact resume check passes; unrelated safe work may continue.

5. **Reconcile a stall.** When the progress interval expires, the supervising
   authority inspects the current owner, task, budget, lease, source, session,
   and dependency observations. It may repair one localized puzzle that keeps
   the same route and boundary, record a true wait, hold the dependent
   outcome, or stop. It must not create a micro-goal, broaden custody, or
   silently replace the identity.

6. **Close truthfully.** Completion requires a result and the required checks.
   A timeout, missing output, summarized-only output, or failed check remains
   `UNPROVEN` or `FAIL`; narration cannot promote it. The final handoff names
   the next route, preserves risks and evidence, and records whether the
   temporary work is ready to close or failed to close.

## Unavailable behavior

- If project, task, source, scope, or authority readback is missing, stale,
  ambiguous, or mismatched, freeze the dependent writes and return a hard
  stop with `health: UNAVAILABLE`. Do not infer identity from a setup token,
  a caller assertion, or a previous record.
- If a heartbeat is absent or stale, mark liveness `STALE` or `UNKNOWN`. Keep
  the last exact record, perform only an authorized bounded reconciliation,
  and do not claim progress, success, or a silently replaced session.

### Completed zero-output host sessions

A turn that runs for at least 30 seconds, completes without a reported error,
persists zero assistant, tool, command, and durable-result items, and has no
remaining process is a host-session failure—not an idle lane, blocker, or
successful retry. Preserve the exact worktree, branch, HEAD/tree, status digest,
and pair handoff. Do not retry that session repeatedly and do not stop unrelated
lanes. Admit a fresh project-bound session only after a visible-execution probe
persists an assistant or tool item and verifies the required cwd; bind it to the
same custody without reset or cleanup, then archive the failed session. This is
a lifecycle repair and adds no Controller approval to ordinary Repair/Auditor
work. Once admitted, the pair resumes direct autonomous operation.
- If a required capability or dependency is unavailable, return `WAITING` or
  `UNAVAILABLE` with the exact blocker and resume condition. Do not authenticate,
  spend, retry without a changed observation, invent a substitute, or pause
  unrelated safe outcomes.
- If a focused check times out, cannot run, or returns incomplete evidence,
  return `independent_check: UNPROVEN` and keep the result unaccepted.
- If owner intent, policy, source, or boundary changes during the task, close
  the current goal safely and require a fresh source-bound admission. Do not
  continue under a stale progress record.

Unavailable is a typed outcome, not an empty field and not an invitation to
pretend that work completed.

## Hostile cases

| Case | Required disposition |
| --- | --- |
| A session emits frequent heartbeats but no concrete checkpoint, batch, dependency resolution, or executing recovery | Count liveness only; let the finite progress interval expire and route reconciliation or a hold |
| A progress message carries a different task, source, scope, or identity than the admitted packet | Reject the observation, preserve the mismatch evidence, freeze the dependent route, and return a hard stop |
| A worker resets its timer by posting “still working,” repeating a summary, or renaming the next action without movement | Keep the prior progress timestamp; classify as stalled when the interval expires |
| A dead or stale session is replaced under the same identity, or a helper is spawned to make the roster look healthy | Reject silent replacement and topology expansion; retain the stale record and require a fresh admitted identity |
| A timed-out check is reported as passed because the expected output was not available | Set the check to `UNPROVEN`; do not accept the result |
| A blocked outcome causes unrelated safe work to be paused, or a dependency wait has no resume condition | Narrow the hold to the dependent outcome and require a typed wait; unrelated work continues |
| A stalled task requests broader scope, a new capability, credentials, or an external action as its “recovery” | Treat the request as a hard boundary, not as progress or a puzzle repair |

## Focused check ideas

These are focused check ideas for independent clearance; they are not a
claim that this lane has already been cleared.

| Check | Expected observation |
| --- | --- |
| Compile a valid progress observation and replay it | Required fields, task binding, UTC time, and evidence digest validate deterministically |
| Replay a heartbeat-only sequence across one full progress interval | Liveness remains visible, but the outcome becomes stalled and is reconciled |
| Submit a progress observation with a stale source, task, or scope | The observation is rejected before dependent acceptance or mutation |
| Exercise a named dependency wait with a finite resume condition | Status is `WAITING`; the dependent timer is held and unrelated safe work remains eligible |
| Exercise an absent heartbeat and an unavailable host capability | Health becomes `STALE` or `UNAVAILABLE`; no same-identity replacement or success claim is produced |
| Return timeout, missing, summarized-only, and failed check outputs | Independent-check status is `UNPROVEN` or `FAIL`, never `PASS` |
| Reconcile a localized puzzle and then recheck the handoff | Exactly one bounded repair is routed; the fresh check is required before completion |
| Inspect the public handoff for leakage and topology expansion | No secret, private context, provider identity, session record, child, generic role, or shell stand-in appears |

## Typed handoff

The live handoff is filled from host and control-plane readbacks. The
placeholders below are intentionally not evidence and keep this public
contract portable; private project, root, and session values belong only in
the protected control-plane receipt.

```yaml
handoff_schema: "foundation-handoff.v1"
lane: "Progress and health"
role: "<exact admitted lane role>"
binding:
  project_identity: "<exact host readback; not copied into public text>"
  cwd: "<exact host readback; not copied into public text>"
  source_commit: "<40-hex source commit read back from host>"
  source_tree: "<40-hex source tree read back from host>"
task:
  task_id: "<exact task or goal identifier>"
  scope: "<one bounded outcome>"
progress:
  status: "NOT_STARTED | IN_PROGRESS | WAITING | BLOCKED | FAILED | COMPLETED"
  last_concrete_progress: "<exact checkpoint, batch, dependency, or blocker>"
  observed_at_utc: "<UTC timestamp>"
  progress_interval: "<finite interval and time basis>"
  next_action: "<one bounded action or typed wait>"
health:
  status: "HEALTHY | DEGRADED | STALE | UNAVAILABLE"
  liveness: "LIVE | STALE | UNKNOWN"
  blocker: "<null or exact blocker>"
result:
  status: "PASS | FAIL | UNPROVEN | NOT_RUN"
  summary: "<bounded result statement>"
hostile_coverage:
  cases: ["<case identifiers or descriptions>"]
  disposition: "COVERED | FINDING | UNPROVEN"
independent_check:
  status: "NOT_REQUESTED | PENDING | PASS | FAIL | UNPROVEN"
  evidence_digest: "<sha256 or null>"
evidence_digests: ["<sha256> or none"]
open_risks: ["<risk> or none"]
handoff_kind: "ACCEPTED_RESULT | PUZZLE | SOFT_REVIEW | HARD_STOP | DEFERRED_ITERATION"
closure:
  status: "OPEN | READY_TO_CLOSE | CLOSED | CLOSE_FAILED"
  close_failure: "<null or exact close failure>"
next_handoff: "<named route and required next check>"
```

The handoff is ready for independent clearance only when its identity,
progress evidence, hostile coverage, check status, open risks, and closure
state are all explicit. This lane does not grant itself clearance.
