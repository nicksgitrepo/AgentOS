# Preserved platform handoff: 03-user-conversation


## Platform-foundation handoff — Cycle 1 / User Conversation — 2026-08-07

This is the platform-foundation-gate handoff requested after the lane audit.
It does not authorize product-feature implementation, feature-lane release,
activation, deployment, or external effects. The preceding audit and builder
history remain append-only evidence; this section records the platform
boundary and the controller gate for the current candidate.

### Handoff status

- `handoff_status`: `PRODUCTION_CANDIDATE_PENDING_TESTS`
- `lane`: `Cycle 1 / User Conversation`
- `gate`: `PLATFORM_FOUNDATION_GATE`
- `acceptance`: `false`
- `independent_check`: `PENDING`
- `feature_lane_release`: `BLOCKED_UNTIL_CONTROLLER_PLATFORM_MERGE`
- `activation`: `NOT_REQUESTED`
- `external_effects`: `FORBIDDEN`
- `schema_status`: `portable.platform_foundation_handoff.v1` is the proposed
  portable handoff shape for Controller binding; it must be reconciled with
  the repository’s registered contracts before merge.

### Source binding and custody

The candidate is bound to the read-only authoritative comparison baseline by
the following non-secret identity. Host-local paths and private identifiers
are intentionally omitted from this handoff.

- baseline commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- baseline tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- comparison result: authoritative worktree was inspected read-only and
  remains on the baseline; no authoritative file was edited by this lane
- current candidate working tree: dirty/untracked candidate; not yet a clean
  merge source
- candidate module:
  `control/rapid-prototype/user-conversation.mjs`
  sha256 `1ed923a93d5bac30ff2dc2d6dd2f83f3cf1d7386e4bdd3a19dd7b4e72b37c70c`
- candidate focused test:
  `tests/rapid-prototype/user-conversation.mjs`
  sha256 `68b124e7ed3b61ebd3647f86d50ad0e450f4e536323552d1ef421e4cdaeba77d`
- audit record:
  `docs/rapid-foundations/03-user-conversation-auditreport.md`; its digest
  must be recomputed after this append and after any custody operation
- authoritative direct-lane comparison remains the pre-repair implementation;
  the candidate hashes above must not be treated as authoritative until the
  Controller independently accepts a clean, exact source snapshot

### Shared skeleton

The User Conversation contribution belongs in the portable rapid-prototype
control skeleton as a pure contract boundary:

`source and authority readback -> bounded conversation turn -> owner surface
-> public-payload/security scan -> typed handoff -> independent audit`

The skeleton should keep the owner exchange, provenance, answer binding,
replay classification, unavailable/hard-stop behavior, and handoff metadata
inside the control boundary. A host or product adapter may provide transport,
durable storage, authentication, or rendering later, but those concerns must
remain behind typed contracts and must not be imported into the portable
kernel.

### Directory and file boundaries

- `control/`: portable runtime, governance, and contract logic. No product
  source, provider account, credential, deployment identity, or project policy.
- `control/rapid-prototype/`: the thin platform prototype boundary. The
  User Conversation implementation is limited to
  `user-conversation.mjs`; parent assembly and public rendering are separate
  integration surfaces.
- `tests/rapid-prototype/`: direct Node contract, hostile, hygiene, security,
  and verification checks. Tests must not become production dependencies or
  use synthetic success as acceptance.
- `docs/rapid-foundations/`: normative foundation intent, audit history,
  source-bound evidence, and handoffs. It is not a substitute for executable
  behavior or independent clearance.
- `schemas/`: registered portable schemas and digests. The candidate runtime
  schema identifiers listed below require Controller reconciliation/registration
  before they are treated as platform contracts.
- `control/rapid-prototype/index.mjs` and `ui-ux.mjs`: shared assembler and
  owner-surface boundaries. Any change there is outside this lane’s exact
  two-path implementation scope and needs its own admitted platform change.

No feature lane may place product routing, source mutation, provider calls,
or private project configuration in the User Conversation module or in the
portable skeleton directories.

### Technology-stack facts and recommendations

Confirmed facts from the current source:

- The lane is dependency-free ECMAScript module code executed directly by the
  host Node runtime; no npm workflow or package dependency is required.
- The lane uses a built-in cryptographic primitive for deterministic content
  digests and has no filesystem, network, subprocess, provider, or UI-runtime
  side effects.
- The public owner-surface boundary is plain structured data consumed by the
  existing owner-surface renderer; the renderer itself has fixed bounds and
  public-payload scanning rules.
- Focused and repository rapid-prototype checks were run as direct Node
  processes and passed before this handoff. Clean-snapshot, full campaign,
  and independent-controller checks remain pending.

Recommendations for the shared skeleton:

- Keep Node ESM plus direct Node verification as the platform baseline for
  this cycle; do not add npm or a UI framework to the portable kernel.
- Keep the owner-facing contract framework-neutral. A later UI adapter should
  consume `agentos.owner_surface.v1` and preserve status, one-question,
  option, next-step, and unavailable semantics without exposing internal
  fields.
- Keep persistence, transport, authentication, and any external provider
  behind host-owned adapters with explicit custody and retention contracts.
- Defer product framework selection and visual branding to the owner/design
  decision; neither belongs in this foundation gate.

### Routing and feature boundaries

User Conversation owns:

- one bounded owner question at a time;
- explicit states for proceed, puzzle, soft review, unresolved, unavailable,
  and hard stop;
- question-identity answer binding, answer provenance, source/authority checks,
  replay classification, safe-default provenance, and typed non-accepting
  handoff metadata;
- hostile handling for prompt injection, protected-action wording, unsafe
  defaults, source mismatch, unverified authority, missing evidence, and
  over-bounded input.

User Conversation does not own or perform:

- product feature routing or product workflow execution;
- authentication, authorization, spending, publication, deployment, deletion,
  source mutation, provider contact, or role/task creation;
- policy/source delivery mutation, durable owner-data retention, or UI
  framework behavior;
- release, activation, acceptance, or deployment decisions.

The parent assembler currently supplies generic options and reduces some
conversation fields when producing its delivery summary. That is a recorded
integration finding, not a repair made in this platform handoff. The admitted
assembler must carry the actual question-bound options, tradeoffs,
source/authority/evidence binding, answer/replay details, and typed handoff
without silently converting unresolved input into a safe default.

### Shared contracts and invariants

The candidate exposes or consumes these contract boundaries:

- candidate runtime identifiers: `agentos.user_conversation_turn.v1`,
  `agentos.user_conversation_replay.v1`, and
  `agentos.user_conversation_handoff.v1`;
- existing owner surface: `agentos.owner_surface.v1`;
- existing public safety boundary: `agentos.public_payload_scan.v1`;
- existing verification/handoff contracts, including
  `agentos.native_implementation_lane_handoff.v1` and
  `agentos.verification_handoff.v1`;
- source identity fields: exact source commit/tree, bounded source readback,
  authority status, evidence digest, and clean exact snapshot status.

Controller must register or reconcile the candidate identifiers rather than
accepting their string presence as schema completion. The shared invariants
are:

- source identity is exact and recomputed from the candidate snapshot;
- a clean exact source snapshot is required before the test gate;
- a turn has at most one actionable owner question;
- choices are bound to that question and include recommendation/tradeoff
  context where offered;
- `UNRESOLVED` cannot consume a default silently;
- replay is not authorization and protected actions require exact approval;
- the handoff is non-accepting until an independent check records clearance;
- raw owner text, private data, and unsafe presentation controls do not cross
  the public boundary;
- failure is fail-closed with an explicit next safe action.

### UI and design direction

Use a plain-language, owner-facing surface with short status/message/question/
next-step text, one question, and no hidden fields. Options should be
question-specific, bounded, and show a recommendation or tradeoff only when
that context is real. Unavailable and hard-stop states should explain the
safe next action without exposing internal source, role, tree, transport, or
authority details. The parent renderer’s current bounds and public scanner
remain required.

Accessibility, keyboard/select semantics, localization, visual tokens, and
brand treatment are not established by this lane and remain owner/design
decisions for the UI adapter. No visual or framework choice is a platform
acceptance claim.

### Security, privacy, and custody constraints

- Keep the authoritative comparison worktree read-only; never copy its private
  host path, secrets, account values, session records, or provider identity
  into the report, payload, or portable kernel.
- Bind the candidate by exact source commit/tree and artifact digests, then
  commit or otherwise record custody through the campaign’s normal evidence
  path before merge review. Recompute all bindings from the clean snapshot.
- Run the required source-snapshot, bounded-scan, focused-hostile, and full
  direct-Node sequence from that clean source. Self-acceptance is invalid.
- Keep the `2.1rc` path prepared but inactive until an explicit activation
  decision is recorded by the governing authority.
- Treat the parent public-payload scanner as a second boundary; lane-local
  checks do not waive integration scanning or independent audit.
- Do not release a feature lane, perform a protected action, or claim
  production acceptance from this handoff.

### Unresolved owner questions

These questions must be answered or explicitly deferred by the platform owner
before the corresponding boundary is finalized:

1. Which owner-facing transport and UI host will bind the framework-neutral
   owner-surface contract, and what accessibility target is required?
2. Is replay/provenance persistence platform-owned or host-owned, what is the
   retention/erasure policy, and who can inspect it?
3. What exact authority and approval path is required for protected actions,
   and what evidence makes that approval valid?
4. Which parent-assembler contract preserves question-bound choices,
   provenance, replay, source/authority/evidence, and the typed handoff?
5. Under what owner-approved conditions, if any, may a safe default be used,
   and how must its provenance be shown to the owner?
6. Which contract registry entry and digest policy will bind the three
   candidate User Conversation schema identifiers before merge?

### Controller gate and exact next action

The Controller must wait for every platform-foundation handoff, independently
audit the source-bound claims, merge exactly one clean platform tree, and only
then release feature lanes. The next admitted action is therefore:

1. collect all platform handoffs and reconcile their shared contracts and
   directory boundaries;
2. independently verify this candidate from a clean exact source snapshot,
   including the full direct Node and hostile sequence, parent integration,
   source/public-payload scans, custody, and schema registration;
3. merge one platform tree only if those checks clear, recording the exact
   commit/tree/digests and unresolved owner decisions;
4. keep feature-lane release blocked until that merge and clearance are
   recorded; do not create hidden tasks or begin product-feature work from
   this handoff.

**Platform handoff disposition:**
`PRODUCTION_CANDIDATE_PENDING_TESTS`; exact next owner is the Controller’s
independent platform audit and merge gate. No true external blocker was
observed; pending items are custody, schema reconciliation, parent integration,
full clean-snapshot verification, independent clearance, and owner decisions.

## Re-audit addendum — 2026-08-08

The Controller-applied LANE_03 repair remains
`PRODUCTION_CANDIDATE_PENDING_TESTS`. It does not claim production readiness,
acceptance, activation, release, or feature admission.

### Structured binding repair

`control/rapid-prototype/user-conversation.mjs` now accepts structured
`question_id` and `decision_ref` metadata and emits `question_binding` with
`BOUND` or `UNBOUND` status. When `requireQuestionBinding: true` is supplied,
an unbound question fails closed as `UNAVAILABLE` and cannot consume a safe
default or pass silently into handoff. Legacy question strings remain
compatible but are marked `UNBOUND` when binding is inspected.

The focused test now covers one bound question and the fail-closed unbound
path. Repair-specific functional and independent checks remain pending.

### Durable open platform decisions

| Question ID | Decision reference | Unresolved decision |
| --- | --- | --- |
| `UC-PLAT-UI-HOST` | `DECISION_UC_UI_HOST` | Owner-facing transport/UI host and accessibility target |
| `UC-PLAT-REPLAY-CUSTODY` | `DECISION_UC_REPLAY_CUSTODY` | Platform-versus-host replay custody, retention, and erasure |
| `UC-PLAT-ASSEMBLER` | `DECISION_UC_ASSEMBLER_BINDING` | Preservation of binding, provenance, replay, and typed handoff |
| `UC-PLAT-SAFE-DEFAULT` | `DECISION_UC_SAFE_DEFAULT` | Conditions and provenance required for an owner-approved safe default |

No owner answer is inferred or silently skipped. Raw owner text, private
paths, credentials, and session/transport details are not persisted.

### Source identity and proof ceiling

- Baseline commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- Baseline tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- Authority `pyramiddevelopment.md` SHA-256:
  `a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d`
- Foundation intent digest:
  `c9012a0283a25739a7a13c0251522e9749be2b57ab5e5fdeb12a6cf195e7c999`
- Applied conversation-module SHA-256:
  `30197a6f8063bfd6663b95ad6b76b89363d396afabd39401acb65675a4486009`
- Applied focused-test SHA-256:
  `a573976e9845f62f3fbf1a6159f9ce2f2d9d8bc542f2501fc7578942a91bfc2a`
- The candidate remains dirty/untracked with no local handoff commit or clean
  merge snapshot; these are the proof ceiling until Controller custody is
  independently recomputed.

### Controller-owned shared seam

The parent assembler at `control/rapid-prototype/index.mjs` remains unchanged
and Controller-owned. It must preserve structured question binding,
provenance, replay, and typed handoff data rather than reducing unresolved
questions to a generic fallback or summary.

Registered conversation schema/contract reconciliation and digest registration
also remain Controller-owned. This lane supplies no competing assembler or
schema implementation.

No npm command, functional test, commit, push, deployment, release, or archive
was performed.
