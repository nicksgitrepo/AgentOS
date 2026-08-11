# Three-Layer Agent Foundry Product Model

Status: CANDIDATE DESIGN / NOT_ADMITTED / NOT_ACTIVATED

The Agent Foundry has three different products. They are not three names for one prompt.

~~~text
Research Dossier
    ↓ verified, scoped, claim-extracted, independently reviewed
Admitted Knowledge Store
    ↓ Task IR + role + project + model/harness projection
Runtime Context Block
    ↓ ephemeral use with separate capability lease
Runtime instance
~~~

The arrows are one-way provenance and admission boundaries. A downstream artifact may cite upstream evidence; it may not rewrite, promote, or grant authority to upstream material.

## 1. Research dossier

Purpose: preserve the broad research campaign and its uncertainty before admission.

Contains:

- raw and normalized source references;
- primary-source candidates and secondary retrieval aids;
- source versions, dates, jurisdiction, licenses, digests, and retrieval records;
- claim candidates, contradictions, alternatives, negative findings, and unresolved PAI fields;
- research notes, source diffs, incident examples, and evaluation hypotheses;
- privacy classification, redaction decisions, retention, and access custody.

State: RESEARCH_ONLY, UNRESOLVED, or QUARANTINED.

The dossier may be large. It is not runtime context. It may contain unverified or conflicting material, but every such item must be labeled. It MUST NOT:

- be loaded directly into a runtime instance as authority;
- grant a capability or tool permission;
- become an admitted claim without source verification, scope, provenance, and review;
- contain secrets or unnecessary personal/regulated data;
- silently overwrite an older research record.

Dossier provenance points outward to source bytes, observations, and owner intent. It does not point backward from a runtime output as if that output were authority.

## 2. Admitted knowledge store

Purpose: retain the reusable, claim-level, source-backed knowledge and procedures that passed admission review.

Contains:

- accepted claims with evidence label and confidence ceiling;
- versioned terms, procedures, examples, counterexamples, and boundary rules;
- official authority-pack references;
- source/claim derivation graph;
- independent evaluation results and compatible model/harness profiles;
- refresh watches, invalidation triggers, supersession links, and admission receipts;
- privacy-minimized resources and access policy.

State: CANDIDATE, EVALUATED, ADMITTED, SUSPENDED, RETIRED, or ARCHIVED.

Admission requires an authorized controller. The store is not the registry of runtime permissions. It MUST NOT:

- issue a capability lease;
- turn a domain specialty into a role capability;
- erase uncertainty or PAI fields;
- generalize an evaluation result beyond its tested block/task/model/harness scope;
- silently replace a prior revision.

Knowledge-store provenance is one-way from dossier/source evidence through claim extraction, review, and evaluation. Admission is a gate, not a rewrite of the dossier.

## 3. Runtime context block

Purpose: provide the smallest tested projection of admitted knowledge needed for one Task IR, role, project overlay, and model/harness profile.

Contains:

- exact admitted block digests and source/claim references;
- eager summary and activation instructions;
- lazy resources loaded only when needed;
- task-specific scope and exclusions;
- required evidence, procedures, terms, and refusal/escalation rules;
- context budget, compatibility profile, and projection receipt;
- invalidation cursor and source freshness state.

State: COMPILED, LOADED, INVALIDATED, QUARANTINED, or ARCHIVED.

A runtime context block is ephemeral and task-bound. It MUST NOT:

- accept raw dossier material as authority;
- promote a candidate claim to admitted knowledge;
- grant, widen, or imply a capability lease;
- override role/project/task/runtime policy;
- survive a source, block, Task IR, model, harness, tool, or privacy-boundary invalidation;
- retain protected data beyond the approved runtime/trace policy.

The runtime broker enforces capabilities separately. The context block can add restrictions and evidence obligations only; its capability grant set is always empty.

## 4. One-way provenance and admission

| Direction | Allowed | Forbidden |
|---|---|---|
| source → dossier | acquire, hash, classify, preserve | source substitution or silent overwrite |
| dossier → knowledge store | extract claims, verify scope, review, evaluate, admit exact revision | direct promotion, missing provenance, conflict erasure |
| knowledge store → runtime block | compile a scoped projection from admitted digests | loading candidates, stale revisions, or out-of-scope blocks |
| runtime block → evidence | emit run receipts, observations, and evaluation results | rewriting authority or admitting itself |
| runtime evidence → dossier | append a separate observation/evaluation record | treating runtime behavior as domain truth |

The compiled block records:

~~~yaml
provenance:
  dossierRefs: [<immutable dossier/source refs>]
  admittedBlockRefs: [<exact admitted digests>]
  taskIrRef: <exact Task IR digest>
  projectionCompiler: <compiler version>
  modelHarnessRef: <tested profile>
  projectionReceipt: <immutable receipt>
~~~

No downstream layer may claim a higher confidence label than its inputs. Evaluation evidence can establish tested behavior; it cannot establish official authority.

## 5. Invalidation flow

- Dossier invalidation: source withdrawal, digest failure, license/access change, or privacy finding. Affected claims remain quarantined.
- Knowledge-store invalidation: primary-source amendment, supersession, changed applicability, failed review, security/safety finding, or evaluation regression. Affected revisions become suspended or retired.
- Runtime-block invalidation: any affected admitted digest, Task IR scope, project snapshot, model/harness, tool schema, budget, privacy boundary, or capability policy changes. The block must fail closed and be recompiled.
- Historical records remain immutable. New evidence creates a new revision and a new provenance edge.

## 6. Privacy boundaries

| Layer | Default data posture | Required controls |
|---|---|---|
| Research dossier | broadest, but still minimum necessary | source licensing, access control, redaction, retention, provenance, no secrets |
| Knowledge store | minimized admitted content | claim-level scope, redacted resources, audience/role access, audit, deletion/invalidation |
| Runtime context block | smallest task-scoped projection | no secrets by default, least data, budget, ephemeral retention, trace redaction |

Personal, regulated, confidential, or safety-sensitive data requires an explicit source class, purpose, access boundary, retention rule, and qualified review where applicable. Context compilation cannot widen access.

## 7. Capability boundaries

Knowledge and authority are separate products:

~~~text
knowledge projection ⊥ capability lease
~~~

The runtime lease is calculated outside the block:

~~~text
role ceiling
  ∩ project ceiling
  ∩ Task IR requested scope
  ∩ runtime availability
  − hard forbids
~~~

A runtime context block has authorityEffect.grants = []. A dossier and knowledge store have no runtime lease at all. The broker must reject actions not contained in the compiled lease, even if a context block describes the action as common or recommended.

## 8. Lifecycle handoff

1. Researcher creates dossier records and unresolved claim ledger.
2. Authority/knowledge reviewers select claims for admission review.
3. Independent evaluator produces scoped evidence.
4. Admission controller accepts or rejects the exact knowledge-store revision.
5. Task compiler projects only admitted revisions into a runtime context block.
6. Runtime/evidence controller records use, invalidation, and evaluation observations.
7. Refresh controller suspends dependents on source or environment change.
8. Archive controller preserves historical records without runtime reuse.

This model closes the architecture gap while preserving the owner distinction between broad research, reusable admitted knowledge, and compact task-specific runtime context.
