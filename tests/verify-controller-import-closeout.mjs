#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  validateControllerImportRosterProjection,
} from "../control/controller-import-planner.mjs";
import {
  compileControllerImportRoutineCloseout,
  validateControllerImportRoutineCloseout,
} from "../control/controller-import-closeout.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const sha = (character) => character.repeat(64);

function projection({availableWaveIds, pendingRoleIds, nextAction}) {
  const value = {
    schema: "agentos.controller_import_roster_projection.v1",
    version: 1,
    status: pendingRoleIds.length === 0 ? "READY_COMPLETE" : "PARTIAL_READY",
    campaign_plan_sha256: sha("1"),
    source: "AGENT.SPAWNER_COMPILER",
    available_role_request_ids: ["REQ.READY"],
    pending_role_request_ids: [...pendingRoleIds].sort(),
    blocked_role_request_ids: [...pendingRoleIds].sort(),
    available_wave_ids: [...availableWaveIds].sort(),
    completed_wave_ids: [],
    active_wave_ids: [],
    next_action: nextAction,
    controller_decision_inputs: {
      available_wave_ids: [...availableWaveIds].sort(),
      pending_role_request_ids: [...pendingRoleIds].sort(),
      blocked_role_request_ids: [...pendingRoleIds].sort(),
      replan_required: pendingRoleIds.length > 0,
    },
    incomplete_never_admitted: true,
    projection_sha256: null,
  };
  value.projection_sha256 = canonicalDigest({...value, projection_sha256: null});
  return value;
}

const eligible = projection({
  availableWaveIds: ["WAVE.001.FOUNDATION"],
  pendingRoleIds: ["REQ.PENDING"],
  nextAction: "START_NEXT_AVAILABLE_CONTROLLER_TRANSITION",
});
validateControllerImportRosterProjection(eligible);
const accepted = compileControllerImportRoutineCloseout({projection: eligible});
assert.equal(accepted.status, "ROUTINE_HANDOFF_ACCEPTED");
assert.equal(accepted.next_transition.transition_id, "TRANSITION.WAVE.001.FOUNDATION.START");
assert.equal(accepted.next_transition.target_wave_id, "WAVE.001.FOUNDATION");

const endedEarly = {...accepted, next_transition: null, closeout_sha256: null};
endedEarly.closeout_sha256 = canonicalDigest({...endedEarly, closeout_sha256: null});
assert.throws(
  () => validateControllerImportRoutineCloseout(endedEarly, {projection: eligible}),
  /must bind the next available transition/u,
  "eligible work must reject a closeout that ends without the next transition",
);

const pendingOnly = projection({
  availableWaveIds: [],
  pendingRoleIds: ["REQ.PENDING"],
  nextAction: "START_NEXT_LOCAL_BLOCK_REPAIR",
});
const repairCloseout = compileControllerImportRoutineCloseout({projection: pendingOnly});
assert.equal(repairCloseout.status, "ROUTINE_HANDOFF_ACCEPTED");
assert.equal(repairCloseout.local_block_repair.action, "BUILD_AND_QA_PENDING_BLOCK");
assert.equal(repairCloseout.local_block_repair.request_id, "REQ.PENDING");

const illegalProtectedStall = {
  schema: "agentos.controller_import_closeout.v1",
  version: 1,
  status: "STALLED_READY_FOR_RESUMPTION",
  projection_sha256: eligible.projection_sha256,
  next_transition: null,
  local_block_repair: null,
  protected_dependency: {
    dependency_id: "AUTH.PROTECTED",
    reason: "External protected authority is unavailable.",
    sole_protected_dependency: true,
  },
  closeout_sha256: null,
};
illegalProtectedStall.closeout_sha256 = canonicalDigest({...illegalProtectedStall, closeout_sha256: null});
assert.throws(
  () => validateControllerImportRoutineCloseout(illegalProtectedStall, {projection: eligible}),
  /Only a sole protected dependency may stall/u,
  "protected dependency must not freeze eligible local work",
);

console.log("PASS Controller import closeout chaining rejects early closeout, binds immediate transition or local repair, and preserves sole-protected-stall rule");
