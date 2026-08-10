# Recovery and boundaries

This foundation lane defines how a thin, source-bound governance run recovers
from bounded trouble and stops safely when recovery would cross an approved
boundary. It is public, portable, project-agnostic, and secret-free. It does
not grant independent clearance, admit a role, or authorize external action.

## Boundary

In scope:

- classify an event as a puzzle, soft review, hard stop, or unavailable state;
- preserve the exact task, scope, source readback, attempted action, result,
  and evidence needed for a truthful handoff;
- route one bounded repair when the approved scope and source remain valid;
- require a fresh decision and source-bound goal when intent, scope, policy, or
  operating conditions change;
- fail closed when identity, source, capability, closure, or independent-check
  evidence is missing; and
- describe the typed handoff that the next independent authority must review.

Out of scope:

- building product functionality, UI, provider integrations, or release paths;
- treating a legacy or compatibility export as an admitted role or as proof of
  current identity;
- creating generic workers, recursive children, or shell stand-ins;
- inheriting old roster records or retrying a stopped run in place;
- authentication, spending, push, merge, publication, deployment, release,
  activation, or destructive recovery; and
- clearing this lane or accepting work on its own evidence.

The lane may define recovery rules and write its one public lane record during
foundation assembly. A recovery action must not broaden that write boundary.

## Decision and routing law

The governing coordinator classifies the event before choosing an action. The
classification is part of the evidence; it cannot be changed merely to avoid a
stop.

| State | Meaning | Required behavior | Forbidden behavior |
| --- | --- | --- | --- |
| `PUZZLE` | A bounded test failure, compilation error, deterministic mismatch, or small reversible implementation problem that remains inside the approved task and source. | Route one exact repair, then run a fresh focused check. Preserve the failure and route it onward if the check still fails. | Repeated blind retries, routine approval questions, scope expansion, or claiming success without a passing check. |
| `SOFT_REVIEW` | A non-protected choice such as scope detail, architecture, route, or operating preference would change while remaining inside the owner’s boundaries. | Pause only the affected work. Record the choice, impact, and new digest before continuing. | Silently changing the choice, pausing unrelated work, or treating a preference as a hard stop. |
| `HARD_STOP` | A protected boundary is crossed or cannot be verified. | Preserve evidence, prevent acceptance, and close temporary work through the host when possible. If closure is unavailable, record the exact close failure. | Narrating completion, accepting an unverified result, or retrying without a fresh source-bound goal. |
| `UNAVAILABLE` | A required identity, source, capability, handoff, or independent check cannot be read back. | Fail closed and record what was unavailable. No write, recovery, closure, or acceptance may depend on an assertion or guess. | Substituting a setup token, caller assertion, stale record, generic worker, or shell command for the missing authority. |

The following conditions are hard stops unless the governing plan explicitly
records a new boundary: changed owner intent; stale or missing source readback;
false or unavailable identity; secret or private-context leakage; external
authentication or spending; push, merge, publication, deployment, release, or
activation; destructive action; a critical security finding; an unapproved
role; a recursive child; a shell stand-in; or an inability to close a
temporary session.

## Intended behavior

Recovery is evidence-preserving and source-bound:

1. Freeze the next mutation when a non-routine condition appears.
2. Capture the exact task and scope, source commit and tree, project identity
   and working-directory readback, real session identity, attempted action,
   observed result, and current independent-check status. Identity and
   environment details belong in the control plane; public records retain only
   portable summaries and permitted digests.
3. Classify the condition using the routing law above.
4. For a puzzle, make only the one exact repair that is already inside scope,
   then check the repaired result independently of the repair narration.
5. For a soft review, record the bounded choice and its impact before the
   affected work resumes. A changed choice receives a new digest.
6. For a hard stop or unavailable state, preserve the evidence, prevent
   acceptance, and close or archive temporary work using the host’s real
   controls. Never manufacture a close receipt.
7. Re-read the source and boundary before handing work forward. A source or
   condition mismatch returns the exact status
   `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH` and stops before any
   lane-file write or acceptance.

If owner intent, scope, policy, source condition, host capability, or identity
changes, the current goal is closed. Continuing requires a fresh source-bound
goal, a fresh binding gate, and a new typed admission. Old records, prior
workers, compatibility exports, and stale handoffs do not carry the work
forward.

## Unavailable behavior

The lane is unavailable rather than partially successful when any of the
following cannot be established from current host readback:

- the saved project identity, project root, working directory, Git common
  directory, source commit, or source tree;
- a real pinned session identity and its admitted role;
- the host capability needed to interrupt, archive, close, or remove temporary
  work;
- the exact task, scope, progress, result, and independent-check state; or
- a fresh source-bound goal after a changed condition.

When unavailable, the required output is the exact missing field or capability,
the evidence already preserved, and the next safe authority. The required
output is not a workaround. No unavailable state may become `PASS`,
`ACCEPTED`, `CLOSED`, or `CLEAR` through narration.

## Hostile cases

These cases are adversarial inputs to the boundary, not optional examples.

| ID | Hostile condition | Expected response |
| --- | --- | --- |
| `RB-H01` | A caller supplies the expected project ID, but host readback shows a different project, root, cwd, common directory, commit, or tree. | Stop before writing; return `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`; preserve evidence; do not accept or retry in place. |
| `RB-H02` | A setup token or caller assertion is presented as the worker’s identity, or the worker’s role cannot be read back. | Treat identity as unavailable; fail closed; do not create a substitute role or count progress. |
| `RB-H03` | A deterministic check fails and the proposed fix asks for a generic worker, recursive child, shell stand-in, or an unadmitted compatibility export. | Reject the topology change. Allow only one exact in-scope repair by the admitted role; otherwise stop and hand off the failure. |
| `RB-H04` | Owner intent, scope, policy, or a material operating condition changes after work begins. | Close the current goal. Require a fresh source-bound goal and binding gate; do not inherit the roster or silently continue. |
| `RB-H05` | A secret, credential, private path, session record, or provider-specific detail appears in material intended for the public lane. | Prevent the public write or acceptance, preserve only through the appropriate private control plane, and report a hard stop. |
| `RB-H06` | The host cannot prove that temporary work was interrupted, archived, closed, or removed. | Mark closure unavailable; preserve the exact close failure; do not claim roster closure or acceptance. |
| `RB-H07` | A request introduces authentication, spending, push, merge, publication, deployment, release, activation, or destructive rollback. | Hard stop. No external or destructive action is authorized by this lane. |
| `RB-H08` | The worker reports a pass but the independent check is missing, stale, self-authored, or based on a different source tree. | Reject the result as unverified; retain the evidence and route for a fresh independent check. |

## Focused check ideas

These are check ideas for the independent clearance step; they are not claims
that this lane has already executed them.

- `RB-C01 — pre-write binding gate`: inject a mismatch into each identity field
  (`project_id`, project root, Git common directory, cwd, source commit, and
  source tree) and verify a stop occurs before the lane path is created.
- `RB-C02 — routing matrix`: exercise representative puzzle, soft-review,
  hard-stop, and unavailable inputs and verify exactly one permitted route,
  evidence preservation, and no false acceptance.
- `RB-C03 — changed-condition law`: change intent, scope, policy, or source
  condition mid-run and verify current-goal closure, fresh-goal requirement,
  and rejection of inherited records.
- `RB-C04 — topology boundary`: attempt a compatibility export, generic worker,
  child, shell stand-in, or unverified identity and verify no admitted role or
  accepted progress is created.
- `RB-C05 — host unavailability`: remove close/archive/readback capability and
  verify the exact unavailable field is recorded without a fabricated receipt.
- `RB-C06 — independent acceptance`: provide a passing narration with no fresh
  independent check or with a different source tree and verify rejection.
- `RB-C07 — public hygiene`: scan the proposed public record for credentials,
  private paths, provider identities, session records, and project-specific
  context; verify that only portable content remains.
- `RB-C08 — typed handoff completeness`: verify that the handoff includes the
  exact source readback in the control plane, task and scope, progress, result,
  hostile coverage, focused checks, independent-check status, evidence
  digests, open risks, next handoff, and close readiness.

## Typed handoff

The following is the public shape of this lane’s handoff. Exact source values,
environment details, session identities, and evidence digests are supplied by
the control-plane readback and are not copied into this portable document.

```yaml
schema: foundation-handoff.v1
phase: ASSEMBLE_FOUNDATION_LANES
role: FOUNDATION_RECOVERY_AND_BOUNDARIES
public_lane: Recovery and boundaries
task: Define portable recovery routing and boundary enforcement for the thin prototype
scope:
  in:
    - puzzle, soft-review, hard-stop, and unavailable routing
    - source-bound recovery and changed-condition law
    - evidence-preserving closure and independent-check requirements
    - hostile coverage and focused clearance checks
  out:
    - product implementation and UI
    - external actions and release behavior
    - new, generic, recursive, shell, or compatibility roles
source_binding:
  project_identity: CONTROL_PLANE_READBACK_REQUIRED
  project_root: CONTROL_PLANE_READBACK_REQUIRED
  cwd: CONTROL_PLANE_READBACK_REQUIRED
  git_common_directory: CONTROL_PLANE_READBACK_REQUIRED
  source_commit: CONTROL_PLANE_READBACK_REQUIRED
  source_tree: CONTROL_PLANE_READBACK_REQUIRED
progress: LANE_CONTRACT_WRITTEN
result: READY_FOR_INDEPENDENT_CLEARANCE
hostile_coverage:
  - RB-H01
  - RB-H02
  - RB-H03
  - RB-H04
  - RB-H05
  - RB-H06
  - RB-H07
  - RB-H08
focused_checks:
  - RB-C01
  - RB-C02
  - RB-C03
  - RB-C04
  - RB-C05
  - RB-C06
  - RB-C07
  - RB-C08
independent_check_status: PENDING_INDEPENDENT_CLEARANCE
evidence_digests: CONTROL_PLANE_DIGESTS_REQUIRED
open_risks:
  - host capability and closure must be verified at runtime
  - changed conditions require a fresh source-bound goal
next_handoff: FOUNDATION_CLEARANCE_AUDITOR
close_readiness: READY_TO_HAND_OFF_NO_CLEARANCE_CLAIM
```

Independent clearance remains pending. This lane is ready for an evidence-only
review against the exact source-bound handoff and the focused checks above.
