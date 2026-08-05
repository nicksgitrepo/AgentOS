# AgentOS Governance Refactor

> Status: `REFACTOR milestone — PREPARED_NOT_ACTIVATED`

This repository is the clean refactor milestone for AgentOS governance. It is
portable and project-agnostic. Product names, private paths, credentials,
provider identities, conversations, and runtime state do not belong here.

The refactor keeps governance declarative:

```text
.gate source
    ↓
normalized JSON graph
    ↓
semantic validator
    ↓
deterministic gate engine
    ↓
role packet and host-bound evidence
```

The language used to execute the system is plain Node.js with built-in
modules only. This milestone has no npm package, package manager, or
third-party runtime dependency.

## Current milestone boundary

The first slice establishes:

- a line-oriented `.gate` authoring format;
- a canonical, content-addressed decision graph;
- explicit `YES`, `NO`, `UNKNOWN`, and `NOT_APPLICABLE` transitions;
- a deterministic engine that chooses transitions from the graph;
- evidence bound to source, worktree, session, goal, and environment, with a
  host or Auditor attestation;
- the first Functionality lane;
- role-packet composition for persistent and campaign roles.

The campaign coordinator now compiles the complete four-phase plan, assigns a
fresh named worker to each of the twelve lanes, and requires an independent
phase acceptance before the next phase can begin. The bounded repair form is
available for a deliberate, counted return to an earlier gate.

The older development checkout remains the reference baseline. It is not
copied into this milestone wholesale; each behavior is migrated and verified
through a bounded vertical slice.

## Run the checks

Run the milestone verifier directly:

```text
node tests/verify-all.mjs
```

There is intentionally no `npm` command.

## Roles

Intent Regulator and Runtime are persistent. Campaign Orchestrator, named
lane workers, and Independent Auditors are fresh per campaign. A worker never
accepts its own result. Runtime owns external and release actions; the host,
not the language model, enforces graph transitions and evidence identity.

This milestone remains prepared and inactive. No push, merge, deployment, or
activation is implied by a passing local check.
