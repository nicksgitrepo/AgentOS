#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  RAPID_PROTOTYPE_CHANGED_PATHS,
  RAPID_PROTOTYPE_PLAN_DIGESTS,
  RAPID_PROTOTYPE_ROLE,
  runRapidPrototype,
} from "../control/rapid-prototype/index.mjs";
import {scanPublicPayload} from "../control/rapid-prototype/security-privacy.mjs";

const SOURCE = Object.freeze({
  project_id: "rapid-slice-project",
  cwd: "rapid-slice-root",
  git_top_level: "rapid-slice-root",
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
});

const ROLE_ADMISSION = Object.freeze({
  role: RAPID_PROTOTYPE_ROLE,
  admittedRoles: [RAPID_PROTOTYPE_ROLE],
  sessionIdentity: {
    sessionId: "rapid-slice-builder-session",
    projectId: SOURCE.project_id,
    cwd: SOURCE.cwd,
    verified: true,
  },
  expectedProject: SOURCE.project_id,
  expectedCwd: SOURCE.cwd,
  topology: "INDEPENDENT_SIBLING_SESSION",
});

const THREAD_ID = "rapid-slice-builder-thread";
const HOST_ID = "rapid-slice-builder-host";
const CLOSEOUT_EVIDENCE = Object.freeze({
  PERSIST_HANDOFF: `digest:${"1".repeat(64)}`,
  AUDIT_CANDIDATE: `digest:${"2".repeat(64)}`,
  INTEGRATE_ACCEPTED_WORK: `digest:${"3".repeat(64)}`,
  CLOSE_STALE_WORKTREE: `digest:${"4".repeat(64)}`,
  REMOVE_ACTIVE_TASK_SCOPE: `digest:${"5".repeat(64)}`,
  MARK_CHAT_OUT_OF_SCOPE: `digest:${"6".repeat(64)}`,
});

function makeHost(calls) {
  return {
    async set_thread_pinned(payload) {
      calls.push(["set_thread_pinned", structuredClone(payload)]);
      return {
        threadId: payload.threadId,
        pinned: false,
        operation: "set_thread_pinned",
      };
    },
    async set_thread_archived(payload) {
      calls.push(["set_thread_archived", structuredClone(payload)]);
      return {
        threadId: payload.threadId,
        hostId: payload.hostId,
        archived: true,
        operation: "set_thread_archived",
      };
    },
    async list_threads(payload) {
      calls.push(["list_threads", structuredClone(payload)]);
      return {
        operation: "list_threads",
        active_roster: [],
      };
    },
  };
}

function makeRoster() {
  return [{
    threadId: THREAD_ID,
    hostId: HOST_ID,
    active: true,
    pinned: true,
    archived: false,
    status: "ACTIVE",
  }];
}

function baseInput(calls = []) {
  return {
    sourceBinding: {
      expected: SOURCE,
      observed: structuredClone(SOURCE),
    },
    roleAdmission: ROLE_ADMISSION,
    evidenceSourceReadback: {
      readbackStatus: "MATCH",
      pwd: SOURCE.cwd,
      gitTopLevel: SOURCE.git_top_level,
      head: SOURCE.source_commit,
      tree: SOURCE.source_tree,
      gitStatus: " M owner-change",
    },
    evidenceProjectIdentity: {
      projectId: SOURCE.project_id,
      projectRoot: SOURCE.cwd,
      gitTopLevel: SOURCE.git_top_level,
      environment: "LOCAL_PROJECT",
    },
    host_authority: {
      authority: "NATIVE_SESSION_HOST_READBACK",
      status: "MATCH",
      verified: true,
      project_id: SOURCE.project_id,
      cwd: SOURCE.cwd,
      project_root: SOURCE.cwd,
      pwd: SOURCE.cwd,
      git_top_level: SOURCE.git_top_level,
      head: SOURCE.source_commit,
      tree: SOURCE.source_tree,
      role: RAPID_PROTOTYPE_ROLE,
      session_id: ROLE_ADMISSION.sessionIdentity.sessionId,
      thread_id: THREAD_ID,
      host_id: HOST_ID,
    },
    closure: {
      threadId: THREAD_ID,
      hostId: HOST_ID,
      activeRoster: makeRoster(),
      host: makeHost(calls),
      universalCloseoutEvidence: CLOSEOUT_EVIDENCE,
    },
  };
}

const calls = [];
const input = baseInput(calls);
const ready = await runRapidPrototype(input);

const withoutAuthority = {...input};
delete withoutAuthority.host_authority;
const unproven = await runRapidPrototype(withoutAuthority);
assert.equal(unproven.status, "UNAVAILABLE");
assert.deepEqual(unproven.evidence_authority, {status: "UNAVAILABLE", verified: false});
assert.equal(unproven.surface.status, "unavailable");
assert.equal(unproven.closure.status, "NOT_RUN");

assert.equal(ready.schema, "agentos.rapid_prototype_slice.v1");
assert.equal(ready.status, "READY_FOR_INDEPENDENT_CLEARANCE");
assert.equal(ready.accepted, false, "the builder must not claim independent acceptance");
assert.equal(ready.role, RAPID_PROTOTYPE_ROLE);
assert.deepEqual(ready.changed_paths, [...RAPID_PROTOTYPE_CHANGED_PATHS]);
assert.deepEqual(ready.digests, RAPID_PROTOTYPE_PLAN_DIGESTS);
assert.equal(ready.intent.classification, "PROCEED");
assert.equal(ready.bootstrap.status, "READY");
assert.equal(ready.bootstrap.source_binding.status, "MATCH");
assert.equal(ready.role_admission.status, "ADMITTED");
assert.equal(ready.role_admission.role, RAPID_PROTOTYPE_ROLE);
assert.equal(ready.progress.status, "COMPLETED");
assert.equal(ready.progress.progress, "MEANINGFUL");
assert.equal(ready.progress.liveness, "LIVE");
assert.equal(ready.functionality.outcome_code, "READY");
assert.equal(ready.functionality.success, true);
assert.equal(ready.functionality.acceptance.status, "READY_FOR_INDEPENDENT_CLEARANCE");
assert.equal(ready.conversation.status, "PROCEED");
assert.equal(ready.surface.status, "ready");
assert.equal(ready.surface.label, "READY");
assert.equal(ready.security.public_scan.safe, true);
assert.equal(ready.security.hostile.safe, false);
assert(ready.security.hostile.violations.includes("CREDENTIAL"));
assert.equal(ready.hygiene.status, "CLEAN");
assert.equal(ready.hygiene.exact_lane_scope, true);
assert.equal(ready.evidence.status, "VERIFIED");
assert.equal(ready.evidence.verified, true);
assert.match(ready.evidence.receipt_sha256, /^[0-9a-f]{64}$/u);
assert.equal(ready.closure.status, "CLOSED");
assert.equal(ready.closure.handoff_preserved, true);
assert.equal(ready.closure.receipt_status, "CLOSED");
assert.equal(ready.closure.active_workers_for_worker, 0);
assert.equal(ready.closure.universal_closeout_receipts.length, 9);
assert.deepEqual(ready.closure.universal_closeout_receipts.map((receipt) => receipt.step), [
  "PRESERVE_HANDOFF",
  "PERSIST_HANDOFF",
  "AUDIT_CANDIDATE",
  "INTEGRATE_ACCEPTED_WORK",
  "UNPIN_SESSION",
  "CLOSE_STALE_WORKTREE",
  "REMOVE_ACTIVE_TASK_SCOPE",
  "MARK_CHAT_OUT_OF_SCOPE",
  "ARCHIVE_VISIBLE_TASK",
]);
assert.deepEqual(ready.closure.lifecycle, [
  "PRESERVE_TYPED_HANDOFF",
  "UNPIN",
  "ARCHIVE",
  "REMOVE_FROM_ACTIVE_ROSTER",
  "VERIFY_ZERO_ACTIVE",
]);
assert.deepEqual(input.closure.activeRoster, makeRoster(), "the caller-owned roster must remain unchanged");
assert.deepEqual(calls, [
  ["set_thread_pinned", {threadId: THREAD_ID, pinned: false}],
  ["set_thread_archived", {threadId: THREAD_ID, hostId: HOST_ID, archived: true}],
  ["list_threads", {}],
]);

const decisionIds = ready.decision_matrix.map(({id}) => id);
assert.deepEqual(decisionIds, ["READY", "QUESTION", "PUZZLE", "SOFT_REVIEW", "UNAVAILABLE", "HARD_STOP"]);
assert.equal(ready.decision_matrix[0].surface.status, "ready");
assert.equal(ready.decision_matrix[1].surface.status, "one-question");
assert.equal(ready.decision_matrix[2].surface.status, "puzzle");
assert.equal(ready.decision_matrix[3].surface.status, "soft-review");
assert.equal(ready.decision_matrix[4].surface.status, "unavailable");
assert.equal(ready.decision_matrix[5].surface.status, "hard-stop");
assert(ready.recovery.examples.some(({route}) => route === "BOUNDED_CLARIFICATION"));
assert(ready.recovery.examples.some(({route}) => route === "SAFE_DEFAULT"));
assert(ready.recovery.examples.some(({route}) => route === "TYPED_REVIEW"));
assert(ready.recovery.examples.some(({route}) => route === "FAIL_CLOSED"));

const publishedReady = JSON.stringify(ready);
for (const forbidden of [
  SOURCE.project_id,
  SOURCE.cwd,
  "rapid-slice-builder-session",
  THREAD_ID,
  HOST_ID,
]) {
  assert.equal(publishedReady.includes(forbidden), false, `private synthetic value was published: ${forbidden}`);
}
assert.doesNotMatch(publishedReady, /(?:https?|chat):\/\//iu);
assert.doesNotMatch(publishedReady, /(?:authorization|password|credential|secret)\s*[:=]/iu);

const mismatchCalls = [];
const mismatchObserved = {...SOURCE, source_tree: "c".repeat(40)};
const mismatch = await runRapidPrototype({
  ...baseInput(mismatchCalls),
  sourceBinding: {expected: SOURCE, observed: mismatchObserved},
});
assert.equal(mismatch.status, "BLOCKED");
assert.equal(mismatch.bootstrap.status, "SOURCE_BINDING_MISMATCH");
assert.equal(mismatch.bootstrap.source_binding.ok, false);
assert(mismatch.bootstrap.source_binding.mismatch_fields.includes("source_tree"));
assert.equal(mismatch.functionality.outcome_code, "HARD_STOP");
assert.equal(mismatch.recovery.selected.status, "SOURCE_BINDING_MISMATCH");
assert.equal(mismatch.recovery.selected.route, "FAIL_CLOSED");
assert.deepEqual(mismatchCalls, [], "source mismatch must stop before host closure effects");

const hardStopCalls = [];
const hardStop = await runRapidPrototype({
  ...baseInput(hardStopCalls),
  candidateIntent: {policy: "changed local policy"},
});
assert.equal(hardStop.status, "BLOCKED");
assert.equal(hardStop.intent.classification, "HARD_STOP");
assert.equal(hardStop.functionality.outcome_code, "HARD_STOP");
assert.equal(hardStop.recovery.selected.status, "HARD_STOP");
assert.equal(hardStop.recovery.selected.route, "CLOSE_CURRENT_GOAL_AND_SOURCE_BOUND_SUCCESSOR");
assert.deepEqual(hardStopCalls, [], "hard-stop intent changes must not close an unaccepted run");

const leaked = await runRapidPrototype({
  ...baseInput([]),
  message: "Authorization: Bearer synthetic-secret-value",
});
assert.equal(leaked.surface.status, "hard-stop");
assert.equal(leaked.surface.label, "HARD STOP");
assert.doesNotMatch(JSON.stringify(leaked.surface), /synthetic-secret-value|Bearer/iu);

const directLeak = scanPublicPayload("project_id: synthetic-project-987654321");
assert.equal(directLeak.safe, false);
assert.equal(directLeak.status, "HARD_STOP");
assert(directLeak.violations.includes("PROVIDER_OR_ACCOUNT_IDENTIFIER"));
assert.equal(JSON.stringify(directLeak).includes("synthetic-project-987654321"), false);

assert.equal(ready.handoff.status, "READY_FOR_INDEPENDENT_CLEARANCE");
assert.equal(ready.handoff.independent_check.status, "REQUESTED");
assert.equal(ready.handoff.clearance, "NOT_CLAIMED");

console.log("PASS Rapid Slice Builder: twelve-lane ready path, six decision/UI outcomes, source and hard stops, privacy/evidence checks, and exact closure lifecycle verified; independent check REQUESTED");
