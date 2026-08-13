# Fail-closed Agent Spawner preparation

Agent Spawner never treats a partial role package as a spawn permission. For
each request it compiles the role, task, project-context slice, authority,
non-goals, model/duty, evidence contract, handoff, and completion definition;
then resolves the complete transitive block closure.

Every block must have an exact immutable identity, source and freshness proof,
applicability result, dependency and supersession state, privacy/redaction
proof, narrow authority, hostile fixtures, and independent acceptance. A
composition-level audit then rejects contradictions, authority overlap, seam
gaps, aliases, context leakage, model mismatch, impossible completion, unsafe
fallback, and non-deterministic handoff. A contradiction is returned as a typed
`CONTEXT_INCONSISTENCY_AWAITING_BOOTSTRAP` result; Bootstrap adjudicates it and
does not allow silent harmonization.

Failures return an exact preparation status and repair work plan. They never
create a seed, fork a working agent, or grant partial authority. Only an
accepted, content-addressed `ROLE_CONTEXT_MANIFEST` can yield
`SPAWN_PACKAGE_ACCEPTED`. A subsequent readback must match the role, task,
model, project/control-plane binding, manifest digest, no-subagents rule, and
first typed handoff. A mismatch returns `SPAWN_READBACK_FAILED`; a matching
readback may report `SEED_CREATED_IDLE` or `WORKING_AGENT_CREATED_READY`.

The ordinary worker model is exact `gpt-5.6-luna/max`. The only owner exception
is the permanent Agent Spawner/Compiler’s narrow context-extraction and
governance-block compilation duty at exact `gpt-5.6-sol/medium`, recorded in
its role manifest with cost boundary and Luna fallback. That exception does not
authorize Bootstrap or ordinary workers to change model or scope.
