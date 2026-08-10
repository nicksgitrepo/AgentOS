# Preserved full platform handoff: 02-bootstrap-and-context

# Cycle 1 Platform Handoff — Bootstrap and Context

Status: **PRODUCTION_CANDIDATE_PENDING_TESTS**

Lane: Bootstrap and Context

Platform gate: **FEATURE LANES MUST REMAIN BLOCKED until the Controller has received every platform handoff, independently audited and merged one platform tree, and recorded the resulting clean source-bound checkpoint.**

## Source binding and custody

```yaml
schema: agentos.platform_foundation_handoff.v1
version: 1
phase: CYCLE_1_PLATFORM_FOUNDATION_GATE
role: FOUNDATION_BOOTSTRAP_AND_CONTEXT
public_lane: Bootstrap and Context
source:
  committed_head: 590c07ddd4be7a8c24727c24b40808e44ca7357d
  committed_tree: f1b358d87e6a969fb9631e202a3d478540edd4d9
  worktree_state: DIRTY_USER_AND_LANE_CHANGES_PRESERVED
  public_identity_values: OMITTED_PRIVATE_CONTROL_PLANE_READBACK
  identity_fields: [project_id, project_root, cwd, git_top_level, git_common_directory, source_commit, source_tree]
  identity_rule: ALL_SEVEN_REQUIRED_AND_RECHECKED_BEFORE_ACCEPTANCE
authoritative_comparison:
  committed_head: SAME_AS_SOURCE
  committed_tree: SAME_AS_SOURCE
  access: READ_ONLY
result: PRODUCTION_CANDIDATE_PENDING_TESTS
independent_clearance: REQUIRED_NOT_RUN
clearance_claim: NONE
release_feature_lanes: BLOCKED
release_candidate_state: PREPARED_NOT_ACTIVATED
```

The exact private project/root/cwd/session readbacks remain in the control
plane. This public handoff carries only committed source identities, relative
scope, typed dispositions, and safe evidence. The completed audit history is
in `docs/rapid-foundations/02-bootstrap-and-context-auditreport.md`.

## Shared platform skeleton

| Surface | Current platform fact | Handoff rule |
| --- | --- | --- |
| `bootstrap/` | Human-readable, read-only entry contract and startup boundary. | Start only through the canonical controller and exact two-root binding. |
| `control/` | Portable controllers, discovery, content addressing, runtime adapters, and lane assembly. | Keep authority directional; do not put Product behavior into the portable kernel. |
| `schemas/` | Machine-readable contracts for Bootstrap, source binding, discovery, handoffs, capabilities, and lifecycle. | A contract change requires its producer, consumers, focused checks, and final binding refresh. |
| `governance/2.1rc/` | Prepared authority corpus; release candidate remains inactive. | No activation, release, or Product admission follows from this handoff. |
| `docs/rapid-foundations/` | Project-agnostic foundation intent, lane audits, evidence, and handoffs. | Public summaries contain no private project, session, or control-plane records. |
| `tests/` | Direct Node verifiers and hostile checks; rapid lanes have one focused test each. | Use the host Node executable and record exact results; fixture passes are not independent clearance. |
| External control plane | Private project context, conversations, runtime/session identity, campaign state, evidence, and source-preservation records. | Keep private identity and raw evidence here; never publish it into the platform tree. |

The Product repository and its delivery space are not part of this platform
tree. Bootstrap may discover them through typed private context, but this lane
does not implement Product requirements, Product UI, provider integrations, or
release behavior.

## Directory boundaries and custody

- The public kernel is project-agnostic. Product names, project paths,
  credentials, provider accounts, session identities, and private handoffs do
  not enter portable source or public handoff text.
- Bootstrap owns read-only discovery, typed context, source binding, safe
  defaults, the one-question floor, and the next-owner handoff. It may not
  silently write Product files, create a child/generic/shell role, or replace
  an unavailable host capability.
- `control/rapid-prototype/bootstrap-context.mjs` is a pure context compiler;
  `control/rapid-prototype/index.mjs` assembles the bounded rapid result. They
  do not authorize acceptance, independent clearance, external effects, or
  Product custody.
- `control/bootstrap-discovery.mjs` is read-only and root-contained. Symlinked
  path components are conflicts. Existing dirty work is preserved; no reset,
  clean, overwrite, or broad repair is authorized by this handoff.
- Shared schemas and generated surfaces require one named primary owner. If
  several feature lanes need one schema, migration, generated output, or
  resource, the Controller must freeze competing writers and choose a single
  shared-contract primary worktree.
- The current lane repair touched only Bootstrap/Context implementation,
  direct integration, contracts, focused tests, and audit/handoff records:
  `control/bootstrap-discovery.mjs`,
  `control/rapid-prototype/bootstrap-context.mjs`,
  `control/rapid-prototype/index.mjs`,
  `control/rapid-prototype/evidence-identity.mjs`,
  `schemas/rapid-bootstrap-context.v1.json`,
  `schemas/rapid-prototype-plan.v1.json`,
  `tests/rapid-prototype/bootstrap-context.mjs`,
  `tests/verify-rapid-prototype.mjs`,
  `tests/verify-bootstrap-start.mjs`,
  `tests/run-rapid-prototype-lanes.mjs`, and the two Bootstrap/Context
  handoff/audit documents.

## Technology-stack facts and recommendations

Confirmed platform facts:

- The public package declares ESM and Node `>=20`; the platform uses Node
  standard-library modules, direct `process.execPath` execution, JSON
  contracts, and SHA-256 content addressing.
- `control/content-addressing.mjs` is the shared canonicalization/digest
  primitive. New platform records should use it instead of local digest
  copies.
- Bootstrap discovery uses bounded local read-only probes with a safe
  environment. It must not authenticate, use network access, spend, publish,
  deploy, delete, or mutate the source.
- Focused checks run directly through Node. This handoff was verified without
  `npm`; the package scripts remain a later campaign-level verification route,
  not a Bootstrap identity or authority source.
- No Product framework, database, provider, deployment target, design system,
  or Product language is established by this lane.

Recommendations:

1. Keep the platform kernel dependency-light and Node-standard-library based;
   treat any Product stack as typed project context rather than a kernel
   default.
2. Pair every shared contract change with a direct focused test, a hostile
   case, a source-bound evidence digest, and a final manifest refresh.
3. Keep `process.execPath` as the executable source for direct verification;
   do not replace it with a bare executable lookup or a shell stand-in.
4. Keep public platform records content-addressed and redacted to portable
   summaries. Put raw source, runtime, provider, and session evidence in the
   private control plane.

## Routing and feature boundaries

- Default `2.1rc` topology is one cumulative Product root. Feature lanes do
  not independently merge or release their checkpoints to the shared default
  branch.
- A platform capability with no Product edit uses a read-only advisory packet.
  A material platform edit requires a campaign-local stable Platform worktree
  lease, one writer, an exact allowlist, a clean pushed checkpoint, and lease
  release back to `AVAILABLE`.
- Multiple features contending for one shared contract/schema/migration use a
  selected shared-contract primary worktree; consumers provide requirements
  and rebind after the versioned checkpoint.
- Runtime alone owns serialized accepted integration, artifact creation,
  deployment, rollback, and live-identity receipts. The Bootstrap lane does
  none of these.
- The Controller must collect all platform handoffs, perform one independent
  platform-tree audit and merge, and only then release Product feature lanes.
  This handoff is not permission to start a feature lane.
- A source, intent, scope, capability, policy, or custody change invalidates
  the current context. The dependent outcome closes and requires a fresh
  source-bound goal; old rosters and compatibility exports do not transfer
  authority.

## Shared contracts and dependencies

| Contract or controller | Role in the platform handoff | Current status |
| --- | --- | --- |
| `control/bootstrap-compiler.mjs` | Canonical Bootstrap start, plan, discovery digest, and pre-write gate. | Focused Bootstrap checks pass. |
| `control/bootstrap-discovery.mjs` | Root-contained, secret-free discovery; now records committed tree and Git common directory and rejects symlinked components. | Focused discovery/start checks pass. |
| `control/rapid-prototype/bootstrap-context.mjs` | Seven-field source binding, required evidence-bearing checks, typed non-self-clearing context, and fail-closed status. | Repaired; focused checks pass. |
| `schemas/rapid-bootstrap-context.v1.json` | Machine contract for the rapid context, evidence, handoff, and privacy boundary. | Added; not yet in the global binding manifest. |
| `schemas/rapid-prototype-plan.v1.json` | Rapid plan identity and lane handoff source fields. | Updated to require all seven identity fields; final rebind pending. |
| `schemas/bootstrap-discovery.v1.json` | Discovery safety and no-symlink-follow rule. | Boundary is enforced by the repaired implementation. |
| `schemas/bootstrap-binding.v1.json` | Exact normative inventory for final integrity verification. | Current worktree has 15 mismatches; authoritative merge owner must refresh it. |
| `schemas/capability-and-worktree-registry.v1.json` | Platform capsule, custody modes, leases, routing, and platform-to-feature handoff law. | Governing shared skeleton; independent platform audit still pending. |
| `schemas/parallel-campaign-handoff.v1.json` | Content-addressed campaign handoff shape with source commit/tree and artifact/evidence/progress digests. | Use the final controller receipt after clean merge. |
| `control/content-addressing.mjs` | Shared UTF-8 canonicalization and SHA-256 digest primitive. | Reused by the repaired rapid context. |

The repaired rapid context and schema are intentionally not declared
integrity-bound until the authoritative owner refreshes the complete manifest
against the final clean platform tree. The current 15 mismatches are a merge
gate, not a reason for this lane to rewrite other lanes’ entries.

## UI and design direction

- No Product UI is being implemented in this platform phase.
- Any later owner-facing surface should be outcome-first: show the current
  state, responsible public role, honest limitation, and one safe next action
  together.
- Stable public states include ready, working, waiting for a decision,
  blocked, unavailable, conflict, and complete. Missing evidence is never
  rendered as success.
- Plain-text/Markdown is the fallback when no rendered surface exists. A
  rendered surface must retain semantic structure, visible focus, keyboard
  operation, text alternatives, reflow/zoom support, and explicit empty,
  stale, partial, permission, offline, and error states.
- Product branding, navigation, design tokens, user workflows, and visual
  authority belong to typed project context and the Design/UI foundation. The
  Bootstrap lane must not invent them or expose private control-plane detail.

## Security and custody constraints

- Public records may contain only portable rules, typed outcomes, relative
  scope, and safe digests. Do not copy secrets, absolute private paths, raw
  conversations, session identities, provider/account names, or private
  evidence.
- Source mismatch, incomplete identity, missing capability, deep/private
  input, symlink boundary, unavailable security proof, or stale evidence
  fails closed as `UNAVAILABLE`, `SOURCE_BINDING_MISMATCH`, or `HARD_STOP`.
- No authentication, network access, spending, publication, push, merge,
  deployment, release, activation, deletion, or destructive cleanup is in
  this lane’s custody.
- Existing dirty work is user-owned. Preserve it; never reset, clean,
  overwrite, or infer acceptance from a dirty fixture.
- The producing lane never clears or accepts its own result. The handoff
  remains `READY_FOR_INDEPENDENT_CLEARANCE`/pending where appropriate, and
  the Controller’s independent audit must precede platform merge.
- The remaining dirty-worktree identity policy is a durability gate. The
  authority owner must decide whether uncommitted content receives a bounded
  content digest or whether commit/tree plus explicit dirty-overlap handling
  is the canonical rule.

## Evidence and readiness

- Focused verification passed for rapid bootstrap context, Bootstrap
  alignment, contract bindings, coverage, delivery finish, start, dynamic
  Bootstrap, conversation, project contract, safety analysis, the rapid lane
  runner, and assembled rapid prototype.
- The rapid runner reports 12 implementation lane tests plus 1 supporting
  check. These are bounded fixture/direct checks, not independent clearance.
- Re-audit probes confirmed: missing source is blocked/unavailable; conflicting
  complete binding is a source mismatch; evidence-free/incomplete checks are
  rejected; deep private input is rejected; parent symlinks are conflicts;
  committed tree/common-directory facts are present.
- Full final-tree verification is pending. The current worktree is dirty and
  the global binding manifest is not clean, so this handoff is a production
  candidate pending tests, not a production acceptance.

## Unresolved owner questions and exact next actions

1. **Manifest ownership:** Which final controller/merge owner refreshes the
   complete binding manifest, and are the new rapid context module, schema,
   focused test, and plan-contract changes normative entries? Action: decide
   entry names, refresh all hashes from the final clean platform tree, and run
   the exact binding verifier.
2. **Dirty source identity:** Does the platform bind uncommitted content with a
   bounded digest, or does a clean-source final gate plus commit/tree and
   dirty-overlap preservation suffice? Action: record the rule and add the
   smallest final-gate regression proof.
3. **Final verification:** Which exact clean-tree direct Node suite and
   independent platform audit receipt close this gate? Action: run the
   complete affected verification after manifest refresh; do not release
   feature lanes on focused passes alone.
4. **Project stack and design:** What typed Product project context supplies
   the actual application stack, data/provider boundaries, delivery target,
   and design authority? Action: feature lanes must wait for that context and
   must not infer it from this platform handoff.
5. **Custody mode:** Is this capability consumed as a read-only advisory packet
   or as a stable Platform worktree lease? Action: because this candidate is
   uncommitted and no Product seam is authorized here, default to advisory
   until the Controller selects a clean stable platform tree.
6. **Activation:** Has the owner recorded the explicit decision to activate
   `2.1rc`? Action: keep the release candidate prepared and inactive until the
   final binding, tests, independent audit, and activation decision exist.

## Handoff destination

```yaml
next_handoff:
  recipient: CAMPAIGN_CONTROLLER
  action: WAIT_FOR_ALL_PLATFORM_HANDOFFS
  then:
    - independently_audit_one_clean_platform_tree
    - refresh_complete_binding_manifest
    - record_exact_commit_tree_and_evidence_receipts
    - release_feature_lanes_only_after_platform_gate
independent_checker: FOUNDATION_CLEARANCE_AUDITOR
platform_merge: REQUIRED_BEFORE_FEATURE_RELEASE
clearance: NOT_CLAIMED
```

This is a source-bound platform handoff for a production candidate pending
tests and authority reconciliation. It does not start Product feature
implementation, grant acceptance, or activate the release candidate.

