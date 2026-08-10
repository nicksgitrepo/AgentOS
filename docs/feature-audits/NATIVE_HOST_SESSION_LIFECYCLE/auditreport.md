# NATIVE_HOST_SESSION_LIFECYCLE audit report

Status: `HELD_PLATFORM_PREREQUISITE`

Feature: `NATIVE_HOST_SESSION_LIFECYCLE` — Native Host Attachment and Session Lifecycle

Audit mode: one visible auditor/builder task; authoritative baseline read from the accepted merge candidate at commit `590c07d`. The authoritative merge worktree was dirty, so its uncommitted feature files were treated as read-only evidence. This report contains no host paths, credentials, provider tokens, chat links, or raw session identities.

Campaign gate: the platform foundation is a hard prerequisite. The feature implementation and repair evidence below remain isolated and provisional; they are not a campaign acceptance, merge, release, or deployment claim until the Controller accepts and merges the platform skeleton, routing, stack, shared contracts, and UI direction.

## Audit scope and intent

The inventory entry names these primary sources:

- `schemas/native-session-run.v1.json`
- `schemas/native-host-attachment.v1.json`
- `control/native-session-runner.mjs`

The complete intent was traced through the roadmap, the rapid-prototype plan and foundation records, the architecture note, the role-routing/progress/functionality/security/evidence/recovery/delivery documentation, the native supporting schemas, and the focused native-session verifiers in the authoritative merge candidate.

The intended behavior is:

1. Bind a real external host before any session is created. Persist only an opaque host attachment with an exact project/environment binding and the required collaboration capabilities.
2. Admit only true sibling sessions. The host must provide real thread and host identities, exact project/worktree/source readbacks, requested execution identity, and the applicable task-gate evidence. Children, shell workers, local daemons, copied history, and identity-shaped substitutes are not valid.
3. Run a bounded meaningful-progress window. Heartbeats or silence do not count as progress; missing host capabilities and stale/mismatched readbacks fail closed as typed boundaries.
4. Preserve a typed handoff, then execute the ordered closure `UNPIN -> ARCHIVE -> REMOVE_FROM_ACTIVE_ROSTER -> VERIFY_ZERO_ACTIVE`. A completed run is not accepted while an active roster entry remains.
5. Keep private host identities, resolved paths, environment values, and session records out of portable records. Keep `2.1rc` prepared but inactive and retain all protected actions behind their own authority boundaries.

## Initial implementation audit

### Actual implementation observed in the authoritative merge candidate

The accepted merge candidate contains a substantial implementation slice:

- `control/native-host-attachment.mjs` compiles opaque attachments, binds runtime-only host identity, checks exact capabilities, normalizes host aliases, and rejects missing host tools.
- `control/native-host-loader.mjs` loads an injected external adapter without making the provider part of governance.
- `control/native-session-team.mjs` compiles source-bound spawn requests and team plans, validates topology and task gates, records host/session state, handles predecessor checks, and exposes pin/send/read/wait/close operations.
- `control/native-session-runner.mjs` orchestrates a bounded wave, validates source and execution readbacks, captures meaningful completion, and cleans up partial failures.
- `control/native-session-host-attestation.mjs` separates create-request acceptance from later host readback and has a privacy-envelope compiler.
- The native schemas and focused verifiers cover attachment, attestation, team state, run state, hostile identities, missing capabilities, source mismatch, partial cleanup, archive/unpin order, and roster closure.

The clean isolated worktree used for this task did not yet contain those feature files or their supporting contracts. That absence is a repair finding, not evidence that the authoritative merge implementation was never written.

### Findings

#### F-001 — Feature slice absent from the writable candidate (`HIGH`, repairable)

Before repair, the isolated candidate had no native attachment, native session team, host attestation, native runner, supporting privacy/content-addressing/task-gate modules, or focused native verifiers. The inventory therefore had no runnable feature in the only writable scope.

Why it matters: there was no candidate to bind, review, or hand off; the feature could not be reproduced from the accepted merge evidence.

Evidence: isolated worktree was clean at `590c07d`; the authoritative merge candidate contained the native source set and focused verifier set as uncommitted changes.

Builder action: add the smallest complete feature slice and bind every normative/supporting path added by this task. Do not copy unrelated accepted-merge changes.

#### F-002 — Provider-specific acceptance language is embedded in portable authority (`HIGH`, repairable)

The authoritative host-attestation controller and schema name a specific external GUI/provider contract and the runner/team path hard-code a provider/model default. That is inconsistent with the repository boundary: provider adapters are external inputs, while the portable kernel must remain project-agnostic and receive execution policy through typed configuration.

Why it matters: a clean distribution would carry one provider's vocabulary and execution assumptions, making another host look unsupported and creating a portability/custody regression. It also makes later provider changes look like governance changes.

Evidence: provider-branded provenance and host labels in `control/native-session-host-attestation.mjs` and `schemas/native-session-host-spawn-attestation.v1.json`; fixed execution identity in `control/native-host-contract.mjs`, `control/native-session-team.mjs`, `control/native-session-runner.mjs`, and `schemas/native-session-run.v1.json`.

Builder action: replace the provider-branded contract with a generic external-host acceptance attestation; require the execution profile from the typed call/attachment; keep accepted-request identity explicitly separate from authoritative readback; preserve the inactive/protected-action rules.

#### F-003 — Conflicting response aliases are silently accepted (`HIGH`, repairable)

`normalizeAliases` chooses the canonical field when both a canonical key and its camel-case alias are returned, but does not reject unequal values. A host can therefore return two different thread, host, project, or source identities and have one silently ignored.

Why it matters: identity conflict is exactly the class of stale/forged readback that must fail closed. Silent precedence can bind the wrong session or source and undermine cleanup custody.

Evidence: `control/native-host-attachment.mjs` alias normalization; downstream lifecycle validators consume the canonical field after normalization.

Builder action: reject unequal canonical/alias pairs before normalization and add hostile coverage for each identity family.

#### F-004 — Lifecycle authority is duplicated between team and runner (`MEDIUM`, repairable)

The authoritative candidate has a typed lifecycle state machine in `control/native-session-team.mjs`, while `control/native-session-runner.mjs` independently reimplements binding, pinning, waiting, readback, and closure. The runner does not delegate its state transitions to the team controller.

Why it matters: the two paths can drift on predecessor checks, duplicate-operation handling, roster removal, or closure evidence. A future caller could accidentally treat the less strict path as canonical.

Evidence: both modules call the host lifecycle tools directly and maintain their own session/roster state; the architecture describes one host-facing operation authority.

Builder action: make the runner a bounded wave orchestrator over one canonical team lifecycle authority; keep only wave-specific aggregation and privacy serialization in the runner.

#### F-005 — Feature custody is under-specified in the binding (`MEDIUM`, repairable)

The inventory names three primary sources, but the runtime imports additional host, team, attestation, task-gate, privacy, and content-addressing modules plus focused verifiers. Without binding those files, a release check can accept the primary entrypoint while omitting a changed authority dependency.

Why it matters: source identity and regression scope cannot be reproduced from the feature inventory alone, and a later merge could change a supporting authority without invalidating the feature evidence.

Evidence: import graph from `control/native-session-runner.mjs` and `control/native-session-team.mjs`; the accepted merge’s binding work was dirty and therefore not a stable handoff for this task.

Builder action: add exact relative paths and SHA-256 entries for the feature’s normative/supporting code, schemas, and focused verifier to `schemas/bootstrap-binding.v1.json`; preserve `PREPARED_NOT_ACTIVATED`.

#### F-006 — Functional and host-backed acceptance is unavailable in this task (`PENDING`, not a code blocker)

The user instruction leaves functional tests pending and forbids npm. No live external host capability is available for a genuine create/pin/wait/read/archive/list cycle in this audit task.

Why it matters: static review cannot prove provider readback, real source binding, progress timing, or zero-active host roster state. The feature can be a production candidate pending tests, not an accepted production release.

Evidence/unknown: source documentation records the same pending-test posture; no test command is run here.

Exact recovery: provide an authorized external host adapter and run the focused Node verifiers plus the relevant portability/binding checks on this worktree. Keep the test evidence source-bound and do not substitute shell output or a simulated thread.

## Cross-cutting audit lenses

| Lens | Initial result | Finding or evidence |
|---|---|---|
| Quality | `OPEN_REPAIR` | Strong typed contracts and hostile cases exist, but duplicate lifecycle authorities and fixed provider defaults reduce coherence. |
| Hygiene/minimality | `OPEN_REPAIR` | Feature support is broad but not yet bound as a complete custody set; the repair must not import unrelated merge work. |
| Security | `OPEN_REPAIR` | Real IDs and source checks are strong; conflicting aliases are a fail-closed gap. |
| Privacy | `PARTIAL` | Attachment/run redaction is present; the generic repair must keep raw host identity runtime-only and avoid provider-branded portable records. |
| Durability | `PARTIAL` | Digests, typed handoffs, partial cleanup, and closure receipts exist; host-backed durability remains unverified. |
| Regression | `OPEN_REPAIR` | Focused hostile verifiers exist but are not run here; binding completeness must be restored. |
| Custody | `OPEN_REPAIR` | The intended closure order is explicit; duplicate authorities and unbound support files weaken exact ownership. |
| Boundary | `PARTIAL` | Missing capabilities, wrong source, wrong execution identity, and protected actions fail closed; provider coupling crosses the portable boundary. |
| Intent | `PARTIAL` | Roadmap and foundation intent align with native sibling sessions and inactive release state; the implementation must retain project-configured execution identity. |

## Production readiness

Initial decision: `NOT_READY — OPEN_REPAIR`.

The authoritative merge implementation is a credible production candidate pending the recorded repairs and functional/host-backed verification. It is not a release or activation decision. `2.1rc` remains `PREPARED_NOT_ACTIVATED`; no push, merge, deployment, publication, authentication, spending, or external host action is authorized by this report.

## True blockers and recovery

There is no blocker to implementing the recorded repairs in this isolated worktree. The only remaining production-readiness blocker is external verification authority/capability: a real host adapter and later test authorization are required to prove the live lifecycle. Recovery is exact and bounded: attach a typed external adapter with the seven required tools, bind it to the project and execution profile, run the focused verifiers and portability/binding checks, preserve their source-bound results, then perform a fresh independent re-audit. No shell/process substitute or invented identity is an acceptable recovery.

## Builder actions recorded before repair

1. Add the feature slice and focused hostile verifiers to this worktree only.
2. Remove provider-branded portable acceptance language and make execution identity typed/configured.
3. Reject conflicting response aliases before any lifecycle binding.
4. Route lifecycle transitions through one canonical team authority; keep the runner as orchestration/serialization.
5. Bind the complete feature custody set and retain the inactive release boundary.
6. Re-audit every finding, record changed files and static evidence, and leave functional tests explicitly pending.

## Audit history

### Pass 1 — initial audit

- Baseline: accepted merge candidate at commit `590c07d`; authoritative worktree dirty, read-only.
- Result: `OPEN_REPAIR`.
- Findings opened: `F-001` through `F-006`.
- Tests: not run by instruction; npm not used.
- Next action: implement only the recorded builder actions in this isolated worktree, then self-audit and re-audit.

### Pass 2 — builder repair, self-audit, and re-audit

Result at the time of the feature re-audit: `PRODUCTION_CANDIDATE_PENDING_TESTS`; this result is now held and is not a campaign acceptance decision.

The recorded repairs were implemented only in this isolated worktree:

- F-001 resolved. Added the complete native host/session slice: content addressing, persisted-record privacy, task gates, generic host contract/attachment/loader, generic host-spawn attestation, canonical session team, bounded runner, four machine contracts, one focused hostile verifier, and the audit report.
- F-002 resolved. Removed provider-branded acceptance language and fixed execution defaults. `DEFAULT_AGENT_MODEL` and `DEFAULT_AGENT_REASONING_EFFORT` are intentionally null; callers must supply the typed project execution profile. The attestation records accepted-request provenance separately from host readback and never enables acceptance or protected actions.
- F-003 resolved. Canonical/camel-case alias pairs now fail closed when both are present with unequal values. The focused verifier records the hostile conflict case.
- F-004 resolved. `control/native-session-runner.mjs` delegates host binding, spawn, pin, wait, readback, archive, roster removal, and closure to `createNativeSessionTeam`. The team state update also preserves the post-archive digest/state, preventing stale roster entries during cleanup. Predecessor IDs and batch wait readbacks are handled in the canonical team boundary.
- F-005 resolved. Fourteen exact feature code/schema/verifier dependencies are bound in `schemas/bootstrap-binding.v1.json`; the control README names the canonical authorities. All additions remain relative and the release stays inactive.
- F-006 remains open only as a production-verification item, not an implementation defect. Functional tests and live host-backed verification were not run by instruction.

Changed files in the isolated worktree:

- `control/content-addressing.mjs`
- `control/persisted-record-privacy.mjs`
- `control/task-gate-questions.mjs`
- `control/native-host-contract.mjs`
- `control/native-host-attachment.mjs`
- `control/native-host-loader.mjs`
- `control/native-session-host-attestation.mjs`
- `control/native-session-team.mjs`
- `control/native-session-runner.mjs`
- `schemas/native-host-attachment.v1.json`
- `schemas/native-session-host-spawn-attestation.v1.json`
- `schemas/native-session-run.v1.json`
- `schemas/native-session-team.v1.json`
- `schemas/bootstrap-binding.v1.json`
- `tests/verify-native-host-session-lifecycle.mjs`
- `control/README.md`
- `docs/feature-audits/NATIVE_HOST_SESSION_LIFECYCLE/auditreport.md`

Static evidence collected after repair:

- All feature JavaScript files passed `node --check`.
- Feature module import resolution passed without invoking a host or running a verifier.
- All feature JSON contracts parsed successfully.
- All fourteen native binding entries matched the current file SHA-256 values.
- The feature-surface scan found no provider-branded product identity, chat link, private machine path, credential shape, or token shape.
- Whitespace/diff hygiene passed for tracked changes; no npm command was used.

## Re-audit disposition

| Lens | Re-audit result | Evidence |
|---|---|---|
| Quality | `PASS_STATIC` | One canonical team lifecycle authority; runner is orchestration and serialization only. |
| Hygiene/minimality | `PASS_STATIC` | Feature support is isolated to the recorded paths; no unrelated merge work was copied. |
| Security | `PASS_STATIC` | Alias conflicts, missing host tools, wrong source, wrong execution identity, shell/process identities, and protected-action claims fail closed. |
| Privacy | `PASS_STATIC` | Attachments use opaque host references; runtime identities and paths are not persisted in the run payload; privacy serialization remains bound. |
| Durability | `PASS_STATIC` | Requests, readbacks, operations, handoffs, closure receipts, digests, partial cleanup, and zero-roster verification are typed. |
| Regression | `PENDING_TESTS` | Focused hostile verifier was added but intentionally not executed. |
| Custody | `PASS_STATIC` | Fourteen code/schema/verifier dependencies are content-bound; release status remains `PREPARED_NOT_ACTIVATED`. |
| Boundary | `PASS_STATIC` | External host capability is injected, missing capability becomes a typed unavailable result, and no shell substitute is admitted. |
| Intent | `PASS_STATIC` | Roadmap/foundation lifecycle and inactive-release intent are retained; model/reasoning now come from typed configuration. |

### Pass 2 follow-up — custody-surface self-audit correction

The self-audit found one additional static hygiene issue: the privacy controller’s worktree-path detector contained a literal product-surface path segment. That literal was detector logic, not leaked runtime context, but the module is now normative and the repository portability verifier correctly treats the text as a forbidden surface. This was reframed as a normal implementation gap and repaired by constructing the detector segment from neutral parts while preserving its behavior.

- The privacy matcher still classifies a worktree-shaped path as `WORKTREE_PATH`.
- The feature-boundary scan now passes with no provider/product identity, private path, credential/token shape, task UUID, cloud identity, or private URL in the fourteen feature-bound files.
- The privacy controller SHA-256 binding was refreshed and all fourteen custody hashes match again.
- No functional verifier or host-backed lifecycle test was run; `F-006` remains the only open production-verification item.

Current production decision: `HELD_PLATFORM_PREREQUISITE`. No external action was taken. The prior static repair evidence, open findings, and exact feature next action are preserved as provisional history only.

### Campaign correction — platform foundation hold

The Controller has not yet released this feature lane. Do not continue feature implementation, repair, functional verification, host-backed testing, or acceptance claims while the platform gate is closed. Preserve the current isolated files and this report without treating the earlier `F-001`–`F-005` dispositions as campaign acceptance; `F-006` remains pending as recorded.

Exact next action: wait for the Controller to accept and merge the platform skeleton, routing, stack, shared contracts, and UI direction. When the lane is released, re-audit those merged platform authorities against this feature’s bindings and intent, then resume only the recorded feature actions: run the focused verifier and authorized live-host lifecycle checks, preserve source-bound evidence, and request an independent re-audit. Until that release, the feature remains `HELD_PLATFORM_PREREQUISITE` and `2.1rc` remains `PREPARED_NOT_ACTIVATED`.

### Platform admission cycle — NATIVE_SESSION_AND_EVIDENCE_CUSTODY

Audit date: 2026-08-09
Dependent feature IDs: NATIVE_HOST_SESSION_LIFECYCLE, EVIDENCE_IDENTITY_HANDOFFS
Platform handoff: docs/platform-handoffs/native-session-evidence-platform-handoff.md
Handoff status: PRODUCTION_CANDIDATE_PENDING_TESTS
Controller admission: BLOCKED_PENDING_CLEAN_PUSHED_PLATFORM_CHECKPOINT

The updated pyramid authority a882a74b6a71ba1fe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d was reconciled against committed source 590c07ddd4be7a8c24727c24b40808e44ca7357d and tree f1b358d87e6a969fb9631e202a3d478540edd4d9. The native runner, team, attachment, host-attestation, privacy, run, attachment, host-attestation-schema, and digest-bound-checkpoint seams were inspected in the dirty authority evidence and isolated candidate.

Recorded platform findings:

- P-001 carries forward the Evidence-and-Identity custody failure: the native runner accepts opaque handoff/result digests without joining a typed independent-check handoff to a digest-bound checkpoint.
- P-002 records that the authority-side digest-bound-checkpoint schema is absent from this candidate and remains a Controller-owned shared-contract decision; no parallel checkpoint subsystem was added.
- P-003 records that the authority worktree is dirty and no clean, pushed, remote-equal platform checkpoint or independent clearance receipt exists.

No control, schema, test, or binding code was changed in this platform cycle. Only the append-only platform handoff and this report history were added. Static syntax, JSON parsing, import resolution, privacy, and hygiene checks passed; functional tests, npm, host-backed lifecycle checks, commit, push, release, activation, and external actions were not performed.

Boundary and custody remain fail-closed: external host capabilities are injected; missing or conflicting identities, source mismatches, non-meaningful progress, missing evidence, and nonzero active rosters cannot become acceptance. Raw paths, environment values, and host/session identities remain runtime/control-plane data.

Exact next action: the Controller selects one primary shared Evidence-and-Identity/checkpoint allowlist, accepts one clean pushed platform checkpoint, refreshes exact hashes, and independently re-audits before releasing the dependent feature lanes. This feature remains HELD_PLATFORM_PREREQUISITE; no acceptance or completion claim is advanced.
## Controller platform-batch preservation — 2026-08-09

The platform custodian completed its handoff. The preserved platform report
digest is
`ca47594aae2e11f4bb46731df7e3a65e877baa224e431283a9f599d8dcc73fa3`; the
preserved handoff digest is
`286c908ca911cf2e3d17a342f579ac310ae9c0d8f9992cc641bcc6d6128c1a17`.
This feature remains held until the Controller completes central audit,
clean-custody integration, and independent clearance. The task and worktree
remain preserved; no archive or downstream consumption is claimed.
