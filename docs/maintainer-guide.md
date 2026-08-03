# AgentOS 2.1rc Maintainer Guide

Normative behavior belongs in `governance/2.1rc/`, machine contracts in
`schemas/`, and executable behavior in `control/`. Project facts belong only
in a consuming project's context binding or in synthetic examples.

When changing a bound article, registry, controller, or verifier, update its
SHA-256 entry in `schemas/bootstrap-binding.v1.json`. Keep the binding
inventory exact and keep migration provenance separate from normative
authority. Add a positive and a hostile case for every new transition or
boundary.

Run `node tests/verify-portability.mjs` and `node tests/verify-all.mjs`, then
run each focused verifier under `tests/`. Do not add credentials, real project
paths, deployment receipts, release evidence, or product-specific policy.
