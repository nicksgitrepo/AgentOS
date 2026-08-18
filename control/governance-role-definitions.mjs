#!/usr/bin/env node

import {sha256} from "./governance-library.mjs";

export const ROLE_DEFINITION_SOURCE_SCHEMA = "agentos.governance_role_definition_source.v1";
export const ROLE_DEFINITION_SOURCE_KIND = "CANONICAL_GENERAL_ROLE_DEFINITIONS";
export const ROLE_DEFINITION_SOURCE_VERSION = 1;

export const ROLE_SCOPES = Object.freeze(["CAMPAIGN", "PERSISTENT"]);
export const ROLE_KINDS = Object.freeze([
  "CONTROLLER",
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "MEMORY",
  "NAMED_ROLE",
  "ONE_LANE_WORKER",
  "ORCHESTRATOR",
  "PRODUCT_OWNER",
  "RUNTIME",
  "SCHEDULER",
]);
export const RETIRED_CURRENT_ROLE_IDS = Object.freeze(["AGENTOS.INTENT_REGULATOR", "AGENTOS.PROJECT_OWNER", "INTENT_REGULATOR", "PROJECT_OWNER"]);
export const QUESTION_SELECTORS = Object.freeze(["ALL_QUESTIONS", "ROOTS", "EXPLICIT_OR_ALL"]);

const GENERAL_CLAUSES = Object.freeze({
  CONVERSATION: "GENERAL_CONVERSATION",
  DELIVERY_CLOSURE: "GENERAL_DELIVERY_CLOSURE",
  EVIDENCE_IDENTITY: "GENERAL_EVIDENCE_IDENTITY",
  FUNCTIONAL_ACCEPTANCE: "GENERAL_FUNCTIONAL_ACCEPTANCE",
  INTENT_SCOPE: "GENERAL_INTENT_SCOPE",
  PROGRESS_HEALTH: "GENERAL_PROGRESS_HEALTH",
  RECOVERY_BOUNDARIES: "GENERAL_RECOVERY_BOUNDARIES",
  RESPONSE_HANDOFF_GATING: "GENERAL_RESPONSE_HANDOFF_GATING",
  ROLE_ROUTING: "GENERAL_ROLE_ROUTING",
  SECURITY_PRIVACY: "GENERAL_SECURITY_PRIVACY",
  SOURCE_BINDING: "GENERAL_SOURCE_BINDING",
});

const ALL_ROOTS = Object.freeze(["DESIGN_BIBLE", "FUNCTION_REQUIREMENTS", "SECURITY"]);
const ACCEPTANCE_ROOTS = new Set(ALL_ROOTS);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const CANONICAL_ROLE_DEFINITION_SOURCE = deepFreeze({
  schema: ROLE_DEFINITION_SOURCE_SCHEMA,
  version: ROLE_DEFINITION_SOURCE_VERSION,
  source_kind: ROLE_DEFINITION_SOURCE_KIND,
  role_templates: [
    {
      template_id: "CAMPAIGN_ORCHESTRATOR",
      role_id: "CAMPAIGN_ORCHESTRATOR",
      public_name: "Campaign Orchestrator",
      role_scope: "CAMPAIGN",
      role_kind: "CAMPAIGN_ORCHESTRATOR",
      question_selector: "ALL_QUESTIONS",
      question_roots: [...ALL_ROOTS],
      shared_clause_ids: [
        GENERAL_CLAUSES.CONVERSATION,
        GENERAL_CLAUSES.DELIVERY_CLOSURE,
        GENERAL_CLAUSES.EVIDENCE_IDENTITY,
        GENERAL_CLAUSES.FUNCTIONAL_ACCEPTANCE,
        GENERAL_CLAUSES.INTENT_SCOPE,
        GENERAL_CLAUSES.PROGRESS_HEALTH,
        GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
        GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
        GENERAL_CLAUSES.ROLE_ROUTING,
        GENERAL_CLAUSES.SECURITY_PRIVACY,
        GENERAL_CLAUSES.SOURCE_BINDING,
      ].sort(),
    },
    {
      template_id: "INDEPENDENT_AUDITOR",
      role_id: "INDEPENDENT_AUDITOR",
      public_name: "Independent Auditor",
      role_scope: "CAMPAIGN",
      role_kind: "INDEPENDENT_AUDITOR",
      question_selector: "ALL_QUESTIONS",
      question_roots: [...ALL_ROOTS],
      shared_clause_ids: [
        GENERAL_CLAUSES.DELIVERY_CLOSURE,
        GENERAL_CLAUSES.EVIDENCE_IDENTITY,
        GENERAL_CLAUSES.FUNCTIONAL_ACCEPTANCE,
        GENERAL_CLAUSES.PROGRESS_HEALTH,
        GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
        GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
        GENERAL_CLAUSES.ROLE_ROUTING,
        GENERAL_CLAUSES.SECURITY_PRIVACY,
        GENERAL_CLAUSES.SOURCE_BINDING,
      ].sort(),
    },
    {
      template_id: "AGENTOS.MEMORY",
      role_id: "AGENTOS.MEMORY",
      public_name: "Memory",
      role_scope: "PERSISTENT",
      role_kind: "MEMORY",
      question_selector: "ROOTS",
      question_roots: ["SECURITY"],
      shared_clause_ids: [
        GENERAL_CLAUSES.DELIVERY_CLOSURE,
        GENERAL_CLAUSES.EVIDENCE_IDENTITY,
        GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
        GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
        GENERAL_CLAUSES.SECURITY_PRIVACY,
        GENERAL_CLAUSES.SOURCE_BINDING,
      ].sort(),
    },
    {
      template_id: "AGENTOS.ORCHESTRATOR",
      role_id: "AGENTOS.ORCHESTRATOR",
      public_name: "Orchestrator",
      role_scope: "PERSISTENT",
      role_kind: "ORCHESTRATOR",
      question_selector: "ALL_QUESTIONS",
      question_roots: [...ALL_ROOTS],
      shared_clause_ids: [
        GENERAL_CLAUSES.DELIVERY_CLOSURE,
        GENERAL_CLAUSES.EVIDENCE_IDENTITY,
        GENERAL_CLAUSES.FUNCTIONAL_ACCEPTANCE,
        GENERAL_CLAUSES.INTENT_SCOPE,
        GENERAL_CLAUSES.PROGRESS_HEALTH,
        GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
        GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
        GENERAL_CLAUSES.ROLE_ROUTING,
        GENERAL_CLAUSES.SECURITY_PRIVACY,
        GENERAL_CLAUSES.SOURCE_BINDING,
      ].sort(),
    },
    {
      template_id: "AGENTOS.PRODUCT_OWNER",
      role_id: "AGENTOS.PRODUCT_OWNER",
      public_name: "Product Owner",
      role_scope: "PERSISTENT",
      role_kind: "PRODUCT_OWNER",
      question_selector: "ALL_QUESTIONS",
      question_roots: [...ALL_ROOTS],
      shared_clause_ids: [
        GENERAL_CLAUSES.CONVERSATION,
        GENERAL_CLAUSES.DELIVERY_CLOSURE,
        GENERAL_CLAUSES.EVIDENCE_IDENTITY,
        GENERAL_CLAUSES.INTENT_SCOPE,
        GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
        GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
        GENERAL_CLAUSES.ROLE_ROUTING,
        GENERAL_CLAUSES.SOURCE_BINDING,
      ].sort(),
    },
    {
      template_id: "AGENTOS.RUNTIME",
      role_id: "AGENTOS.RUNTIME",
      public_name: "Runtime",
      role_scope: "PERSISTENT",
      role_kind: "RUNTIME",
      question_selector: "ROOTS",
      question_roots: ["SECURITY"],
      shared_clause_ids: [
        GENERAL_CLAUSES.DELIVERY_CLOSURE,
        GENERAL_CLAUSES.EVIDENCE_IDENTITY,
        GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
        GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
        GENERAL_CLAUSES.SECURITY_PRIVACY,
        GENERAL_CLAUSES.SOURCE_BINDING,
      ].sort(),
    },
    {
      template_id: "AGENTOS.SCHEDULER",
      role_id: "AGENTOS.SCHEDULER",
      public_name: "Scheduler",
      role_scope: "PERSISTENT",
      role_kind: "SCHEDULER",
      question_selector: "ALL_QUESTIONS",
      question_roots: [...ALL_ROOTS],
      shared_clause_ids: [
        GENERAL_CLAUSES.DELIVERY_CLOSURE,
        GENERAL_CLAUSES.EVIDENCE_IDENTITY,
        GENERAL_CLAUSES.PROGRESS_HEALTH,
        GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
        GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
        GENERAL_CLAUSES.ROLE_ROUTING,
        GENERAL_CLAUSES.SOURCE_BINDING,
      ].sort(),
    },
    {
      template_id: "AGENTOS_CONTROLLER",
      role_id: "AGENTOS_CONTROLLER",
      public_name: "Controller",
      role_scope: "PERSISTENT",
      role_kind: "CONTROLLER",
      question_selector: "ALL_QUESTIONS",
      question_roots: [...ALL_ROOTS],
      shared_clause_ids: [
        GENERAL_CLAUSES.DELIVERY_CLOSURE,
        GENERAL_CLAUSES.EVIDENCE_IDENTITY,
        GENERAL_CLAUSES.PROGRESS_HEALTH,
        GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
        GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
        GENERAL_CLAUSES.ROLE_ROUTING,
        GENERAL_CLAUSES.SOURCE_BINDING,
      ].sort(),
    },
  ].sort((left, right) => Buffer.from(left.role_id).compare(Buffer.from(right.role_id))),
  one_lane_worker_template: {
    template_id: "ONE_LANE_WORKER",
    role_id_prefix: "WORKER_",
    public_name_prefix: "One-Lane Worker: ",
    role_scope: "CAMPAIGN",
    role_kind: "ONE_LANE_WORKER",
    question_selector: "EXPLICIT_OR_ALL",
    question_roots: [...ALL_ROOTS],
    shared_clause_ids: [
      GENERAL_CLAUSES.DELIVERY_CLOSURE,
      GENERAL_CLAUSES.EVIDENCE_IDENTITY,
      GENERAL_CLAUSES.FUNCTIONAL_ACCEPTANCE,
      GENERAL_CLAUSES.INTENT_SCOPE,
      GENERAL_CLAUSES.PROGRESS_HEALTH,
      GENERAL_CLAUSES.RECOVERY_BOUNDARIES,
      GENERAL_CLAUSES.RESPONSE_HANDOFF_GATING,
      GENERAL_CLAUSES.SECURITY_PRIVACY,
      GENERAL_CLAUSES.SOURCE_BINDING,
    ].sort(),
  },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(/^[A-Z][A-Z0-9._:-]*$/u.test(value), `${label} is not a stable identifier`);
}

function sortedUniqueStrings(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must not be empty`);
  assert(value.every((item) => typeof item === "string" && item.length > 0), `${label} contains an invalid value`);
  const sorted = [...value].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  assert(new Set(value).size === value.length && JSON.stringify(value) === JSON.stringify(sorted), `${label} must be sorted and unique`);
}

const FORBIDDEN_PUBLIC_CONTENT = /(?:\/Users\/|\\Users\\|\/home\/|[A-Za-z]:\\Users\\|feature\s*agent|generic|shell|recursive|provider|credential|password|secret|api[_-]?key|account[_-]?identity|deployment[_-]?identity)/iu;

function assertPortable(value, label) {
  assert(!FORBIDDEN_PUBLIC_CONTENT.test(JSON.stringify(value)), `${label} contains private, secret, provider-bound, or generic role content`);
}

function validateTemplate(template, index, {worker = false} = {}) {
  const keys = worker
    ? ["template_id", "role_id_prefix", "public_name_prefix", "role_scope", "role_kind", "question_selector", "question_roots", "shared_clause_ids"]
    : ["template_id", "role_id", "public_name", "role_scope", "role_kind", "question_selector", "question_roots", "shared_clause_ids"];
  exactKeys(template, keys, `${worker ? "worker template" : "role template"} ${index}`);
  requireIdentifier(template.template_id, `${template.template_id ?? "role template"} template ID`);
  if (worker) {
    requireIdentifier(template.role_id_prefix, "worker role ID prefix");
    requireString(template.public_name_prefix, "worker public name prefix");
  } else {
    requireIdentifier(template.role_id, `role template ${index} ID`);
    requireString(template.public_name, `role template ${template.role_id} name`);
  }
  assert(ROLE_SCOPES.includes(template.role_scope), `${template.template_id} role scope is invalid`);
  assert(ROLE_KINDS.includes(template.role_kind), `${template.template_id} role kind is invalid`);
  assert(QUESTION_SELECTORS.includes(template.question_selector), `${template.template_id} question selector is invalid`);
  sortedUniqueStrings(template.question_roots, `${template.template_id} question roots`);
  assert(template.question_roots.every((root) => ACCEPTANCE_ROOTS.has(root)), `${template.template_id} question roots contain an unknown root`);
  sortedUniqueStrings(template.shared_clause_ids, `${template.template_id} shared clauses`);
  assertPortable(template, `${template.template_id} role definition`);
}

export function validateRoleDefinitionSource(source = CANONICAL_ROLE_DEFINITION_SOURCE) {
  exactKeys(source, ["schema", "version", "source_kind", "role_templates", "one_lane_worker_template"], "role definition source");
  assert(source.schema === ROLE_DEFINITION_SOURCE_SCHEMA && source.version === ROLE_DEFINITION_SOURCE_VERSION, "role definition source identity is invalid");
  assert(source.source_kind === ROLE_DEFINITION_SOURCE_KIND, "role definition source kind is invalid");
  assert(Array.isArray(source.role_templates) && source.role_templates.length === 8, "canonical role templates are incomplete");
  const ids = new Set();
  source.role_templates.forEach((template, index) => {
    validateTemplate(template, index);
    assert(!ids.has(template.role_id), `duplicate role template ${template.role_id}`);
    ids.add(template.role_id);
  });
  assert(JSON.stringify([...ids].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))) === JSON.stringify([...ids]), "role templates must be sorted by role ID");
  assert(JSON.stringify([...ids].sort()) === JSON.stringify([
    "AGENTOS.MEMORY", "AGENTOS.ORCHESTRATOR", "AGENTOS.PRODUCT_OWNER", "AGENTOS.RUNTIME", "AGENTOS.SCHEDULER", "AGENTOS_CONTROLLER",
    "CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR",
  ].sort()), "canonical role templates must contain the permanent registry and campaign roles");
  assert([...ids].every((id) => !RETIRED_CURRENT_ROLE_IDS.includes(id)), "retired role identity is not admissible in current definitions");
  validateTemplate(source.one_lane_worker_template, 0, {worker: true});
  assert(source.one_lane_worker_template.role_kind === "ONE_LANE_WORKER" && source.one_lane_worker_template.role_scope === "CAMPAIGN", "one-lane worker template scope is invalid");
  assertPortable(source, "role definition source");
  return source;
}

export function roleDefinitionSourceDigest(source = CANONICAL_ROLE_DEFINITION_SOURCE) {
  validateRoleDefinitionSource(source);
  return sha256(source);
}

export const ROLE_DEFINITION_SOURCE_SHA256 = roleDefinitionSourceDigest();

export function defaultRoleDefinitionSource() {
  return structuredClone(CANONICAL_ROLE_DEFINITION_SOURCE);
}
