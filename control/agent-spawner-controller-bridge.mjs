#!/usr/bin/env node

/*
 * Project-agnostic bridge from a validated Agent Spawner handoff to the
 * Controller's closed successor registry.  The Spawner is allowed to invent
 * a governance route name while compiling a defect; the Controller is not
 * allowed to execute that name until this bridge maps it to a registered
 * action, handler, and continuation.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {validateAgentSpawnerDefectIntake} from "./agent-spawner-defect-intake.mjs";
import {
  CONTROLLER_ACTION_REGISTRY,
  compileControllerActionReceipt,
  controllerActionHandlerFor,
  validateControllerActionReceipt,
} from "./controller-action-dispatcher.mjs";

export const AGENT_SPAWNER_CONTROLLER_BRIDGE_SCHEMA = "agentos.agent_spawner_controller_bridge.v1";
export const AGENT_SPAWNER_CONTROLLER_BRIDGE_VERSION = 1;

export const SPAWNER_ROUTE_TO_CONTROLLER_ACTION = Object.freeze({
  // A compiled block patch is a campaign repair, not an unbound Controller
  // implementation detail.  Route it to the Orchestrator's callable repair
  // handler so an accepted Spawner handoff cannot land on a registry-only
  // HANDLER.CONTROLLER_LOCAL_BLOCK_REPAIR and stall the workflow.
  COMPILE_BLOCK_PATCH: "REPAIR_BLOCKS",
  REPAIR_ORCHESTRATOR_ROUTE: "START_NEXT_AVAILABLE_CONTROLLER_TRANSITION",
  REBUILD_DEPENDENT_ROSTER: "START_NEXT_AVAILABLE_CONTROLLER_TRANSITION",
  REJECT_DUPLICATE: "START_NEXT_AVAILABLE_CONTROLLER_TRANSITION",
  ESCALATE_PROTECTED: "WAIT_FOR_PROTECTED_EVENT",
});

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const LOCAL_ROUTES = new Set(["COMPILE_BLOCK_PATCH", "REPAIR_ORCHESTRATOR_ROUTE", "REBUILD_DEPENDENT_ROSTER", "REJECT_DUPLICATE"]);
const BRIDGE_KEYS = Object.freeze([
  "schema", "version", "bridge_id", "defect_id", "source_handoff_sha256", "source_controller_receipt_sha256",
  "source_route", "mapped_action", "mapped_handler", "controller_action_receipt", "roster_invalidation",
  "dispatch", "readback_sha256", "bridge_sha256",
]);
const DISPATCH_KEYS = Object.freeze(["mode", "same_turn_dispatch", "status"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label, {allowNull = false} = {}) {
  if (allowNull && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque or reference URI`);
}

function sortedUniqueIdentifiers(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} are required`);
  values.forEach((value, index) => requireIdentifier(value, `${label} item ${index}`));
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function validateEvidenceRefs(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} are required`);
  const ids = [];
  values.forEach((entry, index) => {
    exactKeys(entry, ["evidence_id", "reference", "sha256"], `${label} entry ${index}`);
    requireIdentifier(entry.evidence_id, `${label} entry ${index} ID`);
    requireReference(entry.reference, `${label} entry ${index} reference`);
    requireSha(entry.sha256, `${label} entry ${index} digest`);
    ids.push(entry.evidence_id);
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function bridgeBody(value) {
  const copy = structuredClone(value);
  copy.bridge_sha256 = null;
  return copy;
}

function readbackBody(value) {
  const copy = structuredClone(value);
  copy.readback_sha256 = null;
  copy.bridge_sha256 = null;
  return copy;
}

function routeStatusIsValid(intake) {
  if (intake.route === "ESCALATE_PROTECTED") return intake.status === "PENDING_PROTECTED_DECISION";
  if (intake.route === "REJECT_DUPLICATE") return intake.status === "REJECTED_DUPLICATE";
  return intake.status === "ACCEPTED_FOR_CONTROLLER_CUSTODY";
}

function expectedDispatch(route) {
  return route === "ESCALATE_PROTECTED"
    ? {mode: "PROTECTED_WAIT", same_turn_dispatch: false, status: "PROTECTED_WAIT"}
    : {mode: "LOCAL", same_turn_dispatch: true, status: "DISPATCHED"};
}

function bridgeEvidence(intake) {
  const evidence = intake.evidence_refs.map(({evidence_id, reference, sha256}) => ({evidence_id, reference, sha256}));
  evidence.push({
    evidence_id: `EVIDENCE.SPAWNER.BRIDGE.${intake.defect_id}`,
    reference: `opaque:agent-spawner-controller-bridge/${intake.defect_id.toLowerCase()}`,
    sha256: canonicalDigest({defect_id: intake.defect_id, handoff_sha256: intake.handoff.handoff_sha256}),
  });
  return evidence.sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
}

function bridgeHostileFixtures(intake) {
  return [...new Set([
    ...intake.repair.hostile_fixture_refs,
    "FIXTURE.SPAWNER.CONTROLLER_BRIDGE.UNKNOWN_ROUTE",
    "FIXTURE.SPAWNER.CONTROLLER_BRIDGE.STALE_SOURCE",
    "FIXTURE.SPAWNER.CONTROLLER_BRIDGE.DIGEST_TAMPER",
  ])].sort(compareUtf8);
}

function derivedSemanticState(intake, mappedAction, stage) {
  return canonicalDigest({
    bridge: AGENT_SPAWNER_CONTROLLER_BRIDGE_SCHEMA,
    defect_id: intake.defect_id,
    source_handoff_sha256: intake.handoff.handoff_sha256,
    mapped_action: mappedAction,
    stage,
  });
}

function validateRouteBindings(bridge, intake) {
  const mappedAction = SPAWNER_ROUTE_TO_CONTROLLER_ACTION[intake.route];
  assert(mappedAction !== undefined, `Spawner route ${intake.route} has no Controller mapping`);
  assert(bridge.source_route === intake.route, "Spawner bridge source route is stale");
  assert(bridge.mapped_action === mappedAction, "Spawner bridge mapped action is stale");
  assert(bridge.mapped_handler === controllerActionHandlerFor(mappedAction), "Spawner bridge mapped handler is stale");
  assert(bridge.defect_id === intake.defect_id, "Spawner bridge defect identity is stale");
  assert(bridge.source_handoff_sha256 === intake.handoff.handoff_sha256, "Spawner bridge source handoff is stale");
  assert(bridge.source_controller_receipt_sha256 === intake.handoff.controller_receipt_sha256, "Spawner bridge source Controller receipt is stale");
  assert(bridge.roster_invalidation === intake.admission.roster_status, "Spawner bridge roster invalidation is stale");
  assert(routeStatusIsValid(intake), "Spawner intake is not eligible for Controller bridging");
}

export function validateAgentSpawnerControllerBridge(bridge, intake) {
  validateAgentSpawnerDefectIntake(intake);
  exactKeys(bridge, BRIDGE_KEYS, "Agent Spawner Controller bridge");
  assert(bridge.schema === AGENT_SPAWNER_CONTROLLER_BRIDGE_SCHEMA && bridge.version === AGENT_SPAWNER_CONTROLLER_BRIDGE_VERSION, "Agent Spawner Controller bridge identity is invalid");
  requireIdentifier(bridge.bridge_id, "Agent Spawner Controller bridge ID");
  validateRouteBindings(bridge, intake);
  requireSha(bridge.source_handoff_sha256, "Agent Spawner bridge source handoff digest");
  requireSha(bridge.source_controller_receipt_sha256, "Agent Spawner bridge source Controller receipt digest", {allowNull: true});
  requireIdentifier(bridge.source_route, "Agent Spawner bridge source route");
  requireIdentifier(bridge.mapped_action, "Agent Spawner bridge mapped action");
  requireIdentifier(bridge.mapped_handler, "Agent Spawner bridge mapped handler");
  assert(CONTROLLER_ACTION_REGISTRY[bridge.mapped_action] !== undefined, "Agent Spawner bridge mapped action is not registered");
  assert(bridge.mapped_handler === controllerActionHandlerFor(bridge.mapped_action), "Agent Spawner bridge mapped handler does not match registry");
  assert(["INVALIDATE_DEPENDENTS", "PRESERVE_EXISTING_AND_REBUILD", "NO_DEPENDENTS"].includes(bridge.roster_invalidation), "Agent Spawner bridge roster invalidation is invalid");
  exactKeys(bridge.dispatch, DISPATCH_KEYS, "Agent Spawner bridge dispatch");
  const expected = expectedDispatch(bridge.source_route);
  assert(JSON.stringify(bridge.dispatch) === JSON.stringify(expected), "Agent Spawner bridge dispatch mode is invalid");
  validateControllerActionReceipt(bridge.controller_action_receipt);
  assert(bridge.controller_action_receipt.next_action === bridge.mapped_action, "Agent Spawner bridge Controller action is stale");
  assert(bridge.controller_action_receipt.next_handler === bridge.mapped_handler, "Agent Spawner bridge Controller handler is stale");
  assert(bridge.controller_action_receipt.previous_receipt_sha256 === bridge.source_controller_receipt_sha256, "Agent Spawner bridge previous receipt is stale");
  assert(bridge.controller_action_receipt.action_id === "SPAWNER_DEFECT_HANDOFF", "Agent Spawner bridge action identity is invalid");
  assert(bridge.controller_action_receipt.continuation.same_turn_dispatch === bridge.dispatch.same_turn_dispatch, "Agent Spawner bridge continuation mode is stale");
  if (bridge.source_route === "ESCALATE_PROTECTED") {
    assert(bridge.controller_action_receipt.protected_event !== null, "Protected Spawner bridge lacks protected event");
  } else {
    assert(bridge.controller_action_receipt.protected_event === null, "Local Spawner bridge carries a protected event");
  }
  requireSha(bridge.readback_sha256, "Agent Spawner bridge readback digest");
  assert(bridge.readback_sha256 === canonicalDigest(readbackBody(bridge)), "Agent Spawner bridge readback digest mismatch");
  requireSha(bridge.bridge_sha256, "Agent Spawner bridge digest");
  assert(bridge.bridge_sha256 === canonicalDigest(bridgeBody(bridge)), "Agent Spawner bridge digest mismatch");
  return bridge;
}

export function compileAgentSpawnerControllerBridge({
  bridgeId,
  intake,
  protectedEvent = null,
  semanticBeforeSha256 = null,
  semanticAfterSha256 = null,
} = {}) {
  validateAgentSpawnerDefectIntake(intake);
  requireIdentifier(bridgeId, "Agent Spawner Controller bridge ID");
  assert(routeStatusIsValid(intake), "Spawner intake is not eligible for Controller bridging");
  const mappedAction = SPAWNER_ROUTE_TO_CONTROLLER_ACTION[intake.route];
  assert(mappedAction !== undefined, `Spawner route ${intake.route} has no Controller mapping`);
  const protectedRoute = intake.route === "ESCALATE_PROTECTED";
  if (protectedRoute) {
    assert(protectedEvent !== null, "Protected Spawner route requires a typed protected event");
    assert(semanticBeforeSha256 === null && semanticAfterSha256 === null, "Protected Spawner bridge derives its held semantic state");
  }
  const before = semanticBeforeSha256 ?? derivedSemanticState(intake, mappedAction, "SPAWNER_HANDOFF");
  const after = protectedRoute ? before : semanticAfterSha256 ?? derivedSemanticState(intake, mappedAction, "CONTROLLER_ROUTE");
  requireSha(before, "Spawner bridge semantic before");
  requireSha(after, "Spawner bridge semantic after");
  if (!protectedRoute) assert(before !== after, "Local Spawner bridge must advance semantic state");
  const receipt = compileControllerActionReceipt({
    receiptId: `${bridgeId}.CONTROLLER_ACTION`,
    actionId: "SPAWNER_DEFECT_HANDOFF",
    previousReceiptSha256: intake.handoff.controller_receipt_sha256,
    semanticBeforeSha256: before,
    semanticAfterSha256: after,
    evidenceRefs: bridgeEvidence(intake),
    hostileFixtureRefs: bridgeHostileFixtures(intake),
    nextAction: mappedAction,
    protectedEvent,
  });
  const bridge = {
    schema: AGENT_SPAWNER_CONTROLLER_BRIDGE_SCHEMA,
    version: AGENT_SPAWNER_CONTROLLER_BRIDGE_VERSION,
    bridge_id: bridgeId,
    defect_id: intake.defect_id,
    source_handoff_sha256: intake.handoff.handoff_sha256,
    source_controller_receipt_sha256: intake.handoff.controller_receipt_sha256,
    source_route: intake.route,
    mapped_action: mappedAction,
    mapped_handler: controllerActionHandlerFor(mappedAction),
    controller_action_receipt: receipt,
    roster_invalidation: intake.admission.roster_status,
    dispatch: expectedDispatch(intake.route),
    readback_sha256: null,
    bridge_sha256: null,
  };
  bridge.readback_sha256 = canonicalDigest(readbackBody(bridge));
  bridge.bridge_sha256 = canonicalDigest(bridgeBody(bridge));
  return validateAgentSpawnerControllerBridge(bridge, intake);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Agent Spawner Controller bridge contract loaded\n");
