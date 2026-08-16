/*
 * Project-agnostic scheduler/process provenance gate.
 *
 * A durable session may remain RUNNING only when its live PID is bound to
 * exactly one registered scheduler job, requester, root, and hold.  This
 * module is pure reconciliation: it never stops a process, starts a job, or
 * writes a registry.  Callers must emit and persist the cleanup RCA returned
 * by compileNoncanonicalCleanupRca before stopping an orphaned process.
 */

import {assertPersistedRecordSafe, canonicalDigest} from "./content-addressing.mjs";

export const DURABLE_SESSION_PROCESS_PROVENANCE_SCHEMA = "agentos.durable_session_process_provenance.v1";
export const DURABLE_SESSION_PROCESS_PROVENANCE_VERSION = 1;
export const DURABLE_SESSION_STATUSES = Object.freeze(["RUNNING", "STOPPED", "FAILED"]);
export const DURABLE_SESSION_HEARTBEAT_STATUSES = Object.freeze(["RUNNING", "STOPPED", "UNKNOWN"]);
export const SCHEDULER_REGISTRY_STATUSES = Object.freeze(["REGISTERED", "RELEASED"]);
export const CLEANUP_RCA_STATUSES = Object.freeze(["READY_TO_STOP"]);
export const CLEANUP_RCA_REASONS = Object.freeze([
  "ORPHANED_PP1_RUNNING",
  "MISSING_SCHEDULER_REGISTRY",
  "DUPLICATE_SCHEDULER_REGISTRY",
  "STALE_SCHEDULER_REGISTRY",
  "LIVE_PID_REGISTRY_MISMATCH",
  "DEAD_SESSION_RECORD",
]);
export const PROVENANCE_STATUSES = Object.freeze(["PASS", "REPAIR_REQUIRED", "CLEANUP_RCA_REQUIRED"]);
export const PROVENANCE_ACTIONS = Object.freeze([
  "CONTINUE",
  "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE",
  "EMIT_CLEANUP_RCA_BEFORE_STOP",
  "STOP_AFTER_CLEANUP_RCA_AND_RETAIN_EVIDENCE",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const OPAQUE_REF = /^opaque:[a-z][a-z0-9._-]*:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const SESSION_KEYS = [
  "session_id", "campaign_id", "pid", "pgid", "ppid", "status", "heartbeat_status", "process_alive",
  "source_commit", "source_tree", "observed_at_utc",
];
const REGISTRY_KEYS = [
  "session_id", "pid", "job_id", "requester_id", "root_ref", "hold_id", "status", "registry_observed_at_utc",
];
const RCA_KEYS = [
  "schema", "version", "status", "session_id", "pid", "reason", "observed_at_utc", "evidence_sha256", "rca_sha256",
];
const FINDING_KEYS = ["code", "session_id", "pid", "detail", "required_action"];
const RESULT_KEYS = [
  "schema", "version", "status", "next_action", "observed_at_utc", "session_snapshot_sha256",
  "registry_snapshot_sha256", "live_session_ids", "findings", "cleanup_rcas", "result_sha256",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(!value.includes("\\"), `${label} contains a private path separator`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireSourceIdentity(value, label) {
  assert(typeof value === "string" && (GIT_OBJECT.test(value) || SHA256.test(value)), `${label} must be a source identity`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function requireOpaqueRef(value, label) {
  assert(typeof value === "string" && OPAQUE_REF.test(value), `${label} must be an opaque reference`);
}

function requireNonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function digestWithout(value, field) {
  const copy = structuredClone(value);
  copy[field] = null;
  return canonicalDigest(copy);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const ordered = [...values].sort();
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

export function validateDurableSessionSnapshot(snapshot) {
  exactKeys(snapshot, SESSION_KEYS, "durable session snapshot");
  requireIdentifier(snapshot.session_id, "durable session ID");
  requireIdentifier(snapshot.campaign_id, "durable session campaign ID");
  for (const [value, label] of [[snapshot.pid, "durable session PID"], [snapshot.pgid, "durable session PGID"], [snapshot.ppid, "durable session PPID"]]) requireNonNegativeInteger(value, label);
  assert(DURABLE_SESSION_STATUSES.includes(snapshot.status), "durable session status is invalid");
  assert(DURABLE_SESSION_HEARTBEAT_STATUSES.includes(snapshot.heartbeat_status), "durable session heartbeat status is invalid");
  assert(typeof snapshot.process_alive === "boolean", "durable session process liveness is invalid");
  requireSourceIdentity(snapshot.source_commit, "durable session source commit");
  requireSourceIdentity(snapshot.source_tree, "durable session source tree");
  requireUtc(snapshot.observed_at_utc, "durable session observation time");
  return snapshot;
}

export function validateSchedulerRegistryEntry(entry) {
  exactKeys(entry, REGISTRY_KEYS, "scheduler registry entry");
  requireIdentifier(entry.session_id, "scheduler registry session ID");
  requireNonNegativeInteger(entry.pid, "scheduler registry PID");
  requireIdentifier(entry.job_id, "scheduler registry job ID");
  requireIdentifier(entry.requester_id, "scheduler registry requester ID");
  requireOpaqueRef(entry.root_ref, "scheduler registry root reference");
  requireIdentifier(entry.hold_id, "scheduler registry hold ID");
  assert(SCHEDULER_REGISTRY_STATUSES.includes(entry.status), "scheduler registry status is invalid");
  requireUtc(entry.registry_observed_at_utc, "scheduler registry observation time");
  return entry;
}

export function validateNoncanonicalCleanupRca(rca) {
  exactKeys(rca, RCA_KEYS, "noncanonical cleanup RCA");
  assert(rca.schema === "agentos.scheduler_noncanonical_session_cleanup_rca.v1" && rca.version === 1, "cleanup RCA identity is invalid");
  assert(CLEANUP_RCA_STATUSES.includes(rca.status), "cleanup RCA status is invalid");
  requireIdentifier(rca.session_id, "cleanup RCA session ID");
  requireNonNegativeInteger(rca.pid, "cleanup RCA PID");
  assert(CLEANUP_RCA_REASONS.includes(rca.reason), "cleanup RCA reason is invalid");
  requireUtc(rca.observed_at_utc, "cleanup RCA observation time");
  requireSha(rca.evidence_sha256, "cleanup RCA evidence digest");
  requireSha(rca.rca_sha256, "cleanup RCA digest");
  assert(rca.rca_sha256 === digestWithout(rca, "rca_sha256"), "cleanup RCA digest mismatch");
  assertPersistedRecordSafe(rca);
  return rca;
}

function validateFinding(finding) {
  exactKeys(finding, FINDING_KEYS, "provenance finding");
  requireIdentifier(finding.code, "provenance finding code");
  requireIdentifier(finding.session_id, "provenance finding session ID");
  requireNonNegativeInteger(finding.pid, "provenance finding PID");
  requireString(finding.detail, "provenance finding detail");
  requireIdentifier(finding.required_action, "provenance finding required action");
}

export function validateDurableSessionProcessProvenance(result) {
  exactKeys(result, RESULT_KEYS, "durable session process provenance result");
  assert(result.schema === DURABLE_SESSION_PROCESS_PROVENANCE_SCHEMA && result.version === DURABLE_SESSION_PROCESS_PROVENANCE_VERSION, "provenance result identity is invalid");
  assert(PROVENANCE_STATUSES.includes(result.status), "provenance result status is invalid");
  assert(PROVENANCE_ACTIONS.includes(result.next_action), "provenance result next action is invalid");
  requireUtc(result.observed_at_utc, "provenance result observation time");
  requireSha(result.session_snapshot_sha256, "provenance session snapshot digest");
  requireSha(result.registry_snapshot_sha256, "provenance registry snapshot digest");
  sortedUnique(result.live_session_ids, "provenance live session IDs");
  assert(Array.isArray(result.findings), "provenance findings must be an array");
  result.findings.forEach(validateFinding);
  assert(Array.isArray(result.cleanup_rcas), "provenance cleanup RCAs must be an array");
  result.cleanup_rcas.forEach(validateNoncanonicalCleanupRca);
  requireSha(result.result_sha256, "provenance result digest");
  assert(result.result_sha256 === digestWithout(result, "result_sha256"), "provenance result digest mismatch");
  if (result.status === "PASS") {
    assert(result.findings.length === 0 && result.next_action === "CONTINUE", "passing provenance result has unresolved findings");
  }
  if (result.status === "CLEANUP_RCA_REQUIRED") assert(result.findings.length > 0 && result.next_action === "EMIT_CLEANUP_RCA_BEFORE_STOP", "cleanup RCA hold is incomplete");
  if (result.status === "REPAIR_REQUIRED") assert(result.findings.length > 0, "repair result has no findings");
  assertPersistedRecordSafe(result);
  return result;
}

function orderedSnapshots(snapshots) {
  assert(Array.isArray(snapshots), "durable session snapshots are required");
  const ordered = snapshots.map((snapshot) => validateDurableSessionSnapshot(snapshot)).sort((left, right) => left.session_id.localeCompare(right.session_id));
  assert(new Set(ordered.map((snapshot) => snapshot.session_id)).size === ordered.length, "durable session snapshots are duplicated");
  return ordered;
}

function orderedRegistryEntries(registryEntries) {
  assert(Array.isArray(registryEntries), "scheduler registry entries are required");
  return registryEntries.map((entry) => validateSchedulerRegistryEntry(entry)).sort((left, right) => `${left.session_id}:${left.job_id}`.localeCompare(`${right.session_id}:${right.job_id}`));
}

function pushFinding(findings, finding) {
  const key = `${finding.code}:${finding.session_id}:${finding.pid}`;
  if (!findings.some((entry) => `${entry.code}:${entry.session_id}:${entry.pid}` === key)) findings.push(finding);
}

export function compileNoncanonicalCleanupRca({snapshot, reason, observedAtUtc = snapshot?.observed_at_utc} = {}) {
  validateDurableSessionSnapshot(snapshot);
  assert(CLEANUP_RCA_REASONS.includes(reason), "cleanup RCA reason is invalid");
  requireUtc(observedAtUtc, "cleanup RCA observation time");
  const rca = {
    schema: "agentos.scheduler_noncanonical_session_cleanup_rca.v1",
    version: 1,
    status: "READY_TO_STOP",
    session_id: snapshot.session_id,
    pid: snapshot.pid,
    reason,
    observed_at_utc: observedAtUtc,
    evidence_sha256: canonicalDigest(snapshot),
    rca_sha256: null,
  };
  rca.rca_sha256 = digestWithout(rca, "rca_sha256");
  return validateNoncanonicalCleanupRca(rca);
}

export function compileDurableSessionProcessProvenance({snapshots, registryEntries, cleanupRcas = [], observedAtUtc} = {}) {
  requireUtc(observedAtUtc, "provenance observation time");
  const ordered = orderedSnapshots(snapshots);
  const registry = orderedRegistryEntries(registryEntries);
  const rcas = cleanupRcas.map((rca) => validateNoncanonicalCleanupRca(rca)).sort((left, right) => left.session_id.localeCompare(right.session_id));
  const live = ordered.filter((snapshot) => snapshot.status === "RUNNING" && snapshot.process_alive === true);
  const findings = [];
  const liveIds = live.map((snapshot) => snapshot.session_id);
  const snapshotById = new Map(ordered.map((snapshot) => [snapshot.session_id, snapshot]));

  for (const snapshot of ordered) {
    const matches = registry.filter((entry) => entry.session_id === snapshot.session_id);
    const liveProcess = snapshot.status === "RUNNING" && snapshot.process_alive === true;
    if (liveProcess && snapshot.ppid === 1) {
      pushFinding(findings, {code: "ORPHANED_PP1_RUNNING", session_id: snapshot.session_id, pid: snapshot.pid, detail: "A live durable session has PPID 1 and is outside a verified scheduler parent chain.", required_action: "EMIT_CLEANUP_RCA_BEFORE_STOP"});
    }
    if (liveProcess && matches.length === 0) {
      pushFinding(findings, {code: "MISSING_SCHEDULER_REGISTRY", session_id: snapshot.session_id, pid: snapshot.pid, detail: "The live durable session has no registered scheduler job, requester, root, and hold tuple.", required_action: "EMIT_CLEANUP_RCA_BEFORE_STOP"});
    }
    if (liveProcess && matches.length > 1) {
      pushFinding(findings, {code: "DUPLICATE_SCHEDULER_REGISTRY", session_id: snapshot.session_id, pid: snapshot.pid, detail: "The live durable session reconciles to more than one scheduler registry entry.", required_action: "EMIT_CLEANUP_RCA_BEFORE_STOP"});
    }
    if (matches.length === 1) {
      const [entry] = matches;
      if (entry.status !== "REGISTERED") {
        pushFinding(findings, {code: "STALE_SCHEDULER_REGISTRY", session_id: snapshot.session_id, pid: snapshot.pid, detail: "The scheduler registry entry is released or stale for the observed session.", required_action: liveProcess ? "EMIT_CLEANUP_RCA_BEFORE_STOP" : "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE"});
      } else if (entry.pid !== snapshot.pid) {
        pushFinding(findings, {code: "LIVE_PID_REGISTRY_MISMATCH", session_id: snapshot.session_id, pid: snapshot.pid, detail: "The registered scheduler PID does not match the observed durable session PID.", required_action: liveProcess ? "EMIT_CLEANUP_RCA_BEFORE_STOP" : "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE"});
      } else if (!liveProcess && snapshot.status === "STOPPED") {
        pushFinding(findings, {code: "STALE_SCHEDULER_REGISTRY", session_id: snapshot.session_id, pid: snapshot.pid, detail: "A stopped durable session still has a registered scheduler tuple.", required_action: "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE"});
      }
    }
    if (snapshot.status === "RUNNING" && snapshot.process_alive === false) {
      pushFinding(findings, {code: "DEAD_SESSION_RECORD", session_id: snapshot.session_id, pid: snapshot.pid, detail: "The durable session record remains RUNNING after its process disappeared.", required_action: "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE"});
    }
    if (snapshot.status !== "RUNNING" && snapshot.process_alive === true) {
      pushFinding(findings, {code: "LIVE_PROCESS_STATUS_MISMATCH", session_id: snapshot.session_id, pid: snapshot.pid, detail: "A live process is represented by a non-RUNNING durable session record.", required_action: "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE"});
    }
  }

  for (const entry of registry) {
    const snapshot = snapshotById.get(entry.session_id);
    if (entry.status === "REGISTERED" && (snapshot === undefined || snapshot.status !== "RUNNING" || snapshot.process_alive !== true)) {
      pushFinding(findings, {code: "STALE_SCHEDULER_REGISTRY", session_id: entry.session_id, pid: entry.pid, detail: "A registered scheduler tuple has no matching live durable session.", required_action: "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE"});
    }
  }

  findings.sort((left, right) => `${left.session_id}:${left.code}:${left.pid}`.localeCompare(`${right.session_id}:${right.code}:${right.pid}`));
  const affectedLiveIds = new Set(findings.filter((finding) => liveIds.includes(finding.session_id)).map((finding) => finding.session_id));
  const rcaBySession = new Map(rcas.map((rca) => [`${rca.session_id}:${rca.pid}`, rca]));
  const missingRca = [...affectedLiveIds].some((sessionId) => {
    const snapshot = snapshotById.get(sessionId);
    const rca = rcaBySession.get(`${sessionId}:${snapshot.pid}`);
    return rca === undefined || rca.evidence_sha256 !== canonicalDigest(snapshot);
  });
  const status = findings.length === 0 ? "PASS" : missingRca ? "CLEANUP_RCA_REQUIRED" : "REPAIR_REQUIRED";
  const nextAction = status === "PASS"
    ? "CONTINUE"
    : status === "CLEANUP_RCA_REQUIRED"
      ? "EMIT_CLEANUP_RCA_BEFORE_STOP"
      : affectedLiveIds.size > 0
        ? "STOP_AFTER_CLEANUP_RCA_AND_RETAIN_EVIDENCE"
        : "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE";
  const result = {
    schema: DURABLE_SESSION_PROCESS_PROVENANCE_SCHEMA,
    version: DURABLE_SESSION_PROCESS_PROVENANCE_VERSION,
    status,
    next_action: nextAction,
    observed_at_utc: observedAtUtc,
    session_snapshot_sha256: canonicalDigest(ordered),
    registry_snapshot_sha256: canonicalDigest(registry),
    live_session_ids: liveIds,
    findings,
    cleanup_rcas: rcas,
    result_sha256: null,
  };
  result.result_sha256 = digestWithout(result, "result_sha256");
  return validateDurableSessionProcessProvenance(result);
}
