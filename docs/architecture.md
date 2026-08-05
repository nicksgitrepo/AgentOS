# Refactor architecture

## Two layers

Governance has two distinct layers:

1. **Declarative graph** — `.gate` files compile into canonical JSON. They
   contain questions, required evidence, transitions, and terminal outcomes.
2. **Host engine** — plain Node.js validates the graph, accepts a typed answer
   and evidence proposal, and chooses the next node from the graph.

The graph cannot execute JavaScript, Python, shell commands, network calls, or
arbitrary expressions. A graph may describe a review or stop, but it cannot
grant itself authority. A repair edge is data only: it names one transition
back to an earlier gate and carries a positive visit limit.

## Answer contract

Every gate has all four explicit paths:

```text
YES
NO
UNKNOWN
NOT_APPLICABLE
```

The engine never treats `UNKNOWN` as `YES`. `NOT_APPLICABLE` still follows a
declared transition and is not an invisible bypass.

## Identity contract

Evidence is tied to:

```text
source commit
source tree
worktree
session
goal
environment
```

The evidence record is content-addressed. Native-session lifecycle and
campaign-specific identity use the same binding rather than creating a second
identity system. A host or Independent Auditor must also attach an
attestation HMAC over the complete claim; the gate engine verifies that
attestation before accepting the answer. A record that only declares itself
to be a host readback is not sufficient.

## Workspace boundary

Bootstrap uses three sibling roots under one user-selected parent:

```text
<parent>/AgentOS          release checkout
<parent>/projects         container holding project repositories
<parent>/AgentOS-control  Bootstrap-created control repository
```

The selected project must be a child of `<parent>/projects`. The host-side
Bootstrap function `prepareWorkspace` creates or verifies
`<parent>/AgentOS-control` before writing Bootstrap state, campaign state,
handoffs, notes, or tooling. Temporary worker checkouts must be below
`AgentOS-control/worktrees`, never below the release checkout or a project
repository. They must be isolated clones or equivalent checkouts whose Git
administrative metadata also stays under the control root; ordinary linked
worktrees that modify the source repository's `.git` directory are forbidden.

The boundary is content-addressed and carried through the Bootstrap plan,
campaign plan, worker admission, and native host request. A host must reject a
path that is not inside the control repository's worktree area. The project
tree is read-only to AgentOS control behavior: no AgentOS files, records,
worktrees, notes, or self-references are stored there.

## Release replacement

Release replacement changes only the `AgentOS` checkout at
`workspace_boundary.release_root`. The project container and external control
repository remain in place. The Intent Regulator receives the new release
identity and compiles a `release_update` record with one of two modes:

```text
KEEP_PROJECT_APPENDICES
  preserve control-repository governance additions and revalidate them

RESET_GOVERNANCE_CLEAN
  rebuild governance from the new release without those additions
```

Both modes require a control snapshot, leave project repositories unchanged,
and keep the previous release available until the replacement is bound and
checked. The host may remove the previous release only after that check.

## Lifecycle contract

The graph describes decisions. A separate runtime state machine owns active
node, trace, bounded repair visits, step limits, review holds, progress
windows, handoffs, and closure. Ordinary graph edges must be acyclic. A cycle
is valid only when every cycle edge is explicitly declared as a repair edge and
the engine stops at its declared repair-limit terminal.

## Role composition

The general graph is composed into a minimal packet for each role:

```text
general governance + applicable lane graphs + role authority
```

Intent Regulator and Runtime are persistent. Campaign Orchestrator,
Independent Auditor, and named lane workers are campaign-scoped. A worker
cannot accept its own result.

## Campaign composition

Bootstrap compiles one content-addressed campaign plan with four ordered
phases and all twelve lanes. The Campaign Orchestrator owns the sequence;
each lane gets a fresh named worker assignment, and each phase gets a fresh
Independent Auditor assignment. Intent Regulator and Runtime are referenced
as persistent authorities, not recreated as campaign workers.

The orchestrator may advance only after every worker in the current phase has
returned a typed candidate and that phase's Independent Auditor has returned
one acceptance covering every candidate. The host callback that performs the
actual native work remains responsible for source, worktree, session, and
evidence identity; the campaign coordinator only records and checks the
ordered handoffs.

The native lane runner is generic: it binds the admitted lane to the matching
graph ID, so the Functionality integration is the first exercised slice rather
than a special execution path.

The real session provider is an injected host adapter. The kernel accepts only
the eight required session actions, binds each call to a content-addressed
host attachment, and still requires raw thread readbacks to match the active
campaign identity. No provider-specific adapter, account, or credential is
stored here. The surrounding runtime may load its adapter through the small
host-loader entry point; the imported module is outside this repository and is
never treated as governance.

Runtime does not perform a protected action from a free-form request. Its
request must bind to the persistent Runtime's project and environment and
carry a content-addressed owner approval naming both the accepted result and
the final audit.

## Delivery and closure

The campaign ends with a content-addressed delivery choice. The owner may
choose to keep the accepted result local, or select push, merge, deploy, or
release. The portable kernel compiles and validates that choice, the accepted
result, the final audit, the source identity, and the owner decision. A local
choice produces a `NO_EXTERNAL_ACTION` record. Any external choice becomes a
Runtime request and still requires the persistent Runtime, the matching
project and environment, and owner approval naming the accepted result and
final audit. The surrounding host performs the actual external action; this
repository never contains provider credentials or performs delivery itself.

For a deployment or release choice, the host must return three separate
content-addressed records: a repository checkpoint, a deployment receipt, and
an independent live-audit receipt. The final closure record binds all three to
the original owner delivery choice, accepted result, candidate source, and
Runtime session. A pushed checkpoint must be clean and remote-equal; a live
audit must identify a different audit identity from the deployment identity.
