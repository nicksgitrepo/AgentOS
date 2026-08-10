#!/usr/bin/env node

import assert from "node:assert/strict";
import {BOUNDARY_ROUTES, routeBoundary} from "../../control/rapid-prototype/recovery-boundaries.mjs";

const BASE = Object.freeze({
  scopeChanged: false,
  intentChanged: false,
  policyChanged: false,
  capabilityAvailable: true,
  identityMatch: true,
});

function route(condition, overrides = {}) {
  return routeBoundary({...BASE, condition, ...overrides});
}

function assertSafeContinuation(result, expectedRoute) {
  assert.equal(result.route, expectedRoute);
  assert.equal(result.status, "PUZZLE");
  assert.equal(result.continuation === "BOUNDED" || result.continuation === "SAFE_DEFAULT", true);
  assert.equal(result.requiresFreshGoal, false);
  assert.equal(result.acceptance, "PENDING_FOCUSED_RECHECK");
  assert.equal(result.next, "FOCUSED_RECHECK");
}

const clarification = route("PUZZLE");
assertSafeContinuation(clarification, BOUNDARY_ROUTES.BOUNDED_CLARIFICATION);
assert.equal(clarification.action, "BOUND_ONE_CLARIFICATION");

const safeDefault = route("PUZZLE_SAFE_DEFAULT");
assertSafeContinuation(safeDefault, BOUNDARY_ROUTES.SAFE_DEFAULT);
assert.equal(safeDefault.action, "APPLY_SAFE_DEFAULT");

const softReview = route("SOFT_REVIEW");
assert.deepEqual(
  {
    status: softReview.status,
    route: softReview.route,
    action: softReview.action,
    next: softReview.next,
    continuation: softReview.continuation,
    acceptance: softReview.acceptance,
  },
  {
    status: "SOFT_REVIEW",
    route: BOUNDARY_ROUTES.TYPED_REVIEW,
    action: "RECORD_TYPED_REVIEW",
    next: "REVIEW_DECISION",
    continuation: "PAUSE_AFFECTED_WORK",
    acceptance: "BLOCKED_PENDING_REVIEW",
  },
);

const hardStop = route("HARD_STOP");
assert.equal(hardStop.status, "HARD_STOP");
assert.equal(hardStop.route, BOUNDARY_ROUTES.CLOSE_CURRENT_GOAL_AND_SOURCE_BOUND_SUCCESSOR);
assert.equal(hardStop.action, "CLOSE_CURRENT_GOAL");
assert.equal(hardStop.next, "FRESH_SOURCE_BOUND_SUCCESSOR");
assert.equal(hardStop.continuation, "STOP");
assert.equal(hardStop.requiresFreshGoal, true);
assert.equal(hardStop.acceptance, "BLOCKED");

const mismatch = route("PUZZLE", {identityMatch: false, scopeChanged: true});
assert.equal(mismatch.status, "SOURCE_BINDING_MISMATCH");
assert.equal(mismatch.route, BOUNDARY_ROUTES.FAIL_CLOSED);
assert.equal(mismatch.action, "FAIL_CLOSED");
assert.equal(mismatch.next, "PRESERVE_EVIDENCE_AND_HAND_OFF");
assert.equal(mismatch.continuation, "STOP");
assert.equal(mismatch.requiresFreshGoal, true);
assert.equal(mismatch.acceptance, "BLOCKED");

const unavailableCapability = route("SOFT_REVIEW", {capabilityAvailable: false, intentChanged: true});
assert.equal(unavailableCapability.status, "UNAVAILABLE");
assert.equal(unavailableCapability.route, BOUNDARY_ROUTES.FAIL_CLOSED);
assert.equal(unavailableCapability.action, "FAIL_CLOSED");
assert.equal(unavailableCapability.acceptance, "BLOCKED");

const unavailableCondition = route("UNAVAILABLE");
assert.equal(unavailableCondition.status, "UNAVAILABLE");
assert.equal(unavailableCondition.route, BOUNDARY_ROUTES.FAIL_CLOSED);

for (const changedField of ["scopeChanged", "intentChanged", "policyChanged"]) {
  const changed = route("SOFT_REVIEW", {[changedField]: true});
  assert.equal(changed.status, "HARD_STOP", `${changedField} must hard-stop`);
  assert.equal(changed.route, BOUNDARY_ROUTES.CLOSE_CURRENT_GOAL_AND_SOURCE_BOUND_SUCCESSOR, `${changedField} must close the current goal`);
  assert.equal(changed.next, "FRESH_SOURCE_BOUND_SUCCESSOR", `${changedField} must require a fresh successor`);
  assert.equal(changed.requiresFreshGoal, true, `${changedField} must require a fresh goal`);
}

assert.equal(route("HARD_STOP", {identityMatch: false}).route, BOUNDARY_ROUTES.FAIL_CLOSED, "identity mismatch outranks hard stop");
assert.equal(route("HARD_STOP", {capabilityAvailable: false}).route, BOUNDARY_ROUTES.FAIL_CLOSED, "capability unavailability outranks hard stop");
assert.equal(route("PUZZLE", {identityMatch: false, capabilityAvailable: false}).status, "SOURCE_BINDING_MISMATCH", "identity mismatch is the first fail-closed gate");
assert.equal(route("UNKNOWN_CONDITION").route, BOUNDARY_ROUTES.FAIL_CLOSED, "unknown conditions cannot continue");
assert.equal(route("PUZZLE", {capabilityAvailable: undefined}).route, BOUNDARY_ROUTES.FAIL_CLOSED, "missing capability proof cannot continue");
assert.equal(route("PUZZLE", {identityMatch: undefined}).route, BOUNDARY_ROUTES.FAIL_CLOSED, "missing identity proof cannot continue");
assert.equal(route("PUZZLE", {scopeChanged: "false"}).route, BOUNDARY_ROUTES.FAIL_CLOSED, "untyped change flags cannot continue");

assert.deepEqual(route("PUZZLE"), route("puzzle-clarification"), "routing must be deterministic across supported condition spelling");
for (const outcome of [clarification, safeDefault, softReview, hardStop, mismatch, unavailableCapability, unavailableCondition]) {
  assert.notEqual(outcome.continuation, "SILENT");
}

console.log("PASS AgentOS Recovery and Boundaries (puzzle routes, typed review, hard-stop successor, fail-closed gates, precedence, and hostile coverage)");

