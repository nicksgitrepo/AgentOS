# Refactor architecture

## Two layers

Governance has two distinct layers:

1. **Declarative graph** — `.gate` files compile into canonical JSON. They
   contain questions, required evidence, transitions, and terminal outcomes.
2. **Host engine** — plain Node.js validates the graph, accepts a typed answer
   and evidence proposal, and chooses the next node from the graph.

The graph cannot execute JavaScript, Python, shell commands, network calls, or
arbitrary expressions. A graph may describe a review or stop, but it cannot
grant itself authority.

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

The evidence record is content-addressed. Later phases will add host
readbacks, native-session lifecycle, and campaign-specific identity without
changing this base contract.

## Lifecycle contract

The graph describes decisions. A separate runtime state machine will own
active node, trace, retry limits, review holds, progress windows, handoffs,
and closure. This prevents governance text from becoming a second hidden
runtime.

## Role composition

The general graph is composed into a minimal packet for each role:

```text
general governance + applicable lane graphs + role authority
```

Intent Regulator and Runtime are persistent. Campaign Orchestrator,
Independent Auditor, and named lane workers are campaign-scoped. A worker
cannot accept its own result.

