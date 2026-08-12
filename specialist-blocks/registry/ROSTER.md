# Canonical Specialist Roster — Candidate Inactive

The machine-readable source of the full backlog is
`master-inventory.v1.json`. The generic priority overlay is
`priority-roster.v1.json`, and addressable on-demand recipes are in
`recipe-catalog.v1.json`. The compiled canonical block roster and routing index
are generated only after package validation.

## Status and activation

- `2.1rc`: prepared, not activated.
- Library: candidate, inactive, not admitted.
- Agent Builder: candidate-only and `NOT_ADMITTED` until independent utility/harm
  evaluation passes.
- Memory Systems: protected lane; no ordinary block implementation or internal
  direction is included here.

## Product shape: recipes and reusable blocks

The primary product is the registry/compiler, not a set of permanent agents or
hand-maintained prompt files. The on-demand compiler resolves the smallest
dependency-complete set of immutable blocks, adds external typed project
governance and current context, binds candidate/worktree custody and tools,
builds a dependency-aware four-valued gate DAG, and emits a task-shaped
instance only in an external companion workspace.

Every generated instance contains the eight machine contracts
`agent-plan.json`, `block-lock.json`, `authority-graph.json`,
`context-manifest.json`, `decision-tree.gate`, `proof-matrix.json`,
`handoff.schema.json`, and `evaluation-receipt.json`, plus generated
`bootstrap.md`. The machine contracts and package hash are authoritative;
`bootstrap.md` is a read-only generated view.

The composition layers are, in order: owner intent and authority; general
AgentOS governance; external project governance; task/role authority;
language/runtime/framework; architecture/platform; domain/capability;
requirements/product quality; security/privacy/safety; testing/review;
change/version/release/supply chain; exact external project context.

The materialized roster distinguishes these role kinds:

- `ROUTER` — classifies and assembles context only;
- `CONTROL_PLANE` — portable governance mechanics;
- `KNOWLEDGE_BLOCK` — reusable scoped knowledge;
- `GOVERNANCE_BLOCK` — reusable governance constraints;
- `STANDARD_BLOCK` — immutable version-bound authority reused by hash;
- `CONTEXT_BLOCK` — typed context contract only;
- `ATOMIC_SPECIALIST` — one narrow failure/evidence domain;
- `COMPILED_AGENT_PACKAGE` — generated external instance, never a permanent
  roster agent.

Current materialized counts are `ROUTER: 626`, `CONTROL_PLANE: 13`,
`KNOWLEDGE_BLOCK: 0`, `GOVERNANCE_BLOCK: 0`, `STANDARD_BLOCK: 0`,
`CONTEXT_BLOCK: 0`, `ATOMIC_SPECIALIST: 79`, and
`COMPILED_AGENT_PACKAGE: 0`. The typed atomic overlay separately reports
`7` routers, `79` atomic specialists, and `13` control-plane roles.

The compiled candidate package roster is a separate count from the complete
backlog: `16` packages total, consisting of `13` `CONTROL_PLANE` packages and
`3` `STANDARD_BLOCK` packages. All 16 remain `CANDIDATE`, `NOT_ADMITTED`, and
activation `OFF`.

## Source-locked standard candidates

| Block ID | Family / priority | Exact edition and source lock | Build / evaluation | Gates / intake / lifecycle |
|---|---|---|---|---|
| `specialist.standard.nist-ssdf` | `security / P1` | [NIST SP 800-218 SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) `1.1`; `sources.lock`; immutable identity `nist-sp-800-218-v1.1-final-20220203` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.nist-ssdf.v1` | 12 gates; external applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.owasp-asvs` | `security / P1` | [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) `5.0.0`; `sources.lock`; immutable identity `owasp-asvs-5.0.0-release-20250530` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-asvs.v1` | 12 gates; external applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.slsa` | `delivery-operations / P1` | [SLSA Specification](https://slsa.dev/spec/v1.2/) `1.2`; `sources.lock`; immutable identity `slsa-spec-v1.2-approved` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.slsa.v1` | 12 gates; external track/level overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |

Each standard row is content-addressed by its `block_sha256` and binds
`requirements.json`, `compatibility.json`, and `supersession.json` by digest.
Dependencies are the foundation authority and evidence/freshness gates;
conflicts are empty until an exact edition conflict is selected. The standard
blocks may map only their exact versioned authority, never certify, provide
legal advice, select applicability, or accept themselves.

## Mandatory package contract

Every block has stable identity/version/aliases/lifecycle, narrow role context,
typed intake/output/handoff, explicit read/write/tool/data/build/browser/deploy/
communication/acceptance boundaries, primary-source freshness locks, custody and
failure behavior, and independent evaluation. Every package carries exactly
these twelve gate files:

1. `00-intake.gate`
2. `01-applicability.gate`
3. `02-authority-precedence.gate`
4. `03-scope-nongoals.gate`
5. `04-source-evidence-freshness.gate`
6. `05-context-completeness.gate`
7. `06-tool-resource-custody.gate`
8. `07-data-secret-privacy.gate`
9. `08-build-browser-runtime.gate`
10. `09-output-handoff.gate`
11. `10-proof-acceptance.gate`
12. `11-lifecycle-recovery-archive.gate`

Gate answers are exactly `YES`, `NO`, `UNKNOWN`, and `NOT_APPLICABLE`.
`UNKNOWN` closes only the dependent action and records the missing evidence;
it does not authorize a guess or silently block unrelated work.

## Active wave

P0 is the only active priority wave. It has six lanes: `AGENT.BOOTSTRAP`,
`AGENT.PROJECT_CONTROLLER`, `AGENT.INTENT_REGULATOR`,
`AGENT.RESOURCE_SCHEDULER`, `AGENT.RUNTIME_DEPLOYMENT`, and
`AGENT.INDEPENDENT_AUDITOR`. All P1–P6 entries remain planned until the
foundation and preceding wave receipts exist.

The full inventory retains 625 role mentions and 619 unique titles, with 10
explicit duplicate/alias mappings. Priority changes sequencing, not existence.

## Atomicity counts

The current typed atomicity overlay reports exactly:

- `7` routers;
- `79` atomic specialists;
- `13` control-plane blocks.

Routers may classify and assemble context but may not write Product or accept a
result. Atomic specialists must be selected by an upstream router, may return
`NOT_APPLICABLE`, and must split when knowledge, authority, source/version,
tool/data custody, or failure mode differs. The overlay preserves distinct
current-version OWASP web/API categories, access-control modes, concurrency
hazards, supply-chain concerns, provider/edge capabilities, and the generic
priority atomic candidates.

## Reuse and applicability lock

Each exact standard or stable authority is encoded once per exact version as a
content-addressed reusable `STANDARD_BLOCK`. Compiled agents reference its
exact ID/version/hash in `block-lock.json`; they do not copy or regenerate the
block. Task applicability, freshness receipts, project facts, and current
evidence remain external overlays. New editions, material errata, or normative
gate corrections create new block versions with compatibility/supersession
metadata. A non-material publisher refresh creates a freshness receipt only.

The current candidate contains three such source-locked standard packages:
NIST SSDF 1.1, OWASP ASVS 5.0.0, and SLSA Specification 1.2. Their static
receipts do not change the backlog's `STANDARD_BLOCK: 0` materialization count;
that count records roles not yet expanded into packages.

The aggregate typed handoff is `registry/integration-handoff.v1.json` with its
human-readable companion `INTEGRATION_HANDOFF.md`; its current disposition is
`WAITING_WITH_RECEIPT`.
