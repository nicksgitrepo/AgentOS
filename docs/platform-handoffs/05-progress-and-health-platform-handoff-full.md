# Preserved full platform handoff: 05-progress-and-health

# Platform-foundation handoff — Progress and health

Status: PRODUCTION_CANDIDATE_PENDING_TESTS

Decision: HOLD_FEATURE_LANES

Role: FOUNDATION_PROGRESS_AND_HEALTH

Cycle: 1

Audit and handoff date: 2026-08-07

This is a platform-foundation handoff for the shared skeleton and gate. It is
not product feature implementation, platform-tree acceptance, merge authority,
or independent clearance. The Progress and Health lane audit is preserved in
docs/rapid-foundations/05-progress-and-health-auditreport.md through Section
F; this handoff carries the platform-facing consequences and unresolved owner
questions forward.

## Source and custody binding

| Field | Readback / disposition |
|---|---|
| Committed source commit | 590c07ddd4be7a8c24727c24b40808e44ca7357d |
| Committed source tree | f1b358d87e6a969fb9631e202a3d478540edd4d9 |
| Candidate worktree | DIRTY_UNCOMMITTED; pre-existing broad edits and untracked files are preserved and are not claimed by this lane |
| Formal Platform lifecycle state | HELD_CLEAN_PUSHED_CHECKPOINT_REQUIRED |
| Independent platform audit | REQUIRED_NOT_RUN |
| Platform-tree merge | NOT_RUN |
| Feature-lane release | HELD_UNTIL_ALL_PLATFORM_HANDOFFS_ARE_INDEPENDENTLY_AUDITED_AND_ONE_PLATFORM_TREE_IS_MERGED |

The direct lane candidate paths and hashes are:

| Path | SHA-256 | Custody |
|---|---|---|
| control/rapid-prototype/progress-health.mjs | 14d0466d59e1733e2542ca2af9cfb1b7ffe47fa737c274bc6abb4f62766ffda6 | repaired direct lane module |
| tests/rapid-prototype/progress-health.mjs | 205b9ebcba96f834885cd2963dac919bb5b404f75c84740b1c08d0885f3515ed | repaired direct lane focused test |
| docs/rapid-foundations/05-progress-and-health-auditreport.md | a5b26e1ce7b5278510548bbb239ab2e3225e06c292ba081234774c755878f2ef | append-only audit history |

The authoritative merge working state was inspected read-only. The selected
assembler, functionality consumer, rapid plan, and other non-custody files
were unchanged relative to it during this handoff. No push, merge, deployment,
publication, activation, or external action was performed.

## Shared skeleton recommendation

The portable shared skeleton should remain layered and project-agnostic:

| Shared area | Role in the skeleton | Boundary |
|---|---|---|
| control/ | Canonical executable governance, routing, lifecycle, evidence, and adapters | Portable rules and project-bound adapters only; no product truth or private runtime state |
| control/rapid-prototype/ | Twelve named behavior modules plus the separate thin-slice assembly seam | Each lane owns its declared module/test pair; the shared index is an integration-owner path |
| schemas/ | Versioned typed contracts and machine-readable registries | Schema changes require admitted schema ownership and parity checks |
| docs/ | Public foundations, architecture, operator guidance, and evidence references | No secrets, private roots, session records, raw evidence, or product-specific policy |
| tests/ | Focused, hostile, deterministic proof | A passing synthetic fixture is not live acceptance; unavailable checks remain UNPROVEN or UNAVAILABLE |
| External control plane | Conversations, controller state, campaign state, private evidence, source-preservation records, and host readbacks | Kept outside the Product root by default; exact roots remain private typed context |

The authority-corpus registry supplies typed roots for project context, goals,
design system, features, platform capabilities, campaigns, decisions, cases,
evidence, archives, and the evidence library. The compiler must create only
admitted roots and page skeletons; it must reject unresolved roots, path or
realpath escapes, symbolic-link traversal, overlapping roots, duplicate page
identity, unowned authority, and silent overwrite.

The per-platform capability skeleton is:

~~~text
<platform_capabilities_root>/<capability_id>/
  overview.md
  scope-and-authority.md
  context.md
  pseudocode.md
  implementation-notes.md
  proof-and-hostiles.md
  handoffs.md
~~~

The per-feature skeleton remains separate:

~~~text
<features_root>/<feature_id>/
  overview.md
  intent.md
  current-state.md
  build-log.md
  contracts.md
  dependencies.md
  failure-and-unavailable.md
  decisions.md
  handoffs.md
~~~

These are typed root variables, not literal public paths. This lane does not
create either tree and does not start a feature lane.

## Directory and write boundaries

- The Progress and Health implementation custody is limited to
  control/rapid-prototype/progress-health.mjs and
  tests/rapid-prototype/progress-health.mjs; its public audit and handoff
  evidence are documentation artifacts.
- control/rapid-prototype/index.mjs and
  control/rapid-prototype/functionality.mjs are shared integration/consumer
  seams. They remain unresolved findings owned by the assembler/functionality
  route; this lane must not edit them under the current admission.
- A Feature Agent is the exclusive writer for its cumulative feature root.
  A Platform Agent writes only its separate campaign-local stable worktree
  under one current Feature-Agent supervision lease.
- One logical Platform Agent may serve one named capability seam per campaign,
  retaining one stable worktree while leases move sequentially between Feature
  Agents. Two simultaneous supervisors, shared feature-root writes, child or
  generic workers, shell substitutes, and hidden tasks are prohibited.
- The Controller/Intent Regulator owns routing and serialized shared
  integration. The Independent Auditor owns gate definition and independent
  verification. Neither boundary is delegated to this lane.
- 2.1rc is prepared but inactive. This handoff does not activate it or
  release any Product writer.

## Technology-stack facts and recommendations

### Confirmed facts

- The portable kernel is implemented as JavaScript ESM modules, primarily
  .mjs, with direct Node execution and node --check syntax verification.
- Public contracts and registries are versioned JSON documents; normative and
  evidence-facing guidance is Markdown.
- The repaired Progress and Health module uses Node built-ins only for its
  direct path (crypto, fs, and path) and has no product-framework dependency.
- The current candidate worktree contains an untracked package.json that
  declares type=module and Node >=20, but it differs from the authoritative
  merge working state and is not a committed platform fact.
- No admitted Product UI framework, browser build tool, or typed UI source tree
  was found in the inspected AgentOS source. UI behavior is therefore a
  contract and unavailable-state concern, not a stack decision made here.

### Recommendations

- Keep the portable governance kernel on Node ESM, built-in modules, direct
  focused Node checks, JSON contracts, and Markdown authority pages unless a
  fresh owner-bound project context explicitly selects another platform.
- Do not introduce React, Vite, Next, a CSS system, a database, a provider, or
  a hosted runtime into the portable kernel by inference. A consuming Product
  must supply its actual stack, build command, runtime, and deployment boundary
  through typed context before a feature or platform seam chooses adapters.
- Do not use package-manager execution as a substitute for source-bound proof.
  The lane evidence here was collected with direct node commands; no npm
  command was used.
- Keep progress/history/schema semantics in one admitted authoritative adapter.
  The current rapid module and broader continuous operating loop overlap;
  integration ownership must choose an explicit adapter or document the
  bounded separation before platform merge.

## Routing and feature boundaries

| Owner | Owns | Does not own |
|---|---|---|
| Controller / Intent Regulator | Waits for all platform handoffs, routes exact owners, reconciles source-bound state, and serializes the platform-tree merge | Product feature implementation, independent acceptance, silent scope expansion, or release activation |
| Platform Agent | One named capability seam, its capsule, bounded implementation if leased, hostile proof, and exact return packet | Feature intent, feature root, unrelated seams, global integration, production deployment, or independent acceptance |
| Feature Agent | One admitted feature outcome and cumulative feature root under exclusive Product custody | Global platform ownership or acceptance of its own result |
| Independent Auditor | Read-only inspection of the exact candidate, gate findings, severity, and acceptance decision | Building, repairing, weakening gates, or accepting a dirty/unbound tree |
| Progress and Health lane | Source/task/scope/authority-bound progress, liveness, health, waiting/stall, evidence, and handoff semantics | Product behavior, UI implementation, assembler rewrites, feature routing, or platform-tree merge |

The corrected campaign order is:

1. collect every platform-foundation handoff;
2. independently audit the exact shared platform candidate(s);
3. merge exactly one independently audited platform tree with clean pushed
   checkpoint proof;
4. re-read the merged commit/tree and preserve the merge evidence; and
5. only then release feature lanes from the Controller.

The current Progress and Health handoff cannot advance that sequence by
itself. Its assembled verifier still exposes the missing integration contract,
so the Controller must keep feature lanes held.

## Shared contracts and integration seams

- agentos.rapid_prototype.progress_health.v1 is the direct observation
  contract. It binds task, scope, source, authority, acceptance roots, finite
  interval, timestamps, meaningful progress, heartbeat freshness, health,
  waiting/stall state, blocker, evidence, predecessor digest, and typed
  handoff state.
- agentos.rapid_prototype.progress_health_handoff.v1 is the direct public
  handoff compiler/validator. It emits bounded result/check summaries, hostile
  coverage disposition, evidence digests, open risks, closure, and next route.
- Completion is impossible for heartbeat-only, missing-heartbeat, stale,
  unavailable, waiting, stalled, failed, or unproven observations. Raw
  result/error payloads are not public output.
- The local adapter provides latest-record CAS/readback, source/authority
  pairing, lock/stage/fsync/rename, path containment, and tamper validation. It
  is not yet an append-only campaign history store and does not prove native
  host authenticity from a caller boolean.
- The public authority-corpus page contract requires metadata, current source
  reality, authority/ownership, contracts/dependencies, failure/unavailable
  behavior, proof, open context, and owner/next sections. Platform capability
  pages must include compact seam pseudocode and contextual assumptions; those
  comments are not executable authority.
- The UI/UX foundation requires visible state, reason/limitation, next action,
  and acceptance consequence. It explicitly treats no rendered surface,
  missing readback, stale/conflict state, unavailable capability, and unrun
  accessibility/layout checks as UNAVAILABLE, CONFLICT, or UNPROVEN, not
  success.

### Known integration findings carried to the Controller

1. The assembler still fabricates missing/result-null progress defaults and
   does not pass the direct binding/evidence contract.
2. The assembled readiness gate must explicitly check progress status, health,
   liveness, and meaningful progress.
3. The campaign authority must choose the append-only history owner and wire
   the latest-record CAS/readback into that history.
4. A standalone rapid progress schema or an explicit adapter to the broader
   operating-loop schema must be admitted and tested.
5. Native-host source/authority attestation must be persisted and tested at
   the real control-plane route.

## UI and design direction

This lane supplies a state model to the UI/Shell owner; it does not build a
surface. A future owner-facing surface should show:

- IN_PROGRESS only with one concrete next action;
- WAITING with the named dependency, affected outcome, next observation, and
  resume condition;
- STALLED with the missing concrete-progress evidence and reconciliation
  route;
- STALE or UNAVAILABLE with the safe limitation and next handoff;
- DEGRADED with the bounded blocker; and
- COMPLETED only after meaningful progress, evidence, fresh liveness, and
  required checks are all explicit.

The surface should use the admitted project design system and protected visual
baselines when those are supplied. Until then, it must not invent brand,
tokens, components, density, responsive rules, or accessibility claims. If no
rendered surface exists, the public plain-text/Markdown contract is the honest
surface and interactive completion remains unavailable. Loading, empty,
offline, denied, stale, conflict, partial, and error states must remain visible;
color or a spinner cannot stand in for health or authorization.

## Security and custody constraints

- Keep exact project roots, session identities, host records, raw evidence,
  credentials, private conversations, and provider values in the private
  control plane. Public handoffs contain only relative public paths, typed
  classifications, bounded summaries, and safe digests.
- Preserve source binding. A caller assertion, setup token, worker label,
  inherited roster, or old compatibility export is not identity.
- Preserve the direct module’s fail-closed behavior, exact nested public
  shapes, raw-payload omission, source/authority pairing, real-root and
  symlink containment, atomic CAS readback, and stale-parent rejection.
- Treat the dirty worktree as a candidate input, not a merge authority. A
  formal Platform handoff requires an exact clean, pushed, remote-equal
  checkpoint and independent readback of the same commit/tree.
- Do not create children, hidden tasks, generic workers, shell substitutes,
  network access, authentication, spending, publication, deployment, merge,
  release, deletion, or Product writes from this lane.
- Keep 2.1rc inactive and keep feature-lane release held until the Controller
  completes the shared platform gate.

## Evidence and current disposition

| Check | Result |
|---|---|
| node tests/rapid-prototype/progress-health.mjs | PASS |
| node tests/run-rapid-prototype-lanes.mjs | PASS: 12 implementation lanes and 1 supporting check |
| node tests/verify-continuous-operating-loop.mjs | PASS |
| node tests/verify-source-hygiene.mjs | PASS |
| node --check on the direct module and focused test | PASS |
| node tests/verify-rapid-prototype.mjs | FAILS closed at the old ready assertion: actual UNAVAILABLE, expected READY_FOR_INDEPENDENT_CLEARANCE |
| Public report private-path/secret-shaped scan and trailing-whitespace scan | PASS |
| Selected non-custody comparison with authoritative merge state | No differences found |

The assembled failure is retained as evidence of the missing owner-controlled
integration, not converted into a pass. The direct lane is a production
candidate pending tests; the shared platform tree is not independently
audited, merged, or released.

## Unresolved owner questions

1. Controller: Which named platform capability seams are materially admitted
   for this campaign, and which logical Platform Agent/stable worktree owns
   each seam?
2. Project owner / Bootstrap: What exact Product root, control-plane root,
   design-system roots, feature root, and platform-capability root are bound by
   typed project context? These values must remain private and cannot be
   inferred from this portable repository.
3. Project owner / Bootstrap: What Product technology stack, runtime,
   build/test commands, browser targets, and deployment boundary are actually
   admitted? The portable kernel has no authority to choose them.
4. Controller and Auditor: Is the rapid progress contract adapted into the
   broader continuous-operating-loop contract, or is one authoritative
   source-bound progress/history/schema adapter selected and documented?
5. Controller / history owner: Where is append-only progress history stored,
   who owns it, and what exact readback proves predecessor preservation across
   assembler and campaign transitions?
6. Controller / host owner: What native host readback proves source and
   authority authenticity at the real assembler route, and how is its evidence
   persisted without exposing private identity?
7. UI/Shell and Design owner: Which design tokens, protected baselines, route
   mount, accessibility targets, and unavailable/stale/conflict states govern
   the owner-facing progress surface?
8. Controller: What exact clean, pushed checkpoint and independent audit receipt
   will authorize the one platform-tree merge before feature lanes are
   released?

## Exact next action and typed handoff

The Controller must wait for all platform-foundation handoffs, route the shared
findings above to the named owning seams, and have an Independent Auditor
inspect the exact candidate tree. After all platform handoffs are present, the
Controller may merge one clean pushed platform tree only after independent
source/contract/security/UI-boundary audit. Until then:

~~~yaml
handoff_contract: agentos.foundation_handoff.v1 public shape
phase: PLATFORM_FOUNDATION_GATE
role: FOUNDATION_PROGRESS_AND_HEALTH
public_lane: Progress and health
source:
  commit: 590c07ddd4be7a8c24727c24b40808e44ca7357d
  tree: f1b358d87e6a969fb9631e202a3d478540edd4d9
  working_tree: DIRTY_UNCOMMITTED
progress: DIRECT_LANE_REPAIRED
result: PRODUCTION_CANDIDATE_PENDING_TESTS
independent_check:
  status: REQUIRED_NOT_RUN_FOR_SHARED_PLATFORM_TREE
  owner: INDEPENDENT_AUDITOR
platform_merge: HELD_CLEAN_PUSHED_CHECKPOINT_REQUIRED
feature_lanes: HELD
next_handoff: CONTROLLER_THEN_PLATFORM_INDEPENDENT_AUDITOR
clearance: NOT_CLAIMED
~~~

No feature implementation was started. This handoff is ready for Controller
reconciliation, not acceptance.

