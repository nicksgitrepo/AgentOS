# Synthetic Agent Spawner admission round trip

The permanent Agent Spawner/Compiler may use `gpt-5.6-sol/medium` only for
the explicit `CONTEXT_EXTRACTION_AND_GOVERNANCE_BLOCK_COMPILATION` duty with
the owner exception recorded in its role contract. Bootstrap and ordinary
working agents remain `gpt-5.6-luna/max`.

The portable transaction is fail-closed:

1. Extract source-backed claims into a digest-only typed receipt. Raw source is
   never retained in the receipt or role package.
2. Group claims by semantic key. A disagreement becomes a
   `agentos.context_inconsistency.v1` packet with `raw_admissible: false`.
3. Bootstrap adjudicates by human safety, verified law, current owner intent,
   accepted source truth, specificity, Charter/plan, then convenience. It also
   compares freshness, evidence, scope, supersession, generation, and commit.
   Missing or stale evidence yields `UNPROVEN_SOURCE_GAP`; equal material
   routes yield `OWNER_DECISION_REQUIRED` rather than silent harmonization.
4. Agent Spawner resolves the complete direct/transitive block closure and
   composition QA. Missing, stale, inapplicable, contradictory, duplicated,
   leaked, wrong-model, or unevaluated blocks return preparation/repair status;
   no partial package grants spawn authority.
5. Only a content-addressed `ROLE_CONTEXT_MANIFEST` yields
   `SPAWN_PACKAGE_ACCEPTED`. A simulated readback must match the manifest,
   model/duty, project control-plane reference, no-subagents rule, and first
   typed handoff. This breakpoint creates no task, seed, worktree, or
   activation.
6. Any governing block change emits
   `agentos.role_context_manifest_invalidation.v1`; the predecessor is frozen
   and the complete transitive closure must be rebuilt and independently
   accepted before a new manifest can exist.

The executable contract is `control/spawner-admission-roundtrip.mjs`, its
decision tree is `gates/spawner-admission.gate`, and its typed envelope is
`schemas/spawner-admission-roundtrip.v1.json`. The focused hostile verifier
`tests/verify-spawner-admission-roundtrip.mjs` uses only generic synthetic
fixtures and proves both repair convergence and all no-side-effect bounds.
