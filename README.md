# AgentOS 3.0 Solo Release Candidate

> Status: `3.0.0-rc.2 — PREPARED_NOT_ACTIVATED`

This repository is the clean 3.0 solo release candidate for AgentOS governance. It is
portable and project-agnostic. Product names, private paths, credentials,
provider identities, conversations, and runtime state do not belong here.
Machine paths are supplied only through host environment bindings such as
`AGENTOS_RELEASE_ROOT` and `AGENTOS_CONTROL_ROOT`. Records store the binding
names and content digests, never the resolved paths. Do not create or commit a
`.env` file in this repository.

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
- all twelve named governance lanes;
- role-packet composition for persistent and campaign roles.
- a named-question catalog and coverage manifest containing 90 displayed gates
  across 20 graphs and 13 standard families;
- role-specific rendered question packets: one lane plus the general foundation
  for a builder, and the complete graph set for an Independent Auditor;
- response records that can say `Gate "Human Name" passed successfully.` only
  when the displayed question, `YES` answer, evidence digest, work identity,
  and independent issuer all match.
- a source-bound native campaign runtime that carries a Bootstrap plan through
  all four phases, all twelve lanes, independent phase Auditors, typed
  handoffs, closure, and the fifteen-minute Intent Regulator audit loop.

The campaign coordinator compiles the complete four-phase plan, assigns a
fresh named worker to each of the twelve lanes, and requires an independent
phase acceptance before the next phase can begin. The native campaign runtime
exercises the same host contract that the live adapter must provide, including
bounded repair, evidence attestation, typed handoff, closure, and the attached
Intent Regulator timer. The repository test host is only a contract test; it is
not presented as a live provider. The campaign ends with an explicit
owner-selected delivery choice; external delivery remains a host action.

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

This release candidate remains prepared and inactive. A passing local check
does not pretend that a provider action happened. Activation requires a real
host adapter loaded through `control/native-host-loader.mjs`, a host attachment
whose capabilities match the required session actions, and a successful run of
the same native campaign path against that host.

The gate inventory and display rules are documented in
[`docs/gate-governance.md`](docs/gate-governance.md).

## Where a user keeps it

AgentOS is placed beside the user's project container, not inside a project
repository:

```text
workspace/
├── AgentOS                 release checkout
├── projects                container for the user's project repositories
│   ├── project-one/
│   └── project-two/
└── AgentOS-control         created by Bootstrap
    ├── bootstrap/
    ├── campaigns/
    ├── handoffs/
    └── worktrees/             isolated worker checkouts
```

Bootstrap verifies this sibling layout and creates the separate control
repository before it records anything. Project repositories remain free of
AgentOS files, control records, worktrees, notes, and self-references. Agents
work as human workers through isolated checkouts under `AgentOS-control/`; no
linked Git worktree may place administrative files in the project repository.
The product repositories remain the user's clean source repositories.
Persisted boundary records contain only safe environment references; the host
keeps resolved paths outside the record and outside Git.

The host-side Bootstrap entry point is
`control/workspace-bootstrap.mjs:prepareWorkspace`. It reads the release,
projects, and selected project directories, creates or verifies the sibling
`AgentOS-control` Git repository, and writes the boundary record there. It does
not write to the release checkout or any project repository.

## Updating the release

To update AgentOS, replace only the `AgentOS` release checkout. Keep the
`projects` container and `AgentOS-control` in place, then tell the Intent
Regulator which release is now installed. It presents one simple choice:

- keep the project-specific governance additions; or
- start with clean governance from the new release.

The first choice preserves the additions in the control repository and
rechecks them against the new release. The second rebuilds governance without
those additions. Both choices leave every project repository unchanged. The
update record is compiled by `control/release-update.mjs`.

The host should retain the previous release until the new release is bound and
checked, even if the user ultimately deletes the old release. The Intent
Regulator never deletes project repositories or the control repository.
