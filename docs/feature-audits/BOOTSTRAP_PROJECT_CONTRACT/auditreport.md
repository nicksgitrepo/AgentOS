# BOOTSTRAP_PROJECT_CONTRACT audit report

Feature: `BOOTSTRAP_PROJECT_CONTRACT` — Bootstrap to Project Contract Compilation  
Audit cycle: initial audit recorded 2026-08-07  
Authority posture: `CURRENT_ACCEPTED_MERGE` read before any write  
Current status: `AUDIT_RECORDED_REPAIR_PENDING`  
Functional tests: pending by task instruction; no npm use

## Scope and audit method

This report covers the complete declared feature source set:

- `docs/bootstrap-rapid-prototype-plan.md`
- `schemas/bootstrap-project-contract.v1.json`
- `control/bootstrap-project-contract.mjs`

The audit also read the directly required conversation and compilation-receipt
contracts, the discovery contract, the Bootstrap start and architecture
documentation, the roadmap, the twelve rapid-foundation research contracts and
their clearance evidence, the feature-specific schema and focused tests, and
the public kernel/privacy/boundary guidance. The accepted merge snapshot was
treated as read-only authority. The isolated worktree was clean before this
report was created and is the only writable scope.

## Intended behavior

The intended slice is a deterministic, project-agnostic transition from a
plain-language owner exchange to a private, typed, content-addressed project
contract. It must:

1. ask only the earliest material owner question, normalize the answer, and
   retain normalized typed answers rather than raw conversation;
2. distinguish owner-confirmed values, compiler derivations, safe defaults,
   unresolved questions, and typed discovery observations;
3. compile intent, one bounded goal, scope/non-goals, hard and soft boundaries,
   a four-phase plan, owner decisions, delivery/memory governance inputs,
   unknowns, source bindings, and privacy posture;
4. require host binding before consequential work, never infer protected
   authority, and preserve `2.1rc` as prepared but inactive;
5. project discovery to safe identifiers, statuses, epistemic classes, and
   digests without persisting source locators or raw observed values;
6. content-address the conversation, intent/scope, contract, and compilation
   receipt so an independent reader can reproduce the binding;
7. fail closed for unsafe input, invalid source material, integrity failures,
   changed owner intent/scope, and unavailable required decisions; and
8. make the production boundary explicit: this is a local contract compiler,
   not permission to authenticate, spend, publish, deploy, push, merge,
   activate, or claim a full project/campaign acceptance.

The roadmap’s stronger full-contract promise also calls for workflows,
terminology, providers, retention, complete delivery intent, and decision
metadata (authority, scope, lifetime, provenance, and revision trigger). The
current rapid slice is allowed to remain partial in those broader areas only
when the omission is explicit and typed rather than silently passed.

## Actual implementation found in the authoritative snapshot

The authoritative snapshot contains a coherent standalone implementation and
focused tests:

- `control/bootstrap-conversation.mjs` defines the question catalog, normalized
  answer parsing, replay handling, conversation digest, and conversation
  validation.
- `control/bootstrap-project-contract.mjs` compiles the typed intent/scope,
  boundaries, goal, phases, decisions, open questions, governance inputs,
  discovery projection, reassessment state, privacy posture, and contract
  digest. It also exposes a fail-closed receipt path.
- `control/bootstrap-compile-receipt.mjs` records safe digests, blocking
  question IDs, status, failure code, and compiler version without error text.
- `schemas/bootstrap-project-contract.v1.json`, the conversation/answer,
  discovery, and receipt schemas describe the machine payloads.
- `tests/verify-bootstrap-project-contract.mjs` and
  `tests/verify-bootstrap-project-contract-schema.mjs` cover the happy path,
  pending questions, defaults, discovery projection, reassessment, privacy
  failures, content-addressing, and structural schema expectations.

The isolated candidate did not yet contain these feature artifacts when the
initial audit began. This is a custody/materialization issue for this task,
not evidence that the authoritative implementation was absent. No source was
copied or edited before this initial audit was recorded.

## Evidence of alignment

Positive evidence from the read-only review:

- The plan explicitly makes machine contracts and controllers authoritative,
  keeps the local prototype secret-free, and forbids external effects.
- The roadmap identifies the conversation-to-contract path as the needed
  Phase 1 vertical slice and keeps providers, production, and activation
  outside the current local prototype.
- The Bootstrap/context foundation requires read-only discovery, safe defaults,
  source/cwd binding, no caller-asserted identity, and honest unavailable
  states; the implementation binds conversation and discovery digests and sets
  `host_binding_required: true`.
- The conversation foundation requires one question at a time, exact answer
  binding, plain-language exchange, no raw/private context leakage, and no
  protected side effects; the implementation uses ordered questions, normalized
  answers, replay-safe state, and unsafe-input rejection.
- The security/privacy and evidence/identity foundations require secret-free
  public records, private details outside public payloads, digest-backed
  evidence, and independent checking; the compiler projects discovery values
  to safe metadata and content-addresses outputs.
- The recovery and delivery foundations require changed-intent reassessment,
  fail-closed unavailable behavior, local review only, and no inferred release
  or external action; the compiler emits `REASSESSMENT_REQUIRED`, deferred
  delivery routing, and explicit privacy flags.
- `2.1rc` remains prepared and inactive in the source documentation.

## Recorded findings

### F-001 — Candidate custody/materialization is incomplete (P1)

The feature and its direct contract/receipt dependencies are present in the
accepted authority snapshot but absent from this isolated candidate at the
start of the audit. Without materializing the reviewed source into the
isolated candidate, the feature cannot be imported, syntax-checked, or handed
off from this worktree.

Why it matters: custody is part of production readiness; an audit of a source
that is not present in the candidate cannot be reproduced by the next checker.

Evidence: the feature inventory names the three feature sources; the accepted
snapshot contains them and the focused tests; the isolated worktree initially
reported each as missing.

Builder action: copy only the reviewed feature artifacts and the direct
conversation/receipt dependencies into this worktree, then record their
changed paths and hashes. Do not modify the accepted authority snapshot.

### F-002 — Conversation validation accepts semantically tampered sessions (P1)

`validateBootstrapConversation` checks known answer IDs, answer hashes, and the
session hash, but does not fully enforce the question’s canonical value type,
unique/exact answer order, or consistency between `status` and the required
question set. A caller who rewrites a normalized answer and recomputes the two
content digests can therefore present a semantically invalid session to the
contract compiler.

Why it matters: the compiler treats the validated session as owner authority;
hashing an invalid shape does not make the owner decision truthful.

Evidence: `control/bootstrap-conversation.mjs` validation around its answer
loop and session-state checks; the schema declares unique order but executable
validation does not enforce it; the focused tests do not cover canonical-type
tampering or status/order tampering.

Builder action: validate each answer against its question kind and canonical
choice value, require known unique answer order containing every answer exactly
once, and require status/reassessment invariants before compilation. Add
hostile fixtures to the focused test without echoing their values.

### F-003 — Project-contract validation is structurally looser than its trust boundary (P1)

`validateProjectContract` verifies the top-level shape and self-content digest,
but does not enforce the compiler’s exact four phase IDs/order, goal/phase
reference consistency, known/unique decision question IDs, or decision-reference
binding. A tampered contract can be rehashed and still pass validation while
describing a different plan.

Why it matters: a self-consistent digest is not semantic integrity. The
independent checker must be able to reject a validly rehashed but unauthorized
contract shape.

Evidence: `control/bootstrap-project-contract.mjs` validation of goals, phases,
decisions, and open questions; the current focused test covers one digest
mutation but not rehashed semantic substitutions.

Builder action: enforce the compiled phase sequence and references, decision
identity/order/known-question invariants, and the allowed open-question
identities. Add hostile rehash fixtures to the focused test.

### F-004 — Discovery conflicts and unknowns are counted but not surfaced (P1)

The discovery projection records fact IDs and epistemic counts, but
`compileOpenQuestions` only creates owner questions for the fixed conversation
requirements plus one deferred delivery question. A `CONFLICT` or material
`UNKNOWN` discovery result can therefore coexist with a `READY` contract
without an explicit unresolved item.

Why it matters: discovery authority explicitly says conflicts and unknowns are
surfaced to Bootstrap and never silently selected. Counts alone are not an
actionable handoff or a reproducible reason to hold dependent work.

Evidence: `control/bootstrap-project-contract.mjs` discovery projection and
open-question compilation; `schemas/bootstrap-discovery.v1.json` conflict/
unknown rules; Bootstrap/context foundation unavailable and hostile cases.

Builder action: retain safe fact IDs grouped by epistemic class, surface
conflict/unknown groups as explicit blocking open questions, and bind their
question state into contract validation and receipt evidence without persisting
fact values or locators.

### F-005 — Decision metadata required by the roadmap is incomplete (P2)

Compiled decisions include authority and provenance but omit explicit decision
scope, lifetime, and revision trigger. The roadmap’s layered-governance
promise requires all of these fields so an owner decision cannot be treated as
permanent or silently reused after its contract changes.

Why it matters: missing lifetime/revision semantics weaken upgrade safety,
reassessment, and independent interpretation even when the answer digest is
valid.

Evidence: `schemas/bootstrap-project-contract.v1.json` and
`compileDecisions` in `control/bootstrap-project-contract.mjs`; roadmap
“Layered governance and project contracts” done criteria.

Builder action: add project-scoped, contract-lifetime, owner-revision metadata
to every decision, enforce it in executable validation and schema, and cover
it in the focused schema/contract checks.

### F-006 — Full roadmap contract-to-campaign integration remains partial (P2, deferred)

The reviewed feature is a standalone contract compiler and receipt path. The
canonical Bootstrap setup flow still owns a broader output-gap/project-life/
delivery/runtime plan and does not make this project-contract payload the sole
end-to-end setup artifact. The feature inventory separates this capability from
dynamic conversation, four-library governance, and project-persistence lanes.

Why it matters: the roadmap Phase 1 exit gate is a coherent contract-to-
campaign workflow, not merely a callable compiler.

Disposition: defer as an explicitly partial roadmap dependency, not a blocker
for this bounded feature repair. No unrelated controller or campaign rewrite is
authorized by this audit. The candidate must not claim the full Phase 1 exit or
production activation; a later integration feature must bind it through the
typed project configuration and independent acceptance path.

## Quality and governance lenses

| Lens | Initial finding | Disposition |
| --- | --- | --- |
| Quality | Deterministic compilation and digests are present; semantic validator gaps are recorded in F-002/F-003. | Repair in this cycle. |
| Hygiene/minimality | The accepted snapshot has a focused slice, but the candidate lacks its materialized artifacts; do not import unrelated rapid-prototype lanes. | Repair only F-001 scope. |
| Security/privacy | Unsafe answer/discovery values are rejected or projected away; semantic tampering and discovery silence weaken the boundary. | Repair F-002/F-004; retain hostile tests. |
| Durability | Content-addressed sessions, contracts, and receipts exist; decision lifetime/revision semantics are missing. | Repair F-005. |
| Regression | Focused tests exist but are not run under the explicit pending-tests instruction. | Keep test status pending; run only when authorized. |
| Custody | Authority was read before write; accepted snapshot remains untouched; isolated candidate is the only write scope. | Repair F-001 and preserve source history. |
| Boundary | Host binding, protected-action defaults, inactive release posture, and fail-closed receipt path are present. | Preserve; do not expand into external actions. |
| Intent | Owner answers remain the source of intent and changes can request JSA reassessment; a rehashed semantic tamper could bypass meaning. | Repair F-002/F-003. |

## True blockers and recovery

No genuine external blocker is present. The missing candidate artifacts and
validation gaps are ordinary in-scope implementation work, not reasons to stop.
Functional tests are pending because the task explicitly requires them to
remain pending; that is a recorded verification state, not an external
capability failure.

If a later check finds a real source/host/custody mismatch, exact recovery is:
preserve the finding, do not write the affected artifact, re-read the bound
source and current worktree, and resume only from a fresh source-bound goal or
an explicit owner/authority decision. Do not use a private path, secret,
provider token, chat link, shell stand-in, or acceptance narration as a
substitute.

## Builder action register

The first repair pass is limited to F-001 through F-005:

1. materialize the reviewed feature and direct dependency files in this
   worktree;
2. harden conversation canonical-type/order/status validation;
3. harden semantic contract validation;
4. bind discovery conflict/unknown evidence to explicit open questions; and
5. add decision scope/lifetime/revision metadata with schema parity.

F-006 remains a typed deferred roadmap finding. After the repair pass, perform
a static self-audit, update this report with changed files and evidence, and
re-audit the repaired source before declaring a production candidate pending
functional tests.

## Builder repair pass 1 and static self-audit

Repair pass 1 was completed only in this isolated worktree. The accepted
authority snapshot was not targeted for writes.

### Changed files

Materialized from the reviewed authority snapshot:

- `docs/bootstrap-rapid-prototype-plan.md`
- `control/bootstrap-conversation.mjs`
- `control/bootstrap-compile-receipt.mjs`
- `schemas/bootstrap-answer.v1.json`
- `schemas/bootstrap-conversation.v1.json`
- `schemas/bootstrap-compile-receipt.v1.json`
- `tests/verify-bootstrap-project-contract.mjs`
- `tests/verify-bootstrap-project-contract-schema.mjs`

Feature source repaired in place:

- `control/bootstrap-project-contract.mjs`
- `schemas/bootstrap-project-contract.v1.json`
- `docs/feature-audits/BOOTSTRAP_PROJECT_CONTRACT/auditreport.md`

No unrelated files are present in the isolated candidate’s untracked change
set.

### Repairs applied

- F-001: materialized the reviewed source and direct dependencies so the
  candidate is reproducible in one writable worktree.
- F-002: added canonical answer-type/value validation, canonical question
  order, duplicate/missing order rejection, and status/completeness checking.
- F-003: added exact phase sequence/reference checks, goal-to-contract
  consistency checks, known/unique/canonical decision ordering, answer-bound
  decision references, typed phase conditions, and known/unique open-question
  identities.
- F-004: added safe fact-ID groups by epistemic class, an epistemic grouping
  digest, blocking conflict/unknown questions, and exact group/question
  consistency checks. Fact values and source locators remain excluded.
- F-005: added `PROJECT_CONTRACT` scope, `CURRENT_CONTRACT` lifetime, and
  `OWNER_ANSWER_REVISED_OR_INTENT_SCOPE_CHANGED` revision metadata to every
  compiled owner decision, with schema and executable validation parity.

### Static evidence

- JavaScript syntax: `PASS` for the compiler, conversation, receipt, and both
  focused test files using `node --check`.
- JSON parsing: `PASS` for the four contract/answer/receipt schemas.
- Schema repair parity: `PASS`; decision required/properties sets and discovery
  binding required/properties sets match, and the new metadata constants are
  schema-bound.
- Diff hygiene: `PASS` (`git diff --check`).
- Changed-path custody: `PASS`; the exact untracked set is limited to the
  eleven feature/dependency/report files listed above.
- Public-safety literal scan: `PASS` for absolute private path literals,
  private host identity environment names, and chat-link values in the
  materialized public source. The rejection regexes themselves are portable
  policy, not stored private values.
- The authority snapshot was read only throughout this repair pass; no
  external action, network, authentication, spending, publication, deployment,
  release, or activation was attempted.

Functional tests, schema validators requiring a runtime test harness, and the
broad verifier remain intentionally pending. Static evidence is not being
promoted to a functional pass by narration.

## Re-audit after repair pass 1

### Re-audited intended versus actual behavior

The repaired implementation now preserves the intended deterministic path:

`ordered owner answers → canonical conversation digest → typed contract →
safe discovery projection → explicit blocking questions → content-addressed
receipt`

The semantic checks now reject a rehashed invalid answer session, a rehashed
phase substitution, duplicate or unknown decision bindings, and discovery
group/question mismatches. The schema carries the new persisted fields. The
repair did not add provider access, external effects, project-specific policy,
private machine identity, or release authority.

### Re-audit findings

| Finding | Re-audit result | Evidence/status |
| --- | --- | --- |
| F-001 custody | Resolved | All declared feature/dependency artifacts are materialized in the isolated candidate; exact scope scan passes. |
| F-002 conversation integrity | Resolved pending functional execution | Static syntax and hostile fixture source are present; runtime test remains pending by instruction. |
| F-003 contract semantic integrity | Resolved pending functional execution | Static syntax/schema parity and rehashed-phase hostile fixture source are present; runtime test remains pending. |
| F-004 discovery uncertainty | Resolved pending functional execution | Group digest, explicit questions, and linkage checks are present in code/schema/test source; runtime test remains pending. |
| F-005 decision durability metadata | Resolved pending functional execution | Schema/executable required-field parity passes statically. |
| F-006 full contract-to-campaign integration | Deferred, unchanged | Broader roadmap work belongs to the separately inventoried integration/governance lanes; no production or activation claim is made here. |

### Remaining risks and unknowns

- Functional behavior has not been executed in this cycle. The focused tests
  are preserved as the next verification action.
- Full JSON Schema validation and the broad verifier are not claimed by the
  static checks.
- The standalone compiler still does not by itself satisfy the roadmap’s full
  contract-to-campaign Phase 1 exit gate; that remains an explicit partial
  capability and future typed handoff.
- No provider, deployment, release, activation, or production environment was
  inspected or configured.

### Production-readiness decision

Decision: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS` for this bounded
project-contract compiler slice. The candidate is ready for the required
focused functional and schema-runtime checks, but it is not a functional pass,
full roadmap acceptance, release candidate activation, or remote-delivery
claim. `2.1rc` remains prepared but inactive.

## Next action

Run the preserved focused contract/conversation/schema tests when the explicit
functional-test hold is lifted, then record their exact result and any bounded
repair as a new append-only cycle section. If they pass, hand off this
candidate with F-006 retained as deferred integration work. If they fail,
record the failure as a new puzzle, repair only that finding, and re-audit the
exact source again.

## Builder repair pass 2 and re-audit

The second bounded pass repaired two hostile variants discovered during the
first self-audit, without changing the feature boundary:

- normalized conversation and answer records now require the exact executable
  key sets already declared by their schemas, preventing hidden raw or private
  fields from travelling through a content-addressed session;
- discovery `CONFLICT` and `UNKNOWN` statuses must agree with their epistemic
  classes before projection, so a conflicting observation cannot be relabeled
  as an ordinary observation to avoid the blocking question path.

### Pass-2 evidence

- JavaScript syntax: `PASS` for all five materialized JavaScript files.
- JSON parsing: `PASS` for all four feature schemas.
- Schema/executable structural parity: `PASS` for decision metadata and the
  discovery binding/group/digest fields.
- Diff hygiene: `PASS`.
- Exact candidate scope: `PASS`; the eleven expected feature/dependency/report
  files remain the complete untracked change set.
- Audit-report safety scan: `PASS`; no private machine path, chat link,
  credential-shaped value, or provider token was introduced.

### Pass-2 re-audit decision

No new material finding remains inside the recorded feature boundary. F-001
through F-005 are resolved in source and covered by static hostile fixtures;
their functional status remains pending exactly as instructed. F-006 remains
the only deferred capability: broader contract-to-campaign integration and
full roadmap acceptance belong to separate inventoried work and are not
silently claimed here.

Current handoff state: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`.
The next action is still the preserved focused functional/schema test run when
the explicit hold is lifted. No true external blocker exists.

## CURRENT STATE — central intake projection

- candidate source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- candidate source tree: `f1b358d87e6a969fb9631e202a3d478540edd4d`
- source observation: `4109c2290c3ea904fd8c648ce11c75cf50183dfe39ffc3d771cc6c7ef231fa2e`
- handoff digest: `732ac4d4a8b9400aa270bd1b4fd21f7ebe5fbaa56038f6e185a976e535a56d4d`
- lifecycle: `CENTRAL_INTEGRATION_PENDING`
- current disposition: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`
- superseded identities: none; pre-integration central bytes are preserved in the feature custody directory
- unresolved material seams: broader contract-to-campaign integration (`F-006`); functional proof remains intentionally pending
- proof ceiling: static source, schema, hygiene, and privacy review only; no functional pass claimed
- downstream consumed: `false`
- immediate next action: central independently re-audit the intake, then preserve the functional-test hold before any task archival
