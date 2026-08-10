# ROADMAP_03_CONTROLLER_INTENT — source-bound feature handoff

handoff_schema: agentos.feature_source_bound_handoff.v1
feature_id: ROADMAP_03_CONTROLLER_INTENT
handoff_status: PRODUCTION_CANDIDATE_PENDING_FUNCTIONAL_AND_INDEPENDENT_CLEARANCE
activation_status: PREPARED_NOT_ACTIVATED
functional_tests: PENDING_BY_INSTRUCTION
independent_clearance: NOT_CLAIMED

source_authority:
  cumulative_branch: codex/feature-integration-wave-02
  cumulative_head_commit: f0336c53ac5ffa63917891f481d56c4e5d6cce8f
  cumulative_head_tree: 7a3526b2d0d1718a69b2524a86bbfd5ba591687d
  code_candidate_commit: b9c1dcd524dabd8b3d7248e38693e9ce9cd915e1
  code_candidate_tree: b31f00136f614d0b99676612550a17cd9dec4ce1
  source_rule: Downstream must inspect the exact cumulative/code-candidate identities before any acceptance or integration.

audit:
  report: docs/feature-audits/ROADMAP_03_CONTROLLER_INTENT/auditreport.md
  report_sha256: 8dbf0bdb903eef1190328eeaa49a53f5f95a8ebee54942698bb6c9f81421545e
  history: APPEND_ONLY_PRIOR_AND_WAVE_02_PASSES_PRESERVED
  current_finding: F03-04
  repaired_wave_finding: F03-01-W02

changed_paths:
  - control/controller-supervisor.mjs
  - control/controller-supervisor-runtime.mjs
  - control/continuous-operating-loop.mjs
  - control/content-addressing.mjs
  - control/persisted-record-privacy.mjs
  - schemas/controller-supervisor.v1.json
  - schemas/continuous-operating-loop.v1.json
  - tests/verify-controller-supervisor.mjs
  - tests/verify-controller-intent-hardening.mjs
  - tests/verify-continuous-operating-loop.mjs
  - tests/verify-controller-supervisor-liveness.mjs
  - docs/feature-audits/ROADMAP_03_CONTROLLER_INTENT/auditreport.md
  - docs/feature-handoffs/ROADMAP_03_CONTROLLER_INTENT-2026-08-09.md

evidence:
  static_checks:
    javascript_syntax: PASS
    changed_json_parse: PASS
    diff_whitespace: PASS
    functional_execution: NOT_RUN
    npm: NOT_USED
  source_properties:
    goal_identity: OBSERVATION_DERIVED_AND_OVERRIDE_REJECTED
    true_blocker_route: INTENT_REGULATOR_REVIEW_REQUIRED
    source_intent_reassessment: STALE_REPAIR_AND_REPLACEMENT_REJECTED
    host_failure_persistence: OPAQUE_DIGEST_ONLY
    host_receipt_binding: OPERATION_SESSION_SOURCE_PROGRESS_AND_TYPED_HANDOFF_BOUND
    durable_records: CAS_SYMLINK_REJECTION_AND_DIRECTORY_FSYNC

remaining_boundary:
  finding: F03-04
  recovery: Obtain a clean candidate tree, run the focused Controller/liveness/continuous-loop/hardening verifiers and approved parent suite without npm, then obtain independent record review and append the results.
  shared_custody_seam: Bootstrap/global-policy/binding-manifest owners must refresh OPERATIONS.HEARTBEAT_INTERVAL_MINUTES and related source bindings; this feature lane did not cross-edit those files.
  prohibited_until_clearance: ACTIVATION_RELEASE_MERGE_PUSH_DEPLOYMENT_PUBLICATION_CREDENTIAL_OR_DESTRUCTIVE_ACTION

next_action:
  owner: DOWNSTREAM_INDEPENDENT_CHECKER
  action: RUN_CLEAN_SOURCE_FUNCTIONAL_AND_INDEPENDENT_CLEARANCE_PASS
  keep_release_candidate: PREPARED_NOT_ACTIVATED

central_integration:
  intake_date: 2026-08-10
  central_candidate_branch: codex/feature-integration-wave-03
  source_baseline_head: f0336c53ac5ffa63917891f481d56c4e5d6cce8f
  source_baseline_tree: 7a3526b2d0d1718a69b2524a86bbfd5ba591687d
  disposition: SOURCE_BOUND_CONTROLLER_REPAIR_AND_SOURCE_HYGIENE_INTEGRATED_PENDING_STATIC_REVIEW
  local_candidate_commit: 770f4ddff9afc73ec8795954bb6abaaeeff32873
  local_candidate_tree: 6c59dfbdbb1bb21102c6f6ace0f030d7477ffc23
  candidate_state: LOCAL_INTEGRATION_COMMITTED_PENDING_FUNCTIONAL_TESTS
  push_state: NOT_PUSHED
  additional_bound_paths:
    - control/private-context-detector.mjs
    - schemas/private-context-detector.v1.json
    - tests/verify-private-context-detector.mjs
    - docs/private-context-detector.md
  functional_status: NOT_RUN_BY_INSTRUCTION
  activation_status: PREPARED_NOT_ACTIVATED
  archive_status: WITHHELD_UNTIL_DOWNSTREAM_REVIEW
