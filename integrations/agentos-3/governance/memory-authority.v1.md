# AgentOS 3 memory authority v1

Status: `P0_CANDIDATE_INACTIVE`

Version: `1.0.0`

This contract is portable, project-agnostic, default-off, and test-only. It
does not activate a provider, adopt a consumer, migrate live data, deploy, or
promote a release.

## Canonical taxonomy

AgentOS uses exactly five canonical memory types:

- `EPISODIC` records bounded observations or evidence from an occurrence.
- `SEMANTIC` records durable facts, context, references, maps, and learned
  meaning.
- `PROCEDURAL` records repeatable methods.
- `GOVERNANCE` records decisions, policy, invalidation, and conflict state.
- `WORKING_TASK` records current goals and bounded task-continuity context.

The canonical type never erases the source system or source category. Every
mapping object retains both fields, so many-to-one classification remains
lossless. Reverse interpretation without those source fields is forbidden.

### Legacy project-memory mapping

| Source category | Canonical type |
| --- | --- |
| `PROJECT_CONTEXT` | `SEMANTIC` |
| `GOAL` | `WORKING_TASK` |
| `DECISION` | `GOVERNANCE` |
| `REPOSITORY_MAP_REF` | `SEMANTIC` |
| `HANDOFF` | `WORKING_TASK` |
| `POLICY_REF` | `GOVERNANCE` |
| `INVALIDATION` | `GOVERNANCE` |
| `CONFLICT` | `GOVERNANCE` |

### Memory M2 mapping

| Source category | Canonical type |
| --- | --- |
| `decision` | `GOVERNANCE` |
| `fact` | `SEMANTIC` |
| `procedure` | `PROCEDURAL` |
| `lesson` | `SEMANTIC` |
| `evidence` | `EPISODIC` |
| `reference` | `SEMANTIC` |

The executable mapping compares its tables with the exported legacy and M2
category lists when the module loads. A missing, extra, unknown, or altered
category fails closed.

## One project, one memory author

One typed binding selects either legacy project-memory or Memory M2 for a
project and authority epoch. The non-selected authority must be `DISABLED`.
There is no state in this contract where both can write.

The AgentOS 3 M2 adapter requires all of the following before initialization
or reopen:

1. a current externally verified test capability;
2. a typed binding selecting Memory M2 and disabling legacy project-memory;
3. external readback of that exact content-addressed binding; and
4. one matching signed `MEMORY_AUTHORITY_BOUND` event in the M2 ledger.

Every exposed adapter call rechecks the capability, external authority
readback, and signed ledger binding. Missing, competing, altered, expired, or
unverified authority stops the call without invoking the requested operation.

## Adapter surface

The guarded adapter exposes M2 records, run workspace, current projection,
agent roster, rethread, run recovery, and head recovery. The returned project
view exposes verification only; raw writable M2 project custody is not returned
through this adapter.

Migration, handoff journal, and successor transfer are explicit interface
stubs. They throw typed not-implemented errors. Classifying a legacy `HANDOFF`
record as `WORKING_TASK` does not implement or authorize a new journal or a
successor transfer.

## Migration and invalidation

Migration mode remains `NONE`. A later migration implementation must freeze
the source read-only, map every source category while retaining source
identity, prove zero unmapped/lossy/conflicting entries, invalidate source
derived projections, obtain a bound owner switch decision, and only then make
the target authoritative. Dual writes, partial switches, inferred categories,
and silent drops are forbidden.

An invalidated source record invalidates its declared descendant closure and
requires derived projections to rebuild. A category-map change invalidates all
mapped projections and requires explicit reclassification. An authority-
binding change stops writes until a new exclusive epoch is admitted. An
aborted migration leaves the target non-authoritative and invalidates staged
output. Unknown or conflicting input produces no write.

## Evidence ceiling

The deterministic tests establish this P0 module and its local inactive
adapter behavior. Independent memory-authority clearance, real-data migration,
handoff journal, successor transfer, consumer adoption, provider activation,
release promotion, and public release remain outside the evidence.
