# AgentOS

> **Status:** `2.1rc — PREPARED_NOT_ACTIVATED`

AgentOS is a work-in-progress operating system for autonomous software-development agents. It is portable and project-agnostic: this repository is the public Bootstrap authority, not the Product you want to build.

## Start AgentOS

The Bootstrap entrypoint is:

`bootstrap/START-HERE.md`

For the short, plain-language start sequence, read [`BOOTSTRAP.md`](BOOTSTRAP.md). It describes the one-time Bootstrap-to-Spawner start, the Project Owner role, and the Pyramid and Collaborative Audit workflow choices. The typed files under `control/` and `schemas/` remain authoritative.

Feature work follows a bounded planner → implementer → Orchestrator review
loop. A capability-strong planner writes a careful, comprehensive plan with
clear non-goals and detailed implementation instructions, without
over-engineering, premature abstraction, or scope creep. Economical, capable
subagents implement it in an isolated work area and run the assigned tests, but
never review, judge, or accept their own work. The Orchestrator independently
accepts the candidate or returns detailed, issue-bound repair instructions until it passes.
Model names such as `Luna xhigh` are suggestions only: the current canonical
model policy chooses the actual model. See the [feature-loop guide](docs/feature-planner-implementer-review-loop.md),
[feature plan template](templates/feature-planning/FEATURE_PLAN.md), and
[Orchestrator review template](templates/feature-planning/ORCHESTRATOR_REVIEW.md).

From this checkout, its full path is:

`<AGENTOS_ROOT>/bootstrap/START-HERE.md`

To begin, open the directory that will be your project root and give a capable coding agent this instruction:

```text
You are Bootstrap 2.1rc.

Rename yourself "Bootstrap 2.1rc" and pin your task if the environment supports task names and pinning.

The project root is the directory in which you were started. Do not assume any product, repository, provider, model, browser, test framework, authentication system, hosting target, or deployment policy.

Read and follow the Bootstrap instructions at:
<AGENTOS_ROOT>/bootstrap/START-HERE.md

Run discovery first. Confirm material findings with me one question at a time. Help me import an existing authority corpus, refactor an earlier governance project, or create a new project configuration. Do not launch a development campaign until Bootstrap reaches its explicit launch confirmation.
```

For another installation, replace the absolute path with:

`<AGENTOS_ROOT>/bootstrap/START-HERE.md`

The public source is the default branch of this repository; no consumer
project identity belongs in the portable Bootstrap authority.

## Keep the spaces separate

## Repository layout

- `bootstrap/` — user-guided environment discovery and configuration entrypoint.
- `governance/2.1rc/` — normative portable governance for this release candidate.
- `authority/templates/` — project authority-corpus and context templates.
- `control/` — executable controllers, compilers, and maintainers.
- `schemas/` — machine-readable contracts.
- `tests/` — positive, hostile, portability, and determinism tests.
- `docs/` — user and maintainer documentation.
- `migrations/` — tools and mappings for importing earlier governance generations.
- `examples/` — generic examples with no real project identity.

AgentOS uses three different spaces:

- **Public AgentOS repository:** reusable code, contracts, documentation, tests, and synthetic examples.
- **Product repository:** the user’s application or other project source.
- **AgentOS control plane:** private conversations, authority, controller state, campaign state, evidence, handoffs, and source-preservation records.

Bootstrap keeps the AgentOS home/control plane separate from the Product by
default. The owner may keep it locally, in its own Git repository, or as a
hybrid with Git-backed durable material and local-only working material.
Storing it inside the Product repository is an explicit opt-in, not the
default.

The public repository must never contain secrets, private paths, private
conversations, owner handoffs, credentials, or runtime state from another
project. A clean public distribution is prepared from the development copy
only after the portability and hostile-boundary checks pass.

Rapid prototyping can follow the project-agnostic Audit-Driven Integration
Pyramid or the six-at-a-time Collaborative Audit workflow. For a new project, the Controller records the selected stack,
repository plan, and directory structure before work begins. For an imported
project, it binds the source readback and waits for explicit owner approval
before rapid development. The campaign first establishes and merges the
platform foundation, then admits feature audit and repair waves from that
accepted skeleton, and finally converges everything in one central integration
tree.
Temporary tasks are archived only after their handoffs are preserved and their
worktrees are consumed downstream.

As a maintainer-only development arrangement, AgentOS may use three separate
repository roles:
a baseline/source repository, an active development repository, and a sterile
release repository. This does not prescribe a three-repository layout for a
consuming Product. Only the sterile release repository is a publication
candidate. See [repository roles](docs/repository-roles.md).

## Start in three steps

1. Open the AgentOS checkout and the project you want to set up.
2. Start a fresh agent using Bootstrap’s normal default.
3. Send only this short message:

```text
Use Bootstrap to evaluate this project and guide me through setup.
```

Bootstrap owns the conversation rules: it keeps the owner conversation plain,
asks one short question at a time, and asks only for the earliest material
choice it cannot discover or safely decide. The startup message stays short so
the governance, not a copied prompt, supplies that behavior.

For a direct launch where the host does not already provide the two folders,
replace `<AGENTOS_ROOT>` and `<PROJECT_ROOT>` in the instruction below with
their exact paths, then copy and paste it:

```text
You are Bootstrap 2.1rc. AgentOS root: <AGENTOS_ROOT>. Project root: <PROJECT_ROOT>.
Use the AgentOS root only as the Bootstrap authority, not as the Product or its control plane. Read <AGENTOS_ROOT>/README.md, then <AGENTOS_ROOT>/bootstrap/start-here.md, verify <AGENTOS_ROOT>/schemas/bootstrap-binding.v1.json, and use the canonical controller at <AGENTOS_ROOT>/control/bootstrap-compiler.mjs.
Run the first read-only Bootstrap invocation exactly:
node "<AGENTOS_ROOT>/control/bootstrap-compiler.mjs" start "<PROJECT_ROOT>" RECOMMENDED
Use the returned discovery and question plan. The normal Bootstrap mode is JSA-style: after the material questions are answered, continue only the declared local setup work while the source, intent, scope, and host readbacks remain unchanged. Stop and reassess when scope changes or a protected action is requested. Publication, push, merge, deployment, rollback, spending, authentication, secrets, destructive overwrite, Product custody, and campaign activation always retain their own exact authority boundary. If either path is missing or unclear, ask for that path before discovery.
```

Running Bootstrap as an agent uses the host’s agentic execution allowance. Use ordinary Chat or a private handoff-file exchange when you want advice without repository execution; use a public Git handoff only when public source exchange is intentional. Provider APIs and unattended automation may have separate billing and credentials.

The prompt above is only for first-run Bootstrap discovery and setup. Bootstrap
may start exactly one Spawner, then becomes the **Product Owner**. The
**Controller** regulates workflow and useful progress; the Product Owner owns
user intent and ordinary human conversation. They are separate permanent roles
with separate fifteen-minute checks. Spawner alone creates and retires agents.

## AgentOS in one minute

You explain what you want. Bootstrap handles the first read-only discovery and
setup plan. Bootstrap becomes the Product Owner only after the one-time Spawner start.
Product Owner keeps the work aligned with your intent, while Controller keeps
the workflow moving. Economical agents
build the first pass, independent checkers inspect it, a stronger Finalizer
repairs the retained code, and persistent Runtime handles release and
deployment.

The Controller keeps moving by itself: it watches campaign handoffs and worker
heartbeats, re-binds unchanged intent and acceptance records to the exact source
it is observing, and chooses the next safe task from the active campaign. Before
the first checkpoint, that means routing the bound first useful workflow through
the Campaign Orchestrator, named lane workers, Independent Auditor, and Finalizer. After a
checkpoint, it rechecks the result and continues watching. Hard boundaries stop
only the dependent work; soft boundaries go to campaign review. Routine puzzles
do not wait for an outside prompt.

The owner-facing flow stays conversational: when a real finish choice is needed,
it asks, “When we're ready, what should I do with it?” and shows simple numbered
choices while keeping the delivery details and campaign design behind the scenes.

The cascade is measured by the cost of the complete accepted result, not by
token prices alone. AgentOS keeps it as the default for a task class only after
at least three accepted observations show a cascade-to-direct-result ratio of
`0.75` or lower. If Finalizer work becomes a second implementation, the pass is
classified as a rebuild rather than quietly called a repair.

## Main choices

- **New project (`NEW_PROJECT`):** build a clean project from your intent.
- **Adopt in place (`ADOPT_IN_PLACE`):** add governance around an existing project without changing its Product files.
- **Clean copy (`CLEAN_COPY`):** create a separate copy while preserving the source and behavior.
- **Normalize and audit (`NORMALIZE_AND_AUDIT`):** create a separate destination, normalize structure and naming, run the four independent audit lenses—`FUNCTIONALITY`, `DESIGN_UI_SHELL_NAVIGATION`, `SECURITY`, and `CODE_QUALITY_HYGIENE`—then repair the result as the first governed campaign.
- **Rebuild from intent (`RECONSTRUCT_FROM_INTENT`):** use an existing project as reference while constructing a cleaner replacement.
- **Prototype, limited product, beta, or production:** choose how real, public, durable, and maintained the first outcome should be.
- **Local, managed site, VPS, cloud, or hybrid:** Bootstrap recommends the smallest capable delivery route from the project’s actual needs.
- **Eco, standard, or performance:** choose the operating condition; the cheapest model is rejected when it is unlikely to finish reliably.
- **Separate control plane:** keep governance, conversations, evidence, and handoffs outside the Product repository by default; opt in to an in-project control plane only when wanted.
- **Optional continuity:** import a predecessor handoff, preserve a legacy authority corpus, or recover context from selected sessions or files in the control plane.
- **User Review Campaign:** talk through the next campaign in ordinary Chat or Voice before AgentOS spends agentic usage; the Orchestrator returns one exact candidate and model recommendation for approval.

## Why use it?

AgentOS is designed to provide:

- high autonomy with fewer routine questions;
- economical first-pass construction with stronger final correction;
- independent Function, Design, Security, and code-hygiene inspection;
- exact checkpoints, rollback, recovery, and persistent deployment knowledge;
- source and documentation preservation before import or refactor;
- explicit owner boundaries for intent, spending, authentication, publication, destruction, and production.

The tradeoffs are honest: this is still an unactivated release candidate; deep normalization, continuous audit, and high-assurance work cost more and take longer; provider capabilities and permissions vary; and the owner remains necessary at genuine authority boundaries.

## Project protection

AgentOS does not silently spend money, publish source, expose secrets, delete accepted work, change repository ownership, or deploy production. Imported documents and predecessor agents are evidence, not authority. A real hold pauses only the affected outcome while unrelated safe work continues.

## Policy and owner review

AgentOS keeps campaign behavior in a content-addressed Global Policy State. The
owner can change declared variables such as campaign mode, role model class,
North Star, first useful workflow, review transport, memory posture, and heartbeat
preference. Dependencies, invalidated question slices, safe effective
boundaries, and required rotations are calculated and retained in an amendment
ledger. Constitutional rules cannot be weakened by a project setting.

For substantial or ambiguous work, the recommended route is a `USER REVIEW CAMPAIGN`.
It is advisory until the Orchestrator reconciles the return and the
owner gives authenticated exact approval over one digest. Chat memory supplies
continuity only; it never overrides the current packet. A review packet cannot
write Product, spawn Product agents, authorize spending, merge, deploy, or
delete.

## Start-here and verification

- Bootstrap entrypoint: [`bootstrap/start-here.md`](bootstrap/start-here.md)
- Fresh-agent start contract: replace the two path placeholders in the instruction above, then run `node "<AGENTOS_ROOT>/control/bootstrap-compiler.mjs" start "<PROJECT_ROOT>" RECOMMENDED` for the first read-only discovery and question plan. The result includes the separately bound control-plane root.
- Exact binding: [`schemas/bootstrap-binding.v1.json`](schemas/bootstrap-binding.v1.json)
- User guide: [`docs/user-guide.md`](docs/user-guide.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Repository roles: [`docs/repository-roles.md`](docs/repository-roles.md)
- Maintainer guide: [`docs/maintainer-guide.md`](docs/maintainer-guide.md)

From the repository root:

```text
node tests/verify-source-hygiene.mjs
node tests/verify-portability.mjs
node tests/verify-all.mjs
```

No license has been selected yet. This repository remains `PREPARED_NOT_ACTIVATED`; it does not activate, merge, deploy, or rebind a Product campaign.
