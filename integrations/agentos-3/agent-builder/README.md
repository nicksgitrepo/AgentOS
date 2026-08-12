# Agent Builder / Context-Block Foundry — Checkpoint 01

Status: `EVALUATION_CANDIDATE_READY_FOR_INDEPENDENT_RERUN`

Lifecycle posture: `CANDIDATE_PACKAGE / NOT_ADMITTED / NOT_ACTIVATED`

Evaluation posture: `STATIC_SEMANTIC_CORRECTION_PASSED / UTILITY_HARM_NOT_RUN`

Model/reasoning requirement: `gpt-5.6-luna / max`

This checkpoint answers the owner’s latest question—what the Agent Builder must research to build context blocks—and packages the first source-backed governance and evaluation slice. All artifacts remain candidate-only.

## Deliverables

- [Research taxonomy](./research-taxonomy.md): a deduplicated inventory of research questions, grouped by block class and tagged by evidence type.
- [Typed context-block JSON Schema](./context-block.schema.json): machine-validation contract for candidate and admitted blocks.
- [Typed interface](./context-block.interface.ts): readable TypeScript interface and typed handoff shapes.
- [Source, provenance, and refresh policy](./source-provenance-refresh-policy.md): authority labels, confidence ceilings, provenance fields, refresh cadence, and invalidation rules.
- Agent Builder governance/bootstrap packet: retained only in the private source
  package because it contains private source identity; the sanitized executable
  boundary is represented by the typed schemas, adapter, and integration
  receipts in this release candidate.
- [Evaluation plan](./evaluation-plan.md): positive, negative, adversarial, stale, contradictory, bloat, compatibility, provenance, false-expertise, and skills-help-vs-harm tests with independent admission gates.
- [Three-layer product model](./product-layer-model.md): one-way research dossier → admitted knowledge store → runtime context block provenance, admission, invalidation, privacy, and capability boundaries.
- [Typed Task IR / Task Packet schema](./task-ir.schema.json): typed fields, conditional constraints, constraint-resolution milestones, and candidate-only lifecycle.
- [Typed Task IR interface](./task-ir.interface.ts): TypeScript contract for Task Packet fields, conditional rules, constraints, compilation, and handoffs.
- [Task IR fixtures](./fixtures/task-ir/): one valid fixture and six representative invalid fixtures.
- [Deterministic validator](./validate_task_ir.py): local fail-closed proof for contradictions, protected decisions, authority escalation, stale blocks, and context-budget overflow.
- [Context-block semantic validator](./validate_context_blocks.py): local fail-closed proof for authority grants, stale sources, provenance/scope/version/digest, duplicate IDs, candidate lifecycle, protected data, and progressive-loading budgets.
- [Context-block fixtures](./fixtures/context-block/): one valid and twelve representative invalid instances.
- [Evaluation receipt](./evaluation-receipt.md): exact correction results and independent-rerun boundary.
- Owner-intent register: deliberately excluded from this public projection;
  owner source identity remains private and contributes no runtime authority.

## What this checkpoint does not do

It does not edit Product or project repositories, activate or publish agents, admit a registry record, migrate the draft library, deploy anything, or convert the cited owner-design artifacts into domain authority.

## Governing design decisions preserved from the owner source

The package preserves these owner decisions as design intent:

1. Agent Foundry is a compiler and package ecosystem, not merely a roster generator.
2. The canonical task object is typed Task IR; Markdown is a rendering, not the source of truth.
3. Knowledge, authority, and process topology are separate composition axes.
4. Context can add knowledge, procedures, constraints, and evidence obligations; it cannot grant capabilities.
5. Capability composition is monotonic and deny-by-default; the effective lease is the most restrictive intersection.
6. Official-source authority packs are versioned and scoped; legal, regulatory, and safety material remains advisory and version-bound.
7. Specialist + role + project compilation creates a temporary capsule; a registry shell is not an activated expert.
8. Candidate blocks require independent evaluation; Foundry self-authorship is not self-admission.
9. Historical evidence is immutable; changes create new revisions and can invalidate downstream builds.
10. A large named library remains a draft inventory until exact sources, scope, evaluation, model compatibility, and owner admission exist.

## Primary-source basis used in this checkpoint

The research policy is grounded in the following current or versioned primary sources:

- [Agent Skills Specification](https://agentskills.io/specification) — supports progressive disclosure and separating metadata, instructions, and lazy resources; it does not establish domain authority.
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) — machine-readable validation basis for the block interface.
- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) — provenance model for entities, activities, agents, derivations, and bundles.
- [Cedar authorization model](https://docs.cedarpolicy.com/auth/authorization.html) — reference pattern for explicit permits, default deny, and forbid-overrides-permit; it is not a required implementation choice.
- [SLSA Provenance v1.2](https://slsa.dev/spec/v1.2/provenance) — versioned, verifiable provenance concepts and source-to-artifact traceability.
- [RFC 2119 / BCP 14](https://www.rfc-editor.org/info/rfc2119/) — controlled use of requirement words such as MUST, SHOULD, and MAY.
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10) and [NIST AI RMF TEVV](https://www.nist.gov/ai-test-evaluation-validation-and-verification-tevv) — risk-aware measurement and test/evaluation/validation/verification framing. NIST describes the framework as voluntary; it is not legal advice.
- [SkillsBench](https://arxiv.org/abs/2602.12670) — independent research evidence that context can help and can harm; treated as evaluation evidence, not normative authority.
- [eCFR / Federal Register relationship](https://www.archives.gov/federal-register/cfr), [EUR-Lex](https://eur-lex.europa.eu/homepage.html?locale=en%3D), and [UK legislation publishing](https://publishing.legislation.gov.uk/aboutus) — examples of jurisdiction-specific primary-source routing. Legal and regulatory content remains advisory, jurisdiction-bound, and version-bound.

## Independent-rerun boundary

The correction is ready for an independently routed utility/harm evaluation rerun. This state claims only deterministic static/semantic validation; it does not claim adoption, registry admission, activation, or runtime usability. An authorized controller must supply the frozen candidate block, task suite, model/harness profile, evaluator, and oracle before full evaluation can proceed.

## Deterministic proof

Run `python3 validate_task_ir.py` and `python3 validate_context_blocks.py` from this package directory. The validators must produce `RESULT PASS 7/7 deterministic cases` and `RESULT PASS 13/13 context-block semantic cases`; see [evaluation-receipt.md](./evaluation-receipt.md) for the exact receipt.
