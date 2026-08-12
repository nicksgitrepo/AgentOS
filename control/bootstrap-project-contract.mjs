#!/usr/bin/env node

/*
 * Deterministic compiler for the smallest real owner-to-project contract
 * slice. It consumes normalized conversation state, never raw owner text.
 */

import {
  BOOTSTRAP_CONVERSATION_SCHEMA,
  BOOTSTRAP_QUESTIONS,
  CERTAINTY,
  canonicalDigest,
  bootstrapQuestionById,
  bootstrapQuestionIsApplicable,
  createBootstrapQuestionMap,
  validateBootstrapConversation,
} from "./bootstrap-conversation.mjs";
import {
  compileBootstrapCompileReceipt,
} from "./bootstrap-compile-receipt.mjs";

export const PROJECT_CONTRACT_SCHEMA = "agentos.project_contract.v1";
export const PROJECT_CONTRACT_VERSION = 1;
export const PROJECT_CONTRACT_STATUSES = Object.freeze(["DRAFT", "READY", "REASSESSMENT_REQUIRED"]);
export const JSA_REASSESSMENT = "JSA_REASSESSMENT_REQUIRED";
export const DEFAULT_REVIEW_INTERVAL_MINUTES = 15;

const COMPILED_PHASE_IDS = Object.freeze(["UNDERSTAND", "BUILD", "CHECK", "HANDOFF"]);
const DECISION_SCOPE = "PROJECT_CONTRACT";
const DECISION_LIFETIME = "CURRENT_CONTRACT";
const DECISION_REVISION_TRIGGER = "OWNER_ANSWER_REVISED_OR_INTENT_SCOPE_CHANGED";
const DISCOVERY_QUESTION_IDS = Object.freeze(["discovery.conflict", "discovery.unknown"]);
const PROJECT_CONVERSATION_MAP = createBootstrapQuestionMap(BOOTSTRAP_QUESTIONS);
const OPEN_QUESTION_IDS = new Set([
  ...BOOTSTRAP_QUESTIONS.map((question) => question.id),
  "delivery.route",
  ...DISCOVERY_QUESTION_IDS,
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const UNSAFE_PERSISTED_TEXT = Object.freeze([
  ["PRIVATE_PATH", /(?:^|[\s"'`=:(\[{])(?:\/(?!\/)(?:[A-Za-z0-9._-]+[\\/]){1,}[A-Za-z0-9._-]+|[A-Za-z]:[\\/]|\\\\|~[\\/]|\.code[x][\\/])[^\s"'`<>)}\]]*/u],
  ["PRIVATE_LINK", /(?:file:\/\/|chat[g]pt-conversation:\/\/|chat:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1|[^\s/]+\.(?:local|internal|private|corp))(?:[/:?\s]|$))/iu],
  ["ENVIRONMENT_VALUE", /(?:\$[A-Z][A-Z0-9_]*|\$\{[A-Z][A-Z0-9_]*\}|\b[A-Z][A-Z0-9_]{2,}=[^\s,;]+)/u],
  ["SECRET", /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|credential)\s*[:=])/iu],
  ["SESSION_OR_TASK_IDENTITY", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu],
]);

const DISCOVERY_STATUSES = Object.freeze(["OBSERVED_FACT", "UNKNOWN", "CONFLICT"]);
const DISCOVERY_EPISTEMIC_CLASSES = Object.freeze([
  "OBSERVED",
  "OWNER_CONFIRMED",
  "ACCEPTED_AUTHORITY",
  "INFERRED_CANDIDATE",
  "CONFLICT",
  "UNKNOWN",
  "DEFERRED_NONBLOCKING",
]);
const SAFE_FACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const SAFE_PROJECT_REF = /^[a-z][a-z0-9._-]{0,63}$/u;
const PROJECT_CONTRACT_KEYS = Object.freeze([
  "schema",
  "version",
  "status",
  "project_ref",
  "intent",
  "project_profile",
  "workflows",
  "terminology",
  "acceptance_conditions",
  "providers",
  "retention",
  "delivery_intent",
  "unknowns",
  "goals",
  "scope",
  "boundaries",
  "phase_plan",
  "decisions",
  "open_questions",
  "governance_inputs",
  "source_binding",
  "discovery_binding",
  "intent_scope_sha256",
  "reassessment",
  "privacy",
  "contract_sha256",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`);
}

function assertOptionalSha(value, label) {
  assert(value === null || (typeof value === "string" && SHA256.test(value)), `${label} must be a SHA-256 or null`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} keys are invalid`);
}

function validateTypedValue(value, label) {
  assert(isRecord(value), `${label} must be typed`);
  const keys = Object.keys(value);
  assert(keys.every((key) => ["value", "certainty", "provenance", "source_question"].includes(key)), `${label} contains an unknown field`);
  assert(Object.hasOwn(value, "value") && Object.hasOwn(value, "certainty") && Object.hasOwn(value, "provenance"), `${label} is incomplete`);
  assert(CERTAINTY.includes(value.certainty), `${label} certainty is invalid`);
  assert(typeof value.provenance === "string" && value.provenance.length > 0, `${label} provenance is invalid`);
  assert(value.source_question === undefined || value.source_question === null || typeof value.source_question === "string", `${label} source question is invalid`);
  return value;
}

function validateTypedList(value, label) {
  validateTypedValue(value, label);
  assert(Array.isArray(value.value), `${label} value must be a list`);
  return value;
}

function validateProjectConversationBoundary(conversation) {
  assert(isRecord(conversation.question_map), "project contract conversation map is missing");
  assert(
    canonicalDigest(conversation.question_map) === canonicalDigest(PROJECT_CONVERSATION_MAP),
    "project contract requires the canonical conversation-map adapter",
  );
  assert(conversation.question_map.map_sha256 === PROJECT_CONVERSATION_MAP.map_sha256, "project contract conversation-map binding is stale");
}

function assertNoUnsafePersistedText(value, label = "record") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUnsafePersistedText(item, `${label}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, child]) => assertNoUnsafePersistedText(child, `${label}.${key}`));
    return;
  }
  if (typeof value !== "string") return;
  for (const [category, pattern] of UNSAFE_PERSISTED_TEXT) {
    if (pattern.test(value)) throw new Error(`${label} contains unsafe ${category}`);
  }
}

function discoveryFactsInput({discoveryFacts = [], discovery = null} = {}) {
  if (discovery !== null) {
    assert(isRecord(discovery), "discovery must be an object or null");
    if (Object.hasOwn(discovery, "schema")) assert(discovery.schema === "agentos.bootstrap_discovery_result.v1", "discovery schema is invalid");
    if (Object.hasOwn(discovery, "version")) assert(discovery.version === 1, "discovery version is invalid");
    assert(Array.isArray(discovery.facts), "discovery facts must be an array");
    assert(discoveryFacts.length === 0, "discovery and discoveryFacts cannot both be supplied");
    return discovery.facts;
  }
  assert(Array.isArray(discoveryFacts), "discoveryFacts must be an array");
  return discoveryFacts;
}

function discoveryEpistemicClass(fact, label) {
  const value = fact.epistemic_class ?? fact.epistemic ?? fact.class
    ?? (fact.status === "OBSERVED_FACT" ? "OBSERVED" : fact.status);
  assert(typeof value === "string" && DISCOVERY_EPISTEMIC_CLASSES.includes(value), `${label} epistemic class is invalid`);
  return value;
}

function prepareDiscoveryBinding(options = {}) {
  const facts = discoveryFactsInput(options);
  const seenFactIds = new Set();
  const projectedFacts = facts.map((fact, index) => {
    const label = `discoveryFacts[${index}]`;
    assert(isRecord(fact), `${label} must be an object`);
    assert(typeof fact.fact_id === "string" && SAFE_FACT_ID.test(fact.fact_id), `${label} fact id is invalid`);
    assert(!seenFactIds.has(fact.fact_id), `${label} fact id is duplicated`);
    seenFactIds.add(fact.fact_id);
    if (Object.hasOwn(fact, "status")) assert(DISCOVERY_STATUSES.includes(fact.status), `${label} status is invalid`);
    const epistemicClass = discoveryEpistemicClass(fact, label);
    if (fact.status === "CONFLICT") assert(epistemicClass === "CONFLICT", `${label} conflict status must use the CONFLICT epistemic class`);
    if (fact.status === "UNKNOWN") assert(epistemicClass === "UNKNOWN", `${label} unknown status must use the UNKNOWN epistemic class`);
    assert(fact.secret_free === true, `${label} must be marked secret-free`);
    if (Object.hasOwn(fact, "value")) assertNoUnsafePersistedText(fact.value, `${label}.value`);
    return {
      fact_id: fact.fact_id,
      status: fact.status ?? null,
      epistemic_class: epistemicClass,
      value_sha256: Object.hasOwn(fact, "value") ? canonicalDigest(fact.value) : null,
    };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.fact_id, "utf8"), Buffer.from(right.fact_id, "utf8")));
  const epistemicCounts = Object.fromEntries(DISCOVERY_EPISTEMIC_CLASSES.map((epistemicClass) => [epistemicClass, 0]));
  const factIdsByEpistemicClass = Object.fromEntries(DISCOVERY_EPISTEMIC_CLASSES.map((epistemicClass) => [epistemicClass, []]));
  for (const fact of projectedFacts) {
    epistemicCounts[fact.epistemic_class] += 1;
    factIdsByEpistemicClass[fact.epistemic_class].push(fact.fact_id);
  }
  const epistemicSha256 = canonicalDigest(factIdsByEpistemicClass);
  const discoverySha256 = canonicalDigest(projectedFacts);
  return {
    status: projectedFacts.length === 0 ? "NONE" : "BOUND",
    fact_count: projectedFacts.length,
    fact_ids: projectedFacts.map((fact) => fact.fact_id),
    fact_ids_by_epistemic_class: factIdsByEpistemicClass,
    epistemic_sha256: epistemicSha256,
    epistemic_counts: epistemicCounts,
    discovery_sha256: discoverySha256,
  };
}

function validateDiscoveryBinding(binding) {
  assert(isRecord(binding), "project contract discovery binding is missing");
  assertExactKeys(binding, ["status", "fact_count", "fact_ids", "fact_ids_by_epistemic_class", "epistemic_sha256", "epistemic_counts", "discovery_sha256"], "project contract discovery binding");
  assert(["NONE", "BOUND"].includes(binding.status), "project contract discovery binding status is invalid");
  assert(Number.isSafeInteger(binding.fact_count) && binding.fact_count >= 0, "project contract discovery fact count is invalid");
  assert(Array.isArray(binding.fact_ids) && binding.fact_ids.length === binding.fact_count, "project contract discovery fact ids are invalid");
  assert(JSON.stringify(binding.fact_ids) === JSON.stringify([...binding.fact_ids].sort()), "project contract discovery fact ids must be sorted");
  assert(new Set(binding.fact_ids).size === binding.fact_ids.length, "project contract discovery fact ids must be unique");
  binding.fact_ids.forEach((factId) => assert(typeof factId === "string" && SAFE_FACT_ID.test(factId), "project contract discovery fact id is invalid"));
  assert(isRecord(binding.fact_ids_by_epistemic_class), "project contract discovery fact id groups are invalid");
  assertExactKeys(binding.fact_ids_by_epistemic_class, DISCOVERY_EPISTEMIC_CLASSES, "project contract discovery fact id groups");
  const groupedFactIds = [];
  for (const epistemicClass of DISCOVERY_EPISTEMIC_CLASSES) {
    const factIds = binding.fact_ids_by_epistemic_class[epistemicClass];
    assert(Array.isArray(factIds), `project contract discovery fact id group is invalid: ${epistemicClass}`);
    assert(JSON.stringify(factIds) === JSON.stringify([...factIds].sort()), `project contract discovery fact id group is not sorted: ${epistemicClass}`);
    assert(new Set(factIds).size === factIds.length, `project contract discovery fact id group contains duplicates: ${epistemicClass}`);
    factIds.forEach((factId) => {
      assert(typeof factId === "string" && SAFE_FACT_ID.test(factId), `project contract discovery fact id group contains an invalid id: ${epistemicClass}`);
      groupedFactIds.push(factId);
    });
  }
  assert(JSON.stringify(groupedFactIds.sort()) === JSON.stringify([...binding.fact_ids].sort()), "project contract discovery fact id groups do not match fact ids");
  assertSha(binding.epistemic_sha256, "project contract discovery epistemic digest");
  assert(binding.epistemic_sha256 === canonicalDigest(binding.fact_ids_by_epistemic_class), "project contract discovery epistemic digest is inconsistent");
  assert(isRecord(binding.epistemic_counts), "project contract discovery epistemic counts are invalid");
  assertExactKeys(binding.epistemic_counts, DISCOVERY_EPISTEMIC_CLASSES, "project contract discovery epistemic counts");
  const countTotal = DISCOVERY_EPISTEMIC_CLASSES.reduce((total, epistemicClass) => {
    const count = binding.epistemic_counts[epistemicClass];
    assert(Number.isSafeInteger(count) && count >= 0, `project contract discovery count is invalid: ${epistemicClass}`);
    assert(count === binding.fact_ids_by_epistemic_class[epistemicClass].length, `project contract discovery count does not match fact ids: ${epistemicClass}`);
    return total + count;
  }, 0);
  assert(countTotal === binding.fact_count, "project contract discovery epistemic counts do not add up");
  assert(binding.status === (binding.fact_count === 0 ? "NONE" : "BOUND"), "project contract discovery binding status is inconsistent");
  assertSha(binding.discovery_sha256, "project contract discovery binding digest");
  return binding;
}

function validateReassessment(reassessment) {
  assertExactKeys(reassessment, ["status", "mode", "reason", "previous_contract_sha256", "prior_intent_scope_sha256", "current_intent_scope_sha256"], "project contract reassessment");
  assert(["NOT_REQUIRED", "REQUIRED"].includes(reassessment.status), "project contract reassessment status is invalid");
  assert(["NONE", JSA_REASSESSMENT].includes(reassessment.mode), "project contract reassessment mode is invalid");
  assert(reassessment.reason === null || typeof reassessment.reason === "string", "project contract reassessment reason is invalid");
  assertOptionalSha(reassessment.previous_contract_sha256, "project contract previous digest");
  assertOptionalSha(reassessment.prior_intent_scope_sha256, "project contract prior intent/scope digest");
  assertSha(reassessment.current_intent_scope_sha256, "project contract current intent/scope digest");
  if (reassessment.status === "NOT_REQUIRED") {
    assert(reassessment.mode === "NONE" && reassessment.reason === null, "project contract non-reassessed state is inconsistent");
  } else {
    assert(reassessment.mode === JSA_REASSESSMENT && reassessment.reason === "OWNER_INTENT_OR_SCOPE_CHANGED", "project contract JSA reason is invalid");
    assert(reassessment.previous_contract_sha256 !== null && reassessment.prior_intent_scope_sha256 !== null, "project contract JSA source binding is incomplete");
  }
  return reassessment;
}

function field(value, certainty, provenance, sourceQuestion = null) {
  assert(CERTAINTY.includes(certainty), `invalid certainty: ${certainty}`);
  return {value, certainty, provenance, source_question: sourceQuestion};
}

function answerValue(conversation, questionId) {
  return conversation.answers[questionId]?.value;
}

function ownerField(conversation, questionId) {
  const answer = conversation.answers[questionId];
  return answer === undefined
    ? field(null, "UNKNOWN", "UNRESOLVED_OWNER", questionId)
    : field(answer.value, answer.certainty, answer.provenance, questionId);
}

function itemList(value, certainty, provenance, sourceQuestion) {
  if (value === null || value === undefined) return field([], certainty, provenance, sourceQuestion);
  return field([value], certainty, provenance, sourceQuestion);
}

function answerList(conversation, questionId) {
  const answer = conversation.answers[questionId];
  return answer === undefined
    ? field([], "UNKNOWN", "UNRESOLVED_OWNER", questionId)
    : field([answer.value], answer.certainty, answer.provenance, questionId);
}

function defaultedChoice(conversation, questionId, value) {
  const answer = conversation.answers[questionId];
  return answer === undefined
    ? field(value, "RECOMMENDED", "COMPILER", questionId)
    : field(answer.value, answer.certainty, answer.provenance, questionId);
}

function ownerConfirmedAnswer(conversation, questionId) {
  const answer = conversation.answers[questionId];
  return answer !== undefined && answer.certainty === "CONFIRMED" && answer.provenance === "OWNER";
}

function blockingQuestion(questionId, prompt, reason) {
  return {
    question_id: questionId,
    prompt,
    reason,
    status: "OPEN",
    blocking: true,
    owner_required: true,
    certainty: "UNKNOWN",
    provenance: "UNRESOLVED_OWNER",
  };
}

function nonBlockingQuestion(questionId, prompt, reason) {
  return {
    question_id: questionId,
    prompt,
    reason,
    status: "DEFERRED",
    blocking: false,
    owner_required: false,
    certainty: "UNKNOWN",
    provenance: "UNRESOLVED_OWNER",
  };
}

function compileBoundaries(conversation) {
  return {
    hard: [
      answerList(conversation, "boundaries.hard"),
      field("Never persist secrets, private paths, or raw host identities.", "CONFIRMED", "KERNEL"),
      field("Never take a protected external action without explicit owner approval.", "CONFIRMED", "KERNEL"),
    ],
    soft: [
      answerList(conversation, "boundaries.soft"),
      field("Pause and request JSA reassessment when intent or scope changes.", "CONFIRMED", "KERNEL"),
      field("Pause when a material owner choice is unclear.", "RECOMMENDED", "COMPILER"),
    ],
    conflict_rule: "THE_MORE_RESTRICTIVE_BOUNDARY_WINS",
    hard_boundary_behavior: "STOP_DEPENDENT_WORK_AND_PRESERVE_SAFE_STATE",
    soft_boundary_behavior: "HOLD_DEPENDENT_WORK_FOR_OWNER_OR_ORCHESTRATOR_REVIEW",
  };
}

function compileGoals({intent, scope, boundaries, status}) {
  const goalRef = `goal:${canonicalDigest({intent, scope, boundaries}).slice(0, 24)}`;
  return [{
    goal_ref: goalRef,
    status: status === "READY" ? "OPEN" : "DRAFT",
    objective: field(intent.outcome.value, intent.outcome.certainty, intent.outcome.provenance, intent.outcome.source_question),
    audience: intent.audience,
    first_result: intent.first_result,
    scope: {
      allowed: scope.allowed,
      non_goals: scope.non_goals,
    },
    boundaries_ref: canonicalDigest(boundaries),
    success_conditions: [intent.first_result],
    certainty: status === "READY" ? "INFERRED" : "UNKNOWN",
    provenance: "COMPILER",
  }];
}

function compilePhases(goal, intent, delivery) {
  return [
    {
      phase_id: "UNDERSTAND",
      name: "Confirm the useful first result",
      goal_ref: goal.goal_ref,
      entry_conditions: ["OWNER_INTENT_BOUND"],
      exit_conditions: ["OUTCOME_AND_SCOPE_RECORDED"],
      status: "PLANNED",
      certainty: "INFERRED",
      provenance: "COMPILER",
    },
    {
      phase_id: "BUILD",
      name: "Make the first useful result",
      goal_ref: goal.goal_ref,
      entry_conditions: ["SCOPE_BOUND", "HARD_BOUNDARIES_BOUND"],
      exit_conditions: [intent.first_result.value ?? "FIRST_RESULT_BOUND"],
      status: "PLANNED",
      certainty: "INFERRED",
      provenance: "COMPILER",
    },
    {
      phase_id: "CHECK",
      name: "Check it against the agreed result",
      goal_ref: goal.goal_ref,
      entry_conditions: ["FIRST_RESULT_AVAILABLE"],
      exit_conditions: ["INDEPENDENT_CHECK_COMPLETE"],
      status: "PLANNED",
      certainty: "INFERRED",
      provenance: "COMPILER",
    },
    {
      phase_id: "HANDOFF",
      name: "Finish the way you chose",
      goal_ref: goal.goal_ref,
      entry_conditions: ["CHECK_COMPLETE"],
      exit_conditions: [`DELIVERY_FINISH_${String(delivery.value ?? "UNKNOWN")}`],
      status: "PLANNED",
      certainty: "INFERRED",
      provenance: "COMPILER",
    },
  ];
}

function compileDecisions(conversation) {
  return conversation.answer_order.map((questionId) => {
    const answer = conversation.answers[questionId];
    if (answer.certainty !== "CONFIRMED" || answer.provenance !== "OWNER") return null;
    return {
      decision_ref: `decision:${answer.answer_sha256.slice(0, 24)}`,
      question_id: questionId,
      value: answer.value,
      status: "ACCEPTED",
      certainty: "CONFIRMED",
      authority: "OWNER",
      provenance: "OWNER",
      provenance_class: "OWNER_CONFIRMED",
      scope: DECISION_SCOPE,
      lifetime: DECISION_LIFETIME,
      revision_trigger: DECISION_REVISION_TRIGGER,
      answer_sha256: answer.answer_sha256,
    };
  }).filter(Boolean);
}

function compileOpenQuestions(conversation, discoveryBinding) {
  const questions = conversation.question_map.questions
    .filter((question) => question.required
      && bootstrapQuestionIsApplicable(question, conversation.answers)
      && !ownerConfirmedAnswer(conversation, question.id))
    .map((question) => {
    const questionId = question.id;
    return blockingQuestion(
      questionId,
      question.prompt,
      "This answer is required because it materially changes the project plan, specialist routing, proof, or authority boundary.",
    );
  });
  if (discoveryBinding.fact_ids_by_epistemic_class.CONFLICT.length > 0) {
    questions.push(blockingQuestion(
      "discovery.conflict",
      "Which observed project facts should control the plan?",
      "Discovery found conflicting observations; Bootstrap must not choose between them silently.",
    ));
  }
  if (discoveryBinding.fact_ids_by_epistemic_class.UNKNOWN.length > 0) {
    questions.push(blockingQuestion(
      "discovery.unknown",
      "Which missing project facts should be confirmed before work starts?",
      "Discovery could not establish material facts; the dependent contract remains unresolved.",
    ));
  }
  for (const question of conversation.question_map.questions) {
    if (question.required || !bootstrapQuestionIsApplicable(question, conversation.answers)
      || Object.hasOwn(conversation.answers, question.id)) continue;
    questions.push(nonBlockingQuestion(
      question.id,
      question.prompt,
      "This context can sharpen later work but does not block the first bounded project contract.",
    ));
  }
  return questions;
}

function compileRoadmapContext(conversation, intent) {
  const acceptance = conversation.answers["acceptance.conditions"] === undefined
    ? field(intent.first_result.value === null ? [] : [intent.first_result.value], "INFERRED", "COMPILER", "intent.first_result")
    : answerList(conversation, "acceptance.conditions");
  return {
    workflows: answerList(conversation, "workflow.steps"),
    terminology: answerList(conversation, "terminology.preferred"),
    acceptance_conditions: acceptance,
    providers: {
      posture: defaultedChoice(conversation, "governance.providers", "LOCAL_ONLY"),
      identities: field([], "CONFIRMED", "KERNEL", null),
      identity_policy: field("PROVIDER_IDENTITIES_NOT_PERSISTED", "CONFIRMED", "KERNEL", null),
    },
    retention: {
      posture: defaultedChoice(conversation, "governance.retention", "OWNER_REVIEW"),
      raw_conversation: field(false, "CONFIRMED", "KERNEL", null),
    },
    delivery_intent: {
      finish: ownerField(conversation, "delivery.finish"),
      first_destination: defaultedChoice(conversation, "delivery.intent", "LOCAL_REVIEW"),
    },
  };
}

function compileUnknowns(conversation, openQuestions) {
  const questionIds = new Set(openQuestions.map((question) => question.question_id));
  for (const questionId of ["workflow.steps", "terminology.preferred", "acceptance.conditions"]) {
    if (!Object.hasOwn(conversation.answers, questionId)) questionIds.add(questionId);
  }
  const value = [...questionIds].sort((left, right) => Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8")));
  return field(value, value.length === 0 ? "CONFIRMED" : "UNKNOWN", "COMPILER", null);
}

function compileGovernanceInputs(conversation) {
  const reviewAnswer = conversation.answers["governance.review_interval"];
  const reviewInterval = reviewAnswer?.value ?? DEFAULT_REVIEW_INTERVAL_MINUTES;
  assert(Number.isSafeInteger(reviewInterval) && reviewInterval >= 1 && reviewInterval <= 240, "governance review interval is invalid");
  return {
    review_interval_minutes: reviewAnswer === undefined
      ? field(DEFAULT_REVIEW_INTERVAL_MINUTES, "RECOMMENDED", "COMPILER", "governance.review_interval")
      : field(reviewInterval, "CONFIRMED", "OWNER", "governance.review_interval"),
    memory_posture: ownerField(conversation, "governance.memory"),
    owner_approval_required_for_protected_actions: field(true, "CONFIRMED", "KERNEL"),
    question_policy: field("ONE_SHORT_OWNER_QUESTION_AT_A_TIME", "CONFIRMED", "KERNEL"),
    unresolved_owner_decisions_fail_closed: field(true, "CONFIRMED", "KERNEL"),
    delivery_route: field("DEFERRED_UNTIL_HOST_BINDING", "RECOMMENDED", "COMPILER"),
    source_posture: field("OWNER_CONVERSATION_AND_TYPED_DISCOVERY_ONLY", "RECOMMENDED", "COMPILER"),
  };
}

function compileIntent(conversation) {
  const audience = ownerField(conversation, "intent.audience");
  const outcome = ownerField(conversation, "intent.outcome");
  const firstResult = ownerField(conversation, "intent.first_result");
  return {
    audience,
    outcome,
    first_result: firstResult,
    summary: field(
      outcome.value === null ? null : `${outcome.value} for ${audience.value ?? "the chosen audience"}`,
      outcome.value === null || audience.value === null ? "UNKNOWN" : "INFERRED",
      "COMPILER",
    ),
  };
}

function compileScope(conversation) {
  return {
    allowed: answerList(conversation, "scope.allowed"),
    non_goals: answerList(conversation, "scope.non_goals"),
    product_repository_writes: field("NOT_BOUND_BY_THIS_SLICE", "RECOMMENDED", "COMPILER"),
  };
}

function conditionalProfileField(conversation, questionId) {
  const question = bootstrapQuestionById(questionId, conversation.question_map);
  if (!bootstrapQuestionIsApplicable(question, conversation.answers)) {
    return field("NOT_APPLICABLE", "CONFIRMED", "COMPILER", questionId);
  }
  return ownerField(conversation, questionId);
}

function compileProjectProfile(conversation) {
  return {
    starting_point: ownerField(conversation, "project.starting_point"),
    existing_invariants: conditionalProfileField(conversation, "existing.invariants"),
    capabilities: ownerField(conversation, "project.capabilities"),
    experience_channels: conditionalProfileField(conversation, "experience.channels"),
    backend_behavior: conditionalProfileField(conversation, "backend.behavior"),
    data_posture: conditionalProfileField(conversation, "data.posture"),
    data_lifecycle: conditionalProfileField(conversation, "data.lifecycle"),
    access_model: conditionalProfileField(conversation, "access.model"),
    ai_behavior: conditionalProfileField(conversation, "ai.behavior"),
    ai_truth_boundary: conditionalProfileField(conversation, "ai.truth_boundary"),
    integration_boundaries: conditionalProfileField(conversation, "integrations.boundaries"),
    hardware_constraints: conditionalProfileField(conversation, "hardware.constraints"),
    commerce_boundaries: conditionalProfileField(conversation, "commerce.boundaries"),
    risk_applicability: conditionalProfileField(conversation, "risk.applicability"),
    technology_constraints: ownerField(conversation, "technology.constraints"),
    operating_conditions: ownerField(conversation, "operations.conditions"),
    quality_priorities: ownerField(conversation, "quality.priorities"),
  };
}

function intentScopeDigest(contractParts) {
  return canonicalDigest({intent: contractParts.intent, scope: contractParts.scope, project_profile: contractParts.projectProfile});
}

function changedIntentOrScope(previousContract, currentDigest) {
  if (!previousContract || !["READY", "REASSESSMENT_REQUIRED"].includes(previousContract.status)) return false;
  return previousContract.intent_scope_sha256 !== currentDigest;
}

function compileProjectContractInternal({conversation, discoveryFacts = [], discovery = null, previousContract = null} = {}) {
  validateBootstrapConversation(conversation);
  validateProjectConversationBoundary(conversation);
  assert(previousContract === null || isRecord(previousContract), "previousContract must be an object or null");
  if (previousContract !== null) validateProjectContract(previousContract);
  const discoveryBinding = prepareDiscoveryBinding({discoveryFacts, discovery});

  const intent = compileIntent(conversation);
  const scope = compileScope(conversation);
  const projectProfile = compileProjectProfile(conversation);
  const boundaries = compileBoundaries(conversation);
  const delivery = ownerField(conversation, "delivery.finish");
  const governanceInputs = compileGovernanceInputs(conversation);
  const blockingQuestions = compileOpenQuestions(conversation, discoveryBinding);
  const statusBeforeReassessment = conversation.status === "READY_FOR_CONTRACT" && !blockingQuestions.some((question) => question.blocking) ? "READY" : "DRAFT";
  const parts = {intent, scope, projectProfile};
  const currentIntentScopeSha256 = intentScopeDigest(parts);
  const requiresJsa = changedIntentOrScope(previousContract, currentIntentScopeSha256);
  const status = requiresJsa ? "REASSESSMENT_REQUIRED" : statusBeforeReassessment;
  const goals = compileGoals({intent, scope, boundaries, status});
  const phases = compilePhases(goals[0], intent, delivery);
  const decisions = compileDecisions(conversation);
  const openQuestions = [...blockingQuestions, nonBlockingQuestion(
    "delivery.route",
    "Which outside delivery route should be connected later?",
    "The actual provider or environment binding is outside this conversation slice.",
  )];
  const roadmapContext = compileRoadmapContext(conversation, intent);
  const unknowns = compileUnknowns(conversation, openQuestions);

  const contract = {
    schema: PROJECT_CONTRACT_SCHEMA,
    version: PROJECT_CONTRACT_VERSION,
    status,
    project_ref: conversation.project_ref,
    intent,
    project_profile: projectProfile,
    workflows: roadmapContext.workflows,
    terminology: roadmapContext.terminology,
    acceptance_conditions: roadmapContext.acceptance_conditions,
    providers: roadmapContext.providers,
    retention: roadmapContext.retention,
    delivery_intent: roadmapContext.delivery_intent,
    unknowns,
    goals,
    scope,
    boundaries,
    phase_plan: phases,
    decisions,
    open_questions: openQuestions,
    governance_inputs: governanceInputs,
    source_binding: {
      conversation_schema: BOOTSTRAP_CONVERSATION_SCHEMA,
      conversation_sha256: conversation.session_sha256,
      question_map_sha256: conversation.question_map.map_sha256,
      discovery_sha256: discoveryBinding.discovery_sha256,
      raw_owner_text_persisted: false,
      host_binding_required: true,
    },
    discovery_binding: discoveryBinding,
    intent_scope_sha256: currentIntentScopeSha256,
    reassessment: requiresJsa
      ? {
        status: "REQUIRED",
        mode: JSA_REASSESSMENT,
        reason: "OWNER_INTENT_OR_SCOPE_CHANGED",
        previous_contract_sha256: previousContract.contract_sha256,
        prior_intent_scope_sha256: previousContract.intent_scope_sha256,
        current_intent_scope_sha256: currentIntentScopeSha256,
      }
      : {
        status: "NOT_REQUIRED",
        mode: "NONE",
        reason: null,
        previous_contract_sha256: previousContract?.contract_sha256 ?? null,
        prior_intent_scope_sha256: previousContract?.intent_scope_sha256 ?? null,
        current_intent_scope_sha256: currentIntentScopeSha256,
      },
    privacy: {
      raw_conversation_persisted: false,
      secrets_persisted: false,
      paths_persisted: false,
      host_session_identities_persisted: false,
    },
    contract_sha256: null,
  };
  assertNoUnsafePersistedText(contract, "project contract");
  contract.contract_sha256 = canonicalDigest(contract);
  validateProjectContract(contract);
  return contract;
}

export function compileProjectContract(options = {}) {
  return compileProjectContractInternal(options);
}

function safeConversationDigest(conversation) {
  try {
    validateBootstrapConversation(conversation);
    return conversation.session_sha256;
  } catch {
    return null;
  }
}

function safeDiscoveryBinding(options) {
  try {
    return prepareDiscoveryBinding(options);
  } catch {
    return null;
  }
}

function safeCompilerVersion(value) {
  return typeof value === "string" && /^[a-z][a-z0-9._-]{0,127}$/u.test(value)
    ? value
    : "bootstrap-project-contract.v1";
}

function classifyCompileFailure(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/(?:unsafe|secret|private|path|environment|session|identity)/iu.test(message)) return "PRIVACY_BOUNDARY_FAILURE";
  if (/(?:digest|content-addressed|sha-256|integrity)/iu.test(message)) return "INTEGRITY_FAILURE";
  if (/(?:unknown|unsupported|invalid)/iu.test(message)) return "UNKNOWN_INPUT_REJECTED";
  return "COMPILATION_VALIDATION_FAILURE";
}

export function compileProjectContractWithReceipt(options = {}) {
  const compilerVersion = safeCompilerVersion(options.compilerVersion);
  try {
    const contract = compileProjectContract(options);
    const receiptStatus = contract.status === "DRAFT" ? "QUESTION_PENDING" : contract.status;
    const blockingQuestionIds = contract.open_questions
      .filter((question) => question.blocking)
      .map((question) => question.question_id);
    const receipt = compileBootstrapCompileReceipt({
      status: receiptStatus,
      conversationSha256: contract.source_binding.conversation_sha256,
      discoverySha256: contract.source_binding.discovery_sha256,
      contractSha256: contract.contract_sha256,
      intentScopeSha256: contract.intent_scope_sha256,
      blockingQuestionIds,
      reassessmentRequired: contract.status === "REASSESSMENT_REQUIRED",
      compilerVersion,
    });
    return {contract, receipt};
  } catch (error) {
    if (options.failClosed !== true) throw error;
    const discoveryBinding = safeDiscoveryBinding(options);
    const receipt = compileBootstrapCompileReceipt({
      status: "BLOCKED",
      conversationSha256: safeConversationDigest(options.conversation),
      discoverySha256: discoveryBinding?.discovery_sha256 ?? null,
      failureCode: classifyCompileFailure(error),
      compilerVersion,
    });
    return {contract: null, receipt};
  }
}

export function validateProjectContract(contract) {
  assert(isRecord(contract), "project contract must be an object");
  assertExactKeys(contract, PROJECT_CONTRACT_KEYS, "project contract");
  assert(contract.schema === PROJECT_CONTRACT_SCHEMA && contract.version === PROJECT_CONTRACT_VERSION, "project contract identity is invalid");
  assert(PROJECT_CONTRACT_STATUSES.includes(contract.status), "project contract status is invalid");
  assert(typeof contract.project_ref === "string" && SAFE_PROJECT_REF.test(contract.project_ref), "project contract project reference is invalid");
  assert(isRecord(contract.intent) && isRecord(contract.scope) && isRecord(contract.boundaries), "project contract intent, scope, or boundaries are missing");
  assertExactKeys(contract.intent, ["audience", "outcome", "first_result", "summary"], "project contract intent");
  assertExactKeys(contract.project_profile, [
    "starting_point", "existing_invariants", "capabilities", "experience_channels", "backend_behavior", "data_posture", "data_lifecycle", "access_model",
    "ai_behavior", "ai_truth_boundary", "integration_boundaries", "hardware_constraints", "commerce_boundaries",
    "risk_applicability", "technology_constraints", "operating_conditions", "quality_priorities",
  ], "project contract project profile");
  for (const [key, value] of Object.entries(contract.project_profile)) validateTypedValue(value, `project contract project_profile.${key}`);
  for (const key of ["workflows", "terminology", "acceptance_conditions", "unknowns"]) validateTypedList(contract[key], "project contract " + key);
  assertExactKeys(contract.providers, ["posture", "identities", "identity_policy"], "project contract providers");
  validateTypedValue(contract.providers.posture, "project contract providers.posture");
  validateTypedList(contract.providers.identities, "project contract providers.identities");
  validateTypedValue(contract.providers.identity_policy, "project contract providers.identity_policy");
  assert(canonicalDigest(contract.providers.identities) === canonicalDigest(field([], "CONFIRMED", "KERNEL", null)), "project contract provider identities must remain empty");
  assertExactKeys(contract.retention, ["posture", "raw_conversation"], "project contract retention");
  validateTypedValue(contract.retention.posture, "project contract retention.posture");
  validateTypedValue(contract.retention.raw_conversation, "project contract retention.raw_conversation");
  assert(contract.retention.raw_conversation.value === false, "project contract retention may not retain raw conversation");
  assertExactKeys(contract.delivery_intent, ["finish", "first_destination"], "project contract delivery intent");
  validateTypedValue(contract.delivery_intent.finish, "project contract delivery intent.finish");
  validateTypedValue(contract.delivery_intent.first_destination, "project contract delivery intent.first_destination");
  assertExactKeys(contract.scope, ["allowed", "non_goals", "product_repository_writes"], "project contract scope");
  assertExactKeys(contract.boundaries, ["hard", "soft", "conflict_rule", "hard_boundary_behavior", "soft_boundary_behavior"], "project contract boundaries");
  assert(contract.boundaries.conflict_rule === "THE_MORE_RESTRICTIVE_BOUNDARY_WINS", "project contract boundary conflict rule is invalid");
  assert(contract.boundaries.hard_boundary_behavior === "STOP_DEPENDENT_WORK_AND_PRESERVE_SAFE_STATE", "project contract hard-boundary behavior is invalid");
  assert(contract.boundaries.soft_boundary_behavior === "HOLD_DEPENDENT_WORK_FOR_OWNER_OR_ORCHESTRATOR_REVIEW", "project contract soft-boundary behavior is invalid");
  for (const key of ["audience", "outcome", "first_result", "summary"]) validateTypedValue(contract.intent[key], `project contract intent.${key}`);
  validateTypedList(contract.scope.allowed, "project contract scope.allowed");
  validateTypedList(contract.scope.non_goals, "project contract scope.non_goals");
  validateTypedValue(contract.scope.product_repository_writes, "project contract scope.product_repository_writes");
  assert(Array.isArray(contract.goals) && contract.goals.length === 1, "project contract must contain one primary goal");
  assert(Array.isArray(contract.phase_plan) && contract.phase_plan.length === 4, "project contract phase plan is incomplete");
  assert(Array.isArray(contract.decisions) && Array.isArray(contract.open_questions), "project contract decisions or open questions are invalid");
  assert(isRecord(contract.governance_inputs) && isRecord(contract.source_binding) && isRecord(contract.discovery_binding) && isRecord(contract.reassessment) && isRecord(contract.privacy), "project contract governance or binding inputs are missing");
  assertExactKeys(contract.governance_inputs, ["review_interval_minutes", "memory_posture", "owner_approval_required_for_protected_actions", "question_policy", "unresolved_owner_decisions_fail_closed", "delivery_route", "source_posture"], "project contract governance inputs");
  for (const [key, value] of Object.entries(contract.governance_inputs)) validateTypedValue(value, `project contract governance_inputs.${key}`);
  assertExactKeys(contract.source_binding, ["conversation_schema", "conversation_sha256", "question_map_sha256", "discovery_sha256", "raw_owner_text_persisted", "host_binding_required"], "project contract source binding");
  assert(contract.source_binding.conversation_schema === BOOTSTRAP_CONVERSATION_SCHEMA, "project contract conversation schema binding is invalid");
  assertSha(contract.source_binding.conversation_sha256, "project contract conversation digest");
  assertSha(contract.source_binding.question_map_sha256, "project contract question-map digest");
  assert(contract.source_binding.question_map_sha256 === PROJECT_CONVERSATION_MAP.map_sha256, "project contract question-map binding is invalid");
  assertSha(contract.source_binding.discovery_sha256, "project contract discovery digest");
  assert(contract.source_binding.raw_owner_text_persisted === false && contract.source_binding.host_binding_required === true, "project contract source binding posture is unsafe");
  validateDiscoveryBinding(contract.discovery_binding);
  assert(contract.source_binding.discovery_sha256 === contract.discovery_binding.discovery_sha256, "project contract discovery binding is inconsistent");
  validateReassessment(contract.reassessment);
  assertExactKeys(contract.privacy, ["raw_conversation_persisted", "secrets_persisted", "paths_persisted", "host_session_identities_persisted"], "project contract privacy");
  for (const [index, boundary] of [...contract.boundaries.hard, ...contract.boundaries.soft].entries()) validateTypedValue(boundary, `project contract boundary ${index}`);
  assert(canonicalDigest(contract.goals[0].audience) === canonicalDigest(contract.intent.audience), "project contract goal audience is inconsistent");
  assert(canonicalDigest(contract.goals[0].first_result) === canonicalDigest(contract.intent.first_result), "project contract goal first result is inconsistent");
  assert(canonicalDigest(contract.goals[0].scope.allowed) === canonicalDigest(contract.scope.allowed), "project contract goal allowed scope is inconsistent");
  assert(canonicalDigest(contract.goals[0].scope.non_goals) === canonicalDigest(contract.scope.non_goals), "project contract goal non-goals are inconsistent");
  assert(contract.goals[0].boundaries_ref === canonicalDigest(contract.boundaries), "project contract goal boundary reference is inconsistent");
  for (const [index, goal] of contract.goals.entries()) {
    assertExactKeys(goal, ["goal_ref", "status", "objective", "audience", "first_result", "scope", "boundaries_ref", "success_conditions", "certainty", "provenance"], `project contract goal ${index}`);
    assertExactKeys(goal.scope, ["allowed", "non_goals"], `project contract goal ${index} scope`);
    assert(["DRAFT", "OPEN"].includes(goal.status), `project contract goal ${index} status is invalid`);
    assert(typeof goal.goal_ref === "string" && /^goal:[0-9a-f]{24}$/u.test(goal.goal_ref), `project contract goal ${index} reference is invalid`);
    assertSha(goal.boundaries_ref, `project contract goal ${index} boundary digest`);
    validateTypedValue(goal.objective, `project contract goal ${index} objective`);
    validateTypedValue(goal.audience, `project contract goal ${index} audience`);
    validateTypedValue(goal.first_result, `project contract goal ${index} first result`);
    validateTypedList(goal.scope.allowed, `project contract goal ${index} allowed scope`);
    validateTypedList(goal.scope.non_goals, `project contract goal ${index} non-goals`);
    for (const [conditionIndex, condition] of goal.success_conditions.entries()) validateTypedValue(condition, `project contract goal ${index} success condition ${conditionIndex}`);
    assert(CERTAINTY.includes(goal.certainty) && typeof goal.provenance === "string", `project contract goal ${index} certainty is invalid`);
  }
  assert(JSON.stringify(contract.phase_plan.map((phase) => phase.phase_id)) === JSON.stringify(COMPILED_PHASE_IDS), "project contract phase sequence is invalid");
  for (const [index, phase] of contract.phase_plan.entries()) {
    assertExactKeys(phase, ["phase_id", "name", "goal_ref", "entry_conditions", "exit_conditions", "status", "certainty", "provenance"], `project contract phase ${index}`);
    assert(typeof phase.phase_id === "string" && typeof phase.name === "string", `project contract phase ${index} identity is invalid`);
    assert(typeof phase.goal_ref === "string" && /^goal:[0-9a-f]{24}$/u.test(phase.goal_ref) && phase.goal_ref === contract.goals[0].goal_ref, `project contract phase ${index} goal reference is invalid`);
    assert(phase.status === "PLANNED", `project contract phase ${index} status is invalid`);
    assert(Array.isArray(phase.entry_conditions) && Array.isArray(phase.exit_conditions), `project contract phase ${index} conditions are invalid`);
    assert(phase.entry_conditions.every((condition) => typeof condition === "string") && phase.exit_conditions.every((condition) => typeof condition === "string"), `project contract phase ${index} conditions are invalid`);
    assert(CERTAINTY.includes(phase.certainty) && typeof phase.provenance === "string", `project contract phase ${index} certainty is invalid`);
  }
  const decisionQuestionIds = new Set();
  for (const [index, decision] of contract.decisions.entries()) {
    assertExactKeys(decision, ["decision_ref", "question_id", "value", "status", "certainty", "authority", "provenance", "provenance_class", "scope", "lifetime", "revision_trigger", "answer_sha256"], `project contract decision ${index}`);
    assert(typeof decision.decision_ref === "string" && /^decision:[0-9a-f]{24}$/u.test(decision.decision_ref), `project contract decision ${index} reference is invalid`);
    assert(CERTAINTY.includes(decision.certainty) && typeof decision.provenance === "string" && decision.provenance_class === "OWNER_CONFIRMED" && decision.authority === "OWNER" && decision.status === "ACCEPTED", `project contract decision ${index} certainty is invalid`);
    assert(!decisionQuestionIds.has(decision.question_id), `project contract decision ${index} question is duplicated`);
    decisionQuestionIds.add(decision.question_id);
    assert(typeof decision.question_id === "string", `project contract decision ${index} question is invalid`);
    try {
      bootstrapQuestionById(decision.question_id);
    } catch {
      throw new Error(`project contract decision ${index} question is unknown`);
    }
    assertSha(decision.answer_sha256, `project contract decision ${index} answer digest`);
    assert(decision.decision_ref === `decision:${decision.answer_sha256.slice(0, 24)}`, `project contract decision ${index} reference is not bound to its answer`);
    assert(decision.scope === DECISION_SCOPE && decision.lifetime === DECISION_LIFETIME && decision.revision_trigger === DECISION_REVISION_TRIGGER, `project contract decision ${index} revision metadata is invalid`);
  }
  const decisionQuestionOrder = contract.decisions.map((decision) => decision.question_id);
  const canonicalDecisionQuestionOrder = BOOTSTRAP_QUESTIONS
    .map((question) => question.id)
    .filter((questionId) => decisionQuestionIds.has(questionId));
  assert(JSON.stringify(decisionQuestionOrder) === JSON.stringify(canonicalDecisionQuestionOrder), "project contract decision order is not canonical");
  const openQuestionIds = new Set();
  for (const [index, question] of contract.open_questions.entries()) {
    assertExactKeys(question, ["question_id", "prompt", "reason", "status", "blocking", "owner_required", "certainty", "provenance"], `project contract open question ${index}`);
    assert(CERTAINTY.includes(question.certainty) && typeof question.provenance === "string", `project contract open question ${index} certainty is invalid`);
    assert(typeof question.blocking === "boolean" && typeof question.owner_required === "boolean", `project contract open question ${index} blocking state is invalid`);
    assert(typeof question.question_id === "string" && typeof question.prompt === "string" && typeof question.reason === "string", `project contract open question ${index} text is invalid`);
    assert(OPEN_QUESTION_IDS.has(question.question_id), `project contract open question ${index} identity is unknown`);
    assert(!openQuestionIds.has(question.question_id), `project contract open question ${index} is duplicated`);
    openQuestionIds.add(question.question_id);
    assert(question.blocking ? question.status === "OPEN" && question.owner_required : question.status === "DEFERRED" && question.owner_required === false, `project contract open question ${index} state is inconsistent`);
  }
  assert(openQuestionIds.has("discovery.conflict") === (contract.discovery_binding.fact_ids_by_epistemic_class.CONFLICT.length > 0), "project contract discovery conflict question is inconsistent");
  assert(openQuestionIds.has("discovery.unknown") === (contract.discovery_binding.fact_ids_by_epistemic_class.UNKNOWN.length > 0), "project contract discovery unknown question is inconsistent");
  const reviewInterval = contract.governance_inputs.review_interval_minutes.value;
  assert(Number.isSafeInteger(reviewInterval) && reviewInterval >= 1 && reviewInterval <= 240, "project contract review interval is invalid");
  assert(contract.source_binding.raw_owner_text_persisted === false && contract.privacy.raw_conversation_persisted === false, "project contract stores raw conversation");
  assert(contract.privacy.secrets_persisted === false && contract.privacy.paths_persisted === false && contract.privacy.host_session_identities_persisted === false, "project contract privacy posture is unsafe");
  assert(contract.boundaries.hard.length > 0 && contract.boundaries.soft.length > 0, "project contract boundary sets are incomplete");
  const blocking = contract.open_questions.filter((question) => question.blocking);
  if (contract.status === "READY") assert(blocking.length === 0, "ready project contract has blocking open questions");
  if (contract.status === "DRAFT") assert(blocking.length > 0, "draft project contract has no blocking owner question");
  if (contract.status !== "REASSESSMENT_REQUIRED") assert(contract.reassessment.status === "NOT_REQUIRED" && contract.reassessment.mode === "NONE", "non-reassessed project contract has reassessment state");
  if (contract.status === "REASSESSMENT_REQUIRED") {
    assert(contract.reassessment.mode === JSA_REASSESSMENT && contract.reassessment.status === "REQUIRED", "intent or scope changes must require JSA reassessment");
    assert(contract.reassessment.previous_contract_sha256 !== null && contract.reassessment.prior_intent_scope_sha256 !== null, "JSA reassessment requires a prior contract binding");
  }
  assertSha(contract.intent_scope_sha256, "project contract intent/scope digest");
  assertSha(contract.contract_sha256, "project contract digest");
  assert(contract.contract_sha256 === canonicalDigest({...contract, contract_sha256: null}), "project contract is not content-addressed");
  assertNoUnsafePersistedText(contract, "project contract");
  return contract;
}

export function reassessProjectContract({conversation, previousContract, discoveryFacts = [], discovery = null} = {}) {
  assert(previousContract && previousContract.contract_sha256, "reassessment requires a previous project contract");
  return compileProjectContract({conversation, previousContract, discoveryFacts, discovery});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Bootstrap project-contract compiler loaded\n");
