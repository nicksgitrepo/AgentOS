#!/usr/bin/env node

/*
 * Project-agnostic gate for a failed Import Orchestrator focused check.
 *
 * A stale test expectation is a repair input, not permission to restore a
 * protected wait.  The gate records the exact failure, re-evaluates the
 * current typed custody facts, and emits a bounded repair successor.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {CONTROLLER_ACTION_REGISTRY, controllerActionHandlerFor} from "./controller-action-dispatcher.mjs";

export const IMPORT_ORCHESTRATOR_TEST_FAILURE_GATE_SCHEMA = "agentos.import_orchestrator_test_failure_gate.v1";
export const IMPORT_ORCHESTRATOR_TEST_FAILURE_GATE_VERSION = 1;
export const IMPORT_ORCHESTRATOR_TEST_FAILURE_REPAIR_ACTION = "REPAIR_BLOCKS";
export const IMPORT_ORCHESTRATOR_TEST_FAILURE_REPAIR_HANDLER = "HANDLER.ORCHESTRATOR_BLOCK_REPAIR";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "authority_binding", "failed_check", "route_facts",
  "decision", "repair_block", "custody", "evidence_refs", "hostile_fixture_refs", "status", "gate_sha256",
]);
const AUTHORITY_KEYS = Object.freeze(["commit", "tree", "receipt_sha256"]);
const FAILED_CHECK_KEYS = Object.freeze(["defect_code", "command", "file", "line", "actual", "expected", "assertion"]);
const ROUTE_FACT_KEYS = Object.freeze([
  "boundary_id", "boundary_scope", "clearance_applicability", "run_state", "open_findings_count",
  "isolated_local_custody", "source_roots_preserved", "shared_workspace_read_only", "wave_activation",
  "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "derived_next_action", "derived_next_handler",
]);
const REPAIR_KEYS = Object.freeze(["next_action", "next_handler", "route_kind", "same_turn_dispatch", "restart_event", "hostile_rejection_rule"]);
const CUSTODY_KEYS = Object.freeze(["execution_owner", "direct_consumer", "controller_approval_required", "controller_role", "product_mutation", "protected_action"]);

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

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a non-null lowercase SHA-256`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function requireText(value, label, minimum = 1) {
  assert(typeof value === "string" && value.trim().length >= minimum, `${label} must contain at least ${minimum} characters`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "test-failure gate evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `test-failure evidence ${index}`);
    requireIdentifier(ref.evidence_id, `test-failure evidence ${index} id`);
    requireReference(ref.reference, `test-failure evidence ${index} reference`);
    requireSha(ref.sha256, `test-failure evidence ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "test-failure evidence refs must be sorted and unique");
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "test-failure hostile fixtures are required");
  refs.forEach((ref, index) => requireIdentifier(ref, `test-failure hostile fixture ${index}`));
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "test-failure hostile fixtures must be sorted and unique");
}

function validateAuthority(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "test-failure authority binding");
  requireSha(authority.commit, "test-failure authority commit");
  requireSha(authority.tree, "test-failure authority tree");
  requireSha(authority.receipt_sha256, "test-failure authority receipt");
}

function validateFailedCheck(check) {
  exactKeys(check, FAILED_CHECK_KEYS, "failed focused check");
  requireIdentifier(check.defect_code, "failed focused check defect code");
  requireText(check.command, "failed focused check command");
  requireText(check.file, "failed focused check file");
  assert(Number.isSafeInteger(check.line) && check.line > 0, "failed focused check line is invalid");
  requireText(check.actual, "failed focused check actual");
  requireText(check.expected, "failed focused check expected");
  requireText(check.assertion, "failed focused check assertion");
  assert(check.actual !== check.expected, "failed focused check must preserve a real mismatch");
}

function validateRouteFacts(facts) {
  exactKeys(facts, ROUTE_FACT_KEYS, "test-failure route facts");
  requireIdentifier(facts.boundary_id, "test-failure boundary id");
  assert(["APPLICABILITY_ONLY_LOCAL", "PROTECTED_EXTERNAL", "PROTECTED_PRODUCT", "PROTECTED_INTEGRATION"].includes(facts.boundary_scope), "test-failure boundary scope is invalid");
  assert(["NOT_APPLICABLE_LOCAL_COMPILER_QA", "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR", "REQUIRED_PROTECTED_ROUTE"].includes(facts.clearance_applicability), "test-failure applicability is invalid");
  assert(["BLOCKED_PROTECTED", "SPAWNER_QA_PENDING", "ACTIVE", "PLATFORM_REVIEW_PENDING", "CENTRAL_INTEGRATION_PENDING"].includes(facts.run_state), "test-failure run state is invalid");
  assert(Number.isSafeInteger(facts.open_findings_count) && facts.open_findings_count >= 0, "test-failure open finding count is invalid");
  for (const key of ["isolated_local_custody", "source_roots_preserved", "shared_workspace_read_only", "provider_access", "credential_access", "external_sync", "spend", "destructive_work"]) assert(typeof facts[key] === "boolean", `test-failure route fact ${key} must be boolean`);
  assert(facts.wave_activation === "OFF", "test-failure route cannot activate a wave");
  requireIdentifier(facts.derived_next_action, "test-failure derived next action");
  requireIdentifier(facts.derived_next_handler, "test-failure derived next handler");
  const actionDescriptor = CONTROLLER_ACTION_REGISTRY[facts.derived_next_action];
  assert(actionDescriptor !== undefined, "test-failure derived next action is not registered");
  assert(facts.derived_next_handler === controllerActionHandlerFor(facts.derived_next_action), "test-failure derived next handler does not match the action registry");

  /*
   * Registration alone is not route proof. A stale or hand-written record
   * must not turn an applicability-only local fact into a protected wait, and
   * a protected route must be anchored to the planner's blocked state. This
   * semantic boundary prevents a familiar action name from parking the
   * workflow without a real protected event.
   */
  const localApplicability = facts.boundary_scope === "APPLICABILITY_ONLY_LOCAL";
  const protectedBoundary = ["PROTECTED_EXTERNAL", "PROTECTED_PRODUCT", "PROTECTED_INTEGRATION"].includes(facts.boundary_scope);
  if (["NOT_APPLICABLE_LOCAL_COMPILER_QA", "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR"].includes(facts.clearance_applicability)) {
    assert(localApplicability, "local applicability must use the applicability-only boundary");
  }
  if (protectedBoundary) {
    assert(facts.clearance_applicability === "REQUIRED_PROTECTED_ROUTE", "protected boundary must require protected clearance");
  }
  if (localApplicability) {
    assert(facts.clearance_applicability !== "REQUIRED_PROTECTED_ROUTE", "local applicability cannot claim required protected clearance");
    assert(actionDescriptor.mode !== "PROTECTED_WAIT", "local applicability cannot derive a protected wait");
    if (facts.clearance_applicability === "NOT_APPLICABLE_LOCAL_COMPILER_QA") {
      assert(facts.derived_next_action === "REQUEST_SPAWNER_QA", "local compiler QA must continue through Spawner QA");
    }
    if (facts.clearance_applicability === "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR") {
      assert(facts.derived_next_action === "START_ISOLATED_AUDIT_LANES", "local audit repair must continue through isolated audit lanes");
    }
  }
  if (facts.clearance_applicability === "REQUIRED_PROTECTED_ROUTE") {
    assert(!localApplicability, "required protected clearance cannot use an applicability-only boundary");
    assert(facts.run_state === "BLOCKED_PROTECTED", "required protected clearance must be anchored to a blocked protected run-state");
  }
}

function validateRepair(repair) {
  exactKeys(repair, REPAIR_KEYS, "test-failure repair block");
  assert(repair.next_action === IMPORT_ORCHESTRATOR_TEST_FAILURE_REPAIR_ACTION, "test-failure repair must route to REPAIR_BLOCKS");
  assert(repair.next_handler === IMPORT_ORCHESTRATOR_TEST_FAILURE_REPAIR_HANDLER, "test-failure repair handler is invalid");
  assert(["LOCAL_COMPILER_QA", "LOCAL_AUDIT_REPAIR", "PROTECTED_ROUTE_REPAIR"].includes(repair.route_kind), "test-failure repair route kind is invalid");
  assert(repair.same_turn_dispatch === true, "test-failure repair must continue in the same turn");
  requireIdentifier(repair.restart_event, "test-failure repair restart event");
  requireText(repair.hostile_rejection_rule, "test-failure hostile rejection rule", 16);
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "test-failure custody");
  assert(custody.execution_owner === "LANE_AGENT", "test-failure repair must remain lane-owned");
  assert(custody.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "test-failure repair must route to independent review");
  assert(custody.controller_approval_required === false, "test-failure repair cannot require Controller approval");
  assert(custody.controller_role === "LIVENESS_CUSTODIAN", "Controller role must remain liveness custody only");
  assert(custody.product_mutation === false && custody.protected_action === false, "test-failure repair crossed a protected boundary");
}

export function validateImportOrchestratorTestFailureGate(gate, {authority = null} = {}) {
  exactKeys(gate, GATE_KEYS, "Import Orchestrator test-failure gate");
  assert(gate.schema === IMPORT_ORCHESTRATOR_TEST_FAILURE_GATE_SCHEMA && gate.version === IMPORT_ORCHESTRATOR_TEST_FAILURE_GATE_VERSION, "test-failure gate identity is invalid");
  requireIdentifier(gate.gate_id, "test-failure gate id");
  validateAuthority(gate.authority_binding);
  if (authority !== null) {
    validateAuthority(authority);
    assert(gate.authority_binding.commit === authority.commit && gate.authority_binding.tree === authority.tree && gate.authority_binding.receipt_sha256 === authority.receipt_sha256, "test-failure gate authority is stale");
  }
  validateFailedCheck(gate.failed_check);
  validateRouteFacts(gate.route_facts);
  assert(["STALE_EXPECTATION_REPAIR_REQUIRED", "PROTECTED_ROUTE_REPAIR_REQUIRED"].includes(gate.decision), "test-failure gate decision is invalid");
  validateRepair(gate.repair_block);
  validateCustody(gate.custody);
  validateEvidenceRefs(gate.evidence_refs);
  validateHostileRefs(gate.hostile_fixture_refs);
  assert(gate.status === "REPAIR_REQUIRED", "test-failure gate must remain non-terminal");
  requireSha(gate.gate_sha256, "test-failure gate digest");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "test-failure gate digest mismatch");
  return gate;
}

export function compileImportOrchestratorTestFailureGate({
  gateId,
  authorityBinding,
  failedCheck,
  routeFacts,
  evidenceRefs,
  hostileFixtureRefs,
  restartEvent = "EVENT.SPAWNER.REPAIR_IMPORT_ORCHESTRATOR_TEST_EXPECTATION",
} = {}) {
  requireIdentifier(gateId, "test-failure gate id");
  validateAuthority(authorityBinding);
  validateFailedCheck(failedCheck);
  validateRouteFacts(routeFacts);
  const localCompilerQa = routeFacts.boundary_scope === "APPLICABILITY_ONLY_LOCAL"
    && routeFacts.clearance_applicability === "NOT_APPLICABLE_LOCAL_COMPILER_QA"
    && routeFacts.open_findings_count === 0
    && routeFacts.source_roots_preserved === true
    && routeFacts.shared_workspace_read_only === true
    && routeFacts.provider_access === false
    && routeFacts.credential_access === false
    && routeFacts.external_sync === false
    && routeFacts.spend === false
    && routeFacts.destructive_work === false
    && routeFacts.derived_next_action === "REQUEST_SPAWNER_QA";
  const localAuditRepair = routeFacts.boundary_scope === "APPLICABILITY_ONLY_LOCAL"
    && routeFacts.clearance_applicability === "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR"
    && routeFacts.open_findings_count === 0
    && routeFacts.isolated_local_custody === true
    && routeFacts.source_roots_preserved === true
    && routeFacts.shared_workspace_read_only === true
    && routeFacts.wave_activation === "OFF"
    && routeFacts.provider_access === false
    && routeFacts.credential_access === false
    && routeFacts.external_sync === false
    && routeFacts.spend === false
    && routeFacts.destructive_work === false
    && routeFacts.derived_next_action === "START_ISOLATED_AUDIT_LANES";
  const protectedRoute = routeFacts.clearance_applicability === "REQUIRED_PROTECTED_ROUTE" || routeFacts.boundary_scope !== "APPLICABILITY_ONLY_LOCAL";
  const decision = localCompilerQa || localAuditRepair ? "STALE_EXPECTATION_REPAIR_REQUIRED" : "PROTECTED_ROUTE_REPAIR_REQUIRED";
  const routeKind = localCompilerQa ? "LOCAL_COMPILER_QA" : localAuditRepair ? "LOCAL_AUDIT_REPAIR" : "PROTECTED_ROUTE_REPAIR";
  const gate = {
    schema: IMPORT_ORCHESTRATOR_TEST_FAILURE_GATE_SCHEMA,
    version: IMPORT_ORCHESTRATOR_TEST_FAILURE_GATE_VERSION,
    gate_id: gateId,
    authority_binding: structuredClone(authorityBinding),
    failed_check: structuredClone(failedCheck),
    route_facts: structuredClone(routeFacts),
    decision,
    repair_block: {
      next_action: IMPORT_ORCHESTRATOR_TEST_FAILURE_REPAIR_ACTION,
      next_handler: IMPORT_ORCHESTRATOR_TEST_FAILURE_REPAIR_HANDLER,
      route_kind: routeKind,
      same_turn_dispatch: true,
      restart_event: restartEvent,
      hostile_rejection_rule: protectedRoute
        ? "Reject local reclassification for required protected or central-integration routes."
        : "Reject any expectation-only closeout that omits current typed custody facts.",
    },
    custody: {
      execution_owner: "LANE_AGENT",
      direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
      controller_approval_required: false,
      controller_role: "LIVENESS_CUSTODIAN",
      product_mutation: false,
      protected_action: false,
    },
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    status: "REPAIR_REQUIRED",
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return validateImportOrchestratorTestFailureGate(gate);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Import Orchestrator test-failure gate loaded\n");
