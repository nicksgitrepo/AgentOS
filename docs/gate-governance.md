# Gate governance

The gate system is the project’s line-by-line reasoning path. A gate is not a
general suggestion such as “is this good?” It asks one concrete question, lists
the evidence that must answer it, and names the only allowed next route.

The source of truth is split into three portable files:

- `governance/**/*.gate` contains the questions and transitions.
- `governance/question-catalog.json` gives every graph, gate, and evidence slot
  a human-readable name.
- `governance/coverage-manifest.json` lists the standard families and proves
  that every gate is assigned to exactly one coverage category.

The current inventory has 90 named gates in 20 graphs. The coverage categories
include intent and scope, bootstrap and context, user conversation, role
routing, progress and health, functionality, UI/UX and the design bible, code
and repository hygiene, security and privacy, evidence and identity, recovery
and boundaries, response gating, and delivery and closure.

## What an agent sees

Each role receives a rendered question packet. Every question displays:

1. the human-readable gate name;
2. the exact question;
3. required evidence labels;
4. the only answers: `YES`, `NO`, `UNKNOWN`, or `NOT_APPLICABLE`;
5. the named next question or terminal route;
6. the repair instruction for that answer;
7. the exact response wording allowed after a pass.

`YES` is the only passing answer. `UNKNOWN` never becomes a pass, and
`NOT_APPLICABLE` cannot silently reach completion.

## Role scope

- A named lane worker receives the general foundation plus exactly one lane.
- An Independent Auditor receives every graph and every lane for a full-project
  sweep.
- A worker cannot accept its own result.
- Intent Regulator and Runtime remain persistent; campaign workers and Auditors
  are temporary.

The packet is content-addressed, so changing a question, name, evidence slot,
or route changes the packet identity.

## Truthful pass wording

A passing response is bound to the rendered question and must use the matching
human name, for example:

```text
Gate "Concurrency and Race Safety" passed successfully.
```

The response record also carries the answer, evidence digest, source commit,
source tree, worktree, session, goal, environment, and issuer. The issuer must
be a host readback or a different Independent Auditor session. A worker cannot
make a bare assertion or rename a gate to manufacture a pass.

## Builder versus Auditor questions

For a builder, “Is the worktree diff free of potential race conditions?” is
asked against the assigned lane and its admitted change. For an Auditor, the
same class of question is asked across the whole project and all changed seams.
The question is the same standard; the bound scope and evidence identity are
different.

Hard-boundary answers stop work. Soft-boundary answers pause the lane and route
the exact evidence to the Campaign Orchestrator. A changed scope, intent, or
condition closes or reassesses the current goal before more work continues.
