# ROADMAP_05_LOCAL_ADAPTERS audit report

## Audit record: initial audit

- Feature: `ROADMAP_05_LOCAL_ADAPTERS` — Local-First Workspace, Host, and
  Provider Adapters.
- Inventory authority: `docs/feature-inventory.v1.json`, whose contract status
  is `PREPARED_NOT_ACTIVATED`.
- Authority used: the current accepted merge candidate, read as a dirty
  development snapshot and not modified by this task.
- Authority `HEAD`: `590c07ddd4be7a8c24727c24b40808e44ca7357d`.
- Authority `HEAD^{tree}`: `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- Writable scope: this isolated feature worktree only.
- Functional-test posture: pending by instruction; no functional acceptance is
  claimed by this report.
- Release posture: `2.1rc` remains prepared and inactive.

This is an append-only audit record. Later repair and re-audit passes are
added below; resolved findings are retained rather than rewritten.

## Source intent reviewed

### Roadmap promise

`docs/roadmap.md` marks capability 5 as `Partial`. The intended local-first
behavior is:

1. operate offline and locally without requiring a provider;
2. access logical workspace locations and Git/provider capabilities through
   checked adapters rather than hard-coded machine assumptions;
3. bind every temporary task to the intended saved project and stop before
   work when project or workspace identity mismatches;
4. register, reopen, reconcile, and operate a project after a new local
   installation without network access;
5. check workspace identity before work and again in the handoff;
6. fail safely on mismatch, detached workspace, unavailable provider, and
   partial failure while preserving evidence; and
7. provide portability evidence and an independent check of project, source,
   adapter, and no-external-effects receipts.

The roadmap explicitly keeps broader logical-location support, provider
certification, and the complete portable-instance contract partial. Remote
provider delivery is not required for the current local prototype and must
not delay local correctness.

### Research and documentation intent

The relevant foundation and plan material was read, including the bootstrap
and context contract, evidence and identity, recovery and boundaries,
security and privacy, delivery and closure, the rapid-prototype plan,
architecture, and release-promotion boundary. Their common requirements are:

- read local facts before mutation and use host/Git readback for identity;
- treat caller assertions, stale exports, labels, paths, and environment
  values as insufficient identity evidence;
- keep public portable records project-agnostic, secret-free, provider-neutral,
  and free of resolved private paths, chat links, credentials, and runtime
  identities;
- default to local, read-only, no-network, no-authentication, no-spending,
  and no-external-write behavior;
- preserve unavailable and mismatch evidence without substituting a generic
  worker or shell process;
- keep the private control instance separate from the project by default,
  with in-project control requiring explicit owner authorization; and
- keep independent checking distinct from building and leave release,
  publication, push, merge, deployment, and activation at their own authority
  boundaries.

Owner-linked research records named by the inventory were not available as
portable repository source. They are therefore evidence unknowns, not an
authority source inferred by this task.

## Contract and implementation evidence

The authoritative candidate contains a useful but incomplete local slice:

| Area | Intended contract | Observed implementation | Initial disposition |
| --- | --- | --- | --- |
| Workspace boundary | Opaque references, separate release/project/control roots, explicit in-project opt-in, isolated worktrees, no resolved paths in portable records | `control/private-control-storage.mjs` and `schemas/private-workspace-binding.v1.json` enforce canonical roots, sibling/containment rules, symlink rejection, a private Git control repository, opaque references, and an inactive prepared status | Strong foundation; reopen/reconcile and source handoff are incomplete |
| Offline policy | Local operation does not need a provider; external effects fail closed | `control/private-offline-mode.mjs` and `schemas/offline-policy.v1.json` compile offline/read-only/online modes and deny network/auth/provider/external actions in offline mode | Useful foundation; mode invariants need hardening |
| Provider discovery | Provider-neutral, digest-bound catalog with no network/auth/spend/write during discovery | `control/private-provider-discovery.mjs` and `schemas/provider-discovery.v1.json` compile a digest-bound catalog and identify offline-usable entries | Record compiler exists; checked adapter and partial-failure contract are incomplete |
| Host adapter | External host is a boundary; runtime identity stays outside portable records; readback is typed | `control/native-host-attachment.mjs`, `control/native-host-loader.mjs`, `control/codex-native-host-adapter.mjs`, and `control/host-runtime-adapter.mjs` validate callback sets, bind opaque host references, normalize host aliases, and read back source/session state | Useful boundary; source/workspace binding is not unified with the private workspace record |
| Persistence/bundle | New install can safely prepare/reopen/reconcile a private control instance without touching project state | Private storage and bundle code preserve files, exclude worktrees, reject unsafe records, and prevent project writes by default | Prepare/export/import exist; persisted reopen/reconcile readback is missing |
| Hostile checks | Mismatch, detached workspace, unavailable provider, partial failure, portability, and no-effect receipts are independently reproducible | Existing private-control, native-host, and host-attestation verifiers cover several boundary cases | Coverage is self-validating and does not yet give a dedicated ROADMAP_05 matrix |

Relevant authoritative modules include the private control common/storage,
offline policy, provider discovery, private bundle/import, native host
attachment/loader, Codex bridge, host runtime adapter, and native session
attestation/readback modules. The writable worktree predates those accepted
candidate files, so the feature slice also has an integration gap that must be
repaired inside this worktree.

## Findings

### F-01 — Accepted local-adapter slice is not present in the writable candidate

- Severity: high; production readiness impact: blocking for this isolated
  candidate, but an ordinary implementation/integration gap.
- Evidence: the accepted merge contains the ROADMAP_05-related schemas and
  adapters, while this worktree contains neither the private workspace/provider
  slice nor the native host adapter contract.
- Why it matters: a repair cannot be audited or handed off from a worktree that
  does not contain the implementation under review. Copying unrelated merge
  work would broaden custody and obscure the feature boundary.
- Builder action: add only the portable local workspace, offline/provider, and
  host-adapter contracts needed by this feature, with focused tests and no
  private runtime values.

### F-02 — Persisted workspace binding has no explicit reopen/reconcile operation

- Severity: high; production readiness impact: prevents the promised new-local-
  installation lifecycle.
- Evidence: `preparePrivateWorkspace` can create or verify a boundary record,
  and `readPrivateWorkspaceRuntimeBinding` can bind a caller-provided
  environment. There is no single operation that loads the persisted boundary,
  verifies its control repository, reads the current project/workspace facts,
  compares them with the saved binding, and returns an evidence-bearing
  reconcile result.
- Why it matters: a restart can accidentally trust stale or mismatched roots,
  and the system cannot distinguish register, reopen, reconcile, and mismatch
  outcomes deterministically.
- Builder action: add a local workspace adapter with explicit register,
  reopen, reconcile, source readback, and fail-closed mismatch results. Keep
  resolved paths runtime-only and bind receipts to the workspace digest.

### F-03 — Workspace identity is not coupled to a pre-work and handoff source receipt

- Severity: high; production readiness impact: temporary work can be checked
  against a host/session identity without one unified saved-project/source
  binding.
- Evidence: the private binding validates path topology and the native host
  runtime adapter validates selected project/thread/Git facts, but the two
  boundaries do not produce one reusable local adapter receipt that is checked
  before work and again at handoff.
- Why it matters: detached worktrees, changed Git roots, and source drift can
  be observed in separate layers without a deterministic feature-level
  decision that stops the work.
- Builder action: compile a portable workspace readback/handoff receipt from
  host-local observations, including project/source digests and adapter
  identity, and require a fresh reconcile when facts drift.

### F-04 — Provider catalog validation is permissive where fail-closed checks are needed

- Severity: medium-high; production readiness impact: malformed or ambiguous
  provider capability claims can be treated as usable local adapters.
- Evidence: the authoritative provider compiler sorts capabilities and checks
  a few positive implications, but it does not require unique adapter
  references or reject every inverse mismatch (for example, a network or
  authentication capability paired with a false requirement flag). It also
  has no typed partial-failure receipt for a provider observation.
- Why it matters: capability selection must be deterministic and must not
  silently turn a network/auth/external-write requirement into offline work.
- Builder action: strengthen catalog invariants, add explicit unavailable and
  partial-failure dispositions, and keep offline selection limited to
  capabilities proven local and non-external.

### F-05 — Offline policy validation does not fully re-derive mode permissions

- Severity: medium; production readiness impact: a tampered, re-digested
  read-only policy could carry inconsistent capability flags or action sets.
- Evidence: the compiler derives flags and actions, but validation only
  enforces the strongest invariants for offline and online-actions modes; the
  read-only mode is not fully checked against its declared network,
  authentication, external-write, allow, and deny semantics.
- Why it matters: a policy is a gate, not descriptive metadata. A malformed
  read-only policy must fail closed before provider discovery or host work.
- Builder action: make validation re-derive all mode flags and action sets,
  reject policy/action overlap, and preserve the existing digest and owner/
  capability evidence rules.

### F-06 — Local/provider adapter interface and independent no-effects receipt are implicit

- Severity: medium-high; production readiness impact: adapter coverage cannot
  be independently reproduced from one feature contract.
- Evidence: local filesystem/Git work is performed through private storage
  helpers, provider discovery is a record compiler, and the native host bridge
  is a callback wrapper. No feature-level adapter contract states the required
  operations, readback shape, no-network/no-auth/no-spend/no-external-write
  receipt, or partial-failure custody.
- Why it matters: without one checked adapter interface, each caller can
  reinterpret kernel semantics or report success from narration rather than a
  readback.
- Builder action: define the smallest provider-neutral local adapter contract,
  implement the local workspace adapter against it, and add a safe receipt
  that an independent checker can validate without executing provider actions.

### F-07 — Dedicated detached, unavailable, partial-failure, clean-environment,
and restart coverage is absent

- Severity: medium; production readiness impact: the roadmap's hostile and
  portability bar remains unproven.
- Evidence: existing verifiers cover symlink/containment, bundle conflicts,
  provider record privacy, host identity, and selected unavailable cases, but
  there is no ROADMAP_05-specific matrix covering registration/reopen drift,
  detached Git workspace, provider unavailable/partial failure, and exact
  no-external-effects evidence. The available tests are same-process focused
  checks, not independent acceptance.
- Why it matters: the most important local-first failures are boundary and
  restart failures; happy-path records alone cannot establish production
  readiness.
- Builder action: add focused hostile/portability tests and leave their
  functional execution explicitly pending. The report must not claim an
  observed pass until a later authorized run supplies it.

### F-08 — Dynamic external host loading is intentionally un-certified

- Severity: medium; production readiness impact: local operation can remain
  viable, but provider/host certification is not complete.
- Evidence: the native loader checks a module factory and callback shape and
  keeps runtime identity out of portable records, but it does not certify a
  provider implementation or establish a stable source digest for arbitrary
  host modules.
- Why it matters: provider certification is a separate authority and custody
  boundary. Treating a shape-valid module as a certified provider would
  overclaim the roadmap.
- Builder action: preserve the generic adapter boundary, add an explicit
  `UNVERIFIED`/unavailable disposition and no-external-effects receipt, and
  document provider certification as pending rather than hard-coding a
  product/provider into the kernel.

## Cross-cutting quality and boundary assessment

| Lens | Finding | Disposition |
| --- | --- | --- |
| Functionality | Core offline policy, workspace containment, provider-neutral records, and host callback binding exist in the authority snapshot; restart/reconcile and unified source handoff are missing | Repair F-01 through F-06 |
| Quality/hygiene | Portable-record helpers reject resolved paths, private links, environment values, and secret-like fields; the writable candidate has no feature integration or focused matrix | Repair F-01 and F-07 |
| Minimality | The accepted candidate has many neighboring features; copying the whole snapshot would broaden custody | Port only the narrow ROADMAP_05 contracts and dependencies |
| Security/privacy | Default offline flags and portable-record checks are directionally correct; dynamic host/provider certification and malformed mode/catalog claims need fail-closed handling | Repair F-04, F-05, F-08 |
| Durability | Digests, exclusive files, private Git control, and worktree exclusion exist; persisted reopen/reconcile evidence is incomplete | Repair F-02 and F-03 |
| Regression | Existing host/session and private-control behavior must remain source-bound and `2.1rc` inactive; functional suite is pending | Add focused checks without running npm or claiming acceptance |
| Custody | Private runtime paths/identities must stay runtime-only; control artifacts remain outside the project by default | Preserve the boundary; no private values in this report |
| Boundary | Local/offline work is in scope; authentication, network actions, spending, publication, merge, deployment, release, and activation stay out of scope | No true blocker; route external work to its own authority |
| Intent | The roadmap's current `Partial` status is honored; local correctness must not wait for remote provider certification | Repair local gaps and keep broader certification pending |

## Production-readiness decision

Decision: `NOT_READY_FOR_ACCEPTANCE_REPAIR_REQUIRED`.

The authority snapshot has a credible partial local foundation, but the
candidate is not production-ready because the isolated worktree lacks the
feature slice and because the promised restart/reconcile, unified identity
handoff, strict fail-closed validation, and dedicated hostile/portability
coverage are not complete. This is not a release or activation decision.

### True blockers

None at this audit pass.

Functional tests are pending by instruction, which is a verification state,
not an external blocker. Provider certification is explicitly outside the
current local prototype and is not a reason to stop local repair. If a future
step needs an unavailable external host capability, the exact recovery is to
record the missing capability and `UNAVAILABLE`, retain the safe digest, and
resume only after a fresh host readback; no provider, shell, or generic-worker
substitute is permitted.

## Builder actions

1. Add the narrow authoritative local workspace/offline/provider/host adapter
   contracts to this isolated worktree and preserve project-agnostic payloads.
2. Implement registration, persisted reopen, reconciliation, source readback,
   and pre-work/handoff binding around the saved workspace digest.
3. Harden provider catalog and offline policy validation without enabling
   external actions.
4. Add the provider-neutral adapter and no-effects receipt boundary, keeping
   unverified external adapters visibly unverified.
5. Add focused hostile and portability tests; do not run npm and do not claim
   functional acceptance until the requested pending test phase is authorized.
6. Self-audit every repair, then append a re-audit with changed paths,
   evidence, remaining findings, and the next exact action.

Initial audit status: `REPAIR_IN_PROGRESS`.

## Repair pass 1 and self-audit

The builder repaired only the recorded ROADMAP_05 findings in this isolated
worktree. No release, activation, push, merge, deployment, authentication,
network action, provider action, spending, or destructive cleanup was
performed.

### Implemented repair

- Ported the narrow accepted local boundary primitives: private control
  common/storage, offline policy, provider-neutral discovery, native host
  attachment/loader, Codex host bridge, and their v1 schemas.
- Added `control/local-workspace-adapter.mjs` and
  `schemas/local-workspace-receipt.v1.json`. The adapter owns `REGISTER`,
  `REOPEN`, `RECONCILE`, `PRE_WORK`, and `HANDOFF` observations; persisted
  reopen resolves host references only at runtime; receipts contain no
  resolved paths or runtime identities.
- Added a persisted binding reopen path and control-repository Git readback.
  The local adapter compares expected source commit/tree and working-tree
  content digests and returns typed `MISMATCH` or `UNAVAILABLE` results.
- Hardened offline policy validation so flags, discovery mode, allowed
  actions, and denied actions are re-derived from the selected mode. Online
  modes require owner evidence; online actions additionally require capability
  evidence.
- Hardened provider catalogs so adapter references are unique and sorted,
  capability/requirement flags agree in both directions, and only trusted or
  capability-attested local entries are returned as offline-usable.
- Added the narrow `control/agentos.mjs` facade, host capability/control
  repository schemas, a focused ROADMAP_05 hostile/portability verifier, and
  the local adapter contract notes in `control/README.md`.

### Self-audit results

| Finding | Self-audit result | Evidence |
| --- | --- | --- |
| F-01 | Resolved | All feature-local control, schema, test, and report paths now exist in this worktree; no unrelated merge snapshot was copied. |
| F-02 | Resolved in implementation | Persisted boundary load, current-environment rebinding, control Git verification, and explicit `REOPEN`/`RECONCILE` paths are present. |
| F-03 | Resolved in implementation | `PRE_WORK` and `HANDOFF` receipts bind the workspace digest to source commit/tree and working-tree digest; drift returns `MISMATCH`. |
| F-04 | Resolved in implementation | Provider references are unique/deterministically sorted and capability flags are checked in both directions; offline selection excludes untrusted/unavailable entries. |
| F-05 | Resolved in implementation | Offline policy validation re-derives every mode flag and action list and rejects inconsistent re-digested records. |
| F-06 | Resolved in implementation | Local adapter, provider discovery, and workspace receipt all expose typed no-network/no-auth/no-spend/no-external-write evidence. |
| F-07 | Implemented, verification pending | `tests/verify-local-adapters.mjs` covers register/reopen, source match, handoff drift, host reopen, provider mismatch/duplicate claims, no-effects flags, host binding, and privacy. It has not been executed. |
| F-08 | Intentionally remains partial | Dynamic external host loading is shape-checked but not provider-certified; this is the roadmap’s explicit partial boundary and must not be overclaimed. |

### Static evidence

- Node syntax readback: `PASS` for every added control module and the focused
  verifier.
- JSON parse readback: `PASS` for every added/ported schema, including the
  local workspace receipt.
- Whitespace/readability check: `PASS`.
- Public-surface privacy scan: `PASS`; no literal private machine path,
  private link, credential, token, or provider account was added to the
  feature report or implementation records.
- No npm command was used.
- Functional checks: `PENDING` by instruction. No functional pass or
  independent acceptance is claimed.

## Re-audit: repair pass 1

### Intended behavior versus repaired implementation

The repaired candidate now has an explicit local lifecycle:

```text
host references
    -> persisted workspace binding
    -> REGISTER / REOPEN
    -> PRE_WORK source + working-tree readback
    -> bounded local work
    -> HANDOFF source + working-tree readback
    -> MATCH, MISMATCH, or UNAVAILABLE receipt
```

The workspace boundary remains prepared/inactive, project writes remain
external-only unless explicitly authorized, and provider discovery remains
offline by default. Kernel semantics are not changed by the adapter; the
adapter contributes only host readback and typed evidence.

### Re-audit disposition

- F-01 through F-06: `RESOLVED_IN_IMPLEMENTATION_PENDING_FUNCTIONAL_CHECK`.
- F-07: `OPEN_VERIFICATION_PENDING`; the test artifact exists but has not run.
- F-08: `DEFERRED_BY_ROADMAP`; external provider certification remains a
  separate authority/custody decision and is not needed for the local
  prototype.
- Security/privacy: `PASS_STATIC_PENDING_RUNTIME_CHECK`.
- Durability/custody: `PASS_STATIC_PENDING_RESTART_CHECK`.
- Boundary/intent: `PASS`; no protected external action or release state was
  changed.

### Remaining findings and exact recovery

1. Functional and independent checks remain pending. When authorized, run the
   focused local-adapter verifier and the applicable independent portability,
   hygiene, and source-bound checks against this exact candidate. If a check
   cannot run, retain `UNAVAILABLE` with the missing capability and do not
   convert it to `PASS`.
2. Provider certification remains unproven by design. To extend beyond the
   local prototype, record a separate owner-authorized provider capability and
   permission contract, supply host readback and no-effects evidence, and run
   the provider’s independent checks. Do not change the portable kernel to
   encode a provider.

### Changed files and custody

The feature repair adds or changes only the following relative paths:

- `control/README.md`
- `control/agentos.mjs`
- `control/content-addressing.mjs`
- `control/codex-native-host-adapter.mjs`
- `control/local-workspace-adapter.mjs`
- `control/native-host-attachment.mjs`
- `control/native-host-contract.mjs`
- `control/native-host-loader.mjs`
- `control/private-control-common.mjs`
- `control/private-control-storage.mjs`
- `control/private-offline-mode.mjs`
- `control/private-provider-discovery.mjs`
- `schemas/host-capability-catalog.v1.json`
- `schemas/local-workspace-receipt.v1.json`
- `schemas/native-host-attachment.v1.json`
- `schemas/offline-action-authorization.v1.json`
- `schemas/offline-policy.v1.json`
- `schemas/private-control-repository.v1.json`
- `schemas/private-workspace-binding.v1.json`
- `schemas/provider-discovery.v1.json`
- `tests/verify-local-adapters.mjs`
- `docs/feature-audits/ROADMAP_05_LOCAL_ADAPTERS/auditreport.md`

No private path, secret, credential, provider token, chat link, or resolved
runtime identity is stored in these public artifacts.

## Handoff

- Candidate status: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_AND_INDEPENDENT_TESTS`.
- True blockers: none.
- External-effects status: all local/provider discovery receipts explicitly
  report no network, authentication, spending, or external write attempt.
- Release status: prepared `2.1rc` remains inactive.
- Next action: keep this task active for the later authorized focused and
  independent verification pass; on any failure, record the exact failing
  receipt and repair only that bounded finding.

Re-audit status: `FINISHED_PENDING_TESTS`.

## Central integration intake — 2026-08-09

- visible_task_ref: TASK_REF_ROADMAP_05_LOCAL_ADAPTERS_VISIBLE
- isolated_worktree_ref: WORKTREE_REF_7F01
- source_head: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- source_tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- isolated_report_sha256: `fc3e16bb22aad5b0d35afc5f0b293eeb8f211765b9a94074e21286b55a7d4524`
- central_disposition: SOURCE_BOUND_CANDIDATE_INTEGRATED_PENDING_BINDING_REFRESH
- changed_path_disposition: local workspace adapter, receipt schema, provider/control hardening, docs, and focused verifier integrated; binding refresh deferred until combined source is settled
- functional_status: NOT_RUN_BY_INSTRUCTION
- archive_status: WITHHELD_UNTIL_DOWNSTREAM_REVIEW
