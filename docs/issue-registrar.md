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
delivery. Repair requires a registered PASS+READY record and one lane unless an
exact Owner atomic group is supplied. Audit requires an issue ID, immutable
commit/tree, scope, and verification contract. Runtime requires an
identical-byte independent PASS and equality of local, fetched-origin, and
GitHub identities. The Markdown projection can be written only by the admitted
Registrar role to the operations-root `issues.md` path after
`DELIVERED_VERIFIED` evidence.

## Projection and history

`issues.md` has stable anchors and deterministic sections for provisional or
compliance failures, READY, in-repair, auditing, blocked/NOT_READY, delivered,
and regressions. Details are sorted by issue ID and contain only typed fields
and controlled evidence references.

Historical import is bounded to supplied typed source records. Audit Pyramid
feature/platform reports, later feature-status and verified-functional audits,
issue packets/candidates, and NOT_READY backlogs may be imported when their
source references are provided. `CREATED` templates and uncertain legacy
findings remain provisional and retain explicit missing-evidence reasons; the
Registrar never fabricates a finding or silently upgrades a legacy record.
