# LANE_05 preservation manifest

This is an append-only, content-addressed preservation manifest for evidence
found in the existing visible LANE_05 worktree. It does not activate the lane,
accept the handoff, or authorize stale-worktree closure.

```yaml
manifest_type: LANE_05_HISTORICAL_HANDOFF_PRESERVATION
lane_id: LANE_05_PROGRESS_AND_HEALTH
worktree_ref: WORKTREE_REF_042
source_commit: 590c07ddd4be7a8c24727c24b40808e44ca7357d
source_tree: f1b358d87e6a969fb9631e202a3d478540edd4d9
current_authority_sha256: a882a74b6a71ba1fbe59e1200b230ebbcf8331186cfaee9a1da50f6a9bec3e0d
historical_receipt_authority_sha256: 277940ab04e30f9250b756a204067355702e69b6cc26417ceb8d5a563d51a702
append_only: true
lifecycle: DIRTY_UNCOMMITTED_PRESERVED
disposition: HISTORICAL_GOVERNANCE_CUSTODY_NOT_ACTIVE_PLATFORM_LANE
acceptance: NOT_CLAIMED
next_action: PRESERVE_PAYLOAD_THEN_AWAIT_SOURCE_BACKED_ASSIGNMENT
```

## Preserved artifacts

| Artifact | Repository-relative reference | SHA-256 | Bytes |
| --- | --- | --- | ---: |
| Audit report | `docs/rapid-foundations/05-progress-and-health-auditreport.md` | `c8f8e090e39bd6b1a28910aeabdacb8b920ffdfd60c149848fdf31a60b44c722` | 35682 |
| Full handoff | `docs/platform-handoffs/05-progress-and-health-platform-handoff-full.md` | `d2c3c4501f426e6ceb8a5fab7b28322199f8a7a86bc4b189df8c739a60c79372` | 32184 |
| Short handoff | `docs/platform-handoffs/05-progress-and-health-platform-handoff.md` | `8c03bafc5d2a4887eae3c2fb4a8f8e6124586aa3f57d50c840061cc1ef33d19d` | 8445 |

## Recorded repair scope

The preserved report records that meaningful progress must be source-bound to
task and scope identity, exact source commit/tree, and an opaque evidence
record with a digest. Heartbeats alone cannot reset the fifteen-minute progress
window. The scheduler remains the mandatory file-backed route, and the lane
records no functional or scheduler checks as run.

| File | SHA-256 |
| --- | --- |
| `control/rapid-prototype/progress-health.mjs` | `f29b3ca8a3db3b90a6a4da33dd39bc6394160afeed61424817218bdad7c5cdc6` |
| `control/rapid-prototype/index.mjs` | `28395558a62e9a0451d00be2df8e672fd39d2b73c28fac41549a1c8b6d95269a` |
| `control/local-self-development-supervisor-adapter.mjs` | `3a4c14a05938e3e4d5829b758f976ca2373cbd57f3a12445fdd9ded99d2a0db9` |
| `schemas/rapid-prototype-plan.v1.json` | `e073009fb84beeca245654d3b94bcc9748cf0de582953c66b49aa5982da9c3d6` |
| `tests/rapid-prototype/progress-health.mjs` | `90af0dd59aa9250e3537d976cb1e957062c1bbcc14a93fa6a603cd4e822f5bbd` |
| `tests/verify-rapid-prototype.mjs` | `7bd836361f4d72a6077aac88cc9c03230ba4470db6972dffa16bfbb5d123f17a` |

## Controller custody disposition

- The report, full handoff, and short handoff are preserved in the visible
  lane’s isolated custody and have not been replaced by this manifest.
- The accepted merge copy must receive the exact append-only report and handoff
  sections before this lane can be archived or its worktree closed.
- The lane is not a current platform-domain assignment because no
  source-backed cross-feature domain has been proven.
- The authority references embedded in the historical artifacts remain
  historical; any future active assignment must bind the current authority
  digest independently.
- No implementation merge, release decision, task archive, or readiness claim
  follows from this manifest.
