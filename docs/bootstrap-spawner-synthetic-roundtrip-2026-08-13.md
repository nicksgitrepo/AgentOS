# Bootstrap synthetic Agent Spawner breakpoint — 2026-08-13

Status: `SYNTHETIC_SPAWNER_ROUNDTRIP_VERIFIED`; real Wiki intake and permanent
role creation remain off.

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
