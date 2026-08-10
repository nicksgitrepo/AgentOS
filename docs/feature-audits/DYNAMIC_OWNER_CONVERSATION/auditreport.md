# DYNAMIC_OWNER_CONVERSATION audit report

## Audit contract and baseline

- Feature: `DYNAMIC_OWNER_CONVERSATION` — Dynamic Owner Conversation and Question Map.
- Audit mode: complete audit -> repair -> self-audit -> re-audit.
- Authority baseline: current accepted merge worktree, read-only; public source
  readback recorded by the accepted foundation receipt as commit
  `590c07ddd4be7a8c24727c24b40808e44ca7357d` and tree
  `f1b358d87e6a969fb9631e202a3d478540edd4d9`.
- Writable scope: this isolated worktree only.
- Release status: `2.1rc` remains `PREPARED_NOT_ACTIVATED`.
- Functional tests: pending by task instruction; no npm use.

The inventory declares these feature sources: `docs/rapid-foundations/03-user-conversation.md`,
`schemas/bootstrap-conversation.v1.json`, and owner-linked research records.
The accepted merge is dirty, so its worktree state is treated as a source readback
only; no authority file is modified by this task.

## Intent and expected behavior readback

The user-conversation foundation requires a plain, bounded owner exchange that:

1. starts from already-known typed context and asks the earliest material unknown;
2. presents exactly one understandable question per turn;
3. binds an answer to the exact question, preserving ambiguity as unresolved;
4. separates owner decisions, observed facts, recommendations, and unknowns;
5. pauses only the dependent outcome when context or authority is unavailable;
6. replays the proposed outcome and boundaries before handoff without treating the
   replay as protected-action approval; and
7. hands off the minimum typed, source-bound, secret-free summary without raw
   conversation text.

The surrounding Bootstrap contract reinforces the same rule: discovery, safe
defaults, and existing owner input should remove unnecessary questions; the
question planner owns the earliest unresolved material gap; protected actions,
secrets, private records, topology substitutions, and source mismatches fail
closed. The prepared release line is not activated by this feature.

## Research and evidence readback

The local accepted-merge source contains the foundation clearance and its eight
conversation hostile cases (`UC-H01` through `UC-H08`), plus the focused-check
ideas (`UC-C01` through `UC-C08`). The inventory’s
`research-records-linked-by-owner` entry is an owner-linked source alias, not a
public file in this repository. No raw owner research or private conversation is
assumed, copied, or persisted. This is an evidence unknown, not an external
blocker: a future owner-linked record can be supplied as a typed, secret-free
digest or redacted fact when it is needed.

## Initial implementation audit — 2026-08-07

### What is present

- `control/bootstrap-conversation.mjs` provides a fixed ten-question catalog,
  text/boolean/choice parsing, normalized owner answers, answer digests,
  replay handling, required-question status, intent/scope reassessment marking,
  and session digest validation.
- `control/bootstrap-owner-surface.mjs` projects prompts and numbered choices,
  hides machine fields, validates a public digest, and rejects internal
  vocabulary and unsafe owner input.
- `schemas/bootstrap-conversation.v1.json`,
  `schemas/bootstrap-answer.v1.json`, and
  `schemas/bootstrap-owner-question.v1.json` describe the transport shapes.
- `tests/verify-bootstrap-conversation-contract.mjs` covers the owner surface,
  text/choice/boolean parsing, invalid replies, digest tampering, schema IDs,
  and a first accepted answer.
- The broader Bootstrap compiler has a one-question `owner_questions` projection
  and a coverage-derived pending-question list, but its compiler catalog is a
  separate source from the project-contract conversation catalog.

### Recorded findings

#### `DOC-001` — high — fixed question map is not context/digest bound

Evidence: the accepted `createBootstrapConversation` constructor accepts only a
safe project label and an optional prior contract digest; the question catalog is
module-constant and `nextBootstrapQuestion` walks it in declaration order. The
conversation schema has no question-map payload or question-map digest. The
optional review-interval question is therefore surfaced by default even when no
owner choice is needed, and known discovery/compiler facts cannot be seeded to
avoid repetition.

Why it matters: this violates the earliest-material-unknown rule, makes replay
dependent on mutable code rather than the exact map used for the turn, and allows
the project-contract and full Bootstrap catalogs to drift.

Repair action: bind a validated, owner-safe question map into the session, allow
typed known answers to seed that map without raw text, default optional questions
out of the next-turn path, and expose a deterministic map digest for replay and
handoff.

#### `VAL-002` — high — session validation authenticates bytes but not meaning

Evidence: the accepted validator checks the answer digest and that an answer is
marked `CONFIRMED`/`OWNER`, but it does not re-run the question’s type normalizer.
It also checks that `answer_order` entries exist without requiring uniqueness or
complete coverage, and it does not derive `status` from the required resolved
answers.

Why it matters: a content-addressed session can still contain a wrong choice,
wrong value type, duplicate or omitted ordering entry, or a forged
`READY_FOR_CONTRACT` state. Downstream contract compilation would receive a
cryptographically stable but semantically invalid conversation.

Repair action: validate every answer against the bound question definition,
enforce answer-order set equality and uniqueness, and require status to match the
resolved required-answer set.

#### `MAP-003` — medium — duplicate catalogs have no parity proof

Evidence: the owner-surface adapter reads `control/bootstrap-conversation.mjs`,
while the broader Bootstrap planner reads its own `BOOTSTRAP_QUESTIONS` catalog
from `control/bootstrap-compiler.mjs`. No shared map digest or adapter contract
binds these catalogs. The two catalogs already use different IDs and answer
shapes for overlapping owner intent.

Why it matters: a question can be plain and valid in one route but missing,
reordered, or technically shaped in the other. The owner can answer a surface
that the compiler cannot safely bind.

Repair action: add an explicit map-adaptation/parity boundary for the project
conversation route and a focused parity check; do not merge the distinct
full-plan authority into the project-contract schema.

#### `SURFACE-004` — medium — typed unavailable and handoff states are incomplete

Evidence: invalid replies return a generic retry object, but the conversation
session has no explicit unavailable/hard-stop disposition, no typed replay summary,
and no map-bound handoff record. The separate rapid-prototype turn helper covers
some unavailable and hard-stop rendering, but it does not bind this session’s
answers or question map.

Why it matters: missing context, protected-action requests, and a final replay can
be mistaken for an ordinary question retry or a ready contract. The dependent
outcome cannot be held with an exact recovery action.

Repair action: add a compact, typed session disposition/replay helper that keeps
raw input out of state, distinguishes unresolved from unavailable/hard-stop, and
binds the next action to the session/map digest. External effects remain out of
scope.

#### `TEST-005` — medium — focused coverage does not exercise hostile map/state paths

Evidence: the focused verifier does not cover dynamic map selection, map drift,
semantic answer tampering, duplicate/missing answer order, optional-default
suppression, seeded known answers, prompt-injection text, or explicit unavailable
and hard-stop handoff behavior.

Why it matters: the highest-risk invariants are untested and functional readiness
cannot be claimed.

Repair action: add deterministic focused assertions for each repaired invariant;
leave execution pending as instructed.

## Initial quality and boundary assessment

| Lens | Initial result | Evidence / concern |
| --- | --- | --- |
| Quality | `PARTIAL` | Small host-independent modules exist, but semantic validation and typed state coverage are incomplete. |
| Hygiene | `PARTIAL` | Raw replies are not retained, but the public state/schema contract is not yet complete for map binding. |
| Minimality | `PARTIAL` | The fixed route is small, yet it asks an optional question unconditionally and duplicates catalog authority. |
| Security | `PARTIAL` | Unsafe text patterns and public-surface vocabulary checks exist; map/context and hard-stop binding are incomplete. |
| Privacy | `PASS_WITH_GAP` | Raw conversation is discarded and public records are digest-oriented; owner-linked research is intentionally absent. |
| Durability | `PARTIAL` | Session digests exist, but replay is not bound to an immutable question map. |
| Regression | `PENDING` | Functional tests are intentionally not run. |
| Custody | `PASS` | No external action, provider, credential, or child/worker creation is present in this feature slice. |
| Boundary | `PARTIAL` | Owner-surface hiding is present; unavailable/protected-action disposition is not bound into the session. |
| Intent | `PARTIAL` | Reassessment marking exists, but context-driven earliest-unknown selection is not represented by the session. |

## Initial production readiness

`NOT_READY_FOR_PRODUCTION`. The feature is a useful local candidate with
functional tests pending, but `DOC-001`, `VAL-002`, `MAP-003`, `SURFACE-004`, and
`TEST-005` remain open. There is no genuine external blocker. The exact recovery
for the owner-linked research unknown is to supply only a redacted typed record
or digest; no private path, credential, provider token, or chat link is needed.

## Builder action after initial audit

Repair only the findings recorded above in this isolated worktree. Preserve this
initial audit section unchanged, add each repair and re-audit result below it,
keep `2.1rc` inactive, and leave functional test execution pending. The next
action is to implement the bound dynamic map and semantic state validation first,
then add the typed disposition/handoff and focused hostile assertions.

## Repair pass 1 — 2026-08-07

Only the recorded findings were repaired in this isolated worktree. The initial audit
section above is preserved as the resolved-history record.

### Repairs applied

- `DOC-001` is fixed by `control/bootstrap-conversation.mjs`. A conversation now
  carries a validated question map and `map_sha256`; prompts, kinds, choices,
  defaults, and requiredness are normalized before binding. Typed discovery,
  compiler, and owner answers may seed the map without storing raw replies.
  Required questions drive the next turn, optional questions are suppressed by
  default, and the session binds the project label, prior contract digest, map,
  answer order, and session digest.
- `VAL-002` is fixed by semantic answer reconstruction. Validation re-runs the
  question-specific normalizer, checks the normalized answer digest, rejects
  duplicate or incomplete answer order, derives readiness from resolved required
  answers, and rejects drifted maps. A self-audit also corrected numeric choice
  normalization so a typed value such as a 15-minute default cannot be confused
  with an option number; non-finite numeric choice values are rejected.
- `MAP-003` is fixed at an explicit boundary. `control/bootstrap-owner-surface.mjs`
  renders from the bound dynamic map and validates prompt, one-question, and
  machine/owner-choice parity when adapting a broader Bootstrap question plan.
  The two authorities remain separate; the adapter does not merge the full-plan
  catalog into the project-contract map. The Bootstrap compiler now publishes and
  validates the same plain-language conversation floor, and the plan contract
  records that floor.
- `SURFACE-004` is fixed with typed `ACTIVE`, `UNAVAILABLE`, and `HARD_STOP`
  dispositions, safe recovery actions, generic retry text, a map/session-bound
  replay record, and a source-binding-aware typed handoff. Raw owner text is not
  persisted and protected-action approval remains explicitly owner-bound.
- `TEST-005` is repaired in scope by adding deterministic focused assertions for
  dynamic map projection, seeded answers, optional suppression, reassessment,
  semantic tampering, answer-order tampering, map drift, prompt-injection text,
  unavailable/hard-stop behavior, replay, handoff, and schema identity. The
  focused verifier is included in `tests/verify-all.mjs`.

### Changed files

- `control/bootstrap-conversation.mjs`
- `control/bootstrap-owner-surface.mjs`
- `control/bootstrap-compiler.mjs`
- `schemas/bootstrap-answer.v1.json`
- `schemas/bootstrap-conversation.v1.json`
- `schemas/bootstrap-conversation-handoff.v1.json`
- `schemas/bootstrap-owner-question.v1.json`
- `schemas/bootstrap-plan.v1.json`
- `schemas/bootstrap-binding.v1.json`
- `docs/rapid-foundations/03-user-conversation.md`
- `tests/verify-bootstrap-conversation-contract.mjs`
- `tests/verify-all.mjs`

## Self-audit and re-audit pass 1

### Evidence

- JavaScript syntax checks pass for the repaired controllers, compiler, focused
  verifier, and aggregate verifier.
- JSON parsing passes for all feature contracts, the Bootstrap plan contract, and
  the binding contract.
- All 144 normative binding digests match their files.
- `git diff --check` passes.
- A portability scan found no stored private machine path, credential, provider
  token, task identity, or private/chat link in the feature artifacts. The only
  `file://`/chat-link text is a generic rejection pattern in code, not a stored
  location or link.
- The accepted merge worktree was read-only input; this worktree contains the
  only changes made by this task. The accepted merge remains the authoritative
  baseline and `2.1rc` remains `PREPARED_NOT_ACTIVATED`.
- Functional tests were not executed, as required. No npm command was used.

### Re-audited lens findings

| Lens | Re-audit result | Finding |
| --- | --- | --- |
| Quality | `PASS_WITH_TEST_GAP` | Bound map, typed state, semantic validation, and owner projection are now explicit; execution evidence is pending. |
| Hygiene | `PASS` | Raw replies are normalized and discarded; public surfaces omit machine fields and unsafe vocabulary. |
| Minimality | `PASS` | One question is exposed per turn, optional questions stay hidden by default, and the compiler/catalog split has an explicit adapter boundary. |
| Security | `PASS_WITH_TEST_GAP` | Prompt/value safety, map drift, semantic tampering, dispositions, and protected-action approval are fail-closed in code; runtime test evidence is pending. |
| Privacy | `PASS` | Handoffs carry typed IDs, digests, and source object IDs only; raw owner text and private research are not persisted. |
| Durability | `PASS_WITH_TEST_GAP` | Map, answer, session, replay, and handoff digests provide resumable custody; functional replay evidence is pending. |
| Regression | `PENDING` | The focused verifier is wired into the aggregate suite but has intentionally not run. |
| Custody | `PASS` | No external side effect, provider, credential, child agent, or unrelated project was used. |
| Boundary | `PASS_WITH_TEST_GAP` | Unavailable and hard-stop outcomes are typed and recoverable without pretending readiness; runtime verification is pending. |
| Intent | `PASS_WITH_TEST_GAP` | Earliest unresolved selection, known-answer seeding, reassessment, and owner replay are represented; execution evidence is pending. |

### Remaining findings and readiness

- `TEST-005` remains open only as an execution gate: functional verification is
  pending by instruction. It is not treated as a code gap or a genuine external
  blocker.
- The inventory’s owner-linked research alias has no public raw record in the
  accepted merge. This remains an evidence unknown, not a blocker. Exact recovery,
  if needed, is for the owner to provide a redacted typed fact or content digest;
  no private path, credential, provider token, or chat link is required.
- No new implementation finding survived the self-audit/re-audit pass.

Current readiness is `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`: the repaired
feature is suitable for focused and aggregate functional verification, but it is
not declared released or activated. `2.1rc` stays inactive.

## Exact handoff and next action

- Handoff state: production candidate pending functional tests.
- True blockers: none. The absent owner-linked research record is recoverable
  through a redacted typed fact/digest, and test execution is intentionally
  deferred rather than blocked.
- Next action: run `tests/verify-bootstrap-conversation-contract.mjs` and the
  aggregate verifier in an authorized test pass, then re-audit any failure and
  repair only a newly recorded finding. Keep the release candidate inactive until
  that evidence and the separate activation decision exist.

## CURRENT STATE — central intake projection

- candidate source commit: `8b062cb561bc53b2f339b7982e525d0b68420018`
- candidate source tree: `05fccaa47787a1e7d1bba6b05ddf692d9574cc81`
- report commit: `14365233dccd8f3351ad48f75ffac7e789d892c5`
- handoff receipt: `docs/dynamic-owner-conversation-integration-receipt-2026-08-09.md`
- lifecycle: `CENTRAL_INTEGRATED_PENDING_INDEPENDENT_REAUDIT`
- current disposition: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`
- superseded identities: pre-integration central bytes are preserved in the feature custody directory
- unresolved material seams: semantic merge preserved the newer central compiler/plan/binding; owner-linked research alias remains an evidence unknown
- proof ceiling: static source, schema, hygiene, and privacy review only; no functional pass claimed
- downstream consumed: `false`
- immediate next action: central independently re-audit the integrated boundary and preserve the functional-test hold before any task archival
