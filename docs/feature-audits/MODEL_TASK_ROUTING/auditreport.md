# MODEL_TASK_ROUTING audit report

## Audit status

Pass 1 is complete. The same task is now the builder. The feature is not yet a
production candidate: repair is in progress and functional tests remain
pending by instruction.

The authoritative accepted-merge baseline was read before this report was
created. Its source identity was:

- commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- committed source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- accepted-merge working state: dirty snapshot; source files below were
  present there as the current candidate, not as committed source
- inventory contract: `PREPARED_NOT_ACTIVATED`

The writable worktree started at the same committed source identity but did
not contain the accepted-merge feature files. No private machine paths,
credentials, provider tokens, chat links, or task/session identities are
stored in this report.

## Scope and evidence read

The inventory entry for `MODEL_TASK_ROUTING` names:

- `schemas/task-model-policy.v1.json`
- `schemas/effective-model-readback.v1.json`
- `control/task-model-routing.mjs`

The audit also read the complete roadmap and architecture intent, the
portable-kernel and role-routing boundaries, the schema README and control
README, the available rapid-foundation security/hygiene/context material, the
accepted candidate's focused routing test, and all direct references to model,
tool, context, capability, fallback, and readback behavior. The inventory's
`research-records-linked-by-owner` source is not materialized in the accepted
merge snapshot available to this task; that absence is recorded as an
evidence unknown, not treated as permission to invent research conclusions.

## Intended behavior

The roadmap's task-shaped routing promise requires task need to select and
explain the smallest suitable role, model, reasoning effort, context, tools,
worker shape, workspace capability, and evidence path. It requires:

1. a typed, reproducible route with an honest fallback;
2. pre-work capability checks that never simulate an unavailable capability;
3. no oversized team or unnecessary context for a small task;
4. evaluation evidence for quality, cost, latency, context sufficiency, and
   policy compliance across representative task classes; and
5. a context firewall rejecting unrelated project data, secrets, stale records,
   and unauthorized memory.

The portable-kernel boundary further requires project/provider facts to enter
as typed context, protected actions to remain disabled, source and authority
to remain explicit, and missing host readback to remain unavailable rather
than becoming a successful claim.

## Actual implementation in the accepted candidate

The candidate provides a useful deterministic core:

- a validated task profile with sensitivity floors, required capabilities,
  context-token minimums, tools, permissions, cost, deadline, and fallback
  triggers;
- a validated model policy with preference, completion floor, reasoning and
  verifier floors, role/lane overrides, and bounded fallback settings;
- a host-readback capability catalog with model capability, context, tool,
  verifier, permission, cost, latency, success-probability, and spawnability
  fields;
- deterministic route selection with explainable eligible/excluded candidates,
  content-addressed inputs, and protected external actions excluded;
- an effective model readback record with `VERIFIED`, `UNKNOWN`, and `MISMATCH`
  states; and
- a blocked fallback-boundary record for hard boundaries or exhausted/unsafe
  fallback paths.

The candidate is deliberately integration-neutral. It does not create host
sessions, and the accepted public surface only exports the routing compilers
and selectors. No controller/session path was found that consumes the route,
binds a real context packet, or records an execution receipt.

## Findings from pass 1

| ID | Severity | Finding | Why it matters | Evidence | Builder action |
| --- | --- | --- | --- | --- | --- |
| F-001 | P1 | The writable worktree lacks the feature source, schemas, focused verifier, and the shared content-addressing/privacy prerequisites used by the accepted candidate. | There is no buildable feature candidate in the only writable scope, so no repair or clean-checkout reproduction is possible. | Inventory source list; clean baseline tree; accepted candidate files are uncommitted there. | Port the feature slice and the minimum required shared primitives into this worktree; keep unrelated accepted-merge work out. |
| F-002 | P1 | `selectFallbackRoute` validates the predecessor route but does not verify that the supplied task profile, policy, and capability catalog match the route digests. | A caller can request a fallback under changed task, policy, or host capability facts while retaining the old predecessor identity. This breaks custody, reproducibility, and policy compliance. | `control/task-model-routing.mjs`, fallback selector around lines 745–779. | Bind all fallback inputs to the predecessor route and return a typed boundary on mismatch. |
| F-003 | P1 | Effective-readback validation accepts a self-consistent forged `VERIFIED` record and `requireVerifiedEffectiveModel` has no expected-route argument. | A readback digest proves record integrity only; without route binding and equality checks it can be replayed as proof for a different execution. | `control/task-model-routing-support.mjs`, readback validation around lines 181–217 and helper around lines 282–285. | Enforce verified-value equality and require/validate the expected route at the acceptance boundary. |
| F-004 | P1 | Context is represented only by token counts; there is no typed context manifest/firewall for source, project, freshness, authorization, unrelated data, secrets, or stale memory. Worker shape, workspace capability, and evidence path are also absent from the route. | The main roadmap promise is only partially implemented, and the router cannot prove that prompt context is selective or safe. | Roadmap task-routing requirements; task profile and route fields in the accepted candidate. | Add a deterministic, digest-bound context manifest/firewall and explicit route-bound worker/workspace/evidence selections without admitting private values. |
| F-005 | P1 | No-eligible-model is raised as a generic error; there is no typed initial unavailable route carrying safe rejection evidence. | Missing capabilities are not persisted as an honest route, making recovery and independent review dependent on transient exception text. | `control/task-model-routing.mjs`, selection failure around lines 678–682. | Add a privacy-safe unavailable-routing record/error with deterministic rejection summaries and exact recovery state. |
| F-006 | P2 | Fallback policy says `deny_downgrade`, but fallback selection preserves only profile/policy minimums; it can downgrade the predecessor's actual reasoning, verifier, context, success probability, or optional capability envelope. | A reserve route can silently be weaker than the route it replaces while still passing minimum checks. | `control/task-model-routing.mjs`, fallback policy and fallback candidate selection. | Compare each fallback candidate with the predecessor route and reject actual downgrades before admission. |
| F-007 | P2 | `fallback_allowed: false` can retain nonempty fallback triggers, and the route can expose triggers even though fallback is disabled. | The persisted explanation contradicts the effective policy and invites an unsafe caller to treat disabled fallback as authorized. | Task-profile validation and `fallbackPolicyForSelection`. | Canonicalize/validate the disabled form as empty and keep route fallback triggers empty when disabled. |
| F-008 | P2 | The focused verifier covers ordinary selection, one safe fallback, hard-boundary fallback, privacy scanning, and basic readback, but not the hostile integrity, firewall, unavailable, downgrade, or schema-parity cases above. | The highest-risk invariants can regress without detection; roadmap evaluation evidence is incomplete. | `tests/verify-task-model-routing.mjs` coverage review. | Extend the focused verifier and schema fixtures; do not claim execution until the instructed pending-test boundary is lifted. |

## Quality and boundary assessment

- **Intent:** The candidate captures task-shaped model/tool selection but does
  not yet cover the full role/context/worker/evidence intent.
- **Minimality:** The core is reasonably isolated and integration-neutral; the
  missing shared primitive in the writable baseline must be added minimally,
  without importing unrelated accepted-merge modules.
- **Determinism:** Canonical digests and stable candidate ordering are good;
  fallback input rebinding and unavailable records are still required.
- **Security/privacy:** Protected external permission is excluded from routed
  permissions and persisted records are scanned, but context contents are not
  admitted or filtered and readback acceptance is forgeable without an
  expected-route boundary.
- **Durability/regression:** Route and readback digests provide a foundation,
  but fallback custody and unavailable-state persistence are incomplete.
- **Custody:** The module correctly avoids creating sessions; integration must
  keep host/session readback authoritative and never treat a requested model as
  proof.
- **Hygiene:** The accepted candidate is source-oriented and avoids private
  values in its records. The research source is unavailable, and schema/runtime
  parity plus hostile coverage remain unproven.

## Production readiness

`NOT_READY`. The accepted candidate is a strong partial core, but the P1
findings prevent a production claim. Functional tests are explicitly pending;
no test pass is asserted in this report. There is no genuine external blocker
at this point: each finding has a bounded local reframe and repair action.

## True blockers and exact recovery

None. If the owner-linked research corpus becomes necessary to resolve a
material policy conflict, recovery is to supply a portable, secret-free
research summary or typed authority record; until then the roadmap and
accepted source contracts are the governing evidence.

## Builder actions for the next pass

1. Add the feature slice and minimum shared primitives to this isolated
   worktree.
2. Repair fallback custody, verified-readback binding, downgrade protection,
   disabled-fallback consistency, and typed unavailable behavior.
3. Add the context firewall plus worker/workspace/evidence route fields in a
   project-agnostic, digest-bound form.
4. Add focused hostile fixtures and schema parity checks without running
   functional tests.
5. Self-audit the resulting diff, then append a re-audit with remaining
   findings, evidence, production status, and the next action.

## Pass 2 — builder repair and self-audit

The recorded findings were repaired only in this isolated worktree.

### Changed files

- `control/task-model-routing.mjs`
- `control/task-model-routing-support.mjs`
- `control/content-addressing.mjs`
- `control/persisted-record-privacy.mjs`
- `schemas/task-profile.v1.json`
- `schemas/task-model-policy.v1.json`
- `schemas/host-capability-catalog.v1.json`
- `schemas/execution-route.v1.json`
- `schemas/effective-model-readback.v1.json`
- `schemas/fallback-boundary.v1.json`
- `schemas/task-context-manifest.v1.json`
- `schemas/routing-unavailable.v1.json`
- `tests/verify-task-model-routing.mjs`
- `docs/feature-audits/MODEL_TASK_ROUTING/auditreport.md`

### Repair evidence

- F-001: the named feature source, schemas, focused verifier, and minimum
  content-addressing/privacy prerequisites now exist in the writable scope;
  no unrelated accepted-merge files were added.
- F-002: fallback selection validates the supplied profile, policy, catalog,
  and context-manifest digests against the predecessor route and emits a
  `FALLBACK_INPUT_MISMATCH` blocked boundary on drift.
- F-003: verified readback now requires an expected route, matches requested
  and effective model/reasoning values, requires shared host/session tools,
  permissions, context, and capability catalog, and rejects a forged
  route-bound record even when its local digest is recomputed.
- F-004: a digest-bound `agentos.task_context_manifest.v1` admits only current,
  related, authorized, secret-free context metadata; optional transient
  content is scanned and never persisted. Routes select the smallest admitted
  context envelope that satisfies the task, and carry worker shape, workspace
  capability, and evidence-path selections.
- F-005: no eligible model now produces a content-addressed
  `agentos.routing_unavailable.v1` record through a typed boundary error with
  deterministic rejection reasons.
- F-006: fallback candidates must preserve or improve reasoning, verifier,
  selected context, estimated success probability, tool envelope, permission
  envelope, and worker/evidence selections before admission.
- F-007: disabled profile and policy fallback forms canonicalize to zero
  attempts, zero triggers, and zero ordered models; admitted routes expose the
  same disabled state.
- F-008: the focused verifier now contains fixtures for changed fallback
  inputs, forged readback, unavailable capability, unrelated/secret context,
  route-bound acceptance, disabled fallback, and the added schema contracts.

Static evidence collected after the repair:

- `node --check` passed for the changed JavaScript modules and focused
  verifier.
- JSON parsing passed for all eight routing schemas.
- import-path and whitespace scans found no missing local dependency or
  trailing whitespace in the feature slice.
- no npm command was used.
- functional tests were not executed and are not claimed as passed.

## Pass 3 — re-audit result

### Resolved findings

F-001 through F-008 are resolved in source and contract shape as described
above. The implementation remains project-agnostic: raw context is not stored,
provider/account identity is not introduced, protected external action remains
excluded, and host/session creation remains outside this module.

### Remaining findings and exact next action

| ID | Status | Remaining item | Evidence/impact | Exact next action |
| --- | --- | --- | --- | --- |
| R-001 | P1 / pending | Functional verification has not run. | The delegation explicitly leaves functional tests pending; static checks cannot prove behavior. | Run `node tests/verify-task-model-routing.mjs` and the applicable repository verifier on a test-authorized pass, then independently re-audit any failure. |
| R-002 | P2 / bounded integration | The feature is intentionally integration-neutral; this worktree does not exercise a live Controller/session adapter or host readback. | The routing contracts are ready for a typed project-bound adapter, but production use still needs host-bound integration evidence. | Bind the route/readback contracts through the current host adapter in a separate admitted integration pass; do not treat a requested model as execution proof. |
| R-003 | evidence unknown | Owner-linked research records named by the inventory were not present in the readable accepted snapshot. | No policy conflict was discovered in the roadmap/schema/documentation sources; research conclusions were not invented. | If the owner supplies a portable research summary or typed authority record that changes routing intent, reopen the route and repeat this audit. |

### Production readiness and blockers

Status: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS_AND_HOST_INTEGRATION`.
The local feature slice is repaired and self-audited, but it is not a release,
activation, deployment, or acceptance claim. R-001 and R-002 are ordinary
verification/integration work, not external blockers. R-003 is an evidence
unknown with a concrete recovery path. There is no genuine external blocker,
and no `CONTEXT_NEEDED` state is required for this pass.

Next action: keep the candidate at the test boundary, run the focused
functional verifier when authorized, and append the resulting evidence and
any further repair/re-audit rather than converting pending checks into a pass.
