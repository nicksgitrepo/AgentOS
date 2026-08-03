# 1240 — V1 Governance 2.1rc Portable Authority Corpus Format

Status: `RELEASE CANDIDATE — PORTABLE, NOT ACTIVATED`

## 1. Purpose

This article defines the generated project authority-corpus numbering,
article order, common Markdown format, feature-block allocation, active
campaign separation, and extension rules. It contains no project context.
Its immutable half-open numeric article blocks are portable across projects.

Ranges are half-open: the start is included and the end is excluded. This
prevents the boundary article from belonging to two ranges.

## 2. Number ranges

| Range | Purpose |
|---|---|
| `000` | Bootstrap and recovery entry |
| `0001–0099` | Portable governance |
| `0100–0199` | Shared project context and documentation |
| `0200–0299` | First allocated feature |
| each later 100-number block | One additional feature or a linked feature extension |

Article IDs are immutable. Imported allocations are preserved. New feature
IDs are sorted by unsigned UTF-8 byte order and assigned the next free
100-number block. A full block receives a linked extension block; accepted
articles are never renumbered. Every extension chain is acyclic and must
terminate at exactly one primary block for the same feature.

Filenames are `<article>-<short-stable-slug>.md`. The generated machine index
binds every article number, path, owner, class, feature allocation, current
content digest, supersession, and accepted-release identity.

## 3. Governance core

| Article | Purpose |
|---|---|
| `0001` | Governance index and constitution |
| `0002` | Authority order and conflict resolution |
| `0003` | Roles, scope, custody, and owner-only boundaries |
| `0004` | Campaign lifecycle and macro goals |
| `0005` | Worktrees, leases, checkpoints, and handoffs |
| `0006` | Root cause, supervisor reframe, failure classes, and blockers |
| `0007` | Audit, proof, acceptance, and correction batching |
| `0008` | Runtime, integration, release, deployment, and rollback |
| `0009` | Security, secrets, provider access, and authentication |
| `0010` | Authority-corpus generation, indexing, and maintenance |
| `0011` | Bootstrap and context elicitation |
| `0012` | Evidence active window, archives, and historical recovery |
| `0013` | Model selection, reasoning, and expected-cost policy |
| `0014` | Machine schemas, deterministic transitions, and hostile verification |
| `0015` | Governance version and migration history |
| `0016–0099` | Reserved governance expansion |

## 4. Shared project core

| Article | Purpose |
|---|---|
| `0100` | Project index and reading order |
| `0101` | Vision, intended outcome, and success |
| `0102` | Users, operators, and recurring use cases |
| `0103` | Non-goals and protected boundaries |
| `0104` | Architecture and system map |
| `0105` | Repositories, build system, tooling, and generated outputs |
| `0106` | Shared data, database, tenancy, and row security |
| `0107` | Shared backend, API, contracts, and events |
| `0108` | Shared UI, views, shell, and navigation |
| `0109` | Design Bible, tokens, components, patterns, and protected surfaces |
| `0110` | Security, privacy, identity, and application authentication |
| `0111` | Integrations, providers, environments, and provider access |
| `0112` | Runtime, configuration, observability, and recovery |
| `0113` | Test strategy, proof levels, and acceptance environments |
| `0114` | Merge, release, promotion, rollback, and deployment policy |
| `0115` | Canonical glossary and terminology |
| `0116` | Decision index |
| `0117` | Case and failure-class index |
| `0118` | Feature registry and dependency graph |
| `0119` | Active and historical campaign registry |
| `0120` | Owner questions, context gaps, and accepted safe defaults |
| `0121` | Agent roles, naming, model rules, pinning, and session lifecycle |
| `0122` | Evidence-library and archive index |
| `0123` | Project-context change history |
| `0124–0199` | Reserved shared-project expansion |

## 5. Feature block

For a feature whose block begins at `x00`, use:

| Offset | Purpose |
|---|---|
| `x00` | Feature index and reading order |
| `x01` | Intent and user outcome |
| `x02` | Outcome gates and current status |
| `x03` | Users, workflows, and contextual examples |
| `x04` | Ownership, scope, non-goals, and protected boundaries |
| `x05` | Dependencies and dependency order |
| `x06` | Contracts, interfaces, events, and compatibility |
| `x07` | Data, database, tenancy, and row security |
| `x08` | Backend, API, services, and durable behavior |
| `x09` | UI/UX, views, responsive behavior, and accessibility |
| `x10` | Shell, navigation, routing, and mounting |
| `x11` | Integrations and provider seams |
| `x12` | Security, privacy, authorization, and hostile boundaries |
| `x13` | Runtime, configuration, observability, and recovery |
| `x14` | Tests, proof, and affected stable gates |
| `x15` | Failure and honest unavailable behavior |
| `x16` | Accepted implementation map: paths, symbols, variables, schemas |
| `x17` | Compact event and build log |
| `x18` | Handoffs, checkpoint identity, and archived session lineage |
| `x19` | Feature decisions and supersession |
| `x20` | Accepted release history |
| `x21` | Open owner questions and context gaps |
| `x22` | Deferred improvements and next-cycle backlog |
| `x23–x79` | Reserved feature expansion |
| `x80–x89` | Feature-specific case statements and failure examples |
| `x90–x99` | Extension-block, migration, and compatibility references |

Platform Agents do not create separate competing truth. Their compact
pseudocode, implementation notes, and handoff details go in the feature
article for the seam they changed. Detailed raw output stays in the
release-scoped evidence library.

## 6. Common article header

Every standard article begins with:

```text
article: <immutable number>
title: <short stable title>
status: <DRAFT | PLANNED | BUILDING | PROTOTYPED | TESTING | VERIFIED | ACCEPTED_LIVE | ON_HOLD | DEFERRED | UNAVAILABLE | SUPERSEDED>
owner: <one role or owner ID>
applies_to: <project, feature, capability, environment, or release>
accepted_release: <exact accepted-live identity or UNRELEASED>
source_commit: <exact source identity or NOT_APPLICABLE>
supersedes: <article identity or NONE>
updated_at: <UTC>
```

Status is not proof. `VERIFIED` means the stated non-live proof passed.
`ACCEPTED_LIVE` requires the accepted-live closure identity.

## 7. Feature article body

Use the smallest applicable subset in this order:

```text
## Purpose
## Current truth
## Boundaries
## Interfaces
## Failure / unavailable
## Paths and symbols
## Pseudocode
## Gates
## Handoff
## History links
```

Do not duplicate unchanged text merely to fill headings. Omit an inapplicable
section or write `NOT_APPLICABLE`. Paths and symbols are compact navigation,
not raw evidence. Pseudocode explains the accepted behavior and invariants,
not a second implementation.

## 8. Gate format

Each gate has one ID, intent sentence, owner, lifecycle status, evidence
disposition, dependency list, completion condition, current proof class, and
failure/unavailable behavior. It also has an `accepted_live_closure` field,
which is null until accepted-live and then binds the exact deployed identity,
rollback identity, independent audit digest, and closure-receipt digest.
Deployed and rollback identities are content-addressed SHA-256 objects and
each carries its own receipt digest; free-form release labels are insufficient.
Allowed lifecycle statuses are:

`PLANNED`, `BUILDING`, `PROTOTYPED`, `TESTING`, `VERIFIED`,
`ACCEPTED_LIVE`, `ON_HOLD`, `DEFERRED`, `UNAVAILABLE`, `SUPERSEDED`.

Evidence disposition is separately one of `PASS_WITH_EVIDENCE`,
`FAIL_ACTIVE_REPAIR`, `UNPROVEN_ACTIVE_EVIDENCE`,
`NOT_APPLICABLE_WITH_EXACT_AUTHORITY`, or `OWNER_ONLY`. Lifecycle progress
never implies evidence, and evidence never silently implies accepted-live
status. The Auditor may add or correct gates from source-backed intent. A
Feature Agent may advance a gate only with the required proof. Campaign work
does not rewrite a standard gate to `ACCEPTED_LIVE` before accepted-live
closure. `ACCEPTED_LIVE` plus passing evidence without those four closure
identities fails closed.

## 9. Active campaigns and promotion

Active campaign files live under
`campaigns/<release>-<short-campaign-slug>/` and use a fixed compact set:

1. `00-current.md`;
2. `01-dependency-plan.md`;
3. `02-root-checkpoint-and-handoff.md`;
4. `03-audit-gaps.md`;
5. `04-owner-questions.md`;
6. `05-release-and-rollback.md`.
7. `06-gpt-assist-project-status.md` only when the owner enabled
   `GPT_ASSIST`.

The campaign tree is the recovery source for work in progress. Standard
numbered articles remain the last accepted-live truth. At accepted-live
closure, the Orchestrator promotes only changed accepted truth into affected
standard articles, updates indexes and release history, and freezes the
campaign record. Raw evidence is packaged separately according to the
configured evidence policy.

## 10. Rejection rules

Reject:

- overlapping ranges or duplicate article IDs;
- an imported feature block that moves or changes owner without an explicit
  migration;
- feature insertion that renumbers an existing article;
- campaign work represented as accepted-live standard truth;
- handoff text containing raw test output, screenshots, or evidence packets;
- gate status without its required proof class;
- accepted-live status without deployed, rollback, audit, and closure identity;
- an orphaned, cyclic, cross-feature, or non-primary-rooted extension chain;
- a page without one owner, source identity, failure behavior, and
  supersession state;
- an article whose machine-index metadata disagrees with its header.
