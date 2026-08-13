# Governance 2.1rc

Normative, portable governance payloads for AgentOS `2.1rc`.

This directory must remain free of product-specific context.

The later AgentOS 3.0 permanent-role candidate is versioned separately under
`governance/3.0/`. Where a 2.1rc Controller or persistent-role name conflicts
with that graph, the 2.1rc record is compatibility input only and must pass the
3.0 migration and rebinding boundary; it does not co-author current authority.

Bootstrap delivery choices are governed by [delivery-policy.md](delivery-policy.md)
and compiled by the canonical delivery-policy controller. Provider identities
and account bindings remain project-context data.

Bootstrap coverage is governed by [bootstrap-coverage.md](bootstrap-coverage.md)
and compiled by `control/bootstrap-coverage.mjs`. The coverage matrix is the
single authority for output completeness and question selection; it does not
activate governance or bind a Product campaign.

Bootstrap also compiles three related contracts:

- [project-life-contract.md](project-life-contract.md) keeps maturity, audience,
  data, lifetime, maintenance, and retirement explicit;
- [delivery-target.md](delivery-target.md) separates the intended Product
  target from transport mechanics and supports managed-site prototype and
  limited-product routes;
- [boundary-contract.md](boundary-contract.md) makes constitutional,
  owner-sovereign, derived, and probe boundaries enforceable.

Project migration is governed by [project-import.md](project-import.md), with
the compatibility-first [normalization-policy.md](normalization-policy.md) and
version-pinned [standards-registry.md](standards-registry.md). Bootstrap
preserves an imported source before any migration build; the first governed
campaign performs the full normalization and four-lane audit.

The adaptive cascade’s cost and Finalizer boundary are governed by
[cascade-economics.md](cascade-economics.md). It compares complete accepted
results, not token rates, and requires a 75% or better observed ratio before a
task class is treated as economically demonstrated.
