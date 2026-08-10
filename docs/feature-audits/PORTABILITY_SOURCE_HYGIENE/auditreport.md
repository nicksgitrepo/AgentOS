# Portability, Source Hygiene, and Minimal Implementation Discipline

Feature: `PORTABILITY_SOURCE_HYGIENE`

Audit date: `2026-08-07`

Baseline: `ACCEPTED_MERGE_READBACK` (read-only accepted merge worktree)

Baseline source commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`

Baseline committed tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`

Baseline working-tree posture: `DIRTY`; the accepted merge includes uncommitted
assembly work. The committed identity is recorded above, but the dirty source
cannot receive clean-source production clearance.

This report is append-only. It contains no secret, credential, provider token,
private machine path, chat link, or task/session identity.

## Initial audit

### Audit scope and source intent

The inventory binds this feature to:

- `docs/rapid-foundations/08-code-hygiene.md`;
- `control/rapid-prototype/code-hygiene.mjs`; and
- `docs/roadmap.md`.

The complete related intent was also read through the implementation plan,
architecture notes, maintainer/operator guidance, and the relevant portable
schemas. The inventory is `PREPARED_NOT_ACTIVATED`; this audit does not activate
it or any prepared release line.

The foundation intends a narrow source-bound audit over changed surfaces. It
requires exact source binding before writing, the smallest reversible scope,
legible and non-duplicated source, subordinate generated material, focused and
repeatable checks, public/private separation, and an independent reviewer. Its
unavailable cases require fail-closed handling for source mismatch, unclear
scope or custody, unavailable checks, failed bounded checks, unowned derived
files, protected external actions, and identity substitution. Hostile cases
CH-01 through CH-08 cover wrong source, scope escape, private leakage, cleanup
that smuggles a refactor, false check success, unowned derived files, identity
substitution, and stale evidence.

The roadmap keeps portability partial: clean-environment checks, source
identity, hostile coverage, privacy, boundary evidence, and independent review
are required before a capability advances. The implementation plan narrows
this lane to one module and one focused test, forbids shared writes and
documentation-only implementation, and requires a typed handoff without
self-acceptance. The feature-completeness schema separately requires
project-relative public references and an Auditor that is not the builder or
acceptor. No public research record was found for this feature; the inventory's
owner-linked research source is therefore an unresolved evidence reference,
not an assumed requirement.

### Intended behavior

The intended local behavior is a deterministic changed-path result that:

1. accepts only the exact admitted implementation-lane paths;
2. rejects absolute, external, backslash, traversal, private, temporary,
   generated, shared, sibling-lane, malformed, duplicate, and invalid-scope
   observations without echoing unsafe input;
3. returns `CLEAN`, `SOFT_REVIEW`, or `HARD_STOP` with stable path and result
   digests;
4. keeps source binding, content scanning, generated-file authority, stale
   evidence, check execution, and independent clearance at their owning
   boundaries; and
5. leaves a portable, explicit handoff that names delegated checks, open risks,
   evidence, and the independent next reviewer.

### Actual implementation at baseline

The module is a bounded lexical path validator and result compiler. It has no
filesystem, network, process, provider, publication, deployment, or mutation
effect. It sorts paths by UTF-8 bytes, canonicalizes result objects, hashes
observations and findings, and redacts unsafe path values by retaining only a
digest. The focused test exercises the exact clean path set, review paths,
hard-stop path classes, duplicate input, invalid lists, empty observations,
scope mismatch, deterministic ordering, and unsafe-value non-echo behavior.

The current handoff contains the result schema, status, independent-check
request, non-claiming clearance, next reviewer, five delegated boundaries,
digest-bound evidence, and open risks. It does not yet expose all fields named
by the foundation's typed handoff contract.

### Initial evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Focused code-hygiene test | `PASS` | Exact-path, deterministic, soft-review, and hostile path cases pass. |
| Source hygiene | `PASS` | 498 text files have final newlines/no trailing whitespace; JSON and JavaScript syntax pass. |
| Architecture hygiene | `PASS` | 159 control modules are acyclic; twelve rapid lanes are wired and budgeted. |
| Rapid-slice regression | `PASS` | The assembled bounded slice passes while retaining independent clearance as requested. |
| Portability scan | `FAIL` | A persisted governance task/session UUID is present in `docs/feature-inventory.v1.json`; a private absolute baseline path is present in `docs/rapid-foundations/08-code-hygiene-auditreport.md`. |
| Feature-inventory verifier | `CHECK_UNAVAILABLE` | No dedicated `tests/verify-feature-inventory.mjs` exists in the baseline. |
| Functional/full tests | `PENDING` | Functional tests remain pending by the task instruction; no npm-based check is used. |

### Initial findings

#### F-PH-001 — Typed implementation handoff is incomplete (`OPEN_REPAIR`)

The local handoff omits the foundation contract's explicit phase, public lane,
task, scope, progress, result, hostile-coverage record, focused-check entries,
and close-readiness fields. The five delegated checks and open-risk strings are
useful, but a downstream reviewer cannot reproduce the lane boundary or
distinguish local path validation from the full hygiene decision without
narrative interpretation. This weakens handoff durability and independent
custody. The repair is local to the implementation module and its focused test:
add the smallest portable field set and assert its shape and digest binding.

#### F-PH-002 — Most hygiene authorities are correctly delegated but not locally executed (`DELEGATED`)

The implementation does not inspect file contents, symlinks, file type,
generated-source authority, semantic dependencies, exact source/cwd/tree
readback, check execution, or stale snapshots. That is consistent with the
foundation's boundary rule only if the host, security/privacy, project
configuration, snapshot verifier, and independent auditor provide the named
checks. The local result must not be treated as complete hygiene clearance.
Recovery: run those owners' exact source-bound checks and retain their typed
results; do not duplicate their authority in this lane.

#### F-PH-003 — Shared inventory contains task/session identities (`BOUNDARY_FINDING`)

The portability scan reports a task/session UUID in the governance-lane portion
of `docs/feature-inventory.v1.json`. This conflicts with the public-reference
and no-task-identity boundary. The inventory is shared coverage authority, not
an implementation-lane path. Recovery: the inventory/custody owner must replace
live identifiers with portable nulls or approved digests, preserve any mapping
privately, update the inventory parity record, and rerun the portability scan.
This lane does not edit the shared inventory.

#### F-PH-004 — Prior governance audit report contains a private baseline path (`BOUNDARY_FINDING`)

The portability scan reports the private absolute baseline path persisted in
`docs/rapid-foundations/08-code-hygiene-auditreport.md`. This is a public
source-hygiene violation even though it is historical evidence. Recovery: the
owning governance-lane maintainer must replace the path with a portable
baseline label plus a non-sensitive digest, preserve the finding history, and
rerun the portability scan. This feature lane does not rewrite another lane's
append-only report.

#### F-PH-005 — Research intent is not publicly bound (`EVIDENCE_GAP`)

The inventory names owner-linked research records in its source catalog, but no
public research record is present for this feature. The audit therefore cannot
claim that research assumptions, alternatives, or decisions were checked.
Recovery: provide a typed owner-linked record or explicitly mark research
not-applicable in the feature-completeness custody boundary.

#### F-PH-006 — No dedicated JSON schema for the local result/handoff (`SCHEMA_GAP`)

The module declares portable schema names as constants, but no corresponding
JSON schema is present in the related schema set. Runtime checks and focused
tests are evidence, not a durable interchange contract. Recovery: the schema
owner may add and bind a project-agnostic result/handoff schema in a separately
admitted shared-contract change. This lane must not edit schemas.

#### F-PH-007 — Clean-source production admission is unavailable (`CONTEXT_NEEDED`)

The authoritative merge worktree is dirty, and the portability scan has two
public-source failures. The implementation can be a bounded local candidate,
but it cannot be called production-ready. Recovery is exact: sanitize the two
shared public-source findings, obtain a clean exact source/cwd/commit/tree
readback, run the pending independent and functional checks, and recompute all
evidence from that same source snapshot.

### Cross-cutting quality and boundary assessment

| Dimension | Finding | Assessment |
| --- | --- | --- |
| Quality | `F-PH-001` | Local path behavior is clear and testable; typed handoff shape needs repair. |
| Hygiene | `F-PH-003`, `F-PH-004` | The local validator is non-echoing; the public baseline fails portability. |
| Minimality | None open locally | The module remains within the focused-module budget and adds no product behavior or external effect. |
| Security/privacy | `F-PH-003`, `F-PH-004` | Persisted identifiers and a private path are source leaks; local hostile values are digested, not echoed. |
| Durability | `F-PH-001`, `F-PH-006` | Digests are deterministic, but handoff/schema durability is incomplete. |
| Regression | `F-PH-007` | Focused, source, architecture, and rapid checks pass; portability fails and functional tests are pending. |
| Custody | `F-PH-002` through `F-PH-004` | Host, security, schema, inventory, and governance-report ownership must remain separate. |
| Boundary | `F-PH-002` | No external action or substitute authority is performed by this lane. |
| Intent | `F-PH-005`, `F-PH-007` | Roadmap status remains partial and inactive; no activation or production claim is inferred. |

### True blockers and recovery

No genuine external blocker is present. The dirty baseline, missing research
record, missing dedicated verifier, and portability failures are recorded
findings or custody-boundary gaps with concrete recovery paths. The only local
repair admitted now is `F-PH-001`; shared inventory/report/schema changes are
not admitted to this lane.

### Production readiness after initial audit

`NOT READY FOR PRODUCTION; BOUNDED LOCAL CANDIDATE PENDING REPAIR, SHARED-SOURCE SANITIZATION, FUNCTIONAL TESTS, AND INDEPENDENT CLEARANCE.`

### Builder actions recorded before repair

1. Import the accepted baseline implementation and focused test into this
   isolated worktree without changing unrelated source.
2. Repair only `F-PH-001` by making the handoff contract complete enough for a
   separate reviewer to understand scope, local result, delegated checks,
   hostile disposition, evidence, and next action.
3. Preserve all findings and do not edit shared inventory, another lane's
   report, or schemas.
4. Run a self-audit, repeat deterministic focused checks, and re-audit the
   complete feature before handoff.

## Builder repair and self-audit

The accepted baseline implementation and focused test were brought into this
isolated worktree as the only local source surface for the repair. The repair
changed only:

- `control/rapid-prototype/code-hygiene.mjs`
- `tests/rapid-prototype/code-hygiene.mjs`

The audit report is the required feature evidence path. No shared inventory,
governance-lane report, schema, plan, assembler, or unrelated source was
modified.

### Repair applied for F-PH-001

The handoff compiler now emits the smallest complete portable implementation
handoff shape: phase, public lane, task, scope, observed result, delegated
source readback, progress completed/remaining, dispositions for CH-01 through
CH-08, a typed local focused-check result bound to the validation digest,
non-self-clearing independent-review state, delegated checks, open risks, and
close readiness. `CLEAN` remains a local path result only; the handoff still
does not claim source binding, content, stale-snapshot, generated-authority,
or independent clearance.

The focused test now asserts the complete handoff shape, all eight hostile
case dispositions, digest binding, deterministic equality under path reorder,
and truthful `FAIL`/`NOT_READY` behavior for a hard-stop result.

### Self-audit evidence

- Local focused test: `PASS` twice in succession.
- JavaScript syntax: `PASS` for the repaired module and focused test.
- Deterministic repeat: `PASS`; result digest
  `8d7d1edd308e634f2bf4ebd2b9e3c3b1021f5babc8ee5edad4438c96c13b659b` was
  identical for reversed and canonical path order.
- Hostile non-echo probe: `PASS`; absolute and external synthetic inputs
  produced `HARD_STOP` findings without echoing either value.
- Local public-surface scan: `PASS`; the report and two repaired source files
  have final newlines, no trailing whitespace, and no private paths, chat
  links, credential/token shapes, or task/session UUIDs.
- Minimality: `PASS`; the repaired implementation is 443 lines and the
  focused test is 168 lines, both inside the 600-line rapid-lane budget. No
  external effect or new dependency was added.
- No npm command was used. Functional/full tests remain pending as required.

Repaired file SHA-256 values:

- `control/rapid-prototype/code-hygiene.mjs`:
  `843cc6b672bcda9d601c39b6855e68f80347379a0e1803d5a10aa0f3e1cb7e68`
- `tests/rapid-prototype/code-hygiene.mjs`:
  `b2303bf973cf860cb8f0e2b2c015d0cd1eafdde3b7aa4ad453d6266fda5af523`

## Re-audit

### Finding disposition

| Finding | Re-audit result | Evidence or exact recovery |
| --- | --- | --- |
| `F-PH-001` | `RESOLVED` | Complete typed handoff shape, hostile coverage, focused-check result, and digest binding pass in the focused test. |
| `F-PH-002` | `REMAINS_DELEGATED` | The local lane still correctly avoids host, content, symlink, generated-authority, stale-snapshot, and independent-clearance authority. Run the named owner checks before acceptance. |
| `F-PH-003` | `REMAINS_OPEN` | The authoritative portability scan still reports a task/session UUID in the shared inventory. Inventory custody must sanitize it and rerun portability. |
| `F-PH-004` | `REMAINS_OPEN` | The authoritative portability scan still reports a private baseline path in the prior governance report. Its owner must sanitize the historical report and rerun portability. |
| `F-PH-005` | `REMAINS_UNKNOWN` | No public research record is bound. Supply an owner-linked typed record or an explicit not-applicable decision. |
| `F-PH-006` | `REMAINS_DEFERRED` | No dedicated JSON schema exists for the runtime handoff names. Admit a separate shared-contract schema change if durable interchange is required. |
| `F-PH-007` | `REMAINS_CONTEXT_NEEDED` | The authoritative merge remains dirty; clean-source admission, functional tests, and independent clearance are still pending. |

The re-audit confirms that the local repair did not broaden authority, add a
product dependency, write outside the admitted local feature files, echo
unsafe input, or convert delegated checks into self-claims. The baseline-wide
portability failure is intentionally not narrated as a local pass.

### Production readiness

`PRODUCTION CANDIDATE PENDING CLEAN-SOURCE ADMISSION, SHARED PUBLIC-SOURCE SANITIZATION, RESEARCH/SCHEMA CUSTODY DECISIONS, FUNCTIONAL TESTS, AND INDEPENDENT CLEARANCE.`

## Re-audit after shared public-source sanitization

The shared inventory now uses stable opaque auditor and worktree references
instead of live task/session identifiers. The code-hygiene lane report now uses
`CONTROL_PLANE_BASELINE` instead of an absolute host path. These changes keep
the one-task/one-worktree parity contract while removing host-specific identity
and location data from portable records. The original findings remain in this
append-only report history; the current disposition is resolved for the two
shared-source privacy findings, pending the normal source-bound scan and
independent clearance.

| Finding | Current disposition | Evidence |
| --- | --- | --- |
| `F-PH-003` | `RESOLVED_PENDING_SCAN` | Inventory task/worktree values are opaque stable references; live GUI identities remain outside the repository. |
| `F-PH-004` | `RESOLVED_PENDING_SCAN` | The historical code-hygiene baseline is now a portable control-plane label; the absolute host path is no longer persisted. |

Production readiness is `NO`. The prepared `2.1rc` line remains inactive. No
publish, push, merge, deployment, release activation, provider action, or
destructive action was taken.

### Final handoff

Status: `CONTEXT_NEEDED`

Changed files: the two repaired implementation-lane files above plus this
feature audit report. Resolved history remains preserved in the initial-audit
and repair sections.

Evidence: focused behavior `PASS`; syntax `PASS`; deterministic repeat `PASS`;
local public-surface scan `PASS`; authoritative portability `FAIL` on the two
shared-source findings; functional/full tests `PENDING`.

Remaining findings are not genuine external blockers. They are concrete
shared-custody and unavailable-evidence conditions with the recovery actions
listed above. The next action is for the inventory/governance-report owners to
sanitize the two public-source leaks, followed by a clean exact-source
readback, the pending functional and independent checks, and a fresh
re-audit. Until then, do not claim production clearance or activation.
