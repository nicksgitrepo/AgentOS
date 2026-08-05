# Refactor milestone

## Purpose

Establish a small, dependency-free governance kernel before migrating the
remaining AgentOS control behavior.

## Preserved reference

The previous development candidate is maintained outside this repository as
the behavioral reference. This repository deliberately migrates behavior in
small vertical slices so a representation change cannot silently weaken a
boundary.

## Non-negotiable rules

- Governance is data, not executable code.
- The host chooses the next gate; an agent can only propose an answer and
  evidence.
- `UNKNOWN` never passes.
- `NOT_APPLICABLE` needs an explicit route and evidence when it permits any
  progress.
- Ordinary gate paths are acyclic. A repair loop must declare each loop edge
  and a positive visit limit; exceeding the limit is a hard stop.
- Hard boundaries stop work.
- Soft boundaries route to review.
- Evidence must bind to the same source, worktree, session, goal, and
  environment as the claim.
- Evidence must carry a host or Independent Auditor attestation; matching
  fields alone do not make a claim real.
- Protected Runtime actions require a project/environment-bound owner
  approval tied to the accepted result and final audit.
- Delivery choices are explicit: local accepted result, push, merge, deploy,
  or release. External choices become Runtime requests; the portable kernel
  does not execute provider actions.
- Temporary workers preserve a handoff, then unpin, archive, and leave the
  active roster.
- A changed scope or intent closes the current goal and requires a new one.
- No product or private context is stored in this repository.
- Bootstrap creates or verifies a sibling control repository before writing
  control state; worker checkouts and their Git metadata stay under that
  control repository, never in a project repository.

## Completion of this milestone

The portable milestone slice is complete only after the twelve-lane campaign
has been replayed deterministically, hostile-tested, independently audited,
and accepted without activating release behavior. A real host adapter and any
provider action remain outside this repository and must be verified by the
surrounding runtime before activation.
