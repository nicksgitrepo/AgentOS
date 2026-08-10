#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_MEANINGFUL_PROGRESS_WINDOW_MINUTES,
  compileContinuousOperatingLoop,
  compileLoopInspection,
  compileRepairRecord,
  compileReplacementReceipt,
  loopDigest,
  mintTestBuildIdentity,
  readContinuousOperatingLoopRecord,
  runContinuousOperatingLoop,
  runContinuousOperatingLoopIteration,
  validateContinuousOperatingLoop,
  validateProjectBinding,
  validateLoopInspection,
  validateReplacementReceipt,
  writeContinuousOperatingLoopRecordCompareAndSwap,
} from "../control/continuous-operating-loop.mjs";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const NEXT_COMMIT = "3".repeat(40);
const NEXT_TREE = "4".repeat(40);
const INTENT = "a".repeat(64);
const NORMATIVE = "b".repeat(64);
const TAG = "v2.1rc-tb-01";
const NOW = "2026-08-05T00:15:00.000Z";
const SYNTHETIC_PROJECT_ROOT = path.join(path.sep, "fixture-project");
const UUID_PROJECT_ID = ["01234567", "89ab", "4cde", "8123", "456789abcdef"].join("-");
const FOREIGN_UUID_PROJECT_ID = ["11111111", "2222", "4333", "8444", "555555555555"].join("-");
const UUID_PROJECT_BINDING = {
  project_id: UUID_PROJECT_ID,
  host_id: "local",
  project_root: SYNTHETIC_PROJECT_ROOT,
  git_top_level: SYNTHETIC_PROJECT_ROOT,
  target: {type: "project", projectId: UUID_PROJECT_ID, environment: {type: "local"}},
};

const protectedActions = () => ({
  published: false,
  pushed: false,
  merged: false,
  deployed: false,
  spent: false,
  revealed_secrets: false,
  deleted: false,
  product_writes: false,
});

const loop = compileContinuousOperatingLoop({
  loopId: "LOOP-001",
  projectId: "PROJECT-001",
  campaignId: "CAMPAIGN-001",
  campaignVersion: "V1",
  admittedScope: ["CONTROL_PLANE"],
  sourceCommit: COMMIT,
  sourceTree: TREE,
  intentSha256: INTENT,
  buildTag: TAG,
  meaningfulProgressWindowMinutes: DEFAULT_MEANINGFUL_PROGRESS_WINDOW_MINUTES,
});

const uuidLoopInput = {
  loopId: "LOOP-UUID-001",
  projectId: UUID_PROJECT_ID,
  campaignId: "CAMPAIGN-UUID-001",
  campaignVersion: "V1",
  admittedScope: ["CONTROL_PLANE"],
  sourceCommit: COMMIT,
  sourceTree: TREE,
  intentSha256: INTENT,
  buildTag: TAG,
  projectBinding: UUID_PROJECT_BINDING,
};
const uuidLoop = compileContinuousOperatingLoop(uuidLoopInput);
validateProjectBinding(UUID_PROJECT_BINDING, UUID_PROJECT_ID);
assert.equal(uuidLoop.project_id, UUID_PROJECT_ID, "the authoritative UUID-shaped project ID must be accepted");
const uuidInspection = compileLoopInspection({
  loop: uuidLoop,
  workers: roster(),
  observedAtUtc: "2026-08-05T00:05:00.000Z",
  projectBinding: UUID_PROJECT_BINDING,
});
assert.equal(uuidInspection.project_id, UUID_PROJECT_ID, "inspection must preserve the UUID-shaped project binding");
assert.deepEqual(uuidInspection.active_worker_ids, uuidInspection.inspected_worker_ids, "UUID-bound inspection must inspect every active worker");
const uuidIteration = runContinuousOperatingLoopIteration({
  loop: uuidLoop,
  workers: roster(),
  observedAtUtc: "2026-08-05T00:05:00.000Z",
  projectBinding: UUID_PROJECT_BINDING,
});
assert.equal(uuidIteration.inspection.project_id, UUID_PROJECT_ID, "runner iteration must preserve the UUID-shaped project binding");
assert.throws(() => compileContinuousOperatingLoop({...uuidLoopInput, projectId: ""}), /nonempty/u, "empty project IDs must fail closed");
assert.throws(() => compileContinuousOperatingLoop({...uuidLoopInput, projectId: "not-a-project-id"}), /project identifier/u, "malformed project IDs must fail closed");
assert.throws(() => validateContinuousOperatingLoop({...uuidLoop, project_id: FOREIGN_UUID_PROJECT_ID}, {projectBinding: UUID_PROJECT_BINDING}), /differs/u, "foreign UUID project IDs must fail closed against the exact binding");
assert.throws(() => validateProjectBinding({...UUID_PROJECT_BINDING, target: {...UUID_PROJECT_BINDING.target, projectId: FOREIGN_UUID_PROJECT_ID}}, UUID_PROJECT_ID), /differs/u, "foreign target project IDs must fail closed");
assert.throws(() => validateProjectBinding({...UUID_PROJECT_BINDING, host_id: ""}, UUID_PROJECT_ID), /host ID/u, "empty host IDs must fail closed");
assert.throws(() => validateProjectBinding({...UUID_PROJECT_BINDING, project_root: "relative/project"}, UUID_PROJECT_ID), /absolute/u, "foreign or malformed project roots must fail closed");
assert.throws(() => validateProjectBinding({...UUID_PROJECT_BINDING, git_top_level: "/another/project"}, UUID_PROJECT_ID), /local project root differs/u, "a local binding with a foreign Git top level must fail closed");

function worker({
  workerId,
  role,
  displayName,
  persistent = false,
  evidenceKind = "HEARTBEAT",
  evidenceRecordedAt = "2026-08-05T00:00:00.000Z",
  sourceCommit = COMMIT,
  sourceTree = TREE,
  handoffPresent = true,
  signal = "NONE",
  status = "ACTIVE",
}) {
  return {
    worker_id: workerId,
    role,
    display_name: displayName,
    persistent,
    status,
    scope: ["CONTROL_PLANE"],
    source_commit: sourceCommit,
    source_tree: sourceTree,
    started_at_utc: "2026-08-05T00:00:00.000Z",
    last_meaningful_progress_at_utc: evidenceKind === "MEANINGFUL_RESULT" ? evidenceRecordedAt : null,
    evidence: {
      kind: evidenceKind,
      meaningful: evidenceKind === "MEANINGFUL_RESULT",
      source_commit: sourceCommit,
      source_tree: sourceTree,
      result_sha256: evidenceKind === "MEANINGFUL_RESULT" ? "c".repeat(64) : null,
      recorded_at_utc: evidenceRecordedAt,
    },
    handoff: handoffPresent
      ? {status: "PRESENT", typed: true, session_id: workerId === "WORKER-SECURITY" ? "SESSION-SECURITY" : `SESSION-${workerId}`, handoff_sha256: "d".repeat(64)}
      : {status: "MISSING", typed: false, session_id: null, handoff_sha256: null},
    signal,
    summary: signal === "NONE" ? "Observe the named control-plane lane." : `The named lane reports ${signal}.`,
    protected_actions: protectedActions(),
  };
}

function roster(overrides = {}) {
  return [
    worker({workerId: "INTENT-REGULATOR", role: "INTENT_REGULATOR", displayName: "Intent Regulator", persistent: true, ...overrides.regulator}),
    worker({workerId: "RUNTIME", role: "RUNTIME", displayName: "Runtime", persistent: true, ...overrides.runtime}),
    worker({workerId: "WORKER-SECURITY", role: "TEMPORARY_WORKER", displayName: `Security Worker ${TAG}`, ...overrides.worker}),
  ].sort((left, right) => left.worker_id.localeCompare(right.worker_id));
}

const immediate = compileLoopInspection({loop, workers: roster({worker: {evidenceKind: "HEARTBEAT", evidenceRecordedAt: "2026-08-05T00:05:00.000Z"}}), observedAtUtc: "2026-08-05T00:05:00.000Z"});
assert.equal(immediate.worker_reports.find((report) => report.worker_id === "WORKER-SECURITY").meaningful_progress, false);
assert.equal(immediate.worker_reports.find((report) => report.worker_id === "WORKER-SECURITY").timer_expired, false);
assert.equal(immediate.action, "CONTINUE", "a heartbeat before expiry is not a failure");

const expired = compileLoopInspection({loop, workers: roster(), observedAtUtc: NOW});
const expiredWorker = expired.worker_reports.find((report) => report.worker_id === "WORKER-SECURITY");
assert.equal(expiredWorker.progress_signal, "HEARTBEAT");
assert.equal(expiredWorker.meaningful_progress, false);
assert.equal(expiredWorker.timer_expired, true, "timer must expire without a meaningful result");
assert.equal(expiredWorker.finding_classification, "PUZZLE");
assert.equal(expired.action, "ORCHESTRATOR_REPAIR");
assert.equal(expired.route_to, "CAMPAIGN_ORCHESTRATOR");
assert.deepEqual(expired.active_worker_ids, expired.inspected_worker_ids, "every active worker must be inspected");
validateLoopInspection(expired);

const repeatedHeartbeat = compileLoopInspection({
  loop,
  workers: roster({worker: {evidenceKind: "HEARTBEAT", evidenceRecordedAt: "2026-08-05T00:14:00.000Z"}}),
  observedAtUtc: NOW,
});
assert.equal(repeatedHeartbeat.worker_reports.find((report) => report.worker_id === "WORKER-SECURITY").timer_expired, true, "non-meaningful evidence must not reset the timer");

const stale = compileLoopInspection({loop, workers: roster({worker: {sourceCommit: "9".repeat(40)}}), observedAtUtc: "2026-08-05T00:05:00.000Z"});
const staleWorker = stale.worker_reports.find((report) => report.worker_id === "WORKER-SECURITY");
assert.equal(staleWorker.source_matches, false);
assert.equal(staleWorker.finding_classification, "TRUE_BLOCKER");
const staleMeaningful = compileLoopInspection({loop, workers: roster({worker: {evidenceKind: "MEANINGFUL_RESULT", sourceCommit: "9".repeat(40)}}), observedAtUtc: "2026-08-05T00:05:00.000Z"});
assert.equal(staleMeaningful.worker_reports.find((report) => report.worker_id === "WORKER-SECURITY").meaningful_progress, false, "stale-source evidence must not count as meaningful");
assert.equal(stale.route_to, "INTENT_REGULATOR");
assert.equal(runContinuousOperatingLoopIteration({loop, workers: roster({worker: {sourceCommit: "9".repeat(40)}}), observedAtUtc: "2026-08-05T00:05:00.000Z"}).status, "INTENT_REGULATOR_REVIEW_REQUIRED", "true blockers must stop at Intent Regulator review");

const changedSource = compileLoopInspection({
  loop,
  workers: roster(),
  observedAtUtc: "2026-08-05T00:05:00.000Z",
  observedSourceCommit: NEXT_COMMIT,
  observedSourceTree: NEXT_TREE,
});
assert.equal(changedSource.goal_disposition, "SUCCEEDED_BY_REASSESSMENT");
assert.equal(changedSource.action, "CLOSE_GOAL_SUCCEEDED_BY_REASSESSMENT");
assert.equal(changedSource.continuation_allowed, false);

const predecessor = {
  worker_id: "WORKER-SECURITY",
  role: "TEMPORARY_WORKER",
  display_name: `Security Worker ${TAG}`,
  session_id: "SESSION-SECURITY",
  handoff_sha256: "d".repeat(64),
};
const failedPatch = compileRepairRecord({
  classification: "PUZZLE",
  preservedEvidenceSha256: expired.preserved_evidence_sha256,
  rootCause: {category: "TIMER_LIVENESS", summary: "The worker emitted heartbeats without a result.", contributing_factors: ["HEARTBEAT_ONLY"]},
  status: "FAILED",
  sourceBefore: {commit: COMMIT, tree: TREE},
  sourceAfter: {commit: COMMIT, tree: TREE},
  patchReceiptSha256: "e".repeat(64),
});
const failedRun = runContinuousOperatingLoopIteration({loop, workers: roster(), observedAtUtc: NOW, predecessor, repair: failedPatch});
assert.equal(failedRun.status, "REPAIR_FAILED_RETAINED");
assert.equal(failedRun.repair_record.outcome, "REPAIR_FAILED_RETAINED");
assert.equal(failedRun.repair_record.replacement_goal, null);
assert.throws(
  () => runContinuousOperatingLoopIteration({
    loop,
    workers: roster(),
    observedAtUtc: NOW,
    observedSourceCommit: NEXT_COMMIT,
    observedSourceTree: NEXT_TREE,
    predecessor,
    repair: failedPatch,
    applyPatch: () => { throw new Error("stale reassessment repair must not run"); },
  }),
  /source or intent reassessment/u,
  "source reassessment must reject stale repair and replacement inputs"
);

const privacySafeFailure = runContinuousOperatingLoopIteration({
  loop,
  workers: roster(),
  observedAtUtc: NOW,
  predecessor,
  applyPatch: () => {
    const privateMarker = ["/", "fixture", "/", "private", "/", "root"].join("");
    const secretMarker = ["host", "-", "material"].join("");
    const identityMarker = ["TASK", "-", "IDENTITY"].join("");
    throw new Error(`${privateMarker} ${secretMarker} ${identityMarker}`);
  },
});
assert.equal(privacySafeFailure.status, "REPAIR_FAILED_RETAINED");
assert(!JSON.stringify(privacySafeFailure.repair_record).includes(["/", "fixture", "/", "private", "/", "root"].join("")), "persisted patch failure leaked a private path");
assert(!JSON.stringify(privacySafeFailure.repair_record).includes(["host", "-", "material"].join("")), "persisted patch failure leaked host text");
assert(!JSON.stringify(privacySafeFailure.repair_record).includes(["TASK", "-", "IDENTITY"].join("")), "persisted patch failure leaked an identity");

assert.throws(
  () => runContinuousOperatingLoopIteration({loop, workers: roster(), observedAtUtc: NOW, repair: failedPatch}),
  /predecessor typed handoff/u,
  "a replacement path must reject a missing predecessor handoff"
);

const appliedTestBuild = mintTestBuildIdentity({
  sourceCommit: NEXT_COMMIT,
  sourceTree: NEXT_TREE,
  changedPaths: ["control/continuous-operating-loop.mjs"],
  normativeBindingSha256: NORMATIVE,
  predecessorHandoffSha256: predecessor.handoff_sha256,
});
const appliedPatch = compileRepairRecord({
  classification: "PUZZLE",
  preservedEvidenceSha256: expired.preserved_evidence_sha256,
  rootCause: {category: "TIMER_LIVENESS", summary: "The progress contract accepted timer activity without useful work.", contributing_factors: ["HEARTBEAT_ONLY"]},
  status: "APPLIED",
  changedPaths: ["control/continuous-operating-loop.mjs"],
  sourceBefore: {commit: COMMIT, tree: TREE},
  sourceAfter: {commit: NEXT_COMMIT, tree: NEXT_TREE},
  testBuildIdentity: appliedTestBuild,
  normativeBindingSha256: NORMATIVE,
  patchReceiptSha256: "f".repeat(64),
});
function hostReceiptsFor(sessionId) {
  return Object.fromEntries([
    "create_thread", "pin", "send", "wait", "read", "unpin", "archive", "post_close_read", "active_list_absent",
  ].map((operation) => {
    const receipt = {
      operation,
      status: "OBSERVED",
      session_id: sessionId,
      observed_at_utc: NOW,
      meaningful_progress: operation === "read",
      source_commit: NEXT_COMMIT,
      source_tree: NEXT_TREE,
      typed_handoff_sha256: operation === "read" ? "1".repeat(64) : null,
      receipt_sha256: null,
    };
    receipt.receipt_sha256 = loopDigest({...receipt, receipt_sha256: null});
    return [operation, receipt];
  }));
}
const replacementGoalAndReceipt = runContinuousOperatingLoopIteration({
  loop,
  workers: roster(),
  observedAtUtc: NOW,
  predecessor,
  repair: appliedPatch,
  createReplacement: ({goal}) => compileReplacementReceipt({
    sessionId: "SESSION-SECURITY-REPLACEMENT",
    predecessor,
    goal,
    hostReceipts: hostReceiptsFor("SESSION-SECURITY-REPLACEMENT"),
    typedHandoffSha256: "1".repeat(64),
    model: "ADMITTED-MODEL",
    reasoningEffort: "max",
  }),
  independentClearance: {
    status: "PASS",
    independent: true,
    auditor_id: loop.auditor_id,
    source_commit: NEXT_COMMIT,
    source_tree: NEXT_TREE,
    handoff_sha256: "2".repeat(64),
    receipt_sha256: "3".repeat(64),
  },
});
assert.equal(replacementGoalAndReceipt.status, "REPLACED_AND_CLEARED");
assert.equal(replacementGoalAndReceipt.continuation_allowed, true);
assert.equal(replacementGoalAndReceipt.repair_record.replacement_receipt.session_id, "SESSION-SECURITY-REPLACEMENT");
assert.equal(replacementGoalAndReceipt.repair_record.replacement_receipt.display_name, `TEMPORARY_WORKER replacement ${TAG}`);
assert.equal(replacementGoalAndReceipt.repair_record.replacement_receipt.build_tag, TAG);

const staleRepair = compileRepairRecord({
  classification: "PUZZLE",
  preservedEvidenceSha256: "9".repeat(64),
  rootCause: {category: "TIMER_LIVENESS", summary: "A stale repair must not cross an inspection boundary.", contributing_factors: []},
  status: "APPLIED",
  changedPaths: ["control/continuous-operating-loop.mjs"],
  sourceBefore: {commit: COMMIT, tree: TREE},
  sourceAfter: {commit: NEXT_COMMIT, tree: NEXT_TREE},
  testBuildIdentity: appliedTestBuild,
  normativeBindingSha256: NORMATIVE,
  patchReceiptSha256: "8".repeat(64),
});
assert.throws(() => runContinuousOperatingLoopIteration({loop, workers: roster(), observedAtUtc: NOW, predecessor, repair: staleRepair}), /evidence/u, "stale repair evidence must not mint a replacement");

const malformedHost = runContinuousOperatingLoopIteration({
  loop,
  workers: roster(),
  observedAtUtc: NOW,
  predecessor,
  repair: appliedPatch,
  createReplacement: ({goal}) => {
    const valid = compileReplacementReceipt({sessionId: "SESSION-MALFORMED", predecessor, goal, hostReceipts: hostReceiptsFor("SESSION-MALFORMED"), typedHandoffSha256: "1".repeat(64), model: "ADMITTED-MODEL", reasoningEffort: "max"});
    return {...valid, receipts: {...valid.receipts, archive: {status: "OBSERVED", receipt_sha256: null}}};
  },
});
assert.equal(malformedHost.status, "REPLACEMENT_BLOCKED");
assert.equal(malformedHost.repair_record.outcome, "REPLACEMENT_BLOCKED");
assert.equal(malformedHost.repair_record.host_failure.phase, "CREATE_REPLACEMENT");
assert.equal(malformedHost.repair_record.replacement_receipt, null);

const independentClearanceFailure = runContinuousOperatingLoopIteration({
  loop,
  workers: roster(),
  observedAtUtc: NOW,
  predecessor,
  repair: appliedPatch,
  createReplacement: ({goal}) => compileReplacementReceipt({sessionId: "SESSION-CLEARANCE-FAILURE", predecessor, goal, hostReceipts: hostReceiptsFor("SESSION-CLEARANCE-FAILURE"), typedHandoffSha256: "1".repeat(64), model: "ADMITTED-MODEL", reasoningEffort: "max"}),
  independentClearance: {
    status: "FAILURE",
    independent: true,
    auditor_id: loop.auditor_id,
    source_commit: NEXT_COMMIT,
    source_tree: NEXT_TREE,
    handoff_sha256: "2".repeat(64),
    receipt_sha256: "3".repeat(64),
  },
});
assert.equal(independentClearanceFailure.status, "REPLACEMENT_BLOCKED");
assert.equal(independentClearanceFailure.repair_record.host_failure.phase, "INDEPENDENT_CLEARANCE");
assert.equal(independentClearanceFailure.repair_record.replacement_receipt.session_id, "SESSION-CLEARANCE-FAILURE");
assert.equal(independentClearanceFailure.repair_record.independent_clearance.status, "FAILURE");

const malformedClearance = runContinuousOperatingLoopIteration({
  loop,
  workers: roster(),
  observedAtUtc: NOW,
  predecessor,
  repair: appliedPatch,
  createReplacement: ({goal}) => compileReplacementReceipt({sessionId: "SESSION-MALFORMED-CLEARANCE", predecessor, goal, hostReceipts: hostReceiptsFor("SESSION-MALFORMED-CLEARANCE"), typedHandoffSha256: "1".repeat(64), model: "ADMITTED-MODEL", reasoningEffort: "max"}),
  independentClearance: {status: "FAILURE"},
});
assert.equal(malformedClearance.status, "REPLACEMENT_BLOCKED");
assert.equal(malformedClearance.repair_record.host_failure.phase, "INDEPENDENT_CLEARANCE");
assert.equal(malformedClearance.repair_record.replacement_receipt.session_id, "SESSION-MALFORMED-CLEARANCE");
assert.equal(malformedClearance.repair_record.independent_clearance, null);

const timerEvents = [];
const timerRun = await runContinuousOperatingLoop({
  once: true,
  intervalMinutes: DEFAULT_MEANINGFUL_PROGRESS_WINDOW_MINUTES,
  observe: () => ({loop, workers: roster(), observedAtUtc: "2026-08-05T00:15:00.000Z"}),
  onIteration: (result) => timerEvents.push(result.status),
});
assert.equal(timerRun.length, 1, "background runner must perform one requested inspection");
assert.deepEqual(timerEvents, [timerRun[0].status], "background runner must report its iteration");
assert.equal(timerRun[0].status, "REPAIR_REQUIRED", "background runner must expose the timer finding");
await assert.rejects(
  () => runContinuousOperatingLoop({
    once: true,
    intervalMinutes: 0,
    observe: () => ({loop, workers: roster(), observedAtUtc: NOW}),
  }),
  /interval/u,
  "background runner must reject an invalid cadence"
);

const hardLoop = {...loop, loop_id: "LOOP-HARD", hard_stop: true};
validateContinuousOperatingLoop(hardLoop);
assert.equal(runContinuousOperatingLoopIteration({loop: hardLoop, workers: roster(), observedAtUtc: "2026-08-05T00:05:00.000Z"}).status, "HARD_STOPPED");
assert.throws(
  () => compileLoopInspection({loop: hardLoop, workers: roster(), observedAtUtc: "2026-08-05T00:05:00.000Z", continuationAfterHardStop: true}),
  /after hard stop/u,
  "continuation after a hard stop must fail closed"
);

assert.throws(() => validateContinuousOperatingLoop({...loop, source_commit: "1".repeat(39)}), /exact Git object/u, "short source identity must fail closed");
assert.throws(() => compileLoopInspection({loop, workers: roster({worker: {displayName: "Security Worker"}}), observedAtUtc: "2026-08-05T00:05:00.000Z"}), /exact build tag/u, "temporary worker name must include version and test-build");
assert.throws(() => compileReplacementReceipt({sessionId: "SESSION-BAD", predecessor, goal: replacementGoalAndReceipt.repair_record.replacement_goal, hostReceipts: {...hostReceiptsFor("SESSION-BAD"), archive: {status: "OBSERVED", receipt_sha256: null}}, typedHandoffSha256: "1".repeat(64), model: "ADMITTED-MODEL", reasoningEffort: "max"}), /fields mismatch|SHA-256/u, "missing host closure proof must fail closed");

const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-continuous-loop-"));
try {
  const write = writeContinuousOperatingLoopRecordCompareAndSwap({authorityRoot, recordPath: "loop/inspection.json", record: expired});
  assert.equal(write.record_sha256, expired.inspection_sha256);
  assert.equal(readContinuousOperatingLoopRecord({authorityRoot, recordPath: "loop/inspection.json"}).inspection_sha256, expired.inspection_sha256);
  assert.throws(() => writeContinuousOperatingLoopRecordCompareAndSwap({authorityRoot, recordPath: "loop/inspection.json", expectedRecordSha256: "9".repeat(64), record: expired}), /stale/u);
  const symlink = path.join(authorityRoot, "loop", "symlink.json");
  fs.symlinkSync(path.join(authorityRoot, "loop", "inspection.json"), symlink);
  assert.throws(() => readContinuousOperatingLoopRecord({authorityRoot, recordPath: "loop/symlink.json"}), /symlink/u);
} finally {
  fs.rmSync(authorityRoot, {recursive: true, force: true});
}

console.log("PASS continuous operating loop: 15-minute meaningful-progress timer, role separation, hostile boundaries, source/intent reassessment, failed-patch retention, named replacement, host closure, independent clearance, and CAS records verified");
