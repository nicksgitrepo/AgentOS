#!/usr/bin/env node

/*
 * Canonical rolling-campaign state for the Audit–Repair Integration Pyramid.
 *
 * The existing audit-driven controller owns transitions and host actions.
 * This module owns the durable amendment: six logical platform domains, one
 * deduplicated feature queue, six visible feature slots, source-bound writer
 * custody, and the evidence required before a task can be archived.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const AUDIT_REPAIR_INTEGRATION_STATE_SCHEMA = "agentos.audit_repair_integration_state.v1";
export const PLATFORM_FEATURE_MAP_SCHEMA = "agentos.platform_feature_map.v1";
export const AUDIT_REPAIR_INTEGRATION_STATE_VERSION = 1;
export const ACTIVE_FEATURE_SLOT_COUNT = 6;
export const PLATFORM_DOMAIN_IDS = Object.freeze([
  "PORTABLE_KERNEL_GATES_CONTRACTS",
  "GOVERNANCE_INTENT_ROLES_ROUTING",
  "NATIVE_HOST_WORKSPACE_PROVIDER_SESSION",
  "CAMPAIGN_EVIDENCE_HANDOFF_ACCEPTANCE",
  "PRIVATE_CONTROL_MEMORY_PROJECTIONS",
  "RELEASE_MIGRATION_DELIVERY_SECURITY_OWNER_SURFACE",
]);
export const FEATURE_LANE_MODELS = Object.freeze({model: "gpt-5.6-luna", reasoning_effort: "max"});
export const PRE_REAL_HOST_STATES = Object.freeze([
  "PRODUCTION_READY_PENDING_REAL_HOST",
  "PREPARED_NOT_ACTIVATED",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;

function assert(condition, message, code = "AUDIT_REPAIR_INTEGRATION_INVALID") {
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
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
}

function requireRelativePath(value, label) {
  requireString(value, label);
  assert(SAFE_PATH.test(value), `${label} must be a safe relative path`);
}

function sortedUnique(values, label) {
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
}

function digestWithout(value, field) {
  return canonicalDigest({...value, [field]: null});
}

function validateDomain(domain, index, ownerIds) {
  const keys = ["domain_id", "name", "owner_lane_id", "owner_task_id", "owner_worktree_id", "source_refs"];
  exactKeys(domain, keys, `platform domain ${index}`);
  requireIdentifier(domain.domain_id, `platform domain ${index} ID`);
  requireString(domain.name, `platform domain ${index} name`);
  assert(PLATFORM_DOMAIN_IDS.includes(domain.domain_id), `platform domain ${index} is not canonical`);
  requireIdentifier(domain.owner_lane_id, `platform domain ${index} owner lane`);
  assert(ownerIds.has(domain.owner_lane_id), `platform domain ${index} owner is not registered`);
  requireIdentifier(domain.owner_task_id, `platform domain ${index} owner task`);
  requireIdentifier(domain.owner_worktree_id, `platform domain ${index} owner worktree`);
  assert(Array.isArray(domain.source_refs) && domain.source_refs.length > 0, `platform domain ${index} source refs are required`);
  domain.source_refs.forEach((value, sourceIndex) => requireRelativePath(value, `platform domain ${index} source ${sourceIndex}`));
  sortedUnique(domain.source_refs, `platform domain ${index} source refs`);
}

export function validatePlatformFeatureMap(map, {inventory} = {}) {
  exactKeys(map, ["schema", "version", "status", "inventory_ref", "inventory_sha256", "deduplication_rule", "platform_domains", "feature_mappings", "map_sha256"], "platform feature map");
  assert(map.schema === PLATFORM_FEATURE_MAP_SCHEMA && map.version === 1, "platform feature map identity is invalid");
  assert(map.status === "SOURCE_BOUND_PREPARED_NOT_ACTIVATED", "platform feature map cannot be activated");
  requireRelativePath(map.inventory_ref, "platform feature map inventory ref");
  requireSha(map.inventory_sha256, "platform feature map inventory digest");
  requireString(map.deduplication_rule, "platform feature map deduplication rule");
  assert(Array.isArray(map.platform_domains) && map.platform_domains.length === PLATFORM_DOMAIN_IDS.length, "platform feature map must contain exactly six domains");
  assert(Array.isArray(map.feature_mappings), "platform feature mappings are required");
  requireSha(map.map_sha256, "platform feature map digest");
  assert(map.map_sha256 === digestWithout(map, "map_sha256"), "platform feature map digest mismatch");
  const ownerIds = new Set(map.platform_domains.map((domain) => domain.owner_lane_id));
  map.platform_domains.forEach((domain, index) => validateDomain(domain, index, ownerIds));
  const domainIds = map.platform_domains.map((domain) => domain.domain_id);
  assert(JSON.stringify(domainIds) === JSON.stringify(PLATFORM_DOMAIN_IDS), "platform domains are missing or reordered");
  if (inventory !== undefined) {
    assert(map.inventory_ref === "docs/feature-inventory.v1.json", "platform feature map inventory ref is not canonical");
    assert(map.inventory_sha256 === canonicalDigest(inventory), "platform feature map inventory binding is stale");
    const expected = inventory.features.map((feature) => feature.feature_id);
    const actual = map.feature_mappings.map((entry) => entry.feature_id);
    assert(JSON.stringify(actual) === JSON.stringify(expected), "platform feature map does not follow canonical inventory order");
  }
  const featureIds = new Set();
  for (const [index, entry] of map.feature_mappings.entries()) {
    exactKeys(entry, ["feature_id", "primary_platform_domain", "affected_platform_domains", "canonical_root_cause_id"], `feature mapping ${index}`);
    requireIdentifier(entry.feature_id, `feature mapping ${index} feature`);
    assert(!featureIds.has(entry.feature_id), `feature mapping ${index} duplicates a feature`);
    featureIds.add(entry.feature_id);
    assert(PLATFORM_DOMAIN_IDS.includes(entry.primary_platform_domain), `feature mapping ${index} primary domain is invalid`);
    assert(Array.isArray(entry.affected_platform_domains), `feature mapping ${index} affected domains are invalid`);
    sortedUnique(entry.affected_platform_domains, `feature mapping ${index} affected domains`);
    assert(!entry.affected_platform_domains.includes(entry.primary_platform_domain), `feature mapping ${index} repeats its primary domain`);
    entry.affected_platform_domains.forEach((domain) => assert(PLATFORM_DOMAIN_IDS.includes(domain), `feature mapping ${index} affected domain is invalid`));
    requireIdentifier(entry.canonical_root_cause_id, `feature mapping ${index} root cause`);
  }
  assert(inventory === undefined || featureIds.size === inventory.features.length, "platform feature map does not cover every feature");
  return map;
}

function validateCurrentCandidate(candidate) {
  exactKeys(candidate, ["worktree_id", "branch_ref", "commit", "tree", "working_tree", "status"], "current candidate");
  requireIdentifier(candidate.worktree_id, "current candidate worktree");
  requireString(candidate.branch_ref, "current candidate branch");
  requireGitObject(candidate.commit, "current candidate commit");
  requireGitObject(candidate.tree, "current candidate tree");
  assert(candidate.working_tree === "CLEAN", "current candidate must be clean before slot admission");
  requireIdentifier(candidate.status, "current candidate status");
}

function validateSlot(slot, index, inventory, currentCandidate, platformLaneIds) {
  const keys = ["slot_id", "feature_id", "task_id", "worktree_id", "branch_ref", "base_commit", "base_tree", "report_ref", "platform_return_owner", "cycle_goal_id", "cycle_goal_sha256", "observed_worktree_status", "admission_status"];
  exactKeys(slot, keys, `feature slot ${index}`);
  requireIdentifier(slot.slot_id, `feature slot ${index} ID`);
  requireIdentifier(slot.feature_id, `feature slot ${index} feature`);
  const feature = inventory.features.find((entry) => entry.feature_id === slot.feature_id);
  assert(feature !== undefined, `feature slot ${index} is not in the inventory`);
  assert(feature.auditor_task_id === slot.task_id && feature.worktree_id === slot.worktree_id, `feature slot ${index} task/worktree differs from inventory`);
  requireIdentifier(slot.task_id, `feature slot ${index} task`);
  requireIdentifier(slot.worktree_id, `feature slot ${index} worktree`);
  requireString(slot.branch_ref, `feature slot ${index} branch`);
  requireGitObject(slot.base_commit, `feature slot ${index} base commit`);
  requireGitObject(slot.base_tree, `feature slot ${index} base tree`);
  assert(slot.base_commit === currentCandidate.commit && slot.base_tree === currentCandidate.tree, `feature slot ${index} is not based on the current candidate`, "STALE_FEATURE_BASELINE");
  requireRelativePath(slot.report_ref, `feature slot ${index} report`);
  assert(slot.report_ref === feature.report_path, `feature slot ${index} report differs from inventory`);
  requireIdentifier(slot.platform_return_owner, `feature slot ${index} platform return owner`);
  assert(platformLaneIds.has(slot.platform_return_owner), `feature slot ${index} has no platform return owner`);
  requireIdentifier(slot.cycle_goal_id, `feature slot ${index} goal`);
  requireSha(slot.cycle_goal_sha256, `feature slot ${index} goal digest`);
  assert(slot.observed_worktree_status === "STALE_BASE_REQUIRES_CURRENT_CANDIDATE_REBIND" || slot.observed_worktree_status === "CURRENT_CANDIDATE_BOUND", `feature slot ${index} worktree state is invalid`);
  assert(slot.admission_status === "ADMITTED_PENDING_VISIBLE_TASK_RESUME" || slot.admission_status === "ACTIVE", `feature slot ${index} admission state is invalid`);
}

export function validateAuditRepairIntegrationState(state, {inventory, platformFeatureMap} = {}) {
  const keys = ["schema", "version", "status", "project_id", "campaign_id", "workflow_ref", "inventory_ref", "platform_feature_map_ref", "inventory_sha256", "platform_feature_map_sha256", "current_candidate", "roadmap_03_checkpoint", "feature_lane_policy", "feature_queue_order", "active_feature_slots", "platform_owners", "platform_pipeline", "persistence", "final_pre_host_states", "next_action", "state_sha256"];
  exactKeys(state, keys, "audit-repair integration state");
  assert(state.schema === AUDIT_REPAIR_INTEGRATION_STATE_SCHEMA && state.version === AUDIT_REPAIR_INTEGRATION_STATE_VERSION, "audit-repair integration state identity is invalid");
  assert(state.status === "PREPARED_NOT_ACTIVATED", "audit-repair integration state cannot activate protected actions");
  requireIdentifier(state.project_id, "audit-repair project");
  requireIdentifier(state.campaign_id, "audit-repair campaign");
  requireRelativePath(state.workflow_ref, "audit-repair workflow ref");
  requireRelativePath(state.inventory_ref, "audit-repair inventory ref");
  requireRelativePath(state.platform_feature_map_ref, "audit-repair feature map ref");
  requireSha(state.inventory_sha256, "audit-repair inventory digest");
  requireSha(state.platform_feature_map_sha256, "audit-repair feature map digest");
  requireSha(state.state_sha256, "audit-repair state digest");
  assert(state.state_sha256 === digestWithout(state, "state_sha256"), "audit-repair state digest mismatch");
  validateCurrentCandidate(state.current_candidate);
  assert(state.roadmap_03_checkpoint.feature_id === "ROADMAP_03_CONTROLLER_INTENT", "ROADMAP_03 checkpoint is not preserved");
  requireGitObject(state.roadmap_03_checkpoint.integrated_commit, "ROADMAP_03 integrated commit");
  requireGitObject(state.roadmap_03_checkpoint.integrated_tree, "ROADMAP_03 integrated tree");
  assert(state.roadmap_03_checkpoint.integrated_commit === state.current_candidate.commit && state.roadmap_03_checkpoint.integrated_tree === state.current_candidate.tree, "ROADMAP_03 checkpoint is not the current candidate");
  assert(state.feature_lane_policy.target_active_slots === ACTIVE_FEATURE_SLOT_COUNT, "feature slot policy must maintain six slots");
  assert(state.feature_lane_policy.model === FEATURE_LANE_MODELS.model && state.feature_lane_policy.reasoning_effort === FEATURE_LANE_MODELS.reasoning_effort, "feature lane model policy is not canonical");
  assert(Array.isArray(state.feature_lane_policy.lane_cycle) && JSON.stringify(state.feature_lane_policy.lane_cycle) === JSON.stringify(["AUDIT", "SMALLEST_REPAIR", "HOSTILE_SELF_AUDIT", "AFFECTED_PROOF", "HANDOFF"]), "feature lane cycle is incomplete");
  assert(state.feature_lane_policy.feature_self_merge === false && state.feature_lane_policy.feature_self_acceptance === false && state.feature_lane_policy.peer_worktree_edits === false && state.feature_lane_policy.protected_runtime_bypass === false, "feature custody policy is weakened");
  assert(state.feature_lane_policy.report_rule === "APPEND_ONLY_ENDING_CURRENT_STATE", "feature report rule is invalid");
  assert(Array.isArray(state.feature_queue_order), "feature queue is required");
  const expectedQueue = inventory?.features.map((feature) => feature.feature_id) ?? state.feature_queue_order;
  assert(JSON.stringify(state.feature_queue_order) === JSON.stringify(expectedQueue), "feature queue does not match canonical inventory order");
  const ownerIds = new Set(state.platform_owners.map((owner) => owner.lane_id));
  assert(state.platform_owners.length === 3, "platform owner roster must preserve the three existing visible custodians");
  for (const [index, owner] of state.platform_owners.entries()) {
    exactKeys(owner, ["lane_id", "task_id", "worktree_id", "model", "reasoning_effort", "domain_ids", "cursor"], `platform owner ${index}`);
    requireIdentifier(owner.lane_id, `platform owner ${index} lane`);
    requireIdentifier(owner.task_id, `platform owner ${index} task`);
    requireIdentifier(owner.worktree_id, `platform owner ${index} worktree`);
    assert(owner.model === FEATURE_LANE_MODELS.model && owner.reasoning_effort === FEATURE_LANE_MODELS.reasoning_effort, `platform owner ${index} model policy is invalid`);
    assert(Array.isArray(owner.domain_ids) && owner.domain_ids.length > 0, `platform owner ${index} domains are required`);
    sortedUnique(owner.domain_ids, `platform owner ${index} domains`);
    owner.domain_ids.forEach((domain) => assert(PLATFORM_DOMAIN_IDS.includes(domain), `platform owner ${index} domain is invalid`));
    requireIdentifier(owner.cursor, `platform owner ${index} cursor`);
  }
  assert(JSON.stringify([...new Set(state.platform_owners.flatMap((owner) => owner.domain_ids))].sort(compareUtf8)) === JSON.stringify([...PLATFORM_DOMAIN_IDS].sort(compareUtf8)), "platform owner roster does not cover all six domains");
  assert(Array.isArray(state.active_feature_slots) && state.active_feature_slots.length === ACTIVE_FEATURE_SLOT_COUNT, "exactly six feature slots are required while the queue has six or more entries");
  const slotIds = state.active_feature_slots.map((slot) => slot.slot_id);
  const slotFeatures = state.active_feature_slots.map((slot) => slot.feature_id);
  sortedUnique(slotIds, "feature slot IDs");
  sortedUnique(slotFeatures, "active feature IDs");
  const platformLaneIds = new Set(state.platform_owners.map((owner) => owner.lane_id));
  state.active_feature_slots.forEach((slot, index) => validateSlot(slot, index, inventory, state.current_candidate, platformLaneIds));
  if (inventory !== undefined) assert(state.inventory_sha256 === canonicalDigest(inventory), "audit-repair inventory binding is stale");
  if (platformFeatureMap !== undefined) {
    validatePlatformFeatureMap(platformFeatureMap, {inventory});
    assert(state.platform_feature_map_sha256 === platformFeatureMap.map_sha256, "audit-repair feature map binding is stale");
  }
  assert(Array.isArray(state.final_pre_host_states) && JSON.stringify(state.final_pre_host_states) === JSON.stringify([...PRE_REAL_HOST_STATES]), "final pre-host states are invalid");
  requireIdentifier(state.next_action, "audit-repair next action");
  return state;
}

export function compileAuditRepairIntegrationState({state, inventory, platformFeatureMap} = {}) {
  validatePlatformFeatureMap(platformFeatureMap, {inventory});
  const next = structuredClone(state);
  next.platform_feature_map_sha256 = platformFeatureMap.map_sha256;
  next.state_sha256 = digestWithout(next, "state_sha256");
  return validateAuditRepairIntegrationState(next, {inventory, platformFeatureMap});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("audit-repair integration state loaded\n");
