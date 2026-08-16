/* Content-bound closeout contract for Controller import continuation. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  CONTROLLER_IMPORT_CLOSEOUT_SCHEMA,
  CONTROLLER_IMPORT_NEXT_ACTIONS,
  CONTROLLER_IMPORT_PLANNER_VERSION,
  validateControllerImportRosterProjection,
} from "./controller-import-planner.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && /^[A-Z][A-Z0-9._:-]{0,191}$/u.test(value), `${label} must be an uppercase identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a sha256 digest`);
}

function closeoutBody(closeout) {
  const body = structuredClone(closeout);
  body.closeout_sha256 = null;
  return body;
}

function validateNextTransition(transition, projection) {
  exactKeys(transition, ["transition_id", "action", "target_wave_id", "source_projection_sha256"], "Controller import next transition");
  requireIdentifier(transition.transition_id, "Controller import next transition ID");
  assert(transition.action === "START_AVAILABLE_WAVE", "Controller import next transition action is invalid");
  requireIdentifier(transition.target_wave_id, "Controller import next transition target");
  assert(projection.available_wave_ids.includes(transition.target_wave_id), "Controller import next transition target is not available");
  assert(transition.transition_id === `TRANSITION.${transition.target_wave_id}.START`, "Controller import next transition identity is not bound to its target");
  requireSha(transition.source_projection_sha256, "Controller import next transition projection");
  assert(transition.source_projection_sha256 === projection.projection_sha256, "Controller import next transition is stale");
}

function validateLocalBlockRepair(repair, projection) {
  exactKeys(repair, ["action", "request_id", "source_projection_sha256"], "Controller import local block repair");
  assert(repair.action === "BUILD_AND_QA_PENDING_BLOCK", "Controller import local block repair action is invalid");
  requireIdentifier(repair.request_id, "Controller import local block repair request");
  assert(projection.pending_role_request_ids.includes(repair.request_id), "Controller import local block repair request is not pending");
  requireSha(repair.source_projection_sha256, "Controller import local block repair projection");
  assert(repair.source_projection_sha256 === projection.projection_sha256, "Controller import local block repair is stale");
}

function validateProtectedDependency(dependency) {
  exactKeys(dependency, ["dependency_id", "reason", "sole_protected_dependency"], "Controller import protected dependency");
  requireIdentifier(dependency.dependency_id, "Controller import protected dependency ID");
  requireString(dependency.reason, "Controller import protected dependency reason");
  assert(dependency.sole_protected_dependency === true, "Controller import protected dependency is not sole");
}

function validateProtectedWaveActivation(activation, projection) {
  exactKeys(activation, ["action", "wave_ids", "source_projection_sha256"], "Controller import protected wave activation");
  assert(activation.action === CONTROLLER_IMPORT_NEXT_ACTIONS.WAIT_PROTECTED_WAVE_ACTIVATION, "Controller import protected wave activation action is invalid");
  assert(JSON.stringify(activation.wave_ids) === JSON.stringify(projection.activation_blocked_wave_ids), "Controller import protected wave activation routes are stale");
  requireSha(activation.source_projection_sha256, "Controller import protected wave activation projection");
  assert(activation.source_projection_sha256 === projection.projection_sha256, "Controller import protected wave activation is stale");
}

export function validateControllerImportRoutineCloseout(closeout, {projection, plan = null} = {}) {
  validateControllerImportRosterProjection(projection, {plan});
  exactKeys(closeout, ["schema", "version", "status", "projection_sha256", "wave_activation_allowed", "next_transition", "local_block_repair", "protected_wave_activation", "protected_dependency", "closeout_sha256"], "Controller import routine closeout");
  assert(closeout.schema === CONTROLLER_IMPORT_CLOSEOUT_SCHEMA && closeout.version === CONTROLLER_IMPORT_PLANNER_VERSION, "Controller import routine closeout identity is invalid");
  assert(["ROUTINE_HANDOFF_ACCEPTED", "PROTECTED_WAVE_ACTIVATION_PENDING", "STALLED_READY_FOR_RESUMPTION", "TERMINAL_READY"].includes(closeout.status), "Controller import routine closeout status is invalid");
  requireSha(closeout.projection_sha256, "Controller import routine closeout projection");
  assert(closeout.projection_sha256 === projection.projection_sha256, "Controller import routine closeout is bound to a different projection");
  assert(closeout.wave_activation_allowed === projection.wave_activation_allowed, "Controller import closeout activation eligibility is stale");
  assert(closeout.next_transition === null || isRecord(closeout.next_transition), "Controller import routine closeout next transition is invalid");
  assert(closeout.local_block_repair === null || isRecord(closeout.local_block_repair), "Controller import routine closeout local repair is invalid");
  assert(closeout.protected_wave_activation === null || isRecord(closeout.protected_wave_activation), "Controller import routine closeout protected wave activation is invalid");
  assert(closeout.protected_dependency === null || isRecord(closeout.protected_dependency), "Controller import routine closeout protected dependency is invalid");
  if (closeout.status === "ROUTINE_HANDOFF_ACCEPTED") {
    assert(closeout.protected_dependency === null, "Routine closeout cannot carry a protected stall");
    if (projection.available_wave_ids.length > 0) {
      assert(projection.wave_activation_allowed === true, "Routine closeout cannot start a wave while activation is held");
      assert(projection.next_action === CONTROLLER_IMPORT_NEXT_ACTIONS.START_AVAILABLE_WAVE, "Routine closeout projection does not start available work");
      assert(closeout.next_transition !== null, "Routine closeout must bind the next available transition");
      assert(closeout.local_block_repair === null, "Routine closeout cannot replace an available transition with block repair");
      assert(closeout.protected_wave_activation === null, "Routine closeout cannot carry a protected wave hold");
      validateNextTransition(closeout.next_transition, projection);
    } else if (projection.pending_role_request_ids.length > 0) {
      assert(projection.next_action === CONTROLLER_IMPORT_NEXT_ACTIONS.START_PENDING_BLOCK_REPAIR, "Routine closeout projection does not start local block repair");
      assert(closeout.next_transition === null, "Local block repair closeout cannot carry a wave transition");
      assert(closeout.local_block_repair !== null, "Routine closeout must bind the next local block repair");
      assert(closeout.protected_wave_activation === null, "Local block repair closeout cannot freeze behind wave activation");
      validateLocalBlockRepair(closeout.local_block_repair, projection);
    } else {
      assert(projection.next_action === CONTROLLER_IMPORT_NEXT_ACTIONS.PREPARE_REVIEW, "Routine closeout terminal action is invalid");
      assert(closeout.next_transition === null && closeout.local_block_repair === null && closeout.protected_wave_activation === null, "Terminal closeout carries an ineligible transition");
    }
  } else if (closeout.status === "PROTECTED_WAVE_ACTIVATION_PENDING") {
    assert(projection.wave_activation_allowed === false, "Protected wave activation status requires activation to be held");
    assert(projection.available_wave_ids.length === 0 && projection.pending_role_request_ids.length === 0 && projection.activation_blocked_wave_ids.length > 0, "Protected wave activation status does not bind the remaining wave work");
    assert(projection.next_action === CONTROLLER_IMPORT_NEXT_ACTIONS.WAIT_PROTECTED_WAVE_ACTIVATION, "Protected wave activation next action is invalid");
    assert(closeout.next_transition === null && closeout.local_block_repair === null, "Protected wave activation carries an executable local action");
    assert(closeout.protected_wave_activation !== null && closeout.protected_dependency !== null, "Protected wave activation lacks its exact protected dependency");
    validateProtectedWaveActivation(closeout.protected_wave_activation, projection);
    validateProtectedDependency(closeout.protected_dependency);
  } else if (closeout.status === "STALLED_READY_FOR_RESUMPTION") {
    assert(projection.available_wave_ids.length === 0 && projection.pending_role_request_ids.length === 0 && projection.activation_blocked_wave_ids.length === 0, "Only a sole protected dependency may stall when no local work remains");
    assert(closeout.next_transition === null && closeout.local_block_repair === null && closeout.protected_wave_activation === null, "Protected stall carries local work");
    assert(closeout.protected_dependency !== null, "Protected stall lacks its sole dependency");
    validateProtectedDependency(closeout.protected_dependency);
  } else {
    assert(projection.available_wave_ids.length === 0 && projection.pending_role_request_ids.length === 0 && projection.activation_blocked_wave_ids.length === 0, "Terminal closeout leaves eligible work unstarted");
    assert(closeout.next_transition === null && closeout.local_block_repair === null && closeout.protected_wave_activation === null && closeout.protected_dependency === null, "Terminal closeout carries a non-terminal action");
  }
  requireSha(closeout.closeout_sha256, "Controller import routine closeout digest");
  assert(closeout.closeout_sha256 === canonicalDigest(closeoutBody(closeout)), "Controller import routine closeout digest mismatch");
  return closeout;
}

export function compileControllerImportRoutineCloseout({projection, plan = null, protectedDependency = null} = {}) {
  validateControllerImportRosterProjection(projection, {plan});
  let status = "ROUTINE_HANDOFF_ACCEPTED";
  let nextTransition = null;
  let localBlockRepair = null;
  let protectedWaveActivation = null;
  if (projection.available_wave_ids.length > 0) {
    const targetWaveId = projection.available_wave_ids[0];
    nextTransition = {
      transition_id: `TRANSITION.${targetWaveId}.START`,
      action: "START_AVAILABLE_WAVE",
      target_wave_id: targetWaveId,
      source_projection_sha256: projection.projection_sha256,
    };
  } else if (projection.pending_role_request_ids.length > 0) {
    localBlockRepair = {
      action: "BUILD_AND_QA_PENDING_BLOCK",
      request_id: projection.pending_role_request_ids[0],
      source_projection_sha256: projection.projection_sha256,
    };
  } else if (projection.activation_blocked_wave_ids.length > 0) {
    assert(protectedDependency !== null, "Protected wave activation requires its sole protected dependency");
    status = "PROTECTED_WAVE_ACTIVATION_PENDING";
    protectedWaveActivation = {
      action: CONTROLLER_IMPORT_NEXT_ACTIONS.WAIT_PROTECTED_WAVE_ACTIVATION,
      wave_ids: projection.activation_blocked_wave_ids,
      source_projection_sha256: projection.projection_sha256,
    };
  } else if (protectedDependency !== null) {
    status = "STALLED_READY_FOR_RESUMPTION";
  } else {
    status = "TERMINAL_READY";
  }
  const closeout = {
    schema: CONTROLLER_IMPORT_CLOSEOUT_SCHEMA,
    version: CONTROLLER_IMPORT_PLANNER_VERSION,
    status,
    projection_sha256: projection.projection_sha256,
    wave_activation_allowed: projection.wave_activation_allowed,
    next_transition: nextTransition,
    local_block_repair: localBlockRepair,
    protected_wave_activation: protectedWaveActivation,
    protected_dependency: ["PROTECTED_WAVE_ACTIVATION_PENDING", "STALLED_READY_FOR_RESUMPTION"].includes(status) ? protectedDependency : null,
    closeout_sha256: null,
  };
  closeout.closeout_sha256 = canonicalDigest(closeoutBody(closeout));
  return validateControllerImportRoutineCloseout(closeout, {projection, plan});
}
