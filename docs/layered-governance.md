# Layered governance

Layered governance compiles project context into a typed, private contract and
projects only the smallest task-shaped slice needed by an admitted role.
Public payloads contain normalized values, opaque digests, and typed unknowns;
they do not contain raw conversation, private locations, credentials, provider
accounts, or task/session identities.

The canonical precedence order is:

1. general governance and the base general library;
2. base-role governance;
3. persistent project governance; and
4. generated task-role governance.

Later layers may add restrictions or evidence requirements. They may not
remove a prohibition, replace an earlier authority source, expand graph scope,
or turn a disposable task packet into a source of authority.

The Bootstrap conversation is compiled by
control/bootstrap-project-contract.mjs. Its contract records intent,
workflow, terminology, acceptance conditions, boundaries, unknowns, provider
posture, retention posture, delivery intent, and owner decisions. Decisions
carry authority, scope, lifetime, provenance class, and a revision trigger. Raw
owner text is discarded.

control/task-role-packet.mjs binds one opaque task digest, one task-scope
digest, one admitted role packet, one gate context, and only the applicable
gate questions. control/layered-governance-contract.mjs binds that packet to
the project contract and four governance layers. The resulting contract is
PREPARED_NOT_ACTIVATED; activation requires an owner decision and an
independent check, and the prepared 2.1rc line remains inactive.

Project upgrades use the existing conflict-aware migration record and
append-only project-governance history. A migration preserves the project
source, rejects cross-project or graph-namespace collisions, and keeps the
previous binding available until the replacement is independently checked.
compareLayeredGovernanceEvidence compares the conversation, contract, task
packet, layered binding, and upgrade digest without relying on narrative
claims.

