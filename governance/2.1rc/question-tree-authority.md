# 2.1rc Executable Question-Tree Authority

Status: `PREPARED_NOT_ACTIVATED`

The machine authority is [schemas/question-tree.v1.json](../../schemas/question-tree.v1.json), implemented by [control/question-tree.mjs](../../control/question-tree.mjs). Product admission has exactly three ordered roots:

1. `FUNCTION_REQUIREMENTS`
2. `DESIGN_BIBLE`
3. `SECURITY`

Final admission is `FUNCTION_REQUIREMENTS_PASS -> DESIGN_BIBLE_PASS -> SECURITY_PASS -> RC_READY`. Worktree health, roster, leases, custody, liveness, deployment, and release closure are control-plane state, not Product roots.

## Slice and evidence

The full question corpus is available law. Each change compiles only the smallest source-derived slice selected by exact changed paths and surfaces. A root with no selected questions carries one compact non-applicability proof. Unchanged answers are reused only when the question-tree version, relevant hashes, build identity, and environment identity still match.

Each selected question binds its authority, applicability, exact observable proposition, required evidence, repair owner, invalidation conditions, blocking scope, and exception policy. Evidence binds commit, worktree, build, environment, observation time, and tree version.

## Answers and lifecycle

The answer values are `YES`, `NO`, `UNKNOWN`, `NOT_APPLICABLE`, and `EXCEPTION_REQUESTED`. The lifecycle values are `UNEVALUATED`, `EVIDENCE_PENDING`, `OPEN_REPAIR`, `VERIFIED`, and `INVALIDATED`. These are separate fields.

```text
YES                  -> VERIFIED -> evaluate dependent questions
NO                   -> OPEN_REPAIR -> one bounded repair
UNKNOWN              -> EVIDENCE_PENDING -> acquire evidence autonomously
NOT_APPLICABLE       -> VERIFIED -> preserve applicability proof
EXCEPTION_REQUESTED  -> OPEN_REPAIR -> named authority only
prior answer        + INVALIDATED -> selective re-evaluation
```

An authorized exception retains the answer `EXCEPTION_REQUESTED` but may reach lifecycle `VERIFIED` only when its exact granting authority, scope, controls, expiry, and re-evaluation trigger are proven. A true owner boundary is a separate blocker object and pauses only its dependent outcome.

## Audit relationship

The Independent Auditor and read-only workers may collect evidence and evaluate applicable questions while development continues. A finding is bound to exact question IDs and causal roots. A repair invalidates only affected questions and dependent descendants. It does not restart the complete tree or create a serial review queue.

Critical safety or security evidence freezes only affected surfaces unless exact global-impact proof exists. Unaffected work continues. Code quality and hygiene remain a cascade audit discipline and cannot become a fourth acceptance root.

The question engine cannot grant Product custody, deploy, accept its own exception, infer owner intent, or convert missing evidence into `PASS`.
