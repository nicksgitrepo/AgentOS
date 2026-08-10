# Project foundation plan — owner-directed provisional

Audit date: 2026-08-09
Plan status: OWNER_DIRECTION_RECORDED_PENDING_HOST_AND_CLEAN_CHECKPOINT
Platform phase: PLATFORM_FOUNDATION
Feature phase: NOT_ADMITTED
Source authority: commit 590c07ddd4be7a8c24727c24b40808e44ca7357d / tree f1b358d87e6a969fb9631e202a3d478540edd4d9
Pyramid authority: a882a74b6a71ba1fe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d

## Project mode

This campaign is developing the governance system itself, so it is treated as a controlled NEW_PROJECT foundation instance rather than an imported Product. The generic import path remains separate and requires explicit owner approval before rapid development.

## Repository and custody boundaries

- The release/runtime repository is replaceable software.
- The separate control-plane workspace owns project memory, governance records, questions, handoffs, and campaign state.
- Product repositories remain outside the control plane and are never written by platform or feature lanes unless an explicitly approved project instance mounts them.
- Visible tasks own isolated worktrees; the Controller owns central integration and final shared-seam custody.
- Public records contain relative paths, classifications, source identities, and content digests only.

## Proposed stack and skeleton

The accepted source proves a portable Node-style ES-module governance kernel with JSON-schema contracts. No product dependency manifest, provider, model, account, or hosting target is selected.

The proposed kernel skeleton is: authority/ for constitutional rules; bootstrap/ for discovery and owner conversation; control/ for deterministic routing, custody, evidence, and lifecycle; governance/ for declarative policy; schemas/ for contracts; docs/ for non-normative explanation and append-only handoffs; migrations/ for versioned state changes; examples/ for safe fixtures; and tests/ for later verification. No package-manager assumption is part of this foundation plan.

## Routing and shared-contract ownership

- Campaign Controller/Orchestrator owns admission, shared-resource custody, primary shared-contract selection, integration, and closure.
- Platform lanes own cross-feature capability boundaries and foundation handoffs.
- Feature lanes own one bounded feature outcome and consume accepted public contracts.
- Independent Auditors verify source, evidence, privacy, custody, and handoff claims without self-clearing.
- Runtime performs mechanical integration/deployment/rollback only after separate authorization.

The first shared-contract owners to be selected are: Evidence-and-Identity/checkpoint custody; canonical gate-catalog/response envelope; and private-control/memory registry. Feature lanes may not edit these seams.

## UI and design direction

The portable kernel has no product UI. Any user conversation is a host surface and must remain adapter-owned. If a visible Product surface is later admitted, a DESIGN_BIBLE, design-system root, navigation contract, and owner-approved visual authority must be added before that feature lane starts.

## Import and approval boundary

An imported Product must select one import mode, source and destination authority, and exact owner approval for rapid development. Discovery-only mode is the default until that approval is recorded. This foundation instance does not authorize writing to a Product repository.

## Required acceptance gates

Before platform admission can open: resolve the six questions in questions.txt; bind this plan and the selected shared-contract owners to one clean source checkpoint; preserve the three platform handoffs; independently audit the combined platform tree; verify privacy and source/path identity; and record any unavailable host capability as typed UNAVAILABLE rather than a pass.

## Owner direction now recorded

The current owner direction confirms the following foundation constraints:

- use a portable Node-style module and JSON-contract foundation for this
  candidate, with no npm/package-manager dependency;
- keep release, external control/instance state, and Product repositories
  separate, with no Product repository used as the AgentOS worktree;
- initialize project skeleton, repository boundaries, routing, and shared seams
  before feature admission;
- keep the kernel GUI-free and place owner questions in the control-plane
  queue;
- keep secrets, provider credentials, and resolved machine paths outside
  durable portable records; and
- preserve handoffs before consumption and archive visible tasks only after
  integration and downstream evidence are retained.

These decisions are recorded in `questions.txt`. They establish direction but
do not replace host authority, functional evidence, or a clean checkpoint.

## Current decision

This is a provisional owner-directed foundation plan, not an acceptance claim.
The platform gate remains HELD, active platform lane count remains zero,
feature work remains NOT_ADMITTED, and no task/worktree may be archived until
downstream preservation is proven.
