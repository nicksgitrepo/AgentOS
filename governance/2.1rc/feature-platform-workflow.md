# 1231 — V1 Governance 2.1rc Feature, Platform-Team, Worktree, And Cascade Workflow

Status: `RELEASE CANDIDATE — PORTABLE, NOT ACTIVATED`

Machine authority:
`schemas/capability-and-worktree-registry.v1.json`, SHA-256
`a3e6484321046dab625ddb760bbd8db36cda502afe8884e0111e83c32a64c220`.

That registry is normative for operational transitions. This article explains
intent and usage; it cannot create an unrepresented role, custody transfer,
state transition, or exception.

This article defines how a Campaign Orchestrator turns accepted governance and
project authority context into one cumulative single-root development
campaign. Governance 2.1rc activates one Product lane only. Multi-lane
predicates are retained as later design material, not executable authority.
It is project-agnostic.

## 1. Operating model

```text
Campaign Orchestrator
  compiles governance + project context + backlog + dependencies
        ↓
one or more cumulative feature lanes
        ↓
Feature Orchestrator owns each active lane checkpoint
        ↓
fresh platform agents advise or receive bounded writer subleases
        ↓
Feature Orchestrator integrates, proves, commits, pushes, and hands off
        ↓
Runtime converges accepted terminal lanes and deploys
        ↓
Independent Auditor inspects the exact live identity
        ↓
Campaign Orchestrator closes and opens the next-cycle backlog
```

The Campaign Orchestrator supplies structure, ownership, custody, conflict
decisions, and release admission. It does not manage routine implementation.

The Auditor evaluates the executable Function Requirements, Design Bible, and
Security question trees in parallel with the moving cumulative root. `NO` and
`UNKNOWN` become compact targeted repair or evidence assignments at coherent
handoffs; they do not create a serial approval queue. A critical safety or
security finding freezes only its affected surface unless exact evidence
proves that the impact is global.

Feature Orchestrators use the exact admitted authority context to understand outcome,
domain ownership, protected boundaries, contracts, and unavailable behavior.
They inspect source and runtime to determine current reality.

### Authority-corpus compiler and live maintainer

The same package bootstraps and maintains the project's authority corpus.
Project context supplies repository-relative root variables; the registry
supplies the portable tree and page contracts.

The initial tree is complete only when project, goal, design, decision, case,
evidence, and archive indexes plus the adjacent active/historical evidence
library are all materialized, even when feature, capability, campaign, and
release inventories are empty. Every corpus directory root is
distinct: equal or ancestor/descendant roots are refused. `authority_root` is
the sole containing root, and `authority_index_path` is a file rather than
another directory root.

Planning and application both enforce lexical and canonical filesystem
containment. Existing ancestors and leaf reads must not traverse symbolic
links; creation uses exclusive, no-follow writes where the host supports them;
index replacement revalidates its real parent immediately before the atomic
rename. A path that cannot be proven inside the canonical admitted root is
refused without writing bytes.

Canonical object keys, entity identifiers, paths, entries, and tie-breaks use
unsigned UTF-8 byte ordering rather than locale or filesystem order. Plan and
context identities hash compact canonical JSON so the same admitted inputs
produce the same bytes across supported hosts.

The Campaign Orchestrator owns deterministic tree planning, context routing, and
index maintenance—not every page's truth. Feature Orchestrators own their compact
feature overview plus intent/current-state/build-log/contract/decision/handoff
updates. Platform
Agents return scoped pseudocode, contextual comments, implementation notes,
proof, and compact capability-overview updates for their seam. The Auditor
defines and verifies intended-Product gates; builders may update progress and
attach evidence but cannot self-verify or weaken gate intent. The Auditor and
Runtime return
evidence that updates current reality without taking page ownership.

```text
GLOBAL_ORCHESTRATOR:
  validate(project_root_variables)
  compile_missing_tree_nodes()
  route_page_ownership()

FEATURE_LEAD at checkpoint:
  update_compact_overview_without_copying_detailed_evidence()
  update(feature_current_state)
  append(feature_build_log)
  bind(contracts, decisions, failures, handoff)

PLATFORM_AGENT at return:
  return(scope, pseudocode, context_comments, compact_handoff, proof_pointer, non_ownership)

GLOBAL_ORCHESTRATOR:
  refresh_only_affected_pages()
  regenerate_authority_index()
  reject_stale_unowned_duplicated_or_escaping_entries()
```

Every generated page binds provenance, owner, source identity, status,
freshness/invalidation, and supersession. Pages never silently manufacture
missing facts. Append-only logs do not become competing current-state
authority.

### Compact context and release evidence library

Living feature, platform, campaign, and handoff pages contain operational
context only. They do not contain raw test output, screenshots, research,
packets, receipts, or repeated historical narration. A compact handoff names
the exact checkpoint, relevant paths and symbols, changed or relied-upon
contracts, proof pointer, remaining unavailable behavior, known trap, and
next owner/action.

Every release receives one permanent compact summary in the authority corpus
and one detailed active dossier in the adjacent evidence library. The dossier
collects every participating agent below `agents/<owner>/` plus tests,
screenshots, research, packets, receipts, decisions, deployment, audit, and
rollback evidence. The declared owner inventory must equal those agent
namespaces exactly; omissions and extras fail closed.

```text
release closes as ACCEPTED_LIVE_CLOSED
  -> retain detailed dossier loose for project_context.active_window_days
  -> create deterministic content-addressed ZIP + canonical manifest + checksum
  -> reread exact checksum bytes and archive basename
  -> verify embedded manifest, unique typed records, payload hash/mode, no extra entry, and full readback
  -> update permanent compact release summary with archive identities
  -> optionally compact only verified loose duplicates through an explicit action
```

Unsafe paths, symbolic links, unsupported filesystem objects, omitted or
extra agent namespaces, missing exact release identity, early archive,
duplicate or malformed manifest records, unmanifested entries, adjacent
checksum content/name mismatch, central mode mismatch, and failed readback
preserve the active dossier and fail archive closed. Historical agents read the release summary
and manifest first and selectively extract only required files into a
temporary read-only location. Whole-archive prompt loading is not the
default.

### Scripted context intake

Before compiling project goals, a design system, or a new feature, the Global
Orchestrator runs the registry's `SEMI_SCRIPTED_DRILL_ME` script.

- Project-goal intake establishes users, observable outcomes, scope,
  protected/owner-only boundaries, repositories, environments, release and
  rollback, success, and material direction choices.
- Design-system intake establishes users/devices/accessibility, brand and
  protected baselines, tokens/components/page families, responsive and state
  behavior, preference boundaries, and deployed perceptual proof.
- Feature intake establishes the repeated user moment, owned truth, current
  source/data/runtime/view/settings/integration reality, contracts,
  dependencies, protected boundaries, smallest batch, failure behavior, and
  proof.

The agent first fills discoverable gaps from exact authority and current
source/runtime evidence. It asks one compact material question only when that
answer could change outcome, authority, owner, route, proof, rollback, or
unavailable behavior. It stops at reasonable sufficiency and records later
unknowns instead of delaying the first reversible batch.

A typed context blocker holds only its dependent outcome and always preserves
a safe default, unaffected work, responsible owner, and exact resume
condition. Only a real owner-only class interrupts the owner.

## 2. Global roles

### Campaign Orchestrator

Owns:

- campaign admission and topology;
- exact feature ownership and order;
- lane roots, branches, namespaces, and leases;
- shared paths/contracts and primary-owner decisions;
- migration allocation;
- cross-feature and cross-lane conflicts;
- owner-only routing;
- broken-chain recovery;
- authority-corpus bootstrap, tree compilation, and deterministic index
  maintenance;
- semi-scripted project-goal, design-system, and feature context elicitation;
- serialized integration admission;
- final launch acceptance and closure.

Does not own routine Product implementation, feature stage progression,
independent audit, deployment execution, or another owner's truth.

### Feature Orchestrator

Owns:

- one observable feature outcome;
- one active macro-stage goal;
- one feature checkpoint within one cumulative lane root;
- Blueprint, substantial Build batches, platform-agent orchestration,
  readiness, commits, proof, and feature handoff;
- feature-local contracts and next-cycle backlog.
- feature intent, current-state, append-only build-log, decision, contract,
  and handoff context.

A Feature Orchestrator does not deploy, self-audit, rewrite another feature's truth,
allocate shared migrations, or retain custody after handoff.

### Platform Agent

A Platform Agent is created on demand for one feature-exclusive, campaign-local
capability seam. It is not a standing specialist pool and it is not shared
across features. The same Feature Orchestrator may reuse the pinned session
and worktree for later material batches in that feature until the campaign
boundary; a returned checkpoint is not an archive or a cross-feature lease.

It receives one exact capsule:

- feature and stage;
- exact checkpoint;
- capability;
- advisory or writer mode;
- seam and allowlist;
- source and contract inputs;
- protected surfaces;
- proof;
- unavailable behavior;
- rollback;
- return and archive condition.

It advises or implements one material platform seam and returns directly to
the Feature Orchestrator. Its return includes compact pseudocode and contextual
comments for its exact seam when material. It does not redefine feature
intent, promote comments to authority, or own the campaign.

Platform Agents work autonomously inside their capsule. They solve ordinary
implementation puzzles, try safe equivalent mechanisms, rerun affected
proof, and return one consolidated packet. They do not interrupt the Feature
Lead for routine choices, narrate intermediate work, or escalate merely
because the first mechanism failed.

They report one real blocker only after safe in-scope alternatives are
exhausted and completion requires new authority, broader custody, shared
contract/migration/resource allocation, a protected boundary, or an
unavailable dependency without an honest fallback. The blocker holds only the
dependent outcome and preserves all unaffected work.

### Independent Auditor

The Auditor binds an exact source/artifact or deployed identity, inspects
independently, deduplicates findings by causal root, and separates emergencies
from ordinary backlog.

The Auditor owns no Product writes, repair worktree, deployment, or
self-acceptance.

### Runtime

Runtime is the exclusive mechanical integration and release operator.
It applies accepted commits in the exact semantic order supplied by the Global
Orchestrator, builds or rebinds artifacts, verifies environment and rollback,
deploys, and returns exact runtime receipts.

It never invents Product intent or resolves semantic conflicts.

## 3. Generic web-platform capability catalog

Every Feature Orchestrator considers each capability and returns one classification:

- `MATERIAL_ADVISORY`
- `MATERIAL_WRITER`
- `NO_MATERIAL_SEAM`
- `DEFERRED_OWNER_ONLY`
- `NOT_APPLICABLE_WITH_AUTHORITY`

Generic capabilities:

| Capability | Core responsibility |
|---|---|
| Database/RLS | Durable schemas, migrations, constraints, tenant isolation, grants, recovery, provenance. |
| Backend/API | Contracts, commands/queries, validation, authorization, idempotency, concurrency, events, errors. |
| Identity/Access | Authentication, sessions, memberships, roles, scope changes, revocation, residue clearing. |
| Security/Privacy | Threats, abuse, secrets, denial, redaction, tenant separation, supply chain, secure failure. |
| UI/UX | User outcome, interaction, states, accessibility, responsive behavior, visual truth. |
| Shell/Navigation | Routes, mounting, overlays, focus, scroll, eligibility, context cleanup. |
| Settings/Configuration | Typed settings, policy/default/preference separation, precedence, persistence, rollback. |
| Domain View | Feature-owned truth, projections, evidence, actions, and unavailable behavior. |
| Integrations/Providers | External APIs, webhooks, identity, retries, rate limits, receipts, degraded operation. |
| Messaging/Notifications | Recipient authority, delivery, acknowledgement, action, resolution, offline state. |
| Documents/Records | Provenance, revisions, files, reports, redaction, retention labels, corrections, support evidence. |
| Search/AI | Retrieval, ranking, citations, generation, tools, uncertainty, refusal, privacy. |
| Observability/Operations | Health, logs, metrics, alerts, incidents, runbooks, operational receipts. |
| Runtime/Release | Build contexts, artifacts, environments, configuration, deployment, rollback, live identity. |
| Quality/Test Architecture | Proof layering, hostile cases, baseline classification, fixtures, artifact inspection. |

The machine registry contains the exact questions, prohibited claims, and
materiality triggers for every capability.

These fifteen capabilities are a portable baseline, not a universal ceiling.
Project context may add typed capability families only with a unique identity,
scope, minimum questions, prohibited claims, material trigger, owner, and
handoff. Extensions cannot override portable roles, writer exclusivity, audit
independence, Runtime's execution-only boundary, owner-only classes, or
kernel authority/failure/proof/handoff law.

## 4. Worktree and refactor options

### Option A — Feature-root implementation

Use when the Feature Orchestrator can implement the seam directly inside its admitted
scope.

- one root;
- one writer;
- platform agents may advise;
- Feature Orchestrator commits and pushes.

This is the default and simplest route.

### Option B — Read-only platform advisory

Use when expertise or proof design is required but no platform-owned Product
edit is necessary.

- no platform worktree;
- no writer custody;
- fresh agent reads exact source and authority context;
- one bounded packet returns to Feature Orchestrator;
- agent archives.

### Option C — Same-root platform sublease

Use when one platform agent must edit exact paths in the feature root.

1. Feature Orchestrator pauses writes.
2. Exact root, base, allowlist, sublease, proof, and expiry are recorded.
3. Platform agent becomes the sole writer.
4. Agent edits, proves, commits, pushes, and returns a clean handoff.
5. Sublease closes.
6. Feature Orchestrator revalidates and resumes custody.

Two writers may never hold the same root simultaneously.

### Option D — Isolated platform child worktree

Use when the platform seam is independently committable, risky, or benefits
from isolation.

- child worktree starts at the exact feature checkpoint;
- platform agent owns one branch and allowlist;
- feature root continues only if there is no dependency on unfinished child
  work;
- agent returns commit/tree and integration manifest;
- Feature Orchestrator classifies overlap and integrates.

The child agent does not become a second Feature Orchestrator.

### Option E — Shared-contract primary worktree

Use when multiple features need one shared contract, schema, migration,
generated output, or configuration surface.

- Campaign Orchestrator selects one primary owner;
- competing writers are frozen;
- migrations and namespaces are allocated once;
- consumers provide exact requirements;
- primary owner produces a versioned checkpoint;
- consumers rebind and continue.

### Option F — Audit evidence root

Use only for independent source, artifact, or exact-live inspection.

- evidence-only;
- no Product writer;
- no repair custody;
- findings route to owners or emergency authority.

### Option G — Global integration/release worktree

Use only after accepted terminal feature or lane checkpoints.

- one serialized writer: Runtime;
- exact accepted commit order;
- semantic decisions supplied by Campaign Orchestrator;
- artifact, deployment, rollback, and live identity mechanically proven.

Every Feature Orchestrator and Platform Agent receives one compact context capsule,
not an indiscriminate authority-corpus dump. It binds governance and project-context
identity, outcome, non-goals, authority, ownership, current source/runtime
reality, contracts, dependencies, protected surfaces, unavailable behavior,
proof, freshness, and return route.

Every writer lease binds a finite progress interval, last concrete progress,
recovery condition, and same-role continuity deputy. On crash, budget
exhaustion, or expiry, writes freeze while the supervisor inspects task state,
worktree bytes, remote head, and dependencies. Recovery never creates two
writers, discards user work, broadens scope, or represents administrative
goal completion as stage completion.

## 5. Campaign compiler

The Campaign Orchestrator compiles:

- exact portable kernel;
- exact project-context binding;
- exact authority-corpus commit or immutable snapshot;
- exact deterministic authority index and root-variable binding;
- current project goals, design-system context, feature intent/current-state,
  and platform-capability context;
- typed context blockers, safe defaults, and deferred unknowns;
- owner outcome;
- current repository identities;
- causal-root backlog;
- feature/capability roster;
- path, contract, schema, event, configuration, generated-output, migration,
  and runtime ownership;
- dependency graph;
- resource limits;
- rollback baseline;
- protected owner-only holds.

It produces:

- campaign-open record;
- lane topology;
- ordered feature owners;
- roots and branches;
- exclusive writer leases;
- ownership matrix;
- migration allocation;
- cross-lane contract index;
- rollback bindings;
- progress and convergence law.
- affected authority-page ownership and maintenance triggers.

## 6. One cumulative Product lane

### Default — one cumulative campaign root

The compiler chooses exactly one cumulative campaign root. For a project with
multiple repositories, the campaign root contains one cumulative worktree per
repository; those repository worktrees travel together as one custody unit.

The root passes sequentially through the ordered Feature Orchestrators. Exactly one
Feature Orchestrator or admitted same-root platform sublease writes at a time. Each
feature completes one substantial usable batch, runs affected stable proof,
commits and pushes an immutable checkpoint, closes its lease, and transfers
the same clean root to the next exact owner. Prior accepted work is inherited
and is not replanned or reimplemented.

Feature checkpoints are not merged individually to the shared default branch.
After a coherent milestone—normally an end-to-end user outcome across related
features rather than a file or task count—the Campaign Orchestrator accepts the
terminal cumulative checkpoint. Runtime then performs one serialized
integration, artifact mint, deployment, rollback binding, live handoff, and
closure transaction.

### Deferred design — multi-lane cascade

Multiple cumulative roots are not activatable in 2.1rc. A later governance
version may implement them only after executable per-lane state, lane-local
blockers, custody, transitions, convergence, and hostile proof exist. The
retained design predicates are:

- two or more dependency-independent feature sequences exist;
- each lane has disjoint primary ownership;
- shared contracts have exact producers, consumers, versions, and unavailable
  behavior;
- one exclusive writer lease per lane is guaranteed;
- a finite convergence order exists;
- the expected parallelism materially reduces milestone time relative to one
  cumulative root; and
- the reconciliation, migration, rollback, and proof cost is bounded and
  lower than the expected benefit.

These predicates do not grant a second writer root in 2.1rc.

Within the single root, future unstarted feature order may change only at an
immutable pushed checkpoint with no active writer. The Campaign Orchestrator
recomputes dependencies, preserves history and rollback, and may reorder
future owners. It may not move accepted checkpoints, change an active owner
behind its lease, create another writer root, or use reordering to bypass a
failed stage.

## 7. Lane law

The campaign root binds:

- lane identity;
- ordered Feature Orchestrators;
- exact repository roots and branches;
- starting commits and trees;
- exclusive lease;
- primary path/contract ownership;
- migrations and generated outputs;
- cross-lane contracts;
- protected surfaces;
- rollback;
- append-only checkpoint ledger;
- current owner, stage, goal, and next action.

Each feature starts from the prior immutable lane checkpoint. It may not
restart the lane, fork an unadmitted root, erase prior accepted work, or hand
off a dirty/unpushed worktree.

## 8. Cross-lane contract law

Cross-lane sharing uses immutable versioned contracts:

```yaml
contract_id:
producer_lane_and_checkpoint:
primary_owner:
version:
digest:
compatibility_range:
consumer_lanes_and_features:
unavailable_behavior_before_checkpoint:
freshness_and_invalidation:
```

Cross-lane sharing never uses cherry-picks, copied diffs, foreign-worktree
edits, or narrative assumptions.

Consumers remain explicitly unavailable until the producer checkpoint exists.

## 9. Feature workflow

```text
CAMPAIGN_ADMITTED
  → BLUEPRINT
  → CAPABILITY_SELECTION
  → ON_DEMAND_PLATFORM_SEAMS
  → BUILD
  → BUILDER_READINESS
  → READY_FOR_GLOBAL_INTEGRATION
  → LAUNCH
  → LIVE_AUDIT
  → CLOSURE
```

### Blueprint

Feature Orchestrator frames the intended outcome, inspects current reality, classifies
contracts/dependencies, chooses the smallest reversible substantial batch,
and identifies material platform seams.

### On-demand Platform Agents

Create and pin one Platform Agent only when a Feature Orchestrator identifies
an exact material capability seam. Bind it to the campaign, feature,
capability, worktree, writable/proof scope, and direct supervisor. Use
advisory, same-root sublease, isolated child, or shared-primary mode. Do not
pre-spawn a platform wave, create a future campaign wave, share the session
with another feature, or archive it between same-feature returns. Archive and
unpin it only when its feature or campaign scope closes, and never delete its
session identity.

### Build

Feature Orchestrator implements substantial batches, integrates platform returns,
runs affected proof, reports its own materially distinct failures to the
Campaign Orchestrator for reframing, supervises Platform Agent failure reframes,
builds the production artifact, commits, pushes, and maintains one cumulative
manifest.

### Failure reframe inside the active stage

Failure does not automatically mean “repair the attempted mechanism.”

The supervisor reframe triggers before another retry when the same unresolved
mechanism fails twice, a stage/handoff invariant is failed or unproven,
material context or a new assumption is required, authority contradicts
current reality, the repair would broaden scope/custody/infrastructure or
weaken proof, or the governed progress interval expires without substantial
progress. A localized syntax, compilation, or directly attributable test
failure with an obvious bounded correction remains with the builder.

The builder preserves the failed route, evidence, mutation boundary, and
custody, then sends that unchanged packet to its direct supervisor. The
builder does not approve its own alternate route.

The supervisor restates the protected outcome, inventories missing authority,
source, contract, dependency, runtime, and proof context, and samples exactly
one lens from `ELI5`, first principles, pseudocode, if/then cases,
project context, analogy, test gates, “what do you think?”, and “how would you
solve this?”. The sample order is derived reproducibly from the failure-root
identity and immutable evidence digest using the registry's exact algorithm,
so it diversifies reasoning without selecting truth or authority.

The supervisor performs the smallest discriminating checks, compares
alternate existing-architecture routes, rejects any weakened boundary, and
returns one exact reversible route plus bounded custody to the builder. It
then records a reusable root-cause resolution rule.

Project context binds a finite supervisor-response interval. On verified
unavailability or expiry, one predeclared same-role continuity deputy may
answer from the identical failure packet without broader custody. The
supervisor may request one technical recommendation from the reporting
specialist or one fresh advisory agent; advice does not transfer decision
authority.

The builder may make one evidence-backed feasibility objection to the returned
route. The supervisor confirms or replaces it once. Further disagreement
holds only the dependent outcome and creates no review loop.

The reframe remains inside the same macro goal and worktree. It creates no
micro phase. It cannot bypass a real authority, tenant, security, privacy,
safety, durable-data, proof, rollback, or owner boundary. A builder cannot
self-reframe repeatedly or shop among supervisors.

### Builder readiness

Only material capabilities inspect the exact integrated candidate. Consolidate
one must-fix batch. Noncritical findings move to `IMPROVE`.

At every substantial pushed checkpoint, classify the changed surfaces and
create and pin only the read-only seam reviewers required by the delta:

- visible UI: UI/UX, Shell/Navigation, Accessibility, and Security;
- authenticated UI: those roles plus Identity/Access;
- Backend/API: Backend/API and Security;
- database/schema/query: Database/RLS, Recovery, and Security;
- provider/integration: Integration, Runtime, and Security;
- runtime/configuration/build: Runtime and Security.

Safe root progress continues while reviews run. A reviewer never rewinds or
edits Product. `CATASTROPHIC` holds the affected handoff immediately.
`MATERIAL` queues a return of the current cumulative root at the next stable
handoff to the Feature Agent that created the offending checkpoint, with
failed gates, current root identity, exact allowed paths, later protected
changes, and the return recipient. `NONCRITICAL` enters the next campaign.
A passing review creates no correction custody.
Every review is valid only when its session, role, campaign, pinned/read-only
state, on-demand spawn reason, and material seam match one admitted current
campaign `PLATFORM_AGENT`; self-attested or reused reviewer identities fail
closed. Changed surfaces are derived mechanically from the exact sorted changed
paths and bound to checkpoint, root, branch, commit, tree, originating owner,
and one change-manifest SHA-256. A review cannot be replayed onto a later
checkpoint or substitute a caller-declared surface.

### Global integration and launch

Campaign Orchestrator resolves shared semantics and gives exact custody to
Runtime. Runtime integrates, builds, deploys, and returns the exact live
identity.

### Live audit and closure

Auditor inspects exact live identity. Ordinary findings enter the next-cycle
backlog. Emergencies route immediately. Campaign Orchestrator verifies closure,
archives temporary agents, releases worktrees/leases, and retains the backlog.

## 10. Autonomous progression

The Campaign Orchestrator may autonomously:

- choose topology and lane count;
- assign feature order and leases;
- select shared primary owners;
- allocate migrations and namespaces;
- admit safe reversible recovery;
- activate the next owner after an accepted checkpoint;
- continue unaffected lanes around dependencies;
- issue convergence and deployment custody.

Feature Orchestrators may autonomously progress in-scope stages when `DONE WHEN` is
satisfied. Every host goal is bound to one exact goal-system identity,
instruction SHA-256, DONE-WHEN SHA-256, start time, and completion receipt;
prose status alone cannot create, change, or close it.

Only an exact true-blocker class with exhausted safe alternatives interrupts
the owner. The campaign-scoped Orchestrator records
`TRUE_BLOCKER_SUSPENDED`, suspends the same macro goal and its configured
progress timer, and retains one resolution watcher. Mechanical resolution
resumes the same goal and restarts its timer. It creates no replacement goal,
root, lease, or campaign.

## 11. Progress control

Concrete progress is:

- Product commit or immutable checkpoint;
- completed substantial batch;
- released/transferred lease;
- resolved dependency or accepted contract;
- exact blocker with immediately executing recovery.

When no concrete progress occurs within the project-context progress interval
while the campaign is active, inspect goals, budgets, leases, worktrees, and
dependencies and repair the broken chain. Do not create a micro goal, extra
root, repeated broad review, or cross-scope custody. Unaffected lanes
continue. A `TRUE_BLOCKER_SUSPENDED` campaign has no progress or stall timer
until its exact resume check passes.

Routine agent communication is outcome-based:

- one consolidated completion/handoff packet; or
- one exact real-blocker packet after local alternatives are exhausted.

Intermediate puzzles, test counts, implementation narration, speculative
concerns, and routine permission requests stay local to the active specialist.

## 12. Convergence

Convergence requires:

- every lane has a clean pushed terminal checkpoint;
- cross-lane contracts and consumer impacts are exact;
- semantic conflicts have Campaign Orchestrator decisions;
- rollback is exact;
- ordinary next-cycle backlog is preserved.

Runtime starts from accepted current main and applies terminal lane
commits in the compiled order. A disposable rehearsal may test mechanics but
cannot decide semantics.

The result is one canonical integrated commit, exact artifacts, deployment
identity, rollback, live audit, and accepted-live closure.

## 13. Portable campaign controller and authority recovery

The Campaign Orchestrator is the sole canonical authority-corpus and compiled
campaign-view writer. The campaign itself is a living record carried inside
the cumulative worktree:

- the Orchestrator initializes the campaign, topology, goals, and exact session
  IDs for every Orchestrator-created agent;
- the active Feature Agent appends its own compact work events and records the
  exact session ID of every on-demand Platform Agent it creates;
- a Platform Agent, Auditor, or Runtime appends only its own allowed event
  type; and
- no agent may rewrite another event, topology, accepted checkpoint, or the
  compiled current view.

Each event is one bounded content-addressed file created exclusively with
no-follow semantics under the exact writer session's digest-named
subdirectory of `campaigns/<campaign-id>/events/`, chained to that session's
prior event. A full deterministic readback rejects missing, extra, renamed,
rewritten, non-regular, or symlinked entries. Independent per-session streams prevent parallel
Auditor, Feature, and Platform work from competing for one sequence or file.
The Orchestrator deterministically orders their identities into one ledger
digest. This event-only write right is not Product custody or canonical
snapshot authority and does not create a second Product writer. At the
configured interval and every handoff, the Orchestrator reconciles the ledger
with task, goal, lease, worktree, remote Git, dependency, deployment,
rollback, and audit reality, then compiles `current.md`. A healthy timestamp
alone creates no authority commit.

An authority transition is applied only by the exact pinned Orchestrator
session against the prior snapshot and next sequence. Merely writing
`GLOBAL_ORCHESTRATOR` into a state object is not writer proof.

Standard articles describe only the last accepted live release. One active
campaign article describes work in progress. A merge without accepted live
status remains `MERGED_NOT_ACCEPTED_LIVE`. After Runtime deployment and exact
live audit, the Orchestrator promotes the accepted campaign delta into
standard articles, freezes the campaign article as previous history, and
starts evidence-library closure.

The dependency compiler creates a deterministic topological order. A
prerequisite chain `X -> Z -> Y` passes the same cumulative root from X to Z
to Y. A phase goal closes only after a clean remote-equal pushed checkpoint,
released lease, and accepted same-root handoff whose checkpoint, branch,
commit, tree, lease, source owner/goal, and next compiled owner/goal agree.
The terminal form must name Runtime. A newly discovered prerequisite
changes only the unstarted tail at a pushed checkpoint. A cycle becomes one
Orchestrator-owned shared-contract checkpoint with one primary writer.
The immediate next snapshot must preserve the handoff's clean pushed
remote-equal checkpoint, activate the exact recipient, and issue a fresh
lease on the same root; recording a handoff without advancing custody is
rejected.

Every Orchestrator snapshot and checkpoint handoff binds the exact event count,
aggregate ledger digest, per-session writer heads, and compiled campaign-view
SHA-256. The recipient proves monotonic prefix continuity before beginning
work. A Platform return must bind its exact Feature-authored spawn event,
active goal, dependency, material seam, and content-addressed evidence. These
bindings let a new agent continue from the last known campaign point without
requiring prior chat.

Runtime is the only persistent cross-campaign agent. Each admitted
campaign gets a fresh pinned campaign-scoped Campaign Orchestrator, fresh
pinned Auditor, and fresh pinned Feature Orchestrators from the latest
admitted governance and model-class policy. Their display names are exactly
`<OneWordRole> <CampaignVersion> <GovernanceVersion>`; for this release
candidate the last token is `2.1rc`. Runtime is `Runtime Persistent 2.1rc`.
Platform Agents are created and pinned only on demand, remain feature-exclusive
through same-feature returns, and are archived only at the feature/campaign
boundary. Completed campaign sessions are archived and unpinned, never deleted
or reused as the next campaign's execution identity.
The current roster contains exactly one pinned Campaign Orchestrator, one
pinned Auditor, one pinned persistent Runtime, and one pinned Feature
Orchestrator for each dependency owner. A material Platform Agent appears only
after its feature records the seam. A successor packet may name the next
campaign's intended roles, but successor sessions and leases do not exist
until that campaign is separately admitted.

Before terminal handoff to Runtime, the current Auditor deduplicates findings
and owner questions into one ordered next-campaign candidate. That handoff
records a durable candidate packet only. The next campaign is not spawned,
pinned, leased, or given Product custody until the Orchestrator admits it as a
new campaign. The closing Auditor remains pinned through the current exact-live
audit, and closing sessions are archived only after accepted-live closure.
Every admitted dependency owner maps to one fresh pinned Feature Orchestrator,
and the Auditor and Campaign Orchestrator are fresh for that admitted campaign.
Successor continuity uses the candidate digest and a later admission record,
not a speculative roster. The active goal binds exactly one pinned Feature
Orchestrator even while archived predecessor sessions remain in history.

The recovery source is the last pushed campaign snapshot, exact Git remotes
and commits, compact handoffs, project context, Runtime identities, and
adjacent evidence-library manifests. Old chat access is optional. A fresh
machine verifies mechanical reality, marks machine-local leases stale,
reissues one exclusive lease, and resumes the recorded next action. Verified
Product work ahead of the snapshot may advance it; Product work is never
automatically reverted to make documentation agree.

Ordinary defects stay with the builder: inspect, fix, run affected proof,
commit, and hand off. No step narration, per-test authority record, raw
screenshot/receipt dump, or formal root-cause packet is required. The
direct-supervisor reframe remains reserved for its governed trigger. Only a
true blocker—owner policy, protected safety/law/private-data authority,
unavailable credentials/access, material cost, destructive production,
stack replacement, an unresolvable active-writer/shared-authority conflict,
or an external dependency without fallback—pauses the campaign for one exact
owner question after safe alternatives are exhausted.

For provider authentication, Runtime returns one exact
`UNAVAILABLE_CREDENTIAL_OR_EXTERNAL_ACCESS` blocker naming the provider,
admitted account/environment, reason, official HTTPS authorization page,
whether the link is sensitive, the exact mechanical resume check, and the
suspended Runtime goal. The Orchestrator exposes that link to the owner for
use in the configured interactive browser, suspends the same goal and timer, and resumes only after
Runtime proves access. Transient signed URLs, tokens, cookies, and credentials
never enter the authority corpus.
Persisted blockers must therefore set `sensitive_link=false` and retain only
an admitted public HTTPS authorization origin/path with no URL credentials,
query, or fragment. Any sensitive or signed authorization link remains
runtime-only.

Interactive provider authentication and owner-session inspection explicitly
open and control the browser selected in the sealed configuration snapshot.
Never invoke the operating-system default browser, a generic URL-opening
action, or an unconfigured fallback. Automated deployed-site testing uses
only the configured framework, explicit browser project, and isolated
automation profile. Automation never uses the owner's normal browser profile
or silently inherits its session. Application authentication is created only
through the configured project-auth procedure for that actor and environment.
If selected-browser control is unavailable, return
`SELECTED_BROWSER_CONTROL_UNAVAILABLE`; do not fall back.

```text
EVERY configuration_snapshot.progress_interval_minutes:
    observe task + goal + lease + worktree + remote + runtime
    IF material progress or reality changed:
        reconcile and write one compact campaign snapshot
    ELSE IF progress interval expired:
        repair the broken chain and write one recovery snapshot
    ELSE:
        make no authority commit

ON ACCEPTED LIVE:
    closing Auditor returns exact-live disposition
    promote campaign truth into standard last-release articles
    release already-oriented successor Product lease
    archive and unpin closing Orchestrator/Auditor without deletion
```

Accepted-live closure and standard promotion additionally require matching
Runtime deployment and rollback identities, the independent audit identity,
and one exact closure-receipt digest. Closure also requires the terminal
Runtime handoff, clean remote-equal root, matching standard release identity,
and no unresolved owner hold. `TRUE_BLOCKER_SUSPENDED`, a suspended goal, and
a valid true-blocker record must always appear together.

## 14. Hostile boundaries

Reject:

- two writers in one lane;
- feature owner editing another active root;
- platform agent redefining feature intent;
- Platform Agent shared across features or reused after its feature/campaign boundary;
- speculative successor Orchestrator, Auditor, Feature, or Product-writer wave;
- Auditor Product edits or self-acceptance;
- Runtime semantic decisions;
- Campaign Orchestrator routine implementation management;
- multi-lane activation before ownership/dependency classification;
- consumer use of an uncheckpointed producer;
- prior lane topology reused without recompilation;
- ordinary Product finding blocking deployment;
- worktree handoff without pushed commit, clean state, manifest, and custody
  release;
- governance without exact project context, or context without the exact
  portable kernel.
