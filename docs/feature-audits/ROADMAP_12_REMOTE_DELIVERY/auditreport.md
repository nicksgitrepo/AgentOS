# ROADMAP_12_REMOTE_DELIVERY — Remote Delivery Integrations

## Audit 1 — authoritative baseline

Status: `REPAIR_REQUIRED`; no external action taken.

Baseline identity:

- Inventory entry: `ROADMAP_12_REMOTE_DELIVERY`, `NOT_STARTED`.
- Accepted-merge checkout readback: `590c07ddd4be7a8c24727c24b40808e44ca7357d`.
- The feature slice in the accepted working tree matches the materialized snapshot `1d6611d7edfac56d06f8b66d9b150954cd6c477e`, tree `301039d8bcaa415a60f87c5b8451d79dc6fedf03`.
- The isolated builder worktree was aligned to that same feature snapshot before this report was written. This report is the only audit artifact created by this task so far.

### Intended behavior

The roadmap promises a provider-neutral, governed boundary for later provider-backed publication, deployment, authentication, spending, and rollback. Before a provider is enabled, the implementation must have:

1. an explicit adapter capability and permission contract;
2. credentials and authentication confined to the host/provider boundary, never prompts, public source, or ordinary handoffs;
3. dry-run, approval, partial-failure, spend-limit, rollback, and audit evidence paths;
4. action-specific authority at execution time; and
5. an independent checker that verifies the provider receipt without performing or accepting its own protected action.

The current local prototype remains local and must not be forced to configure or contact a provider. The prepared `2.1rc` line remains inactive. A missing project-bound adapter should leave only the dependent remote outcome unavailable, while local review and typed preparation remain safe.

### Actual implementation

The baseline contains a substantial portable delivery boundary:

- `control/delivery-target.mjs` compiles and validates a content-addressed target, checks it against the Project Life Contract, and keeps the generic managed-site profile from implying provider authority.
- `control/delivery-policy.mjs` compiles route, merge, deployment, rollback, cost, finish, and read-only probe policy. Its probe executor uses only local readbacks and explicitly marks remote actions `NOT_RUN_OWNER_BOUNDARY`.
- `control/delivery-closure-foundation.mjs`, `control/delivery-closure-records.mjs`, and `control/delivery-closure-transitions.mjs` provide content-addressed owner choices, Runtime requests, typed receipts, live-audit receipts, rollback receipts, final handoffs, closure records, and compare-and-swap state transitions.
- `schemas/runtime-delivery-request.v1.json` correctly separates `PREPARED` from `AUTHORIZED` and assigns authorization to the persistent `RUNTIME` role. The companion delivery schemas describe receipt, audit, handoff, and closure obligations.
- `docs/rapid-foundations/12-delivery-and-closure.md` correctly keeps remote actions out of the rapid local slice and requires a fresh typed boundary, exact adapters, independent evidence, and owner-approved plans for later delivery.
- Focused source tests cover target policy, read-only probes, explicit outcomes, Runtime authorization, live-audit gating, rollback targeting, closure, and several hostile privacy cases. They are not run in this task because functional tests remain pending by instruction.

### Findings and why they matter

#### R12-001 — Runtime authorization is not fully re-bound to the selected choice (HIGH; security, custody, boundary)

`validateRuntimeRequest` validates the request digest and choice digest but, when used by the state transition, does not compare source commit/tree, environment, scope, owner-approval digest, policy digest, or rollback target against the actual selected choice. `advanceDeliveryState` authorizes from state context and action only. Deploy, release, and rollback requests also accept a null environment reference when validated without the choice. A forged but self-consistent request can therefore carry the selected choice digest while changing the execution target or authority context.

Evidence: `control/delivery-closure-records.mjs:204-280`; `control/delivery-closure-transitions.mjs:92-98`; `schemas/runtime-delivery-request.v1.json:7-16`.

Impact: the exact protected action could be authorized against a different source, environment, scope, or policy than the owner selected. This violates action-specific authority and provider custody even though no provider is currently configured.

#### R12-002 — Failed and unknown delivery states have no explicit recovery/re-entry transition (HIGH; durability, recovery, intent)

Receipt reconciliation moves `FAILED` and `UNKNOWN` outcomes into terminal-looking state statuses, but the transition contract provides no re-open, reconciliation, or owner-review handoff from either status. The schema says these states require reconciliation or owner review, yet the executable transition table has no route to perform either. Only a failed live audit reaches the explicit rollback path.

Evidence: `control/delivery-closure-foundation.mjs:41-53`; `control/delivery-closure-transitions.mjs:107-118`; `schemas/delivery-state.v1.json:16-26`.

Impact: a partial provider failure can strand a campaign without a typed next action, making retries, owner review, and preserved failure evidence dependent on out-of-band behavior.

#### R12-003 — Receipt and final-handoff evidence is not cross-checked completely (HIGH; proof, regression, custody)

The final-handoff validator requires a nonempty receipt digest list for selected outcomes but does not require that list to contain the actual action receipt when one is supplied. The close transition does not require or pass the selected choice and action receipt into all cross-record validators. The state and closure records therefore carry strong individual digests but do not always prove that the handoff, closure, choice, source, and receipt are one coherent chain.

Evidence: `control/delivery-closure-records.mjs:597-667`, `670-775`; `control/delivery-closure-transitions.mjs:138-146`.

Impact: a malformed or tampered handoff could omit the action receipt it claims to close over, or be paired with a same-context but different choice, weakening independent acceptance and replay.

#### R12-004 — Provider capability, permission, dry-run, partial-failure, and spend enforcement are not represented as one delivery adapter contract (MEDIUM/HIGH; production readiness)

Provider discovery records enumerate broad capabilities, and delivery policy records route classes and cost boundaries, but the Runtime request has no digest for an action-specific adapter permission contract. There is no portable contract requiring the selected adapter to attest support for the requested action, typed dry-run behavior, partial-failure receipts, rollback support, receipt verification, host-local secret custody, or cost-boundary enforcement before authorization.

Evidence: `schemas/provider-discovery.v1.json:18-32`; `control/private-provider-discovery.mjs:17-120`; `control/delivery-policy.mjs:331-358`; `schemas/runtime-delivery-request.v1.json:7-18`.

Impact: a route/provider identifier can be present without proving that the exact protected action is permitted or that the required safety and receipt behavior exists. The local prototype must remain unconfigured, but the portable boundary should be ready for a project-bound adapter.

#### R12-005 — Limited-product targets name limitations, not the required scope, operating envelope, and rollback path (MEDIUM; intent, boundary)

The target contract says `LIMITED_PRODUCT` must name supported scope, audience, data posture, operating envelope, and rollback path. The executable target record currently carries audience, data posture, and free-form limitation codes, but no explicit supported-scope, operating-envelope, or rollback-path fields. The default limitation labels are not equivalent to typed owner intent.

Evidence: `schemas/delivery-target.v1.json:20-24`; `control/delivery-target.mjs:131-187`; `tests/verify-delivery-target.mjs:25-37`.

Impact: a target can be labeled limited without carrying the minimum bounded product envelope needed for safe remote delivery or later independent review.

#### R12-006 — Live-audit independence is identity-shaped rather than attestation-bound (MEDIUM; independent acceptance)

The live-audit record requires an opaque auditor reference different from the Runtime reference, but does not bind that reference to an admitted checker readback or an explicit auditor attestation. This is acceptable as a host seam for the inactive local prototype, but it is not sufficient proof for enabling a real provider.

Evidence: `control/delivery-closure-records.mjs:495-563`; `schemas/delivery-live-audit-receipt.v1.json:7-15`; `control/README.md:72-76`.

Impact: a caller could supply two different opaque strings without proving that an independent checker actually observed the exact provider result. This remains a project-bound adapter/evidence requirement, not permission for the portable kernel to invent a provider identity.

### Cross-cutting quality and hygiene lenses

- Quality: the baseline has deterministic canonical digests, exact-key validation, explicit statuses, and focused hostile fixtures. The missing cross-record checks above prevent a production claim.
- Hygiene/minimality: the remote boundary is split into small foundation, records, and transitions modules; no provider-specific product code or credentials were found. The repair should stay limited to the typed delivery seam, its contracts, tests, and this report.
- Security/privacy: secret-free and opaque-reference checks are strong for records and policy probes. The main remaining risk is authorization/capability confusion, not a discovered secret leak.
- Durability/regression: content-addressed records and CAS revisions are useful, but terminal failure without re-entry and incomplete evidence-chain checks can strand or mis-replay a campaign.
- Custody: Runtime and independent-auditor roles are named, but authorization and live-audit custody need stronger cross-record bindings and adapter evidence.
- Boundary/intent: local-only and prepared outcomes are correctly separated from external effects; limited-product intent and provider action permissions need typed fields.

### Evidence and unknowns

- Directly observed: roadmap and governance intent, feature inventory entry, target/policy controllers, runtime/receipt/closure controllers, schemas, documentation, focused test source, and the accepted feature snapshot identities above.
- Not run: functional tests, provider actions, authentication, network access, spending, push, merge, deployment, release, rollback, or live-site audit. These remain pending or owner/host-boundary outcomes.
- Unknown: the inventory source token `research-records-linked-by-owner` has no linked research record in the inspected public tree. No owner-linked research claim is being inferred or copied into the portable kernel.
- Unknown: no project-bound provider adapter, account, environment, quota, credential, or host capability was supplied. This is expected for the local prototype and is not treated as a blocker for repairing the portable boundary.

### Production readiness

Baseline readiness is `PREPARED_NOT_ACTIVATED / REPAIR_REQUIRED`. The local preparation and read-only probe path are useful, but the remote-delivery candidate is not production-ready until R12-001 through R12-005 are repaired and the focused functional tests pass. R12-006 remains a project-bound evidence obligation before any real provider is enabled. `2.1rc` remains inactive.

### True blockers and exact recovery

No genuine external blocker is present. The absent provider, credentials, account, and host capability are intentionally outside the local prototype and do not authorize us to fabricate them. If a real provider is later admitted, the exact recovery is: bind a project-context adapter contract and environment, obtain a fresh owner-approved plan and policy digest, obtain host-local authentication without persisting secrets, execute only the authorized action, collect the typed receipt, and have a distinct checker verify that receipt before closure. Until then, remote actions remain `NOT_RUN_OWNER_BOUNDARY` or `UNAVAILABLE`.

### Builder actions recorded for this task

1. Add a project-agnostic delivery-adapter capability/permission contract and bind its digest plus the exact delivery-policy digest into Runtime requests.
2. Make Runtime authorization, dispatch, reconciliation, live audit, closure, and completion checks compare the supplied records with the selected choice and adapter contract.
3. Add an explicit failed/unknown re-entry transition that preserves the failed receipt reference and requires a fresh choice before another external action.
4. Require typed supported scope, operating envelope, and rollback path for limited-product targets.
5. Add hostile focused-test cases for each repaired boundary. Do not execute functional tests in this task.

Initial audit conclusion: `REPAIR_REQUIRED`, no external side effect, builder phase begins in this isolated worktree.

## Builder pass 1 — recorded repairs

The builder repaired only R12-001 through R12-005 in the isolated worktree. No
provider, account, credential, network, spend, deployment, release, rollback,
or live-site boundary was contacted.

### Implemented behavior

- Added `control/delivery-adapter.mjs` and `schemas/delivery-adapter.v1.json`.
  The provider-neutral contract is prepared/inactive, content-addressed, and
  secret-free. It requires action-specific capabilities and permissions,
  no-effect dry run, explicit `FAILED`/`UNKNOWN` partial-failure handling,
  fresh-choice retry, exact-last-accepted-deployment rollback, typed receipts,
  host-enforced policy spend limits, host-local secret custody, and
  project-bound environment identity.
- Bound the exact Delivery Policy digest and adapter digest into Runtime
  requests and external receipts. Runtime authorization now requires the
  selected choice and adapter contract, compares source, environment, scope,
  owner approval, policy, rollback target, action, and adapter identity, and
  keeps `RUNTIME` as the only authorizing role.
- Rebound dispatch, reconciliation, live-audit registration, rollback receipt
  registration, closure, and completion to the same choice, request, receipt,
  policy, adapter, and state chain. External handoffs and closures fail closed
  without the prepared adapter contract.
- Added `REOPEN_AFTER_FAILURE`. A failed or unknown action preserves its action
  receipt reference and returns to `CHOICE_REQUIRED`; the next external action
  requires a fresh owner-selected choice. Unknown live-audit re-entry also
  requires the preserved action receipt and audit body, so evidence cannot be
  silently dropped.
- Added explicit `supported_scope`, `operating_envelope`, and
  `rollback_path` fields to non-prototype delivery targets, requiring the exact
  rollback identity for every non-prototype target.
- Added hostile source, adapter, receipt, handoff, closure, failure-reentry,
  unknown-live-audit, target, and privacy fixtures. The prepared 2.1rc line
  remains inactive.

### Self-audit 1

The first repaired pass was checked against the original findings and the
roadmap obligations:

- R12-001: resolved by exact selected-choice comparisons and required opaque
  environments for DEPLOY, RELEASE, and ROLLBACK.
- R12-002: resolved by `REOPEN_AFTER_FAILURE`, receipt preservation, and fresh
  choice enforcement.
- R12-003: resolved by passing the actual records through every close and
  completion validator and requiring the handoff to contain the supplied action
  receipt digest.
- R12-004: resolved by the typed adapter contract, policy/adapter digests,
  action capability checks, and host-bound safety rules.
- R12-005: resolved by typed target scope, operating envelope, and exact
  rollback path fields and hostile missing-field coverage.
- R12-006: intentionally not claimed resolved. The portable kernel still
  requires a distinct auditor reference, but a real project must supply the
  checker attestation and host readback that prove that reference actually
  observed the provider receipt.

The self-audit then identified one additional evidence-preservation edge case:
an `UNKNOWN` state carrying live-audit evidence needed to require the audit body
on re-entry instead of accepting only the action receipt.

## Builder pass 2 — self-audit repair

The second pass tightened the re-entry branch to distinguish receipt-only
unknown failures from unknown live-audit evidence. It now rejects an unbound
audit body and requires the preserved action receipt, adapter contract, and
matching audit digest before clearing active execution evidence. The local-only
transition was also rebound to its selected choice and policy digest.

## Re-audit 2 — current candidate

### Re-audit result

R12-001 through R12-005 are resolved in the candidate source. The current
candidate is:

`PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`

Remote enablement remains intentionally pending R12-006 project binding. This
is not a genuine blocker for the portable repair: no provider host or checker
authority was supplied, and the local boundary is designed to remain inactive.
No feature finding requires another source repair before focused tests.

### Final cross-cutting assessment

- Quality: exact-key, content-addressed records now carry the policy and adapter
  chain through authorization, receipt, audit, rollback, handoff, closure, and
  completion.
- Hygiene/minimality: the repair is limited to the delivery adapter, delivery
  records/transitions, target fields, their contracts, focused fixtures,
  governance bindings, and this audit. No provider-specific implementation or
  product context was added.
- Security/privacy: adapter references and Runtime/auditor references remain
  opaque; credentials remain host-local; contract and receipt validators reject
  secret-shaped material and credential-bearing URLs; external acceptance fails
  without the exact prepared adapter.
- Durability/regression: CAS revisions remain in force; failed and unknown
  evidence is preserved; retry requires a new choice; hostile coverage now
  covers source/target/adapter/handoff/re-entry boundaries. Functional tests
  have not been executed by instruction.
- Custody: only persistent Runtime may authorize; the independent auditor
  cannot equal Runtime; a later project-bound attestation is still required for
  real live acceptance.
- Boundary/intent: local-only, prepared, unavailable, and owner-boundary
  outcomes remain distinct; limited-product intent now carries scope, envelope,
  and rollback identity; 2.1rc remains `PREPARED_NOT_ACTIVATED`.

### Evidence and verification boundary

Static verification completed:

- JavaScript syntax checks passed for the repaired controllers and focused test
  sources.
- JSON parsing checks passed for the changed contracts and binding registries.
- `git diff --check` passed.
- The feature-specific changed binding entries match their file digests,
  including the new adapter controller, contract, and verifier.
- Functional tests remain pending: no test module was run, and no external
  action was attempted.

The snapshot also contains unrelated pre-existing stale digests in other
binding entries. They were not changed because they are outside this feature's
recorded findings and scope; the feature-specific binding entries were updated
and checked.

### Changed files

Implementation and contracts:

- `control/agentos.mjs`
- `control/delivery-adapter.mjs`
- `control/delivery-closure-records.mjs`
- `control/delivery-closure-state.mjs`
- `control/delivery-closure-transitions.mjs`
- `control/delivery-target.mjs`
- `schemas/delivery-adapter.v1.json`
- `schemas/delivery-closure.v1.json`
- `schemas/delivery-final-handoff.v1.json`
- `schemas/delivery-live-audit-receipt.v1.json`
- `schemas/delivery-policy.v1.json`
- `schemas/delivery-receipt.v1.json`
- `schemas/delivery-state.v1.json`
- `schemas/delivery-target.v1.json`
- `schemas/kernel.v1.json`
- `schemas/naming-and-terminology.v1.json`
- `schemas/runtime-delivery-request.v1.json`
- `schemas/bootstrap-binding.v1.json`
- `governance/2.1rc/delivery-policy.md`
- `governance/2.1rc/delivery-target.md`

Focused coverage and audit:

- `tests/verify-delivery-adapter.mjs`
- `tests/verify-delivery-closure-state.mjs`
- `tests/verify-delivery-target.mjs`
- `tests/verify-bootstrap-contract-bindings.mjs`
- `docs/feature-audits/ROADMAP_12_REMOTE_DELIVERY/auditreport.md`

### Exact recovery for remaining R12-006

When a real provider is explicitly admitted, project context must supply a
distinct checker identity and typed attestation contract bound to the exact
action receipt digest, adapter digest, source, environment, and result. The
host must authenticate locally without persisting secrets in AgentOS records,
the checker must read back the provider result without performing or accepting
the action, and closure must be re-run with that attestation. Until those facts
exist, keep the remote outcome `UNAVAILABLE` or `NOT_RUN_OWNER_BOUNDARY` and
continue with local review or prepared typed handoff.

### Next action

Run the focused functional tests and then the repository's authorized broader
verification suite. If they pass, the portable candidate is ready for the
project-bound adapter/checker admission decision; no provider activation is
implied by this repair.

Final re-audit conclusion: `CANDIDATE_PENDING_FUNCTIONAL_TESTS`, no genuine
external blocker, no external side effect, and no unresolved repairable
finding in the recorded feature scope.
