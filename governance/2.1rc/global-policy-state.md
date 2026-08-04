# Global Policy State

`2.1rc` uses a durable policy state instead of scattered mutable constants.

Each declared variable has an independent identity, type, authority, default, effective boundary, dependency list, invalidation scope, recompile targets, and model-rotation rule. A request can change one variable without rewriting unrelated policy. Dependents are still calculated automatically, because an independent edit can have dependent consequences.

The policy state is content-addressed and carries a monotonically increasing epoch. Every amendment names the exact parent state, records the affected acceptance roots and controllers, and is retained in an append-only ledger. A stale amendment is rejected rather than merged by guesswork.

The change gate is:

```text
declared and mutable?
→ valid value?
→ exact dependents and invalidations?
→ safe effective boundary?
→ authenticated exact owner approval?
→ apply a new policy epoch
```

Changing a model class rotates only the affected role at the next safe assignment boundary. Changing the campaign mode, assurance class, North Star, or first useful workflow recompiles the affected campaign and acceptance slices. Changing a constitutional rule is not a project preference; it requires a new governance version.

The state remains `PREPARED_NOT_ACTIVATED`. Policy amendments can prepare a project candidate, but they cannot activate AgentOS, deploy a Product, authorize spending, or create a successor roster by themselves.
