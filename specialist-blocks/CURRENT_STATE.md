# Specialist Block Library — Current State

Status: `P0_CONTROL_PLANE_BUILD_ACTIVE`

Lifecycle: `CANDIDATE_INACTIVE`

Activation: `OFF`

Admission: `NOT_ADMITTED`

Model/reasoning requirement: `gpt-5.6-luna / max`

Controller boundary: this isolated AgentOS candidate worktree only. The source
publication, the active 3.0 integration worktree, the Agent Builder checkpoint,
and the protected Memory lane are read-only or out of scope.

## Frozen baseline

- Base commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- Base tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- Existing specialist compiler/loader: absent on the frozen baseline; this
  candidate adds a separate typed path.
- Agent Builder input: `EVALUATION_CANDIDATE_READY_FOR_INDEPENDENT_RERUN`,
  `CANDIDATE_PACKAGE / NOT_ADMITTED / NOT_ACTIVATED`, utility/harm evaluation
  pending. It remains `NOT_ADMITTED`.

## Master inventory

- Raw role mentions retained: `625`.
- Unique role titles retained: `619`.
- Explicit duplicate/alias mappings: `10`.
- Inventory source: `registry/master-inventory.v1.json`.
- Required materialization fields: canonical ID, aliases, family/subfamily,
  purpose, triggers, exclusions, dependencies, conflicts, source requirements,
  freshness policy, priority score, gate status/path, schema/package status,
  evaluator status/receipt, and lifecycle.
- No role is removed for priority; P0–P4 ranks control sequencing only.

## On-demand compiler shape

The library is a registry of addressable recipes and reusable immutable blocks;
it does not contain a permanent flat catalog of finished agents. A task-shaped
agent is compiled only when an external lane supplies owner intent, typed
project governance, current context, candidate/worktree custody, capabilities,
and proof overlay.

Composition layers are ordered as: owner intent and authority; general AgentOS
governance; external project governance; task/role authority;
language/runtime/framework; architecture/platform; domain/capability;
requirements/product quality; security/privacy/safety; testing/review;
change/version/release/supply chain; and exact external project context.

The deterministic compiler emits `agent-plan.json`, `block-lock.json`,
`authority-graph.json`, `context-manifest.json`, `decision-tree.gate`,
`proof-matrix.json`, `handoff.schema.json`, `evaluation-receipt.json`, and a
generated `bootstrap.md` view. Generated instances are external companion
artifacts only; `bootstrap.md` is never the authority and cannot be edited as a
standalone contract.

Current materialized role-kind counts are `ROUTER: 626`,
`CONTROL_PLANE: 13`, `KNOWLEDGE_BLOCK: 0`, `GOVERNANCE_BLOCK: 0`,
`STANDARD_BLOCK: 0`, `CONTEXT_BLOCK: 0`, `ATOMIC_SPECIALIST: 79`, and
`COMPILED_AGENT_PACKAGE: 0`. The typed atomic overlay remains `7` routers,
`79` atomic specialists, and `13` control-plane roles.

The compiled candidate package count is separate from the backlog materialized
count: `16` packages are validated (`13` `CONTROL_PLANE` and `3`
`STANDARD_BLOCK`). The three standard packages are source-locked candidates;
they do not change the unexpanded backlog count.

## Wave law

Wave 0 is controller-owned foundation. Wave 1 keeps exactly six materially
active lanes while eligible blocks remain. Heavyweight validation is serialized;
research and static authoring may overlap. Every lane owns one append-only
package scope, one source manifest, one executable `.gate`, one evaluation
dossier, one hostile-fixture set, and one typed handoff.

## Six reserved P0 lanes

| Lane | Family | Append-only package scope | Goal | Status |
|---|---|---|---|---|
| L1 | `AGENT.BOOTSTRAP` | child `019ff333-1cda-76f2-a43b-b44ec39bf088` (`Bernoulli`) | Build `specialist.control.bootstrap-project-initializer`. | `CANDIDATE` |
| L2 | `AGENT.PROJECT_CONTROLLER` | child `019ff333-1d4b-7082-8556-feab852e2d4a` (`Godel`) | Build `specialist.control.project-controller`. | `CANDIDATE` |
| L3 | `AGENT.INTENT_REGULATOR` | child `019ff333-1dca-72c0-85a8-3c81a6715d6a` (`Franklin`) | Build `specialist.control.intent-regulator`. | `CANDIDATE` |
| L4 | `AGENT.RESOURCE_SCHEDULER` | child `019ff333-1e3f-7e43-8e2d-3c2ccfc17ee4` (`Locke`) | Build `specialist.control.resource-scheduler`. | `CANDIDATE` |
| L5 | `AGENT.RUNTIME_DEPLOYMENT` | child `019ff333-1eb9-7ea1-a239-a5aae1d1bb35` (`Hilbert`) | Build `specialist.control.runtime-deployment-operator`. | `CANDIDATE` |
| L6 | `AGENT.INDEPENDENT_AUDITOR` | child `019ff333-1f36-75e3-b7ab-f552edb9c438` (`Darwin`) | Build `specialist.control.independent-auditor`. | `CANDIDATE` |

The previously attempted Wave 1 family lanes were interrupted as incompatible
before reassignment; all six reported `changed paths: none`.

## Admission ceiling

No block in this candidate may activate, deploy, publish, migrate a consumer,
write secrets, direct Memory internals, assert legal applicability without
jurisdiction/entity/activity/data/version/effective-date evidence, or self-admit.
Independent utility/harm evaluation and the main AgentOS 3.0 integration owner
remain external gates.

## Next controller actions

1. Run independent utility/harm evaluation over the six P0 candidate packages.
2. Re-run the full admission matrix, including source freshness, authority,
   custody, atomicity, routing, and typed-handoff checks.
3. Send the exact isolated receipt to the main AgentOS 3.0 integration owner;
   do not merge, activate, deploy, or adopt a consumer project from this lane.

## Turn-bound recovery checkpoint — 2026-08-11

- Inventory receipt: `625` raw role mentions, `619` unique role titles, `10`
  explicit alias mappings; no lower-priority role was discarded.
- Shared schema changes persisted: specialist block, gate, roster, routing,
  evaluation, handoff, and source-manifest schemas; block controls now declare
  read/write/tool/data/build/browser/deploy/communication/acceptance authority.
- Shared gate changes persisted: every package must carry the exact 12-gate pack
  (`00-intake` through `11-lifecycle-recovery-archive`) with only
  `YES|NO|UNKNOWN|NOT_APPLICABLE`; `UNKNOWN` closes only the dependent action.
- Registry changes persisted: generic P0–P6 priority roster, human-readable
  `ROSTER.md`, roadmap, and alias-preserving master inventory.
- Incompatible attempt: six Wave 1 lanes were spawned, then interrupted when
  the owner correction required P0-first activation and the 12-gate contract;
  each child reported no file changes.
- Host-pressure freeze: canonical Rust scheduler `JOB-407` remains `RUNNING`;
  swap is `5.5/6 GiB`; no heavyweight proof or new heavyweight admission is
  allowed. Only lightweight source research and gate authoring may continue in
  a future bounded controller turn.
- Current worktree: `DIRTY_UNCOMMITTED_CONTROLLER_CANDIDATE`, exactly `8`
  untracked path roots from this turn; baseline was clean at the frozen commit.
  No external source or integration worktree was mutated.
- Next cursor: implement and statically validate the universal compiler,
  loader, 12-gate manifest/decision evaluator, and deterministic registry
  materializer; then reassign these exact six child identities to P0. Do not
  start P1–P6 or heavyweight validation before the freeze clears.

## Second turn-bound recovery checkpoint — atomicity amendment queued

- Exact master inventory remains `625` raw role mentions and `619` unique
  titles. Explicit alias mappings now total `10`; no role was dropped.
- Atomic overlay is persisted but not yet compiled into the canonical roster:
  `7` routers, `79` atomic specialists, and `13` control-plane blocks.
  Routers remain classification/context assemblers only; atomic blocks must
  use an upstream router, own `sources.lock`, carry all twelve gates, and
  return `NOT_APPLICABLE` instead of broadening.
- Schema/gate changes persisted: `role_kind`, atomic scope/authority,
  permitted/forbidden decisions, upstream router, sibling conflicts,
  composition/escalation/split rules, `P0–P6` priority, content digests,
  typed context/output schemas, and the mandatory four-valued twelve-gate
  pack. Atomic evaluator failure classes are recorded in the overlay.
- P0 priority correction remains authoritative. Six reserved children are
  unchanged and all remain `FROZEN_WAITING_FOUNDATION`: Bernoulli
  `019ff333-1cda-76f2-a43b-b44ec39bf088`, Godel
  `019ff333-1d4b-7082-8556-feab852e2d4a`, Franklin
  `019ff333-1dca-72c0-85a8-3c81a6715d6a`, Locke
  `019ff333-1e3f-7e43-8e2d-3c2ccfc17ee4`, Hilbert
  `019ff333-1eb9-7ea1-a239-a5aae1d1bb35`, and Darwin
  `019ff333-1f36-75e3-b7ab-f552edb9c438`.
- Current worktree is `DIRTY_UNCOMMITTED_CONTROLLER_CANDIDATE` with `13`
  untracked path roots from this controller work. No external worktree or
  source package was mutated.
- Host-pressure ceiling remains: canonical Rust scheduler `JOB-407` is
  `RUNNING`, swap is `5.5/6 GiB`; no heavyweight work, heavyweight proof, or
  new heavyweight admission is allowed.
- Atomic-specialization amendment is queued for the next bounded turn. Next
  cursor: finish the lightweight compiler/loader and gate-pack proof, then
  compile Wave 0, update the canonical roster/ROSTER.md, and only after that
  reassign the exact six reserved children to P0. Do not expand this turn.

## P0 activation receipt — foundation proof satisfied

- Wave 0 compiler proof: `node control/specialist-block-compiler.mjs compile`
  passed for `7` packages and generated inactive roster, routing index, and
  materialized inventory.
- Focused verifier: `node tests/verify-specialist-block-library.mjs` passed.
- The exact six reserved child identities were reassigned to P0 with disjoint
  package scopes under `specialist-blocks/wave-01/`; no shared file is in their
  write set. P1–P6 remain planned and inactive.

## Current verified receipt — composition and P0 candidate

- `node control/specialist-block-compiler.mjs compile` validates `13` package
  records: seven foundation packages plus the exact six P0 packages. The
  generated roster remains `COMPILED_CANDIDATE` with activation `OFF`.
- `node tests/verify-specialist-block-library.mjs` passes deterministic
  materialization, inactive admission state, atomic routing, exact 12-gate
  packs, four-valued gate behavior, and hostile fixture catalog checks.
- `node tests/verify-specialist-agent-compiler.mjs` passes three external
  task-shaped package generations, shared immutable standard hash reuse,
  distinct lane/context package hashes, minimal dependency closure, missing
  context/authority denial, stale-source denial, conflicting-edition denial,
  atomic-over-router denial, unsafe-authority denial, machine/bootstrap
  reflection, byte-stable recompile, package mutation detection, and zero
  AgentOS repository residue.
- `node tests/verify-specialist-independent-evaluator.mjs` passes the separate
  read-only evaluator over all `13` inactive packages, `156` gate files, and
  `221` hostile fixtures. Its disposition is static-pass/review-required;
  utility/harm authority remains external and pending.
- The aggregate machine handoff is
  `registry/integration-handoff.v1.json`; the human view is
  `INTEGRATION_HANDOFF.md`. The disposition remains `WAITING_WITH_RECEIPT`.
- The exact six P0 lanes each have a candidate package and typed handoff; their
  independent utility/harm and admission receipts remain outstanding. No P1–P6
  lane is active.
- Reuse law is enforced by `block-lock.json`: exact block ID/version/hash and
  source-lock identity are referenced once; task applicability stays in the
  external context overlay. A material edition, erratum, or gate correction
  requires a new immutable block version.
- Host-pressure ceiling remains recorded: canonical scheduler `JOB-407` is
  `RUNNING` at swap `5.5/6 GiB`; no heavyweight proof, activation, deployment,
  provider action, consumer migration, or self-admission occurred.
- The next cursor is independent utility/harm evaluation of the six P0 package
  candidates, followed by main AgentOS 3.0 owner intake only if every required
  admission gate passes. The source package, active integration worktree, and
  protected Memory lane remain untouched.

## Source-locked standard slice — 2026-08-11

- Added three reusable `STANDARD_BLOCK` candidates: NIST SP 800-218 SSDF 1.1,
  OWASP ASVS 5.0.0, and SLSA Specification 1.2. Each has a primary source
  lock, normalized requirement mappings, external applicability inputs,
  compatibility/supersession metadata, all twelve gates, 17 hostile fixtures,
  an evaluation dossier, and a typed handoff.
- Compiler proof: `node control/specialist-block-compiler.mjs compile` passes
  `16` packages and binds every standard's source, requirements, compatibility,
  and supersession digest to its block digest.
- Focused library proof passes with `16` packages; the independent read-only
  evaluator passes `16` packages, `192` gate files, and `272` hostile fixtures.
  Disposition remains `STATIC_PASS_REVIEW_REQUIRED`; utility/harm and admission
  are still external and pending.
- Standard source facts are locked by publisher, edition, retrieved date,
  effective-date status, immutable identity, and supersession status. Current
  applicability and project facts remain external overlays; no certification,
  legal advice, activation, deployment, or self-acceptance is authorized.
- Next cursor: refresh the exact machine/human integration handoff, then commit
  and push this coherent slice. Do not start broader standard/backlog expansion
  or heavyweight proof while the host-pressure ceiling remains in force.

## Atomic composition enforcement slice — 2026-08-11

- Implementation commit: `e35e055e7b1c198c820b6050302e7df1a1e19507`; tree:
  `2bd879482553aef3223e08757cccca394cc8618f`; branch is pushed and clean at
  this slice checkpoint.
- The task-shaped compiler now preserves `required_upstream_router` and
  `sibling_conflicts` in normalized catalogs and generated `block-lock.json`;
  an `ATOMIC_SPECIALIST` must include a selected upstream `ROUTER` in its
  dependency closure. Router-only substitution and duplicate sibling authority
  are denied; missing upstream selection returns a closed error.
- The route loader now returns the required router alongside the narrow atomic
  selection, and closes `UNKNOWN` when that router is unavailable. Focused
  compiler, library, and independent-evaluator checks pass.
- Exact counts remain `625` raw mentions, `619` unique titles, `10` aliases;
  materialized inventory remains `ROUTER:626`, `CONTROL_PLANE:13`,
  `KNOWLEDGE_BLOCK:0`, `GOVERNANCE_BLOCK:0`, `STANDARD_BLOCK:0`,
  `CONTEXT_BLOCK:0`, `ATOMIC_SPECIALIST:79`, `COMPILED_AGENT_PACKAGE:0`.
  Compiled candidate packages remain `16` (`13` control-plane, `3` standard).
- Six P0 lane identities/statuses remain unchanged and candidate/inactive;
  no P1 lane is active. Host ceiling remains canonical Rust scheduler
  `JOB-407 RUNNING`, swap `5.5/6 GiB`; no heavyweight proof or admission ran.
- Next cursor: add source-locked narrow P1 router/atomic packages with explicit
  generic mappings, then refresh counts, routing, evaluation receipts, and the
  typed integration handoff. Keep activation `OFF` and admission
  `NOT_ADMITTED`.

## First P1 atomic package slice — 2026-08-11

- The source-locked P1 slice adds `16` compiled candidates: `6` routers and
  `10` atomic specialists. Generic IDs remain routing mappings; no family label
  receives Product-writing or acceptance authority.
- Atomic candidates are Rust backend language semantics, TypeScript compiler
  semantics, React component runtime, PostgreSQL RLS, OpenAPI 3.1.1 contracts,
  OAuth RFC 9700 security flow, OIDC Core 1.0 claims, AWS IAM policy elements,
  Cloudflare DNS records, and Cloudflare Cache Rules. Each has a distinct
  source lock, exact upstream router, 12 gates, 17 hostile fixtures,
  evaluation dossier, and typed handoff.
- Each P1 atomic package now depends on one exact reusable `STANDARD_BLOCK`
  for its official language/framework/database/API/identity/provider authority;
  the atom source lock carries only the portable composition authority, while
  the exact publisher source is encoded once in the standard package.
- Compiler proof currently reports `42` package records: `13` control-plane,
  `13` reusable standard, `6` router, and `10` atomic. Materialized counts are
  `ROUTER:631`, `CONTROL_PLANE:13`, `KNOWLEDGE_BLOCK:0`,
  `GOVERNANCE_BLOCK:0`, `STANDARD_BLOCK:0`, `CONTEXT_BLOCK:0`,
  `ATOMIC_SPECIALIST:79`, `COMPILED_AGENT_PACKAGE:0`.
- Independent static evaluator passes `42` inactive packages, `504` gate
  files, and `714` hostile fixtures; utility/harm and admission remain
  pending external authority. Focused library, compiler, and evaluator checks
  pass; no heavyweight proof ran.
- Exact six P0 lane identities/statuses remain candidate/inactive and no P1
  lane is active. Host ceiling remains canonical Rust scheduler `JOB-407`
  `RUNNING`, swap `5.5/6 GiB`.
- Implementation commit `c2b4d5757653e7b4b223ddedf387b4df915a273e` with tree
  `158152d279de4cf7aa4ff1743c16d3e770dc06f3` is pushed on the isolated
  candidate branch. The receipt refresh is the next separate handoff commit;
  the full 619-title master backlog and all P2–P6 roles remain planned.
