# Bootstrap Rapid Prototype Plan

Status: `COMPATIBILITY_RECORD_FOR_AUDIT_DRIVEN_INTEGRATION_PYRAMID`

This is the preserved public record for the earlier rapid-prototype slice. It
is not an active orchestration authority. The active, project-agnostic
workflow is the Audit-Driven Integration Pyramid in
`control/audit-driven-integration-pyramid.mjs`; the machine contracts in
`schemas/` and the controllers in `control/` remain authoritative.

The earlier foundation and implementation receipts remain useful evidence
during migration, but they do not gate feature admission, integration, or
archival. The migration record is
`docs/rapid-prototype-migration.v1.json`.

## Outcome

Carry one clear owner request through a real, thin governance slice:

1. initialize a new project from the owner-selected stack, repositories, and
   relative directory plan, or bind an imported source and obtain explicit
   rapid-development approval;
2. audit and repair feature lanes in bounded waves;
3. distill compatible feature candidates into platform-domain candidates;
4. integrate platform candidates into one fresh central worktree;
5. independently audit, repair, re-audit, and perform the final
   security/privacy review; and
6. preserve handoffs before downstream consumption and archive temporary tasks
   only after their worktrees are consumed and closed.

Success means the public draft, source readbacks, implementation result,
independent check, roster closure, and Iteration handoff all describe the same
source and scope. No external action is part of this run.

## Decisions recorded from the owner request

| Decision | Selected boundary |
| --- | --- |
| Run mode | Rapid Prototyping: one thin real working slice |
| Discovery | Recommended, read-only, secret-free |
| Project treatment | Adopt the current source in place; preserve source before any import work; keep preservation outside the public source |
| First outcome | Bootstrap → Intent Regulator/Runtime → twelve cleared foundations → twelve implemented behavior lanes → assembled thin slice → independent acceptance → closed roster → Iteration handoff |
| Project life | Private prototype, owner-only use, synthetic or no data, campaign-bounded lifetime |
| Delivery | Local workspace only; finish at review; no push, merge, publication, deployment, release, or spending |
| Runtime | Persistent for this project and bound by host readback; its identity stays in the control plane, not this public draft |
| Persistent coordinator | Public role name `Intent Regulator`; machine identity remains `AGENTOS_CONTROLLER` for source compatibility |
| Roster | Start empty; admit only the twelve named foundation lanes, twelve named implementation lanes, and later named conditional roles below; do not inherit, count, or repair old records |
| Rapid worker profile | Every temporary sibling uses the host’s `Luna/max` profile, a direct project-local session in the exact saved project, one admitted lane or named campaign role, a pre-write project/cwd readback, and no children or shell stand-ins |
| Release boundary | Keep the prepared release candidate inactive |

The exact typed plan compiled from these decisions has zero material gaps.
Its discovery digest is `1d6eb07e42f592f075efc58a531e79f144a94115b87b8f416ff628c693ee1006`.
The Bootstrap plan digest captured before this rapid overlay was
`622e88423d3ecfe5ac4248af42250e8ee2f91c12e16717e0a592e901353d45b8`.
The twelve-lane machine record is retained as the compatibility manifest
`schemas/rapid-prototype-plan.v1.json`; it does not own the active phase
order.
The twelve foundations were independently accepted by the fresh v2 clearance
receipt `docs/rapid-foundations/evidence/foundation-receipts.v2.json` and its
report `docs/rapid-foundations/foundation-clearance.md`; no implementation or
acceptance was performed by that review.
The automatic temporary-worker lifecycle was a required implementation output.
The native session plan declares the preserve → unpin → archive → active-roster
removal → zero-active verification contract, and Implementation lane 12 now
supplies the executable host-adapter path and focused test. The parent rerun
passed that focused test and the capability remains pending independent slice
acceptance.
The twelve behavior lanes are now parent-checked: all twelve declared module
and focused-test pairs passed independently, their exact two-file boundaries
were read back, all twelve typed handoffs were preserved, and the temporary
implementation roster is empty. Lane 12 now has an executable lifecycle module
and focused test; its status is `IMPLEMENTED_AND_INDEPENDENTLY_ACCEPTED`.
The fresh Rapid Slice Builder and separate Independent Auditor both completed;
the parent reran the assembled test, the auditor independently reran all twelve
lane tests plus the assembled test, and the audit decision is
`RAPID_SLICE_ACCEPTED`. The public audit report is
`docs/rapid-foundations/evidence/implementation-audit.md` with evidence digest
`361f7ab87d14741139d2782ea2dfc822eba43f851246d3def0ad65479fd062d6`.
The builder made no acceptance claim. All temporary implementation, builder,
and auditor handoffs are preserved, all sessions are unpinned and archived,
and the active temporary roster is zero.
After that closeout, a live host task-list readback still exposed a completed
temporary task even though the project roster reported zero active workers.
The controller re-applied unpin and archive to every completed temporary record
in the saved Rapid closeout history, read each one back as not loaded, and
confirmed that the current project list contains no completed temporary task.
This closeout mismatch is recorded in
`docs/rapid-foundations/evidence/lifecycle-reconciliation.v1.json`; the
persistent Intent Regulator and Runtime were deliberately preserved.
The recorded JSA safety scope is the launch gate for this bounded rapid run.
No separate approval prompt is required inside that scope. Any changed scope,
intent, source condition, or capability closes the run and requires a fresh
plan.

## Discovery record

- The source is a public portable governance repository with an existing
  Bootstrap, Controller, Runtime, campaign lifecycle, acceptance, evidence,
  and handoff framework.
- The checkout contains uncommitted development edits in the Bootstrap and
  session-runtime area. They are preserved as existing owner work and are not
  silently reset.
- Discovery made no authentication, network, spending, publication,
  deployment, deletion, or secret-reading attempt.
- Old ignored `tmp/` handoffs were observed in the checkout. They are excluded
  from this run’s roster and authority; they are not deleted.
- `node tests/verify-native-session-team.mjs`,
  `node tests/verify-bootstrap-start.mjs`, and
  `node tests/verify-readme.mjs` each returned `PASS`.
- The bounded check `node tests/verify-all.mjs` returned
  `TIMEOUT_NO_RESULT`: three long-running verifier processes produced no
  completion line within the bounded wait and were stopped. This is recorded
  evidence, not a Bootstrap prerequisite. The full-suite hang is deferred to
  Iteration.

## Hard-stop decision record

The first foundation-session creation attempt was stopped before acceptance:
`WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`. The host created isolated
worktrees whose Git common directory did not match the saved project bound by
this Bootstrap run. All twelve sessions were interrupted, archived, and their
temporary worktrees were confirmed removed. Their exact private session IDs and
paths are preserved in the ignored control-plane record
`tmp/rapid-prototype/source-binding-mismatch-2026-08-04.json`; they are not
public authority and are not counted in the clean roster. No lane file from
that attempt exists in this saved project, no lane was cleared, and no result
was accepted.

The failed attempt is closed as a successful boundary stop. The overall Rapid
Prototype continues under a fresh source-bound successor goal. The repaired
worker method must use direct local sessions in the exact saved project, and a
session must verify project identity and cwd before writing its lane file.

The first direct-session request probe was rejected by host argument validation
before creation. The exact returned error was `create_thread received invalid
arguments.` That response contained neither a real `threadId` nor a
`clientThreadId`, so it created no worker and no roster entry. The request shape
was corrected to the supported direct project-local target, and one lane is
being read back for a real session identity and exact cwd before the remaining
lanes are admitted.

### Repair finding and repaired method

The saved project folder is itself a Git worktree. The host worktree creation
path therefore resolved new siblings through a shared Git parent and lost the
saved-project identity required by this run. That spawn path is rejected and
will not be retried. The in-scope repair is direct project-local sessions
created against the exact saved-project binding. Each session must verify its
host project identity and cwd before writing its one lane file; any mismatch
stops that lane before mutation. The exact host project identifier remains in
the private control-plane method record, not in public authority.

A separate host-sidebar/project-label mismatch was observed while the local
batch was running. It did not change the host project identity, cwd, or any
lane file write, so it is recorded as a non-blocking host UI finding and does
not stop correctly bound workers. It remains outside the portable governance
payload.

## Phase plan

| Phase | What happens | Owner or lane | Required output | Check and evidence | Handoff and later work |
| --- | --- | --- | --- | --- | --- |
| 0. Discover | Observe repository shape, source identity, available local tools, existing governance, and safe boundaries. | Bootstrap | Read-only discovery, coverage/question result, discovery digest. | Re-run-safe discovery; no source mutation; all facts secret-free; no material question left unresolved by the owner request. | Discovery digest feeds the recorded launch plan. Full-suite timeout remains a bounded later check. |
| 1. Record the launch gate | Compile the typed project context, life contract, import choice, standards, normalization, delivery policy, boundary contract, Runtime binding, campaign design, exact creation plan, and this rapid overlay. | Bootstrap + the recorded owner intent | Complete plan, rapid machine record, plan/overlay digests, decision record, expected writes, prohibited actions. | Zero material gaps. The recorded JSA scope is the launch gate; no second approval pause is taken inside this scope. A changed scope, intent, policy, or condition closes the run and requires a fresh goal. | Launch record goes to Intent Regulator. No temporary worker exists before this handoff. |
| 2. Bind control and clean roster | Read back the real host session and Git source. Bind the persistent Intent Regulator and Runtime. Create a clean campaign record with no inherited session entries. | Intent Regulator + persistent Runtime | Source-bound runtime readback, coordinator binding, policy state, campaign admission, empty-roster receipt. | Session, exact saved-project identity, cwd, capabilities, commit, and tree must come from host/Git readback. Missing host capability, stale source, wrong project, wrong cwd, duplicate identity, or inherited record is a hard stop. | Only the twelve foundation lane slots are admitted next. |
| 3. Assemble the twelve foundations | Create exactly one fresh Luna/max direct local sibling for each named lane below. Before writing, each worker must verify the exact saved-project identity and cwd. Each worker then writes one lane file in the saved project and returns typed progress, result, hostile coverage, independent-check status, and handoff. | Twelve independent foundation siblings: Intent and scope; Bootstrap and context; User conversation; Role routing; Progress and health; Functionality; UI/UX; Code hygiene; Security and privacy; Evidence and identity; Recovery and boundaries; Delivery and closure | Twelve lane files, twelve typed handoffs, twelve real identities and project/cwd/source readbacks, twelve hostile-coverage records, and twelve closure-ready receipts. | Each lane is checked against its own boundary and hostile cases. A project/cwd mismatch must stop before writing. Multiple lane files, generic/recursive role, shell stand-in, secret, or unverified progress is a hard stop for that lane. | Foundation handoffs remain preserved. No tailored campaign role is created until all twelve are independently assembled. |
| 4. Clear the foundations independently | Review the twelve exact lane files, persisted receipts, and handoffs as a separate clearance step, checking cross-lane consistency, portability, evidence, and hostile coverage. | Foundation Clearance Auditor sibling, admitted only after Phase 3 | Independent clearance report, twelve lane decisions, v2 evidence digest, parent receipt, bounded finding list, and clearance handoff. | The accepted v2 report is `12/12 PASS`. A later puzzle or changed condition still reopens the gate. | The accepted set permits the separately recorded implementation phase. |
| 5. Implement the twelve behavior lanes | Create exactly one fresh named Luna/max direct local sibling for each corresponding lane. Each writes one real implementation module and one focused test in its declared scope, exercises meaningful behavior, and returns a typed handoff. Documentation-only output does not satisfy this phase. | Twelve independent implementation siblings listed below | Twelve implementation modules, twelve focused tests, twelve exact source/cwd readbacks, twelve changed-path proofs, twelve test results, hostile coverage, typed handoffs, and closure-ready receipts. | Before every write, verify project identity, cwd, Git top-level, commit, and tree. A worker may touch only its two declared paths; shared imports, the assembler, and unrelated source are forbidden. A fake stub, skipped test, private leak, wrong source, generic/recursive/shell role, or missing result is a hard stop for that lane. Parent recheck now records `12/12 PASS` and exact 24-path scope. | Preserve each handoff, automatically unpin/archive/remove the completed worker from the active roster, verify zero active workers, and pass the exact lane receipts to the assembler. |
| 6. Derive and assemble the thin slice | Derive only the admitted Rapid Slice Builder after all twelve implementation lanes return meaningful behavior and focused tests. The builder composes their public functions into one runnable local governance flow and adds only the shared index and end-to-end focused test. | Intent Regulator + fresh Rapid Slice Builder sibling | Tailored role map, `control/rapid-prototype/index.mjs`, `tests/verify-rapid-prototype.mjs`, changed-path manifest, focused run, and build handoff. | Every imported lane is present and tested; the builder has exact source/cwd/goal readback, no external effects, and no self-acceptance. The slice must exercise intent, context, conversation, routing, progress, decision flow, public surface, hygiene, privacy, evidence, recovery, and closure. | The exact local checkpoint goes to the Independent Auditor. |
| 7. Audit and settle | Inspect the exact checkpoint without accepting one’s own work. Route one bounded puzzle repair if needed, then require a fresh audit. | Independent Auditor sibling; Intent Regulator reconciles | Read-only audit report, acceptance decision, evidence digest, reconciliation receipt, and bounded finding list. | PASS requires the first useful workflow, source identity, public cleanliness, no external effects, all focused tests, UI unavailable-state evidence, and lifecycle evidence. A failed check never becomes a pass through narration. | Accepted result moves to automatic closure; unresolved work becomes a typed Iteration item. |
| 8. Close the rapid roster | After the lifecycle implementation is independently accepted, preserve every implementation, builder, and auditor handoff; unpin, archive, and remove each completed temporary worker from the active roster; verify zero active temporary roles. | Intent Regulator + executable lane-12 lifecycle adapter + host session tools | Completion handoff, closure receipt, unpinned/archived readbacks, active-roster removal receipt, zero-active-roster evidence, and preserved evidence index. | The lifecycle sequence is preserve handoff → unpin → archive/close → remove from active roster → verify. The executable adapter and focused test passed both parent and independent audit; the closure receipt records zero active temporary workers. | Persistent Runtime and Intent Regulator remain. Temporary sessions do not carry forward. |
| 9. Enter Iteration Mode | Convert deferred findings, the full-suite timeout, lifecycle repairs, and explicitly later work into typed backlog records bound to the accepted source and reason. | Intent Regulator | Iteration backlog, transition record, next-campaign candidate, preserved evidence index. | Each item has an ID, kind, source digest, scope, owner lane, acceptance roots, dependency, reopen trigger, status, and handoff digest. | Normal Iteration mints a fresh campaign only from a new exact admission. |
| 10. Normal Iteration | Continue from the typed backlog with fresh campaigns and fresh source-bound sessions when a later campaign is admitted. | Persistent Intent Regulator; fresh campaign lanes | New campaign plan and handoffs, not a continuation of the rapid roster. | Re-run the same boundary, identity, evidence, and independent-acceptance checks. | Provider work, remote delivery, publication, deployment, activation, broad audits, and production claims remain outside this run. |

## Accepted transition and typed Iteration backlog

The independent audit accepted the thin slice on the exact source recorded above.
The transition is `RAPID_PROTOTYPING → NORMAL_ITERATION`, recorded in
`docs/rapid-foundations/evidence/iteration-transition.v1.json`. Its typed items
carry their own scope, owner lane, acceptance root, dependency, reopen trigger,
and status. The full verifier timeout remains evidence and is not retried as a
Bootstrap gate. Normal Iteration starts with a fresh campaign admission; no
temporary rapid session carries forward.

The first fresh campaign is `ITER-001-BOUNDED-VERIFIER`, selected as the
smallest deferred item. Its launch gate is recorded in
`docs/rapid-foundations/evidence/iteration-campaign-001.v1.json`. It admits a
fresh named `Iteration Bounded Verifier` sibling for one bounded 15-second
check, one portable evidence report, and one typed handoff. The recorded gate
does not wait indefinitely and does not make the full verifier a prerequisite.
The campaign result is now recorded as `TIMEOUT_NO_RESULT` at the 15-second
bound, with no residual verifier process and a passing focused report check.
Its evidence is `docs/rapid-foundations/evidence/iteration-001-bounded-verifier.md`;
the timeout is retained as bounded evidence, not treated as an acceptance
failure or as a reason to reopen Bootstrap.

### Foundation lane register

Each row is a separate temporary sibling. The lane file is the only file that
lane may write for this rapid foundation phase.

| # | Public lane | Lane file | Minimum handoff |
| --- | --- | --- | --- |
| 1 | Intent and scope | `docs/rapid-foundations/01-intent-and-scope.md` | Intent boundary, in/out scope, owner decision law, hostile cases, typed handoff |
| 2 | Bootstrap and context | `docs/rapid-foundations/02-bootstrap-and-context.md` | Discovery and plan binding, safe defaults, question floor, hostile cases, typed handoff |
| 3 | User conversation | `docs/rapid-foundations/03-user-conversation.md` | Plain-language exchange rules, one-question boundary, escalation, hostile cases, typed handoff |
| 4 | Role routing | `docs/rapid-foundations/04-role-routing.md` | Admitted role map, sibling topology, identity checks, hostile cases, typed handoff |
| 5 | Progress and health | `docs/rapid-foundations/05-progress-and-health.md` | Progress/liveness evidence, bounded waits, timeout law, hostile cases, typed handoff |
| 6 | Functionality | `docs/rapid-foundations/06-functionality.md` | Thin workflow behavior, acceptance roots, puzzle routing, hostile cases, typed handoff |
| 7 | UI/UX | `docs/rapid-foundations/07-ui-ux.md` | Usable public-facing surface boundary, unavailable states, hostile cases, typed handoff |
| 8 | Code hygiene | `docs/rapid-foundations/08-code-hygiene.md` | Safe change boundary, focused checks, portability, hostile cases, typed handoff |
| 9 | Security and privacy | `docs/rapid-foundations/09-security-and-privacy.md` | Secret-free/public boundary, protected data, hard stops, hostile cases, typed handoff |
| 10 | Evidence and identity | `docs/rapid-foundations/10-evidence-and-identity.md` | Source/session/readback receipts, evidence roots, hostile cases, typed handoff |
| 11 | Recovery and boundaries | `docs/rapid-foundations/11-recovery-and-boundaries.md` | Puzzle/review/stop routing, recovery, changed-condition law, hostile cases, typed handoff |
| 12 | Delivery and closure | `docs/rapid-foundations/12-delivery-and-closure.md` | Local review finish, archive/removal, Iteration handoff, hostile cases, typed handoff |

### Implementation lane register

Implementation begins only after the accepted v2 foundation clearance. Each row
is a fresh temporary sibling. It may write only the listed module and focused
test; it must return behavior evidence, hostile coverage, source readback,
changed-path proof, and a typed handoff before automatic lifecycle closure.

| # | Implementation lane | Module | Focused test | Required behavior |
| --- | --- | --- | --- | --- |
| 1 | Intent and scope behavior | `control/rapid-prototype/intent-scope.mjs` | `tests/rapid-prototype/intent-scope.mjs` | Compile a deterministic intent envelope and classify proceed, puzzle, soft review, hard stop, and deferred iteration. |
| 2 | Bootstrap and context behavior | `control/rapid-prototype/bootstrap-context.mjs` | `tests/rapid-prototype/bootstrap-context.mjs` | Compile a bounded context and fail closed on missing or mismatched source identity. |
| 3 | User conversation behavior | `control/rapid-prototype/user-conversation.mjs` | `tests/rapid-prototype/user-conversation.mjs` | Produce plain-language turns with at most one material owner question and honest unavailable states. |
| 4 | Role routing behavior | `control/rapid-prototype/role-routing.mjs` | `tests/rapid-prototype/role-routing.mjs` | Admit only named roles with independent-sibling topology and reject generic, recursive, shell, and unverified substitutes. |
| 5 | Progress and health behavior | `control/rapid-prototype/progress-health.mjs` | `tests/rapid-prototype/progress-health.mjs` | Record meaningful progress separately from liveness and classify bounded timeout without false success. |
| 6 | Functionality behavior | `control/rapid-prototype/functionality.mjs` | `tests/rapid-prototype/functionality.mjs` | Run the thin governance decision path and return a checkable outcome with acceptance roots. |
| 7 | UI/UX behavior | `control/rapid-prototype/ui-ux.mjs` | `tests/rapid-prototype/ui-ux.mjs` | Render the owner-facing plain-language surface, including unavailable and hard-stop states. |
| 8 | Code hygiene behavior | `control/rapid-prototype/code-hygiene.mjs` | `tests/rapid-prototype/code-hygiene.mjs` | Validate relative changed paths, exact lane scope, deterministic checks, and no generated/private leakage. |
| 9 | Security and privacy behavior | `control/rapid-prototype/security-privacy.mjs` | `tests/rapid-prototype/security-privacy.mjs` | Scan public payloads and reject credentials, private paths, external identities, URLs, and session records. |
| 10 | Evidence and identity behavior | `control/rapid-prototype/evidence-identity.mjs` | `tests/rapid-prototype/evidence-identity.mjs` | Compile and verify digest-bound source, task, result, check, and handoff evidence. |
| 11 | Recovery and boundaries behavior | `control/rapid-prototype/recovery-boundaries.mjs` | `tests/rapid-prototype/recovery-boundaries.mjs` | Route puzzle, soft review, unavailable, hard stop, and changed-condition fresh-goal outcomes. |
| 12 | Delivery and closure behavior | `control/rapid-prototype/delivery-closure.mjs` | `tests/rapid-prototype/delivery-closure.mjs` | Execute the host-adapter sequence preserve handoff → `set_thread_pinned(false)` → `set_thread_archived(true)` → remove from active roster → verify zero active workers, with a focused test for each failure boundary. |

The implementation workers must not edit `control/rapid-prototype/index.mjs`,
`tests/verify-rapid-prototype.mjs`, schemas, the public plan, or another lane's
module/test. The Rapid Slice Builder owns only the shared index and end-to-end
test after all twelve lane handoffs pass. The Independent Auditor writes only
its audit evidence file.

## Decision rules

Routine work keeps moving when it is a puzzle: a bounded test failure,
compilation error, deterministic mismatch, or small reversible implementation
problem that stays within the approved scope. The Controller routes one exact
repair and asks no routine question.

A soft review is needed when the work would change a non-protected choice such
as scope, architecture, route, or operating preference while remaining inside
the owner’s boundaries. Only the affected work pauses; the Orchestrator records
the choice, impact, and new digest before continuing.

A hard stop is required for a changed owner intent, stale or missing source
readback, false or unavailable identity, secret or credential exposure,
private-context leakage, external authentication or spending, push/merge/
publication/deployment/release, destructive action, critical security finding,
unapproved role creation, recursive child, shell substitute, or an inability
to close a temporary session. The Controller preserves evidence and does not
pretend that the work completed.

## Evidence and handoff minimum

Every phase handoff must name the phase, role or lane, exact source commit and
tree, task and scope, progress, result, independent check status, evidence
digests, open risks, next action, and whether the item is a puzzle, soft review,
hard stop, accepted result, or deferred Iteration work. Public records contain
only project-agnostic summaries and digests; session identities, environment
details, and private control-plane records stay outside the public source.

## Deferred work

- Make the full verifier bounded and diagnose why it does not return a result.
- Complete the broader hostile, portability, lifecycle, and acceptance suite
  after the thin slice is accepted.
- Add the full campaign cascade, Finalizer, four-lane audit depth, and live
  acceptance path where the prototype does not yet need them.
- Add provider, remote delivery, publication, deployment, rollback execution,
  production support, and activation only through a later owner-approved plan.
- Keep `2.1rc` prepared but inactive and do not rebind a product campaign.

## Launch boundary

The recorded plan remains the launch gate for this in-scope method repair.
There is no separate owner approval pause for work that remains inside the
valid plan. A changed scope, intent, policy, or condition requires safe
closure and a fresh source-bound goal before any new worker is created.

## Architecture alignment repair

The bounded `ITER-001-BOUNDED-VERIFIER` goal is safely closed with its
`TIMEOUT_NO_RESULT` evidence preserved in
`docs/rapid-foundations/evidence/iteration-001-closeout.v1.json`. The accepted
lane prototype remains preserved. Its missing shared architecture is recorded as
an alignment and planning failure, not as permission to start unrelated feature
work.

The source-bound successor is `SOURCE_BOUND_ARCHITECTURE_REPAIR`, governed by
`schemas/architecture-repair-plan.v1.json` and recorded in
`docs/rapid-foundations/evidence/architecture-repair-plan.v1.json`. The repair
has five ordered phases: close the narrow verifier goal; repair the Bootstrap
and Controller acceptance path; build the portable shared general governance
library; generate the role-specific library from that shared library and the
compiled question tree; and independently check and preserve the result.

The repair launch gate requires both governance layers. The shared library must
be portable, deterministic, and source-bound. The role-specific library must be
generated from the shared library and the three-root compiled question tree.
The Controller repair admission must reject a missing shared library, a
role-specific library without tree binding, mismatched source digests, and any
architecture envelope that omits a required acceptance condition. The old
generic compatibility role is not an admitted repair role.

The recorded repair plan is the launch gate; no separate owner approval pause
is taken inside this scope. A changed scope, intent, policy, or condition closes
the current goal and requires a fresh source-bound successor.

The repair is now recorded as `REPAIR_ACCEPTED` in
`docs/rapid-foundations/evidence/architecture-repair.v1.json`. The broader
portability scan still has the two deliberate hostile-fixture scope findings
listed there; they remain typed Iteration work and do not weaken the accepted
architecture repair.

## Autonomous Iteration continuation

The persistent Intent Regulator remains alive after the architecture repair. It
read the typed backlog and selected `ITER-002`, the smallest safe deferred item:
extended hostile and portability coverage. The continuation repair and launch
gate are recorded in
`docs/rapid-foundations/evidence/continuation-repair.v1.json` and
`docs/rapid-foundations/evidence/iteration-campaign-002.v1.json`.

The fresh admitted role is `Iteration Portability Boundary Verifier`. It may
write only its one evidence report, has a 15-minute meaningful-progress bound,
must return exact source and scope readbacks plus a typed handoff, and closes
through preserve → unpin → archive → roster removal → zero-active verification.
It may classify the existing fixture-scope puzzle, but it may not edit fixtures,
change acceptance, or start unrelated work.

The campaign completed as `DEFERRED_ITERATION`: the three focused checks passed,
the bounded portability result reproduced the two known fixture-scope findings,
and the temporary task was unpinned, archived, removed from the active roster,
and read back as closed. Its handoff remains preserved in the campaign record;
the Intent Regulator remains available for the next typed item.

The continuation gate was repaired after `ITER-002`: broader internal AgentOS
work is not an owner boundary by itself. `ITER-003`, campaign cascade and
Finalizer governance integration, is already a typed internal backlog item and
is admitted by the recorded launch gate in
`docs/rapid-foundations/evidence/iteration-campaign-003.v1.json`.

The fresh role is `Iteration Cascade and Finalizer Gate Builder`. It has an exact
two-file scope, a 15-minute meaningful-progress bound, hostile coverage, and an
independent parent check. It may build the source-bound continuation admission
behavior, but it may not perform external actions, change authority, act on
behalf of the owner, touch product-specific context, complete or push a
Finalizer, or claim its own acceptance.

The Intent Regulator continues automatically while the source, scope, policy,
and conditions remain bound. Only a real external or authority boundary,
destructive action, new product scope, unresolved owner intent, or a verified
host capability failure stops the continuation.

`ITER-003` completed with an independent parent PASS. The focused gate test,
syntax checks, exact two-file scope, source binding, and public-safety scan all
passed; the named worker returned no acceptance claim, and its handoff was
preserved before unpin, archive, roster removal, and zero-active verification.

The next typed item is `ITER-004`, which covers provider, remote delivery,
publication, deployment, rollback, production, or activation work. That is a
real external boundary outside this internal continuation scope, so the
Intent Regulator stops there and requires a specific owner decision plus a
fresh source-bound plan before any such action.
