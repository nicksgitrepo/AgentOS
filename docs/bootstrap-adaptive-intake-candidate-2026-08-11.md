# Bootstrap adaptive intake candidate

Status: `READY_FOR_OWNER_REVIEW`

## Declaration

- Authorities checked: repository `AGENTS.md`, Bootstrap entrypoint and
  binding, owner-conversation contract, typed project-contract compiler,
  portability boundary, and current source identity.
- Task classification: portable Bootstrap behavior and contract hardening.
- Bounded outcome: ask project-building questions in a deterministic useful
  order, open only applicable specialist branches, and compile the answers
  into typed project context.
- Authority boundary: local AgentOS source, schemas, documentation, and tests
  only. No consumer-project adoption, provider binding, activation,
  publication, deployment, or public release.
- Non-goals: Memory repair, Specialist Block Library admission, release
  promotion, provider authentication, and product-specific policy.
- Stop condition: clean content-addressed candidate with focused positive,
  conditional, hostile, architecture, portability, and source-hygiene proof.
- Source inspected: baseline commit
  `5962a8667ba284104976ce9d9d46cc49a5d2933c` and its existing Bootstrap
  conversation, project contract, schemas, owner surface, docs, and tests.
- Preserved work: Memory, Agent Builder, Specialist Block Library, release,
  and consumer-project integrations remain unchanged.

## Audit findings repaired

1. The owner conversation was a fixed list. It had no deterministic
   applicability rule for project-specific depth.
2. Required questions placed behind optional questions could be displayed by
   the required-only surface and then rejected by the acceptance path as out
   of order.
3. The contract did not preserve enough typed context to route narrow
   specialists for backend/API, data, access, AI/search, integrations,
   hardware/realtime, commerce, or safety/regulatory work.
4. Existing-project invariants, technology constraints, operating conditions,
   quality priorities, workflow steps, and explicit acceptance conditions
   were not all load-bearing inputs.
5. Multi-select project signals had no canonical owner-facing representation.

## Candidate behavior

The default order is:

1. audience, outcome, and first useful result;
2. new/extend/repair/replace starting point;
3. allowed scope, non-goals, and existing invariants when applicable;
4. compact capability selection;
5. only the selected specialist branches;
6. first workflow, technology, operating conditions, quality, and acceptance;
7. hard and soft boundaries;
8. memory and delivery intent.

Conditional rules may reference only earlier questions. Multi-choice answers
are deduplicated and normalized into catalog order. `NONE` cannot be combined
with another capability. Revising a parent answer prunes child answers that
are no longer applicable. Unselected project-profile branches compile as
typed `NOT_APPLICABLE`, not as guesses.

The question catalog is a focused module separate from conversation state and
validation. Existing unconditional version-1 question maps remain valid; the
conditional field is additive and omitted when empty.

## Verification

Passed:

- all `verify-bootstrap-*` tests;
- adaptive Bootstrap happy-path, complex-project, existing-project, branch
  pruning, hostile-rule, and owner-surface fixtures;
- owner conversation surface;
- architecture hygiene and focused-module budgets;
- portability;
- source hygiene;
- README verification;
- exact normative binding readback with zero digest mismatches; and
- whitespace/error-marker checks.

Repository-wide verification retains three baseline failures outside this
candidate's custody. Each reproduced unchanged at baseline commit
`5962a8667ba284104976ce9d9d46cc49a5d2933c`:

- the bounded persisted-record privacy scan requires a private control
  evidence manifest that is not present in the portable checkout;
- project-memory replay rejects an existing synthetic conflict reference; and
- the project-memory store imports an export absent from its current module.

These ceilings do not touch Bootstrap files and were not repaired or hidden.
The candidate does not claim whole-repository or release clearance.

## Changed surfaces

- `control/bootstrap-question-catalog.mjs`
- `control/bootstrap-conversation.mjs`
- `control/bootstrap-owner-surface.mjs`
- `control/bootstrap-project-contract.mjs`
- Bootstrap conversation, owner-question, and project-contract schemas
- Bootstrap binding digests
- focused and adversarial Bootstrap tests
- Bootstrap and user-conversation documentation

## Disposition

`READY_FOR_OWNER_REVIEW`

The code is a production-ready Bootstrap candidate within the stated evidence
ceiling. Integration into a release, activation, and repair of inherited
Memory/private-control proof failures remain separate decisions.
