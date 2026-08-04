# Standards Registry

Status: `PREPARED_NOT_ACTIVATED`

`control/standards-registry.mjs` compiles the portable standards inventory. Each
entry pins a stable identity, authority, version, source, applicability, role,
gate root, requirement identity rule, minimum evidence, and a plain-language
rule.

The registry separates five roles:

- `NORMATIVE_GATE_SOURCE` may contribute atomic Function, Design Bible, or
  Security questions when the standard is applicable.
- `PROCESS_BASELINE` shapes how work is built, migrated, or operated but is not
  a Product pass by itself.
- `INTERCHANGE_STANDARD` defines a machine-readable contract.
- `AWARENESS_CROSSCHECK` detects missing coverage but cannot prove conformance.
- `PROJECT_CONTEXT_OVERLAY` adds typed project-specific requirements only.

The portable baseline includes WCAG, OWASP ASVS, NIST SSDF, JSON Schema,
OpenAPI, SPDX, CycloneDX, SemVer, HTTP semantics, HTTP Problem Details, and
AgentOS normalization baselines. The registry is a reference set, not a claim
that every project uses every standard. Bootstrap compiles only applicable
requirements.

Project extensions cannot remove, collide with, replace, or weaken a pinned
baseline. Every selected requirement retains its standard ID and version in its
question and evidence identity.
