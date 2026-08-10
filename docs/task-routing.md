# Task-shaped routing and context

The portable routing slice turns an admitted task into a deterministic route
for a role, model identifier supplied by the host, reasoning effort, selective
context, tools, worker shape, workspace capability, and evidence path.

## Boundary

The kernel accepts only typed digests and safe labels for task, goal, project,
source, host, context, and evidence identity. A context item may be inspected
transiently by a host adapter, but the persisted context records contain no raw
content, paths, credentials, provider accounts, session details, or private
links. Unrelated, stale, over-sensitive, secret-like, and unauthorized memory
items are excluded; insufficient context produces an unavailable selection.

The host capability catalog is a declaration, not execution proof. A separate,
source-bound, project-bound, time-bounded host attestation is required before a
route can be selected. The route records the attestation and context-selection
digests, plus the worker, workspace, and evidence dimensions. Missing
capabilities yield a typed unavailable record and never create a simulated
worker.

## Pre-work admission

`admitExecutionRoute` compares host and session readbacks to the route before a
consuming adapter invokes work. `runAdmittedTask` invokes its callback only
after the readback is verified against the expected route. These functions do
not create sessions, workers, worktrees, Product files, child tasks, or
acceptance decisions; those remain consuming-adapter and owner boundaries.

## Fallback and evaluation

Fallback inputs must retain the original task, model policy, context policy and
selection, capability catalog, host attestation, source binding, and route
predecessor. Disabled fallback is a closed record. A fallback that weakens
reasoning, verification, context, tools, permissions, success probability,
worker shape, workspace, or evidence path is blocked.

Evaluation records use bounded quality, cost, latency, context-sufficiency, and
policy-compliance fields. Replay records require distinct builder and
evaluator references and compare a fresh route digest without granting
acceptance or release authority.

`2.1rc` remains prepared but inactive. Functional verification and consuming
adapter integration are separate handoff actions.

