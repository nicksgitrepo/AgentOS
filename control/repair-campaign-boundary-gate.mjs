#!/usr/bin/env node

/* Project-agnostic, side-effect-free Repair campaign decision boundary. */
import {canonicalDigest} from "./content-addressing.mjs";
import {scanPersistedRecord} from "./persisted-record-privacy.mjs";

export const REPAIR_INPUT_SCHEMA = "agentos.repair_campaign_input.v1";
export const REPAIR_RESULT_SCHEMA = "agentos.repair_campaign_result.v1";
const SHA = /^(?!([0-9a-f])\1{63})[0-9a-f]{64}$/u;
const GIT = /^[0-9a-f]{40}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{2,120}$/u;
const BRANCH = /^campaign\/[A-Za-z0-9._/-]{1,120}$/u;
const MODES = new Set(["FULL_IMPORT", "FULL_AUDIT_REPAIR", "TARGETED_REPAIR", "LEGACY_MIGRATION", "RELEASE_HARDENING"]);
const REQUESTS = new Set(["START_CAMPAIGN", "AUDITOR_PASS", "GOVERNED_MERGE", "BATCH_INTEGRATE", "FINAL_COHERENCE", "READY_FOR_DEPLOYMENT_REVIEW", "NOT_APPLICABLE", "REPAIR", "DEPLOY", "PUBLISH", "PROMOTE", "REPOINT_REMOTE", "MUTATE_LEGACY"]);
const EVIDENCE_KEYS = new Set([
  "project_identity", "candidate_commit", "candidate_tree", "candidate_frozen", "integrated_branch", "protected_branch", "worktree_id", "worktree_base_commit", "worktree_isolated", "worktree_dirty", "worktree_reused", "fresh_worktree", "next_worktree_base_matches", "mode_transition", "source_preserved", "legacy_untouched", "legacy_mutation_requested", "successor_repo_created", "remote_repoint_requested", "audit_mode_creates_successor", "migration_candidate_accepted", "migration_rehearsed", "migration_compatibility_proven", "migration_rehearsal_current", "tenant_isolation_proven", "rollback_bound", "rollback_identity_bound", "rollback_rehearsed", "global_policy_current", "project_context_current", "dependency_sbom_current", "dependency_graph_current", "environment_current", "source_context_bound", "governance_change_detected", "affected_receipts_invalidated", "accumulated_gates_current", "cumulative_non_regression_current", "auditor_output_validated", "auditor_output_safe", "auditor_passed", "all_batch_terminal", "active_lanes", "max_lanes", "max_heavy_jobs", "shared_worktree", "merge_destination", "merge_verified", "merge_parent_bound", "merge_failed", "cleanup_requested", "cleanup_safe", "storage_hygiene_current", "custody_released", "zero_orphan", "auditor_despawned", "fresh_next_worktree", "deploy_requested", "publish_requested", "promote_requested", "live_data_requested", "destructive_migration_requested", "data_schema_change", "untrusted_command_requested", "attempts", "finding_recurrence", "finding_identity", "finding_severity", "finding_assets_bound", "finding_dedupe_current", "findings_conflict_resolved", "mandatory_findings_open", "applicable_roster_count", "terminal_roster_count", "non_code_surfaces_covered", "checkpoint_current", "resume_identity_current", "disk_free_mb", "memory_free_mb", "resource_ceiling_current", "independent_final_review", "final_higher_tier_review", "final_review_current", "final_review_independent", "final_review_repairer_separate", "completion_coverage", "host_pressure", "applicability_evidence", "not_applicable_reason", "evidence_digest"
]);
const BOOLS = new Set([
  "candidate_frozen", "worktree_isolated", "worktree_dirty", "worktree_reused", "fresh_worktree", "next_worktree_base_matches", "source_preserved", "legacy_untouched", "legacy_mutation_requested", "successor_repo_created", "remote_repoint_requested", "audit_mode_creates_successor", "migration_candidate_accepted", "migration_rehearsed", "migration_compatibility_proven", "rollback_bound", "rollback_rehearsed", "global_policy_current", "project_context_current", "dependency_sbom_current", "environment_current", "accumulated_gates_current", "auditor_output_validated", "auditor_passed", "all_batch_terminal", "shared_worktree", "merge_verified", "merge_failed", "cleanup_requested", "cleanup_safe", "custody_released", "zero_orphan", "auditor_despawned", "fresh_next_worktree", "deploy_requested", "publish_requested", "live_data_requested", "destructive_migration_requested", "untrusted_command_requested", "finding_assets_bound", "findings_conflict_resolved", "non_code_surfaces_covered", "checkpoint_current", "independent_final_review", "final_review_current", "final_review_independent", "final_review_repairer_separate", "completion_coverage", "host_pressure"]
);
const ADDITIONAL_BOOLS = new Set(["migration_rehearsal_current", "tenant_isolation_proven", "rollback_identity_bound", "dependency_graph_current", "source_context_bound", "governance_change_detected", "affected_receipts_invalidated", "cumulative_non_regression_current", "auditor_output_safe", "merge_parent_bound", "storage_hygiene_current", "data_schema_change", "finding_dedupe_current", "resume_identity_current", "resource_ceiling_current", "final_higher_tier_review"]);
const NUMBERS = new Set(["active_lanes", "max_lanes", "max_heavy_jobs", "attempts", "finding_recurrence", "mandatory_findings_open", "applicable_roster_count", "terminal_roster_count", "disk_free_mb", "memory_free_mb"]);
function fail(message, code = "REPAIR_INPUT_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, allowed, name) { assert(value && typeof value === "object" && !Array.isArray(value), name + " must be an object", "REPAIR_SHAPE_INVALID"); for (const key of Object.keys(value)) assert(allowed.has(key), name + " has unknown field " + key, "REPAIR_UNKNOWN_FIELD"); }
function text(value, name, max = 180) { assert(typeof value === "string" && value.length > 0 && value.length <= max, name + " is invalid", "REPAIR_FIELD_INVALID"); }
function digest(value, name) { text(value, name, 64); assert(SHA.test(value), name + " is not a content digest", "REPAIR_DIGEST_INVALID"); }
function git(value, name) { text(value, name, 40); assert(GIT.test(value), name + " is not a git identity", "REPAIR_GIT_ID_INVALID"); }
function bool(value, name) { assert(typeof value === "boolean", name + " must be boolean", "REPAIR_BOOLEAN_INVALID"); }
function num(value, name) { assert(Number.isInteger(value) && value >= 0, name + " must be a nonnegative integer", "REPAIR_NUMBER_INVALID"); }
function validate(input) {
  exact(input, new Set(["schema", "version", "request_kind", "mode", "evidence"]), "Repair input");
  assert(input.schema === REPAIR_INPUT_SCHEMA && input.version === 1, "Repair schema mismatch", "REPAIR_SCHEMA_MISMATCH");
  assert(REQUESTS.has(input.request_kind), "Repair request is unknown", "REPAIR_REQUEST_INVALID");
  assert(MODES.has(input.mode), "Repair mode is unknown", "REPAIR_MODE_INVALID");
  exact(input.evidence, EVIDENCE_KEYS, "Repair evidence");
  const e = input.evidence;
  for (const key of ["project_identity", "integrated_branch", "protected_branch", "worktree_id", "merge_destination", "finding_identity", "finding_severity", "mode_transition"]) text(e[key], "evidence." + key);
  assert(ID.test(e.project_identity) && ID.test(e.worktree_id) && ID.test(e.finding_identity), "Repair identity is not canonical", "REPAIR_ID_INVALID");
  assert(BRANCH.test(e.integrated_branch), "integrated branch must be a campaign branch", "REPAIR_BRANCH_INVALID");
  assert(BRANCH.test(e.merge_destination), "merge destination must be campaign-owned", "REPAIR_MERGE_DESTINATION_INVALID");
  assert(e.protected_branch === "main" || e.protected_branch === "release" || e.protected_branch === "production", "protected branch marker is invalid", "REPAIR_PROTECTED_BRANCH_INVALID");
  git(e.candidate_commit, "evidence.candidate_commit"); git(e.candidate_tree, "evidence.candidate_tree"); git(e.worktree_base_commit, "evidence.worktree_base_commit");
  for (const key of new Set([...BOOLS, ...ADDITIONAL_BOOLS])) bool(e[key], "evidence." + key);
  for (const key of NUMBERS) num(e[key], "evidence." + key);
  for (const key of ["evidence_digest"]) digest(e[key], "evidence." + key);
  assert(e.max_lanes === 6 && e.max_heavy_jobs >= 1 && e.max_heavy_jobs <= 6, "resource ceiling is invalid", "REPAIR_RESOURCE_CEILING_INVALID");
  assert(e.disk_free_mb > 0 && e.memory_free_mb > 0 && e.host_pressure === false && e.resource_ceiling_current, "resource pressure freezes admissions", "REPAIR_RESOURCE_CEILING");
  assert(e.applicable_roster_count >= e.terminal_roster_count, "roster coverage counts are invalid", "REPAIR_ROSTER_COVERAGE_INVALID");
  assert(scanPersistedRecord(input).safe, "Repair input contains private or unsafe data", "REPAIR_PRIVACY_DENIED");
}
function effects() { return Object.freeze({worktree_writes: 0, protected_branch_writes: 0, deploy_calls: 0, publish_calls: 0, remote_repoints: 0, live_data_reads: 0, destructive_migrations: 0, auditor_spawn_calls: 0, auditor_despawn_calls: 0, memory_writes: 0, credential_accesses: 0, state_changes: 0}); }
function result(disposition, route, errorCode, input, extra = {}) { const base = {schema: REPAIR_RESULT_SCHEMA, version: 1, disposition, route, acceptance_allowed: false, deployment_allowed: false, external_side_effects: effects(), error_code: errorCode, input_sha256: canonicalDigest(input), ...extra}; return Object.freeze({...base, result_sha256: canonicalDigest({...base, result_sha256: null})}); }
function deny(code, route, input, extra = {}) { return result("DENY", route, code, input, extra); }
export function evaluateRepairBoundary(input) {
  validate(input); const e = input.evidence;
  if (e.deploy_requested || e.publish_requested || input.request_kind === "DEPLOY" || input.request_kind === "PUBLISH" || input.request_kind === "PROMOTE") return deny("REPAIR_DEPLOYMENT_OUTSIDE_SCOPE", "CONTROLLER_DEPLOYMENT_REVIEW", input);
  if (e.remote_repoint_requested || input.request_kind === "REPOINT_REMOTE") return deny("REPAIR_REMOTE_REPOINT_OUTSIDE_SCOPE", "CONTROLLER_MIGRATION_REVIEW", input);
  if (e.untrusted_command_requested || !e.auditor_output_safe) return deny("REPAIR_UNTRUSTED_AUDITOR_OUTPUT", "SPAWNER_FINDING_VALIDATION", input);
  if (e.active_lanes > e.max_lanes || e.shared_worktree) return deny("REPAIR_PARALLEL_CUSTODY_INVALID", "REPAIR_CUSTODY_REPAIR", input);
  if (e.worktree_dirty || e.worktree_reused) return deny("REPAIR_WORKTREE_NOT_FRESH", "REPAIR_FRESH_WORKTREE_REQUIRED", input);
  if (e.next_worktree_base_matches === false) return deny("REPAIR_STALE_BATCH_BASE", "REPAIR_STALE_BATCH_BASE", input);
  if (e.merge_destination !== e.integrated_branch || !e.merge_parent_bound || !e.rollback_identity_bound) return deny("REPAIR_MERGE_DESTINATION_INVALID", "REPAIR_CAMPAIGN_BRANCH_REQUIRED", input);
  if (e.attempts > 3 || e.finding_recurrence > 3) return result("BLOCKED_EXACT", "HIGHER_TIER_REVIEW", "REPAIR_BOUNDED_RETRY_EXHAUSTED", input, {blocked_finding: e.finding_identity});
  if (e.governance_change_detected && !e.affected_receipts_invalidated) return deny("REPAIR_STALE_PASS_AFTER_GOVERNANCE_CHANGE", "REPAIR_INVALIDATE_AND_REAUDIT", input);
  if (!e.global_policy_current || !e.project_context_current || !e.dependency_sbom_current || !e.dependency_graph_current || !e.environment_current || !e.source_context_bound || !e.accumulated_gates_current || !e.cumulative_non_regression_current) return deny("REPAIR_CONTEXT_INVALIDATED", "REPAIR_RECOMPILE_AND_REAUDIT", input);
  if (!e.checkpoint_current || !e.resume_identity_current) return deny("REPAIR_CHECKPOINT_REQUIRED", "REPAIR_RESUME_FROM_CHECKPOINT", input);
  if (e.mode_transition !== input.mode) return deny("REPAIR_MODE_TRANSITION_INVALID", "REPAIR_MODE_REBIND_REQUIRED", input);
  if (input.mode === "FULL_IMPORT" && (!e.source_preserved || !e.legacy_untouched || e.legacy_mutation_requested)) return deny("REPAIR_IMPORT_PRESERVATION_REQUIRED", "REPAIR_IMPORT_PRESERVATION", input);
  if (input.mode === "FULL_AUDIT_REPAIR" && (e.successor_repo_created || e.audit_mode_creates_successor)) return deny("REPAIR_AUDIT_MODE_REPOSITORY_CREATION_FORBIDDEN", "REPAIR_MODE_REBIND_REQUIRED", input);
  if (input.mode === "LEGACY_MIGRATION" && (!e.migration_candidate_accepted || !e.migration_rehearsed || !e.migration_compatibility_proven)) return deny("REPAIR_MIGRATION_PROOF_REQUIRED", "REPAIR_MIGRATION_REHEARSAL", input);
  if (e.live_data_requested || e.destructive_migration_requested) return deny("REPAIR_LIVE_OR_DESTRUCTIVE_DATA_FORBIDDEN", "CONTROLLER_DATA_MIGRATION_REVIEW", input);
  if (e.data_schema_change && (!e.migration_rehearsal_current || !e.migration_compatibility_proven || !e.tenant_isolation_proven || !e.rollback_rehearsed)) return deny("REPAIR_DATA_SCHEMA_SAFETY_REQUIRED", "REPAIR_MIGRATION_REHEARSAL", input);
  if (!e.candidate_frozen || !e.rollback_bound) return deny("REPAIR_CANDIDATE_OR_ROLLBACK_UNBOUND", "REPAIR_FREEZE_AND_ROLLBACK", input);
  if (input.request_kind === "FINAL_COHERENCE" && (e.terminal_roster_count !== e.applicable_roster_count || e.mandatory_findings_open !== 0 || !e.completion_coverage || !e.non_code_surfaces_covered || !e.rollback_rehearsed || !e.final_higher_tier_review)) return deny("REPAIR_COMPLETION_COVERAGE_INCOMPLETE", "REPAIR_REMAINING_ROSTER", input);
  if (!e.auditor_output_validated || !e.finding_assets_bound || !e.finding_dedupe_current || !e.findings_conflict_resolved) return deny("REPAIR_FINDING_VALIDATION_REQUIRED", "SPAWNER_FINDING_VALIDATION", input);
  if (input.request_kind === "NOT_APPLICABLE") return e.applicability_evidence && e.not_applicable_reason ? result("NOT_APPLICABLE", "ROSTER_NEXT", "REPAIR_NOT_APPLICABLE_WITH_EVIDENCE", input) : deny("REPAIR_APPLICABILITY_EVIDENCE_REQUIRED", "REPAIR_APPLICABILITY_REVIEW", input);
  if (input.request_kind === "START_CAMPAIGN") return result("ROUTE", "PASS_1_SERIAL", "REPAIR_SERIAL_PASS_STARTED", input, {state: "PASS_1_SERIAL"});
  if (input.request_kind === "AUDITOR_PASS") {
    if (!e.auditor_passed) return deny("REPAIR_AUDITOR_PASS_REQUIRED", "REPAIR_AUDIT_REPAIR", input);
    return result("PASS", "GOVERNED_MERGE", "REPAIR_AUDITOR_PASS", input, {state: "AUDITOR_PASS"});
  }
  if (input.request_kind === "GOVERNED_MERGE") {
    if (!e.auditor_passed || e.merge_failed || e.merge_destination === e.protected_branch || !e.cumulative_non_regression_current) return deny("REPAIR_MERGE_NOT_PROVEN", "REPAIR_MERGE_REPAIR", input);
    return e.merge_verified ? result("PASS", "CUSTODY_RELEASE", "REPAIR_MERGE_VERIFIED", input, {state: "BATCH_MERGE_VERIFIED"}) : deny("REPAIR_MERGE_VERIFICATION_REQUIRED", "REPAIR_MERGE_VERIFY", input);
  }
  if (input.request_kind === "BATCH_INTEGRATE") {
    if (!e.all_batch_terminal || !e.findings_conflict_resolved) return deny("REPAIR_BATCH_NOT_TERMINAL", "REPAIR_BATCH_REAUDIT", input);
    return result("PASS", "GOVERNED_MERGE", "REPAIR_BATCH_INTEGRATION_READY", input, {state: "BATCH_INTEGRATION"});
  }
  if (input.request_kind === "FINAL_COHERENCE") {
    if (e.terminal_roster_count !== e.applicable_roster_count || e.mandatory_findings_open !== 0 || !e.completion_coverage || !e.non_code_surfaces_covered || !e.rollback_rehearsed || !e.final_higher_tier_review) return deny("REPAIR_COMPLETION_COVERAGE_INCOMPLETE", "REPAIR_REMAINING_ROSTER", input);
    return result("PASS", "INDEPENDENT_FINAL_REVIEW", "REPAIR_FINAL_COHERENCE_READY", input, {state: "FINAL_COHERENCE"});
  }
  if (input.request_kind === "READY_FOR_DEPLOYMENT_REVIEW") {
    if (e.terminal_roster_count !== e.applicable_roster_count || e.mandatory_findings_open !== 0 || !e.final_review_current || !e.final_review_independent || !e.final_higher_tier_review || !e.final_review_repairer_separate || !e.merge_verified || !e.custody_released || !e.cleanup_safe || !e.storage_hygiene_current || !e.zero_orphan || !e.auditor_despawned || !e.fresh_next_worktree || !e.checkpoint_current || !e.resume_identity_current) return deny("REPAIR_FINAL_REVIEW_OR_CLEANUP_REQUIRED", "REPAIR_NOT_READY", input);
    return result("ROUTE", "CONTROLLER_DEPLOYMENT_REVIEW", "REPAIR_READY_FOR_DEPLOYMENT_REVIEW", input, {state: "READY_FOR_DEPLOYMENT_REVIEW", deployment_plan_required: true});
  }
  if (e.cleanup_requested && (!e.merge_verified || !e.custody_released || !e.cleanup_safe || !e.zero_orphan)) return deny("REPAIR_CLEANUP_BEFORE_MERGE_FORBIDDEN", "REPAIR_CLEANUP_REPAIR", input);
  if (e.next_worktree_base_matches === false || (e.fresh_next_worktree && !e.auditor_despawned)) return deny("REPAIR_NEXT_WORKTREE_SEQUENCE_INVALID", "REPAIR_AUDITOR_LIFECYCLE_REPAIR", input);
  return result("ROUTE", "REPAIR_NEXT_ACTION", "REPAIR_TYPED_ACTION_REQUIRED", input, {state: "PASS_1_SERIAL"});
}
