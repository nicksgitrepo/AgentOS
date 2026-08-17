#!/usr/bin/env node

/*
 * Project-agnostic Controller startup successor compiler.
 *
 * Bootstrap, Controller, and Spawner handoffs are a single local sequence:
 * every completed stage emits the next registered action in the same turn.
 * A protected wait is legal only when the caller supplies a typed true
 * blocker; a missing worker, empty queue, stale receipt, or timer is never a
 * reason to park startup.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  CONTROLLER_ACTION_AUTHORITY,
  controllerActionHandlerFor,
  controllerContinuationDigest,
  compileControllerContinuation,
  deriveControllerSuccessor,
} from "./controller-action-dispatcher.mjs";

export const CONTROLLER_STARTUP_SEQUENCE_SCHEMA = "agentos.controller_startup_sequence.v1";
export const CONTROLLER_STARTUP_SEQUENCE_VERSION = 1;
export const CONTROLLER_STARTUP_STAGES = Object.freeze([
  "SEALED_BOOTSTRAP_ACCEPTED",
  "SPAWNER_ADMITTED",
  "PERMANENT_ROLES_IN_PROGRESS",
  "PERMANENT_ROLES_READY",
  "ORCHESTRATOR_GOVERNANCE_READY",
  "SPAWNER_COMPILER_ACTIVE",
  "SPAWNER_ROSTER_PUBLISHED",
  "GOVERNED_SPAWN_ADMITTED",
  "GOVERNED_SPAWN_ACTIVE",
  "IMPORT_ORCHESTRATOR_ACTIVE",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const PROTECTED_BLOCKER_CLASSES = new Set([
  "CREDENTIAL_OR_AUTHENTICATION",
  "IRREVERSIBLE_DESTRUCTIVE_USER_WORK",
  "MAJOR_PRODUCT_OR_PRODUCTION_DECISION",
  "MATERIAL_SPEND_OR_FINANCIAL_AUTHORITY",
  "PROTECTED_EXTERNAL_DEPENDENCY",
]);
const ROUTE_FACT_KEYS = Object.freeze([
  "next_role_id",
  "incomplete_block_count",
  "pending_route_count",
  "isolated_local_custody",
  "independent_clearance_status",
]);
const STARTUP_KEYS = Object.freeze([
  "schema", "version", "sequence_id", "stage", "state_sha256", "route_facts", "next_action", "next_handler",
  "continuation", "continuation_sha256", "evidence_refs", "hostile_fixture_refs", "true_blocker", "protected_event",
  "authority", "sequence_sha256",
]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireIdentifier(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}
function requireBoolean(value, label) { assert(typeof value === "boolean", `${label} must be boolean`); }
function requireCount(value, label) { assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`); }
function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && IDENTIFIER.test(value)), `${label} contains an invalid identifier`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}
function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Controller startup evidence refs are required");
  const ids = [];
  for (const ref of refs) {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], "Controller startup evidence ref");
    requireIdentifier(ref.evidence_id, "Controller startup evidence id");
    assert(typeof ref.reference === "string" && REFERENCE.test(ref.reference), "Controller startup evidence reference is invalid");
    requireSha(ref.sha256, "Controller startup evidence digest");
    ids.push(ref.evidence_id);
  }
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Controller startup evidence refs must be sorted and unique");
}
function validateRouteFacts(routeFacts) {
  exactKeys(routeFacts, ROUTE_FACT_KEYS, "Controller startup route facts");
  requireIdentifier(routeFacts.next_role_id, "Controller startup next role", {nullable: true});
  requireCount(routeFacts.incomplete_block_count, "Controller startup incomplete block count");
  requireCount(routeFacts.pending_route_count, "Controller startup pending route count");
  requireBoolean(routeFacts.isolated_local_custody, "Controller startup isolated local custody");
  assert(["PENDING_EXTERNAL_AUTHORITY", "CLEARED"].includes(routeFacts.independent_clearance_status), "Controller startup clearance status is invalid");
}
function validateAuthority(authority) {
  exactKeys(authority, ["compiler_only", "admission", "activation", "product_mutation", "provider_access", "credential_access", "spend", "destructive_work"], "Controller startup authority");
  assert(JSON.stringify(authority) === JSON.stringify(CONTROLLER_ACTION_AUTHORITY), "Controller startup authority is weakened");
}
function validateProtectedEvent(event) {
  exactKeys(event, ["blocker_id", "blocker_class", "evidence_ceiling", "restart_event", "resources"], "Controller startup protected event");
  requireIdentifier(event.blocker_id, "Controller startup blocker");
  assert(PROTECTED_BLOCKER_CLASSES.has(event.blocker_class), "Controller startup blocker class is invalid");
  assert(typeof event.evidence_ceiling === "string" && event.evidence_ceiling.trim().length >= 24, "Controller startup evidence ceiling is incomplete");
  assert(typeof event.restart_event === "string" && event.restart_event.trim().length >= 8, "Controller startup restart event is incomplete");
  exactKeys(event.resources, ["jobs", "workers", "heavyweight_processes", "timers"], "Controller startup protected resources");
  for (const key of ["jobs", "workers", "heavyweight_processes", "timers"]) assert(event.resources[key] === 0, `Controller startup protected resource ${key} must be zero`);
}
function body(sequence) { const copy = structuredClone(sequence); copy.sequence_sha256 = null; return copy; }

function safeGovernedSpawnRoute(routeFacts) {
  return routeFacts.isolated_local_custody || routeFacts.independent_clearance_status === "CLEARED";
}

function deriveStartupRoute({stage, routeFacts, protectedEvent = null} = {}) {
  const local = (nextAction) => deriveControllerSuccessor({localActions: [nextAction]});
  switch (stage) {
    case "SEALED_BOOTSTRAP_ACCEPTED": return local("ADMIT_TYPED_AGENT_SPAWNER");
    case "SPAWNER_ADMITTED": return local("CONSTRUCT_PERMANENT_ROLES_ONE_AT_A_TIME");
    case "PERMANENT_ROLES_IN_PROGRESS":
      assert(routeFacts.next_role_id !== null, "Permanent-role startup stage requires a next role");
      return local("ADMIT_NEXT_PERMANENT_ROLE");
    case "PERMANENT_ROLES_READY": return local("INJECT_ORCHESTRATOR_GOVERNANCE");
    case "ORCHESTRATOR_GOVERNANCE_READY": return local("START_COMPILER");
    case "SPAWNER_COMPILER_ACTIVE":
      if (routeFacts.incomplete_block_count > 0) return local("COMPILE_NEXT_BLOCK");
      if (routeFacts.pending_route_count > 0) return local("PUBLISH_TYPED_ROSTER");
      // Compiler-only QA/import planning is bounded local work.  It must
      // hand off to the governed adapter even before clearance/custody is
      // materialized; the adapter/readback is the boundary that decides
      // whether isolated local custody is safe.  A compiler cannot park on
      // the later activation dependency.
      return local("ADMIT_GOVERNED_SPAWN");
    case "SPAWNER_ROSTER_PUBLISHED":
      return local("ADMIT_GOVERNED_SPAWN");
    case "GOVERNED_SPAWN_ADMITTED":
      if (safeGovernedSpawnRoute(routeFacts)) return local("START_GOVERNED_SPAWN");
      assert(protectedEvent !== null, "Governed spawn cannot activate without a typed true blocker");
      return deriveControllerSuccessor({protectedEvent, protectedActionId: "WAIT_FOR_INDEPENDENT_CLEARANCE"});
    case "GOVERNED_SPAWN_ACTIVE":
      assert(safeGovernedSpawnRoute(routeFacts), "Active governed spawn requires clearance or isolated local custody");
      return local("START_IMPORT_ORCHESTRATOR");
    case "IMPORT_ORCHESTRATOR_ACTIVE": return local("REQUEST_SPAWNER_QA");
    default: throw new Error(`Unsupported Controller startup stage: ${stage}`);
  }
}

export function compileControllerStartupSuccessor({
  sequenceId,
  stage,
  stateSha256,
  routeFacts,
  evidenceRefs,
  hostileFixtureRefs,
  protectedEvent = null,
} = {}) {
  requireIdentifier(sequenceId, "Controller startup sequence id");
  assert(CONTROLLER_STARTUP_STAGES.includes(stage), "Controller startup stage is invalid");
  requireSha(stateSha256, "Controller startup state digest");
  validateRouteFacts(routeFacts);
  validateEvidenceRefs(evidenceRefs);
  sortedUnique(hostileFixtureRefs, "Controller startup hostile fixture refs");
  if (protectedEvent !== null) validateProtectedEvent(protectedEvent);
  const route = deriveStartupRoute({stage, routeFacts, protectedEvent});
  assert(protectedEvent === null || route.protected_event !== null, "A typed protected event cannot mask an eligible startup successor");
  const sequence = {
    schema: CONTROLLER_STARTUP_SEQUENCE_SCHEMA,
    version: CONTROLLER_STARTUP_SEQUENCE_VERSION,
    sequence_id: sequenceId,
    stage,
    state_sha256: stateSha256,
    route_facts: structuredClone(routeFacts),
    next_action: route.next_action,
    next_handler: route.next_handler,
    continuation: route.continuation,
    continuation_sha256: route.continuation_sha256,
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    true_blocker: route.protected_event !== null,
    protected_event: structuredClone(route.protected_event),
    authority: structuredClone(CONTROLLER_ACTION_AUTHORITY),
    sequence_sha256: null,
  };
  sequence.sequence_sha256 = canonicalDigest(body(sequence));
  return validateControllerStartupSuccessor(sequence);
}

export function validateControllerStartupSuccessor(sequence) {
  exactKeys(sequence, STARTUP_KEYS, "Controller startup successor");
  assert(sequence.schema === CONTROLLER_STARTUP_SEQUENCE_SCHEMA && sequence.version === CONTROLLER_STARTUP_SEQUENCE_VERSION, "Controller startup successor identity is invalid");
  requireIdentifier(sequence.sequence_id, "Controller startup sequence id");
  assert(CONTROLLER_STARTUP_STAGES.includes(sequence.stage), "Controller startup stage is invalid");
  requireSha(sequence.state_sha256, "Controller startup state digest");
  validateRouteFacts(sequence.route_facts);
  validateEvidenceRefs(sequence.evidence_refs);
  sortedUnique(sequence.hostile_fixture_refs, "Controller startup hostile fixture refs");
  requireIdentifier(sequence.next_action, "Controller startup next action");
  assert(sequence.next_handler === controllerActionHandlerFor(sequence.next_action), "Controller startup next handler is stale");
  assert(sequence.continuation_sha256 === controllerContinuationDigest(sequence.continuation), "Controller startup continuation digest is stale");
  const expectedContinuation = compileControllerContinuation(sequence.next_action, {protectedEventId: sequence.protected_event?.blocker_id ?? null});
  assert(sequence.continuation_sha256 === controllerContinuationDigest(expectedContinuation), "Controller startup continuation is invalid");
  requireBoolean(sequence.true_blocker, "Controller startup true blocker");
  if (sequence.protected_event !== null) validateProtectedEvent(sequence.protected_event);
  assert(sequence.true_blocker === (sequence.protected_event !== null), "Controller startup true-blocker flag is inconsistent");
  validateAuthority(sequence.authority);
  const expected = deriveStartupRoute({stage: sequence.stage, routeFacts: sequence.route_facts, protectedEvent: sequence.protected_event});
  assert(sequence.next_action === expected.next_action && sequence.next_handler === expected.next_handler, "Controller startup successor is not derived from the current stage");
  assert(sequence.continuation_sha256 === expected.continuation_sha256, "Controller startup continuation is not derived from the current stage");
  assert(sequence.true_blocker === (expected.protected_event !== null), "Controller startup protected route is not derived from a true blocker");
  assert(sequence.sequence_sha256 === canonicalDigest(body(sequence)), "Controller startup successor digest mismatch");
  return sequence;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Controller startup sequence contract loaded\n");
