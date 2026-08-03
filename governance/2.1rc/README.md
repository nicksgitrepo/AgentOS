# Governance 2.1rc

Normative, portable governance payloads for AgentOS `2.1rc`.

This directory must remain free of product-specific context.

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
