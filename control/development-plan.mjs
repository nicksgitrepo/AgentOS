#!/usr/bin/env node

/*
 * Bootstrap's small, source-neutral development-mode plan. The user can
 * choose the mode, but the plan is always bound to the captured intent and
 * first workflow so a later campaign cannot silently change the assignment.
 */

import crypto from "node:crypto";
import {
  assertUniversalDevelopmentMode,
  universalTaskCloseoutPolicy,
} from "./governance-library.mjs";

export const DEVELOPMENT_PLAN_SCHEMA = "agentos.bootstrap_development_plan.v1";
export const DEVELOPMENT_MODES = Object.freeze(["RAPID_PROTOTYPING", "ITERATION"]);
export const DEFAULT_DEVELOPMENT_MODE = "RAPID_PROTOTYPING";
export const DEVELOPMENT_PHASES = Object.freeze({
  RAPID_PROTOTYPING: Object.freeze([
    Object.freeze({id: "BOOTSTRAP_CONTEXT", name: "Set up the shared understanding", owner: "BOOTSTRAP", result: "A source-bound plan with intent, boundaries, and a full phase map."}),
    Object.freeze({id: "RAPID_FOUNDATION", name: "Lay down the governance lanes", owner: "NAMED_LANE_WORKERS", result: "One small, checkable rule set for each required lane."}),
    Object.freeze({id: "RAPID_IMPLEMENTATION", name: "Build the first working version", owner: "NAMED_LANE_WORKERS", result: "A small real workflow with focused checks."}),
    Object.freeze({id: "INDEPENDENT_AUDIT", name: "Check the result separately", owner: "INDEPENDENT_AUDITOR", result: "A truthful pass, repair finding, or clear stop."}),
    Object.freeze({id: "ITERATION_HANDOFF", name: "Keep improving in fresh campaigns", owner: "INTENT_REGULATOR", result: "A typed next step bound to the accepted result or open finding."}),
  ]),
  ITERATION: Object.freeze([
    Object.freeze({id: "CAMPAIGN_PLAN", name: "Choose the next small change", owner: "CAMPAIGN_ORCHESTRATOR", result: "One source-bound campaign with a clear finish line."}),
    Object.freeze({id: "CAMPAIGN_BUILD", name: "Build the chosen change", owner: "NAMED_LANE_WORKERS", result: "A real change with focused checks."}),
    Object.freeze({id: "INDEPENDENT_AUDIT", name: "Check the result separately", owner: "INDEPENDENT_AUDITOR", result: "A truthful pass, repair finding, or clear stop."}),
    Object.freeze({id: "CAMPAIGN_CLOSURE", name: "Close or repair and continue", owner: "INTENT_REGULATOR", result: "Preserved handoff, closed temporary workers, and the next safe campaign."}),
  ]),
});

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireString(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function developmentPlanDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}
function digestInput(value) { return developmentPlanDigest(value ?? null); }

export function compileDevelopmentPlan({mode = DEFAULT_DEVELOPMENT_MODE, northStar, firstWorkflow, protectedBoundaries, firstCampaign} = {}) {
  assertUniversalDevelopmentMode(mode);
  assert(DEVELOPMENT_MODES.includes(mode), "development mode is invalid");
  requireRecord(northStar, "development plan North Star");
  requireRecord(firstWorkflow, "development plan first workflow");
  requireRecord(protectedBoundaries, "development plan protected boundaries");
  requireRecord(firstCampaign, "development plan first campaign");
  const plan = {
    schema: DEVELOPMENT_PLAN_SCHEMA,
    version: 1,
    status: "PLANNED",
    mode,
    user_facing_mode: mode === "RAPID_PROTOTYPING" ? "QUICK_FIRST_VERSION_THEN_IMPROVEMENTS" : "FRESH_SMALL_IMPROVEMENTS",
    persistent_roles: ["INTENT_REGULATOR", "RUNTIME"],
    temporary_role_rule: "CYCLE_CAMPAIGN_ORCHESTRATOR_AUDITOR_AND_ONE_NAMED_LANE_WORKER_PER_ADMITTED_LANE",
    phase_order: DEVELOPMENT_PHASES[mode].map((phase) => phase.id),
    phases: structuredClone(DEVELOPMENT_PHASES[mode]),
    intent_binding: {
      north_star_sha256: digestInput(northStar),
      first_workflow_sha256: digestInput(firstWorkflow),
      protected_boundaries_sha256: digestInput(protectedBoundaries),
      first_campaign_sha256: digestInput(firstCampaign),
    },
    continuation_rule: "Within unchanged intent, scope, source, policy, and capability, continue automatically; a changed condition closes this plan and creates a fresh source-bound successor.",
    boundary_rule: "Hard boundaries stop dependent work; soft boundaries go to Orchestrator review; bounded puzzles are repaired and rechecked.",
    universal_closeout: universalTaskCloseoutPolicy(mode),
    plan_sha256: null,
  };
  plan.plan_sha256 = developmentPlanDigest({...plan, plan_sha256: null});
  return validateDevelopmentPlan(plan, {northStar, firstWorkflow, protectedBoundaries, firstCampaign});
}

export function validateDevelopmentPlan(plan, {northStar = null, firstWorkflow = null, protectedBoundaries = null, firstCampaign = null} = {}) {
  requireRecord(plan, "development plan");
  assertUniversalDevelopmentMode(plan.mode);
  assert(plan.schema === DEVELOPMENT_PLAN_SCHEMA && plan.version === 1, "development plan identity is invalid");
  assert(plan.status === "PLANNED", "development plan status is invalid");
  assert(DEVELOPMENT_MODES.includes(plan.mode), "development plan mode is invalid");
  requireString(plan.user_facing_mode, "development plan user-facing mode");
  assert(JSON.stringify(plan.persistent_roles) === JSON.stringify(["INTENT_REGULATOR", "RUNTIME"]), "persistent development roles are invalid");
  requireString(plan.temporary_role_rule, "development plan temporary role rule");
  assert(JSON.stringify(plan.phase_order) === JSON.stringify(DEVELOPMENT_PHASES[plan.mode].map((phase) => phase.id)), "development plan phase order is invalid");
  assert(JSON.stringify(plan.phases) === JSON.stringify(DEVELOPMENT_PHASES[plan.mode]), "development plan phases are invalid");
  requireRecord(plan.intent_binding, "development plan intent binding");
  for (const field of ["north_star_sha256", "first_workflow_sha256", "protected_boundaries_sha256", "first_campaign_sha256"]) assert(typeof plan.intent_binding[field] === "string" && /^[0-9a-f]{64}$/u.test(plan.intent_binding[field]), `${field} is not a digest`);
  if (northStar !== null) assert(plan.intent_binding.north_star_sha256 === digestInput(northStar), "development plan North Star binding differs");
  if (firstWorkflow !== null) assert(plan.intent_binding.first_workflow_sha256 === digestInput(firstWorkflow), "development plan workflow binding differs");
  if (protectedBoundaries !== null) assert(plan.intent_binding.protected_boundaries_sha256 === digestInput(protectedBoundaries), "development plan boundary binding differs");
  if (firstCampaign !== null) assert(plan.intent_binding.first_campaign_sha256 === digestInput(firstCampaign), "development plan campaign binding differs");
  requireString(plan.continuation_rule, "development plan continuation rule");
  requireString(plan.boundary_rule, "development plan boundary rule");
  assert(JSON.stringify(plan.universal_closeout) === JSON.stringify(universalTaskCloseoutPolicy(plan.mode)),
    "development plan universal closeout policy differs from general governance");
  assert(typeof plan.plan_sha256 === "string" && /^[0-9a-f]{64}$/u.test(plan.plan_sha256), "development plan digest is invalid");
  assert(plan.plan_sha256 === developmentPlanDigest({...plan, plan_sha256: null}), "development plan digest mismatch");
  return plan;
}
