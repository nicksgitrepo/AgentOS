# DYNAMIC_PROJECT_LANES audit report

## Audit status

- Feature: `DYNAMIC_PROJECT_LANES` — Dynamic Project Lanes and Capability Roster.
- Audit state: `INITIAL_AUDIT_RECORDED`; repair is authorized only for the findings below.
- Release state: `PREPARED_NOT_ACTIVATED`; the prepared `2.1rc` line remains inactive.
- Test state: functional tests are pending by task instruction. No functional test result is claimed here.
- Scope: the current accepted-merge snapshot was read as authoritative; all repairs are confined to this isolated worktree.
- Privacy: this report contains only repository-relative paths, typed identifiers, digests as test fixtures, and portable summaries. It contains no secrets, credentials, provider tokens, private machine paths, or chat links.

## Authority and intent audit

The feature inventory identifies this feature as a named capability with the
authoritative source set:

- `schemas/dynamic-lane-manifest.v1.json`
- `schemas/dynamic-lane-role-packet.v1.json`
- `control/dynamic-project-lanes.mjs`

The accepted-merge snapshot also supplies the supporting discovery and
dependency-graph contracts and a focused verifier. The roadmap intent is
consistent with dynamic, task-shaped routing: capability checks happen before
work, unavailable capabilities produce an honest route, and selection is
reproducible from admitted project state rather than a permanent worker lane.
The Bootstrap plan and capability/worktree registry require exact project and
source binding, named bounded roles, exclusive custody, dependency-aware
ordering, preserved handoffs, and no generic, recursive, or shell substitutes.
The registry explicitly keeps `MULTI_LANE_CASCADE` design-only and inactive for
the prepared `2.1rc` line; therefore this feature may compile a prepared lane
manifest but must not activate a second writer root or grant release authority.

No public research record specific to `DYNAMIC_PROJECT_LANES` is present in the
accepted source catalog; the inventory’s `research-records-linked-by-owner`
entry is a source category rather than an available artifact. This is recorded
as an evidence unknown, not an external blocker, because the portable roadmap,
governance registry, schemas, implementation, and hostile-test intent provide
enough authority for a bounded repair.

## Intended behavior

1. Accept a typed, source-bound roster of feature and capability records.
2. Admit only records explicitly marked `ADMITTED`; do not inherit stale or
   generic worker identities.
3. Derive deterministic lane IDs and display names from lane kind, capability
   identity, and normalized version.
4. Preserve exact project, campaign, goal, source commit/tree, Bootstrap-plan,
   and project-governance bindings through the manifest, dependency graph, and
   generated role packet.
5. Validate project-relative read/write/protected scopes, reject private or
   secret-like public names and paths, and fail closed on overlapping write
   custody unless an owning authority supplies a safe future resolution.
6. Compile a deterministic dependency graph with explicit waves, edges, and
   cycle rejection.
7. Select an already-generated, lane-bound governance role; do not create a
   second governance authority or a generic worker.
8. Keep all outputs prepared and inactive until an explicit activation decision
   exists elsewhere in the governed lifecycle.

## Actual implementation observed in the authoritative snapshot

The accepted implementation contains a substantial standalone module in
`control/dynamic-project-lanes.mjs` with deterministic normalization, manifest
and graph digests, scope checks, dependency ordering, role-packet selection,
generic-worker rejection, and stale-binding checks. It also contains four
focused schema documents and `tests/verify-dynamic-project-lanes.mjs` covering
discovery, identity, ordering, scope, duplicate admission, unsafe names, stale
source, cycles, and generic-role rejection.

The isolated worktree predates that feature slice. It has no dynamic-lane
module, dynamic-lane schemas, focused verifier, feature-specific public
catalogue entry, or feature audit directory. The baseline therefore cannot
compile or validate a dynamic project lane.

## Findings recorded before repair

### DPL-001 — feature slice absent from the isolated worktree

- Severity: critical for this feature; repairable implementation gap.
- Evidence: the isolated worktree has no `control/dynamic-project-lanes.mjs`,
  no `schemas/dynamic-lane-*.v1.json`, and no
  `tests/verify-dynamic-project-lanes.mjs`; those files are present in the
  authoritative accepted snapshot.
- Why it matters: no lane discovery, roster compilation, dependency ordering,
  scope custody, or role-packet selection is executable in the writable scope.
- Builder action: add the bounded feature source, its typed contracts, and the
  focused hostile verifier without importing unrelated accepted-merge work.

### DPL-002 — execution-time source freshness is optional

- Severity: high security/custody and durability finding.
- Evidence: the accepted selector defaults `current_source_commit` and
  `current_source_tree` to the manifest values; validation also permits a
  manifest or graph to be checked without a current source readback.
- Why it matters: a stale manifest can be selected for work when the caller
  omits the fresh host/Git source observation. That weakens the exact-source
  and pre-write custody boundary even though an explicit stale mismatch is
  rejected.
- Builder action: keep read-only record inspection possible, but make the
  execution-facing role-packet selectors require explicit current source
  commit/tree readback and add hostile coverage for omitted readback.

### DPL-003 — discovery schemas do not describe the nested runtime contract

- Severity: medium quality, interoperability, and auditability finding.
- Evidence: the accepted discovery schema declares `admitted_capabilities`
  only as an array; manifest lanes, graph nodes/edges, role governance, scope,
  and dependency records are mostly unconstrained objects/arrays. The runtime
  performs stricter checks, but a schema consumer cannot independently reject
  malformed nested records.
- Why it matters: schema-only readers, migration tools, and independent
  auditors can accept records that the executable boundary rejects, creating
  contract drift and weak evidence.
- Builder action: add strict nested properties, item schemas, patterns,
  `additionalProperties: false`, and digest/binding constraints while keeping
  the schemas project-agnostic.

### DPL-004 — the full discovery input contract is not runtime-validated

- Severity: medium contract-parity finding.
- Evidence: `dynamic-lane-discovery.v1.json` describes project, campaign, goal,
  source, and governance bindings, but `discoverDynamicLanes()` accepts only
  an array and `compileDynamicLaneManifest()` receives the fields separately.
- Why it matters: the declared discovery envelope can drift from the data
  actually admitted to compilation, and a caller can skip validation of the
  complete typed input.
- Builder action: add a reusable discovery-input validator and route manifest
  compilation through it before lane derivation.

### DPL-005 — role-catalog integrity is delegated but not made explicit at the boundary

- Severity: medium evidence/custody finding; not a reason to duplicate the
  four-library governance authority.
- Evidence: the accepted dynamic module checks that a role catalogue has a
  digest, source binding, and a lane-specific role record, but it treats the
  catalogue digest as opaque and does not call the four-library validator.
- Why it matters: callers must know that a validated generated role library is
  a precondition; otherwise a minimally shaped forged catalogue can produce a
  packet that looks bound but is not independently content-validated.
- Builder action: preserve the four-library module as the authority, make the
  dynamic API require an explicit validated-catalogue contract marker/shape,
  and add a hostile test for an unvalidated or digest-inconsistent catalogue.
  Do not copy governance generation into the lane module.

## Non-findings and deliberate boundaries

- Rejection of overlapping write scopes is intentional fail-closed behavior for
  the inactive `2.1rc` multi-lane design. The error routes shared custody to
  the Campaign Orchestrator; this feature must not silently mint a shared
  writer lane.
- The constant `PREPARED_NOT_ACTIVATED` is correct and must remain unchanged.
- Public names and scope paths are project-agnostic and screened for obvious
  private/secret content; no product identity or provider account is required.
- The lane module does not perform external actions, authentication, push,
  merge, deployment, release activation, or destructive cleanup.
- Functional-test execution is intentionally pending; adding focused tests is
  allowed, but this report does not convert their presence into proof.

## Production-readiness assessment at initial audit

`NOT_READY`: the isolated worktree has no implementation, and the accepted
slice has the four findings above. After repair it may become a production
candidate pending the instructed functional tests and independent acceptance;
it is not a release activation or live-production claim.

## Quality and governance lenses

- Quality: deterministic normalization and content-addressed manifests are
  strong; schema/runtime parity and catalogue validation need repair.
- Hygiene/minimality: the feature can remain a small standalone boundary; no
  unrelated accepted-merge changes are in scope.
- Security/privacy: absolute paths, obvious secret-like names, generic worker
  names, and stale explicit bindings are rejected; omitted freshness is the
  remaining execution risk.
- Durability/regression: digests and source bindings preserve identity, but
  schema consumers currently cannot reproduce all runtime rejection decisions.
- Custody/boundary: write-scope overlap fails closed and activation remains
  outside this feature; selectors need a mandatory fresh source readback.
- Intent: the feature supports task-shaped dynamic routing and named lane
  capability selection without redefining product intent or governance.

## True blockers and exact recovery

No true external blocker is present. The missing feature slice and contract gaps
are ordinary implementation findings. If a later host lacks the exact current
source commit/tree or the validated generated role catalogue, recovery is:

1. preserve the prepared manifest and evidence;
2. return `UNAVAILABLE` with the missing readback field;
3. do not select a role packet or write through a lane;
4. reacquire the exact source/catalogue readback; and
5. re-run validation before resuming the same bounded outcome.

## Builder actions for Pass 1

1. Add the accepted standalone dynamic-lane implementation and focused test
   contract to this worktree, with the recorded freshness, discovery-input,
   schema, and role-catalogue repairs.
2. Add no product names, private paths, credentials, provider identities,
   activation state, or unrelated merge work.
3. Run only non-functional static checks during this pass; functional tests
   remain pending.
4. Append a self-audit and re-audit section after the repair, including changed
   files, static evidence, remaining findings, and the next action.

## Pass 1 self-audit findings recorded before the next repair

### DPL-006 — manifest graph nodes are not fully cross-bound during validation

- Severity: high durability and regression finding.
- Evidence: `validateDynamicLaneManifest()` checks that graph node IDs cover
  manifest lane IDs and that the graph is internally valid, but it does not
  compare each graph node’s lane kind, display name, or dependency IDs with
  the corresponding manifest lane record.
- Why it matters: a persisted manifest can carry a re-digested graph whose
  identifiers are present but whose semantics differ from the lane roster.
  The compiler emits matching values, but revalidation of tampered or stale
  records would not detect this mismatch.
- Builder action: bind every graph node back to the manifest lane’s kind,
  display name, and dependency-derived lane IDs.

### DPL-007 — persisted role packets do not re-check lane governance selection

- Severity: medium governance and evidence finding.
- Evidence: `validateDynamicLaneRolePacket(packet, {manifest})` verifies packet
  and manifest identity, scope, and dependencies, but does not compare the
  packet’s graph/question IDs with the selected manifest lane’s governance
  selection. The packet compiler performs that comparison indirectly through
  role selection, but a persisted packet can be re-digested independently.
- Why it matters: a packet can look source/manifest-bound while carrying a
  different question or graph selection, weakening the claim that the
  already-generated role was selected rather than invented.
- Builder action: compare packet graph/question selections with the bound lane
  during manifest-backed packet validation; keep the four-library role
  generator as the authority for shared clauses and generated rule contents.

### DPL-008 — persisted manifest validation did not repeat roster uniqueness

- Severity: medium durability and regression finding.
- Evidence: discovery rejects duplicate capability identities, but manifest
  validation previously validated each lane independently without rejecting
  two lanes for the same capability identity (or capability/version key).
- Why it matters: a hand-edited or stale manifest could carry an ambiguous
  roster even though freshly compiled input would be rejected.
- Builder action: enforce capability-identity and capability/version uniqueness
  while validating the persisted manifest.

## Pass 1 repair and final re-audit

All recorded implementation findings DPL-001 through DPL-008 are closed in
this worktree:

- DPL-001: added the bounded dynamic-lane module, four versioned contracts,
  and focused hostile verifier.
- DPL-002: execution-facing role-packet selection now requires explicit current
  source commit and tree readback; omission returns
  `CURRENT_SOURCE_READBACK_REQUIRED`.
- DPL-003: discovery, manifest, dependency graph, and role packet schemas now
  constrain nested objects, bindings, IDs, paths, digests, edges, waves,
  scopes, and dependencies with strict object properties.
- DPL-004: added `validateDynamicLaneDiscovery()` and routed manifest
  compilation through the complete typed discovery envelope.
- DPL-005: role selection now requires the generated four-library role-library
  envelope, validates its content digest/source/campaign binding, rejects
  duplicate role IDs, and still leaves governance generation to its owning
  authority.
- DPL-006: manifest validation cross-binds every graph node’s kind, display
  name, and dependency-derived lane IDs to the roster.
- DPL-007: manifest-backed role-packet validation cross-binds graph and
  question selections to the lane governance selection.
- DPL-008: persisted manifest validation repeats capability identity and
  capability/version uniqueness checks.

### Final evidence

- Feature scope is complete: `control/dynamic-project-lanes.mjs`,
  `schemas/dynamic-lane-discovery.v1.json`,
  `schemas/dynamic-lane-manifest.v1.json`,
  `schemas/dynamic-lane-dependency-graph.v1.json`,
  `schemas/dynamic-lane-role-packet.v1.json`, and
  `tests/verify-dynamic-project-lanes.mjs` are present.
- `node --check` passed for the implementation and focused verifier.
- All four feature JSON contracts parsed successfully and passed the static
  strict-object check.
- The implementation module loaded successfully without missing dependencies.
- Diff whitespace hygiene passed for the feature source and verifier.
- A scoped source scan found no private machine path, credential, provider
  account, chat link, or secret value. The only token-like matches are
  portable field names and deliberate hostile-pattern checks.
- No `npm` command was used. Functional tests remain pending as instructed;
  no functional pass is claimed.

### Remaining findings and readiness

No implementation finding remains from the static re-audit. The candidate is
`PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS_AND_INDEPENDENT_ACCEPTANCE`.
The remaining items are evidence/lifecycle states, not blockers:

- focused and full functional tests are pending;
- independent acceptance of the exact candidate is pending;
- owner-linked research evidence remains unavailable in the public repository;
- prepared `2.1rc` activation remains intentionally pending an explicit
  activation decision.

No true external blocker exists. If current source or the validated role
catalogue cannot be read back later, the exact recovery remains the typed
`UNAVAILABLE` route recorded above; no lane selection or write may proceed.

## Changed files

- `control/dynamic-project-lanes.mjs`
- `schemas/dynamic-lane-discovery.v1.json`
- `schemas/dynamic-lane-manifest.v1.json`
- `schemas/dynamic-lane-dependency-graph.v1.json`
- `schemas/dynamic-lane-role-packet.v1.json`
- `tests/verify-dynamic-project-lanes.mjs`
- `docs/feature-audits/DYNAMIC_PROJECT_LANES/auditreport.md`

## Next action and terminal status

`FINISHED` for the requested audit → repair → self-audit → re-audit cycle.
The next action is an independent checker running the focused dynamic-lane
verifier and the repository’s full verifier on this exact candidate. Any
behavioral failure must append a new finding before another repair pass; a
passing result still does not activate `2.1rc`.
