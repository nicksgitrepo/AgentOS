# Specialist Block Library — Integration Handoff

Disposition: `WAITING_WITH_RECEIPT`

This is an isolated, inactive AgentOS Specialist Block Library candidate. It is
not merged, activated, deployed, published, adopted by a consumer, or admitted
by its author.

## Exact candidate receipt

- Branch: `codex/specialist-block-library-candidate`
- Candidate commit: `170bbf4ca705dce9de199172910c6c25e243e7fc`
- Candidate tree: `aebfe743b8b460dd1ffb5c90cfc3342f93d18597`
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
- Materialized role kinds: `ROUTER: 631`, `CONTROL_PLANE: 13`,
  `KNOWLEDGE_BLOCK: 0`, `GOVERNANCE_BLOCK: 0`, `STANDARD_BLOCK: 0`,
  `CONTEXT_BLOCK: 0`, `ATOMIC_SPECIALIST: 79`,
  `COMPILED_AGENT_PACKAGE: 0`.
- Compiled candidate package roster: `42` packages total — `6` `ROUTER`, `13`
  `CONTROL_PLANE`, `10` `ATOMIC_SPECIALIST`, and `13` source-locked
  `STANDARD_BLOCK` candidates. This is distinct from the complete backlog
  materialization count above.
- Atomic overlay: 12 routers, 79 atomic specialists, 13 control-plane roles;
  the six P1 router packages are classification-only and carry no Product or
  acceptance authority.
- P0 has exactly six candidate lanes, each with a package, source lock, exact
  twelve-gate pack, hostile fixtures, evaluation dossier, and typed handoff.
- The on-demand compiler emits the eight required machine contracts plus a
  generated `bootstrap.md` view in an external companion workspace only.
- The composition fixture generates three different task-shaped packages,
  proves shared standard block hashes, minimal dependency closure, deterministic
  recompile, machine/bootstrap agreement, negative denials, and zero AgentOS
  repository residue.
- The source-locked standard slice contains NIST SP 800-218 SSDF 1.1, OWASP
  ASVS 5.0.0, and SLSA Specification 1.2. Each binds normalized requirements,
  compatibility/supersession metadata, and its source manifest by digest.
- The separate read-only independent evaluator passes all 42 package candidates,
  504 gate files, and 714 hostile fixtures. Its disposition is
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

## Unfinished admission gates

1. Independent utility/harm evaluation of the P0 candidates and Agent Builder
   candidate input.
2. Independent admission authority; no author self-acceptance is valid.
3. Independent utility/harm evaluation of the first P1 router/atomic candidates
   and broader source-backed `STANDARD_BLOCK` expansion remain pending; the
   backlog materialized standard-block count is zero because those roles are
   not yet expanded into packages.
4. Independent utility/harm evaluation of the current standard candidates and
   P0 packages, plus main AgentOS 3.0 integration-owner intake, remain external.

The exact next action is to consume this receipt in the main integration owner,
rerun independent evaluation, and admit only the blocks whose complete gate
trace is independently accepted. Preserve activation `OFF` until then.
