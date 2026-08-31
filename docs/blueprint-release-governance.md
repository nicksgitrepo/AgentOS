# Immutable Blueprint Release Governance

This portable contract publishes a Blueprint as a sealed, versioned,
content-addressed release. Every release has a stable `release_id`, relative
release path, manifest/path SHA-256, sorted issue entries, and a self digest.
Once sealed, bytes at that identity cannot be rewritten. A correction is a
different successor release and explicitly binds `supersedes.release_id` and
`supersedes.release_sha256`.

## Direct consumption

Repair reads the release and index files directly. It first records one fresh
canonical preflight covering current status, source base, clean custody, and
collision absence. The preflight binds both the release and index digests.
Absent, stale, dirty, or conflicting evidence is rejected before consumption.
No `BLUEPRINT_CONSUMED` message is emitted and no per-issue acknowledgement is
requested.

The producer may emit at most one `FINAL_CONSOLIDATED_BATCH` notice. Factual
inputs (`evidence`, `root_cause`, `constraints`, and `acceptance_criteria`) are
separate from advisory batching or implementation suggestions. Lifecycle
traffic is limited to `ISSUE_STARTED`, issue-ID-requiring scope additions,
evidence-complete true blockers, and `DELIVERED_VERIFIED`.

## Registrar boundary

`AGENTOS.ISSUE_REGISTRAR` stores only a typed reference containing the release
ID, portable relative path, and SHA-256. It never embeds Blueprint bytes,
factual/advisory content, producer notices, acknowledgement requests, or
coordination messages. Historical Blueprint Architect artifacts remain outside
the portable package and are not silently imported as acceptance.
