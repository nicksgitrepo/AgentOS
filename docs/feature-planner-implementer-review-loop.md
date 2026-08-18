# Feature planner → implementer → Orchestrator review loop

Status: `PREPARED_NOT_ACTIVATED`

This is the plain-language loop for one feature. It works for a new project
and for an imported project. It adds a clear feature handoff to the existing
AgentOS governance; it does not replace the typed contracts, the Project Owner
conversation, the Audit-Driven Integration Pyramid, or Collaborative Audit.

## The promise

Every feature is carefully and comprehensively planned before implementation
begins. The plan is detailed enough that another capable agent can build it
without guessing. It is also deliberately bounded: it avoids over-engineering,
premature abstraction, and scope creep; it does not add a refactor, dependency,
polish pass, or future capability unless that work is needed for this feature's
stated outcome.

The planner asks, in order:

1. What user or project problem does this feature solve?
2. What behavior counts as done, and how will it be checked?
3. What is included, what is explicitly not included, and what is still
   unknown?
4. Which existing contracts, surfaces, tests, and platform seams are affected?
5. What exact implementation steps, files, and verification evidence should an
   implementer follow?

Unknowns stay visible. An unresolved owner choice or protected boundary is not
quietly converted into an assumption.

## The roles

### Project Owner and Controller

Project Owner keeps the conversation simple and asks one material question at a
time. The owner confirms intent, outcome, and choices that need owner authority.
Controller keeps the work moving, binds the feature to the current source and
scope, and records ordinary recovery. Neither role lets a feature plan weaken a
constitutional or protected rule.

### Planner

A capability-strong planner owns the plan, not the acceptance decision. The
planner reads the current authority and source, writes a complete
`FEATURE_PLAN.md`, and makes the instructions concrete enough for an economical
implementer to use. The planner should choose the smallest sound design that
meets the outcome, reuse existing project conventions when they fit, and call
out when a new seam really is required.

The planner does not hide uncertainty behind optimistic language. The plan
records assumptions, dependencies, non-goals, risks, rollback or recovery, and
the evidence that will be needed at handoff.

### Implementer

One or more economical, capable subagents implement the accepted plan in the
assigned isolated work area. They receive detailed steps, constraints, tests,
and a bounded file/surface list. They may make the smallest local correction
needed to carry out the plan, but they do not silently expand the feature.

An implementer does not review, judge, or accept its own work. It runs the
assigned implementation tests and reports their raw results as preparation
evidence, not independent acceptance. Implementers do not merge, publish, deploy, spend, handle secrets,
or bypass Runtime, Spawner, owner, or other protected authority.

Implementers never review or accept themselves; only the independent
Orchestrator can accept this feature candidate.

### Orchestrator

The Orchestrator is independent of the implementer. It reviews the candidate
against the feature plan, current authority, acceptance checks, source
identity, tests, and declared scope.

The Orchestrator has two useful outcomes:

- `ACCEPTED`: every required check passes, evidence is sufficient, and the
  candidate may move to its governed downstream handoff.
- `REPAIR_REQUIRED`: the Orchestrator returns detailed issue-bound instructions
  for each failure. Each instruction names the issue, exact affected location,
  evidence, expected result, and re-test. The implementer repairs only the
  returned scope, then the Orchestrator reviews the new evidence.

This loop repeats until the candidate is accepted or a protected blocker is
recorded. “Looks good,” a passing implementation test, or an empty issue list without
evidence is not acceptance.

## Model suggestions and canonical policy

A plan may suggest a model or reasoning level that seems appropriate. A name
such as `Luna xhigh` is only a suggestion in the plan or a handoff. It is not a
required product fact, a guarantee that the host provides that model, or an
authority to spend.

The current canonical model policy, host capability readback, and task-class
route choose the actual model. If a suggested model is unavailable or not
approved, the Scheduler/Controller follows the current policy and records the
selected route. No worker may hard-code a model name to evade that policy. A
stronger fallback is used only when the current policy proves it is available
and allows the route.

## The feature cycle

```text
owner intent and source readback
        ↓
capability-strong planner writes a bounded FEATURE_PLAN.md
        ↓
plan completeness and authority check
        ↓
economical capable implementer builds in an isolated work area
        ↓
evidence, tests, and typed handoff
        ↓
independent Orchestrator review
        ├─ ACCEPTED → governed downstream handoff
        ├─ REPAIR_REQUIRED → issue-bound repair → fresh review
        └─ PROTECTED_BLOCKED → retain hold and route the authority question
```

The plan is a gate for implementation, not a license to change the project.
If the source, owner intent, acceptance contract, or relevant policy changes,
the Controller re-binds the plan or asks the planner for a new plan revision.

## Fit with the two development workflows

The loop is used inside whichever workflow the Project Owner selected during
Bootstrap.

### Audit-Driven Integration Pyramid

The platform foundation is established and reviewed first. A feature then
uses its isolated lane and follows the smallest appropriate cycle:

```text
plan → implement → smallest repair → independent hostile audit → affected proof → handoff
```

The feature handoff is consumed by the applicable Platform domain. It does not
become central readiness merely because its local checks pass. Platform review,
cumulative repair, central integration, and central audit still happen in their
governed order.

### Collaborative Audit

One builder receives one isolated work area and one complete plan. Six distinct
checkers inspect that candidate in parallel. They are read-only and do not
repair or accept the builder's work. The Orchestrator combines their reports
and gives the implementer one ordered, issue-bound repair list. Fresh groups of
six re-audit repairs. A difficult item may move to a stronger clone only under
the existing three-attempt and current-model-policy rules.

The builder never turns an audit report into self-acceptance. Runtime integrates
only an accepted wave, and delivery still requires the owner's governed choice.

## Protected blockers remain governed

A protected blocker closes only the dependent action. It does not become a
reason to guess, silently widen scope, or mark the feature accepted. Record the
boundary, affected action, observed evidence, required authority or readback,
and the next safe action. Continue unrelated safe work when the workflow allows
it; hold only what depends on the blocker.

Examples include missing owner intent, stale source identity, unavailable or
unapproved model capacity, authentication or secrets, spending, publication,
merge, deployment, destructive overwrite, custody or worktree uncertainty, and
conflicting acceptance authority. Only the role that owns the boundary may
clear it. Runtime, Spawner, Controller, and the Orchestrator keep their normal
authority; a feature plan cannot bypass them.

## Reusable records

- Copy [`templates/feature-planning/FEATURE_PLAN.md`](../templates/feature-planning/FEATURE_PLAN.md)
  once for each feature.
- Copy [`templates/feature-planning/ORCHESTRATOR_REVIEW.md`](../templates/feature-planning/ORCHESTRATOR_REVIEW.md)
  for each independent review and re-review.

Keep the records project-agnostic at the template level. A project instance
fills in its own relative paths, contracts, evidence references, and owner
choices without placing credentials, private machine paths, chat links, or
provider secrets in the public AgentOS repository.
