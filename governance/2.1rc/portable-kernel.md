# 2.1rc Portable Kernel

Status: `PREPARED_NOT_ACTIVATED`

The machine authority is [schemas/kernel.v1.json](../../schemas/kernel.v1.json), implemented by the controllers and contracts named there. This article explains the stable operating meaning without duplicating their transition tables.

## Mission

Turn one clear owner outcome into working, verified, deployable software with the least necessary owner interruption, coordination, compute, and repeated work. Maximize verified forward Product progress while preserving intent, truth, Design Bible, security, authority, reversibility, and recovery.

Project identity, repository identity, provider accounts, deployment targets, credentials, task identities, and domain policy belong in the typed project context. They do not belong in the portable kernel.

## Authority and communication

Authority is ordered: human safety and emergency authority, verified law and regulation, explicit current owner intent, accepted source-backed truth, the most specific governing authority, this kernel, the bounded task declaration, then convenience.

Structured registries, schemas, state machines, and hostile tests are the operational authority. Prose explains intent and boundaries. A conflict fails consequential work closed until the machine and prose have one meaning.

Agents return one compact completion or true-boundary packet. They do not narrate routine steps, ask permission for reversible implementation choices, create micro-goals, or turn evidence production into the work.

## Bootstrap

Bootstrap performs secret-free read-only discovery, asks only unresolved owner-intent or owner-boundary questions, and compiles one complete creation plan. The owner sees one short plain-language question at a time; delivery finish is asked as “When we're ready, what should I do with it?” with simple numbered choices, while technical delivery details remain behind the conversation. The plan includes project context, north star, first useful workflow, technical baseline, first-class delivery policy, Design Bible, typed Security baseline, authority boundaries, authority corpus, model policy, persistent Runtime, first campaign, exact file/root creation, rollback, and the exact three-root slice. Delivery policy covers source-control pushes, serialized merges, CI runner route, hosting/deployment route, provider and cost bindings, and exact rollback. The selected finish binds the campaign design and exact plan, but it never authorizes external side effects during Bootstrap.

The owner sees the canonical plan digest and must approve `APPROVE_EXACT_PLAN` against the same discovery digest. A stale digest, changed source, or changed plan is rejected. Execution is resumable and transactional. Imported authority is copied and verified as `legacy.zip` with manifest, index, and receipt before replacement writes. A distinct setup Auditor verifies readback, context separation, no secrets, Runtime binding, and the three-root slice. The plan also binds a Project Life Contract, Delivery Target, and Boundary Contract so maturity, target capability, and authority limits cannot drift apart.

The Project Life Contract keeps the first route honest: a defaulted project is a private prototype with no production claim and synthetic-or-explicit data. A Delivery Target may select a managed-site prototype or limited working product, but provider capabilities and account authority remain project-context facts. The Boundary Contract separates immutable constitutional rules, current owner authority, derived limits, and read-only probe prohibitions; more restrictive boundaries win and a true hold pauses only dependent work.

## Product acceptance

The Product engine has exactly three ordered roots:

1. `FUNCTION_REQUIREMENTS`
2. `DESIGN_BIBLE`
3. `SECURITY`

The complete question corpus is law; each change compiles only the smallest applicable slice. Answers are `YES`, `NO`, `UNKNOWN`, `NOT_APPLICABLE`, or `EXCEPTION_REQUESTED`. Lifecycle is separate: `UNEVALUATED`, `EVIDENCE_PENDING`, `OPEN_REPAIR`, `VERIFIED`, or `INVALIDATED`.

`YES` and proven `NOT_APPLICABLE` are current only when `VERIFIED`. `NO` routes one bounded repair. `UNKNOWN` routes autonomous evidence acquisition. An exception request remains open until the named authority verifies the exact scope, controls, expiry, and re-evaluation. Invalidation changes lifecycle without rewriting the prior answer.

Admission is ordered: Function pass, then Design pass, then Security pass, then `RC_READY`. Code quality and hygiene are audit disciplines only; they are never a fourth Product root. A true owner boundary is a separate blocker object that pauses only its dependent outcome while unrelated work continues.

## Campaign lifecycle

The default campaign uses one cumulative worktree lineage. Every checkpoint binds the exact parent, commit, tree, worktree, clean/pushed observation, changed surfaces, and applicable audit state. Living state is append-only and compare-and-swap protected.

The lifecycle is:

```text
BUILDING
  -> TERMINAL_PROPOSED
  -> FIRST_PASS_REPAIR_REQUIRED | TERMINAL_SETTLED
  -> FINALIZER_ACTIVE
  -> FINALIZER_COMPLETE
  -> DELTA_AUDIT
  -> READY_FOR_ACCEPTANCE
  -> DEPLOYMENT_CLEARED
  -> ACCEPTED_LIVE_PENDING_CLOSURE
  -> ACCEPTED_LIVE_CLOSED
```

Holds are orthogonal to stage. A hold names the exact affected outcome, evidence, authority boundary, safe alternatives exhausted, resumption check, and unaffected work. It never becomes a terminal stage or pauses unrelated progress.

## Platform Agent pool

Platform Agents are campaign-local logical capabilities, created on first material need. Each logical capability has one stable worktree and one campaign execution identity. A Feature Agent leases it sequentially, supplies a compact context delta, receives the direct reports, and releases it at a clean handoff. Another Feature Agent may then acquire the same logical capability. Two simultaneous supervisors are invalid.

Runtime is the exception: one persistent Runtime identity remains continuously available because it carries unique environment knowledge. Runtime executes integration, deployment, rollback, and live mechanical checks; it does not decide Product semantics or acceptance.

## Adaptive cascade

Builders advance through immutable first-pass checkpoints while applicable read-only audit lenses run concurrently. Intermediate audits may settle against earlier checkpoints while building continues. At terminalization, the four lenses are `FUNCTIONALITY`, `DESIGN_UI_SHELL_NAVIGATION`, `SECURITY`, and `CODE_QUALITY_HYGIENE`; Security and hygiene are not automatically applicable when the changed surfaces do not require them.

Catastrophic, wrong-direction, foundational, or critical safety/security findings return immediately to the first-pass owner and hold only the dependent scope. Ordinary material findings are consolidated by causal root for one fresh Campaign Finalizer. The Finalizer receives a clean derived worktree, exclusive writer custody, the exact terminal checkpoint, and one correction batch. It cannot own intent, acceptance, deployment, exceptions, or self-acceptance.

When the Finalizer completes, the campaign root adopts its exact final commit and tree through a recorded custody handoff. Delta audit rechecks only failed, directly touched, dependent, and one small smoke set; unaffected evidence is reused by exact hash and environment binding. One targeted delta repair and one supervisor-selected reframe per causal root are the normal limits.

Cascade economics compare the complete accepted-result cost with an equivalent
direct accepted-result cost. A ratio at or below `0.75` is the minimum savings
target, but savings remain `UNPROVEN` until at least three accepted observations
exist. The Finalizer must emit an evidence-derived rewrite assessment; a pass
classified `REBUILD_REQUIRED` cannot close as targeted repair.

## Runtime and next campaign

The current Auditor may clear the release for deployment and produce a content-addressed next-campaign candidate. That event orients only the next Campaign Orchestrator. No next Auditor, Feature Agent, Platform Agent, Product writer, or campaign-start disposition exists before exact accepted-live closure and explicit next-campaign admission.

Accepted-live closure binds the exact final candidate, all three Product roots, deployed and rollback identities, independent live audit, clean pushed worktrees, released custody, archived campaign instances, retained Runtime, reconciled roster, and closure receipt. Until every binding is present, the status is `ACCEPTED_LIVE_PENDING_CLOSURE`.

## Optional assistant exchange

An assistant exchange is an optional Markdown handoff. The Auditor creates a secret-free status packet bound to the real source commit/tree, current campaign, roster, goal, evidence, findings, and exact questions. The response contains one canonical structured payload; unparsed prose is rejected. An external assistant can help the owner reason, research, compare scenarios, and answer listed questions, but it cannot invent project truth, mark findings fixed, write authority, change custody, deploy, or create a successor roster. Provider-specific transports are typed project extensions and are not portable-kernel authority.

## Activation boundary

This package remains `PREPARED_NOT_ACTIVATED`. It does not merge, deploy, or rebind a Product campaign. A future activation must verify the exact binding digest, cold-start setup, portable context separation, hostile transitions, deterministic outputs, and owner approval.
