# 2.1rc Feature and Platform Workflow

Status: `PREPARED_NOT_ACTIVATED`

The machine registry is [schemas/capability-and-worktree-registry.v1.json](../../schemas/capability-and-worktree-registry.v1.json). The executable custody and campaign lifecycle are [control/campaign-lifecycle.mjs](../../control/campaign-lifecycle.mjs) and [control/campaign-controller.mjs](../../control/campaign-controller.mjs).

## Roles

`CAMPAIGN_ORCHESTRATOR` admits the campaign, owns shared-resource and final closure decisions, and reconciles the living state. It does not manage routine feature implementation.

`FEATURE_AGENT` owns one bounded feature outcome, one active macro-stage goal, its cumulative campaign root, local contracts, implementation, applicable Platform leases, and compact handoffs. A Feature Agent cannot edit another active Feature Agent's worktree or self-accept Product.

`PLATFORM_AGENT` is a campaign-local logical capability. It is created on first material need, has one stable worktree and execution identity, and can be leased sequentially to different Feature Agents in the same campaign. It reports directly to the Feature Agent holding its lease. It never owns feature intent, campaign acceptance, deployment, or owner-only policy.

`INDEPENDENT_AUDITOR` is read-only and independently evaluates the exact candidate or deployed identity. It routes findings but never implements or grants acceptance.

`CAMPAIGN_FINALIZER` is a fresh stronger correction owner after terminal first-pass settlement. It receives exclusive writer custody only after the Feature Agent releases Product custody. It cannot own intent, acceptance, deployment, exceptions, or self-acceptance.

`RUNTIME` is persistent across campaigns. It integrates accepted commits, builds or rebinds exact artifacts, deploys, rolls back, and runs bounded live mechanical checks. It does not choose Product semantics.

## Stage goals

Every Feature Agent has one active macro-stage goal: `BLUEPRINT`, `BUILD`, `LAUNCH`, `LIVE AUDIT`, or `IMPROVE`. The goal carries WHO, WHAT, WHERE, WHEN, WHY, HOW, evidence, failure behavior, shared agreements, protected boundaries, `DONE WHEN`, and `START NOW`. Same-stage fixes, tests, findings, and handoffs remain inside that goal.

Before each substantial batch, the Feature Agent explains the user outcome, boundaries, assumptions, load-bearing priority, simplest route, material claims, protected unchanged surfaces, proof, and stop condition. This is an implementation self-check, not a phase or approval gate.

## Platform leasing

```text
Feature A needs Database capability
        |
        v
spawn logical Database Platform Agent and stable worktree
        |
        v
lease to Feature A -> work -> exact handoff -> AVAILABLE
        |
        v
Feature B needs Database capability
        |
        v
lease same logical capability/worktree to Feature B
```

The lifecycle controller records every request, lease, start, handoff, release, and archive. A lease contains the exact campaign, Feature Agent, goal, worktree, source checkpoint, seam, context delta, and custody. A second simultaneous supervisor is rejected. Completed campaign identities are archived and never reused as a successor execution identity.

Platform Agents may advise or write only inside the exact bounded capsule. Ordinary technical issues stay local. A shared contract or migration seam is routed to the Campaign Orchestrator for primary custody selection; the Platform Agent does not silently broaden its lease.

## Blueprint and build

Blueprint runs one parallel useful-idea round across the active roster and one contextual capability pass derived from those answers. It compiles feature and platform agreements once; unchanged agreements are reused. Optional proposals are routed to the decision register without pausing work. No whole-tree questionnaire, ceremonial review wave, or individual lifecycle narration is created.

Build is the simple sequence:

```text
edit -> affected stable checks -> production build/artifact
     -> commit and push -> READY_FOR_CENTRAL_REVIEW
```

Browser, visual, authenticated, responsive, and end-to-end claims remain unproven until the exact integrated candidate is deployed to the admitted live site and independently audited. Builders may use source checks, compilation, tests, deterministic integrations, build output, and artifact inspection.

## Readiness and handoff

Before central launch submission, every material Platform Agent receives the exact integrated candidate. The Feature Agent consolidates one correction batch, fixes it under the same `BUILD` goal, and submits one readiness packet. An unaffected role returns `NO_MATERIAL_SEAM` immediately.

The Campaign Orchestrator returns only `ACCEPT_FOR_CENTRAL_LAUNCH`, `RETURN_CONSOLIDATED_CORRECTION_BATCH`, or `OWNER_ONLY`. On acceptance, only persistent Runtime receives merge/deployment custody. The Auditor then performs the independent live audit.

When the Auditor clears a release for deployment, the next campaign receives only an orientation-bound Orchestrator. No successor Auditor, Feature Agent, Platform Agent, writer lease, or campaign start exists until exact accepted-live closure and explicit next-campaign admission.
