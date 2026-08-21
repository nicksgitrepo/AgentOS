/*
 * Project-agnostic blocker decision tree.
 *
 * A missing optional capability or an evidence limit blocks only the affected
 * lane.  Only a true protected boundary can stop the whole workflow.  The
 * returned receipt always names the next safe action so an orchestrator cannot
 * close a turn by silently waiting.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const AUTONOMOUS_BLOCKER_ROUTING_SCHEMA = "agentos.autonomous_blocker_route.v1";
export const AUTONOMOUS_BLOCKER_ROUTING_VERSION = 1;
export const AUTONOMOUS_BLOCKER_CLASSES = Object.freeze([
  "CAPABILITY_GAP",
  "EVIDENCE_CEILING",
  "NONE",
  "REPAIRABLE_FAILURE",
  "TRUE_BLOCKER",
]);
export const AUTONOMOUS_GLOBAL_STATES = Object.freeze(["RUNNING", "STOPPED"]);
export const AUTONOMOUS_LANE_STATES = Object.freeze([
  "READY",
  "REPAIRING",
  "UNPROVEN",
  "WAITING_FOR_CAPABILITY",
  "BLOCKED_GLOBAL",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireText(value, label, minimum = 1) {
  assert(typeof value === "string" && value.trim().length >= minimum && !/[\u0000-\u001f\u007f]/u.test(value), `${label} is incomplete`);
}

function sortedUnique(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  const ordered = values.map((value) => {
    requireIdentifier(value, `${label} item`);
    return value;
  }).sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return values;
}

function validateFacts(facts) {
  exactKeys(facts, [
    "material_spend", "credential_or_human_auth", "irreversible_destructive_action", "owner_only_major_decision",
    "governance_or_workflow_failure", "optional_capability_missing", "evidence_unavailable", "lane_has_safe_successor",
  ], "blocker facts");
  for (const key of Object.keys(facts)) assert(typeof facts[key] === "boolean", `blocker fact ${key} must be boolean`);
  return facts;
}

/** Derive class from observed facts; callers cannot promote a soft issue to a global stop. */
export function classifyAutonomousBlocker({
  materialSpend,
  credentialOrHumanAuth,
  irreversibleDestructiveAction,
  ownerOnlyMajorDecision,
  governanceOrWorkflowFailure,
  optionalCapabilityMissing,
  evidenceUnavailable,
  laneHasSafeSuccessor,
  material_spend,
  credential_or_human_auth,
  irreversible_destructive_action,
  owner_only_major_decision,
  governance_or_workflow_failure,
  optional_capability_missing,
  evidence_unavailable,
  lane_has_safe_successor,
} = {}) {
  const facts = {
    material_spend: materialSpend ?? material_spend ?? false,
    credential_or_human_auth: credentialOrHumanAuth ?? credential_or_human_auth ?? false,
    irreversible_destructive_action: irreversibleDestructiveAction ?? irreversible_destructive_action ?? false,
    owner_only_major_decision: ownerOnlyMajorDecision ?? owner_only_major_decision ?? false,
    governance_or_workflow_failure: governanceOrWorkflowFailure ?? governance_or_workflow_failure ?? false,
    optional_capability_missing: optionalCapabilityMissing ?? optional_capability_missing ?? false,
    evidence_unavailable: evidenceUnavailable ?? evidence_unavailable ?? false,
    lane_has_safe_successor: laneHasSafeSuccessor ?? lane_has_safe_successor ?? false,
  };
  validateFacts(facts);
  if (facts.material_spend || facts.credential_or_human_auth || facts.irreversible_destructive_action || facts.owner_only_major_decision) return "TRUE_BLOCKER";
  if (facts.governance_or_workflow_failure) return "REPAIRABLE_FAILURE";
  if (facts.optional_capability_missing) return "CAPABILITY_GAP";
  if (facts.evidence_unavailable) return "EVIDENCE_CEILING";
  return "NONE";
}

function routeBody(route) {
  const body = structuredClone(route);
  body.route_sha256 = null;
  return body;
}

function validateResources(resources) {
  exactKeys(resources, ["workers", "scheduler_jobs", "heavyweight_processes", "timers"], "blocker resources");
  for (const [key, value] of Object.entries(resources)) assert(Number.isSafeInteger(value) && value >= 0, `blocker resource ${key} is invalid`);
  return resources;
}

function validateSuccessor(successor, {required}) {
  if (successor === null) {
    assert(!required, "a non-terminal blocker route must start a same-turn successor");
    return null;
  }
  exactKeys(successor, ["action", "handler", "reference", "started_same_turn"], "blocker successor");
  requireIdentifier(successor.action, "blocker successor action");
  requireIdentifier(successor.handler, "blocker successor handler");
  assert(typeof successor.reference === "string" && REFERENCE.test(successor.reference), "blocker successor reference is invalid");
  assert(successor.started_same_turn === true, "blocker successor must start in the same turn");
  return successor;
}

export function validateAutonomousBlockerRoute(route) {
  exactKeys(route, [
    "schema", "version", "route_id", "lane_id", "blocker_class", "global_state", "lane_state", "dependency_id",
    "reason", "evidence_ceiling", "safe_alternatives", "successor", "remote", "resources", "owner_decision_required", "route_sha256",
  ], "autonomous blocker route");
  assert(route.schema === AUTONOMOUS_BLOCKER_ROUTING_SCHEMA && route.version === AUTONOMOUS_BLOCKER_ROUTING_VERSION, "autonomous blocker route identity is invalid");
  requireIdentifier(route.route_id, "autonomous blocker route ID");
  requireIdentifier(route.lane_id, "autonomous blocker lane ID");
  assert(AUTONOMOUS_BLOCKER_CLASSES.includes(route.blocker_class), "autonomous blocker class is invalid");
  assert(AUTONOMOUS_GLOBAL_STATES.includes(route.global_state), "autonomous global state is invalid");
  assert(AUTONOMOUS_LANE_STATES.includes(route.lane_state), "autonomous lane state is invalid");
  if (route.dependency_id !== null) requireIdentifier(route.dependency_id, "autonomous dependency ID");
  requireText(route.reason, "autonomous blocker reason", 8);
  requireText(route.evidence_ceiling, "autonomous evidence ceiling", 8);
  sortedUnique(route.safe_alternatives, "autonomous safe alternatives");
  validateSuccessor(route.successor, {required: route.blocker_class !== "TRUE_BLOCKER"});
  exactKeys(route.remote, ["required", "available", "optional", "local_candidate_ready", "push_deferred", "route"], "autonomous remote facts");
  for (const key of ["required", "available", "optional", "local_candidate_ready", "push_deferred"]) assert(typeof route.remote[key] === "boolean", `autonomous remote fact ${key} is invalid`);
  assert(["NOT_APPLICABLE", "REMOTE_AVAILABLE", "REMOTE_PUSH_DEFERRED"].includes(route.remote.route), "autonomous remote route is invalid");
  validateResources(route.resources);
  assert(typeof route.owner_decision_required === "boolean", "autonomous owner-decision flag is invalid");
  if (route.blocker_class === "TRUE_BLOCKER") {
    assert(route.global_state === "STOPPED" && route.lane_state === "BLOCKED_GLOBAL", "true blocker must stop globally");
    assert(route.owner_decision_required === true, "true blocker must identify the owner decision");
    assert(route.successor === null, "true blocker cannot claim a same-turn successor");
  } else {
    assert(route.global_state === "RUNNING", "capability, evidence, repair, and clear routes must keep global work running");
    assert(route.owner_decision_required === false, "non-protected route cannot request owner approval");
    assert(route.successor !== null, "non-protected route must dispatch a same-turn successor");
  }
  if (route.blocker_class === "CAPABILITY_GAP") assert(route.lane_state === "WAITING_FOR_CAPABILITY", "capability gap must be lane-scoped");
  if (route.blocker_class === "EVIDENCE_CEILING") assert(route.lane_state === "UNPROVEN", "evidence ceiling must remain unproven, not stopped");
  if (route.blocker_class === "REPAIRABLE_FAILURE") assert(route.lane_state === "REPAIRING", "repairable failure must enter repair");
  if (route.blocker_class === "NONE") assert(route.lane_state === "READY", "clear route must be ready");
  if (!route.remote.available && route.remote.optional) {
    assert(route.blocker_class === "CAPABILITY_GAP", "optional remote absence must be a capability gap");
    assert(route.remote.local_candidate_ready === true && route.remote.push_deferred === true && route.remote.route === "REMOTE_PUSH_DEFERRED", "optional remote absence must preserve a local candidate");
  }
  requireSha(route.route_sha256, "autonomous blocker route digest");
  assert(route.route_sha256 === canonicalDigest(routeBody(route)), "autonomous blocker route digest mismatch");
  return route;
}

export function compileAutonomousBlockerRoute({
  routeId,
  laneId,
  facts,
  reason,
  evidenceCeiling,
  dependencyId = null,
  safeAlternatives,
  successor,
  remote = {required: false, available: true, optional: false},
  resources = {workers: 0, scheduler_jobs: 0, heavyweight_processes: 0, timers: 0},
} = {}) {
  validateFacts(facts);
  requireIdentifier(routeId, "autonomous blocker route ID");
  requireIdentifier(laneId, "autonomous blocker lane ID");
  const blockerClass = classifyAutonomousBlocker({
    materialSpend: facts.material_spend,
    credentialOrHumanAuth: facts.credential_or_human_auth,
    irreversibleDestructiveAction: facts.irreversible_destructive_action,
    ownerOnlyMajorDecision: facts.owner_only_major_decision,
    governanceOrWorkflowFailure: facts.governance_or_workflow_failure,
    optionalCapabilityMissing: facts.optional_capability_missing,
    evidenceUnavailable: facts.evidence_unavailable,
    laneHasSafeSuccessor: facts.lane_has_safe_successor,
  });
  const effectiveRemote = {
    required: remote.required === true,
    available: remote.available !== false,
    optional: remote.optional === true,
    local_candidate_ready: remote.available === false && remote.optional === true,
    push_deferred: remote.available === false && remote.optional === true,
    route: remote.available === false && remote.optional === true ? "REMOTE_PUSH_DEFERRED" : remote.required ? "REMOTE_AVAILABLE" : "NOT_APPLICABLE",
  };
  const laneState = blockerClass === "TRUE_BLOCKER" ? "BLOCKED_GLOBAL"
    : blockerClass === "CAPABILITY_GAP" ? "WAITING_FOR_CAPABILITY"
      : blockerClass === "EVIDENCE_CEILING" ? "UNPROVEN"
        : blockerClass === "REPAIRABLE_FAILURE" ? "REPAIRING" : "READY";
  const route = {
    schema: AUTONOMOUS_BLOCKER_ROUTING_SCHEMA,
    version: AUTONOMOUS_BLOCKER_ROUTING_VERSION,
    route_id: routeId,
    lane_id: laneId,
    blocker_class: blockerClass,
    global_state: blockerClass === "TRUE_BLOCKER" ? "STOPPED" : "RUNNING",
    lane_state: laneState,
    dependency_id: dependencyId,
    reason,
    evidence_ceiling: evidenceCeiling,
    safe_alternatives: [...safeAlternatives].sort(compareUtf8),
    successor: blockerClass === "TRUE_BLOCKER" ? null : structuredClone(successor),
    remote: effectiveRemote,
    resources: structuredClone(resources),
    owner_decision_required: blockerClass === "TRUE_BLOCKER",
    route_sha256: null,
  };
  route.route_sha256 = canonicalDigest(routeBody(route));
  return validateAutonomousBlockerRoute(route);
}

/**
 * Deterministic closeout gate.  It rejects a turn that has neither a successor
 * nor a real protected boundary, including an empty queue with no resource use.
 */
export function assertAutonomousTurnCloseout({route, eligibleSuccessor = null, trueBlocker = false} = {}) {
  validateAutonomousBlockerRoute(route);
  if (route.blocker_class === "TRUE_BLOCKER") {
    assert(trueBlocker === true, "global stop requires an independently observed true blocker");
    assert(eligibleSuccessor === null, "a true blocker cannot also claim a successor");
    return route;
  }
  assert(route.successor !== null, "safe work cannot close without a started successor");
  if (eligibleSuccessor !== null) validateSuccessor(eligibleSuccessor, {required: true});
  return route;
}
