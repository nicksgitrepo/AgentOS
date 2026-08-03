# AgentOS 2.1rc User Guide

AgentOS is a portable governance and orchestration kernel. It helps turn one clear owner outcome into working, verified software without embedding the project’s name, repository, provider, deployment, credentials, or domain policy.

## Start

1. Place AgentOS in the intended project root or select a separate project-context root.
2. Open [bootstrap/start-here.md](../bootstrap/start-here.md).
3. Allow safe read-only discovery if you want Bootstrap to answer mechanical setup questions.
4. Answer only unresolved intent, boundary, or preference questions.
5. Review the complete creation plan and its digests.
6. Approve exactly with `APPROVE_EXACT_PLAN` or revise the plan.

Bootstrap then stages a resumable setup transaction. If an authority corpus is imported or refactored, it creates and verifies `legacy.zip`, its manifest, index, and receipt before writing the new corpus. A distinct setup Auditor verifies the exact plan, readback, context separation, security baseline, persistent Runtime binding, and the three-root acceptance slice.

The plan also includes a deterministic Bootstrap coverage matrix. It shows
which outputs were discovered, owner-confirmed, safely defaulted, derived,
deferred, not applicable with proof, or still blocking. This lets Bootstrap
cover data, recovery, delivery, proof, and activation obligations without
asking one question for every field.

## What Bootstrap asks

Discovery supplies repository shape, source markers, authority/design candidates, deployment markers, and available tools without reading secrets or changing the project. The compact question compiler asks about:

- the project’s users, north star, first proving workflow, and boundary;
- the import mode when an existing project is detected: adopt in place, clean
  copy, normalize and audit, or reconstruct from intent;
- protected safety, legal, privacy, data-loss, spending, authentication, destructive-action, and intent limits;
- authority-corpus import/refactor/create choice;
- Design Bible and stack/testing/authentication/data constraints only when applicable or unresolved;
- one delivery-policy decision covering pushes, merges, CI runners, hosting/deployment, rollback, provider binding, and delivery cost;
- typed security standard and requirement identities;
- model economics and operating conditions;
- persistent Runtime and first-campaign context.

Bootstrap also compiles a Project Life Contract and Delivery Target. Together
they answer how real the first outcome needs to be, who may use it, what data it
may hold, how long it should live, and whether the route is a local workspace,
managed site, managed app, VPS, cloud, hybrid, or project-defined target. A
managed-site prototype or limited working product is available without making
a production claim.

For imported projects, Bootstrap records a deterministic Standards Registry and
Normalization Policy. It preserves the source before any migration build with
an archive, manifest, index, receipt, and explicit exclusion note. A full
normalization and four-lane audit is the first governed campaign, so setup does
not become an unbounded hidden implementation.

The existing protected-boundary answer becomes an enforceable Boundary
Contract. It separates immutable constitutional protections, owner-sovereign
decisions, derived operating limits, and temporary read-only probe boundaries.
More restrictive rules win, and a true hold pauses only its dependent outcome.

The compiled plan records safe defaults and honest unknowns. It does not recommend a model below the configured completion-reliability floor merely because it is inexpensive. `ECO_CONTINUOUS` represents a 168-hour week with up to twenty work slots; `STANDARD_WORKWEEK` represents 40 hours; `PERFORMANCE` prioritizes elapsed time; `CUSTOM` requires typed conditions. Recommendations minimize expected cost per accepted result, including retries and rework.

For the adaptive campaign cascade, Bootstrap keeps economics honest by
comparing the complete accepted-result cost with an equivalent direct result.
Token rates and estimates are not savings proof. The cascade becomes the
default for a task class only after at least three accepted observations show a
ratio of `0.75` or lower. Finalizer rewrite signals distinguish targeted repair
from a deliberate rebuild when the correction would reinterpret intent,
architecture, contracts, or the load-bearing implementation.

## Product acceptance

The Product engine has exactly three ordered roots:

1. `FUNCTION_REQUIREMENTS`
2. `DESIGN_BIBLE`
3. `SECURITY`

Answers are `YES`, `NO`, `UNKNOWN`, `NOT_APPLICABLE`, and `EXCEPTION_REQUESTED`. Lifecycle is separate: `UNEVALUATED`, `EVIDENCE_PENDING`, `OPEN_REPAIR`, `VERIFIED`, and `INVALIDATED`. The smallest changed question slice is compiled; unaffected evidence is reused only when its exact hashes and environment still match. Code quality is an audit discipline, not a fourth root.

## Campaign path

The default campaign uses one cumulative worktree lineage:

```text
Feature Agents build substantial checkpoints
        -> applicable read-only audits run concurrently
        -> terminal settlement
        -> fresh Campaign Finalizer correction batch
        -> delta-only audit
        -> three-root acceptance
        -> persistent Runtime integration/deployment
        -> independent live audit and exact closure
```

Platform Agents are created only on first material need. Each is a campaign-local logical capability with one stable worktree and sequential Feature-Agent leases. A second simultaneous supervisor is invalid. Runtime persists across campaigns and executes integration, deployment, rollback, and live mechanical checks.

The current Auditor may clear a release for deployment and produce a next-campaign candidate. That candidate orients only the next Campaign Orchestrator. No successor Auditor, Feature Agent, Platform Agent, Product writer, or campaign-start disposition exists before accepted-live closure and explicit next-campaign admission.

## Optional GPT_ASSIST

GPT_ASSIST is a Markdown exchange. The Auditor creates one exact, secret-free status packet and parses one canonical JSON response. ChatGPT can help with listed questions, research, scenarios, and comparisons. It cannot invent truth, mark findings fixed, write authority, change custody, deploy, or create a successor roster.

## Boundaries

Routine implementation failures, tests, compilation, integration, and reversible choices remain autonomous work. A true owner boundary is limited to protected safety/law/security/privacy/credential, unapproved cost, destructive production, stack or topology changes, promotion authority, or unresolved material intent. A hold pauses only its dependent outcome while unrelated work continues.

This repository remains `PREPARED_NOT_ACTIVATED`; it does not activate or rebind a Product campaign.
