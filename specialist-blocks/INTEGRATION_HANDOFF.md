# Specialist Block Library — Integration Handoff

Disposition: `WAITING_WITH_RECEIPT`

This is an isolated, inactive AgentOS Specialist Block Library candidate. It is
not merged, activated, deployed, published, adopted by a consumer, or admitted
by its author.

## Exact candidate receipt

- Branch: `codex/specialist-block-library-candidate`
- Candidate commit: `e9a7f939f1afb0968377af19281fabb382f95b59`
- Candidate tree: `23b2a400b8345434eeb84ec12592ebca9c450204`
- Remote ref: `origin/codex/specialist-block-library-candidate`
- Governance: `2.1rc`, prepared but inactive
- Activation: `OFF`
- Admission: `NOT_ADMITTED`

The machine-readable receipt is
`registry/integration-handoff.v1.json`. The exact candidate commit/tree above
identify the implementation and registry payload; this handoff receipt is
attached as a separate immutable receipt commit.

## Verified scope

- Master inventory: 625 raw role mentions, 619 unique titles, 10 explicit alias
  mappings, 619 materialized entries.
- Materialized role kinds: `ROUTER: 632`, `CONTROL_PLANE: 16`,
  `KNOWLEDGE_BLOCK: 0`, `GOVERNANCE_BLOCK: 0`, `STANDARD_BLOCK: 0`,
  `CONTEXT_BLOCK: 0`, `ATOMIC_SPECIALIST: 81`,
  `COMPILED_AGENT_PACKAGE: 0`.
- Compiled candidate package roster: `100` packages total — `13` `ROUTER`, `16`
  `CONTROL_PLANE`, `54` `ATOMIC_SPECIALIST`, and `17` source-locked
  `STANDARD_BLOCK` candidates. This is distinct from the complete backlog
  materialization count above.
- Atomic overlay: 13 routers, 81 atomic specialists, 16 control-plane roles;
  all packaged routers are classification-only and carry no Product or
  acceptance authority.
- P0 has exactly six candidate lanes, each with a package, source lock, exact
  twelve-gate pack, hostile fixtures, evaluation dossier, and typed handoff.
- The on-demand compiler emits the eight required machine contracts plus a
  generated `bootstrap.md` view in an external companion workspace only.
- The composition fixture generates three different task-shaped packages,
  proves shared standard block hashes, minimal dependency closure, deterministic
  recompile, machine/bootstrap agreement, negative denials, and zero AgentOS
  repository residue.
- The source-locked standard slice contains seventeen reusable authorities:
  NIST SP 800-218 SSDF 1.1, OWASP ASVS 5.0.0, SLSA Specification 1.2, ten
  P1 language/framework/data/API/identity/provider authorities, and the OWASP
  Top 10:2025 and OWASP API Security Top 10:2023 indexes, plus Semantic
  Versioning 2.0.0 and Conventional Commits 1.0.0. Each binds normalized
  requirements, compatibility/supersession metadata, and its source manifest
  by digest.
- The separate read-only independent evaluator passes all 100 package candidates,
  1,200 gate files, and 1,700 hostile fixtures. Its disposition is
  `STATIC_PASS_REVIEW_REQUIRED`; it does not self-admit anything.
- Atomic composition enforcement is included in the candidate: an atomic block
  must bind to and compile with its selected upstream `ROUTER`; router-only
  substitution, missing upstream closure, and sibling-authority overlap deny.
- The first P1 atomic slice includes ten source-locked candidates: Rust,
  TypeScript, React, PostgreSQL RLS, OpenAPI contracts, OAuth, OIDC, AWS IAM,
  Cloudflare DNS, and Cloudflare Cache. Their generic P1 IDs remain routing
  mappings; the packages are not admitted or activated.
- Each atom now reuses one immutable exact-edition `STANDARD_BLOCK` by
  dependency and hash: Rust Reference, TypeScript 5.9, React 19.2, PostgreSQL
  17 RLS, OpenAPI 3.1.1, OAuth RFC 9700, OIDC Core 1.0, AWS IAM, Cloudflare
  DNS, and Cloudflare Cache. Official source research is encoded once in those
  standard packages.
- The P2 security slice adds six routers and forty-one atomic candidates under
  `specialist-blocks/wave-03/`: all ten OWASP Web Top 10:2025 categories, all
  ten OWASP API Security Top 10:2023 categories, eight access-control
  modes/boundaries, seven concurrency/replay/idempotency hazards, and six
  CVE/SBOM/provenance domains. The category atoms bind to their exact upstream
  router and reuse the shared OWASP, ASVS, NIST SSDF, or SLSA block hash.
- The P3 delivery/assurance slice adds three governance controls, one
  observability router, and three atomic candidates for test architecture,
  observability/incident evidence, and migration rollback. It reuses existing
  NIST SSDF and SLSA hashes and remains candidate-only.

## Unfinished admission gates

1. Independent utility/harm evaluation of the P0 candidates and Agent Builder
   candidate input.
2. Independent admission authority; no author self-acceptance is valid.
3. Independent utility/harm evaluation of the P1, P2, and P3 router/atomic/control
   candidates and broader source-backed `STANDARD_BLOCK` expansion remain pending; the
   backlog materialized standard-block count is zero because those roles are
   not yet expanded into packages.
4. Independent utility/harm evaluation of the current standard candidates and
   P0 packages, plus main AgentOS 3.0 integration-owner intake, remain external.

The exact next action is to consume this receipt in the main integration owner,
rerun independent evaluation, and admit only the blocks whose complete gate
trace is independently accepted. Preserve activation `OFF` until then.
