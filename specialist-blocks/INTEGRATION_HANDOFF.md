# Specialist Block Library — Integration Handoff

Disposition: `WAITING_WITH_RECEIPT`

This is an isolated, inactive AgentOS Specialist Block Library candidate. It is
not merged, activated, deployed, published, adopted by a consumer, or admitted
by its author.

## Exact candidate receipt

- Branch: `codex/specialist-block-library-candidate`
- Candidate commit: `e35e055e7b1c198c820b6050302e7df1a1e19507`
- Candidate tree: `2bd879482553aef3223e08757cccca394cc8618f`
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
- Materialized role kinds: `ROUTER: 626`, `CONTROL_PLANE: 13`,
  `KNOWLEDGE_BLOCK: 0`, `GOVERNANCE_BLOCK: 0`, `STANDARD_BLOCK: 0`,
  `CONTEXT_BLOCK: 0`, `ATOMIC_SPECIALIST: 79`,
  `COMPILED_AGENT_PACKAGE: 0`.
- Compiled candidate package roster: `16` packages total — `13`
  `CONTROL_PLANE` and `3` source-locked `STANDARD_BLOCK` candidates. This is
  distinct from the unexpanded backlog materialization count above.
- Atomic overlay: 7 routers, 79 atomic specialists, 13 control-plane roles.
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
- The separate read-only independent evaluator passes all 16 package candidates,
  192 gate files, and 272 hostile fixtures. Its disposition is
  `STATIC_PASS_REVIEW_REQUIRED`; it does not self-admit anything.
- Atomic composition enforcement is included in the candidate: an atomic block
  must bind to and compile with its selected upstream `ROUTER`; router-only
  substitution, missing upstream closure, and sibling-authority overlap deny.

## Unfinished admission gates

1. Independent utility/harm evaluation of the P0 candidates and Agent Builder
   candidate input.
2. Independent admission authority; no author self-acceptance is valid.
3. Broader source-backed `STANDARD_BLOCK` expansion and the first narrow P1
   atomic package wave remain planned; the backlog materialized standard-block
   count is zero because those roles are not yet expanded into packages.
4. Independent utility/harm evaluation of the current standard candidates and
   P0 packages, plus main AgentOS 3.0 integration-owner intake, remain external.

The exact next action is to consume this receipt in the main integration owner,
rerun independent evaluation, and admit only the blocks whose complete gate
trace is independently accepted. Preserve activation `OFF` until then.
