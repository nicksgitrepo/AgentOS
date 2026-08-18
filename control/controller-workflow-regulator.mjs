#!/usr/bin/env node

/*
 * Project-agnostic Controller role boundary.
 *
 * Controller regulates workflow health.  Product Owner owns user intent and
 * ordinary human conversation.  Spawner owns every ordinary agent lifecycle
 * action.  This small contract is deliberately separate from the legacy
 * Intent Regulator runtime so a name-compatible export cannot become a
 * second Controller authority.
 */

import {canonicalDigest} from "./content-addressing.mjs";
import {loadCanonicalControllerOperationRegistry} from "./controller-event-authority.mjs";
import {CONTROLLER_FORBIDDEN_OPERATIONS, assertControllerOperationAuthorized} from "./spawner-bootstrap-governance.mjs";

export const CONTROLLER_WORKFLOW_REGULATOR_SCHEMA = "agentos.controller_workflow_regulator.v1";
export const CONTROLLER_WORKFLOW_REGULATOR_VERSION = 1;
export const CONTROLLER_ROLE_ID = "AGENTOS_CONTROLLER";
export const PRODUCT_OWNER_ROLE_ID = "AGENTOS.PRODUCT_OWNER";
export const CONTROLLER_PROGRESS_INTERVAL_MINUTES = 15;

const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const FORBIDDEN_ROLE_ACTIONS = Object.freeze([
  "ADMIT_AGENT",
  "ARCHIVE_AGENT",
  "COMPILE_ROLE_BLOCK",
  "DESPAWN_AGENT",
  "MUTATE_GOVERNANCE_MEMORY",
  "MUTATE_ROSTER",
  "SPAWN_AGENT",
  "SPAWN_SEED",
  "SPAWN_WORKER",
]);

function assert(condition, message, code = "CONTROLLER_WORKFLOW_REGULATOR_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function exactKeys(value, expected, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} is invalid`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`);
}

function digestWithout(value, field) {
  return canonicalDigest({...structuredClone(value), [field]: null});
}

function canonicalOperations() {
  const registry = loadCanonicalControllerOperationRegistry();
  return registry.operations.map(({event_type}) => event_type).sort();
}

export function validateControllerWorkflowRegulator(contract) {
  exactKeys(contract, [
    "schema", "version", "role_id", "role_kind", "public_name", "human_facing",
    "intent_owner_role_id", "workflow_scope", "progress_interval_minutes",
    "allowed_event_types", "forbidden_role_actions", "forbidden_controller_operations",
    "monitor_rule", "activation_state", "contract_sha256",
  ], "Controller workflow regulator contract");
  assert(contract.schema === CONTROLLER_WORKFLOW_REGULATOR_SCHEMA && contract.version === CONTROLLER_WORKFLOW_REGULATOR_VERSION, "Controller workflow regulator identity is invalid");
  assert(contract.role_id === CONTROLLER_ROLE_ID && contract.role_kind === "CONTROLLER", "Controller workflow regulator role is invalid");
  assert(contract.public_name === "Controller", "Controller workflow regulator public name is invalid");
  assert(contract.human_facing === false, "Controller cannot own human-facing conversation");
  assert(contract.intent_owner_role_id === PRODUCT_OWNER_ROLE_ID, "Controller intent owner must be Product Owner");
  assert(contract.workflow_scope === "WORKFLOW_REGULATION_ONLY", "Controller workflow scope is too broad");
  assert(contract.progress_interval_minutes === CONTROLLER_PROGRESS_INTERVAL_MINUTES, "Controller progress interval must be 15 minutes");
  const expectedEvents = canonicalOperations();
  assert(JSON.stringify(contract.allowed_event_types) === JSON.stringify(expectedEvents), "Controller event authority differs from the canonical operation registry");
  assert(JSON.stringify(contract.forbidden_role_actions) === JSON.stringify([...FORBIDDEN_ROLE_ACTIONS]), "Controller forbidden lifecycle authority is incomplete");
  assert(JSON.stringify(contract.forbidden_controller_operations) === JSON.stringify([...CONTROLLER_FORBIDDEN_OPERATIONS].sort()), "Controller forbidden operations differ from Spawner governance");
  assert(typeof contract.monitor_rule === "string" && contract.monitor_rule.length >= 24, "Controller monitor rule is incomplete");
  assert(contract.activation_state === "OFF", "Controller workflow regulator must remain inactive until governed admission");
  requireSha(contract.contract_sha256, "Controller workflow regulator contract digest");
  assert(contract.contract_sha256 === digestWithout(contract, "contract_sha256"), "Controller workflow regulator contract digest mismatch");
  return contract;
}

export function compileControllerWorkflowRegulatorContract() {
  const contract = {
    schema: CONTROLLER_WORKFLOW_REGULATOR_SCHEMA,
    version: CONTROLLER_WORKFLOW_REGULATOR_VERSION,
    role_id: CONTROLLER_ROLE_ID,
    role_kind: "CONTROLLER",
    public_name: "Controller",
    human_facing: false,
    intent_owner_role_id: PRODUCT_OWNER_ROLE_ID,
    workflow_scope: "WORKFLOW_REGULATION_ONLY",
    progress_interval_minutes: CONTROLLER_PROGRESS_INTERVAL_MINUTES,
    allowed_event_types: canonicalOperations(),
    forbidden_role_actions: [...FORBIDDEN_ROLE_ACTIONS],
    forbidden_controller_operations: [...CONTROLLER_FORBIDDEN_OPERATIONS].sort(),
    monitor_rule: "Every 15 minutes, verify useful work is moving; reject false stalls, repair workflow routing, and escalate only a proven protected blocker.",
    activation_state: "OFF",
    contract_sha256: null,
  };
  contract.contract_sha256 = digestWithout(contract, "contract_sha256");
  return Object.freeze(validateControllerWorkflowRegulator(contract));
}

export function assertControllerWorkflowOperation(operation) {
  assert(typeof operation === "string", "Controller operation is invalid");
  assertControllerOperationAuthorized(operation);
  return operation;
}

export function compileControllerProgressTick({minutesSinceUsefulProgress, activeWorkInProgress, claimedBlocker, protectedBlockerProven} = {}) {
  assert(Number.isFinite(minutesSinceUsefulProgress) && minutesSinceUsefulProgress >= 0, "Controller progress age is invalid");
  assert(typeof activeWorkInProgress === "boolean" && typeof claimedBlocker === "boolean" && typeof protectedBlockerProven === "boolean", "Controller progress evidence is incomplete");
  if (claimedBlocker && protectedBlockerProven) return Object.freeze({authority_status: "NON_AUTHORITATIVE_TEMPLATE", status: "TRUE_BLOCKER", next_action: "PRODUCT_OWNER_EXPLAIN_BLOCKER_TO_USER", timer_minutes: CONTROLLER_PROGRESS_INTERVAL_MINUTES});
  if (minutesSinceUsefulProgress >= CONTROLLER_PROGRESS_INTERVAL_MINUTES) return Object.freeze({authority_status: "NON_AUTHORITATIVE_TEMPLATE", status: "FALSE_STALL_REJECTED", next_action: "CONTROLLER_REPAIR_WORKFLOW_AND_START_USEFUL_SUCCESSOR", timer_minutes: CONTROLLER_PROGRESS_INTERVAL_MINUTES});
  return Object.freeze({authority_status: "NON_AUTHORITATIVE_TEMPLATE", status: "MOVING", next_action: "CONTINUE_USEFUL_WORK", timer_minutes: CONTROLLER_PROGRESS_INTERVAL_MINUTES});
}

export function compileControllerWorkflowMonitorTick({minutesSinceUsefulProgress, activeWorkInProgress, claimedBlocker, protectedBlockerProven} = {}) {
  const tick = compileControllerProgressTick({minutesSinceUsefulProgress, activeWorkInProgress, claimedBlocker, protectedBlockerProven});
  return Object.freeze({
    ...tick,
    role_id: CONTROLLER_ROLE_ID,
    intent_owner_role_id: PRODUCT_OWNER_ROLE_ID,
    timer_minutes: CONTROLLER_PROGRESS_INTERVAL_MINUTES,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Controller workflow regulator contract loaded\n");
