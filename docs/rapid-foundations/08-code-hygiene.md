# Code hygiene

Status: `ASSEMBLED_PENDING_INDEPENDENT_CLEARANCE`

This foundation defines the portable governance boundary for code hygiene in a
thin, source-bound prototype. It keeps changes understandable, narrow,
reversible, deterministic, and safe to hand off. It is a public rule set, not
a project-specific style guide and not a claim that any particular repository
or tool already satisfies it.

## Boundary

Code hygiene is an audit discipline over the source surfaces changed by an
admitted task and the smallest adjacent evidence needed to verify those
changes. It covers structure, naming, dependency direction, duplication,
dead or unreachable material, generated-file boundaries, documentation
clarity, deterministic checks, and changed-path discipline.

It does not decide owner intent, product functionality, visual design,
security authorization, delivery, deployment, or release. It may identify a
finding in one of those areas, but routes that finding to the responsible
boundary instead of silently expanding this lane. Code hygiene is not a
fourth product-acceptance root.

The portable rules are stable. Repository conventions, language tools,
generated-file rules, dependency policies, and maintenance thresholds enter
only through typed project configuration or an authority-corpus extension.
When those inputs are absent, the safe behavior is to record the limitation,
not invent a convention.

## Intended behavior

1. **Bind the source before writing.** Obtain a host readback of the exact
   project identity, working directory, source commit, and source tree. A
   missing, stale, or conflicting readback is a hard stop with the status
   `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`; no lane content is
   written from an unverified source.

2. **Set a smallest useful change boundary.** Read the requested scope, name
   the allowed paths or source surfaces, and make the smallest coherent
   reversible change. Cleanup is not permission to refactor unrelated code,
   rename public contracts, alter behavior, or add a feature.

3. **Preserve a legible source.** Prefer clear names, direct control flow,
   explicit module boundaries, one source of truth, and comments that explain
   a non-obvious reason. Remove only demonstrably unreachable or redundant
   material that is inside the admitted scope and whose behavior is covered
   by focused evidence.

4. **Keep derived material subordinate to its source.** Do not hand-edit a
   generated or mirrored artifact when its governing source and deterministic
   regeneration path are known. If the derived artifact is explicitly in
   scope, record the source, regeneration action, and resulting evidence. If
   that relationship is unknown, stop at the boundary.

5. **Use focused, repeatable checks.** Select checks from the changed surface
   and the typed project configuration. Prefer local, deterministic checks
   over broad unrelated suites. Record each check's status and evidence
   digest. A failed or unavailable check remains failed or unavailable; prose
   cannot turn it into a pass.

6. **Protect portability and public separation.** Public material contains no
   secrets, credentials, private paths, project or task identities, session
   records, provider details, or domain policy. Project facts belong in typed
   context and private evidence, with only the necessary public summary or
   digest crossing this boundary.

7. **Preserve independent review.** The author may prepare the change and
   its evidence, but does not self-clear it. The handoff names the exact
   source readback, changed paths, checks, hostile cases, open risks, and next
   reviewer so a separate clearance step can reproduce the conclusion.

## Unavailable behavior

| Condition | Required response |
| --- | --- |
| Project identity, working directory, source commit, or source tree cannot be read back exactly | Fail closed before writing; preserve the mismatch evidence and return `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`. |
| Writable scope, ownership, generated-file authority, or a changed condition is unclear | Pause only the affected outcome and request a typed boundary decision or fresh source-bound goal. Do not guess. |
| A focused check is unavailable, nondeterministic, or depends on an unavailable capability | Return `CHECK_UNAVAILABLE` with the exact reason and evidence; do not claim hygiene clearance. |
| A bounded check fails within the approved scope | Route one exact repair as a puzzle when safe; otherwise return `OPEN_REPAIR` or `HARD_STOP` with the failing evidence. |
| The requested path requires authentication, spending, publication, push, merge, deployment, deletion, or another external side effect | Return `HARD_STOP`; code hygiene has no authority to perform or simulate that action. |
| The task would need a generic, recursive, or shell substitute for an admitted actor | Reject the substitute and preserve the lane as unverified; no substitute may create evidence or write the lane result. |

## Hostile cases

These cases are minimum adversarial coverage for the lane. Each response is a
boundary result, not a recoverable success narrated as progress.

1. **CH-01 — Wrong source or directory.** A worker receives a plausible task but its
   host readback points to another project, checkout, commit, or working
   directory. It must stop before mutation, return
   `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`, and leave no lane
   result to clear.

2. **CH-02 — Scope escape.** A cleanup path contains a traversal, symlink, generated
   output, or unrelated directory outside the admitted writable surface. The
   worker must refuse the escape, retain the exact path evidence, and route a
   boundary review if the surface is genuinely needed.

3. **CH-03 — Private-context leakage.** A diagnostic, comment, test fixture, or
   handoff includes a credential, token-like value, private path, project or
   task identity, session record, or provider detail. The public result is not
   clear; the material is removed or quarantined, the exposure is reported to
   the security/privacy boundary, and no digest is presented as proof of
   cleanliness until rechecked.

4. **CH-04 — Refactor disguised as cleanup.** A request to “make it cleaner” changes
   behavior, public contracts, architecture, or unrelated files. The lane
   keeps the narrow hygiene change separate and routes the larger choice as a
   soft review or a new typed scope; it does not smuggle the refactor into a
   maintenance patch.

5. **CH-05 — False check success.** A check is flaky, timed out, skipped, run against
   a different source tree, or failed while the report says `PASS`. The result
   is invalidated and returned as failed or unavailable with the observed
   output and source binding; narration cannot repair evidence.

6. **CH-06 — Unowned derived file.** A generated, vendored, mirrored, or lockfile
   artifact is edited directly with no verified governing source. The edit is
   rejected or held for its owner; the lane must not create a plausible but
   non-reproducible artifact.

7. **CH-07 — Identity substitution.** A legacy compatibility export, generic worker,
   recursive child, or shell stand-in is offered as the lane's actor. It is
   not an admitted identity, so its writes and checks are not accepted as
   lane evidence. The host must provide the real admitted identity or the lane
   remains unavailable.

8. **CH-08 — Stale evidence.** The source changes after the pre-write readback or
   while checks are running. The worker must invalidate the affected evidence,
   rebind to the new exact source if the scope still holds, or stop and hand
   off the changed condition. It must not combine observations from different
   source trees.

## Focused check ideas

The clearance auditor should select the smallest applicable set and retain the
result for each check.

| Check | Evidence to retain | If it cannot pass |
| --- | --- | --- |
| Source and writable-surface readback | Exact commit/tree observation and changed-path allowlist | Stop before writing or invalidate the affected result. |
| Structure and syntax | Parser, formatter, linter, or equivalent output for changed files | Record `CHECK_UNAVAILABLE` or route one bounded repair. |
| Focused behavior regression | The narrow test or fixture covering the changed contract | Keep the finding open; do not substitute an unrelated green suite. |
| Generated-file and dependency-boundary check | Governing source, regeneration evidence, and dependency-diff summary | Hold the derived change for its owner. |
| Public portability scan | Secret/private-context scan and a check for project-specific facts | Remove or quarantine the offending material, then recheck. |
| Deterministic repeat | Same input and source binding produce the same relevant output twice | Classify as unavailable or open repair until the variance is explained. |
| Independent read-only review | Separate reviewer result bound to the same source/tree and evidence digests | Keep `independent_check` pending; no self-clearance. |

Checks should report `PASS`, `FAIL`, `CHECK_UNAVAILABLE`, or `NOT_APPLICABLE`
with a reason. `NOT_APPLICABLE` must be justified by the changed surface, not
used as a shortcut around an unresolved risk.

## Typed handoff

The lane handoff is a structured record. Exact environment and session
identities belong in the private control plane; the public lane carries only
portable rules and non-sensitive summaries or digests.

| Field | Required value or meaning |
| --- | --- |
| `phase` | `ASSEMBLE_FOUNDATION_LANES` |
| `lane_role` | `FOUNDATION_CODE_HYGIENE` |
| `public_lane` | `Code hygiene` |
| `task` | Define the safe, portable code-hygiene boundary for the thin prototype lane. |
| `scope` | Changed-source hygiene, focused evidence, portability, and the hostile cases in this document; no product or delivery expansion. |
| `source_readback` | Host project identity and source binding; raw paths remain in control-plane memory while the receipt stores only path digests, source commit, and source tree. |
| `progress` | Meaningful work completed, remaining work, and the paths inspected or changed. |
| `result` | `ASSEMBLED_PENDING_INDEPENDENT_CLEARANCE`, `CHECK_UNAVAILABLE`, `OPEN_REPAIR`, or `HARD_STOP`; choose the observed state, never the desired state. |
| `hostile_coverage` | At least `CH-01` through `CH-03`, with additional applicable cases from the list above and their dispositions. |
| `focused_checks` | One typed entry per selected check with status, reason, source binding, and evidence digest. |
| `independent_check` | `PENDING` until a separate clearance actor reviews this lane; this lane does not claim clearance. |
| `evidence` | Digests for source readback, changed-path proof, check outputs, and any finding or repair receipt. |
| `open_risks` | Unavailable checks, deferred scope, stale conditions, or findings routed to another boundary. |
| `next_handoff` | `FOUNDATION_CLEARANCE_AUDITOR` for independent, evidence-only clearance. |
| `close_readiness` | Ready to preserve the typed handoff and close the temporary lane after the independent check; no active child or substitute remains. |

This foundation is ready for independent clearance. It is intentionally not a
clearance decision: the next actor must re-read the exact source binding,
reproduce the focused checks, inspect hostile coverage, and record its own
decision.
