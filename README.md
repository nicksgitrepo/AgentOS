# AgentOS

> **Status:** `2.1rc — PREPARED_NOT_ACTIVATED`

AgentOS is a work-in-progress operating system for autonomous software-development agents. It is portable and project-agnostic: this repository is the Bootstrap authority, not the Product you want to build.

## Start in three steps

1. Open this AgentOS repository and the project you want to create or import in your coding-agent host.
2. Start a fresh agent with the strongest economical coding model available. Do not choose a model below Bootstrap’s completion-reliability floor.
3. Copy and paste this instruction:

```text
Use this AgentOS repository only as the Bootstrap authority, not as the Product. Read bootstrap/start-here.md, verify the exact binding it names, and run Bootstrap against the project I give you. If the target project is unclear, ask only for its location. Begin with safe read-only discovery, ask one material question at a time, and make no consequential changes until I approve the exact creation plan.
```

Running Bootstrap as an agent uses the host’s agentic execution allowance. Use ordinary Chat or a private handoff-file exchange when you want advice without repository execution; use a public Git handoff only when public source exchange is intentional. Provider APIs and unattended automation may have separate billing and credentials.

## AgentOS in one minute

You explain what you want. Bootstrap inspects the project, preserves imported source before changing it, asks only what it cannot safely discover, and shows one exact plan. Economical agents build the first pass, independent auditors inspect it, a stronger Finalizer repairs the retained code, and persistent Runtime handles release and deployment.

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
- **Optional continuity:** import a predecessor handoff, preserve a legacy authority corpus, or recover context from selected sessions or files.
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
North Star, proving workflow, review transport, memory posture, and heartbeat
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
- Exact binding: [`schemas/bootstrap-binding.v1.json`](schemas/bootstrap-binding.v1.json)
- User guide: [`docs/user-guide.md`](docs/user-guide.md)
- Maintainer guide: [`docs/maintainer-guide.md`](docs/maintainer-guide.md)

From the repository root:

```text
node tests/verify-portability.mjs
node tests/verify-all.mjs
```

No license has been selected yet. This repository remains `PREPARED_NOT_ACTIVATED`; it does not activate, merge, deploy, or rebind a Product campaign.
