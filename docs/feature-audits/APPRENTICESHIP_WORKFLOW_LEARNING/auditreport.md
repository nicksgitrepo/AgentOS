# APPRENTICESHIP_WORKFLOW_LEARNING audit report

Feature: `APPRENTICESHIP_WORKFLOW_LEARNING`  
Name: Apprenticeship, Drill, Reproduction, and Role Packet Learning  
Authority baseline: current accepted merge worktree, source checkpoint `590c07d`  
Audit posture: `INITIAL_AUDIT_RECORDED / OPEN_REPAIR`  
Activation posture: `PREPARED_NOT_ACTIVATED`

## Audit contract

This report is append-only. It records the initial audit, builder repairs,
self-audit, and re-audit in order. The feature remains inactive throughout;
technical completion cannot activate learned policy or change owner intent.
Functional tests and live host execution remain pending by task instruction.

## Intended behavior

The roadmap promises a privacy-safe, evidence-bound learning loop:

`observed demonstration -> workflow reconstruction -> proposed gate source and
role packet -> fresh smaller-worker reproduction -> independent comparison ->
separate owner decision`

The teacher record contains observable actions and results only. The reusable
packet is deterministic, least-privilege, revocable, bounded to the admitted
task, and explicit about tools, evidence, failure/recovery paths, privacy, and
`DONE WHEN`. A fresh worker must not receive the demonstration transcript,
hidden reasoning, private context, or unrelated project material. A Workflow
Auditor drills the source-bound questions, an independent Auditor compares the
fresh result, and an owner decision remains separate from activation.

## Authority and intent readback

Read before mutation:

- `docs/roadmap.md`, especially capability 11, phase 5, deliberate deferral,
  and the roadmap status rules;
- `docs/feature-inventory.v1.json`, which identifies this feature as a named
  capability with source roots in `schemas/apprenticeship-admission.v1.json`,
  `schemas/apprenticeship-reproduction.v1.json`, and
  `control/apprenticeship-drill.mjs`;
- `docs/architecture.md`, `governance/2.1rc/feature-platform-workflow.md`,
  and the applicable foundation contracts for role routing, evidence and
  identity, security and privacy, code hygiene, recovery and boundaries, and
  delivery and closure;
- all apprenticeship schemas and contract manifests in `schemas/`, including
  admission, observation, reconstruction, proposal, drill, role packet,
  native run, reproduction, independent review, owner decision, handoff,
  evidence attestation, record envelope, and state transition;
- the authoritative controls in `control/apprenticeship-common.mjs`,
  `control/apprenticeship-contract-hardening.mjs`,
  `control/apprenticeship-observation.mjs`,
  `control/apprenticeship-drill.mjs`,
  `control/apprenticeship-role-packet.mjs`,
  `control/apprenticeship-native-runner.mjs`, and
  `control/apprenticeship-reproduction.mjs`;
- the focused verifier sources in `tests/verify-apprenticeship-contracts.mjs`,
  `tests/verify-apprenticeship-contract-hardening.mjs`, and
  `tests/verify-apprenticeship-native-observation.mjs`.

No owner-linked research record or research directory is present in the
accepted merge source. This is an evidence unknown, not an external blocker;
the implementation must remain bounded by the recorded roadmap and schemas.

## Actual implementation found in the authoritative source

The accepted source contains a coherent prepared slice:

- common deterministic canonicalization, digests, provenance, protected-action
  defaults, portable-record scanning, and state transitions;
- task observation classification that distinguishes meaningful results from
  heartbeat, waiting, failure, blocker, review, and no-result outcomes;
- observable workflow reconstruction, proposed gate source, and proposed role
  behavior;
- an eight-question Workflow Auditor drill with host lifecycle receipts,
  ordered answers, repair/reopen, non-accepting closure, and roster absence;
- a worker role packet requiring a native external host attachment and
  forbidding local-process or synthetic-receipt fallbacks;
- native host observation with source readback, host evidence attestations,
  handoff digests, closure, and active-roster readback;
- a fresh reproduction packet/result, distinct independent review, separate
  owner decision, and typed handoff; and
- inactive strict schemas plus hardening validators for admission, evidence,
  persisted envelopes, and state transitions.

The focused verifier sources cover the happy path and hostile cases, but they
are not executed in this audit because functional tests remain pending by
instruction.

## Initial findings

### F-001 — Accepted feature slice is absent from the writable candidate

Status: `OPEN / BUILDER ACTION`  
Severity: production-blocking for this candidate  
Evidence: the authoritative source contains the feature controls, schemas,
and verifiers listed above; the isolated checkout at `590c07d` does not contain
those feature files or their native-host boundary dependencies.

Why it matters: no feature candidate can be independently checked or handed
off from the writable worktree while the authoritative implementation remains
only in another worktree.

Repair: port only the feature slice, its direct native-host/content-addressing
dependencies, its schemas, and its focused verifier sources into this worktree.
Keep unrelated accepted-merge changes out of scope.

### F-002 — Native observation dispatches the bounded task twice

Status: `OPEN / BUILDER ACTION`  
Severity: high  
Evidence: `control/apprenticeship-native-runner.mjs` supplies the task as the
`create_thread` prompt and then sends the same `taskInstruction` again before
waiting.

Why it matters: a fresh worker can perform the admitted task twice, causing
duplicate work, non-deterministic outcomes, and misleading progress/evidence.

Repair: keep one bounded task dispatch through thread creation and retain the
later explicit send only for the typed-handoff request; update the canonical
native lifecycle expectation and focused hostile coverage accordingly.

### F-003 — Native-run validation accepts malformed lifecycle order or duplicates

Status: `OPEN / BUILDER ACTION`  
Severity: high  
Evidence: `validateApprenticeshipNativeRun` checks that each operation appears
somewhere, but does not require the canonical sequence, receipt count, or
operation multiplicity. A recomputed-digest record can therefore carry an
invalid lifecycle while passing the validator.

Why it matters: native host custody and closure are the evidence root for this
feature. Accepting an out-of-order or incomplete readback weakens source,
handoff, and zero-active-roster guarantees.

Repair: validate the exact post-repair lifecycle sequence and bind the receipt
set to the required close/readback order.

### F-004 — Drill records and closure do not fully bind identity and coverage

Status: `OPEN / BUILDER ACTION`  
Severity: high  
Evidence: answered question/comparison records validate reference shape but do
not bind their learner and Auditor references to the drill provenance. The
closed-state coverage check allows a closed record to bypass the current-index
versus answered-question equality, and lifecycle validation requires at least
one host send/wait/read rather than per-question ordered coverage.

Why it matters: a forged or recomputed drill could report the right eight IDs
while changing actors, omitting question-specific host evidence, or carrying a
closed state inconsistent with its answers.

Repair: enforce provenance bindings, exact answered coverage for every closed
final status, and ordered per-question host send/wait/read receipts. Reject
additional work after a terminal drill result.

### F-005 — Reproduction success is not fully evidence- and observation-bound

Status: `OPEN / BUILDER ACTION`  
Severity: high  
Evidence: successful reproduction gate responses may omit per-gate evidence;
the validator does not require the observation's meaningful-result status to
match the reproduction status, and action records are not required to be
source/scope matched. These fields can be changed together with a new digest
without violating the current checks.

Why it matters: the roadmap requires a meaningful source-bound result,
complete gate responses, matching evidence, and a typed handoff before a
reproduction can refine a candidate.

Repair: require evidence for every successful gate, bind reproduction status
and progress to the nested observation, and reject mismatched action records.

### F-006 — Admission revalidation can bypass the host-attestation gate

Status: `OPEN / BUILDER ACTION`  
Severity: high  
Evidence: compilation requires an attestation for `ADMITTED`, but
`validateApprenticeshipAdmission` only checks that two opaque references are
non-null. A directly reconstructed admission with a valid digest can omit the
attestation object and still validate.

Why it matters: admission is the boundary that prevents a synthetic or
unavailable host from becoming an admitted learning run.

Repair: make admitted-record validation require and revalidate the bound host
attestation, including its exact digest reference and base provenance binding.

### F-007 — Role-packet least privilege is not closed over protected actions

Status: `OPEN / BUILDER ACTION`  
Severity: high  
Evidence: custom role behavior can omit protected-action prohibitions and can
declare arbitrary authority identifiers. The current validator requires a
small prohibition list but does not reject authority that grants protected
actions or require the complete protected-action prohibition set.

Why it matters: the packet is reusable governance projection, not authority.
Any missing prohibition can turn a learned packet into an accidental route to
acceptance, deletion, spending, publication, secrets, or external effects.

Repair: require the canonical protected-action prohibition set and reject
authority declarations that name protected operations.

## Cross-cutting audit lenses

- Production readiness: `NOT READY` before F-001 through F-007 repairs; the
  final candidate remains inactive and pending functional/native-host checks.
- Quality and hygiene: the feature is split into clear contract modules and
  focused verifiers; F-002 is a concrete duplication defect, and F-003/F-004
  are validator minimality defects.
- Minimality: only the feature slice and direct host-boundary prerequisites are
  admitted for repair; unrelated accepted-merge files are protected unchanged.
- Security and privacy: opaque references, portable-record scanning,
  secret/private-path rejection, no raw transcript field, and false protected
  actions are positive evidence. F-005 through F-007 remain boundary risks.
- Durability: content-addressed records and predecessor/evidence fields are
  present. F-003/F-004 must be repaired before lifecycle custody is durable.
- Regression: existing focused hostile verifiers cover activation, private
  context, synthetic receipts, skipped drill questions, missing evidence, and
  self-review. New regression cases are required for each recorded finding.
- Custody: native attachment is mandatory and local-process fallback is false;
  F-003 and F-004 currently leave malformed custody records admissible.
- Boundary: owner approval and activation are separate and inactive. No
  publication, push, merge, deployment, authentication, spending, deletion,
  or external side effect is authorized by this audit.
- Intent: the implementation matches the planned inactive learning loop, but
  no research record or live host evidence is available to strengthen the
  roadmap's production claim.

## True blockers and recovery

No genuine external blocker is established. Missing live host evidence and
functional test execution are explicit task constraints/pending checks, not a
reason to stop ordinary source repair. If a later live check cannot obtain an
admitted external host attachment, exact source readback, or zero-active-roster
readback, classify that result as a typed boundary failure and recover by
binding the required host capability and rerunning the focused native check;
never substitute a local process or synthetic receipt.

## Builder actions

1. Port the authoritative feature slice and direct dependencies into this
   worktree (F-001).
2. Remove duplicate task dispatch and strengthen native-run lifecycle
   validation (F-002/F-003).
3. Harden drill actor binding, question-specific lifecycle coverage, terminal
   closure, and no-post-terminal mutation (F-004).
4. Harden reproduction gate evidence and nested observation/result binding
   (F-005).
5. Harden admission attestation revalidation and role-packet protected-action
   least privilege (F-006/F-007).
6. Add focused hostile regression cases without running the functional suite.
7. Perform a static self-audit and re-audit the exact changed source, then
   append resolved findings, remaining pending checks, and the next action.

## Initial handoff

The audit is complete enough to authorize the bounded builder pass. The next
action is to port F-001, then repair only F-002 through F-007 in dependency
order. No activation or external action is part of this handoff.

## Builder pass 1 and self-audit

Pass status: `REPAIRED / STATIC_REAUDIT_IN_PROGRESS`

F-001 is resolved in this isolated candidate. The feature controls, direct
native-host/content-addressing dependencies, schemas, focused verifiers, and
this report are now present without importing unrelated accepted-merge files.

The first repair pass also addressed F-002 through F-007:

- native observation now dispatches the bounded instruction once at thread
  creation, then uses the later send only for the typed handoff request;
- native-run validation requires the exact ten-receipt lifecycle and one
  evidence-attestation reference per receipt;
- drill records bind learner and Auditor identities to drill provenance,
  require exact accepted coverage, enforce ordered question-bound host
  triplets while permitting only an incomplete current triplet during open
  recording, and prohibit new work after a terminal result except cleanup;
- reproduction gate answers marked `ANSWERED` require evidence and a digest;
  successful reproduction requires a meaningful nested observation and
  source/scope-matched action records; packet gate coverage and provenance are
  exact;
- admitted-record validation now requires the host attestation object and
  exact `digest:` binding, external-host authority, worker subject/session, and
  base provenance; and
- role packets require the expanded protected-action prohibition set and reject
  protected actions in role authority.

Static evidence for this pass: all five repaired control modules and both
native-host modules pass syntax checking; no functional verifier or live host
run was executed, as required. The focused verifiers were extended with
admission revalidation and protected-authority hostile cases.

### F-008 — Portable host contract hardcodes provider/model identity

Status: `OPEN / BUILDER ACTION`  
Severity: medium, portability and governance hygiene

Self-audit evidence: the accepted native-host dependency supplied a concrete
provider/model string as the default persisted attachment model. This violates
the repository boundary that product context must arrive through typed project
configuration rather than the portable kernel.

Why it matters: a default model identifier couples the reusable host contract
to one provider context and can silently create a false custody record when the
actual host configuration differs.

Repair: remove the provider/model default and require an explicit model value
from the typed host-attachment configuration. Keep the generic reasoning
default only because it is not a provider identity.

## Builder pass 2 and re-audit

Pass status: `REPAIRED / FINAL_STATIC_REAUDIT_PENDING`

F-008 is repaired: the host attachment compiler now requires `model` at the
typed call boundary, and the portable host contract no longer names a
provider/model. Functional tests, live host custody, and any activation
decision remain pending and inactive.

## Final self-audit and re-audit

Final status: `FINISHED / PRODUCTION_CANDIDATE_PENDING_REQUIRED_CHECKS`

All recorded findings F-001 through F-008 are resolved in the isolated
candidate. The final schema re-audit also aligns the strict native-run schema
with the ten-operation sequence and one-attestation-per-receipt rule, and
aligns the role-packet schema with the protected-action deny-list and complete
prohibition set. The drill and reproduction metadata now state their repaired
coverage and evidence rules.

Changed scope is limited to the feature slice, its direct portable
native-host/content-addressing dependencies, focused verifier sources, strict
feature schemas, and this append-only audit report. No unrelated project file,
activation record, owner decision, provider account, credential, secret,
private machine path, private link, or chat link was added.

Static evidence:

- all feature controls, direct dependencies, and focused verifier sources pass
  `node --check`;
- all 19 feature/native-host/privacy JSON documents parse successfully;
- the feature contract barrel imports successfully; and
- the final scope scan contains no concrete provider/model default, credential,
  private machine path, or private link.

Functional verifiers and live external-host execution remain pending exactly as
required by the task. These are pending checks, not a genuine blocker and not
evidence for activation. The candidate is not activated, and `2.1rc` remains
prepared but inactive.

Remaining findings: no unresolved code finding. Pending checks are the three
focused functional verifiers, a real external-host attachment/readback run,
and independent review of those results.

Exact next action: run the focused verifiers in the isolated candidate without
`npm`; then, with an externally bound host attachment, execute the native
observation readback and confirm the zero-active-roster receipt. If a check
fails, append the evidence and repair only that recorded finding. If the host
cannot provide the required authority, record the typed boundary failure and
recover by attaching the required host; do not substitute local or synthetic
receipts. Keep owner activation as a separate explicit decision.

## Final handoff

The audit → repair → self-audit → re-audit cycle is complete. The candidate is
ready for the explicitly pending functional and live-host checks, with no
activation implied. This report is the authoritative handoff for the feature
candidate.

## Changed files and evidence index

Controls: `control/apprenticeship-common.mjs`,
`control/apprenticeship-contract-hardening.mjs`,
`control/apprenticeship-contracts.mjs`, `control/apprenticeship-drill.mjs`,
`control/apprenticeship-native-runner.mjs`,
`control/apprenticeship-observation.mjs`,
`control/apprenticeship-reproduction.mjs`,
`control/apprenticeship-role-packet.mjs`, `control/content-addressing.mjs`,
`control/native-host-attachment.mjs`, `control/native-host-contract.mjs`, and
`control/persisted-record-privacy.mjs`.

Schemas: the 16 `schemas/apprenticeship-*.json` contracts plus
`schemas/native-host-attachment.v1.json`,
`schemas/persisted-record-privacy.v1.json`, and
`schemas/workflow-auditor-drill.v1.json`.

Focused verifiers: `tests/verify-apprenticeship-contracts.mjs`,
`tests/verify-apprenticeship-contract-hardening.mjs`, and
`tests/verify-apprenticeship-native-observation.mjs`.

Audit artifact: this file. Evidence is limited to static checks until the
explicitly pending functional and live-host checks are run.
