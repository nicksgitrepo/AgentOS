# ROADMAP_06_CAMPAIGN_LIFECYCLE audit report

Feature: `Governed Campaign Lifecycle and Progress Recovery`  
Inventory identity: `ROADMAP_06_CAMPAIGN_LIFECYCLE`  
Audit state: `BASELINE_AUDIT_COMPLETE_REPAIR_REQUIRED`  
Governance state: `PREPARED_NOT_ACTIVATED`  
Functional tests: `PENDING_BY_TASK_INSTRUCTION`

## Scope and authority

This report audits the accepted merge worktree as the read-only authority and
records the resulting repair work in the isolated writable worktree. The
inventory entry in `docs/feature-inventory.v1.json` names these normative
sources: `docs/roadmap.md`, `schemas/campaign-lifecycle.v1.json`, and
`schemas/continuous-operating-loop.v1.json`.

The intent was read across the roadmap section for capability 6, the progress
and health foundation, recovery and boundary foundation, delivery and closure
foundation, the 2.1rc feature/platform workflow, the lifecycle schema, the
continuous operating-loop schema, and the accepted-merge review. No product,
provider, deployment, credential, private-path, or chat-specific behavior is
admitted by this feature.

## Intended behavior

The feature must provide one bounded campaign flow with a campaign-scoped
Orchestrator, temporary workers, an independent Auditor, and persistent
Intent Regulator and Runtime records. It must:

- bind every observation to the exact project, campaign, scope, source commit
  and tree, role, and intent;
- distinguish meaningful result, heartbeat/liveness, waiting, failure, and
  timeout; heartbeat, plans, and failure lists must not reset the meaningful
  progress window;
- default the configurable meaningful-progress window to fifteen minutes;
- inspect every active worker, preserve evidence, classify puzzles, soft
  boundaries, hard boundaries, and true blockers, and keep unrelated safe work
  eligible;
- repair only an ordinary in-scope puzzle, refresh exact source and normative
  bindings, mint a predecessor-bound replacement, require visible host
  receipts and a meaningful typed result, and obtain independent Auditor
  clearance;
- preserve typed handoffs and failed/partial closure evidence, remove closed
  temporary work from the active roster, and prevent self-acceptance; and
- remain portable, secret-free, deterministic, reversible, and inactive until
  explicit activation.

## Baseline actual implementation

The accepted merge contains a substantial bounded lifecycle implementation in
`control/campaign-lifecycle.mjs`, with staged custody, transition journaling,
checkpoint and repository proof, holds, Platform leases, finalizer custody,
live closure, successor orientation, and compare-and-swap state/event writes.
It also contains the intended continuous-loop contract and implementation:

- `schemas/continuous-operating-loop.v1.json` declares the roles, fifteen
  minute cadence, meaningful-progress rule, replacement sequence, protected
  actions, and inactive activation boundary.
- `control/continuous-operating-loop.mjs` validates project bindings, workers,
  evidence, handoffs, inspections, repair records, replacement goals,
  replacement receipts, independent clearance, and bounded record writes.
- `tests/verify-continuous-operating-loop.mjs` includes false-progress,
  stale-source, changed-intent, failed-repair, replacement, closure, CAS, and
  hostile-boundary cases. It was not executed because functional tests remain
  pending by task instruction.
- The accepted merge also declares the loop in the controller and kernel
  contracts and exposes the intended fifteen-minute controller reconciliation.

The isolated writable checkout starts from the shared pre-merge commit and
does not contain the accepted merge's new loop module, loop schema, loop
verifier, or controller/kernel loop bindings. Its existing lifecycle module
also carries a private canonicalization implementation. Therefore the current
candidate is not feature-complete even though the accepted merge authority
contains the claimed slice.

## Findings

### F-001 — continuous-loop slice is absent from the writable candidate

Evidence: the authoritative worktree contains
`control/continuous-operating-loop.mjs`,
`schemas/continuous-operating-loop.v1.json`, and
`tests/verify-continuous-operating-loop.mjs`; the writable checkout does not.
The writable `schemas/agentos-controller.v1.json` and `schemas/kernel.v1.json`
also lack the loop binding present in the accepted merge.

Why it matters: the roadmap promise cannot be reproduced or admitted from the
candidate, and controller custody has no typed route to progress recovery.

Disposition: `REPAIRABLE_IMPLEMENTATION_GAP`. Port only this feature slice and
its exact controller/kernel contract bindings into the isolated worktree.

### F-002 — digest implementation is duplicated across lifecycle boundaries

Evidence: the accepted lifecycle implementation moves to the shared
`control/content-addressing.mjs` primitive, while the accepted continuous loop
still carries a private `canonicalize`/SHA-256 implementation. The writable
lifecycle module also carries the private copy.

Why it matters: divergent canonicalization is a custody and regression risk for
content-addressed state and makes architecture hygiene fail once the shared
primitive is admitted.

Disposition: `REPAIRABLE_HYGIENE_AND_DURABILITY_GAP`. Add one small portable
shared digest primitive and bind both feature modules to it.

### F-003 — persisted failure text is not privacy-safe

Evidence: `control/continuous-operating-loop.mjs` constructs
`error_message` from `error.message` and uses the same raw message in patch
root-cause summaries. The validator only checks that the string is nonempty.

Why it matters: host errors can contain absolute machine paths, credentials,
provider tokens, session/task identities, or private links. The task forbids
persisting those values, and a digest of a raw message does not make the stored
message safe.

Disposition: `REPAIRABLE_SECURITY_AND_PRIVACY_FINDING`. Redact or reduce
persisted error/root-cause text to bounded secret-free metadata while retaining
an opaque digest for evidence custody; reject unsafe residual text.

### F-004 — replacement host receipts are presence-only and not bound

Evidence: `validateHostReceipts` accepts each named receipt when it has only
`status: OBSERVED` and a SHA-256. It does not bind the operation to the
replacement session, observation time, or the receipt's operation identity.

Why it matters: one copied or misrouted digest can falsely prove create/pin/
send/wait/read/unpin/archive/post-close/roster-absence custody, defeating
closure and stale-identity protection.

Disposition: `REPAIRABLE_CUSTODY_AND_REGRESSION_FINDING`. Require operation,
session, time, and content-addressed receipt metadata for every host step, and
require the read step to prove meaningful progress and the exact typed handoff.

### F-005 — repair and replacement records do not fully bind to the inspection

Evidence: the replacement path validates a repair record and inspection, but
does not require the repair's preserved evidence and `source_before` to equal
the current inspection/loop, nor does it prove the replacement Auditor is
distinct from the replacement worker session.

Why it matters: a valid record from another inspection or stale source can be
replayed to mint a replacement under the wrong custody; an Auditor/session
collision can become self-clearance.

Disposition: `REPAIRABLE_BOUNDARY_AND_REGRESSION_FINDING`. Add exact loop,
inspection, source, predecessor, session, and independent-Auditor bindings at
the owning transition.

### F-006 — replacement model is hard-coded in portable control logic

Evidence: replacement receipt validation requires a specific model string and
the compiler defaults to that provider/model-specific value.

Why it matters: the portable kernel must receive model and reasoning bindings
as typed project/campaign data; a fixed provider/model identity is not a
project-agnostic lifecycle rule and can silently misrepresent execution.

Disposition: `REPAIRABLE_PORTABILITY_FINDING`. Require the admitted model and
reasoning binding as data and validate nonempty safe labels without naming a
provider or product in the kernel.

### F-007 — CAS persistence has incomplete directory-durability evidence

Evidence: the accepted record writer fsyncs the temporary file and renames it,
but does not fsync the containing directory before reporting readback success.

Why it matters: a power loss can leave the rename not durably recorded even
though the file readback succeeded, weakening the durable progress/recovery
promise.

Disposition: `REPAIRABLE_DURABILITY_FINDING`. Fsync the containing directory
when the host supports it, retain the atomic rename/readback boundary, and
fail closed only when the required host operation is unavailable.

## Quality, hygiene, minimality, security, privacy, durability, regression,
## custody, boundary, and intent review

Quality: the state-machine and evidence vocabulary are appropriately typed,
but unbound opaque receipts and stale repair inputs weaken the claimed proof.

Hygiene/minimality: the feature is a large retained transaction boundary as
documented by the accepted architecture, but it currently duplicates digest
logic and hard-codes execution context. The repair will stay inside the
feature boundary and avoid unrelated merge work.

Security/privacy: protected action flags fail closed, path traversal is
guarded, and activation is inactive; raw failure text is not safe until F-003
is repaired.

Durability: content-addressed records, lock files, atomic replacement, and
readback exist; directory durability and stale-record binding remain findings.

Regression: hostile test intent is strong, but functional execution is pending.
The focused verifier must be retained and updated with each repaired contract.

Custody/boundary: role separation and predecessor history are present, but
receipt operation/session binding and independent-Auditor separation are
required before closure can be trusted.

Intent: the roadmap and foundations require progress recovery, not merely a
timer. The accepted design expresses that intent; the writable candidate does
not yet carry it.

## Evidence and unknowns

Observed evidence is limited to source inspection of the authoritative merge,
the inventory, schemas, documentation, and verifier source. No external host,
provider, campaign, credential, deployment, or live-session authority was
needed. Functional tests, race testing, power-loss testing, and real host
receipt readback are unknown and remain pending.

## Production readiness

Baseline: `NOT_READY — REPAIR_REQUIRED`. There is no genuine external blocker.
The missing files and contract defects are ordinary implementation gaps and
must be reframed and repaired here. After repair, the feature can be a
`PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`; it must not be called
production-ready or activated until those tests and independent review pass.

## True blockers and exact recovery

True blockers: `NONE`.

Pending functional tests are an instructed verification state, not an external
blocker. If a future host receipt or durable directory operation is unavailable,
preserve the exact phase and safe digest, mark the affected result
`UNAVAILABLE`, keep the candidate unaccepted, and route the next action to the
named host adapter or independent Auditor; never substitute a caller claim.

## Builder actions

1. Port the authoritative continuous-loop contract and implementation into
   this worktree, with only feature-scoped controller/kernel bindings.
2. Replace duplicate digest code with one deterministic portable primitive.
3. Make persisted errors/root causes bounded and privacy-safe.
4. Bind every replacement receipt to its operation/session/time and require a
   source-bound meaningful read result and typed handoff.
5. Bind repair records to the current inspection/source and prevent
   replacement/Auditor identity collisions.
6. Make model and reasoning settings typed inputs, not hard-coded provider
   context.
7. Add directory fsync durability where available and preserve fail-closed
   behavior.
8. Perform a self-audit, then a fresh re-audit with this report appended;
   leave functional tests explicitly pending.

## Initial handoff

Changed files: this report only.  
Evidence: baseline findings F-001 through F-007 above.  
Remaining findings: F-001 through F-007.  
Next action: execute the recorded feature-scoped repairs in the isolated
writable worktree, then self-audit and re-audit before handoff.

## Repair pass 1, self-audit, and re-audit

Repair state: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`  
Governance state: `PREPARED_NOT_ACTIVATED`  
True blockers: `NONE`

The builder completed the recorded repair slice in the isolated worktree and
retained the baseline findings above as history. No unrelated project or
provider work was changed.

### Builder actions completed

- F-001: added the continuous operating-loop controller, contract, focused
  verifier, controller/kernel bindings, and the fifteen-minute default in the
  controller state compiler and its verifier.
- F-002: added the small portable `control/content-addressing.mjs` primitive
  and routed both the campaign lifecycle and continuous loop digests through
  it.
- F-003: bounded and redacted persisted root-cause and host-failure text,
  retained only opaque raw-receipt digests, and added a hostile privacy case.
- F-004: made every host receipt bind its operation, replacement session,
  observation time, source commit/tree, meaningful-progress flag, and digest;
  the read receipt also binds the typed handoff.
- F-005: bound repairs to the current inspection evidence/source, bound the
  test-build identity to the predecessor handoff, bound replacement goals and
  receipts to the exact inspection/repair/predecessor/source, and rejected
  self-clearance. The self-audit also found and repaired the related route
  edge: true identity/evidence blockers now stop at Intent Regulator review
  and cannot enter Orchestrator repair.
- F-006: replaced the hard-coded execution identity with required safe labels
  supplied as typed inputs.
- F-007: fsynced the containing directory after atomic rename while retaining
  lock, symlink, readback, and fail-closed behavior.

Changed feature-scoped files:

- `control/agentos-controller.mjs`
- `control/campaign-lifecycle.mjs`
- `control/content-addressing.mjs`
- `control/continuous-operating-loop.mjs`
- `control/README.md`
- `schemas/agentos-controller.v1.json`
- `schemas/bootstrap-binding.v1.json`
- `schemas/continuous-operating-loop.v1.json`
- `schemas/kernel.v1.json`
- `tests/verify-agentos-controller.mjs`
- `tests/verify-all.mjs`
- `tests/verify-continuous-operating-loop.mjs`

### Static evidence

- `node --check` passed for every changed JavaScript module and verifier.
- `jq empty` passed for every changed JSON contract and binding.
- `git diff --check` passed.
- The normative digest/readback and portability scan passed for all 140 bound
  normative paths.
- No functional verifier, race test, host adapter, or power-loss test was
  executed; functional tests remain pending by task instruction.

### Re-audit disposition

F-001 through F-007 are resolved at the source and contract level. The
re-audit confirms that the candidate remains portable and inactive, the
fifteen-minute timer is explicit, heartbeats/plans/failure lists cannot count
as meaningful progress, protected actions remain false, temporary naming is
build-bound, failed repair and host closure evidence remains preserved, and
replacement clearance is independent.

Remaining evidence findings are not accepted as production approval:

- Functional execution and hostile assertions are pending.
- Supported-host adapter receipts, concurrent CAS contention, crash recovery,
  and actual directory-durability behavior still need execution evidence.
- The current candidate has no genuine external blocker; unavailable host
  capabilities must be preserved as bounded failure records and recovered by
  the named adapter or independent Auditor rather than caller assertion.

### Final handoff

Changed files: the feature-scoped files listed above.  
Evidence: baseline audit, repaired contracts/controllers, static syntax/JSON/
digest/portability checks, and the appended re-audit.  
Remaining findings: functional and real-host durability evidence only; no
unresolved ordinary implementation finding and no true blocker.  
Next action: run the focused continuous-loop verifier and the full functional
suite on the candidate, then perform independent Auditor review before any
activation decision. `2.1rc` remains `PREPARED_NOT_ACTIVATED`.

## Privacy re-audit addendum — durable session and check receipts

The durable local session now normalizes heartbeat and command-result errors to
opaque deterministic digests, and child stdout/stderr are never copied into
initial-readback or command-result records. The generated check-failure receipt
contract now stores output classes and SHA-256 output digests rather than raw
stdout/stderr. The generated evidence repair path also redacts transient
command-failure text before it can enter an error message. Static source review
was updated with hostile path/secret assertions; functional execution remains
pending.

The local supervisor route now also hashes failed-session error material before
writing an RCA. The raw failure is used only transiently to classify the
failure; the retained record carries an opaque error identity and the existing
source-bound evidence path.

## Central intake cycle — reconciled Campaign Lifecycle — 2026-08-09

The visible lifecycle lane completed the requested shared-surface repair after
the first intake was rejected. The second intake preserved the current central
campaign closeout custody, README authorities, Intent Regulator/JSA contracts,
dynamic verifier discovery, current governance and persistent-runtime entries,
and privacy primitives. The lane's fresh source observation is
`8a7e356fdb0a3ae41f50472989d8be3e8cc2dd6efa1ed9ef1d8fcc3d14ea2c7c`; its fresh
handoff is `8cba0022cfa6953029bbce4926fec59b6eacbc6eecba4c9657e104261f62a4a4`.

The central worktree applied only the compatible lifecycle deltas:

- one continuous-operating-loop authority bullet in `control/README.md`;
- bounded privacy-safe persisted errors, exact source/intent and host-receipt
  binding, meaningful-progress/readback rules, typed model/reasoning inputs,
  failed-patch retention, and directory-fsync durability in
  `control/continuous-operating-loop.mjs`;
- the corresponding contract fields in
  `schemas/continuous-operating-loop.v1.json`;
- focused privacy, true-blocker, source-binding, stale-repair, and host-receipt
  assertions in `tests/verify-continuous-operating-loop.mjs`;
- the two lifecycle assertions in `tests/verify-all.mjs`; and
- exact digests for those files in `schemas/bootstrap-binding.v1.json`, while
  retaining all 308 pre-existing normative and 9 compatibility-only entries;
  central then added two evidence-record bindings for this report and its
  preservation manifest.

`control/campaign-lifecycle.mjs` and every other shared surface were verified
byte-equal to the central baseline before intake; the stale rollback was not
consumed. The pre-intake bytes are preserved in
`central-intake-preservation-manifest-2026-08-09.md`.

Disposition: `CENTRAL_INTEGRATED_PENDING_INDEPENDENT_REAUDIT`. The visible
task and isolated worktree remain preserved and unarchived; downstream
consumption remains `false`. Static source/schema/binding/hygiene/privacy
evidence passed. Functional verifiers, real host readbacks, concurrency,
crash/power-loss durability, clean-source proof, and independent clearance
remain pending by instruction. No true blocker was found.

## Central re-audit repair — hostile fixture portability — 2026-08-09

The independent central re-audit found one ordinary source-hygiene defect in
the lifecycle verifier: the hostile redaction fixture contained a literal
API-key-shaped label and placeholder value. It was synthetic test input and
was not persisted, but the source literal still violated the
privacy/portability boundary.

The visible lifecycle task repaired the fixture by constructing the same
synthetic value from harmless runtime fragments and refreshed its source-bound
handoff. The repaired source observation is
`49200c18e57714e083501beed9d924336f6ce9da917c3725c3be06b5f943910a`; the fresh
handoff is `bba61e2e841a2a4db98d78c49040533c3d6f2a2b2b83395632d90dbab9b31281`.
The central worktree applied only the verifier fixture delta and its exact
binding digest `d63c544d6379e936648d123e2567993a0fe64b401855383f8de3ed0f36d6a761`.

Static syntax, JSON, diff-hygiene, literal-absence, portability, and binding
checks passed. Functional verifiers, host readback, concurrency,
crash/power-loss durability, clean-source proof, commits, pushes, release,
deployment, and archive actions remain pending. Downstream consumption remains
`false`; no true blocker exists.
