#!/usr/bin/env node
import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileZeroOutputSessionReplacement, validateZeroOutputSessionReplacement} from "../control/zero-output-session-replacement.mjs";
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
console.log("PASS zero-output session custody-preserving replacement without autonomy loss");
