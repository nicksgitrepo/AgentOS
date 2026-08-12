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
- Explicit duplicate/alias mappings: `9`.
- Inventory source: `registry/master-inventory.v1.json`.
- Required materialization fields: canonical ID, aliases, family/subfamily,
  purpose, triggers, exclusions, dependencies, conflicts, source requirements,
  freshness policy, priority score, gate status/path, schema/package status,
  evaluator status/receipt, and lifecycle.
- No role is removed for priority; P0–P4 ranks control sequencing only.

## Wave law

Wave 0 is controller-owned foundation. Wave 1 keeps exactly six materially
active lanes while eligible blocks remain. Heavyweight validation is serialized;
research and static authoring may overlap. Every lane owns one append-only
package scope, one source manifest, one executable `.gate`, one evaluation
dossier, one hostile-fixture set, and one typed handoff.

## Six reserved P0 lanes

| Lane | Family | Append-only package scope | Goal | Status |
|---|---|---|---|---|
| L1 | `AGENT.BOOTSTRAP` | child `019ff333-1cda-76f2-a43b-b44ec39bf088` (`Bernoulli`) | Build `specialist.control.bootstrap-project-initializer`. | `ACTIVE_BUILDING` |
| L2 | `AGENT.PROJECT_CONTROLLER` | child `019ff333-1d4b-7082-8556-feab852e2d4a` (`Godel`) | Build `specialist.control.project-controller`. | `ACTIVE_BUILDING` |
| L3 | `AGENT.INTENT_REGULATOR` | child `019ff333-1dca-72c0-85a8-3c81a6715d6a` (`Franklin`) | Build `specialist.control.intent-regulator`. | `ACTIVE_BUILDING` |
| L4 | `AGENT.RESOURCE_SCHEDULER` | child `019ff333-1e3f-7e43-8e2d-3c2ccfc17ee4` (`Locke`) | Build `specialist.control.resource-scheduler`. | `ACTIVE_BUILDING` |
| L5 | `AGENT.RUNTIME_DEPLOYMENT` | child `019ff333-1eb9-7ea1-a239-a5aae1d1bb35` (`Hilbert`) | Build `specialist.control.runtime-deployment-operator`. | `ACTIVE_BUILDING` |
| L6 | `AGENT.INDEPENDENT_AUDITOR` | child `019ff333-1f36-75e3-b7ab-f552edb9c438` (`Darwin`) | Build `specialist.control.independent-auditor`. | `ACTIVE_BUILDING` |

The previously attempted Wave 1 family lanes were interrupted as incompatible
before reassignment; all six reported `changed paths: none`.

## Admission ceiling

No block in this candidate may activate, deploy, publish, migrate a consumer,
write secrets, direct Memory internals, assert legal applicability without
jurisdiction/entity/activity/data/version/effective-date evidence, or self-admit.
Independent utility/harm evaluation and the main AgentOS 3.0 integration owner
remain external gates.

## Next controller actions

1. Compile Wave 0 foundation blocks and the deterministic loader.
2. Activate the six lanes and collect typed handoffs.
3. Run serialized hostile validation, materialize the roster and routing index,
   and reject any block that fails narrowness, freshness, authority, custody,
   applicability, or handoff checks.
4. Commit only the clean candidate and issue the exact typed integration handoff.

## Turn-bound recovery checkpoint — 2026-08-11

- Inventory receipt: `625` raw role mentions, `619` unique role titles, `9`
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
