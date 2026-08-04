# AgentOS

> **Status:** `2.1rc — PREPARED_NOT_ACTIVATED`

AgentOS is a work-in-progress operating system for autonomous software-development agents. It is portable and project-agnostic: this repository is the public Bootstrap authority, not the Product you want to build.

## Keep the spaces separate

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

As a maintainer-only development arrangement, AgentOS may use three separate
repository roles:
a baseline/source repository, an active development repository, and a sterile
release repository. This does not prescribe a three-repository layout for a
consuming Product. Only the sterile release repository is a publication
candidate. See [repository roles](docs/repository-roles.md).

## Start in three steps

1. Find the absolute paths for this AgentOS checkout and the project you want to create or import. They should be separate directories. Bootstrap chooses a separate control-plane folder automatically unless you explicitly choose another one.
2. Start a fresh agent with the strongest economical coding model available. Do not choose a model below Bootstrap’s completion-reliability floor.
3. Replace `<AGENTOS_ROOT>` and `<PROJECT_ROOT>` in the instruction below with those exact paths, then copy and paste it:

```text
You are Bootstrap 2.1rc. AgentOS root: <AGENTOS_ROOT>. Project root: <PROJECT_ROOT>.
Use the AgentOS root only as the Bootstrap authority, not as the Product or its control plane. Read <AGENTOS_ROOT>/README.md, then <AGENTOS_ROOT>/bootstrap/start-here.md, verify <AGENTOS_ROOT>/schemas/bootstrap-binding.v1.json, and use the canonical controller at <AGENTOS_ROOT>/control/bootstrap-compiler.mjs.
Run the first read-only Bootstrap invocation exactly:
node "<AGENTOS_ROOT>/control/bootstrap-compiler.mjs" start "<PROJECT_ROOT>" RECOMMENDED
Use the returned discovery and question plan, ask only one material question at a time, and do not write, spend, authenticate, publish, merge, or deploy until Bootstrap displays the exact creation plan and I approve it with APPROVE_EXACT_PLAN. If either path is missing or unclear, ask for that path before discovery.
```

Running Bootstrap as an agent uses the host’s agentic execution allowance. Use ordinary Chat or a private handoff-file exchange when you want advice without repository execution; use a public Git handoff only when public source exchange is intentional. Provider APIs and unattended automation may have separate billing and credentials.

The prompt above is only for first-run Bootstrap discovery and setup. After
setup, the ongoing project-persistent role is **AgentOS Controller**
`AGENTOS_CONTROLLER`. It owns the control-plane conversation and safe
campaign coordination; Bootstrap does not continue as that role.

## AgentOS in one minute

You explain what you want. Bootstrap handles the first read-only discovery and
setup plan. After setup, AgentOS Controller carries the project-persistent
control-plane conversation and safe campaign coordination. Economical agents
build the first pass, independent checkers inspect it, a stronger Finalizer
repairs the retained code, and persistent Runtime handles release and
deployment.

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
- Repository roles: [`docs/repository-roles.md`](docs/repository-roles.md)
- Maintainer guide: [`docs/maintainer-guide.md`](docs/maintainer-guide.md)

From the repository root:

```text
node tests/verify-portability.mjs
node tests/verify-all.mjs
```

No license has been selected yet. This repository remains `PREPARED_NOT_ACTIVATED`; it does not activate, merge, deploy, or rebind a Product campaign.
