# PERSISTENT_INTENT_RUNTIME audit report

Status: `AUDIT_REPAIR_IN_PROGRESS`

This report is append-only. Each pass preserves the prior findings and records
the next disposition. The feature remains `PREPARED_NOT_ACTIVATED`; this report
does not authorize activation, release, deployment, publication, push, merge,
or external delivery.

## Audit pass 0 — authority and intent review

### Baseline identity and scope

- Feature: `PERSISTENT_INTENT_RUNTIME` — Persistent Intent Regulator and Runtime.
- Inventory authority: `docs/feature-inventory.v1.json`, entry
  `PERSISTENT_INTENT_RUNTIME`.
- Authoritative source identity read before edits: Git HEAD
  `590c07ddd4be7a8c24727c24b40808e44ca7357d`, plus the accepted merge working
  tree content. The accepted merge working tree contained uncommitted feature
  additions; those additions were read only.
- Writable scope: this isolated worktree only.
- Functional tests: not run, by instruction. Test status remains pending.
- No secrets, credentials, private machine locations, provider tokens, or chat
  links were copied into this report.

### Intended behavior reconstructed from the source corpus

The roadmap and controller contracts require a project-persistent control-plane
role that retains intent, source identity, evidence, routing, repair,
reassessment, and closure without requiring an outside prompt. The public role
is `Intent Regulator`; its machine identity remains `AGENTOS_CONTROLLER`.

The Runtime is the deterministic state/event authority. It must be the sole
state writer, use compare-and-swap and append-only content-addressed history,
hold a fenced lease, recover prepared transactions or fail closed, distinguish
meaningful progress from heartbeat narration, and keep the authority root
outside the product repository. Intent Regulator judgment is guide-only:
workers, auditors, and the regulator cannot grant acceptance or protected
actions. Acceptance, activation, deployment, merge, publication, push,
rollback, secret disclosure, spending, and product writes remain disabled until
separate typed authority exists.

The documentation sequence is Bootstrap → project contract → persistent Intent
Regulator/Runtime → campaign orchestration → independent audit → closure. The
runtime must remain bound to the exact project, campaign, goal, source, policy,
host readback, evidence, and environment. The prepared `2.1rc` line remains
inactive.

The inventory names `research-records-linked-by-owner`, but no such research
record is present in the accepted public source tree. Research intent is
therefore recorded as an evidence unknown, not inferred as authority. The
roadmap, architecture, naming, Bootstrap plan, controller-supervisor contract,
security/privacy foundation, and runtime schemas are the available normative
intent sources.

### Actual implementation observed in the authoritative merge

The accepted merge contains:

- `control/persistent-intent-runtime-contract.mjs`: typed snapshots,
  guide-only decisions, persistent roles, checkpoints, state transitions,
  event/transaction validation, digests, and protected-action defaults.
- `control/persistent-intent-runtime-storage.mjs`: external-root containment,
  leases, fencing epochs, atomic JSON writes, append-only event history,
  compare-and-swap state writes, prepared-transaction replay, and fail-closed
  corruption checks.
- `control/persistent-intent-runtime.mjs`: the public durable Runtime facade.
- `control/persistent-intent-runtime-integration.mjs`: typed observation and
  route envelopes with evidence and identity digests.
- `control/intent-regulator-runtime.mjs`: a configuration/facade seam intended
  to mount governance, start campaign work, and run a review monitor.
- `schemas/persistent-intent-runtime.v1.json` and
  `schemas/persistent-intent-runtime-integration.v1.json`: record and envelope
  contracts.
- Focused hostile, recovery, integration, and schema-parity verifier files.

The core journal and recovery design is materially aligned with the intended
boundary. The feature-specific verifiers cover normal decisions, fencing,
corruption, symlinks, crash/recovery stages, multi-transaction ambiguity,
privacy scans, and route identity. Those verifiers are not run in this cycle.

### Initial findings

#### PIRT-001 — feature is absent from the isolated candidate and normative binding

Severity: `HIGH` — custody/integration gap

The isolated worktree predates the accepted merge additions: the feature source,
schemas, integration seam, and focused verifiers are absent. The accepted
merge’s `schemas/bootstrap-binding.v1.json` also has no normative entries for
the feature files, and `tests/verify-all.mjs` does not register the focused
feature verifiers. A feature that is only present in an uncommitted authority
tree is not a reproducible candidate.

Why it matters: the exact feature cannot be rebuilt or source-bound from the
isolated candidate, and the release binding can silently omit it.

Evidence: inventory entry `PERSISTENT_INTENT_RUNTIME`; authoritative files
listed above; no corresponding feature files in the isolated baseline; no
feature entries in the authoritative normative binding.

Disposition: ordinary implementation/custody gap, not an external blocker.
Builder action: port the minimal feature slice into this worktree, bind its
normative sources, and add focused verifier registration without changing
activation state.

#### PIRT-002 — facade configuration is not bound to durable Runtime state

Severity: `CRITICAL` — intent/durability gap

`control/intent-regulator-runtime.mjs` validates and digests a configuration,
but `createIntentRegulatorRuntime` only retains an in-memory status and runtime
reference. It does not open the durable `PersistentIntentRuntime`; its
`monitor` delegates to a generic loop callback, and `startCampaign` passes
through to another campaign implementation. The configuration’s governance,
model, release, and offline policy digests are not carried into the durable
role/state records.

Why it matters: after restart, the facade has no authoritative review history;
an arbitrary callback can appear to be the monitor; and Runtime records can be
bound to the generic default governance digest rather than the active project
contract and policy.

Evidence: `control/intent-regulator-runtime.mjs:122-220`; the low-level Runtime
accepts a `governanceDigest` but the facade does not supply one; integration
envelopes exist but are not used by the facade monitor.

Disposition: ordinary implementation gap. Reframe as an adapter-bound,
durable monitor and repair it.

#### PIRT-003 — host, policy, source, and environment identity validation is too weak

Severity: `HIGH` — security/boundary gap

The facade’s host validation accepts any two objects and checks only
`hostAttachment.project_id`. Policy fields named `*_sha256` are accepted as
arbitrary nonempty strings; generated time is not validated; a supplied
`runtimeRef` is not validated; and the attachment environment/source binding is
not checked against the configuration. This permits caller-shaped values to
cross the facade boundary without exact host readback.

Why it matters: a monitor or campaign can be associated with the wrong host,
environment, source, or policy while retaining a plausible-looking digest or
identity. This violates the controller-supervisor identity rule and can route
work under stale authority.

Evidence: `control/intent-regulator-runtime.mjs:45-59, 117-155`.

Disposition: ordinary validation gap. Repair with exact identifier, digest,
UTC, opaque-reference, and host-attachment checks; preserve the host adapter as
the only source of runtime identity.

#### PIRT-004 — reassessment has no owner-controlled completion transition

Severity: `CRITICAL` — intent/custody gap

`REASSESS_AND_REPLACE_GOAL` records `REASSESSMENT_REQUIRED`, but the durable
Runtime exposes no typed owner decision that installs the replacement goal,
source, or intent. `transitionForDecision` then rejects every later decision
except another reassessment. A `CLOSED` checkpoint can still move a
reassessment state to `CLOSED` without proving that the owner reviewed and
accepted the replacement boundary.

Why it matters: a changed goal can deadlock permanently or be closed without a
real owner-controlled replacement. Either outcome loses intent custody.

Evidence: `control/persistent-intent-runtime-contract.mjs:571-607, 665-673`;
`control/persistent-intent-runtime.mjs:217-252`.

Disposition: ordinary state-machine gap. Add a typed owner replacement
transition with exact predecessor and replacement identity, explicit
idempotency, and no protected-action authority.

#### PIRT-005 — integration evidence envelopes are not on the executable route

Severity: `HIGH` — evidence/regression gap

The integration module can compile host/auditor evidence into observations and
routes, but the executable campaign path calls the low-level tick with a raw
campaign snapshot and commits a decision without an issuer-bound observation
envelope. The route envelope is therefore available as a pure helper but is
not required before dependent work is admitted.

Why it matters: production routing can lose the exact evidence issuer,
attestation, roster, progress, and boundary digests that the integration
schema promises.

Evidence: `control/persistent-intent-runtime-integration.mjs:120-280` versus
the raw snapshot/tick path in the authoritative campaign adapter.

Disposition: ordinary integration gap. Make the durable monitor require a
validated observation envelope and emit a validated route; retain the raw
snapshot API only as the lower-level internal primitive.

#### PIRT-006 — contract/configuration schema parity and verifier coverage are incomplete

Severity: `MEDIUM` — quality/hygiene gap

The top-level persistent-runtime schema describes a contract envelope, but no
compiler or validator creates that envelope. The code’s runtime record constant
and the schema’s contract identity are not asserted against one another. The
configuration object also has no dedicated JSON schema. Focused feature tests
exist in the accepted merge but are not part of the all-verifier registration
or normative binding.

Why it matters: schema drift can pass local record checks while the public
contract remains dead documentation, and a clean checkout can omit the focused
coverage.

Disposition: ordinary contract/hygiene gap. Add a small configuration/contract
validation surface, register the focused checks, and bind only the feature
files; keep functional execution pending.

#### PIRT-007 — readback integrity is stronger at commit/reopen than at every read

Severity: `MEDIUM` — durability/tamper-detection gap

The Runtime caches state/checkpoint values at open, and `readEvents()` reads
event records without first re-validating the complete chain against the cached
state. Commit and inspection paths do validate the chain, but an external
mutation after open can be observed through a read method before the next
commit/reopen.

Why it matters: callers can consume a readback that is not proven to be the
current append-only history.

Disposition: ordinary defensive-read gap. Revalidate the state/event chain on
public event/state inspection boundaries without changing the journal format.

### Cross-cutting quality, hygiene, minimality, security, privacy, durability,
### regression, custody, boundary, and intent assessment

- Quality: core record validators use exact keys, canonical digests, and
  fail-closed status checks. Facade validation and contract parity are weaker
  than the core.
- Hygiene/minimality: the accepted merge has a second persistent supervisor
  runtime and a new Runtime record family. The repair must keep one clear
  authority per record family and avoid copying unrelated merge work.
- Security/privacy: protected actions are false and persisted records are
  privacy-scanned. Host identity and raw facade error/adapter boundaries need
  stronger validation; no secret access is required.
- Durability: atomic staged writes, fsync, leases, fencing, journal chaining,
  and prepared-transaction recovery are present. Public readback and owner
  reassessment need repair.
- Regression: focused feature verifiers cover many hostile cases but are not
  registered/bound; no functional verifier was run.
- Custody: Runtime is intended to be the sole state writer, but the facade is
  not yet attached to it and reassessment lacks an owner transition.
- Boundary: repository containment and protected-action defaults are strong;
  exact host/environment/source binding is incomplete.
- Intent: ordinary continuation, hard stop, soft review, stalled replacement,
  candidate acceptance, and changed-intent detection are represented. Goal
  replacement and restart continuity through the public facade are incomplete.

### Production readiness at pass 0

`NOT_READY`. The core storage slice is a credible prepared implementation, but
PIRT-002 and PIRT-004 are release-blocking correctness findings, while
PIRT-001, PIRT-003, and PIRT-005 prevent source-bound production custody.
Functional acceptance remains pending and is not being claimed.

### True blockers and exact recovery

No genuine external blocker is present. Missing feature files in the isolated
worktree, missing tests in the binding, weak validation, and incomplete state
transitions are ordinary implementation gaps. Recovery is: port the minimal
authority slice, repair the recorded contracts and transitions, bind the exact
changed files, run static/self-audit checks, then leave functional tests
pending for the authorized verification pass.

### Builder actions for the next pass

1. Add the durable Runtime contract, primitives, storage, facade, integration
   envelopes, and schemas to this isolated worktree using the accepted merge as
   source material.
2. Replace the facade’s generic monitor with a durable, observation-bound loop;
   validate host/config/source/environment identity and carry governance digest
   into Runtime records.
3. Add an explicit owner-controlled goal replacement transition and prevent
   reassessment from closing or continuing without that transition.
4. Add schema/configuration parity and focused verifier registration/binding;
   do not execute functional tests.
5. Re-audit every recorded finding, retain this pass intact, and report exact
   changed files, static evidence, remaining findings, and next action.

## Pass ledger

| Pass | Result | Remaining material findings | Next action |
| --- | --- | --- | --- |
| 0 | Initial audit complete; builder actions recorded | PIRT-001 through PIRT-007 | Repair only the recorded findings in this worktree |

## Campaign correction — platform-foundation gate

Effective status: `HOLD_FOR_CONTROLLER_PLATFORM_FOUNDATION`.

The Controller has declared the platform skeleton, routing, stack, shared
contracts, and UI direction a hard prerequisite for this feature. Feature
implementation, repair, self-audit, re-audit, functional verification, and
acceptance claims are therefore paused until that platform foundation is
accepted and merged by the Controller and this lane is explicitly released.
This is an external authority/custody hold, not a claim that the feature code
is production-ready.

The isolated worktree currently preserves a provisional repair snapshot for
the recorded findings. It is not accepted feature history and must be
reconciled against the accepted platform contracts after release. The
provisional snapshot includes the durable Runtime contract/storage/facade,
typed integration envelopes, owner-goal replacement transition, strict host
and source/environment binding, public readback chain validation, runtime and
configuration schemas, normative bootstrap bindings, focused verifier
registration, and the supervisor cadence contract. No protected action or
activation state was enabled. No secrets, credentials, private machine
locations, provider tokens, or chat links were added.

### Gate-hold evidence and remaining findings

- The complete pass-0 audit and PIRT-001 through PIRT-007 evidence remain
  preserved above.
- Static syntax, JSON, whitespace, and privacy checks were previously run for
  the provisional snapshot. Functional tests were not run and remain pending.
- The provisional repair snapshot must not be treated as a passed self-audit,
  accepted merge, release candidate, or production acceptance. All seven
  findings remain open for custody/reconciliation until the Controller gate
  is cleared.
- No feature-specific external blocker was found. The current hold is the
  explicit platform authority gate supplied by the Controller.

### Exact recovery and next action

1. Wait for Controller acceptance and merge of the platform skeleton, routing,
   stack, shared contracts, and UI direction, followed by explicit release of
   this feature lane.
2. Re-read the newly accepted merge worktree and the inventory as authority;
   compare its shared contracts with the preserved provisional snapshot.
3. Reconcile only PIRT-001 through PIRT-007 against those accepted platform
   contracts, preserving resolved history and leaving `2.1rc`
   `PREPARED_NOT_ACTIVATED`.
4. Run the required self-audit and re-audit passes, refresh normative hashes,
   and report changed files, evidence, remaining findings, and next action.
   Functional tests remain pending until the Controller authorizes that
   verification stage.

The next action is therefore: `AWAIT_CONTROLLER_PLATFORM_FOUNDATION_AND_EXPLICIT_LANE_RELEASE`.

## Controller gate recheck — 2026-08-07

The gate was rechecked against the current accepted-merge authority and the
visible Controller task before any further feature write.

- `docs/rapid-foundations/foundation-clearance.md` records `12/12 PASS` and
  `FOUNDATION_CLEARANCE_ACCEPTED`, but explicitly says that it performed no
  implementation or acceptance and that the next admitted phase is a
  separately recorded implementation phase.
- `docs/rapid-prototype-controller-workflow.md` still requires the Controller
  to audit and merge the complete platform foundation before feature work can
  start.
- The Controller task remains active and its latest visible state says the
  platform gate is active, platform lanes are producing handoffs, and feature
  lanes are held at audit-only. No `PLATFORM_MERGE_COMPLETE` evidence or
  explicit release of this lane was found.
- The accepted-merge working tree is dirty and therefore does not by itself
  prove that the platform skeleton, routing, stack, shared contracts, and UI
  direction have passed the required Controller merge gate.

Result: the external custody hold remains valid. The provisional feature
implementation remains preserved but untouched; no self-audit, re-audit,
functional test, acceptance, or production-candidate claim is advanced in
this pass.

The exact next action is updated to:
`AWAIT_CONTROLLER_PLATFORM_MERGE_COMPLETE_AND_EXPLICIT_LANE_RELEASE`.

## Central intake cycle — reconciled PERSISTENT_INTENT_RUNTIME candidate — 2026-08-09

The visible PIRT lane completed a second audit/repair/re-audit pass after
central intake identified stale shared surfaces. Its candidate is source-bound
to central commit `590c07ddd4be7a8c24727c24b40808e44ca7357d` and tree
`f1b358d87e6a969fb9631e202a3d478540edd4d9`.

The lane restored the complete public kernel surface, preserved current JSA,
Intent Regulator naming, dynamic platform-domain discovery, scheduler and
verifier behavior, retained all current central binding entries, and added
only the PIRT owner-replacement, checkpoint/event, role-readback, and related
source/schema/verifier deltas. The stale configuration verifier was removed
from the candidate rather than bound to an API the current facade does not
expose. The exact preservation record is:

`docs/feature-audits/PERSISTENT_INTENT_RUNTIME/central-intake-preservation-manifest-2026-08-09.md`

Candidate source observation: `ae39bf92ac5a869a467c3e99e6a3e5f6764dd97fbcef4cdc4f3d872e490385f3`  
Candidate handoff: `1a159f33674d98f592d0e178285b076b2765917c0b01fb1cabe06942e51fa857`  
Disposition: `CENTRAL_INTEGRATED_PENDING_INDEPENDENT_REAUDIT`  
Downstream consumed: `false`

The central versions of the reconciled files now match the candidate hashes,
including the additive public exports, PIRT contract/runtime/storage/schema
changes, binding additions, and owner-replacement verifier. No functional
tests, npm command, commit, push, deployment, release, hosting, or protected
action was performed. Functional proof, clean-candidate custody, and
independent central clearance remain pending. The visible PIRT task and
worktree remain preserved and unarchived.

Current next action:
`CENTRAL_INDEPENDENT_REAUDIT_RECONCILED_PIRT_THEN_CONSIDER_NEXT_FEATURE_WAVE`.
