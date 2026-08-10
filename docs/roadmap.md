# AgentOS roadmap

## Purpose and status

AgentOS is a project-agnostic governance system for turning a person's intent
into bounded, checkable work by AI agents. It is intended to solve a recurring
problem in agentic development: a useful request can be lost between natural
conversation, changing project context, tool and model selection, implementation,
verification, recovery, and delivery. AgentOS keeps those transitions explicit
without requiring the owner to operate the internal machinery.

The intended experience is simple at the surface and strict underneath:

- the owner describes the outcome in ordinary language;
- Bootstrap turns that conversation into a typed project contract;
- the Controller chooses the smallest suitable role, model, context, tools, and
  evidence path for the admitted work;
- temporary agents do bounded work and return proof-carrying handoffs;
- an independent checker decides whether the evidence supports acceptance; and
- the system preserves continuity, handles repair, and closes temporary work
  without crossing protected boundaries.

This document is a roadmap, not an acceptance record. It describes promises,
sequence, dependencies, and completion tests. A capability is not considered
implemented merely because it appears here. Current status is a conservative
summary of evidence already recorded for this source:

- **Checked** means a bounded implementation has direct evidence and an
  independent check.
- **Partial** means useful pieces exist, but the full promise has not been
  independently accepted.
- **Planned** means the promise is settled but no accepted end-to-end slice is
  recorded.
- **Owner choice** means technical preparation cannot substitute for an
  explicit owner decision.
- **Not needed now** means the capability is outside the current local
  prototype, not rejected forever.

## Product boundaries

AgentOS has four deliberately separate concerns:

| Concern | Contains | Must not contain |
| --- | --- | --- |
| Portable kernel | Project-agnostic rules, schemas, deterministic state transitions, and verification contracts | Product names, private locations, credentials, provider accounts, deployment identities, or domain-specific policy |
| Project repository | The product's source, tests, and public project documentation | Private AgentOS memory, agent transcripts, control records, credentials, or generated governance packets |
| Private control instance | Project contract, decisions, registrations, campaign state, evidence metadata, recovery history, and temporary-worker records | Unreviewed authority over release activation or protected external actions |
| Release source | A replaceable, versioned, verified AgentOS distribution | Mutable project state or private project memory |

The project contract supplies product context as data. It does not rewrite the
portable kernel. General governance, base-role governance, persistent project
governance, and generated task-role governance remain distinct. Generated
task packets are disposable projections of current authority, not new sources
of authority.

Protected actions fail closed. Publishing, pushing, merging, deployment,
spending, authentication, secret disclosure, destructive deletion, product
writes outside admitted scope, rollback execution, and release activation
require explicit authority appropriate to that action. A worker, checker, or
passing test cannot grant that authority to itself.

Test builds, release candidates, and owner-approved releases are separate
states. Acceptance of code or a release candidate is not release activation.
The prepared `2.1rc` line remains inactive until an explicit activation
decision is recorded.

## Capability roadmap

### 1. Deterministic portable kernel — Partial

**Promise.** A small, auditable kernel represents work, authority, state,
evidence, capabilities, claims, and governance without embedding any product
domain. Governance composition and state changes are deterministic,
content-addressed where appropriate, replayable, and fail closed on missing or
mismatched identity.

**Done means.**

- The same typed input produces the same normalized decision and digest.
- Kernel fixtures contain no product identity, private location, credential,
  provider, task identity, or domain policy.
- Architecture checks reject dependency cycles, duplicate authority sources,
  unbound generated policy, and accidental product coupling.
- Hostile tests cover stale state, missing evidence, contradictory authority,
  bypass attempts, and non-terminating routes.
- A checker that did not build the candidate verifies the exact source and
  publishes a reproducible evidence digest.

### 2. Layered governance and project contracts — Partial

**Promise.** A friendly Bootstrap conversation becomes a private typed contract
covering outcomes, workflows, terminology, boundaries, acceptance conditions,
unknowns, providers, retention, delivery intent, and owner-only decisions.
Four governance layers compose with deterministic precedence: general,
base-role, persistent-project, and generated task-role governance. Project
governance survives AgentOS upgrades or triggers an explicit migration review.

**Done means.**

- A representative conversation compiles into a complete contract without
  copying raw conversation text into public source.
- Every decision records authority, scope, lifetime, provenance class, and a
  revision trigger.
- Generated task packets include only the rules and questions applicable to
  that task and are reproducible from their inputs.
- Upgrade tests prove precedence, preservation, conflict detection, and safe
  migration across supported versions.
- An independent checker compares the conversation outcome, typed contract,
  compiled packet, and upgrade result without relying on narrative claims.

### 3. Controller-owned intent and low-chat operation — Partial

**Promise.** The Controller maintains authoritative goals, evidence, routing,
repair, reassessment, and closure. Agents propose and report; they do not
silently redefine the goal or accept their own work. The owner sees concise
progress and receives one short plain-language question only when a real choice
is missing.

**Done means.**

- Goal creation, replacement, reassessment, repair, and closure are explicit
  state transitions with current source identity.
- Routine puzzles route to bounded repair without unnecessary owner prompts.
- Scope, intent, authority, or protected-action changes stop at the correct
  owner boundary.
- Meaningful progress is distinguished from liveness and narration.
- End-to-end tests cover ordinary success, an automatic repair, an owner choice,
  a changed goal, an unavailable dependency, and a hard stop.
- Independent review confirms that no worker became the authority for its own
  goal, evidence, or acceptance.

### 4. Task-shaped routing and context — Partial

**Promise.** Task need selects the role, model, reasoning effort, context,
tools, worker shape, workspace capability, and evidence path. Selection is
measured and explainable rather than fixed to one model or a permanent lane.
Selective context retrieval supplies what the task needs while preventing
private or unrelated data from leaking into prompts or outputs.

**Done means.**

- A typed routing decision explains each selection and its fallback.
- Small tasks do not inherit oversized teams or unnecessary context.
- Capability checks occur before work, and unavailable capabilities produce an
  honest route rather than a simulated substitute.
- Evaluation fixtures measure quality, cost, latency, context sufficiency, and
  policy compliance across representative task classes.
- Context-firewall tests reject unrelated project data, secrets, stale records,
  and unauthorized memory.
- An independent evaluation can reproduce the route from the same admitted
  task and project state.

### 5. Local-first workspace, host, and provider adapters — Partial

**Promise.** AgentOS operates offline and locally without requiring a provider.
Logical workspace locations and Git or provider capabilities are accessed
through checked adapters, not hard-coded machine assumptions. Every temporary
task is bound to the intended saved project and stops before work on a mismatched
project or workspace.

The exact saved-project boundary and current local host path have bounded,
independently checked evidence. Broader logical-location support, provider
certification, and the complete portable-instance contract remain partial.

**Done means.**

- A new local installation can register, reopen, reconcile, and operate a
  project without network access.
- Workspace identity is checked before work and again in the handoff.
- Adapter contracts cover local repositories and each supported provider
  without changing kernel semantics.
- Mismatch, detached workspace, unavailable provider, and partial-failure tests
  fail safely and preserve evidence.
- Portability tests run on clean environments without private machine
  assumptions.
- An independent checker verifies the exact project, source, adapter, and
  no-external-effects receipts.

### 6. Governed campaign lifecycle and progress recovery — Checked for the current bounded local slice

**Promise.** One orchestrator owns a temporary campaign flow, bounded workers
perform admitted tasks, and a separate checker verifies the result. Every
temporary task leaves an exact handoff and is removed from the active roster
after closure. A configurable meaningful-progress window defaults to fifteen
minutes; heartbeat-only activity does not reset it. Drift or failure preserves
evidence and routes a repaired replacement.

**Done means for each supported host and campaign shape.**

- Creation receipts prove the saved project, role, task, source, model, and
  reasoning binding.
- Progress receipts distinguish useful change, waiting, liveness, failure, and
  timeout.
- Handoffs identify source, scope, changed paths, checks, evidence, residual
  risk, and next action.
- The checker is independent of the builder and cannot modify the candidate it
  accepts.
- Closure preserves the handoff and proves that no completed temporary role
  remains active.
- Hostile tests cover false progress, stale identity, worker disappearance,
  failed replacement, duplicate completion, and incomplete closure.

The current bounded local lifecycle and progress-replacement loop meet this
bar. New hosts, providers, or campaign shapes must earn their own evidence;
this status is not a universal production claim.

### 7. Proof-carrying work and whole-project acceptance — Partial

**Promise.** Every candidate change carries exact starting state, claimed
scope, dependencies, environment, checks, results, rollback information,
invalidation relationships, residual risk, and a typed handoff. Independent
acceptance checks every promised feature, not only the files that changed.

**Done means.**

- Patch capsules are content-addressed and bind claims to exact source and
  dependency identities.
- Evidence distinguishes direct observation, derived result, unavailable
  result, and unverified assertion.
- Changed dependencies invalidate affected claims and name the required
  rechecks.
- A whole-project feature map reports every capability as checked, partial,
  missing, owner-choice-only, or not needed.
- The independent checker cannot build, repair, or accept its own candidate.
- Acceptance can be reproduced from preserved evidence on a clean checkout.

Typed handoffs and bounded evidence exist today. Full patch capsules,
dependency claims, and whole-project completeness acceptance remain open.

### 8. Structured memory, recovery, and portable project capsules — Partial memory; capsule and synchronization planned

**Promise.** Lossless private records, compact structured state, selective
retrieval, startup reconciliation, and recovery history preserve continuity
without leaking product data. A project capsule can safely move its contract,
governance, memory, campaign history, evidence metadata, and registrations
between local AgentOS installations. Optional synchronization remains private
and includes secret scanning.

**Done means.**

- Restart and crash-recovery tests reconstruct the same authoritative state
  from durable records.
- Compaction never discards an unresolved owner decision, active boundary,
  evidence root, or recovery obligation.
- Capsule export and import are versioned, deterministic, encrypted where
  required, and reject secrets or machine-bound identifiers.
- Synchronization detects conflicts, supports offline divergence, and never
  turns a derived view into authority.
- Migration and rollback are tested across supported capsule versions.
- A clean-machine independent check proves continuity and privacy.

### 9. Release, compatibility, and migration safety — Partial

**Promise.** Promotion proceeds from development evidence to a sterile release
candidate and then, only by owner choice, to an active release. Stateful changes
carry compatibility, mixed-version, backfill, cutover, reconciliation,
irreversible-point, and rollback evidence. Governance changes can be replayed
and model-checked for dead ends, bypasses, livelocks, lost recovery, and changed
owner authority.

**Done means.**

- Development and sterile release identities are independently verified.
- Promotion re-runs required checks on the exact sterile candidate rather than
  inheriting development results by narration.
- Compatibility fixtures cover old state, new state, mixed versions, failed
  migration, interrupted cutover, and rollback.
- Policy replay reports changed decisions and authority before activation.
- Model checks cover reachability, termination, bypass resistance, recovery,
  and owner-control invariants.
- Activation is a separate, recorded owner decision after technical acceptance.

Release-state separation exists, but promotion, compatibility, migration
governance, policy replay, and model checking have not reached this full bar.

### 10. Bounded maps and repository intelligence — Planned

**Promise.** AgentOS can derive bounded visual maps of dependencies, authority,
workflow, feature coverage, and recovery state, along with repository
intelligence useful for planning and review. These views are evidence-bound
projections and never become a second source of truth.

**Done means.**

- Every node and edge traces to a current typed source or direct observation.
- Bounds, omissions, freshness, uncertainty, and source identity are visible.
- Stale or contradictory inputs produce an explicit unavailable or conflict
  state.
- Maps cannot modify authority or satisfy acceptance merely by existing.
- Independent checks compare representative maps with their underlying records.

### 11. Workflow distillation and teacher-to-worker handoff — Planned and inactive

**Promise.** A strong teacher may demonstrate a bounded task so AgentOS can
distill a reusable, evidence-bound workflow for a smaller worker. Neither the
demonstration, the teacher, nor the resulting packet becomes authority. The
candidate loop is: observed demonstration → evidence-bound workflow model →
explicit role packet → fresh smaller-worker reproduction → independent
comparison.

The teacher record captures observable actions and results, not hidden
reasoning. Its distilled packet states the task pattern, relevant decisions,
evidence requirements, admitted tools, authority and privacy boundaries,
failure and recovery paths, and an explicit `DONE WHEN` contract. The packet
contains only the reusable, authorized slice. A fresh smaller worker then
attempts the same class of work from that packet without access to private trial
text or hidden context. An independent Auditor compares observed behavior,
boundary compliance, evidence, checks, and outcomes. This capability remains
inactive and unaccepted until the full loop has a privacy-safe implementation,
independent evidence, and an explicitly admitted use.

**Done means.**

- Demonstration capture is bounded, consented where required, and separates
  direct observation from inference.
- Hidden reasoning, private conversation, source links, credentials,
  machine-specific identity, task identity, and unrelated project context are
  excluded from the reusable model and role packet.
- Every workflow step and decision traces to evidence, states its preconditions,
  and carries uncertainty or alternatives where the demonstration is not
  conclusive.
- The generated role packet is deterministic, least-privilege, revocable,
  includes the task pattern, decisions, evidence, tools, boundaries, failure
  paths, and `DONE WHEN`, and cannot expand authority beyond the admitted task.
- A fresh smaller worker starts without the demonstration transcript, hidden
  reasoning, or private context and produces its own source-bound evidence.
- An Auditor independent of the teacher, workflow compiler, and reproducing
  worker compares observed behavior, safety, process fidelity, evidence,
  quality, checks, and outcome.
- Failed or divergent reproductions refine or reject the candidate model; they
  do not silently promote it.

### 12. Remote delivery integrations — Not needed for the local prototype

**Promise.** Provider-backed publication, deployment, authentication, spending,
and rollback can later be enabled as governed capabilities.

**Done means before any provider is enabled.**

- The provider adapter has an explicit capability and permission contract.
- Authentication and secrets remain outside prompts, public source, and
  ordinary handoffs.
- Dry-run, approval, partial-failure, spend-limit, rollback, and audit tests pass.
- Each protected action receives action-specific authority at execution time.
- An independent checker verifies the provider receipt without performing or
  accepting its own protected action.

No remote provider is required or configured for the current local prototype.
This capability must not delay local correctness.

## Development sequence and priorities

### Phase 0 — Preserve current checked foundations

Keep the deterministic architecture direction, saved-project identity checks,
protected-action failures, bounded lifecycle, progress timer, typed handoffs,
and independent-check separation green while later work proceeds.

**Exit gate:** focused checks and direct read-only documentation checks pass on
the exact candidate; hostile fixtures still fail for the intended reasons.

### Phase 1 — Complete the contract-to-campaign vertical slice

Finish the deterministic kernel boundary, four-layer governance compiler,
conversation-to-contract path, Controller authority transitions, context
firewall, and task-shaped router as one coherent local workflow.

**Dependencies:** Phase 0 identity, evidence, and fail-closed behavior.

**Exit gate:** a clean local project can move from plain-language intent to one
bounded, independently checked, fully closed campaign with no private material
in public source.

### Phase 2 — Complete proof and whole-project checking

Add proof-carrying patch capsules, dependency and invalidation claims,
reproducible evidence bundles, and whole-project feature coverage.

**Dependencies:** stable contract, routing, source identity, lifecycle, and
independent-check contracts from Phase 1.

**Exit gate:** an independent checker can reproduce every acceptance claim on a
clean checkout and routes every missing or partial capability without silently
passing it.

### Phase 3 — Make continuity portable

Complete structured memory, startup reconciliation, recovery history, logical
workspace adapters, portable project capsules, privacy scanning, and optional
private synchronization.

**Dependencies:** stable authority and evidence schemas from Phases 1 and 2.

**Exit gate:** a project moves between clean local installations, survives
interruption, preserves decisions and evidence, and leaks no secrets or
machine-specific identities.

### Phase 4 — Prove upgrade and release safety

Implement compatibility governance, migration plans, policy replay, model
checking, sterile promotion evidence, and rollback proofs.

**Dependencies:** portable state format and complete evidence invalidation from
Phases 2 and 3.

**Exit gate:** supported upgrades and state migrations pass old/new,
mixed-version, interruption, reconciliation, and rollback scenarios; an
independent checker accepts the candidate while activation remains pending.

### Phase 5 — Add derived intelligence, inactive learning, and optional providers

Build bounded maps and repository intelligence first. Prove the inactive
demonstration-to-reproduction learning loop without granting it production
authority. Certify remote delivery, publication, deployment, spending, and
rollback adapters only when a real project need and owner-approved plan exist.

**Dependencies:** stable typed authority, evidence provenance, privacy scanning,
compatibility policy, and action-specific approval boundaries.

**Exit gate:** derived views remain traceable and non-authoritative; each
learned workflow is reproduced from a privacy-safe role packet and independently
compared; each enabled provider has independent capability, security, failure,
and rollback evidence.

### Phase 6 — Owner activation

Present the exact release candidate, independent evidence, compatibility and
migration result, residual risks, and rollback plan for owner review.

**Dependencies:** the required earlier phases for the intended release scope.

**Exit gate:** an explicit owner activation decision is recorded. Until then,
the release candidate remains prepared and inactive.

## Deliberately deferred or inactive

- Full portable project capsules and private synchronization follow stable
  authority and evidence contracts; they are not shortcuts around them.
- Governance model checking, policy replay, compatibility governance, and
  migration automation follow a complete local vertical slice.
- Visual maps and repository intelligence remain derived views and are not
  prerequisites for the current local workflow.
- Proof-based workflow learning remains inactive. A demonstration can support a
  candidate model, but cannot grant authority or become accepted policy without
  fresh reproduction and independent comparison.
- Remote publication, deployment, authentication, spending, production
  support, and provider-backed rollback are not needed for the current local
  prototype.
- Parallel development and direct feature-agent targeting require explicit
  coordination, workspace, policy, and audit support before admission.
- Release activation is owner-choice-only. `2.1rc` remains prepared but
  inactive.

## How roadmap status changes

A roadmap item advances only when evidence is bound to an exact source,
required checks pass, hostile cases behave as specified, privacy and boundary
checks pass, residual risks are recorded, and a checker independent of the
builder confirms the result. A failed or unavailable check remains evidence;
it cannot be converted into success through explanation.

Status should regress when source identity changes, a dependency invalidates
the evidence, a hostile test exposes a bypass, privacy material enters public
source, or the implementation no longer matches the stated promise. Owner
activation and other owner-only choices are never inferred from technical
completion.
