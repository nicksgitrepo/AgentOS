#!/usr/bin/env node

/* Rebuildable snapshots and role-scoped context capsules over project-memory records. */

import {canonicalDigest, assertPersistedRecordSafe, compareUtf8} from "./content-addressing.mjs";
import {CONTRACT_STATUS, CONTROL_SPACE, assertSafeRecord, exactKeys, requireIdentifier, requireRecord, requireSafeInteger, requireSha, requireSortedUniqueDigests, requireSortedUniqueStrings} from "./map-memory-common.mjs";
import {validateDerivedIndex} from "./derived-index.mjs";
import {validateProjectMap} from "./project-map.mjs";
import {PROJECT_MEMORY_VERSION, PROJECT_MEMORY_SNAPSHOT_SCHEMA, PROJECT_MEMORY_CAPSULE_SCHEMA, MEMORY_SNAPSHOT_STATUSES, MEMORY_CAPSULE_STATUSES, INVALIDATION_TRIGGERS, INVALIDATION_ACTIONS, assert, assertSameBinding, bindingFrom, mergeNotices, requireEnum, requireNullableSha, requireUtc, validateBinding, validateConflictList, validateMemoryRecord, validateNoticeList, compileMemoryInvalidationRecord, replayMemoryLedger} from "./project-memory-records.mjs";

const SNAPSHOT_KEYS = [
  "schema", "version", "contract_status", "visibility", "advisory_only", "acceptance_authority", "snapshot_id",
  "project_ref", "campaign_ref", "goal_ref", "role_ref", "source_commit", "source_tree", "source_snapshot_sha256", "policy_sha256", "handoff_sha256",
  "event_ledger_head_sha256", "event_cursor", "context_record_sha256", "project_map_sha256", "derived_index_sha256",
  "record_sha256s", "decision_sha256s", "invalidation_sha256s", "uncertainties", "conflicts", "status", "observed_at_utc", "snapshot_sha256",
];

const CAPSULE_KEYS = [
  "schema", "version", "contract_status", "visibility", "advisory_only", "acceptance_authority", "capsule_id", "role_ref", "lane_ref",
  "project_ref", "campaign_ref", "goal_ref", "source_commit", "source_tree", "source_snapshot_sha256", "policy_sha256", "handoff_sha256",
  "snapshot_sha256", "context_record_sha256", "selected_record_sha256s", "allowed_scope_refs", "prohibited_scope_refs", "required_evidence_sha256s",
  "uncertainties", "conflicts", "status", "capsule_sha256",
];

function scopesOverlap(left, right) {
  return left.some((scope) => right.includes(scope));
}

function validateSnapshotRecordRefs(snapshot) {
  requireNullableSha(snapshot.context_record_sha256, "memory snapshot context record");
  requireNullableSha(snapshot.project_map_sha256, "memory snapshot project map");
  requireNullableSha(snapshot.derived_index_sha256, "memory snapshot derived index");
  requireSortedUniqueDigests(snapshot.record_sha256s, "memory snapshot records", {allowEmpty: true});
  requireSortedUniqueDigests(snapshot.decision_sha256s, "memory snapshot decisions", {allowEmpty: true});
  requireSortedUniqueDigests(snapshot.invalidation_sha256s, "memory snapshot invalidations", {allowEmpty: true});
  const recordRefs = new Set(snapshot.record_sha256s);
  for (const digest of snapshot.context_record_sha256 === null ? [] : [snapshot.context_record_sha256]) {
    assert(recordRefs.has(digest), "memory snapshot context record is not in its record references");
  }
  for (const digest of [...snapshot.decision_sha256s, ...snapshot.invalidation_sha256s]) {
    assert(recordRefs.has(digest), "memory snapshot typed record reference is not in its record references");
  }
}

export function compileMemorySnapshot({
  binding,
  replay: replayInput,
  invalidationRecords = [],
  projectMap = null,
  derivedIndex = null,
  observedAtUtc,
  snapshotId = null,
}) {
  validateBinding(binding, "memory snapshot binding");
  requireRecord(replayInput, "memory replay");
  assert(Array.isArray(replayInput.events), "memory replay events are required");
  const replay = replayMemoryLedger(replayInput.events, {binding});
  assertSameBinding(binding, replay.binding ?? binding, "memory snapshot replay binding");
  assert(Number.isSafeInteger(replay.event_count) && replay.event_count >= 0, "memory replay event count is invalid");
  requireSha(replay.head_sha256, "memory replay head");
  assert(Array.isArray(replay.records), "memory replay records are required");
  assert(Array.isArray(replay.current_records), "memory replay current records are required");
  assert(Array.isArray(replay.conflicts), "memory replay conflicts are required");
  validateConflictList(replay.conflicts);
  validateNoticeList(replay.uncertainties ?? [], "memory replay uncertainties");
  if (projectMap !== null) {
    validateProjectMap(projectMap, {
      currentSourceCommit: binding.source_commit,
      currentSourceTree: binding.source_tree,
      currentSourceSnapshotSha256: binding.source_snapshot_sha256,
      currentPolicySha256: binding.policy_sha256,
    });
    assert(projectMap.project_ref === binding.project_ref, "memory snapshot project map is for another project");
    assert(projectMap.campaign_ref === binding.campaign_ref, "memory snapshot project map is for another campaign");
    assert(projectMap.goal_ref === binding.goal_ref, "memory snapshot project map is for another goal");
    assert(projectMap.role_scope.includes(binding.role_ref), "memory snapshot project map excludes the bound role");
  }
  if (derivedIndex !== null) {
    validateDerivedIndex(derivedIndex, {
      currentSourceSnapshotSha256: binding.source_snapshot_sha256,
      currentPolicySha256: binding.policy_sha256,
    });
    assert(derivedIndex.project_ref === binding.project_ref, "memory snapshot derived index is for another project");
  }
  const dependencyNotices = [];
  const dependencyConflict = projectMap?.status === "CONFLICT";
  const dependencyStale = projectMap?.status === "STALE" || derivedIndex?.status === "STALE";
  const dependencyPartial = projectMap?.status === "BOUNDED_PARTIAL" || projectMap?.status === "UNAVAILABLE";
  if (projectMap?.status === "CONFLICT") dependencyNotices.push({code: "PROJECT_MAP_CONFLICT", subject_ref: null, detail: "The bound project map contains unresolved conflicts."});
  if (projectMap?.status === "STALE") dependencyNotices.push({code: "PROJECT_MAP_STALE", subject_ref: null, detail: "The bound project map is stale and cannot authorize a current capsule."});
  if (projectMap?.status === "BOUNDED_PARTIAL" || projectMap?.status === "UNAVAILABLE") dependencyNotices.push({code: "PROJECT_MAP_PARTIAL", subject_ref: null, detail: "The bound project map is incomplete or unavailable."});
  if (derivedIndex?.status === "STALE") dependencyNotices.push({code: "DERIVED_INDEX_STALE", subject_ref: null, detail: "The bound derived index is stale and must be rebuilt."});
  const replayRecordDigests = new Set(replay.records.map((record) => record.record_sha256));
  const currentInvalidationRecords = replay.current_records.filter((record) => record.record_type === "INVALIDATION");
  const activeInvalidationsByDigest = new Map(currentInvalidationRecords.map((record) => [record.record_sha256, record]));
  invalidationRecords.forEach((record, index) => {
    validateMemoryRecord(record);
    assert(record.record_type === "INVALIDATION", `memory snapshot invalidation ${index} has the wrong record type`);
    assertSameBinding(binding, record, `memory snapshot invalidation ${index}`);
    assert(replayRecordDigests.has(record.record_sha256), `memory snapshot invalidation ${index} is not in the ledger`);
    assert(activeInvalidationsByDigest.has(record.record_sha256), `memory snapshot invalidation ${index} is not current in the ledger`);
  });
  for (const record of currentInvalidationRecords) {
    for (const digest of record.body.affected_record_sha256s) {
      assert(replayRecordDigests.has(digest), `memory invalidation ${record.record_id} names an absent record`);
    }
    activeInvalidationsByDigest.set(record.record_sha256, record);
  }
  const activeInvalidationRecords = [...activeInvalidationsByDigest.values()].sort((left, right) => compareUtf8(left.record_sha256, right.record_sha256));
  for (const record of activeInvalidationRecords) {
    assert(record.record_type === "INVALIDATION", "memory snapshot active invalidation has the wrong record type");
  }
  requireUtc(observedAtUtc, "memory snapshot observation time");
  const currentRecords = [...replay.current_records].sort((left, right) => compareUtf8(left.record_sha256, right.record_sha256));
  currentRecords.forEach((record) => validateMemoryRecord(record));
  const contextRecord = [...replay.current_records].reverse().find((record) => record.record_type === "PROJECT_CONTEXT") ?? null;
  const invalidationRefs = activeInvalidationRecords.map((record) => record.record_sha256).sort(compareUtf8);
  if (dependencyStale && invalidationRefs.length === 0) throw new Error("stale memory dependency requires an appended invalidation record");
  const uncertainties = mergeNotices(
    replay.uncertainties ?? [],
    replay.conflicts.map((conflict) => ({code: "LEDGER_CONFLICT", subject_ref: null, detail: `Ledger contains divergent records for ${conflict.conflict_key}.`})),
    dependencyNotices,
  );
  if (contextRecord === null) uncertainties.push({code: "NO_CONTEXT", subject_ref: null, detail: "No current project-context record is available."});
  if (invalidationRefs.length > 0) uncertainties.push({code: "ACTIVE_INVALIDATION", subject_ref: null, detail: "One or more current context dependencies require rebuild or review."});
  const mergedUncertainties = mergeNotices(uncertainties);
  const status = replay.conflicts.length > 0
    ? "CONFLICT"
    : contextRecord === null
      ? "UNAVAILABLE"
      : invalidationRefs.length > 0 || dependencyStale
        ? "STALE"
        : dependencyConflict || dependencyPartial
          ? "PARTIAL"
        : mergedUncertainties.length > 0
          ? "PARTIAL"
          : "READY";
  const recordSha256s = currentRecords.map((record) => record.record_sha256).sort(compareUtf8);
  const decisionSha256s = currentRecords.filter((record) => record.record_type === "DECISION").map((record) => record.record_sha256).sort(compareUtf8);
  const computedId = `SNAPSHOT_${canonicalDigest({binding, head: replay.head_sha256, cursor: replay.event_count, context: contextRecord?.record_sha256 ?? null, invalidations: invalidationRefs})}`;
  const snapshot = {
    schema: PROJECT_MEMORY_SNAPSHOT_SCHEMA,
    version: PROJECT_MEMORY_VERSION,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    advisory_only: true,
    acceptance_authority: false,
    snapshot_id: snapshotId ?? computedId,
    ...structuredClone(binding),
    event_ledger_head_sha256: replay.head_sha256,
    event_cursor: replay.event_count,
    context_record_sha256: contextRecord?.record_sha256 ?? null,
    project_map_sha256: projectMap?.map_sha256 ?? null,
    derived_index_sha256: derivedIndex?.index_sha256 ?? null,
    record_sha256s: recordSha256s,
    decision_sha256s: decisionSha256s,
    invalidation_sha256s: invalidationRefs,
    uncertainties: mergedUncertainties,
    conflicts: replay.conflicts,
    status,
    observed_at_utc: observedAtUtc,
    snapshot_sha256: null,
  };
  snapshot.snapshot_sha256 = canonicalDigest({...snapshot, snapshot_sha256: null});
  assertSafeRecord(snapshot, "compiled memory snapshot");
  return validateMemorySnapshot(snapshot, {binding});
}

export function validateMemorySnapshot(snapshot, {binding = null} = {}) {
  requireRecord(snapshot, "memory snapshot");
  exactKeys(snapshot, SNAPSHOT_KEYS, "memory snapshot");
  assert(snapshot.schema === PROJECT_MEMORY_SNAPSHOT_SCHEMA, "memory snapshot schema mismatch");
  assert(snapshot.version === PROJECT_MEMORY_VERSION, "memory snapshot version mismatch");
  assert(snapshot.contract_status === CONTRACT_STATUS, "memory snapshot activation status is invalid");
  assert(snapshot.visibility === CONTROL_SPACE, "memory snapshot visibility is invalid");
  assert(snapshot.advisory_only === true, "memory snapshot must be advisory-only");
  assert(snapshot.acceptance_authority === false, "memory snapshot cannot be acceptance authority");
  requireIdentifier(snapshot.snapshot_id, "memory snapshot ID");
  bindingFrom(snapshot, "memory snapshot binding");
  if (binding !== null) assertSameBinding(binding, snapshot, "memory snapshot binding");
  requireSha(snapshot.event_ledger_head_sha256, "memory snapshot ledger head");
  requireSafeInteger(snapshot.event_cursor, "memory snapshot cursor", {min: 0, max: 1000000000});
  validateSnapshotRecordRefs(snapshot);
  validateNoticeList(snapshot.uncertainties, "memory snapshot uncertainties");
  validateConflictList(snapshot.conflicts, "memory snapshot conflicts");
  requireEnum(snapshot.status, MEMORY_SNAPSHOT_STATUSES, "memory snapshot status");
  requireUtc(snapshot.observed_at_utc, "memory snapshot observation time");
  requireSha(snapshot.snapshot_sha256, "memory snapshot digest");
  assert(snapshot.snapshot_sha256 === canonicalDigest({...snapshot, snapshot_sha256: null}), "memory snapshot digest mismatch");
  if (snapshot.status === "READY") assert(snapshot.uncertainties.length === 0 && snapshot.conflicts.length === 0 && snapshot.invalidation_sha256s.length === 0, "ready memory snapshot has unresolved uncertainty");
  if (snapshot.status === "PARTIAL") assert(snapshot.uncertainties.length > 0, "partial memory snapshot lacks uncertainty");
  if (snapshot.status === "STALE") assert(snapshot.invalidation_sha256s.length > 0, "stale memory snapshot lacks invalidation");
  if (snapshot.status === "CONFLICT") assert(snapshot.conflicts.length > 0, "conflict memory snapshot lacks conflict evidence");
  if (snapshot.status === "UNAVAILABLE") assert(snapshot.context_record_sha256 === null && snapshot.uncertainties.length > 0, "unavailable memory snapshot lacks an explicit reason");
  assertPersistedRecordSafe(snapshot);
  return snapshot;
}

export function compileMemoryInvalidationSet({binding, changes}) {
  validateBinding(binding, "memory invalidation binding");
  assert(Array.isArray(changes) && changes.length > 0, "memory invalidation changes are required");
  const normalized = changes.map((change, index) => {
    requireRecord(change, `memory invalidation change ${index}`);
    exactKeys(change, ["trigger", "reasonCode", "affectedRecordSha256s", "affectedCapsuleSha256s", "action", "oldValueSha256", "newValueSha256"], `memory invalidation change ${index}`);
    requireEnum(change.trigger, INVALIDATION_TRIGGERS, `memory invalidation change ${index} trigger`);
    requireIdentifier(change.reasonCode, `memory invalidation change ${index} reason`);
    requireSortedUniqueDigests(change.affectedRecordSha256s, `memory invalidation change ${index} records`, {allowEmpty: true});
    requireSortedUniqueDigests(change.affectedCapsuleSha256s, `memory invalidation change ${index} capsules`, {allowEmpty: true});
    requireEnum(change.action, INVALIDATION_ACTIONS, `memory invalidation change ${index} action`);
    requireNullableSha(change.oldValueSha256, `memory invalidation change ${index} old value`);
    requireNullableSha(change.newValueSha256, `memory invalidation change ${index} new value`);
    assert(change.affectedRecordSha256s.length > 0 || change.affectedCapsuleSha256s.length > 0, `memory invalidation change ${index} has no affected target`);
    assertSafeRecord(change, `memory invalidation change ${index}`);
    return structuredClone(change);
  }).sort((left, right) => compareUtf8(
    `${left.trigger}\u0000${left.reasonCode}\u0000${left.oldValueSha256 ?? ""}\u0000${left.newValueSha256 ?? ""}`,
    `${right.trigger}\u0000${right.reasonCode}\u0000${right.oldValueSha256 ?? ""}\u0000${right.newValueSha256 ?? ""}`,
  ));
  return normalized.map((change) => compileMemoryInvalidationRecord({
    recordId: `INVALIDATION_${canonicalDigest({binding, change})}`,
    binding,
    trigger: change.trigger,
    reasonCode: change.reasonCode,
    affectedRecordSha256s: change.affectedRecordSha256s,
    affectedCapsuleSha256s: change.affectedCapsuleSha256s,
    action: change.action,
    oldValueSha256: change.oldValueSha256,
    newValueSha256: change.newValueSha256,
  }));
}

export function compileRoleContextCapsule({
  snapshot,
  roleRef,
  laneRef,
  selectedRecordSha256s,
  allowedScopeRefs,
  prohibitedScopeRefs,
  requiredEvidenceSha256s = [],
  uncertainties = [],
  capsuleId = null,
}) {
  validateMemorySnapshot(snapshot);
  requireIdentifier(roleRef, "role context capsule role");
  requireIdentifier(laneRef, "role context capsule lane");
  assert(snapshot.role_ref === roleRef, "role context capsule role is outside the snapshot binding");
  assert(roleRef !== "LANE_WORKER" || laneRef !== "ALL_LANES", "lane worker capsule must name one lane");
  requireSortedUniqueDigests(selectedRecordSha256s, "role context capsule selected records", {allowEmpty: true});
  requireSortedUniqueStrings(allowedScopeRefs, "role context capsule allowed scopes", {validator: requireIdentifier});
  requireSortedUniqueStrings(prohibitedScopeRefs, "role context capsule prohibited scopes", {validator: requireIdentifier});
  assert(!scopesOverlap(allowedScopeRefs, prohibitedScopeRefs), "role context capsule allowed and prohibited scopes must be disjoint");
  requireSortedUniqueDigests(requiredEvidenceSha256s, "role context capsule required evidence", {allowEmpty: true});
  validateNoticeList(uncertainties, "role context capsule uncertainties");
  for (const recordSha256 of selectedRecordSha256s) assert(snapshot.record_sha256s.includes(recordSha256), `role context capsule selected record ${recordSha256} is outside the snapshot`);
  const mergedUncertainties = mergeNotices(snapshot.uncertainties, uncertainties);
  let status = snapshot.status;
  if (selectedRecordSha256s.length === 0 && status === "READY") {
    status = "UNAVAILABLE";
    mergedUncertainties.push({code: "NO_SELECTED_CONTEXT", subject_ref: null, detail: "The role capsule has no selected canonical records."});
  }
  if (status === "READY" && mergedUncertainties.length > 0) status = "PARTIAL";
  if (snapshot.status === "STALE") status = "STALE";
  if (snapshot.status === "CONFLICT") status = "CONFLICT";
  const capsule = {
    schema: PROJECT_MEMORY_CAPSULE_SCHEMA,
    version: PROJECT_MEMORY_VERSION,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    advisory_only: true,
    acceptance_authority: false,
    capsule_id: capsuleId ?? `CAPSULE_${canonicalDigest({snapshot: snapshot.snapshot_sha256, roleRef, laneRef, selectedRecordSha256s})}`,
    role_ref: roleRef,
    lane_ref: laneRef,
    project_ref: snapshot.project_ref,
    campaign_ref: snapshot.campaign_ref,
    goal_ref: snapshot.goal_ref,
    source_commit: snapshot.source_commit,
    source_tree: snapshot.source_tree,
    source_snapshot_sha256: snapshot.source_snapshot_sha256,
    policy_sha256: snapshot.policy_sha256,
    handoff_sha256: snapshot.handoff_sha256,
    snapshot_sha256: snapshot.snapshot_sha256,
    context_record_sha256: snapshot.context_record_sha256,
    selected_record_sha256s: [...selectedRecordSha256s],
    allowed_scope_refs: [...allowedScopeRefs],
    prohibited_scope_refs: [...prohibitedScopeRefs],
    required_evidence_sha256s: [...requiredEvidenceSha256s],
    uncertainties: mergeNotices(mergedUncertainties),
    conflicts: structuredClone(snapshot.conflicts),
    status,
    capsule_sha256: null,
  };
  capsule.capsule_sha256 = canonicalDigest({...capsule, capsule_sha256: null});
  assertSafeRecord(capsule, "compiled role context capsule");
  return validateRoleContextCapsule(capsule, {snapshot});
}

export function validateRoleContextCapsule(capsule, {snapshot = null} = {}) {
  requireRecord(capsule, "role context capsule");
  exactKeys(capsule, CAPSULE_KEYS, "role context capsule");
  assert(capsule.schema === PROJECT_MEMORY_CAPSULE_SCHEMA, "role context capsule schema mismatch");
  assert(capsule.version === PROJECT_MEMORY_VERSION, "role context capsule version mismatch");
  assert(capsule.contract_status === CONTRACT_STATUS, "role context capsule activation status is invalid");
  assert(capsule.visibility === CONTROL_SPACE, "role context capsule visibility is invalid");
  assert(capsule.advisory_only === true, "role context capsule must be advisory-only");
  assert(capsule.acceptance_authority === false, "role context capsule cannot be acceptance authority");
  requireIdentifier(capsule.capsule_id, "role context capsule ID");
  bindingFrom(capsule, "role context capsule binding");
  requireIdentifier(capsule.lane_ref, "role context capsule lane");
  requireSha(capsule.snapshot_sha256, "role context capsule snapshot");
  requireNullableSha(capsule.context_record_sha256, "role context capsule context record");
  requireSortedUniqueDigests(capsule.selected_record_sha256s, "role context capsule selected records", {allowEmpty: true});
  requireSortedUniqueStrings(capsule.allowed_scope_refs, "role context capsule allowed scopes", {validator: requireIdentifier});
  requireSortedUniqueStrings(capsule.prohibited_scope_refs, "role context capsule prohibited scopes", {validator: requireIdentifier});
  assert(!scopesOverlap(capsule.allowed_scope_refs, capsule.prohibited_scope_refs), "role context capsule allowed and prohibited scopes must be disjoint");
  requireSortedUniqueDigests(capsule.required_evidence_sha256s, "role context capsule required evidence", {allowEmpty: true});
  validateNoticeList(capsule.uncertainties, "role context capsule uncertainties");
  validateConflictList(capsule.conflicts, "role context capsule conflicts");
  requireEnum(capsule.status, MEMORY_CAPSULE_STATUSES, "role context capsule status");
  requireSha(capsule.capsule_sha256, "role context capsule digest");
  assert(capsule.capsule_sha256 === canonicalDigest({...capsule, capsule_sha256: null}), "role context capsule digest mismatch");
  if (snapshot !== null) {
    validateMemorySnapshot(snapshot);
    assertSameBinding(snapshot, capsule, "role context capsule snapshot binding");
    assert(capsule.snapshot_sha256 === snapshot.snapshot_sha256, "role context capsule is bound to another snapshot");
    assert(capsule.context_record_sha256 === snapshot.context_record_sha256, "role context capsule context record mismatch");
    for (const digest of capsule.selected_record_sha256s) assert(snapshot.record_sha256s.includes(digest), `role context capsule selected record ${digest} is outside the snapshot`);
  }
  if (capsule.status === "READY") assert(capsule.uncertainties.length === 0 && capsule.conflicts.length === 0, "ready role context capsule has unresolved uncertainty");
  if (capsule.status === "PARTIAL" || capsule.status === "STALE" || capsule.status === "CONFLICT" || capsule.status === "INVALIDATED" || capsule.status === "UNAVAILABLE") assert(capsule.uncertainties.length > 0 || capsule.conflicts.length > 0, "non-ready role context capsule lacks an explicit reason");
  assertPersistedRecordSafe(capsule);
  return capsule;
}
