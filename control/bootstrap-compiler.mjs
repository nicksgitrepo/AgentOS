#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyCorpusPlan,
  canonicalCompactJson,
  compileCorpusPlan,
} from "./authority-corpus.mjs";
import {
  compileLegacyPreservationPlan,
  inspectLegacySource,
  preserveLegacyCorpus,
  verifyLegacyPreservation,
} from "./legacy-preservation.mjs";
import {discoverProject, EPISTEMIC_CLASSES} from "./bootstrap-discovery.mjs";
import {
  compileDeliveryPolicy,
  createDeliveryProbePlan,
  runDeliveryProbes,
  validateDeliveryPolicy,
  validateDeliveryProbePlan,
  validateDeliveryProbeResults,
} from "./delivery-policy.mjs";

export const DISCOVERY_MODES = Object.freeze(["RECOMMENDED", "GUIDED", "EXPERT", "LOCAL_ONLY", "MANUAL"]);
export const QUESTION_CLASSES = Object.freeze(["DISCOVERY_PERMISSION", "OWNER_INTENT", "OWNER_BOUNDARY", "MATERIAL_PREFERENCE", "CREATION_AUTHORIZATION"]);
export const PLAN_APPROVAL = "APPROVE_EXACT_PLAN";
export const EXECUTION_PHASES = Object.freeze(["PLANNED", "APPROVED", "STAGING", "SEALED", "PROMOTED", "CANCELLED"]);
export const MODEL_PROFILES = Object.freeze({
  ECO_CONTINUOUS: {window_hours: 168, work_slots: 20, max_concurrent_slots: 20, average_active_slots: null, task_volume_multiplier: 20, objective: "MINIMIZE_EXPECTED_COST_PER_ACCEPTED_RESULT"},
  STANDARD_WORKWEEK: {window_hours: 40, work_slots: 1, max_concurrent_slots: 1, average_active_slots: 1, task_volume_multiplier: 1, objective: "MINIMIZE_EXPECTED_COST_PER_ACCEPTED_RESULT"},
  PERFORMANCE: {window_hours: 40, work_slots: 1, max_concurrent_slots: 1, average_active_slots: 1, task_volume_multiplier: 1, objective: "MINIMIZE_ELAPSED_TIME_AFTER_COMPLETION_FLOOR"},
  CUSTOM: {window_hours: null, work_slots: null, max_concurrent_slots: null, average_active_slots: null, task_volume_multiplier: null, objective: "USE_TYPED_CUSTOM_CONDITIONS"},
});
const MODEL_ALIASES = new Map([["ECO", "ECO_CONTINUOUS"], ["ECONOMICAL", "ECO_CONTINUOUS"]]);
const REASONING_ORDER = new Map([["LOW", 1], ["MEDIUM", 2], ["HIGH", 3], ["HIGHEST", 4]]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SAFE_FACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu;

export const BOOTSTRAP_QUESTIONS = Object.freeze([
  {
    id: "bootstrap.discovery.mode",
    class: "DISCOVERY_PERMISSION",
    prompt: "May Bootstrap perform safe read-only discovery so it can answer technical setup questions for you?",
    type: "ENUM",
    choices: DISCOVERY_MODES,
    recommended: "RECOMMENDED",
    required: true,
  },
  {
    id: "project.north_star",
    class: "OWNER_INTENT",
    prompt: "Who is this for, what recurring moment matters, and what should be better after the project works?",
    type: "JSON",
    output: "NORTH_STAR",
    required: true,
  },
  {
    id: "project.first_workflow",
    class: "OWNER_INTENT",
    prompt: "What is the smallest real workflow that proves the project is useful, and what does working mean?",
    type: "JSON",
    output: "PROVING_WORKFLOW",
    required: true,
  },
  {
    id: "project.boundary",
    class: "OWNER_BOUNDARY",
    prompt: "Which repositories, data, environments, and external systems belong inside the project boundary?",
    type: "JSON",
    output: "PROJECT_DEFINITION",
    required: true,
  },
  {
    id: "project.protected_boundaries",
    class: "OWNER_BOUNDARY",
    prompt: "Which safety, legal, privacy, data-loss, spending, authentication, irreversible-action, or intent boundaries remain owner-controlled?",
    type: "JSON",
    output: "AUTHORITY_BOUNDARIES",
    required: true,
  },
  {
    id: "authority-corpus.source",
    class: "CREATION_AUTHORIZATION",
    prompt: "Should Bootstrap import, refactor, or create the authority corpus, and which read-only source should be preserved?",
    type: "JSON",
    output: "AUTHORITY_CORPUS",
    required: true,
  },
  {
    id: "project.design",
    class: "OWNER_INTENT",
    prompt: "Which users, devices, accessibility needs, protected visual surfaces, page families, and states must the Design Bible govern?",
    type: "JSON",
    output: "DESIGN_BIBLE",
    required: false,
    askWhen: "VISIBLE_SURFACE_OR_DESIGN_AUTHORITY",
  },
  {
    id: "project.technical_baseline",
    class: "MATERIAL_PREFERENCE",
    prompt: "Are any stack, authentication, testing, data, or observability choices required or forbidden?",
    type: "JSON",
    output: "TECHNICAL_BASELINE",
    required: false,
    askWhen: "CONFLICT_OR_MISSING_TECHNICAL_BASELINE",
  },
  {
    id: "project.delivery_policy",
    class: "MATERIAL_PREFERENCE",
    prompt: "How should Bootstrap handle pushes, merges, CI runners, hosting, deployment, rollback, provider binding, and delivery cost limits?",
    type: "JSON",
    output: "DELIVERY_POLICY",
    required: true,
    askWhen: "CONFLICT_OR_MISSING_DELIVERY_POLICY",
  },
  {
    id: "project.model_economics",
    class: "MATERIAL_PREFERENCE",
    prompt: "Which operating conditions apply: continuous eco, standard workweek, performance-first, or typed custom conditions?",
    type: "JSON",
    output: "MODEL_POLICY",
    required: true,
  },
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

function requireId(value, label) {
  requireString(value, label);
  assert(SAFE_ID.test(value), `${label} contains an unsafe identifier`);
}

function requireFactId(value, label) {
  requireString(value, label);
  assert(SAFE_FACT_ID.test(value) && !value.split("/").includes("..") && !value.includes("//"), `${label} contains an unsafe identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text) && !/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains secret material`);
}

export function normalizeModelProfile(value) {
  requireString(value, "model economics profile");
  const profile = MODEL_ALIASES.get(value) ?? value;
  assert(Object.hasOwn(MODEL_PROFILES, profile), "unknown model economics profile");
  return profile;
}

export function compileModelEconomics(input) {
  requireRecord(input, "model economics");
  const profile = normalizeModelProfile(input.profile);
  const completionFloor = input.completion_floor ?? 0.8;
  assert(typeof completionFloor === "number" && completionFloor > 0 && completionFloor <= 1, "completion floor is invalid");
  if (profile === "CUSTOM") {
    requireRecord(input.conditions ?? input.custom_conditions, "custom model conditions");
  } else {
    assert(input.conditions === undefined && input.custom_conditions === undefined, "non-custom economics cannot carry custom conditions");
  }
  const economics = {
    profile,
    profile_alias: profile === input.profile ? null : input.profile,
    window_hours: MODEL_PROFILES[profile].window_hours ?? input.window_hours ?? null,
    work_slots: MODEL_PROFILES[profile].work_slots ?? input.work_slots ?? null,
    max_concurrent_slots: MODEL_PROFILES[profile].max_concurrent_slots ?? input.max_concurrent_slots ?? input.work_slots ?? null,
    average_active_slots: MODEL_PROFILES[profile].average_active_slots ?? input.average_active_slots ?? null,
    task_volume_multiplier: MODEL_PROFILES[profile].task_volume_multiplier ?? input.task_volume_multiplier ?? null,
    completion_floor: completionFloor,
    max_expected_cost: input.max_expected_cost ?? null,
    weekly_budget_ceiling: input.weekly_budget_ceiling ?? null,
    warning_threshold: input.warning_threshold ?? null,
    concurrency_throttle: input.concurrency_throttle ?? "PAUSE_NEW_LOW_PRIORITY_WORK_AT_CAPACITY",
    promotion_trigger: input.promotion_trigger ?? "PROMOTE_ONLY_AFTER_COMPLETION_FLOOR_OR_REWORK_SIGNAL",
    below_floor_action: "REJECT",
    no_eligible_model_action: "FAIL_CLOSED",
    no_feasible_budget_action: "FAIL_CLOSED",
    deadline_hours: input.deadline_hours ?? null,
    conditions: input.conditions ?? input.custom_conditions ?? null,
  };
  for (const field of ["window_hours", "work_slots", "max_concurrent_slots", "average_active_slots", "task_volume_multiplier", "max_expected_cost", "weekly_budget_ceiling", "warning_threshold", "deadline_hours"]) {
    if (economics[field] !== null) assert(typeof economics[field] === "number" && Number.isFinite(economics[field]) && economics[field] > 0, `${field} is invalid`);
  }
  if (economics.average_active_slots !== null && economics.max_concurrent_slots !== null) {
    assert(economics.average_active_slots <= economics.max_concurrent_slots, "average active slots exceed maximum concurrency");
  }
  secretFree(economics, "model economics");
  return economics;
}

function candidateExpectedCost(candidate) {
  const overhead = (candidate.supervisor_cost ?? 0) + (candidate.repair_cost ?? 0) + (candidate.integration_cost ?? 0);
  const completionProbability = candidate.estimated_success_probability;
  const expected = (candidate.estimated_attempts * candidate.relative_unit_cost + overhead) / completionProbability;
  return {
    low: (candidate.estimated_attempts * (candidate.relative_unit_cost_low ?? candidate.relative_unit_cost) + overhead) / completionProbability,
    expected,
    high: (candidate.estimated_attempts * (candidate.relative_unit_cost_high ?? candidate.relative_unit_cost) + overhead) / completionProbability,
    completion_probability: completionProbability,
  };
}

export function recommendModels({economics: inputEconomics, candidates, role = null, requirements = {}}) {
  const economics = compileModelEconomics(inputEconomics);
  requireRecord(requirements, "model requirements");
  assert(Array.isArray(candidates) && candidates.length > 0, "model candidates are required");
  const eligible = [];
  const excluded = [];
  for (const [index, candidate] of candidates.entries()) {
    try {
      requireRecord(candidate, `model candidate ${index}`);
      for (const field of ["model", "reasoning"]) requireString(candidate[field], `model candidate ${field}`);
      assert(candidate.spawnable === true, "NOT_SPAWNABLE");
      for (const field of ["estimated_success_probability", "estimated_attempts", "relative_unit_cost"]) assert(typeof candidate[field] === "number" && candidate[field] > 0, `${field.toUpperCase()}_INVALID`);
      assert(candidate.estimated_success_probability <= 1, "SUCCESS_PROBABILITY_INVALID");
      for (const field of ["relative_unit_cost_low", "relative_unit_cost_high"]) {
        if (candidate[field] !== undefined) assert(typeof candidate[field] === "number" && candidate[field] > 0, `${field.toUpperCase()}_INVALID`);
      }
      for (const field of ["supervisor_cost", "repair_cost", "integration_cost"]) {
        if (candidate[field] !== undefined) assert(typeof candidate[field] === "number" && Number.isFinite(candidate[field]) && candidate[field] >= 0, `${field.toUpperCase()}_INVALID`);
      }
      if (candidate.estimated_wall_hours !== undefined) assert(typeof candidate.estimated_wall_hours === "number" && Number.isFinite(candidate.estimated_wall_hours) && candidate.estimated_wall_hours > 0, "ESTIMATED_WALL_HOURS_INVALID");
      if (candidate.estimated_success_probability < economics.completion_floor) throw new Error("BELOW_COMPLETION_FLOOR");
      if (requirements.required_context_window !== undefined) assert((candidate.context_window ?? 0) >= requirements.required_context_window, "CONTEXT_WINDOW_FLOOR");
      if (requirements.required_tools !== undefined) assert(requirements.required_tools.every((tool) => (candidate.tools ?? []).includes(tool)), "REQUIRED_TOOL_UNAVAILABLE");
      if (requirements.minimum_reasoning !== undefined) assert((REASONING_ORDER.get(candidate.reasoning.toUpperCase()) ?? 0) >= (REASONING_ORDER.get(String(requirements.minimum_reasoning).toUpperCase()) ?? Infinity), "REASONING_FLOOR");
      const range = candidateExpectedCost(candidate);
      if (economics.deadline_hours !== null && candidate.estimated_wall_hours !== undefined) assert(candidate.estimated_wall_hours <= economics.deadline_hours, "DEADLINE_UNMET");
      if (economics.max_expected_cost !== null) assert(range.expected <= economics.max_expected_cost, "OVER_EXPECTED_COST_BUDGET");
      const loadFactor = economics.task_volume_multiplier ?? 1;
      const expectedWindowCost = range.expected * loadFactor;
      if (economics.weekly_budget_ceiling !== null) assert(expectedWindowCost <= economics.weekly_budget_ceiling, "OVER_WINDOW_COST_BUDGET");
      eligible.push({...candidate, expected_completion_cost: range.expected, expected_completion_cost_range: range, expected_window_cost: expectedWindowCost});
    } catch (error) {
      excluded.push({model: candidate?.model ?? `candidate-${index}`, reason: error.message});
    }
  }
  if (eligible.length === 0) throw new Error(excluded.some((entry) => ["OVER_EXPECTED_COST_BUDGET", "OVER_WINDOW_COST_BUDGET"].includes(entry.reason)) ? "NO_FEASIBLE_MODEL_UNDER_BUDGET" : "NO_ELIGIBLE_MODEL");
  eligible.sort((left, right) => (economics.profile === "PERFORMANCE"
    ? (left.estimated_wall_hours ?? Infinity) - (right.estimated_wall_hours ?? Infinity)
    : left.expected_completion_cost - right.expected_completion_cost)
    || right.estimated_success_probability - left.estimated_success_probability
    || compareUtf8(left.model, right.model));
  return {
    schema: "agentos.model_recommendation.v2",
    role,
    economics,
    requirements,
    recommended: eligible[0],
    eligible,
    excluded: excluded.sort((left, right) => compareUtf8(`${left.model}\0${left.reason}`, `${right.model}\0${right.reason}`)),
    recommendation_sha256: canonicalDigest({role, economics, requirements, eligible, excluded}),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8)
    .map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function validateFact(fact) {
  requireRecord(fact, "discovery fact");
  requireFactId(fact.fact_id, "discovery fact ID");
  requireString(fact.source_kind, "discovery fact source");
  requireString(fact.source_locator, "discovery fact locator");
  assert(["OBSERVED_FACT", "CANDIDATE_INTERPRETATION", "CONFLICT", "UNKNOWN"].includes(fact.status ?? "OBSERVED_FACT"), "discovery fact status is invalid");
  requireString(fact.epistemic_class, "discovery fact epistemic class");
  assert(EPISTEMIC_CLASSES.includes(fact.epistemic_class), "discovery fact epistemic class is invalid");
  assert(fact.secret_free === true, "discovery fact must be secret-free");
  secretFree(fact, "discovery fact");
}

function factsFor(discovery, predicate) {
  return discovery.filter(predicate);
}

function hasFact(discovery, pattern) {
  return discovery.some((fact) => pattern.test(fact.fact_id) && fact.status !== "CONFLICT");
}

function hasObservedFact(discovery, pattern) {
  return discovery.some((fact) => pattern.test(fact.fact_id) && fact.status === "OBSERVED_FACT");
}

function deriveTechnicalBaseline(discovery, answer) {
  const markers = discovery.filter((fact) => fact.fact_id.startsWith("project.marker.") && fact.status === "OBSERVED_FACT")
    .map((fact) => fact.fact_id.slice("project.marker.".length)).sort(compareUtf8);
  const framework = discovery.find((fact) => /^stack\./u.test(fact.fact_id) && fact.status === "OBSERVED_FACT")?.value ?? "UNPROVEN_FROM_DISCOVERY";
  const constraints = answer === undefined ? null : {
    required: answer.required ?? [],
    forbidden: answer.forbidden ?? [],
    testing: answer.testing ?? null,
    authentication: answer.authentication ?? null,
    data: answer.data ?? null,
    observability: answer.observability ?? null,
  };
  return {
    status: framework === "UNPROVEN_FROM_DISCOVERY" && markers.length === 0 ? "REQUIRES_OWNER_CONFIRMATION" : "DISCOVERED_BASELINE",
    detected_markers: markers,
    framework,
    stack: {
      language: answer?.language ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
      client: answer?.client ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
      backend: answer?.backend ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
      database: answer?.database ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
      authentication: answer?.authentication ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
      storage: answer?.storage ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
      package_manager: answer?.package_manager ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
      observability: answer?.observability ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
    },
    testing: {route: answer?.testing ?? "DISCOVERY_OR_OWNER_BOUND_CONFIGURATION", browser: "UNSELECTED_UNTIL_PROJECT_CONTEXT"},
    authentication: {route: answer?.authentication ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT"},
    data: {storage: answer?.storage ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT", backup_and_recovery: answer?.backup_and_recovery ?? "REQUIRED_EXACT_POLICY"},
    observability: answer?.observability ?? "UNSELECTED_UNTIL_PROJECT_CONTEXT",
    constraints,
  };
}

function deriveFunctionRequirements(answers) {
  const explicit = answers["project.function_requirements"]?.clauses;
  const workflow = answers["project.first_workflow"];
  const northStar = answers["project.north_star"];
  const clauses = Array.isArray(explicit) && explicit.length > 0
    ? explicit
    : [{
      question_id: "FR-001-FIRST-PROVING-WORKFLOW",
      proposition: `Can the project complete the owner-defined proving workflow (${workflow?.name ?? "the first workflow"}) with the stated success condition?`,
      source: "NORTH_STAR_AND_PROVING_WORKFLOW",
      owner_outcome: northStar,
      evidence: ["real_workflow_result", "accepted_result_receipt"],
      status: "CANDIDATE_FOR_CAMPAIGN_COMPILATION",
    }];
  return {
    status: "CANDIDATE_FOR_CAMPAIGN_COMPILATION",
    source: "OWNER_NORTH_STAR_AND_PROVING_WORKFLOW",
    clauses,
    exact_root: "FUNCTION_REQUIREMENTS",
  };
}

function deriveDesignBible(discovery, answer) {
  const visible = hasObservedFact(discovery, /(?:ui|view|route|design|visual|browser)/iu) || answer !== undefined;
  return {
    status: visible ? (answer === undefined ? "REQUIRES_OWNER_INPUT" : "COMPILED_FROM_OWNER_AND_DISCOVERY") : "NOT_APPLICABLE_WITH_EXPLICIT_UNAVAILABLE_STATE",
    page_families: answer?.page_families ?? [],
    templates: answer?.templates ?? [],
    tokens: answer?.tokens ?? [],
    required_states: answer?.required_states ?? ["LOADING", "EMPTY", "UNAVAILABLE", "PERMISSION", "STALE", "CONFLICT", "PARTIAL", "ERROR"],
    proof: answer?.proof ?? "DEPLOYED_LIVE_PROOF_WHEN_STATIC_PROOF_CANNOT_ESTABLISH_PERCEPTIBLE_BEHAVIOR",
    protected_surfaces: answer?.protected_surfaces ?? [],
  };
}

function deriveSecurityBaseline(discovery, answer) {
  const identity = answer?.standard_identity ?? "agentos.security-baseline.v1";
  const version = answer?.version ?? "1";
  const clauses = answer?.clauses ?? [
    "SEC-001-AUTHORITY_SCOPE",
    "SEC-002-TENANT_OR_ACCOUNT_SEPARATION_WHEN_APPLICABLE",
    "SEC-003-SECRET_AND_CREDENTIAL_BOUNDARY",
    "SEC-004-REVOCATION_AND_UNAVAILABLE_BEHAVIOR",
    "SEC-005-RELEASE_AND_ROLLBACK_IDENTITY",
  ];
  requireString(identity, "security standard identity");
  requireString(version, "security standard version");
  assert(Array.isArray(clauses) && clauses.length > 0 && clauses.every((value) => typeof value === "string" && value.trim().length > 0), "security requirement IDs are invalid");
  const requirementIds = [...new Set(clauses)].sort(compareUtf8);
  assert(requirementIds.length === clauses.length, "security requirement IDs are duplicated");
  const standardBody = {standard_identity: identity, version, requirement_ids: requirementIds};
  const standardSha256 = answer?.standard_sha256 ?? canonicalDigest(standardBody);
  requireSha(standardSha256, "security standard digest");
  assert(standardSha256 === canonicalDigest(standardBody), "security standard digest does not bind identity and requirements");
  return {
    status: "COMPILED_TYPED_BASELINE",
    standard_identity: identity,
    version,
    standard_sha256: standardSha256,
    requirement_ids: requirementIds,
    source: answer ? "PROJECT_CONTEXT" : "PORTABLE_BASELINE",
    stricter_overlays: [],
    discovery_security_markers: factsFor(discovery, (fact) => /(?:auth|security|secret|permission|policy)/iu.test(fact.fact_id)).map((fact) => fact.fact_id).sort(compareUtf8),
  };
}

function deriveAuthorityCorpus(answer) {
  const operation = answer?.operation ?? "CREATE_NEW";
  assert(["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE", "CREATE_NEW"].includes(operation), "authority corpus operation is invalid");
  return {
    operation,
    source_root: answer?.source_root ?? null,
    source_identity: null,
    preservation: operation === "CREATE_NEW" ? "NOT_REQUIRED" : "REQUIRED_BEFORE_REPLACEMENT_WRITES",
    roots: {
      authority_root: answer?.roots?.authority_root ?? ".agentos/authority",
      authority_index_path: answer?.roots?.authority_index_path ?? ".agentos/index.json",
      project_context_root: answer?.roots?.project_context_root ?? "project/context",
      project_goals_root: answer?.roots?.project_goals_root ?? "project/goals",
      design_system_root: answer?.roots?.design_system_root ?? "design",
      features_root: answer?.roots?.features_root ?? "features",
      platform_capabilities_root: answer?.roots?.platform_capabilities_root ?? "platform",
      campaigns_root: answer?.roots?.campaigns_root ?? "campaigns",
      decisions_root: answer?.roots?.decisions_root ?? "decisions",
      cases_root: answer?.roots?.cases_root ?? "cases",
      evidence_index_root: answer?.roots?.evidence_index_root ?? "evidence",
      archive_root: answer?.roots?.archive_root ?? "archive",
      evidence_library_root: answer?.roots?.evidence_library_root ?? "evidence-library",
    },
    numbering: {
      bootstrap: "000",
      governance: [1, 100],
      shared_project: [100, 200],
      feature_block_size: 100,
      first_feature_start: 200,
      allocation: "IMMUTABLE_NO_RENUMBER_UNSIGNED_UTF8_ORDER",
    },
    article_taxonomy: ["PROJECT_CONTEXT", "NORTH_STAR", "DESIGN_BIBLE", "FEATURE", "PLATFORM_CAPABILITY", "CAMPAIGN", "DECISION", "CASE", "EVIDENCE_INDEX", "RELEASE_SUMMARY", "HANDOFF", "ARCHIVE_INDEX"],
  };
}

function deriveModelPolicy(answer) {
  const source = answer ?? {profile: "ECO_CONTINUOUS", completion_floor: 0.8};
  const profile = source.profile === "ECO" || source.profile === "ECONOMICAL" ? "ECO_CONTINUOUS" : source.profile;
  assert(["ECO_CONTINUOUS", "STANDARD_WORKWEEK", "PERFORMANCE", "CUSTOM"].includes(profile), "model economics profile is invalid");
  const floor = source.completion_floor ?? 0.8;
  assert(typeof floor === "number" && floor > 0 && floor <= 1, "completion floor is invalid");
  if (source.market_snapshot_sha256 !== undefined && source.market_snapshot_sha256 !== null) requireSha(source.market_snapshot_sha256, "market snapshot digest");
  if (profile === "CUSTOM") requireRecord(source.conditions, "custom model conditions");
  return {
    profile,
    window_hours: profile === "ECO_CONTINUOUS" ? 168 : profile === "STANDARD_WORKWEEK" ? 40 : source.window_hours ?? 40,
    work_slots: profile === "ECO_CONTINUOUS" ? 20 : source.work_slots ?? 1,
    completion_floor: floor,
    objective: profile === "PERFORMANCE" ? "MINIMIZE_ELAPSED_TIME_AFTER_COMPLETION_FLOOR" : "MINIMIZE_EXPECTED_COST_PER_ACCEPTED_RESULT",
    conditions: source.conditions ?? null,
    candidate_source: "BOOTSTRAP_INPUT_OR_CURRENT_MARKET_SNAPSHOT",
    market_snapshot_sha256: source.market_snapshot_sha256 ?? null,
    host_capacity: source.host_capacity ?? null,
    rate_limit: source.rate_limit ?? null,
    concurrency: source.concurrency ?? null,
    duty_cycle: source.duty_cycle ?? null,
    budget_throttle: source.budget_throttle ?? null,
    below_floor: "REJECT",
    no_eligible_model: "FAIL_CLOSED",
    no_feasible_model_under_budget: "FAIL_CLOSED",
    telemetry: ["accepted_result", "attempts", "rework", "evidence_reuse", "escaped_findings", "owner_interruptions"],
  };
}

function deriveRuntime(answer) {
  return {
    status: answer?.session_id ? "BOUND" : "REQUIRES_ENVIRONMENT_BINDING",
    persistent: true,
    session_id: answer?.session_id ?? null,
    environment_identity: answer?.environment_identity ?? null,
    capabilities: answer?.capabilities ?? [],
    deployment_identity: null,
    rollback_identity: null,
    never_despawn_between_campaigns: true,
    proof_required: "EXACT_SESSION_ENVIRONMENT_CAPABILITY_AND_RESUME_READBACK",
  };
}

function deriveFirstCampaign(discovery, answers) {
  const roster = Array.isArray(answers?.["project.first_campaign"]?.features)
    ? answers["project.first_campaign"].features
    : [];
  return {
    status: answers?.["project.first_campaign"] ? "COMPILED" : "MINIMAL_EMPTY_SYNTHETIC_CAMPAIGN",
    owner_outcome: answers?.["project.north_star"] ?? null,
    proving_workflow: answers?.["project.first_workflow"] ?? null,
    features: roster,
    excluded_features: answers?.["project.first_campaign"]?.excluded_features ?? [],
    dependency_graph: answers?.["project.first_campaign"]?.dependency_graph ?? [],
    cumulative_root: "ONE_CAMPAIGN_ROOT",
    feature_agent_roster: roster.map((feature, index) => ({
      feature_id: feature.feature_id ?? feature.id ?? `FEATURE_${index + 1}`,
      role: "FEATURE_AGENT",
      status: "ADMIT_ON_CAMPAIGN_START",
    })),
    platform_pool: [],
    campaign_orchestrator: "CAMPAIGN_ORCHESTRATOR",
    independent_auditor: "INDEPENDENT_AUDITOR",
    initial_question_slice: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"],
    evidence_plan: answers?.["project.first_campaign"]?.evidence_plan ?? "COMPILE_FROM_APPLICABLE_QUESTION_SLICE",
    release_stop: "THREE_ROOTS_PASS_AND_EXACT_RUNTIME_ROLLBACK_IDENTITY",
    true_owner_boundaries: answers?.["project.protected_boundaries"] ?? null,
    estimated_cost: answers?.["project.first_campaign"]?.estimated_cost ?? null,
    runtime_binding: "PERSISTENT_RUNTIME",
    discovery_inputs: discovery.filter((fact) => /(?:route|feature|workflow|project)/iu.test(fact.fact_id)).map((fact) => fact.fact_id).sort(compareUtf8),
  };
}

const ANSWER_ALIASES = Object.freeze({
  "project.technical_constraints": "project.technical_baseline",
});

function normalizeAnswers(answers) {
  requireRecord(answers, "Bootstrap answers");
  secretFree(answers, "Bootstrap answers");
  const normalized = structuredClone(answers);
  for (const [legacyId, canonicalId] of Object.entries(ANSWER_ALIASES)) {
    if (Object.hasOwn(normalized, legacyId) && Object.hasOwn(normalized, canonicalId)) {
      throw new Error(`Bootstrap answers contain both legacy and canonical IDs: ${legacyId}`);
    }
    if (Object.hasOwn(normalized, legacyId)) {
      normalized[canonicalId] = normalized[legacyId];
      delete normalized[legacyId];
    }
  }
  return normalized;
}

function validateAnswers(discovery, answers) {
  const normalized = normalizeAnswers(answers);
  for (const [id, value] of Object.entries(normalized)) {
    const question = BOOTSTRAP_QUESTIONS.find((candidate) => candidate.id === id);
    if (!question && !["project.first_campaign", "project.runtime", "project.function_requirements", "security.baseline"].includes(id)) throw new Error(`unknown Bootstrap answer: ${id}`);
    if (question && question.type === "ENUM") assert(question.choices.includes(value), `${id} is outside its choices`);
    if (question && question.type === "JSON") assert(value !== undefined, `${id} is missing`);
  }
  if (normalized["bootstrap.discovery.mode"] !== undefined) assert(DISCOVERY_MODES.includes(normalized["bootstrap.discovery.mode"]), "discovery mode is invalid");
  assert(discovery.every((fact) => { validateFact(fact); return true; }), "discovery facts are invalid");
  return normalized;
}

function questionVisible(question, discovery) {
  if (!question.askWhen) return true;
  if (question.askWhen === "VISIBLE_SURFACE_OR_DESIGN_AUTHORITY") return hasObservedFact(discovery, /(?:ui|view|route|design|visual|browser)/iu);
  if (question.askWhen === "CONFLICT_OR_MISSING_TECHNICAL_BASELINE") return discovery.length === 0 || discovery.some((fact) => fact.status === "CONFLICT" || fact.status === "UNKNOWN") || !hasFact(discovery, /(?:stack|framework|marker|language)/iu);
  if (question.askWhen === "CONFLICT_OR_MISSING_DELIVERY_POLICY") return !hasFact(discovery, /^delivery\.policy\./u) || discovery.some((fact) => /^delivery\.policy\./u.test(fact.fact_id) && (fact.status === "CONFLICT" || fact.status === "UNKNOWN"));
  return false;
}

export function planBootstrapQuestions({discovery = [], answers = {}} = {}) {
  const normalizedAnswers = validateAnswers(discovery, answers);
  const visible = BOOTSTRAP_QUESTIONS.filter((question) => questionVisible(question, discovery));
  const unresolved = visible.filter((question) => !Object.hasOwn(normalizedAnswers, question.id));
  return {
    schema: "agentos.bootstrap_question_plan.v1",
    governance_version: "2.1rc",
    discovery_digest_sha256: canonicalDigest(discovery),
    required_output_groups: ["PROJECT_DEFINITION", "NORTH_STAR", "PROVING_WORKFLOW", "FUNCTION_REQUIREMENTS", "TECHNICAL_BASELINE", "DELIVERY_POLICY", "DESIGN_BIBLE", "SECURITY_BASELINE", "AUTHORITY_BOUNDARIES", "AUTHORITY_CORPUS", "MODEL_POLICY", "PERSISTENT_RUNTIME", "FIRST_CAMPAIGN", "EXACT_CREATION_PLAN"],
    question_budget: {visible: visible.length, answered: visible.length - unresolved.length, unresolved: unresolved.length, recommended_maximum: 9},
    questions: unresolved.map((question) => ({...question, choices: question.choices ?? null, discovered_facts: discovery.filter((fact) => fact.fact_id === question.id || fact.fact_id.startsWith(`${question.id}.`))})),
    next: unresolved[0]?.id ?? null,
    status: unresolved.length === 0 ? "READY_TO_COMPILE" : "QUESTION_PENDING",
  };
}

export const planBootstrapInterview = planBootstrapQuestions;

export function validateBootstrapAnswer(questionId, value, discovery = []) {
  const normalizedQuestionId = ANSWER_ALIASES[questionId] ?? questionId;
  validateAnswers(discovery, {[normalizedQuestionId]: value});
  const question = BOOTSTRAP_QUESTIONS.find((candidate) => candidate.id === normalizedQuestionId);
  if (!question) throw new Error(`unknown Bootstrap question: ${questionId}`);
  return question;
}

export function compileBootstrapPlan({discovery = [], answers = {}, projectRoot = null} = {}) {
  assert(projectRoot !== null, "Bootstrap plan requires an exact project root");
  const normalizedAnswers = validateAnswers(discovery, answers);
  const questionPlan = planBootstrapQuestions({discovery, answers: normalizedAnswers});
  assert(questionPlan.status === "READY_TO_COMPILE", "Bootstrap still has unresolved material questions");
  const authorityCorpus = deriveAuthorityCorpus(normalizedAnswers["authority-corpus.source"]);
  const sourceIdentity = authorityCorpus.preservation === "NOT_REQUIRED"
    ? null
    : inspectLegacySource(authorityCorpus.source_root);
  const authorityCorpusPlan = {...authorityCorpus, source_identity: sourceIdentity};
  const context = {
    project_name: normalizedAnswers["project.boundary"]?.project_name ?? "UNNAMED_PROJECT_CONTEXT",
    project_boundary: normalizedAnswers["project.boundary"],
    north_star: normalizedAnswers["project.north_star"],
    first_workflow: normalizedAnswers["project.first_workflow"],
    protected_boundaries: normalizedAnswers["project.protected_boundaries"],
    discovery_digest_sha256: canonicalDigest(discovery),
  };
  const output = {
    schema: "agentos.bootstrap_creation_plan.v1",
    governance_version: "2.1rc",
    status: "AWAITING_EXACT_OWNER_APPROVAL",
    project_root: projectRoot === null ? null : (fs.existsSync(projectRoot) ? fs.realpathSync.native(path.resolve(projectRoot)) : path.resolve(projectRoot)),
    discovery_mode: normalizedAnswers["bootstrap.discovery.mode"],
    discovery_digest_sha256: canonicalDigest(discovery),
    answers_sha256: canonicalDigest(normalizedAnswers),
    project_definition: context,
    north_star: normalizedAnswers["project.north_star"],
    proving_workflow: normalizedAnswers["project.first_workflow"],
    function_requirements: deriveFunctionRequirements(normalizedAnswers),
    technical_baseline: deriveTechnicalBaseline(discovery, normalizedAnswers["project.technical_baseline"]),
    delivery_policy: compileDeliveryPolicy({discovery, answer: normalizedAnswers["project.delivery_policy"]}),
    design_bible: deriveDesignBible(discovery, normalizedAnswers["project.design"]),
    security_baseline: deriveSecurityBaseline(discovery, normalizedAnswers["security.baseline"]),
    authority_boundaries: normalizedAnswers["project.protected_boundaries"],
    authority_corpus: authorityCorpusPlan,
    model_policy: deriveModelPolicy(normalizedAnswers["project.model_economics"]),
    persistent_runtime: deriveRuntime(normalizedAnswers["project.runtime"]),
    first_campaign: deriveFirstCampaign(discovery, normalizedAnswers),
    exact_creation_plan: {
      repositories: normalizedAnswers["project.boundary"]?.repositories ?? [],
      branches: normalizedAnswers["project.boundary"]?.branches ?? [],
      files_and_roots: Object.values(authorityCorpusPlan.roots),
      delivery_bindings: {
        runner_provider_id: null,
        deployment_provider_id: null,
        environment_ids: [],
      },
      delivery_policy_sha256: null,
      delivery_probe_plan_sha256: null,
      expected_writes: ["bootstrap.plan.json", "authority corpus roots", "typed project context", "delivery policy and probe bindings", "Bootstrap receipts"],
      side_effects: ["CREATE_OR_UPDATE_TYPED_PROJECT_CONTEXT", "CREATE_AUTHORITY_CORPUS", "CREATE_DESIGN_AUTHORITY", "BIND_TYPED_DELIVERY_POLICY_WITHOUT_EXTERNAL_SIDE_EFFECTS", "BIND_RUNTIME", "SEAL_BOOTSTRAP_STATE"],
      prohibited_actions: ["SECRETS", "REMOTE_AUTHENTICATION", "PUSH", "MERGE", "UNAPPROVED_SPENDING", "PUBLICATION", "PREVIEW_CREATION", "DEPLOYMENT", "ROLLBACK", "DESTRUCTIVE_OVERWRITE", "PRODUCT_CUSTODY"],
      rollback: "PRESERVE_STAGING_AND_LEGACY_RECEIPTS; PROMOTE_ONLY_AFTER_READBACK",
      deferred_context: ["NON_ROUTE_CHANGING_PREFERENCES"],
      legacy_gate: authorityCorpusPlan.preservation,
      estimated_cost: normalizedAnswers["project.first_campaign"]?.estimated_cost ?? normalizedAnswers["project.model_economics"]?.max_expected_cost ?? null,
      runtime_action: "VERIFY_OR_BIND_PERSISTENT_RUNTIME_WITHOUT_DEPLOYMENT",
      legacy_archive_identity: authorityCorpusPlan.preservation === "NOT_REQUIRED" ? null : "SEALED_BEFORE_REPLACEMENT_WRITES",
    },
    question_slice: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"],
    extension_boundary: "PROJECT_CONTEXT_MAY_SPECIALIZE_STRICTER_RULES_ONLY",
    plan_sha256: "",
  };
  output.delivery_probe_plan = createDeliveryProbePlan({policy: output.delivery_policy, discovery});
  output.exact_creation_plan.deferred_context = ["NON_ROUTE_CHANGING_PREFERENCES", ...output.delivery_policy.unresolved];
  output.exact_creation_plan.delivery_bindings = {
    runner_provider_id: output.delivery_policy.ci_runner.provider_id,
    deployment_provider_id: output.delivery_policy.deployment.provider_id,
    environment_ids: output.delivery_policy.deployment.environment_ids,
  };
  output.exact_creation_plan.delivery_policy_sha256 = output.delivery_policy.policy_sha256;
  output.exact_creation_plan.delivery_probe_plan_sha256 = output.delivery_probe_plan.probe_plan_sha256;
  const planBody = structuredClone(output);
  delete planBody.plan_sha256;
  output.plan_sha256 = canonicalDigest(planBody);
  validateBootstrapPlan(output);
  return output;
}

export function validateBootstrapPlan(plan) {
  requireRecord(plan, "Bootstrap plan");
  assert(plan.schema === "agentos.bootstrap_creation_plan.v1" && plan.governance_version === "2.1rc", "Bootstrap plan identity is invalid");
  assert(plan.status === "AWAITING_EXACT_OWNER_APPROVAL" || plan.status === "APPROVED_EXACT_DIGEST", "Bootstrap plan status is invalid");
  requireSha(plan.discovery_digest_sha256, "Bootstrap discovery digest");
  requireSha(plan.answers_sha256, "Bootstrap answers digest");
  requireString(plan.project_root, "Bootstrap project root");
  assert(DISCOVERY_MODES.includes(plan.discovery_mode), "Bootstrap discovery mode is missing from the exact plan");
  assert(Array.isArray(plan.question_slice) && JSON.stringify(plan.question_slice) === JSON.stringify(["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"]), "Bootstrap question slice is not the exact three-root slice");
  requireRecord(plan.exact_creation_plan, "exact creation plan");
  requireRecord(plan.delivery_policy, "delivery policy");
  validateDeliveryPolicy(plan.delivery_policy);
  requireRecord(plan.delivery_probe_plan, "delivery probe plan");
  validateDeliveryProbePlan(plan.delivery_probe_plan);
  assert(plan.delivery_probe_plan.policy_sha256 === plan.delivery_policy.policy_sha256, "delivery probe plan is not bound to delivery policy");
  assert(plan.delivery_probe_plan.discovery_digest_sha256 === plan.discovery_digest_sha256, "delivery probe plan is not bound to Bootstrap discovery");
  assert(plan.exact_creation_plan.delivery_bindings?.runner_provider_id === plan.delivery_policy.ci_runner.provider_id
    && plan.exact_creation_plan.delivery_bindings?.deployment_provider_id === plan.delivery_policy.deployment.provider_id
    && JSON.stringify(plan.exact_creation_plan.delivery_bindings?.environment_ids) === JSON.stringify(plan.delivery_policy.deployment.environment_ids),
  "exact creation plan delivery bindings do not match delivery policy");
  assert(plan.exact_creation_plan.delivery_policy_sha256 === plan.delivery_policy.policy_sha256, "exact creation plan is not bound to delivery policy");
  assert(plan.exact_creation_plan.delivery_probe_plan_sha256 === plan.delivery_probe_plan.probe_plan_sha256, "exact creation plan is not bound to delivery probes");
  requireRecord(plan.authority_corpus, "authority corpus plan");
  requireRecord(plan.model_policy, "model policy");
  requireRecord(plan.persistent_runtime, "Runtime plan");
  const body = structuredClone(plan);
  delete body.plan_sha256;
  assert(plan.plan_sha256 === canonicalDigest(body), "Bootstrap plan digest is not content-addressed");
  return plan;
}

export function approveBootstrapPlan(plan, {decision, planSha256, discoveryDigestSha256, actor, approvedAtUtc}) {
  validateBootstrapPlan(plan);
  assert(plan.status === "AWAITING_EXACT_OWNER_APPROVAL", "Bootstrap plan is not awaiting approval");
  assert(decision === PLAN_APPROVAL, "Bootstrap requires approval of the exact displayed plan");
  assert(planSha256 === plan.plan_sha256, "owner approval digest does not match the displayed plan");
  assert(discoveryDigestSha256 === plan.discovery_digest_sha256, "owner approval discovery is stale");
  requireId(actor, "approval actor");
  requireUtc(approvedAtUtc, "approval time");
  const receiptBody = {
    schema: "agentos.bootstrap_approval_receipt.v1",
    decision,
    plan_sha256: planSha256,
    discovery_digest_sha256: discoveryDigestSha256,
    actor,
    approved_at_utc: approvedAtUtc,
  };
  const receipt = {...receiptBody, receipt_sha256: canonicalDigest(receiptBody)};
  const approvedPlan = {...structuredClone(plan), status: "APPROVED_EXACT_DIGEST", approval_receipt: receipt};
  delete approvedPlan.plan_sha256;
  approvedPlan.plan_sha256 = canonicalDigest(approvedPlan);
  validateApprovedPlan(approvedPlan);
  return approvedPlan;
}

function validateApprovedPlan(plan) {
  validateBootstrapPlan(plan);
  assert(plan.status === "APPROVED_EXACT_DIGEST" && isRecord(plan.approval_receipt), "approved plan lacks approval receipt");
  const receipt = plan.approval_receipt;
  requireSha(receipt.receipt_sha256, "approval receipt digest");
  assert(receipt.plan_sha256 !== plan.plan_sha256, "approval receipt must bind the pre-approval plan digest");
  const body = structuredClone(receipt);
  delete body.receipt_sha256;
  assert(receipt.receipt_sha256 === canonicalDigest(body), "approval receipt is not content-addressed");
}

function contextFromPlan(plan) {
  const roots = plan.authority_corpus.roots;
  const projectContextBody = {
    schema: "agentos.project_context_binding.v1",
    version: 1,
    governance_version: "2.1rc",
    status: "PREPARED_NOT_ACTIVATED",
    source_plan_sha256: plan.plan_sha256,
    project_definition: plan.project_definition,
    north_star: plan.north_star,
    proving_workflow: plan.proving_workflow,
    function_requirements: plan.function_requirements,
    technical_baseline: plan.technical_baseline,
    delivery_policy: plan.delivery_policy,
    delivery_probe_plan: plan.delivery_probe_plan,
    design_bible: plan.design_bible,
    security_baseline: plan.security_baseline,
    authority_boundaries: plan.authority_boundaries,
    authority_corpus: plan.authority_corpus,
    model_policy: plan.model_policy,
    persistent_runtime: plan.persistent_runtime,
    first_campaign: plan.first_campaign,
    exact_creation_plan: plan.exact_creation_plan,
    question_slice: plan.question_slice,
    extension_boundary: plan.extension_boundary,
  };
  const projectContext = {
    ...projectContextBody,
    exact_context_digest: canonicalDigest(projectContextBody),
  };
  return {
    schema: "governance.project_context_fixture.v1",
    project_name: plan.project_definition.project_name,
    kernel: {override_allowed: false},
    authority_corpus_activation: "ACTIVATED",
    authority_corpus_roots: roots,
    authority_corpus_entities: {feature_ids: [], capability_ids: [], campaign_ids: [], release_ids: []},
    project_context_root: roots.project_context_root,
    project_context: projectContext,
    portable_template_instance: {
      project_identity: {
        context_version: 1,
        project_name: plan.project_definition.project_name,
        exact_context_digest: projectContext.exact_context_digest,
      },
      bootstrap_output_groups: [
      "PROJECT_DEFINITION", "NORTH_STAR", "PROVING_WORKFLOW", "FUNCTION_REQUIREMENTS",
        "TECHNICAL_BASELINE", "DELIVERY_POLICY", "DESIGN_BIBLE", "SECURITY_BASELINE", "AUTHORITY_BOUNDARIES",
        "AUTHORITY_CORPUS", "MODEL_POLICY", "PERSISTENT_RUNTIME", "FIRST_CAMPAIGN",
        "EXACT_CREATION_PLAN",
      ],
    },
  };
}

function assertContained(root, candidate, label) {
  const resolvedRoot = fs.realpathSync.native(path.resolve(root));
  const resolved = path.resolve(resolvedRoot, candidate);
  assert(resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`), `${label} escapes project root`);
  return resolved;
}

function writeCanonicalFile(target, bytes) {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, {recursive: true});
  const temp = path.join(directory, `.${path.basename(target)}.agentos-stage`);
  fs.writeFileSync(temp, bytes, {flag: "w", mode: 0o644});
  fs.renameSync(temp, target);
}

function directoryDigest(root) {
  const realRoot = fs.realpathSync.native(path.resolve(root));
  const entries = [];
  function visit(current, relative = "") {
    for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((left, right) => compareUtf8(left.name, right.name))) {
      const child = path.join(current, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(child);
      assert(!stat.isSymbolicLink(), `promotion tree contains a symbolic link: ${childRelative}`);
      if (stat.isDirectory()) visit(child, childRelative);
      else {
        assert(stat.isFile(), `promotion tree contains an unsafe object: ${childRelative}`);
        entries.push({path: childRelative, sha256: crypto.createHash("sha256").update(fs.readFileSync(child)).digest("hex"), mode: stat.mode & 0o777});
      }
    }
  }
  visit(realRoot);
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  return {root: realRoot, entries, sha256: canonicalDigest(entries)};
}

function validateExecutionState(executionState) {
  requireRecord(executionState, "Bootstrap execution state");
  const fields = [
    "schema", "status", "bootstrap_session_id", "project_root", "plan_sha256", "phase", "staging_root",
    "staging_tree_sha256", "staging_entries", "legacy_receipt_sha256", "authority_index_sha256",
    "setup_audit_receipt_sha256", "promotion_receipt_sha256", "promotion_root", "created_at_utc",
    "updated_at_utc", "state_sha256",
  ];
  const actual = Object.keys(executionState).sort(compareUtf8);
  const expected = [...fields].sort(compareUtf8);
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]), "Bootstrap execution state fields mismatch");
  assert(executionState.schema === "agentos.bootstrap_execution_state.v1", "Bootstrap execution state schema mismatch");
  assert(["APPROVED", "PROMOTED"].includes(executionState.status), "Bootstrap execution state status is invalid");
  requireId(executionState.bootstrap_session_id, "Bootstrap execution session");
  requireString(executionState.project_root, "Bootstrap execution project root");
  requireSha(executionState.plan_sha256, "Bootstrap execution plan");
  assert(["APPROVED", "STAGING", "SEALED", "PROMOTED"].includes(executionState.phase), "Bootstrap execution phase is invalid");
  if (executionState.staging_root !== null) {
    requireString(executionState.staging_root, "Bootstrap staging root");
    assert(!path.isAbsolute(executionState.staging_root)
      && !executionState.staging_root.split(path.sep).includes(".."), "Bootstrap staging root is unsafe");
  }
  if (executionState.staging_tree_sha256 !== null) requireSha(executionState.staging_tree_sha256, "Bootstrap staging tree");
  assert(Array.isArray(executionState.staging_entries), "Bootstrap staging entries are invalid");
  let previous = null;
  for (const entry of executionState.staging_entries) {
    const keys = Object.keys(entry).sort(compareUtf8);
    assert(keys.length === 3 && keys.join("\0") === ["mode", "path", "sha256"].sort(compareUtf8).join("\0"), "Bootstrap staging entry fields mismatch");
    requireString(entry.path, "Bootstrap staging entry path");
    assert(!path.isAbsolute(entry.path) && !entry.path.split("/").includes(".."), "Bootstrap staging entry path is unsafe");
    requireSha(entry.sha256, "Bootstrap staging entry digest");
    assert(Number.isSafeInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 0o777, "Bootstrap staging entry mode is invalid");
    if (previous !== null) assert(compareUtf8(previous, entry.path) < 0, "Bootstrap staging entries are not sorted");
    previous = entry.path;
  }
  if (executionState.staging_tree_sha256 !== null) assert(canonicalDigest(executionState.staging_entries) === executionState.staging_tree_sha256, "Bootstrap staging inventory digest mismatch");
  if (["SEALED", "PROMOTED"].includes(executionState.phase)) {
    assert(executionState.staging_root !== null && executionState.staging_tree_sha256 !== null, "sealed Bootstrap state lacks its staging inventory");
  }
  for (const field of ["legacy_receipt_sha256", "authority_index_sha256", "setup_audit_receipt_sha256", "promotion_receipt_sha256"]) {
    if (executionState[field] !== null) requireSha(executionState[field], `Bootstrap execution ${field}`);
  }
  if (executionState.promotion_root !== null) requireString(executionState.promotion_root, "Bootstrap promotion root");
  requireUtc(executionState.created_at_utc, "Bootstrap execution creation time");
  requireUtc(executionState.updated_at_utc, "Bootstrap execution update time");
  requireSha(executionState.state_sha256, "Bootstrap execution state digest");
  const body = structuredClone(executionState);
  delete body.state_sha256;
  assert(executionState.state_sha256 === canonicalDigest(body), "Bootstrap execution state is not content-addressed");
  if (executionState.phase === "PROMOTED") {
    assert(executionState.status === "PROMOTED" && executionState.promotion_root !== null && executionState.promotion_receipt_sha256 !== null,
      "promoted Bootstrap state lacks promotion identity");
  } else {
    assert(executionState.status === "APPROVED" && executionState.promotion_root === null && executionState.promotion_receipt_sha256 === null,
      "unpromoted Bootstrap state carries promotion identity");
  }
  return executionState;
}

function revalidateBootstrapEnvironment(plan, projectRoot, legacySourceRoot) {
  const root = fs.realpathSync.native(path.resolve(projectRoot));
  if (plan.project_root !== null) assert(path.resolve(plan.project_root) === root, "Bootstrap project root changed after exact-plan approval");
  const observedDiscovery = discoverProject(root, plan.discovery_mode);
  assert(canonicalDigest(observedDiscovery.facts) === plan.discovery_digest_sha256, "Bootstrap discovery changed after exact-plan approval");
  if (plan.authority_corpus.preservation !== "NOT_REQUIRED") {
    assert(legacySourceRoot !== null, "imported authority corpus requires a legacy source root");
    const expectedSource = fs.realpathSync.native(path.resolve(plan.authority_corpus.source_root));
    const actualSource = fs.realpathSync.native(path.resolve(legacySourceRoot));
    assert(expectedSource === actualSource, "legacy source changed after exact-plan approval");
    const observedSource = inspectLegacySource(actualSource);
    assert(observedSource.source_content_sha256 === plan.authority_corpus.source_identity.source_content_sha256
      && observedSource.source_observation_sha256 === plan.authority_corpus.source_identity.source_observation_sha256,
    "legacy source contents changed after exact-plan approval");
  }
  return {root, discovery: observedDiscovery.facts};
}

export function createBootstrapExecution(plan, {bootstrapSessionId, projectRoot, legacySourceRoot = null, nowUtc}) {
  validateApprovedPlan(plan);
  requireId(bootstrapSessionId, "Bootstrap session ID");
  requireUtc(nowUtc, "Bootstrap execution time");
  const {root} = revalidateBootstrapEnvironment(plan, projectRoot, legacySourceRoot);
  const state = {
    schema: "agentos.bootstrap_execution_state.v1",
    status: "APPROVED",
    bootstrap_session_id: bootstrapSessionId,
    project_root: root,
    plan_sha256: plan.plan_sha256,
    phase: "APPROVED",
    staging_root: null,
    staging_tree_sha256: null,
    staging_entries: [],
    legacy_receipt_sha256: null,
    authority_index_sha256: null,
    setup_audit_receipt_sha256: null,
    promotion_receipt_sha256: null,
    promotion_root: null,
    created_at_utc: nowUtc,
    updated_at_utc: nowUtc,
    state_sha256: "",
  };
  const body = structuredClone(state);
  delete body.state_sha256;
  state.state_sha256 = canonicalDigest(body);
  validateExecutionState(state);
  return state;
}

export function executeBootstrapPlan(plan, {bootstrapSessionId, projectRoot, legacySourceRoot = null, workflow, nowUtc}) {
  validateApprovedPlan(plan);
  requireId(bootstrapSessionId, "Bootstrap session ID");
  requireUtc(nowUtc, "Bootstrap execution time");
  const validation = revalidateBootstrapEnvironment(plan, projectRoot, legacySourceRoot);
  const root = validation.root;
  const state = createBootstrapExecution(plan, {bootstrapSessionId, projectRoot: root, legacySourceRoot, nowUtc});
  const stagingRoot = fs.mkdtempSync(path.join(root, ".agentos-bootstrap-stage-"));
  state.phase = "STAGING";
  state.staging_root = path.relative(root, stagingRoot);
  const deliveryProbeResults = runDeliveryProbes({
    projectRoot: root,
    policy: plan.delivery_policy,
    discovery: validation.discovery,
    planSha256: plan.plan_sha256,
  });
  const deliveryProbePath = assertContained(stagingRoot, "delivery.probe.results.json", "delivery probe results");
  writeCanonicalFile(deliveryProbePath, Buffer.from(`${canonicalCompactJson(deliveryProbeResults)}\n`, "utf8"));
  if (plan.authority_corpus.preservation !== "NOT_REQUIRED") {
    assert(legacySourceRoot !== null, "imported authority corpus requires a legacy source root");
    const source = fs.realpathSync.native(path.resolve(legacySourceRoot));
    assert(source !== root && !source.startsWith(`${root}${path.sep}`), "legacy source must be outside the destination project root");
    const destination = assertContained(stagingRoot, plan.authority_corpus.roots.authority_root, "legacy destination");
    fs.mkdirSync(destination, {recursive: true});
    const legacy = preserveLegacyCorpus(source, destination, nowUtc);
    state.legacy_receipt_sha256 = legacy.receipt.receipt_sha256;
    verifyLegacyPreservation(destination);
  }
  const destination = assertContained(stagingRoot, plan.authority_corpus.roots.authority_root, "authority root");
  fs.mkdirSync(destination, {recursive: true});
  const context = contextFromPlan(plan);
  const projectContextPath = assertContained(
    stagingRoot,
    `${context.project_context_root}/project-context.json`,
    "typed project context",
  );
  const projectContextBytes = Buffer.from(`${canonicalCompactJson(context.project_context)}\n`, "utf8");
  writeCanonicalFile(projectContextPath, projectContextBytes);
  assert(fs.readFileSync(projectContextPath).equals(projectContextBytes), "typed project context staging readback differs");
  const corpusResult = workflow ? applyCorpusPlan(stagingRoot, context, workflow) : null;
  if (corpusResult) state.authority_index_sha256 = corpusResult.index_sha256;
  const planBytes = Buffer.from(`${canonicalCompactJson(plan)}\n`, "utf8");
  writeCanonicalFile(path.join(stagingRoot, "bootstrap.plan.json"), planBytes);
  const readback = fs.readFileSync(path.join(stagingRoot, "bootstrap.plan.json"));
  assert(readback.equals(planBytes), "Bootstrap plan staging readback differs");
  const staged = directoryDigest(stagingRoot);
  state.staging_tree_sha256 = staged.sha256;
  state.staging_entries = staged.entries;
  state.phase = "SEALED";
  state.updated_at_utc = nowUtc;
  const body = structuredClone(state);
  delete body.state_sha256;
  state.state_sha256 = canonicalDigest(body);
  validateExecutionState(state);
  return {state, staging_root: stagingRoot, corpus: corpusResult};
}

export function promoteBootstrapExecution({plan, executionState, setupAudit, projectRoot, nowUtc}) {
  validateApprovedPlan(plan);
  validateExecutionState(executionState);
  requireRecord(setupAudit, "Bootstrap setup audit");
  requireUtc(nowUtc, "Bootstrap promotion time");
  const root = fs.realpathSync.native(path.resolve(projectRoot));
  assert(executionState.project_root === root, "Bootstrap promotion project root mismatch");
  assert(executionState.plan_sha256 === plan.plan_sha256, "Bootstrap promotion plan mismatch");
  if (executionState.phase === "PROMOTED") {
    assert(executionState.promotion_root === root, "Bootstrap promotion root changed on resume");
    requireSha(executionState.promotion_receipt_sha256, "Bootstrap promotion receipt");
    return {state: executionState, receipt: null, resumed: true};
  }
  assert(executionState.phase === "SEALED", "Bootstrap execution must be sealed before promotion");
  assert(setupAudit.status === "PASS"
    && setupAudit.plan_sha256 === plan.plan_sha256
    && setupAudit.execution_state_sha256 === executionState.state_sha256,
  "Bootstrap setup audit is not bound to the sealed execution");
  requireSha(setupAudit.audit_sha256, "Bootstrap setup audit digest");
  const stagingRoot = fs.realpathSync.native(path.resolve(root, executionState.staging_root));
  assert(stagingRoot !== root && stagingRoot.startsWith(`${root}${path.sep}`), "Bootstrap staging root escapes project root");
  const promotionReceiptName = "bootstrap.promotion.receipt.json";
  const promotionReceiptDestination = path.join(root, promotionReceiptName);
  const promotionReceiptStaging = path.join(stagingRoot, promotionReceiptName);
  const expectedStagedEntries = executionState.staging_entries;
  const expectedStagedTree = executionState.staging_tree_sha256;
  const receiptMatches = (candidate) => {
    if (!candidate || candidate.schema !== "agentos.bootstrap_promotion_receipt.v1") return false;
    const body = structuredClone(candidate);
    delete body.receipt_sha256;
    return candidate.plan_sha256 === plan.plan_sha256
      && candidate.sealed_state_sha256 === executionState.state_sha256
      && candidate.setup_audit_sha256 === setupAudit.audit_sha256
      && candidate.project_root === root
      && candidate.staged_tree_sha256 === expectedStagedTree
      && canonicalCompactJson(candidate.staged_entries) === canonicalCompactJson(expectedStagedEntries)
      && SHA256.test(candidate.receipt_sha256)
      && candidate.receipt_sha256 === canonicalDigest(body);
  };
  let receipt = null;
  for (const candidatePath of [promotionReceiptDestination, promotionReceiptStaging]) {
    if (!fs.existsSync(candidatePath)) continue;
    const candidateBytes = fs.readFileSync(candidatePath);
    const candidate = JSON.parse(candidateBytes.toString("utf8"));
    assert(canonicalCompactJson(candidate) + "\n" === candidateBytes.toString("utf8"), "promotion receipt is not canonical JSON");
    if (receiptMatches(candidate)) {
      receipt = candidate;
      break;
    }
    throw new Error("existing promotion receipt is bound to a different sealed execution");
  }
  if (receipt === null) {
    const receiptBody = {
      schema: "agentos.bootstrap_promotion_receipt.v1",
      plan_sha256: plan.plan_sha256,
      sealed_state_sha256: executionState.state_sha256,
      setup_audit_sha256: setupAudit.audit_sha256,
      project_root: root,
      staged_tree_sha256: expectedStagedTree,
      staged_entries: expectedStagedEntries,
      promoted_at_utc: nowUtc,
    };
    receipt = {...receiptBody, receipt_sha256: canonicalDigest(receiptBody)};
    writeCanonicalFile(promotionReceiptStaging, Buffer.from(`${canonicalCompactJson(receipt)}\n`, "utf8"));
  }
  const expectedTopLevel = [...new Set(executionState.staging_entries.map((entry) => entry.path.split("/")[0]))].sort(compareUtf8);
  for (const entry of fs.readdirSync(stagingRoot).filter((entry) => entry !== promotionReceiptName).sort(compareUtf8)) {
    const source = path.join(stagingRoot, entry);
    const destination = path.join(root, entry);
    const sourceStat = fs.lstatSync(source);
    assert(!sourceStat.isSymbolicLink() && (sourceStat.isDirectory() || sourceStat.isFile()), `unsafe staged entry: ${entry}`);
    if (fs.existsSync(destination)) {
      const destinationStat = fs.lstatSync(destination);
      assert(!destinationStat.isSymbolicLink(), `promotion destination is a symbolic link: ${entry}`);
      assert((sourceStat.isDirectory() && destinationStat.isDirectory()) || (sourceStat.isFile() && destinationStat.isFile()), `promotion type mismatch: ${entry}`);
      if (sourceStat.isDirectory()) {
        assert(directoryDigest(source).sha256 === directoryDigest(destination).sha256, `promotion would overwrite a different existing entry: ${entry}`);
      } else {
        assert(crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")
          === crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex")
          && (sourceStat.mode & 0o777) === (destinationStat.mode & 0o777),
        `promotion would overwrite a different existing entry: ${entry}`);
      }
    } else {
      fs.renameSync(source, destination);
    }
  }
  for (const entry of expectedTopLevel) {
    assert(fs.existsSync(path.join(root, entry)), `promotion did not materialize staged entry: ${entry}`);
  }
  if (fs.existsSync(promotionReceiptStaging)) {
    if (fs.existsSync(promotionReceiptDestination)) {
      assert(fs.readFileSync(promotionReceiptStaging).equals(fs.readFileSync(promotionReceiptDestination)), "promotion receipt differs from existing destination receipt");
    } else {
      fs.renameSync(promotionReceiptStaging, promotionReceiptDestination);
    }
  }
  const nextState = {...executionState,
    status: "PROMOTED",
    phase: "PROMOTED",
    setup_audit_receipt_sha256: setupAudit.audit_sha256,
    promotion_receipt_sha256: receipt.receipt_sha256,
    promotion_root: root,
    updated_at_utc: nowUtc,
    state_sha256: "",
  };
  const stateBody = structuredClone(nextState);
  delete stateBody.state_sha256;
  nextState.state_sha256 = canonicalDigest(stateBody);
  validateExecutionState(nextState);
  return {state: nextState, receipt, resumed: false};
}

export function auditBootstrapSetup({plan, executionState, auditorSessionId, bootstrapSessionId, stagingRoot, workflow = null}) {
  validateApprovedPlan(plan);
  requireId(auditorSessionId, "setup Auditor session");
  requireId(bootstrapSessionId, "Bootstrap session");
  assert(auditorSessionId !== bootstrapSessionId, "setup Auditor must be independent from Bootstrap");
  validateExecutionState(executionState);
  assert(executionState.phase === "SEALED" && executionState.plan_sha256 === plan.plan_sha256, "Bootstrap execution is not sealed to the exact plan");
  assert(plan.persistent_runtime.persistent === true && plan.persistent_runtime.status === "BOUND"
    && typeof plan.persistent_runtime.session_id === "string" && plan.persistent_runtime.environment_identity !== null,
  "Bootstrap setup cannot pass without an exact persistent Runtime binding");
  const root = fs.realpathSync.native(path.resolve(stagingRoot));
  const observedStaging = directoryDigest(root);
  assert(observedStaging.sha256 === executionState.staging_tree_sha256
    && canonicalCompactJson(observedStaging.entries) === canonicalCompactJson(executionState.staging_entries),
  "setup Auditor staging inventory changed after sealing");
  const planBytes = fs.readFileSync(path.join(root, "bootstrap.plan.json"));
  const readbackPlan = JSON.parse(planBytes.toString("utf8"));
  const readbackBody = structuredClone(readbackPlan);
  delete readbackBody.plan_sha256;
  assert(canonicalDigest(readbackBody) === plan.plan_sha256, "setup Auditor readback plan mismatch");
  const deliveryProbePath = assertContained(root, "delivery.probe.results.json", "delivery probe result readback");
  const deliveryProbeBytes = fs.readFileSync(deliveryProbePath);
  assert(canonicalCompactJson(JSON.parse(deliveryProbeBytes.toString("utf8"))) + "\n" === deliveryProbeBytes.toString("utf8"), "delivery probe results are not canonical JSON");
  const deliveryProbeResults = JSON.parse(deliveryProbeBytes.toString("utf8"));
  validateDeliveryProbeResults(deliveryProbeResults, {
    planSha256: plan.plan_sha256,
    policySha256: plan.delivery_policy.policy_sha256,
    discoveryDigestSha256: plan.discovery_digest_sha256,
  });
  assert(deliveryProbeResults.probe_plan_sha256 === plan.delivery_probe_plan.probe_plan_sha256
    && deliveryProbeResults.binding.project_root === executionState.project_root,
  "delivery probe results are not bound to the exact Bootstrap execution");
  if (plan.authority_corpus.preservation !== "NOT_REQUIRED") {
    const legacyRoot = assertContained(root, plan.authority_corpus.roots.authority_root, "legacy readback root");
    const receipt = verifyLegacyPreservation(legacyRoot);
    assert(receipt.status === "VERIFIED_EXACT", "setup Auditor could not verify legacy archive");
  }
  if (workflow) {
    const context = contextFromPlan(plan);
    const corpus = compileCorpusPlan(context, workflow);
    assert(corpus.plan_sha256.length === 64, "setup Auditor did not compile authority corpus");
  }
  const contextPath = assertContained(
    root,
    `${plan.authority_corpus.roots.project_context_root}/project-context.json`,
    "typed project context readback",
  );
  const contextBytes = fs.readFileSync(contextPath);
  const context = JSON.parse(contextBytes.toString("utf8"));
  const contextBody = structuredClone(context);
  delete contextBody.exact_context_digest;
  assert(context.exact_context_digest === canonicalDigest(contextBody), "typed project context digest is invalid");
  assert(context.source_plan_sha256 === plan.plan_sha256, "typed project context is not bound to the exact plan");
  const reportBody = {
    schema: "agentos.bootstrap_setup_audit.v1",
    auditor_session_id: auditorSessionId,
    bootstrap_session_id: bootstrapSessionId,
    plan_sha256: plan.plan_sha256,
    execution_state_sha256: executionState.state_sha256,
    checks: ["EXACT_PLAN", "APPROVAL", "TOCTOU_READBACK", "CONTEXT_SEPARATION", "NO_SECRETS", "LEGACY_GATE", "DELIVERY_PROBES", "AUTHORITY_CORPUS", "RUNTIME_BINDING", "THREE_ROOT_SLICE"],
    status: "PASS",
  };
  return {...reportBody, audit_sha256: canonicalDigest(reportBody)};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write("bootstrap compiler loaded\n");
}
