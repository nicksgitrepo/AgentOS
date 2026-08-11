#!/usr/bin/env node

const SOURCE_FIELDS = Object.freeze([
  "project_id",
  "project_root",
  "cwd",
  "git_common_directory",
  "source_commit",
  "source_tree",
]);

const SOURCE_ALIASES = Object.freeze({
  project_id: Object.freeze(["project_id", "projectId"]),
  project_root: Object.freeze(["project_root", "projectRoot", "root"]),
  cwd: Object.freeze(["cwd", "working_directory", "workingDirectory"]),
  git_common_directory: Object.freeze(["git_common_directory", "gitCommonDirectory", "common_directory", "git_common_dir"]),
  source_commit: Object.freeze(["source_commit", "sourceCommit", "commit"]),
  source_tree: Object.freeze(["source_tree", "sourceTree", "tree"]),
});

const EXPECTED_ROLE = "IMPLEMENTATION_FUNCTIONALITY";
const EXPECTED_TOPOLOGY = "INDEPENDENT_SIBLING_SESSION";

export const THIN_WORKFLOW_SCHEMA = "agentos.thin_workflow_decision.v1";
export const THIN_WORKFLOW_OUTCOMES = Object.freeze({
  READY: "ready",
  QUESTION: "question",
  PUZZLE: "puzzle",
  SOFT_REVIEW: "soft review",
  UNAVAILABLE: "unavailable",
  HARD_STOP: "hard stop",
});
export const THIN_WORKFLOW_OUTCOME_CODES = Object.freeze({
  READY: "READY",
  QUESTION: "QUESTION",
  PUZZLE: "PUZZLE",
  SOFT_REVIEW: "SOFT_REVIEW",
  UNAVAILABLE: "UNAVAILABLE",
  HARD_STOP: "HARD_STOP",
});

const OUTCOME_CONFIG = Object.freeze({
  [THIN_WORKFLOW_OUTCOMES.READY]: Object.freeze({code: THIN_WORKFLOW_OUTCOME_CODES.READY, defaultReason: "READY_FOR_INDEPENDENT_CHECK"}),
  [THIN_WORKFLOW_OUTCOMES.QUESTION]: Object.freeze({code: THIN_WORKFLOW_OUTCOME_CODES.QUESTION, defaultReason: "OWNER_INPUT_REQUIRED"}),
  [THIN_WORKFLOW_OUTCOMES.PUZZLE]: Object.freeze({code: THIN_WORKFLOW_OUTCOME_CODES.PUZZLE, defaultReason: "BOUNDED_FAILURE"}),
  [THIN_WORKFLOW_OUTCOMES.SOFT_REVIEW]: Object.freeze({code: THIN_WORKFLOW_OUTCOME_CODES.SOFT_REVIEW, defaultReason: "NON_PROTECTED_CHANGE"}),
  [THIN_WORKFLOW_OUTCOMES.UNAVAILABLE]: Object.freeze({code: THIN_WORKFLOW_OUTCOME_CODES.UNAVAILABLE, defaultReason: "REQUIRED_READBACK_UNAVAILABLE"}),
  [THIN_WORKFLOW_OUTCOMES.HARD_STOP]: Object.freeze({code: THIN_WORKFLOW_OUTCOME_CODES.HARD_STOP, defaultReason: "PROTECTED_BOUNDARY"}),
});

const REASON_MESSAGES = Object.freeze({
  READY_FOR_INDEPENDENT_CHECK: "The bounded path has source-bound identity, meaningful progress, and an explicit in-scope ready decision.",
  OWNER_INPUT_REQUIRED: "A material owner decision is needed before the dependent outcome can proceed.",
  INTENT_REQUIRED: "The goal and admitted scope are not complete enough to evaluate.",
  DECISION_REQUIRED: "A typed workflow decision is missing.",
  DECISION_UNCLEAR: "The supplied workflow decision does not select a permitted route.",
  BOUNDED_FAILURE: "A bounded reversible failure remains for one focused repair and fresh check.",
  NON_PROTECTED_CHANGE: "A non-protected operating choice changed and needs a recorded review.",
  IDENTITY_MISSING: "The current source or role identity readback is unavailable.",
  IDENTITY_UNVERIFIED: "The supplied identity was explicitly unverified and cannot support acceptance.",
  ROLE_ADMISSION_MISSING: "The admitted functionality role is not available for readback.",
  SESSION_ID_MISSING: "The role has no real session identity readback.",
  SOURCE_READBACK_INCOMPLETE: "The source readback is incomplete and cannot bind the dependent result.",
  SOURCE_BINDING_MISMATCH: "The observed source binding differs from the admitted source binding.",
  CAPABILITY_UNAVAILABLE: "A required local capability is unavailable.",
  PROGRESS_MISSING: "Concrete progress is missing.",
  PROGRESS_UNPROVEN: "The progress record has no concrete checkpoint or meaningful movement.",
  PROGRESS_INCOMPLETE: "The bounded path has not reached a completed, checkable progress state.",
  TIMEOUT_NO_RESULT: "The bounded check timed out without a completion result.",
  PROGRESS_UNAVAILABLE: "The progress readback is unavailable.",
  CHECK_UNAVAILABLE: "The required focused check is unavailable or incomplete.",
  CHECK_FAILED: "The focused check found a bounded failure.",
  CHANGED_SCOPE: "The admitted scope changed during the current goal.",
  CHANGED_INTENT: "The admitted intent changed during the current goal.",
  CHANGED_POLICY: "A protected policy condition changed during the current goal.",
  CHANGED_CONDITION: "A protected execution condition changed during the current goal.",
  UNADMITTED_ROLE: "The role is not the admitted functionality lane.",
  INVALID_TOPOLOGY: "The role topology is not an independent admitted sibling.",
  EXTERNAL_ACTION: "The requested path crosses an external or protected action boundary.",
  SECRET_EXPOSURE: "A secret or private context boundary was detected.",
  SELF_ACCEPTANCE: "The producing lane cannot independently accept its own result.",
});

const NEXT_ACTIONS = Object.freeze({
  READY_FOR_INDEPENDENT_CHECK: "REQUEST_INDEPENDENT_FUNCTIONAL_CHECK",
  OWNER_INPUT_REQUIRED: "ASK_ONE_MATERIAL_OWNER_QUESTION",
  INTENT_REQUIRED: "ASK_FOR_GOAL_OR_ADMITTED_SCOPE",
  DECISION_REQUIRED: "REQUEST_TYPED_WORKFLOW_DECISION",
  DECISION_UNCLEAR: "ROUTE_TO_DECISION_RECONCILIATION",
  BOUNDED_FAILURE: "ROUTE_ONE_FOCUSED_REPAIR_THEN_RECHECK",
  NON_PROTECTED_CHANGE: "RECORD_CHOICE_AND_NEW_DECISION_DIGEST",
  IDENTITY_MISSING: "HOLD_AND_REQUEST_FRESH_SOURCE_BOUND_READBACK",
  IDENTITY_UNVERIFIED: "STOP_AND_REQUEST_VERIFIED_HOST_READBACK",
  ROLE_ADMISSION_MISSING: "HOLD_UNTIL_ADMITTED_ROLE_IS_READ_BACK",
  SESSION_ID_MISSING: "HOLD_UNTIL_REAL_SESSION_ID_IS_READ_BACK",
  SOURCE_READBACK_INCOMPLETE: "HOLD_UNTIL_SOURCE_READBACK_IS_COMPLETE",
  SOURCE_BINDING_MISMATCH: "CLOSE_CURRENT_GOAL_AND_MINT_FRESH_SOURCE_BOUND_GOAL",
  CAPABILITY_UNAVAILABLE: "RECORD_CAPABILITY_GAP_AND_HAND_OFF",
  PROGRESS_MISSING: "HOLD_UNTIL_CONCRETE_PROGRESS_IS_RECORDED",
  PROGRESS_UNPROVEN: "HOLD_UNTIL_A_CONCRETE_CHECKPOINT_IS_READ_BACK",
  PROGRESS_INCOMPLETE: "CONTINUE_ONLY_WITH_ONE_BOUNDED_NEXT_ACTION",
  TIMEOUT_NO_RESULT: "RECORD_TIMEOUT_NO_RESULT_AND_KEEP_UNPROVEN",
  PROGRESS_UNAVAILABLE: "HOLD_AND_REQUEST_FRESH_PROGRESS_READBACK",
  CHECK_UNAVAILABLE: "HOLD_AND_REQUEST_A_FRESH_FOCUSED_CHECK",
  CHECK_FAILED: "ROUTE_ONE_FOCUSED_REPAIR_THEN_RECHECK",
  CHANGED_SCOPE: "CLOSE_CURRENT_GOAL_AND_REQUIRE_FRESH_SCOPE_ADMISSION",
  CHANGED_INTENT: "CLOSE_CURRENT_GOAL_AND_REQUIRE_FRESH_INTENT_ADMISSION",
  CHANGED_POLICY: "CLOSE_CURRENT_GOAL_AND_REQUIRE_FRESH_POLICY_ADMISSION",
  CHANGED_CONDITION: "CLOSE_CURRENT_GOAL_AND_REQUIRE_FRESH_SOURCE_BOUND_GOAL",
  UNADMITTED_ROLE: "STOP_AND_REMOVE_UNADMITTED_ROLE_FROM_THE_ROUTE",
  INVALID_TOPOLOGY: "STOP_AND_REQUIRE_INDEPENDENT_SIBLING_TOPOLOGY",
  EXTERNAL_ACTION: "STOP_AT_THE_EXTERNAL_ACTION_BOUNDARY",
  SECRET_EXPOSURE: "STOP_AND_PRESERVE_ONLY_SAFE_BOUNDARY_EVIDENCE",
  SELF_ACCEPTANCE: "REQUEST_A_SEPARATE_INDEPENDENT_CHECKER",
});

const HARD_BOOLEAN_SIGNALS = Object.freeze([
  ["CHANGED_SCOPE", Object.freeze(["scope_changed", "changed_scope", "scope_change"])],
  ["CHANGED_INTENT", Object.freeze(["intent_changed", "changed_intent", "intent_change"])],
  ["CHANGED_POLICY", Object.freeze(["policy_changed", "changed_policy", "policy_change"])],
  ["CHANGED_CONDITION", Object.freeze(["condition_changed", "changed_condition", "condition_change"])],
  ["CHANGED_CONDITION", Object.freeze(["source_changed", "stale_source", "source_stale"])],
  ["SOURCE_BINDING_MISMATCH", Object.freeze(["source_binding_mismatch", "binding_mismatch", "wrong_source_repository", "source_mismatch", "identity_mismatch"])],
  ["IDENTITY_UNVERIFIED", Object.freeze(["identity_unverified", "unverified_identity", "identity_invalid"])],
  ["UNADMITTED_ROLE", Object.freeze(["unapproved_role", "unadmitted_role", "generic_worker", "compatibility_role"])],
  ["INVALID_TOPOLOGY", Object.freeze(["recursive_child", "child_role", "shell_stand_in", "shell_worker", "recursive", "parent_child_relationship"])],
  ["EXTERNAL_ACTION", Object.freeze(["external_action", "authentication_required", "spending_requested", "publication_requested", "deployment_requested", "release_requested", "destructive_action", "provider_required"])],
  ["SECRET_EXPOSURE", Object.freeze(["secret_exposure", "credential_exposure", "private_context", "private_record"])],
  ["SELF_ACCEPTANCE", Object.freeze(["self_acceptance", "self_accepted", "producer_accepted"])],
  ["HARD_STOP", Object.freeze(["hard_stop", "hard_boundary", "boundary_violation", "protected_boundary_crossed"])],
]);

const HARD_ROUTE_CODES = Object.freeze({
  HARD_STOP: "HARD_STOP",
  HARD_BOUNDARY: "PROTECTED_BOUNDARY",
  SOURCE_BINDING_MISMATCH: "SOURCE_BINDING_MISMATCH",
  WRONG_SOURCE_REPOSITORY: "SOURCE_BINDING_MISMATCH",
  SOURCE_MISMATCH: "SOURCE_BINDING_MISMATCH",
  IDENTITY_MISMATCH: "SOURCE_BINDING_MISMATCH",
  IDENTITY_UNVERIFIED: "IDENTITY_UNVERIFIED",
  UNADMITTED_ROLE: "UNADMITTED_ROLE",
  INVALID_TOPOLOGY: "INVALID_TOPOLOGY",
  RECURSIVE_CHILD: "INVALID_TOPOLOGY",
  SHELL_STAND_IN: "INVALID_TOPOLOGY",
  EXTERNAL_ACTION: "EXTERNAL_ACTION",
  AUTHENTICATION_REQUIRED: "EXTERNAL_ACTION",
  SPENDING_REQUESTED: "EXTERNAL_ACTION",
  PUBLICATION_REQUESTED: "EXTERNAL_ACTION",
  DEPLOYMENT_REQUESTED: "EXTERNAL_ACTION",
  RELEASE_REQUESTED: "EXTERNAL_ACTION",
  DESTRUCTIVE_ACTION: "EXTERNAL_ACTION",
  PROVIDER_REQUIRED: "EXTERNAL_ACTION",
  SECRET_EXPOSURE: "SECRET_EXPOSURE",
  PRIVATE_CONTEXT: "SECRET_EXPOSURE",
  SELF_ACCEPTANCE: "SELF_ACCEPTANCE",
  CHANGED_SCOPE: "CHANGED_SCOPE",
  SCOPE_CHANGE: "CHANGED_SCOPE",
  CHANGED_INTENT: "CHANGED_INTENT",
  INTENT_CHANGE: "CHANGED_INTENT",
  CHANGED_POLICY: "CHANGED_POLICY",
  POLICY_CHANGE: "CHANGED_POLICY",
  CHANGED_CONDITION: "CHANGED_CONDITION",
  CONDITION_CHANGE: "CHANGED_CONDITION",
});

const HARD_ROUTE_TOKENS = new Set(Object.keys(HARD_ROUTE_CODES));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valuePresent(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null;
}

function firstValue(...values) {
  return values.find(valuePresent);
}

function firstRecord(...values) {
  return values.find(isRecord) ?? null;
}

function normalizeToken(value) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/[ -]+/gu, "_");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function relatedRecords(record) {
  if (!isRecord(record)) return [];
  const nested = ["boundary", "source", "source_readback", "sourceReadback", "readback", "identity", "check", "focused_check", "focusedCheck", "independent_check", "independentCheck", "failure"]
    .map((key) => record[key])
    .filter(isRecord);
  return [record, ...nested];
}

function allRecords(...values) {
  return values.flatMap(relatedRecords);
}

function hasFlag(records, keys) {
  return records.some((record) => keys.some((key) => record[key] === true));
}

function valuesFor(records, keys) {
  return records.flatMap((record) => keys.map((key) => record[key]).filter(valuePresent));
}

function tokensFor(records, keys) {
  return valuesFor(records, keys).map(normalizeToken).filter(Boolean);
}

function readField(records, field) {
  return firstValue(...records.map((record) => SOURCE_ALIASES[field].map((key) => record[key])).flat());
}

function sourceFieldMap(records) {
  return Object.fromEntries(SOURCE_FIELDS.map((field) => [field, readField(records, field)]));
}

function presentFields(fields) {
  return SOURCE_FIELDS.filter((field) => valuePresent(fields[field]));
}

function sourceRecords(context) {
  if (!isRecord(context)) return [];
  return [
    context.source_readback,
    context.sourceReadback,
    context.readback,
    context.observed_source,
    context.observedSource,
    context.source,
    context.identity?.source,
    context,
  ].filter(isRecord);
}

function expectedSourceRecords({intent, context, decision}) {
  return [
    context?.expected_source,
    context?.expectedSource,
    context?.admitted_source,
    context?.admittedSource,
    context?.bound_source,
    context?.boundSource,
    intent?.expected_source,
    intent?.expectedSource,
    intent?.source_binding,
    intent?.sourceBinding,
    decision?.expected_source,
    decision?.expectedSource,
  ].filter(isRecord);
}

function compareRecordToSource(record, observed) {
  if (!isRecord(record)) return [];
  const fields = sourceFieldMap([record]);
  return SOURCE_FIELDS.filter((field) => valuePresent(fields[field]) && valuePresent(observed[field]) && !sameValue(fields[field], observed[field]));
}

function inspectSource({intent, context, roleAdmission, progress, decision}) {
  const observedRecords = sourceRecords(context);
  const expectedRecords = expectedSourceRecords({intent, context, decision});
  const observed = sourceFieldMap(observedRecords);
  const expected = sourceFieldMap(expectedRecords);
  const observedFields = presentFields(observed);
  const expectedFields = presentFields(expected);
  const hasStructuredSource = [
    context?.source_readback,
    context?.sourceReadback,
    context?.readback,
    context?.observed_source,
    context?.observedSource,
    context?.source,
  ].some(isRecord);
  const requiresCompleteSource = hasStructuredSource || expectedFields.length > 0;
  const missingFields = requiresCompleteSource ? SOURCE_FIELDS.filter((field) => !valuePresent(observed[field])) : [];
  const mismatchFields = SOURCE_FIELDS.filter((field) => valuePresent(expected[field]) && valuePresent(observed[field]) && !sameValue(expected[field], observed[field]));
  const verificationRecords = [
    context,
    context?.source_readback,
    context?.sourceReadback,
    context?.readback,
    context?.identity,
  ].filter(isRecord);
  const verificationValues = valuesFor(verificationRecords, ["identity_verified", "identityVerified", "source_verified", "sourceVerified", "readback_verified", "readbackVerified", "source_bound", "sourceBound", "verified"]);
  const explicitlyFalse = verificationValues.some((value) => value === false);
  const explicitlyTrue = verificationValues.some((value) => value === true);
  const completeSource = SOURCE_FIELDS.every((field) => valuePresent(observed[field]));
  const identityMarker = firstValue(
    ...observedFields.map((field) => observed[field]),
    context?.identity?.id,
    context?.identity?.identity_id,
    context?.identity?.session_id,
    context?.identity_id,
    context?.identityId,
  );
  const hasIdentity = valuePresent(identityMarker);
  const verified = !explicitlyFalse && (explicitlyTrue || completeSource);
  const additionalMismatchFields = [
    ...compareRecordToSource(roleAdmission, observed),
    ...compareRecordToSource(progress, observed),
    ...compareRecordToSource(decision?.check, observed),
    ...compareRecordToSource(decision?.focused_check, observed),
  ];
  return {
    observed,
    observedFields,
    expectedFields,
    missingFields,
    mismatchFields: [...new Set([...mismatchFields, ...additionalMismatchFields])].sort(),
    hasIdentity,
    verified,
    explicitlyFalse,
    sourceBound: hasIdentity && verified && missingFields.length === 0 && mismatchFields.length === 0 && additionalMismatchFields.length === 0,
  };
}

function inspectRoleAdmission(roleAdmission) {
  if (!isRecord(roleAdmission)) {
    return {
      present: false,
      admitted: false,
      role: null,
      sessionPresent: false,
      identityVerified: false,
      explicitlyFalse: false,
      wrongRole: false,
      invalidTopology: false,
    };
  }
  const status = normalizeToken(firstValue(roleAdmission.status, roleAdmission.state, roleAdmission.admission_status));
  const role = firstValue(roleAdmission.role, roleAdmission.admitted_role, roleAdmission.machine_role, roleAdmission.public_role) ?? null;
  const sessionId = firstValue(roleAdmission.session_id, roleAdmission.sessionId, roleAdmission.thread_id, roleAdmission.threadId, roleAdmission.real_session_id, roleAdmission.realSessionId, roleAdmission.identity);
  const admissionValues = [roleAdmission.admitted, roleAdmission.allowed, roleAdmission.admission_verified, roleAdmission.admissionVerified];
  const admitted = admissionValues.some((value) => value === true) || ["ADMITTED", "THREAD_BOUND", "READY", "ACTIVE"].includes(status);
  const explicitlyFalse = admissionValues.some((value) => value === false) || roleAdmission.rejected === true || roleAdmission.unverified === true;
  const verificationValues = [roleAdmission.identity_verified, roleAdmission.identityVerified, roleAdmission.readback_verified, roleAdmission.readbackVerified, roleAdmission.verified, roleAdmission.host_readback_verified, roleAdmission.hostReadbackVerified];
  const identityVerified = !verificationValues.includes(false) && (verificationValues.includes(true) || (status === "THREAD_BOUND" && valuePresent(sessionId)));
  const topology = normalizeToken(firstValue(roleAdmission.topology, roleAdmission.session_topology, roleAdmission.sessionTopology));
  const worktreeMode = normalizeToken(firstValue(roleAdmission.worktree_mode, roleAdmission.worktreeMode));
  const invalidTopology = [
    roleAdmission.parent_child_relationship === true,
    roleAdmission.child === true,
    roleAdmission.recursive === true,
    roleAdmission.shell_stand_in === true,
    roleAdmission.shellWorker === true,
    roleAdmission.generic_worker === true,
    topology !== "" && topology !== EXPECTED_TOPOLOGY,
    worktreeMode !== "" && worktreeMode !== "PROJECT_LOCAL_SESSION",
  ].some(Boolean);
  return {
    present: true,
    admitted,
    role,
    sessionPresent: valuePresent(sessionId),
    identityVerified,
    explicitlyFalse,
    wrongRole: valuePresent(role) && role !== EXPECTED_ROLE,
    invalidTopology,
  };
}

function inspectProgress(progress) {
  if (!isRecord(progress)) {
    return {present: false, timeout: false, unavailable: false, meaningful: false, complete: false, failed: false, incomplete: false};
  }
  const status = normalizeToken(firstValue(progress.status, progress.state, progress.result_status, progress.resultStatus));
  const timeout = progress.timed_out === true
    || progress.timeout === true
    || ["TIMEOUT", "TIMED_OUT", "TIMEOUT_NO_RESULT"].includes(status);
  const unavailable = progress.unavailable === true || ["UNAVAILABLE", "UNKNOWN", "UNPROVEN"].includes(status);
  const meaningfulValue = firstValue(progress.meaningful, progress.concrete, progress.has_concrete_progress, progress.hasConcreteProgress);
  const meaningful = meaningfulValue === true
    || valuePresent(firstValue(progress.checkpoint, progress.progress_id, progress.progressId, progress.last_concrete_progress, progress.lastConcreteProgress, progress.batch_id, progress.batchId))
    || (progress.completed === true && meaningfulValue !== false);
  const complete = progress.completed === true || ["COMPLETED", "COMPLETE", "DONE", "READY", "PASS", "SUCCESS", "CHECKPOINT_READY"].includes(status);
  const failed = progress.failed === true || ["FAILED", "FAIL", "BLOCKED", "OPEN_REPAIR"].includes(status);
  const incomplete = !timeout && !unavailable && !complete && !failed;
  return {present: true, timeout, unavailable, meaningful, complete, failed, incomplete};
}

function requiredCapabilities(intent, context) {
  const required = firstValue(
    context?.required_capabilities,
    context?.requiredCapabilities,
    intent?.required_capabilities,
    intent?.requiredCapabilities,
  );
  if (!Array.isArray(required) || required.length === 0) return null;
  const available = firstValue(context?.capabilities, context?.capability_set, context?.capabilitySet);
  if (!Array.isArray(available)) return {missing: [...required].sort(), unavailable: true};
  const availableSet = new Set(available);
  const missing = required.filter((capability) => !availableSet.has(capability)).sort();
  return {missing, unavailable: missing.length > 0};
}

function intentIsPresent(intent) {
  if (!isRecord(intent)) return {present: false, goal: false, scope: false};
  const goal = valuePresent(firstValue(intent.goal, intent.outcome, intent.requested_outcome, intent.requestedOutcome, intent.task));
  const scope = valuePresent(firstValue(intent.scope, intent.admitted_scope, intent.admittedScope, intent.boundary_scope, intent.boundaryScope));
  return {present: true, goal, scope};
}

function hardRouteFromTokens(records) {
  const fields = ["outcome", "status", "classification", "disposition", "route", "result", "decision", "state", "boundary_status", "boundaryStatus"];
  for (const token of tokensFor(records, fields)) {
    if (HARD_ROUTE_TOKENS.has(token)) return HARD_ROUTE_CODES[token];
  }
  return null;
}

function inspectHardBoundary({intent, context, roleAdmission, progress, decision, sourceInfo, roleInfo}) {
  const records = allRecords(intent, context, roleAdmission, progress, decision);
  for (const [code, keys] of HARD_BOOLEAN_SIGNALS) {
    if (hasFlag(records, keys)) return {code, fields: keys.filter((key) => hasFlag(records, [key]))};
  }

  const intentScope = firstValue(intent?.scope, intent?.admitted_scope, intent?.admittedScope);
  const expectedScope = firstValue(intent?.expected_scope, intent?.expectedScope, intent?.current_scope, intent?.currentScope);
  if (valuePresent(intentScope) && valuePresent(expectedScope) && !sameValue(intentScope, expectedScope)) return {code: "CHANGED_SCOPE", fields: ["scope"]};
  const decisionScope = firstValue(decision?.scope, decision?.admitted_scope, decision?.admittedScope);
  if (valuePresent(intentScope) && valuePresent(decisionScope) && !sameValue(intentScope, decisionScope)) return {code: "CHANGED_SCOPE", fields: ["scope"]};

  if (sourceInfo.mismatchFields.length > 0) return {code: "SOURCE_BINDING_MISMATCH", fields: sourceInfo.mismatchFields};
  if (roleInfo.wrongRole) return {code: "UNADMITTED_ROLE", fields: ["role"]};
  if (roleInfo.invalidTopology) return {code: "INVALID_TOPOLOGY", fields: ["topology"]};
  if (roleInfo.explicitlyFalse) return {code: "UNADMITTED_ROLE", fields: ["admission"]};
  if (roleInfo.present && roleAdmission.identity_verified === false) return {code: "IDENTITY_UNVERIFIED", fields: ["role_identity"]};
  if (sourceInfo.explicitlyFalse) return {code: "IDENTITY_UNVERIFIED", fields: ["source_identity"]};

  const routeCode = hardRouteFromTokens(records);
  if (routeCode !== null) return {code: routeCode, fields: ["decision_route"]};
  return null;
}

function checkRoute(decision) {
  if (!isRecord(decision)) return {present: false, route: null, reason: "DECISION_REQUIRED"};
  const records = allRecords(decision);
  const tokens = tokensFor(records, ["outcome", "status", "classification", "disposition", "route", "result", "decision", "state"]);
  if (hasFlag(records, ["owner_required", "ownerRequired", "question_required", "questionRequired", "requires_owner_decision", "requiresOwnerDecision"]) || tokens.some((token) => ["QUESTION", "OWNER_REQUIRED", "NEEDS_OWNER_INPUT", "OWNER_INPUT_REQUIRED", "CONFLICT"].includes(token))) {
    return {present: true, route: THIN_WORKFLOW_OUTCOMES.QUESTION, reason: tokens.includes("CONFLICT") ? "OWNER_INPUT_REQUIRED" : "OWNER_INPUT_REQUIRED"};
  }
  if (hasFlag(records, ["soft_review", "softReview", "non_protected_change", "nonProtectedChange", "preference_changed", "preferenceChanged", "operating_preference_changed", "operatingPreferenceChanged"]) || tokens.some((token) => ["SOFT_REVIEW", "REVIEW", "NON_PROTECTED_CHANGE"].includes(token))) {
    return {present: true, route: THIN_WORKFLOW_OUTCOMES.SOFT_REVIEW, reason: "NON_PROTECTED_CHANGE"};
  }
  if (hasFlag(records, ["puzzle", "bounded_failure", "boundedFailure", "repair_required", "repairRequired", "retryable_failure", "retryableFailure"]) || tokens.some((token) => ["PUZZLE", "OPEN_REPAIR", "REPAIR_REQUIRED", "REPAIRABLE_ENGINEERING_PUZZLE", "FAILED", "FAIL"].includes(token))) {
    const reason = tokens.some((token) => ["FAILED", "FAIL"].includes(token)) ? "CHECK_FAILED" : "BOUNDED_FAILURE";
    return {present: true, route: THIN_WORKFLOW_OUTCOMES.PUZZLE, reason};
  }
  if (hasFlag(records, ["unavailable", "capability_unavailable", "capabilityUnavailable", "check_unavailable", "checkUnavailable"]) || tokens.some((token) => ["UNAVAILABLE", "UNKNOWN", "UNPROVEN"].includes(token))) {
    return {present: true, route: THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, reason: "CHECK_UNAVAILABLE"};
  }
  if (tokens.some((token) => ["READY", "PASS", "SUCCESS", "PROCEED", "APPROVED", "ACCEPTED", "READY_FOR_INDEPENDENT_CLEARANCE", "READY_FOR_INDEPENDENT_CHECK"].includes(token)) || decision.ready === true || decision.proceed === true || decision.approved === true) {
    const checkRecords = [decision.check, decision.focused_check, decision.focusedCheck, decision.functional_check, decision.functionalCheck].filter(isRecord);
    const checkTokens = tokensFor(allRecords(...checkRecords), ["outcome", "status", "classification", "disposition", "route", "result", "decision", "state"]);
    if (checkTokens.some((token) => ["TIMEOUT", "TIMED_OUT", "TIMEOUT_NO_RESULT"].includes(token))) return {present: true, route: THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, reason: "TIMEOUT_NO_RESULT"};
    if (checkTokens.some((token) => ["UNAVAILABLE", "UNKNOWN", "UNPROVEN"].includes(token))) return {present: true, route: THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, reason: "CHECK_UNAVAILABLE"};
    if (checkTokens.some((token) => ["FAILED", "FAIL", "OPEN_REPAIR"].includes(token))) return {present: true, route: THIN_WORKFLOW_OUTCOMES.PUZZLE, reason: "CHECK_FAILED"};
    if (checkTokens.some((token) => ["QUESTION", "OWNER_REQUIRED", "PENDING"].includes(token)) && isRecord(decision.check)) return {present: true, route: THIN_WORKFLOW_OUTCOMES.QUESTION, reason: "CHECK_UNAVAILABLE"};
    return {present: true, route: THIN_WORKFLOW_OUTCOMES.READY, reason: "READY_FOR_INDEPENDENT_CHECK"};
  }
  if (decision.question !== undefined || decision.owner_question !== undefined) return {present: true, route: THIN_WORKFLOW_OUTCOMES.QUESTION, reason: "OWNER_INPUT_REQUIRED"};
  return {present: true, route: null, reason: "DECISION_UNCLEAR"};
}

function makeResult(outcome, reason, evidence, blockingFields = []) {
  const config = OUTCOME_CONFIG[outcome];
  const reasonCode = reason ?? config.defaultReason;
  const sourceBound = evidence?.source_bound === true;
  const roleIdentityVerified = evidence?.role_identity_verified === true;
  const progressMeaningful = evidence?.progress_meaningful === true;
  const decisionPresent = evidence?.decision_present === true;
  const success = outcome === THIN_WORKFLOW_OUTCOMES.READY && sourceBound && roleIdentityVerified && progressMeaningful && decisionPresent;
  const uniqueFields = [...new Set(blockingFields)].sort();
  return {
    schema: THIN_WORKFLOW_SCHEMA,
    outcome,
    outcome_code: config.code,
    classification: config.code,
    status: config.code,
    success,
    accepted: false,
    reason_code: reasonCode,
    reason: REASON_MESSAGES[reasonCode] ?? REASON_MESSAGES[config.defaultReason],
    blocking_fields: uniqueFields,
    next_action: NEXT_ACTIONS[reasonCode] ?? NEXT_ACTIONS[config.defaultReason],
    acceptance: {
      root: "FUNCTION_REQUIREMENTS",
      status: success ? "READY_FOR_INDEPENDENT_CLEARANCE" : "UNRESOLVED",
      independent_check: success ? "REQUESTED" : "NOT_REQUESTED",
    },
    evidence: {
      source_bound: sourceBound,
      role_identity_verified: roleIdentityVerified,
      progress_meaningful: progressMeaningful,
      decision_present: decisionPresent,
    },
  };
}

function normalizeArguments(input, contextArg, roleAdmissionArg, progressArg, decisionArg, argumentCount) {
  if (argumentCount >= 5) return {intent: input, context: contextArg, roleAdmission: roleAdmissionArg, progress: progressArg, decision: decisionArg};
  const packet = isRecord(input) ? input : {};
  return {
    intent: packet.intent,
    context: packet.context,
    roleAdmission: packet.roleAdmission ?? packet.role_admission,
    progress: packet.progress,
    decision: packet.decision,
  };
}

export function evaluateThinWorkflow(input = {}, contextArg = undefined, roleAdmissionArg = undefined, progressArg = undefined, decisionArg = undefined) {
  const {intent, context, roleAdmission, progress, decision} = normalizeArguments(input, contextArg, roleAdmissionArg, progressArg, decisionArg, arguments.length);
  const sourceInfo = inspectSource({intent, context, roleAdmission, progress, decision});
  const roleInfo = inspectRoleAdmission(roleAdmission);
  const progressInfo = inspectProgress(progress);
  const intentInfo = intentIsPresent(intent);
  const hardBoundary = inspectHardBoundary({intent, context, roleAdmission, progress, decision, sourceInfo, roleInfo});
  const evidence = {
    source_bound: sourceInfo.sourceBound,
    role_identity_verified: roleInfo.present && roleInfo.admitted && roleInfo.sessionPresent && roleInfo.identityVerified,
    progress_meaningful: progressInfo.present && progressInfo.meaningful,
    decision_present: isRecord(decision),
  };

  if (hardBoundary !== null) return makeResult(THIN_WORKFLOW_OUTCOMES.HARD_STOP, hardBoundary.code, evidence, hardBoundary.fields);
  if (!sourceInfo.hasIdentity) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "IDENTITY_MISSING", evidence, ["source_identity"]);
  if (sourceInfo.explicitlyFalse) return makeResult(THIN_WORKFLOW_OUTCOMES.HARD_STOP, "IDENTITY_UNVERIFIED", evidence, ["source_identity"]);
  if (sourceInfo.missingFields.length > 0) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "SOURCE_READBACK_INCOMPLETE", evidence, sourceInfo.missingFields);
  if (!sourceInfo.verified || !sourceInfo.sourceBound) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "IDENTITY_MISSING", evidence, ["source_identity"]);
  if (!roleInfo.present) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "ROLE_ADMISSION_MISSING", evidence, ["role_admission"]);
  if (!roleInfo.admitted) return makeResult(THIN_WORKFLOW_OUTCOMES.HARD_STOP, "UNADMITTED_ROLE", evidence, ["admission"]);
  if (!roleInfo.sessionPresent) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "SESSION_ID_MISSING", evidence, ["role_identity"]);
  if (!roleInfo.identityVerified) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "IDENTITY_MISSING", evidence, ["role_identity"]);

  const capabilities = requiredCapabilities(intent, context);
  if (capabilities?.unavailable) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "CAPABILITY_UNAVAILABLE", evidence, capabilities.missing.length > 0 ? capabilities.missing : ["capabilities"]);
  if (!progressInfo.present) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "PROGRESS_MISSING", evidence, ["progress"]);
  if (progressInfo.timeout) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "TIMEOUT_NO_RESULT", evidence, ["progress", "focused_check"]);
  if (progressInfo.unavailable) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "PROGRESS_UNAVAILABLE", evidence, ["progress"]);
  if (!progressInfo.meaningful) return makeResult(THIN_WORKFLOW_OUTCOMES.UNAVAILABLE, "PROGRESS_UNPROVEN", evidence, ["progress"]);
  if (!intentInfo.present || !intentInfo.goal || !intentInfo.scope) return makeResult(THIN_WORKFLOW_OUTCOMES.QUESTION, intentInfo.present ? "INTENT_REQUIRED" : "OWNER_INPUT_REQUIRED", evidence, ["intent"]);

  const route = checkRoute(decision);
  if (!route.present) return makeResult(THIN_WORKFLOW_OUTCOMES.QUESTION, "DECISION_REQUIRED", evidence, ["decision"]);
  if (route.route !== null && route.route !== THIN_WORKFLOW_OUTCOMES.READY) return makeResult(route.route, route.reason, evidence, ["decision"]);
  if (progressInfo.failed) return makeResult(THIN_WORKFLOW_OUTCOMES.PUZZLE, "BOUNDED_FAILURE", evidence, ["progress"]);
  if (progressInfo.incomplete) return makeResult(THIN_WORKFLOW_OUTCOMES.QUESTION, "PROGRESS_INCOMPLETE", evidence, ["progress"]);
  if (route.route === null) return makeResult(THIN_WORKFLOW_OUTCOMES.QUESTION, route.reason, evidence, ["decision"]);
  return makeResult(THIN_WORKFLOW_OUTCOMES.READY, "READY_FOR_INDEPENDENT_CHECK", evidence);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("thin functionality evaluator loaded\n");
