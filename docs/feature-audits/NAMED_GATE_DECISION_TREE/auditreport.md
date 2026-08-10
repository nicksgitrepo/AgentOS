# NAMED_GATE_DECISION_TREE audit report

Status: `INITIAL_AUDIT_RECORDED`

Feature: `NAMED_GATE_DECISION_TREE` — Named Gate Catalog and Decision-Tree Governance

The accepted merge worktree and `docs/feature-inventory.v1.json` were read as
authority. This report is append-only. The isolated builder worktree is the
only writable scope for this task.

## Audit scope and source intent

The inventory names four direct implementation sources:

- `schemas/gate-catalog.v1.json`
- `governance/gate-catalog.v1.json`
- `control/gate-catalog-compiler.mjs`
- `control/task-gate-questions.mjs`

The intent was checked against `docs/roadmap.md`, `docs/architecture.md`, the
twelve `docs/rapid-foundations/` contracts, the prepared/inactive release
posture, and the related accepted control and verifier changes. The roadmap
requires deterministic, project-agnostic governance; explicit evidence and
identity; fail-closed handling of unknowns and protected boundaries; bounded
repair; independent acceptance; and no inferred activation. The foundation
contracts add one-question routing, exact source binding, privacy-safe typed
handoffs, hostile coverage, and explicit unavailable behavior.

No feature-specific research record was discoverable in the accepted source
catalog beyond the linked-by-owner placeholder. Research intent is therefore
evidenced by the roadmap, foundation contracts, schema contract, architecture
notes, and implementation tests; the absence of a linked research record is
an evidence unknown, not a reason to invent product context.

## Intended behavior

The named catalog is a portable declarative authority source, prepared but
inactive. It must provide human-readable named gates grouped into categories
and graphs, four explicit answers (`YES`, `NO`, `UNKNOWN`,
`NOT_APPLICABLE`), explicit failure classifications and routes, terminal
behavior, applicability justification, independently identity-bound evidence,
content-addressed compilation, deterministic evaluation, and bounded repair
that hard-stops when its positive visit limit is exceeded. Only `YES` may reach
`COMPLETE`; unknown and unjustified not-applicable answers must not pass.

The task-gate catalog is the internal context projection: exact questions are
selected for task start, code change, documentation, handoff, response, and
closure, with a digest and source/worktree/session/goal/build/environment
identity. A safe answer must carry all required evidence; an unsafe answer
must carry a typed route and exact re-check rather than narrative permission.

## Actual implementation observed in the accepted merge

- The source schema defines the answer, failure, evidence, graph, terminal,
  and validation contracts and keeps status `PREPARED_NOT_ACTIVATED`.
- The declarative catalog contains 13 categories, 20 graphs, 90 named gates,
  and 79 terminals. Its current graph data is acyclic and has no repair edges.
- `control/gate-catalog-compiler.mjs` validates exact keys, graph topology,
  question text, transitions, non-pass policies, applicability evidence,
  opaque identity references, deterministic digests, and evaluates graph
  traces.
- `control/task-gate-questions.mjs` defines 15 canonical questions across six
  contexts, derives a catalog digest, validates typed answer sets, and emits
  the prompt binding used by native-session requests.
- The accepted merge extends the older executable four-root governance tree
  with the task-gate digest, question catalog, context map, and optional task
  and artifact evaluations. Focused verifiers cover positive paths and several
  hostile inputs, but functional tests remain pending by instruction.
- The catalog compiler is deliberately standalone and inactive; activation,
  release, external providers, and protected actions remain outside this task.

## Initial findings

### F-NG-BASE-001 — isolated worktree lacks the audited feature slice

Classification: `REPAIRABLE_ENGINEERING_PUZZLE`

The authoritative accepted merge contains the feature sources and their direct
integration, while this isolated worktree begins without the named catalog,
task-question catalog, feature inventory, and focused catalog verifier. The
builder must materialize only this feature slice and its direct governance
integration here so the repair and re-audit are performed against the exact
audited source, not against an unrelated project state.

Why it matters: an audit result without the audited implementation in the
handoff worktree cannot be reproduced, reviewed, or safely tested.

Evidence: inventory entry and accepted source paths listed above; the isolated
baseline path check found the four named feature sources absent.

Builder action: add the accepted feature slice, then apply only the repairs
recorded below and preserve the source files as the audit baseline.

### F-NG-SEC-002 — unsafe task-gate re-check can bypass classification and identity

Classification: `OWNER_OR_HARD_BLOCKER` with a repairable implementation path

In both task-gate evaluators, an answer with any non-safe answer and a non-null
`recheck` returns `PASS` without requiring the failure classification to be
`REPAIRABLE_ENGINEERING_PUZZLE`. A hard blocker or soft-boundary finding can
therefore be promoted by attaching a nominal YES re-check. The re-check
evidence is structurally validated but is not compared with the original
answer evidence or the expected/tree source identity.

Why it matters: this violates fail-closed routing, independent acceptance,
source custody, and the rule that an agent statement or re-check cannot grant
authority it does not possess.

Evidence: `validateAnswer` and `inspectTaskGateAnswer` return `PASS` whenever
`answer.recheck !== null`; the surrounding binding checks inspect only
`answer.evidence`. The existing focused tests do not cover a hard/soft answer
with a forged or differently bound re-check.

Builder action: permit a re-check to pass only for a repairable engineering
puzzle; otherwise retain the blocked/review result. Validate re-check evidence
against the original answer identity, the context identity, and the decision
tree source. Add hostile fixtures for hard-blocker, soft-review, and mismatched
re-check identities.

### F-NG-DUR-003 — graph termination is not enforced for future repair cycles

Classification: `REPAIRABLE_ENGINEERING_PUZZLE`

The catalog validator checks reachability and prevents non-YES transitions from
reaching `COMPLETE`, but it does not reject a non-terminating cycle unless a
repair edge happens to be declared. The evaluator’s fixed step cap is also
smaller than a safe bound for a valid multi-step cycle with a positive repair
limit, so a declared cycle can throw an evaluator error instead of returning
its declared hard-stop terminal.

Why it matters: roadmap and schema intent require deterministic termination,
bounded recovery, preserved evidence, and exact hard-stop behavior. A future
catalog edit could introduce a livelock or convert a governed failure into an
untyped exception.

Evidence: `validateGraphTopology` does not perform cycle/repair-edge coverage;
`evaluateGateDecisionTree` derives `maxSteps` as gate count plus repair visits,
which does not account for the gate path between repeated repair edges.

Builder action: reject cycles that have no declared bounded repair edge and use
a conservative bound derived from graph size and all declared visit limits;
return the graph’s hard-stop terminal when a repair limit is exceeded.

### F-NG-DOC-004 — operator/maintainer documentation does not name the catalog contract

Classification: `REPAIRABLE_ENGINEERING_PUZZLE`

Architecture notes mention the task-question projection, but the accepted
documentation does not explain the named catalog source, compilation boundary,
four answer semantics, evidence identity rule, or inactive status in a
maintainer-facing contract.

Why it matters: auditors and maintainers cannot reproduce the authority path
or distinguish a prepared catalog from an activated release. This increases
regression and custody risk even when the code is correct.

Evidence: no dedicated catalog section was found in the accepted architecture,
operator, maintainer, or schema README material.

Builder action: add a concise project-agnostic maintainer/architecture section
that names the source, compiler, evaluator, evidence boundary, hostile cases,
and `PREPARED_NOT_ACTIVATED` rule without adding product or machine context.

## Cross-cutting audit lenses

| Lens | Initial result | Finding or evidence |
| --- | --- | --- |
| Quality | Partial | Strong exact-key validation and focused fixtures; unsafe re-check semantics remain open. |
| Hygiene/minimality | Partial | Standalone compiler is appropriately narrow; missing materialization and docs reduce reproducibility. |
| Security/privacy | Not ready | Opaque refs and no raw-path evidence are good; re-check identity/classification bypass is critical. |
| Durability | Not ready | Digests and bounded intent exist; future unbounded cycles are not rejected. |
| Regression | Pending | Focused tests exist in authority but were not run; new hostile cases are required. |
| Custody | Partial | Independent issuer kind is required, but issuer authenticity remains host/auditor custody. |
| Boundary | Pass with repair pending | Catalog is project-agnostic and inactive; protected actions are not enabled by this slice. |
| Intent | Pass with repair pending | Roadmap/foundation intent is preserved; documentation needs to make the path explicit. |

## Production readiness and blockers

Current readiness: `NOT_READY_FOR_PRODUCTION_CANDIDATE` until the four findings
are repaired and self-audited. Functional tests remain pending by instruction.
No genuine external blocker is accepted at this stage. The external host/auditor
issuer custody boundary is an explicit evidence dependency, not a blocker to
building the portable inactive candidate.

## First builder pass

1. Materialize the accepted named-gate and task-gate sources in this worktree.
2. Repair F-NG-SEC-002 with fail-closed classification and identity checks.
3. Repair F-NG-DUR-003 with cycle validation and a safe bounded evaluator.
4. Repair F-NG-DOC-004 with project-agnostic documentation.
5. Add focused hostile fixtures without running functional tests.
6. Append a self-audit and re-audit after the changes, preserving this initial
   record and naming any residual risk or pending verification.

## Initial evidence and unknowns

- Evidence read: inventory entry, roadmap, architecture, schema, catalog,
  compiler, task-question source, accepted integration diffs, and focused test
  sources.
- Functional test execution: `PENDING_BY_INSTRUCTION`.
- Research-record linkage: `UNKNOWN` because no feature-specific linked record
  was present in the accepted source tree.
- Activation decision: `NOT_PERFORMED`; `2.1rc` and the named catalog remain
  prepared/inactive.

## Self-audit pass 1 — after first repair

Self-audit result: `REPAIR_PASS_WITH_TWO_RESIDUAL_FINDINGS`.

Static evidence completed: JavaScript syntax checks for the changed modules and
focused verifier sources, JSON parsing for the source schema and catalog,
whitespace validation, and a source scan for credentials, private machine
paths, provider tokens, and chat links. Functional tests were not run.

### F-NG-SEC-005 — compiled catalog digest was not recomputed on readback

The compiled-tree validator checked that `catalog_digest` looked like a
SHA-256 but did not compare it with the digest of the compiled source-shaped
content. A modified compiled tree could therefore carry a different valid
digest while still passing structural validation.

Builder action: recompute and compare the catalog binding during compiled-tree
validation, and add a tampered-digest hostile fixture.

### F-NG-SEC-006 — cross-graph answer records were silently ignored

The named evaluator rejected unknown gate IDs but accepted a gate ID belonging
to another known graph. That record was ignored after validation, weakening
exact graph custody and allowing callers to believe the supplied answer set was
fully evaluated.

Builder action: require every supplied answer key to belong to the selected
graph and add a cross-graph hostile fixture. Also validate an optional expected
identity as exact opaque identity when supplied.

## Self-audit pass 1 builder actions

Repair only F-NG-SEC-005 and F-NG-SEC-006, extend the focused hostile fixtures,
rerun static checks, and append the re-audit result. No activation, external
effect, test-suite run, or unrelated file change is authorized.

## Re-audit pass 2 — deterministic binding review

The pass-1 repairs were reviewed against the compiler’s normalization boundary.
The catalog source contains human-readable arrays whose source order is not the
compiler’s normalized order. The compiler therefore had to bind
`catalog_digest` to the normalized source-shaped content used by the compiled
tree, not to the raw pre-normalization array order.

### F-NG-SEC-007 — normalized catalog digest boundary was inconsistent

Classification: `REPAIRABLE_ENGINEERING_PUZZLE`

`compileGateCatalog` normalized categories, graphs, terminals, and gates but
calculated `catalog_digest` before that normalization. `validateCompiledGateTree`
then compared the digest against normalized content. A valid catalog could
therefore fail its own compiled readback, while a consumer could not rely on a
single deterministic digest boundary.

Builder action: calculate `catalog_digest` from the exact normalized
source-shaped content carried by the compiled tree, then retain the compiled
digest and tampered-binding hostile fixture. No source status or activation
boundary changes.

## Final self-audit and re-audit — production candidate

Result: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`

The recorded findings were repaired in the isolated worktree and reviewed
again against the authoritative source intent. No activation, merge, deploy,
push, provider operation, or external side effect was performed. The catalog,
compiled tree, and 2.1rc posture remain `PREPARED_NOT_ACTIVATED`.

### Finding disposition

- `F-NG-BASE-001`: resolved by materializing only the inventory’s four direct
  sources, their focused verifiers, the accepted direct four-root integration,
  and the needed project-agnostic documentation.
- `F-NG-SEC-002`: resolved in both task-gate validators. A re-check passes only
  for `REPAIRABLE_ENGINEERING_PUZZLE`; hard and soft classifications remain
  blocked/review-routed, and original plus re-check evidence must share the
  exact identity binding. Hostile fixtures cover hard, soft, and forged
  re-checks.
- `F-NG-DUR-003`: resolved by rejecting unbounded graph cycles, requiring
  declared positive repair limits, deriving a conservative bounded execution
  budget, and returning the declared hard-stop terminal on limit exceedance.
- `F-NG-DOC-004`: resolved in the architecture and maintainer/control
  documentation with source, compiler, answer, evidence, inactive-release,
  and hostile-boundary rules.
- `F-NG-SEC-005`: resolved by recomputing the compiled catalog binding from
  its source-shaped content and testing a tampered valid-looking digest.
- `F-NG-SEC-006`: resolved by rejecting answer keys outside the selected graph
  and validating optional expected identities as exact opaque references.
- `F-NG-SEC-007`: resolved by calculating `catalog_digest` from the normalized
  source-shaped content actually carried by the compiled tree.

### Re-audit evidence

- `node --check` passed for the compiler, task-question projection, integrated
  governance tree, and both focused verifier sources.
- `jq empty` passed for the gate schema and declarative catalog.
- `git diff --check` passed.
- The changed/new feature slice was scanned for absolute machine paths,
  credential/token shapes, private URLs, chat links, and secret-bearing
  strings; none were found in the slice.
- Catalog inventory remains 13 categories, 20 graphs, 90 gates, and 79
  terminals, with inactive status preserved.
- Functional tests were not run: `PENDING_BY_INSTRUCTION`.

### Final cross-cutting lenses

| Lens | Final result | Evidence or remaining boundary |
| --- | --- | --- |
| Quality | Pass pending execution | Exact schemas, deterministic normalization, typed routes, and hostile fixtures are present. |
| Hygiene/minimality | Pass | Changes are limited to the feature slice, direct governance integration, docs, report, and focused verifiers. |
| Security | Pass pending execution | Re-check classification, identity, graph scope, digest, issuer, and cycle controls fail closed. |
| Privacy | Pass | No secrets, credentials, provider tokens, chat links, or private machine paths were added. |
| Durability | Pass pending execution | Content digests and bounded graph execution are source-bound; tests remain pending. |
| Regression | Pending | Existing and new functional verifiers must run before release acceptance. |
| Custody | Pass for inactive candidate | Opaque evidence identity and source-bound task projections are enforced; external issuer custody remains typed host/auditor input. |
| Boundary | Pass | No activation, protected action, provider, Product root, or deployment custody is introduced. |
| Intent | Pass | Portable, project-agnostic governance and explicit inactive status are preserved. |

### Remaining findings, unknowns, and true-blocker recovery

- Functional verification remains pending by instruction. This is the only
  current production-readiness gap created by the requested test hold, not a
  code finding.
- Feature-specific research linkage remains `UNKNOWN`; no linked research
  record was present in the authoritative source. Recovery is to attach the
  owner-approved research record before any policy interpretation or
  activation decision, without changing the portable kernel.
- Activation is `NOT_PERFORMED`. Recovery requires an explicit owner decision
  over the exact candidate and digests, followed by a fresh binding/readback
  audit. No conversational statement can activate it.
- External issuer custody is a known boundary, not a blocker for this
  inactive portable candidate. If activation requires live evidence, recovery
  is an independently issued typed host/auditor readback for the exact source,
  worktree, session, goal, build, and environment identity; otherwise the
  dependent outcome remains held.

No genuine external blocker was accepted. Ordinary implementation gaps were
reframed and repaired; no recovery path requires private data, a provider
credential, or a hidden agent.

### Changed files and handoff

- `control/gate-catalog-compiler.mjs`
- `control/task-gate-questions.mjs`
- `control/governance-decision-tree.mjs`
- `schemas/gate-catalog.v1.json`
- `governance/gate-catalog.v1.json`
- `tests/verify-gate-catalog.mjs`
- `tests/verify-task-gate-questions.mjs`
- `docs/architecture.md`
- `docs/maintainer-guide.md`
- `control/README.md`
- `docs/feature-audits/NAMED_GATE_DECISION_TREE/auditreport.md`

Next action: with test execution authorized, run the two focused feature
verifiers and the existing four-root governance verifier, then run the
repository’s required full verifier set. Until those checks and an explicit
activation decision exist, retain this candidate as prepared and inactive.
