# Article 1242 — Governance 2.1rc Executable Question-Tree Authority

Status: `PREPARED_NOT_ACTIVATED`

## Purpose

Governance 2.1rc evaluates Product admission through an executable, project-agnostic case engine. The full library is available law; the runtime compiles only the smallest source-derived slice affected by the exact change. Agents do not recite the library, interpret broad compliance prose, or negotiate weighted scores.

The normative machine authority is
`schemas/question-tree.v1.json`, SHA-256
`6810c4c7e4ef28669e4aa892b961a5b790d39e5c973c5f05210b1d2bbcb6510c`.
The executable reference implementation is
`control/question-tree.mjs`.

## Acceptance

There are exactly three ordered Product-acceptance roots:

1. `FUNCTION_REQUIREMENTS`
2. `DESIGN_BIBLE`
3. `SECURITY`

`RC_READY` is true only when all three roots are `PASS`. The campaign
controller recomputes the exact compiled result from the content-addressed
question tree, observations, and evidence-cache proof before admitting the
snapshot. It also binds the Auditor attestation and acceptance receipt to the
same result, roots, question IDs, Auditor identity, timing, and freeze state.
Worktree cleanliness, task
registration, leases, routing, custody, and health monitoring remain
Orchestrator control-plane responsibilities; they are not additional
Product-acceptance roots.

Security evidence collection runs in parallel from the start. Security is the final admission root, and credible critical safety or security evidence may immediately freeze its affected surface. Unrelated work continues unless evidence proves global impact.

## Atomic case law

Every question has a stable identity, parent, root, versioned authority, applicability predicate, one exact yes-or-no proposition, required evidence kinds, allowed dispositions, deterministic branches, repair owner, invalidation conditions, blocking scope, and exception policy.

The compiler starts from exact changed paths and a content-addressed change manifest, derives material surfaces, selects only clauses triggered by those surfaces, reuses unexpired evidence, and emits one compact root-level non-applicability proof when a root has no applicable questions. Source-stable evidence may survive a new build only when every relevant hash is unchanged; build/environment-bound evidence may not. It must not emit one N/A record per irrelevant library question. Unchanged answers produce no new event.

```text
if applicability is false:
    require applicability proof
    return NOT_APPLICABLE_WITH_PROOF
elif evidence proves the proposition:
    return YES_WITH_EVIDENCE
elif evidence proves failure:
    create one targeted repair
    continue unrelated work
elif evidence is missing:
    acquire evidence autonomously
elif an exception is requested:
    route to the named granting authority
elif an exact authorized exception applies:
    enforce its scope, controls, expiry, and re-evaluation
elif resolution crosses a true owner boundary:
    pause only the affected scope and return one precise blocker
else:
    fail closed and route internally to the Global Orchestrator
```

`UNKNOWN` means acquire evidence. `NO` means repair when repair is delegated. `NOT_APPLICABLE_WITH_PROOF` requires evidence that applicability is false. `EXCEPTION_REQUESTED` never passes. Confidence scores, weighted aggregation, “mostly compliant,” and agent-believed pass claims are forbidden.

## Interaction without a serial queue

The Auditor compiles and evaluates applicable questions continuously and read-only while development advances. A `NO` or `UNKNOWN` becomes a compact repair/evidence assignment containing the question IDs, observed evidence, bounded writable scope, owner, and required evidence for pass.

Auditor-created seam workers use the distinct `AUDIT_WORKER` kind. They are fresh, pinned, on-demand, and read-only; they answer exact question IDs and cannot implement, redefine the governing clause, or grant an exception. Platform Agents remain builders.

Feature and Platform Agents solve ordinary defects inside their custody and return evidence, not narration. The Global Orchestrator owns the compiled tree, dependency ordering, repair routing, selective invalidation, and true owner blockers. Runtime executes integration, deployment, rollback, and runtime evidence actions only.

The Auditor is not a per-change approval queue. Findings accumulate against the moving cumulative root. At a coherent handoff, the responsible Feature Agent receives the deduplicated affected questions, repairs them under the same goal, and continues.

One `NO` creates one repair for one causal root. A repeated `NO` may retry only when the causal model, implementation route, evidence state, or governing assumption materially changed. Otherwise the direct supervisor performs exactly one reframe and equivalent retries stop. Different wording is not progress.

## Owner boundary

Owner interruption is limited to unapproved cost, human authentication or legal acceptance, governed stack or constitutional architecture change, repository authority/topology change, deletion of accepted/protected work or production data, unresolved material intent contradiction, or another irreversible action outside delegated authority.

Tests, implementation choices, merge conflicts, context limits, unfamiliar code, reversible decisions, missing evidence, internal dependencies, and ordinary debugging remain autonomous repair work.

## Selective invalidation

Every result binds commit, worktree, relevant hashes, build, environment, observation time, and question-tree version. A change invalidates matching leaves and their dependent descendants only. A security repair may invalidate Function or Design leaves; unrelated verified questions remain valid.

## Minimum live RC

The first activation admits exactly one real cumulative-root campaign. Multi-lane predicates remain design material until a later version implements per-lane state, lane-local blockers, custody, transitions, convergence, and hostile proof. The first activation demonstrates:

- all three roots compiled from actual project authority;
- one autonomous `NO` repair;
- one autonomous `UNKNOWN` evidence acquisition;
- one proven N/A result;
- one selective invalidation across roots;
- one affected-surface critical freeze with unrelated work continuing;
- one exact true owner blocker or an exact finding that none exists;
- final admission only after all three roots pass.

This article grants no Product, release, deployment, exception, or owner-only authority. Activation remains separately gated.
