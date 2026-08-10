# Platform foundation Controller repair record

Status: `PLATFORM_FOUNDATION_REPAIR_IN_PROGRESS`

Authority: `OPAQUE_PYRAMID_AUTHORITY_SOURCE_REF [REDACTED_FOR_PORTABLE_RECORD]`

Authority SHA-256: `a882a74b6a71ba1fe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`

Canonical source baseline: commit `590c07ddd4be7a8c24727c24b40808e44ca7357d`, tree `f1b358d87e6a969fb9631e202a3d478540edd4d9`

## Controller changes

- Added typed inactive imported-project rapid-development approval and a named schema.
- Bound imported approval to project/source identity and rejected boolean-only or unactivated approval records.
- Added a named `PLATFORM_MERGE_COMPLETE` gate compiler, validator, and persisted workflow field.
- Replaced the historical platform-before-feature transition with the current feature-audit -> platform-integration -> Central sequence. Platform intake may begin when the first completed feature candidate arrives; the platform merge gate is required only before Central integration.
- Derived platform handoffs from explicit source-bound applicability data instead of an unconditional twelve-lane roster.
- Preserved missing visible-task parity as a fail-closed hold; no task records were invented.
- Removed synthetic rapid-prototype readiness: authoritative source readback, scheduler admission, and scheduler terminal proof are required.
- Removed direct verification execution from the bounded verification path; it now fails closed without scheduler-owned receipts.

## Current holds

- The canonical inventory currently has an explicit empty platform applicability graph because no cross-feature Product domain is proven.
- Five governance-lane task bindings remain undiscoverable and must not be fabricated; they are not platform-domain tasks.
- Scheduler admission receipt production and mechanical process ownership remain incomplete beyond the new receipt contract.
- No functional tests or npm commands have been run by policy.
- The canonical tree remains dirty and uncommitted; no release or archive action is permitted.

## Custody

All existing visible task worktrees and handoff records remain preserved. No visible task was archived, deleted, replaced, or created by this repair.

## Pyramid authority reconciliation

Earlier platform-first statements in preserved records are historical evidence from the superseded workflow. They do not control the active state machine.

The updated authority distinguishes governance audit lanes from active platform lanes. The seven preserved `LANE_01` through `LANE_07` records are therefore retained as governance-lane custody and are not reused as Product platform ownership. The canonical inventory now has separate `platform_domains` and `platform_lanes` tables. Because the current source does not prove a cross-feature technical domain, both are explicitly empty, with platform parity at zero. No platform task, worktree, goal, or report was invented or reassigned.

Imported project plans now persist opaque worktree references for destination and preservation roots. Host paths are accepted only through the execution boundary and are required again as host-only inputs for Bootstrap execution and setup audit. Raw path fields are rejected from persisted import plans.

The remaining platform hold is now typed as `PLATFORM_DOMAIN_DISCOVERY_HOLD`, not as a twelve-lane platform-task failure. The missing five governance task bindings remain a separate `INCOMPLETE_VISIBLE_TASK_PARITY_HOLD` and are preserved without fabrication.
