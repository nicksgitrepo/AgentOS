# Research Taxonomy for Context Blocks

## 1. Research objective

The Foundry researches the smallest evidence-bearing package that makes a role more accurate, more bounded, and more verifiable for a defined task family. It does not research an entire domain, copy a handbook into a prompt, or turn a named specialty into implied authority.

Every research campaign MUST answer nine questions:

1. What exact block is being built, for which role, task family, project scope, jurisdiction, technology, and version?
2. Which claims are normative, which are descriptive, and which are merely useful heuristics?
3. What is the authoritative source for each normative claim?
4. What project facts and runtime facts are required at activation time?
5. Which owner decisions cannot be inferred and must remain explicit inputs?
6. What may the block help the agent decide, and what may it never decide or do?
7. What evidence must the agent return to support each material claim?
8. What tests show that the block helps rather than harms against a no-block baseline and narrower alternatives?
9. What event, date, version, source change, project change, or evaluation result invalidates it?

The result is a claim ledger plus a block package. A prose summary without a claim ledger is not an admitted context block.

## 2. Canonical evidence classes

These classes are mutually distinguishable. A fact MUST NOT be silently promoted from one class to another.

| Code | Evidence class | What it can establish | What it cannot establish | Typical source |
|---|---|---|---|---|
| `OPR` | Official primary source | A scoped normative or authoritative statement from the issuing body, with edition/version/effective scope | Universal truth outside its jurisdiction, edition, product, or stated scope | statute, regulation, standard, RFC, language specification, vendor manual, official API/schema |
| `AET` | Accepted engineering/domain truth | A reproducible method, implementation fact, research result, or expert consensus accepted for the defined domain | A legal duty, owner decision, or runtime fact in the current project | peer-reviewed paper, maintainer documentation, reference implementation, established engineering guide |
| `PF` | Project fact | A descriptive fact about the target project at a named revision or snapshot | Desired behavior, approval, or a fact after the snapshot changes | repository commit, config, dependency lock, architecture record, project telemetry |
| `OD` | Owner decision | A normative choice about project intent, risk, acceptance, release, or business behavior | Domain law, general engineering truth, or permission to exceed system safety controls | signed decision record, accepted requirement, explicit owner answer |
| `RTF` | Runtime/tool fact | What the current runtime, tool, model, harness, or capability broker actually exposes or observed | A durable permission, domain truth, or future behavior | introspection, tool schema, version report, capability lease, run receipt |
| `EE` | Evaluation evidence | How a block behaved on a named task set, model, harness, and run configuration | General truth beyond the tested distribution or authority to act | reproducible benchmark, test oracle, independent adjudication, trace |
| `DER` | Derived claim | A traceable conclusion computed from admitted claims and facts | New authority; any inference that exceeds source scope or confidence ceiling | compiler output, deterministic rule, explicit derivation graph |
| `PAI` | Prohibited-to-infer field | An unresolved gap that must remain unknown, be researched, or be answered by an authorized owner | Any safe default invented by the model | missing approval, unknown jurisdiction, unclear desired behavior, unavailable credential |

`DER` is never allowed to outrank its inputs. `PAI` is not a low-confidence guess; it is a hard boundary.

## 3. Confidence labels and ceilings

The label describes evidence strength and permitted use; it does not describe model confidence alone.

| Label | Minimum basis | Permitted use | Ceiling |
|---|---|---|---|
| `C0_UNVERIFIED` | candidate text, unreviewed extraction, or chat suggestion | discovery queue only | MUST NOT guide a side effect or be presented as fact |
| `C1_CONTEXTUAL` | relevant secondary explanation or example | orientation and retrieval hints | MUST NOT establish a normative requirement or project fact |
| `C2_ACCEPTED_ENGINEERING` | reproducible engineering/domain source with scope | advisory procedure, hypothesis, implementation guidance | MUST NOT replace official, owner, legal, regulatory, safety, or runtime evidence |
| `C3_OFFICIAL_SCOPED` | verified official primary source with version, jurisdiction/product, and applicability | scoped normative/advisory claim and evidence obligation | legal/regulatory/safety use remains advisory and version-bound; no claim of compliance, certification, or professional judgment |
| `C4_OWNER_AUTHORIZED` | explicit authorized owner decision with identity and time | project intent, acceptance, risk tolerance, approval gate | MUST NOT override system safety controls, legal duties, or independent verification |
| `C5_RUNTIME_OBSERVED` | current introspection or signed run receipt | current environment/tool/model/project fact | expires on the defined snapshot/change event; MUST NOT be generalized |
| `C6_EVALUATED` | independent, reproducible test result | bounded performance and harm claim on the tested configuration | MUST NOT be generalized to untested models, tasks, domains, or versions |

No label grants capability. The maximum operational posture is the intersection of role, project, task, runtime, and hard prohibitions.

## 4. Cross-cutting research dimensions

Research each dimension once per campaign, then reference it from every applicable block. This is the deduplication spine.

### D1 — Identity and scope

- canonical block ID, class, version, and content digest;
- target role and task family;
- project, repository, component, data class, environment, and jurisdiction;
- included and excluded technologies, editions, locales, and time ranges;
- assumptions that are inputs versus assumptions that are unresolved;
- intended activation triggers and non-trigger examples.

### D2 — Authority map

- official issuer and source hierarchy;
- source edition, revision, publication date, effective date, retirement date, and amendments;
- applicability tests and exceptions;
- conflicts between sources and escalation owner;
- whether a source is normative, explanatory, advisory, or merely illustrative;
- licensing/access constraints and whether a verbatim copy is permitted;
- legal, regulatory, and safety material labeled advisory and version-bound.

### D3 — Domain model and vocabulary

- canonical terms, aliases, identifiers, units, states, entities, relationships, and invariants;
- ambiguity and overloaded terms;
- boundary terms that look similar but require different specialists;
- required version qualifiers;
- examples and counterexamples;
- mappings to project terminology without rewriting source definitions.

### D4 — Procedures and decision rules

- preconditions, steps, branching logic, exceptions, stop conditions, and postconditions;
- what can be discovered versus what must be supplied;
- required evidence per decision;
- deterministic checks versus human judgment;
- safe fallback and refusal behavior;
- procedural claims tied to exact source paragraphs, tests, or project decisions.

### D5 — Inputs, outputs, and handoffs

- required input fields and their evidence classes;
- fields that may remain unknown at each lifecycle gate;
- output schema, proof obligations, receipts, and artifact references;
- handoff recipient, ownership, allowed transformations, and closure condition;
- error, timeout, partial-result, and escalation semantics.

### D6 — Authority and capability boundaries

- role capability ceiling;
- project and task narrowing;
- protected resources, paths, identities, data classes, and environments;
- approvals, leases, separation of duties, and independent verification;
- explicit forbidden actions;
- authority effects that are empty for knowledge/procedure blocks;
- action interception requirements at the broker/tool layer.

### D7 — Project and runtime context

- current repository/commit, dependencies, configuration, architecture, and data boundary;
- active model, reasoning setting, harness, tool schemas, versions, quotas, network posture, and clock;
- available capabilities versus requested capabilities;
- observed behavior, logs, and run identity;
- snapshot time, freshness window, and change detector.

### D8 — Evaluation and evidence

- task strata, baseline, ablations, negative/adversarial cases, and hidden cases;
- success oracle, safety oracle, provenance oracle, and human adjudication rubric;
- model/harness profile and run manifest;
- utility, cost, latency, context, refusal, authority-leakage, stale-use, and harm metrics;
- uncertainty, confidence intervals, reproducibility, and known limits;
- acceptance, quarantine, supersession, and rollback criteria.

### D9 — Invalidation and lifecycle

- source update, amendment, version change, jurisdiction change, tool change, model change, project change, owner-decision change, vulnerability, failed evaluation, and provenance failure;
- TTL or event trigger;
- dependent blocks, seeds, capsules, and evidence affected;
- quarantine versus immediate suspension;
- migration notes and historical immutability;
- re-research and re-evaluation requirements.

### D10 — Prohibited inference and uncertainty

- unknown desired behavior;
- unknown owner approval or release permission;
- unknown regulatory applicability or professional conclusion;
- unknown credential or secret availability;
- unknown runtime behavior not observed or sourced;
- unknown source freshness or jurisdiction;
- conflicting evidence not resolved by an authorized controller;
- safety-critical or high-impact decisions requiring qualified human review.

## 5. Block-class taxonomy

Each class below has one canonical research job. The cross-cutting dimensions above are referenced by ID to prevent duplicated or contradictory research.

### B1 — Policy / governance block

Research exactly:

- authority order, hard constraints, deny-by-default rule, and conflict handling;
- role capability ceilings, protected resources, approvals, leases, and separation of duties;
- stop, refusal, escalation, audit, retention, and incident rules;
- compiler and broker enforcement points;
- policy version, issuer, scope, test cases, and invalidation triggers.

Evidence must be `OD`, `OPR`, or a controller-issued governance record. A policy block MUST NOT infer a capability from a specialty or context block.

### B2 — Role procedure block

Research exactly:

- role purpose, accountable outcome, non-goals, and decision rights;
- entry conditions, workflow, checkpoints, proof obligations, handoffs, and archive condition;
- allowed tools as interfaces, not as implicit permission;
- failure modes, escalation routes, and expected evidence quality;
- role-specific evaluation tasks and independent-verifier requirements.

Primary evidence is owner/project governance plus accepted engineering practice. The block does not establish domain truth.

### B3 — Specialty procedure block

Research exactly:

- domain concepts, versioned methods, algorithms, invariants, edge cases, and common failure modes;
- which questions the specialty can answer and which adjacent questions require another specialist;
- source-backed decision rules and examples/counterexamples;
- required project facts and authority packs;
- specialty-specific proof requirements and safe refusal triggers.

Specialty context adds knowledge and obligations only. `authority_effect.grants` MUST be empty.

### B4 — Official authority pack

Research exactly:

- source identity, issuer, official location, edition/revision, effective and retirement dates;
- exact scoped provisions, definitions, exceptions, applicability tests, and cross-references;
- official interpretation or enforcement material, if applicable;
- jurisdiction, product, industry, and audience boundaries;
- conflict and precedence map;
- permitted quoting/extraction method, digest, and refresh watch.

For legal, regulatory, safety, medical, financial, and certification sources, the pack MUST state `advisory_only: true` unless a qualified authority explicitly establishes a different governance posture. A summary, blog, chat response, or generated extraction can be a pointer or `C1_CONTEXTUAL`; it is not the authority pack.

### B5 — Knowledge / reference block

Research exactly:

- detailed explanations, examples, tables, code patterns, diagrams, and troubleshooting references;
- prerequisite concepts and links to authority claims;
- minimum useful excerpt and lazy-loading boundaries;
- indexing terms and retrieval cues;
- known ambiguity, outdated examples, and conflicting guidance.

The Agent Skills specification supports separating small discovery metadata, activated instructions, and lazy resources. Use that packaging pattern without treating the specification itself as domain authority.

### B6 — Project-fact snapshot

Research exactly:

- repository, commit, branch, configuration, dependency versions, service topology, data classes, interfaces, and current tests;
- current owners, worktree, environment, and evidence destinations;
- observed behavior and reproduction details;
- fact source, timestamp, digest, and snapshot expiry;
- explicit distinction between observed state and desired state.

Project facts are descriptive. They MUST NOT silently fill owner decisions or domain applicability.

### B7 — Owner-decision block

Research exactly:

- the smallest decision the owner must make;
- decision alternatives, consequences, affected scope, and required timing;
- existing accepted decisions and their supersession chain;
- approver identity, authority, timestamp, and evidence;
- whether the decision affects acceptance, safety, privacy, data loss, compatibility, spending, release, or deployment.

The model may formulate a typed question and summarize trade-offs. It MUST NOT choose the answer where the field is `PAI`.

### B8 — Task template / Task IR block

Research exactly:

- typed slots, field owners, evidence classes, lifecycle gates, and conditional requirements;
- derived constraints, proof obligations, stop conditions, and required verifier roles;
- routing rules, specialist fan-out, writer leases, and non-overlap constraints;
- partial validity versus compile-ready completeness;
- rejection conditions when constraints cannot be unified.

Task IR is the compiler’s contract. It may contain explicit unknowns; it may not manufacture a complete world from missing inputs.

### B9 — Tool / runtime adapter block

Research exactly:

- tool name, version, schema, input/output types, side effects, error semantics, quotas, timeouts, and idempotence;
- capability-to-action mapping, preconditions, approval requirement, and broker interception point;
- runtime identity, model profile, harness, network/filesystem boundary, and observed limits;
- redaction, secret handling, logging, and receipt requirements;
- compatibility and invalidation triggers.

Tool documentation describes an interface; it does not grant permission. The runtime broker MUST enforce the compiled lease.

### B10 — Evaluation block

Research exactly:

- representative, boundary, adversarial, and hidden tasks;
- no-block baseline, focused-block variant, overstuffed variant, stale/mismatched variant, and optional self-authored variant;
- deterministic and human oracles;
- utility, harm, efficiency, provenance, and authority metrics;
- model/harness compatibility envelope;
- test data privacy, licensing, and contamination controls;
- pass, quarantine, regression, and re-evaluation gates.

Evaluation evidence is scoped to the tested configuration. It never upgrades a block into official authority.

### B11 — Handoff / evidence block

Research exactly:

- output types, claim IDs, source IDs, evidence links, artifact digests, and uncertainty;
- recipient, ownership transfer, allowed transformations, and acknowledgment;
- unresolved questions, blocked fields, and escalation state;
- verification receipt and closure conditions;
- retention, redaction, and audit requirements.

Handoffs transfer typed evidence, not unbounded authority or hidden context.

### B12 — Lifecycle / invalidation block

Research exactly:

- revision identity, supersession, suspension, retirement, and archive states;
- source watches, TTLs, event triggers, and impact analysis;
- dependency graph from source to claim to block to seed/capsule/evaluation;
- quarantine and rollback behavior;
- immutable historical records and migration requirements.

No block is silently edited in place after admission or use.

### B13 — Model / harness profile

Research exactly:

- model ID, reasoning setting, context/compiler rendering mode, tokenizer/budget assumptions, tool-call semantics, and harness version;
- tested task distribution and known failure envelope;
- supported block size, progressive-loading behavior, latency, and cost;
- model-specific refusal, instruction-following, and citation behavior;
- re-evaluation triggers on model, system prompt, tool, or harness changes.

This block establishes compatibility evidence, not domain expertise or permissions.

## 6. Official-primary-source routing map

The Foundry MUST route research to the issuer and version that actually owns the claim.

| Domain family | First source lane | Boundary |
|---|---|---|
| Language/runtime/framework/API | language specification, official runtime/framework docs, release notes, source repository, official security advisories | do not generalize across versions or vendors |
| Internet/protocol standard | RFC Editor / IETF publication and errata | use requirement keywords only as defined by the document; preserve version |
| Web platform | W3C, WHATWG, browser vendor standards/docs | distinguish normative standard from implementation behavior |
| Software supply chain | SLSA, in-toto, SPDX, CycloneDX, OpenSSF specifications | attestations describe provenance; they do not prove semantic correctness |
| Authorization/policy | official policy-language specification and implementation docs | policy engine semantics do not replace runtime enforcement or project policy |
| Privacy/regulation | jurisdiction’s official legislation, regulator, official register, guidance, and effective amendments | advisory and version-bound; no legal conclusion from a summary |
| Safety/medical/critical systems | regulator, official standard issuer, licensed standard text, safety case, qualified professional | no safety certification or professional judgment inferred |
| Finance/tax/reporting | regulator, statute, official rule, accounting standard/licensed text, filing instructions | no filing, signing, or protected financial event without qualified authority |
| Security | official standard/control catalog, vendor advisory, CVE/CNA record, maintained project security documentation | severity and applicability remain scoped and require current evidence |
| Project facts | repository, lockfile, config, CI, runtime introspection, accepted project record | observation is time-bound; desired behavior remains owner-owned |

The same topic may have several source lanes. The source hierarchy is part of the block and must be explicit.

## 7. Deduplication and composition rules

- One canonical claim ID per claim; blocks reference claims rather than restating them.
- One source record per exact source/version/digest; derived claims point to source records.
- One vocabulary entry per canonical term; aliases point to it.
- One policy rule per authority boundary; role, specialty, project, task, and runtime layers reference or narrow it.
- One project fact snapshot per named commit/environment/time; later snapshots are new records.
- One owner decision per decision ID and supersession chain.
- One evaluation result per block digest × model × harness × task-set version × run configuration.
- When two blocks disagree, preserve both claims with scope and escalate; do not merge by prose preference.
- When a new block is merely a narrower view of an existing block, create a projection/reference, not a duplicate copy.

## 8. Minimum research packet before candidate authoring

The Foundry may author a candidate only when it has:

1. exact block class, target role, task family, and scope;
2. source inventory with authority class and version metadata;
3. claim ledger with evidence labels and confidence ceilings;
4. glossary and boundary terms;
5. required inputs and explicit `PAI` fields;
6. prohibited actions and authority effect;
7. output and handoff contract;
8. invalidation triggers and refresh plan;
9. evaluation design with baseline, ablations, and harm oracles;
10. unresolved gaps and an escalation owner.

If any of these are missing, the output remains a research memo or `C0_UNVERIFIED` candidate, not a context block eligible for admission.

## 9. Intentionally out of scope for context research

The Foundry MUST NOT load or invent:

- unrelated technologies, jurisdictions, industries, or standards;
- the entire enterprise roster when only one role/task family is in scope;
- hidden project facts, credentials, secrets, or owner preferences;
- generic “best practices” as if they were requirements;
- legal, medical, safety, tax, financial, or certification conclusions;
- model lore or benchmark claims without reproducible evidence;
- capabilities, permissions, deployment authority, or tool access inferred from knowledge;
- generated chat artifacts as admitted authority;
- stale examples without a visible version and freshness label.

## 10. Source basis

- [Agent Skills Specification](https://agentskills.io/specification)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)
- [Cedar authorization semantics](https://docs.cedarpolicy.com/auth/authorization.html)
- [SLSA Provenance v1.2](https://slsa.dev/spec/v1.2/provenance)
- [RFC 2119 / BCP 14](https://www.rfc-editor.org/info/rfc2119/)
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)
- [NIST AI TEVV](https://www.nist.gov/ai-test-evaluation-validation-and-verification-tevv)
- [SkillsBench preprint](https://arxiv.org/abs/2602.12670)
- [U.S. Code of Federal Regulations source routing](https://www.archives.gov/federal-register/cfr)
- [EUR-Lex](https://eur-lex.europa.eu/homepage.html?locale=en%3D)
- [UK legislation publishing](https://publishing.legislation.gov.uk/aboutus)
