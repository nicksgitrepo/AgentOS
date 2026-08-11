# Source, Provenance, and Refresh Policy

Status: candidate governance for Foundry review; not a registry-admission policy yet.

## 1. Core rule

Every material statement in a context block is a claim with:

- an evidence class;
- a confidence ceiling;
- a source or derivation reference;
- a scope and version;
- a freshness state;
- a prohibited-inference list;
- an invalidation path.

No prose may silently become a fact, requirement, authority, or permission. A source may support a claim; it never grants a capability.

This policy follows the provenance shape of [W3C PROV-DM](https://www.w3.org/TR/prov-dm/): entities, activities, agents, time, derivations, and bundles. It borrows the verification discipline of [SLSA Provenance v1.2](https://slsa.dev/spec/v1.2/provenance): identify the producer, inputs, process, outputs, and immutable attestation. It uses [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) for structural validation and [RFC 2119 / BCP 14](https://www.rfc-editor.org/info/rfc2119/) requirement vocabulary.

## 2. Authority and evidence classes

| Class | Admission meaning | Required minimum metadata | Ceiling |
|---|---|---|---|
| `owner_intent` | preserves design intent and constraints | source thread ID, title, turn identity, retrieval date | cannot establish domain truth or permission |
| `official_primary` | issuer-owned source for a scoped claim | issuer, canonical URI, edition/version, publication/effective/retirement dates, jurisdiction/product, digest | cannot generalize beyond scope; legal/regulatory/safety content is advisory and version-bound |
| `accepted_engineering` | reproducible method or domain truth accepted for the task family | author/maintainer, version, method, scope, review status, digest | cannot replace official or owner authority |
| `project_record` | descriptive state of a project snapshot | repository/system ID, commit/snapshot, timestamp, source path, digest | cannot establish desired behavior or approval |
| `runtime_observation` | current environment/tool/model fact | run ID, principal, tool/runtime version, observation time, receipt/digest | expires on change; cannot grant authority |
| `evaluation_result` | measured behavior on a named test configuration | suite/task version, baseline, condition, model, harness, run manifest, oracle, result digest | cannot establish general truth or authority |
| `secondary_context` | retrieval aid or explanation | author, URI, date, relation to primary source | cannot be cited as a normative requirement |
| `unresolved_artifact` | opaque or inaccessible material that may be investigated | stable reference, retrieval failure, scope unknown | `C0_UNVERIFIED`; cannot enter an admitted claim |

## 3. Confidence ceilings

The highest allowed claim strength is the lower of the source class ceiling and the claim’s scoped label.

| Label | May support | May not support |
|---|---|---|
| `C0_UNVERIFIED` | discovery lead | any factual assertion, action, or activation |
| `C1_CONTEXTUAL` | orientation, vocabulary, search terms | normative, legal, safety, project, or runtime claims |
| `C2_ACCEPTED_ENGINEERING` | advisory procedure and implementation hypothesis | legal duty, compliance conclusion, owner choice, safety certification, current project state |
| `C3_OFFICIAL_SCOPED` | scoped source-backed requirement or definition | out-of-scope jurisdiction/version, compliance certification, professional judgment |
| `C4_OWNER_AUTHORIZED` | explicit project intent, acceptance, risk tolerance, approval gate | override of hard system safety or legal obligations |
| `C5_RUNTIME_OBSERVED` | current observed tool/project/model fact | future behavior, general domain truth, durable permission |
| `C6_EVALUATED` | performance or harm result on tested configuration | untested model, task distribution, version, or domain generalization |

The label `C3_OFFICIAL_SCOPED` is not a claim that a legal or regulatory answer is correct for every situation. Legal, regulatory, safety, medical, tax, financial, and certification content MUST carry:

```text
advisory_only: true
version_bound: true
qualified_review_required: true when the decision is high-impact
jurisdiction: explicit, never implied
effective_scope: explicit
```

## 4. Source record contract

Each source record MUST include:

```text
source_id
authority_class
title
publisher_or_issuer
canonical_uri_or_local_record_id
version_or_edition
publication_date
effective_from
effective_until_or_retirement_state
jurisdiction_or_product_scope
retrieved_at
content_digest
license_or_access_basis
extraction_method
status: current | superseded | withdrawn | unverified | unresolved
supersession_links
reviewer_or_attestation
```

Preferred digest: SHA-256 over the exact bytes used for extraction. If a source is dynamic, record the retrieval representation, request parameters, timestamp, and any publisher-provided version or ETag. A URL alone is not provenance.

## 5. Claim ledger rules

Each claim MUST be atomic enough to test and invalidate. A claim record should answer:

```text
claim_id
statement
evidence_class
evidence_label
confidence_ceiling
source_refs
scope
required_before
derived_from
prohibited_inference
status
```

Rules:

1. A claim with no source or derivation is `C0_UNVERIFIED`.
2. A derived claim lists every input claim and the deterministic rule or compiler version.
3. A disputed or conflicting claim is not merged by wording preference; it remains disputed and escalates.
4. A source revision creates new claim revisions; historical claims remain immutable.
5. A claim’s scope is the intersection of its source scopes, not their union.
6. An evaluation claim is bound to its exact block digest, model profile, harness, task set, and run configuration.
7. A project fact is time-bound and must not answer “what should happen?”
8. An owner decision is normative only for its named project/scope and must retain its supersession chain.
9. A prohibited-to-infer field is represented explicitly, never filled with a plausible default.

## 6. Provenance graph

The minimum graph is:

```text
Source bytes / project snapshot / runtime observation
        ↓ used_by
Acquisition or observation activity
        ↓ generated
Source record
        ↓ supports
Atomic claim
        ↓ compiled_by / derived_by
Context-block revision
        ↓ evaluated_by
Evaluation result bundle
        ↓ eligible_for
Admission recommendation
        ↓ projects_to
Seed / capsule / runtime instance (only after separate admission)
```

Every edge is typed. The Foundry MUST be able to answer “which exact source and run produced this sentence?” and “which downstream artifacts must be reconsidered if this source changes?”

## 7. Source selection and conflict policy

1. Start with the issuer or system of record for the claim.
2. Prefer a versioned canonical source over a mirror or summary.
3. Use secondary material to find primary material, not to replace it.
4. If two official sources conflict, preserve both scopes and route a typed conflict to the appropriate owner or qualified authority.
5. If applicability is unknown, record `PAI` and create an applicability question; do not choose the more convenient rule.
6. If a source is inaccessible, record the access gap and use only a lower-ceiling pointer.
7. If a chat artifact is cited by the owner as intent, preserve its identity but do not promote it to `official_primary`.

Official-source routing examples:

- U.S. federal regulations: use the [National Archives eCFR/CFR source relationship](https://www.archives.gov/federal-register/cfr) and the issuing agency’s official material; preserve amendment and effective-date context.
- EU law: use [EUR-Lex](https://eur-lex.europa.eu/homepage.html?locale=en%3D), the Official Journal, and applicable national transposition sources.
- UK law: use [legislation.gov.uk](https://publishing.legislation.gov.uk/aboutus), the official home of UK legislation.
- Standards: use the issuing standards body or a licensed official copy; do not treat a blog or checklist as the standard text.
- Software: use the language/runtime/framework maintainer’s specification, release, API, security advisory, or source repository.

## 8. Refresh policy by evidence class

Cadence is a default watch schedule, not permission to skip event-driven invalidation.

| Evidence class | Default watch | Immediate trigger | Review owner |
|---|---|---|---|
| `owner_intent` | no automatic rewrite | owner revision, supersession, or explicit correction | authorized owner/controller |
| `official_primary` | daily change detection where a feed exists; otherwise weekly/monthly according to volatility | amendment, new edition, erratum, effective-date change, withdrawal, jurisdiction change | authority-pack reviewer + qualified owner where needed |
| `accepted_engineering` | at release changes and at least annual review for active blocks | breaking release, security advisory, maintainer correction, reproducibility failure | domain reviewer |
| `project_record` | every task compilation and relevant commit/environment change | repository/lockfile/config/topology/owner change | project fact collector |
| `runtime_observation` | every activation/run or lease change | tool/model/harness/runtime/network/capability change | runtime/tool owner |
| `evaluation_result` | every block revision and model/harness/task-suite change | regression, new harm, oracle change, contamination finding | independent evaluation owner |
| `secondary_context` | on use and at primary-source refresh | source disappears or contradicts primary | research owner |
| `unresolved_artifact` | no use; retry only when a new retrieval path is available | artifact becomes accessible and verifiable | research owner |

High-impact legal, regulatory, safety, medical, financial, or privacy blocks require a named jurisdiction/version watch and qualified review. This policy does not claim that a cadence alone makes a block current.

## 9. Refresh workflow

```text
WATCH → ACQUIRE → VERIFY → DIFF → IMPACT-ANALYZE → QUARANTINE/REVISE
      → RESEARCH GAP → EVALUATE → ADMISSION REVIEW → NEW REVISION
```

Detailed rules:

1. Acquire the new representation without overwriting the old one.
2. Verify publisher identity, digest, version, and retrieval integrity.
3. Diff source, scope, definitions, exceptions, dates, and cross-references.
4. Traverse the provenance graph to find affected claims, blocks, evaluations, seeds, and capsules.
5. Quarantine or suspend affected blocks before the new revision is admitted when the impact is material or uncertain.
6. Rebuild the claim ledger and re-run targeted plus regression evaluations.
7. Create a new content-addressed revision. Preserve the prior revision and historical evaluation receipts.
8. Record a migration note and notify the next accountable controller through a typed handoff.

## 10. Invalidation triggers

Any of the following creates an invalidation event:

- source edition, amendment, effective date, jurisdiction, product, or interpretation changed;
- source digest or signature cannot be verified;
- primary source was withdrawn or superseded;
- project commit, dependency, configuration, data boundary, or desired behavior changed;
- model, reasoning setting, tool schema, harness, runtime, or capability broker changed;
- evaluation regression, new unsafe behavior, test contamination, or oracle change;
- owner decision was corrected, revoked, or superseded;
- a claim’s scope cannot be reconstructed;
- an unresolved field was silently filled;
- a provenance edge or artifact digest is missing;
- a security, privacy, safety, or legal review requires suspension;
- a block was found to cause higher false confidence, authority leakage, or unsafe action than its baseline.

## 11. Quarantine and archive states

- `candidate`: may be edited; not used for admission or activation.
- `research_memo`: evidence inventory exists but the block contract is incomplete.
- `evaluated`: independent tests exist; admission decision is still separate.
- `admitted`: authorized controller accepted this exact digest and scope.
- `suspended`: temporarily unavailable because of an invalidation or incident.
- `retired`: no new use; historical references remain resolvable.
- `archived`: preserved for history and audit; no runtime use.

The Foundry may recommend these transitions but may not self-admit, activate, deploy, migrate, or retire a registry record without the authorized controller.

## 12. Source-backed design basis

- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)
- [SLSA Provenance v1.2](https://slsa.dev/spec/v1.2/provenance)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [Cedar authorization](https://docs.cedarpolicy.com/auth/authorization.html)
- [RFC 2119 / BCP 14](https://www.rfc-editor.org/info/rfc2119/)
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)
