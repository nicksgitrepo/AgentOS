#!/usr/bin/env node

import crypto from "node:crypto";

export const CASCADE_EFFICIENCY_TARGET = 0.75;
export const ECONOMICS_MINIMUM_OBSERVATIONS = 3;
export const CASCADE_COST_COMPONENTS = Object.freeze([
  "first_pass_implementation",
  "rolling_audit",
  "finalizer",
  "delta_reaudit",
  "additional_repair",
  "integration",
]);
export const DIRECT_COST_COMPONENTS = Object.freeze([
  "full_implementation",
  "equivalent_final_audit",
  "equivalent_integration",
]);
export const REWRITE_TRIGGER_IDS = Object.freeze([
  "PUBLIC_CONTRACT_REINTERPRETED",
  "ARCHITECTURE_CHANGED",
  "OWNER_INTENT_RECOMPILED",
  "LOAD_BEARING_IMPLEMENTATION_REPLACED",
  "BROAD_REPOSITORY_REDISCOVERY_REQUIRED",
  "FIRST_PASS_BEHAVIOR_NOT_PRESERVED",
  "REPEATED_LOW_ROUGH_SURVIVAL",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const REWRITE_DISPOSITIONS = new Set(["TARGETED_REPAIR", "REBUILD_REQUIRED"]);
const OBSERVATION_KINDS = new Set(["OBSERVED_ACCEPTED_RESULTS", "MIXED_ESTIMATE", "ESTIMATE_ONLY"]);
const ECONOMIC_DECISIONS = new Set([
  "COST_SAVING_DEMONSTRATED",
  "NONCOST_JUSTIFICATION_REQUIRED",
  "RECONSIDER_CASCADE",
  "UNPROVEN",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} contains an unsafe identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]), `${label} fields mismatch`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function economicsDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function finiteNonnegative(value, label) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0, `${label} must be a finite nonnegative number`);
}

function positiveFinite(value, label) {
  assert(typeof value === "number" && Number.isFinite(value) && value > 0, `${label} must be a finite positive number`);
}

function safeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative safe integer`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length && canonicalJson(values) === canonicalJson(sorted), `${label} must be unique and UTF-8 sorted`);
  return sorted;
}

function validateCostComponents(value, keys, label) {
  exactKeys(value, keys, label);
  for (const key of keys) finiteNonnegative(value[key], `${label}.${key}`);
  return value;
}

function totalCost(value, keys) {
  return keys.reduce((total, key) => total + value[key], 0);
}

function roundedRatio(value) {
  return Math.round(value * 1e12) / 1e12;
}

function deriveEconomicDecision({observationKind, observation_kind: observationKindSnake, cascadeTotal, cascade_total: cascadeTotalSnake, directTotal, direct_total: directTotalSnake}) {
  const kind = observationKind ?? observationKindSnake;
  const cascade = cascadeTotal ?? cascadeTotalSnake;
  const direct = directTotal ?? directTotalSnake;
  if (kind !== "OBSERVED_ACCEPTED_RESULTS") return "UNPROVEN";
  const ratio = cascade / direct;
  if (ratio <= CASCADE_EFFICIENCY_TARGET) return "COST_SAVING_DEMONSTRATED";
  if (ratio <= 1) return "NONCOST_JUSTIFICATION_REQUIRED";
  return "RECONSIDER_CASCADE";
}

const COST_LEDGER_KEYS = [
  "schema", "campaign_id", "campaign_version", "task_class", "cost_unit",
  "cascade_components", "direct_components", "cascade_total", "direct_total",
  "efficiency_ratio", "minimum_savings_target_ratio", "comparison_basis",
  "observation_kind", "cascade_result_accepted", "direct_result_accepted",
  "cascade_acceptance_sha256", "direct_acceptance_sha256", "decision", "ledger_sha256",
];

export function validateAcceptedResultCostLedger(ledger) {
  exactKeys(ledger, COST_LEDGER_KEYS, "accepted-result cost ledger");
  assert(ledger.schema === "governance.accepted_result_cost_ledger.v1", "accepted-result cost ledger schema mismatch");
  for (const field of ["campaign_id", "campaign_version", "task_class", "cost_unit", "comparison_basis", "observation_kind", "decision"]) requireIdentifier(ledger[field], `cost ledger ${field}`);
  validateCostComponents(ledger.cascade_components, CASCADE_COST_COMPONENTS, "cascade cost components");
  validateCostComponents(ledger.direct_components, DIRECT_COST_COMPONENTS, "direct cost components");
  finiteNonnegative(ledger.cascade_total, "cascade total");
  positiveFinite(ledger.direct_total, "direct total");
  assert(ledger.cascade_total === totalCost(ledger.cascade_components, CASCADE_COST_COMPONENTS), "cascade total is not derived");
  assert(ledger.direct_total === totalCost(ledger.direct_components, DIRECT_COST_COMPONENTS), "direct total is not derived");
  assert(ledger.efficiency_ratio === roundedRatio(ledger.cascade_total / ledger.direct_total), "efficiency ratio is not derived");
  assert(ledger.minimum_savings_target_ratio === CASCADE_EFFICIENCY_TARGET, "cascade savings target was weakened");
  assert(ledger.comparison_basis === "EQUIVALENT_ACCEPTED_RESULT_COST", "cost comparison basis is invalid");
  assert(OBSERVATION_KINDS.has(ledger.observation_kind), "cost ledger observation kind is invalid");
  assert(typeof ledger.cascade_result_accepted === "boolean" && typeof ledger.direct_result_accepted === "boolean", "cost ledger acceptance flags are invalid");
  for (const field of ["cascade_acceptance_sha256", "direct_acceptance_sha256"]) {
    if (ledger[field] !== null) requireSha(ledger[field], `cost ledger ${field}`);
  }
  if (ledger.observation_kind === "OBSERVED_ACCEPTED_RESULTS") {
    assert(ledger.cascade_result_accepted && ledger.direct_result_accepted, "observed cost comparison requires two accepted results");
    requireSha(ledger.cascade_acceptance_sha256, "cascade acceptance proof");
    requireSha(ledger.direct_acceptance_sha256, "direct accepted-result proof");
  }
  assert(ledger.decision === deriveEconomicDecision(ledger), "cost ledger decision is not derived from observed accepted-result cost");
  assert(ECONOMIC_DECISIONS.has(ledger.decision), "cost ledger decision is invalid");
  requireSha(ledger.ledger_sha256, "cost ledger digest");
  const body = structuredClone(ledger);
  delete body.ledger_sha256;
  assert(ledger.ledger_sha256 === economicsDigest(body), "cost ledger is not content-addressed");
  return ledger;
}

export function compileAcceptedResultCostLedger({
  campaignId,
  campaignVersion,
  taskClass,
  costUnit,
  cascadeComponents,
  directComponents,
  observationKind = "ESTIMATE_ONLY",
  cascadeResultAccepted = false,
  directResultAccepted = false,
  cascadeAcceptanceSha256 = null,
  directAcceptanceSha256 = null,
}) {
  for (const [value, label] of [[campaignId, "campaign ID"], [campaignVersion, "campaign version"], [taskClass, "task class"], [costUnit, "cost unit"]]) requireIdentifier(value, label);
  assert(OBSERVATION_KINDS.has(observationKind), "cost ledger observation kind is invalid");
  const cascade = validateCostComponents(structuredClone(cascadeComponents), CASCADE_COST_COMPONENTS, "cascade cost components");
  const direct = validateCostComponents(structuredClone(directComponents), DIRECT_COST_COMPONENTS, "direct cost components");
  const ledger = {
    schema: "governance.accepted_result_cost_ledger.v1",
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    task_class: taskClass,
    cost_unit: costUnit,
    cascade_components: cascade,
    direct_components: direct,
    cascade_total: totalCost(cascade, CASCADE_COST_COMPONENTS),
    direct_total: totalCost(direct, DIRECT_COST_COMPONENTS),
    efficiency_ratio: 0,
    minimum_savings_target_ratio: CASCADE_EFFICIENCY_TARGET,
    comparison_basis: "EQUIVALENT_ACCEPTED_RESULT_COST",
    observation_kind: observationKind,
    cascade_result_accepted: cascadeResultAccepted,
    direct_result_accepted: directResultAccepted,
    cascade_acceptance_sha256: cascadeAcceptanceSha256,
    direct_acceptance_sha256: directAcceptanceSha256,
    decision: "UNPROVEN",
    ledger_sha256: "",
  };
  assert(ledger.direct_total > 0, "direct accepted-result cost must be positive");
  ledger.efficiency_ratio = roundedRatio(ledger.cascade_total / ledger.direct_total);
  ledger.decision = deriveEconomicDecision(ledger);
  const body = structuredClone(ledger);
  delete body.ledger_sha256;
  ledger.ledger_sha256 = economicsDigest(body);
  validateAcceptedResultCostLedger(ledger);
  return ledger;
}

const REWRITE_INPUT_KEYS = [
  "relevant_hunks_replaced", "relevant_hunks_total", "files_substantially_rewritten",
  "public_contracts_reinterpreted", "architecture_changed", "owner_intent_recompiled",
  "tests_rebuilt", "new_platform_seams_added", "load_bearing_implementation_replaced",
  "broad_repository_rediscovery_required", "first_pass_behavior_preserved", "same_task_class_low_survival",
];
const REWRITE_ASSESSMENT_KEYS = [
  ...REWRITE_INPUT_KEYS, "relevant_hunk_replacement_ratio", "one_third_replacement_warning",
  "rebuild_trigger_ids", "classification", "assessment_sha256",
];

function deriveRewriteTriggers(input) {
  const triggers = [];
  const mapping = [
    ["public_contracts_reinterpreted", "PUBLIC_CONTRACT_REINTERPRETED"],
    ["architecture_changed", "ARCHITECTURE_CHANGED"],
    ["owner_intent_recompiled", "OWNER_INTENT_RECOMPILED"],
    ["load_bearing_implementation_replaced", "LOAD_BEARING_IMPLEMENTATION_REPLACED"],
    ["broad_repository_rediscovery_required", "BROAD_REPOSITORY_REDISCOVERY_REQUIRED"],
    ["first_pass_behavior_preserved", "FIRST_PASS_BEHAVIOR_NOT_PRESERVED", false],
    ["same_task_class_low_survival", "REPEATED_LOW_ROUGH_SURVIVAL"],
  ];
  for (const [field, id, expected = true] of mapping) if (input[field] === expected) triggers.push(id);
  return triggers.sort(compareUtf8);
}

export function validateFinalizerRewriteAssessment(assessment) {
  exactKeys(assessment, REWRITE_ASSESSMENT_KEYS, "Finalizer rewrite assessment");
  for (const field of ["relevant_hunks_replaced", "relevant_hunks_total", "files_substantially_rewritten"]) safeInteger(assessment[field], `rewrite assessment ${field}`);
  assert(assessment.relevant_hunks_replaced <= assessment.relevant_hunks_total, "rewrite assessment replaced hunks exceed relevant hunks");
  for (const field of ["public_contracts_reinterpreted", "architecture_changed", "owner_intent_recompiled", "tests_rebuilt", "new_platform_seams_added", "load_bearing_implementation_replaced", "broad_repository_rediscovery_required", "first_pass_behavior_preserved", "same_task_class_low_survival"]) assert(typeof assessment[field] === "boolean", `rewrite assessment ${field} is invalid`);
  const ratio = assessment.relevant_hunks_total === 0 ? 0 : roundedRatio(assessment.relevant_hunks_replaced / assessment.relevant_hunks_total);
  assert(assessment.relevant_hunk_replacement_ratio === ratio, "rewrite hunk ratio is not derived");
  assert(assessment.one_third_replacement_warning === (ratio >= 1 / 3), "rewrite one-third warning is not derived");
  const triggers = deriveRewriteTriggers(assessment);
  assert(canonicalJson(assessment.rebuild_trigger_ids) === canonicalJson(triggers), "rewrite triggers are not derived");
  assert(REWRITE_DISPOSITIONS.has(assessment.classification), "rewrite classification is invalid");
  assert(assessment.classification === (triggers.length > 0 ? "REBUILD_REQUIRED" : "TARGETED_REPAIR"), "rewrite classification is not derived");
  requireSha(assessment.assessment_sha256, "rewrite assessment digest");
  const body = structuredClone(assessment);
  delete body.assessment_sha256;
  assert(assessment.assessment_sha256 === economicsDigest(body), "rewrite assessment is not content-addressed");
  return assessment;
}

export function compileFinalizerRewriteAssessment(input) {
  exactKeys(input, REWRITE_INPUT_KEYS, "Finalizer rewrite assessment input");
  const assessment = {
    ...structuredClone(input),
    relevant_hunk_replacement_ratio: input.relevant_hunks_total === 0 ? 0 : roundedRatio(input.relevant_hunks_replaced / input.relevant_hunks_total),
    one_third_replacement_warning: input.relevant_hunks_total === 0 ? false : input.relevant_hunks_replaced / input.relevant_hunks_total >= 1 / 3,
    rebuild_trigger_ids: deriveRewriteTriggers(input),
    classification: deriveRewriteTriggers(input).length > 0 ? "REBUILD_REQUIRED" : "TARGETED_REPAIR",
    assessment_sha256: "",
  };
  const body = structuredClone(assessment);
  delete body.assessment_sha256;
  assessment.assessment_sha256 = economicsDigest(body);
  validateFinalizerRewriteAssessment(assessment);
  return assessment;
}

const OBSERVATION_INPUT_KEYS = [
  "campaign_id", "campaign_version", "task_class", "cost_ledger", "first_pass_survived",
  "finalizer_rewrite_disposition", "audit_cost", "repair_rounds", "escaped_findings", "created_at_utc",
];
const OBSERVATION_KEYS = [
  "schema", "campaign_id", "campaign_version", "task_class", "cost_ledger_sha256", "efficiency_ratio",
  "first_pass_survived", "finalizer_rewrite_disposition", "audit_cost", "repair_rounds", "escaped_findings",
  "accepted_result_cost", "created_at_utc", "observation_sha256",
];

export function validateCascadeEconomicsObservation(observation) {
  exactKeys(observation, OBSERVATION_KEYS, "cascade economics observation");
  assert(observation.schema === "governance.cascade_economics_observation.v1", "cascade economics observation schema mismatch");
  for (const field of ["campaign_id", "campaign_version", "task_class", "finalizer_rewrite_disposition"]) requireIdentifier(observation[field], `economics observation ${field}`);
  requireSha(observation.cost_ledger_sha256, "economics observation cost ledger");
  finiteNonnegative(observation.efficiency_ratio, "economics observation efficiency ratio");
  assert(typeof observation.first_pass_survived === "boolean", "economics observation first-pass survival is invalid");
  assert(REWRITE_DISPOSITIONS.has(observation.finalizer_rewrite_disposition), "economics observation rewrite disposition is invalid");
  finiteNonnegative(observation.audit_cost, "economics observation audit cost");
  safeInteger(observation.repair_rounds, "economics observation repair rounds");
  safeInteger(observation.escaped_findings, "economics observation escaped findings");
  finiteNonnegative(observation.accepted_result_cost, "economics observation accepted-result cost");
  requireUtc(observation.created_at_utc, "economics observation timestamp");
  requireSha(observation.observation_sha256, "economics observation digest");
  const body = structuredClone(observation);
  delete body.observation_sha256;
  assert(observation.observation_sha256 === economicsDigest(body), "economics observation is not content-addressed");
  return observation;
}

export function compileCascadeEconomicsObservation({campaignId, campaignVersion, taskClass, costLedger, firstPassSurvived, finalizerRewriteDisposition, auditCost, repairRounds, escapedFindings, createdAtUtc}) {
  validateAcceptedResultCostLedger(costLedger);
  for (const [value, label] of [[campaignId, "campaign ID"], [campaignVersion, "campaign version"], [taskClass, "task class"]]) requireIdentifier(value, label);
  assert(costLedger.observation_kind === "OBSERVED_ACCEPTED_RESULTS" && costLedger.cascade_result_accepted, "economics observation requires an observed accepted cascade result");
  const observation = {
    schema: "governance.cascade_economics_observation.v1",
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    task_class: taskClass,
    cost_ledger_sha256: costLedger.ledger_sha256,
    efficiency_ratio: costLedger.efficiency_ratio,
    first_pass_survived: firstPassSurvived,
    finalizer_rewrite_disposition: finalizerRewriteDisposition,
    audit_cost: auditCost,
    repair_rounds: repairRounds,
    escaped_findings: escapedFindings,
    accepted_result_cost: costLedger.cascade_total,
    created_at_utc: createdAtUtc,
    observation_sha256: "",
  };
  const body = structuredClone(observation);
  delete body.observation_sha256;
  observation.observation_sha256 = economicsDigest(body);
  validateCascadeEconomicsObservation(observation);
  return observation;
}

const AGGREGATE_KEYS = [
  "schema", "task_class", "observation_count", "minimum_observations_before_default",
  "first_pass_survival_rate", "finalizer_rebuild_rate", "audit_cost_total", "repair_round_total",
  "escaped_finding_total", "accepted_result_cost_total", "mean_efficiency_ratio",
  "all_results_accepted", "decision", "observation_sha256", "aggregate_sha256",
];

export function validateTaskClassEconomics(aggregate) {
  exactKeys(aggregate, AGGREGATE_KEYS, "task-class economics aggregate");
  assert(aggregate.schema === "governance.task_class_economics.v1", "task-class economics schema mismatch");
  requireIdentifier(aggregate.task_class, "task-class economics task class");
  safeInteger(aggregate.observation_count, "task-class observation count");
  assert(aggregate.minimum_observations_before_default === ECONOMICS_MINIMUM_OBSERVATIONS, "task-class minimum observation floor was weakened");
  for (const field of ["first_pass_survival_rate", "finalizer_rebuild_rate", "audit_cost_total", "accepted_result_cost_total", "mean_efficiency_ratio"]) finiteNonnegative(aggregate[field], `task-class ${field}`);
  safeInteger(aggregate.repair_round_total, "task-class repair rounds");
  safeInteger(aggregate.escaped_finding_total, "task-class escaped findings");
  assert(typeof aggregate.all_results_accepted === "boolean", "task-class accepted-result flag is invalid");
  assert(["KEEP_CASCADE_DEFAULT", "NONCOST_JUSTIFICATION_REQUIRED", "RECONSIDER_CASCADE", "UNPROVEN"].includes(aggregate.decision), "task-class economics decision is invalid");
  sortedUnique(aggregate.observation_sha256, "task-class observation digests").forEach((digest) => requireSha(digest, "task-class observation digest"));
  requireSha(aggregate.aggregate_sha256, "task-class aggregate digest");
  const body = structuredClone(aggregate);
  delete body.aggregate_sha256;
  assert(aggregate.aggregate_sha256 === economicsDigest(body), "task-class economics aggregate is not content-addressed");
  return aggregate;
}

export function compileTaskClassEconomics({taskClass, observations}) {
  requireIdentifier(taskClass, "task class");
  assert(Array.isArray(observations), "task-class economics observations are required");
  const ordered = observations.map((observation) => validateCascadeEconomicsObservation(structuredClone(observation)))
    .sort((left, right) => compareUtf8(left.observation_sha256, right.observation_sha256));
  assert(ordered.every((observation) => observation.task_class === taskClass), "task-class aggregate contains another task class");
  const count = ordered.length;
  const accepted = count > 0;
  const rebuilds = ordered.filter((observation) => observation.finalizer_rewrite_disposition === "REBUILD_REQUIRED").length;
  const ratioTotal = ordered.reduce((total, observation) => total + observation.efficiency_ratio, 0);
  const decision = count < ECONOMICS_MINIMUM_OBSERVATIONS || !accepted
    ? "UNPROVEN"
    : ordered.every((observation) => observation.efficiency_ratio <= CASCADE_EFFICIENCY_TARGET && observation.finalizer_rewrite_disposition === "TARGETED_REPAIR")
      ? "KEEP_CASCADE_DEFAULT"
      : ratioTotal / count <= 1 ? "NONCOST_JUSTIFICATION_REQUIRED" : "RECONSIDER_CASCADE";
  const aggregate = {
    schema: "governance.task_class_economics.v1",
    task_class: taskClass,
    observation_count: count,
    minimum_observations_before_default: ECONOMICS_MINIMUM_OBSERVATIONS,
    first_pass_survival_rate: count === 0 ? 0 : ordered.filter((observation) => observation.first_pass_survived).length / count,
    finalizer_rebuild_rate: count === 0 ? 0 : rebuilds / count,
    audit_cost_total: ordered.reduce((total, observation) => total + observation.audit_cost, 0),
    repair_round_total: ordered.reduce((total, observation) => total + observation.repair_rounds, 0),
    escaped_finding_total: ordered.reduce((total, observation) => total + observation.escaped_findings, 0),
    accepted_result_cost_total: ordered.reduce((total, observation) => total + observation.accepted_result_cost, 0),
    mean_efficiency_ratio: count === 0 ? 0 : roundedRatio(ratioTotal / count),
    all_results_accepted: accepted,
    decision,
    observation_sha256: ordered.map((observation) => observation.observation_sha256),
    aggregate_sha256: "",
  };
  const body = structuredClone(aggregate);
  delete body.aggregate_sha256;
  aggregate.aggregate_sha256 = economicsDigest(body);
  validateTaskClassEconomics(aggregate);
  return aggregate;
}
