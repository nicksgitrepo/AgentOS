import {canonicalDigest} from "./content-addressing.mjs";

const HEX = "0123456789abcdef";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";
const DIGEST = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

export const REPAIR_FIXTURE_CLASSES = [
  "mode_import_mutation", "mode_audit_successor", "import_missing_preservation", "serial_next_before_merge", "cleanup_before_merge_leftover", "dirty_shared_delete", "stale_worktree_reuse", "merge_failure_cleanup", "missing_rollback", "deploy_publish", "parallel_shared_worktree", "stale_batch_base", "more_than_six_lanes", "stale_pass_governance", "governance_change_stale_pass", "data_schema_unsafe", "untrusted_auditor", "incomplete_final_coverage", "final_ready"
];

export function makeRepairFixtureInput(overrides = {}) {
  const {mode = "FULL_AUDIT_REPAIR", request_kind = "START_CAMPAIGN", ...evidenceOverrides} = overrides;
  const e = {
    project_identity: "CTX.SYNTHETIC",
    candidate_commit: COMMIT,
    candidate_tree: TREE,
    candidate_frozen: true,
    integrated_branch: "campaign/integration",
    protected_branch: "main",
    worktree_id: "WORKTREE.REPAIR.001",
    worktree_base_commit: COMMIT,
    worktree_isolated: true,
    worktree_dirty: false,
    worktree_reused: false,
    fresh_worktree: true,
    next_worktree_base_matches: true,
    mode_transition: "FULL_AUDIT_REPAIR",
    source_preserved: true,
    legacy_untouched: true,
    legacy_mutation_requested: false,
    successor_repo_created: false,
    remote_repoint_requested: false,
    audit_mode_creates_successor: false,
    migration_candidate_accepted: true,
    migration_rehearsed: true,
    migration_compatibility_proven: true,
    migration_rehearsal_current: true,
    tenant_isolation_proven: true,
    rollback_bound: true,
    rollback_identity_bound: true,
    rollback_rehearsed: true,
    global_policy_current: true,
    project_context_current: true,
    dependency_sbom_current: true,
    dependency_graph_current: true,
    environment_current: true,
    source_context_bound: true,
    governance_change_detected: false,
    affected_receipts_invalidated: true,
    accumulated_gates_current: true,
    cumulative_non_regression_current: true,
    auditor_output_validated: true,
    auditor_output_safe: true,
    auditor_passed: true,
    all_batch_terminal: true,
    active_lanes: 1,
    max_lanes: 6,
    max_heavy_jobs: 4,
    shared_worktree: false,
    merge_destination: "campaign/integration",
    merge_verified: true,
    merge_parent_bound: true,
    merge_failed: false,
    cleanup_requested: false,
    cleanup_safe: true,
    storage_hygiene_current: true,
    custody_released: true,
    zero_orphan: true,
    auditor_despawned: true,
    fresh_next_worktree: true,
    deploy_requested: false,
    publish_requested: false,
    promote_requested: false,
    live_data_requested: false,
    destructive_migration_requested: false,
    data_schema_change: false,
    untrusted_command_requested: false,
    attempts: 1,
    finding_recurrence: 0,
    finding_identity: "FINDING.REPAIR.BASELINE",
    finding_severity: "MEDIUM",
    finding_assets_bound: true,
    finding_dedupe_current: true,
    findings_conflict_resolved: true,
    mandatory_findings_open: 0,
    applicable_roster_count: 12,
    terminal_roster_count: 12,
    non_code_surfaces_covered: true,
    checkpoint_current: true,
    resume_identity_current: true,
    disk_free_mb: 100000,
    memory_free_mb: 10000,
    resource_ceiling_current: true,
    independent_final_review: true,
    final_higher_tier_review: true,
    final_review_current: true,
    final_review_independent: true,
    final_review_repairer_separate: true,
    completion_coverage: true,
    host_pressure: false,
    applicability_evidence: true,
    not_applicable_reason: "",
    evidence_digest: DIGEST
  };
  const input = {schema: "agentos.repair_campaign_input.v1", version: 1, request_kind, mode, evidence: {...e, ...evidenceOverrides}};
  input.evidence.evidence_digest = canonicalDigest({...input.evidence, evidence_digest: null});
  return input;
}

export const REPAIR_FIXTURE_HEX = {COMMIT, TREE, DIGEST, HEX};
