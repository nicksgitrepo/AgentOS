#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  DEFAULT_DEVELOPMENT_MODE,
  DEVELOPMENT_MODES,
  compileDevelopmentPlan,
  validateDevelopmentPlan,
} from "../control/development-plan.mjs";
import {CANONICAL_PERMANENT_ROLE_IDS} from "../control/permanent-role-authority.mjs";

const northStar = {goal: "help people finish one useful thing", audience: "project users"};
const firstWorkflow = {name: "first useful workflow", success: "one honest accepted result"};
const protectedBoundaries = {hard: ["secrets", "destructive external actions"], soft: ["scope expansion"]};
const firstCampaign = {goal: "build the smallest working slice", acceptance: ["focused check passes"]};

assert.deepEqual(DEVELOPMENT_MODES, ["RAPID_PROTOTYPING", "ITERATION"]);
assert.equal(DEFAULT_DEVELOPMENT_MODE, "RAPID_PROTOTYPING");
const rapid = compileDevelopmentPlan({northStar, firstWorkflow, protectedBoundaries, firstCampaign});
assert.equal(rapid.mode, "RAPID_PROTOTYPING");
assert.equal(rapid.universal_closeout.mode, "RAPID_PROTOTYPING");
assert.deepEqual(rapid.phase_order, ["BOOTSTRAP_CONTEXT", "RAPID_FOUNDATION", "RAPID_IMPLEMENTATION", "INDEPENDENT_AUDIT", "ITERATION_HANDOFF"]);
assert.deepEqual(rapid.persistent_roles, CANONICAL_PERMANENT_ROLE_IDS);
assert.equal(rapid.phases.find((phase) => phase.id === "ITERATION_HANDOFF").owner, "CONTROLLER");
assert.doesNotThrow(() => validateDevelopmentPlan(rapid, {northStar, firstWorkflow, protectedBoundaries, firstCampaign}));

const iteration = compileDevelopmentPlan({mode: "ITERATION", northStar, firstWorkflow, protectedBoundaries, firstCampaign});
assert.equal(iteration.mode, "ITERATION");
assert.equal(iteration.universal_closeout.mode, "ITERATION");
assert.deepEqual(iteration.phase_order, ["CAMPAIGN_PLAN", "CAMPAIGN_BUILD", "INDEPENDENT_AUDIT", "CAMPAIGN_CLOSURE"]);
assert.equal(iteration.phases.find((phase) => phase.id === "CAMPAIGN_CLOSURE").owner, "CONTROLLER");
assert.notEqual(iteration.plan_sha256, rapid.plan_sha256);

const changedIntent = structuredClone(rapid);
changedIntent.intent_binding.north_star_sha256 = "0".repeat(64);
assert.throws(() => validateDevelopmentPlan(changedIntent), /development plan digest mismatch/u);
assert.throws(() => compileDevelopmentPlan({mode: "UNKNOWN", northStar, firstWorkflow, protectedBoundaries, firstCampaign}), /development mode is invalid/u);

console.log("PASS development plan: rapid default, iteration alternative, intent bindings, reassessment digest, and hostile cases verified");
