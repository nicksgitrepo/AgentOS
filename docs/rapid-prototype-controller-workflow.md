# Audit-Driven Integration Pyramid

The canonical rapid-prototype controller is
`control/audit-driven-integration-pyramid.mjs`. The historical
`control/rapid-prototype-workflow.mjs` name is only a compatibility entry
point; it re-exports the same controller and does not implement a second
workflow.

## Project setup

The Controller first discovers the project boundary, repositories, declared
tooling, source baseline, and applicable instructions without touching the
user's primary checkout.

For a new project it records the owner's selected technology stack and creates
a source-bound plan for repositories and relative directories before feature
work starts. For an imported project it binds the source readback and requires
explicit owner approval for rapid development. Without that approval the
workflow remains discovery-only.

Project setup state and unresolved questions live in the external Controller
authority. Product source, reports, and handoffs do not contain secrets,
private machine paths, private links, or credentials.

When an existing campaign is being adopted, the Controller first validates
docs/rapid-prototype-migration.v1.json against
schemas/rapid-prototype-migration.v1.json. It preserves dirty worktrees and
reports without physically moving or deleting host-managed worktrees. Missing
visible platform-task parity remains a hold; prior platform reports do not
substitute for visible source-bound tasks.

## Three convergence phases

```text
feature audit and repair
    -> platform-domain integration and distillation
    -> central integration and distillation
```

Feature and platform rosters are derived from the canonical inventory and the
runtime-only visible task registry. Each target must have exactly one visible
task, isolated worktree, append-only audit report, persistent goal, and
source-bound handoff. A mismatch is orchestration work, never a reason to
invent a task or report.

Feature agents work in rolling waves. They audit intent, completeness,
correctness, security, privacy, scope isolation, durability, failure states,
minimality, hygiene, seams, and regression risk. They repair ordinary gaps,
self-audit, re-audit, and return a coherent local handoff. The report keeps
history and appends resolutions; it does not become a proof-theater receipt
library.

Platform agents selectively consume compatible feature candidates and reshape
them into coherent domain candidates. They coordinate shared interfaces,
record a disposition for each feature-to-platform seam, and reject duplicate,
speculative, or unsupported work.

Central is the only final integration authority. It starts from a fresh
worktree, admits platform candidates in dependency order, removes duplication,
repairs integration defects, performs a final source-level security and
privacy pass, and repeats audit -> repair -> re-audit until the result is a
`PRODUCTION_CANDIDATE_PENDING_TESTS`.

## Dynamic closeout

A temporary task is archived only after its typed handoff is preserved, its
worktree is independently audited and consumed downstream, its stale worktree
is closed, its active scope is removed, and its chat is out of scope. If any
condition is missing, the task and worktree remain available. This applies to
features, platforms, imports, and every rapid-prototype mode.

The campaign does not deploy, release, start Product hosting, or claim live or
user validation. It uses only the project's declared verification tools.
