# Normalization Policy

Status: `PREPARED_NOT_ACTIVATED`

`control/normalization-policy.mjs` compiles the naming and structure policy
used by project import campaigns. It does not silently rewrite an imported
source during Bootstrap.

Precedence is fixed:

1. public, persisted, or external compatibility contract;
2. official language convention;
3. official framework or platform convention;
4. accepted project glossary;
5. AgentOS fallback convention.

The fallback uses lower-kebab-case for new directories and filenames, language
idioms for source identifiers, stable lower-kebab route segments, snake_case
database identities, and versioned lower-dotted event names. Existing article
numbers and accepted slugs are never renumbered.

An internal identifier may be renamed after a reference scan. An external or
persisted identity is preserved or receives an alias and explicit migration.
Conflicts with an accepted glossary or protected contract remain owner-bound;
they are not solved by a prettier spelling.

Bootstrap compiles this policy and the migration plan. The first governed
campaign performs the directory, filename, route, variable, contract, and
exclusion changes with four read-only audit disciplines and rollback.
