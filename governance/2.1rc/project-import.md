# Project Import, Normalization, and Audit

Status: `PREPARED_NOT_ACTIVATED`

Project import is one typed Bootstrap decision, not a second operating system.
The available modes are:

| Mode | Meaning |
| --- | --- |
| `ADOPT_IN_PLACE` | Keep the source structure and history; bind governance around it. |
| `CLEAN_COPY` | Create a separate destination while preserving behavior and naming. |
| `NORMALIZE_AND_AUDIT` | Create a separate destination, normalize structure and names, run the full four-lane audit, repair grouped findings, and cut over only when accepted. |
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

`NORMALIZE_AND_AUDIT` and `RECONSTRUCT_FROM_INTENT` bind the canonical
[`audit-first import procedure`](audit-first-import-procedure.md). Every
registry, discovered, and owner-declared standard receives an independent
source-freshness and applicability route before clause-level work. Applicable
mandatory clauses enter traceability, atomic read-only audit, governed repair,
Platform/Central integration, independent convergence, local proof, required
real-use proof, and the final evidence pack.

The existing Campaign Cascade coverage categories remain:

1. `FUNCTIONALITY`
2. `DESIGN_UI_SHELL_NAVIGATION`
3. `SECURITY`
4. `CODE_QUALITY_HYGIENE`

They are coverage categories, not umbrella substitutes for one standard/version
or one narrow technical specialist. The three Product roots remain exactly
Function Requirements, Design Bible, and Security. Code quality is an audit
discipline, not a fourth acceptance root. The first governed campaign owns the
refactor; Bootstrap discovers, asks for material intent and boundaries, compiles
the standards inventory, dynamic seed specifications, normalization contract,
and source-preservation gate, then hands the sealed package to Agent Spawner.

Cutover requires exact source, destination, candidate, and rollback identity.
Any material compatibility, Function, Design Bible, Security, or owner-boundary
failure stops only the dependent cutover outcome and preserves the source.
