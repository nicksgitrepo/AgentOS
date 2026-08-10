#!/usr/bin/env node

/*
 * Canonical rapid-prototyping controller.
 *
 * This is deliberately a small state machine.  Agents audit and propose
 * changes; the Controller owns stage transitions, source binding, worktree
 * custody, integration order, and closeout.  The platform foundation ->
 * platform integration -> feature -> central pyramid is the active workflow
 * for both new and imported projects.
 * Project setup is a short pre-pyramid step so a new project has an explicit
 * stack, repository plan, directory plan, and source boundary before work.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {validateFeatureInventory, validateVisibleTaskParity} from "./canonical-feature-inventory.mjs";
import {compileFeatureLaneGoal, validateFeatureLaneGoal} from "./feature-lane-goal.mjs";
import {assertUniversalDevelopmentMode} from "./governance-library.mjs";
import {validatePlatformFoundationMergeReceipt} from "./platform-foundation-merge.mjs";

export const AUDIT_DRIVEN_INTEGRATION_PYRAMID_SCHEMA = "agentos.audit_driven_integration_pyramid.v1";
export const AUDIT_DRIVEN_INTEGRATION_PYRAMID_VERSION = 1;
export const AUDIT_DRIVEN_MIGRATION_SCHEMA = "agentos.audit_driven_migration.v1";
export const AUDIT_DRIVEN_MIGRATION_VERSION = 1;
export const RAPID_PROTOTYPE_WORKFLOW_SCHEMA = AUDIT_DRIVEN_INTEGRATION_PYRAMID_SCHEMA;
export const RAPID_PROTOTYPE_WORKFLOW_VERSION = AUDIT_DRIVEN_INTEGRATION_PYRAMID_VERSION;
export const RAPID_PROTOTYPE_PROJECT_MODES = Object.freeze(["NEW_PROJECT", "IMPORTED_PROJECT"]);
export const RAPID_PROTOTYPE_PHASES = Object.freeze([
  "PROJECT_INITIALIZATION",
  "PLATFORM_FOUNDATION",
  "PLATFORM_INTEGRATION",
  "FEATURE_AUDIT_REPAIR",
  "CENTRAL_INTEGRATION",
]);
export const RAPID_PROTOTYPE_STAGES = Object.freeze([
  "IMPORT_APPROVAL_REQUIRED",
  "PROJECT_INITIALIZATION",
  "PLATFORM_WAVE",
  "FEATURE_WAVE",
  "PLATFORM_INTEGRATION",
  "CENTRAL_INTEGRATION",
  "FINAL_SECURITY_PRIVACY",
  "CONTROLLER_REPAIR_LOOP",
  "PRODUCTION_CANDIDATE_PENDING_TESTS",
  "EXTERNAL_BLOCKED",
]);
const STAGE_PHASES = Object.freeze({
  IMPORT_APPROVAL_REQUIRED: "PROJECT_INITIALIZATION",
  PROJECT_INITIALIZATION: "PROJECT_INITIALIZATION",
  PLATFORM_WAVE: "PLATFORM_FOUNDATION",
  PLATFORM_INTEGRATION: "PLATFORM_INTEGRATION",
  FEATURE_WAVE: "FEATURE_AUDIT_REPAIR",
  CENTRAL_INTEGRATION: "CENTRAL_INTEGRATION",
  FINAL_SECURITY_PRIVACY: "CENTRAL_INTEGRATION",
  CONTROLLER_REPAIR_LOOP: "CENTRAL_INTEGRATION",
  PRODUCTION_CANDIDATE_PENDING_TESTS: "CENTRAL_INTEGRATION",
});
export const RAPID_PROTOTYPE_EVENTS = Object.freeze([
  "OWNER_APPROVED_RAPID_DEVELOPMENT",
  "PLATFORM_MERGE_COMPLETE",
  "PROJECT_INITIALIZED",
  "PLATFORM_WAVE_STARTED",
  "FEATURE_WAVE_STARTED",
  "FEATURE_CANDIDATE_READY",
  "GOVERNANCE_CANDIDATE_READY",
  "FEATURE_BATCH_CLOSED",
  "PLATFORM_DOMAIN_CANDIDATE_READY",
  "PLATFORM_BATCH_CLOSED",
  "CENTRAL_CANDIDATE_UPDATED",
  "FINAL_SECURITY_PRIVACY_ACCEPTED",
  "CONTROLLER_REPAIR_PASS",
  "QUESTION_DISCOVERED",
  "TASK_HANDOFF_PRESERVED",
  "TASK_WORKTREE_INTEGRATED",
  "TASK_ARCHIVED",
  "EXTERNAL_BLOCKER_RETAINED",
]);

export const PYRAMID_LIFECYCLE = Object.freeze([
  "CREATED",
  "AUDITING",
  "REPAIRING",
  "RE_AUDITING",
  "READY_FOR_HANDOFF",
  "CONSUMED",
  "FINISHED",
  "ARCHIVED",
  "CONTEXT_NEEDED",
  "BLOCKED",
]);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const REPORT_PATH = /(?:^|\/)auditreport\.md$/u;

const WORKFLOW_KEYS = [
  "schema", "version", "status", "campaign_id", "project_id", "project_mode",
  "rapid_development_approved", "rapid_development_approval", "platform_merge_gate", "setup", "baseline", "inventory_sha256",
  "visible_task_parity_sha256", "visible_task_readback_sha256", "phase", "stage", "feature_wave_size",
  "feature_roster", "governance_roster", "platform_roster", "question_queue", "consumption_matrix",
  "atomic_seam_batches", "controller_policy", "migrated_worktrees",
  "transition_history", "workflow_sha256",
];
const SETUP_KEYS = [
  "schema", "version", "project_id", "project_mode", "status", "owner_approval_required",
  "rapid_development_approved", "rapid_development_approval", "stack", "repositories", "directories", "source_binding",
  "setup_sha256",
];

const TYPED_APPROVAL_SHA256 = /^[0-9a-f]{64}$/u;
const TYPED_APPROVAL_GIT_OBJECT = /^[0-9a-f]{40}$/u;
const TYPED_IMPORTED_APPROVAL_KEYS = [
  "schema", "version", "status", "decision", "scope", "project_id", "import_mode",
  "source_commit", "source_tree", "source_content_sha256", "source_observation_sha256",
  "owner_actor_digest_sha256", "approved_at_utc", "activation", "approval_sha256",
];
const PLATFORM_MERGE_GATE_KEYS = [
  "schema", "version", "status", "project_id", "worktree_id", "source_commit", "source_tree",
  "inventory_sha256", "platform_foundation_merge_receipt", "receipt_sha256", "gate_sha256",
];

export function validateTypedImportedApproval(approval, {projectId, sourceBinding = null} = {}) {
  assert(approval !== null && typeof approval === "object" && !Array.isArray(approval), "imported rapid development approval is missing", "OWNER_APPROVAL_REQUIRED");
  exactKeys(approval, TYPED_IMPORTED_APPROVAL_KEYS, "imported rapid development approval");
  assert(approval.schema === "agentos.imported_rapid_development_owner_approval.v1", "imported rapid development approval schema is invalid", "IMPORTED_OWNER_APPROVAL_INVALID");
  assert(approval.version === 1 && approval.status === "APPROVED" && approval.decision === "APPROVE_RAPID_DEVELOPMENT", "imported rapid development approval is invalid", "IMPORTED_OWNER_APPROVAL_INVALID");
  assert(approval.scope === "IMPORTED_RAPID_DEVELOPMENT_PLATFORM_FOUNDATION" && approval.activation === false, "imported rapid development approval scope is invalid", "IMPORTED_OWNER_APPROVAL_INVALID");
  assert(typeof approval.project_id === "string" && /^[A-Za-z][A-Za-z0-9._:-]*$/u.test(approval.project_id) && approval.project_id === projectId, "imported rapid development approval project binding is stale", "IMPORTED_OWNER_APPROVAL_PROJECT_MISMATCH");
  assert(typeof approval.import_mode === "string" && approval.import_mode.length > 0, "imported rapid development approval mode is invalid", "IMPORTED_OWNER_APPROVAL_INVALID");
  for (const [field, pattern] of [["source_commit", TYPED_APPROVAL_GIT_OBJECT], ["source_tree", TYPED_APPROVAL_GIT_OBJECT], ["source_content_sha256", TYPED_APPROVAL_SHA256], ["source_observation_sha256", TYPED_APPROVAL_SHA256], ["owner_actor_digest_sha256", TYPED_APPROVAL_SHA256], ["approval_sha256", TYPED_APPROVAL_SHA256]]) {
    assert(typeof approval[field] === "string" && pattern.test(approval[field]), `imported rapid development approval ${field} is invalid`, "IMPORTED_OWNER_APPROVAL_INVALID");
  }
  assert(typeof approval.approved_at_utc === "string" && /Z$/u.test(approval.approved_at_utc), "imported rapid development approval timestamp is invalid", "IMPORTED_OWNER_APPROVAL_INVALID");
  assert(approval.approval_sha256 === canonicalDigest({...approval, approval_sha256: null}), "imported rapid development approval digest is invalid", "IMPORTED_OWNER_APPROVAL_INVALID");
  assert(sourceBinding !== null && typeof sourceBinding === "object", "imported rapid development approval source binding is missing", "IMPORTED_OWNER_APPROVAL_INVALID");
  const boundCommit = sourceBinding.commit ?? sourceBinding.source_commit;
  const boundTree = sourceBinding.tree ?? sourceBinding.source_tree;
  const boundContent = sourceBinding.source_content_sha256;
  const boundObservation = sourceBinding.source_observation_sha256;
  for (const [field, value, pattern] of [
    ["source_commit", boundCommit, TYPED_APPROVAL_GIT_OBJECT],
    ["source_tree", boundTree, TYPED_APPROVAL_GIT_OBJECT],
    ["source_content_sha256", boundContent, TYPED_APPROVAL_SHA256],
    ["source_observation_sha256", boundObservation, TYPED_APPROVAL_SHA256],
  ]) {
    assert(typeof value === "string" && pattern.test(value), `imported rapid development approval ${field} source binding is invalid`, "IMPORTED_OWNER_APPROVAL_INVALID");
    assert(approval[field] === value, `imported rapid development approval ${field} binding is stale`, "IMPORTED_OWNER_APPROVAL_SOURCE_MISMATCH");
  }
  return approval;
}

export function validatePlatformMergeGate(gate, {projectId, sourceBinding = null, inventorySha256 = null} = {}) {
  assert(gate !== null && typeof gate === "object" && !Array.isArray(gate), "platform merge gate is missing", "PLATFORM_ADMISSION_REQUIRED");
  exactKeys(gate, PLATFORM_MERGE_GATE_KEYS, "platform merge gate");
  assert(gate.schema === "agentos.platform_merge_gate.v1" && gate.version === 1 && gate.status === "PLATFORM_MERGE_COMPLETE", "platform merge gate is invalid", "PLATFORM_MERGE_INVALID");
  assert(gate.project_id === projectId, "platform merge gate project binding is stale", "PLATFORM_MERGE_STALE");
  assert(typeof gate.worktree_id === "string" && gate.worktree_id.length > 0, "platform merge gate worktree is invalid", "PLATFORM_MERGE_INVALID");
  assert(TYPED_APPROVAL_GIT_OBJECT.test(gate.source_commit) && TYPED_APPROVAL_GIT_OBJECT.test(gate.source_tree), "platform merge gate source is invalid", "PLATFORM_MERGE_INVALID");
  assert(TYPED_APPROVAL_SHA256.test(gate.inventory_sha256), "platform merge gate inventory is invalid", "PLATFORM_MERGE_INVALID");
  validatePlatformFoundationMergeReceipt(gate.platform_foundation_merge_receipt);
  assert(gate.platform_foundation_merge_receipt.feature_admission === "READY", "platform merge gate has not released feature admission", "PLATFORM_ADMISSION_REQUIRED");
  assert(gate.platform_foundation_merge_receipt.source.commit === gate.source_commit && gate.platform_foundation_merge_receipt.source.tree === gate.source_tree, "platform merge gate source binding is stale", "PLATFORM_MERGE_STALE");
  assert(gate.platform_foundation_merge_receipt.inventory_sha256 === gate.inventory_sha256, "platform merge gate inventory binding is stale", "PLATFORM_MERGE_STALE");
  assert(gate.receipt_sha256 === gate.platform_foundation_merge_receipt.merge_sha256, "platform merge gate receipt digest is invalid", "PLATFORM_MERGE_INVALID");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "platform merge gate digest is invalid", "PLATFORM_MERGE_INVALID");
  if (sourceBinding !== null && typeof sourceBinding === "object") {
    const boundCommit = sourceBinding.commit ?? sourceBinding.source_commit;
    const boundTree = sourceBinding.tree ?? sourceBinding.source_tree;
    if (typeof boundCommit === "string") assert(gate.source_commit === boundCommit, "platform merge gate commit binding is stale", "PLATFORM_MERGE_STALE");
    if (typeof boundTree === "string") assert(gate.source_tree === boundTree, "platform merge gate tree binding is stale", "PLATFORM_MERGE_STALE");
  }
  if (inventorySha256 !== null) assert(gate.inventory_sha256 === inventorySha256, "platform merge gate inventory binding is stale", "PLATFORM_MERGE_STALE");
  return gate;
}

export function compilePlatformMergeGate({projectId, worktreeId, sourceCommit, sourceTree, inventorySha256, platformFoundationMergeReceipt} = {}) {
  const gate = {
    schema: "agentos.platform_merge_gate.v1",
    version: 1,
    status: "PLATFORM_MERGE_COMPLETE",
    project_id: projectId,
    worktree_id: worktreeId,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    inventory_sha256: inventorySha256,
    platform_foundation_merge_receipt: platformFoundationMergeReceipt,
    receipt_sha256: platformFoundationMergeReceipt?.merge_sha256 ?? null,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest(gate);
  return validatePlatformMergeGate(gate, {projectId, sourceBinding: {source_commit: sourceCommit, source_tree: sourceTree}, inventorySha256});
}

function deriveApplicablePlatformLanes(inventory) {
  assert(Array.isArray(inventory?.platform_domains), "source-bound platform applicability graph is required", "PLATFORM_APPLICABILITY_REQUIRED");
  assert(Array.isArray(inventory?.platform_lanes), "source-bound platform lane inventory is required", "PLATFORM_APPLICABILITY_REQUIRED");
  const activeDomainIds = new Set(inventory.platform_domains.filter((domain) => domain.applicability === "ACTIVE").map((domain) => {
    assert(domain !== null && typeof domain === "object" && typeof domain.domain_id === "string" && Array.isArray(domain.required_capabilities) && Array.isArray(domain.feature_ids) && Array.isArray(domain.source_refs), "platform applicability domain is invalid", "PLATFORM_APPLICABILITY_INVALID");
    return domain.domain_id;
  }));
  return inventory.platform_lanes.filter((entry) => entry.domain_ids.some((domainId) => activeDomainIds.has(domainId)));
}
const AGENT_KEYS = [
  "agent_id", "target_id", "target_name", "target_kind", "status", "auditor_task_id",
  "worktree_id", "goal_id", "goal_sha256", "goal_state", "report_path", "source_refs",
  "handoff_sha256", "readiness",
];
const POLICY_KEYS = [
  "platform_foundation_before_feature", "platform_distills_features", "central_is_sole_merge_authority",
  "source_bound_worktrees", "one_writer_per_worktree", "append_only_reports", "archive_after_consumption",
  "preserve_handoff_before_archive", "controller_owns_questions", "no_hidden_tasks",
];
const MIGRATION_KEYS = [
  "schema", "version", "status", "source_workflow", "target_workflow",
  "baseline_source_commit", "migration_scope", "preservation_policy",
  "observed_parity", "feature_adoptions", "preserved_non_lane_worktrees",
  "unresolved_platform_targets", "next_action", "no_private_paths_or_secrets",
  "exact_visible_task_registry_required", "archive_rule",
];
const MIGRATION_POLICY_KEYS = [
  "physical_move_performed", "delete_or_reset_performed", "dirty_worktrees_preserved",
  "existing_reports_preserved", "existing_handoff_history_preserved",
  "private_paths_or_secrets_persisted", "reason",
];
const MIGRATION_PARITY_KEYS = [
  "feature_inventory_count", "feature_visible_task_count", "feature_worktree_count",
  "feature_report_count", "feature_goal_count", "platform_inventory_count",
  "platform_visible_task_count", "platform_worktree_count", "platform_report_count",
  "platform_goal_count", "runtime_registry", "parity_status", "visible_status_snapshot",
];
const MIGRATION_ADOPTION_KEYS = [
  "target_id", "visible_task_present", "visible_task_registry_binding",
  "worktree_id", "location_ref", "report_ref", "source_commit",
  "dirty_entry_count", "preserved", "downstream_consumed", "lifecycle",
];
const MIGRATION_PRESERVED_KEYS = [
  "worktree_id", "location_ref", "source_commit", "dirty_entry_count",
  "preserved", "downstream_consumed",
];

function assert(condition, message, code = "AUDIT_DRIVEN_PYRAMID_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains a control character`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a portable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be an exact Git object identity`);
}

function requireRelativePath(value, label) {
  requireString(value, label);
  assert(SAFE_RELATIVE_PATH.test(value), `${label} must be a safe relative path`);
}

function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

function sortedUnique(values, label) {
  const sorted = [...values].sort(compareUtf8);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted`);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
}

function opaqueReference(value, label = "reference") {
  requireString(value, label);
  return `ref:${canonicalDigest({label, value})}`;
}

function normalizeStack(stack = {}) {
  assert(isRecord(stack), "project stack must be an object");
  const fields = ["language", "client", "backend", "database", "authentication", "storage", "package_manager", "observability"];
  const normalized = Object.fromEntries(fields.map((field) => {
    const value = stack[field] ?? "OWNER_OR_SOURCE_DECISION_REQUIRED";
    requireString(value, `project stack ${field}`);
    return [field, value];
  }));
  return normalized;
}

function normalizeRepositoryPlan(repositories = []) {
  assert(Array.isArray(repositories), "project repository plan must be an array");
  const normalized = repositories.map((repository, index) => {
    assert(isRecord(repository), `repository plan entry ${index} must be an object`);
    const repositoryId = repository.repository_id ?? `REPOSITORY_${String(index + 1).padStart(3, "0")}`;
    const name = repository.name ?? repositoryId;
    const purpose = repository.purpose ?? "PROJECT_REPOSITORY";
    const relativePath = repository.relative_path ?? repository.path ?? repositoryId.toLowerCase();
    requireIdentifier(repositoryId, `repository plan entry ${index} ID`);
    requireString(name, `repository plan entry ${index} name`);
    requireString(purpose, `repository plan entry ${index} purpose`);
    requireRelativePath(relativePath, `repository plan entry ${index} relative path`);
    return {repository_id: repositoryId, name, purpose, relative_path: relativePath};
  }).sort((left, right) => compareUtf8(left.repository_id, right.repository_id));
  sortedUnique(normalized.map((entry) => entry.repository_id), "repository plan IDs");
  return normalized;
}

function normalizeDirectoryPlan(directories = []) {
  assert(Array.isArray(directories), "project directory plan must be an array");
  const normalized = directories.map((directory, index) => {
    assert(isRecord(directory), `directory plan entry ${index} must be an object`);
    const directoryId = directory.directory_id ?? `DIRECTORY_${String(index + 1).padStart(3, "0")}`;
    const relativePath = directory.relative_path ?? directory.path;
    requireIdentifier(directoryId, `directory plan entry ${index} ID`);
    requireRelativePath(relativePath, `directory plan entry ${index} relative path`);
    const purpose = directory.purpose ?? "PROJECT_DIRECTORY";
    requireString(purpose, `directory plan entry ${index} purpose`);
    return {directory_id: directoryId, relative_path: relativePath, purpose};
  }).sort((left, right) => compareUtf8(left.directory_id, right.directory_id));
  sortedUnique(normalized.map((entry) => entry.directory_id), "directory plan IDs");
  return normalized;
}

function normalizeSourceBinding(sourceBinding, projectMode) {
  if (projectMode === "NEW_PROJECT") {
    return {
      status: "NOT_CREATED",
      source_commit: null,
      source_tree: null,
      source_binding_sha256: canonicalDigest({status: "NOT_CREATED"}),
    };
  }
  const source = sourceBinding ?? {};
  const sourceCommit = source.source_commit ?? source.head ?? null;
  const sourceTree = source.source_tree ?? source.tree ?? null;
  const sourceContentSha256 = source.source_content_sha256 ?? null;
  const sourceObservationSha256 = source.source_observation_sha256 ?? null;
  const status = [sourceCommit, sourceTree, sourceContentSha256, sourceObservationSha256].every((value) => value !== null)
    ? "DISCOVERY_BOUND"
    : "SOURCE_READBACK_REQUIRED";
  if (sourceCommit !== null) requireGitObject(sourceCommit, "import source commit");
  if (sourceTree !== null) requireGitObject(sourceTree, "import source tree");
  if (sourceContentSha256 !== null) requireSha(sourceContentSha256, "import source content");
  if (sourceObservationSha256 !== null) requireSha(sourceObservationSha256, "import source observation");
  const body = {status, source_commit: sourceCommit, source_tree: sourceTree, source_content_sha256: sourceContentSha256, source_observation_sha256: sourceObservationSha256};
  return {...body, source_binding_sha256: canonicalDigest(body)};
}

export function compileProjectInitializationPlan({
  projectId,
  projectMode = "NEW_PROJECT",
  rapidDevelopmentApproved = false,
  rapidDevelopmentApproval = null,
  technicalBaseline = null,
  repositories = [],
  directories = [],
  sourceBinding = null,
} = {}) {
  requireIdentifier(projectId, "project setup project ID");
  assert(RAPID_PROTOTYPE_PROJECT_MODES.includes(projectMode), "project setup mode is invalid");
  const stack = normalizeStack(technicalBaseline?.stack ?? technicalBaseline ?? {});
  const repositoryPlan = normalizeRepositoryPlan(repositories.length > 0 ? repositories : [{repository_id: "PROJECT", name: "Project", purpose: "PRIMARY_PROJECT_REPOSITORY", relative_path: "project"}]);
  const directoryPlan = normalizeDirectoryPlan(directories.length > 0 ? directories : [
    {directory_id: "SOURCE", relative_path: "src", purpose: "PROJECT_SOURCE"},
    {directory_id: "DOCUMENTATION", relative_path: "docs", purpose: "PROJECT_DOCUMENTATION"},
    {directory_id: "CONFIGURATION", relative_path: "config", purpose: "PROJECT_CONFIGURATION"},
  ]);
  const approved = Boolean(rapidDevelopmentApproved);
  const ownerApprovalRequired = projectMode === "IMPORTED_PROJECT";
  const normalizedSourceBinding = normalizeSourceBinding(sourceBinding, projectMode);
  if (!approved) assert(rapidDevelopmentApproval === null, "rapid development approval cannot be present when approval is false", "IMPORTED_OWNER_APPROVAL_INVALID");
  const typedApproval = rapidDevelopmentApproval === null
    ? null
    : validateTypedImportedApproval(rapidDevelopmentApproval, {projectId, sourceBinding: normalizedSourceBinding});
  if (ownerApprovalRequired && approved) assert(typedApproval !== null, "imported rapid development requires a typed owner approval receipt", "OWNER_APPROVAL_REQUIRED");
  if (!ownerApprovalRequired) assert(typedApproval === null, "typed imported approval is invalid for a new project", "IMPORTED_OWNER_APPROVAL_INVALID");
  const status = ownerApprovalRequired && !approved
    ? "OWNER_APPROVAL_REQUIRED"
    : projectMode === "IMPORTED_PROJECT" && normalizedSourceBinding.status !== "DISCOVERY_BOUND"
      ? "SOURCE_READBACK_REQUIRED"
      : "READY";
  const plan = {
    schema: "agentos.project_setup_plan.v1",
    version: 1,
    project_id: projectId,
    project_mode: projectMode,
    status,
    owner_approval_required: ownerApprovalRequired,
    rapid_development_approved: approved,
    rapid_development_approval: typedApproval,
    stack,
    repositories: repositoryPlan,
    directories: directoryPlan,
    source_binding: normalizedSourceBinding,
    setup_sha256: null,
  };
  plan.setup_sha256 = digestWithout(plan, "setup_sha256");
  return validateProjectInitializationPlan(plan);
}

export function validateProjectInitializationPlan(plan) {
  assert(plan.rapid_development_approved || plan.rapid_development_approval === null, "rapid development approval cannot be present when approval is false", "IMPORTED_OWNER_APPROVAL_INVALID");
  assert(plan.rapid_development_approval === null || (typeof plan.rapid_development_approval === "object" && !Array.isArray(plan.rapid_development_approval)), "project setup approval receipt is invalid", "IMPORTED_OWNER_APPROVAL_INVALID");
  if (plan.project_mode === "IMPORTED_PROJECT" && plan.rapid_development_approved) validateTypedImportedApproval(plan.rapid_development_approval, {projectId: plan.project_id, sourceBinding: plan.source_binding});
  if (plan.project_mode !== "IMPORTED_PROJECT") assert(plan.rapid_development_approval === null, "project setup approval receipt is invalid for a new project", "IMPORTED_OWNER_APPROVAL_INVALID");
  exactKeys(plan, SETUP_KEYS, "project setup plan");
  assert(plan.schema === "agentos.project_setup_plan.v1" && plan.version === 1, "project setup plan identity is invalid");
  requireIdentifier(plan.project_id, "project setup project ID");
  assert(RAPID_PROTOTYPE_PROJECT_MODES.includes(plan.project_mode), "project setup project mode is invalid");
  assert(["OWNER_APPROVAL_REQUIRED", "SOURCE_READBACK_REQUIRED", "READY", "INITIALIZED"].includes(plan.status), "project setup status is invalid");
  assert(typeof plan.owner_approval_required === "boolean" && typeof plan.rapid_development_approved === "boolean", "project setup approval fields are invalid");
  if (plan.project_mode === "IMPORTED_PROJECT" && plan.status !== "OWNER_APPROVAL_REQUIRED") assert(plan.rapid_development_approved === true, "imported rapid development requires explicit owner approval", "OWNER_APPROVAL_REQUIRED");
  plan.stack = normalizeStack(plan.stack);
  plan.repositories = normalizeRepositoryPlan(plan.repositories);
  plan.directories = normalizeDirectoryPlan(plan.directories);
  assert(isRecord(plan.source_binding), "project setup source binding is required");
  assert(["NOT_CREATED", "DISCOVERY_BOUND", "SOURCE_READBACK_REQUIRED"].includes(plan.source_binding.status), "project setup source binding status is invalid");
  if (plan.source_binding.source_commit !== null) requireGitObject(plan.source_binding.source_commit, "project setup source commit");
  if (plan.source_binding.source_tree !== null) requireGitObject(plan.source_binding.source_tree, "project setup source tree");
  requireSha(plan.source_binding.source_binding_sha256, "project setup source binding digest");
  assert(plan.source_binding.source_binding_sha256 === digestWithout(plan.source_binding, "source_binding_sha256"), "project setup source binding digest mismatch");
  requireSha(plan.setup_sha256, "project setup digest");
  assert(plan.setup_sha256 === digestWithout(plan, "setup_sha256"), "project setup digest mismatch");
  return plan;
}

function normalizeAgent({entry, visible, kind}) {
  const targetId = entry.feature_id ?? entry.lane_id;
  const targetKind = entry.feature_id ? entry.kind : (kind === "PLATFORM" ? "PLATFORM_DOMAIN" : "GOVERNANCE_LANE");
  const taskId = visible.runtime_task_id;
  const worktreeId = visible.runtime_worktree_id;
  const reportPath = entry.report_path;
  const goal = compileFeatureLaneGoal({
    targetId,
    targetName: entry.name,
    targetKind,
    auditorTaskId: taskId,
    worktreeId,
    reportPath,
    sourceRefs: entry.sources ?? entry.source_refs ?? ["docs/rapid-foundations/"],
  });
  const agent = {
    agent_id: `${kind}_${targetId}`,
    target_id: targetId,
    target_name: entry.name,
    target_kind: targetKind,
    status: "CREATED",
    auditor_task_id: taskId,
    worktree_id: worktreeId,
    goal_id: goal.goal_id,
    goal_sha256: goal.goal_sha256,
    goal_state: goal.state,
    report_path: reportPath,
    source_refs: goal.source_refs,
    handoff_sha256: null,
    readiness: "NOT_STARTED",
  };
  exactKeys(agent, AGENT_KEYS, `${kind} agent`);
  return agent;
}

function validateAgent(agent, label) {
  exactKeys(agent, AGENT_KEYS, label);
  requireIdentifier(agent.agent_id, `${label} ID`);
  requireIdentifier(agent.target_id, `${label} target`);
  requireString(agent.target_name, `${label} name`);
  requireIdentifier(agent.target_kind, `${label} kind`);
  assert(PYRAMID_LIFECYCLE.includes(agent.status), `${label} lifecycle is invalid`);
  requireIdentifier(agent.auditor_task_id, `${label} task`);
  requireIdentifier(agent.worktree_id, `${label} worktree`);
  requireIdentifier(agent.goal_id, `${label} goal`);
  requireSha(agent.goal_sha256, `${label} goal digest`);
  assert(agent.goal_state === "ACTIVE" || ["FINISHED", "CONTEXT_NEEDED", "BLOCKED"].includes(agent.goal_state), `${label} goal state is invalid`);
  requireRelativePath(agent.report_path, `${label} report path`);
  assert(REPORT_PATH.test(agent.report_path), `${label} report path is not an audit report`);
  assert(Array.isArray(agent.source_refs) && agent.source_refs.length > 0, `${label} source references are required`);
  agent.source_refs.forEach((ref, index) => requireRelativePath(ref, `${label} source reference ${index}`));
  sortedUnique(agent.source_refs, `${label} source references`);
  if (agent.handoff_sha256 !== null) requireSha(agent.handoff_sha256, `${label} handoff`);
  assert(["NOT_STARTED", "IN_PROGRESS", "READY_FOR_HANDOFF", "CONSUMED", "PRODUCTION_CANDIDATE_PENDING_TESTS", "CONTEXT_NEEDED", "BLOCKED"].includes(agent.readiness), `${label} readiness is invalid`);
  const goal = {
    schema: "agentos.feature_lane_goal.v1",
    version: 1,
    goal_id: agent.goal_id,
    target_id: agent.target_id,
    target_name: agent.target_name,
    target_kind: agent.target_kind,
    auditor_task_id: agent.auditor_task_id,
    worktree_id: agent.worktree_id,
    report_path: agent.report_path,
    source_refs: agent.source_refs,
    objective: "AUDIT_REPAIR_REAUDIT_UNTIL_PRODUCTION_CANDIDATE_OR_EXTERNAL_BLOCKER",
    persistence: "CONTROLLER_CONTROL_PLANE",
    state: agent.goal_state,
    goal_sha256: agent.goal_sha256,
  };
  validateFeatureLaneGoal(goal, {label: `${label} goal`});
  return agent;
}

function validateRosters(workflow) {
  for (const [roster, label, required] of [
    [workflow.feature_roster, "feature", true],
    [workflow.governance_roster, "governance", true],
    [workflow.platform_roster, "platform", false],
  ]) {
    assert(Array.isArray(roster) && (required ? roster.length > 0 : true), `${label} roster is empty`);
    const ids = roster.map((agent) => agent.agent_id);
    sortedUnique(ids, `${label} roster IDs`);
    roster.forEach((agent, index) => validateAgent(agent, `${label} agent ${index}`));
  }
}

function validateRosterInventoryAlignment(workflow, inventory) {
  const expected = [
    [workflow.feature_roster, inventory.features, "feature"],
    [workflow.governance_roster, inventory.governance_lanes, "governance"],
    [workflow.platform_roster, inventory.platform_lanes, "platform"],
  ];
  for (const [roster, entries, label] of expected) {
    const actualIds = roster.map((agent) => agent.target_id).sort(compareUtf8);
    const expectedIds = entries.map((entry) => entry.feature_id ?? entry.lane_id).sort(compareUtf8);
    assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `${label} roster does not match the bound inventory`, "INVENTORY_ROSTER_MISMATCH");
  }
}

function validateBaseline(baseline) {
  assert(isRecord(baseline), "campaign baseline is required");
  assert(["BOUND", "NOT_CREATED", "UNKNOWN"].includes(baseline.status), "campaign baseline status is invalid");
  if (baseline.source_commit !== null) requireGitObject(baseline.source_commit, "campaign baseline commit");
  if (baseline.source_tree !== null) requireGitObject(baseline.source_tree, "campaign baseline tree");
  requireSha(baseline.baseline_sha256, "campaign baseline digest");
  assert(baseline.baseline_sha256 === digestWithout(baseline, "baseline_sha256"), "campaign baseline digest mismatch");
}

function validatePolicy(policy) {
  exactKeys(policy, POLICY_KEYS, "pyramid Controller policy");
  for (const key of POLICY_KEYS) assert(policy[key] === true, `pyramid Controller policy ${key} must remain enabled`);
}

function validateQuestionQueue(queue) {
  assert(isRecord(queue), "pyramid question queue is required");
  assert(queue.storage === "EXTERNAL_CONTROL_AUTHORITY", "pyramid questions must remain outside Product source");
  assert(queue.path === "questions.txt", "pyramid question queue path is invalid");
  assert(Array.isArray(queue.question_ids), "pyramid question IDs must be an array");
  queue.question_ids.forEach((id, index) => requireIdentifier(id, `pyramid question ${index}`));
  sortedUnique(queue.question_ids, "pyramid question IDs");
}

function validateWorkflow(workflow) {
  exactKeys(workflow, WORKFLOW_KEYS, "audit-driven integration pyramid");
  assert(workflow.schema === AUDIT_DRIVEN_INTEGRATION_PYRAMID_SCHEMA && workflow.version === 1, "pyramid workflow identity is invalid");
  assert(workflow.status === "PREPARED_NOT_ACTIVATED", "pyramid workflow cannot activate protected actions");
  requireIdentifier(workflow.campaign_id, "pyramid campaign ID");
  requireIdentifier(workflow.project_id, "pyramid project ID");
  assert(RAPID_PROTOTYPE_PROJECT_MODES.includes(workflow.project_mode), "pyramid project mode is invalid");
  assert(typeof workflow.rapid_development_approved === "boolean", "pyramid approval is invalid");
  validateProjectInitializationPlan(workflow.setup);
  validateBaseline(workflow.baseline);
  requireSha(workflow.inventory_sha256, "pyramid inventory digest");
  requireSha(workflow.visible_task_parity_sha256, "pyramid visible parity digest");
  requireSha(workflow.visible_task_readback_sha256, "pyramid visible task readback digest");
  assert(RAPID_PROTOTYPE_PHASES.includes(workflow.phase), "pyramid phase is invalid");
  assert(RAPID_PROTOTYPE_STAGES.includes(workflow.stage), "pyramid stage is invalid");
  const expectedPhase = STAGE_PHASES[workflow.stage];
  if (expectedPhase !== undefined) assert(workflow.phase === expectedPhase, "pyramid phase and stage are inconsistent", "RAPID_PROTOTYPE_PHASE_MISMATCH");
  if (workflow.project_mode === "IMPORTED_PROJECT" && workflow.stage !== "IMPORT_APPROVAL_REQUIRED") assert(workflow.rapid_development_approved === true, "imported project is not approved for rapid development", "OWNER_APPROVAL_REQUIRED");
  if (["PLATFORM_WAVE", "PLATFORM_INTEGRATION", "FEATURE_WAVE", "CENTRAL_INTEGRATION", "FINAL_SECURITY_PRIVACY", "CONTROLLER_REPAIR_LOOP", "PRODUCTION_CANDIDATE_PENDING_TESTS"].includes(workflow.stage)) assert(workflow.setup.status === "INITIALIZED", "pyramid work cannot start before project setup is initialized", "PROJECT_SETUP_REQUIRED");
  if (["FEATURE_WAVE", "CENTRAL_INTEGRATION", "FINAL_SECURITY_PRIVACY", "CONTROLLER_REPAIR_LOOP", "PRODUCTION_CANDIDATE_PENDING_TESTS"].includes(workflow.stage)) {
    validatePlatformMergeGate(workflow.platform_merge_gate, {projectId: workflow.project_id, sourceBinding: workflow.setup?.source_binding, inventorySha256: workflow.inventory_sha256});
  }
  validateRosters(workflow);
  validateQuestionQueue(workflow.question_queue);
  assert(Number.isSafeInteger(workflow.feature_wave_size) && workflow.feature_wave_size >= 1, "pyramid feature wave size is invalid");
  assert(isRecord(workflow.consumption_matrix), "pyramid consumption matrix is required");
  assert(Array.isArray(workflow.atomic_seam_batches), "pyramid atomic seam batches must be an array");
  validatePolicy(workflow.controller_policy);
  assert(Array.isArray(workflow.migrated_worktrees), "pyramid migrated worktrees must be an array");
  for (const record of workflow.migrated_worktrees) {
    assert(isRecord(record), "pyramid migrated worktree record must be an object");
    requireIdentifier(record.target_id, "pyramid migrated worktree target");
    requireIdentifier(record.worktree_id, "pyramid migrated worktree ID");
    requireSha(record.location_ref_sha256, "pyramid migrated worktree location reference");
    requireGitObject(record.source_commit, "pyramid migrated worktree source commit");
    assert(Number.isSafeInteger(record.dirty_entry_count) && record.dirty_entry_count >= 0, "pyramid migrated worktree dirty count is invalid");
    assert(record.preserved === true && record.downstream_consumed === false, "pyramid migrated worktree custody is invalid");
  }
  assert(Array.isArray(workflow.transition_history), "pyramid transition history must be an array");
  for (const [index, entry] of workflow.transition_history.entries()) {
    assert(isRecord(entry) && RAPID_PROTOTYPE_EVENTS.includes(entry.event), `pyramid transition ${index} is invalid`);
    requireSha(entry.event_sha256, `pyramid transition ${index} digest`);
    assert(entry.event_sha256 === canonicalDigest({event: entry.event, payload: entry.payload ?? null}), `pyramid transition ${index} digest mismatch`);
  }
  requireSha(workflow.workflow_sha256, "pyramid workflow digest");
  assert(workflow.workflow_sha256 === digestWithout(workflow, "workflow_sha256"), "pyramid workflow digest mismatch");
  return workflow;
}

function eventRecord(event, payload) {
  const body = {event, payload: payload ?? null};
  return {...body, event_sha256: canonicalDigest(body)};
}

function defaultBaseline(setup) {
  const body = setup.source_binding.status === "DISCOVERY_BOUND"
    ? {status: "BOUND", source_commit: setup.source_binding.source_commit, source_tree: setup.source_binding.source_tree}
    : {status: setup.project_mode === "NEW_PROJECT" ? "NOT_CREATED" : "UNKNOWN", source_commit: null, source_tree: null};
  return {...body, baseline_sha256: canonicalDigest(body)};
}

export function compileAuditDrivenIntegrationPyramid({
  campaignId,
  projectId,
  projectMode = "NEW_PROJECT",
  rapidDevelopmentApproved = false,
  rapidDevelopmentApproval = null,
  inventory,
  visibleTaskRegistry,
  visibleTaskReadback,
  projectSetup = {},
  featureWaveSize = 6,
  migratedWorktrees = [],
} = {}) {
  requireIdentifier(campaignId, "pyramid campaign ID");
  requireIdentifier(projectId, "pyramid project ID");
  assert(Number.isSafeInteger(featureWaveSize) && featureWaveSize >= 1, "pyramid feature wave size must be positive");
  validateFeatureInventory(inventory);
  const visibleTasks = validateVisibleTaskParity(inventory, visibleTaskRegistry, {
    visibleTaskReadback,
    projectId,
    campaignId,
  });
  const visibleByTarget = new Map(visibleTasks.map((record) => [record.target_id, record]));
  const visibleByBinding = new Map(visibleTasks.map((record) => [
    `${record.auditor_task_id}|${record.worktree_id}`,
    record,
  ]));
  const setup = compileProjectInitializationPlan({
    projectId,
    projectMode,
    rapidDevelopmentApproved,
    rapidDevelopmentApproval,
    technicalBaseline: projectSetup.technicalBaseline ?? projectSetup.technical_baseline,
    repositories: projectSetup.repositories ?? [],
    directories: projectSetup.directories ?? [],
    sourceBinding: projectSetup.sourceBinding ?? projectSetup.source_binding,
  });
  const featureRoster = inventory.features.map((entry) => normalizeAgent({entry, visible: visibleByTarget.get(entry.feature_id), kind: "FEATURE"}));
  const governanceRoster = inventory.governance_lanes.map((entry) => normalizeAgent({entry, visible: visibleByTarget.get(entry.lane_id), kind: "GOVERNANCE"}));
  const applicablePlatformLanes = deriveApplicablePlatformLanes(inventory);
  const platformRoster = applicablePlatformLanes.map((entry) => {
    const visible = visibleByBinding.get(`${entry.auditor_task_id}|${entry.worktree_id}`);
    assert(visible !== undefined, `platform lane ${entry.lane_id} is not bound to an existing feature task`, "PLATFORM_APPLICABILITY_INVALID");
    return normalizeAgent({entry, visible, kind: "PLATFORM"});
  });
  const matrix = Object.fromEntries(featureRoster.map((feature) => [feature.target_id, Object.fromEntries(platformRoster.map((platform) => [platform.target_id, "PENDING"]))]));
  const workflow = {
    schema: AUDIT_DRIVEN_INTEGRATION_PYRAMID_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    campaign_id: campaignId,
    project_id: projectId,
    project_mode: projectMode,
    rapid_development_approved: Boolean(rapidDevelopmentApproved),
    rapid_development_approval: setup.rapid_development_approval,
    setup,
    baseline: defaultBaseline(setup),
    inventory_sha256: canonicalDigest(inventory),
    visible_task_parity_sha256: canonicalDigest(visibleTasks),
    visible_task_readback_sha256: visibleTaskReadback.readback_sha256,
    phase: "PROJECT_INITIALIZATION",
    stage: projectMode === "IMPORTED_PROJECT" && !rapidDevelopmentApproved ? "IMPORT_APPROVAL_REQUIRED" : "PROJECT_INITIALIZATION",
    feature_wave_size: featureWaveSize,
    feature_roster: featureRoster,
    governance_roster: governanceRoster,
    platform_roster: platformRoster,
    platform_merge_gate: null,
    question_queue: {path: "questions.txt", storage: "EXTERNAL_CONTROL_AUTHORITY", question_ids: []},
    consumption_matrix: matrix,
    atomic_seam_batches: [],
    controller_policy: {
      platform_foundation_before_feature: true,
      platform_distills_features: true,
      central_is_sole_merge_authority: true,
      source_bound_worktrees: true,
      one_writer_per_worktree: true,
      append_only_reports: true,
      archive_after_consumption: true,
      preserve_handoff_before_archive: true,
      controller_owns_questions: true,
      no_hidden_tasks: true,
    },
    migrated_worktrees: structuredClone(migratedWorktrees),
    transition_history: [],
    workflow_sha256: null,
  };
  workflow.workflow_sha256 = digestWithout(workflow, "workflow_sha256");
  return validateAuditDrivenIntegrationPyramid(workflow);
}

export function validateAuditDrivenIntegrationPyramid(workflow) {
  assert(workflow.rapid_development_approved || workflow.rapid_development_approval === null, "rapid development approval cannot be present when approval is false", "IMPORTED_OWNER_APPROVAL_INVALID");
  assert(workflow.rapid_development_approval === null || (typeof workflow.rapid_development_approval === "object" && !Array.isArray(workflow.rapid_development_approval)), "workflow imported approval receipt is invalid", "IMPORTED_OWNER_APPROVAL_INVALID");
  if (workflow.project_mode === "IMPORTED_PROJECT" && workflow.rapid_development_approved) {
    validateTypedImportedApproval(workflow.rapid_development_approval, {projectId: workflow.project_id, sourceBinding: workflow.setup?.source_binding});
    assert(workflow.setup?.rapid_development_approval?.approval_sha256 === workflow.rapid_development_approval.approval_sha256, "workflow approval copies differ", "IMPORTED_OWNER_APPROVAL_STALE");
  }
  assertUniversalDevelopmentMode("RAPID_PROTOTYPE");
  return validateWorkflow(workflow);
}

export function validateRapidPrototypeWorkflow(workflow) {
  return validateAuditDrivenIntegrationPyramid(workflow);
}

export function compileRapidPrototypeWorkflowFromInventory(options = {}) {
  const {workflowId, campaignId, ...rest} = options;
  return compileAuditDrivenIntegrationPyramid({campaignId: campaignId ?? workflowId, ...rest});
}

export function validateRapidPrototypeWorkflowInventoryBinding(workflow, {inventory, visibleTaskRegistry, visibleTaskReadback} = {}) {
  validateAuditDrivenIntegrationPyramid(workflow);
  validateFeatureInventory(inventory);
  const visibleTasks = validateVisibleTaskParity(inventory, visibleTaskRegistry, {
    visibleTaskReadback,
    projectId: workflow.project_id,
    campaignId: workflow.campaign_id,
  });
  validateRosterInventoryAlignment(workflow, inventory);
  assert(workflow.inventory_sha256 === canonicalDigest(inventory), "pyramid inventory binding mismatch", "INVENTORY_BINDING_MISMATCH");
  assert(workflow.visible_task_parity_sha256 === canonicalDigest(visibleTasks), "pyramid visible task binding mismatch", "VISIBLE_TASK_PARITY_BINDING_MISMATCH");
  assert(workflow.visible_task_readback_sha256 === visibleTaskReadback.readback_sha256, "pyramid visible task readback binding mismatch", "VISIBLE_TASK_READBACK_BINDING_MISMATCH");
  return workflow;
}

export function validateAuditDrivenMigrationRecord(record, {inventory = null} = {}) {
  exactKeys(record, MIGRATION_KEYS, "audit-driven migration record");
  assert(record.schema === AUDIT_DRIVEN_MIGRATION_SCHEMA && record.version === AUDIT_DRIVEN_MIGRATION_VERSION, "audit-driven migration record identity is invalid");
  assert(["MIGRATED_WITH_PLATFORM_PARITY_HOLD", "MIGRATION_INTAKE_READY", "MIGRATION_RECONCILIATION_REQUIRED"].includes(record.status), "audit-driven migration status is invalid");
  assert(record.source_workflow === "FEATURE_AUDIT_THEN_PLATFORM_INTEGRATION_THEN_CENTRAL_INTEGRATION", "migration source workflow is invalid");
  assert(record.target_workflow === "AUDIT_DRIVEN_INTEGRATION_PYRAMID", "migration target workflow is invalid");
  requireGitObject(record.baseline_source_commit, "migration baseline commit");
  requireIdentifier(record.migration_scope, "migration scope");
  exactKeys(record.preservation_policy, MIGRATION_POLICY_KEYS, "migration preservation policy");
  for (const key of MIGRATION_POLICY_KEYS.slice(0, 6)) {
    const expected = key === "physical_move_performed" || key === "delete_or_reset_performed" || key === "private_paths_or_secrets_persisted" ? false : true;
    assert(record.preservation_policy[key] === expected, "migration preservation policy " + key + " is unsafe");
  }
  requireString(record.preservation_policy.reason, "migration preservation reason");
  exactKeys(record.observed_parity, MIGRATION_PARITY_KEYS, "migration observed parity");
  for (const key of [
    "feature_inventory_count", "feature_visible_task_count", "feature_worktree_count",
    "feature_report_count", "platform_inventory_count", "platform_visible_task_count",
    "platform_worktree_count", "platform_report_count",
  ]) assert(Number.isSafeInteger(record.observed_parity[key]) && record.observed_parity[key] >= 0, "migration parity " + key + " is invalid");
  for (const key of ["feature_goal_count", "platform_goal_count", "runtime_registry", "parity_status", "visible_status_snapshot"]) requireString(record.observed_parity[key], "migration parity " + key);
  assert(Array.isArray(record.feature_adoptions), "migration feature adoptions must be an array");
  const expectedFeatures = inventory === null ? null : validateFeatureInventory(inventory).features;
  const expectedFeatureIds = expectedFeatures?.map((entry) => entry.feature_id) ?? record.feature_adoptions.map((entry) => entry.target_id);
  const adoptionIds = [];
  for (const [index, entry] of record.feature_adoptions.entries()) {
    exactKeys(entry, MIGRATION_ADOPTION_KEYS, "migration feature adoption " + index);
    requireIdentifier(entry.target_id, "migration feature adoption " + index + " target");
    requireIdentifier(entry.worktree_id, "migration feature adoption " + index + " worktree");
    requireIdentifier(entry.location_ref, "migration feature adoption " + index + " location reference");
    requireRelativePath(entry.report_ref, "migration feature adoption " + index + " report");
    requireGitObject(entry.source_commit, "migration feature adoption " + index + " source commit");
    assert(typeof entry.visible_task_present === "boolean" && entry.visible_task_present, "migration feature adoption " + index + " lacks visible task evidence");
    requireString(entry.visible_task_registry_binding, "migration feature adoption " + index + " registry binding");
    assert(Number.isSafeInteger(entry.dirty_entry_count) && entry.dirty_entry_count >= 0, "migration feature adoption " + index + " dirty count is invalid");
    assert(entry.preserved === true && entry.downstream_consumed === false && entry.lifecycle === "MIGRATED_PENDING_INTAKE", "migration feature adoption " + index + " custody is invalid");
    assert(!/(?:^|\/)(?:Users|home|private|tmp)(?:\/|$)/iu.test(entry.location_ref), "migration feature adoption " + index + " contains a private location");
    adoptionIds.push(entry.target_id);
    if (expectedFeatures !== null) {
      const feature = expectedFeatures.find((candidate) => candidate.feature_id === entry.target_id);
      assert(feature !== undefined, "migration feature adoption " + index + " targets an unknown inventory feature");
      assert(entry.report_ref === feature.report_path, "migration feature adoption " + index + " report differs from inventory");
    }
  }
  adoptionIds.sort(compareUtf8);
  sortedUnique(adoptionIds, "migration feature adoption targets");
  assert(JSON.stringify(adoptionIds) === JSON.stringify([...expectedFeatureIds].sort(compareUtf8)), "migration feature adoption parity is incomplete");
  assert(Array.isArray(record.preserved_non_lane_worktrees), "migration preserved worktrees must be an array");
  for (const [index, entry] of record.preserved_non_lane_worktrees.entries()) {
    exactKeys(entry, MIGRATION_PRESERVED_KEYS, "migration preserved worktree " + index);
    requireIdentifier(entry.worktree_id, "migration preserved worktree " + index + " ID");
    requireIdentifier(entry.location_ref, "migration preserved worktree " + index + " location reference");
    requireGitObject(entry.source_commit, "migration preserved worktree " + index + " source commit");
    assert(Number.isSafeInteger(entry.dirty_entry_count) && entry.dirty_entry_count >= 0, "migration preserved worktree " + index + " dirty count is invalid");
    assert(entry.preserved === true && entry.downstream_consumed === false, "migration preserved worktree " + index + " custody is invalid");
  }
  assert(Array.isArray(record.unresolved_platform_targets), "migration unresolved platform targets must be an array");
  const platformIds = inventory === null ? record.unresolved_platform_targets : validateFeatureInventory(inventory).platform_lanes.map((entry) => entry.lane_id);
  const unresolved = [...record.unresolved_platform_targets].sort(compareUtf8);
  sortedUnique(unresolved, "migration unresolved platform targets");
  assert(JSON.stringify(unresolved) === JSON.stringify([...platformIds].sort(compareUtf8)), "migration platform parity does not cover the exact platform inventory");
  requireIdentifier(record.next_action, "migration next action");
  assert(record.no_private_paths_or_secrets === true && record.exact_visible_task_registry_required === true, "migration privacy or registry boundary is weakened");
  requireString(record.archive_rule, "migration archive rule");
  return record;
}

function findAgent(workflow, agentId) {
  const agents = [...workflow.feature_roster, ...workflow.governance_roster, ...workflow.platform_roster].filter((agent) => agent.agent_id === agentId);
  assert(agents.length === 1, `pyramid agent ${agentId} must occur exactly once`);
  return agents[0];
}

function updateAgent(workflow, agentId, patch) {
  for (const rosterName of ["feature_roster", "governance_roster", "platform_roster"]) {
    workflow[rosterName] = workflow[rosterName].map((agent) => agent.agent_id === agentId ? {...agent, ...patch} : agent).sort((left, right) => compareUtf8(left.agent_id, right.agent_id));
  }
}

function requireHandoff(payload, agent, expectedProjectId, label) {
  assert(isRecord(payload), `${label} handoff is required`);
  requireIdentifier(payload.agent_id, `${label} agent`);
  assert(payload.agent_id === agent.agent_id, `${label} handoff agent mismatch`);
  requireSha(payload.handoff_sha256, `${label} handoff digest`);
  requireIdentifier(payload.worktree_id, `${label} worktree`);
  assert(payload.worktree_id === agent.worktree_id, `${label} worktree mismatch`);
  requireIdentifier(payload.project_id, `${label} project`);
  assert(payload.project_id === expectedProjectId, `${label} project binding mismatch`);
  assert(payload.source_bound === true, `${label} is not source-bound`);
  assert(payload.production_candidate_pending_tests === true, `${label} is not a production-candidate handoff`);
}

function requireControllerCandidate(payload, workflow, label) {
  assert(isRecord(payload), `${label} candidate is required`);
  requireIdentifier(payload.worktree_id, `${label} worktree`);
  requireIdentifier(payload.project_id, `${label} project`);
  assert(payload.project_id === workflow.project_id, `${label} project binding mismatch`);
  requireSha(payload.candidate_sha256, `${label} candidate digest`);
  assert(payload.audited === true && payload.source_bound === true, `${label} must be audited and source-bound`);
}

function allReady(roster) {
  return roster.every((agent) => ["READY_FOR_HANDOFF", "CONSUMED", "FINISHED", "ARCHIVED"].includes(agent.status));
}

function advanceWorkflow(workflow, {event, payload = null} = {}) {
  validateAuditDrivenIntegrationPyramid(workflow);
  assert(RAPID_PROTOTYPE_EVENTS.includes(event), `unknown pyramid event ${event}`);
  const next = structuredClone(workflow);
  if (event === "OWNER_APPROVED_RAPID_DEVELOPMENT") {
  assert(next.project_mode === "IMPORTED_PROJECT" && next.stage === "IMPORT_APPROVAL_REQUIRED", "import approval is not currently required");
  const approval = payload?.approval ?? payload?.rapid_development_approval;
  validateTypedImportedApproval(approval, {projectId: next.project_id, sourceBinding: next.setup?.source_binding});
  next.rapid_development_approved = true;
  next.rapid_development_approval = structuredClone(approval);
  next.setup = compileProjectInitializationPlan({
      projectId: next.project_id,
      projectMode: next.project_mode,
    rapidDevelopmentApproved: true,
    rapidDevelopmentApproval: approval,
      technicalBaseline: next.setup.stack,
      repositories: next.setup.repositories,
      directories: next.setup.directories,
      sourceBinding: next.setup.source_binding,
    });
    next.stage = "PROJECT_INITIALIZATION";
    next.phase = "PROJECT_INITIALIZATION";
  } else if (event === "PROJECT_INITIALIZED") {
    assert(next.stage === "PROJECT_INITIALIZATION", "project initialization is not due");
    assert(next.setup.status === "READY" || next.setup.status === "INITIALIZED", "project setup is not ready");
    requireSha(payload?.setup_sha256, "project initialization setup digest");
    assert(payload.setup_sha256 === next.setup.setup_sha256, "project initialization setup changed");
    requireSha(payload?.structure_sha256, "project initialization structure digest");
    requireSha(payload?.repository_plan_sha256, "project initialization repository digest");
    assert(payload?.source_bound === (next.project_mode === "NEW_PROJECT" || next.setup.source_binding.status === "DISCOVERY_BOUND"), "project initialization source binding is incomplete");
    next.setup.status = "INITIALIZED";
    next.baseline = payload.baseline ?? next.baseline;
    validateBaseline(next.baseline);
    next.stage = "PLATFORM_WAVE";
    next.phase = "PLATFORM_FOUNDATION";
    next.platform_roster = next.platform_roster.map((agent) => agent.status === "CREATED" ? {...agent, status: "AUDITING", readiness: "IN_PROGRESS"} : agent);
} else if (event === "PLATFORM_MERGE_COMPLETE") {
  assert(next.project_mode === "NEW_PROJECT" || next.rapid_development_approved, "platform merge cannot complete before project admission", "PLATFORM_ADMISSION_REQUIRED");
  assert(next.stage === "PLATFORM_INTEGRATION", "platform merge cannot complete before platform integration", "PLATFORM_ADMISSION_REQUIRED");
  const gate = payload?.platform_merge_gate ?? payload;
  validatePlatformMergeGate(gate, {projectId: next.project_id, sourceBinding: next.setup?.source_binding, inventorySha256: next.inventory_sha256});
  assert(next.platform_merge_gate === null, "platform merge has already been recorded", "PLATFORM_MERGE_STALE");
  next.platform_merge_gate = structuredClone(gate);
  next.stage = "FEATURE_WAVE";
  next.phase = "FEATURE_AUDIT_REPAIR";
} else if (event === "PLATFORM_WAVE_STARTED") {
  assert(next.stage === "PLATFORM_WAVE", "platform foundation wave is not ready to start");
  next.platform_roster = next.platform_roster.map((agent) => agent.status === "CREATED" ? {...agent, status: "AUDITING", readiness: "IN_PROGRESS"} : agent);
  } else if (event === "FEATURE_WAVE_STARTED") {
  assert(next.stage === "FEATURE_WAVE", "feature wave is not ready to start");
    next.feature_roster = next.feature_roster.map((agent) => agent.status === "CREATED" ? {...agent, status: "AUDITING", readiness: "IN_PROGRESS"} : agent);
    next.governance_roster = next.governance_roster.map((agent) => agent.status === "CREATED" ? {...agent, status: "AUDITING", readiness: "IN_PROGRESS"} : agent);
  } else if (event === "FEATURE_CANDIDATE_READY") {
  assert(next.stage === "FEATURE_WAVE", "feature wave is not active");
    const agent = findAgent(next, payload?.agent_id);
    assert(agent.target_kind === "NAMED_CAPABILITY" || agent.target_kind === "ROADMAP_CAPABILITY", "feature candidate must target a feature lane");
    requireHandoff(payload, agent, next.project_id, "feature candidate");
    updateAgent(next, agent.agent_id, {status: "READY_FOR_HANDOFF", readiness: "PRODUCTION_CANDIDATE_PENDING_TESTS", handoff_sha256: payload.handoff_sha256});
    for (const platform of next.platform_roster) {
      if (platform.status === "CREATED") updateAgent(next, platform.agent_id, {status: "AUDITING", readiness: "IN_PROGRESS"});
      next.consumption_matrix[agent.target_id][platform.target_id] = payload.applicable_platforms?.includes(platform.target_id) ? "RECEIVED" : "NOT_APPLICABLE_WITH_REASON";
    }
  } else if (event === "GOVERNANCE_CANDIDATE_READY") {
    assert(next.stage === "FEATURE_WAVE", "governance wave is not active");
    const agent = findAgent(next, payload?.agent_id);
    assert(agent.target_kind === "GOVERNANCE_LANE", "governance candidate must target a governance lane");
    requireHandoff(payload, agent, next.project_id, "governance candidate");
    updateAgent(next, agent.agent_id, {status: "READY_FOR_HANDOFF", readiness: "PRODUCTION_CANDIDATE_PENDING_TESTS", handoff_sha256: payload.handoff_sha256});
  } else if (event === "FEATURE_BATCH_CLOSED") {
    assert(next.stage === "FEATURE_WAVE", "feature batch is not ready to close");
    assert(allReady(next.feature_roster), "feature batch contains unfinished lanes");
    assert(allReady(next.governance_roster), "governance batch contains unfinished lanes");
    assert(next.platform_merge_gate !== null, "feature batch cannot close before platform foundation is merged", "PLATFORM_ADMISSION_REQUIRED");
    next.phase = "CENTRAL_INTEGRATION";
    next.stage = "CENTRAL_INTEGRATION";
  } else if (event === "PLATFORM_DOMAIN_CANDIDATE_READY") {
    assert(next.stage === "PLATFORM_WAVE", "platform foundation wave is not active");
    const agent = findAgent(next, payload?.agent_id);
    assert(agent.target_kind === "PLATFORM_DOMAIN", "platform candidate must target a platform domain");
    requireHandoff(payload, agent, next.project_id, "platform candidate");
    updateAgent(next, agent.agent_id, {status: "READY_FOR_HANDOFF", readiness: "PRODUCTION_CANDIDATE_PENDING_TESTS", handoff_sha256: payload.handoff_sha256});
    if (Array.isArray(payload.consumed_features)) {
      for (const featureId of payload.consumed_features) {
        requireIdentifier(featureId, "platform consumed feature");
        assert(next.consumption_matrix[featureId] !== undefined, "platform consumed an unknown feature");
        next.consumption_matrix[featureId][agent.target_id] = "CONSUMED";
      }
    }
  } else if (event === "PLATFORM_BATCH_CLOSED") {
    assert(next.stage === "PLATFORM_WAVE", "platform foundation batch is not ready to close");
    assert(allReady(next.platform_roster), "platform batch contains unfinished lanes");
    next.phase = "PLATFORM_INTEGRATION";
    next.stage = "PLATFORM_INTEGRATION";
  } else if (event === "CENTRAL_CANDIDATE_UPDATED") {
    assert(next.stage === "CENTRAL_INTEGRATION", "central integration is not active");
    requireControllerCandidate(payload, next, "central candidate");
    next.stage = "FINAL_SECURITY_PRIVACY";
  } else if (event === "FINAL_SECURITY_PRIVACY_ACCEPTED") {
    assert(next.stage === "FINAL_SECURITY_PRIVACY", "final security and privacy pass is not due");
    requireSha(payload?.audit_sha256, "final security and privacy audit");
    assert(payload?.material_findings === 0, "final security and privacy pass retains material findings");
    next.stage = "CONTROLLER_REPAIR_LOOP";
  } else if (event === "CONTROLLER_REPAIR_PASS") {
    assert(next.stage === "CONTROLLER_REPAIR_LOOP", "Controller repair loop is not active");
    assert(["CONTINUE", "PRODUCTION_CANDIDATE_PENDING_TESTS"].includes(payload?.result), "Controller repair result is invalid");
    requireSha(payload?.audit_sha256, "Controller repair audit");
    if (payload.result === "PRODUCTION_CANDIDATE_PENDING_TESTS") next.stage = "PRODUCTION_CANDIDATE_PENDING_TESTS";
  } else if (event === "QUESTION_DISCOVERED") {
    requireIdentifier(payload?.question_id, "pyramid question ID");
    if (!next.question_queue.question_ids.includes(payload.question_id)) next.question_queue.question_ids.push(payload.question_id);
    next.question_queue.question_ids.sort(compareUtf8);
  } else if (event === "TASK_HANDOFF_PRESERVED") {
    const agent = findAgent(next, payload?.agent_id);
    requireHandoff({...payload, project_id: next.project_id}, agent, next.project_id, "preserved task");
    requireSha(payload.preserve_sha256, "preserved task receipt");
    assert(payload.preserved === true, "task handoff was not preserved");
  } else if (event === "TASK_WORKTREE_INTEGRATED") {
    const agent = findAgent(next, payload?.agent_id);
    requireHandoff({...payload, project_id: next.project_id}, agent, next.project_id, "integrated task");
    requireSha(payload.integration_sha256, "integrated task receipt");
    requireSha(payload.audit_sha256, "integrated task audit");
    assert(payload.audited === true && payload.integrated === true, "task integration was not proven");
    const preserved = [...next.transition_history].reverse().find((entry) => entry.event === "TASK_HANDOFF_PRESERVED" && entry.payload?.agent_id === payload.agent_id && entry.payload?.handoff_sha256 === payload.handoff_sha256);
    assert(preserved !== undefined, "task integration lacks preserved handoff");
    updateAgent(next, agent.agent_id, {status: "CONSUMED", readiness: "PRODUCTION_CANDIDATE_PENDING_TESTS"});
  } else if (event === "TASK_ARCHIVED") {
    const agent = findAgent(next, payload?.agent_id);
    requireSha(payload.handoff_sha256, "archived task handoff");
    requireSha(payload.archive_sha256, "archived task receipt");
    assert(payload.handoff_sha256 === agent.handoff_sha256, "archived task handoff differs from the admitted handoff");
    assert(payload.handoff_preserved === true && payload.worktree_integrated === true && payload.chat_out_of_scope === true && payload.stale_worktree_closed === true, "task cannot be archived before downstream preservation and worktree closeout");
    assert(agent.status === "CONSUMED", "task cannot be archived before downstream consumption");
    updateAgent(next, agent.agent_id, {status: "ARCHIVED", readiness: "PRODUCTION_CANDIDATE_PENDING_TESTS", goal_state: payload.goal_state ?? "FINISHED"});
  } else if (event === "EXTERNAL_BLOCKER_RETAINED") {
    assert(["EXTERNAL_AUTHORITY", "HOST_CAPABILITY", "CUSTODY_BOUNDARY"].includes(payload?.classification), "ordinary implementation gaps cannot be retained as blockers");
    requireSha(payload?.audit_sha256, "external blocker audit");
    next.stage = "EXTERNAL_BLOCKED";
  }
  next.transition_history.push(eventRecord(event, payload));
  next.workflow_sha256 = null;
  next.workflow_sha256 = digestWithout(next, "workflow_sha256");
  return validateAuditDrivenIntegrationPyramid(next);
}

export function compileExistingWorktreeMigration({existingWorktrees = [], sourceCommit} = {}) {
  requireGitObject(sourceCommit, "migration baseline commit");
  assert(Array.isArray(existingWorktrees), "existing worktree migration input must be an array");
  const records = existingWorktrees.map((entry, index) => {
    assert(isRecord(entry), `existing worktree ${index} must be an object`);
    requireIdentifier(entry.target_id, `existing worktree ${index} target`);
    requireIdentifier(entry.worktree_id, `existing worktree ${index} ID`);
    requireString(entry.location_ref, `existing worktree ${index} location reference`);
    requireGitObject(entry.source_commit ?? sourceCommit, `existing worktree ${index} source commit`);
    assert(Number.isSafeInteger(entry.dirty_entry_count) && entry.dirty_entry_count >= 0, `existing worktree ${index} dirty count is invalid`);
    assert(entry.private_path === undefined && entry.path === undefined && entry.cwd === undefined, "migration records may not persist private paths");
    const body = {
      target_id: entry.target_id,
      worktree_id: entry.worktree_id,
      location_ref_sha256: opaqueReference(entry.location_ref, "worktree-location"),
      source_commit: entry.source_commit ?? sourceCommit,
      dirty_entry_count: entry.dirty_entry_count,
      preserved: true,
      downstream_consumed: false,
      lifecycle: "MIGRATED_PENDING_INTAKE",
    };
    return body;
  }).sort((left, right) => compareUtf8(left.target_id, right.target_id));
  sortedUnique(records.map((entry) => entry.target_id), "migrated worktree targets");
  return records;
}

export function createRapidPrototypeWorkflowController({workflow, inventory, visibleTaskRegistry, visibleTaskReadback, persist = null, onQuestion = null, preserveHandoff = null, integrateWorktree = null, archiveTask = null} = {}) {
  let current = validateRapidPrototypeWorkflowInventoryBinding(structuredClone(workflow), {inventory, visibleTaskRegistry, visibleTaskReadback});
  assert(persist === null || typeof persist === "function", "pyramid persistence must be callable");
  assert(onQuestion === null || typeof onQuestion === "function", "pyramid question callback must be callable");
  const advance = async ({event, payload = null} = {}) => {
    validateRapidPrototypeWorkflowInventoryBinding(current, {inventory, visibleTaskRegistry, visibleTaskReadback});
    const next = advanceWorkflow(current, {event, payload});
    validateRapidPrototypeWorkflowInventoryBinding(next, {inventory, visibleTaskRegistry, visibleTaskReadback});
    if (event === "QUESTION_DISCOVERED" && onQuestion !== null) await onQuestion(payload);
    if (persist !== null) await persist({expected_workflow_sha256: current.workflow_sha256, workflow: next});
    current = next;
    return structuredClone(current);
  };
  const closeTask = async ({agentId, handoffSha256, worktreeId = null, goalState = "FINISHED"} = {}) => {
    const agent = findAgent(current, agentId);
    requireSha(handoffSha256, "pyramid closeout handoff");
    assert(agent.handoff_sha256 === handoffSha256, "pyramid closeout handoff is stale");
    const expectedWorktree = worktreeId ?? agent.worktree_id;
    assert(expectedWorktree === agent.worktree_id, "pyramid closeout worktree is stale");
    assert(typeof preserveHandoff === "function" && typeof integrateWorktree === "function" && typeof archiveTask === "function", "pyramid closeout requires preservation, integration, and archive adapters");
    const preserved = await preserveHandoff({agent_id: agentId, handoff_sha256: handoffSha256, worktree_id: expectedWorktree});
    assert(preserved?.preserved === true, "pyramid handoff preservation was not proven");
    const preservedWorkflow = await advance({event: "TASK_HANDOFF_PRESERVED", payload: {
      agent_id: agentId, handoff_sha256: handoffSha256, worktree_id: expectedWorktree,
      project_id: current.project_id, source_bound: true, production_candidate_pending_tests: true,
      preserve_sha256: preserved.preserve_receipt_sha256 ?? preserved.preserve_sha256,
      preserved: true,
    }});
    const integrated = await integrateWorktree({agent_id: agentId, handoff_sha256: handoffSha256, worktree_id: expectedWorktree, preserve_sha256: preservedWorkflow.transition_history.at(-1).payload.preserve_sha256});
    assert(integrated?.audited === true && integrated?.integrated === true, "pyramid integration was not independently proven");
    const integratedWorkflow = await advance({event: "TASK_WORKTREE_INTEGRATED", payload: {
      agent_id: agentId, handoff_sha256: handoffSha256, worktree_id: expectedWorktree,
      project_id: current.project_id, source_bound: true, production_candidate_pending_tests: true,
      audit_sha256: integrated.audit_receipt_sha256 ?? integrated.audit_sha256,
      integration_sha256: integrated.integration_receipt_sha256 ?? integrated.integration_sha256,
      audited: true, integrated: true,
    }});
    const archived = await archiveTask({agent_id: agentId, worktree_id: expectedWorktree, handoff_sha256: handoffSha256});
    assert(archived?.archived === true && archived.chat_out_of_scope === true && archived.stale_worktree_closed === true, "pyramid task archive was not proven");
    const next = await advance({event: "TASK_ARCHIVED", payload: {
      agent_id: agentId, handoff_sha256: handoffSha256, archive_sha256: archived.archive_receipt_sha256 ?? archived.archive_sha256,
      handoff_preserved: true, worktree_integrated: true, chat_out_of_scope: true, stale_worktree_closed: true,
      goal_state: goalState,
    }});
    return next ?? integratedWorkflow;
  };
  return Object.freeze({inspect: () => structuredClone(current), advance, closeTask});
}

export function advanceRapidPrototypeWorkflow(workflow, {event, payload = null, inventory, visibleTaskRegistry, visibleTaskReadback} = {}) {
  validateRapidPrototypeWorkflowInventoryBinding(workflow, {inventory, visibleTaskRegistry, visibleTaskReadback});
  return advanceWorkflow(workflow, {event, payload});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("audit-driven integration pyramid loaded\n");
