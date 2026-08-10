#!/usr/bin/env node

/*
 * Small, source-bound recovery router for the Rapid Prototype slice.
 *
 * The router only chooses a typed next route.  It does not perform recovery,
 * close a session, mint a successor, or treat an assertion as readback.
 */

export const BOUNDARY_ROUTES = Object.freeze({
  BOUNDED_CLARIFICATION: "BOUNDED_CLARIFICATION",
  SAFE_DEFAULT: "SAFE_DEFAULT",
  TYPED_REVIEW: "TYPED_REVIEW",
  CLOSE_CURRENT_GOAL_AND_SOURCE_BOUND_SUCCESSOR: "CLOSE_CURRENT_GOAL_AND_SOURCE_BOUND_SUCCESSOR",
  FAIL_CLOSED: "FAIL_CLOSED",
});

const CONDITION_KINDS = Object.freeze({
  PUZZLE: "PUZZLE",
  PUZZLE_SAFE_DEFAULT: "PUZZLE_SAFE_DEFAULT",
  SOFT_REVIEW: "SOFT_REVIEW",
  HARD_STOP: "HARD_STOP",
  UNAVAILABLE: "UNAVAILABLE",
});

const BOOLEAN_FIELDS = Object.freeze([
  "scopeChanged",
  "intentChanged",
  "policyChanged",
  "capabilityAvailable",
  "identityMatch",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCondition(condition) {
  if (typeof condition !== "string") return null;
  const normalized = condition.trim().toUpperCase().replace(/[\s-]+/gu, "_");
  if (["PUZZLE", "PUZZLE_CLARIFICATION", "BOUNDED_CLARIFICATION"].includes(normalized)) return CONDITION_KINDS.PUZZLE;
  if (["PUZZLE_SAFE_DEFAULT", "SAFE_DEFAULT", "ROUTINE", "DEFAULT"].includes(normalized)) return CONDITION_KINDS.PUZZLE_SAFE_DEFAULT;
  if (["SOFT_REVIEW", "SOFT_BOUNDARY_REVIEW", "REVIEW"].includes(normalized)) return CONDITION_KINDS.SOFT_REVIEW;
  if (["HARD_STOP", "HARD_BOUNDARY", "STOP"].includes(normalized)) return CONDITION_KINDS.HARD_STOP;
  if (["UNAVAILABLE", "FAIL_CLOSED", "IDENTITY_MISMATCH", "SOURCE_BINDING_MISMATCH"].includes(normalized)) return CONDITION_KINDS.UNAVAILABLE;
  return null;
}

function result({status, route, action, next, continuation, requiresFreshGoal, acceptance, reason}) {
  return Object.freeze({
    status,
    route,
    action,
    next,
    continuation,
    requiresFreshGoal,
    acceptance,
    reason,
  });
}

function failClosed(reason, status = "UNAVAILABLE") {
  return result({
    status,
    route: BOUNDARY_ROUTES.FAIL_CLOSED,
    action: "FAIL_CLOSED",
    next: "PRESERVE_EVIDENCE_AND_HAND_OFF",
    continuation: "STOP",
    requiresFreshGoal: true,
    acceptance: "BLOCKED",
    reason,
  });
}

function closeCurrentGoal(reason) {
  return result({
    status: "HARD_STOP",
    route: BOUNDARY_ROUTES.CLOSE_CURRENT_GOAL_AND_SOURCE_BOUND_SUCCESSOR,
    action: "CLOSE_CURRENT_GOAL",
    next: "FRESH_SOURCE_BOUND_SUCCESSOR",
    continuation: "STOP",
    requiresFreshGoal: true,
    acceptance: "BLOCKED",
    reason,
  });
}

function requireBooleanInputs(input) {
  const invalid = BOOLEAN_FIELDS.filter((field) => typeof input[field] !== "boolean");
  if (invalid.length > 0) return `Boundary input is unavailable or untyped: ${invalid.join(", ")}.`;
  return null;
}

/**
 * Classify a boundary condition without performing the routed action.
 *
 * Identity and capability gates are evaluated first.  A changed intent,
 * scope, or policy then invalidates the current goal.  Only an otherwise
 * valid, unchanged input may reach puzzle, review, or hard-stop routing.
 */
export function routeBoundary(input = {}) {
  if (!isRecord(input)) return failClosed("Boundary input is unavailable or not an object.");

  const inputError = requireBooleanInputs(input);
  if (inputError !== null) return failClosed(inputError);

  if (input.identityMatch === false) {
    return failClosed("The source or worker identity does not match the current binding.", "SOURCE_BINDING_MISMATCH");
  }

  if (input.capabilityAvailable === false) {
    return failClosed("A required host capability is unavailable.");
  }

  const condition = normalizeCondition(input.condition);
  if (condition === null) return failClosed("The boundary condition is unknown or unavailable.");
  if (condition === CONDITION_KINDS.UNAVAILABLE) return failClosed("The required boundary readback is unavailable.");

  if (input.scopeChanged || input.intentChanged || input.policyChanged) {
    return closeCurrentGoal("Owner intent, scope, or policy changed; close the current goal before a fresh source-bound successor.");
  }

  if (condition === CONDITION_KINDS.PUZZLE) {
    return result({
      status: "PUZZLE",
      route: BOUNDARY_ROUTES.BOUNDED_CLARIFICATION,
      action: "BOUND_ONE_CLARIFICATION",
      next: "FOCUSED_RECHECK",
      continuation: "BOUNDED",
      requiresFreshGoal: false,
      acceptance: "PENDING_FOCUSED_RECHECK",
      reason: "A bounded puzzle may receive one exact clarification before a fresh focused check.",
    });
  }

  if (condition === CONDITION_KINDS.PUZZLE_SAFE_DEFAULT) {
    return result({
      status: "PUZZLE",
      route: BOUNDARY_ROUTES.SAFE_DEFAULT,
      action: "APPLY_SAFE_DEFAULT",
      next: "FOCUSED_RECHECK",
      continuation: "SAFE_DEFAULT",
      requiresFreshGoal: false,
      acceptance: "PENDING_FOCUSED_RECHECK",
      reason: "A bounded puzzle may use the recorded safe default before a fresh focused check.",
    });
  }

  if (condition === CONDITION_KINDS.SOFT_REVIEW) {
    return result({
      status: "SOFT_REVIEW",
      route: BOUNDARY_ROUTES.TYPED_REVIEW,
      action: "RECORD_TYPED_REVIEW",
      next: "REVIEW_DECISION",
      continuation: "PAUSE_AFFECTED_WORK",
      requiresFreshGoal: false,
      acceptance: "BLOCKED_PENDING_REVIEW",
      reason: "A non-protected choice changed; record its bounded impact before affected work resumes.",
    });
  }

  return closeCurrentGoal("A protected hard-stop condition requires closing the current goal and minting a fresh source-bound successor.");
}

