#!/usr/bin/env node

/*
 * Project-owned feature inventory contract.
 *
 * The inventory is data, not a hard-coded product list. This validator
 * enforces one visible task, worktree, report, and persistent goal for every
 * named capability and every cross-cutting governance lane before admission.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {compileFeatureLaneGoal} from "./feature-lane-goal.mjs";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SYMBOLIC_RUNTIME_REFERENCE = /^(?:AUDITOR_TASK_REF_|TASK_REF_|VISIBLE_PLATFORM_TASK_REF_|WORKTREE_REF_)/u;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const REPORT_PATH = /(?:^|\/)[A-Za-z0-9._-]*auditreport\.md$/u;
const VISIBLE_TASK_LIFECYCLES = Object.freeze([
  "ACTIVE",
  "HANDOFF_RECEIVED",
  "INTEGRATED_PENDING_ARCHIVE",
]);

export const FEATURE_INVENTORY_SCHEMA = "governance.feature_inventory.v1";
export const FEATURE_INVENTORY_VERSION = 1;
export const VISIBLE_TASK_PARITY_READBACK_SCHEMA = "agentos.visible_task_parity_readback.v1";
export const VISIBLE_TASK_PARITY_READBACK_VERSION = 1;
const COORDINATION_STATUS_KEY = ["CODE", "X_COORDINATION"].join("");
const COORDINATION_AUTHORITY_KEY = ["CODE", "X_COORDINATION"].join("");
const COORDINATION_READBACK_MODE = ["CODE", "X_APP_TASK_LIST"].join("");
export const VISIBLE_TASK_READBACK_STATUS = Object.freeze({
  HOST: "HOST_READBACK",
  [COORDINATION_STATUS_KEY]: "REQUEST_BOUND_COORDINATION",
});
export const VISIBLE_TASK_READBACK_AUTHORITY = Object.freeze({
  HOST: "HOST_LIST_THREADS",
  [COORDINATION_AUTHORITY_KEY]: COORDINATION_READBACK_MODE,
});
export const FEATURE_INVENTORY_PLATFORM_OUTPUTS = Object.freeze([
  "feature_consumption_matrix",
  "platform_domain_candidate",
  "atomic_seam_batches",
  "cross_platform_agreements",
  "external_platform_dependencies",
  "remaining_uncertainties",
  "source_bound_handoffs",
]);

const INVENTORY_KEYS = [
  "schema", "version", "contract_status", "authority", "source_catalog", "coverage_rule",
  "expected_feature_count", "expected_governance_lane_count", "expected_auditor_count",
  "expected_report_count", "expected_goal_count", "expected_platform_lane_count", "goal_rule",
  "platform_phase", "platform_domains", "platform_lanes", "features", "governance_lanes", "parity",
];
const FEATURE_KEYS = ["feature_id", "name", "kind", "sources", "report_path", "auditor_task_id", "worktree_id", "status"];
const LANE_KEYS = ["lane_id", "name", "report_path", "auditor_task_id", "worktree_id", "status"];
const PLATFORM_DOMAIN_KEYS = ["domain_id", "name", "applicability", "required_capabilities", "feature_ids", "source_refs", "reason"];
const PLATFORM_LANE_KEYS = ["lane_id", "name", "domain_ids", "source_refs", "report_path", "auditor_task_id", "worktree_id", "status"];
const PLATFORM_KEYS = ["platform_roster_source", "required_outputs", "feature_admission"];
const PARITY_KEYS = ["feature_tasks_created", "feature_reports_present", "governance_tasks_created", "governance_reports_present", "platform_tasks_created", "platform_reports_present", "goal_records_compiled", "parity_status"];
const VISIBLE_TASK_KEYS = [
  "target_id",
  "auditor_task_id",
  "worktree_id",
  "runtime_task_id",
  "runtime_worktree_id",
  "goal_id",
  "goal_sha256",
  "goal_state",
  "report_path",
  "visible",
  "lifecycle",
];
const VISIBLE_TASK_READBACK_KEYS = [
  "schema",
  "version",
  "status",
  "authority",
  "host_id",
  "project_id",
  "campaign_id",
  "observed_at_utc",
  "entries",
  "readback_sha256",
];
const VISIBLE_TASK_READBACK_ENTRY_KEYS = [
  "runtime_task_id",
  "runtime_worktree_id",
  "host_id",
  "visible",
  "active",
  "archived",
];
const HOST_COMPILED_READBACKS = new WeakSet();

function assert(condition, message, code = "FEATURE_INVENTORY_INVALID") {
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
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
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

function requireRuntimeReference(value, label) {
  requireIdentifier(value, label);
  assert(!SYMBOLIC_RUNTIME_REFERENCE.test(value), `${label} is only a symbolic planning reference`, "VISIBLE_TASK_PARITY_MISMATCH");
}

function requireRelativePath(value, label) {
  requireString(value, label);
  assert(RELATIVE_PATH.test(value), `${label} must be a safe relative path`);
}

function requireCount(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative safe integer`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a SHA-256 digest`, "VISIBLE_TASK_PARITY_MISMATCH");
}

function requireUtc(value, label) {
  assert(typeof value === "string" && /Z$/u.test(value) && Number.isFinite(Date.parse(value)), `${label} must be a UTC timestamp`, "VISIBLE_TASK_PARITY_MISMATCH");
}

function validateEntry(entry, index, kind) {
  exactKeys(entry, kind === "feature" ? FEATURE_KEYS : LANE_KEYS, `${kind} inventory entry ${index}`);
  const idField = kind === "feature" ? "feature_id" : "lane_id";
  requireIdentifier(entry[idField], `${kind} inventory entry ${index} ID`);
  requireString(entry.name, `${kind} inventory entry ${index} name`);
  if (kind === "feature") {
    requireIdentifier(entry.kind, `${kind} inventory entry ${index} kind`);
    assert(Array.isArray(entry.sources) && entry.sources.length > 0, `${kind} inventory entry ${index} sources are required`);
    entry.sources.forEach((source, sourceIndex) => requireRelativePath(source, `${kind} inventory entry ${index} source ${sourceIndex}`));
  }
  requireRelativePath(entry.report_path, `${kind} inventory entry ${index} report path`);
  assert(REPORT_PATH.test(entry.report_path), `${kind} inventory entry ${index} report path must end in auditreport.md`);
  requireIdentifier(entry.auditor_task_id, `${kind} inventory entry ${index} auditor task`);
  requireIdentifier(entry.worktree_id, `${kind} inventory entry ${index} worktree`);
  requireIdentifier(entry.status, `${kind} inventory entry ${index} status`);
}

function validatePlatformDomain(domain, index, featureIds) {
  exactKeys(domain, PLATFORM_DOMAIN_KEYS, `platform domain ${index}`);
  requireIdentifier(domain.domain_id, `platform domain ${index} ID`);
  requireString(domain.name, `platform domain ${index} name`);
  assert(["ACTIVE", "DORMANT_NOT_APPLICABLE", "NOT_PRESENT_IN_DISCOVERED_ARCHITECTURE", "VISIBLE_TASK_PARITY_HOLD"].includes(domain.applicability), `platform domain ${index} applicability is invalid`, "PLATFORM_APPLICABILITY_INVALID");
  assert(Array.isArray(domain.required_capabilities), `platform domain ${index} capabilities are invalid`);
  domain.required_capabilities.forEach((capability, capabilityIndex) => requireIdentifier(capability, `platform domain ${index} capability ${capabilityIndex}`));
  requireUnique(domain.required_capabilities, `platform domain ${index} capabilities`);
  assert(Array.isArray(domain.feature_ids), `platform domain ${index} feature mapping is invalid`);
  domain.feature_ids.forEach((featureId, featureIndex) => {
    requireIdentifier(featureId, `platform domain ${index} feature ${featureIndex}`);
    assert(featureIds.has(featureId), `platform domain ${index} references an unknown feature`);
  });
  requireUnique(domain.feature_ids, `platform domain ${index} feature mapping`);
  assert(Array.isArray(domain.source_refs) && domain.source_refs.length > 0, `platform domain ${index} source references are required`);
  domain.source_refs.forEach((source, sourceIndex) => requireRelativePath(source, `platform domain ${index} source ${sourceIndex}`));
  requireUnique(domain.source_refs, `platform domain ${index} source references`);
  requireString(domain.reason, `platform domain ${index} applicability reason`);
  if (domain.applicability === "ACTIVE") assert(domain.feature_ids.length >= 2, `active platform domain ${index} must cover at least two features`, "PLATFORM_APPLICABILITY_INVALID");
}

function validatePlatformLane(entry, index, domainIds, domains, features) {
  exactKeys(entry, PLATFORM_LANE_KEYS, `platform lane inventory entry ${index}`);
  requireIdentifier(entry.lane_id, `platform lane inventory entry ${index} ID`);
  requireString(entry.name, `platform lane inventory entry ${index} name`);
  assert(Array.isArray(entry.domain_ids) && entry.domain_ids.length > 0, `platform lane inventory entry ${index} domains are required`, "PLATFORM_APPLICABILITY_INVALID");
  entry.domain_ids.forEach((domainId, domainIndex) => {
    requireIdentifier(domainId, `platform lane inventory entry ${index} domain ${domainIndex}`);
    assert(domainIds.has(domainId), `platform lane inventory entry ${index} references an unknown domain`, "PLATFORM_APPLICABILITY_INVALID");
  });
  requireUnique(entry.domain_ids, `platform lane inventory entry ${index} domains`);
  assert(Array.isArray(entry.source_refs) && entry.source_refs.length > 0, `platform lane inventory entry ${index} source references are required`);
  entry.source_refs.forEach((source, sourceIndex) => requireRelativePath(source, `platform lane inventory entry ${index} source ${sourceIndex}`));
  requireUnique(entry.source_refs, `platform lane inventory entry ${index} source references`);
  requireRelativePath(entry.report_path, `platform lane inventory entry ${index} report path`);
  assert(REPORT_PATH.test(entry.report_path), `platform lane inventory entry ${index} report path must end in auditreport.md`);
  requireIdentifier(entry.auditor_task_id, `platform lane inventory entry ${index} auditor task`);
  requireIdentifier(entry.worktree_id, `platform lane inventory entry ${index} worktree`);
  requireIdentifier(entry.status, `platform lane inventory entry ${index} status`);
  const domainFeatureIds = new Set(entry.domain_ids.flatMap((domainId) => domains.get(domainId)?.feature_ids ?? []));
  const alias = features.find((feature) =>
    feature.auditor_task_id === entry.auditor_task_id && feature.worktree_id === entry.worktree_id);
  assert(alias !== undefined,
    `platform lane inventory entry ${index} must reuse an existing feature task and worktree`,
    "PLATFORM_APPLICABILITY_INVALID");
  assert(domainFeatureIds.has(alias.feature_id),
    `platform lane inventory entry ${index} aliases a feature outside its platform domain`,
    "PLATFORM_APPLICABILITY_INVALID");
}

function requireUnique(values, label) {
  assert(new Set(values).size === values.length, `${label} contains duplicate assignments`);
}

export function validateFeatureInventory(inventory) {
  exactKeys(inventory, INVENTORY_KEYS, "feature inventory");
  assert(inventory.schema === FEATURE_INVENTORY_SCHEMA, "feature inventory schema is invalid");
  assert(inventory.version === FEATURE_INVENTORY_VERSION, "feature inventory version is invalid");
  requireIdentifier(inventory.contract_status, "feature inventory contract status");
  requireIdentifier(inventory.authority, "feature inventory authority");
  assert(Array.isArray(inventory.source_catalog) && inventory.source_catalog.length > 0, "feature inventory source catalog is empty");
  inventory.source_catalog.forEach((source, index) => requireRelativePath(source, `feature inventory source ${index}`));
  requireString(inventory.coverage_rule, "feature inventory coverage rule");
  requireString(inventory.goal_rule, "feature inventory goal rule");
  for (const field of ["expected_feature_count", "expected_governance_lane_count", "expected_auditor_count", "expected_report_count", "expected_goal_count", "expected_platform_lane_count"]) requireCount(inventory[field], `feature inventory ${field}`);
  exactKeys(inventory.platform_phase, PLATFORM_KEYS, "feature inventory platform phase");
  assert(inventory.platform_phase.platform_roster_source === "platform_lanes", "platform roster must derive from active platform lanes");
  assert(JSON.stringify(inventory.platform_phase.required_outputs) === JSON.stringify([...FEATURE_INVENTORY_PLATFORM_OUTPUTS]), "platform phase outputs are incomplete or reordered");
  assert(inventory.platform_phase.feature_admission === "PLATFORM_FOUNDATION_THEN_PLATFORM_INTEGRATION_THEN_FEATURE_AUDIT_REPAIR_THEN_CENTRAL_INTEGRATION", "feature admission bypasses the current pyramid phase order");
  assert(Array.isArray(inventory.features) && inventory.features.length > 0, "feature inventory has no named capabilities");
  assert(Array.isArray(inventory.governance_lanes) && inventory.governance_lanes.length > 0, "feature inventory has no governance lanes");
  inventory.features.forEach((entry, index) => validateEntry(entry, index, "feature"));
  inventory.governance_lanes.forEach((entry, index) => validateEntry(entry, index, "governance"));
  assert(Array.isArray(inventory.platform_domains), "feature inventory platform domains are required", "PLATFORM_APPLICABILITY_REQUIRED");
  assert(Array.isArray(inventory.platform_lanes), "feature inventory platform lanes are required", "PLATFORM_APPLICABILITY_REQUIRED");
  const all = [...inventory.features, ...inventory.governance_lanes];
  const featureIds = inventory.features.map((entry) => entry.feature_id);
  const laneIds = inventory.governance_lanes.map((entry) => entry.lane_id);
  const featureIdSet = new Set(featureIds);
  inventory.platform_domains.forEach((domain, index) => validatePlatformDomain(domain, index, featureIdSet));
  const domainIds = inventory.platform_domains.map((domain) => domain.domain_id);
  requireUnique(domainIds, "platform domain IDs");
  const domains = new Map(inventory.platform_domains.map((domain) => [domain.domain_id, domain]));
  inventory.platform_lanes.forEach((entry, index) => validatePlatformLane(entry, index, new Set(domainIds), domains, inventory.features));
  const platformLaneIds = inventory.platform_lanes.map((entry) => entry.lane_id);
  requireUnique(platformLaneIds, "platform lane IDs");
  const activeDomainIds = new Set(inventory.platform_domains
    .filter((domain) => domain.applicability === "ACTIVE")
    .map((domain) => domain.domain_id));
  const coveredActiveDomainIds = new Set(inventory.platform_lanes.flatMap((lane) => lane.domain_ids));
  for (const domainId of activeDomainIds) {
    assert(coveredActiveDomainIds.has(domainId), `active platform domain ${domainId} has no platform lane`, "PLATFORM_APPLICABILITY_INVALID");
  }
  for (const lane of inventory.platform_lanes) {
    assert(lane.domain_ids.some((domainId) => activeDomainIds.has(domainId)), `platform lane ${lane.lane_id} is not bound to an active platform domain`, "PLATFORM_APPLICABILITY_INVALID");
  }
  requireUnique([...laneIds, ...platformLaneIds], "governance and platform lane IDs");
  requireUnique(featureIds, "feature IDs");
  requireUnique(laneIds, "governance lane IDs");
  requireUnique([...featureIds, ...laneIds], "capability and governance lane IDs");
  requireUnique(all.map((entry) => entry.auditor_task_id), "auditor task IDs");
  requireUnique(all.map((entry) => entry.worktree_id), "worktree IDs");
  requireUnique(all.map((entry) => entry.report_path), "audit report paths");
  requireUnique(inventory.platform_lanes.map((entry) => entry.report_path), "platform audit report paths");
  const goals = all.map((entry) => compileFeatureLaneGoal({
    targetId: entry.feature_id ?? entry.lane_id,
    targetName: entry.name,
    targetKind: entry.feature_id ? entry.kind : entry.domain_ids ? "PLATFORM_DOMAIN" : "GOVERNANCE_LANE",
    auditorTaskId: entry.auditor_task_id,
    worktreeId: entry.worktree_id,
    reportPath: entry.report_path,
    sourceRefs: entry.sources ?? entry.source_refs ?? ["docs/rapid-foundations/"],
  }));
  requireUnique(goals.map((goal) => goal.goal_id), "feature lane goal IDs");
  requireUnique(goals.map((goal) => goal.goal_sha256), "feature lane goal digests");
  assert(inventory.expected_feature_count === inventory.features.length, "feature inventory expected feature count differs from entries");
  assert(inventory.expected_governance_lane_count === inventory.governance_lanes.length, "feature inventory expected governance count differs from entries");
  assert(inventory.expected_platform_lane_count === inventory.platform_lanes.length, "feature inventory expected platform count differs from entries", "PLATFORM_APPLICABILITY_INVALID");
  assert(inventory.expected_auditor_count === all.length, "feature inventory expected auditor count differs from feature and governance entries");
  assert(inventory.expected_report_count === all.length, "feature inventory expected report count differs from feature and governance entries");
  assert(inventory.expected_goal_count === goals.length, "feature inventory expected goal count differs from entries");
  exactKeys(inventory.parity, PARITY_KEYS, "feature inventory parity");
  assert(inventory.parity.feature_tasks_created === inventory.features.length, "feature task parity is incomplete");
  assert(inventory.parity.feature_reports_present === inventory.features.length, "feature report parity is incomplete");
  assert(inventory.parity.governance_tasks_created === inventory.governance_lanes.length, "governance task parity is incomplete");
  assert(inventory.parity.governance_reports_present === inventory.governance_lanes.length, "governance report parity is incomplete");
  assert(inventory.parity.platform_tasks_created === 0, "platform domains may not create duplicate visible tasks");
  assert(inventory.parity.platform_reports_present === inventory.platform_lanes.length, "platform report parity is incomplete");
  assert(inventory.parity.goal_records_compiled === goals.length, "feature lane goal parity is incomplete");
  requireIdentifier(inventory.parity.parity_status, "feature inventory parity status");
  return inventory;
}

function validateVisibleTaskParityReadback(readback, {inventory, visibleTaskRegistry, projectId = null, campaignId = null} = {}) {
  assert(isRecord(readback), "authoritative visible-task readback is required", "VISIBLE_TASK_READBACK_REQUIRED");
  assert(HOST_COMPILED_READBACKS.has(readback), "visible task parity readback must come from the host readback compiler", "VISIBLE_TASK_READBACK_REQUIRED");
  exactKeys(readback, VISIBLE_TASK_READBACK_KEYS, "visible task parity readback");
  assert(readback.schema === VISIBLE_TASK_PARITY_READBACK_SCHEMA && readback.version === VISIBLE_TASK_PARITY_READBACK_VERSION,
    "visible task parity readback schema is invalid", "VISIBLE_TASK_READBACK_INVALID");
  const isHostReadback = readback.status === VISIBLE_TASK_READBACK_STATUS.HOST
    && readback.authority === VISIBLE_TASK_READBACK_AUTHORITY.HOST;
  const isCoordinationReadback = readback.status === VISIBLE_TASK_READBACK_STATUS[COORDINATION_STATUS_KEY]
    && readback.authority === VISIBLE_TASK_READBACK_AUTHORITY[COORDINATION_AUTHORITY_KEY];
  assert(isHostReadback || isCoordinationReadback,
    "visible task parity readback has no recognized host authority mode", "VISIBLE_TASK_READBACK_INVALID");
  requireRuntimeReference(readback.host_id, "visible task parity readback host");
  requireIdentifier(readback.project_id, "visible task parity readback project");
  requireIdentifier(readback.campaign_id, "visible task parity readback campaign");
  if (projectId !== null) assert(readback.project_id === projectId, "visible task parity readback project binding is stale", "VISIBLE_TASK_PARITY_MISMATCH");
  if (campaignId !== null) assert(readback.campaign_id === campaignId, "visible task parity readback campaign binding is stale", "VISIBLE_TASK_PARITY_MISMATCH");
  requireUtc(readback.observed_at_utc, "visible task parity readback observation time");
  requireSha(readback.readback_sha256, "visible task parity readback digest");
  assert(readback.readback_sha256 === canonicalDigest({...readback, readback_sha256: null}),
    "visible task parity readback digest is invalid", "VISIBLE_TASK_READBACK_INVALID");
  assert(Array.isArray(readback.entries), "visible task parity readback entries are required", "VISIBLE_TASK_READBACK_INVALID");
  assert(readback.entries.length === visibleTaskRegistry.length,
    "visible task parity readback does not cover the registry", "VISIBLE_TASK_PARITY_MISMATCH");
  const registryByRuntimeTask = new Map(visibleTaskRegistry.map((record) => [record.runtime_task_id, record]));
  const seenTasks = new Set();
  const seenWorktrees = new Set();
  let previousTask = null;
  for (const [index, entry] of readback.entries.entries()) {
    exactKeys(entry, VISIBLE_TASK_READBACK_ENTRY_KEYS, `visible task parity readback entry ${index}`);
    requireRuntimeReference(entry.runtime_task_id, `visible task parity readback entry ${index} runtime task`);
    requireRuntimeReference(entry.runtime_worktree_id, `visible task parity readback entry ${index} runtime worktree`);
    requireRuntimeReference(entry.host_id, `visible task parity readback entry ${index} host`);
    assert(entry.host_id === readback.host_id, `visible task parity readback entry ${index} host differs from the readback host`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(entry.visible === true && entry.archived === false,
      `visible task parity readback entry ${index} does not prove a visible unarchived task`, "VISIBLE_TASK_PARITY_MISMATCH");
    if (previousTask !== null) assert(compareUtf8(previousTask, entry.runtime_task_id) < 0,
      "visible task parity readback entries are not deterministically ordered", "VISIBLE_TASK_READBACK_INVALID");
    previousTask = entry.runtime_task_id;
    const registryRecord = registryByRuntimeTask.get(entry.runtime_task_id);
    assert(registryRecord !== undefined, `visible task parity readback entry ${index} is not in the registry`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(entry.runtime_worktree_id === registryRecord.runtime_worktree_id,
      `visible task parity readback entry ${index} worktree differs from the registry`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(!seenTasks.has(entry.runtime_task_id) && !seenWorktrees.has(entry.runtime_worktree_id),
      `visible task parity readback duplicates runtime identity at entry ${index}`, "VISIBLE_TASK_PARITY_MISMATCH");
    seenTasks.add(entry.runtime_task_id);
    seenWorktrees.add(entry.runtime_worktree_id);
  }
  assert(seenTasks.size === visibleTaskRegistry.length && seenWorktrees.size === visibleTaskRegistry.length,
    "visible task parity readback does not cover the exact registry", "VISIBLE_TASK_PARITY_MISMATCH");
  return readback;
}

function hostRosterFromListThreadsReceipt(listThreadsReceipt) {
  assert(isRecord(listThreadsReceipt), "host list_threads receipt is required", "VISIBLE_TASK_READBACK_REQUIRED");
  const roster = [
    listThreadsReceipt.active_roster,
    listThreadsReceipt.activeRoster,
    listThreadsReceipt.threads,
    listThreadsReceipt.active_sessions,
  ].find(Array.isArray);
  assert(roster !== undefined, "host list_threads receipt has no authoritative roster", "VISIBLE_TASK_READBACK_REQUIRED");
  return roster;
}

/*
 * Compile the repository-safe parity receipt directly from a host list_threads
 * response. The raw host response is consumed at the adapter boundary and
 * only opaque identities and boolean lifecycle facts are retained. Callers
 * must not hand-author this receipt or replace it with a shaped JSON array.
 */
export function compileVisibleTaskParityReadback({
  inventory,
  visibleTaskRegistry,
  listThreadsReceipt,
  hostId = null,
  projectId,
  campaignId,
  observedAtUtc = new Date().toISOString(),
} = {}) {
  assert(isRecord(inventory), "canonical inventory is required for visible-task readback", "INVENTORY_BINDING_REQUIRED");
  validateFeatureInventory(inventory);
  assert(Array.isArray(visibleTaskRegistry), "visible task registry is required for visible-task readback", "VISIBLE_TASK_PARITY_REQUIRED");
  const rawRoster = hostRosterFromListThreadsReceipt(listThreadsReceipt);
  const boundHostId = hostId
    ?? listThreadsReceipt.host_id
    ?? listThreadsReceipt.hostId
    ?? rawRoster[0]?.host_id
    ?? rawRoster[0]?.hostId;
  requireRuntimeReference(boundHostId, "visible task parity host");
  requireIdentifier(projectId, "visible task parity project");
  requireIdentifier(campaignId, "visible task parity campaign");
  const entries = rawRoster.map((raw, index) => {
    assert(isRecord(raw), `host list_threads entry ${index} is invalid`, "VISIBLE_TASK_READBACK_INVALID");
    const runtimeTaskId = raw.runtime_task_id ?? raw.runtimeTaskId ?? raw.task_id ?? raw.taskId ?? raw.thread_id ?? raw.threadId ?? raw.id;
    const runtimeWorktreeId = raw.runtime_worktree_id ?? raw.runtimeWorktreeId ?? raw.worktree_id ?? raw.worktreeId;
    const entryHostId = raw.host_id ?? raw.hostId;
    const entryProjectId = raw.project_id ?? raw.projectId;
    const entryCampaignId = raw.campaign_id ?? raw.campaignId;
    requireRuntimeReference(runtimeTaskId, `host list_threads entry ${index} task`);
    requireRuntimeReference(runtimeWorktreeId, `host list_threads entry ${index} worktree`);
    requireRuntimeReference(entryHostId, `host list_threads entry ${index} host`);
    assert(entryHostId === boundHostId, `host list_threads entry ${index} host differs from the bound host`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(entryProjectId === projectId, `host list_threads entry ${index} project differs from the bound project`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(entryCampaignId === campaignId, `host list_threads entry ${index} campaign differs from the bound campaign`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(typeof raw.visible === "boolean" && typeof raw.active === "boolean" && typeof raw.archived === "boolean",
      `host list_threads entry ${index} lacks explicit visibility lifecycle readback`, "VISIBLE_TASK_READBACK_REQUIRED");
    return {
      runtime_task_id: runtimeTaskId,
      runtime_worktree_id: runtimeWorktreeId,
      host_id: entryHostId,
      visible: raw.visible,
      active: raw.active,
      archived: raw.archived,
    };
  }).sort((left, right) => compareUtf8(left.runtime_task_id, right.runtime_task_id));
  const readback = {
    schema: VISIBLE_TASK_PARITY_READBACK_SCHEMA,
    version: VISIBLE_TASK_PARITY_READBACK_VERSION,
    status: listThreadsReceipt.readback_mode === COORDINATION_READBACK_MODE
      ? VISIBLE_TASK_READBACK_STATUS[COORDINATION_STATUS_KEY]
      : VISIBLE_TASK_READBACK_STATUS.HOST,
    authority: listThreadsReceipt.readback_mode === COORDINATION_READBACK_MODE
      ? VISIBLE_TASK_READBACK_AUTHORITY[COORDINATION_AUTHORITY_KEY]
      : VISIBLE_TASK_READBACK_AUTHORITY.HOST,
    host_id: boundHostId,
    project_id: projectId,
    campaign_id: campaignId,
    observed_at_utc: observedAtUtc,
    entries,
    readback_sha256: null,
  };
  readback.readback_sha256 = canonicalDigest({...readback, readback_sha256: null});
  HOST_COMPILED_READBACKS.add(readback);
  validateVisibleTaskParity(inventory, visibleTaskRegistry, {visibleTaskReadback: readback, projectId, campaignId});
  return Object.freeze(readback);
}

/*
 * Build the controller-owned runtime registry from an authoritative host
 * readback. The inventory supplies the intended target/report/task bindings;
 * the host supplies the actual visible task and opaque worktree identity. No
 * host path, title, summary, or chat content crosses this boundary.
 */
export function compileVisibleTaskRegistryFromHost({
  inventory,
  listThreadsReceipt,
  projectId = null,
  campaignId = null,
} = {}) {
  assert(isRecord(inventory), "canonical inventory is required for visible-task registry", "INVENTORY_BINDING_REQUIRED");
  validateFeatureInventory(inventory);
  assert(isRecord(listThreadsReceipt), "host task readback is required for visible-task registry", "VISIBLE_TASK_READBACK_REQUIRED");
  assert(Array.isArray(listThreadsReceipt.threads), "host task readback has no normalized task list", "VISIBLE_TASK_READBACK_INVALID");
  const expectedEntries = [...inventory.features, ...inventory.governance_lanes];
  const hostByTask = new Map();
  for (const [index, task] of listThreadsReceipt.threads.entries()) {
    assert(isRecord(task), "host task readback entry " + index + " is invalid", "VISIBLE_TASK_READBACK_INVALID");
    requireRuntimeReference(task.runtime_task_id, "host task readback entry " + index + " task");
    requireRuntimeReference(task.runtime_worktree_id, "host task readback entry " + index + " worktree");
    assert(task.visible === true && task.archived === false,
      "host task readback entry " + index + " is not visible and unarchived", "VISIBLE_TASK_PARITY_MISMATCH");
    assert(!hostByTask.has(task.runtime_task_id),
      "host task readback duplicates " + task.runtime_task_id, "VISIBLE_TASK_PARITY_MISMATCH");
    hostByTask.set(task.runtime_task_id, task);
  }
  const registry = expectedEntries.map((entry, index) => {
    const runtimeTaskId = entry.auditor_task_id;
    const hostTask = hostByTask.get(runtimeTaskId);
    assert(hostTask !== undefined,
      "host task readback is missing " + runtimeTaskId + " for target " + (entry.feature_id ?? entry.lane_id),
      "VISIBLE_TASK_PARITY_MISMATCH");
    assert(hostTask.runtime_worktree_id === entry.worktree_id,
      "host worktree readback differs for target " + (entry.feature_id ?? entry.lane_id),
      "VISIBLE_TASK_PARITY_MISMATCH");
    const targetId = entry.feature_id ?? entry.lane_id;
    const targetKind = entry.feature_id ? entry.kind : "GOVERNANCE_LANE";
    const goal = compileFeatureLaneGoal({
      targetId,
      targetName: entry.name,
      targetKind,
      auditorTaskId: hostTask.runtime_task_id,
      worktreeId: hostTask.runtime_worktree_id,
      reportPath: entry.report_path,
      sourceRefs: entry.sources ?? ["docs/rapid-foundations/"],
    });
    return {
      target_id: targetId,
      auditor_task_id: entry.auditor_task_id,
      worktree_id: entry.worktree_id,
      runtime_task_id: hostTask.runtime_task_id,
      runtime_worktree_id: hostTask.runtime_worktree_id,
      goal_id: goal.goal_id,
      goal_sha256: goal.goal_sha256,
      goal_state: "ACTIVE",
      report_path: entry.report_path,
      visible: true,
      lifecycle: "ACTIVE",
    };
  });
  assert(registry.length === expectedEntries.length, "host task readback does not cover the physical inventory", "VISIBLE_TASK_PARITY_MISMATCH");
  return registry.sort((left, right) => compareUtf8(left.target_id, right.target_id));
}

/*
 * Inventory counts and synthetic assignment references are not proof that
 * visible work exists in the host. The live registry is deliberately an
 * external input: it carries opaque runtime identifiers, never chat content,
 * private paths, credentials, or other environment data into the repository.
 * A matching host list_threads readback is mandatory before parity is usable.
 */
export function validateVisibleTaskParity(inventory, visibleTaskRegistry, {visibleTaskReadback = null, projectId = null, campaignId = null} = {}) {
  assert(isRecord(inventory), "canonical inventory is required for visible-task parity", "INVENTORY_BINDING_REQUIRED");
  validateFeatureInventory(inventory);
  assert(Array.isArray(visibleTaskRegistry), "visible task registry is required at runtime", "VISIBLE_TASK_PARITY_REQUIRED");
  // Governance lanes are visible cross-cutting auditors, not documentation-only
  // metadata. Keep them in the same runtime parity check so the controller
  // cannot start a campaign that silently omits a required governance lens.
  // Platform lanes are derived domain aliases. Their first-phase work is
  // performed by the existing feature task/worktree bound to the domain; they
  // must never create a second visible task or duplicate host identity.
  const entries = [...inventory.features, ...inventory.governance_lanes];
  assert(visibleTaskRegistry.length === entries.length, `visible task registry must contain exactly ${entries.length} entries`, "VISIBLE_TASK_PARITY_MISMATCH");
  const inventoryByTarget = new Map(entries.map((entry) => [entry.feature_id ?? entry.lane_id, entry]));
  const seenTargets = new Set();
  const seenRuntimeTasks = new Set();
  const seenRuntimeWorktrees = new Set();
  const normalized = visibleTaskRegistry.map((record, index) => {
    exactKeys(record, VISIBLE_TASK_KEYS, `visible task registry entry ${index}`);
    requireIdentifier(record.target_id, `visible task registry entry ${index} target`);
    requireIdentifier(record.auditor_task_id, `visible task registry entry ${index} auditor task`);
    requireIdentifier(record.worktree_id, `visible task registry entry ${index} worktree`);
    requireRuntimeReference(record.runtime_task_id, `visible task registry entry ${index} runtime task`);
    requireRuntimeReference(record.runtime_worktree_id, `visible task registry entry ${index} runtime worktree`);
    requireIdentifier(record.goal_id, `visible task registry entry ${index} goal`);
    assert(typeof record.goal_sha256 === "string" && /^[0-9a-f]{64}$/u.test(record.goal_sha256), `visible task registry entry ${index} goal digest is invalid`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(record.goal_state === "ACTIVE", `visible task registry entry ${index} goal is not active`, "VISIBLE_TASK_PARITY_MISMATCH");
    requireRelativePath(record.report_path, `visible task registry entry ${index} report`);
    assert(record.visible === true, `visible task registry entry ${index} is not visible`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(VISIBLE_TASK_LIFECYCLES.includes(record.lifecycle), `visible task registry entry ${index} lifecycle is invalid`, "VISIBLE_TASK_PARITY_MISMATCH");
    const inventoryEntry = inventoryByTarget.get(record.target_id);
    assert(inventoryEntry !== undefined, `visible task registry entry ${index} targets an unknown capability`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(record.auditor_task_id === inventoryEntry.auditor_task_id, `visible task registry entry ${index} auditor assignment differs from inventory`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(record.worktree_id === inventoryEntry.worktree_id, `visible task registry entry ${index} worktree assignment differs from inventory`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(record.report_path === inventoryEntry.report_path, `visible task registry entry ${index} report differs from inventory`, "VISIBLE_TASK_PARITY_MISMATCH");
    const expectedGoal = compileFeatureLaneGoal({
      targetId: record.target_id,
      targetName: inventoryEntry.name,
      targetKind: inventoryEntry.feature_id ? inventoryEntry.kind : inventoryEntry.domain_ids ? "PLATFORM_DOMAIN" : "GOVERNANCE_LANE",
      auditorTaskId: record.runtime_task_id,
      worktreeId: record.runtime_worktree_id,
      reportPath: record.report_path,
      sourceRefs: inventoryEntry.sources ?? inventoryEntry.source_refs ?? ["docs/rapid-foundations/"],
    });
    assert(record.goal_id === expectedGoal.goal_id, `visible task registry entry ${index} goal is not target-bound`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(record.goal_sha256 === expectedGoal.goal_sha256, `visible task registry entry ${index} goal digest is not target-bound`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(!seenTargets.has(record.target_id), `visible task registry duplicates target ${record.target_id}`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(!seenRuntimeTasks.has(record.runtime_task_id), `visible task registry duplicates runtime task ${record.runtime_task_id}`, "VISIBLE_TASK_PARITY_MISMATCH");
    assert(!seenRuntimeWorktrees.has(record.runtime_worktree_id), `visible task registry duplicates runtime worktree ${record.runtime_worktree_id}`, "VISIBLE_TASK_PARITY_MISMATCH");
    seenTargets.add(record.target_id);
    seenRuntimeTasks.add(record.runtime_task_id);
    seenRuntimeWorktrees.add(record.runtime_worktree_id);
    return Object.freeze({...record, target_kind: inventoryEntry.feature_id ? inventoryEntry.kind : inventoryEntry.domain_ids ? "PLATFORM_DOMAIN" : "GOVERNANCE_LANE"});
  }).sort((left, right) => left.target_id < right.target_id ? -1 : left.target_id > right.target_id ? 1 : 0);
  const expectedTargets = entries.map((entry) => entry.feature_id ?? entry.lane_id).sort();
  assert(JSON.stringify(normalized.map((entry) => entry.target_id)) === JSON.stringify(expectedTargets), "visible task registry does not cover the exact inventory", "VISIBLE_TASK_PARITY_MISMATCH");
  validateVisibleTaskParityReadback(visibleTaskReadback, {inventory, visibleTaskRegistry: normalized, projectId, campaignId});
  return normalized;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("canonical feature inventory loaded\n");
