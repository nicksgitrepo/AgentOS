#!/usr/bin/env node
import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compilePermanentSessionRollover,
  compileZeroOutputSessionReplacement,
  validatePermanentSessionRollover,
  validateZeroOutputSessionReplacement,
} from "../control/zero-output-session-replacement.mjs";
const digest = (value) => canonicalDigest({value});
const turn = {status: "COMPLETED", error: null, elapsed_seconds: 68, assistant_items: 0, tool_items: 0, command_items: 0, durable_result_items: 0, live_process_count: 0, turn_readback_sha256: null};
turn.turn_readback_sha256 = canonicalDigest({...turn, turn_readback_sha256: null});
const replacement = {session_id: "SESSION.NEW", project_ref: "PROJECT.A", cwd_ref: "CWD.PROJECTS", worktree_ref: "WORKTREE.A", project_bound: true, cwd_verified: true, observed_at_utc: "2026-08-28T15:00:00Z", freshness_seconds: 5, visible_assistant_items: 1, visible_tool_items: 1, same_worktree: true, custody_mutated: false, probe_readback_sha256: null};
replacement.probe_readback_sha256 = canonicalDigest({...replacement, probe_readback_sha256: null});
const input = {
  replacementId: "REPLACEMENT.LANE.A.001",
  laneId: "LANE.A",
  role: "REPAIR",
  failedSessionId: "SESSION.OLD",
  pairedSessionId: "SESSION.AUDITOR",
  evaluatedAtUtc: "2026-08-28T15:00:05Z",
  turn,
  custody: {worktree_ref: "WORKTREE.A", branch_ref: "BRANCH.A", head: digest("head"), tree: digest("tree"), status_sha256: digest("status"), handoff_sha256: digest("handoff"), preserved: true, reset_or_cleanup: false},
  replacement,
};
const decision = compileZeroOutputSessionReplacement(input);
validateZeroOutputSessionReplacement(decision);
assert.equal(decision.controller_approval_required, false);
assert.equal(decision.ordinary_pair_autonomy_preserved, true);
assert.equal(decision.retry_same_session, false);
assert.equal(decision.unrelated_lanes_continue, true);
assert.throws(() => compileZeroOutputSessionReplacement({...input, turn: {...input.turn, assistant_items: 1}}), /material output/u);
assert.throws(() => compileZeroOutputSessionReplacement({...input, turn: {...input.turn, status: "IN_PROGRESS"}}), /completed/u);
assert.throws(() => compileZeroOutputSessionReplacement({...input, turn: {...input.turn, live_process_count: 1}}), /live process/u);
assert.throws(() => compileZeroOutputSessionReplacement({...input, custody: {...input.custody, preserved: false}}), /preserved/u);
assert.throws(() => compileZeroOutputSessionReplacement({...input, replacement: {...input.replacement, visible_assistant_items: 0, visible_tool_items: 0}}), /visible-execution/u);
assert.throws(() => compileZeroOutputSessionReplacement({...input, replacement: {...input.replacement, custody_mutated: true}}), /without mutation/u);
assert.throws(() => compileZeroOutputSessionReplacement({...input, unrelatedLanesContinue: false}), /unrelated lanes/u);
assert.throws(() => compileZeroOutputSessionReplacement({...input, replacementId: input.failedSessionId}), /operation identity collides/u);
assert.throws(() => compileZeroOutputSessionReplacement({...input, replacement: {...input.replacement, observed_at_utc: "9999-99-99T99:99:99Z", probe_readback_sha256: canonicalDigest({...input.replacement, observed_at_utc: "9999-99-99T99:99:99Z", probe_readback_sha256: null})}}), /valid UTC instant/u);
for (const observed_at_utc of ["2026-02-30T15:00:00Z", "2026-04-31T15:00:00Z"]) {
  const malformed = {...input.replacement, observed_at_utc, freshness_seconds: 0, probe_readback_sha256: null};
  malformed.probe_readback_sha256 = canonicalDigest({...malformed, probe_readback_sha256: null});
  assert.throws(() => compileZeroOutputSessionReplacement({...input, evaluatedAtUtc: "2026-03-02T15:00:00Z", replacement: malformed}), /valid UTC instant/u);
}
const staleReplacement = {...input.replacement, observed_at_utc: "2026-08-28T14:00:00Z", freshness_seconds: 5, probe_readback_sha256: null};
staleReplacement.probe_readback_sha256 = canonicalDigest({...staleReplacement, probe_readback_sha256: null});
assert.throws(() => compileZeroOutputSessionReplacement({...input, replacement: staleReplacement}), /freshness is not bound/u);
const futureReplacement = {...input.replacement, observed_at_utc: "2026-08-28T15:01:00Z", freshness_seconds: 0, probe_readback_sha256: null};
futureReplacement.probe_readback_sha256 = canonicalDigest({...futureReplacement, probe_readback_sha256: null});
assert.throws(() => compileZeroOutputSessionReplacement({...input, replacement: futureReplacement}), /future/u);
const tampered = structuredClone(decision); tampered.controller_approval_required = true;
assert.throws(() => validateZeroOutputSessionReplacement(tampered), /approval gate/u);
for (const mutate of [
  (value) => { value.custody.preserved = false; },
  (value) => { value.custody.reset_or_cleanup = true; },
  (value) => { value.replacement.cwd_verified = false; },
  (value) => { value.replacement.same_worktree = false; },
  (value) => { value.replacement.custody_mutated = true; },
  (value) => { value.replacement.worktree_ref = "WORKTREE.OTHER"; },
  (value) => { value.turn.assistant_items = 1; },
]) {
  const hostile = structuredClone(decision); mutate(hostile); hostile.decision_sha256 = canonicalDigest({...hostile, decision_sha256: null});
  assert.throws(() => validateZeroOutputSessionReplacement(hostile));
}

const continuity = (label, extra = {}) => ({state_owned: true, [`${label}_sha256`]: digest(label), ...extra});
const rolloverInput = {
  taskId: "TASK-ROLLOVER-037",
  roleId: "ROLE-PERMANENT-037",
  oldSession: {session_id: "SESSION-OLD-037", task_id: "TASK-ROLLOVER-037", role_id: "ROLE-PERMANENT-037", status: "CLEAN_STOPPING_POINT", retained: true},
  successorSession: {session_id: "SESSION-NEW-037", task_id: "TASK-ROLLOVER-037", role_id: "ROLE-PERMANENT-037", successor: true, timer_id: "TIMER-NEW-037", job_id: "JOB-NEW-037"},
  queue: continuity("queue"),
  custody: continuity("custody"),
  incident: continuity("incident"),
  stoppingPoint: {...continuity("stopping_point"), clean: true},
  evaluatedAtUtc: "2026-08-28T15:00:00.000Z",
};
const rollover = compilePermanentSessionRollover(rolloverInput);
validatePermanentSessionRollover(rollover);
assert.equal(rollover.status, "ROLLOVER_ADMITTED");
assert.equal(rollover.retained_old_session, true);
assert.equal(rollover.exactly_one_successor, true);
assert.throws(() => compilePermanentSessionRollover({...rolloverInput, existingSessions: [{session_id: "SESSION-NEW-037"}]}), /duplicate permanent successor/u);
assert.throws(() => compilePermanentSessionRollover({...rolloverInput, existingRoles: [{role_id: "ROLE-PERMANENT-037"}]}), /duplicate permanent role/u);
assert.throws(() => compilePermanentSessionRollover({...rolloverInput, existingTimers: [{timer_id: "TIMER-NEW-037"}]}), /duplicate permanent timer/u);
assert.throws(() => compilePermanentSessionRollover({...rolloverInput, existingJobs: [{job_id: "JOB-NEW-037"}]}), /duplicate Scheduler job/u);
assert.throws(() => compilePermanentSessionRollover({...rolloverInput, stoppingPoint: {...rolloverInput.stoppingPoint, clean: false, complete: false, status: "OPEN"}}), /clean stopping point/u);
assert.throws(() => compilePermanentSessionRollover({...rolloverInput, custody: {...rolloverInput.custody, state_owned: false, owner: "CHAT_HISTORY"}}), /durable AgentOS State|chat-history/u);
const rolloverTampered = structuredClone(rollover); rolloverTampered.successor_session.session_id = "SESSION-OTHER-037";
assert.throws(() => validatePermanentSessionRollover(rolloverTampered), /digest mismatch/u);

console.log("PASS zero-output session custody-preserving replacement without autonomy loss");
