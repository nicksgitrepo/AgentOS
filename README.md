# AgentOS

AgentOS is a portable, project-agnostic governance and orchestration system for autonomous software-development agents.

This repository is the standalone home of the `2.1rc` generation. It is intentionally separated from every product repository and must not contain product-specific identities, paths, providers, policies, or domain truth in its portable governance.

## Repository layout

- `bootstrap/` — user-guided environment discovery and configuration entrypoint, including life, target, boundary, and delivery-policy decisions.
- `governance/2.1rc/` — normative portable governance for this release candidate.
- `authority/templates/` — project authority-corpus and context templates.
- `control/` — executable controllers, compilers, and maintainers.
- `schemas/` — machine-readable contracts.
- `tests/` — positive, hostile, portability, and determinism tests.
- `docs/` — user and maintainer documentation.
- `migrations/` — tools and mappings for importing earlier governance generations.
- `examples/` — generic examples with no real project identity.

## Current status

`2.1rc` is under development and is not activated by this scaffold.

No license has been selected yet.

## Verification

From the repository root, run:

```text
node tests/verify-portability.mjs
node tests/verify-all.mjs
```

The first command checks the whole package for portability, syntax, path
containment, deterministic empty-project creation, context separation,
extension boundaries, and symlink refusal. The second runs the complete
positive and hostile governance suite.

Bootstrap delivery policy is provider-neutral in the kernel. A consuming
project supplies its push, merge, CI-runner, hosting, deployment, rollback,
provider, environment, and cost bindings through typed project context.

Bootstrap also separates the Project Life Contract, Delivery Target, and
Boundary Contract. This allows a managed-site prototype or limited working
Product to be selected without making a production claim, while keeping
provider capabilities, account authority, and owner-only boundaries explicit.

Extraction provenance and the activation hold are recorded in
`migrations/2.1rc-extraction-manifest.json`.
