# ROADMAP_04_TASK_ROUTING_CONTEXT — Task-Shaped Routing and Context

This report is append-only. It records the audit of the accepted-merge
candidate, the bounded repairs made in this isolated worktree, and the
subsequent self-audit and re-audit. Functional tests remain pending by task
instruction; no npm workflow is required or used.

## Audit pass 1 — initial audit of accepted merge

### Scope and authority

- Feature: `ROADMAP_04_TASK_ROUTING_CONTEXT` — Task-Shaped Routing and Context.
- Inventory record: `docs/feature-inventory.v1.json`, status `NOT_STARTED`.
- Inventory sources: `docs/roadmap.md`, `schemas/task-model-policy.v1.json`,
  and `schemas/effective-model-readback.v1.json`.
- Accepted-merge authority observed at commit `590c07ddd4be7a8c24727c24b40808e44ca7357d`
  and tree `f1b358d87e6a969fb9631e202a3d478540edd4d9`; the authority worktree
  was a dirty integrated snapshot, so its uncommitted feature files were read
  as candidate implementation and not modified.
- The isolated builder worktree started at the same committed base and was
  clean before this report was created.
- `2.1rc` remains `PREPARED_NOT_ACTIVATED`; this audit does not activate it or
  rebind any Product campaign.

### Intended behavior

The roadmap promises that task need selects role, model, reasoning effort,
context, tools, worker shape, workspace capability, and evidence path. The
decision must be typed, explainable, deterministic from the admitted task and
project state, and honest when a capability is unavailable. Small tasks must
not inherit oversized context or teams. Selective context retrieval must keep
unrelated project data, secrets, stale records, and unauthorized memory out of
the task. The roadmap also requires representative evaluation fixtures for
quality, cost, latency, context sufficiency, and policy compliance, plus an
independent reproduction of the same route.

The surrounding governance intent adds the following constraints: a requested
model is not execution proof; host and session readbacks must agree before
acceptance; fallback may only preserve requirements; protected external
actions remain outside the portable routing kernel; privacy-safe persisted
records contain digests or safe labels rather than paths, credentials,
provider accounts, session details, or private links; and unavailable host
capabilities are reported as unavailable rather than simulated.

### Actual implementation observed

The accepted merge adds a substantial standalone routing slice:

- `control/task-model-routing.mjs` compiles and validates task profiles,
  model policy, host capability catalogs, execution routes, fallback routes,
  and route rejection reasons.
- `control/task-model-routing-support.mjs` compiles effective host/session
  readback records and typed fallback boundaries.
- The six new routing schemas describe task profiles, policy, host catalog,
  execution route, effective readback, and fallback boundary.
- `tests/verify-task-model-routing.mjs` covers deterministic candidate
  matching, role overrides, safe fallback, readback mismatch/unknown states,
  protected-action rejection, and a basic privacy scan.
- The public kernel re-exports the routing compiler and exposes a routing
  namespace.
- The candidate routes by capability, context-token floor, tools, verifier,
  permissions, expected cost, deadline, completion probability, and owner
  role/lane overrides. It content-addresses the records and refuses to enable
  protected external actions.

The module documentation explicitly describes the slice as integration-neutral:
it does not create a host session and does not treat the requested model as
execution proof. No active campaign, native session, local worker, controller,
or context-store call was found that consumes an execution route before work.

### Findings

#### F-01 — Route is not an admitted pre-work control (critical, repairable)

The implementation can compile a route, but the active worker/session and
campaign paths do not require one before work. The route is therefore an
optional library record rather than the authority that selects and constrains
the actual worker. A user can receive a valid-looking route while the runtime
continues with its existing model/session choice.

Why it matters: the roadmap's capability check, honest-unavailable behavior,
route reproducibility, and permission ceiling are not enforced at the work
boundary. This is the difference between a routing explanation and task-shaped
routing.

Evidence: the routing module has no caller in the active session/worker
admission path; its own header says it is integration-neutral. The public
export is discoverability, not enforcement.

Builder action: add a small portable route-admission boundary that consumes a
typed task profile, policy, capability catalog, source binding, and host/session
readbacks; require successful route admission before work; return typed
`UNAVAILABLE`/`BLOCKED` results without creating a simulated worker; keep
Product custody and protected actions outside this kernel.

#### F-02 — Selective context retrieval and firewall are missing (critical,
repairable)

The profile carries only a project-context digest and a token count. It has no
context item allowlist, provenance, freshness, authority, memory authorization,
or retrieval result. No runtime function rejects unrelated project data,
secrets, stale records, or unauthorized memory before prompt construction.

Why it matters: a digest identifies a context snapshot but does not prove that
the material placed in a prompt belongs to the admitted task. This leaves the
main privacy promise unimplemented and makes context sufficiency impossible to
reproduce independently.

Evidence/unknowns: the existing persisted-record privacy scanner protects
serialized records, but it does not decide whether a context item is relevant,
current, authorized, or allowed for a particular task. No linked research
record or project-specific authority corpus was available in the inventory
sources to supply those missing retrieval rules.

Builder action: add typed context-item and context-selection records with
authority, task/project binding, freshness, sensitivity, and safe digest
fields; implement deterministic allowlist retrieval and fail-closed rejection
for unrelated, secret-bearing, stale, or unauthorized items; bind the selected
context digest into the route and expose only safe reason codes.

#### F-03 — Required route dimensions are incomplete (high, repairable)

The route records role and lane, but it does not select or explain worker
shape, workspace capability, or evidence path. A generic capability array and
permission list cannot substitute for those distinct dimensions because they
do not say which worker form is admitted, which workspace operation is
available, or where evidence must be emitted.

Why it matters: a route can be model-correct but still launch the wrong worker,
write outside the intended workspace, or produce evidence in an unbound path.
Small-task sizing is also not represented as a worker-shape decision.

Builder action: extend the task profile, capability catalog, route, and schema
with typed worker-shape, workspace-capability, and evidence-path selections;
validate them before admission and bind their safe identifiers/digests into
the route.

#### F-04 — Required evaluation evidence is absent (high, repairable)

The focused verifier exercises routing mechanics but does not evaluate
representative task classes or record quality, accepted-result cost, latency,
context sufficiency, and policy compliance. There is no typed evaluation
fixture/observation contract and no independent replay that recomputes the
route from the same admitted task, context selection, policy, and capability
state.

Why it matters: a deterministic selector can still choose a poor route, and
synthetic unit assertions do not demonstrate that the promised trade-offs are
measured or that context policy is effective.

Builder action: add project-agnostic evaluation fixtures and an observation
record with bounded metrics and route/context digests; provide a deterministic
replay function that compares the recorded route to a fresh selection without
granting acceptance or Product custody.

#### F-05 — Host capability attestation is declarative rather than independently
bound (high, repairable)

`compileHostCapabilityCatalog` accepts a caller-supplied model list, attachment
digest, and timestamp. It validates shape but does not verify a host identity,
attestation receipt, freshness window, or a separate readback authority. The
effective readback comparison is useful, but it happens only after a route has
already been selected.

Why it matters: a stale or fabricated catalog can make an unavailable
capability look available at selection time. The result can be internally
consistent while still being false about the host.

Builder action: make route admission require an explicit host capability
readback/attestation record bound to the same source and context; stale,
missing, or conflicting readback becomes typed unavailable/blocker state before
work. Keep actual host discovery in an adapter boundary rather than inventing a
provider in the kernel.

#### F-06 — Portable kernel contains provider-shaped defaults (high, hygiene and
boundary)

The routing module hard-codes a provider/model-shaped default identifier and
the accepted-merge architecture text names a provider-shaped default. This is
not project-agnostic governance data and conflicts with the repository rule
that provider accounts and product context remain typed input rather than
portable kernel constants.

Why it matters: it couples a portable record contract to an unavailable or
unverified host and risks misleading route explanations. It also creates a
source-hygiene regression.

Builder action: replace the default with a neutral host-supplied identifier;
keep model identifiers as validated project/host configuration; remove
provider-shaped names from task-routing documentation and fixtures.

#### F-07 — Fallback invariants are recorded more strongly than enforced
 (medium, repairable)

The route records `preserve_requirements` and `deny_downgrade`, and the
selector preserves floors for context, capabilities, tools, permissions,
reasoning, verifier, probability, budget, and deadline. It does not, however,
bind fallback ordering to a normalized policy decision or distinguish a
quality downgrade that remains above the minimum floor. A disabled profile can
also retain non-empty fallback triggers in the compiled route.

Why it matters: operators can read a stronger guarantee than the route logic
actually enforces, and disabled fallback is not represented as a fully closed
state.

Builder action: canonicalize disabled fallback to zero attempts and no
triggers; make fallback admission verify the predecessor route, trigger,
attempt budget, and policy ordering; record a safe rejection whenever the
candidate would downgrade the selected reasoning/verifier or declared route
quality.

#### F-08 — Hostile coverage and integration regression coverage are incomplete
 (high, repairable)

The candidate test covers several useful negative cases, but it does not cover
the missing context-firewall classes, route admission before worker creation,
stale/fabricated host attestation, worker/workspace/evidence selection, full
evaluation replay, or the required representative task classes from the
roadmap. Functional tests were not run because the task explicitly keeps them
pending.

Why it matters: the current evidence cannot establish production readiness or
prove that the new slice did not regress the existing session and custody
boundaries.

Builder action: add focused fixtures/verifiers for every recorded repair and
leave execution of those functional checks pending for the authorized test
pass.

### Cross-cutting audit lenses

- Production readiness: `NOT_READY`. The candidate is a useful partial
  contract, not an admitted production route. After repair it may be a
  production candidate pending functional tests; this audit cannot claim test
  success without running them.
- Quality: deterministic field validation and explainable rejection reasons
  are present; the full task-class quality measurement loop is absent (F-04).
- Hygiene/minimality: the slice is large but separated into a routing module
  and support validators. The provider-shaped default is a portability
  violation (F-06), and no additional role or hidden worker is justified.
- Security/privacy: protected external actions are denied and persisted record
  scanning exists; task-context authorization, stale-memory rejection, and
  prompt-boundary enforcement are absent (F-02, F-05).
- Durability: content-addressed policy/profile/catalog/route/readback records
  are durable in shape, but no persisted context-selection or evaluation
  observation is bound to the route (F-02, F-04).
- Regression: public exports and schemas are present in the accepted snapshot,
  but active admission is not wired and functional checks remain pending
  (F-01, F-08).
- Custody: the module does not create sessions or Product worktrees, which is
  the correct boundary; it also does not yet hand an admitted route to the
  actual session owner (F-01). No independent auditor may accept its own
  route.
- Boundary: protected external action is correctly excluded. Host discovery,
  session creation, Product writes, deployment, and activation remain adapter
  or owner boundaries. Missing host capability is not a blocker to this local
  repair; it must be represented as `UNAVAILABLE`.
- Intent: role/lane and owner overrides are represented, but no context
  relevance/authority selection or worker shape means the route cannot fully
  preserve task intent (F-02, F-03).

### True blockers and exact recovery

No true external blocker is accepted. The absence of a configured provider,
live host, or project-specific research corpus is an intended boundary, not a
reason to simulate success or stop the repair. Recovery is to keep the kernel
provider-neutral, require a typed host readback when available, and return an
honest unavailable record when it is not. Functional verification is pending
by explicit task instruction and is not converted into a pass by this report.

### Builder actions recorded for the next pass

1. Add the minimal portable context-firewall and selection records, and bind
   the selected context digest into the route.
2. Add typed worker shape, workspace capability, and evidence path selections.
3. Add a pre-work route-admission boundary with host/session readback and
   honest unavailable/blocker results.
4. Remove provider-shaped defaults and enforce closed fallback invariants.
5. Add project-agnostic evaluation/replay records and hostile fixtures.
6. Re-audit every finding, preserve this section unchanged, and report the
   remaining candidate status with functional tests still pending.

## Repair history

No repairs were applied before this initial audit was recorded.

## Repair pass 1 — isolated builder actions

Only the recorded findings above were addressed in the isolated worktree. The
accepted-merge authority worktree was not modified.

### Changes made

- Added `control/task-context-firewall.mjs` with typed context policy, item,
  and selection records. Selection is bound to task, goal, project context,
  source, authority allowlist, task class, sensitivity, freshness, memory
  authorization, and content class. It returns `UNAVAILABLE` with reason
  codes when the selected material is stale, unrelated, unauthorized, unsafe,
  or insufficient.
- Extended `control/task-model-routing.mjs` so a route now binds context
  selection, worker shape, workspace capability, evidence path, host
  attestation, freshness, and route observation time. Disabled fallback is
  canonicalized closed, and fallback reasoning/verifier downgrades produce a
  typed boundary.
- Added the separate host-attestation record. A capability catalog is now
  explicitly `DECLARED`/`UNVERIFIED_INPUT`; selection requires a matching,
  source-bound, time-bounded `HOST_ATTESTED` record.
- Added `admitExecutionRoute`, `requireAdmittedExecutionRoute`, and
  `runAdmittedTask`. Host and session execution readbacks must match the route
  before the callback can run. The portable kernel creates no session, worker,
  worktree, Product file, or child agent.
- Added `control/task-routing-evaluation.mjs` with representative task-class
  fixtures, quality/cost/latency/context/policy observations, and a
  content-addressed route replay that requires evaluator/builder separation.
- Added the context, attestation, execution-readback, route-dimension, and
  evaluation schemas. The focused routing verifier was replaced with hostile
  fixtures for context insufficiency/staleness/unsafe content, missing and
  mismatched readback, route dimensions, and independent evaluation replay.
- Added `docs/task-routing.md` documenting the portable boundary and
  provider-neutral inputs. The shared content-addressing/privacy dependency
  is present in the isolated worktree so the new records use one serializer
  boundary.

### Evidence after repair

- JavaScript syntax checks passed for the repaired routing, context,
  evaluation, support, privacy, content-addressing, and focused-verifier
  modules.
- JSON parsing and required-property checks passed for every new or changed
  feature schema.
- `git diff --check` passed.
- Static source review found no concrete provider/model account, credential,
  private machine path, private link, npm dependency, or child-agent creation
  in the repaired feature surface. Neutral `HOST_DEFAULT` is the only kernel
  default.
- The accepted-merge source identity remained commit
  `590c07ddd4be7a8c24727c24b40808e44ca7357d` / tree
  `f1b358d87e6a969fb9631e202a3d478540edd4d9`; its dirty snapshot was read-only.
- Functional tests were intentionally not executed. They remain pending for
  the authorized verification pass.

### Self-audit findings and disposition

- F-01: repaired at the portable work boundary. A route is now not enough to
  execute work; `runAdmittedTask` requires both readbacks and invokes work only
  after the match. Existing compatibility session entrypoints remain outside
  this new kernel boundary and must be adopted by a consuming adapter when a
  task is routed through this feature. That is an explicit integration
  handoff, not a hidden fallback or a test claim.
- F-02: repaired. Raw context is never persisted; only safe labels and content
  digests are bound. Project, authority, task class, memory, sensitivity,
  freshness, content class, and token sufficiency are checked before selection.
- F-03: repaired. Worker shape, workspace capability, and evidence path are
  required route dimensions and are checked against the host catalog.
- F-04: repaired in contract and implementation. Four representative task
  classes, bounded metrics, evaluator separation, and same-state replay are
  represented. Actual observations remain unproven until functional execution.
- F-05: repaired at the portable boundary. Catalog declaration and host
  attestation are separate records with source binding and expiry. A real host
  adapter remains the authority for producing the attestation.
- F-06: repaired. Provider-shaped defaults and fixture identifiers were
  replaced with neutral values; provider-specific capability data remains
  typed input.
- F-07: repaired. Disabled fallback has no triggers or attempts, and a
  reasoning/verifier downgrade is returned as `FALLBACK_QUALITY_DOWNGRADE`.
- F-08: repaired in focused coverage and static checks. Execution of the
  functional verifier remains pending by instruction.

### Cross-cutting re-audit

- Production readiness: `PRODUCTION_CANDIDATE_PENDING_TESTS`. The repaired
  slice is self-contained, deterministic, privacy-safe by construction, and
  explicit about host/session custody. No functional-pass claim is made.
- Quality/minimality: the route explains every selected dimension and every
  excluded candidate; the context and evaluation concerns are separated from
  model selection rather than folded into an opaque fallback.
- Security/privacy: secret-like transient content is rejected, unsafe context
  classes cannot become selections, unrelated project digests and unauthorized
  memory are excluded, and no protected external permission is routable.
- Durability/regression: all new records are exact-key, content-addressed,
  source-bound, and time-bounded where freshness matters. The only existing
  runtime compatibility path left untouched is explicit in the handoff; no
  new implicit fallback was introduced.
- Custody/boundary: route compilation, context selection, replay, and readback
  checking do not grant Product acceptance or create agents. Actual host
  attestation and session creation remain adapter responsibilities.
- Intent: the task's role, lane, class, dimensions, context authority, and
  evidence destination are all carried into the route and replay inputs.

### Remaining findings

No repairable finding remains within this isolated feature slice. The only
pending condition is functional verification, which is explicitly deferred by
the task instruction. Consuming runtime adapters still need to call the new
route boundary when they adopt task-shaped routing; that is a documented
integration handoff and is not an external blocker.

### Next action

Hand off the isolated worktree as a production candidate pending the focused
functional verifier and any consuming-adapter integration review. Keep
`2.1rc` inactive and preserve this report history.

## Re-audit pass 1 — final integration surface

The final self-audit found and repaired one remaining recorded coverage gap:
the focused routing verifier was not included in the repository aggregate
verifier. `tests/verify-all.mjs` now invokes
`tests/verify-task-model-routing.mjs`. The routing documentation was also
clarified so session and worktree creation are explicitly consuming-adapter
responsibilities rather than kernel behavior.

### Re-audit evidence

- `node --check` passed for all repaired modules and the aggregate verifier.
- JSON parsing passed for every new or changed feature schema.
- `git diff --check` passed.
- The portability scan found only intentional generic privacy-guard terms in
  the shared redaction implementation and boundary documentation; it found
  no concrete provider, credential, private path, private link, npm
  dependency, or child-agent creation.
- The authoritative accepted-merge worktree still reports the same HEAD,
  tree, and dirty-snapshot count recorded above; it was not modified.
- The focused and aggregate functional verifiers remain unrun by instruction.

### Re-audit disposition

F-01 through F-08 remain resolved within the isolated feature slice. No new
repairable finding was introduced by the aggregate-verifier registration or
documentation correction. The remaining handoff is unchanged: run the
focused functional verifier and review adoption by any consuming runtime
adapter. That pending verification is not a genuine external blocker and is
not represented as a pass.

### Final candidate status

`PRODUCTION_CANDIDATE_PENDING_TESTS`. Changed files are limited to the
task-routing control modules, their typed schemas, the focused verifier,
aggregate-verifier registration, the portable routing guide, and this audit
report. No source-repository activation, Product acceptance, deployment,
provider binding, or external custody action was taken. `2.1rc` remains
prepared but inactive.

### Next action

Run `tests/verify-task-model-routing.mjs` and the aggregate verifier in an
authorized functional pass, then have the consuming adapter adopt
`runAdmittedTask` before routing live work. Until then, retain this isolated
candidate and its append-only audit history.

## Central integration intake — 2026-08-09

- visible_task_ref: TASK_REF_ROADMAP_04_TASK_ROUTING_CONTEXT_VISIBLE
- isolated_worktree_ref: WORKTREE_REF_EB85
- source_head: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- source_tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- isolated_report_sha256: `e49e47d22b99fd67973faa46f5e834042546c01506e83ec0bed553eb1a638cd7`
- central_disposition: SOURCE_BOUND_CANDIDATE_INTEGRATED_PENDING_BINDING_REFRESH
- changed_path_disposition: context firewall, route admission/evaluation, routing hardening, schemas, docs, and focused verifier integrated; binding refresh deferred until combined source is settled
- functional_status: NOT_RUN_BY_INSTRUCTION
- archive_status: WITHHELD_UNTIL_DOWNSTREAM_REVIEW
