# Preserved full platform handoff: 06-functionality

## Platform-foundation handoff: Functionality lane

This is the current platform-gate handoff. The earlier pre-repair findings and
their dispositions remain immutable history; this section records the current
source-bound candidate and the platform boundaries that the Controller must
honor before any feature lane is released.

### Current status

- Platform handoff: `PRODUCTION_CANDIDATE_PENDING_TESTS`.
- Functionality lane result: `READY_FOR_INDEPENDENT_CLEARANCE`.
- Independent check: `REQUESTED`; this lane has not self-accepted its result.
- Acceptance: `accepted: false`; this is not design, security, delivery,
  release, activation, or overall campaign acceptance.
- Source binding for this isolated checkpoint: commit
  `590c07ddd4be7a8c24727c24b40808e44ca7357d`, tree
  `f1b358d87e6a969fb9631e202a3d478540edd4d9`, plus the staged candidate path
  digests below. The commit/tree does not claim to contain the staged files.
- Candidate path digests: module
  `4a8f8d8917ff582ce9643e5b5a3968fedb3e99f91cbbea8dcd4ea7ccc851fda2` and
  focused test
  `7298664723bb3685b8327852af877743871e8a03f2f00448ed6180c79b10410a`.
  The append-only audit report has no stable handoff digest because each
  preserved history entry changes it.

### COMPLETE

- The repaired Functionality behavior is confined to the declared
  `IMPLEMENTATION_FUNCTIONALITY` module/test pair. It requires verified source
  readback, the exact role and independent-sibling topology, meaningful
  progress, a positive focused check, and complete public-safe functional
  evidence before a ready result.
- The lane now exposes bounded answer/lifecycle handling, source and protected
  condition invalidation, strict typed-requirement mode, one-repair exhaustion,
  hostile outcomes, and a typed handoff without external effects.
- The shared platform facts relevant to this lane were read from the public
  kernel sources: Bootstrap and governance feed source-bound sessions and
  named lanes; `control/rapid-prototype/index.mjs` is the thin assembly point;
  the Controller and Runtime own campaign state and custody; and the Product
  root remains separate from the public kernel and external control plane.
- Only the module, focused test, and this audit report are staged in this
  isolated worktree. No commit, merge, push, publication, deployment, or
  change to the authoritative merge worktree was performed.

### MISSING

- The parent has not yet recorded the staged candidate in its authoritative
  platform tree. The reference merge worktree remains read-only at the same
  baseline commit/tree and retains its original Functionality module/test
  hashes.
- No real caller-supplied strict `FUNCTION_REQUIREMENTS` packet or observed
  hostile matrix has been provided to the repaired module. The unchanged
  assembler remains compatible through its coarse compatibility input, but
  that compatibility path is not proof of complete real-world requirement
  coverage.
- The Functionality foundation intent document was read but not changed or
  staged by this task; it remains context rather than a claim that the
  platform candidate already owns its durable preservation.
- Aggregate platform clearance is not this lane's decision. The Controller
  must wait for all platform handoffs, independently audit one source-bound
  platform tree, and merge only that audited tree before releasing feature
  lanes.

### PRODUCTION READINESS

This lane is a production candidate pending the parent custody step and
independent tests. It is suitable for the Controller's platform review as a
minimal, source-bound Functionality implementation. It is not yet a finished
platform tree and must not be represented as feature-ready, released, or
activated.

### WHY

The focused Functionality test, both module/test syntax checks, the assembled
rapid-prototype test, handoff smoke checks, effect scans, privacy checks, and
whitespace checks pass in this isolated worktree. The reference merge worktree
was read only and its original focused and assembled tests also pass. The
remaining uncertainty is custody and independent coverage, not a known local
Functionality failure.

### EVIDENCE

Observed evidence:

- Direct Node checks pass for the repaired module and focused test, and the
  assembled consumer remains compatible while keeping independent acceptance
  outstanding.
- The repaired pair has the exact path digests recorded above; the staged
  index contains only the three in-scope artifacts named above.
- The reference worktree is unchanged at the recorded baseline and reports
  the original Functionality files as untracked with their original hashes.
- The implementation uses no filesystem, network, provider, authentication,
  publication, deployment, spending, or destructive operation.

Inference:

- The candidate is a compatible narrow implementation for the current shared
  assembler because the assembled direct test passes. This does not infer
  complete typed requirement coverage or independent clearance.
- The public handoff can be consumed by the platform Controller without
  exposing private source paths, session identities, owner text, or control
  plane records because it carries bounded summaries and digests only.

Unknowns:

- The parent-selected authoritative merge commit/tree after custody is not
  known yet.
- The real strict requirement IDs, authority/version digest, evidence bindings,
  and hostile observations to be checked independently are not supplied.
- Cross-lane platform completeness is intentionally not audited here; it is an
  aggregate Controller gate.

True blockers:

- `PARENT_MERGE_REQUIRED`: the staged checkpoint is not itself an authoritative
  merge. Recovery is to preserve the exact declared paths and digests in one
  independently audited platform tree, without modifying the reference tree.
- `INDEPENDENT_TESTS_REQUIRED`: recovery is to run the strict typed requirement
  packet and hostile matrix against that preserved tree, with a fresh source
  snapshot and no self-acceptance.
- `PLATFORM_HANDOFF_GATE_REQUIRED`: recovery is to hold feature-lane release
  until every platform handoff is present, then independently audit and merge
  one platform tree.

### QUALITY/HYGIENE/MINIMALITY

- Recommended shared stack: keep the portable kernel in Node ESM with direct
  Node focused tests and built-in libraries; the repository metadata declares
  Node `>=20`, and this audit used no npm command. JSON schemas remain the
  shared contract format, while Git commit/tree and path SHA-256 values bind
  source and candidate evidence.
- Keep `control/rapid-prototype/functionality.mjs` small and deterministic;
  keep its focused test beside it. The lane should not add package dependencies,
  an assembler rewrite, a new schema, generated output, or a general feature
  abstraction to solve a Functionality finding.
- The shared skeleton is the existing project-agnostic set of
  `bootstrap/`, `control/`, `governance/`, `schemas/`, `authority/`, `docs/`,
  `tests/`, `examples/`, and `migrations/`, with `README.md` defining the
  public-kernel/Product/control-plane separation. Runtime state and private
  evidence belong in the external control plane, not in this public skeleton.
- Directory ownership is narrow: the Functionality implementation owns only
  `control/rapid-prototype/functionality.mjs` and
  `tests/rapid-prototype/functionality.mjs`; its foundation intent is
  `docs/rapid-foundations/06-functionality.md`; this report is the audit
  record. The shared index, public plan, schemas, other lane modules/tests,
  and controller files remain outside this lane.
- The implementation plan's clean-exact-source, bounded-scan,
  focused-hostile, and direct-Node-suite order remains the recommended
  verification sequence. A dirty or mismatched source snapshot fails closed.

### SECURITY/PRIVACY/BOUNDARIES

- Public handoffs must contain project-agnostic summaries and safe digests only.
  Private project roots, host paths, session IDs, credentials, provider or
  account names, raw conversations, and control-plane records stay outside the
  public report.
- Source identity, role custody, session topology, and merge custody are
  verified inputs or Controller responsibilities; the Functionality lane does
  not mint identities, create children, use shell stand-ins, or accept itself.
- Functionality evaluates only the first acceptance root,
  `FUNCTION_REQUIREMENTS`. `DESIGN_BIBLE` and `SECURITY` remain separate roots;
  this lane may provide dependency notes but cannot mark either root passed.
- The public/UI direction is status-first and plain-language: show the current
  result, limitation, owning route, and next bounded action; represent
  question, puzzle, soft review, unavailable, and hard-stop states honestly;
  never turn missing evidence, stale source, or an unavailable capability into
  a success or endless waiting state. UI implementation belongs to the UI/UX
  lane, not this lane.
- The release boundary remains inactive `2.1rc`. No feature lane, external
  action, publication, deployment, merge, or activation follows from this
  handoff alone.

### SHARED CONTRACTS

- Source binding: the platform gate requires exact project/source readbacks,
  including commit and tree; the implementation plan additionally requires
  project root, working directory, Git top level, and exact path digests in the
  private execution receipt. Public output publishes only safe summaries and
  digests.
- Role/routing: the foundation role is
  `FOUNDATION_FUNCTIONALITY`; the implementation role is
  `IMPLEMENTATION_FUNCTIONALITY`; the implementation must be an
  `INDEPENDENT_SIBLING_SESSION`. Compatibility names, generic workers,
  recursive children, shell stand-ins, and unverified identities are not
  substitutes.
- Acceptance: the ordered roots are
  `FUNCTION_REQUIREMENTS -> DESIGN_BIBLE -> SECURITY`; answers are `YES`,
  `NO`, `UNKNOWN`, `NOT_APPLICABLE`, and `EXCEPTION_REQUESTED`; lifecycle is
  `UNEVALUATED`, `EVIDENCE_PENDING`, `OPEN_REPAIR`, `VERIFIED`, or
  `INVALIDATED`. Changed source, intent, policy, or protected conditions
  invalidate dependent evidence.
- Handoff: phase, exact role/lane, task/scope, source readback, meaningful
  progress, complete functional status, result, hostile coverage, independent
  check/requested checker, public-safe evidence digests, open risks, next
  handoff, and classification are required. Ready remains
  `accepted: false` with `independent_check: REQUESTED`.
- Controller gate: the platform Controller preserves each typed handoff,
  waits for all platform handoffs, independently audits one source-bound tree,
  merges that tree, and only then admits or releases feature work. A new role
  or widened scope requires a changed plan and fresh source-bound goal.

### Unresolved owner questions

These are explicit owner/controller questions, not permissions inferred by this
lane:

1. Which exact typed `FUNCTION_REQUIREMENTS` packet (question IDs,
   authority/version digest, applicability, and evidence bindings) is the
   independent checker authorized to use for this platform candidate?
2. Which parent commit/tree is the authoritative custody checkpoint for the
   staged module, focused test, and audit history, and how will the unchanged
   foundation intent document be preserved or intentionally excluded?
3. When should strict typed-requirement mode become mandatory for the shared
   assembler, rather than retaining compatibility mode for legacy coarse
   callers?
4. Has the Controller received every platform handoff and recorded the
   independent-audit/merge gate before releasing any feature lane?
5. Is a separate JSON schema for the implementation result required by the
   platform contract? The Functionality lane did not add one because doing so
   would widen its recorded two-file implementation scope.

### BLOCKERS with recovery

| Blocker | Recovery owner | Exact recovery |
| --- | --- | --- |
| `PARENT_MERGE_REQUIRED` | Controller / parent custody | Read the staged paths, independently verify their hashes and source binding, preserve them in one platform candidate tree, and leave the reference merge worktree untouched. |
| `INDEPENDENT_TESTS_REQUIRED` | Independent Functionality checker | Use the parent-selected strict typed requirement packet, run the hostile matrix and direct Node checks against the preserved tree, and return a separate typed decision. |
| `PLATFORM_HANDOFF_GATE_REQUIRED` | Controller | Wait for all platform handoffs, independently audit the aggregate boundaries, merge one audited platform tree, and only then release feature lanes. |
| `OWNER_CONTEXT_REQUIRED` | Owner/controller | Answer the five questions above in a typed, source-bound record; do not infer product policy, exception authority, or release permission from this lane. |

### Exact next steps

For the Controller:

1. Preserve this staged checkpoint and the two implementation path digests in
   the authoritative candidate; do not copy private paths or alter the
   read-only reference worktree.
2. Wait for every platform-foundation handoff. Independently audit the one
   source-bound platform tree, including directory scope, shared contracts,
   source/custody, privacy, and hostile evidence.
3. Run the strict typed Functionality requirement packet and hostile matrix,
   then record the independent result and selected parent commit/tree.
4. Merge only the independently audited platform tree. Keep `2.1rc`
   inactive and release no feature lane before this gate is recorded.

For a later same-lane builder, only if the independent check records a new
Functionality finding:

1. Reopen this same lane against the exact parent source readback and record
   the new finding before changing anything.
2. Change only the declared Functionality module/test pair, preserve this
   report's history, and do not implement product features or edit the shared
   index, schemas, or other lanes.
3. Re-run the direct Node focused, hostile, privacy, hygiene, and assembled
   checks, append the disposition, and return a fresh source-bound handoff.
   If no new finding exists, make no further builder change.

The handoff to the parent campaign is therefore:
`PRODUCTION_CANDIDATE_PENDING_TESTS`, source-bound to the recorded baseline
plus staged path digests, with the Controller's independent platform audit,
merge, and feature-release gate still outstanding.

