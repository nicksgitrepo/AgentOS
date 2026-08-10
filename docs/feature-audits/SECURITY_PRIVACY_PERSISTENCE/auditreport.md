# SECURITY_PRIVACY_PERSISTENCE audit report

## Cycle status

`INITIAL_AUDIT_RECORDED — REPAIR_IN_PROGRESS`

This report is append-only. The accepted merge was read as the authority
baseline; only this isolated worktree is writable. Functional tests are
intentionally pending for the parent verification phase. No npm workflow is
used.

## Feature identity and source binding

- Feature ID: `SECURITY_PRIVACY_PERSISTENCE`
- Inventory name: `Security, Privacy, Secret-Free Persistence, and Boundary Enforcement`
- Inventory status at baseline: `NOT_STARTED`
- Inventory source set: `docs/rapid-foundations/09-security-and-privacy.md`,
  `schemas/persisted-record-privacy.v1.json`, and
  `control/persisted-record-privacy.mjs`.
- Authoritative baseline commit: `590c07ddd4be7a8c24727c24b40808e44ca7357d`
- Authoritative committed tree: `f1b358d87e6a969fb9631e202a3d478540edd4d9`
- Baseline source status: the accepted merge includes the privacy slice as
  uncommitted feature files plus related cross-cutting changes; the isolated
  worktree is clean at the same committed baseline and does not contain that
  slice.

## Intended behavior audit

The roadmap and the security foundation require a portable, project-agnostic
boundary that keeps public governance separate from private project context.
The intended contract is:

1. discovery and public serialization read no secrets and perform no
   authentication, network, spending, publication, deployment, deletion, or
   activation;
2. private paths, worktree paths, environment values, credentials, session or
   task identities, private links, raw evidence, and raw conversations do not
   cross into public records;
3. provenance survives as classifications, bounded labels, and stable
   digests rather than protected payloads;
4. every boundary crossing is typed and fail-closed; unavailable classification,
   redaction, identity, or authority yields `UNAVAILABLE`, `UNPROVEN`, or
   `HARD_STOP`, never an inferred pass;
5. persisted output is deterministic, schema-valid, atomic, outside the Git
   repository, and protected from symlink redirection; and
6. `2.1rc` remains prepared and inactive, with no production-security,
   compliance, authentication, encryption, retention, or product-specific
   claim inferred from this feature.

The roadmap additionally requires privacy scanning to support portable
continuity and clean-machine verification. The foundation’s hostile cases
require rejection of disclosure requests, private-context leakage,
unverified source/identity, external-action requests, and unavailable
security checks.

## Research and authority coverage

The inventory names `research-records-linked-by-owner` as a source alias for
several capabilities, but no separately materialized research-record file is
present in the accepted merge tree. The available roadmap, architecture,
foundation evidence, accepted-merge review, schema, implementation, and
verifier provide enough local authority for this bounded repair. The missing
owner-linked research corpus is recorded as an evidence unknown, not treated
as permission to weaken the portable contract and not treated as an external
blocker.

## Actual implementation audit

The accepted merge’s intended slice contains:

- `schemas/persisted-record-privacy.v1.json`, defining a redacted record with
  source/original digests, six privacy categories, redaction counts, optional
  host-local configuration reference, disabled protected actions, and a
  content digest;
- `control/persisted-record-privacy.mjs`, providing scanning, redaction,
  safe assertions, deterministic serialization, host-local configuration
  references, redacted-record compilation/validation, and an atomic writer;
- `control/content-addressing.mjs`, providing the shared canonical JSON and
  digest primitive while re-exporting the privacy boundary; and
- `tests/verify-persisted-record-privacy.mjs`, containing synthetic hostile
  fixtures, public-surface scanning, redaction, outside-repository custody,
  and shared-export checks.

The accepted-merge review and evidence claim static inventory/content scans,
binding regeneration, and whitespace review. They explicitly leave
functional acceptance pending. The isolated worktree has none of the above
feature files, so it cannot currently provide the intended behavior or a
reproducible focused check.

## Findings recorded before repair

### SPP-001 — missing isolated feature slice — P1

The isolated worktree has no privacy schema, serializer, shared content
addressing module, or focused verifier. This is a concrete implementation gap,
not a test-only issue: there is no typed boundary to call or inspect.

Why it matters: the candidate cannot prove secret-free persistence, schema
parity, deterministic custody, or hostile-boundary behavior.

Evidence: inventory source paths absent from the isolated worktree; the same
paths are present in the read-only accepted merge baseline.

Builder action: add the smallest project-agnostic privacy schema, serializer,
shared canonical-addressing dependency, and focused verifier in this feature
scope.

### SPP-002 — incomplete key and link classification — P1

The accepted serializer’s key rules are primarily snake_case and its private
link pattern covers private schemes/local hosts but not generic chat or
conversation URL routes. CamelCase fields such as `threadId` or
`projectRoot`, and a chat-shaped HTTPS route, can therefore escape key-based
redaction or scanning.

Why it matters: a caller can satisfy the lexical scanner while exporting a
private identity, path, or chat link. This violates the minimum-public-fact
and no-chat-link boundary.

Builder action: normalize field names before classification, add a
project-agnostic chat/conversation/share-route pattern, and add hostile
fixtures that prove both redaction and post-redaction scanning.

### SPP-003 — symlink custody gaps — P1

The accepted host-config resolver realpaths before checking symlink status, so
an input symlink can appear as a regular target. The atomic writer checks the
leaf target but does not verify every existing parent component before
recursive directory creation.

Why it matters: a host-local configuration or persisted target can be
redirected across the intended custody boundary, defeating outside-repository
and local-only guarantees.

Builder action: reject symlink components for configuration and target paths,
recheck after directory creation, and preserve atomic replacement semantics.

### SPP-004 — validator/schema parity gap — P1

The accepted runtime validator checks core values but does not enforce the
schema’s closed object shapes for the root record, redaction counts, runtime
reference, and protected-action object. It also relies mainly on textual
scanning, so arbitrary values under sensitive structured keys are not
independently classified.

Why it matters: a record can be digest-valid yet not be schema-valid or
provably free of key-designated private values. Boundary evidence would be
weaker than the declared contract.

Builder action: enforce exact allowed keys and safe structured-key handling;
keep the record digest calculation bound to the validated shape.

### SPP-005 — malformed structured text can fall back to lexical redaction — P2

The accepted text helper attempts JSON redaction, then falls back to raw
lexical replacement after a parse error. A malformed structured payload can
contain key-designated identities or paths that lexical patterns do not
recognize.

Why it matters: an unavailable classifier is treated as best-effort text
instead of the foundation’s required unavailable/fail-closed result.

Builder action: fail closed for malformed structured-looking text; callers may
replace the entire error with an opaque digest.

### SPP-006 — evidence count/hygiene imprecision — P2

The accepted scanner reports at most one match per category and contains an
unused category helper. Counts can under-report multiple exposures, making
the typed redaction evidence less precise and leaving avoidable dead code.

Why it matters: audit evidence and downstream decisions can understate the
amount of protected material encountered.

Builder action: count all matches deterministically and remove unused logic.

## Cross-cutting quality findings

- Quality: the intended API is small and deterministic, but the missing
  isolated files and validator/schema drift prevent a meaningful candidate.
- Hygiene: the accepted slice has a dead classifier and needs focused hostile
  coverage for key normalization, links, and symlink custody.
- Minimality: the repair can remain confined to the privacy serializer,
  shared canonical-addressing dependency, schema, verifier, and this report.
- Security/privacy: SPP-002 through SPP-005 are boundary-relevant and must be
  repaired before readiness.
- Durability: atomic write and content digests are the right shape; parent
  symlink checks and exact schema validation are required for custody.
- Regression: the shared primitive must preserve deterministic key ordering
  and the existing public export names.
- Custody: runtime configuration and persisted records must remain outside the
  repository and must not expose raw host values.
- Boundary: protected actions remain disabled; no external, destructive,
  activation, publication, deployment, or provider action is in scope.
- Intent: the portable kernel remains product-agnostic; no product name,
  provider identity, owner identity, chat link, credential, or private path is
  to be added to the implementation or report.

## True blockers and exact recovery

No true external blocker is present. The missing owner-linked research corpus
is an evidence unknown that does not prevent a conservative local repair. The
only required recovery is mechanical: add the recorded feature files in this
isolated worktree, then perform the self-audit and re-audit. Functional tests
remain pending by instruction and are not treated as a blocker to static
repair; their exact next action is to run the focused and broader verification
later under the parent acceptance authority.

## Builder actions and initial handoff

1. Add the privacy schema and implementation from the accepted intent, with
   the five recorded implementation repairs.
2. Add the shared canonical-addressing boundary without changing unrelated
   product or provider behavior.
3. Add hostile focused checks for the repaired paths without executing them in
   this task.
4. Self-audit changed paths and report contents for secrets, credentials,
   private paths, provider tokens, chat links, and unsupported claims.
5. Re-audit every finding, append resolved history, and leave only test-pending
   or genuinely external items in the final handoff.

Initial readiness: `NOT_READY — SPP-001 through SPP-005 open`.

## Self-audit finding before binding repair

### SPP-007 — feature slice not admitted to the canonical binding — P1

The new privacy controller, shared content-addressing module, and focused
verifier are present in the isolated worktree, but the baseline
`schemas/bootstrap-binding.v1.json` and explicit verifier list do not name
them. The feature would therefore be syntactically present without being
covered by the repository’s normative source binding or canonical focused
run.

Why it matters: acceptance could omit the very boundary implementation and
hostile checks that establish secret-free persistence.

Builder action: add only the three feature implementation/verifier entries to
the normative binding and add the focused verifier to the canonical list;
refresh their digests after the repair. The privacy schema remains a checked
JSON contract and is not copied into any public payload.

## Repair pass 1 and self-audit

The builder repaired only SPP-001 through SPP-007. The implementation is
project-agnostic and keeps protected values out of stored records:

- `control/persisted-record-privacy.mjs` now normalizes snake_case, kebab,
  and camelCase keys before classifying identities, paths, environment values,
  credentials, and private-link fields;
- private schemes, local/private hosts, and generic chat/conversation/share
  URL routes map to the existing `UNSAFE_PRIVATE_LINK` category without
  naming a provider;
- structured values under sensitive keys are classified even when their
  contents do not look like a UUID, path, or token, and redacted values are
  checked again after transformation;
- malformed structured-looking text fails closed instead of falling back to
  an incomplete lexical redaction;
- schema validation enforces closed object shapes, safe schema/label syntax,
  nonnegative exact redaction counts, disabled protected actions, and the
  content digest;
- host configuration and output paths reject symlink components before and
  after directory creation, require outside-repository custody, and use an
  exclusive staged file followed by atomic rename;
- match counting is deterministic and counts all occurrences; the unused
  classifier from the accepted slice is absent;
- `control/content-addressing.mjs` exposes the shared canonical digest and
  privacy-safe persistence API; and
- `schemas/bootstrap-binding.v1.json` and `tests/verify-all.mjs` now admit the
  schema, controller, shared primitive, and focused verifier.

Self-audit evidence:

- static syntax checks passed for the two controllers, focused verifier, and
  canonical verifier;
- JSON parsing passed for the privacy schema and bootstrap binding;
- binding digest reconciliation passed for every newly admitted path and the
  updated canonical verifier;
- trailing-whitespace review passed for all changed paths;
- source-hygiene review found no concrete secret, credential, provider token,
  chat link, or private machine path; only generic detection expressions and
  runtime-constructed synthetic hostile fixtures remain;
- no npm command, network action, authentication, publication, deployment,
  deletion, activation, or external delivery was performed.

## Re-audit disposition

| Finding | Re-audit result | Evidence |
| --- | --- | --- |
| SPP-001 | `RESOLVED` | Privacy schema, controller, shared primitive, focused verifier, and report are present in the isolated scope. |
| SPP-002 | `RESOLVED` | Key normalization, generic chat-route classification, structured-key scan, and hostile fixtures are present. |
| SPP-003 | `RESOLVED` | Configuration and target custody reject symlink components and recheck after recursive directory creation. |
| SPP-004 | `RESOLVED` | Closed-shape validation, safe labels, exact category counts, and structured-key classification are enforced. |
| SPP-005 | `RESOLVED` | Structured-looking malformed text throws a fail-closed error in both text and scan paths. |
| SPP-006 | `RESOLVED` | All-match counting is used and the dead classifier is removed. |
| SPP-007 | `RESOLVED` | Binding hashes reconcile and the focused verifier is in the canonical verifier list. |

## Remaining findings, unknowns, and readiness

No repaired finding remains open and no genuine external blocker was found.
The owner-linked research source named by the inventory remains unavailable as
a separately materialized local record; it is retained as an evidence unknown
and does not authorize any weaker behavior. The accepted merge’s broader
cross-cutting call sites remain parent-merge custody; this isolated delta
provides the portable boundary, schema, shared primitive, and admission proof
for them.

Production readiness: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_TESTS`.

Functional verification is intentionally pending and no pass is claimed for
it. The exact next action is for the parent acceptance authority to run the
focused privacy verifier, the canonical verifier, and the portability check
on the reconciled accepted candidate, then record any returned failure as a
new typed finding rather than inferring success.

## Final handoff

Changed paths:

- `control/persisted-record-privacy.mjs`
- `control/content-addressing.mjs`
- `schemas/persisted-record-privacy.v1.json`
- `schemas/bootstrap-binding.v1.json`
- `tests/verify-persisted-record-privacy.mjs`
- `tests/verify-all.mjs`
- `docs/feature-audits/SECURITY_PRIVACY_PERSISTENCE/auditreport.md`

Evidence: static syntax, JSON, binding-digest, whitespace, and source-hygiene
checks passed; functional tests remain pending. Next action: parent-level
functional verification and accepted-merge reconciliation under the existing
inactive-release and protected-action boundaries.
