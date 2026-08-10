# Evidence and identity

article: RAPID_FOUNDATION_10
title: Evidence and identity
status: DRAFT
owner: FOUNDATION_EVIDENCE_AND_IDENTITY
applies_to: bounded rapid governance prototype
accepted_release: UNRELEASED
source_commit: SOURCE_READBACK_REQUIRED
source_tree: SOURCE_READBACK_REQUIRED
supersedes: NONE

## Purpose

This foundation keeps every consequential claim tied to the real source, the
real execution identity, the exact bounded task, and an observable result. A
label, narration, stale export, or caller-supplied assertion is not evidence.
The lane defines the minimum readbacks and receipts needed for a public,
portable handoff. It does not make the handoff independently clear.

## Boundary

In scope:

- the pre-write source-binding and identity gate for this lane;
- typed evidence for project, environment, working directory, Git source,
  admitted role, exact goal, changed paths, checks, and closure;
- content-addressed receipts that let a later reviewer reproduce or compare a
  claim without copying raw private records into public authority;
- explicit `PASS`, `FAIL`, and `UNAVAILABLE` outcomes;
- a compact handoff that is ready for independent clearance.

Out of scope:

- product requirements, design approval, security approval, delivery, release,
  deployment, publication, spending, or authentication;
- creating, admitting, routing, or supervising roles or workers;
- deciding owner intent or expanding the lane boundary;
- storing raw logs, private paths, project identifiers, credentials, provider
  identities, chat links, or session records in this public file;
- treating a compatibility export, inherited roster entry, generic worker, or
  shell stand-in as an admitted role or real identity.

The lane may write exactly its own public lane file. A control-plane receipt
may carry more exact identity detail, but the public foundation carries only
portable field names, safe summaries, and digests.

## Definitions and evidence roots

Identity is the observed binding between an execution and its authorized
source and task. Evidence is a receipt of one bounded observation or check.
A digest proves that a receipt payload is the same payload later read back; it
does not, by itself, prove that the payload was truthful or authorized.

Every receipt must identify its evidence kind, exact source binding, bounded
subject, observation time, outcome, and receipt digest. Exact project paths and
execution identities remain control-plane data when they are not safe for the
public record.

| Evidence root | Required observation | What it proves |
| --- | --- | --- |
| Source | Project identity, environment kind, digests of the canonical working directory and Git top level, source commit, and committed source tree | The work is attached to the intended source binding without publishing the raw path. |
| Actor | Host-readback session identity, pinned identity, admitted role/lane, and exact goal/task | The work was performed by the admitted actor for the admitted purpose. |
| Scope | Allowed output path set and before/after changed-path comparison | The work stayed within the lane boundary. |
| Check | Check identifier, observed result, source binding, and result digest | The named check actually ran against the named source. |
| Closure | Handoff digest, independent-check state, and close/archive state | The outcome can be transferred without silently claiming acceptance. |

Source identity and working-tree state are separate facts. `source_commit` and
`source_tree` come from Git readback of the bound committed source. Dirty or
uncommitted files are recorded separately; they must never be silently
re-described as the committed source or as a clean delivery state.

## Intended behavior

The lane follows this order:

1. Read the expected source-bound goal and its identity fields without writing.
2. Read the host project identity and environment. Compare them exactly with
   the expected binding; display names and path similarity are insufficient.
3. Read the canonical working directory and Git top level. Both must match the
   expected project location exactly. Record the Git common directory when the
   host exposes it, but do not substitute it for the top-level check.
4. Read `HEAD` and `HEAD^{tree}`. Both must match the expected source commit
   and committed source tree. Record the current working-tree observation as a
   separate fact.
5. Read the real host-issued session identity and its pin. Confirm the exact
   admitted role, public lane, goal, and task scope. A setup token, display
   name, old export, or caller assertion cannot satisfy this step.
6. Snapshot the lane's allowed changed-path set. If the target lane file is
   already present, the scope is not fresh and the lane stops rather than
   overwriting it.
7. If every gate passes, write exactly the lane file, then read it back and
   calculate its public artifact digest. No commit, merge, push, deployment,
   publication, or external side effect is part of this lane.
8. Return a typed handoff with the exact private readbacks in the control plane,
   safe public summaries, hostile-case coverage, focused-check status, evidence
   digests, open risks, and `NOT_YET_RUN` independent-check status.

The after-write readback must compare the lane's before/after changed-path
sets, not assume that unrelated pre-existing or sibling work belongs to this
lane. A source, identity, scope, or artifact mismatch discovered after the
write invalidates the result; narration cannot repair it.

## Unavailable behavior

Unavailable is a first-class result, never a pass and never an implicit
`NOT_APPLICABLE`.

| Condition | Required result |
| --- | --- |
| Project identity, environment, working directory, Git top level, commit, or tree differs from the expected binding | Stop before writing and report `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`. Preserve the exact observed mismatch in private evidence. |
| Host identity or pin cannot be read, or the role/goal cannot be matched | Stop before writing with `IDENTITY_UNAVAILABLE`; do not invent or borrow an identity. |
| A receipt is missing, altered, non-canonical, or cannot be reproduced | Return `EVIDENCE_UNAVAILABLE` or `EVIDENCE_INVALID`; do not promote the claim. |
| The host cannot provide the required local capability | Return `CAPABILITY_UNAVAILABLE` with the exact missing capability. Do not create a generic worker or shell substitute. |
| The allowed path set, source condition, intent, policy, or task scope changes | Stop the current outcome and return `SCOPE_OR_CONDITION_CHANGED`; require a fresh source-bound goal. |
| Independent checking is absent or performed by the same identity | Keep `independent_check.status` at `NOT_YET_RUN`; the lane is ready for review but not cleared. |
| The lane cannot be closed or its handoff cannot be preserved | Return `CLOSURE_UNAVAILABLE`; do not claim a complete result. |

On any unavailable path, preserve only safe digests and a typed explanation.
Do not retry by changing the source, weakening the identity gate, inheriting an
old record, or widening the role topology.

## Hostile cases

The following cases are minimum adversarial coverage for independent review.

| ID | Hostile condition | Expected disposition |
| --- | --- | --- |
| H-01 | A different project has the same label or a similar directory but a different project identity. | Fail closed before write with `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`. |
| H-02 | A relative path, symlink, or nested worktree makes the current directory appear equivalent while Git reports another top level. | Reject the binding; accept only exact canonical equality. |
| H-03 | `HEAD` or `HEAD^{tree}` changes between pre-write and handoff, or the goal is stale. | Invalidate the result and require a fresh source-bound goal; never reuse the old receipt. |
| H-04 | A caller supplies a plausible session string, stale pin, compatibility export, inherited roster entry, generic worker, or shell stand-in. | Reject it as non-identity; no role admission and no write. |
| H-05 | One child receipt has a different source binding, altered payload, duplicate evidence ID, or non-canonical digest. | Reject the evidence root and retain the outcome as unproven or unavailable. |
| H-06 | The public artifact contains a private path, credential-like value, provider/account identity, chat link, or session record. | Block public handoff; remove the leakage and regenerate the safe digest before review. |
| H-07 | The creating identity also reports the independent check as passed. | Reject self-clearance; keep the independent check pending. |
| H-08 | The after-write diff contains a second project file, an overwrite, or an unapproved path. | Report the exact scope violation and do not close the lane. |

## Focused check ideas

These are candidate checks for the independent clearance step, not evidence of
their own success:

- Run a mismatch matrix that changes each source and actor field independently
  and asserts stop-before-write with the exact failure class.
- Recompute canonical receipt and artifact digests, including a negative test
  for key reordering, altered source binding, duplicate IDs, and truncation.
- Verify that every child receipt has the same source commit and tree as the
  handoff, while the working-tree observation remains separately represented.
- Snapshot changed paths before and after the write and assert that this lane
  adds exactly one permitted public path and does not overwrite an existing
  target.
- Scan the public artifact for absolute user paths, credentials, provider or
  account identifiers, chat links, session identifiers, and raw evidence.
- Prove that a compatibility export, stale record, generic worker, and shell
  stand-in cannot satisfy the actor contract or create a role.
- Prove that a creator cannot satisfy the independent-check field and that
  `NOT_YET_RUN`, `FAIL`, and `UNAVAILABLE` cannot be coerced to `PASS`.
- Re-read the source and artifact after the handoff and invalidate the receipt
  when any binding or changed-path fact drifts.
- Check that the handoff contains meaningful progress, a bounded result,
  hostile coverage, evidence digests, open risks, a next handoff, and an
  explicit statement that independent clearance remains pending.

## Typed handoff

The lane returns one handoff shaped by the following contract. Values marked
`CONTROL_PLANE_ONLY` are required in the private readback but must not be
copied into this public article. Public evidence uses safe summaries and
content digests.

| Field | Type | Required contract |
| --- | --- | --- |
| `schema` | string | `agentos.rapid_foundation_handoff.v1` |
| `status` | enum | `READY_FOR_INDEPENDENT_CLEARANCE`, `BLOCKED`, or `UNAVAILABLE` |
| `role` | string | `FOUNDATION_EVIDENCE_AND_IDENTITY` |
| `public_lane` | string | `Evidence and identity` |
| `source_binding` | object | `project_id`, `project_root_sha256`, `git_top_level_sha256`, `source_commit`, `source_tree`, and working-tree observation; raw project roots and exact environment values remain `CONTROL_PLANE_ONLY`. |
| `actor_binding` | object | Real session identity, pin, admitted role, and task identity; exact identities are `CONTROL_PLANE_ONLY`. |
| `task` | object | Typed goal identifier and the exact bounded lane scope. |
| `progress` | string | Meaningful work completed, not a promise or narration-only update. |
| `result` | enum | `FOUNDATION_DEFINED`, `BLOCKED`, or `UNAVAILABLE`; never an independent-clearance claim. |
| `changed_paths` | array of strings | The lane's before/after delta; exactly the one public lane path for this write. |
| `hostile_coverage` | array | IDs and dispositions for at least `H-01` through `H-03`, with all applicable cases recorded. |
| `focused_checks` | array | Check IDs with `NOT_YET_RUN`, `PASS`, `FAIL`, or `UNAVAILABLE`; no unobserved pass claims. |
| `independent_check` | object | `required: true`; lane status is `NOT_YET_RUN`. |
| `evidence` | object | Source-bound receipt digests, public artifact SHA-256, and private raw-evidence disposition. |
| `open_risks` | array | Unresolved drift, unavailable capability, leakage concern, or deferred check. Empty is allowed only when supported by evidence. |
| `next_handoff` | string | `FOUNDATION_CLEARANCE_AUDITOR` or an exact typed blocker route. |
| `close_readiness` | enum | `READY_FOR_CLEARANCE_NOT_CLEARED`, `BLOCKED`, or `UNAVAILABLE`. |

The public lane is therefore ready to hand to independent clearance when its
file readback, evidence digest, hostile coverage, and typed handoff are
preserved. It is not independently cleared by this lane.
