# Platform Foundation Merge Receipt

> Active platform-foundation receipt: this document records the platform batch
> that must complete before feature work is admitted. Older feature-first
> handoff records remain historical evidence only and do not own orchestration.

Schema: `agentos.platform_foundation_merge_receipt.v1`
Compiler: `control/platform-foundation-merge.mjs`
Contract: `schemas/platform-foundation-merge-receipt.v1.json`
Status: `PLATFORM_MERGE_CANDIDATE_PENDING_INDEPENDENT_CLEARANCE`
Activation: `PREPARED_NOT_ACTIVATED`
Feature admission: `HOLD`
Independent static audit: `docs/platform-foundation-independent-audit.md`

## Purpose

This receipt is the Controller's active index for the current platform
foundation phase. It records preserved source-backed platform candidates and
the exact evidence still required before the Controller may issue one
cumulative merge receipt. A handoff is evidence to audit, not an acceptance
claim. The historical governance-lane records below remain preserved custody
evidence and are not reused as platform ownership.

## Current source-backed platform candidate batch

The active platform batch has three visible candidates. Their handoffs,
reports, opaque worktree references, and task identities are retained in
`docs/platform-handoffs/platform-candidate-intake-2026-08-09.md` and
`docs/platform-domain-runtime-registry.v1.json`.

| Domain | Visible task | Worktree ref | Status |
| --- | --- | --- | --- |
| Native Session and Evidence Custody | `019fdcfa-43dc-76a3-befa-c93580a3c808` | `WORKTREE_REF_C22B` | HANDOFF_RECEIVED_PENDING_INDEPENDENT_CLEARANCE |
| Named Gate Catalog and Universal Response Gating | `019fdcfb-d827-7831-958a-470c2abbe6eb` | `WORKTREE_REF_C3BA` | HANDOFF_RECEIVED_PENDING_INDEPENDENT_CLEARANCE |
| Private Control, Memory Ledger, and Bounded Maps | `019fdcf9-a416-77f0-91a2-e3e2535eb2ec` | `WORKTREE_REF_7C07` | HANDOFF_RECEIVED_PENDING_INDEPENDENT_CLEARANCE |

The platform gate remains `HOLD`: no feature wave may start until these
candidates are independently audited, reconciled into one source-bound
platform worktree, and accepted by a typed merge receipt.

## Preserved platform handoffs

All twelve governance lanes have a preserved handoff:

1. `LANE_01_INTENT_AND_SCOPE` -> `docs/platform-handoffs/01-intent-and-scope-platform-handoff.md`
2. `LANE_02_BOOTSTRAP_AND_CONTEXT` -> `docs/platform-handoffs/02-bootstrap-and-context-platform-handoff.md`
3. `LANE_03_USER_CONVERSATION` -> `docs/platform-handoffs/03-user-conversation-platform-handoff.md`
4. `LANE_04_ROLE_ROUTING` -> `docs/platform-handoffs/04-role-routing-platform-handoff.md`
5. `LANE_05_PROGRESS_AND_HEALTH` -> `docs/platform-handoffs/05-progress-and-health-platform-handoff.md`
6. `LANE_06_FUNCTIONALITY` -> `docs/platform-handoffs/06-functionality-platform-handoff.md`
7. `LANE_07_UI_UX` -> `docs/platform-handoffs/07-ui-and-ux-platform-handoff.md`
8. `LANE_08_CODE_HYGIENE` -> `docs/platform-handoffs/08-code-hygiene-platform-handoff.md`
9. `LANE_09_SECURITY_PRIVACY` -> `docs/platform-handoffs/09-security-and-privacy-platform-handoff.md`
10. `LANE_10_EVIDENCE_IDENTITY` -> `docs/platform-handoffs/10-evidence-and-identity-platform-handoff.md`
11. `LANE_11_RECOVERY_BOUNDARIES` -> `docs/platform-handoffs/11-recovery-and-boundaries-platform-handoff.md`
12. `LANE_12_DELIVERY_CLOSURE` -> `docs/platform-handoffs/12-delivery-and-closure-platform-handoff.md`

The corresponding 12 lane reports now exist under `docs/rapid-foundations/`.
Eleven were reconstructed as explicit pending-audit records because their
standalone reports were not preserved; the existing code-hygiene report is
also retained. The records do not infer a pass from the handoff documents.

## Visible platform-task reconciliation

Registry status: `REPAIR_REQUIRED`
Registry reference: `PLATFORM_VISIBLE_TASK_REGISTRY_7_OF_12`
Source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
Source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`

The following seven visible tasks are source-bound to the preserved handoff
and report references. Worktree values are opaque references only; no host
paths, secrets, or chat links are persisted.

| Lane | Visible thread ID | Observed state | Worktree ref | Handoff | Report |
| --- | --- | --- | --- | --- | --- |
| `LANE_01_INTENT_AND_SCOPE` | `019fe052-defd-7ac1-824e-ea83ef2a7980` | `idle` | `WORKTREE_REF_038` | `docs/platform-handoffs/01-intent-and-scope-platform-handoff.md` | `docs/rapid-foundations/01-intent-and-scope-auditreport.md` |
| `LANE_02_BOOTSTRAP_AND_CONTEXT` | `019fe052-df05-72f1-bff0-64123bed03c1` | `idle` | `WORKTREE_REF_039` | `docs/platform-handoffs/02-bootstrap-and-context-platform-handoff.md` | `docs/rapid-foundations/02-bootstrap-and-context-auditreport.md` |
| `LANE_03_USER_CONVERSATION` | `019fe053-3185-7de2-80a4-d123054f19b9` | `notLoaded` | `WORKTREE_REF_040` | `docs/platform-handoffs/03-user-conversation-platform-handoff.md` | `docs/rapid-foundations/03-user-conversation-auditreport.md` |
| `LANE_04_ROLE_ROUTING` | `019fe053-3643-7a80-a62a-d5584386ab66` | `notLoaded` | `WORKTREE_REF_041` | `docs/platform-handoffs/04-role-routing-platform-handoff.md` | `docs/rapid-foundations/04-role-routing-auditreport.md` |
| `LANE_05_PROGRESS_AND_HEALTH` | `019fe053-3648-7d72-8286-9a2e1de5f13f` | `idle` | `WORKTREE_REF_042` | `docs/platform-handoffs/05-progress-and-health-platform-handoff.md` | `docs/rapid-foundations/05-progress-and-health-auditreport.md` |
| `LANE_06_FUNCTIONALITY` | `019fe054-4c66-7a82-a347-699f7d6a8017` | `notLoaded` | `WORKTREE_REF_043` | `docs/platform-handoffs/06-functionality-platform-handoff.md` | `docs/rapid-foundations/06-functionality-auditreport.md` |
| `LANE_07_UI_UX` | `019fe05a-36c2-7833-9c13-4092b9e56400` | `notLoaded` | `WORKTREE_REF_044` | `docs/platform-handoffs/07-ui-and-ux-platform-handoff.md` | `docs/rapid-foundations/07-ui-and-ux-auditreport.md` |

The following five inventory slots have no discoverable visible task and are
explicit parity holds, not synthetic task records:

| Lane | Opaque worktree ref | Disposition |
| --- | --- | --- |
| `LANE_08_CODE_HYGIENE` | `WORKTREE_REF_045` | `MISSING_VISIBLE_TASK_PARITY_HOLD` |
| `LANE_09_SECURITY_PRIVACY` | `WORKTREE_REF_046` | `MISSING_VISIBLE_TASK_PARITY_HOLD` |
| `LANE_10_EVIDENCE_IDENTITY` | `WORKTREE_REF_047` | `MISSING_VISIBLE_TASK_PARITY_HOLD` |
| `LANE_11_RECOVERY_BOUNDARIES` | `WORKTREE_REF_048` | `MISSING_VISIBLE_TASK_PARITY_HOLD` |
| `LANE_12_DELIVERY_CLOSURE` | `WORKTREE_REF_049` | `MISSING_VISIBLE_TASK_PARITY_HOLD` |

`ONE_PLATFORM_MERGE` remains `NOT_ACCEPTED` and `FEATURE_ADMISSION` remains
`HELD`.

## Controller consumption

The current cumulative intake is recorded in
`docs/platform-foundation-controller-consumption-2026-08-08.md`. It lists the
lane-scoped repairs consumed without accepting the platform merge. The five
missing visible platform task slots, runtime-registry parity, and independent
clean-snapshot audit remain required.

## Controller acceptance state

The independent cumulative audit is preserved in
`docs/platform-foundation-independent-audit-2026-08-08.md`. It passes the
null-authority-root and direct-launch-removal repairs after re-audit, while
keeping platform acceptance held for scheduler-backed verification, five
missing visible task bindings, complete runtime-registry/goal parity, clean
source custody, and the imported-approval/platform-merge state-machine seam.

Required sequence:

`PROJECT_INITIALIZATION -> PLATFORM_FOUNDATION_HANDOFFS -> INDEPENDENT_PLATFORM_AUDIT -> ONE_PLATFORM_MERGE -> FEATURE_ADMISSION -> FEATURE_AUDIT_REPAIR -> CENTRAL_INTEGRATION`

## Inventory binding repair

The platform foundation receipt and the downstream platform merge gate now
carry the full canonical feature-inventory digest. The Controller must match
that digest to the active workflow inventory before `PLATFORM_MERGE_COMPLETE`
can advance to feature work. Counts and active lane IDs remain validated as
human-readable parity evidence; the digest prevents a receipt with matching
counts but different feature or platform definitions from being reused.

Current evidence:

- `COLLECTED_HANDOFFS`: `PRESENT`
- `INDEPENDENT_PLATFORM_AUDIT`: `PENDING_FOR_EACH_LANE`
- `ONE_PLATFORM_MERGE`: `NOT_ACCEPTED`
- `FEATURE_ADMISSION`: `HELD`
- `FEATURE_REPORT_PARITY`: `37_OF_37`
- `GOVERNANCE_REPORT_PARITY`: `12_OF_12`
- `UNIVERSAL_CLOSEOUT_POLICY`: `GENERAL_GOVERNANCE_BOUND_ALL_MODES`

Task archival is dynamic and is permitted only after the preserved handoff,
independent audit, accepted integration, stale-worktree closure, active-scope
removal, and explicit chat-out-of-scope receipt are present. The same rule is
inherited by imported, rapid, campaign, cascade, iteration, apprenticeship,
and Bootstrap workflows.
- `MERGE_PROOF`: `PENDING_AUDIT_RECEIPT_AND_INTEGRATION_RECEIPT`

The executable receipt compiler now rejects incomplete lane parity, dirty-source
acceptance, missing independent-audit evidence, missing integration evidence,
and any feature-admission transition that is not backed by the typed platform
merge receipt. Its pending output is intentionally not an acceptance claim.

The Controller must independently audit the cumulative platform candidate,
repair ordinary findings, preserve the audit receipt, and only then emit a
content-addressed merge receipt. It must not release feature work while this
receipt remains pending.

## Historical closeout finding

The original platform tasks were archived after their handoff documents were
preserved but before per-task audited integration receipts existed. Their
worktrees are therefore not reopened or treated as active work. The retained
handoffs and this receipt preserve the recovery path; the current Controller
must prove the cumulative audit and integration before accepting the phase.

No external action, provider action, Product write, deployment, publication,
push, or activation is claimed by this receipt.

## Central integration correction — 2026-08-09

The current cumulative worktree contains the source-bound offline and
provider-discovery repairs from the preserved private-control platform
candidate. The updated central binding covers 434 normative paths and has no
static digest mismatches. Inventory/report custody is 52 targets and 52
unique existing reports: 37 features, 12 governance lanes, and 3 platform
lanes.

This receipt remains pending rather than accepted. The worktree is
intentionally dirty, functional verification is still pending by instruction,
the visible task registry is bounded by the app listing window, and the five
governance task identities are not yet proven one-to-one. No task or worktree
is archived until downstream preservation and chat-out-of-scope proof are
complete.

## Current binding correction — 2026-08-09

The native-session source set and its digest-bound checkpoint contract are now
part of the cumulative merge candidate. The updated central binding covers 438
normative paths with zero static digest mismatches. This receipt remains
pending: the worktree is dirty and uncommitted, functional verification is
pending by instruction, and visible task parity is still not proven one to one.

## Current source correction — 2026-08-09

The central Controller repaired private-control bundle rollback and persisted
receipt readback, transport-export isolation, and project-source preservation
publication. The binding now covers 440 paths with zero static digest
mismatches. The merge receipt remains pending because the worktree is dirty,
functional proof and live host evidence have not been run, and exact visible
task parity is not established by the bounded app listing.

The executable pending receipt is preserved at
`docs/platform-handoffs/platform-foundation-merge-receipt-2026-08-09.json`.
It validates the three platform handoffs and current candidate digests while
truthfully keeping independent clearance, integration, and feature admission
at `PENDING`/`HOLD`.

The receipt instance is also included in the binding, bringing the current
static inventory to 441 paths with zero digest mismatches.

## Current platform-batch preservation correction — 2026-08-09

The three existing visible platform custodians have now completed their
source-bound handoffs. The corrected current model is 49 physical
feature/governance custodians (37 features and 12 governance lanes) plus three
logical platform aliases, with zero synthetic platform tasks or worktrees.
The executable receipt was refreshed to bind the current handoff hashes and
full canonical inventory digest. Its status remains
`PLATFORM_MERGE_CANDIDATE_PENDING_INDEPENDENT_CLEARANCE`, its feature
admission remains `HOLD`, and the central worktree remains dirty.

The central Controller preserved the handoff/report hashes in
`docs/platform-handoffs/platform-batch-preservation-2026-08-09.md`, audited
the candidate against central source, and rejected unreviewed dirty worker
bytes. Functional/native verification is still intentionally not run. No
feature wave is admitted until clean custody and independent clearance are
recorded.

## Current inventory-binding repair — 2026-08-09

The merge compiler now requires the full canonical feature-inventory digest
instead of deriving a digest from the receipt's compact count summary. The
executable receipt binds the current full-inventory digest and validates its
own refreshed merge digest. This closes a real admission mismatch; it does not
remove the functional-proof hold.

## Clean platform seed clearance — 2026-08-09

The preserved dirty assembly was copied into a separate cumulative platform
seed without changing the original evidence worktree. The seed is now the
source-bound platform candidate:

- Worktree: `AgentOS-platform-seed`
- Commit: `bd6c46253d921b94dd9b308ffaf93cfbcfe1bcac`
- Tree: `40d495f1599cd0b0f07de83748b74253b526b145`
- Working tree: `CLEAN`

The Controller's independent static audit accepted the seed for feature-wave
admission. Functional and live-host proof remain pending, so this is not a
production release claim. The platform merge receipt records
`PLATFORM_MERGE_ACCEPTED` with `feature_admission: READY` and binds all
subsequent feature work to this exact seed.

Integration receipt: `ref:platform-integration-2026-08-09`.
Candidate receipt: `ref:platform-seed-bd6c462`.
