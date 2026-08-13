# Migrations

Migration files describe how earlier governance material was mapped into the
standalone AgentOS 2.1rc package. They are provenance and import guidance, not
normative authority.

`2.1rc-extraction-manifest.json` records the exact source Git object, target
base, portable mapping, parameterized context, exclusions, and activation hold.

Explicit mappings and tooling for importing or refactoring earlier governance generations into AgentOS.

`permanent-role-authority.v1.json` is the AgentOS 3.0 compatibility map for
permanent-role references. It maps legacy `AGENTOS_CONTROLLER` only to
`INTENT_REGULATOR` when legacy intent semantics are explicit, rejects ambiguous
Controller labels, preserves accepted history, and performs no activation or
host action.
