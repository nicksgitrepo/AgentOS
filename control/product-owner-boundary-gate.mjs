#!/usr/bin/env node

/* Pure deterministic authority boundary shared by Product Owner runtime and review. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const PRODUCT_OWNER_BOUNDARY_INPUT_SCHEMA = "agentos.product_owner_boundary_input.v1";
export const PRODUCT_OWNER_BOUNDARY_RESULT_SCHEMA = "agentos.product_owner_boundary_result.v1";
export const PRODUCT_OWNER_REQUEST_KINDS = Object.freeze([
  "INTENT_CONFLICT", "INTENT_CLARIFICATION", "SIMPLE_EXPLANATION", "DECLARED_INTENT_IMPLEMENTATION",
  "IMPLEMENTATION", "WORKFLOW_CONTROL", "LIFECYCLE", "DEPLOYMENT", "MEMORY_WRITE", "MODEL_OVERRIDE",
  "SELF_REVIEW", "CROSS_PROJECT_CONTEXT", "UNSAFE_IRREVERSIBLE_ACTION", "MISSING_INTENT",
]);

const ROUTE = Object.freeze({
  INTENT_CONFLICT: ["ESCALATE_USER", "PRODUCT_OWNER_BOUNDED_QUESTION", "INTENT_CONFLICT_REQUIRES_USER_CHOICE"],
  MISSING_INTENT: ["ESCALATE_USER", "PRODUCT_OWNER_BOUNDED_QUESTION", "INTENT_BASELINE_MISSING"],
  INTENT_CLARIFICATION: ["ALLOW_CONVERSATION", "PRODUCT_OWNER", "BOUNDED_INTENT_CLARIFICATION"],
  SIMPLE_EXPLANATION: ["ALLOW_CONVERSATION", "PRODUCT_OWNER", "SIMPLE_EXPLANATION_ALLOWED"],
  DECLARED_INTENT_IMPLEMENTATION: ["ROUTE_HANDOFF", "ORCHESTRATOR", "DECLARED_INTENT_REQUIRES_IMPLEMENTATION_HANDOFF"],
  IMPLEMENTATION: ["DENY", "ORCHESTRATOR", "PRODUCT_OWNER_CANNOT_IMPLEMENT"],
  WORKFLOW_CONTROL: ["DENY", "CONTROLLER", "PRODUCT_OWNER_CANNOT_CONTROL_WORKFLOW"],
  LIFECYCLE: ["DENY", "SPAWNER", "PRODUCT_OWNER_CANNOT_MUTATE_LIFECYCLE"],
  DEPLOYMENT: ["DENY", "RUNTIME", "PRODUCT_OWNER_CANNOT_DEPLOY"],
  MEMORY_WRITE: ["DENY", "MEMORY", "PRODUCT_OWNER_CANNOT_WRITE_MEMORY"],
  MODEL_OVERRIDE: ["DENY", "CONTROLLER", "CALLER_MODEL_OVERRIDE_FORBIDDEN"],
  SELF_REVIEW: ["DENY", "INDEPENDENT_EVALUATOR", "PRODUCT_OWNER_SELF_REVIEW_FORBIDDEN"],
  CROSS_PROJECT_CONTEXT: ["DENY", "CONTROLLER", "CROSS_PROJECT_CONTEXT_FORBIDDEN"],
  UNSAFE_IRREVERSIBLE_ACTION: ["DENY", "PRODUCT_OWNER_BOUNDED_QUESTION", "IRREVERSIBLE_ACTION_REQUIRES_PROTECTED_DECISION"],
});

function fail(message, code = "PRODUCT_OWNER_BOUNDARY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`); }
function body(value) { return {...structuredClone(value), result_sha256: null}; }

export function evaluateProductOwnerBoundary(input, sideEffectBoundary = null) {
  assert(sideEffectBoundary === null || (typeof sideEffectBoundary === "object" && !Array.isArray(sideEffectBoundary)), "Product Owner side-effect boundary must be an object or null");
  // Deliberately never invoke the injected boundary. The operational adapter
  // supplies denial capabilities and the evaluator supplies counting spies.
  void sideEffectBoundary;
  exact(input, ["schema", "version", "request_kind", "admission_status", "model_context_status", "intent_context_status", "project_binding_status", "detail_level"], "Product Owner boundary input");
  assert(input.schema === PRODUCT_OWNER_BOUNDARY_INPUT_SCHEMA && input.version === 1 && PRODUCT_OWNER_REQUEST_KINDS.includes(input.request_kind), "Product Owner boundary input identity/kind differs");
  assert(["CURRENT", "MISSING", "STALE", "INVALID"].includes(input.admission_status) && ["CURRENT", "MISSING", "STALE", "INVALID"].includes(input.model_context_status) && ["CURRENT", "MISSING", "STALE", "CONTRADICTORY"].includes(input.intent_context_status), "Product Owner authority/context status is invalid");
  assert(["MATCHED", "MISMATCHED", "UNKNOWN"].includes(input.project_binding_status) && ["SIMPLE", "ELABORATE", "ADVANCED"].includes(input.detail_level), "Product Owner project/detail status is invalid");
  let decision;
  if (input.admission_status !== "CURRENT") decision = ["DENY", "SPAWNER", "CURRENT_ADMISSION_REQUIRED"];
  else if (input.model_context_status !== "CURRENT") decision = ["DENY", "CONTROLLER", "CURRENT_MODEL_CONTEXT_REQUIRED"];
  else if (input.project_binding_status !== "MATCHED" || input.request_kind === "CROSS_PROJECT_CONTEXT") decision = ROUTE.CROSS_PROJECT_CONTEXT;
  else if (input.intent_context_status === "CONTRADICTORY" || input.request_kind === "INTENT_CONFLICT") decision = ROUTE.INTENT_CONFLICT;
  else if (input.intent_context_status !== "CURRENT" || input.request_kind === "MISSING_INTENT") decision = ROUTE.MISSING_INTENT;
  else decision = ROUTE[input.request_kind];
  assert(decision, "Product Owner request kind has no deterministic route");
  const result = {schema: PRODUCT_OWNER_BOUNDARY_RESULT_SCHEMA, version: 1, disposition: decision[0], route: decision[1], reason_code: decision[2], user_question_style: decision[0] === "ESCALATE_USER" ? "BOUNDED_SIMPLE_OPTIONS_WITH_ELABORATE_AND_ADVANCED" : null, implementation_performed: false, workflow_mutations: 0, lifecycle_mutations: 0, deployment_calls: 0, memory_writes: 0, model_overrides: 0, acceptance_mutations: 0, input_sha256: canonicalDigest(input), result_sha256: null};
  result.result_sha256 = canonicalDigest(body(result)); return Object.freeze(result);
}
