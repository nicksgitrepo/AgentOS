# Preserved platform handoff: 01-intent-and-scope


## Platform foundation handoff — Intent and Scope (append-only)

### STATUS AND SOURCE BINDING

`PRODUCTION_CANDIDATE_PENDING_TESTS` — `FINISHED / HANDOFF_READY_PENDING_TESTS`.
This is a source-bound platform-foundation handoff, not a product-feature
implementation, acceptance, merge, deployment, or `2.1rc` activation claim.

| Binding | Value | Meaning |
| --- | --- | --- |
| `source_commit` | `590c07ddd4be7a8c24727c24b40808e44ca7357d` | The repository commit read for this handoff. |
| `source_tree` | `f1b358d87e6a969fb9631e202a3d478540edd4d9` | The commit tree read for this handoff. |
| comparison | Same commit and tree as the read-only audited comparison tree | No source divergence was inferred from the comparison. |
| working snapshot | Dirty; `289` status entries were present at readback | A clean exact-source verification is still required before any clearance or merge claim. |
| runtime evidence | Not run | The lane contract prohibited npm and other verification tasks in this turn. |
| independent check | `REQUESTED`, not run | The Intent lane does not self-clear. |

Relevant content-addressed readback anchors remain:

- `control/rapid-prototype/intent-scope.mjs` —
  `b8f3fda56358a93d5e0523e0e073f8e7553d9be82846d9b5f00d1776a9a5ef6d`
- `control/rapid-prototype/index.mjs` —
  `70dae78d197631d6fdf74afbfa002e813c17e1652b2a06e8f99c4dc3206a2bc5`
- `tests/rapid-prototype/intent-scope.mjs` —
  `ce772499de002e7911bff4e74883844bcca5f0ad185121b19812780ac5ea9f18`
- `tests/verify-rapid-prototype.mjs` —
  `2a27aebda0dcd20b690a805950658bbc7337b5b2a6b01d93fbc1ac4be5affc26`
- `docs/rapid-foundations/01-intent-and-scope.md` —
  `11a775ac8789f88d956efe697033bf03692b78c239512f63f6e2c738ed91bcec`

These anchors establish readback identity only. They do not substitute for
the later clean-source check, focused tests, independent audit, custody
receipt, or accepted platform merge.

### SHARED SKELETON

The portable repository's shared skeleton is deliberately small and
project-agnostic:

| Root | Contract | Platform boundary |
| --- | --- | --- |
| `governance/2.1rc/` | Normative portable governance | May describe roles, gates, custody, and contracts; it must not contain product facts or activation state beyond the prepared inactive candidate. |
| `schemas/` | Versioned machine-readable contracts and validators | Owns typed shape and validation authority; schema changes require explicit source-bound custody and downstream readback. |
| `control/` | Executable governance behavior | Owns deterministic control-plane and rapid-lane behavior; it is not a Product runtime. |
| `bootstrap/` | Read-only discovery and plan compilation | Consumes typed project context and authority material; it must not invent missing owner decisions. |
| `docs/` | Public explanations, foundations, and append-only lane evidence | May explain or record the portable contract; raw private evidence and project authority stay outside the public kernel. |
| `tests/` | Focused hostile checks and assembled verifiers | Establishes executable evidence but does not grant independent acceptance or activation. |
| `control/rapid-prototype/` | Named foundation-lane modules assembled by the rapid prototype index | Each lane has one bounded module and focused test; the shared index is a seam requiring primary custody. |

The public repository, any Product repository, and the private AgentOS control
plane remain separate authorities. Project context, provider accounts,
deployment identities, credentials, private conversations, runtime state, and
domain policy are typed inputs or private custody records, never portable
kernel payloads. `tmp/` and generated/private runtime material are not part of
the public skeleton.

### DIRECTORY BOUNDARIES

The Intent and Scope lane's direct surface is the following bounded set:

- `control/rapid-prototype/intent-scope.mjs`
- `tests/rapid-prototype/intent-scope.mjs`
- `docs/rapid-foundations/01-intent-and-scope.md`
- this append-only report

The shared consumer and assembled verifier are seams, not a license for
general editing:

- `control/rapid-prototype/index.mjs` is the shared assembler and currently
  carries the Intent candidate propagation and typed handoff integration.
- `tests/verify-rapid-prototype.mjs` is the shared assembled test surface and
  carries the Intent integration coverage.
- Shared control, plan, schema, host, session, and lifecycle paths require
  explicit primary custody by the Controller or the admitted platform seam
  owner. A lane must not silently broaden its lease because a shared consumer
  is convenient to edit.
- Other rapid-prototype lane modules and their focused tests are outside this
  lane. Product feature roots, Product implementation, deployment/runtime
  code, provider adapters, credentials, private control-plane data, and
  unrelated governance are outside this handoff.

### TECHNOLOGY-STACK FACTS AND RECOMMENDATIONS

Evidence from `package.json` and the repository layout establishes these facts:

- The governance kernel is Node.js ESM: `"type": "module"`, with an engine
  declaration of Node `>=20` and `.mjs` executable modules.
- The package declares no runtime dependencies. No lockfile, frontend
  framework configuration, build configuration, or product UI entry point was
  found in the portable repository read for this handoff.
- The declared checks are direct Node programs (`format:check`, `lint`, `test`,
  `test:portability`, and `check`), but none was run in this turn and npm was
  not used.
- The rapid plan requires the runtime to use the host's `process.execPath` and
  to fail closed on an unclean or inexact source snapshot before verification.

Recommendations for the shared foundation are therefore limited to preserving
the existing Node ESM and direct-runtime contract, keeping dependencies at
zero unless a typed project decision admits one, and avoiding a framework or
product-stack decision in this portable lane. Any later Product language,
framework, build, test, auth, data, deployment, or observability choice must
come from the typed technical baseline and owner authority; it must not be
inferred from this governance repository.

### ROUTING AND FEATURE BOUNDARIES

The Controller must collect all platform-foundation handoffs, independently
audit and merge exactly one platform tree under recorded custody, and only
then release feature lanes. This handoff does not authorize feature-lane
creation, Product implementation, a second supervisor, or a silent platform
lease.

The Intent route contract relevant to the shared skeleton is:

| Disposition | Required route | Gate meaning |
| --- | --- | --- |
| `PROCEED` | No boundary route (`selectedBoundary: null`) | Normal continuation; it is not a hard stop. |
| `PUZZLE` | Puzzle/repair boundary | Reversible bounded repair with evidence. |
| `SOFT_REVIEW` | Soft-review boundary | A recorded choice and impact require review. |
| `OWNER_REQUIRED` | Owner-review boundary | Missing material intent is not defaulted. |
| `CONFLICT` | Reconciliation boundary | Consequential disagreement remains closed. |
| `HARD_STOP` | Hard-stop boundary | Unsafe, invalid, or prohibited work does not continue. |
| `DEFERRED_ITERATION` | Fresh-goal/reopen boundary | A reopen trigger and reason are required. |
| `UNAVAILABLE_NOT_COMPLETE` | Fail-closed hold/readback boundary | Missing capability or evidence is not treated as completion. |

The platform role is created only for a first material shared capability. It
owns an exact bounded capsule and seam, uses one stable campaign worktree and
execution identity, grants sequential Feature-Agent leases, and reports the
lease/custody receipt. It does not own feature intent, campaign acceptance,
deployment, owner-only policy, or Product semantics. Ordinary technical issues
stay local; shared contract or migration seams return to the Controller for
primary custody. No hidden task or successor role was created here.

### SHARED CONTRACTS

The following are the relevant contract sources and consumers:

- `docs/rapid-foundations/01-intent-and-scope.md` defines the owner outcome,
  workflow, scope, exclusions, acceptance, protected boundaries, assumptions,
  dispositions, and non-authority rules.
- `control/rapid-prototype/intent-scope.mjs` validates the complete envelope,
  candidate material, marker evidence, dispositions, change digests, and
  secret-free public evidence.
- `control/rapid-prototype/index.mjs` is the shared assembler. It requires
  explicit owner fields, preserves candidate fields, emits typed decision
  evidence, routes recovery, and exposes the generic
  `governance.intent_scope_handoff.v1` handoff summary.
- `tests/rapid-prototype/intent-scope.mjs` and
  `tests/verify-rapid-prototype.mjs` are the direct and assembled hostile
  coverage surfaces. They remain unexecuted in this handoff.
- `schemas/rapid-prototype-plan.v1.json`,
  `schemas/capability-and-worktree-registry.v1.json`,
  `schemas/boundary-contract.v1.json`, and
  `schemas/dynamic-lane-manifest.v1.json` govern phase order, platform leases,
  owner boundaries, exact source binding, non-overlapping write scopes, and
  feature-lane release gates.
- The Product acceptance contract remains exactly the Function Requirements,
  Design Bible, and Security roots. Code hygiene is a supporting gate, not a
  fourth Product acceptance root.
- The platform workflow and delivery/closure contracts require exact parent,
  commit, tree, worktree, changed-surface, check, handoff, custody, and
  closeout evidence; local review is not remote merge, deployment, or live
  acceptance.

**Unknown contract decision:** no standalone versioned schema for
`governance.intent_scope_handoff.v1` was found in `schemas/`. The current
shape is evidence in the Intent implementation and tests, not permission to
invent a competing persistence authority. The Controller must decide whether
that handoff is promoted into an existing schema/custody record or remains an
embedded typed output, and record the decision before treating it as a shared
platform contract.

### UI / DESIGN DIRECTION

This lane does not implement a Product UI. If a future owner-facing Intent or
platform surface is admitted, it should expose the distinct disposition,
whether work is blocked, one safe next action or owner question, the evidence
status, and the protected boundary without exposing raw owner intent, private
paths, credentials, or internal custody data. `PROCEED` should read as normal
continuation; unavailable, conflict, owner-required, and hard-stop states must
remain visibly distinct. Holds should apply only to the dependent outcome.

Product shell, navigation, responsive behavior, accessibility requirements,
tokens, components, and protected surfaces belong in the typed project Design
Bible and technical baseline. No framework, token set, visual style, or
Product route should be added to this portable kernel by inference.

### SECURITY / CUSTODY CONSTRAINTS

- Preserve the public/private/repository separation. Do not copy secrets,
  private paths, provider or deployment identities, task/session identities,
  raw conversations, or private evidence into this report or the kernel.
- Treat commit, tree, changed paths, worktree identity, and custody as
  source-bound evidence. The current dirty snapshot is pending exact clean
  readback; it is not a clearance or merge candidate.
- The Intent handoff is digest-only and uses generic summaries. It does not
  authenticate, authorize spending, publish, deploy, delete, merge, accept
  Product, or override an Auditor.
- Platform work must use a stable worktree and sequential leases. No
  simultaneous supervisors, lease broadening, identity reuse, or successor
  role is allowed before accepted-live closure or explicit next admission.
- Preserve the handoff before closeout; host-mediated preserve, unpin, archive,
  remove, and zero-active state remain custody operations. A local audit does
  not imply remote or live acceptance.
- `2.1rc` remains `PREPARED_NOT_ACTIVATED` until an explicit activation
  decision is recorded by the proper authority.

### UNRESOLVED OWNER / CONTROLLER QUESTIONS

These are recorded questions, not silently supplied defaults:

1. What are the eventual Product target, maturity, audience, data class,
   lifetime, maintenance/retirement policy, and delivery target?
2. What typed technical baseline admits any Product language, framework,
   build/test/deploy system, authentication, data, and observability choice?
3. If a Product UI is later admitted, where is the authoritative Design Bible
   for shell, navigation, tokens, components, responsive behavior,
   accessibility, and protected surfaces?
4. What first material shared capability justifies a Platform Agent, and what
   exact capsule, API, seam, source checkpoint, lease, and closure receipt does
   the Controller admit? Do not create a generic platform pool proactively.
5. Who owns the versioned schema and persistence/custody decision for
   `governance.intent_scope_handoff.v1`?
6. What exact campaign, platform lease, feature dependency, and custody record
   will be admitted after the independent platform-tree audit? Feature lanes
   must not be released before that record exists.

### GATE, BLOCKERS, AND RECOVERY

The handoff is ready for the Controller's platform-foundation gate, with the
following real release conditions:

1. **Focused runtime checks are a true blocker for test-backed readiness.**
   Recovery: in a separately authorized source-bound turn, run only the two
   named focused checks from the audit report without npm, capture their exact
   result and source readback, and append the evidence.
2. **The dirty working snapshot is an exact-source custody blocker.**
   Recovery: reconcile the allowed changed surfaces and obtain a clean,
   source-bound snapshot before independent audit or merge; preserve unrelated
   user work rather than overwriting it.
3. **The handoff-schema persistence question is an owner/controller unknown.**
   Recovery: record one canonical schema/custody decision; do not create a
   parallel truth in this lane.
4. **Independent platform audit and merge are still pending.** Recovery: the
   Controller waits for every platform handoff, independently audits one
   platform tree, records the exact merge/custody receipt, and only then
   releases feature lanes.

### EXACT NEXT ACTION FOR THE CONTROLLER

Collect the remaining platform-foundation handoffs, preserve this report as
the Intent and Scope source-bound record, reconcile the dirty snapshot and
run the separately authorized focused verification, then independently audit
and merge one platform tree under exact custody. Resolve the owner/controller
questions above before admitting any shared seam. Only after that accepted
platform gate may the Controller release feature lanes. This lane has created
no hidden task and has started no Product feature implementation.

Handoff: `FINISHED` — Intent and Scope is a
`PRODUCTION_CANDIDATE_PENDING_TESTS` platform-foundation handoff. Next action
is the Controller-owned clean-source verification, independent platform-tree
audit/merge, and only then feature-lane release.

