# PARALLEL_CAMPAIGN_LIFECYCLE audit report

## Audit identity and authority

- Feature: `PARALLEL_CAMPAIGN_LIFECYCLE`
- Intended capability: Parallel Campaign Planning, Leases, and Merge Custody
- Inventory authority: `docs/feature-inventory.v1.json`, status `NOT_STARTED`
- Accepted source authority: current accepted merge worktree, source revision `590c07d`, including its uncommitted feature additions
- Writable scope: this isolated worktree only
- Audit mode: audit → repair → self-audit → re-audit
- External effects: none authorized; no push, merge, release, activation, provider, credential, or deployment action

The accepted merge source was read before this report was created. The report is
portable and contains no private machine paths, credentials, provider tokens,
task identities, or chat links.

## Initial audit — 2026-08-07

### Intended behavior

The roadmap and authority corpus require a prepared, project-agnostic
multi-lane campaign design that remains inactive until explicitly admitted. A
valid implementation must:

1. compile a deterministic plan from an exact goal, source identity, policy,
   dependency DAG, and lane ownership scopes;
2. admit only dependency-ready workers, enforce bounded concurrency, and prevent
   simultaneous writers for one scope;
3. bind each worker to a lease and opaque session reference, with a meaningful
   progress window and expiry recovery;
4. require content-addressed progress, handoff, evidence, and an independent
   Auditor result before custody can close;
5. preserve failures, rejected audits, lease fencing, and event history while
   routing a repaired replacement rather than silently reusing stale custody;
6. keep intermediate lane checkpoints out of the shared default branch and
   reserve terminal convergence/merge custody to the persistent Runtime; and
7. fail closed on stale identity, privacy leakage, duplicate custody, malformed
   state, and unavailable external capabilities.

This is a prepared design library, not an activation decision for `2.1rc`.
The governance source explicitly keeps multi-lane activation design-only until
per-lane state, blockers, custody, transitions, convergence, and hostile proof
are executable.

### Actual implementation in the accepted source

The accepted source provides:

- `control/parallel-campaign-records.mjs`: deterministic plan/worker/lease/
  progress/handoff/audit/failure/event compilation and validators;
- `control/parallel-campaign-lifecycle.mjs`: ready scheduling, dependency
  ordering, concurrency and writable-scope exclusion, lease acquire/renew/
  expire, worker execution, handoff audit, failure, and closure transitions;
- nine standalone JSON Schema contracts for plan, state, worker, lease,
  progress, handoff, audit, failure, and event records;
- focused contract and lifecycle test files covering schema parity, privacy
  scanning, dependency ordering, parallel scheduling, expiry, rejected audits,
  and scope exclusion;
- host-neutral callbacks rather than direct thread, worktree, provider, or
  merge side effects; and
- persistence through an expected state digest callback, with state/event
  digests and an append-only event chain.

Static evidence: both feature modules parse successfully, all nine feature
schemas parse as JSON, and the accepted feature tests are present. Functional
tests were not run because this task explicitly leaves them pending and npm is
not permitted.

### Findings

#### PCL-001 — exact-expiry custody boundary is permissive [HIGH]

Evidence: the accepted lifecycle's `ensureNotExpired` permits an operation at
the exact `expires_at_utc` boundary (`<=`), while lease expiration requires a
strictly later time. The persistent Runtime convention treats a lease as
active only while `now < expires_at_utc`.

Why it matters: an owner can perform start, progress, handoff, audit, or close
at the exact expiry instant after custody should already be fenced. That is a
writer-custody and recovery race.

Builder action: use one strict validity rule (`now < expiry`), fence at
`now >= expiry`, and add a focused hostile boundary case.

#### PCL-002 — Auditor identity can be reused across lanes [HIGH]

Evidence: admission rejects Auditor identities that belong to a worker, but
state validation only checks Auditor identities against worker identities. It
does not require Auditor references or Auditor session references to be unique
across already accepted lane audits.

Why it matters: two parallel lanes can claim the same independent checker or
session, weakening independence and creating ambiguous evidence custody.

Builder action: reject duplicate Auditor reference/session claims both before
commit and during persisted-state validation.

#### PCL-003 — failure API can retain active writer custody [HIGH]

Evidence: `failWorker` accepts a caller-supplied lease status and the worker
validator does not reject a `FAILED` worker with an `ACTIVE` lease.

Why it matters: a failed lane can remain counted as an active writer, block or
collide with a replacement, and leave the campaign in an unsafe half-failed
state.

Builder action: permit only non-active terminal lease statuses for failure,
require terminal release evidence for failed/repair-required workers, and
validate lease timestamp/reason consistency.

#### PCL-004 — persisted event history has a weak initial anchor [MEDIUM]

Evidence: later events are chained, but a first event may carry a non-null
predecessor and a state with no events may claim a non-prepared status if its
digest is recomputed.

Why it matters: replay cannot prove the beginning of the custody history, so a
crafted or corrupted state can present an invented transition prefix.

Builder action: require the first event to start at
`PREPARED_NOT_ACTIVATED` with a null predecessor; require an empty event list
to retain the prepared state; bind closure timestamps to the terminal status.

#### PCL-005 — failure states have no preserved replacement transition [HIGH]

Evidence: schemas expose `attempt`, `FAILED`, and `REPAIR_REQUIRED`, and the
roadmap requires a repaired replacement, but the lifecycle exposes no repair or
replacement operation. A rejected/failed lane remains blocked indefinitely,
and a retry would have to overwrite the only worker record.

Why it matters: the feature cannot complete its recovery promise without either
discarding the failed evidence or inventing an out-of-band worker. Both violate
custody and append-only history.

Builder action: add an append-only worker history and a deterministic
replacement-attempt transition that preserves the failed worker, mints a fresh
worker reference/attempt, and reopens only when no other failure remains.

#### PCL-006 — Runtime-only merge custody is implicit rather than bound [MEDIUM]

Evidence: governance says intermediate feature checkpoints are not merged and
Runtime is the sole convergence/merge executor, while the parallel plan only
binds lane writable scopes. The feature itself has no content-addressed merge
policy or deterministic terminal convergence order.

Why it matters: a caller can treat a closed lane as merge-ready or choose a
different convergence order without violating the feature record.

Builder action: bind an explicit prepared merge-custody policy to the plan,
including `RUNTIME` ownership, forbidden intermediate merge, terminal-only
convergence, and a deterministic dependency-respecting order. This records the
boundary without performing a merge or activation.

### Cross-cutting audit lenses

- Intent: the accepted source preserves the prepared/inactive status and binds
  goal/source/lineage digests. The missing explicit merge policy is recorded in
  PCL-006.
- Quality/functionality: dependency sorting, cycle rejection, concurrency
  limits, meaningful result types, handoff ordering, and independent audit
  gates are implemented. Recovery and exact expiry remain findings.
- Hygiene/minimality: the core is split into records and lifecycle modules; the
  repeated standalone schema definitions are deliberate for independently
  consumable contracts. No unrelated product code is required. Tests are
  focused but pending execution.
- Security/privacy: session identities are opaque, raw failures are reduced to
  digests, records are checked by the shared privacy scanner, and path-like
  identifiers are rejected. Duplicate Auditor custody remains PCL-002.
- Durability/regression: content digests and compare-and-swap persistence are
  present; initial event anchoring and replacement history need repair.
- Custody/boundary: worker scope exclusion and lease fencing are present, but
  failed active leases and implicit merge custody need repair. The module does
  not itself perform external merge, push, release, or deployment actions.

### Evidence and unknowns

- Evidence reviewed: roadmap campaign promise and status, bootstrap campaign
  plan, architecture boundary, rapid-foundation progress/functionality/
  hygiene/security/evidence/recovery/closure contracts, governance campaign
  cascade and feature-platform workflow, feature inventory, all nine feature
  schemas, both feature modules, and both focused test files.
- The inventory catalog names `research-records-linked-by-owner`, but no
  research-record file is present in the accepted merge tree. This is an
  evidence unknown, not a blocker: the typed feature contracts and governance
  rules are sufficient for this bounded implementation audit, and no private
  research material is inferred.
- Functional execution, host-backed session behavior, actual worktree
  cleanliness, remote equality, merge execution, release, and activation are
  intentionally unverified. They remain pending or outside this task boundary.

### Production readiness at initial audit

`NOT_READY — REPAIR_REQUIRED`. The accepted source is a credible prepared
candidate for the local contract surface, but PCL-001 through PCL-006 prevent a
production candidate. Even after repair, functional tests and independent
host-backed checks remain pending. `2.1rc` remains prepared and inactive.

### True blockers and exact recovery

No genuine external blocker is present. The missing research-record file is an
evidence unknown, not an authority dependency for this bounded feature. The
explicit functional-test hold is a task instruction, not a host capability
failure. Required recovery is: apply only PCL-001 through PCL-006 in this
isolated worktree, run static/schema self-audits without npm, append evidence,
then hand the exact changed paths to the independent functional-test and
host-backed verification step.

## Builder actions recorded

1. Import the accepted feature modules and standalone schemas into the isolated
   worktree, including only the shared content-addressing/privacy support
   required by those modules.
2. Repair PCL-001 through PCL-006 with focused contract changes and preserve
   failed/rejected worker records in append-only history.
3. Keep `2.1rc` prepared but inactive and perform no external merge or release.
4. Add or update focused hostile coverage, but leave functional test execution
   pending as instructed.

Initial audit status: `FINDINGS_RECORDED / BUILDER_ACTIONS_READY`.

## Builder pass and self-audit — 2026-08-07

### Changed files

- `control/content-addressing.mjs`
- `control/persisted-record-privacy.mjs`
- `control/parallel-campaign-records.mjs`
- `control/parallel-campaign-lifecycle.mjs`
- `schemas/parallel-campaign-audit.v1.json`
- `schemas/parallel-campaign-event.v1.json`
- `schemas/parallel-campaign-failure.v1.json`
- `schemas/parallel-campaign-handoff.v1.json`
- `schemas/parallel-campaign-lease.v1.json`
- `schemas/parallel-campaign-plan.v1.json`
- `schemas/parallel-campaign-progress.v1.json`
- `schemas/parallel-campaign-state.v1.json`
- `schemas/parallel-campaign-worker.v1.json`
- `tests/verify-parallel-campaign-contract.mjs`
- `tests/verify-parallel-campaign-lifecycle.mjs`

The two shared support modules are required by the accepted feature source;
they remain project-agnostic. No canonical orchestration, provider, release,
or unrelated product surface was changed.

### Repairs applied

| Finding | Repair | Result |
| --- | --- | --- |
| PCL-001 | Lease operations now require `now < expires_at_utc`; expiration fences at `now >= expires_at_utc`. | Resolved in lifecycle custody checks. |
| PCL-002 | Accepted Auditor references and sessions are unique across current and historical lane audits, with pre-commit rejection. | Resolved in lifecycle and state validation. |
| PCL-003 | Failed workers can only receive `RELEASED`, `EXPIRED`, or `FENCED` leases; lease timestamps/reasons are mutually consistent; failed states cannot retain active custody. | Resolved in failure and lease validation. |
| PCL-004 | First event must have a null predecessor and prepared root status; empty state history must remain prepared; closure time must match closed status. | Resolved in replay validation. |
| PCL-005 | State now preserves `worker_history`; `repairWorker` records the failed/rejected attempt and creates the next contiguous attempt without reusing its worker or lease identity. | Resolved in recovery transition. |
| PCL-006 | Plans now carry a sealed Runtime-owned merge-custody policy, forbid intermediate merges, bind terminal-only convergence, and compile a dependency-respecting order; state binds its policy digest. | Resolved without performing merge or activation. |

### Self-audit evidence

- All six JavaScript modules/test files pass syntax parsing.
- All nine JSON Schemas parse; each root rejects unknown properties, required
  fields match declared properties, and object definitions reject unknown
  nested fields.
- The feature source contains no absolute machine paths, private links,
  credentials, provider tokens, or chat links.
- The source diff is limited to the feature, its required shared serializer/
  privacy support, its schemas/tests, and this report. No external command,
  push, merge, release, deployment, or activation was performed.
- Focused tests were updated for exact expiry, active-failure fencing,
  replacement history, merge custody, and duplicate Auditor identity, but
  execution remains pending by instruction.

### Self-audit result

`SELF_AUDIT_PASS_STATIC`. No new implementation finding was introduced. The
JSON Schemas intentionally express structural constraints; stateful ordering,
lease-time, custody, and digest relationships remain enforced by the paired
runtime validators and are covered by the pending focused tests.

## Re-audit — 2026-08-07

The repaired source was re-read against the roadmap, governance campaign
cascade, feature-platform workflow, inventory entry, schemas, and initial
finding list. PCL-001 through PCL-006 are resolved in the isolated worktree.
The feature remains host-neutral and prepared/inactive: it records the
Runtime-only merge boundary but does not execute a merge, create a worktree,
spawn a provider session, publish, deploy, release, or activate `2.1rc`.

### Remaining findings and evidence status

1. Functional execution of `tests/verify-parallel-campaign-contract.mjs` and
   `tests/verify-parallel-campaign-lifecycle.mjs` is pending by task
   instruction. Recovery: the independent checker runs both directly with the
   repository's supported runtime, without npm, and records the exact result.
2. Host-backed session/worktree cleanliness, remote equality, and actual
   Runtime convergence remain outside this host-neutral feature audit.
   Recovery: bind the exact host adapter and independent Runtime evidence in a
   separately admitted integration check; do not infer it from this report.
3. The inventory's owner-linked research record remains unavailable in the
   accepted tree. It is an evidence unknown only; no private research is
   synthesized and no implementation decision depends on it.

These are pending evidence or scope boundaries, not unresolved repair findings
and not genuine external blockers.

### Final production readiness

`PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_AND_HOST_CHECKS` for the prepared
local contract surface. The implementation is not a production activation or
release claim. `2.1rc` remains `PREPARED_NOT_ACTIVATED`.

### Final blocker and handoff

True blockers: `NONE`.

Next action: pass the exact changed paths and this report to an independent
functional-test and host-backed custody checker. That checker must execute the
pending focused tests, verify replacement/history replay and merge-custody
boundaries on the exact source tree, and record `PASS`, `FAIL`, or
`UNAVAILABLE`; it must not merge, release, deploy, or activate anything.

Final audit status: `FINISHED / PRODUCTION_CANDIDATE_PENDING_TESTS`.
