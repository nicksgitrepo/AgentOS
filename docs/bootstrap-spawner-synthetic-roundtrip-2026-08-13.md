# Bootstrap synthetic Agent Spawner breakpoint — 2026-08-13

Status: `SYNTHETIC_SPAWNER_ROUNDTRIP_VERIFIED`; real Wiki intake and permanent
role creation remain off.

Candidate identity: branch `codex/bootstrap-multirepo-discovery-fix`, commit
`e69b48dc77bc755405f39f0016549f308b899b61`, tree
`df321d1d4b365e02a810aeaebbe5bddff4768569`, pushed to the matching origin
branch. This checkpoint is read-only with respect to all source and consumer
repositories.

Evidence is produced by the generic fixture verifier:

- Sol/medium extraction is accepted only for the narrow owner-authorized
  Agent Spawner duty and retains digests, not raw source.
- Two claims sharing a semantic key become a typed contradiction packet and
  are rejected by seed admission until Bootstrap adjudicates them.
- Higher-authority owner intent, explicit supersession, and stale/unproven
  source-gap dispositions are deterministic and content-addressed.
- Missing/transitive blocks, stale blocks, scope excess, context leakage,
  unsupported applicability, conflicts, aliases, raw contradictions, and
  model mismatch remain fail-closed.
- A repaired generic catalog converges to `SPAWN_PACKAGE_ACCEPTED`; simulated
  readback checks manifest digest, model/duty, opaque control-plane binding,
  no-subagents, and the first typed handoff. No real seed or working task is
  created.
- Changing a governing block emits an invalidation receipt and requires a
  complete rebuild.

Focused commands:

```text
node tests/verify-spawner-admission-roundtrip.mjs
node tests/verify-spawn-preparation.mjs
node tests/verify-context-block-intake.mjs
```

The evidence ceiling is synthetic fixtures only. The real Canon/Wiki source
train remains a separate later typed intake, and no consumer repository or
source/destination path was touched.

Next canonical breakpoint: overseer review of this accepted synthetic package,
then the permanent Agent Spawner admission/readback gate. Do not ingest the
real Wiki or create/activate a permanent role until that gate is independently
accepted.
