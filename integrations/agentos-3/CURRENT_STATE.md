# AgentOS 3.0 test-integration BUILD checkpoint

- Classification: `behavior_plus_correct_placement + production_hardening`
- Build: `AGENTOS_3_TEST_BUILD`
- Lifecycle: `CANDIDATE_INACTIVE`; activation `OFF`
- Custody: fresh isolated integration worktree only; all three inputs immutable
- Contract: `contracts/agentos-3-integration.v1.json`
- Receipt: `contracts/test-build-receipt.json`
- Authority canon object: `6e2b0aa00d7ea3107dc1119d9b59f69e7a6796b9`
- Proof: local deterministic positive/negative, restart/replay, install and rollback
- Pending ceilings: independent utility/harm evaluation; real-host NEW_PROJECT/import-adoption; provider activation; public release
- Forbidden: source mutation, migration, external messaging, consumer/project context, self-acceptance

This receipt intentionally contains no private control payload, absolute source path,
task/session identity, credential, provider identity, or external project context.
