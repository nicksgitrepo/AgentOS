/*
 * Project-agnostic Agent Spawner defect-to-governance compiler.
 *
 * This contract turns observed workflow failures into reusable gate/block
 * repair candidates. It never spawns a seed or working agent: incomplete,
 * unevaluated, or uncleared repairs remain non-spawnable and are routed by a
 * typed handoff to Controller custody.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const AGENT_SPAWNER_DEFECT_INTAKE_SCHEMA = "agentos.agent_spawner_defect_intake.v1";
export const AGENT_SPAWNER_DEFECT_INTAKE_VERSION = 1;
export const AGENT_SPAWNER_DEFECT_KINDS = Object.freeze([
  "CHECK_FAILURE",
  "QA_FINDING",
  "COMPLAINT",
  "CONTRADICTION",
  "REJECTED_ROUTE",
  "HANDOFF_FAILURE",
  "NON_PASSING_CHECK",
]);
export const AGENT_SPAWNER_DEFECT_CLASSIFICATIONS = Object.freeze([
  "REPAIRABLE_GATE_GAP",
  "ORCHESTRATOR_LIVENESS_FAILURE",
  "PROTECTED_BOUNDARY",
  "AUTHORITY_CONFLICT",
  "DUPLICATE_OR_STALE_BLOCK",
]);
export const AGENT_SPAWNER_DEFECT_ROUTES = Object.freeze([
  "COMPILE_BLOCK_PATCH",
  "REPAIR_ORCHESTRATOR_ROUTE",
  "REBUILD_DEPENDENT_ROSTER",
  "ESCALATE_PROTECTED",
  "REJECT_DUPLICATE",
]);
export const AGENT_SPAWNER_DEFECT_STATUSES = Object.freeze([
  "REPAIR_CANDIDATE_READY",
  "PENDING_PROTECTED_DECISION",
  "ACCEPTED_FOR_CONTROLLER_CUSTODY",
  "REJECTED_DUPLICATE",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
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

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && UTC.test(value), `${label} must be UTC`);
}

function nullableIdentifier(value, label) {
  if (value !== null) requireIdentifier(value, label);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  values.forEach((value) => requireString(value, `${label} item`));
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}

function body(value) {
  const copy = structuredClone(value);
  copy.defect_sha256 = null;
  return copy;
}

function handoffBody(value) {
  const copy = structuredClone(value);
  copy.handoff_sha256 = null;
  return copy;
}

function validateEvidenceRefs(values) {
  assert(Array.isArray(values) && values.length > 0, "Spawner defect evidence is required");
  const ids = new Set();
  values.forEach((entry, index) => {
    exactKeys(entry, ["evidence_id", "kind", "reference", "sha256"], `Spawner defect evidence ${index}`);
    requireIdentifier(entry.evidence_id, `Spawner defect evidence ${index} ID`);
    assert(!ids.has(entry.evidence_id), `Spawner defect evidence ${index} is duplicated`);
    ids.add(entry.evidence_id);
    requireIdentifier(entry.kind, `Spawner defect evidence ${index} kind`);
    assert(typeof entry.reference === "string" && REFERENCE.test(entry.reference), `Spawner defect evidence ${index} reference is invalid`);
    requireSha(entry.sha256, `Spawner defect evidence ${index} digest`);
  });
  const ordered = [...values].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
  assert(JSON.stringify(values) === JSON.stringify(ordered), "Spawner defect evidence must be sorted");
}

function validateSourceBinding(binding) {
  exactKeys(binding, ["candidate_sha256", "context_sha256", "roster_projection_sha256", "source_identity_sha256"], "Spawner defect source binding");
  for (const field of Object.keys(binding)) requireSha(binding[field], `Spawner defect source binding ${field}`);
}

function validateObservation(observation) {
  exactKeys(observation, ["summary", "expected", "observed", "observed_at_utc", "details_sha256"], "Spawner defect observation");
  for (const field of ["summary", "expected", "observed"]) requireString(observation[field], `Spawner defect observation ${field}`);
  requireUtc(observation.observed_at_utc, "Spawner defect observation timestamp");
  requireSha(observation.details_sha256, "Spawner defect observation details");
}

function validateRootCause(rootCause) {
  exactKeys(rootCause, ["category", "statement", "evidence_class"], "Spawner defect root cause");
  requireIdentifier(rootCause.category, "Spawner defect root cause category");
  requireString(rootCause.statement, "Spawner defect root cause statement");
  assert(["OBSERVED", "INFERRED", "UNKNOWN"].includes(rootCause.evidence_class), "Spawner defect root cause evidence class is invalid");
}

function validateRepair(repair) {
  exactKeys(repair, ["kind", "block_id", "gate_id", "graph_id", "question", "required_evidence", "deterministic_rule", "failure_routes", "hostile_fixture_refs", "authority_scope", "stop_conditions", "bindings_to_refresh", "invalidation_rule"], "Spawner defect repair");
  assert(["REUSABLE_BLOCK_PATCH", "ORCHESTRATOR_ROUTE_REPAIR", "NO_REPAIR_PROPOSED"].includes(repair.kind), "Spawner defect repair kind is invalid");
  nullableIdentifier(repair.block_id, "Spawner defect repair block");
  nullableIdentifier(repair.gate_id, "Spawner defect repair gate");
  nullableIdentifier(repair.graph_id, "Spawner defect repair graph");
  requireString(repair.question, "Spawner defect repair question");
  assert(repair.question.endsWith("?"), "Spawner defect repair question must end with a question mark");
  sortedUnique(repair.required_evidence, "Spawner defect repair evidence");
  requireString(repair.deterministic_rule, "Spawner defect repair deterministic rule");
  exactKeys(repair.failure_routes, ["NO", "UNKNOWN", "NOT_APPLICABLE"], "Spawner defect repair failure routes");
  for (const field of ["NO", "UNKNOWN", "NOT_APPLICABLE"]) {
    requireIdentifier(repair.failure_routes[field].classification, `Spawner defect ${field} classification`);
    requireIdentifier(repair.failure_routes[field].route, `Spawner defect ${field} route`);
    requireString(repair.failure_routes[field].terminal_behavior, `Spawner defect ${field} terminal behavior`);
  }
  sortedUnique(repair.hostile_fixture_refs, "Spawner defect hostile fixtures");
  sortedUnique(repair.authority_scope, "Spawner defect authority scope");
  sortedUnique(repair.stop_conditions, "Spawner defect stop conditions");
  sortedUnique(repair.bindings_to_refresh, "Spawner defect binding refresh set");
  requireString(repair.invalidation_rule, "Spawner defect invalidation rule");
  if (repair.kind === "REUSABLE_BLOCK_PATCH") {
    assert(repair.block_id !== null && repair.gate_id !== null && repair.graph_id !== null, "Reusable block patch must bind block, gate, and graph IDs");
  }
}

function validateAdmission(admission) {
  exactKeys(admission, ["spawnable", "independent_evaluation_required", "independent_evaluation_sha256", "roster_status"], "Spawner defect admission");
  assert(admission.spawnable === false, "Spawner defect repair must never be spawnable at intake");
  assert(admission.independent_evaluation_required === true, "Spawner defect repair must require independent evaluation");
  if (admission.independent_evaluation_sha256 !== null) requireSha(admission.independent_evaluation_sha256, "Spawner defect evaluation digest");
  assert(["INVALIDATE_DEPENDENTS", "PRESERVE_EXISTING_AND_REBUILD", "NO_DEPENDENTS"].includes(admission.roster_status), "Spawner defect roster status is invalid");
}

function validateHandoff(handoff, intake) {
  exactKeys(handoff, ["schema", "version", "defect_id", "source_binding_sha256", "route", "status", "next_action", "controller_receipt_sha256", "handoff_sha256"], "Spawner defect handoff");
  assert(handoff.schema === "agentos.agent_spawner_defect_handoff.v1" && handoff.version === 1, "Spawner defect handoff identity is invalid");
  requireIdentifier(handoff.defect_id, "Spawner defect handoff defect ID");
  assert(handoff.defect_id === intake.defect_id, "Spawner defect handoff names a different defect");
  requireSha(handoff.source_binding_sha256, "Spawner defect handoff source binding");
  assert(handoff.source_binding_sha256 === canonicalDigest(intake.source_binding), "Spawner defect handoff source binding is stale");
  assert(handoff.route === intake.route, "Spawner defect handoff route is stale");
  assert(["PENDING_TYPED_CONTROLLER_CUSTODY", "PENDING_PROTECTED_DECISION", "ACCEPTED_FOR_TYPED_CONTROLLER_CUSTODY", "REJECTED_DUPLICATE"].includes(handoff.status), "Spawner defect handoff status is invalid");
  assert(["ROUTE_TO_CONTROLLER_CUSTODY", "WAIT_FOR_PROTECTED_DECISION", "CONTROLLER_REVIEW_AND_ORCHESTRATOR_ROUTE", "INVALIDATE_DEPENDENTS"].includes(handoff.next_action), "Spawner defect handoff next action is invalid");
  if (handoff.controller_receipt_sha256 !== null) requireSha(handoff.controller_receipt_sha256, "Spawner defect controller receipt");
  requireSha(handoff.handoff_sha256, "Spawner defect handoff digest");
  assert(handoff.handoff_sha256 === canonicalDigest(handoffBody(handoff)), "Spawner defect handoff digest mismatch");
}

export function validateAgentSpawnerDefectIntake(intake) {
  exactKeys(intake, ["schema", "version", "defect_id", "spawner_role_id", "defect_kind", "status", "source_binding", "evidence_refs", "observation", "classification", "route", "root_cause", "repair", "admission", "handoff", "defect_sha256"], "Spawner defect intake");
  assert(intake.schema === AGENT_SPAWNER_DEFECT_INTAKE_SCHEMA && intake.version === AGENT_SPAWNER_DEFECT_INTAKE_VERSION, "Spawner defect intake identity is invalid");
  requireIdentifier(intake.defect_id, "Spawner defect ID");
  assert(intake.spawner_role_id === "AGENT.SPAWNER_COMPILER", "Spawner defect role identity is invalid");
  assert(AGENT_SPAWNER_DEFECT_KINDS.includes(intake.defect_kind), "Spawner defect kind is invalid");
  assert(AGENT_SPAWNER_DEFECT_STATUSES.includes(intake.status), "Spawner defect status is invalid");
  validateSourceBinding(intake.source_binding);
  validateEvidenceRefs(intake.evidence_refs);
  validateObservation(intake.observation);
  assert(AGENT_SPAWNER_DEFECT_CLASSIFICATIONS.includes(intake.classification), "Spawner defect classification is invalid");
  assert(AGENT_SPAWNER_DEFECT_ROUTES.includes(intake.route), "Spawner defect route is invalid");
  validateRootCause(intake.root_cause);
  validateRepair(intake.repair);
  validateAdmission(intake.admission);
  validateHandoff(intake.handoff, intake);
  if (intake.classification === "PROTECTED_BOUNDARY") assert(intake.route === "ESCALATE_PROTECTED" && intake.status === "PENDING_PROTECTED_DECISION", "Protected defect must remain pending protected decision");
  if (intake.classification === "DUPLICATE_OR_STALE_BLOCK") assert(intake.route === "REJECT_DUPLICATE" && intake.status === "REJECTED_DUPLICATE", "Duplicate defect must be rejected and invalidated");
  if (intake.status === "REPAIR_CANDIDATE_READY") assert(["COMPILE_BLOCK_PATCH", "REPAIR_ORCHESTRATOR_ROUTE", "REBUILD_DEPENDENT_ROSTER"].includes(intake.route), "Ready defect must have a local repair route");
  if (intake.status === "ACCEPTED_FOR_CONTROLLER_CUSTODY") assert(intake.handoff.status === "ACCEPTED_FOR_TYPED_CONTROLLER_CUSTODY" && intake.handoff.controller_receipt_sha256 !== null, "Accepted defect lacks Controller custody");
  if (intake.status === "PENDING_PROTECTED_DECISION") assert(intake.handoff.status === "PENDING_PROTECTED_DECISION", "Protected defect handoff is not pending");
  if (intake.status === "REJECTED_DUPLICATE") assert(intake.handoff.status === "REJECTED_DUPLICATE" && intake.admission.roster_status === "INVALIDATE_DEPENDENTS", "Rejected duplicate did not invalidate dependents");
  requireSha(intake.defect_sha256, "Spawner defect digest");
  assert(intake.defect_sha256 === canonicalDigest(body(intake)), "Spawner defect digest mismatch");
  return intake;
}

function routeFor(classification) {
  if (classification === "PROTECTED_BOUNDARY") return "ESCALATE_PROTECTED";
  if (classification === "DUPLICATE_OR_STALE_BLOCK") return "REJECT_DUPLICATE";
  if (classification === "ORCHESTRATOR_LIVENESS_FAILURE") return "REPAIR_ORCHESTRATOR_ROUTE";
  if (classification === "AUTHORITY_CONFLICT") return "REBUILD_DEPENDENT_ROSTER";
  return "COMPILE_BLOCK_PATCH";
}

function statusFor(route) {
  if (route === "ESCALATE_PROTECTED") return "PENDING_PROTECTED_DECISION";
  if (route === "REJECT_DUPLICATE") return "REJECTED_DUPLICATE";
  return "REPAIR_CANDIDATE_READY";
}

function compileHandoff({defectId, sourceBinding, route, status, controllerReceiptSha256 = null}) {
  const protectedRoute = route === "ESCALATE_PROTECTED";
  const duplicateRoute = route === "REJECT_DUPLICATE";
  const handoff = {
    schema: "agentos.agent_spawner_defect_handoff.v1",
    version: 1,
    defect_id: defectId,
    source_binding_sha256: canonicalDigest(sourceBinding),
    route,
    status: protectedRoute ? "PENDING_PROTECTED_DECISION" : duplicateRoute ? "REJECTED_DUPLICATE" : status === "ACCEPTED_FOR_CONTROLLER_CUSTODY" ? "ACCEPTED_FOR_TYPED_CONTROLLER_CUSTODY" : "PENDING_TYPED_CONTROLLER_CUSTODY",
    next_action: protectedRoute ? "WAIT_FOR_PROTECTED_DECISION" : duplicateRoute ? "INVALIDATE_DEPENDENTS" : status === "ACCEPTED_FOR_CONTROLLER_CUSTODY" ? "CONTROLLER_REVIEW_AND_ORCHESTRATOR_ROUTE" : "ROUTE_TO_CONTROLLER_CUSTODY",
    controller_receipt_sha256: controllerReceiptSha256,
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = canonicalDigest(handoffBody(handoff));
  return handoff;
}

export function compileAgentSpawnerDefectIntake({
  defectId,
  defectKind,
  sourceBinding,
  evidenceRefs,
  observation,
  classification,
  rootCause,
  blockId = null,
  gateId = null,
  graphId = null,
  question = "Does the observed route satisfy its required evidence and deterministic acceptance rule?",
  requiredEvidence = ["evidence.source_readback", "evidence.independent_recheck"],
  hostileFixtureRefs = ["FIXTURE.DEFECT.REJECT_UNKNOWN", "FIXTURE.DEFECT.REJECT_INCOMPLETE_EVIDENCE"],
  authorityScope = ["COMPILE_REUSABLE_GATE", "REFRESH_TYPED_BINDINGS", "INVALIDATE_DEPENDENT_ROSTER"],
  stopConditions = ["INCOMPLETE_BLOCK", "MISSING_EVIDENCE", "PROTECTED_BOUNDARY", "INDEPENDENT_EVALUATION_NOT_CLEARED"],
  bindingsToRefresh = ["BLOCK_DIGEST", "GATE_DIGEST", "ROSTER_PROJECTION_DIGEST", "DEPENDENT_SEED_DIGEST"],
  deterministicRule = "YES passes only when every required evidence slot is present, identity-bound, and independently rechecked; NO, UNKNOWN, and NOT_APPLICABLE never pass.",
  failureRoutes = {
    NO: {classification: "REPAIRABLE_GATE_GAP", route: "BOUNDED_REPAIR", terminal_behavior: "REPAIR_PENDING"},
    UNKNOWN: {classification: "OWNER_OR_HARD_BLOCKER", route: "HOLD_FOR_EVIDENCE", terminal_behavior: "UNPROVEN"},
    NOT_APPLICABLE: {classification: "SOFT_BOUNDARY_REVIEW", route: "ORCHESTRATOR_REVIEW", terminal_behavior: "SOFT_REVIEW"},
  },
  detailsSha256,
  observedAtUtc,
} = {}) {
  requireIdentifier(defectId, "Spawner defect ID");
  assert(AGENT_SPAWNER_DEFECT_KINDS.includes(defectKind), "Spawner defect kind is invalid");
  validateSourceBinding(sourceBinding);
  assert(Array.isArray(evidenceRefs) && evidenceRefs.length > 0, "Spawner defect evidence is required");
  // Inputs may arrive in observation order. Canonical output is sorted below;
  // validate the normalized representation so callers cannot create a
  // semantically equivalent but differently ordered digest.
  const normalizedEvidenceRefs = [...evidenceRefs].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
  validateEvidenceRefs(normalizedEvidenceRefs);
  validateObservation({summary: observation.summary, expected: observation.expected, observed: observation.observed, observed_at_utc: observedAtUtc ?? observation.observed_at_utc, details_sha256: detailsSha256 ?? observation.details_sha256});
  assert(AGENT_SPAWNER_DEFECT_CLASSIFICATIONS.includes(classification), "Spawner defect classification is invalid");
  validateRootCause(rootCause);
  const route = routeFor(classification);
  const status = statusFor(route);
  const repairKind = route === "REPAIR_ORCHESTRATOR_ROUTE" ? "ORCHESTRATOR_ROUTE_REPAIR" : ["ESCALATE_PROTECTED", "REJECT_DUPLICATE"].includes(route) ? "NO_REPAIR_PROPOSED" : "REUSABLE_BLOCK_PATCH";
  const repair = {
    kind: repairKind,
    block_id: blockId,
    gate_id: gateId,
    graph_id: graphId,
    question,
    required_evidence: [...requiredEvidence].sort(compareUtf8),
    deterministic_rule: deterministicRule,
    failure_routes: structuredClone(failureRoutes),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    authority_scope: [...authorityScope].sort(compareUtf8),
    stop_conditions: [...stopConditions].sort(compareUtf8),
    bindings_to_refresh: [...bindingsToRefresh].sort(compareUtf8),
    invalidation_rule: "Any governing block, gate, source, applicability, or authority change invalidates dependent seeds and rebuilds them before reuse.",
  };
  const admission = {
    spawnable: false,
    independent_evaluation_required: true,
    independent_evaluation_sha256: null,
    roster_status: route === "REJECT_DUPLICATE" ? "INVALIDATE_DEPENDENTS" : route === "REBUILD_DEPENDENT_ROSTER" ? "PRESERVE_EXISTING_AND_REBUILD" : "NO_DEPENDENTS",
  };
  const handoff = compileHandoff({defectId, sourceBinding, route, status});
  const intake = {
    schema: AGENT_SPAWNER_DEFECT_INTAKE_SCHEMA,
    version: AGENT_SPAWNER_DEFECT_INTAKE_VERSION,
    defect_id: defectId,
    spawner_role_id: "AGENT.SPAWNER_COMPILER",
    defect_kind: defectKind,
    status,
    source_binding: structuredClone(sourceBinding),
    evidence_refs: normalizedEvidenceRefs,
    observation: {summary: observation.summary, expected: observation.expected, observed: observation.observed, observed_at_utc: observedAtUtc ?? observation.observed_at_utc, details_sha256: detailsSha256 ?? observation.details_sha256},
    classification,
    route,
    root_cause: structuredClone(rootCause),
    repair,
    admission,
    handoff,
    defect_sha256: null,
  };
  intake.defect_sha256 = canonicalDigest(body(intake));
  return validateAgentSpawnerDefectIntake(intake);
}

/*
 * Canonical liveness findings are compiled through the same non-spawnable
 * intake contract as every other Spawner finding.  The signature is bound in
 * the source/context evidence and duplicate signatures are rejected before a
 * route can be selected.  Nothing here can patch mutable runtime policy.
 */
export function compileCanonicalLivenessDefect({finding, priorSignatures = []} = {}) {
  assert(isRecord(finding), "canonical liveness finding must be an object");
  exactKeys(finding, [
    "defect_id", "defect_kind", "task_id", "candidate_sha256", "outcome_sha256", "stall_signature_sha256",
    "expected_transition", "summary", "expected", "observed", "observed_at_utc", "details_sha256", "observation_kind",
  ], "canonical liveness finding");
  requireIdentifier(finding.defect_id, "canonical liveness defect ID");
  assert(AGENT_SPAWNER_DEFECT_KINDS.includes(finding.defect_kind), "canonical liveness defect kind is invalid");
  requireIdentifier(finding.task_id, "canonical liveness task ID");
  requireSha(finding.candidate_sha256, "canonical liveness candidate");
  if (finding.outcome_sha256 !== null) requireSha(finding.outcome_sha256, "canonical liveness outcome");
  requireSha(finding.stall_signature_sha256, "canonical liveness signature");
  requireIdentifier(finding.expected_transition, "canonical liveness expected transition");
  requireString(finding.summary, "canonical liveness summary");
  requireString(finding.expected, "canonical liveness expected");
  requireString(finding.observed, "canonical liveness observed");
  requireUtc(finding.observed_at_utc, "canonical liveness timestamp");
  requireSha(finding.details_sha256, "canonical liveness details");
  requireIdentifier(finding.observation_kind, "canonical liveness observation kind");
  assert(Array.isArray(priorSignatures), "canonical liveness prior signatures must be an array");
  priorSignatures.forEach((signature, index) => requireSha(signature, `canonical liveness prior signature ${index}`));
  const duplicate = new Set(priorSignatures).has(finding.stall_signature_sha256);
  const sourceBinding = {
    candidate_sha256: finding.candidate_sha256,
    context_sha256: canonicalDigest({task_id: finding.task_id, expected_transition: finding.expected_transition, observation_kind: finding.observation_kind, stall_signature_sha256: finding.stall_signature_sha256}),
    roster_projection_sha256: canonicalDigest({defect_id: finding.defect_id, duplicate_signature: duplicate, prior_signature_count: priorSignatures.length}),
    source_identity_sha256: canonicalDigest({task_id: finding.task_id, defect_kind: finding.defect_kind, observation_kind: finding.observation_kind}),
  };
  return compileAgentSpawnerDefectIntake({
    defectId: finding.defect_id,
    defectKind: finding.defect_kind,
    sourceBinding,
    evidenceRefs: [
      {evidence_id: "EVIDENCE.LIVENESS.FINDING", kind: "LIVENESS_FINDING", reference: `opaque:liveness-finding:${finding.stall_signature_sha256}`, sha256: finding.details_sha256},
      {evidence_id: "EVIDENCE.LIVENESS.SIGNATURE", kind: "LIVENESS_SIGNATURE", reference: `opaque:liveness-signature:${finding.stall_signature_sha256}`, sha256: finding.stall_signature_sha256},
    ],
    observation: {summary: finding.summary, expected: finding.expected, observed: finding.observed, observed_at_utc: finding.observed_at_utc, details_sha256: finding.details_sha256},
    classification: duplicate ? "DUPLICATE_OR_STALE_BLOCK" : "ORCHESTRATOR_LIVENESS_FAILURE",
    rootCause: {
      category: finding.observation_kind,
      statement: duplicate ? "The canonical liveness signature was already reported and must be rejected without a duplicate route." : "The Controller observed a canonical material-liveness finding requiring one bounded typed repair route.",
      evidence_class: "OBSERVED",
    },
    blockId: "BLOCK.CONTROLLER.MATERIAL_LIVENESS",
    gateId: "GATE.CONTROLLER.MATERIAL_LIVENESS.CONSUMPTION",
    graphId: "GRAPH.CONTROLLER.MATERIAL_LIVENESS",
    question: "Did the responsible parent consume the exact material-liveness outcome and preserve the expected transition?",
    requiredEvidence: ["evidence.admission", "evidence.outcome_identity", "evidence.consumer_readback", "evidence.custody"],
    hostileFixtureRefs: ["FIXTURE.LIVENESS.STALE_CONSUMER", "FIXTURE.LIVENESS.DUPLICATE_SIGNATURE", "FIXTURE.LIVENESS.MALFORMED_ADMISSION"],
    authorityScope: ["COMPILE_REUSABLE_GATE", "REFRESH_TYPED_BINDINGS", "INVALIDATE_DEPENDENT_ROSTER"],
    stopConditions: ["MISSING_CONSUMER_READBACK", "STALE_OUTCOME_IDENTITY", "INDEPENDENT_EVALUATION_NOT_CLEARED"],
    bindingsToRefresh: ["BLOCK_DIGEST", "GATE_DIGEST", "ROSTER_PROJECTION_DIGEST", "CONTROLLER_RUNTIME_DIGEST"],
    deterministicRule: duplicate ? "Reject an unchanged canonical liveness signature; emit no second Controller route or message." : "Route exactly one non-spawnable governance repair only when the canonical liveness identity, consumer, expected transition, and custody evidence are bound.",
    detailsSha256: finding.details_sha256,
    observedAtUtc: finding.observed_at_utc,
  });
}

export function acceptAgentSpawnerDefectRepair(intake, {controllerReceiptSha256} = {}) {
  validateAgentSpawnerDefectIntake(intake);
  assert(intake.status === "REPAIR_CANDIDATE_READY", "Only a ready local repair may enter Controller custody");
  requireSha(controllerReceiptSha256, "Spawner defect Controller receipt");
  const next = structuredClone(intake);
  next.status = "ACCEPTED_FOR_CONTROLLER_CUSTODY";
  next.handoff = compileHandoff({defectId: next.defect_id, sourceBinding: next.source_binding, route: next.route, status: next.status, controllerReceiptSha256});
  next.defect_sha256 = canonicalDigest(body(next));
  return validateAgentSpawnerDefectIntake(next);
}
