# AgentOS Specialist Block Library

This is the portable candidate library for narrow specialist-agent governance.
It is a package ecosystem, not an activated roster. Project context is supplied
through typed inputs and authority-corpus templates; the library contains no
consumer project identity, private path, credential, deployment identity, or
domain-specific private fact.

Each block package contains:

- `block.json`: role context, narrow scope, typed intake/output/handoff
  contract, authority and non-goal boundary, and capability ceilings;
- `sources.lock`: versioned primary-source manifest with freshness metadata;
- `<block>.gate`: deterministic boolean decision tree with fail-closed rules;
- `evaluation.json`: independent-evaluation dossier and hostile fixture classes;
- `handoff.json`: exact candidate receipt and residuals.

Atomicity is normative: broad family labels are routers only, atomic blocks own
one failure mode or evidence domain, and control-plane blocks own governance
mechanics. The atomicity overlay in `registry/atomic-inventory.v1.json` keeps
routers, atomic specialists, and control-plane roles separate and reports exact
counts. Every atomic package has its own `sources.lock`, twelve gate files,
hostile fixtures, independent evaluation, and typed handoff.

The controller compiler validates the packages, deduplicates aliases, computes
content digests, materializes the master inventory, and emits the canonical
roster and routing index. All generated records remain inactive until an
independent authority admits them.

The on-demand bootstrap compiler in
`control/specialist-agent-compiler.mjs` composes recipes and immutable blocks
into a task-shaped agent package. It writes only to an external companion or
isolated governed agent workspace and emits the eight machine contracts plus a
generated `bootstrap.md` view. The registry stores recipes and reusable block
references, never permanent task agents.

`registry/recipe-catalog.v1.json` contains the first six P0 control-plane
recipes. `registry/integration-handoff.v1.json` and
`INTEGRATION_HANDOFF.md` carry the exact isolated-candidate disposition and
unfinished admission gates.

The read-only independent evaluator in
`control/specialist-independent-evaluator.mjs` checks package immutability,
source locks, all twelve gate digests, hostile fixtures, handoff custody, and
self-admission denial. It issues a static receipt only; utility/harm and
admission authority remain separate gates.

`registry/master-inventory.v1.json` is the durable Fortune-500-scale backlog.
Its raw role mentions are preserved, and alias mappings explain only exact or
near-exact duplicates. The highest-value waves are sequenced by cross-project
value, risk reduction, frequency, and dependency leverage rather than novelty.

The `2.1rc` posture remains `PREPARED_NOT_ACTIVATED`.
