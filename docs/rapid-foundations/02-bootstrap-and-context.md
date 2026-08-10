# Bootstrap and context

This foundation defines the first context gate for a thin, source-bound
prototype. It turns an owner request and an admitted plan into a bounded,
typed working context before mutation. It is a portable governance contract,
not a live project record and not an independent clearance decision.

## Boundary

Bootstrap and context owns:

- read-only discovery of the current workspace, source state, available host
  capabilities, recorded plan, and explicit task intent;
- normalization of that material into a typed context with safe defaults,
  explicit assumptions, and a minimal question floor;
- source and workspace identity verification immediately before a permitted
  write;
- classification of missing, ambiguous, changed, or unavailable conditions;
- one bounded handoff containing progress, result, evidence, risks, and the
  next owner.

It does not own product requirements, implementation, UI decisions, release
activation, remote delivery, publication, deployment, spending, authentication,
secret handling, broad audits, or role design beyond the already admitted lane.
It does not create children, generic workers, or shell stand-ins. A prior
roster, compatibility export, caller assertion, or saved role record is not an
admission source. The initial roster remains empty except for roles admitted by
the current plan.

The lane may write only its one assigned public lane file. Creating its parent
directory is permitted when necessary; changing any other project file is out
of scope.

For this phase, the allowed environment is a direct local project session
rooted at the bound workspace. An isolated sibling or worktree that does not
preserve the exact project identity and cwd is unavailable and cannot write.

## Context contract

A usable bootstrap context is a typed snapshot. Values that identify a real
project, workspace, or session are read back from the host and carried in the
control plane; they are never hard-coded into this portable document.

| Field | Type | Required rule |
| --- | --- | --- |
| `intent` | object | Preserve the owner’s requested outcome and protected boundaries verbatim enough to detect change. |
| `task` | object | Name one bounded goal, one lane, one output, and the acceptance roots for that output. |
| `source_binding` | object | Include the read-back project ID, project root, cwd, Git top level, Git common directory, source commit, and source tree. |
| `capabilities` | enum array | Record only capabilities observed from the host; absence is not inferred from a caller claim. |
| `change_boundary` | object | State allowed writes, prohibited effects, and whether the plan permits the requested action. |
| `assumptions` | string array | Include only safe, reversible assumptions; unresolved material assumptions stay open. |
| `open_questions` | string array | Contain only decisions that cannot be answered by source, plan, or a safe default. |
| `evidence` | object | Carry checks and digests sufficient for an independent reader to reproduce the decision. |
| `status` | enum | Use `READY`, `REVIEW_REQUIRED`, `UNAVAILABLE`, `SOURCE_BINDING_MISMATCH`, `HARD_STOP`, or `DEFERRED_ITERATION`. |

The context is immutable for the duration of the handoff. A changed intent,
scope, policy, source, capability, or operating condition invalidates it; close
the current attempt and require a fresh source-bound goal rather than silently
recompiling around the change.

## Intended behavior

1. Read the current plan and its machine contract before mutation. The plan is
   the launch gate; this lane does not invent a second authority source.
2. Perform read-only discovery. Inspect the source and workspace shape, record
   existing changes without resetting them, and identify the smallest available
   local capability set. Discovery must be deterministic, secret-free, and
   safe to repeat.
3. Normalize the task. Separate owner intent, required output, acceptance
   roots, assumptions, questions, and prohibited effects. Treat unknown
   non-critical details as `UNSET`, not as permission to guess.
4. Apply the pre-write binding gate. The host must read back the expected
   project identity and cwd, the exact Git top level, the expected source
   commit, and the committed source tree. A setup token or caller assertion is
   not an identity readback.
5. Classify the condition. A bounded deterministic puzzle may continue; a
   non-protected choice that changes the route or design receives a soft
   review; a changed boundary, unsafe request, false identity, or missing
   required capability is a hard stop or unavailable result.
6. Write only the admitted lane artifact after all required checks pass. Do
   not authenticate, spend, publish, deploy, push, merge, activate, or alter
   unrelated files as part of bootstrap.
7. Return a typed handoff and preserve its evidence. The next independent
   reader must be able to distinguish completed discovery from clearance;
   this lane never claims its own independent clearance.

## Safe defaults and question floor

Bootstrap minimizes chat while protecting intent:

- Prefer local readback, the recorded plan, and deterministic inspection over
  a question.
- Preserve existing uncommitted work. Do not reset, clean, overwrite, or
  reinterpret it without a separately admitted decision.
- Default to read-only, local, secret-free operation with no external effects.
- Keep the output to the single admitted lane file and keep any prepared
  release state inactive.
- Do not infer a role, capability, identity, authorization, or acceptance from
  an old export or an unavailable host response.
- Ask one concise owner question only when the answer changes owner intent, a
  protected boundary, authorization, or another unsafe decision and cannot be
  resolved from the plan or a safe default.
- If the answer is not available, report the exact missing decision and stop
  the affected work. Do not make a material choice by silence.

Routine puzzles do not require a question. A soft review records the choice,
impact, and new context digest before continuing. A hard stop preserves the
evidence and does not narrate an incomplete result as success.

## Unavailable behavior

Unavailable is a valid result, not a reason to weaken the gate.

| Condition | Required behavior |
| --- | --- |
| Plan or machine contract is missing, invalid, or materially inconsistent | Return `UNAVAILABLE` with the missing field and evidence; perform no write. |
| Required host identity, cwd, Git top-level, commit, or tree cannot be read back | Return `UNAVAILABLE`; do not substitute caller-supplied metadata; perform no write. |
| Any read-back identity or source value differs from the expected binding | Return `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH`, preserve the exact mismatch, and stop before mutation. |
| Source or capability changes after preflight and before the write | Re-read once at the boundary; if the change remains, close the attempt and require a fresh goal. |
| Required local capability is absent | Return `UNAVAILABLE` with the exact capability gap; do not emulate it with a child, generic worker, or shell stand-in. |
| A material owner decision is unresolved | Ask the single bounded question; if unavailable, return `REVIEW_REQUIRED` or `DEFERRED_ITERATION` without writing. |
| The request crosses the delivery or security boundary | Return `HARD_STOP`; preserve evidence and route the request to a later, explicitly admitted scope. |

## Hostile cases

The following cases are adversarial inputs to the foundation, not exceptional
permission to bypass it.

| Hostile case | Expected response |
| --- | --- |
| A caller supplies the expected project ID while the live cwd or Git top level points elsewhere. | Trust host readback only; return `WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH` before any write. |
| The source commit or tree changes between discovery and the write boundary. | Re-read the binding, invalidate the context, preserve the observed digests, and require a fresh source-bound goal. |
| An old compatibility export or prior roster presents a role as already admitted. | Keep the current roster empty except for current-plan admissions; do not create or reuse that role. |
| A request asks bootstrap to create a child, a generic worker, or a shell substitute because the intended host capability is unavailable. | Return `UNAVAILABLE` or `HARD_STOP`; record the exact capability gap and make no substitute. |
| A prompt embeds a credential, private path, session record, or external destination in the intended public artifact. | Reject the material, keep the artifact secret-free and portable, and escalate as a security/privacy hard stop if needed. |
| A material requirement is ambiguous but a plausible guess would change scope or authorization. | Use the question floor once; if unanswered, pause or defer without choosing on the owner’s behalf. |
| Existing dirty edits overlap the requested output. | Preserve the edits, report the overlap, and require a bounded review before any overwrite; never reset the workspace. |
| A request combines a valid local lane task with push, merge, publication, deployment, spending, or activation. | Complete only the admitted local boundary, reject the external effect, and return a typed hard-stop or deferred handoff for the remainder. |

## Focused check ideas

Checks for this foundation should be small, deterministic, and independently
repeatable:

- parse the plan and machine contract, then verify that this lane has exactly
  one admitted role, one output, and no child or generic-worker permission;
- read back project identity, cwd, Git top level, source commit, and source
  tree immediately before writing, including a drift case that must produce no
  file mutation;
- verify that pre-existing changes are preserved and that the lane changes no
  path outside its assigned artifact;
- exercise the question floor with one resolvable unknown, one material
  ambiguity, and one unavailable owner decision;
- inject each hostile condition and assert the exact disposition,
  evidence-preservation behavior, and no-write rule;
- scan the public artifact for credentials, private paths, project/session
  identifiers, chat links, external identities, and provider-specific terms;
- run a Markdown/diff hygiene check and record a digest for every meaningful
  check; a full-suite timeout remains typed later work rather than an invented
  pass.

## Typed handoff

The following shape is the minimum handoff contract. The source values are
read-back values, not literals to copy into public authority.

```ts
type BootstrapContextHandoff = {
  phase: "ASSEMBLE_FOUNDATION_LANES";
  role: "FOUNDATION_BOOTSTRAP_AND_CONTEXT";
  public_lane: "Bootstrap and context";
  task: {
    goal: string;
    scope: string;
    output: string;
  };
  source_binding: {
    project_id: string;
    project_root: string;
    cwd: string;
    git_top_level: string;
    git_common_directory: string;
    source_commit: string;
    source_tree: string;
  };
  progress: "MEANINGFUL" | "NO_PROGRESS" | "UNAVAILABLE";
  result:
    | "READY_FOR_INDEPENDENT_CLEARANCE"
    | "UNAVAILABLE"
    | "SOURCE_BINDING_MISMATCH"
    | "HARD_STOP"
    | "DEFERRED_ITERATION";
  hostile_coverage: string[];
  focused_checks: Array<{
    name: string;
    status: "PASS" | "FAIL" | "TIMEOUT" | "UNAVAILABLE";
    evidence_digest?: string;
  }>;
  independent_check: {
    required: true;
    status: "PENDING" | "PASS" | "FAIL" | "UNAVAILABLE";
    evidence_digests: string[];
    clearance_claim: false;
  };
  evidence_digests: string[];
  open_risks: string[];
  next_handoff: string;
  close_readiness: "READY_FOR_HOST_CLOSE" | "PENDING_READBACK" | "EXACT_CLOSE_FAILURE";
  disposition:
    | "FOUNDATION_PENDING_INDEPENDENT_CLEARANCE"
    | "PUZZLE"
    | "SOFT_REVIEW"
    | "HARD_STOP"
    | "DEFERRED_ITERATION";
};
```

The normal successful disposition is
`FOUNDATION_PENDING_INDEPENDENT_CLEARANCE`, never `CLEARED`. The independent
reader owns clearance; bootstrap owns only source-bound context, bounded
progress, and an honest handoff.
