# Functionality Foundation

Status: `READY_FOR_INDEPENDENT_CLEARANCE`

This public foundation defines how a thin, source-bound governance prototype
proves that its first useful workflow behaves as intended. It is
project-agnostic: project identity, product context, provider details,
credentials, deployment targets, and private execution records are supplied by
typed context or kept in the control plane. They are not authority in this
document.

## Boundary

This lane owns the smallest observable functional path from an admitted,
typed goal to a reproducible result and a typed handoff. It covers:

- the workflow's inputs, preconditions, state transitions, postconditions, and
  observable outputs;
- completeness and evidence for the `FUNCTION_REQUIREMENTS` acceptance root;
- bounded routing of deterministic implementation puzzles;
- explicit unavailable and hard-stop behavior; and
- the evidence needed for an independent checker to decide whether this lane
  is ready for clearance.

This lane does not own:

- owner intent, scope changes, product policy, or exception approval;
- visual or interaction quality in the `DESIGN_BIBLE` root;
- security decisions or the `SECURITY` root;
- code-quality, portability, or repository-maintenance policy;
- source identity, Runtime identity, session topology, or custody authority;
- provider, remote, authentication, spending, publication, deployment, or
  rollback actions; or
- final acceptance, roster closure, or Iteration admission.

The admitted role is the single foundation lane `FOUNDATION_FUNCTIONALITY`,
with public lane name `Functionality`. A legacy or compatibility export is not
an admitted role. This lane does not create children, generic workers, or shell
stand-ins, and an unverified identity cannot supply functional evidence. The
lane writes only its one foundation document; workflow evidence belongs in the
typed handoff and its permitted evidence store.

## Intended behavior

The functional path follows one bounded contract:

1. **Receive a typed goal.** The goal names the intended user outcome, exact
   scope, protected boundaries, assumptions, inputs, expected result, and
   `DONE WHEN` condition. The lane does not invent a missing owner decision.
2. **Check preconditions.** Required inputs, source readback, capabilities,
   and acceptance questions are checked before a consequential step. A stale
   source or changed condition invalidates dependent evidence.
3. **Execute the smallest useful path.** The workflow uses synthetic or
   explicitly admitted local data and takes only the steps needed to exercise
   the first useful outcome. It does not broaden into a general feature,
   remote integration, or release process.
4. **Check observable postconditions.** The result is checked against every
   applicable functional requirement, not merely against a plausible screen,
   log line, return value, or narrative report. Each requirement has an
   observable assertion and an evidence reference.
5. **Classify the result.** A successful check is evidence for the functional
   root only. A failed, unknown, unavailable, stale, or invalidated condition
   remains visible and routes to the appropriate next action.
6. **Hand off exactly once.** The lane returns one compact, source-bound
   handoff containing progress, result, hostile coverage, evidence, risks,
   independent-check status, and the next handoff. Routine progress is not a
   substitute for proof.

### Functional acceptance

The ordered Product roots remain exactly:

1. `FUNCTION_REQUIREMENTS`
2. `DESIGN_BIBLE`
3. `SECURITY`

This lane evaluates only `FUNCTION_REQUIREMENTS`. Every applicable functional
requirement must be accounted for before the root can be represented as
verified. `DESIGN_BIBLE` and `SECURITY` may receive dependency notes from this
lane, but this lane cannot mark either root passed and cannot turn a functional
result into overall acceptance.

Answers and lifecycle are separate. The permitted answer values are `YES`,
`NO`, `UNKNOWN`, `NOT_APPLICABLE`, and `EXCEPTION_REQUESTED`; the functional
evidence lifecycle is `UNEVALUATED`, `EVIDENCE_PENDING`, `OPEN_REPAIR`,
`VERIFIED`, or `INVALIDATED`.

| Observation | Functional handling |
| --- | --- |
| `YES` with direct evidence for the exact assertion | Mark that assertion `VERIFIED`; retain its evidence reference. |
| `NO` | Mark it `OPEN_REPAIR`, route one bounded repair, and require a fresh check. |
| `UNKNOWN` | Mark it `EVIDENCE_PENDING`; acquire bounded evidence or hand off the unresolved item. |
| `NOT_APPLICABLE` without proof | Treat it as unresolved; do not use the label to remove a requirement. |
| `NOT_APPLICABLE` with exact proof | Record the proof and permit the assertion to be considered complete. |
| `EXCEPTION_REQUESTED` | Keep it open until the named authority verifies scope, controls, expiry, and re-evaluation. |
| Source, goal, or protected condition changes | Mark dependent evidence `INVALIDATED`, close the current goal safely, and require a fresh source-bound admission. |

### Puzzle routing

A bounded test failure, compilation error, deterministic mismatch, or small
reversible implementation defect is a puzzle when it remains inside the exact
goal and does not weaken a protected boundary. The controller may route one
exact repair to the owning lane without a routine approval pause. The repaired
result receives a fresh focused check.

The lane must route a soft review when the proposed fix changes a non-protected
choice such as scope, architecture, route, or operating preference. It must
hard-stop when the fix would change owner intent, cross an authority boundary,
expose a secret or private context, use an unverified identity, create an
unadmitted role, perform an external action, or bypass independent checking.
Repeated attempts at the same deterministic failure do not create progress;
the finding becomes a typed unresolved item or hard stop.

## Unavailable behavior

Unavailable means that the required behavior or proof cannot be performed
under the admitted boundary. It is not a successful result with a placeholder.

- If a required input, requirement, capability, source readback, or acceptance
  fact is missing, return `UNKNOWN` or `EVIDENCE_PENDING` with the exact gap.
- If a local capability is absent or its identity cannot be verified, return an
  unavailable result and the exact capability gap. Do not substitute a shell,
  generic worker, fabricated identity, or unverified result.
- If the path would require authentication, spending, a provider, network
  access, publication, deployment, rollback, or other external action, stop at
  the boundary and record the unavailable action without attempting it.
- If a bounded check reaches its wait limit without a completion result, record
  `TIMEOUT_NO_RESULT`. Do not infer success from partial output or from the
  absence of an error.
- If a secret, credential, private context, or identity record appears in the
  evidence path, hard-stop, preserve only a safe digest and boundary finding,
  and do not copy the sensitive value into the public handoff.
- If the source repository, source commit, source tree, project binding, or
  required working directory differs from the admitted readback, return
  `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH` before writing or
  accepting functional evidence.

An unavailable result may be handed to a later typed campaign only with its
scope, reason, dependency, reopen trigger, and acceptance root preserved.

## Hostile cases

The independent check should exercise hostile inputs and confirm that the
workflow fails closed or routes exactly as specified.

| Hostile case | Required behavior |
| --- | --- |
| A stale or different source, project binding, commit, tree, or working directory is presented as current. | Stop before mutation or acceptance; emit the exact source-binding mismatch classification; invalidate dependent evidence. |
| A plausible output is produced while one required functional assertion fails. | Keep the root unresolved; record `NO`/`OPEN_REPAIR`; reject narrative-only or partial-pass evidence. |
| A requirement is relabeled `NOT_APPLICABLE` or an exception is asserted without proof or authority. | Keep the requirement open and request the missing proof or authority record; do not reduce the contract. |
| A deterministic failure is retried repeatedly with no changed cause. | Permit at most one bounded repair route for the current puzzle, then preserve the unresolved finding or hard-stop. |
| A missing adapter or remote step is replaced by a fake success, shell stand-in, or unverified worker. | Return unavailable or hard-stop; reject the result and the substitute identity. |
| A timeout produces partial logs but no completion signal. | Record `TIMEOUT_NO_RESULT`; do not convert partial output into a pass. |
| A mid-run scope, intent, policy, or protected-condition change is hidden from the handoff. | Invalidate affected evidence, close the current goal, and require a fresh source-bound goal. |
| The lane attempts to clear its own result or to mark design, security, or delivery complete. | Reject self-acceptance and route the exact result to the independent checker or owning foundation. |

## Focused check ideas

These are focused checks for the independent checker to select and execute
against the exact admitted thin workflow; they are not a claim that clearance
has already occurred.

1. **Deterministic happy path:** run the smallest useful workflow twice with
   the same synthetic input and source readback; compare the observable result,
   requirement coverage, and evidence digests.
2. **Requirement completeness:** enumerate every applicable
   `FUNCTION_REQUIREMENTS` assertion and verify that each has a direct result,
   evidence reference, and lifecycle state. Confirm that design and security
   remain separate roots.
3. **Negative-path behavior:** inject an invalid or missing input and confirm a
   bounded, typed failure with no false success and no scope expansion.
4. **One-repair bound:** inject one deterministic defect, route one exact
   repair, and require a fresh focused check; verify that repeated identical
   failures do not loop.
5. **Unavailable and timeout behavior:** remove a required capability or end a
   check without a completion signal; verify `EVIDENCE_PENDING` or
   `TIMEOUT_NO_RESULT`, with no external attempt and no inferred pass.
6. **Source and condition invalidation:** change the admitted source readback
   or a protected condition between steps; verify the mismatch or invalidation
   route and the fresh-goal requirement.
7. **Public/topology hygiene:** inspect the handoff for secrets, private
   context, external identities, chat/session records, child roles, generic
   workers, and shell stand-ins; every such attempt must be absent or rejected.

## Typed handoff

The lane returns one handoff object with these required fields. Values are
readbacks or evidence, never assertions supplied by an unverified caller.

| Field | Type or allowed value | Required meaning |
| --- | --- | --- |
| `phase` | literal `ASSEMBLE_FOUNDATION_LANES` | Foundation phase that owns the result. |
| `role` | literal `FOUNDATION_FUNCTIONALITY` | Admitted machine role. |
| `public_lane` | literal `Functionality` | Public lane label. |
| `task` | string | Exact bounded task and intended workflow outcome. |
| `scope` | object with `in` and `out` arrays | Functional boundary, including protected unchanged surfaces. |
| `source` | object with exact `commit` and `tree` readbacks | Source identity used for the work; stale or missing values stop acceptance. |
| `progress` | structured record | Meaningful work completed, not a narration of activity. |
| `functional_status` | map of requirement IDs to answer and lifecycle | Complete coverage of the `FUNCTION_REQUIREMENTS` root. |
| `result` | `READY_FOR_INDEPENDENT_CLEARANCE`, `OPEN_REPAIR`, `UNAVAILABLE`, or `HARD_STOP` | Exact lane outcome, with no implied clearance. |
| `hostile_coverage` | array of case IDs and outcomes | Hostile cases exercised and any gaps. |
| `independent_check` | object with status and requested checker | Separate check status; this lane reports `PENDING` until an independent checker returns a decision. |
| `evidence_digests` | array of public-safe digests | Content-addressed proof references without private records or secrets. |
| `open_risks` | array of typed risk records | Unresolved dependency, boundary, or evidence risk. |
| `next_handoff` | typed destination and action | Exact next owner: independent checker, bounded repair, hard-stop record, or later campaign. |
| `classification` | `PUZZLE`, `SOFT_REVIEW`, `HARD_STOP`, `DEFERRED_ITERATION`, or `READY_FOR_INDEPENDENT_CLEARANCE` | Routing classification for the controller. |

The public handoff contains project-agnostic summaries and digests only. Host
paths, project identifiers, session identities, credentials, provider or
account names, chat links, and private control-plane records remain outside
this document. A source-bound identity readback is required for actual
execution, but it is not a reason to publish private context.

## Clearance posture

This foundation is prepared for a separate, read-only independent clearance
check. It does not claim clearance, functional acceptance, design acceptance,
security acceptance, delivery readiness, or release readiness. Clearance must
recheck the exact workflow evidence, hostile coverage, public cleanliness,
source binding, and typed handoff before any later foundation or tailored role
uses this result.
