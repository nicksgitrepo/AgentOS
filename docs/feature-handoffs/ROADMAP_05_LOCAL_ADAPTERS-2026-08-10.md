# ROADMAP_05_LOCAL_ADAPTERS — source-bound feature handoff

handoff_schema: `agentos.feature_source_bound_handoff.v1`
handoff_state: `FEATURE_CANDIDATE_READY_FOR_PLATFORM_REVIEW`
feature_id: `ROADMAP_05_LOCAL_ADAPTERS`
isolated_worktree_ref: `HOST_WORKTREE_D986`
platform_return_owner: `PLATFORM_NATIVE_SESSION_EVIDENCE`

source_authority:

- feature_baseline_commit: `d885e73382df26da596848d70dbb402d6a9cf8b8`
- feature_baseline_tree: `5f6ed007168ba660ca6f224e632b1dedd02202a5`
- cumulative_control_record_tip: `f41760badea80271071959f3cbe970f4bac548ba`
- cumulative_control_record_tree: `6ab6e9b6ddb764037e94de82e23c6f9d5c9da4e7`
- source_rule: downstream must inspect the exact repair commit and tree before
  independent clearance or any integration decision.

repair:

- repair_commit: `10d7316ab2dda259e6574ebea8745060ee9c0c3d`
- repair_tree: `548f587033d049a7afe3615ee5c7a78f9ed81af0`
- finding_repaired: `F-09`
- repair_summary: `REJECT_UNBOUND_FOREIGN_CONTROL_REPOSITORY`
- changed_paths:
  - `control/private-control-storage.mjs`
  - `tests/verify-local-adapters.mjs`
  - `docs/feature-audits/ROADMAP_05_LOCAL_ADAPTERS/auditreport.md`
  - `docs/feature-handoffs/ROADMAP_05_LOCAL_ADAPTERS-2026-08-10.md`

evidence:

- audit_report: `docs/feature-audits/ROADMAP_05_LOCAL_ADAPTERS/auditreport.md`
- audit_report_sha256: `fc26d218931d463ee4a28a6b7e4efb3ddbe2a057303566733a2822038b3d8b35`
- javascript_syntax: `PASS`
- changed_json_parse: `PASS`
- diff_whitespace: `PASS`
- hostile_fixture_source: `PRESENT_NOT_RUN`
- functional_tests: `PENDING_BY_INSTRUCTION`
- npm: `NOT_USED`
- independent_clearance: `NOT_CLAIMED`

boundary:

- production_status: `PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_AND_INDEPENDENT_CLEARANCE`
- true_blocker: `NONE`
- provider_certification: `DEFERRED_BY_ROADMAP_AND_SEPARATE_OWNER_AUTHORITY`
- external_effects: `NO_NETWORK_NO_AUTHENTICATION_NO_SPENDING_NO_EXTERNAL_WRITE`
- release_activation: `PREPARED_NOT_ACTIVATED`
- archive_status: `WITHHELD_UNTIL_DOWNSTREAM_REVIEW`

next_action:

- owner: `PLATFORM_NATIVE_SESSION_EVIDENCE`
- action: `INSPECT_REPAIR_COMMIT_AND_RUN_INDEPENDENT_CLEARANCE_WITH_AUTHORIZED_FUNCTIONAL_PASS`
- recovery_if_unavailable: `RETAIN_TYPED_UNAVAILABLE_WITH_MISSING_CAPABILITY_AND_DO_NOT_CONVERT_TO_PASS`
- prohibited_until_clearance: `SELF_ACCEPTANCE_MERGE_PUSH_RELEASE_ACTIVATION_ARCHIVE`

This handoff is source-bound custody and downstream review input. It is not
functional acceptance, independent clearance, release, activation, merge, or
push evidence.

## REBIND_PENDING receipt — 2026-08-10

receipt_schema: `agentos.feature_rebind_pending.v1`
version: `1`
status: `REBIND_PENDING`
feature_id: `ROADMAP_05_LOCAL_ADAPTERS`
task_id: `019fdcf9-9d12-7b93-835a-10aebdba1b94`
worktree_id: `HOST_WORKTREE_D986`
frozen_feature_commit: `691046fa75495732709a21cef2e5e37813065f3c`
frozen_feature_tree: `e643be4776c979d637001ed0d7308043cb2069e0`
current_central_commit: `f1bbedbf1f6778c8a0498155da4fd4e85eaea0c2`
current_central_tree: `66189ca0edf077decf834992b13843c014f2eb56`
source_baseline_commit: `d885e73382df26da596848d70dbb402d6a9cf8b8`
source_baseline_tree: `5f6ed007168ba660ca6f224e632b1dedd02202a5`
changed_path_custody:

- owner_scope: `HOST_WORKTREE_D986_ONLY`
- changed_paths:
  - `control/private-control-storage.mjs`
  - `docs/feature-audits/ROADMAP_05_LOCAL_ADAPTERS/auditreport.md`
  - `docs/feature-handoffs/ROADMAP_05_LOCAL_ADAPTERS-2026-08-10.md`
  - `tests/verify-local-adapters.mjs`
- central_paths_touched: `[]`
- code_merge: `NOT_PERFORMED`

functional_tests: `NOT_RUN_BY_INSTRUCTION`
npm: `NOT_USED`
host_provider_actions: `NOT_USED`
activation_release: `NOT_ACTIVATED_OR_RELEASED`
exact_next_action: `PLATFORM_NATIVE_SESSION_EVIDENCE_CONSUME_REBIND_PENDING_RECEIPT_AND_RUN_AUTHORIZED_INDEPENDENT_CLEARANCE`
receipt_sha256: `aa6dad25215190e7c46fe5dc3eee0eb02acf780e263f0485dd830d32fddeb20a`
