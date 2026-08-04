#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileAcceptedResultCostLedger,
  compileCascadeEconomicsObservation,
  compileFinalizerRewriteAssessment,
  compileTaskClassEconomics,
  validateAcceptedResultCostLedger,
  validateFinalizerRewriteAssessment,
  validateTaskClassEconomics,
} from "../control/cascade-economics.mjs";

const SHA = "a".repeat(64);
const directProof = "b".repeat(64);
const observedLedger = compileAcceptedResultCostLedger({
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  taskClass: "STANDARD_SUBSTANTIAL",
  costUnit: "PROJECT_COST_UNIT",
  cascadeComponents: {
    first_pass_implementation: 30,
    rolling_audit: 8,
    finalizer: 12,
    delta_reaudit: 4,
    additional_repair: 2,
    integration: 4,
  },
  directComponents: {
    full_implementation: 72,
    equivalent_final_audit: 18,
    equivalent_integration: 10,
  },
  observationKind: "OBSERVED_ACCEPTED_RESULTS",
  cascadeResultAccepted: true,
  directResultAccepted: true,
  cascadeAcceptanceSha256: SHA,
  directAcceptanceSha256: directProof,
});
validateAcceptedResultCostLedger(observedLedger);
assert.equal(observedLedger.cascade_total, 60);
assert.equal(observedLedger.direct_total, 100);
assert.equal(observedLedger.efficiency_ratio, 0.6);
assert.equal(observedLedger.decision, "COST_SAVING_DEMONSTRATED");

const estimatedLedger = compileAcceptedResultCostLedger({
  campaignId: "CAMPAIGN-ESTIMATE",
  campaignVersion: "v1",
  taskClass: "STANDARD_SUBSTANTIAL",
  costUnit: "PROJECT_COST_UNIT",
  cascadeComponents: {
    first_pass_implementation: 30,
    rolling_audit: 8,
    finalizer: 12,
    delta_reaudit: 4,
    additional_repair: 2,
    integration: 4,
  },
  directComponents: {
    full_implementation: 72,
    equivalent_final_audit: 18,
    equivalent_integration: 10,
  },
});
assert.equal(estimatedLedger.decision, "UNPROVEN");

const targetedInput = {
  relevant_hunks_replaced: 2,
  relevant_hunks_total: 10,
  files_substantially_rewritten: 0,
  public_contracts_reinterpreted: false,
  architecture_changed: false,
  owner_intent_recompiled: false,
  tests_rebuilt: false,
  new_platform_seams_added: false,
  load_bearing_implementation_replaced: false,
  broad_repository_rediscovery_required: false,
  first_pass_behavior_preserved: true,
  same_task_class_low_survival: false,
};
const targeted = compileFinalizerRewriteAssessment(targetedInput);
validateFinalizerRewriteAssessment(targeted);
assert.equal(targeted.one_third_replacement_warning, false);
assert.equal(targeted.classification, "TARGETED_REPAIR");

const warningOnly = compileFinalizerRewriteAssessment({...targetedInput, relevant_hunks_replaced: 4});
assert.equal(warningOnly.one_third_replacement_warning, true);
assert.equal(warningOnly.classification, "TARGETED_REPAIR");

const rebuild = compileFinalizerRewriteAssessment({...targetedInput, architecture_changed: true});
assert.equal(rebuild.classification, "REBUILD_REQUIRED");
assert(rebuild.rebuild_trigger_ids.includes("ARCHITECTURE_CHANGED"));

const observations = [0, 1, 2].map((index) => compileCascadeEconomicsObservation({
  campaignId: `CAMPAIGN-${index + 1}`,
  campaignVersion: "v1",
  taskClass: "STANDARD_SUBSTANTIAL",
  costLedger: compileAcceptedResultCostLedger({
    campaignId: `CAMPAIGN-${index + 1}`,
    campaignVersion: "v1",
    taskClass: "STANDARD_SUBSTANTIAL",
    costUnit: "PROJECT_COST_UNIT",
    cascadeComponents: observedLedger.cascade_components,
    directComponents: observedLedger.direct_components,
    observationKind: "OBSERVED_ACCEPTED_RESULTS",
    cascadeResultAccepted: true,
    directResultAccepted: true,
    cascadeAcceptanceSha256: SHA,
    directAcceptanceSha256: directProof,
  }),
  firstPassSurvived: true,
  finalizerRewriteDisposition: "TARGETED_REPAIR",
  auditCost: 8,
  repairRounds: 1,
  escapedFindings: 0,
  createdAtUtc: `2026-08-03T00:0${index}:00.000Z`,
}));
const aggregate = compileTaskClassEconomics({taskClass: "STANDARD_SUBSTANTIAL", observations});
validateTaskClassEconomics(aggregate);
assert.equal(aggregate.observation_count, 3);
assert.equal(aggregate.decision, "KEEP_CASCADE_DEFAULT");

let hostile = 0;
function hostileCase(label, operation) {
  assert.throws(operation, label);
  hostile += 1;
}

hostileCase("claimed savings without accepted results", () => {
  const invalid = {...estimatedLedger, observation_kind: "OBSERVED_ACCEPTED_RESULTS", decision: "COST_SAVING_DEMONSTRATED"};
  validateAcceptedResultCostLedger(invalid);
});
hostileCase("weakened savings threshold", () => {
  validateAcceptedResultCostLedger({...observedLedger, minimum_savings_target_ratio: 0.9});
});
hostileCase("rebuild mislabeled as targeted repair", () => {
  validateFinalizerRewriteAssessment({...rebuild, classification: "TARGETED_REPAIR"});
});
hostileCase("default before minimum observations", () => {
  const short = compileTaskClassEconomics({taskClass: "STANDARD_SUBSTANTIAL", observations: observations.slice(0, 2)});
  assert.notEqual(short.decision, "KEEP_CASCADE_DEFAULT");
  throw new Error("hostile assertion");
});

console.log(`PASS AgentOS cascade economics (${hostile} hostile cases, accepted-result ratio, telemetry, and Finalizer rewrite classification)`);
