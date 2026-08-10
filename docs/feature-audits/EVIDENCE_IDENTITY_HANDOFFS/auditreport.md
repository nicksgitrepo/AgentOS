# EVIDENCE_IDENTITY_HANDOFFS audit report

Feature: Evidence Identity, Typed Handoffs, and Independent Clearance  
Inventory status at baseline: `NOT_STARTED`  
Audit mode: read-only baseline audit before repair  
Audit result at this entry: `REPAIR_REQUIRED`  
Functional tests: pending by task instruction; no functional test result is claimed.

## Baseline and source corpus

The current accepted-merge source was read as the authority before any edit in
this isolated worktree. The source identity read back from that authority was:

- committed source `HEAD`: `590c07ddd4be7a8c24727c24b40808e44ca7357d`;
- committed source tree `HEAD^{tree}`: `f1b358d87e6a969fb9631e202a3d478540edd4d9`;
- committed source state: `DIRTY` working tree, kept separate from the
  committed source identity.

The feature inventory entry names this source corpus:

- `docs/rapid-foundations/10-evidence-and-identity.md`;
- `schemas/digest-bound-checkpoint.v1.json`;
- `control/native-session-runner.mjs`.

The implementation and focused-test surfaces reviewed as supporting evidence
were `control/rapid-prototype/evidence-identity.mjs`,
`tests/rapid-prototype/evidence-identity.mjs`,
`control/rapid-prototype/index.mjs`, and the native-session team contracts.
The reviewed source digests at baseline were:

| Source | SHA-256 |
| --- | --- |
| `docs/roadmap.md` | `2d53cd7fc5618d05039edb5549a55b533337051af57ffcbcc2db3edb3cc0f77d` |
| `docs/rapid-foundations/10-evidence-and-identity.md` | `37f7d2ee8c66701930cc1c108d8d2864711a65f8b8d44a9dbb6400f78e892a2b` |
| `schemas/digest-bound-checkpoint.v1.json` | `f227b2a0654ef2db1fb8f820c35f0750f0e22a57851e31673bf86c12c303f153` |
| `control/native-session-runner.mjs` | `186e21edf6cda5df46b7b18a7a220b4e4fcc82ac4e5d720cc708ba14753a3e6f` |
| `control/rapid-prototype/evidence-identity.mjs` | `0c5bbe8ffbf8fd84f57406d0586e62541c54e770c1b7d35ed87e2eb24328554a` |
| `tests/rapid-prototype/evidence-identity.mjs` | `3b4324571e0b5750509ae279bbe6634fce0afab5a789afa90c7f4d560104bec3` |

The complete roadmap was read. It treats evidence as a Phase 0 dependency,
states that proof-carrying work is only partial, and requires exact source
identity, hostile coverage, privacy and boundary checks, preserved risks, and
an independent checker before a status can advance. No separate
`research-records` file or owner-linked research corpus exists in the
accepted-merge tree; that inventory source label is therefore an unknown, not
an authority record. The available research intent is represented by the
roadmap and rapid-foundation documents and was reviewed as such.

## Intended behavior

The foundation contract requires every consequential claim to be bound to the
real project, exact source commit and tree, canonical working directory, real
host-issued session identity and pin, admitted role, bounded task, changed
paths, checks, and closure state. Working-tree dirtiness is a separate fact.
Receipts are content-addressed observations, not truth by digest alone.

The public handoff must be portable and secret-free, keep exact environment
and actor values in the control plane, state `PASS`, `FAIL`, or `UNAVAILABLE`
truthfully, carry hostile coverage and evidence digests, and explicitly remain
pending independent clearance. A creator cannot self-clear. The
digest-bound-checkpoint contract additionally requires a verified clean,
unpushed checkpoint bound to source, evidence, and candidate digests. The
native session runner must preserve typed handoffs, bind source and host
identity, and close temporary sessions without treating closure as acceptance.

## Actual implementation at baseline

- `compileEvidenceReceipt` canonicalizes nested values, binds changed paths to
  a declared scope, requires a passing focused check, records hostile cases,
  and content-addresses the receipt.
- `verifyHostAuthority` exists and the rapid-slice assembler calls it, but the
  receipt compiler does not require its result, does not persist a typed actor
  binding, and does not verify a host pin.
- The receipt's exact-key shape contains source readback, project identity,
  task, and goal values, while its privacy scan mainly rejects absolute paths,
  URLs, and obvious secret shapes. Relative private values and identity-bearing
  labels are not comprehensively reduced to safe digests.
- The handoff normalizer reduces independent-check state to a string and does
  not carry the documented `required: true`, `NOT_YET_RUN`, close-readiness, or
  typed blocker fields. The top-level receipt status is always
  `READY_FOR_INDEPENDENT_CLEARANCE`.
- `normalizeFocusedCheck` accepts only `PASS`, so the implementation cannot
  preserve a pending, failed, or unavailable check as an honest typed result.
- Hostile coverage only requires three arbitrary unique entries; it does not
  require the documented `H-01` through `H-03` minimum.
- `schemas/digest-bound-checkpoint.v1.json` has no validator or producer in
  this feature path. `control/native-session-runner.mjs` validates opaque
  handoff/result digests, source fields, task gates, and host closure, but it
  does not validate the typed handoff contents or bind a checkpoint record to
  the run.

## Findings and why they matter

| ID | Finding | Impact | Recorded repair |
| --- | --- | --- | --- |
| F-01 | Host authority is an adjacent check, not a compiler invariant. `verifyHostAuthority` does not require a pin and compares supplied values primarily with observed values; `compileEvidenceReceipt` accepts no required actor/authority binding. | A caller can obtain a structurally valid ready receipt without the real pinned actor, exact expected source, or independent host readback. This defeats H-04 and weakens custody. | Require a verified host authority input, compare against the expected source and admitted role/session/thread/host, preserve only safe actor digests and pin state, and return an explicit unavailable result when authority is absent. |
| F-02 | The receipt shape carries exact project root/cwd/top-level, project ID, task ID, and goal ID values and relies on a narrow lexical privacy scan. | Portable/control-plane boundaries can be crossed by relative or identity-bearing values; a digest proves payload identity but does not make private values safe. | Normalize private identity inputs to non-reversible digests plus safe classifications; reject private field labels and obvious sensitive values before hashing. |
| F-03 | The handoff is not the documented typed handoff. It has a status string, independent-check string, and next route only; the receipt status is unconditional. | Failure, unavailable, blocked, and pending states can be mislabeled as clearance-ready, and the next authority lacks required closure/readiness evidence. | Add canonical handoff status, required/pending independent-check object, close readiness, and derive receipt status from observed results without claiming acceptance. |
| F-04 | Focused checks are forced to `PASS`. | Timeouts, unavailable capabilities, and the instructed pending functional tests cannot be represented; missing evidence is coerced into a compile failure rather than a typed unavailable result. | Support `NOT_YET_RUN`, `PASS`, `FAIL`, and `UNAVAILABLE` with source-bound evidence where present; keep acceptance open for non-pass states. |
| F-05 | Hostile coverage is under-constrained. | A handoff can satisfy the minimum with unrelated labels and omit the core source, identity, and stale-state attacks required by the foundation. | Require `H-01`, `H-02`, and `H-03`, reject duplicates, and preserve honest dispositions. |
| F-06 | The digest-bound checkpoint schema and the native runner are not joined to the evidence receipt/handoff contract. The runner accepts opaque handoff/result hashes and closes sessions without checking the typed handoff's independent-check state. | A run can be operationally closed while its evidence/checkpoint relationship and clearance-pending state remain unproven. | Add a small reusable checkpoint validator/producer and require runner completion/closure evidence to carry a typed, non-cleared handoff and source-bound checkpoint digest. |

## Cross-cutting audit lenses

- Quality: canonical JSON, exact-key checks, source Git-object validation, and
  receipt hashing are useful foundations; the status and authority gaps are
  correctness defects, not cosmetic issues.
- Hygiene and minimality: the feature duplicates authority logic between the
  assembler and receipt helper and has no single required actor contract. The
  repair will stay within the evidence module, its focused test, the narrow
  assembler/native-runner integration, and this report.
- Security and privacy: obvious credentials and URLs are rejected, but exact
  identity fields and relative private values are not consistently reduced to
  safe summaries before hashing. No secret was read or recorded by this audit.
- Durability and regression: digests detect alteration after compilation, but
  there is no source-bound checkpoint artifact and no typed pending/unavailable
  representation to survive a failed check or restart.
- Custody: native session cleanup is source/host-bound and verifies zero active
  entries; closure currently proves lifecycle state, not independent clearance.
- Boundary: external actions remain disabled and no child or shell substitute
  is admitted. The missing host pin and typed actor binding leave a local
  identity boundary under-enforced.
- Intent: the roadmap and foundation say “ready for review” is not “cleared.”
  Unconditional `READY_FOR_INDEPENDENT_CLEARANCE` and pass-only checks do not
  preserve that distinction across all outcomes.

## Evidence and unknowns

Evidence is the source corpus, source hashes above, direct code inspection,
the inventory entry, and the existing focused-test assertions. The accepted
merge's prior implementation audit reports PASS for this lane, but that report
does not exercise the missing actor-required compiler path, host pin, required
hostile IDs, non-pass check states, or checkpoint/runner integration.

Unknowns are limited to the unavailable owner-linked research records named
abstractly by the inventory and the external host's runtime pin/readback
semantics. Neither is needed to implement the deterministic fail-closed
contract. Functional tests remain pending by instruction and are not evidence
of either failure or success here.

## Production readiness

Baseline: `NOT_READY — REPAIR_REQUIRED`. The feature is a promising local
implementation slice, not a production candidate, because F-01 through F-06
leave identity, typed handoff, checkpoint custody, or truthful unavailable
states under-specified. No external blocker is present. A true host-capability
blocker, if encountered later, must return `UNAVAILABLE` with the exact missing
readback/capability, preserve safe evidence, avoid mutation, and name the
fresh source-bound recovery route; it must not be replaced by a caller claim,
generic worker, shell stand-in, or self-clearance.

## Builder actions

1. Repair F-01 through F-05 in the evidence receipt contract and its focused
   hostile fixtures, preserving source-bound and privacy-safe behavior.
2. Add the digest-bound checkpoint contract and narrow native-runner handoff
   integration required by F-06 without enabling release, push, deployment,
   or activation.
3. Update the rapid-slice adapter only where required to supply the typed
   authority and preserve its existing external unavailable behavior.
4. Perform a source-level self-audit, then a fresh re-audit against the same
   intended behavior and append both results here. Functional tests remain
   pending; syntax/hygiene checks may be recorded separately.

## True blockers

None at baseline. The missing research-record files and pending functional
tests are recorded unknowns/instructional limits, not external blockers.

## Builder pass and repair evidence

The recorded findings were repaired in the isolated worktree only. No product
policy, provider account, deployment identity, credential, chat link, or
private machine path was added. The accepted-merge feature closure was copied
into this worktree before repair where the native runner required it; those
support files are retained as source dependencies, not reinterpreted as new
product scope.

Changed or added feature surfaces:

- `control/rapid-prototype/evidence-identity.mjs`: source-bound receipt,
  privacy-safe actor binding, typed handoff, truthful check states, hostile
  minimum, and digest-bound checkpoint producer/validator;
- `tests/rapid-prototype/evidence-identity.mjs`: pending-aware, privacy,
  actor-pin, hostile, tamper, status, and checkpoint fixtures;
- `control/native-session-runner.mjs`: admitted typed-handoff schemas,
  required pending independent check, evidence-digest equality, and strict
  source/evidence/candidate checkpoint binding;
- `tests/verify-native-session-runner.mjs`: typed pending handoff and
  digest-bound checkpoint readback fixture;
- `docs/feature-audits/EVIDENCE_IDENTITY_HANDOFFS/auditreport.md`: this
  append-only audit history.

The schema and source-closure files named by the inventory were preserved in
the isolated worktree as the implementation dependency set:
`docs/rapid-foundations/10-evidence-and-identity.md`,
`schemas/digest-bound-checkpoint.v1.json`,
`control/content-addressing.mjs`, `control/native-host-attachment.mjs`,
`control/native-session-host-attestation.mjs`, `control/native-session-team.mjs`,
`control/persisted-record-privacy.mjs`, and `control/task-gate-questions.mjs`.
No unrelated project was touched.

## Self-audit after repair

The first self-audit found three implementation details that needed tightening
before re-audit: the typed handoff needed compile/verify context so its full
safe shape could be canonicalized; a boolean pin state without an actual pin
readback was insufficient for `VERIFIED`; and the native runner needed an
admitted schema set instead of accepting any nonempty schema string. These
were repaired in the same isolated pass. The native runner now rejects a
`REQUESTED` independent state and accepts only the foundation, native-session,
or native-implementation typed-handoff schemas already present in the source
closure.

## Fresh re-audit

F-01 is resolved by exact expected source comparison, admitted role/session/
thread/host comparison, required nonempty pin readback, and safe actor
digests. Missing or stale authority is represented as `UNAVAILABLE` or
`UNPROVEN`, never as verified.

F-02 is resolved by canonical public source/project/task/goal/actor shapes,
digest-only identity fields, relative changed-path validation, and recursive
rejection of absolute/private paths, URLs, credential-like values, and private
field labels.

F-03 is resolved by `agentos.rapid_foundation_handoff.v1` with the documented
public lane, fixed role, typed source/actor/task scope, string progress, honest
result enum, open risks, evidence digest, close readiness, and
`independent_check: {required: true, status: "NOT_YET_RUN"}`. Receipt status is
derived from observed actor, behavior, and focused-check outcomes.

F-04 is resolved by preserving `NOT_YET_RUN`, `PASS`, `FAIL`, and
`UNAVAILABLE`; non-pass outcomes cannot be rewritten as a pass or clearance.
F-05 is resolved by unique hostile coverage requiring `H-01`, `H-02`, and
`H-03`. F-06 is resolved by strict checkpoint production/validation and native
runner binding of source commit/tree, evidence digest, candidate digest,
`clean: true`, and `pushed: false`.

Static evidence collected after the repair:

- `node --check` passed for the repaired module, focused feature test, native
  runner, native runner test, and the imported source-closure modules;
- `jq empty` passed for `schemas/digest-bound-checkpoint.v1.json`;
- focused scans found no private machine paths, file/chat links, credentials,
  provider tokens, or package-manager command references in the repaired
  feature/report surfaces;
- no functional test was executed, in accordance with the task instruction.

The historical baseline entry retains its Markdown hard-break spacing so the
audit remains append-only; this is documentation formatting, not a runtime
payload or production-surface defect.

## Re-audited production readiness and handoff

Result: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`.

No material recorded finding remains. The candidate is still not functionally
cleared, not independently cleared, not released, and does not activate
`2.1rc`. The owner-linked research-record reference remains an authority-corpus
unknown only. There is no genuine external blocker.

Next action: an authorized test pass should run the focused evidence-identity
and native-session runner tests, then an independent clearance actor should
re-read the exact source binding, actor pin, changed paths, receipt, handoff,
and checkpoint. A failing or unavailable result must remain typed and route to
the recorded repair or host-boundary recovery path.

## Final schema-bound re-audit pass

One additional self-audit comparison against the checkpoint JSON Schema found
that the first repair accepted lowercase checkpoint identifiers even though
the schema requires an uppercase-leading identifier. The producer and
validator now enforce the exact schema pattern and the focused fixture records
the rejection case. Syntax, schema, privacy, and hygiene checks were repeated
after this correction and remain passing. No new material finding or external
blocker was introduced; functional tests remain the sole execution evidence
pending the authorized test pass.

## Campaign correction: platform prerequisite hold

The Controller has imposed a hard platform-foundation prerequisite for this
lane. The feature implementation, repair, and acceptance notes above are
preserved as isolated-worktree audit history and provisional builder evidence;
they are not an accepted feature result while the platform gate is unresolved.
No feature acceptance, release readiness, activation, or independent-clearance
claim is advanced by this report.

Current disposition: `PLATFORM_GATE_HOLD`.

Exact next action: wait for the Controller to accept and merge the platform
skeleton, routing, stack, shared contracts, and UI direction. When that gate is
recorded, re-read the merged platform contract and this feature's source
binding, then resume only the recorded audit/repair/re-audit work against that
accepted platform. Until release, preserve these findings and do not run a
feature acceptance or claim production readiness. `2.1rc` remains inactive.
