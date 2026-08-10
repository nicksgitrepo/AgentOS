# Preserved full platform handoff: 11-recovery-and-boundaries

## Platform-foundation handoff — Recovery and Boundaries — 2026-08-07

This is the platform-foundation handoff for the shared skeleton gate. It
preserves the completed audit and does not start product feature
implementation. Platform governance repairs in this worktree are distinct
from product code. The Controller must wait for every platform handoff,
independently audit and merge one platform tree, and only then release feature
lanes.

### Source-bound identity and disposition

- Source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357`.
- Committed source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- Working-tree custody: dirty with untracked lane artifacts; this handoff does
  not claim a committed or release-ready merge tree.
- Lane disposition: `PRODUCTION_CANDIDATE_PENDING_TESTS`.
- Independent clearance: `REQUIRED_NOT_RUN`.
- Product feature implementation: `NOT_STARTED`.
- Acceptance, activation, publication, deletion, merge, push, deployment, and
  release: not authorized by this lane.

### COMPLETE

- The Recovery and Boundaries contract is implemented as a pure, portable
  router plus assembled integration. It preserves the `PROCEED`/`PUZZLE`/
  `SOFT_REVIEW`/`HARD_STOP`/`UNAVAILABLE` distinction, exact reason codes,
  bounded attempts, source-digest evidence, typed next authority, and
  changed-condition fresh-goal law.
- The verification handoff is source-snapshot-first, digest-backed, terminal,
  fail-closed, and non-accepting. It is wired into assembled evidence rather
  than treated as documentation or a hardcoded focused pass.
- Hard-stop custody preserves a typed handoff and uses host-mediated close
  when the required readbacks exist. Missing closure is explicitly unavailable.
- Public output is limited to portable summaries and permitted digests. Exact
  project, cwd, session, host, task, and raw process details remain control
  plane data.
- Local platform evidence is green: focused Recovery and Verification tests,
  assembled rapid-slice test, canonical twelve-lane runner, source hygiene,
  architecture hygiene, syntax checks, schema parsing, and hostile probes.

### Shared skeleton and directory boundaries

#### Observed facts

- The repository is a public, project-agnostic AgentOS governance kernel;
  Product source and private control-plane state are separate spaces.
- `control/` is executable governance, boundary, routing, evidence, lifecycle,
  and adapter logic. The rapid prototype is divided into twelve named lane
  modules, with the shared index assembling public functions rather than
  reimplementing lane rules.
- `schemas/` is the versioned machine-contract boundary. The Recovery and
  Verification additions are `schemas/recovery-transition.v1.json` and
  `schemas/verification-handoff.v1.json`.
- `docs/` contains public normative intent, platform foundation contracts, and
  evidence references. `docs/rapid-foundations/11-recovery-and-boundaries.md`
  remains the normative lane contract; this audit report is the append-only
  audit and handoff record.
- `tests/` contains direct Node checks and focused hostile coverage. The
  current repository declares Node `>=20`, ESM modules, and direct Node test
  entrypoints. No product `src/`, `app/`, or `server/` tree was observed in
  the inspected baseline.
- Existing `authority/`, `bootstrap/`, `governance/`, `migrations/`, and
  `examples/` remain separate platform areas. They are not feature folders and
  must not become an implicit Product implementation surface.

#### Recommendation

Keep the shared platform skeleton stable:

```text
control/                 portable executable governance and adapters
schemas/                 versioned machine contracts and parity targets
docs/rapid-foundations/  normative platform intent and public evidence
tests/                   direct, deterministic, hostile, and integration checks
authority/ bootstrap/ governance/ migrations/ examples/
                          existing platform-owned support areas
Product source           consuming-project boundary; not added by this lane
private control plane    identities, raw evidence, custody, and owner records
```

Do not add a feature framework, UI application, provider SDK, database layer,
or product directory to this public kernel as part of the platform gate. A
future feature lane may propose its own Product-side structure only after the
Controller has merged one independently audited platform tree.

### Technology-stack facts and recommendations

#### Facts

- Runtime and module format: Node.js `>=20`, native ESM, `.mjs` control/test
  modules, and built-in Node APIs such as `crypto`, `child_process`, `fs`, and
  `path` where the existing contracts require them.
- Contract format: JSON Schema-style versioned documents with exact keys,
  stable enums, lowercase SHA-256 digests, and source/tree identity fields.
- Verification style: direct `node` execution, deterministic fixtures,
  hostile cases, source-hygiene checks, architecture checks, and canonical
  lane runners. This lane did not use npm.
- Architecture style: small acyclic modules, explicit boundary adapters,
  content-addressed records, and one-direction authority from Bootstrap into
  shared governance, named lanes, the thin slice, Intent Regulator, and
  Runtime.
- No frontend framework, backend framework, persistence provider, or external
  service is a platform fact in this repository.

#### Recommendations

- Continue with Node native ESM and direct Node checks for the platform kernel;
  do not introduce a dependency or framework to solve a Product concern.
- Treat JSON Schema and runtime exact-key validation as a pair. A schema-only
  assertion or a documentation-only handoff is insufficient.
- Keep feature-specific technology choices in typed consuming-project context.
  The platform may recommend a stack after real Product discovery, but this
  lane must not select one from absent facts.
- Preserve deterministic canonicalization, digest binding, bounded timeouts,
  and no-shell process execution for platform checks.

### Routing and feature boundaries

| Condition | Platform route | Feature-lane consequence |
| --- | --- | --- |
| Unchanged intent/source and complete evidence | `PROCEED` | Continue only inside the admitted feature scope; no recovery route is selected. |
| One bounded deterministic puzzle | `BOUNDED_CLARIFICATION` or `SAFE_DEFAULT` | One exact repair/default, then a fresh focused check; no blind retry. |
| Non-protected choice changes | `TYPED_REVIEW` | Pause affected work, preserve choice/impact digest, and require review before resuming. |
| Protected boundary, changed scope/policy, stale identity, or unsafe request | `CLOSE_CURRENT_GOAL_AND_SOURCE_BOUND_SUCCESSOR` | Preserve evidence, prevent acceptance, close temporary work when possible, and require a fresh source-bound goal. |
| Missing identity, source, capability, handoff, or independent evidence | `FAIL_CLOSED` / `UNAVAILABLE` | No write, recovery, closure, or acceptance may rely on a caller assertion or guess. |

Feature lanes must not:

- edit the public plan, shared index, schemas, or another lane’s module/test
  unless the Controller records a platform repair scope;
- create generic workers, recursive children, shell stand-ins, compatibility
  roles, or unverified identities;
- import private control-plane records or raw project paths into public
  source, UI, fixtures, logs, or handoffs;
- treat `READY_FOR_INDEPENDENT_CLEARANCE`, `PRODUCTION_CANDIDATE`, or
  `REQUESTED` as acceptance, clearance, deployment, or release; or
- bypass a hard stop by changing the classification or retrying in place.

### Shared contracts and ownership

The Controller should bind the shared skeleton to these existing contracts:

- `agentos.boundary_contract.v1` — constitutional/owner/derived/temporary
  boundary precedence; stricter rules may be added but not weakened.
- `agentos.rapid_recovery_transition.v1` — Recovery route, reason, evidence,
  missing fields, attempt/default/review proof, acceptance state, and next
  authority.
- `agentos.verification_handoff.v1` — exact source binding, clean snapshot,
  check receipts, failure/timeout/unavailable behavior, protected actions, and
  non-acceptance.
- `DELIVERY_AND_CLOSURE_HANDOFF_V1` — typed task/scope/result/evidence,
  preserve-before-close, host lifecycle, zero-active readback, and
  `clearance: NOT_CLAIMED`.
- `agentos.rapid_prototype_plan.v1` and the twelve-lane foundation receipts —
  launch/phase ordering, named-lane ownership, source identity, and the gate
  that precedes any feature lane.
- `foundation_handoff.v1` / `agentos.rapid_foundation_handoff.v1` patterns —
  public portable summary, private control-plane readback, hostile coverage,
  open risks, next handoff, and independent-check status.

Recommended ownership split:

- Controller/Intent Regulator owns source-bound phase admission, cross-lane
  dependency ordering, and the decision to release feature lanes.
- Independent platform auditor owns the fresh audit of the merged platform
  tree and must be distinct from the builder/Controller evidence author.
- Runtime/host adapters own exact project/cwd/session/process/closure
  readbacks and child cleanup; the portable kernel must not guess them.
- Feature lanes own only their admitted Product behavior after platform-gate
  completion and must hand back the shared contracts unchanged unless a
  separately recorded platform repair is admitted.

