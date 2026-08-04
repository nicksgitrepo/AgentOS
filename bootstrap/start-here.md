# Governance 2.1rc Bootstrap — Start Here

Status: `PREPARED_NOT_ACTIVATED`

AgentOS is a portable setup and campaign-governance kernel. It contains no real project, repository, provider, deployment, credential, task, or domain identity. Those facts enter through a typed Project Context.

The binding at [schemas/bootstrap-binding.v1.json](../schemas/bootstrap-binding.v1.json) is the exact digest inventory. Verify it before consequential setup.

## Fresh-agent start contract

Before starting a fresh agent, replace these placeholders with absolute paths;
do not leave them literal:

```text
AGENTOS_ROOT = <absolute path to this AgentOS checkout>
PROJECT_ROOT = <absolute path to the project to create or import>
```

The agent must read the AgentOS `README.md` and this file, verify the binding,
and use the canonical controller. The first invocation is read-only and must
be run with both roots bound:

```text
node "<AGENTOS_ROOT>/control/bootstrap-compiler.mjs" start "<PROJECT_ROOT>" RECOMMENDED
```

That command returns a content-addressed discovery result and the current
output-gap question plan. It does not write the project, authenticate, spend,
publish, merge, deploy, or create a campaign. The agent continues from that
returned plan through the exported functions in
`control/bootstrap-compiler.mjs`; compatibility entrypoints are not substitutes
for the canonical controller. If either root is missing, ambiguous, not a real
directory, or changes after discovery, Bootstrap stops and asks for correction.

## Bootstrap path

```text
read-only discovery
        -> deterministic output-gap coverage
        -> compact unresolved questions
        -> complete exact creation plan
        -> display plan and digests
        -> APPROVE_EXACT_PLAN
        -> run bound local delivery probes
        -> resumable staging transaction
        -> persistent AGENTOS_CONTROLLER state bound to Controller Runtime readback
        -> independent setup audit
        -> sealed project context and authority corpus
```

Bootstrap may discover facts but cannot turn a discovery fact into owner intent. It asks only for material intent, protected boundary, or unresolved choice. It chooses safe configuration defaults when governance already supplies them and reports those defaults in the plan.

The output-gap matrix is the canonical planning inventory. It records every
creation, trust, data, delivery, recovery, evidence, and activation obligation,
including rows that resolve through discovery, a safe default, derivation, or an
explicit unavailable state. It is not a second questionnaire. Only material
rows with `OWNER_REQUIRED`, `DEPENDENCY_PENDING`, or `CONFLICT` create a user
question or block exact-plan compilation.

Discovery is secret-free, read-only, root-contained, and deterministic. It may inspect repository shape, source markers, authority/design candidates, CI/hosting/deployment markers, local Git state, and available local tools. It never authenticates, stores credentials, spends money, publishes, deploys, deletes, or mutates the source.

## Questions

The compact catalog covers:

- project identity, boundary, users, outcome, and non-goals;
- the north-star intent and smallest complete workflow;
- protected safety, legal, privacy, data-loss, spending, authentication, destructive-action, and intent boundaries;
- authority-corpus source and legacy preservation;
- design authority and required user/device/state coverage when visible surfaces exist;
- stack, testing, authentication, data, and observability requirements;
- delivery policy: pushes, serialized merges, CI runner route, hosting/deployment route, rollback, provider binding, and cost boundaries;
- security standard identity and atomic requirement IDs;
- model economics and operating conditions;
- persistent Runtime binding and the first campaign context.
- project life: whether the first outcome is a prototype, limited working
  product, beta, or production, plus audience, data posture, lifetime,
  maintenance, and retirement when those choices materially affect the route;
- delivery target: local, managed site, managed app, VPS, cloud, hybrid, or a
  project-defined target, with explicit limitations;
- one enforceable boundary contract derived from constitutional rules, owner
  boundaries, delivery/life limits, and read-only probe prohibitions.
- one project-import decision when discovery finds an existing project, with
  `ADOPT_IN_PLACE`, `CLEAN_COPY`, `NORMALIZE_AND_AUDIT`, and
  `RECONSTRUCT_FROM_INTENT` modes;
- a version-pinned Standards Registry and compatibility-first Normalization
  Policy;
- a source-preservation archive, manifest, index, receipt, and exclusion note
  before any import build or refactor.
- a content-addressed Global Policy State with independently amendable
  variables, dependency invalidation, safe effective boundaries, and an
  append-only amendment ledger;
- a recommended `USER REVIEW CAMPAIGN` route for substantial or ambiguous work,
  with project-only memory, optional Voice, host-catalog model recommendations,
  and authenticated exact approval over one candidate digest.

The user should not have to answer questions that exact discovery or a safe governance default can settle. If a fact is unavailable, the plan records `UNKNOWN` or an explicit unavailable behavior rather than inventing a choice.

## Creation plan and approval

The compiled plan covers the project outcome and first useful workflow,
import and source preservation, normalization and standards, product
requirements, design and security, delivery, boundaries, models, persistent
Runtime, and the first campaign. Those are stored as typed machine fields;
the owner-facing summary uses ordinary language.

It also records `GLOBAL_POLICY_STATE` and `OWNER_REVIEW` so later mode,
model-class, North Star, delivery, or review changes can be compiled as exact
amendments instead of silently changing scattered controller constants.

It also carries the content-addressed `bootstrap_coverage`, project life,
delivery target, and boundary contract results. The complete creation plan, typed Project
Context, delivery probes, and setup Auditor must bind those results to the exact
discovery and normalized answers.

The owner approves the exact displayed plan with:

```text
APPROVE_EXACT_PLAN
```

Approval binds both the plan digest and the discovery digest. A changed plan, changed discovery, changed source observation, or mismatched digest is rejected. Generic `PROCEED` is not a valid setup decision.

Execution is resumable and transactional. It stages under the admitted project root, verifies readback, initializes `agentos/controller-state.json` for the persistent `AGENTOS_CONTROLLER`, seals state, and promotes only after the independent setup Auditor confirms the selected plan, context separation, no secrets, Runtime and Controller Runtime bindings, authority-corpus output, and the three-root slice. Re-running a sealed plan is idempotent; a different plan cannot overwrite it. A missing Controller Runtime adapter is unavailable and blocks setup; Bootstrap never invents the controller identity.

## Legacy preservation

When an authority corpus is imported or refactored, Bootstrap first creates and verifies these files at the new authority root:

```text
legacy.zip
legacy.manifest.json
legacy.index.jsonl
legacy.receipt.json
```

The archive preserves exact source bytes and records source repository/commit/tree or an explicit non-Git observation, dirty/untracked state, exclusions, entry hashes, and readback. The source is rechecked before replacement writes. The archive is historical lookup, never current authority.

When a whole project is imported, the separate source-preservation controller
creates `source-preservation.zip`, its manifest, index, receipt, and
`import-exclusions.md` before the first migration build. This archive is source
provenance, not current authority. Normalize and audit work runs as the first
governed campaign in a separate destination.

## Authority corpus

Creation is project-context driven and produces the canonical roots: project context, goals, Design Authority, features, platform capabilities, campaigns, decisions, cases, evidence indexes, archive, and an evidence library. Root variables and article numbering come from [governance/2.1rc/portable-authority-corpus-format.md](../governance/2.1rc/portable-authority-corpus-format.md). Imported accepted article IDs are preserved; new feature-capsule and extension IDs are allocated sparsely by unsigned UTF-8 order and never renumbered.

Project-specific extensions may add facts or stricter constraints, but cannot weaken or rewrite the portable kernel. Feature capsules use sparse, collision-checked article IDs; an empty 100-number block is never reserved merely because a feature exists. A clean synthetic project must compile without product-specific context.

The default target can remain a private prototype. A managed-site target may be
selected for a prototype or an explicitly limited working product; the target
never invents provider capabilities or grants deployment authority.

## Model economics

Bootstrap recommends models against a typed completion-reliability floor, capability requirements, current market snapshot, host capacity, rate limits, concurrency, duty cycle, deadlines, and budget. It estimates expected cost per accepted result, including retries and rework. A cheap model below the completion floor is excluded. `ECO_CONTINUOUS` describes a 168-hour week with up to twenty work slots; `STANDARD_WORKWEEK` describes 40 hours; `PERFORMANCE` prioritizes elapsed time; `CUSTOM` requires typed conditions. No eligible or feasible model fails closed.

## Product acceptance

The Product engine has exactly three ordered roots:

1. `FUNCTION_REQUIREMENTS`
2. `DESIGN_BIBLE`
3. `SECURITY`

Answers are `YES`, `NO`, `UNKNOWN`, `NOT_APPLICABLE`, or `EXCEPTION_REQUESTED`. Lifecycle is separate: `UNEVALUATED`, `EVIDENCE_PENDING`, `OPEN_REPAIR`, `VERIFIED`, or `INVALIDATED`. A repair invalidates only dependent answers. Code quality is an audit discipline, not a fourth root.

## First campaign handoff

Bootstrap remains separate from Product execution. After setup is independently audited and explicitly admitted, the first campaign compiles one cumulative root by default. Platform Agents are created on demand as a campaign-local reusable pool with sequential Feature-Agent leases. Runtime remains persistent across campaigns.

The current Auditor may clear a release for deployment and prepare a next-campaign candidate. That candidate creates only an orientation-only next Campaign Orchestrator. No next Auditor, Feature Agent, Platform Agent, Product writer, or campaign start exists before accepted-live closure and explicit admission.

## Optional assistant handoff

An assistant handoff is a plain-language Markdown exchange. The owner may
answer naturally, including by voice, and may return a Markdown note, a private
file, an admitted Git handoff, or an authorized connected conversation. A
separate adapter may carry a structured return for reliable reconciliation, but
the owner is never asked to write or inspect the machine packet. A connected
assistant may help with listed questions, research, scenarios, and comparisons,
but cannot invent truth, mark findings fixed, write authority, change custody,
deploy, or create a successor roster.

## User Review Campaign

The recommended owner-facing planning route is `USER REVIEW CAMPAIGN`, machine
type `PRE_CAMPAIGN_OWNER_REVIEW`. The Orchestrator mints a read-only packet from
the current project, source commit/tree, policy epoch, and next-campaign
candidate. Ordinary Chat or Voice asks short natural questions one at a time;
the next question depends on the owner’s answer. The owner may return a plain
Markdown note or one structured payload, and the result remains advisory.

The Orchestrator classifies the return, compiles policy and context deltas,
recompiles affected Function/Design/Security questions, and shows one exact
approval packet. A conversational “yes” or shared link cannot activate it.
Only authenticated exact approval admits the candidate; the review controller
itself never writes Product or spawns Product agents.

## Activation boundary

This package remains `PREPARED_NOT_ACTIVATED`. It does not merge, deploy, activate, or rebind a Product campaign.
