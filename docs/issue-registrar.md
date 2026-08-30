# AgentOS Issue Registrar — Permanent

`AGENTOS.ISSUE_REGISTRAR` is the single writer for the typed issue registry and
the deterministic `issues.md` projection. It accepts standardized submissions,
reserves an immutable number before validation, and never loses an incomplete,
blocked, rejected, contradicted, or failed record.

## Record lifecycle

Issue identifiers use an extensible product prefix and the stable form
`PREFIX-ISSUE-YYYY-NNNN`. A non-duplicate submission first reserves a number.
If required fields are absent or invalid, the same number is persisted as
`INTAKE_FAILED` / `NOT_AUTHORIZED` with failure code
`INCOMPLETE_STANDARDIZED_ISSUE`, accepted fields, every missing or invalid
field, resubmission requirements, reporter snapshot, and evidence references.
Completion upgrades that same identifier. A duplicate consumes no number and
links to the existing record while retaining reporter attribution and evidence.

Transitions are append-only and content addressed. Same-root recurrence reopens
the existing issue; a different-root recurrence is a linked new issue. A
regression is a new record with `regression_of`. Only Project Owner authority
may set `DEFERRED`, `ACCEPTED_RISK`, or `WONT_FIX`.

## Evidence and privacy

Evidence is represented by stable `ref:` or `opaque:` references and SHA-256
digests. Sensitive evidence is always reduced to an opaque controlled
reference; raw credentials, tokens, private payloads, and secrets are not
persisted. Reporter task, thread, turn, and item values are snapshots captured
at intake, so reporter disappearance cannot erase an issue.

## Workflow gates

The registrar exposes deterministic gates for repair, audit, and Runtime
delivery. Repair claims exactly one registered PASS+READY root issue. A bounded
causal seam-closure set is permitted only when each material companion arrives
as a typed `SEAM_FINDING` or `SCOPE_AMENDMENT`, receives its own immutable ID,
links to the same root with `CHILD_OF`, `DEPENDS_ON`, `SAME_ROOT_CAUSE`, or an
explicit Owner atomic-seam relation, and is covered by an Owner-authorized
rationale, bounded path list, and verification mapping. Broad audits,
opportunistic feature work, product-intent decisions, self-authorization,
custody conflicts, and unrelated findings fail closed; unrelated records remain
visible provisional/READY follow-ons. The handoff enumerates the root, every
companion ID, the in-seam rationale, paths, and verification mapping so an
Auditor can reject unjustified expansion.

Audit requires an issue ID, immutable commit/tree, scope, and verification
contract. Runtime requires an identical-byte independent PASS and equality of
local, fetched-origin, and GitHub commit/tree identities; a claimed delivery
status cannot override a mismatch.

## Dual canonical projections

The admitted Registrar is the sole writer of both operations-root `issues.md`
and `cleared-issues.md`. The two files are prepared and replaced as one
dual-file transaction, with symlink/non-regular collisions and partial writes
failing closed. `issues.md` contains provisional, issued/READY, active,
auditing, blocked/NOT_READY, and regression records plus compact stable
tombstones linking cleared IDs. `cleared-issues.md` contains full delivered or
resolved records only after the independent PASS and three-way Runtime identity
check. IDs and history are never deleted, reused, or renumbered.

`reconcileIssueProjections()` returns canonical registry/projection counts,
disjoint ID sets, and content digests. A projection is not accepted when either
file is missing, substituted, stale, colliding, or inconsistent with typed
state.

## Projection and history

`issues.md` has stable anchors and deterministic sections for provisional or
compliance failures, READY, in-repair, auditing, blocked/NOT_READY, delivered,
regressions, and cleared tombstones. Details are sorted by issue ID and contain
only typed fields and controlled evidence references. `cleared-issues.md` has a
stable full-record section for the cleared set.

Historical import is bounded to supplied typed source records discovered under
authorized Projects roots. `audit.md`, `auditreport.md`, issue/research
packets, candidate verdicts, feature/platform inventories,
consumption/seam ledgers, Runtime receipts, NOT_READY/backlog sources, and
equivalent artifacts may be imported when their source references and digests
are provided. `CREATED` templates, duplicates, and uncertain legacy findings
remain provisional or linked with explicit missing-evidence reasons; the
Registrar never fabricates a finding, delivery, acceptance, or PASS.
