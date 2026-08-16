# Project Import, Normalization, and Audit

Status: `PREPARED_NOT_ACTIVATED`

Project import is one typed Bootstrap decision, not a second operating system.
The available modes are:

| Mode | Meaning |
| --- | --- |
| `ADOPT_IN_PLACE` | Keep the source structure and history; bind governance around it. |
| `CLEAN_COPY` | Create a separate destination while preserving behavior and naming. |
| `NORMALIZE_AND_AUDIT` | Create a separate destination, normalize structure and names, run the Controller-derived audit/repair pyramid, and cut over only when accepted. |
| `RECONSTRUCT_FROM_INTENT` | Use the source as behavioral reference while constructing a clean destination and auditing it. |

Product source files remain untouched until an exact, reversible cutover. The
only pre-cutover write permitted for `ADOPT_IN_PLACE` is the deterministic
preservation sidecar under the reserved AgentOS import root. Before any import
build or refactor, the controller creates and verifies:

```text
source-preservation.zip
source-preservation.manifest.json
source-preservation.index.jsonl
source-preservation.receipt.json
import-exclusions.md
```

The archive contains exact bytes for preservable regular files. Generated
builds, dependency installations, caches, temporary files, environment files,
credential-bearing material, symlinks, and unsafe filesystem objects are
excluded or rejected according to their type, and every exclusion is recorded.
The source is re-observed before publication.

Bootstrap does not decide the imported project's final roster. It preserves the
source, binds owner intent and boundaries, and seals the typed handoff. The
persistent Controller then discovers the source-bound architecture, goals,
features, environments, hardware constraints, applicable standards, and known
evidence gaps. From those inputs it deterministically produces:

- the architecture graph and Platform ownership map;
- one functionality lane for every reachable feature;
- applicable language, runtime, data, experience, security, privacy,
  operations, assurance, provenance, and domain-specialist roles;
- an ordered campaign roadmap, resource policy, and waves of at most six
  cognitive lanes; and
- exact entry, integration, re-audit, rollback, and replan gates.

These four disciplines remain mandatory minimum coverage, not a fixed roster:

1. `FUNCTIONALITY`
2. `DESIGN_UI_SHELL_NAVIGATION`
3. `SECURITY`
4. `CODE_QUALITY_HYGIENE`

The three Product roots remain exactly Function Requirements, Design Bible,
and Security. Code quality is an audit discipline, not a fourth acceptance
root. The Controller expands those roots into the smallest project-applicable
specialist set. It may follow evidence across component seams, but each role
retains narrow audit authority and exact custody.

Every wave follows the same acceptance pyramid:

1. specialists audit their complete lanes and produce typed findings;
2. governed repair writers create isolated candidates;
3. the owning Platform roles review, test, integrate, and hand off accepted
   candidates;
4. the Central Integrator converges accepted Platform handoffs; and
5. independent specialists re-audit the resulting cumulative candidate.

The Agent Spawner compiles only roles requested by the Controller. It must
select a dependency-complete block set, source-lock it, run independent QA,
and return `NOT_READY` while any required block is incomplete. Seeds are
immutable checkpoints and never work; only governed clones work. While the
current wave runs, the Spawner prepares the next two eligible waves.

Routine gate passes are event-driven and automatic. Before a Controller turn
ends, it starts the next eligible transition or persists an exact resumable
blocked state after one bounded recovery. Owner review is reserved for direct
protected interaction, destructive or irreversible user-work risk, material
unexpected cost/legal/safety risk, production or public release, and genuine
route-changing equal-authority conflicts. It is not a routine import phase.

Cutover requires exact source, destination, candidate, and rollback identity.
Any material compatibility, Function, Design Bible, Security, or owner-boundary
failure stops only the dependent cutover outcome and preserves the source.
