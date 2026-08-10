# ROADMAP_01_PORTABLE_KERNEL — Deterministic Portable Kernel

Status: `AUDIT_FINDINGS_OPEN`

This report is append-only. It records the audit, repair, self-audit, and
re-audit history for the portable-kernel slice. It contains only repository-
relative references, portable findings, and public evidence summaries.

## Audit cycle 1 — initial audit

Audit date: `2026-08-07`

### Intent reviewed

The audit read the feature intent and its cross-cutting contracts from:

- `docs/roadmap.md`, including the Deterministic Portable Kernel promise and
  completion tests;
- `governance/2.1rc/portable-kernel.md`, including context separation,
  deterministic authority, fail-closed behavior, custody, replay, and inactive
  release boundaries;
- `governance/2.1rc/portable-authority-corpus-format.md`, including immutable
  article identity, machine-index parity, supersession, and rejection rules;
- `schemas/kernel.v1.json`;
- `schemas/capability-and-worktree-registry.v1.json`;
- `authority/templates/project-context.v1.json`;
- the applicable foundation intent, evidence, security/privacy, recovery, and
  delivery documentation; and
- the executable authority in `control/authority-corpus.mjs`, its portability
  verifier, the canonical verifier, and the bound schemas.

### Evidence captured

- `node tests/verify-portability.mjs` passed: deterministic corpus compilation,
  context-separation, containment, and symlink cases currently covered by that
  verifier.
- `node tests/verify-all.mjs` passed: the existing canonical suite and its
  listed hostile suites passed.
- Targeted synthetic probes found the four implementation mismatches below.
  The probes used only temporary synthetic directories and did not mutate the
  repository or perform external actions.
- Functional/product acceptance tests remain pending; the passing checks above
  are not a production or activation claim.

### Findings

#### PK-001 — authority-corpus roots are not contained by `authority_root`

Severity: `HIGH`  |  Dimensions: `SECURITY`, `PRIVACY`, `CUSTODY`, `DURABILITY`

`validateCorpusInputs` normalizes the configured roots and checks overlap among
the distinct directory roots, but `authority_root` is not used as the required
container. `compileCorpusPlan` therefore accepts a context whose declared
`authority_root` is `authority` while a generated corpus root is `outside/data`.
The schema and template require the authority root to be the sole container for
the distinct corpus roots. A later apply could write outside the admitted
authority subtree.

Required repair: enforce lexical and realpath containment of every corpus root
and the index path beneath `authority_root`, while retaining distinct-root and
symlink protections.

#### PK-002 — authority-index replacement is not compare-and-swap protected

Severity: `HIGH`  |  Dimensions: `DURABILITY`, `CUSTODY`, `QUALITY`

`applyCorpusPlan` reads an existing index, then stages a new index and
unconditionally renames it over the target. It accepts and rewrites a tampered
or stale index without an expected parent digest. This conflicts with the
append-only/CAS kernel rule and the registry refusal of silent overwrite. The
targeted probe accepted the tampered index and rewrote it.

Required repair: make existing-index updates require an expected SHA-256 parent
digest, reject stale or unapproved replacement, preserve idempotent no-op
replays, and read back the committed index identity.

#### PK-003 — corpus plan identity does not use the declared portable context digest

Severity: `HIGH`  |  Dimensions: `INTENT`, `DURABILITY`, `REPLAY`, `PRIVACY`

`compileCorpusPlan` hashes the entire wrapper context and does not validate or
bind `portable_template_instance.project_identity.exact_context_digest` using
the template's stated omission rule. The synthetic fixture's declared digest
and the plan's computed digest differ. This permits compatibility-only wrapper
changes or a stale declared digest to alter or mislabel replay identity.

Required repair: validate the portable instance and its declared exact digest,
derive the plan identity from that exact portable instance, and keep wrapper
metadata outside the portable digest.

#### PK-004 — machine index entries omit required page-contract metadata

Severity: `MEDIUM`  |  Dimensions: `INTENT`, `CUSTODY`, `QUALITY`

`buildAuthorityIndex` emits only path, page type, page ID, entity ID when
present, and content digest. The registry requires the index to bind owner,
status, source identity, supersession, freshness, and dependencies, and the
authority format rejects disagreement between article headers and machine
metadata. The current index cannot detect or represent that disagreement.

Required repair: validate generated/existing page headers and include the
required metadata in every deterministic index entry.

#### PK-005 — focused hostile coverage is missing from the canonical suite

Severity: `MEDIUM`  |  Dimensions: `QUALITY`, `SECURITY`, `DURABILITY`, `CUSTODY`

The broad suite does not exercise the four portable-kernel cases above:
authority-root escape, stale-index replacement, declared portable-context
digest mismatch, and page-header/index parity. `tests/verify-all.mjs` also has
no feature-specific assertion for those invariants. A green suite therefore
does not currently establish the roadmap's hostile coverage bar for this
slice.

Required repair: add deterministic focused probes for each finding and include
them in the canonical verification route without claiming functional or
activation evidence.

### Initial disposition

The feature remains `PARTIAL` and is not a production candidate. No owner
boundary, activation decision, external action, or cross-project change is
required. Next action: repair only PK-001 through PK-005 in the writable
worktree, then run a self-audit and a fresh independent re-audit against all
required dimensions.

## Audit cycle 2 — repair and self-audit

Repair date: `2026-08-07`

### Finding-driven changes

- `control/authority-corpus.mjs` now rejects equal, escaping, or mismatched
  corpus roots; validates the declared portable-instance digest; binds the
  portable roots and entities used by compilation to that digest; emits and
  validates page-contract metadata; uses an exclusive index lock; requires an
  expected parent digest for changed index replacement; preserves exact no-op
  replays; and verifies index readback.
- `control/bootstrap-compiler.mjs` now derives default corpus roots and the
  authority index beneath the declared authority root, so the Bootstrap path
  satisfies the same containment rule instead of requiring an exception.
- `examples/project-context-fixture.v1.json` now carries the digest required by
  the declared portable-template omission rule.
- `tests/verify-portability.mjs` now covers root escape, projection drift,
  stale context digest, idempotent replay, metadata parity, silent overwrite,
  stale CAS parent, successful CAS replacement, and readback identity.
- `schemas/bootstrap-binding.v1.json` records the new SHA-256 identities for
  the changed bound compilers, synthetic fixture, and portability verifier.

### Self-audit by required dimension

| Dimension | Result | Evidence |
|---|---|---|
| Quality | `PASS_WITH_FUNCTIONAL_TESTS_PENDING` | Focused verifier and canonical verifier pass; `git diff --check` passes; bound-file digests match. |
| Security | `PASS_WITH_FUNCTIONAL_TESTS_PENDING` | Lexical root containment, symlink rejection, no-follow writes, stale CAS rejection, and no external-action path are covered. |
| Privacy | `PASS_WITH_FUNCTIONAL_TESTS_PENDING` | Portable digest excludes wrapper metadata by contract; public inventory scan passes; the report contains no private paths, secrets, or chat links. |
| Durability | `PASS_WITH_FUNCTIONAL_TESTS_PENDING` | Exclusive index lock, explicit parent digest, idempotent no-op, atomic staging, and exact readback are covered. |
| Custody | `PASS_WITH_FUNCTIONAL_TESTS_PENDING` | Apply still requires explicit `ACTIVATED`; stale or unapproved index replacement fails closed; `2.1rc` remains prepared and inactive. |
| Intent | `PASS_WITH_FUNCTIONAL_TESTS_PENDING` | Plan identity uses the declared portable context digest and rejects wrapper/projection drift; generated page source identity must match the plan. |

### Self-audit disposition

PK-001 through PK-005 are repaired in the writable worktree. No unrelated
project or external system was changed. Functional/product acceptance remains
pending as instructed; this self-audit does not claim activation, deployment,
release, or live acceptance. Next action: perform the final re-audit from the
post-repair tree and retain any residual finding explicitly.

## Audit cycle 3 — final re-audit

Re-audit date: `2026-08-07`

### Fresh evidence

- `node tests/verify-portability.mjs` passed on the post-repair tree: 207
  files scanned, 143 bound paths checked, and deterministic context identity,
  root containment, CAS index behavior, metadata parity, extension boundaries,
  and symlink cases passed.
- `node tests/verify-all.mjs` passed on the post-repair tree: 207 files
  scanned, 136 normative paths hashed, and the canonical JSON, script,
  portability, lifecycle, Bootstrap, advisory exchange, and hostile suites
  passed.
- `git diff --check` passed.
- Bound SHA-256 identities read back successfully through the canonical
  verifier.
- `schemas/kernel.v1.json` and `schemas/bootstrap-binding.v1.json` still report
  `PREPARED_NOT_ACTIVATED`; no activation or external side effect occurred.
- A final report scan found no private filesystem path, secret, chat link, or
  session identity in this report.

### Finding resolution

| Finding | Final result | Re-audit evidence |
|---|---|---|
| PK-001 | `RESOLVED` | Root/index containment and projection-drift hostile cases reject before apply; Bootstrap defaults are now beneath `authority_root`. |
| PK-002 | `RESOLVED` | Unchanged replay is a no-op; stale or missing parent identity rejects; explicit CAS replacement reads back the exact digest. |
| PK-003 | `RESOLVED` | Declared portable-instance digest is validated; compiled roots/entities must match that projection; stale wrapper identity rejects. |
| PK-004 | `RESOLVED` | Generated page headers carry the required metadata and the index validates and carries the same identity, status, ownership, freshness, supersession, and dependencies. |
| PK-005 | `RESOLVED` | The focused hostile cases run through `tests/verify-portability.mjs`, which is invoked by `tests/verify-all.mjs`. |

### Final dimension re-audit

| Dimension | Result | Remaining condition |
|---|---|---|
| Quality | `PASS_PENDING_FUNCTIONAL_TESTS` | Product/functional acceptance is still pending. |
| Security | `PASS_PENDING_FUNCTIONAL_TESTS` | Product/functional acceptance is still pending. |
| Privacy | `PASS_PENDING_FUNCTIONAL_TESTS` | Product/functional acceptance is still pending. |
| Durability | `PASS_PENDING_FUNCTIONAL_TESTS` | Product/functional acceptance is still pending. |
| Custody | `PASS_PENDING_FUNCTIONAL_TESTS` | Product/functional acceptance is still pending. |
| Intent | `PASS_PENDING_FUNCTIONAL_TESTS` | Product/functional acceptance is still pending. |

### Final handoff

Changed files are limited to:

- `control/authority-corpus.mjs`;
- `control/bootstrap-compiler.mjs`;
- `examples/project-context-fixture.v1.json`;
- `schemas/bootstrap-binding.v1.json`;
- `tests/verify-portability.mjs`; and
- `docs/feature-audits/ROADMAP_01_PORTABLE_KERNEL/auditreport.md`.

Remaining finding: `FUNCTIONAL_TESTS_PENDING` only. This is an instructed test
handoff condition, not an implementation defect or external blocker. The
portable-kernel slice is a production candidate pending those tests. Next
action: run the receiving functional/product acceptance checks, then make any
explicit owner activation decision separately; do not infer activation from
this audit.

## Central integration intake — 2026-08-09

- visible_task_ref: TASK_REF_ROADMAP_01_VISIBLE
- isolated_worktree_ref: WORKTREE_REF_64C9
- source_head: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- source_tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- isolated_report_sha256: `76484238d5db505fdf243f83ca2d52ec3f066de8049e3ee84ac3afdfabf4e7a9`
- central_disposition: SOURCE_BOUND_CANDIDATE_INTEGRATED_PENDING_BINDING_REFRESH
- changed_path_disposition: authority compiler, Bootstrap compiler, portable fixture, and portability verifier integrated; binding refresh intentionally deferred until the combined dirty source is settled
- functional_status: NOT_RUN_BY_INSTRUCTION
- archive_status: WITHHELD_UNTIL_DOWNSTREAM_REVIEW

## Central integration intake — 2026-08-09 (accepted platform seed)

- visible_task_ref: `TASK_REF_ROADMAP_01_VISIBLE`
- isolated_worktree_ref: `WORKTREE_REF_EB84`
- feature_base_commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- accepted_platform_seed_commit: `fbd53ea211e1d181444fb460b7d0c610e2f0921b`
- accepted_platform_seed_tree: `1fc49fcb55db20f8bd3095b96ca8d8622d883a46`
- handoff_state: `FEATURE_CANDIDATE_READY_FOR_PLATFORM`
- source_equivalence: The five feature implementation and verification paths reported by the visible lane are byte-identical to the accepted platform seed. No additional source delta was required in the cumulative integration worktree.
- report_preservation: The earlier central intake record remains preserved above; this intake records the later visible lane re-audit and seed-equivalence readback.
- central_disposition: `INTEGRATED_INTO_PLATFORM_SEED_PENDING_DOWNSTREAM_PLATFORM_REVIEW`
- functional_status: `NOT_RUN_BY_INSTRUCTION`
- archive_status: `WITHHELD_UNTIL_DOWNSTREAM_REVIEW`
