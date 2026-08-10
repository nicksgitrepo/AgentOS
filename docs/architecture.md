# AgentOS architecture

The public kernel is split into small layers with one direction of authority:

```text
Bootstrap
  -> shared general governance
  -> role-definition source + question tree
  -> generated role-specific governance
  -> source-bound session runner
  -> named rapid-prototype lanes
  -> thin working slice
  -> Intent Regulator and Runtime
```

The two governance libraries have different jobs:

| Layer | Source | Result |
| --- | --- | --- |
| General governance | `control/governance-library.mjs` | portable rules shared by every role |
| Role-specific governance | `control/role-governance-library.mjs` | a small role packet generated from the general rules, role definitions, and the compiled question tree |

`control/governance-role-definitions.mjs` is the canonical role seed. It keeps
the persistent roles (`Intent Regulator` and `Runtime`), the campaign roles,
and the one-lane worker template separate from the generated library.

The rapid prototype is deliberately divided into twelve named lane modules.
Each lane owns one kind of behavior and has a focused verifier. The index only
assembles those public functions; it does not contain the lane rules again.

The session runner is the only host-facing operation layer for the rapid team.
It requires real sibling sessions, the exact saved project binding, Luna/max
defaults, progress, handoffs, and closeout readback. It does not use shell text
as a substitute for a session identity.

Every governed task also carries the canonical question catalog from
`control/task-gate-questions.mjs`. The decision tree projects those questions
by context: task start, code change, documentation, handoff, response, and
closure. A safe answer is explicit for each question; an unsafe or unknown
answer routes to its named repair, review, or hard stop. Native session prompts
include the catalog digest and the exact applicable questions, so the worker
answers them before acting and before returning work.

The general governance library also owns `GENERAL_RESPONSE_HANDOFF_GATING`.
It applies the named catalog boundary to every documentation artifact,
progress statement, handoff, owner-facing response, and closure claim. A
`COMPLETE` response requires a catalog-complete evaluation, an independent
check, and a preserved typed handoff; `UNKNOWN` never passes and
`NOT_APPLICABLE` requires its applicability evidence. The legacy four-root
decision-tree API remains a compatibility surface only; it is not itself
evidence of universal catalog clearance.

The general governance closure invariant applies to every development mode,
including Bootstrap, import, rapid prototype (`RAPID_PROTOTYPE` and
`RAPID_PROTOTYPING`), ordinary iteration, campaign, cascade, apprenticeship,
and future modes. The Controller must preserve the typed handoff, persist that
preservation, independently audit and integrate the candidate worktree, unpin
the session, close the stale worktree, remove the task from active scope, place
the chat out of scope, and archive the visible task in that order. Archival is
dynamic: it happens immediately after that task's preserved handoff, accepted
integration, stale-worktree closure, active-scope removal, and explicit
chat-out-of-scope receipt exist. A mode cannot weaken or skip this sequence,
and a completed task is not left visible merely to make progress appear
continuous.

The general library also owns the universal closeout receipt contract
(`agentos.universal_task_closeout_receipts.v1`). Each step must carry its own
authoritative receipt and authority class. In particular, independent audit,
integration, chat-out-of-scope, stale-worktree closure, active-scope removal,
and host archival may not be collapsed into one boolean or inferred from a
worker's narration. Bootstrap, import, rapid prototype, iteration, campaign,
cascade, apprenticeship, and future modes inherit this same contract. The
plan-layer names `RAPID_PROTOTYPING` and `ITERATION` are bound to the same
policy as the executable workflow names; they are not escape hatches.

Some older transaction boundaries remain larger by design while compatibility
campaigns are migrated: Bootstrap’s setup transaction, campaign lifecycle and
cascade state machines, owner-review persistence, and the local self-development
adapter/worker. They are listed explicitly so a new large module cannot appear
silently. They are not additional governance libraries or new agent roles.
Shared content addressing is kept in `control/content-addressing.mjs`; the
lifecycle and owner-review boundaries consume it instead of carrying private
canonicalization copies.

The architecture verifier checks the import graph for cycles, enforces the
library direction, verifies all twelve lanes are wired, and keeps focused
modules within small line budgets. Generated runtime material belongs under an
external control plane; the ignored local `tmp/` directory is never part of the
public inventory.

### Four-library governance composition

The source-bound `FOUR_LIBRARY_GOVERNANCE` feature retains four distinct records with one-way authority:

| Layer | Source | Result |
| --- | --- | --- |
| Base general governance | `control/four-library-foundation.mjs` | release-owned portable rules and graph bindings shared by every role |
| Base-role governance | `control/four-library-foundation.mjs` | release-owned role packets bound to the base general digest and named lane graphs |
| Persistent project governance | `control/four-library-foundation.mjs` | project-owned additive graphs and role overlays that cannot override base authority |
| Generated project-role governance | `control/four-library-operations.mjs` | disposable least-privilege packets generated from the three parent libraries |

`control/four-library-governance.mjs` is the public facade. Its binding, migration, conflict, and append-only history contracts keep the four digests, ownership, lineage, upgrade preservation, rollback, and inactive activation boundary explicit. The older `governance-library.mjs` and `role-governance-library.mjs` pair remains a compatibility architecture-repair surface; it is not a second source of authority for the four-library feature.
