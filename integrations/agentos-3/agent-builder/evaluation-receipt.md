# Candidate Evaluation Receipt — Semantic Correction

Receipt version: `context-block-semantic-correction.v0.1`

Receipt state: `EVALUATION_CANDIDATE_READY_FOR_INDEPENDENT_RERUN`

Model/reasoning requirement: `gpt-5.6-luna / max`

Package posture: `CANDIDATE_PACKAGE / NOT_ADMITTED / NOT_ACTIVATED`

## Scope

This receipt records deterministic local structural and semantic checks for the owner-side correction. It does not claim full utility/harm evaluation, domain certification, admission, adoption, activation, or runtime usability.

## Corrective assertions

- Task IR compilation unresolved fields must equal the actual unresolved field ledger exactly; omission and addition both fail closed.
- Context blocks must declare empty `authorityEffect.grants`.
- Candidate context blocks must use current source records, complete provenance, scoped claims, versioned revisions, and valid digests.
- Candidate lifecycle state must remain `candidate` or `research_memo`.
- Secrets and protected-data classes/redactions are prohibited.
- Loading token components must fit the declared `maxTokens` budget.
- A positive lazy-resource budget requires resolvable lazy resources, preserving progressive loading boundaries.

## Reproducible commands

Run from the package directory:

```text
python3 validate_task_ir.py
python3 validate_context_blocks.py
python3 -m json.tool task-ir.schema.json
python3 -m json.tool context-block.schema.json
```

## Results

Task IR validator:

```text
PASS invalid-authority-escalation.json: rejected [AUTHORITY_ESCALATION]
PASS invalid-context-budget-overflow.json: rejected [CONTEXT_BUDGET_OVERFLOW]
PASS invalid-contradiction.json: rejected [UNRESOLVED_CONTRADICTION]
PASS invalid-missing-protected-decision.json: rejected [MISSING_PROTECTED_DECISION]
PASS invalid-omitted-unresolved.json: rejected [UNRESOLVED_FIELD_LEDGER_MISMATCH]
PASS invalid-stale-block.json: rejected [STALE_BLOCK]
PASS valid-task-ir.json: accepted
RESULT PASS 7/7 deterministic cases
```

Context-block semantic validator:

```text
PASS invalid-authority-grants.json: rejected [AUTHORITY_GRANTS_NONEMPTY]
PASS invalid-budget-overflow.json: rejected [BUDGET_OVERFLOW]
PASS invalid-duplicate-claim-id.json: rejected [DUPLICATE_CLAIM_ID]
PASS invalid-lifecycle-admitted.json: rejected [LIFECYCLE_CANDIDATE_ONLY]
PASS invalid-missing-digest.json: rejected [DIGEST_MISSING]
PASS invalid-missing-provenance.json: rejected [PROVENANCE_MISSING]
PASS invalid-missing-scope.json: rejected [SCOPE_MISSING]
PASS invalid-missing-version.json: rejected [VERSION_MISSING]
PASS invalid-progressive-loading.json: rejected [PROGRESSIVE_LOADING_BOUNDARY]
PASS invalid-protected-data.json: rejected [PROTECTED_DATA_PROHIBITED]
PASS invalid-secrets-allowed.json: rejected [SECURITY_SECRET_PROHIBITED]
PASS invalid-stale-source.json: rejected [STALE_SOURCE]
PASS valid-context-block.json: accepted
RESULT PASS 13/13 context-block semantic cases
```

Both JSON schemas parsed successfully with the standard-library JSON parser.

## Independent rerun boundary

The candidate is ready for an independently routed utility/harm rerun using a frozen block digest, task suite, model/harness profile, evaluator, and admission oracle. No such full evaluation was performed by this receipt. Owner design-thread content remains design intent only and is not admitted authority.
