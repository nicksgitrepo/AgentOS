#!/usr/bin/env node

import {canonicalDigest} from "./content-addressing.mjs";

export const ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA = "agentos.zero_output_session_replacement.v1";
export const ZERO_OUTPUT_MINIMUM_ELAPSED_SECONDS = 30;

const SHA = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
function assert(condition, message) { if (!condition) throw new Error(message); }
function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function sha(value, label) { assert(typeof value === "string" && SHA.test(value), `${label} must be SHA-256`); }
function count(value, label) { assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`); }

export function compileZeroOutputSessionReplacement({
  replacementId,
  laneId,
  role,
  failedSessionId,
  pairedSessionId,
  turn,
  custody,
  replacement,
  unrelatedLanesContinue = true,
} = {}) {
  for (const [value, label] of [[replacementId, "replacement ID"], [laneId, "lane ID"], [role, "role"], [failedSessionId, "failed session ID"], [pairedSessionId, "paired session ID"]]) id(value, label);
  assert(turn && typeof turn === "object", "turn observation is required");
  assert(turn.status === "COMPLETED" && turn.error === null, "only a completed non-error turn may be classified as silent");
  count(turn.elapsed_seconds, "turn elapsed seconds");
  assert(turn.elapsed_seconds >= ZERO_OUTPUT_MINIMUM_ELAPSED_SECONDS, "turn is below the zero-output observation floor");
  for (const field of ["assistant_items", "tool_items", "command_items", "durable_result_items"]) count(turn[field], `turn ${field}`);
  assert(turn.assistant_items + turn.tool_items + turn.command_items + turn.durable_result_items === 0, "turn contains material output and may not be replaced as silent");
  assert(turn.live_process_count === 0, "session still has a live process");
  sha(turn.turn_readback_sha256, "turn readback digest");

  assert(custody && typeof custody === "object", "custody is required");
  for (const field of ["worktree_ref", "branch_ref"]) id(custody[field], `custody ${field}`);
  for (const field of ["head", "tree", "status_sha256", "handoff_sha256"]) sha(custody[field], `custody ${field}`);
  assert(custody.preserved === true && custody.reset_or_cleanup === false, "custody must be preserved without reset or cleanup");

  assert(replacement && typeof replacement === "object", "replacement probe is required");
  id(replacement.session_id, "replacement session ID");
  assert(replacement.session_id !== failedSessionId && replacement.session_id !== pairedSessionId, "replacement identity collides with the pair");
  assert(replacement.project_bound === true && replacement.cwd_verified === true, "replacement must be project-bound with verified cwd");
  count(replacement.visible_assistant_items, "replacement visible assistant items");
  count(replacement.visible_tool_items, "replacement visible tool items");
  assert(replacement.visible_assistant_items + replacement.visible_tool_items > 0, "replacement visible-execution probe failed");
  sha(replacement.probe_readback_sha256, "replacement probe digest");
  assert(replacement.same_worktree === true && replacement.custody_mutated === false, "replacement must adopt preserved custody without mutation");
  assert(unrelatedLanesContinue === true, "one silent session may not stop unrelated lanes");

  const decision = {
    schema: ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA,
    version: 1,
    replacement_id: replacementId,
    lane_id: laneId,
    role,
    failed_session_id: failedSessionId,
    paired_session_id: pairedSessionId,
    classification: "HOST_SESSION_ZERO_OUTPUT",
    action: "ADMIT_VISIBLE_REPLACEMENT_AND_ARCHIVE_FAILED_SESSION",
    controller_approval_required: false,
    ordinary_pair_autonomy_preserved: true,
    unrelated_lanes_continue: true,
    retry_same_session: false,
    custody: structuredClone(custody),
    replacement: structuredClone(replacement),
    decision_sha256: null,
  };
  decision.decision_sha256 = canonicalDigest({...decision, decision_sha256: null});
  return decision;
}

export function validateZeroOutputSessionReplacement(decision) {
  assert(decision?.schema === ZERO_OUTPUT_SESSION_REPLACEMENT_SCHEMA && decision.version === 1, "replacement decision schema mismatch");
  assert(decision.classification === "HOST_SESSION_ZERO_OUTPUT", "replacement classification mismatch");
  assert(decision.action === "ADMIT_VISIBLE_REPLACEMENT_AND_ARCHIVE_FAILED_SESSION", "replacement action mismatch");
  assert(decision.controller_approval_required === false && decision.ordinary_pair_autonomy_preserved === true, "replacement added an approval gate or removed autonomy");
  assert(decision.unrelated_lanes_continue === true && decision.retry_same_session === false, "replacement may not stall other lanes or retry the failed session");
  sha(decision.decision_sha256, "replacement decision digest");
  assert(decision.decision_sha256 === canonicalDigest({...decision, decision_sha256: null}), "replacement decision digest mismatch");
  return decision;
}
