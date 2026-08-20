# Canonical AgentOS Reusable Agent Roster — Candidate Inactive

The current canonical campaign registry is
`specialist-blocks/registry/agent-roster.v1.json`. It is generated from the
real AgentOS block library and the sealed permanent-role registry. This file is
the human-readable plan; the JSON registry is the authority for identity,
dependencies, scores, gates, fixtures, model routes, and build state.

## Build order

The Spawner is already admitted and is reused by its immutable receipt. The
Controller, Product Owner, Memory, Runtime, Scheduler, and Orchestrator
packages have passed their independent checks and are reused by their exact
candidate readbacks. Security Router, Data Router, Observability Router, Provider/Edge Router,
Desktop/Offline/Realtime Client Router, Product/Client Contract Router,
Software Language/Runtime Router, Bootstrap/Project Initializer, Central
Integrator, Release Manager, Worktree/Custody Manager, Assurance/Enterprise
Router, Independent Auditor, AI/Search/RAG Router, Workflow Router,
Accounting/Job-Cost Router, Graphics/Industrial 3D Router, Privacy
Data-Lifecycle Router, Regulatory Applicability Router, Access-Control
Composition Router, OWASP API Top 10 Router, OWASP ASVS Applicability Router,
and OWASP Web Top 10 Router are accepted from their exact independent
receipts. The Supply Chain Router, Data Migration/Rollback Router, and
Observability/Incident Router are now accepted from their exact independent
receipts. The current queue item is the next eligible package recorded in the
machine registry; its package, gates, hostile vectors, model route, and local
proof are next for one-at-a-time qualification.
All other
entries remain queued or blocked on predecessors as recorded in the machine
registry. The acceptance ledger is a read-only index of exact
independent readbacks; it never grants activation or spawn authority.

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

The legacy materialized-library counts below are retained only as historical
inventory context. The current authority is the generated registry above:
`127` entries from `127` package directories (`126` current and `1` archived),
with `96` agent roles, `7` reusable governance blocks, and `23` reusable standard
blocks. The registry's ordered
queue, not the historical recipe counts, controls what may be built.

The on-demand recipe and master-inventory catalogs remain useful source
inventories, but they do not admit an agent. A package becomes actionable only
when its registry entry has a complete block graph, exact gate and hostile
fixture evidence, a current model route, and an independent acceptance receipt.
Protected memory remains inactive until its independent review is accepted;
other missing permanent-role packages stay explicitly planned until their own
package is built and qualified.

## Source-locked standard candidates

| Block ID | Family / priority | Exact edition and source lock | Build / evaluation | Gates / intake / lifecycle |
|---|---|---|---|---|
| `specialist.standard.nist-ssdf` | `security / P1` | [NIST SP 800-218 SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) `1.1`; `sources.lock`; immutable identity `nist-sp-800-218-v1.1-final-20220203` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.nist-ssdf.v1` | 12 gates; external applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.owasp-asvs` | `security / P1` | [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) `5.0.0`; `sources.lock`; immutable identity `owasp-asvs-5.0.0-release-20250530` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-asvs.v1` | 12 gates; external applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.owasp-top10-2025` | `security / P2` | [OWASP Top 10:2025](https://owasp.org/Top10/) `2025`; `sources.lock`; immutable identity `owasp-top10-2025-release` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-top10-2025.v1` | 12 gates; external web-application applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.owasp-api-top10-2023` | `security / P2` | [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x04-release-notes/) `2023`; `sources.lock`; immutable identity `owasp-api-security-top10-2023-release-20230703` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-top10-2023.v1` | 12 gates; external API applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.slsa` | `delivery-operations / P1` | [SLSA Specification](https://slsa.dev/spec/v1.2/) `1.2`; `sources.lock`; immutable identity `slsa-spec-v1.2-approved` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.slsa.v1` | 12 gates; external track/level overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.semantic-versioning-2-0-0` | `delivery-operations / P3` | [Semantic Versioning](https://semver.org/spec/v2.0.0.html) `2.0.0`; `sources.lock`; immutable identity `semantic-versioning-2.0.0` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.semantic-versioning-2-0-0.v1` | 12 gates; external public-API/version overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.conventional-commits-1-0-0` | `delivery-operations / P3` | [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `1.0.0`; `sources.lock`; immutable identity `conventional-commits-1.0.0` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.conventional-commits-1-0-0.v1` | 12 gates; external commit-history overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.rust-reference` | `software-language-runtime / P1` | [Rust Reference](https://doc.rust-lang.org/reference.html) `1.97.1`; exact retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.rust-reference.v1` | 12 gates; external edition/toolchain overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.typescript-5-9` | `software-language-runtime / P1` | [TypeScript 5.9 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) `5.9`; exact retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.typescript-5-9.v1` | 12 gates; external compiler overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.react-19-2` | `software-language-runtime / P1` | [React 19.2 release notes](https://react.dev/blog/2025/10/01/react-19-2) `19.2`; exact retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.react-19-2.v1` | 12 gates; external framework overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.postgresql-17-rls` | `data / P1` | [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) `17.10`; exact retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.postgresql-17-rls.v1` | 12 gates; external database/tenant overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.openapi-3-1-1` | `product-client / P1` | [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.1.html) `3.1.1`; immutable identity `openapi-spec-3.1.1-2024-10-24` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.openapi-3-1-1.v1` | 12 gates; external contract overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.oauth-rfc-9700` | `security / P1` | [OAuth Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html) `RFC 9700`; exact retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.oauth-rfc-9700.v1` | 12 gates; external flow/client overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.oidc-core-1-0` | `security / P1` | [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html) `1.0`; immutable identity `openid-connect-core-1.0-2014-11-08` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.oidc-core-1-0.v1` | 12 gates; external issuer/claims overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.aws-iam-current` | `delivery-operations / P1` | [AWS IAM policy elements](https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/reference_policies_elements.html) `current`; retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.aws-iam-current.v1` | 12 gates; external provider/account overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.cloudflare-dns-current` | `delivery-operations / P1` | [Cloudflare DNS records](https://developers.cloudflare.com/dns/manage-dns-records/) `current`; retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.cloudflare-dns-current.v1` | 12 gates; external zone overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.cloudflare-cache-current` | `delivery-operations / P1` | [Cloudflare Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/) `current`; retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.cloudflare-cache-current.v1` | 12 gates; external edge overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.wcag-2-2` | `product-client / P4` | [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) `2.2`, Recommendation republished 2024-12-12; immutable identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.wcag-2-2.v1` | 12 gates; external jurisdiction/content applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.nist-ai-rmf-1-0` | `ai-search / P5` | [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10) `1.0`; immutable identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.nist-ai-rmf-1-0.v1` | 12 gates; external use-case/applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.nist-genai-profile-1-0` | `ai-search / P5` | [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) `2024-07-26`; immutable identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.nist-genai-profile-1-0.v1` | 12 gates; external generative-AI applicability overlay required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.gltf-2-0-1` | `3d-graphics / P5` | [Khronos glTF Registry](https://registry.khronos.org/glTF/) `2.0.1`; immutable identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.gltf-2-0-1.v1` | 12 gates; asset/runtime applicability external; no engineering-truth certification; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.fmcsa-part-390-2025` | `regulatory / P5` | [49 CFR Part 390](https://www.govinfo.gov/content/pkg/CFR-2025-title49-vol5/pdf/CFR-2025-title49-vol5-part390.pdf) `2025`; immutable identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.fmcsa-part-390-2025.v1` | 12 gates; jurisdiction/entity/activity/exception/effective-date overlay required; no legal advice; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.standard.gao-green-book-2025` | `finance / P5` | [GAO Green Book](https://www.gao.gov/greenbook) `2025`; immutable identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.gao-green-book-2025.v1` | 12 gates; entity/control-objective overlay required; no licensed accounting conclusion; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |

Each standard row is content-addressed by its `block_sha256` and binds
`requirements.json`, `compatibility.json`, and `supersession.json` by digest.
Dependencies are the foundation authority and evidence/freshness gates;
conflicts are empty until an exact edition conflict is selected. The standard
blocks may map only their exact versioned authority, never certify, provide
legal advice, select applicability, or accept themselves.

## First P1 router and atomic candidates

| Block ID | Kind / upstream | Exact source lock | Build / evaluation | Gates / intake / lifecycle |
|---|---|---|---|---|
| `specialist.software-language-runtime.router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.software-language-runtime-router.v1` | 12 gates; router-only; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.software-language-runtime.rust-backend` | `ATOMIC_SPECIALIST`; `specialist.software-language-runtime.router` | [Rust Reference](https://doc.rust-lang.org/reference.html) `1.97.1`; immutable retrieval identity in `sources.lock` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.rust-backend.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.software-language-runtime.typescript-language` | `ATOMIC_SPECIALIST`; `specialist.software-language-runtime.router` | [TypeScript 5.9 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) `5.9` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.typescript-language.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.software-language-runtime.react-components` | `ATOMIC_SPECIALIST`; `specialist.software-language-runtime.router` | [React 19.2 release notes](https://react.dev/blog/2025/10/01/react-19-2) `19.2` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.react-components.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.data.router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.data-router.v1` | 12 gates; router-only; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.data.postgresql-rls` | `ATOMIC_SPECIALIST`; `specialist.data.router` | [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) `17.10` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.postgresql-rls.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.product-client.router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.product-client-router.v1` | 12 gates; router-only; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.product-client.openapi-contracts` | `ATOMIC_SPECIALIST`; `specialist.product-client.router` | [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) `3.1.1` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.openapi-contracts.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.security.router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.security-router.v1` | 12 gates; router-only; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.security.oauth-identity` | `ATOMIC_SPECIALIST`; `specialist.security.router` | [OAuth Security BCP RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.oauth-identity.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.security.oidc-core` | `ATOMIC_SPECIALIST`; `specialist.security.router` | [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.oidc-core.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.platform.provider-edge-router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.provider-edge-router.v1` | 12 gates; router-only; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.platform.aws-iam-policy` | `ATOMIC_SPECIALIST`; `specialist.platform.provider-edge-router` | [AWS IAM policy elements](https://docs.aws.amazon.com/us_en/IAM/latest/UserGuide/reference_policies_elements.html) current retrieval lock | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.aws-iam-policy.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.platform.cloudflare-dns` | `ATOMIC_SPECIALIST`; `specialist.platform.provider-edge-router` | [Cloudflare DNS records](https://developers.cloudflare.com/dns/manage-dns-records/) current retrieval lock | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.cloudflare-dns.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.platform.cloudflare-cache` | `ATOMIC_SPECIALIST`; `specialist.platform.provider-edge-router` | [Cloudflare Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/) current retrieval lock | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.cloudflare-cache.v1` | 12 gates; upstream router required; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |
| `specialist.assurance-enterprise.router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.assurance-enterprise-router.v1` | 12 gates; router-only; `WAITING_WITH_RECEIPT / NOT_ADMITTED` |

## P2 security routers and atomic specialists

The P2 security slice is source-locked and candidate-only. The two OWASP
indexes are reusable `STANDARD_BLOCK`s; the category packages reference their
exact standard hashes and never copy the index authority. Every atomic row has
one upstream router, its own gate pack, hostile fixture set, evaluator receipt,
and typed handoff.

| Block ID | Kind / upstream | Reusable standard dependencies | Build / evaluation | Gates / lifecycle |
|---|---|---|---|---|
| `specialist.privacy.data-lifecycle-router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.data-lifecycle-router.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.access-control-router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.access-control-router.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-top10-router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-top10-router.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-top10-router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-top10-router.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-asvs-router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-asvs-router.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.supply-chain-router` | `ROUTER`; none | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.supply-chain-router.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.rbac` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.rbac.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.abac` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; independent PASS receipt `97d7ca42…`; `specialist-eval.abac.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `specialist.security.rebac` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.rebac.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.tenant-isolation` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.tenant-isolation.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.object-scope` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.object-scope.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.function-scope` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.function-scope.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.revocation` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.revocation.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.cache-residue` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; independent PASS receipt `2cd5417a…`; `specialist-eval.cache-residue.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `specialist.security.race-condition` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.race-condition.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.toctou` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.toctou.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.deadlock` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; independent PASS receipt `2a8db82c…`; `specialist-eval.deadlock.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `specialist.security.idempotency` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.idempotency.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.replay` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.replay.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.double-submission` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.double-submission.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.concurrent-authorization` | `ATOMIC_SPECIALIST`; `specialist.security.access-control-router` | `specialist.standard.owasp-asvs` | `1.0.0`; independent PASS receipt `d75a40b6…`; `specialist-eval.concurrent-authorization.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `specialist.security.cve-inventory` | `ATOMIC_SPECIALIST`; `specialist.security.supply-chain-router` | `specialist.standard.nist-ssdf`, `specialist.standard.slsa` | `1.0.0`; independent PASS receipt `ffa345c5…`; `specialist-eval.cve-inventory.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `specialist.security.cve-applicability` | `ATOMIC_SPECIALIST`; `specialist.security.supply-chain-router` | `specialist.standard.nist-ssdf`, `specialist.standard.slsa` | `1.0.0`; independent PASS receipt `36e258e5…`; `specialist-eval.cve-applicability.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `specialist.security.dependency-vulnerability` | `ATOMIC_SPECIALIST`; `specialist.security.supply-chain-router` | `specialist.standard.nist-ssdf`, `specialist.standard.slsa` | `1.0.0`; independent PASS receipt `206b3678…`; `specialist-eval.dependency-vulnerability.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `specialist.security.sbom` | `ATOMIC_SPECIALIST`; `specialist.security.supply-chain-router` | `specialist.standard.nist-ssdf`, `specialist.standard.slsa` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.sbom.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.patch-remediation` | `ATOMIC_SPECIALIST`; `specialist.security.supply-chain-router` | `specialist.standard.nist-ssdf`, `specialist.standard.slsa` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.patch-remediation.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.supply-chain-provenance` | `ATOMIC_SPECIALIST`; `specialist.security.supply-chain-router` | `specialist.standard.nist-ssdf`, `specialist.standard.slsa` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.supply-chain-provenance.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a01-broken-access-control` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a01-broken-access-control.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a02-security-misconfiguration` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a02-security-misconfiguration.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a03-software-supply-chain-failures` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a03-software-supply-chain-failures.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a04-cryptographic-failures` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a04-cryptographic-failures.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a05-injection` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a05-injection.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a06-insecure-design` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a06-insecure-design.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a07-authentication-failures` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a07-authentication-failures.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a08-software-data-integrity-failures` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a08-software-data-integrity-failures.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a09-security-logging-alerting-failures` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a09-security-logging-alerting-failures.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-web-2025-a10-mishandling-exceptional-conditions` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-web-top10-router` | `specialist.standard.owasp-top10-2025`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-web-2025-a10-mishandling-exceptional-conditions.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api1-object-authorization` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api1-object-authorization.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api2-broken-authentication` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api2-broken-authentication.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api3-property-authorization` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api3-property-authorization.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api4-resource-consumption` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api4-resource-consumption.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api5-function-authorization` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api5-function-authorization.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api6-sensitive-business-flows` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api6-sensitive-business-flows.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api7-ssrf` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api7-ssrf.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api8-misconfiguration` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api8-misconfiguration.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api9-inventory` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api9-inventory.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.security.owasp-api-2023-api10-unsafe-api-consumption` | `ATOMIC_SPECIALIST`; `specialist.security.owasp-api-top10-router` | `specialist.standard.owasp-api-top10-2023`, `specialist.standard.owasp-asvs` | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.owasp-api-2023-api10-unsafe-api-consumption.v1` | 12 gates; `NOT_ADMITTED / OFF` |

## P3 delivery and assurance candidates

The P3 slice remains candidate-only and expands the governance, delivery, data,
and assurance routes without activating a lane. The observability router is a
typed prerequisite for its narrower incident-evidence specialist; it has no
Product or acceptance authority.

| Block ID | Kind / upstream | Exact source lock / reusable authorities | Build / evaluation | Gates / lifecycle |
|---|---|---|---|---|
| `specialist.control.central-integrator` | `CONTROL_PLANE`; none | `PORTABLE_KERNEL` atomicity law; SLSA 1.2; reusable NIST SSDF/SLSA dependencies | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.central-integrator.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.control.release-manager` | `CONTROL_PLANE`; none | `PORTABLE_KERNEL`; [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html); [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/); reusable NIST SSDF/SLSA dependencies | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.release-manager.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.control.worktree-custody` | `CONTROL_PLANE`; none | `PORTABLE_KERNEL`; [git-worktree documentation](https://git-scm.com/docs/git-worktree.html); reusable SLSA dependency | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.worktree-custody.v1` | 12 gates; `NOT_ADMITTED / OFF` |
| `specialist.delivery-operations.observability-router` | `ROUTER`; none | `PORTABLE_KERNEL`; [Google SRE monitoring](https://sre.google/sre-book/monitoring-distributed-systems/) | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.observability-router.v1` | 12 gates; router-only; `NOT_ADMITTED / OFF` |
| `specialist.assurance-enterprise.test-architect` | `ATOMIC_SPECIALIST`; `specialist.assurance-enterprise.router` | `PORTABLE_KERNEL`; [Google SRE reliability testing](https://sre.google/sre-book/testing-reliability/); reusable NIST SSDF dependency | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.test-architect.v1` | 12 gates; upstream required; `NOT_ADMITTED / OFF` |
| `specialist.delivery-operations.observability-incident` | `ATOMIC_SPECIALIST`; `specialist.delivery-operations.observability-router` | `PORTABLE_KERNEL`; [Google SRE monitoring](https://sre.google/sre-book/monitoring-distributed-systems/); reusable SLSA dependency | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.observability-incident.v1` | 12 gates; upstream required; `NOT_ADMITTED / OFF` |
| `specialist.data.migration-rollback` | `ATOMIC_SPECIALIST`; `specialist.data.router` | `PORTABLE_KERNEL`; [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html); reusable NIST SSDF/SLSA dependencies | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.migration-rollback.v1` | 12 gates; upstream required; `NOT_ADMITTED / OFF` |

## P5 domain, AI, 3D, regulatory, and finance candidates

The P5 slice remains candidate-only and adds six narrow atomic specialists plus
five classification-only routers. The routers assemble typed context only; the
atomic rows are the smallest sufficient authority/failure domains and may return
`NOT_APPLICABLE` rather than broaden scope.

| Generic ID | Block ID / kind | Upstream / reusable authority | Build / evaluation | Gates / intake / lifecycle |
|---|---|---|---|---|
| `DOMAIN.WORKFLOW_ROUTER` | `specialist.domain.workflow-router` / `ROUTER` | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.workflow-router.v1` | 12 gates; router-only; `NOT_ADMITTED / OFF` |
| `DOMAIN.FIELD_JOB_WORKFLOW` | `specialist.domain.field-job-workflow` / `ATOMIC_SPECIALIST` | upstream `specialist.domain.workflow-router`; OSHA Oil & Gas eTool context remains descriptive/external | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.field-job-workflow.v1` | 12 gates; narrow workflow scope; `NOT_ADMITTED / OFF` |
| `DOMAIN.WELL_WORKFLOW` | `specialist.domain.well-workflow` / `ATOMIC_SPECIALIST` | upstream `specialist.domain.workflow-router`; OSHA Oil & Gas eTool context remains descriptive/external | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.well-workflow.v1` | 12 gates; narrow workflow scope; `NOT_ADMITTED / OFF` |
| `GRAPHICS.INDUSTRIAL_3D` | `specialist.graphics.industrial-3d` / `ATOMIC_SPECIALIST` | upstream `specialist.graphics.industrial-3d-router`; exact `specialist.standard.gltf-2-0-1` hash | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.industrial-3d.v1` | 12 gates; no engineering-truth claim; `NOT_ADMITTED / OFF` |
| `GRAPHICS.INDUSTRIAL_3D_ROUTER` | `specialist.graphics.industrial-3d-router` / `ROUTER` | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.industrial-3d-router.v1` | 12 gates; router-only; `NOT_ADMITTED / OFF` |
| `AI.SEARCH_ROUTER` | `specialist.ai.search-router` / `ROUTER` | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.search-router.v1` | 12 gates; router-only; `NOT_ADMITTED / OFF` |
| `AI.SEARCH_RAG` | `specialist.ai.search-rag` / `ATOMIC_SPECIALIST` | upstream `specialist.ai.search-router`; exact NIST AI RMF and GenAI Profile hashes | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.search-rag.v1` | 12 gates; corpus/provider/context external; `NOT_ADMITTED / OFF` |
| `REGULATORY.APPLICABILITY_ROUTER` | `specialist.regulatory.applicability-router` / `ROUTER` | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.regulatory-applicability-router.v1` | 12 gates; router-only; `NOT_ADMITTED / OFF` |
| `REG.FMCSA_APPLICABILITY` | `specialist.regulatory.fmcsa-applicability` / `ATOMIC_SPECIALIST` | upstream `specialist.regulatory.applicability-router`; exact FMCSA Part 390 hash | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.fmcsa-applicability.v1` | 12 gates; jurisdiction/entity/activity/exception overlay required; `NOT_ADMITTED / OFF` |
| `FINANCE.ACCOUNTING_ROUTER` | `specialist.finance.accounting-router` / `ROUTER` | `PORTABLE_KERNEL` atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.accounting-router.v1` | 12 gates; router-only; `NOT_ADMITTED / OFF` |
| `FIN.JOB_COST_ACCOUNTING` | `specialist.finance.job-cost-accounting` / `ATOMIC_SPECIALIST` | upstream `specialist.finance.accounting-router`; exact GAO Green Book 2025 hash | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.job-cost-accounting.v1` | 12 gates; advisory control mapping only; `NOT_ADMITTED / OFF` |

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
`AGENT.PROJECT_CONTROLLER`, `AGENT.PRODUCT_OWNER`,
`AGENT.RESOURCE_SCHEDULER`, `AGENT.RUNTIME_DEPLOYMENT`, and
`AGENT.INDEPENDENT_AUDITOR`. Unbuilt P1–P6 entries remain planned until the
foundation and preceding wave receipts exist; the P1–P5 packages above are
candidate library records, not active lanes.

The full inventory retains 627 role mentions and 621 unique titles (the 619
baseline roles plus two generic discovered workflow additions), with 10
explicit duplicate/alias mappings. Priority changes sequencing, not existence.
P3, P4, and P5 packages are compiled candidates only; P0 remains the sole
active wave.

## Atomicity counts

The current typed atomicity overlay reports exactly:

- `19` routers;
- `92` atomic specialists;
- `16` control-plane blocks.

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

The current candidate contains twenty-three such source-locked standard packages:
NIST SSDF 1.1, OWASP ASVS 5.0.0, SLSA Specification 1.2, ten P1 language,
framework, data, API, identity, and provider authorities, OWASP Top 10:2025,
and OWASP API Security Top 10:2023, Semantic Versioning 2.0.0, Conventional
Commits 1.0.0, W3C WCAG 2.2, NIST AI RMF 1.0, NIST AI 600-1, glTF 2.0.1,
FMCSA Part 390 (2025), and the GAO Green Book (2025). Their static receipts do not change the
backlog's `STANDARD_BLOCK: 0` materialization count; that count records roles
not yet expanded into packages.

The aggregate typed handoff is `registry/integration-handoff.v1.json` with its
human-readable companion `INTEGRATION_HANDOFF.md`; its current disposition is
`WAITING_WITH_RECEIPT`.

## Utility/harm pre-screen receipt

The read-only deterministic pre-screen is implemented at
`control/specialist-utility-harm-prescreen.mjs` and recorded at
`registry/utility-harm-prescreen.v1.json`. It verifies the declared policy of
all `123` package dossiers and `2,091` hostile fixtures: `2,023` cases are
observed `PASS`, `68` remain `PENDING`, and `0` are failed. Its disposition is
`PRESCREEN_PENDING_EXTERNAL_REVIEW`; an independent reviewer and admission
authority are still mandatory, and no package is activated or admitted by
this receipt.

## P4 client/UX candidates — current receipt

These six packages are candidate-only, use exact twelve-gate packs, and have
not activated a lane. The desktop/offline/realtime package is a router/index;
the five narrower atoms remain distinct and must be selected when their
failure mode, evidence, or authority is implicated.

| Generic ID | Block ID / kind | Source lock / dependency | Build / evaluator | Intake / lifecycle |
|---|---|---|---|---|
| `CLIENT.DESKTOP_OFFLINE_REALTIME` | `specialist.product-client.desktop-offline-realtime-router` / `ROUTER` | [W3C WebRTC](https://www.w3.org/TR/2025/REC-webrtc-20250313/); [W3C Service Workers](https://www.w3.org/TR/service-workers/); atomicity law | `1.0.0`; `STATIC_PASS_REVIEW_REQUIRED`; `specialist-eval.desktop-offline-realtime-router.v1` | router-only; `NOT_ADMITTED / OFF` |
| `UX.PRODUCT_INTERACTION` | `specialist.product-client.product-interaction` / `ATOMIC_SPECIALIST` | [W3C ARIA APG](https://www.w3.org/WAI/ARIA/apg/); upstream `specialist.product-client.router` | `1.0.0`; independent PASS receipt `a43e75d8…`; `specialist-eval.product-interaction.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `UX.ACCESSIBILITY_WCAG` | `specialist.product-client.accessibility-wcag` / `ATOMIC_SPECIALIST` | [WCAG 2.2](https://www.w3.org/TR/WCAG22/); exact `specialist.standard.wcag-2-2` hash; upstream product/client router | `1.0.0`; independent PASS receipt `aac0adee…`; `specialist-eval.accessibility-wcag.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
| `CLIENT.RESPONSIVE_WEB` | `specialist.product-client.responsive-web` / `ATOMIC_SPECIALIST` | [MDN Responsive Design](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design); upstream product/client router | `1.0.0`; independent PASS receipt `92bd2af8…`; qualified for sealed Spawner reuse; activation remains `OFF` |
| `CLIENT.IOS_SWIFTUI` | `specialist.product-client.ios-swiftui` / `ATOMIC_SPECIALIST` | [Apple SwiftUI](https://developer.apple.com/documentation/swiftui/); upstream product/client router | `1.0.0`; independent PASS receipt `332b60fb…`; qualified for sealed Spawner reuse; activation remains `OFF` |
| `CLIENT.ANDROID_KOTLIN` | `specialist.product-client.android-kotlin` / `ATOMIC_SPECIALIST` | [Jetpack Compose](https://developer.android.com/develop/ui/compose/documentation), [Kotlin](https://kotlinlang.org/docs/home.html); upstream product/client router | `1.0.0`; independent PASS receipt `88cbac35…`; `specialist-eval.android-kotlin.v1` | 12 executable gates; 17 hostile vectors; qualified for sealed Spawner reuse; activation remains `OFF` |
