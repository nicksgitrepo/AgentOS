# Pre-live fine-tooth audit — 2026-08-12

## Declaration

- Authorities checked: repository `AGENTS.md`, `bootstrap/start-here.md`, the
  public README, the release-promotion contract, and the inactive combined
  integration contract.
- Classification: portable-kernel source audit and bounded repair.
- Bounded outcome: find and repair reproducible source defects, prove the
  repaired source, and state the exact ceiling on a live or public release.
- Authority boundary: this audit may edit and test only this isolated source
  candidate. It may not activate providers, adopt into a consumer project,
  migrate data, publish a release, or make a licensing decision.
- Non-goals: no external-project mutation, no credential use, no deployment,
  no release promotion, and no replacement of immutable integration inputs.
- Stop condition: the repaired source passes the canonical suite and every
  remaining release blocker is explicit and routed to its proper authority.
- Inspected implementation and proof: the public facade, reusable control
  module imports, role admission and host evidence, operational command-line
  entry points, bootstrap isolation, release gates, the inactive combined
  bundle, deterministic packaging, install/rollback proof, and source hygiene.
- Preserved unrelated work: the frozen combined bundle and all immutable
  Memory and role-builder input packages remain byte-for-byte unchanged.

## Repaired findings

### F-01 — public facade could not be imported

The public facade exported a compatibility function that its source module did
not provide. Importing the facade therefore failed during module linking.

Repair: provide the documented compatibility alias and add a public-surface
test that imports the facade, checks its principal functions, and imports every
reusable control module without command-line side effects.

### F-02 — reusable session module crashed when imported

The local session module passed an absent command-line argument to a URL
constructor during import. That made library use fail before any function was
called.

Repair: guard direct execution and compare canonical real paths only when a
command path exists.

### F-03 — valid nested host authority was rejected

The evidence verifier accepted nested native source readback, but admission
later looked only at the flat authority object. Snake-case session identities
also failed to bind to the expected session.

Repair: admission now reads the already-verified nested source readback and
normalizes the documented session identity aliases. A complete ready-path test
covers the nested and snake-case form.

### F-04 — duplicate capabilities created ambiguous bindings

Capability equality was set-like but arrays containing duplicate entries were
not rejected. That allowed multiple serialized representations of one logical
authority set.

Repair: expected, observed, and required capability arrays must each be unique.
Hostile tests cover duplicates in all three positions.

### F-05 — operational commands silently failed through links or spaced paths

Several operational modules compared a module URL with a manually assembled
file URL. That comparison is not portable across encoded spaces, symbolic
links, or platform path syntax and could make a command exit without running.

Repair: operational entry points now compare canonical real paths through the
platform URL converter. A linked command path containing spaces was exercised
and correctly reached command validation.

## Verified source-candidate properties

- The public facade imports and exposes the documented bootstrap, workflow,
  Memory, role-library, and release-gate functions.
- Every reusable control module imports without unintended command execution.
- Bootstrap discovery against a project path containing spaces leaves project
  bytes and Git state unchanged.
- Host authority, source identity, capability uniqueness, and wrong-scope
  denials remain fail-closed.
- Repository integrity, source hygiene, portability, release lifecycle,
  promotion, compatibility, and safety checks pass.
- No repository symlinks, case-colliding tracked paths, tracked line-ending
  drift, embedded credential values, or undeclared dependency manifests were
  found.

## Release blockers that remain

### B-01 — the checked-in combined 3.0 bundle is stale

The bundle is intentionally bound to an older immutable main-core source. Its
public entry point currently fails to import because that frozen input has an
inconsistent Memory export. It also lacks later bootstrap, Memory, public
surface, and portability repairs present in this source candidate. Passing the
bundle's historical parity test proves fidelity to the old input, not parity
with the current source.

Required next action: create a new versioned combined integration candidate
from the exact accepted source commit and tree. Do not edit the frozen input in
place or preserve its old identity after changing its bytes.

### B-02 — two Memory authorities must be reconciled for the next bundle

The current source has an operational project-Memory runtime, while the old
combined bundle separately carries the inactive M2 Memory package. Copying the
current source into that bundle without an explicit compatibility decision
would ship two overlapping Memory authorities.

Required next action: define one typed authority and compatibility map for the
new integration. Preserve migration and activation as separate, default-off
decisions.

### B-03 — the specialist gate library is absent from this candidate

This release repository contains no specialist `.gate` files and no canonical
specialist roster. A roster exists only in the prior satellite workspace and
has no accepted typed handoff into this source candidate. The promised
composable specialist-library behavior therefore is not part of this build.

Required next action: admit a hash-bound specialist-library candidate through
the role-builder intake, independently evaluate it, and then regenerate the
combined bundle. Do not copy an unaccepted satellite file into the release.

### B-04 — real-host and independent proof is incomplete

The inactive combined candidate's own receipt still lists independent
utility/harm evaluation and real-host new-project plus import/adoption proof as
pending. Local deterministic proof does not close those ceilings.

Required next action: after B-01 through B-03, install the exact new artifact as
an external sibling of a disposable real project, prove zero project trace,
exercise new-project and import/adoption flows, and run an independent
utility/harm evaluation.

### B-05 — promotion and public-distribution decisions remain protected

The release-promotion contract remains blocked pending an exact sterile
candidate identity, full proof, and explicit promotion. The repository also
states that no license has been selected.

Required next action: after technical clearance, obtain explicit release
promotion and choose a distribution/license policy before any public release.

## Disposition

`SOURCE_CANDIDATE_REPAIRED_PENDING_REINTEGRATION`

The current source is suitable as an input to a fresh integration candidate.
The existing combined 3.0 artifact is not suitable for live or public release.
No activation, adoption, migration, deployment, publication, or external
project mutation occurred during this audit.
