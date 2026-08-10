# Dynamic owner conversation integration intake

This record preserves the first source-bound feature handoff without claiming
that it has been consumed by the canonical merge tree.

```yaml
feature_id: DYNAMIC_OWNER_CONVERSATION
handoff_commit: 8b062cb
handoff_tree: 05fccaa
handoff_status: PRODUCTION_CANDIDATE_PENDING_TESTS
platform_intake: DEFERRED_NOT_APPLICABLE
downstream_consumed: false
canonical_integration: PENDING_OVERLAP_AUDIT
functional_tests: NOT_RUN_BY_INSTRUCTION
```

## Candidate boundary

The handoff changes the Bootstrap conversation floor, dynamic question-map
validation, owner-surface projection, typed replay/handoff records, and the
focused verifier. The following repository-relative paths are part of the
source-bound candidate:

```text
control/bootstrap-compiler.mjs
control/bootstrap-conversation.mjs
control/bootstrap-owner-surface.mjs
docs/rapid-foundations/03-user-conversation.md
schemas/bootstrap-answer.v1.json
schemas/bootstrap-binding.v1.json
schemas/bootstrap-conversation-handoff.v1.json
schemas/bootstrap-conversation-replay.v1.json
schemas/bootstrap-conversation.v1.json
schemas/bootstrap-owner-question.v1.json
schemas/bootstrap-plan.v1.json
tests/verify-all.mjs
tests/verify-bootstrap-conversation-contract.mjs
```

## Canonical overlap disposition

The canonical merge tree already contains dirty Bootstrap conversation,
owner-surface, compiler, plan, binding, and focused-verifier files. Therefore
the candidate must not be applied as a wholesale replacement. The two new
conversation handoff/replay schemas have been preserved in the canonical tree;
the overlapping implementation files remain pending semantic merge.

Required merge order:

1. Preserve the current canonical bytes and record their content digests.
2. Compare the candidate’s question-map, answer normalization, prompt-floor,
   disposition, replay, and handoff behavior against the canonical versions.
3. Merge only compatible behavior, retaining stricter privacy and custody
   rules from either side.
4. Reconcile the Bootstrap compiler’s single conversation-floor authority and
   bind the handoff/replay contracts without duplicating or weakening it.
5. Update the normative binding only after the merged source contracts settle.
6. Keep the feature task and worktree retained until the merged handoff is
   independently audited and recorded as consumed.

## Non-negotiable acceptance conditions

- Raw owner text, private paths, credentials, task IDs, and chat links remain
  rejected or absent from persisted records.
- One plain-language owner question is exposed per turn.
- Dynamic maps, answer order, replay, handoff, source identity, and digests are
  mutually bound.
- Protected actions retain explicit owner approval.
- Functional verification remains pending and is not represented as passed.
- No platform task is created from this feature alone; only a proven
  cross-feature seam may enter platform integration.
