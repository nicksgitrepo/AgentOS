#!/usr/bin/env node

import crypto from "node:crypto";

export const BOOTSTRAP_COVERAGE_SCHEMA = "agentos.bootstrap_coverage.v1";
export const BOOTSTRAP_COVERAGE_STATUSES = Object.freeze([
  "DISCOVERED",
  "OWNER_CONFIRMED",
  "DEFAULTED",
  "DERIVED",
  "DEFERRED_NONBLOCKING",
  "NOT_APPLICABLE_WITH_PROOF",
  "OWNER_REQUIRED",
  "DEPENDENCY_PENDING",
  "CONFLICT",
]);
export const BOOTSTRAP_COVERAGE_SOURCE_KINDS = Object.freeze([
  "DISCOVERY",
  "OWNER_INPUT",
  "PORTABLE_DEFAULT",
  "DERIVED_OUTPUT",
  "NOT_APPLICABLE_PROOF",
  "DEPENDENCY",
  "UNRESOLVED_OWNER_BOUNDARY",
]);

export const BOOTSTRAP_REQUIRED_OUTPUT_GROUPS = Object.freeze([
  "PROJECT_DEFINITION",
  "NORTH_STAR",
  "PROVING_WORKFLOW",
  "FUNCTION_REQUIREMENTS",
  "TECHNICAL_BASELINE",
  "DELIVERY_POLICY",
  "DESIGN_BIBLE",
  "SECURITY_BASELINE",
  "AUTHORITY_BOUNDARIES",
  "AUTHORITY_CORPUS",
  "MODEL_POLICY",
  "PERSISTENT_RUNTIME",
  "FIRST_CAMPAIGN",
  "EXACT_CREATION_PLAN",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function answerPresent(answers, id) {
  return Object.hasOwn(answers, id) && answers[id] !== undefined;
}

function answerHasValue(answer, fields) {
  return isRecord(answer) && fields.some((field) => answer[field] !== undefined && answer[field] !== null);
}

function factIds(discovery, pattern, statuses = ["OBSERVED_FACT"]) {
  return discovery
    .filter((fact) => fact && typeof fact.fact_id === "string" && pattern.test(fact.fact_id) && statuses.includes(fact.status))
    .map((fact) => fact.fact_id)
    .sort(compareUtf8);
}

function hasSignal(discovery, pattern) {
  return factIds(discovery, pattern).length > 0;
}

function hasConflict(discovery, pattern = /.*/u) {
  return discovery.some((fact) => fact && pattern.test(fact.fact_id ?? "") && ["CONFLICT", "UNKNOWN"].includes(fact.status));
}

function hasTechnicalEvidence(discovery) {
  return hasSignal(discovery, /^(?:project\.marker\.|stack\.)/u);
}

function hasDataAnswer(answer) {
  return answerHasValue(answer, ["data", "storage", "backup_and_recovery", "migrations", "database"]);
}

function hasAuthenticationAnswer(answer) {
  return answerHasValue(answer, ["authentication", "auth", "identity", "authorization"]);
}

function deliveryAnswerGaps(answer) {
  if (!isRecord(answer)) return ["DELIVERY_POLICY_OWNER_INPUT"];
  const runner = answer.ci_runner ?? answer.runner ?? {};
  const deployment = answer.deployment ?? {};
  const cost = answer.cost_boundaries ?? {};
  const runnerRoute = runner.route ?? runner.runner_route;
  const deploymentRoute = deployment.route ?? deployment.hosting_route;
  const gaps = [];
  if (!runnerRoute || runnerRoute === "PROJECT_DEFINED") gaps.push("CI_RUNNER_ROUTE");
  if (["HOSTED", "VPS"].includes(runnerRoute) && !runner.provider_id) gaps.push("CI_RUNNER_PROVIDER_BINDING");
  if (!deploymentRoute || deploymentRoute === "PROJECT_DEFINED") gaps.push("DEPLOYMENT_ROUTE");
  if (["MANAGED", "VPS"].includes(deploymentRoute) && !deployment.provider_id) gaps.push("DEPLOYMENT_PROVIDER_BINDING");
  if (!Array.isArray(deployment.environment_ids) || deployment.environment_ids.length === 0) gaps.push("DEPLOYMENT_ENVIRONMENT_BINDING");
  if ((runner.weekly_minutes_budget ?? cost.weekly_runner_minutes) === undefined) gaps.push("RUNNER_MINUTES_BOUNDARY");
  return gaps;
}

function runtimeBound(answer) {
  return isRecord(answer)
    && typeof answer.session_id === "string" && answer.session_id.trim().length > 0
    && typeof answer.environment_identity === "string" && answer.environment_identity.trim().length > 0;
}

function isBlocking(status) {
  return ["OWNER_REQUIRED", "DEPENDENCY_PENDING", "CONFLICT"].includes(status);
}

function definition(outputId, category, fields) {
  return Object.freeze({
    output_id: outputId,
    category,
    required: fields.required ?? true,
    applicability: fields.applicability ?? "REQUIRED",
    question_ids: Object.freeze(fields.question_ids ?? []),
    dependency_output_ids: Object.freeze(fields.dependency_output_ids ?? []),
    compiled_field_paths: Object.freeze(fields.compiled_field_paths ?? []),
    safe_default: fields.safe_default ?? "NO_SAFE_DEFAULT",
    probe_required: fields.probe_required ?? false,
    owner_decision_required: fields.owner_decision_required ?? false,
    unavailable_behavior: fields.unavailable_behavior,
    reopen_triggers: Object.freeze(fields.reopen_triggers ?? []),
  });
}

// This is the canonical inventory. It is deliberately broader than the
// creation-plan groups so trust, recovery, data, and delivery obligations
// cannot disappear merely because they do not need a separate user question.
export const BOOTSTRAP_OUTPUT_DEFINITIONS = Object.freeze([
  definition("DISCOVERY_PERMISSION", "TRUST", {
    question_ids: ["bootstrap.discovery.mode"],
    compiled_field_paths: ["discovery_mode", "discovery_digest_sha256"],
    safe_default: "RECOMMENDED_READ_ONLY_DISCOVERY",
    owner_decision_required: true,
    unavailable_behavior: "ASK_ONLY_OWNER_INPUT_AND_DO_NOT_INFER_MECHANICAL_FACTS",
    reopen_triggers: ["discovery_mode_changed", "project_root_changed"],
  }),
  definition("PROJECT_DEFINITION", "CREATION", {
    question_ids: ["project.boundary"],
    compiled_field_paths: ["project_definition", "exact_creation_plan.repositories"],
    owner_decision_required: true,
    unavailable_behavior: "HOLD_PROJECT_CREATION_WITHOUT_WRITING_OR_BINDING_EXTERNAL_RESOURCES",
    reopen_triggers: ["repository_scope_changed", "ownership_changed", "boundary_changed"],
  }),
  definition("NORTH_STAR", "INTENT", {
    question_ids: ["project.north_star"],
    compiled_field_paths: ["north_star"],
    owner_decision_required: true,
    unavailable_behavior: "HOLD_PROJECT_CREATION_UNTIL_OWNER_OUTCOME_IS_EXPLICIT",
    reopen_triggers: ["owner_outcome_changed", "primary_user_or_moment_changed"],
  }),
  definition("PROVING_WORKFLOW", "INTENT", {
    question_ids: ["project.first_workflow"],
    compiled_field_paths: ["proving_workflow", "first_campaign.proving_workflow"],
    owner_decision_required: true,
    unavailable_behavior: "HOLD_FIRST_CAMPAIGN_WITHOUT_A_SMALL_VERIFIABLE_WORKFLOW",
    reopen_triggers: ["success_condition_changed", "first_workflow_changed"],
  }),
  definition("AUTHORITY_BOUNDARIES", "TRUST", {
    question_ids: ["project.protected_boundaries"],
    compiled_field_paths: ["authority_boundaries", "exact_creation_plan.prohibited_actions"],
    owner_decision_required: true,
    unavailable_behavior: "FAIL_CLOSED_ON_PROTECTED_ACTIONS_AND_DO_NOT_ESCALATE_BY_GUESS",
    reopen_triggers: ["owner_boundary_changed", "safety_or_legal_context_changed"],
  }),
  definition("AUTHORITY_CORPUS", "CREATION", {
    question_ids: ["authority-corpus.source"],
    compiled_field_paths: ["authority_corpus", "authority_corpus.roots"],
    owner_decision_required: true,
    unavailable_behavior: "CREATE_ONLY_THE_EMPTY_TYPED_CORPUS_AFTER_EXPLICIT_CREATE_OR_IMPORT_DECISION",
    reopen_triggers: ["authority_source_changed", "article_numbering_or_root_changed"],
  }),
  definition("DESIGN_BIBLE", "PRODUCT_PROOF", {
    applicability: "CONDITIONAL",
    question_ids: ["project.design"],
    compiled_field_paths: ["design_bible"],
    safe_default: "NO_VISIBLE_SURFACE_ASSUMED; REOPEN_ON_VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_SIGNAL",
    unavailable_behavior: "DO_NOT_CLAIM_PERCEPTIBLE_DESIGN_BEHAVIOR_WITHOUT_DEPLOYED_LIVE_PROOF",
    reopen_triggers: ["visible_surface_added", "design_authority_added", "protected_surface_changed"],
  }),
  definition("SECURITY_BASELINE", "TRUST", {
    compiled_field_paths: ["security_baseline"],
    safe_default: "PIN_PORTABLE_SECURITY_BASELINE_IDENTITY_VERSION_AND_REQUIREMENT_IDS",
    unavailable_behavior: "FAIL_CLOSED_WITHOUT_A_CONTENT_ADDRESSED_SECURITY_STANDARD_AND_ATOMIC_REQUIREMENT_IDS",
    reopen_triggers: ["security_standard_identity_changed", "security_requirement_ids_changed", "security_boundary_changed"],
  }),
  definition("TECHNICAL_BASELINE", "CREATION", {
    question_ids: ["project.technical_baseline"],
    compiled_field_paths: ["technical_baseline"],
    safe_default: "USE_DISCOVERED_MARKERS_AND_TYPED_UNSELECTED_FIELDS",
    unavailable_behavior: "KEEP_UNSELECTED_STACK_FIELDS_EXPLICIT_AND_DO_NOT_INVENT_A_PROVIDER_OR_RUNTIME",
    reopen_triggers: ["stack_marker_changed", "authentication_or_data_signal_added", "testing_route_changed"],
  }),
  definition("DATA_AND_MIGRATION_POLICY", "DATA", {
    applicability: "CONDITIONAL",
    question_ids: ["project.technical_baseline"],
    dependency_output_ids: ["TECHNICAL_BASELINE"],
    compiled_field_paths: ["technical_baseline.data", "technical_baseline.constraints.data"],
    safe_default: "NO_DURABLE_DATA_ASSUMED; REOPEN_ON_DATA_OR_MIGRATION_SIGNAL",
    unavailable_behavior: "DO_NOT_CREATE_OR_MIGRATE_DURABLE_DATA_WITHOUT_A_TYPED_POLICY",
    reopen_triggers: ["database_or_storage_marker_added", "migration_requested", "durable_data_entered"],
  }),
  definition("AUTHENTICATION_AND_ACCESS", "TRUST", {
    applicability: "CONDITIONAL",
    question_ids: ["project.technical_baseline"],
    dependency_output_ids: ["TECHNICAL_BASELINE", "AUTHORITY_BOUNDARIES"],
    compiled_field_paths: ["technical_baseline.authentication", "authority_boundaries"],
    safe_default: "NO_AUTHENTICATED_ROUTE_ASSUMED; REOPEN_ON_AUTH_SIGNAL",
    unavailable_behavior: "DO_NOT_CLAIM_AUTHORIZATION_OR_TENANT_SEPARATION_PROOF",
    reopen_triggers: ["authentication_marker_added", "protected_route_added", "identity_boundary_changed"],
  }),
  definition("DELIVERY_POLICY", "DELIVERY", {
    question_ids: ["project.delivery_policy"],
    compiled_field_paths: ["delivery_policy", "exact_creation_plan.delivery_bindings"],
    safe_default: "CHECKPOINTS_REMOTE_EQUAL_CENTRAL_MERGE_RUNTIME_DEPLOYMENT_ROLLBACK_REQUIRED",
    probe_required: true,
    owner_decision_required: true,
    unavailable_behavior: "DO_NOT_PUSH_MERGE_AUTHENTICATE_SPEND_PREVIEW_DEPLOY_OR_ROLL_BACK",
    reopen_triggers: ["provider_or_environment_changed", "runner_route_changed", "deployment_or_rollback_changed", "cost_boundary_changed"],
  }),
  definition("DELIVERY_PROBES", "DELIVERY", {
    dependency_output_ids: ["DELIVERY_POLICY", "PROJECT_DEFINITION"],
    compiled_field_paths: ["delivery_probe_plan", "delivery.probe.results.json"],
    safe_default: "RUN_ONLY_BOUND_LOCAL_READ_ONLY_PROBES",
    probe_required: true,
    unavailable_behavior: "LEAVE_OWNER_BOUNDARY_PROBES_NOT_RUN_AND_HOLD_EXTERNAL_SIDE_EFFECTS",
    reopen_triggers: ["delivery_policy_changed", "project_root_changed", "discovery_changed"],
  }),
  definition("MODEL_POLICY", "CREATION", {
    question_ids: ["project.model_economics"],
    compiled_field_paths: ["model_policy"],
    owner_decision_required: true,
    unavailable_behavior: "FAIL_CLOSED_WITHOUT_AN_ELIGIBLE_MODEL_OR_FEASIBLE_BUDGET",
    reopen_triggers: ["completion_floor_changed", "budget_or_duty_cycle_changed", "model_capability_changed"],
  }),
  definition("PERSISTENT_RUNTIME", "RUNTIME", {
    question_ids: ["project.runtime"],
    compiled_field_paths: ["persistent_runtime"],
    owner_decision_required: true,
    unavailable_behavior: "DO_NOT_PASS_SETUP_AUDIT_OR_DEPLOY_WITHOUT_EXACT_RUNTIME_AND_ENVIRONMENT_BINDING",
    reopen_triggers: ["runtime_session_changed", "environment_identity_changed", "runtime_capabilities_changed"],
  }),
  definition("FUNCTION_REQUIREMENTS", "PRODUCT_PROOF", {
    dependency_output_ids: ["NORTH_STAR", "PROVING_WORKFLOW"],
    compiled_field_paths: ["function_requirements"],
    safe_default: "COMPILE_ONE_ATOMIC_CLAUSE_FROM_THE_FIRST_PROVING_WORKFLOW",
    unavailable_behavior: "DO_NOT_CLAIM_FUNCTION_PASS_WITHOUT_A_BOUND_OWNER_OUTCOME_AND_SUCCESS_CONDITION",
    reopen_triggers: ["north_star_changed", "proving_workflow_changed", "function_clause_changed"],
  }),
  definition("FIRST_CAMPAIGN", "CAMPAIGN", {
    dependency_output_ids: ["NORTH_STAR", "PROVING_WORKFLOW", "FUNCTION_REQUIREMENTS", "PERSISTENT_RUNTIME"],
    compiled_field_paths: ["first_campaign"],
    safe_default: "ONE_MINIMAL_SYNTHETIC_CAMPAIGN_ROOT_FROM_THE_FIRST_PROVING_WORKFLOW",
    unavailable_behavior: "DO_NOT_ADMIT_A_CAMPAIGN_WITHOUT_A_PERSISTENT_RUNTIME_AND_PROVING_WORKFLOW",
    reopen_triggers: ["first_campaign_scope_changed", "feature_roster_changed", "runtime_binding_changed"],
  }),
  definition("RECOVERY_AND_ROLLBACK", "RECOVERY", {
    dependency_output_ids: ["DELIVERY_POLICY", "PERSISTENT_RUNTIME"],
    compiled_field_paths: ["delivery_policy.rollback", "exact_creation_plan.rollback", "persistent_runtime.rollback_identity"],
    safe_default: "EXACT_LAST_ACCEPTED_DEPLOYMENT_WITH_RUNTIME_AND_OWNER_BOUNDARY",
    unavailable_behavior: "DO_NOT_DEPLOY_OR_PROMOTE_WITHOUT_AN_EXACT_ROLLBACK_IDENTITY_AND_TEST",
    reopen_triggers: ["deployment_identity_changed", "rollback_strategy_changed", "runtime_authority_changed"],
  }),
  definition("OBSERVABILITY_AND_RETENTION", "RECOVERY", {
    dependency_output_ids: ["TECHNICAL_BASELINE", "MODEL_POLICY"],
    compiled_field_paths: ["technical_baseline.observability", "model_policy.telemetry"],
    safe_default: "COMPACT_CONTENT_ADDRESSED_EVENTS_WITH_TYPED_RETENTION_AND_NO_SECRET_LOGGING",
    unavailable_behavior: "KEEP_EVIDENCE_COMPACT_AND_RETAIN_UNPROVEN_STATUS_WHEN_TELEMETRY_IS_UNAVAILABLE",
    reopen_triggers: ["retention_preference_changed", "evidence_route_changed", "observability_signal_added"],
  }),
  definition("LEGACY_PRESERVATION", "RECOVERY", {
    applicability: "CONDITIONAL",
    dependency_output_ids: ["AUTHORITY_CORPUS"],
    compiled_field_paths: ["authority_corpus.preservation", "authority_corpus.source_identity"],
    safe_default: "NOT_REQUIRED_FOR_CREATE_NEW; SEAL_LEGACY_ARCHIVE_BEFORE_REPLACEMENT_WRITES_FOR_IMPORT_OR_REFACTOR",
    probe_required: true,
    unavailable_behavior: "DO_NOT_REPLACE_AN_IMPORTED_OR_REFACTORED_CORPUS_WITHOUT_VERIFIED_LEGACY_ARCHIVE",
    reopen_triggers: ["authority_operation_changed", "legacy_source_bytes_changed", "legacy_source_root_changed"],
  }),
  definition("BOOTSTRAP_PROOF", "TRUST", {
    dependency_output_ids: ["PROJECT_DEFINITION", "AUTHORITY_CORPUS", "DELIVERY_PROBES", "PERSISTENT_RUNTIME"],
    compiled_field_paths: ["exact_creation_plan", "bootstrap_coverage"],
    safe_default: "EXACT_DIGEST_TOCTOU_READBACK_INDEPENDENT_SETUP_AUDIT_AND_SEALED_INVENTORY",
    probe_required: true,
    unavailable_behavior: "FAIL_CLOSED_WITHOUT_EXACT_PLAN_APPROVAL_READBACK_AND_INDEPENDENT_AUDIT",
    reopen_triggers: ["plan_digest_changed", "discovery_changed", "setup_audit_changed", "staging_inventory_changed"],
  }),
  definition("PROJECT_CONTEXT_SEPARATION", "TRUST", {
    dependency_output_ids: ["AUTHORITY_CORPUS", "PROJECT_DEFINITION"],
    compiled_field_paths: ["project_context", "extension_boundary"],
    safe_default: "PROJECT_FACTS_ENTER_ONLY_THROUGH_TYPED_CONTEXT_AND_TEMPLATES",
    unavailable_behavior: "REJECT_PROJECT_EXTENSIONS_THAT_WEAKEN_OR_SHADOW_PORTABLE_GOVERNANCE",
    reopen_triggers: ["project_context_schema_changed", "extension_added", "portable_kernel_changed"],
  }),
  definition("ACTIVATION_BOUNDARY", "TRUST", {
    compiled_field_paths: ["status", "activation"],
    safe_default: "PREPARED_NOT_ACTIVATED",
    unavailable_behavior: "DO_NOT_ACTIVATE_OR_REBIND_A_PRODUCT_CAMPAIGN",
    reopen_triggers: ["explicit_owner_activation_decision", "product_campaign_rebind_requested"],
  }),
  definition("EXACT_CREATION_PLAN", "CREATION", {
    dependency_output_ids: [
      "DISCOVERY_PERMISSION", "PROJECT_DEFINITION", "NORTH_STAR", "PROVING_WORKFLOW", "AUTHORITY_BOUNDARIES",
      "AUTHORITY_CORPUS", "DESIGN_BIBLE", "SECURITY_BASELINE", "TECHNICAL_BASELINE", "DATA_AND_MIGRATION_POLICY",
      "AUTHENTICATION_AND_ACCESS", "DELIVERY_POLICY", "DELIVERY_PROBES", "MODEL_POLICY", "PERSISTENT_RUNTIME",
      "FUNCTION_REQUIREMENTS", "FIRST_CAMPAIGN", "RECOVERY_AND_ROLLBACK", "OBSERVABILITY_AND_RETENTION",
      "LEGACY_PRESERVATION", "BOOTSTRAP_PROOF", "PROJECT_CONTEXT_SEPARATION", "ACTIVATION_BOUNDARY",
    ],
    compiled_field_paths: ["exact_creation_plan", "plan_sha256"],
    safe_default: "NO_SAFE_DEFAULT; DERIVE_ONLY_AFTER_ALL_MATERIAL_GAPS_CLOSE",
    unavailable_behavior: "DO_NOT_COMPILE_OR_APPROVE_A_PARTIAL_CREATION_PLAN",
    reopen_triggers: ["any_dependent_output_changed", "discovery_changed", "answer_changed"],
  }),
]);

function rowBase(definitionRecord, overrides = {}) {
  return {
    output_id: definitionRecord.output_id,
    category: definitionRecord.category,
    required: definitionRecord.required,
    applicability: definitionRecord.applicability,
    source_kind: overrides.source_kind ?? "DEPENDENCY",
    source_refs: overrides.source_refs ?? [],
    discovery_inputs: overrides.discovery_inputs ?? [],
    status: overrides.status ?? "DEPENDENCY_PENDING",
    safe_default: definitionRecord.safe_default,
    probe_required: definitionRecord.probe_required,
    owner_decision_required: overrides.owner_decision_required ?? definitionRecord.owner_decision_required,
    unavailable_behavior: definitionRecord.unavailable_behavior,
    reopen_triggers: definitionRecord.reopen_triggers,
    dependency_output_ids: definitionRecord.dependency_output_ids,
    question_ids: definitionRecord.question_ids,
    compiled_field_paths: definitionRecord.compiled_field_paths,
    blocking: overrides.blocking ?? isBlocking(overrides.status ?? "DEPENDENCY_PENDING"),
    reason: overrides.reason ?? "DEPENDENCY_NOT_COMPILED",
  };
}

function ownerRow(definitionRecord, answerId, answers, reason, gaps = []) {
  const present = answerPresent(answers, answerId);
  return rowBase(definitionRecord, {
    source_kind: present ? "OWNER_INPUT" : "UNRESOLVED_OWNER_BOUNDARY",
    source_refs: [answerId],
    status: present && gaps.length === 0 ? "OWNER_CONFIRMED" : "OWNER_REQUIRED",
    blocking: !present || gaps.length > 0,
    reason: present && gaps.length === 0 ? "OWNER_INPUT_BOUND" : (gaps.join("+") || reason),
    owner_decision_required: true,
  });
}

function compileRows(discovery, answers) {
  const technicalAnswer = answers["project.technical_baseline"];
  const deliveryAnswer = answers["project.delivery_policy"];
  const authorityAnswer = answers["authority-corpus.source"];
  const visibleSurface = hasSignal(discovery, /(?:ui|view|route|design|visual|browser)/iu);
  const technicalConflict = hasConflict(discovery, /^(?:project\.marker\.|stack\.)/u);
  const technicalKnown = hasTechnicalEvidence(discovery) && !technicalConflict;
  const dataSignal = hasDataAnswer(technicalAnswer) || hasSignal(discovery, /(?:database|storage|migration|schema|sql|postgres|mysql|mongo|redis|data)/iu);
  const authSignal = hasAuthenticationAnswer(technicalAnswer) || hasSignal(discovery, /(?:auth|identity|permission|session|security)/iu);
  const rows = [];

  const discoveryDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DISCOVERY_PERMISSION");
  rows.push(ownerRow(discoveryDefinition, "bootstrap.discovery.mode", answers, "DISCOVERY_PERMISSION_OWNER_INPUT"));

  for (const outputId of ["PROJECT_DEFINITION", "NORTH_STAR", "PROVING_WORKFLOW", "AUTHORITY_BOUNDARIES", "AUTHORITY_CORPUS"]) {
    const definitionRecord = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === outputId);
    const answerId = definitionRecord.question_ids[0];
    rows.push(ownerRow(definitionRecord, answerId, answers, `${outputId}_OWNER_INPUT`));
  }
  const authorityRow = rows.find((row) => row.output_id === "AUTHORITY_CORPUS");
  if (authorityRow && answerPresent(answers, "authority-corpus.source")) {
    const operation = authorityAnswer?.operation;
    if (!["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE", "CREATE_NEW"].includes(operation)) {
      authorityRow.status = "OWNER_REQUIRED";
      authorityRow.blocking = true;
      authorityRow.reason = "AUTHORITY_CORPUS_OPERATION_MUST_BE_CREATE_IMPORT_OR_REFACTOR";
    } else if (["IMPORT", "REFACTOR_PREVIOUS_GOVERNANCE"].includes(operation)
      && (typeof authorityAnswer.source_root !== "string" || authorityAnswer.source_root.trim().length === 0)) {
      authorityRow.status = "OWNER_REQUIRED";
      authorityRow.blocking = true;
      authorityRow.reason = "IMPORTED_OR_REFACTORED_AUTHORITY_CORPUS_REQUIRES_READ_ONLY_SOURCE_ROOT";
    }
  }

  const designDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DESIGN_BIBLE");
  if (answerPresent(answers, "project.design")) {
    rows.push(ownerRow(designDefinition, "project.design", answers, "DESIGN_BIBLE_OWNER_INPUT"));
  } else if (visibleSurface) {
    rows.push(rowBase(designDefinition, {
      source_kind: "UNRESOLVED_OWNER_BOUNDARY",
      source_refs: factIds(discovery, /(?:ui|view|route|design|visual|browser)/iu),
      discovery_inputs: factIds(discovery, /(?:ui|view|route|design|visual|browser)/iu),
      status: "OWNER_REQUIRED",
      blocking: true,
      reason: "VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_REQUIRES_OWNER_DESIGN_CONTEXT",
      owner_decision_required: true,
    }));
  } else {
    rows.push(rowBase(designDefinition, {
      source_kind: "NOT_APPLICABLE_PROOF",
      source_refs: ["NO_VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_SIGNAL"],
      status: "NOT_APPLICABLE_WITH_PROOF",
      blocking: false,
      reason: "NO_VISIBLE_SURFACE_OR_DESIGN_AUTHORITY_SIGNAL",
    }));
  }

  const securityDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "SECURITY_BASELINE");
  rows.push(rowBase(securityDefinition, answerPresent(answers, "security.baseline")
    ? {
      source_kind: "OWNER_INPUT",
      source_refs: ["security.baseline"],
      status: "OWNER_CONFIRMED",
      blocking: false,
      reason: "SECURITY_STANDARD_BOUND_FROM_PROJECT_CONTEXT",
      owner_decision_required: false,
    }
    : {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["agentos.security-baseline.v1"],
      status: "DEFAULTED",
      blocking: false,
      reason: "PORTABLE_SECURITY_STANDARD_IDENTITY_AND_REQUIREMENTS_DEFAULTED",
    }));

  const technicalDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "TECHNICAL_BASELINE");
  if (answerPresent(answers, "project.technical_baseline")) {
    rows.push(ownerRow(technicalDefinition, "project.technical_baseline", answers, "TECHNICAL_BASELINE_OWNER_INPUT"));
  } else if (technicalKnown) {
    rows.push(rowBase(technicalDefinition, {
      source_kind: "DISCOVERY",
      source_refs: factIds(discovery, /^(?:project\.marker\.|stack\.)/u),
      discovery_inputs: factIds(discovery, /^(?:project\.marker\.|stack\.)/u),
      status: "DISCOVERED",
      blocking: false,
      reason: "TECHNICAL_MARKERS_DISCOVERED_WITHOUT_CONFLICT",
    }));
  } else {
    rows.push(rowBase(technicalDefinition, {
      source_kind: "UNRESOLVED_OWNER_BOUNDARY",
      source_refs: ["project.technical_baseline"],
      status: "OWNER_REQUIRED",
      blocking: true,
      reason: "TECHNICAL_BASELINE_NOT_DISCOVERED_OR_HAS_CONFLICT",
      owner_decision_required: true,
    }));
  }

  const dataDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DATA_AND_MIGRATION_POLICY");
  rows.push(rowBase(dataDefinition, dataSignal
    ? {
      source_kind: answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]) ? "OWNER_INPUT" : "DISCOVERY",
      source_refs: answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]) ? ["project.technical_baseline"] : factIds(discovery, /(?:database|storage|migration|schema|sql|postgres|mysql|mongo|redis|data)/iu),
      discovery_inputs: factIds(discovery, /(?:database|storage|migration|schema|sql|postgres|mysql|mongo|redis|data)/iu),
      status: answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]) ? "OWNER_CONFIRMED" : "OWNER_REQUIRED",
      blocking: !answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]),
      reason: answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]) ? "DATA_POLICY_BOUND" : "DATA_SIGNAL_REQUIRES_TYPED_POLICY",
      owner_decision_required: !answerHasValue(technicalAnswer, ["data", "storage", "backup_and_recovery", "migrations", "database"]),
    }
    : {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["NO_DATA_OR_MIGRATION_SIGNAL"],
      status: "DEFERRED_NONBLOCKING",
      blocking: false,
      reason: "NO_DATA_OR_MIGRATION_SIGNAL",
    }));

  const authDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "AUTHENTICATION_AND_ACCESS");
  rows.push(rowBase(authDefinition, authSignal
    ? {
      source_kind: hasAuthenticationAnswer(technicalAnswer) ? "OWNER_INPUT" : "DISCOVERY",
      source_refs: hasAuthenticationAnswer(technicalAnswer) ? ["project.technical_baseline"] : factIds(discovery, /(?:auth|identity|permission|session|security)/iu),
      discovery_inputs: factIds(discovery, /(?:auth|identity|permission|session|security)/iu),
      status: hasAuthenticationAnswer(technicalAnswer) ? "OWNER_CONFIRMED" : "OWNER_REQUIRED",
      blocking: !hasAuthenticationAnswer(technicalAnswer),
      reason: hasAuthenticationAnswer(technicalAnswer) ? "AUTHENTICATION_POLICY_BOUND" : "AUTHENTICATION_SIGNAL_REQUIRES_TYPED_POLICY",
      owner_decision_required: !hasAuthenticationAnswer(technicalAnswer),
    }
    : {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: ["NO_AUTHENTICATION_OR_ACCESS_SIGNAL"],
      status: "DEFERRED_NONBLOCKING",
      blocking: false,
      reason: "NO_AUTHENTICATION_OR_ACCESS_SIGNAL",
    }));

  const deliveryDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DELIVERY_POLICY");
  const deliveryGaps = deliveryAnswerGaps(deliveryAnswer);
  rows.push(rowBase(deliveryDefinition, {
    source_kind: answerPresent(answers, "project.delivery_policy") ? "OWNER_INPUT" : "UNRESOLVED_OWNER_BOUNDARY",
    source_refs: ["project.delivery_policy"],
    discovery_inputs: factIds(discovery, /^(?:delivery\.|repositories\.|tool\.)/u),
    status: deliveryGaps.length === 0 ? "OWNER_CONFIRMED" : "OWNER_REQUIRED",
    blocking: deliveryGaps.length > 0,
    reason: deliveryGaps.length === 0 ? "DELIVERY_POLICY_BOUND" : deliveryGaps.join("+"),
    owner_decision_required: true,
  }));

  const probeDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "DELIVERY_PROBES");
  rows.push(rowBase(probeDefinition, deliveryGaps.length === 0
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: ["DELIVERY_POLICY", "PROJECT_DEFINITION"],
      status: "DERIVED",
      blocking: false,
      reason: "READ_ONLY_PROBE_PLAN_DERIVED_FROM_BOUND_POLICY",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["DELIVERY_POLICY"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "DELIVERY_POLICY_MUST_BE_BOUND_BEFORE_PROBES",
    }));

  const modelDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "MODEL_POLICY");
  rows.push(ownerRow(modelDefinition, "project.model_economics", answers, "MODEL_POLICY_OWNER_INPUT"));

  const runtimeDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "PERSISTENT_RUNTIME");
  rows.push(rowBase(runtimeDefinition, runtimeBound(answers["project.runtime"])
    ? {
      source_kind: "OWNER_INPUT",
      source_refs: ["project.runtime"],
      status: "OWNER_CONFIRMED",
      blocking: false,
      reason: "PERSISTENT_RUNTIME_AND_ENVIRONMENT_BOUND",
      owner_decision_required: true,
    }
    : {
      source_kind: "UNRESOLVED_OWNER_BOUNDARY",
      source_refs: ["project.runtime"],
      status: "OWNER_REQUIRED",
      blocking: true,
      reason: "EXACT_RUNTIME_SESSION_AND_ENVIRONMENT_BINDING_REQUIRED",
      owner_decision_required: true,
    }));

  const functionDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "FUNCTION_REQUIREMENTS");
  const intentReady = answerPresent(answers, "project.north_star") && answerPresent(answers, "project.first_workflow");
  rows.push(rowBase(functionDefinition, intentReady
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: ["NORTH_STAR", "PROVING_WORKFLOW"],
      status: "DERIVED",
      blocking: false,
      reason: "ATOMIC_FUNCTION_CLAUSE_DERIVED_FROM_OWNER_INTENT",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["NORTH_STAR", "PROVING_WORKFLOW"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "OWNER_INTENT_AND_PROVING_WORKFLOW_REQUIRED",
    }));

  const firstCampaignDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "FIRST_CAMPAIGN");
  rows.push(rowBase(firstCampaignDefinition, intentReady && runtimeBound(answers["project.runtime"])
    ? {
      source_kind: answerPresent(answers, "project.first_campaign") ? "OWNER_INPUT" : "DERIVED_OUTPUT",
      source_refs: answerPresent(answers, "project.first_campaign") ? ["project.first_campaign"] : ["NORTH_STAR", "PROVING_WORKFLOW"],
      status: answerPresent(answers, "project.first_campaign") ? "OWNER_CONFIRMED" : "DEFAULTED",
      blocking: false,
      reason: answerPresent(answers, "project.first_campaign") ? "FIRST_CAMPAIGN_CONTEXT_BOUND" : "MINIMAL_CAMPAIGN_DERIVED_FROM_PROVING_WORKFLOW",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["NORTH_STAR", "PROVING_WORKFLOW", "PERSISTENT_RUNTIME"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "FIRST_CAMPAIGN_REQUIRES_INTENT_WORKFLOW_AND_RUNTIME",
    }));

  const recoveryDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "RECOVERY_AND_ROLLBACK");
  rows.push(rowBase(recoveryDefinition, deliveryGaps.length === 0 && runtimeBound(answers["project.runtime"])
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: ["DELIVERY_POLICY", "PERSISTENT_RUNTIME"],
      status: "DERIVED",
      blocking: false,
      reason: "EXACT_ROLLBACK_IDENTITY_DERIVED_FROM_DELIVERY_AND_RUNTIME_BOUNDARIES",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: ["DELIVERY_POLICY", "PERSISTENT_RUNTIME"],
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "DELIVERY_AND_RUNTIME_BINDINGS_REQUIRED_FOR_RECOVERY",
    }));

  const observabilityDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "OBSERVABILITY_AND_RETENTION");
  rows.push(rowBase(observabilityDefinition, {
    source_kind: answerHasValue(technicalAnswer, ["observability"]) ? "OWNER_INPUT" : "PORTABLE_DEFAULT",
    source_refs: answerHasValue(technicalAnswer, ["observability"]) ? ["project.technical_baseline"] : ["PORTABLE_EVENT_LOG_AND_RETENTION_DEFAULT"],
    status: "DEFAULTED",
    blocking: false,
    reason: answerHasValue(technicalAnswer, ["observability"]) ? "OBSERVABILITY_CONTEXT_BOUND" : "PORTABLE_OBSERVABILITY_AND_RETENTION_DEFAULT",
  }));

  const legacyDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "LEGACY_PRESERVATION");
  const operation = authorityAnswer?.operation;
  const legacySourceBound = typeof authorityAnswer?.source_root === "string" && authorityAnswer.source_root.trim().length > 0;
  rows.push(rowBase(legacyDefinition, operation === "CREATE_NEW"
    ? {
      source_kind: "NOT_APPLICABLE_PROOF",
      source_refs: ["authority-corpus.source.operation=CREATE_NEW"],
      status: "NOT_APPLICABLE_WITH_PROOF",
      blocking: false,
      reason: "NO_IMPORTED_OR_REFACTORED_CORPUS_REQUIRES_LEGACY_ARCHIVE",
    }
    : (operation === "IMPORT" || operation === "REFACTOR_PREVIOUS_GOVERNANCE") && legacySourceBound
      ? {
        source_kind: "OWNER_INPUT",
        source_refs: ["authority-corpus.source"],
        status: "OWNER_CONFIRMED",
        blocking: false,
        reason: "LEGACY_ARCHIVE_GATE_REQUIRED_BEFORE_REPLACEMENT_WRITES",
      }
      : (operation === "IMPORT" || operation === "REFACTOR_PREVIOUS_GOVERNANCE")
        ? {
          source_kind: "UNRESOLVED_OWNER_BOUNDARY",
          source_refs: ["authority-corpus.source.source_root"],
          status: "OWNER_REQUIRED",
          blocking: true,
          reason: "IMPORTED_OR_REFACTORED_AUTHORITY_REQUIRES_A_READ_ONLY_SOURCE_ROOT",
          owner_decision_required: true,
        }
      : {
        source_kind: "DEPENDENCY",
        source_refs: ["AUTHORITY_CORPUS"],
        status: "DEPENDENCY_PENDING",
        blocking: true,
        reason: "AUTHORITY_CORPUS_OPERATION_MUST_BE_BOUND_BEFORE_LEGACY_GATE_CAN_BE_RESOLVED",
      }));

  for (const outputId of ["BOOTSTRAP_PROOF", "PROJECT_CONTEXT_SEPARATION", "ACTIVATION_BOUNDARY"]) {
    const definitionRecord = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === outputId);
    rows.push(rowBase(definitionRecord, {
      source_kind: "PORTABLE_DEFAULT",
      source_refs: [outputId === "ACTIVATION_BOUNDARY" ? "PREPARED_NOT_ACTIVATED" : "PORTABLE_KERNEL"],
      status: "DEFAULTED",
      blocking: false,
      reason: outputId === "ACTIVATION_BOUNDARY" ? "ACTIVATION_REMAINS_EXPLICIT_OWNER_DECISION" : "PORTABLE_GOVERNANCE_PROOF_RULE",
    }));
  }

  const exactDefinition = BOOTSTRAP_OUTPUT_DEFINITIONS.find((entry) => entry.output_id === "EXACT_CREATION_PLAN");
  const unresolvedRows = rows.filter((row) => row.blocking);
  rows.push(rowBase(exactDefinition, unresolvedRows.length === 0
    ? {
      source_kind: "DERIVED_OUTPUT",
      source_refs: rows.map((row) => row.output_id),
      status: "DERIVED",
      blocking: false,
      reason: "ALL_REQUIRED_MATERIAL_OUTPUTS_HAVE_BOUND_PROVENANCE_AND_STATUS",
    }
    : {
      source_kind: "DEPENDENCY",
      source_refs: unresolvedRows.map((row) => row.output_id),
      status: "DEPENDENCY_PENDING",
      blocking: true,
      reason: "MATERIAL_OUTPUT_GAPS_REMAIN",
    }));
  return rows;
}

export function compileBootstrapCoverage({discovery = [], answers = {}} = {}) {
  assert(Array.isArray(discovery), "Bootstrap coverage discovery must be an array");
  requireRecord(answers, "Bootstrap coverage answers");
  const discoveryDigest = canonicalDigest(discovery);
  const answersDigest = canonicalDigest(answers);
  const outputs = compileRows(discovery, answers);
  const pendingQuestionIds = [...new Set(outputs.filter((row) => row.blocking).flatMap((row) => row.question_ids))];
  const materialGaps = outputs.filter((row) => row.blocking).map((row) => ({
    output_id: row.output_id,
    status: row.status,
    reason: row.reason,
    question_ids: row.question_ids,
    dependency_output_ids: row.dependency_output_ids,
  }));
  const body = {
    schema: BOOTSTRAP_COVERAGE_SCHEMA,
    version: 1,
    governance_version: "2.1rc",
    status: materialGaps.length === 0 ? "READY_TO_COMPILE" : "QUESTION_PENDING",
    discovery_digest_sha256: discoveryDigest,
    answers_sha256: answersDigest,
    required_output_groups: BOOTSTRAP_REQUIRED_OUTPUT_GROUPS,
    output_count: outputs.length,
    outputs,
    pending_question_ids: pendingQuestionIds,
    material_gaps: materialGaps,
    question_rule: "ASK_ONLY_THE_EARLIEST_MATERIAL_GAP_NOT_SETTLED_BY_DISCOVERY_DEFAULT_DERIVATION_OR_EXISTING_OWNER_INPUT",
  };
  const coverage = {...body, coverage_sha256: canonicalDigest(body)};
  validateBootstrapCoverage(coverage);
  return coverage;
}

export function validateBootstrapCoverage(coverage) {
  requireRecord(coverage, "Bootstrap coverage");
  assert(coverage.schema === BOOTSTRAP_COVERAGE_SCHEMA && coverage.version === 1 && coverage.governance_version === "2.1rc", "Bootstrap coverage identity is invalid");
  assert(["READY_TO_COMPILE", "QUESTION_PENDING"].includes(coverage.status), "Bootstrap coverage status is invalid");
  requireSha(coverage.discovery_digest_sha256, "Bootstrap coverage discovery digest");
  requireSha(coverage.answers_sha256, "Bootstrap coverage answers digest");
  assert(Array.isArray(coverage.required_output_groups)
    && JSON.stringify(coverage.required_output_groups) === JSON.stringify(BOOTSTRAP_REQUIRED_OUTPUT_GROUPS), "Bootstrap coverage output groups are invalid");
  assert(Number.isSafeInteger(coverage.output_count) && coverage.output_count === BOOTSTRAP_OUTPUT_DEFINITIONS.length, "Bootstrap coverage output count is invalid");
  assert(Array.isArray(coverage.outputs) && coverage.outputs.length === BOOTSTRAP_OUTPUT_DEFINITIONS.length, "Bootstrap coverage outputs are invalid");
  for (const [index, row] of coverage.outputs.entries()) {
    const expected = BOOTSTRAP_OUTPUT_DEFINITIONS[index];
    requireRecord(row, `Bootstrap coverage output ${index}`);
    assert(row.output_id === expected.output_id, `Bootstrap coverage output order is invalid at ${index}`);
    assert(BOOTSTRAP_COVERAGE_STATUSES.includes(row.status), `Bootstrap coverage status is invalid for ${row.output_id}`);
    assert(["REQUIRED", "CONDITIONAL"].includes(row.applicability), `Bootstrap coverage applicability is invalid for ${row.output_id}`);
    assert(typeof row.required === "boolean" && typeof row.blocking === "boolean", `Bootstrap coverage flags are invalid for ${row.output_id}`);
    assert(BOOTSTRAP_COVERAGE_SOURCE_KINDS.includes(row.source_kind), `Bootstrap coverage source kind is invalid for ${row.output_id}`);
    assert(Array.isArray(row.source_refs) && Array.isArray(row.discovery_inputs), `Bootstrap coverage provenance is invalid for ${row.output_id}`);
    for (const reference of [...row.source_refs, ...row.discovery_inputs]) requireString(reference, `Bootstrap coverage provenance reference for ${row.output_id}`);
    assert(Array.isArray(row.question_ids) && row.question_ids.every((id) => QUESTION_ID.test(id)), `Bootstrap coverage question IDs are invalid for ${row.output_id}`);
    assert(Array.isArray(row.dependency_output_ids) && row.dependency_output_ids.every((id) => SAFE_ID.test(id)), `Bootstrap coverage dependencies are invalid for ${row.output_id}`);
    assert(Array.isArray(row.compiled_field_paths) && row.compiled_field_paths.every((field) => typeof field === "string" && field.length > 0), `Bootstrap coverage field paths are invalid for ${row.output_id}`);
    requireString(row.safe_default, `Bootstrap coverage safe default for ${row.output_id}`);
    requireString(row.unavailable_behavior, `Bootstrap coverage unavailable behavior for ${row.output_id}`);
    assert(Array.isArray(row.reopen_triggers) && row.reopen_triggers.length > 0, `Bootstrap coverage reopen triggers are missing for ${row.output_id}`);
    requireString(row.reason, `Bootstrap coverage reason for ${row.output_id}`);
    assert(row.blocking === isBlocking(row.status), `Bootstrap coverage blocking flag does not match status for ${row.output_id}`);
    assert(JSON.stringify(row.question_ids) === JSON.stringify(expected.question_ids), `Bootstrap coverage question mapping changed for ${row.output_id}`);
    assert(JSON.stringify(row.dependency_output_ids) === JSON.stringify(expected.dependency_output_ids), `Bootstrap coverage dependencies changed for ${row.output_id}`);
    assert(JSON.stringify(row.compiled_field_paths) === JSON.stringify(expected.compiled_field_paths), `Bootstrap coverage field mapping changed for ${row.output_id}`);
  }
  assert(Array.isArray(coverage.pending_question_ids), "Bootstrap coverage pending questions are invalid");
  assert(Array.isArray(coverage.material_gaps), "Bootstrap coverage material gaps are invalid");
  const expectedPendingQuestionIds = [...new Set(coverage.outputs.filter((row) => row.blocking).flatMap((row) => row.question_ids))];
  assert(JSON.stringify(coverage.pending_question_ids) === JSON.stringify(expectedPendingQuestionIds), "Bootstrap coverage pending questions are not derived from blocking rows");
  const expectedMaterialGaps = coverage.outputs.filter((row) => row.blocking).map((row) => ({
    output_id: row.output_id,
    status: row.status,
    reason: row.reason,
    question_ids: row.question_ids,
    dependency_output_ids: row.dependency_output_ids,
  }));
  assert(JSON.stringify(coverage.material_gaps) === JSON.stringify(expectedMaterialGaps), "Bootstrap coverage material gaps are not derived from blocking rows");
  assert((coverage.status === "READY_TO_COMPILE") === (coverage.material_gaps.length === 0), "Bootstrap coverage readiness does not match material gaps");
  const body = structuredClone(coverage);
  delete body.coverage_sha256;
  requireSha(coverage.coverage_sha256, "Bootstrap coverage digest");
  assert(coverage.coverage_sha256 === canonicalDigest(body), "Bootstrap coverage is not content-addressed");
  return coverage;
}

export function coverageForQuestion(coverage, questionId) {
  validateBootstrapCoverage(coverage);
  return coverage.outputs.filter((row) => row.question_ids.includes(questionId));
}
