# Audit–Repair Integration Pyramid

This is the current rapid-prototyping campaign amendment for project-agnostic
AgentOS. It extends the existing platform-first controller in
`control/audit-driven-integration-pyramid.mjs`; it does not create a second
workflow.

## Operating order

```text
preserved checkpoint
    ↓
platform foundation and source-bound handoffs
    ↓
six rolling feature slots
    ↓
platform-domain intake and cumulative repair
    ↓
fresh central integration worktree
    ↓
central audit → smallest repair → hostile re-audit
    ↓
PRODUCTION_READY_PENDING_REAL_HOST or PREPARED_NOT_ACTIVATED
```

The durable amendment state is
`docs/audit-repair-integration-state.v1.json`. The complete feature-to-platform
map and deduplication roots are in `docs/platform-feature-map.v1.json`.
The compact external pull record is `docs/orchestrator-current-state.md`.

## Feature lanes

The queue is the exact order of the 37 capabilities in
`docs/feature-inventory.v1.json`. Every entry has one existing visible task,
one isolated worktree, one append-only `auditreport.md`, one cycle goal, and one
Platform return owner. A feature lane runs this cycle:

```text
AUDIT
→ SMALLEST_REPAIR
→ HOSTILE_SELF_AUDIT
→ AFFECTED_PROOF
→ HANDOFF
```

The Controller maintains six materially active slots while at least six
eligible queue entries remain. A clean candidate is frozen only after its
source-bound handoff, committed checkpoint, affected proof, and exact Platform
intake are acknowledged. The newly free slot then admits the next queue entry.

Feature lanes never merge, push, release, activate, accept themselves, edit a
peer worktree, or bypass protected Runtime authority. Reports are append-only
and end with `CURRENT STATE`.

Memory routing is an owner-authorized queue amendment recorded in
`docs/memory-routing-amendment.v1.json`. `ROADMAP_08_MEMORY_CAPSULES`,
`PROJECT_MEMORY_LEDGER`, `BOUNDED_PROJECT_MAPS`, and
`ROADMAP_10_MAPS_INTELLIGENCE` remain in the canonical inventory for historical
coverage but are excluded from the ordinary feature queue and ordinary
Platform consumption. Structured memory, replay/projection, capsule,
retention/retrieval/privacy, and equivalent derived-memory semantics route to
the single dormant `SPECIAL_MEMORY_ARCHITECTURE` lane owned by canonical task
`019fee1e-5e78-78c2-a788-ad7a27eba19e`; its state is
`DORMANT_DESIGN_PENDING` with no goal, worktree, product edit, integration, or
release custody. Existing reports, commits, worktrees, and proof remain
historical/unaccepted inputs. The filtered ordinary queue's next non-memory
capability is `ROADMAP_07_PROOF_ACCEPTANCE`, selectable only after a normal slot
opens and custody is explicit.

Features with the same `canonical_root_cause_id` share one root-cause
transaction. Their separate reports remain required, but they may not create
competing repairs for the same underlying seam.

## Six Platform domains

1. Portable Kernel, Declarative Gates, and Typed Contracts.
2. Governance Composition, Intent Regulation, Roles, and Task Routing.
3. Native Host, Workspace Isolation, Provider Capability, and Session Boundary.
4. Campaign Lifecycle, Evidence Identity, Handoffs, Recovery, and Acceptance.
5. Private Control, Project Memory, Replay/Projections, Capsules, and Bounded Intelligence.
6. Release Compatibility, Migration, Delivery/Closure, Security/Privacy, and Owner/Public Surface.

The current three visible Platform custodians remain the only physical Platform
tasks. Their domain assignments are explicit aliases in the state and map;
this amendment does not fabricate a fourth, fifth, or sixth task. A distinct
Platform task may be introduced only after a visible host task and source-backed
write custody exist. Until then, the existing owner alias and its affected seam
are the controlling record.

Platform owners consume feature handoffs in order into one cumulative domain
worktree, resolve shared seams, and keep a durable consumption cursor. A
Platform checkpoint is never central readiness. Central admission requires a
terminal feature queue, exact disposition for every capability, final cursors,
resolved cross-Platform agreements, current proof, and a clean source-bound
candidate.

## Two-phase Controller rule

For a new project, the Controller first records the selected technology stack,
repository plan, directory plan, routing, shared contracts, UI/design
direction, and unknowns. For an imported project, rapid development remains
closed until the owner supplies the typed approval required by the existing
workflow. Unresolved choices stay in the external `questions.txt` queue and
are asked in plain language.

Feature admission is not allowed until the Platform foundation handoffs are
source-bound and the Controller has independently audited and repaired that
foundation. After feature consolidation, the Controller repeats the same
audit–repair loop on the single authoritative worktree.

## Closeout and archive order

Archiving is dynamic and occurs only after all of these have been recorded:

```text
preserve typed handoff
→ persist handoff
→ independent audit
→ integrate accepted work
→ unpin session
→ close stale worktree
→ remove active task scope
→ mark chat out of scope
→ archive visible task
```

No step may be inferred from a later step. If a handoff, worktree, scope,
readback, or chat-out-of-scope receipt is missing, the task remains visible and
the Controller records the exact recovery action.

## Privacy and release boundary

Only relative repository references, opaque task/worktree IDs, digests, and
typed status records may enter the project-facing state. Secrets, credentials,
provider tokens, chat links, and private machine paths remain outside the
repository. Before a real host exists, only
`PRODUCTION_READY_PENDING_REAL_HOST` or `PREPARED_NOT_ACTIVATED` are valid final
states. Public release and activation remain separate owner decisions.

## Current checkpoint

ROADMAP_03 is preserved in the cumulative candidate at the commit and tree
recorded in `docs/audit-repair-integration-state.v1.json`. The next action is
to resume the six existing visible feature tasks against that exact candidate,
record their source-bound readbacks, and begin the rolling queue without
archiving any stale task prematurely.
