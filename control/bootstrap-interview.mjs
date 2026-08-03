#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";

export const DISCOVERY_MODES = new Set([
  "RECOMMENDED", "GUIDED", "EXPERT", "LOCAL_ONLY", "MANUAL",
]);
export const QUESTION_CLASSES = new Set([
  "OWNER_INTENT", "OWNER_BOUNDARY", "MECHANICAL_FACT", "SAFE_CONFIGURATION",
]);
export const DISCOVERY_FACT_STATES = new Set([
  "OBSERVED_FACT", "CANDIDATE_INTERPRETATION", "CONFLICT", "UNKNOWN",
]);
export const DELIVERY_BOUNDARIES = new Set([
  "WORKING_PROTOTYPE", "DEVELOPMENT_READY", "STAGING_CANDIDATE",
  "PRODUCTION_RELEASE", "CUSTOM",
]);
export const CONFIRMATION_CHOICES = new Set([
  "PROCEED", "CORRECT_ONE_ITEM", "RETURN_TO_GUIDED_SETUP", "CANCEL",
]);
export const MODEL_PROFILES = {
  ECO_CONTINUOUS: {
    window_hours: 168,
    work_slots: 20,
    objective: "MINIMIZE_EXPECTED_COST_PER_ACCEPTED_RESULT",
  },
  STANDARD_WORKWEEK: {
    window_hours: 40,
    work_slots: 1,
    objective: "MINIMIZE_EXPECTED_COST_PER_ACCEPTED_RESULT",
  },
  PERFORMANCE: {
    window_hours: 40,
    work_slots: 1,
    objective: "MINIMIZE_ELAPSED_TIME_AFTER_COMPLETION_FLOOR",
  },
  CUSTOM: {
    window_hours: null,
    work_slots: null,
    objective: "USE_TYPED_CUSTOM_CONDITIONS",
  },
};
export const MODEL_POLICY_ROLES = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "FEATURE_AGENT",
  "PLATFORM_AGENT",
  "AUDIT_WORKER",
  "CAMPAIGN_FINALIZER",
  "RUNTIME",
]);
const MODEL_PROFILE_ALIASES = new Map([
  ["ECO", "ECO_CONTINUOUS"],
  ["ECONOMICAL", "ECO_CONTINUOUS"],
  ["USER_CUSTOM", "CUSTOM"],
]);
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu;

export const BOOTSTRAP_QUESTIONS = Object.freeze([
  {
    id: "bootstrap.discovery.mode",
    class: "OWNER_BOUNDARY",
    type: "ENUM",
    prompt: "May Bootstrap perform safe read-only discovery of this project so it can answer technical setup questions for you?",
    choices: [...DISCOVERY_MODES],
    recommended: "RECOMMENDED",
    required: true,
  },
  {
    id: "project.boundary",
    class: "OWNER_BOUNDARY",
    type: "JSON",
    prompt: "Which repositories, documents, data sources, environments, and external systems belong inside the project boundary?",
    required: true,
  },
  {
    id: "project.north_star",
    class: "OWNER_INTENT",
    type: "JSON",
    prompt: "Who is this for, what recurring moment matters, and what should be better after the project works?",
    required: true,
  },
  {
    id: "project.first_workflow",
    class: "OWNER_INTENT",
    type: "JSON",
    prompt: "What is the first user workflow that should prove the project is useful, and what does working mean?",
    required: true,
  },
  {
    id: "project.delivery_boundary",
    class: "OWNER_BOUNDARY",
    type: "ENUM",
    prompt: "What is the first delivery boundary Bootstrap should prepare?",
    choices: [...DELIVERY_BOUNDARIES],
    recommended: "DEVELOPMENT_READY",
    required: true,
  },
  {
    id: "project.protected_boundaries",
    class: "OWNER_BOUNDARY",
    type: "JSON",
    prompt: "Which safety, legal, privacy, data-loss, spending, authentication, irreversible-action, or intent boundaries must remain owner-controlled?",
    required: true,
  },
  {
    id: "authority-corpus.source",
    class: "OWNER_BOUNDARY",
    type: "JSON",
    prompt: "Should Bootstrap import, align, or create the authority corpus, and is there an existing source to preserve?",
    required: true,
  },
  {
    id: "project.delivery_constraints",
    class: "OWNER_BOUNDARY",
    type: "JSON",
    prompt: "Discovery found the current stack and delivery shape. Are any material technologies, providers, deployment targets, or authentication routes required or forbidden?",
    required: false,
    ask_when: "DISCOVERY_MISSING_OR_CONFLICTING_OR_NEW_PROJECT",
  },
  {
    id: "project.design_posture",
    class: "OWNER_INTENT",
    type: "JSON",
    prompt: "What design context and user conditions matter—such as device, field, offline, accessibility, or protected visual surfaces—and what should the Design Bible optimize for?",
    required: false,
    ask_when: "VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_PRESENT",
  },
  {
    id: "project.model_economics",
    class: "SAFE_CONFIGURATION",
    type: "JSON",
    prompt: "Which operating economics describe this project: continuous eco, a standard workweek, performance-first, or custom conditions?",
    required: true,
  },
  {
    id: "bootstrap.confirmation",
    class: "OWNER_BOUNDARY",
    type: "ENUM",
    prompt: "Bootstrap has compiled the smallest setup plan. What should happen next?",
    choices: [...CONFIRMATION_CHOICES],
    required: true,
  },
]);

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function secretFree(value, label = "value") {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (SECRET_PATTERN.test(serialized)
      || /https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(serialized)) {
    throw new Error(`${label} contains secret material`);
  }
}

function validateDiscoveryFact(fact) {
  requireRecord(fact, "discovery fact");
  requireString(fact.fact_id, "discovery fact ID");
  requireString(fact.confidence, "discovery fact confidence");
  requireString(fact.source_kind, "discovery fact source");
  requireString(fact.source_locator, "discovery fact locator");
  if (fact.observed_at !== undefined) requireString(fact.observed_at, "discovery fact time");
  if (fact.status !== undefined && !DISCOVERY_FACT_STATES.has(fact.status)) {
    throw new Error("discovery fact state is invalid");
  }
  if (fact.secret_free !== true) throw new Error("discovery facts must be secret-free");
  secretFree(fact, "discovery fact");
}

function questionById(questionId) {
  const question = BOOTSTRAP_QUESTIONS.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`unknown Bootstrap Interview question: ${questionId}`);
  return question;
}

function visibleConditionalQuestion(question, facts) {
  if (!question.ask_when) return true;
  const ids = new Set(facts.map((fact) => fact.fact_id));
  if (question.ask_when === "VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_PRESENT") {
    return [...ids].some((id) => /(?:ui|view|route|design|visual|browser)/iu.test(id));
  }
  if (question.ask_when === "DISCOVERY_MISSING_OR_CONFLICTING_OR_NEW_PROJECT") {
    return facts.length === 0
      || facts.some((fact) => fact.confidence === "LOW" || fact.status === "CONFLICT")
      || !facts.some((fact) => /(?:stack|framework|language|repository|project)/iu.test(fact.fact_id));
  }
  return false;
}

export function normalizeModelProfile(value) {
  requireString(value, "model economics profile");
  const canonical = MODEL_PROFILE_ALIASES.get(value) ?? value;
  if (!Object.hasOwn(MODEL_PROFILES, canonical)) {
    throw new Error("unknown model economics profile");
  }
  return canonical;
}

export function compileModelEconomics(input) {
  requireRecord(input, "model economics");
  const profile = normalizeModelProfile(input.profile);
  const result = {
    profile,
    profile_alias: input.profile === profile ? null : input.profile,
    completion_floor: input.completion_floor ?? 0.75,
    custom_conditions: input.custom_conditions ?? null,
    max_expected_cost: input.max_expected_cost ?? null,
    deadline_hours: input.deadline_hours ?? null,
  };
  if (typeof result.completion_floor !== "number"
      || !Number.isFinite(result.completion_floor)
      || result.completion_floor <= 0 || result.completion_floor > 1) {
    throw new Error("completion_floor must be greater than zero and at most one");
  }
  if (profile === "CUSTOM") {
    requireRecord(result.custom_conditions, "custom model conditions");
    if (Object.keys(result.custom_conditions).length === 0) {
      throw new Error("custom model conditions cannot be empty");
    }
  } else if (result.custom_conditions !== null) {
    throw new Error("non-custom model profiles cannot carry custom conditions");
  }
  if (result.max_expected_cost !== null
      && (typeof result.max_expected_cost !== "number"
        || !Number.isFinite(result.max_expected_cost)
        || result.max_expected_cost <= 0)) {
    throw new Error("max_expected_cost must be a positive number when supplied");
  }
  if (result.deadline_hours !== null
      && (typeof result.deadline_hours !== "number"
        || !Number.isFinite(result.deadline_hours)
        || result.deadline_hours <= 0)) {
    throw new Error("deadline_hours must be a positive number when supplied");
  }
  secretFree(result, "model economics");
  return result;
}

function validateCandidate(candidate, index) {
  requireRecord(candidate, `model candidate ${index}`);
  for (const field of ["model", "reasoning"]) requireString(candidate[field], `candidate ${field}`);
  if (candidate.spawnable !== true) throw new Error(`candidate ${index} is not spawnable`);
  for (const field of ["estimated_success_probability", "estimated_attempts", "relative_unit_cost"]) {
    if (typeof candidate[field] !== "number" || !Number.isFinite(candidate[field])
        || candidate[field] <= 0) throw new Error(`candidate ${field} is invalid`);
  }
  if (candidate.estimated_success_probability > 1) {
    throw new Error("candidate success probability cannot exceed one");
  }
  for (const field of [
    "context_window", "estimated_wall_hours", "supervisor_cost", "repair_cost",
    "integration_cost", "relative_unit_cost_low", "relative_unit_cost_high",
  ]) {
    if (candidate[field] !== undefined
        && (typeof candidate[field] !== "number" || !Number.isFinite(candidate[field]) || candidate[field] < 0)) {
      throw new Error(`candidate ${field} is invalid`);
    }
  }
  if (candidate.tools !== undefined) {
    if (!Array.isArray(candidate.tools) || !candidate.tools.every((tool) => typeof tool === "string")) {
      throw new Error("candidate tools are invalid");
    }
  }
  if (candidate.privacy_posture !== undefined) {
    requireString(candidate.privacy_posture, "candidate privacy posture");
  }
  secretFree(candidate, `model candidate ${index}`);
}

const REASONING_ORDER = new Map([
  ["LOW", 1],
  ["MEDIUM", 2],
  ["HIGH", 3],
  ["HIGHEST", 4],
]);

function capabilityFailure(candidate, requirements = {}) {
  if (requirements.required_context_window !== undefined
      && (candidate.context_window ?? 0) < requirements.required_context_window) {
    return "CONTEXT_WINDOW_FLOOR";
  }
  if (Array.isArray(requirements.required_tools)
      && !requirements.required_tools.every((tool) => (candidate.tools ?? []).includes(tool))) {
    return "REQUIRED_TOOL_UNAVAILABLE";
  }
  if (requirements.minimum_reasoning !== undefined
      && (REASONING_ORDER.get(candidate.reasoning.toUpperCase()) ?? 0)
        < (REASONING_ORDER.get(String(requirements.minimum_reasoning).toUpperCase()) ?? Infinity)) {
    return "REASONING_FLOOR";
  }
  if (requirements.required_privacy_posture !== undefined
      && candidate.privacy_posture !== requirements.required_privacy_posture) {
    return "PRIVACY_POSTURE_MISMATCH";
  }
  return null;
}

function expectedCostRange(candidate) {
  const expectedOverhead = (candidate.supervisor_cost ?? 0)
    + (candidate.repair_cost ?? 0) + (candidate.integration_cost ?? 0);
  const attemptCost = candidate.estimated_attempts * candidate.relative_unit_cost;
  const lowUnit = candidate.relative_unit_cost_low ?? candidate.relative_unit_cost;
  const highUnit = candidate.relative_unit_cost_high ?? candidate.relative_unit_cost;
  return {
    low: candidate.estimated_attempts * lowUnit + expectedOverhead,
    expected: attemptCost + expectedOverhead,
    high: candidate.estimated_attempts * highUnit + expectedOverhead,
  };
}

function isDominated(candidate, candidates) {
  return candidates.some((other) => other !== candidate
    && other.expected_completion_cost <= candidate.expected_completion_cost
    && other.estimated_success_probability >= candidate.estimated_success_probability
    && (other.estimated_wall_hours ?? Infinity) <= (candidate.estimated_wall_hours ?? Infinity)
    && (other.expected_completion_cost < candidate.expected_completion_cost
      || other.estimated_success_probability > candidate.estimated_success_probability
      || (other.estimated_wall_hours ?? Infinity) < (candidate.estimated_wall_hours ?? Infinity)));
}

export function recommendModels(input) {
  requireRecord(input, "model recommendation input");
  const economics = compileModelEconomics(input.economics);
  if (input.role !== undefined && input.role !== null) {
    requireString(input.role, "model recommendation role");
    if (!MODEL_POLICY_ROLES.includes(input.role)) throw new Error("model recommendation role is unknown");
  }
  const requirements = input.requirements ?? {};
  requireRecord(requirements, "model capability requirements");
  if (requirements.required_context_window !== undefined
      && (typeof requirements.required_context_window !== "number"
        || !Number.isFinite(requirements.required_context_window)
        || requirements.required_context_window <= 0)) {
    throw new Error("required_context_window is invalid");
  }
  if (requirements.required_tools !== undefined
      && (!Array.isArray(requirements.required_tools)
        || !requirements.required_tools.every((tool) => typeof tool === "string"))) {
    throw new Error("required_tools is invalid");
  }
  if (requirements.minimum_reasoning !== undefined) requireString(requirements.minimum_reasoning, "minimum reasoning");
  if (requirements.required_privacy_posture !== undefined) requireString(requirements.required_privacy_posture, "required privacy posture");
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new Error("model candidates must be nonempty");
  }
  const eligible = [];
  const excluded = [];
  for (const [index, candidate] of input.candidates.entries()) {
    try {
      validateCandidate(candidate, index);
      if (candidate.estimated_success_probability < economics.completion_floor) {
        excluded.push({model: candidate.model, reasoning: candidate.reasoning, reason: "BELOW_COMPLETION_FLOOR"});
        continue;
      }
      const capabilityReason = capabilityFailure(candidate, requirements);
      if (capabilityReason) {
        excluded.push({model: candidate.model, reasoning: candidate.reasoning, reason: capabilityReason});
        continue;
      }
      if (economics.deadline_hours !== null
          && candidate.estimated_wall_hours !== undefined
          && candidate.estimated_wall_hours > economics.deadline_hours) {
        excluded.push({model: candidate.model, reasoning: candidate.reasoning, reason: "DEADLINE_UNMET"});
        continue;
      }
      const expectedCostRangeValue = expectedCostRange(candidate);
      eligible.push({
        ...candidate,
        expected_completion_cost: expectedCostRangeValue.expected,
        expected_completion_cost_range: expectedCostRangeValue,
      });
    } catch (error) {
      excluded.push({
        model: candidate?.model ?? `candidate-${index}`,
        reasoning: candidate?.reasoning ?? "UNKNOWN",
        reason: error.message,
      });
    }
  }
  if (eligible.length === 0) throw new Error("NO_ELIGIBLE_MODEL");
  if (economics.max_expected_cost !== null) {
    const overBudget = eligible.filter((candidate) => candidate.expected_completion_cost > economics.max_expected_cost);
    if (overBudget.length === eligible.length) throw new Error("NO_FEASIBLE_MODEL_UNDER_BUDGET");
    for (const candidate of overBudget) {
      excluded.push({model: candidate.model, reasoning: candidate.reasoning, reason: "OVER_EXPECTED_COST_BUDGET"});
    }
    eligible.splice(0, eligible.length, ...eligible.filter((candidate) => candidate.expected_completion_cost <= economics.max_expected_cost));
  }
  eligible.sort((left, right) => {
    if (economics.profile === "PERFORMANCE") {
      return right.estimated_success_probability - left.estimated_success_probability
        || left.estimated_attempts - right.estimated_attempts
        || left.expected_completion_cost - right.expected_completion_cost
        || compareUtf8(left.model, right.model)
        || compareUtf8(left.reasoning, right.reasoning);
    }
    return left.expected_completion_cost - right.expected_completion_cost
      || right.estimated_success_probability - left.estimated_success_probability
      || compareUtf8(left.model, right.model)
      || compareUtf8(left.reasoning, right.reasoning);
  });
  const paretoFrontier = eligible.filter((candidate) => !isDominated(candidate, eligible));
  return {
    schema: "agentos.model_recommendation.v1",
    profile: economics,
    role: input.role ?? null,
    requirements,
    recommended: eligible[0],
    eligible,
    pareto_frontier: paretoFrontier.map((candidate) => candidate.model).sort(compareUtf8),
    dominated: eligible.filter((candidate) => isDominated(candidate, eligible)).map((candidate) => candidate.model).sort(compareUtf8),
    excluded: excluded.sort((left, right) => compareUtf8(
      `${left.model}\0${left.reasoning}`,
      `${right.model}\0${right.reasoning}`,
    )),
    recommendation_sha256: canonicalDigest({profile: economics, eligible, excluded}),
  };
}

export function planBootstrapInterview({discovery = [], answers = {}} = {}) {
  if (!Array.isArray(discovery)) throw new Error("Bootstrap discovery must be an array");
  discovery.forEach(validateDiscoveryFact);
  requireRecord(answers, "Bootstrap Interview answers");
  const answerIds = Object.keys(answers);
  const unknown = answerIds.filter((id) => !BOOTSTRAP_QUESTIONS.some((question) => question.id === id));
  if (unknown.length > 0) throw new Error(`unknown Bootstrap Interview answers: ${unknown.join(", ")}`);
  for (const [id, value] of Object.entries(answers)) {
    validateBootstrapAnswer(id, value, discovery);
  }
  const visible = BOOTSTRAP_QUESTIONS.filter((question) => visibleConditionalQuestion(question, discovery));
  const unresolved = visible.filter((question) => !Object.hasOwn(answers, question.id));
  const requiredCount = visible.filter((question) => question.required).length;
  return {
    schema: "agentos.bootstrap_interview_plan.v1",
    governance_version: "2.1rc",
    discovery_digest_sha256: canonicalDigest(discovery),
    question_budget: {
      visible: visible.length,
      required: requiredCount,
      answered: visible.length - unresolved.length,
      unresolved: unresolved.length,
    },
    questions: unresolved.map((question) => ({
      id: question.id,
      class: question.class,
      type: question.type,
      prompt: question.prompt,
      choices: question.choices ?? null,
      recommended: question.recommended ?? null,
      discovered_facts: discovery.filter((fact) =>
        fact.fact_id === question.id || fact.fact_id.startsWith(`${question.id}.`)),
    })),
    next: unresolved[0]?.id ?? null,
    status: unresolved.length === 0 ? "READY_TO_COMPILE" : "QUESTION_PENDING",
  };
}

export function validateBootstrapAnswer(questionId, value, discovery = []) {
  const question = questionById(questionId);
  if (question.type === "ENUM") {
    if (typeof value !== "string" || !question.choices.includes(value)) {
      throw new Error(`${questionId} is outside its choices`);
    }
  } else if (question.type === "JSON") {
    if (value === undefined || value === null || JSON.stringify(value) === undefined) {
      throw new Error(`${questionId} must be JSON-compatible`);
    }
    secretFree(value, questionId);
  }
  if (questionId === "bootstrap.discovery.mode" && !DISCOVERY_MODES.has(value)) {
    throw new Error("Bootstrap discovery mode is invalid");
  }
  if (questionId === "project.delivery_boundary" && !DELIVERY_BOUNDARIES.has(value)) {
    throw new Error("delivery boundary is invalid");
  }
  if (questionId === "project.model_economics") compileModelEconomics(value);
  if (questionId === "bootstrap.confirmation" && !CONFIRMATION_CHOICES.has(value)) {
    throw new Error("Bootstrap confirmation is invalid");
  }
  if (!Array.isArray(discovery)) throw new Error("discovery must be an array");
  return question;
}

export function compileBootstrapPlan({discovery = [], answers} = {}) {
  const plan = planBootstrapInterview({discovery, answers});
  if (plan.status !== "READY_TO_COMPILE") {
    throw new Error("Bootstrap Interview still has unresolved questions");
  }
  if (answers["bootstrap.confirmation"] !== "PROCEED") {
    throw new Error("Bootstrap plan is not confirmed to proceed");
  }
  const economics = compileModelEconomics(answers["project.model_economics"]);
  const output = {
    schema: "agentos.bootstrap_compiled_plan.v1",
    governance_version: "2.1rc",
    discovery_digest_sha256: canonicalDigest(discovery),
    answers_sha256: canonicalDigest(answers),
    north_star: answers["project.north_star"],
    first_workflow: answers["project.first_workflow"],
    delivery_boundary: answers["project.delivery_boundary"],
    protected_boundaries: answers["project.protected_boundaries"],
    authority_corpus_source: answers["authority-corpus.source"],
    delivery_constraints: answers["project.delivery_constraints"] ?? null,
    design_posture: answers["project.design_posture"] ?? null,
    model_economics: economics,
    legacy_preservation_required: answers["authority-corpus.source"]?.operation
      ? answers["authority-corpus.source"].operation !== "CREATE_NEW"
      : false,
  };
  return {...output, plan_sha256: canonicalDigest(output)};
}

function main() {
  const [command, inputPath] = process.argv.slice(2);
  if (!command || !inputPath) {
    throw new Error("usage: bootstrap-interview <plan|compile|validate> <input.json>");
  }
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const output = command === "plan"
    ? planBootstrapInterview(input)
    : command === "compile"
      ? compileBootstrapPlan(input)
      : command === "validate"
        ? (validateBootstrapAnswer(input.question_id, input.value, input.discovery ?? []), {status: "PASS"})
        : null;
  if (!output) throw new Error("unknown Bootstrap Interview command");
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
